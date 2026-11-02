import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildSchemeBrowse } from '../src/base-library/scheme-browse.mjs';

const require = createRequire(import.meta.url);
const { FINE_STYLES } = require('../src/base-library/style-schemes.seed.js');

const styles = FINE_STYLES.map((style) => ({
  ...style,
  scheme_count: style.id === 'italian_minimal' ? 2 : 0
}));
const schemes = [
  {
    id: 'it_a',
    style_id: 'italian_minimal',
    style_leaf: 'italian_minimal',
    name_zh: '样板甲',
    slots: [
      { item_id: 'paint_a', name_zh: '暖灰漆', preview_rel: 'cache/a.jpg', surface: 'wall', surface_label: '墙面' },
      { item_id: 'tile_a', name_zh: '岩板', preview_rel: 'cache/b.jpg', surface: 'floor', surface_label: '地面' },
      {
        item_id: 'wood_a', name_zh: '烟熏橡木', preview_rel: 'cache/w.jpg', surface: 'millwork',
        kind_key: 'wood', wood_species: 'white_oak', wood_tone: 'dark', grain_type: 'straight',
        wood_layout: 'plain', surface_finish: 'matte'
      }
    ]
  },
  {
    id: 'it_b',
    style_id: 'italian_minimal',
    name_zh: '样板乙',
    slots: [
      { item_id: 'paint_a', name_zh: '暖灰漆', preview_rel: 'cache/a.jpg', surface: 'wall' }
    ]
  },
  {
    id: 'old_us',
    style_leaf: 'american_country_legacy',
    style_name: '旧美式',
    name_zh: '旧配套',
    slots: [
      { item_id: 'wood_a', name_zh: '胡桃木', preview_rel: 'cache/c.jpg', surface: 'millwork' }
    ]
  }
];

const browse = buildSchemeBrowse({ styles, schemes, leaf: 'italian_minimal' });
assert.equal(browse.tabs.length, FINE_STYLES.length + 1);
assert.equal(FINE_STYLES.length, 21);
assert.equal(browse.tabs[0].key, 'italian_minimal');
assert.equal(browse.cards.length, 2);
assert.deepEqual(browse.cards.map((card) => card.id), ['it_a', 'it_b']);
assert.deepEqual(browse.cards[0].strips.map((strip) => strip.surface_label), ['墙面', '地面', '全屋定制']);
assert.equal(browse.cards[0].summary, '暖灰漆 · 岩板 · 烟熏橡木');
assert.equal(browse.cards[1].strips.length, 1);
const woodStrip = browse.cards[0].strips.find((strip) => strip.id === 'wood_a');
assert.deepEqual(woodStrip.wood_badges, ['白橡木', '直纹', '深色']);
assert.ok(browse.tabs.some((tab) => tab.key === 'american_country_legacy'));

const empty = buildSchemeBrowse({ styles, schemes, leaf: 'cream_style' });
assert.equal(empty.empty, true);
assert.equal(empty.cards.length, 0);
assert.equal(empty.active, 'cream_style');

const paints = Array.from({ length: 1820 }, (_, index) => ({ id: `paint_${index}`, preview_rel: 'x.jpg' }));
assert.ok(!browse.cards.some((card) => paints.some((paint) => paint.id === card.id && card.id.startsWith('paint_') && card.id !== 'paint_a')));

console.log('scheme-browse ok');
