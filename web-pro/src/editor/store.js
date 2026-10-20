import { computed, reactive, watch } from 'vue';
import {
  activeScene, audioTracks, clamp, findClip, findClipLocation, findTrack,
  makeClip, makeTrack, mediaById, normalizeProject, projectDuration, sceneDuration,
  sourceTimeForClip, trackAccepts, uid, visualTracks, defaultTransform,
} from './model.js';
import {
  cloneSelectedKeyframes, evalKeys, keyframeValue, pasteKeyframes, removeKeyframe,
  resolveTransform, setKeyframe, setKeyframeInterpolation, splitClipKeyframes,
  TRANSFORM_PROP_MAP,
} from './keyframes.js';
import { makeMask } from './masks.js';
import { buildSnapTargets, resolveSnap } from './snapping.js';
import { AudioPreview } from './audio.js';
import { createCompositor, getAudioContext, mediaUrl, resetMediaCaches } from './compositor.js';

function authHeaders(extra) {
  const headers = { ...(extra || {}) };
  try {
    const token = localStorage.getItem('ml_token') || '';
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* 无本地会话时由服务端拒绝 */ }
  return headers;
}
// 服务端错误体是 JSON，直接把原文塞进 Error.message 会把整段 JSON 弹给用户。
// 这里解析出可读文案，并保留 status / conflict / rev 供上层区分"冲突"与"普通失败"。
async function fail(res) {
  const text = await res.text().catch(() => '');
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* 非 JSON 错误体 */ }
  const err = new Error((payload && payload.error) || text || `HTTP ${res.status}`);
  err.status = res.status;
  if (payload && payload.conflict) {
    err.conflict = true;
    err.rev = payload.rev;
  }
  return err;
}
const api = {
  async get(path) {
    const res = await fetch(path, { headers: authHeaders({ Accept: 'application/json' }) });
    if (!res.ok) throw await fail(res);
    return res.json();
  },
  async send(path, method, body, extraHeaders) {
    const res = await fetch(path, {
      method,
      headers: authHeaders({ 'Content-Type': 'application/json', ...(extraHeaders || {}) }),
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await fail(res);
    return res.json();
  },
  async raw(path, body, type) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': type }, body });
    if (!res.ok) throw await fail(res);
    return res.json();
  },
};

export const state = reactive({
  view: 'projects',
  loading: true,
  projects: [],
  serverMedia: [],
  project: null,
  saveState: 'saved',
  saveError: '',
  conflictRev: null,
  message: '',
  messageKind: 'info',
  selectedTrackId: null,
  selectedClipId: null,
  selectedGap: null,
  currentTime: 0,
  playing: false,
  snapping: true,
  shiftDown: false,
  activeMaskId: null,
  maskEditMode: false,
  selectedKeyframes: [],
  clipboardKeyframes: [],
  selectedMediaTab: 'media',
  showExportModal: false,
  exporting: false,
  exportProgress: 0,
  exportStage: '',
  exportResult: null,
  exportError: '',
  cancelExport: false,
  missingClipIds: [],
  inspectorTab: 'props',
  showTrackMenu: false,
  contextMenu: null,
  historyLabel: '',
  canUndo: false,
  canRedo: false,
  lastSavedAt: 0,
  dragState: null,
  snapGuide: null,
  overlayCanvas: null,
});

const scene = computed(() => activeScene(state.project));
export { scene };
export const duration = computed(() => (state.project ? sceneDuration(scene.value) : 0));
export const selectedTrack = computed(() => (state.project ? findTrack(scene.value, state.selectedTrackId) : null));
export const selectedClip = computed(() => {
  if (!state.project) return null;
  if (state.selectedClipId) {
    const found = findClipLocation(state.project, state.selectedClipId);
    if (found) return found.clip;
  }
  return null;
});
export const selectedClipTrack = computed(() => {
  if (!state.project || !state.selectedClipId) return null;
  const found = findClipLocation(state.project, state.selectedClipId);
  return found?.track || null;
});
export const selectedMask = computed(() => {
  const clip = selectedClip.value;
  if (!clip || !state.activeMaskId) return null;
  return (clip.masks || []).find((m) => m.id === state.activeMaskId) || null;
});
export const activeBookmarks = computed(() => scene.value?.bookmarks || []);
export const gridStep = computed(() => 1);

let undoStack = [];
let redoStack = [];
let saveTimer = null;
let messageTimer = null;
let saveInFlight = false;
let saveQueued = false;
// 乐观锁基线。刻意放在响应式对象之外：project 上有 deep watcher，
// 把 rev 写进 project 会触发自动保存，保存又改 rev —— 死循环。
let projectRev = 0;
let savePromise = null;
let compositor = null;
let canvasEl = null;
let previewQueued = false;
let audioPreview = new AudioPreview();

// ---------- messaging ----------
export function notify(message, kind = 'info') {
  state.message = message;
  state.messageKind = kind;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { state.message = ''; }, 4200);
}

// ---------- history ----------
function snapshotStore() {
  if (!state.project) return null;
  return JSON.stringify({
    scenes: state.project.scenes,
    activeSceneId: state.project.activeSceneId,
  });
}

export function pushHistory(label = '编辑') {
  if (!state.project) return;
  undoStack.push(snapshotStore());
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  state.historyLabel = label;
  state.canUndo = undoStack.length > 0;
  state.canRedo = false;
  scheduleSave();
}

function restoreSnapshot(raw) {
  if (!raw || !state.project) return;
  const data = JSON.parse(raw);
  state.project.scenes = data.scenes;
  state.project.activeSceneId = data.activeSceneId;
  if (!state.project.scenes.some((s) => s.id === state.project.activeSceneId)) {
    state.project.activeSceneId = state.project.scenes[0]?.id;
  }
  if (state.selectedClipId && !findClipLocation(state.project, state.selectedClipId)) {
    state.selectedClipId = null;
    state.selectedTrackId = null;
    state.activeMaskId = null;
  }
  if (state.selectedGap && !findTrack(scene.value, state.selectedGap.trackId)) state.selectedGap = null;
  state.selectedKeyframes = [];
  scheduleSave();
  requestPreviewRender();
}

export function undo() {
  if (!undoStack.length) {
    notify('没有可撤销的操作', 'warn');
    return;
  }
  redoStack.push(snapshotStore());
  const prev = undoStack.pop();
  state.canUndo = undoStack.length > 0;
  state.canRedo = true;
  restoreSnapshot(prev);
  notify('已撤销', 'ok');
}

export function redo() {
  if (!redoStack.length) {
    notify('没有可重做的操作', 'warn');
    return;
  }
  undoStack.push(snapshotStore());
  const next = redoStack.pop();
  state.canUndo = true;
  state.canRedo = redoStack.length > 0;
  restoreSnapshot(next);
  notify('已重做', 'ok');
}

// ---------- persistence ----------
export function scheduleSave() {
  if (!state.project || state.loading) return;
  // 冲突未解决时继续自动保存只会反复 409，且可能覆盖别人的修改。
  if (state.saveState === 'conflict') return;
  state.saveState = 'saving';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveNow().catch(() => {}); }, 550);
}

export async function saveNow() {
  if (!state.project) return;
  // 在途时返回同一个 Promise，而不是立即 resolve。
  // 否则导出前的 await saveNow() 会在什么都没写的情况下返回，服务端读到旧工程。
  if (saveInFlight) {
    saveQueued = true;
    return savePromise;
  }
  if (state.saveState === 'conflict') {
    throw new Error('工程已在其它窗口被修改，请先处理冲突');
  }
  saveInFlight = true;
  state.saveState = 'saving';
  state.saveError = '';
  savePromise = (async () => {
    do {
      saveQueued = false;
      const rev = projectRev;
      const payload = { name: state.project.name, data: state.project, rev };
      const res = await api.send(
        `/editor-api/projects/${encodeURIComponent(state.project.id)}`,
        'PUT',
        payload,
        rev ? { 'If-Match': String(rev) } : undefined,
      );
      // 服务端返回新版本号，下一次保存以它为基线，否则第二次保存必然 409。
      projectRev = Number(res && res.rev) || rev + 1;
      state.lastSavedAt = Date.now();
    } while (saveQueued && state.project);
    state.saveState = 'saved';
  })()
    .catch((e) => {
      if (e && e.conflict) {
        // 不覆盖别人的成果：停在冲突态，把决定权交回用户。
        state.saveState = 'conflict';
        state.saveError = e.message || '工程已在其它窗口被修改';
        state.conflictRev = Number(e.rev) || null;
      } else {
        state.saveState = 'error';
        state.saveError = e.message || String(e);
      }
      throw e;
    })
    .finally(() => {
      saveInFlight = false;
      savePromise = null;
    });
  return savePromise;
}

/** 冲突后由用户选择"放弃本地改动并重载"。 */
export async function reloadAfterConflict() {
  if (!state.project) return;
  const id = state.project.id;
  state.saveState = 'saved';
  state.saveError = '';
  state.conflictRev = null;
  await openProject(id);
}

export function flushSave() {
  if (!state.project) return;
  if (state.saveState === 'conflict') return;
  const rev = projectRev;
  const payload = JSON.stringify({ name: state.project.name, data: state.project, rev });
  // 浏览器对 keepalive 请求体上限约 64 KiB，超限会被静默丢弃。
  // 大工程退化为普通请求，并留下未保存标记，下次打开时提示。
  const keepalive = payload.length <= 60000;
  try {
    fetch(`/editor-api/projects/${encodeURIComponent(state.project.id)}`, {
      method: 'PUT',
      headers: authHeaders({
        'Content-Type': 'application/json',
        ...(rev ? { 'If-Match': String(rev) } : {}),
      }),
      body: payload,
      keepalive,
    }).catch(() => {});
    if (!keepalive) {
      try { localStorage.setItem('ml_editor_unsaved', state.project.id); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

let previewAfterEdit = null;
watch(() => state.project, () => {
  if (!state.project) return;
  scheduleSave();
  if (!state.playing) {
    clearTimeout(previewAfterEdit);
    previewAfterEdit = setTimeout(() => requestPreviewRender(), 60);
  }
}, { deep: true });

// ---------- project list ----------
export async function loadProjects() {
  state.loading = true;
  try {
    const [projects, media] = await Promise.all([api.get('/editor-api/projects'), api.get('/editor-api/media')]);
    state.projects = projects.items || [];
    state.serverMedia = media.items || [];
  } catch (e) {
    notify(`读取工程失败：${e.message}`, 'error');
  } finally {
    state.loading = false;
  }
}

function mergeMedia(projectMedia, serverMedia) {
  const map = new Map();
  for (const m of [...(projectMedia || []), ...(serverMedia || [])]) map.set(m.id, m);
  return [...map.values()];
}

export async function createProject(payload) {
  const body = {
    name: payload.name || '未命名工程',
    canvas: payload.canvas || { width: 1280, height: 720, background: '#0b1020' },
    fps: payload.fps || 30,
  };
  const res = await api.send('/editor-api/projects', 'POST', body);
  await loadProjects();
  await openProject(res.project.id);
  notify('工程已创建', 'ok');
}

export async function openProject(id) {
  try {
    state.loading = true;
    const res = await api.get(`/editor-api/projects/${encodeURIComponent(id)}`);
    const project = normalizeProject(res.project.data);
    project.id = res.project.id;
    project.name = project.name || res.project.name;
    // rev 是乐观锁基线：丢了这个值，保存就会退化成"盲写覆盖"。
    projectRev = Number(res.project.rev) || 1;
    project.media = mergeMedia(project.media, state.serverMedia);
    state.project = project;
    state.view = 'editor';
    state.saveState = 'saved';
    state.saveError = '';
    state.conflictRev = null;
    state.currentTime = Number(project.playhead) || 0;
    state.selectedClipId = null;
    state.selectedTrackId = project.scenes.find((s) => s.isMain)?.tracks.find((t) => t.isMain)?.id || null;
    state.selectedGap = null;
    state.selectedKeyframes = [];
    state.activeMaskId = null;
    state.playing = false;
    state.canUndo = false;
    state.canRedo = false;
    state.exportResult = null;
    undoStack = [];
    redoStack = [];
    resetMediaCaches();
    requestPreviewRender();
  } catch (e) {
    notify(`打开工程失败：${e.message}`, 'error');
  } finally {
    state.loading = false;
  }
}

export function closeProject() {
  flushSave();
  stopPlayback();
  state.project = null;
  state.view = 'projects';
  state.selectedClipId = null;
  state.selectedTrackId = null;
  state.playing = false;
  loadProjects();
}

export async function renameProject(id, name) {
  const item = state.projects.find((p) => p.id === id);
  if (!item) return;
  // 正在编辑的工程走自己的保存链路。原来这里会把"服务端读到的那份 data"再写回去，
  // 直接覆盖掉编辑器里尚未保存的改动。
  if (state.project && state.project.id === id) {
    state.project.name = name;
    try {
      await saveNow();
      await loadProjects();
      notify('工程已改名', 'ok');
    } catch (e) {
      notify(`改名失败：${e.message}`, 'error');
    }
    return;
  }
  try {
    const res = await api.get(`/editor-api/projects/${encodeURIComponent(id)}`);
    const data = res.project.data;
    data.name = name;
    const rev = Number(res.project.rev) || 0;
    await api.send(
      `/editor-api/projects/${encodeURIComponent(id)}`,
      'PUT',
      { name, data, rev },
      rev ? { 'If-Match': String(rev) } : undefined,
    );
    await loadProjects();
    notify('工程已改名', 'ok');
  } catch (e) {
    notify(`改名失败：${e.message}`, 'error');
  }
}

export async function deleteProject(id) {
  try {
    await api.send(`/editor-api/projects/${encodeURIComponent(id)}`, 'DELETE');
    if (state.project && state.project.id === id) closeProject();
    await loadProjects();
    notify('工程已删除', 'ok');
  } catch (e) {
    notify(`删除失败：${e.message}`, 'error');
  }
}

// ---------- scenes / bookmarks ----------
export function switchScene(sceneId) {
  if (!state.project) return;
  flushSave();
  state.project.activeSceneId = sceneId;
  state.selectedClipId = null;
  state.selectedGap = null;
  state.activeMaskId = null;
  // 场景切换保留播放头位置（工程级偏好），不强制归零。
  scheduleSave();
  requestPreviewRender();
}

export function addScene() {
  if (!state.project) return;
  pushHistory('新增场景');
  const s = {
    id: uid('scene'),
    name: `场景 ${state.project.scenes.length + 1}`,
    isMain: false,
    bookmarks: [],
    tracks: [
      makeTrack('video', 'V1 主视频', { isMain: true }),
      makeTrack('audio', 'A1 音频'),
    ],
  };
  state.project.scenes.push(s);
  state.project.activeSceneId = s.id;
  state.currentTime = 0;
  scheduleSave();
  notify(`已新增 ${s.name}`, 'ok');
}

export function renameScene(sceneId, name) {
  const s = state.project?.scenes.find((x) => x.id === sceneId);
  if (!s) return;
  s.name = name;
  scheduleSave();
}

export function deleteScene(sceneId) {
  if (!state.project) return;
  const s = state.project.scenes.find((x) => x.id === sceneId);
  if (!s) return;
  if (s.isMain) { notify('主场景不能删除', 'warn'); return; }
  pushHistory('删除场景');
  state.project.scenes = state.project.scenes.filter((x) => x.id !== sceneId);
  if (state.project.activeSceneId === sceneId) {
    state.project.activeSceneId = state.project.scenes.find((x) => x.isMain)?.id || state.project.scenes[0]?.id;
  }
  if (!state.project.scenes.length) addScene();
  scheduleSave();
}

export function addBookmark() {
  if (!state.project) return;
  const s = scene.value;
  const time = Number(state.currentTime.toFixed(3));
  const existing = s.bookmarks.find((b) => Math.abs(b.time - time) < 0.02);
  if (existing) {
    s.bookmarks = s.bookmarks.filter((b) => b.id !== existing.id);
    notify('已删除该位置书签');
  } else {
    s.bookmarks.push({ id: uid('bm'), time, note: '', color: ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399'][s.bookmarks.length % 4] });
    notify(`已在 ${time.toFixed(2)}s 添加书签`, 'ok');
  }
  s.bookmarks.sort((a, b) => a.time - b.time);
  scheduleSave();
}

export function removeBookmark(id) {
  if (!scene.value) return;
  scene.value.bookmarks = scene.value.bookmarks.filter((b) => b.id !== id);
  scheduleSave();
}

export function renameBookmark(id, note) {
  const b = scene.value?.bookmarks.find((x) => x.id === id);
  if (b) { b.note = note; scheduleSave(); }
}

// ---------- tracks ----------
export function addTrack(type) {
  if (!state.project) return;
  pushHistory('新增轨道');
  const counts = scene.value.tracks.filter((t) => t.type === type).length;
  const labels = { video: 'V', text: 'T', graphic: 'G', effect: 'FX', audio: 'A' };
  const name = `${labels[type] || 'T'}${counts + 1} ${type === 'video' ? '叠加' : type === 'text' ? '文字' : type === 'graphic' ? '图形' : type === 'effect' ? '效果' : '音频'}`;
  const track = makeTrack(type, name);
  // 新叠加视频轨放在主视频轨上方；其它放在同类轨附近
  if (type === 'video') {
    const mainIdx = scene.value.tracks.findIndex((t) => t.type === 'video');
    scene.value.tracks.splice(Math.max(0, mainIdx), 0, track);
  } else if (type === 'audio') {
    scene.value.tracks.push(track);
  } else {
    const firstNonAudio = scene.value.tracks.findIndex((t) => t.type !== 'audio');
    scene.value.tracks.splice(firstNonAudio < 0 ? 0 : firstNonAudio, 0, track);
  }
  state.selectedTrackId = track.id;
  scheduleSave();
  notify(`已新增 ${name}`, 'ok');
}

export function deleteTrack(trackId) {
  const track = findTrack(scene.value, trackId);
  if (!track) return;
  if (track.isMain) { notify('主视频轨不能删除', 'warn'); return; }
  pushHistory('删除轨道');
  scene.value.tracks = scene.value.tracks.filter((t) => t.id !== trackId);
  if (state.selectedTrackId === trackId) state.selectedTrackId = null;
  if (selectedClipTrack.value?.id === trackId) { state.selectedClipId = null; state.selectedTrackId = null; }
  scheduleSave();
  requestPreviewRender();
}

export function toggleTrack(trackId, key) {
  const track = findTrack(scene.value, trackId);
  if (!track) return;
  pushHistory(key === 'locked' ? '锁定轨道' : key === 'muted' ? '静音轨道' : '隐藏轨道');
  track[key] = !track[key];
  scheduleSave();
  requestPreviewRender();
}

export function renameTrack(trackId, name) {
  const track = findTrack(scene.value, trackId);
  if (!track) return;
  track.name = name;
  scheduleSave();
}

// ---------- clips ----------
export function selectClip(trackId, clipId) {
  state.selectedClipId = clipId;
  state.selectedTrackId = trackId;
  state.selectedGap = null;
  state.selectedKeyframes = [];
  state.activeMaskId = null;
  state.maskEditMode = false;
}

export function clearSelection() {
  state.selectedClipId = null;
  state.selectedGap = null;
  state.selectedKeyframes = [];
  state.activeMaskId = null;
  state.maskEditMode = false;
}

export function selectGap(gap) {
  state.selectedGap = gap;
  state.selectedClipId = null;
  state.activeMaskId = null;
  state.selectedKeyframes = [];
}

function findOrCreateTrack(clipType) {
  const wanted = { video: 'video', image: 'video', audio: 'audio', text: 'text', sticker: 'graphic', graphic: 'graphic', effect: 'effect' }[clipType];
  const selected = findTrack(scene.value, state.selectedTrackId);
  if (selected && selected.type === wanted) return selected;
  if (wanted === 'video') {
    const main = scene.value.tracks.find((t) => t.type === 'video' && t.isMain);
    if (main) return main;
  }
  const first = scene.value.tracks.find((t) => t.type === wanted);
  if (first) return first;
  const created = makeTrack(wanted, undefined);
  scene.value.tracks.push(created);
  return created;
}

export function addMediaClip(media, trackId = null) {
  if (!state.project || !media) return;
  pushHistory('添加素材');
  let track = trackId ? findTrack(scene.value, trackId) : null;
  const clipType = media.type === 'audio' ? 'audio' : media.type === 'image' ? 'image' : 'video';
  if (!track || !trackAccepts(track, clipType)) track = findOrCreateTrack(clipType);
  const isImage = media.type === 'image';
  const durationVal = isImage ? 5 : Math.max(0.2, Number(media.duration) || 5);
  const clip = makeClip(clipType, {
    mediaId: media.id,
    name: media.name,
    start: Number(state.currentTime.toFixed(3)),
    duration: Number(durationVal.toFixed(3)),
    trimStart: 0,
    trimEnd: Number((durationVal * (media.type === 'audio' ? 1 : 1)).toFixed(3)),
    sourceAudioEnabled: media.type === 'video',
    volume: media.type === 'audio' ? 100 : 100,
  });
  if (isImage) clip.trimEnd = clip.duration;
  track.elements.push(clip);
  state.selectedClipId = clip.id;
  state.selectedTrackId = track.id;
  state.selectedGap = null;
  scheduleSave();
  requestPreviewRender();
  notify(`已添加 ${clip.name}`, 'ok');
}

export function addTextClip(text = '双击检查器修改文字', opts = {}) {
  if (!state.project) return;
  pushHistory('添加文字');
  let track = findTrack(scene.value, state.selectedTrackId);
  if (!track || track.type !== 'text') track = scene.value.tracks.find((t) => t.type === 'text') || findOrCreateTrack('text');
  const clip = makeClip('text', {
    name: opts.name || '文字',
    start: Number(state.currentTime.toFixed(3)),
    duration: 4,
    trimEnd: 4,
    text,
    fontSize: opts.fontSize || 56,
    color: opts.color || '#ffffff',
    fontWeight: opts.fontWeight || 700,
    transform: defaultTransform({ y: opts.y ?? 0 }),
  });
  track.elements.push(clip);
  state.selectedClipId = clip.id;
  state.selectedTrackId = track.id;
  scheduleSave();
  requestPreviewRender();
}

export function addStickerClip(sticker = '⭐') {
  if (!state.project) return;
  pushHistory('添加贴纸');
  let track = findTrack(scene.value, state.selectedTrackId);
  if (!track || track.type !== 'graphic') track = scene.value.tracks.find((t) => t.type === 'graphic') || findOrCreateTrack('sticker');
  const clip = makeClip('sticker', {
    name: `贴纸 ${sticker}`,
    start: Number(state.currentTime.toFixed(3)),
    duration: 3,
    trimEnd: 3,
    sticker,
    transform: defaultTransform({ scale: 100 }),
  });
  track.elements.push(clip);
  state.selectedClipId = clip.id;
  state.selectedTrackId = track.id;
  scheduleSave();
  requestPreviewRender();
}

export function addGraphicClip(kind = 'ring') {
  if (!state.project) return;
  pushHistory('添加图形');
  let track = findTrack(scene.value, state.selectedTrackId);
  if (!track || track.type !== 'graphic') track = scene.value.tracks.find((t) => t.type === 'graphic') || findOrCreateTrack('graphic');
  const labels = { ring: '圆环', circle: '圆形', triangle: '三角', bar: '线条' };
  const clip = makeClip('graphic', {
    name: `图形 ${labels[kind] || kind}`,
    start: Number(state.currentTime.toFixed(3)),
    duration: 3,
    trimEnd: 3,
    graphic: kind,
    color: '#22d3ee',
    strokeWidth: 8,
    transform: defaultTransform(),
  });
  track.elements.push(clip);
  state.selectedClipId = clip.id;
  state.selectedTrackId = track.id;
  scheduleSave();
  requestPreviewRender();
}

export function addEffectClip(amount = 8) {
  if (!state.project) return;
  pushHistory('添加效果');
  let track = findTrack(scene.value, state.selectedTrackId);
  if (!track || track.type !== 'effect') track = scene.value.tracks.find((t) => t.type === 'effect') || findOrCreateTrack('effect');
  const clip = makeClip('effect', {
    name: '模糊效果',
    start: Number(state.currentTime.toFixed(3)),
    duration: 2,
    trimEnd: 2,
    blur: amount,
  });
  track.elements.push(clip);
  state.selectedClipId = clip.id;
  state.selectedTrackId = track.id;
  scheduleSave();
  requestPreviewRender();
}

export function addAudioClip(media) {
  addMediaClip(media);
}

// ---------- split ----------
function splitOne(track, clip, cut) {
  const rel = cut - clip.start;
  if (rel <= 0.02 || rel >= clip.duration - 0.02) return null;
  const speed = Number(clip.speed) || 1;
  const rightDuration = Number((clip.duration - rel).toFixed(6));
  const leftTrimEnd = Number(((Number(clip.trimStart) || 0) + rel * speed).toFixed(6));
  const { left, right } = splitClipKeyframes(clip, rel);
  const rightClip = {
    ...JSON.parse(JSON.stringify(clip)),
    id: uid('clip'),
    name: clip.name.replace(/ \((左|右)\)$/, '') + ' (右)',
    start: cut,
    duration: rightDuration,
    trimStart: leftTrimEnd,
    trimEnd: Number(((Number(clip.trimStart) || 0) + clip.duration * speed).toFixed(6)),
    keyframes: right,
  };
  clip.name = clip.name.replace(/ \((左|右)\)$/, '') + ' (左)';
  clip.duration = Number(rel.toFixed(6));
  clip.trimEnd = leftTrimEnd;
  clip.keyframes = left;
  return rightClip;
}

export function splitAtPlayhead() {
  if (!state.project) return;
  const cut = Number(state.currentTime.toFixed(6));
  const s = scene.value;
  const selected = selectedClip.value;
  const locked = s.tracks.some((t) => t.locked && t.elements.some((c) => cut > c.start && cut < c.start + c.duration));
  const targets = [];
  if (selected) {
    const loc = findClipLocation(state.project, selected.id);
    if (loc && !loc.track.locked && cut > loc.clip.start + 0.02 && cut < loc.clip.start + loc.clip.duration - 0.02) {
      targets.push(loc);
    } else {
      notify('播放头必须位于选中片段内部才能切分', 'warn');
      return;
    }
  } else {
    for (const track of s.tracks) {
      if (track.locked) continue;
      for (const clip of track.elements) {
        if (cut > clip.start + 0.02 && cut < clip.start + clip.duration - 0.02) targets.push({ track, clip });
      }
    }
    if (s.tracks.some((t) => t.locked)) {
      const anyLocked = s.tracks.filter((t) => t.locked).some((t) => t.elements.some((c) => cut > c.start && cut < c.start + c.duration));
      if (anyLocked && !locked) { /* 锁定轨被明确跳过 */ }
    }
  }
  if (!targets.length) {
    notify('播放头下没有可切分的片段', 'warn');
    return;
  }
  pushHistory('切分片段');
  let rightSelected = null;
  for (const { track, clip } of targets) {
    const idx = track.elements.indexOf(clip);
    const right = splitOne(track, clip, cut);
    if (right) {
      track.elements.splice(idx + 1, 0, right);
      if (selected && selected.id === clip.id) rightSelected = right;
      // 同一轨后续片段若与本片段重叠，不处理；剪辑工具默认允许自由排布
    }
    track.elements.sort((a, b) => a.start - b.start);
  }
  if (rightSelected) {
    state.selectedClipId = rightSelected.id;
    const loc = findClipLocation(state.project, rightSelected.id);
    state.selectedTrackId = loc?.track?.id || state.selectedTrackId;
  }
  scheduleSave();
  requestPreviewRender();
  notify(`已在 ${cut.toFixed(2)}s 切分 ${targets.length} 个片段（可 Ctrl+Z 原子还原）`, 'ok');
}

// ---------- delete / ripple / gap ----------
export function deleteClipById(trackId, clipId, { ripple = false } = {}) {
  const track = findTrack(scene.value, trackId);
  const clip = track?.elements.find((c) => c.id === clipId);
  if (!clip) return;
  pushHistory(ripple ? '波纹删除' : '删除片段');
  const end = clip.start + clip.duration;
  const dur = clip.duration;
  for (const t of scene.value.tracks) {
    const idx = t.elements.findIndex((c) => c.id === clipId);
    if (idx >= 0) t.elements.splice(idx, 1);
  }
  if (ripple) {
    for (const t of scene.value.tracks) {
      for (const c of t.elements) {
        if (c.start >= end - 1e-6) c.start = Number(Math.max(0, c.start - dur).toFixed(6));
      }
    }
  }
  if (state.selectedClipId === clipId) clearSelection();
  scheduleSave();
  requestPreviewRender();
  notify(ripple ? '已波纹删除并前移后续片段' : '已删除片段', 'ok');
}

export function deleteSelectedClip({ ripple = false } = {}) {
  if (state.selectedGap) {
    closeGap(state.selectedGap);
    return;
  }
  if (!state.selectedClipId) { notify('没有选中片段', 'warn'); return; }
  const loc = findClipLocation(state.project, state.selectedClipId);
  if (loc) deleteClipById(loc.track.id, loc.clip.id, { ripple });
}

export function closeGap(gap) {
  if (!gap) return;
  const length = Number((gap.end - gap.start).toFixed(6));
  if (length <= 0.01) return;
  pushHistory('闭合间隙');
  for (const track of scene.value.tracks) {
    for (const clip of track.elements) {
      if (clip.start >= gap.end - 1e-6) clip.start = Number(Math.max(0, clip.start - length).toFixed(6));
    }
  }
  state.selectedGap = null;
  scheduleSave();
  requestPreviewRender();
  notify(`已闭合 ${length.toFixed(2)}s 间隙`, 'ok');
}

export function computeGaps(track, durationLimit) {
  const clips = [...track.elements].sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = 0;
  for (const clip of clips) {
    if (clip.start > cursor + 0.001) {
      gaps.push({ trackId: track.id, start: cursor, end: clip.start, length: clip.start - cursor });
    }
    cursor = Math.max(cursor, clip.start + clip.duration);
  }
  const limit = Number(durationLimit) || 0;
  if (limit > cursor + 0.001) gaps.push({ trackId: track.id, start: cursor, end: limit, length: limit - cursor });
  return gaps;
}

// ---------- transform / keyframes ----------
export function currentRelTime(clip = selectedClip.value) {
  if (!clip) return 0;
  return clamp(state.currentTime - clip.start, 0, clip.duration);
}

export function updateTransform(prop, value) {
  const clip = selectedClip.value;
  if (!clip) return;
  const trProp = TRANSFORM_PROP_MAP[prop];
  const keys = clip.keyframes?.[prop];
  const rel = currentRelTime(clip);
  if (keys && keys.length) {
    const interp = keys.find((k) => Math.abs(k.time - rel) < 0.001)?.interpolation
      || keys.filter((k) => k.time <= rel).at(-1)?.interpolation || 'bezier';
    setKeyframe(clip, prop, rel, value, interp);
  } else {
    clip.transform[trProp] = Number(value);
  }
  scheduleSave();
  requestPreviewRender();
}

export function addKeyframe(prop, value = null, interpolation = 'bezier') {
  const clip = selectedClip.value;
  if (!clip) return;
  const rel = currentRelTime(clip);
  const current = value == null ? resolvedValue(clip, prop, rel) : value;
  pushHistory('添加关键帧');
  setKeyframe(clip, prop, rel, current, interpolation);
  scheduleSave();
  requestPreviewRender();
  notify(`已在 ${rel.toFixed(2)}s 添加${prop}关键帧`, 'ok');
}

export function toggleKeyframe(prop) {
  const clip = selectedClip.value;
  if (!clip) return;
  const rel = currentRelTime(clip);
  const keys = clip.keyframes?.[prop] || [];
  const existing = keys.find((k) => Math.abs(k.time - rel) < 0.02);
  if (existing) {
    pushHistory('删除关键帧');
    removeKeyframe(clip, prop, existing.id);
    state.selectedKeyframes = state.selectedKeyframes.filter((s) => s.keyId !== existing.id);
    scheduleSave();
    requestPreviewRender();
  } else {
    addKeyframe(prop, resolvedValue(clip, prop, rel));
  }
}

function resolvedValue(clip, prop, rel) {
  const tr = resolveTransform(clip, rel);
  return tr[prop];
}

export function updateKeyframeValue(prop, keyId, value) {
  const clip = selectedClip.value;
  if (!clip) return;
  const key = clip.keyframes?.[prop]?.find((k) => k.id === keyId);
  if (!key) return;
  key.value = Number(value);
  scheduleSave();
  requestPreviewRender();
}

export function updateKeyframeTime(prop, keyId, time) {
  const clip = selectedClip.value;
  if (!clip) return;
  const key = clip.keyframes?.[prop]?.find((k) => k.id === keyId);
  if (!key) return;
  key.time = clamp(Number(time), 0, clip.duration);
  clip.keyframes[prop].sort((a, b) => a.time - b.time);
  scheduleSave();
  requestPreviewRender();
}

export function changeKeyframeInterpolation(prop, keyId, interpolation) {
  const clip = selectedClip.value;
  if (!clip) return;
  pushHistory('修改插值');
  setKeyframeInterpolation(clip, prop, keyId, interpolation);
  scheduleSave();
  requestPreviewRender();
}

export function deleteKeyframe(prop, keyId) {
  const clip = selectedClip.value;
  if (!clip) return;
  pushHistory('删除关键帧');
  removeKeyframe(clip, prop, keyId);
  state.selectedKeyframes = state.selectedKeyframes.filter((s) => s.keyId !== keyId);
  scheduleSave();
  requestPreviewRender();
}

export function toggleKeyframeSelection(prop, keyId) {
  const idx = state.selectedKeyframes.findIndex((s) => s.prop === prop && s.keyId === keyId);
  if (idx >= 0) state.selectedKeyframes.splice(idx, 1);
  else state.selectedKeyframes.push({ prop, keyId });
}

export function copySelectedKeyframes() {
  const clip = selectedClip.value;
  if (!clip) return;
  const copied = cloneSelectedKeyframes(clip, state.selectedKeyframes);
  if (!copied.length) { notify('先勾选要复制的关键帧', 'warn'); return; }
  state.clipboardKeyframes = copied;
  notify(`已复制 ${copied.length} 个关键帧，选中另一片段后粘贴`, 'ok');
}

export function pasteSelectedKeyframes() {
  const clip = selectedClip.value;
  if (!clip) { notify('先选中目标片段', 'warn'); return; }
  if (!state.clipboardKeyframes.length) { notify('剪贴板里没有关键帧', 'warn'); return; }
  pushHistory('粘贴关键帧');
  const n = pasteKeyframes(clip, state.clipboardKeyframes);
  scheduleSave();
  requestPreviewRender();
  notify(`已粘贴 ${n} 个关键帧到 ${clip.name}`, 'ok');
}

export function clearKeyframes(prop) {
  const clip = selectedClip.value;
  if (!clip || !clip.keyframes?.[prop]) return;
  pushHistory('清空关键帧');
  delete clip.keyframes[prop];
  scheduleSave();
  requestPreviewRender();
}

// ---------- masks ----------
export function addMask(type) {
  const clip = selectedClip.value;
  if (!clip) { notify('先选中片段', 'warn'); return; }
  pushHistory('添加遮罩');
  const mask = makeMask(type);
  clip.masks.push(mask);
  state.activeMaskId = mask.id;
  state.maskEditMode = type === 'path';
  scheduleSave();
  requestPreviewRender();
  notify(`已添加${type === 'rectangle' ? '矩形' : type === 'ellipse' ? '椭圆' : '自由路径'}遮罩`, 'ok');
}

export function removeMask(maskId) {
  const clip = selectedClip.value;
  if (!clip) return;
  pushHistory('删除遮罩');
  clip.masks = clip.masks.filter((m) => m.id !== maskId);
  if (state.activeMaskId === maskId) state.activeMaskId = null;
  scheduleSave();
  requestPreviewRender();
}

export function selectMask(maskId) {
  state.activeMaskId = maskId;
  state.maskEditMode = selectedMask.value?.type === 'path';
}

export function addMaskPoint(normX, normY) {
  const mask = selectedMask.value;
  if (!mask || mask.type !== 'path') return;
  mask.points = mask.points || [];
  mask.points.push({ x: clamp(normX, 0, 1), y: clamp(normY, 0, 1) });
  scheduleSave();
  requestPreviewRender();
}

export function moveMaskPoint(index, normX, normY) {
  const mask = selectedMask.value;
  if (!mask || mask.type !== 'path' || !mask.points[index]) return;
  mask.points[index] = { x: clamp(normX, 0, 1), y: clamp(normY, 0, 1) };
  scheduleSave();
  requestPreviewRender();
}

export function removeMaskPoint(index) {
  const mask = selectedMask.value;
  if (!mask || mask.type !== 'path') return;
  mask.points.splice(index, 1);
  scheduleSave();
  requestPreviewRender();
}

export function updateMaskField(field, value) {
  const mask = selectedMask.value;
  if (!mask) return;
  mask[field] = value;
  scheduleSave();
  requestPreviewRender();
}

// ---------- audio / speed / effects ----------
export function separateAudio() {
  const clip = selectedClip.value;
  const loc = clip ? findClipLocation(state.project, clip.id) : null;
  if (!clip || !loc || clip.type !== 'video') { notify('先选中视频片段', 'warn'); return; }
  if (clip.sourceAudioEnabled === false) { notify('该片段音频已经分离', 'warn'); return; }
  const media = mediaById(state.project, clip.mediaId);
  if (!media || !media.hasAudio) { notify('该视频没有可用音频', 'warn'); return; }
  pushHistory('分离音频');
  clip.sourceAudioEnabled = false;
  let audioTrack = scene.value.tracks.find((t) => t.type === 'audio');
  if (!audioTrack) {
    audioTrack = makeTrack('audio', 'A1 音频');
    scene.value.tracks.push(audioTrack);
  }
  const audioClip = makeClip('audio', {
    name: `${clip.name} 原声`,
    mediaId: clip.mediaId,
    start: clip.start,
    duration: clip.duration,
    trimStart: clip.trimStart,
    trimEnd: clip.trimEnd,
    speed: clip.speed,
    maintainPitch: clip.maintainPitch,
    volume: clip.volume,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
  });
  audioTrack.elements.push(audioClip);
  state.selectedClipId = audioClip.id;
  state.selectedTrackId = audioTrack.id;
  scheduleSave();
  requestPreviewRender();
  notify('已分离音频：原视频静音，新音频块与视频对齐', 'ok');
}

export function recoverAudio() {
  const clip = selectedClip.value;
  if (!clip || clip.type !== 'video') return;
  pushHistory('恢复原声');
  clip.sourceAudioEnabled = true;
  for (const track of scene.value.tracks) {
    track.elements = track.elements.filter((c) => !(c.type === 'audio' && c.mediaId === clip.mediaId && Math.abs(c.start - clip.start) < 1e-3 && Math.abs(c.duration - clip.duration) < 1e-3));
  }
  scheduleSave();
  requestPreviewRender();
  notify('已恢复视频原声，并移除对应分离音频块', 'ok');
}

export function setClipSpeed(speed) {
  const clip = selectedClip.value;
  if (!clip) return;
  const s = clamp(Number(speed) || 1, 0.25, 4);
  pushHistory('修改变速');
  const oldDur = clip.duration;
  const sourceSpan = oldDur * (Number(clip.speed) || 1);
  const newDur = sourceSpan / s;
  const ratio = newDur / oldDur;
  clip.speed = s;
  clip.duration = Number(newDur.toFixed(6));
  clip.trimEnd = Number(((Number(clip.trimStart) || 0) + sourceSpan).toFixed(6));
  for (const keys of Object.values(clip.keyframes || {})) {
    for (const k of keys) k.time *= ratio;
  }
  scheduleSave();
  requestPreviewRender();
}

export function updateClipField(field, value) {
  const clip = selectedClip.value;
  if (!clip) return;
  clip[field] = value;
  scheduleSave();
  requestPreviewRender();
}

export function addClipEffect() {
  const clip = selectedClip.value;
  if (!clip) return;
  pushHistory('添加模糊');
  clip.effects.push({ id: uid('fx'), type: 'blur', amount: 6 });
  scheduleSave();
  requestPreviewRender();
}

export function removeClipEffect(id) {
  const clip = selectedClip.value;
  if (!clip) return;
  pushHistory('删除效果');
  clip.effects = clip.effects.filter((e) => e.id !== id);
  scheduleSave();
  requestPreviewRender();
}

export function setClipEffectAmount(id, amount) {
  const clip = selectedClip.value;
  const fx = clip?.effects.find((e) => e.id === id);
  if (!fx) return;
  fx.amount = Number(amount);
  scheduleSave();
  requestPreviewRender();
}

// ---------- canvas / zoom ----------
export function setCanvas(patch) {
  if (!state.project) return;
  Object.assign(state.project.canvas, patch);
  scheduleSave();
  requestPreviewRender();
}

export function setFps(fps) {
  if (!state.project) return;
  state.project.fps = Number(fps) || 30;
  scheduleSave();
}

export function setZoom(pps) {
  if (!state.project) return;
  state.project.pixelsPerSecond = clamp(Number(pps) || 100, 5, 500);
  scheduleSave();
}

export function seek(time, { render = true } = {}) {
  const d = duration.value || 0;
  state.currentTime = clamp(Number(time) || 0, 0, Math.max(0, d));
  if (state.project) state.project.playhead = state.currentTime;
  if (state.playing) {
    stopPlayback();
    startPlayback();
  }
  if (render) requestPreviewRender();
}

export function stepFrame(delta) {
  const fps = state.project?.fps || 30;
  seek(state.currentTime + delta / fps);
}

// ---------- playback ----------
let rafId = null;
let playBaseWall = 0;
let playBaseTime = 0;

function playbackLoop() {
  if (!state.playing) return;
  const elapsed = (performance.now() - playBaseWall) / 1000;
  let t = playBaseTime + elapsed;
  const d = duration.value;
  if (t >= d) {
    state.currentTime = d;
    if (state.project) state.project.playhead = d;
    stopPlayback();
    renderPreview({ playing: false });
    return;
  }
  state.currentTime = t;
  if (state.project) state.project.playhead = t;
  audioPreview.sync(t);
  renderPreview({ playing: true });
  rafId = requestAnimationFrame(playbackLoop);
}

export function startPlayback() {
  if (!state.project || state.playing) return;
  getAudioContext();
  state.playing = true;
  playBaseWall = performance.now();
  playBaseTime = state.currentTime >= duration.value - 0.01 ? 0 : state.currentTime;
  state.currentTime = playBaseTime;
  audioPreview.setProject(state.project, scene.value);
  audioPreview.start(playBaseTime);
  // 导出时若预览画布离屏，仍使用同一渲染器
  renderPreview({ playing: true });
  rafId = requestAnimationFrame(playbackLoop);
}

export function stopPlayback() {
  state.playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  audioPreview.stop();
  requestPreviewRender();
}

export function togglePlay() {
  if (state.playing) stopPlayback();
  else startPlayback();
}

// ---------- preview ----------
export function attachCanvas(el) {
  if (!el) return;
  // 组件重新挂载会给出新的 canvas。旧的 compositor 闭包仍指向已脱离 DOM 的画布，
  // 继续复用会导致预览黑屏、导出上传空帧，所以必须按元素重建。
  if (canvasEl !== el || !compositor) {
    canvasEl = el;
    compositor = createCompositor(el);
  }
  requestPreviewRender();
}

export function detachCanvas(el) {
  if (el && canvasEl && canvasEl !== el) return;
  canvasEl = null;
  compositor = null;
}

export function attachOverlayCanvas(el) {
  state.overlayCanvas = el;
}
state.overlayCanvas = null;

export function requestPreviewRender() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    renderPreview({ playing: state.playing });
  });
}

let renderSeq = 0;
export async function renderPreview(opts = {}) {
  if (!state.project || !compositor) return;
  const seq = ++renderSeq;
  const result = await compositor.render(state.project, state.currentTime, {
    playing: !!opts.playing,
    scene: scene.value,
  });
  if (seq !== renderSeq) return;
  state.missingClipIds = result?.missing || [];
  drawMaskOverlay();
}

export function drawMaskOverlay() {
  if (!canvasEl) return;
  const overlay = state.overlayCanvas;
  if (!overlay) return;
  const clip = selectedClip.value;
  const mask = selectedMask.value;
  overlay.width = state.project.canvas.width;
  overlay.height = state.project.canvas.height;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!clip || !mask) return;
  compositor.drawMaskOverlay(overlay, state.project, clip, mask);
}

// ---------- export ----------
function buildAudioClips() {
  const clips = [];
  for (const track of scene.value.tracks) {
    if (track.muted || track.hidden) continue;
    for (const clip of track.elements) {
      if (clip.hidden) continue;
      let audible = false;
      if (clip.type === 'audio') audible = true;
      if (clip.type === 'video' && clip.sourceAudioEnabled !== false) audible = true;
      if (!audible) continue;
      const media = mediaById(state.project, clip.mediaId);
      if (!media?.hasAudio) continue;
      clips.push({
        mediaId: clip.mediaId,
        start: clip.start,
        duration: clip.duration,
        trimStart: clip.trimStart,
        speed: clip.speed,
        maintainPitch: clip.maintainPitch,
        volume: clip.volume == null ? 100 : clip.volume,
        fadeIn: clip.fadeIn || 0,
        fadeOut: clip.fadeOut || 0,
      });
    }
  }
  return clips;
}

export async function exportVideo({ format = 'mp4' } = {}) {
  if (state.exporting || !state.project) return;
  if (!compositor) { notify('预览画布未就绪，请先打开剪辑页', 'error'); return; }
  const total = duration.value;
  if (total < 0.2) { notify('时间轴为空，无法导出', 'warn'); return; }
  const fps = Number(state.project.fps) || 30;
  const frameCount = Math.max(1, Math.round(total * fps));
  if (frameCount > 20000) {
    notify('工程超过 20000 帧（约 11 分钟 @30fps），当前导出通道不支持', 'warn');
    return;
  }
  // 导出必须独占渲染：播放循环会持续改写同一块画布和 compositor token。
  if (state.playing) stopPlayback();
  state.exporting = true;
  state.cancelExport = false;
  state.exportProgress = 0;
  state.exportError = '';
  state.exportResult = null;
  state.exportStage = '准备合成画布';
  const wallStart = performance.now();
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = state.project.canvas.width;
  exportCanvas.height = state.project.canvas.height;
  // 取消/失败时后端收不到 assemble，帧目录会一直留着。记下会话名主动回收。
  let exportSession = null;
  try {
    getAudioContext();
    await saveNow();
    // 导出前预检：缺片源时直接阻断，不输出黑帧。
    const preflight = await compositor.render(state.project, 0, {
      playing: false, scene: scene.value, canvas: exportCanvas,
    });
    if (preflight?.missing?.length) {
      throw new Error(`缺片源：${preflight.missing.length} 个片段没有可读取的媒体，已阻断导出`);
    }
    const start = await api.send('/editor-api/export/start', 'POST', { projectId: state.project.id });
    const sessionId = start.sessionId;
    exportSession = sessionId;
    for (let i = 0; i < frameCount; i += 1) {
      if (state.cancelExport) throw new Error('用户取消导出');
      const t = i / fps;
      state.exportStage = `渲染第 ${i + 1}/${frameCount} 帧`;
      // token 被预览抢占时重试当前帧，而不是把半成品编码出去。
      let result = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        result = await compositor.render(state.project, t, {
          playing: false, scene: scene.value, canvas: exportCanvas,
        });
        if (!result?.superseded) break;
      }
      if (result?.superseded) throw new Error(`第 ${i + 1} 帧被预览渲染抢占，导出中止`);
      if (result?.missing?.length) {
        throw new Error(`第 ${i + 1} 帧缺片源：${result.missing.length} 个片段无法渲染`);
      }
      const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('无法生成帧图像');
      const up = await fetch(`/editor-api/export/frame?session=${encodeURIComponent(sessionId)}&index=${i}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'image/jpeg' }),
        body: blob,
      });
      if (!up.ok) throw new Error(`上传帧失败: ${await up.text()}`);
      state.exportProgress = Math.floor(((i + 1) / frameCount) * 85);
    }
    state.exportStage = '混流编码（视频 + 多轨音频）';
    state.exportProgress = 90;
    const assemble = await api.send('/editor-api/export/assemble', 'POST', {
      sessionId,
      projectId: state.project.id,
      fps,
      format,
      duration: total,
      frameCount,
      width: state.project.canvas.width,
      height: state.project.canvas.height,
      audioClips: buildAudioClips(),
    });
    state.exportProgress = 100;
    state.exportStage = '完成';
    state.exportResult = assemble.meta;
    // 后端 assemble 成功后会自己删会话目录，这里只是别让 catch 再回收一次。
    exportSession = null;
    const secs = ((performance.now() - wallStart) / 1000).toFixed(1);
    notify(`导出完成：${assemble.meta.file}（${assemble.meta.duration.toFixed(2)}s，用时 ${secs}s）`, 'ok');
  } catch (e) {
    state.exportError = e.message || String(e);
    notify(`导出失败：${state.exportError}`, 'error');
    // 主动回收已上传的帧，避免反复失败写满磁盘。
    if (exportSession) {
      api.send('/editor-api/export/abort', 'POST', { sessionId: exportSession }).catch(() => {});
      exportSession = null;
    }
  } finally {
    state.exporting = false;
    // 恢复预览渲染
    requestPreviewRender();
  }
}

export function cancelExport() {
  state.cancelExport = true;
}

// ---------- snapping helper ----------
export function snapForDrag({ start, duration: dur, clipId, pps, edgeOnly = null }) {
  const active = state.snapping !== state.shiftDown;
  if (!active) return null;
  const { targets } = buildSnapTargets({
    scene: scene.value,
    playhead: state.currentTime,
    excludeClipId: clipId,
    pps,
    clipDuration: dur,
  });
  return resolveSnap({ start, duration: dur, targets, pps, edgeOnly });
}

export function setSnapGuide(guide) { state.snapGuide = guide; }

export function trackMediaList() {
  return state.serverMedia;
}

export async function uploadMediaFile() {
  notify('片段只用素材库里的素材。请从左侧素材池点选。', 'warn');
  return null;
}

// 导出路径/素材地址也走同源接口；提供下载 URL 给界面
export function exportDownloadUrl(meta) {
  return meta?.url || '';
}

export { mediaUrl, sourceTimeForClip, visualTracks, audioTracks, mediaById };

// 供本地自动化审查读取编辑器状态（不影响 UI 行为）。
if (typeof window !== 'undefined') {
  window.__editor = {
    state, scene, duration,
    loadProjects, openProject, createProject, deleteProject, renameProject,
    addTrack, deleteTrack, addMediaClip, addTextClip, addStickerClip, addGraphicClip,
    addEffectClip, splitAtPlayhead, deleteSelectedClip, closeGap, seek, setZoom,
    addBookmark, switchScene, addScene, undo, redo, saveNow, selectedClip,
    updateTransform, addKeyframe, toggleKeyframe, separateAudio, setClipSpeed,
    exportVideo, requestPreviewRender, toggleTrack, changeKeyframeInterpolation,
    setClipEffectAmount, addMask, updateMaskField,
  };
}
