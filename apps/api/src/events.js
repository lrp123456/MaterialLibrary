/**
 * 灵感空间素材库事件总线 (AppEventBus)
 * 支撑客户端 SSE 实时推送与长任务/Worker 状态解耦 (Phase 2 集成 Redis Pub/Sub)
 */
const EventEmitter = require('events');
const Redis = require('ioredis');

class AppEventBus extends EventEmitter {}
const eventBus = new AppEventBus();
eventBus.setMaxListeners(500);

const EVENTS = {
  TASK_UPDATED: 'task:updated',
  ASSET_INGESTED: 'asset:ingested',
  ASSET_DELETED: 'asset:deleted',
  RECONCILE_DONE: 'sync:reconcile_done'
};

let redisSub = null;
let redisPub = null;

function getRedisUrl() {
  return process.env.REDIS_URL || 'redis://127.0.0.1:6379';
}

function initRedisBridge() {
  if (redisSub) return;
  // 仅在明确声明 REDIS_URL 或生产模式下启动 Redis 桥接
  if (!process.env.REDIS_URL && process.env.NODE_ENV !== 'production') {
    return;
  }

  try {
    redisSub = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      }
    });

    redisSub.on('error', (e) => {
      // 离线/开发环境无 Redis 时安静降级
    });

    redisSub.connect().then(() => {
      redisSub.subscribe(
        'mls:events:task_updated',
        'mls:events:asset_changed',
        'mls:events:job_progress'
      ).catch(() => {});

      redisSub.on('message', (channel, message) => {
        try {
          const payload = JSON.parse(message);
          if (channel === 'mls:events:task_updated') {
            eventBus.emit(EVENTS.TASK_UPDATED, payload);
          } else if (channel === 'mls:events:asset_changed') {
            if (payload.action === 'deleted') {
              eventBus.emit(EVENTS.ASSET_DELETED, payload);
            } else {
              eventBus.emit(EVENTS.ASSET_INGESTED, payload);
            }
          }
        } catch (_) {}
      });
    }).catch(() => {});
  } catch (_) {}
}

/**
 * 跨进程事件发布（若 Redis 存在则发 Redis，同时触发本地事件总线）
 */
async function publishBroadcast(channel, payload) {
  eventBus.emit(channel, payload);

  if (process.env.REDIS_URL) {
    if (!redisPub) {
      try {
        redisPub = new Redis(getRedisUrl(), { maxRetriesPerRequest: null, lazyConnect: true });
        await redisPub.connect();
      } catch (_) {}
    }
    if (redisPub) {
      try {
        await redisPub.publish(channel, JSON.stringify({ ...payload, publishedAt: Date.now() }));
      } catch (_) {}
    }
  }
}

// 自动尝试初始化桥接
initRedisBridge();

module.exports = {
  eventBus,
  EVENTS,
  publishBroadcast,
  initRedisBridge
};
