/**
 * 队列 6：NAS 归档与过期清理队列 (q:nas-archive)
 */
const { Worker, Queue } = require('bullmq');
const { publishEvent } = require('../pubsub');

const QUEUE_NAME = 'q:nas-archive';

function createNasArchiveQueue(connection) {
  return new Queue(QUEUE_NAME, { connection });
}

function createNasArchiveWorker(connection, options = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { archiveId, userId, assetFid, targetNasPath } = job.data;
      console.log(`[worker:nas-archive] 开始归档任务: archiveId=${archiveId}, fid=${assetFid}`);

      await new Promise((r) => setTimeout(r, 40));

      await publishEvent('mls:events:asset_changed', {
        userId: userId || 1,
        action: 'archived',
        assetFid,
        nasPath: targetNasPath
      });

      return { success: true, archiveId };
    },
    {
      connection,
      concurrency: options.concurrency || 2,
      ...options
    }
  );

  return worker;
}

module.exports = {
  QUEUE_NAME,
  createNasArchiveQueue,
  createNasArchiveWorker
};
