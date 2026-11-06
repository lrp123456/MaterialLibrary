/**
 * STYLEKIT MOTION LAB · 本地静态服务（30004，仅 demo）
 * 零依赖：node demos/stylekit-motion/server.mjs
 * 说明：不占用正式 30002 / test 通道 30003，也不读取项目数据库。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DEMO_PORT || 30004);
const HOST = '127.0.0.1';

const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml',
  '.woff2':'font/woff2', '.png':'image/png', '.jpg':'image/jpeg',
  '.ico':'image/x-icon', '.md':'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname); }
  catch { res.writeHead(400).end('Bad Request'); return; }

  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  let file = path.resolve(ROOT, rel);
  // 目录穿越防护
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end('Forbidden'); return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(file)) { res.writeHead(404).end('Not Found'); return; }
    file = path.join(ROOT, 'index.html'); // SPA fallback
  }

  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
});

server.listen(PORT, HOST, () => {
  console.log(`STYLEKIT MOTION LAB → http://${HOST}:${PORT}`);
  console.log(`静态根目录：${ROOT}`);
  console.log('所有资源均为本地相对路径，断网可用。');
});
