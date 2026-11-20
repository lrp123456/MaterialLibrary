/**
 * wgt-pipeline.js · WGT 出包流水线（Pack Studio 专用）
 *
 * 唯一允许的出包路径，串行四步，任何一步失败立即中止并如实报错：
 *
 *   1) 隔离编译   src 只读复制到临时目录跑 uni build -p app
 *   2) 产物闸门   exit code / 新鲜度 / 大小 / 标识符 / 生产指纹
 *   3) 压缩       只压第 1 步刚编出来的那一个目录（不做任何目录挑选）
 *   4) 字节校验   解开 wgt 比对 app-service.js 的 sha256，必须与第 1 步完全一致
 *
 * 「不做目录挑选」是刻意的：历史上 Select-BestWww 从 4 个候选目录里挑，
 * 编译失败时就会挑到几天前的目录重新打包推给用户。
 * 这里没有挑选，只有「本次编译产物」这一个来源。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { freshBuild } = require('./fresh-build');
const { verifyWgt } = require('./wgt-verify');
const { allocateWgtVersion } = require('./wgt-version');

/** 把整个目录打成 zip（store + deflate，目录条目不写，避免 wgt 里出现空目录） */
function zipDir(dir, outFile, patch) {
  const files = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else files.push(p);
    }
  })(dir);

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const abs of files) {
    const rel = path.relative(dir, abs).replace(/\\/g, '/');
    const nameBuf = Buffer.from(rel, 'utf8');
    let data = fs.readFileSync(abs);
    // manifest.json 需要在压缩阶段改写 version.code，
    // 让包内版本与本次分配的 wgtVersion 完全一致（客户端据此判定新旧）。
    if (patch && patch.manifest && rel === 'manifest.json') {
      const j = JSON.parse(data.toString('utf8').replace(/^﻿/, ''));
      j.version = Object.assign({}, j.version, patch.manifest);
      data = Buffer.from(JSON.stringify(j, null, 2), 'utf8');
    }
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 名称
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(0, 10); // time
    lh.writeUInt16LE(0x21, 12); // date (1980-01-01)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outFile, Buffer.concat([...chunks, centralBuf, eocd]));
  return { fileCount: files.length, bytes: fs.statSync(outFile).size };
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 版本收据：优先用调用方给的，否则从项目的 version-state.json 只读解析 */
function readVersionReceipt(APP) {
  try {
    const p = path.join(APP, 'src', 'version-state.json');
    const raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
    const st = JSON.parse(raw);
    return {
      versionName: st.versionName || '',
      versionCode: Number(st.versionCode || 0),
      machineCode: Number(st.machineCode || 0),
      buildCode: Number(st.buildCode || 0),
    };
  } catch (e) {
    return { versionName: '', versionCode: 0, machineCode: 0, buildCode: 0 };
  }
}

function syncVersionToApp(APP, alloc) {
  try {
    const p = path.join(APP, 'src', 'version-state.json');
    let st = {};
    try {
      st = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
    } catch (e) {}
    st.versionName = alloc.versionName;
    st.versionCode = alloc.versionCode;
    st.machineCode = alloc.machineCode;
    st.buildCode = alloc.wgtVersion;
    st.updatedAt = new Date().toISOString();
    if (!Array.isArray(st.history)) st.history = [];
    st.history.unshift({
      at: new Date().toISOString(),
      versionName: alloc.versionName,
      versionCode: alloc.versionCode,
      machineCode: alloc.machineCode,
      buildCode: alloc.wgtVersion,
      note: alloc.note || '',
    });
    if (st.history.length > 50) st.history = st.history.slice(0, 50);
    fs.writeFileSync(p, JSON.stringify(st, null, 2), 'utf8');

    const mfPath = path.join(APP, 'src', 'manifest.json');
    if (fs.existsSync(mfPath)) {
      const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8').replace(/^﻿/, ''));
      if (mf.version) {
        mf.version.name = alloc.versionName;
        mf.version.code = String(alloc.wgtVersion);
      }
      mf.versionName = alloc.versionName;
      mf.versionCode = String(alloc.wgtVersion);
      fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2), 'utf8');
    }
  } catch (e) {
    console.warn('[wgt-pipeline] syncVersionToApp error:', e);
  }
}

/**
 * 完整 WGT 流水线。
 * @param {string} APP  App 项目根（只读）
 * @param {object} opt  { outDir, note, onLog, bumpVersion }
 */
async function buildWgt(APP, opt) {
  const onLog = opt.onLog || (() => {});
  const outDir = opt.outDir || path.join(APP, 'dist', 'release', 'wgt');
  const note = String(opt.note || '热更新');
  const bumpVersion = !!opt.bumpVersion;

  // ── 1) 版本号分配并同步回源码 ────────────────────────────
  onLog('\n════════ 1/4 版本号分配 ════════\n');
  const ver = readVersionReceipt(APP);
  const alloc = allocateWgtVersion({
    buildCode: ver.buildCode,
    versionCode: ver.versionCode,
    versionName: ver.versionName,
    bumpVersion,
    appRoot: APP,
    note,
  });
  onLog('  当前基准: ' + ver.versionName + ' (' + ver.buildCode + ') 上次发出=' + alloc.prev +
        ' → 本次版本=' + alloc.versionName + ' (buildCode ' + alloc.wgtVersion + ' · 机器号 ' + alloc.machineCode + ')\n');
  syncVersionToApp(APP, alloc);

  // ── 2) 隔离编译 ───────────────────────────────────────────
  onLog('\n════════ 2/4 隔离编译 ════════\n');
  const receipt = await freshBuild(APP, onLog);

  // ── 3) 压缩产物 ───────────────────────────────────────────
  onLog('\n════════ 3/4 压缩 ════════\n');
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
  fs.mkdirSync(outDir, { recursive: true });
  const wgtPath = path.join(outDir, 'album-sync-' + alloc.wgtVersion + '-' + stamp + '.wgt');
  const z = zipDir(receipt.www, wgtPath, {
    manifest: { name: alloc.versionName, code: String(alloc.wgtVersion) },
  });
  onLog('  源目录(本次编译): ' + receipt.www + '\n');
  onLog('  输出: ' + wgtPath + '  ' + z.fileCount + ' 个文件 ' + z.bytes + ' 字节\n');

  // ── 4) 字节级同源校验 ─────────────────────────────────────
  onLog('\n════════ 4/4 出包同源校验 ════════\n');
  const v = verifyWgt(wgtPath, receipt);
  onLog('  sha256 一致: ' + v.appServiceSha256.slice(0, 16) + '\n');
  onLog('  包内文件数: ' + v.entryCount + '\n');

  // 包内 manifest.code 必须等于本次 wgtVersion，否则客户端会拿旧号去比较
  const inner = v.manifestVersion || {};
  if (String(inner.code) !== String(alloc.wgtVersion)) {
    throw new Error(
      '包内 manifest.version.code 与本次 wgtVersion 不一致，拒绝推送！\n' +
        '  包内 code: ' + inner.code + '\n' +
        '  本次 wgtVersion: ' + alloc.wgtVersion
    );
  }
  onLog('  包内 manifest.code: ' + inner.code + '（= 本次 wgtVersion ✓）\n');

  const meta = {
    file: wgtPath,
    fileName: path.basename(wgtPath),
    type: 'wgt',
    versionCode: alloc.wgtVersion,
    versionName: alloc.versionName,
    wgtVersion: alloc.wgtVersion,
    machineCode: alloc.machineCode,
    buildCode: alloc.wgtVersion,
    note,
    size: z.bytes,
    builtAt: receipt.finishedAt,
    buildReceipt: receipt,
    versionAlloc: alloc,
    verify: v,
  };
  fs.writeFileSync(wgtPath + '.json', JSON.stringify(meta, null, 2), 'utf8');

  return meta;
}

module.exports = { buildWgt, zipDir, readVersionReceipt, syncVersionToApp };
