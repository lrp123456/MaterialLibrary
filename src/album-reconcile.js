/**
 * 相册删除对账（reconcile）
 *
 * 背景：素材库是共享资产，历史设计是「相册消失不传导到素材库」
 *   —— 见 snapshot.js:134「未命中清单的存量条目：只冻结、不删除」。
 * 这个设计对共享库是正确的（防止 A 手机删相册导致 B 手机的副本消失），
 * 但用户预期相反：删了照片就希望它消失。
 *
 * 折中方案：不做自动删除，而是提供一个**用户主动触发**的清理工具。
 *   1. preview：只统计「某设备下已 frozen 且超过 N 天未复活」的条目有多少，
 *              以及其中多少能匹配到 assets —— 不产生任何副作用。
 *   2. apply  ：用户二次确认后，把这些条目批量移入回收站，
 *              dispose_source = 'album_removed'（独立归类，7 天窗口可恢复）。
 *
 * 关键安全约束：
 *   - 只处理**指定设备**的 frozen 条目，不跨设备
 *   - 只处理**超过宽限期**仍 frozen 的（默认 7 天），给「误删相册照片后恢复」留时间
 *   - 命中的 assets 必须是**非代表项或无组**（代表项被删会让整组素材消失）
 *   - 逐条 try/catch，单条失败不影响整批
 */
const path = require('path');

/** 冻结宽限期（天）：相册删掉后 N 天内仍可恢复，暂不处理 */
const DEFAULT_GRACE_DAYS = 7;

function graceDaysFor(config) {
  const v = Number(config && config.albumReconcileGraceDays);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_GRACE_DAYS;
}

/**
 * 找出「已冻结且超过宽限期」的快照条目
 * @returns {Array<{itemKey,name,size,frozenAt,daysSinceFrozen}>}
 */
function findStaleFrozenItems(db, { deviceId = '', graceDays = 0 } = {}) {
  if (!deviceId) throw new Error('缺少设备 ID');
  const cutoff = Date.now() - graceDays * 86400 * 1000;
  const rows = db.prepare(`
    SELECT item_key, name, size, frozen_at
    FROM snapshot_items
    WHERE device_id = ? AND state = 'frozen'
      AND frozen_at IS NOT NULL AND frozen_at <= ?
    ORDER BY frozen_at ASC
    LIMIT 2000
  `).all(deviceId, cutoff);

  return rows.map((r) => {
    const frozenAt = Number(r.frozen_at) || 0;
    const days = Math.max(0, Math.floor((Date.now() - frozenAt) / 86400 * 10) / 10);
    return {
      itemKey: r.item_key,
      name: r.name || '',
      size: Number(r.size) || 0,
      frozenAt,
      // frozen_at 可能是 0 或异常值（脏数据 / 手工写入），钳到合理范围避免展示出「30000 天」这种荒谬文案
      daysSinceFrozen: Math.min(days, 3650),
    };
  });
}

/**
 * 把快照条目匹配到 assets 行。
 * 匹配键：asset_aliases.item_key 优先（历史改名/多别名），其次 file_name|size。
 *
 * @returns {Array<{fid,fileName,itemKey,isRepresentative,dupGroupId}>}
 */
function matchAssets(db, items) {
  const out = [];
  const seen = new Set();
  const hasAliases = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='asset_aliases'"
  ).get();

  for (const it of items) {
    let fid = null;
    let isRep = null;
    let grp = null;

    if (hasAliases) {
      const a = db.prepare(
        "SELECT fid FROM asset_aliases WHERE item_key = ? LIMIT 1"
      ).get(it.itemKey);
      if (a) fid = a.fid;
    }
    if (!fid) {
      const a = db.prepare(`
        SELECT fid FROM assets
        WHERE file_name = ? AND size = ? AND status NOT IN ('deleted')
        ORDER BY created_at ASC LIMIT 1
      `).get(it.name, it.size);
      if (a) fid = a.fid;
    }
    if (!fid || seen.has(fid)) continue;
    seen.add(fid);

    const row = db.prepare(
      'SELECT is_representative, dup_group_id FROM assets WHERE fid = ?'
    ).get(fid);
    if (row) {
      isRep = row.is_representative;
      grp = row.dup_group_id;
    }
    out.push({
      fid,
      fileName: it.name,
      itemKey: it.itemKey,
      isRepresentative: isRep,
      dupGroupId: grp,
      daysSinceFrozen: it.daysSinceFrozen,
    });
  }
  return out;
}

/**
 * 预览：将清理哪些素材（无副作用）
 */
function previewReconcile(services, { deviceId = '', graceDays = null } = {}) {
  const { db, config } = services;
  const grace = graceDays === null || graceDays === undefined
    ? graceDaysFor(config)
    : Number(graceDays);

  const items = findStaleFrozenItems(db, { deviceId, graceDays: grace });
  const matched = matchAssets(db, items);

  // 代表项保护：组内代表项被删会让整组素材从列表消失
  const safe = [];
  const skippedRep = [];
  for (const m of matched) {
    if (m.isRepresentative === 1) skippedRep.push(m);
    else safe.push(m);
  }

  // 已在回收站 / 已删除的不再处理
  const stillAlive = safe.filter((m) => {
    const a = db.prepare('SELECT status FROM assets WHERE fid=?').get(m.fid);
    return a && a.status !== 'deleted';
  });

  return {
    deviceId,
    graceDays: grace,
    staleFrozenCount: items.length,
    matchedCount: matched.length,
    willRemoveCount: stillAlive.length,
    skippedRepresentative: skippedRep.length,
    samples: stillAlive.slice(0, 20),
    skippedSamples: skippedRep.slice(0, 10),
  };
}

/**
 * 执行：把匹配到的素材移入回收站（dispose_source='album_removed'）
 */
function applyReconcile(services, { deviceId = '', graceDays = null, limit = 200, actor = 'user' } = {}) {
  const { db, logger } = services;
  const assetsDelete = require('./assets-delete');

  const preview = previewReconcile(services, { deviceId, graceDays });
  const targets = preview.samples.slice(0, Math.max(1, Math.min(500, Number(limit) || 200)));

  const removed = [];
  const failed = [];
  for (const t of targets) {
    try {
      assetsDelete.softDeleteAsset(services, t.fid, {
        deletedBy: actor || 'album-reconcile',
        reason: 'album_removed',
        disposeSource: 'album_removed',
        disposeDetail: '该素材在来源设备的手机相册中已被删除，且超过宽限期仍未恢复（相册对账）',
      });
      // 标记为已处理，避免下次对账重复命中
      try {
        db.prepare(
          "UPDATE snapshot_items SET state='purged' WHERE device_id=? AND item_key=?"
        ).run(deviceId, t.itemKey);
      } catch (_) {}
      removed.push(t.fid);
    } catch (e) {
      failed.push({ fid: t.fid, error: e.message });
      logger?.warn?.(`[reconcile] 清理 ${t.fid} 失败: ${e.message}`);
    }
  }

  logger?.info?.(
    `[reconcile] 设备 ${deviceId} 相册对账：移除 ${removed.length} 条，失败 ${failed.length} 条`
  );

  return {
    deviceId,
    graceDays: preview.graceDays,
    removed,
    failed,
    removedCount: removed.length,
    skippedRepresentative: preview.skippedRepresentative,
    scanned: preview.matchedCount,
  };
}

module.exports = {
  DEFAULT_GRACE_DAYS,
  graceDaysFor,
  findStaleFrozenItems,
  matchAssets,
  previewReconcile,
  applyReconcile,
};
