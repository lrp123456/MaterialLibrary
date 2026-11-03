#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const dataDir = process.env.ML_DATA_DIR || '/home/lrp/.dsh-material-library';
const db = new Database(path.join(dataDir, 'material.db'), { readonly: true });

console.log('=== derivatives schema ===');
const cols = db.prepare(`PRAGMA table_info(derivatives)`).all();
console.log(cols.map(c => `${c.name}:${c.type}`).join(', '));

console.log('\n=== assets schema (paths) ===');
const acols = db.prepare(`PRAGMA table_info(assets)`).all();
console.log(acols.map(c => c.name).filter(n => /path|file|thumb|poster|local|remote|storage/i.test(n)).join(', '));

console.log('\n=== sample video derivative ===');
const vids = db.prepare(`
  SELECT a.fid, a.file_name, d.*
  FROM assets a JOIN derivatives d ON d.asset_fid = a.fid
  WHERE a.kind='video' AND a.file_name LIKE 'mmexport%'
  LIMIT 3
`).all();
for (const v of vids) {
  console.log(JSON.stringify(v, null, 0).slice(0, 500));
}

console.log('\n=== derivative storage_type counts ===');
for (const r of db.prepare(`SELECT storage_type, COUNT(*) c FROM derivatives GROUP BY storage_type`).all()) {
  console.log(r.storage_type, r.c);
}

console.log('\n=== how paths are stored ===');
const sample = db.prepare(`SELECT * FROM derivatives LIMIT 3`).all();
for (const s of sample) console.log(JSON.stringify(s).slice(0, 400));

db.close();
