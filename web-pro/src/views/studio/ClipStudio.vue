<template>
  <ProjectList v-if="state.view === 'projects' || !state.project" />
  <div v-else class="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-studio-950 text-slate-100 font-sans">
    <!-- 工程栏 -->
    <header class="h-11 bg-studio-900 border-b border-studio-750/80 px-3 flex items-center justify-between shrink-0 gap-2">
      <div class="flex items-center gap-2 min-w-0">
        <button class="px-2 py-1 rounded-lg border border-studio-750 text-[11px] text-slate-300 hover:bg-studio-800 cursor-pointer shrink-0" @click="closeProject">← 工程库</button>
        <input v-model="state.project.name" class="bg-transparent border-b border-dashed border-studio-700 hover:border-studio-accent px-1 text-xs text-white outline-none font-bold min-w-[120px] max-w-[220px]" @change="saveNow" />
        <span class="text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-studio-950 border border-studio-750 shrink-0">
          {{ state.project.canvas.width }}×{{ state.project.canvas.height }} · {{ state.project.fps }}fps
        </span>
        <span class="hidden lg:flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
          <span class="w-3 h-3 rounded border border-studio-750 inline-block" :style="{ background: state.project.canvas.background }"></span>
          {{ state.project.canvas.background }}
        </span>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <span class="text-[10px] font-mono text-slate-500 hidden md:inline">{{ saveLabel }}</span>
        <span v-if="state.saveState === 'error'" class="text-[10px] text-rose-400 max-w-[180px] truncate" :title="state.saveError">保存失败</span>
        <button
          v-if="state.saveState === 'conflict'"
          class="text-[10px] text-amber-300 hover:text-amber-200 underline decoration-dotted max-w-[220px] truncate cursor-pointer"
          :title="state.saveError"
          @click="resolveConflict"
        >工程已在别处修改，点此重载</button>
        <div class="h-4 w-px bg-studio-750"></div>
        <button class="editor-top-btn" :disabled="!state.canUndo" @click="undo" title="撤销 (Ctrl/Cmd+Z)">撤销</button>
        <button class="editor-top-btn" :disabled="!state.canRedo" @click="redo" title="重做 (Ctrl/Cmd+Shift+Z)">重做</button>
        <div class="h-4 w-px bg-studio-750"></div>
        <button class="px-3 py-1.5 rounded-lg bg-studio-accent hover:brightness-110 text-white text-xs font-bold flex items-center gap-1.5 shadow cursor-pointer" @click="openExport">
          <StudioIcon name="download" :size="13" /> 导出
        </button>
      </div>
    </header>

    <!-- 上半：素材 / 预览 / 检查器 -->
    <div class="flex-1 flex overflow-hidden min-h-0 border-b border-studio-750/80">
      <EditorMediaPanel />
      <EditorPreview />
      <EditorInspector />
    </div>

    <!-- 下半：时间轴 -->
    <EditorTimeline />

    <!-- 状态提示 -->
    <div
      v-if="state.message"
      class="fixed right-4 top-16 z-[90] px-3.5 py-2 rounded-xl border shadow-2xl text-xs max-w-sm"
      :class="messageClass"
    >{{ state.message }}</div>

    <!-- 导出弹窗 -->
    <div v-if="state.showExportModal" class="fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4" @click.self="closeExport">
      <div class="w-full max-w-lg rounded-2xl bg-studio-900 border border-studio-700 shadow-2xl p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-studio-800 pb-2">
          <h3 class="text-sm font-extrabold text-white flex items-center gap-2">🎬 导出当前时间轴</h3>
          <button class="text-slate-400 hover:text-white cursor-pointer" @click="closeExport">✕</button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button class="rounded-xl border p-2 text-left cursor-pointer" :class="exportFormat === 'mp4' ? 'border-studio-accent bg-studio-accent/10' : 'border-studio-750'" @click="exportFormat = 'mp4'">
            <div class="text-sm font-bold text-white">MP4</div>
            <div class="text-[10px] text-slate-400">H.264 + AAC，兼容性最好</div>
          </button>
          <button class="rounded-xl border p-2 text-left cursor-not-allowed opacity-50" disabled title="当前导出通道只产出 MP4">
            <div class="text-sm font-bold text-white">WebM</div>
            <div class="text-[10px] text-slate-400">暂未接入，当前只出 MP4</div>
          </button>
        </div>
        <div class="text-[11px] text-slate-400 font-mono grid grid-cols-2 gap-1">
          <span>画布：{{ state.project.canvas.width }}×{{ state.project.canvas.height }}</span>
          <span>帧率：{{ state.project.fps }} fps</span>
          <span>时长：{{ duration.toFixed(2) }}s</span>
          <span>帧数：{{ Math.round(duration * state.project.fps) }}</span>
        </div>
        <p class="text-[11px] text-slate-400 leading-relaxed">
          逐帧渲染当前工程，再由本机 ffmpeg 混成 mp4。成片写入素材库成品架，并记下用过的素材。时长按当前工程，不用示例片顶替。
        </p>

        <div v-if="state.exporting" class="space-y-2">
          <div class="flex items-center justify-between text-[11px] text-slate-300">
            <span>{{ state.exportStage }}</span><span class="font-mono">{{ state.exportProgress }}%</span>
          </div>
          <div class="h-2 rounded-full bg-studio-950 overflow-hidden border border-studio-800">
            <div class="h-full bg-studio-accent transition-all" :style="{ width: `${state.exportProgress}%` }"></div>
          </div>
          <button class="px-3 py-1.5 rounded-lg border border-studio-750 text-[11px] text-slate-300 cursor-pointer" @click="cancelExport">取消导出</button>
        </div>

        <div v-if="state.exportError" class="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-300">
          {{ state.exportError }}
        </div>

        <div v-if="state.exportResult" class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-[11px] space-y-1">
          <div class="font-bold text-emerald-300">导出完成 · {{ state.exportResult.duration.toFixed(2) }}s</div>
          <div class="font-mono text-slate-300 break-all">{{ state.exportResult.file }}</div>
          <div class="text-slate-400">成品架 · {{ state.exportResult.audioClips }} 条音频参与混流 · {{ state.exportResult.frames }} 帧</div>
          <div class="flex gap-2 pt-1">
            <a :href="state.exportResult.url" :download="state.exportResult.file" class="px-3 py-1 rounded bg-studio-accent text-white font-bold cursor-pointer">下载成片</a>
            <a :href="state.exportResult.url" target="_blank" class="px-3 py-1 rounded border border-studio-750 text-slate-300 cursor-pointer">新窗口播放</a>
          </div>
        </div>

        <div v-if="recentExports.length" class="border-t border-studio-800 pt-2 max-h-32 overflow-y-auto">
          <div class="text-[10px] text-slate-500 mb-1">最近导出（本包 export-check）</div>
          <div v-for="ex in recentExports" :key="ex.file" class="flex items-center justify-between text-[10px] font-mono text-slate-400 py-0.5">
            <span class="truncate">{{ ex.file }}</span>
            <span class="shrink-0">{{ ex.meta ? ex.meta.duration.toFixed(2) + 's' : '' }}</span>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <button class="px-3 py-2 rounded-lg border border-studio-750 text-xs text-slate-300 cursor-pointer" @click="closeExport">关闭</button>
          <button class="px-4 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" :disabled="state.exporting" @click="doExport">
            {{ state.exporting ? '导出中…' : '开始导出' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';
import ProjectList from '../../components/editor/ProjectList.vue';
import EditorPreview from '../../components/editor/EditorPreview.vue';
import EditorTimeline from '../../components/editor/EditorTimeline.vue';
import EditorInspector from '../../components/editor/EditorInspector.vue';
import EditorMediaPanel from '../../components/editor/EditorMediaPanel.vue';
import {
  addBookmark, cancelExport, clearSelection, closeProject, deleteSelectedClip,
  duration, exportVideo, flushSave, loadProjects, openProject, redo, reloadAfterConflict, saveNow,
  seek, state, stepFrame, togglePlay, undo, splitAtPlayhead, requestPreviewRender,
} from '../../editor/store.js';

const exportFormat = ref('mp4');
const recentExports = ref([]);

// 冲突只给一次机会：本地改动会被服务端版本替换，所以先让用户确认。
function resolveConflict() {
  const ok = window.confirm(
    '这个工程在另一个窗口里被修改过。\n\n重载会丢弃当前窗口未保存的改动，继续？',
  );
  if (!ok) return;
  reloadAfterConflict();
}

const saveLabel = computed(() => {
  if (!state.project) return '';
  if (state.saveState === 'saving') return '保存中…';
  if (state.saveState === 'conflict') return '存在冲突';
  if (state.saveState === 'error') return '保存失败';
  if (state.lastSavedAt) return '已保存';
  return '已保存';
});
const messageClass = computed(() => ({
  'bg-studio-900 border-studio-750 text-slate-200': state.messageKind === 'info',
  'bg-emerald-500/15 border-emerald-500/50 text-emerald-300': state.messageKind === 'ok',
  'bg-amber-500/15 border-amber-500/50 text-amber-300': state.messageKind === 'warn',
  'bg-rose-500/15 border-rose-500/50 text-rose-300': state.messageKind === 'error',
}));

function openExport() {
  state.showExportModal = true;
  state.exportError = '';
  refreshExports();
}
function closeExport() {
  if (state.exporting) return;
  state.showExportModal = false;
}
async function doExport() {
  await exportVideo({ format: exportFormat.value });
  await refreshExports();
}
async function refreshExports() {
  try {
    const res = await fetch('/editor-api/export/list');
    if (res.ok) recentExports.value = (await res.json()).items || [];
  } catch { /* ignore */ }
}

function onKeydown(e) {
  if (state.exporting) return;
  const tag = (e.target?.tagName || '').toLowerCase();
  const editing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
  if (editing) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); splitAtPlayhead(); return; }
  if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); return; }
  if (!mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); splitAtPlayhead(); return; }
  if (!mod && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); state.snapping = !state.snapping; return; }
  if (!mod && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); addBookmark(); return; }
  if (e.key === 'Escape') { clearSelection(); state.contextMenu = null; state.showExportModal = false; return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!state.selectedClipId && !state.selectedGap) return;
    e.preventDefault();
    deleteSelectedClip({ ripple: e.shiftKey });
  }
}
function onBeforeUnload() { flushSave(); }

onMounted(async () => {
  await loadProjects();
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('beforeunload', onBeforeUnload);
});
</script>

<style scoped>
.editor-top-btn {
  padding: 5px 9px;
  border-radius: 8px;
  color: var(--theme-text-secondary);
  font-size: 11px;
  cursor: pointer;
}
.editor-top-btn:hover:not(:disabled) { background: var(--theme-bg-hover); color: var(--theme-text-primary); }
.editor-top-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
