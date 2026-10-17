const { openDb } = require('../src/db');
const { VALUES } = require('../src/tags-seed');
const os = require('os');
const path = require('path');
const db = openDb(path.join(os.homedir(), '.dsh-material-library'));
console.log('tag_dict cols', db.prepare('PRAGMA table_info(tag_dict)').all().map(c => c.name).join(','));

const depDims = new Set(['quality', 'palette', 'luxury', 'era', 'temperature', 'functional']);
const keep = new Set([
  'color_style', 'flags',
  'modern_minimal', 'extreme_minimal', 'wabi_sabi_new', 'nordic', 'japandi_new',
  'neo_chinese_new', 'french_new', 'light_luxury', 'industrial_new', 'cream_new',
  'log_wood', 'american_new', 'american_country', 'italian_minimal_new',
  'modern_light_lux', 'quiet_luxury', 'retro', 'art_deco', 'classic_euro',
  'neo_classic', 'mediterranean', 'coastal', 'bohemian', 'maximalist', 'korean',
  'taiwan_hk', 'eclectic_unknown',
]);

const ins = db.prepare(`
  INSERT INTO tag_dict (dimension, dir, label, deprecated)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(dimension, dir) DO UPDATE SET label=excluded.label, deprecated=excluded.deprecated
`);
let n = 0;
for (const v of VALUES) {
  if (!keep.has(v.dir) && v.dim !== 'color_style' && v.dim !== 'flags') continue;
  try {
    ins.run(v.dim, v.dir, v.label, depDims.has(v.dim) ? 1 : 0);
    n++;
  } catch (e) {
    console.warn('ins fail', v.dir, e.message);
  }
}
console.log('seeded', n);
console.log('color_style', db.prepare("SELECT COUNT(*) c FROM tag_dict WHERE dimension='color_style'").get().c);
console.log('flags', db.prepare("SELECT COUNT(*) c FROM tag_dict WHERE dimension='flags'").get().c);
db.close();
