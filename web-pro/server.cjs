/**
 * Material Studio Pro · 30002 独立高性能 Web 服务器
 * 纯 Node 原生实现（零外部依赖），提供 web-pro/dist 静态资源托管与 /api 代理转发到 30001。
 * 兼容 Windows / Linux，供 service-hub 和独立启动一键秒开。
 */
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.WEB_PRO_PORT || process.argv[2] || 30002);
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:30001';
// 剪辑子应用（fork 自 OpenCut Classic），Next.js 以 basePath=/editor 启动。
const EDITOR_TARGET = process.env.EDITOR_TARGET || 'http://127.0.0.1:3010';
// 通道标记：正式 30002 托管 dist；test worktree 通道在 30003 借 APP_CHANNEL=gray
// 标记做只读联调（遗留同树灰测通道 2026-11-03 退役，见 archive/gray-retired-20261103/）
const CHANNEL = String(process.env.APP_CHANNEL || '').toLowerCase() === 'gray' ? 'gray' : 'prod';
const DIST_DIR = path.resolve(__dirname, process.env.WEB_PRO_DIST || 'dist');

// 剪辑器依赖 OPFS 与 WebCodecs，二者在非安全上下文（局域网/公网 HTTP）会被浏览器禁用。
// 这里在同一端口上同时接受 HTTP 与 TLS，剪辑器入口在 HTTP 下自动跳 HTTPS。
const TLS_DIR = process.env.TLS_DIR || path.join(os.homedir(), '.dsh-material-library', 'tls');
const TLS_CERT = process.env.TLS_CERT || path.join(TLS_DIR, 'server.crt');
const TLS_KEY = process.env.TLS_KEY || path.join(TLS_DIR, 'server.key');
const CA_CERT = process.env.TLS_CA || path.join(TLS_DIR, 'ca.crt');
let httpsServer = null;
let httpsEnabled = false;
// 关掉跳转 = 退回纯 HTTP 入口（配合浏览器把该 origin 标成安全源使用）。
const forceHttps = process.env.EDITOR_FORCE_HTTPS !== '0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

// 代理请求至指定后端（默认 30001）
function proxyRequest(req, res, target = API_TARGET) {
  const targetUrl = new URL(req.url, target);
  // SEC-001/SEC-010：转发前剥离外部伪造的内部特权头，并把真实客户端 IP
  // 通过 X-Real-IP 注入（后端 auth.clientIp 仅在回环来源时采信该头）。
  const safeHeaders = { ...req.headers, host: targetUrl.host };
  // 让后端知道外部真实协议/主机；Next 生成绝对地址时会读这两个头。
  safeHeaders['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
  if (req.headers.host) safeHeaders['x-forwarded-host'] = req.headers.host;
  delete safeHeaders['x-umbra-internal'];
  delete safeHeaders['x-internal-call'];
  const realIp = String(req.socket?.remoteAddress || '').replace(/^::ffff:/i, '');
  if (realIp && realIp !== '127.0.0.1' && realIp !== '::1') {
    safeHeaders['x-real-ip'] = realIp;
  } else {
    delete safeHeaders['x-real-ip'];
  }
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: safeHeaders,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[proxy error]', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `后端服务不可达 (${target}): ${err.message}` }));
    }
  });

  req.pipe(proxyReq);
}

// WebSocket upgrade 透传：/api/push 走 raw TCP 管道转发到 30001。
// 浏览器与 App 端都要求经网关后仍是同一条 TCP 连接，普通 http.request 代理会毁掉握手。
function proxyUpgrade(req, socket, head, target = API_TARGET) {
  const targetUrl = new URL(req.url, target);
  const upstream = net.connect(
    { host: targetUrl.hostname, port: Number(targetUrl.port || 80) },
    () => {
      const lines = [`GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) {
        if (k === 'host') continue;
        lines.push(`${k}: ${v}`);
      }
      lines.push(`host: ${targetUrl.host}`);
      lines.push('', '');
      upstream.write(lines.join('\r\n'));
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    }
  );
  upstream.on('error', (err) => {
    console.error('[proxy upgrade error]', err.message);
    try { socket.destroy(); } catch (_) {}
  });
  socket.on('error', () => {
    try { upstream.destroy(); } catch (_) {}
  });
}

function handleRequest(req, res) {
  const urlObj = new URL(req.url, 'http://127.0.0.1');
  const pathname = urlObj.pathname;

  // 通道标记：浏览器 DevTools / 脚本一眼能看出当前页面挂在哪条通道上
  res.setHeader('X-ML-Channel', CHANNEL);

  // 0a. 发布用自重启（仅本机 + 内部标记）。正式网关没有 DB，退出后由
  //     scripts/watchdog.sh 的 webpro 子进程守护重新拉起，从而加载 server.cjs 新代码。
  if (pathname === '/__ml/restart' && req.method === 'POST') {
    const ip = String(req.socket?.remoteAddress || '').replace(/^::ffff:/i, '');
    const isLocal = ip === '127.0.0.1' || ip === '::1';
    if (!isLocal) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '只接受本机发起的重启' }));
    }
    if (String(req.headers['x-ml-internal'] || '') !== 'restart') {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '缺少内部调用标记' }));
    }
    res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, channel: CHANNEL, pid: process.pid, note: '网关即将退出，由 watchdog 拉起' }));
    console.log(`[web-pro] 收到发布重启指令（channel=${CHANNEL}），300ms 后退出`);
    setTimeout(() => process.exit(0), 300);
    return;
  }

  // 0b. 通道自述：给发布脚本和设置页做体检用
  if (pathname === '/__ml/channel' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({ channel: CHANNEL, port: PORT, dist: DIST_DIR, apiTarget: API_TARGET, pid: process.pid })
    );
  }

  // 0. 本地 CA 公钥下载：手机/平板装一次即可信任本机 HTTPS（私钥不出服务器）。
  if (pathname === '/mls-ca.crt' || pathname === '/mls-ca.pem') {
    if (!fs.existsSync(CA_CERT)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('CA 证书不存在');
    }
    res.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="mls-ca.crt"',
      'Cache-Control': 'no-store',
    });
    return fs.createReadStream(CA_CERT).pipe(res);
  }

  // 0b. 剪辑器必须运行在安全上下文：局域网/公网的 HTTP 入口一律跳 HTTPS。
  //     本机 127.0.0.1/localhost 本身算安全上下文，不跳，避免无谓证书告警。
  //     keep-http=1 是给老数据留的逃生口：IndexedDB/OPFS 按 origin 隔离，
  //     之前用 HTTP 建的工程只能在 HTTP origin 里打开并导出 .mlsclip / 备份到云端。
  //
  //     只跳「导航」，不跳 fetch/XHR：Chrome 会把嵌在 HTTP 页面里的跨源 HTTPS
  //     子框架一并降级成非安全上下文，所以主应用（父）和剪辑器（iframe）必须落在
  //     同一个 scheme 上，否则 iframe 里 OPFS/WebCodecs 照样没有。反过来，
  //     无差别重定向会把 HTTP 客户端（HarmonyOS App、脚本）的 /api 调用打成
  //     跨 scheme CORS，且它们无法点过证书告警。
  //     判据用 Sec-Fetch-Mode 或 Accept: text/html —— 前者更准，但内嵌 WebView
  //     不一定发，后者浏览器必发；/api 一律不跳，避免误伤原生客户端。
  const host = req.headers.host || '';
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);
  const secFetchMode = String(req.headers['sec-fetch-mode'] || '');
  const isApiPath =
    pathname.startsWith('/api/') || pathname === '/api' ||
    pathname.startsWith('/editor-api/') || pathname === '/editor-api';
  const isPageNavigation =
    secFetchMode === 'navigate' ||
    secFetchMode === 'nested-navigate' ||
    String(req.headers.accept || '').includes('text/html');
  if (
    httpsEnabled &&
    forceHttps &&
    !req.socket.encrypted &&
    !isLocalHost &&
    host &&
    isPageNavigation &&
    !isApiPath &&
    !urlObj.searchParams.has('keep-http')
  ) {
    res.writeHead(302, { Location: `https://${host}${req.url}` });
    return res.end();
  }

  // 1. /api 与 /editor-api 路由代理到 30001
  //    剪辑工程的读写、导出帧上传、ffmpeg 合成全在 /editor-api 下；
  //    只代理 /api 会让这些请求落到 SPA fallback，返回 index.html。
  if (
    pathname.startsWith('/api/') || pathname === '/api' ||
    pathname.startsWith('/editor-api/') || pathname === '/editor-api'
  ) {
    return proxyRequest(req, res);
  }

  // 1b. 剪辑子应用：/editor、/editor/* 代理到 Next（basePath=/editor）。
  //     必须精确匹配 '/editor' 或 '/editor/' 前缀 —— 写成 startsWith('/editor')
  //     会把上面的 /editor-api 一起吞掉，导致工程读写全挂。
  if (pathname === '/editor' || pathname.startsWith('/editor/')) {
    return proxyRequest(req, res, EDITOR_TARGET);
  }

  // 2. 静态资源托管
  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);

  // SPA 路由 fallback 到 index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const isHtml = ext === '.html';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': isHtml ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000',
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('前端尚未构建，请先在 web-pro 目录执行 npm run build');
}

function handleUpgrade(req, socket, head) {
  const pathname = String(req.url || '').split('?')[0];
  // /api/asr/stream 是语音输入的流式通道，和 /api/push 一样必须走原始 TCP 管道，
  // 普通 http.request 代理会毁掉 101 握手。
  if (pathname === '/api/push' || pathname === '/ws' || pathname === '/api/asr/stream') {
    return proxyUpgrade(req, socket, head);
  }
  socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

const server = http.createServer(handleRequest);
server.on('upgrade', handleUpgrade);

try {
  if (fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY)) {
    httpsServer = https.createServer(
      { key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) },
      handleRequest,
    );
    httpsServer.on('upgrade', handleUpgrade);
    httpsServer.on('tlsClientError', () => {});
    httpsEnabled = true;
  }
} catch (err) {
  console.error('[web-pro] TLS 证书加载失败，回退为仅 HTTP:', err.message);
}

// 同一端口双协议：TLS ClientHello 首字节是 0x16，其余一律按 HTTP 解析。
// 这样公网 FRP 的 TCP 映射（30002）不用改，HTTP 老客户端也不受影响。
const listener = net.createServer((socket) => {
  socket.once('data', (chunk) => {
    socket.pause();
    socket.unshift(chunk);
    if (httpsEnabled && chunk[0] === 0x16) {
      httpsServer.emit('connection', socket);
    } else {
      server.emit('connection', socket);
    }
    // 等目标 server 挂好解析器再恢复读取；同步 resume 会让 TLS 握手丢首包。
    process.nextTick(() => socket.resume());
  });
  socket.on('error', () => {});
});

listener.on('error', (err) => {
  console.error('[web-pro] 监听失败:', err.message);
  process.exit(1);
});

listener.listen(PORT, '0.0.0.0', () => {
  console.log(`[web-pro] Material Studio Pro 桌面工作台已就绪: http://127.0.0.1:${PORT}（通道 ${CHANNEL}）`);
  console.log(`[web-pro] HTTPS: ${httpsEnabled ? `启用（${TLS_CERT}）` : '未启用（缺少证书）'}`);
  console.log(`[web-pro] API 反向代理目标: ${API_TARGET}`);
  console.log(`[web-pro] 静态资源目录: ${DIST_DIR}`);
});
