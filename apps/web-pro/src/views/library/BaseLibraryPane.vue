<template>
  <aside v-if="visible" class="base-library-pane w-96 border-l border-studio-800 bg-studio-900/95 flex flex-col font-sans shrink-0 z-30 shadow-2xl">
    <!-- 面板标题 -->
    <header class="h-14 px-5 border-b border-studio-800 flex items-center justify-between shrink-0">
      <h3 class="text-sm font-bold text-white font-mono flex items-center gap-2">
        <StudioIcon name="database" :size="16" class="text-studio-accent" />
        <span>空间基底素材库</span>
      </h3>
      <button type="button" class="text-slate-400 hover:text-white" @click="$emit('close')">&times;</button>
    </header>

    <!-- 分类标签栏 -->
    <div class="p-3 border-b border-studio-800/80 bg-studio-950 flex gap-1.5 overflow-x-auto scrollbar-none">
      <button
        v-for="cat in categories"
        :key="cat.key"
        type="button"
        class="px-2.5 py-1 rounded-lg text-xs font-mono whitespace-nowrap border transition-all"
        :class="activeCategory === cat.key ? 'bg-studio-accent text-white border-studio-accent font-bold' : 'bg-studio-900 text-slate-400 border-studio-800 hover:text-white'"
        @click="activeCategory = cat.key"
      >
        {{ cat.label }}
      </button>
    </div>

    <!-- 列表内容区 -->
    <main class="flex-1 overflow-y-auto p-3 space-y-2.5 scrollbar-thin">
      <div v-if="loading" class="text-center py-10 text-xs text-slate-500 font-mono">
        正在读取基底库方案…
      </div>

      <div v-else-if="!items.length" class="text-center py-10 text-xs text-slate-500 font-mono">
        当前分类下暂无预设材质
      </div>

      <div
        v-for="item in items"
        :key="item.id || item.fid"
        class="group p-2.5 rounded-xl bg-studio-950 border border-studio-800 hover:border-studio-accent transition-all cursor-pointer flex items-center gap-3"
        @click="$emit('select-item', item)"
      >
        <div class="w-12 h-12 rounded-lg bg-studio-900 border border-studio-800 overflow-hidden shrink-0">
          <img v-if="item.thumbnail_url" :src="item.thumbnail_url" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-[10px] text-slate-600 font-mono">
            基底
          </div>
        </div>

        <div class="flex-1 min-w-0">
          <h4 class="text-xs font-bold text-slate-200 truncate group-hover:text-studio-accent transition-colors">
            {{ item.name || item.prompt_name || item.brand }}
          </h4>
          <p class="text-[10px] text-slate-500 truncate mt-0.5 font-mono">
            {{ item.category || activeCategory }} · {{ item.origin || 'preset' }}
          </p>
        </div>
      </div>
    </main>
  </aside>
</template>

<script setup>
import { ref, onMounted } from 'vue';

defineProps({
  visible: { type: Boolean, default: false },
});

defineEmits(['close', 'select-item']);

const categories = [
  { key: 'paint', label: '乳胶漆/微水泥' },
  { key: 'stone', label: '天然大理石/岩板' },
  { key: 'wood', label: '木饰面/地板' },
  { key: 'metal', label: '金属/型材' },
  { key: 'fabric', label: '布艺/皮革' },
];

const activeCategory = ref('paint');
const items = ref([]);
const loading = ref(false);

async function loadCategoryItems() {
  loading.value = true;
  try {
    const res = await fetch(`/api/base-library/items?warehouse=${activeCategory.value}`);
    if (res.ok) {
      const data = await res.json();
      items.value = data.items || [];
    }
  } catch (e) {
    console.warn('[BaseLibraryPane] load items error:', e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadCategoryItems();
});
</script>
