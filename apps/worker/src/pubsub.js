/**
 * Redis Pub/Sub 跨进程事件总线 (Phase 2)
 *
 * 负责 Worker 执行面 -> API 控制面实时事件推送
 * 频道约定：
 *  - mls:events:task_updated
 *  - mls:events:asset_changed
 *  - mls:events:job_progress
 *
 * 严格红线：每次推送必须携带 userId 属主标识！
 */
const Redis = require('ioredis');

let pubClient = null;
let subClient = null;

function getRedisUrl() {
  return process.env.REDIS_URL || 'redis://127.0.0.1:6379';
}

function getPubClient() {
  if (!pubClient) {
    pubClient = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      }
    });
    pubClient.on('error', (err) => {
      console.warn('[pubsub] Redis pub error:', err.message);
    });
  }
  return pubClient;
}

function getSubClient() {
  if (!subClient) {
    subClient = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      }
    });
    subClient.on('error', (err) => {
      console.warn('[pubsub] Redis sub error:', err.message);
    });
  }
  return subClient;
}

/**
 * 发布业务实时事件
 * @param {string} channel - 目标频道，如 'mls:events:task_updated'
 * @param {Object} payload - 事件载荷，必须包含 userId
 */
async function publishEvent(channel, payload) {
  if (!payload || payload.userId == null) {
    console.warn('[pubsub] 拒绝发布未声明 userId 的事件，防止跨账号推图串流:', channel, payload);
    return false;
  }

  const message = JSON.stringify({
    ...payload,
    publishedAt: Date.now()
  });

  try {
    const client = getPubClient();
    await client.publish(channel, message);
    return true;
  } catch (err) {
    console.warn(`[pubsub] 发布到 ${channel} 失败:`, err.message);
    return false;
  }
}

/**
 * 订阅实时事件
 * @param {Array<string>} channels - 频道列表
 * @param {Function} handler - (channel, payload) => void
 */
async function subscribeEvents(channels, handler) {
  const client = getSubClient();
  await client.subscribe(...channels);
  client.on('message', (chan, msg) => {
    try {
      const data = JSON.parse(msg);
      handler(chan, data);
    } catch (e) {
      console.warn('[pubsub] 解析事件消息失败:', e.message);
    }
  });
}

async function closePubSub() {
  if (pubClient) {
    try { await pubClient.quit(); } catch (_) {}
    pubClient = null;
  }
  if (subClient) {
    try { await subClient.quit(); } catch (_) {}
    subClient = null;
  }
}

module.exports = {
  getPubClient,
  getSubClient,
  publishEvent,
  subscribeEvents,
  closePubSub,
  getRedisUrl
};
