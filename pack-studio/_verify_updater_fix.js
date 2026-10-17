/**
 * _verify_updater_fix.js · 验证热更新安装链路的修复
 *
 * 真实事故（2026-10-03 设备实测）：
 *   uni.downloadFile 的 tempFilePath 落在 _doc/uniapp_temp_<ts>/，
 *   该目录是 plus 临时目录，App 下次冷启动即被清空。
 *   设备证据：11:46:23 下载成功并写入 storage，但文件现已不存在；
 *   www_backup 停在 09-29 —— 安装器连备份都没做，说明没走到解压。
 *
 * 本脚本不跑真机，而是把「易错逻辑」抽出来做纯函数级验证：
 *   1. 版本比较：远端 2030005 / 本地 2020000 必须判定为「有更新」
 *   2. 版本相等：必须判定为「已是最新」
 *   3. 节流：上次失败时只节流 1 分钟
 *   4. 持久路径：install 用的一定不是 uniapp_temp_ 路径
 *   5. 源码级：AppUpdater.js 里不再直接把 tempFilePath 交给 install
 */
const fs = require('fs');
const path = require('path');

const APP = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX';
const SRC = path.join(APP, 'src', 'service', 'AppUpdater.js');
const code = fs.readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [PASS] ' + name + (detail ? '  ' + detail : '')); pass++; }
  else { console.log('  [FAIL] ' + name + (detail ? '  ' + detail : '')); fail++; }
}

// ── 复刻修复后的版本比较逻辑 ──
const sameWgt = (a, b) => String(a || '') !== '' && String(a) === String(b || '');
const clientVersionCode = () => 200;
function decide(runtimeVer, data) {
  const localMax = Math.max(clientVersionCode(), Number(String(runtimeVer).replace(/\D/g, '') || 0));
  const remoteMax = Math.max(Number(data.versionCode || 0), Number(String(data.wgtVersion || 0).replace(/\D/g, '') || 0));
  const remoteKey = String(data.wgtVersion || data.versionCode || '');
  if (remoteKey && sameWgt(remoteKey, runtimeVer)) {
    return { hasUpdate: false, reason: 'local_up_to_date' };
  }
  if (remoteMax > 0 && localMax > remoteMax) {
    return { hasUpdate: false, reason: 'local_newer' };
  }
  return { hasUpdate: true, reason: 'update_available' };
}
// 旧逻辑（对照）
function decideOld(runtimeVer, data) {
  const localMax = Math.max(clientVersionCode(), Number(String(runtimeVer).replace(/\D/g, '') || 0));
  const remoteMax = Math.max(Number(data.versionCode || 0), Number(String(data.wgtVersion || 0).replace(/\D/g, '') || 0));
  if (remoteMax > 0 && localMax >= remoteMax) return { hasUpdate: false, reason: 'local_up_to_date' };
  return { hasUpdate: true };
}

console.log('═══ 1. 版本判定（真实场景：本地 2020000 / 远端 2030005）═══');
const real = decide('2020000', { versionCode: 2030005, wgtVersion: 2030005 });
check('本地 2020000 + 远端 2030005 → 判定有更新', real.hasUpdate === true, JSON.stringify(real));
check('旧逻辑在这个场景也判有更新（说明当时不是被它挡住的）',
  decideOld('2020000', { versionCode: 2030005, wgtVersion: 2030005 }).hasUpdate === true);

console.log('\n═══ 2. 版本相等 / 本地更新 ═══');
check('远端 2030005 / 本地 2030005 → 已是最新',
  decide('2030005', { versionCode: 2030005, wgtVersion: 2030005 }).hasUpdate === false);
check('远端 2030005 / 本地 2040000（本地更新）→ 不提示',
  decide('2040000', { versionCode: 2030005, wgtVersion: 2030005 }).hasUpdate === false);
check('远端 2030005 / 本地 2020000 → 有更新（真实事故场景）',
  decide('2020000', { versionCode: 2030005, wgtVersion: '2030005' }).hasUpdate === true);
// 真实会误判的场景：本地 APK 内置 200（无 wgt），远端 wgtVersion 是短号
check('本地 200（裸 APK）vs 远端 203 → 有更新（不该被 localMax 挡住）',
  decide('200', { versionCode: 203, wgtVersion: '203' }).hasUpdate === true,
  '旧逻辑: ' + JSON.stringify(decideOld('200', { versionCode: 203, wgtVersion: '203' })));
check('本地 2020000 vs 远端 2020000 → 已是最新',
  decide('2020000', { versionCode: 2020000, wgtVersion: '2020000' }).hasUpdate === false);

console.log('\n═══ 3. 节流：上次失败只挡 1 分钟（throttled()=true 表示「被拦住」）═══');
const SILENT_THROTTLE_MS = 30 * 60 * 1000;
function throttled(last, now, lastFailed) {
  const t = lastFailed ? 60 * 1000 : SILENT_THROTTLE_MS;
  return now - last < t;
}
const now = 1788000000000;
check('刚失败 30 秒后再查 → 被节流（1 分钟窗口内，避免打服务器）',
  throttled(now - 30000, now, true) === true);
check('刚失败 5 分钟后再查 → 放行重试（旧逻辑会白等 25 分钟）',
  throttled(now - 300000, now, true) === false);
check('成功后 5 分钟再查 → 被节流（避免频繁请求）',
  throttled(now - 300000, now, false) === true);
check('成功后 40 分钟再查 → 放行',
  throttled(now - 2400000, now, false) === false);

console.log('\n═══ 4. 安装路径必须是持久路径 ═══');
check('源码含 persistWgt（下载后持久化）', /function persistWgt/.test(code));
check('源码含 _doc/wgt_cache（应用私有持久目录）', /_doc\/wgt_cache/.test(code));
check('源码含 verifyFileExists（安装前校验文件真实存在）', /function verifyFileExists/.test(code));
check('源码含 describePlusError（提取 plus 真实错误码）', /function describePlusError/.test(code));

// 关键：install 的入参不能是 downloadFile 的直接返回值
const dl = code.match(/async function downloadAndInstallWgt[\s\S]*?\n}\n/);
if (dl) {
  const body = dl[0];
  // 找 install( 的第一个参数
  const inst = body.match(/plus\.runtime\.install\(\s*([^,]+),/);
  const arg = inst ? inst[1].trim() : '';
  check('install() 的路径来自 persistWgt 而非 tempFilePath',
    /path/.test(arg) && !/tempPath|tempFilePath/.test(arg),
    'install 第一参 = ' + JSON.stringify(arg));
  check('下载与安装之间插入了 persistWgt 调用',
    /await persistWgt\(/.test(body));
  check('下载与安装之间插入了 verifyFileExists 校验',
    /await verifyFileExists\(/.test(body));
} else {
  check('能定位 downloadAndInstallWgt 函数体', false);
}

console.log('\n═══ 5. 不再出现的危险模式 ═══');
// 只在 wgt 安装函数体内检查（APK 下载用 downloadFile 是正常的）
const wgtFn = code.match(/async function downloadAndInstallWgt[\s\S]*?\n}\n/);
check('wgt 安装流程里没有「直接把 downloadFile 结果当安装路径」',
  !!wgtFn && !/const path = await downloadFile\(/.test(wgtFn[0]),
  wgtFn ? 'wgt 函数内下载变量名 = ' + (wgtFn[0].match(/const (\w+) = await downloadFile/)?.[1] || '?') : '未定位');
check('wgt 下载结果先落临时变量，再 persistWgt 成持久路径',
  !!wgtFn && /const tempPath = await downloadFile/.test(wgtFn[0]) && /await persistWgt\(tempPath/.test(wgtFn[0]));
check('APK 下载仍走 downloadFile（未被误改）',
  /async function downloadAndInstallApk[\s\S]*?const path = await downloadFile/.test(code));
check('失败标记 KEY_LAST_FAILED 已接入', /KEY_LAST_FAILED/.test(code));
check('请求成功后清理失败标记', /removeStorageSync\(KEY_LAST_FAILED\)/.test(code));

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
