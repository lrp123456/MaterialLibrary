/**
 * 修复 APK 内 app-service.js 的 versionTabs 裸引用白屏问题，重签并输出可安装包
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX';
const SRC_APK = path.join(ROOT, 'dist\\release\\apk\\__UNI__F183218__20260911104916.apk');
const WORK = path.join(ROOT, 'dist\\cache\\whitescreen-fix');
const JAVA = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\amazon-corretto\\bin\\java.exe';
const KEYTOOL = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\amazon-corretto\\bin\\keytool.exe';
const ZIPALIGN = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\app-safe-pack\\zipalign\\zipalign.exe';
const APKSIGNER = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\app-safe-pack\\apksigner.jar';
const KS = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\app-safe-pack\\Test.keystore';
const KS_PASS = '123456';
const KS_ALIAS = 'android';
const OUT_APK = path.join(ROOT, 'dist\\release\\apk\\album-sync-whitescreen-fix.apk');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function main() {
  if (!fs.existsSync(SRC_APK)) throw new Error('源 APK 不存在: ' + SRC_APK);
  rmrf(WORK);
  fs.mkdirSync(WORK, { recursive: true });
  const extractDir = path.join(WORK, 'apk');
  fs.mkdirSync(extractDir, { recursive: true });

  console.log('[1] 解压 APK');
  // Use PowerShell Expand-Archive via copy to .zip for reliability
  const zipIn = path.join(WORK, 'src.zip');
  fs.copyFileSync(SRC_APK, zipIn);
  execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    `Expand-Archive -Path '${zipIn.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
  ], { stdio: 'inherit' });

  const wwwRoot = path.join(extractDir, 'assets', 'apps', '__UNI__F183218', 'www');
  const svcPath = path.join(wwwRoot, 'app-service.js');
  if (!fs.existsSync(svcPath)) throw new Error('未找到 ' + svcPath);

  console.log('[2] 修复 app-service.js');
  let svc = fs.readFileSync(svcPath, 'utf8');
  const beforeBad = svc.includes('versionTabs:versionTabs');
  // 组件 options 根上的裸引用会导致 createInstanceContext 失败 → 白屏
  svc = svc.split('versionTabs:versionTabs').join('');
  // 清理可能出现的双逗号 / 悬空逗号
  svc = svc.replace(/,\s*,/g, ',').replace(/\},\s*,/g, '},').replace(/,\s*\}/g, '}');
  fs.writeFileSync(svcPath, svc);
  const afterBad = svc.includes('versionTabs:versionTabs');
  console.log(`    before_bad=${beforeBad} after_bad=${afterBad} size=${svc.length}`);
  if (afterBad) throw new Error('修复失败，仍含 versionTabs:versionTabs');

  // 扫描其它可疑裸引用
  const re = /},\s*([A-Za-z_$][\w$]*):\s*\1\s*,/g;
  let m; const sus = [];
  while ((m = re.exec(svc))) sus.push(m[0]);
  console.log('    other_suspicious=' + sus.length + (sus.length ? ' ' + sus.join(' | ') : ''));

  // 同步修复其它可能拷贝的 www 产物，避免下次打包又带上坏文件
  const extraWww = [
    path.join(ROOT, 'dist\\build\\app-plus\\app-service.js'),
    path.join(ROOT, 'dist\\cache\\wgt\\__UNI__F183218\\app-service.js'),
    path.join(ROOT, 'unpackage\\resources\\__UNI__F183218\\www\\app-service.js'),
  ];
  for (const p of extraWww) {
    if (!fs.existsSync(p)) continue;
    let t = fs.readFileSync(p, 'utf8');
    if (!t.includes('versionTabs:versionTabs')) continue;
    t = t.split('versionTabs:versionTabs').join('').replace(/,\s*,/g, ',').replace(/\},\s*,/g, '},').replace(/,\s*\}/g, '}');
    fs.writeFileSync(p, t);
    console.log('    patched dist copy: ' + p + ' bad=' + t.includes('versionTabs:versionTabs'));
  }

  console.log('[3] 去掉旧签名文件');
  const meta = path.join(extractDir, 'META-INF');
  if (fs.existsSync(meta)) {
    for (const f of fs.readdirSync(meta)) {
      if (/\.(SF|RSA|DSA|EC|MF)$/i.test(f) && f !== 'MANIFEST.MF') {
        // keep MANIFEST.MF optional; apksigner will replace
      }
      if (/\.(SF|RSA|DSA|EC)$/i.test(f)) {
        fs.unlinkSync(path.join(meta, f));
      }
    }
  }

  console.log('[4] 重新打包 zip');
  const unsigned = path.join(WORK, 'unsigned.apk');
  if (fs.existsSync(unsigned)) fs.unlinkSync(unsigned);
  // Compress-Archive 会多一层，用 .NET ZipFile 从目录根打包
  const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = '${extractDir.replace(/'/g, "''")}'
$dst = '${unsigned.replace(/'/g, "''")}'
if (Test-Path $dst) { Remove-Item $dst -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $false)
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  console.log('    unsigned=' + unsigned + ' size=' + fs.statSync(unsigned).size);

  console.log('[5] zipalign');
  const aligned = path.join(WORK, 'aligned.apk');
  if (fs.existsSync(aligned)) fs.unlinkSync(aligned);
  try {
    execFileSync(ZIPALIGN, ['-p', '-f', '4', unsigned, aligned], { stdio: 'inherit' });
  } catch (e) {
    console.log('    zipalign 失败，使用未对齐包: ' + e.message);
    fs.copyFileSync(unsigned, aligned);
  }

  console.log('[6] apksigner 签名');
  fs.mkdirSync(path.dirname(OUT_APK), { recursive: true });
  if (fs.existsSync(OUT_APK)) fs.unlinkSync(OUT_APK);
  const signArgs = [
    '-jar', APKSIGNER,
    'sign',
    '--ks', KS,
    '--ks-key-alias', KS_ALIAS,
    '--ks-pass', 'pass:' + KS_PASS,
    '--key-pass', 'pass:' + KS_PASS,
    '--out', OUT_APK,
    aligned,
  ];
  console.log('    ' + JAVA + ' ' + signArgs.join(' '));
  execFileSync(JAVA, signArgs, { stdio: 'inherit' });
  if (!fs.existsSync(OUT_APK)) throw new Error('签名输出不存在');
  console.log('[ok] ' + OUT_APK + ' (' + Math.round(fs.statSync(OUT_APK).size / 1048576 * 100) / 100 + ' MB)');

  // verify patch inside output
  const verifyZip = path.join(WORK, 'out.zip');
  fs.copyFileSync(OUT_APK, verifyZip);
  const vdir = path.join(WORK, 'verify');
  rmrf(vdir);
  execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    `Expand-Archive -Path '${verifyZip.replace(/'/g, "''")}' -DestinationPath '${vdir.replace(/'/g, "''")}' -Force`,
  ], { stdio: 'inherit' });
  const vsvc = fs.readFileSync(path.join(vdir, 'assets', 'apps', '__UNI__F183218', 'www', 'app-service.js'), 'utf8');
  console.log('[verify] output bad=' + vsvc.includes('versionTabs:versionTabs'));
}

main();
