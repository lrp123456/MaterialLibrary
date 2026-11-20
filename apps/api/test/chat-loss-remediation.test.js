/**
 * 对话丢失整改与边界防护测试：
 * 1. GET /chat/messages 最新 N 条正序返回与 before 游标向前翻页
 * 2. screenMessage 对各种模式及 data: imageUrl 的保留
 * 3. clean-stale 对「仅有用户提示词但无产物会话」的防误删保护
 */
'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { screenMessage } = require('../src/chat-screen');

function ok(title) {
  console.log('✅ ' + title);
}

// 1. 测试 screenMessage
{
  const row = {
    id: 'msg_1',
    session_id: 's1',
    user_id: 1,
    role: 'assistant',
    mode: 'text_to_image',
    prompt: '完成生图',
    result: {
      imageUrl: 'data:image/jpeg;base64,123456',
      content: '完成',
      requestSnapshot: { debug: 'omit' }
    }
  };
  const screened = screenMessage(row);
  assert.strictEqual(screened.result.imageUrl, 'data:image/jpeg;base64,123456');
  assert.strictEqual(screened.result.requestSnapshot, undefined);
  ok('screenMessage 保留 data: imageUrl 不被误删');

  const withRef = screenMessage({
    id: 'msg_ref',
    role: 'user',
    params: {
      refs: [{
        fid: 'gen_1',
        url: '/api/viewer/assets/gen_1/image?derivative=30181',
        derivativeId: 30181,
        derivativeKind: 'restage_3_4',
        versionLabel: '3:4',
        name: '图2',
        kind: 'image',
        tag: '@图2',
      }],
    },
  });
  assert.strictEqual(withRef.params.refs[0].derivativeKind, 'restage_3_4');
  assert.strictEqual(withRef.params.refs[0].versionLabel, '3:4');
  assert.strictEqual(withRef.params.refs[0].derivativeId, 30181);
  ok('screenMessage 保留衍生版本种类，不退成笼统衍生');
}

// 2. 测试消息读取与游标翻页
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      user_id INTEGER,
      role TEXT,
      mode TEXT,
      prompt TEXT,
      params_json TEXT,
      images_json TEXT,
      status TEXT,
      run_id TEXT,
      engine TEXT,
      result_json TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      title TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  const sId = 'sess_test_100';
  db.prepare("INSERT INTO chat_sessions VALUES (?, 1, '测试', 1000, 1000)").run(sId);

  // 插入 15 条消息，时间戳 1001 到 1015
  const insertStmt = db.prepare(`
    INSERT INTO chat_messages (id, session_id, user_id, role, mode, prompt, created_at, updated_at)
    VALUES (?, ?, 1, 'user', 'chat', ?, ?, ?)
  `);
  for (let i = 1; i <= 15; i++) {
    insertStmt.run(`m_${i}`, sId, `消息 ${i}`, 1000 + i, 1000 + i);
  }

  // 模拟 GET /chat/messages limit=5 (不带 before)
  const queryLatest = (limit, before) => {
    let rows = [];
    if (before) {
      rows = db.prepare(`
        SELECT * FROM (
          SELECT * FROM chat_messages
          WHERE session_id=? AND created_at < ?
          ORDER BY created_at DESC LIMIT ?
        ) sub ORDER BY created_at ASC
      `).all(sId, Number(before), limit);
    } else {
      rows = db.prepare(`
        SELECT * FROM (
          SELECT * FROM chat_messages
          WHERE session_id=?
          ORDER BY created_at DESC LIMIT ?
        ) sub ORDER BY created_at ASC
      `).all(sId, limit);
    }
    const oldest = rows.length > 0 ? rows[0].created_at : null;
    const hasMore = oldest ? Boolean(db.prepare('SELECT 1 FROM chat_messages WHERE session_id=? AND created_at < ? LIMIT 1').get(sId, oldest)) : false;
    return { rows, hasMore, oldestCreatedAt: oldest };
  };

  // 首次请求：拿最新 5 条（应为 11 到 15）
  const page1 = queryLatest(5);
  assert.strictEqual(page1.rows.length, 5);
  assert.strictEqual(page1.rows[0].id, 'm_11');
  assert.strictEqual(page1.rows[4].id, 'm_15');
  assert.strictEqual(page1.hasMore, true);
  assert.strictEqual(page1.oldestCreatedAt, 1011);
  ok('GET /chat/messages 默认返回最新一截消息且正序排列');

  // 第二页（向上翻页）：拿 6 到 10
  const page2 = queryLatest(5, page1.oldestCreatedAt);
  assert.strictEqual(page2.rows.length, 5);
  assert.strictEqual(page2.rows[0].id, 'm_6');
  assert.strictEqual(page2.rows[4].id, 'm_10');
  assert.strictEqual(page2.hasMore, true);
  assert.strictEqual(page2.oldestCreatedAt, 1006);
  ok('before 游标成功向上翻页取更早消息');

  // 第三页（最早一截）：拿 1 到 5
  const page3 = queryLatest(5, page2.oldestCreatedAt);
  assert.strictEqual(page3.rows.length, 5);
  assert.strictEqual(page3.rows[0].id, 'm_1');
  assert.strictEqual(page3.rows[4].id, 'm_5');
  assert.strictEqual(page3.hasMore, false);
  ok('翻到会话开头时 hasMore 正确置为 false');

  db.close();
}

// 3. 测试 clean-stale 仅删 0 消息空壳会话
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      user_id INTEGER,
      role TEXT,
      mode TEXT,
      prompt TEXT,
      created_at INTEGER
    );
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      title TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  const oldTime = Date.now() - 5 * 24 * 3600 * 1000;
  // 会话 1：用户有提问，但没有产物
  db.prepare("INSERT INTO chat_sessions VALUES ('s_prompt_only', 1, '提问', ?, ?)").run(oldTime, oldTime);
  db.prepare("INSERT INTO chat_messages VALUES ('m_user_1', 's_prompt_only', 1, 'user', 'chat', '我想换沙发', ?)").run(oldTime);

  // 会话 2：彻底为空的空壳
  db.prepare("INSERT INTO chat_sessions VALUES ('s_pure_empty', 1, '空壳', ?, ?)").run(oldTime, oldTime);

  const threshold = Date.now() - 3 * 24 * 3600 * 1000;
  const targetSessions = db.prepare(`
    SELECT s.id FROM chat_sessions s
    WHERE s.user_id=? AND s.updated_at < ? AND NOT EXISTS (
      SELECT 1 FROM chat_messages m WHERE m.session_id = s.id
    )
  `).all(1, threshold);

  assert.strictEqual(targetSessions.length, 1);
  assert.strictEqual(targetSessions[0].id, 's_pure_empty');
  ok('clean-stale empty_only 仅选中 0 消息的空会话，保护含用户提问的会话');

  db.close();
}
