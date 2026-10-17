/**
 * workshop-model.js — 策略 B 草稿烘焙与模拟模型调用
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function canvasFrom(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

export function toDataURL(canvas, type = 'image/jpeg', quality = 0.92) {
  return canvas.toDataURL(type, quality);
}

export function quadMetrics(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const sorted = [...points].map((p, i) => ({ ...p, i })).sort((a, b) => b.y - a.y);
  const ground = [sorted[0], sorted[1]];
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  return {
    cx,
    cy,
    ground,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function scaleFootprint(points, scalePct) {
  const m = quadMetrics(points);
  const s = (scalePct || 100) / 100;
  return points.map((p) => ({
    x: m.cx + (p.x - m.cx) * s,
    y: m.cy + (p.y - m.cy) * s,
  }));
}

export async function bakePlacementDraft({
  parentDataUrl,
  quad,
  yaw = 0,
  scalePct = 100,
  productDataUrl = null,
  productHasModel = true,
  materialRef = null,
  op = 'replace',
}) {
  const parent = await loadImage(parentDataUrl);
  const w = parent.naturalWidth || parent.width;
  const h = parent.naturalHeight || parent.height;
  const canvas = canvasFrom(parent, w, h);
  const ctx = canvas.getContext('2d');
  const pts = scaleFootprint(quad, scalePct);
  const m = quadMetrics(pts);
  const px = (x) => (x / 100) * w;
  const py = (y) => (y / 100) * h;

  const padX = (m.maxX - m.minX) * 0.18;
  const padY = (m.maxY - m.minY) * 0.18;
  const nRect = {
    x: px(Math.max(0, m.minX - padX)),
    y: py(Math.max(0, m.minY - padY)),
    w: px(Math.min(100, m.maxX + padX) - Math.max(0, m.minX - padX)),
    h: py(Math.min(100, m.maxY + padY) - Math.max(0, m.minY - padY)),
  };

  if (op === 'replace' || op === 'add' || op === 'install') {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px(pts[0].x), py(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].y));
    ctx.closePath();
    ctx.fillStyle = productHasModel ? 'rgba(37, 99, 235, 0.28)' : 'rgba(245, 158, 11, 0.28)';
    ctx.fill();
    ctx.lineWidth = Math.max(2, w / 400);
    ctx.strokeStyle = productHasModel ? '#38bdf8' : '#f59e0b';
    ctx.stroke();
    const yawRad = ((yaw || 0) * Math.PI) / 180;
    const len = (m.maxX - m.minX) * 0.35;
    const ax = m.cx + Math.sin(yawRad) * len;
    const ay = m.cy - Math.cos(yawRad) * len * 0.35;
    ctx.beginPath();
    ctx.moveTo(px(m.cx), py(m.cy));
    ctx.lineTo(px(ax), py(ay));
    ctx.lineWidth = Math.max(2, w / 350);
    ctx.strokeStyle = '#10b981';
    ctx.stroke();
    ctx.restore();
    if (op === 'install' && productDataUrl) {
      try {
        const prod = await loadImage(productDataUrl);
        const x0 = px(pts[0].x), y0 = py(pts[0].y);
        const x1 = px(pts[1].x), y1 = py(pts[1].y);
        const x3 = px(pts[3].x), y3 = py(pts[3].y);
        const bw = Math.hypot(x1 - x0, y1 - y0) || 1;
        const bh = Math.hypot(x3 - x0, y3 - y0) || 1;
        const angle = Math.atan2(y1 - y0, x1 - x0);
        ctx.save();
        ctx.translate(x0, y0);
        ctx.rotate(angle);
        ctx.drawImage(prod, 0, 0, bw, bh);
        ctx.restore();
      } catch (e) {}
    }
  } else if (op === 'remove' || op === 'dewm' || op === 'blank') {
    const r = quad;
    const rx = px(Math.min(r.x1, r.x2));
    const ry = py(Math.min(r.y1, r.y2));
    const rw = px(Math.abs(r.x2 - r.x1));
    const rh = py(Math.abs(r.y2 - r.y1));
    ctx.save();
    ctx.fillStyle = op === 'dewm' ? 'rgba(248, 113, 113, 0.18)' : 'rgba(56, 189, 248, 0.14)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = op === 'dewm' ? '#f87171' : '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, rw, rh);
    if (op === 'blank') {
      const high = rh > rw;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
      if (high) {
        ctx.fillRect(rx - rw * 0.45, ry, rw * 0.45, rh);
        ctx.fillRect(rx + rw, ry, rw * 0.45, rh);
      } else {
        ctx.fillRect(rx, ry - rh * 0.45, rw, rh * 0.45);
        ctx.fillRect(rx, ry + rh, rw, rh * 0.45);
      }
    }
    ctx.restore();
  } else if (op === 'clarity') {
    ctx.save();
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);
    ctx.restore();
  }

  if (materialRef) {
    const mx = px(materialRef.x1);
    const my = py(materialRef.y1);
    const mw = px(Math.abs(materialRef.x2 - materialRef.x1));
    const mh = py(Math.abs(materialRef.y2 - materialRef.y1));
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(mx, my, mw, mh);
    ctx.restore();
  }

  return {
    draftDataUrl: toDataURL(canvas),
    neighborhood: nRect,
    footprint: pts,
    locked: { position: true, size: true, facing: op === 'replace' || op === 'add' },
  };
}

export async function bakeOrientationRef({ parentDataUrl, quad, yaw = 0, scalePct = 100 }) {
  const parent = await loadImage(parentDataUrl);
  const w = Math.min(480, parent.naturalWidth || parent.width);
  const h = Math.round(w * ((parent.naturalHeight || parent.height) / (parent.naturalWidth || parent.width)));
  const canvas = canvasFrom(parent, w, h);
  const ctx = canvas.getContext('2d');
  const pts = scaleFootprint(quad, scalePct);
  const px = (x) => (x / 100) * w;
  const py = (y) => (y / 100) * h;
  ctx.save();
  ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
  ctx.beginPath();
  ctx.moveTo(px(pts[0].x), py(pts[0].y));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].y));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold ' + Math.max(12, w / 28) + 'px sans-serif';
  ctx.fillText('固定机位朝向参考 · yaw ' + yaw + '°', 12, 24);
  ctx.restore();
  return toDataURL(canvas);
}

export async function runStrategyB({
  parentDataUrl,
  draftDataUrl,
  neighborhood,
  op = 'replace',
  prompt = '',
  materialRef = null,
  forceFail = false,
}) {
  if (forceFail) {
    return { ok: false, reason: '模型返回 503：上游生图服务暂不可用（模拟失败）' };
  }
  const parent = await loadImage(parentDataUrl);
  const draft = await loadImage(draftDataUrl);
  const w = parent.naturalWidth || parent.width;
  const h = parent.naturalHeight || parent.height;
  const out = canvasFrom(parent, w, h);
  const outCtx = out.getContext('2d');
  const nx = Math.max(0, Math.floor(neighborhood.x));
  const ny = Math.max(0, Math.floor(neighborhood.y));
  const nw = Math.min(w - nx, Math.floor(neighborhood.w));
  const nh = Math.min(h - ny, Math.floor(neighborhood.h));

  if (nw > 0 && nh > 0) {
    const scale = 1.35;
    const zoom = document.createElement('canvas');
    zoom.width = Math.floor(nw * scale);
    zoom.height = Math.floor(nh * scale);
    const zctx = zoom.getContext('2d');
    zctx.drawImage(parent, nx, ny, nw, nh, 0, 0, zoom.width, zoom.height);
    const draftN = document.createElement('canvas');
    draftN.width = zoom.width;
    draftN.height = zoom.height;
    const dctx = draftN.getContext('2d');
    dctx.drawImage(draft, nx, ny, nw, nh, 0, 0, zoom.width, zoom.height);
    dctx.globalAlpha = 0.55;
    dctx.drawImage(zoom, 0, 0);
    dctx.globalAlpha = 1;
    dctx.fillStyle = 'rgba(0,0,0,0.18)';
    dctx.fillRect(0, zoom.height * 0.72, zoom.width, zoom.height * 0.28);
    outCtx.drawImage(draftN, 0, 0, zoom.width, zoom.height, nx, ny, nw, nh);
    try {
      reinhardTransfer(outCtx, nx, ny, nw, nh);
    } catch (e) {}
  }
  if (op === 'outpaint') pasteOriginalCenter(outCtx, parent, w, h);
  return {
    ok: true,
    outputUrl: toDataURL(out),
    promptUsed: prompt,
    neighborhoodUsed: { x: nx, y: ny, w: nw, h: nh },
    materialRefUsed: materialRef,
  };
}

function reinhardTransfer(ctx, x, y, w, h) {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  let r = 0, g = 0, b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]; g += d[i + 1]; b += d[i + 2];
  }
  r /= n; g /= n; b /= n;
  const kr = 128 / (r + 1), kg = 128 / (g + 1), kb = 128 / (b + 1);
  const mix = 0.35;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] * (1 - mix) + Math.min(255, d[i] * kr) * mix;
    d[i + 1] = d[i + 1] * (1 - mix) + Math.min(255, d[i + 1] * kg) * mix;
    d[i + 2] = d[i + 2] * (1 - mix) + Math.min(255, d[i + 2] * kb) * mix;
  }
  ctx.putImageData(img, x, y);
}

function pasteOriginalCenter(ctx, parent, origW, origH) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const ox = Math.floor((w - origW) / 2);
  const oy = Math.floor((h - origH) / 2);
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(ctx.canvas, 0, 0);
  tctx.drawImage(parent, ox, oy);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(tmp, 0, 0);
}

export async function expandToRatio(parentDataUrl, ratioId) {
  const parent = await loadImage(parentDataUrl);
  const w = parent.naturalWidth || parent.width;
  const h = parent.naturalHeight || parent.height;
  const parts = ratioId.split(':').map(Number);
  const a = parts[0], b = parts[1];
  let outW = w, outH = h;
  if (w / h < a / b) outW = Math.round(h * (a / b));
  else outH = Math.round(w * (b / a));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d7dde8';
  ctx.fillRect(0, 0, outW, outH);
  const ox = Math.floor((outW - w) / 2);
  const oy = Math.floor((outH - h) / 2);
  ctx.drawImage(parent, ox, oy);
  return {
    canvas,
    dataUrl: toDataURL(canvas),
    outW,
    outH,
    pad: { left: ox, top: oy, right: outW - w - ox, bottom: outH - h - oy },
  };
}

export function defaultPrompt(op, ctx = {}) {
  const yaw = ctx.yaw != null ? ctx.yaw : 0;
  const name = ctx.productName || '目标物体';
  switch (op) {
    case 'replace':
      return '策略B·邻域融合。将选区内原物体替换为「' + name + '」，保持草稿锁定的位置、脚印大小与可见朝向（yaw≈' + yaw + '°）。只重绘邻域表面与接触影，邻域外与父快照一致。光照贴合周围。';
    case 'add':
      return '策略B·邻域融合。在草稿脚印处新增「' + name + '」，朝向 yaw≈' + yaw + '°，体量贴合四点透视。补全接触影与邻域表面，不改动邻域外像素。';
    case 'install':
      return '将产品照片抠出主体，仿射贴入四点透视区域，透视与接地线对齐。补接触影，材质贴合周围。';
    case 'blank':
      return '在矩形选区（间隙）内做留白延伸：高框左右拉、宽框前后拉，边缘与周围一致。';
    case 'remove':
      return '去除矩形选区内物体，用周围墙面/地面纹理填补，接缝自然。';
    case 'dewm':
      return '去除子模式·去水印：仅清除矩形选区内水印/角标文字，不改动其它区域。';
    case 'outpaint':
      return '按固定比例外扩画面，自然补全墙面、地板与天花板；完成后把原图像素贴回中心。';
    case 'clarity':
      return '云端重绘清晰度：增强细节与锐度，保持结构与色彩，不改变内容。';
    default:
      return '执行图像编辑操作：' + op;
  }
}

export function defaultShotPrompt(seg) {
  let p = '镜头沿设计动线运动：' + (seg.motionText || '平稳前推');
  if (seg.hasPerson) {
    p += '。画面中有通用人体沿人物线行走（身高约1.7m，不锁脸，不保证出画）';
  }
  return p;
}

export const SHOT_METHODS = [
  { id: 'first_last', label: '首尾帧', desc: '有起点+终点静帧，默认 Seedance 2.5，比例锁首帧' },
  { id: 'i2v', label: '图生视频', desc: '只有起点静帧' },
  { id: 'stack_then', label: '先走图片栈', desc: '画面还不存在，产物成为静帧后再生成' },
  { id: 'play3d', label: '播 3D', desc: '看向没有照片的墙，不调用视频模型' },
  { id: 'omni', label: '全能参考', desc: '默认不在表里，仅详情手动改' },
];

export function pickMethod({ hasStart, hasEnd, wallWithoutPhoto, missingStill }) {
  if (wallWithoutPhoto) return 'play3d';
  if (missingStill) return 'stack_then';
  if (hasStart && hasEnd) return 'first_last';
  if (hasStart) return 'i2v';
  return 'play3d';
}

export const SEGMENT_MAX_SEC = 12;

export function cutStoryboard(points, opts = {}) {
  const cuts = [];
  const maxSec = SEGMENT_MAX_SEC;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    let reason = null;
    if (prev.room !== cur.room) reason = '穿过门洞';
    else {
      const turn = Math.abs(normalizeAngle(cur.headingDeg - prev.headingDeg));
      if (turn > 45) reason = '朝向变化超过 45°';
    }
    const elapsed = (cur.tSec || 0) - (prev.tSec || 0);
    if (!reason && elapsed > maxSec) reason = '单段会超过 12 秒';
    if (opts.stillStations && opts.stillStations.indexOf(i) >= 0) reason = '走到下一张静帧的机位';
    if (reason) cuts.push({ index: i, reason });
  }
  const segments = [];
  let start = 0;
  const allCuts = cuts.map((c) => c.index).concat([points.length - 1]);
  for (let ci = 0; ci < allCuts.length; ci++) {
    const end = allCuts[ci];
    const slice = points.slice(start, end + 1);
    if (slice.length < 1) {
      start = end;
      continue;
    }
    const duration = Math.min(maxSec, Math.max(4, (slice[slice.length - 1].tSec || 0) - (slice[0].tSec || 0) || 6));
    const cut = cuts.find((c) => c.index === end);
    segments.push({
      id: 'seg_' + start + '_' + end,
      startIndex: start,
      endIndex: end,
      points: slice,
      durationSec: duration,
      cutReason: (cut && cut.reason) || (end === points.length - 1 ? '动线终点' : '时间切段'),
      hasStart: !!(slice[0] && slice[0].stillId),
      hasEnd: !!(slice[slice.length - 1] && slice[slice.length - 1].stillId),
      wallWithoutPhoto: !!(slice[slice.length - 1] && slice[slice.length - 1].wallWithoutPhoto),
      missingStill: !(slice[0] && slice[0].stillId) || !(slice[slice.length - 1] && slice[slice.length - 1].stillId),
      method: null,
      model: 'seedance-2.5-keyframe',
      prompt: '',
      results: [],
      latest: null,
      status: 'idle',
    });
    start = end;
  }
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    s.method = pickMethod({
      hasStart: s.hasStart,
      hasEnd: s.hasEnd,
      wallWithoutPhoto: s.wallWithoutPhoto,
      missingStill: s.missingStill && s.hasStart,
    });
    if (s.missingStill && s.method !== 'play3d') s.method = 'stack_then';
  }
  return segments;
}

function normalizeAngle(deg) {
  return ((deg % 360) + 360) % 360;
}

export async function simulateVideoSegment(seg) {
  await wait(700 + Math.random() * 600);
  if (seg.forceFail) {
    return { ok: false, reason: '视频接口超时（模拟失败），保留上一张成功结果' };
  }
  if (seg.method === 'play3d') {
    return { ok: true, kind: '3d', outputUrl: null, note: '本段播 3D 预览，不调用视频模型' };
  }
  const c = document.createElement('canvas');
  c.width = 960;
  c.height = 540;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 960, 540);
  g.addColorStop(0, '#132033');
  g.addColorStop(0.5, '#1c2d45');
  g.addColorStop(1, '#0f1a2b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 960, 540);
  ctx.fillStyle = 'rgba(56,189,248,0.15)';
  ctx.fillRect(80, 120, 800, 300);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.strokeRect(80, 120, 800, 300);
  ctx.fillStyle = '#e8eef7';
  ctx.font = 'bold 28px sans-serif';
  const label = seg.method === 'first_last' ? '首尾帧片段' : seg.method === 'i2v' ? '图生视频片段' : '生成片段';
  ctx.fillText(label, 100, 200);
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#8b9bb4';
  ctx.fillText('时长 ' + seg.durationSec + 's · ' + seg.model, 100, 250);
  return { ok: true, kind: 'video', outputUrl: c.toDataURL('image/jpeg', 0.9), durationSec: seg.durationSec };
}

export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function snapshotStill(dataUrl) {
  const img = await loadImage(dataUrl);
  const w = Math.min(1280, img.naturalWidth || img.width);
  const h = Math.round(w * ((img.naturalHeight || img.height) / (img.naturalWidth || img.width)));
  return toDataURL(canvasFrom(img, w, h), 'image/jpeg', 0.9);
}

export async function cropPairToRatio(startUrl, endUrl, ratio = '16:9') {
  const parts = ratio.split(':').map(Number);
  const a = parts[0], b = parts[1];
  const s = await loadImage(startUrl);
  const e = await loadImage(endUrl);
  const crop = (img) => {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const target = a / b;
    let cw = iw, ch = ih;
    if (iw / ih > target) cw = Math.round(ih * target);
    else ch = Math.round(iw / target);
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    c.getContext('2d').drawImage(img, (iw - cw) / 2, (ih - ch) / 2, cw, ch, 0, 0, cw, ch);
    return c.toDataURL('image/jpeg', 0.9);
  };
  return { start: crop(s), end: crop(e), ratio };
}
