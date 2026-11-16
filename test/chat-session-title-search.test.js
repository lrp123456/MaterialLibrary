/**
 * 对话动作标题生成、侧栏搜索与标签/模态过滤测试
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_title_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_secret_title';
process.env.ML_VIEWER_PASS = 'viewer_secret_title';
process.env.ML_SKIP_CREATION_BACKFILL = '1';

const { openDb } = require('../src/db');
const { handleApi } = require('../src/api');
const auth = require('../src/auth');

const db = openDb(testDir);
const services = {
  db,
  config: { dataDir: testDir },
  logger: { info: () => {}, error: () => {}, warn: () => {} },
  titleNamer: async ({ prompt }) => {
    if (prompt.includes('换空间')) {
      return { title: '换空间：门厅→客厅', action_tag: '换空间' };
    }
    if (prompt.includes('失败测试')) {
      throw new Error('模拟起名服务超时');
    }
    return { title: '空间画质扩散', action_tag: '生图' };
  }
};

const user1 = auth.createUser(db, { username: 'title_user_1', password: 'title_pass_1', role: 'viewer' });
const user1Login = auth.login(db, 'title_user_1', 'title_pass_1');
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
    console.log('=== 1. 自动起名 POST /chat/sessions/:id/auto-title 测试 ===');
    // 创建会话
    const sessRes = await request('POST', '/api/chat/sessions', { title: '新创作会话' }, user1Token);
    assert.strictEqual(sessRes.status, 200);
    const sessId = sessRes.body.data.id;

    // 触发自动起名
    const autoRes = await request('POST', `/api/chat/sessions/${sessId}/auto-title`, {
      prompt: '换空间：门厅改客厅设计方案',
      mode: 'image'
    }, user1Token);
    assert.strictEqual(autoRes.status, 200);
    assert.strictEqual(autoRes.body.data.named, true);
    assert.strictEqual(autoRes.body.data.title, '换空间：门厅→客厅');
    assert.strictEqual(autoRes.body.data.action_tag, '换空间');
    assert.strictEqual(autoRes.body.data.title_source, 'auto');

    // 再次调用自动起名（已是 auto 标题）：幂等阻止覆盖
    const secondAutoRes = await request('POST', `/api/chat/sessions/${sessId}/auto-title`, {
      prompt: '生图测试',
      mode: 'image'
    }, user1Token);
    assert.strictEqual(secondAutoRes.status, 200);
    assert.strictEqual(secondAutoRes.body.data.named, false);
    assert.strictEqual(secondAutoRes.body.data.reason, 'already_named');

    // 用户手改标题 PATCH /chat/sessions/:id
    const patchRes = await request('PATCH', `/api/chat/sessions/${sessId}`, {
      title: '设计师定制案'
    }, user1Token);
    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(patchRes.body.data.title_source, 'manual');

    // 手改后再次调用自动起名：返回 manual 并不覆盖
    const afterManualAutoRes = await request('POST', `/api/chat/sessions/${sessId}/auto-title`, {
      prompt: '换空间方案',
      mode: 'image'
    }, user1Token);
    assert.strictEqual(afterManualAutoRes.status, 200);
    assert.strictEqual(afterManualAutoRes.body.data.named, false);
    assert.strictEqual(afterManualAutoRes.body.data.reason, 'manual');

    console.log('=== 2. 起名失败保留占位，下次再试 ===');
    const sessFailRes = await request('POST', '/api/chat/sessions', { title: '新创作会话' }, user1Token);
    const failSessId = sessFailRes.body.data.id;
    const failAutoRes = await request('POST', `/api/chat/sessions/${failSessId}/auto-title`, {
      prompt: '失败测试：模拟网络故障',
      mode: 'image'
    }, user1Token);
    assert.strictEqual(failAutoRes.status, 200);
    assert.strictEqual(failAutoRes.body.data.named, false);

    // 检查数据库：title_source 仍为 NULL，允许下次再次尝试
    const checkFailRow = db.prepare('SELECT title, title_source FROM chat_sessions WHERE id=?').get(failSessId);
    assert.strictEqual(checkFailRow.title, '新创作会话');
    assert.strictEqual(checkFailRow.title_source, null);

    console.log('=== 3. 构造 120 条会话，测试突破 100 条限制的服务端搜索 ===');
    // 批量插入 120 条会话
    const now = Date.now();
    const insertSess = db.prepare(`
      INSERT INTO chat_sessions (id, user_id, title, action_tag, title_source, last_model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMsg = db.prepare(`
      INSERT INTO chat_messages (id, session_id, user_id, role, mode, prompt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 1; i <= 120; i++) {
      const sId = `bulk_sess_${i}`;
      const title = `常规定期会话 ${i}`;
      const actionTag = i % 2 === 0 ? '换空间' : '生图';
      insertSess.run(sId, user1.id, title, actionTag, 'auto', 'workflow_vision', now - (130 - i) * 1000, now - (130 - i) * 1000);
      
      // 只有在第 115 条会话中放入特殊关键词（按时间顺序它在 100 条之外）
      const prompt = i === 115 ? '独特的意大利砂岩玄关墙改造' : `普通方案提示词 ${i}`;
      insertMsg.run(`bulk_msg_${i}`, sId, user1.id, 'user', 'text_to_image', prompt, now - (130 - i) * 1000);
    }

    // 默认列表返回 100 条限制
    const defaultListRes = await request('GET', '/api/chat/sessions', null, user1Token);
    assert.strictEqual(defaultListRes.status, 200);
    assert.strictEqual(defaultListRes.body.data.length, 100);

    // 带 q 搜索：查消息正文，命中第 115 条会话
    const searchRes = await request('GET', '/api/chat/sessions?q=' + encodeURIComponent('意大利砂岩'), null, user1Token);
    assert.strictEqual(searchRes.status, 200);
    const searchMatches = searchRes.body.data;
    assert.ok(searchMatches.length >= 1, '应能搜索到匹配消息正文的会话');
    assert.strictEqual(searchMatches[0].id, 'bulk_sess_115');

    // 按 action_tag 过滤
    const tagRes = await request('GET', '/api/chat/sessions?tag=' + encodeURIComponent('换空间'), null, user1Token);
    assert.strictEqual(tagRes.status, 200);
    assert.ok(tagRes.body.data.length > 0);
    assert.ok(tagRes.body.data.every(s => s.action_tag === '换空间'));

    console.log('🎉 chat-session-title-search 所有用例测试通过！');
  } finally {
    if (server) server.close();
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
  }
}

runTests().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
