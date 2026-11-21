const fs = require('fs');
const dbPath = 'C:\\Users\\lrp\\.dsh-material-library-test\\material.db';
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const db = new Database(dbPath, { readonly: true });

console.log('=== 测试库 creation_templates ===');
const cols = db.prepare("PRAGMA table_info(creation_templates)").all().map(c => c.name);
console.log('creation_templates cols:', cols.join(', '));

const tpls = db.prepare('SELECT id, title, space, style, operation, substr(prompt, 1, 50) as p, created_at, root_origin_hash FROM creation_templates ORDER BY created_at DESC LIMIT 10').all();
console.table(tpls);

console.log('=== ba_schemes ===');
try {
  const schemes = db.prepare('SELECT * FROM ba_schemes LIMIT 5').all();
  console.log('ba_schemes:', schemes);
} catch(e) { console.log(e.message); }

console.log('=== ba_styles ===');
try {
  const styles = db.prepare('SELECT * FROM ba_styles LIMIT 10').all();
  console.log('ba_styles:', styles);
} catch(e) { console.log(e.message); }
