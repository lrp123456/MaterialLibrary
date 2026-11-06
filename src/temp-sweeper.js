/**
 * 本地临时文件清扫：data/cache/temp 顶层 30 天前的生成产物。
 *
 * 只处理顶层「文件」，跳过 lipsync/ 等所有子目录（它们有自己的生命周期）。
 * 与 src/oss.js 的 sweepChatTemp（OSS 对象）互不干扰。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * @param {object} config 需带 dataDir
 * @returns {{deleted:number, scanned:number}}
 */
function sweepLocalTemp(config) {
  const root = config && config.dataDir ? path.join(config.dataDir, 'cache', 'temp') : null;
  if (!root) return { deleted: 0, scanned: 0 };

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return { deleted: 0, scanned: 0 };
  }

  const cutoff = Date.now() - MAX_AGE_MS;
  let scanned = 0;
  let deleted = 0;
  for (const ent of entries) {
    // 顶层目录（lipsync/ 等）一律跳过
    if (ent.isDirectory()) continue;
    const full = path.join(root, ent.name);
    let st;
    try {
      st = fs.statSync(full);
    } catch (_) {
      continue;
    }
    if (!st.isFile()) continue;
    scanned++;
    if (st.mtimeMs >= cutoff) continue;
    try {
      fs.unlinkSync(full);
      deleted++;
    } catch (_) {}
  }
  return { deleted, scanned };
}

let _timer = null;

/** 注册 6h 定时清扫（启动先跑一次）；定时器 unref，不阻止进程退出。 */
function startTempSweeper(services) {
  const config = (services && services.config) || {};
  const run = () => {
    try {
      const r = sweepLocalTemp(config);
      if (r.deleted) {
        console.log(`[temp-sweeper] 已清理 ${r.deleted} 个 30 天前的临时文件（扫描 ${r.scanned} 个）`);
      }
    } catch (e) {
      console.warn('[temp-sweeper] 清理异常:', e.message);
    }
  };
  run();
  _timer = setInterval(run, SWEEP_INTERVAL_MS);
  if (_timer.unref) _timer.unref();
  return _timer;
}

module.exports = {
  sweepLocalTemp,
  startTempSweeper,
  MAX_AGE_MS,
  SWEEP_INTERVAL_MS,
};
