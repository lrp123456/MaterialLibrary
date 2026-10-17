const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
const db = new betterSqlite('/home/lrp/.dsh-material-library/material.db', { readonly: true });

console.log('=== Asset Status Summary ===');
console.log(db.prepare("SELECT status, count(*) as cnt FROM assets GROUP BY status").all());

console.log('=== LLM Providers ===');
console.log(db.prepare("SELECT * FROM llm_providers").all());

console.log('=== LLM Models ===');
console.log(db.prepare("SELECT * FROM llm_models").all());

console.log('=== Gen Adapters ===');
console.log(db.prepare("SELECT * FROM gen_adapters").all());

console.log('=== Snapshots ===');
console.log(db.prepare("SELECT * FROM snapshot_devices").all());
console.log('Snapshot Items Count:', db.prepare("SELECT count(*) as c FROM snapshot_items").get());
console.log('Snapshot Items State:', db.prepare("SELECT state, count(*) as c FROM snapshot_items GROUP BY state").all());

console.log('=== Node Runs (recent 10 failures) ===');
console.log(db.prepare("SELECT node_type, status, error, count(*) as cnt FROM node_runs WHERE status='failed' GROUP BY node_type, error").all());

console.log('=== AI Tasks ===');
console.log(db.prepare("SELECT * FROM ai_tasks").all());
