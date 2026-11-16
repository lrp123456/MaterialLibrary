/**
 * 创作库私有文件副本、创作库回收与分区功能测试
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_media_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_secret_media';
process.env.ML_VIEWER_PASS = 'viewer_secret_media';
process.env.ML_SKIP_CREATION_BACKFILL = '1';

const { openDb } = require('../src/db');
const { handleApi } = require('../src/api');
const auth = require('../src/auth');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const {
  ensureCreationLibrarySchema,
  backfillCreationMedia,
  mediaDirFor,
} = require('../src/creation-library');

const db = openDb(testDir);
const services = {
  db,
  config: { dataDir: testDir },
  logger: { info: () => {}, error: () => {}, warn: () => {} }
};

ensureBaseLibrarySchema(db);
ensureCreationLibrarySchema(db);

const adminLogin = auth.login(db, 'admin', 'admin_secret_media');
assert.ok(adminLogin && adminLogin.token);
const adminToken = adminLogin.token;

const user1 = auth.createUser(db, { username: 'media_user_1', password: 'media_pass_1', role: 'viewer' });
const user1Login = auth.login(db, 'media_user_1', 'media_pass_1');
assert.ok(user1Login && user1Login.token);
const user1Token = user1Login.token;

let server;
let serverPort;

function request(method, pathStr, bodyObj = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: serverPort,
      path: pathStr,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  server = http.createServer((req, res) => {
    handleApi(services, req, res, '/api').catch(err => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    serverPort = server.address().port;
    resolve();
  }));

  try {
    console.log('=== 1. 分区 CRUD 与排序测试 ===');
    // 创建分区
    const sec1Res = await request('POST', '/api/creation-sections', { name: '现代空间' }, user1Token);
    assert.strictEqual(sec1Res.status, 200);
    const sec1 = sec1Res.body.data;
    assert.strictEqual(sec1.name, '现代空间');
    assert.ok(sec1.id);

    const sec2Res = await request('POST', '/api/creation-sections', { name: '复古意境' }, user1Token);
    assert.strictEqual(sec2Res.status, 200);
    const sec2 = sec2Res.body.data;

    // 获取分区列表
    const listSecRes = await request('GET', '/api/creation-sections', null, user1Token);
    assert.strictEqual(listSecRes.status, 200);
    assert.strictEqual(listSecRes.body.data.length, 2);

    // 重命名分区
    const renSecRes = await request('PATCH', `/api/creation-sections/${sec1.id}`, { name: '极简空间' }, user1Token);
    assert.strictEqual(renSecRes.status, 200);
    assert.strictEqual(renSecRes.body.data.name, '极简空间');

    // 重排分区
    const reorderSecRes = await request('PUT', '/api/creation-sections/order', { ids: [sec2.id, sec1.id] }, user1Token);
    assert.strictEqual(reorderSecRes.status, 200);

    console.log('=== 2. 创建配方：自动复制到私有目录并改写 URL ===');
    // 在 cache/temp 准备临时文件
    const tempDir = path.join(testDir, 'cache', 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const tempOrigin = path.join(tempDir, 'temp_origin_0.png');
    fs.writeFileSync(tempOrigin, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // PNG magic

    // fake data: URL
    const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const tplPayload = {
      title: '奶油风客厅重构',
      prompt: '将毛坯房改造成温暖奶油风客厅',
      type: 'image',
      aspect_ratio: '16:9',
      origin_images: [{ url: '/api/cache/temp/temp_origin_0.png' }],
      result_images: [{ url: fakeDataUrl }]
    };

    const createTplRes = await request('POST', '/api/creation-templates', tplPayload, user1Token);
    assert.strictEqual(createTplRes.status, 200);
    const tpl = createTplRes.body.data;
    assert.ok(tpl.id);
    assert.ok(tpl.origin_images[0].url.startsWith(`/api/creation-templates/${encodeURIComponent(tpl.id)}/media/origin/0`));
    assert.ok(tpl.result_images[0].url.startsWith(`/api/creation-templates/${encodeURIComponent(tpl.id)}/media/result/0`));

    // 检查私有文件落盘
    const mediaDir = mediaDirFor(services, tpl.id);
    assert.ok(fs.existsSync(mediaDir), '私有文件目录应存在');
    assert.ok(fs.existsSync(path.join(mediaDir, 'origin', '0.png')), '私有原图应落盘');
    assert.ok(fs.existsSync(path.join(mediaDir, 'result', '0.png')), '私有产物图应落盘');

    // 检查通过媒体端点读取
    const readMediaRes = await request('GET', tpl.origin_images[0].url, null, user1Token);
    assert.strictEqual(readMediaRes.status, 200);
    assert.strictEqual(readMediaRes.headers['content-type'], 'image/png');

    console.log('=== 3. 素材库隔离性验证：GET /api/assets 绝不出现私有副本 ===');
    const assetsRes = await request('GET', '/api/assets', null, user1Token);
    assert.strictEqual(assetsRes.status, 200);
    const assetItems = assetsRes.body.data?.items || [];
    assert.ok(assetItems.every(a => !String(a.file_path || '').includes('creation-library')), '素材库中不得包含配方私有副本');

    console.log('=== 4. 分区归属与置顶顺序测试 ===');
    // 把作品放到 sec2 ('复古意境')
    const placeRes = await request('PATCH', `/api/creation-templates/${tpl.id}`, { section_id: sec2.id }, user1Token);
    assert.strictEqual(placeRes.status, 200);
    assert.strictEqual(placeRes.body.data.section_id, sec2.id);
    assert.strictEqual(placeRes.body.data.is_pinned, 1);

    // 批量重排模板在分区中的顺序
    const reorderTplRes = await request('PUT', '/api/creation-templates/section-order', {
      section_id: sec2.id,
      ids: [tpl.id]
    }, user1Token);
    assert.strictEqual(reorderTplRes.status, 200);

    console.log('=== 5. 软删进入创作库回收、整包恢复与彻底清空 ===');
    // 删除配方
    const delRes = await request('DELETE', `/api/creation-templates/${tpl.id}`, null, user1Token);
    assert.strictEqual(delRes.status, 200);

    // 正常列表查不到
    const listAfterDel = await request('GET', '/api/creation-templates', null, user1Token);
    assert.ok(listAfterDel.body.data.every(t => t.id !== tpl.id));

    // 回收列表中能查到
    const trashRes = await request('GET', '/api/creation-trash', null, user1Token);
    assert.strictEqual(trashRes.status, 200);
    const trashItem = trashRes.body.data.find(t => t.id === tpl.id);
    assert.ok(trashItem, '回收中应包含被删除的配方');
    assert.strictEqual(trashItem.section_name, '复古意境');

    // 软删期间，私有文件仍然保留
    assert.ok(fs.existsSync(mediaDir), '软删后私有目录必须保留');

    // 整包恢复
    const restoreRes = await request('POST', '/api/creation-trash/restore', { ids: [tpl.id] }, user1Token);
    assert.strictEqual(restoreRes.status, 200);

    // 恢复后正常列表重新出现，且分区与置顶正确
    const listAfterRestore = await request('GET', '/api/creation-templates', null, user1Token);
    const restored = listAfterRestore.body.data.find(t => t.id === tpl.id);
    assert.ok(restored, '恢复后应重新出现在列表中');
    assert.strictEqual(restored.section_id, sec2.id);
    assert.strictEqual(restored.is_pinned, 1);

    // 删除分区时，分区内作品回到未分区但依然置顶
    const delSecRes = await request('DELETE', `/api/creation-sections/${sec2.id}`, null, user1Token);
    assert.strictEqual(delSecRes.status, 200);

    const listAfterSecDel = await request('GET', '/api/creation-templates', null, user1Token);
    const tplAfterSecDel = listAfterSecDel.body.data.find(t => t.id === tpl.id);
    assert.strictEqual(tplAfterSecDel.section_id, null, '删区后作品回到未分区');
    assert.strictEqual(tplAfterSecDel.is_pinned, 1, '作品依然置顶');

    // 再次删除配方并彻底 purge
    await request('DELETE', `/api/creation-templates/${tpl.id}`, null, user1Token);
    const purgeRes = await request('POST', '/api/creation-trash/purge', { ids: [tpl.id] }, user1Token);
    assert.strictEqual(purgeRes.status, 200);

    // purge 后数据库行和磁盘私有文件均消失
    const checkRow = db.prepare('SELECT * FROM creation_templates WHERE id=?').get(tpl.id);
    assert.strictEqual(checkRow, undefined, 'purge 后数据库行必须删除');
    assert.strictEqual(fs.existsSync(mediaDir), false, 'purge 后私有文件目录必须彻底删除');

    console.log('=== 6. 存量补拷 backfillCreationMedia 测试 ===');
    // 插入一条 media_dir 为空的存量记录
    const legacyId = 'legacy_tpl_99';
    const legacyOriginPath = path.join(tempDir, 'legacy_orig.png');
    fs.writeFileSync(legacyOriginPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    db.prepare(`
      INSERT INTO creation_templates (id, user_id, title, prompt, origin_images, result_images, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      legacyId,
      user1.id,
      '存量配方测试',
      '提示词',
      JSON.stringify([{ url: '/api/cache/temp/legacy_orig.png' }]),
      JSON.stringify([]),
      Date.now(),
      Date.now()
    );

    const backfillRes = await backfillCreationMedia(services, { limit: 10 });
    assert.strictEqual(backfillRes.scanned, 1);
    assert.strictEqual(backfillRes.copied, 1);

    const legacyRow = db.prepare('SELECT * FROM creation_templates WHERE id=?').get(legacyId);
    assert.ok(legacyRow.media_dir, '补拷后 media_dir 应被标记');
    const legacyParsedOrigin = JSON.parse(legacyRow.origin_images);
    assert.ok(legacyParsedOrigin[0].url.startsWith(`/api/creation-templates/${encodeURIComponent(legacyId)}/media/origin/0`));

    console.log('🎉 creation-library-media 所有用例测试通过！');
  } finally {
    if (server) server.close();
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  }
}

runTests().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
