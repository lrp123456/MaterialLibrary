/**
 * 对话用的图片引用。
 * 本机素材按「衍生图 → 原图」读成 Buffer；超过内联上限时用 sharp 压缩，
 * 压缩后仍过大才上传 OSS 临时对象（请求结束立即删除，失败由定时清扫兜底）。
 * 任何一步失败都返回带原因的结果，不再静默丢图。
 */
const { resolveAssetBuffer } = require('./ai-tasks');

const CHAT_IMAGE_MAX = 1500000;
const CHAT_IMAGE_HARD_MAX = 8 * 1024 * 1024;
const CHAT_IMAGE_MAX_EDGE = 2048;

function looksLikeRawBase64(s) {
  if (!s || s.length < 80 || s.length > CHAT_IMAGE_HARD_MAX * 1.4) return false;
  if (/[\/\\.@\s:]/.test(s)) return false;
  return /^[A-Za-z0-9+/=]+$/.test(s);
}

function imageMimeFrom(buf) {
  if (!buf || buf.length < 12) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return 'image/webp';
  return 'image/jpeg';
}

function extForMime(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.jpg';
}

function refLabel(img) {
  const s = typeof img === 'string' ? img : (img?.url || '');
  if (!s) return '(空引用)';
  if (s.startsWith('data:image/')) return `data:${s.slice(11, 30)}…`;
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

function ownHosts(config) {
  const hosts = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '10.0.2.2']);
  const base = config?.bffPublicBase || process.env.BFF_PUBLIC_BASE || '';
  try {
    if (base) hosts.add(new URL(base).hostname);
  } catch (_) {}
  return hosts;
}

async function compressForChat(buf, mime) {
  if (buf.length <= CHAT_IMAGE_MAX) return { buf, mime, compressed: false };
  try {
    const sharp = require('sharp');
    const out = await sharp(buf, { failOn: 'none' })
      .rotate()
      .resize({
        width: CHAT_IMAGE_MAX_EDGE,
        height: CHAT_IMAGE_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    if (out.length < buf.length) return { buf: out, mime: 'image/jpeg', compressed: true };
  } catch (_) {}
  return { buf, mime, compressed: false };
}

async function fromBuffer(db, config, buf, declaredMime, label) {
  if (!buf || !buf.length) return { error: '图片文件为空' };
  const mime = declaredMime || imageMimeFrom(buf);
  const shrunk = await compressForChat(buf, mime);
  const out = shrunk.buf;
  const outMime = shrunk.mime;

  if (out.length <= CHAT_IMAGE_MAX) {
    return {
      url: `data:${outMime};base64,${out.toString('base64')}`,
      delivery: 'inline',
      bytes: out.length,
      mime: outMime,
      compressed: shrunk.compressed,
      label,
    };
  }

  const oss = require('./oss');
  const services = { db, config };
  if (oss.isOssEnabled(services)) {
    try {
      const key = `chat-temp/${new Date().toISOString().slice(0, 10)}/${Date.now()}_${require('crypto').randomBytes(8).toString('hex')}${extForMime(outMime)}`;
      const up = await oss.uploadBuffer(out, { key, contentType: outMime, services });
      return {
        url: up.url,
        delivery: 'oss',
        bytes: out.length,
        mime: outMime,
        objectKey: up.objectKey,
        compressed: shrunk.compressed,
        label,
      };
    } catch (e) {
      if (out.length > CHAT_IMAGE_HARD_MAX) {
        return { error: `图片 ${(out.length / 1048576).toFixed(1)}MB，压缩后仍超过上限，OSS 上传失败：${e.message}` };
      }
      return {
        url: `data:${outMime};base64,${out.toString('base64')}`,
        delivery: 'inline',
        bytes: out.length,
        mime: outMime,
        compressed: shrunk.compressed,
        oversized: true,
        warning: `图片未压到 1.5MB 以下，且 OSS 暂不可用（${e.message}），已按原图内联发送`,
        label,
      };
    }
  }

  if (out.length <= CHAT_IMAGE_HARD_MAX) {
    return {
      url: `data:${outMime};base64,${out.toString('base64')}`,
      delivery: 'inline',
      bytes: out.length,
      mime: outMime,
      compressed: shrunk.compressed,
      oversized: true,
      warning: '图片未压到 1.5MB 以下，OSS 未配置，已按原图内联发送',
      label,
    };
  }
  return { error: `图片 ${(out.length / 1048576).toFixed(1)}MB，超过 8MB 内联上限，OSS 未配置` };
}

async function prepareChatImage(db, config, img) {
  if (!img) return { error: '空图片引用' };
  if (typeof img !== 'string') {
    if (img.url) return prepareChatImage(db, config, img.url);
    const b64 = img.b64 || img.data;
    if (!b64) return { error: '图片对象缺少 url/base64' };
    return fromBuffer(db, config, Buffer.from(String(b64), 'base64'), img.mime, refLabel(img));
  }

  const s = img.trim();
  if (!s) return { error: '空图片引用' };
  const label = refLabel(s);
  if (s.startsWith('blob:')) return { error: '浏览器 blob 图片未上传到服务端', label };

  if (s.startsWith('data:image/')) {
    const comma = s.indexOf(',');
    if (comma < 0) return { error: 'data URL 缺少 base64 内容', label };
    const mime = (s.slice(5, comma).split(';')[0] || 'image/jpeg').trim();
    return fromBuffer(db, config, Buffer.from(s.slice(comma + 1), 'base64'), mime, label);
  }

  if (/^https?:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { return { error: '图片 URL 不合法', label }; }
    if (!ownHosts(config).has(u.hostname)) {
      // 外网图片交给模型服务端抓取；我们不在服务端代取，避免 SSRF 与代理问题。
      return { url: s, delivery: 'remote', label };
    }
    return prepareChatImage(db, config, `${u.pathname}${u.search}`);
  }

  if (looksLikeRawBase64(s)) {
    return fromBuffer(db, config, Buffer.from(s, 'base64'), 'image/jpeg', label);
  }

  try {
    const buf = await resolveAssetBuffer({ db, config }, s);
    if (!buf || !buf.length) return { error: '本地素材解析不到图片文件', label };
    return fromBuffer(db, config, buf, '', label);
  } catch (e) {
    return { error: `读取素材失败：${e.message}`, label };
  }
}

async function prepareChatImages(db, config, images) {
  const parts = [];
  const notes = [];
  const tempKeys = [];
  const seen = new Set();
  for (const img of Array.isArray(images) ? images : []) {
    if (!img) continue;
    const key = typeof img === 'string' ? img : (img.url || img.b64 || img.data || '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const r = await prepareChatImage(db, config, img);
    if (r.url) {
      parts.push({ type: 'image_url', image_url: { url: r.url } });
      if (r.objectKey) tempKeys.push(r.objectKey);
    }
    notes.push({
      ref: r.label || '',
      delivery: r.url ? r.delivery : 'dropped',
      bytes: r.bytes || null,
      mime: r.mime || null,
      compressed: Boolean(r.compressed),
      objectKey: r.objectKey || null,
      warning: r.warning || null,
      reason: r.error || null,
    });
  }
  return { parts, notes, tempKeys };
}

async function cleanupChatTempObjects(services, objectKeys) {
  if (!Array.isArray(objectKeys) || !objectKeys.length) return;
  try {
    const oss = require('./oss');
    await Promise.allSettled(objectKeys.map((key) => oss.deleteObject(key, services)));
  } catch (_) {}
}

module.exports = {
  chatImageDataUrl: async (db, config, img) => {
    const r = await prepareChatImage(db, config, img);
    return r.url || null;
  },
  prepareChatImage,
  prepareChatImages,
  cleanupChatTempObjects,
  looksLikeRawBase64,
  CHAT_IMAGE_MAX,
};
