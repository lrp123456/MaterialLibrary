/**
 * 局域网网关请求不走 Clash。
 * undici 的 NO_PROXY 不认 10.0.0.0/8 这种网段，192.168.1.107 必须显式直连。
 *
 * 同时负责给 GPU 面板带上排队优先级（X-GPU-Priority）：
 * 用户主动发起的生成 = high，工作流批处理 = low，未声明 = normal。
 * 只有局域网请求才加这个头，避免污染外部厂商 API。
 */
const { AsyncLocalStorage } = require('async_hooks');

const priorityStore = new AsyncLocalStorage();

function normalizeGpuPriority(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'high' || s === 'user' || s === 'urgent') return 'high';
  if (s === 'low' || s === 'workflow' || s === 'batch') return 'low';
  return 'normal';
}

function withGpuPriority(priority, fn) {
  return priorityStore.run(normalizeGpuPriority(priority), fn);
}

function currentGpuPriority() {
  return priorityStore.getStore() || 'normal';
}

function isLanHost(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
      || host === '10.0.2.2'
      || /^192\.168\./.test(host) || /^10\./.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  } catch (_) {
    return false;
  }
}

let cachedLanAgent = null;
function getLanAgent() {
  if (!cachedLanAgent) {
    const { Agent } = require('undici');
    cachedLanAgent = new Agent({
      keepAliveTimeout: 30000,
      keepAliveMaxTimeout: 60000,
      connections: 64,
    });
  }
  return cachedLanAgent;
}

function lanDispatcher(url) {
  if (isLanHost(url)) return getLanAgent();
  return undefined;
}

function lanFetch(url, opts = {}) {
  const dispatcher = opts.dispatcher || lanDispatcher(url);
  let next = opts;
  if (isLanHost(url)) {
    const headers = new Headers(opts.headers || undefined);
    if (!headers.has('x-gpu-priority')) {
      headers.set('X-GPU-Priority', currentGpuPriority());
    }
    next = { ...opts, headers };
  }
  return fetch(url, dispatcher ? { ...next, dispatcher } : next);
}

module.exports = {
  lanDispatcher,
  lanFetch,
  isLanHost,
  withGpuPriority,
  currentGpuPriority,
  normalizeGpuPriority,
};
