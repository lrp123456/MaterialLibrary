/**
 * 服务端地址三级回退解析（对标 App 端 app-uniapp/src/service/ServerResolve.js）
 *
 * 回退链：同源网关(30002) → 本机直连(127.0.0.1:30001) → 局域网直连(当前主机/常用 LAN IP:30001)
 *         → 用户配置的公网地址。
 *
 * 设计要点：
 *  - 页面从 192.168.x.x:30002 打开时，默认请求走同源 /api（由 web-pro 网关切到本机 30001）。
 *    一旦网关到后端的链路断开（502/网络错误），浏览器端自动改打 192.168.x.x:30001 直连，
 *    再不行尝试公网地址，而不是让页面直接“丢失/空列表”。
 *  - 探活走公开的 /api/health（无需鉴权，2xx 即活）。
 *  - 成功结果缓存到 localStorage；当前候选失败时标记下线并立即重探。
 *  - 通过 installFetchGuard() 透明接管全局 fetch，业务代码无需逐个改造；
 *    <img>/<video> 等非 fetch 资源用 resolveApiUrl() + bindApiImgFallback() 兜底。
 */

const HEALTH_PATH = '/api/health';
const SAVE_KEY = 'ml_server_base';          // 最近一次探活成功的 base（'' 表示同源）
const MANUAL_KEY = 'ml_server_public_url';  // 用户手动填写的公网/备用地址
const PROBE_TIMEOUT = 2500;

// 常用局域网候选（当前主机名会自动加入；这里只补充已知的固定内网地址）
const KNOWN_LAN_HOSTS = ['192.168.1.59'];
const API_PORT = 30001;

// 需要接管的同源路径前缀
const API_PREFIXES = ['/api/', '/editor-api/'];

let activeBase = null;   // '' = 同源；'http://host:port' = 直连
let allDown = false;     // 最近一次探活是否三级全挂
let probing = null;
let candidatesCache = null;
let listeners = [];

// 探活必须始终走浏览器原生 fetch：installFetchGuard() 接管全局 fetch 后，
// 若探活也走 window.fetch，会被 guard 再次拦截并等待同一个探活 Promise，形成死锁。
// 这里在模块首次求值（早于任何 install 调用）时快照原生 fetch 的已绑定引用；
// 之后 window.fetch 被重新赋值也不会影响这个函数对象。
const NATIVE_FETCH = typeof fetch === 'function' ? fetch.bind(globalThis) : null;

function norm(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

function safeStorageGet(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function safeStorageSet(key, val) {
  try {
    if (val) localStorage.setItem(key, val);
    else localStorage.removeItem(key);
  } catch { /* 隐私模式等场景忽略 */ }
}

function here() {
  if (typeof window === 'undefined' || !window.location) return { proto: 'http:', host: '127.0.0.1', hostname: '127.0.0.1' };
  return { proto: window.location.protocol, host: window.location.host, hostname: window.location.hostname };
}

function isIpHost(h) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
}

/**
 * 组装候选 base 列表（按优先级去重）。
 * 0) 同源（''，相对路径，由 30002 网关代理）
 * 1) 上次成功的地址
 * 2) 本机直连 127.0.0.1:30001（在服务器本机打开浏览器时可用）
 * 3) 当前页面主机名直连 :30001（局域网访问的关键回退）
 * 4) 已知 LAN IP:30001
 * 5) 用户配置的公网地址
 */
export function buildCandidates() {
  if (candidatesCache) return candidatesCache.slice();
  const { hostname } = here();
  const list = [];
  const push = (b) => {
    const n = norm(b);
    if (n === '') { if (!list.includes('')) list.push(''); return; }
    if (!/^https?:\/\//i.test(n)) return;
    if (!list.includes(n)) list.push(n);
  };

  // 0) 同源
  push('');

  // 1) 上次成功
  push(safeStorageGet(SAVE_KEY));

  // 2) 本机直连（仅当页面本身就在本机，或本机与浏览器同机时有意义；失败成本很低）
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    push(`http://127.0.0.1:${API_PORT}`);
  }

  // 3) 当前主机直连（页面从 LAN IP 打开时，后端大概率也在该 IP 的 30001）
  if (isIpHost(hostname) && hostname !== '127.0.0.1') {
    push(`http://${hostname}:${API_PORT}`);
  }

  // 4) 已知 LAN IP
  for (const h of KNOWN_LAN_HOSTS) push(`http://${h}:${API_PORT}`);

  // 本机兜底（页面从域名/非常规主机打开时也试一下）
  push(`http://127.0.0.1:${API_PORT}`);

  // 5) 手动公网地址（最高优先级的人工指定——插到最前，但仍让同源先试一次）
  const manual = norm(safeStorageGet(MANUAL_KEY));
  if (manual) {
    // 同源之后立即尝试手动地址
    list.splice(1, 0, manual);
  }

  candidatesCache = list;
  return list.slice();
}

/** 供设置页/调试查看当前候选链（仅展示）；同源项加网关后缀 */
export function listCandidates() {
  const { proto, host } = here();
  return buildCandidates().map((b) => (b === '' ? `${proto}//${host}（同源网关）` : b));
}

/** 候选链的纯 URL 形态：'' 还原成当前页面 origin，供 <img> 跨 base 重试等编程场景 */
export function listCandidateUrls() {
  const { proto, host } = here();
  return buildCandidates().map((b) => (b === '' ? `${proto}//${host}` : b));
}

function probeOne(base) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); finish(false); }, PROBE_TIMEOUT + 300);
    const url = base ? `${base}${HEALTH_PATH}` : HEALTH_PATH;
    const f = NATIVE_FETCH || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!f) { clearTimeout(timer); finish(false); return; }
    f(url, { method: 'GET', signal: controller.signal, mode: 'cors', cache: 'no-store' })
      .then((r) => { clearTimeout(timer); finish(r.status < 500); })
      .catch(() => { clearTimeout(timer); finish(false); });
  });
}

function emitStatus() {
  const detail = { base: activeBase, allDown, label: currentLabel() };
  for (const fn of listeners) { try { fn(detail); } catch { /* ignore */ } }
  try { window.dispatchEvent(new CustomEvent('ml_server_status', { detail })); } catch { /* ignore */ }
}

export function isAllDown() { return allDown; }

/**
 * 探活并选出可用 base；全部失败时回落到同源（''）并置 allDown=true。
 * @returns {Promise<{base:string, allDown:boolean}>}
 */
export async function ensureServerBase({ force = false } = {}) {
  if (activeBase !== null && !force) return { base: activeBase, allDown: false };
  if (probing && !force) return probing;

  probing = (async () => {
    const candidates = buildCandidates();
    // 并行探活、按候选优先级定案：各候选同时发 /api/health（短超时），
    // 等全部返回后取候选链上第一个成功者。总耗时≈单次超时（约 2.5s）而非候选数×超时，
    // 同时严格保留「同源 → 本机 → 局域网 → 公网」的优先级（不用 Promise.any 抢最快）。
    const results = await Promise.all(candidates.map((b) => probeOne(b)));
    const idx = results.findIndex((ok) => ok);
    const picked = idx >= 0 ? candidates[idx] : null;

    if (picked !== null) {
      activeBase = picked;
      allDown = false;
      safeStorageSet(SAVE_KEY, picked);
      emitStatus();
      return { base: picked, allDown: false };
    }
    // 三级全挂：回落同源，交由上层展示明确的断线状态（而不是假装空数据）
    activeBase = '';
    allDown = true;
    safeStorageSet(SAVE_KEY, '');
    emitStatus();
    return { base: '', allDown: true };
  })().finally(() => { probing = null; });

  return probing;
}

/** 同步读取当前生效 base（未初始化时返回上次缓存或同源 ''） */
export function currentBase() {
  if (activeBase !== null) return activeBase;
  const saved = safeStorageGet(SAVE_KEY);
  return saved || '';
}

export function currentLabel() {
  const b = currentBase();
  if (b === '') return `${here().host}（同源网关）`;
  return b.replace(/^https?:\/\//, '');
}

/** 标记某 base 已失效，触发下一次请求重新探活 */
export function markBaseDown(base) {
  const b = norm(base);
  if (activeBase !== null && norm(activeBase) === b) {
    activeBase = null;
    emitStatus();
  }
}

/** 手动设置公网/备用地址并立即重探（空字符串则清除） */
export async function setManualServer(url) {
  const n = norm(url);
  safeStorageSet(MANUAL_KEY, n);
  candidatesCache = null;
  activeBase = null;
  return ensureServerBase({ force: true });
}

export function getManualServer() {
  return safeStorageGet(MANUAL_KEY);
}

export function onStatusChange(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((f) => f !== fn); };
}

/** 把同源相对 API 路径拼成当前生效 base 下的绝对/相对 URL */
export function resolveApiUrl(origPath) {
  const p = String(origPath || '');
  if (/^https?:\/\//i.test(p)) return p;
  if (typeof window !== 'undefined' && window.location?.protocol === 'https:') { return p.startsWith('/') ? p : '/' + p; }
  const base = currentBase();
  return base ? `${base}${p.startsWith('/') ? '' : '/'}${p}` : p;
}

function isApiPath(p) {
  if (!p || typeof p !== 'string') return false;
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      if (u.origin !== window.location.origin) return false;
      return API_PREFIXES.some((pre) => u.pathname.startsWith(pre));
    } catch { return false; }
  }
  return p.startsWith('/api/') || p.startsWith('/editor-api/') ||
    p === '/api' || p === '/editor-api';
}

/**
 * 透明接管全局 fetch：
 *  - 同源 /api、/editor-api 请求自动按当前 base 发往可用服务器；
 *  - 网络错误 / 502 / 503 / 504 视为链路断开，标记当前 base 并按候选链重试（每个 base 一次）。
 *  - 非 API 请求（页面静态资源、外链、跨域）原样透传。
 */
export function installFetchGuard() {
  if (typeof window === 'undefined' || window.__mlFetchGuard) return;
  window.__mlFetchGuard = true;
  const doFetch = NATIVE_FETCH || window.fetch.bind(window);
  window.__mlNativeFetch = doFetch;

  // 把入参（string/URL/Request）与 init 规范化成可重试的 { url, init }。
  // 注意不能用 new Request(url, oldRequest)——那会消费 body 流，第二次重试即抛
  // "body already used"。这里把 Request 的字段摊平成普通 init，body 引用可重复传入。
  function normalizeInput(input, init) {
    if (typeof Request !== 'undefined' && input instanceof Request) {
      const merged = {
        method: input.method,
        headers: new Headers(input.headers),
        mode: input.mode !== 'navigate' ? input.mode : undefined,
        credentials: input.credentials,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        integrity: input.integrity,
        keepalive: input.keepalive,
        signal: input.signal,
        body: input.bodyUsed ? undefined : input.body,
        ...(init || {}),
      };
      // init 自带 headers 时覆盖而不是被 Request 旧头吞掉
      if (init && init.headers) merged.headers = new Headers(init.headers);
      return { url: input.url, init: merged };
    }
    const url = typeof input === 'string' ? input : String(input?.url || input);
    return { url, init: init || {} };
  }

  async function guarded(input, init) {
    const norm0 = normalizeInput(input, init);
    const path0 = norm0.url;
    if (!isApiPath(path0)) return doFetch(input, init);

    // 首次：确保已选出可用 base（有缓存时立即返回）
    if (activeBase === null) {
      await ensureServerBase();
    }

    const candidates = buildCandidates();
    // 当前生效 base 排最前（buildCandidates 里它可能在中间），其余保持原优先级
    const cur = currentBase();
    const ordered = candidates.slice().sort((a, b) => (a === cur ? -1 : b === cur ? 1 : 0));

    let lastErr = null;
    let lastGatewayResp = null;

    for (const base of ordered) {
      const abs = base ? `${base}${path0.startsWith('/') ? '' : '/'}${path0}` : path0;
      try {
        const resp = await doFetch(abs, norm0.init);
        if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
          // 网关活着但后端链路断：换下一个候选（直连/公网）
          lastGatewayResp = resp;
          if (base === cur) markBaseDown(base);
          continue;
        }
        // 成功命中：记录为当前 base（非同源时持久化）
        if (base !== currentBase() || allDown) {
          activeBase = base;
          allDown = false;
          safeStorageSet(SAVE_KEY, base);
          emitStatus();
        }
        return resp;
      } catch (networkErr) {
        // 连接被拒/超时/CORS：换下一个候选
        lastErr = networkErr;
        if (base === cur) markBaseDown(base);
      }
    }

    // 全部候选不可达：抛出带明确语义的错误（上层展示断线面板，而非“无数据”）
    allDown = true;
    emitStatus();
    if (lastGatewayResp) {
      // 没有可用直连候选时，把最后一个网关错误响应还给调用方，保持原有错误处理分支可用
      return lastGatewayResp;
    }
    const err = new Error('无法连接任何素材服务器（本机 / 局域网 / 公网均不可达）');
    err.name = 'MLServerUnreachable';
    err.cause = lastErr;
    throw err;
  }

  window.fetch = guarded;
}

/**
 * 给 <img>/<video> 等媒体元素绑定失败回退：当前 base 失效时自动换候选地址重载。
 * 用法：<img :src="getAssetImageUrl(fid)" @error="onApiImgError">
 */
export function makeApiImgErrorHandler(getSrc) {
  return async function onApiImgError(e) {
    const el = e?.target || e?.currentTarget;
    if (!el || el.__mlImgTriedAll) return;
    const cur = currentBase();
    markBaseDown(cur);
    const { base, allDown } = await ensureServerBase({ force: true });
    if (allDown) { el.__mlImgTriedAll = true; return; }
    const nextSrc = typeof getSrc === 'function' ? getSrc(base) : '';
    if (nextSrc && el.getAttribute('src') !== nextSrc) {
      el.setAttribute('src', nextSrc);
    }
  };
}
