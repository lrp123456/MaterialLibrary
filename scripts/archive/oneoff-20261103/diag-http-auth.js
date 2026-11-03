#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const http = require('http');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const dataDir = process.env.ML_DATA_DIR || '/home/lrp/.dsh-material-library';
const db = new Database(path.join(dataDir, 'material.db'), { readonly: false });
const PORT = process.env.ML_PORT || 30001;

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 20000 }, (res) => {
      const chunks = [];
      let n = 0;
      res.on('data', (c) => { chunks.push(c); n += c.length; if (n > 2000) req.destroy(); });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          ct: res.headers['content-type'] || '',
          cl: res.headers['content-length'] || '',
          sample: buf.slice(0, 80).toString('utf8').replace(/\n/g, ' ')
        });
      });
    });
    req.on('error', (e) => resolve({ status: 0, ct: '', cl: '', sample: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ct: '', cl: '', sample: 'timeout' }); });
  });
}

(async () => {
  // mint a session
  const user = db.prepare('SELECT id, username, role FROM users LIMIT 1').get();
  if (!user) { console.log('no user'); process.exit(1); }
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 3600 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,?,?)')
    .run(token, user.id, user.role, expires);
  console.log('user', user.username, user.role);

  const vid = db.prepare(`
    SELECT a.fid, a.file_name, a.main_derivative_id
    FROM assets a JOIN derivatives d ON d.id=a.main_derivative_id
    WHERE a.kind='video' AND d.mime LIKE 'video%'
    ORDER BY a.rowid DESC LIMIT 2
  `).all();
  const aud = db.prepare(`
    SELECT a.fid, a.file_name, a.main_derivative_id
    FROM assets a WHERE a.kind='audio' LIMIT 2
  `).all();
  const img = db.prepare(`
    SELECT a.fid, a.file_name, a.main_derivative_id
    FROM assets a WHERE a.kind='image' AND a.main_derivative_id IS NOT NULL LIMIT 2
  `).all();

  async function probe(label, fid, derivId) {
    const base = `http://127.0.0.1:${PORT}/api/viewer/assets/${encodeURIComponent(fid)}/image?token=${token}`;
    const withD = derivId ? `${base}&derivative=${derivId}` : base;
    const r1 = await get(base);
    const r2 = await get(withD);
    console.log(`${label} NO_DERIV  HTTP ${r1.status} ct=${r1.ct} cl=${r1.cl} ${r1.sample.slice(0, 50)}`);
    console.log(`${label} WITH_DERIV HTTP ${r2.status} ct=${r2.ct} cl=${r2.cl} ${r2.sample.slice(0, 50)}`);
  }

  for (const v of vid) {
    console.log('\n--', v.file_name, 'deriv', v.main_derivative_id);
    await probe('VIDEO', v.fid, v.main_derivative_id);
    const p = await get(`http://127.0.0.1:${PORT}/api/viewer/assets/${encodeURIComponent(v.fid)}/poster?token=${token}`);
    console.log(`POSTER HTTP ${p.status} ct=${p.ct} cl=${p.cl}`);
  }
  for (const v of aud) {
    console.log('\n--', v.file_name);
    await probe('AUDIO', v.fid, v.main_derivative_id);
  }
  for (const v of img) {
    console.log('\n--', v.file_name);
    await probe('IMAGE', v.fid, v.main_derivative_id);
  }

  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  db.close();
})();
