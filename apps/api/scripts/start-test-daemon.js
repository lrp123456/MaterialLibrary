const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const NODE = 'C:\\Users\\lrp\\.workbuddy\\binaries\\node\\versions\\22.22.2-6\\node.exe';
const WORKTREE = 'C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer-test';
const DATA_DIR = 'C:\\Users\\lrp\\.dsh-material-library-test';
const WIN_SQLITE_SHIM = path.join('C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer', 'scripts', 'shims', 'better-sqlite3-win.js').replace(/\\/g, '/');

const logDir = path.join(DATA_DIR, 'logs');
fs.mkdirSync(logDir, { recursive: true });

function start(name, script, env) {
  const out = fs.openSync(path.join(logDir, `${name}.log`), 'a');
  const child = spawn(NODE, [script], {
    cwd: WORKTREE,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out]
  });
  child.unref();
  fs.closeSync(out);
  fs.writeFileSync(path.join(DATA_DIR, `${name}.pid`), String(child.pid));
  console.log(`Started ${name} (pid ${child.pid})`);
  return child.pid;
}

start('api', path.join(WORKTREE, 'server.js'), {
  ML_PORT: '30000',
  ML_DATA_DIR: DATA_DIR,
  ML_TEST_DATA_DIR: DATA_DIR,
  APP_CHANNEL: 'gray',
  ML_WATCH_RESTART: '0',
  NODE_OPTIONS: `--require "${WIN_SQLITE_SHIM}"`
});

start('web', path.join(WORKTREE, 'web-pro', 'server.cjs'), {
  WEB_PRO_PORT: '30003',
  WEB_PRO_DIST: path.join(WORKTREE, 'web-pro', 'dist'),
  APP_CHANNEL: 'gray',
  API_TARGET: 'http://127.0.0.1:30000',
  EDITOR_TARGET: 'http://127.0.0.1:3010'
});
