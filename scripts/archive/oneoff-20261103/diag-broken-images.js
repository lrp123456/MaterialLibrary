#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const dataDir = process.env.ML_DATA_DIR || '/home/lrp/.dsh-material-library';
const dbPath = process.env.ML_DB || path.join(dataDir, 'material.db');
const db = new Database(dbPath, { readonly: true });

function q(sql, ...args) {
  try { return db.prepare(sql).all(...args); }
  catch (e) { console.log('SQL ERR', e.message); return []; }
}

console.log('=== mmexport assets ===');
for (const r of q(`
  SELECT fid, kind, COALESCE(category,'') AS category, file_name,
         COALESCE(main_derivative_id,'') AS main_d, COALESCE(thumb_url,'') AS thumb_url,
         COALESCE(auth_state,'') AS auth
  FROM assets WHERE file_name LIKE 'mmexport%' ORDER BY rowid DESC LIMIT 20
`)) {
  const thumbPath = path.join(dataDir, 'cache', 'thumbs', `${r.fid}.jpg`);
  console.log([r.fid, r.kind, r.category, r.file_name, r.main_d, r.auth, fs.existsSync(thumbPath) ? 'THUMB_OK' : 'NO_THUMB'].join(' | '));
}

console.log('\n=== audio/music ===');
for (const r of q(`
  SELECT fid, kind, COALESCE(category,'') AS category, file_name,
         COALESCE(main_derivative_id,'') AS main_d
  FROM assets WHERE file_name LIKE '%.mp3' OR kind='audio' OR category='music' LIMIT 15
`)) {
  const thumbPath = path.join(dataDir, 'cache', 'thumbs', `${r.fid}.jpg`);
  console.log([r.fid, r.kind, r.category, r.file_name, r.main_d, fs.existsSync(thumbPath) ? 'THUMB_OK' : 'NO_THUMB'].join(' | '));
}

console.log('\n=== derivatives for recent mmexport ===');
for (const r of q(`
  SELECT d.id, d.asset_fid, d.kind, d.storage_type,
         COALESCE(d.local_path,'') AS local_path,
         COALESCE(d.file_name,'') AS file_name
  FROM derivatives d
  JOIN assets a ON a.fid = d.asset_fid
  WHERE a.file_name LIKE 'mmexport%'
  ORDER BY a.rowid DESC, d.id
  LIMIT 30
`)) {
  const exists = r.local_path ? (fs.existsSync(r.local_path) ? 'FILE_OK' : 'FILE_MISS') : 'NO_PATH';
  console.log([r.id, r.asset_fid, r.kind, r.storage_type, exists, r.local_path.slice(0, 90), r.file_name].join(' | '));
}

console.log('\n=== kind counts ===');
for (const r of q(`SELECT kind, COUNT(*) AS c FROM assets GROUP BY kind ORDER BY c DESC`)) {
  console.log(`${r.kind}: ${r.c}`);
}

console.log('\n=== assets missing derivatives ===');
for (const r of q(`
  SELECT a.fid, a.kind, a.file_name
  FROM assets a
  LEFT JOIN derivatives d ON d.asset_fid = a.fid
  WHERE d.id IS NULL AND a.file_name LIKE 'mmexport%'
  LIMIT 10
`)) {
  console.log([r.fid, r.kind, r.file_name].join(' | '));
}

console.log('\n=== sample local_path existence overall ===');
let ok = 0, miss = 0, nopath = 0;
for (const r of q(`SELECT local_path FROM derivatives WHERE local_path IS NOT NULL AND local_path != '' LIMIT 500`)) {
  if (fs.existsSync(r.local_path)) ok++; else miss++;
}
for (const r of q(`SELECT COUNT(*) AS c FROM derivatives WHERE local_path IS NULL OR local_path = ''`)) nopath = r.c;
console.log(`sample500 local_path: ok=${ok} miss=${miss}; empty_path_total=${nopath}`);

db.close();
