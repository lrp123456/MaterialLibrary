/**
 * Windows 侧 better-sqlite3 解析垫片（仅灰测进程用，不进正式链路）
 *
 * 背景：仓库里的 node_modules/better-sqlite3 是 WSL 里编译的 ELF 模块，
 * Windows 的 Node 加载会直接报 Invalid ELF header；反过来把 Windows 的 .node
 * 塞回原目录又会把正在跑的正式服务弄挂。
 * 所以这里给 Windows 进程单独准备一份 node_modules/better-sqlite3-win（PE 模块），
 * 用 require 钩子把 'better-sqlite3' 改指到那份副本上。Linux/WSL 完全不经过这里。
 *
 * 用法：NODE_OPTIONS=--require <本文件>
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');

const PKG_DIR = path.resolve(__dirname, '..', '..', 'node_modules', 'better-sqlite3-win');
const origResolve = Module._resolveFilename;

if (fs.existsSync(path.join(PKG_DIR, 'build', 'Release', 'better_sqlite3.node'))) {
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'better-sqlite3') {
      return origResolve.call(this, PKG_DIR, parent, isMain, options);
    }
    return origResolve.call(this, request, parent, isMain, options);
  };
} else {
  console.warn('[win-sqlite] 缺少 node_modules/better-sqlite3-win，灰测后端将无法启动');
}
