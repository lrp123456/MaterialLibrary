/**
 * _diff_wgt.js · 对比「安装成功」与「安装失败」两个 wgt 的 zip 结构差异
 *
 * 事实基础（来自设备端 storage + 文件时间）：
 *   album-sync-2020000-20261002103345.wgt  → 设备 www mtime 2026-10-02 10:33:20  ✅ 装上了
 *   album-sync-2030005-20261003114611.wgt  → storage 记录 11:46:23 下载成功，www 未变 ❌ 没装上
 *
 * 目标：找出两者在 zip 层面的实质差异，判断 plus.runtime.install 为什么拒绝后者。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX\\dist\\release\\wgt';
const GOOD = 'album-sync-2020000-20261002103345.wgt';
const BAD = 'album-sync-2030005-20261003114611.wgt';

function readDir(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const rec = {
      verMade: buf.readUInt16LE(off + 4),
      verNeed: buf.readUInt16LE(off + 6),
      flags: buf.readUInt16LE(off + 8),
      method: buf.readUInt16LE(off + 10),
      time: buf.readUInt16LE(off + 12),
      date: buf.readUInt16LE(off + 14),
      crc: buf.readUInt32LE(off + 16),
      compSize: buf.readUInt32LE(off + 20),
      rawSize: buf.readUInt32LE(off + 24),
      nameLen: buf.readUInt16LE(off + 28),
      extraLen: buf.readUInt16LE(off + 30),
      cmtLen: buf.readUInt16LE(off + 32),
      diskStart: buf.readUInt16LE(off + 34),
      intAttr: buf.readUInt16LE(off + 36),
      extAttr: buf.readUInt32LE(off + 38),
      localOff: buf.readUInt32LE(off + 42),
    };
    rec.name = buf.slice(off + 46, off + 46 + rec.nameLen).toString('utf8');
    out.push(rec);
    off += 46 + rec.nameLen + rec.extraLen + rec.cmtLen;
  }
  return { entries: out, eocd: {
    disk: buf.readUInt16LE(eocd + 4),
    cdDisk: buf.readUInt16LE(eocd + 6),
    thisCount: buf.readUInt16LE(eocd + 8),
    totalCount: buf.readUInt16LE(eocd + 10),
    cdSize: buf.readUInt32LE(eocd + 12),
    cdOff: buf.readUInt32LE(eocd + 16),
    cmtLen: buf.readUInt16LE(eocd + 20),
  }};
}

function analyze(file) {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  const { entries, eocd } = readDir(buf);
  const st = fs.statSync(p);

  // 关键字段汇总
  const methods = {};
  const flags = {};
  const vers = {};
  let withExtra = 0, withCmt = 0, dirEntries = 0, utf8Flag = 0;
  for (const e of entries) {
    methods[e.method] = (methods[e.method] || 0) + 1;
    flags['0x' + e.flags.toString(16)] = (flags['0x' + e.flags.toString(16)] || 0) + 1;
    vers[e.verNeed] = (vers[e.verNeed] || 0) + 1;
    if (e.extraLen > 0) withExtra++;
    if (e.cmtLen > 0) withCmt++;
    if (e.name.endsWith('/')) dirEntries++;
    if (e.flags & 0x0800) utf8Flag++;
  }
  // local header 里的 version / 是否用了 data descriptor(bit3)
  let localVerNeed = new Set(), localFlags = new Set();
  for (const e of entries) {
    const lo = e.localOff;
    if (buf.readUInt32LE(lo) !== 0x04034b50) continue;
    localVerNeed.add(buf.readUInt16LE(lo + 4));
    localFlags.add(buf.readUInt16LE(lo + 6));
  }

  // manifest.json
  let mfVer = '(无)';
  const mfe = entries.find((e) => e.name === 'manifest.json');
  if (mfe) {
    try {
      const lo = mfe.localOff;
      const nl = buf.readUInt16LE(lo + 26), el = buf.readUInt16LE(lo + 28);
      const s = lo + 30 + nl + el;
      const raw = buf.slice(s, s + mfe.compSize);
      const data = mfe.method === 0 ? raw : zlib.inflateRawSync(raw);
      const j = JSON.parse(data.toString('utf8').replace(/^﻿/, ''));
      mfVer = JSON.stringify(j.version || {});
    } catch (e) { mfVer = '解析失败: ' + e.message; }
  }

  return {
    file, bytes: st.length, mtime: st.mtime.toISOString(),
    count: entries.length, eocd,
    methods, flags, verNeedCentral: vers, localVerNeed: [...localVerNeed], localFlags: [...localFlags],
    withExtra, withCmt, dirEntries, utf8Flag,
    names: entries.map((e) => e.name),
    mfVer,
  };
}

const g = analyze(GOOD);
const b = analyze(BAD);

function dump(t, x) {
  if (!x) { console.log('  (文件不存在) ' + t); return; }
  console.log('\n══════ ' + t + ' ══════');
  console.log('  文件大小: ' + x.bytes + '  mtime: ' + x.mtime);
  console.log('  条目数: ' + x.count);
  console.log('  压缩方法分布: ' + JSON.stringify(x.methods) + '  (0=store 8=deflate)');
  console.log('  通用标志位分布: ' + JSON.stringify(x.flags));
  console.log('  central versionNeeded: ' + JSON.stringify(x.verNeedCentral));
  console.log('  local  versionNeeded: ' + JSON.stringify(x.localVerNeed));
  console.log('  local  flags: ' + JSON.stringify(x.localFlags.map((v) => '0x' + v.toString(16))));
  console.log('  带 extra 字段的条目: ' + x.withExtra + '/' + x.count);
  console.log('  带 comment 的条目: ' + x.withCmt);
  console.log('  目录条目(以/结尾): ' + x.dirEntries);
  console.log('  UTF-8 标志(0x800): ' + x.utf8Flag);
  console.log('  EOCD: ' + JSON.stringify(x.eocd));
  console.log('  包内 manifest.version: ' + x.mfVer);
  console.log('  前 12 个条目: ' + x.names.slice(0, 12).join(', '));
}

dump('✅ 装成功的（2020000 @10-02 10:33）', g);
dump('❌ 没装上的（2030005 @10-03 11:46）', b);

if (g && b) {
  console.log('\n══════ 差异汇总 ══════');
  const gs = new Set(g.names), bs = new Set(b.names);
  const onlyG = g.names.filter((n) => !bs.has(n));
  const onlyB = b.names.filter((n) => !gs.has(n));
  console.log('只在成功包里的条目 (' + onlyG.length + '): ' + (onlyG.slice(0, 20).join(', ') || '无'));
  console.log('只在失败包里的条目 (' + onlyB.length + '): ' + (onlyB.slice(0, 20).join(', ') || '无'));
  console.log('\n压缩方法:  成功=' + JSON.stringify(g.methods) + '  失败=' + JSON.stringify(b.methods));
  console.log('标志位:    成功=' + JSON.stringify(g.flags) + '  失败=' + JSON.stringify(b.flags));
  console.log('versionNeeded(local): 成功=' + JSON.stringify(g.localVerNeed) + '  失败=' + JSON.stringify(b.localVerNeed));
  console.log('manifest.version: 成功=' + g.mfVer + '  失败=' + b.mfVer);
}
