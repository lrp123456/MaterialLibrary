/**
 * 用 Windows Node 24 从源码重编译 better-sqlite3。
 *
 * 为什么必须编译（不能直接 npm install）：
 *   better-sqlite3 是原生模块，按 Node 的 ABI（NODE_MODULE_VERSION）编译：
 *   Node 22 = 127，Node 24 = 137。ABI 不匹配就直接 ERR_DLOPEN_FAILED。
 *   2026-10-03 实测：prebuild-install 对 target=24.14.0 找不到预编译包
 *   （"No prebuilt binaries found"），所以只能走源码编译。
 *
 * 为什么必须注入 vcvars64：
 *   node-gyp 需要 MSVC 工具链。面板的 spawn 不经过开发者命令行，
 *   环境里没有 cl.exe / INCLUDE / LIB，编译必然失败。
 *   做法：在同一个 cmd 里先跑 vcvars64.bat 污染环境，再跑 npm rebuild。
 *
 * 为什么 nodedir 要手工指：
 *   node-gyp 默认去 ~/.cache/node-gyp 下找对应版本的头文件，
 *   这里事先把 node-v24.14.0-headers.tar.gz 解到该目录并整理成
 *   <devdir>/24.14.0/include/node 布局。
 */
const { spawnSync } = require('child_process');
const path = require('path');

const VC = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat';
const ComSpec = process.env.ComSpec || 'cmd.exe';
const NPM = 'C:\\Program Files\\nodejs\\npm.cmd';
const ROOT = 'C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer';
const PY = 'C:\\Users\\lrp\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';

// 踩坑记录（三次都卡在这）：
//   1. spawnSync(cmd, ['/d','/s','/c', str]) —— Node 会先按 Windows 规则转义数组参数，
//      str 里的 " 变成 \"，cmd 收到 '\"C:\Program Files (x86)\...\"'，报「不是内部或外部命令」。
//   2. 去掉 /s 加 call —— 引号本身已被转义坏，call 无解。
//   3. 正确解法：windowsVerbatimArguments: true 告诉 Node「参数已经拼好了，别再转义」，
//      这样 cmd 收到的就是干净的 call "C:\Program Files (x86)\...vcvars64.bat" && ...
const cmdline = ['call "' + VC + '"', '&&', 'call "' + NPM + '"', 'rebuild', 'better-sqlite3'].join(' ');

console.log('[build24] target node', process.version, 'ABI', process.versions.modules);
console.log('[build24] cwd', ROOT);
console.log('[build24]', cmdline);
console.log('');

const r = spawnSync(ComSpec, ['/d', '/c', cmdline], {
  windowsVerbatimArguments: true,
  cwd: ROOT,
  encoding: 'utf8',
  env: {
    ...process.env,
    npm_config_nodedir: 'C:\\Users\\lrp\\.cache\\node-gyp\\24.14.0',
    npm_config_devdir: 'C:\\Users\\lrp\\.cache\\node-gyp',
    npm_config_python: PY,
    GYP_MSVS_VERSION: '2022',
    // 编译 SQLite 源码要很久，放宽超时
    npm_config_build_from_source: 'true',
  },
  maxBuffer: 128 * 1024 * 1024,
  timeout: 900000,
});

console.log('status', r.status, r.error ? 'err=' + r.error.message : '');
console.log('--- stdout tail ---');
console.log((r.stdout || '').split('\n').slice(-50).join('\n'));
console.log('--- stderr tail ---');
console.log((r.stderr || '').split('\n').slice(-30).join('\n'));

// 产物落地位置：node_modules\better-sqlite3\build\Release\better_sqlite3.node
const out = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
try {
  const fs = require('fs');
  console.log('--- artifact ---');
  console.log(out, fs.statSync(out).size, 'bytes');
} catch (e) {
  console.log('产物不存在:', e.message);
}
process.exit(r.status == null ? 1 : r.status);