/**
 * 材质像素级明度保留染色器 (Texture Luminosity Color Tinting)
 * 核心原理：保持原材质高频凹凸肌理与阴影细节 (Luminosity)，将色相 (Hue) 与饱和度 (Saturation) 映射为目标颜色。
 */

// HEX 颜色转 RGB
export function hexToRgb(hex) {
  let c = hex.replace('#', '').trim();
  if (c.length === 3) {
    c = c.split('').map(x => x + x).join('');
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return { r: 128, g: 128, b: 128 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

// RGB 转 HEX
export function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// RGB 转 HSL
export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

// HSL 转 RGB
export function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

/**
 * 将图片元素或 DataUrl 染上指定颜色，返回新的 DataUrl
 * @param {HTMLImageElement|string} sourceImg 图片对象或图片 URL
 * @param {string} targetHex 目标颜色 HEX
 * @param {object} options 配置选项
 * @returns {Promise<{ dataUrl: string, blob: Blob, width: number, height: number }>}
 */
export async function tintTexture(sourceImg, targetHex, options = {}) {
  const intensity = options.intensity !== undefined ? options.intensity : 0.88; // 染色强度 0~1

  let img;
  if (typeof sourceImg === 'string') {
    img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = sourceImg;
    });
  } else {
    img = sourceImg;
  }

  const canvas = document.createElement('canvas');
  const w = options.maxWidth ? Math.min(options.maxWidth, img.naturalWidth || img.width || 512) : (img.naturalWidth || img.width || 512);
  const h = options.maxHeight ? Math.min(options.maxHeight, img.naturalHeight || img.height || 512) : (img.naturalHeight || img.height || 512);
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const targetRgb = hexToRgb(targetHex);
  const targetHsl = rgbToHsl(targetRgb.r, targetRgb.g, targetRgb.b);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 10) continue;

    // 获取当前纹理像素亮度
    const originalHsl = rgbToHsl(r, g, b);
    
    // 保留原图亮度，重映射色相与饱和度
    // 亮度对比度曲线微调，避免过曝或死黑
    const mixedL = originalHsl.l * 0.7 + targetHsl.l * 0.3;
    const mixedS = Math.min(1, targetHsl.s * (0.8 + originalHsl.s * 0.4));
    
    const tintedRgb = hslToRgb(targetHsl.h, mixedS, mixedL);

    // 按强度混合
    data[i] = Math.round(r * (1 - intensity) + tintedRgb.r * intensity);
    data[i + 1] = Math.round(g * (1 - intensity) + tintedRgb.g * intensity);
    data[i + 2] = Math.round(b * (1 - intensity) + tintedRgb.b * intensity);
  }

  ctx.putImageData(imgData, 0, 0);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));

  return {
    dataUrl,
    blob,
    width: canvas.width,
    height: canvas.height
  };
}

/**
 * 推荐室内设计高级色卡
 */
export const DESIGNER_PALETTES = [
  { name: '意式马鞍棕', hex: '#6E4528', group: '大地色' },
  { name: '暖杏米白', hex: '#EBE2D5', group: '奶油色' },
  { name: '复古墨绿', hex: '#2A4033', group: '复古色' },
  { name: '勃艮第酒红', hex: '#582129', group: '轻奢色' },
  { name: '暮云灰蓝', hex: '#5C6D7A', group: '莫兰迪' },
  { name: '烟熏暗灰', hex: '#3B3B3D', group: '极简色' },
  { name: '法式灰豆绿', hex: '#7D8C7C', group: '复古色' },
  { name: '焦糖暖黄', hex: '#B87A38', group: '大地色' },
  { name: '微水泥浅灰', hex: '#C7C6C1', group: '极简色' },
  { name: '克莱因宝蓝', hex: '#002FA7', group: '艺术色' }
];
