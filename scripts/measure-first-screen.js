/* App 首屏链路真实耗时实测（必须在 WSL 侧跑：dataDir 与原生模块都在那边）
 * 用法: node scripts/measure-first-screen.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const BASE = process.env.ML_BASE || 'http://127.0.0.1:30001';
const API = `${BASE}/api/viewer`;

function readAdminPass() {
  if (process.env.ML_PREWARM_PASS) return process.env.ML_PREWARM_PASS;
  try {
    const txt = fs.readFileSync(path.join(DATA_DIR, 'bootstrap-credentials.txt'), 'utf8');
    const m = txt.match(/admin:\s*(\S+)/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

async function call(label, pathname, { method = 'GET', token = '', body = null, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const t0 = Date.now();
  const res = await fetch(API + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const payload = raw ? await res.arrayBuffer() : await res.text();
  const ms = Date.now() - t0;
  const bytes = payload.byteLength || 0;
  const gz = res.headers.get('content-encoding') || '-';
  console.log(`${String(ms).padStart(6)}ms ${String(res.status).padStart(4)} ${String(bytes).padStart(9)}B gzip=${gz.padEnd(4)} ${label}`);
  return { ms, status: res.status, json: raw ? null : JSON.parse(payload || '{}'), bytes };
}

async function main() {
  const pass = readAdminPass();
  if (!pass) throw new Error('拿不到 admin 口令');
  const lr = await call('登录', '/auth/login', { method: 'POST', body: { username: 'admin', password: pass } });
  const token = lr.json && lr.json.data && lr.json.data.token;
  if (!token) throw new Error('登录失败: ' + JSON.stringify(lr.json).slice(0, 200));
  console.log(`\n${BASE}  dataDir=${DATA_DIR}`);

  const fids = [];
  for (const round of [1, 2]) {
    console.log(`\n── 第 ${round} 轮（第 2 轮验证进程内缓存是否常驻）──`);
    const list = await call('素材列表 page1/20', `/assets?page=1&pageSize=20&media_type=image&sort=latest`, { token });
    const items = (list.json && list.json.data && list.json.data.items) || [];
    if (round === 1) fids.push(...items.map((i) => i.fid).filter(Boolean));
    await call('素材列表 page1/50', `/assets?page=1&pageSize=50&media_type=image&sort=latest`, { token });
    await call('生成参数选项', '/gen/options', { token });
    await call('工坊模型契约', '/studio/catalog', { token });
    await call('能力总览', '/lab/capabilities', { token });
    if (items.length) {
      const fo = (list.json.data && list.json.data.filterOptions) || {};
      console.log(`       └ 服务端下发筛选维度 ${Object.keys(fo).length} 个`);
    }
  }

  if (fids.length) {
    console.log(`\n── grid 缩略图并发取 ${fids.length} 张（首屏真正要落地的字节）──`);
    const t0 = Date.now();
    await Promise.all(fids.map((fid) => call('', `/assets/${encodeURIComponent(fid)}/image?tier=grid`, { token, raw: true })));
    console.log(`       └ ${fids.length} 张合计 ${Date.now() - t0}ms`);
  }
}

main().catch((e) => { console.error('实测失败:', e.message); process.exit(1); });
