const fs = require('fs');
const path = require('path');
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');

const testDb = new Database('C:\\Users\\lrp\\.dsh-material-library-test\\material.db', { readonly: true });
const mediaBase = 'C:\\Users\\lrp\\.dsh-material-library-test\\creation-library';

console.log('=== 1. Check Directory Names in creation-library ===');
const diskDirs = fs.existsSync(mediaBase) ? fs.readdirSync(mediaBase) : [];
console.log('Total dirs on disk:', diskDirs.length);
console.log('Sample 10 disk dirs:', diskDirs.slice(0, 10));

console.log('\n=== 2. Check Database IDs vs Disk Dirs ===');
const rows = testDb.prepare('SELECT id, title, type, origin_images, result_images, media_dir, created_at FROM creation_templates ORDER BY created_at DESC LIMIT 10').all();

for (const r of rows) {
  let oi = [];
  let ri = [];
  try { oi = JSON.parse(r.origin_images || '[]'); } catch (_) {}
  try { ri = JSON.parse(r.result_images || '[]'); } catch (_) {}
  const firstOiUrl = oi[0] ? (typeof oi[0] === 'string' ? oi[0] : oi[0].url) : 'none';
  const firstRiUrl = ri[0] ? (typeof ri[0] === 'string' ? ri[0] : (ri[0].poster || ri[0].url)) : 'none';
  const diskExists = fs.existsSync(path.join(mediaBase, r.id));
  console.log(`id: ${r.id}`);
  console.log(`  media_dir col: ${r.media_dir}`);
  console.log(`  disk dir exists for r.id? ${diskExists}`);
  console.log(`  first oi url: ${firstOiUrl}`);
  console.log(`  first ri url: ${firstRiUrl}`);
}

// 检查是否存在名称前缀匹配
const sampleId = rows[0].id;
const matched = diskDirs.filter(d => d.includes(sampleId) || sampleId.includes(d));
console.log(`\nMatched dirs for ${sampleId}:`, matched);
