const Database = require('better-sqlite3');
const db = new Database('/home/lrp/.dsh-material-library/material.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
console.log('tables:', tables.filter(t => /user|auth|account|session/i.test(t)));
for (const t of tables) {
  if (/user|account/i.test(t)) {
    console.log('---', t, '---');
    try {
      console.log(db.prepare(`SELECT * FROM ${t} LIMIT 5`).all());
    } catch (e) { console.log(e.message); }
  }
}
