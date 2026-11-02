/**
 * 现代色彩引擎：CIE Lab 转换、CIEDE2000 (ΔE00) 色差计算、LRV 计算与局部图像物理主色提取
 */

// 1. HEX 与 sRGB / XYZ / CIE Lab 互相转换
function hexToRgb(hex) {
  const clean = String(hex || '').trim().replace(/^#/, '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  const num = parseInt(clean.slice(0, 6), 16) || 0;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * 根据 WCAG 相对亮度公式计算 LRV（光反射值，0~100）
 */
function calculateLrv(hex) {
  const { r, g, b } = hexToRgb(hex);
  const srgb = [r / 255, g / 255, b / 255].map(v => {
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const Y = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return Math.round(Y * 1000) / 10;
}

/**
 * 根据 HEX 推导默认色系分类 color_family
 */
function deriveColorFamily(hex) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lrv = calculateLrv(hex);

  // 饱和度极低判灰白/黑
  if (delta < 15) {
    if (lrv >= 75) return 'off_white';
    if (lrv <= 20) return 'cool_gray';
    return 'warm_gray';
  }

  // 计算色相 H (0~360)
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  if (h >= 0 && h < 25) {
    return lrv >= 70 ? 'off_white' : (lrv >= 40 ? 'terracotta_red' : 'terracotta_red');
  }
  if (h >= 25 && h < 55) {
    return lrv >= 75 ? 'off_white' : 'beige_brown';
  }
  if (h >= 55 && h < 80) {
    return lrv >= 70 ? 'off_white' : 'yellow_gold';
  }
  if (h >= 80 && h < 170) {
    return 'green_blue';
  }
  if (h >= 170 && h < 260) {
    return 'green_blue';
  }
  if (h >= 260 && h < 330) {
    return 'warm_gray';
  }
  return 'terracotta_red';
}

function rgbToXyz(r, g, b) {
  const pivot = v => {
    const s = v / 255;
    return s > 0.04045 ? Math.pow((s + 0.055) / 1.055, 2.4) : s / 12.92;
  };
  const R = pivot(r) * 100;
  const G = pivot(g) * 100;
  const B = pivot(b) * 100;
  return {
    x: R * 0.4124 + G * 0.3576 + B * 0.1805,
    y: R * 0.2126 + G * 0.7152 + B * 0.0722,
    z: R * 0.0193 + G * 0.1192 + B * 0.9505
  };
}

function xyzToLab(x, y, z) {
  // D65 参考白点
  const refX = 95.047;
  const refY = 100.000;
  const refZ = 108.883;
  const pivot = v => (v > 0.008856 ? Math.cbrt(v) : (7.787 * v) + (16 / 116));
  const fx = pivot(x / refX);
  const fy = pivot(y / refY);
  const fz = pivot(z / refZ);
  return {
    L: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

function hexToLab(hex) {
  const { r, g, b } = hexToRgb(hex);
  const { x, y, z } = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

/**
 * CIEDE2000 (ΔE00) 现代精确色差公式
 */
function deltaE00(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const kL = 1;
  const kC = 1;
  const kH = 1;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  const rad2deg = rad => (rad * 180) / Math.PI;
  const deg2rad = deg => (deg * Math.PI) / 180;

  const hp = (ap, b) => {
    if (ap === 0 && b === 0) return 0;
    const v = rad2deg(Math.atan2(b, ap));
    return v >= 0 ? v : v + 360;
  };

  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) dhp = diff;
    else if (diff > 180) dhp = diff - 360;
    else dhp = diff + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp / 2));

  const Lbar = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp = 0;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;
  } else {
    const sum = h1p + h2p;
    const diff = Math.abs(h1p - h2p);
    if (diff <= 180) hbarp = sum / 2;
    else if (sum < 360) hbarp = (sum + 360) / 2;
    else hbarp = (sum - 360) / 2;
  }

  const T = 1
    - 0.17 * Math.cos(deg2rad(hbarp - 30))
    + 0.24 * Math.cos(deg2rad(2 * hbarp))
    + 0.32 * Math.cos(deg2rad(3 * hbarp + 6))
    - 0.20 * Math.cos(deg2rad(4 * hbarp - 63));

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const RC = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbar - 50, 2)) / Math.sqrt(20 + Math.pow(Lbar - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(deg2rad(2 * dTheta)) * RC;

  const dE = Math.sqrt(
    Math.pow(dLp / (kL * SL), 2) +
    Math.pow(dCp / (kC * SC), 2) +
    Math.pow(dHp / (kH * SH), 2) +
    RT * (dCp / (kC * SC)) * (dHp / (kH * SH))
  );

  return Math.round(dE * 100) / 100;
}

/**
 * 从色库中寻找最匹配的 Top N 色号
 */
function matchClosestSwatches(targetHex, candidateList, limit = 3) {
  if (!candidateList || !candidateList.length) return [];
  const targetLab = hexToLab(targetHex);
  const scored = [];
  for (const c of candidateList) {
    if (!c || !c.hex) continue;
    const lab = c._lab || hexToLab(c.hex);
    const dE = deltaE00(targetLab, lab);
    scored.push({
      id: c.id,
      brand: c.brand || '',
      code: c.code || '',
      name_zh: c.name_zh || c.display_name || '',
      hex: c.hex,
      delta_e: dE
    });
  }
  scored.sort((a, b) => a.delta_e - b.delta_e);
  return scored.slice(0, limit);
}

/**
 * 从图片裁剪 Buffer 中提取自适应加权主色 HEX (过滤过暗死黑、过亮高光)
 */
async function extractDominantHexFromBuffer(buffer, sharpModule = null) {
  try {
    const sharp = sharpModule || require('sharp');
    const { data, info } = await sharp(buffer)
      .resize(48, 48, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const totalPixels = info.width * info.height;
    const channels = info.channels || 3;
    const validPixels = [];

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * channels;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      // 过滤边缘反光 (>245) 与极深暗影 (<15)
      if (brightness >= 18 && brightness <= 245) {
        validPixels.push({ r, g, b, brightness });
      }
    }

    if (!validPixels.length) {
      // 无法过滤时，直接取全部均值
      let sumR = 0, sumG = 0, sumB = 0;
      for (let i = 0; i < totalPixels; i++) {
        sumR += data[i * channels];
        sumG += data[i * channels + 1];
        sumB += data[i * channels + 2];
      }
      return rgbToHex(sumR / totalPixels, sumG / totalPixels, sumB / totalPixels);
    }

    // 按明度排序，取四分位中位数稳健估计 (Median of Mid-50%)
    validPixels.sort((p1, p2) => p1.brightness - p2.brightness);
    const start = Math.floor(validPixels.length * 0.25);
    const end = Math.ceil(validPixels.length * 0.75);
    const slice = validPixels.slice(start, end);

    let sumR = 0, sumG = 0, sumB = 0;
    for (const p of slice) {
      sumR += p.r;
      sumG += p.g;
      sumB += p.b;
    }
    return rgbToHex(sumR / slice.length, sumG / slice.length, sumB / slice.length);
  } catch (err) {
    return '#B0A89F'; // 安全暖灰兜底
  }
}

/**
 * 室内设计美学命名生成器（离线与高可用保底算法）
 */
function generateAestheticColorName(hex, partHint = '') {
  const { r, g, b } = hexToRgb(hex);
  const lrv = calculateLrv(hex);
  const part = String(partHint || '').toLowerCase();

  // 根据部位和色调生成诗意室内设计色名
  if (part.includes('upholstery') || part.includes('sofa') || part.includes('沙发')) {
    if (r > g && g > b && r > 100 && b < 80) {
      if (lrv < 15) return { name: '意式马鞍深棕', alts: ['复古焦糖油蜡皮', '干邑琥珀棕', '中古烤栗皮'] };
      if (lrv < 30) return { name: '复古焦糖油蜡棕', alts: ['意式暖栗棕', '琥珀马鞍皮', '秋日枫糖皮'] };
      return { name: '浅驼暖杏纳帕皮', alts: ['燕麦奶茶皮', '温润象牙驼', '拿铁暖杏皮'] };
    }
    if (lrv >= 75) return { name: '象牙云朵白软包', alts: ['法式羊羔绒白', '温润珍珠皮', '初雪奶白'] };
    if (lrv <= 10) return { name: '曜石黑纳帕真皮', alts: ['玄铁黑油蜡皮', '极简墨夜黑', '深空曜石'] };
    return { name: '大象灰高级纳帕皮', alts: ['岩石暖灰皮', '爱马仕灰', '静谧冷灰皮'] };
  }

  if (part.includes('floor') || part.includes('wood') || part.includes('地面') || part.includes('木')) {
    if (r > g && g > b) {
      if (lrv < 12) return { name: '北美黑胡桃暖褐', alts: ['烟熏乌木深褐', '中古黑胡桃', '深焙焦糖木'] };
      if (lrv < 30) return { name: '中古缅甸柚木金棕', alts: ['蜂蜜暖樱桃木', '复古琥珀木', '暖棕柚木'] };
      return { name: '日式原木白橡色', alts: ['北欧漂白橡木', '温润原生暖橡', '浅白工字拼橡木'] };
    }
    return { name: '微水泥雅灰', alts: ['水磨石素灰', '罗马凝灰石', '素水泥浅灰'] };
  }

  if (lrv >= 82) return { name: '珍珠暖白', alts: ['菱花奶白', '奶油泡芙', '象牙柔光白'] };
  if (lrv >= 65) return { name: '可可蛋奶浅杏', alts: ['奶酪薄荷', '杏子浅灰', '温暖米杏'] };
  if (lrv >= 45) return { name: '伦敦雾暖灰', alts: ['鹅绒灰泥', '侘寂素灰', '莫兰迪柔灰'] };
  if (lrv >= 25) return { name: '焦糖暖咖', alts: ['鼠尾草灰绿', '复古橄榄绿', '迷雾蓝灰'] };
  return { name: '静谧曜夜深色', alts: ['深空曜石黑', '复古墨黑', '玄武岩灰'] };
}

module.exports = {
  hexToRgb,
  rgbToHex,
  calculateLrv,
  deriveColorFamily,
  hexToLab,
  deltaE00,
  matchClosestSwatches,
  extractDominantHexFromBuffer,
  generateAestheticColorName
};
