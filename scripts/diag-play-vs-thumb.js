#!/usr/bin/env node
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
const db = new Database('/home/lrp/.dsh-material-library/material.db');
const token = crypto.randomBytes(32).toString('hex');
const user = db.prepare('SELECT id, role FROM users LIMIT 1').get();
db.prepare('INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,?,?)')
  .run(token, user.id, user.role, Date.now() + 300000);
const vid = db.prepare(`SELECT fid, main_derivative_id FROM assets WHERE kind='video' AND file_name LIKE 'mmexport%' ORDER BY rowid DESC LIMIT 1`).get();

function req(url, headers = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const r = http.get(url, { headers }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; if (n > 800) r.destroy(); });
      res.on('end', () => resolve({ s: res.statusCode, ct: res.headers['content-type'], n, ms: Date.now() - t0 }));
    });
    r.setTimeout(12000, () => { r.destroy(); resolve({ s: -1, err: 'timeout' }); });
    r.on('error', (e) => resolve({ s: 0, err: e.message }));
  });
}

(async () => {
  const enc = encodeURIComponent(vid.fid);
  const base = `http://127.0.0.1:30001/api/viewer/assets/${enc}/image?token=${token}&derivative=${vid.main_derivative_id}`;
  console.log('img (expect jpeg thumb)', await req(base));
  console.log('play=1 (expect video/mp4)', await req(base + '&play=1'));
  console.log('range (expect video)', await req(base, { Range: 'bytes=0-100' }));
  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  db.close();
})();
