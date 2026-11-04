/**
 * 服务统一启动中枢
 * 启动: node service-hub/server.js
 * 页面: http://127.0.0.1:3790
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, exec, execFileSync } = require('child_process');

const PORT = Number(process.env.HUB_PORT || 3790);
const ROOT = path.resolve(__dirname, '..'); // MaterialLibraryServer

// 统一控制层（B1）：状态聚合与 WSL 适配，全部为本地库调用，require 无副作用
const mlsCtl = require(path.join(ROOT, 'scripts', 'mls-ctl'));
const wslLib = require(path.join(ROOT, 'scripts', 'mls', 'lib', 'wsl'));
const bcLib = require(path.join(ROOT, 'scripts', 'branch-channel'));

function json(res, code, obj) {
  // SEC-004：不再下发 Access-Control-Allow-Origin:*。总控面板只被同源页面使用，
  // 它的「启停服务」能力绝不允许任意网页跨源调用。
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(obj));
}

// SEC-004：Host 校验防 DNS rebinding。
function isLocalHost(req) {
  const h = String((req && req.headers && req.headers.host) || '').toLowerCase();
  if (!h) return false;
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]'
    || h.startsWith('127.0.0.1:') || h.startsWith('localhost:') || h.startsWith('[::1]:');
}

function portOpen(port, host = '127.0.0.1', timeout = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => {
      try { s.destroy(); } catch (_) {}
      resolve(v);
    };
    s.setTimeout(timeout);
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

const SERVICES = [
  {
    id: 'ml-server',
    name: '素材库服务端 (正式)',
    desc: 'WSL/smu · start.sh + watchdog 托管 · 与 30002 网关整组启停',
    port: 30001,
    url: 'http://127.0.0.1:30001',
    // 2026-11-03：彻底删除 Windows-node spawn 路径。
    // 旧实现在 Windows 用独立旧库 ~/.dsh-material-library 再起一个 30001，
    // 无 watchdog、worker 全开，是危险的「第三数据平面」。
    // 现在 30001/30002 只能经 WSL start.sh 整组操作（见 /api/mls/action）；
    // 若 wsl.exe 被安全策略拦截，任务会如实报错并提示在 WSL(smu) 终端执行 bash start.sh。
    kind: 'delegate',
    delegate: 'prod',
  },
  {
    id: 'pack-studio',
    name: '打包台 Pack Studio',
    desc: 'WGT / APK 可视化打包与推送',
    port: 3789,
    url: 'http://127.0.0.1:3789',
    kind: 'node',
    get startCmd() {
      const picked = pickNodeFor(ROOT);
      return picked.exe || 'node';
    },
    startArgs: [path.join(ROOT, 'pack-studio', 'server.js')],
    cwd: path.join(ROOT, 'pack-studio'),
  },
  {
    id: 'service-hub',
    name: '服务面板 Hub',
    desc: '本面板自身',
    port: 3790,
    url: 'http://127.0.0.1:3790',
    kind: 'self',
  },
  {
    id: 'web-h5',
    name: 'Web 网关 (正式)',
    desc: 'WSL/smu watchdog 第二子进程 · web-pro/server.cjs 30002 · 与 30001 整组启停',
    port: 30002,
    url: 'http://127.0.0.1:30002',
    // 同样禁止 Windows 侧单拉 30002：会与 WSL 正式网关抢端口、或在 API 缺失时
    // 造成「网页开着但全是 502」的假存活。
    kind: 'delegate',
    delegate: 'prod',
  },
  {
    id: 'clip-editor',
    name: '剪辑编辑器 (OpenCut)',
    desc: 'fork 自 OpenCut Classic · 内部端口 3010，经 30002 的 /editor 反代访问',
    port: 3010,
    url: 'http://127.0.0.1:30002/editor',
    kind: 'node',
    // 首次启动前必须在 editor/apps/web 下跑过一次 next build；
    // 本机有批量删除保护，Next 无法清理 .next，构建产物落在 .next-buildN，
    // 由 editor/start.cjs 固定 NEXT_DIST_DIR 后再拉起。
    get startCmd() {
      return process.execPath || 'node';
    },
    get startArgs() {
      return [path.join(ROOT, 'editor', 'start.cjs')];
    },
    cwd: path.join(ROOT, 'editor'),
  },
  // 遗留同树 gray 通道（30000/30003）已于 2026-11-03 从面板退役：
  // 它与 worktree test 通道抢同一组端口且无互斥，是状态误判的最大来源。
  // test 分支通道的状态/操作见面板「通道与发布」标签（/api/mls/*）。
  {
    id: 'asr-server',
    name: '语音识别 (FunASR)',
    desc: '本地 SenseVoice 流式识别 · HTTP 10095 / WS 10096',
    port: 10095,
    url: 'http://127.0.0.1:10095/health',
    kind: 'python',
    startCmd:
      process.env.ASR_PYTHON ||
      'C:\\Users\\lrp\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe',
    startArgs: ['-u', path.join(ROOT, 'scripts', 'asr', 'asr_server.py')],
    cwd: ROOT,
  },
];

const children = new Map(); // id -> ChildProcess
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

/* ── 长任务运行器：prod 启停 / test 通道构建 / promote 都可能跑几十秒到几分钟，
   不能阻塞事件循环，统一异步起子进程，前端按 jobId 轮询输出。 ────────────── */
const jobs = new Map(); // id -> job
const MLS_CTL = path.join(ROOT, 'scripts', 'mls-ctl.js');

function createJob(kind, cmd, args, opts = {}) {
  const id = 'j_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const job = {
    id,
    kind,
    cmd,
    args,
    state: 'running',
    code: null,
    startedAt: Date.now(),
    finishedAt: null,
    lines: [],
  };
  jobs.set(id, job);
  // 仅保留最近 20 个任务
  for (const k of [...jobs.keys()]) {
    if (jobs.size <= 20) break;
    if (k !== id) jobs.delete(k);
  }
  let child;
  try {
    child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      windowsHide: true,
    });
  } catch (e) {
    job.state = 'error';
    job.code = -1;
    job.finishedAt = Date.now();
    job.lines.push('[spawn] ' + e.message);
    return job;
  }
  job.pid = child.pid;
  const append = (buf) => {
    const parts = buf.toString().split(/\r?\n/);
    job.lines.push(...parts);
    if (job.lines.length > 1500) job.lines.splice(0, job.lines.length - 1500);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', (e) => {
    job.state = 'error';
    job.code = -1;
    job.finishedAt = Date.now();
    job.lines.push('[spawn error] ' + e.message);
  });
  child.on('exit', (code) => {
    job.state = code === 0 ? 'done' : 'error';
    job.code = code;
    job.finishedAt = Date.now();
  });
  return job;
}

/** 通道/正式端动作：统一委托给 mls-ctl（prod 内部再走 WSL start.sh） */
function spawnMlsJob(kind, ctlArgs) {
  return createJob(kind, process.execPath, [MLS_CTL, ...ctlArgs]);
}

function jobPublic(job) {
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    code: job.code,
    pid: job.pid,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    lines: job.lines,
  };
}

/**
 * 找一个能真正加载 better-sqlite3 的 Node 可执行文件。
 *
 * 为什么必须探测而不是直接用 process.execPath：
 *   服务端有一个 C++ 原生模块 better-sqlite3，它按 Node 的 ABI（NODE_MODULE_VERSION）
 *   编译。ABI 每个大版本都不同：Node 22 = 127，Node 24 = 137。
 *   拿错版本就直接 ERR_DLOPEN_FAILED：
 *     was compiled against a different Node.js version using NODE_MODULE_VERSION 127.
 *     This version of Node.js requires NODE_MODULE_VERSION 137.
 *   面板自己是用哪个 node 启动的并不等于哪个 node 能跑服务端。
 *   本机现状（2026-10-03）：.node 是 ABI 127（Node 22），而面板 bat 用的是
 *   C:\Program Files\nodejs\node.exe = Node 24 / ABI 137 → 面板自身跑不了服务端。
 *
 * 为什么不能「用 Node 24 重编译一份」来统一：
 *   1. node_modules 是**全局唯一**的位置，不能同时放两个 ABI 的 better_sqlite3.node。
 *      换编译等于让另一套 node（Node 22）全部失效，只能二选一。
 *   2. Node 24 在 Windows 上从源码编译还缺 node.lib：
 *      prebuild-install 对 target=24.14.0 报 "No prebuilt binaries found"，
 *      走 node-gyp 则卡在 LNK1104 无法打开 <nodedir>\Release\node.lib ——
 *      官方 node-v24.14.0-headers.tar.gz 和 node-v24.14.0-win-x64.zip 都不含它。
 *   所以最省事、最不容易再坏的做法：**服务端跟着能跑的 node 走**。
 */
function nodeCandidates() {
  // 先把已知 ABI 较低的（22.x）放前面：探测是串行的，第一个就用中的话最快。
  const list = [];
  // WorkBuddy 托管的 node（22.x）优先：当前 .node 就是这个 ABI 编的
  const wbBin = path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions');
  try {
    for (const v of fs.readdirSync(wbBin)) {
      const p = path.join(wbBin, v, 'node.exe');
      if (fs.existsSync(p)) list.push(p);
    }
  } catch (e) {}
  list.push('C:\\Program Files\\nodejs\\node.exe');
  list.push(process.execPath);
  list.push('node');
  return [...new Set(list.filter(Boolean))];
}

let _pickCache = null; // { exe, reason } | { exe: null, reason }

function pickNodeFor(root) {
  if (_pickCache) return _pickCache;
  // 探测必须真的 new 一个 Database，不能只 require。
  // better-sqlite3 的 index.js 只是导出包装类，.node 是 bindings 在
  // `new Database()` 内部才 process.dlopen 的（node_modules/bindings/bindings.js:112）。
  // 只 require 的话 ABI 不匹配也不会暴露，会误判成「这个 node 可用」。
  const probe = [
    "const D=require('better-sqlite3')",
    "const d=new D(':memory:')",       // ← 真正 dlopen .node
    "d.prepare('select 1 as x').get()", // ← 确保符号可用
    "process.exit(0)",
  ].join(';');
  const tried = [];
  for (const exe of nodeCandidates()) {
    try {
      execFileSync(exe, ['-e', probe], {
        cwd: root,
        stdio: ['ignore', 'ignore', 'pipe'],
        encoding: 'utf8',
        timeout: 20000,
      });
      _pickCache = { exe, reason: tried.length ? '跳过 ' + tried.join('、') : '首个候选即可用' };
      console.error(`[service-hub] 可用 node: ${exe}（${_pickCache.reason}）`);
      return _pickCache;
    } catch (e) {
      tried.push(`${path.basename(path.dirname(exe)) || exe}: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
    }
  }
  _pickCache = { exe: null, reason: tried.join(' | ') };
  console.error('[service-hub] 没有可用的 node：' + _pickCache.reason);
  return _pickCache;
}

function quoteArg(a) {
  const s = String(a);
  return /[\s"&|<>^%!]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s;
}

function applyPort(svc, port) {
  const n = Number(port);
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    throw new Error('端口无效: ' + port);
  }
  svc.port = n;
  svc.url = 'http://127.0.0.1:' + n;
  return n;
}

function buildStartArgs(svc) {
  const args = [...(svc.startArgs || [])];
  // vite/uni 支持 --port；dev:h5 脚本为 `uni`，需 `--` 透传
  if (svc.id === 'web-h5') {
    const at = args.indexOf('dev:h5');
    if (at >= 0) {
      args.splice(at + 1, 0, '--', '--port', String(svc.port), '--strictPort');
      return args;
    }
  }
  return args;
}

async function snapshot() {
  const out = [];
  for (const s of SERVICES) {
    const up = await portOpen(s.port);
    out.push({
      id: s.id,
      name: s.name,
      desc: s.desc,
      port: s.port,
      url: s.url,
      up,
      kind: s.kind,
      delegated: !!s.delegate,
      delegate: s.delegate || null,
      portEditable: !!s.portEditable,
      managed: children.has(s.id),
    });
  }
  return out;
}

function startService(svc) {
  if (svc.kind === 'self') return { ok: true, note: '已在运行' };
  if (svc.kind === 'delegate') {
    return { ok: false, error: '该服务为委托管理，请走 /api/mls/action（WSL start.sh 整组操作）' };
  }
  if (children.has(svc.id)) {
    const c = children.get(svc.id);
    if (c.exitCode == null) return { ok: true, note: '已由面板启动' };
  }

  // 返回一个「跑起来 + 端口就绪」的 Promise，这样调用方才能在启动失败时
  // 立刻改走 fallback，而不是像以前那样 spawn 完就返回 ok:true，
  // 由调用方去轮询端口 —— 轮询期间进程已经死了，日志里只剩一个 exit code。
  const launch = (cmd, args, cwd) =>
    new Promise((resolve) => {
      const logFile = path.join(LOG_DIR, svc.id + '.log');
      const logStream = fs.createWriteStream(logFile, { flags: 'a' });
      logStream.write(`\n===== ${new Date().toISOString()} ${cmd} ${args.join(' ')} =====\n`);

      const isWin = process.platform === 'win32';
      const needsShell = isWin && /\.cmd$/i.test(String(cmd));
      const spawnOpts = {
        cwd: cwd || svc.cwd || ROOT,
        windowsHide: true,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // 灰测通道需要 ML_PORT / APP_CHANNEL / WEB_PRO_DIST 这类通道级环境变量
        env: { ...process.env, ...(svc.env || {}) },
      };
      if (needsShell) spawnOpts.shell = true;

      let child;
      try {
        if (needsShell) {
          // shell:true + 参数数组会触发 DEP0190；改为单条命令行
          const cmdline = [cmd, ...args].map(quoteArg).join(' ');
          child = spawn(cmdline, spawnOpts);
        } else {
          child = spawn(cmd, args, spawnOpts);
        }
      } catch (e) {
        logStream.write(`[spawn throw] ${e.message}\n`);
        logStream.end();
        resolve({ ok: false, error: e.message, log: logFile });
        return;
      }

      children.set(svc.id, child);
      child.stdout.pipe(logStream, { end: false });
      child.stderr.pipe(logStream, { end: false });

      let spawnError = null;
      child.on('error', (e) => {
        spawnError = e.message;
        logStream.write(`[spawn error] ${e.message}\n`);
      });

      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };

      child.on('exit', (code, sig) => {
        logStream.write(`[exit] code=${code} sig=${sig}\n`);
        logStream.end();
        if (children.get(svc.id) === child) children.delete(svc.id);
        finish({
          ok: false,
          error: spawnError || `进程已退出 code=${code} sig=${sig}`,
          log: logFile,
        });
      });

      // 轮询端口；进程先退出就立刻放弃，不要死等满 waitMs
      const waitMs = svc.id === 'web-h5' ? 15000 : 4000;
      const t0 = Date.now();
      const tick = async () => {
        if (done) return;
        if (await portOpen(svc.port)) {
          finish({ ok: true, pid: child.pid, note: '已启动', log: logFile });
          return;
        }
        if (Date.now() - t0 >= waitMs) {
          finish({ ok: false, error: `端口 ${svc.port} 在 ${waitMs / 1000}s 内未就绪`, log: logFile });
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
        tick();
      };
      tick();
    });

  // startCmd 可能是 getter（pack-studio 是），读取本身就可能抛：
  // getter 内部会调 pickNodeFor，找不到可用 node 时抛错比静默起不来好。
  let cmd;
  let args;
  try {
    cmd = svc.startCmd;
    args = buildStartArgs(svc);
  } catch (e) {
    return Promise.resolve({ ok: false, error: '无法确定启动命令: ' + e.message });
  }

  return launch(cmd, args, svc.cwd).then(async (r) => {
    if (r.ok || !svc.fallback) return r;
    // 主路径失败 → 走备用方式，并把两次的失败原因都带出去，便于一眼看清原因。
    console.error(`[service-hub] ${svc.id} 主启动方式失败: ${r.error}，改用备用方式`);
    const fb = svc.fallback;
    const second = await launch(fb.cmd, fb.args, fb.cwd);
    if (second.ok) {
      second.note = `已启动（主方式失败后回退：${r.error}）`;
      return second;
    }
    return {
      ok: false,
      error: `主方式: ${r.error}；回退方式: ${second.error}`,
      log: second.log || r.log,
    };
  });
}

function stopService(svc) {
  if (svc.kind === 'self') return { ok: false, error: '不能停止自身' };
  if (svc.kind === 'delegate') {
    // 绝不能按 Windows 端口杀 WSL 进程（会误杀 wslrelay/整组 watchdog）
    return { ok: false, error: '该服务为委托管理，请走 /api/mls/action（WSL start.sh 整组操作）' };
  }
  // 优先杀面板拉起的进程树（最准确：一定是这个面板起的那个进程）
  const c0 = children.get(svc.id);
  if (c0 && c0.exitCode == null) {
    return new Promise((resolve) => {
      exec(`taskkill /PID ${c0.pid} /T /F`, (err, so) => {
        children.delete(svc.id);
        resolve(
          err
            ? { ok: false, error: err.message }
            : { ok: true, note: '已结束进程树' }
        );
      });
    });
  }
  // 面板重启后接管旧进程：children 里没有记录，只能按端口杀。
  // 先探端口：没在监听就如实说「未在运行」，别让用户以为「点了停止但服务还在」。
  return (async () => {
    const alive = await portOpen(svc.port);
    if (!alive) return { ok: true, note: '服务未在运行' };
    return new Promise((resolve) => {
      exec(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${svc.port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`,
        (err, so) => {
          const n = (String(so || '').match(/\d+/g) || []).length;
          resolve(
            err
              ? { ok: false, error: err.message }
              : { ok: true, note: n ? `已按端口停止 (${n} 个进程)` : '按端口停止已执行' }
          );
        }
      );
    });
  })();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  // SEC-004：非本机 Host 直接拒绝（DNS rebinding 纵深防御）。
  if (!isLocalHost(req)) {
    return json(res, 403, { ok: false, error: 'forbidden host' });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // 全请求只读一次 body（2MB 上限），各 POST 端点共用
  let body = '';
  if (req.method === 'POST' || req.method === 'PUT') {
    body = await new Promise((resolve) => {
      let buf = '';
      let tooBig = false;
      req.on('data', (c) => {
        buf += c;
        if (buf.length > 2_000_000 && !tooBig) {
          tooBig = true;
          req.destroy();
        }
      });
      req.on('end', () => resolve(buf));
      req.on('error', () => resolve(buf));
    });
  }

  if (p === '/' || p === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (p === '/api/services') {
    return json(res, 200, { ok: true, services: await snapshot(), time: Date.now() });
  }

  if (p === '/api/action' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body || '{}'); } catch (_) {}
    const svc = SERVICES.find((s) => s.id === data.id);
    if (!svc) return json(res, 400, { ok: false, error: '未知服务' });
    const act = data.action;
    try {
      if (data.port != null && data.port !== '') {
        if (!svc.portEditable) return json(res, 400, { ok: false, error: '该服务不支持改端口' });
        applyPort(svc, data.port);
      }
      let r;
      if (svc.kind === 'delegate') {
        // 正式组（30001/30002）：只经 WSL start.sh 整组操作，任务化执行。
        if (!['start', 'stop', 'restart'].includes(act)) {
          return json(res, 400, { ok: false, error: '委托服务仅支持 start/stop/restart' });
        }
        if (act === 'start' && (await portOpen(30001)) && (await portOpen(30002))) {
          r = { ok: true, note: '30001/30002 均已在监听，跳过（如需重启请用「重启」）' };
        } else {
          const job = spawnMlsJob('prod-' + act, [act, 'prod']);
          r = { ok: true, jobId: job.id, note: `已提交 WSL 整组${act}任务，执行结果见任务输出` };
        }
        const services = await snapshot();
        return json(res, 200, { ok: true, result: r, services });
      }
      if (act === 'start') {
        const already = await portOpen(svc.port);
        if (already) r = { ok: true, note: '端口已在监听，跳过重复启动' };
        else r = await startService(svc);
      } else if (act === 'stop') r = await stopService(svc);
      else if (act === 'restart') {
        await stopService(svc);
        await new Promise((x) => setTimeout(x, 1500));
        r = await startService(svc);
      } else return json(res, 400, { ok: false, error: '未知动作' });

      const services = await snapshot();
      return json(res, 200, { ok: true, result: r, services });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (p === '/api/open' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body || '{}'); } catch (_) {}
    const svc = SERVICES.find((s) => s.id === data.id);
    if (!svc) return json(res, 400, { ok: false, error: '未知服务' });
    if (data.port != null && data.port !== '' && svc.portEditable) applyPort(svc, data.port);
    exec(`start "" "${svc.url}"`);
    return json(res, 200, { ok: true, url: svc.url });
  }

  // 一键重建：把仓库最新代码构建成产物并重启编辑器服务。
  // 端口约定（勿改）：服务端 30001 / 客户端入口 30002 / 临时测试 30003（测完同步回 30002）。
  if (p === '/api/rebuild' && req.method === 'POST') {
    const node = process.execPath;
    const steps = [];

    const run = (label, cmd, args, opts) => new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, shell: false });
      let out = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { out += c; });
      child.on('exit', (code) => {
        steps.push({ label, ok: code === 0, tail: out.split(/\r?\n/).filter(Boolean).slice(-6).join('\n') });
        resolve(code === 0);
      });
      child.on('error', (e) => {
        steps.push({ label, ok: false, tail: e.message });
        resolve(false);
      });
    });

    // 1) 客户端产物（web-pro → dist，30002 直接生效，无需重启）
    await run('web-pro 构建', node, [path.join(ROOT, 'web-pro', 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
      cwd: path.join(ROOT, 'web-pro'),
      env: {},
    });

    // 2) 编辑器产物（NEXT 用全新 dist 目录，规避批量删除保护）
    const distDir = `.next-build${Date.now()}`;
    await run('编辑器构建', node, [path.join(ROOT, 'editor', 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
      cwd: path.join(ROOT, 'editor', 'apps', 'web'),
      env: {
        NEXT_DIST_DIR: distDir,
        NEXT_TELEMETRY_DISABLED: '1',
        SKIP_CONTENT_COLLECTIONS: '1',
      },
    });

    // 3) 重启编辑器服务（加载新产物）
    const clip = SERVICES.find((s) => s.id === 'clip-editor');
    if (clip) {
      await stopService(clip);
      await new Promise((x) => setTimeout(x, 1200));
      const r = await startService(clip);
      steps.push({ label: '重启剪辑服务', ok: !!r?.ok, tail: r?.note || r?.log || '' });
    }

    const services = await snapshot();
    return json(res, 200, { ok: steps.every((s) => s.ok), steps, services });
  }

  // ── B2：「通道与发布」标签页的统一数据源（与 CLI 完全同源）─────────────────
  if (p === '/api/mls/status' && req.method === 'GET') {
    try {
      const status = await mlsCtl.gather();
      return json(res, 200, { ok: true, status });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  // test 通道启停（prod 也允许，但内部由 mls-ctl 走 WSL start.sh）；gray 已退役
  if (p === '/api/mls/action' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body || '{}'); } catch (_) {}
    const target = String(data.target || '');
    const action = String(data.action || '');
    if (target === 'gray') {
      return json(res, 410, { ok: false, error: '遗留同树 gray 通道已于 2026-11-03 退役，请改用 test worktree 通道' });
    }
    if (!['prod', 'test'].includes(target)) {
      return json(res, 400, { ok: false, error: 'target 必须是 prod/test' });
    }
    if (!['start', 'stop', 'restart'].includes(action)) {
      return json(res, 400, { ok: false, error: 'action 必须是 start/stop/restart' });
    }
    if (target === 'prod') {
      // 正式组：已在跑时 start 直接跳过，避免「一键启动」误触发整组重启
      if (action === 'start' && (await portOpen(30001)) && (await portOpen(30002))) {
        return json(res, 200, { ok: true, result: { ok: true, note: '30001/30002 均已在监听，跳过' } });
      }
    }
    const args = [action, target];
    if (data.takeover && action !== 'stop') args.push('--takeover');
    if (target !== 'prod' && action !== 'stop') {
      args.push(action === 'start' ? (data.build ? '' : '--no-build') : data.build ? '--build' : '--no-build');
      if (args[args.length - 1] === '') args.pop();
    }
    const job = spawnMlsJob(target + '-' + action, args);
    return json(res, 200, { ok: true, jobId: job.id, job: jobPublic(job) });
  }

  // promote：默认只能 dry-run；execute:true 才真合并（前端必须二次确认）
  if (p === '/api/mls/promote' && req.method === 'POST') {
    let data = {};
    try { data = JSON.parse(body || '{}'); } catch (_) {}
    const lane = String(data.lane || 'test');
    if (!['test'].includes(lane)) {
      return json(res, 400, { ok: false, error: '目前只允许 promote test' });
    }
    const args = ['promote', lane];
    if (data.execute === true) args.push('--execute');
    if (data.force === true) args.push('--force');
    const job = spawnMlsJob('promote-' + lane, args);
    return json(res, 200, { ok: true, jobId: job.id, job: jobPublic(job) });
  }

  if (p.startsWith('/api/mls/jobs') && req.method === 'GET') {
    const id = p.split('/')[4];
    if (id) {
      const job = jobs.get(decodeURIComponent(id));
      if (!job) return json(res, 404, { ok: false, error: '任务不存在或已过期' });
      return json(res, 200, { ok: true, job: jobPublic(job) });
    }
    return json(res, 200, {
      ok: true,
      jobs: [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 10).map(jobPublic),
    });
  }

  // 通道/正式端日志（只读 tail，不动进程）
  if (p.startsWith('/api/mls/logs') && req.method === 'GET') {
    const target = url.searchParams.get('target') || '';
    const n = Math.min(Number(url.searchParams.get('n')) || 200, 1000);
    if (wslLib.PROD_LOGS[target]) {
      const r = wslLib.tailProdLog(target, n);
      if (!r.ok) return json(res, r.unreachable ? 503 : 404, { ok: false, error: r.error });
      return json(res, 200, { ok: true, path: r.path, lines: r.lines });
    }
    const m = /^(test|gray)-(api|web)$/.exec(target);
    if (m) {
      const file = path.join(bcLib.LANES[m[1]].dataDir, 'logs', m[2] + '.log');
      let lines = [];
      try {
        lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-(n + 1));
      } catch (_) {
        return json(res, 404, { ok: false, error: '日志不存在：' + file });
      }
      return json(res, 200, { ok: true, path: file, lines });
    }
    return json(res, 400, { ok: false, error: '未知日志目标：' + target });
  }

  // ── B3 产物：三端对接契约清单（gen-contract-manifest.js 生成）──────────────
  if (p === '/api/contract' && req.method === 'GET') {
    const file = path.join(ROOT, 'docs', 'contract-manifest.json');
    if (!fs.existsSync(file)) {
      return json(res, 200, { ok: false, missing: true, error: '契约清单尚未生成（B3）' });
    }
    try {
      return json(res, 200, { ok: true, contract: JSON.parse(fs.readFileSync(file, 'utf8')) });
    } catch (e) {
      return json(res, 500, { ok: false, error: '契约清单解析失败：' + e.message });
    }
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[service-hub] http://127.0.0.1:' + PORT);
  console.log('[service-hub] root=' + ROOT);
});
