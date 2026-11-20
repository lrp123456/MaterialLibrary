/**
 * 标签字典治理：CRUD / 判据 / 别名 / 用量 / 变更史 / 维度范围重打
 */
const crypto = require('crypto');
const { AUTH_VISIBLE_SQL } = require('./governance');

const DIM_META = {
  space: { label: '空间', group: 'space', multi: false, primary: true },
  style_atom: { label: '风格', group: 'space', multi: true, primary: true, max: 4 },
  style_region: { label: '风格大区', group: 'space', multi: false, primary: false, readonly: true },
  material_kind: { label: '材质', group: 'space', multi: true, primary: true, max: 4 },
  dominant_color: { label: '主色', group: 'space', multi: false, primary: true, readonly: true },
  orientation: { label: '画幅', group: 'space', multi: false, primary: true, readonly: true },
  furniture_category: { label: '家具大类', group: 'furniture', multi: false, primary: true },
  furniture_item: { label: '单品品类', group: 'furniture', multi: false, primary: true },
  furniture_craft: { label: '表面工艺', group: 'furniture', multi: true, primary: false },
  furniture_form: { label: '造型特征', group: 'furniture', multi: false, primary: false },
  classic_design: { label: '经典款名', group: 'furniture', multi: false, primary: true },

  // 人像维度
  gender: { label: '性别', group: 'portrait', multi: false, primary: true },
  person_style: { label: '人物风格', group: 'portrait', multi: true, primary: true },
  shot_type: { label: '景别', group: 'portrait', multi: false, primary: true },

  // 服装维度
  clothing_category: { label: '服装品类', group: 'clothing', multi: false, primary: true },
  clothing_style: { label: '穿搭风格', group: 'clothing', multi: true, primary: true },
  season: { label: '季节', group: 'clothing', multi: false, primary: true },

  color_style: { label: '色系', group: 'legacy', multi: true, deprecatedGroup: true },
  flags: { label: '标记', group: 'legacy', multi: true, deprecatedGroup: true },
  region: { label: '文化地域', group: 'legacy', multi: false, deprecatedGroup: true },
  tone: { label: '调性氛围', group: 'legacy', multi: true, deprecatedGroup: true },
  view_composition: { label: '构图景别', group: 'legacy', multi: false, deprecatedGroup: true },
  view_angle: { label: '机位视角', group: 'legacy', multi: false, deprecatedGroup: true },
  lighting: { label: '光线', group: 'legacy', multi: false, deprecatedGroup: true },
  material_family: { label: '材质族', group: 'legacy', multi: true, deprecatedGroup: true, readonly: true },
  palette: { label: '配色主题', group: 'legacy', multi: false, deprecatedGroup: true },
  luxury: { label: '奢华度', group: 'legacy', multi: false, deprecatedGroup: true },
  era: { label: '时代感', group: 'legacy', multi: false, deprecatedGroup: true },
  temperature: { label: '温度', group: 'legacy', multi: false, deprecatedGroup: true },
  functional: { label: '功能性', group: 'legacy', multi: false, deprecatedGroup: true },
  quality: { label: '质量档', group: 'legacy', multi: false, deprecatedGroup: true },
  video_purpose: { label: '成片用途', group: 'video', multi: false, primary: true },
};

const CRITERIA_DRAFTS = {
  space: (label) => `画面主体是完整「${label}」场景，能看到该空间典型功能区与家具组合；局部特写或含糊角落不要标。`,
  style_atom: (label) => `整体材质、色彩、线条与软装气质符合「${label}」（含文化流派与木系风格）；支持多风格多选共存（1-3个）；严禁标注混搭；完全不吻合且不在体系内才标 other。`,
  material_kind: (label) => `画面中「${label}」是大面积可见主材或明确点缀材质，不能是文字提及或极小面积。`,
  color_style: (label) => `整体色感与「${label}」一致；以第一眼主色倾向为准。`,
  dominant_color: (label) => `人眼第一视角最具视觉统治力的颜色为「${label}」；点缀色不要覆盖主色判断。`,
  flags: (label) => `满足「${label}」定义才勾选，不确定则不选。`,
  furniture_category: (label) => `该单品属于「${label}」大类。`,
  furniture_item: (label) => `该单品形态与功能对应「${label}」。`,
  furniture_craft: (label) => `表面处理工艺明显是「${label}」。`,
  furniture_form: (label) => `结构造型特征符合「${label}」。`,
  classic_design: (label) => `轮廓、结构与经典名款「${label}」高度吻合才标，相似但非名款给 other_classic。`,
  region: (label) => `空间/单品气质与「${label}」文化语境一致。`,
  tone: (label) => `氛围调性呈现「${label}」。`,
  view_composition: (label) => `景别为「${label}」。`,
  view_angle: (label) => `机位视角为「${label}」。`,
  lighting: (label) => `光线条件为「${label}」。`
};

function ensureGovernanceSchema(db) {
  const cols = db.prepare('PRAGMA table_info(tag_dict)').all().map(c => c.name);
  if (!cols.includes('criteria')) db.exec("ALTER TABLE tag_dict ADD COLUMN criteria TEXT;");
  if (!cols.includes('updated_at')) db.exec("ALTER TABLE tag_dict ADD COLUMN updated_at INTEGER;");
  if (!cols.includes('parent_dir')) db.exec("ALTER TABLE tag_dict ADD COLUMN parent_dir TEXT;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tag_dict_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER,
      dimension TEXT NOT NULL,
      dir TEXT NOT NULL,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      actor TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_tag_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_fid TEXT NOT NULL,
      tag_id INTEGER,
      dimension TEXT,
      dir TEXT,
      label TEXT,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      source TEXT,
      run_id TEXT,
      actor TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_asset_tag_hist_fid ON asset_tag_history(asset_fid);
    CREATE INDEX IF NOT EXISTS idx_asset_tag_hist_dim ON asset_tag_history(dimension, created_at);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS retag_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dimensions TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      schedule TEXT NOT NULL DEFAULT 'now',
      estimated INTEGER DEFAULT 0,
      queued_count INTEGER DEFAULT 0,
      run_id TEXT,
      actor TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      error TEXT,
      options TEXT
    );
  `);
  const jobCols = db.prepare('PRAGMA table_info(retag_jobs)').all().map(c => c.name);
  if (!jobCols.includes('options')) {
    db.exec("ALTER TABLE retag_jobs ADD COLUMN options TEXT;");
  }
}

function slugifyLabel(label, existingDirs = new Set()) {
  const raw = String(label || '').trim().toLowerCase();
  let slug = raw
    .replace(/[^\w一-龥]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  // 保留 ascii，中文转 tag_hash
  slug = slug.replace(/[^\x00-\x7F]/g, '');
  if (!slug || !/[a-z0-9]/.test(slug)) {
    slug = `tag_${crypto.randomBytes(3).toString('hex')}`;
  }
  if (!/^[a-z0-9]/.test(slug)) slug = `t_${slug}`;
  slug = slug.slice(0, 40);
  let out = slug;
  let i = 2;
  while (existingDirs.has(out)) out = `${slug}_${i++}`;
  return out;
}

function parseAliases(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(s => String(s).trim()).filter(Boolean);
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : [];
  } catch {
    return String(raw).split(/[,，、]/).map(s => s.trim()).filter(Boolean);
  }
}

function logDictAudit(db, { tagId, dimension, dir, action, before, after, actor }) {
  db.prepare(`
    INSERT INTO tag_dict_audit (tag_id, dimension, dir, action, before_json, after_json, actor, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tagId || null, dimension, dir, action,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    actor || null,
    Date.now()
  );
}

function logAssetTagHistory(db, rows) {
  if (!rows?.length) return;
  const stmt = db.prepare(`
    INSERT INTO asset_tag_history
      (asset_fid, tag_id, dimension, dir, label, action, old_value, new_value, source, run_id, actor, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  for (const r of rows) {
    stmt.run(
      r.asset_fid, r.tag_id || null, r.dimension || null, r.dir || null, r.label || null,
      r.action, r.old_value || null, r.new_value || null, r.source || null,
      r.run_id || null, r.actor || null, r.created_at || now
    );
  }
}

function usageCounts(db) {
  const rows = db.prepare(`
    SELECT t.id AS tag_id, COUNT(at.asset_fid) AS usage_count
    FROM tag_dict t
    LEFT JOIN asset_tags at ON at.tag_id = t.id
    GROUP BY t.id
  `).all();
  const map = new Map();
  for (const r of rows) map.set(r.tag_id, r.usage_count || 0);
  return map;
}

function listDict(db, { includeDeprecated = true } = {}) {
  const usage = usageCounts(db);
  let sql = 'SELECT * FROM tag_dict';
  if (!includeDeprecated) sql += ' WHERE deprecated=0';
  sql += ' ORDER BY dimension, id ASC';
  const tags = db.prepare(sql).all().map(t => ({
    ...t,
    aliases: parseAliases(t.aliases),
    criteria: t.criteria || '',
    usage_count: usage.get(t.id) || 0,
    meta: DIM_META[t.dimension] || { label: t.dimension, group: 'other', multi: false }
  }));

  const byDim = new Map();
  for (const t of tags) {
    if (!byDim.has(t.dimension)) byDim.set(t.dimension, []);
    byDim.get(t.dimension).push(t);
  }

  const dimensions = [];
  for (const [key, meta] of Object.entries(DIM_META)) {
    const items = byDim.get(key) || [];
    dimensions.push({
      key,
      ...meta,
      count: items.filter(i => !i.deprecated).length,
      deprecatedCount: items.filter(i => i.deprecated).length
    });
  }
  for (const key of byDim.keys()) {
    if (dimensions.find(d => d.key === key)) continue;
    const items = byDim.get(key);
    dimensions.push({
      key,
      label: key,
      group: 'other',
      multi: false,
      count: items.filter(i => !i.deprecated).length,
      deprecatedCount: items.filter(i => i.deprecated).length
    });
  }

  return {
    tags,
    dimensions,
    groups: [
      { key: 'space', label: '空间素材' },
      { key: 'furniture', label: '家具单品' },
      { key: 'aux', label: '辅助检索' },
      { key: 'legacy', label: '已废弃' },
      { key: 'other', label: '其他' }
    ]
  };
}

/**
 * ★ 面向客户端的「当前生效筛选词表」。
 *
 * 为什么不能直接用 filterOptions：随 /assets 返回的 facets 带 `HAVING count > 0`，
 * 只包含「库里有素材在用」的标签 —— 于是「刚在治理台新增的风格」在筛选器里看不到，
 * 而「已移除的旧风格」又因为客户端本地兜底表还在而继续显示。两头都错。
 *
 * 本函数返回该维度**全部生效标签**（含 usage_count=0 的新词），
 * 并额外给出 deprecated 列表，供客户端：
 *   1. 重建筛选器（不再依赖本地硬编码兜底表）；
 *   2. 判定某素材的风格是否已失效 → 触发重新评估（重评估前按「其他/混搭」兜底）。
 */
const { categoryDimensions, DERIVATIVE_KINDS } = require('./library-schema');
const CATEGORY_DIMENSIONS = categoryDimensions();

function filterVocabulary(db, dimension, category = null) {
  // parent_dir 是两层筛选的分组键（style_atom 挂到 east_asia / europe … 大区）
  const cols = db.prepare('PRAGMA table_info(tag_dict)').all().map((c) => c.name);
  const hasParent = cols.includes('parent_dir');
  const withUsage = db.prepare(`
    SELECT t.dimension, t.dir, t.label, t.deprecated${hasParent ? ', t.parent_dir' : ''},
           COUNT(at.asset_fid) AS usage_count
    FROM tag_dict t
    LEFT JOIN asset_tags at ON at.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.dimension, t.id ASC
  `).all();

  const groups = {};
  for (const r of withUsage) {
    if (!groups[r.dimension]) groups[r.dimension] = { active: [], deprecated: [] };
    const entry = {
      dir: r.dir,
      label: r.label,
      usage_count: r.usage_count || 0,
    };
    if (hasParent && r.parent_dir) entry.parent = r.parent_dir;
    groups[r.dimension][r.deprecated ? 'deprecated' : 'active'].push(entry);
  }

  let dims = dimension ? [dimension] : Object.keys(groups);
  if (category && CATEGORY_DIMENSIONS[category]) {
    const allowed = new Set(CATEGORY_DIMENSIONS[category]);
    dims = dims.filter((d) => allowed.has(d) && d !== 'derivative_kind' && d !== 'video_source');
  }

  const out = {};
  for (const d of dims) {
    if (!groups[d]) continue;
    out[d] = {
      active: groups[d].active,
      // 只回 label：客户端要拿它去比对素材上的旧风格，dir 对端上无意义
      deprecated: groups[d].deprecated.map(t => ({ dir: t.dir, label: t.label })),
    };
  }
  if (category === 'retouched') {
    out.derivative_kind = {
      active: DERIVATIVE_KINDS.map((item) => ({ dir: item.dir, label: item.label, usage_count: 0 })),
      deprecated: [],
    };
  }
  return {
    dimensions: out,
    categoryDimensions: CATEGORY_DIMENSIONS,
    tiers: require('./library-schema').LIBRARIES,
    activeCategory: category,
    generatedAt: Date.now()
  };
}

function draftCriteria(dimension, label) {
  const fn = CRITERIA_DRAFTS[dimension];
  return fn ? fn(label) : `识别为「${label}」时的可观察特征（请补充）。`;
}

function upsertTag(db, body, actor) {
  const dimension = String(body.dimension || '').trim();
  const label = String(body.label || '').trim();
  if (!dimension || !label) {
    const err = new Error('dimension 与 label 必填');
    err.status = 400;
    throw err;
  }
  if (DIM_META[dimension]?.readonly) {
    const err = new Error(`维度 ${dimension} 为系统只读，不可新增/修改枚举`);
    err.status = 400;
    throw err;
  }

  const existingDirs = new Set(
    db.prepare('SELECT dir FROM tag_dict WHERE dimension=?').all(dimension).map(r => r.dir)
  );
  let dir = String(body.dir || '').trim();
  if (!dir) dir = slugifyLabel(label, existingDirs);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_\-.:]*$/.test(dir)) {
    const err = new Error('dir 只能包含字母数字与 _-.:');
    err.status = 400;
    throw err;
  }

  const aliases = parseAliases(body.aliases);
  const deprecated = body.deprecated ? 1 : 0;
  let criteria = body.criteria != null ? String(body.criteria) : '';
  const before = db.prepare('SELECT * FROM tag_dict WHERE dimension=? AND dir=?').get(dimension, dir);
  if (!criteria && !before?.criteria) criteria = draftCriteria(dimension, label);

  const now = Date.now();
  db.prepare(`
    INSERT INTO tag_dict (dimension, dir, label, aliases, criteria, deprecated, is_fallback, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dimension, dir) DO UPDATE SET
      label=excluded.label,
      aliases=excluded.aliases,
      criteria=excluded.criteria,
      deprecated=excluded.deprecated,
      updated_at=excluded.updated_at
  `).run(
    dimension, dir, label,
    aliases.length ? JSON.stringify(aliases) : null,
    criteria || null,
    deprecated,
    body.is_fallback ? 1 : 0,
    now
  );

  const after = db.prepare('SELECT * FROM tag_dict WHERE dimension=? AND dir=?').get(dimension, dir);
  logDictAudit(db, {
    tagId: after.id, dimension, dir,
    action: before ? 'update' : 'create',
    before, after, actor
  });
  return after;
}

function setDeprecated(db, { id, dimension, dir, deprecated }, actor) {
  let row = null;
  if (id != null) row = db.prepare('SELECT * FROM tag_dict WHERE id=?').get(id);
  else if (dimension && dir) row = db.prepare('SELECT * FROM tag_dict WHERE dimension=? AND dir=?').get(dimension, dir);
  if (!row) {
    const err = new Error('标签不存在');
    err.status = 404;
    throw err;
  }
  const dep = deprecated ? 1 : 0;
  if (!!row.deprecated === !!dep) return row;
  db.prepare('UPDATE tag_dict SET deprecated=?, updated_at=? WHERE id=?').run(dep, Date.now(), row.id);
  const after = db.prepare('SELECT * FROM tag_dict WHERE id=?').get(row.id);
  logDictAudit(db, {
    tagId: row.id, dimension: row.dimension, dir: row.dir,
    action: dep ? 'deprecate' : 'restore',
    before: row, after, actor
  });
  return after;
}

function fallbackDirsFor(dim) {
  if (dim === 'space') return ['other', 'detail_closeup'];
  if (dim === 'style_atom') return ['other'];
  return [];
}

function collectRetagFids(db, dims, { all = false, fids = null } = {}) {
  // 显式 fid 列表（冒烟/指定重评）
  if (Array.isArray(fids) && fids.length) {
    const byDimension = {};
    for (const dim of dims) {
      byDimension[dim] = { count: fids.length, multi: !!DIM_META[dim]?.multi, fallbackDirs: fallbackDirsFor(dim), all: false, explicit: true };
    }
    return { total: fids.length, fids: [...fids], byDimension };
  }

  const byDimension = {};
  const union = new Set();

  for (const dim of dims) {
    const dimSet = new Set();
    const fallbackDirs = fallbackDirsFor(dim);
    const add = (sql, ...args) => {
      for (const r of db.prepare(sql).all(...args)) {
        dimSet.add(r.fid);
        union.add(r.fid);
      }
    };

    const ACTIVE_ASSET_SQL = "(a.status IS NULL OR a.status NOT IN ('deleted','rejected'))";

    if (all) {
      // 全库重评：所有可见且未被删除/拉黑的图片/视频都重打该维
      add(`
        SELECT a.fid
        FROM assets a
        WHERE a.kind IN ('image','video') AND ${AUTH_VISIBLE_SQL} AND ${ACTIVE_ASSET_SQL}
      `);
    }

    add(`
      SELECT DISTINCT a.fid
      FROM assets a
      JOIN asset_tags at ON at.asset_fid = a.fid
      JOIN tag_dict t ON t.id = at.tag_id
      WHERE t.dimension = ? AND ${AUTH_VISIBLE_SQL} AND ${ACTIVE_ASSET_SQL}
        AND (at.confidence IS NULL OR at.confidence < 0.55)
    `, dim);

    if (fallbackDirs.length) {
      const ph = fallbackDirs.map(() => '?').join(',');
      add(`
        SELECT DISTINCT a.fid
        FROM assets a
        JOIN asset_tags at ON at.asset_fid = a.fid
        JOIN tag_dict t ON t.id = at.tag_id
        WHERE t.dimension = ? AND t.dir IN (${ph}) AND ${AUTH_VISIBLE_SQL} AND ${ACTIVE_ASSET_SQL}
      `, dim, ...fallbackDirs);
    }

    add(`
      SELECT a.fid
      FROM assets a
      WHERE a.kind IN ('image','video') AND ${AUTH_VISIBLE_SQL} AND ${ACTIVE_ASSET_SQL}
        AND NOT EXISTS (
          SELECT 1 FROM asset_tags at
          JOIN tag_dict t ON t.id = at.tag_id
          WHERE at.asset_fid = a.fid AND t.dimension = ? AND t.deprecated = 0
        )
    `, dim);

    add(`
      SELECT a.fid
      FROM assets a
      WHERE ${AUTH_VISIBLE_SQL} AND ${ACTIVE_ASSET_SQL}
        AND EXISTS (
          SELECT 1 FROM asset_tags at JOIN tag_dict t ON t.id = at.tag_id
          WHERE at.asset_fid = a.fid AND t.dimension = ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM asset_tags at JOIN tag_dict t ON t.id = at.tag_id
          WHERE at.asset_fid = a.fid AND t.dimension = ? AND t.deprecated = 0
        )
    `, dim, dim);

    byDimension[dim] = {
      count: dimSet.size,
      multi: !!DIM_META[dim]?.multi,
      fallbackDirs,
      all: !!all
    };
  }

  return { total: union.size, fids: [...union], byDimension };
}

function estimateRetag(db, dimensions, opts = {}) {
  const dims = (dimensions || []).map(String).filter(Boolean);
  if (!dims.length) return { total: 0, byDimension: {}, sampleFids: [], fids: [] };
  const r = collectRetagFids(db, dims, opts);
  return {
    total: r.total,
    byDimension: r.byDimension,
    sampleFids: r.fids.slice(0, 20),
    fids: r.fids
  };
}

function findTagNodeId(db) {
  let nodeId = 'tag';
  try {
    const wf = db.prepare("SELECT graph FROM workflows WHERE id='default'").get();
    if (wf?.graph) {
      const g = JSON.parse(wf.graph);
      const nodes = g.nodes || g.graph?.nodes || [];
      const tagNode = nodes.find(n => (n.type || n.data?.type) === 'tag' || n.id === 'tag');
      if (tagNode?.id) nodeId = tagNode.id;
    }
  } catch { /* fallback */ }
  return nodeId;
}

function enqueueDimensionRetag(db, { dimensions, schedule = 'now', actor, interpreter, all = false, fids = null, reason = 'dictionary_change' }) {
  const dims = (dimensions || []).map(String).filter(Boolean);
  if (!dims.length) {
    const err = new Error('dimensions 不能为空');
    err.status = 400;
    throw err;
  }

  const collected = collectRetagFids(db, dims, { all, fids });
  const fidsToQueue = collected.fids;
  const now = Date.now();
  const runId = `retag_${Math.floor(now / 1000)}_${crypto.randomBytes(3).toString('hex')}`;
  const optionsJson = JSON.stringify({
    all: !!all,
    forceAll: !!all,
    ...(Array.isArray(fids) && fids.length ? { fids: fidsToQueue.slice(0, 500) } : {})
  });

  // 夜间任务：只登记 job，到点由 claimNightRetagJobs 真正入队，避免提前开跑
  if (schedule === 'night') {
    db.prepare(`
      INSERT INTO retag_jobs (dimensions, reason, status, schedule, estimated, queued_count, run_id, actor, created_at, started_at, options)
      VALUES (?, ?, 'queued', 'night', ?, 0, ?, ?, ?, NULL, ?)
    `).run(JSON.stringify(dims), reason, collected.total, runId, actor || null, now, optionsJson);
    return {
      runId,
      dimensions: dims,
      estimated: collected.total,
      queued: 0,
      schedule: 'night',
      all: !!all,
      byDimension: collected.byDimension
    };
  }

  db.prepare(`
    INSERT INTO runs (id, workflow_id, workflow_version, trigger, status, asset_count, created_at, started_at)
    VALUES (?, 'default', 1, 'dict_retag', 'queued', ?, ?, ?)
  `).run(runId, fidsToQueue.length, now, now);

  const nodeId = findTagNodeId(db);
  const insertRun = db.prepare(`
    INSERT INTO node_runs (run_id, node_id, node_type, asset_fid, status, workflow_version, input_summary, created_at, updated_at)
    VALUES (?, ?, 'tag', ?, 'queued', 1, ?, ?, ?)
    ON CONFLICT(workflow_version, node_id, asset_fid) DO UPDATE SET
      status='queued', run_id=excluded.run_id, input_summary=excluded.input_summary,
      updated_at=excluded.updated_at, error=NULL, not_before=NULL
  `);
  const summary = JSON.stringify({
    dictRetag: true,
    dimensions: dims,
    reason,
    all: !!all,
    // 打标规则：style_atom 多选，wood_style 组内单选可空
    multi: { style_atom: true, wood_style: false }
  });
  for (const fid of fidsToQueue) insertRun.run(runId, nodeId, fid, summary, now, now);

  db.prepare(`
    INSERT INTO retag_jobs (dimensions, reason, status, schedule, estimated, queued_count, run_id, actor, created_at, started_at, options)
    VALUES (?, ?, 'queued', 'now', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    JSON.stringify(dims), reason,
    collected.total, fidsToQueue.length, runId, actor || null, now, now, optionsJson
  );

  if (interpreter?.kick) {
    try { interpreter.kick(); } catch { /* optional */ }
  }

  return {
    runId,
    dimensions: dims,
    estimated: collected.total,
    queued: fidsToQueue.length,
    schedule: 'now',
    all: !!all,
    byDimension: collected.byDimension
  };
}

function listRetagJobs(db, limit = 50) {
  return db.prepare('SELECT * FROM retag_jobs ORDER BY id DESC LIMIT ?').all(limit || 50)
    .map(j => {
      let dims = j.dimensions;
      try { dims = JSON.parse(j.dimensions); } catch { /* keep */ }
      return { ...j, dimensions: dims };
    });
}

function listDictAudit(db, { dimension, limit = 100 } = {}) {
  if (dimension) {
    return db.prepare('SELECT * FROM tag_dict_audit WHERE dimension=? ORDER BY id DESC LIMIT ?')
      .all(dimension, limit || 100);
  }
  return db.prepare('SELECT * FROM tag_dict_audit ORDER BY id DESC LIMIT ?').all(limit || 100);
}

function listAssetTagHistory(db, fid, limit = 50) {
  return db.prepare('SELECT * FROM asset_tag_history WHERE asset_fid=? ORDER BY id DESC LIMIT ?')
    .all(fid, limit || 50);
}

function assetsAffectedByAudit(db, auditId) {
  const row = db.prepare('SELECT * FROM tag_dict_audit WHERE id=?').get(auditId);
  if (!row) return [];
  const tag = db.prepare('SELECT id FROM tag_dict WHERE dimension=? AND dir=?').get(row.dimension, row.dir);
  if (!tag) return [];
  return db.prepare(`
    SELECT a.fid, a.file_name FROM asset_tags at
    JOIN assets a ON a.fid = at.asset_fid
    WHERE at.tag_id = ?
    LIMIT 200
  `).all(tag.id);
}

function claimNightRetagJobs(db, interpreter) {
  const jobs = db.prepare(`
    SELECT * FROM retag_jobs
    WHERE schedule='night' AND status='queued'
    ORDER BY id ASC LIMIT 5
  `).all();
  const out = [];
  for (const j of jobs) {
    let dims = [];
    try { dims = JSON.parse(j.dimensions); } catch { /* */ }
    let opts = {};
    try { opts = j.options ? JSON.parse(j.options) : {}; } catch { /* */ }
    const r = enqueueDimensionRetag(db, {
      dimensions: dims,
      schedule: 'now',
      actor: 'night_timer',
      interpreter,
      all: !!opts.all || !!opts.forceAll,
      fids: Array.isArray(opts.fids) && opts.fids.length ? opts.fids : null,
      reason: j.reason || 'night_retag'
    });
    db.prepare("UPDATE retag_jobs SET status='dispatched', started_at=?, run_id=?, queued_count=? WHERE id=?")
      .run(Date.now(), r.runId, r.queued, j.id);
    out.push({ jobId: j.id, ...r });
  }
  return out;
}

function startNightRetagTimer(services, { hour = 2, minute = 0 } = {}) {
  const { db, interpreter } = services;
  let lastKey = '';
  const tick = () => {
    try {
      // 每次读取 runtime_config，改时刻无需重启
      let h = hour, m = minute;
      try {
        const { getEffectiveConfig } = require('./runtime-config');
        h = Number(getEffectiveConfig(db, 'retag_night_hour', hour));
        m = Number(getEffectiveConfig(db, 'retag_night_minute', minute));
      } catch { /* fallback 启动参数 */ }
      if (!Number.isFinite(h)) h = hour;
      if (!Number.isFinite(m)) m = minute;

      const now = new Date();
      if (now.getHours() !== h || now.getMinutes() !== m) return;
      const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
      if (lastKey === key) return;
      lastKey = key;
      const claimed = claimNightRetagJobs(db, interpreter);
      if (claimed.length) {
        console.log(`[retag-night] 夜间字典重打已派发 ${claimed.length} 个任务`, claimed.map(c => ({
          jobId: c.jobId, runId: c.runId, queued: c.queued, dimensions: c.dimensions
        })));
      }
    } catch (e) {
      console.warn('[retag-night] 定时器异常', e.message);
    }
  };
  const timer = setInterval(tick, 30 * 1000);
  if (timer.unref) timer.unref();
  console.log(`[retag-night] 定时器已启动（默认 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}，可被 runtime_config 覆盖）`);
  return timer;
}

module.exports = {
  DIM_META,
  ensureGovernanceSchema,
  listDict,
  filterVocabulary,
  upsertTag,
  setDeprecated,
  draftCriteria,
  slugifyLabel,
  parseAliases,
  estimateRetag,
  enqueueDimensionRetag,
  listRetagJobs,
  listDictAudit,
  listAssetTagHistory,
  assetsAffectedByAudit,
  startNightRetagTimer,
  claimNightRetagJobs,
  findTagNodeId,
  logAssetTagHistory
};
