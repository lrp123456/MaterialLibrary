/**
 * veImageX GetImageBgFillResult。
 * 凭证来自环境变量或扩图适配器 secrets，与方舟 Ark Key 不是同一套。
 * 缺任一项就视为未配置，不回落到灰边。
 */
const crypto = require('crypto');

const HOST = 'imagex.volcengineapi.com';
const SERVICE = 'imagex';

function imagexReady(cfg) {
  return !!(cfg && cfg.ak && cfg.sk && cfg.serviceId);
}

function parseJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function resolveImagexConfig(services) {
  const env = process.env || {};
  const cfg = {
    ak: env.VOLC_ACCESSKEY || '',
    sk: env.VOLC_SECRETKEY || '',
    serviceId: env.IMAGEX_SERVICE_ID || '',
    region: env.IMAGEX_REGION || 'cn-north-1',
    domain: env.IMAGEX_DOMAIN || '',
  };
  let row = null;
  try {
    const db = services && services.db;
    if (db && typeof db.prepare === 'function') {
      row = db.prepare(`
        SELECT * FROM gen_adapters
        WHERE enabled=1
          AND (id LIKE '%veimagex%' OR id LIKE '%imagex%' OR id LIKE '%expand%' OR id LIKE '%outpaint%')
        ORDER BY id ASC LIMIT 1
      `).get();
    }
  } catch { row = null; }
  if (row) {
    const secrets = parseJson(row.secrets_json);
    const extra = parseJson(row.config_json);
    cfg.ak = cfg.ak || secrets.VOLC_ACCESSKEY || secrets.accessKey || secrets.access_key || secrets.ak || '';
    cfg.sk = cfg.sk || secrets.VOLC_SECRETKEY || secrets.secretKey || secrets.secret_key || secrets.sk || '';
    cfg.serviceId = cfg.serviceId || extra.serviceId || extra.IMAGEX_SERVICE_ID || secrets.serviceId || secrets.IMAGEX_SERVICE_ID || '';
    cfg.region = extra.region || secrets.region || cfg.region || 'cn-north-1';
    cfg.domain = extra.domain || extra.IMAGEX_DOMAIN || secrets.domain || cfg.domain || '';
  }
  return cfg;
}

function uriEscape(str) {
  return encodeURIComponent(String(str)).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function hashHex(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hmac(key, content) {
  return crypto.createHmac('sha256', key).update(content, 'utf8').digest();
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

async function volcCall(cfg, { method, action, version, query = {}, body = null }) {
  const xDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const shortDate = xDate.slice(0, 8);
  const payload = body == null ? '' : JSON.stringify(body);
  const payloadHash = hashHex(payload);
  const q = { Action: action, Version: version, ...query };
  const canonicalQuery = Object.keys(q).sort()
    .map((k) => `${uriEscape(k)}=${uriEscape(q[k])}`)
    .join('&');
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    host: HOST,
    'x-content-sha256': payloadHash,
    'x-date': xDate,
  };
  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${shortDate}/${cfg.region}/${SERVICE}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, scope, hashHex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(cfg.sk, shortDate), cfg.region), SERVICE), 'request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  const res = await fetch(`https://${HOST}/?${canonicalQuery}`, {
    method,
    headers: {
      'Content-Type': headers['content-type'],
      Host: HOST,
      'X-Content-Sha256': payloadHash,
      'X-Date': xDate,
      Authorization: `HMAC-SHA256 Credential=${cfg.ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: method === 'GET' ? undefined : payload,
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
  const err = json && json.ResponseMetadata && json.ResponseMetadata.Error;
  if (!res.ok || err) {
    const msg = err ? `${err.Code || ''} ${err.Message || ''}`.trim() : `HTTP ${res.status} ${text.slice(0, 180)}`;
    throw new Error(`veImageX ${action} 失败: ${msg}`);
  }
  return json;
}

function findString(obj, pred, depth = 0) {
  if (obj == null || depth > 8) return null;
  if (typeof obj === 'string' && pred(obj)) return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const hit = findString(item, pred, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const hit = findString(obj[key], pred, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

async function uploadOriginal(cfg, imageBuffer) {
  const applied = await volcCall(cfg, {
    method: 'GET',
    action: 'ApplyImageUpload',
    version: '2018-08-01',
    query: {
      ServiceId: cfg.serviceId,
      UploadNum: 1,
      FileExtension: '.jpg',
    },
  });
  const address = applied && applied.Result && applied.Result.UploadAddress;
  const store = address && address.StoreInfos && address.StoreInfos[0];
  const host = address && address.UploadHosts && address.UploadHosts[0];
  if (!store || !store.StoreUri || !store.Auth || !host || !address.SessionKey) {
    throw new Error('veImageX 上传凭证缺少 StoreUri');
  }
  const crc = crc32(imageBuffer).toString(16).padStart(8, '0');
  const pathName = String(store.StoreUri).split('/').map(encodeURIComponent).join('/');
  const put = await fetch(`https://${host}/${pathName}`, {
    method: 'PUT',
    headers: {
      Authorization: store.Auth,
      'Content-Type': 'application/octet-stream',
      'Content-CRC32': crc,
    },
    body: imageBuffer,
    signal: AbortSignal.timeout(120000),
  });
  if (!put.ok) {
    const t = await put.text().catch(() => '');
    throw new Error(`veImageX 上传原图失败 HTTP ${put.status}: ${t.slice(0, 180)}`);
  }
  await volcCall(cfg, {
    method: 'POST',
    action: 'CommitImageUpload',
    version: '2018-08-01',
    query: { ServiceId: cfg.serviceId },
    body: { SessionKey: address.SessionKey },
  });
  return store.StoreUri;
}

async function downloadResult(cfg, resUri) {
  let url = '';
  try {
    const meta = await volcCall(cfg, {
      method: 'POST',
      action: 'GetResourceURL',
      version: '2018-08-01',
      query: { ServiceId: cfg.serviceId },
      body: { ServiceId: cfg.serviceId, Uri: resUri },
    });
    url = findString(meta, (s) => /^https?:\/\//i.test(s)) || '';
  } catch { url = ''; }
  if (!url && cfg.domain) {
    const domain = String(cfg.domain).replace(/^https?:\/\//, '').replace(/\/$/, '');
    url = `https://${domain}/${resUri}`;
  }
  if (!url) throw new Error('veImageX 未返回可下载的结果地址');
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`veImageX 结果下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('veImageX 结果图为空');
  return buf;
}

/**
 * Top/Bottom/Left/Right 是相对原图高、宽的扩展比例。
 * Model 1 = 通用场景。
 */
async function expandWithImagex(services, imageBuffer, padInfo) {
  const cfg = resolveImagexConfig(services);
  if (!imagexReady(cfg)) {
    throw new Error('未配置 veImageX：需要 VOLC_ACCESSKEY、VOLC_SECRETKEY、IMAGEX_SERVICE_ID');
  }
  const ratio = (pad, src) => (src > 0 ? Math.max(0, pad / src) : 0);
  const storeUri = await uploadOriginal(cfg, imageBuffer);
  const resp = await volcCall(cfg, {
    method: 'POST',
    action: 'GetImageBgFillResult',
    version: '2023-05-01',
    body: {
      ServiceId: cfg.serviceId,
      StoreUri: storeUri,
      Model: 1,
      Top: Number(ratio(padInfo.padTop, padInfo.srcH).toFixed(4)),
      Bottom: Number(ratio(padInfo.padBottom, padInfo.srcH).toFixed(4)),
      Left: Number(ratio(padInfo.padLeft, padInfo.srcW).toFixed(4)),
      Right: Number(ratio(padInfo.padRight, padInfo.srcW).toFixed(4)),
    },
  });
  const resUri = (resp.Result && resp.Result.ResUri) || findString(resp, (s) => s.includes('/') && !/^https?:/i.test(s));
  if (!resUri) throw new Error('veImageX 未返回结果图 URI');
  return downloadResult(cfg, resUri);
}

module.exports = {
  imagexReady,
  resolveImagexConfig,
  expandWithImagex,
  crc32,
};
