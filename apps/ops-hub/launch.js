/**
 * 一键启动：若 3790 未监听则拉起 server.js，就绪后打开浏览器。
 * bat 只需: node service-hub\launch.js
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { exec } = require('child_process');

const PORT = 3790;
const URL = `http://127.0.0.1:${PORT}`;
const SERVER = path.join(__dirname, 'server.js');
const NODE = process.execPath;

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
  // Windows
  exec(`start "" "${url}"`, { windowsHide: true });
}

async function main() {
  console.log('[launch] 检查', URL);
  if (await portOpen(PORT)) {
    console.log('[launch] 已在运行，打开浏览器');
    openBrowser(URL);
    return;
  }

  console.log('[launch] 启动 server.js ...');
  const child = spawn(NODE, [SERVER], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) {
      console.log('[launch] 就绪，打开浏览器');
      openBrowser(URL);
      return;
    }
  }
  console.error('[launch] 失败：10 秒内端口', PORT, '未就绪');
  console.error('[launch] 可手动: "' + NODE + '" "' + SERVER + '"');
  process.exitCode = 1;
}

main().catch((e) => {
  console.error('[launch]', e);
  process.exitCode = 1;
});
