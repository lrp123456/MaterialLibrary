/**
 * Material Studio Pro · 30002 独立高性能 Web 服务器
 * 纯 Node 原生实现（零外部依赖），提供 web-pro/dist 静态资源托管与 /api 代理转发到 30001。
 * 兼容 Windows / Linux，供 service-hub 和独立启动一键秒开。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.WEB_PRO_PORT || process.argv[2] || 30002);
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:30001';
const DIST_DIR = path.resolve(__dirname, 'dist');

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

// 代理 /api 请求至 30001 后端
function proxyRequest(req, res) {
  const targetUrl = new URL(req.url, API_TARGET);
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.host,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[proxy error]', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `后端服务不可达 (${API_TARGET}): ${err.message}` }));
    }
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, 'http://127.0.0.1');
  const pathname = urlObj.pathname;

  // 1. /api 路由代理到 30001
  if (pathname.startsWith('/api/') || pathname === '/api') {
    return proxyRequest(req, res);
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
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[web-pro] Material Studio Pro 桌面工作台已就绪: http://127.0.0.1:${PORT}`);
  console.log(`[web-pro] API 反向代理目标: ${API_TARGET}`);
  console.log(`[web-pro] 静态资源目录: ${DIST_DIR}`);
});
