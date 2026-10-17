const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
const db = new betterSqlite('/home/lrp/.dsh-material-library/material.db');

const failedRuns = db.prepare("SELECT COUNT(*) as c FROM node_runs WHERE status='failed'").get();
console.log('Current failed node_runs:', failedRuns.c);

if (failedRuns.c > 0) {
  const info = db.prepare(`
    UPDATE node_runs
    SET status = 'queued', error = NULL, updated_at = ?
    WHERE status = 'failed'
  `).run(Date.now());
  console.log(`已将 ${info.changes} 个失败的 node_runs 重置为 queued 重新调度执行！`);
}

const failedAssets = db.prepare("SELECT COUNT(*) as c FROM assets WHERE status='discovered'").get();
console.log('Current discovered assets waiting for pipeline:', failedAssets.c);

db.close();
