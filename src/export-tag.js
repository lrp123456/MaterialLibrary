/**
 * 导出标记（写入 JPEG COM / XMP，随文件字节进入系统相册）
 * 用途：保存后即使被改名/重编码部分场景，入库时仍可识别为本端导出件并拒绝重复入库。
 * 标记串：MLX1|<json>，json: {fid,kind,ts,sha256?}
 */
const crypto = require('crypto')
const fs = require('fs')

const MARKER_PREFIX = 'MLX1|'

function buildExportTag({ fid, kind, ts, sha256 } = {}) {
  const payload = {
    fid: String(fid || ''),
    kind: String(kind || 'origin'),
    ts: Number(ts) || Date.now(),
    sha256: String(sha256 || ''),
  }
  return MARKER_PREFIX + JSON.stringify(payload)
}

/** 在 JPEG 中写入 COM 注释段（APP 旁路，一般不破坏图像） */
function injectJpegComMarker(buf, tag) {
  try {
    if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf
    const tagStr = (tag && typeof tag === 'object') ? buildExportTag(tag) : String(tag || '')
    const comment = Buffer.from(tagStr, 'utf8')
    // COM: FF FE len(2, 含自身) data
    const len = comment.length + 2
    if (len > 0xffff) return buf
    const seg = Buffer.alloc(4 + comment.length)
    seg[0] = 0xff
    seg[1] = 0xfe
    seg[2] = (len >> 8) & 0xff
    seg[3] = len & 0xff
    comment.copy(seg, 4)
    // 插在 SOI 之后
    return Buffer.concat([buf.slice(0, 2), seg, buf.slice(2)])
  } catch (_) {
    return buf
  }
}

/** 从 JPEG 字节里提取导出标记 */
function extractExportTag(buf) {
  try {
    if (!buf || buf.length < 4) return null
    // 先扫 COM
    const s = buf.toString('latin1')
    const idx = s.indexOf(MARKER_PREFIX)
    if (idx >= 0) {
      // 取到下一个不可见控制符或足够长
      let end = idx
      while (end < s.length && end - idx < 512) {
        const ch = s.charCodeAt(end)
        if (ch < 9) break
        end++
      }
      const raw = s.slice(idx, end).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
      return parseTag(raw)
    }
    // 兜底：直接搜 {  "fid"
    const j = s.indexOf('{"fid"')
    if (j >= 0) {
      let end = j
      while (end < s.length && end - j < 512 && s[end] !== '\x00') end++
      try {
        return JSON.parse(s.slice(j, end))
      } catch (_) {}
    }
    return null
  } catch (_) {
    return null
  }
}

function parseTag(raw) {
  const t = String(raw || '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch (_) {}
  }
  if (!t.startsWith(MARKER_PREFIX)) {
    try {
      return JSON.parse(t)
    } catch (_) {
      return null
    }
  }
  try {
    return JSON.parse(t.slice(MARKER_PREFIX.length))
  } catch (_) {
    return null
  }
}

/** 判断缓冲/文件是否为本端导出件 */
function isExportedByTag(buf, extra = {}) {
  const tag = extractExportTag(buf)
  if (!tag) return false
  if (extra.fid && tag.fid && extra.fid !== tag.fid) {
    // 标记属于别的素材，也算导出痕迹，但可按需放行
  }
  return true
}

/**
 * 为任意前端可见图片文件计算 sha256/md5 并登记到 export_registry
 */
function registerVisibleImageHashes(db, { filePath, buffer, sourceFid, variant = 'origin', exportedBy = 'system' } = {}) {
  if (!db || !sourceFid) return null;
  try {
    const buf = buffer || (filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath) : null);
    if (!buf || !buf.length) return null;
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    const now = Date.now();
    const variantVal = String(variant || 'origin');
    const byVal = String(exportedBy || 'system');
    db.prepare(`
      INSERT INTO export_registry (sha256, md5, source_fid, kind, marker, created_at, variant, file_size, exported_by, exported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sha256) DO UPDATE SET
        md5 = COALESCE(excluded.md5, export_registry.md5),
        source_fid = COALESCE(export_registry.source_fid, excluded.source_fid),
        kind = COALESCE(export_registry.kind, excluded.kind),
        marker = COALESCE(export_registry.marker, excluded.marker),
        created_at = COALESCE(export_registry.created_at, excluded.created_at),
        variant = COALESCE(export_registry.variant, excluded.variant),
        file_size = COALESCE(export_registry.file_size, excluded.file_size),
        exported_by = COALESCE(export_registry.exported_by, excluded.exported_by),
        exported_at = COALESCE(export_registry.exported_at, excluded.exported_at)
    `).run(sha256, md5, String(sourceFid), variantVal, byVal, now, variantVal, buf.length, byVal, now);
    return { sha256, md5, size: buf.length };
  } catch (_) {
    return null;
  }
}

/**
 * 对导出的 JPEG Buffer 自动注入 MLX1 COM 暗标，并将注入前后的双份哈希全部写入 export_registry
 */
function prepareExportableBuffer(db, buf, { fid, variant = 'origin', mime = 'image/jpeg', exportedBy = 'export' } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return buf;
  // 1. 先登记原始可见图本身哈希（应对浏览器直接右键另存缓存图）
  const rawHashes = registerVisibleImageHashes(db, { buffer: buf, sourceFid: fid, variant, exportedBy });
  // 2. 若是 JPEG（0xFF 0xD8），注入 MLX1 COM 标记并同时登记注入后的新哈希
  const isJpeg = (buf[0] === 0xff && buf[1] === 0xd8) || /jpe?g/i.test(String(mime || ''));
  if (!isJpeg) return buf;
  try {
    const tag = {
      fid: String(fid || 'unknown'),
      kind: String(variant || 'origin'),
      sha256: rawHashes ? rawHashes.sha256 : '',
    };
    const taggedBuf = injectJpegComMarker(buf, tag);
    if (taggedBuf && taggedBuf !== buf) {
      registerVisibleImageHashes(db, { buffer: taggedBuf, sourceFid: fid, variant: `${variant}_tagged`, exportedBy });
      return taggedBuf;
    }
  } catch (_) {}
  return buf;
}

module.exports = {
  MARKER_PREFIX,
  buildExportTag,
  injectJpegComMarker,
  extractExportTag,
  parseTag,
  isExportedByTag,
  registerVisibleImageHashes,
  prepareExportableBuffer,
}
