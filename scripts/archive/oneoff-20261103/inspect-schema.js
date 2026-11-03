const { openDb } = require('../src/db');
const os = require('os');
const path = require('path');
const db = openDb(process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library'));
console.log('asset_tags', db.prepare('PRAGMA table_info(asset_tags)').all().map(c => c.name).join(','));
console.log('asset_colors', db.prepare('PRAGMA table_info(asset_colors)').all().map(c => c.name).join(','));
console.log('sample files', db.prepare("SELECT fid, file_name FROM assets WHERE file_name LIKE '%.jpg' LIMIT 3").all());
db.close();
