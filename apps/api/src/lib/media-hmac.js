/**
 * 媒体文件 HMAC 签名与验签中枢 (Media HMAC Security)
 * 职责：
 *  - 签发 15 分钟有效期的短期安全 HMAC URL
 *  - 供 30002 冷热分层媒体网关 (/media-store/*) 校验签名并实现 30001 卸载
 */
const crypto = require('crypto');
const path = require('path');

const MEDIA_SECRET = process.env.MEDIA_GATEWAY_SECRET || 'mls_media_gateway_secret_v1';

/**
 * 为媒体文件路径签发带 HMAC 签名与时效的 URL
 * @param {string} relPath - 相对存储路径，例如 "assets/fid_123.glb" 或 "exports/cut_abc.mp4"
 * @param {Object} [options={}]
 * @param {number} [options.expiresIn=900] - 有效期秒数，默认 15 分钟 (900s)
 * @returns {string} 完整的 /media-store/* URL
 */
function generateSignedMediaUrl(relPath, options = {}) {
  const expiresIn = Number(options.expiresIn) || 900;
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const normalizedPath = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const message = `${normalizedPath}:${exp}`;
  const sig = crypto.createHmac('sha256', MEDIA_SECRET).update(message).digest('hex');

  return `/media-store/${encodeURIComponent(normalizedPath)}?exp=${exp}&sig=${sig}`;
}

/**
 * 校验 /media-store/* 请求的 HMAC 签名与过期时间
 * @param {string} relPath - 请求的媒体相对路径
 * @param {string|number} exp - 过期时间戳（秒）
 * @param {string} sig - 请求携带的十六进制签名
 * @returns {{ valid: boolean, code?: string, error?: string }}
 */
function verifyMediaHmac(relPath, exp, sig) {
  if (!relPath || !exp || !sig) {
    return { valid: false, code: 'FORBIDDEN', error: '缺少 HMAC 签名或过期时间' };
  }

  const expSec = Number(exp);
  if (!Number.isFinite(expSec)) {
    return { valid: false, code: 'FORBIDDEN', error: '非法过期时间戳' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > expSec) {
    return { valid: false, code: 'EXPIRED', error: 'HMAC 签名已过期（超过15分钟有效窗口）' };
  }

  const normalizedPath = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const message = `${normalizedPath}:${expSec}`;
  const expectedSig = crypto.createHmac('sha256', MEDIA_SECRET).update(message).digest('hex');

  // 防时序攻击恒定时间比对
  const sigBuf = Buffer.from(String(sig), 'hex');
  const expBuf = Buffer.from(expectedSig, 'hex');

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, code: 'FORBIDDEN', error: 'HMAC 签名校验失败' };
  }

  return { valid: true };
}

module.exports = {
  MEDIA_SECRET,
  generateSignedMediaUrl,
  verifyMediaHmac,
};
