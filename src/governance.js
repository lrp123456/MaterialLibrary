const FREEZE_MS = 72 * 3600 * 1000;

const AUTH_VISIBLE_SQL = "(a.auth_state IS NULL OR a.auth_state IN ('live','frozen'))";

/**
 * 授权治理：相册消失不再隐藏库内素材。
 * - 已入库资产保持可见（live / frozen / unmanaged）。
 * - 历史 revoked / frozen_revoked 且未软删的，一律救回 live。
 * - 72h 冻结锁与窗口内撤销已停用；只有本 App 软删才从列表消失。
 */
function applyGovernance(db, nowMs = Date.now()) {
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

  return {
    live: 0,
    revoked: 0,
    frozen: 0,
    frozenRevoked: 0,
    revived: restored,
    restored,
    untouched: 0,
  };
}

module.exports = { applyGovernance, AUTH_VISIBLE_SQL, FREEZE_MS };
