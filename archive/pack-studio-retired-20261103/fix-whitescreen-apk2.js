/**
 * 保留原 APK 条目压缩方式，仅替换 app-service.js，修复 versionTabs 白屏
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX';
const SRC_APK = path.join(ROOT, 'dist\\release\\apk\\__UNI__F183218__20260911104916.apk');
const WORK = path.join(ROOT, 'dist\\cache\\whitescreen-fix2');
const JAVA = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\amazon-corretto\\bin\\java.exe';
const ZIPALIGN = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\app-safe-pack\\zipalign\\zipalign.exe';
const APKSIGNER = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\app-safe-pack\\apksigner.jar';
const KS = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\app-safe-pack\\Test.keystore';
const OUT_APK = path.join(ROOT, 'dist\\release\\apk\\album-sync-whitescreen-fix2.apk');
const TARGET = 'assets/apps/__UNI__F183218/www/app-service.js';

function patchService(raw) {
  let s = raw.toString('utf8');
  if (!s.includes('versionTabs:versionTabs')) return null;
  s = s.split('versionTabs:versionTabs').join('');
  s = s.replace(/,\s*,/g, ',').replace(/\},\s*,/g, '},').replace(/,\s*\}/g, '}');
  return Buffer.from(s, 'utf8');
}

function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const py = path.join(WORK, 'repack.py');
  const outUnsigned = path.join(WORK, 'unsigned.apk');
  fs.writeFileSync(py, `
import zipfile, shutil, os, sys
src = r'''${SRC_APK}'''
out = r'''${outUnsigned}'''
target = r'''${TARGET}'''
src_z = zipfile.ZipFile(src, 'r')
raw = src_z.read(target)
text = raw.decode('utf-8')
assert 'versionTabs:versionTabs' in text, 'source already clean?'
text = text.replace('versionTabs:versionTabs', '')
while ',,' in text:
    text = text.replace(',,', ',')
text = text.replace('},,', '},')
text = text.replace(',}', '}')
new = text.encode('utf-8')
if os.path.exists(out):
    os.remove(out)
dst = zipfile.ZipFile(out, 'w')
for info in src_z.infolist():
    data = new if info.filename == target else src_z.read(info.filename)
    # 保留原压缩方式/属性，resources.arsc 必须 STORED
    zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
    zi.compress_type = info.compress_type
    zi.external_attr = info.external_attr
    zi.internal_attr = info.internal_attr
    zi.create_system = info.create_system
    dst.writestr(zi, data)
dst.close()
src_z.close()
z = zipfile.ZipFile(out)
ra = z.getinfo('resources.arsc')
js = z.getinfo(target)
print('repack_ok entries', len(z.namelist()))
print('resources.arsc method', ra.compress_type, 'size', ra.file_size)
print('app-service.js method', js.compress_type, 'size', js.file_size, 'bad', b'versionTabs:versionTabs' in z.read(target))
print('dcloud_file_provider present', 'res/xml/dcloud_file_provider.xml' in z.namelist())
`);
  console.log('[1] repack preserving compress_type');
  execFileSync(process.env.MIMO_PYTHON || 'python', [py], { stdio: 'inherit' });

  console.log('[2] zipalign');
  const aligned = path.join(WORK, 'aligned.apk');
  try {
    execFileSync(ZIPALIGN, ['-p', '-f', '4', outUnsigned, aligned], { stdio: 'inherit' });
  } catch (e) {
    console.log('zipalign fallback', e.message);
    fs.copyFileSync(outUnsigned, aligned);
  }

  console.log('[3] sign');
  if (fs.existsSync(OUT_APK)) fs.unlinkSync(OUT_APK);
  execFileSync(JAVA, [
    '-jar', APKSIGNER, 'sign',
    '--ks', KS,
    '--ks-key-alias', 'android',
    '--ks-pass', 'pass:123456',
    '--key-pass', 'pass:123456',
    '--out', OUT_APK,
    aligned,
  ], { stdio: 'inherit' });
  console.log('[ok]', OUT_APK, fs.statSync(OUT_APK).size);
}

main();
