/**
 * 判定「App 为何不装新包」：把设备端真实状态与服务端返回放一起比对。
 * 只读，不修改任何东西。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const { request, readZipEntries, readZipFile } = require('./lib/push-update');

const ADB = [
  'C:/Program Files/Microvirt/MEmu/adb.exe',
  'C:/Users/lrp/DevEcoStudioProjects/AlbumSyncUniAppX/packaging-export/tools/android-sdk/platform-tools/adb.exe',
].find((p) => fs.existsSync(p));
const S = '127.0.0.1:21503';
const WWW = '/data/data/lrp.aibum/files/apps/__UNI__F183218/www';

function sh(c) {
  try { return execFileSync(ADB, ['-s', S, 'shell', c], { encoding: 'utf8', timeout: 20000 }).trim(); }
  catch (e) { return 'ERR:' + (e.stderr || e.message).slice(0, 80); }
}

(async function () {
  console.log('═══ 设备端真实状态 ═══');
  const mf = sh('cat ' + WWW + '/manifest.json');
  console.log('  设备 www/manifest.json:');
  try {
    const j = JSON.parse(mf);
    console.log('    id      = ' + j.id);
    console.log('    version = ' + JSON.stringify(j.version));
  } catch { console.log('    (解析失败) ' + mf.slice(0, 120)); }

  const size = sh('stat -c %s ' + WWW + '/app-service.js');
  console.log('  app-service.js = ' + size + ' 字节');
  console.log('  设备端是否含热更新修复:');
  const tmp = require('os').tmpdir() + '/devsvc-' + Date.now() + '.js';
  try {
    execFileSync(ADB, ['-s', S, 'pull', WWW + '/app-service.js', tmp], { timeout: 60000, stdio: 'ignore' });
    const svc = fs.readFileSync(tmp, 'utf8');
    for (const k of ['_doc/wgt_cache/', '持久化 wgt 异常', '安装包已失效', '缓存 wgt 失败 code=', 'app_update_last_failed']) {
      console.log('    ' + (svc.includes(k) ? 'HIT  ' : 'MISS ') + k);
    }
  } catch (e) { console.log('    pull 失败: ' + e.message); }

  console.log('\n═══ 服务端返回 ═══');
  const upd = await request(
    'http://39.107.120.55:30001/api/app/update?platform=android&versionCode=100&wgtVersion=100&channel=internal',
    { method: 'GET', headers: {}, timeout: 30000 }
  );
  const d = (upd.json && upd.json.data) || {};
  console.log('  hasUpdate   = ' + d.hasUpdate);
  console.log('  wgtVersion  = ' + d.wgtVersion);
  console.log('  versionCode = ' + d.versionCode);
  console.log('  fileName    = ' + (d.fileName || (d.url || '').split('/').pop()));

  console.log('\n═══ 用设备真实版本去问服务端 ═══');
  let localCode = 100, localName = '1.0.0';
  try { const j = JSON.parse(mf); localCode = Number(j.version.code) || 100; localName = j.version.name; } catch {}
  for (const q of [String(localCode), String(localCode).replace(/0+$/, '') || '1']) {
    const r = await request(
      'http://39.107.120.55:30001/api/app/update?platform=android&versionCode=' + localCode +
      '&wgtVersion=' + q + '&channel=internal',
      { method: 'GET', headers: {}, timeout: 30000 }
    );
    const dd = (r.json && r.json.data) || {};
    console.log('  ?wgtVersion=' + q + '  →  hasUpdate=' + dd.hasUpdate +
      '  wgtVersion=' + dd.wgtVersion + '  force=' + dd.force);
  }

  console.log('\n═══ 结论 ═══');
  console.log('  设备 www 的 manifest.version.code = ' + localCode);
  console.log('  服务端 wgtVersion                = ' + d.wgtVersion);
  if (String(localCode) === String(d.wgtVersion)) {
    console.log('  → 两者相同：App 认为「我已经是最新版」，所以 hasUpdate=false，不下载不安装。');
    console.log('  → 这不是热更新链路的 bug，而是「设备上已经先被手工塞过同版本代码」造成的假性最新。');
    console.log('  → 验证办法：把设备 www 回退到更低的版本（如 2020000），再冷启动，');
    console.log('     App 就应当识别出 2030005 > 2020000 并自动下载安装。');
  } else if (Number(String(d.wgtVersion).replace(/\D/g, '')) > Number(localCode)) {
    console.log('  → 服务端更高，App 应该提示更新；它没装说明检查逻辑或网络另有拦截。');
  }
})();
