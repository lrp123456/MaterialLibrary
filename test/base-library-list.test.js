/**
 * PR3 单元测试：基础属性库 Schema、只读列表与模型门禁
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_ba_list_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_secret_ba';
process.env.ML_VIEWER_PASS = 'viewer_secret_ba';

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

const adminLogin = auth.login(db, 'admin', 'admin_secret_ba');
const adminToken = adminLogin.token;

const viewer = auth.createUser(db, { username: 'designer_ba_1', password: 'pwd', role: 'viewer' });
const viewerLogin = auth.login(db, 'designer_ba_1', 'pwd');
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
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw, buffer: Buffer.concat(chunks) });
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
    console.log('=== 1. 测试未登录拦截 ===');
    const anonTax = await request('GET', '/api/base-library/taxonomy');
    assert.strictEqual(anonTax.status, 401);
    const anonMat = await request('GET', '/api/base-library/materials');
    assert.strictEqual(anonMat.status, 401);
    const anonPaint = await request('GET', '/api/base-library/paints');
    assert.strictEqual(anonPaint.status, 401);
    const anonLight = await request('GET', '/api/base-library/lights');
    assert.strictEqual(anonLight.status, 401);
    const anonModel = await request('GET', '/api/base-library/models');
    assert.strictEqual(anonModel.status, 401);
    const anonSlots = await request('GET', '/api/base-library/preset-slots');
    assert.strictEqual(anonSlots.status, 401);
    console.log('✅ 未登录拦截通过');

    console.log('=== 2. 测试分类法 GET /api/base-library/taxonomy ===');
    const taxRes = await request('GET', '/api/base-library/taxonomy', null, viewerToken);
    assert.strictEqual(taxRes.status, 200);
    assert.strictEqual(taxRes.body.success, true);
    assert.strictEqual(taxRes.body.data.surfaces.length, 8);
    const keys = taxRes.body.data.surfaces.map(s => s.key);
    assert.ok(keys.includes('ceiling'));
    assert.ok(keys.includes('wall'));
    assert.ok(keys.includes('floor'));
    assert.ok(keys.includes('millwork'));
    assert.ok(keys.includes('furniture'));
    assert.ok(keys.includes('soft'));
    assert.ok(keys.includes('lighting'));
    assert.ok(keys.includes('fixture'));
    console.log('✅ 分类法 8 装修面结构完整');

    console.log('=== 3. 测试材质列表与底色大图 (含 ?token= 提取) ===');
    // 创建测试材质文件
    const matRel = path.posix.join('cache', 'base-library', 'materials', 'mat_test_01', 'basecolor.jpg');
    const fullMatPath = path.resolve(testDir, matRel);
    fs.mkdirSync(path.dirname(fullMatPath), { recursive: true });
    fs.writeFileSync(fullMatPath, Buffer.from('fake-jpeg-data'));

    const now = Date.now();
    db.prepare(`
      INSERT INTO ba_materials (id, name_cn, source, source_id, license_note, is_shell, basecolor_rel, width, height, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('mat_test_01', '极简胡桃木', 'polyhaven', 'wood_01', 'Poly Haven, CC0', 0, matRel, 1024, 1024, now, now);

    db.prepare(`
      INSERT INTO ba_asset_tags (asset_kind, asset_id, surface, subclass)
      VALUES (?, ?, ?, ?)
    `).run('material', 'mat_test_01', 'floor', 'floor_wood');

    const matList = await request('GET', '/api/base-library/materials?surface=floor&subclass=floor_wood', null, viewerToken);
    assert.strictEqual(matList.status, 200);
    assert.strictEqual(matList.body.data.length, 1);
    assert.strictEqual(matList.body.data[0].id, 'mat_test_01');
    assert.strictEqual(matList.body.data[0].tags[0].subclass, 'floor_wood');
    assert.strictEqual(matList.body.data[0].credit, 'Poly Haven, CC0');

    // 测试带 ?token= 且不带 Authorization 的 GET
    const imgGet = await request('GET', `/api/base-library/materials/mat_test_01/basecolor?token=${viewerToken}`);
    assert.strictEqual(imgGet.status, 200);
    assert.strictEqual(imgGet.headers['content-type'], 'image/jpeg');
    console.log('✅ 材质列表与底色大图查询及 ?token= 通过');

    console.log('=== 4. 测试色号列表与本地色块 (含 ?token= 提取) ===');
    db.prepare(`
      INSERT INTO ba_paints (id, brand, code, name_en, name_zh, hex, interior, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('paint_nippon_NN001', 'nippon-paint', 'NN001', 'Classic White', '经典白', '#FAFAFA', 1, 1, now, now);

    const paintList = await request('GET', '/api/base-library/paints?brand=nippon-paint', null, viewerToken);
    assert.strictEqual(paintList.status, 200);
    assert.strictEqual(paintList.body.data.length, 1);
    assert.strictEqual(paintList.body.data[0].code, 'NN001');
    assert.strictEqual(paintList.body.data[0].pinned, true);

    const swatchGet = await request('GET', `/api/base-library/paints/paint_nippon_NN001/swatch?token=${viewerToken}`);
    assert.strictEqual(swatchGet.status, 200);
    assert.strictEqual(swatchGet.headers['content-type'], 'image/png');
    assert.ok(swatchGet.buffer.length > 0, '生成的色块 buffer 必须大于 0');
    console.log('✅ 色号列表与动态色块生成通过');

    console.log('=== 5. 测试灯具预设五档光向与色温 ===');
    const lightsRes = await request('GET', '/api/base-library/lights', null, viewerToken);
    assert.strictEqual(lightsRes.status, 200);
    assert.strictEqual(lightsRes.body.data.directions.length, 5);
    assert.strictEqual(lightsRes.body.data.ccts.length, 5);
    assert.strictEqual(lightsRes.body.data.directions[0].id, 'dir_left');
    assert.strictEqual(lightsRes.body.data.ccts[0].kelvin, 2700);
    console.log('✅ 灯具预设五档方向与色温通过');

    console.log('=== 6. 测试模型库空态与 409 拦截 ===');
    const modelGet = await request('GET', '/api/base-library/models', null, viewerToken);
    assert.strictEqual(modelGet.status, 200);
    assert.deepStrictEqual(modelGet.body.data, []);
    assert.strictEqual(modelGet.body.notice, '这一版不替换模型');

    const modelPost = await request('POST', '/api/base-library/models', { name: '模型' }, viewerToken);
    assert.strictEqual(modelPost.status, 409);
    assert.strictEqual(modelPost.body.notice, '这一版不替换模型');
    console.log('✅ 模型库空态与 POST 409 门禁通过');

    console.log('=== 7. 测试芯片预设插槽 ===');
    const slotsRes = await request('GET', '/api/base-library/preset-slots', null, viewerToken);
    assert.strictEqual(slotsRes.status, 200);
    assert.strictEqual(slotsRes.body.data.length, 6);
    const slotKeys = slotsRes.body.data.map(s => s.id);
    assert.ok(slotKeys.includes('micro_cement'));
    assert.ok(slotKeys.includes('walnut_wood'));
    console.log('✅ 芯片预设插槽通过');

    console.log('\n🎉 PR3 base-library-list 全部测试无缝通过！');
  } finally {
    if (server) server.close();
  }
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
