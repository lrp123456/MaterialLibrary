/**
 * 局域网网关请求不走 Clash。
 * undici 的 NO_PROXY 不认 10.0.0.0/8 这种网段，192.168.1.107 必须显式直连。
 */
function lanDispatcher(url) {
  try {
    const host = new URL(url).hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1'
      || host === '10.0.2.2'
      || /^192\.168\./.test(host) || /^10\./.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    if (local) return new (require('undici').Agent)();
  } catch (_) {}
  return undefined;
}

function lanFetch(url, opts = {}) {
  const dispatcher = opts.dispatcher || lanDispatcher(url);
  return fetch(url, dispatcher ? { ...opts, dispatcher } : opts);
}

module.exports = { lanDispatcher, lanFetch };
