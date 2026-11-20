/**
 * 本地质检（sharp，毫秒级零 API 成本）：
 *  - 尺寸/画幅/EXIF 方向
 *  - 模糊度（Laplacian 方差，越小越糊）
 *  - pHash 感知哈希（32x32 灰度 → DCT-II → 8x8 中位数二值），汉明距离 ≤8 视为同图
 */
const sharp = require('sharp');

async function inspect(buffer) {
  const img = sharp(buffer, { failOn: 'none' }).rotate(); // rotate() 应用 EXIF 方向
  const meta = await img.metadata();
  const { width = 0, height = 0 } = meta;
  const orientation = width > height * 1.05 ? 'landscape' : height > width * 1.05 ? 'portrait' : 'square';

  // 32x32 灰度用于 pHash；256 灰度用于模糊度
  const small = await sharp(buffer).rotate().greyscale().resize(32, 32, { fit: 'fill' })
    .raw().toBuffer();
  const gray = [...small].map(v => v / 255);

  const phash = computePHash(gray, 32);
  const blur = await laplacianVariance(buffer);

  return { width, height, orientation, format: meta.format, phash, blur };
}

// ---- DCT-II（朴素实现，32x32 足够，单次 <5ms）----
function dct1d(N) {
  const M = [];
  for (let k = 0; k < N; k++) {
    M[k] = [];
    for (let n = 0; n < N; n++) {
      M[k][n] = Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N)) * (k === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return M;
}
const DCT32 = dct1d(32);

function dct2(mat, N) {
  const tmp = Array.from({ length: N }, () => new Array(N).fill(0));
  const out = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++)
    for (let k = 0; k < N; k++) {
      let s = 0;
      for (let n = 0; n < N; n++) s += DCT32[k][n] * mat[i][n];
      tmp[i][k] = s;
    }
  for (let j = 0; j < N; j++)
    for (let k = 0; k < N; k++) {
      let s = 0;
      for (let n = 0; n < N; n++) s += DCT32[k][n] * tmp[n][j];
      out[k][j] = s;
    }
  return out;
}

function computePHash(gray, N) {
  const mat = [];
  for (let i = 0; i < N; i++) mat.push(gray.slice(i * N, (i + 1) * N));
  const d = dct2(mat, N);
  const vals = [];
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 8; y++)
      if (!(x === 0 && y === 0)) vals.push(d[x][y]); // 排除 DC 分量
  const sorted = [...vals].sort((a, b) => a - b);
  const median = (sorted[30] + sorted[31]) / 2;
  let bits = '';
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 8; y++) {
      if (x === 0 && y === 0) { bits += '1'; continue; }
      bits += d[x][y] > median ? '1' : '0';
    }
  // 64bit → 16 位 hex
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d += (parseInt(a[i], 16) ^ parseInt(b[i], 16)).toString(2).replace(/0/g, '').length;
  }
  return d;
}

/**
 * 64-bit pHash 的 4 段 16-bit 子段抽屉变体。
 * 鸽巢原理：总距离 <= K 时，4 段中必有一段距离 <= floor(K/4)。
 * maxFlips=1 覆盖 K<=7，maxFlips=2 覆盖 K<=8...11。
 */
function hex16Variants(seg, maxFlips = 1) {
  const s = String(seg || '');
  if (s.length !== 4) return [s];
  const base = parseInt(s, 16);
  const toHex = (v) => (v & 0xffff).toString(16).padStart(4, '0');
  const out = [s];
  for (let b1 = 0; b1 < 16; b1++) {
    out.push(toHex(base ^ (1 << b1)));
    if (maxFlips >= 2) {
      for (let b2 = b1 + 1; b2 < 16; b2++) {
        out.push(toHex(base ^ (1 << b1) ^ (1 << b2)));
      }
    }
  }
  return out;
}

async function laplacianVariance(buffer) {
  const { data, info } = await sharp(buffer).rotate().greyscale()
    .resize(256, 256, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const at = (x, y) => data[y * w + x];
  const vals = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const v = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * at(x, y);
      vals.push(v);
    }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
}

module.exports = { inspect, hamming, hammingDistanceHex: hamming, computePHash, hex16Variants };
