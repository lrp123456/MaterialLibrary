/**
 * 审计整改 P0 · auth 逻辑回归（SEC-009 / SEC-010 / LOGIC-007 / SEC-001）。
 * 运行：node test/auth-audit.test.js（用 node:sqlite，Windows 侧可跑）
 */
const assert = require('assert');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const auth = require(path.join(ROOT, 'src/auth.js'));

const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, salt TEXT, role TEXT, is_locked INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER, role TEXT, expires_at INTEGER);
`);

// ---- 1) 初始化账号 ----
process.env.ML_ADMIN_PASS = 'admin_pass_123';
process.env.ML_VIEWER_PASS = 'viewer_pass_456';
auth.initDefaultUsers(db, null);

// ---- 2) 正常登录 + 会话有效 ----
const lg = auth.login(db, 'admin', 'admin_pass_123', '127.0.0.1');
assert(lg && lg.token, 'admin 登录应成功');
assert(auth.verifySession(db, lg.token), '有效会话应通过校验');

// ---- 3) SEC-009：空密码账户的存量会话应被启动清理 + verifySession 拒绝 ----
db.prepare("INSERT INTO users (username, password_hash, salt, role, is_locked, created_at, updated_at) VALUES ('legacy', '', '', 'admin', 0, 0, 0)").run();
const legacyId = db.prepare("SELECT id FROM users WHERE username='legacy'").get().id;
db.prepare('INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)').run('legacy-token', legacyId, 'admin', Date.now() + 86400000);
assert.strictEqual(auth.verifySession(db, 'legacy-token'), null, '空密码账户的会话必须被拒绝（SEC-009）');
// 再次 init（模拟重启）应清掉存量会话
auth.initDefaultUsers(db, null);
const left = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE token='legacy-token'").get().c;
assert.strictEqual(left, 0, '重启后空密码账户存量会话应被清理（SEC-009）');

// ---- 4) LOGIC-007：is_locked 账户不能登录、不能持有会话 ----
const lgL = auth.login(db, 'naite', 'whatever', '127.0.0.1');
assert.strictEqual(lgL, null, 'is_locked=1 的账户登录必须失败（LOGIC-007）');
db.prepare('UPDATE users SET is_locked=1 WHERE username=?').run('viewer');
const lgV0 = auth.login(db, 'viewer', 'viewer_pass_456', '127.0.0.1');
assert.strictEqual(lgV0, null, '锁定后的 viewer 登录必须失败');
db.prepare('UPDATE users SET is_locked=0 WHERE username=?').run('viewer');

// ---- 5) SEC-010：media token 128bit + 兼容旧 64bit ----
const tok = auth.generateMediaToken('ML_test_fid', 300, null);
const hexPart = tok.split(':')[1];
assert.strictEqual(hexPart.length, 32, '新 media token 应为 128bit（32 hex），实际 ' + hexPart.length);
assert(auth.verifyMediaToken('ML_test_fid', tok, null), '新 token 应校验通过');
// 旧 16 hex token 兼容：手工按旧算法构造
const crypto = require('crypto');
const exp = Math.floor(Date.now() / 1000) + 60;
const secret = auth.getMediaSecret(null);
const legacyMac = crypto.createHmac('sha256', secret).update(`ML_old:${exp}`).digest('hex').slice(0, 16);
assert(auth.verifyMediaToken('ML_old', `${exp}:${legacyMac}`, null), '旧 64bit token 应兼容校验通过');
// 篡改检测
assert(!auth.verifyMediaToken('ML_old', `${exp}:${legacyMac.slice(0, 15)}f`, null), '篡改的 token 必须失败');

// ---- 6) SEC-001：lanInternalSession 已从导出中移除 ----
assert.strictEqual(auth.lanInternalSession, undefined, 'lanInternalSession 后门必须已删除（SEC-001）');

// ---- 7) clientIp：X-Real-IP 仅回环来源可信 ----
function fakeReq(socketIp, headers) {
  return { socket: { remoteAddress: socketIp }, headers: headers || {} };
}
assert.strictEqual(auth.clientIp(fakeReq('127.0.0.1', { 'x-real-ip': '203.0.113.9' })), '203.0.113.9', '回环代理注入的 X-Real-IP 应被采信');
assert.strictEqual(auth.clientIp(fakeReq('::ffff:192.168.1.59', { 'x-real-ip': '203.0.113.9' })), '192.168.1.59', '非回环来源伪造 X-Real-IP 应被忽略');
assert.strictEqual(auth.clientIp(fakeReq('::ffff:192.168.1.59')), '192.168.1.59', 'IPv6-mapped 地址应归一化');

console.log('auth-audit.test.js: 全部通过 ✓');
