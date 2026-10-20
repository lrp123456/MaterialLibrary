/**
 * 剪辑编辑器启动器。
 *
 * 为什么需要它：
 * 本机环境有"批量删除保护"，Next 启动时会清理 `.next` 被拦截，
 * 因此构建产物写在 `.next-buildN` 目录，必须通过 NEXT_DIST_DIR 指定。
 * 这个脚本把该环境变量固定下来，供服务面板/命令行统一调用。
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const webDir = path.join(__dirname, 'apps', 'web');
const nextBin = path.join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const distDir = process.env.NEXT_DIST_DIR || '.next-build5';
const port = process.env.PORT || process.env.EDITOR_PORT || '3010';

if (!fs.existsSync(nextBin)) {
  console.error(`[editor] 找不到 Next：${nextBin}`);
  console.error('[editor] 请在 editor/apps/web 下执行 npm install');
  process.exit(1);
}
if (!fs.existsSync(path.join(webDir, distDir))) {
  console.error(`[editor] 找不到构建产物 ${distDir}，请先在 editor/apps/web 执行：`);
  console.error(`  NEXT_DIST_DIR=${distDir} node node_modules/next/dist/bin/next build`);
  process.exit(1);
}

console.log(`[editor] 启动中 · 端口 ${port} · distDir ${distDir}`);

const child = spawn(
  process.execPath,
  [nextBin, 'start', '-p', String(port)],
  {
    cwd: webDir,
    stdio: 'inherit',
    env: { ...process.env, NEXT_DIST_DIR: distDir },
  },
);

child.on('exit', (code) => process.exit(code == null ? 0 : code));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
