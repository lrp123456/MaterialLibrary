/**
 * 验证 Node 版推送模块：
 *  1) 复现 push-update.ps1 的 GBK bug（证明根因判断正确）
 *  2) inspectPackage 能正确解包并读出 app-service.js / manifest
 *  3) 拒绝坏包（缺 app-service.js / 致命语法）
 *  4) 中文 note 原样透传
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { inspectPackage, readZipEntries, readZipFile } = require('./lib/push-update');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}

const DIST = 'C:/Users/lrp/DevEcoStudioProjects/AlbumSyncUniAppX/dist/release/wgt';
// 按 mtime 取最新的包（与 server.js 的 latestPackage 同一规则）
const wgts = fs.readdirSync(DIST)
  .filter((n) => n.endsWith('.wgt') && !/bad_archive/i.test(n))
  .map((n) => ({ n, t: fs.statSync(path.join(DIST, n)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
console.log('  dist 下共 ' + wgts.length + ' 个 wgt，最新 3 个：');
wgts.slice(0, 3).forEach((x) => console.log('    ' + x.n + '  ' + new Date(x.t).toISOString()));
const latest = path.join(DIST, wgts[0].n);
const sidecar = latest + '.json';

console.log('═══ 1. 复现 push-update.ps1 的 GBK bug ═══');
ok('sidecar 存在', fs.existsSync(sidecar), sidecar);
const raw = fs.readFileSync(sidecar);
const strip = (s) => s.replace(/^﻿/, '');
const utf8 = JSON.parse(strip(raw.toString('utf8')));
const NOTE = utf8.note;
ok('UTF-8 读取 note 正常', /[\u4e00-\u9fa5]/.test(NOTE || ''), JSON.stringify(NOTE));

// 模拟 PowerShell 5.1 的 Get-Content -Raw | ConvertFrom-Json（GBK 解码）
const gbkText = new TextDecoder('gbk').decode(raw);
let gbkErr = null, gbkNote = null;
try { gbkNote = JSON.parse(strip(gbkText)).note; } catch (e) { gbkErr = e.message; }
console.log('  UTF-8 note: ' + JSON.stringify(NOTE));
console.log('  GBK   note: ' + JSON.stringify(gbkNote) + (gbkErr ? '  ←解析直接失败: ' + gbkErr : ''));
if (gbkErr) {
  ok('GBK 读取导致 JSON 解析失败（正是 ps1 的报错）', true);
} else {
  ok('GBK 读取后 note 被解码破坏', gbkNote !== NOTE, gbkNote);
  ok('GBK 下出现替换字符 U+FFFD', gbkNote && gbkNote.includes('�'), JSON.stringify(gbkNote));
}

console.log('\n═══ 2. inspectPackage 正确解包 ═══');
try {
  const info = inspectPackage(latest);
  ok('识别为 wgt', info.isApk === false);
  ok('能读出 app-service.js', info.appServiceBytes > 100000, info.appServiceBytes + ' 字节');
  ok('能读出 manifest', !!info.manifest && !!info.manifest.version, JSON.stringify(info.manifest && info.manifest.version));
  const entries = readZipEntries(fs.readFileSync(latest));
  ok('条目数 > 30', entries.size > 30, entries.size + ' 个');
  const svc = readZipFile(entries, 'app-service.js').toString('utf8');
  // 注意：函数名会被压缩器 mangle 成内联匿名函数，标识符只能用稳定字符串字面量
  ok('包内含 wgt_cache（新持久化目录）', svc.includes('_doc/wgt_cache/'));
  ok('包内含 persistWgt 的错误文案', svc.includes('持久化 wgt 异常'));
  ok('包内含 verifyFileExists 的失效提示', svc.includes('安装包已失效'));
  ok('包内含 describePlusError 的错误文案', svc.includes('缓存 wgt 失败 code='));
  ok('包内含失败节流键', svc.includes('app_update_last_failed'));
  ok('包内含 copyTo（真正落盘）', svc.includes('copyTo'));
  ok('包内不含致命语法', !svc.includes('versionTabs:versionTabs'));
} catch (e) {
  ok('inspectPackage 正常', false, e.message);
}

console.log('\n═══ 3. 拒绝坏包 ═══');
{
  // 造一个不含 app-service.js 的 zip
  const zlib = require('zlib');
  function miniZip(files) {
    const chunks = [], central = [];
    let off = 0;
    for (const [name, data] of files) {
      const nb = Buffer.from(name, 'utf8');
      const comp = zlib.deflateRawSync(data, { level: 9 });
      let c = -1;
      const lh = Buffer.alloc(30);
      const table = (() => { const t = new Int32Array(256); for (let i=0;i<256;i++){let x=i;for(let k=0;k<8;k++)x=x&1?0xedb88320^(x>>>1):x>>>1;t[i]=x;} return t; })();
      for (let i=0;i<data.length;i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
      const crc = (c ^ -1) >>> 0;
      lh.writeUInt32LE(0x04034b50,0); lh.writeUInt16LE(20,4); lh.writeUInt16LE(0x0800,6);
      lh.writeUInt16LE(8,8); lh.writeUInt16LE(0,10); lh.writeUInt16LE(0x21,12);
      lh.writeUInt32LE(crc,14); lh.writeUInt32LE(comp.length,18); lh.writeUInt32LE(data.length,22);
      lh.writeUInt16LE(nb.length,26); lh.writeUInt16LE(0,28);
      chunks.push(lh, nb, comp);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50,0); ch.writeUInt16LE(20,4); ch.writeUInt16LE(20,6);
      ch.writeUInt16LE(0x0800,8); ch.writeUInt16LE(8,10); ch.writeUInt16LE(0,12); ch.writeUInt16LE(0x21,14);
      ch.writeUInt32LE(crc,16); ch.writeUInt32LE(comp.length,20); ch.writeUInt32LE(data.length,24);
      ch.writeUInt16LE(nb.length,28); ch.writeUInt32LE(off,42);
      central.push(ch, nb);
      off += lh.length + nb.length + comp.length;
    }
    const cb = Buffer.concat(central);
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50,0); e.writeUInt16LE(files.length,8); e.writeUInt16LE(files.length,10);
    e.writeUInt32LE(cb.length,12); e.writeUInt32LE(off,16);
    return Buffer.concat([...chunks, cb, e]);
  }
  const tmpDir = path.join(require('os').tmpdir(), 'ps-verify');
  fs.mkdirSync(tmpDir, { recursive: true });

  const noSvc = path.join(tmpDir, 'no-svc.wgt');
  fs.writeFileSync(noSvc, miniZip([['manifest.json', Buffer.from('{}')]]));
  let msg = '';
  try { inspectPackage(noSvc); } catch (e) { msg = e.message; }
  ok('拒绝缺 app-service.js 的包', /缺少 app-service\.js/.test(msg), msg);

  const noMf = path.join(tmpDir, 'no-mf.wgt');
  fs.writeFileSync(noMf, miniZip([['app-service.js', Buffer.from('var a=1;')]]));
  msg = '';
  try { inspectPackage(noMf); } catch (e) { msg = e.message; }
  ok('拒绝缺 manifest.json 的包', /缺少 manifest\.json/.test(msg), msg);

  const bad = path.join(tmpDir, 'bad.wgt');
  fs.writeFileSync(bad, miniZip([
    ['app-service.js', Buffer.from('var o={versionTabs:versionTabs};')],
    ['manifest.json', Buffer.from('{}')],
  ]));
  msg = '';
  try { inspectPackage(bad); } catch (e) { msg = e.message; }
  ok('拦截致命语法 versionTabs:versionTabs', /versionTabs:versionTabs/.test(msg), msg);

  const notZip = path.join(tmpDir, 'notzip.wgt');
  fs.writeFileSync(notZip, Buffer.from('this is not a zip at all'));
  msg = '';
  try { inspectPackage(notZip); } catch (e) { msg = e.message; }
  ok('拒绝非 zip 文件', /EOCD|zip/.test(msg), msg);
}

console.log('\n═══ 4. 中文 note 透传（Node 侧）═══');
{
  const qs = new (require('url').URLSearchParams)();
  qs.set('note', NOTE);
  const back = new (require('url').URLSearchParams)(qs.toString()).get('note');
  ok('URLSearchParams 编解码原样还原中文', back === NOTE, JSON.stringify(back));
  ok('sidecar 里的 note 完整无乱码', NOTE === utf8.note && /[\u4e00-\u9fa5]/.test(NOTE), JSON.stringify(NOTE));
  // PowerShell 传参路径（-Note 中文）：ps1 用 [uri]::EscapeDataString 也没问题，
  // 真正的坑在读 sidecar。这里额外确认 Node 侧拼的 URL 不含裸中文/裸引号。
  const url = 'http://x/api/app/update/upload?' + qs.toString();
  ok('拼出的 URL 不含未编码的引号', !/["<>\\^`{|}]/.test(url.split('?')[1]), url.split('?')[1].slice(0, 160));
}

console.log('\n═══ 结果: ' + pass + ' PASS / ' + fail + ' FAIL ═══');
process.exit(fail ? 1 : 0);
