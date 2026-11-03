#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const http = require('http');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const dataDir = process.env.ML_DATA_DIR || '/home/lrp/.dsh-material-library';
const db = new Database(path.join(dataDir, 'material.db'), { readonly: true });
const PORT = process.env.ML_PORT || 30001;

// create a short-lived session for testing
function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          ct: res.headers['content-type'] || '',
          len: buf.length,
          body: buf.slice(0, 120).toString('utf8')
        });
      });
    });
    req.on('error', (e) => resolve({ status: 0, ct: '', len: 0, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ct: '', len: 0, body: 'timeout' }); });
  });
}

(async () => {
  console.log('=== video main_derivative kind ===');
  const vids = db.prepare(`
    SELECT a.fid, a.file_name, a.main_derivative_id,
           d.kind AS d_kind, d.storage_type, d.mime, d.file_name AS d_file
    FROM assets a
    LEFT JOIN derivatives d ON d.id = a.main_derivative_id
    WHERE a.kind='video'
    ORDER BY a.rowid DESC LIMIT 10
  `).all();
  for (const v of vids) {
    const thumb = path.join(dataDir, 'cache', 'thumbs', `${v.fid}.jpg`);
    console.log([
      v.file_name?.slice(0, 36),
      `main_d=${v.main_derivative_id}`,
      `d_kind=${v.d_kind}`,
      `storage=${v.storage_type}`,
      `mime=${v.mime}`,
      fs.existsSync(thumb) ? 'thumbOK' : 'noThumb'
    ].join(' | '));
  }

  console.log('\n=== audio main_derivative ===');
  const auds = db.prepare(`
    SELECT a.fid, a.file_name, a.main_derivative_id,
           d.kind AS d_kind, d.storage_type, d.mime
    FROM assets a LEFT JOIN derivatives d ON d.id = a.main_derivative_id
    WHERE a.kind='audio' LIMIT 5
  `).all();
  for (const v of auds) {
    const thumb = path.join(dataDir, 'cache', 'thumbs', `${v.fid}.jpg`);
    console.log([
      v.file_name?.slice(0, 40),
      `main_d=${v.main_derivative_id}`,
      `d_kind=${v.d_kind}`,
      fs.existsSync(thumb) ? 'thumbOK' : 'noThumb'
    ].join(' | '));
  }

  console.log('\n=== image with broken-looking restage (working ones) ===');
  const imgs = db.prepare(`
    SELECT a.fid, a.file_name, a.main_derivative_id, d.kind AS d_kind
    FROM assets a LEFT JOIN derivatives d ON d.id = a.main_derivative_id
    WHERE a.kind='image' AND d.kind LIKE 'restage%' LIMIT 5
  `).all();
  for (const v of imgs) console.log(v.file_name, v.main_derivative_id, v.d_kind);

  db.close();
})();
