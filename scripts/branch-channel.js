#!/usr/bin/env node
/**
 * 分支通道管理（master / test 并行运行）
 *
 * 背景：项目原来是「同一份工作树 + 两种进程」的双通道（30001/30002 正式、30000/30003 灰测），
 * 两个通道的**代码是同一份**，只能验证"改动"，不能验证"分支"。这个脚本用 git worktree
 * 给每个分支一份独立工作树，于是 master 和 test 可以各自构建、各自起进程、互不干扰。
 *
 *   node scripts/branch-channel.js                 查看所有通道状态（= --status）
 *   node scripts/branch-channel.js --status [--json]
 *   node scripts/branch-channel.js --prepare test   创建/修复 test 工作树（缺 worktree 时先跑这个）
 *   node scripts/branch-channel.js --start test     构建 test 产物并拉起 30000/30003
 *   node scripts/branch-channel.js --start test --no-build    只重启进程（改了 server.js）
 *   node scripts/branch-channel.js --build test     只构建，不动进程
 *   node scripts/branch-channel.js --stop test      停掉 test 通道
 *   node scripts/branch-channel.js --restart test   停 + 起（不重新构建）
 *   node scripts/branch-channel.js --sync-data test 从正式库重拉一份数据库快照
 *   node scripts/branch-channel.js --diff test      看 test 相对 master 的差异 + 冲突预演
 *   node scripts/branch-channel.js --promote test   test → master 合并 + 重建正式产物 + 经 start.sh 同时重启 30001/30002
 *
 * 推荐统一入口：node scripts/mls-ctl.js status|start|stop|restart|logs|promote（零依赖跨平台）
 *
 * 端口铁律：
 *   prod  master  正式 API 30001 / 正式 Web 30002   （WSL 里跑，本脚本只读状态、不启停）
 *   test  test    测试 API 30000 / 测试 Web 30003   （Windows 里跑，本脚本全权管理）
 *   gray  遗留    旧灰测通道与 test 抢同一组端口，二者互斥，不要同时开
 *
 * 数据隔离：每个通道独立 ML_DATA_DIR，绝不共用 material.db（SQLite 多进程写会锁库/写坏）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flagValue = (f, def) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const PROD_DATA_UNC =
  process.env.ML_PROD_DATA_DIR_UNC || '\\\\wsl.localhost\\smu\\home\\lrp\\.dsh-material-library';

/**
 * 通道表。加新分支只需在这里加一条：branch 指向分支名，端口另开一组，
 * worktree 用默认推导路径（<项目名>-<分支名>）或显式指定。
 */
const LANES = {
  prod: {
    key: 'prod',
    label: '正式',
    branch: 'master',
    apiPort: 30001,
    webPort: 30002,
    dataDir: path.join(HOME, '.dsh-material-library'),
    worktree: ROOT,
    managed: false, // 由 WSL start.sh 管理，本脚本不启停
    distDir: path.join(ROOT, 'web-pro', 'dist'),
  },
  test: {
    key: 'test',
    label: '分支测试',
    branch: 'test',
    apiPort: Number(process.env.ML_TEST_API_PORT || 30000),
    webPort: Number(process.env.ML_TEST_WEB_PORT || 30003),
    dataDir: process.env.ML_TEST_DATA_DIR || path.join(HOME, '.dsh-material-library-test'),
    worktree:
      process.env.ML_TEST_WORKTREE || path.join(path.dirname(ROOT), path.basename(ROOT) + '-test'),
    managed: true,
    distDir: null, // 启动时按 worktree 推导
  },
  gray: {
    key: 'gray',
    label: '旧灰测',
    branch: null, // 跟随主工作树当前分支
    apiPort: 30000,
    webPort: 30003,
    dataDir: path.join(HOME, '.dsh-material-library-gray'),
    worktree: ROOT,
    managed: true,
    legacy: true,
    distDir: path.join(ROOT, 'web-pro', 'dist-gray'),
  },
};

LANES.test.distDir = path.join(LANES.test.worktree, 'web-pro', 'dist');

/** Windows 侧 better-sqlite3 垫片：必须用主仓的那份，worktree 里没有 better-sqlite3-win */
const WIN_SQLITE_SHIM = path.join(ROOT, 'scripts', 'shims', 'better-sqlite3-win.js').replace(/\\/g, '/');
const NODE_OPTIONS = `--require "${WIN_SQLITE_SHIM}"`;

function log(msg) { console.log(`[channel] ${msg}`); }
function warn(msg) { console.warn(`[channel] ${msg}`); }
function fail(msg) { throw new Error(msg); }

function git(args, cwd = ROOT) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}
function gitSafe(args, cwd = ROOT) {
  try { return git(args, cwd); } catch (_) { return ''; }
}
/** 允许非 0 退出码但保留 stdout：merge-tree 有冲突时仍会把冲突清单打到 stdout */
function gitOut(args, cwd = ROOT) {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch (e) {
    const out = (e.stdout && e.stdout.toString()) || '';
    return { ok: false, out: out.trim() };
  }
}
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

/** 解析 git worktree 列表 → [{ path, branch, head }] */
function listWorktrees() {
  const raw = gitSafe(['worktree', 'list', '--porcelain']);
  const out = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const item = { path: '', branch: '', head: '' };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) item.path = line.slice(9).replace(/\//g, path.sep);
      else if (line.startsWith('branch ')) item.branch = line.slice(7).replace('refs/heads/', '');
      else if (line.startsWith('HEAD ')) item.head = line.slice(5);
    }
    if (item.path) out.push(item);
  }
  return out;
}

function laneWorktree(lane) {
  const wts = listWorktrees();
  const found = wts.find((w) => path.resolve(w.path).toLowerCase() === path.resolve(lane.worktree).toLowerCase());
  return found || null;
}

/** 通道实际生效的分支名（gray 跟随主工作树） */
function laneBranch(lane) {
  const wt = laneWorktree(lane);
  if (wt && wt.branch) return wt.branch;
  return lane.branch || gitSafe(['rev-parse', '--abbrev-ref', 'HEAD']);
}

function gitInfo(cwd) {
  const commit = gitSafe(['rev-parse', '--short', 'HEAD'], cwd);
  const subject = gitSafe(['log', '-1', '--format=%s'], cwd);
  const when = gitSafe(['log', '-1', '--format=%ci'], cwd);
  const dirty = gitSafe(['status', '--porcelain'], cwd).split(/\r?\n/).filter(Boolean).length;
  return { commit, subject, when, dirty };
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

async function waitPort(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
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

/** 找能加载 better-sqlite3 的 node（ABI 不匹配会 ERR_DLOPEN_FAILED） */
function pickNode() {
  const probe = [
    "const D=require('better-sqlite3')",
    "const d=new D(':memory:')",
    "d.prepare('select 1 as x').get()",
  ].join(';');
  const wbBin = path.join(HOME, '.workbuddy', 'binaries', 'node', 'versions');
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

/** 给 Windows 进程准备 PE 版 better-sqlite3（已存在则跳过） */
function ensureWinSqlite() {
  const pkgDir = path.join(ROOT, 'node_modules', 'better-sqlite3-win');
  const bin = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
  if (fs.existsSync(bin)) return true;
  const backup = path.join(ROOT, '_backup_better_sqlite3_node22abi127_20261003_141806.node');
  if (!fs.existsSync(backup)) {
    warn('缺少 Windows 版 better-sqlite3 预编译文件，测试后端无法启动');
    return false;
  }
  try {
    ensureDir(path.dirname(bin));
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

/** 30003 必须能提供 HTTPS：剪辑台依赖 OPFS/WebCodecs，只在安全上下文开放 */
function ensureTls() {
  const tlsDir = process.env.TLS_DIR || path.join(HOME, '.dsh-material-library', 'tls');
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
    log(`已复用正式端证书（${copied} 个文件 → ${tlsDir}），${LANES.test.webPort} 以 HTTPS 提供`);
    return true;
  }
  warn(`缺少 TLS 证书：${LANES.test.webPort} 只能走 HTTP，剪辑台 OPFS/WebCodecs 会被浏览器禁用`);
  return false;
}

/**
 * 通道数据目录：独立 material.db + 共享正式缓存（符号链接，避免拷几十 GB）。
 * 只在首次或 --sync-data 时从正式库拉快照。
 */
function prepareData(lane, { sync = false } = {}) {
  ensureDir(lane.dataDir);
  ensureDir(path.join(lane.dataDir, 'logs'));
  const dbPath = path.join(lane.dataDir, 'material.db');
  const cachePath = path.join(lane.dataDir, 'cache');

  if (!fs.existsSync(cachePath)) {
    const prodCache = path.join(PROD_DATA_UNC, 'cache');
    try {
      fs.symlinkSync(prodCache, cachePath, 'dir');
      log(`缓存已链接到正式缓存：${prodCache}`);
    } catch (e) {
      warn(`缓存链接失败（${e.code || e.message}），测试通道看不到正式图片`);
    }
  }

  if (!sync && fs.existsSync(dbPath)) return;
  const src = path.join(PROD_DATA_UNC, 'material.db');
  if (!fs.existsSync(src)) {
    warn(`找不到正式库 ${src}，测试通道将以空库启动（数据独立，不影响正式）`);
    return;
  }
  const sizeMB = (fs.statSync(src).size / 1048576).toFixed(0);
  log(`复制正式库快照（${sizeMB}MB，只读一次，之后本通道数据独立）…`);
  const t0 = Date.now();
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const from = src + suffix;
      const to = dbPath + suffix;
      if (!fs.existsSync(from)) continue;
      try { if (fs.existsSync(to)) fs.unlinkSync(to); } catch (_) {}
      fs.copyFileSync(from, to);
    }
    log(`数据库快照完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    warn(`数据库复制失败：${e.message}。测试通道将以空库启动`);
    try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch (_) {}
  }
}

/**
 * 准备/修复通道工作树：git worktree + node_modules 软链 + .env。
 * worktree 放在项目同级目录而不是项目内，是为了避开 Windows 的 260 字符路径限制。
 */
function prepare(lane) {
  if (!lane.branch) fail(`${lane.key} 没有独立分支，无需准备`);
  const wtPath = lane.worktree;
  let wt = laneWorktree(lane);

  if (!wt) {
    if (fs.existsSync(wtPath) && fs.readdirSync(wtPath).length) {
      fail(`目录已存在且非空，但不是本仓库的 worktree：${wtPath}\n       请先移走或删除它，再重试`);
    }
    const hasBranch = gitSafe(['rev-parse', '--verify', '--quiet', `refs/heads/${lane.branch}`]);
    const args = hasBranch
      ? ['-c', 'core.longpaths=true', 'worktree', 'add', wtPath, lane.branch]
      : ['-c', 'core.longpaths=true', 'worktree', 'add', '-b', lane.branch, wtPath, laneBranch(LANES.prod)];
    log(`创建 worktree：${wtPath}（分支 ${lane.branch}）`);
    try {
      execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
      fail(`worktree 创建失败：${e.message}`);
    }
    wt = laneWorktree(lane);
    if (!wt) fail('worktree 创建后仍未在 git worktree 列表中看到，请手动检查');
  } else {
    log(`worktree 已存在：${wt.path}（分支 ${wt.branch}）`);
  }

  // 依赖：软链到主仓，避免几十万文件的 node_modules 复制（也保证依赖版本完全一致）
  for (const rel of ['node_modules', path.join('web-pro', 'node_modules')]) {
    const linkPath = path.join(wtPath, rel);
    const target = path.join(ROOT, rel);
    if (fs.existsSync(linkPath)) continue;
    if (!fs.existsSync(target)) { warn(`主仓缺少 ${rel}，跳过链接`); continue; }
    try {
      ensureDir(path.dirname(linkPath));
      fs.symlinkSync(target, linkPath, 'junction');
      log(`已链接 ${rel} → 主仓`);
    } catch (e) {
      warn(`链接 ${rel} 失败（${e.code || e.message}）：构建/启动可能失败`);
    }
  }

  // 配置：.env 被 gitignore，worktree 里不会有，必须带过去
  const envFrom = path.join(ROOT, '.env');
  const envTo = path.join(wtPath, '.env');
  if (fs.existsSync(envFrom) && !fs.existsSync(envTo)) {
    try { fs.copyFileSync(envFrom, envTo); log('已复制 .env 到 worktree'); } catch (e) {
      warn(`复制 .env 失败（${e.message}）：AI / OSS 等密钥将缺失`);
    }
  }

  const info = gitInfo(wtPath);
  log(`准备完成：${lane.branch} @ ${info.commit}（未提交 ${info.dirty} 项）`);
}

function buildInfoOf(distDir) {
  const f = path.join(distDir, 'build-info.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; }
}

async function build(lane) {
  const wtPath = lane.worktree;
  if (!fs.existsSync(wtPath)) fail(`工作树不存在：${wtPath}，先执行 --prepare ${lane.key}`);
  const webPro = path.join(wtPath, 'web-pro');
  const vite = path.join(webPro, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) fail(`找不到 vite：${vite}（先执行 --prepare ${lane.key} 建立依赖链接）`);

  log(`构建 ${lane.branch} 前端 → ${lane.distDir}`);
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [vite, 'build', '--outDir', lane.distDir, '--emptyOutDir'], {
      cwd: webPro,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    child.on('exit', resolve);
    child.on('error', () => resolve(-1));
  });
  if (code !== 0) fail(`vite build 失败（exit=${code}）`);

  const info = gitInfo(wtPath);
  fs.writeFileSync(
    path.join(lane.distDir, 'build-info.json'),
    JSON.stringify(
      {
        channel: lane.key,
        branch: laneBranch(lane),
        builtAt: Date.now(),
        commit: info.commit,
        dirty: info.dirty > 0,
        dirtyCount: info.dirty,
        subject: info.subject,
        builder: `node ${process.version}`,
      },
      null,
      2
    )
  );
  log(`构建完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function startProc(lane, exe, name, script, args, env) {
  const logDir = path.join(lane.dataDir, 'logs');
  ensureDir(logDir);
  const out = fs.openSync(path.join(logDir, `${name}.log`), 'a');
  const child = spawn(exe, [script, ...args], {
    cwd: lane.worktree,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  fs.writeFileSync(path.join(lane.dataDir, `${name}.pid`), String(child.pid));
  return child.pid;
}

/** 端口被别的通道占用时，指出是谁占的，避免"起不来但没有原因" */
function occupationHint(lane) {
  const others = Object.values(LANES).filter((l) => l.key !== lane.key);
  const hits = others.filter((l) => l.apiPort === lane.apiPort || l.webPort === lane.webPort);
  if (!hits.length) return '';
  const hints = hits.map((l) => {
    const running = ['api', 'web']
      .map((n) => readPid(path.join(l.dataDir, `${n}.pid`)))
      .filter(Boolean);
    return `${l.label}(${l.key})${running.length ? ` 正在运行 pid ${running.join('/')}` : ' 未在运行'}`;
  });
  return `\n       端口与 ${hits.map((l) => l.key).join('/')} 通道重叠：${hints.join('；')}` +
    `\n       先执行 --stop ${hits[0].key} 再启动`;
}

async function start(lane, { skipBuild = false } = {}) {
  if (!lane.managed) fail(`${lane.label} 通道由 WSL 的 start.sh 管理，本脚本不负责启停`);
  const wt = laneWorktree(lane);
  if (!wt) fail(`找不到 ${lane.key} 的工作树，先执行 --prepare ${lane.key}`);

  // 端口预检：自己的 pid 在跑就跳过，别人的占了就报冲突
  const apiPid = readPid(path.join(lane.dataDir, 'api.pid'));
  const webPid = readPid(path.join(lane.dataDir, 'web.pid'));
  const apiOpen = await portOpen(lane.apiPort);
  const webOpen = await portOpen(lane.webPort);

  if (apiOpen && !apiPid) fail(`API ${lane.apiPort} 已被未知进程占用${occupationHint(lane)}`);
  if (webOpen && !webPid) fail(`Web ${lane.webPort} 已被未知进程占用${occupationHint(lane)}`);

  if (!skipBuild) await build(lane);
  if (!fs.existsSync(path.join(lane.distDir, 'index.html'))) {
    fail(`产物缺失：${lane.distDir}\\index.html\n       先执行 --build ${lane.key}（或去掉 --no-build）`);
  }

  ensureWinSqlite();
  ensureTls();
  const node = pickNode();
  if (!node) fail('找不到能加载 better-sqlite3 的 Node（ABI 不匹配）。检查 node_modules 与 Node 版本');
  log(`服务端 Node：${node}`);

  // 后端
  if (apiOpen && apiPid) {
    log(`API ${lane.apiPort} 已在运行（pid ${apiPid}），跳过启动`);
  } else {
    const pid = startProc(lane, node, 'api', path.join(lane.worktree, 'server.js'), [], {
      ML_PORT: String(lane.apiPort),
      ML_DATA_DIR: lane.dataDir,
      ML_TEST_DATA_DIR: lane.dataDir,
      // APP_CHANNEL=gray 只借它的两个行为：不消费任务队列、不自动重启。
      APP_CHANNEL: 'gray',
      ML_WATCH_RESTART: '0',
      NODE_OPTIONS,
    });
    if (!(await waitPort(lane.apiPort, 60000))) {
      fail(`API ${lane.apiPort} 启动超时，见 ${path.join(lane.dataDir, 'logs', 'api.log')}`);
    }
    log(`${lane.label} API 已就绪：http://127.0.0.1:${lane.apiPort}（pid ${pid}）`);
  }

  // 前端网关
  if (webOpen && webPid) {
    log(`Web ${lane.webPort} 已在运行（pid ${webPid}），跳过启动`);
  } else {
    const pid = startProc(lane, node, 'web', path.join(lane.worktree, 'web-pro', 'server.cjs'), [], {
      WEB_PRO_PORT: String(lane.webPort),
      WEB_PRO_DIST: lane.distDir,
      APP_CHANNEL: 'gray',
      API_TARGET: `http://127.0.0.1:${lane.apiPort}`,
      EDITOR_TARGET: process.env.EDITOR_TARGET || 'http://127.0.0.1:3010',
    });
    if (!(await waitPort(lane.webPort, 25000))) {
      fail(`Web ${lane.webPort} 启动超时，见 ${path.join(lane.dataDir, 'logs', 'web.log')}`);
    }
    log(`${lane.label} Web 已就绪：http://127.0.0.1:${lane.webPort}（pid ${pid}）`);
  }
}

function stop(lane) {
  if (!lane.managed) fail(`${lane.label} 通道由 WSL 的 start.sh 管理，请用「停止素材库.bat」`);
  let stopped = 0;
  for (const name of ['web', 'api']) {
    const file = path.join(lane.dataDir, `${name}.pid`);
    const pid = readPid(file);
    if (pid) {
      killPid(pid);
      log(`已停止 ${lane.label} ${name}（pid ${pid}）`);
      stopped++;
    }
    try { fs.unlinkSync(file); } catch (_) {}
  }
  if (!stopped) log(`${lane.label} 通道未在运行`);
}

/** 纯数据采集：供 mls-ctl / service-hub 以库形式复用，不打印任何内容 */
async function collectLanes() {
  const rows = [];
  for (const lane of Object.values(LANES)) {
    const wt = laneWorktree(lane);
    const info = wt ? gitInfo(wt.path) : null;
    const apiPid = readPid(path.join(lane.dataDir, 'api.pid'));
    const webPid = readPid(path.join(lane.dataDir, 'web.pid'));
    const dist = buildInfoOf(lane.distDir);
    rows.push({
      key: lane.key,
      label: lane.label,
      legacy: Boolean(lane.legacy),
      managed: Boolean(lane.managed),
      branch: wt ? wt.branch : lane.branch || '-',
      worktree: lane.worktree,
      worktreeReady: Boolean(wt),
      commit: info ? info.commit : '-',
      subject: info ? info.subject : '',
      dirtyCount: info ? info.dirty : 0,
      apiPort: lane.apiPort,
      webPort: lane.webPort,
      apiUp: await portOpen(lane.apiPort),
      webUp: await portOpen(lane.webPort),
      apiPid,
      webPid,
      dist: dist
        ? { builtAt: dist.builtAt, commit: dist.commit, branch: dist.branch, dirty: dist.dirty }
        : null,
      distDir: lane.distDir,
      stale: Boolean(
        dist && info && (dist.commit !== info.commit || Boolean(dist.dirty) !== info.dirty > 0)
      ),
      distExists: fs.existsSync(path.join(lane.distDir, 'index.html')),
      hasUncommitted: info ? info.dirty > 0 : false,
    });
  }
  return rows;
}

async function status(asJson = false) {
  const rows = await collectLanes();

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const ts = (n) => new Date(n).toLocaleString('zh-CN', { hour12: false });
  // 中文按 2 列宽计算，否则表头对不齐
  const wide = (s) => String(s).replace(/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/g, 'xx').length;
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(1, n - wide(s)));

  console.log('');
  console.log('  ' + pad('通道', 16) + pad('分支', 10) + pad('端口(API/Web)', 17) + pad('进程', 15) + pad('产物构建', 22) + '状态');
  console.log('  ' + '-'.repeat(98));
  for (const r of rows) {
    const ports = `${r.apiUp ? '●' : '○'}${r.apiPort}/ ${r.webUp ? '●' : '○'}${r.webPort}`;
    const proc = r.apiPid || r.webPid ? `pid ${[r.apiPid, r.webPid].filter(Boolean).join('/')}` : '-';
    const dist = r.dist
      ? `${ts(r.dist.builtAt).slice(5, 16)} @${r.dist.commit}`
      : r.distExists
        ? '产物在，无版本信息'
        : '未构建';
    let state = 'ok';
    if (!r.worktreeReady) state = '缺工作树';
    else if (r.key === 'prod') state = r.webUp ? '--' : '未运行';
    else if (r.stale) state = '产物落后';
    else if (!r.webUp) state = '未运行';
    console.log(
      '  ' +
        pad(`${r.label}(${r.key})`, 16) +
        pad(r.branch, 10) +
        pad(ports, 17) +
        pad(proc, 15) +
        pad(dist, 22) +
        state
    );
    if (r.dirtyCount) console.log(`    └ 未提交改动 ${r.dirtyCount} 项${r.key === 'prod' ? '（正式端跑的是工作树，改动已生效）' : '（产物将包含未提交代码）'}`);
    if (r.stale && r.key !== 'prod') {
      const why = r.dist && r.dist.commit !== r.commit
        ? `分支现为 ${r.commit}，产物为 ${r.dist.commit}`
        : '分支有未提交改动，产物是上次构建的版本';
      console.log(`    └ ${why}，执行 --build ${r.key} 更新`);
    }
  }
  console.log('');
  console.log('  正式入口 http://127.0.0.1:30002/    分支测试入口 http://127.0.0.1:30003/');
  console.log('  ● 监听中 · ○ 未监听');
  console.log('');
}

async function diff(target) {
  // 允许直接传任意分支名：--diff fix/audit-20261020
  const lane = typeof target === 'string'
    ? { key: target, label: target, branch: target, worktree: ROOT }
    : target;
  if (!lane.branch) fail(`${lane.key} 没有独立分支，无法比较`);
  const base = flagValue('--base', 'master');
  const wt = laneWorktree(lane) || { path: lane.worktree };
  if (!fs.existsSync(wt.path)) fail(`找不到工作树：${wt.path}`);

  const ahead = Number(gitSafe(['rev-list', '--count', `${base}..${lane.branch}`])) || 0;
  const behind = Number(gitSafe(['rev-list', '--count', `${lane.branch}..${base}`])) || 0;
  console.log('');
  log(`${lane.branch} 相对 ${base}：领先 ${ahead} 个提交，落后 ${behind} 个提交`);
  if (ahead) {
    console.log(gitSafe(['log', '--oneline', '--no-decorate', `${base}..${lane.branch}`])
      .split(/\r?\n/).filter(Boolean).map((l) => '    + ' + l).join('\n'));
  }
  const stat = gitSafe(['diff', '--stat', `${base}...${lane.branch}`]);
  if (stat) console.log('\n  文件改动：\n' + stat.split(/\r?\n/).map((l) => '  ' + l).join('\n'));

  // 冲突预演：merge-tree 纯计算三方合并，不碰工作树
  const probe = gitOut(['merge-tree', '--write-tree', base, lane.branch]);
  console.log('');
  if (probe.ok) {
    const tree = (probe.out.split(/\r?\n/)[0] || '').slice(0, 12);
    log(`合并预演：无冲突（结果树 ${tree}）`);
  } else {
    warn('合并预演：存在冲突，需要手工解决');
    const lines = probe.out.split(/\r?\n/).filter((l) => /CONFLICT/.test(l));
    for (const l of lines.slice(0, 30)) console.log('    ! ' + l.replace(/^CONFLICT \([^)]*\): /, ''));
    if (lines.length > 30) console.log(`    … 另外 ${lines.length - 30} 处`);
  }
  const dirty = gitInfo(wt.path).dirty;
  if (dirty) {
    const where = path.resolve(wt.path).toLowerCase() === path.resolve(ROOT).toLowerCase() ? '主工作树' : `${lane.branch} 工作树`;
    warn(`${where}还有 ${dirty} 项未提交改动，合并前必须先提交或 stash`);
  }
  console.log('');
}

/**
 * test → master：合并 + 重建正式产物 + 重启正式。
 * 只在两台工作树都干净时才动手，避免把半成品合进正式。
 */
async function promote(lane, { dryRun = false, force = false } = {}) {
  if (!lane.branch) fail(`${lane.key} 没有独立分支，无法发布`);
  const target = LANES.prod;

  // 预演模式只看差异，不因为工作树脏而中断（这时用户还没决定合并）
  if (dryRun) {
    await diff(lane);
    console.log(`  [dry-run] 正式端当前分支 ${laneBranch(target)} @ ${gitInfo(target.worktree).commit}`);
    const dirtyCount = gitInfo(target.worktree).dirty;
    if (dirtyCount) {
      warn(`提醒：master 工作树有 ${dirtyCount} 项未提交改动，真合并前必须先提交或 stash`);
    }
    console.log('');
    return;
  }

  const srcDirty = gitInfo(lane.worktree).dirty;
  if (srcDirty && !force) {
    fail(`${lane.branch} 工作树有 ${srcDirty} 项未提交改动，先提交或 stash（确要强推加 --force）`);
  }
  const dstDirty = gitInfo(target.worktree).dirty;
  if (dstDirty) {
    fail(
      `master 工作树有 ${dstDirty} 项未提交改动，git merge 会被拒绝。\n` +
        `       先处理其中一种：\n` +
        `         a) 提交这些改动： git -C "${target.worktree}" add -A && git -C "${target.worktree}" commit -m "wip: 合并前暂存"\n` +
        `         b) 收进 stash：   git -C "${target.worktree}" stash push -u -m "before-merge"\n` +
        `       处理完再执行 --promote ${lane.key}`
    );
  }

  const ahead = Number(gitSafe(['rev-list', '--count', `master..${lane.branch}`])) || 0;
  if (!ahead) {
    log(`${lane.branch} 没有需要合并的提交，跳过合并，仅重建正式产物`);
  } else {
    log(`合并 ${lane.branch} → master（${ahead} 个提交）`);
    try {
      execFileSync('git', ['merge', '--no-ff', lane.branch, '-m', `merge(${lane.branch}): 同步分支测试通道验证通过的改动`], {
        cwd: target.worktree,
        stdio: 'inherit',
      });
    } catch (e) {
      warn('合并失败，工作树保持冲突状态；解决后 git add + git commit，或 git merge --abort 放弃');
      throw e;
    }
    log('合并完成');
  }

  log('重建正式前端产物…');
  await build(target);

  // 必须同时重启 30001(API) 与 30002(Web 网关)：server.cjs / 前端产物的改动只重启 API 永不生效。
  const r = await restartProd();
  if (r.mode === 'wsl') {
    if (!r.apiOk) warn('正式 API 30001 未在时限内恢复，查 WSL watchdog 日志');
    if (!r.webOk) warn('正式 Web 网关 30002 未在时限内恢复，查 WSL webpro.log');
  } else {
    warn(`无法走 start.sh 整组重启（${r.error}），回退为仅重启 30001；30002 必须另行手动重启`);
    await legacyRestartApi(target);
  }
}

const WSL_DISTRO = process.env.ML_WSL_DISTRO || 'smu';

/**
 * 整组重启正式端（30001 + 30002）。两者都在 WSL 里由 watchdog 托管，
 * 唯一正确入口是 start.sh restart；绝不在 Windows 侧 spawn node server.js
 * ——那会用 Windows 的独立旧库造出「第三数据平面」。
 */
async function restartProd() {
  const wsl = process.env.WSL_EXE || 'wsl.exe';
  let wslProject = '';
  try {
    // wsl.exe 会吞掉 argv 里的反斜杠，先转成正斜杠（wslpath 两种都认）
    const winRoot = ROOT.replace(/\\/g, '/');
    wslProject = execFileSync(wsl, ['-d', WSL_DISTRO, 'wslpath', '-a', winRoot], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20000,
    }).trim();
  } catch (e) {
    return { mode: 'unavailable', error: `wslpath 失败：${e.message}` };
  }
  try {
    log(`通过 WSL/${WSL_DISTRO} start.sh restart 整组重启正式端（30001 + 30002）…`);
    execFileSync(
      wsl,
      ['-d', WSL_DISTRO, '-e', 'bash', '-lc', `bash '${wslProject}/start.sh' restart`],
      { cwd: ROOT, stdio: 'inherit', timeout: 180000 }
    );
  } catch (e) {
    return { mode: 'failed', error: `start.sh restart 失败：${e.message}` };
  }
  const apiOk = await waitPort(LANES.prod.apiPort, 90000);
  const webOk = await waitPort(LANES.prod.webPort, 90000);
  return { mode: 'wsl', apiOk, webOk };
}

/** 旧兜底：只调 API 自重启接口（仅 30001；30002 不更新） */
async function legacyRestartApi(target) {
  const restartUrl = `http://127.0.0.1:${target.apiPort}/api/system/restart`;
  try {
    const res = await fetch(restartUrl, {
      method: 'POST',
      headers: { 'x-ml-internal': 'restart', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'branch-promote' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('已通知正式后端重启');
    if (await waitPort(target.apiPort, 60000)) log('正式后端已恢复');
  } catch (e) {
    warn(
      `正式后端自重启失败（${e.message}）。请手动执行「停止素材库.bat → 启动素材库.bat」` +
        `，否则 30001 仍在跑旧代码`
    );
  }
}

function laneArg() {
  const explicit = flagValue('--lane', '');
  if (explicit) return explicit;
  const positional = argv.find((a) => !a.startsWith('--') && Object.prototype.hasOwnProperty.call(LANES, a));
  return positional || 'test';
}

function resolveLane() {
  const key = laneArg();
  const lane = LANES[key];
  if (!lane) fail(`未知通道：${key}（可用：${Object.keys(LANES).join(' / ')}）`);
  return lane;
}

/** 库形式导出：mls-ctl / service-hub 复用，require 时不触发任何 CLI 动作 */
module.exports = {
  ROOT,
  HOME,
  LANES,
  WSL_DISTRO,
  PROD_DATA_UNC,
  status,
  collectLanes,
  start,
  stop,
  build,
  promote,
  restartProd,
  prepare,
  prepareData,
  diff,
  waitPort,
  portOpen,
  readPid,
  killPid,
  buildInfoOf,
  gitInfo,
  laneWorktree,
  laneBranch,
  occupationHint,
  ensureDir,
};

if (require.main === module) {
  (async () => {
    try {
      if (has('--help') || has('-h')) {
        console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, ''));
        return;
      }
      if (has('--prepare') || has('--bootstrap')) return prepare(resolveLane());
      if (has('--diff')) {
        // --diff 后面可以直接跟任意分支名，不限于已登记的通道
        const which = flagValue('--diff', '') || 'test';
        return await diff(LANES[which] || which);
      }
      if (has('--promote')) return await promote(resolveLane(), { dryRun: has('--dry-run'), force: has('--force') });
      if (has('--sync-data')) {
        const lane = resolveLane();
        prepareData(lane, { sync: true });
        log('数据快照已更新；重启通道后生效');
        return;
      }

      const lane = resolveLane();
      if (has('--stop')) return stop(lane);
      if (has('--build') || has('--build-only')) return await build(lane);
      if (has('--restart')) {
        stop(lane);
        return await start(lane, { skipBuild: has('--no-build') });
      }
      if (has('--start')) {
        if (lane.managed) prepareData(lane);
        return await start(lane, { skipBuild: has('--no-build') });
      }
      return await status(has('--json'));
    } catch (e) {
      warn(`失败：${e.message}`);
      process.exitCode = 1;
    }
  })();
}
