/**
 * 启动时探测并启用全局 HTTP 代理（Clash / 系统代理）。
 * WSL 里 127.0.0.1:7890 通常经 localhost 转发可达 Windows Clash。
 * 探测失败后保留候选，供 ensureProxy() 在后续生图/下载前重试。
 * 必须在任何 fetch / undici 调用之前 require。
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

function parseProxyUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (!u.hostname) return null;
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    return { href: u.toString().replace(/\/$/, ''), host: u.hostname, port, protocol: u.protocol };
  } catch {
    return null;
  }
}

function tcpProbeSync(host, port, timeoutMs = 700) {
  try {
    const script = [
      'const net=require("net");',
      `const s=net.connect(${Number(port)},${JSON.stringify(host)},()=>process.exit(0));`,
      `s.setTimeout(${Number(timeoutMs)},()=>process.exit(1));`,
      's.on("error",()=>process.exit(1));',
    ].join('');
    const r = spawnSync(process.execPath, ['-e', script], {
      timeout: timeoutMs + 400,
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function wslWindowsHost() {
  const seen = [];
  try {
    const txt = fs.readFileSync('/proc/net/route', 'utf8');
    for (const line of txt.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols[1] === '00000000' && cols[2] && cols[2] !== '00000000') {
        const hex = cols[2];
        const ip = [hex.slice(6, 8), hex.slice(4, 6), hex.slice(2, 4), hex.slice(0, 2)]
          .map((h) => parseInt(h, 16))
          .join('.');
        if (net.isIP(ip) && !seen.includes(ip)) seen.push(ip);
      }
    }
  } catch {}
  try {
    const r = spawnSync('ip', ['route', 'show', 'default'], { encoding: 'utf8', timeout: 1200 });
    const re = /via\s+(\d+\.\d+\.\d+\.\d+)/g;
    let m;
    while ((m = re.exec(String(r.stdout || '')))) {
      if (net.isIP(m[1]) && !seen.includes(m[1])) seen.push(m[1]);
    }
  } catch {}
  return seen;
}

function readConfigProxy() {
  const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
  for (const name of ['providers.json']) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
      const p = (raw.network && raw.network.proxy) || raw.proxy;
      if (typeof p === 'string' && p.trim()) return p.trim();
    } catch {}
  }
  return '';
}

function applyDispatcher(proxyUrl) {
  process.env.HTTP_PROXY = proxyUrl;
  process.env.http_proxy = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.https_proxy = proxyUrl;
  const np = process.env.NO_PROXY || process.env.no_proxy || '127.0.0.1,localhost,::1';
  process.env.NO_PROXY = np;
  process.env.no_proxy = np;
  const { ProxyAgent, setGlobalDispatcher, EnvHttpProxyAgent } = require('undici');
  // 优先显式 ProxyAgent：EnvHttpProxyAgent 依赖 env 解析，主机探测已确认可达后
  // 直接绑定目标代理更稳（避免 NO_PROXY/大小写环境变量差异导致旁路）。
  try {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch {
    if (typeof EnvHttpProxyAgent === 'function') {
      setGlobalDispatcher(new EnvHttpProxyAgent());
    }
  }
  try {
    const https = require('https');
    const { HttpsProxyAgent } = require('https-proxy-agent');
    https.globalAgent = new HttpsProxyAgent(proxyUrl);
  } catch {}
}

function rewriteHost(proxyUrl, host) {
  const u = new URL(proxyUrl);
  u.hostname = host;
  return u.toString().replace(/\/$/, '');
}

function buildCandidates() {
  const envUrl =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY ||
    process.env.all_proxy ||
    process.env.ALL_PROXY ||
    '';
  const cfgUrl = readConfigProxy();
  const seen = new Set();
  const candidates = [];
  const push = (url, why) => {
    if (!url) return;
    const parsed = parseProxyUrl(url);
    if (!parsed) return;
    if (seen.has(parsed.href)) return;
    seen.add(parsed.href);
    candidates.push({ url: parsed.href, why, parsed });
  };

  // 1) 显式配置
  push(cfgUrl, 'providers.json');
  push(envUrl, 'env');

  // 2) WSL 本机 127.0.0.1 优先：localhost 转发到 Windows Clash 在这里最常见
  push('http://127.0.0.1:7890', 'default-clash');

  // 3) 各默认网关 / 网关改写（兼容 WSL NAT 与 mirrored）
  const hosts = ['127.0.0.1', ...wslWindowsHost()];
  const expanded = [];
  for (const c of candidates) {
    expanded.push(c);
    if (c.parsed.host === '127.0.0.1' || c.parsed.host === 'localhost' || c.parsed.host === '::1') {
      for (const gw of hosts) {
        if (gw === '127.0.0.1' || gw === 'localhost' || gw === '::1') continue;
        const u = rewriteHost(c.url, gw);
        const parsed = parseProxyUrl(u);
        if (parsed && !seen.has(parsed.href)) {
          seen.add(parsed.href);
          expanded.push({ url: parsed.href, why: `host-${gw}`, parsed });
        }
      }
    }
  }
  return expanded;
}

function resolveAndApplyProxy({ quiet = false } = {}) {
  const expanded = buildCandidates();
  for (const c of expanded) {
    if (!c.parsed) continue;
    if (tcpProbeSync(c.parsed.host, c.parsed.port)) {
      applyDispatcher(c.url);
      if (!quiet) {
        console.log(`[proxy] 已启用全局 HTTP 代理: ${c.url} (${c.why}) (NO_PROXY: ${process.env.NO_PROXY})`);
      }
      return c.url;
    }
    if (!quiet) {
      console.warn(`[proxy] 探测失败 ${c.url} (${c.why})`);
    }
  }
  if (!quiet) {
    console.warn('[proxy] 未找到可达的 HTTP 代理。Google Gemini 等海外端点可能失败。请设置 https_proxy，或在 providers.json 写 network.proxy');
  }
  return '';
}

// 运行期恢复：启动时探测失败后，后续生图/下载前可再次 ensureProxy()
let activeProxy = '';
let lastProbeAt = 0;
let lastProbeOk = false;
const PROBE_RETRY_MS = 15000;

function ensureProxy({ force = false, quiet = true } = {}) {
  if (activeProxy && !force) return activeProxy;
  const now = Date.now();
  if (!force && !lastProbeOk && lastProbeAt && now - lastProbeAt < PROBE_RETRY_MS) {
    return activeProxy;
  }
  lastProbeAt = now;
  const url = resolveAndApplyProxy({ quiet });
  if (url) {
    activeProxy = url;
    lastProbeOk = true;
  } else {
    lastProbeOk = false;
  }
  return activeProxy;
}

activeProxy = resolveAndApplyProxy();
lastProbeAt = Date.now();
lastProbeOk = !!activeProxy;

module.exports = { resolvedProxy: activeProxy, resolveAndApplyProxy, ensureProxy };
