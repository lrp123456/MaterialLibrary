#!/usr/bin/env node
/**
 * 设置 / 重置管理员口令。
 *
 * 设计原则：凭据只从环境变量或本地 `.env` 读取（两者都不入库），
 * 代码里不出现任何账号或口令字面量。
 *
 * 用法：
 *   # 先写进 .env（已被 git 忽略）
 *   ML_ADMIN_USER=your-account
 *   ML_ADMIN_PASSWORD=至少8位的新口令
 *   node scripts/set-admin-password.js
 *
 *   # 或临时通过环境变量传入
 *   ML_ADMIN_USER=xxx ML_ADMIN_PASSWORD=yyy node scripts/set-admin-password.js
 *
 * 可选：ML_DATA_DIR 指定数据目录（默认 ~/.dsh-material-library，与服务端一致）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const { parseEnvContent } = require(path.join(ROOT, 'src', 'env-secrets.js'));
  const { map } = parseEnvContent(fs.readFileSync(envPath, 'utf8'));
  for (const [key, value] of map.entries()) {
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function fail(message) {
  console.error(`[set-admin-password] ${message}`);
  process.exit(1);
}

function main() {
  loadDotEnv();

  const username = String(process.env.ML_ADMIN_USER || '').trim();
  const password = String(process.env.ML_ADMIN_PASSWORD || '');

  if (!username) fail('缺少 ML_ADMIN_USER（要设置口令的账号）');
  if (!password) fail('缺少 ML_ADMIN_PASSWORD（新口令）；留空不会清空既有口令');
  if (password.length < 8) fail('口令至少 8 位');
  if (password.toLowerCase() === username.toLowerCase()) fail('口令不能与账号相同');

  const dataDir = process.env.ML_DATA_DIR
    || path.join(os.homedir(), '.dsh-material-library');
  const dbFile = path.join(dataDir, 'material.db');
  if (!fs.existsSync(dbFile)) {
    fail(`找不到数据库：${dbFile}\n请确认 ML_DATA_DIR，或先启动一次服务端完成建库`);
  }

  const { openDb } = require(path.join(ROOT, 'src', 'db.js'));
  const db = openDb(dataDir);

  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const now = Date.now();

    const existing = db.prepare('SELECT id, role FROM users WHERE username=?').get(username);
    if (existing) {
      db.prepare(
        'UPDATE users SET password_hash=?, salt=?, is_locked=0, updated_at=? WHERE id=?',
      ).run(hash, salt, now, existing.id);
      console.log(`[set-admin-password] 已重置口令：${username}（原角色 ${existing.role}）`);
    } else {
      db.prepare(
        'INSERT INTO users (username, password_hash, salt, role, is_locked, created_at, updated_at) VALUES (?,?,?,?,0,?,?)',
      ).run(username, hash, salt, 'admin', now, now);
      console.log(`[set-admin-password] 已创建管理员：${username}`);
    }

    // 校验：立即用新口令登录一次，确保哈希写对了
    const { login } = require(path.join(ROOT, 'src', 'auth.js'));
    const session = login(db, username, password);
    if (!session) fail('写入后校验失败：登录未通过，请检查 users 表结构');
    console.log('[set-admin-password] 校验通过，新口令已生效');
  } finally {
    db.close();
  }
}

main();
