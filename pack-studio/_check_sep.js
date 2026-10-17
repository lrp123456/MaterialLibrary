/**
 * _check_sep.js · 确认 wgt 包内的路径分隔符问题
 *
 * 已知：失败包比成功包多一个条目「pages\trash\detail.css」，用的是反斜杠。
 * uni 编译产物在 Windows 上是 pages\trash\detail.css，
 * 而 zip 规范要求 entry name 必须用正斜杠。DCloud 的 Android 安装器
 * （libzip / minizip 封装）会把反斜杠条目视为非法 → 整个 wgt 安装失败。
 *
 * 这个脚本统计每个包里「反斜杠条目」的数量。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX\\dist\\release\\wgt';

function entries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    out.push(buf.slice(off + 46, off + 46 + nameLen).toString('utf8'));
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.wgt')).sort();
console.log('扫描 ' + files.length + ' 个 wgt：\n');
console.log('文件'.padEnd(46) + '条目  反斜杠  正常');
console.log('-'.repeat(78));

let anyBad = 0;
for (const f of files) {
  const buf = fs.readFileSync(path.join(DIR, f));
  let es;
  try { es = entries(buf); } catch (e) { es = null; }
  if (!es) { console.log(f.padEnd(46) + '  解析失败'); continue; }
  const bad = es.filter((n) => n.indexOf('\\') >= 0);
  const ok = es.length - bad.length;
  const mark = bad.length ? '✗' : '✓';
  console.log(f.padEnd(46) + String(es.length).padStart(4) + String(bad.length).padStart(8) + String(ok).padStart(7) + '  ' + mark);
  if (bad.length) {
    anyBad++;
    bad.slice(0, 6).forEach((n) => console.log('      ↳ ' + JSON.stringify(n)));
    if (bad.length > 6) console.log('      ↳ …还有 ' + (bad.length - 6) + ' 个');
  }
}

console.log('\n' + (anyBad
  ? '★ ' + anyBad + ' 个 wgt 含反斜杠路径 —— 这些包在 Android 上无法安装'
  : '★ 全部 wgt 路径分隔符正常'));

console.log('\n对照：哪些条目用了正斜杠（说明编译产物本身混着两种）');
const sample = files.find((f) => f.startsWith('album-sync-2030005-20261003114611'));
if (sample) {
  const es = entries(fs.readFileSync(path.join(DIR, sample)));
  console.log('\n' + sample + ' 的 pages/* 条目：');
  es.filter((n) => n.startsWith('pages') || n.indexOf('pages') === 0)
    .forEach((n) => console.log('   ' + (n.indexOf('\\') >= 0 ? '反斜杠 ✗' : '正斜杠 ✓') + '  ' + n));
}
