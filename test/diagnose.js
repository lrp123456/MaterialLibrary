const fs = require('fs');

async function main() {
  const dbPath = '/home/lrp/.dsh-material-library/material.db';
  const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
  const db = new betterSqlite(dbPath, { readonly: true });

  console.log('=== Tables in material.db ===');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log(tables.map(t => t.name).join(', '));

  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map(c => c.name);
    console.log(`Table ${t.name}:`, cols.join(', '));
  }

  console.log('\n=== All KV rows ===');
  const kv = db.prepare("SELECT * FROM kv").all();
  console.log(kv);

  console.log('\n=== Recent Assets (ORDER BY created_at DESC LIMIT 10) ===');
  const assets = db.prepare("SELECT * FROM assets ORDER BY created_at DESC LIMIT 10").all();
  console.log(assets.map(a => ({
    fid: a.fid,
    file_name: a.file_name,
    kind: a.kind,
    source: a.source,
    status: a.status,
    created_at: a.created_at,
    created_at_time: new Date(Number(a.created_at)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    client_asset_id: a.client_asset_id
  })));
}

main().catch(console.error);
