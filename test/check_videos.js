const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
const db = new betterSqlite('/home/lrp/.dsh-material-library/material.db');

console.log('Video assets status summary:');
console.log(db.prepare("SELECT status, count(*) as c FROM assets WHERE kind='video' GROUP BY status").all());

const recentVideos = db.prepare("SELECT fid, file_name, status, poster_path, duration_s, created_at, source FROM assets WHERE kind='video' ORDER BY created_at DESC LIMIT 5").all();
console.log('Recent 5 videos:', recentVideos);

db.close();
