/**
 * 阿里云 OSS 统一集成模块 (Aliyun OSS Client)
 * 采用原生 Node.js 全局 fetch + crypto 实现标准 REST API V1 签名上传，
 * 彻底避免底层代理拦截干扰，直连阿里云北京节点，返回 443 标准 HTTPS 域名 URL。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_OSS_CONFIG = {
  region: process.env.OSS_REGION || 'cn-beijing',
  bucket: process.env.OSS_BUCKET || 'naite-mes',
  endpoint: process.env.OSS_ENDPOINT || 'img.naite.cc',
  accessKeyId: process.env.OSS_AK || 'REDACTED',
  accessKeySecret: process.env.OSS_SK || 'REDACTED',
};

function getOssConfig(services) {
  const db = services?.db;
  let custom = null;
  if (db) {
    try {
      const row = db.prepare("SELECT value FROM kv WHERE key='oss_config'").get();
      if (row?.value) {
        custom = JSON.parse(row.value);
      }
    } catch (_) {}
  }
  return {
    ...DEFAULT_OSS_CONFIG,
    ...(custom || {})
  };
}

function isOssEnabled(services) {
  const cfg = getOssConfig(services);
  return Boolean(cfg.accessKeyId && cfg.accessKeySecret && cfg.bucket);
}

/**
 * 将 Buffer 上传到阿里云 OSS
 * @param {Buffer} buffer 二进制数据
 * @param {Object} options { key, contentType, services }
 * @returns {Promise<{ url: string, objectKey: string, size: number }>}
 */
async function uploadBuffer(buffer, options = {}) {
  const {
    key,
    contentType = 'image/jpeg',
    services = null,
  } = options;

  const cfg = getOssConfig(services);
  if (!cfg.accessKeyId || !cfg.accessKeySecret || !cfg.bucket) {
    throw new Error('阿里云 OSS 未配置有效的 AccessKey');
  }

  const objectKey = String(key || `ai-frames/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.jpg`).replace(/^\/+/, '');
  const dateStr = new Date().toUTCString();
  const ossHost = `${cfg.bucket}.oss-${cfg.region}.aliyuncs.com`;
  const canonicalResource = `/${cfg.bucket}/${objectKey}`;
  const stringToSign = `PUT\n\n${contentType}\n${dateStr}\n${canonicalResource}`;
  const signature = crypto.createHmac('sha1', cfg.accessKeySecret).update(stringToSign).digest('base64');
  const authHeader = `OSS ${cfg.accessKeyId}:${signature}`;

  const uploadUrl = `https://${ossHost}/${encodeURI(objectKey)}`;

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Date': dateStr,
      'Authorization': authHeader
    },
    body: buffer
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OSS 上传失败 (HTTP ${res.status}): ${text || '未知错误'}`);
  }

  // 优先使用自定义 HTTPS 域名
  const publicUrl = cfg.endpoint
    ? `https://${cfg.endpoint.replace(/^https?:\/\//, '')}/${objectKey}`
    : `https://${ossHost}/${objectKey}`;

  return {
    url: publicUrl,
    objectKey,
    size: buffer.length
  };
}

/**
 * 将本地文件上传到阿里云 OSS
 */
async function uploadFile(filePath, options = {}) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg'
  };
  const contentType = options.contentType || mimeMap[ext] || 'application/octet-stream';
  return uploadBuffer(buf, { ...options, contentType });
}

module.exports = {
  getOssConfig,
  isOssEnabled,
  uploadBuffer,
  uploadFile,
};
