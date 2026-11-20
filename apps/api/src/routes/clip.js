/**
 * 剪辑工程与音视频工具领域路由 (Phase 2 - routes/clip.js)
 * 职责：
 *  - /editor-api/* 剪辑工程读写与切片
 *  - /tools/lip-sync/* 口型同步任务
 *  - /tools/convert-video, /tools/extract-frames
 */
const clipApi = require('../clip-api');
const editorProjects = require('../editor-projects');
const mediaTools = require('../media-tools');

async function handleClipRoutes(services, req, res, pathname, urlObj, context) {
  // 1. Editor API 剪辑工程处理
  if (pathname === '/editor-api' || pathname.startsWith('/editor-api/')) {
    const handled = await clipApi.handleClipApi(services, req, res);
    if (handled) return true;
    return await editorProjects.handleEditorApi(services, req, res);
  }

  // 2. 口型同步
  if (pathname.startsWith('/tools/lip-sync')) {
    const handled = await mediaTools.handleMediaTools(services, req, res, pathname, urlObj, context);
    if (handled) return true;
  }

  return false;
}

module.exports = { handleClipRoutes };
