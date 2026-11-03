#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
const dataDir = process.env.ML_DATA_DIR || '/home/lrp/.dsh-material-library';
const db = new Database(path.join(dataDir, 'material.db'), { readonly: true });

const rows = db.prepare(`
  SELECT a.fid, a.file_name, a.main_derivative_id, d.kind, d.mime, d.storage_type, d.file_name AS dfile
  FROM assets a LEFT JOIN derivatives d ON d.id = a.main_derivative_id
  WHERE a.kind='video' ORDER BY a.rowid DESC LIMIT 10
`).all();

for (const r of rows) {
  const thumb = path.join(dataDir, 'cache', 'thumbs', `${r.fid}.jpg`);
  const st = fs.existsSync(thumb) ? fs.statSync(thumb).size : 0;
  console.log([r.file_name.slice(0, 30), r.kind, r.mime, r.storage_type, r.dfile?.slice(0, 20), st > 0 ? `thumb:${st}` : 'NO_THUMB'].join(' | '));
}

// count videos missing thumbs
const total = db.prepare(`SELECT COUNT(*) c FROM assets WHERE kind='video'`).get().c;
let missing = 0;
for (const r of db.prepare(`SELECT fid FROM assets WHERE kind='video'`).all()) {
  if (!fs.existsSync(path.join(dataDir, 'cache', 'thumbs', `${r.fid}.jpg`))) missing++;
}
console.log(`videos total=${total} missing_thumb=${missing}`);
db.close();
