const path = require('path');
const os = require('os');
const fs = require('fs');
const { openDb } = require('../src/db');

const dataDir = path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
const rows = db.prepare(`
  SELECT a.fid, a.file_name, a.kind, a.poster_path, a.auth_state, a.main_derivative_id, d.storage_ref, d.file_name as d_name
  FROM assets a
  LEFT JOIN derivatives d ON d.id = a.main_derivative_id
  WHERE a.kind = 'video'
  LIMIT 15
`).all();

console.log('Total videos found:', rows.length);
rows.forEach((r, idx) => {
  const pPath = r.poster_path ? path.join(dataDir, r.poster_path) : null;
  const pExists = pPath ? fs.existsSync(pPath) : false;
  const vPath = r.storage_ref ? (path.isAbsolute(r.storage_ref) ? r.storage_ref : path.join(dataDir, r.storage_ref)) : null;
  const vExists = vPath ? fs.existsSync(vPath) : false;
  console.log(`[${idx}] ${r.file_name}: poster=${r.poster_path} (exists=${pExists}), video_path=${r.storage_ref} (exists=${vExists})`);
});
