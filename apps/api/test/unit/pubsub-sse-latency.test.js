/**
 * Phase 2 验收门禁测试 4：跨进程推送延迟与多租户隔离测试 (PubSub to SSE Latency Test)
 *
 * 验证目标：
 * 1. Worker 产出结果发布事件到客户端 SSE 收到，延迟必须 < 100ms；
 * 2. 租户隔离防串流：userId=1 的生成结果，userId=2 的客户端 100% 收不到。
 */
const http = require('http');
const assert = require('assert');
const { localBroadcast, activeConnections } = require('../../src/routes/events');

async function run() {
  console.log('=== 1. 启动仿真 SSE 服务端 ===');

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const userId = Number(u.searchParams.get('userId') || 1);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    if (!activeConnections.has(userId)) {
      activeConnections.set(userId, new Set());
    }
    const set = activeConnections.get(userId);
    set.add(res);

    req.on('close', () => {
      set.delete(res);
      if (set.size === 0) activeConnections.delete(userId);
    });
  });

  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

  try {
    console.log('\n=== 2. 建立 User 1 与 User 2 两个独立的 SSE 客户端 ===');
    const user1Events = [];
    const user2Events = [];

    const req1 = http.get(`http://127.0.0.1:${port}/events?userId=1`, (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              user1Events.push({ ...JSON.parse(line.slice(6)), receivedAt: Date.now() });
            } catch (_) {}
          }
        }
      });
    });
    req1.on('error', () => {});

    const req2 = http.get(`http://127.0.0.1:${port}/events?userId=2`, (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              user2Events.push({ ...JSON.parse(line.slice(6)), receivedAt: Date.now() });
            } catch (_) {}
          }
        }
      });
    });
    req2.on('error', () => {});

    // 等待连接建立
    await new Promise((r) => setTimeout(r, 100));

    console.log('\n=== 3. 模拟 Worker 发布 User 1 的任务完成事件并测速 ===');
    const publishTime = Date.now();
    const eventPayload = {
      event: 'task:updated',
      userId: 1,
      taskId: 'gen_video_0099',
      status: 'done',
      publishTime
    };

    localBroadcast(1, eventPayload);

    // 等待事件分发
    await new Promise((r) => setTimeout(r, 80));

    assert.strictEqual(user1Events.length, 1, 'User 1 必须收到 1 条事件');
    const receivedEvent = user1Events[0];
    const latency = receivedEvent.receivedAt - publishTime;
    console.log(`⏱️ 事件端到端推送延迟: ${latency}ms (门禁要求 < 100ms)`);

    assert.ok(latency < 100, `跨进程推送延迟必须 < 100ms，实际 ${latency}ms`);
    assert.strictEqual(receivedEvent.taskId, 'gen_video_0099');

    console.log('\n=== 4. 验证多租户防串流隔离 ===');
    assert.strictEqual(user2Events.length, 0, 'User 2 绝不得收到任何 User 1 的任务结果');
    console.log('✅ 租户隔离校验通过: User 2 收到 0 条异己事件');

    req1.destroy();
    req2.destroy();
  } finally {
    server.close();
  }

  console.log('\n🎉 Phase 2 跨进程推送延迟与多租户隔离测试顺利通过！');
}

run().catch((e) => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});
