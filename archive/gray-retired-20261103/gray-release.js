#!/usr/bin/env node
/**
 * 灰测通道一键发布（Windows 侧）
 *
 *   node scripts/gray-release.js              构建 dist-gray + 拉起 30000/30003
 *   node scripts/gray-release.js --build-only  只构建，不动进程
 *   node scripts/gray-release.js --no-build    只重启灰测进程（改了 server.js 时用）
 *   node scripts/gray-release.js --sync-data   从正式库重新拉一份数据库快照
 *   node scripts/gray-release.js --status      只看双通道状态
 *   node scripts/gray-release.js --stop        停掉灰测通道
 *
 * 端口铁律：灰测 API 30000 / 灰测 Web 30003；正式 API 30001 / 正式 Web 30002。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WEB_PRO = path.join(ROOT, 'web-pro');
const GRAY_API_PORT = Number(process.env.GRAY_API_PORT || 30000);
const GRAY_WEB_PORT = Number(process.env.GRAY_WEB_PORT || 30003);
const GRAY_DIST = process.env.GRAY_DIST_DIR || path.join(WEB_PRO, 'dist-gray');
const GRAY_DATA = process.env.ML_GRAY_DATA_DIR || path.join(os.homedir(), '.dsh-material-library-gray');
const PROD_DATA_UNC =
  process.env.ML_PROD_DATA_DIR_UNC || '\\\\wsl.localhost\\smu\\home\\lrp\\.dsh-material-library';
const LOG_DIR = path.join(GRAY_DATA, 'logs');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

// Windows 侧 better-sqlite3 垫片：正式目录里是 WSL 编译的 ELF，Windows 加载不了。
const WIN_SQLITE_SHIM = path.join(ROOT, 'scripts', 'shims', 'better-sqlite3-win.js').replace(/\\/g, '/');
const NODE_OPTIONS = `--require "${WIN_SQLITE_SHIM}"`;

function log(msg) { console.log(`[gray] ${msg}`); }
function warn(msg) { console.warn(`[gray] ${msg}`); }

/** 给 Windows 灰测进程准备一份 PE 版 better-sqlite3（已存在则跳过） */
function ensureWinSqlite() {
  const pkgDir = path.join(ROOT, 'node_modules', 'better-sqlite3-win');
  const bin = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
  if (fs.existsSync(bin)) return true;
  const backup = path.join(ROOT, '_backup_better_sqlite3_node22abi127_20261003_141806.node');
  if (!fs.existsSync(backup)) {
    warn('缺少 Windows 版 better-sqlite3 预编译文件，灰测后端无法启动');
    return false;
  }
  try {
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    for (const item of ['lib', 'package.json']) {
      const from = path.join(ROOT, 'node_modules', 'better-sqlite3', item);
      const to = path.join(pkgDir, item);
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.cpSync(from, to, { recursive: true });
    }
    fs.copyFileSync(backup, bin);
    log('已生成 node_modules/better-sqlite3-win（Windows 原生模块副本）');
    return true;
  } catch (e) {
    warn(`生成 Windows 版 better-sqlite3 失败：${e.message}`);
    return false;
  }
}

function portOpen(port, host = '127.0.0.1', timeout = 700) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => { try { s.destroy(); } catch (_) {} resolve(v); };
    s.setTimeout(timeout);
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

/** 找能加载 better-sqlite3 的 node：ABI 不匹配会 ERR_DLOPEN_FAILED */
function pickNode() {
  const probe = [
    "const D=require('better-sqlite3')",
    "const d=new D(':memory:')",
    "d.prepare('select 1 as x').get()",
  ].join(';');
  const wbBin = path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions');
  const candidates = [];
  try {
    for (const v of fs.readdirSync(wbBin)) {
      const p = path.join(wbBin, v, 'node.exe');
      if (fs.existsSync(p)) candidates.push(p);
    }
  } catch (_) {}
  candidates.push(process.execPath, 'C:\\Program Files\\nodejs\\node.exe');
  for (const exe of [...new Set(candidates)]) {
    try {
      execFileSync(exe, ['-e', probe], {
        cwd: ROOT,
        stdio: 'ignore',
        timeout: 20000,
        env: { ...process.env, NODE_OPTIONS },
      });
      return exe;
    } catch (_) {}
  }
  return '';
}

function readPid(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    if (!pid) return 0;
    process.kill(pid, 0);
    return pid;
  } catch (_) {
    return 0;
  }
}

function killPid(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (_) {
    try { process.kill(pid); } catch (_) {}
  }
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

/** 灰测数据目录：独立 DB 快照 + 共享正式缓存（符号链接，避免 52GB 复制） */
function prepareData({ sync = false } = {}) {
  ensureDir(GRAY_DATA);
  ensureDir(LOG_DIR);
  const dbPath = path.join(GRAY_DATA, 'material.db');
  const cachePath = path.join(GRAY_DATA, 'cache');

  // 1) 缓存目录：优先符号链接到正式缓存（只读共享，图片不会全裂）
  if (!fs.existsSync(cachePath)) {
    const prodCache = path.join(PROD_DATA_UNC, 'cache');
    try {
      fs.symlinkSync(prodCache, cachePath, 'dir');
      log(`缓存已链接到正式缓存：${prodCache}`);
    } catch (e) {
      warn(`缓存链接失败（${e.code || e.message}），灰测将看不到正式图片。可手动执行：mklink /D "${cachePath}" "${prodCache}"`);
    }
  }

  // 2) 数据库：首次或 --sync-data 时从正式库复制一份快照
  const needCopy = sync || !fs.existsSync(dbPath);
  if (!needCopy) return;
  const src = path.join(PROD_DATA_UNC, 'material.db');
  if (!fs.existsSync(src)) {
    warn(`找不到正式库 ${src}，灰测将以空库启动（数据独立，不影响正式）`);
    return;
  }
  const sizeMB = (fs.statSync(src).size / 1048576).toFixed(0);
  log(`复制正式库快照（${sizeMB}MB，只读一次，之后灰测数据独立）…`);
  const t0 = Date.now();
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const from = src + suffix;
      const to = dbPath + suffix;
      if (!fs.existsSync(from)) continue;
      // 先删旧的，避免残留 WAL 把新库带坏
      try { if (fs.existsSync(to)) fs.unlinkSync(to); } catch (_) {}
      fs.copyFileSync(from, to);
    }
    log(`数据库快照完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    warn(`数据库复制失败：${e.message}。灰测将以空库启动`);
    try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch (_) {}
  }
}

function startProc(exe, name, script, args, env) {
  const out = fs.openSync(path.join(LOG_DIR, `${name}.log`), 'a');
  const child = spawn(exe, [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  fs.writeFileSync(path.join(GRAY_DATA, `${name}.pid`), String(child.pid));
  return child.pid;
}

async function waitPort(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function build() {
  const vite = path.join(WEB_PRO, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) throw new Error(`找不到 vite：${vite}`);
  log(`构建灰测前端 → ${GRAY_DIST}`);
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [vite, 'build', '--outDir', GRAY_DIST, '--emptyOutDir'], {
      cwd: WEB_PRO,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    child.on('exit', resolve);
    child.on('error', () => resolve(-1));
  });
  if (code !== 0) throw new Error(`vite build 失败（exit=${code}）`);
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (_) {}
  fs.writeFileSync(
    path.join(GRAY_DIST, 'build-info.json'),
    JSON.stringify({ channel: 'gray', builtAt: Date.now(), commit, builder: `node ${process.version}` }, null, 2)
  );
  log(`构建完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

/**
 * 30003 必须能提供 HTTPS：剪辑台依赖 OPFS 与 WebCodecs，浏览器只在安全上下文里开放。
 * 证书直接复用正式端那套本地 CA（手机/电脑装过一次就通用），复制到 Windows 的
 * ~/.dsh-material-library/tls 即可被 web-pro/server.cjs 自动加载。
 */
function ensureTls() {
  const tlsDir = process.env.TLS_DIR || path.join(os.homedir(), '.dsh-material-library', 'tls');
  ensureDir(tlsDir);
  const crt = path.join(tlsDir, 'server.crt');
  const key = path.join(tlsDir, 'server.key');
  if (fs.existsSync(crt) && fs.existsSync(key)) return true;

  const prodTls = path.join(PROD_DATA_UNC, 'tls');
  let copied = 0;
  for (const f of ['ca.crt', 'ca.key', 'server.crt', 'server.key']) {
    const from = path.join(prodTls, f);
    const to = path.join(tlsDir, f);
    if (fs.existsSync(to) || !fs.existsSync(from)) continue;
    try { fs.copyFileSync(from, to); copied++; } catch (_) {}
  }
  if (fs.existsSync(crt) && fs.existsSync(key)) {
    log(`已复用正式端证书（${copied} 个文件 → ${tlsDir}），30003 将以 HTTPS 提供`);
    return true;
  }
  warn(
    '缺少 TLS 证书：30003 只能走 HTTP。局域网访问时浏览器不是安全上下文，' +
      '剪辑台的 OPFS / WebCodecs 会被禁用（页面顶部会出现橙色警告）。' +
      `请把正式端的 server.crt / server.key 复制到 ${tlsDir}`
  );
  return false;
}

async function start() {
  ensureWinSqlite();
  ensureTls();
  const node = pickNode();
  if (!node) {
    throw new Error('找不到能加载 better-sqlite3 的 Node（ABI 不匹配）。请检查 node_modules 与 Node 版本');
  }
  log(`服务端 Node：${node}`);

  // API 30000
  if (await portOpen(GRAY_API_PORT)) {
    log(`灰测 API ${GRAY_API_PORT} 已在监听，跳过启动`);
  } else {
    const pid = startProc(node, 'api', path.join(ROOT, 'server.js'), [], {
      ML_PORT: String(GRAY_API_PORT),
      ML_DATA_DIR: GRAY_DATA,
      ML_GRAY_DATA_DIR: GRAY_DATA,
      APP_CHANNEL: 'gray',
      ML_WATCH_RESTART: '0',
      NODE_OPTIONS,
    });
    const ok = await waitPort(GRAY_API_PORT, 45000);
    if (!ok) throw new Error(`灰测 API ${GRAY_API_PORT} 启动超时，见 ${path.join(LOG_DIR, 'api.log')}`);
    log(`灰测 API 已就绪：http://127.0.0.1:${GRAY_API_PORT}（pid ${pid}）`);
  }

  // Web 30003
  if (await portOpen(GRAY_WEB_PORT)) {
    log(`灰测 Web ${GRAY_WEB_PORT} 已在监听，跳过启动`);
  } else {
    const pid = startProc(node, 'web', path.join(WEB_PRO, 'server.cjs'), [], {
      WEB_PRO_PORT: String(GRAY_WEB_PORT),
      WEB_PRO_DIST: 'dist-gray',
      APP_CHANNEL: 'gray',
      API_TARGET: `http://127.0.0.1:${GRAY_API_PORT}`,
      EDITOR_TARGET: process.env.EDITOR_TARGET || 'http://127.0.0.1:3010',
    });
    const ok = await waitPort(GRAY_WEB_PORT, 20000);
    if (!ok) throw new Error(`灰测 Web ${GRAY_WEB_PORT} 启动超时，见 ${path.join(LOG_DIR, 'web.log')}`);
    log(`灰测 Web 已就绪：http://127.0.0.1:${GRAY_WEB_PORT}（pid ${pid}）`);
  }
}

function stop() {
  for (const name of ['web', 'api']) {
    const file = path.join(GRAY_DATA, `${name}.pid`);
    const pid = readPid(file);
    if (pid) {
      killPid(pid);
      log(`已停止灰测 ${name}（pid ${pid}）`);
    } else {
      log(`灰测 ${name} 未在运行`);
    }
    try { fs.unlinkSync(file); } catch (_) {}
  }
}

async function status() {
  const rows = [
    ['灰测 API', GRAY_API_PORT],
    ['灰测 Web', GRAY_WEB_PORT],
    ['正式 API', 30001],
    ['正式 Web', 30002],
  ];
  for (const [label, port] of rows) {
    console.log(`${label.padEnd(8)} ${String(port).padEnd(6)} ${(await portOpen(port)) ? 'OPEN' : 'closed'}`);
  }
  const info = path.join(GRAY_DIST, 'build-info.json');
  if (fs.existsSync(info)) {
    const d = JSON.parse(fs.readFileSync(info, 'utf8'));
    console.log(`灰测产物 ${new Date(d.builtAt).toLocaleString()} · ${d.commit || 'n/a'}`);
  } else {
    console.log('灰测产物 尚未构建');
  }
}

(async () => {
  try {
    if (has('--status')) return await status();
    if (has('--stop')) return stop();
    prepareData({ sync: has('--sync-data') });
    if (!has('--no-build')) await build();
    if (!has('--build-only')) await start();
    if (!has('--build-only') && !has('--no-build')) {
      console.log('');
      log(`灰测入口：http://127.0.0.1:${GRAY_WEB_PORT}/  （正式：http://127.0.0.1:30002/）`);
      log('验证通过后，在灰测页面的「系统设置」里点「发布到正式版」即可更新 30002/30001。');
    }
  } catch (e) {
    warn(`失败：${e.message}`);
    process.exitCode = 1;
  }
})();
