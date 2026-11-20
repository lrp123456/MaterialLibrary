/**
 * 实时事件与推送领域路由 (Phase 2 - routes/events.js)
 * 职责：
 *  - GET /events (客户端 SSE 事件流)
 *  - 订阅 Redis Pub/Sub (mls:events:*)
 *  - 严格租户隔离校验：Number(payload.userId) === Number(sessionUser.id)
 */
const { subscribeEvents, getPubClient } = require('../../../worker/src/pubsub');

// 活跃 SSE 连接池: Map<userId, Set<http.ServerResponse>>
const activeConnections = new Map();
let isSubscribed = false;

function initRedisEventSubscriber() {
  if (isSubscribed) return;
  isSubscribed = true;

  try {
    subscribeEvents(
      ['mls:events:task_updated', 'mls:events:asset_changed', 'mls:events:job_progress'],
      (channel, payload) => {
        if (!payload || payload.userId == null) {
          console.warn('[events] 忽略无 userId 的未授权事件');
          return;
        }

        const targetUserId = Number(payload.userId);
        const userConnections = activeConnections.get(targetUserId);

        if (!userConnections || userConnections.size === 0) {
          return; // 该用户当前无活跃连接
        }

        const sseData = `data: ${JSON.stringify(payload)}\n\n`;
        for (const res of userConnections) {
          try {
            res.write(sseData);
          } catch (e) {
            console.warn('[events] SSE 写入失败:', e.message);
          }
        }
      }
    );
  } catch (err) {
    console.warn('[events] 初始化 Redis Pub/Sub 订阅失败 (降级为单机模式):', err.message);
  }
}

async function handleEventsRoutes(services, req, res, pathname, urlObj, context) {
  const { sessionUser, sendJson } = context;

  if (pathname === '/events' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!sessionUser) {
      return sendJson(res, 401, { error: '未登录或会话已过期' });
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      });
      return res.end();
    }

    // 建立 SSE 长连接
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    const currentUserId = Number(sessionUser.id);
    if (!activeConnections.has(currentUserId)) {
      activeConnections.set(currentUserId, new Set());
    }
    const userConns = activeConnections.get(currentUserId);
    userConns.add(res);

    // 发送初始握手与心跳
    res.write(`data: ${JSON.stringify({ event: 'connected', userId: currentUserId, time: Date.now() })}\n\n`);

    const heartbeatTimer = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch (_) {}
    }, 15000);

    initRedisEventSubscriber();

    req.on('close', () => {
      clearInterval(heartbeatTimer);
      userConns.delete(res);
      if (userConns.size === 0) {
        activeConnections.delete(currentUserId);
      }
    });

    return true;
  }

  return false;
}

/**
 * 进程内广播（兼容无 Redis 本地回归单测）
 */
function localBroadcast(userId, payload) {
  const targetUserId = Number(userId);
  const conns = activeConnections.get(targetUserId);
  if (!conns) return 0;
  let count = 0;
  for (const res of conns) {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      count++;
    } catch (_) {}
  }
  return count;
}

module.exports = {
  handleEventsRoutes,
  localBroadcast,
  activeConnections
};
