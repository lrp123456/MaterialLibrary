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
const APP = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX';

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
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
    name: '素材库服务端',
    desc: 'MaterialLibrary · 管理台 / App API',
    port: 30001,
    url: 'http://127.0.0.1:30001',
    kind: 'node',
    // 2026-10-03：改为「Windows Node 为主」。
    //
    // 原来是 wsl 主路径（wsl -d smu ... start.sh start），但 wsl.exe 被 WorkBuddy
    // 安全策略列入 Program Blacklist（安全中心 → 命令安全 → 程序黑名单），
    // spawn 直接 EPERM、bat 外跑 exit=1，面板上点启动毫无反应。
    //
    // 2026-10-03 用户决定统一在 Windows 上启停，因此把 Windows 路径提为主路径。
    //
    // cmd 用 getter 在启动时才求值：better-sqlite3 是原生模块，必须用 ABI 匹配的
    // node（Node 22=127 / Node 24=137 互不通用），pickNodeFor 会实测哪个能用。
    // 写死 process.execPath 会因为「面板用哪个 node 启动」而随机失败。
    // 找不到可用 node 时直接抛错，让面板把原因显示出来，而不是拿 'node' 硬试。
    get startCmd() {
      const picked = pickNodeFor(ROOT);
      if (!picked.exe) {
        throw new Error(
          '找不到能加载 better-sqlite3 的 Node（原生模块 ABI 不匹配）。已尝试: ' + picked.reason
        );
      }
      return picked.exe;
    },
    startArgs: [path.join(ROOT, 'server.js')],
    cwd: ROOT,
    // 没有 watchdog（那是 start.sh 提供的）：崩溃不会自动重启，
    // 但 Windows 路径不再依赖 wsl.exe，可靠性反而更高。
    hasWatchdog: false,
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
    name: 'Web 端 (桌面工作台 / H5)',
    desc: 'Material Studio Pro · 桌面素材工作台（端口 30002）',
    port: 30002,
    url: 'http://127.0.0.1:30002',
    kind: 'node',
    portEditable: true,
    get startCmd() {
      return process.execPath || 'node';
    },
    get startArgs() {
      return [path.join(ROOT, 'web-pro', 'server.cjs'), String(this.port || 30002)];
    },
    cwd: path.join(ROOT, 'web-pro'),
    fallback: {
      get cmd() {
        return process.platform === 'win32' ? 'npm.cmd' : 'npm';
      },
      args: ['run', 'dev:h5'],
      cwd: APP,
    }
  },
  {
    id: 'clip-editor',
    name: '剪辑编辑器 (OpenCut)',
    desc: 'fork 自 OpenCut Classic · 由 30002 以 /editor 反代（端口 3000）',
    port: 3000,
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
];

const children = new Map(); // id -> ChildProcess
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

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
      portEditable: !!s.portEditable,
      managed: children.has(s.id),
    });
  }
  return out;
}

function startService(svc) {
  if (svc.kind === 'self') return { ok: true, note: '已在运行' };
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

  // startCmd 可能是 getter（素材库服务端是），读取本身就可能抛：
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

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
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
    let body = '';
    await new Promise((r) => {
      req.on('data', (c) => (body += c));
      req.on('end', r);
    });
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
    let body = '';
    await new Promise((r) => {
      req.on('data', (c) => (body += c));
      req.on('end', r);
    });
    let data = {};
    try { data = JSON.parse(body || '{}'); } catch (_) {}
    const svc = SERVICES.find((s) => s.id === data.id);
    if (!svc) return json(res, 400, { ok: false, error: '未知服务' });
    if (data.port != null && data.port !== '' && svc.portEditable) applyPort(svc, data.port);
    exec(`start "" "${svc.url}"`);
    return json(res, 200, { ok: true, url: svc.url });
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[service-hub] http://127.0.0.1:' + PORT);
  console.log('[service-hub] root=' + ROOT);
});
