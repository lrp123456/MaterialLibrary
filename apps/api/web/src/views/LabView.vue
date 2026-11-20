<template>
  <div class="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
    <!-- 顶部 -->
    <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-sm font-bold text-white flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-base">science</span>
          <span>AI 试验场</span>
        </h1>
        <p class="text-[11px] text-on-surface-variant mt-0.5">
          按服务端能力目录动态渲染可用入口：图片精修（扩/增/删/改/超分）、生成方案（生图/生视频）、视频处理
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="loadCapabilities"
          :disabled="loading"
          class="px-3 py-1.5 rounded-xl bg-surface border border-outline-variant hover:bg-surface-high text-on-surface text-xs flex items-center gap-1.5 transition disabled:opacity-50"
        >
          <span class="material-symbols-outlined text-sm" :class="{ 'animate-spin': loading }">sync</span>
          <span>刷新能力目录</span>
        </button>
      </div>
    </div>

    <!-- 引擎状态条 -->
    <div v-if="catalog" class="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <div
        v-for="eng in engineCards"
        :key="eng.id"
        class="rounded-2xl border p-3 text-xs"
        :class="eng.ready ? 'bg-surface-low border-primary/40' : 'bg-surface-low border-outline-variant'"
      >
        <div class="flex items-center gap-2 font-semibold text-white">
          <span class="w-2 h-2 rounded-full" :class="eng.ready ? 'bg-ok' : 'bg-outline'"></span>
          <span>{{ eng.label }}</span>
        </div>
        <p class="mt-1 text-on-surface-variant leading-relaxed">
          {{ eng.ready ? eng.okText : (eng.reason || '未就绪') }}
        </p>
      </div>
    </div>

    <div v-if="error" class="rounded-xl border border-error/40 bg-error/10 text-error text-xs px-3 py-2">
      {{ error }}
    </div>

    <div v-if="loading && !catalog" class="text-on-surface-variant text-xs py-8 text-center">
      正在加载能力目录…
    </div>

    <div v-else-if="catalog" class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <!-- 左：入口目录 -->
      <div class="lg:col-span-7 space-y-4">
        <div v-for="g in catalog.groups" :key="g.id" class="space-y-2">
          <div class="flex items-center gap-2 px-1">
            <h2 class="text-xs font-bold text-on-surface-variant tracking-wide">{{ g.label }}</h2>
            <div class="flex-1 h-px bg-outline-variant/60"></div>
            <span class="text-[10px] text-outline">
              {{ entriesByGroup(g.id).filter(e => e.ready).length }}/{{ entriesByGroup(g.id).length }} 就绪
            </span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              v-for="e in entriesByGroup(g.id)"
              :key="e.id"
              type="button"
              @click="selectEntry(e)"
              :disabled="!e.ready"
              class="text-left rounded-2xl border p-3 transition"
              :class="entryClass(e)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>{{ e.label }}</span>
                    <span
                      class="px-1.5 py-0.5 rounded text-[9px] font-mono border"
                      :class="e.ready
                        ? 'border-primary/40 text-primary bg-primary/10'
                        : 'border-outline-variant text-outline'"
                    >{{ e.engine }}</span>
                  </div>
                  <p class="mt-1 text-[11px] text-on-surface-variant leading-snug line-clamp-2">
                    {{ e.description }}
                  </p>
                  <p v-if="!e.ready && e.unavailableReason" class="mt-1 text-[10px] text-error/90">
                    {{ e.unavailableReason }}
                  </p>
                </div>
                <span
                  class="material-symbols-outlined text-base flex-none"
                  :class="e.ready ? 'text-primary' : 'text-outline'"
                >{{ entryIcon(e) }}</span>
              </div>
              <div class="mt-2 flex flex-wrap gap-1 text-[9px] text-outline">
                <span v-if="e.multiAsset" class="px-1.5 py-0.5 rounded bg-surface border border-outline-variant">
                  多图 {{ e.minAssets }}–{{ e.maxAssets }}
                </span>
                <span v-else-if="e.requiresAsset" class="px-1.5 py-0.5 rounded bg-surface border border-outline-variant">
                  需源素材
                </span>
                <span v-else class="px-1.5 py-0.5 rounded bg-surface border border-outline-variant">
                  源素材可选
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- 右：执行面板 -->
      <div class="lg:col-span-5">
        <div class="lg:sticky lg:top-20 space-y-3">
          <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-xs font-bold text-white">
                {{ selected ? selected.label : '选择左侧入口开始测试' }}
              </h2>
              <span v-if="selected" class="text-[10px] font-mono text-outline">{{ selected.id }}</span>
            </div>

            <template v-if="selected">
              <!-- 源素材（必选 / 可选 / 多选） -->
              <div v-if="showAssetPicker" class="space-y-1.5">
                <label class="text-[11px] text-on-surface-variant font-medium">
                  源素材
                  <span v-if="selected.multiAsset" class="text-outline">（可多选 {{ selected.minAssets }}–{{ selected.maxAssets }}）</span>
                  <span v-else-if="selected.requiresAsset || selected.minAssets > 0" class="text-outline">（必选）</span>
                  <span v-else class="text-outline">（可选，不选则文生图/文生视频）</span>
                </label>
                <div class="flex gap-2">
                  <input
                    v-model="fidInput"
                    type="text"
                    placeholder="粘贴 fid，或从下方最近素材点选"
                    class="flex-1 px-2.5 py-1.5 rounded-xl bg-surface border border-outline-variant text-xs text-white focus:outline-none focus:border-primary"
                  />
                  <button
                    v-if="selected.multiAsset"
                    type="button"
                    @click="addFidFromInput"
                    class="px-2.5 py-1.5 rounded-xl bg-surface border border-outline-variant text-xs text-on-surface hover:bg-surface-high"
                  >
                    加入
                  </button>
                </div>
                <div v-if="selected.multiAsset && chosenFids.length" class="flex flex-wrap gap-1.5">
                  <span
                    v-for="f in chosenFids"
                    :key="f"
                    class="px-2 py-1 rounded-lg bg-primary/15 border border-primary/40 text-[10px] font-mono text-primary flex items-center gap-1"
                  >
                    {{ f }}
                    <button type="button" class="hover:text-error" @click="removeFid(f)">×</button>
                  </span>
                </div>

                <div class="flex items-center justify-between pt-1">
                  <span class="text-[10px] text-outline">最近素材</span>
                  <button type="button" class="text-[10px] text-primary hover:underline" @click="loadRecentAssets" :disabled="assetsLoading">
                    {{ assetsLoading ? '加载中…' : (recentAssets.length ? '刷新' : '加载最近素材') }}
                  </button>
                </div>
                <div v-if="recentAssets.length" class="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto">
                  <button
                    v-for="a in recentAssets"
                    :key="a.fid"
                    type="button"
                    @click="pickAsset(a.fid)"
                    class="aspect-square rounded-lg overflow-hidden border relative"
                    :class="isPicked(a.fid) ? 'border-primary' : 'border-outline-variant'"
                    :title="a.fid"
                  >
                    <img
                      v-if="a.kind !== 'video'"
                      :src="api.imageUrl(a.fid)"
                      class="w-full h-full object-cover"
                      loading="lazy"
                      @error="$event.target.style.display='none'"
                    />
                    <div v-else class="w-full h-full bg-surface flex items-center justify-center text-outline">
                      <span class="material-symbols-outlined text-lg">movie</span>
                    </div>
                  </button>
                </div>
              </div>

              <!-- 动态表单 -->
              <div class="space-y-2">
                <label
                  v-for="f in selected.fields"
                  :key="f.name"
                  class="block space-y-1"
                >
                  <span class="text-[11px] text-on-surface-variant font-medium">
                    {{ f.label || f.name }}
                    <span v-if="f.required" class="text-error">*</span>
                  </span>

                  <select
                    v-if="f.type === 'select'"
                    v-model="form[f.name]"
                    class="w-full px-2.5 py-1.5 rounded-xl bg-surface border border-outline-variant text-xs text-white focus:outline-none focus:border-primary"
                  >
                    <option v-for="opt in f.options" :key="opt" :value="opt">
                      {{ (f.labels && f.labels[opt]) || opt }}
                    </option>
                  </select>

                  <input
                    v-else-if="f.type === 'number'"
                    v-model.number="form[f.name]"
                    type="number"
                    :placeholder="f.placeholder || ''"
                    class="w-full px-2.5 py-1.5 rounded-xl bg-surface border border-outline-variant text-xs text-white focus:outline-none focus:border-primary"
                  />

                  <textarea
                    v-else-if="f.name === 'prompt' || f.name === 'perspective_quad'"
                    v-model="form[f.name]"
                    rows="3"
                    :placeholder="f.placeholder || ''"
                    class="w-full px-2.5 py-1.5 rounded-xl bg-surface border border-outline-variant text-xs text-white focus:outline-none focus:border-primary resize-y"
                  ></textarea>

                  <input
                    v-else
                    v-model="form[f.name]"
                    type="text"
                    :placeholder="f.placeholder || ''"
                    class="w-full px-2.5 py-1.5 rounded-xl bg-surface border border-outline-variant text-xs text-white focus:outline-none focus:border-primary"
                  />
                </label>
              </div>

              <button
                type="button"
                @click="submitRun"
                :disabled="submitting"
                class="w-full px-3 py-2.5 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-xs"
              >
                <span class="material-symbols-outlined text-sm" :class="{ 'animate-spin': submitting }">
                  {{ submitting ? 'progress_activity' : 'play_arrow' }}
                </span>
                <span>{{ submitting ? '提交中…' : '提交测试' }}</span>
              </button>
            </template>

            <p v-else class="text-[11px] text-outline leading-relaxed">
              左侧入口会根据 Umbra / 统一网关 / 生成适配器的配置状态动态点亮。未就绪的入口可查看原因后去「设置治理」或「模型与供应商」配置。
            </p>
          </div>

          <!-- 运行结果 -->
          <div v-if="run" class="bg-surface-low border border-outline-variant rounded-2xl p-4 space-y-3">
            <div class="flex items-center justify-between gap-2 text-xs">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full" :class="statusDotClass"></span>
                <span class="font-bold text-white">{{ statusLabel }}</span>
                <span class="text-outline font-mono text-[10px]">{{ run.engine }} / {{ run.runId }}</span>
              </div>
              <button
                v-if="run.mode === 'async' && !isTerminal"
                type="button"
                @click="pollOnce"
                :disabled="polling"
                class="text-primary hover:underline text-[11px] disabled:opacity-50"
              >
                {{ polling ? '轮询中…' : '刷新状态' }}
              </button>
            </div>

            <div v-if="run.progress != null" class="h-1.5 rounded-full bg-surface overflow-hidden">
              <div
                class="h-full bg-primary transition-all duration-500"
                :style="{ width: (run.progress || 0) + '%' }"
              ></div>
            </div>

            <p v-if="run.error" class="text-[11px] text-error leading-relaxed break-words">
              {{ run.error }}
            </p>

            <div v-if="resultMedia" class="rounded-xl overflow-hidden border border-outline-variant bg-surface">
              <video
                v-if="resultMedia.kind === 'video'"
                :src="resultMedia.url"
                controls
                class="w-full max-h-96 bg-black/40"
              ></video>
              <img
                v-else
                :src="resultMedia.url"
                class="w-full max-h-96 object-contain bg-black/30"
                alt="结果预览"
              />
            </div>

            <div v-if="run.result?.outputFid" class="text-[11px] text-on-surface-variant">
              输出素材：
              <span class="text-white font-mono select-all">{{ run.result.outputFid }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { api, getToken, API_BASE } from '../api'

const router = useRouter()

const loading = ref(false)
const assetsLoading = ref(false)
const submitting = ref(false)
const polling = ref(false)
const error = ref('')
const catalog = ref(null)
const selected = ref(null)
const form = reactive({})
const fidInput = ref('')
const chosenFids = ref([])
const recentAssets = ref([])
const run = ref(null)
let pollTimer = null

const engineCards = computed(() => {
  if (!catalog.value) return []
  const e = catalog.value.engines
  return [
    {
      id: 'umbra',
      label: 'Umbra 精修引擎',
      ready: e.umbra?.ready,
      reason: e.umbra?.reason,
      okText: `touch ${e.umbra?.touchReady ? '✓' : '×'} · walkthrough ${e.umbra?.walkReady ? '✓' : '×'}`
    },
    {
      id: 'gateway',
      label: '统一处理网关',
      ready: e.gateway?.ready,
      reason: e.gateway?.reason,
      okText: '去水印 / 扩图 / 画幅 / 视频'
    },
    {
      id: 'gen',
      label: '生成适配器',
      ready: e.gen?.ready,
      reason: e.gen?.reason,
      okText: `image ${e.gen?.imageAdapters?.length || 0} · video ${e.gen?.videoAdapters?.length || 0}`
    }
  ]
})

const isTerminal = computed(() => {
  if (!run.value) return true
  return ['success', 'failed', 'done', 'error'].includes(String(run.value.status || '').toLowerCase())
})

const showAssetPicker = computed(() => {
  if (!selected.value) return false
  return Boolean(selected.value.requiresAsset || selected.value.multiAsset || (selected.value.maxAssets || 0) > 0)
})

const resultMedia = computed(() => {
  const u = run.value?.result?.previewUrl
  if (!u) return null
  const mime = String(run.value.result.mime || '')
  const isVideo = mime.includes('video') || /\.(mp4|webm|mov)(\?|$)/i.test(String(u))
  return { kind: isVideo ? 'video' : 'image', url: absUrl(u) }
})

const statusLabel = computed(() => {
  if (!run.value) return ''
  const s = String(run.value.status || '').toLowerCase()
  const map = {
    pending: '排队中',
    queued: '排队中',
    running: '进行中',
    success: '成功',
    done: '完成',
    failed: '失败',
    error: '失败'
  }
  return map[s] || s
})

const statusDotClass = computed(() => {
  const s = String(run.value?.status || '').toLowerCase()
  if (['success', 'done'].includes(s)) return 'bg-ok'
  if (['failed', 'error'].includes(s)) return 'bg-error'
  return 'bg-tertiary'
})

function entriesByGroup(gid) {
  return (catalog.value?.entries || []).filter(e => e.group === gid)
}

function entryClass(e) {
  if (!e.ready) return 'bg-surface-low border-outline-variant opacity-55 cursor-not-allowed'
  if (selected.value?.id === e.id) return 'bg-primary/10 border-primary shadow-xs'
  return 'bg-surface-low border-outline-variant hover:border-primary/50 hover:bg-surface-high cursor-pointer'
}

function entryIcon(e) {
  if (e.id.includes('walkthrough') || e.id.includes('video')) return 'movie'
  if (e.id.includes('expand') || e.id.includes('outpaint')) return 'aspect_ratio'
  if (e.id.includes('remove') || e.id.includes('watermark')) return 'cleaning_services'
  if (e.id.includes('insert') || e.id.includes('replace')) return 'content_cut'
  if (e.id.includes('upscale')) return 'hd'
  if (e.id === 'gen.image') return 'image'
  if (e.id === 'gen.video') return 'videocam'
  return 'auto_fix_high'
}

function selectEntry(e) {
  if (!e.ready) return
  selected.value = e
  // 重置表单
  for (const k of Object.keys(form)) delete form[k]
  for (const f of e.fields || []) {
    if (f.default !== undefined) form[f.name] = f.default
    else if (f.type === 'number') form[f.name] = null
    else form[f.name] = ''
  }
  chosenFids.value = []
  fidInput.value = ''
  run.value = null
  stopPoll()
}

function isPicked(fid) {
  if (selected.value?.multiAsset) return chosenFids.value.includes(fid)
  return fidInput.value === fid
}

function pickAsset(fid) {
  if (selected.value?.multiAsset) {
    if (chosenFids.value.includes(fid)) {
      chosenFids.value = chosenFids.value.filter(x => x !== fid)
    } else if (chosenFids.value.length < (selected.value.maxAssets || 6)) {
      chosenFids.value = [...chosenFids.value, fid]
    }
  } else {
    fidInput.value = fid
  }
}

function addFidFromInput() {
  const v = String(fidInput.value || '').trim()
  if (!v) return
  if (!chosenFids.value.includes(v) && chosenFids.value.length < (selected.value?.maxAssets || 6)) {
    chosenFids.value = [...chosenFids.value, v]
  }
  fidInput.value = ''
}

function removeFid(f) {
  chosenFids.value = chosenFids.value.filter(x => x !== f)
}

async function loadRecentAssets() {
  assetsLoading.value = true
  try {
    const data = await api.assets({ limit: 24, status: 'ready' })
    const list = data?.items || data?.assets || data || []
    recentAssets.value = Array.isArray(list) ? list.slice(0, 24) : []
  } catch (e) {
    error.value = '加载素材失败: ' + e.message
  } finally {
    assetsLoading.value = false
  }
}

function absUrl(u) {
  if (!u) return ''
  let s = String(u)
  if (!s.startsWith('http')) {
    // 服务端可能写死 /api/...，DSH Webview 下需改写到 API_BASE
    if (s.startsWith('/api/') && API_BASE !== '/api') {
      s = API_BASE + s.slice('/api'.length)
    }
    const token = getToken()
    if (token) s = s + (s.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)
  }
  return s
}

async function loadCapabilities() {
  loading.value = true
  error.value = ''
  try {
    catalog.value = await api.labCapabilities()
    // 默认选中第一个就绪入口
    if (!selected.value) {
      const first = (catalog.value.entries || []).find(e => e.ready)
      if (first) selectEntry(first)
    }
  } catch (e) {
    error.value = e.message || '加载能力目录失败'
    catalog.value = null
  } finally {
    loading.value = false
  }
}

async function submitRun() {
  if (!selected.value) return
  error.value = ''
  submitting.value = true
  stopPoll()
  run.value = null
  try {
    const params = {}
    for (const [k, v] of Object.entries(form)) {
      if (v === null || v === undefined || v === '') continue
      params[k] = v
    }

    const body = { entryId: selected.value.id, params }
    if (selected.value.multiAsset) {
      if (chosenFids.value.length < (selected.value.minAssets || 2)) {
        throw new Error(`请至少选择 ${selected.value.minAssets || 2} 张源素材`)
      }
      body.fids = chosenFids.value
    } else if (selected.value.requiresAsset) {
      const f = String(fidInput.value || '').trim()
      if (!f) throw new Error('请选择或输入源素材 fid')
      body.fid = f
    } else if (String(fidInput.value || '').trim()) {
      body.fid = String(fidInput.value).trim()
    }

    const data = await api.labSubmit(body)
    run.value = {
      engine: data.engine,
      runId: data.runId,
      mode: data.mode,
      status: data.status,
      progress: data.progress ?? (data.mode === 'sync' ? 100 : 0),
      error: data.result?.error || data.error || null,
      result: data.result || null
    }
    if (data.mode === 'async') startPoll()
  } catch (e) {
    error.value = e.message || '提交失败'
  } finally {
    submitting.value = false
  }
}

function startPoll() {
  stopPoll()
  pollTimer = setInterval(() => { pollOnce() }, 2500)
  pollOnce()
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function pollOnce() {
  if (!run.value || run.value.mode !== 'async') return
  polling.value = true
  try {
    const st = await api.labRunStatus(run.value.engine, run.value.runId)
    run.value = {
      ...run.value,
      status: st.status,
      progress: st.progress ?? run.value.progress,
      error: st.error || null,
      result: st.result || null
    }
    if (isTerminal.value) stopPoll()
  } catch (e) {
    // 网络抖动不打断轮询
    if (String(e.message).includes('不存在')) {
      error.value = e.message
      stopPoll()
    }
  } finally {
    polling.value = false
  }
}

onMounted(() => {
  loadCapabilities()
})

onUnmounted(() => stopPoll())
</script>
