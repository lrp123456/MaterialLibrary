/**
 * 本地账号与会话管理 (Admin / Viewer)
 * 原生 node:crypto (scryptSync + randomBytes) 实现，零外部依赖。
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function ensureUsersSchema(db) {
  try {
    const cols = db.pragma('table_info(users)').map(c => c.name);
    if (!cols.includes('is_locked')) {
      db.prepare('ALTER TABLE users ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0').run();
    }
  } catch (e) {
    // ignore
  }
}

function randomPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

// 已有账号默认不改口令。只有环境变量明确给出时才重置；新建账号没有环境变量时生成随机口令。
function ensureAccount(db, username, { password, role, locked, resetExisting }) {
  const now = Date.now();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing && !resetExisting) {
    if (locked) {
      db.prepare('UPDATE users SET role = ?, is_locked = 1, updated_at = ? WHERE id = ?')
        .run(role, now, existing.id);
    }
    return null;
  }
  const pass = password || randomPassword();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(pass, salt);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, salt = ?, role = ?, is_locked = ?, updated_at = ? WHERE id = ?')
      .run(hash, salt, role, locked ? 1 : 0, now, existing.id);
  } else {
    db.prepare(
      'INSERT INTO users (username, password_hash, salt, role, is_locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(username, hash, salt, role, locked ? 1 : 0, now, now);
  }
  return password ? null : pass;
}

function initDefaultUsers(db, dataDir) {
  ensureUsersSchema(db);

  const adminFromEnv = process.env.ML_ADMIN_PASS || '';
  const viewerFromEnv = process.env.ML_VIEWER_PASS || '';
  const minted = [];

  const adminMinted = ensureAccount(db, 'admin', {
    password: adminFromEnv,
    role: 'admin',
    locked: false,
    resetExisting: Boolean(adminFromEnv),
  });
  if (adminMinted) minted.push(['admin', adminMinted]);

  ensureAccount(db, 'naite', {
    password: '',
    role: 'admin',
    locked: true,
    resetExisting: false,
  });

  const viewerMinted = ensureAccount(db, 'viewer', {
    password: viewerFromEnv,
    role: 'viewer',
    locked: false,
    resetExisting: Boolean(viewerFromEnv),
  });
  if (viewerMinted) minted.push(['viewer', viewerMinted]);

  if (dataDir && minted.length) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const credFile = path.join(dataDir, 'bootstrap-credentials.txt');
      const lines = minted.map(([name, pass]) => `${name}: ${pass}`).join('\n');
      const credText = `# DSH Material Library Credentials
# Updated at: ${new Date().toISOString()}
# 只在本次新建账号时写入随机口令。已有账号不会被启动过程改写。

${lines}
`;
      fs.writeFileSync(credFile, credText, { mode: 0o600 });
      console.log(`[auth] 新建账号的随机口令已写入: ${credFile}`);
    } catch (e) {
      console.error('[auth] 写入初始凭据文件失败:', e.message);
    }
  }

  // 安全收口（SEC-009）：历史版本曾允许空密码账号存在，其长效 session token
  // 在修复登录逻辑后依然有效。每次启动幂等清理一次，成本可忽略。
  try {
    const purged = db.prepare(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE password_hash = '' OR password_hash IS NULL)"
    ).run();
    if (purged.changes > 0) {
      console.log(`[auth] 已吊销空密码账户的存量会话 ${purged.changes} 条`);
    }
  } catch (e) {
    console.warn('[auth] 清理空密码会话失败:', e.message);
  }
}

const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 锁定 15 分钟
const ATTEMPT_WINDOW_MS = 60 * 1000; // 统计窗口 1 分钟

function checkLoginRateLimit(key) {
  if (!key) return { allowed: true };
  const now = Date.now();
  // SEC-010：Map 无上限增长会内存泄漏——超过阈值时顺手清扫过期条目。
  if (loginAttempts.size > 500) {
    for (const [k, v] of loginAttempts) {
      const expired = (!v.lockUntil || v.lockUntil <= now) && (now - (v.firstAttempt || 0) > ATTEMPT_WINDOW_MS);
      if (expired) loginAttempts.delete(k);
    }
  }
  const entry = loginAttempts.get(key);
  if (!entry) return { allowed: true };
  if (entry.lockUntil && entry.lockUntil > now) {
    const waitSec = Math.ceil((entry.lockUntil - now) / 1000);
    return { allowed: false, error: `连续登录失败过多，已被锁定，请在 ${waitSec} 秒后再试`, waitSec };
  }
  if (entry.lockUntil && entry.lockUntil <= now) {
    loginAttempts.delete(key);
    return { allowed: true };
  }
  return { allowed: true };
}

function recordLoginResult(key, success) {
  if (!key) return;
  const now = Date.now();
  if (success) {
    loginAttempts.delete(key);
    return;
  }
  const entry = loginAttempts.get(key) || { count: 0, firstAttempt: now, lockUntil: 0 };
  if (now - entry.firstAttempt > ATTEMPT_WINDOW_MS) {
    entry.count = 1;
    entry.firstAttempt = now;
  } else {
    entry.count += 1;
  }
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    entry.lockUntil = now + LOCKOUT_MS;
  }
  loginAttempts.set(key, entry);
}

function login(db, username, password, clientIp = '') {
  if (!username || !password) return null;
  const rateKey = `${clientIp || 'ip'}:${username}`;
  const rate = checkLoginRateLimit(rateKey);
  if (!rate.allowed) {
    const err = new Error(rate.error);
    err.code = 'RATE_LIMITED';
    throw err;
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    recordLoginResult(rateKey, false);
    return null;
  }

  // LOGIC-007：锁定账户禁止登录（is_locked 语义收敛）。
  if (Number(user.is_locked) === 1) {
    recordLoginResult(rateKey, false);
    return null;
  }

  const expectedHash = hashPassword(password, user.salt);
  const hashBuf = Buffer.from(expectedHash, 'hex');
  const storedBuf = Buffer.from(user.password_hash, 'hex');

  // 常量时间比较，杜绝时序攻击
  if (hashBuf.length !== storedBuf.length || !crypto.timingSafeEqual(hashBuf, storedBuf)) {
    recordLoginResult(rateKey, false);
    return null;
  }

  recordLoginResult(rateKey, true);

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;

  db.prepare('INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, user.id, user.role, expiresAt);

  return {
    token,
    user: { id: user.id, username: user.username, role: user.role, is_locked: Number(user.is_locked || 0) },
    expiresAt
  };
}

function verifySession(db, token) {
  if (!token) return null;
  const now = Date.now();
  const session = db.prepare(
    'SELECT s.token, s.role, s.expires_at, u.id, u.username, COALESCE(u.is_locked, 0) AS is_locked, u.password_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'
  ).get(token, now);
  if (!session) return null;
  // SEC-009：空密码账户（历史遗留）的会话一律无效。
  if (!session.password_hash) return null;
  // LOGIC-007：is_locked 语义收敛——锁定账户禁止持有有效会话。
  if (Number(session.is_locked) === 1) return null;
  return {
    id: session.id,
    username: session.username,
    role: session.role,
    is_locked: Number(session.is_locked || 0),
    token: session.token
  };
}

function normalizeIp(s) {
  return String(s || '').replace(/^::ffff:/i, '').replace(/^\[|\]$/g, '').trim();
}

function isLoopbackIp(ip) {
  const s = String(ip || '');
  return s === '127.0.0.1' || s === '::1' || s === 'localhost';
}

function clientIp(req) {
  // 安全基线：socket 对端地址是唯一天然可信的来源。
  // X-Real-IP 仅在「对端是本机回环」时采信 —— 该场景只可能是我们自己的
  // 反代（web-pro/server.cjs）注入的真实客户端 IP；外部直连伪造无效。
  const peer = normalizeIp(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '');
  if (isLoopbackIp(peer) && req?.headers?.['x-real-ip']) {
    const forwarded = normalizeIp(req.headers['x-real-ip']);
    if (forwarded) return forwarded;
  }
  return peer;
}

function isPrivateLanIp(ip) {
  const s = String(ip || '');
  if (!s) return false;
  if (s === '127.0.0.1' || s === '::1' || s === 'localhost') return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(s)) return true;
  return false;
}

function logout(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function isUserLocked(userOrUsername) {
  if (!userOrUsername) return false;
  if (typeof userOrUsername === 'string') {
    return userOrUsername.toLowerCase() === 'naite';
  }
  const name = String(userOrUsername.username || '').toLowerCase();
  if (name === 'naite') return true;
  if (Number(userOrUsername.is_locked) === 1) return true;
  return false;
}

function createUser(db, { username, password, role = 'viewer' }, operatorUsername = '') {
  if (operatorUsername && operatorUsername !== 'admin') {
    throw new Error('只有超级管理员 admin 才能新增用户');
  }
  const name = String(username || '').trim();
  if (!name || !password) throw new Error('用户名和密码不能为空');
  if (name.toLowerCase() === 'naite') throw new Error('用户名 naite 为系统保留锁定账号，无法重复新增');
  if (name.toLowerCase() === 'admin') throw new Error('用户名 admin 为系统超级管理员账号，无法重复新增');
  if (!['admin', 'viewer'].includes(role)) throw new Error('无效的用户角色');

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
  if (existing) throw new Error(`用户 ${name} 已存在`);

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const now = Date.now();

  const r = db.prepare(
    'INSERT INTO users (username, password_hash, salt, role, is_locked, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ).run(name, passwordHash, salt, role, now, now);

  return { id: r.lastInsertRowid, username: name, role, is_locked: 0 };
}

function changePassword(db, userId, newPassword, operatorUsername = '') {
  if (operatorUsername !== 'admin') {
    throw new Error('只有超级管理员 admin 才能修改用户密码');
  }
  const user = db.prepare('SELECT id, username, is_locked FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  if (isUserLocked(user)) {
    throw new Error(`用户 ${user.username} 为永久锁定账号，禁止修改密码`);
  }
  if (!newPassword || newPassword.length < 6) throw new Error('密码长度至少 6 位');

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(newPassword, salt);
  db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?')
    .run(passwordHash, salt, Date.now(), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return true;
}

function deleteUser(db, userId, operatorUsername = '') {
  if (operatorUsername !== 'admin') {
    throw new Error('只有超级管理员 admin 才能删除用户');
  }
  const user = db.prepare('SELECT id, username, is_locked FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  if (user.username === 'admin') {
    throw new Error('超级管理员 admin 禁止删除');
  }
  if (isUserLocked(user)) {
    throw new Error(`用户 ${user.username} 为永久锁定账号，禁止删除`);
  }
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return true;
}

function updateUser(db, userId, { role }, operatorUsername = '') {
  if (operatorUsername !== 'admin') {
    throw new Error('只有超级管理员 admin 能修改用户');
  }
  const user = db.prepare('SELECT id, username, role, is_locked FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  if (user.username === 'admin') {
    throw new Error('超级管理员 admin 角色禁止修改');
  }
  if (isUserLocked(user)) {
    throw new Error(`用户 ${user.username} 为永久锁定账号，禁止修改`);
  }
  if (role && !['admin', 'viewer'].includes(role)) {
    throw new Error('无效的用户角色');
  }
  if (role) {
    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, Date.now(), userId);
  }
  return { id: user.id, username: user.username, role: role || user.role, is_locked: user.is_locked ? 1 : 0 };
}

function listUsers(db) {
  ensureUsersSchema(db);
  return db.prepare('SELECT id, username, role, COALESCE(is_locked, 0) AS is_locked, created_at, updated_at FROM users ORDER BY id ASC').all();
}

let dynamicMediaSecret = process.env.ML_MEDIA_SECRET || null;

function getMediaSecret(dataDir = null) {
  if (dynamicMediaSecret) return dynamicMediaSecret;
  const targetDir = dataDir || process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library');
  if (targetDir) {
    const secretFile = path.join(targetDir, 'media_secret.key');
    try {
      if (fs.existsSync(secretFile)) {
        dynamicMediaSecret = fs.readFileSync(secretFile, 'utf8').trim();
        return dynamicMediaSecret;
      }
      fs.mkdirSync(targetDir, { recursive: true });
      const sec = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(secretFile, sec, { mode: 0o600 });
      dynamicMediaSecret = sec;
      return dynamicMediaSecret;
    } catch (e) {
      // fall through
    }
  }
  if (!dynamicMediaSecret) {
    dynamicMediaSecret = crypto.randomBytes(32).toString('hex');
  }
  return dynamicMediaSecret;
}

function generateMediaToken(fid, ttlSeconds = 900, dataDir = null) {
  const secret = getMediaSecret(dataDir);
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = `${fid}:${expires}`;
  // SEC-010：128bit 截断（32 hex），原 64bit 过短可被暴力枚举。
  const hmac = crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
  return `${expires}:${hmac}`;
}

function verifyMediaToken(fid, mediaToken, dataDir = null) {
  if (!mediaToken || typeof mediaToken !== 'string') return false;
  const parts = mediaToken.split(':');
  if (parts.length !== 2) return false;
  const [expStr, hmac] = parts;
  const expires = parseInt(expStr, 10);
  if (isNaN(expires) || Math.floor(Date.now() / 1000) > expires) return false;
  const secret = getMediaSecret(dataDir);
  // 兼容历史 64bit token 与新 128bit token：按请求方提供的长度重算比对。
  const hexLen = hmac.length === 16 ? 16 : 32;
  const expected = crypto.createHmac('sha256', secret).update(`${fid}:${expires}`).digest('hex').slice(0, hexLen);
  const hmacBuf = Buffer.from(hmac);
  const expBuf = Buffer.from(expected);
  if (hmacBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(hmacBuf, expBuf);
}

module.exports = {
  ensureUsersSchema,
  initDefaultUsers,
  login,
  verifySession,
  clientIp,
  isPrivateLanIp,
  logout,
  createUser,
  changePassword,
  deleteUser,
  updateUser,
  listUsers,
  isUserLocked,
  hashPassword,
  generateMediaToken,
  verifyMediaToken,
  checkLoginRateLimit,
  recordLoginResult,
  getMediaSecret
};
