/** 抓 logcat 里的热更新相关日志，用于定位"App 不自动安装" */
const { execFileSync } = require('child_process');
const fs = require('fs');
const ADB = [
  'C:/Program Files/Microvirt/MEmu/adb.exe',
  'C:/Users/lrp/DevEcoStudioProjects/AlbumSyncUniAppX/packaging-export/tools/android-sdk/platform-tools/adb.exe',
].find((p) => fs.existsSync(p));
const S = '127.0.0.1:21503';

const lg = execFileSync(ADB, ['-s', S, 'shell', 'logcat', '-d', '-v', 'time'], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000,
});
const lines = lg.split('\n');
console.log('logcat 总行数: ' + lines.length);

const RE = /AppUpdater|checkAppUpdate|update|wgt|install|PlusException|RuntimeService|uni\.|server_url|39\.107/;
const hit = lines.filter((l) => RE.test(l));
console.log('相关行: ' + hit.length);
console.log('\n───── 相关日志（最后 100 行）─────');
console.log(hit.slice(-100).join('\n') || '(无)');

console.log('\n───── 错误/警告级（最后 60 行）─────');
const bad = lines.filter((l) => /\s(E|W)\/\S+\s*:\s/.test(l) || /Exception|Error|error|失败/.test(l));
console.log(bad.slice(-60).join('\n') || '(无)');

console.log('\n───── App 进程是否活着 ─────');
try {
  console.log(execFileSync(ADB, ['-s', S, 'shell', 'pidof', 'lrp.aibum'], { encoding: 'utf8' }).trim() || '(未运行)');
} catch (e) { console.log('pidof 失败: ' + e.message); }
