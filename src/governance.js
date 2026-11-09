const fs = require('fs');
const path = require('path');

const FREEZE_MS = 72 * 3600 * 1000;

const AUTH_VISIBLE_SQL = "(a.auth_state IS NULL OR a.auth_state IN ('live','frozen'))";

/**
 * 人像/服装类目治理：彻底删除 restage_* 衍生（防重构人脸触发安全围栏），主图指针强制对齐 origin。
 */
function purgePortraitClothingRestages(db, nowMs = Date.now(), dataDir = null) {
  let purgedCount = 0;
  try {
    const rows = db.prepare(`
      SELECT d.id, d.storage_ref, d.storage_type, a.fid, a.category
      FROM derivatives d
      JOIN assets a ON a.fid = d.asset_fid
      WHERE a.category IN ('portrait', 'clothing')
        AND d.kind LIKE 'restage_%'
    `).all();

    for (const r of rows) {
      if (r.storage_ref) {
        let filePath = r.storage_ref;
        if (!path.isAbsolute(filePath) && dataDir) {
          filePath = path.join(dataDir, filePath);
        }
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (_) {}
      }
      db.prepare("DELETE FROM derivatives WHERE id = ?").run(r.id);
      purgedCount++;
    }

    // 主图指针重置对齐原图 (origin)：只改还没对齐的行，避免每次治理都刷新全部人像/服装的 updated_at
    db.prepare(`
      UPDATE assets
      SET main_derivative_id = (
        SELECT id FROM derivatives WHERE asset_fid = assets.fid AND kind = 'origin' ORDER BY id ASC LIMIT 1
      ), updated_at = ?
      WHERE category IN ('portrait', 'clothing')
        AND main_derivative_id IS NOT (
          SELECT id FROM derivatives WHERE asset_fid = assets.fid AND kind = 'origin' ORDER BY id ASC LIMIT 1
        )
    `).run(nowMs);

    // 取消队列中针对人像/服装的重构任务
    try {
      db.prepare(`
        UPDATE node_runs
        SET status = 'canceled', error = '人像与服装类目禁止画幅重构，已安全取消'
        WHERE asset_fid IN (SELECT fid FROM assets WHERE category IN ('portrait', 'clothing'))
          AND node_type IN ('restage_dual', 'restage_9_16')
          AND status IN ('queued', 'running')
      `).run();
    } catch (_) {}

    if (purgedCount > 0) {
      console.log(`[governance] 已清理人像/服装类目下 ${purgedCount} 条 restage 衍生，主图指针已对齐 origin`);
    }
  } catch (e) {
    console.warn('[governance] purgePortraitClothingRestages 异常:', e.message);
  }
  return purgedCount;
}

/**
 * 授权治理：相册消失不再隐藏库内素材。
 * - 已入库资产保持可见（live / frozen / unmanaged）。
 * - 历史 revoked / frozen_revoked 且未软删的，一律救回 live。
 * - 72h 冻结锁与窗口内撤销已停用；只有本 App 软删才从列表消失。
 */
function applyGovernance(db, nowMs = Date.now(), dataDir = null) {
  const now = nowMs;
  let restored = 0;
  try {
    const r = db.prepare(`
      UPDATE assets
      SET auth_state='live', auth_revoked_at=NULL, updated_at=?
      WHERE auth_state IN ('revoked','frozen_revoked')
        AND (status IS NULL OR status != 'deleted')
    `).run(now);
    restored = r.changes || 0;
  } catch (e) {
    console.warn('[governance] restore revoked failed:', e.message);
  }

  // 永久清理并防御人像/服装类目的 restage 衍生
  const purgedRestages = purgePortraitClothingRestages(db, now, dataDir);

  return {
    live: 0,
    revoked: 0,
    frozen: 0,
    frozenRevoked: 0,
    revived: restored,
    restored,
    purgedRestages,
    untouched: 0,
  };
}

module.exports = { applyGovernance, purgePortraitClothingRestages, AUTH_VISIBLE_SQL, FREEZE_MS };
