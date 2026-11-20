/**
 * 统一网络客户端基座 (HTTP Client with Inverted Proxy Policy)
 *
 * 核心策略反转：
 * - 默认 100% 直连：WSL↔Windows (127.0.0.1)、局域网机器、国内云服务 (阿里云/火山/魔搭/Agnes)、OSS 绝不挂代理。
 * - 仅当调用方显式声明 useProxy: true（如 Google Gemini 海外直连端点）时，按需挂载 undici.ProxyAgent。
 * - 代理探活采用纯异步 net.connect，结果缓存 30s，杜绝 spawnSync 与事件循环卡死。
 */
const net = require('net');
const undici = require('undici');

// 直连 Dispatcher 实例缓存
let directAgent = null;
function getDirectDispatcher() {
  if (!directAgent) {
    directAgent = new undici.Agent({
      connect: { timeout: 20000 },
      keepAliveTimeout: 30000,
      pipelining: 1
    });
  }
  return directAgent;
}

// 代理 Agent 缓存 (按 proxyUrl 缓存)
const proxyAgentMap = new Map();
function getProxyAgent(proxyUrl) {
  let agent = proxyAgentMap.get(proxyUrl);
  if (!agent) {
    agent = new undici.ProxyAgent(proxyUrl);
    proxyAgentMap.set(proxyUrl, agent);
  }
  return agent;
}

// 代理探活缓存: { [proxyUrl]: { alive: boolean, at: number } }
const probeCache = new Map();
const PROBE_TTL_MS = 30000;

/**
 * 纯异步探测代理端口连通性（带 30s 缓存，零 spawnSync）
 */
function probeProxyAsync(proxyUrl, timeoutMs = 1000) {
  const cached = probeCache.get(proxyUrl);
  const now = Date.now();
  if (cached && (now - cached.at) < PROBE_TTL_MS) {
    return Promise.resolve(cached.alive);
  }

  let host = '127.0.0.1';
  let port = 7890;
  try {
    const u = new URL(proxyUrl);
    host = u.hostname || '127.0.0.1';
    port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  } catch (_) {}

  return new Promise((resolve) => {
    let resolved = false;
    const socket = net.connect({ host, port });
    const finish = (alive) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch (_) {}
      probeCache.set(proxyUrl, { alive, at: Date.now() });
      resolve(alive);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function getExternalProxyUrl() {
  return process.env.ML_EXTERNAL_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    'http://127.0.0.1:7890';
}

/**
 * 策略化 fetch 请求
 * @param {string} url - 目标请求地址
 * @param {Object} options
 * @param {boolean} [options.useProxy=false] - 是否显式走代理 (默认 false，100% 直连)
 * @param {number} [options.timeoutMs=30000] - 超时毫秒数
 * @param {AbortSignal} [options.signal] - 可选取消信号
 * @param {string} [options.proxyUrl] - 自定义代理地址，缺省读取 ML_EXTERNAL_PROXY_URL
 */
async function fetchWithPolicy(url, options = {}) {
  const {
    useProxy = false,
    timeoutMs = 30000,
    signal,
    proxyUrl: customProxyUrl,
    ...init
  } = options;

  const abortSignal = signal || (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined);

  if (useProxy) {
    const proxyUrl = customProxyUrl || getExternalProxyUrl();
    const isAlive = await probeProxyAsync(proxyUrl);
    if (!isAlive) {
      const err = new Error(`Proxy unreachable: ${proxyUrl} when requesting ${url}`);
      err.code = 'PROXY_UNREACHABLE';
      throw err;
    }
    const dispatcher = getProxyAgent(proxyUrl);
    return undici.fetch(url, {
      ...init,
      dispatcher,
      signal: abortSignal
    });
  }

  // 默认 100% 直连模式：优先使用 global.fetch（无缝支持测试桩与原生直连），兜底走 undici 原生直连 dispatcher
  if (typeof global.fetch === 'function') {
    return global.fetch(url, {
      ...init,
      signal: abortSignal
    });
  }

  return undici.fetch(url, {
    ...init,
    dispatcher: getDirectDispatcher(),
    signal: abortSignal
  });
}

module.exports = {
  fetchWithPolicy,
  probeProxyAsync,
  getExternalProxyUrl,
  getDirectDispatcher,
  getProxyAgent
};
