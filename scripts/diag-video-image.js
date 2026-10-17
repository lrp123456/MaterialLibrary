#!/usr/bin/env node
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const dataDir = process.env.ML_DATA_DIR || '/home/lrp/.dsh-material-library';
const db = new Database(path.join(dataDir, 'material.db'));
const token = crypto.randomBytes(32).toString('hex');
const user = db.prepare('SELECT id, role FROM users LIMIT 1').get();
db.prepare('INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,?,?)')
  .run(token, user.id, user.role, Date.now() + 3600 * 1000);

const vid = db.prepare(`
  SELECT a.fid, a.file_name, a.main_derivative_id
  FROM assets a JOIN derivatives d ON d.id = a.main_derivative_id
  WHERE a.kind='video' AND d.storage_type='nas'
  LIMIT 1
`).get();
const aud = db.prepare(`SELECT fid, file_name, main_derivative_id FROM assets WHERE kind='audio' LIMIT 1`).get();

function get(url) {
  return new Promise((resolve) => {
    const q = http.get(url, { timeout: 12000 }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; if (n > 800) q.destroy(); });
      res.on('end', () => resolve({
        s: res.statusCode,
        ct: res.headers['content-type'],
        cl: res.headers['content-length']
      }));
    });
    q.on('error', (e) => resolve({ s: 0, e: e.message }));
    q.on('timeout', () => { q.destroy(); resolve({ s: 0, e: 'timeout' }); });
  });
}

(async () => {
  console.log('VIDEO', vid.file_name, 'deriv', vid.main_derivative_id);
  const base = `http://127.0.0.1:30001/api/viewer/assets/${encodeURIComponent(vid.fid)}/image?token=${token}`;
  console.log('  no_deriv  ', await get(base));
  console.log('  with_deriv', await get(base + '&derivative=' + vid.main_derivative_id));
  console.log('  poster    ', await get(`http://127.0.0.1:30001/api/viewer/assets/${encodeURIComponent(vid.fid)}/poster?token=${token}`));

  console.log('AUDIO', aud.file_name, 'deriv', aud.main_derivative_id);
  const abase = `http://127.0.0.1:30001/api/viewer/assets/${encodeURIComponent(aud.fid)}/image?token=${token}`;
  console.log('  no_deriv  ', await get(abase));
  console.log('  with_deriv', await get(abase + '&derivative=' + aud.main_derivative_id));
  console.log('  poster    ', await get(`http://127.0.0.1:30001/api/viewer/assets/${encodeURIComponent(aud.fid)}/poster?token=${token}`));

  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  db.close();
})();
