/**
 * 统一异步进程执行底座 (Async Subprocess Runner)
 *
 * 核心机制：
 * 1. 纯异步非阻塞：基于 child_process.spawn，主线程事件循环 100% 畅通（REST/WS/SSE 零假死）。
 * 2. 进程树强杀：支持超时与中断信号自动通过进程组（PGID）杀死整棵子进程树，杜绝 FFmpeg/Python 僵尸残留。
 * 3. 错误与流控：支持实时 onStderr 回调与完备超时/退出码聚合返回。
 */
const { spawn, exec } = require('child_process');

function killProcessTree(child, detached) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${child.pid} /T /F`, { windowsHide: true }, () => {});
      try { child.kill('SIGKILL'); } catch (_) {}
    } else {
      if (detached) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch (_) {}
      }
      try { child.kill('SIGKILL'); } catch (_) {}
    }
  } catch (_) {}
}

/**
 * 异步运行子进程
 * @param {string} bin - 可执行文件路径或命令名
 * @param {string[]} [args=[]] - 参数列表
 * @param {Object} [options={}]
 * @param {AbortSignal} [options.signal] - 中断信号
 * @param {number} [options.timeoutMs=0] - 超时毫秒数 (0 为不限时)
 * @param {boolean} [options.detached=true] - 是否脱离当前进程组以支持整树强杀
 * @param {Function} [options.onStderr] - stderr 实时回调
 * @param {string} [options.cwd] - 运行目录
 * @param {Object} [options.env] - 环境变量
 * @returns {Promise<{ status: number, stdout: string, stderr: string, code: number, signal: string|null }>}
 */
function runProcessAsync(bin, args = [], options = {}) {
  const {
    signal,
    timeoutMs = 0,
    detached = process.platform !== 'win32',
    onStderr,
    cwd,
    env = process.env,
    ...extra
  } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, {
        cwd,
        env,
        detached,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...extra
      });
    } catch (err) {
      return reject(err);
    }

    let stdoutBufs = [];
    let stderrBufs = [];
    let finished = false;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdoutBufs.push(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderrBufs.push(chunk);
        if (typeof onStderr === 'function') {
          try { onStderr(chunk.toString('utf8')); } catch (_) {}
        }
      });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        cleanup();
        killProcessTree(child, detached);
        const err = new Error(`Process timed out after ${timeoutMs}ms: ${bin} ${args.slice(0, 3).join(' ')}`);
        err.code = 'ETIMEDOUT';
        resolve({
          status: 124,
          code: 124,
          signal: 'SIGKILL',
          stdout: Buffer.concat(stdoutBufs).toString('utf8'),
          stderr: Buffer.concat(stderrBufs).toString('utf8') + `\n[async-proc] Process killed due to timeout (${timeoutMs}ms)`
        });
      }, timeoutMs);
    }

    if (signal) {
      if (signal.aborted) {
        cleanup();
        killProcessTree(child, detached);
        return resolve({
          status: 130,
          code: 130,
          signal: 'SIGINT',
          stdout: '',
          stderr: 'Aborted by signal before launch'
        });
      }
      signal.addEventListener('abort', () => {
        if (finished) return;
        finished = true;
        cleanup();
        killProcessTree(child, detached);
        resolve({
          status: 130,
          code: 130,
          signal: 'SIGINT',
          stdout: Buffer.concat(stdoutBufs).toString('utf8'),
          stderr: Buffer.concat(stderrBufs).toString('utf8') + '\n[async-proc] Process killed by abort signal'
        });
      }, { once: true });
    }

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    });

    child.on('close', (code, sig) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({
        status: code == null ? (sig ? 128 : 1) : code,
        code: code == null ? 1 : code,
        signal: sig,
        stdout: Buffer.concat(stdoutBufs).toString('utf8'),
        stderr: Buffer.concat(stderrBufs).toString('utf8')
      });
    });
  });
}

module.exports = {
  runProcessAsync,
  killProcessTree
};
