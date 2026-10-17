/**
 * 「素材不存在」的诊断与响应
 *
 * 用户诉求：区分不同情况，并提示可以转去回收站。
 * 理论上素材库里不该出现「点得进列表却查不到详情」的情况，
 * 但极端情况（并发删除、NAS 掉文件、手工改库）无法完全避免，
 * 所以要给出**可行动**的提示，而不是笼统的「素材不存在」。
 *
 * 三种情况：
 *   404 never_existed  这个 fid 从来没进过库 —— 多半是客户端脏数据
 *   410 trashed        已被删除，在回收站保留窗口内 —— 可引导恢复
 *   410 purged         已被清理，文件与记录都没了 —— 不可恢复
 *   410 trashed_expired 已过保留期被自动清理 —— 不可恢复
 */
const { STATUS_DELETED } = require('./asset-status');

/**
 * 诊断某个 fid 当前的状态
 * @returns {{code:number, reason:string, message:string, trashed:boolean, restorable:boolean, trashInfo?:object}}
 */
function diagnoseMissingAsset(db, fid) {
  // 1) assets 行都不存在 → 从未入库
  const asset = db.prepare('SELECT fid, status, file_name, updated_at FROM assets WHERE fid = ?').get(fid);
  if (!asset) {
    // 但回收站里可能有（行被清理过但 trash 记录还在）
    const t = db.prepare('SELECT * FROM asset_trash WHERE fid=? ORDER BY id DESC LIMIT 1').get(fid);
    if (t) {
      return {
        code: 410,
        reason: 'purged',
        trashed: false,
        restorable: false,
        message: '该素材已被彻底清理，无法恢复',
      };
    }
    return {
      code: 404,
      reason: 'never_existed',
      trashed: false,
      restorable: false,
      message: '该素材不在素材库中（可能已被其他设备删除，或本机缓存已过期）',
    };
  }

  // 2) assets 行在，但不是 ready → 已被废弃
  if (asset.status === STATUS_DELETED) {
    const t = db.prepare('SELECT * FROM asset_trash WHERE fid=? ORDER BY id DESC LIMIT 1').get(fid);
    if (t) {
      const { getTrashDetail } = require('./assets-delete');
      let d = null;
      try { d = getTrashDetail({ db }, fid); } catch (_) {}
      const remainingHours = d && typeof d.remainingHours === 'number' ? d.remainingHours : null;
      const restorable = remainingHours === null ? false : remainingHours > 0;
      return {
        code: 410,
        reason: restorable ? 'trashed' : 'trashed_expired',
        trashed: true,
        restorable,
        trashInfo: {
          disposeSource: t.dispose_source || '',
          disposeLabel: (d && d.disposeLabel) || '',
          remainingHours,
          fileMissing: !!(d && d.fileMissing),
        },
        message: restorable
          ? `该素材已移入回收站${remainingHours ? `，还剩 ${Math.ceil(remainingHours / 24)} 天可恢复` : ''}`
          : '该素材已在回收站中清理完毕，无法恢复',
      };
    }
    return {
      code: 410,
      reason: 'trashed_expired',
      trashed: false,
      restorable: false,
      message: '该素材已被清理，无法恢复',
    };
  }

  // 3) 行在且是 ready，但调用方说查不到 —— 说明是判据不一致（真 bug）
  return {
    code: 409,
    reason: 'state_mismatch',
    trashed: false,
    restorable: false,
    message: `素材状态异常（status=${asset.status}），列表可见性与详情判据不一致`,
  };
}

/**
 * 生成 sendJson 用的 body（统一错误结构，带诊断字段供客户端分支）
 */
function missingAssetBody(db, fid) {
  const d = diagnoseMissingAsset(db, fid);
  return {
    code: d.code,
    error: d.message,
    // 客户端据此给出「去回收站」按钮
    assetMissing: true,
    missingReason: d.reason,
    restorable: d.restorable,
    trashed: d.trashed,
    trashInfo: d.trashInfo || null,
  };
}

module.exports = { diagnoseMissingAsset, missingAssetBody };
