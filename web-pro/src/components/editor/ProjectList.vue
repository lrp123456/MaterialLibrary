<template>
  <div class="flex-1 flex flex-col h-full overflow-hidden bg-studio-950 text-slate-100">
    <div class="px-6 pt-5 pb-3 flex items-end justify-between shrink-0 border-b border-studio-750/70">
      <div>
        <h1 class="text-lg font-extrabold text-white">工程库</h1>
        <p class="text-xs text-slate-400 mt-1">新建、改名、删除、再打开。画布/帧率/背景/缩放/播放头随工程保存。</p>
      </div>
      <button
        class="px-4 py-2 rounded-xl bg-studio-accent text-white text-sm font-bold shadow hover:brightness-110 cursor-pointer flex items-center gap-2"
        @click="openCreate"
      >
        <StudioIcon name="plus" :size="15" /> 新建工程
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-6">
      <div v-if="state.loading" class="text-sm text-slate-400">正在读取工程…</div>
      <div v-else-if="!state.projects.length" class="max-w-md mx-auto mt-16 text-center space-y-3">
        <div class="text-4xl">🎬</div>
        <p class="text-sm text-slate-300">还没有工程。新建一个，或重启服务让示例工程重新预置。</p>
        <button class="px-4 py-2 rounded-xl bg-studio-accent text-white text-sm font-bold cursor-pointer" @click="openCreate">新建工程</button>
      </div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <article
          v-for="p in state.projects"
          :key="p.id"
          class="rounded-2xl border border-studio-750 bg-studio-850 p-4 flex flex-col gap-3 hover:border-studio-accent transition-colors"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 class="text-sm font-extrabold text-white truncate" :title="p.name">{{ p.name }}</h2>
              <div class="text-[11px] text-slate-400 font-mono mt-1">
                {{ p.canvas ? `${p.canvas.width}×${p.canvas.height}` : '—' }} · {{ p.fps || '—' }}fps · {{ (p.duration || 0).toFixed(1) }}s
              </div>
              <div class="text-[10px] text-slate-500 mt-1">{{ p.scenes }} 个场景 · 更新于 {{ formatDate(p.updatedAt) }}</div>
            </div>
            <span v-if="p.id === 'demo-project'" class="text-[10px] px-1.5 py-0.5 rounded bg-studio-accent/20 border border-studio-accent text-studio-cyan shrink-0">示例</span>
          </div>
          <div class="flex items-center gap-2 mt-auto">
            <button class="flex-1 py-1.5 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" @click="open(p.id)">打开</button>
            <button class="px-2.5 py-1.5 rounded-lg border border-studio-750 text-xs text-slate-300 cursor-pointer" @click="startRename(p)">改名</button>
            <button class="px-2.5 py-1.5 rounded-lg border border-rose-500/40 text-xs text-rose-400 cursor-pointer" @click="askDelete(p)">删除</button>
          </div>
        </article>
      </div>
    </div>

    <!-- 新建工程 -->
    <div v-if="showCreate" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" @click.self="showCreate = false">
      <div class="w-full max-w-lg rounded-2xl bg-studio-900 border border-studio-700 shadow-2xl p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-studio-800 pb-2">
          <h3 class="text-sm font-extrabold text-white">新建工程</h3>
          <button class="text-slate-400 hover:text-white cursor-pointer" @click="showCreate = false">✕</button>
        </div>
        <label class="block text-xs text-slate-400">工程名
          <input v-model="form.name" class="mt-1 w-full rounded-lg border border-studio-750 bg-studio-950 px-3 py-2 text-sm text-white outline-none" />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-xs text-slate-400">画布尺寸
            <select v-model="form.preset" class="mt-1 w-full rounded-lg border border-studio-750 bg-studio-950 px-3 py-2 text-sm text-white outline-none">
              <option v-for="preset in presets" :key="preset.label" :value="preset.label">{{ preset.label }}</option>
            </select>
          </label>
          <label class="block text-xs text-slate-400">帧率
            <select v-model.number="form.fps" class="mt-1 w-full rounded-lg border border-studio-750 bg-studio-950 px-3 py-2 text-sm text-white outline-none">
              <option v-for="f in [24, 25, 30, 60]" :key="f" :value="f">{{ f }} fps</option>
            </select>
          </label>
        </div>
        <div class="flex items-center gap-3">
          <label class="text-xs text-slate-400">背景色</label>
          <input v-model="form.background" type="color" class="w-12 h-8 rounded border border-studio-750 bg-transparent cursor-pointer" />
          <span class="text-[11px] font-mono text-slate-400">{{ form.background }}</span>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="px-3 py-2 rounded-lg border border-studio-750 text-xs text-slate-300 cursor-pointer" @click="showCreate = false">取消</button>
          <button class="px-4 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" @click="create">创建并打开</button>
        </div>
      </div>
    </div>

    <!-- 改名 -->
    <div v-if="renameTarget" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" @click.self="renameTarget = null">
      <div class="w-full max-w-sm rounded-2xl bg-studio-900 border border-studio-700 p-5 space-y-4">
        <h3 class="text-sm font-extrabold text-white">工程改名</h3>
        <input v-model="renameValue" class="w-full rounded-lg border border-studio-750 bg-studio-950 px-3 py-2 text-sm text-white outline-none" @keyup.enter="doRename" />
        <div class="flex justify-end gap-2">
          <button class="px-3 py-2 rounded-lg border border-studio-750 text-xs cursor-pointer" @click="renameTarget = null">取消</button>
          <button class="px-4 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" @click="doRename">保存</button>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="deleteTarget" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" @click.self="deleteTarget = null">
      <div class="w-full max-w-sm rounded-2xl bg-studio-900 border border-studio-700 p-5 space-y-4">
        <h3 class="text-sm font-extrabold text-white">删除工程</h3>
        <p class="text-sm text-slate-300">确定删除「{{ deleteTarget.name }}」？此操作不可恢复。</p>
        <div class="flex justify-end gap-2">
          <button class="px-3 py-2 rounded-lg border border-studio-750 text-xs cursor-pointer" @click="deleteTarget = null">取消</button>
          <button class="px-4 py-2 rounded-lg bg-rose-500/80 text-white text-xs font-bold cursor-pointer" @click="doDelete">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import StudioIcon from '../StudioIcon.vue';
import { createProject, deleteProject, openProject, renameProject, state } from '../../editor/store.js';

const presets = [
  { label: '1280×720 横屏', width: 1280, height: 720 },
  { label: '1920×1080 全高清', width: 1920, height: 1080 },
  { label: '1080×1920 竖屏', width: 1080, height: 1920 },
  { label: '1080×1080 方形', width: 1080, height: 1080 },
];
const showCreate = ref(false);
const renameTarget = ref(null);
const renameValue = ref('');
const deleteTarget = ref(null);
const form = reactive({ name: '室内漫游剪辑工程', preset: presets[0].label, fps: 30, background: '#0b1020' });

function openCreate() {
  form.name = `新剪辑工程 ${state.projects.length + 1}`;
  form.preset = presets[0].label;
  form.fps = 30;
  form.background = '#0b1020';
  showCreate.value = true;
}

async function create() {
  const preset = presets.find((p) => p.label === form.preset) || presets[0];
  await createProject({
    name: form.name.trim() || '未命名工程',
    canvas: { width: preset.width, height: preset.height, background: form.background },
    fps: form.fps,
  });
  showCreate.value = false;
}

async function open(id) {
  await openProject(id);
}

function startRename(p) {
  renameTarget.value = p;
  renameValue.value = p.name;
}

async function doRename() {
  if (!renameTarget.value) return;
  await renameProject(renameTarget.value.id, renameValue.value.trim() || renameTarget.value.name);
  renameTarget.value = null;
}

function askDelete(p) { deleteTarget.value = p; }
async function doDelete() {
  if (!deleteTarget.value) return;
  await deleteProject(deleteTarget.value.id);
  deleteTarget.value = null;
}

function formatDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>
