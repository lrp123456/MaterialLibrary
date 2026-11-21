'use strict';
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const fs = require('fs');

const dbPath = 'C:\\Users\\lrp\\.dsh-material-library-test\\material.db';
const db = new Database(dbPath, { readonly: true });

console.log('\n=== Distinct types ===');
const types = db.prepare("SELECT type, count(*) as cnt FROM creation_templates GROUP BY type").all();
console.table(types);

console.log('\n=== Distinct trajectories for videos ===');
const trajs = db.prepare("SELECT trajectory, count(*) as cnt FROM creation_templates WHERE type='video' GROUP BY trajectory").all();
console.table(trajs);

console.log('\n=== Distinct styles for videos ===');
const vstyles = db.prepare("SELECT style, count(*) as cnt FROM creation_templates WHERE type='video' GROUP BY style").all();
console.table(vstyles);

console.log('\n=== Samples of videos ===');
const samples = db.prepare("SELECT id, type, style, space, trajectory, result_images, origin_images, substr(prompt, 1, 100) as p FROM creation_templates WHERE type='video' LIMIT 5").all();
for (const s of samples) {
  console.log(s);
}
