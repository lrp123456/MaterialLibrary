/**
 * PR5 单元测试：材质来源搜索校验、视觉预填草稿、底色壳与确认入库
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const sharp = require('sharp');

const testDir = path.join(os.tmpdir(), 'dsh_ba_prefill_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_prefill_pass';
process.env.ML_VIEWER_PASS = 'viewer_prefill_pass';

const { openDb } = require('../src/db');
const { handleApi } = require('../src/api');
const auth = require('../src/auth');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');

const db = openDb(testDir);
ensureBaseLibrarySchema(db);

const services = {
  db,
  config: { dataDir: testDir },
  logger: { info: () => {}, error: () => {}, warn: () => {} }
};

const adminLogin = auth.login(db, 'admin', 'admin_prefill_pass');
const adminToken = adminLogin.token;

const viewer = auth.createUser(db, { username: 'designer_prefill_1', password: 'pwd', role: 'viewer' });
const viewerLogin = auth.login(db, 'designer_prefill_1', 'pwd');
const viewerToken = viewerLogin.token;

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
    console.log('=== 1. 测试搜索类别约束 (禁止内部子类键) ===');
    // 传分类法子类键 -> 400
    const forbidSubclass = await request('POST', '/api/base-library/materials/search', {
      source: 'ambientcg',
      category: 'floor_wood'
    }, adminToken);
    assert.strictEqual(forbidSubclass.status, 400, '使用内部子类键 floor_wood 必须 400');

    // 传非法来源 category -> 400
    const forbidCat = await request('POST', '/api/base-library/materials/search', {
      source: 'ambientcg',
      category: 'invalid_category_xyz'
    }, adminToken);
    assert.strictEqual(forbidCat.status, 400);

    // 普通用户无权搜索收录
    const viewerSearch = await request('POST', '/api/base-library/materials/search', {
      source: 'polyhaven',
      q: 'wood'
    }, viewerToken);
    assert.strictEqual(viewerSearch.status, 403);
    console.log('✅ 搜索参数校验与权限门禁通过');

    console.log('=== 2. 测试草稿与确认入库 (带合法标签) ===');
    const { createMaterialDraft, confirmMaterialDraft } = require('../src/base-library/drafts');
    // 生成一张 1024x1024 纯色 JPEG
    const testBuf = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: { r: 120, g: 90, b: 60 } }
    }).jpeg().toBuffer();

    const draftRes = await createMaterialDraft(services, {
      source: 'polyhaven',
      sourceId: 'wood_floor_001',
      title: 'Wood Floor 001',
      buffer: testBuf
    });
    assert.ok(draftRes.draft_id);
    assert.strictEqual(draftRes.width, 1024);

    // 确认入库：名字为空报错 400
    const failName = await request('POST', '/api/base-library/materials/confirm', {
      draft_id: draftRes.draft_id,
      name_cn: '',
      tags: [{ surface: 'floor', subclass: 'floor_wood' }]
    }, adminToken);
    assert.strictEqual(failName.status, 400);

    // 确认入库：非壳且标签为空报错 400
    const failTags = await request('POST', '/api/base-library/materials/confirm', {
      draft_id: draftRes.draft_id,
      name_cn: '白橡木人字拼',
      tags: [],
      is_shell: 0
    }, adminToken);
    assert.strictEqual(failTags.status, 400);

    // 正常确认入库
    const okConfirm = await request('POST', '/api/base-library/materials/confirm', {
      draft_id: draftRes.draft_id,
      name_cn: '白橡木人字拼',
      tags: [{ surface: 'floor', subclass: 'floor_wood' }],
      is_shell: 0
    }, adminToken);
    assert.strictEqual(okConfirm.status, 200);
    assert.strictEqual(okConfirm.body.data.name_cn, '白橡木人字拼');
    assert.ok(okConfirm.body.data.id.startsWith('mat_'));

    // 入库后列表中可见
    const matList = await request('GET', '/api/base-library/materials?subclass=floor_wood', null, viewerToken);
    assert.strictEqual(matList.status, 200);
    assert.ok(matList.body.data.some(m => m.name_cn === '白橡木人字拼'));
    console.log('✅ 草稿生成与正常确认入库通过');

    console.log('=== 3. 测试底色壳确认入库 (is_shell=1 允许零条标签) ===');
    const shellDraft = await createMaterialDraft(services, {
      source: 'manual',
      sourceId: 'shell_cement_01',
      title: '水泥微水泥壳',
      buffer: testBuf,
      isManual: true,
      attestSwatch: true
    });

    const shellConfirm = await request('POST', '/api/base-library/materials/confirm', {
      draft_id: shellDraft.draft_id,
      name_cn: '通用微水泥共用壳',
      tags: [],
      is_shell: 1
    }, adminToken);
    assert.strictEqual(shellConfirm.status, 200);
    assert.strictEqual(shellConfirm.body.data.is_shell, true);
    assert.deepStrictEqual(shellConfirm.body.data.tags, []);
    console.log('✅ is_shell=1 允许零条标签通过');

    console.log('\n🎉 PR5 base-library-prefill 全部测试通过！');
  } finally {
    if (server) server.close();
  }
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
