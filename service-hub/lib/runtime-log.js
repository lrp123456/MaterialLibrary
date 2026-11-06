/**
 * 运行日志的纯函数：启动挂起文件、增量读、致命行。
 * 不拉进程、不访问生产目录，方便单测。
 */
const fs = require('fs');
const path = require('path');

/** 进程级 / App 崩溃。刻意不匹配 JSON 里的 "error":，避免把上游 429 刷进致命列表。 */
const FATAL_RE = /EADDRINUSE|Cannot find module|MODULE_NOT_FOUND|UnhandledPromise|uncaughtException|未捕获|FATAL EXCEPTION|AndroidRuntime|JavaScript heap|SQLITE_|better_sqlite3|SyntaxError|ReferenceError|TypeError:|RangeError:|listen E[A-Z]+|启动失败|ENOSPC|EACCES|JSException|Maximum call stack|^\s*Error:|\] Error:/;

/** adb logcat 里留下的 App / 运行时行。整机日志太吵，面板只收这些。 */
const APP_LINE_RE = /lrp\.aibum|DCloud|dcloud|Pandora|WeexCore|weex|JSF|jsengine|AndroidRuntime|FATAL|JSException|uni-app|chromium|hwschromium/i;

const HOLD_NAMES = ['main', 'webpro'];

function isNoiseLine(line) {
  const l = String(line || '').trim();
  if (!l) return true;
  if (/^\s*at /.test(l)) return true;
  if (/^[{}]$/.test(l)) return true;
  if (/^(code|errno|syscall|address|port|requireStack):/.test(l)) return true;
  return false;
}

function pickReason(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((l) => !isNoiseLine(l));
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FATAL_RE.test(lines[i])) return lines[i].slice(0, 400);
  }
  if (!lines.length) return '';
  return lines[lines.length - 1].slice(0, 400);
}

function lineIsFatal(line) {
  const l = String(line || '').trim();
  if (isNoiseLine(l)) return false;
  return FATAL_RE.test(l);
}

function scanFatals(source, text, limit = 20) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!lineIsFatal(line)) continue;
    out.push({ source, line: line.slice(0, 400) });
  }
  if (out.length > limit) return out.slice(-limit);
  return out;
}

function parseHold(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const sep = raw.search(/\r?\n---\r?\n/);
  let head = raw;
  let tail = '';
  if (sep >= 0) {
    head = raw.slice(0, sep);
    tail = raw.slice(sep).replace(/^\r?\n---\r?\n/, '');
  }
  const fields = {};
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) fields[line.slice(0, i)] = line.slice(i + 1);
  }
  const exitRaw = fields.exit_code;
  const exitCode = exitRaw == null || exitRaw === '' ? null : Number(exitRaw);
  return {
    service: fields.service || '',
    label: fields.label || fields.service || '',
    port: Number(fields.port) || 0,
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    uptimeSec: Number(fields.uptime_sec) || 0,
    at: fields.at || '',
    kind: fields.kind || '',
    reason: fields.reason || pickReason(tail) || '进程退出，没有读到报错',
    tail: tail.trim(),
  };
}

function readFaultDir(dir) {
  const faults = [];
  for (const name of HOLD_NAMES) {
    const file = path.join(dir, `${name}.hold`);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') continue;
      faults.push({
        service: name,
        label: name,
        port: 0,
        exitCode: null,
        uptimeSec: 0,
        at: '',
        kind: '',
        reason: '挂起文件读失败：' + (e && e.message ? e.message : String(e)),
        tail: '',
      });
      continue;
    }
    faults.push(parseHold(text));
  }
  return faults;
}

/**
 * 从字节游标增量读日志。cursor 为空表示第一次，只取文件末尾一段。
 * 未写完的最后一行先留住，避免把半行送进致命行识别。
 */
function readTail(file, cursor, opts = {}) {
  const initialBytes = opts.initialBytes || 32768;
  const maxBytes = opts.maxBytes || 65536;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, error: '日志还不存在', text: '', next: 0, size: 0 };
    return { ok: false, error: e.message || String(e), text: '', next: 0, size: 0 };
  }
  const size = stat.size;
  let start;
  if (cursor == null || cursor === '' || !Number.isFinite(Number(cursor))) {
    start = Math.max(0, size - initialBytes);
  } else {
    start = Number(cursor);
    if (start < 0 || start > size) start = Math.max(0, size - initialBytes);
  }
  const len = Math.min(maxBytes, Math.max(0, size - start));
  if (len === 0) return { ok: true, text: '', next: size, size };
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  let dropLeading = false;
  try {
    if (start > 0) {
      const prev = Buffer.alloc(1);
      fs.readSync(fd, prev, 0, 1, start - 1);
      dropLeading = prev[0] !== 0x0a;
    }
    fs.readSync(fd, buf, 0, len, start);
  } finally {
    fs.closeSync(fd);
  }
  let text = buf.toString('utf8');
  if (dropLeading) {
    const nl = text.indexOf('\n');
    if (nl >= 0) text = text.slice(nl + 1);
    else if (len < maxBytes) return { ok: true, text: '', next: start, size };
  }
  let next = start + len;
  const atEof = next >= size;
  const lastNl = text.lastIndexOf('\n');
  if (lastNl >= 0) {
    const rest = text.slice(lastNl + 1);
    if (rest) {
      next -= Buffer.byteLength(rest);
      text = text.slice(0, lastNl + 1);
    }
  } else if (atEof) {
    // 文件末尾还没换行，行没写完，先不往外送
    return { ok: true, text: '', next: start, size };
  }
  return { ok: true, text, next, size };
}

function parseAdbDevices(text) {
  const devices = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(\S+)\s+device(?:\s|$)/.exec(line.trim());
    if (!m) continue;
    if (m[1] === 'List') continue;
    if (!/^[\w.:-]+$/.test(m[1])) continue;
    devices.push(m[1]);
  }
  return devices;
}

function lineMatchesApp(line) {
  return APP_LINE_RE.test(String(line || ''));
}

module.exports = {
  FATAL_RE,
  APP_LINE_RE,
  HOLD_NAMES,
  pickReason,
  lineIsFatal,
  scanFatals,
  parseHold,
  readFaultDir,
  readTail,
  parseAdbDevices,
  lineMatchesApp,
};
