'use strict';
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\lrp\\.dsh-material-library-test\\material.db', { readonly: true });

const rows = db.prepare(`
  SELECT id, trajectory, style, space, prompt 
  FROM creation_templates 
  WHERE type='video' AND (
    trajectory LIKE '%说：%' 
    OR trajectory LIKE '%（图片%' 
    OR trajectory LIKE '%开灯%' 
    OR trajectory LIKE '%始 → 终%' 
    OR trajectory LIKE '%画面%'
    OR trajectory LIKE '%中景后拉%'
  )
  LIMIT 25
`).all();

console.log(`Found ${rows.length} sample corrupted records:`);
for (const r of rows) {
  console.log(`\n--- ID: ${r.id} | Trajectory: "${r.trajectory}" | Style: "${r.style}" | Space: "${r.space}" ---`);
  console.log(r.prompt.trim());
}
