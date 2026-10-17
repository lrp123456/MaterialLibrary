/**
 * _dev_launch.js · 冷启动 App 并抓 logcat（不依赖 shell 的 sleep/grep）
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ADB = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe';
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';

function adb(args, enc) {
  return execFileSync(ADB, ['-s', S, ...args], {
    encoding: enc || 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 90000,
  });
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function mainActivity() {
  const out = adb(['shell', 'dumpsys', 'package', PKG]);
  const m = out.match(/io\.dcloud\.[A-Za-z0-9_.]*Activity/g) || [];
  // 优先 io.dcloud.PandoraEntryActivity
  const cands = [...new Set(m)];
  const entry = cands.find((x) => /PandoraEntryActivity/.test(x));
  return entry || cands[0] || '';
}

(async () => {
  const act = mainActivity();
  console.log('入口 Activity: ' + act);

  console.log('清 logcat + 强杀');
  adb(['logcat', '-c']);
  adb(['shell', 'am', 'force-stop', PKG]);
  sleep(2000);

  console.log('冷启动');
  try {
    adb(['shell', 'am', 'start', '-n', PKG + '/' + act, '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER']);
  } catch (e) {
    console.log('  start 失败: ' + e.message);
    adb(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1']);
  }
  sleep(15000);

  const outFile = path.join(os.tmpdir(), 'dev-logcat-' + Date.now() + '.txt');
  adb(['logcat', '-d', '-v', 'time'], 'utf8');
  const buf = require('child_process').execFileSync(
    ADB, ['-s', S, 'logcat', '-d', '-v', 'time'],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 60000 }
  );
  fs.writeFileSync(outFile, buf, 'utf8');
  const lines = buf.split(/\r?\n/);

  const KEY = /AppUpdater|app_update|update\/files|39\.107\.120\.55|AlbumSync|LocalInfer|ModelCaps|uniapp|WeexCore|JSException|app-service|__UNI__|console/i;
  const hits = lines.filter((l) => KEY.test(l));
  console.log('\n总行数=' + lines.length + '  命中=' + hits.length);
  console.log('落盘: ' + outFile);
  console.log('\n──────── 关键日志 ────────');
  console.log(hits.slice(0, 120).join('\n'));

  // 单独找更新相关
  const upd = lines.filter((l) => /AppUpdater|update\/files|app\/update|wgt/i.test(l));
  console.log('\n──────── 更新相关（' + upd.length + ' 条） ────────');
  console.log(upd.slice(0, 60).join('\n') || '(无 —— App 完全没有发起更新检查)');
})().catch((e) => console.log('FATAL ' + e.message));
