import { activeScene, clamp, findClipLocation, mediaById } from './model.js';
import { resolveTransform } from './keyframes.js';
import { applyMaskToCanvas, drawMaskOutline } from './masks.js';

const imageCache = new Map();
const videoPool = new Map();
const audioBufferCache = new Map();

let sharedAudioContext = null;
export function getAudioContext() {
  if (!sharedAudioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedAudioContext = new Ctx({ sampleRate: 48000 });
  }
  if (sharedAudioContext.state === 'suspended') sharedAudioContext.resume().catch(() => {});
  return sharedAudioContext;
}

function withSession(url) {
  if (!url) return '';
  if (url.includes('token=')) return url;
  let token = '';
  try { token = localStorage.getItem('ml_token') || ''; } catch { token = ''; }
  if (!token) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
}
export function mediaUrl(project, mediaId) {
  return withSession(mediaById(project, mediaId)?.url || '');
}
export function mediaAudioUrl(project, mediaId) {
  return withSession(mediaById(project, mediaId)?.audioUrl || '');
}

export function ensureImage(url) {
  if (!url) return Promise.resolve(null);
  if (imageCache.has(url)) {
    const entry = imageCache.get(url);
    return entry.promise || Promise.resolve(entry.img);
  }
  const img = new Image();
  const entry = { img, promise: null };
  imageCache.set(url, entry);
  entry.promise = new Promise((resolve) => {
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  return entry.promise;
}

function ensureVideo(url) {
  if (!url) return Promise.resolve(null);
  if (videoPool.has(url)) {
    const entry = videoPool.get(url);
    return entry.promise || Promise.resolve(entry.video);
  }
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  const entry = { video, promise: null, ready: false };
  videoPool.set(url, entry);
  entry.promise = new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      entry.ready = ok;
      resolve(ok ? video : null);
    };
    video.addEventListener('loadeddata', () => finish(true), { once: true });
    video.addEventListener('canplay', () => finish(true), { once: true });
    video.addEventListener('error', () => finish(false), { once: true });
    setTimeout(() => finish(video.readyState >= 2), 6000);
    video.load();
  });
  return entry.promise;
}

async function seekVideo(video, time, awaitSeek, fps = 30) {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const target = clamp(time, 0, Math.max(0, duration - 0.001));
  // 阈值必须小于一帧，否则 30/60fps 导出会周期性复用上一帧。
  // 取 0.4 帧并留 4ms 余量，同时避免浮点抖动导致的无效 seek。
  const minDelta = Math.min(0.02, Math.max(0.004, 0.4 / Math.max(1, Number(fps) || 30)));
  if (Math.abs(video.currentTime - target) < minDelta && video.readyState >= 2) return;
  const p = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish);
    setTimeout(finish, 1400);
  });
  try { video.currentTime = target; } catch { /* ignore */ }
  if (awaitSeek) await p;
}

export async function getAudioBuffer(url) {
  url = withSession(url);
  if (!url) return null;
  if (audioBufferCache.has(url)) return audioBufferCache.get(url);
  const promise = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      const ctx = getAudioContext();
      return await ctx.decodeAudioData(data.slice(0));
    } catch {
      return null;
    }
  })();
  audioBufferCache.set(url, promise);
  return promise;
}

export function computeElementBox(project, clip, time) {
  const canvas = project.canvas;
  const media = clip.mediaId ? mediaById(project, clip.mediaId) : null;
  const tr = resolveTransform(clip, Math.max(0, time - clip.start));
  const scale = Math.max(1, Number(tr.scale) || 100) / 100;
  let baseW = canvas.width;
  let baseH = canvas.height;
  if (media && media.width && media.height) {
    const fit = Math.min(canvas.width / media.width, canvas.height / media.height);
    baseW = media.width * fit;
    baseH = media.height * fit;
  } else if (clip.type === 'sticker') {
    baseW = baseH = canvas.height * 0.28;
  } else if (clip.type === 'graphic') {
    baseW = baseH = Math.min(canvas.width, canvas.height) * 0.4;
  } else if (clip.type === 'text') {
    baseW = canvas.width * 0.9;
    baseH = (Number(clip.fontSize) || 48) * 2.2;
  }
  const w = Math.max(1, baseW * scale);
  const h = Math.max(1, baseH * scale);
  const cx = canvas.width / 2 + (Number(tr.x) || 0) / 100 * canvas.width;
  const cy = canvas.height / 2 + (Number(tr.y) || 0) / 100 * canvas.height;
  return { cx, cy, w, h, rotation: Number(tr.rotation) || 0, opacity: Number(tr.opacity) / 100 };
}

function drawText(ctx, clip, project, time) {
  const canvas = project.canvas;
  const tr = resolveTransform(clip, Math.max(0, time - clip.start));
  const fontSize = Number(clip.fontSize) || 48;
  const scale = Math.max(1, Number(tr.scale) || 100) / 100;
  ctx.save();
  ctx.translate(canvas.width / 2 + (tr.x / 100) * canvas.width, canvas.height / 2 + (tr.y / 100) * canvas.height);
  ctx.rotate((tr.rotation * Math.PI) / 180);
  ctx.globalAlpha = clamp(tr.opacity / 100, 0, 1);
  ctx.font = `${clip.fontWeight || 700} ${fontSize * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = clip.color || '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = Math.max(2, fontSize * 0.12);
  const text = String(clip.text || '');
  const maxWidth = canvas.width * 0.86;
  const lines = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else line = test;
  }
  if (line) lines.push(line);
  const lineHeight = fontSize * scale * 1.25;
  const total = (lines.length - 1) * lineHeight;
  lines.forEach((l, i) => ctx.fillText(l, 0, i * lineHeight - total / 2));
  ctx.restore();
}

function drawGraphicOnCanvas(ctx, clip, w, h) {
  const color = clip.color || '#22d3ee';
  const stroke = Number(clip.strokeWidth) || 8;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  const r = Math.min(w, h) * 0.38;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = stroke;
  switch (clip.graphic || 'ring') {
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.92, r * 0.72);
      ctx.lineTo(-r * 0.92, r * 0.72);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bar':
      ctx.fillRect(-r, -r * 0.16, r * 2, r * 0.32);
      break;
    case 'ring':
    default:
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

async function drawMediaClip(ctx, project, scene, time, clip, box, opts) {
  const track = scene.tracks.find((t) => t.elements.includes(clip));
  if (!track || track.hidden || clip.hidden) return false;
  const needsMedia = clip.type === 'video' || clip.type === 'image';
  const media = needsMedia && clip.mediaId ? mediaById(project, clip.mediaId) : null;
  if (needsMedia && (!media || !media.url)) return false;
  const scaleX = box.w;
  const scaleY = box.h;
  const pad = 2;
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.round(scaleX));
  layer.height = Math.max(1, Math.round(scaleY));
  const lctx = layer.getContext('2d');

  if (clip.type === 'video') {
    const video = await ensureVideo(media.url);
    if (!video || !video.videoWidth) return false;
    const sourceTime = (Number(clip.trimStart) || 0) + Math.max(0, time - clip.start) * (Number(clip.speed) || 1);
    const fps = Number(opts.fps) || 30;
    if (opts.playing) {
      if (Math.abs(video.currentTime - sourceTime) > 0.28) await seekVideo(video, sourceTime, false, fps);
      if (video.paused) { video.playbackRate = Number(clip.speed) || 1; video.play().catch(() => {}); }
      video.playbackRate = Number(clip.speed) || 1;
    } else {
      if (!video.paused) video.pause();
      await seekVideo(video, sourceTime, true, fps);
    }
    try { lctx.drawImage(video, 0, 0, layer.width, layer.height); } catch { return false; }
  } else if (clip.type === 'image') {
    const img = await ensureImage(media.url);
    if (!img) return false;
    lctx.drawImage(img, 0, 0, layer.width, layer.height);
  } else if (clip.type === 'sticker') {
    lctx.font = `${Math.round(layer.height * 0.78)}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';
    lctx.fillText(clip.sticker || '⭐', layer.width / 2, layer.height / 2);
  } else if (clip.type === 'graphic') {
    drawGraphicOnCanvas(lctx, clip, layer.width, layer.height);
  }

  for (const mask of clip.masks || []) applyMaskToCanvas(layer, mask);

  const blur = (clip.effects || []).filter((e) => e.type === 'blur').reduce((m, e) => Math.max(m, Number(e.amount) || 0), 0);
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate((box.rotation * Math.PI) / 180);
  ctx.globalAlpha = clamp(box.opacity, 0, 1);
  if (blur > 0.05) ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(layer, -box.w / 2 - pad, -box.h / 2 - pad, box.w + pad * 2, box.h + pad * 2);
  ctx.restore();
  return true;
}

export function createCompositor(canvas) {
  let token = 0;
  let lastMissing = [];

  async function render(project, time, opts = {}) {
    const myToken = ++token;
    const scene = opts.scene || activeScene(project);
    // 允许导出等场景传入独立画布，避免与预览争抢同一块画布与 token。
    const target = opts.canvas || canvas;
    const width = Math.max(1, Math.round(Number(project.canvas.width) || 1280));
    const height = Math.max(1, Math.round(Number(project.canvas.height) || 720));
    const ctx = target.getContext('2d');
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = project.canvas.background || '#0b1020';
    ctx.fillRect(0, 0, width, height);
    const missing = [];
    if (!scene) return { missing };

    const visual = scene.tracks.filter((t) => t.type !== 'audio' && t.type !== 'effect' && !t.hidden);
    // tracks 数组是从上到下显示：反向绘制（主轨先画，文字最后画）。
    const ordered = [...visual].reverse();
    for (const track of ordered) {
      for (const clip of track.elements) {
        if (time < clip.start - 1e-6 || time >= clip.start + clip.duration - 1e-6) continue;
        if (clip.type === 'text') {
          drawText(ctx, clip, project, time);
          continue;
        }
        const box = computeElementBox(project, clip, time);
        const drawn = await drawMediaClip(ctx, project, scene, time, clip, box, {
          playing: !!opts.playing, scene, fps: project.fps,
        });
        if (myToken !== token) return { missing, superseded: true };
        if (!drawn) missing.push(clip.id);
      }
    }

    // 效果轨：在全轨合成后对画面做模糊。
    let effectBlur = 0;
    for (const track of scene.tracks) {
      if (track.type !== 'effect' || track.hidden) continue;
      for (const clip of track.elements) {
        if (time >= clip.start - 1e-6 && time < clip.start + clip.duration - 1e-6) {
          effectBlur = Math.max(effectBlur, Number(clip.blur) || 0);
        }
      }
    }
    if (effectBlur > 0.05) {
      const snapshot = document.createElement('canvas');
      snapshot.width = width;
      snapshot.height = height;
      snapshot.getContext('2d').drawImage(target, 0, 0);
      ctx.save();
      ctx.filter = `blur(${effectBlur}px)`;
      ctx.drawImage(snapshot, 0, 0);
      ctx.restore();
    }

    lastMissing = missing;
    return { missing, scene };
  }

  function drawMaskOverlay(overlayCanvas, project, clip, mask) {
    if (!overlayCanvas || !clip || !mask) return;
    const scene = activeScene(project);
    const found = findClipLocation(project, clip.id);
    if (!found) return;
    overlayCanvas.width = project.canvas.width;
    overlayCanvas.height = project.canvas.height;
    const octx = overlayCanvas.getContext('2d');
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const box = computeElementBox(project, clip, project.playhead);
    octx.save();
    octx.translate(box.cx, box.cy);
    octx.rotate((box.rotation * Math.PI) / 180);
    octx.translate(-box.w / 2, -box.h / 2);
    drawMaskOutline(octx, mask, box.w, box.h, '#22d3ee');
    octx.restore();
  }

  return { render, drawMaskOverlay, getMissing: () => lastMissing };
}

export function resetMediaCaches() {
  imageCache.clear();
  for (const entry of videoPool.values()) {
    try {
      entry.video.pause();
      entry.video.removeAttribute('src');
      entry.video.load();
    } catch { /* 忽略已卸载的元素 */ }
  }
  videoPool.clear();
  audioBufferCache.clear();
}
