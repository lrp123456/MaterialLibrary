'use strict';
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\lrp\\.dsh-material-library-test\\material.db', { readonly: true });

console.log('=== Checking 卫浴 → 门厅 prompts ===');
const rows = db.prepare("SELECT id, prompt FROM creation_templates WHERE type='video' LIMIT 100").all();
for (const r of rows) {
  if (r.prompt.includes('沐浴') || r.prompt.includes('洗手') || r.prompt.includes('卫浴')) {
    console.log(`[${r.id}]:`, r.prompt.slice(0, 150));
  }
}

console.log('\n=== Checking ba_schemes or style linkages ===');
try {
  const schemes = db.prepare("SELECT id, name, style_id FROM ba_schemes LIMIT 5").all();
  console.log('ba_schemes:', schemes);
} catch (e) {
  console.log(e.message);
}
try {
  const styles = db.prepare("SELECT id, name FROM ba_styles LIMIT 10").all();
  console.log('ba_styles:', styles);
} catch (e) {
  console.log(e.message);
}

// Check what style keywords exist in prompts that might have been missed
console.log('\n=== Check common words in prompts ===');
const styleCandidates = ['法式', '中古', '极简', '简约', '现代', '侘寂', '奶油', '轻奢', '原木', '美式', '中式', '意式', '托斯卡纳', '包豪斯', '宋式'];
for (const cand of styleCandidates) {
  const cnt = db.prepare(`SELECT count(*) as cnt FROM creation_templates WHERE type='video' AND prompt LIKE '%${cand}%'`).get().cnt;
  console.log(`Videos containing "${cand}": ${cnt}`);
}
