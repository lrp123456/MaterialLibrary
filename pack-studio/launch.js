/**
 * Pack Studio 一键启动
 */
const { spawn, exec } = require('child_process');
const net = require('net');
const path = require('path');

const PORT = 3789;
const URL = `http://127.0.0.1:${PORT}`;
const SERVER = path.join(__dirname, 'server.js');
const fs = require('fs');
const NODE = (function findNode() {
  const candidate = 'C:\\Users\\lrp\\.workbuddy\\binaries\\node\\versions\\22.22.2-3\\node.exe';
  if (fs.existsSync(candidate)) return candidate;
  return process.execPath;
})();

function portOpen(port) {
  return new Promise((resolve) => {
    const c = new net.Socket();
    const done = (v) => { try { c.destroy(); } catch (_) {} resolve(v); };
    c.setTimeout(600);
    c.once('connect', () => done(true));
    c.once('timeout', () => done(false));
    c.once('error', () => done(false));
    c.connect(port, '127.0.0.1');
  });
}

async function main() {
  if (await portOpen(PORT)) {
    exec(`start "" "${URL}"`, { windowsHide: true });
    return;
  }
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
      exec(`start "" "${URL}"`, { windowsHide: true });
      return;
    }
  }
  console.error('Pack Studio 启动失败');
  process.exitCode = 1;
}

main();
