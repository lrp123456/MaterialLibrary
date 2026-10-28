/**
 * 基础属性库标准预置种子数据 (材质、色号与色块自动铺底)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { generateSwatchBuffer } = require('./swatch');

const SEED_PAINTS = [
  {
    id: 'paint_nippon-paint_NP_N_2034P',
    brand: 'nippon-paint',
    code: 'NP N 2034P',
    name_en: 'Abacadabra',
    name_zh: '暖调米色',
    alias_zh: '经典暖米灰',
    hex: '#CDC8C1',
    family: 'beige',
    lrv: 58,
    interior: 1,
    pinned: 1,
    source_url: 'https://paintdb.com/colors/nippon-paint/np-np-n-2034p-abacadabra'
  },
  {
    id: 'paint_nippon-paint_NP_OW_038_4',
    brand: 'nippon-paint',
    code: 'NP OW 038-4',
    name_en: 'Pearl White',
    name_zh: '中性珍珠白',
    alias_zh: '柔光珍珠白',
    hex: '#F4F1EA',
    family: 'off-white',
    lrv: 82,
    interior: 1,
    pinned: 1,
    source_url: 'https://paintdb.com/colors/nippon-paint/np-ow-038-4-pearl-white'
  },
  {
    id: 'paint_nippon-paint_NP_N_1950_4',
    brand: 'nippon-paint',
    code: 'NP N 1950-4',
    name_en: 'Milk Coffee',
    name_zh: '暖调奶咖',
    alias_zh: '法式温润奶咖',
    hex: '#D6C7B7',
    family: 'beige',
    lrv: 52,
    interior: 1,
    pinned: 1,
    source_url: 'https://paintdb.com/colors/nippon-paint/np-n-1950-4-milk-coffee'
  },
  {
    id: 'paint_nippon-paint_NP_N_0070_4',
    brand: 'nippon-paint',
    code: 'NP N 0070-4',
    name_en: 'Space Walk',
    name_zh: '冷调太空漫步灰',
    alias_zh: '太空漫步',
    hex: '#B8BCBF',
    family: 'gray',
    lrv: 48,
    interior: 1,
    pinned: 1,
    source_url: 'https://paintdb.com/colors/nippon-paint/np-n-0070-4-space-walk'
  },
  {
    id: 'paint_nippon-paint_NP_BGG_1560_4',
    brand: 'nippon-paint',
    code: 'NP BGG 1560-4',
    name_en: 'Sage Green',
    name_zh: '冷调鼠尾草绿',
    alias_zh: '复古鼠尾草',
    hex: '#B5C4B7',
    family: 'green',
    lrv: 50,
    interior: 1,
    pinned: 1,
    source_url: 'https://paintdb.com/colors/nippon-paint/np-bgg-1560-4-sage-green'
  },
  {
    id: 'paint_nippon-paint_NP_N_0020_4',
    brand: 'nippon-paint',
    code: 'NP N 0020-4',
    name_en: 'Classic Ivory',
    name_zh: '中性象牙白',
    alias_zh: '象牙白',
    hex: '#EDE8DE',
    family: 'ivory',
    lrv: 78,
    interior: 1,
    pinned: 1,
    source_url: 'https://paintdb.com/colors/nippon-paint/np-n-0020-4-classic-ivory'
  },
  {
    id: 'paint_dulux_259208',
    brand: 'dulux',
    code: '259208',
    name_en: 'Natural Hessian',
    name_zh: '暖调灰米色',
    alias_zh: '原麻灰米',
    hex: '#D8CFBF',
    family: 'greige',
    lrv: 56,
    interior: 1,
    pinned: 1,
    source_url: 'https://paintdb.com/colors/dulux/259208-natural-hessian'
  },
  {
    id: 'paint_dulux_40YY_83_043',
    brand: 'dulux',
    code: '40YY 83/043',
    name_en: 'Gentle Fawn',
    name_zh: '暖调浅驼灰',
    alias_zh: '小羊驼浅灰',
    hex: '#DDD5C7',
    family: 'beige',
    lrv: 62,
    interior: 1,
    pinned: 1,
    source_url: 'https://paintdb.com/colors/dulux/40yy-83-043-gentle-fawn'
  },
  {
    id: 'paint_dulux_30BB_72_003',
    brand: 'dulux',
    code: '30BB 72/003',
    name_en: 'Snowfield',
    name_zh: '中性雪域白',
    alias_zh: '雪域白',
    hex: '#EAECEE',
    family: 'white',
    lrv: 80,
    interior: 1,
    pinned: 1,
    source_url: 'https://paintdb.com/colors/dulux/30bb-72-003-snowfield'
  },
  {
    id: 'paint_dulux_00NN_62_000',
    brand: 'dulux',
    code: '00NN 62/000',
    name_en: 'Neutral Gray',
    name_zh: '中性银灰色',
    alias_zh: '静音浅灰',
    hex: '#9FA2A6',
    family: 'gray',
    lrv: 38,
    interior: 1,
    pinned: 1,
    source_url: 'https://paintdb.com/colors/dulux/00nn-62-000-neutral-gray'
  }
];

const SEED_MATERIALS = [
  {
    id: 'mat_white_oak',
    name_cn: '天然白橡木木地板',
    source: 'ambientcg',
    source_id: 'WoodFloor041',
    license_note: 'ambientCG, CC0',
    is_shell: 0,
    hex: '#C8A882',
    tags: [
      { surface: 'floor', subclass: 'floor_wood' },
      { surface: 'wall', subclass: 'wall_paneling' }
    ]
  },
  {
    id: 'mat_black_walnut',
    name_cn: '北美黑胡桃护墙板',
    source: 'ambientcg',
    source_id: 'Wood049',
    license_note: 'ambientCG, CC0',
    is_shell: 0,
    hex: '#4A3525',
    tags: [
      { surface: 'wall', subclass: 'wall_paneling' },
      { surface: 'millwork', subclass: 'millwork_door' }
    ]
  },
  {
    id: 'mat_roman_travertine',
    name_cn: '罗马洞石天然石材',
    source: 'ambientcg',
    source_id: 'Travertine001',
    license_note: 'ambientCG, CC0',
    is_shell: 0,
    hex: '#D9CDBB',
    tags: [
      { surface: 'floor', subclass: 'floor_stone' },
      { surface: 'wall', subclass: 'wall_tile' },
      { surface: 'millwork', subclass: 'millwork_top' }
    ]
  },
  {
    id: 'mat_calacatta_marble',
    name_cn: '鱼肚白大理石大板',
    source: 'polyhaven',
    source_id: 'marble_01',
    license_note: 'Poly Haven, CC0',
    is_shell: 0,
    hex: '#EBEBEB',
    tags: [
      { surface: 'floor', subclass: 'floor_stone' },
      { surface: 'wall', subclass: 'wall_tile' },
      { surface: 'millwork', subclass: 'millwork_top' }
    ]
  },
  {
    id: 'mat_micro_cement',
    name_cn: '浅灰一体微水泥 (艺术漆壳)',
    source: 'ambientcg',
    source_id: 'Concrete034',
    license_note: 'ambientCG, CC0',
    is_shell: 1,
    hex: '#C2BEB6',
    tags: [
      { surface: 'wall', subclass: 'wall_paint' },
      { surface: 'floor', subclass: 'floor_epoxy' }
    ]
  },
  {
    id: 'mat_linen_fabric',
    name_cn: '素色高支棉麻布艺',
    source: 'ambientcg',
    source_id: 'Fabric045',
    license_note: 'ambientCG, CC0',
    is_shell: 0,
    hex: '#D6CEBE',
    tags: [
      { surface: 'soft', subclass: 'soft_fabric' },
      { surface: 'furniture', subclass: 'chair_fabric' }
    ]
  },
  {
    id: 'mat_terrazzo_gray',
    name_cn: '精细无缝水磨石地砖',
    source: 'ambientcg',
    source_id: 'Terrazzo012',
    license_note: 'ambientCG, CC0',
    is_shell: 0,
    hex: '#BAB6AF',
    tags: [
      { surface: 'floor', subclass: 'floor_stone' },
      { surface: 'wall', subclass: 'wall_tile' }
    ]
  },
  {
    id: 'mat_gypsum_cornice',
    name_cn: '精工哑光石膏天花板',
    source: 'ambientcg',
    source_id: 'Plaster001',
    license_note: 'ambientCG, CC0',
    is_shell: 0,
    hex: '#F0EEEB',
    tags: [
      { surface: 'ceiling', subclass: 'ceiling_panel' },
      { surface: 'ceiling', subclass: 'ceiling_cornice' }
    ]
  }
];

async function seedBaseLibraryData(db, dataDir) {
  const now = Date.now();

  // 1. 种子化色号
  const insPaint = db.prepare(`
    INSERT OR IGNORE INTO ba_paints (
      id, brand, code, name_en, name_zh, alias_zh, hex, family, lrv,
      interior, pinned, shell_material_id, swatch_rel, source_url, created_at, updated_at
    ) VALUES (
      @id, @brand, @code, @name_en, @name_zh, @alias_zh, @hex, @family, @lrv,
      @interior, @pinned, @shell_material_id, @swatch_rel, @source_url, @created_at, @updated_at
    )
  `);

  for (const p of SEED_PAINTS) {
    const swatchRel = `cache/base-library/paints/${p.id}/swatch.png`;
    insPaint.run({
      ...p,
      shell_material_id: 'mat_micro_cement',
      swatch_rel: swatchRel,
      created_at: now,
      updated_at: now
    });

    // 确保本地色块文件存在
    if (dataDir) {
      const fullPath = path.resolve(dataDir, swatchRel);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        const buf = await generateSwatchBuffer(p.hex);
        fs.writeFileSync(fullPath, buf);
      }
    }
  }

  // 2. 种子化材质
  const insMat = db.prepare(`
    INSERT OR IGNORE INTO ba_materials (
      id, name_cn, source, source_id, license_note, is_shell,
      preview_rel, basecolor_rel, width, height, created_at, updated_at
    ) VALUES (
      @id, @name_cn, @source, @source_id, @license_note, @is_shell,
      @preview_rel, @basecolor_rel, @width, @height, @created_at, @updated_at
    )
  `);

  const insTag = db.prepare(`
    INSERT OR IGNORE INTO ba_asset_tags (asset_kind, asset_id, surface, subclass)
    VALUES (?, ?, ?, ?)
  `);

  for (const m of SEED_MATERIALS) {
    const ext = m.id === 'mat_calacatta_marble' ? '.png' : '.jpg';
    const previewRel = `cache/base-library/materials/${m.id}/sphere${ext}`;
    const basecolorRel = `cache/base-library/materials/${m.id}/basecolor.jpg`;
    insMat.run({
      id: m.id,
      name_cn: m.name_cn,
      source: m.source,
      source_id: m.source_id,
      license_note: m.license_note,
      is_shell: m.is_shell,
      preview_rel: previewRel,
      basecolor_rel: basecolorRel,
      width: 1024,
      height: 1024,
      created_at: now,
      updated_at: now
    });

    for (const t of m.tags) {
      insTag.run('material', m.id, t.surface, t.subclass);
    }

    // 确保本地 1K 底色图存在
    if (dataDir) {
      const fullPath = path.resolve(dataDir, basecolorRel);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        const buf = await sharp({
          create: {
            width: 1024,
            height: 1024,
            channels: 3,
            background: m.hex
          }
        }).jpeg({ quality: 85 }).toBuffer();
        fs.writeFileSync(fullPath, buf);
      }
    }
  }

  // 3. 关联常用芯片槽位
  const updateSlot = db.prepare('UPDATE ba_preset_slots SET material_id = ?, updated_at = ? WHERE id = ?');
  updateSlot.run('mat_white_oak', now, 'white_oak');
  updateSlot.run('mat_black_walnut', now, 'black_walnut');
  updateSlot.run('mat_roman_travertine', now, 'roman_travertine');
  updateSlot.run('mat_calacatta_marble', now, 'calacatta_marble');
  updateSlot.run('mat_linen_fabric', now, 'linen_fabric');
}

module.exports = {
  SEED_PAINTS,
  SEED_MATERIALS,
  seedBaseLibraryData
};
