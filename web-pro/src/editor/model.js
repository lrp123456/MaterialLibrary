let counter = 0;
export function uid(prefix = 'id') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export const TRACK_TYPES = {
  video: { label: '视频', icon: '🎞', color: 'blue' },
  text: { label: '文字', icon: 'T', color: 'amber' },
  graphic: { label: '图形', icon: '◆', color: 'violet' },
  effect: { label: '效果', icon: '✦', color: 'cyan' },
  audio: { label: '音频', icon: '♪', color: 'emerald' },
};

export const CLIP_TYPE_TRACK = {
  video: 'video',
  image: 'video',
  text: 'text',
  sticker: 'graphic',
  graphic: 'graphic',
  effect: 'effect',
  audio: 'audio',
};

export function defaultTransform(overrides = {}) {
  return { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, ...overrides };
}

export function makeTrack(type, name, { isMain = false, elements = [] } = {}) {
  return {
    id: uid('track'),
    type,
    name: name || `${TRACK_TYPES[type]?.label || type}轨`,
    isMain,
    muted: false,
    hidden: false,
    locked: false,
    elements,
  };
}

export function makeClip(type, props = {}) {
  return {
    id: uid('clip'),
    type,
    name: props.name || type,
    start: 0,
    duration: 5,
    trimStart: 0,
    trimEnd: 5,
    speed: 1,
    maintainPitch: true,
    volume: 100,
    fadeIn: 0,
    fadeOut: 0,
    sourceAudioEnabled: type === 'video',
    hidden: false,
    transform: defaultTransform(),
    keyframes: {},
    masks: [],
    effects: [],
    ...props,
  };
}

export function activeScene(project) {
  if (!project) return null;
  return project.scenes.find((s) => s.id === project.activeSceneId) || project.scenes[0] || null;
}

export function sceneDuration(scene) {
  let max = 0;
  if (!scene) return 0;
  for (const track of scene.tracks || []) {
    for (const el of track.elements || []) {
      max = Math.max(max, Number(el.start || 0) + Number(el.duration || 0));
    }
  }
  return Number(max.toFixed(3));
}

export function projectDuration(project) {
  return sceneDuration(activeScene(project));
}

export function findTrack(scene, trackId) {
  return scene?.tracks?.find((t) => t.id === trackId) || null;
}

export function findClip(scene, trackId, clipId) {
  const track = findTrack(scene, trackId);
  return track?.elements?.find((c) => c.id === clipId) || null;
}

export function findClipLocation(project, clipId) {
  const scene = activeScene(project);
  if (!scene) return null;
  for (const track of scene.tracks) {
    const clip = track.elements.find((c) => c.id === clipId);
    if (clip) return { scene, track, clip };
  }
  return null;
}

export function visualTracks(scene) {
  return (scene?.tracks || []).filter((t) => t.type !== 'audio');
}

export function audioTracks(scene) {
  return (scene?.tracks || []).filter((t) => t.type === 'audio');
}

export function trackAccepts(track, clipType) {
  return TRACK_TYPE_MAP[clipType] === track.type;
}

const TRACK_TYPE_MAP = CLIP_TYPE_TRACK;

export function clipsAtTime(scene, time) {
  const result = [];
  for (const track of scene?.tracks || []) {
    for (const clip of track.elements) {
      if (time >= clip.start - 1e-6 && time < clip.start + clip.duration - 1e-6) {
        result.push({ track, clip });
      }
    }
  }
  return result;
}

export function normalizeProject(project) {
  if (!project) return project;
  project.canvas = project.canvas || { width: 1280, height: 720, background: '#0b1020' };
  project.fps = Number(project.fps) || 30;
  project.pixelsPerSecond = Number(project.pixelsPerSecond) || 100;
  project.playhead = Number(project.playhead) || 0;
  project.scenes = Array.isArray(project.scenes) ? project.scenes : [];
  if (!project.scenes.length) {
    project.scenes.push({
      id: 'scene-main', name: '主场景', isMain: true, bookmarks: [],
      tracks: [makeTrack('video', 'V1 主视频', { isMain: true }), makeTrack('audio', 'A1 音频')],
    });
  }
  if (!project.scenes.some((s) => s.id === project.activeSceneId)) project.activeSceneId = project.scenes[0].id;
  for (const scene of project.scenes) {
    scene.bookmarks = Array.isArray(scene.bookmarks) ? scene.bookmarks : [];
    scene.tracks = Array.isArray(scene.tracks) ? scene.tracks : [];
    for (const track of scene.tracks) {
      track.elements = Array.isArray(track.elements) ? track.elements : [];
      track.isMain = !!track.isMain;
      for (const clip of track.elements) {
        clip.transform = defaultTransform(clip.transform || {});
        clip.keyframes = clip.keyframes || {};
        clip.masks = Array.isArray(clip.masks) ? clip.masks : [];
        clip.effects = Array.isArray(clip.effects) ? clip.effects : [];
        clip.speed = Number(clip.speed) || 1;
        clip.volume = clip.volume == null ? 100 : Number(clip.volume);
        clip.trimStart = Number(clip.trimStart) || 0;
        clip.trimEnd = Number(clip.trimEnd) || (clip.trimStart + (Number(clip.duration) || 0) * clip.speed);
        clip.sourceAudioEnabled = clip.sourceAudioEnabled !== false;
        if (clip.maintainPitch == null) clip.maintainPitch = true;
      }
    }
  }
  project.media = Array.isArray(project.media) ? project.media : [];
  return project;
}

export function sourceTimeForClip(clip, projectTime) {
  const rel = Math.max(0, projectTime - clip.start);
  return Math.max(0, (Number(clip.trimStart) || 0) + rel * (Number(clip.speed) || 1));
}

export function clipSourceSpan(clip) {
  return Math.max(0, (Number(clip.duration) || 0) * (Number(clip.speed) || 1));
}

export function mediaById(project, mediaId) {
  return (project?.media || []).find((m) => m.id === mediaId) || null;
}

export function formatTimecode(sec, fps = 30) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const ff = Math.floor((s - Math.floor(s)) * fps);
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}

export function niceGridStep(pixelsPerSecond, minPx = 48) {
  const candidates = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  for (const c of candidates) if (c * pixelsPerSecond >= minPx) return c;
  return 60;
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
