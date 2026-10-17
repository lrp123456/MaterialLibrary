<template>
  <div class="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
    <!-- 顶部导航切换 -->
    <div class="bg-surface-low border border-outline-variant rounded-2xl p-3 flex items-center justify-between">
      <div class="flex gap-1 text-xs">
        <button
          @click="tab = 'runs'"
          class="px-4 py-2 rounded-xl font-medium transition flex items-center gap-1.5"
          :class="tab === 'runs' ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">timeline</span>
          <span>批次运行历史</span>
        </button>

        <button
          @click="tab = 'exceptions'"
          class="px-4 py-2 rounded-xl font-medium transition flex items-center gap-1.5 relative"
          :class="tab === 'exceptions' ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">error_outline</span>
          <span>异常治理清单</span>
          <span v-if="exceptionsList.length" class="px-1.5 py-0.2 rounded-full bg-error text-black text-[10px] font-bold">
            {{ exceptionsList.length }}
          </span>
        </button>

        <button
          @click="tab = 'inspect'"
          class="px-4 py-2 rounded-xl font-medium transition flex items-center gap-1.5"
          :class="tab === 'inspect' ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">fact_check</span>
          <span>批次画布与视频抽检</span>
        </button>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="showTriggerModal = true"
          :disabled="actionBusy"
          class="px-3.5 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
        >
          <span class="material-symbols-outlined text-sm">play_arrow</span>
          <span>启动评估跑批</span>
        </button>

        <button @click="refresh" class="p-2 rounded-xl bg-surface border border-outline-variant hover:bg-surface-high text-on-surface text-xs flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">refresh</span>
          <span class="hidden sm:inline">刷新</span>
        </button>
      </div>
    </div>

    <!-- 1. 批次运行历史列表 -->
    <div v-if="tab === 'runs'" class="space-y-3">
      <div v-if="runsList.length" class="space-y-2.5">
        <div
          v-for="r in runsList"
          :key="r.id"
          class="bg-surface-low border border-outline-variant rounded-2xl p-4 space-y-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full" :class="getStatusColor(r.status)"></span>
              <span class="font-bold font-mono text-white">{{ r.id }}</span>
              <span class="px-2 py-0.5 rounded-md bg-surface border border-outline-variant text-[10px] text-outline font-mono">
                v{{ r.workflow_version }}
              </span>
              <span class="px-2 py-0.5 rounded-md text-[10px] font-medium" :class="getRunStatusBadgeClass(r)">
                {{ getRunStatusLabel(r) }}
              </span>
              <span class="text-on-surface-variant text-[11px]">触发: {{ r.trigger || 'manual' }}</span>
            </div>

            <div class="flex items-center gap-3 text-[11px] text-on-surface-variant flex-wrap">
              <span>总资产: <strong class="text-white">{{ r.asset_count }}</strong></span>
              <span v-if="r.ready_asset_count !== undefined">已入库可用: <strong class="text-primary font-bold">{{ r.ready_asset_count }} 张</strong></span>
              <span v-if="r.processing_asset_count">正在处理: <strong class="text-tertiary font-semibold">{{ r.processing_asset_count }} 张</strong></span>
              <span v-if="r.excluded_asset_count">闸门排除: <strong class="text-outline">{{ r.excluded_asset_count }} 张</strong></span>
              <span class="text-outline border-l border-outline-variant/60 pl-2">流转步骤: <strong class="text-primary">{{ r.success_count || 0 }}</strong><span v-if="r.pending_count"> / 排队 {{ r.pending_count }}</span></span>
              <span>失败: <strong :class="(r.failed_count || 0) > 0 ? 'text-error' : 'text-outline'">{{ r.failed_count || 0 }}</strong></span>
              <span class="text-outline">{{ new Date(r.created_at).toLocaleString() }}</span>
              <button
                @click="openCanvasInspect(r.id, null)"
                class="px-2 py-1 rounded-lg bg-primary/15 border border-primary/30 text-primary text-[10px] cursor-pointer"
              >
                在画布中查看
              </button>
              <button
                v-if="r.trigger === 'studio' || r.trigger === 'studio_triggered' || r.workflow_id === 'studio_triggered' || r.workflow_id === 'restage_pipeline'"
                @click="openUnpackModal(r.id)"
                class="px-2 py-1 rounded-lg bg-cyan/15 border border-cyan/40 text-cyan text-[10px] hover:bg-cyan/25 flex items-center gap-1"
                title="单次拆盒并重跑"
              >
                <span class="material-symbols-outlined text-[12px]">view_in_ar</span>
                <span>拆盒</span>
              </button>
              <button
                @click="toggleRunDetail(r.id)"
                class="px-2 py-1 rounded-lg bg-surface border border-outline-variant hover:bg-surface-high text-white text-[10px]"
              >
                {{ expandedRunId === r.id ? '收起明细' : '查看明细' }}
              </button>
            </div>
          </div>

          <!-- 统一批次图片统计总表 -->
          <BatchSummary :summary="r.batchSummary" />

          <!-- 三段式流转进度条 -->
          <div class="w-full h-2 bg-surface rounded-full overflow-hidden flex" :title="`总步骤: ${r.total_nodes || 0} (完成: ${r.success_count || 0}, 排队: ${r.pending_count || 0}, 失败: ${r.failed_count || 0})`">
            <div
              class="bg-primary h-full transition-all duration-500"
              :style="{ width: getRunProgressPct(r, 'success') + '%' }"
            ></div>
            <div
              class="bg-tertiary/70 h-full transition-all duration-500 animate-pulse"
              :style="{ width: getRunProgressPct(r, 'pending') + '%' }"
            ></div>
            <div
              class="bg-error h-full transition-all duration-500"
              :style="{ width: getRunProgressPct(r, 'failed') + '%' }"
            ></div>
          </div>

          <!-- 展开的资产明细与分页（移除 40 张截断限制） -->
          <div v-if="expandedRunId === r.id" class="pt-3 border-t border-outline-variant text-xs space-y-2.5">
            <div class="flex items-center justify-between">
              <p class="text-[11px] font-medium text-white">点选单张图片查看全链路流转（入/出/人话结论）</p>
              <div v-if="runPagination.totalPages > 1" class="flex items-center gap-1.5 text-[11px]">
                <button
                  @click="changeRunDetailPage(-1)"
                  :disabled="runPagination.page <= 1"
                  class="px-2 py-0.5 rounded bg-surface border border-outline-variant hover:bg-surface-high disabled:opacity-40 text-on-surface"
                >上一页</button>
                <span class="text-outline font-mono">{{ runPagination.page }} / {{ runPagination.totalPages }} (共 {{ runPagination.total }} 张)</span>
                <button
                  @click="changeRunDetailPage(1)"
                  :disabled="runPagination.page >= runPagination.totalPages"
                  class="px-2 py-0.5 rounded bg-surface border border-outline-variant hover:bg-surface-high disabled:opacity-40 text-on-surface"
                >下一页</button>
              </div>
            </div>

            <div class="max-h-72 overflow-y-auto space-y-1 pr-1">
              <div
                v-for="a in runDetails"
                :key="a.asset_fid"
                class="flex items-center justify-between p-2 rounded-xl bg-surface border border-outline-variant text-[11px] cursor-pointer hover:border-primary transition"
                @click="openLineage(r.id, a.asset_fid)"
                @dblclick.stop="openCanvasInspect(r.id, a.asset_fid)"
              >
                <div class="flex items-center gap-2 truncate max-w-[70%]">
                  <span class="w-2 h-2 rounded-full" :class="getStatusColor(a.last_status)"></span>
                  <img :src="api.imageUrl(a.asset_fid)" class="w-8 h-8 rounded object-cover bg-surface-high shrink-0" alt="" />
                  <span class="text-white truncate">{{ a.file_name || a.asset_fid }}</span>
                </div>
                <div class="flex items-center gap-2 text-outline shrink-0">
                  <span>{{ a.node_count || 1 }} 步</span>
                  <span class="px-1.5 py-0.5 rounded text-[10px]" :class="a.last_status === 'failed' ? 'bg-error/20 text-error' : 'bg-primary/20 text-primary'">{{ a.last_status }}</span>
                  <button
                    @click.stop="openCanvasInspect(r.id, a.asset_fid)"
                    class="text-primary text-[10px] hover:underline cursor-pointer"
                  >画布</button>
                </div>
              </div>
              <p v-if="!runDetails.length" class="text-center py-4 text-on-surface-variant text-[11px]">暂无资产明细</p>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="text-center py-20 bg-surface-low rounded-2xl border border-outline-variant p-6 text-on-surface-variant text-xs">
        暂无批次运行记录
      </div>
    </div>

    <!-- 2. 异常治理列表 -->
    <div v-if="tab === 'exceptions'" class="space-y-3">
      <!-- 过滤口径说明：让「为什么只有 5 条而不是 100 条」可解释，而不是让人怀疑漏了 -->
      <div class="bg-surface-low border border-outline-variant rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div class="flex items-start sm:items-center gap-2 min-w-0">
          <span class="material-symbols-outlined text-primary text-base mt-0.5 sm:mt-0">filter_alt</span>
          <div class="text-[11px] leading-relaxed text-on-surface-variant">
            <p class="font-medium text-on-surface">
              仅显示「资产仍存活 + 缺合格产物 + 偶发错误」的待治理项
            </p>
            <p class="text-outline">
              已自动排除：僵尸 {{ exceptionStats.zombie || 0 }} · 已恢复 {{ exceptionStats.recovered || 0 }} · 确定性错误 {{ exceptionStats.deterministic || 0 }} · 废弃来源 {{ exceptionStats.retired_source || 0 }}
            </p>
            <p v-if="exceptionStats.retired_source > 0" class="text-outline">
              夸克源已废弃（历史素材保持已拉取状态不动），其失败不再计入待治理
            </p>
          </div>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0 self-end sm:self-auto">
          <button
            v-for="s in [{ v: 'actionable', l: '待治理' }, { v: 'all', l: '含全部' }]"
            :key="s.v"
            @click="exceptionScope = s.v; refresh()"
            class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition"
            :class="exceptionScope === s.v ? 'bg-primary text-white' : 'bg-surface text-on-surface-variant hover:bg-surface-high'"
          >
            {{ s.l }}
          </button>
        </div>
      </div>

      <div v-if="exceptionsList.length" class="flex items-center justify-between bg-surface-low border border-outline-variant rounded-2xl p-3.5 shadow-xs">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-error text-base">warning</span>
          <span class="text-xs text-white font-medium">发现 {{ exceptionsList.length }} 个节点异常需要治理</span>
        </div>
        <button
          @click="retryAll"
          :disabled="isRetryingAll"
          class="px-3.5 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
        >
          <span v-if="isRetryingAll" class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
          <span v-else class="material-symbols-outlined text-sm">restart_alt</span>
          <span>{{ isRetryingAll ? '批量重试提交中...' : '一键重跑所有异常' }}</span>
        </button>
      </div>

      <div v-if="exceptionsList.length" class="space-y-2.5">
        <div
          v-for="ex in exceptionsList"
          :key="ex.id"
          class="bg-surface-low border border-error/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-xs"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-12 h-12 rounded-xl bg-surface border border-outline-variant overflow-hidden flex-shrink-0 flex items-center justify-center relative">
              <img
                :src="api.imageUrl(ex.fid || ex.asset_fid)"
                :alt="ex.file_name"
                class="w-full h-full object-cover z-10"
                @error="(e) => e.target.style.display = 'none'"
              />
              <span class="material-symbols-outlined text-outline text-lg absolute z-0">image</span>
            </div>

            <div class="space-y-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-bold text-white truncate max-w-xs">{{ ex.file_name || ex.asset_fid }}</span>
                <span class="px-1.5 py-0.2 rounded bg-error/20 text-error text-[10px] font-mono">
                  {{ ex.node_id }} 异常
                </span>
              </div>
              <p class="text-[11px] text-error truncate max-w-lg" :title="ex.error">
                {{ ex.error || '节点处理失败，资产已降级回退可用状态' }}
              </p>
              <p class="text-[10px] text-outline">
                {{ new Date(ex.updated_at || ex.created_at).toLocaleString() }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
            <button
              @click="retrySingle(ex.id)"
              :disabled="retryingId === ex.id"
              class="px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-medium hover:bg-primary/90 transition flex items-center gap-1 disabled:opacity-50"
            >
              <span v-if="retryingId === ex.id" class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              <span v-else class="material-symbols-outlined text-sm">replay</span>
              <span>单步重跑</span>
            </button>
          </div>
        </div>
      </div>

      <div v-else class="text-center py-20 bg-surface-low rounded-2xl border border-outline-variant p-6 text-on-surface-variant text-xs space-y-2">
        <span class="material-symbols-outlined text-3xl text-primary">check_circle</span>
        <p>当前产线健康，暂无任何异常或降级记录</p>
      </div>
    </div>

    <!-- 3. 批次画布与视频抽检 (原 /workflow 合入 /runs) -->
    <div v-if="tab === 'inspect'">
      <WorkflowView />
    </div>

    <div v-if="lineage" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="lineage = null">
      <div class="bg-surface-low border border-outline-variant rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <div class="px-4 py-3 border-b border-outline-variant flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-white">{{ lineage.asset?.file_name || lineage.asset?.fid }}</h3>
            <p class="text-[11px] text-on-surface-variant mt-0.5 font-mono">批次 {{ lineage.run?.id }} · 单张生命周期全路径</p>
          </div>
          <button @click="lineage = null" class="w-8 h-8 rounded-lg hover:bg-surface-high text-on-surface-variant flex items-center justify-center">
            <span class="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-4">
          <AssetLineagePanel
            :workflowNodes="defaultWorkflowNodes"
            :asset="lineage.asset"
            :nodeRuns="lineage.nodes"
            :cluster="lineage.cluster"
          />
        </div>
      </div>
    </div>

    <!-- 启动评估跑批弹窗 -->
    <div v-if="showTriggerModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-surface-low border border-outline-variant rounded-2xl w-full max-w-md p-5 space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-outline-variant">
          <h3 class="text-sm font-bold text-white flex items-center gap-1.5">
            <span class="material-symbols-outlined text-primary text-base">rocket_launch</span>
            <span>主动拉取评估与批次修复</span>
          </h3>
          <button @click="showTriggerModal = false" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block text-outline mb-1.5 font-medium">选择评估流转模式:</label>
            <div class="space-y-1.5">
              <label
                v-for="opt in runModes"
                :key="opt.value"
                class="flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition"
                :class="selectedMode === opt.value ? 'bg-primary/10 border-primary text-white' : 'bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-high'"
              >
                <input type="radio" :value="opt.value" v-model="selectedMode" class="mt-0.5 accent-primary" />
                <div>
                  <p class="font-medium text-white">{{ opt.label }}</p>
                  <p class="text-[11px] text-outline mt-0.5">{{ opt.desc }}</p>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label class="block text-outline mb-1.5 font-medium">单批处理上限数量:</label>
            <div class="flex gap-2">
              <button
                v-for="l in [50, 200, 500, 1000]"
                :key="l"
                type="button"
                @click="selectedLimit = l"
                class="px-3 py-1.5 rounded-xl border text-xs font-mono transition flex-1 text-center"
                :class="selectedLimit === l ? 'bg-primary text-white border-primary font-bold' : 'bg-surface border-outline-variant text-outline hover:text-white'"
              >
                {{ l }}
              </button>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-outline-variant">
          <button @click="showTriggerModal = false" class="px-4 py-1.5 rounded-xl bg-surface text-on-surface-variant text-xs">
            取消
          </button>
          <button
            @click="submitTriggerRun"
            :disabled="actionBusy"
            class="px-4 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <span v-if="actionBusy" class="material-symbols-outlined text-xs animate-spin">progress_activity</span>
            <span>立即启动流转</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 拆盒抽屉/弹窗 (仅工坊触发运行可见) -->
    <div
      v-if="showUnpackModal && currentUnpack"
      class="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
    >
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-2xl w-full p-4 sm:p-5 space-y-4 shadow-card">
        <div class="flex items-center justify-between border-b border-outline-variant pb-3">
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-2">
              <span class="material-symbols-outlined text-cyan text-base">view_in_ar</span>
              <span>单次运行拆盒 · 工坊触发链</span>
            </h3>
            <p class="text-[11px] text-on-surface-variant mt-0.5">
              批次 {{ currentUnpack.runId }} · 展开本次识图字段与提示词，修改后仅重跑生图步骤（不写回模板与优化器）
            </p>
          </div>
          <button @click="showUnpackModal = false" class="text-outline hover:text-white text-lg">✕</button>
        </div>

        <!-- 识图提取字段 -->
        <div class="bg-surface p-3 rounded-xl border border-outline-variant space-y-2 text-xs">
          <span class="font-semibold text-white block">本次识图字段 (Vision Fields)</span>
          <div class="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span class="text-outline">空间分类:</span>
              <span class="text-white ml-1 font-medium">{{ currentUnpack.visionFields?.category || '未识别' }}</span>
            </div>
            <div>
              <span class="text-outline">空间类型:</span>
              <span class="text-white ml-1 font-medium">{{ currentUnpack.visionFields?.room_type || '未识别' }}</span>
            </div>
            <div>
              <span class="text-outline">风格调性:</span>
              <span class="text-white ml-1 font-medium">{{ currentUnpack.visionFields?.style || '未识别' }}</span>
            </div>
            <div>
              <span class="text-outline">主体材质:</span>
              <span class="text-white ml-1 font-medium">{{ currentUnpack.visionFields?.materials || '未识别' }}</span>
            </div>
          </div>
          <div v-if="currentUnpack.visionFields?.description" class="text-[11px] text-on-surface-variant pt-1 border-t border-outline-variant/60">
            {{ currentUnpack.visionFields.description }}
          </div>
        </div>

        <!-- 可编辑提示词 -->
        <div class="space-y-1.5 text-xs">
          <label class="font-semibold text-white block">可编辑最终提示词 (Final Prompt)</label>
          <textarea
            v-model="currentUnpack.editablePrompt"
            rows="4"
            class="w-full bg-surface border border-outline-variant rounded-xl p-3 text-xs text-white outline-none focus:border-primary resize-y font-mono"
            placeholder="编辑本次生图提示词后重跑…"
          ></textarea>
        </div>

        <!-- 生图重跑结果展示 (若有) -->
        <div v-if="rerunResult" class="bg-surface p-3 rounded-xl border border-ok/40 space-y-2 text-xs">
          <span class="font-semibold text-ok flex items-center gap-1">
            <span class="material-symbols-outlined text-sm">check_circle</span>
            <span>重跑完成</span>
          </span>
          <div v-if="rerunResult.files && rerunResult.files[0]" class="rounded-lg overflow-hidden border border-outline-variant max-h-60 bg-black/40">
            <img :src="rerunResult.files[0].previewUrl || `/api/cache/temp/${rerunResult.files[0].fileName}`" class="w-full h-full object-contain" />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant text-xs">
          <button @click="showUnpackModal = false" class="px-3.5 py-1.5 rounded-xl bg-surface border border-outline-variant hover:bg-surface-high text-on-surface">
            关闭
          </button>
          <button
            @click="submitRerunGen"
            :disabled="isRerunningGen"
            class="px-4 py-1.5 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <span v-if="isRerunningGen" class="material-symbols-outlined text-xs animate-spin">progress_activity</span>
            <span>{{ isRerunningGen ? '生图中…' : '从生图步骤重跑' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import WorkflowView from './WorkflowView.vue'
import { api } from '../api'
import BatchSummary from '../components/BatchSummary.vue'
import AssetLineagePanel from '../components/AssetLineagePanel.vue'

const route = useRoute()
const router = useRouter()
function openCanvasInspect(runId, fid) {
  router.replace({ path: '/runs', query: { ...(runId ? { run: runId } : {}), ...(fid ? { fid } : {}), tab: 'inspect' } })
  tab.value = 'inspect'
}
const showUnpackModal = ref(false)
const currentUnpack = ref(null)
const isRerunningGen = ref(false)
const rerunResult = ref(null)

async function openUnpackModal(runId) {
  try {
    const data = await api.unpackRun(runId)
    currentUnpack.value = data
    rerunResult.value = null
    showUnpackModal.value = true
  } catch (e) {
    alert('拆盒失败: ' + e.message)
  }
}

async function submitRerunGen() {
  if (!currentUnpack.value) return
  isRerunningGen.value = true
  try {
    const res = await api.rerunGen(currentUnpack.value.runId, {
      prompt: currentUnpack.value.editablePrompt,
      model: currentUnpack.value.model,
      params: currentUnpack.value.params
    })
    rerunResult.value = res?.data || res
    await refresh()
  } catch (e) {
    alert('重跑生图失败: ' + e.message)
  } finally {
    isRerunningGen.value = false
  }
}
const lineage = ref(null)
const defaultWorkflowNodes = ref([])

const tab = ref('runs')
const runsList = ref([])
const exceptionsList = ref([])
const exceptionStats = ref({ total: 0, actionable: 0, recovered: 0, deterministic: 0 })
const exceptionScope = ref('actionable')

const expandedRunId = ref(null)
const runDetails = ref([])
const runPagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 1 })
const retryingId = ref(null)

const actionBusy = ref(false)
const busyAction = ref('')
const showTriggerModal = ref(false)
const selectedMode = ref('unprocessed')
const selectedLimit = ref(200)

const runModes = [
  {
    value: 'unprocessed',
    label: '增量/未就绪素材流转',
    desc: '自动拉取新发现（discovered）或排队打标中的素材进行全流程处理'
  },
  {
    value: 'watermarked',
    label: '专项修复：带水印素材去水印',
    desc: '针对已检测出水印的 46 张图片重新启动去水印修复处理'
  },
  {
    value: 'non_vertical',
    label: '专项处理：非 9:16 画幅构图',
    desc: '针对 3:4/方图等横幅室内设计图，调用 AI 适配器重新生成竖屏主图'
  },
  {
    value: 'all',
    label: '全量重跑评估 (重新评定)',
    desc: '对库内全部图片按最新工作流配置重新流转评定'
  },
  {
    value: 'restage_missing',
    label: '补跑：缺合格 9:16/3:4 的代表图',
    desc: '只入队 AI 画幅重构，不重跑闸门/打标。原图已是 9:16 也会走 Agnes。'
  }
]

function getStatusColor(status) {
  if (status === 'done') return 'bg-primary'
  if (status === 'running') return 'bg-tertiary animate-pulse'
  if (status === 'failed') return 'bg-error'
  if (status === 'partial_failed') return 'bg-tertiary'
  return 'bg-outline'
}

function getRunProgressPct(r, type) {
  const total = (r.total_nodes && r.total_nodes > 0)
    ? r.total_nodes
    : ((r.success_count || 0) + (r.pending_count || 0) + (r.failed_count || 0) || r.asset_count || 1);
  if (type === 'success') {
    return Math.min(100, Math.round(((r.success_count || 0) / total) * 100));
  }
  if (type === 'pending') {
    return Math.min(100, Math.round(((r.pending_count || 0) / total) * 100));
  }
  if (type === 'failed') {
    return Math.min(100, Math.round(((r.failed_count || 0) / total) * 100));
  }
  return 0;
}

function getRunStatusLabel(r) {
  if (r.status === 'running' || (r.pending_count && r.pending_count > 0)) return '⚡ 流转处理中'
  if (r.status === 'done' || (!r.pending_count && !r.failed_count)) return '✅ 全部就绪'
  if (r.status === 'partial_failed') return '⚠️ 部分异常'
  if (r.status === 'failed') return '❌ 失败'
  return '⏸️ 排队中'
}

function getRunStatusBadgeClass(r) {
  if (r.status === 'running' || (r.pending_count && r.pending_count > 0)) return 'bg-tertiary/20 text-tertiary border border-tertiary/30'
  if (r.status === 'done' || (!r.pending_count && !r.failed_count)) return 'bg-primary/20 text-primary border border-primary/30'
  if (r.status === 'partial_failed') return 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
  if (r.status === 'failed') return 'bg-error/20 text-error border border-error/30'
  return 'bg-surface text-outline border border-outline-variant'
}

async function refresh() {
  try {
    const [runs, exRes] = await Promise.all([
      api.runs(),
      api.exceptionsFull(exceptionScope.value)
    ])
    runsList.value = runs || []
    exceptionsList.value = exRes?.data || []
    exceptionStats.value = exRes?.meta?.stats || { total: 0, actionable: 0, recovered: 0, deterministic: 0 }
  } catch (e) {
    console.error('获取运行历史失败:', e)
  }
}

async function openLineage(runId, fid) {
  try {
    lineage.value = await api.runAssetLineage(runId, fid)
  } catch (e) {
    alert('加载节点血缘失败: ' + e.message)
  }
}

async function fetchRunDetails(runId, page = 1) {
  try {
    const r = await api.runDetail(runId, page, 20)
    runDetails.value = r?.assets || []
    runPagination.value = r?.pagination || { page: 1, pageSize: 20, total: runDetails.value.length, totalPages: 1 }
  } catch (e) {
    console.error('获取批次明细失败:', e)
  }
}

async function toggleRunDetail(runId) {
  if (expandedRunId.value === runId) {
    expandedRunId.value = null
    runDetails.value = []
    return
  }
  expandedRunId.value = runId
  await fetchRunDetails(runId, 1)
}

async function changeRunDetailPage(delta) {
  const newPage = runPagination.value.page + delta
  if (newPage < 1 || newPage > runPagination.value.totalPages) return
  await fetchRunDetails(expandedRunId.value, newPage)
}

async function loadWorkflowNodes() {
  try {
    const wf = await api.workflow('default')
    defaultWorkflowNodes.value = wf?.graph?.nodes || []
  } catch (e) {
    console.error('加载默认工作流节点失败:', e)
  }
}

async function retrySingle(nodeRunId) {
  retryingId.value = nodeRunId
  try {
    await api.retryNodeRun(nodeRunId)
    alert('已将该节点重新放入执行队列！')
    await refresh()
  } catch (e) {
    alert('重试失败: ' + e.message)
  } finally {
    retryingId.value = null
  }
}

const isRetryingAll = ref(false)
async function retryAll() {
  if (!confirm(`确定要重跑全部 ${exceptionsList.value.length} 个异常节点吗？\n（仅重试资产仍存活的偶发失败，僵尸/已恢复/确定性错误会自动跳过）`)) return
  isRetryingAll.value = true
  try {
    const res = await api.retryAllFailed()
    const n = res?.retried_count || res?.data?.retried_count || 0
    const skipped = res?.skipped_noise || res?.data?.skipped_noise || 0
    const skippedRetired = res?.skipped_retired_source || res?.data?.skipped_retired_source || 0
    const parts = []
    if (skipped) parts.push(`已跳过噪音记录 ${skipped} 条（僵尸/已恢复/确定性错误）`)
    if (skippedRetired) parts.push(`已跳过废弃来源 ${skippedRetired} 条（夸克源已废弃）`)
    alert(`已提交批量重跑，共 ${n} 个异常任务正在后台执行！${parts.length ? '\n' + parts.join('\n') : ''}`)
    await refresh()
  } catch (e) {
    alert('批量重跑失败: ' + e.message)
  } finally {
    isRetryingAll.value = false
  }
}

async function triggerScan() {
  actionBusy.value = true
  busyAction.value = 'scan'
  try {
    const r = await api.scan()
    alert(`夸克网盘扫描完成！\n• 网盘图片总数: ${r.totalImages}\n• 新增入库素材: ${r.newImages} 张\n• 待处理就绪: ${r.discoveredImages} 张`)
    await refresh()
  } catch (e) {
    alert('扫描失败: ' + e.message)
  } finally {
    actionBusy.value = false
    busyAction.value = ''
  }
}

async function submitTriggerRun() {
  actionBusy.value = true
  busyAction.value = 'run'
  try {
    const targetNodeId = selectedMode.value === 'watermarked' ? 'clean'
      : selectedMode.value === 'non_vertical' ? 'restage_9_16'
      : selectedMode.value === 'restage_missing' ? 'restage_dual'
      : null
    const res = await api.triggerRun({
      mode: selectedMode.value,
      limit: selectedLimit.value,
      targetNodeId
    })
    showTriggerModal.value = false
    if (res.runId) {
      alert(`已成功创建流转批次 ${res.runId}！\n入队素材: ${res.count} 张，后台解释器正深度优先处理。`)
    } else {
      alert(res.message || '当前无符合条件的素材需处理')
    }
    await refresh()
  } catch (e) {
    alert('启动批次失败: ' + e.message)
  } finally {
    actionBusy.value = false
    busyAction.value = ''
  }
}

onMounted(async () => {
  await Promise.all([refresh(), loadWorkflowNodes()])
  if (route.query.tab === 'inspect') {
    tab.value = 'inspect'
  } else if (route.query.run) {
    await toggleRunDetail(route.query.run)
    if (route.query.fid) await openLineage(route.query.run, route.query.fid)
  }
})
</script>
