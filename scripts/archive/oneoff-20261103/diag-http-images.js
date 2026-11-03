#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const http = require('http');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const dataDir = process.env.ML_DATA_DIR || '/home/lrp/.dsh-material-library';
const db = new Database(path.join(dataDir, 'material.db'), { readonly: true });
const PORT = process.env.ML_PORT || 30001;

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 8000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, len: buf.length, body: buf.slice(0, 200).toString('utf8') });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
  });
}

(async () => {
  const samples = db.prepare(`
    SELECT a.fid, a.kind, a.file_name, a.auth_state, a.thumb_url
    FROM assets a
    WHERE a.file_name LIKE 'mmexport%' AND a.kind='video'
    ORDER BY a.rowid DESC LIMIT 5
  `).all();
  const audios = db.prepare(`
    SELECT a.fid, a.kind, a.file_name, a.auth_state
    FROM assets a WHERE a.kind='audio' LIMIT 3
  `).all();
  const images = db.prepare(`
    SELECT a.fid, a.kind, a.file_name, a.auth_state
    FROM assets a WHERE a.kind='image' AND a.file_name LIKE 'mmexport%' LIMIT 3
  `).all();

  for (const a of [...samples, ...images, ...audios]) {
    const fidEnc = encodeURIComponent(a.fid);
    const url = `http://127.0.0.1:${PORT}/api/viewer/assets/${fidEnc}/image`;
    const r = await get(url);
    const thumbPath = path.join(dataDir, 'cache', 'thumbs', `${a.fid}.jpg`);
    console.log([
      a.kind,
      a.file_name.slice(0, 40),
      a.auth_state || '-',
      `HTTP ${r.status}`,
      `len=${r.len}`,
      fs.existsSync(thumbPath) ? 'thumbOK' : 'noThumb',
      (r.headers && r.headers['content-type']) || r.error || '',
      r.status !== 200 ? String(r.body).slice(0, 80) : ''
    ].join(' | '));
  }

  // also poster route for videos
  console.log('\n=== poster route ===');
  for (const a of samples.slice(0, 3)) {
    const url = `http://127.0.0.1:${PORT}/api/viewer/assets/${encodeURIComponent(a.fid)}/poster`;
    const r = await get(url);
    console.log([a.file_name.slice(0, 40), `HTTP ${r.status}`, `len=${r.len}`, r.headers?.['content-type'] || r.error || ''].join(' | '));
  }

  db.close();
})();
