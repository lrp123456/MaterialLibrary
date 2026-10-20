/**
 * 剪辑板块新增接口回归（快照 / 资源包 / AI 任务 / 剪辑素材）。
 *
 * 运行：node test/clip-api.test.js
 * 说明：用 node:sqlite 代替 better-sqlite3（后者是 Linux 原生模块，Windows 侧加载不了），
 *      API 形状一致：prepare().get/all/run + exec。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');

// ---- 桩掉鉴权与素材读取，测试只关心接口语义 ----
const authPath = require.resolve(path.join(ROOT, 'src/auth.js'));
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    verifySession: () => ({ id: 1, username: 'tester', role: 'admin' }),
  },
};

const aiTasksPath = require.resolve(path.join(ROOT, 'src/ai-tasks.js'));
require.cache[aiTasksPath] = {
  id: aiTasksPath, filename: aiTasksPath, loaded: true,
  exports: { resolveAssetBuffer: async () => Buffer.from('fake-media-bytes') },
};

const { handleClipApi } = require(path.join(ROOT, 'src/clip-api.js'));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-api-test-'));
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE assets (
    fid TEXT PRIMARY KEY, file_name TEXT, kind TEXT, width INTEGER, height INTEGER,
    duration_s REAL, thumb_url TEXT, size INTEGER, updated_at INTEGER
  );
`);
db.prepare('INSERT INTO assets (fid,file_name,kind,width,height,duration_s,thumb_url,size,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .run('fid_a', '客厅.mp4', 'video', 1920, 1080, 12.5, '/t/a.jpg', 1000, Date.now());
db.prepare('INSERT INTO assets (fid,file_name,kind,width,height,duration_s,thumb_url,size,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .run('fid_b', '卧室.mp4', 'video', 1920, 1080, 8.0, '/t/b.jpg', 2000, Date.now());

const services = { db, config: { dataDir } };

const server = http.createServer((req, res) => {
  handleClipApi(services, req, res).then((handled) => {
    if (!handled && !res.headersSent) { res.writeHead(599); res.end('unhandled'); }
  }).catch((e) => {
    if (!res.headersSent) { res.writeHead(500); res.end(String(e && e.message)); }
  });
});

function call(method, urlPath, body) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, path: urlPath, method,
        headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch { /* 非 JSON */ }
          resolve({ status: res.statusCode, text, json });
        });
      },
    );
    req.on('error', (e) => resolve({ status: 0, text: String(e.message), json: null }));
    if (body) req.write(body);
    req.end();
  });
}

const results = [];
const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail: String(detail) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  // ============ M2 快照 ============
  let r = await call('POST', '/editor-api/snapshots', JSON.stringify({
    name: '客厅漫游', data: { version: 1, scenes: [] }, assets: ['fid_a', 'fid_b'],
  }));
  check('创建快照', r.status === 200 && r.json.snapshot.rev === 1, `${r.status} ${r.text.slice(0, 120)}`);
  const snapId = r.json?.snapshot?.id;
  check('快照记录素材数', r.json?.snapshot?.assetsCount === 2, r.json?.snapshot?.assetsCount);

  r = await call('POST', '/editor-api/snapshots', JSON.stringify({
    name: '缺素材', data: {}, assets: ['fid_a', 'fid_missing'],
  }));
  check('未入库素材被拒 400', r.status === 400 && Array.isArray(r.json?.missing) && r.json.missing[0] === 'fid_missing',
    `${r.status} ${r.text.slice(0, 120)}`);

  r = await call('PUT', `/editor-api/snapshots/${snapId}`, JSON.stringify({
    name: '客厅漫游 v2', data: { version: 1, scenes: [{ id: 's1' }] }, assets: ['fid_a'], rev: 1,
  }));
  check('基线正确保存 rev→2', r.status === 200 && r.json.snapshot.rev === 2, `${r.status} ${r.text.slice(0, 120)}`);

  r = await call('PUT', `/editor-api/snapshots/${snapId}`, JSON.stringify({
    name: '旧基线', data: {}, assets: ['fid_a'], rev: 1,
  }));
  check('过期基线 → 409', r.status === 409 && r.json.conflict === true && r.json.rev === 2,
    `${r.status} ${r.text.slice(0, 120)}`);

  r = await call('GET', `/editor-api/snapshots/${snapId}`);
  check('读取快照含 data 与 assets', r.status === 200 && r.json.snapshot.data && r.json.snapshot.assets.length === 1,
    `${r.status}`);

  r = await call('GET', '/editor-api/snapshots');
  check('快照列表', r.status === 200 && r.json.items.length === 1, `${r.status} count=${r.json?.items?.length}`);

  // ============ 剪辑素材视图 ============
  r = await call('GET', '/editor-api/clip-assets');
  const item = (r.json?.items || []).find((x) => x.fid === 'fid_a');
  check('剪辑素材按引用归集', r.status === 200 && item && Number(item.used_by) === 1,
    `${r.status} ${JSON.stringify(item)}`);

  r = await call('GET', '/editor-api/clip-assets/usage?fid=fid_a');
  check('素材使用方查询', r.status === 200 && r.json.items.length === 1 && r.json.items[0].id === snapId,
    `${r.status} ${r.text.slice(0, 120)}`);

  // ============ M3 资源包 ============
  const packsRoot = path.join(dataDir, 'clip-packs');
  const goodDir = path.join(packsRoot, 'com.mls.effect.glow');
  fs.mkdirSync(goodDir, { recursive: true });
  fs.writeFileSync(path.join(goodDir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, id: 'com.mls.effect.glow', type: 'effect',
    name: { zh: '发光' }, version: '1.0.0',
    params: [{ key: 'intensity', type: 'number', default: 0.5, min: 0, max: 1, label: { zh: '强度' } }],
    render: { passes: [{ shader: 'glow.wgsl', uniforms: { uIntensity: '$intensity' } }] },
    license: { type: 'internal', source: '自研' },
  }, null, 2));
  fs.writeFileSync(path.join(goodDir, 'glow.wgsl'), 'fn main() {}');

  const badDir = path.join(packsRoot, 'com.mls.effect.broken');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, id: 'wrong.id', type: 'effect', name: { zh: '' }, version: '1',
    license: { type: 'mystery', source: '' },
  }));

  r = await call('POST', '/editor-api/packs/reload', '{}');
  check('扫描：1 个通过 1 个拒绝', r.status === 200 && r.json.total === 2 && r.json.failed === 1,
    `${r.status} ${r.text.slice(0, 200)}`);
  const broken = (r.json?.results || []).find((x) => x.id === 'com.mls.effect.broken');
  check('拒绝原因可读', broken && broken.errors.length >= 4, JSON.stringify(broken?.errors));

  r = await call('GET', '/editor-api/packs');
  check('只返回启用包', r.status === 200 && r.json.items.length === 1 && r.json.items[0].id === 'com.mls.effect.glow',
    `${r.status} ${r.text.slice(0, 160)}`);

  r = await call('GET', '/editor-api/packs/com.mls.effect.glow/file?path=glow.wgsl');
  check('包内文件可读', r.status === 200 && r.text.includes('fn main'), `${r.status} ${r.text.slice(0, 60)}`);

  r = await call('GET', '/editor-api/packs/com.mls.effect.glow/file?path=../../material.db');
  check('路径穿越被拒', r.status === 400, `${r.status} ${r.text.slice(0, 80)}`);

  // ============ M4 AI 任务 ============
  r = await call('GET', '/editor-api/ai/capabilities');
  check('能力探测：无 runner 时 ready=false', r.status === 200 && r.json.items.every((x) => x.ready === false),
    `${r.status} ${r.text.slice(0, 160)}`);

  r = await call('POST', '/editor-api/ai/jobs', JSON.stringify({ type: 'nope', fid: 'fid_a' }));
  check('非法类型 400', r.status === 400, `${r.status} ${r.text.slice(0, 80)}`);

  r = await call('POST', '/editor-api/ai/jobs', JSON.stringify({ type: 'subtitle', fid: 'fid_missing' }));
  check('素材不存在 404', r.status === 404, `${r.status} ${r.text.slice(0, 80)}`);

  // 无 runner：任务应失败并给出明确原因
  r = await call('POST', '/editor-api/ai/jobs', JSON.stringify({ type: 'subtitle', fid: 'fid_a' }));
  const failJobId = r.json?.job?.id;
  check('创建 AI 任务为 pending', r.status === 200 && r.json.job.status === 'pending', `${r.status} ${r.text.slice(0, 120)}`);
  await sleep(2600);
  r = await call('GET', `/editor-api/ai/jobs/${failJobId}`);
  check('缺 runner 时明确失败', r.json?.job?.status === 'failed' && /引擎未配置/.test(r.json.job.error),
    `${r.json?.job?.status} ${r.json?.job?.error?.slice(0, 80)}`);

  // 放一个假 runner：产出文件 + 结构化结果
  const runners = path.join(dataDir, 'clip-ai-runners');
  fs.mkdirSync(runners, { recursive: true });
  fs.writeFileSync(path.join(runners, 'subtitle.js'), `
    module.exports = async ({ inputPath, outputDir, onProgress }) => {
      onProgress(50, '识别中');
      const out = require('path').join(outputDir, 'subtitle.srt');
      require('fs').writeFileSync(out, '1\\n00:00:00,000 --> 00:00:01,000\\n你好\\n');
      return { result: { segments: [{ start: 0, end: 1, text: '你好' }] }, outputPath: out };
    };
  `);

  r = await call('POST', '/editor-api/ai/jobs', JSON.stringify({ type: 'subtitle', fid: 'fid_a' }));
  const okJobId = r.json?.job?.id;
  await sleep(2600);
  r = await call('GET', `/editor-api/ai/jobs/${okJobId}`);
  check('有 runner 时任务完成', r.json?.job?.status === 'done' && r.json.job.progress === 100,
    `${r.json?.job?.status} ${r.json?.job?.error?.slice(0, 80)}`);
  check('返回结构化结果', r.json?.job?.result?.segments?.[0]?.text === '你好',
    JSON.stringify(r.json?.job?.result));

  r = await call('GET', `/editor-api/ai/jobs/${okJobId}/output`);
  check('产出文件可下载', r.status === 200 && r.text.includes('你好'), `${r.status} ${r.text.slice(0, 60)}`);

  r = await call('GET', '/editor-api/ai/jobs?fid=fid_a');
  check('按素材查任务', r.status === 200 && r.json.items.length >= 2, `${r.status} count=${r.json?.items?.length}`);

  // ============ 删除 ============
  r = await call('DELETE', `/editor-api/snapshots/${snapId}`);
  check('删除快照', r.status === 200, `${r.status}`);
  r = await call('GET', '/editor-api/clip-assets');
  check('删除后剪辑素材清空', r.status === 200 && r.json.items.length === 0, `${r.status} count=${r.json?.items?.length}`);

  server.close();

  console.log('\n=== 剪辑新增接口回归 ===');
  let fail = 0;
  for (const x of results) {
    if (!x.pass) fail += 1;
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}   [${x.detail.slice(0, 150)}]`);
  }
  console.log(`\n合计 ${results.length} 项，失败 ${fail} 项`);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
