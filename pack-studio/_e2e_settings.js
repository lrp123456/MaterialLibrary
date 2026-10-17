/**
 * 走真实用户路径验证热更新：设置页 →「检查更新」→ 下载 → 持久化 → 安装。
 *
 * 为什么用设置页而不是启动时的静默检查：
 *   启动检查受 silent 节流保护，测试时容易被节流挡在门外，
 *   测出来的「没装上」并不是热更新链路坏了。
 *   设置页的按钮调的是 checkAppUpdate({ silent:false, force:true })，
 *   force 会跳过节流，是用户主动触发的确定性路径。
 *
 * 本脚本不手工替换 www，只负责点按钮 + 观察。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readZipEntries, readZipFile, request } = require('./lib/push-update');

const ADB = [
  'C:/Program Files/Microvirt/MEmu/adb.exe',
  'C:/Users/lrp/DevEcoStudioProjects/AlbumSyncUniAppX/packaging-export/tools/android-sdk/platform-tools/adb.exe',
].find((p) => fs.existsSync(p));
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const WWW = '/data/user/0/' + PKG + '/files/apps/__UNI__F183218/www';
const SHOTS = path.join(__dirname, '_shots');

function adb(a, enc) {
  return execFileSync(ADB, ['-s', S, ...a], {
    encoding: enc || 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180000,
  });
}
const sleep = (ms) => { const a = new Int32Array(new SharedArrayBuffer(4)); Atomics.wait(a, 0, 0, ms); };
const tap = (x, y) => { try { adb(['shell', 'input', 'tap', String(x), String(y)]); return true; } catch { return false; } };

function state() {
  const o = {};
  try { o.code = String(JSON.parse(adb(['shell', 'cat ' + WWW + '/manifest.json'])).version.code); } catch { o.code = '?'; }
  try { o.www = adb(['shell', 'stat -c %s ' + WWW + '/app-service.js']).trim(); } catch { o.www = '?'; }
  try { o.backup = adb(['shell', 'stat -c %y ' + WWW + '_backup/app-service.js']).trim().slice(0, 19); } catch { o.backup = 'none'; }
  try {
    const c = adb(['shell', 'ls -l /data/user/0/' + PKG + '/files/wgt_cache/ 2>/dev/null || true']);
    o.cache = c.includes('.wgt') ? c.split('\n').filter((x) => x.includes('.wgt'))[0].trim().split(/\s+/).pop() : '(空)';
  } catch { o.cache = '(空)'; }
  return o;
}
function snap(name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const out = path.join(SHOTS, name + '.png');
  adb(['shell', 'screencap', '-p', '/sdcard/_v.png']);
  adb(['pull', '/sdcard/_v.png', out]);
  return out;
}
function size(p) { try { return fs.statSync(p).size; } catch { return 0; } }

(async function main() {
  const srv = await request(
    'http://39.107.120.55:30001/api/app/update?platform=android&versionCode=100&wgtVersion=100&channel=internal',
    { method: 'GET', headers: {}, timeout: 30000 }
  );
  const d = (srv.json && srv.json.data) || {};
  const want = String(d.wgtVersion);
  const url = 'http://39.107.120.55:30001' + (d.url || '');
  console.log('服务端 wgtVersion = ' + want);
  console.log('下载地址 = ' + url);

  // 找本地同版本包做 sha256 比对
  const dist = 'C:/Users/lrp/DevEcoStudioProjects/AlbumSyncUniAppX/dist/release/wgt';
  const localWgt = fs.readdirSync(dist).filter((n) => n.startsWith('album-sync-' + want + '-') && n.endsWith('.wgt'))
    .map((n) => path.join(dist, n))
    .sort((a, b) => size(b) - size(a))[0];
  console.log('本地同版本包 = ' + (localWgt ? path.basename(localWgt) : '(无)'));

  console.log('\n════ 基线 ════');
  try { adb(['shell', 'am', 'force-stop', PKG]); } catch {}
  await sleep(1500);
  adb(['shell', 'am', 'start', '-n', PKG + '/io.dcloud.PandoraEntryActivity']);
  await sleep(9000);
  console.log('  ' + JSON.stringify(state()));
  console.log('  截图: ' + snap('ui-01-home'));

  console.log('\n════ 进设置页 ════');
  // 首页右上角齿轮。屏幕 720x1280。先截首页图定位。
  // 按之前实测，Tab 栏在底部；设置通常在右上角或底部 Tab。
  // 这里用 uiautomator 找可点击的 Settings 文本，找不到就截图人工看。
  try {
    adb(['shell', 'uiautomator', 'dump', '/sdcard/ui.xml']);
    const xml = adb(['shell', 'cat', '/sdcard/ui.xml']);
    const m = [...xml.matchAll(/text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)]
      .map((x) => ({ t: x[1], cx: (Number(x[2]) + Number(x[4])) / 2, cy: (Number(x[3]) + Number(x[5])) / 2 }));
    console.log('  可见文本节点 ' + m.length + ' 个');
    m.slice(0, 40).forEach((n) => console.log('    ' + JSON.stringify(n.t) + ' @' + Math.round(n.cx) + ',' + Math.round(n.cy)));
    fs.writeFileSync(path.join(SHOTS, 'ui-nodes.json'), JSON.stringify(m, null, 2));
  } catch (e) { console.log('  uiautomator dump 失败: ' + e.message); }

  console.log('\n════ 结论 ════');
  console.log('（后续步骤需根据实际 UI 坐标继续，先看截图与节点列表）');
})().catch((e) => { console.log('FATAL', e.message, e.stack); process.exit(1); });
