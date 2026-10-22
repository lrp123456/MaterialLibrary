<template>
  <div class="view-root library-shell flex-1 flex h-full min-w-0 bg-studio-950 text-slate-100 overflow-hidden font-sans select-none relative" :class="{ 'is-collapsed': sidebarCollapsed }" :style="{ '--lib-sidebar-w': sidebarWidth + 'px' }">
    <button type="button" class="sidebar-open-btn" @click="openLibrarySidebar">菜单</button>
    <aside class="library-sidebar" :class="{ 'is-open': sidebarOpen, 'is-collapsed': sidebarCollapsed }">
      <div class="sidebar-pin">
        <div class="sidebar-search relative">
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <StudioIcon name="search" :size="16" />
          </div>
          <input
            v-model="keyword"
            type="text"
            :placeholder="searchPlaceholder"
            @keyup.enter="handleSearch"
            class="bg-studio-850 border border-studio-700 text-slate-100 placeholder-slate-400 focus:outline-none focus:border-studio-accent"
          />
        </div>

        <div class="lib-plates" role="tablist" aria-label="素材来源">
          <button
            v-for="plate in SOURCE_PLATES"
            :key="plate.key"
            type="button"
            class="lib-plate"
            :class="{ 'is-on': sourcePlate === plate.key }"
            @click="setSourcePlate(plate.key)"
          >
            <span class="lib-mark" aria-hidden="true"></span>
            <span>{{ plate.label }}</span>
            <span v-if="sourcePlate === plate.key" class="lib-now">当前</span>
          </button>
        </div>
        <div class="sidebar-group">
          <template v-for="cat in plateTabs" :key="cat.key">
            <button
              type="button"
              class="lib-l1"
              :class="{ 'is-on': activeMainTab === cat.key }"
              :aria-expanded="activeMainTab === cat.key"
              @click="switchMainTab(cat.key)"
            >
              <span class="lib-mark" aria-hidden="true"></span>
              <span class="lib-l1-label">{{ cat.label }}</span>
              <span v-if="cat.key === 'trash' && trashTotal > 0" class="lib-count">{{ trashTotal }}</span>
              <span class="lib-state">{{ activeMainTab === cat.key ? '已展开' : '展开' }}</span>
            </button>
            <div v-if="activeMainTab === cat.key" class="lib-sheet" role="group" :aria-label="cat.label">
              <button
                v-for="sub in currentSubCategories"
                :key="cat.key + '-' + sub.key"
                type="button"
                class="lib-l2"
                :class="{ 'is-on': activeSubCategory === sub.key }"
                :aria-current="activeSubCategory === sub.key ? 'true' : undefined"
                @click="switchSubCategory(sub.key); closeSidebarOnNarrow()"
              >
                <span class="lib-mark" aria-hidden="true"></span>
                <span class="lib-l2-label">{{ sub.label }}</span>
                <span v-if="activeSubCategory === sub.key" class="lib-now">当前</span>
              </button>
              <!-- 剪辑「素材」库：按云端快照项目再筛一层 -->
              <button
                v-for="pr in clipProjectChips"
                :key="cat.key + '-proj-' + (pr.key || 'all')"
                type="button"
                class="lib-l2 lib-l2-nested"
                :class="{ 'is-on': activeClipProject === pr.key }"
                :aria-current="activeClipProject === pr.key ? 'true' : undefined"
                @click="selectClipProject(pr.key); closeSidebarOnNarrow()"
              >
                <span class="lib-l2-label">{{ pr.label }}</span>
                <span v-if="pr.count != null" class="lib-count">{{ pr.count }}</span>
              </button>
            </div>
          </template>
        </div>
      </div>

      <div v-if="activeMainTab !== 'trash'" class="lib-filters">
        <button
          type="button"
          class="filter-switch"
          :class="{ 'is-on': onlyFavorite }"
          :aria-pressed="onlyFavorite"
          @click="toggleOnlyFavorite"
        >
          <span>只看收藏</span>
          <span class="filter-switch-knob" aria-hidden="true"></span>
          <span class="lib-switch-word">{{ onlyFavorite ? '开' : '关' }}</span>
        </button>

        <section v-for="group in filterGroups" :key="group.id" class="lib-group">
          <button
            type="button"
            class="lib-group-head"
            :aria-expanded="filterGroupOpen(group.id)"
            @click="toggleFilterGroup(group.id)"
          >
            <span>{{ group.title }}</span>
            <span class="lib-meta">{{ filterGroupOpen(group.id) ? '收起' : group.options.length + ' 项' }}</span>
          </button>
          <div v-if="filterGroupOpen(group.id) && group.kind === 'color'" class="lib-colors">
            <button
              v-for="opt in group.options"
              :key="opt.key"
              type="button"
              class="lib-dot-btn"
              :class="{ 'is-on': isFilterActive(group.dimension, opt.key) }"
              :aria-pressed="isFilterActive(group.dimension, opt.key)"
              @click="toggleFilter(group.dimension, opt.key)"
            >
              <span class="lib-dot" :style="{ backgroundColor: opt.hex }"></span>
              <span>{{ opt.label }}</span>
            </button>
          </div>
          <div v-else-if="filterGroupOpen(group.id)" class="lib-chips">
            <button
              v-for="opt in group.options"
              :key="opt.key"
              type="button"
              class="lib-chip"
              :class="{ 'is-on': isFilterActive(group.dimension, opt.key) }"
              :aria-pressed="isFilterActive(group.dimension, opt.key)"
              @click="toggleFilter(group.dimension, opt.key)"
            >
              <span>{{ opt.label }}</span>
              <span v-if="opt.count != null" class="lib-count">{{ opt.count }}</span>
            </button>
          </div>
        </section>

        <button v-if="activeFilterCount > 0" type="button" class="lib-reset" @click="clearAllFilters">重置全部筛选</button>
      </div>
      <div v-else class="lib-filters">
        <p class="lib-note">回收站没有收藏开关，也没有室内筛选。</p>
        <p class="lib-note">已选 {{ selectedFids.length }} 项</p>
        <button type="button" class="theme-btn-success rounded-xl" :disabled="selectedFids.length === 0" @click="handleRestoreBatch">恢复到素材库</button>
        <button type="button" class="theme-btn-danger rounded-xl" :disabled="selectedFids.length === 0" @click="handlePurgeBatch">彻底粉碎</button>
      </div>
      <div class="lib-resize" title="拖动调整宽度" @pointerdown="startSidebarResize"></div>
    </aside>

    <div class="library-main">
      <div class="library-toolbar">
        <button type="button" class="sidebar-open-btn" @click="openLibrarySidebar">菜单</button>
        <button type="button" :class="{ 'is-on': showSidebarTimeline }" @click="showSidebarTimeline = !showSidebarTimeline"><span class="lib-mark"></span>时间轴<span v-if="showSidebarTimeline" class="lib-now">当前</span></button>
        <button type="button" :class="{ 'is-on': layoutMode === 'masonry' }" @click="layoutMode = 'masonry'"><span class="lib-mark"></span>瀑布流<span v-if="layoutMode === 'masonry'" class="lib-now">当前</span></button>
        <button type="button" :class="{ 'is-on': layoutMode === 'grid' }" @click="layoutMode = 'grid'"><span class="lib-mark"></span>网格<span v-if="layoutMode === 'grid'" class="lib-now">当前</span></button>
        <button type="button" class="theme-btn-workbench bg-studio-accent/20 border border-studio-accent/40 text-studio-cyan font-bold hover:brightness-125" @click="openSimilarityWorkbench">
          <StudioIcon name="scan" :size="14" />
          <span>🔍 相似工作台</span>
        </button>
        <button v-if="sourcePlate === 'finished'" type="button" @click="finishedFileInput?.click()">上传成品</button>
        <input ref="finishedFileInput" type="file" accept="image/*,video/*,audio/*" class="hidden" @change="uploadFinished" />
        <button type="button" @click="reloadAssets(true)">刷新</button>
      </div>
    <!-- ========================================================================= -->
    <!-- 4. 主体视口：左侧侧边时间轴 (精准到每一天) + 右侧自适应瀑布流画廊 -->
    <!-- ========================================================================= -->
    <div class="library-gallery relative flex-1 overflow-hidden">
      <!-- 4.1 时间轴画在画廊内部，年份和游标都留在刻度区域内 -->
      <transition name="fade">
        <div
          v-if="showSidebarTimeline && activeMainTab !== 'trash' && flatScrubberNodes.length > 0"
          ref="scrubberOuterRef"
          class="timeline-rail absolute top-0 right-0 bottom-0 z-20 w-32 flex flex-col overflow-visible select-none border-l border-studio-700 bg-studio-950/80"
        >
          <!-- 刻度线滚动区 (支持点击任意刻度线或年份即时平滑跳转，满屏展开) -->
          <div
            ref="scrubberScrollRef"
            class="pointer-events-auto h-full w-full overflow-y-auto no-scrollbar pb-24 flex flex-col justify-between items-end py-6 pr-3 cursor-pointer relative"
            @click="handleTrackClick"
          >
            <!-- 顶部 "全部" 重置胶囊 -->
            <button
              @click.stop="handleShowAllTimeline"
              class="mr-1 mb-3 px-2.5 py-1 rounded-full text-[11px] font-mono font-extrabold transition-all cursor-pointer pointer-events-auto border"
              :class="!filterDate ? 'bg-studio-accent text-white border-studio-accent shadow-xs' : 'bg-studio-900 text-slate-300 border-studio-700 hover:text-white'"
              title="查看连续全量时间轴"
            >
              ALL 全部
            </button>

            <!-- 年份分组与对应刻度条 (条形横线满屏拉大展示) -->
            <div
              v-for="group in scrubberGroups"
              :key="group.year"
              class="relative flex w-full flex-col items-end my-2"
            >
              <!-- 年份标识 (位于刻度线左侧，点击跳转该年份首日) -->
              <div
                @click.stop="handleYearClick(group)"
                class="theme-year pr-1 font-mono select-none cursor-pointer pointer-events-auto mb-1.5"
                :title="`跳转到 ${group.year} 年素材`"
              >
                {{ group.year }}
              </div>

              <!-- 每日刻度项 (全量横线直观呈现密度，满屏大条) -->
              <div
                v-for="node in group.nodes"
                :key="node.key"
                :data-scrub-date="node.dateStr"
                @click.stop="handleTickClick(node)"
                class="z-10 flex items-center justify-end group/tick cursor-pointer pointer-events-auto transition-all h-3.5 sm:h-4 w-24 py-0.5"
                :title="`${node.dateStr} (共 ${node.total} 件素材)`"
              >
                <div
                  class="theme-tick rounded-full pointer-events-none"
                  :class="{ 'is-on': activeScrubDate === node.dateStr || filterDate === node.dateStr }"
                  :style="{ width: `${node.tickWidth}px` }"
                ></div>
              </div>
            </div>
            <div class="h-24"></div>
          </div>

          <!-- 浮动跟随/可拖拽游标 (Floating Draggable Scrubber Thumb, 适老高清晰度胶囊) -->
          <div
            v-if="thumbTop !== null"
            class="pointer-events-auto absolute right-1 z-40 cursor-grab active:cursor-grabbing select-none focus:outline-none"
            :style="{
              top: `${thumbTop}px`,
              transform: 'translateY(-50%)',
              transition: isDragging ? 'none' : 'top 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
              touchAction: 'none'
            }"
            @pointerdown="handleThumbPointerDown"
            @pointermove="handleThumbPointerMove"
            @pointerup="handleThumbPointerUp"
            @pointercancel="handleThumbPointerUp"
            role="slider"
            aria-label="Timeline scrubber"
          >
            <div
              class="pointer-events-none flex items-center gap-2 rounded-full bg-studio-900/95 border border-studio-700/90 px-3.5 py-1.5 text-slate-100 shadow-2xl backdrop-blur-md ring-1 ring-studio-700/20"
            >
              <span class="text-xs font-extrabold font-mono whitespace-nowrap text-slate-100 tabular-nums">
                {{ scrubDisplayYear }} <span class="text-studio-cyan font-bold">{{ scrubDisplayMonthDay }}</span>
              </span>
              <svg class="h-3.5 w-3.5 text-studio-cyan shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m7 15 5 5 5-5"></path>
                <path d="m7 9 5-5 5 5"></path>
              </svg>
            </div>
          </div>
        </div>
      </transition>

      <!-- 4.2 右侧主体瀑布流画廊 (自适应大图展示，滚动自动加载) -->
      <div
        ref="scrollContainerRef"
        @scroll="handleGalleryScroll"
        :class="[
          'library-scroll h-full overflow-y-auto py-5 space-y-6 scroll-smooth pl-6',
          loading ? 'is-loading' : '',
          showSidebarTimeline && activeMainTab !== 'trash' ? 'pr-36' : 'pr-6'
        ]"
      >
        <!-- 日期精准筛选激活提示条 -->
        <div
          v-if="filterDate"
          class="flex items-center justify-between p-3 bg-studio-900 border border-studio-700 rounded-xl text-xs"
        >
          <div class="flex items-center space-x-2 text-slate-200">
            <span class="text-studio-cyan font-bold">📅 当前精准聚焦日期:</span>
            <span class="font-bold text-white font-mono text-sm bg-studio-850 px-2 py-0.5 rounded border border-studio-750">
              {{ filterDate }} {{ isToday(filterDate) ? '(今天)' : (isYesterday(filterDate) ? '(昨天)' : '') }}
            </span>
            <span class="text-slate-400 font-mono">共匹配 {{ totalAssetsCount }} 件素材</span>
          </div>
          <button
            @click="filterDate = ''; reloadAssets(true);"
            class="px-2.5 py-1 bg-studio-800 hover:bg-studio-700 text-slate-300 hover:text-white rounded-lg transition-all font-bold cursor-pointer"
          >
            ✕ 退出聚焦，返回连续时间轴
          </button>
        </div>

        <!-- 仅看收藏激活提示条 -->
        <div
          v-if="onlyFavorite && activeMainTab !== 'trash'"
          class="flex items-center justify-between p-3 bg-amber-950/40 border border-amber-800/80 rounded-xl text-xs"
        >
          <div class="flex items-center space-x-2 text-amber-200">
            <span class="font-bold flex items-center space-x-1">
              <StudioIcon name="star" :size="14" customClass="text-amber-400" />
              <span>当前正在筛选「我的收藏」素材</span>
            </span>
            <span class="text-amber-300/80 font-mono">共 {{ totalAssetsCount }} 件收藏素材</span>
          </div>
          <button
            @click="onlyFavorite = false; reloadAssets(true);"
            class="px-2.5 py-1 bg-amber-900/60 hover:bg-amber-800 text-amber-200 rounded-lg transition-all font-bold cursor-pointer"
          >
            ✕ 清除收藏限制，查看全部
          </button>
        </div>

        <!-- 加载初态骨架屏 -->
        <div v-if="loading && assetsList.length === 0" class="flex flex-col items-center justify-center py-24 space-y-4">
          <div class="w-12 h-12 rounded-full border-4 border-studio-accent border-t-transparent animate-spin"></div>
          <span class="text-sm text-slate-400 font-medium">正在连接素材服务并加载资产…</span>
        </div>

        <!-- 三级回退全挂 / 请求失败：显式错误面板（不再伪装成“未找到匹配素材”） -->
        <div
          v-else-if="loadError"
          class="flex flex-col items-center justify-center py-28 space-y-5 text-center"
        >
          <div class="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-3xl">
            {{ isAllDown() ? '📡' : '⚠️' }}
          </div>
          <div class="space-y-1.5">
            <h3 class="text-base font-bold text-red-300">
              {{ isAllDown() ? '无法连接素材服务器' : '素材加载失败' }}
            </h3>
            <p class="text-xs text-slate-400 max-w-md leading-relaxed">
              {{ loadError }}
            </p>
            <p class="text-[11px] text-slate-500 font-mono pt-1">
              回退链：{{ fallbackChainText }}
            </p>
            <p class="text-[11px] text-slate-500 font-mono">
              当前生效：{{ activeServer }}
            </p>
          </div>

          <!-- 公网/备用服务器手动指定（对标 App 设置页） -->
          <div class="flex items-center gap-2 pt-1">
            <input
              v-model="manualServerInput"
              type="text"
              placeholder="公网地址，如 https://material.example.com"
              class="w-72 bg-studio-900 border border-studio-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-studio-accent"
            />
            <button
              @click="saveManualServer"
              class="px-4 py-2 rounded-lg bg-studio-800 hover:bg-studio-700 border border-studio-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              保存并重探
            </button>
          </div>

          <div class="flex items-center gap-3 pt-1">
            <button
              @click="reconnectAndReload"
              :disabled="reconnecting"
              class="px-5 py-2.5 bg-studio-accent text-white text-xs font-bold rounded-lg hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
            >
              {{ reconnecting ? '正在重新探测…' : '重新探测并连接' }}
            </button>
            <button
              @click="clearManualAndReload"
              v-if="getManualServer()"
              class="px-4 py-2.5 bg-studio-850 text-slate-300 text-xs font-bold rounded-lg border border-studio-700 hover:bg-studio-800 cursor-pointer"
            >
              清除手动地址
            </button>
          </div>
        </div>

        <!-- 空数据提示 -->
        <div
          v-else-if="!loading && assetsList.length === 0"
          class="flex flex-col items-center justify-center py-32 space-y-4 text-center"
        >
          <div class="w-16 h-16 rounded-2xl bg-studio-900 border border-studio-700 flex items-center justify-center text-3xl">
            {{ activeMainTab === 'trash' ? '🗑️' : (activeMainTab === 'clip' ? '🎬' : '📂') }}
          </div>
          <div class="space-y-1">
            <h3 class="text-base font-bold text-slate-200">
              {{ activeMainTab === 'trash' ? '回收站暂无素材'
                : (activeMainTab === 'clip'
                  ? (activeSubCategory === 'output' ? '还没有剪辑成片' : (activeClipProject ? '这个项目没引用过素材' : '还没有备份过剪辑工程'))
                  : '未找到匹配的素材资产') }}
            </h3>
            <p class="text-xs text-slate-400 max-w-sm">
              {{ activeMainTab === 'trash'
                ? '已被拦截或删除的废弃资产将保留在此处 30 天，期间可随时恢复。'
                : (activeMainTab === 'clip'
                  ? (activeSubCategory === 'output'
                    ? '剪辑导出成片后会自动登记到这里（assets.source = edit）。'
                    : '剪辑素材只收进被云端快照引用过的内容。到剪辑台点「备份到云端」，之后即可在此按项目查看。')
                  : '请尝试切换分类大项、清空关键词搜索或重置筛选条件。') }}
            </p>
          </div>
          <button
            v-if="activeFilterCount > 0 || keyword || filterDate"
            @click="clearAllFilters(); keyword = ''; filterDate = ''; reloadAssets(true);"
            class="px-4 py-2 bg-studio-accent text-white text-xs font-bold rounded-lg hover:brightness-110 transition-all cursor-pointer"
          >
            清空所有过滤条件
          </button>
        </div>

        <!-- 真实素材展示 (按日期分节贯穿连续瀑布流) -->
        <template v-else>
          <div class="space-y-8">
            <section
              v-for="group in groupedAssets"
              :key="group.dateStr"
              :id="'section-' + group.dateStr"
              :data-date-section="group.dateStr"
              class="space-y-3"
            >
              <!-- 日期分节 Sticky Header (完全参照 rgallery 原生质感) -->
              <div class="sticky top-0 z-20 -mx-1 px-3 py-2 rounded-xl backdrop-blur-md bg-studio-950/85 border-b border-studio-750/70 flex items-center justify-between shadow-xs">
                <div class="flex items-center space-x-2.5">
                  <span class="w-2 h-2 rounded-full bg-studio-accent shadow-xs shadow-studio-accent/50"></span>
                  <h3 class="text-xs sm:text-sm font-bold text-slate-100 tracking-wide font-sans">
                    {{ group.formattedDate }}
                  </h3>
                  <span class="text-xs text-slate-400 font-medium">
                    {{ group.weekday }}
                  </span>
                  <span class="px-2 py-0.5 text-[10px] font-mono font-semibold bg-studio-900 text-slate-300 rounded-full border border-studio-750">
                    {{ group.items.length }} 件素材
                  </span>
                </div>

                <div class="flex items-center space-x-2 text-xs">
                  <button
                    @click="toggleFocusDay(group.dateStr)"
                    :class="[
                      'px-2 py-0.5 rounded text-[11px] font-mono transition-all cursor-pointer flex items-center space-x-1',
                      filterDate === group.dateStr
                        ? 'bg-studio-accent text-white font-bold shadow-xs'
                        : 'bg-studio-900 text-slate-400 hover:text-slate-200 border border-studio-750 hover:bg-studio-850'
                    ]"
                    :title="filterDate === group.dateStr ? '退出聚焦，返回连续全量时间轴' : '仅聚焦此日期的素材'"
                  >
                    <span>{{ filterDate === group.dateStr ? '✕ 退出聚焦' : '🔍 聚焦当天' }}</span>
                  </button>
                </div>
              </div>

              <!-- 当天素材瀑布流 / 网格 -->
              <div
                :class="[
                  layoutMode === 'masonry'
                    ? 'columns-2 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 gap-4 space-y-4'
                    : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'
                ]"
              >
                <div
                  v-for="item in group.items"
                  :key="item.fid"
                  :class="[
                    'group relative bg-studio-900 border rounded-xl overflow-hidden transition-all duration-200 cursor-pointer',
                    layoutMode === 'masonry' ? 'break-inside-avoid' : '',
                    'border-studio-750 hover:border-slate-500 hover:shadow-2xl hover:-translate-y-1'
                  ]"
                  @click="openAssetDetailModal(item)"
                >
                  <!-- 资产图片容器 (依据自然高宽比自适应大图) -->
                  <div
                    class="relative bg-studio-950 overflow-hidden flex items-center justify-center"
                    :style="getCardAspectStyle(item)"
                  >
                    <img
                      :src="getThumbnailSrc(item)"
                      :alt="item.file_name || item.fileName"
                      loading="lazy"
                      class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      @error="handleImageError"
                    />

                    <!-- 视频播放标记与时长徽标 -->
                    <div
                      v-if="item.kind === 'video' || item.media_type === 'video'"
                      class="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none group-hover:bg-black/10 transition-all"
                    >
                      <div class="w-10 h-10 rounded-full bg-black/60 backdrop-blur border border-white/20 flex items-center justify-center text-white shadow-lg">
                        <StudioIcon name="play" :size="18" />
                      </div>
                    </div>

                    <!-- 顶部浮层标签：画幅比例徽标与收藏星标 -->
                    <div class="absolute top-2 left-2 right-2 flex items-center justify-between z-20 pointer-events-none">
                      <!-- 画幅标识 -->
                      <span class="px-2 py-0.5 text-[10px] font-mono font-bold bg-black/60 backdrop-blur text-white rounded border border-white/10 shadow-sm pointer-events-auto">
                        {{ getItemOrientationLabel(item) }}
                      </span>

                      <!-- 收藏星标 / 回收站标识 -->
                      <button
                        v-if="activeMainTab !== 'trash'"
                        type="button"
                        @click.stop.prevent="handleToggleFavorite(item)"
                        :class="[
                          'w-7 h-7 rounded-full flex items-center justify-center backdrop-blur transition-all pointer-events-auto cursor-pointer shadow-md active:scale-90 hover:scale-110',
                          item.favorited_at
                            ? 'bg-amber-500 text-white shadow-amber-500/40 ring-2 ring-amber-300/50'
                            : 'bg-black/60 text-slate-300 hover:text-amber-400 hover:bg-black/80 border border-white/10'
                        ]"
                        :title="item.favorited_at ? '取消收藏' : '加入收藏'"
                      >
                        <StudioIcon name="star" :size="13" />
                      </button>
                      <span
                        v-else
                        class="px-2 py-0.5 text-[10px] font-bold bg-rose-950/80 text-rose-300 rounded border border-rose-800"
                      >
                        {{ item.disposeLabel || '已删除' }}
                      </span>
                    </div>

                    <!-- 悬停快捷操作遮罩 -->
                    <div class="absolute inset-0 bg-gradient-to-t from-studio-950/90 via-studio-950/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end z-10 pointer-events-none">
                      <div class="flex items-center justify-center space-x-2 py-2 pointer-events-auto">
                        <button
                          @click.stop="openAssetDetailModal(item)"
                          class="p-2 rounded-lg bg-studio-800/90 hover:bg-studio-accent text-white transition-all shadow-md cursor-pointer"
                          title="打开 Pinterest 模式详情大弹窗"
                        >
                          <StudioIcon name="maximize" :size="15" />
                        </button>

                        <button
                          v-if="activeMainTab !== 'trash'"
                          @click.stop="$emit('sendToChat', { ...item, url: getThumbnailSrc(item), imgUrl: getThumbnailSrc(item) })"
                          class="p-2 rounded-lg bg-studio-800/90 hover:bg-studio-accent text-white transition-all shadow-md cursor-pointer"
                          title="送入 AI 对话引用生成"
                        >
                          <StudioIcon name="chat" :size="15" />
                        </button>

                        <button
                          v-if="activeMainTab !== 'trash'"
                          @click.stop="$emit('sendToEdit', { ...item, url: getAssetImageUrl(item.fid, item.mediaToken), imgUrl: getAssetImageUrl(item.fid, item.mediaToken) })"
                          class="p-2 rounded-lg bg-studio-800/90 hover:bg-studio-accent text-white transition-all shadow-md cursor-pointer"
                          title="送入 AI 快捷/精准编辑"
                        >
                          <StudioIcon name="wand" :size="15" />
                        </button>

                        <button
                          v-if="activeMainTab !== 'trash'"
                          @click.stop="$emit('sendToClip', item)"
                          class="p-2 rounded-lg bg-studio-800/90 hover:bg-studio-accent text-white transition-all shadow-md cursor-pointer"
                          title="送入媒体剪辑轨道"
                        >
                          <StudioIcon name="video" :size="15" />
                        </button>

                        <a
                          :href="getAssetDownloadUrl(item.fid)"
                          download
                          @click.stop
                          class="p-2 rounded-lg bg-studio-800/90 hover:bg-studio-accent text-white transition-all shadow-md cursor-pointer"
                          title="下载原始素材"
                        >
                          <StudioIcon name="download" :size="15" />
                        </a>
                      </div>
                    </div>
                  </div>

                  <!-- 底部元数据卡片说明 (适老化大字改造：不展示文件名称，展示放大标签) -->
                  <div class="p-3.5 space-y-2.5">
                    <!-- 标签 Chip 摘要 (放大展示，作为卡片主导标识) -->
                    <div class="flex items-center space-x-1.5 flex-wrap gap-y-1.5">
                      <span
                        v-for="tag in getItemHighlightTags(item)"
                        :key="tag"
                        class="px-2.5 py-1 text-xs sm:text-sm font-bold bg-studio-800 text-slate-100 rounded-lg border border-studio-700 hover:border-studio-accent transition-colors shadow-2xs"
                      >
                        #{{ tag }}
                      </span>
                      <span
                        v-if="item.dominant_color"
                        class="w-3.5 h-3.5 rounded-full shrink-0 border border-slate-600 ml-auto"
                        :style="{ backgroundColor: getDominantColorHex(item.dominant_color) }"
                        :title="'主色: ' + item.dominant_color"
                      ></span>
                    </div>

                    <!-- 拍摄/录入日期小标签与文件大小 -->
                    <div class="flex items-center justify-between text-xs text-slate-400 font-mono pt-1.5 border-t border-studio-800/80">
                      <span>{{ formatDateTimeShort(item.created_at || item.discovered_at || item.updated_at) }}</span>
                      <span v-if="item.size">{{ formatFileSize(item.size) }}</span>
                    </div>

                    <!-- 回收站下显示原因细节 -->
                    <div v-if="activeMainTab === 'trash'" class="text-[11px] text-rose-300 pt-1 border-t border-rose-950/60">
                      <p class="truncate" :title="item.disposeDetail || item.disposeCriterion">
                        {{ item.disposeDetail || item.disposeCriterion }}
                      </p>
                      <span class="font-mono text-[10px] text-slate-400">保留剩余约 {{ item.remainingHours || 720 }} 小时</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <!-- 触底 Sentinel 观察哨 (实现无感滚动自动加载更多) -->
          <div ref="sentinelRef" class="w-full py-8 flex flex-col items-center justify-center space-y-2">
            <div v-if="loadingMore" class="flex items-center space-x-2 text-xs text-slate-400">
              <div class="w-4 h-4 rounded-full border-2 border-studio-accent border-t-transparent animate-spin"></div>
              <span>正在载入更多素材 (第 {{ currentPage }} 页)…</span>
            </div>
            <div v-else-if="!hasMore && assetsList.length > 0" class="text-xs text-slate-500 font-mono">
              ✦ 已展示全部素材 (共 {{ totalAssetsCount }} 件) ✦
            </div>
          </div>
        </template>
      </div>
    </div>

    </div>

    <!-- ========================================================================= -->
    <!-- 5. Pinterest 模式：全屏沉浸式素材详情大弹窗 (含 9:16、3:4、精修等衍生版本) -->
    <!-- ========================================================================= -->
    <div
      v-if="activeModalAsset"
      class="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 md:p-8 select-none transition-all"
      @click.self="closeAssetDetailModal"
    >
      <div class="relative w-full max-w-6xl h-[90vh] bg-studio-900 border border-studio-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row animate-in fade-in zoom-in-95 duration-150">
        <!-- ======================= 左侧：大图/视频展示视口 (占比约 62%) ======================= -->
        <div class="w-full md:w-[62%] h-[50%] md:h-full bg-studio-950 flex flex-col relative overflow-hidden select-none border-b md:border-b-0 md:border-r border-studio-750">
          <!-- 顶置版本状态指示与快速操作 -->
          <div class="absolute top-3 left-4 right-4 flex items-center justify-between z-20 pointer-events-none">
            <div class="flex items-center space-x-2 px-3 py-1 bg-black/70 backdrop-blur-md rounded-full border border-white/10 shadow-lg">
              <span class="text-xs font-bold text-studio-cyan">
                {{ activeDerivativeObj ? getDerivativeKindInfo(activeDerivativeObj.kind).icon : '🖼️' }}
                {{ activeDerivativeObj ? getDerivativeKindInfo(activeDerivativeObj.kind).label : '原始素材' }}
              </span>
              <span class="text-[10px] font-mono text-slate-400">
                {{ activeDerivativeObj?.width && activeDerivativeObj?.height ? `${activeDerivativeObj.width}×${activeDerivativeObj.height}` : getItemOrientationLabel(activeModalAsset) }}
              </span>
            </div>

            <div class="flex items-center space-x-2 pointer-events-auto">
              <span
                v-if="activeDerivativeObj?.sharedFromRepresentative"
                class="px-2 py-0.5 text-[10px] bg-amber-950/80 text-amber-300 rounded border border-amber-800"
                title="继承自主代表图净画衍生版本"
              >
                共享净画产物
              </span>
            </div>
          </div>

          <!-- 中心媒体呈现区 (大图自适应居中展现) -->
          <div class="flex-1 w-full h-full flex items-center justify-center p-6 relative overflow-hidden">
            <!-- 左右翻页：上一件 / 下一件 (支持键盘左右按键) -->
            <button
              v-if="currentModalAssetIndex > 0"
              @click.stop="navigateModalAsset(-1)"
              class="absolute left-3 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full bg-studio-900/85 hover:bg-studio-accent text-white border border-studio-700/80 shadow-2xl flex items-center justify-center transition-all cursor-pointer backdrop-blur-md active:scale-95 group hover:shadow-studio-accent/40"
              title="上一件素材 (快捷键: ←)"
            >
              <svg class="w-5 h-5 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              v-if="currentModalAssetIndex !== -1 && currentModalAssetIndex < assetsList.length - 1"
              @click.stop="navigateModalAsset(1)"
              class="absolute right-3 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full bg-studio-900/85 hover:bg-studio-accent text-white border border-studio-700/80 shadow-2xl flex items-center justify-center transition-all cursor-pointer backdrop-blur-md active:scale-95 group hover:shadow-studio-accent/40"
              title="下一件素材 (快捷键: →)"
            >
              <svg class="w-5 h-5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <div v-if="isDetailLoading" class="absolute inset-0 flex items-center justify-center bg-studio-950/50 backdrop-blur-sm z-10">
              <div class="w-8 h-8 rounded-full border-3 border-studio-accent border-t-transparent animate-spin"></div>
            </div>

            <!-- 视频播放器 -->
            <video
              v-if="activeModalAsset.kind === 'video' || activeModalAsset.media_type === 'video'"
              :src="getAssetDownloadUrl(activeModalAsset.fid)"
              controls
              autoplay
              class="max-h-full max-w-full rounded-xl object-contain shadow-2xl border border-white/5"
            ></video>

            <!-- 音频播放器 (优雅波形声波指示 + 独立音频控制器) -->
            <div
              v-else-if="activeModalAsset.kind === 'audio' || activeModalAsset.kind === 'music' || activeModalAsset.media_type === 'audio' || activeModalAsset.media_type === 'music'"
              class="flex flex-col items-center justify-center p-8 space-y-6 max-w-md w-full bg-studio-900/90 rounded-2xl border border-studio-700/80 shadow-2xl backdrop-blur-md z-10"
            >
              <div class="w-28 h-28 rounded-full bg-gradient-to-tr from-studio-accent to-cyan-500 flex items-center justify-center shadow-xl animate-pulse">
                <StudioIcon name="music" :size="44" customClass="text-white" />
              </div>
              <div class="text-center space-y-1 max-w-xs">
                <div class="text-sm font-bold text-slate-100 truncate">{{ activeModalAsset.file_name }}</div>
                <div class="text-xs text-slate-400 font-mono">{{ formatFileSize(activeModalAsset.size) }}</div>
              </div>
              <audio
                :src="getAssetDownloadUrl(activeModalAsset.fid)"
                controls
                autoplay
                class="w-full rounded-lg"
              ></audio>
            </div>

            <!-- 图片展示 -->
            <img
              v-else
              :src="getModalMainImageUrl()"
              :alt="activeModalAsset.file_name"
              class="max-h-full max-w-full rounded-xl object-contain shadow-2xl transition-all duration-200"
              @error="handleImageError"
            />
          </div>

          <!-- 底部浮动：衍生版本快速切换胶囊坞 (高对比度唯一样式，彻底杜绝看不清分辨率) -->
          <div
            v-if="availableDerivatives.length > 1"
            class="absolute bottom-4 inset-x-4 flex items-center justify-center space-x-2 overflow-x-auto no-scrollbar z-20 pointer-events-auto"
          >
            <div class="flex items-center space-x-1.5 p-1.5 bg-studio-900/95 backdrop-blur-md rounded-2xl border border-studio-700/80 shadow-2xl max-w-full overflow-x-auto no-scrollbar">
              <button
                v-for="d in availableDerivatives"
                :key="d.id"
                @click="activeDerivativeId = d.id"
                :class="[
                  'px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shrink-0 cursor-pointer',
                  activeDerivativeId === d.id
                    ? 'bg-studio-accent text-white shadow-lg shadow-studio-accent/40 ring-1 ring-studio-accent/30'
                    : 'text-slate-300 hover:text-slate-100 bg-studio-800 hover:bg-studio-750'
                ]"
              >
                <span>{{ getDerivativeKindInfo(d.kind).icon }}</span>
                <span>{{ getDerivativeKindInfo(d.kind).label }}</span>
                <span
                  :class="[
                    'px-1.5 py-0.5 text-[10px] rounded font-mono',
                    activeDerivativeId === d.id ? 'theme-capsule-badge-active' : 'theme-capsule-badge-inactive'
                  ]"
                >
                  {{ d.width && d.height ? `${d.width}×${d.height}` : getDerivativeKindInfo(d.kind).badge }}
                </span>
              </button>
            </div>
          </div>
        </div>

        <!-- ======================= 右侧：Pinterest 风格详情与衍生图清单 (占比约 38%) ======================= -->
        <div class="w-full md:w-[38%] h-[50%] md:h-full bg-studio-900 flex flex-col overflow-y-auto select-none">
          <div class="p-4 border-b border-studio-750 flex items-center justify-between shrink-0 bg-studio-900 sticky top-0 z-20">
            <div class="flex items-center space-x-2">
              <a
                :href="getModalDownloadUrl()"
                download
                class="px-3 py-1.5 bg-studio-accent hover:brightness-110 text-white rounded-lg text-xs font-bold transition-all shadow-md flex items-center space-x-1.5 cursor-pointer"
                title="下载当前查看的版本"
              >
                <StudioIcon name="download" :size="14" />
                <span>下载当前版本</span>
              </a>

              <button
                v-if="activeMainTab !== 'trash'"
                type="button"
                @click.stop.prevent="handleToggleFavorite(activeModalAsset)"
                :class="[
                  'px-3 py-1.5 rounded-lg border transition-all cursor-pointer flex items-center space-x-1.5 active:scale-95 shadow-sm text-xs',
                  activeModalAsset.favorited_at
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                    : 'bg-studio-850 border-studio-700 text-slate-300 hover:text-white hover:bg-studio-800'
                ]"
                :title="activeModalAsset.favorited_at ? '取消收藏素材' : '收藏此素材'"
              >
                <StudioIcon name="star" :size="15" :customClass="activeModalAsset.favorited_at ? 'text-amber-400' : ''" />
                <span>{{ activeModalAsset.favorited_at ? '已收藏' : '收藏' }}</span>
              </button>

              <button
                @click="copyFid(activeModalAsset.fid)"
                class="p-1.5 bg-studio-850 border border-studio-700 text-slate-300 hover:text-white hover:bg-studio-800 rounded-lg transition-all cursor-pointer"
                title="复制素材唯一 FID"
              >
                <StudioIcon name="copy" :size="16" />
              </button>
            </div>

            <div class="flex items-center space-x-2">
              <span
                v-if="currentModalAssetIndex !== -1"
                class="px-2 py-1 rounded-lg bg-studio-850 text-slate-300 font-mono text-[11px] border border-studio-750"
              >
                {{ currentModalAssetIndex + 1 }} / {{ assetsList.length }}
              </span>

              <button
                @click="closeAssetDetailModal"
                class="w-8 h-8 rounded-full bg-studio-850 hover:bg-studio-800 border border-studio-700 flex items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer"
                title="关闭详情弹窗 (Esc)"
              >
                <StudioIcon name="close" :size="16" />
              </button>
            </div>
          </div>

          <div class="p-5 space-y-6 text-xs flex-1">
            <!-- 标题与基本元数据 -->
            <div class="space-y-2">
              <h1 class="text-base font-extrabold text-white leading-snug break-words">
                {{ activeModalAsset.file_name || activeModalAsset.fileName }}
              </h1>
              <div class="flex items-center space-x-2 text-[11px] text-slate-400 flex-wrap gap-y-1">
                <span class="font-mono bg-studio-850 px-2 py-0.5 rounded border border-studio-750">
                  FID: {{ activeModalAsset.fid }}
                </span>
                <span class="bg-studio-850 px-2 py-0.5 rounded border border-studio-750 font-mono">
                  {{ formatFileSize(activeModalAsset.size) }}
                </span>
                <span class="bg-studio-850 px-2 py-0.5 rounded border border-studio-750 font-mono">
                  {{ formatDateTime(activeModalAsset.created_at) }}
                </span>
                <span
                  v-if="activeModalAsset.dominant_color"
                  class="flex items-center space-x-1 bg-studio-850 px-2 py-0.5 rounded border border-studio-750 font-medium"
                >
                  <span class="w-2.5 h-2.5 rounded-full border border-slate-600" :style="{ backgroundColor: getDominantColorHex(activeModalAsset.dominant_color) }"></span>
                  <span>{{ activeModalAsset.dominant_color }}</span>
                </span>
              </div>
            </div>

            <!-- 核心衍生图版本详细清单 (9:16、3:4、精修等) -->
            <div class="space-y-3 pt-2 border-t border-studio-800">
              <div class="flex items-center justify-between">
                <span class="text-xs font-extrabold text-slate-200 flex items-center space-x-1.5">
                  <span class="text-studio-cyan">✦</span>
                  <span>衍生版本与画幅重构 (共 {{ availableDerivatives.length }} 个版本)</span>
                </span>
                <span class="text-[10px] text-slate-400 font-mono">点击卡片切换左侧主视图</span>
              </div>

              <div class="space-y-2">
                <div
                  v-for="d in availableDerivatives"
                  :key="d.id"
                  @click="activeDerivativeId = d.id"
                  :class="[
                    'p-2.5 rounded-xl border transition-all flex items-center space-x-3 cursor-pointer',
                    activeDerivativeId === d.id
                      ? 'bg-studio-850 border-studio-accent ring-1 ring-studio-accent/50 shadow-md shadow-studio-accent/20'
                      : 'bg-studio-950/60 border-studio-750 hover:bg-studio-850 hover:border-slate-500'
                  ]"
                >
                  <div class="w-12 h-14 rounded-lg bg-studio-900 border border-studio-750 overflow-hidden shrink-0 flex items-center justify-center">
                    <img
                      :src="getDerivativeImageUrl(activeModalAsset.fid, d.id, activeModalAsset.mediaToken)"
                      :alt="d.kind"
                      class="w-full h-full object-cover"
                      @error="handleImageError"
                    />
                  </div>

                  <div class="flex-1 min-w-0 space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="font-bold text-slate-200 text-xs flex items-center space-x-1">
                        <span>{{ getDerivativeKindInfo(d.kind).icon }}</span>
                        <span>{{ getDerivativeKindInfo(d.kind).label }}</span>
                      </span>
                      <span
                        v-if="activeDerivativeId === d.id"
                        class="px-1.5 py-0.2 text-[9px] bg-studio-accent text-white font-bold rounded"
                      >
                        当前展示
                      </span>
                    </div>

                    <p class="text-[10px] text-slate-400 truncate">
                      {{ getDerivativeKindInfo(d.kind).desc }}
                    </p>

                    <div class="flex items-center space-x-2 text-[10px] font-mono text-slate-400">
                      <span class="text-studio-cyan font-bold">
                        {{ d.width && d.height ? `${d.width} × ${d.height}` : '自然尺寸' }}
                      </span>
                      <span v-if="d.storage_type" class="uppercase opacity-60">
                        · {{ d.storage_type }}
                      </span>
                    </div>
                  </div>

                  <a
                    :href="getDerivativeDownloadUrl(activeModalAsset.fid, d.id)"
                    download
                    @click.stop
                    class="p-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-300 hover:text-white transition-all border border-studio-700 shrink-0 cursor-pointer"
                    title="下载此衍生图"
                  >
                    <StudioIcon name="download" :size="13" />
                  </a>
                </div>
              </div>
            </div>

            <div class="flex gap-2 pt-2 border-t border-studio-800">
              <button type="button" class="choice px-3 py-2 rounded-lg text-sm font-bold" :class="{ 'is-on': detailPane === 'tags' }" @click="detailPane = 'tags'">
                <span class="choice-mark"></span>标签<span v-if="detailPane === 'tags'" class="choice-now">当前</span>
              </button>
              <button type="button" class="choice px-3 py-2 rounded-lg text-sm font-bold" :class="{ 'is-on': detailPane === 'lineage' }" @click="openLineagePane">
                <span class="choice-mark"></span>血缘<span v-if="detailPane === 'lineage'" class="choice-now">当前</span>
              </button>
            </div>

            <div v-if="detailPane === 'lineage'" class="space-y-3 text-sm">
              <button type="button" class="px-3 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold" @click="lineageGraphOpen = true">局部图谱</button>
              <p v-if="!lineageView.record.prompt && !lineageView.parent" class="text-slate-400">这件没有父图。下面只保留上传记录。</p>
              <p v-else-if="lineageView.parent">父图 {{ lineageView.parent.file_name || lineageView.parent.fid }}</p>
              <p v-if="lineageView.refs.length">参考 {{ lineageView.refs.map((item) => item.file_name || item.fid).join('、') }}</p>
              <p v-if="lineageView.children.length">后来的衍生 {{ lineageView.children.map((item) => item.file_name || item.fid).join('、') }}</p>
              <p v-if="restageVersionNames.length">画幅衍生 {{ restageVersionNames.join('、') }}</p>
              <div v-if="lineageView.usedByFilms && lineageView.usedByFilms.length" class="space-y-1">
                <p class="text-[11px] text-slate-400">剪辑使用</p>
                <div v-for="film in lineageView.usedByFilms" :key="film.fid" class="flex items-center gap-2">
                  <span>成片 {{ film.file_name || film.fid }}</span>
                </div>
              </div>
              <div v-if="lineageView.record.editUses && lineageView.record.editUses.length" class="space-y-1">
                <p class="text-[11px] text-slate-400">这条成片用过</p>
                <p v-for="use in lineageView.record.editUses" :key="use.fid + use.start" class="text-[11px] text-slate-300">
                  {{ use.role }} {{ use.fid }} · {{ Number(use.start).toFixed(2) }}s 起 · {{ Number(use.duration).toFixed(2) }}s
                </p>
              </div>
              <p v-if="lineageView.record.projectId && !lineageView.record.prompt">提示词 没有 · 模型 没有 · 模式 没有</p>
              <p v-if="lineageView.record.prompt"><span class="font-bold">源提示词</span> {{ lineageView.record.prompt }}</p>
              <p v-if="lineageView.record.negative"><span class="font-bold">负向提示词</span> {{ lineageView.record.negative }}</p>
              <p>模型 {{ lineageView.record.model || '—' }} · 模式 {{ lineageView.record.mode || '—' }} · 画幅 {{ lineageView.record.ratio || '—' }}</p>
              <p>时间 {{ formatDateTime(lineageView.record.at || activeModalAsset.created_at) }}</p>
              <p v-if="lineageView.record.sessionId">来源会话 {{ lineageView.record.sessionId }}</p>
            </div>

            <!-- 智能分类与打标体系 -->
            <div v-else class="space-y-3 pt-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-extrabold text-slate-200">标签</span>
                <button v-if="!detailTagEditing" type="button" class="px-3 py-2 rounded-lg border border-studio-700 text-xs font-bold" @click="beginTagEdit">编辑</button>
              </div>
              <p v-if="!detailTagEditing" class="text-sm text-slate-200">分类 {{ categoryLabel(classifyCategory) }}</p>
              <div v-else class="space-y-2">
                <label class="space-y-1 block">
                  <span class="text-slate-400">分类</span>
                  <select v-model="classifyCategory" class="w-full rounded-lg border border-studio-700 bg-studio-950 px-2 py-2">
                    <option value="interior">室内</option>
                    <option value="exterior">室外</option>
                    <option value="portrait">空间人像</option>
                    <option value="clothing">服装服饰</option>
                    <option value="furniture">单品家具</option>
                  </select>
                </label>
                <label v-if="classifyCategory === 'interior' || classifyCategory === 'exterior'" class="space-y-1 block">
                  <span class="text-slate-400">空间</span>
                  <select v-model="classifySpace" class="w-full rounded-lg border border-studio-700 bg-studio-950 px-2 py-2">
                    <option value="">不改空间</option>
                    <option v-for="opt in dynamicFilters.space" :key="opt.dir || opt.key" :value="opt.dir || opt.key">{{ opt.label }}</option>
                  </select>
                </label>
                <label v-for="dim in detailDimsFor(classifyCategory)" :key="dim.key" class="space-y-1 block">
                  <span class="text-slate-400">{{ dim.title }}</span>
                  <select v-model="classifyDims[dim.key]" class="w-full rounded-lg border border-studio-700 bg-studio-950 px-2 py-2">
                    <option value="">不改</option>
                    <option v-for="opt in dim.options" :key="opt.key" :value="opt.key">{{ opt.label }}</option>
                  </select>
                </label>
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="px-3 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold" @click="saveClassify">保存</button>
                  <button type="button" class="px-3 py-2 rounded-lg border border-studio-700 text-xs font-bold" @click="cancelTagEdit">取消</button>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="px-3 py-2 rounded-lg border border-studio-700 text-xs font-bold" @click="runRetag">按成图重打标签</button>
                <button type="button" class="px-3 py-2 rounded-lg border border-studio-700 text-xs font-bold" @click="moveShelf('retouched')">移入精修</button>
                <button type="button" class="px-3 py-2 rounded-lg border border-studio-700 text-xs font-bold" @click="moveShelf('original')">移出精修</button>
                <button type="button" class="px-3 py-2 rounded-lg border border-studio-700 text-xs font-bold" @click="moveShelf('finished')">标为成品</button>
              </div>

              <div v-if="detailDimsFor(classifyCategory).length" class="space-y-2">
                <div v-for="dim in detailDimsFor(classifyCategory)" :key="dim.key" class="flex items-start space-x-2">
                  <span class="text-[11px] text-slate-400 font-bold shrink-0 w-16 pt-0.5">{{ dim.title }}:</span>
                  <div class="flex items-center flex-wrap gap-1">
                    <span
                      v-for="t in labelsForDim(dim.key)"
                      :key="t"
                      class="px-2 py-0.5 rounded-full bg-studio-accent/15 text-studio-accent border border-studio-accent/30 text-[11px] font-medium"
                    >{{ t }}</span>
                    <span v-if="!labelsForDim(dim.key).length" class="text-[11px] text-slate-500">没有</span>
                  </div>
                </div>
              </div>
              <div v-else class="space-y-2">
                <div v-if="getAssetGroupedTags(activeModalAsset, currentDetail).spaces.length" class="flex items-start space-x-2">
                  <span class="text-[11px] text-slate-400 font-bold shrink-0 w-16 pt-0.5">空间区域:</span>
                  <div class="flex items-center flex-wrap gap-1">
                    <span
                      v-for="t in getAssetGroupedTags(activeModalAsset, currentDetail).spaces"
                      :key="t"
                      class="px-2 py-0.5 rounded-full bg-studio-accent/15 text-studio-accent border border-studio-accent/30 text-[11px] font-medium"
                    >
                      {{ t }}
                    </span>
                  </div>
                </div>

                <div v-if="getAssetGroupedTags(activeModalAsset, currentDetail).styles.length" class="flex items-start space-x-2">
                  <span class="text-[11px] text-slate-400 font-bold shrink-0 w-16 pt-0.5">设计风格:</span>
                  <div class="flex items-center flex-wrap gap-1">
                    <span
                      v-for="t in getAssetGroupedTags(activeModalAsset, currentDetail).styles"
                      :key="t"
                      class="px-2 py-0.5 rounded-full bg-studio-cyan/15 text-studio-cyan border border-studio-cyan/30 text-[11px] font-medium"
                    >
                      {{ t }}
                    </span>
                  </div>
                </div>

                <div v-if="getAssetGroupedTags(activeModalAsset, currentDetail).materials.length" class="flex items-start space-x-2">
                  <span class="text-[11px] text-slate-400 font-bold shrink-0 w-16 pt-0.5">表面材质:</span>
                  <div class="flex items-center flex-wrap gap-1">
                    <span
                      v-for="t in getAssetGroupedTags(activeModalAsset, currentDetail).materials"
                      :key="t"
                      class="px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-800/80 text-[11px] font-medium"
                    >
                      {{ t }}
                    </span>
                  </div>
                </div>

                <div v-if="getAssetGroupedTags(activeModalAsset, currentDetail).others.length" class="flex items-start space-x-2">
                  <span class="text-[11px] text-slate-400 font-bold shrink-0 w-16 pt-0.5">其它特征:</span>
                  <div class="flex items-center flex-wrap gap-1">
                    <span
                      v-for="t in getAssetGroupedTags(activeModalAsset, currentDetail).others"
                      :key="t"
                      class="px-2 py-0.5 rounded-full bg-studio-800 text-slate-300 border border-studio-700 text-[11px]"
                    >
                      {{ t }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 回收站状态说明 -->
            <div v-if="activeMainTab === 'trash'" class="space-y-2 p-3 bg-rose-950/40 rounded-xl border border-rose-900/60 text-rose-200">
              <span class="font-bold flex items-center space-x-1">
                <span>⚠️</span>
                <span>回收站处置理由：{{ activeModalAsset.disposeLabel || '拦截/删除' }}</span>
              </span>
              <p class="text-[11px] opacity-90">{{ activeModalAsset.disposeDetail || activeModalAsset.disposeCriterion }}</p>
              <div class="flex items-center justify-between text-[10px] text-rose-300 pt-1 border-t border-rose-900/40">
                <span>剩余保留时间</span>
                <span class="font-mono font-bold">{{ activeModalAsset.remainingHours || 720 }} 小时</span>
              </div>
            </div>

            <!-- 跨板块专业调度动作坞 -->
            <div class="pt-4 space-y-2 border-t border-studio-800">
              <template v-if="activeMainTab !== 'trash'">
                <button
                  @click="handleSendToChatFromModal"
                  class="w-full py-2.5 bg-gradient-to-r from-studio-accent to-studio-indigo hover:opacity-95 text-white font-bold rounded-xl transition-all shadow-lg shadow-studio-accent/25 flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <StudioIcon name="chat" :size="16" />
                  <span>以当前版本加入 AI 对话引用生成</span>
                </button>

                <div class="grid grid-cols-2 gap-2">
                  <button
                    @click="handleSendToEditFromModal"
                    class="py-2 bg-studio-850 hover:bg-studio-800 text-slate-100 font-bold rounded-xl border border-studio-700 transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <StudioIcon name="wand" :size="14" />
                    <span>送入精准/快捷编辑</span>
                  </button>

                  <button
                    @click="handleSendToClipFromModal"
                    class="py-2 bg-studio-850 hover:bg-studio-800 text-slate-100 font-bold rounded-xl border border-studio-700 transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <StudioIcon name="video" :size="14" />
                    <span>送入多轨剪辑</span>
                  </button>
                </div>

                <button
                  @click="handleDeleteFromModal"
                  class="w-full py-2.5 theme-btn-danger font-bold rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer shadow-sm active:scale-98"
                >
                  <StudioIcon name="trash" :size="14" />
                  <span>移入回收站</span>
                </button>
              </template>

              <template v-else>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    @click="handleRestoreSingle(activeModalAsset.fid)"
                    class="py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-md flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    <StudioIcon name="check" :size="14" />
                    <span>恢复到素材库</span>
                  </button>

                  <button
                    @click="handlePurgeSingle(activeModalAsset.fid)"
                    class="py-2 bg-rose-700 hover:bg-rose-600 text-white font-bold rounded-xl transition-all shadow-md flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    <StudioIcon name="trash" :size="14" />
                    <span>彻底粉碎删除</span>
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <LineageGraph
      v-if="lineageGraphOpen && activeModalAsset"
      :fid="activeModalAsset.fid"
      :name="activeModalAsset.file_name || activeModalAsset.fileName || ''"
      :lineage="currentDetail?.lineage || null"
      :derivatives="currentDetail?.derivatives || []"
      @close="lineageGraphOpen = false"
      @open-detail="onGraphOpenDetail"
    />

    <SimilarityWorkbenchModal
      ref="workbenchModalRef"
      v-model:visible="similarityWorkbenchOpen"
      @resolved="reloadAssets(true)"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import StudioIcon from '../components/StudioIcon.vue';
import LineageGraph from '../components/LineageGraph.vue';
import SimilarityWorkbenchModal from '../components/SimilarityWorkbenchModal.vue';
import {
  ensureToken,
  fetchAssets,
  fetchTrashAssets,
  fetchAssetDetail,
  fetchTimelineDays,
  getDerivativeImageUrl,
  getDerivativeDownloadUrl,
  restoreFromTrash,
  purgeFromTrash,
  deleteAsset,
  toggleFavorite,
  getAssetImageUrl,
  getAssetPosterUrl,
  getAssetDownloadUrl,
  authFetch,
  moveAssetShelf,
  classifyAsset,
  retagAsset,
  ensureServerBase,
  serverLabel,
  isAllDown,
  listCandidates,
  listCandidateUrls,
  setManualServer,
  getManualServer,
  onServerStatusChange
} from '../api.js';

const emit = defineEmits(['sendToChat', 'sendToEdit', 'sendToClip']);

// =============================================================================
// 一级与二级菜单体系架构 (与 App 端完全统一：图片、视频、音频、回收站)
// =============================================================================

// 一级四大类
const MAIN_TABS = [
  { key: 'image', label: '图片', icon: 'image', subTitle: '图片品类细分' },
  { key: 'video', label: '视频', icon: 'video', subTitle: '视频形式细分' },
  { key: 'audio', label: '音频', icon: 'music', subTitle: '音频类型细分' },
  { key: 'trash', label: '回收站', icon: 'trash', subTitle: '废弃分类细分' }
];

// 二级子品类池 (随一级 Tab 联动)
const SUB_CATEGORIES_CONFIG = {
  image: [
    { key: 'all', label: '全部图片' },
    { key: 'interior_exterior', label: '室内外设计' },
    { key: 'portrait', label: '空间人像' },
    { key: 'clothing', label: '服装服饰' },
    { key: 'furniture', label: '单品家具' }
  ],
  video: [
    { key: 'all', label: '全部视频' },
    { key: 'walkthrough', label: '空间漫游' },
    { key: 'ad', label: '商业短片' }
  ],
  audio: [
    { key: 'all', label: '全部音频' },
    { key: 'bgm', label: '氛围背景乐' },
    { key: 'sfx', label: '环境音效' }
  ],
  trash: [
    { key: 'all', label: '全部废弃' },
    { key: 'gate_reject', label: 'AI 闸门拦截' },
    { key: 'web_user_deleted', label: '人工删除' }
  ]
};

// 画幅比例选项
const ORIENTATION_OPTIONS = [
  { key: 'portrait', label: '9:16 竖图' },
  { key: '3:4', label: '3:4 竖图' },
  { key: 'landscape', label: '16:9 横图' },
  { key: 'square', label: '1:1 方图' }
];

// 家具品类筛选项
const FURNITURE_CATS = [
  { key: 'sofa', label: '组合沙发' },
  { key: 'armchair', label: '单人扶手椅' },
  { key: 'dining_table', label: '餐桌' },
  { key: 'coffee_table', label: '茶几' },
  { key: 'wardrobe', label: '衣柜' },
  { key: 'sideboard', label: '餐边柜' },
  { key: 'pendant_lamp', label: '吊灯' },
  { key: 'wall_sconce', label: '壁灯' }
];

// 12 色标准调色板
const COLOR_DOTS = [
  { name: '原木/木色', hex: '#B45309' },
  { name: '米/奶油', hex: '#FDE68A' },
  { name: '灰', hex: '#94A3B8' },
  { name: '白', hex: '#FFFFFF' },
  { name: '黑', hex: '#1E293B' },
  { name: '绿', hex: '#10B981' },
  { name: '蓝', hex: '#3B82F6' },
  { name: '红', hex: '#EF4444' },
  { name: '黄', hex: '#EAB308' },
  { name: '橙', hex: '#F97316' },
  { name: '粉', hex: '#EC4899' },
  { name: '紫', hex: '#8B5CF6' }
];

// =============================================================================
// 响应式状态管理
// =============================================================================

const SOURCE_PLATES = [
  { key: 'original', label: '原素材' },
  { key: 'retouched', label: '精修素材' },
  { key: 'finished', label: '成品素材' },
  // 被云端剪辑工程引用的素材。只读视图，数据来自 clip_snapshot_assets 关联表，
  // 不做物理复制（底层按 sha256 去重，复制只会让归属变模糊）。
  { key: 'clip', label: '剪辑素材' },
  { key: 'trash', label: '回收站' }
];
const sourcePlate = ref('original');
const plateTabs = computed(() => {
  if (sourcePlate.value === 'clip') {
    return [{ key: 'clip', label: '剪辑素材', icon: 'video', subTitle: '被剪辑工程引用' }];
  }
  if (sourcePlate.value === 'trash') return MAIN_TABS.filter((tab) => tab.key === 'trash');
  return MAIN_TABS.filter((tab) => tab.key !== 'trash');
});
function setSourcePlate(key) {
  if (sourcePlate.value === key) return;
  sourcePlate.value = key;
  if (key === 'trash') {
    activeMainTab.value = 'trash';
    activeSubCategory.value = 'all';
  } else if (key === 'clip') {
    activeMainTab.value = 'clip';
    activeSubCategory.value = 'all';
  } else if (activeMainTab.value === 'trash' || activeMainTab.value === 'clip') {
    activeMainTab.value = 'image';
    activeSubCategory.value = 'interior_exterior';
  }
  reloadAssets(true);
}

const finishedFileInput = ref(null);
const detailPane = ref('tags');
const lineageGraphOpen = ref(false);
const similarityWorkbenchOpen = ref(false);
const workbenchModalRef = ref(null);

function openSimilarityWorkbench() {
  similarityWorkbenchOpen.value = true;
  nextTick(() => {
    workbenchModalRef.value?.loadWorkbench();
  });
}
const detailTagEditing = ref(false);
const classifyCategory = ref('interior');
const classifySpace = ref('');
const classifyDims = reactive({});
const DETAIL_CATEGORY_DIMS = {
  portrait: [
    { key: 'pose', title: '人像姿态', options: ['站姿', '坐姿', '行走', '倚靠', '交谈/互动'] },
    { key: 'character', title: '人物角色', options: ['商务精英', '居家男女', '亲子家庭', '青年学生', '休闲独处'] },
    { key: 'shot_type', title: '景别类型', options: ['全身照', '半身特写', '面部微距'] }
  ],
  clothing: [
    { key: 'clothing_category', title: '穿搭品类', options: ['上衣外套', '裤装裙装', '西服套装', '鞋履配饰'] },
    { key: 'season', title: '季节', options: ['春季', '夏季', '秋季', '冬季'] }
  ],
  furniture: [
    { key: 'furniture_item', title: '家具品类', options: FURNITURE_CATS },
    { key: 'furniture_craft', title: '工艺材质', options: ['木蜡油天然', '拉丝金属', '哑光烤漆', '做旧复古', '真皮', '岩板'] }
  ]
};
function detailDimsFor(category) {
  return (DETAIL_CATEGORY_DIMS[category] || []).map((dim) => ({
    ...dim,
    options: dim.options.map((item) => (typeof item === 'string' ? { key: item, label: item } : { key: item.key, label: item.label }))
  }));
}
function categoryLabel(category) {
  return ({ interior: '室内', exterior: '室外', portrait: '空间人像', clothing: '服装服饰', furniture: '单品家具' })[category] || category || '没有';
}
function labelsForDim(dimension) {
  const tags = currentDetail.value?.tags || activeModalAsset.value?.tags || [];
  return tags.map((tag) => {
    if ((tag.dimension || '') !== dimension) return '';
    return tag.label || tag.value || '';
  }).filter(Boolean);
}
function beginTagEdit() {
  detailTagEditing.value = true;
  for (const dim of detailDimsFor(classifyCategory.value)) {
    const tags = currentDetail.value?.tags || [];
    const hit = tags.find((tag) => tag.dimension === dim.key);
    classifyDims[dim.key] = hit ? (hit.dir || hit.label || '') : '';
  }
}
function cancelTagEdit() {
  detailTagEditing.value = false;
  classifyCategory.value = activeModalAsset.value?.category || 'interior';
  classifySpace.value = '';
}
const activeMainTab = ref('image'); // 默认展示图片大类
const activeSubCategory = ref('interior_exterior'); // 默认进入室内外设计
// 剪辑素材架的两个子库：素材=被云端快照引用过的输入，成品=剪辑导出的 mp4
const CLIP_SCOPES = [
  { key: 'input', label: '素材' },
  { key: 'output', label: '成品' }
];
const clipProjects = ref([]);
const activeClipProject = ref('');
const keyword = ref('');
const layoutMode = ref('masonry'); // 'masonry' | 'grid'
const showSidebarTimeline = ref(true);
const sidebarOpen = ref(typeof window !== 'undefined' ? window.innerWidth >= 1100 : true);
const storedSidebarWidth = Number(typeof localStorage !== 'undefined' ? localStorage.getItem('ml_lib_sidebar_w') : 0);
const sidebarWidth = ref(storedSidebarWidth >= 280 && storedSidebarWidth <= 480 ? storedSidebarWidth : 320);
const sidebarCollapsed = ref(typeof localStorage !== 'undefined' && localStorage.getItem('ml_lib_sidebar_open') === '0');
function openLibrarySidebar() {
  sidebarCollapsed.value = false;
  sidebarOpen.value = true;
  localStorage.setItem('ml_lib_sidebar_open', '1');
}
function startSidebarResize(event) {
  if (event.button != null && event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  const startW = sidebarCollapsed.value ? 0 : sidebarWidth.value;
  function move(ev) {
    const next = startW + (ev.clientX - startX);
    if (next < 280) {
      sidebarCollapsed.value = true;
      sidebarOpen.value = false;
      return;
    }
    sidebarCollapsed.value = false;
    sidebarOpen.value = true;
    sidebarWidth.value = Math.min(480, Math.round(next));
  }
  function up() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    localStorage.setItem('ml_lib_sidebar_w', String(sidebarWidth.value));
    localStorage.setItem('ml_lib_sidebar_open', sidebarCollapsed.value ? '0' : '1');
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function closeSidebarOnNarrow() {
  if (window.innerWidth < 1100) sidebarOpen.value = false;
}
const timelineMode = ref('horizontal'); // 'horizontal' (横向滚动一长条) | 'vertical' (侧边纵向滚动一长条)
const filterDate = ref(''); // 选中的精确日期 (YYYY-MM-DD 或 YYYY-MM)
const timelineDaysList = ref([]); // 时间轴精准到每一天的列表
const onlyFavorite = ref(false); // 仅看收藏筛选开关

function toggleOnlyFavorite() {
  onlyFavorite.value = !onlyFavorite.value;
  reloadAssets(true);
}

const showFilterBar = ref(true); // 筛选栏展开状态
const loading = ref(false);
const loadingMore = ref(false);
const loadError = ref(''); // 非空表示三级回退全挂后的真实断线状态（区别于“筛选无结果”）
const reconnecting = ref(false);
const activeServer = ref(serverLabel());
const fallbackChainText = listCandidates().join(' → ');
const manualServerInput = ref(getManualServer());
let stopServerWatch = null;
const currentPage = ref(1);
const pageSize = 60;
const totalAssetsCount = ref(0);
const hasMore = ref(true);

const assetsList = ref([]);
const trashTotal = ref(0);
const selectedFids = ref([]);

// Pinterest 模式详情大弹窗状态
const activeModalAsset = ref(null);
const currentDetail = ref(null);
const activeDerivativeId = ref(null);
const isDetailLoading = ref(false);

// 动态多维筛选状态集合
const filterState = reactive({
  space: [],
  style: [],
  wood_style: [],
  material: [],
  orientation: [],
  color: [],
  furniture_item: [],
  furniture_craft: [],
  video_source: [],
  pose: [],
  character: [],
  shot_type: [],
  mood: [],
  season: [],
  clothing_category: []
});

// 服务端返回的动态字典与各维度频次
const dynamicFilters = reactive({
  space: [],
  style_atom: [],
  wood_style: [],
  material_kind: [],
  colors: []
});

const scrollContainerRef = ref(null);
const sentinelRef = ref(null);
let observerInstance = null;

// =============================================================================
// 计算属性 (Computed)
// =============================================================================

const activeMainTabConfig = computed(() => {
  return MAIN_TABS.find(t => t.key === activeMainTab.value) || MAIN_TABS[0];
});

const currentSubCategories = computed(() => {
  // 剪辑素材下设「素材 / 成品」两个库，不复用上一级的品类细分
  if (activeMainTab.value === 'clip') return CLIP_SCOPES;
  return SUB_CATEGORIES_CONFIG[activeMainTab.value] || [];
});

const clipProjectChips = computed(() => {
  if (activeMainTab.value !== 'clip' || activeSubCategory.value !== 'input') return [];
  if (clipProjects.value.length === 0) return [];
  return [
    { key: '', label: '全部项目', count: null },
    ...clipProjects.value.map((p) => ({ key: p.label, label: p.label, count: p.count }))
  ];
});

const mainTabsWithoutTrash = computed(() => MAIN_TABS.filter((tab) => tab.key !== 'trash'));

const searchPlaceholder = computed(() => {
  switch (activeMainTab.value) {
    case 'image':
      if (activeSubCategory.value === 'portrait') return '搜索人像姿态、角色、景别…';
      if (activeSubCategory.value === 'clothing') return '搜索穿搭品类、风格、季节…';
      if (activeSubCategory.value === 'furniture') return '搜索家具单品、材质、工艺…';
      return '搜索空间、风格、木系、表面材质…';
    case 'video': return '搜索漫游样片、短片、来源…';
    case 'audio': return '搜索配乐情绪、音效场景…';
    case 'trash': return '搜索回收站废弃素材…';
    default: return '搜索文件名、标签、分类…';
  }
});

const collapsedFilters = reactive({});

function toggleFilterGroup(id) {
  collapsedFilters[id] = !collapsedFilters[id];
}

function filterGroupOpen(id) {
  return !collapsedFilters[id];
}

function asOptions(list, limit) {
  const rows = Array.isArray(list) ? list : [];
  return (limit ? rows.slice(0, limit) : rows).map((item) => {
    if (typeof item === 'string') return { key: item, label: item };
    if (item.dir != null) return { key: item.dir, label: item.label, count: item.count };
    return { key: item.key, label: item.label };
  });
}

const filterGroups = computed(() => {
  const tab = activeMainTab.value;
  const sub = activeSubCategory.value;
  const orient = (id, options) => ({ id, title: '画幅', dimension: 'orientation', kind: 'chip', options });
  if (tab === 'image' && sub === 'all') {
    return [orient('orient', asOptions(ORIENTATION_OPTIONS))];
  }
  if (tab === 'image' && sub === 'interior_exterior') {
    return [
      { id: 'space', title: '空间', dimension: 'space', kind: 'chip', options: asOptions(dynamicFilters.space) },
      { id: 'style', title: '风格', dimension: 'style', kind: 'chip', options: asOptions(dynamicFilters.style_atom) },
      { id: 'material', title: '材质', dimension: 'material', kind: 'chip', options: asOptions(dynamicFilters.material_kind, 8) },
      orient('orient', asOptions(ORIENTATION_OPTIONS)),
      { id: 'color', title: '主色', dimension: 'color', kind: 'color', options: COLOR_DOTS.map((c) => ({ key: c.name, label: c.name, hex: c.hex })) }
    ];
  }
  if (tab === 'image' && sub === 'portrait') {
    return [
      { id: 'pose', title: '人像姿态', dimension: 'pose', kind: 'chip', options: asOptions(['站姿', '坐姿', '行走', '倚靠', '交谈/互动']) },
      { id: 'character', title: '人物角色', dimension: 'character', kind: 'chip', options: asOptions(['商务精英', '居家男女', '亲子家庭', '青年学生', '休闲独处']) },
      { id: 'shot', title: '景别类型', dimension: 'shot_type', kind: 'chip', options: asOptions(['全身照', '半身特写', '面部微距']) }
    ];
  }
  if (tab === 'image' && sub === 'clothing') {
    return [
      { id: 'clothing', title: '穿搭品类', dimension: 'clothing_category', kind: 'chip', options: asOptions(['上衣外套', '裤装裙装', '西服套装', '鞋履配饰']) },
      { id: 'season', title: '季节', dimension: 'season', kind: 'chip', options: asOptions(['春季', '夏季', '秋季', '冬季']) }
    ];
  }
  if (tab === 'image' && sub === 'furniture') {
    return [
      { id: 'furniture', title: '家具品类', dimension: 'furniture_item', kind: 'chip', options: asOptions(FURNITURE_CATS) },
      { id: 'craft', title: '工艺材质', dimension: 'furniture_craft', kind: 'chip', options: asOptions(['木蜡油天然', '拉丝金属', '哑光烤漆', '做旧复古', '真皮', '岩板']) }
    ];
  }
  if (tab === 'video') {
    return [
      { id: 'source', title: '视频来源', dimension: 'video_source', kind: 'chip', options: asOptions([{ key: 'sync', label: '📱 手机实拍' }, { key: 'ai', label: '✨ AI 创作' }]) },
      orient('video-orient', asOptions([{ key: 'landscape', label: '16:9 横屏' }, { key: 'portrait', label: '9:16 竖屏' }]))
    ];
  }
  if (tab === 'audio') {
    return [
      { id: 'mood', title: '情绪氛围', dimension: 'mood', kind: 'chip', options: asOptions(['舒缓放松', '现代轻奢', '空灵静谧', '明快活力', '科技未来']) }
    ];
  }
  return [];
});

const activeFilterCount = computed(() => {
  let count = 0;
  for (const k in filterState) {
    count += filterState[k].length;
  }
  return count;
});

// =============================================================================
// rgallery 风格时间轴分组与刻度轨拖拽游标 (Timeline Scrubber) 核心架构
// =============================================================================

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function getAssetDateKey(item) {
  if (!item) return '未知时间';
  const ts = item.created_at || item.shoot_at || item.shootAt || item.mtimeMs || item.updated_at;
  if (!ts) return '未知时间';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '未知时间';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(dateStr) {
  if (!dateStr || dateStr === '未知时间') return '未记录日期素材';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  if (isToday(dateStr)) return `今天 · ${y}年${m}月${d}日`;
  if (isYesterday(dateStr)) return `昨天 · ${y}年${m}月${d}日`;
  return `${y}年${m}月${d}日`;
}

function getWeekdayDisplay(dateStr) {
  if (!dateStr || dateStr === '未知时间') return '';
  const d = new Date(dateStr + 'T00:00:00');
  return isNaN(d.getDay()) ? '' : WEEKDAYS[d.getDay()];
}

// 核心计算属性：将素材按日期连续分组 (贯穿随着滚动而滚动)
const groupedAssets = computed(() => {
  if (!assetsList.value || !assetsList.value.length) return [];
  const groups = [];
  const map = new Map();

  for (const item of assetsList.value) {
    const dateStr = getAssetDateKey(item);
    let grp = map.get(dateStr);
    if (!grp) {
      grp = {
        dateStr,
        formattedDate: formatDateDisplay(dateStr),
        weekday: getWeekdayDisplay(dateStr),
        items: []
      };
      map.set(dateStr, grp);
      groups.push(grp);
    }
    grp.items.push(item);
  }
  return groups;
});

function toggleFocusDay(dateStr) {
  if (filterDate.value === dateStr) {
    filterDate.value = '';
  } else {
    filterDate.value = dateStr;
  }
  reloadAssets(true);
}

// Scrubber 状态
const scrubberOuterRef = ref(null);
const scrubberScrollRef = ref(null);
const isDragging = ref(false);
const thumbTop = ref(null);
const scrubDisplayYear = ref('');
const scrubDisplayMonthDay = ref('');
const activeScrubDate = ref('');

const scrubberGroups = computed(() => {
  if (!timelineDaysList.value || !timelineDaysList.value.length) return [];
  const grps = [];
  const validDays = timelineDaysList.value.filter(d => d && d.day && /^\d{4}-\d{2}-\d{2}$/.test(d.day));
  if (!validDays.length) return [];

  const maxCount = Math.max(...validDays.map(d => d.count || 1), 1);
  const sorted = [...validDays].sort((a, b) => b.day.localeCompare(a.day));

  for (const item of sorted) {
    const parts = item.day.split('-');
    const year = parseInt(parts[0], 10);
    let g = grps.find(x => x.year === year);
    if (!g) {
      g = { year, nodes: [] };
      grps.push(g);
    }
    const tickWidth = Math.max(14, Math.min(46, Math.round(14 + ((item.count || 1) / maxCount) * 32)));
    g.nodes.push({
      key: item.day,
      dateStr: item.day,
      year,
      month: parts[1] || '01',
      day: parts[2] || '01',
      total: item.count || 0,
      tickWidth
    });
  }
  return grps;
});

const flatScrubberNodes = computed(() => {
  const list = [];
  for (const g of scrubberGroups.value) {
    for (const n of g.nodes) {
      list.push(n);
    }
  }
  return list;
});

const isSparseTimeline = computed(() => flatScrubberNodes.value.length > 0 && flatScrubberNodes.value.length <= 15);

function syncThumbToNode(node) {
  if (!node || !scrubberOuterRef.value || !scrubberScrollRef.value) return;
  scrubDisplayYear.value = String(node.year);
  scrubDisplayMonthDay.value = `${node.month}月${node.day}日`;
  activeScrubDate.value = node.dateStr;

  const tickEl = scrubberScrollRef.value.querySelector(`[data-scrub-date="${node.dateStr}"]`);
  if (tickEl) {
    const containerRect = scrubberOuterRef.value.getBoundingClientRect();
    const tickRect = tickEl.getBoundingClientRect();
    thumbTop.value = Math.max(30, Math.min(containerRect.height - 30, tickRect.top - containerRect.top + tickRect.height / 2));
  } else {
    const idx = flatScrubberNodes.value.findIndex(n => n.dateStr === node.dateStr);
    if (idx !== -1) {
      const containerRect = scrubberOuterRef.value.getBoundingClientRect();
      const progress = idx / Math.max(1, flatScrubberNodes.value.length - 1);
      thumbTop.value = 40 + progress * Math.max(100, containerRect.height - 80);
    }
  }
}

function syncThumbToDate(dateStr) {
  if (isDragging.value || !flatScrubberNodes.value.length) return;
  if (!dateStr) {
    const first = flatScrubberNodes.value[0];
    if (first) syncThumbToNode(first);
    return;
  }
  const node = flatScrubberNodes.value.find(n => n.dateStr === dateStr);
  if (node) {
    syncThumbToNode(node);
  }
}

watch([filterDate, flatScrubberNodes], () => {
  nextTick(() => {
    syncThumbToDate(filterDate.value);
  });
}, { immediate: true });

function updateThumbFromClientY(clientY, shouldScroll = false) {
  if (!scrubberOuterRef.value || !flatScrubberNodes.value.length) return;
  const containerRect = scrubberOuterRef.value.getBoundingClientRect();
  const relY = clientY - containerRect.top;
  const minTop = 32;
  const maxTop = containerRect.height - 32;
  thumbTop.value = Math.max(minTop, Math.min(maxTop, relY));

  let closestNode = null;
  let minDiff = Infinity;
  const tickEls = scrubberScrollRef.value?.querySelectorAll('[data-scrub-date]') || [];

  for (const el of tickEls) {
    const rect = el.getBoundingClientRect();
    const tickCenter = rect.top - containerRect.top + rect.height / 2;
    const diff = Math.abs(tickCenter - relY);
    if (diff < minDiff) {
      minDiff = diff;
      const dStr = el.getAttribute('data-scrub-date');
      closestNode = flatScrubberNodes.value.find(n => n.dateStr === dStr);
    }
  }

  if (!closestNode) {
    const progress = Math.max(0, Math.min(1, (relY - minTop) / (maxTop - minTop)));
    const idx = Math.floor(progress * (flatScrubberNodes.value.length - 1));
    closestNode = flatScrubberNodes.value[idx];
  }

  if (closestNode) {
    activeScrubDate.value = closestNode.dateStr;
    scrubDisplayYear.value = String(closestNode.year);
    scrubDisplayMonthDay.value = `${closestNode.month}月${closestNode.day}日`;

    if (shouldScroll) {
      const targetEl = document.getElementById('section-' + closestNode.dateStr);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }
  }
}

function handleThumbPointerDown(e) {
  if (e.pointerType === 'touch' && !e.isPrimary) return;
  e.preventDefault();
  e.stopPropagation();
  isDragging.value = true;
  e.currentTarget.setPointerCapture(e.pointerId);
  updateThumbFromClientY(e.clientY, true);
}

function handleThumbPointerMove(e) {
  if (!isDragging.value) return;
  e.preventDefault();
  updateThumbFromClientY(e.clientY, true);
}

function handleThumbPointerUp(e) {
  if (!isDragging.value) return;
  isDragging.value = false;
  try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  
  if (activeScrubDate.value) {
    const targetEl = document.getElementById('section-' + activeScrubDate.value);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      filterDate.value = activeScrubDate.value;
      reloadAssets(true);
    }
  }
}

function handleTickClick(node) {
  if (!node) return;
  activeScrubDate.value = node.dateStr;
  syncThumbToNode(node);
  const targetEl = document.getElementById('section-' + node.dateStr);
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    filterDate.value = node.dateStr;
    reloadAssets(true);
  }
}

function handleYearClick(group) {
  if (!group || !group.nodes.length) return;
  handleTickClick(group.nodes[0]);
}

function handleShowAllTimeline() {
  filterDate.value = '';
  reloadAssets(true);
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function handleTrackClick(e) {
  if (isDragging.value) return;
  updateThumbFromClientY(e.clientY, false);
  if (activeScrubDate.value) {
    const targetEl = document.getElementById('section-' + activeScrubDate.value);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      filterDate.value = activeScrubDate.value;
      reloadAssets(true);
    }
  }
}

function handleGalleryScroll() {
  if (isDragging.value || !scrollContainerRef.value || !flatScrubberNodes.value.length) return;
  const container = scrollContainerRef.value;
  const sectionEls = container.querySelectorAll('[data-date-section]');
  if (!sectionEls.length) return;

  const containerRect = container.getBoundingClientRect();
  const targetOffset = containerRect.top + 70;

  let currentVisibleDate = null;
  for (const el of sectionEls) {
    const rect = el.getBoundingClientRect();
    if (rect.top <= targetOffset && rect.bottom >= targetOffset) {
      currentVisibleDate = el.getAttribute('data-date-section');
      break;
    }
  }

  if (!currentVisibleDate) {
    if (container.scrollTop < 60 && sectionEls[0]) {
      currentVisibleDate = sectionEls[0].getAttribute('data-date-section');
    } else if (container.scrollTop + container.clientHeight >= container.scrollHeight - 60) {
      currentVisibleDate = sectionEls[sectionEls.length - 1].getAttribute('data-date-section');
    }
  }

  if (currentVisibleDate && currentVisibleDate !== activeScrubDate.value) {
    activeScrubDate.value = currentVisibleDate;
    const node = flatScrubberNodes.value.find(n => n.dateStr === currentVisibleDate);
    if (node) {
      syncThumbToNode(node);
    }
  }
}

// 当前弹窗中全部可用的衍生图列表 (包含 origin、restage_9_16、restage_3_4、精修等)
const availableDerivatives = computed(() => {
  if (currentDetail.value?.derivatives && currentDetail.value.derivatives.length > 0) {
    return currentDetail.value.derivatives;
  }
  if (activeModalAsset.value?.mainDerivative) {
    return [activeModalAsset.value.mainDerivative];
  }
  return [];
});

// 当前选中的衍生版本对象
const activeDerivativeObj = computed(() => {
  if (!availableDerivatives.value.length || !activeDerivativeId.value) return null;
  return availableDerivatives.value.find(d => d.id === activeDerivativeId.value) || availableDerivatives.value[0];
});

// =============================================================================
// 核心交互与数据加载方法
// =============================================================================

// 切换一级大类
function switchMainTab(key) {
  if (activeMainTab.value === key) return;
  activeMainTab.value = key;
  // 联动设定二级默认值
  activeSubCategory.value = key === 'image' ? 'interior_exterior' : (key === 'clip' ? 'input' : 'all');
  activeClipProject.value = '';
  filterDate.value = '';
  clearAllFilters();
  reloadAssets(true);
  loadTimelineDays();
}

// 剪辑「素材」库内按项目再筛一层；'' = 全部项目
function selectClipProject(key) {
  activeClipProject.value = key;
  reloadAssets(true);
}

// 切换二级分类
function switchSubCategory(key) {
  if (activeSubCategory.value === key) return;
  activeSubCategory.value = key;
  if (activeMainTab.value === 'clip') activeClipProject.value = '';
  clearAllFilters();
  reloadAssets(true);
  loadTimelineDays();
}

// 切换筛选条件
function toggleFilter(dimension, value) {
  if (!filterState[dimension]) filterState[dimension] = [];
  const idx = filterState[dimension].indexOf(value);
  if (idx > -1) {
    filterState[dimension].splice(idx, 1);
  } else {
    filterState[dimension].push(value);
  }
  reloadAssets(true);
}

function isFilterActive(dimension, value) {
  return filterState[dimension] && filterState[dimension].includes(value);
}

function clearAllFilters() {
  for (const k in filterState) {
    filterState[k] = [];
  }
  onlyFavorite.value = false;
  reloadAssets(true);
}

function handleSearch() {
  reloadAssets(true);
  loadTimelineDays();
}

// 点击侧边时间轴具体某一天
function handleSelectDay(day) {
  if (filterDate.value === day) {
    filterDate.value = '';
  } else {
    filterDate.value = day;
  }
  reloadAssets(true);
}

// 点击侧边时间轴月份标题筛选整月
function handleSelectMonth(monthKey) {
  if (filterDate.value === monthKey) {
    filterDate.value = '';
  } else {
    filterDate.value = monthKey;
  }
  reloadAssets(true);
}

// 组装 API 查询请求参数
function buildQueryParams(page = 1) {
  const params = {
    page,
    pageSize
  };

  if (keyword.value.trim()) {
    params.keyword = keyword.value.trim();
  }

  if (filterDate.value) {
    params.date = filterDate.value;
  }

  if (onlyFavorite.value) {
    params.only_favorite = 1;
  }
  if (sourcePlate.value !== 'trash' && sourcePlate.value !== 'clip') {
    params.shelf = sourcePlate.value;
  }

  // 1. 一级大分类映射
  if (activeMainTab.value === 'image') {
    params.media_type = 'image';
    if (activeSubCategory.value === 'interior_exterior') {
      params.category = 'interior_exterior';
    } else if (activeSubCategory.value === 'portrait') {
      params.category = 'portrait';
    } else if (activeSubCategory.value === 'clothing') {
      params.category = 'clothing';
    } else if (activeSubCategory.value === 'furniture') {
      params.category = 'furniture';
    }
  } else if (activeMainTab.value === 'video') {
    params.media_type = 'video';
    if (activeSubCategory.value === 'walkthrough') {
      params.category = 'video';
    } else if (activeSubCategory.value === 'ad') {
      params.category = 'finished';
    }
  } else if (activeMainTab.value === 'audio') {
    params.media_type = 'music';
    params.category = 'music';
  }

  // 2. 细分多维条件附带
  if (filterState.space.length) params.space = filterState.space[0];
  if (filterState.style.length) params.style = filterState.style[0];
  if (filterState.material.length) params.material = filterState.material[0];
  if (filterState.orientation.length) params.orientation = filterState.orientation[0];
  if (filterState.color.length) params.colors = filterState.color.join(',');
  if (filterState.furniture_item.length) params.furniture_item = filterState.furniture_item[0];
  if (filterState.furniture_craft.length) params.furniture_craft = filterState.furniture_craft[0];
  if (filterState.video_source.length) params.video_source = filterState.video_source[0];
  if (filterState.pose.length) params.pose = filterState.pose[0];
  if (filterState.character.length) params.character = filterState.character[0];
  if (filterState.shot_type.length) params.shot_type = filterState.shot_type[0];
  if (filterState.mood.length) params.mood = filterState.mood[0];

  return params;
}

// 拉取侧边时间轴精准到每一天的统计列表
async function loadTimelineDays() {
  if (activeMainTab.value === 'trash') {
    timelineDaysList.value = [];
    return;
  }
  try {
    const params = {};
    if (activeMainTab.value === 'image') {
      params.media_type = 'image';
      if (activeSubCategory.value !== 'all') {
        params.category = activeSubCategory.value;
      }
    } else if (activeMainTab.value === 'video') {
      params.media_type = 'video';
    } else if (activeMainTab.value === 'audio') {
      params.media_type = 'music';
    }
    const days = await fetchTimelineDays(params);
    timelineDaysList.value = days || [];
  } catch (e) {
    console.warn('获取时间轴天数失败:', e.message);
  }
}

// 重新加载素材列表
async function reloadAssets(reset = true) {
  if (reset) {
    currentPage.value = 1;
    hasMore.value = true;
    assetsList.value = [];
    selectedFids.value = [];
  }

  loading.value = true;
  loadError.value = '';
  try {
    await ensureToken();

    // 剪辑素材：只读视图，严格限定在剪辑域内。
    // 素材 = clip_snapshot_assets 关联到云端快照的输入；成品 = source='edit' 的导出片。
    // 不参与分页搜索的常规参数（keyword/date 等），保持简单。
    if (activeMainTab.value === 'clip') {
      const token = localStorage.getItem('ml_token') || '';
      const offset = (currentPage.value - 1) * pageSize;
      const scope = activeSubCategory.value === 'output' ? 'output' : 'input';
      const projectQuery = scope === 'input' && activeClipProject.value
        ? `&project=${encodeURIComponent(activeClipProject.value)}`
        : '';
      const res = await fetch(
        `/editor-api/clip-assets?limit=${pageSize}&offset=${offset}&scope=${scope}${projectQuery}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      const items = (data.items || []).map((it) => ({
        ...it,
        // 卡片层同时兼容 file_name/fileName 与 thumb_url/thumbUrl 两种写法
        fileName: it.file_name,
        thumbUrl: it.thumb_url || null
      }));
      clipProjects.value = data.projects || [];
      assetsList.value = items;
      totalAssetsCount.value = Number(data.total) || items.length;
      hasMore.value = items.length >= pageSize;
      return;
    }

    if (activeMainTab.value === 'trash') {
      const res = await fetchTrashAssets({
        page: currentPage.value,
        pageSize,
        keyword: keyword.value.trim()
      });
      const items = res.items || [];
      trashTotal.value = res.total || items.length;
      totalAssetsCount.value = res.total || items.length;
      assetsList.value = items;
      hasMore.value = items.length >= pageSize;
    } else {
      const params = buildQueryParams(currentPage.value);
      const res = await fetchAssets(params);
      const items = res.items || [];
      totalAssetsCount.value = res.total || 0;

      if (res.filterOptions) {
        if (res.filterOptions.space) dynamicFilters.space = res.filterOptions.space;
        if (res.filterOptions.style_atom) dynamicFilters.style_atom = res.filterOptions.style_atom;
        if (res.filterOptions.wood_style) dynamicFilters.wood_style = res.filterOptions.wood_style;
        if (res.filterOptions.material_kind) dynamicFilters.material_kind = res.filterOptions.material_kind;
        if (res.filterOptions.colors) dynamicFilters.colors = res.filterOptions.colors;
      }

      if (currentPage.value === 1) {
        assetsList.value = items;
      } else {
        assetsList.value.push(...items);
      }

      hasMore.value = assetsList.value.length < totalAssetsCount.value && items.length > 0;
    }
  } catch (err) {
    // 未登录 / 会话过期：全局登录弹窗已弹出（ensureToken/authFetch 会广播事件），
    // 这里不展示错误面板，避免把“需要登录”误报成断线或空结果。
    if (err?.name === 'AuthRequiredError') {
      return;
    }
    console.error('加载素材失败:', err);
    // 三级回退（同源网关→本机→局域网/公网）全部不可达：
    // 显式展示断线面板，不再把失败伪装成“未找到匹配的素材资产”。
    const networkDown = err?.name === 'MLServerUnreachable'
      || err instanceof TypeError
      || (typeof err?.message === 'string' && /Failed to fetch|NetworkError|网络|无法连接|502|503|504/.test(err.message));
    if (networkDown || isAllDown()) {
      loadError.value = isAllDown()
        ? '无法连接素材服务器：同源网关、本机、局域网/公网候选均不可达'
        : (err?.message || '与素材服务的网络连接已断开');
    } else {
      // 服务在线但请求失败（权限、后端 5xx 等）：单独提示，不冒充“无匹配结果”
      loadError.value = err?.message || '素材服务请求失败';
    }
  } finally {
    loading.value = false;
  }
}

// 强制重新探活整个候选链并重载
async function reconnectAndReload() {
  if (reconnecting.value) return;
  reconnecting.value = true;
  try {
    await ensureServerBase({ force: true });
  } catch { /* 全挂时 loadError 会继续保留 */ }
  reconnecting.value = false;
  activeServer.value = serverLabel();
  reloadAssets(true);
}

// 保存公网/备用地址（App 设置页同款三级回退的人工入口）
async function saveManualServer() {
  const u = (manualServerInput.value || '').trim();
  await setManualServer(u);
  manualServerInput.value = getManualServer();
  activeServer.value = serverLabel();
  reloadAssets(true);
}

async function clearManualAndReload() {
  await setManualServer('');
  manualServerInput.value = '';
  activeServer.value = serverLabel();
  reloadAssets(true);
}

// 触底自动分页加载更多
async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value || activeMainTab.value === 'trash') return;
  loadingMore.value = true;
  currentPage.value++;
  try {
    const params = buildQueryParams(currentPage.value);
    const res = await fetchAssets(params);
    const items = res.items || [];
    if (items.length > 0) {
      assetsList.value.push(...items);
      hasMore.value = assetsList.value.length < totalAssetsCount.value;
    } else {
      hasMore.value = false;
    }
  } catch (err) {
    console.warn('加载更多素材失败:', err);
    hasMore.value = false;
  } finally {
    loadingMore.value = false;
  }
}

function setupIntersectionObserver() {
  if (observerInstance) observerInstance.disconnect();
  observerInstance = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (entry && entry.isIntersecting) {
        loadMore();
      }
    },
    { threshold: 0.1 }
  );

  if (sentinelRef.value) {
    observerInstance.observe(sentinelRef.value);
  }
}

// =============================================================================
// Pinterest 模式详情大弹窗核心调度
// =============================================================================

const lineageView = computed(() => currentDetail.value?.lineage || { record: {}, parent: null, refs: [], children: [], usedByFilms: [] });
const restageVersionNames = computed(() => {
  const list = currentDetail.value?.derivatives || [];
  const names = [];
  if (list.some((item) => item.kind === 'restage_9_16')) names.push('9:16 净画重构');
  if (list.some((item) => item.kind === 'restage_3_4')) names.push('3:4 净画重构');
  return names;
});

async function uploadFinished(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const body = new FormData();
  body.append('file', file);
  body.append('filename', file.name);
  body.append('category', 'finished');
  body.append('shelf', 'finished');
  body.append('source', 'upload');
  try {
    const res = await authFetch('/api/assets/ingest', { method: 'POST', body });
    const json = await res.json();
    if (!res.ok || json.success === false) throw new Error(json.error || '上传失败');
    reloadAssets(true);
  } catch (err) {
    alert(err.message || '上传失败');
  }
}

async function moveShelf(shelf) {
  if (!activeModalAsset.value?.fid) return;
  await moveAssetShelf(activeModalAsset.value.fid, shelf);
  activeModalAsset.value.library_shelf = shelf;
  reloadAssets(true);
}

async function saveClassify() {
  if (!activeModalAsset.value?.fid) return;
  const dims = {};
  for (const dim of detailDimsFor(classifyCategory.value)) {
    if (classifyDims[dim.key]) dims[dim.key] = classifyDims[dim.key];
  }
  try {
    await classifyAsset({
      fid: activeModalAsset.value.fid,
      category: classifyCategory.value,
      space: (classifyCategory.value === 'interior' || classifyCategory.value === 'exterior') ? (classifySpace.value || undefined) : undefined,
      dims
    });
  } catch (err) {
    alert(err.message || '保存失败');
    return;
  }
  activeModalAsset.value.category = classifyCategory.value;
  detailTagEditing.value = false;
  await openAssetDetailModal(activeModalAsset.value);
}

async function runRetag() {
  if (!activeModalAsset.value?.fid) return;
  await retagAsset(activeModalAsset.value.fid);
  alert('已按成图重新打标。手动改过的分类和空间会保留，其余标签会换掉。');
}

function openLineagePane() {
  detailPane.value = 'lineage';
  lineageGraphOpen.value = true;
}

function onGraphOpenDetail(asset) {
  if (!asset?.fid) return;
  lineageGraphOpen.value = false;
  const same = activeModalAsset.value?.fid === asset.fid ? activeModalAsset.value : null;
  openAssetDetailModal(same || { fid: asset.fid, file_name: asset.name || '' });
}

async function openAssetDetailModal(item) {
  lineageGraphOpen.value = false;
  activeModalAsset.value = item;
  activeDerivativeId.value = null;
  currentDetail.value = null;
  detailPane.value = 'tags';
  detailTagEditing.value = false;
  classifyCategory.value = item.category || 'interior';
  classifySpace.value = '';
  isDetailLoading.value = true;

  try {
    const detail = await fetchAssetDetail(item.fid);
    currentDetail.value = detail;
    if (detail?.asset?.favorited_at !== undefined) {
      activeModalAsset.value.favorited_at = detail.asset.favorited_at;
      item.favorited_at = detail.asset.favorited_at;
    }
    if (detail && detail.derivatives && detail.derivatives.length > 0) {
      // 优先展示 9:16 净画重构图，若无则展示原始图或首个版本
      const r916 = detail.derivatives.find(d => d.kind === 'restage_9_16');
      const origin = detail.derivatives.find(d => d.kind === 'origin');
      activeDerivativeId.value = r916 ? r916.id : (origin ? origin.id : detail.derivatives[0].id);
    }
  } catch (err) {
    console.warn('加载素材衍生图详情失败:', err.message);
  } finally {
    isDetailLoading.value = false;
  }
}

const currentModalAssetIndex = computed(() => {
  if (!activeModalAsset.value || !assetsList.value.length) return -1;
  return assetsList.value.findIndex(a => a.fid === activeModalAsset.value.fid);
});

function navigateModalAsset(step) {
  if (!activeModalAsset.value || !assetsList.value.length) return;
  const idx = currentModalAssetIndex.value;
  if (idx === -1) return;
  const targetIdx = idx + step;
  if (targetIdx >= 0 && targetIdx < assetsList.value.length) {
    openAssetDetailModal(assetsList.value[targetIdx]);
  }
}

function handleDetailKeydown(e) {
  if (!activeModalAsset.value) return;
  if (e.key === 'Escape' && lineageGraphOpen.value) {
    e.preventDefault();
    e.stopImmediatePropagation();
    lineageGraphOpen.value = false;
    return;
  }
  if (lineageGraphOpen.value) return;
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    navigateModalAsset(-1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    navigateModalAsset(1);
  } else if (e.key === 'Escape') {
    closeAssetDetailModal();
  }
}

watch(activeModalAsset, (val) => {
  if (val) {
    window.addEventListener('keydown', handleDetailKeydown);
  } else {
    window.removeEventListener('keydown', handleDetailKeydown);
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleDetailKeydown);
});

function closeAssetDetailModal() {
  lineageGraphOpen.value = false;
  activeModalAsset.value = null;
  currentDetail.value = null;
  activeDerivativeId.value = null;
}

function getDerivativeKindInfo(kind) {
  switch (kind) {
    case 'origin':
      return { label: '原始采集图', icon: '🖼️', badge: '原始母本', desc: '原始镜头视角与噪点保留' };
    case 'restage_9_16':
      return { label: '9:16 净画重构图', icon: '📱', badge: '9:16 满幅', desc: '手机竖屏满幅 · 净画去噪' };
    case 'restage_3_4':
      return { label: '3:4 净画重构图', icon: '📐', badge: '3:4 画报', desc: '小红书/画报标准比例 · 构图优化' };
    case 'ai_remove':
      return { label: 'AI 消除精修图', icon: '✨', badge: '精修去杂', desc: '智能消除杂物与瑕疵' };
    case 'clean':
      return { label: '画面净画精修', icon: '🧹', badge: '画面净化', desc: '智能去噪点与杂质' };
    case 'style_transferred':
      return { label: '风格重绘精修图', icon: '🎨', badge: '风格迁移', desc: '特定风格质感重构' };
    case 'portrait_redraw':
      return { label: '人像重绘精修图', icon: '👤', badge: '人像美化', desc: '虚拟人像细节重构' };
    case 'clarity_enhanced':
      return { label: '超分辨率增强图', icon: '🔍', badge: '超分高清', desc: '2K/4K 细节重采样' };
    default:
      return { label: kind || '衍生图版本', icon: '📄', badge: '衍生版本', desc: 'AI 生成衍生版本' };
  }
}

function getModalMainImageUrl() {
  if (!activeModalAsset.value) return '';
  const fid = activeModalAsset.value.fid;
  const mediaToken = activeModalAsset.value.mediaToken;
  if (activeDerivativeId.value) {
    return getDerivativeImageUrl(fid, activeDerivativeId.value, mediaToken);
  }
  return getAssetImageUrl(fid, mediaToken);
}

function getModalDownloadUrl() {
  if (!activeModalAsset.value) return '';
  const fid = activeModalAsset.value.fid;
  if (activeDerivativeId.value) {
    return getDerivativeDownloadUrl(fid, activeDerivativeId.value, activeDerivativeObj.value?.kind || 'derivative');
  }
  return getAssetDownloadUrl(fid);
}

function handleSendToChatFromModal() {
  emit('sendToChat', {
    ...activeModalAsset.value,
    url: getModalMainImageUrl(),
    imgUrl: getModalMainImageUrl(),
    activeDerivativeId: activeDerivativeId.value,
    activeDerivativeKind: activeDerivativeObj.value?.kind || 'origin'
  });
  closeAssetDetailModal();
}

function handleSendToEditFromModal() {
  emit('sendToEdit', {
    ...activeModalAsset.value,
    url: getModalMainImageUrl(),
    imgUrl: getModalMainImageUrl(),
    activeDerivativeId: activeDerivativeId.value,
    activeDerivativeKind: activeDerivativeObj.value?.kind || 'origin'
  });
  closeAssetDetailModal();
}

function handleSendToClipFromModal() {
  emit('sendToClip', {
    ...activeModalAsset.value,
    activeDerivativeId: activeDerivativeId.value,
    activeDerivativeKind: activeDerivativeObj.value?.kind || 'origin'
  });
  closeAssetDetailModal();
}

async function handleDeleteFromModal() {
  if (!confirm(`确认将素材「${activeModalAsset.value.file_name}」移入回收站吗？`)) return;
  try {
    await deleteAsset(activeModalAsset.value.fid);
    assetsList.value = assetsList.value.filter(a => a.fid !== activeModalAsset.value.fid);
    trashTotal.value++;
    closeAssetDetailModal();
  } catch (e) {
    alert('移入回收站失败: ' + e.message);
  }
}

async function handleRestoreSingle(fid) {
  try {
    await restoreFromTrash([fid]);
    closeAssetDetailModal();
    reloadAssets(true);
  } catch (e) {
    alert('恢复素材失败: ' + e.message);
  }
}

async function handlePurgeSingle(fid) {
  if (!confirm('确认彻底粉碎该素材吗？此操作不可逆！')) return;
  try {
    await purgeFromTrash([fid]);
    closeAssetDetailModal();
    reloadAssets(true);
  } catch (e) {
    alert('彻底粉碎失败: ' + e.message);
  }
}

function copyFid(fid) {
  navigator.clipboard.writeText(fid).then(() => {
    alert(`FID已复制到剪贴板:\n${fid}`);
  });
}

function getAssetGroupedTags(item, detail) {
  const allTags = detail?.tags || item?.tags || [];
  const res = { spaces: [], styles: [], materials: [], others: [] };
  for (const t of allTags) {
    const dim = t.dimension || '';
    const label = t.label || t.value || (typeof t === 'string' ? t : '');
    if (!label) continue;
    if (dim === 'space') {
      res.spaces.push(label);
    } else if (dim === 'style_atom' || dim === 'style' || dim === 'wood_style') {
      res.styles.push(label);
    } else if (dim === 'material_kind' || dim === 'materials_hard' || dim === 'materials_soft') {
      res.materials.push(label);
    } else {
      res.others.push(label);
    }
  }
  return res;
}

// =============================================================================
// 辅助与样式工具方法
// =============================================================================

function getThumbnailSrc(item) {
  if (!item) return '';
  if (item.thumbUrl) {
    const t = localStorage.getItem('ml_token');
    return t ? `${item.thumbUrl}&token=${encodeURIComponent(t)}` : item.thumbUrl;
  }
  if (item.kind === 'video' || item.media_type === 'video') {
    return getAssetPosterUrl(item.fid, item.mediaToken);
  }
  return getAssetImageUrl(item.fid, item.mediaToken);
}

function getCardAspectStyle(item) {
  if (!item) return {};
  if (item.width && item.height) {
    return {
      aspectRatio: `${item.width} / ${item.height}`,
      minHeight: '180px'
    };
  }
  const ori = item.origin_orientation || item.orientation;
  if (ori === 'portrait' || ori === '9:16') {
    return { aspectRatio: '9 / 16', minHeight: '260px' };
  }
  if (ori === '3:4') {
    return { aspectRatio: '3 / 4', minHeight: '220px' };
  }
  if (ori === 'square' || ori === '1:1') {
    return { aspectRatio: '1 / 1', minHeight: '180px' };
  }
  return { aspectRatio: '16 / 9', minHeight: '140px' };
}

function getItemOrientationLabel(item) {
  const ori = item.origin_orientation || item.orientation;
  if (ori === '9:16' || ori === 'portrait') return '9:16';
  if (ori === '3:4') return '3:4';
  if (ori === '16:9' || ori === 'landscape') return '16:9';
  if (ori === '1:1' || ori === 'square') return '1:1';
  return '自适应';
}

function getItemHighlightTags(item) {
  if (!item) return ['空间美学'];
  const list = [];
  if (item.tags && Array.isArray(item.tags)) {
    for (const t of item.tags) {
      const name = typeof t === 'string' ? t : (t.label || t.name);
      if (name && !list.includes(name)) list.push(name);
      if (list.length >= 4) break;
    }
  }
  if (item.style && !list.includes(item.style)) list.push(item.style);
  if (item.room_type && !list.includes(item.room_type)) list.push(item.room_type);
  if (item.material && !list.includes(item.material)) list.push(item.material);
  if (list.length === 0 && item.category) {
    const catMap = {
      interior: '室内设计',
      exterior: '建筑室外',
      portrait: '空间人像',
      clothing: '服饰搭配',
      furniture: '单品家具',
      video: '动态影像',
      music: '空间原声'
    };
    list.push(catMap[item.category] || item.category);
  }
  if (list.length === 0) list.push('空间美学');
  return list;
}

function getDominantColorHex(name) {
  const found = COLOR_DOTS.find(c => c.name.includes(name) || name.includes(c.name));
  return found ? found.hex : '#64748B';
}

async function handleToggleFavorite(item) {
  if (!item || !item.fid) return;
  const currentFavorited = !!item.favorited_at;
  const nextFavorited = !currentFavorited;

  // 乐观更新当前对象
  item.favorited_at = nextFavorited ? Date.now() : null;

  // 跨作用域双向同步：如果当前在看详情弹窗，则同时同步列表项与弹窗项
  const listItem = assetsList.value.find(a => a.fid === item.fid);
  if (listItem && listItem !== item) {
    listItem.favorited_at = item.favorited_at;
  }
  if (activeModalAsset.value && activeModalAsset.value.fid === item.fid && activeModalAsset.value !== item) {
    activeModalAsset.value.favorited_at = item.favorited_at;
  }

  try {
    const res = await toggleFavorite(item.fid, nextFavorited);
    const serverFavoritedAt = res?.data?.favoritedAt ?? (nextFavorited ? Date.now() : null);
    item.favorited_at = serverFavoritedAt;
    if (listItem) listItem.favorited_at = serverFavoritedAt;
    if (activeModalAsset.value && activeModalAsset.value.fid === item.fid) {
      activeModalAsset.value.favorited_at = serverFavoritedAt;
    }
  } catch (e) {
    console.warn('收藏操作失败:', e.message);
    // 失败回滚
    item.favorited_at = currentFavorited ? (item.favorited_at || Date.now()) : null;
    if (listItem) listItem.favorited_at = item.favorited_at;
    if (activeModalAsset.value && activeModalAsset.value.fid === item.fid) {
      activeModalAsset.value.favorited_at = item.favorited_at;
    }
    alert('收藏操作失败: ' + e.message);
  }
}

async function handleRestoreBatch() {
  if (!selectedFids.value.length) return;
  try {
    await restoreFromTrash(selectedFids.value);
    reloadAssets(true);
  } catch (e) {
    alert('恢复素材失败: ' + e.message);
  }
}

async function handlePurgeBatch() {
  if (!selectedFids.value.length) return;
  if (!confirm(`确认彻底粉碎选中的 ${selectedFids.value.length} 个废弃素材吗？此操作不可逆！`)) return;
  try {
    await purgeFromTrash(selectedFids.value);
    reloadAssets(true);
  } catch (e) {
    alert('彻底粉碎失败: ' + e.message);
  }
}

function formatDayShort(dayStr) {
  if (!dayStr) return '';
  const p = dayStr.split('-');
  return p.length === 3 ? `${p[1]}-${p[2]}` : dayStr;
}

function isToday(dayStr) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return dayStr === todayStr;
}

function isYesterday(dayStr) {
  const y = new Date(Date.now() - 86400000);
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  return dayStr === yStr;
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDateTime(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateTimeShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PLACEHOLDER_IMG = 'data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="100%" height="100%" fill="%23162032"/><text x="50%" y="50%" font-size="13" fill="%2364748B" text-anchor="middle" dominant-baseline="middle">🖼️ 缩略图生成中</text></svg>';

// <img>/@error 统一处理：当前 base 的媒体链路失败时，先按三级回退换服务器重试，
// 所有候选都不可达或资源确实 404 时才落到占位图。
async function handleImageError(e) {
  const el = e?.target || e?.currentTarget;
  if (!el) return;
  const curSrc = el.getAttribute('src') || '';
  if (curSrc.startsWith('data:')) return;

  // 只对我们自己的 API 媒体地址做跨 base 重试；外链/editor-api 直接占位
  const isApiMedia = /\/api\/viewer\/assets\//.test(curSrc);
  if (!isApiMedia) {
    el.onerror = null;
    el.src = PLACEHOLDER_IMG;
    return;
  }

  // 记录已在该元素上试过的 base，避免同一坏地址/同源反复触发
  if (!el.__mlImgTried) el.__mlImgTried = new Set();
  const curOrigin = (() => { try { return new URL(curSrc, window.location.href).origin; } catch { return ''; } })();
  el.__mlImgTried.add(curOrigin);

  // 重新探活，并从候选链里找一个还没试过的 base
  const { allDown } = await ensureServerBase({ force: true });
  activeServer.value = serverLabel();
  if (allDown) {
    el.onerror = null;
    el.src = PLACEHOLDER_IMG;
    return;
  }
  const candidates = listCandidateUrls();
  const next = candidates.find((c) => !el.__mlImgTried.has(new URL(c, window.location.href).origin));
  if (!next) {
    el.onerror = null;
    el.src = PLACEHOLDER_IMG;
    return;
  }
  let nextSrc = curSrc;
  try {
    const u = new URL(curSrc, window.location.href);
    nextSrc = `${next.replace(/\/$/, '')}${u.pathname}${u.search}`;
  } catch { /* ignore */ }
  el.src = nextSrc;
}

function handleKeyDown(e) {
  if (e.key === 'Escape' && lineageGraphOpen.value) {
    e.preventDefault();
    e.stopImmediatePropagation();
    lineageGraphOpen.value = false;
    return;
  }
  if (e.key === 'Escape' && activeModalAsset.value) {
    closeAssetDetailModal();
  }
}

watch(sentinelRef, () => {
  setupIntersectionObserver();
});

onMounted(() => {
  reloadAssets(true);
  loadTimelineDays();
  setTimeout(setupIntersectionObserver, 300);
  window.addEventListener('keydown', handleKeyDown);
  stopServerWatch = onServerStatusChange((detail) => {
    activeServer.value = detail.label || serverLabel();
  });
});

onUnmounted(() => {
  if (observerInstance) observerInstance.disconnect();
  window.removeEventListener('keydown', handleKeyDown);
  if (stopServerWatch) stopServerWatch();
});
</script>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
