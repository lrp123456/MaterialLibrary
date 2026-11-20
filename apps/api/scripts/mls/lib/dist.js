/**
 * 前端产物新鲜度辅助。lane 级新鲜度以 branch-channel.collectLanes() 的
 * build-info.json vs git HEAD 比对为准；这里提供给非 lane 目录
 * （如将来的独立面板产物）与缺 build-info 的正式 dist 使用。
 */
const fs = require('fs');
const path = require('path');
const bc = require('../../branch-channel');

function readBuildInfo(distDir) {
  if (!distDir) return null;
  return bc.buildInfoOf(distDir);
}

function distState(distDir) {
  if (!distDir) return { exists: false, hasIndex: false, info: null };
  const info = readBuildInfo(distDir);
  let hasIndex = false;
  let builtAt = null;
  try {
    hasIndex = fs.existsSync(path.join(distDir, 'index.html'));
    builtAt = fs.statSync(path.join(distDir, 'index.html')).mtimeMs;
  } catch (_) {}
  return {
    exists: fs.existsSync(distDir),
    hasIndex,
    builtAt: (info && info.builtAt) || builtAt,
    info,
    note: hasIndex && !info ? '产物在，缺 build-info.json（无法比对提交）' : null,
  };
}

module.exports = { readBuildInfo, distState };
