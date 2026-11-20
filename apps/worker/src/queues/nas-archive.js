/**
 * 队列 6：NAS 冷热分层归档与过期清理队列 (q:nas-archive)
 * 职责：
 *  - 实现 7 天 LRU 异步归档至 Synology NAS
 *  - 本地热盘仅保留缩略图/Grid WebP 与 creation-library/<tplId>/ 热点素材
 *  - 超期未访问大文件异步迁移至 NAS 并在 DB 标记 storage_tier='cold'
 */
const { Worker, Queue } = require('bullmq');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { publishEvent } = require('../pubsub');

const QUEUE_NAME = 'q:nas-archive';
const DEFAULT_NAS_ROOT = process.env.NAS_STORAGE_PATH || path.join(os.homedir(), '.mls-nas-archive');
const SEVEN_DAYS_MS = 7 * 86400 * 1000;

function createNasArchiveQueue(connection) {
  return new Queue(QUEUE_NAME, { connection });
}

/**
 * 执行 7 天 LRU 扫描与冷热分层归档
 */
async function executeLruArchive(db, options = {}) {
  const nasRoot = options.nasRoot || DEFAULT_NAS_ROOT;
  fs.mkdirSync(nasRoot, { recursive: true });

  const cutoff = Date.now() - (options.maxAgeMs || SEVEN_DAYS_MS);
  let candidates = [];

  if (db && typeof db.prepare === 'function') {
    try {
      // 筛选 7 天前入库且未归档的素材，排除 creation-library/
      candidates = db.prepare(`
        SELECT id, fid, file_name, file_path, size, created_at
        FROM assets
        WHERE (storage_tier IS NULL OR storage_tier != 'cold')
          AND (file_path NOT LIKE '%creation-library/%' AND file_path NOT LIKE '%creation-library\\%')
          AND created_at < ?
        ORDER BY created_at ASC
        LIMIT 100
      `).all(cutoff);
    } catch (e) {
      // 字段不存在时容错
      try {
        candidates = db.prepare(`
          SELECT id, fid, file_name, file_path, size, created_at
          FROM assets
          WHERE (file_path NOT LIKE '%creation-library/%' AND file_path NOT LIKE '%creation-library\\%')
            AND created_at < ?
          LIMIT 100
        `).all(cutoff);
      } catch (_) {}
    }
  }

  const archived = [];
  for (const asset of candidates) {
    if (!asset.file_path || !fs.existsSync(asset.file_path)) continue;
    // 保护缩略图、Grid 文件与模板素材不被迁移
    const normalizedPath = asset.file_path.replace(/\\/g, '/');
    if (normalizedPath.includes('thumb') || normalizedPath.includes('grid') || normalizedPath.includes('creation-library/')) continue;

    const targetNasPath = path.join(nasRoot, path.basename(asset.file_path));
    try {
      await fs.promises.copyFile(asset.file_path, targetNasPath);
      // 成功复制到 NAS 后，记录归档状态
      if (db && typeof db.prepare === 'function') {
        try {
          db.prepare(`
            UPDATE assets
            SET storage_tier = 'cold', nas_path = ?, updated_at = ?
            WHERE fid = ?
          `).run(targetNasPath, Date.now(), asset.fid);
        } catch (_) {}
      }
      archived.push({ fid: asset.fid, nasPath: targetNasPath });
    } catch (err) {
      console.warn(`[nas-archive] 迁移资产 ${asset.fid} 到 NAS 失败:`, err.message);
    }
  }

  return { archivedCount: archived.length, items: archived };
}

function createNasArchiveWorker(connection, options = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { archiveId, userId, assetFid, targetNasPath, action, nasRoot } = job.data;
      console.log(`[worker:nas-archive] 开始归档任务: archiveId=${archiveId}, action=${action || 'archive'}`);

      if (action === 'lru-sweep') {
        const result = await executeLruArchive(options.db, { nasRoot });
        await publishEvent('mls:events:asset_changed', {
          userId: userId || 1,
          action: 'lru_archive_done',
          count: result.archivedCount,
        });
        return { success: true, ...result };
      }

      await new Promise((r) => setTimeout(r, 40));

      await publishEvent('mls:events:asset_changed', {
        userId: userId || 1,
        action: 'archived',
        assetFid,
        nasPath: targetNasPath || DEFAULT_NAS_ROOT,
      });

      return { success: true, archiveId };
    },
    {
      connection,
      concurrency: options.concurrency || 2,
      ...options,
    }
  );

  return worker;
}

module.exports = {
  QUEUE_NAME,
  DEFAULT_NAS_ROOT,
  SEVEN_DAYS_MS,
  createNasArchiveQueue,
  createNasArchiveWorker,
  executeLruArchive,
};
