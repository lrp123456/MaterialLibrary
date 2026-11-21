<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" @click.self="$emit('close')">
    <div class="w-[1160px] max-w-[95vw] h-[88vh] bg-studio-900 border border-studio-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 font-sans animate-in fade-in zoom-in-95 duration-150">
      
      <!-- 头部细条 -->
      <div class="h-11 px-5 border-b border-studio-800 bg-studio-950/70 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-slate-300">创作详情</span>
          <span class="text-xs text-slate-500">·</span>
          <span class="text-xs text-slate-400 font-mono truncate max-w-[400px]">{{ currentRootHash }}</span>
        </div>
        <button
          type="button"
          class="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-studio-800 transition-colors cursor-pointer"
          title="关闭 (Esc)"
          @click="$emit('close')"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <!-- 载入中状态 -->
      <div v-if="loading" class="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
        <svg class="w-7 h-7 animate-spin text-studio-cyan" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
        </svg>
        <span class="text-xs">加载资产与演变记录...</span>
      </div>

      <!-- 主两栏容器 -->
      <div v-else class="flex-1 min-h-0 flex overflow-hidden">
        
        <!-- 左栏：同基图导航目录 (宽约 250px) -->
        <div class="w-[260px] border-r border-studio-800 bg-studio-950/50 flex flex-col shrink-0 overflow-hidden">
          
          <!-- 1. 根原图头部与说明 -->
          <div class="p-3.5 border-b border-studio-800 space-y-2.5">
            <div class="flex items-start gap-2.5">
              <div class="w-14 h-14 rounded-lg bg-black/50 border border-studio-700/80 overflow-hidden shrink-0">
                <img v-if="rootImageThumbnail" :src="rootImageThumbnail" class="w-full h-full object-cover" />
                <div v-else class="w-full h-full flex items-center justify-center text-[10px] text-slate-500">无图</div>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-bold text-slate-300">根原图说明</span>
                  <button
                    type="button"
                    class="p-1 rounded text-slate-400 hover:text-studio-cyan hover:bg-studio-800 transition-colors cursor-pointer"
                    :title="rereading ? '正在重读材质与结构...' : '重新阅读基图'"
                    :disabled="rereading"
                    @click="handleReread"
                  >
                    <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': rereading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"></path>
                    </svg>
                  </button>
                </div>
                <!-- 可编辑说明 -->
                <div v-if="editingSummary" class="mt-1 flex items-center gap-1">
                  <input
                    ref="summaryInput"
                    v-model="summaryDraft"
                    class="w-full text-[11px] px-1.5 py-0.5 rounded bg-studio-850 border border-studio-accent text-slate-100 outline-none"
                    @blur="saveSummary"
                    @keydown.enter="saveSummary"
                  />
                </div>
                <div
                  v-else
                  class="mt-1 text-[11px] text-slate-400 leading-snug line-clamp-2 cursor-pointer hover:text-slate-200 transition-colors"
                  title="点击手改基图说明"
                  @click="startEditSummary"
                >
                  {{ reading?.reading_summary || '未填写基图说明（点击添加）' }}
                </div>
              </div>
            </div>
          </div>

          <!-- 2. 风格切换胶囊 (按最近活跃时间倒序) -->
          <div class="p-2.5 border-b border-studio-800">
            <div class="text-[10px] font-bold text-slate-400 mb-1.5">生成风格</div>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="st in visibleStyles"
                :key="st.style"
                type="button"
                class="px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer truncate max-w-full"
                :class="selectedStyle === st.style ? 'bg-studio-accent text-white shadow-sm font-semibold' : 'bg-studio-850 text-slate-400 hover:text-slate-200 hover:bg-studio-800'"
                @click="switchStyle(st.style)"
              >
                {{ st.style || '方案风格' }}
              </button>
            </div>
          </div>

          <!-- 3. 空间静帧列表 (按固定居住动线排序) -->
          <div class="flex-1 overflow-y-auto min-h-0 p-2 space-y-1">
            <div class="px-2 pt-1 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>空间静帧方案</span>
              <span class="text-[9px] text-slate-500 font-normal">动线排序</span>
            </div>

            <template v-if="currentStyleGroup?.spaces?.length">
              <button
                v-for="sp in currentStyleGroup.spaces"
                :key="sp.space"
                type="button"
                class="w-full px-2 py-1.5 rounded-xl flex items-center gap-2.5 transition-all text-left cursor-pointer group"
                :class="selectedKind === 'space' && selectedSpaceName === sp.space ? 'bg-studio-800 text-white border border-studio-700/80 shadow-sm' : 'text-slate-300 hover:bg-studio-850'"
                @click="selectSpace(sp.space)"
              >
                <div class="w-9 h-9 rounded-lg bg-black/40 border border-studio-700/60 overflow-hidden shrink-0">
                  <img v-if="coverThumbOf(sp.cover)" :src="coverThumbOf(sp.cover)" class="w-full h-full object-cover" />
                  <div v-else class="w-full h-full flex items-center justify-center text-[9px] text-slate-600">无</div>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-semibold truncate">{{ sp.space || '未填写' }}</span>
                    <span class="text-[10px] px-1.5 py-0.2 rounded bg-studio-900 border border-studio-750 text-slate-400">
                      {{ sp.step_count }}步
                    </span>
                  </div>
                </div>
              </button>
            </template>
            <div v-else class="px-3 py-4 text-center text-xs text-slate-500">
              当前风格暂无静帧房间
            </div>

            <!-- 4. 空间视频列表 (单图导览 + 双图转场) -->
            <div class="px-2 pt-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              空间视频
            </div>
            <template v-if="currentStyleGroup?.videos?.length">
              <button
                v-for="vid in currentStyleGroup.videos"
                :key="vid.id"
                type="button"
                class="w-full px-2 py-1.5 rounded-xl flex items-center gap-2.5 transition-all text-left cursor-pointer group"
                :class="selectedKind === 'video' && selectedVideoId === vid.id ? 'bg-studio-800 text-white border border-studio-700/80 shadow-sm' : 'text-slate-300 hover:bg-studio-850'"
                @click="selectVideo(vid.id)"
              >
                <div class="w-9 h-9 rounded-lg bg-black/40 border border-studio-700/60 overflow-hidden shrink-0 flex items-center justify-center text-indigo-400">
                  <img v-if="videoPosterOf(vid)" :src="videoPosterOf(vid)" class="w-full h-full object-cover" />
                  <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-semibold truncate">{{ videoTitleOf(vid) }}</div>
                  <div class="text-[10px] text-slate-400 flex items-center gap-1">
                    <span>{{ vid.video_mode === 'room_transition' ? '跨房转场' : '单图导览' }}</span>
                  </div>
                </div>
              </button>
            </template>
            <div v-else class="px-3 py-2 text-center text-xs text-slate-500">
              当前风格暂无生成视频
            </div>
          </div>

          <!-- 5. 底部出口 -->
          <div class="p-3 border-t border-studio-800 bg-studio-950/80">
            <button
              type="button"
              class="w-full py-2 px-3 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-200 border border-studio-700 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              @click="jumpToCreateNew"
            >
              <svg class="w-3.5 h-3.5 text-studio-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14"></path>
              </svg>
              <span>去对话台铺新风格 / 拍视频</span>
            </button>

            <!-- 导出当前风格全屋方案活体包 -->
            <button
              type="button"
              class="w-full py-2 px-3 rounded-xl bg-studio-850 hover:bg-studio-800 text-studio-cyan border border-studio-750 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs mt-2"
              title="导出当前风格全套方案、提示词配方与渲染图 (.zip)"
              @click="handleExportCurrentStylePackage"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"></path>
              </svg>
              <span>导出「{{ selectedStyle || '当前' }}」全套方案包</span>
            </button>
          </div>
        </div>

        <!-- 右栏：选中项的输入输出对照与时间轴 -->
        <div class="flex-1 flex flex-col min-w-0 overflow-hidden bg-studio-900/40">
          
          <!-- 情况 A：选中空间静帧 -->
          <template v-if="selectedKind === 'space' && currentSpaceObj">
            
            <!-- 顶部对照与复用区 -->
            <div class="p-4 border-b border-studio-800 bg-studio-950/40 shrink-0">
              <div class="flex items-start justify-between gap-6">
                <!-- 左侧：输入图 → 当前封面输出图并排 -->
                <div class="flex items-center gap-3">
                  <div class="flex flex-col items-center gap-1">
                    <span class="text-[10px] font-medium text-slate-400">输入原图</span>
                    <div class="w-24 h-24 rounded-xl bg-black/40 border border-studio-750 overflow-hidden cursor-pointer" @click="openLightbox([currentCoverInputUrl], 0)">
                      <img v-if="currentCoverInputUrl" :src="currentCoverInputUrl" class="w-full h-full object-cover" />
                      <div v-else class="w-full h-full flex items-center justify-center text-[10px] text-slate-600">无输入图</div>
                    </div>
                  </div>

                  <div class="text-slate-600 flex items-center">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M5 12h14M12 5l7 7-7 7"></path>
                    </svg>
                  </div>

                  <div class="flex flex-col items-center gap-1">
                    <div class="flex items-center gap-1.5">
                      <span class="text-[10px] font-medium text-slate-400">当前方案封面</span>
                      <span class="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold">封面</span>
                    </div>
                    <div class="w-24 h-24 rounded-xl bg-black/40 border border-amber-400/80 overflow-hidden shadow-sm shadow-amber-500/10 cursor-pointer" @click="openLightbox([currentCoverOutputUrl], 0)">
                      <img v-if="currentCoverOutputUrl" :src="currentCoverOutputUrl" class="w-full h-full object-cover" />
                      <div v-else class="w-full h-full flex items-center justify-center text-[10px] text-slate-600">无输出图</div>
                    </div>
                  </div>
                </div>

                <!-- 右侧：手改标签下拉 + 3个复用动作 -->
                <div class="flex flex-col items-end gap-3 min-w-[280px]">
                  <!-- 标签选择与手改 -->
                  <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1 text-xs">
                      <span class="text-slate-400">空间:</span>
                      <select
                        :value="currentSpaceObj.cover?.space || ''"
                        class="px-2 py-1 rounded-lg bg-studio-850 border border-studio-700 text-xs text-slate-200 outline-none cursor-pointer"
                        @change="handleUpdateCoverMeta('space', $event.target.value)"
                      >
                        <option value="未填写">未填写</option>
                        <option v-for="sp in canonicalSpaceList" :key="sp" :value="sp">{{ sp }}</option>
                      </select>
                    </div>

                    <div class="flex items-center gap-1 text-xs">
                      <span class="text-slate-400">风格:</span>
                      <select
                        :value="currentSpaceObj.cover?.style || ''"
                        class="px-2 py-1 rounded-lg bg-studio-850 border border-studio-700 text-xs text-slate-200 outline-none cursor-pointer"
                        @change="handleUpdateCoverMeta('style', $event.target.value)"
                      >
                        <option value="未填写">未填写</option>
                        <option v-for="st in canonicalStyleList" :key="st" :value="st">{{ st }}</option>
                      </select>
                    </div>
                  </div>

                  <!-- 单一清晰的复用按钮（响应用户要求：保留一个按钮即可） -->
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="px-4 py-2 rounded-xl bg-studio-cyan text-studio-950 font-bold hover:brightness-110 transition-all text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
                      title="携带提示词与原图返回对话台复用创作"
                      @click="handleReuseToChat('refine')"
                    >
                      <span class="text-sm">🚀</span>
                      <span>带回对话台复用</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 核心：多户型落地实证案例横向并排 (同方案在不同基图上的产物) -->
            <div v-if="allInstancesOfCurrentSpace.length > 1" class="px-4 py-2.5 border-b border-studio-800 bg-studio-950/30 shrink-0">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-slate-200">多户型落地案例并排</span>
                  <span class="text-[10px] px-2 py-0.2 rounded-full bg-studio-cyan/15 text-studio-cyan border border-studio-cyan/30 font-semibold">
                    已验证 {{ distinctRootCountForCurrentSpace }} 个户型 · {{ allInstancesOfCurrentSpace.length }} 个落地实例
                  </span>
                </div>
                <span class="text-[10px] text-slate-500">点击设为封面，或点击产物进入大图对比</span>
              </div>

              <!-- 横向并排滑动栏 -->
              <div class="flex items-center gap-3 overflow-x-auto pb-1.5 scrollbar-thin">
                <div
                  v-for="(inst, iIdx) in allInstancesOfCurrentSpace"
                  :key="inst.id"
                  class="shrink-0 p-2 rounded-xl border transition-all flex flex-col gap-1.5 bg-studio-900/80 w-44"
                  :class="inst.is_cover ? 'border-amber-400/80 shadow-xs shadow-amber-500/20' : 'border-studio-750 hover:border-studio-650'"
                >
                  <!-- 输入原图 → 输出产物小对比 -->
                  <div class="relative w-full aspect-video rounded-lg overflow-hidden bg-black/50 cursor-pointer" @click="openLightbox([firstResultUrl(inst)], 0)">
                    <img :src="firstResultUrl(inst)" class="w-full h-full object-cover" />
                    <!-- 左上角小基图 -->
                    <div v-if="firstInputUrl(inst)" class="absolute top-1 left-1 w-6 h-6 rounded bg-black/80 border border-white/20 overflow-hidden">
                      <img :src="firstInputUrl(inst)" class="w-full h-full object-cover" />
                    </div>
                    <!-- 封面印章 -->
                    <span v-if="inst.is_cover" class="absolute top-1 right-1 px-1.5 py-0.2 rounded bg-amber-500 text-black text-[9px] font-extrabold">
                      封面
                    </span>
                  </div>

                  <div class="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
                    <span>案例 {{ iIdx + 1 }}</span>
                    <span>{{ formatStepTime(inst.updated_at) }}</span>
                  </div>

                  <button
                    v-if="!inst.is_cover"
                    type="button"
                    class="w-full py-0.5 rounded bg-studio-800 hover:bg-amber-500/20 hover:text-amber-300 text-slate-300 text-[10px] font-medium border border-studio-700 transition-all cursor-pointer text-center"
                    @click="handleSetCover(inst.id)"
                  >
                    设为本方案代表
                  </button>
                  <div v-else class="text-center text-[10px] text-amber-300 font-bold py-0.5">
                    ★ 官方宣传封面
                  </div>
                </div>
              </div>
            </div>

            <!-- 下方纵向时间轴 (全部展开、按时间从新到旧) -->
            <div class="flex-1 overflow-y-auto p-4 space-y-4">
              <div
                v-for="(node, nIdx) in groupedTimelineSteps"
                :key="node.promptHash || node.primaryStep?.id"
                class="rounded-xl border border-studio-800 bg-studio-950/60 p-4 space-y-3"
              >
                <!-- 头部：时间 · 操作 · 去向 + 设为封面 -->
                <div class="flex items-center justify-between text-xs">
                  <div class="flex items-center gap-2 text-slate-400">
                    <span class="font-medium text-slate-300">{{ formatStepTime(node.primaryStep?.updated_at) }}</span>
                    <span>·</span>
                    <span class="text-studio-cyan font-semibold">{{ node.primaryStep?.operation || '换空间' }}</span>
                    <span>·</span>
                    <span class="text-[11px] px-1.5 py-0.2 rounded bg-studio-850 border border-studio-750 text-slate-400">
                      {{ formatDestination(node.primaryStep) }}
                    </span>
                  </div>

                  <!-- 设为封面按钮 -->
                  <div class="flex items-center gap-2">
                    <button
                      v-if="node.primaryStep?.is_cover"
                      type="button"
                      class="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/50 text-[11px] font-bold flex items-center gap-1 cursor-default"
                    >
                      <svg class="w-3 h-3 fill-amber-300" viewBox="0 0 24 24">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                      </svg>
                      <span>当前封面</span>
                    </button>
                    <button
                      v-else
                      type="button"
                      class="px-2 py-0.5 rounded-lg bg-studio-800 hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-500/40 border border-studio-700 text-slate-400 text-[11px] font-medium transition-all cursor-pointer"
                      @click="handleSetCover(node.primaryStep?.id)"
                    >
                      设为封面
                    </button>
                  </div>
                </div>

                <!-- 提示词区：完整提示词 + Diff 高亮 + 复制词 -->
                <div class="relative rounded-lg bg-studio-900 border border-studio-800 p-2.5">
                  <div class="pr-6 text-xs text-slate-300 leading-relaxed break-words font-sans">
                    <!-- 若有上一步，做词级 Diff 高亮 -->
                    <template v-if="node.diffParts">
                      <span
                        v-for="(part, pIdx) in node.diffParts"
                        :key="pIdx"
                        :class="[
                          part.type === 'del' ? 'line-through text-red-400 bg-red-950/40 px-0.5 rounded mx-0.5' : '',
                          part.type === 'add' ? 'text-sky-300 bg-sky-950/50 px-0.5 rounded mx-0.5 font-medium' : '',
                          part.type === 'same' ? 'text-slate-300' : ''
                        ]"
                      >{{ part.text }}</span>
                    </template>
                    <template v-else>
                      {{ node.primaryStep?.prompt }}
                    </template>
                  </div>
                  <button
                    type="button"
                    class="absolute top-2 right-2 text-slate-500 hover:text-studio-cyan transition-colors cursor-pointer"
                    title="复制提示词"
                    @click="copyPrompt(node.primaryStep?.prompt)"
                  >
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                    </svg>
                  </button>
                </div>

                <!-- 输出图区：横向并排 -->
                <div class="flex flex-wrap items-center gap-3">
                  <!-- 情况 1：单次返回多张图（同一条记录多图并排，右上角整条删除） -->
                  <div
                    v-if="node.isSingleRecordMultiImages"
                    class="relative p-2 rounded-xl border border-studio-750 bg-studio-900 flex items-center gap-2 group"
                  >
                    <div
                      v-for="(img, idx) in node.primaryStep.result_images"
                      :key="idx"
                      class="w-24 h-24 rounded-lg bg-black/40 overflow-hidden border border-studio-700/60 cursor-pointer"
                      @click="openLightbox(resultUrlsOf(node.primaryStep), idx)"
                    >
                      <img :src="img.url || img.poster" class="w-full h-full object-cover" />
                    </div>
                    <button
                      type="button"
                      class="absolute top-1.5 right-1.5 p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all cursor-pointer opacity-0 group-hover:opacity-100"
                      title="整条删除本步"
                      @click="handleDeleteStep(node.primaryStep?.id)"
                    >
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                      </svg>
                    </button>
                  </div>

                  <!-- 情况 2：同词多次重生分别保存（多条记录在同一提示词节点下并排，每张独立操作） -->
                  <div
                    v-else
                    v-for="subStep in node.items"
                    :key="subStep.id"
                    class="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-studio-800 bg-studio-900 group"
                  >
                    <div
                      class="w-24 h-24 rounded-lg bg-black/40 overflow-hidden border border-studio-700/60 cursor-pointer"
                      @click="openLightbox([firstResultUrl(subStep)], 0)"
                    >
                      <img :src="firstResultUrl(subStep)" class="w-full h-full object-cover" />
                    </div>
                    <div class="flex items-center justify-between w-full px-1 text-[10px] text-slate-400">
                      <span>{{ formatStepTime(subStep.updated_at) }}</span>
                      <span class="text-[9px] text-slate-500">{{ formatDestination(subStep) }}</span>
                    </div>
                    <div class="flex items-center gap-1 w-full pt-0.5">
                      <button
                        type="button"
                        class="flex-1 py-0.5 rounded bg-studio-800 hover:bg-studio-700 text-slate-300 text-[10px] font-medium transition-colors cursor-pointer text-center"
                        title="携带这张图去生成视频"
                        @click="handleGoShootVideo(subStep)"
                      >
                        去拍视频
                      </button>
                      <button
                        type="button"
                        class="p-1 rounded bg-red-500/10 hover:bg-red-500/30 text-red-400 transition-colors cursor-pointer"
                        title="删除此项"
                        @click="handleDeleteStep(subStep.id)"
                      >
                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </template>

          <!-- 情况 B：选中空间视频 (复用同一右栏框架) -->
          <template v-else-if="selectedKind === 'video' && currentVideoObj">
            
            <!-- 顶部对照区 -->
            <div class="p-4 border-b border-studio-800 bg-studio-950/40 shrink-0">
              <div class="flex items-start justify-between gap-6">
                <!-- 左侧：输入静帧与极简视频播放器 -->
                <div class="flex items-center gap-4">
                  <!-- 输入静帧 (单图1张 / 双图2张可跳回房间) -->
                  <div class="flex flex-col gap-1">
                    <span class="text-[10px] font-medium text-slate-400">参考静帧</span>
                    <div class="flex items-center gap-1.5">
                      <template v-if="currentVideoObj.source_steps?.length">
                        <div
                          v-for="(srcStep, idx) in currentVideoObj.source_steps"
                          :key="srcStep.id"
                          class="w-16 h-16 rounded-lg bg-black/40 border border-studio-700 overflow-hidden cursor-pointer relative group"
                          :title="`点击定位到房间：${srcStep.space}`"
                          @click="selectSpace(srcStep.space)"
                        >
                          <img :src="firstResultUrl(srcStep)" class="w-full h-full object-cover" />
                          <span class="absolute bottom-0 inset-x-0 bg-black/75 text-[9px] text-center text-slate-200 truncate">
                            {{ idx === 0 ? '起点' : '终点' }}:{{ srcStep.space }}
                          </span>
                        </div>
                      </template>
                      <template v-else>
                        <div class="w-16 h-16 rounded-lg bg-black/40 border border-studio-700 overflow-hidden">
                          <img v-if="videoPosterOf(currentVideoObj)" :src="videoPosterOf(currentVideoObj)" class="w-full h-full object-cover" />
                        </div>
                      </template>
                    </div>
                  </div>

                  <!-- 极简视频预览播放器 -->
                  <div class="w-56 h-32 rounded-xl bg-black border border-studio-700 overflow-hidden relative flex items-center justify-center">
                    <video
                      ref="previewVideoEl"
                      :src="videoUrlOf(currentVideoObj)"
                      :poster="videoPosterOf(currentVideoObj)"
                      class="w-full h-full object-contain"
                      playsinline
                      controls
                    ></video>
                  </div>
                </div>

                <!-- 右侧：标签、带回对话改运镜主按钮、折叠入口 -->
                <div class="flex flex-col items-end gap-3 min-w-[260px]">
                  <div class="flex items-center gap-2 text-xs">
                    <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-semibold">
                      {{ currentVideoObj.video_mode === 'room_transition' ? '双图跨房转场' : '单图导览' }}
                    </span>
                    <span class="text-slate-400">{{ currentVideoObj.style || '未填写' }}</span>
                  </div>

                  <button
                    type="button"
                    class="px-4 py-2 rounded-xl bg-studio-cyan text-studio-950 font-bold hover:brightness-110 transition-all text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
                    title="带回对话台继续调整运镜词"
                    @click="handleReuseVideoToChat"
                  >
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    <span>带回对话改运镜</span>
                  </button>

                  <!-- 折叠入口：查看两端生图词 -->
                  <div class="w-full pt-1">
                    <button
                      type="button"
                      class="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                      @click="showEndpointsPrompts = !showEndpointsPrompts"
                    >
                      <span>查看两端生图词</span>
                      <svg class="w-3 h-3 transition-transform" :class="{ 'rotate-180': showEndpointsPrompts }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </button>
                    <div v-if="showEndpointsPrompts" class="mt-2 p-2 rounded-lg bg-studio-950 border border-studio-800 text-[11px] text-slate-300 space-y-2 max-h-36 overflow-y-auto">
                      <div v-for="(srcStep, idx) in currentVideoObj.source_steps" :key="srcStep.id">
                        <span class="font-bold text-slate-400">{{ idx === 0 ? '【起点' : '【终点' }} {{ srcStep.space }}】:</span>
                        <p class="text-slate-300 mt-0.5 leading-relaxed">{{ srcStep.prompt }}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 核心：多户型落地实证案例横向并排 (同方案在不同基图上的产物) -->
            <div v-if="allInstancesOfCurrentSpace.length > 1" class="px-4 py-2.5 border-b border-studio-800 bg-studio-950/30 shrink-0">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-slate-200">多户型落地案例并排</span>
                  <span class="text-[10px] px-2 py-0.2 rounded-full bg-studio-cyan/15 text-studio-cyan border border-studio-cyan/30 font-semibold">
                    已验证 {{ distinctRootCountForCurrentSpace }} 个户型 · {{ allInstancesOfCurrentSpace.length }} 个落地实例
                  </span>
                </div>
                <span class="text-[10px] text-slate-500">点击设为封面，或点击产物进入大图对比</span>
              </div>

              <!-- 横向并排滑动栏 -->
              <div class="flex items-center gap-3 overflow-x-auto pb-1.5 scrollbar-thin">
                <div
                  v-for="(inst, iIdx) in allInstancesOfCurrentSpace"
                  :key="inst.id"
                  class="shrink-0 p-2 rounded-xl border transition-all flex flex-col gap-1.5 bg-studio-900/80 w-44"
                  :class="inst.is_cover ? 'border-amber-400/80 shadow-xs shadow-amber-500/20' : 'border-studio-750 hover:border-studio-650'"
                >
                  <!-- 输入原图 → 输出产物小对比 -->
                  <div class="relative w-full aspect-video rounded-lg overflow-hidden bg-black/50 cursor-pointer" @click="openLightbox([firstResultUrl(inst)], 0)">
                    <img :src="firstResultUrl(inst)" class="w-full h-full object-cover" />
                    <!-- 左上角小基图 -->
                    <div v-if="firstInputUrl(inst)" class="absolute top-1 left-1 w-6 h-6 rounded bg-black/80 border border-white/20 overflow-hidden">
                      <img :src="firstInputUrl(inst)" class="w-full h-full object-cover" />
                    </div>
                    <!-- 封面印章 -->
                    <span v-if="inst.is_cover" class="absolute top-1 right-1 px-1.5 py-0.2 rounded bg-amber-500 text-black text-[9px] font-extrabold">
                      封面
                    </span>
                  </div>

                  <div class="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
                    <span>案例 {{ iIdx + 1 }}</span>
                    <span>{{ formatStepTime(inst.updated_at) }}</span>
                  </div>

                  <button
                    v-if="!inst.is_cover"
                    type="button"
                    class="w-full py-0.5 rounded bg-studio-800 hover:bg-amber-500/20 hover:text-amber-300 text-slate-300 text-[10px] font-medium border border-studio-700 transition-all cursor-pointer text-center"
                    @click="handleSetCover(inst.id)"
                  >
                    设为本方案代表
                  </button>
                  <div v-else class="text-center text-[10px] text-amber-300 font-bold py-0.5">
                    ★ 官方宣传封面
                  </div>
                </div>
              </div>
            </div>

            <!-- 下方运镜时间轴 -->
            <div class="flex-1 overflow-y-auto p-4 space-y-4">
              <div class="rounded-xl border border-studio-800 bg-studio-950/60 p-4 space-y-3">
                <div class="flex items-center justify-between text-xs">
                  <div class="flex items-center gap-2 text-slate-400">
                    <span class="font-medium text-slate-300">{{ formatStepTime(currentVideoObj.updated_at) }}</span>
                    <span>·</span>
                    <span class="text-indigo-400 font-semibold">运镜生成</span>
                    <span>·</span>
                    <span class="text-[11px] px-1.5 py-0.2 rounded bg-studio-850 border border-studio-750 text-slate-400">
                      {{ formatDestination(currentVideoObj) }}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="p-1.5 rounded text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
                    title="软删本视频"
                    @click="handleDeleteStep(currentVideoObj.id)"
                  >
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                    </svg>
                  </button>
                </div>

                <div class="relative rounded-lg bg-studio-900 border border-studio-800 p-2.5">
                  <div class="pr-6 text-xs text-slate-300 leading-relaxed break-words font-sans">
                    {{ currentVideoObj.prompt }}
                  </div>
                  <button
                    type="button"
                    class="absolute top-2 right-2 text-slate-500 hover:text-studio-cyan transition-colors cursor-pointer"
                    title="复制运镜词"
                    @click="copyPrompt(currentVideoObj.prompt)"
                  >
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>

          </template>

          <div v-else class="flex-1 flex items-center justify-center text-xs text-slate-500">
            请从左侧选择一个空间静帧或空间视频
          </div>

        </div>

      </div>

    </div>

    <!-- 大图对比灯箱 (同组横向并排图支持左右切换) -->
    <div
      v-if="lightboxVisible"
      class="fixed inset-0 z-60 bg-black/90 flex flex-col items-center justify-center p-4 animate-in fade-in duration-100"
      @click.self="lightboxVisible = false"
    >
      <button
        type="button"
        class="absolute top-4 right-4 text-white hover:text-studio-cyan p-2 text-2xl font-mono cursor-pointer"
        @click="lightboxVisible = false"
      >
        ✕
      </button>

      <div class="relative max-w-[90vw] max-h-[85vh] flex items-center justify-center">
        <img :src="lightboxImages[lightboxIndex]" class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
        
        <!-- 上一张/下一张 -->
        <button
          v-if="lightboxImages.length > 1"
          type="button"
          class="absolute left-[-50px] p-2 rounded-full bg-studio-900/80 text-white hover:bg-studio-800 cursor-pointer"
          @click.stop="lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length"
        >
          ◀
        </button>
        <button
          v-if="lightboxImages.length > 1"
          type="button"
          class="absolute right-[-50px] p-2 rounded-full bg-studio-900/80 text-white hover:bg-studio-800 cursor-pointer"
          @click.stop="lightboxIndex = (lightboxIndex + 1) % lightboxImages.length"
        >
          ▶
        </button>
      </div>

      <div v-if="lightboxImages.length > 1" class="mt-3 text-xs text-slate-400 font-mono">
        {{ lightboxIndex + 1 }} / {{ lightboxImages.length }}
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import {
  fetchCreationGroup,
  setCreationCover,
  rereadImageReading,
  patchImageReading,
  patchCreationTemplate,
  deleteCreationTemplate,
  downloadSchemePackage
} from '../../api';
import { computeWordDiff } from '../../utils/diff-words';

const props = defineProps({
  rootHash: { type: String, required: true },
  initialStyle: { type: String, default: '' },
  initialItemId: { type: String, default: '' }
});

const emit = defineEmits(['close', 'jump-to-chat']);

const loading = ref(true);
const rereading = ref(false);
const groupData = ref({ styles: [] });
const reading = ref(null);
const currentRootHash = ref(props.rootHash);

const selectedStyle = ref('');
const selectedKind = ref('space'); // 'space' | 'video'
const selectedSpaceName = ref('');
const selectedVideoId = ref('');
const showEndpointsPrompts = ref(false);

const editingSummary = ref(false);
const summaryDraft = ref('');
const summaryInput = ref(null);

// 灯箱状态
const lightboxVisible = ref(false);
const lightboxImages = ref([]);
const lightboxIndex = ref(0);

const canonicalSpaceList = ['门厅', '客厅', '餐厅', '厨房', '卧室', '衣帽间', '卫浴', '书房', '阳台露台', '茶空间', '飘窗', '庭院', '其他'];
const canonicalStyleList = [
  '侘寂', '宋式美学', '新中式', '古典中式', '法式', '意式', '托斯卡纳', '地中海',
  '现代极简', '奶油风', '工业风', '中古风', '现代美式', '美式乡村', '南洋度假',
  '自然原木风', '深色原木风', '自然复古原木风', '深色复古原木风', '法式轻奢', '其他风格'
];

const visibleStyles = computed(() => {
  const all = groupData.value.styles || [];
  const valid = all.filter(s => s.style && s.style !== '未填写' && s.style !== '未填写风格');
  return valid.length > 0 ? valid : all;
});

async function loadData() {
  loading.value = true;
  try {
    const res = await fetchCreationGroup(currentRootHash.value);
    if (res.success && res.data) {
      groupData.value = res.data;
      reading.value = res.data.reading || {};
      
      // 默认选中风格 (优先有效风格)
      const availableStyles = visibleStyles.value;
      if (availableStyles.length > 0) {
        if (props.initialStyle && availableStyles.some(s => s.style === props.initialStyle)) {
          selectedStyle.value = props.initialStyle;
        } else {
          selectedStyle.value = availableStyles[0].style;
        }
      }

      // 默认选中空间或视频
      autoSelectDefaultItem();
    }
  } catch (err) {
    console.error('[CreationDetailDrawer] 加载失败:', err);
  } finally {
    loading.value = false;
  }
}

const currentStyleGroup = computed(() => {
  const list = visibleStyles.value;
  return list.find(s => s.style === selectedStyle.value) || list[0] || null;
});

const currentSpaceObj = computed(() => {
  if (selectedKind.value !== 'space') return null;
  return currentStyleGroup.value?.spaces?.find(sp => sp.space === selectedSpaceName.value) || null;
});

const currentVideoObj = computed(() => {
  if (selectedKind.value !== 'video') return null;
  return currentStyleGroup.value?.videos?.find(v => v.id === selectedVideoId.value) || null;
});

const rootImageThumbnail = computed(() => {
  const firstSpace = groupData.value.styles?.[0]?.spaces?.[0];
  const firstCover = firstSpace?.cover;
  if (firstCover) {
    return firstOriginUrl(firstCover);
  }
  return '';
});

const currentCoverInputUrl = computed(() => {
  if (!currentSpaceObj.value?.cover) return '';
  return firstOriginUrl(currentSpaceObj.value.cover);
});

const currentCoverOutputUrl = computed(() => {
  if (!currentSpaceObj.value?.cover) return '';
  return firstResultUrl(currentSpaceObj.value.cover);
});

// 当前空间下的所有落地实例
const allInstancesOfCurrentSpace = computed(() => {
  const steps = currentSpaceObj.value?.steps || [];
  return [...steps].sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
});

const distinctRootCountForCurrentSpace = computed(() => {
  const set = new Set(allInstancesOfCurrentSpace.value.map(s => s.root_origin_hash).filter(Boolean));
  return Math.max(set.size, 1);
});

function firstInputUrl(step) {
  return firstOriginUrl(step);
}

async function handleExportCurrentStylePackage() {
  try {
    await downloadSchemePackage({ style: selectedStyle.value });
  } catch (err) {
    alert('导出方案包失败: ' + (err?.message || '异常'));
  }
}

// 计算纵向时间轴步骤，按 prompt_hash 聚合横向并排，并计算相邻两步 Diff
const groupedTimelineSteps = computed(() => {
  const steps = currentSpaceObj.value?.steps || [];
  if (!steps.length) return [];

  // 按时间从新到旧
  const sorted = [...steps].sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));

  // 聚合相同 prompt_hash
  const grouped = [];
  for (const step of sorted) {
    const pHash = step.prompt_hash || step.prompt;
    const last = grouped[grouped.length - 1];
    if (last && (last.promptHash === pHash)) {
      last.items.push(step);
    } else {
      grouped.push({
        promptHash: pHash,
        primaryStep: step,
        isSingleRecordMultiImages: (step.result_images?.length > 1),
        items: [step],
        diffParts: null
      });
    }
  }

  // 逐级计算 Diff：当前步与上一步（即时间更早的一步）
  for (let i = 0; i < grouped.length; i++) {
    const curText = grouped[i].primaryStep?.prompt || '';
    const olderNode = grouped[i + 1];
    if (olderNode) {
      const olderText = olderNode.primaryStep?.prompt || '';
      grouped[i].diffParts = computeWordDiff(olderText, curText);
    }
  }

  return grouped;
});

function autoSelectDefaultItem() {
  const curSt = currentStyleGroup.value;
  if (!curSt) return;

  if (props.initialItemId) {
    // 检查是否是视频
    const vid = curSt.videos?.find(v => v.id === props.initialItemId);
    if (vid) {
      selectedKind.value = 'video';
      selectedVideoId.value = vid.id;
      return;
    }
    // 检查属于哪个房间
    const sp = curSt.spaces?.find(s => s.steps.some(st => st.id === props.initialItemId));
    if (sp) {
      selectedKind.value = 'space';
      selectedSpaceName.value = sp.space;
      return;
    }
  }

  if (curSt.spaces?.length) {
    selectedKind.value = 'space';
    selectedSpaceName.value = curSt.spaces[0].space;
  } else if (curSt.videos?.length) {
    selectedKind.value = 'video';
    selectedVideoId.value = curSt.videos[0].id;
  }
}

function switchStyle(st) {
  selectedStyle.value = st;
  autoSelectDefaultItem();
}

function selectSpace(spName) {
  selectedKind.value = 'space';
  selectedSpaceName.value = spName;
}

function selectVideo(vidId) {
  selectedKind.value = 'video';
  selectedVideoId.value = vidId;
}

function firstOriginUrl(item) {
  if (!item) return '';
  const list = item.origin_images || [];
  const first = list[0];
  if (typeof first === 'string') return first;
  return first?.url || '';
}

function firstResultUrl(item) {
  if (!item) return '';
  const list = item.result_images || [];
  const first = list[0];
  if (typeof first === 'string') return first;
  if (item.type === 'video') {
    return first?.poster || first?.url || '';
  }
  return first?.url || first?.poster || '';
}

function resultUrlsOf(item) {
  if (!item || !Array.isArray(item.result_images)) return [];
  return item.result_images.map(x => typeof x === 'string' ? x : (x.url || x.poster || '')).filter(Boolean);
}

function coverThumbOf(item) {
  return firstResultUrl(item);
}

function videoPosterOf(item) {
  if (!item) return '';
  const res0 = item.result_images?.[0];
  return res0?.poster || res0?.url || '';
}

function videoUrlOf(item) {
  if (!item) return '';
  const res0 = item.result_images?.[0];
  return res0?.url || '';
}

function videoTitleOf(item) {
  if (item.title) return item.title;
  if (item.video_mode === 'room_transition') {
    const srcSteps = item.source_steps || [];
    if (srcSteps.length >= 2) {
      return `${srcSteps[0].space || '起点'} → ${srcSteps[1].space || '终点'}`;
    }
    return '跨房转场';
  }
  return '空间单图导览';
}

function formatStepTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (isToday) return `今天 ${timeStr}`;
  return `${d.getMonth() + 1}-${d.getDate()} ${timeStr}`;
}

function formatDestination(step) {
  const inC = Number(step?.in_creation_lib !== undefined ? step.in_creation_lib : 1);
  const inM = Number(step?.in_material_lib || 0);
  if (inC && inM) return '两边都在';
  if (inC) return '只在创作库';
  if (inM) return '只在素材库';
  return '未入库';
}

async function handleSetCover(stepId) {
  if (!stepId) return;
  try {
    const res = await setCreationCover(stepId, 1);
    if (res.success) {
      // 重新加载刷新该基图状态
      await loadData();
    }
  } catch (err) {
    console.error('设为封面失败:', err);
  }
}

async function handleUpdateCoverMeta(key, value) {
  const coverId = currentSpaceObj.value?.cover?.id;
  if (!coverId) return;
  try {
    await patchCreationTemplate(coverId, { [key]: value });
    await loadData();
  } catch (err) {
    console.error('修改标签失败:', err);
  }
}

async function handleDeleteStep(stepId) {
  if (!stepId) return;
  if (!confirm('确定将该步骤移入回收站吗？')) return;
  try {
    await deleteCreationTemplate(stepId);
    await loadData();
  } catch (err) {
    console.error('删除步骤失败:', err);
  }
}

function copyPrompt(text) {
  if (!text) return;
  navigator.clipboard.writeText(text);
  alert('提示词已复制到剪贴板');
}

function openLightbox(imgs, idx = 0) {
  if (!imgs || !imgs.length) return;
  lightboxImages.value = imgs;
  lightboxIndex.value = idx;
  lightboxVisible.value = true;
}

function startEditSummary() {
  summaryDraft.value = reading.value?.reading_summary || '';
  editingSummary.value = true;
  nextTick(() => {
    summaryInput.value?.focus();
  });
}

async function saveSummary() {
  editingSummary.value = false;
  const val = summaryDraft.value.trim();
  if (val && val !== reading.value?.reading_summary) {
    try {
      const res = await patchImageReading(currentRootHash.value, { reading_summary: val });
      if (res.success && res.data) {
        reading.value.reading_summary = res.data.reading_summary;
      }
    } catch (err) {
      console.error('保存基图说明失败:', err);
    }
  }
}

async function handleReread() {
  if (rereading.value) return;
  rereading.value = true;
  try {
    const res = await rereadImageReading(currentRootHash.value);
    if (res.success && res.data) {
      reading.value = res.data;
    }
  } catch (err) {
    console.error('重读基图失败:', err);
  } finally {
    rereading.value = false;
  }
}

// 复用到对话台
function handleReuseToChat(actionType) {
  const cover = currentSpaceObj.value?.cover;
  if (!cover) return;
  emit('close');
  emit('jump-to-chat', {
    action: actionType, // 'refine' | 'regenerate' | 'apply_new'
    prompt: cover.prompt || '',
    rootOriginHash: currentRootHash.value,
    style: selectedStyle.value,
    space: selectedSpaceName.value,
    originImage: cover.origin_images?.[0] || null
  });
}

function handleReuseVideoToChat() {
  const vid = currentVideoObj.value;
  if (!vid) return;
  emit('close');
  emit('jump-to-chat', {
    action: 'refine_video',
    prompt: vid.prompt || '',
    rootOriginHash: currentRootHash.value,
    style: selectedStyle.value,
    videoMode: vid.video_mode,
    sourceStepIds: vid.source_step_ids || []
  });
}

function handleGoShootVideo(step) {
  emit('close');
  emit('jump-to-chat', {
    action: 'shoot_video',
    rootOriginHash: currentRootHash.value,
    style: selectedStyle.value,
    space: selectedSpaceName.value,
    sourceStep: step
  });
}

function jumpToCreateNew() {
  emit('close');
  emit('jump-to-chat', {
    action: 'new_scheme',
    rootOriginHash: currentRootHash.value,
    style: selectedStyle.value
  });
}

onMounted(() => {
  loadData();
});
</script>
