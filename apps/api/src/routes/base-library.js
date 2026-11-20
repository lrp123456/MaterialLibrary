/**
 * 基础属性库领域路由 (Phase 2 - routes/base-library.js)
 * 职责：
 *  - 空间 / 方案 / 单品 / 材质 / 风格 CRUD 与编译
 */
const { handleBaseLibraryRoutes: delegateBaseLibrary } = require('../base-library/routes');

async function handleBaseLibraryRoutes(services, req, res, pathname, urlObj, context) {
  return await delegateBaseLibrary(services, req, res, pathname, urlObj, context);
}

module.exports = { handleBaseLibraryRoutes };
