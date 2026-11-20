<template>
  <div class="p-4 md:p-6">
    <p v-if="error" class="text-sm text-red-300 mb-3">{{ error }}</p>
    <p v-if="remoteError" class="text-sm text-amber-200 mb-3">火山列表：{{ remoteError }}。本地人像仍在下面。</p>
    <p v-if="loading" class="text-sm text-on-surface-variant">加载中…</p>
    <p v-else-if="!items.length" class="text-sm text-on-surface-variant">人像库是空的</p>
    <div v-else class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <button
        v-for="item in items"
        :key="item.fid || item.volcAssetId"
        type="button"
        class="text-left"
        @click="open(item)"
      >
        <div class="aspect-[3/4] rounded-xl overflow-hidden bg-surface-low border border-outline-variant">
          <img v-if="item.previewUrl" :src="imageSrc(item)" class="w-full h-full object-cover" alt="" />
        </div>
        <span class="inline-block mt-1.5 px-2 py-0.5 rounded-md bg-white text-slate-800 text-[11px]">{{ item.placeLabel }}</span>
        <p class="mt-1 text-[11px] text-on-surface-variant truncate">{{ item.fileName }}</p>
      </button>
    </div>
    <div v-if="preview" class="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" @click="preview = null">
      <img :src="preview" class="max-h-full max-w-full object-contain" alt="" />
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api'

const items = ref([])
const loading = ref(true)
const error = ref('')
const remoteError = ref('')
const preview = ref(null)

function imageSrc(item) {
  if (item.fid) return api.imageUrl(item.fid, item.derivativeId || null)
  if (item.previewUrl && /^https?:\/\//i.test(item.previewUrl)) return item.previewUrl
  return ''
}

function open(item) {
  const src = imageSrc(item)
  if (src) preview.value = src
}

onMounted(async () => {
  try {
    const data = await api.portraitCatalog()
    items.value = (data && data.items) || []
    remoteError.value = (data && data.remoteError) || ''
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
})
</script>
