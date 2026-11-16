/**
 * 生成上游的统一网络层：传输错误重试，证书错误时绕开代理直连。
 *
 * 走 Clash 之类的 HTTP 代理时，个别出口节点会返回无法验证的证书
 * （unable to verify the first certificate）或直接掐断 TLS 握手；
 * 而火山方舟、Agnes 这类国内上游直连是通的，所以第二次尝试改直连。
 */
const { Agent } = require('undici');

let directAgent = null;
function directDispatcher() {
  if (!directAgent) {
    directAgent = new Agent({ connect: { timeout: 20000 }, keepAliveTimeout: 30000 });
  }
  return directAgent;
}

function describeFetchError(e) {
  const cause = e?.cause;
  const detail = cause
    ? (cause.message || cause.code || cause.errno || String(cause))
    : '';
  const base = e?.message || String(e);
  if (detail && !base.includes(detail)) return `${base} (${detail})`;
  return base;
}

function netText(e) {
  const cause = e?.cause || {};
  return `${e?.name || ''} ${e?.message || ''} ${cause.code || ''} ${cause.message || ''}`;
}

/** 请求肯定没有发出去（握手/建连阶段失败），重提不会造成重复生成 */
function isPreSendError(e) {
  if (!e) return false;
  const text = netText(e);
  const code = String(e?.cause?.code || '');
  return /CERT|SSL|TLS|certificate|unable to verify/i.test(text)
    || /disconnected before secure TLS/i.test(text)
    || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT/.test(code);
}

/** 轮询/下载是幂等的，任何传输层错误都可以重试 */
function isRetryableError(e) {
  if (!e) return false;
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  return Boolean(e.cause) || /fetch failed|socket|aborted|timeout|terminated|premature close|ECONNRESET|EPIPE/i.test(netText(e));
}

/**
 * @param {string} url
 * @param {RequestInit} opts  method/headers/body；不要传 signal，超时由 timeoutMs 控制
 * @param {{attempts?:number,timeoutMs?:number,what?:string,retryOn?:(e:Error)=>boolean,onRetry?:(info:object)=>void}} cfg
 */
async function fetchNet(url, opts = {}, cfg = {}) {
  const {
    attempts = 3,
    timeoutMs = 60000,
    what = '网络请求',
    retryOn = isRetryableError,
    onRetry,
  } = cfg;
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    // 第 2 次尝试绕开代理直连，第 3 次回到原通路
    const useDirect = i === 2;
    try {
      return await fetch(url, {
        ...opts,
        ...(useDirect ? { dispatcher: directDispatcher() } : null),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      lastErr = e;
      if (i >= attempts || !retryOn(e)) break;
      try { onRetry?.({ attempt: i, useDirect, error: e, what, url }); } catch (_) {}
      await new Promise((r) => setTimeout(r, i === 1 ? 700 : 1800));
    }
  }
  throw lastErr;
}

module.exports = { fetchNet, describeFetchError, isPreSendError, isRetryableError, directDispatcher };
