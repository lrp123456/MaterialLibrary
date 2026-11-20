/**
 * Phase 1 验收门禁测试 1：代理隔离与策略反转单测 (Proxy Isolation Test)
 *
 * 验证目标：
 * 1. 默认 100% 直连：在 7890 端口未开启的环境下，对 127.0.0.1 / 本地端点调用 fetchWithPolicy 100% 直连成功；
 * 2. 严防全局污染：https.globalAgent 未被篡改为 HttpsProxyAgent；
 * 3. 显式按需代理：useProxy: true 请求精准命中配置的代理端点；
 * 4. 代理失效快切：代理不可达时快速报错，不无休止卡死事件循环。
 */
const http = require('http');
const https = require('https');
const assert = require('assert');
const { fetchWithPolicy, getDirectDispatcher } = require('../../src/net/http-client');
require('../../src/proxy-setup');

async function run() {
  console.log('=== 1. 验证 https.globalAgent 未被全局篡改 ===');
  assert.ok(
    !https.globalAgent || https.globalAgent.constructor.name !== 'HttpsProxyAgent',
    'https.globalAgent 绝不能被篡改为 HttpsProxyAgent（杜绝内网/国内流量被劫持）'
  );
  console.log('✅ 全局代理未被污染: https.globalAgent 为原生 Agent');

  console.log('\n=== 2. 验证默认 100% 直连请求（7890 关闭下直连成功） ===');
  // 创建本地直连 HTTP 服务
  const targetServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, direct: true, url: req.url }));
  });

  const targetPort = await new Promise((resolve) => {
    targetServer.listen(0, '127.0.0.1', () => {
      resolve(targetServer.address().port);
    });
  });

  try {
    const directUrl = `http://127.0.0.1:${targetPort}/api/test-direct`;
    const res = await fetchWithPolicy(directUrl);
    assert.strictEqual(res.status, 200, '默认直连应返回 200 OK');
    const data = await res.json();
    assert.strictEqual(data.direct, true, '请求应直连命中目标服务');
    console.log('✅ 默认直连请求测试通过');

    console.log('\n=== 3. 验证显式 useProxy: true 精准命中 Mock 代理 ===');
    let proxyHit = false;
    // 创建 Mock HTTP 代理服务器 (支持 HTTP CONNECT 隧道代理)
    const mockProxyServer = http.createServer((req, res) => {
      proxyHit = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, viaProxy: true }));
    });
    mockProxyServer.on('connect', (req, clientSocket, head) => {
      proxyHit = true;
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      clientSocket.once('data', () => {
        const body = JSON.stringify({ ok: true, viaProxy: true });
        clientSocket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\nConnection: close\r\n\r\n' + body);
      });
    });

    const mockProxyPort = await new Promise((resolve) => {
      mockProxyServer.listen(0, '127.0.0.1', () => {
        resolve(mockProxyServer.address().port);
      });
    });

    try {
      const mockProxyUrl = `http://127.0.0.1:${mockProxyPort}`;
      const proxyRes = await fetchWithPolicy(`http://remote-gemini.internal.test/v1/chat`, {
        useProxy: true,
        proxyUrl: mockProxyUrl,
        timeoutMs: 5000
      });

      assert.strictEqual(proxyRes.status, 200);
      assert.strictEqual(proxyHit, true, 'useProxy: true 请求必须精准经过代理服务器');
      console.log('✅ 显式按需代理命中测试通过');
    } finally {
      mockProxyServer.close();
    }

    console.log('\n=== 4. 验证代理端口关闭时快速报错且不挂死 ===');
    // 使用一个确保关闭的端口 59999
    let failedFast = false;
    const startT = Date.now();
    try {
      await fetchWithPolicy(`http://remote-target.test/v1`, {
        useProxy: true,
        proxyUrl: 'http://127.0.0.1:59999',
        timeoutMs: 3000
      });
    } catch (e) {
      failedFast = true;
      assert.ok(/Proxy unreachable/i.test(e.message), '应返回明确的代理不可达提示');
    }
    const elapsed = Date.now() - startT;
    assert.ok(failedFast, '代理关闭时必须快速抛错');
    assert.ok(elapsed < 2500, `探测超时必须受限 (实际耗时 ${elapsed}ms)`);
    console.log(`✅ 代理不可达快速熔断测试通过 (耗时 ${elapsed}ms)`);

  } finally {
    targetServer.close();
  }

  console.log('\n🎉 代理隔离与策略反转全部单测顺利通过！');
}

run().catch((e) => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});
