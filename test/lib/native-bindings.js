/**
 * 共享 node_modules 的双平台原生件保障（2026-11-03 事故后新增）
 *
 * 背景：本仓工作树在 Windows，生产在 WSL(smu) 里跑同一份 node_modules；
 * better-sqlite3 的原生二进制只有一个固定路径 build/Release/better_sqlite3.node，
 * 任一侧 npm install 都会用本平台文件覆盖另一侧（win32 是 PE，linux 是 ELF，互不兼容）。
 *
 * 约定（由 test/run-tests.js 在门禁时维护）：
 *   better_sqlite3.linux-x64.node  —— WSL node20 ABI115 的生产二进制（常备）
 *   better_sqlite3.win32-x64.node  —— Windows node22 ABI127 的门禁二进制（常备）
 *   better_sqlite3.node            —— 当前生效件；静置状态必须是 linux（prod 由 watchdog 自动拉起）
 *
 * sharp 不需要这套：其按平台拆分的 @img/sharp-* 可选依赖可共存。
 *
 * 单平台常规安装（两个平台备件不存在）时本模块完全不干预。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REL_DIR = path.join('node_modules', 'better-sqlite3', 'build', 'Release');
const ACTIVE = 'better_sqlite3.node';
const LINUX_PART = 'better_sqlite3.linux-x64.node';
const WIN_PART = 'better_sqlite3.win32-x64.node';
const WIN_ABI = 127; // node 22

function rootDir() {
  return path.join(__dirname, '..', '..');
}

function partPath(name) {
  return path.join(rootDir(), REL_DIR, name);
}

function kindOf(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      if (buf[0] === 0x7f && buf[1] === 0x45) return 'linux'; // \x7fE (ELF 前两字节 7f 45)
      if (buf[0] === 0x4d && buf[1] === 0x5a) return 'win32'; // MZ (PE)
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {}
  return 'unknown';
}

/** 两份平台备件是否齐备；不齐备说明是单平台 npm install，不干预 */
function hasBothParts() {
  return fs.existsSync(partPath(LINUX_PART)) && fs.existsSync(partPath(WIN_PART));
}

/**
 * Windows node24（ABI137）没有 better-sqlite3 11.10 的预编译件；
 * 门禁统一走本机 node22。返回可用的 node22 绝对路径，找不到返回 null。
 */
function findWinNode22() {
  if (process.env.ML_NODE22 && fs.existsSync(process.env.ML_NODE22)) return process.env.ML_NODE22;
  const bases = [path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions')];
  for (const base of bases) {
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    const matches = entries
      .filter((e) => e.isDirectory() && /^22\./.test(e.name))
      .map((e) => path.join(base, e.name, 'node.exe'))
      .filter((p) => fs.existsSync(p))
      .sort();
    if (matches.length) return matches[matches.length - 1];
  }
  return null;
}

/** 需要改道时返回 node22 路径；其余情况返回 null */
function rerouteTarget() {
  if (process.platform !== 'win32') return null;
  if (String(process.versions.modules) === String(WIN_ABI)) return null;
  if (process.env.ML_TEST_NO_REROUTE === '1') return null;
  const exe = findWinNode22();
  if (!exe) return null;
  // 再确认候选确实是 node22（ABI127）
  const r = spawnSync(exe, ['-p', 'process.versions.modules'], { encoding: 'utf8' });
  return r.status === 0 && String(r.stdout || '').trim() === String(WIN_ABI) ? exe : null;
}

let restored = false;
function restoreActiveToLinux() {
  if (restored) return;
  restored = true;
  try {
    if (hasBothParts() && kindOf(partPath(ACTIVE)) !== 'linux') {
      fs.copyFileSync(partPath(LINUX_PART), partPath(ACTIVE));
    }
  } catch (_) {}
}

/**
 * 把生效二进制切到当前平台；进程退出时无条件还原为 linux（prod 静置件）。
 * 返回 { swapped:boolean } 或 null（备件不齐 → 不干预）。
 */
function ensureForCurrentProcess() {
  if (!hasBothParts()) return null;
  const want = process.platform === 'win32' ? 'win32' : 'linux';
  const part = want === 'win32' ? WIN_PART : LINUX_PART;
  const swapped = kindOf(partPath(ACTIVE)) !== want;
  if (swapped) fs.copyFileSync(partPath(part), partPath(ACTIVE));
  if (want === 'win32') {
    process.once('exit', restoreActiveToLinux);
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.once(sig, () => {
        restoreActiveToLinux();
        process.exit(128 + (sig === 'SIGINT' ? 2 : 15));
      });
    }
  }
  return { swapped, want };
}

module.exports = {
  hasBothParts,
  kindOf,
  findWinNode22,
  rerouteTarget,
  ensureForCurrentProcess,
  restoreActiveToLinux,
};
