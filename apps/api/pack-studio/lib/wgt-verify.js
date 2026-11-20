/**
 * wgt-verify.js · 出包同源校验（Pack Studio 专用，纯 Node，无需解压工具）
 *
 * 作用：wgt 是 zip。压缩完成后重新打开这个 zip，
 * 把里面的 app-service.js 算 sha256，与本次隔离编译产物逐字节比对。
 *
 * 为什么要多这一道：
 *   闸门保证了「编译产物是新的」，但压缩阶段还有一次「选目录」的机会。
 *   只要压缩时挑了另一个目录（历史上就是从 dist/build/app-plus、
 *   unpackage/.../www 里挑），闸门的保证就作废了。
 *   字节级比对是唯一能证明「推给用户的包 = 这次编译的产物」的检查。
 */
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

/** 读取 zip 中央目录，返回 { name -> {offset, method, compressedSize, size} } */
function readCentralDirectory(buf) {
  // EOCD 签名 0x06054b50，从尾部往前找
  let eocd = -1;
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是合法的 zip/wgt：找不到 EOCD 记录');

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('zip 中央目录损坏');
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    entries[name] = { method, compressedSize, size, localOffset };
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 从 zip 中取出单个文件的内容（Buffer） */
function readEntry(buf, name) {
  const entries = readCentralDirectory(buf);
  const e = entries[name];
  if (!e) throw new Error('wgt 内缺少 ' + name);
  const lo = e.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('zip 本地文件头损坏: ' + name);
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error('不支持的压缩方式 ' + e.method + '（' + name + '）');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 校验一个 wgt 与本次编译产物同源。
 * @param {string} wgtPath
 * @param {object} receipt freshBuild 产出的收据
 * @returns {object} 校验详情
 * @throws {Error} 任何不一致都抛错，由调用方如实报错并拒绝推送
 */
function verifyWgt(wgtPath, receipt) {
  if (!fs.existsSync(wgtPath)) throw new Error('wgt 不存在: ' + wgtPath);
  const buf = fs.readFileSync(wgtPath);
  const entries = readCentralDirectory(buf);

  const required = ['app-service.js', 'manifest.json'];
  const absent = required.filter((r) => !entries[r]);
  if (absent.length) {
    throw new Error('wgt 缺少关键文件: ' + absent.join(', ') + '（包不完整，拒绝推送）');
  }

  const svc = readEntry(buf, 'app-service.js');
  const got = sha256(svc);
  if (got !== receipt.appServiceSha256) {
    throw new Error(
      'wgt 内容不是本次编译的产物！\n' +
        '  本次编译 sha256: ' + receipt.appServiceSha256 + '\n' +
        '  wgt 内    sha256: ' + got + '\n' +
        '  说明压缩时挑了别的目录（' + receipt.www + ' 之外的历史产物）。\n' +
        '  已中止：不会把这个包推给用户。'
    );
  }

  const manifest = JSON.parse(readEntry(buf, 'manifest.json').toString('utf8'));

  return {
    wgtPath,
    bytes: buf.length,
    entryCount: Object.keys(entries).length,
    appServiceSha256: got,
    appServiceBytes: svc.length,
    manifestVersion: manifest.version || null,
    sameAsBuild: true,
  };
}

module.exports = { verifyWgt, readCentralDirectory, readEntry, sha256 };
