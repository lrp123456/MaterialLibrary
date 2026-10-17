/**
 * 导出标记（写入 JPEG COM / XMP，随文件字节进入系统相册）
 * 用途：保存后即使被改名/重编码部分场景，入库时仍可识别为本端导出件并拒绝重复入库。
 * 标记串：MLX1|<json>，json: {fid,kind,ts,sha256?}
 */
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
    const comment = Buffer.from(String(tag), 'utf8')
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

module.exports = {
  MARKER_PREFIX,
  buildExportTag,
  injectJpegComMarker,
  extractExportTag,
  parseTag,
  isExportedByTag,
}
