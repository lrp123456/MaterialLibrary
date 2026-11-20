/**
 * 队列 5：媒体导出与转码队列 (q:media-export)
 */
const { Worker, Queue } = require('bullmq');
const { publishEvent } = require('../pubsub');

const QUEUE_NAME = 'q:media-export';

function createMediaExportQueue(connection) {
  return new Queue(QUEUE_NAME, { connection });
}

function createMediaExportWorker(connection, options = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { exportId, userId, projectId, format } = job.data;
      console.log(`[worker:media-export] 开始导出工程: exportId=${exportId}, project=${projectId}, format=${format}`);

      await publishEvent('mls:events:task_updated', {
        userId: userId || 1,
        taskId: exportId,
        status: 'exporting',
        progress: 30
      });

      await new Promise((r) => setTimeout(r, 60));

      await publishEvent('mls:events:task_updated', {
        userId: userId || 1,
        taskId: exportId,
        status: 'done',
        progress: 100,
        result: { exportPath: `/exports/${exportId}.${format || 'mp4'}` }
      });

      return { success: true, exportId };
    },
    {
      connection,
      concurrency: options.concurrency || 3,
      ...options
    }
  );

  return worker;
}

module.exports = {
  QUEUE_NAME,
  createMediaExportQueue,
  createMediaExportWorker
};
