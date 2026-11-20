/**
 * 剪辑编辑器启动器。
 *
 * 为什么需要它：
 * 本机环境有"批量删除保护"，Next 启动时会清理 `.next` 被拦截，
 * 因此构建产物写在 `.next-buildN` 目录，必须通过 NEXT_DIST_DIR 指定。
 * 这个脚本把该环境变量固定下来，供服务面板/双击脚本/命令行统一调用。
 *
 * 产物目录自动识别：按编号取最新的一个（带 BUILD_ID 才算可用），
 * 免得每次构建换了目录还得回来改这里。
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const webDir = path.join(__dirname, 'apps', 'web');
const nextBin = path.join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const port = process.env.PORT || process.env.EDITOR_PORT || '3010';

/** 找出编号最大的可用构建目录；没有则返回 null。 */
function findLatestBuild() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(webDir);
  } catch {
    return null;
  }
  const usable = dirs
    .map((name) => {
      const m = name.match(/^\.next-build(\d+)$/);
      if (!m) return null;
      const full = path.join(webDir, name);
      if (!fs.existsSync(path.join(full, 'BUILD_ID'))) return null;
      return { name, num: Number(m[1]) };
    })
    .filter(Boolean)
    .sort((a, b) => b.num - a.num);
  return usable.length ? usable[0].name : null;
}

const distDir = process.env.NEXT_DIST_DIR || findLatestBuild();

if (!fs.existsSync(nextBin)) {
  console.error(`[editor] 找不到 Next：${nextBin}`);
  console.error('[editor] 请在 editor/apps/web 下执行 npm install');
  process.exit(1);
}
if (!distDir) {
  console.error('[editor] 找不到可用的构建产物（.next-buildN）。请先在 editor/apps/web 执行：');
  console.error('  set NEXT_DIST_DIR=.next-build1 && npx next build');
  process.exit(1);
}

console.log(`[editor] 启动中 · 端口 ${port} · distDir ${distDir}`);
console.log('[editor] 访问地址：http://127.0.0.1:30002 （请统一走 30002，勿直接访问本端口）');

const child = spawn(
  process.execPath,
  // 端口走 PORT 环境变量，不用 -p：
  // 服务面板经 cmd.exe /c 包装启动时，-p 3010 会解析失败，Next 回退到 next.config 的
  // 3000（正好被 WSL 里另一份 OpenCut 占用），结果两头都起不来。
  [nextBin, 'start'],
  {
    cwd: webDir,
    stdio: 'inherit',
    env: { ...process.env, NEXT_DIST_DIR: distDir, PORT: String(port) },
  },
);

child.on('exit', (code) => process.exit(code == null ? 0 : code));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
