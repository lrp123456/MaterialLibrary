const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
const db = new betterSqlite('/home/lrp/.dsh-material-library/material.db');

const totalDiscovered = db.prepare("SELECT COUNT(*) as c FROM assets WHERE status='discovered'").get().c;
console.log('Total discovered assets:', totalDiscovered);

const withRuns = db.prepare(`
  SELECT COUNT(DISTINCT a.fid) as c
  FROM assets a
  JOIN node_runs nr ON a.fid = nr.asset_fid
  WHERE a.status = 'discovered'
`).get().c;
console.log('Discovered assets WITH node_runs:', withRuns);

const withoutRuns = db.prepare(`
  SELECT COUNT(*) as c
  FROM assets a
  WHERE a.status = 'discovered'
    AND NOT EXISTS (SELECT 1 FROM node_runs nr WHERE nr.asset_fid = a.fid)
`).get().c;
console.log('Discovered assets WITHOUT node_runs:', withoutRuns);

const recentDiscovered = db.prepare(`
  SELECT fid, file_name, kind, source, created_at
  FROM assets
  WHERE status = 'discovered'
  ORDER BY created_at DESC
  LIMIT 5
`).all();
console.log('Recent 5 discovered assets:', recentDiscovered);

db.close();
