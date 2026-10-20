import { uid } from './model.js';

export const ANIMATABLE = [
  { key: 'positionX', label: '位置 X', unit: '%', min: -200, max: 200 },
  { key: 'positionY', label: '位置 Y', unit: '%', min: -200, max: 200 },
  { key: 'scale', label: '缩放', unit: '%', min: 1, max: 500 },
  { key: 'rotation', label: '旋转', unit: '°', min: -720, max: 720 },
  { key: 'opacity', label: '不透明度', unit: '%', min: 0, max: 100 },
];

export const TRANSFORM_PROP_MAP = {
  positionX: 'x',
  positionY: 'y',
  scale: 'scale',
  rotation: 'rotation',
  opacity: 'opacity',
};

function bezierPoint(p0, p1, p2, p3, u) {
  const mt = 1 - u;
  return mt * mt * mt * p0 + 3 * mt * mt * u * p1 + 3 * mt * u * u * p2 + u * u * u * p3;
}

function lerp(a, b, u) {
  return a + (b - a) * u;
}

function defaultHandles(a, b) {
  const span = Math.max(1e-9, b.time - a.time);
  return {
    out: a.outHandle || { dt: span / 3, dv: 0 },
    in: b.inHandle || { dt: -span / 3, dv: 0 },
  };
}

function solveU(a, b, t) {
  const { out, in: inn } = defaultHandles(a, b);
  const x0 = a.time;
  const x1 = a.time + out.dt;
  const x2 = b.time + inn.dt;
  const x3 = b.time;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 36; i += 1) {
    const mid = (lo + hi) / 2;
    if (bezierPoint(x0, x1, x2, x3, mid) < t) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function sortKeys(keys) {
  return [...(keys || [])].sort((a, b) => a.time - b.time);
}

export function evalKeys(keys, t) {
  const arr = sortKeys(keys);
  if (!arr.length) return null;
  if (t <= arr[0].time) return arr[0].value;
  if (t >= arr[arr.length - 1].time) return arr[arr.length - 1].value;
  const exact = arr.find((k) => Math.abs(k.time - t) < 1e-9);
  if (exact) return exact.value;
  let seg = 0;
  for (let i = 0; i < arr.length - 1; i += 1) {
    if (t >= arr[i].time && t <= arr[i + 1].time) { seg = i; break; }
  }
  const a = arr[seg];
  const b = arr[seg + 1];
  if (a.interpolation === 'hold') return a.value;
  const span = b.time - a.time;
  if (span <= 0) return b.value;
  if (a.interpolation === 'linear') return lerp(a.value, b.value, (t - a.time) / span);
  const { out, in: inn } = defaultHandles(a, b);
  const u = solveU(a, b, t);
  return bezierPoint(a.value, a.value + out.dv, b.value + inn.dv, b.value, u);
}

export function keyframeValue(clip, prop, relTime, fallback) {
  const keys = clip?.keyframes?.[prop];
  if (!keys || !keys.length) return fallback;
  const v = evalKeys(keys, relTime);
  return v == null ? fallback : v;
}

/** 片段在 relTime（相对片段起点）处的完整变换。 */
export function resolveTransform(clip, relTime) {
  const tr = clip.transform || {};
  return {
    x: keyframeValue(clip, 'positionX', relTime, tr.x ?? 0),
    y: keyframeValue(clip, 'positionY', relTime, tr.y ?? 0),
    scale: keyframeValue(clip, 'scale', relTime, tr.scale ?? 100),
    rotation: keyframeValue(clip, 'rotation', relTime, tr.rotation ?? 0),
    opacity: keyframeValue(clip, 'opacity', relTime, tr.opacity ?? 100),
  };
}

export function hasAnyKeyframes(clip) {
  return Object.values(clip?.keyframes || {}).some((keys) => Array.isArray(keys) && keys.length > 0);
}

export function keyframeAbsoluteTimes(scene) {
  const times = [];
  for (const track of scene?.tracks || []) {
    for (const clip of track.elements || []) {
      for (const keys of Object.values(clip.keyframes || {})) {
        for (const k of keys || []) times.push(clip.start + k.time);
      }
    }
  }
  return times;
}

/** 在时间/数值平面按 De Casteljau 精确切出 bezier 子曲线。 */
function splitBezierSegment(a, b, cut, evalValue) {
  const span = b.time - a.time;
  const out = a.outHandle || { dt: span / 3, dv: 0 };
  const inn = b.inHandle || { dt: -span / 3, dv: 0 };
  const P0 = { x: a.time, y: a.value };
  const P1 = { x: a.time + out.dt, y: a.value + out.dv };
  const P2 = { x: b.time + inn.dt, y: b.value + inn.dv };
  const P3 = { x: b.time, y: b.value };
  const u = solveU(a, b, cut);
  const L = (p, q) => ({ x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u) });
  const P01 = L(P0, P1);
  const P12 = L(P1, P2);
  const P23 = L(P2, P3);
  const P012 = L(P01, P12);
  const P123 = L(P12, P23);
  const C = L(P012, P123);
  return {
    boundaryValue: evalValue,
    leftControl: { dt: P012.x - P0.x, dv: P012.y - P0.y },
    rightOut: { dt: P123.x - C.x, dv: P123.y - C.y },
    rightNextIn: { dt: P23.x - P3.x, dv: P23.y - P3.y },
  };
}

export function splitKeysAt(keys, cut) {
  if (!keys || !keys.length) return { left: [], right: [] };
  const arr = sortKeys(keys);
  const eps = 1e-7;
  const value = evalKeys(arr, cut);
  const left = arr.filter((k) => k.time <= cut + eps).map((k) => ({ ...k }));
  const right = arr.filter((k) => k.time >= cut - eps).map((k) => ({ ...k, time: Math.max(0, k.time - cut) }));

  const exact = arr.find((k) => Math.abs(k.time - cut) < eps);
  if (!exact) {
    const prevIdx = arr.findIndex((k, i) => i < arr.length - 1 && cut > k.time && cut < arr[i + 1].time);
    let boundary = { id: uid('kf'), time: cut, value, interpolation: 'linear' };
    if (prevIdx >= 0) {
      const a = arr[prevIdx];
      const b = arr[prevIdx + 1];
      const interp = a.interpolation || 'linear';
      boundary.interpolation = interp;
      if (interp === 'bezier') {
        const sub = splitBezierSegment(a, b, cut, value);
        boundary.value = sub.boundaryValue;
        boundary.outHandle = { dt: 0, dv: 0 };
        const lastLeft = left[left.length - 1];
        if (lastLeft) lastLeft.outHandle = sub.leftControl;
        const rightBoundary = {
          id: uid('kf'), time: 0, value: sub.boundaryValue, interpolation: 'bezier',
          outHandle: sub.rightOut,
        };
        const nextRight = right.find((k) => Math.abs(k.time - (b.time - cut)) < 1e-6);
        if (nextRight) nextRight.inHandle = sub.rightNextIn;
        left.push(boundary);
        right.unshift(rightBoundary);
        return { left: sortKeys(left), right: sortKeys(right) };
      }
    }
    left.push(boundary);
    right.unshift({ id: uid('kf'), time: 0, value, interpolation: boundary.interpolation });
  } else if (cut <= eps) {
    // 切点正好在首键：右侧从 0 开始，保留原键。
  }
  return { left: sortKeys(left), right: sortKeys(right) };
}

export function splitClipKeyframes(clip, relCut) {
  const left = {};
  const right = {};
  for (const [prop, keys] of Object.entries(clip.keyframes || {})) {
    const r = splitKeysAt(keys, relCut);
    if (r.left.length) left[prop] = r.left;
    if (r.right.length) right[prop] = r.right;
  }
  return { left, right };
}

export function setKeyframe(clip, prop, time, value, interpolation = 'bezier') {
  if (!clip.keyframes) clip.keyframes = {};
  const keys = sortKeys(clip.keyframes[prop] || []);
  const t = Math.max(0, Number(time));
  const existing = keys.find((k) => Math.abs(k.time - t) < 0.001);
  if (existing) {
    existing.value = Number(value);
    existing.interpolation = interpolation;
    existing.outHandle = undefined;
    existing.inHandle = undefined;
  } else {
    keys.push({ id: uid('kf'), time: t, value: Number(value), interpolation });
    keys.sort((a, b) => a.time - b.time);
  }
  clip.keyframes[prop] = keys;
}

export function removeKeyframe(clip, prop, keyId) {
  if (!clip.keyframes?.[prop]) return;
  clip.keyframes[prop] = clip.keyframes[prop].filter((k) => k.id !== keyId);
  if (!clip.keyframes[prop].length) delete clip.keyframes[prop];
}

export function setKeyframeInterpolation(clip, prop, keyId, interpolation) {
  const key = clip.keyframes?.[prop]?.find((k) => k.id === keyId);
  if (!key) return;
  key.interpolation = interpolation;
  key.outHandle = undefined;
  key.inHandle = undefined;
}

export function cloneSelectedKeyframes(clip, selection) {
  const out = [];
  for (const sel of selection) {
    const key = clip.keyframes?.[sel.prop]?.find((k) => k.id === sel.keyId);
    if (key) out.push({ prop: sel.prop, ...JSON.parse(JSON.stringify(key)) });
  }
  return out;
}

export function pasteKeyframes(clip, copied) {
  if (!copied?.length) return 0;
  if (!clip.keyframes) clip.keyframes = {};
  let count = 0;
  for (const item of copied) {
    const { prop, ...keyData } = item;
    const time = Math.min(clip.duration, Math.max(0, keyData.time));
    clip.keyframes[prop] = clip.keyframes[prop] || [];
    const exists = clip.keyframes[prop].find((k) => Math.abs(k.time - time) < 0.001);
    if (exists) {
      exists.value = keyData.value;
      exists.interpolation = keyData.interpolation;
    } else {
      clip.keyframes[prop].push({ ...keyData, id: uid('kf'), time });
    }
    clip.keyframes[prop].sort((a, b) => a.time - b.time);
    count += 1;
  }
  return count;
}

export function applyTransformToClip(clip, prop, value) {
  const trProp = TRANSFORM_PROP_MAP[prop];
  if (!trProp) return;
  if (!clip.transform) clip.transform = {};
  clip.transform[trProp] = Number(value);
}
