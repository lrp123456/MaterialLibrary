/** 回填 asset_colors.basic_color（历史 4bit 色板无此列） */
const os = require('os');
const path = require('path');
const { openDb } = require('../src/db');
const { basicColorOfHex } = require('../src/colors');
const db = openDb(path.join(os.homedir(), '.dsh-material-library'));
const rows = db.prepare("SELECT rowid, hex FROM asset_colors WHERE basic_color IS NULL OR basic_color=''").all();
const upd = db.prepare('UPDATE asset_colors SET basic_color=? WHERE rowid=?');
let n = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    try { upd.run(basicColorOfHex(r.hex), r.rowid); n++; } catch {}
  }
});
tx();
console.log(JSON.stringify({ backfilled: n, total: rows.length }));
console.log('basic_dist', db.prepare('SELECT basic_color, COUNT(*) c FROM asset_colors GROUP BY basic_color ORDER BY c DESC LIMIT 12').all());
db.close();
