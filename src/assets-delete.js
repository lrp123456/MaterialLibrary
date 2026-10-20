/**
 * 素材软删 + 全局黑名单。
 * 删除后：列表不可见、NAS 原文件移入 trash、快照/上传按 key 拒收，再次同步同图不会入库。
 *
 * ── 状态与窗口约定（2026-10-02 状态统一机制）────────────────────────────
 * 「为何被丢弃」不新增状态，而是记在 dispose_source（审计字段）。
 * 生命周期只用 status 表达：ready / pending / deleted / rejected / excluded。
 * 回收站保留窗口按来源分档，AI 判定类给足纠错时间：
 *   user_delete 3 天 · dedupe 7 天 · gate_reject 14 天 · gateway_reject 14 天
 * 客户端可传 config.trashRetentionDays 覆盖。
 */
const fs = require('fs');
const path = require('path');

/** 回收站保留窗口（天）。AI 判定误判成本最高，给最长窗口。 */
const TRASH_RETENTION_DAYS = {
  user_delete: 3,
  dedupe: 7,
  gate_reject: 14,
  gateway_reject: 14,
  album_removed: 7,
  purge_expired: 0,
};
const DEFAULT_RETENTION_DAYS = 7;

/** dispose_source → 客户端展示文案与判定标准说明 */
const DISPOSE_META = {
  user_delete: { label: '主动删除', criterion: '你手动删除的素材' },
  dedupe: { label: '查重命中', criterion: '与库内已有素材指纹或近似度重复，自动保留了更优的一份' },
  gate_reject: { label: 'AI 判定非素材', criterion: 'AI 闸门判定该图不属于室内/建筑设计参考素材' },
  gateway_reject: { label: '网关拒收', criterion: '入库网关内容审核未通过' },
  album_removed: { label: '相册已删除', criterion: '该素材在来源设备的手机相册中已被删除，且超过宽限期仍未恢复' },
  purge_expired: { label: '已到期', criterion: '超过保留期，已自动清理' },
};

/** 取某个来源的保留天数（config 可覆盖） */
function retentionDaysFor(config, source) {
  const override = config && config.trashRetentionDays;
  if (override && typeof override === 'object') {
    const v = Number(override[source]);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  const d = TRASH_RETENTION_DAYS[source];
  return Number.isFinite(d) ? d : DEFAULT_RETENTION_DAYS;
}

/** 由 deleted_by 旧值推断 dispose_source（兼容历史数据） */
function inferDisposeSource(deletedBy, hint) {
  const s = String(deletedBy || '').toLowerCase();
  if (s.includes('album') || s.includes('reconcile')) return 'album_removed';
  if (s.includes('dedupe')) return 'dedupe';
  if (s.includes('gateway')) return 'gateway_reject';
  if (s.includes('gate') || s.includes('interpreter')) return 'gate_reject';
  if (s.includes('purge')) return 'purge_expired';
  if (s.includes('user') || s === 'viewer' || s === 'admin') return 'user_delete';
  return hint || 'user_delete';
}

const _ensuredTables = new WeakMap();

function ensureTables(db) {
  if (_ensuredTables.get(db)) return;
  _ensuredTables.set(db, true);
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,              -- item_key | sha256 | client_asset_id | fid
      value TEXT NOT NULL,
      fid TEXT,
      reason TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(kind, value)
    );
    CREATE INDEX IF NOT EXISTS idx_blacklist_value ON asset_blacklist(value);
    CREATE INDEX IF NOT EXISTS idx_blacklist_fid ON asset_blacklist(fid);
    CREATE TABLE IF NOT EXISTS asset_trash (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fid TEXT NOT NULL,
      file_name TEXT,
      nas_rel TEXT,
      trash_rel TEXT,
      size INTEGER,
      deleted_by TEXT,
      deleted_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trash_fid ON asset_trash(fid);
    CREATE INDEX IF NOT EXISTS idx_trash_deleted_at ON asset_trash(deleted_at);
    -- 去重指纹黑名单：历史写入失败导致表缺失，重复素材反复入库（2026-10-02 修复）
    CREATE TABLE IF NOT EXISTS phash_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phash TEXT,
      fid TEXT,
      file_name TEXT,
      reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_phash_bl ON phash_blacklist(phash);
  `);
  // 历史表补列（SQLite ALTER ADD COLUMN 幂等：重复执行会抛错，需捕获）
  const cols = db.prepare('PRAGMA table_info(asset_trash)').all().map((r) => r.name);
  if (!cols.includes('dispose_source')) {
    try { db.exec("ALTER TABLE asset_trash ADD COLUMN dispose_source TEXT"); } catch (_) {}
  }
  if (!cols.includes('dispose_detail')) {
    try { db.exec("ALTER TABLE asset_trash ADD COLUMN dispose_detail TEXT"); } catch (_) {}
  }
  if (!cols.includes('dispose_at')) {
    try { db.exec("ALTER TABLE asset_trash ADD COLUMN dispose_at INTEGER"); } catch (_) {}
  }
}

function resolveOriginFile(config, db, fid, nasRel) {
  const cands = [];
  if (nasRel) {
    if (path.isAbsolute(nasRel)) cands.push(nasRel);
    if (config?.nasDir) cands.push(path.join(config.nasDir, nasRel));
    if (config?.dataDir) cands.push(path.join(config.dataDir, nasRel));
    if (config?.nasOriginalsRoot) cands.push(path.join(config.nasOriginalsRoot, nasRel));
  }
  try {
    const d = db.prepare("SELECT storage_type, storage_ref, params FROM derivatives WHERE asset_fid=? AND kind='origin' ORDER BY id DESC LIMIT 1").get(fid);
    if (d?.storage_ref) {
      if (path.isAbsolute(d.storage_ref)) cands.push(d.storage_ref);
      if (config?.nasDir) cands.push(path.join(config.nasDir, d.storage_ref));
      if (config?.dataDir) cands.push(path.join(config.dataDir, d.storage_ref));
    }
    if (d?.params) {
      const p = JSON.parse(d.params);
      if (p.path) {
        if (path.isAbsolute(p.path)) cands.push(p.path);
        if (config?.nasDir) cands.push(path.join(config.nasDir, p.path));
        if (config?.dataDir) cands.push(path.join(config.dataDir, p.path));
      }
    }
  } catch (_) {}
  for (const c of cands) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function itemKeyOf(name, size) {
  return `${name}|${Number(size) || 0}`;
}

function isBlacklisted(db, { itemKey, sha256, clientAssetId, fid }) {
  ensureTables(db);
  const ors = [];
  const args = [];
  if (itemKey) {
    ors.push('(kind=? AND value=?)');
    args.push('item_key', itemKey);
  }
  if (sha256) {
    ors.push('(kind=? AND value=?)');
    args.push('sha256', sha256);
  }
  if (clientAssetId) {
    ors.push('(kind=? AND value=?)');
    args.push('client_asset_id', String(clientAssetId));
  }
  if (fid) {
    ors.push('(kind=? AND value=?)');
    args.push('fid', fid);
  }
  if (!ors.length) return false;
  const row = db.prepare(`SELECT id FROM asset_blacklist WHERE ${ors.join(' OR ')} LIMIT 1`).get(...args);
  return Boolean(row);
}

function addBlacklist(db, entries, { reason = 'user_delete', createdBy = '' } = {}) {
  ensureTables(db);
  const now = Date.now();
  const ins = db.prepare(`
    INSERT INTO asset_blacklist (kind, value, fid, reason, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, value) DO UPDATE SET
      fid=COALESCE(excluded.fid, asset_blacklist.fid),
      reason=excluded.reason
  `);
  let n = 0;
  for (const e of entries) {
    if (!e || !e.value) continue;
    ins.run(e.kind, String(e.value), e.fid || null, reason, createdBy, now);
    n++;
  }
  return n;
}

/**
 * 软删素材：assets.status=deleted + 黑名单 + NAS 移入 trash
 *
 * @param disposeSource user_delete | dedupe | gate_reject | gateway_reject
 *        不传则由 deletedBy 推断。判定原文（AI 闸门/网关的理由）会一并存进回收站，
 *        供客户端展示「为何进入回收站」。
 */
function softDeleteAsset(services, fid, { deletedBy = '', reason = 'user_delete', disposeSource = '', disposeDetail = '', allowReferenced = false } = {}) {
  const { db, config, logger } = services;
  ensureTables(db);
  const asset = db.prepare('SELECT fid, file_name, size, sha256, client_asset_id, status, error_note, reject_reason, reject_detail FROM assets WHERE fid=?').get(fid);
  if (!asset) {
    const err = new Error('素材不存在');
    err.code = 'not_found';
    throw err;
  }

  // 被云端剪辑工程引用的素材不能直接删：删了之后别的机器拉下来就是黑块。
  // 调用方需先解除引用（或显式传 allowReferenced 走强制删除）。
  if (!allowReferenced) {
    try {
      const { assetsUsedByProjects } = require('./clip-snapshots');
      const used = assetsUsedByProjects(db, fid);
      if (used.length) {
        const err = new Error(
          `素材被 ${used.length} 个剪辑工程引用：${used.slice(0, 3).map((x) => x.name).join('、')}${used.length > 3 ? ' 等' : ''}`,
        );
        err.status = 409;
        err.code = 'referenced_by_clip_projects';
        err.usedBy = used;
        throw err;
      }
    } catch (e) {
      if (e && e.status === 409) throw e;
      // 剪辑表还没建（未启用剪辑板块）时不应阻断正常删除。
    }
  }

  if (asset.status === 'deleted') {
    return { fid, alreadyDeleted: true };
  }

  // 处置来源：显式传入 > 判定原文推断 > deletedBy 推断
  const src = disposeSource
    || (asset.error_note && /闸门判定|非素材/.test(asset.error_note) ? 'gate_reject' : '')
    || (asset.reject_reason ? 'gateway_reject' : '')
    || inferDisposeSource(deletedBy, reason);
  // 判定原文：优先取本次传入，其次取 assets 上留存的 AI 判定理由
  const detail = String(
    disposeDetail || asset.error_note || asset.reject_detail || asset.reject_reason || ''
  ).trim();

  // 主衍生 NAS 相对路径
  let nasRel = null;
  try {
    const d = db.prepare(`
      SELECT storage_ref FROM derivatives
      WHERE asset_fid=? AND kind='origin'
      ORDER BY id DESC LIMIT 1
    `).get(fid);
    nasRel = d?.storage_ref || null;
  } catch (_) {}

  // 先定位原文件（不动盘），再事务写库，最后才 rename 到 trash
  let trashRel = null;
  const realSrc = resolveOriginFile(config, db, fid, nasRel);
  if (realSrc && config?.dataDir) {
    const stamp = Date.now();
    trashRel = path.join('trash', `${stamp}_${path.basename(realSrc)}`);
  }

  const keys = [
    { kind: 'fid', value: fid, fid },
  ];
  if (asset.sha256) keys.push({ kind: 'sha256', value: asset.sha256, fid });
  if (asset.client_asset_id) keys.push({ kind: 'client_asset_id', value: String(asset.client_asset_id), fid });
  if (asset.file_name) keys.push({ kind: 'item_key', value: itemKeyOf(asset.file_name, asset.size), fid });
  try {
    const als = db.prepare('SELECT item_key FROM asset_aliases WHERE fid=?').all(fid);
    for (const a of als) {
      if (a.item_key) keys.push({ kind: 'item_key', value: a.item_key, fid });
    }
  } catch (_) {}

  const now = Date.now();
  db.transaction(() => {
    addBlacklist(db, keys, { reason, createdBy: deletedBy });
    db.prepare("UPDATE assets SET status='deleted', updated_at=? WHERE fid=?").run(now, fid);
    db.prepare(`
      INSERT INTO asset_trash (fid, file_name, nas_rel, trash_rel, size, deleted_by, deleted_at, dispose_source, dispose_detail, dispose_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fid, asset.file_name, nasRel, trashRel, asset.size, deletedBy, now, src, detail, now);
    try {
      db.prepare(`INSERT INTO sync_events (device_id, event_type, media_kind, name, size, item_key, at)
        VALUES (?, 'removed', ?, ?, ?, ?, ?)
      `).run('*', asset.file_name?.endsWith('.mp4') || asset.file_name?.endsWith('.mov') ? 'video' : 'image',
        asset.file_name || '', Number(asset.size) || 0, fid, now);
    } catch (_) {}
  })();

  // 事务提交后再搬文件；失败不回滚已删除状态（可人工从 trash 回收）
  if (realSrc && trashRel && fs.existsSync(realSrc)) {
    const dest = path.join(config.dataDir, trashRel);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(realSrc, dest);
    } catch {
      try {
        fs.copyFileSync(realSrc, dest);
        fs.unlinkSync(realSrc);
      } catch (e) {
        logger?.warn?.('[assets-delete] 移动原文件失败', e.message);
      }
    }
    logger?.info?.(`[assets-delete] file parked at ${trashRel}`);
  }

  logger?.info?.(`[assets-delete] 软删 ${fid} by=${deletedBy} keys=${keys.length}`);
  return { fid, deleted: true, blacklistKeys: keys.length, trashRel };
}

function listBlacklist(db, { limit = 200 } = {}) {
  ensureTables(db);
  return db.prepare('SELECT * FROM asset_blacklist ORDER BY id DESC LIMIT ?').all(limit);
}

/**
 * 构造「按来源分档」的到期时间 SQL 片段。
 * config.trashRetentionDays 可按来源覆盖天数。
 */
function expiresAtSql(config) {
  const cases = [];
  const params = [];
  for (const [src, def] of Object.entries(TRASH_RETENTION_DAYS)) {
    const days = retentionDaysFor(config, src);
    if (!Number.isFinite(days) || days <= 0) continue;
    cases.push(`WHEN ? THEN t.deleted_at + ?`);
    params.push(src, Math.round(days * 86400 * 1000));
  }
  const fallbackMs = Math.round(retentionDaysFor(config, '__default__') * 86400 * 1000);
  const when = cases.length ? cases.join(' ') : '';
  // ELSE 分支的占位符也必须有一个实参，否则 SQLite 报 datatype mismatch
  params.push(fallbackMs);
  return {
    sql: `CASE COALESCE(t.dispose_source, 'user_delete') ${when} ELSE t.deleted_at + ? END`,
    params,
    fallbackMs,
  };
}

/**
 * 批量取标签文案：fid → string[]
 *
 * 标签存在关联表 asset_tags + tag_dict，assets 表本身没有 tags_text 列。
 * 早期版本在 listTrash / getTrashDetail 里直接 SELECT a.tags_text，
 * 而该列从未被建过 → 整条回收站查询抛 "no such column: a.tags_text"，
 * 表现为 App 端回收站页面只显示红色报错 + 「重试」按钮。
 */
function loadTagsMap(db, fids) {
  const map = new Map();
  const list = [...new Set((fids || []).filter(Boolean).map(String))];
  if (!list.length) return map;
  const CHUNK = 400;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const sp = chunk.map(() => '?').join(',');
    let rows = [];
    try {
      rows = db.prepare(`
        SELECT at.asset_fid, t.label
        FROM asset_tags at
        JOIN tag_dict t ON t.id = at.tag_id
        WHERE at.asset_fid IN (${sp})
      `).all(...chunk);
    } catch (e) {
      // 标签表尚未建立时不阻断回收站主流程
      return map;
    }
    for (const r of rows) {
      if (!map.has(r.asset_fid)) map.set(r.asset_fid, []);
      map.get(r.asset_fid).push(r.label);
    }
  }
  return map;
}

/** 回收站列表：附带处置来源、判定原文、按来源分档的剩余时间 */
function listTrash(services, { page = 1, pageSize = 30, source = '', sort = '', keyword = '' } = {}) {
  const { db, config } = services;
  ensureTables(db);
  const offset = (Math.max(1, page) - 1) * pageSize;
  const now = Date.now();
  const exp = expiresAtSql(config);

  const where = [`(${exp.sql}) > ?`];
  const args = [...exp.params, now];
  if (source) {
    where.push('COALESCE(t.dispose_source, ?) = ?');
    args.push('user_delete', source);
  }
  if (keyword) {
    where.push('(t.file_name LIKE ? OR t.fid LIKE ?)');
    args.push(`%${keyword}%`, `%${keyword}%`);
  }
  const order = sort === 'oldest'
    ? 't.deleted_at ASC'
    : sort === 'name'
      ? 't.file_name ASC'
      : 't.deleted_at DESC';
  const whereSql = where.join(' AND ');

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM asset_trash t WHERE ${whereSql}`).get(...args);
  const rows = db.prepare(`
    SELECT t.*, a.kind as asset_kind, a.origin_orientation, a.status as asset_status,
      a.error_note, a.reject_reason, a.reject_detail, a.size as asset_size, a.created_at as asset_created_at,
      a.width, a.height, a.source as asset_source,
      (${exp.sql}) as expires_at,
      (SELECT COUNT(*) FROM derivatives d WHERE d.asset_fid = t.fid AND d.kind != 'origin') as deleted_deriv_count
    FROM asset_trash t
    LEFT JOIN assets a ON a.fid = t.fid
    WHERE ${whereSql}
    ORDER BY ${order}
    LIMIT ? OFFSET ?
  `).all(...exp.params, ...args, pageSize, offset);

  // 标签在 asset_tags + tag_dict 里，assets 表没有 tags_text 文本列。
  // （曾在这里写 a.tags_text，导致整条回收站查询报 "no such column: a.tags_text"）
  const tagsOf = loadTagsMap(db, rows.map((r) => r.fid));

  const items = rows.map((r) => {
    const src = r.dispose_source || inferDisposeSource(r.deleted_by, '');
    const meta = DISPOSE_META[src] || DISPOSE_META.user_delete;
    const expiresAt = Number(r.expires_at) || (r.deleted_at + exp.fallbackMs);
    const remainingHours = Math.max(0, Math.ceil((expiresAt - now) / (3600 * 1000)));
    // 外部来源（夸克等）没有本地文件，由远端/网盘托管，只要未过保留期即可恢复
    let fileMissing = false;
    const isCloud = r.asset_source === 'quark' || r.asset_source === 'remote' || String(r.fid || '').startsWith('~');
    if (isCloud) {
      fileMissing = false;
    } else if (r.trash_rel && config?.dataDir) {
      const p = path.isAbsolute(r.trash_rel) ? r.trash_rel : path.join(config.dataDir, r.trash_rel);
      fileMissing = !fs.existsSync(p);
    } else {
      // trash_rel 为空，检查原文件是否仍在 NAS 或有本地衍生
      const real = resolveOriginFile(config, db, r.fid, r.nas_rel);
      fileMissing = !real;
    }
    return {
      fid: r.fid,
      fileName: r.file_name || r.fid,
      size: r.asset_size || r.size || 0,
      deletedAt: r.deleted_at,
      deletedBy: r.deleted_by || '',
      disposeSource: src,
      disposeLabel: meta.label,
      disposeCriterion: meta.criterion,
      disposeDetail: String(r.dispose_detail || r.error_note || r.reject_detail || r.reject_reason || '').trim(),
      deletedDerivCount: r.deleted_deriv_count || 0,
      expiresAt,
      remainingHours,
      expiringSoon: remainingHours > 0 && remainingHours <= 24,
      fileMissing,
      kind: r.asset_kind || (r.file_name?.match(/\.(mp4|mov|webm)$/i) ? 'video' : 'image'),
      width: r.width || 0,
      height: r.height || 0,
      source: r.asset_source || '',
      tagsText: (tagsOf.get(r.fid) || []).join(' · '),
      thumbUrl: `/api/viewer/assets/${encodeURIComponent(r.fid)}/image?local=1`,
    };
  });

  // 严格过滤：文件已被清理的幽灵记录绝不放入回收站列表（用户要求：不可恢复/文件已清理的绝不进入垃圾库）
  const restorableItems = items.filter((it) => !it.fileMissing);

  return { items: restorableItems, total: restorableItems.length, page, pageSize };
}

/** 回收站单条详情：含判定原文全文、判定标准、素材元信息 */
function getTrashDetail(services, fid) {
  const { db, config } = services;
  ensureTables(db);
  const exp = expiresAtSql(config);
  const now = Date.now();
  const row = db.prepare(`
    SELECT t.*, a.kind as asset_kind, a.origin_orientation, a.status as asset_status,
      a.error_note, a.reject_reason, a.reject_detail, a.size as asset_size, a.created_at as asset_created_at,
      a.width, a.height, a.source as asset_source, a.sha256, a.client_asset_id,
      (${exp.sql}) as expires_at,
      (SELECT COUNT(*) FROM derivatives d WHERE d.asset_fid = t.fid AND d.kind != 'origin') as deleted_deriv_count
    FROM asset_trash t
    LEFT JOIN assets a ON a.fid = t.fid
    WHERE t.fid = ?
    ORDER BY t.id DESC LIMIT 1
  `).get(...exp.params, fid);
  if (!row) {
    const err = new Error('回收站中未找到该素材或已被清理');
    err.code = 'not_found';
    throw err;
  }
  const src = row.dispose_source || inferDisposeSource(row.deleted_by, '');
  const meta = DISPOSE_META[src] || DISPOSE_META.user_delete;
  const expiresAt = Number(row.expires_at) || (row.deleted_at + exp.fallbackMs);
  const remainingHours = Math.max(0, Math.ceil((expiresAt - now) / (3600 * 1000)));
  let fileMissing = false;
  const isCloud = row.asset_source === 'quark' || row.asset_source === 'remote' || String(row.fid || '').startsWith('~');
  if (isCloud) {
    fileMissing = false;
  } else if (row.trash_rel && config?.dataDir) {
    const p = path.isAbsolute(row.trash_rel) ? row.trash_rel : path.join(config.dataDir, row.trash_rel);
    fileMissing = !fs.existsSync(p);
  } else {
    const real = resolveOriginFile(config, db, row.fid, row.nas_rel);
    fileMissing = !real;
  }
  return {
    fid: row.fid,
    fileName: row.file_name || row.fid,
    size: row.asset_size || row.size || 0,
    createdAt: row.asset_created_at || 0,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by || '',
    disposeSource: src,
    disposeLabel: meta.label,
    disposeCriterion: meta.criterion,
    disposeDetail: String(row.dispose_detail || row.error_note || row.reject_detail || row.reject_reason || '').trim(),
    deletedDerivCount: row.deleted_deriv_count || 0,
    expiresAt,
    remainingHours,
    expiringSoon: remainingHours > 0 && remainingHours <= 24,
    fileMissing,
    restoreReady: !fileMissing,
    kind: row.asset_kind || (row.file_name?.match(/\.(mp4|mov|webm)$/i) ? 'video' : 'image'),
    width: row.width || 0,
    height: row.height || 0,
    source: row.asset_source || '',
    tagsText: (loadTagsMap(db, [fid]).get(fid) || []).join(' · '),
    thumbUrl: `/api/viewer/assets/${encodeURIComponent(row.fid)}/image?local=1`,
  };
}

/** 归一化单个 fid 或 fid 数组 */
function toFidList(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.map((x) => String(x || '').trim()).filter(Boolean))];
  }
  const one = String(input || '').trim();
  return one ? [one] : [];
}

function restoreTrashAsset(services, fidOrList) {
  const { db, config, logger } = services;
  ensureTables(db);
  const fids = toFidList(fidOrList);
  if (!fids.length) {
    const err = new Error('未指定要恢复的素材');
    err.code = 'bad_request';
    throw err;
  }
  const restored = [];
  const failed = [];
  for (const fid of fids) {
    try {
      restoreTrashAssetOne(services, fid);
      restored.push(fid);
    } catch (e) {
      failed.push({ fid, error: e.message });
    }
  }
  logger?.info?.(`[assets-delete] 恢复 ${restored.length} 项，失败 ${failed.length} 项`);
  return { restored, failed, count: restored.length };
}

function restoreTrashAssetOne(services, fid) {
  const { db, config, logger } = services;
  const trashRow = db.prepare('SELECT * FROM asset_trash WHERE fid=? ORDER BY id DESC LIMIT 1').get(fid);
  if (!trashRow) {
    throw new Error('回收站中未找到该素材或已被清理');
  }

  // 移回原文件
  if (trashRow.trash_rel && config?.dataDir) {
    const trashPath = path.isAbsolute(trashRow.trash_rel) ? trashRow.trash_rel : path.join(config.dataDir, trashRow.trash_rel);
    if (fs.existsSync(trashPath)) {
      let dest = null;
      if (trashRow.nas_rel) {
        dest = path.isAbsolute(trashRow.nas_rel) ? trashRow.nas_rel : path.join(config.nasDir || config.dataDir, trashRow.nas_rel);
      }
      if (dest) {
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(trashPath, dest);
        } catch {
          try {
            fs.copyFileSync(trashPath, dest);
            fs.unlinkSync(trashPath);
          } catch (e) {
            logger?.warn?.('[assets-delete] 移回原文件失败', e.message);
          }
        }
      }
    }
  }

  const now = Date.now();
  db.transaction(() => {
    db.prepare('DELETE FROM asset_blacklist WHERE fid=?').run(fid);
    const asset = db.prepare('SELECT sha256, file_name, size FROM assets WHERE fid=?').get(fid);
    if (asset && asset.sha256) db.prepare("DELETE FROM asset_blacklist WHERE kind='sha256' AND value=?").run(asset.sha256);
    if (asset && asset.file_name) db.prepare("DELETE FROM asset_blacklist WHERE kind='item_key' AND value=?").run(itemKeyOf(asset.file_name, asset.size));

    db.prepare("UPDATE assets SET status='ready', updated_at=? WHERE fid=?").run(now, fid);
    db.prepare('DELETE FROM asset_trash WHERE fid=?').run(fid);
  })();

  logger?.info?.(`[assets-delete] 已从回收站恢复 ${fid}`);
  return { fid, restored: true };
}

/** 彻底清除：真删文件 + 删 DB 行。支持批量，部分失败不阻断其余。 */
function purgeTrashAsset(services, fidOrList) {
  const { db, logger } = services;
  ensureTables(db);
  const fids = toFidList(fidOrList);
  if (!fids.length) {
    const err = new Error('未指定要清除的素材');
    err.code = 'bad_request';
    throw err;
  }
  const purged = [];
  const failed = [];
  for (const fid of fids) {
    try {
      purgeTrashAssetOne(services, fid);
      purged.push(fid);
    } catch (e) {
      failed.push({ fid, error: e.message });
    }
  }
  logger?.info?.(`[assets-delete] 彻底清除 ${purged.length} 项，失败 ${failed.length} 项`);
  return { purged, failed, count: purged.length };
}

function purgeTrashAssetOne(services, fid) {
  const { db, config, logger } = services;
  const trashRow = db.prepare('SELECT * FROM asset_trash WHERE fid=? ORDER BY id DESC LIMIT 1').get(fid);
  if (trashRow && trashRow.trash_rel && config?.dataDir) {
    const trashPath = path.isAbsolute(trashRow.trash_rel) ? trashRow.trash_rel : path.join(config.dataDir, trashRow.trash_rel);
    if (fs.existsSync(trashPath)) {
      try { fs.unlinkSync(trashPath); } catch (_) {}
    }
  }

  try {
    const derivs = db.prepare('SELECT storage_ref FROM derivatives WHERE asset_fid=?').all(fid);
    for (const d of derivs) {
      if (d.storage_ref && config?.dataDir) {
        const dp = path.isAbsolute(d.storage_ref) ? d.storage_ref : path.join(config.dataDir, d.storage_ref);
        if (fs.existsSync(dp)) {
          try { fs.unlinkSync(dp); } catch (_) {}
        }
      }
    }
    db.prepare('DELETE FROM derivatives WHERE asset_fid=?').run(fid);
    db.prepare('DELETE FROM asset_tags WHERE asset_fid=?').run(fid);
    db.prepare('DELETE FROM asset_colors WHERE asset_fid=?').run(fid);
    db.prepare('DELETE FROM assets WHERE fid=?').run(fid);
    db.prepare('DELETE FROM asset_trash WHERE fid=?').run(fid);
    // 连带清理附属表的孤儿行，避免指纹比对命中幽灵 fid。
    // 注意各表外键列名不统一：asset_vectors 用 asset_fid，其余用 fid。
    for (const [t, key] of [['asset_aliases', 'fid'], ['asset_vectors', 'asset_fid'],
      ['asset_blacklist', 'fid'], ['phash_blacklist', 'fid']]) {
      try { db.prepare(`DELETE FROM ${t} WHERE ${key}=?`).run(fid); } catch (_) {}
    }
  } catch (e) {
    logger?.warn?.(`[assets-delete] purge cleanup failed for ${fid}:`, e.message);
  }

  return { fid, purged: true };
}

/** 自动清理：按 dispose_source 分档窗口，各来源各按自己的天数到期 */
function autoPurgeExpiredTrash(services) {
  const { db, config, logger } = services;
  try {
    ensureTables(db);
    const exp = expiresAtSql(config);
    const now = Date.now();
    const expired = db.prepare(`
      SELECT fid, dispose_source, deleted_by, deleted_at, (${exp.sql}) as expires_at
      FROM asset_trash t
      WHERE (${exp.sql}) <= ?
    `).all(...exp.params, ...exp.params, now);
    if (!expired.length) return 0;
    logger?.info?.(`[assets-delete] 到期自动清理 ${expired.length} 项`);
    let done = 0;
    for (const row of expired) {
      try {
        purgeTrashAssetOne(services, row.fid);
        done++;
      } catch (err) {
        logger?.warn?.(`[assets-delete] 自动清理 ${row.fid} 失败:`, err.message);
      }
    }
    return done;
  } catch (e) {
    logger?.warn?.('[assets-delete] autoPurge 失败', e.message);
    return 0;
  }
}

function latestGateVerdict(db, fid, disposeDetail) {
  let category = '';
  let reason = String(disposeDetail || '');
  try {
    const row = db.prepare(`
      SELECT output_summary FROM node_runs
      WHERE asset_fid=? AND node_type='gate' AND status='done'
      ORDER BY id DESC LIMIT 1
    `).get(fid);
    if (row && row.output_summary) {
      const parsed = JSON.parse(row.output_summary);
      category = parsed.category || '';
      if (parsed.reason) reason = parsed.reason;
    }
  } catch (_) {}
  return { category, reason };
}

function trashFileExists(services, trashRow) {
  if (!trashRow || !trashRow.trash_rel || !services.config || !services.config.dataDir) return false;
  const abs = path.isAbsolute(trashRow.trash_rel)
    ? trashRow.trash_rel
    : path.join(services.config.dataDir, trashRow.trash_rel);
  return fs.existsSync(abs);
}

/**
 * 只捞回仍在回收站、文件还在的 gate_reject。可重复执行。
 * 不调用视觉模型，也不走尺寸闸。
 */
function rehomeGateRejects(services) {
  const { db } = services;
  ensureTables(db);
  const { classifyTrashRecovery } = require('./gate-route');
  const rows = db.prepare(`
    SELECT fid, dispose_detail, trash_rel FROM asset_trash
    WHERE dispose_source='gate_reject'
    ORDER BY id ASC
  `).all();
  const restored = [];
  const kept = [];
  const skipped = [];
  const restageFids = [];
  for (const row of rows) {
    if (!trashFileExists(services, row)) {
      skipped.push({ fid: row.fid, reason: 'file_missing' });
      continue;
    }
    const verdict = latestGateVerdict(db, row.fid, row.dispose_detail);
    const decision = classifyTrashRecovery(verdict.category, verdict.reason);
    if (!decision.library) {
      kept.push({ fid: row.fid, reason: verdict.reason });
      continue;
    }
    try {
      restoreTrashAssetOne(services, row.fid);
      const status = decision.restage ? 'processing' : 'ready';
      db.prepare('UPDATE assets SET category=?, status=?, updated_at=? WHERE fid=?')
        .run(decision.library, status, Date.now(), row.fid);
      restored.push({ fid: row.fid, library: decision.library, restage: decision.restage });
      if (decision.restage) restageFids.push(row.fid);
    } catch (e) {
      skipped.push({ fid: row.fid, reason: e.message });
    }
  }
  let run = null;
  if (restageFids.length) {
    try {
      run = queueRehomeFromTag(db, restageFids);
    } catch (e) {
      run = { error: e.message };
    }
  }
  return { restored, kept, skipped, restageQueued: restageFids.length, run };
}

function queueRehomeFromTag(db, fids) {
  const wf = db.prepare("SELECT id, version, graph_json FROM workflows WHERE id='default'").get();
  if (!wf || !wf.graph_json) return null;
  const graph = JSON.parse(wf.graph_json);
  const start = (graph.nodes || []).find((n) => n.type === 'tag' && n.enabled !== false)
    || (graph.nodes || []).find((n) => n.type === 'tag');
  if (!start) return null;
  const runId = `run_rehome_${Date.now()}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO runs (id, workflow_id, workflow_version, trigger, status, asset_count, created_at)
    VALUES (?, ?, ?, 'gate_rehome', 'queued', ?, ?)
  `).run(runId, wf.id, wf.version, fids.length, now);
  const ins = db.prepare(`
    INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, created_at, updated_at, not_before)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, NULL)
    ON CONFLICT(workflow_version, node_id, asset_fid) DO UPDATE SET
      status='queued', error=NULL, run_id=excluded.run_id, updated_at=excluded.updated_at, not_before=NULL
  `);
  for (const fid of fids) ins.run(runId, wf.version, start.id, start.type, fid, now, now);
  return { runId, count: fids.length };
}

module.exports = {
  ensureTables,
  isBlacklisted,
  addBlacklist,
  softDeleteAsset,
  listBlacklist,
  listTrash,
  getTrashDetail,
  restoreTrashAsset,
  purgeTrashAsset,
  autoPurgeExpiredTrash,
  rehomeGateRejects,
  itemKeyOf,
  TRASH_RETENTION_DAYS,
  DISPOSE_META,
  inferDisposeSource,
  retentionDaysFor,
};
