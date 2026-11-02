const { openDb } = require('../src/db');
const db = openDb(`${process.env.HOME}/.dsh-material-library`);
const rows = db.prepare(`
  SELECT COALESCE(brand, '') AS brand, kind_key, COUNT(*) AS c
  FROM ba_items
  WHERE origin = 'brand'
  GROUP BY brand, kind_key
  ORDER BY kind_key, brand
`).all();
console.log(JSON.stringify(rows));
