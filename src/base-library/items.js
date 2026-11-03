/**
 * 基础属性四块：材质、做法、选品、风格方案。
 * 一个风格叶子下可以有多套配套。全局替换一次只用选中的那一套。
 */

const { normalizeWoodFields } = require('./wood-taxonomy');
const { expandPartForMatch } = require('./part-policy');

const SURFACES = ['ceiling', 'wall', 'floor', 'millwork', 'counter', 'furniture', 'soft', 'metal'];
const SURFACE_LABELS = {
  ceiling: '天花',
  wall: '墙面',
  floor: '地面',
  millwork: '全屋定制',
  counter: '台面',
  furniture: '家具',
  soft: '软装',
  metal: '金属饰面'
};

function lightnessOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return Math.round((0.299 * r + 0.587 * g + 0.114 * b) / 2.55) / 10;
}

function ensureItemSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ba_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      kind_key TEXT NOT NULL,
      name_zh TEXT NOT NULL,
      prompt_name TEXT NOT NULL,
      hex TEXT,
      family TEXT,
      lightness REAL,
      role_hint TEXT,
      zone TEXT NOT NULL DEFAULT 'any',
      preview_rel TEXT,
      external_sku TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ba_item_mounts (
      item_id TEXT NOT NULL,
      mount TEXT NOT NULL,
      PRIMARY KEY (item_id, mount)
    );
    CREATE TABLE IF NOT EXISTS ba_schemes (
      id TEXT PRIMARY KEY,
      style_leaf TEXT,
      name_zh TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ba_scheme_slots (
      scheme_id TEXT NOT NULL,
      surface TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'any',
      item_id TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (scheme_id, surface, role, item_id)
    );
    CREATE TABLE IF NOT EXISTS ba_space_rules (
      space_key TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      zones_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ba_styles (
      id TEXT PRIMARY KEY,
      name_zh TEXT NOT NULL,
      parent_style_key TEXT,
      description TEXT,
      cover_rel TEXT,
      source TEXT NOT NULL DEFAULT 'human',
      tags_json TEXT,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `);
  const schemeCols = db.prepare('PRAGMA table_info(ba_schemes)').all().map((row) => row.name);
  for (const [name, type] of [
    ['style_id', 'TEXT'],
    ['description', 'TEXT'],
    ['cover_rel', 'TEXT'],
    ['palette_json', 'TEXT'],
    ['space_scope_json', 'TEXT'],
    ['updated_at', 'INTEGER'],
    ['deleted_at', 'INTEGER']
  ]) {
    if (!schemeCols.includes(name)) db.exec(`ALTER TABLE ba_schemes ADD COLUMN ${name} ${type}`);
  }
  const slotCols = db.prepare('PRAGMA table_info(ba_scheme_slots)').all().map((row) => row.name);
  if (!slotCols.includes('space_key')) db.exec(`ALTER TABLE ba_scheme_slots ADD COLUMN space_key TEXT NOT NULL DEFAULT 'any'`);
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ba_scheme_slots_role ON ba_scheme_slots(scheme_id, space_key, surface, role);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ba_styles_parent ON ba_styles(parent_style_key, deleted_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ba_schemes_style ON ba_schemes(style_id, deleted_at);`);
  } catch (e) {}
  const columns = db.prepare('PRAGMA table_info(ba_items)').all().map((row) => row.name);
  const add = [
    ['brand', 'TEXT'],
    ['source_url', 'TEXT'],
    ['external_id', 'TEXT'],
    ['hue', 'TEXT'],
    ['name_status', 'TEXT'],
    ['origin', 'TEXT'],
    ['gloss', 'TEXT'],
    ['pattern', 'TEXT'],
    ['scene_rel', 'TEXT'],
    ['images_json', 'TEXT'],
    ['is_pinned', 'INTEGER DEFAULT 0'],
    ['use_count', 'INTEGER DEFAULT 0'],
    ['wood_species', 'TEXT'],
    ['wood_species_source', 'TEXT'],
    ['wood_tone', 'TEXT'],
    ['grain_type', 'TEXT'],
    ['grain_scale', 'TEXT'],
    ['grain_direction', 'TEXT'],
    ['wood_layout', 'TEXT'],
    ['surface_finish', 'TEXT'],
    ['brand_series', 'TEXT'],
    ['lab_l', 'REAL'],
    ['lab_a', 'REAL'],
    ['lab_b', 'REAL']
  ];
  for (const [name, type] of add) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE ba_items ADD COLUMN ${name} ${type}`);
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ba_items_pinned_use ON ba_items(is_pinned DESC, use_count DESC);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ba_items_wood_species ON ba_items(wood_species, wood_tone);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ba_items_wood_grain ON ba_items(grain_type, wood_layout, surface_finish);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ba_items_brand ON ba_items(brand, brand_series);`);
  } catch (e) {}
  // 保留全量基材（包含玻璃、金属、布艺等），仅清理孤立挂载
  try {
    db.exec(`DELETE FROM ba_item_mounts WHERE item_id NOT IN (SELECT id FROM ba_items);`);
  } catch (_) {}
}

const HUE_ORDER = ['white', 'yellow', 'green', 'blue', 'red', 'gray', 'black', 'brown'];
const HUE_LABELS = {
  white: '白',
  yellow: '黄',
  green: '绿',
  blue: '蓝',
  red: '红',
  gray: '灰',
  black: '黑',
  brown: '棕'
};

function hueFromHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (max - min < 20) {
    if (y > 210) return 'white';
    if (y < 45) return 'black';
    return 'gray';
  }
  // 棕色识别：低饱和偏暗暖色、褐色、咖啡色、深木色
  if (r > g && g >= b && y < 165 && (max - min < 80 || r < 195)) {
    return 'brown';
  }
  if (r > g && g > b && r - b > 25 && y >= 165) return 'yellow';
  if (r >= g && r >= b) return 'red';
  if (g >= r && g >= b) return 'green';
  return 'blue';
}

function colorDistance(a, b) {
  const pa = /^#?([0-9a-f]{6})$/i.exec(String(a || ''));
  const pb = /^#?([0-9a-f]{6})$/i.exec(String(b || ''));
  if (!pa || !pb) return Infinity;
  const na = parseInt(pa[1], 16);
  const nb = parseInt(pb[1], 16);
  const dr = ((na >> 16) & 255) - ((nb >> 16) & 255);
  const dg = ((na >> 8) & 255) - ((nb >> 8) & 255);
  const db = (na & 255) - (nb & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function upsertCatalogItem(db, item) {
  ensureItems(db);
  const now = Date.now();
  const hue = item.hue || hueFromHex(item.hex);
  const family = HUE_LABELS[hue] || item.family || null;
  let existing = item.external_id
    ? db.prepare('SELECT * FROM ba_items WHERE origin = ? AND external_id = ?').get(item.origin || 'brand', item.external_id)
    : null;
  if (!existing && item.id) {
    existing = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(item.id);
  }
  const isWood = item.kind_key === 'wood';
  const inferredWood = isWood
    ? normalizeWoodFields({
      name_zh: item.name_zh,
      name_en: item.name_en,
      prompt_name: item.prompt_name,
      brand_series: item.brand_series,
      tags: item.tags,
      hex: item.hex,
      gloss: item.gloss
    })
    : {};
  const woodValue = (key) => {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') return item[key];
    if (existing && existing[key] !== undefined && existing[key] !== null && existing[key] !== '') return existing[key];
    return inferredWood[key] !== undefined ? inferredWood[key] : null;
  };
  if (existing) {
    db.prepare(`
      UPDATE ba_items
      SET name_zh = ?, prompt_name = ?, hex = ?, family = ?, lightness = ?, hue = ?,
          preview_rel = ?, brand = ?, source_url = ?, name_status = ?, updated_at = ?,
          gloss = ?, pattern = ?, brand_series = ?,
          wood_species = ?, wood_species_source = ?, wood_tone = ?, grain_type = ?,
          grain_scale = ?, grain_direction = ?, wood_layout = ?, surface_finish = ?,
          lab_l = ?, lab_a = ?, lab_b = ?
      WHERE id = ?
    `).run(
      item.name_zh, item.prompt_name || item.name_zh, item.hex || existing.hex, family, lightnessOf(item.hex || existing.hex), hue || existing.hue,
      item.preview_rel || existing.preview_rel, item.brand || existing.brand, item.source_url || existing.source_url, item.name_status || existing.name_status || 'page', now,
      item.gloss || existing.gloss || (isWood ? 'matte' : null),
      item.pattern || existing.pattern || (isWood ? 'wood' : null),
      item.brand_series || existing.brand_series,
      woodValue('wood_species'), woodValue('wood_species_source'), woodValue('wood_tone'), woodValue('grain_type'),
      woodValue('grain_scale'), woodValue('grain_direction'), woodValue('wood_layout'), woodValue('surface_finish'),
      item.lab_l !== undefined ? item.lab_l : (existing.lab_l !== undefined ? existing.lab_l : woodValue('lab_l')),
      item.lab_a !== undefined ? item.lab_a : (existing.lab_a !== undefined ? existing.lab_a : woodValue('lab_a')),
      item.lab_b !== undefined ? item.lab_b : (existing.lab_b !== undefined ? existing.lab_b : woodValue('lab_b')),
      existing.id
    );
    return { id: existing.id, updated: true };
  }
  if ((item.origin || 'brand') === 'photo') {
    const siblings = db.prepare(`
      SELECT * FROM ba_items WHERE kind_key = ? AND hue = ? AND origin = 'photo'
    `).all(item.kind_key, hue);
    const close = siblings.find((row) => colorDistance(row.hex, item.hex) < 28);
    if (close) return { id: close.id, updated: false, merged: true };
    const branded = db.prepare(`
      SELECT id FROM ba_items WHERE kind_key = ? AND name_zh = ? AND origin = 'brand'
    `).get(item.kind_key, item.name_zh);
    if (branded) return { id: branded.id, updated: false, merged: true };
  }
  const id = item.id || `cat_${item.kind_key}_${now}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO ba_items (
      id, kind, kind_key, name_zh, prompt_name, hex, family, lightness, role_hint, zone,
      preview_rel, external_sku, created_at, updated_at, brand, source_url, external_id, hue, name_status, origin,
      gloss, pattern, brand_series,
      wood_species, wood_species_source, wood_tone, grain_type, grain_scale, grain_direction,
      wood_layout, surface_finish, lab_l, lab_a, lab_b
    ) VALUES (
      @id, @kind, @kind_key, @name_zh, @prompt_name, @hex, @family, @lightness, @role_hint, @zone,
      @preview_rel, NULL, @now, @now, @brand, @source_url, @external_id, @hue, @name_status, @origin,
      @gloss, @pattern, @brand_series,
      @wood_species, @wood_species_source, @wood_tone, @grain_type, @grain_scale, @grain_direction,
      @wood_layout, @surface_finish, @lab_l, @lab_a, @lab_b
    )
  `).run({
    id,
    kind: item.kind || (item.kind_key === 'latex' ? 'color' : 'texture'),
    kind_key: item.kind_key,
    name_zh: item.name_zh,
    prompt_name: item.prompt_name || item.name_zh,
    hex: item.hex || null,
    family,
    lightness: lightnessOf(item.hex),
    role_hint: item.kind_key === 'latex' ? (item.role_hint || null) : null,
    zone: item.zone || 'any',
    preview_rel: item.preview_rel || null,
    now,
    brand: item.brand || null,
    source_url: item.source_url || null,
    external_id: item.external_id || null,
    hue: hue || null,
    name_status: item.name_status || 'page',
    origin: item.origin || 'brand',
    gloss: item.gloss || (isWood ? 'matte' : null),
    pattern: item.pattern || (isWood ? 'wood' : null),
    brand_series: item.brand_series || null,
    wood_species: woodValue('wood_species'),
    wood_species_source: woodValue('wood_species_source'),
    wood_tone: woodValue('wood_tone'),
    grain_type: woodValue('grain_type'),
    grain_scale: woodValue('grain_scale'),
    grain_direction: woodValue('grain_direction'),
    wood_layout: woodValue('wood_layout'),
    surface_finish: woodValue('surface_finish'),
    lab_l: item.lab_l !== undefined ? item.lab_l : woodValue('lab_l'),
    lab_a: item.lab_a !== undefined ? item.lab_a : woodValue('lab_a'),
    lab_b: item.lab_b !== undefined ? item.lab_b : woodValue('lab_b')
  });
  return { id, updated: false };
}

function seedItems(db) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM ba_items').get().c;
  if (count > 0) return;
  const now = Date.now();
  const insertItem = db.prepare(`
    INSERT INTO ba_items (
      id, kind, kind_key, name_zh, prompt_name, hex, family, lightness, role_hint, zone,
      preview_rel, external_sku, created_at, updated_at
    ) VALUES (
      @id, @kind, @kind_key, @name_zh, @prompt_name, @hex, @family, @lightness, @role_hint, @zone,
      NULL, @external_sku, @now, @now
    )
  `);
  const insertMount = db.prepare('INSERT INTO ba_item_mounts (item_id, mount) VALUES (?, ?)');

  const colors = [
    ['color_linghua', '菱花白', '米白珍珠', '#F7F3EA', 'base'],
    ['color_pearl', '珍珠白', '米白珍珠', '#F3EEE4', 'base'],
    ['color_milk', '奶咖', '暖调米咖', '#C8A27A', 'base'],
    ['color_cocoa', '可可蛋奶', '暖调米咖', '#8B5E3C', 'accent'],
    ['color_sage', '鼠尾草绿', '复古草绿', '#9CAF88', 'accent']
  ];
  for (const [id, name, family, hex, role] of colors) {
    insertItem.run({
      id, kind: 'color', kind_key: 'latex', name_zh: name, prompt_name: name,
      hex, family, lightness: lightnessOf(hex), role_hint: role, zone: 'dry',
      external_sku: null, now
    });
    for (const mount of ['ceiling', 'wall']) insertMount.run(id, mount);
  }

  const textures = [
    ['wood_oak', 'wood_flooring', '橡木地板', '#C4A574', ['floor']],
    ['wood_walnut', 'wood_flooring', '胡桃木地板', '#5C4033', ['floor']],
    ['stone_marble', 'stone', '大理石', '#E8E4DF', ['wall', 'floor', 'millwork']],
    ['stone_travertine', 'stone', '洞石', '#D9CBB8', ['wall', 'floor', 'millwork']],
    ['stone_sintered', 'tile', '岩板', '#B7B1A8', ['floor', 'wall', 'millwork']],
    ['stone_terrazzo', 'tile', '水磨石', '#C8C2B4', ['floor', 'wall']],
    ['tile_ceramic', 'tile', '瓷砖', '#D9D3C7', ['floor', 'wall']],
    ['tile_terra', 'tile', '赤陶', '#C46B4A', ['floor', 'wall']],
    ['paper_linen', 'wallpaper', '墙纸', '#E7E0D4', ['wall']],
    ['coat_micro', 'microcement', '微水泥', '#C2BEB6', ['wall', 'ceiling']],
    ['fabric_linen', 'fabric', '棉麻', '#E6D7C3', ['soft']],
    ['fabric_velvet', 'fabric', '丝绒', '#6E4A4A', ['soft']],
    ['fabric_boucle', 'fabric', '羊羔绒', '#E4D5C4', ['soft']],
    ['leather_real', 'leather', '真皮', '#8A5A3B', ['soft']]
  ];
  for (const [id, kindKey, name, hex, mounts] of textures) {
    const zone = kindKey === 'tile' ? 'any' : 'dry';
    insertItem.run({
      id, kind: 'texture', kind_key: kindKey, name_zh: name, prompt_name: name,
      hex, family: null, lightness: lightnessOf(hex), role_hint: null, zone,
      external_sku: null, now
    });
    for (const mount of mounts) insertMount.run(id, mount);
  }

  const designs = [
    ['design_flat_ceiling', 'ceiling_design', '平顶', 'ceiling'],
    ['design_beam', 'ceiling_design', '平顶木梁', 'ceiling'],
    ['design_cornice', 'ceiling_design', '石膏线与灯盘', 'ceiling'],
    ['design_wood_ceiling', 'ceiling_design', '木质天花', 'ceiling'],
    ['design_metal_ceiling', 'ceiling_design', '金属集成吊顶', 'ceiling'],
    ['design_membrane', 'ceiling_design', '发光软膜', 'ceiling'],
    ['design_grille', 'wall_design', '格栅', 'wall'],
    ['design_upholster', 'wall_design', '软硬包', 'wall'],
    ['design_tv_wall', 'wall_design', '电视墙', 'wall'],
    ['design_fireplace', 'wall_design', '文化石壁炉墙', 'wall'],
    ['design_feature_panel', 'wall_design', '特色装饰板', 'wall'],
    ['design_door_skin', 'door_design', '肤感膜门', 'millwork'],
    ['design_door_laminate', 'door_design', '双饰面门', 'millwork'],
    ['design_door_lacquer', 'door_design', '烤漆门', 'millwork'],
    ['design_door_glass', 'door_design', '框门与玻璃门', 'millwork']
  ];
  for (const [id, kindKey, name, mount] of designs) {
    insertItem.run({
      id, kind: 'design', kind_key: kindKey, name_zh: name, prompt_name: name,
      hex: null, family: null, lightness: null, role_hint: null, zone: 'any',
      external_sku: null, now
    });
    insertMount.run(id, mount);
  }

  const products = [
    ['product_sofa', 'furniture', '沙发', 'furniture'],
    ['product_table', 'furniture', '几桌', 'furniture'],
    ['product_dining_table', 'furniture', '餐桌', 'counter'],
    ['product_seat', 'furniture', '椅凳', 'furniture'],
    ['product_bed', 'furniture', '床与柜', 'furniture'],
    ['product_walnut_furniture', 'furniture', '胡桃木家具', 'furniture'],
    ['product_oak_furniture', 'furniture', '橡木家具', 'furniture'],
    ['product_pendant', 'light', '吊灯', 'ceiling'],
    ['product_sconce', 'light', '壁灯', 'wall'],
    ['product_table_lamp', 'light', '台灯', 'furniture'],
    ['product_floor_lamp', 'light', '落地灯', 'floor'],
    ['product_track', 'light', '轨道射灯', 'ceiling'],
    ['product_sanitary', 'fixture', '洁具', 'wall'],
    ['product_tub', 'fixture', '浴缸', 'floor'],
    ['product_faucet', 'fixture', '水槽龙头', 'counter'],
    ['product_shower', 'fixture', '花洒与门窗五金', 'wall'],
    ['product_object', 'soft_goods', '摆件与花器', 'soft'],
    ['product_art', 'soft_goods', '画与画框', 'wall'],
    ['product_carpet', 'carpet', '羊毛地毯', 'product']
  ];
  for (const [id, kindKey, name, mount] of products) {
    insertItem.run({
      id, kind: 'product', kind_key: kindKey, name_zh: name, prompt_name: name,
      hex: null, family: null, lightness: null, role_hint: null, zone: 'any',
      external_sku: null, now
    });
    insertMount.run(id, mount);
  }

  const insertScheme = db.prepare(`
    INSERT OR IGNORE INTO ba_schemes (id, style_leaf, name_zh, sort, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertSlot = db.prepare(`
    INSERT OR IGNORE INTO ba_scheme_slots (scheme_id, surface, role, item_id, sort)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertScheme.run('us_walnut_beam', 'american_country', '胡桃木梁壁炉', 0, now);
  const walnutSlots = [
    ['ceiling', 'any', 'design_beam', 0],
    ['ceiling', 'base', 'color_pearl', 1],
    ['wall', 'base', 'color_milk', 0],
    ['wall', 'accent', 'design_fireplace', 1],
    ['furniture', 'any', 'product_walnut_furniture', 0],
    ['floor', 'any', 'wood_walnut', 0]
  ];
  for (const [surface, role, itemId, sort] of walnutSlots) {
    insertSlot.run('us_walnut_beam', surface, role, itemId, sort);
  }

  insertScheme.run('us_oak_cream', 'american_country', '浅橡奶油', 1, now);
  const oakSlots = [
    ['ceiling', 'any', 'design_flat_ceiling', 0],
    ['ceiling', 'base', 'color_pearl', 1],
    ['wall', 'base', 'color_linghua', 0],
    ['wall', 'accent', 'color_sage', 1],
    ['furniture', 'any', 'product_oak_furniture', 0],
    ['floor', 'any', 'wood_oak', 0]
  ];
  for (const [surface, role, itemId, sort] of oakSlots) {
    insertSlot.run('us_oak_cream', surface, role, itemId, sort);
  }

  const insertRule = db.prepare(`
    INSERT OR IGNORE INTO ba_space_rules (space_key, summary, zones_json) VALUES (?, ?, ?)
  `);
  const rules = [
    ['living', '客厅宜全屋一个基底色，电视墙可以另选一个强调色。', { ceiling: 'dry', wall: 'dry', floor: 'dry' }],
    ['bedroom', '卧室以基底色为主，床头一面可以略深。', { ceiling: 'dry', wall: 'dry', floor: 'dry' }],
    ['dining', '餐厅与客厅共用基底色，背景可以略深。', { ceiling: 'dry', wall: 'dry', floor: 'dry' }],
    ['kitchen', '操作墙用瓷砖。乳胶漆只用于天花和非油烟区。', { ceiling: 'dry', wall: 'wet', floor: 'wet' }],
    ['bath', '湿区用瓷砖。乳胶漆只用于干区天花。', { ceiling: 'dry', wall: 'wet', floor: 'wet' }],
    ['porch', '门外用室外材料，不用内墙乳胶漆。', { ceiling: 'exterior', wall: 'exterior', floor: 'exterior' }],
    ['courtyard', '庭院用室外材料。', { ceiling: 'exterior', wall: 'exterior', floor: 'exterior' }]
  ];
  for (const [key, summary, zones] of rules) {
    insertRule.run(key, summary, JSON.stringify(zones));
  }
}

function ensureItems(db) {
  ensureItemSchema(db);
  seedItems(db);
}

function listItems(db, {
  kind, kindKey, mount, role, family, hue, gloss, pattern, q, hasPreview, pinned, sort,
  brand, brandSeries, woodSpecies, woodTone, grainType, grainScale, grainDirection, woodLayout, surfaceFinish, woodOnly
} = {}) {
  ensureItems(db);
  const where = [];
  const args = [];
  if (kind) { where.push('i.kind = ?'); args.push(kind); }
  if (kindKey) { where.push('i.kind_key = ?'); args.push(kindKey); }
  if (family) { where.push('i.family = ?'); args.push(family); }
  if (hue) { where.push('i.hue = ?'); args.push(hue); }
  if (gloss) { where.push('i.gloss = ?'); args.push(gloss); }
  if (pattern) { where.push('i.pattern = ?'); args.push(pattern); }
  if (brand) { where.push('i.brand = ?'); args.push(brand); }
  if (brandSeries) { where.push('i.brand_series = ?'); args.push(brandSeries); }
  if (woodSpecies) { where.push('i.wood_species = ?'); args.push(woodSpecies); }
  if (woodTone) { where.push('i.wood_tone = ?'); args.push(woodTone); }
  if (grainType) { where.push('i.grain_type = ?'); args.push(grainType); }
  if (grainScale) { where.push('i.grain_scale = ?'); args.push(grainScale); }
  if (grainDirection) { where.push('i.grain_direction = ?'); args.push(grainDirection); }
  if (woodLayout) { where.push('i.wood_layout = ?'); args.push(woodLayout); }
  if (surfaceFinish) { where.push('i.surface_finish = ?'); args.push(surfaceFinish); }
  if (woodOnly) { where.push("i.kind_key = 'wood'"); }
  if (hasPreview) { where.push("i.preview_rel IS NOT NULL AND i.preview_rel != ''"); }
  if (pinned) { where.push('i.is_pinned = 1'); }
  if (q) {
    where.push('(i.name_zh LIKE ? OR i.prompt_name LIKE ? OR i.brand LIKE ? OR i.brand_series LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  if (role === 'base' || role === 'accent') {
    where.push("(i.kind != 'color' OR i.role_hint = ? OR i.role_hint = 'both')");
    args.push(role);
  }
  let join = '';
  if (mount) {
    // millwork 与 cabinet_door 双 id 等价：任一挂载命中即返回（DISTINCT 防双挂载重复行）
    const mountKeys = expandPartForMatch(String(mount).trim());
    const placeholders = mountKeys.map(() => '?').join(',');
    join = `JOIN (SELECT DISTINCT item_id FROM ba_item_mounts WHERE mount IN (${placeholders})) m ON m.item_id = i.id`;
    args.unshift(...mountKeys);
  }

  let orderSql = `
    ORDER BY
      CASE i.hue
        WHEN 'white' THEN 1
        WHEN 'yellow' THEN 2
        WHEN 'green' THEN 3
        WHEN 'blue' THEN 4
        WHEN 'red' THEN 5
        WHEN 'gray' THEN 6
        WHEN 'black' THEN 7
        WHEN 'brown' THEN 8
        ELSE 9
      END,
      i.family,
      i.lightness DESC,
      i.name_zh
  `;
  if (sort === 'frequent') {
    orderSql = `ORDER BY i.is_pinned DESC, i.use_count DESC, i.updated_at DESC`;
  } else if (sort === 'wood') {
    orderSql = `
      ORDER BY
        CASE i.wood_tone WHEN 'light' THEN 1 WHEN 'medium' THEN 2 WHEN 'dark' THEN 3 ELSE 4 END,
        CASE i.wood_species
          WHEN 'white_oak' THEN 1 WHEN 'red_oak' THEN 2 WHEN 'ash' THEN 3 WHEN 'walnut' THEN 4
          WHEN 'cherry' THEN 5 WHEN 'teak' THEN 6 WHEN 'maple' THEN 7 WHEN 'pine' THEN 8
          WHEN 'engineered' THEN 9 ELSE 10
        END,
        i.name_zh
    `;
  }

  const sql = `
    SELECT i.*,
      (SELECT GROUP_CONCAT(bm.mount) FROM ba_item_mounts bm WHERE bm.item_id = i.id) AS mounts
    FROM ba_items i
    ${join}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ${orderSql}
  `;
  return db.prepare(sql).all(...args);
}

function updateItem(db, id, patch = {}) {
  ensureItems(db);
  const existing = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(id);
  if (!existing) return null;

  let isPinned = existing.is_pinned !== undefined && existing.is_pinned !== null ? Number(existing.is_pinned) : 0;
  if (patch.is_pinned !== undefined) {
    isPinned = patch.is_pinned ? 1 : 0;
  }

  let useCount = existing.use_count !== undefined && existing.use_count !== null ? Number(existing.use_count) : 0;
  if (patch.action === 'use') {
    useCount += 1;
  } else if (patch.use_count !== undefined) {
    useCount = Math.max(0, Number(patch.use_count) || 0);
  }

  const now = Date.now();
  db.prepare(`
    UPDATE ba_items 
    SET is_pinned = ?, use_count = ?, updated_at = ? 
    WHERE id = ?
  `).run(isPinned, useCount, now, id);

  // 同名变体联动：如果同一材质名有多款工艺规格，置顶状态与使用次数联动同步
  if (existing.name_zh) {
    if (patch.is_pinned !== undefined) {
      db.prepare('UPDATE ba_items SET is_pinned = ?, updated_at = ? WHERE name_zh = ?')
        .run(isPinned, now, existing.name_zh);
    }
    if (patch.action === 'use') {
      db.prepare('UPDATE ba_items SET use_count = use_count + 1, updated_at = ? WHERE name_zh = ? AND id != ?')
        .run(now, existing.name_zh, id);
    }
  }

  return {
    ...existing,
    is_pinned: isPinned,
    use_count: useCount,
    updated_at: now
  };
}

function parseJsonSafe(value, fallback) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function slotSurfaceLabel(surface) {
  return SURFACE_LABELS[surface] || surface;
}

function slotRows(db, schemeId) {
  return db.prepare(`
    SELECT s.surface, s.role, s.space_key, s.sort,
           i.id AS item_id, i.name_zh, i.kind, i.kind_key, i.brand, i.external_sku,
           i.prompt_name, i.preview_rel, i.hex, i.gloss, i.pattern,
           i.wood_species, i.wood_tone, i.grain_type, i.grain_scale, i.grain_direction,
           i.wood_layout, i.surface_finish, i.brand_series, i.lab_l, i.lab_a, i.lab_b
    FROM ba_scheme_slots s
    JOIN ba_items i ON i.id = s.item_id
    WHERE s.scheme_id = ?
    ORDER BY s.space_key, s.surface, s.role, s.sort
  `).all(schemeId).map((row) => ({
    ...row,
    surface_label: slotSurfaceLabel(row.surface)
  }));
}

function listStyles(db) {
  ensureItems(db);
  const count = db.prepare('SELECT COUNT(*) AS c FROM ba_styles WHERE deleted_at IS NULL').get().c;
  if (count === 0) {
    try {
      const { FINE_STYLES } = require('./style-schemes.seed');
      const now = Date.now();
      const insertStyle = db.prepare(`
        INSERT OR REPLACE INTO ba_styles (id, name_zh, parent_style_key, description, source, sort, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'system', ?, ?, ?)
      `);
      const trx = db.transaction(() => {
        for (const s of FINE_STYLES) {
          insertStyle.run(s.id, s.name_zh, s.parent_style_key, s.description || '', s.sort || 0, now, now);
        }
      });
      trx();
    } catch (_) {}
  }
  const styles = db.prepare(`
    SELECT * FROM ba_styles
    WHERE deleted_at IS NULL
    ORDER BY sort, created_at, name_zh
  `).all();
  const countStmt = db.prepare(`
    SELECT COUNT(*) AS c FROM ba_schemes
    WHERE style_id = ? AND deleted_at IS NULL
  `);
  return styles.map((style) => ({
    ...style,
    tags: parseJsonSafe(style.tags_json, []),
    scheme_count: countStmt.get(style.id)?.c || 0
  }));
}

function listSchemes(db, { styleId } = {}) {
  ensureItems(db);
  let schemes;
  if (styleId) {
    schemes = db.prepare(`
      SELECT s.*, st.name_zh AS style_name
      FROM ba_schemes s
      LEFT JOIN ba_styles st ON st.id = s.style_id
      WHERE s.deleted_at IS NULL AND s.style_id = ?
      ORDER BY s.sort, s.name_zh
    `).all(styleId);
  } else {
    schemes = db.prepare(`
      SELECT s.*, st.name_zh AS style_name
      FROM ba_schemes s
      LEFT JOIN ba_styles st ON st.id = s.style_id
      WHERE s.deleted_at IS NULL
      ORDER BY COALESCE(st.sort, 0), s.style_leaf, s.sort, s.name_zh
    `).all();
  }
  return schemes.map((scheme) => ({
    ...scheme,
    palette: parseJsonSafe(scheme.palette_json, []),
    space_scope: parseJsonSafe(scheme.space_scope_json, []),
    slots: slotRows(db, scheme.id)
  }));
}

function compileScheme(db, schemeId, { spaceKey, targetTag = '@图1', startRefIndex = 2 } = {}) {
  ensureItems(db);
  const scheme = db.prepare('SELECT * FROM ba_schemes WHERE id = ? AND deleted_at IS NULL').get(schemeId);
  if (!scheme) return null;
  let slots = db.prepare(`
    SELECT s.surface, s.role, s.space_key, s.sort, i.*
    FROM ba_scheme_slots s
    JOIN ba_items i ON i.id = s.item_id
    WHERE s.scheme_id = ?
    ORDER BY s.space_key, s.surface, s.role, s.sort
  `).all(schemeId);
  const bySpace = new Map();
  for (const slot of slots) {
    const key = slot.space_key || 'any';
    if (!bySpace.has(key)) bySpace.set(key, []);
    bySpace.get(key).push(slot);
  }
  if (spaceKey && bySpace.has(spaceKey)) {
    slots = [...(bySpace.get('any') || []), ...(bySpace.get(spaceKey) || [])];
  } else {
    slots = bySpace.get('any') || slots;
  }
  const roleLabel = (role) => (role === 'base' ? '基底' : role === 'accent' ? '强调' : '');

  // 提取带有效预览图的插槽，作为可挂载材质参考图
  const refSlots = slots.filter((slot) => Boolean(slot.preview_rel));
  const refMap = new Map();
  const refs = refSlots.map((slot, idx) => {
    const surfaceName = SURFACE_LABELS[slot.surface] || slot.surface;
    const refTag = `@图${startRefIndex + idx}`;
    refMap.set(slot.id, refTag);
    return {
      item_id: slot.id,
      surface: slot.surface,
      surface_label: surfaceName,
      name: `${scheme.name_zh}_${surfaceName}`,
      tag: refTag,
      rel: slot.preview_rel,
      url: `/api/base-library/items/${encodeURIComponent(slot.id)}/preview`
    };
  });

  // 1. 纯文本描述行（轻量快速，注重准确具体的品牌、色号、光泽与材质）
  const textLines = slots.map((slot) => {
    const face = SURFACE_LABELS[slot.surface] || slot.surface;
    const role = roleLabel(slot.role);
    const model = slot.brand || slot.external_sku
      ? `（${[slot.brand, slot.external_sku].filter(Boolean).join(' ')}）`
      : '';
    return `${face}${role ? '（' + role + '）' : ''}：${slot.prompt_name}${model}`;
  });

  // 2. 带图参考的描述行（引用托盘中材质图的编号）
  const multiModalLines = slots.map((slot) => {
    const face = SURFACE_LABELS[slot.surface] || slot.surface;
    const role = roleLabel(slot.role);
    const model = slot.brand || slot.external_sku
      ? `（${[slot.brand, slot.external_sku].filter(Boolean).join(' ')}）`
      : '';
    const refTag = refMap.get(slot.id);
    const refPrefix = refTag ? `参考【${refTag} ${face}材质】` : '';
    return `${face}${role ? '（' + role + '）' : ''}：${refPrefix}${slot.prompt_name}${model}`;
  });

  const promptText = `将【${targetTag}】按「${scheme.name_zh}」空间风格更换各表面的材质和颜色。\n${textLines.join('。\n')}。\n要求：只替换材质、乳胶漆、地板等基材的颜色与质感，严格保持原有空间结构、布局、透视、光影和主要家具位置不变。`;
  const promptMultimodal = `将【${targetTag}】按「${scheme.name_zh}」空间风格更换各表面的材质和颜色，并严格对照提供的材质切片大样：\n${multiModalLines.join('。\n')}。\n要求：各表面材质质感与色泽与对应参考图保持高一致性，严格保持原有空间结构、布局、透视、光影和主要家具位置不变。`;

  return {
    scheme_id: scheme.id,
    style_id: scheme.style_id,
    style_leaf: scheme.style_leaf,
    style_name: scheme.name_zh,
    name_zh: scheme.name_zh,
    prompt: promptText,
    prompt_text: promptText,
    prompt_multimodal: promptMultimodal,
    refs,
    slots
  };
}

function setItemMount(db, itemId, mount) {
  if (!itemId || !SURFACES.includes(mount)) return false;
  ensureItems(db);
  db.prepare('INSERT OR IGNORE INTO ba_item_mounts (item_id, mount) VALUES (?, ?)').run(itemId, mount);
  return true;
}

function clusterSchemeDraft(db, itemIds) {
  ensureItems(db);
  const ids = [...new Set((itemIds || []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 80);
  if (!ids.length) return { slots: [], counts: { items: 0, mounts: {} } };
  const rows = db.prepare(`
    SELECT i.id, i.kind, i.kind_key, i.name_zh, i.family,
           GROUP_CONCAT(m.mount) AS mounts
    FROM ba_items i
    LEFT JOIN ba_item_mounts m ON m.item_id = i.id
    WHERE i.id IN (${ids.map(() => '?').join(',')})
    GROUP BY i.id
  `).all(...ids);
  const byMount = new Map();
  for (const row of rows) {
    const mounts = String(row.mounts || '').split(',').map((part) => part.trim()).filter((part) => SURFACES.includes(part));
    const faces = mounts.length ? mounts : ['wall'];
    for (const face of faces) {
      if (!byMount.has(face)) byMount.set(face, []);
      byMount.get(face).push(row);
    }
  }
  const slots = [];
  const counts = { items: rows.length, mounts: {} };
  for (const [surface, list] of byMount) {
    counts.mounts[surface] = list.length;
    const colors = list.filter((row) => row.kind === 'color' || row.kind_key === 'latex');
    const families = new Map();
    for (const row of colors) {
      const key = row.family || row.name_zh || '未分组';
      if (!families.has(key)) families.set(key, []);
      families.get(key).push(row);
    }
    const ranked = [...families.values()].sort((a, b) => b.length - a.length);
    if (ranked[0]) {
      slots.push({
        surface,
        role: ranked[1] ? 'base' : 'any',
        item_id: ranked[0][0].id,
        name_zh: ranked[0][0].name_zh
      });
    }
    if (ranked[1]) {
      slots.push({
        surface,
        role: 'accent',
        item_id: ranked[1][0].id,
        name_zh: ranked[1][0].name_zh
      });
    }
    const others = list.filter((row) => !(row.kind === 'color' || row.kind_key === 'latex'));
    const kinds = new Map();
    for (const row of others) {
      const key = row.kind_key || 'other';
      if (!kinds.has(key)) kinds.set(key, []);
      kinds.get(key).push(row);
    }
    const topKind = [...kinds.values()].sort((a, b) => b.length - a.length)[0];
    if (topKind) {
      slots.push({
        surface,
        role: 'any',
        item_id: topKind[0].id,
        name_zh: topKind[0].name_zh
      });
    }
  }
  return { slots, counts };
}

function createScheme(db, { name_zh, style_leaf, slots } = {}) {
  ensureItems(db);
  const name = String(name_zh || '').trim();
  const leaf = String(style_leaf || '').trim();
  if (!name || !leaf) {
    const err = new Error('方案名称和风格叶子都不能空');
    err.code = 'name_required';
    throw err;
  }
  const id = `scheme_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO ba_schemes (id, style_leaf, name_zh, sort, created_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(id, leaf, name, Date.now());
  const exists = db.prepare('SELECT id FROM ba_items WHERE id = ?');
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ba_scheme_slots (scheme_id, surface, role, item_id, sort)
    VALUES (?, ?, ?, ?, ?)
  `);
  let written = 0;
  for (const slot of Array.isArray(slots) ? slots : []) {
    const itemId = String(slot?.item_id || '').trim();
    if (!itemId || !exists.get(itemId) || !SURFACES.includes(slot.surface)) continue;
    const role = slot.role === 'base' || slot.role === 'accent' ? slot.role : 'any';
    insert.run(id, slot.surface, role, itemId, written);
    written += 1;
  }
  return { id, name_zh: name, style_leaf: leaf, slots: written };
}

const STYLE_SOURCES = new Set(['human', 'ai']);

function upsertStyle(db, data = {}) {
  ensureItems(db);
  const now = Date.now();
  const name = String(data.name_zh || '').trim();
  if (!name) {
    const err = new Error('风格名称不能为空');
    err.code = 'name_required';
    throw err;
  }
  const id = String(data.id || `style_${now}_${Math.random().toString(36).slice(2, 6)}`);
  const existing = db.prepare('SELECT id FROM ba_styles WHERE id = ?').get(id);
  const row = {
    id,
    name_zh: name,
    parent_style_key: String(data.parent_style_key || '').trim() || null,
    description: String(data.description || ''),
    cover_rel: String(data.cover_rel || '') || null,
    source: STYLE_SOURCES.has(data.source) ? data.source : 'human',
    tags_json: JSON.stringify(Array.isArray(data.tags) ? data.tags : []),
    sort: Number.isFinite(Number(data.sort)) ? Number(data.sort) : 0,
    updated_at: now
  };
  if (existing) {
    db.prepare(`
      UPDATE ba_styles
      SET name_zh=@name_zh, parent_style_key=@parent_style_key, description=@description,
          cover_rel=@cover_rel, source=@source, tags_json=@tags_json, sort=@sort, updated_at=@updated_at
      WHERE id=@id
    `).run(row);
  } else {
    db.prepare(`
      INSERT INTO ba_styles
        (id, name_zh, parent_style_key, description, cover_rel, source, tags_json, sort, created_at, updated_at, deleted_at)
      VALUES
        (@id, @name_zh, @parent_style_key, @description, @cover_rel, @source, @tags_json, @sort, @updated_at, @updated_at, NULL)
    `).run(row);
  }
  return db.prepare('SELECT * FROM ba_styles WHERE id = ?').get(id);
}

function softDeleteStyle(db, id) {
  ensureItems(db);
  const now = Date.now();
  db.prepare('UPDATE ba_styles SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  db.prepare('UPDATE ba_schemes SET deleted_at = ?, updated_at = ? WHERE style_id = ?').run(now, now, id);
  return { id, deleted_at: now };
}

function normalizeSlot(slot, index) {
  const itemId = String(slot?.item_id || '').trim();
  const surface = String(slot?.surface || '').trim();
  if (!itemId || !SURFACES.includes(surface)) return null;
  const role = ['base', 'accent', 'sofa', 'curtain', 'rug', 'bed', 'chair'].includes(slot.role)
    ? slot.role
    : 'any';
  return {
    space_key: String(slot.space_key || 'any').trim() || 'any',
    surface,
    role,
    item_id: itemId,
    sort: Number.isFinite(Number(slot.sort)) ? Number(slot.sort) : index
  };
}

function replaceSchemeSlots(db, schemeId, slots) {
  ensureItems(db);
  const normalized = (Array.isArray(slots) ? slots : [])
    .map(normalizeSlot)
    .filter(Boolean);
  db.prepare('DELETE FROM ba_scheme_slots WHERE scheme_id = ?').run(schemeId);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO ba_scheme_slots (scheme_id, space_key, surface, role, item_id, sort)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const slot of normalized) insert.run(schemeId, slot.space_key, slot.surface, slot.role, slot.item_id, slot.sort);
  return normalized;
}

function upsertScheme(db, data = {}) {
  ensureItems(db);
  const now = Date.now();
  const name = String(data.name_zh || '').trim();
  const styleId = String(data.style_id || '').trim();
  const styleLeaf = String(data.style_leaf || '').trim();
  if (!name) {
    const err = new Error('方案名称不能为空');
    err.code = 'name_required';
    throw err;
  }
  if (!styleId && !styleLeaf) {
    const err = new Error('方案必须关联精细风格');
    err.code = 'style_required';
    throw err;
  }
  const id = String(data.id || `scheme_${now}_${Math.random().toString(36).slice(2, 6)}`);
  const existing = db.prepare('SELECT id FROM ba_schemes WHERE id = ? AND deleted_at IS NULL').get(id);
  const row = {
    id,
    style_id: styleId || null,
    style_leaf: styleLeaf || null,
    name_zh: name,
    description: String(data.description || ''),
    cover_rel: String(data.cover_rel || '') || null,
    palette_json: JSON.stringify(Array.isArray(data.palette) ? data.palette : []),
    space_scope_json: JSON.stringify(Array.isArray(data.space_scope) ? data.space_scope : []),
    sort: Number.isFinite(Number(data.sort)) ? Number(data.sort) : 0,
    updated_at: now
  };
  if (existing) {
    db.prepare(`
      UPDATE ba_schemes
      SET style_id=@style_id, style_leaf=@style_leaf, name_zh=@name_zh, description=@description,
          cover_rel=@cover_rel, palette_json=@palette_json, space_scope_json=@space_scope_json,
          sort=@sort, updated_at=@updated_at, deleted_at=NULL
      WHERE id=@id
    `).run(row);
  } else {
    db.prepare(`
      INSERT INTO ba_schemes
        (id, style_id, style_leaf, name_zh, description, cover_rel, palette_json, space_scope_json, sort, created_at, updated_at, deleted_at)
      VALUES
        (@id, @style_id, @style_leaf, @name_zh, @description, @cover_rel, @palette_json, @space_scope_json, @sort, @updated_at, @updated_at, NULL)
    `).run(row);
  }
  const slots = Object.prototype.hasOwnProperty.call(data, 'slots') ? replaceSchemeSlots(db, id, data.slots) : slotRows(db, id);
  return { ...db.prepare('SELECT * FROM ba_schemes WHERE id = ?').get(id), slots };
}

function softDeleteScheme(db, id) {
  ensureItems(db);
  const now = Date.now();
  db.prepare('UPDATE ba_schemes SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  return { id, deleted_at: now };
}

function suggestItems(db, { surface, role, schemeId, space } = {}) {
  ensureItems(db);
  const rule = space
    ? db.prepare('SELECT * FROM ba_space_rules WHERE space_key = ?').get(space)
    : null;
  let zones = {};
  try { zones = rule ? JSON.parse(rule.zones_json || '{}') : {}; } catch { zones = {}; }
  const zone = (surface && zones[surface]) || 'dry';
  const items = listItems(db, { mount: surface, role });
  const compatible = items.filter((item) => item.zone === 'any' || item.zone === zone || zone === 'any');
  let slotIds = [];
  if (schemeId && surface) {
    slotIds = db.prepare(`
      SELECT item_id FROM ba_scheme_slots
      WHERE scheme_id = ? AND surface = ?
      ORDER BY sort
    `).all(schemeId, surface).map((row) => row.item_id);
  }
  const rank = new Map(slotIds.map((id, index) => [id, index]));
  compatible.sort((a, b) => {
    const ar = rank.has(a.id) ? rank.get(a.id) : 1000;
    const br = rank.has(b.id) ? rank.get(b.id) : 1000;
    if (ar !== br) return ar - br;
    return (b.lightness || 0) - (a.lightness || 0);
  });
  return {
    summary: rule ? rule.summary : '',
    zone,
    items: compatible
  };
}

module.exports = {
  SURFACES,
  SURFACE_LABELS,
  lightnessOf,
  ensureItems,
  listItems,
  updateItem,
  listStyles,
  listSchemes,
  compileScheme,
  suggestItems,
  upsertCatalogItem,
  setItemMount,
  clusterSchemeDraft,
  createScheme,
  upsertStyle,
  softDeleteStyle,
  upsertScheme,
  softDeleteScheme,
  replaceSchemeSlots,
  hueFromHex,
  HUE_LABELS,
  HUE_ORDER
};
