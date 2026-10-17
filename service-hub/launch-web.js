/**
 * 一键启动 Web 端（uni-app H5）。
 * 默认端口 30002（与 vite.config.js 一致）。
 * 可改端口：WEB_H5_PORT=30003 或 node launch-web.js 30003
 */
const { spawn, exec } = require('child_process');
const net = require('net');

const PORT = Number(process.argv[2] || process.env.WEB_H5_PORT || 30002);
const URL = `http://127.0.0.1:${PORT}`;
const APP = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function portOpen(port) {
  return new Promise((resolve) => {
    const c = new net.Socket();
    const done = (v) => {
      try { c.destroy(); } catch (_) {}
      resolve(v);
    };
    c.setTimeout(600);
    c.once('connect', () => done(true));
    c.once('timeout', () => done(false));
    c.once('error', () => done(false));
    c.connect(port, '127.0.0.1');
  });
}

function openBrowser(url) {
  exec(`start "" "${url}"`, { windowsHide: true });
}

async function main() {
  console.log('[web-h5] 目标端口', PORT, '→', URL);
  if (await portOpen(PORT)) {
    console.log('[web-h5] 端口已在监听，打开浏览器');
    openBrowser(URL);
    return;
  }

  const webProServer = require('path').resolve(__dirname, '..', 'web-pro', 'server.cjs');
  const webProDir = require('path').resolve(__dirname, '..', 'web-pro');
  let child;
  if (require('fs').existsSync(webProServer)) {
    console.log('[web-h5] 启动 Material Studio Pro:', webProServer, '--port', PORT);
    child = spawn(process.execPath || 'node', [webProServer, String(PORT)], {
      cwd: webProDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    console.log('[web-h5] 启动 npm run dev:h5 -- --port', PORT);
    child = spawn(NPM, ['run', 'dev:h5', '--', '--port', String(PORT), '--strictPort'], {
      cwd: APP,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: true,
    });
  }
  child.unref();

  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) {
      console.log('[web-h5] 就绪，打开浏览器');
      openBrowser(URL);
      return;
    }
  }
  console.error('[web-h5] 失败：20 秒内端口', PORT, '未就绪');
  console.error('[web-h5] 可能端口被占用，换端口示例: node launch-web.js 30003');
  console.error('[web-h5] 或手动: cd "' + APP + '" && npm run dev:h5 -- --port ' + PORT);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error('[web-h5]', e);
  process.exitCode = 1;
});
