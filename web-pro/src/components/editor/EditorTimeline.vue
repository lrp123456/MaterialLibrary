<template>
  <section class="flex flex-col bg-studio-900 border-t border-studio-750/80 shrink-0 editor-timeline" :style="{ height: '42vh', minHeight: '320px' }">
    <!-- 场景与工具条 -->
    <div class="h-9 bg-studio-950 border-b border-studio-800 px-3 flex items-center justify-between shrink-0 gap-2 overflow-x-auto">
      <div class="flex items-center gap-1 shrink-0">
        <span class="text-[10px] uppercase tracking-wider text-slate-500 mr-1">场景</span>
        <button
          v-for="s in sceneList"
          :key="s.id"
          class="px-2 py-0.5 rounded-lg text-[11px] border cursor-pointer whitespace-nowrap"
          :class="s.id === state.project.activeSceneId ? 'bg-studio-accent/20 border-studio-accent text-white font-bold' : 'border-studio-750 text-slate-400'"
          @click="switchScene(s.id)"
          @dblclick.stop="beginSceneRename(s)"
          :title="s.isMain ? '主场景' : '双击改名'"
        >
          {{ s.name }}{{ s.isMain ? ' ·主' : '' }}
        </button>
        <input
          v-if="sceneRenameId"
          v-model="sceneRenameValue"
          class="w-24 px-1 py-0.5 rounded border border-studio-accent bg-studio-950 text-[11px] text-white outline-none"
          @keyup.enter="commitSceneRename"
          @blur="commitSceneRename"
        />
        <button class="px-1.5 py-0.5 rounded border border-studio-750 text-[11px] text-slate-300 cursor-pointer" @click="addScene" title="新增场景">＋场景</button>
        <button
          v-if="!currentScene?.isMain"
          class="px-1.5 py-0.5 rounded border border-rose-500/40 text-[11px] text-rose-400 cursor-pointer"
          @click="deleteScene(state.project.activeSceneId)"
          title="删除当前场景"
        >删场景</button>

        <div class="h-3 w-px bg-studio-750 mx-1"></div>
        <button class="px-2 py-0.5 rounded-lg text-[11px] text-slate-300 hover:bg-studio-800 cursor-pointer" @click="addBookmark" title="在播放头添加/删除书签">＋书签</button>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <button @click="splitAtPlayhead" class="editor-tl-btn" title="剪刀：选中片段时切当前片段；未选中时切所有未锁定轨 (Ctrl/Cmd+B 或 S)">✂️ 剪刀</button>
        <button @click="deleteSelectedClip({ ripple: false })" class="editor-tl-btn" title="删除选中片段 (Del)">🗑️ 删除</button>
        <button @click="deleteSelectedClip({ ripple: true })" class="editor-tl-btn" title="波纹删除 (Shift+Delete)">⇤ 波纹删除</button>
        <div class="h-3 w-px bg-studio-750 mx-1"></div>
        <label class="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer" title="磁吸开关 (N)">
          <input type="checkbox" :checked="state.snapping" class="accent-studio-accent" @change="state.snapping = !state.snapping" />
          磁吸
        </label>
        <div class="h-3 w-px bg-studio-750 mx-1"></div>
        <span class="text-[11px] text-slate-400">缩放</span>
        <button class="editor-tl-btn" @click="zoomStep(-1)">－</button>
        <span class="text-[10px] font-mono text-studio-cyan w-14 text-center">{{ Math.round(pps) }}px/s</span>
        <button class="editor-tl-btn" @click="zoomStep(1)">＋</button>
        <button v-for="z in [50, 100, 200]" :key="z" class="editor-tl-btn" :class="Math.round(pps) === z ? 'is-on' : ''" @click="setZoom(z)">{{ z }}</button>
      </div>
    </div>

    <!-- 时间轴滚动区 -->
    <div ref="scrollerRef" class="flex-1 overflow-auto custom-scroll relative" @wheel.ctrl.prevent="onWheelZoom">
      <div class="relative" :style="{ width: `${headerW + contentWidth}px`, minHeight: '100%' }">
        <!-- 标尺 -->
        <div class="flex h-7 sticky top-0 z-30 bg-studio-900">
          <div ref="headerRef" class="w-28 shrink-0 sticky left-0 z-40 bg-studio-900 border-r border-studio-800 px-2 flex items-center text-[10px] font-bold text-slate-400">轨道 / 时间</div>
          <div ref="rulerRef" class="relative flex-1 cursor-pointer select-none" :style="{ width: `${contentWidth}px` }" @pointerdown="startRulerDrag">
            <div
              v-for="tick in ticks"
              :key="tick"
              class="absolute top-0 bottom-0 border-l border-studio-800 text-[9px] font-mono text-slate-400 pl-1 pt-1"
              :style="{ left: `${tick * pps}px` }"
            >{{ formatTick(tick) }}</div>
          </div>
        </div>

        <!-- 书签条 -->
        <div class="flex h-5 bg-studio-950/80 border-b border-studio-800">
          <div class="w-28 shrink-0 sticky left-0 z-20 bg-studio-900 border-r border-studio-800 px-2 flex items-center text-[9px] text-slate-500">书签</div>
          <div class="relative" :style="{ width: `${contentWidth}px` }">
            <button
              v-for="bm in bookmarks"
              :key="bm.id"
              class="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 border border-white/70 cursor-pointer"
              :style="{ left: `${bm.time * pps - 5}px`, background: bm.color || '#22d3ee' }"
              :title="`${bm.time.toFixed(2)}s ${bm.note || ''}（点击跳转，右键删除）`"
              @click="seek(bm.time)"
              @contextmenu.prevent="removeBookmark(bm.id)"
            ></button>
          </div>
        </div>

        <!-- 轨道 -->
        <div
          v-for="track in tracks"
          :key="track.id"
          class="flex border-b border-studio-800/60"
          :style="{ height: `${trackHeight(track)}px` }"
        >
          <div class="w-28 shrink-0 sticky left-0 z-20 bg-studio-900 border-r border-studio-800 px-1.5 flex flex-col justify-center gap-0.5">
            <div class="flex items-center justify-between gap-1">
              <span class="text-[10px] font-bold truncate" :class="trackColor(track)">{{ track.name }}</span>
              <div class="flex items-center gap-0.5 shrink-0">
                <button class="track-mini" :class="track.muted ? 'is-danger' : ''" @click.stop="toggleTrack(track.id, 'muted')" :title="track.muted ? '取消静音' : '静音'">M</button>
                <button class="track-mini" :class="track.hidden ? 'is-danger' : ''" @click.stop="toggleTrack(track.id, 'hidden')" :title="track.hidden ? '显示轨道' : '隐藏轨道'">{{ track.hidden ? '◌' : '◉' }}</button>
                <button class="track-mini" :class="track.locked ? 'is-warn' : ''" @click.stop="toggleTrack(track.id, 'locked')" :title="track.locked ? '解锁' : '锁定（切分时跳过）'">{{ track.locked ? '🔒' : '🔓' }}</button>
                <button v-if="!track.isMain" class="track-mini is-danger" @click.stop="deleteTrack(track.id)" title="删除轨道">×</button>
              </div>
            </div>
            <div class="text-[8px] font-mono text-slate-500 uppercase">{{ track.type }} {{ track.elements.length }} clips</div>
          </div>

          <div
            class="relative flex-1"
            :class="track.hidden ? 'opacity-45' : ''"
            :style="{ width: `${contentWidth}px` }"
            @mousedown.self="onEmptyTrackMouseDown($event, track)"
          >
            <!-- gaps -->
            <button
              v-for="gap in gapsFor(track)"
              :key="`${gap.trackId}-${gap.start}-${gap.end}`"
              class="absolute top-0 bottom-0 gap-block"
              :class="isGapSelected(gap) ? 'is-on' : ''"
              :style="{ left: `${gap.start * pps}px`, width: `${gap.length * pps}px` }"
              :title="`空白间隙 ${gap.length.toFixed(2)}s（点击选中，Delete 闭合）`"
              @mousedown.stop
              @click.stop="selectGap(gap)"
            ></button>

            <!-- clips -->
            <div
              v-for="clip in track.elements"
              :key="clip.id"
              class="absolute rounded-md border overflow-hidden select-none"
              :class="[
                clipClass(track, clip),
                state.selectedClipId === clip.id ? 'is-selected' : '',
                track.locked ? 'is-locked' : '',
              ]"
              :style="{ left: `${clip.start * pps}px`, width: `${Math.max(6, clip.duration * pps)}px`, top: '2px', bottom: '2px' }"
              :title="`${clip.name}  ${clip.start.toFixed(2)}s → ${(clip.start + clip.duration).toFixed(2)}s`"
              @mousedown.stop="onClipMouseDown($event, track, clip)"
              @contextmenu.prevent.stop="openContextMenu($event, track, clip)"
            >
              <div v-if="clip.type === 'audio'" class="absolute inset-0">
                <WaveformCanvas
                  :audio-url="mediaFor(clip)?.audioUrl || ''"
                  :trim-start="clip.trimStart || 0"
                  :duration="clip.duration"
                  :speed="clip.speed || 1"
                  :volume="clip.volume"
                  :fade-in="clip.fadeIn || 0"
                  :fade-out="clip.fadeOut || 0"
                  :color="trackColorHex(track)"
                />
              </div>
              <div class="absolute inset-0 flex flex-col justify-center px-1.5 pointer-events-none">
                <div class="text-[10px] font-bold truncate leading-tight">{{ icon(clip) }} {{ clip.name }}</div>
                <div class="text-[8px] font-mono opacity-75 truncate">{{ clip.duration.toFixed(2) }}s · {{ clip.start.toFixed(2) }}s</div>
              </div>
              <span v-if="!mediaFor(clip) && clip.type !== 'text' && clip.type !== 'effect' && clip.type !== 'sticker' && clip.type !== 'graphic'" class="absolute right-1 top-1 text-[8px] px-1 rounded bg-rose-500/80 text-white">缺片源</span>
              <span v-if="clip.sourceAudioEnabled === false && clip.type === 'video'" class="absolute left-1 bottom-0.5 text-[8px] text-slate-300">🔇原声已分离</span>
              <span v-if="hasKeys(clip)" class="absolute right-1 bottom-0.5 text-[8px] text-studio-cyan">◆</span>

              <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-white/20 hover:bg-white cursor-ew-resize z-10" @mousedown.stop.prevent="onTrimMouseDown($event, track, clip, 'left')"></div>
              <div class="absolute right-0 top-0 bottom-0 w-1.5 bg-white/20 hover:bg-white cursor-ew-resize z-10" @mousedown.stop.prevent="onTrimMouseDown($event, track, clip, 'right')"></div>
            </div>
          </div>
        </div>

        <!-- 添加轨道 -->
        <div class="flex h-9">
          <div class="w-28 shrink-0 sticky left-0 z-20 bg-studio-900 border-r border-studio-800 flex items-center px-2">
            <span class="text-[9px] text-slate-500">添加轨道</span>
          </div>
          <div class="flex items-center gap-1 px-2" :style="{ width: `${contentWidth}px` }">
            <button class="editor-tl-btn" @click="addTrack('video')">＋叠加轨</button>
            <button class="editor-tl-btn" @click="addTrack('text')">＋文字轨</button>
            <button class="editor-tl-btn" @click="addTrack('graphic')">＋图形轨</button>
            <button class="editor-tl-btn" @click="addTrack('effect')">＋效果轨</button>
            <button class="editor-tl-btn" @click="addTrack('audio')">＋音频轨</button>
          </div>
        </div>

        <!-- 播放头 -->
        <div class="absolute top-0 bottom-0 z-40 pointer-events-none" :style="{ left: `${headerW + state.currentTime * pps}px` }">
          <div class="w-3 h-3 bg-rose-500 rotate-45 -translate-x-1/2 shadow-md pointer-events-auto cursor-ew-resize" @pointerdown.stop="startPlayheadDrag"></div>
          <div class="w-px h-full bg-rose-500 -translate-x-1/2"></div>
        </div>

        <!-- 磁吸辅助线 -->
        <div
          v-if="state.snapGuide"
          class="absolute top-0 bottom-0 z-40 pointer-events-none snap-guide"
          :style="{ left: `${headerW + state.snapGuide.time * pps}px` }"
        >
          <div class="w-px h-full bg-cyan-400"></div>
          <span class="absolute top-7 left-1 text-[9px] px-1 rounded bg-cyan-500/90 text-black font-bold whitespace-nowrap">{{ state.snapGuide.label }}</span>
        </div>
      </div>
    </div>

    <!-- 片段右键菜单 -->
    <div
      v-if="state.contextMenu"
      class="fixed z-[80] min-w-[168px] rounded-xl border border-studio-700 bg-studio-900 shadow-2xl py-1 text-xs"
      :style="{ left: `${state.contextMenu.x}px`, top: `${state.contextMenu.y}px` }"
      @mousedown.stop
    >
      <button v-if="contextClip?.type === 'video'" class="ctx-item" @click="runContext('separate')">分离音频</button>
      <button v-if="contextClip?.type === 'video' && contextClip?.sourceAudioEnabled === false" class="ctx-item" @click="runContext('recover')">恢复原声</button>
      <button class="ctx-item" @click="runContext('split')">在播放头切分</button>
      <button class="ctx-item" @click="runContext('ripple')">波纹删除</button>
      <button class="ctx-item danger" @click="runContext('delete')">删除（留空）</button>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import WaveformCanvas from './WaveformCanvas.vue';
import {
  activeBookmarks, addBookmark, addScene, addTrack, clearSelection, closeGap,
  deleteScene, deleteSelectedClip, deleteTrack, duration,
  mediaById, pushHistory, removeBookmark, renameScene, scene, state,
  seek, selectClip, selectGap, setZoom, snapForDrag, splitAtPlayhead, switchScene,
  toggleTrack, setSnapGuide, deleteClipById, separateAudio, recoverAudio,
  requestPreviewRender,
} from '../../editor/store.js';
import { niceGridStep } from '../../editor/model.js';

const HEADER_W = 112;
const headerRef = ref(null);
const headerW = ref(HEADER_W);
const scrollerRef = ref(null);
const rulerRef = ref(null);
const sceneRenameId = ref(null);
const sceneRenameValue = ref('');
const contextClip = ref(null);
const contextTrack = ref(null);
let headerResizeObserver = null;

const sceneList = computed(() => state.project?.scenes || []);
const currentScene = computed(() => scene.value);
const tracks = computed(() => scene.value?.tracks || []);
const bookmarks = computed(() => scene.value?.bookmarks || []);
const pps = computed(() => Number(state.project?.pixelsPerSecond) || 100);
const contentWidth = computed(() => {
  const d = Math.max(duration.value, 8);
  return Math.max(900, Math.round((d + 4) * pps.value));
});
const ticks = computed(() => {
  const step = niceGridStep(pps.value, 52);
  const maxT = contentWidth.value / pps.value;
  const list = [];
  for (let t = 0; t <= maxT + 0.001; t += step) list.push(Number(t.toFixed(4)));
  return list;
});

function trackHeight(track) {
  if (track.type === 'video') return track.isMain ? 50 : 44;
  if (track.type === 'audio') return 44;
  if (track.type === 'text') return 34;
  return 36;
}

function trackColor(track) {
  return {
    video: 'text-blue-400',
    text: 'text-amber-400',
    graphic: 'text-violet-400',
    effect: 'text-cyan-400',
    audio: 'text-emerald-400',
  }[track.type] || 'text-slate-300';
}
function trackColorHex(track) {
  return {
    video: '#60a5fa',
    text: '#fbbf24',
    graphic: '#a78bfa',
    effect: '#22d3ee',
    audio: '#34d399',
  }[track.type] || '#94a3b8';
}
function clipClass(track, clip) {
  return {
    video: 'bg-blue-900/35 border-blue-500/50 text-slate-100 hover:border-blue-400',
    text: 'bg-amber-900/30 border-amber-500/50 text-amber-100 hover:border-amber-400',
    graphic: 'bg-violet-900/30 border-violet-500/50 text-violet-100 hover:border-violet-400',
    effect: 'bg-cyan-900/30 border-cyan-500/50 text-cyan-100 hover:border-cyan-400',
    audio: 'bg-emerald-900/30 border-emerald-500/50 text-emerald-100 hover:border-emerald-400',
  }[track.type] || '';
}
function icon(clip) {
  return {
    video: '🎞', image: '🖼', text: 'T', sticker: '★', graphic: '◆', effect: '✦', audio: '♪',
  }[clip.type] || '•';
}
function mediaFor(clip) {
  return clip.mediaId ? mediaById(state.project, clip.mediaId) : null;
}
function hasKeys(clip) {
  return Object.values(clip.keyframes || {}).some((k) => k?.length);
}
function formatTick(t) {
  if (t >= 60) {
    const m = Math.floor(t / 60);
    const s = Math.round(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return `${Number(t.toFixed(2))}s`;
}
function gapsFor(track) {
  const clips = [...track.elements].sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = 0;
  for (const clip of clips) {
    if (clip.start > cursor + 0.02) gaps.push({ trackId: track.id, start: cursor, end: clip.start, length: clip.start - cursor });
    cursor = Math.max(cursor, clip.start + clip.duration);
  }
  const limit = Math.max(duration.value, cursor);
  if (limit > cursor + 0.02) gaps.push({ trackId: track.id, start: cursor, end: limit, length: limit - cursor });
  return gaps;
}
function isGapSelected(gap) {
  const g = state.selectedGap;
  return !!g && g.trackId === gap.trackId && Math.abs(g.start - gap.start) < 1e-4 && Math.abs(g.end - gap.end) < 1e-4;
}

// ---------- ruler / playhead ----------
function timeFromClientX(clientX) {
  const rect = rulerRef.value?.getBoundingClientRect();
  if (!rect) return 0;
  return Math.max(0, (clientX - rect.left) / pps.value);
}
function startRulerDrag(e) {
  seek(timeFromClientX(e.clientX));
  const move = (ev) => seek(timeFromClientX(ev.clientX));
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function startPlayheadDrag(e) {
  e.preventDefault();
  const move = (ev) => seek(timeFromClientX(ev.clientX));
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ---------- clip drag / trim ----------
function onClipMouseDown(e, track, clip) {
  if (e.button !== 0) return;
  selectClip(track.id, clip.id);
  if (track.locked) return;
  const startX = e.clientX;
  const initial = { start: clip.start, duration: clip.duration, trimStart: clip.trimStart || 0 };
  let moved = false;
  let pushed = false;
  const move = (ev) => {
    const dt = (ev.clientX - startX) / pps.value;
    if (!moved && Math.abs(ev.clientX - startX) < 2) return;
    if (!pushed) {
      pushHistory('移动片段');
      pushed = true;
    }
    moved = true;
    let newStart = Math.max(0, initial.start + dt);
    const snap = snapForDrag({ start: newStart, duration: clip.duration, clipId: clip.id, pps: pps.value });
    if (snap) {
      newStart = Math.max(0, snap.start);
      setSnapGuide({ time: snap.guideTime, type: snap.type, distancePx: snap.distancePx, label: `${snapLabel(snap.type)} ${snap.distancePx.toFixed(1)}px` });
    } else {
      setSnapGuide(null);
    }
    clip.start = Number(newStart.toFixed(4));
    requestPreviewRender();
  };
  const up = () => {
    setSnapGuide(null);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (moved) requestPreviewRender();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function onTrimMouseDown(e, track, clip, edge) {
  if (track.locked) return;
  selectClip(track.id, clip.id);
  pushHistory('修剪片段');
  const startX = e.clientX;
  const init = {
    start: clip.start,
    duration: clip.duration,
    trimStart: Number(clip.trimStart) || 0,
    speed: Number(clip.speed) || 1,
  };
  const move = (ev) => {
    const dt = (ev.clientX - startX) / pps.value;
    if (edge === 'left') {
      let newStart = Math.max(0, init.start + dt);
      const maxStart = init.start + init.duration - 0.1;
      newStart = Math.min(newStart, maxStart);
      const snap = snapForDrag({ start: newStart, duration: init.duration - (newStart - init.start), clipId: clip.id, pps: pps.value, edgeOnly: 'left' });
      if (snap && Math.abs(snap.start - newStart) * pps.value <= 9) {
        newStart = Math.max(0, snap.start);
        setSnapGuide({ time: snap.guideTime, type: snap.type, distancePx: snap.distancePx, label: `${snapLabel(snap.type)} ${snap.distancePx.toFixed(1)}px` });
      } else setSnapGuide(null);
      const delta = newStart - init.start;
      clip.start = Number(newStart.toFixed(4));
      clip.duration = Number(Math.max(0.1, init.duration - delta).toFixed(4));
      clip.trimStart = Number(Math.max(0, init.trimStart + delta * init.speed).toFixed(4));
      clip.trimEnd = Number((clip.trimStart + clip.duration * init.speed).toFixed(4));
    } else {
      let newEnd = Math.max(init.start + 0.1, init.start + init.duration + dt);
      const desiredDuration = newEnd - init.start;
      const snap = snapForDrag({ start: init.start, duration: desiredDuration, clipId: clip.id, pps: pps.value, edgeOnly: 'right' });
      if (snap) {
        newEnd = snap.start + desiredDuration;
        setSnapGuide({ time: snap.guideTime, type: snap.type, distancePx: snap.distancePx, label: `${snapLabel(snap.type)} ${snap.distancePx.toFixed(1)}px` });
      } else setSnapGuide(null);
      clip.duration = Number(Math.max(0.1, newEnd - init.start).toFixed(4));
      clip.trimEnd = Number((init.trimStart + clip.duration * init.speed).toFixed(4));
    }
    requestPreviewRender();
  };
  const up = () => {
    setSnapGuide(null);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    requestPreviewRender();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function snapLabel(type) {
  return { playhead: '播放头', 'element-start': '片段入点', 'element-end': '片段出点', bookmark: '书签', keyframe: '关键帧', grid: '刻度' }[type] || type;
}

function onEmptyTrackMouseDown(e, track) {
  state.selectedTrackId = track.id;
  clearSelection();
}

// ---------- context menu ----------
function openContextMenu(e, track, clip) {
  selectClip(track.id, clip.id);
  contextTrack.value = track;
  contextClip.value = clip;
  state.contextMenu = { x: e.clientX, y: e.clientY, trackId: track.id, clipId: clip.id };
}
function closeContext() { state.contextMenu = null; }
function runContext(action) {
  const trackId = state.contextMenu?.trackId;
  const clipId = state.contextMenu?.clipId;
  state.contextMenu = null;
  if (!trackId || !clipId) return;
  if (action === 'separate') separateAudio();
  if (action === 'recover') recoverAudio();
  if (action === 'split') splitAtPlayhead();
  if (action === 'ripple') deleteClipById(trackId, clipId, { ripple: true });
  if (action === 'delete') deleteClipById(trackId, clipId, { ripple: false });
}
function onGlobalClick(e) {
  if (state.contextMenu && !e.target.closest?.('.ctx-item')) closeContext();
}
function onKeyDown(e) {
  if (e.key === 'Shift') state.shiftDown = true;
}
function onKeyUp(e) {
  if (e.key === 'Shift') state.shiftDown = false;
}

// ---------- scenes ----------
function beginSceneRename(s) {
  sceneRenameId.value = s.id;
  sceneRenameValue.value = s.name;
}
function commitSceneRename() {
  if (sceneRenameId.value) renameScene(sceneRenameId.value, sceneRenameValue.value.trim() || '场景');
  sceneRenameId.value = null;
}

function zoomStep(dir) {
  const presets = [25, 50, 75, 100, 150, 200, 300];
  const cur = Math.round(pps.value);
  let idx = presets.findIndex((p) => p >= cur);
  if (idx < 0) idx = presets.length - 1;
  idx = Math.max(0, Math.min(presets.length - 1, idx + dir));
  setZoom(presets[idx]);
}
function onWheelZoom(e) {
  setZoom(pps.value + (e.deltaY < 0 ? 10 : -10));
}

onMounted(() => {
  if (headerRef.value) {
    headerW.value = headerRef.value.offsetWidth || HEADER_W;
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => { headerW.value = headerRef.value?.offsetWidth || HEADER_W; });
      ro.observe(headerRef.value);
      headerResizeObserver = ro;
    }
  }
  window.addEventListener('click', onGlobalClick);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
});
onBeforeUnmount(() => {
  headerResizeObserver?.disconnect();
  window.removeEventListener('click', onGlobalClick);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
});
</script>

<style scoped>
.editor-timeline { user-select: none; }
.editor-tl-btn {
  padding: 3px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  color: var(--theme-text-secondary);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.editor-tl-btn:hover { background: var(--theme-bg-hover); color: var(--theme-text-primary); }
.editor-tl-btn.is-on { background: var(--theme-accent-primary); color: var(--theme-accent-text); font-weight: 700; }
.track-mini {
  font-size: 8px;
  line-height: 1;
  padding: 1px 2px;
  border-radius: 3px;
  color: var(--theme-text-secondary);
  cursor: pointer;
}
.track-mini:hover { background: var(--theme-bg-hover); }
.track-mini.is-danger { color: var(--theme-danger-text); }
.track-mini.is-warn { color: var(--theme-warning-text); }
.custom-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.gap-block {
  background: transparent;
  border: 1px dashed transparent;
  z-index: 1;
}
.gap-block:hover {
  background: repeating-linear-gradient(45deg, rgba(255,255,255,0.035) 0 6px, transparent 6px 12px);
  border-color: var(--theme-border);
}
.gap-block.is-on {
  background: var(--theme-warning-bg) !important;
  border: 1px dashed var(--theme-warning-border) !important;
  box-shadow: inset 0 0 0 1px var(--theme-warning-border);
}
.snap-guide { filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.9)); }
.ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 12px;
  color: var(--theme-text-primary);
  cursor: pointer;
  font-size: 12px;
}
.ctx-item:hover { background: var(--theme-bg-hover); }
.ctx-item.danger { color: var(--theme-danger-text); }
:deep(.is-selected) {
  outline: 2px solid var(--theme-accent-secondary);
  outline-offset: -1px;
  box-shadow: 0 0 12px rgba(34, 211, 238, 0.25);
}
:deep(.is-locked) { opacity: 0.75; }
</style>
