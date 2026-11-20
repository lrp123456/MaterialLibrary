/**
 * 本地 256x256 色块生成与缓存
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

function normalizeHex(hex) {
  if (!hex || typeof hex !== 'string') return '#CCCCCC';
  let clean = hex.trim();
  if (!clean.startsWith('#')) clean = `#${clean}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(clean)) return clean.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(clean)) {
    const r = clean[1];
    const g = clean[2];
    const b = clean[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return '#CCCCCC';
}

async function generateSwatchBuffer(hex) {
  const safeHex = normalizeHex(hex);
  return await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: safeHex
    }
  }).png().toBuffer();
}

async function ensurePaintSwatchFile(dataDir, paintId, hex) {
  const rel = path.posix.join('cache', 'base-library', 'paints', paintId, 'swatch.png');
  const fullPath = path.resolve(dataDir, rel);
  if (fs.existsSync(fullPath)) {
    return { rel, fullPath, buffer: fs.readFileSync(fullPath) };
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const buffer = await generateSwatchBuffer(hex);
  fs.writeFileSync(fullPath, buffer);
  return { rel, fullPath, buffer };
}

module.exports = {
  normalizeHex,
  generateSwatchBuffer,
  ensurePaintSwatchFile
};
