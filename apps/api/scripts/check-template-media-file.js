const fs = require('fs');
const path = require('path');
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const { templateMediaFile } = require('../src/creation-library');

const services = {
  config: { dataDir: 'C:\\Users\\lrp\\.dsh-material-library-test' },
  db: new Database('C:\\Users\\lrp\\.dsh-material-library-test\\material.db', { readonly: true })
};

const rows = services.db.prepare('SELECT id, type, origin_images, result_images FROM creation_templates ORDER BY created_at DESC LIMIT 5').all();

for (const r of rows) {
  let oi = [];
  let ri = [];
  try { oi = JSON.parse(r.origin_images || '[]'); } catch (_) {}
  try { ri = JSON.parse(r.result_images || '[]'); } catch (_) {}
  
  console.log(`\nTemplate: ${r.id} (type: ${r.type})`);
  
  // 检查 origin 0
  const fOrigin = templateMediaFile(services, r.id, 'origin', 0);
  console.log(`  origin 0 file: ${fOrigin} (exists: ${fOrigin && fs.existsSync(fOrigin)})`);
  
  // 检查 result 0
  const fResult = templateMediaFile(services, r.id, 'result', 0);
  console.log(`  result 0 file: ${fResult} (exists: ${fResult && fs.existsSync(fResult)})`);
  
  // 检查 poster 0
  const fPoster = templateMediaFile(services, r.id, 'poster', 0);
  console.log(`  poster 0 file: ${fPoster} (exists: ${fPoster && fs.existsSync(fPoster)})`);
  
  if (oi[0]) {
    console.log(`  oi[0] URL: ${typeof oi[0] === 'string' ? oi[0] : oi[0].url}`);
  }
  if (ri[0]) {
    console.log(`  ri[0] URL: ${ri[0].url}, poster: ${ri[0].poster}`);
  }
}
