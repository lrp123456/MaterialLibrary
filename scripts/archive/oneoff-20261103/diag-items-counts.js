const path = require('path');
const { openDb } = require('../src/db');

const dbPath = path.join(process.env.USERPROFILE || process.env.HOME, '.dsh-material-library');
const db = openDb(dbPath);

const total = db.prepare('SELECT COUNT(id) as count FROM ba_items').get().count;
const withPreview = db.prepare('SELECT COUNT(id) as count FROM ba_items WHERE preview_rel IS NOT NULL').get().count;
const latexs = db.prepare("SELECT COUNT(id) as count FROM ba_items WHERE kind_key = 'latex'").get().count;
const latexsWithPreview = db.prepare("SELECT COUNT(id) as count FROM ba_items WHERE kind_key = 'latex' AND preview_rel IS NOT NULL").get().count;
const tiles = db.prepare("SELECT COUNT(id) as count FROM ba_items WHERE kind_key = 'tile'").get().count;
const tilesWithPreview = db.prepare("SELECT COUNT(id) as count FROM ba_items WHERE kind_key = 'tile' AND preview_rel IS NOT NULL").get().count;

console.log({ total, withPreview, latexs, latexsWithPreview, tiles, tilesWithPreview });
const sampleLatex = db.prepare("SELECT id, name_zh, brand, hue, role_hint, preview_rel FROM ba_items WHERE kind_key = 'latex' LIMIT 3").all();
console.log('Sample latexs:', sampleLatex);
