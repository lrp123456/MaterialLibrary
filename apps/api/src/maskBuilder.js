/**
 * maskBuilder —— 选区栅格化与几何工具（通用，不依赖 Umbra）
 *
 * 由原 umbra.js 抽出（行为保持一致），并新增管线 B 需要的统一出口：
 *   - selectionToPercent()         选区 IR(px) → 栅格化入参(percent)
 *   - selectionToApiBox0999()      选区 IR(px) → 0–999 bbox
 *   - selectionToPoint0999()       选区 IR(px) → 0–999 中心点
 *   - buildMaskFromSelection()     统一：三态选区 → 白=重绘 PNG + 公网 URL
 *
 * 契约（见 AI_CONTRACT.md §3）：
 *   - 坐标空间：入参为**图像像素**（相对 natW/natH）；输出 mask 白=重绘、黑=保留
 *   - 三态：rect / quad / brush，三者都必须能算出外接框（coords 出口依赖它）
 */
const fs = require('fs');
const path = require('path');
const { generateMediaToken } = require('./auth');

/* ------------------------------------------------------------------ *
 * 目录与公网 URL
 * ------------------------------------------------------------------ */

function aiMaskDir(config) {
  const dir = path.join(
    (config && config.dataDir) || path.join(__dirname, '..', 'data'),
    'cache',
    'ai_masks'
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** BFF 公网 Base：kv bff_public_base → 环境变量。（与 umbra.getUmbraConfig 同源） */
function resolvePublicBase(db) {
  let v = null;
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key=?').get('bff_public_base');
    v = row && row.value;
  } catch (_) {}
  return String(v || process.env.BFF_PUBLIC_BASE || '').replace(/\/+$/, '');
}

function maskPublicUrl(db, maskId) {
  const base = resolvePublicBase(db);
  const token = generateMediaToken(`mask:${maskId}`, 3600 * 6);
  const pathPart = `/api/viewer/ai/masks/${encodeURIComponent(maskId)}?media_token=${encodeURIComponent(token)}`;
  // 未配置公网 Base 时返回相对路径；客户端用自身服务器地址拼绝对 URL
  if (!base) return pathPart;
  return `${base}${pathPart}`;
}

function resolveMaskFile(config, maskId) {
  const safe = String(maskId || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe) return null;
  const dir = aiMaskDir(config);
  const direct = path.join(dir, safe);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  const png = path.join(dir, `${safe}.png`);
  if (fs.existsSync(png)) return png;
  return null;
}

/* ------------------------------------------------------------------ *
 * 几何工具
 * ------------------------------------------------------------------ */

function parsePoint(p) {
  if (Array.isArray(p) && p.length >= 2) {
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }
  if (p && typeof p === 'object') {
    const x = Number(p.x != null ? p.x : p[0]);
    const y = Number(p.y != null ? p.y : p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }
  return null;
}

function looksLikePercent(pts, width, height) {
  if (!pts.length) return false;
  const maxX = Math.max(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  if (maxX > 100.0001 || maxY > 100.0001) return false;
  if (width > 120 || height > 120) return true;
  return maxX <= 100 && maxY <= 100;
}

function toPixelPoints(pts, opts) {
  const o = opts || {};
  const w = Number(o.width) || 0;
  const h = Number(o.height) || 0;
  const percent = o.unit === 'percent' || (o.unit !== 'px' && looksLikePercent(pts, w, h));
  if (!percent) return pts.map((p) => ({ x: p.x, y: p.y }));
  const rw = w > 0 ? w : 1000;
  const rh = h > 0 ? h : 1000;
  return pts.map((p) => ({ x: (p.x / 100) * rw, y: (p.y / 100) * rh }));
}

function stringifyQuad(quad) {
  const pts = (Array.isArray(quad) ? quad : []).map(parsePoint).filter(Boolean);
  if (pts.length < 4) return '';
  return pts.slice(0, 4).flatMap((p) => [Math.round(p.x), Math.round(p.y)]).join(',');
}

/** 四点 perspective_quad → bbox 字符串 x1,y1,x2,y2。百分比点需传 width/height。 */
function quadToBbox(quad, dims) {
  const d = dims || {};
  if (!Array.isArray(quad) || quad.length < 4) return null;
  const raw = quad.slice(0, 4).map(parsePoint).filter(Boolean);
  if (raw.length < 4) return null;
  const pts = toPixelPoints(raw, d);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let x1 = Math.round(Math.min(...xs));
  let y1 = Math.round(Math.min(...ys));
  let x2 = Math.round(Math.max(...xs));
  let y2 = Math.round(Math.max(...ys));
  const w = Number(d.width) || 0;
  const h = Number(d.height) || 0;
  if (w > 0) {
    x1 = Math.max(0, Math.min(w - 1, x1));
    x2 = Math.max(0, Math.min(w, x2));
  } else {
    x1 = Math.max(0, x1);
  }
  if (h > 0) {
    y1 = Math.max(0, Math.min(h - 1, y1));
    y2 = Math.max(0, Math.min(h, y2));
  } else {
    y1 = Math.max(0, y1);
  }
  if (x2 <= x1 || y2 <= y1) return null;
  return `${x1},${y1},${x2},${y2}`;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** 由三态选区算出图像像素外接框（coords 出口与降级判定的唯一依据） */
function selectionBounds(selection, natW, natH) {
  if (!selection) return null;
  const w = Number(natW) || 0;
  const h = Number(natH) || 0;
  if (selection.bbox && selection.bbox.x1 != null) {
    const b = selection.bbox;
    return {
      x1: clamp(Math.round(b.x1), 0, w || Infinity),
      y1: clamp(Math.round(b.y1), 0, h || Infinity),
      x2: clamp(Math.round(b.x2), 0, w || Infinity),
      y2: clamp(Math.round(b.y2), 0, h || Infinity),
    };
  }

  // 画框 —— 客户端 IR 的规范写法 {left, top, right|width, bottom|height, unit}
  // 或 {rectBox:{x,y,w,h}}（percent）。此处曾经缺失，导致 pipeline 传进来的
  // 矩形选区在 maskBuilder 里算出 null（image-ops 那边却能算），两套几何口径不一致。
  const hasLeftTop = Number.isFinite(Number(selection.left)) && Number.isFinite(Number(selection.top));
  const hasRectBox = !!(selection.rectBox && Number.isFinite(Number(selection.rectBox.x)));
  if (hasLeftTop || hasRectBox) {
    const unit = String(selection.unit || (hasRectBox ? 'percent' : 'px')).toLowerCase();
    let l, tp, r, b;
    if (hasRectBox) {
      const rb = selection.rectBox;
      l = Number(rb.x);
      tp = Number(rb.y);
      r = l + Number(rb.w != null ? rb.w : rb.width);
      b = tp + Number(rb.h != null ? rb.h : rb.height);
    } else {
      l = Number(selection.left);
      tp = Number(selection.top);
      r = Number.isFinite(Number(selection.right)) ? Number(selection.right) : l + Number(selection.width || 0);
      b = Number.isFinite(Number(selection.bottom)) ? Number(selection.bottom) : tp + Number(selection.height || 0);
    }
    if ([l, tp, r, b].every(Number.isFinite)) {
      const px = toPixelPoints([{ x: l, y: tp }, { x: r, y: b }], { width: w, height: h, unit });
      const x1 = Math.min(px[0].x, px[1].x);
      const y1 = Math.min(px[0].y, px[1].y);
      const x2 = Math.max(px[0].x, px[1].x);
      const y2 = Math.max(px[0].y, px[1].y);
      if (x2 > x1 && y2 > y1) {
        return {
          x1: clamp(Math.round(x1), 0, w || Infinity),
          y1: clamp(Math.round(y1), 0, h || Infinity),
          x2: clamp(Math.round(x2), 0, w || Infinity),
          y2: clamp(Math.round(y2), 0, h || Infinity),
        };
      }
    }
  }
  const pts = [];
  if (Array.isArray(selection.points)) selection.points.forEach((p) => { const q = parsePoint(p); if (q) pts.push(q); });
  if (Array.isArray(selection.quad)) selection.quad.forEach((p) => { const q = parsePoint(p); if (q) pts.push(q); });
  if (Array.isArray(selection.strokes)) {
    selection.strokes.forEach((s) => {
      if (Array.isArray(s && s.points)) s.points.forEach((p) => { const q = parsePoint(p); if (q) pts.push(q); });
    });
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x1: clamp(Math.round(Math.min(...xs)), 0, w || Infinity),
    y1: clamp(Math.round(Math.min(...ys)), 0, h || Infinity),
    x2: clamp(Math.round(Math.max(...xs)), 0, w || Infinity),
    y2: clamp(Math.round(Math.max(...ys)), 0, h || Infinity),
  };
}

/** 选区 IR(px) → 0–999 bbox（Seedream 坐标语法用） */
function selectionToApiBox0999(selection, natW, natH) {
  const w = Number(natW) || 0;
  const h = Number(natH) || 0;
  if (!w || !h) return null;
  const b = selectionBounds(selection, w, h);
  if (!b) return null;
  const x1 = clamp(Math.round((b.x1 / w) * 999), 0, 999);
  const y1 = clamp(Math.round((b.y1 / h) * 999), 0, 999);
  const x2 = clamp(Math.round((b.x2 / w) * 999), 0, 999);
  const y2 = clamp(Math.round((b.y2 / h) * 999), 0, 999);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

/** 选区 IR(px) → 0–999 中心点（落位类操作用） */
function selectionToPoint0999(selection, natW, natH) {
  const box = selectionToApiBox0999(selection, natW, natH);
  if (!box) return null;
  return { x: Math.round((box.x1 + box.x2) / 2), y: Math.round((box.y1 + box.y2) / 2) };
}

/**
 * 选区 IR(px) → rasterizeTouchMask 需要的 percent 入参。
 * 三态各自映射，保留各自能表达的信息（rect 保矩形 / quad 保斜面 / brush 保轮廓）。
 */
function selectionToPercent(selection, natW, natH) {
  const w = Number(natW) || 0;
  const h = Number(natH) || 0;
  if (!w || !h || !selection) return null;
  const toPct = (p) => ({ x: (p.x / w) * 100, y: (p.y / h) * 100 });
  const out = { unit: 'percent' };

  const type = String(selection.type || '').toLowerCase();

  // 四点优先级最高（能表达斜面）
  const quadSrc = Array.isArray(selection.quad) && selection.quad.length >= 4
    ? selection.quad
    : (type === 'quad' && Array.isArray(selection.points) && selection.points.length >= 4 ? selection.points : null);
  if (quadSrc) {
    const pts = quadSrc.map(parsePoint).filter(Boolean);
    if (pts.length >= 4) out.quad = pts.slice(0, 4).map(toPct);
  }

  // 涂抹折线
  if (Array.isArray(selection.strokes) && selection.strokes.length) {
    const list = [];
    selection.strokes.forEach((s) => {
      const pts = Array.isArray(s && s.points) ? s.points.map(parsePoint).filter(Boolean) : [];
      if (pts.length >= 2) list.push({ points: pts.map(toPct), size: Number(s.size) || 32 });
    });
    if (list.length) out.strokes = list;
  }

  // 画框（仅在既无 quad 也无 strokes 时使用，避免叠加放大选区）
  if (!out.quad && !out.strokes) {
    const b = selectionBounds(selection, w, h);
    if (b) {
      out.rectBox = {
        x: (b.x1 / w) * 100,
        y: (b.y1 / h) * 100,
        w: ((b.x2 - b.x1) / w) * 100,
        h: ((b.y2 - b.y1) / h) * 100,
      };
    }
  }
  return (out.quad || out.strokes || out.rectBox) ? out : null;
}

/* ------------------------------------------------------------------ *
 * 栅格化
 * ------------------------------------------------------------------ */

/**
 * 把涂抹折线、画框或四点多边形栅格化成白=选区的 PNG。
 * strokes.points / quad / rectBox 默认 0–100 百分比。
 */
async function rasterizeTouchMask(opts) {
  const sharp = require('sharp');
  const o = opts || {};
  const w = Math.max(8, Math.round(Number(o.width) || 1080));
  const h = Math.max(8, Math.round(Number(o.height) || 1440));
  const unit = o.unit || 'percent';
  const parts = [];

  // 1. 画框选区 rectBox（百分比）
  const rectBox = o.rectBox;
  if (rectBox && typeof rectBox === 'object') {
    const rx = Number(rectBox.x || 0);
    const ry = Number(rectBox.y || 0);
    const rw = Number(rectBox.w != null ? rectBox.w : rectBox.width) || 0;
    const rh = Number(rectBox.h != null ? rectBox.h : rectBox.height) || 0;
    if (rw > 0 && rh > 0) {
      const pxX = Math.max(0, Math.round((rx / 100) * w));
      const pxY = Math.max(0, Math.round((ry / 100) * h));
      const pxW = Math.min(w - pxX, Math.round((rw / 100) * w));
      const pxH = Math.min(h - pxY, Math.round((rh / 100) * h));
      parts.push(`<rect x="${pxX}" y="${pxY}" width="${pxW}" height="${pxH}" fill="white"/>`);
    }
  }

  // 2. 四点透视选区 quad
  const quadPts = Array.isArray(o.quad) ? o.quad.map(parsePoint).filter(Boolean) : [];
  if (quadPts.length >= 4 && (!rectBox || parts.length === 0)) {
    const px = toPixelPoints(quadPts.slice(0, 4), { width: w, height: h, unit: unit });
    const points = px.map((p) => `${p.x},${p.y}`).join(' ');
    parts.push(`<polygon points="${escapeXml(points)}" fill="white"/>`);
  }

  // 3. 涂抹折线 strokes
  const strokeList = Array.isArray(o.strokes) ? o.strokes : [];
  for (const s of strokeList) {
    const pts = Array.isArray(s && s.points) ? s.points.map(parsePoint).filter(Boolean) : [];
    if (pts.length < 2) continue;
    const px = toPixelPoints(pts, { width: w, height: h, unit: (s && s.unit) || unit });
    const d = px.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const size = Number(s && s.size) || 32;
    const sw = Math.max(6, (size / 1000) * Math.min(w, h));
    parts.push(
      `<path d="${escapeXml(d)}" fill="none" stroke="white" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  }

  if (!parts.length) throw new Error('没有可栅格化的画框、涂抹或四点选区');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="black"/>${parts.join('')}</svg>`;
  fs.mkdirSync(path.dirname(o.destPath), { recursive: true });

  let pipeline = sharp(Buffer.from(svg)).png();
  if (o.feather) {
    // 边缘羽化抗锯齿：轻量高斯模糊，让消除边缘无缝自然融合
    const sigma = Math.max(1.5, Math.min(5, Math.round(Math.min(w, h) * 0.003)));
    pipeline = pipeline.blur(sigma);
  }
  await pipeline.toFile(o.destPath);
  return o.destPath;
}

async function persistTouchMask(db, config, opts) {
  const o = opts || {};
  const maskId = String(o.taskId || `mask_${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '_');
  const destPath = path.join(aiMaskDir(config), `${maskId}.png`);
  await rasterizeTouchMask({
    width: o.width,
    height: o.height,
    strokes: o.strokes,
    quad: o.quad,
    rectBox: o.rectBox,
    destPath,
    unit: o.unit || 'percent',
    feather: o.feather === true,
  });
  return { maskId, destPath, url: maskPublicUrl(db, maskId) };
}

async function persistUploadedBuffer(db, config, buffer, ext) {
  const crypto = require('crypto');
  const maskId = `up_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const safeExt = /^\.[A-Za-z0-9]+$/.test(ext || '') ? ext : '.png';
  const destPath = path.join(aiMaskDir(config), `${maskId}${safeExt}`);
  fs.writeFileSync(destPath, buffer);
  return { maskId, destPath, url: maskPublicUrl(db, maskId) };
}

/* ------------------------------------------------------------------ *
 * 管线 B 统一出口：三态选区 → mask 产物
 * ------------------------------------------------------------------ */

/** 选区的保真度分级（用于降级判定与 regionNote 文案） */
const FIDELITY = { rect: 1, quad: 2, brush: 3 };

/**
 * 三态选区 → 白=重绘 PNG（mask 出口的统一实现）。
 * @returns {{ maskId, destPath, url, rectBox, apiBox, sourceType, note }}
 */
async function buildMaskFromSelection(db, config, opts) {
  const o = opts || {};
  const natW = Number(o.natW) || 0;
  const natH = Number(o.natH) || 0;
  if (!natW || !natH) throw new Error('buildMaskFromSelection 需要 natW/natH');
  const percent = selectionToPercent(o.selection, natW, natH);
  if (!percent) throw new Error('选区无法栅格化：缺少 bbox / quad / strokes');

  const maskId = String(o.maskId || `sel_${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '_');
  const destPath = path.join(aiMaskDir(config), `${maskId}.png`);
  await rasterizeTouchMask({
    width: natW,
    height: natH,
    rectBox: percent.rectBox,
    quad: percent.quad,
    strokes: percent.strokes,
    unit: 'percent',
    destPath,
    feather: o.feather === true,
  });
  return {
    maskId,
    destPath,
    url: maskPublicUrl(db, maskId),
    rectBox: percent.rectBox || null,
    apiBox: selectionToApiBox0999(o.selection, natW, natH),
    sourceType: String((o.selection && o.selection.type) || 'rect').toLowerCase(),
  };
}

module.exports = {
  // 目录 / URL
  aiMaskDir,
  resolvePublicBase,
  maskPublicUrl,
  resolveMaskFile,
  // 几何
  parsePoint,
  looksLikePercent,
  toPixelPoints,
  stringifyQuad,
  quadToBbox,
  escapeXml,
  selectionBounds,
  selectionToApiBox0999,
  selectionToPoint0999,
  selectionToPercent,
  // 栅格化
  rasterizeTouchMask,
  persistTouchMask,
  persistUploadedBuffer,
  // 统一出口
  buildMaskFromSelection,
  FIDELITY,
};
