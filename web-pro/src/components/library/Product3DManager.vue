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
          class="rounded-xl border border-studio-800 bg-studio-900 overflow-hidden flex flex-col group hover:border-studio-700 transition"
        >
          <!-- 预览图 / 烘焙图 -->
          <div class="relative w-full aspect-[4/3] bg-studio-950 flex items-center justify-center overflow-hidden">
            <img
              v-if="item.snapshots && item.snapshots.right_45"
              :src="item.snapshots.right_45"
              class="w-full h-full object-contain p-2 group-hover:scale-105 transition"
              :alt="item.name"
            />
            <img
              v-else-if="item.preview_url"
              :src="item.preview_url"
              class="w-full h-full object-contain p-2 group-hover:scale-105 transition"
              :alt="item.name"
              @error="handleImgError"
            />
            <div v-else class="text-slate-600 text-xs flex flex-col items-center gap-1">
              <span class="text-2xl">📦</span>
              <span>待烘焙快照</span>
            </div>

            <!-- 朝向徽标 -->
            <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 border border-white/10 text-[10px] font-mono text-studio-cyan">
              标准 {{ item.facing || 45 }}°
            </div>

            <!-- 标定朝向快捷浮层 -->
            <button
              type="button"
              @click="openViewerModal(item)"
              class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <span class="px-3 py-1.5 rounded-lg bg-studio-accent text-white font-bold text-xs flex items-center gap-1">
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
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-studio-800">
          <button
            type="button"
            @click="editModalOpen = false"
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
import { ref, computed, onMounted } from 'vue';
import { getToken } from '../../api';

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
  const reader = new FileReader();
  reader.onload = () => {
    editForm.value.fileB64 = reader.result;
  };
  reader.readAsDataURL(file);
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
      const res = await fetch('/api/products/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          name: editForm.value.name,
          category: editForm.value.category,
          facing: editForm.value.facing,
          model_b64: editForm.value.fileB64,
          dimensions: {
            width: editForm.value.width,
            depth: editForm.value.depth,
            height: editForm.value.height
          }
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '上传失败');
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

function handleImgError(e) {
  e.target.style.display = 'none';
}

onMounted(() => {
  loadPresets();
});
</script>

<style scoped>
.product-3d-manager {
  font-family: inherit;
}
</style>
