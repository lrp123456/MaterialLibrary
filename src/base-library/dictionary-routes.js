/**
 * 室内设计 Master 统一字典业务层与 CRUD 处理
 * 包含部位、基材品类、专属色卡/纹理全量 CRUD 及「物理测色 + VLM 智能美学赋名」
 */

const {
  hexToLab,
  calculateLrv,
  deriveColorFamily,
  matchClosestSwatches,
  extractDominantHexFromBuffer,
  generateAestheticColorName
} = require('./color-engine');
const { ensureBaseLibrarySchema } = require('./schema');
const { seedMasterDictionary } = require('./master-dictionary-seed');
const { expandPartForMatch } = require('./part-policy');

// millwork<->cabinet_door 的双轨归一统一由 part-policy.expandPartForMatch 处理，
// 这里只保留历史遗留的旧名兼容
const PART_ALIAS_MAP = {
  furniture: 'upholstery',
  soft: 'upholstery',
  lighting: 'hard_furniture',
  fixture: 'hard_furniture'
};

const SWATCH_KIND_MAP = {
  mat_cat_latex: { kind: '乳胶漆', kind_key: 'latex' },
  mat_cat_art_plaster: { kind: '艺术漆/微水泥', kind_key: 'microcement' },
  mat_cat_leather: { kind: '头层真皮', kind_key: 'leather' },
  mat_cat_fabric_upholstery: { kind: '沙发软包布艺', kind_key: 'fabric' },
  mat_cat_wood_panel: { kind: '实木护墙板与木皮', kind_key: 'wood' },
  mat_cat_wood_floor: { kind: '实木木地板', kind_key: 'wood_flooring' },
  mat_cat_stone: { kind: '大理石与洞石岩板', kind_key: 'stone' },
  mat_cat_cabinet_lacquer: { kind: '定制柜门烤漆/PET', kind_key: 'cabinet_lacquer' },
  mat_cat_metal: { kind: '金属五金', kind_key: 'metal' },
  mat_cat_glass: { kind: '玻璃镜面', kind_key: 'glass' },
  mat_cat_textile_drapery: { kind: '窗帘床品', kind_key: 'drapery' },
  mat_cat_carpet: { kind: '地毯织物', kind_key: 'carpet' },
  mat_cat_tile: { kind: '瓷砖花砖', kind_key: 'tile' }
};

/**
 * 强幂等 Master 字典自愈保障：若表不存在或条目数不足则自动播种
 */
function ensureMasterDictionaryReady(db) {
  try {
    ensureBaseLibrarySchema(db);
    const partCount = db.prepare('SELECT COUNT(*) AS c FROM ba_parts WHERE enabled = 1').get()?.c || 0;
    const swatchCount = db.prepare('SELECT COUNT(*) AS c FROM ba_material_swatches WHERE enabled = 1').get()?.c || 0;
    if (partCount < 8 || swatchCount < 30) {
      seedMasterDictionary(db);
    }
  } catch (err) {
    console.warn('[dictionary] ensureMasterDictionaryReady warning:', err.message);
  }
}

function syncSwatchToBaItems(db, sw) {
  try {
    const kInfo = SWATCH_KIND_MAP[sw.category_id] || { kind: '基础基材', kind_key: 'base' };
    const now = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO ba_items (
        id, kind, kind_key, name_zh, prompt_name, hex, family, lightness,
        role_hint, zone, preview_rel, external_sku, created_at, updated_at
      ) VALUES (
        :id, :kind, :kind_key, :name_zh, :prompt_name, :hex, :family, :lightness,
        :role_hint, 'any', :preview_rel, :external_sku, :now, :now
      )
    `).run({
      id: sw.id,
      kind: kInfo.kind,
      kind_key: kInfo.kind_key,
      name_zh: sw.name_zh,
      prompt_name: sw.name_zh,
      hex: sw.hex,
      family: sw.color_family,
      lightness: sw.lrv,
      role_hint: sw.brand ? `${sw.brand} ${sw.code || ''}`.trim() : '',
      preview_rel: sw.preview_path || '',
      external_sku: sw.code || '',
      now
    });

    const cat = db.prepare('SELECT allowed_parts FROM ba_material_categories WHERE id=?').get(sw.category_id);
    if (cat && cat.allowed_parts) {
      let allowedParts = [];
      try { allowedParts = JSON.parse(cat.allowed_parts); } catch (_) {}
      const insMount = db.prepare('INSERT OR IGNORE INTO ba_item_mounts (item_id, mount) VALUES (?, ?)');
      for (const pt of allowedParts) {
        insMount.run(sw.id, pt);
      }
    }
  } catch (err) {
    // 忽略未建表或并发异常
  }
}

function deleteSwatchFromBaItems(db, id) {
  try {
    db.prepare('DELETE FROM ba_items WHERE id=?').run(id);
    db.prepare('DELETE FROM ba_item_mounts WHERE item_id=?').run(id);
  } catch (err) {}
}

/**
 * 获取完整层级联动字典树 (空间部位 ↔ 基材品类 ↔ 专属色卡/纹理与工艺)
 */
function getDictionary(db, { part = '' } = {}) {
  ensureMasterDictionaryReady(db);

  const normPart = (part && PART_ALIAS_MAP[part]) ? PART_ALIAS_MAP[part] : (part || '');

  // 1. 部位列表 (永远返回全部 8 个部位)
  const partsRows = db.prepare('SELECT * FROM ba_parts WHERE enabled=1 ORDER BY sort_order ASC').all();
  const parts = partsRows.map(p => {
    let aliases = [];
    try { aliases = JSON.parse(p.jev_aliases || '[]'); } catch (_) {}
    return {
      id: p.id,
      name_zh: p.name_zh,
      name_en: p.name_en || '',
      jev_aliases: aliases,
      preserve_clause_zh: p.preserve_clause_zh || '',
      preserve_clause_en: p.preserve_clause_en || '',
      default_category_id: p.default_category_id || '',
      sort_order: p.sort_order || 0,
      is_system: Boolean(p.is_system)
    };
  });

  // 2. 基材品类列表 (全部 12 个品类)
  const catRows = db.prepare('SELECT * FROM ba_material_categories WHERE enabled=1 ORDER BY sort_order ASC').all();
  const all_categories = catRows.map(c => {
    let allowedParts = [];
    let finishes = [];
    try { allowedParts = JSON.parse(c.allowed_parts || '[]'); } catch (_) {}
    try { finishes = JSON.parse(c.finishes_json || '[]'); } catch (_) {}
    return {
      id: c.id,
      name_zh: c.name_zh,
      name_en: c.name_en || '',
      track_mode: c.track_mode || 'track_a',
      allowed_parts: allowedParts,
      default_finish_id: c.default_finish_id || '',
      finishes,
      sort_order: c.sort_order || 0,
      is_system: Boolean(c.is_system)
    };
  });

  // 3. 专属色卡 (永远查询全量 12 品类色卡，绝不因传了 part 就 AND 1=0 或过滤分类！)
  const swatchRows = db.prepare('SELECT * FROM ba_material_swatches WHERE enabled=1 ORDER BY pinned DESC, sort_order ASC, lrv DESC').all();
  const swatchesByCategory = {};
  for (const s of swatchRows) {
    let styleTags = [];
    try { styleTags = JSON.parse(s.style_tags || '[]'); } catch (_) {}
    const item = {
      id: s.id,
      category_id: s.category_id,
      item_type: s.item_type || 'solid_color',
      name_zh: s.name_zh,
      brand: s.brand || '',
      code: s.code || '',
      hex: s.hex,
      lrv: s.lrv,
      color_family: s.color_family,
      style_tags: styleTags,
      finish_override: s.finish_override || '',
      prompt_hint_zh: s.prompt_hint_zh || '',
      prompt_hint_en: s.prompt_hint_en || '',
      texture_1k_path: s.texture_1k_path || '',
      preview_path: s.preview_path || '',
      tintable: Boolean(s.tintable),
      source_type: s.source_type || 'curated',
      pinned: Boolean(s.pinned),
      sort_order: s.sort_order || 0,
      is_system: Boolean(s.is_system)
    };
    if (!swatchesByCategory[s.category_id]) {
      swatchesByCategory[s.category_id] = [];
    }
    swatchesByCategory[s.category_id].push(item);
  }

  // 4. 当前选定部位的可用品类：如果匹配到了合法品类则返回，否则返回全部，绝不返回空数组 []
  let filteredCategories = all_categories;
  if (normPart) {
    // millwork 与 cabinet_door 视为同一部位，任一 id 命中 allowed_parts 即匹配
    const matchKeys = expandPartForMatch(normPart);
    const matched = all_categories.filter(c => matchKeys.some(k => (c.allowed_parts || []).includes(k)));
    if (matched.length > 0) {
      filteredCategories = matched;
    }
  }

  return {
    parts,
    categories: filteredCategories,
    swatches: swatchesByCategory,
    all_categories
  };
}

/**
 * 部位 CRUD
 */
function createPart(db, b) {
  if (!b.id || !b.name_zh) throw new Error('部位 id 与 name_zh 必填');
  const now = new Date().toISOString();
  const jevAliases = JSON.stringify(b.jev_aliases || []);
  db.prepare(`
    INSERT INTO ba_parts (
      id, name_zh, name_en, jev_aliases, preserve_clause_zh, preserve_clause_en,
      default_category_id, sort_order, is_system, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
  `).run(
    String(b.id).trim(),
    String(b.name_zh).trim(),
    String(b.name_en || '').trim(),
    jevAliases,
    String(b.preserve_clause_zh || '').trim(),
    String(b.preserve_clause_en || '').trim(),
    String(b.default_category_id || '').trim(),
    Number(b.sort_order) || 100,
    now, now
  );
  return db.prepare('SELECT * FROM ba_parts WHERE id=?').get(b.id);
}

function updatePart(db, id, b) {
  const existing = db.prepare('SELECT * FROM ba_parts WHERE id=?').get(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const name_zh = b.name_zh !== undefined ? String(b.name_zh).trim() : existing.name_zh;
  const name_en = b.name_en !== undefined ? String(b.name_en).trim() : existing.name_en;
  const jev_aliases = b.jev_aliases !== undefined ? JSON.stringify(b.jev_aliases) : existing.jev_aliases;
  const preserve_clause_zh = b.preserve_clause_zh !== undefined ? String(b.preserve_clause_zh).trim() : existing.preserve_clause_zh;
  const preserve_clause_en = b.preserve_clause_en !== undefined ? String(b.preserve_clause_en).trim() : existing.preserve_clause_en;
  const default_category_id = b.default_category_id !== undefined ? String(b.default_category_id).trim() : existing.default_category_id;
  const sort_order = b.sort_order !== undefined ? Number(b.sort_order) : existing.sort_order;
  const enabled = b.enabled !== undefined ? (b.enabled ? 1 : 0) : existing.enabled;

  db.prepare(`
    UPDATE ba_parts SET
      name_zh=?, name_en=?, jev_aliases=?, preserve_clause_zh=?, preserve_clause_en=?,
      default_category_id=?, sort_order=?, enabled=?, updated_at=?
    WHERE id=?
  `).run(name_zh, name_en, jev_aliases, preserve_clause_zh, preserve_clause_en, default_category_id, sort_order, enabled, now, id);

  return db.prepare('SELECT * FROM ba_parts WHERE id=?').get(id);
}

function deletePart(db, id) {
  const existing = db.prepare('SELECT * FROM ba_parts WHERE id=?').get(id);
  if (!existing) return false;
  if (existing.is_system) {
    // 系统预置部位只禁用不物理删除
    db.prepare('UPDATE ba_parts SET enabled=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
  } else {
    db.prepare('DELETE FROM ba_parts WHERE id=?').run(id);
  }
  return true;
}

/**
 * 基材品类 CRUD
 */
function createCategory(db, b) {
  if (!b.id || !b.name_zh) throw new Error('品类 id 与 name_zh 必填');
  const now = new Date().toISOString();
  const allowedParts = JSON.stringify(b.allowed_parts || []);
  const finishesJson = JSON.stringify(b.finishes || b.finishes_json || []);
  db.prepare(`
    INSERT INTO ba_material_categories (
      id, name_zh, name_en, track_mode, allowed_parts, default_finish_id,
      finishes_json, sort_order, is_system, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
  `).run(
    String(b.id).trim(),
    String(b.name_zh).trim(),
    String(b.name_en || '').trim(),
    String(b.track_mode || 'track_a').trim(),
    allowedParts,
    String(b.default_finish_id || '').trim(),
    finishesJson,
    Number(b.sort_order) || 100,
    now, now
  );
  return db.prepare('SELECT * FROM ba_material_categories WHERE id=?').get(b.id);
}

function updateCategory(db, id, b) {
  const existing = db.prepare('SELECT * FROM ba_material_categories WHERE id=?').get(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const name_zh = b.name_zh !== undefined ? String(b.name_zh).trim() : existing.name_zh;
  const name_en = b.name_en !== undefined ? String(b.name_en).trim() : existing.name_en;
  const track_mode = b.track_mode !== undefined ? String(b.track_mode).trim() : existing.track_mode;
  const allowed_parts = b.allowed_parts !== undefined ? JSON.stringify(b.allowed_parts) : existing.allowed_parts;
  const default_finish_id = b.default_finish_id !== undefined ? String(b.default_finish_id).trim() : existing.default_finish_id;
  const finishes_json = (b.finishes || b.finishes_json) !== undefined ? JSON.stringify(b.finishes || b.finishes_json) : existing.finishes_json;
  const sort_order = b.sort_order !== undefined ? Number(b.sort_order) : existing.sort_order;
  const enabled = b.enabled !== undefined ? (b.enabled ? 1 : 0) : existing.enabled;

  db.prepare(`
    UPDATE ba_material_categories SET
      name_zh=?, name_en=?, track_mode=?, allowed_parts=?, default_finish_id=?,
      finishes_json=?, sort_order=?, enabled=?, updated_at=?
    WHERE id=?
  `).run(name_zh, name_en, track_mode, allowed_parts, default_finish_id, finishes_json, sort_order, enabled, now, id);

  return db.prepare('SELECT * FROM ba_material_categories WHERE id=?').get(id);
}

function deleteCategory(db, id) {
  const existing = db.prepare('SELECT * FROM ba_material_categories WHERE id=?').get(id);
  if (!existing) return false;
  if (existing.is_system) {
    db.prepare('UPDATE ba_material_categories SET enabled=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id);
  } else {
    db.prepare('DELETE FROM ba_material_categories WHERE id=?').run(id);
  }
  return true;
}

/**
 * 专属色卡与花色资产 CRUD
 */
function listSwatches(db, { category_id, color_family, item_type, q, pinned, limit = 100, offset = 0 } = {}) {
  let sql = 'SELECT * FROM ba_material_swatches WHERE enabled=1';
  const params = [];
  if (category_id) {
    sql += ' AND category_id=?';
    params.push(category_id);
  }
  if (color_family) {
    sql += ' AND color_family=?';
    params.push(color_family);
  }
  if (item_type) {
    sql += ' AND item_type=?';
    params.push(item_type);
  }
  if (pinned !== undefined && pinned !== null && pinned !== '') {
    sql += ' AND pinned=?';
    params.push(Number(pinned) ? 1 : 0);
  }
  if (q) {
    sql += ' AND (name_zh LIKE ? OR code LIKE ? OR brand LIKE ? OR hex LIKE ?)';
    const term = `%${q}%`;
    params.push(term, term, term, term);
  }
  sql += ' ORDER BY pinned DESC, sort_order ASC, lrv DESC LIMIT ? OFFSET ?';
  params.push(Number(limit) || 100, Number(offset) || 0);

  const rows = db.prepare(sql).all(...params);
  return rows.map(r => {
    let tags = [];
    try { tags = JSON.parse(r.style_tags || '[]'); } catch (_) {}
    return {
      ...r,
      style_tags: tags,
      pinned: Boolean(r.pinned),
      tintable: Boolean(r.tintable),
      enabled: Boolean(r.enabled)
    };
  });
}

function createSwatch(db, b) {
  if (!b.category_id || !b.name_zh || !b.hex) {
    throw new Error('category_id、name_zh 与 hex 必填');
  }
  const now = new Date().toISOString();
  const id = b.id || `sw_${b.category_id.replace(/^mat_cat_/, '')}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const hex = String(b.hex).trim().toUpperCase();
  const lrv = b.lrv !== undefined ? Number(b.lrv) : calculateLrv(hex);
  const colorFamily = b.color_family || deriveColorFamily(hex);
  const styleTags = JSON.stringify(b.style_tags || []);

  db.prepare(`
    INSERT INTO ba_material_swatches (
      id, category_id, item_type, name_zh, brand, code, hex, lrv, color_family,
      style_tags, finish_override, prompt_hint_zh, prompt_hint_en, texture_1k_path,
      preview_path, tintable, source_type, pinned, sort_order, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    String(b.category_id).trim(),
    String(b.item_type || 'solid_color').trim(),
    String(b.name_zh).trim(),
    String(b.brand || '').trim(),
    String(b.code || '').trim(),
    hex,
    lrv,
    colorFamily,
    styleTags,
    String(b.finish_override || '').trim(),
    String(b.prompt_hint_zh || '').trim(),
    String(b.prompt_hint_en || '').trim(),
    String(b.texture_1k_path || '').trim(),
    String(b.preview_path || '').trim(),
    b.tintable ? 1 : 0,
    String(b.source_type || 'user_manual').trim(),
    b.pinned !== undefined ? (b.pinned ? 1 : 0) : 1,
    Number(b.sort_order) || 0,
    now, now
  );

  const created = db.prepare('SELECT * FROM ba_material_swatches WHERE id=?').get(id);
  if (created) syncSwatchToBaItems(db, created);
  return created;
}

function updateSwatch(db, id, b) {
  const existing = db.prepare('SELECT * FROM ba_material_swatches WHERE id=?').get(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const name_zh = b.name_zh !== undefined ? String(b.name_zh).trim() : existing.name_zh;
  const brand = b.brand !== undefined ? String(b.brand).trim() : existing.brand;
  const code = b.code !== undefined ? String(b.code).trim() : existing.code;
  const hex = b.hex !== undefined ? String(b.hex).trim().toUpperCase() : existing.hex;
  const lrv = b.hex !== undefined ? calculateLrv(hex) : (b.lrv !== undefined ? Number(b.lrv) : existing.lrv);
  const color_family = b.color_family !== undefined ? b.color_family : (b.hex !== undefined ? deriveColorFamily(hex) : existing.color_family);
  const style_tags = b.style_tags !== undefined ? JSON.stringify(b.style_tags) : existing.style_tags;
  const finish_override = b.finish_override !== undefined ? String(b.finish_override).trim() : existing.finish_override;
  const prompt_hint_zh = b.prompt_hint_zh !== undefined ? String(b.prompt_hint_zh).trim() : existing.prompt_hint_zh;
  const pinned = b.pinned !== undefined ? (b.pinned ? 1 : 0) : existing.pinned;
  const sort_order = b.sort_order !== undefined ? Number(b.sort_order) : existing.sort_order;
  const enabled = b.enabled !== undefined ? (b.enabled ? 1 : 0) : existing.enabled;

  db.prepare(`
    UPDATE ba_material_swatches SET
      name_zh=?, brand=?, code=?, hex=?, lrv=?, color_family=?, style_tags=?,
      finish_override=?, prompt_hint_zh=?, pinned=?, sort_order=?, enabled=?, updated_at=?
    WHERE id=?
  `).run(name_zh, brand, code, hex, lrv, color_family, style_tags, finish_override, prompt_hint_zh, pinned, sort_order, enabled, now, id);

  const updated = db.prepare('SELECT * FROM ba_material_swatches WHERE id=?').get(id);
  if (updated) syncSwatchToBaItems(db, updated);
  return updated;
}

function deleteSwatch(db, id) {
  const existing = db.prepare('SELECT is_system FROM ba_material_swatches WHERE id=?').get(id);
  if (!existing) return false;
  if (existing.is_system) {
    // 系统策展色卡只软禁用（种子 INSERT OR IGNORE 不会把它重新启用），
    // 防止 viewer 级会话物理删除共享 Master 字典
    db.prepare('UPDATE ba_material_swatches SET enabled=0, updated_at=? WHERE id=?').run(Date.now(), id);
  } else {
    db.prepare('DELETE FROM ba_material_swatches WHERE id=?').run(id);
  }
  deleteSwatchFromBaItems(db, id);
  return true;
}

/**
 * 「物理测色 + ΔE00 品牌近邻匹配 + VLM 智能美学赋名」服务
 */
async function recognizeVlmSwatch(db, { hex, cropDataUrl, partHint = '', config = {} } = {}) {
  let targetHex = hex ? String(hex).trim().toUpperCase() : '';

  // 1. 若无 HEX 且提供了裁剪图，物理提取自适应加权主色
  let cropBuffer = null;
  if (cropDataUrl && cropDataUrl.startsWith('data:image')) {
    try {
      const b64 = cropDataUrl.replace(/^data:[^,]+,/, '');
      cropBuffer = Buffer.from(b64, 'base64');
      if (!targetHex) {
        targetHex = await extractDominantHexFromBuffer(cropBuffer);
      }
    } catch (_) {}
  }
  if (!targetHex) targetHex = '#8B4A2B'; // 默认马鞍棕

  // 2. 检索库内全部色卡，以 CIEDE2000 (ΔE00) 匹配 Top 3 品牌色号
  const allRows = db.prepare('SELECT id, brand, code, name_zh, hex FROM ba_material_swatches WHERE enabled=1').all();
  // 预缓存 lab 坐标加速计算
  const candidates = allRows.map(r => ({
    ...r,
    _lab: hexToLab(r.hex)
  }));
  const closestMatches = matchClosestSwatches(targetHex, candidates, 3);

  // 3. 准备 VLM 视觉美学赋名提示词
  const aestheticFallback = generateAestheticColorName(targetHex, partHint);
  let recommendedCategory = 'mat_cat_latex';
  let recommendedFinish = 'roller_matte';
  const part = String(partHint || '').toLowerCase();
  if (part.includes('upholstery') || part.includes('sofa') || part.includes('沙发')) {
    recommendedCategory = 'mat_cat_leather';
    recommendedFinish = 'nappa_full_grain';
  } else if (part.includes('floor') || part.includes('地面') || part.includes('木')) {
    recommendedCategory = 'mat_cat_wood_floor';
    recommendedFinish = 'floor_plank_straight';
  } else if (part.includes('cabinet') || part.includes('柜')) {
    recommendedCategory = 'mat_cat_cabinet_lacquer';
    recommendedFinish = 'skin_feel_pet';
  }

  let finalNameZh = aestheticFallback.name;
  let finalAlts = aestheticFallback.alts || [];
  let finalStyleTags = ['现代简约', '优雅经典'];
  let designNote = `物理采样真实 HEX: ${targetHex}，色调温润，与当前空间结构相得益彰。`;

  // 4. 若环境配置了可用视觉模型，尝试调优诗意色名
  let vlmCalled = false;
  if (cropBuffer) {
    try {
      const { chatVision } = require('../vlm');
      const genGov = require('../gen-governance');
      const ep = typeof genGov.resolveVlmEndpoint === 'function'
        ? genGov.resolveVlmEndpoint(db, config || {}, 'workflow_vision')
        : null;

      if (ep && (ep.baseUrl || ep.apiKey)) {
        const vlmPrompt = `你是一位精通室内设计与高端家具面料的色彩大师。
用户从空间图片中提取了一个材质色彩：
物理采样 HEX：${targetHex}
所属空间部位：${partHint || '家具/装饰面'}
近似品牌色号：${closestMatches.map(m => `${m.brand} ${m.code} (${m.name_zh})`).join('、')}

请严格输出纯 JSON 对象，格式如下：
{
  "name_zh": "最具室内设计美感的诗意中文色名（例如：意式马鞍棕、汝窑天青、可可蛋奶、北欧原木白橡）",
  "poetic_alternatives": ["备选名1", "备选名2", "备选名3"],
  "recommended_category_id": "${recommendedCategory}",
  "recommended_finish_id": "${recommendedFinish}",
  "style_tags": ["适用风格1", "适用风格2"],
  "design_note": "一句话专业色彩搭配评价"
}`;
        const resp = await chatVision({
          baseUrl: ep.baseUrl,
          apiKey: ep.apiKey,
          model: ep.modelCode || 'workflow_vision',
          prompt: vlmPrompt,
          images: [cropBuffer],
          timeoutMs: 8000
        });

        if (resp) {
          const rawText = typeof resp === 'string' ? resp : (resp.content || resp.text || JSON.stringify(resp));
          const match = rawText.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.name_zh) finalNameZh = parsed.name_zh;
            if (Array.isArray(parsed.poetic_alternatives) && parsed.poetic_alternatives.length) {
              finalAlts = parsed.poetic_alternatives;
            }
            if (parsed.recommended_category_id) recommendedCategory = parsed.recommended_category_id;
            if (parsed.recommended_finish_id) recommendedFinish = parsed.recommended_finish_id;
            if (Array.isArray(parsed.style_tags)) finalStyleTags = parsed.style_tags;
            if (parsed.design_note) designNote = parsed.design_note;
            vlmCalled = true;
          }
        }
      }
    } catch (_) {
      // 优雅降级至高可用保底
    }
  }

  const lrv = calculateLrv(targetHex);
  const colorFamily = deriveColorFamily(targetHex);

  return {
    hex: targetHex,
    lrv,
    color_family: colorFamily,
    name_zh: finalNameZh,
    poetic_alternatives: finalAlts,
    recommended_category_id: recommendedCategory,
    recommended_finish_id: recommendedFinish,
    closest_brand_matches: closestMatches,
    style_tags: finalStyleTags,
    design_note: designNote,
    source: vlmCalled ? 'vlm_vision' : 'color_engine_fallback'
  };
}


/**
 * 针对当前框选区域与当前基材品类，计算 4~6 款智能建议色卡
 * (含：原色同频、空间百搭基底色、质感点睛/压阵色)
 */
function getRecommendedSwatchesForRegion(db, { part = '', category_id = '', dominant_hex = '', scenePaletteHexes = [] } = {}) {
  let targetCatId = category_id;
  if (!targetCatId && part) {
    const partRow = db.prepare('SELECT default_category_id FROM ba_parts WHERE id = ?').get(part);
    if (partRow && partRow.default_category_id) {
      targetCatId = partRow.default_category_id;
    }
  }
  if (!targetCatId) {
    targetCatId = (part === 'upholstery' || part === 'furniture') ? 'mat_cat_leather' : 'mat_cat_latex';
  }

  const catRow = db.prepare('SELECT * FROM ba_material_categories WHERE id = ?').get(targetCatId);
  const catName = catRow ? catRow.name_zh.split('/')[0] : '基材';

  const rows = db.prepare('SELECT * FROM ba_material_swatches WHERE category_id = ? AND enabled = 1 ORDER BY pinned DESC, sort_order ASC, lrv DESC').all(targetCatId);
  if (!rows || rows.length === 0) {
    return {
      category_id: targetCatId,
      category_name: catName,
      swatches: [],
      default_swatch: null,
      dominant_name_zh: dominant_hex ? ((generateAestheticColorName(dominant_hex, part) || {}).name || '') : '',
      advice_zh: `当前基材【${catName}】暂无专属色卡`
    };
  }

  const swatchesWithLab = rows.map(r => ({
    ...r,
    _lab: hexToLab(r.hex)
  }));

  const recommended = [];
  const usedIds = new Set();

  // (1) 原色同频 (若提供选区原色，从全部色卡中匹配最同频的一款)
  let originMatch = null;
  if (dominant_hex) {
    const matches = matchClosestSwatches(dominant_hex, swatchesWithLab, 1);
    if (matches && matches.length > 0) {
      originMatch = {
        ...matches[0],
        badge: '原色同频',
        recommend_reason: `与框选区域原色 (${dominant_hex}) 色差极小 (ΔE=${matches[0].delta_e.toFixed(1)})`
      };
      usedIds.add(originMatch.id);
    }
  }

  // (2) 推荐首选 (高频置顶主推色)；唯一色卡已被「原色同频」占用时不重复推同一款
  const topCandidate = swatchesWithLab.find(s => !usedIds.has(s.id));
  if (topCandidate) {
    recommended.push({
      ...topCandidate,
      badge: '推荐首选',
      recommend_reason: `【${catName}】最经典高频主推色，百搭质感优选`
    });
    usedIds.add(topCandidate.id);
  }

  if (originMatch) {
    recommended.push(originMatch);
  }

  // (3) 空间百搭基底色 (中高明度经典常用色，优先 pinned)
  const baseCandidates = swatchesWithLab.filter(s => !usedIds.has(s.id) && s.pinned === 1);
  for (const s of baseCandidates) {
    if (recommended.length >= 3) break;
    recommended.push({
      ...s,
      badge: '空间百搭',
      recommend_reason: '经典高频基底色，温润通透不挑空间采光'
    });
    usedIds.add(s.id);
  }

  // (4) 质感跳色/沉稳压阵色 (深色或特色色调)
  const accentCandidates = swatchesWithLab.filter(s => !usedIds.has(s.id));
  for (const s of accentCandidates) {
    if (recommended.length >= 5) break;
    recommended.push({
      ...s,
      badge: s.lrv < 25 ? '沉稳压阵' : '高级点睛',
      recommend_reason: s.lrv < 25 ? '沉稳视觉重心，强化大宅高级气场' : '设计师推荐跳色搭配'
    });
    usedIds.add(s.id);
  }

  const advice_zh = originMatch
    ? `已根据框选原色 (${dominant_hex}) 与【${catName}】材质特征，为您推荐 ${recommended.length} 款和谐配色方案`
    : `为您精选 ${recommended.length} 款【${catName}】高频经典与点睛配色建议`;

  const dominant_name_zh = dominant_hex ? ((generateAestheticColorName(dominant_hex, part) || {}).name || '') : '';

  const cleanSwatches = recommended.map(r => {
    const copy = { ...r };
    delete copy._lab;
    return copy;
  });

  return {
    category_id: targetCatId,
    category_name: catName,
    swatches: cleanSwatches,
    default_swatch: cleanSwatches[0] || null,
    dominant_name_zh,
    advice_zh
  };
}

module.exports = {
  getRecommendedSwatchesForRegion,
  getDictionary,
  createPart,
  updatePart,
  deletePart,
  createCategory,
  updateCategory,
  deleteCategory,
  listSwatches,
  createSwatch,
  updateSwatch,
  deleteSwatch,
  recognizeVlmSwatch
};
