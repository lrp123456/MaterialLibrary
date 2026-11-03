// 临时诊断：列出素材库账号与锁定状态（只读）
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const dbFile = process.env.ML_DB
  || path.join(process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library'), 'material.db');
console.log('db:', dbFile);
const db = new Database(dbFile, { readonly: true });
const rows = db.prepare('SELECT id, username, role, is_locked, created_at FROM users ORDER BY id').all();
for (const r of rows) {
  console.log(`id=${r.id} user=${r.username} role=${r.role} locked=${r.is_locked} created=${new Date(r.created_at).toISOString()}`);
}
db.close();
