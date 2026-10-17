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
  SELECT a.fid, a.file_name, a.main_derivative_id,
         (d.mime LIKE 'video%' OR a.file_name LIKE '%.mp4') AS is_vid
  FROM assets a
  LEFT JOIN derivatives d ON d.id = a.main_derivative_id
  WHERE a.kind='video'
  ORDER BY a.rowid DESC
  LIMIT 8
`).all();

function get(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    const q = http.get(url, { timeout: 10000 }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; if (n > 1200) q.destroy(); });
      res.on('end', () => resolve({
        s: res.statusCode,
        ct: res.headers['content-type'] || '',
        cl: res.headers['content-length'] || n,
        loc: res.headers['location'] || '',
        ms: Date.now() - started
      }));
    });
    q.on('error', (e) => resolve({ s: 0, err: e.message, ms: Date.now() - started }));
    q.on('timeout', () => { q.destroy(); resolve({ s: 0, err: 'timeout', ms: Date.now() - started }); });
  });
}

(async () => {
  console.log('count', rows.length);
  for (const r of rows) {
    const thumb = path.join(dataDir, 'cache', 'thumbs', `${r.fid}.jpg`);
    const hasThumb = fs.existsSync(thumb);
    const url = `http://127.0.0.1:30001/api/viewer/assets/${encodeURIComponent(r.fid)}/image?token=${token}${r.main_derivative_id ? '&derivative=' + r.main_derivative_id : ''}`;
    const res = await get(url);
    console.log([
      r.file_name.slice(0, 32),
      'deriv=' + r.main_derivative_id,
      hasThumb ? 'thumbOK' : 'noThumb',
      `HTTP ${res.s}`,
      res.ct || res.err || '',
      `len=${res.cl || ''}`,
      `${res.ms}ms`,
      res.loc ? 'loc=' + res.loc.slice(0, 60) : ''
    ].join(' | '));
  }
  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  db.close();
  console.log('done');
})();
