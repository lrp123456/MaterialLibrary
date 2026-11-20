<template>
  <div class="max-w-[1600px] mx-auto p-3 sm:p-6 space-y-4" :class="{ 'max-w-none p-0': fullscreen }">
    <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3" :class="{ 'rounded-none border-x-0': fullscreen }">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
          <span class="material-symbols-outlined text-xl">{{ pipelineMode === 'video' ? 'movie' : 'account_tree' }}</span>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-sm font-bold text-white">
              {{ inspectMode ? '批次巡检画布' : (pipelineMode === 'video' ? '视频产线画布' : (workflow?.name || '默认室内设计产线')) }}
            </h1>
            <span class="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-mono font-bold">
              v{{ workflow?.version || 1 }}
            </span>
            <span v-if="inspectRun" class="px-2 py-0.5 rounded-md text-[10px] font-mono bg-surface border border-outline-variant text-on-surface-variant truncate max-w-[220px]">
              {{ inspectRun.id }}
            </span>
          </div>
          <p class="text-[11px] text-on-surface-variant">
            {{ inspectMode ? '滚轮缩放 · 点左侧图片查看全链路生命周期与画布着色' : (pipelineMode === 'video' ? '视频空图已就绪：空图不拦截流转，支持保存与在库视频播放。' : '滚轮缩放、拖动画布、点连接点连线。保存后下一轮跑批生效。') }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <!-- 图片/视频流水线切换 Tab (仅非巡检模式展示) -->
        <div v-if="!inspectMode" class="flex rounded-xl border border-outline-variant overflow-hidden text-[11px] font-medium mr-1">
          <button
            type="button"
            class="px-3 py-1.5 flex items-center gap-1.5 transition"
            :class="pipelineMode === 'image' ? 'bg-primary text-white' : 'bg-surface text-on-surface-variant hover:bg-surface-high'"
            @click="switchPipeline('image')"
          >
            <span class="material-symbols-outlined text-sm">photo_library</span>
            <span>图片流水线</span>
          </button>
          <button
            type="button"
            class="px-3 py-1.5 flex items-center gap-1.5 transition"
            :class="pipelineMode === 'video' ? 'bg-primary text-white' : 'bg-surface text-on-surface-variant hover:bg-surface-high'"
            @click="switchPipeline('video')"
          >
            <span class="material-symbols-outlined text-sm">movie</span>
            <span>视频流水线</span>
          </button>
        </div>

        <div class="flex rounded-xl border border-outline-variant overflow-hidden text-[11px]">
          <button type="button" class="px-2.5 py-1.5" :class="boardTool === 'select' ? 'bg-primary text-white' : 'bg-surface text-on-surface-variant'" @click="boardTool = 'select'">选择</button>
          <button type="button" class="px-2.5 py-1.5" :class="boardTool === 'pan' ? 'bg-primary text-white' : 'bg-surface text-on-surface-variant'" @click="boardTool = 'pan'">平移</button>
        </div>
        <button type="button" @click="fullscreen = !fullscreen" class="px-3 py-1.5 rounded-xl bg-surface border border-outline-variant text-xs text-on-surface">
          {{ fullscreen ? '退出全屏' : '全屏' }}
        </button>
        <template v-if="!inspectMode">
          <button
            v-if="pipelineMode === 'image'"
            @click="triggerRun"
            :disabled="actionBusy"
            class="px-3 py-1.5 rounded-xl bg-surface border border-outline-variant hover:bg-surface-high text-xs text-on-surface flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <span class="material-symbols-outlined text-sm">play_arrow</span>
            <span>启动全量跑批</span>
          </button>
          <button
            v-else
            @click="triggerStartVideo"
            :disabled="videoStarting"
            class="px-3 py-1.5 rounded-xl bg-surface border border-outline-variant hover:bg-surface-high text-xs text-on-surface flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <span v-if="videoStarting" class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
            <span v-else class="material-symbols-outlined text-sm">play_circle</span>
            <span>启动视频就绪入库</span>
          </button>
          <button @click="saveNewVersion" :disabled="saving || (!isDirty && pipelineMode !== 'video')" class="px-4 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition disabled:opacity-50 flex items-center gap-1.5 shadow-sm">
            <span v-if="saving" class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
            <span v-else class="material-symbols-outlined text-sm">save</span>
            <span>保存新版本 (v{{ (workflow?.version || 1) + 1 }})</span>
          </button>
        </template>
        <router-link v-else to="/runs" class="px-3 py-1.5 rounded-xl bg-surface border border-outline-variant text-xs text-on-surface">返回批次</router-link>
      </div>
    </div>

    <!-- 巡检模式：顶部统一批次图片统计总表 -->
    <BatchSummary v-if="inspectMode && inspectBatchSummary" :summary="inspectBatchSummary" />

    <div class="flex flex-col xl:flex-row gap-3" :class="fullscreen ? 'h-[calc(100vh-72px)]' : 'min-h-[640px]'">
      <aside v-if="!inspectMode" class="w-full xl:w-44 shrink-0 bg-surface-low border border-outline-variant rounded-2xl p-3 space-y-2 overflow-y-auto">
        <p class="text-[11px] font-semibold text-white px-1">节点库</p>
        <p class="text-[10px] text-on-surface-variant px-1 pb-1">点一下加到画布，接到当前选中节点之后</p>
        <button
          v-for="spec in catalog"
          :key="spec.type"
          type="button"
          @click="addNode(spec.type)"
          class="w-full text-left px-2 py-2 rounded-xl bg-surface border border-outline-variant hover:border-primary hover:bg-surface-high transition"
        >
          <span class="flex items-center gap-1.5 text-[11px] text-white">
            <span class="material-symbols-outlined text-sm text-primary">{{ spec.icon || 'hub' }}</span>
            <span>{{ spec.name }}</span>
          </span>
          <span class="block text-[9px] text-on-surface-variant mt-0.5 leading-snug">{{ spec.description }}</span>
        </button>
      </aside>

      <aside v-else class="w-full xl:w-56 shrink-0 bg-surface-low border border-outline-variant rounded-2xl p-3 space-y-2 overflow-y-auto">
        <div class="flex items-center justify-between px-1">
          <p class="text-[11px] font-semibold text-white">执行历史</p>
          <span class="text-[10px] text-outline font-mono">{{ inspectPagination.total }} 张</span>
        </div>
        <div v-if="inspectPagination.totalPages > 1" class="flex items-center justify-between text-[10px] px-1 py-1 rounded-lg bg-surface border border-outline-variant/60">
          <button
            @click="changeInspectPage(-1)"
            :disabled="inspectPagination.page <= 1"
            class="px-1.5 py-0.5 rounded hover:bg-surface-high disabled:opacity-30 text-on-surface"
          >上页</button>
          <span class="text-outline font-mono">{{ inspectPagination.page }} / {{ inspectPagination.totalPages }}</span>
          <button
            @click="changeInspectPage(1)"
            :disabled="inspectPagination.page >= inspectPagination.totalPages"
            class="px-1.5 py-0.5 rounded hover:bg-surface-high disabled:opacity-30 text-on-surface"
          >下页</button>
        </div>
        <p class="text-[10px] text-on-surface-variant px-1">点一张图看它在各节点的入出</p>
        <div class="space-y-1.5">
          <button
            v-for="a in inspectAssets"
            :key="a.fid"
            type="button"
            class="w-full text-left px-2 py-2 rounded-xl border transition flex items-center gap-2"
            :class="inspectFid === a.fid ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-outline-variant bg-surface hover:border-primary'"
            @click="selectInspectFid(a.fid)"
          >
            <img :src="api.imageUrl(a.fid)" class="w-8 h-8 rounded object-cover bg-surface-high shrink-0" alt="" />
            <span class="min-w-0 flex-1">
              <span class="block text-[11px] text-white truncate">{{ a.file_name || a.fid }}</span>
              <span class="block text-[9px] text-on-surface-variant font-mono">{{ a.last_status }}</span>
            </span>
          </button>
        </div>
        <p v-if="!inspectAssets.length" class="text-[10px] text-on-surface-variant px-1 text-center py-4">这个批次还没有资产记录</p>
      </aside>

      <div
        class="flex-1 bg-surface-low border border-outline-variant rounded-2xl relative overflow-hidden"
        :class="fullscreen ? 'h-full min-h-0' : 'h-[640px] min-h-[520px]'"
      >
        <VueFlow
          id="ml-flow"
          v-model:nodes="vfNodes"
          v-model:edges="vfEdges"
          :node-types="nodeTypes"
          :min-zoom="0.55"
          :max-zoom="2"
          :default-viewport="{ zoom: 0.9, x: 40, y: 80 }"
          :pan-on-drag="boardTool === 'pan'"
          :selection-on-drag="boardTool === 'select'"
          :nodes-draggable="boardTool === 'select' && !inspectMode"
          :nodes-connectable="!inspectMode"
          :edges-updatable="!inspectMode"
          class="h-full w-full"
          @connect="onConnect"
          @node-click="onNodeClick"
          @node-drag-stop="onNodeDragStop"
        >
          <Background :gap="18" :size="1" pattern-color="#30363d" />
          <Controls position="bottom-left" />
          <MiniMap position="bottom-right" pannable zoomable :node-color="miniColor" />
        </VueFlow>
      </div>

      <aside class="w-full xl:w-96 bg-surface-low border border-outline-variant rounded-2xl p-4 space-y-4 overflow-y-auto">
        <div v-if="inspectMode && inspectDetail?.asset" class="space-y-4">
          <!-- 选中的单张全链路路径与人话解读 -->
          <AssetLineagePanel
            :workflowNodes="graph.nodes"
            :asset="inspectDetail.asset"
            :nodeRuns="inspectDetail.nodes"
            :cluster="inspectDetail.cluster"
          />

          <!-- 当前选定节点在画布上的详细输入输出 -->
          <div v-if="inspectNode" class="pt-3 border-t border-outline-variant space-y-2 text-xs">
            <div class="flex items-center justify-between pb-1 border-b border-outline-variant/60">
              <h4 class="text-xs font-bold text-white">{{ selectedNode?.name || inspectNode.node_id }} (画布聚焦)</h4>
              <span class="text-[10px] text-outline font-mono">{{ inspectNode.node_type }} · {{ inspectNode.status }}</span>
            </div>
            <p v-if="inspectNode.error" class="text-error text-[11px]">{{ inspectNode.error }}</p>
            <div>
              <p class="font-medium text-white mb-1">输入</p>
              <pre class="bg-surface rounded-lg p-2 overflow-auto max-h-36 text-[10px] text-on-surface-variant font-mono">{{ pretty(inspectNode.input) }}</pre>
            </div>
            <div>
              <p class="font-medium text-white mb-1">输出</p>
              <pre class="bg-surface rounded-lg p-2 overflow-auto max-h-36 text-[10px] text-on-surface-variant font-mono">{{ pretty(inspectNode.output) }}</pre>
            </div>
            <img
              v-if="inspectNode.derivative_id && inspectAssetFid"
              :src="api.imageUrl(inspectAssetFid, inspectNode.derivative_id)"
              class="w-full rounded-xl border border-outline-variant object-contain max-h-56 bg-surface"
              alt=""
            />
          </div>
        </div>

        <div v-else-if="inspectMode" class="text-xs space-y-2 py-8 text-center text-on-surface-variant">
          <span class="material-symbols-outlined text-2xl text-outline mb-1">touch_app</span>
          <h3 class="text-sm font-bold text-white">未选资产</h3>
          <p class="text-[11px] leading-relaxed">
            先从左侧执行历史点选一张图片，画布将高亮其经历的节点路径并着色。
          </p>
        </div>
        <div v-else-if="selectedNode" class="space-y-4 text-xs">
          <div class="flex items-start justify-between pb-3 border-b border-outline-variant gap-2">
            <div>
              <h3 class="text-sm font-bold text-white">{{ selectedNode.name }}</h3>
              <p class="text-[11px] text-on-surface-variant mt-0.5 font-mono">{{ selectedNode.type }} · {{ selectedNode.id }}</p>
            </div>
            <div class="flex items-center gap-2">
              <label class="flex items-center gap-1 text-[11px] cursor-pointer">
                <input type="checkbox" v-model="selectedNode.enabled" @change="onGraphEdit" class="accent-primary" />
                <span :class="selectedNode.enabled ? 'text-primary' : 'text-outline'">{{ selectedNode.enabled ? '启用' : '跳过' }}</span>
              </label>
              <button v-if="!inspectMode" type="button" @click="removeSelected" class="text-error text-[10px] hover:underline">删除</button>
            </div>
          </div>

          <router-link
            v-if="lastRunId"
            :to="{ path: '/workflow', query: { run: lastRunId } }"
            class="block text-[11px] text-primary hover:underline"
          >
            在画布中查看最近批次 →
          </router-link>

          <div v-if="selectedNode.type === 'index' && vectorStatus" class="rounded-xl border border-outline-variant bg-surface p-3 space-y-1">
            <p class="font-medium text-white">向量落库</p>
            <p class="text-[11px] text-on-surface-variant">配置 {{ vectorStatus.configuredModel }}</p>
            <p class="text-[11px] font-mono text-white">实际 {{ vectorStatus.storedModel || '无' }} · {{ vectorStatus.storedDimensions || '—' }} 维 · {{ vectorStatus.rows || 0 }} 条</p>
            <p v-if="vectorStatus.warning" class="text-error text-[11px]">{{ vectorStatus.warning }}</p>
          </div>

          <div v-if="selectedNode.config && selectedNode.config.promptTemplate !== undefined" class="space-y-1">
            <label class="font-medium text-white">Prompt 模板</label>
            <textarea
              v-model="selectedNode.config.promptTemplate"
              @input="onGraphEdit"
              rows="6"
              class="w-full bg-surface border border-outline-variant rounded-xl p-2.5 text-xs text-white outline-none focus:border-primary font-mono leading-relaxed resize-y"
            ></textarea>
          </div>

          <div v-if="selectedNode.config && selectedNode.config.model !== undefined" class="space-y-1">
            <label class="font-medium text-white">模型</label>
            <input
              v-model="selectedNode.config.model"
              @input="onGraphEdit"
              type="text"
              class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary font-mono"
            />
          </div>

          <div v-if="selectedNode.type === 'index'" class="space-y-2">
            <label class="font-medium text-white">Embedding 提供方</label>
            <select v-model="selectedNode.config.embeddingProvider" @change="onGraphEdit" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-2 text-xs text-white">
              <option value="litellm">LiteLLM /v1/embeddings</option>
              <option value="local_hash">本地哈希（非语义）</option>
            </select>
            <label class="font-medium text-white">Embedding 模型名</label>
            <input
              v-model="selectedNode.config.embeddingModel"
              @input="onGraphEdit"
              type="text"
              class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none font-mono"
            />
            <p class="text-[10px] text-on-surface-variant">调用失败时写入 local_semantic_hash_v1，不会冒充这个名字。</p>
          </div>

          <div v-if="selectedNode.config && selectedNode.config.adapterId !== undefined" class="space-y-1">
            <div class="flex items-center justify-between">
              <label class="font-medium text-white">生成适配器</label>
              <router-link to="/adapters" class="text-primary text-[10px] hover:underline">管理 →</router-link>
            </div>
            <select
              v-model="selectedNode.config.adapterId"
              @change="onGraphEdit"
              class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-2 text-xs text-on-surface outline-none focus:border-primary"
            >
              <option v-for="a in adaptersList" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select>
          </div>

          <div v-if="selectedNode.type === 'restage_dual'" class="space-y-3 pt-1 border-t border-outline-variant">
            <div>
              <p class="font-medium text-white mb-1.5">画幅</p>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="r in ratioChips"
                  :key="r"
                  type="button"
                  @click="toggleNodeRatio(r)"
                  class="px-2 py-1 rounded-lg border text-[10px]"
                  :class="(selectedNode.config.ratios || []).includes(r) ? 'bg-primary text-white border-primary' : 'bg-surface border-outline-variant text-on-surface-variant'"
                >{{ r }}</button>
              </div>
            </div>
            <div>
              <p class="font-medium text-white mb-1.5">主画幅 (mainRatio)</p>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="r in (selectedNode.config.ratios?.length ? selectedNode.config.ratios : ratioChips)"
                  :key="'main_' + r"
                  type="button"
                  @click="selectedNode.config.mainRatio = r; onGraphEdit()"
                  class="px-2 py-1 rounded-lg border text-[10px]"
                  :class="selectedNode.config.mainRatio === r ? 'bg-primary text-white border-primary' : 'bg-surface border-outline-variant text-on-surface-variant'"
                >{{ r }}</button>
              </div>
            </div>
            <div>
              <p class="font-medium text-white mb-1.5">分辨率</p>
              <div class="grid grid-cols-4 gap-1">
                <button
                  v-for="s in sizePresets"
                  :key="s.id"
                  type="button"
                  @click="selectedNode.config.sizePreset = s.id; onGraphEdit()"
                  class="px-1 py-1.5 rounded-lg border text-center"
                  :class="selectedNode.config.sizePreset === s.id ? 'bg-primary text-white border-primary' : 'bg-surface border-outline-variant text-on-surface-variant'"
                >
                  <span class="block text-[10px] font-semibold">{{ s.label }}</span>
                  <span class="block text-[8px] opacity-80">{{ pixelHint(s.id, selectedNode.config.mainRatio || (selectedNode.config.ratios || ['9:16'])[0]) }}</span>
                </button>
              </div>
            </div>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="selectedNode.config.skipIfAlreadyExact" @change="onGraphEdit" class="accent-primary" />
              <span class="text-[11px] text-white">原图已是目标比且无水印则跳过（默认关闭，一律走 Agnes）</span>
            </label>
          </div>

          <div v-if="selectedNode.type === 'restage_9_16'" class="space-y-3 pt-1 border-t border-outline-variant">
            <div>
              <p class="font-medium text-white mb-1.5">分辨率</p>
              <div class="grid grid-cols-4 gap-1">
                <button
                  v-for="s in sizePresets"
                  :key="s.id"
                  type="button"
                  @click="selectedNode.config.sizePreset = s.id; onGraphEdit()"
                  class="px-1 py-1.5 rounded-lg border text-center"
                  :class="selectedNode.config.sizePreset === s.id ? 'bg-primary text-white border-primary' : 'bg-surface border-outline-variant text-on-surface-variant'"
                >
                  <span class="block text-[10px] font-semibold">{{ s.label }}</span>
                </button>
              </div>
            </div>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="selectedNode.config.skipIfVertical" @change="onGraphEdit" class="accent-primary" />
              <span class="text-[11px] text-white">原图已是竖版（高>宽）则跳过重构</span>
            </label>
          </div>

          <div v-if="selectedNode.type === 'tag' || selectedNode.type === 'tag_furniture' || selectedNode.type === 'cluster'" class="space-y-2 pt-1 border-t border-outline-variant">
            <div class="space-y-1">
              <label class="font-medium text-white">pHash 近重复阈值（汉明 ≤）</label>
              <input
                v-model.number="selectedNode.config.phashThreshold"
                @input="onGraphEdit"
                type="number"
                min="0"
                max="32"
                class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none font-mono"
              />
              <p class="text-[10px] text-on-surface-variant">≤5 无条件合并。6–8 必须同空间。导出前缀 mmexport 不再当连拍。</p>
            </div>

            <div v-if="selectedNode.type === 'tag' || selectedNode.type === 'tag_furniture'" class="pt-1">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" v-model="selectedNode.config.skipCluster" @change="onGraphEdit" class="accent-primary" />
                <span class="text-[11px] text-white">跳过查重归组 (skipCluster)</span>
              </label>
              <p class="text-[10px] text-on-surface-variant mt-0.5">单张打标完成直接进入下游节点，不自动触发聚类查重。</p>
            </div>
          </div>
        </div>
        <div v-else class="text-center py-20 text-on-surface-variant text-xs space-y-2">
          <span class="material-symbols-outlined text-3xl text-outline">touch_app</span>
          <p>{{ inspectMode ? '点画布节点查看该张图的入出' : '点画布中的节点查看入出计数并改配置' }}</p>
        </div>
      </aside>
    </div>

    <!-- 视频流水线：在库视频展示与播放网格 (空图不拦截流转与播放) -->
    <div v-if="pipelineMode === 'video' && !inspectMode" class="bg-surface-low border border-outline-variant rounded-2xl p-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-lg">movie</span>
          <h2 class="text-sm font-bold text-white">在库视频管理与播放</h2>
          <span class="text-xs text-on-surface-variant font-mono">
            (共 {{ videoAssetsList.length }} 条 · 已就绪 {{ videoReadyCount }} 条)
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="triggerStartVideo"
            :disabled="videoStarting"
            class="px-3.5 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
          >
            <span v-if="videoStarting" class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
            <span v-else class="material-symbols-outlined text-sm">play_circle</span>
            <span>一键就绪入库与刷新</span>
          </button>
          <button
            @click="loadVideoAssets"
            :disabled="videoLoading"
            class="p-1.5 rounded-xl bg-surface border border-outline-variant hover:bg-surface-high text-on-surface text-xs"
            title="刷新视频列表"
          >
            <span class="material-symbols-outlined text-sm">refresh</span>
          </button>
        </div>
      </div>

      <div v-if="videoLoading" class="text-center py-10 text-on-surface-variant text-xs flex items-center justify-center gap-2">
        <span class="material-symbols-outlined text-base animate-spin text-primary">progress_activity</span>
        <span>正在加载库内视频...</span>
      </div>

      <div v-else-if="videoAssetsList.length" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="v in videoAssetsList"
          :key="v.fid"
          class="bg-surface border border-outline-variant rounded-xl p-3 space-y-2 flex flex-col justify-between hover:border-primary/50 transition"
        >
          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-1 text-xs">
              <span class="font-bold text-white truncate max-w-[200px]" :title="v.file_name || v.fid">{{ v.file_name || v.fid }}</span>
              <span class="px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0" :class="v.status === 'ready' ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-tertiary/20 text-tertiary border border-tertiary/30'">
                {{ v.status === 'ready' ? '就绪可用' : v.status }}
              </span>
            </div>

            <!-- 视频内嵌播放器 -->
            <div class="w-full aspect-video bg-black rounded-lg overflow-hidden border border-outline-variant/60 flex items-center justify-center relative">
              <video
                controls
                preload="metadata"
                :poster="api.videoPosterUrl(v.fid)"
                :src="api.imageUrl(v.fid, null, false, true)"
                class="w-full h-full object-contain"
              >
                您的浏览器不支持视频播放
              </video>
            </div>
          </div>

          <div class="text-[10px] text-outline font-mono flex items-center justify-between pt-1 border-t border-outline-variant/40">
            <span>FID: {{ v.fid.slice(0, 12) }}...</span>
            <span v-if="v.duration_s">{{ Math.round(v.duration_s) }} 秒</span>
            <span>{{ new Date(v.created_at || v.discovered_at).toLocaleDateString() }}</span>
          </div>
        </div>
      </div>

      <div v-else class="text-center py-12 text-on-surface-variant text-xs bg-surface rounded-xl border border-outline-variant">
        当前库内暂无视频素材
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted, nextTick, markRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, MarkerType, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { api } from '../api'
import { RATIO_CHIPS, SIZE_PRESETS, pixelHint } from '../restage-presets'
import WorkflowNode from '../components/WorkflowNode.vue'
import BatchSummary from '../components/BatchSummary.vue'
import AssetLineagePanel from '../components/AssetLineagePanel.vue'

const nodeTypes = { ml: markRaw(WorkflowNode) }
const route = useRoute()
const router = useRouter()
const { fitView, setCenter } = useVueFlow({ id: 'ml-flow' })

const pipelineMode = ref('image')
const videoAssetsList = ref([])
const videoLoading = ref(false)
const videoStarting = ref(false)
const videoReadyCount = computed(() => videoAssetsList.value.filter(v => v.status === 'ready').length)

const workflow = ref(null)
const graph = ref({ nodes: [], edges: [] })
const catalog = ref([])
const selectedNodeId = ref('')
const adaptersList = ref([])
const nodeStats = ref({})
const lastRunId = ref(null)
const isDirty = ref(false)
const saving = ref(false)
const actionBusy = ref(false)
const boardTool = ref('select')
const fullscreen = ref(false)
const vfNodes = ref([])
const vfEdges = ref([])
const vectorStatus = ref(null)

const inspectRun = ref(null)
const inspectAssets = ref([])
const inspectDetail = ref(null)
const inspectBatchSummary = ref(null)
const inspectPagination = ref({ page: 1, pageSize: 24, total: 0, totalPages: 1 })
const inspectPage = ref(1)
const lastInspectFid = ref('')
const ratioChips = RATIO_CHIPS
const sizePresets = SIZE_PRESETS

const inspectMode = computed(() => !!route.query.run)
const inspectFid = computed(() => route.query.fid || '')
const inspectAssetFid = computed(() => inspectDetail.value?.fid || inspectFid.value || '')

const selectedNode = computed(() => (graph.value.nodes || []).find(n => n.id === selectedNodeId.value) || null)
const inspectNode = computed(() => {
  const nodes = inspectDetail.value?.nodes || []
  return nodes.find(n => n.node_id === selectedNodeId.value) || nodes.find(n => n.node_type === selectedNode.value?.type) || null
})

function pretty(obj) {
  try { return JSON.stringify(obj || {}, null, 2) } catch { return String(obj) }
}

async function focusCanvasNode(id) {
  await nextTick()
  const n = vfNodes.value.find(x => x.id === id) || vfNodes.value[0]
  if (!n) {
    try { await fitView({ padding: 0.2, minZoom: 0.7, maxZoom: 1, duration: 200 }) } catch { /* canvas not ready */ }
    return
  }
  const x = (n.position?.x || 0) + 110
  const y = (n.position?.y || 0) + 66
  try {
    setCenter(x, y, { zoom: 0.95, duration: 220 })
  } catch {
    try { await fitView({ nodes: [{ id: n.id }], padding: 1.2, minZoom: 0.75, maxZoom: 1.1, duration: 200 }) } catch { /* ignore */ }
  }
}

function statsOf(id) {
  return nodeStats.value[id] || { total: 0, done: 0, skipped: 0, failed: 0, queued: 0 }
}

function statusOfNode(n) {
  if (inspectMode.value && inspectDetail.value?.nodes) {
    const hit = inspectDetail.value.nodes.find(x => x.node_id === n.id || x.node_type === n.type)
    if (hit) return { status: hit.status, label: hit.status }
    return { status: 'not_reached', label: '未到达' }
  }
  const st = statsOf(n.id)
  if (st.running) return { status: 'running', label: '运行' }
  if (inspectMode.value && st.queued) return { status: 'queued', label: '排队' }
  if (inspectMode.value && st.failed) return { status: 'failed', label: '失败' }
  if (inspectMode.value && st.done) return { status: 'done', label: '完成' }
  if (n.enabled === false) return { status: 'skip', label: '跳过' }
  return { status: 'idle', label: '' }
}

function rebuildVf() {
  const inspectMap = Object.fromEntries((inspectDetail.value?.nodes || []).map(n => [n.node_id, n]))
  vfNodes.value = (graph.value.nodes || []).map(n => {
    const st = statusOfNode(n)
    return {
      id: n.id,
      type: 'ml',
      position: n.position || { x: 48, y: 90 },
      width: 220,
      height: 132,
      data: {
        id: n.id,
        name: n.name,
        nodeType: n.type,
        enabled: n.enabled,
        model: n.config?.model,
        ratioLine: n.type === 'restage_dual'
          ? `${(n.config?.ratios || ['9:16', '3:4']).join(' · ')} · ${n.config?.sizePreset || '1080p'}`
          : '',
        stats: statsOf(n.id),
        status: st.status,
        statusLabel: st.label,
        selected: selectedNodeId.value === n.id
      }
    }
  })
  vfEdges.value = (graph.value.edges || []).map(e => {
    const tid = e.target || e.to
    const sid = e.source || e.from
    const st = statsOf(tid)
    const running = !!(inspectMap[tid] && inspectMap[tid].status === 'running') || !!st.running
    return {
      id: e.id || `${sid}-${tid}`,
      source: sid,
      target: tid,
      animated: running,
      label: `${st.done || 0}/${st.total || 0}`,
      style: { stroke: '#4d8eff' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#4d8eff' }
    }
  })
}

function miniColor() {
  return '#4d8eff'
}

function markDirty() { isDirty.value = true }
function onGraphEdit() {
  markDirty()
  rebuildVf()
}

function onNodeClick({ node }) {
  selectedNodeId.value = node.id
  rebuildVf()
}

function onNodeDragStop({ node }) {
  const n = graph.value.nodes.find(x => x.id === node.id)
  if (!n) return
  n.position = { x: node.position.x, y: node.position.y }
  if (!inspectMode.value) markDirty()
}

function onConnect(params) {
  if (inspectMode.value) return
  graph.value.edges = [...(graph.value.edges || []), {
    id: `e_${params.source}_${params.target}_${Date.now().toString(36).slice(-3)}`,
    source: params.source,
    target: params.target
  }]
  onGraphEdit()
}

function addNode(type) {
  const spec = catalog.value.find(c => c.type === type)
  if (!spec) return
  const id = `${type}_${Date.now().toString(36).slice(-4)}`
  const nodes = graph.value.nodes || []
  const selected = selectedNode.value
  const x = selected ? (selected.position?.x || 0) + 260 : 40 + nodes.length * 40
  const y = selected ? (selected.position?.y || 80) : 80
  const node = {
    id,
    type,
    name: spec.name,
    enabled: type !== 'backup',
    config: JSON.parse(JSON.stringify(spec.defaultConfig || {})),
    position: { x, y }
  }
  graph.value.nodes = [...nodes, node]
  if (selected) {
    graph.value.edges = [...(graph.value.edges || []), { id: `e_${selected.id}_${id}`, source: selected.id, target: id }]
  }
  selectedNodeId.value = id
  onGraphEdit()
}

function removeSelected() {
  const id = selectedNodeId.value
  if (!id || (graph.value.nodes || []).length <= 1) return
  graph.value.nodes = graph.value.nodes.filter(n => n.id !== id)
  graph.value.edges = (graph.value.edges || []).filter(e => e.source !== id && e.target !== id && e.from !== id && e.to !== id)
  selectedNodeId.value = graph.value.nodes[0]?.id || ''
  onGraphEdit()
}

function toggleNodeRatio(r) {
  const n = selectedNode.value
  if (!n) return
  n.config.ratios = n.config.ratios || ['9:16', '3:4']
  const i = n.config.ratios.indexOf(r)
  if (i >= 0) {
    if (n.config.ratios.length === 1) return
    n.config.ratios = n.config.ratios.filter(x => x !== r)
  } else {
    n.config.ratios = [...n.config.ratios, r]
  }
  if (!n.config.ratios.includes(n.config.mainRatio)) n.config.mainRatio = n.config.ratios[0]
  onGraphEdit()
}

function selectInspectFid(fid) {
  router.replace({ path: '/workflow', query: { run: route.query.run, fid } })
}

async function changeInspectPage(delta) {
  const newPage = inspectPagination.value.page + delta
  if (newPage < 1 || newPage > inspectPagination.value.totalPages) return
  inspectPage.value = newPage
  await loadInspect(newPage)
}

async function loadInspect(page = inspectPage.value) {
  const runId = route.query.run
  if (!runId) {
    inspectRun.value = null
    inspectDetail.value = null
    inspectAssets.value = []
    inspectBatchSummary.value = null
    return
  }
  try {
    const g = await api.runGraph(runId, route.query.fid || null, page, 24)
    inspectRun.value = g.run
    inspectAssets.value = g.assets || []
    inspectDetail.value = g.inspect || null
    inspectBatchSummary.value = g.batchSummary || null
    inspectPagination.value = g.pagination || { page: 1, pageSize: 24, total: (g.assets || []).length, totalPages: 1 }
    if (g.graph?.nodes) {
      graph.value = g.graph
      nodeStats.value = g.nodeStats || {}
    }
    if (!route.query.fid && (g.assets || [])[0]?.fid) {
      router.replace({ path: '/workflow', query: { run: runId, fid: g.assets[0].fid } })
      return
    }
    const fid = String(route.query.fid || '')
    const ran = inspectDetail.value?.nodes || []
    if (fid !== lastInspectFid.value || !selectedNodeId.value) {
      lastInspectFid.value = fid
      const prefer = ran.find(n => n.node_type === 'restage_dual' || n.node_type === 'restage_9_16')
        || ran.find(n => n.status === 'running' || n.status === 'done')
        || ran[0]
      selectedNodeId.value = prefer?.node_id || graph.value.nodes?.[0]?.id || ''
    }
    rebuildVf()
    await nextTick()
    await focusCanvasNode(selectedNodeId.value)
  } catch (e) {
    console.error('加载巡检画布失败:', e)
  }
}

async function loadData() {
  try {
    const wf = await api.defaultWorkflow()
    workflow.value = wf
    const g = wf.graph || { nodes: [], edges: [] }
    ;(g.nodes || []).forEach((n, i) => {
      if (!n.position) n.position = { x: 48 + i * 240, y: 90 }
      n.config = n.config || {}
      if (n.type === 'index') {
        if (!n.config.embeddingProvider) n.config.embeddingProvider = 'litellm'
        if (!n.config.embeddingModel) n.config.embeddingModel = 'text-embedding-3-small'
      }
    })
    graph.value = g
    nodeStats.value = wf.nodeStats || {}
    lastRunId.value = wf.lastRunId || null
    catalog.value = wf.catalog || await api.workflowCatalog().catch(() => [])
    vectorStatus.value = wf.vectorStatus || null
    selectedNodeId.value = g.nodes?.[0]?.id || ''
    const adps = await api.adapters()
    adaptersList.value = adps.filter(a => a.enabled)
    rebuildVf()
    await focusCanvasNode(selectedNodeId.value)
  } catch (e) {
    console.error('加载工作流数据失败:', e)
  }
}

async function loadVideoWorkflow() {
  try {
    const wf = await api.workflow('video')
    workflow.value = wf
    const g = wf.graph || { nodes: [], edges: [] }
    ;(g.nodes || []).forEach((n, i) => {
      if (!n.position) n.position = { x: 48 + i * 240, y: 90 }
      n.config = n.config || {}
    })
    graph.value = g
    nodeStats.value = {}
    selectedNodeId.value = g.nodes?.[0]?.id || ''
    catalog.value = await api.workflowCatalog().catch(() => [])
    rebuildVf()
    await focusCanvasNode(selectedNodeId.value)
  } catch (e) {
    console.error('加载视频工作流失败:', e)
  }
}

async function loadVideoAssets() {
  videoLoading.value = true
  try {
    const res = await api.videoAssets()
    videoAssetsList.value = res || []
  } catch (e) {
    console.error('加载视频资产失败:', e)
  } finally {
    videoLoading.value = false
  }
}

async function switchPipeline(type) {
  if (pipelineMode.value === type) return
  if (isDirty.value && !confirm('当前工作流修改尚未保存，切换将丢失，确定继续吗？')) return
  pipelineMode.value = type
  isDirty.value = false
  if (type === 'video') {
    await Promise.all([loadVideoWorkflow(), loadVideoAssets()])
  } else {
    await loadData()
  }
}

async function triggerStartVideo() {
  videoStarting.value = true
  try {
    const res = await api.startVideoWorkflow()
    alert(`视频入库操作完成！\n• 本次就绪视频: ${res.updated_count || 0} 条\n• 库内总就绪视频: ${res.total_ready || 0} 条`)
    await loadVideoAssets()
  } catch (e) {
    alert('视频入库启动失败: ' + e.message)
  } finally {
    videoStarting.value = false
  }
}

async function saveNewVersion() {
  saving.value = true
  try {
    if (pipelineMode.value === 'video') {
      const res = await api.saveWorkflowVideo(graph.value)
      alert(`成功保存视频产线新版本 v${res.version}`)
      isDirty.value = false
      await loadVideoWorkflow()
    } else {
      const res = await api.saveWorkflow(graph.value, workflow.value?.id || 'default')
      alert(`成功保存为新版本 v${res.version}`)
      isDirty.value = false
      await loadData()
    }
  } catch (e) {
    alert('保存失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

async function triggerRun() {
  actionBusy.value = true
  try {
    const r = await api.triggerRun()
    alert(`已触发批次 ${r.runId}，入队 ${r.count} 张`)
  } catch (e) {
    alert('触发批次失败: ' + e.message)
  } finally {
    actionBusy.value = false
  }
}

let pollTimer = null
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

watch(() => [route.query.run, route.query.fid], async () => {
  stopPoll()
  if (route.query.run) {
    boardTool.value = 'pan'
    inspectPage.value = 1
    await loadInspect(1)
    const live = inspectRun.value && ['queued', 'running'].includes(inspectRun.value.status)
    if (live) pollTimer = setInterval(() => loadInspect(inspectPage.value), 2000)
  } else {
    boardTool.value = 'select'
    lastInspectFid.value = ''
    if (pipelineMode.value === 'video') {
      await Promise.all([loadVideoWorkflow(), loadVideoAssets()])
    } else {
      await loadData()
    }
  }
}, { immediate: true })

onUnmounted(stopPoll)
</script>
