/**
 * 本地临时文件清扫：data/cache/temp 顶层 3 天前的生成产物。
 * 对话里没点「入素材库」的图片和视频停在这里。正式库是复制，不在这个目录里。
 *
 * 只处理顶层「文件」，跳过 lipsync/ 等所有子目录（它们有自己的生命周期）。
 * 与 src/oss.js 的 sweepChatTemp（OSS 对象）互不干扰。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * @param {object} config 需带 dataDir
 * @param {object} [db] 可选 sqlite 数据库实例，用于保护仍被 chat_messages 引用的文件
 * @returns {{deleted:number, scanned:number, skipped:number}}
 */
function sweepLocalTemp(config, db) {
  const root = config && config.dataDir ? path.join(config.dataDir, 'cache', 'temp') : null;
  if (!root) return { deleted: 0, scanned: 0, skipped: 0 };

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return { deleted: 0, scanned: 0, skipped: 0 };
  }

  let refCheckStmt = null;
  let refCheckBlocked = false;
  if (db) {
    try {
      refCheckStmt = db.prepare(`
        SELECT 1 FROM chat_messages
        WHERE result_json LIKE ? OR params_json LIKE ? OR images_json LIKE ?
        LIMIT 1
      `);
    } catch (err) {
      refCheckBlocked = true;
      console.warn('[temp-sweeper] 引用检查不可用，本轮不删除:', err && err.message ? err.message : err);
    }
  }

  const cutoff = Date.now() - MAX_AGE_MS;
  let scanned = 0;
  let deleted = 0;
  let skipped = 0;
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

    // 引用检查准备失败时整轮不删，避免把对话里还指着的成片清掉。
    if (refCheckBlocked) {
      skipped++;
      continue;
    }

    // 关键引用保护：若仍被对话消息引用（图/视频产物），坚决不删，避免消息媒体失效
    if (refCheckStmt) {
      try {
        const pattern = `%${ent.name}%`;
        const referenced = refCheckStmt.get(pattern, pattern, pattern);
        if (referenced) {
          skipped++;
          continue;
        }
      } catch (err) {
        console.warn(`[temp-sweeper] 引用查询失败，保护跳过 ${ent.name}:`, err && err.message ? err.message : err);
        skipped++;
        continue;
      }
    }

    try {
      fs.unlinkSync(full);
      for (const extra of [`${full}.poster.jpg`, `${full}.preview.jpg`]) {
        try { fs.unlinkSync(extra); } catch (_) {}
      }
      deleted++;
    } catch (_) {}
  }
  return { deleted, scanned, skipped };
}

let _timer = null;

/** 注册 6h 定时清扫（启动先跑一次）；定时器 unref，不阻止进程退出。 */
function startTempSweeper(services) {
  const config = (services && services.config) || {};
  const db = (services && services.db) || null;
  const run = () => {
    try {
      const r = sweepLocalTemp(config, db);
      if (r.deleted || r.skipped) {
        console.log(`[temp-sweeper] 已清理 ${r.deleted} 个 3 天前的未引用临时文件（保留 ${r.skipped || 0} 个会话引用文件，扫描 ${r.scanned} 个）`);
      }
    } catch (e) {
      console.warn('[temp-sweeper] 清理异常:', e.message);
    }
  };
  setImmediate(run);
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
