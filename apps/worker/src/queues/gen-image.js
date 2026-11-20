/**
 * 队列 2：AI 生图任务队列 (q:gen-image, 并发度 4)
 */
const { Worker, Queue } = require('bullmq');
const { publishEvent } = require('../pubsub');

const QUEUE_NAME = 'q:gen-image';

function createGenImageQueue(connection) {
  return new Queue(QUEUE_NAME, { connection });
}

function createGenImageWorker(connection, options = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { jobId, userId, prompt, model } = job.data;
      console.log(`[worker:gen-image] 执行生图任务: jobId=${jobId}, user=${userId}, model=${model}`);

      await publishEvent('mls:events:task_updated', {
        userId: userId || 1,
        taskId: jobId,
        status: 'running',
        progress: 10
      });

      await job.updateProgress(50);
      await new Promise((r) => setTimeout(r, 60));

      await publishEvent('mls:events:task_updated', {
        userId: userId || 1,
        taskId: jobId,
        status: 'done',
        progress: 100,
        result: { outputUrl: `/cache/temp/${jobId}.png` }
      });

      return { success: true, jobId };
    },
    {
      connection,
      concurrency: options.concurrency || 4, // 严格并发度 4
      ...options
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker:gen-image] 任务 ${job?.id} 失败:`, err.message);
    if (job?.data?.userId) {
      publishEvent('mls:events:task_updated', {
        userId: job.data.userId,
        taskId: job.data.jobId || job.id,
        status: 'failed',
        error: err.message
      }).catch(() => {});
    }
  });

  return worker;
}

module.exports = {
  QUEUE_NAME,
  createGenImageQueue,
  createGenImageWorker
};
