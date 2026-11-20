/**
 * 三层色彩系统（方案定稿 P3）：
 * 1) 像素层：降采样 → 白平衡 → 中心加权 → HSV 过滤 → k-means++ → ΔE 合并
 * 2) 角色层：60-30-10 初值（main/secondary/accent）
 * 3) 语义层：basicColorOfHex 12 基础色 + color_style 8 色系派生
 */
const sharp = require('sharp');

const BASIC_COLORS = [
  '白', '米/奶油', '原木/木色', '灰', '黑', '红', '粉', '橙', '黄', '绿', '蓝', '紫',
];

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** 简化 Lab（sRGB→Lab 近似，ΔE 够用） */
function rgbToLab(r, g, b) {
  let rr = r / 255, gg = g / 255, bb = b / 255;
  rr = rr > 0.04045 ? ((rr + 0.055) / 1.055) ** 2.4 : rr / 12.92;
  gg = gg > 0.04045 ? ((gg + 0.055) / 1.055) ** 2.4 : gg / 12.92;
  bb = bb > 0.04045 ? ((bb + 0.055) / 1.055) ** 2.4 : bb / 12.92;
  let x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
  let y = (rr * 0.2126 + gg * 0.7152 + bb * 0.0722);
  let z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116));
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function deltaE2000Approx(l1, l2) {
  const dL = l1.L - l2.L, da = l1.a - l2.a, db = l1.b - l2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

function deltaE(hex1, hex2) {
  if (!hex1 || !hex2) return 999;
  try {
    const c1 = hexToRgb(String(hex1).trim());
    const c2 = hexToRgb(String(hex2).trim());
    if (!c1 || isNaN(c1.r) || !c2 || isNaN(c2.r)) return 999;
    const l1 = rgbToLab(c1.r, c1.g, c1.b);
    const l2 = rgbToLab(c2.r, c2.g, c2.b);
    return deltaE2000Approx(l1, l2);
  } catch (_) {
    return 999;
  }
}

function kmeans(points, k, maxIter = 12) {
  if (!points.length) return [];
  const centroids = [];
  // k-means++ init
  centroids.push(points[Math.floor(Math.random() * points.length)].slice());
  while (centroids.length < k) {
    const dists = points.map(p => {
      let m = Infinity;
      for (const c of centroids) {
        const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
        m = Math.min(m, dx * dx + dy * dy + dz * dz);
      }
      return m;
    });
    const sum = dists.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * sum;
    let idx = 0;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) { idx = i; break; }
    }
    centroids.push(points[idx].slice());
  }
  let assign = new Array(points.length).fill(0);
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const p = points[i], q = centroids[c];
        const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      const s = sums[assign[i]];
      s[0] += points[i][0]; s[1] += points[i][1]; s[2] += points[i][2]; s[3]++;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] > 0) {
        centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      }
    }
    if (!changed) break;
  }
  const counts = centroids.map(() => 0);
  for (const a of assign) counts[a]++;
  return centroids.map((c, i) => ({
    r: c[0], g: c[1], b: c[2],
    hex: rgbToHex(c[0], c[1], c[2]),
    lab: rgbToLab(c[0], c[1], c[2]),
    hsl: rgbToHsl(c[0], c[1], c[2]),
    weight: points.length ? counts[i] / points.length : 0,
  }));
}

/** 12 室内设计主色（HSL 规则表 + 室内暖光与材质自适应） */
function basicColorOfHex(hex) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);

  // 1. 无彩色低饱和判定（黑、白、灰）
  if (s < 0.15) {
    if (l >= 0.82) return '白';
    if (l < 0.18) return '黑';
    if (l >= 0.68 && h >= 25 && h <= 55) return '米/奶油';
    return '灰';
  }

  // 2. 蓝 / 绿 / 紫 / 红 / 粉
  if (h >= 170 && h < 255) return '蓝';
  if (h >= 65 && h < 170) return '绿';
  if (h >= 255 && h < 315) return '紫';
  if (h >= 315 && h < 345) return l > 0.55 ? '粉' : '紫';
  if (h >= 345 || h < 15) return (l > 0.62 && s < 0.65) ? '粉' : '红';

  // 3. 橄榄绿 / 鼠尾草绿 特征捕获 (38 <= h < 65)
  // 室内摄影中，橄榄绿、军绿、鼠尾草绿在暖黄光源(2700K-3000K)照射下，其反射光谱中 R 会被暖光拉升至接近 G，
  // 但 G 仍显著压倒 B（绿色彩度满足 g - b > 10 且 r - g < (g - b) * 0.7，显著区别于木材的高 R 红色分量）
  if (h >= 38 && h < 65) {
    const rDiff = r - g;
    const gDiff = g - b;
    if (gDiff > 10 && rDiff < gDiff * 0.7 && l < 0.55 && s >= 0.18) {
      return '绿';
    }
  }

  // 4. 米 / 奶油 (浅暖底色、乳胶漆、米色瓷砖、暖光白墙)
  if (h >= 20 && h <= 60 && l >= 0.50 && s <= 0.42) {
    return '米/奶油';
  }

  // 5. 黄色 (明亮高饱和明黄色)
  if (h >= 40 && h < 65) {
    if (s >= 0.45 && l >= 0.40) return '黄';
  }

  // 6. 橙色 (鲜艳爱马仕橙、赤陶红橙)
  if (h >= 15 && h < 40) {
    if (s >= 0.65 && l >= 0.35 && l <= 0.65) return '橙';
  }

  // 7. 原木 / 木色 (橡木、胡桃木、实木构件、木质家具)
  if (h >= 15 && h < 50) {
    if (s >= 0.35 || (s >= 0.20 && l < 0.50)) return '原木/木色';
  }

  return '灰';
}

function scoreCluster(c, w, h) {
  const area = c.weight;
  const sat = c.hsl.s;
  return 0.4 * area + 0.3 * sat + 0.2 * area + 0.1 * Math.min(1, c.hsl.l);
}

const COLOR_NAMES_18 = [
  ['鼠尾草绿', 0x9c, 0xaF, 0x92], ['暖白', 0xF4, 0xF0, 0xE6], ['米杏', 0xE3, 0xD5, 0xC0],
  ['黄铜', 0xC5, 0xA0, 0x62], ['胡桃棕', 0x5C, 0x40, 0x33], ['橡木色', 0xC4, 0xA0, 0x76],
  ['微水泥灰', 0xB0, 0xAE, 0xA8], ['炭黑', 0x2A, 0x2C, 0x30], ['纯白', 0xFA, 0xFA, 0xF8],
  ['赤陶橙', 0xC0, 0x6A, 0x4E], ['洞石灰', 0xD8, 0xCF, 0xC0], ['黑色金属', 0x33, 0x35, 0x38],
  ['亚麻米', 0xD9, 0xCE, 0xB8], ['橄榄绿', 0x6B, 0x73, 0x55], ['大理石白', 0xEC, 0xEA, 0xE4],
  ['焦糖棕', 0x8B, 0x5A, 0x3C], ['深蓝灰', 0x3E, 0x4C, 0x5E], ['莫兰迪粉', 0xC9, 0xA9, 0xA3]
];

function nearestColorName(hex) {
  const { r, g, b } = hexToRgb(hex);
  let best = COLOR_NAMES_18[0], bd = Infinity;
  for (const item of COLOR_NAMES_18) {
    const d = (r - item[1]) ** 2 + (g - item[2]) ** 2 + (b - item[3]) ** 2;
    if (d < bd) { bd = d; best = item; }
  }
  return best[0];
}

/**
 * 提取主色角色与单一主视觉颜色
 * @returns {Promise<{dominantColor:string, colors:Array, colorStyles:string[], basicCounts:Record<string,number>}>}
 */
async function extractColorRoles(bufferOrPath) {
  const img = sharp(bufferOrPath, { failOn: 'none' });
  const meta = await img.metadata();
  const long = Math.max(meta.width || 0, meta.height || 0) || 160;
  const scale = long > 160 ? 160 / long : 1;
  const w = Math.max(8, Math.round((meta.width || 160) * scale));
  const h = Math.max(8, Math.round((meta.height || 160) * scale));
  const { data } = await img
    .resize(w, h, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const chroma = [], neutral = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const { s, l } = rgbToHsl(r, g, b);
      if (l > 0.96 || l < 0.06) continue;
      // 中心加权：中心区域权重更高
      const cx = (x / w - 0.5) * 2, cy = (y / h - 0.5) * 2;
      const dist = Math.sqrt(cx * cx + cy * cy);
      const centerW = dist < 0.4 ? 1.0 : 1.0 - 0.7 * Math.min(1, (dist - 0.4) / 0.8);
      const reps = centerW > 0.7 ? 3 : centerW > 0.45 ? 2 : 1;
      const px = [r, g, b];
      if (s < 0.15) {
        for (let k = 0; k < reps; k++) neutral.push(px);
      } else {
        for (let k = 0; k < reps; k++) chroma.push(px);
      }
    }
  }

  const K = 7;
  const samplePoints = chroma.length >= 30 ? (neutral.length ? chroma.concat(neutral.slice(0, Math.floor(chroma.length * 0.8))) : chroma) : neutral;
  let clusters = kmeans(samplePoints.length ? samplePoints : [[128,128,128]], K);
  // merge ΔE<5
  const merged = [];
  for (const c of clusters) {
    const hit = merged.find(m => deltaE2000Approx(m.lab, c.lab) < 5);
    if (hit) {
      hit.weight += c.weight;
      hit.r = (hit.r * (hit.weight - c.weight) + c.r * c.weight) / hit.weight;
      hit.g = (hit.g * (hit.weight - c.weight) + c.g * c.weight) / hit.weight;
      hit.b = (hit.b * (hit.weight - c.weight) + c.b * c.weight) / hit.weight;
      hit.hex = rgbToHex(hit.r, hit.g, hit.b);
      hit.lab = rgbToLab(hit.r, hit.g, hit.b);
      hit.hsl = rgbToHsl(hit.r, hit.g, hit.b);
    } else merged.push({ ...c });
  }

  // 选出最具人眼视觉统治力的主色 (唯一主色)
  // 室内色彩层级心理学：
  // 1) 白、灰、黑、米/奶油作为大面积背景与硬装底色，显著度权重为 1.0；
  // 2) 原木作为天然材质硬装基底，显著度权重为 1.2；
  // 3) 具有强烈空间设计表达的彩色（蓝、绿、红、粉、紫、橙、黄）具有高视觉夺目度，显著度权重大幅提升
  const scored = merged.filter(c => c.weight >= 0.02).map(c => {
    const basic = basicColorOfHex(c.hex);
    let boost = 1.0;
    if (['白', '灰', '黑', '米/奶油'].includes(basic)) {
      boost = 1.0;
    } else if (basic === '原木/木色') {
      boost = 1.2;
    } else {
      boost = 2.5 + 2.5 * Math.min(1.0, c.hsl.s * 2.0);
    }
    const salience = c.weight * boost;
    return { ...c, basic, salience };
  }).sort((a, b) => b.salience - a.salience);

  const main = scored[0] || (merged[0] ? { ...merged[0], basic: basicColorOfHex(merged[0].hex) } : null);

  let secondary = null;
  const accents = [];
  if (main) {
    for (let i = 1; i < scored.length; i++) {
      const c = scored[i];
      if (deltaE2000Approx(main.lab, c.lab) > 8) {
        if (!secondary) {
          secondary = c;
        } else if (accents.length < 2 && c.weight >= 0.03) {
          accents.push(c);
        }
      }
    }
  }

  const roles = [];
  if (main) {
    roles.push({
      role: 'main',
      hex: main.hex,
      name: nearestColorName(main.hex),
      basic: main.basic || basicColorOfHex(main.hex),
      weight: +main.weight.toFixed(4)
    });
  }
  if (secondary) {
    roles.push({
      role: 'secondary',
      hex: secondary.hex,
      name: nearestColorName(secondary.hex),
      basic: secondary.basic || basicColorOfHex(secondary.hex),
      weight: +secondary.weight.toFixed(4)
    });
  }
  for (const a of accents) {
    roles.push({
      role: 'accent',
      hex: a.hex,
      name: nearestColorName(a.hex),
      basic: a.basic || basicColorOfHex(a.hex),
      weight: +a.weight.toFixed(4)
    });
  }

  const neutralRatio = neutral.length / Math.max(1, chroma.length + neutral.length);
  const chromaPool = merged.filter(c => c.hsl.s >= 0.12);

  // 色系派生 8
  const styles = [];
  if (neutralRatio > 0.85) styles.push('黑白灰极简');
  const warmWoods = chromaPool.filter(c => c.hsl.h >= 25 && c.hsl.h <= 45 && c.weight === Math.max(...chromaPool.map(x => x.weight)));
  if (warmWoods.length && chromaPool[0] && chromaPool[0].hsl.h >= 25 && chromaPool[0].hsl.h <= 45) styles.push('原木日系');
  if (chromaPool.some(c => c.hsl.h >= 20 && c.hsl.h <= 60 && c.hsl.s >= 0.1 && c.hsl.s <= 0.45 && c.hsl.l <= 0.55)) styles.push('大地侘寂');
  if (chromaPool.length && chromaPool.every(c => c.hsl.s < 0.4)) styles.push('莫兰迪低饱和');
  if (main && main.hsl.l > 0.75 && main.hsl.s < 0.35 && main.hsl.h >= 20 && main.hsl.h <= 60) styles.push('奶油马卡龙');
  if (main && (main.hsl.h < 70 || main.hsl.h > 330)) styles.push('暖色调');
  if (main && main.hsl.h >= 160 && main.hsl.h <= 280) styles.push('冷色调');
  const highSat = chromaPool.filter(c => c.hsl.s > 0.7);
  if (highSat.length >= 2) styles.push('高饱和撞色');

  const basicCounts = {};
  for (const r of roles) basicCounts[r.basic] = (basicCounts[r.basic] || 0) + 1;

  return { dominantColor: main?.basic || '', colors: roles, colorStyles: styles, basicCounts };
}

module.exports = { extractColorRoles, basicColorOfHex, nearestColorName, BASIC_COLORS, rgbToHsl, rgbToHex, hexToRgb, rgbToLab, deltaE2000Approx, deltaE };
