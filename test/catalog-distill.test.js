const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseNipponSwatches,
  parseMarcopoloSwatches,
  parseWallpaperSwatches,
  parseAntoliniSwatches,
  parseSwatches,
  getAdapter
} = require('../src/base-library/catalog-sources');
const { draftsFromVision, normalizeDraftItem } = require('../src/base-library/distill');
const { openDb } = require('../src/db');
const {
  ensureItems,
  clusterSchemeDraft,
  createScheme,
  listSchemes,
  upsertCatalogItem
} = require('../src/base-library/items');

const nippon = parseNipponSwatches(
  'rgbR:120,rgbG:130,rgbB:140,name:"青花灰",url:"https:\\u002F\\u002Fcdn-color-prod.nipponpaint.com.cn\\u002Fa.jpg" name:abd,url:other',
  'https://www.nipponpaint.com.cn/baidase'
);
assert.strictEqual(nippon.length, 1);
assert.strictEqual(nippon[0].name_zh, '青花灰');
assert.strictEqual(nippon[0].image_url, 'https://cdn-color-prod.nipponpaint.com.cn/a.jpg');
assert.strictEqual(nippon[0].kind_key, 'latex');
assert.strictEqual(nippon[0].hex, '#78828c');

const marco = parseMarcopoloSwatches(
  '<html>ThinkPHP Fatal error: Undefined offset: 1</html>',
  'https://www.marcopolo.com.cn/products/'
);
assert.deepStrictEqual(marco, []);
const marcoCard = parseMarcopoloSwatches(
  '<div class="product-card"><img src="/tile.jpg"><h3>鱼肚白</h3></div>',
  'https://www.marcopolo.com.cn/products/'
);
assert.strictEqual(marcoCard.length, 1);
assert.strictEqual(marcoCard[0].name_zh, '鱼肚白');
assert.strictEqual(marcoCard[0].image_url, 'https://www.marcopolo.com.cn/tile.jpg');

const paper = parseWallpaperSwatches(
  '<meta property="og:image" content="https://www.wallpaper.cn/a.jpg"><h1>云纹壁布</h1><p>品牌：玉兰</p>',
  'https://www.wallpaper.cn/product/271521.html'
);
assert.strictEqual(paper[0].brand, '玉兰');
assert.strictEqual(paper[0].name_zh, '云纹壁布');
assert.ok(paper[0].image_url.includes('wallpaper.cn'));

const stone = parseAntoliniSwatches(
  '<title>Pietra Serena | Natural Stone Collection</title><div class="images_repeater_elem" srcfull="https://www.antolini.com/image/imgfull1-pietraserena_closeup.jpg"></div>',
  'https://www.antolini.com/en/c6/natural-stone-collection/m1864/pietra-serena'
);
assert.strictEqual(stone[0].name_zh, 'Pietra Serena');
assert.strictEqual(stone[0].external_id, 'antolini:pietra-serena');
assert.ok(stone[0].image_url.includes('imgfull1-pietraserena_closeup'));

assert.strictEqual(parseSwatches(getAdapter('marcopolo'), '<html>error</html>').length, 0);
assert.strictEqual(parseSwatches(getAdapter('nippon-cn'), nippon.length ? 'name:"青花灰",url:"https:\\u002F\\u002Fcdn-color-prod.nipponpaint.com.cn\\u002Fa.jpg"' : '').length, 1);

const drafts = draftsFromVision({
  items: [
    { kind_key: 'latex', name_zh: '暖白', hex: 'F4EFE6', mount: 'wall' },
    { kind_key: 'latex', name_zh: '没色值' },
    { kind_key: 'glass', name_zh: '玻璃', hex: '#AABBCC' },
    { kind_key: 'door_design', name_zh: '肤感膜门', mount: 'millwork' },
    { kind_key: 'furniture', name_zh: '沙发', mount: 'furniture', hex: '#112233' }
  ]
});
assert.deepStrictEqual(drafts.map((row) => row.kind_key), ['latex', 'door_design', 'furniture']);
assert.strictEqual(drafts[0].hex, '#F4EFE6');
assert.strictEqual(drafts[0].library, 'material');
assert.strictEqual(drafts[0].series_zh, '乳胶漆');
assert.strictEqual(drafts[1].library, 'design');
assert.strictEqual(drafts[1].series_zh, '门板');
assert.strictEqual(drafts[2].hex, '');
assert.strictEqual(drafts[2].library, 'product');
assert.strictEqual(normalizeDraftItem({ kind_key: 'microcement' }), null);
const bySeries = normalizeDraftItem({ series_zh: '门板', name_zh: '平板门' });
assert.strictEqual(bySeries.kind_key, 'door_design');
assert.strictEqual(bySeries.library, 'design');

const testDir = path.join(os.tmpdir(), 'dsh_catalog_distill_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
const db = openDb(testDir);
ensureItems(db);
const before = db.prepare('SELECT COUNT(*) AS c FROM ba_items').get().c;
assert.ok(drafts.length >= 1);
const afterPreview = db.prepare('SELECT COUNT(*) AS c FROM ba_items').get().c;
assert.strictEqual(afterPreview, before, '草稿解析不写库');

const walnut = db.prepare('SELECT name_zh FROM ba_schemes WHERE id = ?').get('us_walnut_beam');
assert.strictEqual(walnut.name_zh, '胡桃木梁壁炉');

const photo = upsertCatalogItem(db, {
  kind: 'color',
  kind_key: 'latex',
  name_zh: '照片暖白',
  hex: '#F4EFE6',
  preview_rel: 'cache/base-library/catalog/photo.jpg',
  origin: 'photo',
  name_status: 'page'
});
assert.strictEqual(db.prepare('SELECT origin FROM ba_items WHERE id = ?').get(photo.id).origin, 'photo');

const clustered = clusterSchemeDraft(db, ['color_pearl', 'color_milk', 'wood_walnut', 'design_beam', photo.id]);
assert.ok(clustered.slots.length > 0);
const saved = createScheme(db, {
  name_zh: '测试配套',
  style_leaf: 'test_leaf',
  slots: clustered.slots
});
assert.ok(saved.id.startsWith('scheme_'));
const names = listSchemes(db).map((row) => row.id);
assert.ok(names.includes('us_walnut_beam'));
assert.ok(names.includes(saved.id));
assert.strictEqual(db.prepare('SELECT name_zh FROM ba_schemes WHERE id = ?').get('us_walnut_beam').name_zh, '胡桃木梁壁炉');

let threw = false;
try { createScheme(db, { name_zh: '', style_leaf: 'x', slots: [] }); } catch { threw = true; }
assert.strictEqual(threw, true);

console.log('catalog-distill ok', { slots: clustered.slots.length, scheme: saved.id });
