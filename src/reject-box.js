/**
 * 拒收箱：列表 / 详情 / 恢复 / 批量恢复 / 过期清理
 * 规则（已与用户确认）：
 *  - 3 天内可查看、可恢复；恢复需选原因（按拒收原因动态给选项）
 *  - 恢复 → status=ready，补跑打标；内容豁免但以后仍参与指纹查重
 *  - 超期未恢复 → 删记录 + 删服务端文件 + 拉黑 sha256/md5 与 pHash≤2
 */
const fs = require('fs');
const path = require('path');
const gateway = require('./gateway');

function ensure(db) {
  gateway.ensureGatewayTables(db);
}

function listRejected(db, { page = 1, pageSize = 30 } = {}) {
  ensure(db);
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(100, Number(pageSize) || 30));
  const total = db.prepare("SELECT COUNT(*) c FROM assets WHERE status='rejected'").get().c;
  const items = db.prepare(`
    SELECT fid, file_name, width, height, size, reject_reason, reject_detail, rejected_at, thumb_url, origin_orientation
    FROM assets WHERE status='rejected'
    ORDER BY rejected_at DESC, fid DESC
    LIMIT ? OFFSET ?
  `).all(ps, (p - 1) * ps);
  const cfg = gateway.getConfig(db);
  const now = Date.now();
  return {
    page: p,
    pageSize: ps,
    total,
    keepDays: cfg.keepDays,
    items: items.map((it) => {
      let detail = {};
      try {
        detail = JSON.parse(it.reject_detail || '{}');
      } catch (_) {}
      return {
        fid: it.fid,
        fileName: it.file_name,
        width: it.width,
        height: it.height,
        size: it.size,
        reason: it.reject_reason,
        reasonText: (cfg.reasons || {})[it.reject_reason] || it.reject_reason,
        detail,
        rejectedAt: it.rejected_at,
        expireAt: (it.rejected_at || 0) + (cfg.keepDays || 3) * 86400000,
        remainMs: Math.max(0, (it.rejected_at || 0) + (cfg.keepDays || 3) * 86400000 - now),
      };
    }),
  };
}

function getRejectedDetail(db, fid) {
  ensure(db);
  const it = db.prepare(`
    SELECT fid, file_name, width, height, size, reject_reason, reject_detail, rejected_at
    FROM assets WHERE fid=? AND status='rejected'
  `).get(fid);
  if (!it) return null;
  const cfg = gateway.getConfig(db);
  let detail = {};
  try {
    detail = JSON.parse(it.reject_detail || '{}');
  } catch (_) {}
  // 重复类：给出对比对象（左=被拒图，右=命中对象）
  let peer = null;
  if (it.reject_reason === 'duplicate' && detail.peerFid) {
    const p = db.prepare('SELECT fid, file_name, width, height, main_derivative_id FROM assets WHERE fid=?').get(detail.peerFid);
    if (p) peer = { fid: p.fid, fileName: p.file_name, width: p.width, height: p.height, isDerivative: false };
  }
  return {
    fid: it.fid,
    fileName: it.file_name,
    width: it.width,
    height: it.height,
    size: it.size,
    reason: it.reject_reason,
    reasonText: (cfg.reasons || {})[it.reject_reason] || it.reject_reason,
    detail,
    peer,
    rejectedAt: it.rejected_at,
    restoreOptions: (cfg.restoreReasons || {})[it.reject_reason] || ['判定错误'],
  };
}

function restore(db, fid, { reason = '', note = '', actor = '' } = {}) {
  ensure(db);
  const it = db.prepare("SELECT fid, file_name, status, reject_reason FROM assets WHERE fid=?").get(fid);
  if (!it) {
    const err = new Error('素材不存在');
    err.code = 'not_found';
    throw err;
  }
  if (it.status !== 'rejected') {
    const err = new Error('该素材不在拒收状态');
    err.code = 'not_rejected';
    throw err;
  }
  const now = Date.now();
  db.prepare(`
    UPDATE assets SET status='ready', restored_at=?, restore_reason=?, restore_note=?, updated_at=?
    WHERE fid=?
  `).run(now, reason || '', note || '', now, fid);
  gateway.logEvent(db, { fid, fileName: it.file_name, action: 'restored', reason: reason || '', detail: note || '', actor });
  // 恢复后仍参与指纹查重：不写黑名单、不动指纹
  return { fid, status: 'ready', restoredAt: now, reason, note };
}

function restoreBatch(db, fids, opts = {}) {
  const out = { ok: 0, failed: 0, results: [] };
  for (const fid of fids || []) {
    try {
      restore(db, fid, opts);
      out.ok++;
    } catch (e) {
      out.failed++;
      out.results.push({ fid, ok: false, error: e.message });
    }
  }
  return out;
}

/** 找出已过期的拒收件 */
function findExpired(db, { keepDays } = {}) {
  ensure(db);
  const cfg = gateway.getConfig(db);
  const days = Number(keepDays) || cfg.keepDays || 3;
  const cutoff = Date.now() - days * 86400000;
  return db.prepare(`
    SELECT fid, file_name, sha256, md5, phash, size
    FROM assets WHERE status='rejected' AND COALESCE(rejected_at, 0) < ?
  `).all(cutoff);
}

/** 彻底删除一个拒收件：删记录 + 删文件 + 指纹拉黑(sha256/md5 + pHash≤2) */
function purgeOne(services, row, { actor = 'gateway-purge' } = {}) {
  const { db, config, logger } = services;
  const fid = row.fid;

  // 1) 删除服务端文件（originals / derivatives / thumbs / preview）
  const removed = [];
  const tryRm = (p) => {
    try {
      if (p && fs.existsSync(p)) {
        fs.rmSync(p, { force: true });
        removed.push(p);
      }
    } catch (_) {}
  };
  const dataDir = (config && config.dataDir) || '';
  if (dataDir) {
    for (const sub of ['originals', 'thumbs', 'preview']) {
      const dir = path.join(dataDir, 'cache', sub);
      if (!fs.existsSync(dir)) continue;
      let names = [];
      try {
        names = fs.readdirSync(dir);
      } catch (_) {
        continue;
      }
      for (const n of names) {
        if (n.startsWith(fid)) tryRm(path.join(dir, n));
      }
    }
  }
  // 衍生文件
  try {
    const derivs = db.prepare('SELECT storage_ref, storage_type FROM derivatives WHERE asset_fid=?').all(fid);
    for (const d of derivs) {
      const ref = String(d.storage_ref || '');
      if (!ref) continue;
      if (path.isAbsolute(ref)) tryRm(ref);
      else if (dataDir) tryRm(path.join(dataDir, ref));
    }
  } catch (_) {}

  // 2) 指纹拉黑：sha256/md5 精确 + pHash≤2 相似
  const { addBlacklist } = require('./assets-delete');
  const entries = [];
  if (row.sha256) entries.push({ kind: 'sha256', value: String(row.sha256), fid });
  if (row.md5) entries.push({ kind: 'md5', value: String(row.md5), fid });
  const itemKey = `${row.file_name}|${Number(row.size) || 0}`;
  entries.push({ kind: 'item_key', value: itemKey, fid });
  addBlacklist(db, entries, { reason: 'gateway_reject_expired', createdBy: actor });

  // pHash≤2 → 记入近重复黑名单表（入库时比对）
  if (row.phash) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS phash_blacklist (
          phash TEXT PRIMARY KEY,
          fid TEXT,
          created_at INTEGER
        );
      `);
      db.prepare('INSERT OR REPLACE INTO phash_blacklist (phash, fid, created_at) VALUES (?, ?, ?)')
        .run(String(row.phash), fid, Date.now());
    } catch (_) {}
  }

  // 3) 删记录（含关联表）
  try {
    db.prepare('DELETE FROM derivatives WHERE asset_fid=?').run(fid);
  } catch (_) {}
  try {
    db.prepare('DELETE FROM asset_tags WHERE asset_fid=?').run(fid);
  } catch (_) {}
  try {
    db.prepare('DELETE FROM asset_colors WHERE asset_fid=?').run(fid);
  } catch (_) {}
  try {
    db.prepare('DELETE FROM assets WHERE fid=?').run(fid);
  } catch (e) {
    logger?.warn?.(`[reject-box] 删除记录失败 ${fid}: ${e.message}`);
  }

  gateway.logEvent(db, { fid, fileName: row.file_name, action: 'purged', reason: 'expired', detail: JSON.stringify({ removed: removed.length }), actor });
  return { fid, removedFiles: removed.length };
}

/** 批量清理过期拒收件 */
function purgeExpired(services, { keepDays, limit = 500 } = {}) {
  const { db } = services;
  ensure(db);
  const rows = findExpired(db, { keepDays }).slice(0, limit);
  const results = [];
  for (const row of rows) {
    try {
      results.push({ ...purgeOne(services, row), ok: true });
    } catch (e) {
      results.push({ fid: row.fid, ok: false, error: e.message });
    }
  }
  return { scanned: rows.length, purged: results.filter((r) => r.ok).length, results };
}

/**
 * 存量已删素材回灌拒收箱：status deleted → rejected，保留 keepDays 天。
 * 用于把之前「按文件/指纹直接删掉」的条目重新给用户一次抽查与恢复的机会。
 */
function regurgitateDeletedIntoRejected(services, { keepDays = 3, limit = 5000, reason = 'duplicate' } = {}) {
  const { db } = services;
  ensure(db);
  const rows = db.prepare(`
    SELECT fid, file_name, reject_reason, error_note FROM assets
    WHERE status='deleted'
    ORDER BY COALESCE(updated_at, created_at, 0) DESC
    LIMIT ?
  `).all(limit);
  const now = Date.now();
  const upd = db.prepare(`
    UPDATE assets SET status='rejected', reject_reason=?, reject_detail=?, rejected_at=?,
      error_note=?, restored_at=NULL, restore_reason=NULL, restore_note=NULL, updated_at=?
    WHERE fid=?
  `);
  let n = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      let detail = {};
      try {
        detail = JSON.parse(r.error_note || '{}');
      } catch (_) {
        detail = { message: r.error_note || '存量已删除，回灌待审' };
      }
      const rs = r.reject_reason || reason;
      upd.run(rs, JSON.stringify(detail), now, detail.message || '存量已删除，回灌待审', now, r.fid);
      gateway.logEvent(db, { fid: r.fid, fileName: r.file_name, action: 'rejected', reason: rs, detail: 'regurgitate' });
      n++;
    }
  });
  tx();
  return { scanned: rows.length, moved: n, keepDays, reason };
}

module.exports = {
  listRejected,
  getRejectedDetail,
  restore,
  restoreBatch,
  findExpired,
  purgeOne,
  purgeExpired,
  regurgitateDeletedIntoRejected,
};
