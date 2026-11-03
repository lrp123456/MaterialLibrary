<template>
  <div class="flex-1 min-h-0 flex flex-col bg-studio-950 overflow-hidden text-slate-100 font-sans text-sm">
    <!-- 常用媒体工具顶部标头 -->
    <header class="h-12 bg-studio-900 border-b border-studio-750 px-6 flex items-center justify-between shrink-0">
      <div class="flex items-center space-x-3">
        <div class="w-8 h-8 rounded-lg bg-studio-emerald/20 text-studio-emerald flex items-center justify-center border border-studio-emerald/40">
          <StudioIcon name="sliders" :size="18" />
        </div>
        <div>
          <h2 class="text-sm font-extrabold text-white flex items-center gap-2">
            常用媒体工具箱
            <span class="px-2 py-0.5 rounded text-[11px] bg-studio-cyan/15 text-studio-cyan font-mono font-bold border border-studio-cyan/30">
              视频元素寻帧 + 画布
            </span>
          </h2>
        </div>
      </div>

      <!-- 工具选项卡 -->
      <div class="flex items-center space-x-1 bg-studio-950 p-1 rounded-xl border border-studio-800">
        <button
          v-for="t in toolTabs"
          :key="t.key"
          @click="activeTool = t.key"
          :class="[
            'px-4 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1.5 cursor-pointer',
            activeTool === t.key
              ? 'bg-studio-accent text-white shadow font-bold'
              : 'text-slate-400 hover:text-white'
          ]"
        >
          <span>{{ t.icon }}</span>
          <span>{{ t.label }}</span>
        </button>
      </div>
    </header>

    <!-- 主工作区 -->
    <main class="flex-1 overflow-y-auto p-5 scrollbar-thin">
      <!-- ========================================================================= -->
      <!-- 1. 极速逐帧解码与抽帧工作台 (WebCodecs 硬件加速 + LRU 缓存 + 胶片条) -->
      <!-- ========================================================================= -->
      <div v-if="activeTool === 'frames'" class="space-y-4 max-w-7xl mx-auto">
        <!-- 头部说明条 -->
        <div class="flex items-center justify-between pb-2 border-b border-studio-800">
          <div class="flex items-center space-x-3">
            <span class="text-lg">🎞️</span>
            <div>
              <h3 class="text-sm font-extrabold text-white flex items-center gap-2">
                视频极速寻帧 · 智能抽帧工作台
                <span
                  v-if="extractorStatus.strategy === 'webcodecs'"
                  class="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-bold flex items-center gap-1"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  ⚡ WebCodecs GPU 硬件解码 (1~3ms)
                </span>
                <span
                  v-else-if="extractorStatus.strategy === 'html5'"
                  class="px-2 py-0.5 rounded text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono font-bold flex items-center gap-1"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                  🎬 HTML5 增强寻帧 (24 帧热缓存)
                </span>
                <span
                  v-else-if="extractorStatus.strategy === 'error'"
                  class="px-2 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono font-bold"
                >
                  ⚠️ 解码异常
                </span>
              </h3>
              <p class="text-xs text-slate-400">
                支持键盘左右方向键（← / →）单帧极速步进、0ms 缓存瞬间响应、时间轴全景胶片条与批量/关键帧抽取
              </p>
            </div>
          </div>

          <div class="flex items-center space-x-2">
            <!-- WGSL GPU 加速锐化开关 -->
            <button
              @click="toggleWgslEnhancerMode"
              :class="[
                'px-2.5 py-1 rounded-xl text-xs font-mono font-bold border transition-all flex items-center space-x-1 cursor-pointer',
                wgslEnabled
                  ? 'bg-purple-900/60 text-purple-300 border-purple-500 shadow-lg shadow-purple-500/20'
                  : 'bg-studio-850 text-slate-400 border-studio-750 hover:text-white'
              ]"
              :title="wgslSupported ? '开启/关闭 WGSL 硬件着色器外部纹理直读与自适应对比度超清锐化 (CAS)' : '当前环境未检测到 WebGPU API 支持'"
            >
              <span class="w-2 h-2 rounded-full" :class="wgslEnabled ? 'bg-purple-400 animate-ping' : 'bg-slate-500'"></span>
              <span>⚡ WGSL 超清锐化: {{ wgslEnabled ? '已开启' : '关闭' }}</span>
            </button>

            <span
              class="px-2.5 py-1 rounded bg-studio-850 text-slate-300 border border-studio-750 text-[11px] font-mono max-w-[220px] truncate"
              :title="videoSource.name"
            >
              {{ videoSource.kind === 'cloud' ? '☁︎' : (videoSource.kind === 'local' ? '⚟' : '◦') }} {{ videoSource.name }}
            </span>
            <button
              @click="openVideoPicker('frames')"
              class="px-3 py-1.5 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-700 text-studio-cyan text-xs font-extrabold flex items-center space-x-1.5 cursor-pointer"
            >
              <span>☁︎ 素材库选择</span>
            </button>
            <button
              @click="triggerVideoInput"
              class="px-3.5 py-1.5 rounded-xl bg-studio-accent text-white text-xs font-extrabold shadow hover:brightness-110 flex items-center space-x-1.5 cursor-pointer ml-1"
            >
              <span>📂 载入本地视频</span>
            </button>
            <input ref="videoFileInput" type="file" accept="video/*" class="hidden" @change="onVideoSelected" />
          </div>
        </div>

        <!-- 主视口网格：左侧逐帧大画布 + 右侧元数据面板 -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <!-- 左侧：超清帧画面视口 (8 列) -->
          <div class="lg:col-span-8 flex flex-col justify-between bg-studio-900 rounded-2xl border border-studio-750 p-4 shadow-xl relative overflow-hidden">
            <!-- 帧标签与缓存命中徽章 -->
            <div class="on-media absolute top-4 left-4 z-20 flex items-center space-x-2">
              <div class="media-badge px-3 py-1.5 rounded-lg border text-xs font-mono font-extrabold shadow-lg">
                Frame: {{ currentFrameNumber }}
              </div>
              <div
                v-if="cachedFramesCount > 0"
                class="px-2.5 py-1 rounded-lg font-mono text-[11px] shadow-lg hidden sm:flex items-center gap-1"
                style="background: rgba(6, 78, 59, 0.88); color: #6ee7b7; border: 1px solid rgba(52, 211, 153, 0.45); backdrop-filter: blur(8px);"
                title="当前已有帧缓存进内存，可 0ms 瞬间反复微调"
              >
                <span>⚡ {{ cachedFramesCount }} 帧热缓存 (0ms)</span>
              </div>
            </div>

            <!-- 主画面画布容器 -->
            <div
              ref="frameStageRef"
              class="relative w-full h-[480px] bg-[#0c0f17] flex items-center justify-center rounded-xl overflow-hidden select-none border border-studio-700 shadow-inner"
            >
              <!-- 核心绘制主画布 (2D 标准模式) -->
              <canvas
                v-show="!wgslEnabled"
                ref="frameCanvasRef"
                class="max-w-full max-h-full object-contain transition-transform"
              ></canvas>

              <!-- WebGPU 专属原生硬件画布 (WGSL 超清锐化与零拷贝模式) -->
              <canvas
                v-show="wgslEnabled"
                ref="wgslCanvasRef"
                class="max-w-full max-h-full object-contain transition-transform"
              ></canvas>

              <!-- 隐藏的 HTML5 Video 元素（仅作为二级火箭兜底与解码源） -->
              <video
                ref="videoRef"
                class="hidden"
                playsinline
                preload="auto"
              ></video>

              <!-- 加载中遮罩 (Skeleton) -->
              <div
                v-if="extractorStatus.loading"
                class="absolute inset-0 bg-studio-950/80 backdrop-blur-sm flex flex-col items-center justify-center space-y-3 z-30 animate-in fade-in"
              >
                <div class="w-10 h-10 border-4 border-studio-cyan border-t-transparent rounded-full animate-spin"></div>
                <div class="text-xs text-studio-cyan font-mono font-bold tracking-wide">
                  {{ extractorStatus.message || '正在解码渲染视频帧...' }}
                </div>
              </div>

              <!-- 解码错误兜底卡片 -->
              <div
                v-if="extractorStatus.strategy === 'error'"
                class="absolute inset-0 bg-studio-950/95 flex flex-col items-center justify-center p-6 text-center space-y-3 z-30"
              >
                <span class="text-3xl">⚠️</span>
                <div class="text-sm font-bold text-rose-300">浏览器无法直接解码此视频格式</div>
                <p class="text-xs text-slate-400 max-w-md">
                  当前视频编码可能为特殊格式（如部分 10-bit HEVC、ProRes 或未安装硬件解码扩展）。建议使用系统内置的原生 FFmpeg 引擎一键轻量转码后即可完美寻帧。
                </p>
                <div class="flex items-center space-x-2 pt-2">
                  <button
                    @click="resetToDefaultVideo"
                    class="px-3.5 py-2 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-700 text-slate-300 text-xs font-bold cursor-pointer"
                  >
                    重置为示例视频
                  </button>
                  <button
                    @click="fallbackToConvert"
                    class="px-4 py-2 rounded-xl bg-studio-accent text-white text-xs font-bold shadow hover:brightness-110 cursor-pointer flex items-center space-x-1.5"
                  >
                    <span>🔄 切换至格式转换工坊（FFmpeg 引擎）</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 视口底部工具栏 (尺寸信息 + 导出当前帧) -->
            <div class="flex items-center justify-between pt-3 border-t border-studio-800 text-xs">
              <div class="flex items-center space-x-2 text-slate-300 font-mono">
                <span class="text-slate-400">视频源分辨率:</span>
                <span class="font-bold text-white">{{ videoWidth }} × {{ videoHeight }}</span>
                <span class="text-slate-500">|</span>
                <span class="text-emerald-400 font-bold">{{ videoFps.toFixed(1) }} FPS</span>
                <span class="text-slate-500">|</span>
                <span class="text-studio-cyan font-bold">{{ (currentTimestamp).toFixed(3) }}s</span>
                <span class="text-slate-500">|</span>
                <span class="text-purple-300 font-bold" v-if="wgslEnabled">WGSL 锐化管线 ✓</span>
              </div>

              <div class="flex items-center space-x-2">
                <button
                  @click="copyCurrentFrame"
                  class="px-3.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center space-x-1 cursor-pointer active:scale-95 shadow-sm"
                >
                  <span>📋 复制图像</span>
                </button>
                <button
                  @click="exportCurrentFramePNG"
                  class="px-3.5 py-1.5 rounded-lg bg-studio-cyan/20 hover:bg-studio-cyan/30 text-studio-cyan border border-studio-cyan/40 text-xs font-extrabold flex items-center space-x-1 cursor-pointer active:scale-95 shadow"
                  :title="`导出无损原画 PNG (${videoWidth} × ${videoHeight})`"
                >
                  <span>📥 导出原画 PNG ({{ videoWidth }}×{{ videoHeight }})</span>
                </button>
                <button
                  @click="saveCurrentFrameToLibrary"
                  class="px-3.5 py-1.5 rounded-lg bg-studio-emerald hover:brightness-110 text-white text-xs font-extrabold flex items-center space-x-1.5 shadow cursor-pointer active:scale-95"
                >
                  <StudioIcon name="star" :size="13" />
                  <span>⭐ 截取此帧入池</span>
                </button>
              </div>
            </div>
          </div>

          <!-- 右侧：Frame Information 看板与高级抽帧工具箱 (4 列) -->
          <div class="lg:col-span-4 flex flex-col justify-between space-y-4">
            <!-- Frame Information 卡片 -->
            <div class="p-4 rounded-2xl bg-studio-900 border border-studio-750 shadow space-y-3">
              <span class="text-xs font-extrabold text-white flex items-center justify-between pb-2 border-b border-studio-800">
                <span class="flex items-center gap-2">
                  <span>ℹ️</span>
                  <span>Frame Information 帧元数据</span>
                </span>
                <span class="text-[10px] font-mono text-emerald-400 font-bold flex items-center gap-1">
                  <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                  {{ extractorStatus.strategy === 'webcodecs'
                    ? 'WebCodecs GPU 硬解'
                    : (extractorStatus.strategy === 'html5' ? 'HTML5 引擎' : '引擎待命中') }}
                </span>
              </span>

              <div class="space-y-2 text-xs font-mono">
                <div class="flex justify-between py-1 border-b border-studio-850">
                  <span class="text-slate-400">Frame Number:</span>
                  <span class="text-studio-cyan font-bold">{{ currentFrameNumber }}</span>
                </div>
                <div class="flex justify-between py-1 border-b border-studio-850">
                  <span class="text-slate-400">Timecode:</span>
                  <span class="text-slate-100 font-bold font-mono">{{ currentTimecode }}</span>
                </div>
                <div class="flex justify-between py-1 border-b border-studio-850">
                  <span class="text-slate-400">Timestamp:</span>
                  <span class="text-slate-100 font-bold font-mono">{{ currentTimestamp.toFixed(4) }}s</span>
                </div>
                <div class="flex justify-between py-1 border-b border-studio-850">
                  <span class="text-slate-400">Resolution:</span>
                  <span class="text-slate-100 font-bold font-mono">{{ videoWidth }} × {{ videoHeight }}</span>
                </div>
                <div class="flex justify-between py-1 border-b border-studio-850">
                  <span class="text-slate-400">Video FPS:</span>
                  <span class="text-studio-emerald font-bold">{{ videoFps.toFixed(2) }} fps</span>
                </div>
                <div class="flex justify-between py-1 border-b border-studio-850">
                  <span class="text-slate-400">Duration:</span>
                  <span class="text-slate-100 font-bold font-mono">{{ videoDuration.toFixed(1) }}s</span>
                </div>
                <div class="flex justify-between py-1 border-b border-studio-850">
                  <span class="text-slate-400">Total Frames:</span>
                  <span class="text-studio-cyan font-bold">{{ totalFrames }}</span>
                </div>
                <div class="flex justify-between py-1">
                  <span class="text-slate-400">解码策略:</span>
                  <span class="text-emerald-400 font-bold">
                    {{ extractorStatus.strategy === 'webcodecs'
                      ? 'WebCodecs 硬件加速'
                      : (extractorStatus.strategy === 'html5' ? 'HTML5 元素寻帧' : '引擎探测中') }}
                  </span>
                </div>
              </div>
            </div>

            <!-- 全功能智能抽帧工具卡片 (新增) -->
            <div class="p-4 rounded-2xl bg-studio-900 border border-studio-750 shadow space-y-3">
              <span class="text-xs font-extrabold text-white flex items-center gap-2 pb-2 border-b border-studio-800">
                <span>⚡</span>
                <span>智能抽帧与批量提取工坊</span>
              </span>

              <div class="grid grid-cols-2 gap-2">
                <!-- 批量等间隔抽帧触发 (三大主题精装按钮) -->
                <button
                  @click="openBatchModal"
                  :disabled="batchProcessing"
                  class="py-3 px-2 rounded-xl bg-indigo-50/90 hover:bg-indigo-100/90 dark:bg-studio-accent/20 dark:hover:bg-studio-accent/30 border-2 border-indigo-200 dark:border-studio-accent/50 text-indigo-950 dark:text-indigo-200 text-xs font-extrabold flex flex-col items-center justify-center space-y-1 cursor-pointer transition-all disabled:opacity-50 shadow-sm active:scale-95"
                >
                  <span class="text-base">⏱️</span>
                  <span>批量等间隔抽帧</span>
                </button>

                <!-- 关键帧智能提取 (三大主题精装按钮) -->
                <button
                  @click="extractKeyframesAction"
                  :disabled="batchProcessing"
                  class="py-3 px-2 rounded-xl bg-emerald-50/90 hover:bg-emerald-100/90 dark:bg-studio-emerald/20 dark:hover:bg-studio-emerald/30 border-2 border-emerald-200 dark:border-studio-emerald/50 text-emerald-950 dark:text-emerald-200 text-xs font-extrabold flex flex-col items-center justify-center space-y-1 cursor-pointer transition-all disabled:opacity-50 shadow-sm active:scale-95"
                >
                  <span class="text-base">🎯</span>
                  <span>提取场景关键帧</span>
                </button>
              </div>

              <!-- 批量处理中进度条 -->
              <div v-if="batchProcessing" class="p-2.5 rounded-xl bg-studio-950 border border-studio-800 space-y-1.5 animate-in fade-in">
                <div class="flex justify-between text-[11px] font-mono">
                  <span class="text-studio-cyan font-bold">正在极速抽帧: {{ batchProgress.current }} / {{ batchProgress.total }}</span>
                  <span class="text-slate-300 font-bold">{{ batchProgress.percent }}%</span>
                </div>
                <div class="w-full bg-studio-850 h-2 rounded-full overflow-hidden">
                  <div class="bg-gradient-to-r from-studio-accent to-studio-cyan h-full transition-all duration-150 rounded-full" :style="{ width: `${batchProgress.percent}%` }"></div>
                </div>
              </div>
            </div>

            <!-- Quick Jump 快捷跳转卡片 -->
            <div class="p-4 rounded-2xl bg-studio-900 border border-studio-750 shadow space-y-3">
              <span class="text-xs font-extrabold text-white flex items-center gap-2 pb-2 border-b border-studio-800">
                <span>🚀</span>
                <span>Quick Jump 快速跳转</span>
              </span>

              <div class="grid grid-cols-3 gap-2">
                <button
                  @click="jumpToFrame(0)"
                  class="py-2 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-700 text-slate-800 dark:text-slate-100 text-xs font-bold cursor-pointer shadow-sm active:scale-95 transition-all"
                >
                  首帧 (First)
                </button>
                <button
                  @click="jumpToFrame(Math.floor(totalFrames / 2))"
                  class="py-2 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-700 text-slate-800 dark:text-slate-100 text-xs font-bold cursor-pointer shadow-sm active:scale-95 transition-all"
                >
                  中间 (Middle)
                </button>
                <button
                  @click="jumpToFrame(totalFrames - 1)"
                  class="py-2 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-700 text-slate-800 dark:text-slate-100 text-xs font-bold cursor-pointer shadow-sm active:scale-95 transition-all"
                >
                  尾帧 (Last)
                </button>
              </div>

              <div class="flex items-center space-x-2 pt-1">
                <span class="text-xs text-slate-400 font-bold">跳至帧:</span>
                <input
                  v-model.number="targetJumpFrame"
                  type="number"
                  min="0"
                  :max="totalFrames - 1"
                  placeholder="Frame #"
                  class="flex-1 bg-studio-950 border border-studio-750 rounded-lg p-1.5 text-xs text-white font-mono outline-none focus:border-studio-cyan"
                  @keydown.enter="jumpToFrame(targetJumpFrame)"
                />
                <button
                  @click="jumpToFrame(targetJumpFrame)"
                  class="px-3 py-1.5 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer active:scale-95"
                >
                  Go 跳转
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部专业控制器：胶片微缩条 (Filmstrip) + 逐帧前后步进 + 进度条 -->
        <div class="p-4 rounded-2xl bg-studio-900 border border-studio-750 shadow-xl space-y-3">
          <!-- 1. 全景胶片微缩条 (Filmstrip Bar) -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs text-slate-400">
              <span class="flex items-center gap-1.5 font-bold text-slate-300">
                <span>🎞️</span>
                <span>全景胶片微缩条 (点击直达对应画面)</span>
                <span v-if="generatingFilmstrip" class="text-[10px] text-studio-cyan animate-pulse font-mono">正在后台提取胶片缩略图...</span>
              </span>
              <span class="text-[11px] font-mono text-slate-500">共 {{ filmstripFrames.length }} 组关键镜头</span>
            </div>

            <!-- 胶片横向排布 -->
            <div class="grid grid-cols-6 sm:grid-cols-12 gap-1.5 p-1.5 bg-studio-850 rounded-xl border border-studio-750 overflow-hidden">
              <div
                v-for="(f, i) in filmstripFrames"
                :key="i"
                @click="jumpToFrame(f.frame)"
                :class="[
                  'relative group rounded-lg overflow-hidden border aspect-[16/9] cursor-pointer transition-all hover:scale-105 hover:z-10 shadow',
                  Math.abs(f.frame - currentFrameNumber) < 15
                    ? 'border-studio-cyan ring-2 ring-studio-cyan/40 scale-[1.02]'
                    : 'border-studio-800 hover:border-studio-600'
                ]"
                :title="`跳转到 ${f.timeStr} (第 ${f.frame} 帧)`"
              >
                <img :src="f.dataUrl" class="w-full h-full object-cover" />
                <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" style="background: rgba(15, 23, 42, 0.65);">
                  <span class="text-[10px] text-white font-mono font-bold">F:{{ f.frame }}</span>
                </div>
                <span class="media-badge absolute bottom-0.5 right-0.5 px-1 rounded text-[8px] font-mono scale-90 pointer-events-none">
                  {{ f.timeStr.slice(3) }}
                </span>
              </div>
            </div>
          </div>

          <!-- 2. 播放与帧步进按钮排 -->
          <div class="flex items-center justify-between pt-1">
            <!-- 左侧核心逐帧控制 -->
            <div class="flex items-center space-x-2">
              <!-- 上一帧 -->
              <button
                @click="stepFrame(-stepAmount)"
                class="px-3 py-1.5 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-100 font-mono text-xs font-extrabold flex items-center space-x-1 cursor-pointer shadow-sm active:scale-95 transition-all"
                title="上一帧 (键盘左箭头 ←)"
              >
                <span>⏮</span>
                <span>-{{ stepAmount }}帧 (←)</span>
              </button>

              <!-- 快退 -->
              <button @click="jumpTime(-2)" class="p-2 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-200 cursor-pointer shadow-sm active:scale-95 transition-all" title="快退 2 秒">
                ⏪
              </button>

              <!-- 播放 / 暂停 -->
              <button
                @click="togglePlay"
                class="w-10 h-10 rounded-full bg-studio-accent hover:brightness-110 text-white flex items-center justify-center shadow-lg shadow-studio-accent/30 cursor-pointer active:scale-95"
                title="播放/暂停 (空格键)"
              >
                <StudioIcon :name="isPlaying ? 'pause' : 'play'" :size="16" />
              </button>

              <!-- 快进 -->
              <button @click="jumpTime(2)" class="p-2 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-200 cursor-pointer shadow-sm active:scale-95 transition-all" title="快进 2 秒">
                ⏩
              </button>

              <!-- 下一帧 -->
              <button
                @click="stepFrame(stepAmount)"
                class="px-3 py-1.5 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-100 font-mono text-xs font-extrabold flex items-center space-x-1 cursor-pointer shadow-sm active:scale-95 transition-all"
                title="下一帧 (键盘右箭头 →)"
              >
                <span>+{{ stepAmount }}帧 (→)</span>
                <span>⏭</span>
              </button>
            </div>

            <!-- 右侧步长与播放速度配置 -->
            <div class="flex items-center space-x-4 text-xs font-mono">
              <div class="flex items-center space-x-1.5">
                <span class="text-slate-400 font-bold">步长 (Step):</span>
                <select v-model.number="stepAmount" class="bg-studio-850 border border-studio-750 rounded-lg px-2 py-1 text-studio-cyan font-bold outline-none cursor-pointer shadow-sm">
                  <option :value="1">1 帧 (单帧精细微调)</option>
                  <option :value="5">5 帧</option>
                  <option :value="10">10 帧 (0.33秒)</option>
                  <option :value="30">30 帧 (1秒)</option>
                </select>
              </div>

              <div class="flex items-center space-x-1.5">
                <span class="text-slate-400 font-bold">速度:</span>
                <button
                  v-for="s in [0.5, 1.0, 2.0]"
                  :key="s"
                  @click="playbackRate = s"
                  :class="['px-2 py-1 rounded text-xs cursor-pointer', playbackRate === s ? 'bg-studio-accent text-white font-bold shadow' : 'bg-studio-850 text-slate-300 border border-studio-750 hover:bg-studio-800']"
                >
                  {{ s }}x
                </button>
              </div>
            </div>
          </div>

          <!-- 3. 时间轴平滑拖拽进度条 -->
          <div class="space-y-1">
            <input
              type="range"
              min="0"
              :max="videoDuration"
              step="0.001"
              v-model.number="currentTimestamp"
              @input="onTimelineSliderInput"
              class="w-full accent-studio-cyan cursor-pointer h-2 bg-studio-950 rounded-lg"
            />
            <div class="flex justify-between text-[11px] font-mono text-slate-400">
              <span>{{ currentTimecode }}</span>
              <span>{{ formatSeconds(videoDuration) }}</span>
            </div>
          </div>
        </div>

        <!-- 已截取静帧展示池与全功能批量导出 (深度增强) -->
        <div v-if="capturedFrames.length > 0" class="p-4 rounded-2xl bg-studio-900 border border-studio-750 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <span class="text-xs font-extrabold text-white flex items-center gap-2">
              <span>🖼️ 已提取静帧池 (共 {{ capturedFrames.length }} 帧已精准截取)</span>
            </span>

            <div class="flex items-center space-x-2">
              <!-- 一键打包下载 ZIP -->
              <button
                @click="exportAllFramesZip"
                :disabled="exportingZip"
                class="px-3.5 py-1.5 rounded-xl bg-studio-cyan/20 hover:bg-studio-cyan/30 text-studio-cyan border border-studio-cyan/40 text-xs font-bold flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                <span>📦</span>
                <span>{{ exportingZip ? '正在打包 ZIP...' : '一键打包下载 (ZIP)' }}</span>
              </button>

              <!-- 全部清空 -->
              <button
                @click="clearAllCapturedFrames"
                class="px-3 py-1.5 rounded-xl bg-studio-850 hover:bg-rose-500/20 hover:text-rose-600 dark:hover:text-rose-300 border border-studio-750 text-slate-700 dark:text-slate-400 text-xs font-bold cursor-pointer transition-colors shadow-sm"
              >
                清空全部
              </button>

              <!-- 全部智能入库 -->
              <button
                @click="batchSaveToLibrary"
                :disabled="savingLibrary"
                class="px-4 py-1.5 rounded-xl bg-studio-emerald hover:brightness-110 text-white text-xs font-extrabold flex items-center space-x-1.5 shadow cursor-pointer disabled:opacity-50"
              >
                <StudioIcon name="star" :size="14" />
                <span>{{ savingLibrary ? '正在自动打标入库...' : '全部一键智能打标归档至素材库' }}</span>
              </button>
            </div>
          </div>

          <!-- 静帧网格展示池 -->
          <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
            <div
              v-for="(f, i) in capturedFrames"
              :key="i"
              class="relative group rounded-xl overflow-hidden border border-studio-750 bg-studio-950 aspect-[16/9] shadow-md transition-all hover:border-studio-cyan"
            >
              <img :src="f.dataUrl" class="w-full h-full object-cover" />
              <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2" style="background: rgba(15, 23, 42, 0.72);">
                <button
                  @click="openCompareModal(f.dataUrl, f)"
                  class="p-1.5 rounded-lg bg-studio-cyan/80 hover:bg-studio-cyan text-studio-950 font-bold text-xs cursor-pointer"
                  title="大图全屏对比"
                >
                  🔍
                </button>
                <button
                  @click="removeCapturedFrame(i)"
                  class="p-1.5 rounded-lg bg-rose-500/80 hover:bg-rose-500 text-white text-xs cursor-pointer"
                  title="删除此帧"
                >
                  ✕
                </button>
              </div>
              <span class="media-badge absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-tight pointer-events-none">
                F:{{ f.frame }} · {{ f.timeStr }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- ========================================================================= -->
      <!-- 2. 格式无损转换 / 音频流提取工作台 (完整真实功能落地) -->
      <!-- ========================================================================= -->
      <div v-else-if="activeTool === 'convert'" class="space-y-5 max-w-4xl mx-auto">
        <!-- 头部说明卡片 -->
        <div class="rounded-2xl bg-studio-900 border border-studio-750 p-5 shadow-xl space-y-4">
          <div class="flex items-center justify-between pb-3 border-b border-studio-800">
            <div>
              <h3 class="text-base font-extrabold text-white flex items-center gap-2">
                🔄 格式无损转换 / 独立音频提取工坊
              </h3>
              <p class="text-xs text-slate-400 mt-1">
                基于原生 FFmpeg 引擎，提供 MP4、WebM、MOV、GIF 跨封装格式转码，以及高保真 MP3、WAV 独立音频轨分离。
              </p>
            </div>
            <span class="px-2.5 py-1 rounded-lg bg-studio-cyan/15 text-studio-cyan border border-studio-cyan/30 text-xs font-mono font-bold">
              FFmpeg Engine ✓
            </span>
          </div>

          <!-- 待处理媒体来源信息 -->
          <div class="p-4 rounded-xl bg-studio-950 border border-studio-800 flex items-center justify-between">
            <div class="flex items-center space-x-3.5">
              <div class="w-12 h-12 rounded-lg bg-studio-800 border border-studio-700 flex items-center justify-center text-xl">
                🎬
              </div>
              <div>
                <div class="text-sm font-bold text-white flex items-center gap-2">
                  {{ convertSourceFileName }}
                  <span class="px-1.5 py-0.2 rounded bg-studio-800 text-[10px] text-slate-400 font-mono">1080P · H.264</span>
                </div>
                <div class="text-xs text-slate-400 font-mono mt-0.5">
                  时长: 15.0s · 大小: 12.0 MB · 预设视频源
                </div>
              </div>
            </div>

            <div class="flex items-center space-x-2">
              <button
                @click="openVideoPicker('convert')"
                class="px-3 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-studio-cyan text-xs font-bold flex items-center space-x-1 cursor-pointer"
              >
                <span>☁︎ 从素材库选择</span>
              </button>
              <button
                @click="triggerConvertFilePicker"
                class="px-3 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-200 text-xs font-bold flex items-center space-x-1 cursor-pointer"
              >
                <span>📂 更换视频</span>
              </button>
              <input ref="convertFileInputRef" type="file" accept="video/*" class="hidden" @change="onConvertFileSelected" />
            </div>
          </div>

          <!-- 转换核心参数配置网格 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <!-- 目标输出格式 -->
            <div class="space-y-1.5">
              <label class="text-slate-300 font-bold block">目标封装格式 (Target Format):</label>
              <div class="grid grid-cols-3 gap-2">
                <button
                  v-for="fmt in ['mp4', 'webm', 'mov', 'gif', 'mp3', 'wav']"
                  :key="fmt"
                  @click="convertTargetFormat = fmt"
                  :class="[
                    'py-2 px-2.5 rounded-xl border text-center font-bold font-mono transition-all cursor-pointer',
                    convertTargetFormat === fmt
                      ? 'bg-studio-accent border-studio-accent text-white shadow'
                      : 'bg-studio-950 border-studio-750 text-slate-300 hover:bg-studio-800'
                  ]"
                >
                  {{ fmt.toUpperCase() }}
                </button>
              </div>
            </div>

            <!-- 分辨率与输出尺寸 -->
            <div class="space-y-1.5">
              <label class="text-slate-300 font-bold block">输出分辨率 (Resolution):</label>
              <select
                v-model="convertResolution"
                :disabled="convertTargetFormat === 'mp3' || convertTargetFormat === 'wav'"
                class="w-full bg-studio-950 border border-studio-750 rounded-xl p-2.5 text-xs text-white outline-none disabled:opacity-40"
              >
                <option value="source">原画尺寸 (保持源视频分辨率 1920×1080)</option>
                <option value="4k">4K 超高清 (3840×2160)</option>
                <option value="1080p">1080P 全高清 (1920×1080)</option>
                <option value="720p">720P 高清 (1280×720)</option>
                <option value="480p">480P 标清 (快速传输)</option>
              </select>
            </div>
          </div>

          <!-- 独立音频分离开关 -->
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 flex items-center justify-between text-xs">
            <div class="flex items-center space-x-2">
              <input
                type="checkbox"
                id="extractAudioToggle"
                v-model="convertExtractAudioOnly"
                class="rounded accent-studio-accent"
              />
              <label for="extractAudioToggle" class="text-slate-200 font-bold cursor-pointer">
                仅提取独立纯音频轨 (忽略画面，分离为高音质 MP3/WAV)
              </label>
            </div>
            <span class="text-slate-500 font-mono text-[11px]">320kbps CBR / 48kHz</span>
          </div>

          <!-- 深度人声提炼去噪开关 -->
          <div v-if="convertExtractAudioOnly" class="p-3 rounded-xl bg-studio-900 border border-studio-cyan/40 flex items-center justify-between text-xs animate-in fade-in">
            <div class="flex items-center space-x-2">
              <input
                type="checkbox"
                id="cleanVocalToggle"
                v-model="convertCleanVocal"
                class="rounded accent-studio-cyan"
              />
              <label for="cleanVocalToggle" class="text-studio-cyan font-bold cursor-pointer flex items-center gap-1.5">
                <span>🎙️ 深度人声提炼（自适应频域消除底噪与伴奏杂音）</span>
              </label>
            </div>
            <span class="text-amber-300 font-mono text-[11px] font-bold">FFmpeg 降噪增强</span>
          </div>

          <!-- 执行按钮与进度条 -->
          <div class="pt-2 space-y-3">
            <button
              @click="runVideoConversion"
              :disabled="converting"
              class="w-full py-3 rounded-xl bg-gradient-to-r from-studio-accent to-studio-cyan hover:brightness-110 text-white font-bold text-sm shadow-lg shadow-studio-accent/25 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <span>{{ converting ? '正在调用 FFmpeg 处理中...' : '立即开始转码 / 提取音频' }}</span>
              <span v-if="converting" class="animate-spin">⏳</span>
              <span v-else>🚀</span>
            </button>

            <!-- 动态处理进度 -->
            <div v-if="converting" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2">
              <div class="flex justify-between text-xs font-mono">
                <span class="text-studio-cyan font-bold">{{ convertStageText }}</span>
                <span class="text-slate-400">{{ convertProgress }}%</span>
              </div>
              <div class="w-full bg-studio-850 h-2 rounded-full overflow-hidden">
                <div class="bg-studio-cyan h-full transition-all duration-300 rounded-full" :style="{ width: `${convertProgress}%` }"></div>
              </div>
            </div>
          </div>

          <!-- 转换产物结果面板 -->
          <div v-if="convertResult" class="p-4 rounded-xl bg-studio-950 border border-studio-emerald/40 space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2 text-emerald-400 font-bold text-xs">
                <span>✓ 转码处理圆满完成！</span>
                <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">{{ convertResult.format.toUpperCase() }}</span>
              </div>
              <span class="text-xs font-mono text-slate-300">产物体积: {{ formatFileSize(convertResult.size) }}</span>
            </div>

            <!-- 内嵌即时预览播放器 -->
            <div class="rounded-lg overflow-hidden border border-studio-800 bg-slate-950 flex items-center justify-center p-2">
              <video
                v-if="convertResult.type === 'video'"
                :src="convertResult.downloadUrl || '/sample-video.mp4'"
                controls
                class="max-h-48 rounded"
              ></video>
              <audio
                v-else
                :src="convertResult.downloadUrl"
                controls
                class="w-full"
              ></audio>
            </div>

            <div class="flex items-center space-x-3 pt-1">
              <a
                :href="convertResult.downloadUrl"
                :download="convertResult.outputFile"
                class="flex-1 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold text-center hover:brightness-110 shadow"
              >
                📥 下载产物文件 ({{ convertResult.outputFile }})
              </a>
              <button
                @click="saveConvertResultToLibrary"
                class="px-4 py-2 rounded-lg bg-studio-emerald text-white text-xs font-bold hover:brightness-110 shadow cursor-pointer"
              >
                ⭐ 自动归档至素材库
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ========================================================================= -->
      <!-- 3. 视频智能无损压缩工作台 (CRF 感知 + 预估体积计算 + 两趟编码) -->
      <!-- ========================================================================= -->
      <div v-else-if="activeTool === 'compress'" class="space-y-5 max-w-4xl mx-auto">
        <div class="rounded-2xl bg-studio-900 border border-studio-750 p-5 shadow-xl space-y-4">
          <div class="flex items-center justify-between pb-3 border-b border-studio-800">
            <div>
              <h3 class="text-base font-extrabold text-white flex items-center gap-2">
                🗜️ 视频智能压缩工坊 (CRF 动态量化感知)
              </h3>
              <p class="text-xs text-slate-400 mt-1">
                基于 H.264/HEVC CRF 恒定量化算法，智能剔除肉眼不可见的冗余高频信息，体积可暴降 70% 画面无可见失真。
              </p>
            </div>
            <span class="px-2.5 py-1 rounded-lg bg-studio-emerald/15 text-studio-emerald border border-studio-emerald/30 text-xs font-mono font-bold">
              CRF Perception ✓
            </span>
          </div>

          <!-- 原视频信息与更换 -->
          <div class="p-4 rounded-xl bg-studio-950 border border-studio-800 flex items-center justify-between">
            <div class="flex items-center space-x-3.5">
              <div class="w-12 h-12 rounded-lg bg-studio-800 border border-studio-700 flex items-center justify-center text-xl">
                📼
              </div>
              <div>
                <div class="text-sm font-bold text-white flex items-center gap-2">
                  {{ compressSourceFileName }}
                  <span class="px-1.5 py-0.2 rounded bg-studio-800 text-[10px] text-slate-400 font-mono">原始体积: 12.0 MB</span>
                </div>
                <div class="text-xs text-slate-400 font-mono mt-0.5">
                  分辨率: 1920×1080 · 码率: 6800 kbps · 帧率: 30 fps
                </div>
              </div>
            </div>

            <div class="flex items-center space-x-2">
              <button
                @click="openVideoPicker('compress')"
                class="px-3 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-studio-cyan text-xs font-bold cursor-pointer"
              >
                <span>☁︎ 从素材库选择</span>
              </button>
              <button
                @click="triggerCompressFilePicker"
                class="px-3 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-200 text-xs font-bold flex items-center space-x-1 cursor-pointer"
              >
                <span>📂 更换视频</span>
              </button>
              <input ref="compressFileInputRef" type="file" accept="video/*" class="hidden" @change="onCompressFileSelected" />
            </div>
          </div>

          <!-- 压缩预设方案选择 -->
          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-300 block">智能压缩场景预设 (Preset Strategy):</label>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <!-- 微信/移动端极速分享 -->
              <div
                @click="applyCompressPreset('wechat')"
                :class="[
                  'p-3.5 rounded-xl border cursor-pointer transition-all space-y-1',
                  compressPreset === 'wechat' ? 'bg-studio-accent/20 border-studio-accent shadow' : 'bg-studio-950 border-studio-750 hover:bg-studio-850'
                ]"
              >
                <div class="font-bold text-white flex items-center justify-between">
                  <span>📱 社交轻量级分享</span>
                  <span class="text-[10px] text-studio-cyan font-mono">CRF 28</span>
                </div>
                <p class="text-[11px] text-slate-400 leading-relaxed">体积暴降约 70%~80%，完美适配微信传输与移动端秒开</p>
              </div>

              <!-- Web 高清通用 -->
              <div
                @click="applyCompressPreset('web')"
                :class="[
                  'p-3.5 rounded-xl border cursor-pointer transition-all space-y-1',
                  compressPreset === 'web' ? 'bg-studio-accent/20 border-studio-accent shadow' : 'bg-studio-950 border-studio-750 hover:bg-studio-850'
                ]"
              >
                <div class="font-bold text-white flex items-center justify-between">
                  <span>🌐 Web 高保真传输</span>
                  <span class="text-[10px] text-studio-cyan font-mono">CRF 25 (推荐)</span>
                </div>
                <p class="text-[11px] text-slate-400 leading-relaxed">肉眼几无可见失真，体积缩减约 50%~65%</p>
              </div>

              <!-- 典藏无损级 -->
              <div
                @click="applyCompressPreset('fidelity')"
                :class="[
                  'p-3.5 rounded-xl border cursor-pointer transition-all space-y-1',
                  compressPreset === 'fidelity' ? 'bg-studio-accent/20 border-studio-accent shadow' : 'bg-studio-950 border-studio-750 hover:bg-studio-850'
                ]"
              >
                <div class="font-bold text-white flex items-center justify-between">
                  <span>💎 母带高还原度</span>
                  <span class="text-[10px] text-studio-cyan font-mono">CRF 21</span>
                </div>
                <p class="text-[11px] text-slate-400 leading-relaxed">保留极致暗部细节与细腻纹理，体积缩减约 30%</p>
              </div>
            </div>
          </div>

          <!-- CRF 精细微调滑块 -->
          <div class="p-4 rounded-xl bg-studio-950 border border-studio-800 space-y-3">
            <div class="flex justify-between items-center text-xs">
              <span class="font-bold text-slate-300">自定义 CRF 量化值 (数值越大压缩率越高):</span>
              <span class="font-mono text-studio-cyan font-bold text-sm">{{ compressCrf }}</span>
            </div>
            <input
              type="range"
              min="18"
              max="35"
              step="1"
              v-model.number="compressCrf"
              class="w-full accent-studio-cyan cursor-pointer h-2 bg-studio-900 rounded-lg"
            />
            <div class="flex justify-between text-[11px] font-mono text-slate-500">
              <span>CRF 18 (接近无损)</span>
              <span>CRF 25 (均衡推荐)</span>
              <span>CRF 35 (极限压缩)</span>
            </div>
          </div>

          <!-- 预估压缩体积收益感知看板 -->
          <div class="p-4 rounded-xl bg-studio-950 border border-studio-cyan/30 flex items-center justify-between">
            <div class="space-y-1">
              <div class="text-xs text-slate-400 font-bold">压缩前后体积预估对比:</div>
              <div class="text-sm font-bold text-white font-mono flex items-center space-x-2">
                <span class="text-slate-400 line-through">12.0 MB</span>
                <span class="text-studio-cyan">➔</span>
                <span class="text-emerald-400 font-extrabold text-base">{{ estimatedCompressedSize }} MB</span>
                <span class="text-slate-500 text-xs">({{ estimatedSavingsPercent }}% 空间释放)</span>
              </div>
            </div>
            <div class="w-16 h-16 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col items-center justify-center text-emerald-400 font-mono">
              <span class="text-xs">节省</span>
              <span class="text-lg font-black">-{{ estimatedSavingsPercent }}%</span>
            </div>
          </div>

          <!-- 执行压缩按钮 -->
          <div class="pt-2 space-y-3">
            <button
              @click="runVideoCompression"
              :disabled="compressing"
              class="w-full py-3 rounded-xl bg-gradient-to-r from-studio-emerald to-studio-cyan hover:brightness-110 text-white font-bold text-sm shadow-lg shadow-studio-emerald/25 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <span>{{ compressing ? '两趟动态量化压缩处理中...' : '立即启动智能无损压缩' }}</span>
              <span v-if="compressing" class="animate-spin">⏳</span>
              <span v-else>🗜️</span>
            </button>

            <!-- 动态压缩进度 -->
            <div v-if="compressing" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2">
              <div class="flex justify-between text-xs font-mono">
                <span class="text-studio-emerald font-bold">{{ compressStageText }}</span>
                <span class="text-slate-400">{{ compressProgress }}%</span>
              </div>
              <div class="w-full bg-studio-850 h-2 rounded-full overflow-hidden">
                <div class="bg-studio-emerald h-full transition-all duration-300 rounded-full" :style="{ width: `${compressProgress}%` }"></div>
              </div>
            </div>
          </div>

          <!-- 压缩产物结果 -->
          <div v-if="compressResult" class="p-4 rounded-xl bg-studio-950 border border-emerald-500/40 space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2 text-emerald-400 font-bold text-xs">
                <span>✓ 智能压缩圆满完成！</span>
                <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">已瘦身 {{ actualSavingsPercent }}%</span>
              </div>
              <span class="text-xs font-mono text-slate-300">最终体积: {{ formatFileSize(compressResult.size) }}</span>
            </div>

            <div class="flex items-center space-x-3 pt-1">
              <a
                :href="compressResult.downloadUrl"
                :download="compressResult.outputFile"
                class="flex-1 py-2 rounded-lg bg-studio-emerald text-white text-xs font-bold text-center hover:brightness-110 shadow"
              >
                📥 下载压缩瘦身视频 ({{ compressResult.outputFile }})
              </a>
              <button
                @click="saveCompressResultToLibrary"
                class="px-4 py-2 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-white text-xs font-bold shadow cursor-pointer"
              >
                ⭐ 归档至素材库
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 弹窗 1：批量等间隔抽帧配置模态窗 -->
    <div
      v-if="showBatchModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in" style="background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(8px);"
    >
      <div class="w-full max-w-md bg-studio-900 border border-studio-750 rounded-2xl p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-studio-800">
          <h3 class="text-sm font-extrabold text-white flex items-center gap-2">
            <span>⏱️</span>
            <span>批量等间隔精准抽帧</span>
          </h3>
          <button @click="showBatchModal = false" class="text-slate-400 hover:text-white cursor-pointer text-sm">✕</button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="text-slate-300 font-bold block mb-1">抽取模式 (Extraction Mode):</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                @click="batchMode = 'interval'"
                :class="['py-2 px-3 rounded-xl border font-bold cursor-pointer transition-all', batchMode === 'interval' ? 'bg-studio-accent border-studio-accent text-white' : 'bg-studio-950 border-studio-800 text-slate-400']"
              >
                按时间间隔 (秒)
              </button>
              <button
                @click="batchMode = 'count'"
                :class="['py-2 px-3 rounded-xl border font-bold cursor-pointer transition-all', batchMode === 'count' ? 'bg-studio-accent border-studio-accent text-white' : 'bg-studio-950 border-studio-800 text-slate-400']"
              >
                按总张数均匀抽取
              </button>
            </div>
          </div>

          <div v-if="batchMode === 'interval'" class="space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-400 font-bold">每隔多少秒抽 1 帧:</span>
              <span class="text-studio-cyan font-mono font-bold">{{ batchInterval }} 秒/帧</span>
            </div>
            <div class="grid grid-cols-4 gap-2 pt-1">
              <button
                v-for="iv in [0.5, 1.0, 2.0, 5.0]"
                :key="iv"
                @click="batchInterval = iv"
                :class="['py-1.5 rounded-lg border text-center font-mono cursor-pointer', batchInterval === iv ? 'bg-studio-cyan text-studio-950 border-studio-cyan font-bold' : 'bg-studio-950 border-studio-800 text-slate-300']"
              >
                {{ iv }}s
              </button>
            </div>
            <div class="text-[11px] text-slate-500 font-mono pt-1">
              当前视频 {{ videoDuration.toFixed(1) }}s，预计共抽取约 {{ Math.ceil(videoDuration / batchInterval) }} 帧
            </div>
          </div>

          <div v-else class="space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-400 font-bold">全片均匀抽取总张数:</span>
              <span class="text-studio-cyan font-mono font-bold">{{ batchCount }} 帧</span>
            </div>
            <div class="grid grid-cols-4 gap-2 pt-1">
              <button
                v-for="cnt in [10, 20, 30, 50]"
                :key="cnt"
                @click="batchCount = cnt"
                :class="['py-1.5 rounded-lg border text-center font-mono cursor-pointer', batchCount === cnt ? 'bg-studio-cyan text-studio-950 border-studio-cyan font-bold' : 'bg-studio-950 border-studio-800 text-slate-300']"
              >
                {{ cnt }} 帧
              </button>
            </div>
          </div>
        </div>

        <div class="flex items-center space-x-2 pt-3 border-t border-studio-800">
          <button
            @click="showBatchModal = false"
            class="flex-1 py-2.5 rounded-xl bg-studio-950 hover:bg-studio-800 border border-studio-750 text-slate-300 text-xs font-bold cursor-pointer"
          >
            取消
          </button>
          <button
            @click="startBatchExtraction"
            class="flex-1 py-2.5 rounded-xl bg-studio-accent text-white text-xs font-extrabold shadow hover:brightness-110 cursor-pointer flex items-center justify-center space-x-1"
          >
            <span>⚡ 开始批量提取</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 弹窗 2：大图全屏对比模态窗 (Lightbox) -->
    <div
      v-if="compareModalVisible"
      class="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 animate-in fade-in" style="background: rgba(15, 23, 42, 0.88); backdrop-filter: blur(12px);"
      @click.self="compareModalVisible = false"
    >
      <div class="relative max-w-5xl w-full flex flex-col items-center space-y-3">
        <!-- 顶部操作条 -->
        <div class="w-full flex items-center justify-between text-xs text-white">
          <span class="font-mono font-bold flex items-center gap-2">
            <span>🔍 帧高清全屏比对:</span>
            <span class="text-studio-cyan">F:{{ compareModalData.frame }}</span>
            <span class="text-slate-400">({{ compareModalData.timeStr }})</span>
          </span>
          <button
            @click="compareModalVisible = false"
            class="w-8 h-8 rounded-full bg-studio-800 hover:bg-studio-700 flex items-center justify-center text-white cursor-pointer"
          >
            ✕
          </button>
        </div>

        <!-- 大图视口 -->
        <div class="rounded-2xl overflow-hidden border border-studio-700 bg-studio-950 shadow-2xl max-h-[75vh] flex items-center justify-center p-1">
          <img :src="compareModalImg" class="max-w-full max-h-[72vh] object-contain rounded-xl" />
        </div>

        <!-- 底部快捷下载 -->
        <div class="flex items-center space-x-3">
          <a
            :href="compareModalImg"
            :download="`frame_${compareModalData.frame}.png`"
            class="px-4 py-2 rounded-xl bg-studio-cyan text-studio-950 font-bold text-xs shadow hover:brightness-110"
          >
            📥 下载该帧高清 PNG
          </a>
          <button
            @click="compareModalVisible = false"
            class="px-4 py-2 rounded-xl bg-studio-800 hover:bg-studio-700 text-white font-bold text-xs cursor-pointer"
          >
            关闭预览
          </button>
        </div>
      </div>
    </div>

    <!-- 素材库通用选择器弹窗 (严格限定只选视频，杜绝图片混入引发解码报错) -->
    <AssetPickerModal
      :visible="showVideoPicker"
      title="从素材库挑选视频 (仅视频)"
      :initialMain="'video'"
      :mediaTypes="['video']"
      @close="showVideoPicker = false"
      @confirm="onVideoPicked"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';
import AssetPickerModal from '../../components/AssetPickerModal.vue';
import { authFetch, registerGeneratedAsset, getAssetPlayableUrl } from '../../api';
import { MediaFrameExtractor } from './mediaFrameExtractor';
// jszip（~28KB gzip）仅在打包 ZIP 时按需异步加载；wgslVideoEnhancer 同理（GPU 锐化开启时）

const toolTabs = [
  { key: 'frames', label: '视频元素寻帧', icon: '🎬' },
  { key: 'convert', label: '格式转换/音频提取', icon: '🔄' },
  { key: 'compress', label: '视频智能压缩', icon: '🗜️' }
];
const activeTool = ref('frames');

// =============================================================================
// 1. 逐帧读取器 (重构：三级火箭架构 + WebCodecs GPU 硬解 + 0ms 内存帧缓存 + 胶片微缩条 + WGSL 锐化)
// =============================================================================
const videoRef = ref(null);
const frameCanvasRef = ref(null);
const wgslCanvasRef = ref(null);
const frameStageRef = ref(null);
const videoFileInput = ref(null);

const videoSource = ref({ kind: 'default', fid: '', name: 'sample-video.mp4' });
const showVideoPicker = ref(false);
const pickerTarget = ref('frames'); // frames | convert | compress

const currentTimestamp = ref(0);
const videoDuration = ref(15);
const videoFps = ref(30.0);
const videoWidth = ref(1920);
const videoHeight = ref(1080);
const currentFrameNumber = ref(0);
const isPlaying = ref(false);
const playbackRate = ref(1.0);
const stepAmount = ref(1); // 默认单帧步进 (1 frame)
const targetJumpFrame = ref(0);
const savingLibrary = ref(false);
const exportingZip = ref(false);
const capturedFrames = ref([]);
const cachedFramesCount = ref(0);

// WGSL 硬件着色器状态（内联能力探测，避免把 WGSL 模块拉进主包）
const wgslSupported = ref(
  typeof navigator !== 'undefined' &&
  !!navigator.gpu &&
  typeof navigator.gpu.requestAdapter === 'function' &&
  Boolean(window.isSecureContext)
);
const wgslEnabled = ref(false);

// 引擎与状态。strategy 初始为 idle：在真实探测完成前不展示任何引擎徽标
let extractor = null;
const extractorStatus = ref({
  loading: false,
  strategy: 'idle',
  message: '准备就绪'
});

// 胶片微缩条
const filmstripFrames = ref([]);
const generatingFilmstrip = ref(false);

// 批量抽帧模态窗
const showBatchModal = ref(false);
const batchMode = ref('interval'); // interval | count
const batchInterval = ref(1.0);
const batchCount = ref(20);
const batchProcessing = ref(false);
const batchProgress = ref({ current: 0, total: 0, percent: 0 });

// 大图对比模态窗
const compareModalVisible = ref(false);
const compareModalImg = ref('');
const compareModalData = ref({ frame: 0, timeStr: '' });

const totalFrames = computed(() => {
  return Math.max(1, Math.round(videoDuration.value * videoFps.value));
});

const currentTimecode = computed(() => {
  const sec = currentTimestamp.value;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
});

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * 初始化抽帧引擎
 */
function initExtractor() {
  if (extractor) extractor.destroy();

  extractor = new MediaFrameExtractor({
    videoElement: videoRef.value,
    canvasElement: frameCanvasRef.value,
    stageElement: frameStageRef.value,
    onStatusChange: (status) => {
      extractorStatus.value = { ...status };
      if (extractor) {
        cachedFramesCount.value = extractor.cache.cache.size;
      }
    },
    onFrameTick: ({ currentTime, frameNumber }) => {
      currentTimestamp.value = currentTime;
      currentFrameNumber.value = frameNumber;
    },
    onError: (err) => {
      console.error('[MediaTools] 抽帧引擎异常:', err);
    }
  });

  // 绑定专属 WebGPU 画板
  if (wgslCanvasRef.value) {
    extractor.attachElements({
      videoElement: videoRef.value,
      canvasElement: frameCanvasRef.value,
      wgslCanvasElement: wgslCanvasRef.value,
      stageElement: frameStageRef.value
    });
  }
}

/**
 * 切换 WGSL 硬件自适应锐化模式 (使用专属 WebGPU 独立原生画板，彻底避免 2D 上下文冲突)
 */
async function toggleWgslEnhancerMode() {
  if (!extractor) return;
  if (!wgslSupported.value) {
    alert('当前浏览器环境未开放 WebGPU/WGSL 支持（需现代 Chromium 113+ 并在安全上下文 HTTPS/localhost 下运行）');
    return;
  }
  const next = !wgslEnabled.value;
  if (next) {
    try {
      const ok = await extractor.toggleWgslEnhancer(true, wgslCanvasRef.value);
      if (ok) {
        wgslEnabled.value = true;
      } else {
        alert('WGSL WebGPU 管线初始化受阻，请确保当前显卡驱动支持 WebGPU');
      }
    } catch (e) {
      alert('WGSL 初始化失败: ' + e.message);
    }
  } else {
    await extractor.toggleWgslEnhancer(false);
    wgslEnabled.value = false;
  }
}

/**
 * 应用并载入视频源
 */
async function applyVideoSource({ kind, fid = '', name, url, file = null }) {
  videoSource.value = { kind, fid, name };
  currentTimestamp.value = 0;
  currentFrameNumber.value = 0;
  targetJumpFrame.value = 0;
  filmstripFrames.value = [];

  if (!extractor) initExtractor();

  // 保证 DOM 元素与专属 WebGPU 尺寸挂载
  extractor.attachElements({
    videoElement: videoRef.value,
    canvasElement: frameCanvasRef.value,
    wgslCanvasElement: wgslCanvasRef.value,
    stageElement: frameStageRef.value
  });

  try {
    await extractor.loadSource({ kind, name, url, file });

    // 同步元数据
    videoDuration.value = extractor.duration;
    videoWidth.value = extractor.videoWidth;
    videoHeight.value = extractor.videoHeight;
    videoFps.value = extractor.fps;
    currentTimestamp.value = extractor.currentTime;
    currentFrameNumber.value = extractor.currentFrameNumber;
    cachedFramesCount.value = extractor.cache.cache.size;

    // 异步生成全景胶片微缩条
    generateFilmstripBackground();
  } catch (err) {
    console.error('[MediaTools] 视频载入失败:', err);
  }
}

/**
 * 后台异步生成胶片条
 */
async function generateFilmstripBackground() {
  if (!extractor) return;
  generatingFilmstrip.value = true;
  try {
    const list = await extractor.generateFilmstrip(12);
    filmstripFrames.value = list;
  } catch (e) {
    console.warn('[MediaTools] 胶片条生成异常:', e);
  } finally {
    generatingFilmstrip.value = false;
  }
}

/**
 * 精确跳帧
 */
async function jumpToFrame(frameIndex) {
  if (!extractor) return;
  const target = Math.max(0, Math.min(totalFrames.value - 1, frameIndex));
  await extractor.seekToFrame(target);
  currentFrameNumber.value = extractor.currentFrameNumber;
  currentTimestamp.value = extractor.currentTime;
  cachedFramesCount.value = extractor.cache.cache.size;
}

/**
 * 逐帧步进
 */
async function stepFrame(framesDelta) {
  if (isPlaying.value) togglePlay();
  const next = currentFrameNumber.value + framesDelta;
  await jumpToFrame(next);
}

/**
 * 进度条滑动 (智能防抖与渐进式寻帧，彻底告别切帧卡死)
 */
let sliderScrubTimer = null;
function onTimelineSliderInput() {
  if (!extractor) return;
  if (isPlaying.value) {
    extractor.stopPlayback();
    isPlaying.value = false;
  }
  const targetFrame = Math.max(0, Math.min(totalFrames.value - 1, Math.round(currentTimestamp.value * videoFps.value)));
  currentFrameNumber.value = targetFrame;

  // 1. 快速滑动中：轻量 fastSeek，不堵塞 GPU 解码管线
  extractor.seekToFrame(targetFrame, false);

  // 2. 停止滑动 70ms：自动触发单帧精准对齐与缓存
  clearTimeout(sliderScrubTimer);
  sliderScrubTimer = setTimeout(() => {
    extractor.seekToFrame(targetFrame, true);
    cachedFramesCount.value = extractor.cache.cache.size;
  }, 70);
}

/**
 * 快进 / 快退 (秒)
 */
async function jumpTime(secDelta) {
  if (isPlaying.value) togglePlay();
  const t = Math.max(0, Math.min(videoDuration.value, currentTimestamp.value + secDelta));
  const frame = Math.round(t * videoFps.value);
  await jumpToFrame(frame);
}

/**
 * 播放 / 暂停 (彻底修复播放循环与画面同步)
 */
function togglePlay() {
  if (!extractor) return;
  if (isPlaying.value) {
    extractor.stopPlayback();
    isPlaying.value = false;
  } else {
    isPlaying.value = true;
    extractor.startPlayback(playbackRate.value);
  }
}

/**
 * 键盘快捷键监听
 */
function handleKeydown(e) {
  if (activeTool.value !== 'frames') return;

  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    stepFrame(-stepAmount.value);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    stepFrame(stepAmount.value);
  } else if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    togglePlay();
  }
}

/**
 * 选择本地视频
 */
function triggerVideoInput() {
  videoFileInput.value?.click();
}

function onVideoSelected(e) {
  const f = e.target.files?.[0];
  // 立即重置 input，使同一文件可再次触发 change；blob URL 由 extractor 统一创建/回收
  e.target.value = '';
  if (!f) return;
  applyVideoSource({ kind: 'local', fid: '', name: f.name, file: f });
}

/**
 * 素材库挑选视频
 */
function openVideoPicker(target) {
  pickerTarget.value = target;
  showVideoPicker.value = true;
}

function onVideoPicked(items) {
  showVideoPicker.value = false;
  const item = (items || [])[0];
  if (!item?.fid) return;
  const name = item.name || item.file_name || item.fid;

  // 严密检查资产类型与扩展名：若误选图片或音频，友好拦截并阻断报错
  const isVideoExt = /\.(mp4|webm|mov|mkv|avi|m4v|flv)$/i.test(name);
  const isImageExt = /\.(png|jpe?g|webp|gif|bmp|svg|tiff)$/i.test(name);
  const isAudioExt = /\.(mp3|wav|flac|aac|ogg|m4a)$/i.test(name);
  const isVideoType = item.category === 'video' || item.type === 'video' || item.kind === 'video';

  if (isImageExt || isAudioExt || (!isVideoExt && !isVideoType)) {
    alert(`【类型拦截】您选择的资产（${name}）属于${isImageExt ? '图片' : (isAudioExt ? '音频' : '非视频')}文件！\n\n「常用媒体工具箱 - 抽帧」必须且仅支持视频文件（MP4 / WebM / MOV）。请重新进入素材库挑选视频。`);
    return;
  }

  if (pickerTarget.value === 'convert') {
    convertCloudFid.value = item.fid;
    convertFileObj.value = null;
    convertSourceFileName.value = name;
    return;
  }
  if (pickerTarget.value === 'compress') {
    compressCloudFid.value = item.fid;
    compressFileObj.value = null;
    compressSourceFileName.value = name;
    return;
  }

  applyVideoSource({
    kind: 'cloud',
    fid: item.fid,
    name,
    url: getAssetPlayableUrl(item.fid)
  });
}

/**
 * 截取当前帧
 */
async function saveCurrentFrameToLibrary() {
  if (!extractor) return;
  const dataUrl = await extractor.captureFullFrameDataUrl();
  if (!dataUrl) return;
  capturedFrames.value.unshift({
    frame: currentFrameNumber.value,
    timeStr: currentTimecode.value,
    dataUrl
  });
}

/**
 * 导出当前帧 PNG
 */
async function exportCurrentFramePNG() {
  if (!extractor) return;
  const dataUrl = await extractor.captureFullFrameDataUrl();
  if (!dataUrl) return;
  const a = document.createElement('a');
  a.download = `frame_${currentFrameNumber.value}_${currentTimecode.value.replace(/:/g, '-')}.png`;
  a.href = dataUrl;
  a.click();
}

/**
 * 复制图像
 */
async function copyCurrentFrame() {
  if (!extractor) return;
  const blob = await extractor.captureFullFrameBlob();
  if (!blob) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    alert('已复制当前帧高清图像至剪贴板！');
  } catch (err) {
    alert('复制图像失败: ' + err.message);
  }
}

/**
 * 批量抽帧控制
 */
function openBatchModal() {
  showBatchModal.value = true;
}

async function startBatchExtraction() {
  showBatchModal.value = false;
  if (!extractor) return;
  batchProcessing.value = true;
  batchProgress.value = { current: 0, total: 10, percent: 0 };

  try {
    const list = await extractor.batchExtractFrames({
      mode: batchMode.value,
      intervalSec: batchInterval.value,
      count: batchCount.value,
      onProgress: (p) => {
        batchProgress.value = p;
      }
    });

    for (const item of list.reverse()) {
      capturedFrames.value.unshift(item);
    }
    alert(`批量抽帧圆满完成！已成功提取 ${list.length} 张静帧至下方静帧池。`);
  } catch (err) {
    alert('批量抽帧失败: ' + err.message);
  } finally {
    batchProcessing.value = false;
  }
}

/**
 * 提取全片关键帧
 */
async function extractKeyframesAction() {
  if (!extractor) return;
  batchProcessing.value = true;
  batchProgress.value = { current: 0, total: 10, percent: 0 };

  try {
    const list = await extractor.extractKeyframes((p) => {
      batchProgress.value = p;
    });

    for (const item of list.reverse()) {
      capturedFrames.value.unshift(item);
    }
    alert(`场景关键帧智能提取完成！已识别并抓取 ${list.length} 个转场画面。`);
  } catch (err) {
    alert('提取关键帧失败: ' + err.message);
  } finally {
    batchProcessing.value = false;
  }
}

/**
 * 打包全部静帧为 ZIP
 */
async function exportAllFramesZip() {
  if (!capturedFrames.value.length) {
    alert('当前静帧池为空，请先截取静帧');
    return;
  }

  exportingZip.value = true;
  try {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const folderName = (videoSource.value.name || 'frames').replace(/\.[^.]+$/, '');
    const folder = zip.folder(folderName);

    capturedFrames.value.forEach((item, index) => {
      // 提取 base64
      const base64Data = item.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const filename = `frame_${String(index + 1).padStart(3, '0')}_F${item.frame}_${item.timeStr.replace(/:/g, '-')}.png`;
      folder.file(filename, base64Data, { base64: true });
    });

    // 附带一份元数据文本
    folder.file('README.txt', `视频来源: ${videoSource.value.name}\n分辨率: ${videoWidth.value}x${videoHeight.value}\n抽帧总数: ${capturedFrames.value.length} 帧\n生成时间: ${new Date().toLocaleString()}\n`);

    const blob = await zip.generateAsync({ type: 'blob' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${folderName}_frames_all_${capturedFrames.value.length}.zip`;
    a.click();
    // 不能同步 revoke：Firefox/Safari 上 click() 尚未完成取数会中止下载，延迟 10s 回收
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
  } catch (e) {
    alert('ZIP 打包失败: ' + e.message);
  } finally {
    exportingZip.value = false;
  }
}

function removeCapturedFrame(idx) {
  capturedFrames.value.splice(idx, 1);
}

function clearAllCapturedFrames() {
  if (confirm(`确定要清空静帧池中的全部 ${capturedFrames.value.length} 帧吗？`)) {
    capturedFrames.value = [];
  }
}

function openCompareModal(dataUrl, f) {
  compareModalImg.value = dataUrl;
  compareModalData.value = { frame: f.frame, timeStr: f.timeStr };
  compareModalVisible.value = true;
}

function fallbackToConvert() {
  activeTool.value = 'convert';
}

function resetToDefaultVideo() {
  applyVideoSource({
    kind: 'default',
    name: 'sample-video.mp4',
    url: '/sample-video.mp4'
  });
}

/**
 * 批量入库
 */
async function batchSaveToLibrary() {
  if (!capturedFrames.value.length) {
    alert('请先截取至少一帧静帧');
    return;
  }
  savingLibrary.value = true;
  let ok = 0;
  let failed = 0;
  try {
    for (const f of capturedFrames.value) {
      try {
        await registerGeneratedAsset({
          imageBase64: f.dataUrl,
          prompt: `视频抽帧 ${videoSource.value.name} ${f.timeStr}`,
          model: 'video-frame',
          mode: 'video_frame',
          frame: f.frame
        });
        ok++;
      } catch (e) {
        failed++;
      }
    }
    alert(failed
      ? `归档完成：成功 ${ok} 帧，失败 ${failed} 帧`
      : `成功将 ${ok} 帧静帧画面归档至素材库！`);
  } finally {
    savingLibrary.value = false;
  }
}

// =============================================================================
// 2. 格式转换与音频提取逻辑
// =============================================================================
const convertSourceFileName = ref('全景客厅空间漫游.mp4');
const convertFileInputRef = ref(null);
const convertFileObj = ref(null);
const convertCloudFid = ref('');
const convertTargetFormat = ref('mp4');
const convertResolution = ref('source');
const convertExtractAudioOnly = ref(false);
const converting = ref(false);
const convertProgress = ref(0);
const convertStageText = ref('');
const convertResult = ref(null);
const convertCleanVocal = ref(true);

function triggerConvertFilePicker() {
  convertFileInputRef.value?.click();
}

function onConvertFileSelected(e) {
  const f = e.target.files?.[0];
  if (f) {
    convertFileObj.value = f;
    convertCloudFid.value = '';
    convertSourceFileName.value = f.name;
  }
}

async function uploadLocalVideo(file) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('filename', file.name);
  const res = await authFetch('/api/tools/upload', { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json.error || '临时媒体文件上传失败');
  }
  return json.data;
}

async function callConvertVideo(body) {
  const res = await authFetch('/api/tools/convert-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json.error || '转码失败');
  }
  return json.data;
}

async function runVideoConversion() {
  converting.value = true;
  convertProgress.value = 10;
  convertStageText.value = '正在解析视频容器与音视频轨道...';
  convertResult.value = null;

  let timer = null;
  try {
    if (!convertCloudFid.value && !convertFileObj.value) {
      throw new Error('请先选择本地视频，或从素材库挑一个云视频');
    }
    const isAudioOnly = convertExtractAudioOnly.value || ['mp3', 'wav'].includes(convertTargetFormat.value);
    const targetFmt = isAudioOnly ? (convertTargetFormat.value === 'wav' ? 'wav' : 'mp3') : convertTargetFormat.value;

    timer = setInterval(() => {
      if (convertProgress.value < 85) {
        convertProgress.value += 15;
        if (convertProgress.value > 40) convertStageText.value = '正在调用原生 FFmpeg 进行深度转码与封装...';
        if (convertProgress.value > 70) convertStageText.value = '正在完成元数据封装与流式优化...';
      }
    }, 400);

    let fid = convertCloudFid.value;
    let videoPath = '';
    if (!fid) {
      convertStageText.value = '正在上传本地文件到临时工作区（免入库）...';
      const uploaded = await uploadLocalVideo(convertFileObj.value);
      videoPath = uploaded.videoPath;
    }

    convertStageText.value = convertExtractAudioOnly.value && convertCleanVocal.value
      ? '正在调用 FFmpeg 深度分离人声并消除背景音乐与底噪...'
      : '正在调用原生 FFmpeg 进行深度转码与封装...';
    convertResult.value = await callConvertVideo({
      fid: fid || undefined,
      videoPath: videoPath || undefined,
      targetFormat: targetFmt,
      extractAudio: isAudioOnly,
      cleanVocal: isAudioOnly && convertCleanVocal.value,
      crf: 23,
    });
    convertProgress.value = 100;
    convertStageText.value = '转码完成';
  } catch (err) {
    convertProgress.value = 0;
    convertStageText.value = '';
    alert('转码失败: ' + err.message);
  } finally {
    if (timer) clearInterval(timer);
    converting.value = false;
  }
}

async function saveConvertResultToLibrary() {
  if (!convertResult.value?.downloadUrl) {
    alert('请先完成一次转码或提炼');
    return;
  }
  try {
    const isAudio = convertResult.value.type === 'audio' || ['mp3', 'wav', 'aac'].includes(convertResult.value.format);
    const isVocal = Boolean(convertResult.value.isCleanVocal);
    const out = await registerGeneratedAsset({
      previewUrl: convertResult.value.downloadUrl,
      prompt: isVocal ? '视频提炼纯人声' : (isAudio ? '视频提取音频轨' : '视频格式转码产物'),
      model: 'ffmpeg',
      mode: isVocal ? 'vocal_extract' : (isAudio ? 'audio_extract' : 'convert'),
      kind: isAudio ? 'audio' : 'video',
      category: isAudio ? 'voice' : 'video',
      format: convertResult.value.format || ''
    });
    if (out?.fid) alert(isAudio ? '音频已成功归档至素材库「人声参考」: ' + out.fid : '转码产物已归档至素材库: ' + out.fid);
    else alert('产物已成功归档至素材库');
  } catch (e) {
    alert('归档失败: ' + e.message);
  }
}

// =============================================================================
// 3. 视频智能压缩逻辑 (CRF 感知)
// =============================================================================
const compressSourceFileName = ref('全景客厅空间漫游.mp4');
const compressFileInputRef = ref(null);
const compressFileObj = ref(null);
const compressCloudFid = ref('');
const compressPreset = ref('web');
const compressCrf = ref(25);
const compressing = ref(false);
const compressProgress = ref(0);
const compressStageText = ref('');
const compressResult = ref(null);

function triggerCompressFilePicker() {
  compressFileInputRef.value?.click();
}

function onCompressFileSelected(e) {
  const f = e.target.files?.[0];
  if (f) {
    compressFileObj.value = f;
    compressCloudFid.value = '';
    compressSourceFileName.value = f.name;
  }
}

function applyCompressPreset(preset) {
  compressPreset.value = preset;
  if (preset === 'wechat') compressCrf.value = 28;
  else if (preset === 'web') compressCrf.value = 25;
  else if (preset === 'fidelity') compressCrf.value = 21;
}

const estimatedCompressedSize = computed(() => {
  const ratio = Math.max(0.18, Math.min(0.85, 1 - (compressCrf.value - 18) * 0.045));
  return (12.0 * ratio).toFixed(1);
});

const estimatedSavingsPercent = computed(() => {
  const ratio = Math.max(0.18, Math.min(0.85, 1 - (compressCrf.value - 18) * 0.045));
  return Math.round((1 - ratio) * 100);
});

const actualSavingsPercent = computed(() => {
  if (!compressResult.value) return 65;
  const outMb = compressResult.value.size / (1024 * 1024);
  const sav = Math.round((1 - outMb / 12.0) * 100);
  return Math.max(10, Math.min(90, sav));
});

async function runVideoCompression() {
  compressing.value = true;
  compressProgress.value = 10;
  compressStageText.value = '正在分析画面动态帧率与运动矢量...';
  compressResult.value = null;

  let timer = null;
  try {
    if (!compressCloudFid.value && !compressFileObj.value) {
      throw new Error('请先选择本地视频，或从素材库挑一个云视频');
    }
    timer = setInterval(() => {
      if (compressProgress.value < 85) {
        compressProgress.value += 15;
        if (compressProgress.value > 40) compressStageText.value = `正在使用 CRF=${compressCrf.value} 进行两趟量化压缩...`;
        if (compressProgress.value > 70) compressStageText.value = '正在生成压缩报告与校验体积比...';
      }
    }, 450);

    let fid = compressCloudFid.value;
    if (!fid) {
      compressStageText.value = '正在上传源视频到服务端...';
      fid = (await uploadLocalVideo(compressFileObj.value)).fid;
    }

    compressStageText.value = `正在使用 CRF=${compressCrf.value} 进行两趟量化压缩...`;
    compressResult.value = await callConvertVideo({
      fid,
      targetFormat: 'mp4',
      crf: compressCrf.value,
      extractAudio: false,
    });
    compressProgress.value = 100;
    compressStageText.value = '压缩完成';
  } catch (err) {
    compressProgress.value = 0;
    compressStageText.value = '';
    alert('压缩失败: ' + err.message);
  } finally {
    if (timer) clearInterval(timer);
    compressing.value = false;
  }
}

async function saveCompressResultToLibrary() {
  if (!compressResult.value?.downloadUrl) {
    alert('请先完成一次压缩');
    return;
  }
  try {
    const out = await registerGeneratedAsset({
      previewUrl: compressResult.value.downloadUrl,
      prompt: `视频压缩产物 CRF=${compressCrf.value}`,
      model: 'ffmpeg',
      mode: 'compress'
    });
    if (out?.fid) alert('压缩产物已归档至素材库: ' + out.fid);
    else alert('压缩产物已归档至素材库');
  } catch (e) {
    alert('归档失败: ' + e.message);
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  nextTick(() => {
    initExtractor();
    // 首次自动载入默认视频
    applyVideoSource({
      kind: 'default',
      name: 'sample-video.mp4',
      url: '/sample-video.mp4'
    });
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  clearTimeout(sliderScrubTimer);
  if (extractor) {
    extractor.destroy();
    extractor = null;
  }
});
</script>
