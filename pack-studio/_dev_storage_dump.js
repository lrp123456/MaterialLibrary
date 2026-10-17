/**
 * _dev_storage_dump.js · 读取设备端 uni-app storage（shared_prefs + DCStorage sqlite）
 * 目的：确认 store.getServerUrl() 到底有没有值 —— 决定更新检查能否发起
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ADB = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe';
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const APPID = '__UNI__F183218';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devst-'));

function adbBin(args) {
  return execFileSync(ADB, ['-s', S, ...args], {
    encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, timeout: 60000,
  });
}
function sh(c) {
  try { return adbBin(['shell', c]).toString('utf8').trim(); } catch (e) { return ''; }
}

console.log('① shared_prefs（uni.setStorageSync 的落点）');
const sp = sh(`cat /data/data/${PKG}/shared_prefs/${APPID}_storages.xml`);
console.log(sp || '(空)');
const all = sh(`ls /data/data/${PKG}/shared_prefs/`);
console.log('\n   目录内容: ' + (all || '(空)').split(/\r?\n/).join(' | '));

console.log('\n② DCStorage 数据库（uni.setStorage 的 sqlite 落点）');
const dbPath = `/data/data/${PKG}/databases/DCStorage`;
for (const f of ['DCStorage', 'DCStorage-wal', 'DCStorage-shm']) {
  try {
    const b = adbBin(['exec-out', 'cat', `${dbPath}${f === 'DCStorage' ? '' : '-' + f.split('-')[1]}`]);
    const p = path.join(tmp, f);
    fs.writeFileSync(p, b);
    console.log(`   ${f}: ${b.length} 字节 → ${p}`);
  } catch (e) {
    console.log(`   ${f}: 读取失败 ${e.message}`);
  }
}

// 用设备上的 sqlite3 查（如果模拟器有）
console.log('\n③ 设备 sqlite3 查询');
const hasSq = sh('which sqlite3');
console.log('   sqlite3: ' + (hasSq || '(无)'));
if (hasSq) {
  const q = sh(`sqlite3 '${dbPath}' ".tables" 2>&1`);
  console.log('   表: ' + q);
  const dump = sh(`sqlite3 '${dbPath}' "select * from Data;" 2>&1 | head -c 4000`);
  console.log('   Data 表: ' + (dump || '(空)'));
}

console.log('\n④ 结论依据');
if (/serverUrl|server_url|39\.107\.120\.55/.test(sp)) {
  console.log('   ✓ storage 里有服务器地址 → 更新检查应该能发起');
} else {
  console.log('   ✗ storage 里没有服务器地址 → checkAppUpdate 会 reject("未配置服务器")');
  console.log('     这就是「logcat 里 0 条更新日志」的直接原因。');
}
console.log('\n临时目录: ' + tmp);
