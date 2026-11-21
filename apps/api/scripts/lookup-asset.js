'use strict';
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\lrp\\.dsh-material-library-test\\material.db', { readonly: true });

const hash = '0542da175c054effbc93cbfd27ec0e1a';
console.log('--- in creation_templates (all matching) ---');
const tpls = db.prepare("SELECT id, type, style, space, substr(prompt, 1, 60) as p FROM creation_templates WHERE prompt LIKE ? OR origin_images LIKE ? OR result_images LIKE ?").all(`%${hash}%`, `%${hash}%`, `%${hash}%`);
console.table(tpls);
