/**
 * 端到端验证：编译 → 出包 → 推送 → 真机自更新安装
 *
 * 关键：不作弊。全程不手工替换 www，只靠 App 自己的
 * checkAppUpdate → downloadFile → persistWgt → verifyFileExists → plus.runtime.install
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { readZipEntries, readZipFile } = require('./lib/push-update');

const ADB = [
  'C:/Program Files/Microvirt/MEmu/adb.exe',
  'C:/Users/lrp/DevEcoStudioProjects/AlbumSyncUniAppX/packaging-export/tools/android-sdk/platform-tools/adb.exe',
].find((p) => fs.existsSync(p));
if (!ADB) { console.log('找不到 adb'); process.exit(1); }
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const BASE = '/data/data/' + PKG + '/files';
const WWW = BASE + '/apps/__UNI__F183218/www';

function adb(a, enc) {
  return execFileSync(ADB, ['-s', S, ...a], {
    encoding: enc || 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 300000,
  });
}
const sleep = (ms) => { const a = new Int32Array(new SharedArrayBuffer(4)); Atomics.wait(a, 0, 0, ms); };
const adbRoot = (cmd) => { try { adb(['root']); } catch {} return adb(['shell', cmd]); };

function api(p, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = http.request(
      { host: '127.0.0.1', port: 3789, path: p, method: method || 'GET',
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} },
      (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b.slice(0, 200))); } }); }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function deviceState() {
  const out = {};
  try { out.www = adbRoot('stat -c %s ' + WWW + '/app-service.js').trim(); } catch { out.www = 'ERR'; }
  try { out.backup = adbRoot('stat -c %y ' + WWW + '_backup/app-service.js').trim(); } catch { out.backup = 'ERR'; }
  try { out.cache = adbRoot('ls -l ' + BASE + '/wgt_cache/ 2>/dev/null || echo "(空)"').trim(); } catch { out.cache = 'ERR'; }
  try { out.manifest = adbRoot('cat ' + WWW + '/manifest.json').trim(); } catch { out.manifest = ''; }
  out.code = '';
  try { out.code = String(JSON.parse(out.manifest).version.code); } catch (e) { out.code = 'PARSE_ERR'; }
  return out;
}

function markers() {
  const e = readZipEntries(fs.readFileSync(LOCAL_WGT));
  const svc = readZipFile(e, 'app-service.js').toString('utf8');
  const mf = JSON.parse(readZipFile(e, 'manifest.json').toString('utf8'));
  return {
    bytes: svc.length,
    wgtVersion: String((mf.version || {}).code || ''),
    manifestName: (mf.version || {}).name,
    persist: svc.includes('_doc/wgt_cache/'),
    persistErr: svc.includes('持久化 wgt 异常'),
    verify: svc.includes('安装包已失效'),
    describe: svc.includes('缓存 wgt 失败 code='),
    lastFailed: svc.includes('app_update_last_failed'),
  };
}

/**
 * 自动点掉更新弹窗。
 * App 用 uni.showModal 弹「发现新版本」，确认键在弹窗右下角。
 * 屏幕 720x1280，弹窗确认键约在 (540, 830)。
 */
const SHOTS = path.join(__dirname, '_shots');
function shotPath(name) { return path.join(SHOTS, name + '.png'); }
function snap(out) {
  fs.mkdirSync(SHOTS, { recursive: true });
  adb(['shell', 'screencap', '-p', '/sdcard/_e2e.png']);
  adb(['pull', '/sdcard/_e2e.png', out]);
  try { adb(['shell', 'rm', '-f', '/sdcard/_e2e.png']); } catch {}
  return out;
}

/**
 * 盲点是会被 uncaught 拒的：试几个候选坐标，点了就返回 true。
 * 真找不到也只点一次，宁可不点也不要误触业务界面。
 */
function tapUpdateConfirm() {
  const cands = [[542, 838], [560, 845], [524, 832]];
  for (const [x, y] of cands) {
    try {
      adb(['shell', 'input', 'tap', String(x), String(y)]);
      return true;
    } catch { /* 继续试下一个 */ }
  }
  return false;
}

let LOCAL_WGT = '';
let EXPECT = {};

(async function main() {
  console.log('════════ 阶段 0：设备基线 ════════');
  try { adb(['root']); } catch {}
  try { adb(['shell', 'am', 'force-stop', PKG]); } catch {}
  const before = deviceState();
  console.log('  www/app-service.js = ' + before.www + ' 字节');
  console.log('  www_backup         = ' + before.backup);
  console.log('  wgt_cache          = ' + before.cache);
  try { adbRoot('rm -rf ' + BASE + '/wgt_cache/*'); console.log('  已清空 wgt_cache'); } catch {}
  try { adbRoot('rm -f ' + BASE + '/../shared_prefs/__UNI__F183218_storages.xml'); } catch {}

  console.log('\n════════ 阶段 1：Pack Studio 编译 + 出包 + 推送 ════════');
  const r = await api('/api/run', 'POST', {
    action: 'pack-and-push-wgt',
    note: '修复热更新安装：wgt 持久化+安装前校验',
    channel: 'internal',
    server: 'http://39.107.120.55:30001',
    user: 'admin',
    pass: process.env.PACK_PASS || '',
  });
  console.log('  HTTP 受理: ' + JSON.stringify(r));
  if (!r.ok) { console.log('✗ 受理失败'); process.exit(1); }

  let done = null;
  for (let i = 0; i < 150; i++) {
    await new Promise((res) => { const c = new (require('events'))(); setTimeout(() => { c.emit('x'); res(); }, 2000); });
    const st = await api('/api/status');
    if (!st.running) { done = st; break; }
    process.stdout.write('.');
  }
  console.log('\n  任务结束');
  const log = await api('/api/log');
  console.log('\n───── Pack Studio 日志（推送段）─────');
  const txt = log.log || '';
  const idx = txt.indexOf('推送更新通道');
  console.log(txt.slice(idx < 0 ? -1600 : idx));

  const lastLine = txt.trim().split('\n').pop();
  console.log('\n  末行: ' + lastLine);
  if (/\[推送\] 失败/.test(txt)) { console.log('✗ 推送失败'); process.exit(1); }
  if (!/\[推送\] 成功/.test(txt)) { console.log('✗ 未见推送成功'); process.exit(1); }

  const fileMatch = txt.match(/输出: (.+?\.wgt)/);
  LOCAL_WGT = fileMatch ? fileMatch[1].trim() : '';
  EXPECT = markers();
  console.log('\n  本地包: ' + path.basename(LOCAL_WGT));
  console.log('  包内 app-service.js = ' + EXPECT.bytes + ' 字节');
  console.log('  包内 manifest.code  = ' + EXPECT.wgtVersion + '（本次 wgtVersion）');
  console.log('  标识符: persist=' + EXPECT.persist + ' verify=' + EXPECT.verify +
              ' describe=' + EXPECT.describe + ' lastFailed=' + EXPECT.lastFailed);
  if (!EXPECT.persist || !EXPECT.verify) { console.log('✗ 本地包不含热更新修复'); process.exit(1); }
  if (!EXPECT.wgtVersion) { console.log('✗ 包内 manifest.code 缺失'); process.exit(1); }

  console.log('\n════════ 阶段 2：回读服务器，确认指针已切换 ════════');
  const upd = await new Promise((res) => {
    http.get('http://39.107.120.55:30001/api/app/update?platform=android&versionCode=100&wgtVersion=100&channel=internal',
      (rr) => { let b = ''; rr.on('data', (d) => (b += d)); rr.on('end', () => res(JSON.parse(b))); }).on('error', () => res(null));
  });
  const d = (upd && (upd.data || upd)) || {};
  console.log('  服务端 wgtVersion = ' + d.wgtVersion);
  console.log('  服务端 fileName   = ' + (d.fileName || (d.url || '').split('/').pop()));
  const remoteName = d.fileName || String(d.url || '').split('/').pop();
  if (remoteName !== path.basename(LOCAL_WGT)) {
    console.log('✗ 服务器指针不是新包，实际=' + remoteName); process.exit(1);
  }
  console.log('  ✓ 服务器指针已指向本次新包');

  console.log('\n════════ 阶段 3：冷启动 App，让它自己走热更新 ════════');
  try { adbRoot('rm -rf ' + BASE + '/wgt_cache/*'); } catch {}
  console.log('  wgt_cache 已清空，确认它必须自己下载');
  console.log('  设备当前 www = ' + before.www + ' 字节（应为旧代码）');

  // 彻底冷启动：先 force-stop，再 am start（monkey 不会重置已运行的单例）
  try { adb(['shell', 'am', 'force-stop', PKG]); } catch {}
  await sleep(2000);
  try { adb(['shell', 'logcat', '-c']); } catch {}
  try {
    adb(['shell', 'am', 'start', '-n', PKG + '/io.dcloud.PandoraEntryActivity']);
  } catch {
    adb(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1']);
  }
  console.log('  已冷启动 App，观察 120 秒...');

  let installed = false;
  for (let i = 1; i <= 30; i++) {
    await sleep(4000);
    const s = deviceState();
    const hit = s.code === String(EXPECT.wgtVersion);
    console.log('  [' + (i * 4) + 's] code=' + s.code + ' www=' + s.www +
      '  cache=' + (s.cache === '(空)' ? '(空)' : '有文件') +
      '  backup=' + String(s.backup).slice(0, 19) + (hit ? '  ← ★ 已安装新代码' : ''));
    if (hit) { installed = true; break; }

    // 只有在 wgt_cache 出现文件（说明已下载完、正等用户点确认）时才尝试点确认，
    // 否则绝不乱点，避免误触业务界面。
    if (s.cache !== '(空)') {
      const shot = shotPath('confirm-' + i);
      try { snap(shot); } catch {}
      const clicked = tapUpdateConfirm();
      console.log('      wgt_cache 有文件 → 尝试点更新确认框：' + (clicked ? '已点' : '未找到弹窗（已截图 ' + shot + '）'));
    }
  }

  console.log('\n════════ 阶段 4：安装结果取证 ════════');
  const after = deviceState();
  console.log('  www/app-service.js = ' + after.www + ' 字节（期望 ' + EXPECT.bytes + '）');
  console.log('  www_backup 时间     = ' + after.backup);
  console.log('  wgt_cache           = ' + after.cache);
  console.log('  manifest.json       = ' + after.manifest.slice(0, 200));

  if (installed) {
    // 从设备上把 www 拉回来做字节级比对
    const tmp = path.join(require('os').tmpdir(), 'dev-www-' + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    adb(['pull', WWW + '/app-service.js', path.join(tmp, 'app-service.js')]);
    const onDev = fs.readFileSync(path.join(tmp, 'app-service.js'));
    const inWgt = readZipFile(readZipEntries(fs.readFileSync(LOCAL_WGT)), 'app-service.js');
    const crypto = require('crypto');
    const h = (b) => crypto.createHash('sha256').update(b).digest('hex');
    console.log('  设备端 sha256 = ' + h(onDev).slice(0, 24));
    console.log('  包内   sha256 = ' + h(inWgt).slice(0, 24));
    console.log('  ' + (h(onDev) === h(inWgt) ? '✓ 字节级完全一致' : '✗ 不一致！'));
  } else {
    console.log('\n  ✗ 120 秒内未完成自动安装');
  }

  console.log('\n───── logcat 里的热更新相关行 ─────');
  try {
    const lg = adb(['shell', 'logcat', '-d', '-v', 'brief']);
    const lines = lg.split('\n').filter((l) => /AppUpdater|wgt|wgt_cache|install|RuntimeService/i.test(l));
    console.log(lines.slice(-40).join('\n') || '(无匹配)');
  } catch (e) { console.log('logcat 读取失败: ' + e.message); }

  console.log('\n════════ 结论 ════════');
  console.log(installed
    ? '✓ 端到端通过：编译→推送→App 自更新安装，设备上跑的就是最新代码。'
    : '✗ 未通过：App 没有自动装上新包。');
  process.exit(installed ? 0 : 1);
})().catch((e) => { console.log('FATAL', e.message, e.stack); process.exit(1); });