#!/usr/bin/env node
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const db = new Database('/home/lrp/.dsh-material-library/material.db');
const token = crypto.randomBytes(32).toString('hex');
const user = db.prepare("SELECT id, role FROM users WHERE role='admin' LIMIT 1").get();
db.prepare('INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?,?,?,?)')
  .run(token, user.id, user.role, Date.now() + 3600000);

function req(method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: 30001, path: urlPath, method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { /* */ }
        resolve({ s: res.statusCode, json, raw: buf.slice(0, 200) });
      });
    });
    r.on('error', e => resolve({ s: 0, err: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const d = await req('GET', '/api/dict');
  console.log('GET /dict', d.s, 'tags', d.json?.data?.tags?.length, 'dims', d.json?.data?.dimensions?.length);
  const dom = (d.json?.data?.tags || []).filter(t => t.dimension === 'dominant_color');
  console.log('dominant_color tags', dom.length, dom.slice(0, 3).map(t => t.dir + ':' + t.label));

  const est = await req('POST', '/api/dict/retag/estimate', { dimensions: ['space', 'style_atom'] });
  console.log('estimate', est.s, est.json?.data?.total, Object.keys(est.json?.data?.byDimension || {}));

  const draft = await req('POST', '/api/dict/draft-criteria', { dimension: 'space', label: '换鞋区' });
  console.log('draft', draft.s, draft.json?.data?.criteria?.slice(0, 40));

  const create = await req('POST', '/api/dict', {
    dimension: 'space', label: '换鞋区', criteria: '画面中有鞋柜或换鞋凳，属于入户换鞋区', aliases: ['门厅换鞋', '落尘区']
  });
  console.log('create', create.s, create.json?.data?.dir, create.json?.data?.criteria?.slice(0, 20));

  const hist = await req('GET', '/api/dict/audit');
  console.log('audit', hist.s, hist.json?.data?.length);

  // cleanup test tag
  if (create.json?.data?.id) {
    db.prepare('DELETE FROM tag_dict_audit WHERE tag_id=?').run(create.json.data.id);
    db.prepare('DELETE FROM tag_dict WHERE id=?').run(create.json.data.id);
  }
  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  db.close();
  console.log('done');
})();
