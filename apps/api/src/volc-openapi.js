/**
 * 火山 OpenAPI V4 签名。AK/SK 只留在服务端。
 * host / service / region 由调用方传入（方舟 ark、豆包音乐 imagination）。
 */
const crypto = require('crypto');

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

function parseSecrets(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function resolveVolcCredentials(services, endpointId = null) {
  const env = process.env || {};
  const region = env.VOLC_REGION || 'cn-beijing';
  const db = services && services.db;

  if (endpointId && db) {
    try {
      const { resolveEndpointAuth } = require('./models-contract');
      const ep = db.prepare('SELECT * FROM llm_endpoints WHERE id=?').get(endpointId);
      if (ep) {
        const auth = resolveEndpointAuth(db, ep);
        if (auth && auth.ak && auth.sk) {
          return { ak: auth.ak, sk: auth.sk, region };
        }
      }
    } catch (_) {}
  }

  // 专属环境变量优先（音乐与人像严禁混用密钥）
  if (endpointId === 'volc_portrait') {
    const ak = env.PORTRAIT_AK || env.ARK_PORTRAIT_AK || env.PORTRAIT_VOLC_AK || '';
    const sk = env.PORTRAIT_SK || env.ARK_PORTRAIT_SK || env.PORTRAIT_VOLC_SK || '';
    return { ak, sk, region };
  }

  if (endpointId === 'doubao_music') {
    const ak = env.VOLC_MUSIC_AK || env.VOLC_AK || env.VOLC_ACCESSKEY || '';
    const sk = env.VOLC_MUSIC_SK || env.VOLC_SK || env.VOLC_SECRETKEY || '';
    return { ak, sk, region };
  }

  const ak = env.VOLC_AK || env.VOLC_ACCESSKEY || '';
  const sk = env.VOLC_SK || env.VOLC_SECRETKEY || '';
  return { ak, sk, region };
}

function credentialsReady(cfg) {
  return !!(cfg && cfg.ak && cfg.sk);
}

function unwrapVolc(json, action) {
  const err = json && json.ResponseMetadata && json.ResponseMetadata.Error;
  if (err && (err.Code || err.Message)) {
    const e = new Error(`${action} 失败: ${`${err.Code || ''} ${err.Message || ''}`.trim()}`);
    e.code = 'volc_error';
    e.volcCode = err.Code || '';
    throw e;
  }
  if (json && json.Code != null && json.Code !== '' && Number(json.Code) !== 0) {
    const e = new Error(`${action} 失败: ${json.Message || json.Code}`);
    e.code = 'volc_error';
    e.volcCode = json.Code;
    throw e;
  }
  if (json && Object.prototype.hasOwnProperty.call(json, 'Result') && json.Result != null) {
    return json.Result;
  }
  return json || {};
}

/**
 * @param {object} cfg { ak, sk, region }
 * @param {object} spec host, service, action, version, method, query, body, fetchImpl, timeoutMs
 */
async function volcOpenApi(cfg, spec) {
  if (!credentialsReady(cfg)) {
    const e = new Error('未配置火山 AK/SK');
    e.code = 'volc_unconfigured';
    throw e;
  }
  const method = (spec.method || 'POST').toUpperCase();
  const host = spec.host;
  const service = spec.service;
  const region = spec.region || cfg.region || 'cn-beijing';
  const xDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const shortDate = xDate.slice(0, 8);
  const payload = spec.body == null ? '' : JSON.stringify(spec.body);
  const payloadHash = hashHex(payload);
  const q = { Action: spec.action, Version: spec.version, ...(spec.query || {}) };
  const canonicalQuery = Object.keys(q).sort()
    .map((k) => `${uriEscape(k)}=${uriEscape(q[k])}`)
    .join('&');
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    host,
    'x-content-sha256': payloadHash,
    'x-date': xDate,
  };
  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalRequest = [
    method,
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, scope, hashHex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(cfg.sk, shortDate), region), service), 'request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  const fetchImpl = spec.fetchImpl || fetch;
  const res = await fetchImpl(`https://${host}/?${canonicalQuery}`, {
    method,
    headers: {
      'Content-Type': headers['content-type'],
      Host: host,
      'X-Content-Sha256': payloadHash,
      'X-Date': xDate,
      Authorization: `HMAC-SHA256 Credential=${cfg.ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: method === 'GET' ? undefined : payload,
    signal: AbortSignal.timeout(spec.timeoutMs || 120000),
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok && !(json && json.ResponseMetadata)) {
    const e = new Error(`${spec.action} 失败: HTTP ${res.status} ${text.slice(0, 180)}`);
    e.code = 'volc_http';
    throw e;
  }
  return unwrapVolc(json, spec.action);
}

module.exports = {
  uriEscape,
  hashHex,
  resolveVolcCredentials,
  credentialsReady,
  unwrapVolc,
  volcOpenApi,
};
