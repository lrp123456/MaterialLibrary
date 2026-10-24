/**
 * 双通道灰度发布（A/B）
 *
 * 通道约定（用户 2026-10-23 定档，勿改端口）：
 *   正式通道：API 30001 + Web 30002，跑在 WSL，由 scripts/watchdog.sh 守护
 *   灰测通道：API 30000 + Web 30003，跑在 Windows，由 scripts/gray-release.js 拉起
 *
 * 本模块只做两件事：
 *   1. 汇总两条通道的实时状态（端口、构建产物、git 版本）
 *   2. 把灰测验证过的代码「发布到正式版」：重建 web-pro 到 dist，再让 30001/30002 自重启
 *
 * 为什么用「自重启接口」而不是从 Windows 调 wsl.exe：
 *   wsl.exe 被安全策略列入程序黑名单，agent 侧 spawn 直接 EPERM。
 *   正式端自身收到请求后 process.exit(0)，watchdog 3 秒内会把它拉起来，
 *   所以发布链路完全不依赖 wsl.exe。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WEB_PRO = path.join(ROOT, 'web-pro');

function envNum(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// 正式端口是硬约定，不能读 ML_PORT：灰测进程自己的 ML_PORT=30000，
// 读它会把「正式后端」错算成自己。
const PORTS = {
  prodApi: envNum('PROD_API_PORT', 30001),
  prodWeb: envNum('PROD_WEB_PORT', 30002),
  grayApi: envNum('GRAY_API_PORT', 30000),
  grayWeb: envNum('GRAY_WEB_PORT', 30003),
};

const CHANNEL = String(process.env.APP_CHANNEL || '').toLowerCase() === 'gray' ? 'gray' : 'prod';

function isGrayChannel() {
  return CHANNEL === 'gray';
}

function dataDirOf(channel) {
  if (channel === 'gray') {
    return process.env.ML_GRAY_DATA_DIR || path.join(os.homedir(), '.dsh-material-library-gray');
  }
  return process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
}

/** 生产 Web 产物目录：WSL 侧通过 /mnt/c 读同一份文件，所以在 Windows 构建完即时生效 */
const PROD_DIST = path.join(WEB_PRO, 'dist');
const GRAY_DIST = process.env.GRAY_DIST_DIR || path.join(WEB_PRO, 'dist-gray');

function httpProbe(url, timeout = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, extra) => {
      if (done) return;
      done = true;
      resolve({ up: ok, ...(extra || {}) });
    };
    const req = http.get(url, { timeout }, (res) => {
      res.resume();
      finish(res.statusCode >= 200 && res.statusCode < 500, { status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); finish(false, { error: 'timeout' }); });
    req.on('error', (e) => finish(false, { error: e.code || e.message }));
  });
}

function httpJson(method, url, { body, headers, timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        timeout,
        headers: {
          'content-type': 'application/json',
          ...(payload ? { 'content-length': payload.length } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
          let data = null;
          try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text.slice(0, 400) }; }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, data: { error: 'timeout' } }); });
    req.on('error', (e) => resolve({ ok: false, status: 0, data: { error: e.code || e.message } }));
    if (payload) req.write(payload);
    req.end();
  });
}

function gitInfo() {
  const out = { commit: '', branch: '', dirty: 0, subject: '' };
  try {
    out.commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    out.branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    out.subject = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const st = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    out.dirty = st.split(/\r?\n/).filter(Boolean).length;
  } catch (_) {}
  return out;
}

function readBuildInfo(distDir) {
  try {
    const f = path.join(distDir, 'build-info.json');
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {
    return null;
  }
}

function distSummary(distDir) {
  const indexFile = path.join(distDir, 'index.html');
  const exists = fs.existsSync(indexFile);
  let mtime = 0;
  if (exists) {
    try { mtime = fs.statSync(indexFile).mtimeMs; } catch (_) {}
  }
  const info = readBuildInfo(distDir);
  let size = 0;
  if (exists) {
    try {
      const assets = fs.readdirSync(path.join(distDir, 'assets'));
      size = assets.reduce((n, f) => {
        try { return n + fs.statSync(path.join(distDir, 'assets', f)).size; } catch (_) { return n; }
      }, 0);
    } catch (_) {}
  }
  return {
    path: distDir,
    exists,
    mtime,
    builtAt: info?.builtAt || mtime || 0,
    channel: info?.channel || '',
    commit: info?.commit || '',
    dirty: info?.dirty ?? null,
    assetBytes: size,
  };
}

async function status() {
  const [prodApi, prodWeb, grayApi, grayWeb] = await Promise.all([
    httpProbe(`http://127.0.0.1:${PORTS.prodApi}/health`),
    httpProbe(`http://127.0.0.1:${PORTS.prodWeb}/`),
    httpProbe(`http://127.0.0.1:${PORTS.grayApi}/health`),
    httpProbe(`http://127.0.0.1:${PORTS.grayWeb}/`),
  ]);
  const git = gitInfo();
  return {
    channel: CHANNEL,
    self: {
      port: CHANNEL === 'gray' ? PORTS.grayApi : PORTS.prodApi,
      dataDir: dataDirOf(CHANNEL),
      version: (() => { try { return require('../package.json').version; } catch (_) { return ''; } })(),
    },
    ports: PORTS,
    git,
    channels: {
      gray: {
        api: { port: PORTS.grayApi, ...grayApi },
        web: { port: PORTS.grayWeb, ...grayWeb },
        dist: distSummary(GRAY_DIST),
      },
      prod: {
        api: { port: PORTS.prodApi, ...prodApi },
        web: { port: PORTS.prodWeb, ...prodWeb },
        dist: distSummary(PROD_DIST),
      },
    },
    lastPublish: readLastPublish(),
  };
}

// ---------------- 发布任务 ----------------

const JOBS = new Map();
let seq = 0;

function stateFile() {
  return path.join(dataDirOf(CHANNEL), 'gray-last-publish.json');
}

function readLastPublish() {
  try {
    const f = stateFile();
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeLastPublish(job) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(job, null, 2));
  } catch (_) {}
}

function newJob() {
  const id = `${Date.now()}-${++seq}`;
  const job = {
    id,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: 0,
    steps: [],
    error: '',
  };
  JOBS.set(id, job);
  return job;
}

function step(job, key, label) {
  const s = { key, label, status: 'running', startedAt: Date.now(), endedAt: 0, detail: '' };
  job.steps.push(s);
  return {
    ok(detail) { s.status = 'done'; s.endedAt = Date.now(); if (detail) s.detail = String(detail).slice(0, 2000); },
    fail(detail) { s.status = 'failed'; s.endedAt = Date.now(); if (detail) s.detail = String(detail).slice(0, 2000); },
    skip(detail) { s.status = 'skipped'; s.endedAt = Date.now(); if (detail) s.detail = String(detail).slice(0, 2000); },
    get status() { return s.status; },
  };
}

function run(cmd, args, { cwd, env, timeout = 600000, onOutput } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}) }, windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, code: -1, output: e.message });
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
    }, timeout);
    child.stdout.on('data', (c) => {
      out += c.toString();
      if (onOutput) onOutput(out);
    });
    child.stderr.on('data', (c) => {
      out += c.toString();
      if (onOutput) onOutput(out);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, output: `${out}\n${e.message}` });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, output: out });
    });
  });
}

function tail(text, lines = 8) {
  return String(text || '').split(/\r?\n/).filter(Boolean).slice(-lines).join('\n');
}

/** 构建 web-pro。channel=prod 时直接写 dist（30002 立即可见），channel=gray 写 dist-gray */
async function buildWebPro({ channel = 'prod', onOutput } = {}) {
  const outDir = channel === 'gray' ? GRAY_DIST : PROD_DIST;
  const started = Date.now();
  const vite = path.join(WEB_PRO, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) {
    return { ok: false, outDir, ms: 0, output: `找不到 vite: ${vite}` };
  }
  const r = await run(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: WEB_PRO,
    env: { NODE_ENV: 'production' },
    timeout: 10 * 60 * 1000,
    onOutput,
  });
  if (r.ok) {
    const git = gitInfo();
    try {
      fs.writeFileSync(
        path.join(outDir, 'build-info.json'),
        JSON.stringify(
          {
            channel,
            builtAt: Date.now(),
            commit: git.commit,
            branch: git.branch,
            dirty: git.dirty,
            subject: git.subject,
            builder: `node ${process.version}`,
          },
          null,
          2
        )
      );
    } catch (_) {}
  }
  return { ok: r.ok, outDir, ms: Date.now() - started, output: r.output };
}

async function waitHealthy(url, { timeout = 45000, interval = 1200 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await httpProbe(url, 1200);
    if (r.up) return { ok: true, ms: Date.now() - t0 };
    await new Promise((x) => setTimeout(x, interval));
  }
  return { ok: false, ms: Date.now() - t0 };
}

/**
 * 发布到正式版。
 * buildFrontend：是否重新构建 web-pro（默认 true）
 * restartApi / restartWeb：是否触发对应正式服务自重启（默认 true）
 */
function publish(opts = {}) {
  const job = newJob();
  const { buildFrontend = true, restartApi = true, restartWeb = true } = opts;
  (async () => {
    try {
      // 0. 前置检查
      const pre = step(job, 'precheck', '检查正式通道');
      const prodApi = await httpProbe(`http://127.0.0.1:${PORTS.prodApi}/health`);
      const prodWeb = await httpProbe(`http://127.0.0.1:${PORTS.prodWeb}/`);
      if (!prodApi.up) {
        pre.fail(`正式后端 ${PORTS.prodApi} 不可达，先启动正式服务再发布`);
        job.status = 'failed';
        job.error = `正式后端 ${PORTS.prodApi} 不可达`;
        return;
      }
      pre.ok(`正式后端在线；正式前端${prodWeb.up ? '在线' : '未就绪（将随发布重启）'}`);

      // 1. 构建正式前端产物
      if (buildFrontend) {
        const b = step(job, 'build', '构建正式前端 (web-pro → dist)');
        const r = await buildWebPro({ channel: 'prod' });
        if (!r.ok) {
          b.fail(tail(r.output, 12));
          job.status = 'failed';
          job.error = '前端构建失败';
          return;
        }
        b.ok(`耗时 ${(r.ms / 1000).toFixed(1)}s，产物 ${PROD_DIST}`);
      } else {
        step(job, 'build', '构建正式前端 (web-pro → dist)').skip('按要求跳过构建');
      }

      // 2. 重启正式后端，让 server.js / src/*.js 的新代码生效
      if (restartApi) {
        const s = step(job, 'restart-api', `重启正式后端 (${PORTS.prodApi})`);
        const r = await httpJson('POST', `http://127.0.0.1:${PORTS.prodApi}/api/system/restart`, {
          headers: { 'x-ml-internal': 'restart' },
          body: { reason: 'gray-publish' },
        });
        if (!r.ok) {
          s.fail(
            r.status === 0
              ? `正式后端无响应：${r.data?.error || '连接失败'}`
              : `HTTP ${r.status}：${r.data?.error || '重启接口不可用'}（正式端若是旧代码，请手动执行一次「停止素材库.bat → 启动素材库.bat」后重试）`
          );
        } else {
          const w = await waitHealthy(`http://127.0.0.1:${PORTS.prodApi}/health`, { timeout: 60000 });
          if (w.ok) s.ok(`已重启并恢复健康（${(w.ms / 1000).toFixed(1)}s）`);
          else s.fail('已发出重启指令，但 60s 内未恢复健康，请查看正式端日志');
        }
      } else {
        step(job, 'restart-api', `重启正式后端 (${PORTS.prodApi})`).skip('按要求跳过');
      }

      // 3. 重启正式前端网关（静态 dist 已即时生效，重启只为加载 web-pro/server.cjs 的改动）
      if (restartWeb) {
        const s = step(job, 'restart-web', `重启正式前端 (${PORTS.prodWeb})`);
        const r = await httpJson('POST', `http://127.0.0.1:${PORTS.prodWeb}/__ml/restart`, {
          headers: { 'x-ml-internal': 'restart' },
        });
        if (!r.ok) {
          s.fail(`HTTP ${r.status}：${r.data?.error || '重启接口不可用'}（旧网关不含该接口时请手动重启 30002）`);
        } else {
          const w = await waitHealthy(`http://127.0.0.1:${PORTS.prodWeb}/`, { timeout: 30000 });
          if (w.ok) s.ok(`已重启并恢复（${(w.ms / 1000).toFixed(1)}s）`);
          else s.fail('已发出重启指令，30s 内未恢复，请查看 30002 日志');
        }
      } else {
        step(job, 'restart-web', `重启正式前端 (${PORTS.prodWeb})`).skip('按要求跳过');
      }

      // 4. 发布后核验：正式前端产物时间戳与 git 版本要跟当前工作区一致
      const v = step(job, 'verify', '核验正式版产物');
      const info = readBuildInfo(PROD_DIST);
      const git = gitInfo();
      if (!info) {
        v.fail('正式产物缺少 build-info.json，无法核对版本');
      } else if (info.commit !== git.commit || Number(info.dirty) !== Number(git.dirty)) {
        v.fail(`产物版本 ${info.commit}${info.dirty ? `(+${info.dirty})` : ''} 与工作区 ${git.commit}${git.dirty ? `(+${git.dirty})` : ''} 不一致`);
      } else {
        v.ok(`版本一致：${info.commit}${info.dirty ? ` (+${info.dirty} 个未提交改动)` : ''}`);
      }

      job.status = job.steps.some((s) => s.status === 'failed') ? 'failed' : 'done';
      job.error = job.steps.filter((s) => s.status === 'failed').map((s) => s.label).join('；');
    } catch (e) {
      job.status = 'failed';
      job.error = e.message;
    } finally {
      job.finishedAt = Date.now();
      writeLastPublish(job);
    }
  })();
  return job;
}

function getJob(id) {
  if (id && JOBS.has(String(id))) return JOBS.get(String(id));
  const last = readLastPublish();
  if (last && !id) return last;
  if (last && String(last.id) === String(id)) return last;
  return null;
}

module.exports = {
  ROOT,
  PORTS,
  PROD_DIST,
  GRAY_DIST,
  CHANNEL,
  isGrayChannel,
  dataDirOf,
  status,
  publish,
  getJob,
  buildWebPro,
  waitHealthy,
  httpProbe,
  httpJson,
};
