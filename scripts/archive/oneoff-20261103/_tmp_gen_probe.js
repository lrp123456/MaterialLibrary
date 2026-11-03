// 临时诊断：直接在 DB 签发管理员会话，复现 POST /api/gen/images，打印真实响应
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbFile = process.env.ML_DB
  || path.join(process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library'), 'material.db');
const db = new Database(dbFile);

const user = db.prepare("SELECT id, username, role FROM users WHERE username IN ('504391119','admin') AND is_locked=0 ORDER BY id LIMIT 1").get();
if (!user) { console.error('no usable admin user'); process.exit(1); }
const token = crypto.randomBytes(32).toString('hex');
db.prepare('INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,?,?)')
  .run(token, user.id, user.role, Date.now() + 3600 * 1000);
console.log('minted session for', user.username, user.role);
db.close();

const root = process.env.MLS_ROOT || 'http://127.0.0.1:30001';

(async () => {
  const body = {
    model: process.env.GEN_MODEL || 'qwen-image',
    prompt: 'test ping, one interior photo',
    size: '1:1',
  };
  const r = await fetch(`${root}/api/gen/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  console.log('POST /api/gen/images =>', r.status, ct);
  console.log('head:', text.slice(0, 500));

  // 也测一下 viewer 白名单语义：无 token
  const r2 = await fetch(`${root}/api/gen/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log('no-token =>', r2.status, r2.headers.get('content-type'));
})();
