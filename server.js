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

// ── 双通道（A/B）──────────────────────────────────────────────────────────────
// 正式：30001 + 30002（WSL，watchdog 守护）；灰测：30000 + 30003（Windows）。
// 灰测实例只做「读写 API + 前端联调」，不跑后台 worker：否则同一个正式库快照会被
// 两个进程重复消费 AI 任务/治理定时器，灰测机器白烧 CPU 还会互相抢写。
const APP_CHANNEL = String(process.env.APP_CHANNEL || '').toLowerCase() === 'gray' ? 'gray' : 'prod';
const IS_GRAY = APP_CHANNEL === 'gray';
const DISABLE_WORKERS = IS_GRAY || String(process.env.ML_DISABLE_WORKERS || '') === '1';

const config = {
  cliPath: resolveQuarkCli(process.env.QUARK_CLI_PATH),
  rootFid: process.env.QUARK_ROOT_FID || '225f01205b7942b1a75bb0c2d7a0565a',
  systemFid: process.env.QUARK_SYSTEM_FID || 'a082098178f74add99cbf6de2c4caa8a',
  dataDir,
  channel: APP_CHANNEL,
  // NAS 素材库：\\<NAS_HOST>\文件服务\ai_video\material → WSL /mnt/synology/material
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
if (!DISABLE_WORKERS) interpreter.startWorkerLoop(2000);
// 重启不能无条件重跑补缺：一次批次是几十张图生图，反复重启会把本地生图服务打满显存，
// 连带把常驻 GPU 的音频模型挤到 OOM。默认 6 小时内只自动补一次，可用
// ML_RESTAGE_BACKFILL_ON_START=0 关掉，或调 ML_RESTAGE_BACKFILL_COOLDOWN_MS。
const RESTAGE_BACKFILL_COOLDOWN_MS = Number(process.env.ML_RESTAGE_BACKFILL_COOLDOWN_MS) || 6 * 3600 * 1000;
function maybeQueueRestageBackfill() {
  if (process.env.ML_RESTAGE_BACKFILL_ON_START === '0') return;
  const last = Number(db.prepare("SELECT value FROM kv WHERE key='restage_backfill_auto_at'").get()?.value || 0);
  if (last && Date.now() - last < RESTAGE_BACKFILL_COOLDOWN_MS) {
    console.log(`[restage] 跳过启动补跑：${Math.round((Date.now() - last) / 60000)} 分钟前刚跑过`);
    return;
  }
  db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES('restage_backfill_auto_at',?)").run(String(Date.now()));
  interpreter.queueMissingRestage({ limit: 2000 }).then(r => {
    if (r.count) console.log(`[restage] 已入队 ${r.count} 张缺合格 AI 重构的代表图 (${r.runId})`);
  }).catch(e => console.warn('[restage] 补跑入队失败:', e.message));
}
setTimeout(() => {
  if (!DISABLE_WORKERS) maybeQueueRestageBackfill();
}, 1500);

const { applyGovernance } = require('./src/governance');
const { ProcessWorker, unfreezeVideos } = require('./src/process');
const { AiTaskWorker } = require('./src/ai-tasks');
applyGovernance(db);
console.log('[governance] 启动时首次治理完成');
if (!DISABLE_WORKERS) {
  const processWorker = new ProcessWorker(services);
  processWorker.start(2000);
  console.log('[process] 快捷处理 worker 已启动');
  const aiTaskWorker = new AiTaskWorker(services);
  aiTaskWorker.start(2000);
  console.log('[ai-tasks] AI 任务 worker 已启动');
} else {
  console.log(`[workers] 后台 worker 已停用（channel=${APP_CHANNEL}）：灰测实例只做读写 API，不消费任务队列`);
}

if (!DISABLE_WORKERS) {
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
if (!DISABLE_WORKERS) {
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
}

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
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4'
};

function serveStaticFile(req, res, fp) {
  const ext = path.extname(fp).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const isHtml = ext === '.html';
  const isMedia = ext === '.mp4' || ext === '.webm' || ext === '.mov' || ext === '.mp3' || ext === '.wav' || ext === '.m4a';
  if (!isMedia) {
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': isHtml ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000',
    });
    return fs.createReadStream(fp).pipe(res);
  }
  const total = fs.statSync(fp).size;
  const range = req.headers.range;
  if (range) {
    const matched = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (matched) {
      let start = matched[1] === '' ? null : parseInt(matched[1], 10);
      let end = matched[2] === '' ? null : parseInt(matched[2], 10);
      if (start == null && end != null) {
        start = Math.max(0, total - end);
        end = total - 1;
      } else {
        if (start == null) start = 0;
        if (end == null || end >= total) end = total - 1;
      }
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < total) {
        res.writeHead(206, {
          'Content-Type': mime,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
        });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(fp, { start, end }).pipe(res);
      }
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
  }
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': total,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(fp).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;

  try {
    // 0. 剪辑接口（LOGIC-001）：/editor-api 原本只挂在 30002 内嵌服务上，
    //    导致 web-pro/server.cjs 把 /editor-api 反代到 30001 时落入 SPA fallback
    //    返回 HTML。这里在 30001 主实例同样挂载，剪辑链路不再依赖端口归属。
    if (p === '/editor-api' || p.startsWith('/editor-api/')) {
      const handled = await require('./src/clip-api').handleClipApi(services, req, res);
      if (handled) return;
      return require('./src/editor-projects').handleEditorApi(services, req, res);
    }
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
  if (!DISABLE_WORKERS) startGatewayPurgeTimer();
} catch (e) {
  console.warn('[gateway] 初始化失败:', e.message);
}

// WebSocket 推送通道（App 长连接）：/api/push?token=...
try {
  require('./src/ws-server').attachWebSocketServer(server, services);
} catch (e) {
  console.warn('[ws] 推送通道启动失败:', e.message);
}

// 语音输入流式通道：/api/asr/stream?token=...（转发到本机 FunASR/sherpa-onnx 服务）
try {
  require('./src/asr').attachAsrWebSocket(server, services);
} catch (e) {
  console.warn('[asr] 语音通道启动失败:', e.message);
}

// ---- 发布自重启：只用文件标记兜底，HTTP 重启走 /api/system/restart ----
// 为什么需要它：Windows 侧被安全策略禁止调用 wsl.exe，没法从灰测通道重启正式服务。
// 正式端自己盯着数据目录里的 restart.request，一旦发现比进程启动时间新就退出，
// 由 scripts/watchdog.sh 在 3 秒内重新拉起，从而加载到最新代码。
const SELF_START_AT = Date.now();
if (String(process.env.ML_WATCH_RESTART || '1') !== '0' && !IS_GRAY) {
  const restartFlag = path.join(dataDir, 'restart.request');
  const wdPidFile = path.join(dataDir, 'watchdog.pid');
  let handled = false;
  const watcher = setInterval(() => {
    if (handled) return;
    try {
      const st = fs.statSync(restartFlag);
      if (st.mtimeMs <= SELF_START_AT) return;
      handled = true;
      fs.unlinkSync(restartFlag);
      let wdAlive = false;
      try {
        const wdPid = Number(fs.readFileSync(wdPidFile, 'utf8').trim());
        if (wdPid) { process.kill(wdPid, 0); wdAlive = true; }
      } catch (_) {}
      console.log(`[restart] 收到发布重启标记（watchdog ${wdAlive ? '在线' : '未检测到'}），退出以加载新代码`);
      setTimeout(() => {
        try { db.close(); } catch (_) {}
        process.exit(0);
      }, 300);
    } catch (_) {}
  }, 3000);
  if (watcher.unref) watcher.unref();
}

server.listen(PORT, () => {
  console.log(`[material-library] 室内设计素材库服务已就绪: http://127.0.0.1:${PORT} (数据目录: ${dataDir})`);  try {
    const { nasAvailable, nasMaterialDir } = require('./src/nasstore');
    const nas = nasMaterialDir(config);
    console.log(`[nas] 素材库目录: ${nas} 可写=${nasAvailable()}`);
  } catch (e) {
    console.warn('[nas] 检测失败', e.message);
  }
  try {
    const oss = require('./src/oss');
    if (oss.isOssEnabled(services)) {
      const sweep = () => oss.sweepChatTemp(services)
        .then((r) => { if (r.deleted) console.log(`[oss] 已清理 ${r.deleted} 个过期对话临时图片`); })
        .catch((e) => console.warn('[oss] 临时图片清扫失败:', e.message));
      sweep();
      setInterval(sweep, 6 * 60 * 60 * 1000).unref();
    }
  } catch (e) {
    console.warn('[oss] 初始化清扫失败:', e.message);
  }
});

// ---- 30002 端口：web-pro 桌面工作台 ----
// LOGIC-001：30002 的常驻归属改为 web-pro/server.cjs（service-hub 的 web-h5 服务，
// 带完整 /editor 反代）。这里仅作为旧单进程部署模式的兜底，默认不启动；
// 显式设置 EMBED_WEB_PRO=1 才启用，且监听冲突时只告警不崩溃。
const EMBED_WEB_PRO = String(process.env.EMBED_WEB_PRO || '') === '1';
const WEB_PRO_PORT = Number(process.env.WEB_PRO_PORT || 30002);
const webProDir = path.join(__dirname, 'web-pro/dist');

if (EMBED_WEB_PRO) {
const webProServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;

  try {
    if (p === '/editor-api' || p.startsWith('/editor-api/')) {
      // 新增接口优先：快照 / 资源包 / AI 任务 / 剪辑素材视图。
      // 未命中再交回原来的工程读写与导出接口，避免动到已经稳定的链路。
      const handled = await require('./src/clip-api').handleClipApi(services, req, res);
      if (handled) return;
      return require('./src/editor-projects').handleEditorApi(services, req, res);
    }
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

    if (fs.existsSync(fp)) return serveStaticFile(req, res, fp);

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

// 内嵌模式下 30002 也提供同一条推送通道
require('./src/ws-server').attachWebSocketServer(webProServer, services);

webProServer.listen(WEB_PRO_PORT, '0.0.0.0', () => {
  console.log(`[web-pro] Material Studio Pro 桌面工作台常驻服务已就绪: http://127.0.0.1:${WEB_PRO_PORT}`);
});
// LOGIC-001：30002 已归 web-pro/server.cjs 常驻，内嵌模式与它撞端口时只告警，绝不让主服务崩溃。
webProServer.on('error', (e) => {
  console.warn(`[web-pro] 内嵌工作台监听 ${WEB_PRO_PORT} 失败（${e.code}）。30002 应由 web-pro/server.cjs 常驻提供；如需单进程模式请先停掉外部 web-h5。`);
});
} else {
  console.log('[web-pro] 内嵌工作台未启用（EMBED_WEB_PRO 未设置）：30002 由 web-pro/server.cjs 常驻提供');
}

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
