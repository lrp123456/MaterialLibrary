const fs = require('fs');
const path = require('path');
const { openDb } = require('../src/db');
const dataDir = `${process.env.HOME}/.dsh-material-library`;
const db = openDb(dataDir);
const rows = db.prepare(`
  SELECT id, brand, name_zh, preview_rel FROM ba_items
  WHERE origin = 'brand' ORDER BY brand, name_zh
`).all();
const report = rows.map((row) => ({
  brand: row.brand,
  name: row.name_zh,
  rel: row.preview_rel,
  ok: row.preview_rel ? fs.existsSync(path.join(dataDir, row.preview_rel)) : false
}));
console.log(JSON.stringify(report, null, 2));
