/**
 * _e2e2.js · 端到端：推送新包 → 设备回滚到旧代码 → 让 App 自己更新 → 验证
 */
const http = require('http');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ADB = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe';
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const WWW = `/data/data/${PKG}/files/apps/__UNI__F183218/www`;
const SRV = process.env.PUBLIC_BASE_URL;
if (!SRV) { console.error('请设置环境变量 PUBLIC_BASE_URL'); process.exit(1); }
const SHOTS = path.join('C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer\\pack-studio', '_shots');
const NEW_BYTES = 493128;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function adb(a, e) { return execFileSync(ADB, ['-s', S, ...a], { encoding: e || 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300000 }); }
function sh(c) { try { return adb(['shell', c]).trim(); } catch (e) { return 'ERR:' + e.message; } }
let N = 500;
function shot(n) { N++; if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, N + '_' + n + '.png');
  try { sh('screencap -p /sdcard/_s.png'); fs.writeFileSync(f, adb(['exec-out','cat','/sdcard/_s.png'],'buffer')); sh('rm -f /sdcard/_s.png'); console.log('   📷 ' + path.basename(f)); } catch (e) { console.log('   📷 失败'); } return f; }
function tap(x, y, t) { sh(`input tap ${x} ${y}`); console.log(`   👆 ${t} @${x},${y}`); }

function ps(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const q = http.request({ hostname: '127.0.0.1', port: 3789, path: '/api/run', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 900000 },
      (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => resolve({ s: r.statusCode, b })); });
    q.on('error', e => resolve({ s: 0, b: e.message })); q.write(data); q.end();
  });
}
function get(p) {
  return new Promise((r) => { http.get('http://127.0.0.1:3789' + p, { timeout: 15000 }, (s) => { let b = ''; s.on('data', d => b += d); s.on('end', () => r(b)); }).on('error', e => r('ERR ' + e.message)); });
}
function srv(pathname, method, headers, body) {
  return new Promise((resolve) => {
    const u = new URL(SRV + pathname);
    const q = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: method || 'GET', headers: headers || {}, timeout: 60000 },
      (r) => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => resolve({ s: r.statusCode, b: Buffer.concat(c) })); });
    q.on('error', e => resolve({ s: 0, b: Buffer.from(String(e.message)) }));
    q.on('timeout', () => { q.destroy(); resolve({ s: 0, b: Buffer.from('TIMEOUT') }); });
    if (body) q.write(body); q.end();
  });
}
function readEntries(buf) {
  let e = -1; for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; } }
  const n = buf.readUInt16LE(e + 10); let off = buf.readUInt32LE(e + 16); const m = new Map();
  for (let i = 0; i < n; i++) { if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const me = buf.readUInt16LE(off + 10), cs = buf.readUInt32LE(off + 20);
    const nl = buf.readUInt16LE(off + 28), el = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32);
    const lo = buf.readUInt32LE(off + 42);
    m.set(buf.slice(off + 46, off + 46 + nl).toString('utf8'), { method: me, compSize: cs, localOff: lo });
    off += 46 + nl + el + cl; } return m;
}
function readEntry(buf, e) { const lo = e.localOff, nl = buf.readUInt16LE(lo + 26), el = buf.readUInt16LE(lo + 28);
  const s = lo + 30 + nl + el, raw = buf.slice(s, s + e.compSize);
  return e.method === 0 ? raw : zlib.inflateRawSync(raw); }

(async () => {
  console.log('══════ 1. 推送新包（含热更新修复）══════');
  console.log('触发 pack-and-push-wgt…');
  const r = await ps({ action: 'pack-and-push-wgt', note: '修复热更新安装：wgt 持久化+安装前校验', channel: 'internal', server: SRV, user: 'admin', pass: process.env.PACK_PASS || '' });
  console.log('HTTP ' + r.s + '  ' + r.b.slice(0, 200));
  let saw = false;
  for (let i = 0; i < 300; i++) {
    await sleep(2000);
    const s = await get('/api/status');
    if (s.startsWith('ERR')) { console.log('服务异常'); return; }
    const j = JSON.parse(s);
    if (j.running) { if (!saw) { process.stdout.write('  编译+推送中'); saw = true; } process.stdout.write('.'); continue; }
    if (saw) { process.stdout.write('\n'); break; }
  }
  const lg = JSON.parse(await get('/api/log'));
  console.log(lg.log.split(/\r?\n/).slice(-22).join('\n'));

  console.log('\n══════ 2. 校验服务器上的包 ══════');
  const lb = JSON.stringify({ username: 'admin', password: process.env.PACK_PASS || '' });
  const lgr = await srv('/api/auth/login', 'POST', { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(lb) }, lb);
  const token = (JSON.parse(lgr.b.toString('utf8')).data || {}).token || '';
  const upd = JSON.parse((await srv('/api/app/update?platform=android&versionCode=200&wgtVersion=2020000&channel=internal', 'GET', {})).b.toString('utf8')).data;
  console.log('服务端: wgtVersion=' + upd.wgtVersion + ' url=' + upd.url);
  const dl = await srv(upd.url, 'GET', { Authorization: 'Bearer ' + token });
  const es = readEntries(dl.b);
  const svc = readEntry(dl.b, es.get('app-service.js'));
  const txt = svc.toString('utf8');
  console.log('包内 app-service.js ' + svc.length + ' 字节 (期望 ' + NEW_BYTES + ') ' + (svc.length === NEW_BYTES ? '✓' : '✗'));
  ['persistWgt', 'wgt_cache', 'verifyFileExists', 'takeRemovals', 'trash-src-bar'].forEach((k) =>
    console.log('  ' + (txt.includes(k) ? 'HIT ' : 'MISS') + '  ' + k));
  const mf = JSON.parse(readEntry(dl.b, es.get('manifest.json')).toString('utf8').replace(/^﻿/, ''));
  console.log('包内 manifest.version=' + JSON.stringify(mf.version));

  console.log('\n══════ 3. 设备回滚到旧代码（453808）══════');
  sh(`rm -rf ${WWW} && cp -a /data/local/tmp/www_bk ${WWW} && chown -R u0_a79:u0_a79 ${WWW} && chmod -R 771 ${WWW}`);
  console.log('回滚后 www=' + sh(`stat -c '%s' ${WWW}/app-service.js`));

  console.log('\n══════ 4. 启动 App，走它自己的更新流程 ══════');
  sh(`am force-stop ${PKG}`);
  adb(['logcat', '-c']);
  await sleep(1500);
  sh(`am start -n ${PKG}/io.dcloud.PandoraEntryActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER`);
  console.log('已启动，等 18 秒（App 启动 3 秒后静默检查更新）…');
  await sleep(18000);
  shot('E2E2_1_after_launch');

  // 弹窗通常在中间偏上，截图后人工确认；这里先探测缓存目录
  const cache = sh(`ls -la /data/data/${PKG}/files/wgt_cache/ 2>/dev/null | tail -3`);
  console.log('  wgt_cache: ' + (cache.replace(/\r?\n/g, ' | ') || '(无 —— 还没开始下载)'));

  console.log('\n  若屏幕弹出「发现重要更新」，点「立即更新」…');
  shot('E2E2_2_prompt');

  // 尝试点确认按钮（常见位置：中部偏上 / 右侧）
  const taps = [[470, 700], [470, 660], [470, 720], [360, 700]];
  for (const [x, y] of taps) { tap(x, y, '尝试点「立即更新」'); await sleep(2500); }

  console.log('\n══════ 5. 观察安装结果（最多 90 秒）══════');
  let ok = false;
  for (let i = 0; i < 18; i++) {
    await sleep(5000);
    const sz = sh(`stat -c '%s' ${WWW}/app-service.js 2>/dev/null || echo MISS`);
    const c = sh(`ls /data/data/${PKG}/files/wgt_cache/ 2>/dev/null | tr '\n' ' '`).trim();
    const bk = sh(`stat -c '%y' /data/data/${PKG}/files/apps/__UNI__F183218/www_backup 2>/dev/null | cut -c1-19`).trim();
    console.log(`  [${(i + 1) * 5}s] www=${sz}  cache=${c || '(空)'}  www_backup=${bk || '?'}`);
    if (String(sz) === String(NEW_BYTES)) { console.log('  ★ 安装成功！'); ok = true; break; }
  }
  shot('E2E2_3_result');
  const fin = sh(`stat -c '%s' ${WWW}/app-service.js 2>/dev/null || echo MISS`);
  console.log('\n最终 www = ' + fin + ' (期望 ' + NEW_BYTES + ')');
  const h = sh(`for m in persistWgt wgt_cache verifyFileExists takeRemovals; do echo "$m=$(grep -c -- "$m" ${WWW}/app-service.js 2>/dev/null || echo 0)"; done`).replace(/\r?\n/g, ' ');
  console.log('标识符: ' + h);

  const lgB = adb(['logcat', '-d', '-v', 'time'], 'utf8');
  const lf = path.join(SHOTS, 'logcat_e2e2.txt');
  fs.writeFileSync(lf, lgB, 'utf8');
  const LL = lgB.split(/\r?\n/).filter(l => /AppUpdater|wgt|更新|install|persistWgt/i.test(l));
  console.log('\nlogcat 命中 ' + LL.length + ' → ' + lf);
  LL.slice(0, 25).forEach(l => console.log('   ' + l.slice(0, 190)));
})().catch(e => console.log('FATAL ' + e.message));
