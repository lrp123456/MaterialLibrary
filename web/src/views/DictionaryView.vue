<template>
  <div class="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
    <!-- 顶部状态与操作条 -->
    <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-xl">label</span>
          <h1 class="text-sm font-bold text-white">动态标签字典与视觉判据治理</h1>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary-dim font-semibold font-mono">
            Tag Dictionary
          </span>
        </div>
        <p class="text-[11px] text-on-surface-variant mt-1 leading-relaxed">
          全系统统一的标签分类池与视觉判定标准 · 变更将即时联动工作流打标节点与 <code class="text-cyan">&#123;&#123;@dict.xxx&#125;&#125;</code> 模板芯片
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="dictSubTab = dictSubTab === 'audit' ? 'tags' : 'audit'"
          class="px-3 py-1.5 rounded-xl border border-outline-variant text-on-surface-variant hover:bg-surface-high hover:text-white text-xs flex items-center gap-1.5 transition cursor-pointer"
        >
          <span class="material-symbols-outlined text-sm">history</span>
          <span>{{ dictSubTab === 'audit' ? '返回标签列表' : '变更审计历史' }}</span>
        </button>

        <button
          :disabled="!activeDimMeta || activeDimMeta.readonly"
          @click="openAddTag"
          class="px-3.5 py-1.5 bg-primary hover:bg-primary-dim text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition shadow-sm disabled:opacity-40 cursor-pointer"
        >
          <span class="material-symbols-outlined text-sm">add</span>
          <span>新增标签枚举</span>
        </button>
      </div>
    </div>

    <!-- 过滤器与维度选择条 -->
    <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 space-y-3 text-xs">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <!-- 分区选项卡 -->
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-outline font-medium">分区:</span>
          <button
            v-for="g in dictGroups"
            :key="g.key"
            @click="activeGroup = g.key"
            class="px-3 py-1.5 rounded-xl font-medium transition cursor-pointer"
            :class="activeGroup === g.key ? 'bg-primary text-white shadow-sm' : 'bg-surface text-on-surface-variant hover:bg-surface-high hover:text-white border border-outline-variant'"
          >
            {{ g.label }}
          </button>

          <label class="ml-2 flex items-center gap-1.5 text-on-surface-variant cursor-pointer select-none">
            <input type="checkbox" v-model="showDeprecated" class="accent-primary rounded" />
            <span>含已废弃</span>
          </label>
        </div>

        <!-- 标签关键词搜索 -->
        <div class="flex items-center gap-2 min-w-[200px]">
          <div class="relative w-full">
            <span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-outline text-sm">search</span>
            <input
              v-model="searchKw"
              type="text"
              placeholder="搜索当前维度标签 / 别名..."
              class="w-full bg-surface border border-outline-variant rounded-xl pl-8 pr-3 py-1.5 text-white outline-none focus:border-primary text-xs"
            />
          </div>
        </div>
      </div>

      <!-- 维度下拉选择 -->
      <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-outline-variant">
        <span class="text-outline font-medium">维度:</span>
        <select
          v-model="activeDim"
          class="bg-surface border border-outline-variant rounded-xl px-3 py-1.5 text-white outline-none focus:border-primary min-w-56 cursor-pointer"
        >
          <option v-for="d in visibleDims" :key="d.key" :value="d.key">
            {{ d.label }} ({{ d.key }}) · 可用 {{ d.count }}<template v-if="d.deprecatedCount"> / 废弃 {{ d.deprecatedCount }}</template>
          </option>
        </select>

        <span v-if="activeDimMeta?.readonly" class="text-[10px] px-2 py-0.5 rounded bg-surface text-outline border border-outline-variant font-mono">系统只读</span>
        <span v-if="activeDimMeta?.multi" class="text-[10px] px-2 py-0.5 rounded bg-primary/15 text-primary font-mono">多选维度</span>
        <span v-else class="text-[10px] px-2 py-0.5 rounded bg-surface text-on-surface-variant border border-outline-variant font-mono">单选维度</span>

        <span class="text-on-surface-variant text-[11px] ml-auto font-mono opacity-80">
          引用芯片：&#123;&#123;@dict.{{ activeDim }}&#125;&#125;
        </span>
      </div>
    </div>

    <!-- 标签卡片网格列表 -->
    <div v-if="dictSubTab === 'tags'" class="space-y-3">
      <div class="flex items-center justify-between text-[11px] text-outline px-1">
        <span>共 {{ searchedTags.length }} 个有效项 (已载入 {{ currentDimTags.length }})</span>
        <button
          v-if="isAdmin && currentDimTags.length"
          @click="openRetagConfirm([activeDim])"
          class="px-2.5 py-1 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 transition cursor-pointer flex items-center gap-1"
        >
          <span class="material-symbols-outlined text-xs">auto_fix_high</span>
          <span>按本维重打低置信 / 回退项</span>
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="t in searchedTags"
          :key="t.id || t.dir"
          class="bg-surface-low border rounded-2xl p-4 space-y-2.5 transition hover:border-outline-variant/80 flex flex-col justify-between"
          :class="t.deprecated ? 'border-err/30 opacity-60 bg-surface-low/50' : 'border-outline-variant'"
        >
          <div class="space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-bold text-white text-sm truncate">{{ t.label }}</p>
                <p class="text-[11px] text-cyan font-mono truncate">{{ t.dir }}</p>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-surface text-on-surface-variant border border-outline-variant font-mono">
                  {{ t.usage_count || 0 }} 张
                </span>
                <span
                  class="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  :class="t.deprecated ? 'bg-err/15 text-err' : 'bg-ok/15 text-ok'"
                >
                  {{ t.deprecated ? '已废弃' : '生效中' }}
                </span>
              </div>
            </div>

            <!-- 视觉判据 -->
            <div class="p-2.5 rounded-xl bg-surface border border-outline-variant text-[11px] text-on-surface-variant leading-relaxed">
              <span class="text-primary-dim font-semibold">视觉判据：</span>
              <span>{{ t.criteria || '(按字面标准特征识别，未设专属判据)' }}</span>
            </div>

            <!-- 同义别名 -->
            <div v-if="t.aliases?.length" class="text-[11px] text-outline flex items-baseline gap-1.5">
              <span class="shrink-0 text-on-surface-variant">别名:</span>
              <span class="font-mono text-white truncate">{{ t.aliases.join(' / ') }}</span>
            </div>
          </div>

          <div v-if="isAdmin && !activeDimMeta?.readonly" class="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant text-xs">
            <button
              @click="openEditTag(t)"
              class="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-high text-white border border-outline-variant transition cursor-pointer"
            >
              编辑判据
            </button>
            <button
              v-if="!t.deprecated"
              @click="deprecateTag(t)"
              class="px-2.5 py-1 rounded-lg bg-err/10 hover:bg-err/20 text-err border border-err/25 transition cursor-pointer"
            >
              废弃
            </button>
            <button
              v-else
              @click="restoreTag(t)"
              class="px-2.5 py-1 rounded-lg bg-ok/15 hover:bg-ok/25 text-ok border border-ok/30 transition cursor-pointer"
            >
              恢复启用
            </button>
          </div>
        </div>
      </div>

      <div v-if="!searchedTags.length" class="p-8 text-center text-on-surface-variant text-xs bg-surface-low border border-outline-variant rounded-2xl">
        {{ searchKw ? '未匹配到包含该关键词的标签' : '当前维度暂无标签记录' }}
      </div>
    </div>

    <!-- 字典变更审计历史 -->
    <div v-else class="bg-surface-low border border-outline-variant rounded-2xl overflow-hidden text-xs">
      <div class="p-4 border-b border-outline-variant flex items-center justify-between">
        <h3 class="text-sm font-semibold text-white">标签字典变更审计日志</h3>
        <span class="text-outline text-[11px]">记录标签的新增、修改、废弃与恢复轨迹</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="bg-surface text-outline text-[11px] border-b border-outline-variant">
            <tr>
              <th class="p-3">时间</th>
              <th class="p-3">操作动作</th>
              <th class="p-3">维度</th>
              <th class="p-3">标签</th>
              <th class="p-3">机器码</th>
              <th class="p-3">受影响资产</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant">
            <tr v-for="a in auditList" :key="a.id" class="hover:bg-surface/50 text-[11px]">
              <td class="p-3 font-mono text-outline">{{ formatTime(a.created_at) }}</td>
              <td class="p-3">
                <span class="px-2 py-0.5 rounded font-medium" :class="auditBadgeClass(a.action)">
                  {{ auditActionLabel(a.action) }}
                </span>
              </td>
              <td class="p-3 font-mono text-white">{{ a.dimension }}</td>
              <td class="p-3 text-white font-medium">{{ a.label }}</td>
              <td class="p-3 font-mono text-cyan">{{ a.dir }}</td>
              <td class="p-3">
                <button
                  v-if="a.affected_count"
                  @click="loadAuditAssets(a)"
                  class="text-primary hover:underline font-mono"
                >
                  {{ a.affected_count }} 张
                </button>
                <span v-else class="text-outline">0</span>
              </td>
            </tr>
            <tr v-if="!auditList.length">
              <td colspan="6" class="p-6 text-center text-on-surface-variant">暂无变更日志</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新增 / 编辑标签弹窗 -->
    <div v-if="showAddTag" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="showAddTag = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 text-xs">
        <div class="flex items-center justify-between pb-2 border-b border-outline-variant">
          <h3 class="text-sm font-bold text-white flex items-center gap-1.5">
            <span class="material-symbols-outlined text-primary text-base">{{ editingTagId ? 'edit' : 'add_circle' }}</span>
            <span>{{ editingTagId ? '编辑标签判据与别名' : '新增标签枚举' }}</span>
          </h3>
          <span class="font-mono text-primary text-[11px]">{{ activeDim }}</span>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block text-outline mb-1 font-medium">显示名称 (中文) *</label>
            <input
              v-model="tagForm.label"
              type="text"
              placeholder="如 换鞋区 / 胡桃木"
              class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary"
            />
          </div>

          <div>
            <label class="block text-outline mb-1 font-medium">机器目录码 (dir) — 留空自动拼音转化</label>
            <input
              v-model="tagForm.dir"
              type="text"
              placeholder="如 shoe_area / walnut"
              class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono"
            />
          </div>

          <div>
            <label class="block text-outline mb-1 font-medium">视觉识别判定标准 (criteria) — 注入大模型打标 Prompt</label>
            <textarea
              v-model="tagForm.criteria"
              rows="3"
              placeholder="例：画面中必须存在入户门及鞋柜/换鞋凳等收纳要素"
              class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary text-xs leading-relaxed"
            ></textarea>
            <button
              type="button"
              @click="fillDraftCriteria"
              class="mt-1 text-[11px] text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span class="material-symbols-outlined text-xs">auto_awesome</span>
              <span>按名称智能补全草稿</span>
            </button>
          </div>

          <div>
            <label class="block text-outline mb-1 font-medium">同义词别名 (aliases) — 英文或中文逗号隔开</label>
            <input
              v-model="tagForm.aliasesText"
              type="text"
              placeholder="如 玄关, 门厅, 落尘区"
              class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary"
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-outline-variant">
          <button @click="showAddTag = false" class="px-4 py-1.5 rounded-xl bg-surface hover:bg-surface-high text-on-surface-variant transition cursor-pointer">
            取消
          </button>
          <button @click="submitAddTag" class="px-4 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white font-semibold transition cursor-pointer">
            保存提交
          </button>
        </div>
      </div>
    </div>

    <!-- 重新打标确认弹窗 -->
    <div v-if="showRetagModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="showRetagModal = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 text-xs">
        <h3 class="text-sm font-bold text-white flex items-center gap-1.5">
          <span class="material-symbols-outlined text-primary text-base">psychology</span>
          <span>词表变更后批量重新打标</span>
        </h3>
        <p class="text-on-surface-variant leading-relaxed">
          涉及维度：<span class="text-white font-medium">{{ (retagPendingDims || []).join('、') }}</span><br />
          预计影响 <span class="text-primary font-bold text-sm">{{ retagEstimate }}</span> 张素材（低置信度 + 回退/other + 缺失有效标签）
        </p>
        <p v-if="retagEstimate > 400" class="text-[11px] text-err bg-err/10 p-2.5 rounded-xl border border-err/20">
          数量较大（>400张），建议走「今晚闲时重打」以避免挤占白天 GPU/API 配额。
        </p>
        <div class="flex flex-col gap-2 pt-2 border-t border-outline-variant">
          <button @click="runRetag('night')" class="w-full px-4 py-2 rounded-xl bg-surface text-white font-medium hover:bg-surface-high transition cursor-pointer">
            今晚闲时重打 (02:30 自动执行)
          </button>
          <button @click="runRetag('now')" class="w-full px-4 py-2 rounded-xl bg-primary hover:bg-primary-dim text-white font-semibold transition cursor-pointer">
            立刻重打{{ retagEstimate > 400 ? '（强制调度）' : '' }}
          </button>
          <button @click="showRetagModal = false" class="w-full px-4 py-2 rounded-xl text-on-surface-variant hover:text-white transition cursor-pointer">
            暂不重打
          </button>
        </div>
      </div>
    </div>

    <!-- 受影响资产抽屉 -->
    <div v-if="affectedAssets.length" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="affectedAssets = []">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-3 text-xs">
        <div class="flex items-center justify-between pb-2 border-b border-outline-variant">
          <h3 class="text-sm font-bold text-white">受影响资产清单 ({{ affectedAssets.length }})</h3>
          <button @click="affectedAssets = []" class="text-outline hover:text-white cursor-pointer">关闭</button>
        </div>
        <div class="max-h-80 overflow-y-auto space-y-1">
          <div v-for="a in affectedAssets" :key="a.fid" class="p-2 rounded-lg bg-surface text-on-surface-variant truncate font-mono text-[11px]">
            {{ a.file_name || a.fid }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { api, getCurrentUser } from '../api'

const currentUser = getCurrentUser()
const isAdmin = computed(() => currentUser?.role === 'admin')

const dictGroups = ref([
  { key: 'space', label: '空间素材' },
  { key: 'furniture', label: '家具单品' },
  { key: 'aux', label: '辅助检索' },
  { key: 'legacy', label: '已废弃' }
])
const activeGroup = ref('space')
const activeDim = ref('room_type')
const showDeprecated = ref(false)
const dictSubTab = ref('tags')
const searchKw = ref('')

const allTags = ref([])
const allDims = ref([])
const auditList = ref([])
const affectedAssets = ref([])

const showAddTag = ref(false)
const editingTagId = ref(null)
const tagForm = ref({ dir: '', label: '', criteria: '', aliasesText: '' })

const showRetagModal = ref(false)
const retagPendingDims = ref([])
const retagEstimate = ref(0)

const visibleDims = computed(() => {
  return allDims.value.filter(d => {
    if (activeGroup.value === 'legacy') return d.group === 'legacy' || d.deprecatedCount > 0
    if (showDeprecated.value) return d.group === activeGroup.value || (activeGroup.value === 'space' && d.group === 'space')
    return d.group === activeGroup.value && (d.count > 0 || !d.deprecatedGroup)
  })
})

const activeDimMeta = computed(() => allDims.value.find(d => d.key === activeDim.value) || null)

const currentDimTags = computed(() => {
  let list = allTags.value.filter(t => t.dimension === activeDim.value)
  if (!showDeprecated.value && activeGroup.value !== 'legacy') {
    list = list.filter(t => !t.deprecated)
  }
  return list
})

const searchedTags = computed(() => {
  const kw = searchKw.value.trim().toLowerCase()
  if (!kw) return currentDimTags.value
  return currentDimTags.value.filter(t => {
    return (t.label && t.label.toLowerCase().includes(kw)) ||
      (t.dir && t.dir.toLowerCase().includes(kw)) ||
      (t.aliases && t.aliases.some(a => a.toLowerCase().includes(kw)))
  })
})

watch(activeGroup, () => {
  const first = visibleDims.value[0]
  if (first) activeDim.value = first.key
})

watch(showDeprecated, () => {
  if (!visibleDims.value.find(d => d.key === activeDim.value)) {
    const first = visibleDims.value[0]
    if (first) activeDim.value = first.key
  }
})

watch(dictSubTab, async (v) => {
  if (v === 'audit') await loadAudit()
})

function formatTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function auditActionLabel(a) {
  return ({ create: '新增', update: '修改', deprecate: '废弃', restore: '恢复' })[a] || a
}

function auditBadgeClass(a) {
  return ({
    create: 'bg-primary/20 text-primary-dim',
    update: 'bg-ok/20 text-ok',
    deprecate: 'bg-err/20 text-err',
    restore: 'bg-cyan/20 text-cyan'
  })[a] || 'bg-surface text-on-surface-variant'
}

async function loadData() {
  try {
    const dictRes = await api.dict(true).catch(() => ({ tags: [], dimensions: [] }))
    if (Array.isArray(dictRes)) {
      allTags.value = dictRes
      const dimMap = new Map()
      for (const t of dictRes) {
        if (!dimMap.has(t.dimension)) {
          dimMap.set(t.dimension, { key: t.dimension, label: t.dimension, group: 'other', count: 0, deprecatedCount: 0 })
        }
        const d = dimMap.get(t.dimension)
        if (t.deprecated) d.deprecatedCount++
        else d.count++
      }
      allDims.value = [...dimMap.values()]
    } else {
      allTags.value = dictRes.tags || []
      allDims.value = dictRes.dimensions || []
      if (dictRes.groups?.length) {
        dictGroups.value = dictRes.groups.filter(g => g.key !== 'other')
      }
    }
    if (!allDims.value.find(d => d.key === activeDim.value)) {
      const first = visibleDims.value[0]
      if (first) activeDim.value = first.key
    }
  } catch (e) {
    console.error('加载字典失败:', e)
  }
}

async function loadAudit() {
  try {
    auditList.value = (await api.dictAudit()) || []
  } catch (e) {
    console.error(e)
  }
}

async function loadAuditAssets(a) {
  try {
    affectedAssets.value = (await api.dictAuditAssets(a.id)) || []
  } catch (e) {
    alert('加载失败: ' + e.message)
  }
}

function openAddTag() {
  editingTagId.value = null
  tagForm.value = { dir: '', label: '', criteria: '', aliasesText: '' }
  showAddTag.value = true
}

function openEditTag(t) {
  editingTagId.value = t.id
  tagForm.value = {
    dir: t.dir,
    label: t.label,
    criteria: t.criteria || '',
    aliasesText: (t.aliases || []).join(', ')
  }
  showAddTag.value = true
}

async function fillDraftCriteria() {
  if (!tagForm.value.label) return alert('请先填写名称')
  try {
    const r = await api.draftCriteria({ dimension: activeDim.value, label: tagForm.value.label })
    tagForm.value.criteria = r.criteria || ''
  } catch (e) {
    tagForm.value.criteria = `识别为「${tagForm.value.label}」时的可观察视觉特征。`
  }
}

async function submitAddTag() {
  if (!tagForm.value.label?.trim()) return alert('请填写显示名称')
  try {
    const aliases = tagForm.value.aliasesText
      .split(/[,，、]/)
      .map(s => s.trim())
      .filter(Boolean)
    await api.saveTag({
      dimension: activeDim.value,
      dir: tagForm.value.dir?.trim() || undefined,
      label: tagForm.value.label.trim(),
      criteria: tagForm.value.criteria || '',
      aliases
    })
    showAddTag.value = false
    tagForm.value = { dir: '', label: '', criteria: '', aliasesText: '' }
    editingTagId.value = null
    await loadData()
    await openRetagConfirm([activeDim.value])
  } catch (e) {
    alert('保存标签失败: ' + e.message)
  }
}

async function deprecateTag(t) {
  if (!confirm(`确定废弃「${t.label}」吗？历史资产标签仍会保留，但不再参与新入库打标。`)) return
  try {
    await api.deprecateTag({ id: t.id })
    await loadData()
  } catch (e) {
    alert('废弃失败: ' + e.message)
  }
}

async function restoreTag(t) {
  try {
    await api.restoreTag({ id: t.id })
    await loadData()
    await openRetagConfirm([t.dimension])
  } catch (e) {
    alert('恢复失败: ' + e.message)
  }
}

async function openRetagConfirm(dims) {
  retagPendingDims.value = dims
  retagEstimate.value = 0
  showRetagModal.value = true
  try {
    const r = await api.estimateRetag(dims)
    retagEstimate.value = r.total || 0
  } catch (e) {
    console.error(e)
  }
}

async function runRetag(mode) {
  try {
    await api.triggerRetag({ dimensions: retagPendingDims.value, mode })
    showRetagModal.value = false
    alert(mode === 'night' ? '已排入今晚 02:30 自动执行计划' : '重打标任务已下发至后台')
  } catch (e) {
    alert('触发失败: ' + e.message)
  }
}

onMounted(loadData)
</script>
