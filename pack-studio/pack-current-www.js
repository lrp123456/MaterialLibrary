/**
 * 用最新 dist/build/app 的 www 替换 APK 内旧资源，保留 zip 压缩方式后重签
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX';
const SRC_APK = path.join(ROOT, 'dist\\release\\apk\\__UNI__F183218__20260911104916.apk');
const WWW = path.join(ROOT, 'dist\\build\\app');
const WORK = path.join(ROOT, 'dist\\cache\\repack-newwww');
const JAVA = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\amazon-corretto\\bin\\java.exe';
const ZIPALIGN = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\app-safe-pack\\zipalign\\zipalign.exe';
const APKSIGNER = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\app-safe-pack\\apksigner.jar';
const KS = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\app-safe-pack\\Test.keystore';
const OUT_APK = path.join(ROOT, 'dist\\release\\apk\\album-sync-current-www.apk');
const PREFIX = 'assets/apps/__UNI__F183218/www/';

function listFiles(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) listFiles(p, base, out);
    else out.push({ rel: path.relative(base, p).replace(/\\/g, '/'), abs: p, size: st.size });
  }
  return out;
}

function main() {
  if (!fs.existsSync(WWW + path.sep + 'app-service.js')) throw new Error('www 不完整: ' + WWW);
  const files = listFiles(WWW);
  const svc = fs.readFileSync(path.join(WWW, 'app-service.js'), 'utf8');
  console.log('[www] files=' + files.length + ' svc=' + svc.length);
  console.log('  39.107=' + svc.includes('39.107.120.55') +
    ' 192.168=' + svc.includes('192.168.1.59') +
    ' demo=' + svc.includes('体验演示模式') +
    ' tabsBug=' + svc.includes('versionTabs:versionTabs'));

  fs.mkdirSync(WORK, { recursive: true });
  const py = path.join(WORK, 'repack.py');
  const unsigned = path.join(WORK, 'unsigned.apk');
  const filesJson = path.join(WORK, 'www-files.json');
  fs.writeFileSync(filesJson, JSON.stringify(files.map((f) => f.rel)));
  fs.writeFileSync(py, `
import zipfile, os, json
src = r'''${SRC_APK}'''
www = r'''${WWW}'''
out = r'''${unsigned}'''
prefix = r'''${PREFIX}'''
rels = json.load(open(r'''${filesJson}''', encoding='utf-8'))
new_map = {rel: os.path.join(www, rel.replace('/', os.sep)) for rel in rels}
src_z = zipfile.ZipFile(src, 'r')
old_names = set(src_z.namelist())
if os.path.exists(out):
    os.remove(out)
dst = zipfile.ZipFile(out, 'w')
replaced = added = kept = 0
for info in src_z.infolist():
    name = info.filename
    if name.startswith(prefix):
        rel = name[len(prefix):]
        if rel in new_map:
            data = open(new_map[rel], 'rb').read()
            if rel == 'manifest.json':
                try:
                    m = json.loads(data.decode('utf-8'))
                    if 'version' in m and isinstance(m['version'], dict):
                        m['version']['code'] = '2026091901'
                    data = json.dumps(m, ensure_ascii=False, indent=2).encode('utf-8')
                except Exception as e:
                    pass
            zi = zipfile.ZipInfo(name, date_time=info.date_time)
            zi.compress_type = info.compress_type  # 保留，尤其 resources.arsc 必须 STORED
            zi.external_attr = info.external_attr
            dst.writestr(zi, data)
            replaced += 1
            continue
        else:
            # 旧 www 冲突文件丢弃
            continue
    data = src_z.read(name)
    zi = zipfile.ZipInfo(name, date_time=info.date_time)
    zi.compress_type = info.compress_type
    zi.external_attr = info.external_attr
    zi.internal_attr = info.internal_attr
    zi.create_system = info.create_system
    dst.writestr(zi, data)
    kept += 1
for rel, ap in new_map.items():
    name = prefix + rel
    if name in old_names:
        continue
    data = open(ap, 'rb').read()
    zi = zipfile.ZipInfo(name)
    zi.compress_type = zipfile.ZIP_DEFLATED
    dst.writestr(zi, data)
    added += 1
dst.close()
z = zipfile.ZipFile(out)
ra = z.getinfo('resources.arsc')
js = z.read(prefix + 'app-service.js').decode('utf-8', 'ignore')
print('repack replaced', replaced, 'added', added, 'kept', kept)
print('resources.arsc method', ra.compress_type)
print('new www flags 39.107', '39.107.120.55' in js, '192.168', '192.168.1.59' in js, 'demo', '体验演示模式' in js, 'tabsBug', 'versionTabs:versionTabs' in js)
print('dcloud_file_provider', 'res/xml/dcloud_file_provider.xml' in z.namelist())
`);
  console.log('[1] repack with new www');
  execFileSync(process.env.MIMO_PYTHON || 'python', [py], { stdio: 'inherit' });

  console.log('[2] zipalign');
  const aligned = path.join(WORK, 'aligned.apk');
  try {
    execFileSync(ZIPALIGN, ['-p', '-f', '4', unsigned, aligned], { stdio: 'inherit' });
  } catch (e) {
    console.log('zipalign fail, copy unsigned', e.message);
    fs.copyFileSync(unsigned, aligned);
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
  console.log('[ok]', OUT_APK, Math.round(fs.statSync(OUT_APK).size / 1048576 * 100) / 100 + 'MB');
}

main();
