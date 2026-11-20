/**
 * Material Library Worker Execution Plane Entry (Phase 2)
 *
 * 托管 BullMQ 6 条独立并发队列：
 * 1. q:ingest (入库质检/打标)
 * 2. q:gen-image (并发度 4)
 * 3. q:gen-video (并发度 2)
 * 4. q:clip-ai (Demucs/TTS/切片)
 * 5. q:media-export (FFmpeg 合成)
 * 6. q:nas-archive (NAS 异步归档)
 *
 * 支持优雅停机 (Graceful Shutdown)
 */
const Redis = require('ioredis');
const { getRedisUrl, closePubSub } = require('./pubsub');
const { createIngestWorker } = require('./queues/ingest');
const { createGenImageWorker } = require('./queues/gen-image');
const { createGenVideoWorker } = require('./queues/gen-video');
const { createClipAiWorker } = require('./queues/clip-ai');
const { createMediaExportWorker } = require('./queues/media-export');
const { createNasArchiveWorker } = require('./queues/nas-archive');

let redisConn = null;
const workers = [];

function getWorkerRedisConnection() {
  if (!redisConn) {
    redisConn = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      }
    });
    redisConn.on('error', (err) => {
      console.warn('[worker] Redis connection warning:', err.message);
    });
  }
  return redisConn;
}

async function startWorkers() {
  console.log('[worker] 启动 Material Library 执行面后台队列...');
  const conn = getWorkerRedisConnection();

  try {
    workers.push(createIngestWorker(conn));
    workers.push(createGenImageWorker(conn));
    workers.push(createGenVideoWorker(conn));
    workers.push(createClipAiWorker(conn));
    workers.push(createMediaExportWorker(conn));
    workers.push(createNasArchiveWorker(conn));

    console.log(`[worker] 6 路 BullMQ 执行队列全部就绪 (Redis: ${getRedisUrl()})`);
  } catch (err) {
    console.error('[worker] 启动执行面队列失败:', err);
    throw err;
  }
}

async function shutdown(signal) {
  console.log(`[worker] 收到 ${signal} 信号，开始优雅关闭...`);
  try {
    await Promise.all(workers.map((w) => w.close()));
    console.log('[worker] 全部 BullMQ Worker 已完成现有任务并安全退出');

    await closePubSub();
    if (redisConn) {
      try { await redisConn.quit(); } catch (_) {}
      redisConn = null;
    }
    console.log('[worker] 执行面进程优雅停机完成');
    process.exit(0);
  } catch (err) {
    console.error('[worker] 优雅停机发生错误:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  startWorkers().catch((err) => {
    console.error('[worker] Worker 进程启动崩溃:', err);
    process.exit(1);
  });
}

module.exports = {
  startWorkers,
  shutdown,
  getWorkerRedisConnection,
  workers
};
