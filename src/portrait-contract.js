/**
 * 私域虚拟人像与 Seedance 引用的纯规则。
 * 不访问网络、不读数据库。
 */
const crypto = require('crypto');

const CAPTION_MARK = '【图片说明】';
const FETCH_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif', 'heic', 'heif']);

function publicError(message) {
  const e = new Error(message);
  e.code = 'public_base';
  return e;
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0' || host === '::1') {
    return true;
  }
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function assertPublicHttpsBase(base) {
  const raw = String(base || '').trim().replace(/\/+$/, '');
  if (!raw) {
    throw publicError('未配置公网 HTTPS 地址，火山无法从本机素材库拉取图片');
  }
  let url;
  try { url = new URL(raw); } catch {
    throw publicError('公网地址无效，火山无法拉取图片');
  }
  if (url.protocol !== 'https:') {
    throw publicError('素材地址必须是公网 HTTPS。火山无法拉取本地或非加密地址');
  }
  if (isPrivateHost(url.hostname)) {
    throw publicError('素材地址指向本机或内网，火山无法拉取。请配置可公网访问的 HTTPS 地址（ASSET_PUBLIC_BASE）');
  }
  return `${url.protocol}//${url.host}`;
}

function extOf(name, mime) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (ext && IMAGE_EXTS.has(ext)) return ext === 'jpg' ? 'jpeg' : ext === 'tif' ? 'tiff' : ext;
  const m = String(mime || '').toLowerCase();
  if (m.includes('jpeg')) return 'jpeg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('bmp')) return 'bmp';
  if (m.includes('tiff')) return 'tiff';
  if (m.includes('gif')) return 'gif';
  if (m.includes('heic')) return 'heic';
  if (m.includes('heif')) return 'heif';
  return ext || '';
}

function validateImageMeta({ width, height, bytes, ext, mime, fileName }) {
  const kind = extOf(fileName || ext, mime);
  if (!IMAGE_EXTS.has(kind) && kind !== 'jpeg' && kind !== 'tiff') {
    const e = new Error(`不支持的图片格式: ${kind || 'unknown'}`);
    e.code = 'image_invalid';
    throw e;
  }
  const size = Number(bytes);
  if (!(size > 0) || size >= MAX_IMAGE_BYTES) {
    const e = new Error('单张图片须小于 30 MB');
    e.code = 'image_invalid';
    throw e;
  }
  const w = Number(width);
  const h = Number(height);
  if (!(w > 300 && w < 6000 && h > 300 && h < 6000)) {
    const e = new Error(`宽高须在 (300, 6000) px 内，当前 ${w || 0}×${h || 0}`);
    e.code = 'image_invalid';
    throw e;
  }
  const ratio = w / h;
  if (!(ratio > 0.4 && ratio < 2.5)) {
    const e = new Error(`宽高比须在 (0.4, 2.5) 内，当前 ${ratio.toFixed(3)}`);
    e.code = 'image_invalid';
    throw e;
  }
  return { width: w, height: h, bytes: size, ext: kind };
}

function signFetchToken({ id, exp, nonce, secret }) {
  const payload = Buffer.from(JSON.stringify({
    id: Number(id),
    exp: Number(exp),
    nonce: String(nonce),
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', String(secret)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyFetchToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expect = crypto.createHmac('sha256', String(secret)).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!data || data.id == null || !data.nonce || !data.exp) return null;
    return { id: Number(data.id), exp: Number(data.exp), nonce: String(data.nonce) };
  } catch {
    return null;
  }
}

function newNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function isSeedanceModel(model) {
  return /seedance/i.test(String(model || ''));
}

function assertSeedanceOrEmpty(model, portraits) {
  const list = Array.isArray(portraits) ? portraits.filter(Boolean) : [];
  if (!list.length) return;
  if (!isSeedanceModel(model)) {
    const e = new Error('已选择虚拟人像时只能使用 Seedance 2.0 / 2.5');
    e.code = 'seedance_required';
    throw e;
  }
}

function mergePrompt(userPrompt, caption) {
  const raw = String(userPrompt || '');
  const stripped = raw
    .replace(new RegExp(`${CAPTION_MARK}[^\\n]*`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const line = caption ? `${CAPTION_MARK}${caption}` : '';
  if (!line) return stripped;
  if (!stripped) return line;
  return `${line}\n${stripped}`;
}

function buildImageOrder({ hasFirstFrame, portraits, refCount }) {
  const items = [];
  let n = 1;
  if (hasFirstFrame) {
    items.push({ kind: 'first', index: n, label: `图片${n}是首帧` });
    n += 1;
  }
  for (const p of portraits || []) {
    const name = (p && (p.groupName || p.name)) || '角色';
    items.push({
      kind: 'portrait',
      index: n,
      label: `图片${n}是${name}的形象`,
      portrait: p,
    });
    n += 1;
  }
  const refs = Number(refCount) || 0;
  for (let i = 0; i < refs; i += 1) {
    items.push({ kind: 'ref', index: n, label: `图片${n}` });
    n += 1;
  }
  return items;
}

function buildCaption(order) {
  const bits = (order || [])
    .filter((it) => it.kind === 'first' || it.kind === 'portrait')
    .map((it) => it.label);
  if (!bits.length) return '';
  return `${bits.join('。')}。`;
}

function collectRefUrls(images) {
  const out = [];
  for (const u of images || []) {
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * 有虚拟人像时组装 Seedance content。
 * 没有人像返回 null，调用方保持原有 Seedance 行为。
 * 非 Seedance 且带了人像时直接拒绝（即使当前适配器不是火山）。
 */
function shapeVolcVideo({
  isVolc,
  model,
  prompt,
  images,
  firstFrameUrl,
  genMode,
  ratio,
  duration,
  portraits,
}) {
  const list = Array.isArray(portraits) ? portraits.filter(Boolean) : [];
  if (list.length) assertSeedanceOrEmpty(model, list);
  if (!list.length || !isVolc) return null;

  let refs = collectRefUrls(images);
  let first = '';
  const explicit = String(firstFrameUrl || '');
  const mode = String(genMode || '');
  if (explicit) {
    first = explicit;
    if (refs[0] === first) refs = refs.slice(1);
    refs = refs.filter((u) => u !== first);
  } else if (mode === 'image_to_video' || mode === 'first_last_frame') {
    if (refs.length) {
      first = refs[0];
      refs = refs.slice(1);
    }
  }

  const order = buildImageOrder({
    hasFirstFrame: !!first,
    portraits: list,
    refCount: refs.length,
  });
  const caption = buildCaption(order);
  const content = [{ type: 'text', text: mergePrompt(prompt, caption) }];
  if (first) {
    content.push({ type: 'image_url', image_url: { url: first }, role: 'first_frame' });
  }
  for (const p of list) {
    const assetId = p.volc_asset_id || p.volcAssetId || p.assetId;
    content.push({
      type: 'image_url',
      image_url: { url: `asset://${assetId}` },
      role: 'reference_image',
    });
  }
  for (const url of refs) {
    content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
  }

  const out = { model: model || 'doubao-seedance-2-0-260128', content };
  if (ratio) out.ratio = ratio;
  const durationNum = Number(duration);
  if (Number.isFinite(durationNum) && durationNum > 0) {
    out.duration = Math.max(4, Math.min(12, Math.round(durationNum)));
  }
  out.caption = caption;
  return out;
}

module.exports = {
  CAPTION_MARK,
  FETCH_TTL_MS,
  MAX_IMAGE_BYTES,
  assertPublicHttpsBase,
  validateImageMeta,
  signFetchToken,
  verifyFetchToken,
  newNonce,
  isSeedanceModel,
  assertSeedanceOrEmpty,
  mergePrompt,
  buildImageOrder,
  buildCaption,
  shapeVolcVideo,
};
