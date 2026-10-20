import { niceGridStep } from './model.js';

export const SNAP_PX = 9;

export const SNAP_PRIORITY = {
  playhead: 1,
  edge: 2,
  bookmark: 3,
  keyframe: 4,
  grid: 5,
};

export function snapThresholdSeconds(pixelsPerSecond) {
  return SNAP_PX / Math.max(1, Number(pixelsPerSecond) || 1);
}

/**
 * 生成靶标。priority 越小越优先。
 * 拖拽片段时同时尝试片段左右两个边缘；修剪时只尝试被拖边缘。
 */
export function buildSnapTargets({
  scene,
  playhead,
  excludeClipId,
  pps,
  clipDuration = 0,
  edgeOnly = null,
  maxTime = null,
}) {
  const targets = [];
  const add = (time, type, priority, meta = {}) => {
    if (!Number.isFinite(time)) return;
    targets.push({ time, type, priority, ...meta });
  };

  // 1. 播放头
  add(playhead, 'playhead', SNAP_PRIORITY.playhead);

  // 2. 片段入/出点
  for (const track of scene?.tracks || []) {
    for (const clip of track.elements || []) {
      if (clip.id === excludeClipId) continue;
      add(clip.start, 'element-start', SNAP_PRIORITY.edge, { clipId: clip.id });
      add(clip.start + clip.duration, 'element-end', SNAP_PRIORITY.edge, { clipId: clip.id });
    }
  }

  // 3. 书签 / 标记
  for (const bm of scene?.bookmarks || []) add(bm.time, 'bookmark', SNAP_PRIORITY.bookmark, { id: bm.id });

  // 4. 邻近关键帧
  for (const track of scene?.tracks || []) {
    for (const clip of track.elements || []) {
      if (clip.id === excludeClipId) continue;
      for (const keys of Object.values(clip.keyframes || {})) {
        for (const k of keys || []) add(clip.start + k.time, 'keyframe', SNAP_PRIORITY.keyframe, { clipId: clip.id });
      }
    }
  }

  // 5. 刻度网格
  const step = niceGridStep(pps, 40);
  let sceneEnd = playhead + clipDuration;
  for (const track of scene?.tracks || []) {
    for (const clip of track.elements || []) sceneEnd = Math.max(sceneEnd, clip.start + clip.duration);
  }
  for (const bm of scene?.bookmarks || []) sceneEnd = Math.max(sceneEnd, bm.time);
  const max = Math.max(30, Number(maxTime) || 0, sceneEnd + 20);
  for (let t = 0; t <= max; t += step) add(Number(t.toFixed(6)), 'grid', SNAP_PRIORITY.grid);

  return { targets, edgeOnly };
}

/**
 * 在候选开始时间里选吸附。edges: 片段相对自身起点的边缘偏移（0 和 duration）。
 * 返回 { start, guideTime, type, priority, distancePx } 或 null。
 */
export function resolveSnap({ start, duration, targets, pps, edgeOnly = null }) {
  const threshold = snapThresholdSeconds(pps);
  const offsets = edgeOnly === 'left' ? [0] : edgeOnly === 'right' ? [duration] : [0, duration];
  let best = null;
  for (const target of targets) {
    for (const offset of offsets) {
      const candidateStart = target.time - offset;
      const distance = Math.abs(candidateStart - start);
      if (distance > threshold) continue;
      if (
        !best
        || target.priority < best.priority
        || (target.priority === best.priority && distance < best.distance)
      ) {
        best = {
          start: candidateStart,
          guideTime: target.time,
          type: target.type,
          priority: target.priority,
          distance,
          distancePx: distance * pps,
        };
      }
    }
  }
  return best;
}

export function snapLabel(type) {
  return {
    playhead: '播放头',
    'element-start': '片段入点',
    'element-end': '片段出点',
    bookmark: '书签',
    keyframe: '关键帧',
    grid: '刻度',
  }[type] || type;
}
