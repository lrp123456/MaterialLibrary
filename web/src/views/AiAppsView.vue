<template>
  <div class="max-w-7xl mx-auto p-3 sm:p-6 space-y-5">
    <!-- 顶部状态栏与核心理念 -->
    <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
      <div>
        <h1 class="text-sm font-bold text-white flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-base">apps</span>
          <span>AI 应用治理中心 (AI Applications)</span>
        </h1>
        <p class="text-[11px] text-on-surface-variant mt-0.5">
          业务操作与模型绑定的权威中枢；严格划分「自动化工作流（铁律免费别名）」与「手动创作工坊（最大权限开放）」
        </p>
      </div>

      <div class="flex items-center gap-2">
        <span class="px-2.5 py-1 rounded-xl text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>自动化流程：100% 免费合规</span>
        </span>
        <button
          @click="loadData"
          :disabled="loading"
          class="px-3 py-1.5 bg-surface border border-outline-variant hover:bg-surface-high text-white rounded-xl text-xs font-medium transition flex items-center gap-1 disabled:opacity-50"
        >
          <span class="material-symbols-outlined text-sm" :class="{ 'animate-spin': loading }">refresh</span>
          <span>刷新应用状态</span>
        </button>
      </div>
    </div>

    <!-- 板块切换选项卡 -->
    <div class="flex items-center gap-2 border-b border-outline-variant pb-2">
      <button
        @click="activeSection = 'all'"
        class="px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
        :class="activeSection === 'all' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:bg-surface-high'"
      >
        <span class="material-symbols-outlined text-sm">dashboard</span>
        <span>全部板块</span>
      </button>
      <button
        @click="activeSection = 'automation'"
        class="px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
        :class="activeSection === 'automation' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:bg-surface-high'"
      >
        <span class="material-symbols-outlined text-sm">precision_manufacturing</span>
        <span>自动化工作流 ({{ automationList.length }})</span>
      </button>
      <button
        @click="activeSection = 'manual'"
        class="px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
        :class="activeSection === 'manual' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:bg-surface-high'"
      >
        <span class="material-symbols-outlined text-sm">palette</span>
        <span>手动创作工坊 ({{ manualList.length }})</span>
      </button>
    </div>

    <!-- ================= 板块 1: 自动化工作流 (Automation) ================= -->
    <div v-if="activeSection === 'all' || activeSection === 'automation'" class="space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xs font-bold text-white flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            <span>自动化后台作业 (Automation Workflows)</span>
            <span class="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-normal">
              必须使用免费别名组，严禁产生额外资费
            </span>
          </h2>
          <p class="text-[10px] text-on-surface-variant mt-0.5">
            室内素材入库后由解释器自动调度的后台任务流（闸门过滤、多维空间打标、单品打标、画幅重构与向量化）
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="job in automationList"
          :key="job.id"
          class="bg-surface-low border border-outline-variant hover:border-emerald-500/50 rounded-2xl p-4 space-y-3 transition flex flex-col justify-between"
        >
          <div class="space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div>
                <span class="font-bold text-white text-xs flex items-center gap-1.5">
                  <span>{{ job.title }}</span>
                  <span class="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                    免费档
                  </span>
                </span>
                <p class="text-[10px] text-outline font-mono mt-0.5">{{ job.id }}</p>
              </div>
              <span class="material-symbols-outlined text-emerald-400 text-base">verified_user</span>
            </div>

            <p class="text-[11px] text-on-surface-variant leading-relaxed">
              {{ job.desc }}
            </p>

            <!-- 绑定模型选择 -->
            <div class="space-y-1 pt-1">
              <label class="block text-[10px] text-outline">执行模型 (限制免费池)</label>
              <select
                v-model="jobBindings[job.id].model_id"
                class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
              >
                <option v-for="m in job.capableModels" :key="m.id" :value="m.id">
                  {{ m.name }}
                </option>
              </select>
            </div>

            <!-- ★ 可选模型池：决定客户端下拉里能选哪些模型（默认模型必须在池内） -->
            <div v-if="job.selectableModels && job.selectableModels.length" class="space-y-1 pt-1">
              <label class="block text-[10px] text-outline">
                可选模型池（客户端下拉可切换 · 已选 {{ (jobBindings[job.id].allow_models || []).length }}）
              </label>
              <div class="flex flex-wrap gap-1">
                <label
                  v-for="m in job.selectableModels"
                  :key="m.id"
                  class="flex items-center gap-1 px-1.5 py-1 rounded-lg border text-[10px] cursor-pointer"
                  :class="(jobBindings[job.id].allow_models || []).includes(m.id)
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                    : 'bg-surface border-outline-variant text-outline hover:border-outline'"
                >
                  <input
                    type="checkbox"
                    class="accent-emerald-500"
                    :value="m.id"
                    v-model="jobBindings[job.id].allow_models"
                  />
                  <span>{{ m.name }}</span>
                  <span v-if="m.free" class="text-emerald-400">·免费</span>
                </label>
              </div>
              <p class="text-[9px] text-outline leading-relaxed">
                留空 = 不限制（客户端可选全部）。默认模型
                <span class="font-mono text-white">{{ jobBindings[job.id].model_id }}</span>
                不在池内时客户端仍可显示它，但建议勾选以免下拉为空。
              </p>
            </div>

            <!-- 参数摘要 -->
            <div v-if="job.fields && job.fields.length" class="text-[10px] text-outline space-y-0.5 pt-1">
              <div v-for="f in job.fields" :key="f.key" class="flex justify-between">
                <span>{{ f.label }}:</span>
                <span class="font-mono text-white">{{ formatParamVal(jobBindings[job.id].params?.[f.key], f.default) }}</span>
              </div>
            </div>
          </div>

          <div class="pt-2 border-t border-outline-variant flex items-center justify-between text-xs">
            <span class="text-[10px] text-outline">状态: 🟢 调度就绪</span>
            <button
              @click="saveJob(job.id)"
              :disabled="savingJob === job.id"
              class="px-3 py-1 bg-emerald-600/80 hover:bg-emerald-600 text-white rounded-lg text-[11px] font-medium transition flex items-center gap-1 disabled:opacity-50"
            >
              <span v-if="savingJob === job.id" class="material-symbols-outlined text-xs animate-spin">progress_activity</span>
              <span>保存配置</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= 板块 2: 手动创作工坊 (Manual / Studio) ================= -->
    <div v-if="activeSection === 'all' || activeSection === 'manual'" class="space-y-3 pt-2">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xs font-bold text-white flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-primary"></span>
            <span>手动创作工坊 (Manual Operations & Studio)</span>
            <span class="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20 font-normal">
              用户交互操作 · 最大权限开放 · 真实计费透明
            </span>
          </h2>
          <p class="text-[10px] text-on-surface-variant mt-0.5">
            客户端 App 与 H5 创作工坊直接调用的生成与编辑服务；支持选区降级说明、粘性参数与提示词优化
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="op in manualList"
          :key="op.id"
          class="bg-surface-low border border-outline-variant hover:border-primary/50 rounded-2xl p-4 space-y-3 transition flex flex-col justify-between"
        >
          <div class="space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div>
                <span class="font-bold text-white text-xs flex items-center gap-1.5">
                  <span>{{ op.title }}</span>
                  <span v-if="op.isFree" class="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-300 font-medium">免费</span>
                  <span v-else class="px-1.5 py-0.2 rounded text-[9px] bg-primary/20 text-primary font-medium">商业/高精</span>
                </span>
                <p class="text-[10px] text-outline font-mono mt-0.5">{{ op.id }}</p>
              </div>
              <span class="material-symbols-outlined text-primary text-base">
                {{ op.id === 'chat' ? 'chat' : op.id === 'image' ? 'photo_library' : op.id === 'video' ? 'videocam' : op.id === 'music' ? 'music_note' : 'auto_fix_high' }}
              </span>
            </div>

            <p class="text-[11px] text-on-surface-variant leading-relaxed">
              {{ op.desc }}
            </p>

            <!-- 精准编辑子操作：默认模型 + 可选模型池（此前完全只读，无法改） -->
            <div v-if="op.modes" class="space-y-1.5 pt-1">
              <label class="block text-[10px] text-outline">精准编辑子操作 · 默认模型 / 可选模型池</label>
              <div class="space-y-1">
                <div
                  v-for="m in op.modes"
                  :key="m.id"
                  class="p-2 rounded-xl bg-surface border border-outline-variant text-[11px] space-y-1"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-medium text-white">{{ m.label }}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-high font-mono text-outline">
                      {{ m.region === 'coords_bbox' ? '外接矩形 (bbox)' : m.region === 'mask' ? '遮罩图 (mask)' : '视觉描述 (text)' }}
                    </span>
                  </div>
                  <select
                    v-if="manualModeModels[m.id] && manualModeModels[m.id].length"
                    v-model="manualModeAllow[m.id]"
                    class="w-full bg-surface-low border border-outline-variant rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-primary"
                  >
                    <option
                      v-for="mm in manualModeModels[m.id]"
                      :key="mm.id"
                      :value="mm.id"
                    >{{ mm.name }}{{ mm.free ? ' ·免费' : '' }}</option>
                  </select>
                  <div v-if="manualModeModels[m.id] && manualModeModels[m.id].length > 1" class="flex flex-wrap gap-1 pt-0.5">
                    <label
                      v-for="mm in manualModeModels[m.id]"
                      :key="mm.id"
                      class="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] cursor-pointer"
                      :class="(manualModeAllowPool[m.id] || []).includes(mm.id)
                        ? 'bg-primary/15 border-primary/40 text-primary'
                        : 'bg-surface-low border-outline-variant text-outline'"
                    >
                      <input type="checkbox" class="accent-primary" :value="mm.id" v-model="manualModeAllowPool[m.id]" />
                      <span>{{ mm.name }}</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <!-- 模型选择 -->
            <div v-else class="space-y-1 pt-1">
              <label class="block text-[10px] text-outline">默认绑定模型</label>
              <select
                v-model="manualDefaults[op.id]"
                class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-white outline-none focus:border-primary"
              >
                <option v-for="m in op.capableModels" :key="m.id" :value="m.id">
                  {{ m.name }} ({{ m.provider }}) {{ m.free ? '· [免费]' : '' }}
                </option>
              </select>

              <!-- ★ 可选模型池：不勾=不限制；勾选后客户端下拉只剩这些 -->
              <div class="pt-1 space-y-1">
                <label class="block text-[10px] text-outline">
                  可选模型池（客户端下拉范围 · 已选 {{ (manualAllow[op.id] || []).length }}）
                </label>
                <div class="flex flex-wrap gap-1">
                  <label
                    v-for="m in op.capableModels"
                    :key="m.id"
                    class="flex items-center gap-1 px-1.5 py-1 rounded-lg border text-[10px] cursor-pointer"
                    :class="(manualAllow[op.id] || []).includes(m.id)
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'bg-surface border-outline-variant text-outline hover:border-outline'"
                  >
                    <input type="checkbox" class="accent-primary" :value="m.id" v-model="manualAllow[op.id]" />
                    <span>{{ m.name }}</span>
                    <span v-if="m.free" class="text-emerald-400">·免费</span>
                  </label>
                </div>
              </div>

              <div v-if="op.id === 'image'" class="pt-1 flex items-center gap-1.5 text-[10px] text-outline">
                <span class="material-symbols-outlined text-xs text-primary">info</span>
                <span>当前选区方案: 坐标矩形 (BBox) + 笔迹栅格化兜底</span>
              </div>
              <div v-if="op.id === 'video'" class="pt-1 flex items-center gap-1.5 text-[10px] text-outline">
                <span class="material-symbols-outlined text-xs text-primary">info</span>
                <span>防隐式计费: 参考视频必须用户长按 @ 明确选中</span>
              </div>
            </div>
          </div>

          <div class="pt-2 border-t border-outline-variant flex items-center justify-between text-xs">
            <span class="text-[10px] text-outline">
              <template v-if="op.modes">已选 {{ op.modes.length }} 个子操作模型</template>
              <template v-else>当前: {{ manualDefaults[op.id] || op.defaultModel }}</template>
            </span>
            <button
              @click="op.modes ? saveEditModes(op.id) : saveManualOp(op.id)"
              class="px-3 py-1 bg-primary hover:bg-primary/90 text-white rounded-lg text-[11px] font-medium transition"
            >
              {{ op.modes ? '保存子操作模型' : '更新默认' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { api } from '../api'

const activeSection = ref('all')
const loading = ref(false)
const savingJob = ref(null)

const automationList = ref([])
const manualList = ref([])
const jobBindings = reactive({})
const manualDefaults = reactive({})
const manualAllow = reactive({})
// 精准编辑子操作（expand / style_transfer / clarity …）各自的默认模型与可选池
const manualModeModels = reactive({})
const manualModeAllow = reactive({})
const manualModeAllowPool = reactive({})

async function loadData() {
  loading.value = true
  try {
    const res = await api.aiApplications()
    const data = res?.data || res || {}
    automationList.value = data.automation || []
    manualList.value = data.manual || []

    // 精准编辑子操作的模型候选来自「快捷作业」表（同一个作业池），保证治理台
    // 与客户端下拉看到的是同一份真相，不会出现「台上有、客户端没有」
    let quickJobs = []
    try {
      const jr = await api.genJobs()
      quickJobs = (jr?.data || jr || []).filter(j => j.group === 'quick')
    } catch (err) {
      console.warn('加载作业模型池失败，精准编辑子操作将不可改:', err)
    }
    const quickById = Object.fromEntries(quickJobs.map(j => [j.job_id, j]))

    for (const a of automationList.value) {
      jobBindings[a.id] = {
        model_id: a.defaultModel,
        params: a.params || {},
        allow_models: Array.isArray(a.allow_models) ? a.allow_models.slice() : []
      }
    }
    for (const m of manualList.value) {
      manualDefaults[m.id] = m.defaultModel
      manualAllow[m.id] = Array.isArray(m.allow_models) ? m.allow_models.slice() : []
      for (const md of (m.modes || [])) {
        const job = quickById[md.id]
        const pool = (job && job.selectable) || []
        manualModeModels[md.id] = pool.length ? pool : [{ id: md.model, name: md.model }]
        manualModeAllow[md.id] = md.model
        manualModeAllowPool[md.id] = Array.isArray(job && job.allow_models) ? job.allow_models.slice() : []
      }
    }
  } catch (err) {
    console.error('加载 AI 应用失败:', err)
  } finally {
    loading.value = false
  }
}

function formatParamVal(val, def) {
  if (val === undefined || val === null) return def || '默认'
  if (Array.isArray(val)) return val.join(', ')
  return String(val)
}

async function saveJob(jobId) {
  savingJob.value = jobId
  try {
    const b = jobBindings[jobId] || {}
    //★ allow_models 必须一起提交：治理台此前只存model_id，
    //   导致「只能设默认模型、设不了可选模型」——客户端下拉因此永远是空的。
    await api.saveGenJob(jobId, {
      model_id: b.model_id,
      params: b.params,
      allow_models: Array.isArray(b.allow_models) ? b.allow_models : []
    })
    alert(`成功更新作业 [${jobId}]\n默认模型: ${b.model_id}\n可选模型池: ${(b.allow_models || []).join(', ') || '不限制'}`)
    await loadData()
  } catch (err) {
    alert(`保存失败: ${err.message || err}`)
  } finally {
    savingJob.value = null
  }
}

/**
 * 保存精准编辑各子操作的默认模型 + 可选模型池。
 * 逐个写回 gen_job_bindings（复用自动化作业那套持久化），因此治理台与客户端共用一份真相。
 */
async function saveEditModes(opId) {
  const op = manualList.value.find(m => m.id === opId)
  if (!op || !op.modes) return
  const lines = []
  try {
    for (const md of op.modes) {
      const model = manualModeAllow[md.id]
      const allow = manualModeAllowPool[md.id] || []
      if (!model) continue
      await api.saveGenJob(md.id, { model_id: model, allow_models: allow })
      lines.push(`${md.label}: ${model}（可选 ${allow.length ? allow.join('/') : '不限制'}）`)
    }
    alert(`已保存精准编辑子操作模型：\n${lines.join('\n')}`)
    await loadData()
  } catch (err) {
    alert(`保存失败: ${err.message || err}`)
  }
}

async function saveManualOp(opId) {
  try {
    // 此前这里只有一句 alert —— 点「更新默认」什么都不存，刷新就丢。
    // 现在真正落库（服务端 kv: studio_manual_defaults），并把可选模型池一起提交。
    await api.saveManualDefaults({
      id: opId,
      default_model: manualDefaults[opId],
      allow_models: (manualAllow[opId] || []).slice()
    })
    alert(`已保存手动工坊 [${opId}]\n默认模型: ${manualDefaults[opId]}\n可选模型池: ${(manualAllow[opId] || []).join(', ') || '不限制'}`)
    await loadData()
  } catch (err) {
    alert(`保存失败: ${err.message || err}`)
  }
}

onMounted(() => {
  loadData()
})
</script>
