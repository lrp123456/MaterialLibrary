/**
 * 领域 Store 2：素材库虚拟瀑布流与筛选缓存 (Asset Masonry Store)
 * 职责：
 *  - DAM + Base Library 多泳道筛选（image, video, audio, model3d）
 *  - 虚拟瀑布流分页与滚动锚定
 *  - 双图（缩略图/原图）与 content-hash 缓存池
 *  - 多选与批量操作状态
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAssetMasonryStore = defineStore('assetMasonry', () => {
  const lane = ref('image');
  const items = ref([]);
  const page = ref(1);
  const pageSize = ref(40);
  const totalCount = ref(0);
  const hasMore = ref(true);
  const loading = ref(false);
  const selectedIds = ref(new Set());

  // 筛选器状态
  const filters = ref({
    query: '',
    section: '',
    tags: [],
    dateRange: null,
    sort: 'created_desc',
  });

  // 双图缓存池 fid -> { thumbUrl, previewUrl, sha256 }
  const dualImageCache = ref(new Map());

  const selectedCount = computed(() => selectedIds.value.size);

  function setLane(newLane) {
    if (lane.value === newLane) return;
    lane.value = newLane;
    items.value = [];
    page.value = 1;
    hasMore.value = true;
    selectedIds.value.clear();
  }

  function setFilter(key, val) {
    filters.value[key] = val;
    page.value = 1;
    items.value = [];
    hasMore.value = true;
  }

  function setItems(newItems, total = 0) {
    items.value = newItems || [];
    totalCount.value = total;
    hasMore.value = items.value.length < total;
  }

  function appendItems(newItems) {
    if (!newItems || !newItems.length) {
      hasMore.value = false;
      return;
    }
    items.value = [...items.value, ...newItems];
    if (totalCount.value > 0 && items.value.length >= totalCount.value) {
      hasMore.value = false;
    }
  }

  function cacheAssetImages(fid, meta) {
    if (!fid) return;
    dualImageCache.value.set(fid, {
      ...(dualImageCache.value.get(fid) || {}),
      ...meta,
    });
  }

  function toggleSelection(id) {
    if (selectedIds.value.has(id)) {
      selectedIds.value.delete(id);
    } else {
      selectedIds.value.add(id);
    }
  }

  function clearSelection() {
    selectedIds.value.clear();
  }

  // ===== 素材库与基础库常用 API 方法 =====
  async function fetchTaxonomy() {
    const res = await fetch('/api/base-library/taxonomy');
    return res.ok ? res.json() : null;
  }

  async function fetchMaterials(query = '') {
    const res = await fetch(`/api/base-library/materials?${query}`);
    return res.ok ? res.json() : null;
  }

  async function fetchPaints(query = '') {
    const res = await fetch(`/api/base-library/paints?${query}`);
    return res.ok ? res.json() : null;
  }

  async function fetchLights() {
    const res = await fetch('/api/base-library/lights');
    return res.ok ? res.json() : null;
  }

  async function uploadAsset(formData) {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    return res.ok ? res.json() : null;
  }

  async function replaceAssetImage(fid, formData) {
    const res = await fetch(`/api/assets/${encodeURIComponent(fid)}/replace-image`, {
      method: 'POST',
      body: formData,
    });
    return res.ok ? res.json() : null;
  }

  async function deleteBaseItem(id) {
    const res = await fetch(`/api/base-library/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  }

  async function compileScheme(schemeId, payload) {
    const res = await fetch(`/api/base-library/schemes/${encodeURIComponent(schemeId)}/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok ? res.json() : null;
  }

  return {
    lane,
    items,
    page,
    pageSize,
    totalCount,
    hasMore,
    loading,
    selectedIds,
    filters,
    dualImageCache,
    selectedCount,
    setLane,
    setFilter,
    setItems,
    appendItems,
    cacheAssetImages,
    toggleSelection,
    clearSelection,
    fetchTaxonomy,
    fetchMaterials,
    fetchPaints,
    fetchLights,
    uploadAsset,
    replaceAssetImage,
    deleteBaseItem,
    compileScheme,
  };
});
