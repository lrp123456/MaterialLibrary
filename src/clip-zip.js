/**
 * 最小 ZIP 读写，只用 node:zlib 与 node:fs，不引第三方依赖。
 *
 * 写：
 * - 只支持 store(0) 与 deflate(8)；
 * - 文件名一律 UTF-8，置 flag bit 11（0x0800）；
 * - 一律带 data descriptor（flag bit 3），所以本地头里的 crc/大小留 0，
 *   真实值写在数据后面的描述符与中央目录里。好处是能边读磁盘边压，不必把
 *   一个 500MB 的素材整个读进内存。
 * 读：
 * - 先扫 EOCD → 中央目录 → 按本地头偏移取数据，支持 store/deflate；
 *   中央目录里带真实大小，因此兼容「带 data descriptor」的包（含 7z/系统压缩）。
 *
 * 不支持：ZIP64（单文件 ≥4GB / 总条目 >65535）、加密、多分卷。
 * 这些情况一律抛可读错误，别生成半截坏包。
 */
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_DESCRIPTOR = 0x08074b50;

// bit 3：带 data descriptor；bit 11：文件名为 UTF-8
const FLAGS = 0x0008 | 0x0800;

const CHUNK = 1024 * 1024; // 流式压缩的块大小
const MAX_ENTRY = 0xfffffffe; // 再大就得 ZIP64

// ---- CRC32（ZIP 用的是标准多项式 0xEDB88320）----
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

/** 增量 CRC32：crc = crc32(chunk, crc)。 */
function crc32(buf, seed = 0) {
  let c = ~seed >>> 0;
  for (let i = 0; i < buf.length; i += 1) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return ~c >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((Math.floor(date.getSeconds() / 2) & 0x1f) << 0),
    date:
      (((year - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      (date.getDate() & 0x1f),
  };
}

function normalizeEntryName(name) {
  const raw = String(name || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || raw.split('/').includes('..')) {
    throw Object.assign(new Error(`压缩包条目名不合法：${name}`), { status: 400 });
  }
  return raw;
}

/** 分块读文件，避免整块进内存。 */
function* fileChunks(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    for (;;) {
      const buf = Buffer.allocUnsafe(CHUNK);
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) return;
      yield n === CHUNK ? buf : buf.subarray(0, n);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function* bufferChunks(buf) {
  if (buf.length <= CHUNK) {
    yield buf;
    return;
  }
  for (let i = 0; i < buf.length; i += CHUNK) {
    yield buf.subarray(i, Math.min(i + CHUNK, buf.length));
  }
}

class ZipWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = fs.openSync(filePath, 'w');
    this.offset = 0;
    this.entries = [];
  }

  _write(buf) {
    if (!buf || !buf.length) return;
    fs.writeSync(this.fd, buf);
    this.offset += buf.length;
  }

  _localHeader({ nameBuf, method, time, date }) {
    const b = Buffer.alloc(30);
    b.writeUInt32LE(SIG_LOCAL, 0);
    b.writeUInt16LE(20, 4); // version needed
    b.writeUInt16LE(FLAGS, 6);
    b.writeUInt16LE(method, 8);
    b.writeUInt16LE(time, 10);
    b.writeUInt16LE(date, 12);
    b.writeUInt32LE(0, 14); // crc32 → data descriptor
    b.writeUInt32LE(0, 18); // compressed size
    b.writeUInt32LE(0, 22); // uncompressed size
    b.writeUInt16LE(nameBuf.length, 26);
    b.writeUInt16LE(0, 28); // extra len
    return b;
  }

  /**
   * 追加一个条目。chunks 是同步迭代器，compress=false 走 store。
   * 返回 { size, sha256 }，给"边写边算清单"用。
   */
  _add(name, chunks, { compress = true } = {}) {
    const entryName = normalizeEntryName(name);
    const nameBuf = Buffer.from(entryName, 'utf8');
    const method = compress ? 8 : 0;
    const { time, date } = dosDateTime();
    const localOffset = this.offset;

    this._write(this._localHeader({ nameBuf, method, time, date }));
    this._write(nameBuf);

    const hash = crypto.createHash('sha256');
    let crc = 0;
    let size = 0;
    let compressed = 0;

    const emit = (out) => {
      if (!out || !out.length) return;
      this._write(out);
      compressed += out.length;
    };

    const it = chunks[Symbol.iterator]();
    try {
      let cur = it.next();

      if (method === 0) {
        for (; !cur.done; cur = it.next()) {
          const chunk = cur.value;
          hash.update(chunk);
          crc = crc32(chunk, crc);
          size += chunk.length;
          emit(chunk);
        }
      } else if (cur.done || !cur.value.length) {
        // 空文件也要吐一个完整的 deflate 流（2 字节）
        emit(zlib.deflateRawSync(Buffer.alloc(0), { finishFlush: zlib.constants.Z_FINISH }));
      } else {
        for (;;) {
          const chunk = cur.value;
          const next = it.next();
          const last = next.done || !next.value.length;
          hash.update(chunk);
          crc = crc32(chunk, crc);
          size += chunk.length;
          emit(
            zlib.deflateRawSync(chunk, {
              // 非最后一块用 SYNC_FLUSH 才能逐块输出，最后一块收尾
              finishFlush: last ? zlib.constants.Z_FINISH : zlib.constants.Z_SYNC_FLUSH,
            }),
          );
          if (last) break;
          cur = next;
        }
      }
    } finally {
      // 中途抛错（磁盘满等）时让生成器关掉自己打开的 fd
      if (typeof it.return === 'function') it.return();
    }

    if (size > MAX_ENTRY || compressed > MAX_ENTRY) {
      throw Object.assign(new Error(`条目 ${entryName} 超过 4GB，暂不支持 ZIP64`), { status: 413 });
    }

    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(SIG_DESCRIPTOR, 0);
    dd.writeUInt32LE(crc, 4);
    dd.writeUInt32LE(compressed, 8);
    dd.writeUInt32LE(size, 12);
    this._write(dd);

    this.entries.push({
      name: entryName,
      nameBuf,
      method,
      flags: FLAGS,
      crc,
      size,
      compressed,
      localOffset,
      time,
      date,
    });

    return { size, sha256: hash.digest('hex'), compressed };
  }

  addBuffer(name, buf, options) {
    return this._add(name, bufferChunks(Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '')), options);
  }

  addJson(name, value) {
    return this.addBuffer(name, Buffer.from(JSON.stringify(value, null, 2), 'utf8'));
  }

  addFile(name, filePath, options) {
    return this._add(name, fileChunks(filePath), options);
  }

  /** 写中央目录与 EOCD，返回 { size, entries }。 */
  close() {
    if (this.fd == null) return { size: this.offset, entries: this.entries.length };
    if (this.entries.length > 0xffff) {
      throw Object.assign(new Error('条目数超过 65535，暂不支持 ZIP64'), { status: 413 });
    }
    const cdStart = this.offset;
    for (const e of this.entries) {
      const b = Buffer.alloc(46);
      b.writeUInt32LE(SIG_CENTRAL, 0);
      b.writeUInt16LE(0x031e, 4); // made by: UNIX + 3.0
      b.writeUInt16LE(20, 6); // version needed
      b.writeUInt16LE(e.flags, 8);
      b.writeUInt16LE(e.method, 10);
      b.writeUInt16LE(e.time, 12);
      b.writeUInt16LE(e.date, 14);
      b.writeUInt32LE(e.crc, 16);
      b.writeUInt32LE(e.compressed, 20);
      b.writeUInt32LE(e.size, 24);
      b.writeUInt16LE(e.nameBuf.length, 28);
      b.writeUInt16LE(0, 30); // extra
      b.writeUInt16LE(0, 32); // comment
      b.writeUInt16LE(0, 34); // disk start
      b.writeUInt16LE(0, 36); // internal attrs
      b.writeUInt32LE(0o644 << 16, 38); // external attrs: rw-r--r--
      b.writeUInt32LE(e.localOffset, 42);
      this._write(b);
      this._write(e.nameBuf);
    }
    const cdSize = this.offset - cdStart;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4); // disk
    eocd.writeUInt16LE(0, 6); // cd disk
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20); // comment len
    this._write(eocd);

    const size = this.offset;
    fs.closeSync(this.fd);
    this.fd = null;
    return { size, entries: this.entries.length };
  }

  /** 出错时务必调用，避免句柄泄漏。 */
  abort() {
    if (this.fd != null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        /* 忽略 */
      }
      this.fd = null;
    }
  }
}

/**
 * 一次性写一个 zip 文件。
 * entries: [{ name, data?: Buffer|string, path?: string, compress?: boolean }]
 */
function writeZip(filePath, entries = []) {
  const writer = new ZipWriter(filePath);
  try {
    for (const item of entries) {
      if (item.path) writer.addFile(item.name, item.path, { compress: item.compress !== false });
      else writer.addBuffer(item.name, item.data, { compress: item.compress !== false });
    }
    return writer.close();
  } catch (e) {
    writer.abort();
    throw e;
  }
}

/** 只算文件 sha256 与大小（导出清单用）。 */
function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for (const chunk of fileChunks(filePath)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest('hex'), size };
}

/** 打开一个 zip 读条目；返回 { entries, names, has, read, readJson }。 */
function openZip(filePath) {
  // 只按需打开文件：调用方可能隔很久才读一个条目，长驻 fd 容易泄漏。
  const readAt = (length, position) => {
    const buf = Buffer.alloc(length);
    if (length <= 0) return buf;
    const f = fs.openSync(filePath, 'r');
    try {
      fs.readSync(f, buf, 0, length, position);
    } finally {
      fs.closeSync(f);
    }
    return buf;
  };

  const total = fs.statSync(filePath).size;
  if (total < 22) throw Object.assign(new Error('不是有效的 ZIP：文件过小'), { status: 400 });

  const tailLen = Math.min(total, 0xffff + 22);
  const tail = readAt(tailLen, total - tailLen);

  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw Object.assign(new Error('不是有效的 ZIP：找不到中央目录'), { status: 400 });

  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw Object.assign(new Error('暂不支持 ZIP64 压缩包'), { status: 400 });
  }

  const cd = readAt(cdSize, cdOffset);

  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) {
      throw Object.assign(new Error('ZIP 中央目录损坏'), { status: 400 });
    }
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    const compressed = cd.readUInt32LE(p + 20);
    const size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (flags & 0x0001) {
      throw Object.assign(new Error('压缩包已加密，无法读取'), { status: 400 });
    }
    entries.push({ name, flags, method, crc, compressed, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const byName = new Map(entries.map((e) => [e.name, e]));

  const readEntry = (name) => {
    const e = byName.get(name);
    if (!e) return null;
    const lh = readAt(30, e.localOffset);
    if (lh.readUInt32LE(0) !== SIG_LOCAL) {
      throw Object.assign(new Error(`ZIP 条目 ${name} 的本地头损坏`), { status: 400 });
    }
    const nameLen = lh.readUInt16LE(26);
    const extraLen = lh.readUInt16LE(28);
    const start = e.localOffset + 30 + nameLen + extraLen;
    const raw = readAt(e.compressed, start);
    if (e.method === 0) return raw;
    if (e.method === 8) return zlib.inflateRawSync(raw);
    throw Object.assign(new Error(`ZIP 条目 ${name} 使用了不支持的压缩方式 ${e.method}`), {
      status: 400,
    });
  };

  return {
    entries,
    names: entries.map((e) => e.name),
    has: (name) => byName.has(name),
    read: readEntry,
    readJson: (name) => {
      const buf = readEntry(name);
      if (!buf) return null;
      try {
        return JSON.parse(buf.toString('utf8'));
      } catch {
        throw Object.assign(new Error(`ZIP 内 ${name} 不是合法 JSON`), { status: 400 });
      }
    },
  };
}

module.exports = {
  ZipWriter,
  writeZip,
  openZip,
  hashFile,
  crc32,
  normalizeEntryName,
};
