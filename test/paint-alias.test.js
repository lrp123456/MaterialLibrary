/**
 * PR6 单元测试：色号别名更新与 shell_material_id 底色壳约束
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_paint_alias_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_alias_pass';
process.env.ML_VIEWER_PASS = 'viewer_alias_pass';

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

const adminLogin = auth.login(db, 'admin', 'admin_alias_pass');
const adminToken = adminLogin.token;

const viewer = auth.createUser(db, { username: 'designer_alias_1', password: 'pwd', role: 'viewer' });
const viewerLogin = auth.login(db, 'designer_alias_1', 'pwd');
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
    console.log('=== 1. 初始化色号与测试材质 ===');
    const now = Date.now();
    const paintId = 'paint_nippon_NP001';
    db.prepare(`
      INSERT INTO ba_paints (id, brand, code, name_en, name_zh, hex, interior, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(paintId, 'nippon-paint', 'NP001', 'Warm Beige', '暖调米色', '#E8DFD8', 1, 0, now, now);

    // 一张普通非壳材质
    db.prepare(`
      INSERT INTO ba_materials (id, name_cn, source, is_shell, basecolor_rel, width, height, created_at, updated_at)
      VALUES ('mat_normal', '橡木板', 'manual', 0, 'none.jpg', 1024, 1024, ?, ?)
    `).run(now, now);

    // 一张底色壳材质
    db.prepare(`
      INSERT INTO ba_materials (id, name_cn, source, is_shell, basecolor_rel, width, height, created_at, updated_at)
      VALUES ('mat_shell', '乳胶漆纹理壳', 'manual', 1, 'none.jpg', 1024, 1024, ?, ?)
    `).run(now, now);

    console.log('=== 2. 测试普通用户 PATCH 色号 -> 403 ===');
    const userPatch = await request('PATCH', `/api/base-library/paints/${paintId}`, {
      alias_zh: '小红书热门可可蛋奶'
    }, viewerToken);
    assert.strictEqual(userPatch.status, 403);
    console.log('✅ 普通用户修改 403 拦截通过');

    console.log('=== 3. 测试 shell_material_id 底色壳约束 (400 校验) ===');
    // 指向不存在的材质 -> 400
    const nonExistShell = await request('PATCH', `/api/base-library/paints/${paintId}`, {
      shell_material_id: 'mat_not_found'
    }, adminToken);
    assert.strictEqual(nonExistShell.status, 400);

    // 指向 is_shell=0 的普通材质 -> 400
    const notShell = await request('PATCH', `/api/base-library/paints/${paintId}`, {
      shell_material_id: 'mat_normal'
    }, adminToken);
    assert.strictEqual(notShell.status, 400);

    // 指向 is_shell=1 的底色壳材质 -> 200
    const okShell = await request('PATCH', `/api/base-library/paints/${paintId}`, {
      alias_zh: '可可蛋奶',
      alt_code: 'OAT-01',
      pinned: true,
      shell_material_id: 'mat_shell'
    }, adminToken);
    assert.strictEqual(okShell.status, 200);
    assert.strictEqual(okShell.body.data.alias_zh, '可可蛋奶');
    assert.strictEqual(okShell.body.data.alt_code, 'OAT-01');
    assert.strictEqual(okShell.body.data.pinned, true);
    assert.strictEqual(okShell.body.data.shell_material_id, 'mat_shell');

    // 重新查库核实
    const checkDb = db.prepare('SELECT * FROM ba_paints WHERE id=?').get(paintId);
    assert.strictEqual(checkDb.alias_zh, '可可蛋奶');
    assert.strictEqual(checkDb.pinned, 1);
    assert.strictEqual(checkDb.shell_material_id, 'mat_shell');
    console.log('✅ shell_material_id 底色壳约束通过');

    console.log('\n🎉 PR6 paint-alias 测试通过！');
  } finally {
    if (server) server.close();
  }
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
