<template>
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden bg-studio-950 font-sans text-slate-100">
    
    <!-- ========================================================================= -->
    <!-- 顶部导航栏 (完全参照素材库设计风格：双层清晰布局、留白合理、质感统一) -->
    <!-- ========================================================================= -->
    <header class="border-b border-studio-800 bg-studio-900/90 backdrop-blur shrink-0 z-10 flex flex-col">
      
      <!-- 第 1 行：核心大板块模式切换 + 风格快捷筛选胶囊条 + 右侧功能按钮 -->
      <div class="h-12 px-4 flex items-center justify-between gap-3 border-b border-studio-800/60">
        
        <!-- 左侧：工作流模式切换 (生图板块 vs 生视频板块 vs 户型归集) -->
        <div class="flex items-center gap-1 p-0.5 rounded-xl bg-studio-950/80 border border-studio-800 text-xs shrink-0">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg transition-all cursor-pointer font-semibold flex items-center gap-1.5"
            :class="mainViewMode === 'guide' ? 'bg-studio-accent text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'"
            @click="setMainViewMode('guide')"
          >
            <span>🖼️ 空间静帧生图</span>
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg transition-all cursor-pointer font-semibold flex items-center gap-1.5"
            :class="mainViewMode === 'trajectory' ? 'bg-studio-accent text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'"
            @click="setMainViewMode('trajectory')"
          >
            <span>🎬 空间走向生视频</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded-full bg-black/40 text-slate-300">{{ videoCards.length }}</span>
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg transition-all cursor-pointer font-semibold flex items-center gap-1.5"
            :class="mainViewMode === 'root' ? 'bg-studio-accent text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'"
            @click="setMainViewMode('root')"
          >
            <span>🏘️ 户型基图归集</span>
          </button>
        </div>

        <!-- 中间：风格切换胶囊条 (横向平滑滚动，精选真实风格，彻底杜绝孤立的“未填写”) -->
        <div v-if="mainViewMode === 'guide'" class="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1 mx-2 min-w-0">
          <button
            type="button"
            class="px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer shrink-0 border"
            :class="selectedStyle === 'all' ? 'bg-studio-800 border-studio-600 text-white shadow-xs' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-studio-850'"
            @click="selectedStyle = 'all'"
          >
            全部风格全景
          </button>
          <button
            v-for="st in availableRealStyles"
            :key="st.name"
            type="button"
            class="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer shrink-0 flex items-center gap-1.5 border"
            :class="selectedStyle === st.name ? 'bg-studio-accent/20 border-studio-accent text-studio-cyan font-bold shadow-xs' : 'border-studio-800 bg-studio-950/60 text-slate-300 hover:text-white hover:border-studio-700'"
            @click="selectedStyle = st.name"
          >
            <span>{{ st.name }}</span>
            <span class="text-[10px] font-mono opacity-70">({{ st.count }})</span>
          </button>
        </div>

        <!-- 当处于生视频走向大盘模式时：多空间 vs 单空间子视图切换 (满足用户需求第5点) -->
        <div v-else-if="mainViewMode === 'trajectory'" class="flex-1 flex items-center gap-2 mx-2 min-w-0">
          <div class="flex items-center gap-1 p-0.5 rounded-lg bg-studio-950/80 border border-studio-800 text-xs shrink-0">
            <button
              type="button"
              class="px-3 py-1 rounded-md transition-all cursor-pointer font-semibold flex items-center gap-1.5"
              :class="videoSubView === 'multi' ? 'bg-studio-cyan text-studio-950 font-bold shadow-xs' : 'text-slate-400 hover:text-slate-200'"
              @click="videoSubView = 'multi'"
            >
              <span>🔄 多空间 (跨空间转场)</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded-full" :class="videoSubView === 'multi' ? 'bg-studio-950/40 text-studio-950' : 'bg-black/40 text-slate-400'">
                {{ multiSpaceTrajectoryGroups.reduce((acc, g) => acc + g.cards.length, 0) }}
              </span>
            </button>
            <button
              type="button"
              class="px-3 py-1 rounded-md transition-all cursor-pointer font-semibold flex items-center gap-1.5"
              :class="videoSubView === 'single' ? 'bg-studio-cyan text-studio-950 font-bold shadow-xs' : 'text-slate-400 hover:text-slate-200'"
              @click="videoSubView = 'single'"
            >
              <span>🎥 单空间 (单空间导览)</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded-full" :class="videoSubView === 'single' ? 'bg-studio-950/40 text-studio-950' : 'bg-black/40 text-slate-400'">
                {{ singleSpaceTrajectoryGroups.reduce((acc, g) => acc + g.cards.length, 0) }}
              </span>
            </button>
          </div>
          <span class="text-[11px] text-slate-400 hidden xl:inline truncate">
            {{ videoSubView === 'multi' ? '展示已有门厅-客厅、卫生间-卧室等跨空间转场视频' : '展示客厅、卧室、门厅等单房间内的导览漫游视频' }}
          </span>
        </div>

        <div v-else class="flex-1"></div>

        <!-- 右侧功能区：AI 智能打标 + 导出全案 + 星标 + 回收站 -->
        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            class="h-8 px-2.5 rounded-lg bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-700/60 text-indigo-200 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
            :title="autoTagging ? '正在调用 AI 视觉大模型深度识别...' : '使用 AI 智能提取空间走向与风格标签'"
            :disabled="autoTagging"
            @click="handleRunAiAutoTag"
          >
            <svg class="w-3.5 h-3.5 text-indigo-400" :class="{ 'animate-spin': autoTagging }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
            </svg>
            <span>{{ autoTagging ? '识别中...' : '✨ AI 打标' }}</span>
          </button>

          <button
            type="button"
            class="h-8 px-2.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-200 hover:text-studio-cyan text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
            title="导出当前选中的方案包 (.zip)"
            @click="handleExportPackage"
          >
            <svg class="w-3.5 h-3.5 text-studio-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"></path>
            </svg>
            <span>导出方案包</span>
          </button>

          <button
            type="button"
            class="h-8 px-2.5 rounded-lg border text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer"
            :class="pinnedOnly ? 'bg-amber-500/15 border-amber-500/50 text-amber-300' : 'bg-studio-950/80 border-studio-800 text-slate-400 hover:text-slate-200'"
            title="只看星标作品"
            @click="togglePinnedOnly"
          >
            <svg class="w-3.5 h-3.5" :class="pinnedOnly ? 'fill-amber-300' : ''" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <span>星标</span>
          </button>

          <button
            type="button"
            class="h-8 px-2.5 rounded-lg bg-studio-950/80 border border-studio-800 hover:border-studio-700 text-slate-400 hover:text-slate-200 text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer"
            title="查看回收站"
            @click="openTrashModal"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
            </svg>
            <span>回收站</span>
          </button>
        </div>

      </div>

      <!-- 第 2 行：精细筛选与搜索栏 (完全参考素材库原生体验) -->
      <div class="h-10 px-4 flex items-center justify-between gap-3 text-xs">
        
        <div class="flex items-center gap-2.5 flex-1 min-w-0">
          <!-- 空间筛选 -->
          <div class="flex items-center gap-1.5">
            <span class="text-slate-400">空间:</span>
            <select
              v-model="filterSpace"
              class="h-7 px-2 text-xs rounded-lg bg-studio-950 border border-studio-750 text-slate-200 outline-none cursor-pointer"
              @change="fetchCards"
            >
              <option value="all">全部空间</option>
              <option v-for="sp in distinctSpaces" :key="sp" :value="sp">{{ sp }}</option>
            </select>
          </div>

          <!-- 时间筛选 -->
          <div class="flex items-center gap-1.5">
            <span class="text-slate-400">时间:</span>
            <select
              v-model="filterTime"
              class="h-7 px-2 text-xs rounded-lg bg-studio-950 border border-studio-750 text-slate-200 outline-none cursor-pointer"
              @change="fetchCards"
            >
              <option value="all">全部时间</option>
              <option value="today">今天</option>
              <option value="week">最近7天</option>
              <option value="month">最近30天</option>
            </select>
          </div>

          <!-- 搜索框 -->
          <div class="relative w-64">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索空间、风格、提示词或走向..."
              class="w-full h-7 pl-7 pr-2.5 text-xs rounded-lg bg-studio-950 border border-studio-750 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-studio-accent transition-all"
              @keydown.enter="handleSearch"
            />
            <svg class="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
        </div>

        <!-- 右侧统计信息 -->
        <div class="text-[11px] text-slate-400 font-mono flex items-center gap-2 shrink-0">
          <span v-if="mainViewMode === 'guide' && selectedStyle !== 'all'">
            聚焦风格：<strong class="text-studio-cyan">{{ selectedStyle }}</strong> · 
          </span>
          <span>共 <strong>{{ activeViewStats.totalItems }}</strong> 件创作产物</span>
          <span>·</span>
          <span><strong>{{ activeViewStats.spaceCount }}</strong> 个空间</span>
          <span>·</span>
          <span><strong>{{ activeViewStats.videoCount }}</strong> 部视频</span>
        </div>

      </div>

    </header>

    <!-- ========================================================================= -->
    <!-- 主内容展示区 -->
    <!-- ========================================================================= -->
    <main class="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-6">

      <!-- 加载中状态 -->
      <div v-if="loading" class="h-64 flex flex-col items-center justify-center text-slate-500 text-xs font-mono space-y-2">
        <div class="w-6 h-6 border-2 border-studio-accent border-t-transparent rounded-full animate-spin"></div>
        <span>正在读取全屋空间变换资产...</span>
      </div>

      <!-- 空结果状态 -->
      <div v-else-if="cards.length === 0" class="h-64 flex flex-col items-center justify-center text-slate-500 text-xs space-y-2 text-center">
        <svg class="w-10 h-10 text-slate-600 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
        <div class="text-sm font-semibold text-slate-300">创作库暂无匹配作品</div>
        <div class="text-slate-500">可在对话台中生成室内效果图后点击「存入创作库」沉淀方案</div>
      </div>

      <!-- ======================================================================= -->
      <!-- 模式 1：全屋空间变换指南 (默认主视图，按选中风格聚合空间动线与微调历史) -->
      <!-- ======================================================================= -->
      <div v-else-if="mainViewMode === 'guide'" class="space-y-7">
        
        <!-- 风格全案概览横幅 (Banner) -->
        <div class="rounded-2xl border border-studio-800 bg-studio-900/60 p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-studio-accent/20 border border-studio-accent/40 flex items-center justify-center text-studio-accent text-lg">
              🏛️
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-sm sm:text-base font-bold text-white tracking-wide">
                  {{ selectedStyle === 'all' ? '全风格室内空间变换全案总览' : `${selectedStyle} · 全屋空间变换指南` }}
                </h2>
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-studio-800 text-studio-cyan font-mono border border-studio-700">
                  {{ guideData.schemes.length }} 套空间方案
                </span>
              </div>
              <p class="text-xs text-slate-400 mt-0.5">
                包含门厅、客餐厅、卧室、卫浴等完整居住动线 · 支持多步微调历史查看与同一套提示词跨户型复用
              </p>
            </div>
          </div>

          <!-- 居住动线快捷锚点 -->
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-[10px] text-slate-500 font-bold mr-1">动线索引:</span>
            <button
              v-for="sec in guideData.sections"
              :key="sec.space"
              type="button"
              class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-studio-950 hover:bg-studio-800 text-slate-300 border border-studio-800 cursor-pointer transition-all"
              @click="scrollToSection(sec.space)"
            >
              {{ sec.space }} ({{ sec.schemes.length }})
            </button>
          </div>
        </div>

        <!-- 空间动线分区分块列表 (按门厅 -> 客厅 -> 餐厅 -> 厨房 -> 卧室 -> 卫浴 等顺位排列) -->
        <div
          v-for="sec in guideData.sections"
          :key="sec.space"
          :id="'sec-space-' + sec.space"
          class="space-y-3"
        >
          <!-- 空间板块标题栏 -->
          <div class="flex items-center justify-between border-b border-studio-800/80 pb-2">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-studio-accent"></span>
              <h3 class="text-sm font-bold text-slate-100 tracking-wide font-sans">
                {{ sec.space }} 空间变换方案
              </h3>
              <span class="text-xs text-slate-400 font-normal">
                ({{ sec.schemes.length }} 套方案 · 累计 {{ sec.totalSteps }} 次演化迭代)
              </span>
            </div>
            <span class="text-[11px] text-slate-500 font-mono">居住动线空间</span>
          </div>

          <!-- 方案卡片多列自适应网格 (彻底杜绝一行只有一个，3~4列饱满排布) -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            
            <div
              v-for="scheme in sec.schemes"
              :key="scheme.id"
              class="rounded-2xl border border-studio-750 bg-studio-900/80 hover:border-studio-accent/70 hover:shadow-xl transition-all flex flex-col overflow-hidden group/card"
            >
              
              <!-- 1. 卡片视觉成果大图 + 左上角输入基图缩略图 -->
              <div
                class="relative aspect-4/3 bg-black/60 overflow-hidden cursor-pointer"
                @click="openDetail(scheme.currentStep)"
              >
                <!-- 产物大图 -->
                <img
                  v-if="cardOutputUrl(scheme.currentStep)"
                  :src="cardOutputUrl(scheme.currentStep)"
                  class="w-full h-full object-cover group-hover/card:scale-102 transition-transform duration-300"
                  loading="lazy"
                />
                <div v-else class="w-full h-full flex items-center justify-center text-xs text-slate-600">无产物图</div>

                <!-- 左上角：输入原图缩略图 (带对比标签) -->
                <div
                  v-if="cardInputUrl(scheme.currentStep)"
                  class="absolute top-2 left-2 flex items-center gap-1.5 p-1 rounded-lg bg-black/80 backdrop-blur border border-white/15 shadow-md z-10"
                  title="点击对比输入原图"
                  @click.stop="openDetail(scheme.currentStep)"
                >
                  <img :src="cardInputUrl(scheme.currentStep)" class="w-7 h-7 rounded object-cover border border-white/20" />
                  <span class="text-[9px] font-bold text-slate-300 pr-1">原图</span>
                </div>

                <!-- 右上角：星标与软删 (悬浮显现) -->
                <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity z-10">
                  <button
                    type="button"
                    class="w-7 h-7 rounded-lg bg-black/75 hover:bg-black text-slate-300 hover:text-amber-300 flex items-center justify-center transition-colors cursor-pointer"
                    :class="scheme.currentStep.is_pinned ? '!opacity-100 text-amber-400' : ''"
                    title="收藏标星"
                    @click.stop="toggleCardPin(scheme.currentStep)"
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    class="w-7 h-7 rounded-lg bg-black/75 hover:bg-rose-950 text-slate-400 hover:text-rose-400 flex items-center justify-center transition-colors cursor-pointer"
                    title="移入回收站"
                    @click.stop="deleteCard(scheme.currentStep.id)"
                  >
                    🗑
                  </button>
                </div>
              </div>

              <!-- 2. 卡片主体信息区 -->
              <div class="p-3 flex-1 flex flex-col justify-between gap-2.5 text-xs">
                
                <div>
                  <!-- 风格与空间标签 -->
                  <div class="flex items-center justify-between text-slate-400 text-[11px] mb-1">
                    <div class="flex items-center gap-1.5 font-medium truncate">
                      <span class="text-slate-200 font-semibold">{{ scheme.style || selectedStyle }}</span>
                      <span>·</span>
                      <span class="text-studio-cyan font-bold">{{ scheme.space }}</span>
                      <span>·</span>
                      <span class="text-slate-400">{{ scheme.currentStep.operation || '换空间' }}</span>
                    </div>
                    <span class="text-[10px] text-slate-500 shrink-0 font-mono">
                      {{ formatRelativeTime(scheme.currentStep.updated_at) }}
                    </span>
                  </div>

                  <!-- 微调历史演变时间轴 (重点：解决用户反馈没看到微调历史的问题) -->
                  <div v-if="scheme.steps.length > 1" class="my-1.5 p-1.5 rounded-lg bg-studio-950/80 border border-studio-800">
                    <div class="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span class="font-bold text-amber-300 flex items-center gap-1">
                        <span>📈</span>
                        <span>微调演进 (共 {{ scheme.steps.length }} 步)</span>
                      </span>
                      <span class="text-[9px] text-slate-500 font-mono">点击查看每步差异</span>
                    </div>
                    
                    <!-- 步骤水平点选条 -->
                    <div class="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
                      <button
                        v-for="(st, sIdx) in scheme.steps"
                        :key="st.id"
                        type="button"
                        class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all shrink-0 cursor-pointer border"
                        :class="scheme.activeStepId === st.id
                          ? 'bg-amber-500 text-black border-amber-400 shadow-xs'
                          : 'bg-studio-900 text-slate-400 border-studio-750 hover:text-white'"
                        :title="`第 ${sIdx + 1} 步 (${formatStepTime(st.updated_at)}): ${st.prompt}`"
                        @click.stop="scheme.activeStepId = st.id; scheme.currentStep = st"
                      >
                        v{{ sIdx + 1 }}{{ st.is_cover ? '·封' : '' }}
                      </button>
                    </div>
                  </div>

                  <!-- 提示词文本预览 (可点开看完整) -->
                  <div
                    class="text-[11px] text-slate-300 line-clamp-2 leading-relaxed cursor-pointer hover:text-white transition-colors"
                    :title="scheme.currentStep.prompt"
                    @click="openDetail(scheme.currentStep)"
                  >
                    {{ scheme.currentStep.prompt || '暂无详细提示词说明' }}
                  </div>

                  <!-- 同一套提示词的多户型落地案例 (重点：用户反馈没看到跨空间/跨户型落地) -->
                  <div v-if="scheme.otherInstances.length > 0" class="mt-2 pt-1.5 border-t border-studio-800/80 flex items-center gap-1.5">
                    <span class="text-[9px] text-slate-500 shrink-0">多基图落地:</span>
                    <div class="flex items-center gap-1 truncate">
                      <div
                        v-for="inst in scheme.otherInstances.slice(0, 3)"
                        :key="inst.id"
                        class="w-5 h-5 rounded bg-black/60 border border-studio-700 overflow-hidden shrink-0 cursor-pointer"
                        :title="`同款提示词在户型基图 ${inst.root_origin_hash?.slice(0,6)} 上的落地实证`"
                        @click.stop="openDetail(inst)"
                      >
                        <img :src="cardOutputUrl(inst)" class="w-full h-full object-cover" />
                      </div>
                      <span v-if="scheme.otherInstances.length > 3" class="text-[9px] text-slate-500 font-mono">
                        +{{ scheme.otherInstances.length - 3 }}
                      </span>
                    </div>
                  </div>

                </div>

                <!-- 3. 底部大按钮操作区 (重点：保留原本体验，右下角大按钮一键复用提示词) -->
                <div class="pt-2 border-t border-studio-800 flex items-center justify-between gap-2 mt-auto">
                  <button
                    type="button"
                    class="px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer transition-colors shrink-0"
                    @click.stop="openDetail(scheme.currentStep)"
                  >
                    详情
                  </button>

                  <!-- 🚀 一键复用提示词大按钮 (经典主操作) -->
                  <button
                    type="button"
                    class="flex-1 py-1.5 px-3 rounded-xl bg-studio-accent hover:brightness-110 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer group/btn"
                    title="立即将此提示词与原图带回空间创作对话台"
                    @click.stop="handleReuseCard(scheme.currentStep)"
                  >
                    <span class="group-hover/btn:scale-125 transition-transform">🚀</span>
                    <span class="truncate">一键复用提示词</span>
                  </button>
                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

      <!-- ======================================================================= -->
      <!-- 模式 2：纯视频走向大盘 (两套视图：多空间跨房转场 VS 单空间导览漫游) -->
      <!-- ======================================================================= -->
      <div v-else-if="mainViewMode === 'trajectory'" class="space-y-6">
        
        <!-- 视图 A：多空间 (跨空间转场视频，如门厅-客厅、卫生间-卧室等) -->
        <template v-if="videoSubView === 'multi'">
          <div v-if="multiSpaceTrajectoryGroups.length === 0" class="h-56 flex flex-col items-center justify-center text-slate-500 text-xs space-y-2">
            <span class="text-3xl">🔄</span>
            <span class="text-sm font-semibold text-slate-300">暂无跨空间转场视频</span>
            <span class="text-slate-500">（如「门厅 → 客厅」、「卫生间 → 卧室」等跨房间转场实景）</span>
          </div>
          
          <div
            v-for="grp in multiSpaceTrajectoryGroups"
            :key="grp.trajectory"
            class="space-y-3"
          >
            <div class="flex items-center justify-between border-b border-studio-800 pb-2">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-studio-cyan shadow-sm shadow-studio-cyan/50"></span>
                <h3 class="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                  <span>🔄 跨空间走向：</span>
                  <span class="text-studio-cyan font-mono">{{ formatTrajectoryDisplay(grp.trajectory) }}</span>
                </h3>
                <span class="text-xs text-slate-400">({{ grp.cards.length }} 部视频)</span>
              </div>
              <span class="text-[11px] text-studio-cyan font-mono font-medium">多空间连续转场实景</span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              <div
                v-for="vCard in grp.cards"
                :key="vCard.id"
                class="rounded-2xl border border-studio-750 bg-studio-900/80 hover:border-studio-cyan/70 hover:shadow-xl transition-all flex flex-col overflow-hidden group/vcard"
              >
                <!-- 视频海报/第一帧 + 居中播放图标 -->
                <div class="relative aspect-4/3 bg-black/80 overflow-hidden cursor-pointer" @click="openDetail(vCard)">
                  <TemplateVideoCover
                    class="w-full h-full"
                    :video-url="cardOutputUrl(vCard)"
                    :reference-url="cardInputUrl(vCard)"
                  />
                  <!-- 左下角走向胶囊 -->
                  <div class="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur border border-studio-cyan/40 text-[10px] font-bold text-studio-cyan flex items-center gap-1 z-10">
                    <span>🎬</span>
                    <span class="truncate max-w-[160px]">{{ formatTrajectoryDisplay(vCard.trajectory) }}</span>
                  </div>
                </div>

                <div class="p-3 flex-1 flex flex-col justify-between gap-2.5 text-xs">
                  <div>
                    <div class="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span class="text-slate-200 font-semibold">{{ formatCardLabel(vCard, '多空间') }}</span>
                      <span class="text-[10px] text-slate-500 font-mono">{{ formatRelativeTime(vCard.updated_at) }}</span>
                    </div>
                    <div class="text-[11px] text-slate-300 line-clamp-2 leading-relaxed" :title="vCard.prompt">
                      {{ vCard.prompt }}
                    </div>
                  </div>

                  <!-- 底部复用运镜词大按钮 -->
                  <div class="pt-2 border-t border-studio-800 flex items-center justify-between gap-2 mt-auto">
                    <button type="button" class="px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer shrink-0" @click.stop="openDetail(vCard)">
                      详情
                    </button>
                    <button
                      type="button"
                      class="flex-1 py-1.5 px-3 rounded-xl bg-studio-cyan hover:brightness-110 text-studio-950 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      title="立即将此视频运镜提示词带回对话台拍摄"
                      @click.stop="handleReuseCard(vCard)"
                    >
                      <span>🚀</span>
                      <span class="truncate">一键复用运镜词</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- 视图 B：单空间 (单空间导览漫游视频，如客厅漫游、卧室漫游等) -->
        <template v-else>
          <div v-if="singleSpaceTrajectoryGroups.length === 0" class="h-56 flex flex-col items-center justify-center text-slate-500 text-xs space-y-2">
            <span class="text-3xl">🎥</span>
            <span class="text-sm font-semibold text-slate-300">暂无单空间导览漫游视频</span>
            <span class="text-slate-500">（可在对话台中拍摄单房间导览视频）</span>
          </div>

          <div
            v-for="grp in singleSpaceTrajectoryGroups"
            :key="grp.space"
            class="space-y-3"
          >
            <div class="flex items-center justify-between border-b border-studio-800 pb-2">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-studio-accent shadow-sm shadow-studio-accent/50"></span>
                <h3 class="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                  <span>🎥 单空间导览：</span>
                  <span class="text-studio-accent font-sans">{{ grp.space }}</span>
                </h3>
                <span class="text-xs text-slate-400">({{ grp.cards.length }} 部视频)</span>
              </div>
              <span class="text-[11px] text-slate-400 font-mono">单房间室内漫游实景</span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              <div
                v-for="vCard in grp.cards"
                :key="vCard.id"
                class="rounded-2xl border border-studio-750 bg-studio-900/80 hover:border-studio-accent/70 hover:shadow-xl transition-all flex flex-col overflow-hidden group/vcard"
              >
                <!-- 视频海报/第一帧 + 居中播放图标 -->
                <div class="relative aspect-4/3 bg-black/80 overflow-hidden cursor-pointer" @click="openDetail(vCard)">
                  <TemplateVideoCover
                    class="w-full h-full"
                    :video-url="cardOutputUrl(vCard)"
                    :reference-url="cardInputUrl(vCard)"
                  />
                  <!-- 左下角导览胶囊 -->
                  <div class="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur border border-studio-accent/40 text-[10px] font-bold text-white flex items-center gap-1 z-10">
                    <span>🎥</span>
                    <span class="truncate max-w-[160px]">{{ vCard.trajectory || `${vCard.space || '空间'} 导览漫游` }}</span>
                  </div>
                </div>

                <div class="p-3 flex-1 flex flex-col justify-between gap-2.5 text-xs">
                  <div>
                    <div class="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span class="text-slate-200 font-semibold">{{ formatCardLabel(vCard, '单空间') }}</span>
                      <span class="text-[10px] text-slate-500 font-mono">{{ formatRelativeTime(vCard.updated_at) }}</span>
                    </div>
                    <div class="text-[11px] text-slate-300 line-clamp-2 leading-relaxed" :title="vCard.prompt">
                      {{ vCard.prompt }}
                    </div>
                  </div>

                  <!-- 底部复用运镜词大按钮 -->
                  <div class="pt-2 border-t border-studio-800 flex items-center justify-between gap-2 mt-auto">
                    <button type="button" class="px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer shrink-0" @click.stop="openDetail(vCard)">
                      详情
                    </button>
                    <button
                      type="button"
                      class="flex-1 py-1.5 px-3 rounded-xl bg-studio-cyan hover:brightness-110 text-studio-950 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      title="立即将此视频运镜提示词带回对话台拍摄"
                      @click.stop="handleReuseCard(vCard)"
                    >
                      <span>🚀</span>
                      <span class="truncate">一键复用运镜词</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

      </div>

      <!-- ======================================================================= -->
      <!-- 模式 3：户型基图归集大盘 (按根原图房屋聚合展示多风格、多空间) -->
      <!-- ======================================================================= -->
      <div v-else-if="mainViewMode === 'root'" class="space-y-6">
        <div
          v-for="rGrp in rootOriginGroups"
          :key="rGrp.rootHash"
          class="rounded-2xl border border-studio-800 bg-studio-900/60 p-4 space-y-4"
        >
          <div class="flex items-center justify-between border-b border-studio-800/80 pb-3">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-black/60 border border-studio-700 overflow-hidden shrink-0">
                <img v-if="rGrp.thumbnail" :src="rGrp.thumbnail" class="w-full h-full object-cover" />
              </div>
              <div>
                <h3 class="text-sm font-bold text-white tracking-wide">{{ rGrp.title }}</h3>
                <div class="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                  <span>已演化风格：<strong class="text-studio-cyan">{{ rGrp.styles.join(' · ') || '室内设计' }}</strong></span>
                  <span>·</span>
                  <span>覆盖 {{ rGrp.cards.length }} 个空间产物</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              class="px-3 py-1.5 rounded-xl bg-studio-accent/20 hover:bg-studio-accent text-studio-cyan hover:text-white font-bold text-xs border border-studio-accent/40 cursor-pointer transition-all"
              @click="openDetail(rGrp.cards[0])"
            >
              打开两栏全案看板 →
            </button>
          </div>

          <!-- 该户型下的空间方案横向列表 -->
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div
              v-for="c in rGrp.cards"
              :key="c.id"
              class="rounded-xl border border-studio-800 bg-studio-950/80 overflow-hidden cursor-pointer hover:border-studio-accent transition-all group"
              @click="openDetail(c)"
            >
              <div class="aspect-4/3 bg-black/60 relative">
                <img :src="cardOutputUrl(c)" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                <span class="absolute bottom-1 left-1 px-1.5 py-0.2 rounded bg-black/75 text-[9px] text-slate-300 font-bold">
                  {{ c.space || '空间' }}
                </span>
              </div>
              <div class="p-2 text-[10px] truncate text-slate-300">
                {{ c.style || '方案' }} · {{ c.prompt?.slice(0, 15) }}
              </div>
            </div>
          </div>
        </div>
      </div>

    </main>

    <!-- ========================================================================= -->
    <!-- 第 2 层：两栏详情面板抽屉 (滑出式 / 居中大弹窗，宽约 1160px) -->
    <!-- ========================================================================= -->
    <CreationDetailDrawer
      v-if="detailVisible"
      :rootHash="detailRootHash"
      :initialStyle="detailInitialStyle"
      :initialItemId="detailInitialItemId"
      @close="closeDetail"
      @jump-to-chat="handleJumpToChat"
    />

    <!-- 回收站轻量弹窗 -->
    <div
      v-if="trashModalVisible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
      @click.self="trashModalVisible = false"
    >
      <div class="w-[600px] max-w-[90vw] max-h-[80vh] bg-studio-900 border border-studio-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 font-sans">
        <div class="h-11 px-4 border-b border-studio-800 flex items-center justify-between shrink-0">
          <span class="text-xs font-bold text-slate-200">创作库回收站</span>
          <button
            type="button"
            class="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white"
            @click="trashModalVisible = false"
          >
            ✕
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 min-h-0 space-y-2">
          <div v-if="trashItems.length === 0" class="py-8 text-center text-xs text-slate-500">
            回收站为空
          </div>
          <div
            v-for="item in trashItems"
            :key="item.id"
            class="flex items-center justify-between p-2.5 rounded-xl border border-studio-800 bg-studio-950/60"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-10 h-10 rounded-lg bg-black/50 border border-studio-700 overflow-hidden shrink-0">
                <img v-if="trashThumbOf(item)" :src="trashThumbOf(item)" class="w-full h-full object-cover" />
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold text-slate-200 truncate">{{ item.title || '无标题' }}</div>
                <div class="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                  <span>{{ item.style || '未填写' }}</span>
                  <span>·</span>
                  <span>{{ item.space || '未填写' }}</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="px-2.5 py-1 rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-200 text-xs font-medium cursor-pointer"
                @click="handleRestoreTrash(item.id)"
              >
                还原
              </button>
              <button
                type="button"
                class="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/25 text-red-400 text-xs font-medium cursor-pointer"
                @click="handlePurgeTrash(item.id)"
              >
                彻底删除
              </button>
            </div>
          </div>
        </div>

        <div class="p-3 border-t border-studio-800 bg-studio-950/80 flex items-center justify-end">
          <button
            type="button"
            class="px-3 py-1.5 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-300 text-xs font-medium cursor-pointer"
            @click="trashModalVisible = false"
          >
            关闭
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import {
  fetchCreationCards,
  patchCreationTemplate,
  deleteCreationTemplate,
  fetchCreationTrash,
  restoreCreationTrash,
  purgeCreationTrash,
  downloadSchemePackage,
  triggerAutoTagAll
} from '../../api';
import CreationDetailDrawer from './CreationDetailDrawer.vue';
import TemplateVideoCover from './TemplateVideoCover.vue';

const emit = defineEmits(['sendToChat']);

// 主视图模式：'guide' (全屋空间变换指南) | 'trajectory' (纯视频走向大盘) | 'root' (户型基图归集)
const mainViewMode = ref('guide');

// 选中的风格聚焦 (默认聚焦拥有最多成果的风格，如 '中古风')
const selectedStyle = ref('中古风');

const searchQuery = ref('');
const filterTime = ref('all');
const filterSpace = ref('all');
const pinnedOnly = ref(false);

const loading = ref(true);
const autoTagging = ref(false);
const cards = ref([]);

// 详情抽屉控制
const detailVisible = ref(false);
const detailRootHash = ref('');
const detailInitialStyle = ref('');
const detailInitialItemId = ref('');

// 回收站弹窗
const trashModalVisible = ref(false);
const trashItems = ref([]);

// 室内标准空间动线顺位
const CANONICAL_ROOMS = [
  '门厅', '玄关', '客厅', '客餐厅', '餐厅', '厨房', '主卧', '次卧', '卧室', 
  '衣帽间', '卫浴', '卫生间', '书房', '阳台', '露台', '茶室', '过道', '走廊', '其他'
];

function formatCardLabel(card, fallbackSpace = '空间') {
  if (!card) return fallbackSpace;
  const style = (card.style && card.style !== '未填写' && card.style !== '未填写风格') ? card.style : '';
  const space = (card.space && card.space !== '未填写') ? card.space : (card.trajectory || fallbackSpace);
  if (style) return `${style} · ${space}`;
  return space;
}

// 生图与生视频资产
const imageCards = computed(() => {
  return cards.value.filter(c => {
    const isVid = c.type === 'video' || String(c.result_images?.[0]?.url || '').endsWith('.mp4');
    return !isVid;
  });
});

const videoCards = computed(() => {
  return cards.value.filter(c => {
    const isVid = c.type === 'video' || String(c.result_images?.[0]?.url || '').endsWith('.mp4');
    return isVid;
  });
});

// 提取当前库中真实出现过的有效风格（排除“未填写”）
const availableRealStyles = computed(() => {
  const map = new Map();
  for (const c of cards.value) {
    const st = (c.style || '').trim();
    if (st && st !== '未填写' && st !== '未填写风格') {
      map.set(st, (map.get(st) || 0) + 1);
    }
  }
  const arr = [];
  for (const [name, count] of map.entries()) {
    arr.push({ name, count });
  }
  arr.sort((a, b) => b.count - a.count);
  return arr;
});

// 动态提取空间下拉值
const distinctSpaces = computed(() => {
  const set = new Set();
  for (const c of cards.value) {
    if (c.space && c.space !== '未填写') set.add(c.space);
  }
  return Array.from(set);
});

// 当前激活视图的数据统计
const activeViewStats = computed(() => {
  let targetSet = cards.value;
  if (mainViewMode.value === 'guide' && selectedStyle.value !== 'all') {
    targetSet = cards.value.filter(c => c.style === selectedStyle.value);
  } else if (mainViewMode.value === 'trajectory') {
    targetSet = videoCards.value;
  }
  const spaces = new Set(targetSet.map(c => c.space).filter(Boolean));
  const vids = targetSet.filter(c => c.type === 'video' || String(c.result_images?.[0]?.url || '').endsWith('.mp4'));
  return {
    totalItems: targetSet.length,
    spaceCount: spaces.size,
    videoCount: vids.length
  };
});

/**
 * 核心：构建【全屋空间变换指南】数据流
 * 根据 selectedStyle 将资产按空间动线聚合，包含多步微调历史与跨户型落地
 */
const guideData = computed(() => {
  // 1. 过滤当前风格下的资产
  let pool = cards.value;
  if (selectedStyle.value !== 'all') {
    pool = pool.filter(c => (c.style || '').trim() === selectedStyle.value);
  }

  const spaceGroups = new Map();

  for (const c of pool) {
    const isVid = c.type === 'video' || String(c.result_images?.[0]?.url || '').endsWith('.mp4');
    // 用户规则：第一个板块必须只有图片，彻底排除任何视频卡片
    if (isVid) {
      continue;
    }

    const sp = (c.space || '').trim() || '其他';
    if (!spaceGroups.has(sp)) {
      spaceGroups.set(sp, []);
    }
    spaceGroups.get(sp).push(c);
  }

  // 2. 在每个空间内，按根原图与提示词演变构建 Schemes (包含微调历史)
  const sections = [];
  const allSchemes = [];

  for (const [sp, itemList] of spaceGroups.entries()) {
    // 按 root_origin_hash 聚合演化步
    const schemeMap = new Map();

    for (const item of itemList) {
      const rootKey = item.root_origin_hash || item.id;
      if (!schemeMap.has(rootKey)) {
        schemeMap.set(rootKey, {
          id: `scheme_${rootKey}_${sp}`,
          rootHash: rootKey,
          space: sp,
          style: item.style || selectedStyle.value,
          steps: [],
          activeStepId: '',
          currentStep: null,
          otherInstances: []
        });
      }
      schemeMap.get(rootKey).steps.push(item);
    }

    const spaceSchemes = [];
    for (const sc of schemeMap.values()) {
      // 步骤按时间正序排列：v1 -> v2 -> v3
      sc.steps.sort((a, b) => Number(a.updated_at || 0) - Number(b.updated_at || 0));
      // 默认高亮封面或最新步
      const cover = sc.steps.find(s => s.is_cover === 1) || sc.steps[sc.steps.length - 1];
      sc.currentStep = cover;
      sc.activeStepId = cover.id;

      // 提取多基图落地：在同一个空间内，其他基图上运行同类方案的实例
      sc.otherInstances = itemList.filter(i => i.root_origin_hash !== sc.rootHash);

      spaceSchemes.push(sc);
      allSchemes.push(sc);
    }

    // 方案按最新更新时间倒序
    spaceSchemes.sort((a, b) => Number(b.currentStep?.updated_at || 0) - Number(a.currentStep?.updated_at || 0));

    const totalSteps = itemList.length;
    sections.push({
      space: sp,
      schemes: spaceSchemes,
      totalSteps
    });
  }

  // 3. 按照标准居住动线排列空间板块
  sections.sort((a, b) => {
    let idxA = CANONICAL_ROOMS.indexOf(a.space);
    let idxB = CANONICAL_ROOMS.indexOf(b.space);
    if (idxA === -1) idxA = 999;
    if (idxB === -1) idxB = 999;
    return idxA - idxB;
  });

  return {
    sections,
    schemes: allSchemes,
    videos: []
  };
});

const videoSubView = ref('multi'); // 'multi' (多空间跨房转场) | 'single' (单空间导览漫游)

function isMultiSpaceTrajectory(traj) {
  if (!traj) return false;
  const clean = traj.replace(/\s*(?:->|—>)\s*/g, ' → ');
  const parts = clean.split('→').map(s => s.trim());
  if (parts.length === 2) {
    const p1 = parts[0];
    const p2 = parts[1];
    return CANONICAL_ROOMS.includes(p1) && CANONICAL_ROOMS.includes(p2) && p1 !== p2;
  }
  return false;
}

function formatTrajectoryDisplay(traj) {
  if (!traj) return '';
  return traj.replace(/\s*(?:->|—>|-)\s*/g, ' → ');
}

/**
 * 模式 2：纯视频走向大盘数据
 * 视图 1：多空间跨房转场（如门厅-客厅、卫生间-卧室等）
 */
const multiSpaceTrajectoryGroups = computed(() => {
  const map = new Map();
  for (const v of videoCards.value) {
    const traj = (v.trajectory || '').trim();
    if (isMultiSpaceTrajectory(traj)) {
      const key = traj;
      if (!map.has(key)) {
        map.set(key, {
          trajectory: key,
          cards: []
        });
      }
      map.get(key).cards.push(v);
    }
  }
  const arr = Array.from(map.values());
  for (const grp of arr) {
    grp.cards.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
  }
  return arr;
});

/**
 * 视图 2：单空间导览漫游（如客厅、卧室、门厅等单房间内的导览漫游）
 */
const singleSpaceTrajectoryGroups = computed(() => {
  const map = new Map();
  for (const v of videoCards.value) {
    const traj = (v.trajectory || '').trim();
    if (!isMultiSpaceTrajectory(traj)) {
      const room = (v.space && v.space !== '未填写') ? v.space : '其他空间';
      const label = traj && !traj.includes('未填写') ? traj : `${room} 导览漫游`;
      const key = room;
      if (!map.has(key)) {
        map.set(key, {
          space: room,
          label,
          cards: []
        });
      }
      map.get(key).cards.push(v);
    }
  }
  const arr = Array.from(map.values());
  arr.sort((a, b) => {
    let idxA = CANONICAL_ROOMS.indexOf(a.space);
    let idxB = CANONICAL_ROOMS.indexOf(b.space);
    if (idxA === -1) idxA = 999;
    if (idxB === -1) idxB = 999;
    return idxA - idxB;
  });
  for (const grp of arr) {
    grp.cards.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
  }
  return arr;
});

/**
 * 模式 3：户型基图归集大盘数据
 */
const rootOriginGroups = computed(() => {
  const map = new Map();
  for (const c of cards.value) {
    const rh = c.root_origin_hash || c.id;
    if (!map.has(rh)) {
      map.set(rh, {
        rootHash: rh,
        title: c.title || '户型设计基图',
        thumbnail: cardInputUrl(c),
        styles: new Set(),
        cards: []
      });
    }
    const grp = map.get(rh);
    if (c.style && c.style !== '未填写') grp.styles.add(c.style);
    grp.cards.push(c);
  }

  const arr = [];
  for (const grp of map.values()) {
    grp.styles = Array.from(grp.styles);
    grp.cards.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
    arr.push(grp);
  }
  return arr;
});

function setMainViewMode(mode) {
  mainViewMode.value = mode;
}

function scrollToSection(spaceKey) {
  const el = document.getElementById(spaceKey === 'videos' ? 'sec-space-videos' : 'sec-space-' + spaceKey);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function fetchCards() {
  loading.value = true;
  try {
    const res = await fetchCreationCards({
      q: searchQuery.value.trim(),
      time: filterTime.value,
      space: filterSpace.value,
      pinned_only: pinnedOnly.value
    });
    if (res.success && Array.isArray(res.data)) {
      cards.value = res.data;

      // 如果当前 selectedStyle 在数据中不存在或为默认，自动选中最多作品的真实风格
      if (availableRealStyles.value.length > 0) {
        const hasCurrent = availableRealStyles.value.some(s => s.name === selectedStyle.value);
        if (!hasCurrent && selectedStyle.value !== 'all') {
          selectedStyle.value = availableRealStyles.value[0].name;
        }
      }
    }
  } catch (err) {
    console.error('获取创作库列表异常:', err);
  } finally {
    loading.value = false;
  }
}

async function handleRunAiAutoTag() {
  if (autoTagging.value) return;
  autoTagging.value = true;
  try {
    const res = await triggerAutoTagAll();
    if (res.success) {
      alert(`✨ AI 智能打标完成！已成功识别 ${res.updated_count || 0} 个作品的空间、风格与空间走向。`);
      await fetchCards();
    } else {
      alert('AI 打标未能全部完成: ' + (res.error || '接口异常'));
    }
  } catch (e) {
    alert('AI 打标请求异常: ' + e.message);
  } finally {
    autoTagging.value = false;
  }
}

function handleSearch() {
  fetchCards();
}

function togglePinnedOnly() {
  pinnedOnly.value = !pinnedOnly.value;
  fetchCards();
}

/**
 * 🚀 一键复用提示词核心操作 (重点：满足用户第4点要求)
 * 携带完整提示词、参数、基图原图无缝切回「空间创作」对话台
 */
function handleReuseCard(card) {
  if (!card) return;
  const isVid = card.type === 'video' || String(card.result_images?.[0]?.url || '').endsWith('.mp4');
  
  emit('sendToChat', {
    target: 'creation_reuse',
    action: isVid ? 'shoot_video' : 'refine',
    prompt: card.prompt || card.title || '',
    recipePrompt: card.prompt || card.title || '',
    style: card.style || '',
    space: card.space || '',
    originImage: card.origin_images?.[0] ? {
      url: cardInputUrl(card),
      fid: card.origin_images[0].fid || ''
    } : null,
    templateId: card.id
  });
}

function cardOutputUrl(card) {
  if (!card) return '';
  const r0 = card.result_images?.[0];
  if (!r0) return '';
  if (typeof r0 === 'string') return r0;
  if (card.type === 'video' || String(r0.url || '').endsWith('.mp4')) {
    return r0.poster || r0.url || '';
  }
  return r0.url || r0.poster || '';
}

function cardInputUrl(card) {
  if (!card) return '';
  const o0 = card.origin_images?.[0];
  if (!o0) return '';
  if (typeof o0 === 'string') return o0;
  return o0.url || o0.poster || '';
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (isToday) return `今天 ${timeStr}`;
  const diffDays = Math.floor((now - d) / (24 * 60 * 60 * 1000));
  if (diffDays === 1) return `昨天 ${timeStr}`;
  return `${d.getMonth() + 1}-${d.getDate()} ${timeStr}`;
}

function formatStepTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function toggleCardPin(card) {
  if (!card) return;
  const next = card.is_pinned ? 0 : 1;
  card.is_pinned = next;
  try {
    await patchCreationTemplate(card.id, { is_pinned: next });
  } catch (_) {}
}

async function deleteCard(cardId) {
  if (!confirm('确定将该作品移入回收站吗？可在回收站还原。')) return;
  try {
    await deleteCreationTemplate(cardId);
    cards.value = cards.value.filter(c => c.id !== cardId);
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}

function openDetail(card) {
  if (!card) return;
  detailRootHash.value = card.root_origin_hash || card.id;
  detailInitialStyle.value = card.style || selectedStyle.value || '';
  detailInitialItemId.value = card.id;
  detailVisible.value = true;
}

function closeDetail() {
  detailVisible.value = false;
  fetchCards();
}

function handleJumpToChat(payload) {
  emit('sendToChat', payload);
}

async function handleExportPackage() {
  try {
    const payload = {};
    if (selectedStyle.value && selectedStyle.value !== 'all') {
      payload.style = selectedStyle.value;
    }
    await downloadSchemePackage(payload);
  } catch (e) {
    alert('导出方案包失败: ' + (e?.message || '异常'));
  }
}

async function openTrashModal() {
  trashModalVisible.value = true;
  try {
    const res = await fetchCreationTrash();
    if (res.success && Array.isArray(res.data)) {
      trashItems.value = res.data;
    }
  } catch (err) {
    console.error('获取回收站失败:', err);
  }
}

function trashThumbOf(item) {
  let resList = [];
  try { resList = typeof item.result_images === 'string' ? JSON.parse(item.result_images) : (item.result_images || []); } catch {}
  const r0 = resList[0];
  return r0?.url || r0?.poster || '';
}

async function handleRestoreTrash(id) {
  try {
    await restoreCreationTrash([id]);
    trashItems.value = trashItems.value.filter(x => x.id !== id);
    fetchCards();
  } catch (err) {
    console.error('还原失败:', err);
  }
}

async function handlePurgeTrash(id) {
  if (!confirm('彻底删除后文件将被清理且不可恢复，确定吗？')) return;
  try {
    await purgeCreationTrash([id]);
    trashItems.value = trashItems.value.filter(x => x.id !== id);
  } catch (err) {
    console.error('彻底删除失败:', err);
  }
}

onMounted(() => {
  fetchCards();
});
</script>
