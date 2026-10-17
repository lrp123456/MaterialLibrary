/**
 * _e2e_update_test.js · 端到端验证「修复后的热更新能不能真的装上」
 *
 * 步骤：
 *   1. 让 Pack Studio 隔离编译 + 出包 + 推送（含修复后的 AppUpdater）
 *   2. 校验推送出去的 wgt 里含新代码 + 包内 manifest 版本 == 服务端 wgtVersion
 *   3. 把设备回滚到「旧代码」状态（模拟用户不更新的情形）
 *   4. 让 App 自己走一遍 checkAppUpdate → 下载 → 安装
 *   5. 检查设备 www 是否真的换成新代码
 *
 * 注意：第 4 步需要 App 弹窗交互，用 UI 自动化点。
 */
const http = require('http');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ADB = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe';
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const APPID = '__UNI__F183218';
const WWW = `/data/data/${PKG}/files/apps/${APPID}/www`;
const WWW_BK = '/data/local/tmp/www_old_for_e2e';
const PS = 'http://127.0.0.1:3789';
const SRV = 'http://39.107.120.55:30001';
const SHOTS = path.join('C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer\\pack-studio', '_shots');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function adb(a, e) { return execFileSync(ADB, ['-s', S, ...a], { encoding: e || 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300000 }); }
function sh(c) { try { return adb(['shell', c]).trim(); } catch (e) { return 'ERR:' + e.message; } }
let N = 400;
function shot(n) { N++; if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, N + '_' + n + '.png');
  try { sh('screencap -p /sdcard/_s.png'); fs.writeFileSync(f, adb(['exec-out','cat','/sdcard/_s.png'],'buffer')); sh('rm -f /sdcard/_s.png'); console.log('   📷 ' + path.basename(f)); } catch (e) { console.log('   📷 失败'); } return f; }
function tap(x, y, t) { sh(`input tap ${x} ${y}`); console.log(`   👆 ${t} @${x},${y}`); }

function ps(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const q = http.request({ hostname: '127.0.0.1', port: 3789, path: '/api/run', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 600000 },
      (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => resolve({ s: r.statusCode, b })); });
    q.on('error', e => resolve({ s: 0, b: e.message }));
    q.write(data); q.end();
  });
}
function status() {
  return new Promise((resolve) => {
    http.get(PS + '/api/status', { timeout: 8000 }, (r) => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve({}); } });
    }).on('error', () => resolve({}));
  });
}
function srvReq(pathname, method, headers, body) {
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
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16); const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10), compSize = buf.readUInt32LE(off + 20);
    const nl = buf.readUInt16LE(off + 28), el = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32);
    const lo = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nl).toString('utf8');
    out.set(name, { method, compSize, localOff: lo }); off += 46 + nl + el + cl;
  }
  return out;
}
function readEntry(buf, e) {
  const lo = e.localOff, nl = buf.readUInt16LE(lo + 26), el = buf.readUInt16LE(lo + 28);
  const s = lo + 30 + nl + el, raw = buf.slice(s, s + e.compSize);
  return e.method === 0 ? raw : zlib.inflateRawSync(raw);
}

const MARKERS = ['home_library_tab', 'trash-src-bar', 'disposeSource', 'back-to-top', 'takeRemovals', 'persistWgt', 'wgt_cache'];

(async () => {
  console.log('════════ 阶段 1：Pack Studio 出包 + 推送 ════════');
  console.log('（会做一次全新的隔离编译，约 20-40 秒）\n');
  const r = await ps({ action: 'pack-and-push-wgt', note: '修复热更新安装链路', channel: 'internal', server: SRV, user: 'admin', pass: process.env.PACK_PASS || '' });
  console.log('HTTP ' + r.s);
  let j = null; try { j = JSON.parse(r.b); } catch (e) {}
  console.log('响应: ' + (j ? JSON.stringify(j).slice(0, 700) : r.b.slice(0, 700)));

  console.log('\n等待编译完成…');
  let sawRunning = false, last = {};
  for (let i = 0; i < 240; i++) {
    await sleep(2000);
    const st = await status();
    if (st.running) { sawRunning = true; process.stdout.write('.'); continue; }
    if (sawRunning) { last = st; break; }
    if (i > 3 && !st.running) { last = st; break; }
  }
  console.log('\n');
  const lb = last.lastBuild;
  if (lb) {
    console.log('编译收据: exit=' + lb.exitCode + ' 字节=' + lb.appServiceBytes + ' sha=' + String(lb.appServiceSha256).slice(0, 16));
    console.log('标识符: ' + (lb.identityMarkers || []).join(', '));
    console.log('指纹: ' + JSON.stringify(lb.fingerprint || {}));
  } else {
    console.log('⚠ 没有编译收据 —— 可能编译失败');
  }
  const pk = (last.packages || [])[0] || (last.recentPackages || [])[0];
  if (pk) console.log('最新包: ' + JSON.stringify(pk).slice(0, 500));

  console.log('\n════════ 阶段 2：验证服务器上的 wgt ════════');
  const lb2 = JSON.stringify({ username: 'admin', password: process.env.PACK_PASS || '' });
  const lg = await srvReq('/api/auth/login', 'POST', { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(lb2) }, lb2);
  const token = (JSON.parse(lg.b.toString('utf8')).data || {}).token || '';
  console.log('登录 ' + lg.s + (token ? ' OK' : ' FAIL'));
  const upd = await srvReq('/api/app/update?platform=android&versionCode=200&wgtVersion=2020000&channel=internal', 'GET', {});
  const ud = JSON.parse(upd.b.toString('utf8')).data;
  console.log('服务器: hasUpdate=' + ud.hasUpdate + ' wgtVersion=' + ud.wgtVersion + ' url=' + ud.url);
  if (ud.url) {
    const dl = await srvReq(ud.url, 'GET', { Authorization: 'Bearer ' + token });
    console.log('下载 HTTP ' + dl.s + '  ' + dl.b.length + ' 字节');
    const es = readEntries(dl.b);
    const svc = readEntry(dl.b, es.get('app-service.js'));
    const txt = svc.toString('utf8');
    const hits = MARKERS.filter(m => txt.includes(m));
    console.log('包内 app-service.js ' + svc.length + ' 字节, sha=' + crypto.createHash('sha256').update(svc).digest('hex').slice(0, 16));
    console.log('标识符 ' + hits.length + '/' + MARKERS.length + ': ' + hits.join(', '));
    console.log('  persistWgt 在包里: ' + (txt.includes('persistWgt') ? 'YES ✓' : 'NO ✗'));
    const mf = JSON.parse(readEntry(dl.b, es.get('manifest.json')).toString('utf8').replace(/^﻿/, ''));
    console.log('包内 manifest.version=' + JSON.stringify(mf.version) + '  服务端 wgtVersion=' + ud.wgtVersion);
    const tmp = path.join(os.tmpdir(), 'e2e-' + Date.now() + '.wgt');
    fs.writeFileSync(tmp, dl.b);
    console.log('本地留存: ' + tmp);
  }

  console.log('\n════════ 阶段 3：把设备回滚到旧代码 ════════');
  sh(`rm -rf ${WWW_BK} && cp -a ${WWW} ${WWW_BK} && echo ok`);
  console.log('当前 www 字节=' + sh(`stat -c '%s' ${WWW}/app-service.js`));
  console.log('备份 → ' + WWW_BK);
  console.log('（旧代码 = 10-02 的 453808 字节版本，见 /data/local/tmp/www_bk）');
  // 回滚到真正的旧版（10-02 的 453808）
  sh(`rm -rf ${WWW} && cp -a /data/local/tmp/www_bk ${WWW} && chown -R u0_a79:u0_a79 ${WWW} && echo rolled_back`);
  const rolled = sh(`stat -c '%s' ${WWW}/app-service.js`);
  console.log('回滚后 www 字节=' + rolled);
  const rh = sh(`for m in persistWgt wgt_cache takeRemovals; do echo "$m=$(grep -c -- "$m" ${WWW}/app-service.js 2>/dev/null || echo 0)"; done`).replace(/\r?\n/g, '  ');
  console.log('标识符: ' + rh);

  console.log('\n════════ 阶段 4：清掉更新状态，让 App 从零开始 ════════');
  sh(`am force-stop ${PKG}`);
  // 清 storage 里的更新相关 key（用 sqlite3 不可用时，改用重启让 App 自己重置时间戳）
  // 更稳的做法：把 last_check 时间戳改旧 —— 通过 App 自己的 settings 页 force 检查
  console.log('提示：接下来在设备上手动点「设置 → 检查更新」，或等启动 3 秒后的静默检查');
  adb(['logcat', '-c']);
  sh(`am start -n ${PKG}/io.dcloud.PandoraEntryActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER`);
  console.log('启动 App，等 15 秒…');
  sleep(15000);
  shot('E2E_1_launched');
  console.log('（若弹出「发现重要更新」框，点「立即更新」）');

  console.log('\n════════ 阶段 5：观察安装结果 ════════');
  for (let i = 0; i < 10; i++) {
    sleep(6000);
    const sz = sh(`stat -c '%s' ${WWW}/app-service.js 2>/dev/null || echo MISS`);
    const cache = sh(`ls -la /data/data/${PKG}/files/wgt_cache/ 2>/dev/null | tail -3`);
    console.log(`  [${i * 6 + 15}s] www=${sz}  wgt_cache=${cache.replace(/\r?\n/g, ' | ') || '(无)'}`);
    if (String(sz) === '491807') { console.log('  ★ www 已是新代码！'); break; }
  }
  shot('E2E_2_after_update');
  const finalSz = sh(`stat -c '%s' ${WWW}/app-service.js 2>/dev/null || echo MISS`);
  const finalH = sh(`for m in persistWgt wgt_cache takeRemovals; do echo "$m=$(grep -c -- "$m" ${WWW}/app-service.js 2>/dev/null || echo 0)"; done`).replace(/\r?\n/g, '  ');
  console.log('\n最终 www 字节=' + finalSz);
  console.log('最终标识符: ' + finalH);

  const lgB = adb(['logcat', '-d', '-v', 'time'], 'utf8');
  const lf = path.join(SHOTS, 'logcat_e2e.txt');
  fs.writeFileSync(lf, lgB, 'utf8');
  const LL = lgB.split(/\r?\n/).filter(l => /AppUpdater|wgt|install|更新|persistWgt/i.test(l));
  console.log('\nlogcat 命中 ' + LL.length + ' 条 → ' + lf);
  LL.slice(0, 30).forEach(l => console.log('   ' + l.slice(0, 200)));
})().catch(e => console.log('FATAL ' + e.message + '\n' + (e.stack || '')));
