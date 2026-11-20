/**
 * 服务端全量预热（**必须跑在 WSL 侧**）
 *
 * 为什么必须 WSL：
 *   真实 dataDir = ~/.dsh-material-library（ext4），仓库里的 data/ 是 Windows 侧
 *   陈旧副本。在 Windows 侧预热等于预热了一个没人读的目录。
 *   另外 node_modules 在 /mnt/c 共享目录，内含 Linux-ELF 原生模块，
 *   本脚本要用 sharp 派生衍生图，只能用 WSL 的 node 跑。
 *
 * 预热什么：
 *   1. grid 档（256px）衍生图 → dataDir/cache/grid/*.jpg
 *      App 列表走的就是这一档，服务端首次请求时才现派生（吃 CPU）。
 *   2. preview 档（1280px）衍生图 → dataDir/cache/preview/*.jpg
 *   3. menu-tree / studio schema / catalog 的进程内缓存：走一次 HTTP 即可命中。
 *
 * 用法：
 *   node scripts/prewarm.js [--limit=200] [--concurrency=6] [--tiers=grid,preview]
 *   ML_PREWARM_USER / ML_PREWARM_PASS 可覆盖登录账号
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const HOST = process.env.ML_PREWARM_HOST || '127.0.0.1';
const PORT = process.env.ML_PORT || '30001';
const BASE = `http://${HOST}:${PORT}`;

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
}

const LIMIT = Number(arg('limit', 300));
const CONCURRENCY = Number(arg('concurrency', 6));
const TIERS = String(arg('tiers', 'grid,preview')).split(',').map((s) => s.trim()).filter(Boolean);
const PAGE_SIZE = 100;

function readCredentials() {
  const file = path.join(DATA_DIR, 'bootstrap-credentials.txt');
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const line = txt.split(/\r?\n/).find((l) => l.trim().startsWith('admin:'));
    if (!line) return null;
    const m = line.match(/admin:\s*(\S+)/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

async function api(pathname, { method = 'GET', token = '', body = null } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + pathname, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

async function login() {
  const user = process.env.ML_PREWARM_USER || 'admin';
  const pass = process.env.ML_PREWARM_PASS || readCredentials();
  if (!pass) throw new Error('拿不到 admin 口令：请设 ML_PREWARM_PASS');
  const r = await api('/api/viewer/auth/login', { method: 'POST', body: { username: user, password: pass } });
  const token = r.json && r.json.data && r.json.data.token;
  if (!token) throw new Error('登录失败: ' + (r.json && (r.json.error || r.text.slice(0, 120))));
  return token;
}

async function listAssets(token) {
  const fids = [];
  let page = 1;
  while (fids.length < LIMIT) {
    const r = await api(`/api/viewer/assets?page=${page}&pageSize=${PAGE_SIZE}&media_type=image&sort=latest`, { token });
    const items = (r.json && r.json.data && r.json.data.items) || [];
    if (!items.length) break;
    for (const it of items) {
      if (it && it.fid) fids.push(it.fid);
      if (fids.length >= LIMIT) break;
    }
    if (items.length < PAGE_SIZE) break;
    page++;
  }
  return fids;
}

/** 限流并发 */
async function runPool(items, worker, concurrency) {
  let cursor = 0;
  const runners = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    runners.push((async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        try { await worker(items[idx], idx); } catch (e) { /* 忽略单个失败 */ }
      }
    })());
  }
  await Promise.all(runners);
}

async function warmDerivatives(token, fids) {
  const stats = { grid: 0, preview: 0, failed: 0 };
  const t0 = Date.now();
  await runPool(fids, async (fid) => {
    for (const tier of TIERS) {
      const r = await api(`/api/viewer/assets/${encodeURIComponent(fid)}/image?tier=${tier}&local=1`, { token });
      if (r.status === 200) stats[tier] = (stats[tier] || 0) + 1;
      else stats.failed++;
    }
  }, CONCURRENCY);
  stats.elapsedSec = Math.round((Date.now() - t0) / 100) / 10;
  return stats;
}

async function warmJsonCaches(token) {
  const targets = ['/api/dict/menu-tree', '/api/studio/schema', '/api/studio/catalog'];
  const out = {};
  for (const t of targets) {
    const r = await api(t, { token });
    out[t] = { status: r.status, bytes: r.text.length };
  }
  return out;
}

function countFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
  } catch (e) {
    return 0;
  }
}

(async () => {
  console.log('[prewarm] 服务端', BASE, 'dataDir', DATA_DIR);
  const token = await login();
  console.log('[prewarm] 登录成功');

  const fids = await listAssets(token);
  console.log(`[prewarm] 待预热素材 ${fids.length} 张，档位 ${TIERS.join('/')}`);

  const stats = await warmDerivatives(token, fids);
  console.log('[prewarm] 衍生图完成:', JSON.stringify(stats));

  const json = await warmJsonCaches(token);
  console.log('[prewarm] JSON 契约缓存:', JSON.stringify(json));

  console.log('[prewarm] cache/grid 文件数:', countFiles(path.join(DATA_DIR, 'cache', 'grid')));
  console.log('[prewarm] cache/preview 文件数:', countFiles(path.join(DATA_DIR, 'cache', 'preview')));
  console.log('[prewarm] 完成');
  process.exit(0);
})().catch((e) => {
  console.error('[prewarm] 失败:', e && (e.stack || e.message || e));
  process.exit(1);
});
