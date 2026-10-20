/**
 * 打破节流，验证「App 能否自动下载并安装热更新」。
 *
 * 前置结论（2026-10-03 设备实证）：
 *   App 启动时的更新检查被 30 分钟 silent 节流拦在门外，
 *   请求一次都没发出（app_update_last_check 停留在上一次的值）。
 *   所以本脚本先清除节流键，再冷启动，看它是否走完
 *   checkAppUpdate → downloadFile → persistWgt → verifyFileExists → install。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { readZipEntries, readZipFile, request } = require('./lib/push-update');

const ADB = [
  'C:/Program Files/Microvirt/MEmu/adb.exe',
  'C:/Users/lrp/DevEcoStudioProjects/AlbumSyncUniAppX/packaging-export/tools/android-sdk/platform-tools/adb.exe',
].find((p) => fs.existsSync(p));
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const BASE = '/data/data/' + PKG + '/files';
const WWW = BASE + '/apps/__UNI__F183218/www';
const SHOTS = path.join(__dirname, '_shots');

function adb(a, enc) {
  return execFileSync(ADB, ['-s', S, ...a], {
    encoding: enc || 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300000,
  });
}
const sleep = (ms) => { const a = new Int32Array(new SharedArrayBuffer(4)); Atomics.wait(a, 0, 0, ms); };
const sh = (c) => { try { adb(['root']); } catch {} try { return adb(['shell', c]).trim(); } catch (e) { return 'ERR'; } };

function state() {
  const o = {};
  o.code = '';
  try { o.code = String(JSON.parse(adb(['shell', 'cat ' + WWW + '/manifest.json'])).version.code); } catch { o.code = '?'; }
  try { o.www = adb(['shell', 'stat -c %s ' + WWW + '/app-service.js']).trim(); } catch { o.www = '?'; }
  try { o.backup = adb(['shell', 'stat -c %y ' + WWW + '_backup/app-service.js']).trim().slice(0, 19); } catch { o.backup = 'none'; }
  const c = sh('ls -l ' + BASE + '/wgt_cache/ 2>/dev/null');
  o.cache = (!c || c.includes('No such')) ? '(空)' : c.split('\n').filter((x) => x.includes('.wgt'))[0] || '(空)';
  return o;
}

function snap(name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const out = path.join(SHOTS, name + '.png');
  adb(['shell', 'screencap', '-p', '/sdcard/_v.png']);
  adb(['pull', '/sdcard/_v.png', out]);
  return out;
}

/** 读设备 storage 里的节流键 */
function readThrottle() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thr-'));
  for (const f of ['DCStorage', 'DCStorage-wal', 'DCStorage-shm']) {
    try { adb(['pull', BASE + '/databases/' + f, path.join(tmp, f)]); } catch {}
  }
  const py = 'C:/Users/lrp/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
  const code = [
    'import sqlite3,sys,json',
    'c=sqlite3.connect(sys.argv[1])',
    'cur=c.cursor()',
    'try:',
    '  cur.execute("SELECT key,value FROM DC_1211921507_storage")',
    '  r=dict(cur.fetchall())',
    'except Exception as e:',
    '  r={"_err":str(e)}',
    'print(json.dumps({k:v for k,v in r.items() if "app_update" in k}, ensure_ascii=False))',
  ].join('\n');
  const pyFile = path.join(tmp, 'r.py');
  fs.writeFileSync(pyFile, code, 'utf8');
  try {
    const out = execFileSync(py, [pyFile, path.join(tmp, 'DCStorage')], { encoding: 'utf8', timeout: 30000 });
    return JSON.parse(out.trim());
  } catch (e) { return { _err: e.message }; }
}

/** 直接改设备 storage：删掉节流键（先停 App，避免 DB 锁） */
function clearThrottle() {
  try { adb(['shell', 'am', 'force-stop', PKG]); } catch {}
  sleep(1500);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thrw-'));
  const got = {};
  for (const f of ['DCStorage', 'DCStorage-wal', 'DCStorage-shm']) {
    const p = path.join(tmp, f);
    try { adb(['pull', BASE + '/databases/' + f, p]); got[f] = p; } catch (e) { got[f] = null; }
  }
  if (!got.DCStorage) return { ok: false, error: '拉不到 DCStorage' };

  const py = 'C:/Users/lrp/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
  const code = [
    'import sqlite3,sys,json',
    'c=sqlite3.connect(sys.argv[1])',
    'cur=c.cursor()',
    'keys=sys.argv[2:]',
    'n=0',
    'for k in keys:',
    '  try:',
    '    cur.execute("DELETE FROM DC_1211921507_storage WHERE key=?", (k,)); n+=cur.rowcount',
    '  except Exception as e:',
    '    pass',
    'c.commit()',
    'print(json.dumps({"deleted":n}))',
  ].join('\n');
  const pyFile = path.join(tmp, 'w.py');
  fs.writeFileSync(pyFile, code, 'utf8');
  const KEYS = ['app_update_last_check', 'app_update_last_failed', 'app_update_skipped_wgt',
    'app_update_downloaded_path', 'app_update_installed_wgt', 'app_update_pending_relaunch'];
  let out;
  try {
    out = execFileSync(py, [pyFile, got.DCStorage, ...KEYS], { encoding: 'utf8', timeout: 30000 }).trim();
  } catch (e) { return { ok: false, error: 'python 失败: ' + e.message }; }

  // 必须连 wal/shm 一起回写，否则改动会被 WAL 覆盖
  const all = ['DCStorage', 'DCStorage-wal', 'DCStorage-shm'];
  const pushed = [];
  for (const f of all) {
    if (!got[f] || !fs.existsSync(got[f])) continue;
    try {
      adb(['push', got[f], BASE + '/databases/' + f]);
      pushed.push(f);
    } catch (e) { pushed.push(f + '(FAIL)'); }
  }
  try { adb(['shell', 'chmod', '660', BASE + '/databases/DCStorage']); } catch {}
  return { ok: true, out, pushed };
}

(async function main() {
  console.log('════ 1. 当前节流状态 ════');
  console.log('  ' + JSON.stringify(readThrottle(), null, 2).replace(/\n/g, '\n  '));
  console.log('  设备 www: ' + JSON.stringify(state()));

  console.log('\n════ 2. 清除节流键 ════');
  const r = clearThrottle();
  console.log('  ' + JSON.stringify(r));
  await sleep(1000);
  console.log('  清完: ' + JSON.stringify(readThrottle()));

  console.log('\n════ 3. 冷启动 App ════');
  try { adb(['shell', 'logcat', '-c']); } catch {}
  try { adb(['shell', 'am', 'start', '-n', PKG + '/io.dcloud.PandoraEntryActivity']); }
  catch { adb(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1']); }
  console.log('  已启动，观察 150 秒（检测到 wgt_cache 出现文件就尝试点确认）');

  const srv = await request(
    (process.env.PUBLIC_BASE_URL || '') + '/api/app/update?platform=android&versionCode=100&wgtVersion=100&channel=internal',
    { method: 'GET', headers: {}, timeout: 30000 }
  );
  const d = (srv.json && srv.json.data) || {};
  const wantCode = String(d.wgtVersion);
  console.log('  服务端 wgtVersion = ' + wantCode + '（期望设备装上这个 code）');

  let installed = false;
  for (let i = 1; i <= 30; i++) {
    await sleep(5000);
    const s = state();
    const hit = s.code === wantCode;
    console.log('  [' + (i * 5) + 's] code=' + s.code + ' www=' + s.www +
      ' cache=' + (s.cache === '(空)' ? '(空)' : '有文件') +
      ' backup=' + s.backup + (hit ? '  ← ★ 已安装' : ''));

    if (hit) { installed = true; break; }

    if (s.cache !== '(空)') {
      const f = snap('upd-' + i);
      // 弹窗确认键：先试右下角
      adb(['shell', 'input', 'tap', '542', '838']);
      await sleep(1200);
      const s2 = state();
      console.log('      已点确认 → cache=' + (s2.cache === '(空)' ? '(空)' : '有文件') + '  截图 ' + f);
    }
  }

  console.log('\n════ 4. 结果 ════');
  const after = state();
  console.log('  ' + JSON.stringify(after, null, 2).replace(/\n/g, '\n  '));

  console.log('\n════ 5. 设备端 app-service.js 标识符 ═══');
  if (installed || after.code === wantCode) {
    const tmp = path.join(os.tmpdir(), 'devsvc-' + Date.now() + '.js');
    adb(['pull', WWW + '/app-service.js', tmp]);
    const svc = fs.readFileSync(tmp, 'utf8');
    for (const k of ['_doc/wgt_cache/', '持久化 wgt 异常', '安装包已失效', '缓存 wgt 失败 code=', 'app_update_last_failed']) {
      console.log('  ' + (svc.includes(k) ? 'HIT  ' : 'MISS ') + k);
    }
  } else {
    console.log('  （未安装成功，跳过）');
  }

  console.log('\n════ 6. logcat 热更新相关 ═══');
  try {
    const lg = adb(['shell', 'logcat', '-d', '-v', 'brief']);
    const l = lg.split('\n').filter((x) => /AppUpdater|wgt|install|Runtime|DCloud/i.test(x));
    console.log(l.slice(-30).join('\n') || '(无)');
  } catch {}

  console.log('\n════ 7. 再次读取节流键（确认请求真的发出去了）════');
  console.log('  ' + JSON.stringify(readThrottle(), null, 2).replace(/\n/g, '\n  '));

  console.log('\n结论: ' + (installed ? '✓ 端到端通过，App 自动装上了最新代码' : '✗ 仍未自动安装'));
  process.exit(installed ? 0 : 1);
})().catch((e) => { console.log('FATAL', e.message); process.exit(1); });
void zlib;
