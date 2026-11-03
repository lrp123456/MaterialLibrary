<template>
  <div class="product-3d-manager flex flex-col h-full min-h-0 bg-studio-950 text-slate-100 select-none">
    <!-- 顶部工具栏：品类筛选 + 搜索 + 上传 -->
    <div class="p-3 border-b border-studio-800 flex flex-wrap items-center justify-between gap-3 bg-studio-900/60">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <span class="text-amber-400">🛋️</span>
          <span>3D 单品家具库</span>
        </span>
        <div class="flex items-center gap-1 ml-2">
          <button
            v-for="cat in CATEGORIES"
            :key="cat.key"
            type="button"
            class="px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer"
            :class="selectedCategory === cat.key ? 'bg-studio-accent text-white font-bold' : 'bg-studio-850 text-slate-400 hover:text-white'"
            @click="selectedCategory = cat.key"
          >
            {{ cat.label }}
          </button>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <input
          v-model="searchQ"
          type="text"
          placeholder="搜索家具名称/标签…"
          class="px-2.5 py-1 rounded-lg bg-studio-850 border border-studio-700 text-xs text-slate-200 placeholder-slate-500 w-44 outline-none focus:border-studio-cyan"
        />
        <button
          type="button"
          @click="openUploadModal"
          class="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center gap-1.5 shadow transition cursor-pointer"
        >
          <span>+ 上传 3D 模型</span>
        </button>
      </div>
    </div>

    <!-- 列表主区域 -->
    <div class="flex-1 min-h-0 overflow-y-auto p-4">
      <div v-if="loading" class="py-16 text-center text-xs text-slate-500">
        正在读取 3D 家具单品库…
      </div>
      <div v-else-if="filteredPresets.length === 0" class="py-16 text-center space-y-2">
        <div class="text-3xl">🛋️</div>
        <div class="text-sm font-bold text-slate-300">暂无 3D 家具单品</div>
        <div class="text-xs text-slate-500">点击右上角「+ 上传 3D 模型」录入 GLB/GLTF 文件</div>
      </div>
      <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <div
          v-for="item in filteredPresets"
          :key="item.id"
          class="rounded-xl border border-studio-800 bg-studio-900/90 hover:bg-studio-850/90 overflow-hidden flex flex-col group hover:border-studio-cyan/40 hover:shadow-[0_8px_30px_rgb(0,0,0,0.45)] hover:-translate-y-0.5 transition-all duration-300"
        >
          <!-- 预览图 / 烘焙图 -->
          <div class="relative w-full aspect-[4/3] bg-gradient-to-b from-slate-900/90 via-studio-900 to-studio-950 flex items-center justify-center overflow-hidden">
            <!-- 展台光影背景 -->
            <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_70%,rgba(56,189,248,0.06),transparent_70%)] pointer-events-none"></div>

            <!-- 骨架屏加载中 -->
            <div
              v-if="!imageLoadedMap[item.id] && !imageErrorMap[item.id]"
              class="absolute inset-0 flex items-center justify-center bg-studio-900/60 animate-pulse"
            >
              <div class="w-8 h-8 rounded-full border-2 border-studio-cyan/30 border-t-studio-cyan animate-spin"></div>
            </div>

            <!-- 真实渲染图（优先多视角回退链） -->
            <img
              v-if="!imageErrorMap[item.id] && getProductThumbnail(item)"
              :src="getProductThumbnail(item)"
              class="w-full h-full object-contain p-2 group-hover:scale-105 transition-all duration-300 ease-out"
              :class="imageLoadedMap[item.id] ? 'opacity-100' : 'opacity-0'"
              :alt="item.name"
              loading="lazy"
              @load="onImageLoaded(item.id)"
              @error="onImageError(item.id)"
            />

            <!-- 优雅轻量 3D 单品占位卡片（绝不暴露死黑底色） -->
            <div
              v-else
              class="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-gradient-to-b from-slate-850 to-studio-950 select-none"
            >
              <div class="w-12 h-12 rounded-xl bg-studio-800/80 border border-studio-700/60 flex items-center justify-center text-2xl shadow-inner mb-1.5 text-studio-cyan">
                🛋️
              </div>
              <span class="text-xs font-semibold text-slate-300">{{ item.name }}</span>
              <span class="text-[10px] text-studio-cyan/80 mt-0.5">3D 单品待烘焙</span>
            </div>

            <!-- 朝向徽标 -->
            <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-sm border border-white/10 text-[10px] font-mono text-studio-cyan shadow">
              标准 {{ item.facing || 45 }}°
            </div>

            <!-- 标定朝向快捷浮层 -->
            <button
              type="button"
              @click="openViewerModal(item)"
              class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 cursor-pointer backdrop-blur-[1px]"
            >
              <span class="px-3 py-1.5 rounded-lg bg-studio-accent hover:bg-studio-accent/90 text-white font-bold text-xs flex items-center gap-1 shadow-lg transform group-hover:scale-105 transition">
                <span>🔄 3D 旋转预览 / 标定朝向</span>
              </span>
            </button>
          </div>

          <!-- 信息体 -->
          <div class="p-3 flex-1 flex flex-col justify-between gap-2">
            <div>
              <div class="font-bold text-sm text-slate-100 truncate" :title="item.name">
                {{ item.name }}
              </div>
              <div class="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-1">
                <span class="px-1.5 py-0.2 rounded bg-studio-800 text-slate-300">
                  {{ categoryLabel(item.category) }}
                </span>
                <span v-if="item.dimensions && item.dimensions.width">
                  {{ item.dimensions.width }}×{{ item.dimensions.depth || item.dimensions.width }}×{{ item.dimensions.height }} mm
                </span>
              </div>
            </div>

            <!-- 底部操作 -->
            <div class="flex items-center justify-between pt-2 border-t border-studio-850 text-xs">
              <button
                type="button"
                @click="openEditModal(item)"
                class="text-studio-cyan hover:underline cursor-pointer"
              >
                编辑参数
              </button>
              <button
                type="button"
                @click="deletePreset(item)"
                class="text-slate-500 hover:text-rose-400 cursor-pointer"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 模态框 1：3D 交互查看器与标准朝向快照烘焙器 -->
    <div
      v-if="viewerModalOpen && activeModelItem"
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none"
    >
      <div class="w-full max-w-3xl rounded-2xl bg-studio-900 border border-studio-700 shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        <div class="p-4 border-b border-studio-800 flex items-center justify-between">
          <div>
            <div class="text-base font-bold text-white flex items-center gap-2">
              <span>{{ activeModelItem.name }}</span>
              <span class="text-xs px-2 py-0.5 rounded bg-studio-800 text-studio-cyan font-mono">
                标准朝向烘焙与三维视口
              </span>
            </div>
            <div class="text-xs text-slate-400 mt-0.5">
              鼠标左键拖拽旋转 360°，滚轮缩放，下方点击标准视角即可一键对准机位
            </div>
          </div>
          <button
            type="button"
            class="text-slate-400 hover:text-white text-lg p-1 cursor-pointer"
            @click="viewerModalOpen = false"
          >
            ✕
          </button>
        </div>

        <!-- 3D 核心渲染区 -->
        <div class="relative w-full h-96 bg-gradient-to-b from-slate-900 to-studio-950 flex items-center justify-center">
          <model-viewer
            ref="modelViewerRef"
            :src="activeModelItem.model_url"
            camera-controls
            shadow-intensity="1.5"
            environment-image="neutral"
            exposure="1.0"
            class="w-full h-full"
            style="--poster-color: transparent;"
          ></model-viewer>

          <!-- 烘焙中加载遮罩 -->
          <div v-if="bakingSnapshot" class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
            <div class="w-6 h-6 border-2 border-studio-accent border-t-transparent rounded-full animate-spin"></div>
            <span class="text-xs font-bold text-white">正在捕获透明透视快照并保存至服务端…</span>
          </div>
        </div>

        <!-- 标准视角一键对齐与快照烘焙条 -->
        <div class="p-4 border-t border-studio-800 bg-studio-950 space-y-3">
          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-300 font-bold">标准空间朝向快速对齐：</span>
            <span class="text-slate-500 font-mono">点击视角一键旋转模型</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-for="ang in STANDARD_ANGLES"
              :key="ang.key"
              type="button"
              @click="alignViewerAngle(ang)"
              class="px-3 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-700 hover:border-studio-cyan text-xs font-medium cursor-pointer transition flex items-center gap-1.5"
            >
              <span>{{ ang.icon }}</span>
              <span>{{ ang.label }}</span>
              <span v-if="activeModelItem.snapshots && activeModelItem.snapshots[ang.key]" class="text-[9px] text-emerald-400">●已烘焙</span>
            </button>
          </div>

          <!-- 烘焙操作与反馈 -->
          <div class="flex items-center justify-between pt-2 border-t border-studio-850 text-xs">
            <div class="text-slate-400">
              当前视角对齐后，点击右侧将当前 3D 姿态固化为生图参考底图：
            </div>
            <button
              type="button"
              :disabled="bakingSnapshot"
              @click="bakeCurrentViewSnapshot"
              class="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1.5 shadow transition cursor-pointer disabled:opacity-50"
            >
              <span>📸 捕获当前视角为生图标准快照</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 模态框 2：新建 / 编辑 3D 单品家具参数 -->
    <div
      v-if="editModalOpen"
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none"
    >
      <div class="w-full max-w-lg rounded-2xl bg-studio-900 border border-studio-700 shadow-2xl p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-studio-800 pb-3">
          <h3 class="text-base font-bold text-white">
            {{ editForm.id ? '编辑 3D 单品家具' : '上传新 3D 模型单品' }}
          </h3>
          <button type="button" class="text-slate-400 hover:text-white" @click="editModalOpen = false">✕</button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block text-slate-400 mb-1">家具单品名称 *</label>
            <input
              v-model="editForm.name"
              type="text"
              placeholder="如：极简单人电动真皮沙发"
              class="w-full px-3 py-2 rounded-lg bg-studio-850 border border-studio-700 text-white outline-none focus:border-studio-cyan"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-400 mb-1">所属品类</label>
              <select
                v-model="editForm.category"
                class="w-full px-3 py-2 rounded-lg bg-studio-850 border border-studio-700 text-white outline-none"
              >
                <option value="furniture">软体家具 (沙发/单人椅)</option>
                <option value="table">桌几类 (餐桌/茶几/边几)</option>
                <option value="cabinet">柜架类 (定制柜/边柜)</option>
                <option value="lighting">灯具软装</option>
              </select>
            </div>
            <div>
              <label class="block text-slate-400 mb-1">默认朝向偏航角 (°)</label>
              <input
                v-model.number="editForm.facing"
                type="number"
                step="5"
                class="w-full px-3 py-2 rounded-lg bg-studio-850 border border-studio-700 text-white outline-none"
              />
            </div>
          </div>

          <div>
            <label class="block text-slate-400 mb-1">人体工学真实三维尺寸 (mm)</label>
            <div class="grid grid-cols-3 gap-2">
              <input
                v-model.number="editForm.width"
                type="number"
                placeholder="宽 W (如 950)"
                class="px-2.5 py-1.5 rounded-lg bg-studio-850 border border-studio-700 text-white outline-none"
              />
              <input
                v-model.number="editForm.depth"
                type="number"
                placeholder="深 D (如 1050)"
                class="px-2.5 py-1.5 rounded-lg bg-studio-850 border border-studio-700 text-white outline-none"
              />
              <input
                v-model.number="editForm.height"
                type="number"
                placeholder="高 H (如 920)"
                class="px-2.5 py-1.5 rounded-lg bg-studio-850 border border-studio-700 text-white outline-none"
              />
            </div>
          </div>

          <div v-if="!editForm.id">
            <label class="block text-slate-400 mb-1">本地 3D 模型文件 (.glb / .gltf) *</label>
            <input
              type="file"
              accept=".glb,.gltf"
              @change="onFileSelected"
              class="w-full text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-studio-800 file:text-studio-cyan file:font-bold file:cursor-pointer"
            />
          </div>

          <!-- 模型即时 3D 渲染与自动快照捕获区 -->
          <div v-if="tempModelUrl" class="rounded-xl border border-studio-700 bg-studio-950 p-2.5 overflow-hidden space-y-1.5">
            <div class="flex items-center justify-between text-[11px] text-slate-300 px-0.5">
              <span class="flex items-center gap-1 font-semibold text-studio-cyan">
                <span>✨ 3D 模型已就绪 (实时捕获高分辨率快照)</span>
              </span>
              <span v-if="uploadSnapshotCaptured" class="text-emerald-400 font-mono text-[10px] flex items-center gap-1">
                <span>●</span><span>快照已就绪</span>
              </span>
              <span v-else class="text-amber-400 font-mono text-[10px] flex items-center gap-1 animate-pulse">
                <span>●</span><span>正在捕获快照…</span>
              </span>
            </div>
            <div class="relative w-full h-44 rounded-lg bg-gradient-to-b from-slate-900 to-studio-950 flex items-center justify-center overflow-hidden border border-studio-800">
              <model-viewer
                ref="uploadViewerRef"
                :src="tempModelUrl"
                camera-controls
                auto-rotate
                shadow-intensity="1.5"
                environment-image="neutral"
                exposure="1.0"
                class="w-full h-full"
                style="--poster-color: transparent;"
                @load="onUploadModelLoaded"
              ></model-viewer>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-studio-800">
          <button
            type="button"
            @click="closeEditModal"
            class="px-4 py-2 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-300 font-bold text-xs cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            :disabled="submitting"
            @click="submitEditForm"
            class="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs cursor-pointer disabled:opacity-50"
          >
            {{ submitting ? '保存中…' : '确认保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { getToken } from '../../api';
import { ensureModelViewer } from '../../utils/model-viewer.js';

const CATEGORIES = [
  { key: 'all', label: '全部单品' },
  { key: 'furniture', label: '沙发座椅' },
  { key: 'table', label: '桌几类' },
  { key: 'cabinet', label: '柜架类' },
  { key: 'lighting', label: '灯具软装' }
];

const STANDARD_ANGLES = [
  { key: 'front_0', label: '0° 正面直视', icon: '⬆️', yaw: 0, pitch: 80 },
  { key: 'right_45', label: '45° 右前客厅摆位', icon: '↗️', yaw: 45, pitch: 75 },
  { key: 'right_90', label: '90° 正侧立面', icon: '➡️', yaw: 90, pitch: 80 },
  { key: 'back_180', label: '180° 正背面', icon: '⬇️', yaw: 180, pitch: 80 },
  { key: 'left_45', label: '315° 左前摆位', icon: '↖️', yaw: -45, pitch: 75 }
];

const presets = ref([]);
const loading = ref(false);
const submitting = ref(false);
const selectedCategory = ref('all');
const searchQ = ref('');

const viewerModalOpen = ref(false);
const activeModelItem = ref(null);
const modelViewerRef = ref(null);
const currentViewerAngle = ref('right_45');
const bakingSnapshot = ref(false);

const editModalOpen = ref(false);
const editForm = ref({
  id: '',
  name: '',
  category: 'furniture',
  facing: 45,
  width: 950,
  depth: 1050,
  height: 920,
  fileB64: ''
});

// 卡片图片加载状态与骨架屏追踪
const imageLoadedMap = ref({});
const imageErrorMap = ref({});

// 上传模态框实时 3D 渲染与自动捕获快照
const uploadViewerRef = ref(null);
const tempModelUrl = ref('');
const uploadSnapshotB64 = ref('');
const uploadSnapshotCaptured = ref(false);
const uploadSnapshotsMap = ref({});

// 缩略图回退链解析：right_45 -> front -> front_0 -> 任意首视角 -> preview_url
function getProductThumbnail(item) {
  if (item.snapshots && typeof item.snapshots === 'object') {
    if (item.snapshots.right_45) return item.snapshots.right_45;
    if (item.snapshots.front) return item.snapshots.front;
    if (item.snapshots.front_0) return item.snapshots.front_0;
    const firstVal = Object.values(item.snapshots).find(v => typeof v === 'string' && v.length > 0);
    if (firstVal) return firstVal;
  }
  return item.preview_url || '';
}

function onImageLoaded(id) {
  imageLoadedMap.value = { ...imageLoadedMap.value, [id]: true };
}

function onImageError(id) {
  imageErrorMap.value = { ...imageErrorMap.value, [id]: true };
}

const filteredPresets = computed(() => {
  return presets.value.filter(p => {
    if (selectedCategory.value !== 'all' && p.category !== selectedCategory.value) return false;
    if (searchQ.value) {
      const q = searchQ.value.toLowerCase();
      const matchName = String(p.name || '').toLowerCase().includes(q);
      const matchTags = (p.tags || []).some(t => String(t).toLowerCase().includes(q));
      if (!matchName && !matchTags) return false;
    }
    return true;
  });
});

function categoryLabel(cat) {
  const map = {
    furniture: '软体沙发',
    table: '桌几类',
    cabinet: '柜架类',
    lighting: '灯具软装'
  };
  return map[cat] || '家具单品';
}

async function loadPresets() {
  loading.value = true;
  try {
    const res = await fetch('/api/products/presets', {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const json = await res.json();
    if (json.success) {
      presets.value = json.data || [];
    }
  } catch (err) {
    console.warn('读取 3D 单品失败:', err);
  } finally {
    loading.value = false;
  }
}

function openViewerModal(item) {
  activeModelItem.value = item;
  viewerModalOpen.value = true;
  currentViewerAngle.value = 'right_45';
}

function alignViewerAngle(ang) {
  currentViewerAngle.value = ang.key;
  if (!modelViewerRef.value) return;
  const mv = modelViewerRef.value;
  // 设置相机轨道角度：camera-orbit="theta phi radius"
  mv.cameraOrbit = `${ang.yaw}deg ${ang.pitch || 75}deg auto`;
  mv.jumpCameraToGoal();
}

async function bakeCurrentViewSnapshot() {
  if (!modelViewerRef.value || !activeModelItem.value) return;
  bakingSnapshot.value = true;
  try {
    const mv = modelViewerRef.value;
    const b64 = mv.toDataURL('image/png');
    const angleKey = currentViewerAngle.value || 'right_45';

    const res = await fetch(`/api/products/presets/${encodeURIComponent(activeModelItem.value.id)}/snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        snapshots: {
          [angleKey]: b64
        }
      })
    });
    const json = await res.json();
    if (json.success && json.data) {
      if (!activeModelItem.value.snapshots) activeModelItem.value.snapshots = {};
      activeModelItem.value.snapshots[angleKey] = json.data.snapshots[angleKey];
      // 同步更新列表中对应项
      const hit = presets.value.find(p => p.id === activeModelItem.value.id);
      if (hit) {
        hit.snapshots = json.data.snapshots;
      }
    }
  } catch (err) {
    alert('保存标准快照失败: ' + err.message);
  } finally {
    bakingSnapshot.value = false;
  }
}

function openUploadModal() {
  if (tempModelUrl.value) {
    URL.revokeObjectURL(tempModelUrl.value);
    tempModelUrl.value = '';
  }
  uploadSnapshotCaptured.value = false;
  uploadSnapshotB64.value = '';
  uploadSnapshotsMap.value = {};
  editForm.value = {
    id: '',
    name: '',
    category: 'furniture',
    facing: 45,
    width: 950,
    depth: 1050,
    height: 920,
    fileB64: ''
  };
  editModalOpen.value = true;
}

function openEditModal(item) {
  if (tempModelUrl.value) {
    URL.revokeObjectURL(tempModelUrl.value);
    tempModelUrl.value = '';
  }
  uploadSnapshotCaptured.value = false;
  uploadSnapshotB64.value = '';
  uploadSnapshotsMap.value = {};
  editForm.value = {
    id: item.id,
    name: item.name,
    category: item.category || 'furniture',
    facing: item.facing || 45,
    width: item.dimensions?.width || 950,
    depth: item.dimensions?.depth || 1050,
    height: item.dimensions?.height || 920,
    fileB64: ''
  };
  editModalOpen.value = true;
}

function onFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!editForm.value.name) {
    editForm.value.name = file.name.replace(/\.[^.]+$/, '');
  }
  if (tempModelUrl.value) {
    URL.revokeObjectURL(tempModelUrl.value);
  }
  tempModelUrl.value = URL.createObjectURL(file);
  uploadSnapshotCaptured.value = false;
  uploadSnapshotB64.value = '';
  uploadSnapshotsMap.value = {};

  const reader = new FileReader();
  reader.onload = () => {
    editForm.value.fileB64 = reader.result;
  };
  reader.readAsDataURL(file);
}

// model-viewer 相机跳转后的真实渲染完成判定：
// 连续 3 个 rAF 输出 PNG 体积稳定（且超过最小阈值），说明慢 GPU 也已画完；
// 不再用 100/150/200ms 固定睡眠（慢 GPU 会截到空白 PNG，快 GPU 又白等）。
function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
async function waitForStableCapture(mv, { timeoutMs = 4000, minBytes = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let prevLen = 0;
  let stableRounds = 0;
  while (Date.now() < deadline) {
    await nextFrame();
    const url = mv.toDataURL('image/png');
    if (url.length >= minBytes && url.length === prevLen) {
      stableRounds++;
      if (stableRounds >= 3) return url;
    } else {
      stableRounds = 0;
    }
    prevLen = url.length;
  }
  // 超时兜底：至少返回当前画面（可能不完美，但不阻塞上传流程）
  return mv.toDataURL('image/png');
}

async function onUploadModelLoaded() {
  if (!uploadViewerRef.value) return;
  try {
    const mv = uploadViewerRef.value;
    mv.cameraOrbit = '45deg 75deg auto';
    mv.jumpCameraToGoal();
    const b64_45 = await waitForStableCapture(mv);
    uploadSnapshotB64.value = b64_45;

    mv.cameraOrbit = '0deg 80deg auto';
    mv.jumpCameraToGoal();
    const b64_front = await waitForStableCapture(mv);

    uploadSnapshotsMap.value = {
      right_45: b64_45,
      front: b64_front,
      front_0: b64_front
    };
    uploadSnapshotCaptured.value = true;
  } catch (err) {
    console.warn('自动捕获 3D 模型快照异常:', err);
  }
}

async function submitEditForm() {
  if (!editForm.value.name) {
    alert('请输入家具名称');
    return;
  }
  submitting.value = true;
  try {
    if (editForm.value.id) {
      // 更新
      const res = await fetch(`/api/products/presets/${encodeURIComponent(editForm.value.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          name: editForm.value.name,
          category: editForm.value.category,
          facing: editForm.value.facing,
          dimensions: {
            width: editForm.value.width,
            depth: editForm.value.depth,
            height: editForm.value.height
          }
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '更新失败');
    } else {
      // 新建
      if (!editForm.value.fileB64) {
        alert('请选择 GLB/GLTF 模型文件');
        submitting.value = false;
        return;
      }
      const payload = {
        name: editForm.value.name,
        category: editForm.value.category,
        facing: editForm.value.facing,
        model_b64: editForm.value.fileB64,
        preview_b64: uploadSnapshotB64.value || '',
        dimensions: {
          width: editForm.value.width,
          depth: editForm.value.depth,
          height: editForm.value.height
        }
      };
      if (uploadSnapshotsMap.value && Object.keys(uploadSnapshotsMap.value).length > 0) {
        payload.snapshots = uploadSnapshotsMap.value;
      }
      const res = await fetch('/api/products/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '上传失败');
    }
    if (tempModelUrl.value) {
      URL.revokeObjectURL(tempModelUrl.value);
      tempModelUrl.value = '';
    }
    editModalOpen.value = false;
    await loadPresets();
  } catch (err) {
    alert('保存失败: ' + err.message);
  } finally {
    submitting.value = false;
  }
}

async function deletePreset(item) {
  if (!confirm(`确认删除 3D 单品模型「${item.name}」吗？`)) return;
  try {
    const res = await fetch(`/api/products/presets/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const json = await res.json();
    if (json.success) {
      presets.value = presets.value.filter(p => p.id !== item.id);
    }
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}

function releaseTempModel() {
  if (tempModelUrl.value) {
    URL.revokeObjectURL(tempModelUrl.value);
    tempModelUrl.value = '';
  }
}

// 取消/关闭弹窗（未走提交流程）也要回收本地模型 blob URL
function closeEditModal() {
  releaseTempModel();
  editModalOpen.value = false;
}

onMounted(() => {
  // 冷导航修复：3D 单品是素材库里唯一直接用 <model-viewer> 的入口，
  // 必须在本组件挂载时就确保自定义元素已注册（未注册时标签空白且无 3D）
  ensureModelViewer();
  loadPresets();
});

onBeforeUnmount(() => {
  releaseTempModel();
});
</script>

<style scoped>
.product-3d-manager {
  font-family: inherit;
}
</style>
