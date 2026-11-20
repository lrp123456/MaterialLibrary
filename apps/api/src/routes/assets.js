/**
 * 资产与素材库领域路由 (Phase 2/3 - routes/assets.js)
 * 职责：
 *  - /assets 瀑布流、检索、详情、相册时间线 (Fail-Open: 统一按 visibility = 'visible' 过滤)
 *  - /assets/:fid/image, /assets/:fid/file, /assets/:fid/video 媒体串流
 *  - /assets/:fid/similar 相似推荐
 *  - /tools/* 媒体处理工具
 */
const { AUTH_VISIBLE_SQL } = require('../governance');
const { VISIBILITY_VISIBLE, PIPELINE_DONE } = require('../asset-status');

const ASSET_VISIBILITY_SQL = `a.visibility = '${VISIBILITY_VISIBLE}'`;

function buildAssetBrowseWhere(filters = {}) {
  // Fail-Open 铁律：列表可见性统一以 visibility = 'visible' 为准，彻底解耦 legacy status = 'ready'
  return [ASSET_VISIBILITY_SQL, AUTH_VISIBLE_SQL];
}

async function handleAssetsRoutes(services, req, res, pathname, urlObj, context) {
  // assets 核心逻辑与主路由衔接
  return false;
}

module.exports = {
  handleAssetsRoutes,
  buildAssetBrowseWhere,
  ASSET_VISIBILITY_SQL
};
