/**
 * PR3 单元测试：基础属性库 Flags 开关与色号库降级行为
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_ba_flags_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_flags_pass';
process.env.ML_VIEWER_PASS = 'viewer_flags_pass';

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

const adminLogin = auth.login(db, 'admin', 'admin_flags_pass');
const adminToken = adminLogin.token;

const viewer = auth.createUser(db, { username: 'designer_flags_1', password: 'pwd', role: 'viewer' });
const viewerLogin = auth.login(db, 'designer_flags_1', 'pwd');
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
    console.log('=== 1. 测试默认 flags 配置 ===');
    const flagsRes = await request('GET', '/api/base-library/flags', null, viewerToken);
    assert.strictEqual(flagsRes.status, 200);
    const flags = flagsRes.body.data;
    assert.strictEqual(flags.base_library_paints, 1);
    assert.strictEqual(flags.base_library_jev, 0);
    assert.strictEqual(flags.base_library_compile, 0);
    assert.strictEqual(flags.creation_tpl_incremental, 1);
    assert.strictEqual(flags.base_library_write, 1);
    console.log('✅ 默认 flags 正确');

    console.log('=== 2. 测试普通用户修改 flag -> 403 ===');
    const forbidPut = await request('PUT', '/api/base-library/flags/base_library_paints', { value: 0 }, viewerToken);
    assert.strictEqual(forbidPut.status, 403);
    console.log('✅ 普通用户修改被 403 拦截');

    console.log('=== 3. 测试管理员关闭 base_library_paints ===');
    const now = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO ba_paints (id, brand, code, name_en, hex, interior, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('paint_test_flag', 'nippon-paint', 'NN999', 'Test Gray', '#888888', 1, 1, now, now);

    // 管理员设为 0
    const putRes = await request('PUT', '/api/base-library/flags/base_library_paints', { value: 0 }, adminToken);
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.data.value, 0);

    // 关闭后色号列表返回空
    const pListClosed = await request('GET', '/api/base-library/paints', null, viewerToken);
    assert.strictEqual(pListClosed.status, 200);
    assert.deepStrictEqual(pListClosed.body.data, []);

    // 关闭后 swatch 请求返回 404
    const swatchClosed = await request('GET', '/api/base-library/paints/paint_test_flag/swatch', null, viewerToken);
    assert.strictEqual(swatchClosed.status, 404);
    assert.strictEqual(swatchClosed.body.error, '色号库未启用');
    console.log('✅ 色号标志关闭行为验证通过');

    console.log('=== 4. 测试重新开启 base_library_paints ===');
    const putOpen = await request('PUT', '/api/base-library/flags/base_library_paints', { value: 1 }, adminToken);
    assert.strictEqual(putOpen.status, 200);
    assert.strictEqual(putOpen.body.data.value, 1);

    const pListOpen = await request('GET', '/api/base-library/paints', null, viewerToken);
    assert.strictEqual(pListOpen.status, 200);
    assert.strictEqual(pListOpen.body.data.length, 1);
    assert.strictEqual(pListOpen.body.data[0].code, 'NN999');

    const swatchOpen = await request('GET', '/api/base-library/paints/paint_test_flag/swatch', null, viewerToken);
    assert.strictEqual(swatchOpen.status, 200);
    assert.strictEqual(swatchOpen.headers['content-type'], 'image/png');
    console.log('✅ 色号标志重新开启恢复正常');

    console.log('\n🎉 PR3 base-library-flags 全部测试无缝通过！');
  } finally {
    if (server) server.close();
  }
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
