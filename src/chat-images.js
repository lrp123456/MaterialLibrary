/**
 * 对话 / 提示词优化用的图片引用。
 * 本地路径和本机 URL 读成 data URL。读不到就丢掉，不能把路径当成 base64 交给模型。
 */
const { resolveAssetBuffer } = require('./ai-tasks');

const CHAT_IMAGE_MAX = 1500000;

function looksLikeRawBase64(s) {
  if (!s || s.length < 80 || s.length > CHAT_IMAGE_MAX * 1.4) return false;
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

async function chatImageDataUrl(db, config, img) {
  if (!img) return null;
  if (typeof img !== 'string') {
    if (img.url) return chatImageDataUrl(db, config, img.url);
    const b64 = img.b64 || img.data;
    if (!b64) return null;
    if (String(b64).length > CHAT_IMAGE_MAX * 1.4) return null;
    return `data:${img.mime || 'image/jpeg'};base64,${b64}`;
  }
  const s = img.trim();
  if (!s || s.startsWith('blob:')) return null;
  if (s.startsWith('data:image/')) {
    if (s.length > CHAT_IMAGE_MAX * 1.4) return null;
    return s;
  }
  if (/^https?:\/\//i.test(s)) {
    let host = '';
    let pathAndQuery = '';
    try {
      const u = new URL(s);
      host = u.hostname;
      pathAndQuery = `${u.pathname}${u.search}`;
    } catch (_) {
      return null;
    }
    const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!local) return s;
    return chatImageDataUrl(db, config, pathAndQuery);
  }
  if (looksLikeRawBase64(s)) return `data:image/jpeg;base64,${s}`;
  try {
    const buf = await resolveAssetBuffer({ db, config }, s);
    if (!buf || !buf.length || buf.length > CHAT_IMAGE_MAX) return null;
    return `data:${imageMimeFrom(buf)};base64,${buf.toString('base64')}`;
  } catch (_) {
    return null;
  }
}

module.exports = { chatImageDataUrl, looksLikeRawBase64, CHAT_IMAGE_MAX };
