<template>
  <div class="library-view-root flex-1 flex flex-col bg-studio-950 overflow-hidden relative font-sans">
    <!-- 头部工具栏 -->
    <LibraryHeaderBar
      :currentLane="activeLane"
      :initialQuery="searchQuery"
      @update:lane="handleLaneChange"
      @search="handleSearch"
      @open-base-library="showBaseLibrary = true"
      @open-ingest="showIngestPanel = true"
    />

    <!-- 素材列表主视口 (依托 Pinia useAssetMasonryStore) -->
    <main class="flex-1 flex overflow-hidden relative">
      <LibraryAssetGrid
        :items="assetStore.items"
        :loading="assetStore.loading"
        :selectedIds="assetStore.selectedIds"
        @select-item="handleAssetSelect"
      />

      <!-- 侧边基底库面板抽屉 (Base Library) -->
      <BaseLibraryPane
        v-if="showBaseLibrary"
        :visible="showBaseLibrary"
        @close="showBaseLibrary = false"
        @select-item="handleBaseItemSelect"
      />
    </main>

    <!-- 模态弹窗与工具浮层 -->
    <CatalogIngestPanel
      v-if="showIngestPanel"
      :visible="showIngestPanel"
      @close="showIngestPanel = false"
      @ingest-success="refreshAssets"
    />

    <StudioEditLayer
      v-if="showEditLayer"
      :visible="showEditLayer"
      :initialImage="editTargetImage"
      @close="showEditLayer = false"
      @saved="refreshAssets"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { useAssetMasonryStore } from '../stores/assetMasonry.js';
import { useSseTaskStream } from '../composables/useSseTaskStream.js';
import LibraryHeaderBar from '../components/library/LibraryHeaderBar.vue';
import LibraryAssetGrid from '../components/library/LibraryAssetGrid.vue';
import BaseLibraryPane from './library/BaseLibraryPane.vue';
import CatalogIngestPanel from './library/CatalogIngestPanel.vue';
import StudioEditLayer from './studio/StudioEditLayer.vue';

const props = defineProps({
  libraryLane: { type: String, default: 'image' },
});

const emit = defineEmits(['sendToChat', 'sendToEdit', 'sendToClip']);

const assetStore = useAssetMasonryStore();
const activeLane = ref(props.libraryLane || 'image');
const searchQuery = ref('');
const showBaseLibrary = ref(false);
const showIngestPanel = ref(false);
const showEditLayer = ref(false);
const editTargetImage = ref('');

watch(() => props.libraryLane, (newLane) => {
  if (newLane && newLane !== activeLane.value) {
    activeLane.value = newLane;
    handleLaneChange(newLane);
  }
});

function handleLaneChange(lane) {
  activeLane.value = lane;
  assetStore.setLane(lane);
  loadAssets();
}

function handleSearch(q) {
  searchQuery.value = q;
  assetStore.setFilter('query', q);
  loadAssets();
}

async function loadAssets() {
  assetStore.loading = true;
  try {
    const params = new URLSearchParams({
      media_type: activeLane.value,
      query: searchQuery.value || '',
      limit: '50',
    });
    const res = await fetch(`/api/assets?${params}`);
    if (res.ok) {
      const data = await res.json();
      assetStore.setItems(data.items || [], data.total || (data.items || []).length);
    }
  } catch (e) {
    console.error('[LibraryView] loadAssets error:', e);
  } finally {
    assetStore.loading = false;
  }
}

function refreshAssets() {
  loadAssets();
}

function handleAssetSelect(item) {
  if (!item) return;
  // 支持双击或操作直接流转到创作工坊或多轨剪辑
  emit('sendToChat', {
    fid: item.fid,
    name: item.file_name || item.name,
    previewUrl: item.preview_url || item.thumbnail_url,
  });
}

function handleBaseItemSelect(item) {
  emit('sendToChat', item);
  showBaseLibrary.value = false;
}

// 自动监听素材入库变更 (SSE)，按生命周期自动解绑
useSseTaskStream('asset:changed', () => {
  refreshAssets();
});

onMounted(() => {
  assetStore.setLane(activeLane.value);
  loadAssets();
});
</script>
