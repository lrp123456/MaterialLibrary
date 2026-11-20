/**
 * Phase 1 验收门禁测试 2：事件循环非阻塞与异步进程压测 (Event Loop Non-blocking Test)
 *
 * 验证目标：
 * 1. 运行长耗时模拟 FFmpeg 子进程期间，事件循环零冻结；
 * 2. 以 50ms 间隔高频轮询 /api/health，响应顺畅，P99 延迟 < 50ms；
 * 3. runProcessAsync 超时进程树强杀机制有效，杜绝僵尸进程残留。
 */
const http = require('http');
const assert = require('assert');
const { runProcessAsync } = require('../../src/lib/async-proc');

async function run() {
  console.log('=== 1. 启动 HTTP 健康检查端点 ===');
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
    }
    res.writeHead(404);
    res.end();
  });

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });

  try {
    const healthUrl = `http://127.0.0.1:${port}/api/health`;
    // 预热 1 次以建立 HTTP 客户端连接池及 JIT 编译
    await (await fetch(healthUrl)).json();

    console.log(`\n=== 2. 并发运行长耗时异步子进程 + 50ms 高频健康探测 ===`);
    // 模拟一个执行 3 秒耗时计算/等待的异步任务
    const subprocPromise = runProcessAsync(process.execPath, [
      '-e',
      'const t = Date.now(); while(Date.now() - t < 3000) {}; console.log("child_done");'
    ], { timeoutMs: 10000 });

    const latencies = [];
    const startAll = Date.now();

    // 在子进程运行期间，以 50ms 频率发起请求
    while (Date.now() - startAll < 2800) {
      const t0 = Date.now();
      const res = await fetch(healthUrl);
      const lat = Date.now() - t0;
      assert.strictEqual(res.status, 200);
      latencies.push(lat);
      await new Promise(r => setTimeout(r, 40));
    }

    const subprocResult = await subprocPromise;
    assert.strictEqual(subprocResult.code, 0);
    assert.ok(subprocResult.stdout.includes('child_done'));

    // 计算延迟分位数
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p90 = latencies[Math.floor(latencies.length * 0.9)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1);

    console.log(`📊 请求统计: 总次数 ${latencies.length}, Avg: ${avg}ms, P50: ${p50}ms, P90: ${p90}ms, P99: ${p99}ms`);
    assert.ok(latencies.length >= 25, `至少应完成 25 次探测 (实际 ${latencies.length})`);
    assert.ok(p99 < 50, `P99 延迟必须 < 50ms，杜绝事件循环假死 (实际: ${p99}ms)`);
    console.log('✅ 事件循环高频探测非阻塞验证通过');

    console.log('\n=== 3. 验证超时自动强杀子进程树 ===');
    const t0 = Date.now();
    const timeoutResult = await runProcessAsync(process.execPath, [
      '-e',
      'setTimeout(() => console.log("should_not_reach"), 15000);'
    ], { timeoutMs: 800 });

    const cost = Date.now() - t0;
    assert.ok(timeoutResult.code === 124 || timeoutResult.status === 124, '超时应返回 124 状态码');
    assert.ok(cost >= 750 && cost <= 2500, `超时控制必须精准响应 (实际用时: ${cost}ms)`);
    assert.ok(!timeoutResult.stdout.includes('should_not_reach'), '被强杀进程不得输出后续内容');
    console.log(`✅ 超时强杀机制验证通过 (耗时 ${cost}ms)`);

  } finally {
    server.close();
  }

  console.log('\n🎉 事件循环非阻塞与异步进程执行全部测试通过！');
}

run().catch((e) => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});
