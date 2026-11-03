#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const dataDir = process.env.ML_DATA_DIR || '/home/lrp/.dsh-material-library';
const db = new Database(path.join(dataDir, 'material.db'));
const token = crypto.randomBytes(32).toString('hex');
const user = db.prepare('SELECT id, role FROM users LIMIT 1').get();
db.prepare('INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,?,?)')
  .run(token, user.id, user.role, Date.now() + 3600 * 1000);

const rows = db.prepare(`
  SELECT a.fid, a.file_name, a.kind, a.main_derivative_id, d.mime, d.file_name AS dfile
  FROM assets a
  LEFT JOIN derivatives d ON d.id = a.main_derivative_id
  WHERE a.file_name LIKE 'mmexport1789393305470%' OR a.kind='audio'
  LIMIT 8
`).all();

function get(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    const q = http.get(url, { timeout: 8000 }, (res) => {
      let n = 0;
      const chunks = [];
      res.on('data', (c) => {
        chunks.push(c);
        n += c.length;
        if (n > 1500) q.destroy();
      });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          s: res.statusCode,
          ct: res.headers['content-type'] || '',
          cl: res.headers['content-length'] || n,
          ms: Date.now() - started,
          head: buf.slice(0, 12).toString('hex')
        });
      });
    });
    q.on('error', (e) => resolve({ s: 0, err: e.message, ms: Date.now() - started }));
    q.on('timeout', () => { q.destroy(); resolve({ s: 0, err: 'timeout', ms: Date.now() - started }); });
  });
}

(async () => {
  for (const r of rows) {
    const thumb = path.join(dataDir, 'cache', 'thumbs', `${r.fid}.jpg`);
    const hasThumb = fs.existsSync(thumb);
    const url = `http://127.0.0.1:30001/api/viewer/assets/${encodeURIComponent(r.fid)}/image?token=${token}${r.main_derivative_id ? '&derivative=' + r.main_derivative_id : ''}`;
    const res = await get(url);
    console.log([
      r.kind,
      r.file_name.slice(0, 34),
      hasThumb ? 'thumbOK' : 'noThumb',
      `HTTP ${res.s}`,
      res.ct,
      `len=${res.cl}`,
      `${res.ms}ms`,
      res.head || res.err || ''
    ].join(' | '));
  }
  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  db.close();
  console.log('done');
})();
