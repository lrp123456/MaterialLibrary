'use strict';
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\lrp\\.dsh-material-library-test\\material.db', { readonly: true });

const vids = db.prepare("SELECT id, root_origin_hash, origin_images, prompt FROM creation_templates WHERE type='video' LIMIT 10").all();
for (const v of vids) {
  console.log(`[${v.id}] root_origin_hash: "${v.root_origin_hash}"`);
  console.log('origin_images:', v.origin_images ? v.origin_images.slice(0, 80) : 'none');
  if (v.root_origin_hash) {
    const siblings = db.prepare("SELECT id, type, style, space FROM creation_templates WHERE root_origin_hash=?").all(v.root_origin_hash);
    console.log('siblings with same hash:', siblings);
  }
}
