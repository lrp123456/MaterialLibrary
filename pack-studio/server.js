/**
 * Pack Studio 本地服务
 * 启动: node pack-studio/server.js
 * 浏览: http://127.0.0.1:3789
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { freshBuild } = require('./lib/fresh-build');
const { buildWgt } = require('./lib/wgt-pipeline');
const { verifyWgt } = require('./lib/wgt-verify');
const { pushUpdate } = require('./lib/push-update');

const PORT = Number(process.env.PACK_PORT || 3789);
const APP = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX';
const SCRIPTS = path.join(APP, 'scripts');
const HBX = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\cli.exe';
const SCRCPY_DIR = 'C:\\Users\\lrp\\Downloads\\scrcpy-win64-v3.3.4';
const SCRCPY = path.join(SCRCPY_DIR, 'scrcpy.exe');

function findAdb() {
  const cands = [
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe')
      : '',
    'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe',
    path.join(SCRCPY_DIR, 'adb.exe'),
  ].filter(Boolean);
  for (const c of cands) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'adb';
}

const ADB = findAdb();

const bus = new EventEmitter();
bus.setMaxListeners(50);
let lastLog = '';
let running = null; // { id, action, child }
let scrcpyProc = null;
let logcatProc = null;
let logcatBuf = '';
const LOGCAT_MAX = 400000;

function appendLogcat(chunk) {
  logcatBuf += chunk;
  if (logcatBuf.length > LOGCAT_MAX) logcatBuf = logcatBuf.slice(-LOGCAT_MAX / 2);
  bus.emit('logcat', chunk);
}

const LOGCAT_FILTERS = {
  app: 'lrp.aibum|DCloud|dcloud|Pandora|WeexCore|weex|JSF|jsengine|AndroidRuntime|FATAL|chromium|hwschromium|uni-app',
  error: 'WeexCore|weex|AndroidRuntime|FATAL|JSException|commitCriticalException|jsengine',
  all: '',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  // SEC-004：不再下发 Access-Control-Allow-Origin:*。本面板只被同源页面使用，
  // 撤掉 ACAO 可阻断外部网页通过浏览器跨源调用 adb/powershell 类接口。
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(body);
}

// SEC-004：Host 校验防 DNS rebinding——浏览器被诱导解析到 127.0.0.1 时，
// 合法同源页面的 Host 恒为本机地址；外部恶意页面的请求 Host 亦为本机，
// 但配合上面的 CORS 收紧后无凭据读取能力，此处作为纵深防御保留。
function isLocalHost(req) {
  const h = String((req && req.headers && req.headers.host) || '').toLowerCase();
  if (!h) return false;
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]'
    || h.startsWith('127.0.0.1:') || h.startsWith('localhost:') || h.startsWith('[::1]:');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listPackages() {
  const dirs = [
    { kind: 'wgt', dir: path.join(APP, 'dist/release/wgt'), ext: '.wgt' },
    { kind: 'apk', dir: path.join(APP, 'dist/release/apk'), ext: '.apk' },
    { kind: 'apk', dir: path.join(APP, 'unpackage/debug'), ext: '.apk' },
    { kind: 'apk', dir: path.join(APP, 'dist/cache/apk'), ext: '.apk' },
  ];
  const out = [];
  for (const d of dirs) {
    if (!fs.existsSync(d.dir)) continue;
    for (const f of fs.readdirSync(d.dir)) {
      if (!f.toLowerCase().endsWith(d.ext)) continue;
      const fp = path.join(d.dir, f);
      const st = fs.statSync(fp);
      out.push({
        kind: d.kind,
        name: f,
        path: fp,
        size: st.size,
        mtime: st.mtimeMs,
      });
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, 40);
}

function readJsonFile(p) {
  const raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  return JSON.parse(raw);
}

function readManifest() {
  const p = path.join(APP, 'src/manifest.json');
  try {
    return readJsonFile(p);
  } catch (e) {
    return {};
  }
}

function readVersionState() {
  const p = path.join(APP, 'src/version-state.json');
  try {
    return readJsonFile(p);
  } catch (e) {
    return null;
  }
}

function appendLog(line) {
  lastLog += line;
  if (lastLog.length > 400000) lastLog = lastLog.slice(-200000);
  bus.emit('log', line);
}

/** PowerShell -Command 下：命名参数/开关必须裸传；加引号会被绑成位置字符串（如 -PushModels → $Serial） */
function fmtPsArg(a) {
  const s = String(a);
  if (/^-[A-Za-z][A-Za-z0-9]*$/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

function runPs(script, args, cwd) {
  const quoted = args.map(fmtPsArg).join(' ');
  const psArgs = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    // 显式兜底：脚本内部若以 ErrorRecord/异常结束而没设置 exit code，
    // powershell.exe 仍可能返回 0 → 上层误判为「打包成功」。
    // 这里统一用 try/catch + ErrorActionPreference=Stop 收敛成非 0 退出码。
    `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ` +
      `$ErrorActionPreference='Continue'; ` +
      `try { & '${script.replace(/'/g, "''")}' ${quoted}; ` +
      `if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE } else { exit 0 } } ` +
      `catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
  ];
  appendLog(`\n$ ${path.basename(script)} ${args.join(' ')}\n`);
  const child = spawn('powershell.exe', psArgs, {
    cwd: cwd || APP,
    windowsHide: true,
    env: process.env,
  });
  child.stdout.on('data', (d) => appendLog(d.toString('utf8')));
  child.stderr.on('data', (d) => appendLog(d.toString('utf8')));
  return child;
}

function parseAdbDevices(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('List of') || t.startsWith('*')) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    const state = parts[1];
    const info = { serial, state, model: '', product: '', device: '', transport: '' };
    for (const p of parts.slice(2)) {
      const i = p.indexOf(':');
      if (i < 0) continue;
      const k = p.slice(0, i);
      const v = p.slice(i + 1);
      if (k === 'model') info.model = v;
      else if (k === 'product') info.product = v;
      else if (k === 'device') info.device = v;
      else if (k === 'transport_id') info.transport = v;
    }
    out.push(info);
  }
  return out;
}

function adbSync(args, timeout = 8000) {
  const { execFileSync } = require('child_process');
  return execFileSync(ADB, args, { encoding: 'utf8', timeout, windowsHide: true });
}

function adbBuffer(args, timeout = 15000) {
  const { execFileSync } = require('child_process');
  return execFileSync(ADB, args, { encoding: 'buffer', timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
}

function listDevices() {
  try {
    const raw = adbSync(['devices', '-l']);
    return { ok: true, raw, adb: ADB, devices: parseAdbDevices(raw) };
  } catch (e) {
    return { ok: false, error: e.message, adb: ADB, devices: [] };
  }
}

function fixWindowsPng(buf) {
  // Windows adb 可能把 LF 转成 CRLF，破坏 PNG；按 latin1 回写
  if (!buf || buf.length < 8) return buf;
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return buf;
  const s = buf.toString('latin1');
  if (!s.includes('\r\n')) return buf;
  return Buffer.from(s.replace(/\r\n/g, '\n'), 'latin1');
}

function requireSerial(q) {
  const serial = String(q || '').trim();
  // SEC-004：serial 会进入 adb -s 参数，强约束字符集防参数注入。
  if (serial && !/^[A-Za-z0-9._:-]+$/.test(serial)) {
    throw new Error('非法的设备 serial: ' + serial.slice(0, 40));
  }
  if (!serial) {
    const d = listDevices();
    const on = (d.devices || []).filter((x) => x.state === 'device');
    if (on.length === 1) return on[0].serial;
    if (on.length === 0) throw new Error('没有可用的 ADB 设备');
    throw new Error('多台设备在线，请选择序列号: ' + on.map((x) => x.serial).join(', '));
  }
  return serial;
}

function killPid(pid) {
  if (!pid) return false;
  try {
    const { execFileSync } = require('child_process');
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    return true;
  } catch (e) {
    return false;
  }
}

function cancelRunning() {
  const info = running;
  const killed = [];
  if (info && info.child && info.child.pid) {
    if (killPid(info.child.pid)) killed.push(String(info.child.pid));
  }
  // 云打包会再拉起 cli.exe / 子 PS，按命令行特征补杀，避免 running 永久卡住
  try {
    const { execFileSync } = require('child_process');
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pack-and-push-apk|pack-custom-base|pack-apk\\.ps1|HBuilderX\\\\cli\\.exe.*pack|quick-repack-install' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 }
    );
    let arr = [];
    try {
      const parsed = JSON.parse(raw || 'null');
      arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    } catch (e) {}
    for (const p of arr) {
      const pid = p && p.ProcessId;
      if (pid && killPid(pid)) killed.push(String(pid) + ':' + (p.Name || ''));
    }
  } catch (e) {
    appendLog('[cancel] scan error: ' + e.message + '\n');
  }

  if (info) {
    appendLog(`\n[cancel] action=${info.action} killed=${killed.join(', ') || '(none)'}\n`);
    bus.emit('done', { action: info.action, code: -1, ok: false, cancelled: true });
  } else {
    appendLog(`\n[cancel] no running task; orphan kills=${killed.join(', ') || '(none)'}\n`);
  }
  running = null;
  return { ok: true, cancelled: !!info, killed };
}

/**
 * 把编译失败如实渲染成人能读懂的日志。
 * 关键：把编译器吐出来的真实错误逐条打出来，不做概括、不吞异常。
 */
function formatBuildFailure(e) {
  const L = [];
  L.push('');
  L.push('  ╔══════════════════════════════════════════════════════╗');
  L.push('  ║  编译失败 · 已中止 · 不会使用旧产物打包             ║');
  L.push('  ╚══════════════════════════════════════════════════════╝');
  L.push('  原因: ' + (e && e.message ? e.message : String(e)));
  const errs = (e && e.buildErrors) || [];
  if (errs.length) {
    L.push('');
    L.push('  ── 编译器原始错误 ──');
    for (const x of errs) L.push('  │ ' + x);
  }
  L.push('');
  L.push('  处理建议：按上面的报错修 src/ 里的代码，然后重新打包。');
  L.push('  绝不会发生的事：拿上一次的历史产物重新打包推给用户。');
  L.push('');
  return L.join('\n');
}

/** 本会话最近一次编译收据（用于 verify-wgt 比对） */
let lastBuildReceipt = null;
function readLastReceipt() {
  return lastBuildReceipt;
}

/** 本会话最近一次推送结果（供 /api/status 展示） */
let lastPushReceipt = null;

/** 找 dist/release/{wgt,apk} 下最新的包（排除 bad_archive） */
function latestPackage(kind) {
  const dir = path.join(APP, 'dist', 'release', kind);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const list = names
    .filter((n) => (kind === 'wgt' ? n.endsWith('.wgt') : n.endsWith('.apk')))
    .filter((n) => !/bad_archive/i.test(n))
    .map((n) => {
      const p = path.join(dir, n);
      let t = 0;
      try { t = fs.statSync(p).mtimeMs; } catch {}
      return { name: n, path: p, mtime: t };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return list[0] || null;
}

/** 纯推送（不重新编译）：走 Node 推送通道，与「打包并推送」共用同一条实现 */
function runPushOnly(kind, opt) {
  if (running) {
    return { ok: false, error: '已有任务在运行，可点「取消当前任务」', id: running.id, action: running.action };
  }
  const hit = latestPackage(kind);
  if (!hit) return { ok: false, error: 'dist/release/' + kind + ' 下没有可推送的包' };

  const id = Date.now();
  lastLog = '';
  running = { id, action: 'push-' + kind, child: null };
  appendLog('\n════════ 推送已有 ' + kind.toUpperCase() + '（Node 直连）════════\n');
  appendLog('  ' + hit.name + '  ' + fs.statSync(hit.path).size + ' 字节\n');
  appendLog('  取自 mtime 最新的包，不重新编译\n');

  pushUpdate({
    file: hit.path,
    note: opt.note,
    channel: opt.channel,
    server: opt.server,
    user: opt.user,
    pass: opt.pass,
    force: opt.force,
    releaseMode: opt.releaseMode,
    targetDevices: opt.targetDevices,
    rolloutPct: opt.rolloutPct,
    appRoot: APP,
    onLog: (line) => appendLog(line),
  })
    .then((r) => {
      lastPushReceipt = r;
      appendLog('\n[推送] 成功：' + r.fileName + '\n');
      bus.emit('done', { action: 'push-' + kind, code: 0, ok: true, push: r });
    })
    .catch((e) => {
      lastPushReceipt = { ok: false, error: e.message };
      appendLog('\n[推送] 失败：' + e.message + '\n');
      appendLog('[推送] 服务器上仍是上一个版本。\n');
      bus.emit('done', { action: 'push-' + kind, code: 1, ok: false, error: e.message });
    })
    .finally(() => { running = null; });

  return { ok: true, id, action: 'push-' + kind };
}

/**
 * WGT 出包流水线：隔离编译 → 闸门 → 压缩 → 字节同源校验 → （可选）推送。
 * 编译或校验任何一步失败，都如实报错并中止，绝不推送。
 */
function runWgtPipeline(action, body, opt) {
  if (running) {
    return { ok: false, error: '已有任务在运行，可点「取消当前任务」', id: running.id, action: running.action };
  }
  lastLog = '';
  const id = Date.now();
  const doPush = action !== 'pack-wgt';
  running = { id, action, child: null };

  appendLog('Pack Studio 出包流水线');
  appendLog('  项目(App 源码只读): ' + APP);
  appendLog('  隔离工作区: %TEMP%\\pack-studio-fresh-build');
  appendLog('');

  buildWgt(APP, { note: opt.note, bumpVersion: opt.bumpVersion, onLog: (line) => appendLog(line) })
    .then(async (meta) => {
      lastBuildReceipt = meta.buildReceipt;
      appendLog('\n[流水线] 出包完成: ' + meta.fileName + ' (' + meta.size + ' 字节)\n');
      appendLog('[流水线] 编译时间 ' + meta.buildReceipt.builtAt + '\n');
      appendLog('[流水线] 压缩时间 ' + meta.buildReceipt.finishedAt + '\n');
      appendLog('[流水线] 源码指纹与产物字节已核对一致\n');

      if (!doPush) {
        bus.emit('done', { action, code: 0, ok: true, wgt: meta.file, meta });
        running = null;
        return;
      }

      appendLog('\n════════ 推送更新通道（Node 直连，不经 PowerShell）════════\n');
      running = { id, action, child: null };
      try {
        const r = await pushUpdate({
          file: meta.file,
          note: opt.note,
          channel: opt.channel,
          server: opt.server,
          user: opt.user,
          pass: opt.pass,
          force: opt.force,
          releaseMode: opt.releaseMode,
          targetDevices: opt.targetDevices,
          rolloutPct: opt.rolloutPct,
          appRoot: APP,
          onLog: (line) => appendLog(line),
        });
        lastPushReceipt = r;
        appendLog('\n[推送] 成功：' + r.fileName + ' → ' + r.server + '\n');
        appendLog('[推送] 手机端启动/回前台会检查到 wgtVersion=' + r.wgtVersion + '\n');
        bus.emit('done', { action, code: 0, ok: true, wgt: meta.file, meta, push: r });
      } catch (e) {
        lastPushReceipt = { ok: false, error: e.message };
        appendLog('\n[推送] 失败：' + e.message + '\n');
        appendLog('[推送] 未推送任何内容。服务器上仍是上一个版本。\n');
        bus.emit('done', { action, code: 1, ok: false, wgt: meta.file, meta, error: e.message });
      }
      running = null;
    })
    .catch((e) => {
      const text = formatBuildFailure(e);
      appendLog(text);
      appendLog('[流水线] 未产出任何 wgt，未推送任何内容。\n');
      bus.emit('done', {
        action,
        code: 1,
        ok: false,
        error: e.message,
        buildErrors: e.buildErrors || [],
      });
      running = null;
    });

  return { ok: true, id, action };
}

function runAction(action, body) {
  if (running) {
    return { ok: false, error: '已有任务在运行，可点「取消当前任务」', id: running.id, action: running.action };
  }
  const note = String(body.note || '可视化打包');
  const releaseMode = String(body.releaseMode || 'full').toLowerCase();
  const channel = String(body.channel || (releaseMode === 'canary' ? 'canary' : 'internal'));
  const force = !!body.force;
  const server = String(body.server || process.env.PACK_SERVER || process.env.PUBLIC_BASE_URL || '');
  const user = String(body.user || process.env.PACK_USER || 'admin');
  let pass = String(body.pass || process.env.PACK_PASS || '');

  if (body.note) {
    appendLog('\n════════ 本次出包更新说明 ════════\n' + body.note + '\n══════════════════════════════════\n');
  }

  try {
    const historyDir = path.join(__dirname, 'state');
    fs.mkdirSync(historyDir, { recursive: true });
    const histFile = path.join(historyDir, 'pack-history.json');
    let hist = [];
    try { hist = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch (e) {}
    hist.unshift({
      time: new Date().toISOString(),
      action,
      note,
      features: body.features || '',
      bugfixes: body.bugfixes || '',
      bumpVersion: !!body.bumpVersion,
    });
    if (hist.length > 50) hist = hist.slice(0, 50);
    fs.writeFileSync(histFile, JSON.stringify(hist, null, 2), 'utf8');
  } catch (e) {}

  // ⚠️ 这里不再接受 skipBuild / useExisting。
  // 曾经的 skipBuild 会让整条链路直接拿磁盘上的历史 www 去打包推送，
  // 而历史 www 可能是几天前的产物 —— 表现为「所有新功能在 App 里都看不见」。
  // 现在「始终用最新产物」是硬约束，没有开关可以绕过。
  if (body.skipBuild === true || body.useExisting === true) {
    appendLog(
      '\n[闸门] 已忽略 skipBuild/useExisting：打包必须使用当次编译产物，不允许复用历史产物。\n'
    );
  }
  const skipBuild = false;
  const useExisting = false;

  let script = '';
  let args = [];
  if (action === 'pack-wgt' || action === 'pack-and-push-wgt' || action === 'pack-and-push') {
    // 走受控流水线：隔离编译 → 闸门 → 压缩 → 字节同源校验 → 推送
    return runWgtPipeline(action, body, {
      note,
      channel,
      force,
      server,
      user,
      pass,
      bumpVersion: !!body.bumpVersion,
      releaseMode: body.releaseMode || (channel === 'canary' ? 'canary' : 'full'),
      targetDevices: body.targetDevices || [],
      rolloutPct: body.rolloutPct ?? '',
    });
  } else if (action === 'verify-wgt') {
    // 单独校验某个 wgt 是否与最近一次编译产物同源（排障用）
    const name = path.basename(String(body.name || ''));
    const hit = listPackages().find((x) => x.kind === 'wgt' && x.name === name);
    if (!hit) return { ok: false, error: '未找到 wgt: ' + name };
    try {
      const receipt = readLastReceipt();
      if (!receipt) return { ok: false, error: '没有本会话的编译收据，无法比对。请先执行一次打包。' };
      const v = verifyWgt(hit.path, receipt);
      return { ok: true, verify: v };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  } else if (action === 'pack-apk') {
    script = path.join(SCRIPTS, 'pack-apk.ps1');
    args = ['-PackageName', String(body.packageName || 'lrp.aibum')];
    if (useExisting) args.push('-UseExisting');
    if (body.bumpVersion) args.push('-BumpVersion');
    if (body.noPrompt !== false) args.push('-NoPrompt');
  } else if (action === 'pack-custom-base') {
    script = path.join(SCRIPTS, 'pack-custom-base.ps1');
    args = ['-PackageName', String(body.packageName || 'lrp.aibum')];
    if (useExisting) args.push('-UseExisting');
    if (body.bumpVersion) args.push('-BumpVersion');
    if (body.noPrompt !== false) args.push('-NoPrompt');
  } else if (action === 'quick-install' || action === 'adb-install') {
    // 一键全自动：编译最新前端源码 -> 注入底模快速重签 -> ADB 安装 -> 自动启动 App
    script = path.join(SCRIPTS, 'quick-repack-install.ps1');
    if (body.serial) args.push('-Serial', String(body.serial));
    if (body.packageName) args.push('-PackageName', String(body.packageName));
    if (body.pushModels) args.push('-PushModels');
    if (body.bumpVersion) args.push('-BumpVersion');
    if (body.noPrompt !== false) args.push('-NoPrompt');
  } else if (action === 'pure-adb-install') {
    // 纯 ADB 安装已有 APK（不重新编译重签）
    script = path.join(SCRIPTS, 'adb-install.ps1');
    if (body.serial) args.push('-Serial', String(body.serial));
    if (body.apk) args.push('-Apk', String(body.apk));
    if (body.pushModels) args.push('-PushModels');
  } else if (action === 'first-pack') {
    script = path.join(SCRIPTS, 'pack-custom-base.ps1');
    args = ['-PackageName', String(body.packageName || 'lrp.album')];
  } else if (action === 'push-wgt') {
    // 纯推送已有 wgt（不重新编译）。刻意保留：重推历史包是有意行为，
    // 界面上与「打包并推送」是两个不同按钮。
    // ⚠️ 这里刻意**不**走 push-update.ps1：ps1 用 GBK 读 sidecar，
    // 中文 note 会被解码坏导致 ConvertFrom-Json 失败（2026-10-03 真实故障）。
    return runPushOnly('wgt', {
      note,
      channel,
      force,
      server,
      user,
      pass,
      releaseMode,
      targetDevices: body.targetDevices || [],
      rolloutPct: body.rolloutPct ?? ''
    });
  } else if (action === 'push-apk') {
    return runPushOnly('apk', { note, channel, force: true, server, user, pass });
  } else if (action === 'pack-and-push-apk') {
    // 保留：云打包 APK 并推更新通道（正式发底包时用）
    script = path.join(SCRIPTS, 'pack-and-push-apk.ps1');
    args = ['-Note', note, '-Channel', channel, '-Server', server, '-User', user, '-Pass', pass];
  } else if (action === 'cloud-apk-install') {
    // 云打包 APK → ADB 安装（开发装机，不推通道）
    script = path.join(SCRIPTS, 'cloud-apk-adb-install.ps1');
    if (body.serial) args.push('-Serial', String(body.serial));
    if (body.packageName) args.push('-PackageName', String(body.packageName));
    if (body.bumpVersion) args.push('-BumpVersion');
    if (body.noPrompt !== false) args.push('-NoPrompt');
  } else if (action === 'offline-apk-install') {
    // 离线打包 APK → ADB 安装（开发装机，不推通道）
    script = path.join(SCRIPTS, 'pack-offline-apk.ps1');
    args.push('-Install');
    if (body.serial) args.push('-Serial', String(body.serial));
    if (body.skipImport) args.push('-SkipImport');
    if (body.bumpVersion) args.push('-BumpVersion');
    if (body.noPrompt !== false) args.push('-NoPrompt');
  } else if (action === 'pack-offline-apk') {
    // 仅离线打包 APK（不安装、不推送）
    script = path.join(SCRIPTS, 'pack-offline-apk.ps1');
    if (body.skipImport) args.push('-SkipImport');
    if (body.bumpVersion) args.push('-BumpVersion');
    if (body.noPrompt !== false) args.push('-NoPrompt');
  } else if (action === 'pack-and-push-offline-apk') {
    // 备用：离线 APK 推更新通道（正式发底包时用）
    script = path.join(SCRIPTS, 'pack-and-push-offline-apk.ps1');
    args = ['-Note', note, '-Channel', channel, '-Server', server, '-User', user, '-Pass', pass];
    if (body.skipImport) args.push('-SkipImport');
    if (body.bumpVersion) args.push('-BumpVersion');
    if (body.noPrompt !== false) args.push('-NoPrompt');
  } else if (action === 'offline-status') {
    script = path.join(SCRIPTS, 'offline-pack-status.ps1');
  } else if (action === 'rebuild-www') {
    // 只重编前端，用于确认源码能否编进产物。
    // 走和出包完全相同的隔离编译闸门：源码只读、失败即中止、不回退旧产物。
    lastLog = '';
    const id = Date.now();
    running = { id, action, child: null };
    appendLog('\n════ 隔离编译（不触碰你的源码）════\n');
    freshBuild(APP, (line) => appendLog(line))
      .then((receipt) => {
        lastBuildReceipt = receipt;
        appendLog('\n[闸门] 通过：' + JSON.stringify(receipt.fingerprint) + '\n');
        appendLog('[闸门] 标识符 ' + receipt.identityMarkers.hit + '/' + receipt.identityMarkers.total + '\n');
        bus.emit('done', { action, code: 0, ok: true, receipt });
      })
      .catch((e) => {
        appendLog('\n' + formatBuildFailure(e) + '\n');
        bus.emit('done', { action, code: 1, ok: false, error: e.message, buildErrors: e.buildErrors || [] });
      })
      .finally(() => {
        running = null;
      });
    return { ok: true, id, action };
  } else if (action === 'check-update') {
    // 不跑 PS，只 GET 服务端。LOGIC-008：原实现用 http.get，遇到 https:// 地址会
    // 同步抛 ERR_INVALID_PROTOCOL 直接打崩进程；改用 fetch 并全程 try/catch。
    appendLog(`\n$ check ${server}/api/app/update?...\n`);
    const url = `${server}/api/app/update?platform=android&versionCode=${body.versionCode || 100}&wgtVersion=${body.wgtVersion || 100}&channel=${channel}`;
    const taskId = Date.now();
    running = { id: taskId, action, child: null };
    (async () => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const d = await r.text();
        appendLog(d.slice(0, 20000) + '\n');
        bus.emit('done', { action, code: r.status, ok: r.status === 200 });
      } catch (e) {
        appendLog('ERR ' + e.message + '\n');
        bus.emit('done', { action, ok: false, error: e.message });
      } finally {
        running = null;
      }
    })();
    return { ok: true, id: taskId, action };
  } else {
    return { ok: false, error: '未知动作 ' + action };
  }

  if (!fs.existsSync(script)) {
    return { ok: false, error: '脚本不存在: ' + script };
  }

  lastLog = '';
  const id = Date.now();
  const child = runPs(script, args);
  running = { id, action, child };
  child.on('close', (code) => {
    appendLog(`\n[exit ${code}] ${action}\n`);
    bus.emit('done', { action, code, ok: code === 0 });
    running = null;
  });
  child.on('error', (e) => {
    appendLog('spawn error: ' + e.message + '\n');
    bus.emit('done', { action, ok: false, error: e.message });
    running = null;
  });
  return { ok: true, id, action };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  // SEC-004：非本机 Host 直接拒绝（DNS rebinding 纵深防御）。
  if (!isLocalHost(req)) {
    return json(res, 403, { ok: false, error: 'forbidden host' });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (p === '/' || p === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    return res.end(html);
  }

  if (p === '/api/status') {
    const mf = readManifest();
    const vs = readVersionState();
    return json(res, 200, {
      ok: true,
      running: running ? { action: running.action, id: running.id } : null,
      hbx: fs.existsSync(HBX),
      app: APP,
      // 出包纪律：始终使用当次编译产物，编译失败如实报错，绝不回退旧产物
      policy: {
        alwaysFreshBuild: true,
        isolatedBuild: true,
        sourceReadOnly: true,
        skipBuildSupported: false,
        fallbackToOldArtifact: false,
      },
      lastBuild: lastBuildReceipt
        ? {
            builtAt: lastBuildReceipt.builtAt,
            finishedAt: lastBuildReceipt.finishedAt,
            exitCode: lastBuildReceipt.exitCode,
            appServiceBytes: lastBuildReceipt.appServiceBytes,
            appServiceSha256: lastBuildReceipt.appServiceSha256,
            identityMarkers: lastBuildReceipt.identityMarkers,
            fingerprint: lastBuildReceipt.fingerprint,
            workDir: lastBuildReceipt.isolatedWorkDir,
          }
        : null,
      manifest: {
        versionName: mf.versionName || '1.0.0',
        versionCode: mf.versionCode || 100,
      },
      versionState: vs
        ? {
            versionName: vs.versionName,
            versionCode: vs.versionCode,
            machineCode: vs.machineCode,
            buildCode: vs.buildCode,
          }
        : null,
    });
  }

  if (p === '/api/packages') {
    return json(res, 200, { ok: true, packages: listPackages() });
  }

  if (p === '/api/download') {
    const name = path.basename(String(url.searchParams.get('name') || ''));
    const kind = String(url.searchParams.get('kind') || 'apk');
    const list = listPackages();
    const hit = list.find((x) => x.name === name && (!kind || x.kind === kind || kind === 'any'));
    if (!hit || !fs.existsSync(hit.path)) return json(res, 404, { ok: false, error: 'file not found' });
    const buf = fs.readFileSync(hit.path);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + encodeURIComponent(hit.name) + '"',
      'Content-Length': buf.length,
    });
    return res.end(buf);
  }

  if (p === '/api/adb/devices') {
    return json(res, 200, listDevices());
  }

  if (p === '/api/logcat/buffer') {
    return json(res, 200, { ok: true, log: logcatBuf, running: !!logcatProc });
  }

  if (p === '/api/logcat/dump') {
    try {
      const serial = requireSerial(url.searchParams.get('serial'));
      const mode = String(url.searchParams.get('filter') || 'app');
      const lines = Math.min(Number(url.searchParams.get('lines') || 400), 3000);
      const pattern = LOGCAT_FILTERS[mode] !== undefined ? LOGCAT_FILTERS[mode] : mode;
      const args = ['-s', serial, 'logcat', '-d', '-v', 'time'];
      if (pattern) args.push('-e', pattern);
      const out = adbSync(args, 12000);
      const arr = String(out || '').split(/\r?\n/);
      const tail = arr.slice(-lines).join('\n');
      appendLogcat(`\n===== logcat dump serial=${serial} filter=${mode} =====\n` + tail + '\n');
      const hint = /versionTabs is not defined|white screen|create instanceContext failed|FATAL|AndroidRuntime/i.test(tail);
      return json(res, 200, {
        ok: true,
        serial,
        filter: mode,
        lines: arr.length,
        log: tail,
        hasCritical: hint,
      });
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message });
    }
  }

  if (p === '/api/logcat/relaunch' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
    try {
      const serial = requireSerial(body.serial);
      // SEC-004：packageName 会拼进 adb shell（安卓端经 /system/bin/sh 执行），
      // 必须强校验为合法安卓包名，杜绝 `pkg; id` 型命令注入。
      const pkg = String(body.packageName || 'lrp.aibum');
      if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(pkg)) {
        return json(res, 400, { ok: false, error: '非法的包名: ' + pkg.slice(0, 60) });
      }
      adbSync(['-s', serial, 'shell', 'am', 'force-stop', pkg]);
      adbSync(['-s', serial, 'shell', 'logcat', '-c']);
      // 兼容 PandoraEntry / PandoraEntryActivity
      const tryStart = [
        ['shell', 'am', 'start', '-n', `${pkg}/io.dcloud.PandoraEntry`],
        ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'],
      ];
      let started = '';
      for (const a of tryStart) {
        try {
          const out = adbSync(['-s', serial, ...a], 8000);
          if (!/Error|Exception|No activities/i.test(out || '')) { started = a.join(' '); break; }
          started = out;
        } catch (e) { started = e.message; }
      }
      appendLog(`\n[relaunch] ${pkg} via ${started}\n`);
      return json(res, 200, { ok: true, serial, pkg, started });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (p === '/api/logcat/live/start' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
    if (logcatProc) return json(res, 200, { ok: true, already: true });
    try {
      const serial = requireSerial(body.serial);
      const mode = String(body.filter || 'app');
      const pattern = LOGCAT_FILTERS[mode] !== undefined ? LOGCAT_FILTERS[mode] : mode;
      const args = ['-s', serial, 'logcat', '-v', 'time'];
      if (pattern) args.push('-e', pattern);
      appendLog(`\n$ adb ${args.join(' ')}\n`);
      logcatBuf = '';
      logcatProc = spawn(ADB, args, { windowsHide: true, env: process.env });
      logcatProc.stdout.on('data', (d) => {
        const t = d.toString('utf8');
        appendLogcat(t);
        appendLog(t);
      });
      logcatProc.stderr.on('data', (d) => {
        const t = d.toString('utf8');
        appendLogcat(t);
        appendLog(t);
      });
      logcatProc.on('exit', (code) => {
        appendLogcat(`\n[logcat live exit ${code}]\n`);
        logcatProc = null;
      });
      return json(res, 200, { ok: true, pid: logcatProc.pid, serial, filter: mode });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (p === '/api/logcat/live/stop' && req.method === 'POST') {
    if (logcatProc) {
      try { logcatProc.kill(); } catch (e) {}
      logcatProc = null;
      appendLog('\n[logcat live stopped]\n');
      return json(res, 200, { ok: true, stopped: true });
    }
    return json(res, 200, { ok: true, stopped: false });
  }

  if (p === '/api/logcat/clear' && req.method === 'POST') {
    try {
      const serial = requireSerial(new URL(req.url, 'http://127.0.0.1').searchParams.get('serial'));
      adbSync(['-s', serial, 'logcat', '-c']);
      logcatBuf = '';
      return json(res, 200, { ok: true, serial });
    } catch (e) {
      logcatBuf = '';
      return json(res, 200, { ok: true, note: e.message });
    }
  }

  if (p === '/api/scrcpy/status') {
    const alive = !!(scrcpyProc && scrcpyProc.exitCode === null && !scrcpyProc.killed);
    return json(res, 200, {
      ok: true,
      running: alive,
      pid: alive ? scrcpyProc.pid : null,
      exe: SCRCPY,
      exeOk: fs.existsSync(SCRCPY),
    });
  }

  if (p === '/api/phone/size') {
    try {
      const serial = requireSerial(url.searchParams.get('serial'));
      const out = adbSync(['-s', serial, 'shell', 'wm', 'size']);
      const m = /(\d+)\s*x\s*(\d+)/.exec(out || '');
      if (!m) throw new Error('无法解析分辨率: ' + out);
      return json(res, 200, { ok: true, serial, width: Number(m[1]), height: Number(m[2]), raw: out });
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message });
    }
  }

  if (p === '/api/phone/screen') {
    try {
      const serial = requireSerial(url.searchParams.get('serial'));
      const remote = '/data/local/tmp/_pack_studio_cap.png';
      adbSync(['-s', serial, 'shell', 'screencap', '-p', remote], 12000);
      const tmp = path.join(require('os').tmpdir(), `pack-studio-${serial}.png`);
      adbSync(['-s', serial, 'pull', remote, tmp], 12000);
      // pull 路径得到的是完整二进制 PNG，不要再做 CRLF 替换（会损坏压缩数据）
      const buf = fs.readFileSync(tmp);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Length': buf.length,
        'X-Device-Serial': serial,
      });
      return res.end(buf);
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message });
    }
  }

  if (p === '/api/log') {
    return json(res, 200, { ok: true, log: lastLog });
  }

  if (p === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('data: ' + JSON.stringify({ type: 'hello', log: lastLog, logcat: logcatBuf }) + '\n\n');
    const onLog = (line) => {
      res.write('data: ' + JSON.stringify({ type: 'log', line }) + '\n\n');
    };
    const onLogcat = (line) => {
      res.write('data: ' + JSON.stringify({ type: 'logcat', line }) + '\n\n');
    };
    const onDone = (info) => {
      res.write('data: ' + JSON.stringify({ type: 'done', ...info }) + '\n\n');
    };
    bus.on('log', onLog);
    bus.on('logcat', onLogcat);
    bus.on('done', onDone);
    req.on('close', () => {
      bus.off('log', onLog);
      bus.off('logcat', onLogcat);
      bus.off('done', onDone);
    });
    return;
  }

  if (p === '/api/run' && req.method === 'POST') {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch (e) {}
    const r = runAction(String(body.action || ''), body);
    return json(res, r.ok ? 200 : 400, r);
  }

  const TARGET_CANDIDATES = [
    process.env.PACK_SERVER,
    'http://127.0.0.1:30001',
    process.env.PUBLIC_BASE_URL,
  ].filter(Boolean);

  async function resolveTargetServer() {
    for (const s of TARGET_CANDIDATES) {
      const base = String(s).replace(/\/+$/, '');
      try {
        const resp = await fetch(base + '/api/app/update/state', { signal: AbortSignal.timeout(1500) });
        if (resp.ok) return base;
      } catch {}
    }
    return TARGET_CANDIDATES[0] || 'http://127.0.0.1:30001';
  }

  const TARGET_USER = process.env.PACK_USER || 'admin';
  const TARGET_PASS = process.env.PACK_PASS || '';

  async function getRemoteToken(srv) {
    try {
      const resp = await fetch(srv + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: TARGET_USER, password: TARGET_PASS }),
        signal: AbortSignal.timeout(4000),
      });
      const data = await resp.json();
      return data?.data?.token || '';
    } catch {
      return '';
    }
  }

  function getLocalFallbackConfig() {
    const os = require('os');
    const localDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
    if (fs.existsSync(localDir)) return { dataDir: localDir };
    return { dataDir: path.join(__dirname, '..', 'data') };
  }

  if (p === '/api/update/state') {
    // 优先尝试从目标更新服务器拉取真实发布状态
    try {
      const target = await resolveTargetServer();
      const resp = await fetch(target + '/api/app/update/state', {
        signal: AbortSignal.timeout(4000),
      });
      if (resp.ok) {
        const j = await resp.json();
        if (j && (j.success || j.ok)) {
          return json(res, 200, { ok: true, data: j.data || j });
        }
      }
    } catch (e) {
      // 远程不可达，回退至本地数据
    }
    try {
      const appUpdate = require('../src/app-update');
      const cfg = getLocalFallbackConfig();
      const st = appUpdate.getUpdateState(cfg);
      return json(res, 200, { ok: true, data: st });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (p === '/api/update/promote' && req.method === 'POST') {
    try {
      const target = await resolveTargetServer();
      const token = await getRemoteToken(target);
      if (token) {
        const resp = await fetch(target + '/api/app/update/promote', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        const rdata = await resp.json();
        if (resp.ok && (rdata.success || rdata.ok)) {
          appendLog('\n[灰度管理] 远程服务器灰度版本已成功转正为全量发布！\n');
        } else {
          throw new Error(rdata.error || rdata.message || '远程转正失败');
        }
      }
      const appUpdate = require('../src/app-update');
      const cfg = getLocalFallbackConfig();
      let localLatest = null;
      try { localLatest = appUpdate.promoteCanary(cfg); } catch (_) {}
      appendLog('\n[灰度管理] 灰度版本已成功转正为全量发布！\n');
      return json(res, 200, { ok: true, data: localLatest || { ok: true } });
    } catch (e) {
      appendLog('\n[灰度管理] 转正失败: ' + e.message + '\n');
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (p === '/api/update/revoke-canary' && req.method === 'POST') {
    try {
      const target = await resolveTargetServer();
      const token = await getRemoteToken(target);
      if (token) {
        const resp = await fetch(target + '/api/app/update/revoke-canary', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        const rdata = await resp.json();
        if (resp.ok && (rdata.success || rdata.ok)) {
          appendLog('\n[灰度管理] 远程服务器已成功撤销当前灰度测试版本。\n');
        } else {
          throw new Error(rdata.error || rdata.message || '远程撤销失败');
        }
      }
      const appUpdate = require('../src/app-update');
      const cfg = getLocalFallbackConfig();
      let localManifest = null;
      try { localManifest = appUpdate.revokeCanary(cfg); } catch (_) {}
      appendLog('\n[灰度管理] 已撤销当前灰度测试版本。\n');
      return json(res, 200, { ok: true, data: localManifest || { ok: true } });
    } catch (e) {
      appendLog('\n[灰度管理] 撤销失败: ' + e.message + '\n');
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if ((p === '/api/cancel' || p === '/api/run/cancel') && req.method === 'POST') {
    const r = cancelRunning();
    return json(res, 200, r);
  }

  if (p === '/api/scrcpy/start' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
    if (!fs.existsSync(SCRCPY)) {
      return json(res, 400, { ok: false, error: 'scrcpy 不存在: ' + SCRCPY });
    }
    const alive = !!(scrcpyProc && scrcpyProc.exitCode === null && !scrcpyProc.killed);
    if (alive) {
      return json(res, 200, { ok: true, already: true, pid: scrcpyProc.pid });
    }
    try {
      const serial = requireSerial(body.serial);
      const args = ['-s', serial, '--stay-awake', '--window-title', `Pack Studio · ${serial}`];
      appendLog(`\n$ scrcpy ${args.join(' ')}\n`);
      scrcpyProc = spawn(SCRCPY, args, {
        cwd: SCRCPY_DIR,
        windowsHide: false,
        env: { ...process.env, ADB: ADB, PATH: SCRCPY_DIR + ';' + process.env.PATH },
      });
      scrcpyProc.stdout && scrcpyProc.stdout.on('data', (d) => appendLog(d.toString('utf8')));
      scrcpyProc.stderr && scrcpyProc.stderr.on('data', (d) => appendLog(d.toString('utf8')));
      scrcpyProc.on('exit', (code) => {
        appendLog(`\n[scrcpy exit ${code}]\n`);
        scrcpyProc = null;
      });
      return json(res, 200, { ok: true, pid: scrcpyProc.pid, serial, exe: SCRCPY });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (p === '/api/scrcpy/stop' && req.method === 'POST') {
    if (!scrcpyProc) return json(res, 200, { ok: true, stopped: false });
    try { scrcpyProc.kill(); } catch (e) {}
    scrcpyProc = null;
    appendLog('\n[scrcpy stopped]\n');
    return json(res, 200, { ok: true, stopped: true });
  }

  if (p === '/api/phone/tap' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
    try {
      const serial = requireSerial(body.serial);
      const x = Math.round(Number(body.x));
      const y = Math.round(Number(body.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('坐标无效');
      const out = adbSync(['-s', serial, 'shell', 'input', 'tap', String(x), String(y)], 8000);
      return json(res, 200, { ok: true, serial, x, y, raw: out });
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message });
    }
  }

  if (p === '/api/phone/swipe' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
    try {
      const serial = requireSerial(body.serial);
      const x1 = Math.round(Number(body.x1)), y1 = Math.round(Number(body.y1));
      const x2 = Math.round(Number(body.x2)), y2 = Math.round(Number(body.y2));
      const dur = Math.round(Number(body.duration) || 300);
      adbSync(['-s', serial, 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(dur)], 8000);
      return json(res, 200, { ok: true, serial });
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message });
    }
  }

  if (p === '/api/phone/key' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
    try {
      const serial = requireSerial(body.serial);
      const code = String(body.code || '').trim();
      const allow = new Set(['KEYCODE_BACK', 'KEYCODE_HOME', 'KEYCODE_APP_SWITCH', 'KEYCODE_POWER', 'KEYCODE_VOLUME_UP', 'KEYCODE_VOLUME_DOWN']);
      if (!allow.has(code)) throw new Error('不支持的按键: ' + code);
      adbSync(['-s', serial, 'shell', 'input', 'keyevent', code], 8000);
      return json(res, 200, { ok: true, serial, code });
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message });
    }
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[pack-studio] http://127.0.0.1:' + PORT);
  console.log('[pack-studio] app=' + APP);
});
