<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
    <div class="w-full max-w-4xl bg-studio-900 border border-studio-750 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
      <!-- 弹窗顶栏 -->
      <div class="p-4 border-b border-studio-800 flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <StudioIcon :name="warehouse === 'material' ? 'search' : 'database'" :size="18" class="text-studio-accent" />
          <h3 class="text-sm font-bold text-white">
            {{ warehouse === 'material' ? '开源材质站在线检索与入库 (Poly Haven / ambientCG)' : '色号镜像任务管理 (PaintDB)' }}
          </h3>
        </div>
        <button @click="$emit('close')" class="text-slate-400 hover:text-white cursor-pointer">
          <StudioIcon name="x" :size="18" />
        </button>
      </div>

      <!-- 弹窗内容 (PR5 完整展开) -->
      <div class="p-6 overflow-y-auto flex-1">
        <div v-if="warehouse === 'material'" class="space-y-4">
          <div class="flex space-x-3">
            <select v-model="sourceType" class="px-3 py-2 rounded-xl bg-studio-850 border border-studio-750 text-xs text-white">
              <option value="polyhaven">Poly Haven (CC0)</option>
              <option value="ambientcg">ambientCG (CC0)</option>
            </select>
            <input
              v-model="queryStr"
              type="text"
              placeholder="搜索材质英文关键词，如 wood, plaster, brick..."
              @keyup.enter="doSearch"
              class="flex-1 px-3 py-2 rounded-xl bg-studio-850 border border-studio-750 text-xs text-white"
            />
            <button @click="doSearch" class="px-4 py-2 rounded-xl bg-studio-accent text-white text-xs font-bold cursor-pointer">
              搜索
            </button>
          </div>

          <div v-if="searching" class="text-center py-12 text-slate-500 text-xs">
            正在请求开源站点数据...
          </div>
          <div v-else-if="results.length > 0" class="grid grid-cols-3 sm:grid-cols-4 gap-3">
            <div v-for="item in results" :key="item.id" class="p-2 rounded-xl bg-studio-850 border border-studio-750 flex flex-col justify-between">
              <div>
                <img :src="item.thumb_url" class="w-full aspect-square object-cover rounded-lg bg-studio-950 mb-2" />
                <div class="text-xs font-bold text-white truncate">{{ item.title || item.id }}</div>
                <div class="text-[10px] text-slate-400">{{ item.source }} · CC0</div>
              </div>
              <button
                :disabled="item.imported || importingId === item.id"
                @click="importItem(item)"
                class="mt-2 w-full py-1 rounded-lg bg-studio-750 hover:bg-studio-accent text-white text-[11px] font-bold disabled:opacity-50 cursor-pointer"
              >
                {{ item.imported ? '已收录' : (importingId === item.id ? '收录中...' : '确认入库') }}
              </button>
            </div>
          </div>
          <div v-else class="text-center py-12 text-slate-500 text-xs">
            输入关键词在线检索 CC0 高质量 1K 材质
          </div>
        </div>

        <div v-else class="space-y-4 text-xs">
          <p class="text-slate-300">通过 PaintDB 官方公开 API 同步立邦与多乐士色卡元数据并本地生成 256x256 纯色块。</p>
          <div class="p-4 rounded-xl bg-studio-850 border border-studio-750 flex items-center justify-between">
            <div>
              <div class="font-bold text-white mb-1">立邦 (Nippon Paint)</div>
              <div class="text-slate-400 text-[11px]">约 2720 条色号</div>
            </div>
            <button
              :disabled="mirrorRunningBrand === 'nippon-paint'"
              @click="triggerMirror('nippon-paint')"
              class="px-3 py-1.5 rounded-lg bg-studio-accent text-white font-bold cursor-pointer disabled:opacity-50"
            >
              {{ mirrorRunningBrand === 'nippon-paint' ? '同步中...' : '开始增量同步' }}
            </button>
          </div>

          <div class="p-4 rounded-xl bg-studio-850 border border-studio-750 flex items-center justify-between">
            <div>
              <div class="font-bold text-white mb-1">多乐士 (Dulux)</div>
              <div class="text-slate-400 text-[11px]">约 1032 条色号</div>
            </div>
            <button
              :disabled="mirrorRunningBrand === 'dulux'"
              @click="triggerMirror('dulux')"
              class="px-3 py-1.5 rounded-lg bg-studio-accent text-white font-bold cursor-pointer disabled:opacity-50"
            >
              {{ mirrorRunningBrand === 'dulux' ? '同步中...' : '开始增量同步' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';
import { getToken } from '../../api';

const props = defineProps({
  warehouse: {
    type: String,
    default: 'material'
  }
});

const emit = defineEmits(['close', 'imported']);

const sourceType = ref('polyhaven');
const queryStr = ref('');
const searching = ref(false);
const results = ref([]);
const importingId = ref('');
const mirrorRunningBrand = ref('');

async function doSearch() {
  if (!queryStr.value.trim()) return;
  searching.value = true;
  try {
    const res = await fetch(`/api/base-library/materials/search?source=${sourceType.value}&q=${encodeURIComponent(queryStr.value.trim())}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const json = await res.json();
    if (json.success) results.value = json.data || [];
  } catch (e) {
    console.warn('搜索材质失败:', e);
  } finally {
    searching.value = false;
  }
}

async function importItem(item) {
  importingId.value = item.id;
  try {
    let surface = 'floor';
    let subclass = 'floor_wood';
    const textLower = `${item.title || ''} ${item.id || ''}`.toLowerCase();
    if (textLower.includes('tile') || textLower.includes('brick')) {
      surface = 'wall';
      subclass = 'wall_tile';
    } else if (textLower.includes('marble') || textLower.includes('travertine') || textLower.includes('granite')) {
      surface = 'floor';
      subclass = 'floor_stone';
    } else if (textLower.includes('leather')) {
      surface = 'upholstery';
      subclass = 'uph_leather';
    } else if (textLower.includes('fabric') || textLower.includes('cloth') || textLower.includes('velvet')) {
      surface = 'upholstery';
      subclass = 'uph_fabric';
    } else if (textLower.includes('carpet') || textLower.includes('rug')) {
      surface = 'rug';
      subclass = 'soft_rug';
    } else if (textLower.includes('wood') || textLower.includes('parquet') || textLower.includes('plank')) {
      surface = 'floor';
      subclass = 'floor_wood';
    }

    // 1. 先创建草稿
    const draftRes = await fetch('/api/base-library/materials/draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        source: item.source,
        source_id: item.id
      })
    });
    const draftJson = await draftRes.json();
    if (!draftJson.success || !draftJson.data?.draft_id) {
      throw new Error(draftJson.error || '创建材质草稿失败');
    }

    // 2. 确认入库
    const res = await fetch('/api/base-library/materials/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        draft_id: draftJson.data.draft_id,
        name_cn: item.title || item.id,
        track: 'B',
        tags: [{ surface, subclass }]
      })
    });
    const json = await res.json();
    if (json.success) {
      item.imported = true;
      emit('imported');
    }
  } catch (e) {
    console.warn('入库失败:', e);
  } finally {
    importingId.value = '';
  }
}

async function triggerMirror(brand) {
  mirrorRunningBrand.value = brand;
  try {
    await fetch(`/api/base-library/paints/mirror`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ brand })
    });
    emit('imported');
  } catch (e) {
    console.warn('触发镜像失败:', e);
  } finally {
    mirrorRunningBrand.value = '';
  }
}
</script>
