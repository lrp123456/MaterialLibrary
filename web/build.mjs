/**
 * 管理台前端构建入口
 *
 * 为什么要这个壳：
 *   本机 `web/node_modules/@esbuild/win32-x64/esbuild.exe` 被安全软件拦在 DLL 装载阶段
 *   （Go runtime 报 `fatal error: winmm.dll not found`），vite 构建直接失败。
 *   `web-pro/node_modules` 里同一版本（0.21.5、同一 md5）的二进制可以正常跑，
 *   所以这里显式用 ESBUILD_BINARY_PATH 指过去。WSL / Linux 侧不受影响。
 *
 * 用法：node build.mjs [额外的 vite 参数]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

if (!process.env.ESBUILD_BINARY_PATH) {
  const candidates = [
    resolve(here, '../web-pro/node_modules/@esbuild/win32-x64/esbuild.exe'),
    resolve(here, 'node_modules/@esbuild/win32-x64/esbuild.exe'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      process.env.ESBUILD_BINARY_PATH = c;
      break;
    }
  }
}

const viteBin = resolve(here, 'node_modules/vite/bin/vite.js');
const args = process.argv.slice(2);
const res = spawnSync(process.execPath, [viteBin, 'build', ...args], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(res.status ?? 1);
