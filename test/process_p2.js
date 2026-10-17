/**
 * P2 process API 快速验证（临时目录 + mock 网关内联）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const assert = require('assert');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const { migrate } = require(path.join(root, 'scripts/migrate.js'));
const { openDb } = require(path.join(root, 'src/db.js'));
const processSvc = require(path.join(root, 'src/process.js'));
const { executeAdapter } = require(path.join(root, 'src/gen/index.js'));

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml_p2_'));
migrate(testDir, { doBackup: false });
const db = openDb(testDir);
const services = {
  db,
  config: { dataDir: testDir, litellmBaseUrl: '', litellmApiKey: '' },
  logger: console
};

// mock gateway
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==', 'base64');
const jobs = new Map();
const gw = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let data = {};
    try { data = JSON.parse(body || '{}'); } catch {}
    res.setHeader('Content-Type', 'application/json');
    if (data.request_id) {
      const job = jobs.get(data.request_id);
      job.polls++;
      if (job.polls < 2) return res.end(JSON.stringify({ status: 'running', progress: 50 }));
      return res.end(JSON.stringify({
        status: 'done', progress: 100,
        result: { url: `http://127.0.0.1:${gw.address().port}/ok.jpg`, mime: 'image/jpeg', width: 1, height: 1 }
      }));
    }
    if ((req.url || '').endsWith('.jpg')) {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.end(JPEG);
    }
    const id = crypto.randomBytes(4).toString('hex');
    jobs.set(id, { polls: 0, action: data.action });
    res.end(JSON.stringify({ request_id: id }));
  });
});

gw.listen(0, '127.0.0.1', async () => {
  const port = gw.address().port;
  try {
    // 1. presets seeded
    const presets = processSvc.listPresets(db);
    assert(presets.length >= 8, `预设应≥8，实际 ${presets.length}`);
    assert(presets.some(p => p.action === 'watermark_remove'));
    console.log('✅ 预设注册表');

    // 2. point gateway to mock
    db.prepare("UPDATE gen_adapters SET base_url=? WHERE id='unified_gateway'").run(`http://127.0.0.1:${port}`);
    const adapter = processSvc.getGatewayAdapter(db);
    assert(processSvc.isGatewayConfigured(adapter));
    console.log('✅ 网关适配器已指向 mock');

    // 3. seed asset + origin file
    const fid = 'p2_fid_001';
    db.prepare(`
      INSERT INTO assets (fid, kind, file_name, size, status, source, created_at, discovered_at)
      VALUES (?, 'image', 'p2.jpg', 10, 'ready', 'quark', ?, ?)
    `).run(fid, Date.now(), Date.now());
    const origDir = path.join(testDir, 'cache', 'originals');
    fs.mkdirSync(origDir, { recursive: true });
    fs.writeFileSync(path.join(origDir, `${fid}.jpg`), JPEG);

    // 4. enqueue + execute
    const job = processSvc.enqueueProcessJob(db, { assetFid: fid, presetId: 'watermark_remove' });
    assert(job.status === 'queued' && job.action === 'watermark_remove');
    console.log('✅ 任务入队', job.id);

    const row = db.prepare('SELECT * FROM node_runs WHERE id=?').get(job.id);
    const result = await processSvc.executeProcessJob(services, row);
    assert(result.success, 'process 应成功: ' + JSON.stringify(result));
    const after = processSvc.getProcessJob(db, job.id);
    assert(after.status === 'done' && after.derivativeId, `应完成且有 derivative，实际 ${after.status}`);
    assert(after.progress === 100);
    const deriv = db.prepare('SELECT * FROM derivatives WHERE id=?').get(after.derivativeId);
    assert(deriv && deriv.kind === 'clean', '去水印应产出 clean 衍生图');
    console.log('✅ 全生命周期 queued→done + clean derivative');

    // 5. presets admin upsert/delete
    processSvc.upsertPreset(db, { id: 'custom_x', label: '自定义', action: 'upscale', params: { scale: 2 }, sort: 999 });
    assert(processSvc.listPresets(db).some(p => p.id === 'custom_x'));
    processSvc.deletePreset(db, 'custom_x');
    assert(!processSvc.listPresets(db).some(p => p.id === 'custom_x'));
    let threw = false;
    try { processSvc.deletePreset(db, 'upscale_2x'); } catch { threw = true; }
    assert(threw, '内置预设不可删');
    console.log('✅ 预设管理');

    // 6. unfreeze videos
    db.prepare(`
      INSERT INTO assets (fid, kind, file_name, status, source, discovered_at, created_at)
      VALUES ('v1', 'video', 'a.mp4', 'frozen', 'quark', ?, ?)
    `).run(Date.now(), Date.now());
    const n = processSvc.unfreezeVideos(db, 10);
    assert(n === 1, `应解冻1，实际 ${n}`);
    assert(db.prepare("SELECT status FROM assets WHERE fid='v1'").get().status === 'discovered');
    console.log('✅ 视频分批解冻');

    console.log('\n🎉 P2 process 服务端验证全部通过');
  } catch (e) {
    console.error('❌', e);
    process.exitCode = 1;
  } finally {
    gw.close();
    db.close();
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  }
});
