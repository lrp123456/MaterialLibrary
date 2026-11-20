/**
 * 轨道 B 纹理预染色。
 * 三个通道共用一份明度残差，禁止按 RGB 通道做 pixel/mean。
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const TINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ASSET_ID_RE = /^[a-zA-Z0-9_-]+$/;

function normalizeHex6(hex) {
  if (hex == null) return null;
  let h = String(hex).trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (/^[0-9A-Fa-f]{3}$/.test(h)) h = h.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9A-Fa-f]{6}$/.test(h)) return null;
  return h.toUpperCase();
}

function assertAssetId(assetId) {
  const id = String(assetId || '');
  if (!ASSET_ID_RE.test(id)) {
    const err = new Error('invalid_asset_id');
    err.code = 'invalid_asset_id';
    throw err;
  }
  return id;
}

function hexToRgb(hex6) {
  const n = parseInt(hex6, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function residualGain(tr, tg, tb) {
  const maxC = Math.max(tr, tg, tb);
  const minC = Math.min(tr, tg, tb);
  let k = 0.85;
  if (maxC > 220 || minC < 35) {
    const brightT = maxC > 220 ? Math.min(1, (maxC - 220) / 35) : 0;
    const darkT = minC < 35 ? Math.min(1, (35 - minC) / 35) : 0;
    k = 0.85 - Math.max(brightT, darkT) * 0.5;
  }
  const headroom = Math.max(0, Math.min(255 - maxC, minC));
  const cap = headroom < 48 ? Math.max(4, headroom * 0.9) : 64;
  return { k, cap };
}

function tintRaw(pixels, width, height, hex6) {
  const target = hexToRgb(hex6);
  const { k, cap } = residualGain(target.r, target.g, target.b);
  const count = width * height;
  let sumL = 0;
  const lumas = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const L = luma(pixels[o], pixels[o + 1], pixels[o + 2]);
    lumas[i] = L;
    sumL += L;
  }
  const meanL = sumL / Math.max(1, count);
  const out = Buffer.alloc(count * 3);
  for (let i = 0; i < count; i++) {
    const shaped = 64 * Math.tanh((lumas[i] - meanL) / 64);
    let add = k * shaped;
    if (add > cap) add = cap;
    else if (add < -cap) add = -cap;
    const o = i * 3;
    out[o] = clampByte(target.r + add);
    out[o + 1] = clampByte(target.g + add);
    out[o + 2] = clampByte(target.b + add);
  }
  return out;
}

function clampByte(value) {
  const n = Math.round(value);
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}

async function preTintBasecolor(inputBuffer, hex) {
  const hex6 = normalizeHex6(hex);
  if (!hex6) {
    const err = new Error('invalid_hex');
    err.code = 'invalid_hex';
    throw err;
  }
  const { data, info } = await sharp(inputBuffer)
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const tinted = tintRaw(data, info.width, info.height, hex6);
  return sharp(tinted, { raw: { width: info.width, height: info.height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function tintRel(assetId, hex) {
  const id = assertAssetId(assetId);
  const hex6 = normalizeHex6(hex);
  if (!hex6) {
    const err = new Error('invalid_hex');
    err.code = 'invalid_hex';
    throw err;
  }
  return {
    hex6,
    rel: path.posix.join('cache', 'base-library', 'tint', `${id}_${hex6}.jpg`)
  };
}

async function ensureTintedFile(dataDir, assetId, hex, sourceBuffer) {
  const { rel } = tintRel(assetId, hex);
  const fullPath = path.resolve(dataDir, rel);
  if (fs.existsSync(fullPath)) return { rel, fullPath, buffer: fs.readFileSync(fullPath) };
  const buffer = await preTintBasecolor(sourceBuffer, hex);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return { rel, fullPath, buffer };
}

function cleanupExpiredTintFiles(dataDir, now = Date.now(), fsModule = fs) {
  if (!dataDir) return 0;
  const dir = path.resolve(dataDir, 'cache', 'base-library', 'tint');
  if (!fsModule.existsSync(dir)) return 0;
  const cutoff = now - TINT_TTL_MS;
  let removed = 0;
  for (const name of fsModule.readdirSync(dir)) {
    if (!/^[a-zA-Z0-9_-]+_[0-9A-F]{6}\.jpg$/i.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const stat = fsModule.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fsModule.unlinkSync(full);
        removed += 1;
      }
    } catch (_) {}
  }
  return removed;
}

module.exports = {
  TINT_TTL_MS,
  normalizeHex6,
  assertAssetId,
  residualGain,
  preTintBasecolor,
  tintRel,
  ensureTintedFile,
  cleanupExpiredTintFiles
};
