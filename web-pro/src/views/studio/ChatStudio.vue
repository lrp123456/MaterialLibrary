<template>
  <div class="chat-root flex-1 min-h-0 flex overflow-hidden bg-studio-950 font-sans text-slate-100 text-sm">
    <!-- ========================================================================= -->
    <!-- 1. 左侧抽屉栏：豆包/千问双模式（会话历史 / 我的创作库） -->
    <!-- ========================================================================= -->
    <!-- 1. 左侧抽屉栏：会话历史与我的创作库 (默认展开，宽 300px，可收起) -->
    <aside
      :class="[
        'bg-studio-900 border-r border-studio-700 flex flex-col justify-between shrink-0 select-none transition-all duration-200',
        leftCollapsed ? 'w-12 items-center' : 'w-[300px]'
      ]"
    >
      <div v-if="!leftCollapsed" class="flex flex-col flex-1 overflow-hidden">
        <!-- 侧栏顶部 Tab：会话历史 vs 我的创作库 -->
        <div class="p-2.5 border-b border-studio-700 flex items-center justify-between bg-studio-950/60 gap-1.5">
          <div class="flex items-center space-x-1.5 flex-1 min-w-0">
            <span class="px-2 py-1.5 rounded-lg bg-studio-800 text-white text-xs font-bold border border-studio-700 flex items-center space-x-1 shrink-0 shadow-xs">
              <StudioIcon name="history" :size="13" class="text-studio-accent" />
              <span>对话</span>
            </span>

            <button
              type="button"
              @click="openCreationLibraryModal"
              class="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-studio-accent/20 hover:bg-studio-accent/30 text-studio-accent hover:text-white border border-studio-accent/40 text-xs font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer shadow-xs truncate group"
              title="点击打开全屏创作库"
            >
              <StudioIcon name="wand" :size="13" hoverMorph />
              <span class="truncate">创作库</span>
              <span class="text-[9px] opacity-75 font-mono">⛶</span>
            </button>
          </div>

          <div class="flex items-center space-x-1 shrink-0">
            <button
              @click="createNewSession"
              class="p-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 text-xs border border-studio-700 transition-all cursor-pointer"
              title="新建对话"
            >
              <StudioIcon name="plus" :size="13" />
            </button>
            <button
              @click="leftCollapsed = true"
              class="p-1.5 rounded-lg hover:bg-studio-800 text-slate-400 hover:text-white transition-all cursor-pointer"
              title="收起对话历史"
            >
              <StudioIcon name="chevronLeft" :size="13" />
            </button>
          </div>
        </div>

        <!-- 会话模态分类 Segment 过滤 -->
        <div class="px-2.5 pt-2 pb-1.5 border-b border-studio-800/80 bg-studio-950/60 flex items-center gap-1">
          <button
            v-for="opt in [
              { id: 'all', label: '全部' },
              { id: 'chat', label: '💬 对话' },
              { id: 'image', label: '🖼️ 生图' },
              { id: 'video', label: '🎬 生视频' }
            ]"
            :key="opt.id"
            type="button"
            @click="sessionModalityFilter = opt.id"
            class="flex-1 py-1 rounded-lg text-[11px] font-bold transition-all text-center cursor-pointer truncate"
            :class="sessionModalityFilter === opt.id ? 'bg-studio-800 text-white border border-studio-700 shadow-xs' : 'text-slate-400 hover:text-slate-200'"
          >
            {{ opt.label }}
          </button>
        </div>

        <!-- 历史会话列表 (当前项左边 2px #6366F1) -->
        <div class="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin">
          <div v-if="filteredSessions.length === 0" class="text-center py-12 text-xs text-slate-500">
            暂无匹配对话
          </div>
          <div
            v-for="s in filteredSessions"
            :key="s.id"
            @click="selectSession(s)"
            :class="[
              'group px-3 py-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between text-xs',
              currentSessionId === s.id
                ? 'bg-studio-850 border-studio-700 border-l-2 !border-l-studio-accent text-white font-bold shadow-md'
                : 'bg-studio-950/50 border-studio-800 hover:bg-studio-850 hover:border-studio-700 text-slate-300'
            ]"
          >
            <div class="flex items-center space-x-2 truncate flex-1 min-w-0 mr-1.5">
              <span
                class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0"
                :class="getSessionModalityBadge(getSessionModality(s)).class"
                :title="getSessionModalityBadge(getSessionModality(s)).label"
              >
                {{ getSessionModalityBadge(getSessionModality(s)).icon }}
              </span>
              <span class="truncate font-medium">{{ s.title }}</span>
            </div>
            <div class="flex items-center space-x-1 shrink-0">
              <span
                v-if="s.product_count > 0"
                class="px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold bg-studio-800 text-studio-cyan border border-studio-700"
                title="产物数量"
              >
                {{ s.product_count }}件
              </span>
              <button
                @click.stop="deleteSession(s.id)"
                class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1 transition-opacity cursor-pointer"
                title="删除会话"
              >
                <StudioIcon name="close" :size="12" />
              </button>
            </div>
          </div>
        </div>

        <!-- 底部固定栏：新对话与创作库直达入口 -->
        <div class="p-3 bg-studio-950/80 border-t border-studio-700 flex flex-col gap-2">
          <button
            type="button"
            @click="createNewSession"
            class="w-full py-2 px-3 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <StudioIcon name="plus" :size="14" />
            <span>新对话</span>
          </button>
          <div class="flex items-center justify-between text-xs text-slate-400 pt-1">
            <button
              type="button"
              @click="openCreationLibraryModal"
              class="flex items-center gap-1.5 text-slate-300 hover:text-studio-accent cursor-pointer transition-colors font-medium text-[11px]"
              title="点击直接打开全屏创作库"
            >
              <StudioIcon name="wand" :size="13" class="text-studio-accent" />
              <span># 创作库 · @ 引用素材</span>
            </button>
            <span class="text-[10px] font-mono text-emerald-400 font-bold">DAM 已连接</span>
          </div>
        </div>
      </div>

      <!-- 收起状态下的窄栏 -->
      <div v-else class="flex flex-col items-center py-3 gap-3">
        <button
          @click="leftCollapsed = false"
          class="p-2 rounded-lg hover:bg-studio-800 text-slate-400 hover:text-white transition-all cursor-pointer"
          title="展开对话历史"
        >
          <StudioIcon name="chevronRight" :size="16" />
        </button>
        <button
          @click="createNewSession"
          class="p-2 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 border border-studio-700 cursor-pointer"
          title="新建对话"
        >
          <StudioIcon name="plus" :size="14" />
        </button>
        <button
          @click="openCreationLibraryModal"
          class="p-2 rounded-lg bg-studio-accent/20 hover:bg-studio-accent/30 text-studio-accent hover:text-white border border-studio-accent/40 cursor-pointer transition-colors"
          title="我的创作库"
        >
          <StudioIcon name="wand" :size="14" hoverMorph />
        </button>
      </div>
    </aside>

    <!-- ========================================================================= -->
    <!-- 2. 中央核心工作区：空状态【大号参考图主工作台】 VS 消息流 -->
    <!-- ========================================================================= -->
    <main class="chat-main flex-1 flex flex-col min-w-0 overflow-hidden bg-studio-950 relative">
      <!-- 2.1 主体展示区：历史消息流与（展开状态）看图区 -->
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <!-- 历史消息流区 (看图区展开时在左侧 360px；收缩时占满 flex-1) -->
        <div
          class="relative flex min-h-0 flex-col transition-all duration-200"
          :class="viewerCollapsed ? 'flex-1 min-w-0' : 'w-[360px] shrink-0 border-r border-studio-800'"
        >
      <div
        ref="messageScroller"
        class="chat-scroll flex-1 overflow-y-auto px-4 py-2 space-y-3 scrollbar-thin"
        @scroll.passive="onChatScroll"
      >
        <div v-if="messages.length > 0" class="text-center py-1 text-[11px] text-slate-500 font-medium">
          ↑ 向上滚动查看更早记录
        </div>
        <div v-if="messages.length === 0" class="h-full flex items-center justify-center text-xs text-slate-500">
          暂无更早记录，请在下方看图区选定参考图开始创作
        </div>
        <!-- 真实消息流列表 -->
        <div v-for="(msg, i) in messages" :key="i" class="flex flex-col space-y-2">
          <!-- 用户消息 (图文混排呈现) -->
          <div v-if="msg.role === 'user'" class="flex justify-end">
            <div class="max-w-2xl rounded-2xl rounded-tr-xs bg-studio-accent px-4 py-3 text-white text-xs leading-relaxed shadow-lg select-text group relative">
              <div class="space-y-2">
                <!-- 顶栏：审查当时请求出站报文快照 -->
                <div class="flex items-center justify-between text-[11px] pb-1 border-b border-white/20 opacity-80 group-hover:opacity-100 transition-opacity">
                  <span class="text-white/80 font-mono text-[10px]">用户提示词</span>
                  <span class="inline-flex items-center gap-1">
                    <button
                      type="button"
                      @click="openRequestSnapshot(msg)"
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/25 hover:bg-black/40 text-white/90 hover:text-white border border-white/25 text-[10px] font-mono cursor-pointer transition-colors"
                      title="审查当时提交的请求报文与方言快照"
                    >
                      <StudioIcon name="sliders" :size="10" />
                      <span>请求</span>
                    </button>
                    <button
                      type="button"
                      @click="editRound(msg)"
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/25 hover:bg-black/40 text-white/90 hover:text-white border border-white/25 text-[10px] font-mono cursor-pointer transition-colors"
                      title="把这一轮的提示词、参考图与参数恢复到输入区"
                    >
                      <StudioIcon name="edit" :size="10" />
                      <span>编辑</span>
                    </button>
                  </span>
                </div>
                <div v-if="msg.referencedCard" class="px-2 py-1 rounded bg-black/25 text-studio-cyan text-[11px] border border-studio-cyan/40 flex items-center space-x-1.5">
                  <StudioIcon name="wand" :size="12" />
                  <span>已调用创作库模板: {{ msg.referencedCard }}</span>
                </div>

                <!-- 图文混排渲染区 -->
                <div class="font-sans leading-relaxed text-sm flex flex-wrap items-center gap-1">
                  <template v-for="(segment, sIdx) in parseRichSegments(msg.content, msg)" :key="sIdx">
                    <span v-if="segment.type === 'text'" class="whitespace-pre-wrap">{{ segment.text }}</span>
                    <button
                      v-else-if="segment.type === 'chip'"
                      type="button"
                      class="inline-flex items-center px-2 py-0.5 rounded-full bg-studio-cyan/20 border border-studio-cyan/40 text-studio-cyan font-bold font-mono text-xs shadow-xs align-middle cursor-pointer hover:bg-studio-cyan/30 transition-colors"
                      :class="segment.ref && segment.ref.url ? 'cursor-zoom-in' : 'cursor-default'"
                      @click="segment.ref && segment.ref.url && openMediaPreview(segment.ref)"
                      :title="segment.name || segment.tag"
                    >
                      <span>{{ segment.tag }}</span>
                    </button>
                  </template>
                </div>
                <div v-if="messageAttachments(msg).length" class="flex flex-wrap gap-2 pt-1">
                  <div
                    v-for="(item, aIdx) in messageAttachments(msg)"
                    :key="(item.url || item.name) + aIdx"
                    class="relative group rounded-lg border border-white/40 bg-black/20 overflow-hidden"
                  >
                    <button
                      type="button"
                      class="block cursor-zoom-in"
                      @click="openMediaPreview(item)"
                    >
                      <img v-if="mediaKind(item) === 'image'" :src="authedMediaUrl(item.url)" :alt="item.name || '图片'" class="h-16 w-16 object-cover" />
                      <video v-else-if="mediaKind(item) === 'video'" :src="authedMediaUrl(item.url)" class="h-16 w-24 object-cover" muted></video>
                      <span v-else class="flex h-16 w-28 items-center px-2 text-left text-[11px] font-bold text-white">音频 {{ item.name || '附件' }}</span>
                    </button>
                    <button
                      v-if="mediaKind(item) === 'image'"
                      type="button"
                      @click.stop="addMediaToViewer(item)"
                      class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 hover:bg-studio-accent text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-md"
                      title="放到看图区"
                    >
                      +看图区
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- AI 生成产物消息 -->
          <div v-else class="flex justify-start">
            <div class="max-w-3xl w-full rounded-2xl rounded-tl-xs bg-studio-900 border border-studio-750 p-4 text-slate-200 text-xs shadow-md space-y-3 select-text">
              <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono pb-2 border-b border-studio-800">
                <span class="flex items-center gap-1.5 text-studio-accent font-medium">
                  <StudioIcon :name="msg.modality === 'video' ? 'video' : (msg.modality === 'music' ? 'music' : 'sparkles')" :size="14" />
                  {{ msg.model || 'Seedream 5.0 Flash' }}
                </span>
                <span class="flex items-center gap-2">
                  <span v-if="!msg.isError && !msg.isGenerating">
                    {{ msg.modality === 'video' ? `时长: ${msg.duration || '5s'} · 分辨率: ${displayResolution(msg.resolution, msg) || '—'}` : (msg.modality === 'music' ? `时长: ${msg.duration || '30s'} · 320kbps` : [msg.duration ? `耗时: ${msg.duration}` : '', displayResolution(msg.resolution, msg) ? `分辨率: ${displayResolution(msg.resolution, msg)}` : ''].filter(Boolean).join(' · ')) }}
                  </span>
                  <span v-else-if="msg.isGenerating" class="flex items-center gap-1.5 text-studio-cyan font-bold font-mono">
                    <span class="inline-block w-2 h-2 rounded-full bg-studio-cyan animate-pulse"></span>
                    <span>渲染中 · {{ formatTimer(getElapsedSec(msg)) }}</span>
                  </span>
                  <button
                    v-if="!msg.isError && !msg.isGenerating && msg.modality === 'video' && (msg.videoUrl || msg.modelVideoUrl)"
                    type="button"
                    class="msg-copy-all"
                    title="在大预览里看模型原片和超分后"
                    @click="openVideoCompare(msg)"
                  >
                    查看对比
                  </button>
                </span>
              </div>

              <!-- 情况 0：生成中占位渲染卡片 (微光骨架屏 + 阶段文字 + 秒表) -->
              <div
                v-if="msg.isGenerating && (msg.modality === 'image' || msg.modality === 'video')"
                class="w-full flex justify-center py-1"
              >
                <div
                  :style="getPlaceholderContainerStyle(msg.ratio)"
                  class="relative w-full overflow-hidden rounded-xl border border-studio-700/80 bg-studio-950 flex flex-col items-center justify-center select-none shadow-2xl transition-all"
                >
                  <!-- 暗色 Blueprint 辅助网格纹理背景 -->
                  <div class="absolute inset-0 bg-[radial-gradient(#334155_1.2px,transparent_1.2px)] [background-size:20px_20px] opacity-40"></div>
                  <div class="absolute inset-0 bg-[linear-gradient(to_right,#1e293b22_1px,transparent_1px),linear-gradient(to_bottom,#1e293b22_1px,transparent_1px)] bg-[size:40px_40px]"></div>

                  <!-- 视频首帧暗底微透（若有参考图） -->
                  <img
                    v-if="msg.refs?.[0]?.url"
                    :src="authedMediaUrl(msg.refs[0].url)"
                    class="absolute inset-0 w-full h-full object-cover opacity-15 filter blur-xs"
                    alt=""
                  />

                  <!-- 流光扫描动画 (Shimmer Scanning Wave) -->
                  <div class="absolute inset-0 pointer-events-none overflow-hidden">
                    <div class="shimmer-wave absolute inset-0"></div>
                  </div>

                  <!-- 四角测绘准星角标 -->
                  <div class="absolute top-2.5 left-2.5 w-3 h-3 border-t-2 border-l-2 border-studio-cyan/60 pointer-events-none"></div>
                  <div class="absolute top-2.5 right-2.5 w-3 h-3 border-t-2 border-r-2 border-studio-cyan/60 pointer-events-none"></div>
                  <div class="absolute bottom-2.5 left-2.5 w-3 h-3 border-b-2 border-l-2 border-studio-cyan/60 pointer-events-none"></div>
                  <div class="absolute bottom-2.5 right-2.5 w-3 h-3 border-b-2 border-r-2 border-studio-cyan/60 pointer-events-none"></div>

                  <!-- 顶部状态指示条 -->
                  <div class="absolute top-3 inset-x-4 flex items-center justify-between text-[11px] font-mono z-10">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-studio-900/90 border border-studio-700 text-studio-cyan shadow-sm backdrop-blur">
                      <span class="w-1.5 h-1.5 rounded-full bg-studio-cyan animate-pulse"></span>
                      <span>AI {{ msg.modality === 'video' ? '空间动态渲染中' : '空间画质扩散中' }}</span>
                    </span>
                    <div class="flex items-center gap-2">
                      <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-studio-900/90 border border-studio-700 text-slate-300 shadow-sm backdrop-blur">
                        <StudioIcon name="history" :size="11" class="text-studio-accent" />
                        <span>已耗时 {{ formatTimer(getElapsedSec(msg)) }}</span>
                      </span>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-950/80 border border-red-800/60 text-red-300 hover:bg-red-900 hover:text-white transition-all text-[11px] shadow-sm backdrop-blur cursor-pointer"
                        title="取消当前生成任务"
                        @click.stop="handleCancelGeneration(msg)"
                      >
                        <StudioIcon name="x" :size="11" />
                        <span>取消</span>
                      </button>
                    </div>
                  </div>

                  <!-- 中央核心动效与阶段推进提示 -->
                  <div class="relative z-10 flex flex-col items-center justify-center p-4 text-center max-w-sm space-y-3">
                    <div class="relative w-16 h-16 flex items-center justify-center">
                      <div class="absolute inset-0 rounded-full border border-studio-accent/30 animate-ping opacity-30"></div>
                      <div class="absolute inset-1 rounded-full border-2 border-dashed border-studio-cyan/40 animate-spin" style="animation-duration: 8s;"></div>
                      <div class="w-11 h-11 rounded-full bg-studio-900/90 border border-studio-accent/60 flex items-center justify-center shadow-lg shadow-studio-accent/20">
                        <StudioIcon
                          :name="msg.modality === 'video' ? 'video' : 'sparkles'"
                          :size="20"
                          class="text-studio-cyan animate-pulse"
                        />
                      </div>
                    </div>

                    <div class="space-y-1">
                      <div class="text-xs font-bold text-white tracking-wide flex items-center justify-center gap-1.5">
                        <span>{{ getGeneratingStageText(msg) }}</span>
                      </div>
                      <div class="text-[11px] text-slate-400 font-mono">
                        画幅 {{ msg.ratio || '16:9' }}<template v-if="msg.resolution"> · {{ msg.resolution }}</template> · {{ msg.model || 'Seedream 5.0' }}
                      </div>
                    </div>

                    <div class="w-44 h-1.5 rounded-full bg-studio-900/80 border border-studio-750 overflow-hidden relative">
                      <div
                        class="h-full bg-gradient-to-r from-studio-accent to-studio-cyan rounded-full transition-all duration-700 ease-out"
                        :style="{ width: `${getGeneratingProgressPercent(msg)}%` }"
                      ></div>
                    </div>
                  </div>

                  <!-- 底部微提示 -->
                  <div class="absolute bottom-2.5 text-[10px] text-slate-500 font-mono pointer-events-none">
                    GPU 集群渲染解算中 · 完成后自动呈现
                  </div>
                </div>
              </div>

              <!-- 情况 A：生图产物。按钮在图下方，避免被大图裁掉。 -->
              <div v-else-if="msg.imageUrl && msg.modality === 'image'" class="space-y-2">
                <div class="relative rounded-xl overflow-hidden border border-studio-750 bg-studio-950">
                  <img :src="resultImageSrc(msg)" @error="onResultImgError(msg)" @load="onResultImgLoad(msg)" @click="openMediaPreview(resultImageSrc(msg), 'image')" class="w-full max-h-[460px] object-contain cursor-zoom-in hover:brightness-105 transition-all" title="点击查看高清大图" />
                  <div v-if="msg.imgFailed" class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-studio-950/88 px-4 text-center">
                    <p v-if="msg.imgAuth" class="text-xs text-amber-300 leading-relaxed">登录已过期，服务器不认当前会话。重新登录后这张图会自动出来。</p>
                    <p v-else class="text-xs text-amber-300 leading-relaxed">这张产物取不到了{{ msg.imgErr ? `：${msg.imgErr}` : '（临时文件被清理，或服务器不可达）' }}。</p>
                    <button v-if="msg.imgAuth" type="button" class="text-xs font-bold text-studio-cyan underline cursor-pointer" @click="reportUnauthorized()">重新登录</button>
                    <button v-else type="button" class="text-xs font-bold text-studio-cyan underline cursor-pointer" @click="retryResultImage(msg)">重新加载</button>
                  </div>
                </div>
                <ResultActions
                  :created="!!msg.creationSaved"
                  :creating="!!msg.savingCreation"
                  :saved="!!msg.librarySaved"
                  :saving="!!msg.savingToLibrary"
                  :reason="resultBarReason(msg)"
                  @create="saveResultToCreation(msg)"
                  @library="saveResultToLibrary(msg)"
                  @retry="openRetry(msg)"
                  @reedit="reeditResult(msg)"
                />
              </div>
              <!-- Seedream 5.0 图层分解 (layer_decomposition) / Lite 组图连拍 交互画布图层栈 -->
              <div
                v-if="msg.layerStack && Array.isArray(msg.layerStack.layers) && msg.layerStack.layers.length > 1"
                class="rounded-xl bg-studio-950 border border-studio-750 p-3 space-y-2.5"
              >
                <div class="flex items-center justify-between text-xs">
                  <span class="font-bold text-studio-cyan flex items-center gap-1.5">
                    <span>🗂️ {{ msg.layerStack.kind === 'layer_stack' ? 'Seedream 5.0 透明图层拆分栈' : '多图连拍画廊' }}</span>
                    <span class="px-1.5 py-0.5 rounded bg-studio-850 text-[10px] font-mono text-white border border-studio-700">
                      共 {{ msg.layerStack.layers.length }} 层
                    </span>
                  </span>
                  <span class="text-[11px] text-slate-400">点击单层可切换大图预览，或一键挂载为 @图1 进行二次精修</span>
                </div>
                <div class="grid grid-cols-4 gap-2.5">
                  <div
                    v-for="layer in msg.layerStack.layers"
                    :key="layer.index"
                    class="group relative rounded-lg overflow-hidden border bg-studio-900 cursor-pointer transition-all"
                    :class="msg.imageUrl === layer.url ? 'border-studio-accent ring-1 ring-studio-accent' : 'border-studio-750 hover:border-studio-cyan'"
                    @click="msg.imageUrl = layer.url"
                  >
                    <div class="h-24 w-full bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:8px_8px] flex items-center justify-center">
                      <img :src="authedMediaUrl(layer.url)" class="max-h-24 w-full object-contain" />
                    </div>
                    <div class="p-1.5 bg-studio-950/90 flex items-center justify-between text-[10px]">
                      <span class="font-bold text-slate-200 truncate">{{ layer.label }}</span>
                      <button
                        type="button"
                        class="px-1.5 py-0.5 rounded bg-studio-accent/20 hover:bg-studio-accent text-studio-cyan hover:text-white font-bold cursor-pointer shrink-0"
                        @click.stop="addMediaToViewer({ url: layer.url, name: layer.label })"
                        title="放到看图区"
                      >
                        +看图区
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <!-- 情况 B：视频产物展示 (完整高保真 HTML5 视频播放器) -->
              <div v-else-if="!msg.isError && (msg.videoUrl || msg.srStatus || msg.modality === 'video')" class="space-y-2">
                <div
                  v-if="msg.srStatus === 'running'"
                  class="rounded-xl border border-studio-750 bg-studio-950 px-3 py-10 text-center text-xs leading-relaxed text-slate-300"
                >
                  超分中，完成后播放
                </div>
                <div
                  v-else-if="!msg.videoUrl"
                  class="rounded-xl border border-studio-750 bg-studio-950 px-3 py-6 text-center text-xs leading-relaxed text-slate-400"
                >
                  这一轮没有可播放的视频产物（生成失败、超时或临时文件已清理），请查看下方原因后重试。
                </div>
                <div v-else class="rounded-xl overflow-hidden border border-studio-750 bg-black relative group shadow-inner">
                  <video
                    :ref="el => registerVideoEl(i, el)"
                    :src="authedMediaUrl(msg.videoUrl)"
                    class="w-full max-h-[400px] object-contain bg-black"
                    controls
                    playsinline
                    preload="metadata"
                  ></video>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span v-if="msg.model" class="font-bold text-slate-200">{{ msg.model }}</span>
                  <span v-if="displayResolution(msg.resolution, msg)" class="font-mono">{{ displayResolution(msg.resolution, msg) }}</span>
                </div>
                <ResultActions
                  :created="!!msg.creationSaved"
                  :creating="!!msg.savingCreation"
                  :saved="!!msg.librarySaved"
                  :saving="!!msg.savingToLibrary"
                  :save-disabled="msg.srStatus === 'running'"
                  :reason="resultBarReason(msg)"
                  @create="saveResultToCreation(msg)"
                  @library="saveResultToLibrary(msg)"
                  @retry="openRetry(msg)"
                  @reedit="reeditResult(msg)"
                />
              </div>

              <!-- 情况 C：音乐产物展示 -->
              <div v-else-if="!msg.isError && (msg.audioUrl || msg.modality === 'music')" class="space-y-3">
                <div class="p-4 rounded-xl bg-studio-950 border border-studio-750 space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-white flex items-center gap-2">
                      <span>🎵</span>
                      <span>{{ msg.audioTitle || '空间环境原声 · Nordic Ambient' }}</span>
                    </span>
                    <span class="text-emerald-400 font-mono text-xs font-bold">{{ msg.duration || '30s' }}</span>
                  </div>
                  <audio :src="authedMediaUrl(msg.audioUrl)" controls class="w-full h-10"></audio>
                </div>
                <ResultActions
                  :created="!!msg.creationSaved"
                  :creating="!!msg.savingCreation"
                  :saved="!!msg.librarySaved"
                  :saving="!!msg.savingToLibrary"
                  :reason="resultBarReason(msg)"
                  @create="saveResultToCreation(msg)"
                  @library="saveResultToLibrary(msg)"
                  @retry="openRetry(msg)"
                  @reedit="reeditResult(msg)"
                />
              </div>

              <!-- 模型替换 / 图片未送达等非致命问题：必须显式告知，不能静默 -->
              <div v-if="msg.warning" class="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                {{ msg.warning }}
              </div>

              <!-- 思考过程：与回答正文分离，默认折叠，可展开查看 -->
              <div v-if="msg.thinking" class="rounded-xl border border-studio-750 bg-studio-950/70 overflow-hidden">
                <button
                  type="button"
                  class="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold text-studio-cyan hover:bg-studio-900/60 cursor-pointer"
                  @click="expandedThinking[i] = !expandedThinking[i]"
                >
                  <span class="flex items-center gap-1.5">
                    <span>🧠 思考过程</span>
                    <span class="text-slate-500 font-normal font-mono">{{ msg.thinking.length }} 字</span>
                  </span>
                  <span class="text-slate-400 font-normal">{{ expandedThinking[i] ? '收起' : '展开' }}</span>
                </button>
                <pre v-if="expandedThinking[i]" class="px-3 pb-3 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-400 max-h-72 overflow-y-auto scrollbar-thin">{{ msg.thinking }}</pre>
              </div>

              <!-- 错误卡片：图标 + 标题 + 正文 + 处置建议 + 操作 -->
              <div v-if="msg.isError" class="gen-error">
                <div class="gen-error-head">
                  <span class="gen-error-icon">
                    <StudioIcon name="warning" :size="15" />
                  </span>
                  <span class="gen-error-title">生成未成功</span>
                </div>
                <p class="gen-error-body">{{ friendlyErrorText(msg.content) }}</p>
                <p v-if="errorHint(msg.content)" class="gen-error-hint">
                  <StudioIcon name="info" :size="12" />
                  {{ errorHint(msg.content) }}
                </p>
                <div class="gen-error-actions">
                  <button type="button" class="gen-error-retry" @click="openRetry(msg)">
                    <StudioIcon name="refresh" :size="12" />
                    重试
                  </button>
                  <button type="button" class="gen-error-edit" @click="editFromError(msg)">
                    <StudioIcon name="edit" :size="12" />
                    编辑后再发
                  </button>
                </div>
              </div>

              <!-- 取消卡片：已手动取消提示与一键重新发起 -->
              <div v-else-if="msg.isCancelled" class="gen-error border-amber-900/40 bg-amber-950/20">
                <div class="gen-error-head">
                  <span class="gen-error-icon text-amber-400">
                    <StudioIcon name="info" :size="15" />
                  </span>
                  <span class="gen-error-title text-amber-200">生成已取消</span>
                </div>
                <p class="gen-error-body text-slate-300">该任务已手动取消，未消耗进一步算力与时间。</p>
                <div class="gen-error-actions">
                  <button type="button" class="gen-error-retry border-amber-800 text-amber-300 hover:bg-amber-900/40" @click="openRetry(msg)">
                    <StudioIcon name="refresh" :size="12" />
                    重新发起
                  </button>
                  <button type="button" class="gen-error-edit" @click="editFromError(msg)">
                    <StudioIcon name="edit" :size="12" />
                    编辑后再发
                  </button>
                </div>
              </div>
              <div v-else-if="!msg.isGenerating" class="space-y-2">
                <div class="chat-md select-text" v-html="renderMarkdown(msg.content)" @click="onMdClick" @mouseup="handleChatTextSelection"></div>

                <!-- 对话模型回答快捷迁移为创作提示词 (生图 / 生视频) -->
                <div
                  v-if="msg.role === 'assistant' && msg.content && !msg.imageUrl && !msg.videoUrl"
                  class="flex flex-wrap items-center gap-2 pt-2 border-t border-studio-800/60 text-xs"
                >
                  <span class="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                    <StudioIcon name="sparkles" :size="12" class="text-studio-accent" />
                    <span>快捷转为提示词：</span>
                  </span>
                  <button
                    type="button"
                    @click="transferContentToPrompt(msg.content, 'image')"
                    class="px-2.5 py-1 rounded-lg bg-studio-800 hover:bg-studio-700 text-studio-cyan border border-studio-700 hover:border-studio-cyan/40 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                    title="将该回答直接填充为生图提示词"
                  >
                    <span>🖼️ 转为生图提示词</span>
                  </button>
                  <button
                    type="button"
                    @click="transferContentToPrompt(msg.content, 'video')"
                    class="px-2.5 py-1 rounded-lg bg-studio-800 hover:bg-studio-700 text-purple-300 border border-studio-700 hover:border-purple-500/40 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                    title="将该回答直接填充为视频生成提示词"
                  >
                    <span>🎬 转为视频提示词</span>
                  </button>
                </div>
              </div>

              <!-- 阶段 6：助手回复成功后的「接着可以」智能接续建议 -->
              <div
                v-if="!msg.isError && msg.nextSuggestions && msg.nextSuggestions.length"
                class="pt-2.5 mt-2 border-t border-studio-800/80 flex flex-wrap items-center gap-1.5"
              >
                <span class="text-[11px] text-amber-300 font-mono font-medium flex items-center gap-1 mr-1">
                  <StudioIcon name="sparkles" :size="12" class="text-amber-400" />
                  接着可以：
                </span>
                <button
                  v-for="(sug, sIdx) in msg.nextSuggestions"
                  :key="sIdx"
                  type="button"
                  @click="applySuggestionToSupplement(sug)"
                  class="text-xs px-2.5 py-1 rounded-full bg-studio-800 hover:bg-studio-700 text-slate-300 hover:text-white border border-studio-700 hover:border-amber-400/50 transition-all cursor-pointer text-left shadow-xs"
                  title="点击将此建议填入下方输入框补充句"
                >
                  {{ sug }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentGenerating && !hasGeneratingPlaceholder" class="flex justify-start">
          <div class="rounded-xl bg-studio-900 border border-studio-750 px-4 py-3 text-slate-300 text-xs flex items-center gap-2.5 max-w-xl">
            <StudioIcon name="refresh" :size="16" class="animate-spin text-studio-accent shrink-0" />
            <span class="leading-relaxed">{{ generatingHint }}</span>
          </div>
        </div>
      </div>

      <!-- 快速回底：仅在用户上滑脱离钉底时出现；流式输出期间带红点提示有新内容 -->
      <button
        v-show="!pinned"
        type="button"
        class="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-studio-850 text-slate-200 shadow-xl border border-studio-700 hover:bg-studio-800 hover:text-white transition-all cursor-pointer"
        title="回到最新"
        @click="jumpToLatest"
      >
        <StudioIcon name="arrowDown" :size="18" />
        <span
          v-if="hasNewBelow"
          class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-studio-rose ring-2 ring-studio-950"
        ></span>
      </button>
      </div>

      <!-- 2.2 展开状态：看图区与右侧窄长槽位并排 (节省纵向高度) -->
      <div v-if="!viewerCollapsed" class="flex flex-1 min-h-0 overflow-hidden">
        <StudioViewer
          class="flex-1 min-w-0 h-full"
          :images="referenceTray"
          :selectedIndex="selectedImageIndex"
          :hoveredRegionKey="hoveredRegionKey"
          @region-hover="k => hoveredRegionKey = k"
          @select="selectedImageIndex = $event"
          @remove="removeRef($event)"
          @open-edit="openEditLayer($event)"
          @revert-annotation="onRevertAnnotation($event)"
          @toggle-collapse="viewerCollapsed = true"
          @suggest-prompts="handleSuggestPrompts"
          @open-picker="openAssetSelectorModal"
          @upload-files="handleDirectUploadFiles"
          @reorder="handleTrayReorder"
        />

        <!-- 图3所标：右侧窄长槽位 (高度铺满看图区，收缩时回归顶部) -->
        <StudioBottomTray
          mode="vertical"
          :images="referenceTray"
          :selectedIndex="selectedImageIndex"
          :hoveredRegionKey="hoveredRegionKey"
          @region-hover="k => hoveredRegionKey = k"
          @select="onTraySelect($event)"
          @reorder="handleTrayReorder"
          @open-picker="openAssetSelectorModal"
          @upload-files="handleDirectUploadFiles"
        />
      </div>
      </div>

      <!-- 2.3 收缩状态下底条停留在底部对话输入框正上方 (紧凑横向条，贴底融合) -->
      <StudioBottomTray
        v-if="viewerCollapsed"
        mode="horizontal"
        :images="referenceTray"
        :selectedIndex="selectedImageIndex"
        @select="onTraySelect($event)"
        @reorder="handleTrayReorder"
        @open-picker="openAssetSelectorModal"
        @upload-files="handleDirectUploadFiles"
        @expand-viewer="viewerCollapsed = false"
      />

      <!-- ========================================================================= -->
      <!-- 2.4 底部对话输入中枢卡片 (模型参数紧密集成 + 底部模式选择行) -->
      <!-- ========================================================================= -->
      <section
        class="bg-studio-900 border border-studio-750 p-3.5 shadow-2xl space-y-2.5 shrink-0"
        :class="viewerCollapsed ? 'rounded-b-2xl border-t-0' : 'rounded-2xl'"
      >
        <!-- 2.2.1 顶部紧密控制条：根据当前模式联动展示模型选择与参数 -->
        <div class="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-studio-800 text-xs">
          <!-- A. 纯对话专属控制条 -->
          <template v-if="activeModality === 'chat'">
            <div class="flex items-center space-x-2">
              <span class="text-slate-400 font-bold">对话模型:</span>
              <select v-model="chatModelKey" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <optgroup v-for="group in chatModelGroups" :key="group.label" :label="group.label">
                  <option v-for="m in group.models" :key="m.id" :value="m.id">
                    {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                  </option>
                </optgroup>
              </select>
            </div>

            <div class="flex items-center space-x-3">
              <label class="flex items-center space-x-1.5 text-studio-cyan font-bold">
                <span>🧠 思考强度</span>
                <select
                  v-if="chatReasoningCaps && chatReasoningCaps.supported"
                  v-model="thinkingStrength"
                  class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2 py-1 outline-none"
                  :title="chatReasoningCaps.note || ''"
                >
                  <option v-for="lv in chatReasoningCaps.levels" :key="lv" :value="lv">{{ thinkingLevelLabel(lv) }}</option>
                </select>
                <span v-else class="text-slate-400 font-normal" :title="chatReasoningCaps?.note || '模型未声明思考档位'">
                  {{ chatReasoningCaps?.mode === 'always' ? '内置思考·不可调' : (chatReasoningCaps?.mode === 'none' ? '该模型无思考档位' : '未声明') }}
                </span>
              </label>
              <span class="text-slate-500">|</span>
              <span class="text-slate-300" :title="contextNoteTitle">{{ contextNote }}</span>
            </div>
          </template>

          <!-- B. 生图 / 视频 / 音乐：和对话同一行密度，参数仍跟当前模型契约 -->
          <template v-else>
            <div class="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
              <span class="text-slate-400 font-bold">{{ activeModality === 'video' ? '视频模型' : (activeModality === 'music' ? '配乐' : '生图模型') }}:</span>
              <select v-if="activeModality === 'image'" v-model="imageModelKey" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <optgroup v-for="group in imageModelGroups" :key="group.label" :label="group.label">
                  <option v-for="m in group.models" :key="m.id" :value="m.id">
                    {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                  </option>
                </optgroup>
              </select>
              <select v-else-if="activeModality === 'video'" v-model="videoModelKey" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <optgroup v-for="group in videoModelGroups" :key="group.label" :label="group.label">
                  <option v-for="m in group.models" :key="m.id" :value="m.id">
                    {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                  </option>
                </optgroup>
              </select>
              <select v-else v-model="musicType" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <optgroup v-for="group in musicModelGroups" :key="group.label" :label="group.label">
                  <option v-for="m in group.models" :key="m.id" :value="m.id">
                    {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                  </option>
                </optgroup>
              </select>
              <DynamicModelParamBar
                v-if="currentSchema"
                :schema="currentSchema"
                :activeMode="activeGenMode"
                v-model="schemaParams"
                v-model:showAdvanced="showAdvanced"
                :refCounts="currentRefCounts"
                @select-mode="setGenMode"
                @param-change="onParamBarChange"
              />
            </div>
            <p v-if="catalogError" class="basis-full text-xs text-amber-300">
              模型目录读取失败（{{ catalogError }}），所以下拉框是空的、参数条也没接上。
              <button type="button" class="font-bold underline cursor-pointer" @click="loadStudioCatalog">重试</button>
            </p>
            <p v-else-if="activeModality !== 'chat' && !currentModelList.length" class="basis-full text-xs text-amber-300">
              这个模态还没有已启用的模型，去「设置 · 模型」启用后
              <button type="button" class="font-bold underline cursor-pointer" @click="loadStudioCatalog">重新加载</button>。
            </p>
            <p v-if="activeModality === 'image' && imageModelKey === 'qwenimage_local'" class="basis-full text-xs text-slate-300 leading-relaxed">
              文生图，或挂最多 10 张参考图做编辑。标准模型和加速 8 步在上面选。
            </p>
            <p v-else-if="activeModality === 'image' && currentSchema && !fieldByKey(currentSchema, 'size')" class="basis-full text-xs text-slate-300 leading-relaxed">
              这个模型按宽高比直接出图，没有独立的分辨率档位；尺寸跟着「宽高比」走。
            </p>
            <p v-else-if="audioOnlyModel()" class="basis-full text-xs text-slate-300 leading-relaxed">
              先上传一段参考音频，10 到 15 秒最合适。上面的文字是要说的话。
            </p>
            <p v-else-if="activeModality === 'music' && musicType === 'acestep_local'" class="basis-full text-xs text-slate-300 leading-relaxed">
              纯音乐只写风格。人声歌曲先写【风格】，再写【歌词】。默认出 1 条。
            </p>
            <p v-else-if="!currentSchema" class="basis-full text-xs text-slate-300">这个模型的参数表还没接入，这次只提交提示词。</p>
            <p v-if="oldRecipeNote" class="basis-full text-xs text-slate-300">这是旧配方，模型未记录，已改用 Agnes Image 2.5 Flash。</p>
            <p v-if="composerNotice" class="basis-full text-xs text-amber-300">{{ composerNotice }}</p>
            <p v-if="autoAdaptiveNotice" class="basis-full text-xs font-medium text-emerald-400 flex items-center gap-1.5 animate-in fade-in duration-200">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>{{ autoAdaptiveNotice }}</span>
            </p>
            <p v-if="composerError" class="basis-full text-xs font-bold text-rose-400">{{ composerError }}</p>
          </template>
        </div>

        <!-- 2.2.2 提示词富文本输入中枢 (图文混排) -->
        <div class="rounded-xl bg-studio-950 border border-studio-700/80 p-3 relative shadow-inner space-y-2">

          <!-- @ 符号悬浮快捷引用浮层 (看图区已有图时展现，底部为「从素材库添加」) -->
          <div
            v-if="showAtMenu"
            class="absolute bottom-full left-4 mb-2 w-88 bg-studio-900 border border-studio-700 rounded-xl shadow-2xl p-2 z-40 max-h-96 overflow-y-auto scrollbar-thin select-none"
          >
            <!-- 顶部 Tab：已挂载参考图 vs 本会话产物图 -->
            <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-studio-800">
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  @mousedown.prevent
                  @click="atMenuTab = 'tray'"
                  class="px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition"
                  :class="atMenuTab === 'tray' ? 'bg-studio-accent/20 text-studio-cyan border border-studio-cyan/40' : 'text-slate-400 hover:text-slate-200'"
                >
                  已挂载参考图 ({{ referenceTray.length }})
                </button>
                <button
                  type="button"
                  @mousedown.prevent
                  @click="atMenuTab = 'history'"
                  class="px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition flex items-center gap-1"
                  :class="atMenuTab === 'history' ? 'bg-studio-accent/20 text-studio-cyan border border-studio-cyan/40' : 'text-slate-400 hover:text-slate-200'"
                >
                  <span>本会话生图</span>
                  <span v-if="sessionGeneratedImages.length" class="px-1 rounded bg-studio-800 text-[9px]">{{ sessionGeneratedImages.length }}</span>
                </button>
              </div>
              <button type="button" class="text-slate-500 hover:text-slate-300 text-xs cursor-pointer px-1" @click="showAtMenu = false">✕</button>
            </div>

            <!-- 分组 1：已挂载看图区参考图 -->
            <div v-if="atMenuTab === 'tray'" class="py-1 space-y-1">
              <div v-if="referenceTray.length === 0" class="py-4 text-center text-xs text-slate-500">
                看图区暂无挂载图，可从下方或会话产物添加
              </div>
              <template v-else v-for="(item, idx) in referenceTray" :key="item.url || idx">
                <button
                  type="button"
                  @mousedown.prevent
                  @click="selectAtMention(item, idx)"
                  class="w-full px-2.5 py-1.5 rounded-lg hover:bg-studio-800 cursor-pointer text-xs text-slate-200 flex items-center space-x-2.5 transition-colors text-left"
                >
                  <img :src="item.thumbUrl || item.url" class="w-8 h-8 rounded object-cover border border-studio-700 shrink-0" />
                  <div class="flex-1 min-w-0">
                    <div class="font-bold text-studio-cyan font-mono flex items-center justify-between">
                      <span>图{{ idx + 1 }} (整图)</span>
                      <span v-if="item.regions && item.regions.length > 0" class="text-[10px] text-studio-accent font-normal">
                        {{ item.regions.length }} 个子区域
                      </span>
                    </div>
                    <div class="text-[10px] text-slate-400 truncate">{{ item.name || '参考图' }}</div>
                  </div>
                </button>

                <!-- 若该图存在子选区，树状下钻展示子区域 -->
                <div
                  v-if="item.regions && item.regions.length > 0"
                  class="ml-5 pl-2.5 border-l-2 border-studio-800/80 space-y-1 my-0.5"
                >
                  <button
                    v-for="reg in item.regions"
                    :key="reg.id"
                    type="button"
                    @mousedown.prevent
                    @click="selectAtRegionMention(item, idx, reg)"
                    @mouseenter="hoveredRegionKey = `${idx}_${reg.id}`"
                    @mouseleave="hoveredRegionKey = null"
                    class="w-full px-2 py-1 rounded-md hover:bg-studio-800 cursor-pointer text-xs text-slate-300 flex items-center justify-between transition-colors text-left group"
                  >
                    <div class="flex items-center space-x-1.5 min-w-0">
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        :style="{ backgroundColor: reg.color?.border || '#3B82F6' }"
                      ></span>
                      <span class="font-bold text-studio-cyan font-mono truncate text-[11px]">
                        @图{{ idx + 1 }}[{{ reg.name }}]
                      </span>
                    </div>
                    <span class="text-[10px] text-slate-500 group-hover:text-slate-300 font-mono shrink-0 ml-1">
                      {{ getRegionOpDisplayName(reg.op) }}
                    </span>
                  </button>
                </div>
              </template>
            </div>

            <!-- 分组 2：本会话已有生图结果 (一键挂载并引用) -->
            <div v-else-if="atMenuTab === 'history'" class="py-1 space-y-1">
              <div v-if="sessionGeneratedImages.length === 0" class="py-4 text-center text-xs text-slate-500">
                本会话暂未生成图片
              </div>
              <button
                v-for="(gen, gIdx) in sessionGeneratedImages"
                :key="gen.url || gIdx"
                type="button"
                @mousedown.prevent
                @click="selectGeneratedImageMention(gen)"
                class="w-full px-2.5 py-1.5 rounded-lg hover:bg-studio-800 cursor-pointer text-xs text-slate-200 flex items-center space-x-2.5 transition-colors text-left group"
                :title="`引用本会话生成的图片: ${gen.name}`"
              >
                <img :src="gen.fullUrl || gen.url" class="w-8 h-8 rounded object-cover border border-studio-700 shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="font-bold text-amber-300 font-mono flex items-center justify-between text-[11px]">
                    <span class="truncate">{{ gen.name }}</span>
                    <span class="text-[9px] px-1 rounded bg-studio-800 text-slate-400 font-normal shrink-0 ml-1">+ 挂载引用</span>
                  </div>
                  <div class="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>{{ gen.model }}</span>
                    <span class="font-mono text-slate-500">{{ formatGenTime(gen.time) }}</span>
                  </div>
                </div>
              </button>
            </div>

            <div class="pt-1.5 mt-1 border-t border-studio-800">
              <button
                type="button"
                @mousedown.prevent
                @click="openAssetSelectorModal(); showAtMenu = false"
                class="w-full px-2.5 py-1.5 rounded-lg hover:bg-studio-800 cursor-pointer text-xs text-studio-accent hover:text-white flex items-center justify-center gap-1.5 transition-colors font-bold"
              >
                <StudioIcon name="plus" :size="13" />
                <span>从全库素材库挑选挂载...</span>
              </button>
            </div>
          </div>

          <!-- # 符号悬浮模糊匹配浮层 -->
          <div
            v-if="showHashMenu"
            class="absolute bottom-full left-4 mb-2 w-80 bg-studio-900 border border-studio-700 rounded-xl shadow-2xl p-2 z-40 max-h-72 overflow-y-auto scrollbar-thin"
          >
            <div class="text-[11px] text-slate-400 font-mono px-2 py-1 border-b border-studio-800 flex items-center justify-between">
              <span>调用创作库配方 (# 快捷呼出):</span>
              <span class="text-studio-accent">{{ filteredTemplates.length }} 个可用</span>
            </div>
            <div
              v-for="tpl in filteredTemplates"
              :key="tpl.id"
              @click="selectHashTemplate(tpl)"
              class="px-2.5 py-2 rounded-lg hover:bg-studio-800 cursor-pointer text-xs text-slate-200 flex items-center space-x-2.5 transition-colors"
            >
              <TemplateVideoCover
                v-if="tpl.type === 'video'"
                class="w-8 h-8 rounded border border-white/10 shrink-0"
                compact
                :poster-url="getVideoPosterUrl(tpl)"
                :video-url="templateVideoUrl(tpl)"
                :reference-url="templateRefUrl(tpl)"
              />
              <img v-else-if="tpl.result_images?.[0]?.url" :src="authedMediaUrl(tpl.result_images[0].url)" class="w-8 h-8 rounded object-cover border border-white/10 shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="font-bold text-white truncate flex items-center gap-1.5">
                  <span v-if="tpl.is_pinned" class="text-amber-400 text-[10px]" title="置顶收藏">⭐</span>
                  <span v-else-if="tpl.use_count > 0" class="text-amber-400 text-[10px] font-mono" title="常用">🔥</span>
                  <span>#{{ tpl.title }}</span>
                </div>
                <div class="text-[11px] text-slate-400 truncate">{{ tpl.prompt }}</div>
              </div>
            </div>
          </div>

          <!-- 配方句输入区域 (顶部，浅底色，小标签，右侧清空叉，支持@图N胶囊高亮与多行大卡片自由编辑) -->
          <div
            v-if="recipePrompt || globalRecipePrompt || rightDrawerOpen || isRecipeEditing"
            class="rounded-xl bg-studio-900/95 border border-studio-750 p-2.5 transition-all animate-in fade-in duration-150"
            :class="isRecipeEditing ? 'flex flex-col gap-2 ring-1 ring-studio-accent/40 shadow-lg' : 'flex items-start gap-2'"
          >
            <!-- A. 编辑态：顶部工具条 (保存、整理、放弃、清空) + 大号编辑区 -->
            <template v-if="isRecipeEditing">
              <div class="flex items-center justify-between gap-2 select-none border-b border-studio-800/80 pb-2">
                <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-studio-accent/20 text-studio-accent font-bold text-xs shrink-0">
                  <StudioIcon name="wand" :size="12" />
                  <span>编辑空间全局配方句</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    @click="handleOrganizeRecipePrompt"
                    class="px-2.5 py-1 rounded bg-studio-cyan/15 hover:bg-studio-cyan/25 text-studio-cyan text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                    title="智能保护@图胶囊，按空间/材质/构图分行规整去重"
                  >
                    <StudioIcon name="sparkles" :size="12" />
                    <span>{{ organizeFlash ? '✓ 已整理' : '✨ 整理提示词' }}</span>
                  </button>
                  <button
                    type="button"
                    @click="saveRecipeEdit"
                    class="px-2.5 py-1 rounded bg-studio-accent hover:brightness-110 text-white text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                    title="保存并应用当前配方句 (Ctrl+Enter)"
                  >
                    <StudioIcon name="check" :size="12" />
                    <span>保存</span>
                  </button>
                  <button
                    type="button"
                    @click="cancelRecipeEdit"
                    class="px-2 py-1 rounded bg-studio-800 hover:bg-studio-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                  >
                    放弃
                  </button>
                  <button
                    type="button"
                    @click="editingRecipeText = ''"
                    class="p-1 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
                    title="清空当前输入"
                  >
                    <StudioIcon name="close" :size="13" />
                  </button>
                </div>
              </div>
              <div class="space-y-2">
                <textarea
                  ref="recipeInputRef"
                  v-model="coreRecipeText"
                  placeholder="编辑核心空间配方与材质，支持引用 @图1[沙发] 与色号..."
                  class="w-full bg-studio-950/60 border border-studio-800 rounded-lg p-2.5 text-sm text-slate-100 font-medium leading-relaxed outline-none focus:border-studio-accent/70 transition-all font-sans resize-y min-h-[90px] max-h-[160px] scrollbar-thin"
                  @keydown.ctrl.enter="saveRecipeEdit"
                  @keydown.meta.enter="saveRecipeEdit"
                  @keydown.esc="cancelRecipeEdit"
                ></textarea>

                <!-- 底层固化约束规则折叠卡片 -->
                <div v-if="advancedRulesText" class="rounded-lg border border-studio-800/80 bg-studio-950/40 p-2 text-xs">
                  <div
                    class="flex items-center justify-between cursor-pointer select-none text-slate-400 hover:text-slate-200"
                    @click="showAdvancedRules = !showAdvancedRules"
                  >
                    <span class="flex items-center gap-1.5 font-bold text-[11px]">
                      <StudioIcon name="shield" :size="12" class="text-studio-accent" />
                      <span>底层固化约束（相机透视/不拉伸/全局禁止）</span>
                      <span class="text-[10px] text-slate-500 font-mono">({{ advancedRulesText.length }} 字)</span>
                    </span>
                    <span class="text-[10px] text-studio-cyan font-bold flex items-center gap-0.5">
                      {{ showAdvancedRules ? '收起固化规则 ↑' : '展开微调固化规则 ↓' }}
                    </span>
                  </div>
                  <textarea
                    v-if="showAdvancedRules"
                    v-model="advancedRulesText"
                    class="w-full mt-2 bg-studio-900/90 border border-studio-800 rounded p-2 text-xs text-slate-300 font-mono leading-relaxed outline-none focus:border-studio-accent scrollbar-thin resize-y min-h-[100px] max-h-[180px]"
                    placeholder="固化的透视与禁止词规则..."
                  ></textarea>
                </div>
              </div>

              <div class="flex items-center justify-between text-[11px] text-slate-500 font-mono px-0.5">
                <span>支持 @图1 空间引用 · 按 Ctrl+Enter 快速保存</span>
                <span>核心 {{ coreRecipeText.length }} 字<span v-if="advancedRulesText"> · 固化 {{ advancedRulesText.length }} 字</span></span>
              </div>
            </template>

            <!-- B. 非编辑态：胶囊高亮显示 / 紧凑预览 -->
            <template v-else>
              <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-studio-accent/20 text-studio-accent font-bold text-[11px] shrink-0 mt-0.5 select-none">
                <StudioIcon name="wand" :size="11" />
                <span>配方句</span>
              </div>
              <div class="flex-1 min-w-0 space-y-1.5">
                <!-- 图片局部编辑配方（按图/选区聚合） -->
                <div
                  v-if="recipePrompt"
                  @click="startRecipeEdit"
                  :class="[
                    'text-xs text-slate-100 font-medium leading-relaxed cursor-text py-0.5 select-text transition-all',
                    recipeExpanded ? 'max-h-40 overflow-y-auto scrollbar-thin whitespace-pre-wrap' : 'max-h-12 overflow-hidden line-clamp-2 text-ellipsis'
                  ]"
                  :title="recipeExpanded ? '点击编辑配方句' : '点击编辑配方句（或点击右侧展开）'"
                >
                  <template v-for="(seg, idx) in parseRecipeSegments(displayRecipePrompt)" :key="idx">
                    <span
                      v-if="seg.type === 'chip'"
                      @mouseenter="seg.regionName && highlightRegionFromChip(seg.tuNum - 1, seg.regionName)"
                      @mouseleave="hoveredRegionKey = null"
                      class="inline-flex items-center px-1.5 py-0.5 rounded-full bg-studio-cyan/20 text-studio-cyan border border-studio-cyan/40 font-mono font-bold text-[11px] select-none shadow-xs hover:brightness-125 cursor-pointer align-middle mx-0.5 transition-all"
                    >{{ seg.tag }}</span>
                    <span v-else class="align-middle">{{ seg.text }}</span>
                  </template>
                  <span
                    v-if="recipeHasRules"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-studio-800/90 text-slate-400 font-mono text-[10px] ml-1.5 select-none border border-studio-700/60 align-middle"
                    title="已固化包含相机透视、比例锁定与全局禁止清单"
                  >
                    <StudioIcon name="shield" :size="10" class="text-studio-accent" />
                    <span>包含固化规则</span>
                  </span>
                </div>

                <!-- 全局操作配方（风格/换空间/超分/去水印）：与图片编辑叠加，不互相替换 -->
                <div
                  v-if="displayGlobalRecipePrompt"
                  :class="[
                    'rounded-lg border border-amber-500/30 bg-amber-500/10 pl-2 pr-1.5 py-1 text-xs text-amber-100/90 font-medium leading-relaxed',
                    recipeExpanded ? 'max-h-40 overflow-y-auto scrollbar-thin whitespace-pre-wrap' : 'max-h-12 overflow-hidden'
                  ]"
                >
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold text-[10px] mr-1.5 align-middle select-none">
                    <StudioIcon name="sliders" :size="10" />
                    <span>全局编辑</span>
                  </span>
                  <span class="whitespace-pre-wrap align-middle">{{ displayGlobalRecipePrompt }}</span>
                </div>

                <!-- 两者都为空时的占位 -->
                <div
                  v-if="!recipePrompt && !displayGlobalRecipePrompt"
                  @click="startRecipeEdit"
                  class="text-xs text-slate-400 font-medium italic cursor-pointer py-0.5 select-none"
                >
                  点击编写或微调空间配方句...
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0 mt-0.5">
                <button
                  type="button"
                  @click="startRecipeEdit"
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-300 hover:text-white bg-studio-800 hover:bg-studio-700 cursor-pointer transition-colors"
                  title="放大编辑配方句"
                >
                  编辑 ✎
                </button>
                <button
                  type="button"
                  @click="rightDrawerOpen = true"
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 cursor-pointer transition-colors"
                  title="叠加全局编辑：风格 / 换空间 / 超分 / 去水印"
                >
                  全局编辑
                </button>
                <button
                  v-if="recipePrompt || displayGlobalRecipePrompt"
                  type="button"
                  @click.stop="recipeExpanded = !recipeExpanded"
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold text-studio-cyan bg-studio-cyan/15 hover:bg-studio-cyan/25 cursor-pointer transition-colors"
                  :title="recipeExpanded ? '收起配方句，避免遮挡主图' : '展开查看全部配方句内容'"
                >
                  {{ recipeExpanded ? '收起 ↑' : '展开 ↓' }}
                </button>
                <button
                  v-if="recipePrompt || displayGlobalRecipePrompt"
                  type="button"
                  @click="clearAllRecipe"
                  class="p-1 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
                  title="清空图片编辑与全局编辑配方"
                >
                  <StudioIcon name="close" :size="13" />
                </button>
              </div>
            </template>
          </div>
          <div
            v-else
            class="px-2.5 py-1.5 rounded-lg bg-studio-900/40 border border-studio-800/60 flex items-center justify-between text-[11px] text-slate-500 cursor-pointer hover:border-studio-700 hover:text-slate-400 transition-colors"
            @click="rightDrawerOpen = true"
          >
            <span class="flex items-center gap-1.5">
              <StudioIcon name="sliders" :size="12" class="text-studio-accent/60" />
              <span>空间全局配方句（点击右侧「全局配方」展开风格/超分/去水印）</span>
            </span>
            <span class="text-[10px] text-studio-cyan font-mono">展开工具 →</span>
          </div>

          <!-- 补充句富文本输入容器 -->
          <div class="relative pt-1">
            <div class="text-[10px] font-bold text-slate-400 mb-1 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span>补充细节 / 自定义要求:</span>
                <button
                  type="button"
                  @click="toggleVoiceRecording"
                  :disabled="isTranscribing"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer"
                  :class="isRecording ? 'bg-rose-500 text-white animate-pulse' : (isTranscribing ? 'bg-studio-800 text-slate-400 cursor-wait' : 'bg-studio-800 hover:bg-studio-700 text-slate-300 hover:text-white border border-studio-700')"
                  :title="isRecording ? '点击结束录音并转写' : '点击开始语音输入'"
                >
                  <StudioIcon name="mic" :size="11" :class="isRecording ? 'text-white' : 'text-studio-cyan'" />
                  <span>{{ isRecording ? `录音中 ${recordingDuration}s · 点击完成` : (isTranscribing ? '转写中...' : '语音输入') }}</span>
                </button>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-slate-500 font-mono">输入 @ 引用图片，# 引用配方</span>
                <!-- 悬浮快捷 @ 标药丸：当看图区有图片时，直接展现快捷点击芯片 -->
                <div v-if="referenceTray.length > 0" class="flex items-center gap-1">
                  <button
                    v-for="(item, idx) in referenceTray"
                    :key="item.url || idx"
                    type="button"
                    @mousedown.prevent
                    @click="insertChipToEditor(item, `@图${idx + 1}`)"
                    class="px-1.5 py-0.5 rounded bg-studio-850 hover:bg-studio-800 border border-studio-700 hover:border-studio-cyan text-studio-cyan text-[10px] font-mono font-bold transition-all cursor-pointer shadow-sm flex items-center gap-0.5"
                    :title="`快捷插入 @图${idx + 1} (${item.name || '参考图'})`"
                  >
                    <span>@图{{ idx + 1 }}</span>
                  </button>
                </div>
              </div>
            </div>
            <div
              ref="richEditorRef"
              contenteditable="true"
              class="rich-prompt-editor text-slate-100 text-sm leading-relaxed font-medium min-h-[44px] max-h-36 overflow-y-auto outline-none"
              :class="activeModality === 'chat' ? 'pr-3' : (optimizeUndo ? 'pr-48' : 'pr-32')"
              data-placeholder="例如：沙发换成深灰色布艺，百叶窗拉上一半，阳光只洒在地毯上..."
              @input="onEditorInput"
              @keyup="onEditorKeyup"
              @keydown="onEditorKeydown"
              @click="saveEditorSelection"
              @blur="saveEditorSelection"
            ></div>

            <div v-if="activeModality !== 'chat'" class="absolute top-6 right-0 flex items-center gap-1.5">
              <button
                v-if="optimizeUndo"
                type="button"
                @click="undoOptimize"
                :disabled="optimizing"
                class="px-2.5 py-1.5 rounded-lg border border-studio-700 bg-studio-900 text-slate-200 text-xs font-extrabold cursor-pointer disabled:opacity-40"
                title="撤回优化前的提示词"
              >
                撤回
              </button>
              <button
                type="button"
                @click="optimizePrompt"
                :disabled="optimizing"
                class="px-3 py-1.5 rounded-lg bg-studio-accent/20 hover:bg-studio-accent/30 text-studio-accent text-xs font-extrabold border border-studio-accent/40 flex items-center space-x-1.5 transition-all disabled:opacity-40 cursor-pointer shadow-sm"
                title="根据当前模型专属提示词规则进行智能优化"
              >
                <StudioIcon name="wand" :size="13" :class="{ 'animate-spin': optimizing }" />
                <span>{{ optimizing ? '优化中...' : '✨ 优化提示词' }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 2.2.3 底部核心：模式选择行 + 操作按钮 (完全对齐豆包底栏结构！) -->
        <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
          <!-- 底部主模式切换行 (纯对话 / 图片生成 / 视频生成 / 音乐生成) -->
          <div class="flex items-center space-x-1.5 bg-studio-950 p-1 rounded-xl border border-studio-750">
            <button
              @click="switchModality('chat')"
              :class="[
                'px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1.5 cursor-pointer',
                'choice',
                activeModality === 'chat' ? 'is-on' : ''
              ]"
            >
              <span class="choice-mark"></span>
              <StudioIcon name="chat" :size="14" />
              <span>纯对话</span>
              <span v-if="activeModality === 'chat'" class="choice-now">当前</span>
            </button>

            <button
              @click="switchModality('image')"
              :class="[
                'px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1.5 cursor-pointer',
                'choice',
                activeModality === 'image' ? 'is-on' : ''
              ]"
            >
              <span class="choice-mark"></span>
              <StudioIcon name="image" :size="14" />
              <span>图片生成</span>
              <span v-if="activeModality === 'image'" class="choice-now">当前</span>
            </button>

            <button
              @click="switchModality('video')"
              :class="[
                'px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1.5 cursor-pointer',
                'choice',
                activeModality === 'video' ? 'is-on' : ''
              ]"
            >
              <span class="choice-mark"></span>
              <StudioIcon name="video" :size="14" />
              <span>视频生成</span>
              <span v-if="activeModality === 'video'" class="choice-now">当前</span>
            </button>

            <button
              @click="switchModality('music')"
              :class="[
                'px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1.5 cursor-pointer',
                'choice',
                activeModality === 'music' ? 'is-on' : ''
              ]"
            >
              <span class="choice-mark"></span>
              <StudioIcon name="music" :size="14" />
              <span>音乐生成</span>
              <span v-if="activeModality === 'music'" class="choice-now">当前</span>
            </button>
          </div>

          <!-- 中间与右侧快捷工具与生成按钮 -->
          <div class="flex items-center space-x-2 text-xs">
            <button
              type="button"
              @click="toggleAtMentionMenu"
              class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-studio-cyan text-xs font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer"
              title="在提示词中引用当前已挂载的参考图（@图1、@图2...）"
            >
              <span>@ 引用图片</span>
            </button>

            <button
              type="button"
              @click="openAssetSelectorModal"
              class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-300 hover:text-white text-xs font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer"
              title="从素材库或本地挂载新参考图到托盘"
            >
              <StudioIcon name="plus" :size="12" />
              <span>挂载素材</span>
            </button>

            <button
              @click="showHashMenu = !showHashMenu"
              class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-studio-indigo text-xs font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer"
              title="选择创作库模块"
            >
              <span># 创作库</span>
            </button>

            <div class="relative">
              <button
                type="button"
                @click="showSkillsMenu = !showSkillsMenu"
                class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-emerald-400 text-xs font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer"
                title="挂载模型专属创作技能 (Skills)"
              >
                <span>🧩 技能挂载{{ activeSkillIds.length ? ` (${activeSkillIds.length})` : '' }}</span>
              </button>
              <div
                v-if="showSkillsMenu"
                class="absolute bottom-full right-0 mb-2 w-80 rounded-xl bg-studio-900 border border-studio-700 shadow-2xl p-2.5 z-40 space-y-1.5"
              >
                <div class="flex items-center justify-between text-[11px] text-slate-400 pb-1 border-b border-studio-800">
                  <span class="font-bold text-white">🧩 空间与多模态专属技能 (Skills)</span>
                  <button type="button" class="text-slate-400 hover:text-white cursor-pointer" @click="showSkillsMenu = false">✕</button>
                </div>
                <div
                  v-for="sk in availableStudioSkills"
                  :key="sk.id"
                  @click="toggleStudioSkill(sk)"
                  class="p-2 rounded-lg border cursor-pointer transition-all"
                  :class="activeSkillIds.includes(sk.id) ? 'bg-studio-accent/20 border-studio-accent text-white' : 'bg-studio-950/60 border-studio-800 text-slate-300 hover:border-studio-700'"
                >
                  <div class="flex items-center justify-between text-xs font-bold">
                    <span>{{ sk.name }}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-studio-850 text-emerald-400 border border-studio-750">{{ sk.badge }}</span>
                  </div>
                  <p class="text-[11px] text-slate-400 mt-0.5 leading-snug">{{ sk.desc }}</p>
                </div>
              </div>
            </div>

            <!-- 预览请求按钮 (全链路透传审查) -->
            <button
              type="button"
              @click="handlePreviewRequest"
              :disabled="currentGenerating || previewLoading"
              class="px-3.5 py-2 rounded-xl border border-studio-700 bg-studio-850 hover:bg-studio-800 text-studio-cyan text-xs font-extrabold flex items-center space-x-1.5 cursor-pointer transition-all disabled:opacity-40 shadow-sm"
              title="审查透传给大模型网关的完整请求与方言报文"
            >
              <StudioIcon name="sliders" :size="13" :class="{ 'animate-spin': previewLoading }" />
              <span>{{ previewLoading ? '审查中...' : '预览请求' }}</span>
            </button>

            <!-- 立即生成/发送按钮 -->
            <button
              @click="sendMessage"
              :disabled="currentGenerating"
              class="px-5 py-2 rounded-xl bg-gradient-to-r from-studio-accent to-studio-cyan hover:brightness-110 text-white text-xs font-extrabold flex items-center space-x-2 shadow-lg shadow-studio-accent/25 transition-all disabled:opacity-40 cursor-pointer ml-1"
            >
              <span>{{ getSendButtonText() }}</span>
              <StudioIcon name="send" :size="13" />
            </button>
          </div>
        </div>
      </section>

      <!-- 全屏独立图片编辑层 (画板五、六、七) -->
      <StudioEditLayer
        :visible="showEditModal"
        :image="currentEditingImage"
        :imageIndex="selectedImageIndex"
        :targetTag="targetRefTag"
        :totalReferenceCount="referenceTray.length"
        :selectedRatio="selectedRatio"
        @close="showEditModal = false"
        @apply-recipe-with-refs="onEditApplyRecipeWithRefs"
        @apply-regions-to-image="onEditApplyRegionsToImage"
        @apply-outpainted-image="onEditApplyOutpaintedImage"
        @apply-custom-image="onEditApplyCustomImage"
      />
    </main>

    <!-- 3. 右侧精准编辑抽屉 (宽 380px，支持风格/超分/去水印，仅修改配方句) -->
    <StudioGlobalDrawer
      v-if="rightDrawerOpen"
      v-model:recipePrompt="globalRecipePrompt"
      :targetTag="targetRefTag"
      :targetImageThumb="targetRefThumb"
      :targetImageName="targetRefName"
      :targetImageUrl="targetRefUrl"
      @mount-refs="onDrawerMountRefs"
      @unmount-material-refs="onDrawerUnmountMaterialRefs"
      @close="rightDrawerOpen = false"
    />

    <!-- 右边缘关闭状态下的竖向标签「精准编辑」 -->
    <button
      v-else
      type="button"
      @click="rightDrawerOpen = true"
      class="w-10 bg-studio-900 border-l border-studio-700 hover:bg-studio-850 hover:text-white text-slate-400 flex flex-col items-center justify-center py-6 gap-2 shrink-0 cursor-pointer transition-colors z-10"
      title="展开全局配方"
    >
      <StudioIcon name="sliders" :size="15" />
      <span class="text-xs font-bold [writing-mode:vertical-rl] tracking-widest">全局配方</span>
    </button>

    <!-- 3. 共享素材选择器（AI 对话 / 快捷编辑同一组件） -->
    <AssetPickerModal
      :visible="showAssetSelector"
      context="chat"
      :max-select="10"
      :recent="assetPickerRecent"
      :recent-current="assetPickerRecent"
      :recent-others="recentOthers"
      commit-on-version
      upload-enabled
      @close="showAssetSelector = false"
      @confirm="onAssetPickerConfirm"
      @upload="onAssetPickerUpload"
    />

    <!-- 请求审查与方言预览模态框 -->
    <RequestPreviewModal
      :visible="showPreviewModal"
      :previewData="previewModalData"
      @close="showPreviewModal = false"
      @replace-3d-model="onReplace3dModelFromPreview"
      @send="onPreviewSend"
    />

    <!-- ========================================================================= -->
    <!-- 4. 高清媒体预览灯箱 (Media Lightbox Modal: 大图缩放与视频播放) -->
    <!-- ========================================================================= -->
    <div
      v-if="previewModal.visible"
      class="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      @click.self="closeMediaPreview"
    >
      <div class="relative max-w-6xl w-full max-h-[92vh] flex flex-col items-center justify-center space-y-3">
        <!-- 预览顶栏 -->
        <div class="w-full flex items-center justify-between px-4 py-2 rounded-xl bg-studio-900/90 border border-studio-750 backdrop-blur-md shadow-xl text-xs">
          <div class="flex items-center space-x-2.5 truncate max-w-[60%]">
            <span class="text-sm">{{ previewModal.type === 'video' ? '🎬' : '🖼️' }}</span>
            <span class="font-bold text-white truncate">{{ previewModal.title }}</span>
          </div>

          <div class="flex items-center space-x-2">
            <!-- 缩放工具 (仅图片) -->
            <template v-if="previewModal.type === 'image'">
              <button @click="zoomPreview(-0.25)" class="px-2 py-1 rounded bg-studio-800 hover:bg-studio-750 text-slate-200 font-bold cursor-pointer">-</button>
              <span class="text-studio-cyan font-mono font-bold w-12 text-center">{{ Math.round(previewModal.scale * 100) }}%</span>
              <button @click="zoomPreview(0.25)" class="px-2 py-1 rounded bg-studio-800 hover:bg-studio-750 text-slate-200 font-bold cursor-pointer">+</button>
              <button @click="previewModal.scale = 1.0" class="px-2 py-1 rounded bg-studio-800 hover:bg-studio-750 text-slate-300 text-[11px] cursor-pointer">1:1</button>
              <div class="h-3 w-px bg-studio-750 mx-1"></div>
              <button
                type="button"
                @click="openEditFromLightbox"
                class="px-2.5 py-1 rounded-lg bg-studio-accent/20 hover:bg-studio-accent/30 text-studio-accent border border-studio-accent/40 font-bold flex items-center space-x-1 cursor-pointer transition-colors"
                title="挂载到看图区并进入编辑"
              >
                <StudioIcon name="edit" :size="13" />
                <span>进入编辑</span>
              </button>
              <div class="h-3 w-px bg-studio-750 mx-1"></div>
            </template>

            <a :href="previewModal.url" download target="_blank" class="px-3 py-1 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 font-bold flex items-center space-x-1">
              <span>⬇ 下载</span>
            </a>
            <button @click="closeMediaPreview" class="w-7 h-7 rounded-lg bg-studio-800 hover:bg-rose-600 text-white flex items-center justify-center font-bold cursor-pointer transition-all ml-1">
              ✕
            </button>
          </div>
        </div>

        <!-- 媒体主体展示区 -->
        <div class="w-full max-h-[82vh] flex items-center justify-center overflow-hidden rounded-2xl bg-black/60 border border-studio-800 shadow-2xl p-2 relative">
          <div v-if="previewModal.compare" class="grid w-full grid-cols-2 gap-3">
            <div class="space-y-1">
              <p class="text-[11px] font-bold text-slate-300">{{ previewModal.compare.leftLabel }}</p>
              <video :src="previewModal.compare.leftUrl" controls playsinline class="max-h-[70vh] w-full rounded-lg bg-black"></video>
            </div>
            <div class="space-y-1">
              <p class="text-[11px] font-bold text-slate-300">{{ previewModal.compare.rightLabel }}</p>
              <video v-if="previewModal.compare.rightUrl" :src="previewModal.compare.rightUrl" controls playsinline class="max-h-[70vh] w-full rounded-lg bg-black"></video>
              <p v-else class="flex min-h-[180px] items-center justify-center rounded-lg bg-black px-4 text-center text-xs leading-relaxed text-amber-200">{{ previewModal.compare.rightNote }}</p>
            </div>
          </div>
          <!-- 图片视图 -->
          <img
            v-else-if="previewModal.type === 'image'"
            :src="previewModal.url"
            :style="{ transform: `scale(${previewModal.scale})` }"
            class="max-h-[78vh] max-w-full object-contain transition-transform duration-100 select-none rounded-lg cursor-pointer"
            @click="openEditFromLightbox"
            title="点击直接进入图片编辑"
          />

          <!-- 视频播放视图 -->
          <video
            v-else-if="previewModal.type === 'video' && !previewModal.compare"
            :src="previewModal.url"
            controls
            autoplay
            class="max-h-[78vh] max-w-full rounded-xl bg-black shadow-2xl"
          ></video>
          <audio
            v-else
            :src="previewModal.url"
            controls
            autoplay
            class="w-full max-w-xl"
          ></audio>
        </div>
      </div>
    </div>

    <!-- 4. 模态弹窗：存入创作库与新建配方 -->
    <div
      v-if="saveModal.visible"
      class="fixed inset-0 z-[75] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      @click.self="saveModal.visible = false"
    >
      <div class="w-full max-w-lg rounded-2xl bg-studio-900 border border-studio-750 p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-studio-800">
          <span class="text-sm font-bold text-white flex items-center gap-2">
            <span>⭐</span>
            <span>{{ saveModal.msg ? '存入创作库' : '新建创作配方' }}</span>
          </span>
          <button @click="saveModal.visible = false" class="text-slate-400 hover:text-white cursor-pointer">✕</button>
        </div>

        <p class="text-xs text-slate-400">将优质创作结果沉淀为标准化配方，支持空间与风格多维归档及一键复用。</p>
        <div class="space-y-3.5 text-xs">
          <!-- 创作大类单选 -->
          <div>
            <label class="text-slate-300 font-bold block mb-1.5">创作大类：</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                type="button"
                @click="saveModal.type = 'image'"
                class="py-2 px-3 rounded-lg border font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
                :class="saveModal.type === 'image' ? 'bg-studio-accent text-white border-studio-accent shadow' : 'bg-studio-950 text-slate-400 border-studio-800 hover:text-slate-200'"
              >
                <StudioIcon name="image" :size="14" />
                <span>生图</span>
              </button>
              <button
                type="button"
                @click="saveModal.type = 'video'"
                class="py-2 px-3 rounded-lg border font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
                :class="saveModal.type === 'video' ? 'bg-purple-600 text-white border-purple-500 shadow' : 'bg-studio-950 text-slate-400 border-studio-800 hover:text-slate-200'"
              >
                <StudioIcon name="video" :size="14" />
                <span>生视频</span>
              </button>
              <button
                type="button"
                @click="saveModal.type = 'audio'"
                class="py-2 px-3 rounded-lg border font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
                :class="saveModal.type === 'audio' ? 'bg-emerald-600 text-white border-emerald-500 shadow' : 'bg-studio-950 text-slate-400 border-studio-800 hover:text-slate-200'"
              >
                <StudioIcon name="music" :size="14" />
                <span>生音频</span>
              </button>
            </div>
          </div>

          <!-- 空间与风格两列选择 -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-slate-300 font-bold block mb-1">空间分类：</label>
              <select
                v-model="saveModal.space"
                class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white outline-none font-bold"
              >
                <option value="">不标</option>
                <option v-for="sp in tagVocab.space" :key="sp.dir" :value="sp.dir">{{ sp.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-slate-300 font-bold block mb-1">设计风格：</label>
              <select
                v-model="saveModal.style"
                class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white outline-none font-bold"
              >
                <option value="">不标</option>
                <option v-for="st in tagVocab.style_atom" :key="st.dir" :value="st.dir">{{ st.label }}</option>
              </select>
            </div>
          </div>
          <div v-if="saveModal.type === 'video'">
            <label class="text-slate-300 font-bold block mb-1">成片用途：</label>
            <select
              v-model="saveModal.purpose"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white outline-none font-bold"
            >
              <option value="">不标</option>
              <option v-for="item in tagVocab.video_purpose" :key="item.dir" :value="item.dir">{{ item.label }}</option>
            </select>
          </div>

          <!-- 作品名称 -->
          <div>
            <label class="text-slate-300 font-bold block mb-1">作品名称：</label>
            <input
              v-model="saveModal.title"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white outline-none font-bold"
              placeholder="例如：意式极简全景客厅扩图"
            />
          </div>

          <!-- 提示词内容 -->
          <div>
            <label class="text-slate-300 font-bold block mb-1">提示词内容：</label>
            <textarea
              v-model="saveModal.prompt"
              rows="3"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-slate-200 outline-none"
              placeholder="描述生成提示词、材质、光影或运镜要求..."
            ></textarea>
          </div>

          <!-- 设为常用勾选 -->
          <div class="pt-1 flex items-center">
            <label class="flex items-center space-x-2 text-xs text-amber-300 font-bold cursor-pointer">
              <input type="checkbox" v-model="saveModal.is_pinned" class="rounded accent-amber-500 w-4 h-4 cursor-pointer" />
              <span>⭐ 标为常用配方（在创作库中置顶高亮显示）</span>
            </label>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-2 border-t border-studio-800">
          <button @click="saveModal.visible = false" class="px-4 py-1.5 rounded-lg text-slate-400 hover:text-white text-xs cursor-pointer">取消</button>
          <button
            @click="submitSaveToLibrary"
            :disabled="savingTpl"
            class="px-5 py-2 rounded-lg bg-studio-accent text-white font-bold text-xs shadow hover:brightness-110 cursor-pointer disabled:opacity-50"
          >
            {{ savingTpl ? '保存中...' : '确认存入创作库' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 5. 模态弹窗：全屏沉浸式配方详情与复用工作台 -->
    <div
      v-if="detailModal.visible"
      class="fixed inset-0 z-[80] flex flex-col bg-studio-950/98 backdrop-blur-xl animate-in fade-in duration-200 select-none"
    >
      <!-- 顶部工作台导航栏 -->
      <header class="h-16 px-6 border-b border-studio-800 bg-studio-900/90 flex items-center justify-between shrink-0 shadow-lg">
        <div class="flex items-center space-x-3">
          <span class="text-xl">📖</span>
          <div>
            <div class="flex items-center space-x-2.5">
              <h2 class="text-base font-bold text-white tracking-wide">创作配方工作台 · 详情与复用</h2>
              <span class="px-2.5 py-0.5 rounded-lg text-xs font-bold border" :class="getTemplateTypeBadgeClass(detailModal.tpl)">
                {{ getTemplateTypeLabel(detailModal.tpl) }}
              </span>
              <button
                type="button"
                @click="toggleTemplatePin(detailModal.tpl)"
                class="px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 shadow-xs"
                :class="detailModal.tpl.is_pinned ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30' : 'bg-studio-800 text-slate-300 hover:text-white border border-studio-700'"
              >
                <span>⭐</span>
                <span>{{ detailModal.tpl.is_pinned ? '已收藏' : '收藏此配方' }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="flex items-center space-x-4">
          <span class="text-xs text-slate-400 font-mono hidden md:inline">按 <kbd class="px-1.5 py-0.5 rounded bg-studio-800 text-slate-200 border border-studio-700 text-[10px]">ESC</kbd> 退出全屏视窗</span>
          <button
            @click="detailModal.visible = false"
            class="w-10 h-10 rounded-xl bg-studio-800 hover:bg-studio-700 border border-studio-700 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shadow-md"
            title="关闭全屏 (Esc)"
          >
            <StudioIcon name="close" :size="20" />
          </button>
        </div>
      </header>

      <!-- 主工作区：左侧沉浸大画幅 + 右侧参数工作台 -->
      <div class="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden select-text">
        <!-- 左侧：参考和成果按原比例并排，谁也不撑满视窗 -->
        <main class="flex-1 min-w-0 flex flex-col p-4 overflow-hidden bg-radial from-studio-900/30 to-studio-950">
          <div ref="detailStageEl" class="flex-1 min-h-0 flex items-center overflow-x-auto overflow-y-hidden">
            <div class="mx-auto flex items-end gap-3 px-2 min-w-min">
              <figure
                v-for="(refImg, rIdx) in (detailModal.tpl.origin_images || [])"
                :key="'ref_' + rIdx"
                class="shrink-0 flex flex-col items-center gap-1"
              >
                <figcaption class="text-[11px] font-bold text-amber-200">参考 @图{{ rIdx + 1 }}</figcaption>
                <button
                  type="button"
                  class="rounded-xl bg-black/40 border border-studio-800 overflow-hidden cursor-zoom-in"
                  :style="detailMediaStyle('ref:' + rIdx, 1)"
                  title="点击放大"
                  @click="openMediaPreview(refImg, 'image')"
                >
                  <img
                    v-if="refImg.url"
                    :src="refImg.url"
                    class="w-full h-full object-contain"
                    @load="noteDetailRatio('ref:' + rIdx, $event.target)"
                  />
                </button>
              </figure>
              <div
                v-if="(detailModal.tpl.origin_images || []).length"
                class="self-center shrink-0 text-xs font-bold text-slate-300 whitespace-nowrap pb-4"
              >参考 → 成果</div>
              <figure class="shrink-0 flex flex-col items-center gap-1">
                <figcaption class="text-[11px] font-bold text-studio-cyan">
                  成果<span v-if="detailAspectLabel(detailModal.tpl)"> · {{ detailAspectLabel(detailModal.tpl) }}</span>
                </figcaption>
                <div
                  class="rounded-xl bg-black/40 border border-studio-800 overflow-hidden flex items-center justify-center"
                  :style="detailMediaStyle('result', detailModal.tpl.type === 'audio' ? 1 : templateRailRatio(detailModal.tpl))"
                >
                  <video
                    v-if="detailModal.tpl.type === 'video' && detailModal.tpl.result_images?.[0]?.url"
                    :src="detailModal.tpl.result_images[0].url"
                    controls
                    autoplay
                    loop
                    playsinline
                    class="w-full h-full object-contain"
                    @loadedmetadata="noteDetailRatio('result', $event.target)"
                  ></video>
                  <div v-else-if="detailModal.tpl.type === 'audio' && detailModal.tpl.result_images?.[0]?.url" class="flex flex-col items-center gap-2 p-3">
                    <StudioIcon name="music" :size="28" />
                    <audio :src="detailModal.tpl.result_images[0].url" controls class="max-w-full"></audio>
                  </div>
                  <button
                    v-else-if="detailModal.tpl.result_images?.[0]?.url"
                    type="button"
                    class="w-full h-full cursor-zoom-in"
                    title="点击放大"
                    @click="openMediaPreview(detailModal.tpl.result_images[0], 'image')"
                  >
                    <img
                      :src="detailModal.tpl.result_images[0].url"
                      class="w-full h-full object-contain"
                      @load="noteDetailRatio('result', $event.target)"
                    />
                  </button>
                  <div v-else class="text-slate-500 text-xs px-3">暂无成果</div>
                </div>
              </figure>
            </div>
          </div>
          <p class="shrink-0 pt-2 text-center text-[11px] text-slate-500">
            参考和成果按原比例同时摆开，不裁切。点某一张可放大。
            <span v-if="!(detailModal.tpl.origin_images || []).length">此配方没有参考图。</span>
          </p>
        </main>

        <!-- 右侧悬浮参数与操作面板 (扩大 20%~30% 字号与按键，全参数透出) -->
        <aside class="w-full lg:w-[460px] xl:w-[500px] border-t lg:border-t-0 lg:border-l border-studio-800 bg-studio-900/95 p-6 flex flex-col justify-between overflow-y-auto shrink-0 shadow-2xl space-y-6">
          <div class="space-y-6">
            <!-- 作品标题与标签 -->
            <div class="space-y-3">
              <label class="text-xs text-slate-400 font-bold block">作品名称 (点击可重命名)：</label>
              <div class="flex items-center space-x-2">
                <input
                  v-model="detailModal.tpl.title"
                  class="w-full bg-studio-950 border border-studio-700 focus:border-studio-accent rounded-xl px-4 py-2.5 text-white font-bold text-sm outline-none transition-colors"
                  @change="confirmRenameTemplate(detailModal.tpl)"
                  placeholder="输入作品标题"
                />
              </div>

              <div class="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span v-if="detailModal.tpl.space" class="px-2.5 py-1 rounded-lg bg-studio-950 text-slate-200 border border-studio-800 font-medium">
                  🏠 空间：{{ tagLabel('space', detailModal.tpl.space) }}
                </span>
                <span v-if="detailModal.tpl.style" class="px-2.5 py-1 rounded-lg bg-studio-950 text-studio-cyan border border-studio-800 font-medium">
                  🎨 风格：{{ tagLabel('style_atom', detailModal.tpl.style) }}
                </span>
                <span v-if="detailModal.tpl.purpose" class="px-2.5 py-1 rounded-lg bg-studio-950 text-purple-300 border border-studio-800 font-medium">
                  🎬 用途：{{ tagLabel('video_purpose', detailModal.tpl.purpose) }}
                </span>
                <span v-if="detailModal.tpl.use_count > 0" class="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono font-bold">
                  🔥 已被复用 {{ detailModal.tpl.use_count }} 次
                </span>
              </div>
            </div>

            <!-- 参数规格卡片网格 (完整透出模型、画幅、分辨率、时长、创建时间) -->
            <div class="space-y-2.5">
              <label class="text-xs text-slate-400 font-bold block">配方关键规格参数：</label>
              <div class="grid grid-cols-2 gap-2.5">
                <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
                  <span class="text-[11px] text-slate-400 block">生成模型</span>
                  <span class="text-xs font-bold text-white block truncate" :title="detailModal.tpl.params?.model || detailModal.tpl.params_json || '官方原生模型'">
                    {{ detailModal.tpl.params?.model || '官方原生模型' }}
                  </span>
                </div>
                <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
                  <span class="text-[11px] text-slate-400 block">画幅比例</span>
                  <span class="text-xs font-bold text-studio-cyan font-mono block">
                    {{ detailModal.tpl.aspect_ratio || detailModal.tpl.params?.ratio || (detailModal.tpl.type === 'video' ? '9:16' : '16:9') }}
                  </span>
                </div>
                <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
                  <span class="text-[11px] text-slate-400 block">渲染分辨率</span>
                  <span class="text-xs font-bold text-white font-mono block">
                    {{ detailModal.tpl.params?.resolution || (detailModal.tpl.type === 'video' ? '480p' : '2K 超清') }}
                  </span>
                </div>
                <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
                  <span class="text-[11px] text-slate-400 block">视频时长</span>
                  <span class="text-xs font-bold text-white font-mono block">
                    {{ detailModal.tpl.params?.duration ? `${detailModal.tpl.params.duration}s` : (detailModal.tpl.type === 'video' ? '15s' : '静态渲染') }}
                  </span>
                </div>
                <div class="col-span-2 p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
                  <span class="text-[11px] text-slate-400 block">真实创作时间</span>
                  <span class="text-xs font-bold text-amber-200 font-mono block">
                    {{ formatTemplateFullTime(detailModal.tpl.created_at || detailModal.tpl.updated_at) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- 提示词展示区 (大字号、复制按钮) -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs text-slate-400 font-bold block">配方提示词 (Prompt)：</label>
                <button
                  type="button"
                  @click="copyRecipePrompt(detailModal.tpl.prompt)"
                  class="px-2.5 py-1 rounded-lg bg-studio-800 hover:bg-studio-700 text-studio-cyan text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border border-studio-700"
                >
                  <StudioIcon name="copy" :size="12" />
                  <span>{{ promptCopied ? '已复制！' : '一键复制提示词' }}</span>
                </button>
              </div>
              <div class="p-4 rounded-xl bg-studio-950 border border-studio-800 text-slate-200 text-xs sm:text-sm leading-relaxed max-h-56 overflow-y-auto scrollbar-thin select-text">
                {{ detailModal.tpl.prompt }}
              </div>
              <p v-if="recipeIsLegacy(detailModal.tpl)" class="text-xs text-amber-400/80">
                提示：此配方为早期系统配方，复用时默认适配至最新稳定版模型。
              </p>
            </div>

            <!-- 🗂️ 关联衍生版本切片 (聚合折叠母本时，可在详情内自由切换对比任一版本) -->
            <div v-if="detailModal.tpl.variants && detailModal.tpl.variants.length > 1" class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-bold text-studio-cyan flex items-center gap-1.5">
                  <span>🗂️ 关联衍生版本 (共 {{ detailModal.tpl.variants.length }} 项)</span>
                </label>
                <span class="text-[11px] text-slate-400">点击查看不同画幅或版本</span>
              </div>
              <div class="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto scrollbar-thin p-1 bg-studio-950 rounded-xl border border-studio-800">
                <div
                  v-for="(v, vIdx) in detailModal.tpl.variants"
                  :key="v.id"
                  @click="selectModalVariant(v)"
                  class="p-1.5 rounded-lg border transition-all cursor-pointer flex flex-col items-center gap-1"
                  :class="detailModal.tpl.id === v.id ? 'border-studio-accent bg-studio-accent/20 ring-1 ring-studio-accent' : 'border-studio-800 hover:border-studio-700 bg-studio-900'"
                >
                  <img
                    v-if="v.result_images?.[0]?.url"
                    :src="v.result_images[0].url"
                    class="w-full h-14 object-cover rounded"
                  />
                  <div class="text-[10px] text-slate-300 font-mono truncate w-full text-center">
                    {{ v.aspect_ratio || v.params?.ratio || '衍生版' }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部操作大按钮 -->
          <div class="pt-4 border-t border-studio-800/80 space-y-3">
            <button
              type="button"
              @click="applyTemplate(detailModal.tpl)"
              class="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-studio-accent via-indigo-500 to-studio-cyan text-white text-sm font-bold shadow-xl hover:brightness-110 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-studio-accent/20"
            >
              <span class="text-base">🚀</span>
              <span>一键复用此配方开始创作</span>
            </button>

            <div class="flex items-center justify-between px-1">
              <button
                type="button"
                @click="deleteTemplate(detailModal.tpl.id)"
                class="text-rose-400 hover:text-rose-300 hover:underline text-xs font-bold cursor-pointer"
              >
                🗑️ 删除此配方
              </button>
              <button
                type="button"
                @click="detailModal.visible = false"
                class="text-slate-400 hover:text-white text-xs font-bold cursor-pointer"
              >
                关闭视窗
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>

    <!-- 6. 全景放大创作库画廊工作台 (Expanded Library Studio) -->
    <div
      v-if="libraryMounted"
      v-show="showExpandedLibrary"
      :class="[
        'fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md transition-all',
        isLibraryFullscreen ? 'p-0' : 'p-3 sm:p-5 lg:p-6'
      ]"
      @click.self="showExpandedLibrary = false"
    >
      <div
        :class="[
          'bg-studio-900 border border-studio-700 shadow-2xl flex flex-col overflow-hidden animate-fade-in transition-all',
          isLibraryFullscreen
            ? 'w-full h-full rounded-none border-none'
            : 'w-full max-w-[97vw] 2xl:max-w-[95vw] h-[95vh] rounded-3xl'
        ]"
      >
        <!-- 弹窗顶部栏 -->
        <div class="px-6 py-4 border-b border-studio-800 flex items-center justify-between bg-studio-950/70 shrink-0">
          <div class="flex items-center space-x-3">
            <div class="w-9 h-9 rounded-xl bg-studio-accent/20 border border-studio-accent/40 flex items-center justify-center text-studio-accent">
              <StudioIcon name="wand" :size="20" />
            </div>
            <div>
              <div class="flex items-center space-x-2">
                <h3 class="text-base font-bold text-slate-100 dark:text-white tracking-wide">灵感创作资产库</h3>
                <span class="text-xs px-2 py-0.5 rounded-full bg-studio-800 text-slate-300 font-mono border border-studio-700">
                  共 {{ templates.length }} 项 · 过滤 {{ filteredTemplates.length }} 项
                </span>
              </div>
              <p class="text-xs text-slate-400">大画幅多维筛选、原图/目标图全景对比、一键复用与资产治理</p>
            </div>
          </div>

          <!-- 右侧操作 -->
          <div class="flex items-center space-x-2 sm:space-x-3">
            <span v-if="pullExternalNotice" class="text-xs px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-500 border border-amber-500/30 animate-pulse font-mono hidden sm:inline-block">
              {{ pullExternalNotice }}
            </span>
            <button
              @click="triggerPullExternal(true)"
              :disabled="isPullingExternal"
              class="px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-700 text-slate-200 text-xs font-bold shadow-xs flex items-center space-x-1.5 cursor-pointer transition-all disabled:opacity-50"
              title="主动拉取外部数据源最新创作配方资产"
            >
              <span :class="{ 'inline-block animate-spin': isPullingExternal }">🔄</span>
              <span>{{ isPullingExternal ? '正在拉取...' : '主动拉取' }}</span>
            </button>
            <button
              @click="openAddTemplateModal"
              class="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-studio-accent hover:brightness-110 text-white text-xs font-bold shadow-md flex items-center space-x-1.5 cursor-pointer transition-all"
            >
              <StudioIcon name="plus" :size="14" />
              <span>新建配方</span>
            </button>
            <button
              @click="toggleLibraryFullscreen"
              class="w-8 h-8 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
              :title="isLibraryFullscreen ? '退出全屏 (还原窗口)' : '全屏最大化显示'"
            >
              <span v-if="!isLibraryFullscreen" class="text-xs font-bold">⛶</span>
              <span v-else class="text-xs font-bold">🗗</span>
            </button>
            <button
              @click="showExpandedLibrary = false"
              class="w-8 h-8 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- 综合多维筛选控制面板 -->
        <div class="px-6 py-3 border-b border-studio-800 bg-studio-900/90 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div class="flex flex-wrap items-center gap-2.5">
            <!-- 模态 Segment: 全部 / 生图 / 生视频 / 生音频 -->
            <div class="flex p-0.5 rounded-xl bg-studio-950 border border-studio-800 text-xs font-bold">
              <button
                v-for="mod in MODALITY_OPTIONS"
                :key="mod.id"
                @click="tplTypeFilter = mod.id"
                class="px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center space-x-1.5"
                :class="tplTypeFilter === mod.id ? 'bg-studio-accent text-white shadow' : 'text-slate-400 hover:text-slate-200'"
              >
                <span>{{ mod.label }}</span>
              </button>
            </div>

            <div class="h-5 w-px bg-studio-800"></div>

            <!-- 空间分类选择 -->
            <div class="flex items-center space-x-1.5">
              <span class="text-xs text-slate-400 font-bold">空间:</span>
              <select
                v-model="tplSpaceFilter"
                class="bg-studio-950 border border-studio-750 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 dark:text-white outline-none font-medium"
              >
                <option value="">全部空间</option>
                <option v-for="sp in tagVocab.space" :key="sp.dir" :value="sp.dir">{{ sp.label }}</option>
              </select>
            </div>

            <!-- 设计风格选择 -->
            <div class="flex items-center space-x-1.5">
              <span class="text-xs text-slate-400 font-bold">风格:</span>
              <select
                v-model="tplStyleFilter"
                class="bg-studio-950 border border-studio-750 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 dark:text-white outline-none font-medium"
              >
                <option value="">全部风格</option>
                <option v-for="st in tagVocab.style_atom" :key="st.dir" :value="st.dir">{{ st.label }}</option>
              </select>
            </div>

            <!-- 仅看常用 -->
            <button
              @click="tplPinnedOnly = !tplPinnedOnly"
              class="px-3 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer"
              :class="tplPinnedOnly ? 'bg-amber-500/20 border-amber-500/60 text-amber-300' : 'bg-studio-950 border-studio-750 text-slate-400 hover:text-white'"
            >
              <span>⭐</span>
              <span>仅看常用</span>
            </button>

            <!-- 🗂️ 聚合衍生版本 开关 -->
            <button
              type="button"
              @click="tplGroupDerivatives = !tplGroupDerivatives"
              class="px-3 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer"
              :class="tplGroupDerivatives ? 'bg-studio-accent/20 border-studio-accent/60 text-studio-cyan shadow-sm shadow-studio-accent/20' : 'bg-studio-950 border-studio-750 text-slate-400 hover:text-white'"
              title="将同源参考图或同一母本的多次衍生版本折叠聚合，避免平铺冗余"
            >
              <span>🗂️</span>
              <span>聚合衍生版本</span>
            </button>
          </div>

          <!-- 搜索框 -->
          <div class="flex items-center bg-studio-950 px-3 py-1.5 rounded-xl border border-studio-750 text-xs text-slate-300 w-64">
            <StudioIcon name="search" :size="14" class="text-slate-400 mr-2 shrink-0" />
            <input
              v-model="tplSearch"
              type="text"
              placeholder="搜索标题、风格、空间或提示词..."
              class="bg-transparent outline-none text-xs w-full text-slate-100 placeholder-slate-500"
            />
            <button v-if="tplSearch" @click="tplSearch = ''" class="text-slate-500 hover:text-slate-300 text-xs">✕</button>
          </div>
        </div>

        <!-- 卡片网格展示区 (Grid 3 列) -->
        <div class="flex-1 overflow-y-auto p-6 scrollbar-thin creation-grid-scroller">
          <!-- 创作库为空 -->
          <div v-if="templates.length === 0" class="h-full flex flex-col items-center justify-center text-center py-16">
            <div class="w-16 h-16 rounded-3xl bg-studio-850 border border-studio-750 flex items-center justify-center text-studio-accent mb-4 shadow-lg">
              <StudioIcon name="wand" :size="32" />
            </div>
            <h3 class="text-base font-bold text-white mb-2">创作库中暂无配方作品</h3>
            <p class="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
              您可以在当前工作台中点击上方【+ 新建配方】手动沉淀，或在 AI 对话完成生图/生视频后，点击结果卡片上的【存入创作库】一键保存。
            </p>
            <button
              @click="openAddTemplateModal"
              class="px-5 py-2.5 rounded-xl bg-studio-accent hover:brightness-110 text-white text-xs font-bold shadow-lg transition-all flex items-center space-x-2 cursor-pointer"
            >
              <StudioIcon name="plus" :size="15" />
              <span>立即新建首个创作配方</span>
            </button>
          </div>

          <!-- 筛选后无结果 -->
          <div v-else-if="filteredTemplates.length === 0" class="h-full flex flex-col items-center justify-center text-center py-16">
            <StudioIcon name="search" :size="32" class="text-slate-500 mb-3" />
            <p class="text-sm font-bold text-slate-300 mb-2">未找到符合当前多维筛选条件的配方</p>
            <p class="text-xs text-slate-500 mb-4">请尝试切换模态分类、重置空间/风格筛选或清除搜索关键词</p>
            <button
              @click="resetTplFilters"
              class="px-4 py-2 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-200 text-xs font-bold cursor-pointer"
            >
              重置所有筛选条件
            </button>
          </div>

          <!-- 按日期分节连续瀑布流 (参照素材库原生体验) -->
          <div v-else class="space-y-6">
            <!-- 顶部折叠手风琴面板 1：⭐ 我的置顶收藏 (置顶板块) -->
            <div v-if="pinnedTemplates.length > 0" class="rounded-2xl border border-studio-accent/40 bg-studio-accent/5 backdrop-blur overflow-hidden transition-all shadow-md">
              <button
                type="button"
                @click="isPinnedOpen = !isPinnedOpen"
                class="w-full px-4 py-3 flex items-center justify-between bg-gradient-to-r from-studio-accent/20 via-studio-accent/5 to-transparent hover:from-studio-accent/30 transition-all text-left cursor-pointer"
              >
                <div class="flex items-center space-x-2.5">
                  <span class="text-base">⭐</span>
                  <h3 class="text-sm font-bold text-indigo-200 tracking-wide">我的置顶收藏</h3>
                  <span class="px-2 py-0.5 text-[10px] font-mono font-bold bg-studio-accent/20 text-studio-accent rounded-full border border-studio-accent/40">
                    {{ pinnedTemplates.length }} 个配方
                  </span>
                  <span class="text-xs text-slate-400 hidden sm:inline">已设为置顶的专属设计模版</span>
                </div>
                <div class="flex items-center space-x-2 text-xs text-slate-400 font-medium">
                  <span>{{ isPinnedOpen ? '点击收起' : '点击展开' }}</span>
                  <span class="transition-transform duration-200" :class="isPinnedOpen ? 'rotate-180' : ''">▼</span>
                </div>
              </button>
              <div v-show="isPinnedOpen" class="p-3.5 border-t border-studio-accent/20 overflow-x-auto scrollbar-thin">
                <div class="flex space-x-3 min-w-max pb-1">
                  <div
                    v-for="tpl in pinnedTemplates"
                    :key="'pin_' + tpl.id"
                    class="rounded-xl bg-studio-850 border border-studio-750 hover:border-studio-accent/70 p-2.5 transition-all shadow-md hover:shadow-xl cursor-pointer group flex flex-col justify-between shrink-0"
                    :style="templateRailCardStyle(tpl)"
                    @click="openTemplateDetail(tpl)"
                  >
                    <div class="relative w-full rounded-lg overflow-hidden bg-black/40 mb-2 border border-studio-800" :style="templateRailMediaStyle(tpl)">
                      <!-- 图片模式 -->
                      <template v-if="!tpl.type || tpl.type === 'image'">
                        <img
                          v-if="tpl.result_images?.[0]?.url"
                          :src="tpl.result_images[0].url"
                          class="w-full h-full object-cover"
                        />
                        <div v-else class="w-full h-full flex items-center justify-center text-xs text-slate-600">无预览</div>
                      </template>
                      <!-- 视频模式 -->
                      <template v-else-if="tpl.type === 'video'">
                        <TemplateVideoCover
                          class="w-full h-full"
                          :poster-url="getVideoPosterUrl(tpl)"
                          :video-url="templateVideoUrl(tpl)"
                          :reference-url="templateRefUrl(tpl)"
                          @measured="noteRailRatio(tpl, $event)"
                        />
                      </template>
                      <!-- 音频模式 -->
                      <template v-else-if="tpl.type === 'audio'">
                        <div class="w-full h-full flex flex-col items-center justify-center bg-emerald-950/30 text-emerald-300 gap-1">
                          <StudioIcon name="music" :size="20" />
                          <span class="text-[10px] font-mono">空间氛围原声</span>
                        </div>
                      </template>

                      <!-- 顶部模态徽章 -->
                      <span class="absolute top-1.5 left-1.5 px-2 py-0.5 rounded text-[10px] font-bold border" :class="getTemplateTypeBadgeClass(tpl)">
                        {{ getTemplateTypeLabel(tpl) }}
                      </span>
                      <!-- 右上角收藏置顶切换按钮 -->
                      <button
                        type="button"
                        class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center bg-amber-500 text-black shadow-amber-500/40 transition-all cursor-pointer z-10 font-bold"
                        title="取消置顶收藏"
                        @click.stop="toggleTemplatePin(tpl)"
                      >
                        <StudioIcon name="star" :size="12" />
                      </button>
                      <span class="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded bg-amber-500/20 text-[10px] font-mono font-bold text-amber-300 border border-amber-500/40">
                        ⭐ 置顶
                      </span>
                    </div>
                    <div class="space-y-1">
                      <h4 class="text-xs font-bold text-slate-100 dark:text-white truncate group-hover:text-studio-accent">{{ tpl.title }}</h4>
                      <p class="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">{{ tpl.prompt }}</p>
                    </div>
                    <div class="pt-2 mt-2 border-t border-studio-800 flex items-center justify-between">
                      <span class="text-[10px] text-slate-400 font-mono">{{ formatTemplateCardTime(tpl.created_at || tpl.updated_at) }}</span>
                      <button
                        type="button"
                        @click.stop="applyTemplate(tpl)"
                        class="px-2.5 py-1 rounded-lg bg-studio-accent/20 hover:bg-studio-accent text-studio-cyan hover:text-white font-bold text-xs transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <span>🚀</span>
                        <span>复用</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 顶部折叠手风琴面板 2：🔥 常用推荐 Top 10 (常用板块) -->
            <div v-if="topReuseTemplates.length > 0" class="rounded-2xl border border-amber-500/30 bg-amber-950/10 backdrop-blur overflow-hidden transition-all shadow-md">
              <button
                type="button"
                @click="isTopReuseOpen = !isTopReuseOpen"
                class="w-full px-4 py-3 flex items-center justify-between bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent hover:from-amber-500/25 transition-all text-left cursor-pointer"
              >
                <div class="flex items-center space-x-2.5">
                  <span class="text-base">🔥</span>
                  <h3 class="text-sm font-bold text-amber-200 tracking-wide">常用推荐 Top 10</h3>
                  <span class="px-2 py-0.5 text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 rounded-full border border-amber-500/40">
                    Top {{ topReuseTemplates.length }}
                  </span>
                  <span class="text-xs text-slate-400 hidden sm:inline">高频设计灵感配方</span>
                </div>
                <div class="flex items-center space-x-2 text-xs text-slate-400 font-medium">
                  <span>{{ isTopReuseOpen ? '点击收起' : '点击展开' }}</span>
                  <span class="transition-transform duration-200" :class="isTopReuseOpen ? 'rotate-180' : ''">▼</span>
                </div>
              </button>
              <div v-show="isTopReuseOpen" class="p-3.5 border-t border-amber-500/20 overflow-x-auto scrollbar-thin">
                <div class="flex space-x-3 min-w-max pb-1">
                  <div
                    v-for="tpl in topReuseTemplates"
                    :key="'top_' + tpl.id"
                    class="rounded-xl bg-studio-850 border border-studio-750 hover:border-amber-400/60 p-2.5 transition-all shadow-md hover:shadow-xl cursor-pointer group flex flex-col justify-between shrink-0"
                    :style="templateRailCardStyle(tpl)"
                    @click="openTemplateDetail(tpl)"
                  >
                    <div class="relative w-full rounded-lg overflow-hidden bg-black/40 mb-2 border border-studio-800" :style="templateRailMediaStyle(tpl)">
                      <!-- 图片模式 -->
                      <template v-if="!tpl.type || tpl.type === 'image'">
                        <img
                          v-if="tpl.result_images?.[0]?.url"
                          :src="tpl.result_images[0].url"
                          class="w-full h-full object-cover"
                        />
                        <div v-else class="w-full h-full flex items-center justify-center text-xs text-slate-600">无预览</div>
                      </template>
                      <!-- 视频模式 -->
                      <template v-else-if="tpl.type === 'video'">
                        <TemplateVideoCover
                          class="w-full h-full"
                          :poster-url="getVideoPosterUrl(tpl)"
                          :video-url="templateVideoUrl(tpl)"
                          :reference-url="templateRefUrl(tpl)"
                          @measured="noteRailRatio(tpl, $event)"
                        />
                      </template>
                      <!-- 音频模式 -->
                      <template v-else-if="tpl.type === 'audio'">
                        <div class="w-full h-full flex flex-col items-center justify-center bg-emerald-950/30 text-emerald-300 gap-1">
                          <StudioIcon name="music" :size="20" />
                          <span class="text-[10px] font-mono">空间氛围原声</span>
                        </div>
                      </template>

                      <!-- 顶部模态徽章 -->
                      <span class="absolute top-1.5 left-1.5 px-2 py-0.5 rounded text-[10px] font-bold border" :class="getTemplateTypeBadgeClass(tpl)">
                        {{ getTemplateTypeLabel(tpl) }}
                      </span>
                      <!-- 右上角收藏置顶切换按钮 -->
                      <button
                        type="button"
                        class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center bg-black/70 hover:bg-black/90 text-slate-300 hover:text-amber-400 border border-white/20 transition-all cursor-pointer z-10"
                        title="收藏置顶此配方"
                        @click.stop="toggleTemplatePin(tpl)"
                      >
                        <StudioIcon name="star" :size="12" />
                      </button>
                      <span class="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded bg-black/80 text-[10px] font-mono font-bold text-amber-300 border border-amber-500/40">
                        🔥 {{ tpl.use_count }}次复用
                      </span>
                    </div>
                    <div class="space-y-1">
                      <h4 class="text-xs font-bold text-slate-100 dark:text-white truncate group-hover:text-amber-200">{{ tpl.title }}</h4>
                      <p class="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">{{ tpl.prompt }}</p>
                    </div>
                    <div class="pt-2 mt-2 border-t border-studio-800 flex items-center justify-between">
                      <span class="text-[10px] text-slate-400 font-mono">{{ formatTemplateCardTime(tpl.created_at || tpl.updated_at) }}</span>
                      <button
                        type="button"
                        @click.stop="applyTemplate(tpl)"
                        class="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-black font-bold text-xs transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <span>🚀</span>
                        <span>复用</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 主时间轴瀑布流标题 (第三段式：常规排序) -->
            <div class="flex items-center space-x-2 pt-2 px-1 text-slate-200 dark:text-slate-100 font-bold text-xs">
              <span>🎨</span>
              <span>常规创作时间轴</span>
              <span class="text-slate-400 font-normal font-mono text-[11px]">按真实创作时间倒序呈现</span>
              <span v-if="regularTemplates.length > 0" class="px-2 py-0.5 text-[10px] font-mono font-bold bg-studio-900 text-slate-300 rounded-full border border-studio-800">
                共 {{ totalRegularTemplates }} {{ tplGroupDerivatives ? '组母本' : '件' }} ({{ regularTemplates.length }}件资产) · 第 {{ tplPage }} / {{ totalTplPages }} 页
              </span>
            </div>

            <div
              v-for="group in templateDateGroups"
              :key="group.dateStr"
              class="space-y-3"
            >
              <!-- 日期分节 Sticky Header (完全参照 LibraryView 原生质感) -->
              <div class="sticky top-0 z-20 -mx-1 px-3.5 py-2 rounded-xl backdrop-blur-md bg-studio-950/85 border border-studio-800/80 flex items-center justify-between shadow-xs">
                <div class="flex items-center space-x-2.5">
                  <span class="w-2 h-2 rounded-full bg-studio-accent shadow-xs shadow-studio-accent/50"></span>
                  <h3 class="text-xs sm:text-sm font-bold text-slate-100 tracking-wide font-sans">
                    {{ group.formattedDate }}
                  </h3>
                  <span v-if="group.weekday" class="text-xs text-slate-400 font-medium">
                    {{ group.weekday }}
                  </span>
                  <span class="px-2 py-0.5 text-[10px] font-mono font-semibold bg-studio-900 text-slate-300 rounded-full border border-studio-750">
                    {{ group.items.length }} 件创作
                  </span>
                </div>
              </div>

              <!-- 当天配方自适应瀑布流 (响应式多列布局) -->
              <div class="gap-4" style="columns: 260px; column-gap: 1rem;">
                <div
                  v-for="tpl in group.items"
                  :key="tpl.id"
                  class="break-inside-avoid mb-4 w-full inline-block rounded-2xl bg-studio-850 border border-studio-750 hover:border-studio-accent/70 transition-all shadow-md hover:shadow-2xl overflow-hidden group/card"
                  :data-tpl-id="tpl.id"
                >
                  <!-- 卡片大预览区域 (自适应画幅，支持多版本横向切换) -->
                  <div
                    class="relative bg-studio-950 overflow-hidden border-b border-studio-800 cursor-pointer"
                    :style="{ aspectRatio: getTemplateAspectRatio(tpl) }"
                    @click="openTemplateDetail(tpl)"
                    title="点击查看配方详情"
                  >
                    <!-- 多版本聚合角标 -->
                    <div
                      v-if="tpl.variants && tpl.variants.length > 1"
                      class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-studio-900/90 text-studio-cyan text-[10px] font-bold border border-studio-accent/40 backdrop-blur-md shadow-md z-10 flex items-center gap-1"
                    >
                      <span>🗂️</span>
                      <span>{{ tpl.variants.length }}个版本</span>
                    </div>

                    <!-- 左右快速翻版按钮 (仅当卡片悬浮且存在多版本时出现) -->
                    <div
                      v-if="tpl.variants && tpl.variants.length > 1"
                      class="absolute inset-y-0 inset-x-1 flex items-center justify-between pointer-events-none opacity-0 group-hover/card:opacity-100 transition-opacity z-10"
                    >
                      <button
                        type="button"
                        @click.stop="stepCardVariant(tpl, -1)"
                        class="w-6 h-6 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center pointer-events-auto transition cursor-pointer text-xs"
                        title="上一个衍生版本"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        @click.stop="stepCardVariant(tpl, 1)"
                        class="w-6 h-6 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center pointer-events-auto transition cursor-pointer text-xs"
                        title="下一个衍生版本"
                      >
                        ›
                      </button>
                    </div>

                    <!-- 底部圆点指示器 -->
                    <div
                      v-if="tpl.variants && tpl.variants.length > 1"
                      class="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 px-1.5 py-0.5 rounded-full backdrop-blur z-10"
                    >
                      <span
                        v-for="(v, vIdx) in tpl.variants"
                        :key="v.id"
                        class="w-1.5 h-1.5 rounded-full transition-all"
                        :class="(tpl.activeVariantIdx || 0) === vIdx ? 'bg-studio-accent scale-125' : 'bg-white/40'"
                      ></span>
                    </div>
                    <!-- 图片模式：展示成果大图 + 角标原图 -->
                    <template v-if="!tpl.type || tpl.type === 'image'">
                      <img
                        v-if="tpl.result_images?.[0]?.url"
                        :src="tpl.result_images[0].url"
                        class="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-300"
                        loading="lazy"
                        decoding="async"
                      />
                      <div v-else class="w-full h-full flex items-center justify-center text-slate-600 text-xs">
                        无渲染成果图
                      </div>

                      <!-- 原图画中画浮窗 -->
                      <div
                        v-if="tpl.origin_images?.[0]?.url"
                        class="absolute bottom-2 left-2 flex items-center space-x-1.5 bg-black/75 backdrop-blur-xs p-1 rounded-lg border border-white/10 hover:border-studio-accent transition-colors z-10"
                        title="点击查看原图"
                        @click.stop="openMediaPreview(tpl.origin_images[0], 'image')"
                      >
                        <span class="text-[9px] text-slate-400 font-bold px-1">原图</span>
                        <img :src="tpl.origin_images[0].url" class="w-8 h-8 rounded object-cover border border-white/20" />
                      </div>
                    </template>

                    <!-- 视频模式：真实首帧缩略图 + 居中播放徽章 + 原图对比浮窗 (不再错用参考图当主图) -->
                    <template v-else-if="tpl.type === 'video'">
                      <div class="w-full h-full relative bg-black/40">
                        <TemplateVideoCover
                          class="w-full h-full"
                          :poster-url="getVideoPosterUrl(tpl)"
                          :video-url="templateVideoUrl(tpl)"
                          :reference-url="templateRefUrl(tpl)"
                          @measured="noteRailRatio(tpl, $event)"
                        />
                        <div
                          v-if="tpl.origin_images?.[0]?.url"
                          class="absolute bottom-2 left-2 flex items-center space-x-1.5 bg-black/75 backdrop-blur-xs p-1 rounded-lg border border-white/10 hover:border-studio-accent transition-colors z-10"
                          title="点击查看输入参考原图"
                          @click.stop="openMediaPreview(tpl.origin_images[0], 'image')"
                        >
                          <span class="text-[9px] text-slate-400 font-bold px-1">原图</span>
                          <img :src="authedMediaUrl(tpl.origin_images[0].url)" class="w-8 h-8 rounded object-cover border border-white/20" />
                        </div>
                      </div>
                    </template>

                    <!-- 音频模式：播放器与波形 -->
                    <template v-else-if="tpl.type === 'audio'">
                      <div class="w-full h-full flex flex-col items-center justify-center p-4 bg-emerald-950/20 space-y-3">
                        <div class="w-12 h-12 rounded-2xl bg-emerald-900/40 border border-emerald-700/50 flex items-center justify-center text-emerald-400 shadow-inner">
                          <StudioIcon name="music" :size="24" />
                        </div>
                        <audio
                          v-if="tpl.result_images?.[0]?.url"
                          :src="tpl.result_images[0].url"
                          controls
                          class="w-full h-9"
                        ></audio>
                        <span class="text-xs text-emerald-300 font-medium font-mono">空间氛围原声</span>
                      </div>
                    </template>

                    <!-- 顶部徽章悬浮条 -->
                    <div class="absolute top-2 left-2 right-2 flex items-center justify-between gap-1.5 pointer-events-none">
                      <div class="flex items-center space-x-1 pointer-events-auto">
                        <!-- 常用/置顶快捷星标 -->
                        <button
                          type="button"
                          @click.stop="toggleTemplatePin(tpl)"
                          class="px-2 py-0.5 rounded-full text-xs font-bold shadow-md flex items-center space-x-1 cursor-pointer transition-all"
                          :class="tpl.is_pinned ? 'bg-amber-500 text-black shadow-amber-500/30' : 'bg-black/60 backdrop-blur text-slate-300 hover:text-amber-300 border border-white/20'"
                          :title="tpl.is_pinned ? '已置顶收藏 (点击取消)' : '收藏置顶'"
                        >
                          <span>⭐</span>
                          <span>{{ tpl.is_pinned ? '已收藏' : '收藏' }}</span>
                        </button>

                        <!-- 模态标签 -->
                        <span
                          class="px-2 py-0.5 rounded-full text-[11px] font-bold backdrop-blur shadow-sm border"
                          :class="getTemplateTypeBadgeClass(tpl)"
                        >
                          {{ getTemplateTypeLabel(tpl) }}
                        </span>
                      </div>

                      <div class="flex items-center space-x-1">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-black/60 backdrop-blur text-slate-300 border border-white/20 font-bold">
                          {{ tpl.aspect_ratio || '16:9' }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- 卡片信息区 -->
                  <div class="p-4 flex-1 flex flex-col space-y-2.5">
                    <!-- 空间/风格标签与创作时间戳行 -->
                    <div class="flex items-center space-x-1.5 text-[11px] flex-wrap gap-y-1">
                      <span v-if="tpl.space" class="px-2 py-0.5 rounded-md bg-studio-950 text-slate-300 border border-studio-800 font-bold">
                        🏠 {{ tagLabel('space', tpl.space) }}
                      </span>
                      <span v-if="tpl.style" class="px-2 py-0.5 rounded-md bg-studio-950 text-studio-cyan border border-studio-800 font-bold">
                        🎨 {{ tagLabel('style_atom', tpl.style) }}
                      </span>
                      <span v-if="tpl.purpose" class="px-2 py-0.5 rounded-md bg-studio-950 text-slate-300 border border-studio-800 font-bold">
                        {{ tagLabel('video_purpose', tpl.purpose) }}
                      </span>
                      <span v-if="formatTemplateCardTime(tpl.created_at || tpl.updated_at)" class="px-2 py-0.5 rounded-md bg-studio-950 text-slate-400 border border-studio-800 font-mono text-[10px] flex items-center space-x-0.5" title="创作具体时间">
                        <span>🕒</span>
                        <span>{{ formatTemplateCardTime(tpl.created_at || tpl.updated_at) }}</span>
                      </span>
                      <div class="flex-1"></div>
                      <span v-if="tpl.use_count > 0" class="text-[11px] text-amber-400 font-mono font-bold flex items-center space-x-1 shrink-0">
                        <span>🔥</span>
                        <span>复用 {{ tpl.use_count }} 次</span>
                      </span>
                    </div>

                    <!-- 标题与编辑 -->
                    <div class="flex items-center justify-between group/title min-h-[26px]">
                      <div v-if="editingTemplateId === tpl.id" class="flex-1 flex items-center space-x-2" @click.stop>
                        <input
                          v-model="editingTemplateTitle"
                          type="text"
                          maxlength="50"
                          class="flex-1 bg-studio-950 border border-studio-accent rounded-lg px-2.5 py-1 text-xs text-white outline-none font-bold"
                          @keydown.enter.prevent="confirmRenameTemplate(tpl)"
                          @keydown.esc="editingTemplateId = ''"
                          autofocus
                        />
                        <button @click.stop="confirmRenameTemplate(tpl)" class="text-emerald-400 hover:text-emerald-300 text-xs font-bold px-2 py-1 bg-emerald-950/40 rounded">保存</button>
                        <button @click.stop="editingTemplateId = ''" class="text-slate-400 hover:text-slate-300 text-xs px-1.5 py-1">取消</button>
                      </div>
                      <div v-else class="flex-1 flex items-center justify-between min-w-0">
                        <h4 class="text-sm font-bold text-slate-100 dark:text-white truncate group-hover/card:text-studio-accent transition-colors" :title="tpl.title">
                          {{ tpl.title }}
                        </h4>
                        <button
                          type="button"
                          @click.stop="startRenameTemplate(tpl)"
                          class="text-slate-400 hover:text-studio-accent transition-colors text-xs p-1 ml-1 cursor-pointer"
                          title="重命名作品"
                        >
                          <StudioIcon name="edit" :size="13" />
                        </button>
                      </div>
                    </div>

                    <!-- 提示词内容 -->
                    <div class="p-2.5 rounded-xl bg-studio-950 border border-studio-800 text-[11px] text-slate-300 leading-relaxed max-h-20 overflow-y-auto scrollbar-thin">
                      {{ tpl.prompt }}
                    </div>

                    <!-- 底部操作按钮：图标删除 + 自适应详情与复用创作（彻底杜绝超宽溢出） -->
                    <div class="pt-2.5 border-t border-studio-800 flex items-center justify-between gap-2 mt-auto">
                      <button
                        type="button"
                        class="w-8 h-8 rounded-lg bg-studio-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-studio-750 hover:border-rose-700/60 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                        @click.stop="deleteTemplate(tpl.id)"
                        title="删除此创作配方"
                      >
                        <StudioIcon name="trash" :size="13" />
                      </button>

                      <div class="flex items-center space-x-2 flex-1 min-w-0 justify-end">
                        <button
                          type="button"
                          class="px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 text-xs font-bold cursor-pointer shrink-0 transition-colors"
                          @click="openTemplateDetail(tpl)"
                        >
                          详情
                        </button>
                        <button
                          type="button"
                          class="px-3 py-1.5 rounded-lg bg-studio-accent hover:brightness-110 text-white text-xs font-bold shadow-md cursor-pointer flex-1 min-w-0 flex items-center justify-center space-x-1 transition-all"
                          @click="applyTemplate(tpl)"
                          title="一键将配方应用到工作台"
                        >
                          <span class="shrink-0">🚀</span>
                          <span class="truncate">复用创作</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 创作库分页控制器 (Pagination Controls) -->
            <div
              v-if="totalRegularTemplates > 0"
              class="mt-6 pt-4 pb-2 border-t border-studio-800 flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <!-- 左侧：数量与每页条数选择 -->
              <div class="flex items-center space-x-3 text-slate-400">
                <span>
                  共 <strong class="text-slate-200 font-mono">{{ totalRegularTemplates }}</strong> {{ tplGroupDerivatives ? '组母本' : '件' }}
                  <span v-if="tplGroupDerivatives && regularTemplates.length !== totalRegularTemplates" class="text-slate-400 font-normal">（折叠包含 {{ regularTemplates.length }} 个版本）</span>
                  <span class="hidden sm:inline">（第 {{ (tplPage - 1) * tplPageSize + 1 }} - {{ Math.min(tplPage * tplPageSize, totalRegularTemplates) }} 项）</span>
                </span>
                <div class="flex items-center space-x-1">
                  <span>每页</span>
                  <select
                    v-model.number="tplPageSize"
                    class="bg-studio-950 border border-studio-750 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none font-mono cursor-pointer"
                  >
                    <option v-for="sz in tplPageSizeOptions" :key="sz" :value="sz">{{ sz }} 项</option>
                  </select>
                </div>
              </div>

              <!-- 右侧：翻页按钮与页码 -->
              <div class="flex items-center space-x-1.5 font-mono">
                <button
                  type="button"
                  @click="goToTplPage(1)"
                  :disabled="tplPage <= 1"
                  class="px-2 py-1 rounded-lg border border-studio-750 bg-studio-950 hover:bg-studio-850 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
                  title="第一页"
                >
                  «
                </button>
                <button
                  type="button"
                  @click="goToTplPage(tplPage - 1)"
                  :disabled="tplPage <= 1"
                  class="px-2.5 py-1 rounded-lg border border-studio-750 bg-studio-950 hover:bg-studio-850 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all font-sans text-xs font-bold"
                >
                  ‹ 上一页
                </button>

                <div class="flex items-center space-x-1 px-1">
                  <button
                    v-for="p in visibleTplPages"
                    :key="'p_' + p"
                    type="button"
                    @click="goToTplPage(p)"
                    class="w-7 h-7 rounded-lg text-xs font-bold transition-all flex items-center justify-center cursor-pointer"
                    :class="p === tplPage ? 'bg-studio-accent text-white shadow' : 'bg-studio-950 border border-studio-750 text-slate-300 hover:bg-studio-850'"
                  >
                    {{ p }}
                  </button>
                </div>

                <button
                  type="button"
                  @click="goToTplPage(tplPage + 1)"
                  :disabled="tplPage >= totalTplPages"
                  class="px-2.5 py-1 rounded-lg border border-studio-750 bg-studio-950 hover:bg-studio-850 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all font-sans text-xs font-bold"
                >
                  下一页 ›
                </button>
                <button
                  type="button"
                  @click="goToTplPage(totalTplPages)"
                  :disabled="tplPage >= totalTplPages"
                  class="px-2 py-1 rounded-lg border border-studio-750 bg-studio-950 hover:bg-studio-850 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
                  title="最后一页"
                >
                  »
                </button>

                <div class="flex items-center space-x-1 pl-2 text-slate-400 font-sans text-xs">
                  <span>跳至</span>
                  <input
                    type="number"
                    min="1"
                    :max="totalTplPages"
                    :value="tplPage"
                    @keydown.enter="jumpToTplPage($event.target.value)"
                    @blur="jumpToTplPage($event.target.value)"
                    class="w-12 px-1.5 py-1 text-center bg-studio-950 border border-studio-750 rounded-lg text-xs text-slate-200 outline-none font-mono"
                  />
                  <span>页</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="retryDialog.visible" class="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4">
      <div class="w-full max-w-md rounded-2xl bg-studio-900 border border-studio-700 p-5 space-y-4">
        <p class="text-sm font-bold text-white">按刚才的提示词、参考图和模型再提交一次。</p>
        <div class="flex gap-2">
          <button type="button" class="flex-1 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" @click="confirmDirectRetry">直接重试</button>
          <button type="button" class="flex-1 py-2 rounded-lg border border-studio-700 text-xs font-bold cursor-pointer" @click="editFromRetryDialog">改为编辑</button>
        </div>
      </div>
    </div>
    <div v-if="retryNotice" class="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4">
      <div class="w-full max-w-md rounded-2xl bg-studio-900 border border-studio-700 p-5 space-y-4">
        <p class="text-sm text-slate-100">已重新提交。视频队列满时可能还会失败，可以稍后再试。</p>
        <button type="button" class="w-full py-2 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" @click="retryNotice = false">知道了</button>
      </div>
    </div>
    <!-- 划词选中快速迁移浮动气泡 -->
    <teleport to="body">
      <div
        v-if="selectionBubble.visible"
        class="fixed z-[9999] -translate-x-1/2 -translate-y-full mb-2 bg-studio-900 border border-studio-700 rounded-xl px-2 py-1.5 shadow-2xl backdrop-blur-md flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-100"
        :style="{ left: selectionBubble.x + 'px', top: selectionBubble.y + 'px' }"
      >
        <button
          type="button"
          @mousedown.prevent="applySelectionPrompt('image')"
          class="px-2.5 py-1 rounded-lg bg-studio-800 hover:bg-studio-700 text-studio-cyan text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-xs border border-studio-700"
        >
          <span>🖼️ 送至生图</span>
        </button>
        <div class="h-3.5 w-px bg-studio-700"></div>
        <button
          type="button"
          @mousedown.prevent="applySelectionPrompt('video')"
          class="px-2.5 py-1 rounded-lg bg-studio-800 hover:bg-studio-700 text-purple-300 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-xs border border-studio-700"
        >
          <span>🎬 送至生视频</span>
        </button>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import StudioIcon from '../../components/StudioIcon.vue';
import { onTaskUpdate, onAssetChange } from '../../service/sse.js';
import { bindOverlays } from '../../service/overlay-stack.js';
import { resolveParams, buildSessionSnapshot, snapshotFromMessage } from '../../utils/studio-params.js';
import DynamicModelParamBar from '../../components/DynamicModelParamBar.vue';
import AssetPickerModal from '../../components/AssetPickerModal.vue';
import StudioViewer from './StudioViewer.vue';
import StudioBottomTray from './StudioBottomTray.vue';
import StudioGlobalDrawer from './StudioGlobalDrawer.vue';
import StudioEditLayer from './StudioEditLayer.vue';
import TemplateVideoCover from './TemplateVideoCover.vue';
import ResultActions from '../../components/ResultActions.vue';
import RequestPreviewModal from '../../components/RequestPreviewModal.vue';
import {
  STUDIO_SKILLS_REGISTRY,
  evaluateClientModelRules,
  normalizeClientLayerStack,
  compilePrecisionEditPrompt,
  getModelPrecisionSpec,
  createWireframeOverlayImage,
  getNearestCanonicalRatio,
  detectMediaSemantics,
  inferOptimalWorkflowAndParams,
  extractDominantScenePalette,
  REGION_COLORS
} from '../../utils/model-protocol';
import {
  getTemplatesCache,
  replaceTemplatesCache,
  mergeTemplatesCache,
  clearTemplatesCache
} from '../../utils/creation-library-cache';
import { contextBudgetTokens, trimChatMessages } from '../../../../src/chat-context.mjs';
import {
  getAssetImageUrl,
  getAssetDownloadUrl,
  resignAssetUrl,
  getToken,
  getCurrentUser,
  authFetch,
  generateAiImage,
  generateAiVideo,
  generateAiAudio,
  generateAiChat,
  fetchChatSessions,
  fetchChatMessages,
  saveChatMessage,
  fetchRecentRefs,
  pushRecentRefs,
  patchChatSession,
  deleteChatSession,
  registerGeneratedAsset,
  superResolveLocalVideo,
  moveAssetShelf,
  reportUnauthorized,
  fetchStudioCatalog,
  previewAiGeneration,
  fetchSuggestPrompts,
  fetchCreationTemplatesIncremental,
  pullExternalCreationTemplates,
  queryGenTask,
  cancelGenJob
} from '../../api';

const props = defineProps({
  initialPayload: { type: Object, default: null }
});

const emit = defineEmits(['sendToPrecisionEdit', 'sendToClip', 'payloadConsumed']);

// 侧栏与基础状态
// 阶段 1 新增状态机
const leftCollapsed = ref(false);
const rightDrawerOpen = ref(false);
const viewerCollapsed = ref(false);
const referenceTray = ref([]); // 真实参考托盘（提前声明，消除下文所有 TDZ 隐患）

// 媒体类型感知与鉴权基础设施（置于顶部，消除下文所有 watch / computed / 模板渲染 TDZ 隐患）
function mediaKind(item) {
  const kind = String(item?.kind || item?.media_type || '').toLowerCase();
  const url = String(item?.url || '');
  if (kind === 'video' || kind === 'audio' || kind === 'music') return kind === 'music' ? 'audio' : kind;
  if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) return 'video';
  if (/\.(mp3|wav|m4a|aac|flac|ogg)(\?|$)/i.test(url)) return 'audio';
  return 'image';
}

// localStorage 不是响应式源：换登录（token 变了）之后，已经渲染过的 <img>/<video> 仍然带着旧 token，
// 在手动刷新前一律 401 破图 —— 这就是「图片又看不到了」。tick 把 token 拉进依赖图。
const mediaAuthTick = ref(0);
function bumpMediaAuth() { mediaAuthTick.value += 1; }

// <img>/<video> 不会带 Authorization 头，/api 媒体一律补 token 查询串，避免 401 变成破图
// 绝对地址（切了 base 后的 http://host:30001/api/...）同样要补，否则换源后立刻掉鉴权
function authedMediaUrl(raw) {
  void mediaAuthTick.value;
  const url = String(raw || '');
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const isApiPath = url.startsWith('/api/') || /^https?:\/\/[^/]+\/api\//i.test(url);
  if (!isApiPath || /[?&]token=/.test(url)) return url;
  const token = getToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

const selectedImageIndex = ref(0);
const showEditModal = ref(false);
const currentEditingImage = computed(() => {
  if (referenceTray.value.length === 0) return null;
  const idx = selectedImageIndex.value >= 0 && selectedImageIndex.value < referenceTray.value.length
    ? selectedImageIndex.value
    : 0;
  return referenceTray.value[idx] || null;
});
const showAtMenu = ref(false);
const atMenuTab = ref('tray'); // 'tray' | 'history'

// 智能提取当前会话历史已生成的全部产物图片（供 @ 悬浮菜单一键直接引用）
const sessionGeneratedImages = computed(() => {
  const list = [];
  const seen = new Set();
  const msgs = messages.value || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role === 'assistant' && msg.imageUrl && (msg.modality === 'image' || !msg.modality)) {
      const url = authedMediaUrl(msg.imageUrl);
      if (!seen.has(url)) {
        seen.add(url);
        list.push({
          url: msg.imageUrl,
          fullUrl: url,
          name: msg.userPrompt ? (msg.userPrompt.slice(0, 16) + '…') : `生成图 #${list.length + 1}`,
          model: msg.model || 'Seedream 5.0 Flash',
          time: msg.startTime || Date.now(),
          assetFid: msg.assetFid || ''
        });
      }
    }
  }
  return list;
});

function formatGenTime(t) {
  if (!t) return '';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 阶段 2 状态：配方句、请求审查与抽屉联动
const recipePrompt = ref('');
// 全局操作配方（风格/换空间/超分/去水印）：独立于图片局部编辑配方，发送时叠加，不互相替换
const globalRecipePrompt = ref('');
// 最终提交/展示用配方 = 图片编辑配方 + 全局操作配方（叠加）
const combinedRecipePrompt = computed(() =>
  [recipePrompt.value, globalRecipePrompt.value].map(s => (s || '').trim()).filter(Boolean).join('\n')
);
const recipeExpanded = ref(false);
const hoveredRegionKey = ref(null);
// 草稿按「用户 + 会话」隔离：以前只有一个用户级单键，任意会话的输入都覆盖同一份，
// 刷新后把 A 会话的草稿恢复进 B 会话，@图N 编号就整体错位（这也是「引用素材失效」的放大器）。
const DRAFT_KEY_PREFIX = (() => {
  const u = getCurrentUser();
  return `ml_studio_draft_v2_${String(u?.username || u?.id || 'anon')}`;
})();
const LEGACY_DRAFT_PREFIX = 'ml_studio_persistent_draft_v1_';
function draftKey(sid) {
  return `${DRAFT_KEY_PREFIX}_${sid || 'none'}`;
}
// 老版本单键草稿：读到就清掉，等第一次选定会话时迁移过去，避免升级瞬间丢字
let pendingLegacyDraft = null;
function readLegacyDraft() {
  try {
    const u = getCurrentUser();
    const key = `${LEGACY_DRAFT_PREFIX}${String(u?.username || u?.id || 'anon')}`;
    const raw = localStorage.getItem(key);
    localStorage.removeItem(key);
    localStorage.removeItem(LEGACY_DRAFT_PREFIX);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    return null;
  }
}

function applyDraftData(data) {
  if (!data || typeof data !== 'object') return false;
  let applied = false;
  if (Array.isArray(data.referenceTray) && data.referenceTray.length > 0) {
    referenceTray.value = data.referenceTray;
    applied = true;
  }
  if (data.recipePrompt) {
    recipePrompt.value = data.recipePrompt;
    applied = true;
  }
  if (data.globalRecipePrompt) {
    globalRecipePrompt.value = data.globalRecipePrompt;
    applied = true;
  }
  if (data.editorHtml && richEditorRef.value) {
    richEditorRef.value.innerHTML = data.editorHtml;
    applied = true;
  }
  if (typeof data.selectedImageIndex === 'number') {
    selectedImageIndex.value = data.selectedImageIndex;
  }
  return applied;
}

function saveDraftToStorage(sid = currentSessionId.value) {
  try {
    const key = draftKey(sid);
    const data = {
      recipePrompt: recipePrompt.value || '',
      globalRecipePrompt: globalRecipePrompt.value || '',
      editorHtml: richEditorRef.value ? richEditorRef.value.innerHTML : '',
      referenceTray: JSON.parse(JSON.stringify(referenceTray.value || [])),
      selectedImageIndex: selectedImageIndex.value || 0,
    };
    if (data.referenceTray.length > 0 || data.recipePrompt || data.globalRecipePrompt || (data.editorHtml && data.editorHtml.trim())) {
      localStorage.setItem(key, JSON.stringify(data));
      pruneDraftStorage(key);
    } else {
      localStorage.removeItem(key);
    }
  } catch (e) {}
}

/** 草稿最多留最近 20 个会话，多的按写入顺序淘汰（localStorage 有 5MB 上限，别被图片流撑爆） */
function pruneDraftStorage(keepKey) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${DRAFT_KEY_PREFIX}_`)) keys.push(k);
    }
    if (keys.length <= 20) return;
    const keep = new Set([keepKey]);
    for (const k of keys) {
      if (keys.length - keep.size <= 20) break;
      if (keep.has(k)) continue;
      localStorage.removeItem(k);
      keep.add(k);
    }
  } catch (e) {}
}

/** 恢复某个会话上次没发出去的输入；老版本单键草稿会在这里被迁到当前会话 */
function restoreDraftForSession(sid) {
  let applied = false;
  try {
    const raw = localStorage.getItem(draftKey(sid));
    if (raw) applied = applyDraftData(JSON.parse(raw));
  } catch (e) {}
  if (!applied && pendingLegacyDraft) {
    applied = applyDraftData(pendingLegacyDraft);
  }
  if (applied) {
    pendingLegacyDraft = null;
    saveDraftToStorage(sid);
    syncGenModeWithReferenceTray();
  }
  return applied;
}

const sessionDrafts = reactive(new Map());
const sessionGeneratingMap = reactive(new Map());
const sessionPlaceholderMap = reactive(new Map());

function sanitizeSnapshotForStorage(snapshot) {
  if (!snapshot) return null;
  try {
    return JSON.parse(JSON.stringify(snapshot, (key, val) => {
      if (typeof val === 'string' && val.startsWith('data:image/') && val.length > 500) {
        return `${val.slice(0, 60)}... [Base64快照(${Math.round(val.length / 1024)}KB)]`;
      }
      return val;
    }));
  } catch (_) {
    return null;
  }
}
const showPreviewModal = ref(false);
const previewModalData = ref(null);
const previewLoading = ref(false);

const targetRefTag = computed(() => {
  if (referenceTray.value.length === 0) return '@图1';
  const idx = selectedImageIndex.value >= 0 && selectedImageIndex.value < referenceTray.value.length
    ? selectedImageIndex.value
    : 0;
  return `@图${idx + 1}`;
});

const targetRefThumb = computed(() => {
  if (referenceTray.value.length === 0) return '';
  const idx = selectedImageIndex.value >= 0 && selectedImageIndex.value < referenceTray.value.length
    ? selectedImageIndex.value
    : 0;
  const it = referenceTray.value[idx];
  return it ? (it.thumbUrl || it.url || '') : '';
});

const targetRefName = computed(() => {
  if (referenceTray.value.length === 0) return '';
  const idx = selectedImageIndex.value >= 0 && selectedImageIndex.value < referenceTray.value.length
    ? selectedImageIndex.value
    : 0;
  const it = referenceTray.value[idx];
  return it ? (it.name || '') : '';
});

const targetRefUrl = computed(() => {
  if (referenceTray.value.length === 0) return '';
  const idx = selectedImageIndex.value >= 0 && selectedImageIndex.value < referenceTray.value.length
    ? selectedImageIndex.value
    : 0;
  const it = referenceTray.value[idx];
  return it ? (it.url || it.preview_url || '') : '';
});

function onDrawerMountRefs(newRefs) {
  if (!Array.isArray(newRefs) || newRefs.length === 0) return;
  const cap = refCap() || 8;
  for (const refItem of newRefs) {
    if (!refItem || !refItem.url) continue;
    const exists = referenceTray.value.some(r => r.url === refItem.url);
    if (!exists) {
      if (referenceTray.value.length >= cap) break;
      const idx = referenceTray.value.length + 1;
      referenceTray.value.push({
        name: refItem.name || `材质_${idx}`,
        url: refItem.url,
        tag: `@图${idx}`,
        thumbUrl: refItem.thumbUrl || refItem.preview_url || refItem.url,
        isRefObject: true,
        origin: 'scheme_material'
      });
    }
  }
}

function onDrawerUnmountMaterialRefs() {
  // 仅清理方案挂载的材质切片，保留用户自己上传或选择的室内主图
  referenceTray.value = referenceTray.value.filter(r => r.origin !== 'scheme_material');
}

function getFullPromptText() {
  const supplement = getRawEditorText();
  const recipe = (combinedRecipePrompt.value || '').trim();
  return [recipe, supplement].filter(Boolean).join('\n');
}

const imageSuggestions = ref([]);
const imageSuggestionsLoading = ref(false);

function applySuggestionToSupplement(text) {
  if (!text) return;
  const existing = getRawEditorText();
  appendRichSegmentText((existing ? ' ' : '') + text.trim());
}

async function loadNextSuggestions(asstMsg) {
  if (!asstMsg || asstMsg.isError || asstMsg.nextSuggestionsLoaded) return;
  asstMsg.nextSuggestionsLoaded = true;
  const text = asstMsg.content || asstMsg.prompt || '';
  if (!text.trim()) return;
  try {
    const res = await fetchSuggestPrompts({
      kind: 'next',
      assistantText: text
    });
    if (res && Array.isArray(res.suggestions) && res.suggestions.length > 0) {
      asstMsg.nextSuggestions = res.suggestions.slice(0, 3);
    }
  } catch (err) {
    console.warn('[suggest-prompts] 加载接续建议失败:', err.message);
  }
}

async function handleSuggestPrompts(promptText) {
  if (typeof promptText === 'string' && promptText.trim()) {
    applySuggestionToSupplement(promptText);
    return;
  }
  // 未带参数说明是用户点击了「按这些图给建议」
  const validImages = referenceTray.value
    .map(r => r.annotatedUrl || r.previewUrl || r.url)
    .filter(Boolean);
  if (!validImages.length) {
    alert('请先在下方看图区添加或选择参考图');
    return;
  }
  imageSuggestionsLoading.value = true;
  imageSuggestions.value = [];
  try {
    const res = await fetchSuggestPrompts({
      kind: 'images',
      images: validImages
    });
    if (res && Array.isArray(res.suggestions) && res.suggestions.length > 0) {
      imageSuggestions.value = res.suggestions.slice(0, 3);
    }
  } catch (err) {
    alert('获取看图建议失败: ' + err.message);
  } finally {
    imageSuggestionsLoading.value = false;
  }
}

function _old_handleSuggestPrompts(promptText) {
  if (!promptText) return;
  const existing = getRawEditorText();
  appendRichSegmentText((existing ? ' ' : '') + promptText);
}

function modelNeedsWireframe(item, modelKey) {
  if (!item || !Array.isArray(item.regions) || item.regions.length === 0) return false;
  const spec = getModelPrecisionSpec(modelKey);
  const hasPolygon = item.regions.some((r) => r.type === 'polygon');
  // 1. 多边形任意选区必须靠线框指示
  if (hasPolygon) return true;
  // 2. 视觉线框标记模型
  if (spec.mode === 'qwen_visual' || spec.supportsVisualMarker) return true;
  // 3. 不支持归一化 BBox 的模型
  if (!spec.supportsNormalizedBbox) return true;
  // 4. 支持 BBox 的模型交付纯净原图
  return false;
}

async function resolveDeliveryImageForModel(item, modelKey) {
  if (!item) return { url: '', isWireframe: false };
  const needsVisual = modelNeedsWireframe(item, modelKey);
  if (needsVisual) {
    if (item.wireframeUrl) {
      return { url: item.wireframeUrl, isWireframe: true };
    }
    // 动态生成线框指示图并缓存，确保交付给模型的图中必须清晰标识线框
    try {
      const generated = await createWireframeOverlayImage(item.url, item.regions);
      if (generated && generated !== item.url) {
        item.wireframeUrl = generated;
        return { url: generated, isWireframe: true };
      }
    } catch (e) {
      console.warn('动态生成交付线框指示图失败:', e);
    }
  }
  return { url: item.url || '', isWireframe: false };
}

async function handlePreviewRequest() {
  const fullPrompt = getFullPromptText();
  if (!fullPrompt) {
    composerError.value = '请先输入配方句或补充细节要求再预览请求';
    return;
  }
  composerError.value = '';
  previewLoading.value = true;
  try {
    const currentMod = activeModality.value;
    const typedTray = JSON.parse(JSON.stringify(referenceTray.value));
    let currentTray = typedTray;
    const currentModel = currentMod === 'chat'
      ? chatModelKey.value
      : (currentMod === 'image' ? imageModelKey.value : (currentMod === 'video' ? videoModelKey.value : musicType.value));

    const sanitizeForPreview = (u) => {
      if (typeof u === 'string' && u.startsWith('data:')) {
        return u.length > 120 ? `${u.slice(0, 80)}...[Base64已脱敏略(${Math.round(u.length / 1024)}KB)]` : u;
      }
      return u;
    };

    const deliveryTray = await Promise.all(currentTray.map(async (it) => {
      const resolved = await resolveDeliveryImageForModel(it, currentModel);
      return {
        ...it,
        deliveryUrl: resolved.url,
        isWireframe: resolved.isWireframe
      };
    }));

    const imageItems = [];
    const seenUrls = new Set();
    deliveryTray.forEach((it, idx) => {
      const u = it.deliveryUrl || it.url;
      if (!u || seenUrls.has(u)) return;
      seenUrls.add(u);
      const is3d = Boolean(it.isRefObject || it.origin === '3d_snapshot');
      imageItems.push({
        tag: it.tag || `@图${imageItems.length + 1}`,
        source: is3d ? '3d_snapshot' : 'stage',
        url: u,
        name: it.name || (is3d ? '3D模型透视参考' : `参考图_${imageItems.length + 1}`),
        isWireframe: Boolean(it.isWireframe),
        isRefObject: is3d,
        relatedImageIndex: it.relatedImageIndex ?? 0
      });
    });

    // 补充尚未直接展平进 referenceTray 的 silentRefs (如 3D 快照等)
    for (const it of currentTray) {
      if (it && Array.isArray(it.silentRefs)) {
        for (const sr of it.silentRefs) {
          if (sr?.url && !seenUrls.has(sr.url)) {
            seenUrls.add(sr.url);
            imageItems.push({
              tag: sr.tag || `@图${imageItems.length + 1}`,
              source: '3d_snapshot',
              url: sr.url,
              name: sr.name || '3D模型透视参考',
              isWireframe: false,
              isRefObject: true,
              relatedImageIndex: sr.sourceImageIndex ?? 0
            });
          }
        }
      }
    }

    const imageUrls = imageItems.map(it => it.url);

    let dialectPrompt = fullPrompt;
    currentTray.forEach((img, idx) => {
      const regionsToCompile = (img?.regions && img.regions.length > 0)
        ? img.regions
        : (referenceTray.value[idx]?.regions || []);
      if (regionsToCompile.length > 0) {
        const res = compilePrecisionEditPrompt({
          rawPrompt: dialectPrompt,
          regions: regionsToCompile,
          imageIndex: idx,
          targetModelKey: currentModel,
        });
        dialectPrompt = res.dialectPrompt;
      }
    });

    const isVideoMode = currentMod === 'video';
    const submitRatio = schemaParams.value.ratio || (isVideoMode ? '9:16' : (selectedRatio.value || '9:16'));
    const previewPayload = {
      prompt: dialectPrompt,
      model: currentModel,
      modality: currentMod,
      ratio: submitRatio,
      imageUrls: imageUrls.map(sanitizeForPreview),
      imageItems: imageItems.map(it => ({
        ...it,
        url: sanitizeForPreview(it.url)
      })),
      params: declaredParams(),
      extras: schemaParams.value || {},
      snippetIds: activeSnippetIds()
    };
    if (!isVideoMode) {
      previewPayload.size = selectedResolution.value || '2K';
    }

    const result = await previewAiGeneration(previewPayload);
    const targetImages = (result && Array.isArray(result.images))
      ? result.images
      : (result?.data && Array.isArray(result.data.images) ? result.data.images : []);

    const enrichedImages = targetImages.map((img, idx) => {
      const raw = imageItems[idx] || deliveryTray[idx] || currentTray[idx];
      const rawUrl = raw?.url || raw?.displayUrl || img.url || '';
      return {
        ...img,
        tag: img.label || img.tag || `@图${idx + 1}`,
        displayUrl: rawUrl,
        fullUrl: rawUrl,
        name: raw?.name || img.name,
        source: raw?.source || img.source,
        isRefObject: raw?.isRefObject ?? img.isRefObject,
        isWireframe: raw?.isWireframe ?? img.isWireframe,
        path: (typeof rawUrl === 'string' && rawUrl.startsWith('data:')) ? '3D透明朝向透视位图快照 (PNG Base64已挂载)' : rawUrl
      };
    });

    if (Array.isArray(result.images)) {
      result.images = enrichedImages;
    } else if (result?.data) {
      result.data.images = enrichedImages;
    }
    previewModalData.value = result;
    showPreviewModal.value = true;
  } catch (err) {
    console.error('预览请求失败:', err);
    composerError.value = err.message || '预览请求生成失败';
  } finally {
    previewLoading.value = false;
  }
}

function onReplace3dModelFromPreview(img) {
  showPreviewModal.value = false;
  let targetIdx = typeof img?.relatedImageIndex === 'number' ? img.relatedImageIndex : 0;
  if (targetIdx >= referenceTray.value.length || targetIdx < 0) {
    targetIdx = 0;
  }
  openEditLayer(targetIdx);
}

function onPreviewSend() {
  showPreviewModal.value = false;
  sendMessage();
}

function openRequestSnapshot(msg) {
  const snapshot = msg.requestSnapshot || msg.params?.outbound || msg.params?.requestSnapshot;
  const realRefs = msg.refs || msg.params?.refs || [];
  const realImages = msg.images || [];

  if (snapshot) {
    const cloned = JSON.parse(JSON.stringify(snapshot));
    if (Array.isArray(cloned.images)) {
      cloned.images = cloned.images.map((img, idx) => {
        const fallbackUrl = realRefs[idx]?.url || realImages[idx] || '';
        const isSanitized = (u) => typeof u === 'string' && u.includes('[Base64');
        const validDisplayUrl = (!isSanitized(img.displayUrl) && img.displayUrl)
          || (!isSanitized(img.fullUrl) && img.fullUrl)
          || (!isSanitized(img.url) && img.url)
          || (!isSanitized(img.path) && img.path)
          || fallbackUrl;
        return {
          ...img,
          displayUrl: validDisplayUrl,
          fullUrl: validDisplayUrl,
          path: (typeof validDisplayUrl === 'string' && validDisplayUrl.startsWith('data:')) ? '3D透明朝向透视位图快照 (PNG Base64已挂载)' : validDisplayUrl
        };
      });
    }
    previewModalData.value = cloned;
    showPreviewModal.value = true;
    return;
  }
  const refs = msg.refs || [];
  const images = (msg.images || refs.map(r => r.url || '')).map((u, i) => ({
    tag: `@图${i + 1}`,
    source: 'history',
    path: String(u || '').split('?')[0],
    fullUrl: String(u || '').split('?')[0]
  }));
  const modelName = msg.model || msg.params?.model || 'Seedream 5.0';
  const mod = msg.modality || 'image';
  const body = {
    model: modelName,
    prompt: msg.content,
    images: images.map(img => img.path),
    size: msg.resolution || msg.params?.resolution || '2K',
    ratio: msg.ratio || msg.params?.ratio || '16:9'
  };
  previewModalData.value = {
    rawPrompt: msg.content,
    dialectPrompt: msg.content,
    images,
    request: {
      endpoint: '/api/gen/' + mod,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ***' },
      body,
      curl: `curl -X POST "/api/gen/${mod}" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $API_KEY" \\\n  -d '${JSON.stringify(body, null, 2)}'`
    }
  };
  showPreviewModal.value = true;
}

function openEditLayer(idx) {
  selectedImageIndex.value = idx;
  showEditModal.value = true;
}

const isRecipeEditing = ref(false);
const recipeInputRef = ref(null);
const editingRecipeText = ref('');
const organizeFlash = ref(false);

const showAdvancedRules = ref(false);
const coreRecipeText = ref('');
const advancedRulesText = ref('');

const displayRecipePrompt = computed(() => {
  if (!recipePrompt.value) return '';
  const { core } = parseRecipePromptParts(recipePrompt.value);
  return core || recipePrompt.value;
});

// 全局操作配方（风格/换空间/超分/去水印）展示文本，独立成块与图片编辑叠加
const displayGlobalRecipePrompt = computed(() => globalRecipePrompt.value || '');

const recipeHasRules = computed(() => {
  if (!recipePrompt.value) return false;
  const { rules } = parseRecipePromptParts(recipePrompt.value);
  return Boolean(rules);
});

function parseRecipePromptParts(full) {
  const text = String(full || '').trim();
  if (!text) return { core: '', rules: '' };
  
  const hasSections = text.includes('【任务目标】') || text.includes('【图片角色约定】') || text.includes('【相机与透视') || text.includes('【透视与结构保持');
  if (!hasSections) {
    return { core: text, rules: '' };
  }

  // 提取核心任务目标
  const taskMatch = text.match(/【任务目标】([\s\S]*?)(?=【保持其余画面|【选区位置|【相机与透视|【透视与结构保持|【摆放朝向|【材质、光影与空间融入|【画面品质|【全局禁止|$)/);
  let core = '';
  if (taskMatch) {
    core = `【任务目标】\n${taskMatch[1].trim()}`;
  } else {
    const parts = text.split(/\n\n+/);
    core = parts[0] || text;
  }
  const rules = text.replace(core, '').trim();
  return { core, rules };
}

function startRecipeEdit() {
  const { core, rules } = parseRecipePromptParts(recipePrompt.value);
  coreRecipeText.value = core || recipePrompt.value || '';
  advancedRulesText.value = rules || '';
  editingRecipeText.value = coreRecipeText.value;
  showAdvancedRules.value = false;
  isRecipeEditing.value = true;
  nextTick(() => {
    if (recipeInputRef.value) {
      recipeInputRef.value.focus();
    }
  });
}

function saveRecipeEdit() {
  const core = (coreRecipeText.value || '').trim();
  const rules = (advancedRulesText.value || '').trim();
  recipePrompt.value = [core, rules].filter(Boolean).join('\n\n');
  isRecipeEditing.value = false;
}

function cancelRecipeEdit() {
  isRecipeEditing.value = false;
  editingRecipeText.value = '';
}

// 清空图片编辑 + 全局编辑两段配方
function clearAllRecipe() {
  recipePrompt.value = '';
  globalRecipePrompt.value = '';
}

function handleOrganizeRecipePrompt() {
  if (!editingRecipeText.value || !editingRecipeText.value.trim()) return;
  editingRecipeText.value = organizePromptText(editingRecipeText.value);
  organizeFlash.value = true;
  setTimeout(() => {
    organizeFlash.value = false;
  }, 1500);
}

function organizePromptText(raw) {
  if (!raw || !raw.trim()) return '';
  let text = raw.trim();

  // 1. 保护 @图N[...] <bbox>...</bbox> 以及 #模板 等胶囊标签，防止被标点拆解或打碎
  const chips = [];
  const chipRegex = /(@(?:图|图片|视频|音频)\d+(?:\[[^\]]*\])?(?:\s*<bbox>[^<]*<\/bbox>)?(?:\s*[\(（][^）\)]*[\)）])?|#[\w\u4e00-\u9fa5\-_]+)/g;
  text = text.replace(chipRegex, (match) => {
    const idx = chips.length;
    chips.push(match);
    return `__CHIP_${idx}__`;
  });

  // 2. 如果已经包含结构化大标题（如【...】），按原结构清理
  if (/【[^】]+】/.test(text)) {
    const sectionRegex = /(【[^】]+】)([\s\S]*?)(?=(?:【[^】]+】)|$)/g;
    let result = '';
    let match;
    while ((match = sectionRegex.exec(text)) !== null) {
      const header = match[1].trim();
      const content = match[2].trim();
      if (!content) continue;

      const rawLines = content.split(/[\n\r]+/);
      const splitItems = [];
      for (const rawLine of rawLines) {
        const trimmed = rawLine.replace(/^(?:[•\-\*]|(?:\d+|[一二三四五六七八九十]+)[\.、\)]\s*)\s*/, '').trim();
        if (!trimmed) continue;
        const subItems = trimmed.split(/[,，;；。、]+/).map(s => s.trim()).filter(Boolean);
        splitItems.push(...subItems);
      }

      const uniqueLines = [];
      const seenLines = new Set();
      for (const item of splitItems) {
        const normalized = item.replace(/^(?:[•\-\*]|(?:\d+|[一二三四五六七八九十]+)[\.、\)]\s*)\s*/, '').replace(/^[,，;；。、\s]+|[,，;；。、\s]+$/g, '').trim();
        if (normalized && !seenLines.has(normalized)) {
          seenLines.add(normalized);
          uniqueLines.push(`• ${normalized}。`);
        }
      }

      if (uniqueLines.length > 0) {
        result += `${header}\n${uniqueLines.join('\n')}\n\n`;
      }
    }

    // 恢复 chips
    chips.forEach((chip, i) => {
      result = result.replace(new RegExp(`__CHIP_${i}__`, 'g'), () => chip);
    });
    return result.trim();
  }

  // 3. 自由散落文本：先剥除每行前导标号与列表符，再按标点提取分句规整
  text = text.replace(/^[•\-\*]\s*|^(\d+|[一二三四五六七八九十]+)[\.、\)]\s*/gm, '');
  const rawClauses = text.split(/[\n\r；;。，,、|]+/)
    .map(c => c.replace(/^[,，;；。、\s]+|[,，;；。、\s]+$/g, '').trim())
    .filter(c => c.length > 0 && !/^\d+$/.test(c));

  const clauses = [];
  const seen = new Set();
  for (const c of rawClauses) {
    if (c && !seen.has(c)) {
      seen.add(c);
      clauses.push(c);
    }
  }

  if (clauses.length === 0) return '';

  const spaceBucket = [];
  const materialBucket = [];
  const compBucket = [];

  const compRegex = /(透视|机位|构图|视角|广角|正交|平视|俯视|仰视|鸟瞰|特写|对称|对齐|比例|画幅|景深|焦距|虚化|触地|接触阴影|空间动线|严禁|禁止|不得|避免|无水印|去水印|无杂物|超写实|高清|4k|8k|masterpiece|真实感|精细|畸变|变形|拉伸|逐像素|同机位|留白)/i;
  const matRegex = /(材质|光照|光影|采光|光线|高光|反光|反射|漫反射|阴影|暗部|质感|纹理|微水泥|木纹|木质|原木|胡桃木|橡木|实木|皮革|皮质|真皮|布艺|绒面|丝绒|亚麻|棉麻|色调|色彩|冷光|暖光|自然光|灯光|吊灯|射灯|筒灯|壁灯|灯带|漫射|大理石|岩板|瓷砖|地砖|木地板|地坪|哑光|亮光|金属|黄铜|不锈钢|玻璃|涂料|艺术漆|乳胶漆)/i;
  const spaceRegex = /(客厅|卧室|餐厅|书房|玄关|厨房|卫生间|阳台|走廊|衣帽间|空间|户型|沙发|茶几|餐桌|餐椅|床|床头柜|衣柜|电视柜|书架|隔断|门|窗|落地窗|背景墙|天花板|吊顶|绿植|盆栽|装饰画|地毯|__CHIP_)/i;

  for (const clause of clauses) {
    if (compRegex.test(clause)) {
      compBucket.push(clause);
    } else if (spaceRegex.test(clause) && !/(材质|光照|采光|光线|高光|反光|反射|漫反射|色调|冷光|暖光|自然光|灯光)/.test(clause)) {
      spaceBucket.push(clause);
    } else if (matRegex.test(clause)) {
      materialBucket.push(clause);
    } else {
      spaceBucket.push(clause);
    }
  }

  const sections = [];
  if (spaceBucket.length > 0) {
    sections.push(`【空间与主体】\n${spaceBucket.map(l => `• ${l}。`).join('\n')}`);
  }
  if (materialBucket.length > 0) {
    sections.push(`【材质与光照】\n${materialBucket.map(l => `• ${l}。`).join('\n')}`);
  }
  if (compBucket.length > 0) {
    sections.push(`【构图与约束】\n${compBucket.map(l => `• ${l}。`).join('\n')}`);
  }

  let formatted = sections.join('\n\n');
  chips.forEach((chip, i) => {
    formatted = formatted.replace(new RegExp(`__CHIP_${i}__`, 'g'), () => chip);
  });

  return formatted;
}

function highlightRegionFromChip(imgIdx, regionName) {
  const targetImg = referenceTray.value[imgIdx];
  if (!targetImg || !Array.isArray(targetImg.regions)) return;
  const found = targetImg.regions.find(r => r.name === regionName || r.name.includes(regionName) || regionName.includes(r.name));
  if (found) {
    hoveredRegionKey.value = `${imgIdx}_${found.id}`;
  }
}

function parseRecipeSegments(text) {
  if (!text) return [];
  const segments = [];
  const regex = /(@(?:图|图片|视频|音频)\d+(?:\[[^\]]+\])?)/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', text: text.slice(lastIdx, match.index) });
    }
    const fullTag = match[1];
    const m = fullTag.match(/@(?:图|图片)(\d+)(?:\[([^\]]+)\])?/);
    const tuNum = m ? Number(m[1]) : 1;
    const regionName = m ? m[2] : null;
    segments.push({
      type: 'chip',
      tag: fullTag,
      tuNum,
      regionName,
      key: regionName ? `${tuNum - 1}_${regionName}` : null
    });
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIdx) });
  }
  return segments;
}

function syncAggregatedRecipePrompt() {
  if (isRecipeEditing.value) return;
  const recipes = [];
  referenceTray.value.forEach((item, idx) => {
    // 3D 截图自身不需要提供独立的 recipe
    if (item.isRefObject || item.origin === '3d_snapshot') return;
    if (item.recipe && item.recipe.trim()) {
      recipes.push({ idx, recipe: item.recipe.trim() });
    }
  });
  if (recipes.length === 0) {
    recipePrompt.value = '';
    return;
  }

  // 1. 若仅有单张主图的结构化配方，完整保留其工业级多段式结构（图片角色、相机透视、朝向、光影融入、全局禁令等）
  if (recipes.length === 1) {
    recipePrompt.value = recipes[0].recipe;
    return;
  }

  // 2. 若有多张主图，先检查是否已包含结构化段落；若是则按场景清晰分节，若非则聚合项目符号
  const hasStructuredSection = recipes.some(r => r.recipe.includes('【图片角色约定】') || r.recipe.includes('【任务目标】') || r.recipe.includes('【相机与透视'));
  if (hasStructuredSection) {
    recipePrompt.value = recipes.map((r, i) => `### 编辑场景 ${i + 1}\n${r.recipe}`).join('\n\n');
    return;
  }

  const bulletLines = [];
  const seenLines = new Set();
  recipes.forEach(r => {
    const lines = r.recipe.split('\n');
    lines.forEach(l => {
      const trimmed = l.trim();
      if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.includes('[区域') || trimmed.includes('改为') || trimmed.includes('替换为')) {
        const formatted = trimmed.startsWith('•') ? trimmed : `• ${trimmed}`;
        // 行级严格去重，消除任何重复生成
        if (!seenLines.has(formatted)) {
          seenLines.add(formatted);
          bulletLines.push(formatted);
        }
      }
    });
  });
  if (bulletLines.length > 0) {
    const title = recipes.length > 1 ? '【空间组合编辑方案】' : '【空间局部编辑方案】';
    recipePrompt.value = `${title}\n${bulletLines.join('\n')}\n要求：保持空间整体结构、主要动线与光影一致。框外保持原图像素。`;
  } else {
    recipePrompt.value = recipes.map(r => r.recipe).join('\n\n');
  }
}

const autoAdaptiveNotice = ref('');
let autoAdaptiveNoticeTimer = null;
function triggerAdaptiveNotice(msg) {
  if (!msg) return;
  autoAdaptiveNotice.value = msg;
  if (autoAdaptiveNoticeTimer) clearTimeout(autoAdaptiveNoticeTimer);
  autoAdaptiveNoticeTimer = setTimeout(() => {
    autoAdaptiveNotice.value = '';
  }, 4500);
}

// 参数治理共存开关：默认严格 9:16、只有用户手动改才变。
// 不删自适应代码，只在外层短路，完整保留另一会话加的 ratioUserLocked / fieldByKey(size) 守卫。
// 需要临时恢复「挂参考图自动推断画幅」时把这两个常量改回 true 即可。
const AUTO_ADAPT_RATIO = false;
const AUTO_ADAPT_SIZE = false;

function dispatchSmartWorkflow({ force = false, fromTemplate = null, source = 'general' } = {}) {
  const result = inferOptimalWorkflowAndParams({
    referenceTray: referenceTray.value,
    selectedImageIndex: selectedImageIndex.value,
    currentModality: activeModality.value,
    currentGenMode: activeGenMode.value,
    currentSchema: currentSchema.value,
    currentParams: schemaParams.value || {},
    templateMeta: fromTemplate,
  });

  // 1. 模态调度：挂载媒体素材或复用配方时自动切换至最合适板块
  if (result.targetModality && result.targetModality !== activeModality.value) {
    activeModality.value = result.targetModality;
  }

  // 2. 子模式自适应调度
  if (result.targetGenMode && result.targetGenMode !== activeGenMode.value) {
    setGenMode(result.targetGenMode);
  }

  // 3. 画幅比例自适应调度 (Ratio)：优先保护底图真实比例，杜绝 9:16 / 3:4 竖屏被 16:9 / 1:1 压扁
  //    但用户在参数条上手选过画幅后不再自动顶回去（force 仅用于复用配方这类显式覆盖场景）
  //    共存开关：默认关闭「挂参考图/切模型自动改写画幅」，只有用户手动改才变。
  //    保留下方全部守卫（ratioUserLocked / isFieldLocked / fieldByKey(size)），
  //    不删另一个会话的修复代码；将来想恢复自适应只需把 AUTO_ADAPT_* 改回 true。
  if (AUTO_ADAPT_RATIO && result.targetRatio && (!ratioUserLocked.value || force) && (!isFieldLocked('ratio') || force)) {
    selectedRatio.value = result.targetRatio;
    if (schemaParams.value) {
      schemaParams.value.ratio = result.targetRatio;
    }
  }

  // 4. 分辨率档位自适应调度 (Size / Resolution)
  //    契约没有 size 字段的模型（GPT Image VIP 系列）按画幅出图，这里不能把 suggestedSize
  //    写进全局 selectedResolution —— 那个值用户看不见，却会被当成 size 发给上游并触发 400。
  if (AUTO_ADAPT_SIZE && result.targetSize && !isFieldLocked('size') && fieldByKey(currentSchema.value, 'size')) {
    selectedResolution.value = result.targetSize;
    if (schemaParams.value && schemaParams.value.size !== undefined) {
      schemaParams.value.size = result.targetSize;
    }
  }
  if (AUTO_ADAPT_SIZE && result.targetVideoResolution && !isFieldLocked('resolution')) {
    videoResolution.value = result.targetVideoResolution;
    if (schemaParams.value && schemaParams.value.resolution !== undefined) {
      schemaParams.value.resolution = result.targetVideoResolution;
    }
  }

  // 5. 友好自适应提示
  if (Array.isArray(result.reasons) && result.reasons.length > 0) {
    triggerAdaptiveNotice(result.reasons[0]);
  }
}

function syncGenModeWithReferenceTray() {
  if (isApplyingTemplate) return;
  const schema = currentSchema.value;
  if (!schema || !schema.modes || !schema.modes.length) return;
  const modes = schema.modes;
  const tray = referenceTray.value || [];
  const imgCount = tray.filter(it => !it.kind || it.kind === 'image').length;

  if (imgCount === 0) {
    if (activeGenMode.value !== 'text_to_image' && modes.some(m => m.id === 'text_to_image')) {
      setGenMode('text_to_image');
    }
    return;
  }

  // 有图状态下：禁止停留在文生图
  const hasRegions = tray.some(img => Array.isArray(img.regions) && img.regions.length > 0)
    || Boolean(recipePrompt.value?.trim())
    || Boolean(globalRecipePrompt.value?.trim());
  const hasOutpaint = tray.some(img => img.outpainted);

  if (hasOutpaint && modes.some(m => m.id === 'expand_fill')) {
    setGenMode('expand_fill');
  } else if (hasRegions && modes.some(m => m.id === 'image_edit')) {
    setGenMode('image_edit');
  } else if (imgCount === 1) {
    const target = modes.some(m => m.id === 'image_to_image')
      ? 'image_to_image'
      : (modes.some(m => m.id === 'image_reference') ? 'image_reference' : modes.find(m => m.id !== 'text_to_image')?.id);
    if (target && (activeGenMode.value === 'text_to_image' || !modes.some(m => m.id === activeGenMode.value))) {
      setGenMode(target);
    }
  } else if (imgCount > 1) {
    const target = hasRegions && modes.some(m => m.id === 'image_edit')
      ? 'image_edit'
      : (modes.some(m => m.id === 'image_reference') ? 'image_reference' : (modes.some(m => m.id === 'image_to_image') ? 'image_to_image' : modes[0]?.id));
    if (target && (activeGenMode.value === 'text_to_image' || !modes.some(m => m.id === activeGenMode.value))) {
      setGenMode(target);
    }
  }

  // 执行自适应联动
  dispatchSmartWorkflow({ source: 'syncGenMode' });
}

function onEditApplyRegionsToImage({ imageIndex, regions, recipe, silentRefs, annotations, wireframeDataUrl, baseAttrRefs, newRefs, naturalWidth, naturalHeight, canonicalRatio }) {
  const target = referenceTray.value[imageIndex];
  if (target) {
    target.regions = regions;
    target.annotations = annotations;
    if (naturalWidth && naturalHeight) {
      target.naturalWidth = naturalWidth;
      target.naturalHeight = naturalHeight;
      target.width = naturalWidth;
      target.height = naturalHeight;
    }
    if (baseAttrRefs && Array.isArray(baseAttrRefs)) {
      const mappedRefs = [];
      for (const item of baseAttrRefs) {
        if (!item || !item.rel) continue;
        const rel = String(item.rel);
        const mSwatch = rel.match(/cache\/base-library\/paints\/([^\/]+)\/swatch\.png$/);
        const mBasecolor = rel.match(/cache\/base-library\/materials\/([^\/]+)\/basecolor\.jpg$/);
        if (item.kind === 'swatch' && mSwatch) {
          mappedRefs.push({
            kind: 'swatch',
            path: `/api/base-library/paints/${mSwatch[1]}/swatch`
          });
        } else if (item.kind === 'basecolor' && mBasecolor) {
          const tintQuery = (item.tinted && item.hex)
            ? `?hex=${encodeURIComponent(String(item.hex).replace('#', ''))}`
            : '';
          mappedRefs.push({
            kind: 'basecolor',
            path: `/api/base-library/materials/${mBasecolor[1]}/basecolor${tintQuery}`
          });
        }
      }
      target.baseAttrRefs = mappedRefs;
      target.silentRefs = [];
      target.wireframeUrl = null;
    } else {
      target.silentRefs = silentRefs;
      target.wireframeUrl = wireframeDataUrl || null;
    }
    if (recipe) {
      target.recipe = recipe;
    }
  }

  // 挂载 3D 朝向截图等真实新参考图
  if (Array.isArray(newRefs) && newRefs.length > 0) {
    for (const ref of newRefs) {
      const exists = referenceTray.value.some((it) => it.url === ref.url);
      if (!exists) {
        const nextIdx = referenceTray.value.length + 1;
        const tag = ref.tag || `@图${nextIdx}`;
        referenceTray.value.push({
          name: ref.name || `3D参考_${nextIdx}`,
          url: ref.url,
          tag,
          kind: 'image',
          weight: 85,
          origin: ref.origin || '3d_snapshot',
          isRefObject: true,
          relatedImageIndex: imageIndex,
          sourceRegionId: ref.targetRegionId || ref.sourceRegionId
        });
      }
    }
  }

  // 画幅不再跟随底图自动改写：默认严格 9:16，只有用户手动改才变。
  // naturalWidth / naturalHeight 仍由 autoSyncRatioFromImage 记录，供提示词编译与选区使用。
  if (activeModality.value !== 'image') activeModality.value = 'image';
  nextTick(() => {
    setGenMode('image_edit');
    syncAggregatedRecipePrompt();
    dispatchSmartWorkflow({ force: true, source: 'edit_apply_regions' });
  });
}

function onEditApplyRecipeWithRefs({ recipe, newRefs }) {
  if (recipe) {
    const mainImg = referenceTray.value[0];
    if (mainImg) {
      mainImg.recipe = recipe;
    } else {
      recipePrompt.value = recipe;
    }
    syncAggregatedRecipePrompt();
  }
  if (Array.isArray(newRefs) && newRefs.length > 0) {
    for (const ref of newRefs) {
      const exists = referenceTray.value.some((it) => it.url === ref.url);
      if (!exists) {
        const nextIdx = referenceTray.value.length + 1;
        const tag = ref.tag || `@图${nextIdx}`;
        referenceTray.value.push({
          name: ref.name || `3D参考_${nextIdx}`,
          url: ref.url,
          tag,
          kind: 'image',
          weight: 85,
          origin: ref.origin || '3d_snapshot',
          isRefObject: true,
          relatedImageIndex: 0
        });
      }
    }
  }
  syncGenModeWithReferenceTray();
}

function onEditApplyOutpaintedImage({ imageIndex, url }) {
  const target = referenceTray.value[imageIndex];
  if (target) {
    if (!target.originalUrl) {
      target.originalUrl = target.url;
    }
    target.url = url;
    target.outpainted = true;
  }
}

function onEditApplyCustomImage({ imageIndex, dataUrl }) {
  const target = referenceTray.value[imageIndex];
  if (target) {
    if (!target.originalUrl) {
      target.originalUrl = target.url;
    }
    target.url = dataUrl;
    target.annotated = true;
  }
}

function onRevertAnnotation(imageIndex) {
  const target = referenceTray.value[imageIndex];
  if (target && target.originalUrl) {
    target.url = target.originalUrl;
    target.annotated = false;
    target.outpainted = false;
  }
}

function onTraySelect(idx) {
  selectedImageIndex.value = idx;
  if (viewerCollapsed.value) {
    viewerCollapsed.value = false;
  }
}

function getRegionOpDisplayName(op) {
  if (op === 'replace') return '3D替换';
  if (op === 'add') return '增加陈设';
  if (op === 'recolor') return '基础属性';
  if (op === 'erase') return '智能消除';
  return '定制空间';
}

function toggleAtMentionMenu() {
  if (referenceTray.value.length > 0 || sessionGeneratedImages.value.length > 0) {
    showAtMenu.value = !showAtMenu.value;
    if (showAtMenu.value) {
      atMenuTab.value = referenceTray.value.length > 0 ? 'tray' : 'history';
      saveEditorSelection();
    }
  } else {
    // 托盘与会话产物均为空，唤起素材挂载器
    openAssetSelectorModal();
  }
}

function selectAtMention(item, idx) {
  showAtMenu.value = false;
  hoveredRegionKey.value = null;
  insertChipToEditor(item, `@图${idx + 1}`);
}

function selectGeneratedImageMention(genItem) {
  if (!genItem || !genItem.url) return;
  // 检查是否已经在看图区托盘中，避免重复冗余
  let idx = referenceTray.value.findIndex(r => r.url === genItem.url || (genItem.assetFid && r.fid === genItem.assetFid));
  if (idx < 0) {
    idx = referenceTray.value.length;
    referenceTray.value.push({
      name: genItem.name || `产物图${idx + 1}`,
      url: genItem.url,
      thumbUrl: genItem.fullUrl || genItem.url,
      tag: `@图${idx + 1}`,
      origin: 'generation',
      fid: genItem.assetFid || ''
    });
    viewerCollapsed.value = false;
    selectedImageIndex.value = idx;
  }
  const item = referenceTray.value[idx];
  showAtMenu.value = false;
  hoveredRegionKey.value = null;
  insertChipToEditor(item, `@图${idx + 1}`);
}

function selectAtRegionMention(item, idx, reg) {
  showAtMenu.value = false;
  hoveredRegionKey.value = null;
  const tag = `@图${idx + 1}[${reg.name}]`;
  const regionKey = `${idx}_${reg.id}`;
  insertChipToEditor(item, tag, regionKey);
}

const sidebarTab = ref('history'); // 'history' | 'library'
// 严格隔离后不能让所有账号共用 default_session：非 admin 账号用带用户名的默认会话 id，
// 否则第二个用户登录时会撞上属于 admin 的会话而 403。
const currentSessionId = ref((() => {
  const u = getCurrentUser();
  const who = String(u?.username || u?.id || '');
  return (who && who !== 'admin') ? `default_${who}` : 'default_session';
})());
const tplSearch = ref('');
const generating = ref(false);
// 当前会话是否在生成。后台队列支持跨会话并行：A 会话渲染时切到 B / 新建会话，
// 输入区与「立即生成」必须照常可用，不能沿用全局 generating 单例。
const currentGenerating = computed(() => {
  const sid = currentSessionId.value;
  return Boolean(sid && (sessionGeneratingMap.get(sid) || sessionPlaceholderMap.has(sid)));
});
const optimizing = ref(false);
const optimizeUndo = ref(null);
const showHashMenu = ref(false);
const showAssetSelector = ref(false);
const richEditorRef = ref(null);

// 语音录制与 FunASR 9000 转写状态
const isRecording = ref(false);
const recordingDuration = ref(0);
const isTranscribing = ref(false);
let mediaRecorder = null;
let audioChunks = [];
let recordTimer = null;
let recordingStream = null;

async function toggleVoiceRecording() {
  if (isRecording.value) {
    stopVoiceRecording();
  } else {
    await startVoiceRecording();
  }
}

async function startVoiceRecording() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('当前浏览器环境不支持麦克风录音，请使用现代浏览器并通过 HTTPS 或本地访问');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingStream = stream;
    audioChunks = [];

    let mimeType = '';
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      }
    }

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const recordedBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      if (recordingStream) {
        recordingStream.getTracks().forEach(t => t.stop());
        recordingStream = null;
      }
      if (recordedBlob.size > 0) {
        await submitVoiceAudio(recordedBlob);
      }
    };

    mediaRecorder.start();
    isRecording.value = true;
    recordingDuration.value = 0;
    recordTimer = setInterval(() => {
      recordingDuration.value += 1;
    }, 1000);
  } catch (err) {
    console.error('获取麦克风权限失败:', err);
    alert('无法访问麦克风，请检查浏览器权限设置: ' + (err.message || err));
  }
}

function stopVoiceRecording() {
  if (recordTimer) {
    clearInterval(recordTimer);
    recordTimer = null;
  }
  isRecording.value = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function normalizeSpeechRefMentions(str) {
  if (!str) return '';
  const numMap = { '一': '1', '二': '2', '两': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };
  return str.replace(/(?:第\s*([一二两三四五六七八九十\d]+)\s*张\s*(?:图|图片)?|图片\s*([一二两三四五六七八九十\d]+)|图\s*([一二两三四五六七八九十\d]+))/g, (m, p1, p2, p3) => {
    const raw = p1 || p2 || p3;
    const n = numMap[raw] || raw;
    return `@图${n}`;
  });
}

async function submitVoiceAudio(blob) {
  isTranscribing.value = true;
  try {
    const formData = new FormData();
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    formData.append('file', blob, `voice_recording.${ext}`);
    formData.append('model', 'sensevoice');
    formData.append('language', 'zh');
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/asr/transcribe?clean=1', {
      method: 'POST',
      headers,
      body: formData
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ASR识别失败(${res.status}): ${errText}`);
    }
    const data = await res.json();
    // 优先采用口语净化后的有效文本；若净化后为空（如用户仅说了"嗯嗯"等语气词），回退采用 raw_text 兜底，杜绝吞字
    const cleanedText = (data.text || '').trim();
    const rawText = (data.raw_text || '').trim();
    const text = cleanedText || rawText || (data.result || data.transcription || (typeof data === 'string' ? data : '')).trim();
    if (text) {
      // 智能把语音中的“图一/图1/图片一/第1张图”归一化为 @图N 标
      const normalizedSpeechText = normalizeSpeechRefMentions(text);
      const current = richEditorRef.value ? richEditorRef.value.innerText.trim() : '';
      appendRichSegmentText((current ? ' ' : '') + normalizedSpeechText);
      // 若包含 @图N，即时触发实体芯片化解析
      if (editorHasRawMention()) {
        reparseEditorChips([]);
      }
    }
  } catch (err) {
    console.error('语音转写异常:', err);
    alert('语音转写失败: ' + (err.message || err));
  } finally {
    isTranscribing.value = false;
  }
}
const messageScroller = ref(null);
const sessionRefPool = ref([]);

// 核心底栏 4 模态：'chat' (纯对话) | 'image' (图片生成) | 'video' (视频生成) | 'music' (音乐生成)
const activeModality = ref('chat'); // 默认纯对话！

// 纯对话专属状态
const chatModelKey = ref('gemini_4_argon');
// 思考强度：取值由当前模型在官方目录声明的 caps.reasoning 决定
const thinkingStrength = ref('');
const expandedThinking = ref({});

// 图像模式专属参数
const imageModelKey = ref('gemini_3_1_flash_image');
const selectedResolution = ref('2K');
const selectedRatio = ref('9:16');
const selectedStylePreset = ref('default');
const imageWatermark = ref(false);

function autoSyncRatioFromImage(url, item = null) {
  if (!url || typeof url !== 'string') return;
  const targetItem = item || referenceTray.value.find(r => r.url === url) || referenceTray.value[selectedImageIndex.value] || referenceTray.value[0];
  const isVideo = targetItem?.kind === 'video' || /\.(mp4|mov|webm)$/i.test(url);

  if (isVideo) {
    if (typeof document !== 'undefined') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        if (vw > 0 && vh > 0) {
          if (targetItem) {
            targetItem.naturalWidth = vw;
            targetItem.naturalHeight = vh;
            targetItem.width = vw;
            targetItem.height = vh;
          }
          // 只记录媒体真实尺寸，不再触发画幅自适应调度。
        }
      };
      v.src = url;
    }
    return;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (nw > 0 && nh > 0) {
      if (targetItem) {
        targetItem.naturalWidth = nw;
        targetItem.naturalHeight = nh;
        targetItem.width = nw;
        targetItem.height = nh;
      }
      // 只记录媒体真实尺寸，不再触发画幅自适应调度。
    }
  };
  img.src = url;
}

// 视频模式专属参数
const videoSubMode = ref('first_last'); // 'first_last' | 'multi_ref' | 'prompt_only'
const videoModelKey = ref('seedance2_0');
const videoDuration = ref('5');
const videoResolution = ref('720px2（超分）');
// 旧版会话快照里存的是内部档位名（720p_sr2x），新契约只认 720px2（超分）这类标签，
// 恢复快照时统一归一化，避免把失效档位写回参数条
const VIDEO_RES_LEGACY_ALIAS = {
  '480p_sr2x': '480px2（超分）',
  '720p_sr2x': '720px2（超分）',
  '1080p_sr2x': '1080px2（超分）',
};
function normalizeVideoResolution(value) {
  const raw = String(value || '').trim();
  return VIDEO_RES_LEGACY_ALIAS[raw] || raw;
}

// 音乐模式专属参数
const musicType = ref('doubao_bgm_v5');
const musicDuration = ref('30');
const studioSchemas = ref({});
const studioModels = ref({
  chat: [],
  image: [],
  video: [],
  music: []
});

// ---- 模型按「提供商 · 模型族」两级分组（原生 optgroup，无需自绘下拉） ----
function groupModelsByProvider(models) {
  const groups = [];
  const index = new Map();
  for (const m of models || []) {
    const provider = m.providerGroup || m.providerName || '其他';
    const family = m.familyName || '';
    const label = family ? `${provider} · ${family}` : provider;
    if (!index.has(label)) {
      index.set(label, { label, models: [] });
      groups.push(index.get(label));
    }
    index.get(label).models.push(m);
  }
  return groups;
}
const chatModelGroups = computed(() => groupModelsByProvider(studioModels.value.chat));
const imageModelGroups = computed(() => groupModelsByProvider(studioModels.value.image));
const videoModelGroups = computed(() => groupModelsByProvider(studioModels.value.video));
const musicModelGroups = computed(() => groupModelsByProvider(studioModels.value.music));
const currentModelList = computed(() => studioModels.value[activeModality.value] || []);

const currentChatModel = computed(() => (studioModels.value.chat || []).find((m) => m.id === chatModelKey.value) || null);
const chatReasoningCaps = computed(() => currentChatModel.value?.reasoning || null);
const THINKING_LABELS = { off: '关闭', on: '开启', none: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' };
function thinkingLevelLabel(level) {
  return THINKING_LABELS[level] || level;
}
watch(chatReasoningCaps, (caps) => {
  thinkingStrength.value = caps && caps.supported ? (caps.default || caps.levels?.[0] || '') : '';
}, { immediate: true });
// 兜底拆分：部分上游（如 Gemma）把 <thought> 混在正文里，服务端未拆分时客户端再拆一次
function splitClientThinking(content, reasoning) {
  let think = typeof reasoning === 'string' ? reasoning : '';
  let text = typeof content === 'string' ? content : '';
  const take = (inner) => {
    const t = (inner || '').trim();
    if (t) think = think ? `${think}\n${t}` : t;
  };
  text = text.replace(/<(thought|thinking)>([\s\S]*?)<\/\1>/gi, (_, __, inner) => { take(inner); return ''; });
  const open = text.match(/<(thought|thinking)>([\s\S]*)$/i);
  if (open) { take(open[2]); text = text.replace(/<(thought|thinking)>[\s\S]*$/i, ''); }
  return { content: text.trim(), thinking: think.trim() };
}

// 助手正文按 Markdown 渲染：marked 解析 + DOMPurify 净化，再组装成「可选中、可分段复制」的文本块。
// 分块规则：h1–h4 按层级嵌套成卡片（标题即卡片头），代码块/引用/表格各自独立成块，
// 每块一个复制按钮；点击只写入构建期算好的纯文本，不依赖 innerText 的渲染态。
marked.setOptions({ gfm: true, breaks: true });
// 所有外链安全地在新标签打开（DOMPurify 净化后再补属性）
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node && node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});
const MD_SANITIZE = {
  ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','strong','b','em','i','del','code','pre','blockquote','ul','ol','li','a','img','table','thead','tbody','tr','th','td','span','div'],
  ALLOWED_ATTR: ['href','src','alt','title','class','target','rel'],
  RETURN_DOM: true,
};
const MD_BLOCK_TAGS = new Set(['H1','H2','H3','H4','H5','H6','P','UL','OL','LI','BLOCKQUOTE','PRE','TABLE','THEAD','TBODY','TR','DIV']);

function mdNodeText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.hasAttribute('data-md-no-copy')) return '';
  if (node.tagName === 'BR') return '\n';
  let s = '';
  for (let i = 0; i < node.childNodes.length; i += 1) s += mdNodeText(node.childNodes[i]);
  if (node.tagName === 'TD' || node.tagName === 'TH') return `${s.trim()}\t`;
  if (MD_BLOCK_TAGS.has(node.tagName)) return s.trim() ? `\n${s.trim()}\n` : '';
  return s;
}

function mdPlainText(el) {
  return mdNodeText(el)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mdCodeLang(pre) {
  const code = pre && pre.querySelector('code');
  const m = code ? /language-([\w-]+)/.exec(code.className || '') : null;
  return m ? m[1] : '文本';
}

function mdUnitBox(kind, labelText) {
  const box = document.createElement('div');
  box.className = `md-unit md-unit-${kind}`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'md-copy-btn';
  btn.setAttribute('data-md-copy', '1');
  btn.setAttribute('data-md-no-copy', '1');
  btn.textContent = '复制';
  if (labelText) {
    const bar = document.createElement('div');
    bar.className = 'md-unit-bar';
    bar.setAttribute('data-md-no-copy', '1');
    const label = document.createElement('span');
    label.className = 'md-unit-label';
    label.textContent = labelText;
    bar.appendChild(label);
    bar.appendChild(btn);
    box.appendChild(bar);
  } else {
    box.appendChild(btn);
  }
  return { box, btn };
}

// 代码块/引用/表格是「可独立复制的叶子块」，无论出现在正文顶层还是列表项内部都要成块：
// 反向遍历保证先包最深层，已被包裹的不再重复包裹。
function mdWrapLeaves(root) {
  const found = Array.from(root.querySelectorAll('pre, blockquote, table'));
  for (let i = found.length - 1; i >= 0; i -= 1) {
    const node = found[i];
    if (node.parentElement && node.parentElement.closest('.md-unit')) continue;
    const kind = node.tagName === 'PRE' ? 'code' : node.tagName === 'TABLE' ? 'table' : 'quote';
    const unit = mdUnitBox(kind, kind === 'code' ? mdCodeLang(node) : null);
    node.parentNode.replaceChild(unit.box, node);
    unit.box.appendChild(node);
  }
}

function buildMdUnits(root) {
  mdWrapLeaves(root);
  const out = document.createElement('div');
  const stack = [];
  const target = () => (stack.length ? stack[stack.length - 1].box : out);
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent && node.textContent.trim()) target().appendChild(node);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName;
    const heading = /^H([1-4])$/.exec(tag);
    if (heading) {
      const level = Number(heading[1]);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const unit = mdUnitBox('sec');
      target().appendChild(unit.box);
      unit.box.appendChild(node);
      stack.push({ level, box: unit.box });
      continue;
    }
    // 分隔线只用来结束当前分段：卡片本身已有边框，再画一条反而杂乱
    if (tag === 'HR') {
      stack.length = 0;
      continue;
    }
    target().appendChild(node);
  }
  // 只取直接子按钮，嵌套卡片的按钮不会被外层认领
  for (const unit of Array.from(out.querySelectorAll('.md-unit'))) {
    const btn = unit.querySelector(':scope > .md-copy-btn, :scope > .md-unit-bar > .md-copy-btn');
    if (btn) btn.setAttribute('data-copy', mdPlainText(unit));
  }
  return out;
}

const mdHtmlCache = new Map();
function renderMarkdown(src) {
  const text = typeof src === 'string' ? src : '';
  if (!text) return '';
  const hit = mdHtmlCache.get(text);
  if (hit !== undefined) return hit;
  const dom = DOMPurify.sanitize(marked.parse(text, { async: false }), MD_SANITIZE);
  const html = buildMdUnits(dom).innerHTML;
  mdHtmlCache.set(text, html);
  if (mdHtmlCache.size > 200) mdHtmlCache.delete(mdHtmlCache.keys().next().value);
  return html;
}

// 30002 常以 http://内网IP 访问，非安全上下文下 navigator.clipboard 直接不可用，
// 所以必须保留 textarea + execCommand 这条兜底路径。
function legacyCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

// 复制反馈只改按钮自身文案（本项目没有全局 toast，也不为一个提示引入依赖）
function flashCopyBtn(btn, label) {
  if (!btn) return;
  const idle = btn.getAttribute('data-idle-label') || btn.textContent;
  btn.setAttribute('data-idle-label', idle);
  btn.textContent = label;
  setTimeout(() => {
    btn.textContent = idle;
  }, 1500);
}

async function copyText(text, btn) {
  const value = typeof text === 'string' ? text : '';
  if (!value) {
    flashCopyBtn(btn, '无内容');
    return;
  }
  let ok = false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) ok = legacyCopyText(value);
  flashCopyBtn(btn, ok ? '已复制' : '复制失败');
}

// 分段复制：按钮在 renderMarkdown 构建期写好 data-copy，事件由 .chat-md 容器委托
// （v-html 内容无法直接绑 Vue 事件）。
function onMdClick(event) {
  const btn = event.target.closest('[data-md-copy]');
  if (!btn) return;
  event.stopPropagation();
  copyText(btn.getAttribute('data-copy'), btn);
}
const activeGenMode = ref('');
const schemaParams = ref({});
// 用户手动在参数条上选过画幅后，自适应调度不得再用「底图自然比例」把它顶回去。
// 只切模型 / 切模态 / 复用配方时才重置（否则视频板块挂一张竖图就永远调不成 16:9）。
const ratioUserLocked = ref(false);

// ===== 参数三层优先级：会话快照 > 模型专属默认 > 全局默认 =====
// sessionParamsMap 在阶段 2 之前是内存态（阶段 2 后端 chat_sessions.params_json 落库后优先读后端）。
const sessionParamsMap = new Map();
let paramsUserTouched = false;

function currentParamsSnapshot() {
  return buildSessionSnapshot({
    ratio: selectedRatio.value,
    size: selectedResolution.value,
    video_resolution: videoResolution.value,
    duration: videoDuration.value,
    schemaParams: schemaParams.value,
    // 契约声明了 seed 时随会话快照一起持久化，保证「相同配置重新生成」可复现
    seed: schemaParams.value?.seed ?? null,
    imageModelKey: imageModelKey.value,
    videoModelKey: videoModelKey.value,
    chatModelKey: chatModelKey.value,
    activeModality: activeModality.value,
    thinkingStrength: thinkingStrength.value
  });
}

function persistCurrentParamsSnapshot() {
  const sid = currentSessionId.value;
  if (!sid) return;
  const snap = currentParamsSnapshot();
  sessionParamsMap.set(sid, snap);
  schedulePersistParams(sid, snap);
}

let paramsPersistTimer = 0;
/**
 * 把参数快照写回 chat_sessions.params_json。
 * 走 PATCH 而不是 POST：POST 会无条件把 updated_at 顶到最新，等于每次拖参数条都把会话推到列表最前。
 */
function schedulePersistParams(sid, snapshot) {
  if (!sid || !snapshot) return;
  if (sessionGeneratingMap.get(sid)) return; // 生成中交给 worker 写，避免两个来源打架
  if (paramsPersistTimer) clearTimeout(paramsPersistTimer);
  paramsPersistTimer = setTimeout(async () => {
    paramsPersistTimer = 0;
    const target = sid;
    const snap = sessionParamsMap.get(target) || snapshot;
    try {
      await patchChatSession(target, { params_json: snap, touch: false });
    } catch (e) {}
  }, 1000);
}

/**
 * 统一回写参数。必须先 clamp 清掉上一个模型的残留 schema，再同时写
 * schemaParams 与顶层 ref —— 只写 selectedRatio 会被残留的 schemaParams.ratio
 * 盖掉（实测：16:9 复用后变成 1:1）。
 */
function applyParamsSnapshot(snapshot = {}, { source = 'system' } = {}) {
  const incoming = snapshot || {};
  const mergedSchema = { ...(schemaParams.value || {}), ...(incoming.schemaParams || {}) };
  if (incoming.ratio != null) mergedSchema.ratio = incoming.ratio;
  if (incoming.size != null) mergedSchema.size = incoming.size;
  schemaParams.value = clampParamsToSchema(currentSchema.value, mergedSchema);

  if (incoming.ratio != null) selectedRatio.value = incoming.ratio;
  if (incoming.size != null) selectedResolution.value = incoming.size;
  if (incoming.video_resolution != null) videoResolution.value = normalizeVideoResolution(incoming.video_resolution);
  if (incoming.duration != null) videoDuration.value = incoming.duration;
  if (incoming.imageModelKey != null) imageModelKey.value = incoming.imageModelKey;
  if (incoming.videoModelKey != null) videoModelKey.value = incoming.videoModelKey;
  if (incoming.chatModelKey != null) chatModelKey.value = incoming.chatModelKey;
  if (incoming.activeModality != null) activeModality.value = incoming.activeModality;
  if (incoming.thinkingStrength != null) thinkingStrength.value = incoming.thinkingStrength;

  if (source === 'user') {
    paramsUserTouched = true;
    if (incoming.ratio != null || incoming.aspect_ratio != null || incoming.schemaParams?.ratio != null) {
      ratioUserLocked.value = true;
    }
    persistCurrentParamsSnapshot();
  }
}

function onParamBarChange({ key }) {
  if (key === 'ratio' || key === 'aspect_ratio') ratioUserLocked.value = true;
  paramsUserTouched = true;
  persistCurrentParamsSnapshot();
}

/** 回到旧会话：优先内存快照，其次后端 chat_sessions.params_json（阶段 2 起才有）。 */
function restoreSessionParams(s) {
  const sid = s?.id;
  if (!sid) return false;
  let snap = sessionParamsMap.get(sid) || null;
  if (!snap && s.params_json) {
    try {
      snap = typeof s.params_json === 'string' ? JSON.parse(s.params_json) : s.params_json;
    } catch (_) { snap = null; }
  }
  if (!snap) return false;
  applyParamsSnapshot(snap, { source: 'system' });
  return true;
}

/** 新建会话：跳过会话层，严格回到「该模型专属默认 > 全局默认 9:16」。 */
function resetParamsToDefaults() {
  const p = resolveParams({
    sessionSnapshot: null,
    modelKey: imageModelKey.value,
    perModel: studioDefaults.value?.perModel || {},
    global: studioDefaults.value || null
  });
  applyParamsSnapshot({
    ratio: p.ratio,
    size: p.size,
    video_resolution: p.video_resolution,
    duration: p.duration,
    schemaParams: p.ratio ? { ratio: p.ratio } : undefined
  }, { source: 'system' });
  ratioUserLocked.value = false;
  paramsUserTouched = false;
}
// 等待文案按模型/模式给出真实预期，本地 Qwen 是分钟级，不再显示误导性的「3 秒」
const generatingHint = computed(() => {
  if (activeModality.value === 'video') return '视频云端渲染通常需要 1~3 分钟，完成后会自动出现在对话中，可继续输入其他需求…';
  if (activeModality.value === 'music') return '配乐合成中，通常需要 30~60 秒…';
  if (activeModality.value === 'image' && imageModelKey.value === 'qwenimage_local') {
    const size = schemaParams.value.size === '2K' ? '2K' : '1K';
    const base = size === '2K'
      ? '本机 Qwen-Image 2K 生成约需 4~7 分钟（模型加载与逐像素扩散），1K 约 1.5~3 分钟'
      : '本机 Qwen-Image 正在加载模型并逐像素扩散，1K 约 1.5~3 分钟，期间不占用云端额度';
    return `${base}，完成后自动显示…`;
  }
  return '云端生图引擎推理中，通常 10~30 秒…';
});
const showAdvanced = ref(false);
const showSkillsMenu = ref(false);
const activeSkillIds = ref([]);
const availableStudioSkills = computed(() =>
  STUDIO_SKILLS_REGISTRY.filter((s) => !s.modality || s.modality.includes(activeModality.value))
);
const currentRefCounts = computed(() => {
  const list = referenceTray.value || [];
  return {
    images: list.filter((r) => !r.kind || r.kind === 'image').length,
    videos: list.filter((r) => r.kind === 'video').length,
    audios: list.filter((r) => r.kind === 'audio' || r.kind === 'music').length,
  };
});
function activeSnippetIds() {
  const ids = [];
  for (const skillId of activeSkillIds.value) {
    const skill = STUDIO_SKILLS_REGISTRY.find((item) => item.id === skillId);
    if (skill && Array.isArray(skill.snippetIds)) ids.push(...skill.snippetIds);
  }
  return ids;
}

function toggleStudioSkill(skill) {
  if (!skill) return;
  const idx = activeSkillIds.value.indexOf(skill.id);
  if (idx >= 0) {
    activeSkillIds.value.splice(idx, 1);
  } else {
    activeSkillIds.value.push(skill.id);
    if (skill.autoParams && typeof skill.autoParams === 'object') {
      schemaParams.value = clampParamsToSchema(currentSchema.value, { ...schemaParams.value, ...skill.autoParams });
      applyModeLocks();
    }
  }
}
const oldRecipeNote = ref(false);
const composerError = ref('');
const composerNotice = ref('');
const retryDialog = ref({ visible: false, msg: null });
const retryNotice = ref(false);
let suppressSchemaReset = false;
let reparsingEditor = false;
let isApplyingTemplate = false;

function modelKeyNow() {
  if (activeModality.value === 'image') return imageModelKey.value;
  if (activeModality.value === 'video') return videoModelKey.value;
  if (activeModality.value === 'music') return musicType.value;
  return '';
}
const currentSchema = computed(() => {
  const key = modelKeyNow();
  if (studioSchemas.value[key]) return studioSchemas.value[key];
  return null;
});
// 共享素材选择器的「最近素材」：本会话最近上传与生成的素材，置顶并标记来源
// 跨对话的「最近使用」：服务端按用户存最近 50 条，这里分成 current（本对话）/ others（其他对话）
const recentRefs = ref({ current: [], others: [] });
let recentLoadedAt = 0;
let recentPushTimer = 0;
let recentPushQueue = [];
const recentBackfilled = new Set();
let recentPoolSid = '';

/** 服务端存的是去掉 token 的稳定路径，展示/挂载前要重签一次，否则必然 401 */
function refineRecentItem(item) {
  const fid = item?.fid || '';
  const url = fid ? getAssetImageUrl(fid) : resignAssetUrl(item?.url || '');
  return {
    ...item,
    fid,
    url,
    name: item?.name || '',
    kind: item?.kind || 'image',
    origin: item?.origin || 'upload',
    mark: item?.origin === 'generated' ? '本次生成' : '对话使用'
  };
}

/** 攒 500ms 再上报，避免一次挂 10 张图打 10 个请求 */
function scheduleRecentPush(items) {
  const payload = (items || [])
    .filter((item) => item && (item.fid || (item.url && !item.url.startsWith('blob:'))))
    .map((item) => ({
      fid: item.fid || '',
      url: item.url || '',
      name: item.name || '',
      kind: item.kind || 'image',
      origin: item.origin || 'upload'
    }));
  if (!payload.length) return;
  recentPushQueue.push(...payload);
  if (recentPushTimer) return;
  recentPushTimer = setTimeout(async () => {
    recentPushTimer = 0;
    const batch = recentPushQueue.splice(0, recentPushQueue.length);
    const sid = currentSessionId.value;
    if (!sid || !batch.length) return;
    try {
      await pushRecentRefs(sid, batch);
      recentLoadedAt = 0;
      await loadRecentRefs({ force: true });
    } catch (e) {}
  }, 500);
}

/**
 * 拉取「最近使用」。同时用它重建本会话素材池：
 * 以前 sessionRefPool 是纯内存累加，切到别的对话时只要目标会话有草稿就不清空，
 * 上一个对话的素材会串进来。
 */
async function loadRecentRefs({ force = false } = {}) {
  const sid = currentSessionId.value;
  if (!sid) return;
  const now = Date.now();
  if (!force && recentLoadedAt && now - recentLoadedAt < 5000) return;
  try {
    const data = await fetchRecentRefs(sid, 20);
    if (sid !== currentSessionId.value) return;
    recentRefs.value = { current: data.current || [], others: data.others || [] };
    recentLoadedAt = Date.now();
    const current = recentRefs.value.current
      .map((item) => refineRecentItem(item))
      .filter((item) => item.url);
    if (current.length) {
      const fromServer = current.map((item) => ({
        fid: item.fid, name: item.name, url: item.url, kind: item.kind, tag: '', origin: item.origin
      }));
      // 同一个会话内的刷新：保留还没上报完的本地条目（刚挂上就被清掉会显得"素材丢了"）；
      // 换了会话则整池替换，避免上一个对话的素材串进来。
      const keepLocal = recentPoolSid === sid
        ? sessionRefPool.value.filter((local) => !fromServer.some((s) => (local.fid && s.fid === local.fid) || (local.url && s.url === local.url)))
        : [];
      sessionRefPool.value = [...fromServer, ...keepLocal];
    } else if (recentPoolSid === sid && sessionRefPool.value.length && !recentBackfilled.has(sid)) {
      // 老会话在服务端还没有最近使用记录：把从历史消息里恢复出来的素材补登记一次，
      // 这样「本对话」栏不会永远是空的（每个会话只补一次）。
      recentBackfilled.add(sid);
      scheduleRecentPush(sessionRefPool.value);
    } else if (recentPoolSid !== sid) {
      // 换了会话且服务端为空：清空上一会话残留，别把上一个对话的素材补报进当前会话
      sessionRefPool.value = [];
    }
    recentPoolSid = sid;
  } catch (e) {
    // 后端未升级时静默降级：仍然用内存池展示
  }
}

const assetPickerRecent = computed(() => {
  const fromServer = (recentRefs.value.current || [])
    .map((item) => refineRecentItem(item))
    .filter((item) => item.url);
  if (fromServer.length) return fromServer;
  // 兜底（服务端还没回话 / 离线）：用本会话内存池
  const list = [];
  for (let i = sessionRefPool.value.length - 1; i >= 0 && list.length < 20; i -= 1) {
    const item = sessionRefPool.value[i];
    if (!item?.url) continue;
    list.push({
      ...item,
      mark: item.origin === 'generated' ? '本次生成' : '对话使用',
    });
  }
  return list;
});
const recentOthers = computed(() => (recentRefs.value.others || [])
  .map((item) => refineRecentItem(item))
  .filter((item) => item.url));
const commonFields = computed(() => {
  const schema = currentSchema.value;
  if (!schema) return [];
  const fields = [...(schema.common || [])];
  if (activeGenMode.value === 'image_edit') {
    for (const key of ['bbox', 'point']) {
      const field = (schema.advanced || []).find((item) => item.key === key);
      if (field && !fields.some((item) => item.key === key)) fields.push(field);
    }
  }
  return fields;
});
const advancedFields = computed(() => {
  const schema = currentSchema.value;
  if (!schema) return [];
  return (schema.advanced || []).filter((field) => !(activeGenMode.value === 'image_edit' && (field.key === 'bbox' || field.key === 'point')));
});
function optionText(field, value) {
  if (field.labels && field.labels[String(value)] != null) return field.labels[String(value)];
  if (value === -1 || value === '-1') return '智能';
  return String(value);
}
function schemaDefaults(schema) {
  const out = {};
  const globalRatio = studioDefaults.value?.params?.ratio || '9:16';
  const globalVideoRes = studioDefaults.value?.params?.video_resolution || '';
  const globalImageSize = studioDefaults.value?.params?.image_size || '2K';
  for (const field of [...(schema.common || []), ...(schema.advanced || [])]) {
    let def = field.default;
    if ((field.key === 'ratio' || field.key === 'aspect_ratio') && Array.isArray(field.options)) {
      if (field.options.includes(globalRatio)) {
        def = globalRatio;
      }
    }
    // 「默认视频清晰度」只对视频生效：图片契约里的 size 才是它的档位，
    // 以前这里不分模态，导致 720p_sr2x 被当成图片默认值写进 schemaParams 并显示在占位卡上。
    if (activeModality.value === 'video'
      && (field.key === 'resolution' || field.rawKey === 'resolution')
      && Array.isArray(field.options) && globalVideoRes) {
      if (field.options.includes(globalVideoRes)) {
        def = globalVideoRes;
      }
    }
    if ((field.key === 'size' || field.rawKey === 'size') && Array.isArray(field.options)) {
      if (field.options.includes(globalImageSize)) {
        def = globalImageSize;
      }
    }
    out[field.key] = def;
  }
  return out;
}
function fieldByKey(schema, key) {
  return [...(schema?.common || []), ...(schema?.advanced || [])].find((field) => field.key === key);
}
function valueStillFits(schema, key, value) {
  const field = fieldByKey(schema, key);
  if (!field) return false;
  if (field.type === 'enum') return (field.options || []).map(String).includes(String(value));
  if (['number', 'range', 'duration'].includes(field.type)) {
    if (value === '' || value == null) return false;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (field.min != null && n < Number(field.min)) return false;
    if (field.max != null && n > Number(field.max)) return false;
  }
  return true;
}
function lockedKeySet() {
  const evaluated = evaluateClientModelRules(currentSchema.value, activeGenMode.value, schemaParams.value, currentRefCounts.value);
  return new Set(evaluated.lockedKeys || []);
}
function isFieldLocked(key) {
  return lockedKeySet().has(key);
}
function applyModeLocks() {
  const evaluated = evaluateClientModelRules(currentSchema.value, activeGenMode.value, schemaParams.value, currentRefCounts.value);
  schemaParams.value = evaluated.params;
}
function resetSchemaForModel(options = {}) {
  const schema = currentSchema.value;
  showAdvanced.value = false;
  // 换模型/换模态等于换了参数表，手选画幅的占用随之解除
  ratioUserLocked.value = false;
  if (!schema) {
    activeGenMode.value = '';
    schemaParams.value = {};
    return;
  }
  const modes = schema.modes || [];
  if (!modes.some((mode) => mode.id === activeGenMode.value)) activeGenMode.value = modes[0]?.id || '';
  const next = schemaDefaults(schema);
  const globalRatio = studioDefaults.value?.params?.ratio || '9:16';
  const globalVideoRes = studioDefaults.value?.params?.video_resolution;
  for (const key of Object.keys(next)) {
    if (schemaParams.value[key] != null && valueStillFits(schema, key, schemaParams.value[key])) {
      if (key === 'ratio' && schemaParams.value[key] === '1:1' && (!referenceTray.value || referenceTray.value.length === 0)) {
        const ratioField = fieldByKey(schema, 'ratio');
        if (ratioField && (ratioField.options || []).includes(globalRatio)) {
          next[key] = globalRatio;
          continue;
        }
      }
      if (key === 'resolution' && globalVideoRes && activeModality.value === 'video') {
        const resField = fieldByKey(schema, 'resolution');
        if (resField && (resField.options || []).includes(globalVideoRes)) {
          if (options.forceResolution || schemaParams.value[key] === '720p') {
            next[key] = globalVideoRes;
            continue;
          }
        }
      }
      next[key] = schemaParams.value[key];
    }
  }
  schemaParams.value = next;
  applyModeLocks();
  syncGenModeWithReferenceTray();
  const id = activeGenMode.value;
  if (id === 'first_last_frame') videoSubMode.value = 'first_last';
  else if (id === 'text_to_video' || id === 'text_to_image') videoSubMode.value = 'prompt_only';
  else if (id) videoSubMode.value = 'multi_ref';

  // 关键自适应兜底：防止模型切换把底图的真实 9:16 / 3:4 比例粗暴重置为默认 1:1 或 16:9
  dispatchSmartWorkflow({ source: 'reset_schema' });
}
function setGenMode(id) {
  const modes = currentSchema.value?.modes || [];
  if (modes.length && !modes.some((mode) => mode.id === id)) return;
  activeGenMode.value = id;
  applyModeLocks();
  if (id === 'first_last_frame') videoSubMode.value = 'first_last';
  else if (id === 'text_to_video' || id === 'text_to_image') videoSubMode.value = 'prompt_only';
  else if (id) videoSubMode.value = 'multi_ref';
}
function firstSupportedMode(...ids) {
  const modes = currentSchema.value?.modes || [];
  return ids.find((id) => modes.some((mode) => mode.id === id)) || '';
}
// 挂上参考素材即切到对应生成模式：图片→图生图/多参考，视频→全能多参考
function autoSelectRefMode(kinds) {
  const list = (kinds || []).filter((kind) => kind === 'image' || kind === 'video' || kind === 'audio');
  if (!list.length) return;
  const tray = referenceTray.value || [];
  if (list.includes('video') || tray.some((item) => mediaKind(item) === 'video')) {
    if (activeModality.value !== 'video') activeModality.value = 'video';
    nextTick(() => {
      const target = firstSupportedMode('omni_reference', 'image_to_video', 'first_last_frame');
      if (target) setGenMode(target);
      dispatchSmartWorkflow({ source: 'autoSelectRefMode_video' });
    });
    return;
  }
  if (list.includes('audio') || tray.some((item) => mediaKind(item) === 'audio')) {
    if (activeModality.value !== 'music') activeModality.value = 'music';
    dispatchSmartWorkflow({ source: 'autoSelectRefMode_music' });
    return;
  }
  const imageCount = tray.filter((item) => mediaKind(item) === 'image').length || list.filter((kind) => kind === 'image').length;
  // 零配置智能调度：若当前在 chat 纯对话，自动切入 image 图像生成板块
  if (activeModality.value === 'chat') {
    activeModality.value = 'image';
  }

  if (activeModality.value === 'image') {
    nextTick(() => {
      // 若当前处于局部编辑且有选区，保护模式不被粗暴冲掉
      if (activeGenMode.value === 'image_edit' && tray.some(img => Array.isArray(img.regions) && img.regions.length > 0)) return;
      const target = imageCount > 1
        ? firstSupportedMode('image_reference', 'image_to_image')
        : firstSupportedMode('image_to_image', 'image_reference');
      if (target) setGenMode(target);
      dispatchSmartWorkflow({ source: 'autoSelectRefMode_image' });
    });
  } else if (activeModality.value === 'video') {
    nextTick(() => {
      const target = imageCount > 1
        ? firstSupportedMode('omni_reference', 'image_to_video')
        : firstSupportedMode('image_to_video', 'omni_reference');
      if (target) setGenMode(target);
      dispatchSmartWorkflow({ source: 'autoSelectRefMode_video_refs' });
    });
  }
}
function setSchemaParam(key, value) {
  if (isFieldLocked(key)) return;
  schemaParams.value = { ...schemaParams.value, [key]: value };
}
function audioOnlyModel() {
  const schema = currentSchema.value;
  return activeModality.value === 'music'
    && Number(schema?.slots?.audios || 0) > 0
    && Number(schema?.slots?.images || 0) === 0;
}
const fileAccept = computed(() => (audioOnlyModel() ? 'audio/*' : 'image/*,video/*,audio/*'));
function refCap() {
  const schema = currentSchema.value;
  if (audioOnlyModel()) return Number(schema.slots.audios);
  const raw = schema?.slots?.images;
  if (raw == null || raw === '') return null;
  const slots = Number(raw);
  if (!Number.isFinite(slots)) return null;
  const free = schema.free?.maxRefs;
  let cap = free != null ? Math.min(slots, Number(free)) : slots;
  if (activeGenMode.value === 'first_last_frame') cap = Math.min(cap, 2);
  if (activeGenMode.value === 'expand_fill') cap = Math.min(cap, 1);
  return cap;
}
function modeRefError(tray) {
  const items = Array.isArray(tray) ? tray : [];
  if (audioOnlyModel()) {
    const audios = items.filter((item) => mediaKind(item) === 'audio').length;
    const cap = Number(currentSchema.value.slots.audios);
    if (audios < 1) return '这个模型需要一段参考音频，10 到 15 秒最合适';
    if (audios > cap) return `参考音频最多 ${cap} 段`;
    return '';
  }
  const count = items.filter((item) => mediaKind(item) !== 'audio').length;
  const cap = refCap();
  const mode = activeGenMode.value;
  if (cap != null && count > cap) return `当前 ${count} 张，这个模型最多 ${cap} 张`;
  if (mode === 'first_last_frame' && count !== 2) return '首尾帧需要两张图，第一张是首帧，第二张是尾帧';
  if (mode === 'expand_fill' && count !== 1) return '扩边填白模式需要一张底图';
  if (mode === 'image_edit' && count < 1) return '局部编辑模式需要至少一张底图';
  if (['image_to_image', 'image_reference', 'image_to_video', 'omni_reference'].includes(mode) && count < 1) return '这个模式需要至少一张参考图';
  return '';
}
function declaredParams() {
  const schema = currentSchema.value;
  const keys = new Set([...(schema?.common || []), ...(schema?.advanced || [])].map((field) => field.key));
  const extras = {};
  for (const key of keys) {
    const value = schemaParams.value[key];
    if (value != null && value !== '') extras[key] = value;
  }
  return extras;
}
function recipeIsLegacy(tpl) {
  if (tpl?.type === 'video' || tpl?.type === 'audio') return false;
  const params = tpl?.params || {};
  const mode = params.genMode || params.mode;
  const modelKey = params.modelKey || params.model;
  const hasResult = Array.isArray(tpl?.result_images) && tpl.result_images.some((item) => item && item.url);
  return !mode && !modelKey && hasResult;
}
watch([activeModality, imageModelKey, videoModelKey, musicType], () => {
  if (suppressSchemaReset) return;
  resetSchemaForModel();
});

// 模态弹窗状态与创作库高级分类体系
const saveModal = ref({
  visible: false,
  title: '',
  prompt: '',
  type: 'image',
  space: '',
  style: '',
  purpose: '',
  is_pinned: false,
  msg: null
});
const detailModal = ref({ visible: false, tpl: {} });
const activeDetailPreview = ref({ mode: 'result', refIndex: 0 });
const detailStageEl = ref(null);
const detailStageWidth = ref(980);
const detailStageHeight = ref(640);
const detailRatios = ref({});
let detailStageObserver = null;

function noteDetailRatio(key, el) {
  const w = el && (el.naturalWidth || el.videoWidth) || 0;
  const h = el && (el.naturalHeight || el.videoHeight) || 0;
  if (!(w > 0 && h > 0)) return;
  const ratio = w / h;
  if (detailRatios.value[key] === ratio) return;
  detailRatios.value = { ...detailRatios.value, [key]: ratio };
}

const railRatios = ref({});

function noteRailRatio(tpl, payload) {
  const width = payload?.width || payload?.target?.naturalWidth || payload?.target?.videoWidth || 0;
  const height = payload?.height || payload?.target?.naturalHeight || payload?.target?.videoHeight || 0;
  if (!(width > 0 && height > 0) || !tpl?.id) return;
  const ratio = width / height;
  if (railRatios.value[tpl.id] === ratio) return;
  railRatios.value = { ...railRatios.value, [tpl.id]: ratio };
}

function templateRailRatio(tpl) {
  if (!tpl) return 1;
  if (tpl.id && railRatios.value[tpl.id] > 0) return railRatios.value[tpl.id];
  if (tpl.poster_w > 0 && tpl.poster_h > 0) return tpl.poster_w / tpl.poster_h;
  const raw = tpl.aspect_ratio || (tpl.params && tpl.params.ratio) || '';
  const parts = String(raw).split(':');
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (parts.length === 2 && w > 0 && h > 0) return w / h;
  // 没有声明比例时：视频按 9:16，图片/音频按 1:1，避免竖图被横向拉宽
  return tpl.type === 'video' ? 9 / 16 : 1;
}

function detailAspectLabel(tpl) {
  if (!tpl) return '';
  return tpl.aspect_ratio || (tpl.params && tpl.params.ratio) || (tpl.type === 'video' ? '9:16' : '');
}

const detailRowHeight = computed(() => {
  const tpl = detailModal.value.tpl || {};
  const refs = Array.isArray(tpl.origin_images) ? tpl.origin_images : [];
  const parts = refs.map((_, index) => detailRatios.value['ref:' + index] || 1);
  if (tpl.type === 'audio' || (tpl.result_images && tpl.result_images[0] && tpl.result_images[0].url)) {
    const fallback = tpl.type === 'audio' ? 1 : templateRailRatio(tpl);
    parts.push(detailRatios.value.result || fallback);
  }
  const sum = parts.reduce((total, ratio) => total + ratio, 0) || 1;
  const arrow = refs.length ? 72 : 0;
  const gaps = 12 * Math.max(0, parts.length - 1) + arrow + 24;
  const fit = (detailStageWidth.value - gaps) / sum;
  const heightCap = Math.max(140, detailStageHeight.value - 36);
  return Math.max(140, Math.min(440, heightCap, Math.floor(fit)));
});

function detailMediaStyle(key, fallback) {
  const ratio = detailRatios.value[key] || fallback || 1;
  const height = detailRowHeight.value;
  return {
    height: height + 'px',
    width: Math.max(72, Math.round(height * ratio)) + 'px'
  };
}

function templateRailCardStyle(tpl) {
  const mediaW = Math.max(96, Math.round(220 * templateRailRatio(tpl)));
  return { width: (mediaW + 20) + 'px' };
}

function templateRailMediaStyle(tpl) {
  const ratio = templateRailRatio(tpl);
  return { height: '220px', width: Math.max(96, Math.round(220 * ratio)) + 'px' };
}

function bindDetailStage() {
  const el = detailStageEl.value;
  if (!el) return;
  detailStageWidth.value = el.clientWidth || detailStageWidth.value;
  detailStageHeight.value = el.clientHeight || detailStageHeight.value;
  if (typeof ResizeObserver === 'undefined') return;
  if (detailStageObserver) detailStageObserver.disconnect();
  detailStageObserver = new ResizeObserver(() => {
    detailStageWidth.value = el.clientWidth || detailStageWidth.value;
    detailStageHeight.value = el.clientHeight || detailStageHeight.value;
  });
  detailStageObserver.observe(el);
}

watch(() => detailModal.value.visible, (open) => {
  detailRatios.value = {};
  if (!open) {
    if (detailStageObserver) detailStageObserver.disconnect();
    detailStageObserver = null;
    return;
  }
  nextTick(bindDetailStage);
});
const promptCopied = ref(false);

function copyRecipePrompt(text) {
  if (!text) return;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => legacyCopyText(text));
  } else {
    legacyCopyText(text);
  }
  promptCopied.value = true;
  setTimeout(() => {
    promptCopied.value = false;
  }, 2000);
}

function formatTemplateFullTime(ts) {
  if (!ts) return '未知时间';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '未知时间';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${sec}`;
}

const savingTpl = ref(false);

// 创作库分类、筛选、放大画廊与重命名状态
const tplTypeFilter = ref('all'); // 'all', 'image', 'video', 'audio'
const tplSpaceFilter = ref('');
const tplStyleFilter = ref('');
const tagVocab = ref({ space: [], style_atom: [], video_purpose: [] });
const tplPinnedOnly = ref(false);
const libraryMounted = ref(false);
const showExpandedLibrary = ref(false);
const isLibraryFullscreen = ref(false);
const editingTemplateId = ref('');
const editingTemplateTitle = ref('');

function toggleLibraryFullscreen() {
  isLibraryFullscreen.value = !isLibraryFullscreen.value;
}

const MODALITY_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '生图' },
  { id: 'video', label: '生视频' },
  { id: 'audio', label: '生音频' }
];

const isPinnedOpen = ref(true);
const isTopReuseOpen = ref(true);

function sortTemplates() {
  templates.value.sort((a, b) => {
    // 1. 置顶 (is_pinned) 优先
    const pinA = a.is_pinned ? 1 : 0;
    const pinB = b.is_pinned ? 1 : 0;
    if (pinB !== pinA) return pinB - pinA;

    // 2. 常用/复用频次 (use_count) 优先
    const useA = Number(a.use_count || 0);
    const useB = Number(b.use_count || 0);
    if (useB !== useA) return useB - useA;

    // 3. 常规按最新创建/更新时间倒序
    const tsA = a.created_at || a.updated_at || 0;
    const tsB = b.created_at || b.updated_at || 0;
    return tsB - tsA;
  });
}

function resetTplFilters() {
  tplSearch.value = '';
  tplTypeFilter.value = 'all';
  tplSpaceFilter.value = '';
  tplStyleFilter.value = '';
  tplPinnedOnly.value = false;
}

function getTemplateTypeLabel(tpl) {
  const type = tpl.type || (tpl.params?.genMode === 'music' ? 'audio' : (tpl.params?.genMode === 'video' ? 'video' : 'image'));
  if (type === 'video') return '🎬 生视频';
  if (type === 'audio') return '🎵 生音频';
  return '🖼️ 生图';
}

function getTemplateTypeBadgeClass(tpl) {
  const type = tpl.type || (tpl.params?.genMode === 'music' ? 'audio' : (tpl.params?.genMode === 'video' ? 'video' : 'image'));
  if (type === 'video') return 'bg-purple-950/80 text-purple-200 border-purple-700/60';
  if (type === 'audio') return 'bg-emerald-950/80 text-emerald-200 border-emerald-700/60';
  return 'bg-studio-950 text-studio-cyan border-studio-800';
}

function tagLabel(dim, stored) {
  const value = String(stored || '');
  if (!value) return '';
  const list = tagVocab.value[dim] || [];
  const hit = list.find((item) => item.dir === value || item.label === value);
  return hit ? hit.label : value;
}

function tagEquals(stored, selected, list) {
  if (!selected) return true;
  const value = String(stored || '');
  if (!value) return false;
  if (value === selected) return true;
  const hit = (list || []).find((item) => item.dir === selected);
  return !!hit && value === hit.label;
}

function startRenameTemplate(tpl) {
  editingTemplateId.value = tpl.id;
  editingTemplateTitle.value = tpl.title;
}

async function confirmRenameTemplate(tpl) {
  const newTitle = (editingTemplateTitle.value || '').trim();
  if (!newTitle) {
    editingTemplateId.value = '';
    return;
  }
  const oldTitle = tpl.title;
  tpl.title = newTitle;
  editingTemplateId.value = '';
  try {
    const res = await authFetch(`/api/creation-templates/${encodeURIComponent(tpl.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    });
    const json = await res.json();
    if (!json.success) {
      tpl.title = oldTitle;
      alert('修改作品名称失败: ' + (json.error || '未知错误'));
    }
  } catch (e) {
    tpl.title = oldTitle;
    alert('修改作品名称失败: ' + e.message);
  }
}

async function toggleTemplatePin(tpl) {
  const nextPinned = tpl.is_pinned ? 0 : 1;
  const oldPinned = tpl.is_pinned;
  tpl.is_pinned = nextPinned;
  sortTemplates();
  try {
    const res = await authFetch(`/api/creation-templates/${encodeURIComponent(tpl.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: nextPinned })
    });
    const json = await res.json();
    if (json.success) {
      mergeTemplatesCache([tpl]);
    } else {
      tpl.is_pinned = oldPinned;
      sortTemplates();
      alert('标常用操作失败: ' + (json.error || '未知错误'));
    }
  } catch (e) {
    tpl.is_pinned = oldPinned;
    sortTemplates();
    alert('标常用操作失败: ' + e.message);
  }
}

// 对话列表
const sessions = ref([]);
const sessionModalityFilter = ref('all'); // 'all' | 'chat' | 'image' | 'video'

function getSessionModality(s) {
  if (!s) return 'chat';
  const mode = String(s.last_mode || '').toLowerCase();
  if (mode === 'chat') return 'chat';
  if (mode.includes('video')) return 'video';
  if (mode.includes('image')) return 'image';
  const title = String(s.title || '').toLowerCase();
  if (title.includes('视频') || title.includes('运镜') || title.includes('动画')) return 'video';
  if (title.includes('生图') || title.includes('图') || title.includes('画') || title.includes('扩图') || title.includes('精修')) return 'image';
  return 'chat';
}

function getSessionModalityBadge(modality) {
  switch (modality) {
    case 'image':
      return { icon: '🖼️', label: '生图', class: 'bg-emerald-950/70 text-emerald-300 border-emerald-700/50' };
    case 'video':
      return { icon: '🎬', label: '生视频', class: 'bg-purple-950/70 text-purple-300 border-purple-700/50' };
    case 'chat':
      return { icon: '💬', label: '对话', class: 'bg-blue-950/70 text-blue-300 border-blue-700/50' };
    default:
      return { icon: '✨', label: '空间', class: 'bg-studio-950 text-slate-300 border-studio-800' };
  }
}

const filteredSessions = computed(() => {
  if (!sessions.value || !sessions.value.length) return [];
  if (sessionModalityFilter.value === 'all') return sessions.value;
  return sessions.value.filter(s => getSessionModality(s) === sessionModalityFilter.value);
});
const promptHistory = ref([]);
const historyIndex = ref(-1);
let currentDraftText = '';
let currentDraftTray = [];
let currentDraftState = null;

const templates = ref([]);
const messages = ref([]);

// 媒体大图/视频预览弹窗
const previewModal = ref({
  visible: false,
  url: '',
  type: 'image', // 'image' | 'video'
  title: '',
  scale: 1.0,
  compare: null
});

// 灵感胶囊预设
const chatQuickStarters = [
  '分析当前客餐厅采光与透视动线，提出优化建议',
  '根据现有地面木纹，推荐 3 套温润协调的软装材质搭配方案',
  '如何将传统中式客餐厅改造成极简新中式空间？'
];

const imageQuickStarters = [
  { title: '极简真皮沙发置换', desc: '参考@图1的空间格局，精准替换为现代轻奢真皮沙发，保留自然采光' },
  { title: '开关面板墙面贴合', desc: '在指定床头或玄关墙面安装极简磨砂智能触控开关，边缘贴合无缝' },
  { title: '全景超宽空间扩图', desc: '向左右两侧拓展室内视界，补全落地大窗与现代开放式岛台' },
  { title: '原木侘寂风全局改造', desc: '将冷白亮光瓷砖转换为温润微水泥与原木肌理，营造静谧氛围' }
];

const videoQuickStarters = [
  { title: '慢速推镜穿过落地窗', desc: '镜头从客厅全景缓缓向前推入，阳光微移，窗帘随微风轻拂，进入开阔阳台' },
  { title: '晨曦光影在木地板上的流动', desc: '固定机位室内延时摄影，晨曦金色阳光在原木地板上缓慢拉长，空间光影流转' },
  { title: '360度环绕沙发展示透视', desc: '环绕镜头以沙发为中心顺时针旋转60度，展示家具立体质感与室内纵深' },
  { title: '昼夜室内光线柔和渐变', desc: '首帧为清晨自然采光，随镜头平移柔和过渡至夜幕暖色氛围壁灯点亮' }
];

const musicStarters = [
  { title: 'Nordic Morning (北欧轻晨)', duration: '00:30', desc: '清晨微风穿过薄纱窗帘，原声木吉他与温和晨光' },
  { title: 'Deep Focus Ambient (空间白噪音)', duration: '00:30', desc: '静谧微水泥空间，细微环境回响，极度放松舒适' },
  { title: 'Modern Luxury Elegance (轻奢弦乐)', duration: '00:30', desc: '现代大平层室内宣传片大提琴与钢琴柔和交织' }
];

const filteredTemplates = computed(() => {
  const q = tplSearch.value.trim().toLowerCase();
  const type = tplTypeFilter.value;
  const space = tplSpaceFilter.value;
  const style = tplStyleFilter.value;
  const pinnedOnly = tplPinnedOnly.value;

  return templates.value.filter(tpl => {
    if (pinnedOnly && !tpl.is_pinned) return false;
    if (type !== 'all') {
      const tType = tpl.type || (tpl.params?.genMode === 'music' ? 'audio' : (tpl.params?.genMode === 'video' ? 'video' : 'image'));
      if (tType !== type) return false;
    }
    if (!tagEquals(tpl.space, space, tagVocab.value.space)) return false;
    if (!tagEquals(tpl.style, style, tagVocab.value.style_atom)) return false;
    if (q) {
      const matchTitle = (tpl.title || '').toLowerCase().includes(q);
      const matchPrompt = (tpl.prompt || '').toLowerCase().includes(q);
      const matchSpace = (tpl.space || '').toLowerCase().includes(q);
      const matchStyle = (tpl.style || '').toLowerCase().includes(q);
      const matchTags = Array.isArray(tpl.tags) && tpl.tags.some(t => String(t).toLowerCase().includes(q));
      if (!matchTitle && !matchPrompt && !matchSpace && !matchStyle && !matchTags) return false;
    }
    return true;
  });
});

const TPL_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function isTemplateToday(dateStr) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return dateStr === `${y}-${m}-${d}`;
}

function isTemplateYesterday(dateStr) {
  const yest = new Date(Date.now() - 86400000);
  const y = yest.getFullYear();
  const m = String(yest.getMonth() + 1).padStart(2, '0');
  const d = String(yest.getDate()).padStart(2, '0');
  return dateStr === `${y}-${m}-${d}`;
}

function getTemplateDateKey(tpl) {
  if (!tpl) return '未知时间';
  const ts = tpl.created_at || tpl.updated_at;
  if (!ts) return '未知时间';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '未知时间';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTemplateDateDisplay(dateStr) {
  if (!dateStr || dateStr === '未知时间') return '早期创作记录';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  if (isTemplateToday(dateStr)) return `今天 · ${y}年${m}月${d}日`;
  if (isTemplateYesterday(dateStr)) return `昨天 · ${y}年${m}月${d}日`;
  return `${y}年${m}月${d}日`;
}

function getTemplateWeekdayDisplay(dateStr) {
  if (!dateStr || dateStr === '未知时间') return '';
  const d = new Date(dateStr + 'T00:00:00');
  return isNaN(d.getDay()) ? '' : TPL_WEEKDAYS[d.getDay()];
}

function formatTemplateCardTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

function fidFromMediaUrl(url) {
  const match = String(url || '').match(/\/api\/viewer\/assets\/([^/?#]+)/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function getVideoPosterUrl(tpl) {
  if (!tpl) return '';
  const r0 = tpl.result_images?.[0];
  if (r0?.poster) return authedMediaUrl(r0.poster);
  if (r0?.poster_url) return authedMediaUrl(r0.poster_url);
  if (tpl.poster_url) return authedMediaUrl(tpl.poster_url);
  const fid = r0?.fid || tpl.assetFid || tpl.fid || fidFromMediaUrl(r0?.url);
  if (fid) return authedMediaUrl(`/api/viewer/assets/${encodeURIComponent(fid)}/poster`);
  return '';
}

function templateVideoUrl(tpl) {
  const url = tpl?.result_images?.[0]?.url || '';
  return url ? authedMediaUrl(url) : '';
}

function templateRefUrl(tpl) {
  const url = tpl?.origin_images?.[0]?.url || '';
  return url ? authedMediaUrl(url) : '';
}


// ===== 创作库配方衍生列表与分页状态机（在 filteredTemplates 之后按序初始化，彻底消除 TDZ） =====
const pinnedTemplates = computed(() => {
  return [...filteredTemplates.value]
    .filter(t => t.is_pinned)
    .sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0));
});

const tplGroupDerivatives = ref(true);

const topReuseTemplates = computed(() => {
  const pool = [...filteredTemplates.value].filter(t => !t.is_pinned && (t.use_count || 0) > 0);
  const groupMap = new Map();
  for (const t of pool) {
    const key = String(t.prompt || t.title || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        ...t,
        use_count: t.use_count || 0,
        variants: [t]
      });
    } else {
      const existing = groupMap.get(key);
      existing.use_count = Math.max(existing.use_count || 0, t.use_count || 0) + 1;
      existing.variants.push(t);
      if ((t.created_at || 0) > (existing.created_at || 0)) {
        existing.result_images = t.result_images;
        existing.created_at = t.created_at;
        existing.id = t.id;
      }
    }
  }
  return Array.from(groupMap.values())
    .sort((a, b) => (b.use_count || 0) - (a.use_count || 0) || (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 10);
});

const regularTemplates = computed(() => {
  const pinOrTopSet = new Set([
    ...pinnedTemplates.value.map(t => t.id),
    ...topReuseTemplates.value.map(t => t.id)
  ]);
  return filteredTemplates.value.filter(t => !pinOrTopSet.has(t.id));
});

// 分页切片状态
const tplPage = ref(1);
const tplPageSize = ref(24);
const tplPageSizeOptions = [12, 24, 48, 96];

const isPullingExternal = ref(false);
const pullExternalNotice = ref('');

// 筛选/搜索变更时重置至第一页
watch([tplSearch, tplTypeFilter, tplSpaceFilter, tplStyleFilter, tplPinnedOnly], () => {
  tplPage.value = 1;
});

// 核心：母本智能聚类折叠（在分页前全局聚类，彻底消除散装平铺）
const clusteredRegularTemplates = computed(() => {
  const rawList = regularTemplates.value;
  if (!tplGroupDerivatives.value) {
    return rawList;
  }
  const clusterMap = new Map();
  const clusters = [];

  for (const item of rawList) {
    let originImgs = item.origin_images;
    if (typeof originImgs === 'string') {
      try { originImgs = JSON.parse(originImgs); } catch (e) { originImgs = []; }
    }
    const refUrl = originImgs?.[0]?.url || originImgs?.[0]?.fid || '';
    const normPrompt = String(item.prompt || '').trim().replace(/\s+/g, ' ').slice(0, 36);
    const itemType = item.type || 'image';

    let clusterKey = '';
    if (refUrl) {
      clusterKey = `ref:${refUrl}_${itemType}`;
    } else if (normPrompt.length >= 6) {
      clusterKey = `p:${normPrompt}_${itemType}`;
    } else {
      clusterKey = `id:${item.id}`;
    }

    if (!clusterMap.has(clusterKey)) {
      const entry = {
        ...item,
        variants: [item],
        activeVariantIdx: 0
      };
      clusterMap.set(clusterKey, entry);
      clusters.push(entry);
    } else {
      const parent = clusterMap.get(clusterKey);
      parent.variants.push(item);
      // 保持母本卡片展示最新生成的封面结果与时间
      if ((item.created_at || item.updated_at || 0) > (parent.created_at || parent.updated_at || 0)) {
        parent.result_images = item.result_images;
        parent.created_at = item.created_at;
        parent.updated_at = item.updated_at;
        parent.id = item.id;
      }
    }
  }

  return clusters;
});

const totalRegularTemplates = computed(() => clusteredRegularTemplates.value.length);
const totalTplPages = computed(() => Math.max(1, Math.ceil(totalRegularTemplates.value / tplPageSize.value)));

watch(totalTplPages, (maxP) => {
  if (tplPage.value > maxP) {
    tplPage.value = Math.max(1, maxP);
  }
});

const pagedRegularTemplates = computed(() => {
  const start = (tplPage.value - 1) * tplPageSize.value;
  return clusteredRegularTemplates.value.slice(start, start + tplPageSize.value);
});

const visibleTplPages = computed(() => {
  const total = totalTplPages.value;
  const curr = tplPage.value;
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  let start = Math.max(1, curr - 2);
  let end = Math.min(total, curr + 2);
  if (curr <= 3) {
    end = 5;
  } else if (curr >= total - 2) {
    start = total - 4;
  }
  const pages = [];
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
});

function goToTplPage(p) {
  const target = Math.max(1, Math.min(totalTplPages.value, Number(p) || 1));
  tplPage.value = target;
  nextTick(() => {
    const scroller = document.querySelector('.creation-grid-scroller');
    if (scroller) {
      scroller.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

function jumpToTplPage(val) {
  const num = parseInt(val, 10);
  if (!Number.isNaN(num)) {
    goToTplPage(num);
  }
}

// 极速预览图预热（在后台提前异步解码，确保开窗 20ms 内图片即见即得）
function prewarmPreviewImages(list, count = 36) {
  if (!Array.isArray(list) || typeof Image === 'undefined') return;
  const slice = list.slice(0, count);
  for (const item of slice) {
    const rawUrl = item.result_images?.[0]?.url || item.origin_images?.[0]?.url;
    if (rawUrl) {
      const img = new Image();
      img.decoding = 'async';
      img.src = authedMediaUrl(rawUrl);
    }
  }
}

// 主动从外部数据源拉取最新配方资产
async function triggerPullExternal(manual = false) {
  if (isPullingExternal.value) return;
  isPullingExternal.value = true;
  if (manual) {
    pullExternalNotice.value = '正在主动拉取外部数据源...';
  }
  try {
    const res = await pullExternalCreationTemplates({ maxPages: 2, size: 50 });
    if (res && res.success) {
      if (res.count > 0) {
        pullExternalNotice.value = `已同步 ${res.count} 件外部新资产`;
        await loadTemplates();
      } else {
        if (manual) pullExternalNotice.value = '外部数据源已是最新，无新增资产';
      }
    } else if (res && res.unconfigured) {
      if (manual) pullExternalNotice.value = '外部数据源未配置，使用本地创作库';
    } else if (res && res.error) {
      if (manual) pullExternalNotice.value = res.error;
    }
  } catch (err) {
    console.warn('拉取外部数据源异常:', err);
    if (manual) pullExternalNotice.value = '外部数据源拉取失败';
  } finally {
    isPullingExternal.value = false;
    setTimeout(() => {
      pullExternalNotice.value = '';
    }, 3500);
  }
}

function openCreationLibraryModal() {
  const t0 = performance.now();
  libraryMounted.value = true;
  showExpandedLibrary.value = true;
  const elapsed = performance.now() - t0;
  console.log(`[CreationLibrary] 打开耗时: ${elapsed.toFixed(2)}ms (20ms指标)`);
  // 打开后主动异步拉取外部最新资产（Stale-While-Revalidate，首屏秒呈无阻塞）
  triggerPullExternal(false);
}

function stepCardVariant(tpl, delta) {
  if (!tpl.variants || tpl.variants.length <= 1) return;
  const len = tpl.variants.length;
  const nextIdx = ((tpl.activeVariantIdx || 0) + delta + len) % len;
  tpl.activeVariantIdx = nextIdx;
  const activeVar = tpl.variants[nextIdx];
  tpl.result_images = activeVar.result_images;
  tpl.params = activeVar.params;
  tpl.aspect_ratio = activeVar.aspect_ratio;
  tpl.prompt = activeVar.prompt;
}

function selectModalVariant(v) {
  if (!v || !detailModal.value.tpl) return;
  detailModal.value.tpl = {
    ...v,
    variants: detailModal.value.tpl.variants
  };
}

const templateDateGroups = computed(() => {
  const list = pagedRegularTemplates.value;
  if (!list || !list.length) return [];
  const map = new Map();

  for (const tpl of list) {
    const dateStr = getTemplateDateKey(tpl);
    let grp = map.get(dateStr);
    if (!grp) {
      grp = {
        dateStr,
        formattedDate: formatTemplateDateDisplay(dateStr),
        weekday: getTemplateWeekdayDisplay(dateStr),
        items: []
      };
      map.set(dateStr, grp);
    }
    grp.items.push(tpl);
  }

  const sortedKeys = Array.from(map.keys()).sort((a, b) => {
    if (a === '未知时间') return 1;
    if (b === '未知时间') return -1;
    return b.localeCompare(a);
  });

  return sortedKeys.map((k) => {
    const grp = map.get(k);
    grp.items.sort((a, b) => (b.created_at || b.updated_at || 0) - (a.created_at || a.updated_at || 0));
    return grp;
  });
});

// 跨板块送入的素材必须等 loadSessions/selectSession 完成后再挂载，
// 否则 resetComposerState 会把刚挂进 referenceTray 的图清掉。
const bootstrapDone = ref(false);
const pendingIncoming = [];

watch(() => props.initialPayload, (payload) => {
  if (!payload) return;
  if (!bootstrapDone.value) {
    pendingIncoming.push(payload);
    return;
  }
  void consumeIncoming(payload);
}, { immediate: true });

async function consumeIncoming(payload) {
  if (!payload) return;
  let items = Array.isArray(payload) ? payload : (Array.isArray(payload.items) ? payload.items : [payload]);
  items = items.filter(Boolean);
  if (!items.length) return;

  // quick 抽屉只开抽屉，不新建会话
  if (payload.target === 'quick' || (items.length === 1 && items[0]._openDrawer)) {
    mountAssetFromLibrary(items[0]);
    emit('payloadConsumed');
    return;
  }

  const editorText = richEditorRef.value ? (richEditorRef.value.innerText || '').trim() : '';
  const hasContent = messages.value.length > 0
    || referenceTray.value.length > 0
    || Boolean(recipePrompt.value && recipePrompt.value.trim())
    || Boolean(globalRecipePrompt.value && globalRecipePrompt.value.trim())
    || Boolean(editorText);
  if (hasContent) {
    await createNewSession({ forceReset: true });
  }
  mountAssetsFromLibrary(items);
  emit('payloadConsumed');
}

const studioDefaults = ref({});
const catalogError = ref('');

/**
 * 当前选中的模型 id 不在启用列表里就回退。复用时也必须跑：
 * 旧配方把「显示名」（如 Seedance 2.0）写进了只认契约 id 的 key，
 * 先按 name 反查一次 id 做无损恢复，反查不到才退回默认模型。
 */
function repairStudioModelKeys() {
  const pick = (modality, list, current) => {
    if (!list.length) return current;
    const serverDef = studioDefaults.value?.[modality];
    if (serverDef && list.some(m => m.id === serverDef)) {
      if (!current || current === 'seedream5flash' || current === 'seedance2_5' || !list.some(m => m.id === current)) {
        return serverDef;
      }
    }
    if (list.some((m) => m.id === current)) return current;
    const byName = list.find((m) => m.name === current || `${m.name}${m.badge ? ` · ${m.badge}` : ''}` === current);
    return byName?.id || serverDef || list[0].id;
  };
  chatModelKey.value = pick('chat', studioModels.value.chat, chatModelKey.value);
  imageModelKey.value = pick('image', studioModels.value.image, imageModelKey.value);
  videoModelKey.value = pick('video', studioModels.value.video, videoModelKey.value);
  musicType.value = pick('music', studioModels.value.music, musicType.value);
}

async function loadStudioCatalog() {
  catalogError.value = '';
  try {
    const catalog = await fetchStudioCatalog();
    studioSchemas.value = catalog.schemas || {};
    if (catalog.studio) {
      if (catalog.studio.chat?.models) studioModels.value.chat = catalog.studio.chat.models;
      if (catalog.studio.image?.models) studioModels.value.image = catalog.studio.image.models;
      if (catalog.studio.video?.models) studioModels.value.video = catalog.studio.video.models;
      if (catalog.studio.music?.models) studioModels.value.music = catalog.studio.music.models;
      studioDefaults.value = {
        chat: catalog.defaults?.models?.chat || catalog.studio.chat?.defaultModel || '',
        image: catalog.defaults?.models?.image || catalog.studio.image?.defaultModel || '',
        video: catalog.defaults?.models?.video || catalog.studio.video?.defaultModel || '',
        music: catalog.defaults?.models?.music || catalog.studio.music?.defaultModel || '',
        params: catalog.defaults?.params || {}
      };
      if (catalog.defaults?.models?.image) imageModelKey.value = catalog.defaults.models.image;
      if (catalog.defaults?.models?.video) videoModelKey.value = catalog.defaults.models.video;
      // 先按目录修正模型 key 并重建参数表；后端默认必须在 resetSchemaForModel 之后写回，
      // 否则刚写的 schemaParams 会被重建逻辑冲掉。
      repairStudioModelKeys();
      resetSchemaForModel({ forceResolution: true });
      if (catalog.defaults) {
        // 后端默认属于三层优先级的第 3 层：只有当前会话没有快照、
        // 且当前模型没有设置页专属默认时才生效，避免盖掉用户上一轮参数。
        const p = catalog.defaults.params || {};
        const sid = currentSessionId.value;
        const modelDefault = studioDefaults.value?.perModel?.[imageModelKey.value];
        const hasSessionSnapshot = !!(sid && sessionParamsMap.has(sid));
        if (!hasSessionSnapshot && !modelDefault?.ratio) {
          applyParamsSnapshot({
            ratio: p.ratio || p.image_ratio,
            size: p.image_size,
            video_resolution: p.video_resolution,
            duration: p.video_duration,
            schemaParams: {
              ...(p.ratio ? { ratio: p.ratio } : {}),
              // 分辨率/尺寸按模态分开继承：图片只吃 image_size，视频才吃 video_resolution。
              // 以前这里无条件写 resolution，图片模态也被塞进 720p_sr2x，占位卡直接把它当分辨率显示。
              ...(activeModality.value === 'video' && p.video_resolution ? { resolution: p.video_resolution } : {}),
              ...(activeModality.value === 'image' && p.image_size ? { size: p.image_size } : {})
            }
          }, { source: 'system' });
        }
        // 最后按当前契约剪一次枝，把跨模态/跨配方残留的键（如图片模式下的 resolution）清掉
        schemaParams.value = clampParamsToSchema(currentSchema.value, schemaParams.value);
      }
    }
  } catch (e) {
    // 目录挂了 = 四个模型下拉全空 + 误报「参数表还没接入」，必须让用户看得见并可以重试
    catalogError.value = e?.message || String(e);
  }
}

let draftSaveTimer = 0;
watch([recipePrompt, globalRecipePrompt, referenceTray], () => {
  syncGenModeWithReferenceTray();
  // 防抖 600ms：托盘和正文一起变的时候只落一次，避免把「新托盘 + 旧正文」的中间态写进草稿
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = 0;
    saveDraftToStorage(currentSessionId.value);
  }, 600);
}, { deep: true });

// 参考托盘变动与选图变动时，自适应智能联动（需在所有依赖状态声明就绪后挂载，避免 TDZ）
watch(
  () => referenceTray.value.map(it => it.url).join('|'),
  () => {
    referenceTray.value.forEach(it => {
      if (it && it.url && (!it.naturalWidth || !it.naturalHeight)) {
        autoSyncRatioFromImage(it.url, it);
      }
    });
    dispatchSmartWorkflow({ source: 'reference_tray_urls_change' });
  },
  { immediate: true }
);

watch(
  () => selectedImageIndex.value,
  (idx) => {
    const it = referenceTray.value[idx];
    if (it && it.url) {
      if (!it.naturalWidth || !it.naturalHeight) {
        autoSyncRatioFromImage(it.url, it);
      } else {
        dispatchSmartWorkflow({ source: 'selected_image_change' });
      }
    }
  }
);

// ---- 消息流「钉底」滚动 ----------------------------------------------------
// chat-scroll 是真正的滚动容器（适老化的 overflow:visible 补丁已删除），
// 用 ResizeObserver 观察每一行消息：新行、流式文字增长、图片加载撑高都会触发，
// 钉住时跟到底，用户上滑后只提示不抢滚动条。
const PIN_THRESHOLD = 48;
const pinned = ref(true);
const hasNewBelow = ref(false);
let streamRO = null;
let streamMO = null;
let pinRaf = 0;
let programmaticUntil = 0;

function stickToBottom() {
  const el = messageScroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function observeStreamRows() {
  const el = messageScroller.value;
  if (!el || !streamRO) return;
  for (const row of el.children) streamRO.observe(row);
}

function onChatScroll() {
  if (Date.now() < programmaticUntil) return;
  const el = messageScroller.value;
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
  if (atBottom) {
    pinned.value = true;
    hasNewBelow.value = false;
  } else {
    pinned.value = false;
  }
}

function scrollToBottom({ behavior = 'auto' } = {}) {
  pinned.value = true;
  hasNewBelow.value = false;
  nextTick(() => {
    const el = messageScroller.value;
    if (!el) return;
    if (behavior === 'smooth') {
      programmaticUntil = Date.now() + 700;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      stickToBottom();
    }
  });
}

function jumpToLatest() {
  scrollToBottom({ behavior: 'smooth' });
}

// 4. 收回参考图时自动查看最新对话，补齐观察器并平滑滚底
watch(viewerCollapsed, async (collapsed) => {
  if (collapsed) {
    await nextTick();
    if (messageScroller.value) {
      if (!streamMO) {
        streamMO = new MutationObserver(() => observeStreamRows());
      }
      streamMO.disconnect();
      streamMO.observe(messageScroller.value, { childList: true });
      observeStreamRows();
    }
    scrollToBottom({ behavior: 'smooth' });
    stickToBottom();
  }
});

// 5. 占位渲染卡片计时与阶段进度推算
const nowTimestamp = ref(Date.now());
let timerInterval = null;

const hasGeneratingPlaceholder = computed(() => {
  return messages.value.some((m) => m && m.isGenerating);
});

function getElapsedSec(msg) {
  if (!msg || !msg.startTime) return 0;
  return Math.max(0, Math.floor((nowTimestamp.value - msg.startTime) / 1000));
}

function formatTimer(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function getGeneratingStageText(msg) {
  const elapsed = getElapsedSec(msg);
  if (msg.modality === 'video') {
    if (elapsed < 6) return '正在解算相机运镜轨迹与空间透视...';
    if (elapsed < 18) return '生成空间连贯性动态时空序列...';
    if (elapsed < 35) return '融合自然物理光影与家具材质动线...';
    if (elapsed < 60) return '超高清视频流编码与压制渲染中...';
    return '跨帧连续性优化与最终合成中...';
  }
  if (elapsed < 4) return '正在解算空间构图与视角结构...';
  if (elapsed < 10) return '计算环境光照与材质物理漫反射...';
  if (elapsed < 18) return '深度扩散陈设细节与纹理融合...';
  if (elapsed < 30) return '超写实高精画质降噪渲染中...';
  return '精细边缘对齐与色彩校准中...';
}

function getGeneratingProgressPercent(msg) {
  const elapsed = getElapsedSec(msg);
  const target = msg.modality === 'video' ? 55 : 24;
  const pct = Math.min(96, Math.round((1 - Math.exp(-elapsed / (target * 0.45))) * 100));
  return Math.max(8, pct);
}

function getPlaceholderContainerStyle(ratio) {
  const parts = String(ratio || '16:9').trim().split(':');
  const w = Number(parts[0]) || 16;
  const h = Number(parts[1]) || 9;
  const aspectRatio = `${w} / ${h}`;
  const targetHeight = 440;

  if (h > w) {
    const calcWidth = Math.min(Math.round(targetHeight * (w / h)), 340);
    return {
      aspectRatio,
      width: `${calcWidth}px`,
      maxHeight: `${targetHeight}px`,
    };
  }

  const calcWidth = Math.min(Math.round(targetHeight * (w / h)), 720);
  return {
    aspectRatio,
    width: '100%',
    maxWidth: `${calcWidth}px`,
    maxHeight: `${targetHeight}px`,
  };
}

function handleGlobalKeydown(e) {
  if (e.key === 'Escape') {
    if (selectionBubble.visible) {
      selectionBubble.visible = false;
    } else if (previewModal.value.visible) {
      previewModal.value.visible = false;
    } else if (detailModal.value.visible) {
      detailModal.value.visible = false;
    } else if (saveModal.value.visible) {
      saveModal.value.visible = false;
    } else if (showAssetSelector.value) {
      showAssetSelector.value = false;
    } else if (showExpandedLibrary.value) {
      if (isLibraryFullscreen.value) {
        isLibraryFullscreen.value = false;
      } else {
        showExpandedLibrary.value = false;
      }
    }
  }
}

function handleGlobalDocClick(e) {
  if (selectionBubble.visible && !e.target.closest('.select-text') && !e.target.closest('.z-\\[9999\\]')) {
    selectionBubble.visible = false;
  }
}

let stopSseTaskWatch = null;
let stopSseAssetWatch = null;

onMounted(async () => {
  stopSseTaskWatch = onTaskUpdate(null, (task) => {
    if (!task) return;
    // 生图/视频走 gen_jobs 队列，完成态是 succeeded（不是 success/completed）。
    // 事件只做两件事：刷新左侧列表；如果完成的是「当前会话」且不是本轮自己在 await，再补拉一次消息。
    // 绝不在这里切会话——以前一完成就 loadSessions()→selectSession(最新)，界面会被拽到别的对话框。
    const isGenJob = task.type === 'gen_job' || Boolean(task.jobId);
    if (isGenJob) {
      if (task.status !== 'succeeded' && task.status !== 'failed') return;
      const sid = task.sessionId || '';
      const mine = Boolean(sid) && sid === currentSessionId.value;
      loadSessions({ select: 'none' }).catch(() => {});
      const busyHere = sid && (sessionGeneratingMap.get(sid) || sessionPlaceholderMap.has(sid));
      if (mine && !busyHere) refreshMessagesFromServer(sid).catch(() => {});
      return;
    }
    if (task.status === 'success' || task.status === 'completed') {
      loadSessions({ select: 'none' }).catch(() => {});
    }
  });
  stopSseAssetWatch = onAssetChange(() => {
    loadTemplates().catch(() => {});
  });
  // 老版本的用户级单键草稿先收进内存，等选定会话时迁移到该会话的 key 下
  pendingLegacyDraft = readLegacyDraft();
  await loadStudioCatalog();
  resetSchemaForModel();
  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('mousedown', handleGlobalDocClick);
  // 换登录 / 掉登录都要重签媒体 URL：token 存在 localStorage，不触发渲染，旧 <img> 会一直 401
  window.addEventListener('ml_login', bumpMediaAuth);
  window.addEventListener('ml_auth_required', bumpMediaAuth);
  window.addEventListener('studio_defaults_changed', () => { loadStudioCatalog(); });
  streamRO = new ResizeObserver(() => {
    if (pinned.value) {
      if (!pinRaf) pinRaf = requestAnimationFrame(() => { pinRaf = 0; stickToBottom(); });
    } else {
      hasNewBelow.value = true;
    }
  });
  streamMO = new MutationObserver(() => observeStreamRows());
  if (messageScroller.value) {
    streamMO.observe(messageScroller.value, { childList: true });
    observeStreamRows();
  }
  timerInterval = setInterval(() => {
    if (currentGenerating.value || messages.value.some((m) => m && m.isGenerating)) {
      nowTimestamp.value = Date.now();
    }
  }, 500);
  await loadTemplates();
  await loadSessions();
  await loadRecentRefs({ force: true });
  bootstrapDone.value = true;
  while (pendingIncoming.length) {
    await consumeIncoming(pendingIncoming.shift());
  }
});

onBeforeUnmount(() => {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  if (recordTimer) clearInterval(recordTimer);
  if (recordingStream) recordingStream.getTracks().forEach(t => t.stop());
  if (stopSseTaskWatch) stopSseTaskWatch();
  if (stopSseAssetWatch) stopSseAssetWatch();
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('mousedown', handleGlobalDocClick);
  window.removeEventListener('ml_login', bumpMediaAuth);
  window.removeEventListener('ml_auth_required', bumpMediaAuth);
  if (pinRaf) cancelAnimationFrame(pinRaf);
  pinRaf = 0;
  if (streamRO) streamRO.disconnect();
  if (streamMO) streamMO.disconnect();
  if (detailStageObserver) detailStageObserver.disconnect();
  streamRO = null;
  streamMO = null;
});

function fileNameFromUrl(url) {
  try {
    const base = decodeURIComponent(String(url || '').split('?')[0].split('/').pop() || '');
    if (base && base.includes('.')) return base;
  } catch (e) {}
  return '';
}
function namesInPrompt(text) {
  const names = [];
  // 1. 优先提取带方括号的: @图1[xxx.jpg]
  const reWithBrackets = /@(?:图|图片|视频|音频)(\d+)\[([^\]]+)\]/g;
  let match;
  while ((match = reWithBrackets.exec(String(text || '')))) {
    names[Number(match[1]) - 1] = match[2];
  }
  // 2. 兼容提取纯 @图1、@图2，自动使用 referenceTray 中已有图名称
  const reSimple = /@(?:图|图片|视频|音频)(\d+)(?!\[)/g;
  while ((match = reSimple.exec(String(text || '')))) {
    const idx = Number(match[1]) - 1;
    if (!names[idx] && referenceTray.value[idx]) {
      names[idx] = referenceTray.value[idx].name || referenceTray.value[idx].file_name || `素材${idx + 1}`;
    }
  }
  return names;
}
function labelForRef(url, promptName) {
  if (promptName && !/^参考图\d+$/.test(promptName)) return promptName;
  return fileNameFromUrl(url) || promptName || '未命名图片';
}
/**
 * 记录到「本会话素材池」。
 * persist=true 时才同步上报服务端（跨对话的最近使用）——历史消息回填、配方复用这类
 * 只是"重新加载"的场景不该刷新 used_at，否则最近使用会被旧素材顶满。
 */
function rememberSessionRefs(items, origin = 'upload', { persist = false } = {}) {
  const added = [];
  for (const item of items || []) {
    if (!item?.url && !item?.fid) continue;
    const url = item.url || '';
    if (sessionRefPool.value.some((hit) => (item.fid && hit.fid === item.fid) || (url && hit.url === url))) continue;
    const entry = {
      fid: item.fid || '',
      name: labelForRef(url, item.name),
      url,
      kind: item.kind || 'image',
      tag: item.tag || '',
      origin: item.origin || origin
    };
    sessionRefPool.value.push(entry);
    added.push(entry);
  }
  if (persist && added.length) scheduleRecentPush(added);
}

// 跨板块：将真实素材追加至看图区并挂载为 @图N，不覆盖已有内容
function mountAssetFromLibrary(item) {
  const assetUrl = item.url || (item.fid ? getAssetImageUrl(item.fid, item.mediaToken) : '');
  const assetName = item.file_name || item.name || '选定素材';
  if (!assetUrl) {
    // 以前这里是静默 return：用户看着"已送入"，其实什么都没挂上，后面发送时才报引用失效。
    composerError.value = `「${assetName}」没有可用的图片地址（素材可能还在生成或缺少预览图），请换一张或在素材库里重新导入。`;
    return;
  }

  let asset = referenceTray.value.find(r => r.url === assetUrl);
  if (!asset) {
    const idx = referenceTray.value.length + 1;
    asset = {
      name: assetName,
      url: assetUrl,
      weight: 90,
      tag: `@图${idx}`,
      fid: item.fid,
      mediaToken: item.mediaToken,
    };
    referenceTray.value.push(asset);
    selectedImageIndex.value = referenceTray.value.length - 1;
  } else {
    selectedImageIndex.value = referenceTray.value.indexOf(asset);
  }

  if (item._openDrawer) {
    rightDrawerOpen.value = true;
  }

  if (item.category === 'video' || item.kind === 'video') {
    activeModality.value = 'video';
  } else if (item.category === 'audio' || item.kind === 'audio') {
    activeModality.value = 'music';
  } else {
    activeModality.value = 'image';
  }

  // 用户需求：增加了图片后对话框不自动新增图片引用，取消输入框自动关联
  selectedImageIndex.value = referenceTray.value.indexOf(asset);
  rememberSessionRefs([asset], 'upload', { persist: true });
}

/**
 * 素材库多选批量送入 AI 对话：一次挂载多个 @引用。
 * 受当前模型 refCap 限制（超出部分忽略并提示），其余与单件路径一致。
 */
function mountAssetsFromLibrary(items) {
  const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!list.length) return;
  const cap = refCap();
  const hardMax = 12; // 兜底上限：避免一次挂太多把输入区撑爆
  const limit = cap != null ? Math.min(cap, hardMax) : hardMax;
  const accepted = list.slice(0, limit);
  const dropped = list.length - accepted.length;

  referenceTray.value = accepted.map((item, idx) => ({
    name: item.file_name || item.name || `素材${idx + 1}`,
    url: item.url || getAssetImageUrl(item.fid, item.mediaToken) || '',
    weight: 90,
    tag: `@图${idx + 1}`,
    fid: item.fid,
    kind: item.kind === 'video' || item.media_type === 'video'
      ? 'video'
      : (item.kind === 'audio' || item.kind === 'music' || item.media_type === 'audio' || item.media_type === 'music')
        ? 'audio'
        : 'image'
  }));
  // 整盘重建，这里过滤不会破坏下标语义；但被过滤掉的必须说出来，
  // 否则用户拿到的是一张「素材明明送进来了却没挂上」的疑案。
  const unusable = referenceTray.value.filter((asset) => !asset.url);
  if (unusable.length) {
    referenceTray.value = referenceTray.value.filter((asset) => asset.url);
    referenceTray.value.forEach((asset, idx) => { asset.tag = `@图${idx + 1}`; });
  }
  rememberSessionRefs(referenceTray.value, 'upload', { persist: true });

  // 混选时以视频为准（视频模式可同时吃图片引用）；纯图片走图片模式
  const anyVideo = list.some((item) => item.kind === 'video' || item.media_type === 'video');
  if (anyVideo) {
    activeModality.value = 'video';
    autoSelectRefMode(['video']);
  } else {
    activeModality.value = 'image';
    autoSelectRefMode(['image']);
  }

  nextTick(() => {
    if (richEditorRef.value) {
      richEditorRef.value.innerHTML = '';
      appendRichSegmentText('参考 ');
      referenceTray.value.forEach((asset, idx) => {
        insertChipToEditor(asset);
        if (idx < referenceTray.value.length - 1) appendRichSegmentText('、');
      });
      appendRichSegmentText(' 的整体风格与元素，生成一张协调统一的新画面。');
    }
    if (dropped > 0) {
      composerError.value = `当前模型最多挂载 ${limit} 个引用，已忽略多出的 ${dropped} 个素材。`;
    }
    if (unusable.length) {
      composerNotice.value = `${unusable.length} 个素材没有可用的图片地址，已跳过（${unusable.map((a) => a.name).slice(0, 3).join('、')}${unusable.length > 3 ? ' 等' : ''}）。`;
    }
    // 托盘与正文这一刻才对齐，草稿要在这里补存一次：
    // watch 是 pre-flush，会抢在前面把「新托盘 + 旧正文」写进 localStorage，刷新后编号就错位了。
    saveDraftToStorage();
  });
}

function getEditorPlaceholder() {
  if (activeModality.value === 'chat') {
    return '输入空间设计疑问，或键入 @ 引用素材，键入 # 调用创作库配方...';
  } else if (activeModality.value === 'image') {
    return '描述画面构想；键入 @ 插入素材库图文混排胶囊（如：参考@图1的采光，换成@图2的沙发）；键入 # 调用创作库...';
  } else if (activeModality.value === 'video') {
    return '输入视频运镜描述；可定义@图1为首帧起点，@图2为目标落幅，描述镜头推拉流转...';
  } else if (audioOnlyModel()) {
    return '写下要说的话。先上传一段 10 到 15 秒的参考音频。';
  } else if (musicType.value === 'acestep_local') {
    return '纯音乐写风格。人声歌曲写成【风格】……【歌词】[主歌]……[副歌]……';
  } else {
    return '描述想要的音乐情绪、空间白噪音或影视级配乐风格...';
  }
}

function getSendButtonText() {
  if (activeModality.value === 'chat') return '发送提问';
  if (activeModality.value === 'image') return '立即生图';
  if (activeModality.value === 'video') return '立即生视频';
  if (audioOnlyModel()) return '生成语音';
  return '立即生音乐';
}

function switchModality(mode) {
  activeModality.value = mode;
}

function appendRichSegmentText(text) {
  if (!richEditorRef.value) return;
  const textNode = document.createTextNode(text);
  richEditorRef.value.appendChild(textNode);
}

function applyPromptText(txt) {
  if (!richEditorRef.value) return;
  richEditorRef.value.innerHTML = '';
  appendRichSegmentText(txt);
}

function cleanPromptText(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/^>\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function transferContentToPrompt(text, modality) {
  const cleaned = cleanPromptText(text);
  if (!cleaned) return;
  switchModality(modality === 'video' ? 'video' : 'image');
  applyPromptText(cleaned);
  composerNotice.value = `已快捷填入${modality === 'video' ? '生视频' : '生图'}提示词`;
  setTimeout(() => {
    if (composerNotice.value.startsWith('已快捷填入')) {
      composerNotice.value = '';
    }
  }, 2500);
}

const selectionBubble = reactive({
  visible: false,
  x: 0,
  y: 0,
  text: ''
});

// ===== 全局浮层栈登记 =====
// 旧 ESC 链（handleGlobalKeydown）覆盖的浮层必须全量登记：App.vue 的 capture ESC
// 在 hasOverlays() 为真时会吞掉事件，漏登记会导致该浮层既不在栈里又收不到 ESC 而关不掉。
// 对象型 ref 必须用 computed 包装：overlay-stack 的 watch 非 deep，直接传对象会因恒 truthy 永远占栈顶。
bindOverlays({
  selectionBubble: {
    ref: computed(() => !!selectionBubble.visible),
    close: () => { selectionBubble.visible = false; }
  },
  previewModal: {
    ref: computed(() => !!previewModal.value.visible),
    close: () => { previewModal.value.visible = false; }
  },
  detailModal: {
    ref: computed(() => !!detailModal.value.visible),
    close: () => { detailModal.value.visible = false; }
  },
  saveModal: {
    ref: computed(() => !!saveModal.value.visible),
    close: () => { saveModal.value.visible = false; }
  },
  assetSelector: showAssetSelector,
  // 全屏看图优先于抽屉：连续返回时先退全屏、再关抽屉
  libraryFullscreen: { ref: isLibraryFullscreen, priority: 20 },
  expandedLibrary: { ref: showExpandedLibrary, priority: 10 },
  rightDrawer: rightDrawerOpen,
  editModal: showEditModal,
  atMenu: showAtMenu,
  hashMenu: showHashMenu,
  previewModalV2: showPreviewModal,
  skillsMenu: showSkillsMenu,
  advanced: showAdvanced,
  advancedRules: showAdvancedRules
}, { prefix: 'chat-studio:' });

function handleChatTextSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    selectionBubble.visible = false;
    return;
  }
  const text = sel.toString().trim();
  if (text.length < 2) {
    selectionBubble.visible = false;
    return;
  }
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    selectionBubble.visible = false;
    return;
  }
  selectionBubble.x = Math.max(80, Math.min(window.innerWidth - 80, rect.left + rect.width / 2));
  selectionBubble.y = Math.max(30, rect.top - 8);
  selectionBubble.text = text;
  selectionBubble.visible = true;
}

function applySelectionPrompt(modality) {
  if (selectionBubble.text) {
    transferContentToPrompt(selectionBubble.text, modality);
  }
  selectionBubble.visible = false;
  window.getSelection()?.removeAllRanges();
}

function applyQuickStarter(rec) {
  if (!richEditorRef.value) return;
  richEditorRef.value.innerHTML = '';
  appendRichSegmentText(rec.desc);
}

function paintChipTag(chip, tag) {
  const currentTag = chip.getAttribute('data-tag') || '';
  const bracketMatch = currentTag.match(/\[([^\]]*)\]/);
  const finalTag = (bracketMatch && !tag.includes('[')) ? `${tag}[${bracketMatch[1]}]` : tag;
  chip.setAttribute('data-tag', finalTag);
  const span = [...chip.querySelectorAll('span')].find((el) => !el.classList.contains('inline-asset-delete'));
  if (span) span.textContent = finalTag;
}

function syncTrayFromEditor() {
  // 用户需求：取消输入框胶囊与看图区 referenceTray 的强绑定，不再因编辑器无胶囊清空看图区
  if (!richEditorRef.value) return;
  const chips = [...richEditorRef.value.querySelectorAll('.inline-asset-chip')];
  chips.forEach((chip) => {
    const url = chip.getAttribute('data-url') || '';
    if (!url) return;
    const existing = referenceTray.value.find((item) => item && item.url === url);
    if (existing) {
      paintChipTag(chip, existing.tag);
    }
  });
}

/** 给一个引用地址做"能不能用"的判定并尽量换新凭证；返回 '' 表示彻底救不回来。 */
function reviveRefUrl({ fid = '', url = '', mediaToken = '' } = {}) {
  if (fid) {
    const fresh = getAssetImageUrl(fid, mediaToken);
    if (fresh) return fresh;
  }
  if (!url) return '';
  if (url.startsWith('blob:')) return localFileByUrl.has(url) ? url : '';
  if (url.startsWith('/api/')) return resignAssetUrl(url) || '';
  if (url.startsWith('data:')) return url;
  if (/^https?:/i.test(url)) return url;
  if (url.startsWith('/')) return url;
  return '';
}

/**
 * 发送前的引用自愈（不阻断发送）。
 *
 * 素材本身没坏，坏的是「编辑器胶囊」和「referenceTray」这两份状态对不上：
 * 胶囊有 fid 却没有 URL、陈旧 token 的 /api 地址、切板块后失效的 blob、编号指向不存在的槽位……
 * 这里先按 fid/凭证把能救的都救回来，再把确实没有地址的槽位摘掉，
 * 最后按托盘顺序重排 @图N，保证「胶囊编号 = 托盘下标 = 出站图片顺序」三者永远一致。
 */
function repairReferenceChips() {
  const editor = richEditorRef.value;
  let repaired = 0;
  let downgraded = 0;

  if (editor) {
    for (const chip of [...editor.querySelectorAll('.inline-asset-chip')]) {
      const fid = chip.getAttribute('data-fid') || '';
      const url = chip.getAttribute('data-url') || '';
      const fixed = reviveRefUrl({ fid, url });
      if (!fixed) continue;
      if (fixed !== url) {
        chip.setAttribute('data-url', fixed);
        repaired += 1;
      }
      chip.setAttribute('data-resolved', '1');
    }
  }

  // 托盘侧同样体检：没有胶囊的挂载项（单张挂载/草稿恢复）也要救，救不了就摘掉
  const kept = [];
  for (const asset of referenceTray.value) {
    if (!asset) continue;
    const fixed = reviveRefUrl({ fid: asset.fid, url: asset.url, mediaToken: asset.mediaToken });
    if (!fixed) {
      downgraded += 1;
      continue;
    }
    if (fixed !== asset.url) repaired += 1;
    kept.push({ ...asset, url: fixed, resolved: true });
  }
  referenceTray.value = kept;

  // 重排编号：tray 顺序即编号，胶囊跟着 tray 走；对不上的胶囊降级成纯文本
  referenceTray.value.forEach((asset, idx) => {
    asset.tag = `@图${idx + 1}`;
  });
  if (editor) {
    for (const chip of [...editor.querySelectorAll('.inline-asset-chip')]) {
      const fid = chip.getAttribute('data-fid') || '';
      const url = chip.getAttribute('data-url') || '';
      const idx = referenceTray.value.findIndex(
        (asset) => asset && ((fid && asset.fid === fid) || (url && asset.url === url))
      );
      if (idx < 0) {
        const num = (chip.getAttribute('data-tag') || '').match(/@图(\d+)/)?.[1] || '';
        chip.replaceWith(document.createTextNode(`（原@图${num}已失效）`));
        downgraded += 1;
        continue;
      }
      const tag = `@图${idx + 1}`;
      // 用 paintChipTag 而不是直接写文本：它能保留 @图1[沙发] 这类区域后缀
      paintChipTag(chip, tag);
    }
  }

  return { repaired, downgraded };
}
let savedSelectionRange = null;

function saveEditorSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && richEditorRef.value) {
    const range = sel.getRangeAt(0);
    if (richEditorRef.value.contains(range.commonAncestorContainer)) {
      savedSelectionRange = range.cloneRange();
      return savedSelectionRange;
    }
  }
  return null;
}

function editorHasRawMention() {
  if (!richEditorRef.value) return false;
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return /@(?:图|图片|视频|音频)\d+/.test(node.nodeValue || '');
    if (node.nodeType === Node.ELEMENT_NODE && !(node.classList && node.classList.contains('inline-asset-chip'))) {
      return [...node.childNodes].some(walk);
    }
    return false;
  };
  return [...richEditorRef.value.childNodes].some(walk);
}
function reparseEditorChips(extraAssets) {
  if (!richEditorRef.value || reparsingEditor) return;
  const text = getRawEditorText();
  const nums = [...new Set(
    [...text.matchAll(/@(?:图片|图|视频|音频)(\d+)/g)]
      .map((m) => parseInt(m[1], 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  )];
  if (!nums.length) {
    syncTrayFromEditor();
    return;
  }
  // 只做「把正文里的 @图N 文本绑成胶囊」，绝不重建/覆盖托盘：
  // 以前这里按名字 map 出一份新托盘，名字对不上就塞 url:'' 的空项，一次输入就把整盘素材抹掉，
  // 还顺带留下发不出去的死标签。现在对不上的编号保持纯文本即可。
  const bindable = nums.filter((n) => {
    const asset = referenceTray.value[n - 1];
    return Boolean(asset && (asset.url || asset.fid));
  });
  if (!bindable.length) return;
  reparsingEditor = true;
  restorePromptContent(text, referenceTray.value);
  syncTrayFromEditor();
  reparsingEditor = false;
}
function onEditorInput() {
  saveEditorSelection();
  // 检查光标前刚刚输入的字符
  const sel = window.getSelection();
  let cursorChar = '';
  if (sel && sel.rangeCount > 0 && richEditorRef.value) {
    const range = sel.getRangeAt(0);
    const container = range.startContainer;
    const offset = range.startOffset;
    if (container.nodeType === Node.TEXT_NODE && offset > 0) {
      cursorChar = container.nodeValue.slice(offset - 1, offset);
    }
  }
  const text = getRawEditorText();

  // 1. # 符号菜单触发：光标前为 # 或文本末尾为 #
  if (cursorChar === '#' || text.endsWith('#')) {
    showHashMenu.value = true;
  } else if (!text.includes('#')) {
    showHashMenu.value = false;
  }

  // 2. @ 符号菜单触发：光标前输入 @ 或全角 ＠，或者文本末尾为 @/＠ 时立即呼出！
  if (cursorChar === '@' || cursorChar === '＠' || text.endsWith('@') || text.endsWith('＠')) {
    if (referenceTray.value.length > 0) {
      showAtMenu.value = true;
    } else {
      openAssetSelectorModal();
    }
  } else if (!cursorChar.includes('@') && !cursorChar.includes('＠') && !text.includes('@') && !text.includes('＠')) {
    showAtMenu.value = false;
  }
  if (reparsingEditor) return;
  if (editorHasRawMention()) reparseEditorChips([]);
  else syncTrayFromEditor();
}

function onEditorKeyup(e) {
  if (reparsingEditor) return;
  if (e.key === 'Backspace' || e.key === 'Delete') syncTrayFromEditor();
}

function pushPromptHistory(text, tray, extra = {}) {
  const recipe = extra.recipePrompt ?? (recipePrompt.value || '');
  const globalRecipe = extra.globalRecipePrompt ?? (globalRecipePrompt.value || '');
  const supplement = extra.supplementText ?? (getRawEditorText() || '');
  const selIdx = extra.selectedImageIndex ?? (selectedImageIndex.value || 0);
  const mode = extra.genMode ?? activeModality.value;
  const fullRecipe = [recipe, globalRecipe].map(s => (s || '').trim()).filter(Boolean).join('\n');
  const fullText = text || [fullRecipe, supplement].filter(Boolean).join('\n');
  if (!fullText && (!tray || tray.length === 0)) return;

  const last = promptHistory.value[promptHistory.value.length - 1];
  if (last && last.text === fullText && JSON.stringify(last.tray) === JSON.stringify(tray)) return;

  promptHistory.value.push({
    text: fullText,
    tray: Array.isArray(tray) ? JSON.parse(JSON.stringify(tray)) : [],
    recipePrompt: recipe,
    globalRecipePrompt: globalRecipe,
    supplementText: supplement,
    selectedImageIndex: selIdx,
    genMode: mode
  });
  historyIndex.value = promptHistory.value.length;
}

const CHINESE_NUM_MAP = { '一': '1', '二': '2', '两': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };

function normalizeRefMentions(text) {
  let s = String(text || '').replace(/<(Picture|Audio|Video)\s+(\d+)\s*>/gi, (_, kind, n) => {
    const word = { picture: '图片', audio: '音频', video: '视频' }[String(kind).toLowerCase()] || '图片';
    return `@${word}${n}`;
  });
  // 自然语言口语化映射：如“第1张图”、“第2张图片”、“图一”、“图二”
  s = s.replace(/第\s*([一二两三四五六七八九十\d]+)\s*张\s*(?:图片|图)/g, (_, d) => `@图${CHINESE_NUM_MAP[d] || d}`);
  s = s.replace(/(?:图片|图)\s*([一二两三四五六七八九十])(?!\w)/g, (_, d) => `@图${CHINESE_NUM_MAP[d] || d}`);
  return s;
}

function mentionedRefNumbers(text) {
  const nums = new Set();
  const regex = /@(图片|视频|音频|图)(\d+)/g;
  let match;
  while ((match = regex.exec(normalizeRefMentions(text)))) nums.add(Number(match[2]));
  return nums;
}

function withKeptRefMentions(text, tray) {
  const items = (Array.isArray(tray) ? tray : []).filter((item) => item && item.url);
  if (!items.length) return text;
  const mentioned = mentionedRefNumbers(text);
  const missing = items.filter((_, index) => !mentioned.has(index + 1));
  if (!missing.length) return text;
  const prefix = missing.map((item, index) => {
    const kind = mediaKind(item);
    const word = kind === 'audio' ? '音频' : (kind === 'video' ? '视频' : '图片');
    const num = (Array.isArray(tray) ? tray : []).indexOf(item) + 1;
    return `@${word}${num || index + 1}`;
  }).join(' ');
  return `${prefix} ${String(text || '')}`.trim();
}

/**
 * 按「@图N / 名字」反查托盘素材，尽量让引用落在一个真有 URL 的素材上。
 * 顺序：托盘第 N 位（缺 URL 时按 fid 重签）→ 托盘里同名项 → 本会话素材池里同名项。
 * 返回 null 表示确实对不上，调用方应降级成纯文本，而不是造空胶囊。
 */
function resolveTrayAssetForMention(num, bracketName) {
  const pick = (asset) => {
    if (!asset) return null;
    if (asset.url) return asset;
    if (asset.fid) {
      const resigned = getAssetImageUrl(asset.fid, asset.mediaToken);
      if (resigned) return { ...asset, url: resigned, resolved: true };
    }
    return null;
  };
  const slot = pick(referenceTray.value[num - 1]);
  if (slot) return slot;
  const wanted = String(bracketName || '').trim();
  if (!wanted) return null;
  const pool = [...referenceTray.value, ...sessionRefPool.value];
  for (const asset of pool) {
    if (!asset) continue;
    if (asset.name === wanted || asset.file_name === wanted) {
      const hit = pick(asset);
      if (hit) return hit;
    }
  }
  return null;
}

function restorePromptContent(itemOrText, optionalTray) {
  let targetText = '';
  let targetTray = [];
  let targetRecipe = '';
  let targetGlobalRecipe = '';
  let targetSupplement = '';
  let targetSelIdx = 0;

  if (itemOrText && typeof itemOrText === 'object') {
    targetText = itemOrText.text || '';
    targetTray = itemOrText.tray || [];
    targetRecipe = itemOrText.recipePrompt || '';
    targetGlobalRecipe = itemOrText.globalRecipePrompt || '';
    targetSupplement = itemOrText.supplementText || '';
    targetSelIdx = itemOrText.selectedImageIndex ?? 0;
  } else {
    targetText = String(itemOrText || '');
    targetTray = Array.isArray(optionalTray) ? optionalTray : [];
  }

  // 1. 恢复参考托盘数据并展开看图区工作台
  referenceTray.value = Array.isArray(targetTray) ? JSON.parse(JSON.stringify(targetTray)) : [];
  if (referenceTray.value.length > 0) {
    viewerCollapsed.value = false;
    selectedImageIndex.value = Math.min(Math.max(0, targetSelIdx), referenceTray.value.length - 1);
  }

  // 2. 恢复配方句与补充文本分流
  if (!targetRecipe && targetText.includes('\n') && (targetText.startsWith('【') || targetText.startsWith('# '))) {
    const paragraphs = targetText.split(/\n(?=【)/);
    if (paragraphs.length > 1) {
      const lastP = paragraphs[paragraphs.length - 1].trim();
      const isStandardHeader = /^【(全局禁止|画面品质|材质|相机|摆放朝向|任务目标|图片角色约定|空间)/.test(lastP);
      if (!isStandardHeader) {
        targetRecipe = paragraphs.slice(0, -1).join('\n');
        targetSupplement = lastP;
      } else {
        targetRecipe = targetText;
        targetSupplement = '';
      }
    } else {
      targetRecipe = targetText;
      targetSupplement = '';
    }
  }

  recipePrompt.value = targetRecipe;
  globalRecipePrompt.value = targetGlobalRecipe;

  // 3. 清空并恢复富文本编辑器
  if (!richEditorRef.value) return;
  richEditorRef.value.innerHTML = '';

  const sourceText = targetSupplement || (targetRecipe ? '' : targetText);
  const normalized = normalizeRefMentions(sourceText);
  // 若配方句为空且正文完全未提及任何托盘图，适度补偿缺失的 @图N
  const source = targetRecipe ? normalized : withKeptRefMentions(normalized, referenceTray.value);
  if (!source) {
    syncTrayFromEditor();
    syncGenModeWithReferenceTray();
    return;
  }

  const regex = /@(图片|视频|音频|图)(\d+)(?:\[([^\]]*)\])?/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    if (match.index > lastIdx) appendRichSegmentText(source.slice(lastIdx, match.index));
    const num = parseInt(match[2], 10);
    const bracketName = match[3] || '';
    // 反查顺序：托盘第 N 位 → 靠名字在托盘/本会话素材池里找。
    // 以前这里找不到就直接造一个 url:'' 的「死胶囊」，它会让整条消息发不出去，
    // 而素材本身其实好好的，只是编号挪位了。
    const matchedAsset = resolveTrayAssetForMention(num, bracketName);
    if (!matchedAsset) {
      appendRichSegmentText(`（引用素材${num}已不在当前参考图中）`);
      lastIdx = regex.lastIndex;
      continue;
    }

    let customTag = `@图${num}`;
    let regionKey = null;
    if (bracketName) {
      customTag = `@图${num}[${bracketName}]`;
      const reg = Array.isArray(matchedAsset.regions)
        ? matchedAsset.regions.find(r => r.name === bracketName || r.id === bracketName)
        : null;
      regionKey = reg ? `${num - 1}_${reg.id}` : `${num - 1}_${bracketName}`;
    }
    insertChipToEditor(matchedAsset, customTag, regionKey);
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < source.length) appendRichSegmentText(source.slice(lastIdx));
  syncTrayFromEditor();
  syncGenModeWithReferenceTray();
}

function handleEditorArrowKey(direction) {
  if (promptHistory.value.length === 0) return false;

  if (direction === 'up') {
    if (historyIndex.value >= promptHistory.value.length) {
      currentDraftState = {
        text: getFullPromptText(),
        supplementText: getRawEditorText(),
        recipePrompt: recipePrompt.value || '',
        globalRecipePrompt: globalRecipePrompt.value || '',
        tray: JSON.parse(JSON.stringify(referenceTray.value || [])),
        selectedImageIndex: selectedImageIndex.value || 0
      };
      currentDraftText = currentDraftState.text;
      currentDraftTray = currentDraftState.tray;
    }
    if (historyIndex.value > 0) {
      historyIndex.value--;
      const item = promptHistory.value[historyIndex.value];
      restorePromptContent(item);
      return true;
    }
  } else if (direction === 'down') {
    if (historyIndex.value < promptHistory.value.length - 1) {
      historyIndex.value++;
      const item = promptHistory.value[historyIndex.value];
      restorePromptContent(item);
      return true;
    } else if (historyIndex.value === promptHistory.value.length - 1) {
      historyIndex.value = promptHistory.value.length;
      if (currentDraftState) {
        restorePromptContent(currentDraftState);
      } else {
        restorePromptContent('', []);
      }
      return true;
    }
  }
  return false;
}

function onEditorKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  } else if (e.key === 'ArrowUp') {
    if (handleEditorArrowKey('up')) {
      e.preventDefault();
    }
  } else if (e.key === 'ArrowDown') {
    if (handleEditorArrowKey('down')) {
      e.preventDefault();
    }
  }
}

function getRawEditorText() {
  if (!richEditorRef.value) return '';
  let result = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.nodeValue;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.classList && node.classList.contains('inline-asset-chip')) {
        const tag = node.getAttribute('data-tag') || '@图1';
        const name = node.getAttribute('data-name') || '';
        if (tag.includes('[')) {
          result += ` ${tag} `;
        } else if (name) {
          result += ` ${tag}[${name}] `;
        } else {
          result += ` ${tag} `;
        }
      } else {
        node.childNodes.forEach(walk);
      }
    }
  };
  richEditorRef.value.childNodes.forEach(walk);
  return result.trim();
}

function insertChipToEditor(asset, customTag = null, regionKey = null) {
  if (!richEditorRef.value) return;
  const chip = document.createElement('span');
  chip.className = 'inline-asset-chip';
  chip.contentEditable = 'false';
  const foundIdx = referenceTray.value.findIndex(r => (r.url && r.url === asset.url) || (r.fid && r.fid === asset.fid) || r === asset);
  const tuNum = foundIdx >= 0 ? (foundIdx + 1) : (referenceTray.value.length || 1);
  const tag = customTag || asset.tag || `@图${tuNum}`;
  chip.setAttribute('data-tag', tag);
  chip.setAttribute('data-name', asset.name || '');
  chip.setAttribute('data-url', asset.url || '');
  chip.setAttribute('data-fid', asset.fid || '');
  chip.setAttribute('data-kind', asset.kind || 'image');
  chip.setAttribute('data-origin', asset.origin || 'upload');
  chip.setAttribute('data-resolved', asset.url && asset.resolved !== false ? '1' : '0');
  if (regionKey) {
    chip.setAttribute('data-region-key', regionKey);
    chip.onmouseenter = () => { hoveredRegionKey.value = regionKey; };
    chip.onmouseleave = () => { hoveredRegionKey.value = null; };
  }
  chip.onclick = () => {
    if (asset.url) openMediaPreview(asset);
  };

  const textSpan = document.createElement('span');
  textSpan.innerText = tag;

  const delBtn = document.createElement('span');
  delBtn.className = 'inline-asset-delete';
  delBtn.innerText = '×';
  delBtn.onclick = (e) => {
    e.stopPropagation();
    chip.remove();
    syncTrayFromEditor();
  };

  chip.appendChild(textSpan);
  chip.appendChild(delBtn);

  // 关键改进：如果在当前光标或已保存选区处有 @，就地替换 @；并在选区处插入芯片
  let inserted = false;
  const sel = window.getSelection();
  let range = (sel && sel.rangeCount > 0 && richEditorRef.value.contains(sel.getRangeAt(0).commonAncestorContainer))
    ? sel.getRangeAt(0)
    : savedSelectionRange;

  if (range && richEditorRef.value.contains(range.commonAncestorContainer)) {
    const container = range.startContainer;
    const offset = range.startOffset;
    if (container.nodeType === Node.TEXT_NODE && offset > 0) {
      const prevChar = container.nodeValue.slice(offset - 1, offset);
      if (prevChar === '@' || prevChar === '＠') {
        container.nodeValue = container.nodeValue.slice(0, offset - 1) + container.nodeValue.slice(offset);
        range.setStart(container, offset - 1);
        range.setEnd(container, offset - 1);
      }
    }
    range.collapse(true);
    range.insertNode(chip);
    const spaceNode = document.createTextNode(' ');
    if (chip.nextSibling) {
      chip.parentNode.insertBefore(spaceNode, chip.nextSibling);
    } else {
      chip.parentNode.appendChild(spaceNode);
    }
    range.setStartAfter(spaceNode);
    range.setEndAfter(spaceNode);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    inserted = true;
  }

  if (!inserted) {
    const last = richEditorRef.value.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) {
      last.nodeValue = String(last.nodeValue || '').replace(/[@＠]\s*$/, '');
    }
    richEditorRef.value.appendChild(chip);
    richEditorRef.value.appendChild(document.createTextNode(' '));
  }
  richEditorRef.value.focus();
  savedSelectionRange = null;
  syncTrayFromEditor();
}

const localFileByUrl = new Map();

/**
 * 产物图取图：素材路由与 temp 直链互为备胎。
 * 两边都会被清理（衍生图在 cache/derivatives、产物在 cache/temp，实测各有被删的时候），
 * 谁还活着就用谁；两条都失败才报错，并把真实原因（HTTP 状态 / 混合内容拦截）显示出来。
 */
function resultImageCandidates(msg) {
  const list = [];
  if (msg.assetFid) list.push(authedMediaUrl(getAssetImageUrl(msg.assetFid)));
  if (msg.imageUrl) list.push(authedMediaUrl(msg.imageUrl));
  return list.filter(Boolean);
}

function resultImageSrc(msg) {
  const list = resultImageCandidates(msg);
  const url = list[Math.min(msg.imgSrcIdx || 0, list.length - 1)] || '';
  // 重试/换路必须换 URL：路径 + token 全一致时浏览器直接吃本地缓存，「重新加载」点了等于没点
  return url && msg.imgRetry ? `${url}${url.includes('?') ? '&' : '?'}_r=${msg.imgRetry}` : url;
}

// HTTPS 页面里拼出 http:// 的媒体地址，浏览器会直接拦掉（@error 但不给状态码），先本地判出来
function mixedContentHint(url) {
  return window.location.protocol === 'https:' && /^http:\/\//i.test(String(url)) ? 'HTTPS 页面请求 HTTP 资源被浏览器拦截' : '';
}

async function probeMediaError(msg, url) {
  const local = mixedContentHint(url);
  if (local) { msg.imgErr = local; return; }
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    msg.imgErr = `HTTP ${res.status}`;
    // 401/403 不是「这张图没了」，是「你没登录」：两条路由带同一个 token，一起死，
    // 换备胎只是多破一张图。直接把会话作废并要登录，登录框起来后图片会自动重签重出。
    if (res.status === 401 || res.status === 403) {
      msg.imgAuth = true;
      reportUnauthorized();
    }
  } catch (e) {
    msg.imgErr = '请求没发出去或连接被重置';
  }
}

async function onResultImgError(msg) {
  if (msg.imgAuth) return; // 已经在要登录了，别继续刷破图
  const list = resultImageCandidates(msg);
  const idx = msg.imgSrcIdx || 0;
  if (idx === 0) {
    // 先花一次 HEAD 判性质：鉴权问题当场提醒，别等用户把两条路都跑完、对着破图猜
    await probeMediaError(msg, list[0]);
    if (msg.imgAuth) { msg.imgFailed = true; return; }
    msg.imgErr = '';
  }
  if (idx + 1 < list.length) {
    msg.imgSrcIdx = idx + 1;   // 先换另一条路，不打扰用户
    return;
  }
  await probeMediaError(msg, list[idx]);
  msg.imgFailed = true;
}

// 登录成功后 URL 里换了新 token，图重新加载出来就把失败态清掉，不用人再点一次
function onResultImgLoad(msg) {
  if (!msg.imgFailed && !msg.imgErr && !msg.imgAuth) return;
  msg.imgFailed = false;
  msg.imgErr = '';
  msg.imgAuth = false;
  msg.imgSrcIdx = 0;
}

function retryResultImage(msg) {
  msg.imgFailed = false;
  msg.imgErr = '';
  msg.imgAuth = false;
  msg.imgSrcIdx = 0;
  msg.imgRetry = (msg.imgRetry || 0) + 1;
  bumpMediaAuth();
}

// 下载同理：temp 目录里的产物会过期，有 fid 就取原文件
function resultImageDownloadHref(msg) {
  return authedMediaUrl(msg.assetFid ? getAssetDownloadUrl(msg.assetFid) : msg.imageUrl);
}

// 「下载 MP4」原先是裸 <a href> —— 浏览器下载器不带 Authorization，Cookie 又只在登录那台
// 源上有效，服务端就回 401「需要授权」。改为先用 authFetch（带 Bearer）取 blob 再落盘。
async function downloadGeneratedMedia(raw, label) {
  const url = String(raw || '');
  if (!url) return;
  const name = label || decodeURIComponent(url.split('/').pop().split('?')[0] || 'generated');
  // 优先直接使用服务端带 token 直链下载（带 download=1 触发流式 disposition），避免内存膨胀与 blob 销毁时机问题
  try {
    const directUrl = authedMediaUrl(url) + (url.includes('?') ? '&download=1' : '?download=1');
    const a = document.createElement('a');
    a.href = directUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    // 降级使用 fetch 转 blob
    try {
      const res = await authFetch(url, { method: 'GET', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 120000);
    } catch (err) {
      alert(`下载失败：${err.message}`);
    }
  }
}

// 下载文件名：原先硬编码 space_cinematic.mp4，多条视频全同名，落盘后无法对应
function videoFileName(msg) {
  const base = decodeURIComponent(String(msg?.videoUrl || '').split('/').pop().split('?')[0] || '');
  const ext = (base.match(/\.(mp4|webm|mov)$/i) || [, '.mp4'])[1];
  const slug = String(msg?.prompt || msg?.content || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 18);
  return `${slug || '视频'}${ext}`;
}

function messageAttachments(msg) {
  const refs = Array.isArray(msg?.refs) ? msg.refs.filter((item) => item && item.url) : [];
  if (refs.length) return refs;
  const images = Array.isArray(msg?.images) ? msg.images : [];
  const names = namesInPrompt(msg?.content);
  return images.filter(Boolean).map((url, index) => ({
    url,
    name: labelForRef(url, names[index]),
    kind: 'image',
    tag: `@图${index + 1}`,
  }));
}

function parseRichSegments(content, msg) {
  if (!content) return [];
  const segments = [];
  const regex = /(@(?:图|图片|视频|音频)(\d+))(?:\[([^\]]*)\])?/g;
  const refs = messageAttachments(msg || {});
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', text: content.slice(lastIdx, match.index) });
    }
    const tag = match[1];
    const num = parseInt(match[2], 10);
    const bracketContent = (match[3] || '').trim();
    const matchedAsset = refs[num - 1] || (bracketContent ? refs.find((item) => item.name === bracketContent) : null) || null;
    const thumb = matchedAsset && matchedAsset.url && mediaKind(matchedAsset) === 'image' && matchedAsset.url !== '/favicon.ico'
      ? matchedAsset.url
      : '';

    segments.push({
      type: 'chip',
      tag,
      name: bracketContent,
      thumb,
      ref: matchedAsset,
    });

    if (bracketContent && bracketContent.startsWith('区域')) {
      segments.push({ type: 'text', text: `[${bracketContent}]` });
    }

    lastIdx = regex.lastIndex;
  }

  if (lastIdx < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIdx) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', text: content }];
}

function formatTokenCount(value) {
  const count = Number(value) || 0;
  if (count >= 1000000) return `${Math.round(count / 1048576)}M token`;
  if (count >= 1000) return `${Math.round(count / 1024)}k token`;
  return `${count} token`;
}

const contextTrim = computed(() => {
  const model = (studioModels.value.chat || []).find((item) => item.id === chatModelKey.value);
  const budget = contextBudgetTokens(model?.contextTokens);
  const trimmed = trimChatMessages(messages.value, budget);
  return { budget, windowTokens: model?.contextTokens || null, ...trimmed };
});
const contextNote = computed(() => {
  const info = contextTrim.value;
  const dropped = info.dropped > 0 ? `，更早 ${info.dropped} 轮已让出` : '';
  return `上下文 ${info.kept} 轮 · 上限 ${formatTokenCount(info.budget)}${dropped}`;
});
const contextNoteTitle = computed(() => {
  const info = contextTrim.value;
  const windowText = info.windowTokens
    ? `这个模型窗口 ${formatTokenCount(info.windowTokens)}。`
    : '这个模型没有标明窗口。';
  return `${windowText}单次最多带上 ${formatTokenCount(info.budget)}，避免上下文过大导致这一轮失败。`;
});

function stripScaffold(text) {
  const withoutThought = String(text || '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<thought>[\s\S]*$/gi, '');
  return withoutThought
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\d+\.\s+\*\*/.test(trimmed)) return false;
      if (/^\*\s+\*\*/.test(trimmed)) return false;
      if (/^self-correction/i.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function analysisIsUsable(text) {
  const cjk = (String(text || '').match(/[\u3400-\u9fff]/g) || []).length;
  if (cjk >= 20) return true;
  if (/identify the user|overall impression|structure the response|light source & direction/i.test(text || '')) return false;
  return cjk >= 8 && String(text || '').length >= 80;
}

function latestChatAnalysis() {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const message = messages.value[i];
    if (message.role !== 'assistant' || message.isError) continue;
    if (message.modality && message.modality !== 'chat') continue;
    const cleaned = stripScaffold(message.content);
    if (cleaned) return cleaned.slice(0, 1800);
  }
  return '';
}

function priorMedia() {
  const found = [];
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const message = messages.value[i];
    if (message.role !== 'user') continue;
    for (const ref of messageAttachments(message)) {
      if (!ref.url || found.some((item) => item.url === ref.url)) continue;
      found.push(ref);
    }
  }
  return found;
}

function carryPriorRefs(currentTray) {
  return currentTray || [];
}

function promptWithPriorAnalysis(rawContent, carriedCount) {
  const analysis = latestChatAnalysis();
  if (analysisIsUsable(analysis)) {
    return `${rawContent}\n\n沿用同一会话里先前的画面分析，空间、材质和光影保持一致：\n${analysis}`;
  }
  if (carriedCount > 0) {
    return `${rawContent}\n\n参考已挂载的先前对话图片，沿用它的空间、材质和光影，不要换成另一种风格。`;
  }
  return rawContent;
}

async function portableImageUrl(ref) {
  const url = String(ref?.url || '');
  if (!url || url === '/favicon.ico') return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('data:image/')) return url;
  if (!url.startsWith('blob:')) return '';
  const file = localFileByUrl.get(url);
  // 上限放宽到 12MB：服务端会 sharp 压缩，压不到 1.5MB 再走 OSS 公网兜底。
  if (!file || file.size > 12 * 1024 * 1024) return '';
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

async function portableImageUrls(refs, limit) {
  const urls = [];
  for (const ref of refs) {
    if (urls.length >= limit) break;
    if (mediaKind(ref) !== 'image') continue;
    const url = await portableImageUrl(ref);
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * 配方要长期存库，而引用 URL 里带的 `?token=` 是当前会话签发的短期凭证：
 * 原样存进创作库，下次复用必然 401。有 fid 的一律剥掉 token，复用时重新签发。
 */
function recipeRefsForStorage(refs) {
  return (Array.isArray(refs) ? refs : []).map((ref) => {
    const url = String(ref?.url || '');
    const fid = ref?.fid || '';
    let stored = url;
    if (fid && url.startsWith('/api/')) {
      try {
        const u = new URL(url, window.location.origin);
        u.searchParams.delete('token');
        stored = `${u.pathname}${u.search}`;
      } catch {
        stored = url;
      }
    }
    return {
      name: ref?.name || '',
      fid,
      kind: ref?.kind || 'image',
      weight: ref?.weight ?? 85,
      tag: ref?.tag || '',
      url: stored
    };
  });
}

async function portableAudioUrl(ref) {
  const url = String(ref?.url || '');
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('data:audio/')) return url;
  if (!url.startsWith('blob:')) return '';
  const file = localFileByUrl.get(url);
  if (!file || file.size > 8 * 1024 * 1024) return '';
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

async function portableAudioUrls(refs, limit) {
  const urls = [];
  for (const ref of refs) {
    if (urls.length >= limit) break;
    if (mediaKind(ref) !== 'audio') continue;
    const url = await portableAudioUrl(ref);
    if (url) urls.push(url);
  }
  return urls;
}

async function loadTagVocab() {
  try {
    const res = await authFetch('/api/tag-vocab');
    const json = await res.json();
    if (json.success && json.data) {
      tagVocab.value = {
        space: json.data.space || [],
        style_atom: json.data.style_atom || [],
        video_purpose: json.data.video_purpose || [],
      };
    }
  } catch (e) {
    console.warn('加载标签词表失败', e);
  }
}

// 视口与懒加载状态管理
const visibleCardIds = ref(new Set());
const forbiddenAspectTplIds = new Set();
let cardIntersectionObserver = null;

function isCardInViewport(id) {
  return visibleCardIds.value.has(id);
}

function getTemplateAspectRatio(tpl) {
  if (tpl.poster_w > 0 && tpl.poster_h > 0) {
    return `${tpl.poster_w} / ${tpl.poster_h}`;
  }
  if (tpl.aspect_ratio && tpl.aspect_ratio !== '16:9') {
    const parts = String(tpl.aspect_ratio).split(':');
    if (parts.length === 2 && Number(parts[0]) > 0 && Number(parts[1]) > 0) {
      return `${parts[0]} / ${parts[1]}`;
    }
  }
  return '1 / 1';
}

function onVideoLoadedMetadata(e, tpl) {
  if (!tpl || forbiddenAspectTplIds.has(tpl.id)) return;
  const video = e.target;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  if (!tpl.poster_w || !tpl.poster_h) {
    tpl.poster_w = vw;
    tpl.poster_h = vh;
    tpl.aspect_ratio = `${vw}:${vh}`;
    authFetch(`/api/creation-templates/${encodeURIComponent(tpl.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poster_w: vw,
        poster_h: vh,
        aspect_ratio: `${vw}:${vh}`
      })
    }).then(res => {
      if (res.status === 403) {
        forbiddenAspectTplIds.add(tpl.id);
      }
    }).catch(() => {});
  }
}

function setupCardObserver() {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
  if (cardIntersectionObserver) cardIntersectionObserver.disconnect();
  cardIntersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const id = entry.target.getAttribute('data-tpl-id');
      if (!id) return;
      if (entry.isIntersecting) {
        visibleCardIds.value.add(id);
      } else {
        visibleCardIds.value.delete(id);
      }
    });
  }, { rootMargin: '200px' });

  nextTick(() => {
    const elements = document.querySelectorAll('[data-tpl-id]');
    elements.forEach(el => cardIntersectionObserver.observe(el));
  });
}

watch(filteredTemplates, () => {
  nextTick(() => {
    if (cardIntersectionObserver) {
      const elements = document.querySelectorAll('[data-tpl-id]');
      elements.forEach(el => cardIntersectionObserver.observe(el));
    }
  });
});

async function loadTemplates() {
  await loadTagVocab();
  const user = getCurrentUser();
  const userId = user?.id || user?.username || 'default';

  // 1. 先读本地 IndexedDB 缓存
  try {
    const cached = await getTemplatesCache(userId);
    if (cached && Array.isArray(cached.templates) && cached.templates.length > 0) {
      templates.value = cached.templates;
      sortTemplates();
      setupCardObserver();
      prewarmPreviewImages(cached.templates, 48);
    }
  } catch (e) {
    console.warn('读取创作库本地缓存异常:', e);
  }

  // 2. 增量刷新
  try {
    const cached = await getTemplatesCache(userId);
    let pageSince = cached.row_cursor;
    let pageTomb = cached.tomb_cursor;

    // 两支游标均无，直接全量拉取
    if (!pageSince && !pageTomb) {
      const fullRes = await fetchCreationTemplatesIncremental();
      if (fullRes.success && Array.isArray(fullRes.data)) {
        templates.value = fullRes.data;
        sortTemplates();
        setupCardObserver();
        await replaceTemplatesCache(
          fullRes.data,
          {
            row_cursor: fullRes.next_since,
            tomb_cursor: { deleted_at: fullRes.server_time, id: '' }
          },
          userId
        );
      }
      return;
    }

    // 增量循环翻页合并
    let hasMoreRows = pageSince !== null;
    let hasMoreTombs = pageTomb !== null;
    let loopCount = 0;

    while ((hasMoreRows || hasMoreTombs) && loopCount < 50) {
      loopCount++;
      const deltaRes = await fetchCreationTemplatesIncremental({
        since: pageSince ? pageSince.updated_at : undefined,
        sinceId: pageSince ? pageSince.id : undefined,
        deletedSince: pageTomb ? pageTomb.deleted_at : undefined,
        deletedSinceId: pageTomb ? pageTomb.id : undefined
      });

      if (!deltaRes.success) break;

      if (deltaRes.resync) {
        await clearTemplatesCache();
        const fullRes = await fetchCreationTemplatesIncremental();
        if (fullRes.success && Array.isArray(fullRes.data)) {
          templates.value = fullRes.data;
          sortTemplates();
          setupCardObserver();
          await replaceTemplatesCache(
            fullRes.data,
            {
              row_cursor: fullRes.next_since,
              tomb_cursor: { deleted_at: fullRes.server_time, id: '' }
            },
            userId
          );
        }
        return;
      }

      const incoming = deltaRes.data || [];
      const deletedList = deltaRes.deleted_ids || [];
      const deletedIdSet = new Set(deletedList.map(d => d.id));

      if (incoming.length > 0 || deletedIdSet.size > 0) {
        const tMap = new Map(templates.value.map(t => [t.id, t]));
        for (const delId of deletedIdSet) {
          tMap.delete(delId);
        }
        for (const item of incoming) {
          const old = tMap.get(item.id);
          if (!old || (item.updated_at >= (old.updated_at || 0))) {
            tMap.set(item.id, item);
          }
        }
        templates.value = Array.from(tMap.values());
        sortTemplates();
        setupCardObserver();
      }

      pageSince = deltaRes.next_since;
      pageTomb = deltaRes.deleted_next;
      hasMoreRows = !!deltaRes.has_more;
      hasMoreTombs = !!deltaRes.deleted_has_more;

      const isFinal = !hasMoreRows && !hasMoreTombs;
      await mergeTemplatesCache(
        incoming,
        deletedList.map(d => d.id),
        isFinal ? { row_cursor: pageSince, tomb_cursor: pageTomb } : null,
        userId
      );
    }
  } catch (e) {
    console.warn('增量加载创作库失败:', e);
  }
}

// 会话消息缓存（stale-while-revalidate）：界面底层仍是服务端，缓存只为切回刚看过的会话时秒开、不闪
const messagesCache = new Map(); // sid -> { rows, at }
const MESSAGES_CACHE_TTL = 60 * 1000;

// 记住上次停留的会话，避免刷新后被"最近更新"的会话抢走视线
const ACTIVE_SESSION_KEY = () => {
  const u = getCurrentUser();
  return `ml_studio_active_session_${String(u?.username || u?.id || 'anon')}`;
};
function rememberActiveSession(sid) {
  try {
    if (sid) localStorage.setItem(ACTIVE_SESSION_KEY(), sid);
  } catch (e) {}
}

const DUP_MESSAGE_WINDOW_MS = 15 * 60 * 1000;

/**
 * 渲染前的脏数据防线：同一次生成曾被 worker（genmsg_<jobId>）与旧前端（无 id 的 msg_xxx）
 * 各写一条，刷新/切回会话就会看到两张一样的图，或两遍相同的错误。
 * 失败卡没有媒体地址，所以签名先按媒体取，失败消息退化为「错误正文」；
 * 只合并「一权威（有 run_id / genmsg 主键）一非权威」且 15 分钟内的成对记录，
 * 用户真实重试产生的多条独立失败（都带各自的 jobId 或都不带）不会被误吞。
 * 库里的存量脏行由 scripts/dedupe-gen-messages.js 清理，界面这层保证任何情况下都不重复。
 */
function dedupeLoadedMessages(rows) {
  if (!Array.isArray(rows)) return rows;
  const drop = new Set();
  const seenIds = new Set();
  const seenRuns = new Set();
  const groups = new Map();

  const signatureOf = (m) => {
    const r = m.result || {};
    const media = String(r.imageUrl || r.videoUrl || r.audioUrl || '').trim();
    if (media) return `media:${media}`;
    const content = String(r.content || m.prompt || '').trim();
    if (content.startsWith('生成遇到问题') || content === '生成已取消') return `text:${content}`;
    return '';
  };

  for (const m of rows) {
    if (!m) continue;
    const id = String(m.id || '');
    if (id) {
      if (seenIds.has(id)) { drop.add(m); continue; }
      seenIds.add(id);
    }
    const runId = String(m.run_id || '').trim();
    if (runId) {
      if (seenRuns.has(runId)) { drop.add(m); continue; }
      seenRuns.add(runId);
    }
    if (m.role !== 'assistant') continue;
    const sig = signatureOf(m);
    if (!sig) continue;
    const at = Number(m.created_at || 0) || 0;
    const authoritative = Boolean(runId) || id.startsWith('genmsg_');
    const list = groups.get(sig) || [];
    const twin = list.find((g) => Math.abs(at - g.at) <= DUP_MESSAGE_WINDOW_MS && g.authoritative !== authoritative);
    if (!twin) {
      list.push({ row: m, at, authoritative });
      groups.set(sig, list);
      continue;
    }
    if (authoritative) {
      drop.add(twin.row);
      twin.row = m;
      twin.at = at;
      twin.authoritative = true;
    } else {
      drop.add(m);
    }
  }
  return rows.filter((m) => !drop.has(m));
}

/**
 * 后台任务落库后补拉一次消息：只把「本地还没见过的结果卡」追加上来，
 * 不重建整个列表（否则滚动位置、正在看的图都会跳）。
 */
async function refreshMessagesFromServer(sid) {
  if (!sid || sid !== currentSessionId.value) return;
  const raw = dedupeLoadedMessages(await fetchChatMessages(sid));
  if (!Array.isArray(raw) || sid !== currentSessionId.value) return;
  const known = new Set(messages.value.map((m) => m && m.id).filter(Boolean));
  const seenMedia = new Set(messages.value
    .filter((m) => m && (m.imageUrl || m.videoUrl || m.audioUrl))
    .map((m) => m.imageUrl || m.videoUrl || m.audioUrl));
  const extras = [];
  for (const m of raw) {
    if (!m || m.role !== 'assistant' || known.has(m.id)) continue;
    const r = m.result || {};
    if (!r.imageUrl && !r.videoUrl && !r.audioUrl) continue;
    // 同一份产物已经在列表里（历史双写留下的脏数据）就不再追加第二张
    const mediaUrl = r.imageUrl || r.videoUrl || r.audioUrl;
    if (mediaUrl && seenMedia.has(mediaUrl)) continue;
    if (mediaUrl) seenMedia.add(mediaUrl);
    const modality = r.imageUrl ? 'image' : (r.videoUrl ? 'video' : 'music');
    extras.push({
      id: m.id,
      role: 'assistant',
      modality,
      content: r.content || m.prompt || '',
      imageUrl: r.imageUrl,
      videoUrl: r.videoUrl,
      audioUrl: r.audioUrl,
      resolution: modality === 'image'
        ? resolutionLabelFor('image', r.modelKey || m.params?.model || imageModelKey.value, { size: r.resolution || m.params?.size })
        : (r.resolution || m.params?.resolution),
      ratio: r.ratio || m.params?.ratio,
      duration: r.duration,
      model: r.model || m.engine,
      modelKey: r.modelKey || m.params?.model,
      userPrompt: r.userPrompt || '',
      refs: r.refs || m.params?.refs || [],
      params: m.params || null,
      genMode: r.genMode || m.mode,
      // 后台任务在其它标签完成时补插的卡片必须带齐重试/超分元数据，
      // 否则「重新生成」会按默认参数重发、超分区会一直显示「尚未超分」
      modelVideoUrl: r.modelVideoUrl,
      vendorVideoUrl: r.vendorVideoUrl,
      srStatus: r.srStatus,
      srError: r.srError,
      startTime: m.created_at || r.startTime || Date.now(),
      assetFid: r.assetFid || '',
      retryPrompt: r.retryPrompt || '',
      retryRefs: Array.isArray(r.retryRefs) ? r.retryRefs : [],
      retryModel: r.retryModel || '',
      retryModality: r.retryModality || '',
      retryMode: r.retryMode || '',
      retryParams: r.retryParams || null
    });
    if (r.imageUrl) seenMedia.add(r.imageUrl);
  }
  if (!extras.length) return;
  messages.value.push(...extras);
  if (pinned.value) stickToBottom();
}

/**
 * 拉会话列表。select 语义：
 * - 'auto'（默认）：当前会话还在列表里就原地不动，只有本地没有会话时才按记忆/最新恢复；
 * - 'first'：强制切到最新的第一个（新建会话后用）；
 * - 'none'：只刷新列表，不切会话（后台任务完成、其它标签页改数据时用）。
 */
async function loadSessions({ select = 'auto' } = {}) {
  try {
    const list = await fetchChatSessions();
    if (Array.isArray(list) && list.length > 0) {
      sessions.value = list;
      const stillThere = Boolean(currentSessionId.value) && list.some((s) => s.id === currentSessionId.value);
      if (select === 'first') {
        await selectSession(list[0]);
      } else if (select === 'auto' && !stillThere) {
        let remembered = '';
        try { remembered = localStorage.getItem(ACTIVE_SESSION_KEY()) || ''; } catch (e) {}
        await selectSession(list.find((s) => s.id === remembered) || list[0]);
      }
      return;
    }
    if (select === 'none') return;
    const defaultId = `sess_${Date.now()}`;
    const defaultSess = { id: defaultId, title: '空间美学创作会话' };
    sessions.value = [defaultSess];
    currentSessionId.value = defaultId;
    rememberActiveSession(defaultId);
    try {
      await authFetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: defaultId, title: defaultSess.title })
      });
    } catch (e) {}
  } catch (e) {
    console.warn('加载会话列表失败:', e);
    if (!sessions.value.length) {
      await createNewSession();
    }
  }
}

async function selectSession(s) {
  if (!s || !s.id) return;
  if (isRecipeEditing.value) {
    cancelRecipeEdit();
  }
  // 1. 保存前一个会话的草稿状态（配方句、富文本、参考托盘、选图索引）
  if (currentSessionId.value && currentSessionId.value !== s.id) {
    sessionDrafts.set(currentSessionId.value, {
      recipePrompt: recipePrompt.value || '',
      globalRecipePrompt: globalRecipePrompt.value || '',
      editorHtml: richEditorRef.value ? richEditorRef.value.innerHTML : '',
      referenceTray: JSON.parse(JSON.stringify(referenceTray.value || [])),
      selectedImageIndex: selectedImageIndex.value || 0,
    });
    // 落盘也按会话分开：刷新后各自能找回自己的草稿，不会再串到别的对话
    saveDraftToStorage(currentSessionId.value);
  }

  currentSessionId.value = s.id;
  rememberActiveSession(s.id);
  // 参数与模型选择严格跟随该会话上一轮：先清掉上一个会话的残留，
  // 再恢复本会话快照（内存优先，阶段 2 后 chat_sessions.params_json 持久化）。
  resetParamsToDefaults();
  restoreSessionParams(s);
  generating.value = Boolean(sessionGeneratingMap.get(s.id) || sessionPlaceholderMap.has(s.id));
  messages.value = [];
  pinned.value = true;
  hasNewBelow.value = false;

  // 2. 恢复目标会话的草稿状态；如果无草稿，彻底干净重置输入区和配方句
  if (sessionDrafts.has(s.id)) {
    const draft = sessionDrafts.get(s.id);
    recipePrompt.value = draft.recipePrompt || '';
    globalRecipePrompt.value = draft.globalRecipePrompt || '';
    if (richEditorRef.value) {
      richEditorRef.value.innerHTML = draft.editorHtml || '';
    }
    referenceTray.value = JSON.parse(JSON.stringify(draft.referenceTray || []));
    selectedImageIndex.value = draft.selectedImageIndex || 0;
  } else {
    recipePrompt.value = '';
    globalRecipePrompt.value = '';
    resetComposerState();
    selectedImageIndex.value = 0;
    // 该会话上次没发出去的输入（按会话 key 存），有就接回来
    restoreDraftForSession(s.id);
  }
  hasNewBelow.value = false;
  // 命中缓存先秒开（60s 内看过的会话），下面照旧请求服务端并在回来后覆盖，保证内容仍然权威
  const cachedRows = messagesCache.get(s.id);
  if (cachedRows && Date.now() - cachedRows.at < MESSAGES_CACHE_TTL) {
    messages.value = cachedRows.rows.map((m) => ({ ...m }));
    pinned.value = true;
  }
  try {
    // 服务端历史里可能同时躺着 worker 的 genmsg_<jobId> 和旧版前端盲目写入的 msg_xxx，
    // 渲染前先按 id / run_id / 同媒体合并，避免刷新看到两遍错误或两张一样的图
    const rawMsgs = dedupeLoadedMessages(await fetchChatMessages(s.id));
    if (Array.isArray(rawMsgs)) {
      messages.value = rawMsgs.map(m => {
        let mod = 'chat';
        if (m.mode === 'text_to_image' || (m.result && m.result.imageUrl)) mod = 'image';
        else if (m.mode === 'text_to_video' || (m.result && m.result.videoUrl)) mod = 'video';
        else if (m.mode === 'music' || (m.result && m.result.audioUrl)) mod = 'music';

        return {
          id: m.id,
          role: m.role,
          content: mod === 'chat'
            ? splitClientThinking(m.prompt || (m.result ? m.result.content : ''), m.result?.thinking || '').content
            : (m.prompt || (m.result ? m.result.content : '')),
          thinking: mod === 'chat'
            ? splitClientThinking(m.prompt || (m.result ? m.result.content : ''), m.result?.thinking || '').thinking
            : '',
          modality: mod,
          imageUrl: m.result?.imageUrl,
          videoUrl: m.result?.videoUrl,
          modelVideoUrl: m.result?.modelVideoUrl,
          vendorVideoUrl: m.result?.vendorVideoUrl,
          srStatus: m.result?.srStatus,
          srError: m.result?.srError,
          compareOpen: false,
          audioUrl: m.result?.audioUrl,
          // 历史结果里的 resolution 可能是旧的脏值（图片消息里存过 720p_sr2x），
          // 渲染前统一按「当前模型契约」过滤一遍，图片没有 size 档位就显示空。
          resolution: mod === 'image'
            ? resolutionLabelFor('image', m.result?.modelKey || m.params?.model || imageModelKey.value, {
                size: m.result?.resolution || m.params?.size
              })
            : (m.result?.resolution || m.params?.resolution),
          ratio: m.result?.ratio || m.params?.ratio,
          duration: m.result?.duration,
          model: m.result?.model || m.engine,
          modelKey: m.result?.modelKey || m.params?.model,
          userPrompt: m.result?.userPrompt || (m.role === 'user' ? (m.prompt || '') : ''),
          refs: m.result?.refs || m.params?.refs || [],
          images: Array.isArray(m.images) ? m.images : [],
          requestSnapshot: m.params?.requestSnapshot || m.params?.outbound || m.result?.requestSnapshot || null,
          params: m.params || null,
          isGenerating: m.status === 'generating' || Boolean(m.result?.isGenerating),
          isCancelled: m.status === 'cancelled' || Boolean(m.result?.isCancelled),
          isError: m.status === 'failed' || Boolean(m.result?.isError) || String(m.prompt || m.result?.content || '').startsWith('生成遇到问题'),
          jobId: m.run_id || (m.id && m.id.startsWith('genmsg_') ? m.id.replace('genmsg_', '') : ''),
          startTime: m.created_at || (m.result && m.result.startTime) || Date.now(),
          genMode: m.result?.genMode || m.mode,
          assetFid: m.result?.assetFid || '',
          camera: m.result?.camera,
          // 重试元数据必须随消息一起还原，否则刷新后「重试」会按默认对话模式重发
          retryPrompt: m.result?.retryPrompt || '',
          retryRefs: Array.isArray(m.result?.retryRefs) ? m.result.retryRefs : [],
          retryModel: m.result?.retryModel || '',
          retryModality: m.result?.retryModality || '',
          retryMode: m.result?.retryMode || '',
          retryParams: m.result?.retryParams || null
        };
      });
      // 缓存的是「映射后」的消息，下次切回来直接能渲染（服务端仍是唯一真源）
      messagesCache.set(s.id, { rows: messages.value.map((m) => ({ ...m })), at: Date.now() });

      // 旧会话若还没有参数快照（例如刚刷新页面），用最后一条带 params 的消息回填，
      // 保证「回到上一轮」时模型 / 画幅 / 分辨率与上一轮一致。
      if (!sessionParamsMap.has(s.id)) {
        const lastWithParams = [...rawMsgs].reverse().find((m) => m.params && Object.keys(m.params || {}).length);
        const msgSnapshot = snapshotFromMessage({ params: lastWithParams?.params });
        if (msgSnapshot) {
          applyParamsSnapshot(msgSnapshot, { source: 'system' });
          sessionParamsMap.set(s.id, currentParamsSnapshot());
        }
      }

      const activePlaceholder = sessionPlaceholderMap.get(s.id);
      // worker 完成时已经把同一张图写进 chat_messages 了（它的结果卡和占位卡内容一致），
      // 这时再把内存占位卡塞回列表，屏幕上就会出现两张一样的图。
      const landed = Boolean(activePlaceholder && activePlaceholder.imageUrl
        && messages.value.some((m) => m && m.imageUrl && m.imageUrl === activePlaceholder.imageUrl));
      if (landed) sessionPlaceholderMap.delete(s.id);
      if (activePlaceholder && !landed && !messages.value.some(m => m === activePlaceholder || m.isGenerating)) {
        messages.value.push(activePlaceholder);
      }

      const serverRunningCard = messages.value.find((m) => m && m.isGenerating);
      if (serverRunningCard) {
        sessionGeneratingMap.set(s.id, true);
        sessionPlaceholderMap.set(s.id, serverRunningCard);
        generating.value = true;
      }

      // 从当前会话历史用户消息中自动充实 promptHistory
      const firstUser = rawMsgs.find((m) => m.role === 'user' && m.prompt);
      if (firstUser) rememberSessionTitle(firstUser.prompt);
      rawMsgs.forEach(m => {
        if (m.role === 'user' && (m.prompt || m.content)) {
          const userPrompt = m.prompt || m.content || '';
          const savedRefs = (m.params && Array.isArray(m.params.refs) && m.params.refs.length > 0)
            ? m.params.refs
            : (Array.isArray(m.refs) && m.refs.length > 0 ? m.refs : null);
          const imgs = Array.isArray(m.images) ? m.images : [];
          const promptNames = namesInPrompt(userPrompt);
          const trayItems = savedRefs
            ? JSON.parse(JSON.stringify(savedRefs))
            : imgs.map((u, i) => ({
                name: labelForRef(u, promptNames[i]),
                url: u,
                tag: `@图${i + 1}`,
                weight: 85,
                origin: 'upload'
              }));
          pushPromptHistory(userPrompt, trayItems, {
            recipePrompt: m.params?.recipePrompt || '',
            globalRecipePrompt: m.params?.globalRecipePrompt || '',
            supplementText: m.params?.supplementText || '',
            selectedImageIndex: m.params?.selectedImageIndex || 0,
            genMode: m.params?.genMode || m.mode || ''
          });
        }
        const refs = [].concat(m.result?.refs || []).concat(m.params?.refs || []);
        const urls = Array.isArray(m.images) ? m.images : [];
        rememberSessionRefs(refs, m.role === 'assistant' ? 'generated' : 'upload');
        rememberSessionRefs(urls.map((url, i) => ({ url, name: labelForRef(url, namesInPrompt(m.prompt)[i]), tag: `@图${i + 1}` })), 'upload');
        if (m.role === 'assistant' && m.result?.imageUrl) {
          rememberSessionRefs([{ url: m.result.imageUrl, name: labelForRef(m.result.imageUrl, ''), fid: m.result.assetFid || '' }], 'generated');
        }
      });

      // 本会话素材池以服务端「最近使用」为准重建（老会话没有记录时会自动补登记一次）
      loadRecentRefs({ force: true }).catch(() => {});

      // 若当前没有内存草稿，自动从最近一条带图消息中恢复看图区参考托盘与生图模式
      if (!sessionDrafts.has(s.id) && referenceTray.value.length === 0) {
        const latestWithRefs = [...rawMsgs].reverse().find(m => {
          const r = m.params?.refs || m.result?.refs;
          return (Array.isArray(r) && r.length > 0) || (Array.isArray(m.images) && m.images.length > 0);
        });
        if (latestWithRefs) {
          const restoredRefs = latestWithRefs.params?.refs || latestWithRefs.result?.refs;
          if (Array.isArray(restoredRefs) && restoredRefs.length > 0) {
            referenceTray.value = JSON.parse(JSON.stringify(restoredRefs));
          } else if (Array.isArray(latestWithRefs.images) && latestWithRefs.images.length > 0) {
            referenceTray.value = latestWithRefs.images.map((u, i) => ({
              name: `参考图_${i + 1}`,
              url: u,
              tag: `@图${i + 1}`,
              weight: 85,
              kind: 'image'
            }));
          }
          syncGenModeWithReferenceTray();
        }
      }
    }
  } catch (e) {
    console.warn('加载会话消息失败:', e);
  }
  scrollToBottom();
}

/**
 * 切会话 / 新建会话 / 复用配方都要先清空输入区。
 * 不清的话上一个会话的引用芯片会跟着「@图N」编号泄漏到新会话里，
 * sessionRefPool 还会跨会话无限累积（reparseEditorChips 拿它按名字反查 URL，会串会话）。
 */
function resetComposerState() {
  if (richEditorRef.value) richEditorRef.value.innerHTML = '';
  recipePrompt.value = '';
  globalRecipePrompt.value = '';
  referenceTray.value = [];
  sessionRefPool.value = [];
  activeSkillIds.value = [];
  optimizeUndo.value = null;
  hoveredRegionKey.value = null;
}

async function createNewSession(opts = {}) {
  const currentDraft = {
    recipePrompt: recipePrompt.value || '',
    globalRecipePrompt: globalRecipePrompt.value || '',
    editorHtml: richEditorRef.value ? richEditorRef.value.innerHTML : '',
    referenceTray: JSON.parse(JSON.stringify(referenceTray.value || [])),
    selectedImageIndex: selectedImageIndex.value || 0,
  };
  const hasActiveContent = currentDraft.referenceTray.length > 0 || currentDraft.recipePrompt || currentDraft.globalRecipePrompt || (currentDraft.editorHtml && currentDraft.editorHtml.trim());

  if (currentSessionId.value) {
    sessionDrafts.set(currentSessionId.value, currentDraft);
  }
  const newId = `sess_${Date.now()}`;
  const newSess = { id: newId, title: '新创作会话' };

  // 默认跨会话自动继承未提交的参考图托盘、选区与提示词
  if (!opts.forceReset && hasActiveContent) {
    sessionDrafts.set(newId, currentDraft);
    saveDraftToStorage(currentSessionId.value);
  } else if (!opts.keepComposer) {
    recipePrompt.value = '';
    resetComposerState();
    selectedImageIndex.value = 0;
    try { localStorage.removeItem(draftKey(currentSessionId.value)); } catch (_) {}
  }

  sessions.value.unshift(newSess);
  currentSessionId.value = newId;
  rememberActiveSession(newId);
  messages.value = [];
  // 新会话严格回到默认（模型专属默认 > 全局 9:16），绝不继承上一个会话的参数。
  resetParamsToDefaults();
  try {
    await authFetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: newId, title: '新创作会话' })
    });
  } catch (e) {}
}

async function deleteSession(id) {
  sessions.value = sessions.value.filter(s => s.id !== id);
  messagesCache.delete(id);
  recentBackfilled.delete(id);
  try {
    await deleteChatSession(id);
  } catch (e) {}
  if (currentSessionId.value === id) {
    if (sessions.value.length > 0) {
      await selectSession(sessions.value[0]);
    } else {
      await createNewSession();
    }
  }
}

function openAddTemplateModal() {
  const prompt = getRawEditorText();
  let defaultType = 'image';
  if (activeModality.value === 'video') defaultType = 'video';
  else if (activeModality.value === 'music') defaultType = 'audio';

  saveModal.value = {
    visible: true,
    title: '自定义空间美学配方',
    prompt,
    type: defaultType,
    space: '',
    style: '',
    purpose: '',
    is_pinned: false,
    msg: null
  };
}

function openTemplateDetail(tpl) {
  activeDetailPreview.value = { mode: 'result', refIndex: 0 };
  detailModal.value = { visible: true, tpl };
}

function applyTemplate(tpl) {
  if (!tpl) return;
  // 异步统计使用频次并浮动
  authFetch(`/api/creation-templates/${encodeURIComponent(tpl.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'use' })
  }).then(r => r.json()).then(j => {
    if (j.success) {
      tpl.use_count = (tpl.use_count || 0) + 1;
      tpl.updated_at = j.data?.updated_at || Date.now();
      sortTemplates();
      mergeTemplatesCache([tpl]);
    }
  }).catch(() => {});

  const params = tpl.params || {};
  const refs = Array.isArray(tpl.origin_images) ? tpl.origin_images : [];
  const prepared = refs.map((item, i) => {
    const fid = item.fid || '';
    const rawUrl = String(item.url || '');
    // 配方里存的是当时的短期凭证（甚至是一次性 blob:），能按 fid 重签的一律重签
    const url = fid
      ? (rawUrl.startsWith('/api/') ? resignAssetUrl(rawUrl) : getAssetImageUrl(fid))
      : rawUrl;
    return {
      name: labelForRef(url, item.name || item.file_name),
      url,
      fid,
      kind: item.kind || 'image',
      weight: item.weight || 85,
      tag: item.tag || `@图${i + 1}`,
      origin: 'upload',
      resolved: !!url && !url.startsWith('blob:')
    };
  });
  const rawGenMode = String(params.genMode || params.mode || '').toLowerCase();
  let modality = '';
  if (['video', 'audio', 'music', 'image', 'chat'].includes(tpl.type)) {
    modality = tpl.type === 'audio' ? 'music' : tpl.type;
  }
  if (['video', 'audio', 'music', 'image', 'chat'].includes(rawGenMode)) {
    modality = rawGenMode === 'audio' ? 'music' : rawGenMode;
  } else if (rawGenMode.includes('video') || ['first_last_frame', 'omni_reference', 'image_to_video'].includes(params.schemaMode)) {
    modality = 'video';
  } else if (rawGenMode.includes('audio') || rawGenMode.includes('music')) {
    modality = 'music';
  } else if (rawGenMode.includes('image') || ['image_edit', 'image_to_image', 'text_to_image', 'expand_fill'].includes(params.schemaMode)) {
    modality = 'image';
  }
  if (!modality) modality = tpl.type === 'video' ? 'video' : (tpl.type === 'audio' ? 'music' : 'image');

  const modelKey = params.modelKey || params.model;
  // 复用是「拿这条配方开新创作」，不是「在上一条对话里续写」：
  // 不重置的话旧对话的分析与产物会被 promptWithPriorAnalysis 混进新提示词。
  if (messages.value.length > 0) createNewSession();

  isApplyingTemplate = true;
  suppressSchemaReset = true;
  if (recipeIsLegacy(tpl)) {
    activeModality.value = 'image';
    imageModelKey.value = 'agnes_image_2_5_flash';
    oldRecipeNote.value = true;
  } else {
    oldRecipeNote.value = false;
    if (modality) activeModality.value = modality;
    if (activeModality.value === 'video') {
      videoModelKey.value = modelKey || studioDefaults.value.video || (studioModels.value.video?.[0]?.id || 'kling_v2_5_pro');
    } else if (activeModality.value === 'image') {
      imageModelKey.value = modelKey || studioDefaults.value.image || (studioModels.value.image?.[0]?.id || 'agnes_image_2_5_flash');
    } else if (activeModality.value === 'music') {
      musicType.value = modelKey || studioDefaults.value.music || (studioModels.value.music?.[0]?.id || 'acestep_local');
    } else if (modelKey) {
      chatModelKey.value = modelKey;
    }
  }
  // 旧配方的 modelKey 可能是显示名，交给同一套回退逻辑按 name 反查成契约 id
  repairStudioModelKeys();
  suppressSchemaReset = false;
  resetSchemaForModel();
  if (params.schemaMode) setGenMode(params.schemaMode);
  else if (activeModality.value === 'video') {
    setGenMode(prepared.length > 0 ? 'image_to_video' : 'text_to_video');
  } else if (activeModality.value === 'image') {
    setGenMode(prepared.length > 0 ? 'image_to_image' : 'text_to_image');
  }

  if (params.schemaParams && typeof params.schemaParams === 'object') {
    const schema = currentSchema.value;
    const incoming = {};
    for (const [key, value] of Object.entries(params.schemaParams)) {
      if (fieldByKey(schema, key)) incoming[key] = value;
    }
    schemaParams.value = clampParamsToSchema(schema, { ...schemaParams.value, ...incoming });
    applyModeLocks();
  }
  if (params.ratio) selectedRatio.value = params.ratio;
  else if (tpl.aspect_ratio) selectedRatio.value = tpl.aspect_ratio;
  // 模板的 params.resolution 可能是视频档位（720p / 1080p），不能直接塞进图片尺寸档位，
  // 否则会一路传到 GPT Image VIP 的 size 字段（该通道只认 WxH 像素或 auto，其它一律 400）
  {
    const sizeField = fieldByKey(currentSchema.value, 'size');
    const sizeOpts = (sizeField?.options || []).map(String);
    if (params.resolution && (!sizeOpts.length || sizeOpts.includes(String(params.resolution)))) {
      selectedResolution.value = params.resolution;
    }
  }
  // 提交时画幅/分辨率优先取 schemaParams（retryParams → schemaParams → selectedRatio），旧配方只把它们
  // 存在顶层。只回填 selectedRatio 会被上一个模型残留的 schema 值盖掉（实测：16:9 复用后变成 1:1）。
  const legacySeed = {};
  const seedSchema = currentSchema.value;
  if (params.ratio && !isFieldLocked('ratio') && valueStillFits(seedSchema, 'ratio', params.ratio)) {
    legacySeed.ratio = params.ratio;
  }
  if (params.resolution) {
    if (valueStillFits(seedSchema, 'resolution', params.resolution)) legacySeed.resolution = params.resolution;
    else if (valueStillFits(seedSchema, 'size', params.resolution)) legacySeed.size = params.resolution;
  }
  if (Object.keys(legacySeed).length) {
    schemaParams.value = clampParamsToSchema(seedSchema, { ...schemaParams.value, ...legacySeed });
  }
  restorePromptContent(tpl.prompt || '', prepared);
  syncTrayFromEditor();
  // 零配置智能调度：检查配方关联素材与真实画幅冲突，自动调优
  dispatchSmartWorkflow({ force: true, fromTemplate: tpl, source: 'apply_template' });
  // 10-22 之前的配方只落提示词、不落引用：正文里的 @图1 会变成没有 URL 的死标签，
  // 与其让用户以为「图带上了」，不如在复用这一刻就说清楚差了几个。
  const mentionedRefs = (String(tpl.prompt || '').match(/@(?:图片|视频|音频|图)\d+/g) || []).length;
  const liveRefs = prepared.filter((p) => p.resolved).length;
  composerNotice.value = mentionedRefs > liveRefs
    ? `这条旧配方没能恢复 ${mentionedRefs - liveRefs} 个素材引用（保存时没存下参考图），请重新挂载素材或删掉失效标签。`
    : '';
  rememberSessionRefs(referenceTray.value, 'upload');
  detailModal.value.visible = false;
  showExpandedLibrary.value = false;

  const modName = activeModality.value === 'video' ? '生视频' : (activeModality.value === 'music' ? '配乐合成' : '生图');
  triggerAdaptiveNotice(`已成功复用【${tpl.title || '配方'}】：切入${modName}板块，已恢复参数与素材配置`);

  nextTick(() => {
    isApplyingTemplate = false;
  });
}

function applyTemplateFromDetail() {
  applyTemplate(detailModal.value.tpl);
}

function selectHashTemplate(tpl) {
  showHashMenu.value = false;
  // 记录复用次数并浮动
  authFetch(`/api/creation-templates/${encodeURIComponent(tpl.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'use' })
  }).then(r => r.json()).then(j => {
    if (j.success) {
      tpl.use_count = (tpl.use_count || 0) + 1;
      tpl.updated_at = j.data?.updated_at || Date.now();
      sortTemplates();
      mergeTemplatesCache([tpl]);
    }
  }).catch(() => {});

  if (!richEditorRef.value) return;
  const last = richEditorRef.value.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) last.nodeValue = String(last.nodeValue || '').replace(/#\s*$/, '');
  appendRichSegmentText(' ' + (tpl.prompt || ''));
  const origins = (Array.isArray(tpl.origin_images) ? tpl.origin_images : []).map((item, index) => {
    const w = Number(item.naturalWidth || item.width || 0);
    const h = Number(item.naturalHeight || item.height || 0);
    return {
      name: item.name || item.file_name || '',
      url: item.url || '',
      fid: item.fid || '',
      kind: item.kind || 'image',
      tag: `@图${index + 1}`,
      origin: 'upload',
      width: w,
      height: h,
      naturalWidth: w,
      naturalHeight: h
    };
  }).filter((item) => item.url);
  reparseEditorChips(origins);
  syncTrayFromEditor();
  origins.forEach((it) => {
    if (it && it.url && (!it.naturalWidth || !it.naturalHeight)) {
      autoSyncRatioFromImage(it.url, it);
    }
  });
  dispatchSmartWorkflow({ force: true, fromTemplate: tpl, source: 'select_hash_template' });
}

function openAssetSelectorModal() {
  showAssetSelector.value = true;
  // 打开时静默续期一次，保证「其他对话」那栏是最新的
  loadRecentRefs({ force: true }).catch(() => {});
}

// 共享素材选择器确认：把选中的「原图 / 衍生图」版本挂载为 @引用
function onAssetPickerConfirm(versions) {
  const kinds = [];
  for (const version of versions || []) {
    if (!version?.url) continue;
    const idx = referenceTray.value.length + 1;
    const is3D = Boolean(version.glb || version.modelUrl || version.kind === '3d' || version.category === '3d' || /\.(glb|gltf|obj)($|\?)/i.test(version.url || ''));
    const w = Number(version.width || version.naturalWidth || 0);
    const h = Number(version.height || version.naturalHeight || 0);
    const asset = {
      name: version.derivativeKind ? `${version.name || '素材资产'}（${version.label || '衍生图'}）` : (version.name || '素材资产'),
      url: version.url,
      weight: 85,
      tag: `@图${idx}`,
      fid: version.fid,
      kind: version.kind || 'image',
      origin: is3D ? '3d_snapshot' : 'upload',
      isRefObject: is3D,
      derivativeId: version.derivativeId || '',
      derivativeKind: version.derivativeKind || '',
      width: w,
      height: h,
      naturalWidth: w,
      naturalHeight: h
    };
    referenceTray.value.push(asset);
    kinds.push(asset.kind);
    rememberSessionRefs([asset], 'upload', { persist: true });
    autoSyncRatioFromImage(asset.url, asset);
    // 用户需求：不自动在对话框新增胶囊
  }
  showAssetSelector.value = false;
  autoSelectRefMode(kinds);
  dispatchSmartWorkflow({ source: 'onAssetPickerConfirm' });
}

function onAssetPickerUpload(file) {
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, '');
  const url = URL.createObjectURL(file);
  localFileByUrl.set(url, file);
  const idx = referenceTray.value.length + 1;
  const kind = file.type.startsWith('video/') ? 'video' : (file.type.startsWith('audio/') ? 'audio' : (file.name.match(/\.(glb|gltf|obj)$/i) ? '3d' : 'image'));
  const is3D = Boolean(file.name.match(/\.(glb|gltf|obj)$/i));
  const asset = { name, url, weight: 85, tag: `@图${idx}`, kind, origin: is3D ? '3d_snapshot' : 'upload', isRefObject: is3D };
  referenceTray.value.push(asset);
  // 用户需求：不自动在对话框新增胶囊
  showAssetSelector.value = false;
  autoSyncRatioFromImage(url, asset);
  autoSelectRefMode([kind]);
  dispatchSmartWorkflow({ source: 'onAssetPickerUpload' });
}

function handleDirectUploadFiles(files) {
  const list = Array.isArray(files) ? files : (files instanceof FileList ? Array.from(files) : [files]);
  for (const f of list) {
    if (f) onAssetPickerUpload(f);
  }
}

// 媒体大图与视频播放预览灯箱
function openMediaPreview(itemOrUrl, defaultType = 'image') {
  let url = '';
  let type = defaultType;
  let title = '媒体高清预览';
  if (typeof itemOrUrl === 'string') {
    url = itemOrUrl;
    if (/\.(mp4|mov|webm)$/i.test(url)) type = 'video';
    else if (/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(url)) type = 'audio';
  } else if (itemOrUrl && typeof itemOrUrl === 'object') {
    url = itemOrUrl.url || itemOrUrl.imageUrl || itemOrUrl.videoUrl || itemOrUrl.audioUrl || '';
    title = itemOrUrl.name || itemOrUrl.file_name || itemOrUrl.title || '素材预览';
    const kind = mediaKind(itemOrUrl);
    if (kind === 'video' || kind === 'audio') type = kind;
  }
  if (!url) return;
  previewModal.value = {
    visible: true,
    url: authedMediaUrl(url),
    type,
    title,
    scale: 1.0,
    compare: null
  };
}

function closeMediaPreview() {
  previewModal.value.visible = false;
  previewModal.value.compare = null;
}

function displayResolution(value, msg) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // 后端超分成功写的是 `720p x 2`，普通视频档位是 `720p`，图片档位是 1K/1.5K/2K/4K
  const doubled = raw.match(/^(\d{3,4})p\s*[x×]\s*2$/i);
  if (doubled) return `${doubled[1]}p x 2`;
  const v = raw.replace(/_sr2x$/i, '');
  if (msg?.modality === 'video') {
    if (!/^\d{3,4}p$/i.test(v)) return '';
    if (msg?.srStatus === 'done') return `${v} x 2`;
    return v;
  }
  // 图片：契约里的尺寸档位原样显示（2K/1K/4K…），像素值/auto 之类不展示
  return ['1K', '1.5K', '2K', '4K'].includes(v.toUpperCase()) ? v : '';
}

function openVideoCompare(msg) {
  const original = msg?.modelVideoUrl || msg?.videoUrl || '';
  if (!original) return;
  const srReady = msg?.srStatus === 'done' && msg?.videoUrl && msg.videoUrl !== original;
  let rightNote = '尚未超分';
  if (msg?.srStatus === 'running') rightNote = '超分中，完成后可在这里看超分后的片子';
  else if (msg?.srStatus === 'failed') rightNote = msg.srError || '超分失败，已改播模型原片';
  previewModal.value = {
    visible: true,
    url: authedMediaUrl(original),
    type: 'video',
    title: '查看对比',
    scale: 1,
    compare: {
      leftUrl: authedMediaUrl(original),
      leftLabel: '模型原片',
      rightUrl: srReady ? authedMediaUrl(msg.videoUrl) : '',
      rightLabel: '超分后',
      rightNote: srReady ? '' : rightNote,
    },
  };
}

function openEditFromLightbox() {
  const url = previewModal.value.url;
  const title = previewModal.value.title || '编辑图片';
  closeMediaPreview();
  if (!url) return;
  const existing = referenceTray.value.find(r => r.url === url);
  let targetIdx = 0;
  if (!existing) {
    const idx = referenceTray.value.length + 1;
    referenceTray.value.push({
      name: title,
      url,
      tag: `@图${idx}`
    });
    targetIdx = referenceTray.value.length - 1;
  } else {
    targetIdx = referenceTray.value.indexOf(existing);
  }
  openEditLayer(targetIdx);
}

function zoomPreview(delta) {
  previewModal.value.scale = Math.max(0.5, Math.min(4.0, previewModal.value.scale + delta));
}

function dropMentionNumber(removed) {
  if (!richEditorRef.value || !(removed > 0)) return;
  const mention = (n) => new RegExp(`@(图片|视频|音频|图)${n}(?!\\d)(?:\\[([^\\]]*)\\])?`, 'g');
  const picture = (n) => new RegExp(`<(Picture|Audio|Video)\\s+${n}\\s*>`, 'gi');
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      let out = String(node.nodeValue || '').replace(picture(removed), '').replace(mention(removed), '');
      for (let n = removed + 1; n <= 12; n += 1) {
        const next = n - 1;
        out = out.replace(picture(n), (_, kind) => `<${kind} ${next}>`);
        out = out.replace(mention(n), (_, kind, name) => `@${kind}${next}${name != null ? `[${name}]` : ''}`);
      }
      node.nodeValue = out;
    } else if (node.nodeType === Node.ELEMENT_NODE && !(node.classList && node.classList.contains('inline-asset-chip'))) {
      [...node.childNodes].forEach(walk);
    }
  };
  [...richEditorRef.value.childNodes].forEach(walk);
}

function handleTrayReorder({ from, to }) {
  if (from === to) return;
  if (from < 0 || from >= referenceTray.value.length) return;
  if (to < 0 || to >= referenceTray.value.length) return;
  const list = referenceTray.value.slice();
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  list.forEach((item, index) => {
    item.tag = `@图${index + 1}`;
  });
  referenceTray.value = list;

  if (selectedImageIndex.value === from) {
    selectedImageIndex.value = to;
  } else if (from < selectedImageIndex.value && to >= selectedImageIndex.value) {
    selectedImageIndex.value -= 1;
  } else if (from > selectedImageIndex.value && to <= selectedImageIndex.value) {
    selectedImageIndex.value += 1;
  }
  rememberSessionRefs(referenceTray.value);
  syncAggregatedRecipePrompt();
}

function removeRef(idx) {
  const item = referenceTray.value[idx];
  if (!item) return;
  const url = item.url || '';
  if (richEditorRef.value && url) {
    [...richEditorRef.value.querySelectorAll('.inline-asset-chip')].forEach((chip) => {
      if ((chip.getAttribute('data-url') || '') === url) chip.remove();
    });
  }
  dropMentionNumber(idx + 1);

  const next = referenceTray.value.slice();
  next.splice(idx, 1);

  // 顺延更新所有剩余图片的编号 tag、内部 recipe 引用与 regions 归属
  next.forEach((entry, i) => {
    const newTag = `@图${i + 1}`;
    entry.tag = newTag;

    // 清除针对被删除图的配方行，并将其后所有图号 @图k 顺延更新为 @图(k-1)
    if (entry.recipe) {
      const delTag1 = `@图${idx + 1}`;
      const delTag2 = `图${idx + 1}[`;
      let lines = entry.recipe.split('\n').filter(l => {
        const trimmed = l.trim();
        if (trimmed.includes(delTag1) || trimmed.includes(delTag2)) {
          return false;
        }
        return true;
      });
      let updatedRecipe = lines.join('\n');
      for (let k = idx + 2; k <= 12; k++) {
        const fromTag = `@图${k}`;
        const toTag = `@图${k - 1}`;
        updatedRecipe = updatedRecipe.replaceAll(fromTag, toTag);
        const fromPlain = `图${k}[`;
        const toPlain = `图${k - 1}[`;
        updatedRecipe = updatedRecipe.replaceAll(fromPlain, toPlain);
        // 也顺延参考图号：参考@图k / 参考图k
        updatedRecipe = updatedRecipe.replaceAll(`参考@图${k}`, `参考@图${k - 1}`);
        updatedRecipe = updatedRecipe.replaceAll(`参考图${k}`, `参考图${k - 1}`);
      }
      entry.recipe = updatedRecipe;
    }

    if (Array.isArray(entry.regions)) {
      entry.regions.forEach(reg => {
        reg.tag = newTag;
      });
    }
  });

  referenceTray.value = next;

  // 保证选中的图片索引有效
  if (selectedImageIndex.value >= next.length) {
    selectedImageIndex.value = Math.max(0, next.length - 1);
  }

  // 同步富文本输入框胶囊标号
  syncTrayFromEditor();

  // 自动重新聚合全空间配方，使提示词与图号严格同步对齐！
  syncAggregatedRecipePrompt();
  syncGenModeWithReferenceTray();
}

// 优化提示词
async function optimizePrompt() {
  syncTrayFromEditor();
  const rawText = getRawEditorText();
  if (!rawText || activeModality.value === 'chat') return;
  const traySnapshot = JSON.parse(JSON.stringify(referenceTray.value));
  optimizing.value = true;
  composerError.value = '';
  try {
    const tray = traySnapshot;
    const imageUrls = await portableImageUrls(tray, refCap() || tray.length || 1);
    const res = await authFetch('/api/chat/optimize-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: rawText,
        modelId: activeModality.value === 'image' ? imageModelKey.value : (activeModality.value === 'video' ? videoModelKey.value : musicType.value),
        mode: activeGenMode.value || (activeModality.value === 'video' ? 'text_to_video' : 'text_to_image'),
        imageUrls
      })
    });
    const json = await res.json();
    const resultText = json.optimized || json.data?.optimized;
    if (!res.ok || json.error) throw new Error(json.error || '提示词优化失败');
    if (resultText && richEditorRef.value) {
      optimizeUndo.value = { text: rawText, tray: traySnapshot };
      restorePromptContent(withKeptRefMentions(resultText, tray), tray);
    }
  } catch (e) {
    composerError.value = e.message || '提示词优化失败';
  } finally {
    optimizing.value = false;
  }
}

function undoOptimize() {
  const saved = optimizeUndo.value;
  if (!saved || optimizing.value) return;
  optimizeUndo.value = null;
  restorePromptContent(saved.text, saved.tray);
}

function getModelDisplayName(key) {
  const map = {
    volc_doubao_seed_2_1_pro: 'Doubao-Seed-2.1-pro (火山方舟)',
    volc_doubao_seed_2_1_turbo: 'Doubao-Seed-2.1-turbo',
    volc_doubao_seed_2_1_lite: 'Doubao-Seed-2.1-lite',
    gemini_flash_latest: 'Gemini Flash',
    gemini_flash_lite_latest: 'Gemini Flash-Lite',
    agnes3_0flash: 'Agnes 3.0 Flash',
    litellm_doubao_seed_2_1_pro: 'Doubao-Seed-2.1-pro (LiteLLM)',
    seedream5flash: 'Seedream 5.0 Flash',
    seedream5pro: 'Seedream 5.0 Pro',
    seedream5lite: 'Seedream 5.0 Lite',
    agnes_image_2_5_flash: 'Agnes Image 2.5 Flash',
    qwenimage_local: 'Qwen-Image 2.1',
    qwenimage_modelscope: 'Qwen-Image 2.1 Turbo（魔搭）',
    acestep_local: 'ACE-Step 1.5',
    indextts_local: 'IndexTTS 2.5',
    modelscope_image: 'ModelScope 异步生图',
    gemini_image: 'Google Nano Banana',
    seedance2_5: 'Seedance 2.5',
    seedance2_0: 'Seedance 2.0',
    agnes_video_2_5_flash: 'Agnes Video 2.5 Flash',
    gemini_veo: 'Google Veo 3.1',
    modelscope_video: 'ModelScope 视频',
    doubao_bgm_v5: '豆包纯音乐 v5',
    doubao_song_v5: '豆包歌曲 v5',
    gemini_lyria: 'Google Lyria 3.5'
  };
  if (map[key]) return map[key];
  const all = [
    ...(studioModels.value.chat || []),
    ...(studioModels.value.image || []),
    ...(studioModels.value.video || []),
    ...(studioModels.value.music || [])
  ];
  const found = all.find(m => m.id === key || m.model_code === key);
  return found ? (found.name || key) : key;
}

// 发送消息
async function sendMessage() {
  if (isRecipeEditing.value) {
    saveRecipeEdit();
  }
  syncTrayFromEditor();
  const currentMod = activeModality.value;

  // 引用自愈优先于校验：素材本身没坏，坏的是「胶囊」和「托盘」两份状态的对齐关系。
  // 先按 fid / 凭证把能救的都救回来，救不回来的摘掉并降级成纯文本，绝不因此拦下发不出去。
  let refRepair = { repaired: 0, downgraded: 0 };
  if (currentMod !== 'chat') {
    refRepair = repairReferenceChips();
  }
  // 修复会改写编辑器内容（失效胶囊变纯文本），提示词必须在修复之后再取
  const rawContent = getFullPromptText();
  // 按会话判断生成锁：A 会话生成中切到 B 仍可提交，为后台并行任务队列铺路。
  // generating 单例仍用于当前视图的 UI 状态，但不再作为全局提交闸门。
  if (!rawContent || sessionGeneratingMap.get(currentSessionId.value) || sessionPlaceholderMap.has(currentSessionId.value)) return;

  // 2. 点击立即生图后自动收回全屏图片展示与抽屉
  viewerCollapsed.value = true;
  showEditModal.value = false;
  rightDrawerOpen.value = false;
  isRecipeEditing.value = false;

  let placeholderMsg = null;
  // 入队成功后的 jobId：catch 分支靠它判断「worker 已在 genmsg_<jobId> 落库」，不再重复插一条
  let submittedJobId = '';
  const typedTray = JSON.parse(JSON.stringify(referenceTray.value));
  let currentTray = typedTray;
  const usedPriorMedia = false;
  if (currentMod !== 'chat') {
    const refError = modeRefError(currentTray);
    if (refError) {
      composerError.value = refError;
      return;
    }
  }
  composerError.value = '';
  composerNotice.value = '';
  if (refRepair.repaired || refRepair.downgraded) {
    const parts = [];
    if (refRepair.repaired) parts.push(`已自动修复 ${refRepair.repaired} 处引用素材的图片地址`);
    if (refRepair.downgraded) parts.push(`${refRepair.downgraded} 处确实取不到图片，已从引用里移除并降级为文字`);
    composerNotice.value = `${parts.join('，')}，本次继续生成。`;
  }
  if (currentMod !== 'chat' && currentTray.length) {
    // 正文里提到但没有对应素材的编号：只提示，不再拦（以前的强制拦截正是「素材明明挂上了却说失效」的来源）
    const mentioned = [...new Set(
      [...normalizeRefMentions(rawContent || '').matchAll(/@图(\d+)/g)].map((m) => parseInt(m[1], 10))
    )];
    const missing = mentioned.filter((n) => !(currentTray[n - 1] && currentTray[n - 1].url));
    if (missing.length) {
      composerNotice.value = [
        composerNotice.value,
        `正文提到的 ${missing.map((n) => `@图${n}`).join('、')} 当前没有对应素材，本次按已挂载的 ${currentTray.length} 张图生成。`
      ].filter(Boolean).join(' ');
    }
  }
  const retryModel = currentMod === 'chat' ? chatModelKey.value : (currentMod === 'image' ? imageModelKey.value : (currentMod === 'video' ? videoModelKey.value : musicType.value));
  const retryParams = declaredParams();
  const retryMode = activeGenMode.value;

  // 记录提示词与附带的参考图历史（支持键盘上下键自动召回）
  pushPromptHistory(rawContent, currentTray, {
    recipePrompt: recipePrompt.value || '',
    globalRecipePrompt: globalRecipePrompt.value || '',
    supplementText: getRawEditorText() || '',
    selectedImageIndex: selectedImageIndex.value || 0,
    genMode: currentMod
  });

  if (!currentSessionId.value) {
    await createNewSession({ keepComposer: true });
  }
  const targetSessionId = currentSessionId.value;
  // 这一轮会往这个会话写新消息，缓存立刻作废，免得切回来看到旧的列表
  messagesCache.delete(targetSessionId);
  sessionGeneratingMap.set(targetSessionId, true);
  rememberSessionTitle(rawContent);

  const resolvedDeliveryList = await Promise.all(currentTray.map(async (it) => {
    return await resolveDeliveryImageForModel(it, retryModel);
  }));

  const outboundSnapshot = {
    rawPrompt: rawContent,
    dialectPrompt: rawContent,
    images: currentTray.map((item, idx) => {
      const res = resolvedDeliveryList[idx] || { url: item.url, isWireframe: false };
      const chosenUrl = res.url || item.url || '';
      return {
        tag: item.tag || `@图${idx + 1}`,
        source: res.isWireframe ? 'wireframe' : 'stage',
        displayUrl: chosenUrl,
        fullUrl: chosenUrl,
        path: String(chosenUrl).split('?')[0],
        isWireframe: res.isWireframe
      };
    }),
    request: {
      endpoint: '/api/gen/' + currentMod,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ***',
        'X-Model-Provider': retryModel
      },
      body: {
        model: retryModel,
        prompt: rawContent,
        size: selectedResolution.value,
        ratio: selectedRatio.value,
        images: resolvedDeliveryList.map((r, i) => String(r.url || currentTray[i].url || '').split('?')[0]),
        params: retryParams
      },
      curl: `curl -X POST "/api/gen/${currentMod}" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $API_KEY" \\\n  -d '${JSON.stringify({
        model: retryModel,
        prompt: rawContent,
        size: selectedResolution.value,
        ratio: selectedRatio.value,
        images: resolvedDeliveryList.map((r, i) => String(r.url || currentTray[i].url || '').split('?')[0]),
        params: retryParams
      }, null, 2)}'`
    }
  };

  messages.value.push({
    role: 'user',
    content: rawContent,
    modality: currentMod,
    refs: currentTray,
    images: currentTray.map((item) => item.url),
    requestSnapshot: outboundSnapshot
  });

  // 5. 占位渲染图实时显示生成进度（图片、视频）
  if (currentMod === 'image' || currentMod === 'video') {
    const targetRatio = retryParams.ratio || schemaParams.value.ratio || selectedRatio.value || '9:16';
    // 分辨率只从「当前模态 + 当前模型契约」里取：图片没有 size 档位就是空串（卡片不显示），
    // 以前这里会一路回退到 videoResolution，把视频的 720p_sr2x 当成图片分辨率显示。
    const targetResolution = resolutionLabelFor(currentMod, retryModel, retryParams);
    placeholderMsg = reactive({
      role: 'assistant',
      modality: currentMod,
      isGenerating: true,
      startTime: Date.now(),
      model: getModelDisplayName(retryModel),
      modelKey: retryModel,
      ratio: targetRatio,
      resolution: targetResolution,
      schemaMode: retryMode,
      schemaParams: retryParams,
      userPrompt: rawContent,
      refs: currentTray,
      content: currentMod === 'video' ? '正在渲染空间影视级动态视频...' : '正在为您渲染超写实空间视效...',
      isError: false,
    });
    messages.value.push(placeholderMsg);
    sessionPlaceholderMap.set(targetSessionId, placeholderMsg);
  }

  rememberSessionRefs(currentTray, 'upload', { persist: true });
  scrollToBottom({ behavior: 'smooth' });

  if (richEditorRef.value) {
    richEditorRef.value.innerHTML = '';
  }
  recipePrompt.value = '';
  globalRecipePrompt.value = '';
  // 规范：发送之后看图区里的图保留，不执行 referenceTray = []
  optimizeUndo.value = null;
  generating.value = true;
  try { localStorage.removeItem(draftKey(targetSessionId)); } catch (_) {}
  // 关键保护：切勿在发送后粗暴清空当前会话的托盘记忆，确保生成过程中切走再切回时不丢失参考图
  if (targetSessionId) {
    sessionDrafts.set(targetSessionId, {
      recipePrompt: '',
      globalRecipePrompt: '',
      editorHtml: '',
      referenceTray: JSON.parse(JSON.stringify(currentTray || [])),
      selectedImageIndex: selectedImageIndex.value || 0,
    });
  }

  // 保存用户消息至数据库（绑定 targetSessionId，快照脱敏避免体积过大）
  try {
    await saveChatMessage({
      sessionId: targetSessionId,
      role: 'user',
      mode: currentMod === 'video' ? 'text_to_video' : (currentMod === 'image' ? 'text_to_image' : (currentMod === 'music' ? 'music' : 'chat')),
      prompt: rawContent,
      images: currentTray.map(r => r.url),
      params: {
        // 以参数条（schemaParams）为准：selectedResolution / selectedRatio 是全局兜底值，
        // 切过模型后可能和真正提交的档位不一致，之前会出现「卡片显示 1:1、实际发 3:4」。
        // 视频写 resolution（Np/超分档），图片写 size（1K/2K/4K），两边不再互相串值。
        resolution: currentMod === 'video'
          ? (retryParams.resolution || schemaParams.value.resolution || videoResolution.value)
          : (retryParams.size || schemaParams.value.size || selectedResolution.value),
        ratio: retryParams.ratio || schemaParams.value.ratio || selectedRatio.value,
        model: retryModel,
        refs: currentTray,
        recipePrompt: recipePrompt.value || '',
        globalRecipePrompt: globalRecipePrompt.value || '',
        supplementText: getRawEditorText() || '',
        selectedImageIndex: selectedImageIndex.value || 0,
        genMode: currentMod,
        schemaMode: retryMode,
        schemaParams: retryParams,
        outbound: sanitizeSnapshotForStorage(outboundSnapshot),
        requestSnapshot: sanitizeSnapshotForStorage(outboundSnapshot)
      }
    });
  } catch (e) {
    console.warn('保存用户消息失败:', e);
  }

  try {
    if (currentMod === 'chat') {
      const chatModel = (studioModels.value.chat || []).find((item) => item.id === chatModelKey.value);
      const historyContext = trimChatMessages(messages.value, contextBudgetTokens(chatModel?.contextTokens)).messages;
      const imageLimit = Math.max(0, Number(chatModel?.input?.images ?? 2));
      const visionRefs = [];
      const seenRefUrls = new Set();
      if (imageLimit > 0) {
        for (let i = messages.value.length - 1; i >= 0 && visionRefs.length < imageLimit; i--) {
          if (messages.value[i].role !== 'user') continue;
          for (const ref of messageAttachments(messages.value[i])) {
            if (visionRefs.length >= imageLimit) break;
            const url = String(ref?.url || '');
            if (!url || seenRefUrls.has(url)) continue;
            seenRefUrls.add(url);
            visionRefs.push(ref);
          }
        }
      }
      const images = await portableImageUrls(visionRefs, imageLimit);

      const reasoningCaps = chatReasoningCaps.value;
      const reasoningParam = reasoningCaps && reasoningCaps.supported && reasoningCaps.mode === 'levels'
        ? { reasoning_effort: thinkingStrength.value }
        : {};
      const res = await generateAiChat({
        model: chatModelKey.value,
        messages: historyContext,
        prompt: rawContent,
        images,
        ...reasoningParam
      });

      const warnings = [];
      if (res.substituted) {
        const served = res.served_model ? getModelDisplayName(res.served_model) : '其他模型';
        warnings.push(`请求的是 ${getModelDisplayName(chatModelKey.value)}，网关实际由 ${served} 回答。`);
      }
      const appliedLevel = res.applied_reasoning?.reasoning_effort || '';
      if (appliedLevel && reasoningCaps?.supported && appliedLevel !== thinkingStrength.value) {
        warnings.push(`思考档位「${thinkingLevelLabel(thinkingStrength.value)}」不受该模型支持，已按「${thinkingLevelLabel(appliedLevel)}」执行。`);
      }
      if (res.truncated || res.finish_reason === 'length') {
        warnings.push('回答达到长度上限被截断，请重试或让问题更聚焦。');
      }
      for (const note of (res.image_notes || [])) {
        if (note.delivery === 'dropped') warnings.push(`图片未送达模型：${note.reason || '未知原因'}`);
        else if (note.warning) warnings.push(note.warning);
      }

      const rawReply = res.choices?.[0]?.message?.content || res.reply || res.text || res.data?.reply || '已完成空间需求分析。';
      const split = splitClientThinking(rawReply, res.reasoning || res.choices?.[0]?.message?.reasoning_content || '');
      const replyText = split.content;
      const asstMsg = {
        role: 'assistant',
        modality: 'chat',
        content: replyText,
        thinking: split.thinking,
        model: getModelDisplayName(chatModelKey.value),
        servedModel: res.served_model || null,
        reasoningLevel: appliedLevel || null,
        warning: warnings.length ? warnings.join('；') : ''
      };
      if (currentSessionId.value === targetSessionId) {
        messages.value.push(asstMsg);
        loadNextSuggestions(asstMsg);
      }

      await saveChatMessage({
        sessionId: targetSessionId,
        role: 'assistant',
        mode: 'chat',
        prompt: replyText,
        engine: chatModelKey.value,
        result: asstMsg
      });
    } else if (currentMod === 'image') {
      const deliveryTray = currentTray.map((it, idx) => {
        const resolved = resolvedDeliveryList[idx] || { url: it.url, isWireframe: false };
        return {
          ...it,
          url: resolved.url,
          isWireframe: resolved.isWireframe
        };
      });
      const rawUrls = await portableImageUrls(deliveryTray, deliveryTray.length || 1);
      for (const it of currentTray) {
        if (Array.isArray(it.baseAttrRefs)) {
          for (const bar of it.baseAttrRefs) {
            if (bar?.path) rawUrls.push(authedMediaUrl(bar.path));
          }
        } else if (Array.isArray(it.silentRefs)) {
          for (const sr of it.silentRefs) {
            if (sr?.url) rawUrls.push(sr.url);
          }
        }
      }
      const imageUrls = [];
      const seenUrlSet = new Set();
      for (const u of rawUrls) {
        if (u && !seenUrlSet.has(u)) {
          seenUrlSet.add(u);
          imageUrls.push(u);
        }
      }
      let promptForModel = promptWithPriorAnalysis(normalizeRefMentions(rawContent), usedPriorMedia ? currentTray.length : 0);
      currentTray.forEach((img, idx) => {
        const regionsToCompile = (img?.regions && img.regions.length > 0)
          ? img.regions
          : (referenceTray.value[idx]?.regions || []);
        if (regionsToCompile.length > 0) {
          const compiled = compilePrecisionEditPrompt({
            rawPrompt: promptForModel,
            regions: regionsToCompile,
            imageIndex: idx,
            targetModelKey: imageModelKey.value,
          });
          promptForModel = compiled.dialectPrompt;
        }
      });
      // 尺寸/画幅以契约参数条为准（Qwen 本地默认 1K：2K 生成慢 2~3 倍，不再用写死的 2K 兜底）
      // 只接受当前图片模型参数表里真实存在的档位：复用视频配方后会残留 resolution='1080p'，
      // 这类值原样透传会让 GPT Image VIP 直接 HTTP 400（该通道只认 WxH 像素或 auto）。
      // 契约里压根没有 size 字段的模型（GPT Image VIP 系列就是），一律不发 size，交给后端按画幅算像素。
      const imageSizeField = fieldByKey(currentSchema.value, 'size');
      const imageSizeOptions = (imageSizeField?.options || []).map(String);
      const submitImageSize = imageSizeField
        ? ([retryParams.size, schemaParams.value.size, selectedResolution.value]
            .find((v) => v != null && v !== '' && (!imageSizeOptions.length || imageSizeOptions.includes(String(v))))
           || imageSizeField.default
           || '2K')
        : undefined;
      // sizeLabel 只承载契约里真实存在的档位；GPT Image VIP 这种没有 size 字段的模型留空，
      // 卡片头就不显示「分辨率」，正文也不再谎称"画质达到 按画幅自适应"。
      const sizeLabel = submitImageSize || '';
      const imageRatioField = fieldByKey(currentSchema.value, 'ratio');
      const imageRatioOptions = (imageRatioField?.options || []).map(String);
      const submitImageRatio = [retryParams.ratio, schemaParams.value.ratio, selectedRatio.value]
        .find((v) => v != null && v !== '' && (!imageRatioOptions.length || imageRatioOptions.includes(String(v))))
        || imageRatioField?.default
        || '9:16';
      const imageStartedAt = Date.now();
      const { result: res, jobId: imageJobId } = await generateAiImage({
        prompt: promptForModel,
        model: imageModelKey.value,
        size: submitImageSize,
        ratio: submitImageRatio,
        imageUrls,
        genMode: retryMode,
        extras: retryParams,
        snippetIds: activeSnippetIds(),
        // 后台任务队列按会话归属结果，clientRequestId 用于幂等去重
        sessionId: targetSessionId,
        clientRequestId: `${targetSessionId}_${imageStartedAt}_${Math.random().toString(36).slice(2, 8)}`
      });
      submittedJobId = imageJobId || '';
      if (placeholderMsg && submittedJobId) {
        // 入队即绑定确定性主键：占位卡、前端落库、worker 落库共用 genmsg_<jobId>
        placeholderMsg.id = `genmsg_${submittedJobId}`;
        placeholderMsg.jobId = submittedJobId;
      }

      const genUrl = res.files?.[0]?.previewUrl || res.files?.[0]?.url || res.imageUrl || res.url || res.data?.imageUrl || (res.files?.[0]?.localPath ? `/api/cache/temp/${res.files[0].localPath.split('/').pop()}` : '');
      if (!genUrl) {
        throw new Error(res.error || '未获取到生成的图片地址');
      }

      const layerStack = normalizeClientLayerStack(res, retryParams);
      // 供应商不回 elapsedMs（Agnes 就没回）时用客户端实际等待时长兜底，别再留一个空的「耗时:」
      const imageElapsedSec = Math.round((res.elapsedMs || (Date.now() - imageStartedAt)) / 1000);
      const asstMsg = {
        role: 'assistant',
        modality: 'image',
        content: layerStack && layerStack.layers.length > 1
          ? `已完成 Seedream 5.0 多图层拆分生成（共 ${layerStack.layers.length} 个独立图层），可直接在上方切换查看或单层二次引用。`
          : (sizeLabel
            ? `已为您完成空间视效生成。家具材质光泽与参考项深度统一，光影自然，画质达到 ${sizeLabel}。`
            : `已为您完成空间视效生成。家具材质光泽与参考项深度统一，光影自然，画幅 ${submitImageRatio}。`),
        userPrompt: rawContent,
        refs: currentTray,
        imageUrl: genUrl,
        layerStack,
        duration: imageElapsedSec > 0 ? `${imageElapsedSec}s` : (res.duration ? `${res.duration}s` : ''),
        resolution: sizeLabel,
        ratio: submitImageRatio,
        model: getModelDisplayName(imageModelKey.value),
        modelKey: imageModelKey.value,
        schemaMode: retryMode,
        schemaParams: retryParams,
        genMode: 'image'
      };
      // 生成结果默认不入库：产物留在 /api/cache/temp/，由用户点「存入素材库」手动登记。
      rememberSessionRefs([{ url: genUrl, name: labelForRef(genUrl, ''), fid: '' }], 'generated', { persist: true });

      // 原地响应式替换占位卡片为真实生成的图片
      if (placeholderMsg && messages.value.includes(placeholderMsg)) {
        Object.assign(placeholderMsg, asstMsg, {
          isGenerating: false,
          isError: false,
          // 取消与成功竞态：成功落地时清掉取消标记，否则会同时出现结果卡和「已取消」状态
          isCancelled: false
        });
        loadNextSuggestions(placeholderMsg);
      } else if (currentSessionId.value === targetSessionId) {
        messages.value.push(asstMsg);
        loadNextSuggestions(asstMsg);
      }

      // 与 worker 落库共用同一个确定性 id：两边都按该 id upsert，一张图只会有一条消息记录。
      await saveChatMessage({
        ...(imageJobId ? { id: `genmsg_${imageJobId}`, runId: imageJobId } : {}),
        sessionId: targetSessionId,
        role: 'assistant',
        mode: 'text_to_image',
        prompt: asstMsg.content,
        engine: imageModelKey.value,
        params: {
          ...retryParams,
          refs: currentTray,
          recipePrompt: recipePrompt.value || '',
          globalRecipePrompt: globalRecipePrompt.value || '',
          supplementText: getRawEditorText() || '',
          selectedImageIndex: selectedImageIndex.value || 0,
          genMode: currentMod,
          schemaMode: retryMode
        },
        result: placeholderMsg || asstMsg
      });
    } else if (currentMod === 'video') {
      // 首尾帧按「输入区可见槽位」显式取（槽位就是 referenceTray[0]/[1]），不能靠 imageUrls[0]/[1]：
      // portableImageUrls 会剔除非图片项和转换失败的项，下标整体前移后尾帧会被塞进首帧位。
      const cap = refCap();
      const capped = cap > 0 ? currentTray.slice(0, cap) : currentTray;
      const slotUrls = [];
      for (const item of capped) {
        slotUrls.push(mediaKind(item) === 'image' ? ((await portableImageUrl(item)) || '') : '');
      }
      const imageUrls = slotUrls.filter(Boolean);
      const imageCount = capped.filter((item) => mediaKind(item) === 'image').length;
      const droppedRefs = imageCount - imageUrls.length;
      const ignoredRefs = currentTray.length - capped.length;
      const isKeyframeMode = retryMode === 'first_last_frame';
      const notices = [];
      if (droppedRefs > 0) notices.push(`有 ${droppedRefs} 张参考图没能转换成可提交的数据，本次已跳过。`);
      if (ignoredRefs > 0) notices.push(`该模型最多接受 ${cap} 个引用，超出部分已忽略 ${ignoredRefs} 个。`);
      if (isKeyframeMode && !slotUrls[1]) notices.push('首尾帧模式只拿到 1 帧：第 2 个槽位是空的或非图片，本次只按首帧生成。');
      // 与「引用自愈」的提示合并，别把前面修好的说明冲掉
      composerNotice.value = [composerNotice.value, ...notices].filter(Boolean).join(' ');
      const promptForModel = promptWithPriorAnalysis(rawContent, usedPriorMedia ? currentTray.length : 0);
      // 时长/画幅一律以契约参数条为准（已经过夹取），杜绝旧 videoDuration=60 这类游离默认值
      const submitDuration = retryParams.duration != null && retryParams.duration !== ''
        ? retryParams.duration
        : schemaParams.value.duration != null ? schemaParams.value.duration : videoDuration.value;
      const submitRatio = retryParams.ratio || schemaParams.value.ratio || selectedRatio.value;
      const submitSize = retryParams.resolution || retryParams.size || schemaParams.value.resolution || schemaParams.value.size || videoResolution.value;
      const { result: res, jobId: videoJobId } = await generateAiVideo({
        prompt: promptForModel,
        model: videoModelKey.value,
        duration: submitDuration,
        resolution: submitSize,
        ratio: submitRatio,
        imageUrls,
        genMode: retryMode,
        extras: retryParams,
        snippetIds: activeSnippetIds(),
        firstFrame: isKeyframeMode ? (slotUrls[0] || undefined) : undefined,
        lastFrame: isKeyframeMode ? (slotUrls[1] || undefined) : undefined,
        sessionId: targetSessionId,
        clientRequestId: `${targetSessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      });
      submittedJobId = videoJobId || '';
      if (placeholderMsg && submittedJobId) {
        placeholderMsg.id = `genmsg_${submittedJobId}`;
        placeholderMsg.jobId = submittedJobId;
      }

      const modelVideoUrl = res.modelVideoUrl || res.files?.[0]?.previewUrl || res.files?.[0]?.url || res.videoUrl || res.data?.videoUrl || '';
      const finalVideoUrl = res.videoUrl || modelVideoUrl;
      const vendorVideoUrl = res.vendorVideoUrl || res.files?.[0]?.remoteUrl || (String(modelVideoUrl).startsWith('http') ? modelVideoUrl : '');
      if (!finalVideoUrl) throw new Error(res.error || '未获取到生成的视频地址');
      const asstMsg = {
        role: 'assistant',
        modality: 'video',
        content: `影视级空间动态渲染已就绪。运镜平滑连续，空间光影与环境音效自然契合。`,
        userPrompt: rawContent,
        refs: currentTray,
        videoUrl: finalVideoUrl,
        modelVideoUrl: modelVideoUrl,
        vendorVideoUrl,
        srStatus: res.srStatus !== undefined ? res.srStatus : null,
        srError: res.srError || '',
        compareOpen: false,
        duration: `${submitDuration === '-1' ? '8' : submitDuration}s`,
        resolution: res.resolution || String(submitSize || '').replace(/_sr2x$/, ''),
        ratio: submitRatio,
        model: getModelDisplayName(videoModelKey.value),
        // 复用配方要靠 id 回填下拉框；model 只是给人看的显示名，两者不能互相替代
        modelKey: videoModelKey.value,
        schemaMode: retryMode,
        schemaParams: retryParams
      };
      let live = asstMsg;
      if (placeholderMsg && messages.value.includes(placeholderMsg)) {
        Object.assign(placeholderMsg, asstMsg, {
          isGenerating: false,
          isError: false,
          isCancelled: false,
        });
        live = placeholderMsg;
      } else if (currentSessionId.value === targetSessionId) {
        messages.value.push(asstMsg);
      }
      if (currentSessionId.value === targetSessionId) loadNextSuggestions(live);

      await saveChatMessage({
        ...(videoJobId ? { id: `genmsg_${videoJobId}`, runId: videoJobId } : {}),
        sessionId: targetSessionId,
        role: 'assistant',
        mode: 'text_to_video',
        prompt: asstMsg.content,
        engine: videoModelKey.value,
        params: {
          ...retryParams,
          refs: currentTray,
          recipePrompt: recipePrompt.value || '',
          globalRecipePrompt: globalRecipePrompt.value || '',
          supplementText: getRawEditorText() || '',
          selectedImageIndex: selectedImageIndex.value || 0,
          genMode: currentMod,
          schemaMode: retryMode
        },
        result: live
      });
    } else {
      const audioUrls = await portableAudioUrls(currentTray, refCap() || currentTray.length || 1);
      const res = await generateAiAudio({
        prompt: rawContent,
        model: musicType.value,
        duration: retryParams.audio_duration || retryParams.duration || Number(musicDuration.value) || 30,
        genMode: retryMode,
        audioUrls,
        extras: retryParams,
        snippetIds: activeSnippetIds()
      });
      const genAudioUrl = res.files?.[0]?.previewUrl || res.files?.[0]?.url || res.audioUrl || '';
      if (!genAudioUrl) throw new Error(res.error || '未获取到生成的音频地址');
      const asstMsg = {
        role: 'assistant',
        modality: 'music',
        content: res.files?.length > 1
          ? `音频已生成，共 ${res.files.length} 条。下面先播放第一条。`
          : '音频已生成。',
        userPrompt: rawContent,
        refs: currentTray,
        audioTitle: getModelDisplayName(musicType.value),
        duration: `${retryParams.audio_duration || retryParams.duration || musicDuration.value}s`,
        audioUrl: genAudioUrl,
        model: getModelDisplayName(musicType.value),
        modelKey: musicType.value,
        schemaMode: retryMode,
        schemaParams: retryParams
      };
      if (genAudioUrl.includes('/api/cache/temp/')) {
        // 生成结果默认不入库：音频留在 temp，由用户点「存入素材库」手动登记。
      } else {
        // 后端已持久化（如 doubao_bgm_v5）：直接复用已入库 fid，无需重复登记
        const firstFile = res.files?.[0] || {};
        const assetFid = firstFile.fid || genAudioUrl.match(/\/api\/assets\/([^/?#]+)\//)?.[1] || '';
        if (assetFid) {
          asstMsg.assetFid = assetFid;
          asstMsg.librarySaved = true;
          try {
            // 后端入库默认落在 original，这里移入精修货架
            await moveAssetShelf(assetFid, 'retouched');
          } catch (shelfErr) {
            console.warn('移入精修货架失败', shelfErr);
          }
        }
      }
      if (currentSessionId.value === targetSessionId) {
        messages.value.push(asstMsg);
        loadNextSuggestions(asstMsg);
      }

      await saveChatMessage({
        sessionId: targetSessionId,
        role: 'assistant',
        mode: 'music',
        prompt: asstMsg.content,
        engine: musicType.value,
        result: asstMsg
      });
    }
  } catch (err) {
    if (err && (err.isCancelled || err.message === '生成任务已取消')) {
      const cancelMsg = {
        role: 'assistant',
        modality: currentMod,
        content: '生成已取消',
        model: '系统提示',
        isCancelled: true,
        isGenerating: false,
        retryPrompt: rawContent,
        retryRefs: currentTray,
        retryModel,
        retryModality: currentMod,
        retryMode,
        retryParams
      };
      if (placeholderMsg && messages.value.includes(placeholderMsg)) {
        Object.assign(placeholderMsg, cancelMsg);
      } else if (currentSessionId.value === targetSessionId) {
        messages.value.push(cancelMsg);
      }
      return;
    }
    console.error('AI 生成调用失败:', err);
    const errMsg = {
      role: 'assistant',
      modality: currentMod,
      content: `生成遇到问题：${err.message || '请检查服务端模型配置或网络连接'}`,
      model: '系统提示',
      isError: true,
      retryPrompt: rawContent,
      retryRefs: currentTray,
      retryModel,
      retryModality: currentMod,
      retryMode,
      retryParams
    };
    if (placeholderMsg && messages.value.includes(placeholderMsg)) {
      Object.assign(placeholderMsg, errMsg, {
        isGenerating: false,
        isError: true
      });
      // 失败后把提示词与参考图恢复到输入区，用户可直接改参数重发，也避免「图槽 0/N」与实际附件不一致
      try {
        restorePromptContent(rawContent, currentTray);
        syncTrayFromEditor();
      } catch (restoreErr) {
        console.warn('恢复失败输入失败:', restoreErr);
      }
    } else if (currentSessionId.value === targetSessionId) {
      messages.value.push(errMsg);
      // 失败后把提示词与参考图恢复到输入区，用户可直接改参数重发，也避免「图槽 0/N」与实际附件不一致
      try {
        restorePromptContent(rawContent, currentTray);
        syncTrayFromEditor();
      } catch (restoreErr) {
        console.warn('恢复失败输入失败:', restoreErr);
      }
    }
    // 任务已入队时，worker 会把 genmsg_<jobId> 原子落成 failed（保留重发上下文），
    // 这里再插一条无 id 的消息就是「刷新后看到两遍错误」的根因：只更新内存卡片，不再重复落库。
    // 只有根本没拿到 jobId 的本地前置报错（校验/网络/直连模型）才需要落一条，并带上确定性 id 防重。
    const failedJobId = submittedJobId || String((err && err.jobId) || '');
    if (!failedJobId) {
      try {
        await saveChatMessage({
          id: `genmsg_local_${targetSessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          status: 'failed',
          sessionId: targetSessionId,
          role: 'assistant',
          mode: currentMod === 'image' ? 'text_to_image' : currentMod,
          prompt: errMsg.content,
          result: placeholderMsg || errMsg
        });
      } catch (saveErr) {
        console.warn('保存失败提示失败:', saveErr);
      }
    }
  } finally {
    sessionGeneratingMap.delete(targetSessionId);
    sessionPlaceholderMap.delete(targetSessionId);
    if (currentSessionId.value === targetSessionId) {
      generating.value = false;
      scrollToBottom();
    }
  }
}

const SESSION_TITLE_PLACEHOLDERS = ['新创作会话', '空间美学创作会话', 'AI 创作会话', ''];

function rememberSessionTitle(text) {
  const title = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!title || !currentSessionId.value) return;
  const hit = sessions.value.find((s) => s.id === currentSessionId.value);
  if (!hit) {
    sessions.value.unshift({ id: currentSessionId.value, title });
  } else if (SESSION_TITLE_PLACEHOLDERS.includes(hit.title || '')) {
    hit.title = title;
  } else {
    return;
  }
  authFetch('/api/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: currentSessionId.value, title })
  }).catch(() => {});
}

function fillComposerFromError(msg) {
  const prompt = msg.retryPrompt || sourcePromptFor(msg);
  const refs = Array.isArray(msg.retryRefs) ? msg.retryRefs : (Array.isArray(msg.refs) ? msg.refs : []);
  const modality = msg.retryModality || (msg.modality === 'music' ? 'music' : msg.modality) || '';
  const model = msg.retryModel || msg.modelKey || '';
  const mode = msg.retryMode || msg.schemaMode || '';
  const params = msg.retryParams || msg.schemaParams || null;
  suppressSchemaReset = true;
  if (modality) activeModality.value = modality;
  if (model) {
    if (modality === 'image') imageModelKey.value = model;
    else if (modality === 'video') videoModelKey.value = model;
    else if (modality === 'music') musicType.value = model;
  }
  suppressSchemaReset = false;
  resetSchemaForModel();
  if (mode) setGenMode(mode);
  if (params) schemaParams.value = clampParamsToSchema(currentSchema.value, { ...schemaParams.value, ...params });
  restorePromptContent(prompt, refs);
  syncTrayFromEditor();
}
// 把历史/重试/技能注入的参数夹取到当前契约：枚举非法回落默认、数值越界夹取到 [min,max]
function clampParamsToSchema(schema, params) {
  if (!schema) return params;
  const fields = [...(schema.common || []), ...(schema.advanced || [])];
  const out = { ...params };
  // 剪枝：schemaParams 只该承载当前契约真有的字段。以前只校验「存在的键」，
  // 复用视频配方 / 切换模态后残留的 resolution='720p_sr2x' 会一直跟着走，
  // 最后被占位卡和卡片头当成图片的分辨率显示出来。
  const known = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(out)) {
    if (!known.has(key)) delete out[key];
  }
  for (const field of fields) {
    if (!(field.key in out) || out[field.key] === '' || out[field.key] == null) continue;
    if (field.type === 'enum') {
      const opts = (field.options || []).map(String);
      if (!opts.includes(String(out[field.key]))) out[field.key] = field.default != null ? field.default : opts[0];
    } else if (['number', 'range', 'duration'].includes(field.type)) {
      const step = Number(field.step) > 0 ? Number(field.step) : 1;
      let n = Number(out[field.key]);
      if (!Number.isFinite(n)) { n = field.default != null ? Number(field.default) : Number(field.min ?? 0); }
      if (n === -1 && Array.isArray(field.extraStops) && field.extraStops.includes(-1)) continue;
      n = Math.min(Number(field.max), Math.max(Number(field.min), n));
      n = Math.round(n / step) * step;
      if (Number.isInteger(step)) n = Math.round(n);
      out[field.key] = n;
    }
  }
  return out;
}
/**
 * 结果卡片上「分辨率」的唯一取值口子。
 * - 视频：只认 Np / Np_sr2x 这类真实档位；
 * - 图片：只认该模型契约里真实存在的 size 档位（1K/2K/4K…）。契约里没有 size 字段的
 *   （GPT Image 2.5 Sunburst VIP 就只认像素或 auto）直接返回 ''，卡片头就不显示分辨率，
 *   绝不把视频的 720p_sr2x 顶上去。
 */
function resolutionLabelFor(modality, modelKey, params = {}) {
  if (modality === 'video') {
    const v = String(params.resolution || params.size || '').replace(/_sr2x$/, '');
    return /^\d{3,4}p$/.test(v) ? v : '';
  }
  if (modality !== 'image') return '';
  const schema = studioSchemas.value[modelKey]
    || (modelKey === modelKeyNow() ? currentSchema.value : null);
  const field = fieldByKey(schema, 'size');
  if (!field) return '';
  const opts = (field.options || []).map(String);
  const hit = [params.size, params.resolution, selectorSizeHint.value]
    .find((v) => v != null && v !== '' && (!opts.length || opts.includes(String(v))));
  return hit ? String(hit) : (field.default != null ? String(field.default) : '');
}
// 选择器里手选的图片档位；只在「当前就是图片模态」且档位合法时才作为兜底
const selectorSizeHint = computed(() => (activeModality.value === 'image' ? selectedResolution.value : ''));
// 把后端技术性错误信息转成用户可读的一句话 + 可操作建议
function friendlyErrorText(raw) {
  const text = String(raw || '').replace(/^生成遇到问题[:：]\s*/, '').trim();
  if (!text) return '请检查服务端模型配置或网络连接后重试。';
  // 去掉内部模型前缀 [Agnes Video ...] / [Agnes Video keyframe]；
  // 旧版 VIP 错误会把整段「实际请求参数 {JSON}」拼在正文尾部，刷新历史消息时一并清掉
  return text
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/｜实际请求参数\s*\{[\s\S]*\}\s*$/, '')
    .trim();
}
function errorHint(raw) {
  // 先剔掉旧消息尾部的参数 JSON：里面的 "ratio":"3:4" 会误触发「去改画幅」的建议
  const text = String(raw || '').replace(/｜实际请求参数\s*\{[\s\S]*\}\s*$/, '');
  if (/HTTP 429|service is busy|too many requests|rate limit|限流|繁忙/i.test(text)) {
    return '上游图像服务临时繁忙（429 限流），请求未被受理、不会重复扣费。系统已自动退避重试；仍然失败就等几分钟再点「重试」，或临时换用其它图像模型。';
  }
  if (/aborted due to timeout|生成等待超时|TimeoutError|请求超时|timed out/i.test(text)) {
    return '这次是本地等待超时，上游可能仍在出图：先不要连续重试，1~2 分钟后回到本会话看看结果，或稍后只重试一次。';
  }
  if (/连接图像上游超时/i.test(text)) {
    return '连不上图像上游（网络/代理问题），本次请求没有提交成功；检查网络后再重试。';
  }
  if (/HTTP 401|HTTP 403|鉴权失败|invalid api.?key/i.test(text)) {
    return '图像通道密钥或权限异常，请到设置页检查 NewAPI / 老张凭据是否过期。';
  }
  if (/HTTP 404|找不到该模型|model not found/i.test(text)) {
    return '该图像通道暂不提供这个模型，请切换其它图像模型后重试。';
  }
  if (/HTTP 5\d\d|上游图像服务异常|bad gateway|service unavailable/i.test(text)) {
    return '上游服务异常，稍后点「重试」；连续出现建议临时切换图像模型。';
  }
  if (/显存不足|CUDA out of memory/i.test(text)) {
    return '本地 GPU 显存被生图任务占满了。等生图队列清空（通常几分钟）后点「重试」即可。';
  }
  if (/加载模型|无响应（可能正在加载模型|提交超时|响应超时/.test(text)) {
    return '本地音频服务正在加载模型或排队，等 1~2 分钟后点「重试」即可。';
  }
  if (/生图队列已满|image queue/i.test(text)) {
    return '云端生图队列已满（临时限流），稍等几分钟再重试。';
  }
  if (/需要一段参考音频|参考音频没有读到|需要一段参考/.test(text)) {
    return '声音克隆需要参考音频：先上传一段 10~15 秒的人声，再填写要合成的文字。';
  }
  if (/BFF_PUBLIC_BASE|公网/.test(text)) {
    return '需要在「设置 → 运行时配置」里把 BFF_PUBLIC_BASE 填成可公网 HTTPS 访问的地址；或先切换到文生视频。';
  }
  if (/首帧|尾帧|keyframe/.test(text)) {
    return '首尾帧模式至少上传 1 张图片：第 1 张为首帧，第 2 张为尾帧。也可以切换到「文生视频」。';
  }
  if (/时长/.test(text)) {
    return '在上方参数条把「时长」调整到模型允许的范围即可。';
  }
  if (/画幅|aspect|ratio/i.test(text)) {
    return '在上方参数条把「画幅」切换为下拉中支持的比例。';
  }
  if (/data URL|blob|无法读取/.test(text)) {
    return '图片在浏览器里已失效，请删除附件后重新选择或上传。';
  }
  return '';
}
/**
 * 生成结果默认不入库：只有用户手动点「存入素材库」才登记 assets。
 * 复用 /api/assets/from-generation（shelf-lineage.registerGenerated），
 * 与「⭐ 收藏为配方」不同，后者写的是 creation_templates。
 */
function resultBarReason(msg) {
  const parts = [];
  if (msg?.creationError) parts.push(msg.creationError);
  if (msg?.librarySaveError) parts.push(msg.librarySaveError);
  if (msg?.srStatus === 'failed' && msg?.srError) parts.push(msg.srError);
  if (msg?.imgFailed && !msg?.librarySaveError) {
    parts.push(msg.imgAuth ? '登录已过期，重新登录后再入库。' : `这张产物取不到了${msg.imgErr ? `：${msg.imgErr}` : '。'}`);
  }
  return parts.filter(Boolean).join(' ');
}

function creationBodyFor(msg) {
  const prompt = sourcePromptFor(msg);
  let detectedType = 'image';
  if (msg?.videoUrl || msg?.modelVideoUrl || msg?.modality === 'video') detectedType = 'video';
  else if (msg?.audioUrl || msg?.modality === 'music') detectedType = 'audio';
  const isAudio = detectedType === 'audio';
  const isVideo = detectedType === 'video';
  const playing = isAudio ? (msg?.audioUrl || '') : (msg?.videoUrl || msg?.imageUrl || '');
  return {
    title: prompt.replace(/\s+/g, ' ').trim().slice(0, 24) || '未命名创作',
    prompt,
    type: detectedType,
    space: '',
    style: '',
    purpose: '',
    is_pinned: 0,
    aspect_ratio: msg?.ratio || schemaParams.value.ratio || selectedRatio.value,
    origin_images: recipeRefsForStorage(msg?.refs?.length ? msg.refs : referenceTray.value),
    result_images: isAudio ? [{ url: msg?.audioUrl || '', resolution: msg?.duration || '音频产物' }] : [{
      url: playing,
      poster: (isVideo && msg?.assetFid) ? `/api/viewer/assets/${encodeURIComponent(msg.assetFid)}/poster` : '',
      fid: msg?.assetFid || '',
      resolution: msg?.resolution || selectedResolution.value
    }],
    params: {
      model: msg?.model,
      modelKey: msg?.modelKey,
      genMode: detectedType === 'audio' ? 'music' : detectedType,
      mode: detectedType === 'audio' ? 'music' : detectedType,
      schemaMode: msg?.schemaMode || '',
      schemaParams: msg?.schemaParams || null,
      ratio: msg?.ratio || selectedRatio.value,
      resolution: msg?.resolution || selectedResolution.value
    },
    tags: [detectedType, '收藏配方'].filter(Boolean)
  };
}

async function saveResultToCreation(msg) {
  if (!msg || msg.savingCreation || msg.creationSaved) return;
  msg.savingCreation = true;
  msg.creationError = '';
  try {
    const res = await authFetch('/api/creation-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creationBodyFor(msg))
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      msg.creationError = json.error || '没能写入创作库';
      return;
    }
    msg.creationSaved = true;
    await loadTemplates();
  } catch (e) {
    msg.creationError = e?.message || '没能写入创作库';
  } finally {
    msg.savingCreation = false;
  }
}

async function applyAutoSuperResolve(msg) {
  if (!msg) return;
  const source = msg.modelVideoUrl || msg.videoUrl;
  if (!source) {
    msg.srStatus = 'failed';
    msg.srError = '没有可超分的视频，已停止播放';
    msg.videoUrl = '';
    return;
  }
  msg.modelVideoUrl = source;
  msg.videoUrl = '';
  msg.srStatus = 'running';
  msg.srError = '';
  msg.compareOpen = false;
  try {
    const data = await superResolveLocalVideo(source, msg.vendorVideoUrl || '');
    if (data?.ok && data.srVideoUrl) {
      msg.modelVideoUrl = data.modelVideoUrl || source;
      msg.videoUrl = data.srVideoUrl;
      msg.srStatus = 'done';
      msg.srError = '';
      return;
    }
    msg.modelVideoUrl = data?.modelVideoUrl || source;
    msg.videoUrl = data?.modelVideoUrl || source;
    msg.srStatus = 'failed';
    msg.srError = data?.error || '超分失败，已改播模型原片';
  } catch (e) {
    msg.videoUrl = source;
    msg.srStatus = 'failed';
    msg.srError = e?.message || '超分失败，已改播模型原片';
  }
}

async function saveResultToLibrary(msg) {
  if (!msg || msg.savingToLibrary || msg.librarySaved) return;
  if (msg.srStatus === 'running') {
    msg.librarySaveError = '超分完成前不能入素材库';
    return;
  }
  const previewUrl = msg.imageUrl || msg.videoUrl || msg.audioUrl;
  if (!previewUrl) {
    msg.librarySaveError = '这一轮没有可入库的产物';
    return;
  }
  msg.savingToLibrary = true;
  msg.librarySaveError = '';
  try {
    const filed = await registerGeneratedAsset({
      previewUrl,
      vendorUrl: msg.vendorVideoUrl || '',
      prompt: msg.userPrompt || msg.retryPrompt || '',
      model: msg.modelKey || msg.model || '',
      mode: msg.modality || 'image',
      ratio: msg.ratio || msg.params?.ratio || selectedRatio.value,
      resolution: msg.resolution || msg.params?.resolution || selectedResolution.value,
      sessionId: currentSessionId.value
    });
    msg.assetFid = filed?.fid || '';
    msg.librarySaved = true;
  } catch (e) {
    msg.librarySaveError = `存入失败：${e?.message || String(e)}`;
  } finally {
    msg.savingToLibrary = false;
  }
}

async function handleCancelGeneration(msg) {
  if (!msg) return;
  const jobId = msg.jobId || msg.runId || (msg.id && msg.id.startsWith('genmsg_') ? msg.id.replace('genmsg_', '') : '');
  const sid = currentSessionId.value;
  try {
    if (jobId) {
      await cancelGenJob(jobId);
    }
  } catch (e) {
    console.warn('取消生成请求返回异常:', e.message);
  } finally {
    msg.isGenerating = false;
    msg.isCancelled = true;
    msg.content = '生成已取消';
    if (sid) {
      sessionGeneratingMap.delete(sid);
      sessionPlaceholderMap.delete(sid);
    }
    generating.value = false;
  }
}

async function openRetry(msg) {
  if (!msg) return;
  fillComposerFromError(msg);
  await sendMessage();
}
function editFromError(msg) {
  fillComposerFromError(msg);
}

function reeditResult(msg) {
  if (!msg) return;
  let sourceMsg = msg.role === 'user' ? msg : null;
  if (!sourceMsg) {
    const idx = messages.value.indexOf(msg);
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (messages.value[i]?.role === 'user' && (messages.value[i].content || messages.value[i].userPrompt)) {
        sourceMsg = messages.value[i];
        break;
      }
    }
  }
  if (!sourceMsg) return;
  const prompt = sourceMsg.userPrompt || sourceMsg.content || sourcePromptFor(sourceMsg);
  let refs = [];
  if (Array.isArray(sourceMsg.refs) && sourceMsg.refs.length) refs = sourceMsg.refs;
  else if (Array.isArray(sourceMsg.params?.refs) && sourceMsg.params.refs.length) refs = sourceMsg.params.refs;
  else if (Array.isArray(msg.refs) && msg.refs.length) refs = msg.refs;
  const params = sourceMsg.params || msg.params || {};
  fillComposerFromError({
    retryPrompt: prompt,
    retryRefs: refs,
    retryModel: sourceMsg.modelKey || msg.modelKey || params.model || msg.retryModel || '',
    retryModality: sourceMsg.modality || msg.modality || msg.retryModality || '',
    retryMode: sourceMsg.genMode || msg.genMode || params.genMode || params.schemaMode || msg.retryMode || '',
    retryParams: { ...(msg.retryParams || {}), ...params },
  });
  nextTick(() => {
    richEditorRef.value?.focus();
    scrollToBottom();
  });
}

// 把历史某一轮恢复到输入区；若后面还有新的用户轮次，则先新建会话，原对话保留
async function editRound(msg) {
  if (!msg) return;
  let sourceMsg = msg.role === 'user' ? msg : null;
  if (!sourceMsg) {
    const idx = messages.value.indexOf(msg);
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (messages.value[i]?.role === 'user' && (messages.value[i].content || messages.value[i].userPrompt)) {
        sourceMsg = messages.value[i];
        break;
      }
    }
  }
  if (!sourceMsg) return;

  const sourceIdx = messages.value.indexOf(sourceMsg);
  const hasLaterUserRound = sourceIdx >= 0
    && messages.value.slice(sourceIdx + 1).some((m) => m?.role === 'user');
  if (hasLaterUserRound) {
    await createNewSession({ forceReset: true });
  }

  const prompt = sourceMsg.userPrompt || sourceMsg.content || sourcePromptFor(sourceMsg);
  let refs = [];
  if (Array.isArray(sourceMsg.refs) && sourceMsg.refs.length) refs = sourceMsg.refs;
  else if (Array.isArray(sourceMsg.params?.refs) && sourceMsg.params.refs.length) refs = sourceMsg.params.refs;
  else if (Array.isArray(msg.refs) && msg.refs.length) refs = msg.refs;
  const params = sourceMsg.params || msg.params || {};

  fillComposerFromError({
    retryPrompt: prompt,
    retryRefs: refs,
    retryModel: sourceMsg.modelKey || msg.modelKey || params.model || msg.retryModel || '',
    retryModality: sourceMsg.modality || msg.modality || msg.retryModality || '',
    retryMode: sourceMsg.genMode || msg.genMode || params.genMode || params.schemaMode || msg.retryMode || '',
    retryParams: { ...(msg.retryParams || {}), ...params },
  });
  nextTick(() => {
    richEditorRef.value?.focus();
    scrollToBottom();
  });
}
function editFromRetryDialog() {
  const msg = retryDialog.value.msg;
  retryDialog.value = { visible: false, msg: null };
  if (msg) fillComposerFromError(msg);
}
async function confirmDirectRetry() {
  const msg = retryDialog.value.msg;
  retryDialog.value = { visible: false, msg: null };
  if (!msg) return;
  fillComposerFromError(msg);
  retryNotice.value = true;
  await sendMessage();
}
function sourcePromptFor(msg) {
  if (msg?.userPrompt) return msg.userPrompt;
  const idx = messages.value.indexOf(msg);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const prev = messages.value[i];
    if (prev?.role === 'user' && prev.content) return prev.content;
  }
  return msg?.role === 'user' ? (msg.content || '') : '';
}

async function fillSaveTagsFromAsset(fid) {
  if (!fid) return { space: '', style: '', purpose: '' };
  try {
    const res = await authFetch(`/api/assets/${encodeURIComponent(fid)}`);
    const json = await res.json();
    const tags = json.data?.tags || [];
    const pick = (dim) => tags.find((item) => item.dimension === dim)?.dir || '';
    const styles = tags.filter((item) => item.dimension === 'style_atom').map((item) => item.dir);
    return { space: pick('space'), style: styles[0] || '', purpose: pick('video_purpose') };
  } catch {
    return { space: '', style: '', purpose: '' };
  }
}

async function openSaveToLibraryModal(msg) {
  const prompt = sourcePromptFor(msg);
  let detectedType = 'image';
  if (msg?.videoUrl || msg?.modality === 'video') detectedType = 'video';
  else if (msg?.audioUrl || msg?.modality === 'music') detectedType = 'audio';
  else if (activeModality.value === 'video') detectedType = 'video';
  else if (activeModality.value === 'music') detectedType = 'audio';
  const fromAsset = await fillSaveTagsFromAsset(msg?.assetFid);

  saveModal.value = {
    visible: true,
    title: prompt.replace(/\s+/g, ' ').trim().slice(0, 24) || '未命名创作',
    prompt,
    type: detectedType,
    space: fromAsset.space,
    style: fromAsset.style,
    purpose: detectedType === 'video' ? fromAsset.purpose : '',
    is_pinned: false,
    msg
  };
}

async function submitSaveToLibrary() {
  if (!saveModal.value.title.trim()) return;
  savingTpl.value = true;
  try {
    const isAudio = saveModal.value.type === 'audio' || saveModal.value.msg?.audioUrl;
    const isVideo = saveModal.value.type === 'video' || saveModal.value.msg?.videoUrl;
    const res = await authFetch('/api/creation-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: saveModal.value.title,
        prompt: saveModal.value.prompt,
        type: saveModal.value.type || 'image',
        space: saveModal.value.space || '',
        style: saveModal.value.style || '',
        purpose: saveModal.value.type === 'video' ? (saveModal.value.purpose || '') : '',
        is_pinned: saveModal.value.is_pinned ? 1 : 0,
        aspect_ratio: saveModal.value.msg?.ratio || schemaParams.value.ratio || selectedRatio.value,
        origin_images: recipeRefsForStorage(saveModal.value.msg?.refs?.length ? saveModal.value.msg.refs : referenceTray.value),
        result_images: isAudio ? [{
          url: saveModal.value.msg?.audioUrl || '',
          resolution: saveModal.value.msg?.duration || '音频产物'
        }] : [{
          url: saveModal.value.msg?.imageUrl || saveModal.value.msg?.videoUrl || '',
          poster: (isVideo && saveModal.value.msg?.assetFid) ? `/api/viewer/assets/${encodeURIComponent(saveModal.value.msg.assetFid)}/poster` : '',
          fid: saveModal.value.msg?.assetFid || '',
          resolution: saveModal.value.msg?.resolution || selectedResolution.value
        }],
        params: {
          model: saveModal.value.msg?.model,
          modelKey: saveModal.value.msg?.modelKey,
          genMode: saveModal.value.type === 'audio' ? 'music' : (saveModal.value.type === 'video' ? 'video' : 'image'),
          mode: saveModal.value.type === 'audio' ? 'music' : (saveModal.value.type === 'video' ? 'video' : 'image'),
          // genMode/mode 存的是「模态」，schemaMode 才是首尾帧/多参考/文生视频这一层；
          // 两者混用会让 applyTemplate 的模态判定拿到一个 schema id 而失效。
          schemaMode: saveModal.value.msg?.schemaMode || activeGenMode.value || '',
          // 从输入区直接存配方时没有 msg，不落到当前 schemaParams 就会把参数条的选择整条丢掉
          schemaParams: saveModal.value.msg?.schemaParams || (currentSchema.value ? { ...schemaParams.value } : null),
          ratio: saveModal.value.msg?.ratio || schemaParams.value.ratio || selectedRatio.value,
          resolution: saveModal.value.msg?.resolution || schemaParams.value.resolution || schemaParams.value.size || selectedResolution.value
        },
        tags: [saveModal.value.type, saveModal.value.space, saveModal.value.style, saveModal.value.purpose, '收藏配方'].filter(Boolean)
      })
    });
    const json = await res.json();
    if (json.success) {
      saveModal.value.visible = false;
      await loadTemplates();
      alert('已成功存入我的创作库！您可以在左侧创作库中查看或在输入框输入 # 快速复用。');
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  } finally {
    savingTpl.value = false;
  }
}

async function deleteTemplate(id) {
  if (!confirm('确定删除此创作配方吗？')) return;
  try {
    const res = await authFetch(`/api/creation-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      detailModal.value.visible = false;
      templates.value = templates.value.filter(t => t.id !== id);
    }
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

function addMediaToViewer(item) {
  if (!item) return;
  const url = typeof item === 'string' ? item : (item.imageUrl || item.url);
  if (!url) return;
  const cap = refCap() || 8;
  const existingIndex = referenceTray.value.findIndex(r => r.url === url);
  if (existingIndex >= 0) {
    selectedImageIndex.value = existingIndex;
  } else {
    if (referenceTray.value.length >= cap) {
      alert(`参考图托盘已满（上限 ${cap} 张），请先移除部分参考图再添加`);
      return;
    }
    const idx = referenceTray.value.length + 1;
    referenceTray.value.push({
      name: item.name || `参考图_${idx}`,
      url,
      tag: `@图${idx}`,
      thumbUrl: item.thumbUrl || item.preview_url || url,
      isRefObject: !!item.isRefObject
    });
    selectedImageIndex.value = referenceTray.value.length - 1;
  }
  viewerCollapsed.value = false;
}

function triggerPrecisionEdit(msg) {
  addMediaToViewer(msg);
  rightDrawerOpen.value = true;
}

function sendVideoToClip(msg) {
  // 剪辑桥接只认 {fid, file_name, mime, duration}；直接把消息对象丢过去会因缺 fid 被静默丢弃
  if (msg.assetFid) {
    emit('sendToClip', {
      fid: msg.assetFid,
      file_name: `AI视频_${Date.now()}.mp4`,
      mime: 'video/mp4',
      duration: parseFloat(String(msg.duration || '')) || 0,
      derivativeId: ''
    });
    return;
  }
  alert('该视频尚未完成入库，请稍后重试或先下载 MP4 手动导入');
}

function captureFrameFromVideo(msg) {
  const idx = messages.value.indexOf(msg);
  const videoEl = idx >= 0 ? videoPlayers[idx] : null;
  if (!videoEl || !videoEl.videoWidth) {
    alert('视频尚未加载完成，请先播放或等待加载后再截帧');
    return;
  }
  const cap = refCap();
  if (cap != null && referenceTray.value.length >= cap) {
    alert(`当前模式最多挂载 ${cap} 张参考图`);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const asset = {
    name: `截帧_${Date.now()}.jpg`,
    url: dataUrl,
    weight: 85,
    tag: `@图${referenceTray.value.length + 1}`,
    kind: 'image',
    origin: 'video_frame'
  };
  referenceTray.value.push(asset);
  // 用户需求：不自动在对话框新增胶囊
}

const videoPlayers = {};
function registerVideoEl(idx, el) {
  if (el) videoPlayers[idx] = el;
}
</script>

<style scoped>
.rich-prompt-editor:empty:before {
  content: attr(data-placeholder);
  color: var(--theme-text-muted);
  pointer-events: none;
}

:deep(.inline-asset-chip) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  background-color: var(--theme-chip-bg);
  border: 1px solid var(--theme-chip-border);
  color: var(--theme-chip-text);
  padding: 1px 7px;
  border-radius: 9999px;
  font-weight: 700;
  font-size: 11.5px;
  user-select: none;
  margin: 0 2px;
  vertical-align: middle;
}

:deep(.inline-asset-thumb) {
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.4);
}

:deep(.inline-asset-delete) {
  cursor: pointer;
  margin-left: 2px;
  font-weight: bold;
  opacity: 0.7;
}

:deep(.inline-asset-delete:hover) {
  opacity: 1;
  color: var(--theme-danger-text);
}

.tray-ref-delete {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  background: rgba(15, 23, 42, 0.82);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}

/* ===== 错误卡片（生成失败提示，token 驱动，适配暗黑/明朗/护眼） ===== */
.gen-error {
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--theme-danger-bg);
  border: 1px solid var(--theme-danger-border);
}
.gen-error-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 6px;
}
.gen-error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: rgb(var(--studio-rose-rgb) / 0.18);
  color: var(--theme-danger-text);
}
.gen-error-title {
  font-size: 12.5px;
  font-weight: 800;
  color: var(--theme-danger-text);
}
.gen-error-body {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.55;
  color: var(--theme-text-primary);
  white-space: pre-wrap;
}
.gen-error-hint {
  margin: 7px 0 0;
  display: flex;
  align-items: flex-start;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--theme-text-secondary);
}
.gen-error-hint svg {
  margin-top: 2px;
  flex-shrink: 0;
  color: var(--theme-warning-text);
}
.gen-error-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
}
.gen-error-retry,
.gen-error-edit {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 13px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: filter .15s, background-color .15s;
}
.gen-error-retry {
  background: var(--theme-accent-primary);
  color: var(--theme-accent-text);
  border: 1px solid transparent;
}
.gen-error-retry:hover { filter: brightness(1.08); }
.gen-error-edit {
  background: transparent;
  color: var(--theme-text-secondary);
  border: 1px solid var(--theme-border);
}
.gen-error-edit:hover {
  background: var(--theme-bg-hover);
  color: var(--theme-text-primary);
}

/* ---- 助手正文 Markdown 排版（v-html 注入：宿主 .chat-md 带 scoped 属性，
        其内部标签不带，故命中内部标签需 :deep；直接子元素用普通 scoped 选择器即可）
        颜色全部走 --md-* 变量：默认深色（聊天面板底色），浅色主题由
        html.light / html.eye-care 覆盖，跟随主题切换 ---- */
.chat-md {
  --md-heading: #f1f5f9;
  --md-strong: #f8fafc;
  --md-link: #22d3ee;
  --md-muted: #94a3b8;
  --md-quote-border: rgba(34, 211, 238, 0.5);
  --md-code-bg: rgba(148, 163, 184, 0.15);
  --md-code-border: rgba(148, 163, 184, 0.22);
  --md-pre-bg: #0b1220;
  --md-pre-fg: #e2e8f0;
  --md-table-border: rgba(148, 163, 184, 0.28);
  --md-table-head-bg: rgba(148, 163, 184, 0.12);
  --md-hr: rgba(148, 163, 184, 0.25);
  color: var(--md-strong);
  font-size: 12.5px;
  line-height: 1.7;
  word-break: break-word;
}
html.light .chat-md,
html.eye-care .chat-md {
  --md-heading: #1e293b;
  --md-strong: #0f172a;
  --md-link: #0891b2;
  --md-muted: #64748b;
  --md-quote-border: rgba(8, 145, 178, 0.45);
  --md-quote-fg: #475569;
  --md-code-bg: rgba(100, 116, 139, 0.12);
  --md-code-border: rgba(100, 116, 139, 0.25);
  --md-pre-bg: #f1f5f9;
  --md-pre-fg: #1e293b;
  --md-table-border: rgba(100, 116, 139, 0.3);
  --md-table-head-bg: rgba(100, 116, 139, 0.12);
  --md-hr: rgba(100, 116, 139, 0.3);
}
.chat-md > * + * { margin-top: 0.6em; }
.chat-md :deep(h1),
.chat-md :deep(h2),
.chat-md :deep(h3),
.chat-md :deep(h4) { font-weight: 700; color: var(--md-heading); line-height: 1.4; }
.chat-md :deep(h1) { font-size: 1.35em; }
.chat-md :deep(h2) { font-size: 1.22em; }
.chat-md :deep(h3) { font-size: 1.1em; }
.chat-md :deep(h4) { font-size: 1em; }
.chat-md :deep(ul),
.chat-md :deep(ol) { padding-left: 1.4em; }
.chat-md :deep(ul) { list-style: disc; }
.chat-md :deep(ol) { list-style: decimal; }
.chat-md :deep(li) { margin: 0.2em 0; }
.chat-md :deep(li > ul),
.chat-md :deep(li > ol) { margin-top: 0.2em; }
.chat-md :deep(strong) { color: var(--md-strong); font-weight: 700; }
.chat-md :deep(em) { font-style: italic; }
.chat-md :deep(a) { color: var(--md-link); text-decoration: underline; text-underline-offset: 2px; }
.chat-md :deep(blockquote) {
  border-left: 3px solid var(--md-quote-border);
  padding: 0.2em 0 0.2em 0.9em;
  color: var(--md-muted);
}
.chat-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: var(--md-code-bg);
  border: 1px solid var(--md-code-border);
  border-radius: 5px;
  padding: 0.1em 0.4em;
}
.chat-md :deep(pre) {
  background: var(--md-pre-bg);
  border: 1px solid var(--md-code-border);
  border-radius: 10px;
  padding: 0.8em 1em;
  overflow-x: auto;
}
.chat-md :deep(pre code) {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 0.85em;
  color: var(--md-pre-fg);
}
.chat-md :deep(hr) { border: none; border-top: 1px solid var(--md-hr); }
.chat-md :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92em;
  display: block;
  overflow-x: auto;
}
.chat-md :deep(th),
.chat-md :deep(td) {
  border: 1px solid var(--md-table-border);
  padding: 0.4em 0.7em;
  text-align: left;
}
.chat-md :deep(th) { background: var(--md-table-head-bg); font-weight: 700; }
.chat-md :deep(img) { max-width: 100%; border-radius: 8px; }

/* 可复制文本块：md-unit 由 renderMarkdown 注入（sec 按标题层级嵌套，code/quote/table 独立成块），
   按钮文字统一走容器委托事件；正文需显式覆盖 body 上的 select-none 才能选中 */
.chat-md {
  user-select: text;
  -webkit-user-select: text;
}
.chat-md :deep(.md-unit) { position: relative; }
.chat-md :deep(.md-unit-sec) {
  border: 1px solid var(--md-code-border);
  border-radius: 12px;
  padding: 0.5em 0.65em 0.6em;
  background: rgba(148, 163, 184, 0.06);
}
.chat-md :deep(.md-unit-sec + .md-unit-sec),
.chat-md :deep(.md-unit) + .md-unit { margin-top: 0.55em; }
.chat-md :deep(.md-unit-sec .md-unit-sec) { background: transparent; }
.chat-md :deep(.md-unit-sec) > :is(h1, h2, h3, h4) {
  margin-top: 0;
  padding-right: 3.8em;
}
.chat-md :deep(.md-unit-bar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 0.35em;
}
.chat-md :deep(.md-unit-label) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--md-muted);
}
.chat-md :deep(.md-copy-btn) {
  position: absolute;
  top: 0.4em;
  right: 0.4em;
  z-index: 2;
  padding: 0.15em 0.6em;
  font-size: 10px;
  font-weight: 700;
  border-radius: 6px;
  border: 1px solid var(--md-code-border);
  background: var(--md-code-bg);
  color: var(--md-pre-fg);
  opacity: 0.55;
  transition: opacity 0.12s ease, background-color 0.12s ease;
  cursor: pointer;
  user-select: none;
}
.chat-md :deep(.md-unit-bar .md-copy-btn) { position: static; opacity: 0.8; }
.chat-md :deep(.md-unit:hover) > .md-copy-btn,
.chat-md :deep(.md-unit-bar .md-copy-btn:hover),
.chat-md :deep(.md-copy-btn:focus-visible) { opacity: 1; }
.chat-md :deep(.md-unit-quote) { padding-right: 3.4em; }
.chat-md :deep(.md-unit-table) { padding-top: 1.1em; }

/* 气泡头部的「复制全文」：拿到的是这条回复的 Markdown 原文 */
.msg-copy-all {
  padding: 1px 8px;
  border-radius: 7px;
  border: 1px solid var(--md-code-border);
  background: var(--md-code-bg);
  color: var(--theme-text-secondary, #cbd5e1);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
}
html.light .msg-copy-all,
.msg-copy-all:hover { filter: brightness(1.12); }

@keyframes shimmerWave {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}
.shimmer-wave {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(99, 102, 241, 0.08) 25%,
    rgba(6, 182, 212, 0.15) 50%,
    rgba(99, 102, 241, 0.08) 75%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: shimmerWave 2.5s infinite linear;
  will-change: transform;
}
</style>
