/**
 * 一个风格多套配套：美式乡村下有两套，编译只输出被点名的那一套。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_ba_schemes_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_secret_schemes';
process.env.ML_VIEWER_PASS = 'viewer_secret_schemes';

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { listSchemes, compileScheme, suggestItems } = require('../src/base-library/items');

const db = openDb(testDir);
ensureBaseLibrarySchema(db);

const schemes = listSchemes(db);
const country = schemes.filter((row) => row.style_leaf === 'american_country');
assert.strictEqual(country.length, 2, '美式乡村应有两套配套');
assert.ok(country.some((row) => row.name_zh === '胡桃木梁壁炉'));
assert.ok(country.some((row) => row.name_zh === '浅橡奶油'));

const walnut = compileScheme(db, 'us_walnut_beam');
assert.ok(walnut.prompt.includes('平顶木梁'));
assert.ok(walnut.prompt.includes('奶咖'));
assert.ok(!walnut.prompt.includes('浅橡奶油'));
assert.ok(!walnut.prompt.includes('鼠尾草绿'));

const oak = compileScheme(db, 'us_oak_cream');
assert.ok(oak.prompt.includes('鼠尾草绿'));
assert.ok(!oak.prompt.includes('文化石壁炉墙'));

const suggested = suggestItems(db, {
  surface: 'wall',
  role: 'base',
  schemeId: 'us_walnut_beam',
  space: 'living'
});
assert.strictEqual(suggested.items[0].id, 'color_milk');
const colors = suggested.items.filter((item) => item.kind === 'color');
assert.ok(colors.every((item) => item.role_hint === 'base' || item.role_hint === 'both'));
assert.ok(!colors.some((item) => item.id === 'color_sage'));

console.log('ba-schemes ok', country.map((row) => row.name_zh).join(' / '));
db.close();
