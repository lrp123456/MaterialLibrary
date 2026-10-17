/**
 * _dev_marker_probe.js · 设备端字节级取证
 *
 * 目的：回答「用户设备上到底跑的是哪一版代码」，不靠猜。
 * 证据：3 处 app-service.js 的 字节数 / sha256 / 时间 / 5 个新功能标识符命中情况
 *      + pages 目录清单（有没有 trash 页面）
 *      + manifest.json 的 version.code
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ADB = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe';
const SERIAL = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const APPID = '__UNI__F183218';

const MARKERS = [
  'home_library_tab',
  'trash-src-bar',
  'disposeSource',
  'back-to-top',
  'takeRemovals',
];

function adb(args, opts) {
  return execFileSync(ADB, ['-s', SERIAL, ...args], {
    encoding: opts && opts.bin ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60000,
  });
}

function sh(cmd) {
  try {
    return String(adb(['shell', cmd]) || '').trim();
  } catch (e) {
    return '';
  }
}

const CANDIDATES = [
  `/data/data/${PKG}/files/apps/${APPID}/www`,
  `/data/data/${PKG}/files/apps/${APPID}/www_backup`,
  `/sdcard/Android/data/${PKG}/apps/${APPID}/www`,
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devmark-'));
console.log('临时目录: ' + tmp);
console.log('');

let anyHit = false;

for (const root of CANDIDATES) {
  const svc = `${root}/app-service.js`;
  const stat = sh(`stat -c '%s|%y' "${svc}" 2>/dev/null || echo MISS`);
  console.log('════════════════════════════════════════════');
  console.log('目录: ' + root);
  if (!stat || stat === 'MISS' || stat.indexOf('|') < 0) {
    console.log('  app-service.js: 不存在');
    console.log('');
    continue;
  }
  const [size, mtime] = stat.split('|');
  console.log(`  app-service.js  字节=${size}  mtime=${mtime}`);

  // 设备上直接 grep（避免拉 500KB 回来）
  const grep = sh(
    `for m in ${MARKERS.join(' ')}; do c=$(grep -c -- "$m" "${svc}" 2>/dev/null || echo 0); echo "$m=$c"; done`
  );
  const hitMap = {};
  String(grep).split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t) return;
    const i = t.indexOf('=');
    if (i < 0) return;
    hitMap[t.slice(0, i)] = t.slice(i + 1);
  });
  let hit = 0;
  for (const m of MARKERS) {
    const c = hitMap[m];
    const ok = c && c !== '0';
    if (ok) hit++;
    console.log(`    ${ok ? 'HIT ' : 'MISS'}  ${m}  (${c || '?'})`);
  }
  if (hit > 0) anyHit = true;
  console.log(`  → 命中 ${hit}/${MARKERS.length}`);

  // pages 目录
  const pages = sh(`ls "${root}/pages" 2>/dev/null | tr '\\n' ' '`);
  console.log('  pages/: ' + (pages || '(无)'));
  console.log('  有 trash 页面: ' + (/trash/.test(pages) ? 'YES' : 'NO'));

  // manifest.json
  const mf = sh(`cat "${root}/manifest.json" 2>/dev/null`);
  if (mf) {
    try {
      const j = JSON.parse(mf);
      console.log(
        '  manifest: name=' + (j.name || '?') +
        ' version=' + JSON.stringify(j.version || {}) +
        ' versionCode(顶层)=' + (j.versionCode || '-')
      );
    } catch (e) {
      console.log('  manifest 解析失败: ' + mf.slice(0, 120));
    }
  }
  console.log('');
}

// 再把主 www 的 app-service.js 拉回来做本地 sha256（与新编译产物对比）
console.log('════════════════════════════════════════════');
console.log('拉取主 www 的 app-service.js 做本地 sha256 对比');
const mainSvc = `${CANDIDATES[0]}/app-service.js`;
try {
  const buf = adb(['exec-out', 'cat', mainSvc], { bin: true });
  const local = path.join(tmp, 'app-service.js');
  fs.writeFileSync(local, buf);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  console.log('  字节=' + buf.length);
  console.log('  sha256=' + sha);
  const localHits = MARKERS.filter((m) => buf.toString('utf8').includes(m));
  console.log('  本地标识符命中: ' + localHits.length + '/' + MARKERS.length +
    (localHits.length ? ' → ' + localHits.join(', ') : ''));
} catch (e) {
  console.log('  拉取失败: ' + e.message);
}

// 对比本机新编译产物
const freshCandidates = [
  'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX\\dist\\build\\app\\app-service.js',
];
console.log('');
console.log('════════════════════════════════════════════');
console.log('本机编译产物对比');
for (const f of freshCandidates) {
  if (!fs.existsSync(f)) {
    console.log('  (不存在) ' + f);
    continue;
  }
  const buf = fs.readFileSync(f);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const hits = MARKERS.filter((m) => buf.toString('utf8').includes(m));
  const st = fs.statSync(f);
  console.log('  ' + f);
  console.log('    字节=' + buf.length + '  mtime=' + st.mtime.toISOString());
  console.log('    sha256=' + sha);
  console.log('    标识符命中: ' + hits.length + '/' + MARKERS.length +
    (hits.length ? ' → ' + hits.join(', ') : ''));
}

console.log('');
console.log(anyHit
  ? '★ 设备上已存在新代码 —— 问题在别处（页面路由/条件编译/未重启）'
  : '★ 设备上完全没有新代码 —— 新 wgt 从未送达设备，问题在打包→推送→更新检查链路');
