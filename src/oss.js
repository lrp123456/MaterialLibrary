/**
 * 阿里云 OSS 集成（REST API V1 签名）。
 * 走 https.request（会复用 proxy-setup 设置的 https.globalAgent），
 * 不再用 Node 全局 fetch —— 后者不读代理配置，在 WSL 里会 ECONNRESET。
 * 配置优先级：环境变量 < kv.oss_config。仓库里不再保存 AK/SK。
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const DEFAULT_OSS_CONFIG = {
  region: process.env.OSS_REGION || 'cn-beijing',
  bucket: process.env.OSS_BUCKET || 'naite-mes',
  endpoint: process.env.OSS_ENDPOINT || 'img.naite.cc',
  accessKeyId: process.env.OSS_AK || '',
  accessKeySecret: process.env.OSS_SK || '',
};

function getOssConfig(services) {
  const db = services?.db;
  let custom = null;
  if (db) {
    try {
      const row = db.prepare("SELECT value FROM kv WHERE key='oss_config'").get();
      if (row?.value) custom = JSON.parse(row.value);
    } catch (_) {}
  }
  return { ...DEFAULT_OSS_CONFIG, ...(custom || {}) };
}

function isOssEnabled(services) {
  const cfg = getOssConfig(services);
  return Boolean(cfg.accessKeyId && cfg.accessKeySecret && cfg.bucket);
}

function publicUrlFor(cfg, objectKey) {
  const host = cfg.endpoint
    ? String(cfg.endpoint).replace(/^https?:\/\//, '').replace(/\/+$/, '')
    : `${cfg.bucket}.oss-${cfg.region}.aliyuncs.com`;
  const encoded = String(objectKey).split('/').map(encodeURIComponent).join('/');
  return `https://${host}/${encoded}`;
}

function signV1({ method, contentType = '', date, bucket, objectKey, accessKeySecret }) {
  const resource = `/${bucket}/${objectKey || ''}`;
  const stringToSign = `${method}\n\n${contentType}\n${date}\n${resource}`;
  return crypto.createHmac('sha1', accessKeySecret).update(stringToSign).digest('base64');
}

function requestOnce({ method, objectKey = '', query = '', headers = {}, body = null, services, timeoutMs = 20000 }) {
  const cfg = getOssConfig(services);
  if (!cfg.accessKeyId || !cfg.accessKeySecret || !cfg.bucket) {
    return Promise.reject(new Error('阿里云 OSS 未配置有效的 AccessKey'));
  }
  const host = `${cfg.bucket}.oss-${cfg.region}.aliyuncs.com`;
  const date = new Date().toUTCString();
  const contentType = headers['Content-Type'] || '';
  const signature = signV1({
    method,
    contentType,
    date,
    bucket: cfg.bucket,
    objectKey,
    accessKeySecret: cfg.accessKeySecret,
  });
  const encodedKey = String(objectKey).split('/').map(encodeURIComponent).join('/');
  const reqPath = `/${encodedKey}${query ? `?${query}` : ''}`;
  const finalHeaders = {
    Date: date,
    Authorization: `OSS ${cfg.accessKeyId}:${signature}`,
    ...headers,
  };
  if (body) finalHeaders['Content-Length'] = Buffer.byteLength(body);

  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: host,
      path: reqPath,
      headers: finalHeaders,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('timeout', () => req.destroy(new Error('OSS 请求超时')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestWithRetry(opts) {
  try {
    return await requestOnce(opts);
  } catch (e) {
    if (!/ECONNRESET|EPIPE|socket hang up|ECONNREFUSED/i.test(String(e.message || e))) throw e;
    await new Promise((r) => setTimeout(r, 300));
    return requestOnce(opts);
  }
}

/**
 * 将 Buffer 上传到 OSS。
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
  const res = await requestWithRetry({
    method: 'PUT',
    objectKey,
    headers: { 'Content-Type': contentType },
    body: buffer,
    services,
  });
  if (res.status < 200 || res.status >= 300) {
    const text = res.body.toString('utf8').slice(0, 300);
    throw new Error(`OSS 上传失败 (HTTP ${res.status}): ${text || '未知错误'}`);
  }
  return { url: publicUrlFor(cfg, objectKey), objectKey, size: buffer.length };
}

async function uploadFile(filePath, options = {}) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
  };
  const contentType = options.contentType || mimeMap[ext] || 'application/octet-stream';
  return uploadBuffer(buf, { ...options, contentType });
}

async function deleteObject(objectKey, services) {
  const key = String(objectKey || '').replace(/^\/+/, '');
  if (!key) return false;
  const res = await requestWithRetry({ method: 'DELETE', objectKey: key, services });
  if (res.status === 404 || (res.status >= 200 && res.status < 300)) return true;
  throw new Error(`OSS 删除失败 (HTTP ${res.status})`);
}

function xmlDecode(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function listObjects(prefix, services, maxKeys = 1000) {
  const query = `prefix=${encodeURIComponent(prefix)}&max-keys=${Math.min(1000, maxKeys)}`;
  const res = await requestWithRetry({
    method: 'GET',
    objectKey: '',
    query,
    services,
    timeoutMs: 30000,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`OSS 列举失败 (HTTP ${res.status})`);
  }
  const xml = res.body.toString('utf8');
  const objects = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1];
    const key = block.match(/<Key>([\s\S]*?)<\/Key>/);
    const modified = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/);
    if (!key) continue;
    objects.push({
      key: xmlDecode(key[1]),
      lastModified: modified ? Date.parse(modified[1]) : 0,
    });
  }
  return {
    objects,
    truncated: /<IsTruncated>true<\/IsTruncated>/i.test(xml),
  };
}

/**
 * 清理 chat-temp/ 下超时的临时图片。上传路径失败时由请求 finally 删除，
 * 这里兜底进程崩溃/删除失败留下的对象。只动 chat-temp/ 前缀。
 */
async function sweepChatTemp(services, { maxAgeMs = 30 * 24 * 60 * 60 * 1000, limit = 200 } = {}) {
  if (!isOssEnabled(services)) return { deleted: 0 };
  const listed = await listObjects('chat-temp/', services, 1000);
  const cutoff = Date.now() - maxAgeMs;
  const stale = listed.objects
    .filter((o) => o.key.startsWith('chat-temp/') && (!o.lastModified || o.lastModified < cutoff))
    .slice(0, limit);
  let deleted = 0;
  for (let i = 0; i < stale.length; i += 8) {
    const chunk = stale.slice(i, i + 8);
    const results = await Promise.allSettled(chunk.map((o) => deleteObject(o.key, services)));
    deleted += results.filter((r) => r.status === 'fulfilled' && r.value).length;
  }
  return { deleted, scanned: listed.objects.length, truncated: listed.truncated };
}

module.exports = {
  getOssConfig,
  isOssEnabled,
  uploadBuffer,
  uploadFile,
  deleteObject,
  listObjects,
  sweepChatTemp,
  publicUrlFor,
};
