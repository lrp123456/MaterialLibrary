/**
 * 独立服务入口 (Standalone Server: HTTP API + 前端静态托管 + 解释器 Worker)
 * 供局域网与外部穿透独立运行；也可供开发阶段 Vite 代理调试。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadProjectEnv } = require('./src/env-keys');
loadProjectEnv();
require('./src/proxy-setup');
const http = require('http');
const { openDb } = require('./src/db');
const { resolveQuarkCli } = require('./src/quark');
const { handleApi } = require('./src/api');
const { WorkflowInterpreter } = require('./src/interpreter');

const PORT = process.env.ML_PORT || 30001;
const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');

const config = {
  cliPath: resolveQuarkCli(process.env.QUARK_CLI_PATH),
  rootFid: process.env.QUARK_ROOT_FID || '225f01205b7942b1a75bb0c2d7a0565a',
  systemFid: process.env.QUARK_SYSTEM_FID || 'a082098178f74add99cbf6de2c4caa8a',
  dataDir,
  // NAS 素材库：\\192.168.1.34\文件服务\ai_video\material → WSL /mnt/synology/material
  nasDir: process.env.ML_NAS_DIR || '/mnt/synology/material',
  litellmBaseUrl: process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000',
  litellmApiKey: process.env.LITELLM_API_KEY || '',
  litellmModel: process.env.LITELLM_MODEL || 'doubao-seed-2-0-lite-260428',
  // KX2BFK 引擎对外可达地址（WSL 反连 Windows 本服务）
  bffPublicBase: process.env.BFF_PUBLIC_BASE || ''
};

const db = openDb(dataDir);
const services = { db, config, logger: console };
const interpreter = new WorkflowInterpreter(services);
services.interpreter = interpreter;
interpreter.startWorkerLoop(2000);
setTimeout(() => {
  interpreter.queueMissingRestage({ limit: 2000 }).then(r => {
    if (r.count) console.log(`[restage] 已入队 ${r.count} 张缺合格 AI 重构的代表图 (${r.runId})`);
  }).catch(e => console.warn('[restage] 补跑入队失败:', e.message));
}, 1500);

const { applyGovernance } = require('./src/governance');
const { ProcessWorker, unfreezeVideos } = require('./src/process');
const { AiTaskWorker } = require('./src/ai-tasks');
applyGovernance(db);
console.log('[governance] 启动时首次治理完成');
const processWorker = new ProcessWorker(services);
processWorker.start(2000);
console.log('[process] 快捷处理 worker 已启动');
const aiTaskWorker = new AiTaskWorker(services);
aiTaskWorker.start(2000);
console.log('[ai-tasks] AI 任务 worker 已启动');

try {
  const tagGov = require('./src/tag-governance');
  tagGov.ensureGovernanceSchema(db);
  const { getEffectiveConfig } = require('./src/runtime-config');
  const nightHour = Number(getEffectiveConfig(db, 'retag_night_hour', process.env.ML_RETAG_NIGHT_HOUR || 2));
  const nightMin = Number(getEffectiveConfig(db, 'retag_night_minute', process.env.ML_RETAG_NIGHT_MINUTE || 0));
  tagGov.startNightRetagTimer(services, { hour: nightHour, minute: nightMin });
} catch (e) {
  console.warn('[retag-night] 启动失败:', e.message);
}

// 自动清理回收站超过 3 天（72小时）的过期文件
try {
  const assetsDelete = require('./src/assets-delete');
  assetsDelete.autoPurgeExpiredTrash(services);
  setInterval(() => assetsDelete.autoPurgeExpiredTrash(services), 12 * 3600 * 1000);
  console.log('[trash-clean] 回收站 3 天自动清理定时器已启动');
} catch (e) {
  console.warn('[trash-clean] 回收站清理定时器启动失败:', e.message);
}

// 内置轻量 NAS 异步归档，避免外部独立 shell 循环造成多进程写锁冲突
function syncOriginalsToNas(limit = 100) {
  try {
    const { nasAvailable, nasOriginalPath, findNasOriginal } = require('./src/nasstore');
    if (!nasAvailable()) return;
    const srcDir = path.join(config.dataDir, 'cache', 'originals');
    if (!fs.existsSync(srcDir)) return;
    const files = fs.readdirSync(srcDir).filter(f => /\.(jpe?g|png|webp|heic)$/i.test(f));
    let copied = 0;
    for (const f of files) {
      if (copied >= limit) break;
      const base = path.basename(f, path.extname(f));
      const fid = base.includes('_') && !base.startsWith('~') ? base.split('_')[0] : base;
      if (findNasOriginal(config, fid)) continue;
      const dest = nasOriginalPath(config, fid || base, f);
      try {
        fs.copyFileSync(path.join(srcDir, f), dest);
        copied++;
      } catch {}
    }
    if (copied > 0) {
      console.log(`[nas] 后台静默归档 ${copied} 张原图至 NAS 分片`);
    }
  } catch (e) {
    // 归档异常静默
  }
}

// 启动时先解冻一批视频进管线并执行一次轻量 NAS 归档
try {
  const n = unfreezeVideos(db, 50);
  if (n) console.log(`[process] 启动解冻视频 ${n} 个`);
} catch (e) {
  console.warn('[process] 视频解冻失败:', e.message);
}
setTimeout(() => syncOriginalsToNas(100), 5000);

setInterval(() => {
  const r = applyGovernance(db);
  if (r.live || r.revoked || r.frozen || r.frozenRevoked || r.revived) {
    console.log(`[governance] 定时治理: live=${r.live} revoked=${r.revoked} frozen=${r.frozen} frozen_revoked=${r.frozenRevoked} revived=${r.revived}`);
  }
  try {
    const n = unfreezeVideos(db, 50);
    if (n) console.log(`[process] 定时解冻视频 ${n} 个`);
  } catch (e) {}
  syncOriginalsToNas(100);
}, 3600_000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;

  try {
    // 1. API 路由 (支持 /api/ 前缀与标准网关根端点)
    if (p.startsWith('/api/') || p === '/api') {
      return await handleApi(services, req, res, '/api');
    }
    if (p.startsWith('/auth') || p.startsWith('/users') || p.startsWith('/gen/') || p.startsWith('/governance/') || p.startsWith('/lab/') || p.startsWith('/dict') || p.startsWith('/v1/') || (p.startsWith('/models') && !p.endsWith('.glb')) || p.startsWith('/runs') || p === '/health') {
      return await handleApi(services, req, res, '');
    }

    // 2. 静态托管 (web/dist)
    let fp = path.join(__dirname, 'web/dist', p === '/' ? 'index.html' : p);
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      fp = path.join(__dirname, 'web/dist/index.html');
    }

    if (fs.existsSync(fp)) {
      const ext = path.extname(fp).toLowerCase();
      const isHtml = ext === '.html';
      const isSw = p.includes('sw.js') || p.includes('registerSW') || p.includes('manifest');
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': (isHtml || isSw) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000'
      });
      return fs.createReadStream(fp).pipe(res);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端尚未构建（web/dist 不存在），请先在 web 目录执行 npm run build');
  } catch (e) {
    console.error('[server] 请求处理异常:', e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
  }
});

// ---- 拒收箱：3 天到期自动清理（删记录 + 删文件 + 指纹拉黑）----
let gatewayPurgeTimer = null;
function startGatewayPurgeTimer() {
  const run = () => {
    try {
      const { purgeExpired } = require('./src/reject-box');
      const r = purgeExpired(services, { limit: 500 });
      if (r.purged > 0) {
        console.log(`[gateway] 过期拒收件已清理: purged=${r.purged} scanned=${r.scanned}`);
      }
    } catch (e) {
      console.warn('[gateway] purge 失败:', e.message);
    }
  };
  run(); // 启动先跑一次
  gatewayPurgeTimer = setInterval(run, 60 * 60 * 1000); // 每小时
  if (gatewayPurgeTimer.unref) gatewayPurgeTimer.unref();
}

try {
  require('./src/gateway').ensureGatewayTables(db);
  startGatewayPurgeTimer();
} catch (e) {
  console.warn('[gateway] 初始化失败:', e.message);
}

server.listen(PORT, () => {
  console.log(`[material-library] 室内设计素材库服务已就绪: http://127.0.0.1:${PORT} (数据目录: ${dataDir})`);
  try {
    const { nasAvailable, nasMaterialDir } = require('./src/nasstore');
    const nas = nasMaterialDir(config);
    console.log(`[nas] 素材库目录: ${nas} 可写=${nasAvailable()}`);
  } catch (e) {
    console.warn('[nas] 检测失败', e.message);
  }
});

// ---- 30002 端口：全新桌面端工作台 (web-pro) 常驻服务 ----
const WEB_PRO_PORT = Number(process.env.WEB_PRO_PORT || 30002);
const webProDir = path.join(__dirname, 'web-pro/dist');

const webProServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;

  try {
    // 1. API 路由直通后端 handleApi（同进程极速处理）
    if (p.startsWith('/api/') || p === '/api') {
      return await handleApi(services, req, res, '/api');
    }
    if (p.startsWith('/auth') || p.startsWith('/users') || p.startsWith('/gen/') || p.startsWith('/governance/') || p.startsWith('/lab/') || p.startsWith('/dict') || p.startsWith('/v1/') || (p.startsWith('/models') && !p.endsWith('.glb')) || p.startsWith('/runs') || p === '/health') {
      return await handleApi(services, req, res, '');
    }

    // 2. 静态资源托管 web-pro/dist
    let fp = path.join(webProDir, p === '/' ? 'index.html' : p);
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      fp = path.join(webProDir, 'index.html');
    }

    if (fs.existsSync(fp)) {
      const ext = path.extname(fp).toLowerCase();
      const isHtml = ext === '.html';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': isHtml ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000',
      });
      return fs.createReadStream(fp).pipe(res);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端尚未构建（web-pro/dist 不存在）');
  } catch (e) {
    console.error('[web-pro] 请求处理异常:', e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
  }
});

webProServer.listen(WEB_PRO_PORT, '0.0.0.0', () => {
  console.log(`[web-pro] Material Studio Pro 桌面工作台常驻服务已就绪: http://127.0.0.1:${WEB_PRO_PORT}`);
});

process.on('SIGINT', () => {
  interpreter.stop();
  db.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  interpreter.stop();
  db.close();
  process.exit(0);
});
