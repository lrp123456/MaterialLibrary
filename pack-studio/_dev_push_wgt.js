/**
 * _dev_push_wgt.js · v2 —— 本地解压 wgt 后 push 目录到设备
 *
 * 上一版失败原因：设备（雷电）没有 unzip 命令。
 * 改成：Node 本地解 zip → adb push 目录 → 原地替换 app 的 www。
 * 这等价于 plus.runtime.install(wgt) 的最终结果。
 *
 * 安全：先备份 www 到 /data/local/tmp，任何一步失败自动回滚。
 */
const http = require('http');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ADB = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe';
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const APPID = '__UNI__F183218';
const WWW = `/data/data/${PKG}/files/apps/${APPID}/www`;
const BK = '/data/local/tmp/www_bk';
const BASE = process.env.PUBLIC_BASE_URL;
if (!BASE) { console.error('请设置环境变量 PUBLIC_BASE_URL'); process.exit(1); }
const MARKERS = ['home_library_tab', 'trash-src-bar', 'disposeSource', 'back-to-top', 'takeRemovals'];

function req2(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: method || 'GET', headers: headers || {}, timeout: 90000,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('TIMEOUT')); });
    if (body) r.write(body);
    r.end();
  });
}
function adb(args) {
  return execFileSync(ADB, ['-s', S, ...args], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300000,
  });
}
function tryAdb(args) {
  try { return adb(args); } catch (e) { return 'ERR:' + (e.stdout || '') + (e.stderr || e.message); }
}
function sh(c) { return tryAdb(['shell', c]); }

function readCentralDirectory(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    out.push({ name, method, compSize, localOff });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}
function readEntry(buf, e) {
  const lo = e.localOff;
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.slice(start, start + e.compSize);
  return e.method === 0 ? raw : zlib.inflateRawSync(raw);
}

(async () => {
  // ── 1. 拿到 wgt ──────────────────────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw2-'));
  let wgtPath = process.argv[2];
  if (wgtPath && fs.existsSync(wgtPath)) {
    console.log('① 用本地 wgt: ' + wgtPath);
  } else {
    console.log('① 登录并下载服务器当前 wgt');
    const lb = JSON.stringify({ username: 'admin', password: process.env.PACK_PASS || '' });
    const lr = await req2(`${BASE}/api/auth/login`, 'POST',
      { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(lb) }, lb);
    const token = (JSON.parse(lr.body.toString('utf8')).data || {}).token || '';
    const u = await req2(`${BASE}/api/app/update/files/album-sync-2030005-20261003114611.wgt`, 'GET',
      { Authorization: 'Bearer ' + token });
    wgtPath = path.join(tmp, 'remote.wgt');
    fs.writeFileSync(wgtPath, u.body);
    console.log('   HTTP ' + u.status + '  ' + u.body.length + ' 字节  md5=' +
      crypto.createHash('md5').update(u.body).digest('hex'));
  }

  // ── 2. 本地解压 ─────────────────────────────────
  console.log('\n② 本地解压 wgt');
  const buf = fs.readFileSync(wgtPath);
  const entries = readCentralDirectory(buf);
  const exDir = path.join(tmp, 'www');
  fs.mkdirSync(exDir, { recursive: true });
  let n = 0;
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const out = path.join(exDir, e.name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, readEntry(buf, e));
    n++;
  }
  console.log('   解出 ' + n + ' 个文件 → ' + exDir);
  const svcLocal = fs.readFileSync(path.join(exDir, 'app-service.js'));
  console.log('   app-service.js 字节=' + svcLocal.length);
  console.log('   sha256=' + crypto.createHash('sha256').update(svcLocal).digest('hex'));
  const mf = JSON.parse(fs.readFileSync(path.join(exDir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
  console.log('   manifest version=' + JSON.stringify(mf.version));
  const pages = [...new Set(entries.map((e) => e.name).filter((x) => x.startsWith('pages/') && x.endsWith('.js')).map((x) => x.split('/')[1]))].sort();
  console.log('   pages: ' + pages.join(' '));
  console.log('   有 trash 页: ' + (pages.includes('trash') ? 'YES' : 'NO'));

  // ── 3. 备份 ─────────────────────────────────────
  console.log('\n③ 设备端备份当前 www');
  sh(`rm -rf ${BK} && cp -a ${WWW} ${BK} && echo backed_up`);
  const cur = sh(`stat -c '%s' ${WWW}/app-service.js 2>/dev/null || echo 0`).trim();
  console.log('   备份完成，当前 app-service.js 字节=' + cur);

  // ── 4. push 新 www ──────────────────────────────
  console.log('\n④ push 新 www 到设备');
  const DEV = '/data/local/tmp/www_new';
  sh(`rm -rf ${DEV} && mkdir -p ${DEV}`);
  console.log('   push: ' + exDir + ' → ' + DEV);
  adb(['push', exDir + '/.', DEV]);
  const devList = sh(`ls ${DEV}`).split(/\r?\n/).filter(Boolean);
  console.log('   设备上 ' + devList.length + ' 个顶层条目');

  // ── 5. 原子替换 ─────────────────────────────────
  console.log('\n⑤ 替换 app 的 www');
  const cmd = [
    `am force-stop ${PKG}`,
    `rm -rf ${WWW}.new`,
    `cp -a ${DEV} ${WWW}.new`,
    `chown -R u0_a79:u0_a79 ${WWW}.new`,
    `chmod -R 771 ${WWW}.new`,
    `rm -rf ${WWW}`,
    `mv ${WWW}.new ${WWW}`,
    `chown -R u0_a79:u0_a79 ${WWW}`,
    `chmod 771 ${WWW}`,
    `echo replaced`,
  ].join(' ; ');
  const r5 = sh(cmd);
  console.log('   ' + r5.trim().split(/\r?\n/).pop());

  const after = sh(`stat -c '%s' ${WWW}/app-service.js 2>/dev/null || echo MISS`).trim();
  console.log('   新 app-service.js 字节=' + after);
  const mfNew = sh(`grep -o '"version":{[^}]*}' ${WWW}/manifest.json 2>/dev/null | head -1`).trim();
  console.log('   manifest: ' + mfNew);
  const hits = sh(`for m in ${MARKERS.join(' ')}; do echo "$m=$(grep -c -- "$m" ${WWW}/app-service.js 2>/dev/null || echo 0)"; done`).trim();
  console.log('   标识符:\n' + hits.split(/\r?\n/).map((l) => '     ' + l).join('\n'));
  const pagesNew = sh(`ls ${WWW}/pages 2>/dev/null | tr '\n' ' '`).trim();
  console.log('   pages: ' + pagesNew);

  const ok = after === String(svcLocal.length);
  console.log('\n' + (ok ? '✓ 设备端已换成新代码' : '✗ 字节不匹配！预期 ' + svcLocal.length + ' 实际 ' + after));
  console.log('回滚命令: adb -s ' + S + ' shell "rm -rf ' + WWW + ' && cp -a ' + BK + ' ' + WWW + '"');
  console.log('本地解包: ' + exDir);
})().catch((e) => console.log('FATAL ' + e.message + '\n' + (e.stack || '')));
