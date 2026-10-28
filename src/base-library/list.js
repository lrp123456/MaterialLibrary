/**
 * 基础属性库只读列表与标志查询层
 */

const { isValidSurface, isValidSubclass } = require('./taxonomy');

function getFlag(db, key, defaultVal = 0) {
  try {
    const row = db.prepare('SELECT value FROM ba_flags WHERE key=?').get(key);
    return row !== undefined ? Number(row.value) : defaultVal;
  } catch (e) {
    return defaultVal;
  }
}

function setFlag(db, key, val) {
  const num = val ? 1 : 0;
  const now = Date.now();
  db.prepare(`
    INSERT INTO ba_flags (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(key, num, now);
  return num;
}

function getAllFlags(db) {
  try {
    const rows = db.prepare('SELECT key, value FROM ba_flags').all();
    const res = {};
    for (const r of rows) {
      res[r.key] = Number(r.value);
    }
    return res;
  } catch (e) {
    return {};
  }
}

function listMaterials(db, { surface, subclass, source, is_shell, q, limit = 60, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(Number(limit) || 60, 200));
  const off = Math.max(0, Number(offset) || 0);

  let sql = `
    SELECT m.* 
    FROM ba_materials m
    WHERE m.deleted_at IS NULL
  `;
  const params = [];

  if (surface && isValidSurface(surface)) {
    sql += ` AND m.id IN (
      SELECT asset_id FROM ba_asset_tags 
      WHERE asset_kind='material' AND surface=?
    )`;
    params.push(surface);
  }

  if (subclass && isValidSubclass(subclass)) {
    sql += ` AND m.id IN (
      SELECT asset_id FROM ba_asset_tags 
      WHERE asset_kind='material' AND subclass=?
    )`;
    params.push(subclass);
  }

  if (source && String(source).trim()) {
    sql += ' AND m.source = ?';
    params.push(String(source).trim());
  }

  if (is_shell !== undefined && is_shell !== null && is_shell !== '') {
    sql += ' AND m.is_shell = ?';
    params.push(Number(is_shell) ? 1 : 0);
  }

  if (q && String(q).trim()) {
    const kw = `%${String(q).trim().toLowerCase()}%`;
    sql += ` AND (LOWER(m.name_cn) LIKE ? OR LOWER(COALESCE(m.source_id, '')) LIKE ? OR LOWER(COALESCE(m.license_note, '')) LIKE ?)`;
    params.push(kw, kw, kw);
  }

  sql += ' ORDER BY m.updated_at DESC LIMIT ? OFFSET ?';
  params.push(lim, off);

  const rows = db.prepare(sql).all(...params);

  // 批量补充 tags
  const matIds = rows.map(r => r.id);
  const tagMap = new Map();
  if (matIds.length > 0) {
    const placeholders = matIds.map(() => '?').join(',');
    const tagRows = db.prepare(`
      SELECT asset_id, surface, subclass 
      FROM ba_asset_tags 
      WHERE asset_kind='material' AND asset_id IN (${placeholders})
    `).all(...matIds);
    for (const t of tagRows) {
      if (!tagMap.has(t.asset_id)) tagMap.set(t.asset_id, []);
      tagMap.get(t.asset_id).push({ surface: t.surface, subclass: t.subclass });
    }
  }

  return rows.map(r => {
    let credit = 'CC0';
    if (r.source === 'polyhaven') {
      credit = 'Poly Haven, CC0';
    } else if (r.source === 'ambientcg') {
      credit = 'ambientCG, CC0';
    } else if (r.license_note) {
      credit = r.license_note;
    }

    let roughness_label = '标准物理质感';
    if (r.id === 'mat_white_oak') roughness_label = '半哑光木纹 (微导管)';
    else if (r.id === 'mat_black_walnut') roughness_label = '哑光木纹 (天然山纹)';
    else if (r.id === 'mat_roman_travertine') roughness_label = '漫反射 (天然孔洞肌理)';
    else if (r.id === 'mat_calacatta_marble') roughness_label = '高光镜面 (天然灰脉)';
    else if (r.id === 'mat_micro_cement') roughness_label = '哑光磨砂 (微水泥颗粒壳)';
    else if (r.id === 'mat_linen_fabric') roughness_label = '柔光布艺 (高支经纬线)';
    else if (r.id === 'mat_terrazzo_gray') roughness_label = '半抛光面 (细腻水磨骨料)';
    else if (r.id === 'mat_gypsum_cornice') roughness_label = '超哑光面 (精细石膏质感)';

    const previewUrl = r.preview_rel ? `/api/base-library/materials/${encodeURIComponent(r.id)}/preview` : null;
    const basecolorUrl = `/api/base-library/materials/${encodeURIComponent(r.id)}/basecolor`;

    return {
      id: r.id,
      name_cn: r.name_cn,
      tags: tagMap.get(r.id) || [],
      thumb_url: previewUrl || basecolorUrl,
      preview_url: previewUrl,
      basecolor_url: basecolorUrl,
      roughness_label,
      source: r.source,
      source_id: r.source_id,
      credit,
      width: r.width,
      height: r.height,
      is_shell: Boolean(r.is_shell),
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  });
}

function listPaints(db, { brand, family, subclass, q, pinned, limit = 60, offset = 0 } = {}) {
  // 标志检查：若色号关闭则返回空
  if (getFlag(db, 'base_library_paints', 1) === 0) {
    return [];
  }

  const lim = Math.max(1, Math.min(Number(limit) || 60, 200));
  const off = Math.max(0, Number(offset) || 0);

  let sql = 'SELECT * FROM ba_paints WHERE 1=1';
  const params = [];

  if (brand && String(brand).trim()) {
    sql += ' AND brand = ?';
    params.push(String(brand).trim());
  }

  if (family && String(family).trim()) {
    sql += ' AND family = ?';
    params.push(String(family).trim());
  }

  if (pinned !== undefined && pinned !== null && pinned !== '') {
    sql += ' AND pinned = ?';
    params.push(Number(pinned) ? 1 : 0);
  }

  if (subclass && isValidSubclass(subclass)) {
    // 规则：无标签且 interior=1 的色号对所有子类可见；或有明确标签
    sql += ` AND (
      id IN (SELECT asset_id FROM ba_asset_tags WHERE asset_kind='paint' AND subclass=?)
      OR (interior=1 AND id NOT IN (SELECT asset_id FROM ba_asset_tags WHERE asset_kind='paint'))
    )`;
    params.push(subclass);
  }

  if (q && String(q).trim()) {
    const kw = `%${String(q).trim().toLowerCase()}%`;
    sql += ` AND (
      LOWER(code) LIKE ? OR 
      LOWER(COALESCE(name_en, '')) LIKE ? OR 
      LOWER(COALESCE(name_zh, '')) LIKE ? OR 
      LOWER(COALESCE(alias_zh, '')) LIKE ? OR 
      LOWER(COALESCE(family, '')) LIKE ?
    )`;
    params.push(kw, kw, kw, kw, kw);
  }

  sql += ' ORDER BY pinned DESC, updated_at DESC LIMIT ? OFFSET ?';
  params.push(lim, off);

  const rows = db.prepare(sql).all(...params);

  return rows.map(r => ({
    id: r.id,
    brand: r.brand,
    code: r.code,
    name_en: r.name_en,
    name_zh: r.name_zh,
    alias_zh: r.alias_zh,
    alt_code: r.alt_code,
    hex: r.hex,
    family: r.family,
    lrv: r.lrv,
    interior: Boolean(r.interior),
    pinned: Boolean(r.pinned),
    shell_material_id: r.shell_material_id,
    swatch_url: `/api/base-library/paints/${encodeURIComponent(r.id)}/swatch`,
    source_url: r.source_url,
    created_at: r.created_at,
    updated_at: r.updated_at
  }));
}

function listLights(db) {
  const rows = db.prepare('SELECT * FROM ba_light_presets ORDER BY sort ASC, id ASC').all();
  return {
    directions: rows.filter(r => r.kind === 'direction').map(r => ({
      id: r.id,
      label_zh: r.label_zh,
      direction_key: r.direction_key,
      sort: r.sort
    })),
    ccts: rows.filter(r => r.kind === 'cct').map(r => ({
      id: r.id,
      label_zh: r.label_zh,
      kelvin: r.kelvin,
      sort: r.sort
    }))
  };
}

function listPresetSlots(db) {
  const rows = db.prepare(`
    SELECT ps.*, m.id as m_id, m.deleted_at as m_del
    FROM ba_preset_slots ps
    LEFT JOIN ba_materials m ON ps.material_id = m.id
    ORDER BY ps.id ASC
  `).all();

  return rows.map(r => {
    const hasValidMat = r.material_id && r.m_id && r.m_del === null;
    return {
      id: r.id,
      name_cn: r.name_cn,
      subclass: r.subclass,
      material_id: hasValidMat ? r.material_id : null,
      thumb_url: hasValidMat ? `/api/base-library/materials/${encodeURIComponent(r.material_id)}/basecolor` : null,
      updated_at: r.updated_at
    };
  });
}

module.exports = {
  getFlag,
  setFlag,
  getAllFlags,
  listMaterials,
  listPaints,
  listLights,
  listPresetSlots
};
