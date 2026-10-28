/**
 * PR1 单元测试：创作库模板 (creation-templates) 分行游标与删除墓碑
 * 验证目标：
 * 1. ensureBaseLibrarySchema 幂等 DDL（包含 poster_w/h、idx_creation_tpl_updated_id、creation_template_tombstones 及索引）
 * 2. GET 省略 since 时全量兼容查询，has_more 固定 false，不缺省为 since=0
 * 3. since/since_id 与 deleted_since/deleted_since_id 成对参数校验（400 since_id_required 等）
 * 4. 游标早于 90 天（含 since=0）触发 resync: true 并清理超期墓碑
 * 5. POST / PATCH 单调递增 updated_at
 * 6. PATCH 画幅在 poster_w IS NULL 时写入；已有 poster_w 时忽略且不改 updated_at
 * 7. DELETE 同事务写入墓碑，单调 deleted_at，SEC-007 拦截（403 不写墓碑）
 * 8. 增量谓词 (updated_at > t OR (updated_at = t AND id > lastId))，同毫秒记录不会漏掉
 * 9. 行游标与墓碑游标相互独立，不把墓碑时间当成行的游标
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_ct_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_secret_since';
process.env.ML_VIEWER_PASS = 'viewer_secret_since';

const { openDb } = require('../src/db');
const { handleApi } = require('../src/api');
const auth = require('../src/auth');
const { ensureBaseLibrarySchema, cleanupExpiredTombstones } = require('../src/base-library/schema');

const db = openDb(testDir);
const services = {
  db,
  config: { dataDir: testDir },
  logger: { info: () => {}, error: () => {}, warn: () => {} }
};

// 预备管理员与普通用户
const adminLogin = auth.login(db, 'admin', 'admin_secret_since');
assert.ok(adminLogin && adminLogin.token, '管理员登录应成功');
const adminToken = adminLogin.token;

const user1 = auth.createUser(db, { username: 'designer_since_1', password: 'pass_since_1', role: 'viewer' });
const user1Login = auth.login(db, 'designer_since_1', 'pass_since_1');
assert.ok(user1Login && user1Login.token, 'User1 登录应成功');
const user1Token = user1Login.token;

const user2 = auth.createUser(db, { username: 'designer_since_2', password: 'pass_since_2', role: 'viewer' });
const user2Login = auth.login(db, 'designer_since_2', 'pass_since_2');
assert.ok(user2Login && user2Login.token, 'User2 登录应成功');
const user2Token = user2Login.token;

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

  console.log(`测试 HTTP 服务已启动，端口: ${serverPort}`);

  try {
    console.log('=== 1. 测试 ensureBaseLibrarySchema 结构与幂等性 ===');
    ensureBaseLibrarySchema(db);
    const tableInfo = db.prepare("PRAGMA table_info(creation_templates)").all();
    const colNames = tableInfo.map(c => c.name);
    assert.ok(colNames.includes('poster_w'), 'creation_templates 应包含 poster_w');
    assert.ok(colNames.includes('poster_h'), 'creation_templates 应包含 poster_h');

    const tombTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='creation_template_tombstones'").get();
    assert.ok(tombTable, 'creation_template_tombstones 表应存在');

    const tombIdx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ct_tomb_deleted'").get();
    assert.ok(tombIdx, 'idx_ct_tomb_deleted 索引应存在');

    const tplIdx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_creation_tpl_updated_id'").get();
    assert.ok(tplIdx, 'idx_creation_tpl_updated_id 索引应存在');
    console.log('✅ Schema 与索引检查通过');

    console.log('=== 2. 测试鉴权拦截 ===');
    const anonGet = await request('GET', '/api/creation-templates');
    assert.strictEqual(anonGet.status, 401, '未登录 GET 应 401');
    const anonPost = await request('POST', '/api/creation-templates', { title: 'T', prompt: 'P' });
    assert.strictEqual(anonPost.status, 401, '未登录 POST 应 401');
    const anonPatch = await request('PATCH', '/api/creation-templates/any_id', { title: 'T' });
    assert.strictEqual(anonPatch.status, 401, '未登录 PATCH 应 401');
    const anonDel = await request('DELETE', '/api/creation-templates/any_id');
    assert.strictEqual(anonDel.status, 401, '未登录 DELETE 应 401');
    console.log('✅ 鉴权拦截通过');

    console.log('=== 3. 测试全量查询（省略 since） ===');
    // 清空现有数据以便测试
    db.prepare('DELETE FROM creation_templates').run();
    db.prepare('DELETE FROM creation_template_tombstones').run();

    const emptyFull = await request('GET', '/api/creation-templates', null, user1Token);
    assert.strictEqual(emptyFull.status, 200);
    assert.strictEqual(emptyFull.body.success, true);
    assert.deepStrictEqual(emptyFull.body.data, []);
    assert.strictEqual(emptyFull.body.has_more, false);
    assert.strictEqual(emptyFull.body.resync, false);
    assert.strictEqual(typeof emptyFull.body.next_since.updated_at, 'number');
    assert.strictEqual(emptyFull.body.next_since.id, '');
    assert.strictEqual(emptyFull.body.deleted_ids.length, 0);
    assert.strictEqual(emptyFull.body.deleted_has_more, false);
    assert.strictEqual(emptyFull.body.deleted_next, null);
    console.log('✅ 空库全量查询格式正确');

    console.log('=== 4. 测试参数成对校验 (400 校验) ===');
    const missingSinceId = await request('GET', '/api/creation-templates?since=12345', null, user1Token);
    assert.strictEqual(missingSinceId.status, 400);
    assert.strictEqual(missingSinceId.body.error, 'since_id_required');

    const missingDeletedSinceId = await request('GET', '/api/creation-templates?deleted_since=12345', null, user1Token);
    assert.strictEqual(missingDeletedSinceId.status, 400);
    assert.strictEqual(missingDeletedSinceId.body.error, 'deleted_since_id_required');
    console.log('✅ 成对游标参数校验通过');

    console.log('=== 5. 测试 90 天过期游标与 resync ===');
    // 写入一条超过 90 天的旧墓碑
    const oldTime = Date.now() - 95 * 24 * 60 * 60 * 1000;
    db.prepare('INSERT INTO creation_template_tombstones (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .run('old_tomb_95d', 1, oldTime);

    // since=0 属于 1970 年，远超 90 天，必须走 resync
    const resyncQuery = await request('GET', '/api/creation-templates?since=0&since_id=', null, user1Token);
    assert.strictEqual(resyncQuery.status, 200);
    assert.strictEqual(resyncQuery.body.resync, true);
    assert.deepStrictEqual(resyncQuery.body.data, []);
    assert.deepStrictEqual(resyncQuery.body.deleted_ids, []);

    // 验证超期旧墓碑在此时已被物理清理
    const oldTombCheck = db.prepare('SELECT * FROM creation_template_tombstones WHERE id=?').get('old_tomb_95d');
    assert.strictEqual(oldTombCheck, undefined, '超过 90 天的旧墓碑必须已被清理');
    console.log('✅ 90 天游标判定 resync 及超期清理通过');

    console.log('=== 6. 测试 POST 新建与单调递增 updated_at ===');
    const p1 = await request('POST', '/api/creation-templates', {
      id: 'tpl_alpha',
      title: '极简原木客厅',
      prompt: '摄影风格原木客厅设计'
    }, user1Token);
    assert.strictEqual(p1.status, 200);
    const u1 = p1.body.data.updated_at;

    const p2 = await request('POST', '/api/creation-templates', {
      id: 'tpl_beta',
      title: '侘寂风卧室',
      prompt: '微水泥墙面侘寂风'
    }, user1Token);
    assert.strictEqual(p2.status, 200);
    const u2 = p2.body.data.updated_at;

    assert.ok(u2 >= u1, `后写入的 updated_at (${u2}) 必须 >= 前者 (${u1})`);

    // 全量查询验证 next_since
    const fullRes = await request('GET', '/api/creation-templates', null, user1Token);
    assert.strictEqual(fullRes.body.data.length, 2);
    assert.strictEqual(fullRes.body.has_more, false);
    assert.strictEqual(fullRes.body.next_since.id, 'tpl_beta');
    console.log('✅ 单调写入与全量 next_since 检查通过');

    console.log('=== 7. 测试 PATCH 画幅回写约束与 SEC-007 ===');
    // 1) 非属主且非管理员修改他人配方 -> 403
    const forbiddenPatch = await request('PATCH', '/api/creation-templates/tpl_alpha', {
      title: '黑客修改'
    }, user2Token);
    assert.strictEqual(forbiddenPatch.status, 403, '非属主非管理员修改他人配方必须 403');

    // 2) 首次写入画幅（此时 poster_w IS NULL） -> 允许写入
    const patchAspect1 = await request('PATCH', '/api/creation-templates/tpl_alpha', {
      poster_w: 1080,
      poster_h: 1920,
      aspect_ratio: '9:16'
    }, user1Token);
    assert.strictEqual(patchAspect1.status, 200);
    assert.strictEqual(patchAspect1.body.data.poster_w, 1080);
    assert.strictEqual(patchAspect1.body.data.poster_h, 1920);
    assert.strictEqual(patchAspect1.body.data.aspect_ratio, '9:16');
    const uAfterAspect1 = patchAspect1.body.data.updated_at;

    // 3) 已有 poster_w 时再次尝试回写画幅 -> 服务端忽略画幅，且不修改 updated_at
    const patchAspect2 = await request('PATCH', '/api/creation-templates/tpl_alpha', {
      poster_w: 2000,
      poster_h: 3000,
      aspect_ratio: '1:1'
    }, user1Token);
    assert.strictEqual(patchAspect2.status, 200);
    assert.strictEqual(patchAspect2.body.data.poster_w, 1080, '已存在 poster_w 时不得覆盖原尺寸');
    assert.strictEqual(patchAspect2.body.data.poster_h, 1920);
    assert.strictEqual(patchAspect2.body.data.updated_at, uAfterAspect1, '仅尝试改画幅时已有 poster_w 不得改变 updated_at');
    console.log('✅ 画幅回写与 SEC-007 校验通过');

    console.log('=== 8. 测试 DELETE 同事务写墓碑与 SEC-007 ===');
    // 非属主尝试删除 -> 403，不生成墓碑
    const forbiddenDel = await request('DELETE', '/api/creation-templates/tpl_alpha', null, user2Token);
    assert.strictEqual(forbiddenDel.status, 403);
    const tombAfter403 = db.prepare('SELECT * FROM creation_template_tombstones WHERE id=?').get('tpl_alpha');
    assert.strictEqual(tombAfter403, undefined, '403 删除操作不得写入墓碑');

    // 属主合法删除 -> 200，并同事务写入墓碑
    const validDel = await request('DELETE', '/api/creation-templates/tpl_alpha', null, user1Token);
    assert.strictEqual(validDel.status, 200);
    const tombRow = db.prepare('SELECT * FROM creation_template_tombstones WHERE id=?').get('tpl_alpha');
    assert.ok(tombRow, '删除后墓碑记录必须存在');
    assert.strictEqual(tombRow.id, 'tpl_alpha');
    assert.strictEqual(Number(tombRow.user_id), user1.id);
    assert.ok(tombRow.deleted_at > 0);

    const checkTplDeleted = db.prepare('SELECT * FROM creation_templates WHERE id=?').get('tpl_alpha');
    assert.strictEqual(checkTplDeleted, undefined, '创作模板表中的记录必须已被物理删除');
    console.log('✅ DELETE 同事务写墓碑通过');

    console.log('=== 9. 测试同毫秒 (updated_at) 复合游标分页不丢数据 ===');
    // 构造三条相同 updated_at 的记录
    const fixedTs = Date.now() + 10000;
    db.prepare('DELETE FROM creation_templates').run();
    db.prepare('INSERT INTO creation_templates (id, user_id, title, prompt, updated_at) VALUES (?, 1, ?, ?, ?)')
      .run('tpl_same_1', '标题1', '提示1', fixedTs);
    db.prepare('INSERT INTO creation_templates (id, user_id, title, prompt, updated_at) VALUES (?, 1, ?, ?, ?)')
      .run('tpl_same_2', '标题2', '提示2', fixedTs);
    db.prepare('INSERT INTO creation_templates (id, user_id, title, prompt, updated_at) VALUES (?, 1, ?, ?, ?)')
      .run('tpl_same_3', '标题3', '提示3', fixedTs);

    // 第一页：since 从 fixedTs 且 since_id='tpl_same_1' 开始拉
    const deltaPage = await request(
      'GET',
      `/api/creation-templates?since=${fixedTs}&since_id=tpl_same_1`,
      null,
      user1Token
    );
    assert.strictEqual(deltaPage.status, 200);
    const returnedIds = deltaPage.body.data.map(d => d.id);
    assert.deepStrictEqual(returnedIds, ['tpl_same_2', 'tpl_same_3'], '同一毫秒排在 tpl_same_1 之后的行必须能被取到，不得因 > 漏掉');
    assert.strictEqual(deltaPage.body.next_since.id, 'tpl_same_3');
    assert.strictEqual(deltaPage.body.next_since.updated_at, fixedTs);
    console.log('✅ 同毫秒 (updated_at, id) 复合游标分页验证通过');

    console.log('=== 10. 测试双游标独立性 (墓碑新于行更新) ===');
    // 准备一个场景：
    // 行 tpl_row_update 的 updated_at 是 2000
    // 墓碑 tpl_old_tomb 的 deleted_at 是 5000
    const tsRow = Date.now() + 20000;
    const tsTomb = Date.now() + 50000;

    db.prepare('INSERT INTO creation_templates (id, user_id, title, prompt, updated_at) VALUES (?, 1, ?, ?, ?)')
      .run('tpl_row_update', '标题新', '提示', tsRow);
    db.prepare('INSERT INTO creation_template_tombstones (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .run('tpl_old_tomb', 1, tsTomb);

    const dualSync = await request(
      'GET',
      `/api/creation-templates?since=${tsRow - 100}&since_id=&deleted_since=${tsTomb - 100}&deleted_since_id=`,
      null,
      user1Token
    );
    assert.strictEqual(dualSync.status, 200);
    assert.strictEqual(dualSync.body.data.length, 1);
    assert.strictEqual(dualSync.body.data[0].id, 'tpl_row_update');
    assert.strictEqual(dualSync.body.next_since.updated_at, tsRow, 'next_since 必须是行自身的 updated_at，绝不得被墓碑的 50000 污染');
    assert.strictEqual(dualSync.body.next_since.id, 'tpl_row_update');

    assert.strictEqual(dualSync.body.deleted_ids.length, 1);
    assert.strictEqual(dualSync.body.deleted_ids[0].id, 'tpl_old_tomb');
    assert.strictEqual(dualSync.body.deleted_next.deleted_at, tsTomb);
    assert.strictEqual(dualSync.body.deleted_next.id, 'tpl_old_tomb');
    console.log('✅ 双游标独立演进验证通过');

    console.log('\n🎉 PR1 全部 10 项核心功能与极端边界测试均无缝通过！');
  } finally {
    if (server) {
      server.close();
    }
  }
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
