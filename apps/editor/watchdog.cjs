/**
 * 剪辑编辑器守护进程（Windows / WSL 通用）。
 *
 * 职责：拉起 start.cjs，进程退出后自动重启，并把输出写进 logs/editor-watchdog.log。
 * 为什么需要：Next 进程会因端口冲突、构建目录缺失、内存等原因静默退出；
 * 手工双击启动的进程挂了没人知道，只能靠"打不开"才发现。
 *
 * 用法：
 *   node editor/watchdog.cjs            # 前台运行（Ctrl+C 结束，会带走子进程）
 *   PowerShell: Start-Process node -ArgumentList watchdog.cjs -WindowStyle Hidden
 *
 * 可用环境变量：
 *   EDITOR_PORT    默认 3010
 *   NEXT_DIST_DIR  指定构建目录；不设则自动取最新的 .next-buildN
 *   WATCHDOG_MAX_FAILS 连续快速失败多少次后放弃（默认 10）
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const EDITOR_DIR = __dirname;
const LOG_DIR = path.join(EDITOR_DIR, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'editor-watchdog.log');
const MAX_FAILS = Number(process.env.WATCHDOG_MAX_FAILS || 10);
const QUICK_EXIT_MS = 10_000; // 小于这个时长视为"启动失败"

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* 日志写不进去也不能拖垮守护进程 */
  }
  process.stdout.write(line);
}

let child = null;
let stopping = false;
let fails = 0;
let startedAt = 0;

function launch() {
  if (stopping) return;
  startedAt = Date.now();
  log(`启动编辑器（第 ${fails + 1} 次尝试）`);

  child = spawn(process.execPath, [path.join(EDITOR_DIR, 'start.cjs')], {
    cwd: EDITOR_DIR,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    try {
      fs.appendFileSync(LOG_FILE, chunk);
    } catch {
      /* 忽略 */
    }
  });
  child.stderr.on('data', (chunk) => {
    try {
      fs.appendFileSync(LOG_FILE, chunk);
    } catch {
      /* 忽略 */
    }
  });

  child.on('error', (err) => {
    log(`子进程启动失败：${err.message}`);
  });

  child.on('exit', (code, signal) => {
    if (stopping) {
      log('守护进程已停止，子进程退出');
      return;
    }
    const lived = Date.now() - startedAt;
    fails = lived < QUICK_EXIT_MS ? fails + 1 : 0;

    if (fails >= MAX_FAILS) {
      log(`连续 ${fails} 次启动即退出，放弃自动重启。请检查端口占用与构建产物。`);
      process.exit(1);
    }

    const delay = Math.min(2000 * 2 ** Math.min(fails, 4), 30_000);
    log(`编辑器退出（code=${code} signal=${signal}，存活 ${Math.round(lived / 1000)}s），${delay / 1000}s 后重启`);
    setTimeout(launch, delay);
  });
}

function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  log(`收到 ${reason}，准备退出`);
  if (child && child.pid) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* 忽略 */
    }
  }
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log('=== 剪辑编辑器守护进程启动 ===');
launch();
