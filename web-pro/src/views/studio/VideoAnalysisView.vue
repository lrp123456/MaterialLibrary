<template>
  <div class="video-analysis-view flex-1 min-h-0 flex flex-col bg-studio-950 text-slate-200 overflow-hidden font-sans">
    <!-- 1. 空状态：尚未选择参考视频 -->
    <div v-if="!currentFid" class="flex-1 flex flex-col items-center justify-center p-8 text-center overflow-y-auto">
      <div class="max-w-xl mx-auto flex flex-col items-center">
        <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-5 shadow-inner">
          <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
        </div>

        <h2 class="text-xl font-bold text-slate-100 mb-2.5 tracking-tight">
          参考视频逆向拆解与运镜学习
        </h2>
        <p class="text-sm text-slate-400 mb-6 leading-relaxed">
          选取素材库中任意参考视频，系统将逐镜头拆解运镜运动、景别机位与光影视效；原片不进入提示词、不挂原片帧，为您生成纯净的运镜配方，一键带入空间创作。
        </p>

        <div class="flex flex-wrap justify-center gap-2 mb-8">
          <span class="px-2.5 py-1 text-xs rounded-full bg-studio-900 border border-studio-800 text-slate-300">逐镜运镜提取</span>
          <span class="px-2.5 py-1 text-xs rounded-full bg-studio-900 border border-studio-800 text-slate-300">图生视频免填词</span>
          <span class="px-2.5 py-1 text-xs rounded-full bg-studio-900 border border-studio-800 text-slate-300">先生尾帧与首尾帧</span>
          <span class="px-2.5 py-1 text-xs rounded-full bg-studio-900 border border-studio-800 text-slate-300">光影视效与调色分析</span>
          <span class="px-2.5 py-1 text-xs rounded-full bg-studio-900 border border-studio-800 text-slate-300">AI / 实拍制作判别</span>
        </div>

        <div class="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            @click="$emit('choose-video')"
            class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M12 8v8M8 12h8"/>
            </svg>
            <span>从素材库挑选视频</span>
          </button>

          <button
            type="button"
            @click="triggerLocalUpload"
            class="px-5 py-2.5 rounded-xl bg-studio-800 hover:bg-studio-700 text-slate-200 border border-studio-700 font-medium text-sm flex items-center gap-2 transition-all cursor-pointer"
          >
            <svg class="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>上传本地参考视频</span>
          </button>

          <button
            type="button"
            @click="openHistoryDrawer"
            class="px-5 py-2.5 rounded-xl bg-studio-900 hover:bg-studio-800 text-slate-300 hover:text-slate-100 border border-studio-700/80 font-medium text-sm flex items-center gap-2 transition-all cursor-pointer"
          >
            <svg class="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <span>拆解历史记录</span>
            <span v-if="historyCount > 0" class="px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-mono font-normal">
              {{ historyCount }}
            </span>
          </button>
          <input ref="localFileInput" type="file" accept="video/*" class="hidden" @change="onLocalFilePicked" />
        </div>
      </div>
    </div>

    <!-- 2. 已选视频工作视口 -->
    <div v-else class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <!-- 顶栏：视频信息与操作 -->
      <div class="px-5 py-3 border-b border-studio-800 bg-studio-900/70 backdrop-blur flex items-center justify-between shrink-0 gap-4">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-12 h-8 rounded bg-black/40 overflow-hidden border border-studio-700/80 shrink-0 flex items-center justify-center">
            <img v-if="videoThumbUrl" :src="videoThumbUrl" class="w-full h-full object-cover" />
            <svg v-else class="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-slate-100 truncate flex items-center gap-2">
              <span>{{ videoName || currentFid }}</span>
              <!-- 状态徽标 -->
              <span v-if="loading" class="px-2 py-0.5 text-[11px] rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 font-normal">
                <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                <span>分析中</span>
              </span>
              <span v-else-if="analysisStatus === 'pending'" class="px-2 py-0.5 text-[11px] rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-normal">
                排队中
              </span>
              <span v-else-if="analysisStatus === 'success'" class="px-2 py-0.5 text-[11px] rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-normal">
                已拆解
              </span>
              <span v-else-if="analysisStatus === 'error'" class="px-2 py-0.5 text-[11px] rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-normal">
                拆解失败
              </span>
            </div>
            <div class="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
              <span>FID: <code class="text-slate-300 font-mono">{{ currentFid.slice(0, 10) }}...</code></span>
              <span v-if="durationSec">· {{ durationSec.toFixed(1) }}s</span>
              <span v-if="updatedAtText">· {{ updatedAtText }}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 flex-wrap">
          <!-- 视觉模型挑选 -->
          <div class="flex items-center gap-1.5 bg-studio-800/90 border border-studio-700/80 rounded-lg px-2.5 py-1 text-xs" title="挑选用于逐镜头逆向研判的多模态视觉模型">
            <span class="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
            <span class="text-purple-300 font-mono text-[11px] shrink-0 font-medium">模型:</span>
            <select
              v-model="selectedModel"
              class="bg-transparent text-slate-100 text-xs border-none outline-hidden cursor-pointer"
              :disabled="loading || analysisStatus === 'running'"
            >
              <option v-for="m in AVAILABLE_VLM_MODELS" :key="m.id" :value="m.id" class="bg-studio-900 text-slate-100">
                {{ m.name }} ({{ m.tag }})
              </option>
            </select>
          </div>

          <button
            type="button"
            @click="openHistoryDrawer"
            class="px-3 py-1.5 text-xs rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-200 border border-studio-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            title="查看所有参考视频的拆解历史记录"
          >
            <svg class="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <span>拆解历史</span>
            <span v-if="historyCount > 0" class="px-1 py-0.2 rounded-full bg-indigo-500/30 text-indigo-300 text-[10px] font-mono">
              {{ historyCount }}
            </span>
          </button>
          <button
            type="button"
            @click="handleReanalyze"
            :disabled="loading || analysisStatus === 'running'"
            class="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm shadow-indigo-600/30"
            title="重新拆解该视频，将调用所选视觉模型覆盖现有报告"
          >
            <svg class="w-3.5 h-3.5 text-white" :class="{ 'animate-spin': loading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <span>重新拆解</span>
          </button>
          <button
            type="button"
            @click="$emit('choose-video')"
            class="px-3 py-1.5 text-xs rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-200 border border-studio-700 transition-colors cursor-pointer"
          >
            更换视频
          </button>
        </div>
      </div>

      <!-- 运行中 / 排队状态遮罩提示 -->
      <div v-if="loading || analysisStatus === 'running' || analysisStatus === 'pending'" class="flex-1 flex flex-col items-center justify-center p-8 text-center bg-studio-950/60 backdrop-blur-sm">
        <div class="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-4 animate-bounce">
          <svg class="w-7 h-7 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
          </svg>
        </div>
        <h3 class="text-base font-semibold text-slate-100 mb-1">
          {{ analysisStatus === 'running' ? '正在逆向拆解参考视频...' : (analysisStatus === 'pending' ? '任务已进入后台队列，等待执行...' : '正在准备拆解...') }}
        </h3>
        <p class="text-xs text-indigo-300 font-mono mb-4">{{ progressText || '正在读取视频信息与历史报告...' }}</p>
        <p class="text-xs text-slate-500 max-w-md">
          可以离开此页面或切回生成工作台。拆解完成后报告将自动保留，再次打开无需重跑。
        </p>
      </div>

      <!-- 失败状态提示 -->
      <div v-else-if="analysisStatus === 'error' && !breakdown" class="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div class="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mb-3">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 class="text-base font-semibold text-slate-200 mb-1">视频拆解失败</h3>
        <p class="text-xs text-rose-300 max-w-md mb-4">{{ errorMessage || '处理异常，请检查视频格式或服务状态' }}</p>
        <button
          type="button"
          @click="handleReanalyze"
          class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
        >
          重试拆解
        </button>
      </div>

      <!-- 3. 分析报告主体 -->
      <div v-else-if="breakdown" class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <!-- 报告概览栏 -->
        <div class="px-5 py-2.5 bg-studio-900/40 border-b border-studio-800/80 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-slate-400 font-medium">结论摘要：</span>
            <span class="text-slate-200 font-semibold">{{ summaryVerdict }}</span>
          </div>
          <div class="flex items-center gap-3 text-slate-400 text-[11px] flex-wrap">
            <span>分镜：<strong class="text-slate-200">{{ breakdown.shots?.length || 0 }}</strong> 镜</span>
            <span>置信度：<strong class="text-emerald-400">{{ (summaryConfidence * 100).toFixed(0) }}%</strong></span>
            <span v-if="vlmUsed" class="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1.5 font-normal shadow-sm" :title="`底层视觉配置: ${vlmModelRaw}`">
              <span class="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
              <span>视觉模型: <strong class="text-purple-200 font-semibold">{{ displayActualModel }}</strong></span>
            </span>
            <a
              v-if="rawReportUrl"
              :href="rawReportUrl"
              target="_blank"
              class="px-2 py-0.5 rounded bg-studio-800 hover:bg-studio-700 text-indigo-300 hover:text-indigo-200 border border-studio-700 flex items-center gap-1 font-medium transition-colors cursor-pointer"
              title="在新窗口查看 rea-video 原始完整分析大屏"
            >
              <span>查看原生大屏 ↗</span>
            </a>
          </div>
        </div>

        <!-- 分栏导航：运镜 | 光与调色 | 声音 | 包装 | 制作方式与复刻指南 -->
        <div class="px-5 border-b border-studio-800 bg-studio-950 flex items-center gap-1 shrink-0">
          <button
            v-for="tab in reportTabs"
            :key="tab.id"
            type="button"
            @click="activeReportTab = tab.id"
            :class="[
              'px-4 py-2.5 text-xs font-medium border-b-2 transition-all cursor-pointer flex items-center gap-1.5',
              activeReportTab === tab.id
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            ]"
          >
            <span>{{ tab.label }}</span>
            <span v-if="tab.id === 'camera' && breakdown.shots?.length" class="text-[10px] px-1.5 py-0.2 rounded-full bg-studio-850 text-slate-400">
              {{ breakdown.shots.length }}
            </span>
          </button>
        </div>

        <!-- 分栏内容视口 -->
        <div class="flex-1 min-h-0 overflow-y-auto p-5 scrollbar-thin">
          <!-- 栏 1：运镜 (核心分镜时间轴与生成跳转) -->
          <div v-show="activeReportTab === 'camera'" class="space-y-4 max-w-5xl mx-auto">
            <!-- 故事板总览图 -->
            <div v-if="storyboardUrl" class="rounded-xl border border-studio-800 bg-studio-900/50 p-3">
              <div class="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="2" width="20" height="20" rx="2.18"/>
                  <line x1="7" y1="2" x2="7" y2="22"/>
                  <line x1="17" y1="2" x2="17" y2="22"/>
                </svg>
                <span>整片分镜时间轴全景 (Storyboard)</span>
              </div>
              <div class="rounded-lg overflow-hidden border border-studio-750 bg-black/50">
                <img :src="storyboardUrl" class="w-full h-auto max-h-36 object-contain" />
              </div>
            </div>

            <!-- 逐镜卡片列表 -->
            <div class="space-y-4">
              <div
                v-for="shot in shotList"
                :key="shot.id"
                class="rounded-xl border bg-studio-900/60 transition-all p-4"
                :class="shot.isLowConfidence ? 'border-amber-500/40 shadow-sm shadow-amber-500/5' : 'border-studio-800'"
              >
                <!-- 镜号头与制作方式切换 -->
                <div class="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-studio-800/80">
                  <div class="flex items-center gap-2.5">
                    <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-xs font-mono font-bold">
                      #{{ shot.index }}
                    </span>
                    <span class="text-xs text-slate-300 font-mono">
                      {{ formatTime(shot.start) }} – {{ formatTime(shot.end) }} ({{ shot.duration.toFixed(1) }}s)
                    </span>
                    <!-- 低置信标记 -->
                    <span v-if="shot.isLowConfidence" class="px-2 py-0.5 text-[11px] rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                      <span>⚠️ 低置信（需核实）</span>
                    </span>
                  </div>

                  <!-- 制作方式切换选择器（允许手动修正该镜制作方式，实时更新指南与按钮） -->
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-slate-400">制作方式:</span>
                    <select
                      v-model="shotOverrides[shot.id]"
                      class="px-2 py-1 rounded bg-studio-950 border border-studio-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="ai_video">AI 生成视频</option>
                      <option value="live_action">实拍拍摄</option>
                      <option value="cg_3d">3D 建模渲染</option>
                      <option value="avatar">数字人</option>
                      <option value="still_motion">静图推拉 (Ken Burns)</option>
                      <option value="code_render">代码动效 (Remotion)</option>
                      <option value="screen_capture">屏幕录制</option>
                      <option value="real_material">用户真实素材</option>
                    </select>
                  </div>
                </div>

                <!-- 画面首尾帧对照（原片帧只在此作为视觉对照） -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div class="rounded-lg bg-black/40 border border-studio-750/80 overflow-hidden">
                    <div class="px-2.5 py-1 text-[11px] bg-studio-950/80 text-slate-400 border-b border-studio-800 flex justify-between">
                      <span>首帧 (In-Frame)</span>
                      <span>{{ formatTime(shot.start) }}</span>
                    </div>
                    <div class="aspect-video relative flex items-center justify-center bg-black/60">
                      <img
                        v-if="shot.firstFrameUrl"
                        :src="shot.firstFrameUrl"
                        class="w-full h-full object-contain"
                        alt="首帧"
                      />
                      <span v-else class="text-xs text-slate-500">无首帧预览</span>
                    </div>
                  </div>

                  <div class="rounded-lg bg-black/40 border border-studio-750/80 overflow-hidden">
                    <div class="px-2.5 py-1 text-[11px] bg-studio-950/80 text-slate-400 border-b border-studio-800 flex justify-between">
                      <span>尾帧 (Out-Frame)</span>
                      <span>{{ formatTime(shot.end) }}</span>
                    </div>
                    <div class="aspect-video relative flex items-center justify-center bg-black/60">
                      <img
                        v-if="shot.lastFrameUrl"
                        :src="shot.lastFrameUrl"
                        class="w-full h-full object-contain"
                        alt="尾帧"
                      />
                      <span v-else class="text-xs text-slate-500">无尾帧预览</span>
                    </div>
                  </div>
                </div>

                <!-- 提取运镜句与参数特征展示 -->
                <div class="rounded-lg bg-studio-950/80 border border-studio-800 p-3 mb-3">
                  <div class="flex items-center justify-between mb-1.5">
                    <span class="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <svg class="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                      <span>测算运镜句 (Camera Movement Recipe)</span>
                    </span>
                    <button
                      type="button"
                      @click="copyText(shot.synthesized?.cameraSentence)"
                      class="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer flex items-center gap-1"
                    >
                      <span>复制运镜句</span>
                    </button>
                  </div>
                  <p class="text-xs text-slate-200 font-mono leading-relaxed bg-studio-900/60 p-2 rounded border border-studio-800/80 select-all">
                    {{ shot.synthesized?.cameraSentence || '平稳运镜拍摄。' }}
                  </p>
                  <div class="flex flex-wrap gap-2 text-[11px] text-slate-400 mt-2">
                    <span class="px-2 py-0.5 rounded bg-studio-900 border border-studio-800">景别: {{ shot.aspects?.framing?.result?.shot_size || '中景' }}</span>
                    <span class="px-2 py-0.5 rounded bg-studio-900 border border-studio-800">机位角度: {{ shot.aspects?.framing?.result?.camera_angle || '平视角' }}</span>
                    <span class="px-2 py-0.5 rounded bg-studio-900 border border-studio-800">运动类型: {{ shot.aspects?.camera?.result?.move || '移动' }}</span>
                    <span class="px-2 py-0.5 rounded bg-studio-900 border border-studio-800">支撑方式: {{ shot.aspects?.camera?.result?.support_zh || '稳定器' }}</span>
                  </div>
                </div>

                <!-- 操作按钮区：按制作方式分流 -->
                <!-- A. AI、数字人、3D、静图推拉：提供两个主跳转按钮 -->
                <div v-if="isAiOrGenerative(shot.id)" class="pt-2 flex flex-wrap items-center justify-between gap-3 bg-studio-950/40 p-3 rounded-lg border border-studio-850">
                  <div class="text-xs text-slate-400 leading-normal">
                    <span>💡 跳转将新开生成会话，携带此镜头运镜句，不挂原片帧、托盘空置，由您挂入自己的图片。</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <!-- 左按钮：全能参考视频 -->
                    <button
                      type="button"
                      @click="handleJumpToI2V(shot)"
                      class="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                      <span>全能参考视频</span>
                    </button>

                    <!-- 右按钮：先生尾帧 (生图会话) -->
                    <button
                      type="button"
                      @click="handleJumpToTailFrame(shot)"
                      class="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                      title="先生成同一主体在运镜结束时的尾帧图片"
                    >
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      <span>先生尾帧</span>
                    </button>

                    <!-- 去首尾帧视频按钮 -->
                    <button
                      type="button"
                      @click="handleJumpToFirstLast(shot)"
                      class="px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-300 border border-studio-700 text-xs font-medium flex items-center gap-1 transition-all cursor-pointer"
                      title="打开首尾帧模式，由您自主上传首尾两张图"
                    >
                      <span>去首尾帧视频</span>
                    </button>
                  </div>
                </div>

                <!-- B. 实拍拍摄：拍摄指南 + 「用模型近似」折叠 -->
                <div v-else-if="shotOverrides[shot.id] === 'live_action'" class="pt-2 space-y-2">
                  <div class="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                    <div class="font-semibold mb-1">📹 实拍拍摄复刻指南：</div>
                    <p class="leading-relaxed text-slate-300">
                      {{ shot.replication?.shoot?.summary || '建议使用手机或微单配备稳定器，按平视机位平滑运镜，保持主体居中，控制走位节奏。' }}
                    </p>
                  </div>
                  <!-- 用模型近似折叠 -->
                  <details class="text-xs rounded-lg bg-studio-950/60 border border-studio-800 p-2.5">
                    <summary class="font-medium text-slate-300 cursor-pointer hover:text-indigo-400 select-none">
                      ✨ 或使用 AI 视频模型近似复刻此运镜
                    </summary>
                    <div class="pt-3 flex items-center justify-end gap-2 border-t border-studio-800 mt-2">
                      <button
                        type="button"
                        @click="handleJumpToI2V(shot)"
                        class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
                      >
                        全能参考视频
                      </button>
                      <button
                        type="button"
                        @click="handleJumpToTailFrame(shot)"
                        class="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold cursor-pointer"
                      >
                        先生尾帧
                      </button>
                      <button
                        type="button"
                        @click="handleJumpToFirstLast(shot)"
                        class="px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-300 border border-studio-700 text-xs cursor-pointer"
                      >
                        首尾帧视频
                      </button>
                    </div>
                  </details>
                </div>

                <!-- C. 代码动效 / 录屏 / 用户真实素材：仅指南，无生成按钮 -->
                <div v-else class="pt-2">
                  <div class="p-3 rounded-lg bg-studio-950/80 border border-studio-800 text-xs text-slate-300">
                    <div class="font-semibold text-slate-200 mb-1">🛠️ 制作建议：</div>
                    <p class="leading-relaxed text-slate-400">
                      本镜头属于
                      <strong class="text-slate-200">{{ getMethodLabel(shotOverrides[shot.id]) }}</strong>，
                      建议通过前端代码动效（Remotion / CSS）、屏幕录屏工具或直接引入真实素材资产进行剪辑合成，不建议使用模型生图。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 栏 2：光与调色 -->
          <div v-show="activeReportTab === 'lighting'" class="space-y-4 max-w-4xl mx-auto">
            <div class="rounded-xl border border-studio-800 bg-studio-900/60 p-5 space-y-4">
              <h3 class="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                <span>打光方案与影调分析</span>
              </h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div class="p-3.5 rounded-lg bg-studio-950 border border-studio-800 space-y-2">
                  <div class="text-slate-400 font-medium">布光方式</div>
                  <div class="text-slate-100 font-semibold">{{ breakdown.aspects?.lighting?.result?.setup_name || '标准侧光' }}</div>
                  <div class="text-slate-400 leading-relaxed">{{ breakdown.aspects?.lighting?.setup?.detail || '主光在主体一侧斜前方，另一侧有补光' }}</div>
                </div>
                <div class="p-3.5 rounded-lg bg-studio-950 border border-studio-800 space-y-2">
                  <div class="text-slate-400 font-medium">光影特征参数</div>
                  <div class="text-slate-300">主光方向：{{ breakdown.aspects?.lighting?.words?.key_direction || '右侧前方' }}</div>
                  <div class="text-slate-300">垂直机位：{{ breakdown.aspects?.lighting?.words?.vertical || '从上往下' }}</div>
                  <div class="text-slate-300">光比：{{ breakdown.aspects?.lighting?.words?.ratio || '约 2:1' }}</div>
                  <div class="text-slate-300">光质：{{ breakdown.aspects?.lighting?.words?.quality || '硬光/中性' }}</div>
                </div>
              </div>

              <h3 class="text-sm font-bold text-slate-100 flex items-center gap-2 pt-2">
                <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
                <span>调色风格 (Color Grade)</span>
              </h3>
              <div class="p-3.5 rounded-lg bg-studio-950 border border-studio-800 text-xs space-y-1.5">
                <div class="text-slate-100 font-semibold text-sm">{{ breakdown.aspects?.grade?.words?.look || '暗调低饱和电影感' }}</div>
                <div class="text-slate-400">
                  饱和度：{{ breakdown.aspects?.grade?.words?.saturation || '正常' }} ·
                  对比度：{{ breakdown.aspects?.grade?.words?.contrast || '低对比' }} ·
                  黑位：{{ breakdown.aspects?.grade?.words?.black || '正常' }}
                </div>
              </div>
            </div>
          </div>

          <!-- 栏 3：声音 (Audio) -->
          <div v-show="activeReportTab === 'audio'" class="space-y-4 max-w-4xl mx-auto">
            <div class="rounded-xl border border-studio-800 bg-studio-900/60 p-5 space-y-4">
              <h3 class="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-indigo-400"></span>
                <span>背景音乐与音频结构</span>
              </h3>
              <div class="p-3.5 rounded-lg bg-studio-950 border border-studio-800 text-xs space-y-2">
                <div class="text-slate-200">
                  <strong>BGM 节奏：</strong>
                  {{ breakdown.audio?.music?.tempo_bpm ? `${breakdown.audio.music.tempo_bpm} BPM` : '无明显固定节拍' }}
                  <span v-if="breakdown.audio?.music?.key" class="text-slate-400">（调性：{{ breakdown.audio.music.key.tonic }} {{ breakdown.audio.music.key.mode }}）</span>
                </div>
                <div class="text-slate-400 leading-relaxed">
                  {{ breakdown.audio_plan?.plan?.[0]?.how || '原曲倾向现成曲库配乐：按 BPM/情绪/调性在曲库检索同类曲，或用 AI 生成相近风格的免版权曲' }}
                </div>
              </div>

              <h3 class="text-sm font-bold text-slate-100 flex items-center gap-2 pt-2">
                <span class="w-2 h-2 rounded-full bg-rose-400"></span>
                <span>音效卡点 (SFX)</span>
              </h3>
              <div class="p-3.5 rounded-lg bg-studio-950 border border-studio-800 text-xs">
                <div v-if="breakdown.audio?.sfx?.events?.length" class="space-y-1.5">
                  <div class="text-slate-300 mb-2">共检测到 {{ breakdown.audio.sfx.events.length }} 处关键音效点：</div>
                  <div class="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                    <span
                      v-for="(ev, idx) in breakdown.audio.sfx.events"
                      :key="idx"
                      class="px-2 py-1 rounded bg-studio-900 border border-studio-800 text-slate-300 font-mono text-[11px]"
                    >
                      {{ ev.t?.toFixed(2) }}s [{{ ev.type }}]
                    </span>
                  </div>
                </div>
                <div v-else class="text-slate-400">未检测到明显动作音效卡点</div>
              </div>
            </div>
          </div>

          <!-- 栏 4：包装 (Packaging) -->
          <div v-show="activeReportTab === 'packaging'" class="space-y-4 max-w-4xl mx-auto">
            <div class="rounded-xl border border-studio-800 bg-studio-900/60 p-5 space-y-4">
              <h3 class="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-pink-400"></span>
                <span>剪辑包装层（字幕、花字与贴纸）</span>
              </h3>
              <div class="p-3.5 rounded-lg bg-studio-950 border border-studio-800 text-xs space-y-2">
                <div class="text-slate-300">
                  字幕句数：<strong>{{ breakdown.packaging?.text_cues?.length || 0 }}</strong> 句
                </div>
                <div class="text-slate-300">
                  贴纸/花字：<strong>{{ breakdown.packaging?.stickers?.length || 0 }}</strong> 处
                </div>
                <p class="text-slate-400 leading-relaxed text-[11px]">
                  字幕与贴纸通常属于后期剪辑合成层，在复刻生成阶段建议保留纯净主体画面，完成视频生成后再进入多轨剪辑台添加包装。
                </p>
              </div>
            </div>
          </div>

          <!-- 栏 5：制作方式与复刻指南 -->
          <div v-show="activeReportTab === 'production'" class="space-y-4 max-w-4xl mx-auto">
            <div class="rounded-xl border border-studio-800 bg-studio-900/60 p-5 space-y-4">
              <h3 class="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>整片制作方式占比</span>
              </h3>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div
                  v-for="item in breakdown.summary?.production_mix || []"
                  :key="item.label"
                  class="p-3 rounded-lg bg-studio-950 border border-studio-800 text-center"
                >
                  <div class="text-slate-400 text-[11px] mb-1">{{ item.label_zh }}</div>
                  <div class="text-base font-bold text-slate-100">{{ (item.ratio * 100).toFixed(0) }}%</div>
                  <div class="text-[10px] text-slate-500 font-mono">{{ item.seconds }}s</div>
                </div>
              </div>

              <h3 class="text-sm font-bold text-slate-100 flex items-center gap-2 pt-2">
                <span class="w-2 h-2 rounded-full bg-indigo-400"></span>
                <span>复刻规划建议 (Production Plan)</span>
              </h3>
              <div class="p-4 rounded-lg bg-studio-950 border border-studio-800 text-xs text-slate-300 space-y-2">
                <p class="leading-relaxed">{{ breakdown.summary?.production || '推荐使用图生视频并配合首尾帧保持主体一致性进行复刻。' }}</p>
              </div>
            </div>
          </div>

          <!-- 栏 6：原始拆分报告与数据大屏 (Raw Report) -->
          <div v-show="activeReportTab === 'raw'" class="h-full flex flex-col space-y-3">
            <!-- 顶部工具栏 -->
            <div class="flex flex-wrap items-center justify-between gap-3 p-3 bg-studio-900/80 border border-studio-800 rounded-xl shrink-0">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                <span class="text-xs font-semibold text-slate-200">rea-video 原生逆向拆解全景报告</span>
                <span class="text-[11px] text-slate-400 hidden sm:inline">（包含底层光流曲线、音轨分频波形、视觉模型判词与时序图表）</span>
              </div>
              <div class="flex items-center gap-2">
                <a
                  v-if="rawReportUrl"
                  :href="rawReportUrl"
                  target="_blank"
                  class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 shadow transition-colors cursor-pointer"
                  title="新窗口全屏独享查看"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                  <span>全屏查看原生大屏 ↗</span>
                </a>
                <button
                  type="button"
                  @click="copyRawJson"
                  class="px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-200 border border-studio-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>复制原始 JSON</span>
                </button>
                <button
                  type="button"
                  @click="downloadRawJson"
                  class="px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-200 border border-studio-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>下载 JSON</span>
                </button>
              </div>
            </div>

            <!-- 原生 report.html iframe 嵌入视口 (高保真全屏展示) -->
            <div class="flex-1 min-h-[580px] rounded-xl overflow-hidden border border-studio-800 bg-white relative shadow-2xl">
              <iframe
                v-if="rawReportUrl"
                :src="rawReportUrl"
                class="w-full h-full border-0 absolute inset-0 bg-white"
                loading="lazy"
              ></iframe>
              <div v-else class="h-full flex items-center justify-center text-xs text-slate-500">
                暂未生成原始报告
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. 拆解历史抽屉 (Drawer) -->
    <transition name="drawer-fade">
      <div v-if="showHistoryDrawer" class="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
        <div class="fixed inset-0" @click="closeHistoryDrawer"></div>
        <div class="relative w-full max-w-lg bg-studio-900 border-l border-studio-800 shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-200">
          <!-- 抽屉顶栏 -->
          <div class="px-5 py-4 border-b border-studio-800 flex items-center justify-between shrink-0 bg-studio-950/60">
            <div class="flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <h2 class="text-base font-bold text-slate-100">参考视频拆解历史</h2>
              <span v-if="historyTotal > 0" class="px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-300 font-mono">
                {{ historyTotal }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                @click="fetchHistory"
                :disabled="historyLoading"
                class="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-studio-800 transition-colors cursor-pointer"
                title="刷新历史列表"
              >
                <svg class="w-4 h-4" :class="{ 'animate-spin': historyLoading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              </button>
              <button
                type="button"
                @click="closeHistoryDrawer"
                class="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-studio-800 transition-colors cursor-pointer"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- 抽屉搜索与状态过滤 -->
          <div class="p-4 border-b border-studio-800/80 space-y-3 bg-studio-900/40">
            <div class="relative">
              <input
                v-model="historySearch"
                type="text"
                placeholder="搜索视频文件名或 FID..."
                class="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-studio-950 border border-studio-700/80 text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
              />
              <svg class="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>

            <div class="flex items-center gap-1.5 text-xs">
              <button
                v-for="tab in historyFilterTabs"
                :key="tab.id"
                type="button"
                @click="historyStatusTab = tab.id"
                class="px-2.5 py-1 rounded-md transition-colors cursor-pointer font-medium text-[11px]"
                :class="historyStatusTab === tab.id ? 'bg-indigo-600 text-white shadow-xs' : 'bg-studio-950 hover:bg-studio-800 text-slate-400 hover:text-slate-200 border border-studio-800'"
              >
                {{ tab.label }}
              </button>
            </div>
          </div>

          <!-- 抽屉列表区 -->
          <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            <div v-if="historyLoading && filteredHistoryItems.length === 0" class="py-12 flex flex-col items-center justify-center text-slate-400">
              <svg class="w-6 h-6 animate-spin text-indigo-400 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
              </svg>
              <span class="text-xs">加载历史记录...</span>
            </div>

            <div v-else-if="filteredHistoryItems.length === 0" class="py-16 text-center text-slate-500 text-xs">
              <svg class="w-10 h-10 mx-auto text-slate-600 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
              <span>{{ historySearch ? '未找到符合条件的拆解记录' : '暂无视频拆解历史' }}</span>
            </div>

            <div
              v-for="item in filteredHistoryItems"
              :key="item.fid"
              class="group p-3 rounded-xl bg-studio-950/70 hover:bg-studio-800/80 border transition-all cursor-pointer flex flex-col gap-2.5"
              :class="item.fid === currentFid ? 'border-indigo-500/80 ring-1 ring-indigo-500/30' : 'border-studio-800 hover:border-studio-700'"
              @click="selectHistory(item)"
            >
              <div class="flex items-start gap-3">
                <!-- 封面图 -->
                <div class="w-16 h-12 rounded-lg bg-black/50 border border-studio-800 overflow-hidden shrink-0 relative flex items-center justify-center">
                  <img v-if="item.thumbUrl" :src="item.thumbUrl" class="w-full h-full object-cover" />
                  <svg v-else class="w-5 h-5 text-slate-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  <span v-if="item.duration" class="absolute bottom-0.5 right-0.5 px-1 py-0.2 rounded bg-black/80 text-[10px] text-slate-300 font-mono">
                    {{ item.duration }}s
                  </span>
                </div>

                <!-- 标题与状态 -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-1.5">
                    <h4 class="text-xs font-semibold text-slate-200 truncate group-hover:text-indigo-300 transition-colors" :title="item.name">
                      {{ item.name }}
                    </h4>
                    <!-- 状态标签 -->
                    <span v-if="item.status === 'success'" class="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0 font-normal">
                      已拆解
                    </span>
                    <span v-else-if="item.status === 'running'" class="px-1.5 py-0.5 rounded text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0 flex items-center gap-1 font-normal">
                      <span class="w-1 h-1 rounded-full bg-indigo-400 animate-pulse"></span>
                      <span>分析中</span>
                    </span>
                    <span v-else-if="item.status === 'pending'" class="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0 font-normal">
                      排队中
                    </span>
                    <span v-else-if="item.status === 'error'" class="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0 font-normal">
                      失败
                    </span>
                  </div>

                  <div class="text-[11px] text-slate-400 flex items-center gap-2 mt-1">
                    <span class="font-mono text-slate-500">FID: {{ item.fid.slice(0, 8) }}...</span>
                    <span v-if="item.shotsCount">· {{ item.shotsCount }} 镜头</span>
                    <span v-if="item.fid === currentFid" class="px-1.5 py-0.2 rounded bg-indigo-500/30 text-indigo-200 text-[10px]">当前查看</span>
                  </div>

                  <!-- 错误信息 / 进度提示 -->
                  <div v-if="item.status === 'error' && item.error" class="text-[11px] text-rose-400/90 mt-1 line-clamp-1" :title="item.error">
                    {{ item.error }}
                  </div>
                  <div v-else-if="item.status === 'running' && item.progress" class="text-[11px] text-indigo-300/80 mt-1 line-clamp-1">
                    {{ item.progress }}
                  </div>
                </div>
              </div>

              <!-- 底部操作与时间栏 -->
              <div class="pt-2 border-t border-studio-900 flex items-center justify-between text-[11px] text-slate-500">
                <span>{{ formatHistoryTime(item.updatedAt || item.createdAt) }}</span>

                <div class="flex items-center gap-2" @click.stop>
                  <button
                    v-if="item.status === 'error'"
                    type="button"
                    @click="handleRetryHistory(item)"
                    class="px-2 py-0.5 rounded bg-studio-800 hover:bg-studio-700 text-indigo-300 hover:text-indigo-200 transition-colors"
                  >
                    重试
                  </button>
                  <button
                    type="button"
                    @click="selectHistory(item)"
                    class="px-2 py-0.5 rounded bg-studio-800 hover:bg-studio-700 text-slate-300 hover:text-white transition-colors"
                  >
                    {{ item.fid === currentFid ? '刷新' : '载入' }}
                  </button>
                  <button
                    type="button"
                    @click="handleDeleteHistory(item)"
                    class="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-studio-800 transition-colors"
                    title="删除该记录"
                  >
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  getAssetImageUrl,
  getAssetPosterUrl,
  getVideoAnalysis,
  getVideoAnalysisAssetUrl,
  getVideoAnalysisHistory,
  deleteVideoAnalysis,
  submitVideoAnalysis
} from '../../api';

const props = defineProps({
  currentVideo: { type: Object, default: null }
});

const emit = defineEmits(['choose-video', 'upload-video', 'jump-to-generate', 'select-history']);

const localFileInput = ref(null);
function triggerLocalUpload() {
  localFileInput.value?.click();
}
function onLocalFilePicked(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  emit('upload-video', file);
}

const currentFid = computed(() => props.currentVideo?.fid || props.currentVideo?.id || '');
const videoName = computed(() => props.currentVideo?.file_name || props.currentVideo?.name || '');
const videoThumbUrl = computed(() => {
  if (!currentFid.value) return '';
  return props.currentVideo?.url || getAssetPosterUrl(currentFid.value, props.currentVideo?.mediaToken);
});

// 视觉模型可选配置
const AVAILABLE_VLM_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: '快速精准·多模态首选', tag: '推荐' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', desc: '深度细致·长上下文', tag: '深度' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', desc: '通用高性价比分析', tag: '通用' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', desc: '高阶视觉实验模型', tag: '实验' }
];
const selectedModel = ref('gemini-2.5-flash');
const actualModelBackend = ref('');

const loading = ref(false);
const analysisStatus = ref('idle'); // idle | pending | running | success | error
const progressText = ref('');
const errorMessage = ref('');
const breakdown = ref(null);
const updatedAt = ref(null);
const shotOverrides = ref({}); // shot.id -> label

const reportTabs = [
  { id: 'camera', label: '运镜与分镜' },
  { id: 'lighting', label: '光与调色' },
  { id: 'audio', label: '声音包装' },
  { id: 'packaging', label: '字幕贴纸' },
  { id: 'production', label: '制作方式与复刻指南' },
  { id: 'raw', label: '原始拆分报告 (Raw Report)' }
];
const activeReportTab = ref('camera');

let pollTimer = null;

const storyboardUrl = computed(() => {
  if (!currentFid.value || !breakdown.value) return '';
  return getVideoAnalysisAssetUrl(currentFid.value, 'storyboard.jpg');
});

const rawReportUrl = computed(() => {
  if (!currentFid.value) return '';
  return getVideoAnalysisAssetUrl(currentFid.value, 'report.html');
});

const rawJsonUrl = computed(() => {
  if (!currentFid.value) return '';
  return getVideoAnalysisAssetUrl(currentFid.value, 'breakdown.json');
});

const durationSec = computed(() => {
  return Number(breakdown.value?.source?.duration) || Number(props.currentVideo?.duration) || 0;
});

const updatedAtText = computed(() => {
  if (!updatedAt.value) return '';
  const d = new Date(updatedAt.value);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});

const summaryVerdict = computed(() => {
  return breakdown.value?.summary?.verdict || 'AI 生成 / 实拍混合制作';
});

const summaryConfidence = computed(() => {
  return Number(breakdown.value?.summary?.confidence) || 0.85;
});

const vlmUsed = computed(() => {
  return Boolean(breakdown.value?.analysis?.vlm?.used || breakdown.value?.summary?.vlm);
});

const vlmModelRaw = computed(() => {
  const vlm = breakdown.value?.analysis?.vlm;
  return vlm?.model || vlm?.active_model || vlm?.engine || '';
});

const displayActualModel = computed(() => {
  const m = actualModelBackend.value || breakdown.value?.shots?.[0]?.vlm?._model || breakdown.value?.summary?.actual_model;
  if (!m) return 'Gemini 2.5 Flash';
  const found = AVAILABLE_VLM_MODELS.find(opt => opt.id === m);
  if (found) return found.name;
  if (m === 'gemini-4-argon') return 'Gemini 4 Argon';
  if (m.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash';
  if (m.includes('gemini-1.5-pro')) return 'Gemini 1.5 Pro';
  if (m.includes('gpt-4o-mini')) return 'GPT-4o mini';
  return m;
});

const shotList = computed(() => {
  const shots = breakdown.value?.shots || [];
  return shots.map((s) => {
    const override = shotOverrides.value[s.id] || s.base?.label || 'ai_video';
    const conf = Number(s.base?.confidence) || 1.0;
    const isLowConfidence = conf < 0.65 || Boolean(s.base?.uncertain) || Boolean(s.base?.disputed);

    const firstFrameRel = s.assets?.first_frame || `shots/${s.id}_first.jpg`;
    const lastFrameRel = s.assets?.last_frame || `shots/${s.id}_last.jpg`;

    return {
      ...s,
      currentLabel: override,
      isLowConfidence,
      firstFrameUrl: getVideoAnalysisAssetUrl(currentFid.value, firstFrameRel),
      lastFrameUrl: getVideoAnalysisAssetUrl(currentFid.value, lastFrameRel)
    };
  });
});

function formatTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const rem = (s % 60).toFixed(1);
  return `${String(m).padStart(2, '0')}:${rem.padStart(4, '0')}`;
}

function getMethodLabel(key) {
  const map = {
    ai_video: 'AI 生成视频',
    live_action: '实拍拍摄',
    cg_3d: '3D 建模渲染',
    avatar: '数字人',
    still_motion: '静图推拉',
    code_render: '代码动效',
    screen_capture: '屏幕录制',
    real_material: '用户真实素材'
  };
  return map[key] || 'AI 生成视频';
}

function isAiOrGenerative(shotId) {
  const l = shotOverrides.value[shotId];
  return ['ai_video', 'cg_3d', 'avatar', 'still_motion'].includes(l);
}

async function loadExistingOrQueue(fid, { reanalyze = false } = {}) {
  if (!fid) return;
  loading.value = true;
  errorMessage.value = '';
  progressText.value = '正在读取拆解状态...';

  try {
    const res = await getVideoAnalysis(fid);
    const data = res?.data;

    if (data && data.status === 'success' && data.breakdown && !reanalyze) {
      analysisStatus.value = 'success';
      breakdown.value = data.breakdown;
      updatedAt.value = data.updatedAt;
      if (data.actualModel) actualModelBackend.value = data.actualModel;
      initOverrides(data.breakdown);
      loading.value = false;
      return;
    }

    if (data && (data.status === 'running' || data.status === 'pending') && !reanalyze) {
      analysisStatus.value = data.status;
      progressText.value = data.progress || '拆解进行中...';
      startPolling(fid);
      return;
    }

    // 若无已完成报告或指定重新拆解，则触发入队
    progressText.value = '正在加入拆解队列...';
    const queueRes = await submitVideoAnalysis(fid, { reanalyze, model: selectedModel.value });
    const qData = queueRes?.data;
    analysisStatus.value = qData?.status || 'running';
    progressText.value = qData?.progress || '正在启动拆解引擎...';
    startPolling(fid);
  } catch (err) {
    analysisStatus.value = 'error';
    errorMessage.value = err.message || '查询视频拆解失败';
    loading.value = false;
  }
}

function initOverrides(bd) {
  const ov = {};
  if (bd && Array.isArray(bd.shots)) {
    bd.shots.forEach((s) => {
      ov[s.id] = s.base?.label || 'ai_video';
    });
  }
  shotOverrides.value = ov;
}

function startPolling(fid) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const res = await getVideoAnalysis(fid);
      const data = res?.data;
      if (!data) return;

      analysisStatus.value = data.status;
      progressText.value = data.progress || '';

      if (data.status === 'success' && data.breakdown) {
        breakdown.value = data.breakdown;
        updatedAt.value = data.updatedAt;
        if (data.actualModel) actualModelBackend.value = data.actualModel;
        initOverrides(data.breakdown);
        loading.value = false;
        stopPolling();
      } else if (data.status === 'error') {
        errorMessage.value = data.error || '拆解失败';
        loading.value = false;
        stopPolling();
      }
    } catch (_) {}
  }, 2500);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function handleReanalyze() {
  if (!currentFid.value) return;
  const modelObj = AVAILABLE_VLM_MODELS.find(m => m.id === selectedModel.value);
  const modelName = modelObj ? modelObj.name : selectedModel.value;
  if (confirm(`确定要使用视觉模型【${modelName}】重新拆解当前视频吗？完成后将用最新结果替换现有报告。`)) {
    void loadExistingOrQueue(currentFid.value, { reanalyze: true });
  }
}

function copyRawJson() {
  if (!breakdown.value) return;
  navigator.clipboard?.writeText?.(JSON.stringify(breakdown.value, null, 2));
  alert('完整 breakdown.json 已复制到剪贴板！');
}

function downloadRawJson() {
  if (!breakdown.value) return;
  const blob = new Blob([JSON.stringify(breakdown.value, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `breakdown_${currentFid.value || 'video'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function copyText(str) {
  if (!str) return;
  navigator.clipboard?.writeText?.(str);
  alert('运镜句已复制到剪贴板！');
}

// ── 两个主按钮跳转链路 ──
// 1. 图生视频：携带运镜句 + 「保持所挂图片里的空间和主体，只改镜头运动」，切到图生视频，托盘空着
function handleJumpToI2V(shot) {
  const sentence = shot.synthesized?.promptI2V || (shot.synthesized?.cameraSentence + '保持所挂图片里的空间和主体，只改镜头运动。');
  emit('jump-to-generate', {
    target: 'recipe',
    genMode: 'video',
    schemaMode: 'omni_reference',
    recipePrompt: sentence,
    supplementText: ''
  });
}

// 2. 先生尾帧：开一条生图会话，提示词只写同一主体在运镜结束时的景别和机位，不写原片内容
function handleJumpToTailFrame(shot) {
  const sentence = shot.synthesized?.promptTailFrame || '同一空间与主体在运镜结束时的画面：中景，平视角，保持空间主体一致。';
  emit('jump-to-generate', {
    target: 'recipe',
    genMode: 'image',
    schemaMode: 'text_to_image',
    recipePrompt: sentence,
    supplementText: ''
  });
}

// 首尾帧视频跳转
function handleJumpToFirstLast(shot) {
  const sentence = shot.synthesized?.promptFirstLastVideo || `从首帧平滑运动过渡至尾帧，${shot.synthesized?.cameraSentence || '平稳运镜'}`;
  emit('jump-to-generate', {
    target: 'recipe',
    genMode: 'video',
    schemaMode: 'first_last_frame',
    recipePrompt: sentence,
    supplementText: ''
  });
}

watch(
  () => currentFid.value,
  (newFid) => {
    stopPolling();
    breakdown.value = null;
    if (newFid) {
      void loadExistingOrQueue(newFid, { reanalyze: false });
    } else {
      analysisStatus.value = 'idle';
    }
  },
  { immediate: true }
);

// ── 拆解历史功能状态与方法 ──
const showHistoryDrawer = ref(false);
const historyItems = ref([]);
const historyTotal = ref(0);
const historyLoading = ref(false);
const historySearch = ref('');
const historyStatusTab = ref('all'); // all | success | running | error

const historyCount = computed(() => historyTotal.value || historyItems.value.length || 0);

const historyFilterTabs = [
  { id: 'all', label: '全部' },
  { id: 'success', label: '已拆解' },
  { id: 'running', label: '分析中' },
  { id: 'error', label: '失败' }
];

const filteredHistoryItems = computed(() => {
  let list = historyItems.value || [];
  if (historyStatusTab.value !== 'all') {
    if (historyStatusTab.value === 'running') {
      list = list.filter((i) => i.status === 'running' || i.status === 'pending');
    } else {
      list = list.filter((i) => i.status === historyStatusTab.value);
    }
  }
  if (historySearch.value.trim()) {
    const q = historySearch.value.trim().toLowerCase();
    list = list.filter((i) => (i.name && i.name.toLowerCase().includes(q)) || (i.fid && i.fid.toLowerCase().includes(q)));
  }
  return list;
});

async function fetchHistory() {
  historyLoading.value = true;
  try {
    const res = await getVideoAnalysisHistory({ limit: 100 });
    if (res && res.items) {
      historyItems.value = res.items;
      historyTotal.value = res.total ?? res.items.length;
    }
  } catch (err) {
    console.warn('[video-analysis] 拉取拆解历史失败:', err);
  } finally {
    historyLoading.value = false;
  }
}

function openHistoryDrawer() {
  showHistoryDrawer.value = true;
  void fetchHistory();
}

function closeHistoryDrawer() {
  showHistoryDrawer.value = false;
}

function selectHistory(item) {
  if (!item || !item.fid) return;
  emit('select-history', item);
  closeHistoryDrawer();
  if (item.fid === currentFid.value) {
    void loadExistingOrQueue(item.fid, { reanalyze: false });
  }
}

async function handleRetryHistory(item) {
  if (!item || !item.fid) return;
  try {
    await submitVideoAnalysis(item.fid, { reanalyze: true });
    item.status = 'running';
    item.progress = '正在准备重试拆解...';
    item.error = '';
    void fetchHistory();
    if (item.fid === currentFid.value) {
      void loadExistingOrQueue(item.fid, { reanalyze: true });
    }
  } catch (err) {
    alert(`重试拆解失败: ${err.message || err}`);
  }
}

async function handleDeleteHistory(item) {
  if (!item || !item.fid) return;
  if (!confirm(`确认删除【${item.name || item.fid}】的拆解记录吗？`)) return;
  try {
    await deleteVideoAnalysis(item.fid);
    historyItems.value = historyItems.value.filter((i) => i.fid !== item.fid);
    historyTotal.value = Math.max(0, historyTotal.value - 1);
    if (item.fid === currentFid.value) {
      analysisStatus.value = 'idle';
      breakdown.value = null;
    }
  } catch (err) {
    alert(`删除失败: ${err.message || err}`);
  }
}

function formatHistoryTime(ts) {
  if (!ts) return '';
  const now = Date.now();
  const diff = now - Number(ts);
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  const d = new Date(Number(ts));
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

onMounted(() => {
  void fetchHistory();
  if (currentFid.value) {
    void loadExistingOrQueue(currentFid.value, { reanalyze: false });
  }
});

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<style scoped>
.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.2);
  border-radius: 3px;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.35);
}
</style>
