const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
const db = new betterSqlite('/home/lrp/.dsh-material-library/material.db');

console.log('Discovered sources:', db.prepare("SELECT source, count(*) as c FROM assets WHERE status='discovered' GROUP BY source").all());
console.log('Ready sources:', db.prepare("SELECT source, count(*) as c FROM assets WHERE status='ready' GROUP BY source").all());

const syncDiscovered = db.prepare("SELECT COUNT(*) as c FROM assets WHERE status='discovered' AND source='sync'").get().c;
console.log('sync source discovered count:', syncDiscovered);

const quarkDiscovered = db.prepare("SELECT COUNT(*) as c FROM assets WHERE status='discovered' AND (source='quark' OR source IS NULL)").get().c;
console.log('quark/null source discovered count:', quarkDiscovered);

db.close();
