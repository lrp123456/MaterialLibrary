#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const dataDir = '/home/lrp/.dsh-material-library';
const db = new Database(path.join(dataDir, 'material.db'));
const token = crypto.randomBytes(32).toString('hex');
const user = db.prepare('SELECT id, role FROM users LIMIT 1').get();
db.prepare('INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,?,?)')
  .run(token, user.id, user.role, Date.now() + 600000);

const vid = db.prepare(`SELECT fid, file_name, main_derivative_id FROM assets WHERE kind='video' AND file_name LIKE 'mmexport%' ORDER BY rowid DESC LIMIT 1`).get();
console.log('target', vid.file_name, vid.fid, 'deriv', vid.main_derivative_id);
const thumb = path.join(dataDir, 'cache', 'thumbs', `${vid.fid}.jpg`);
console.log('thumb exists', fs.existsSync(thumb), fs.existsSync(thumb) ? fs.statSync(thumb).size : 0);

function req(url) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const r = http.get(url, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolve({ s: res.statusCode, ct: res.headers['content-type'], n, ms: Date.now() - t0, loc: res.headers.location }));
    });
    r.setTimeout(15000, () => { r.destroy(); resolve({ s: -1, err: 'timeout', ms: Date.now() - t0 }); });
    r.on('error', (e) => resolve({ s: 0, err: e.message, ms: Date.now() - t0 }));
  });
}

(async () => {
  const enc = encodeURIComponent(vid.fid);
  console.log('A no-deriv', await req(`http://127.0.0.1:30001/api/viewer/assets/${enc}/image?token=${token}`));
  console.log('B with-deriv', await req(`http://127.0.0.1:30001/api/viewer/assets/${enc}/image?token=${token}&derivative=${vid.main_derivative_id}`));
  console.log('C poster', await req(`http://127.0.0.1:30001/api/viewer/assets/${enc}/poster?token=${token}`));
  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  db.close();
  console.log('ok');
})();
