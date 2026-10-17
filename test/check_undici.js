const { setGlobalDispatcher, EnvHttpProxyAgent } = require('undici');
setGlobalDispatcher(new EnvHttpProxyAgent());

async function run() {
  console.log('Testing ark with undici EnvHttpProxyAgent...');
  try {
    const res = await fetch('https://ark.cn-beijing.volces.com/api/v3', { signal: AbortSignal.timeout(5000) });
    console.log('SUCCESS! Status:', res.status);
  } catch (e) {
    console.error('FAILED:', e.message);
  }
}
run();
