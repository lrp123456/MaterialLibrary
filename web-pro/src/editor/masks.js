import { clamp } from './model.js';

export const MASK_TYPES = [
  { type: 'rectangle', label: '矩形', icon: '▭' },
  { type: 'ellipse', label: '椭圆', icon: '◯' },
  { type: 'path', label: '自由路径', icon: '✎' },
];

export function makeMask(type) {
  return {
    id: `mask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    x: 0.5,
    y: 0.5,
    w: 0.7,
    h: 0.7,
    rotation: 0,
    radius: type === 'rectangle' ? 0.08 : 0,
    feather: 0,
    inverted: false,
    points: type === 'path'
      ? [
        { x: 0.25, y: 0.2 },
        { x: 0.78, y: 0.3 },
        { x: 0.7, y: 0.82 },
        { x: 0.22, y: 0.72 },
      ]
      : [],
  };
}

export function buildMaskPath(ctx, mask, w, h) {
  const cx = clamp(mask.x, 0, 1) * w;
  const cy = clamp(mask.y, 0, 1) * h;
  const mw = Math.max(1, clamp(mask.w, 0.001, 10) * w);
  const mh = Math.max(1, clamp(mask.h, 0.001, 10) * h);
  ctx.beginPath();
  if (mask.type === 'ellipse') {
    ctx.ellipse(cx, cy, mw / 2, mh / 2, (mask.rotation || 0) * Math.PI / 180, 0, Math.PI * 2);
    return;
  }
  if (mask.type === 'rectangle') {
    const x = cx - mw / 2;
    const y = cy - mh / 2;
    const r = clamp(Number(mask.radius) || 0, 0, 0.5) * Math.min(mw, mh);
    const rot = (mask.rotation || 0) * Math.PI / 180;
    if (rot === 0) {
      if (r > 0.5 && ctx.roundRect) ctx.roundRect(x, y, mw, mh, r);
      else if (r > 0.5) {
        const rr = Math.min(r, mw / 2, mh / 2);
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + mw - rr, y);
        ctx.quadraticCurveTo(x + mw, y, x + mw, y + rr);
        ctx.lineTo(x + mw, y + mh - rr);
        ctx.quadraticCurveTo(x + mw, y + mh, x + mw - rr, y + mh);
        ctx.lineTo(x + rr, y + mh);
        ctx.quadraticCurveTo(x, y + mh, x, y + mh - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
      } else ctx.rect(x, y, mw, mh);
      return;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.translate(-cx, -cy);
    if (r > 0.5 && ctx.roundRect) ctx.roundRect(x, y, mw, mh, r);
    else ctx.rect(x, y, mw, mh);
    ctx.restore();
    return;
  }
  // 自由贝塞尔多边形：每个点作为控制点，取相邻中点做二次贝塞尔平滑。
  const pts = (mask.points || []).map((p) => ({ x: p.x * w, y: p.y * h }));
  if (pts.length < 2) return;
  const rot = (mask.rotation || 0) * Math.PI / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const rotated = pts.map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
  const first = rotated[0];
  const last = rotated[rotated.length - 1];
  ctx.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2);
  for (let i = 0; i < rotated.length; i += 1) {
    const cur = rotated[i];
    const next = rotated[(i + 1) % rotated.length];
    ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
  }
  ctx.closePath();
}

/** 在元素自己的离屏画布上应用遮罩（羽化与反向）。 */
export function applyMaskToCanvas(elementCanvas, mask) {
  const w = elementCanvas.width;
  const h = elementCanvas.height;
  if (!w || !h) return;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mctx = maskCanvas.getContext('2d');
  const feather = clamp(Number(mask.feather) || 0, 0, 100);

  if (mask.inverted) {
    mctx.fillStyle = '#fff';
    mctx.fillRect(0, 0, w, h);
    mctx.globalCompositeOperation = 'destination-out';
  } else {
    mctx.fillStyle = '#fff';
  }
  mctx.save();
  if (feather > 0) mctx.filter = `blur(${feather}px)`;
  buildMaskPath(mctx, mask, w, h);
  mctx.fill();
  mctx.restore();

  const ctx = elementCanvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.restore();
}

export function drawMaskOutline(ctx, mask, w, h, color = '#22d3ee') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  buildMaskPath(ctx, mask, w, h);
  ctx.stroke();
  if (mask.type === 'path') {
    for (const p of mask.points || []) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
  ctx.restore();
}
