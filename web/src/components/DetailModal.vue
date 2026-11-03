<template>
  <div v-if="visible" class="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 md:p-6" @click.self="$emit('close')">
    <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-6xl w-full max-h-[92vh] flex flex-col md:flex-row overflow-hidden shadow-2xl">

      <div class="flex-1 bg-surface flex flex-col min-w-0 border-b md:border-b-0 md:border-r border-outline-variant">
        <div class="h-11 px-3 bg-surface-low/80 border-b border-outline-variant flex items-center gap-1.5 overflow-x-auto text-xs">
          <span class="text-on-surface-variant text-[11px] mr-1 hidden sm:inline">版本</span>
          <button
            v-for="tab in versionTabs"
            :key="tab.slot"
            type="button"
            @click="selectVersion(tab)"
            class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition flex items-center gap-1 whitespace-nowrap"
            :class="versionTabClass(tab)"
            :title="tab.title"
          >
            <span>{{ tab.label }}</span>
            <span v-if="tab.pending" class="text-[9px] text-tertiary">生成中</span>
            <span v-else-if="tab.missing" class="text-[9px] text-outline">尚未生成</span>
          </button>
        </div>

        <div class="flex-1 flex items-center justify-center p-2 relative overflow-hidden min-h-[300px] md:min-h-[500px]">
          <div v-if="loading" class="text-on-surface-variant flex items-center gap-2 text-xs">
            <span class="material-symbols-outlined animate-spin text-primary">progress_activity</span>
            <span>加载素材中...</span>
          </div>

          <template v-else-if="detail">
            <video
              v-if="activeDerivative?.mime?.includes('video')"
              :src="previewUrl(activeDerivative)"
              controls
              autoplay
              loop
              class="max-h-[68vh] max-w-full rounded-lg object-contain shadow-md"
            ></video>

            <img
              v-else-if="activeDerivative"
              :src="previewUrl(activeDerivative)"
              :alt="detail.asset.file_name"
              class="max-h-[68vh] max-w-full rounded-lg object-contain select-none shadow-md"
              loading="eager"
              @error="onImgError"
            />

            <div
              v-else-if="activeTab?.pending || activeTab?.missing"
              class="text-center px-6 max-w-sm space-y-2"
            >
              <span class="material-symbols-outlined text-3xl text-outline" :class="{ 'animate-spin': activeTab.pending }">
                {{ activeTab.pending ? 'progress_activity' : 'crop_portrait' }}
              </span>
              <p class="text-sm text-white">{{ activeTab.pending ? `${activeTab.label} 正在生成` : `还没有 ${activeTab.label} 版本` }}</p>
              <p class="text-[11px] text-on-surface-variant leading-relaxed">
                {{ activeTab.pending
                  ? (detail.asset.is_representative === 0 && detail.dupMembers?.length > 1 ? '组主图正在走 Agnes 重构，完成后本组共用。' : '排队打 Agnes 去水印净画，不会用原图顶替。')
                  : '每一张展示图都要经过 AI 重构。点下方按钮入队，或等后台补跑。' }}
              </p>
              <button
                v-if="isAdmin && activeTab.missing && !activeTab.pending"
                type="button"
                @click="handleRestageSlot(activeTab)"
                :disabled="restaging"
                class="px-3 py-1.5 rounded-lg bg-primary text-white text-[11px] font-medium disabled:opacity-50"
              >
                生成 {{ activeTab.label }}
              </button>
            </div>

            <span
              v-if="isGenerated(activeDerivative)"
              class="absolute top-3 left-3 px-2 py-1 rounded-full bg-violet text-white text-[10px] font-semibold tracking-wide"
            >
              AI 生成
            </span>
          </template>

          <div v-if="downloadHint" class="absolute top-3 right-3 px-3 py-1.5 rounded-lg bg-surface-low/90 border border-outline-variant text-[11px] text-on-surface">
            {{ downloadHint }}
          </div>
          <div v-if="toast" class="absolute top-12 right-3 px-3 py-1.5 rounded-lg bg-error/20 text-error text-[11px] max-w-xs">
            {{ toast }}
          </div>

          <div v-if="detail" class="absolute bottom-3 right-3 flex items-center gap-1.5 bg-surface-low/90 backdrop-blur-md p-1.5 rounded-xl border border-outline-variant shadow-lg text-xs">
            <button
              @click="handleDownload(activeDerivative?.id)"
              :disabled="downloading"
              class="px-3 py-1.5 bg-primary text-white rounded-lg font-medium flex items-center gap-1 hover:bg-primary/90 transition disabled:opacity-50"
            >
              <span class="material-symbols-outlined text-xs" :class="{ 'animate-spin': downloading }">{{ downloading ? 'progress_activity' : 'download' }}</span>
              <span>{{ downloading ? '下载中...' : '下载当前版' }}</span>
            </button>
            <button
              @click="handleDownload(originDeriv?.id)"
              :disabled="downloading"
              class="px-2.5 py-1.5 text-on-surface-variant hover:bg-surface-high rounded-lg transition text-[11px] disabled:opacity-50"
              title="下载原图，不离开当前页"
            >
              原图
            </button>
          </div>
        </div>
      </div>

      <div class="w-full md:w-96 flex flex-col max-h-[45vh] md:max-h-[92vh] overflow-y-auto p-4 space-y-4 text-xs bg-surface-low">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="flex items-center gap-1.5 flex-wrap mb-1">
              <span
                v-if="detail?.asset?.category === 'furniture'"
                class="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-semibold border border-amber-500/30"
              >
                独立单品
              </span>
              <span
                v-else-if="detail?.asset?.category === 'texture'"
                class="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold border border-emerald-500/30"
              >
                材质特写
              </span>
              <span
                v-else
                class="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-[10px] font-semibold border border-blue-500/30"
              >
                空间全景
              </span>
              <h2 class="text-sm font-bold text-white break-all leading-tight">{{ detail?.asset?.file_name }}</h2>
            </div>
            <p class="text-[11px] text-on-surface-variant mt-1 flex items-center gap-2 flex-wrap">
              <span>{{ metaLine }}</span>
              <span v-if="detail?.asset?.ready_flags?.length" class="text-tertiary text-[10px] flex items-center gap-0.5">
                <span class="material-symbols-outlined text-xs">warning</span>降级可用
              </span>
            </p>
            <p v-if="formattedTime" class="text-[10px] text-outline flex items-center gap-1 mt-1 font-mono">
              <span class="material-symbols-outlined text-xs">schedule</span>
              <span>{{ formattedTime }}</span>
            </p>
          </div>
          <button @click="$emit('close')" class="w-7 h-7 rounded-lg bg-surface hover:bg-surface-high flex items-center justify-center text-on-surface-variant">
            <span class="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        <div v-if="detail?.colors?.length || detail?.asset?.dominant_color" class="space-y-1.5">
          <div class="flex items-center justify-between">
            <p class="text-[11px] text-on-surface-variant font-medium tracking-wide">提取主色调</p>
            <span v-if="detail?.asset?.dominant_color" class="px-2 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-semibold border border-primary/30">
              主视觉色: {{ detail.asset.dominant_color }}
            </span>
          </div>
          <div v-if="detail?.colors?.length" class="flex gap-2">
            <div v-for="c in detail.colors" :key="c.hex + c.role" class="flex-1 bg-surface p-1.5 rounded-xl border border-outline-variant text-center">
              <div class="h-6 rounded-lg w-full mb-1 shadow-inner" :style="{ background: c.hex }"></div>
              <p class="text-[10px] text-white truncate">{{ c.name }}</p>
              <p class="text-[9px] text-outline font-mono">{{ c.hex }}</p>
            </div>
          </div>
        </div>

        <div v-if="primaryTags.length" class="space-y-2">
          <p class="text-[11px] text-on-surface-variant font-medium">{{ isFurniture ? '家具核心属性' : '核心设计标签' }}</p>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="t in primaryTags"
              :key="t.dimension + t.dir + (t.role || '')"
              class="px-2 py-0.5 rounded-lg border text-[11px] flex items-center gap-1 transition"
              :class="t.dimension === 'material_kind' && t.role === 'main'
                ? 'bg-amber-950/30 border-amber-600/40 text-amber-200'
                : (t.dimension === 'material_kind' && t.role === 'accent'
                  ? 'bg-sky-950/30 border-sky-600/40 text-sky-200'
                  : 'bg-surface border-outline-variant text-on-surface')"
            >
              <span class="text-[10px] text-outline">{{ getDimLabel(t.dimension, t.role) }}:</span>
              <span class="text-white">{{ t.label }}</span>
            </span>
          </div>
        </div>

        <div v-if="advancedTags.length" class="space-y-2">
          <p class="text-[11px] text-on-surface-variant font-medium">{{ isFurniture ? '场景与视觉特征' : '高级评估维度' }}</p>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="t in advancedTags"
              :key="t.dimension + t.dir"
              class="px-2 py-0.5 rounded-lg bg-surface-high/60 text-[10px] text-on-surface-variant flex items-center gap-1"
            >
              <span class="text-outline">{{ getDimLabel(t.dimension) }}:</span>
              <span class="text-white">{{ t.label }}</span>
            </span>
          </div>
        </div>

        <div v-if="isAdmin" class="space-y-2 pt-2 border-t border-outline-variant">
          <div class="flex items-center justify-between">
            <p class="text-[11px] font-medium text-white">打标历史</p>
            <button @click="toggleTagHistory" class="text-[10px] text-primary hover:underline">
              {{ tagHistory.length ? (showTagHistory ? '收起' : '展开') : '加载' }}
            </button>
          </div>
          <div v-if="showTagHistory && tagHistory.length" class="space-y-1 max-h-40 overflow-y-auto">
            <div v-for="h in tagHistory" :key="h.id" class="text-[10px] text-on-surface-variant flex items-start gap-2">
              <span class="text-outline shrink-0">{{ new Date(h.created_at).toLocaleString() }}</span>
              <span class="px-1 rounded" :class="h.action==='remove' ? 'bg-error/15 text-error' : h.action==='add' ? 'bg-primary/15 text-primary' : 'bg-surface text-on-surface'">
                {{ ({ add: '新增', update: '更新', remove: '移除' })[h.action] || h.action }}
              </span>
              <span class="truncate">{{ h.dimension }}: {{ h.old_value || '∅' }} → {{ h.new_value || h.dir }}</span>
            </div>
          </div>
          <p v-else-if="showTagHistory" class="text-[10px] text-outline">暂无历史记录</p>
        </div>

        <div v-if="isAdmin" class="space-y-3 pt-2 border-t border-outline-variant">
          <p class="text-[11px] font-medium text-white">双画幅重构</p>
          <div>
            <p class="text-[10px] text-on-surface-variant mb-1.5">画幅</p>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="r in ratioChips"
                :key="r"
                type="button"
                @click="toggleRatio(r)"
                class="px-2 py-1 rounded-lg border text-[10px] font-medium transition"
                :class="restageRatios.includes(r) ? 'bg-primary text-white border-primary' : 'bg-surface border-outline-variant text-on-surface-variant'"
              >
                {{ r }}
              </button>
            </div>
          </div>
          <div>
            <p class="text-[10px] text-on-surface-variant mb-1.5">分辨率</p>
            <div class="grid grid-cols-4 gap-1">
              <button
                v-for="s in sizePresets"
                :key="s.id"
                type="button"
                @click="restageSize = s.id"
                class="px-1.5 py-1.5 rounded-lg border text-center transition"
                :class="restageSize === s.id ? 'bg-primary text-white border-primary' : 'bg-surface border-outline-variant text-on-surface-variant'"
              >
                <span class="block text-[10px] font-semibold">{{ s.label }}</span>
                <span class="block text-[8px] opacity-80 mt-0.5">{{ pixelHint(s.id, restageMain || restageRatios[0] || '9:16') }}</span>
              </button>
            </div>
          </div>
          <button
            @click="handleRestage"
            :disabled="restaging || !restageRatios.length"
            class="w-full px-3 py-2 bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80 disabled:opacity-50 rounded-xl text-[11px] font-medium flex items-center justify-center gap-1"
          >
            <span class="material-symbols-outlined text-xs" :class="{ 'animate-spin': restaging }">
              {{ restaging ? 'progress_activity' : 'magic_button' }}
            </span>
            <span>{{ restaging ? '重构中...' : '以此图重新 AI 构图' }}</span>
          </button>
        </div>

        <div v-if="detail?.similar?.length" class="space-y-2 pt-2 border-t border-outline-variant">
          <p class="text-[11px] font-medium text-white flex items-center gap-1">
            <span class="material-symbols-outlined text-xs text-primary">auto_awesome</span>
            <span>相似设计推荐</span>
          </p>
          <div class="grid grid-cols-3 gap-2">
            <div
              v-for="sim in detail.similar"
              :key="sim.fid || sim.asset_fid"
              @click="switchFid(sim.fid || sim.asset_fid)"
              class="aspect-[9/16] bg-surface rounded-lg border border-outline-variant overflow-hidden cursor-pointer hover:border-primary transition relative"
            >
              <img
                :src="api.imageUrl(sim.fid || sim.asset_fid, sim.origin_derivative_id)"
                :alt="sim.file_name"
                loading="lazy"
                class="w-full h-full object-cover"
                @error="$event.target.style.opacity = '0.3'"
              />
              <div class="absolute bottom-0 inset-x-0 p-1 bg-black/60 text-[9px] text-on-surface truncate">
                推荐 · {{ sim.file_name }}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { api, getCurrentUser } from '../api'
import { RATIO_CHIPS, SIZE_PRESETS, pixelHint } from '../restage-presets'

const props = defineProps({
  visible: { type: Boolean, default: false },
  fid: { type: String, default: '' }
})
const emit = defineEmits(['close', 'select-asset'])

const loading = ref(false)
const restaging = ref(false)
const downloading = ref(false)
const downloadHint = ref('')
const toast = ref('')
const detail = ref(null)
const activeDerivativeId = ref(null)
const restageRatios = ref(['9:16', '3:4'])
const restageSize = ref('1080p')
const restageMain = ref('9:16')
const ratioChips = RATIO_CHIPS
const sizePresets = SIZE_PRESETS

const user = computed(() => getCurrentUser())
const isAdmin = computed(() => user.value?.role === 'admin')
const tagHistory = ref([])
const showTagHistory = ref(false)

async function toggleTagHistory() {
  const fid = detail.value?.asset?.fid
  if (!fid) return
  if (!tagHistory.value.length) {
    try {
      tagHistory.value = (await api.assetTagHistory(fid)) || []
    } catch (e) {
      console.error(e)
      tagHistory.value = []
    }
  }
  showTagHistory.value = !showTagHistory.value
}

const VERSION_SLOTS = [
  { slot: 'restage_3_4', label: '3:4' },
  { slot: 'restage_9_16', label: '9:16' },
  { slot: 'origin', label: '原图' }
]
const derivativesList = computed(() => detail.value?.derivatives || [])
const versionTabs = computed(() => {
  const list = derivativesList.value
  const st = detail.value?.restageStatus || {}
  return VERSION_SLOTS.map(t => {
    const derivative = t.slot === 'origin'
      ? (list.find(d => d.kind === 'origin') || null)
      : (list.find(d => d.kind === t.slot && (d.generated || d.params?.generated)) || null)
    const slotSt = st[t.slot]
    const missing = t.slot !== 'origin' && !derivative
    const pending = missing && (slotSt === 'queued' || slotSt === 'running')
    let title = t.label
    if (pending) title = `${t.label} 正在生成`
    else if (missing) title = `尚未生成 ${t.label}`
    return { ...t, derivative, missing, pending, status: slotSt || (derivative ? 'ready' : 'missing'), title }
  })
})
const activeTab = computed(() => versionTabs.value.find(t => {
  if (t.derivative && t.derivative.id === activeDerivativeId.value) return true
  if (!t.derivative && t.slot === activeDerivativeId.value) return true
  return false
}) || versionTabs.value.find(t => t.derivative) || null)
const activeDerivative = computed(() => {
  if (!detail.value) return null
  return derivativesList.value.find(d => d.id === activeDerivativeId.value)
    || activeTab.value?.derivative
    || null
})
const originDeriv = computed(() => derivativesList.value.find(d => d.kind === 'origin'))

function previewUrl(d) {
  const fid = d?.ownerFid || detail.value?.restageOwnerFid || detail.value?.asset?.fid
  if (!d && detail.value?.asset?.thumb_url) return detail.value.asset.thumb_url
  const isVideo = String(d?.mime || '').includes('video') || d?.kind === 'gen_video'
  return api.imageUrl(fid, d?.id, false, isVideo)
}

function onImgError(e) {
  const t = detail.value?.asset?.thumb_url
  if (t && e?.target && e.target.src !== t) {
    e.target.src = t
  }
}

function versionTabClass(tab) {
  const on = tab.derivative
    ? tab.derivative.id === activeDerivativeId.value
    : tab.slot === activeDerivativeId.value
  if (tab.pending) return on ? 'bg-tertiary/20 text-tertiary border border-tertiary/40' : 'text-tertiary border border-dashed border-tertiary/40'
  if (tab.missing) return on ? 'text-outline border border-dashed border-outline-variant' : 'text-outline border border-dashed border-outline-variant opacity-70'
  if (on) return 'bg-primary text-white'
  return 'text-on-surface-variant hover:bg-surface-high'
}

function selectVersion(tab) {
  if (tab.derivative) {
    activeDerivativeId.value = tab.derivative.id
    return
  }
  activeDerivativeId.value = tab.slot
  if (tab.pending) showToast(`${tab.label} 正在生成`)
  else if (tab.missing) showToast(`还没有 ${tab.label} 版本`)
}

const isFurniture = computed(() => detail.value?.asset?.category === 'furniture')

const primaryDims = computed(() => {
  if (isFurniture.value) {
    return ['furniture_category', 'furniture_item', 'material_kind', 'furniture_craft', 'furniture_form', 'classic_design', 'style_atom']
  }
  return ['space', 'style_atom', 'material_kind', 'design_tone', 'regional', 'color_system']
})

const primaryTags = computed(() => {
  const pDims = primaryDims.value
  return (detail.value?.tags || []).filter(t => pDims.includes(t.dimension))
})
const advancedTags = computed(() => {
  const pDims = primaryDims.value
  return (detail.value?.tags || []).filter(t => !pDims.includes(t.dimension))
})

const metaLine = computed(() => {
  const d = activeDerivative.value
  const a = detail.value?.asset
  if (d && (d.width || d.height)) {
    const bits = [`${d.width}×${d.height}`]
    const ratio = ratioFromKind(d.kind) || a?.origin_orientation
    if (ratio) bits.push(ratio)
    if (isGenerated(d)) bits.push('生成')
    return bits.join(' · ')
  }
  if (!a) return ''
  return `${a.width}×${a.height} · ${formatOrientation(a.origin_orientation)}`
})

const formattedTime = computed(() => {
  const ts = detail.value?.asset?.created_at || detail.value?.asset?.discovered_at
  if (!ts) return ''
  const num = Number(ts) < 1e11 ? Number(ts) * 1000 : Number(ts)
  const d = new Date(num)
  if (isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
})

const dimLabels = {
  // 空间维度
  space: '空间',
  style_atom: '风格',
  material_kind: '材质',
  design_tone: '调性',
  regional: '地域',
  color_system: '色系',
  shot: '景别',
  lighting: '光影',

  // 家具单品维度
  furniture_category: '家具大类',
  furniture_item: '单品品类',
  furniture_craft: '工艺处理',
  furniture_form: '造型特征',
  classic_design: '经典名款',
  recommended_space: '推荐空间',

  // 历史/高级属性
  palette: '配色',
  luxury: '奢华度',
  era: '时代感',
  temperature: '温度',
  functional: '功能性',
  quality: '品质感'
}
function getDimLabel(dim, role) {
  if (dim === 'material_kind') {
    if (role === 'main') return '硬装主材'
    if (role === 'accent') return '软装点缀'
    return '材质'
  }
  return dimLabels[dim] || dim
}

function isGenerated(d) {
  if (!d) return false
  if (d.params?.recast) return false
  if (d.generated || d.params?.generated) return true
  return false
}

function ratioFromKind(kind) {
  const m = String(kind || '').match(/^restage_(.+)$/)
  if (!m) return null
  return m[1].replace('_', ':')
}

function getDerivLabel(d) {
  const kind = typeof d === 'string' ? d : d.kind
  const m = {
    origin: '原图',
    clean: '去水印版',
    restage_9_16: '9:16 生成',
    restage_3_4: '3:4 生成',
    restage_1_1: '1:1 生成',
    restage_4_3: '4:3 生成',
    restage_16_9: '16:9 生成',
    restage_2_3: '2:3 生成',
    gen_video: '动态视频'
  }
  return m[kind] || kind
}

function getDerivIcon(kind) {
  if (kind === 'gen_video') return 'movie'
  if (String(kind).startsWith('restage_')) return 'crop_portrait'
  if (kind === 'clean') return 'cleaning_services'
  return 'image'
}

function formatOrientation(o) {
  const m = {
    '9:16': '9:16 竖幅',
    '3:4': '3:4 竖幅',
    '2:3': '2:3 竖幅',
    portrait: '竖图（非标准）',
    landscape: '横幅画幅',
    square: '方幅画幅',
    '16:9': '16:9 横幅',
    '4:3': '4:3 横幅',
    '1:1': '1:1'
  }
  return m[o] || o || '自适应'
}

function toggleRatio(r) {
  const i = restageRatios.value.indexOf(r)
  if (i >= 0) {
    if (restageRatios.value.length === 1) return
    restageRatios.value = restageRatios.value.filter(x => x !== r)
  } else {
    restageRatios.value = [...restageRatios.value, r]
  }
  if (!restageRatios.value.includes(restageMain.value)) {
    restageMain.value = restageRatios.value[0]
  }
}

function showToast(msg) {
  toast.value = msg
  setTimeout(() => { if (toast.value === msg) toast.value = '' }, 4000)
}

async function loadDetail(fid) {
  if (!fid) return
  loading.value = true
  try {
    const res = await api.assetDetail(fid)
    detail.value = res
    const list = res.derivatives || []
    const d916 = list.find(d => d.kind === 'restage_9_16' && (d.generated || d.params?.generated))
    // 优先本地产物，避免 origin/quark 现场下载失败导致空白
    const localFirst = list.find(d => d.storage_type === 'local_cache')
    const keep = list.find(d => d.id === activeDerivativeId.value)
    if (keep) activeDerivativeId.value = keep.id
    else if (d916) activeDerivativeId.value = d916.id
    else if (localFirst) activeDerivativeId.value = localFirst.id
    else activeDerivativeId.value = list[0]?.id || 'restage_9_16'
  } catch (e) {
    showToast('加载素材详情失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

function switchFid(nextFid) {
  emit('select-asset', nextFid)
  loadDetail(nextFid)
}

async function handleDownload(derivativeId) {
  if (!detail.value?.asset?.fid || downloading.value) return
  downloading.value = true
  downloadHint.value = '准备下载...'
  const timer = setTimeout(() => {
    downloadHint.value = '正在从网盘取原图，请稍候'
  }, 2000)
  try {
    await api.downloadAsset(detail.value.asset.fid, derivativeId)
    downloadHint.value = ''
  } catch (e) {
    showToast(e.message || '下载失败')
    downloadHint.value = ''
  } finally {
    clearTimeout(timer)
    downloading.value = false
  }
}

async function handleRestage() {
  if (!detail.value?.asset?.fid || restaging.value) return
  restaging.value = true
  try {
    const res = await api.triggerRestage(detail.value.asset.fid, {
      ratios: restageRatios.value,
      sizePreset: restageSize.value,
      mainRatio: '9:16',
      skipIfAlreadyExact: false
    })
    if (res && res.success !== false) {
      await loadDetail(detail.value.asset.fid)
    }
  } catch (err) {
    showToast('AI 重构失败: ' + (err.message || err))
  } finally {
    restaging.value = false
  }
}

async function handleRestageSlot(tab) {
  if (!detail.value?.asset?.fid || restaging.value) return
  const ratio = tab.slot === 'restage_3_4' ? '3:4' : '9:16'
  restaging.value = true
  try {
    await api.triggerRestage(detail.value.asset.fid, {
      ratios: [ratio],
      sizePreset: restageSize.value,
      mainRatio: '9:16',
      skipIfAlreadyExact: false
    })
    await loadDetail(detail.value.asset.fid)
    showToast(`已提交 ${ratio} 重构`)
  } catch (err) {
    showToast('AI 重构失败: ' + (err.message || err))
  } finally {
    restaging.value = false
  }
}

let pollTimer = null
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}
watch(() => detail.value?.restageStatus, (st) => {
  const pending = st && (st.restage_9_16 === 'queued' || st.restage_9_16 === 'running' || st.restage_3_4 === 'queued' || st.restage_3_4 === 'running')
  if (pending && props.visible && !pollTimer) {
    pollTimer = setInterval(() => {
      if (props.fid) loadDetail(props.fid)
    }, 4000)
  }
  if (!pending) stopPoll()
}, { deep: true })

watch(() => props.fid, (newFid) => {
  stopPoll()
  tagHistory.value = []
  showTagHistory.value = false
  if (newFid && props.visible) loadDetail(newFid)
}, { immediate: true })

watch(() => props.visible, (v) => {
  if (!v) stopPoll()
})

function onKey(e) {
  if (e.key === 'Escape' && props.visible) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  stopPoll()
})
</script>
