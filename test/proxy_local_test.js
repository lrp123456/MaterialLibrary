// 模拟 server.js 的代理初始化后访问本地 mock
process.env.https_proxy = process.env.https_proxy || process.env.http_proxy || 'http://127.0.0.1:7890';
const { ProxyAgent, setGlobalDispatcher, EnvHttpProxyAgent } = require('undici');
if (!process.env.NO_PROXY) {
  process.env.NO_PROXY = '127.0.0.1,localhost,::1';
}
setGlobalDispatcher(new EnvHttpProxyAgent());
console.log('proxy', process.env.https_proxy, 'NO_PROXY', process.env.NO_PROXY);

(async () => {
  try {
    const res = await fetch('http://127.0.0.1:8798/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' })
    });
    console.log('status', res.status, await res.text());
  } catch (e) {
    console.error('FETCH_FAIL', e);
    process.exit(1);
  }
})();
