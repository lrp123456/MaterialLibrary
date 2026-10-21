<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
    <div class="bg-studio-900 border border-studio-700 rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden">
      <!-- 头部 -->
      <div class="p-4 border-b border-studio-750 flex items-center justify-between bg-studio-950/60 select-none">
        <div class="flex items-center space-x-3">
          <div class="w-9 h-9 rounded-xl bg-studio-accent/20 border border-studio-accent/40 flex items-center justify-center text-studio-accent font-bold">
            🔍
          </div>
          <div>
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <span>相似素材处理工作台</span>
              <span class="text-xs px-2 py-0.5 rounded-full bg-studio-800 text-slate-400 font-mono">Similarity Workbench</span>
            </h2>
            <p class="text-xs text-slate-400">基于 MIH 倒排索引与 9 维质量评分，智能推荐保留最佳画质，杜绝连拍废片算力浪费</p>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <button
            @click="loadWorkbench"
            :disabled="loading"
            class="px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-200 text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer"
          >
            <span :class="{ 'animate-spin': loading }">🔄</span>
            <span>刷新扫描</span>
          </button>
          <button
            @click="close"
            class="w-8 h-8 rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- 顶部绝对重复快清栏 (若存在绝对重复) -->
      <div
        v-if="exactDuplicates.length > 0"
        class="p-3 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between text-xs text-amber-200 select-none"
      >
        <div class="flex items-center space-x-2">
          <span class="text-base">⚡</span>
          <span class="font-bold">发现 {{ exactDuplicates.length }} 组字节/哈希完全相同的绝对重复素材（含重复导入的衍生图与缓存图）</span>
        </div>
        <button
          @click="handleCleanExact"
          :disabled="cleaningExact"
          class="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition-all cursor-pointer shadow-sm disabled:opacity-50"
        >
          {{ cleaningExact ? '正在清理…' : '一键清理全部绝对重复' }}
        </button>
      </div>

      <!-- 工具筛选栏 -->
      <div class="p-3 bg-studio-850/50 border-b border-studio-750 flex flex-wrap items-center justify-between gap-3 text-xs select-none">
        <!-- 模式切换胶囊 -->
        <div class="flex items-center space-x-1 bg-studio-900 p-1 rounded-xl border border-studio-750">
          <button
            v-for="m in modes"
            :key="m.key"
            @click="switchMode(m.key)"
            :class="[
              'px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center space-x-1',
              activeMode === m.key
                ? 'bg-studio-accent text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            ]"
          >
            <span>{{ m.icon }}</span>
            <span>{{ m.label }}</span>
          </button>
        </div>

        <!-- 灵敏度滑杆 -->
        <div class="flex items-center space-x-3 text-slate-300">
          <span class="font-bold">相似敏感度 (pHash 汉明距离):</span>
          <input
            v-model.number="currentMaxDist"
            type="range"
            min="1"
            max="12"
            step="1"
            @change="loadWorkbench"
            class="w-32 accent-studio-accent cursor-pointer"
          />
          <span class="font-mono font-bold text-studio-accent bg-studio-900 px-2 py-0.5 rounded border border-studio-750">
            ≤ {{ currentMaxDist }}
          </span>
        </div>

        <!-- 批量动作 -->
        <div class="flex items-center space-x-2">
          <button
            v-if="similarClusters.length > 0"
            @click="handleApplyAllRecommended"
            :disabled="resolving"
            class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-md cursor-pointer flex items-center space-x-1 disabled:opacity-50"
          >
            <span>✅</span>
            <span>一键采用系统推荐（保留每组最高分）</span>
          </button>
        </div>
      </div>

      <!-- 主体内容区 -->
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <!-- 加载中 -->
        <div v-if="loading" class="flex flex-col items-center justify-center h-64 space-y-3">
          <div class="w-10 h-10 border-4 border-studio-accent border-t-transparent rounded-full animate-spin"></div>
          <span class="text-xs text-slate-400">正在运用 MIH 算法扫描相似素材并评估画质分…</span>
        </div>

        <!-- 空态 -->
        <div v-else-if="similarClusters.length === 0 && exactDuplicates.length === 0" class="flex flex-col items-center justify-center h-64 space-y-2 text-slate-500">
          <span class="text-4xl">🎉</span>
          <span class="text-sm font-bold text-slate-400">太棒了，当前库内未发现疑似重复或冗余连拍素材！</span>
          <span class="text-xs">已通过视频抽帧保护、母子衍生血缘与人工白名单双重豁免过滤。</span>
        </div>

        <!-- 相似素材簇列表 -->
        <div
          v-for="(cluster, cIdx) in similarClusters"
          :key="cluster.clusterId || cIdx"
          class="bg-studio-850/80 border border-studio-750 rounded-xl p-4 space-y-3 shadow-md"
        >
          <!-- 簇头部 -->
          <div class="flex items-center justify-between border-b border-studio-750 pb-2.5">
            <div class="flex items-center space-x-2">
              <span class="px-2 py-0.5 rounded bg-studio-800 text-studio-accent font-bold font-mono text-xs">
                簇 #{{ cIdx + 1 }}
              </span>
              <span class="text-xs font-bold text-slate-200">
                品类: {{ cluster.category }} · 最小 pHash 距离: {{ cluster.minDist }}
              </span>
              <span class="text-xs text-slate-400">
                (共 {{ cluster.members.length }} 张相似图片)
              </span>
            </div>

            <!-- 簇操作按钮 -->
            <div class="flex items-center space-x-2">
              <button
                @click="resolveSingleCluster(cluster, 'keep_selected')"
                class="px-2.5 py-1 bg-studio-accent hover:brightness-110 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center space-x-1"
                title="保留当前已勾选的图片，将未勾选图片移入回收站"
              >
                <span>✨</span>
                <span>保留勾选并清理其余</span>
              </button>
              <button
                @click="resolveSingleCluster(cluster, 'keep_all')"
                class="px-2.5 py-1 bg-studio-800 hover:bg-studio-700 text-slate-300 hover:text-white rounded-lg text-xs font-bold transition-all border border-studio-700 cursor-pointer flex items-center space-x-1"
                title="本组全部保留并记入白名单，后续不再提示"
              >
                <span>🛡️</span>
                <span>本组全留</span>
              </button>
            </div>
          </div>

          <!-- 簇内图片网格 (横向对比) -->
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <div
              v-for="m in cluster.members"
              :key="m.fid"
              @click="toggleMemberSelect(cluster, m.fid)"
              :class="[
                'group relative rounded-xl border-2 overflow-hidden transition-all cursor-pointer bg-studio-900 flex flex-col',
                isMemberSelected(cluster, m.fid)
                  ? 'border-studio-accent shadow-md shadow-studio-accent/20'
                  : 'border-studio-750 opacity-60 hover:opacity-90'
              ]"
            >
              <!-- 勾选指示器 -->
              <div class="absolute top-2 left-2 z-10 w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold transition-all shadow"
                :class="isMemberSelected(cluster, m.fid) ? 'bg-studio-accent text-white' : 'bg-black/60 border border-white/30 text-transparent'"
              >
                ✓
              </div>

              <!-- 推荐保留徽章 -->
              <div
                v-if="m.recommendedKeep"
                class="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full bg-amber-500 text-black text-[10px] font-black shadow flex items-center space-x-0.5"
              >
                <span>👑</span>
                <span>最高画质 ({{ m.qualityScore }}分)</span>
              </div>
              <div
                v-else
                class="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full bg-black/60 text-slate-300 text-[10px] font-mono"
              >
                {{ m.qualityScore }}分
              </div>

              <!-- 缩略图 -->
              <div class="w-full aspect-square bg-studio-950 flex items-center justify-center overflow-hidden">
                <img
                  :src="m.thumbUrl"
                  :alt="m.fileName"
                  class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>

              <!-- 元数据说明 -->
              <div class="p-2 space-y-1 text-[11px] bg-studio-900 border-t border-studio-800">
                <div class="flex items-center justify-between text-slate-300">
                  <span class="font-mono font-bold">{{ m.width }}×{{ m.height }}</span>
                  <span class="text-slate-400">{{ m.orientation || '-' }}</span>
                </div>
                <div class="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{{ m.hasWatermark ? '⚠️ 带水印' : '✅ 无水印' }}</span>
                  <span v-if="m.favorite" class="text-amber-400">★ 收藏</span>
                  <span v-if="m.derivCount > 0" class="text-studio-accent font-bold">{{ m.derivCount }}衍生</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import {
  fetchSimilarityWorkbench,
  resolveSimilarityCluster as apiResolve,
  cleanExactDuplicates as apiCleanExact
} from '../api';

const props = defineProps({
  visible: { type: Boolean, default: false }
});

const emit = defineEmits(['update:visible', 'resolved']);

const loading = ref(false);
const resolving = ref(false);
const cleaningExact = ref(false);
const activeMode = ref('visual');
const currentMaxDist = ref(8);

const exactDuplicates = ref([]);
const similarClusters = ref([]);
const clusterSelection = reactive(new Map());

const modes = [
  { key: 'burst', label: '连拍微调 (≤5)', icon: '📸' },
  { key: 'visual', label: '画面高相似 (默认)', icon: '🖼️' },
  { key: 'space', label: '同空间多视角', icon: '🏠' }
];

async function loadWorkbench() {
  loading.value = true;
  try {
    const res = await fetchSimilarityWorkbench({
      mode: activeMode.value,
      maxDist: currentMaxDist.value
    });
    if (res.success && res.data) {
      exactDuplicates.value = res.data.exactDuplicates || [];
      similarClusters.value = res.data.similarClusters || [];

      // 默认勾选每个簇推荐的素材
      clusterSelection.clear();
      similarClusters.value.forEach((c) => {
        const defaultKeep = new Set();
        c.members.forEach((m) => {
          if (m.recommendedKeep) defaultKeep.add(m.fid);
        });
        if (defaultKeep.size === 0 && c.members.length > 0) {
          defaultKeep.add(c.members[0].fid);
        }
        clusterSelection.set(c.clusterId, defaultKeep);
      });
    }
  } catch (e) {
    console.error('加载相似工作台失败:', e);
  } finally {
    loading.value = false;
  }
}

function switchMode(m) {
  activeMode.value = m;
  if (m === 'burst') currentMaxDist.value = 5;
  else if (m === 'visual') currentMaxDist.value = 8;
  else currentMaxDist.value = 10;
  loadWorkbench();
}

function isMemberSelected(cluster, fid) {
  const set = clusterSelection.get(cluster.clusterId);
  return set ? set.has(fid) : false;
}

function toggleMemberSelect(cluster, fid) {
  if (!clusterSelection.has(cluster.clusterId)) {
    clusterSelection.set(cluster.clusterId, new Set());
  }
  const set = clusterSelection.get(cluster.clusterId);
  if (set.has(fid)) {
    // 至少保留一张
    if (set.size > 1) set.delete(fid);
  } else {
    set.add(fid);
  }
}

async function resolveSingleCluster(cluster, action) {
  const selSet = clusterSelection.get(cluster.clusterId) || new Set();
  const keepFids = Array.from(selSet);
  const dropFids = cluster.members.map((m) => m.fid).filter((f) => !selSet.has(f));

  resolving.value = true;
  try {
    await apiResolve({
      action,
      clusters: [{
        keepFids,
        dropFids,
        allFids: cluster.members.map((m) => m.fid)
      }]
    });
    // 移除已处理的簇
    similarClusters.value = similarClusters.value.filter((c) => c.clusterId !== cluster.clusterId);
    emit('resolved');
  } catch (e) {
    alert('处理失败: ' + (e.message || e));
  } finally {
    resolving.value = false;
  }
}

async function handleApplyAllRecommended() {
  if (!confirm(`确定按系统推荐保留 ${similarClusters.value.length} 个簇的高分素材，将其余相似素材移入回收站吗？`)) {
    return;
  }
  resolving.value = true;
  try {
    const payloadClusters = similarClusters.value.map((c) => {
      const selSet = clusterSelection.get(c.clusterId) || new Set();
      return {
        keepFids: Array.from(selSet),
        dropFids: c.members.map((m) => m.fid).filter((f) => !selSet.has(f)),
        allFids: c.members.map((m) => m.fid)
      };
    });
    await apiResolve({ action: 'keep_selected', clusters: payloadClusters });
    similarClusters.value = [];
    emit('resolved');
  } catch (e) {
    alert('批量处理失败: ' + (e.message || e));
  } finally {
    resolving.value = false;
  }
}

async function handleCleanExact() {
  if (!confirm(`确定一键清理 ${exactDuplicates.value.length} 组绝对重复文件吗？将保留主图，副本移入回收站。`)) return;
  cleaningExact.value = true;
  try {
    await apiCleanExact();
    exactDuplicates.value = [];
    emit('resolved');
  } catch (e) {
    alert('清理失败: ' + (e.message || e));
  } finally {
    cleaningExact.value = false;
  }
}

function close() {
  emit('update:visible', false);
}

defineExpose({ loadWorkbench });
</script>
