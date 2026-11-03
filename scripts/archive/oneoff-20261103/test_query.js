const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
console.log('dataDir:', dataDir);

try {
  const db = new Database(path.join(dataDir, 'material.db'), { readonly: true });
  console.log('Assets count:', db.prepare('SELECT count(*) as c FROM assets').get());
  console.log('Status breakdown:', db.prepare('SELECT status, count(*) as c FROM assets GROUP BY status').all());
  console.log('Kind breakdown:', db.prepare('SELECT kind, count(*) as c FROM assets GROUP BY kind').all());
  console.log('Category breakdown:', db.prepare('SELECT category, count(*) as c FROM assets GROUP BY category').all());
  console.log('Auth state:', db.prepare('SELECT auth_state, count(*) as c FROM assets GROUP BY auth_state').all());
  console.log('Sample ready assets:', db.prepare('SELECT fid, file_name, kind, category, status, auth_state FROM assets WHERE status="ready" LIMIT 5').all());
} catch (e) {
  console.error('Error:', e.message);
}
