/**
 * 队列 1：入库质检与缩略图打标队列 (q:ingest)
 */
const { Worker, Queue } = require('bullmq');
const { publishEvent } = require('../pubsub');

const QUEUE_NAME = 'q:ingest';

function createIngestQueue(connection) {
  return new Queue(QUEUE_NAME, { connection });
}

function createIngestWorker(connection, options = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { assetFid, userId, originalPath } = job.data;
      console.log(`[worker:ingest] 开始处理资产入库质检: fid=${assetFid}, userId=${userId}`);

      await job.updateProgress(20);

      // 模拟/执行质检特征提取
      await new Promise((r) => setTimeout(r, 50));
      await job.updateProgress(80);

      // 通知客户端资产就绪
      await publishEvent('mls:events:asset_changed', {
        userId: userId || 1,
        action: 'ingest_complete',
        assetFid,
        status: 'ready'
      });

      await job.updateProgress(100);
      return { success: true, assetFid };
    },
    {
      connection,
      concurrency: options.concurrency || 5,
      ...options
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker:ingest] 任务 ${job?.id} 失败:`, err.message);
  });

  return worker;
}

module.exports = {
  QUEUE_NAME,
  createIngestQueue,
  createIngestWorker
};
