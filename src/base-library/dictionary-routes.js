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

/**
 * 获取完整层级联动字典树 (空间部位 ↔ 基材品类 ↔ 专属色卡/纹理与工艺)
 */
function getDictionary(db, { part = '' } = {}) {
  // 1. 部位列表
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

  // 2. 基材品类列表
  const catRows = db.prepare('SELECT * FROM ba_material_categories WHERE enabled=1 ORDER BY sort_order ASC').all();
  const categories = catRows.map(c => {
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

  // 3. 专属色卡与花色资产列表
  let swatchSql = 'SELECT * FROM ba_material_swatches WHERE enabled=1';
  const swatchParams = [];
  if (part) {
    const matchedCats = categories.filter(c => c.allowed_parts.includes(part)).map(c => c.id);
    if (matchedCats.length > 0) {
      const placeholders = matchedCats.map(() => '?').join(',');
      swatchSql += ` AND category_id IN (${placeholders})`;
      swatchParams.push(...matchedCats);
    } else {
      swatchSql += ' AND 1=0';
    }
  }
  swatchSql += ' ORDER BY pinned DESC, sort_order ASC, lrv DESC';
  const swatchRows = db.prepare(swatchSql).all(...swatchParams);

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
      sort_order: s.sort_order || 0
    };
    if (!swatchesByCategory[s.category_id]) {
      swatchesByCategory[s.category_id] = [];
    }
    swatchesByCategory[s.category_id].push(item);
  }

  // 4. 计算当前选定部位的可用品类
  const filteredCategories = part
    ? categories.filter(c => c.allowed_parts.includes(part))
    : categories;

  return {
    parts,
    categories: filteredCategories,
    swatches: swatchesByCategory,
    all_categories: categories
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

  return db.prepare('SELECT * FROM ba_material_swatches WHERE id=?').get(id);
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

  return db.prepare('SELECT * FROM ba_material_swatches WHERE id=?').get(id);
}

function deleteSwatch(db, id) {
  const res = db.prepare('DELETE FROM ba_material_swatches WHERE id=?').run(id);
  return res.changes > 0;
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

module.exports = {
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
