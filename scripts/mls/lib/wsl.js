/**
 * WSL 正式端适配层（只读状态 + 委托 start.sh 变更）。
 *
 * 铁律：30001/30002 只允许在 WSL(smu) 里由 watchdog 托管，
 * 本模块在 Windows 侧只读 UNC 文件、或调用 wsl.exe 执行 start.sh，
 * 绝不 spawn Windows node server.js（那会造出共用数据目录的「第三数据平面」）。
 *
 * WSL 发行版未运行 / 不可达时，所有读取降级为 { reachable:false }，不抛异常。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');

const DISTRO = process.env.ML_WSL_DISTRO || 'smu';
const WSL_EXE = process.env.WSL_EXE || 'wsl.exe';
const PROD_DATA_UNC =
  process.env.ML_PROD_DATA_DIR_UNC || `\\\\wsl.localhost\\${DISTRO}\\home\\lrp\\.dsh-material-library`;

/** 正式端可 tail 的日志（UNC 相对路径） */
const PROD_LOGS = {
  'prod-server': 'server.log',
  'prod-web': 'webpro.log',
  'prod-watchdog': 'watchdog.log',
  'prod-prewarm': path.join('logs', 'prewarm.log'),
};

let _runningState = null;
/** wsl -l --running 很快且不会唤醒已停止的发行版（直接访问 \\wsl.localhost 反而会拉起它） */
function distroRunning() {
  if (_runningState !== null) return _runningState;
  try {
    const r = spawnSync(WSL_EXE, ['-l', '--running'], {
      encoding: 'utf8',
      timeout: 6000,
      windowsHide: true,
    });
    // wsl.exe 列表输出在中文 Windows 上常是 UTF-16LE（含 NUL），转码后再匹配
    let text = (r.stdout || '') + (r.stderr || '');
    if (text.indexOf('\u0000') >= 0) {
      text = Buffer.from(text, 'binary').toString('utf16le');
    }
    _runningState = text.toLowerCase().includes(DISTRO.toLowerCase());
  } catch (_) {
    _runningState = false;
  }
  return _runningState;
}

function readUnc(rel) {
  try {
    return fs.readFileSync(path.join(PROD_DATA_UNC, rel), 'utf8');
  } catch (_) {
    return null;
  }
}

function readPidUnc(name) {
  const raw = readUnc(`${name}.pid`);
  if (!raw) return 0;
  const pid = Number(raw.trim());
  return Number.isFinite(pid) && pid > 0 ? pid : 0;
}

/**
 * 正式端进程快照。Linux PID 无法在 Windows 侧验活，
 * 存活与否以 HTTP 探针（30001/30002）为准；这里只给「记录的 PID」。
 */
function prodSnapshot() {
  if (!distroRunning()) {
    return { distro: DISTRO, reachable: false, running: false, pids: {}, stopFlag: false, dataUnc: PROD_DATA_UNC };
  }
  const pids = {
    watchdog: readPidUnc('watchdog'),
    server: readPidUnc('server'),
    webpro: readPidUnc('webpro'),
  };
  let stopFlag = false;
  try {
    stopFlag = fs.existsSync(path.join(PROD_DATA_UNC, 'watchdog.stop'));
  } catch (_) {}
  return {
    distro: DISTRO,
    reachable: true,
    running: Boolean(pids.watchdog || pids.server || pids.webpro),
    pids,
    stopFlag,
    dataUnc: PROD_DATA_UNC,
  };
}

/** 读正式端日志尾部 N 行；不可达时返回 ok:false */
function tailProdLog(name, lines = 200) {
  const rel = PROD_LOGS[name];
  if (!rel) return { ok: false, error: `未知日志目标：${name}` };
  if (!distroRunning()) return { ok: false, error: `WSL/${DISTRO} 未运行`, unreachable: true };
  const text = readUnc(rel);
  if (text === null) return { ok: false, error: `日志不存在：${rel}`, unreachable: true };
  const arr = text.split(/\r?\n/);
  return { ok: true, path: path.join(PROD_DATA_UNC, rel), lines: arr.slice(-(lines + 1)) };
}

/** follow 模式所需：日志的当前大小（字节），不可达返回 -1 */
function prodLogSize(name) {
  const rel = PROD_LOGS[name];
  if (!rel) return -1;
  try {
    return fs.statSync(path.join(PROD_DATA_UNC, rel)).size;
  } catch (_) {
    return -1;
  }
}

function readProdLogBytes(name, start, len) {
  const rel = PROD_LOGS[name];
  if (!rel) return null;
  try {
    const fd = fs.openSync(path.join(PROD_DATA_UNC, rel), 'r');
    try {
      const stat = fs.fstatSync(fd);
      const begin = Math.max(0, start || 0);
      const size = len == null ? stat.size - begin : Math.min(len, stat.size - begin);
      if (size <= 0) return { size: stat.size, chunk: Buffer.alloc(0) };
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, begin);
      return { size: stat.size, chunk: buf };
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return null;
  }
}

/** Windows 路径 → WSL 路径（wslpath） */
function toWslPath(winPath) {
  // wsl.exe 会吞掉 argv 里的反斜杠（C:\Users → C:Users），必须先转成正斜杠
  const p = winPath.replace(/\\/g, '/');
  return execFileSync(WSL_EXE, ['-d', DISTRO, 'wslpath', '-a', p], {
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  }).trim();
}

/**
 * 正式端变更：start / stop / restart，一律委托 WSL 里的 start.sh。
 * stdio 继承，让用户直接看到 start.sh 输出。
 */
function prodControl(action, { winProject } = {}) {
  if (!['start', 'stop', 'restart', 'status'].includes(action)) {
    throw new Error(`不支持的正式端动作：${action}`);
  }
  const wslProject = toWslPath(winProject);
  execFileSync(
    WSL_EXE,
    ['-d', DISTRO, '-e', 'bash', '-lc', `bash '${wslProject}/start.sh' ${action}`],
    { stdio: 'inherit', timeout: action === 'status' ? 30000 : 180000, windowsHide: true }
  );
  return { ok: true, via: `wsl ${DISTRO} start.sh ${action}` };
}

/** Windows 侧「伪正式」数据平面探测：service-hub 旧逻辑会在这里 spawn 30001 */
function windowsShadowPlane(winHome = os.homedir()) {
  const dir = path.join(winHome, '.dsh-material-library');
  const result = { dir, exists: fs.existsSync(dir), apiPid: 0, webPid: 0, db: false };
  const readAlivePid = (file) => {
    try {
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      if (pid > 0) {
        try {
          process.kill(pid, 0);
          return pid;
        } catch (_) {}
      }
    } catch (_) {}
    return 0;
  };
  result.apiPid = readAlivePid(path.join(dir, 'api.pid'));
  result.webPid = readAlivePid(path.join(dir, 'web.pid'));
  try {
    result.db = fs.existsSync(path.join(dir, 'material.db'));
  } catch (_) {}
  return result;
}

module.exports = {
  DISTRO,
  WSL_EXE,
  PROD_DATA_UNC,
  PROD_LOGS,
  distroRunning,
  prodSnapshot,
  tailProdLog,
  prodLogSize,
  readProdLogBytes,
  toWslPath,
  prodControl,
  windowsShadowPlane,
};
