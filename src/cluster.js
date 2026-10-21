/**
 * 重复组已退役（2026-10-20 审计整改 CONFLICT-002）。
 *
 * 原多层次查重（phash 归组 / 同空间连拍 / 向量归组 / 组代表选举）整体拆除：
 * assets.dup_group_id / assets.is_representative 不再写入，存量值由
 * scripts/migrate-audit-20261020.js 置空，dup_groups 表清空。
 *
 * 本模块仅保留两个仍有复用价值的助手：
 * - getAssetTags：标签读取（工作流节点仍在用）
 * - isGenericExportPrefix：导出前缀识别（P2「去重工作台」将以
 *   phash 现算方式重建重复侦查，届时可能复用）
 */
function isGenericExportPrefix(prefix) {
  const GENERIC_EXPORT_PREFIX = /^(mmexport|fb_img_?|img_?|dsc_?|screenshot|wx_camera_?|pxl_?|mvimg_?|vid_?|photo_?|camera_?|wx_?)/i;
  if (!prefix) return true;
  return GENERIC_EXPORT_PREFIX.test(prefix);
}

function getAssetTags(db, fid) {
  return db.prepare(`
    SELECT t.dimension, t.dir FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id WHERE at.asset_fid = ?
  `).all(fid);
}

function isVideoExtractStill(asset) {
  if (!asset) return false;
  const src = String(asset.source || asset.source_type || '');
  const fn = String(asset.file_name || asset.fileName || '');
  const parent = String(asset.parent_fid || '');
  return (
    src.includes('video_frame') ||
    src.includes('video_extract') ||
    src.includes('frame_extract') ||
    /^(frame_|extract_|still_|video_frame_)/i.test(fn) ||
    parent.startsWith('vid_') ||
    parent.startsWith('local_vid_')
  );
}

module.exports = {
  isGenericExportPrefix,
  getAssetTags,
  isVideoExtractStill,
};
