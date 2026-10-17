const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
const db = new betterSqlite('/home/lrp/.dsh-material-library/material.db');

console.log('=== Assets 状态汇总 ===');
console.log(db.prepare("SELECT status, count(*) as cnt FROM assets GROUP BY status").all());

console.log('\n=== Assets 各类别分布 ===');
console.log(db.prepare("SELECT category, count(*) as cnt FROM assets GROUP BY category").all());

console.log('\n=== Assets 媒体类型 (kind) 分布 ===');
console.log(db.prepare("SELECT kind, count(*) as cnt FROM assets GROUP BY kind").all());

console.log('\n=== node_runs 状态汇总 ===');
console.log(db.prepare("SELECT node_type, status, count(*) as cnt FROM node_runs GROUP BY node_type, status").all());

console.log('\n=== runs 状态汇总 ===');
console.log(db.prepare("SELECT status, count(*) as cnt FROM runs GROUP BY status").all());

console.log('\n=== ai_tasks 状态汇总 ===');
console.log(db.prepare("SELECT status, count(*) as cnt FROM ai_tasks GROUP BY status").all());

db.close();
