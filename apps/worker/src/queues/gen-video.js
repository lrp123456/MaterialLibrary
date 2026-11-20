/**
 * 队列 3：AI 视频生成任务队列 (q:gen-video, 并发度 2)
 */
const { Worker, Queue } = require('bullmq');
const { publishEvent } = require('../pubsub');

const QUEUE_NAME = 'q:gen-video';

function createGenVideoQueue(connection) {
  return new Queue(QUEUE_NAME, { connection });
}

function createGenVideoWorker(connection, options = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { jobId, userId, prompt, duration } = job.data;
      console.log(`[worker:gen-video] 执行生视频任务: jobId=${jobId}, user=${userId}, duration=${duration}`);

      await publishEvent('mls:events:task_updated', {
        userId: userId || 1,
        taskId: jobId,
        status: 'running',
        progress: 15
      });

      await job.updateProgress(50);
      await new Promise((r) => setTimeout(r, 80));

      await publishEvent('mls:events:task_updated', {
        userId: userId || 1,
        taskId: jobId,
        status: 'done',
        progress: 100,
        result: { outputUrl: `/cache/temp/${jobId}.mp4` }
      });

      return { success: true, jobId };
    },
    {
      connection,
      concurrency: options.concurrency || 2, // 严格并发度 2
      ...options
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker:gen-video] 任务 ${job?.id} 失败:`, err.message);
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
  createGenVideoQueue,
  createGenVideoWorker
};
