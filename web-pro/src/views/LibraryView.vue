<template>
  <div class="view-root library-shell flex-1 flex flex-col h-full min-w-0 bg-studio-950 text-slate-100 overflow-hidden font-sans select-none relative" :class="{ 'is-filtering': filterOpen }">
    <div class="lane-sections" role="tablist" aria-label="当前板块">
      <template v-if="libraryRail === 'items'">
        <button v-for="sec in BASE_SECTIONS" :key="sec.key" type="button" role="tab" class="choice" :class="{ 'is-on': baseSection === sec.key }" :aria-selected="baseSection === sec.key" @click="chooseBaseSection(sec.key)">
          <span class="choice-mark" aria-hidden="true"></span>
          <span>{{ sec.label }}</span>
        </button>
      </template>
      <template v-else>
        <button v-for="sec in sectionRow" :key="sec.key" type="button" role="tab" class="choice" :class="{ 'is-on': activeSubCategory === sec.key }" :aria-selected="activeSubCategory === sec.key" @click="switchSubCategory(sec.key)">
          <span class="choice-mark" aria-hidden="true"></span>
          <span>{{ sec.label }}</span>
        </button>
        <div class="ml-auto flex items-center gap-2 mr-2">
          <!-- 上传本地素材直传按钮 -->
          <button
            v-if="['image', 'video', 'audio'].includes(activeMainTab)"
            type="button"
            @click="triggerAssetUpload"
            class="px-3 py-1 rounded-full bg-studio-800 hover:bg-studio-700 active:scale-95 text-white font-bold text-xs shadow-md flex items-center gap-1.5 cursor-pointer transition-all border border-white/20"
            :title="uploadButtonTitle"
          >
            <StudioIcon name="upload" :size="13" />
            <span>{{ uploadButtonLabel }}</span>
          </button>

          <!-- 视频提炼人声专用入口（仅音频板块） -->
          <button
            v-if="activeMainTab === 'audio'"
            type="button"
            @click="openVocalExtractor"
            class="px-3 py-1 rounded-full bg-gradient-to-r from-studio-accent to-studio-cyan hover:brightness-110 text-white font-bold text-xs shadow-md flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 border border-white/20"
            title="上传视频或选自素材库，基于 FFmpeg 频域自适应降噪剥离背景音提取纯人声"
          >
            <StudioIcon name="mic" :size="13" />
            <span>🎙️ 视频提炼人声（去背景音）</span>
          </button>
        </div>
      </template>
    </div>
    <!-- 第二行：短筛选（快捷操作与状态收窄） -->
    <div class="lane-subrow" role="region" aria-label="快捷筛选">
      <!-- 1. 精修/成品是资产属性：与“只看收藏”一样的独立开关，不再是互斥板块 -->
      <template v-if="libraryRail === 'dam' && ['image', 'video', 'audio'].includes(activeMainTab)">
        <button
          type="button"
          class="subrow-btn"
          :class="{ 'is-on': onlyRetouched }"
          :aria-pressed="onlyRetouched"
          @click="toggleOnlyRetouched"
        >
          <StudioIcon name="wand" :size="14" />
          <span>只看精修</span>
        </button>
        <button
          type="button"
          class="subrow-btn"
          :class="{ 'is-on': onlyFinished }"
          :aria-pressed="onlyFinished"
          @click="toggleOnlyFinished"
        >
          <StudioIcon name="check" :size="14" />
          <span>只看成品</span>
        </button>
      </template>

      <!-- 2. 图片专属快捷项：空间搜索/下拉 + 只看收藏 + 高级筛选抽屉 -->
      <template v-if="activeMainTab === 'image' && libraryRail === 'dam'">
        <div class="subrow-dropdown-wrapper">
          <select v-model="quickSpace" class="subrow-select" aria-label="空间筛选" @change="onQuickSpaceChange">
            <option value="">空间: 全部</option>
            <option v-for="sp in SPACES_OPTIONS" :key="sp.key" :value="sp.key">{{ sp.label }}</option>
          </select>
        </div>

        <button
          type="button"
          class="subrow-btn"
          :class="{ 'is-on': onlyFavorite }"
          :aria-pressed="onlyFavorite"
          @click="toggleOnlyFavorite"
        >
          <StudioIcon name="star" :size="14" />
          <span>只看收藏</span>
        </button>

        <button
          type="button"
          class="subrow-btn"
          :class="{ 'is-on': filterOpen || hasActiveAdvancedFilters }"
          @click="filterOpen = !filterOpen"
        >
          <StudioIcon name="sliders" :size="14" />
          <span>高级筛选</span>
          <span v-if="activeAdvancedFilterCount > 0" class="subrow-badge">{{ activeAdvancedFilterCount }}</span>
        </button>
      </template>

      <!-- 3. 视频专属快捷项：来源 + 画幅 -->
      <template v-else-if="activeMainTab === 'video' && libraryRail === 'dam'">
        <div class="subrow-segment" role="radiogroup" aria-label="视频来源">
          <button
            v-for="src in VIDEO_SOURCE_OPTIONS"
            :key="src.key"
            type="button"
            role="radio"
            class="subrow-chip"
            :class="{ 'is-on': currentVideoSource === src.key }"
            @click="setQuickVideoSource(src.key)"
          >
            {{ src.label }}
          </button>
        </div>
        <div class="subrow-segment" role="radiogroup" aria-label="视频画幅">
          <button
            v-for="ori in VIDEO_ORIENTATION_OPTIONS"
            :key="ori.key"
            type="button"
            role="radio"
            class="subrow-chip"
            :class="{ 'is-on': currentVideoOrientation === ori.key }"
            @click="setQuickVideoOrientation(ori.key)"
          >
            {{ ori.label }}
          </button>
        </div>
      </template>

      <!-- 4. 音频专属快捷项：高级情绪筛选抽屉 -->
      <template v-else-if="activeMainTab === 'audio' && libraryRail === 'dam'">
        <button
          type="button"
          class="subrow-btn"
          :class="{ 'is-on': filterOpen || filterState.mood.length > 0 }"
          @click="filterOpen = !filterOpen"
        >
          <StudioIcon name="sliders" :size="14" />
          <span>情绪氛围</span>
          <span v-if="filterState.mood.length > 0" class="subrow-badge">{{ filterState.mood.length }}</span>
        </button>
      </template>

      <!-- 5. 基础素材专属快捷短筛选：使用面 / 部位 / 品类 / 风格方案 -->
      <template v-else-if="libraryRail === 'items'">
        <!-- 材质：使用面严格限定为 墙面、顶面、地面、软装、全屋定制 -->
        <template v-if="baseSection === 'material'">
          <div class="subrow-segment" role="radiogroup" aria-label="装修面">
            <button
              v-for="surf in BASE_SURFACE_TABS"
              :key="surf.key"
              type="button"
              role="radio"
              class="subrow-chip"
              :class="{ 'is-on': baseSurface === surf.key }"
              :aria-checked="baseSurface === surf.key"
              @click="baseSurface = surf.key"
            >
              {{ surf.label }}
            </button>
          </div>
          <!-- 材质种类细分：如乳胶漆、木作、石材等 -->
          <div v-if="materialKindTabs.length" class="subrow-segment" role="radiogroup" aria-label="材料种类">
            <button
              v-for="k in materialKindTabs"
              :key="k.key"
              type="button"
              role="radio"
              class="subrow-chip"
              :class="{ 'is-on': baseKind === k.key }"
              @click="baseKind = baseKind === k.key ? '' : k.key"
            >
              {{ k.label }}
            </button>
          </div>
          <!-- 瓷砖专属：光泽筛选与纹理筛选 -->
          <template v-if="baseKind === 'tile'">
            <div class="subrow-segment" role="radiogroup" aria-label="瓷砖光泽">
              <button
                v-for="g in TILE_GLOSS_TABS"
                :key="g.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': baseTileGloss === g.key }"
                @click="baseTileGloss = g.key"
              >
                {{ g.label }}
              </button>
            </div>
            <div class="subrow-segment" role="radiogroup" aria-label="瓷砖纹理">
              <button
                v-for="p in TILE_PATTERN_TABS"
                :key="p.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': baseTilePattern === p.key }"
                @click="baseTilePattern = p.key"
              >
                {{ p.label }}
              </button>
            </div>
          </template>

          <!-- 乳胶漆专属：主色筛选 (白/黄/绿/蓝/红/灰/黑/棕) 与角色建议 -->
          <template v-else-if="baseKind === 'latex'">
            <div class="subrow-segment" role="radiogroup" aria-label="主色色系">
              <button
                v-for="h in PAINT_HUE_TABS"
                :key="h.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': baseHue === h.key }"
                @click="baseHue = h.key"
              >
                {{ h.label }}
              </button>
            </div>
            <div class="subrow-segment" role="radiogroup" aria-label="角色建议">
              <button
                v-for="r in [{ key: '', label: '全部角色' }, { key: 'base', label: '基底' }, { key: 'accent', label: '强调' }]"
                :key="r.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': baseRole === r.key }"
                @click="baseRole = r.key"
              >
                {{ r.label }}
              </button>
            </div>
          </template>

          <!-- 木纹专属：固有属性优先（木种/色调/纹理/粗细/方向/拼法/质感），使用面仍走上排 -->
          <template v-else-if="isWoodKind">
            <div class="subrow-segment" role="radiogroup" aria-label="木种">
              <button
                v-for="w in WOOD_FILTERS.species"
                :key="w.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': woodFilter.species === w.key }"
                @click="woodFilter.species = woodFilter.species === w.key ? '' : w.key"
              >
                {{ w.label }}
              </button>
            </div>
            <div class="subrow-segment" role="radiogroup" aria-label="色调">
              <button
                v-for="w in WOOD_FILTERS.tones"
                :key="w.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': woodFilter.tone === w.key }"
                @click="woodFilter.tone = woodFilter.tone === w.key ? '' : w.key"
              >
                {{ w.label }}
              </button>
            </div>
            <div class="subrow-segment" role="radiogroup" aria-label="纹理">
              <button
                v-for="w in WOOD_FILTERS.grainTypes"
                :key="w.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': woodFilter.grainType === w.key }"
                @click="woodFilter.grainType = woodFilter.grainType === w.key ? '' : w.key"
              >
                {{ w.label }}
              </button>
            </div>
            <div class="subrow-segment" role="radiogroup" aria-label="纹理粗细">
              <button
                v-for="w in WOOD_FILTERS.scales"
                :key="w.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': woodFilter.scale === w.key }"
                @click="woodFilter.scale = woodFilter.scale === w.key ? '' : w.key"
              >
                {{ w.label }}
              </button>
            </div>
            <div class="subrow-segment" role="radiogroup" aria-label="木纹方向（源图）">
              <button
                v-for="w in WOOD_FILTERS.directions"
                :key="w.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': woodFilter.direction === w.key }"
                @click="woodFilter.direction = woodFilter.direction === w.key ? '' : w.key"
              >
                {{ w.label }}
              </button>
            </div>
            <div class="subrow-segment" role="radiogroup" aria-label="拼法">
              <button
                v-for="w in WOOD_FILTERS.layouts"
                :key="w.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': woodFilter.layout === w.key }"
                @click="woodFilter.layout = woodFilter.layout === w.key ? '' : w.key"
              >
                {{ w.label }}
              </button>
            </div>
            <div class="subrow-segment" role="radiogroup" aria-label="表面质感">
              <button
                v-for="w in WOOD_FILTERS.finishes"
                :key="w.key"
                type="button"
                role="radio"
                class="subrow-chip"
                :class="{ 'is-on': woodFilter.finish === w.key }"
                @click="woodFilter.finish = woodFilter.finish === w.key ? '' : w.key"
              >
                {{ w.label }}
              </button>
            </div>
            <span class="shrink-0 self-center text-[10px] text-slate-500" title="方向只记录源图本身的走向，不生成旋转/横竖变体">方向＝源图，不做旋转</span>
            <button v-if="hasWoodFilter" type="button" class="subrow-chip subrow-chip-reset" @click="resetWoodFilter">
              重置木纹筛选
            </button>
          </template>
        </template>

        <!-- 做法：吊顶、墙面、门板 -->
        <template v-else-if="baseSection === 'design'">
          <div class="subrow-segment" role="radiogroup" aria-label="做法部位">
            <button
              v-for="d in BASE_DESIGN_TABS"
              :key="d.key"
              type="button"
              role="radio"
              class="subrow-chip"
              :class="{ 'is-on': baseDesignTab === d.key }"
              @click="baseDesignTab = d.key"
            >
              {{ d.label }}
            </button>
          </div>
        </template>

        <!-- 选品：家具、灯具、洁具、软装 -->
        <template v-else-if="baseSection === 'product'">
          <div class="subrow-segment" role="radiogroup" aria-label="选品品类">
            <button
              v-for="p in BASE_PRODUCT_TABS"
              :key="p.key"
              type="button"
              role="radio"
              class="subrow-chip"
              :class="{ 'is-on': baseProductTab === p.key }"
              @click="baseProductTab = p.key"
            >
              {{ p.label }}
            </button>
          </div>
        </template>

        <!-- 风格方案：风格叶子 -->
        <template v-else-if="baseSection === 'scheme'">
          <div class="subrow-segment" role="radiogroup" aria-label="风格选择">
            <button
              v-for="leaf in schemeLeafTabs"
              :key="leaf.key"
              type="button"
              role="radio"
              class="subrow-chip"
              :class="{ 'is-on': schemeLeaf === leaf.key }"
              :aria-checked="schemeLeaf === leaf.key"
              @click="schemeLeaf = leaf.key; schemePick = ''"
            >
              {{ leaf.label }}<span v-if="baseSection === 'scheme'" class="ml-1 font-mono text-[10px] opacity-70">{{ leaf.count || 0 }}</span>
            </button>
          </div>
        </template>
      </template>
    </div>
    <div v-if="filterOpen" class="library-filter-scrim" @click="filterOpen = false"></div>
    <aside
      class="library-sidebar"
      :class="{ 'is-open': sidebarOpen, 'is-collapsed': sidebarCollapsed }"
      :role="filterOpen ? 'dialog' : undefined"
      :aria-modal="filterOpen ? 'true' : undefined"
      aria-label="筛选"
      @click.stop
    >
      <div class="filter-dialog-head">
        <p>筛选</p>
        <button ref="filterCloseBtn" type="button" class="filter-close" @click="filterOpen = false">关闭</button>
      </div>
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

        <template v-if="sourcePlate === 'clip'">
          <div class="sidebar-group">
            <button
              v-for="sub in CLIP_SCOPES"
              :key="'clip-' + sub.key"
              type="button"
              class="lib-l1"
              :class="{ 'is-on': activeSubCategory === sub.key }"
              @click="switchClipScope(sub.key)"
            >
              <span class="lib-mark" aria-hidden="true"></span>
              <span class="lib-l1-label">{{ sub.label }}</span>
              <span class="lib-now" v-if="activeSubCategory === sub.key">当前</span>
            </button>
          </div>
        </template>

        <!-- 分支 3：基础素材 (下设材质、做法、选品、风格方案) -->
        <template v-else-if="sourcePlate === 'base'">
          <div class="sidebar-group">
            <button
              v-for="sec in BASE_SECTIONS"
              :key="sec.key"
              type="button"
              class="lib-l1"
              :class="{ 'is-on': baseSection === sec.key }"
              @click="chooseBaseSection(sec.key)"
            >
              <span class="lib-mark" aria-hidden="true"></span>
              <span class="lib-l1-label">{{ sec.label }}</span>
              <span v-if="baseSection === sec.key" class="lib-now">当前</span>
            </button>
          </div>
        </template>

        <!-- 分支 4：回收站 -->
        <template v-else-if="sourcePlate === 'trash'">
          <div class="sidebar-group">
            <button type="button" class="lib-l1 is-on" disabled>
              <span class="lib-mark" aria-hidden="true"></span>
              <span class="lib-l1-label">回收站</span>
              <span v-if="trashTotal > 0" class="lib-count">{{ trashTotal }}</span>
            </button>
          </div>
        </template>
      </div>

      <!-- 下方独立专属筛选区 (彻底杜绝筛选串行) -->

      <div v-if="libraryRail === 'items'" class="lib-filters">
        <template v-if="baseSection === 'scheme'">
          <section class="lib-group">
            <div class="lib-group-head"><span>风格</span></div>
            <div class="lib-chips" role="radiogroup" aria-label="风格">
              <button v-for="leaf in schemeLeafTabs" :key="leaf.key" type="button" role="radio" class="lib-chip" :class="{ 'is-on': schemeLeaf === leaf.key }" :aria-checked="schemeLeaf === leaf.key" @click="schemeLeaf = leaf.key; schemePick = ''">
                <span>{{ leaf.label }}</span>
                <span v-if="baseSection === 'scheme'" class="ml-1 font-mono text-[10px] opacity-70">{{ leaf.count || 0 }}</span>
              </button>
            </div>
          </section>
          <section v-if="schemeNameChips.length" class="lib-group">
            <div class="lib-group-head"><span>配套</span></div>
            <div class="lib-chips">
              <button v-for="scheme in schemeNameChips" :key="scheme.id" type="button" class="lib-chip" :class="{ 'is-on': schemePick === scheme.id }" :aria-pressed="schemePick === scheme.id" @click="schemePick = schemePick === scheme.id ? '' : scheme.id">
                <span>{{ scheme.name_zh }}</span>
              </button>
            </div>
          </section>
        </template>
        <template v-else>
          <section class="lib-group">
            <div class="lib-group-head"><span>{{ baseSection === 'design' ? '部位' : baseSection === 'product' ? '品类' : '种类' }}</span></div>
            <div class="lib-chips" role="radiogroup" aria-label="种类">
              <button v-for="tab in kindTabs" :key="tab.key" type="button" role="radio" class="lib-chip" :class="{ 'is-on': baseKind === tab.key }" :aria-checked="baseKind === tab.key" @click="chooseBaseKind(tab.key)">
                <span>{{ tab.label }}</span>
              </button>
            </div>
          </section>
          <section v-if="brandTabs.length" class="lib-group">
            <div class="lib-group-head"><span>品牌</span></div>
            <div class="lib-chips">
              <button v-for="brand in brandTabs" :key="brand" type="button" class="lib-chip" :class="{ 'is-on': baseBrand === brand }" :aria-pressed="baseBrand === brand" @click="baseBrand = baseBrand === brand ? '' : brand; basePick = ''">
                <span>{{ brand }}</span>
              </button>
            </div>
          </section>
          <section v-if="hueTabs.length" class="lib-group">
            <div class="lib-group-head"><span>主色</span></div>
            <div class="lib-chips" role="radiogroup" aria-label="主色">
              <button v-for="hue in hueTabs" :key="hue.key" type="button" role="radio" class="lib-chip" :class="{ 'is-on': baseHue === hue.key }" :aria-checked="baseHue === hue.key" @click="baseHue = baseHue === hue.key ? '' : hue.key; basePick = ''">
                <span>{{ hue.label }}</span>
              </button>
            </div>
          </section>
          <section v-if="nameChips.length" class="lib-group">
            <div class="lib-group-head"><span>常用</span></div>
            <div class="lib-chips">
              <button v-for="item in nameChips" :key="item.id" type="button" class="lib-chip" :class="{ 'is-on': basePick === item.id }" :aria-pressed="basePick === item.id" @click="basePick = basePick === item.id ? '' : item.id">
                <span>{{ item.name_zh }}</span>
              </button>
            </div>
          </section>
        </template>
        <button v-if="baseHue || basePick || schemePick" type="button" class="lib-reset" @click="clearBaseFilters">重置全部筛选</button>
      </div>

      <!-- 1. 原素材/精修素材/成品素材专属筛选 (只看收藏、空间类型、风格流派、主导色系) -->
      <div v-if="sourcePlate === 'original' || sourcePlate === 'retouched' || sourcePlate === 'finished'" class="lib-filters">
        <section class="lib-group">
          <div class="lib-group-head"><span>素材状态</span></div>
          <div class="lib-chips" role="group" aria-label="素材状态">
            <button
              type="button"
              class="lib-chip"
              :class="{ 'is-on': onlyRetouched }"
              :aria-pressed="onlyRetouched"
              @click="toggleOnlyRetouched"
            >
              <span>只看精修</span>
            </button>
            <button
              type="button"
              class="lib-chip"
              :class="{ 'is-on': onlyFinished }"
              :aria-pressed="onlyFinished"
              @click="toggleOnlyFinished"
            >
              <span>只看成品</span>
            </button>
          </div>
        </section>
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

      <!-- 2. 剪辑素材专属筛选：素材混合排放图、视频、音频等所有用到的素材按照项目排布 -->
      <div v-else-if="sourcePlate === 'clip'" class="lib-filters">
        <template v-if="activeSubCategory === 'input'">
          <!-- 按项目排布 -->
          <section class="lib-group">
            <div class="lib-group-head">
              <span class="font-bold text-white text-xs">按剪辑项目排布</span>
              <span class="lib-meta">{{ clipProjects.length }} 个项目</span>
            </div>
            <div class="lib-chips mt-2">
              <button
                v-for="pr in clipProjectChips"
                :key="'clip-proj-' + (pr.key || 'all')"
                type="button"
                class="lib-chip"
                :class="{ 'is-on': activeClipProject === pr.key }"
                @click="selectClipProject(pr.key); closeSidebarOnNarrow()"
              >
                <span>{{ pr.label }}</span>
                <span v-if="pr.count != null" class="lib-count">{{ pr.count }}</span>
              </button>
            </div>
          </section>

          <!-- 媒体类型快速过滤 (图/视/音混排) -->
          <section class="lib-group mt-3">
            <div class="lib-group-head">
              <span class="font-bold text-white text-xs">媒体类型过滤</span>
            </div>
            <div class="lib-chips mt-2">
              <button
                v-for="mt in CLIP_MEDIA_TYPES"
                :key="mt.key"
                type="button"
                class="lib-chip"
                :class="{ 'is-on': clipMediaTypeFilter === mt.key }"
                @click="clipMediaTypeFilter = mt.key; reloadAssets(true)"
              >
                <span>{{ mt.label }}</span>
              </button>
            </div>
          </section>
        </template>
        <template v-else>
          <div class="p-3 rounded-xl bg-studio-900 border border-studio-800 text-xs text-slate-400 space-y-2">
            <div class="font-bold text-slate-200">剪辑成品库</div>
            <p>展示由本地剪辑台导出至云端的所有成品音视频文件。</p>
          </div>
        </template>
      </div>

      <!-- 3. 基础素材专属独立筛选：每个库都有独立的筛选机制 -->
      <div v-else-if="sourcePlate === 'base' && libraryRail !== 'items'" class="lib-filters">
        <!-- 3.1 材质库独立筛选 -->
        <template v-if="baseWarehouse === 'material'">
          <section class="lib-group">
            <div class="lib-group-head">
              <span class="font-bold text-white text-xs">装修面货架分类</span>
            </div>
            <div class="lib-chips mt-2">
              <button
                type="button"
                class="lib-chip"
                :class="{ 'is-on': baseMaterialSurface === '' }"
                @click="baseMaterialSurface = ''"
              >
                <span>全部装修面</span>
              </button>
              <button
                v-for="s in baseSurfaces"
                :key="s.key"
                type="button"
                class="lib-chip"
                :class="{ 'is-on': baseMaterialSurface === s.key }"
                @click="baseMaterialSurface = s.key"
              >
                <span>{{ s.label }}</span>
              </button>
            </div>
          </section>

          <section class="lib-group mt-3">
            <div class="lib-group-head">
              <span class="font-bold text-white text-xs">来源渠道</span>
            </div>
            <div class="lib-chips mt-2">
              <button
                v-for="src in BASE_MAT_SOURCES"
                :key="src.key"
                type="button"
                class="lib-chip"
                :class="{ 'is-on': baseMaterialSource === src.key }"
                @click="baseMaterialSource = src.key"
              >
                <span>{{ src.label }}</span>
              </button>
            </div>
          </section>

          <section class="lib-group mt-3">
            <label class="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer p-1">
              <input type="checkbox" v-model="baseMaterialShellOnly" class="rounded bg-studio-800 text-studio-accent" />
              <span>仅看官方标准底色壳 (Shell)</span>
            </label>
          </section>
        </template>

        <!-- 3.2 色号库独立筛选 -->
        <template v-else-if="baseWarehouse === 'paint'">
          <section class="lib-group">
            <div class="lib-group-head">
              <span class="font-bold text-white text-xs">品牌筛选</span>
            </div>
            <div class="lib-chips mt-2">
              <button
                v-for="b in BASE_PAINT_BRANDS"
                :key="b.key"
                type="button"
                class="lib-chip"
                :class="{ 'is-on': basePaintBrand === b.key }"
                @click="basePaintBrand = b.key"
              >
                <span>{{ b.label }}</span>
              </button>
            </div>
          </section>

          <section class="lib-group mt-3">
            <div class="lib-group-head">
              <span class="font-bold text-white text-xs">色系分类</span>
            </div>
            <div class="lib-chips mt-2">
              <button
                v-for="f in BASE_PAINT_FAMILIES"
                :key="f.key"
                type="button"
                class="lib-chip"
                :class="{ 'is-on': basePaintFamily === f.key }"
                @click="basePaintFamily = f.key"
              >
                <span>{{ f.label }}</span>
              </button>
            </div>
          </section>

          <section class="lib-group mt-3">
            <label class="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer p-1">
              <input type="checkbox" v-model="basePaintPinnedOnly" class="rounded bg-studio-800 text-studio-accent" />
              <span>仅看官方常用置顶色卡</span>
            </label>
          </section>
        </template>

        <!-- 3.3 灯具库独立筛选 -->
        <template v-else-if="baseWarehouse === 'light'">
          <section class="lib-group">
            <div class="lib-group-head">
              <span class="font-bold text-white text-xs">投光朝向预设</span>
            </div>
            <div class="lib-chips mt-2">
              <button
                v-for="d in BASE_LIGHT_DIRECTIONS"
                :key="d.key"
                type="button"
                class="lib-chip"
                :class="{ 'is-on': baseLightDirection === d.key }"
                @click="baseLightDirection = d.key"
              >
                <span>{{ d.label }}</span>
              </button>
            </div>
          </section>

          <section class="lib-group mt-3">
            <div class="lib-group-head">
              <span class="font-bold text-white text-xs">色温物理锚点 (Kelvin)</span>
            </div>
            <div class="lib-chips mt-2">
              <button
                v-for="c in BASE_LIGHT_CCTS"
                :key="c.key"
                type="button"
                class="lib-chip"
                :class="{ 'is-on': baseLightCct === c.key }"
                @click="baseLightCct = c.key"
              >
                <span>{{ c.label }}</span>
              </button>
            </div>
          </section>
        </template>

        <!-- 3.4 模型库独立筛选与资产范畴说明 -->
        <template v-else-if="baseWarehouse === 'model'">
          <section class="lib-group">
            <div class="lib-group-head">
              <span class="font-bold text-white text-xs">模型库资产品类</span>
            </div>
            <div class="lib-chips mt-2">
              <button
                v-for="mc in BASE_MODEL_CATEGORIES"
                :key="mc.key"
                type="button"
                class="lib-chip"
                :class="{ 'is-on': baseModelCategory === mc.key }"
                @click="baseModelCategory = mc.key"
              >
                <span>{{ mc.label }}</span>
              </button>
            </div>
          </section>

          <div class="mt-4 p-3 rounded-xl bg-studio-900 border border-studio-800/80 text-[11px] text-slate-400 space-y-2">
            <div class="font-bold text-slate-200 flex items-center gap-1.5">
              <StudioIcon name="info" :size="13" class="text-amber-400" />
              模型库覆盖范畴包含：
            </div>
            <ul class="list-disc pl-4 space-y-1 text-slate-400">
              <li><strong class="text-slate-300">活动家具</strong>：沙发、茶几、餐桌椅、床榻</li>
              <li><strong class="text-slate-300">定制木作</strong>：全屋定制柜、嵌入式衣帽间、吧台</li>
              <li><strong class="text-slate-300">厨卫五金</strong>：智能马桶、浴缸、面盆花洒</li>
              <li><strong class="text-slate-300">软装绿植</strong>：艺术雕塑摆件、抽象挂画、绿植</li>
            </ul>
            <div class="text-[10px] text-amber-400/80 pt-1 border-t border-studio-800">
              当前版本主模型遵循 409 契约响应，规范资产库就绪。
            </div>
          </div>
        </template>
      </div>

      <!-- 4. 回收站专属操作 -->
      <div v-else-if="sourcePlate === 'trash'" class="lib-filters">
        <p class="lib-note">回收站没有收藏开关，也没有室内筛选。</p>
        <p class="lib-note">已选 {{ selectedFids.length }} 项</p>
        <button type="button" class="theme-btn-success rounded-xl" :disabled="selectedFids.length === 0" @click="handleRestoreBatch">恢复到素材库</button>
        <button type="button" class="theme-btn-danger rounded-xl" :disabled="selectedFids.length === 0" @click="handlePurgeBatch">彻底粉碎</button>
      </div>
      <div class="lib-resize" title="拖动调整宽度" @pointerdown="startSidebarResize"></div>
    </aside>

    <div class="flex-1 h-full min-w-0 overflow-hidden" v-if="libraryRail === 'base'">
      <BaseLibraryPane
        :warehouse="baseWarehouse"
        :surface="baseMaterialSurface"
        :mat-source="baseMaterialSource"
        :shell-only="baseMaterialShellOnly"
        :brand="basePaintBrand"
        :family="basePaintFamily"
        :pinned-only="basePaintPinnedOnly"
        :direction="baseLightDirection"
        :cct="baseLightCct"
        :model-category="baseModelCategory"
        :search-query="keyword"
        @update:surface="baseMaterialSurface = $event"
        @update:brand="basePaintBrand = $event"
        @update:family="basePaintFamily = $event"
        @update:pinnedOnly="basePaintPinnedOnly = $event"
        @update:modelCategory="baseModelCategory = $event"
      />
    </div>
    <div class="library-main" v-if="libraryRail === 'dam'">
      <div class="library-toolbar">
        <label class="toolbar-search">
          <StudioIcon name="search" :size="16" />
          <input v-model="keyword" type="text" :placeholder="searchPlaceholder" aria-label="搜索" @keyup.enter="handleSearch" />
        </label>
        <div class="toolbar-seg" role="radiogroup" aria-label="视图模式">
          <button
            type="button"
            class="seg-btn"
            :class="{ 'is-on': layoutMode === 'masonry' }"
            :aria-checked="layoutMode === 'masonry'"
            @click="layoutMode = 'masonry'"
            title="瀑布流视图"
          >
            <StudioIcon name="layers" :size="16" />
            <span>瀑布流</span>
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ 'is-on': layoutMode === 'grid' }"
            :aria-checked="layoutMode === 'grid'"
            @click="layoutMode = 'grid'"
            title="网格视图"
          >
            <StudioIcon name="grid" :size="16" />
            <span>网格</span>
          </button>
        </div>
        <button type="button" class="tool-btn" :class="{ 'is-on': selectMode }" aria-label="多选" title="多选" @click="toggleSelectMode">
          <StudioIcon name="check" :size="16" />
          <span>多选</span>
        </button>
        <button type="button" class="tool-btn" aria-label="刷新" title="刷新" @click="reloadAssets(true)">
          <StudioIcon name="refresh" :size="16" />
          <span>刷新</span>
        </button>
        <div class="toolbar-count">
          <span>共 {{ totalAssetsCount }} 条素材</span>
        </div>
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
              <StudioIcon name="chevronsUpDown" :size="14" customClass="text-studio-cyan shrink-0" />
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
                    isSelected(item.fid)
                      ? 'border-studio-accent ring-2 ring-studio-accent/60 shadow-lg shadow-studio-accent/20 -translate-y-0.5'
                      : 'border-studio-750 hover:border-slate-500 hover:shadow-2xl hover:-translate-y-1'
                  ]"
                  @click="onCardClick(item)"
                >
                  <!-- 资产图片容器 (依据自然高宽比自适应大图) -->
                  <div
                    class="relative bg-studio-950 overflow-hidden flex items-center justify-center"
                    :style="getCardAspectStyle(item)"
                  >
                    <img
                      v-if="item.kind !== 'audio' && item.media_type !== 'music'"
                      :src="getThumbnailSrc(item)"
                      :alt="item.file_name || item.fileName"
                      loading="lazy"
                      class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      @load="noteCardAspect(item, $event)"
                      @error="handleImageError"
                    />

                    <!-- 音频专属封面卡片 -->
                    <div
                      v-else
                      class="w-full h-full min-h-[160px] flex flex-col items-center justify-center p-4 bg-gradient-to-br from-studio-900 via-studio-950 to-black select-none text-center"
                    >
                      <div
                        class="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110 mb-2"
                        :class="item.category === 'voice' || item.category === 'vocal'
                          ? 'bg-studio-cyan/20 text-studio-cyan border border-studio-cyan/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'"
                      >
                        <StudioIcon :name="item.category === 'voice' || item.category === 'vocal' ? 'mic' : 'music'" :size="22" />
                      </div>
                      <div class="text-xs font-bold text-slate-200 line-clamp-2 px-2 max-w-full">
                        {{ item.file_name || '音频资产' }}
                      </div>
                      <div class="mt-1 text-[10px] font-mono text-slate-400">
                        {{ item.category === 'voice' || item.category === 'vocal' ? '🎙️ 人声参考' : '🎵 背景音乐' }}
                      </div>
                    </div>

                    <!-- 视频播放标记与时长徽标 -->
                    <div
                      v-if="item.kind === 'video' || item.media_type === 'video'"
                      class="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none group-hover:bg-black/10 transition-all"
                    >
                      <div class="w-10 h-10 rounded-full bg-black/60 backdrop-blur border border-white/20 flex items-center justify-center text-white shadow-lg">
                        <StudioIcon name="play" :size="18" />
                      </div>
                    </div>

                    <!-- 多选勾选框（多选模式下常显，点击卡片任意处亦可勾选） -->
                    <button
                      v-if="selectMode"
                      type="button"
                      class="absolute top-2 left-2 z-30 w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-md active:scale-90 border backdrop-blur"
                      :class="isSelected(item.fid)
                        ? 'bg-studio-accent border-studio-accent text-white shadow-studio-accent/40'
                        : 'bg-black/60 border-white/30 text-transparent hover:text-slate-300 hover:bg-black/80'"
                      :title="isSelected(item.fid) ? '取消勾选' : '勾选此素材'"
                      @click.stop="toggleSelect(item)"
                    >
                      <StudioIcon name="check" :size="16" />
                    </button>

                    <!-- 左侧状态：精修/成品角标 + 画幅（多选时为勾选框让位） -->
                    <div
                      class="absolute top-2 left-2 z-20 flex flex-col items-start gap-1 pointer-events-none"
                      :class="selectMode ? 'ml-9' : ''"
                    >
                      <span
                        v-if="activeMainTab !== 'trash' && item.library_shelf === 'finished'"
                        class="px-2 py-0.5 text-[10px] font-black bg-amber-400 text-amber-950 rounded border border-amber-200 shadow-md"
                      >
                        成品
                      </span>
                      <span
                        v-else-if="activeMainTab !== 'trash' && item.library_shelf === 'retouched'"
                        class="px-2 py-0.5 text-[10px] font-black bg-cyan-400 text-cyan-950 rounded border border-cyan-200 shadow-md"
                      >
                        精修
                      </span>
                      <span class="px-2 py-0.5 text-[10px] font-mono font-bold bg-black/60 backdrop-blur text-white rounded border border-white/10 shadow-sm">
                        {{ getItemOrientationLabel(item) }}
                      </span>
                    </div>

                    <!-- 右上：收藏星标 / 回收站标识 -->
                    <div class="absolute top-2 right-2 z-20 pointer-events-none">
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

                    <!-- 悬停快捷操作遮罩（多选模式下隐藏，避免误触） -->
                    <div v-if="!selectMode" class="absolute inset-0 bg-gradient-to-t from-studio-950/90 via-studio-950/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end z-10 pointer-events-none">
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
                          @click.stop="$emit('sendToChat', { ...item, url: getAssetImageUrl(item.fid, item.mediaToken), imgUrl: getAssetImageUrl(item.fid, item.mediaToken) })"
                          class="p-2 rounded-lg bg-studio-800/90 hover:bg-studio-accent text-white transition-all shadow-md cursor-pointer"
                          title="送入 AI 对话引用生成"
                        >
                          <StudioIcon name="chat" :size="15" />
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

    <!-- 多选批量操作坞（底部悬浮）：删除 / AI 对话 / 进入剪辑 -->
    <div v-if="selectMode" class="sel-dock" role="toolbar" aria-label="多选操作">
      <span class="sel-count">已选 <strong>{{ selectedFids.length }}</strong> 项</span>
      <button type="button" class="sel-bar-btn" @click="selectAllVisible" title="勾选当前已加载的全部素材">全选本页</button>
      <button type="button" class="sel-bar-btn" @click="invertVisibleSelection" title="反转当前已加载素材的勾选状态">反选</button>
      <button type="button" class="sel-bar-btn" @click="clearSelection">清空勾选</button>
      <template v-if="activeMainTab !== 'trash'">
        <button type="button" class="sel-bar-btn" :disabled="!selectedFids.length" @click="openSimilarityWorkbench" title="打开相似工作台">相似</button>
        <button type="button" class="sel-bar-btn" :disabled="!selectedFids.length" @click="handleBatchSendToChat" title="把勾选的素材作为多张 @引用 挂进 AI 对话">AI 对话</button>
        <button type="button" class="sel-bar-btn" :disabled="!selectedFids.length" @click="handleBatchSendToClip" title="把勾选的素材批量送入多轨剪辑时间轴">进入剪辑</button>
        <button type="button" class="sel-bar-btn sel-bar-btn-danger" :disabled="!selectedFids.length" @click="handleBatchDelete" title="批量移入回收站（被剪辑工程引用的素材会保留并提示）">删除</button>
      </template>
      <template v-else>
        <button type="button" class="sel-bar-btn" :disabled="!selectedFids.length" @click="handleRestoreBatch">恢复到素材库</button>
        <button type="button" class="sel-bar-btn sel-bar-btn-danger" :disabled="!selectedFids.length" @click="handlePurgeBatch">彻底粉碎</button>
      </template>
      <button type="button" class="sel-bar-btn sel-exit" @click="exitSelectMode">退出多选</button>
    </div>

    </div>

    <!-- 基础素材专属内容呈现区 (彻底隔离 DAM 资产) -->
    <div class="library-main" v-if="libraryRail === 'items'">
      <div class="library-toolbar">
        <label class="toolbar-search">
          <StudioIcon name="search" :size="16" />
          <input v-model="keyword" type="text" placeholder="搜索基础素材" aria-label="搜索" />
        </label>
        <div class="toolbar-seg" role="radiogroup" aria-label="视图模式">
          <button
            type="button"
            class="seg-btn"
            :class="{ 'is-on': layoutMode === 'masonry' }"
            :aria-checked="layoutMode === 'masonry'"
            @click="layoutMode = 'masonry'"
            title="瀑布流视图"
          >
            <StudioIcon name="layers" :size="16" />
            <span>瀑布流</span>
          </button>
          <button
            type="button"
            class="seg-btn"
            :class="{ 'is-on': layoutMode === 'grid' }"
            :aria-checked="layoutMode === 'grid'"
            @click="layoutMode = 'grid'"
            title="网格视图"
          >
            <StudioIcon name="grid" :size="16" />
            <span>网格</span>
          </button>
        </div>
        <button type="button" class="tool-btn" aria-label="刷新" title="刷新" @click="loadBaseCatalog">
          <StudioIcon name="refresh" :size="16" />
          <span>刷新</span>
        </button>
        <button
          v-if="isBaseAdmin"
          type="button"
          class="tool-btn"
          title="拉取品牌、从照片提炼、或用当前列表生成方案"
          @click="styleStudioOpen = true"
        >
          <span>入库</span>
        </button>
        <div class="toolbar-count">
          <span>{{ baseSection === 'scheme' ? `共 ${displayedBaseItems.length} 套方案` : `共 ${displayedBaseItems.length} 条` }}</span>
        </div>
      </div>

      <!-- 基础素材独立纵向滚动区 (规避 flex 容器直接套 multi-column 导致的横向溢出与纵向无法滚动) -->
      <div ref="baseScrollRef" class="base-flow-scroll flex-1 min-h-0 overflow-y-auto p-4 select-none pb-28">
        <div v-if="baseSection === 'scheme'" class="scheme-flow">
          <article
            v-for="scheme in displayedBaseItems"
            :key="scheme.id"
            class="scheme-card"
            tabindex="0"
            role="button"
            :aria-label="`打开方案 ${scheme.name_zh}`"
            @click="openSchemeDetail(scheme)"
            @keydown.enter.prevent="openSchemeDetail(scheme)"
            @keydown.space.prevent="openSchemeDetail(scheme)"
          >
            <div class="scheme-strips">
              <div
                v-for="strip in scheme.strips"
                :key="strip.surface + ':' + strip.id"
                class="scheme-strip"
                :title="`${strip.surface_label} ${strip.name_zh}${strip.wood_badges && strip.wood_badges.length ? '（' + strip.wood_badges.join(' / ') + '）' : ''}`"
              >
                <img
                  v-if="strip.preview_rel"
                  :src="getBaseItemImageUrl(strip)"
                  :alt="strip.surface_label"
                  @error="handleBaseImageError($event, strip)"
                />
                <span v-else class="scheme-strip-fill" :style="{ background: strip.hex || '#334155' }"></span>
                <span class="scheme-strip-label">{{ strip.surface_label }}</span>
                <span v-if="strip.wood_badges && strip.wood_badges.length" class="scheme-strip-wood">
                  <span v-for="(badge, bi) in strip.wood_badges.slice(0, 3)" :key="bi" class="scheme-strip-wood-tag">{{ badge }}</span>
                </span>
              </div>
              <span v-if="scheme.brand" class="scheme-brand">{{ scheme.brand }}</span>
            </div>
            <div class="scheme-card-caption">
              <div class="flex min-w-0 items-center gap-1.5">
                <span
                  v-if="scheme.lead_hex"
                  class="h-3 w-3 shrink-0 rounded-full border border-white/20"
                  :style="{ background: scheme.lead_hex }"
                ></span>
                <div class="truncate text-xs font-bold text-slate-100">{{ scheme.name_zh }}</div>
              </div>
              <p v-if="scheme.summary" class="truncate text-[10px] text-slate-400">{{ scheme.summary }}</p>
            </div>
          </article>
        </div>
        <div v-else v-for="tier in baseTiers" :key="tier.key" class="base-tier-section mb-6">
          <!-- 三段式板块 Sticky Header -->
          <div
            v-if="tier.showHeader !== false"
            class="tier-header sticky top-0 z-20 py-2 px-3.5 mb-3 rounded-xl bg-studio-950/90 backdrop-blur-md border border-studio-800/80 flex items-center justify-between shadow-xs"
          >
            <div class="flex items-center space-x-2.5">
              <span class="text-base">{{ tier.icon }}</span>
              <h3 class="text-xs sm:text-sm font-bold text-slate-100 font-sans tracking-wide">
                {{ tier.title }}
              </h3>
              <span
                class="px-2 py-0.5 text-[10px] font-mono font-bold rounded-full border"
                :class="tier.badgeClass"
              >
                {{ tier.badge }}
              </span>
            </div>
            <span class="text-xs text-slate-400 font-medium">
              {{ tier.hint }}
            </span>
          </div>

          <div class="base-flow" :class="layoutMode === 'masonry' ? 'base-flow-masonry' : 'base-flow-grid'">
            <div
              v-for="item in tier.items"
              :key="item.id"
              class="base-tile group relative overflow-hidden rounded-xl border border-white/5 bg-studio-900/60 transition-all duration-200 hover:border-studio-accent/40 hover:shadow-lg hover:shadow-black/40"
              :class="layoutMode === 'masonry' ? 'break-inside-avoid mb-4 inline-block w-full' : ''"
            >
              <!-- 媒体视口：以参考图为主体，支持实景效果图切换与收藏置顶 -->
              <div
                class="base-tile-media relative w-full aspect-[4/3] bg-studio-950 overflow-hidden cursor-pointer"
                @click="openBaseItemModal(item)"
              >
                <img
                  :src="getBaseItemImageUrl(getActiveVariant(item), item._showScene)"
                  :alt="getActiveVariant(item)?.name_zh || item.name_zh"
                  class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                  @error="handleBaseImageError($event, getActiveVariant(item))"
                />
                <!-- 右上角快捷控制：实景切换药丸 + 收藏置顶星标 -->
                <div class="absolute top-2 right-2 flex items-center space-x-1.5 z-10 pointer-events-auto">
                  <button
                    v-if="getActiveVariant(item)?.scene_rel"
                    type="button"
                    class="px-2 py-0.5 text-[11px] font-medium rounded-full backdrop-blur-md transition-all shadow select-none cursor-pointer"
                    :class="item._showScene ? 'bg-studio-accent text-white font-bold' : 'bg-black/60 text-slate-200 hover:bg-black/80'"
                    @click.stop="item._showScene = !item._showScene"
                    title="切换平面材质与实物搭配实景效果"
                  >
                    {{ item._showScene ? '实景图' : '材质图' }}
                  </button>
                  <button
                    type="button"
                    class="w-6 h-6 rounded-full flex items-center justify-center transition shadow backdrop-blur-md cursor-pointer"
                    :class="item.is_pinned ? 'bg-amber-500 text-black shadow-amber-500/40 font-bold' : 'bg-black/60 text-slate-300 hover:text-amber-400 hover:bg-black/80 border border-white/20'"
                    :title="item.is_pinned ? '已置顶收藏 (点击取消)' : '收藏置顶'"
                    @click.stop="toggleBaseItemPin(item)"
                  >
                    <StudioIcon name="star" :size="12" />
                  </button>
                </div>
                <!-- 品牌角标 -->
                <span v-if="getActiveVariant(item)?.brand" class="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-bold rounded bg-black/60 text-studio-cyan backdrop-blur-md">
                  {{ getActiveVariant(item).brand }}
                </span>
              </div>

              <!-- 卡片信息区：叠在图下方 -->
              <div class="base-tile-info p-3 flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5">
                  <span
                    v-if="getActiveVariant(item)?.hex && (item.kind_key === 'latex' || item.kind_key === 'microcement')"
                    class="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0 shadow-inner"
                    :style="{ backgroundColor: getActiveVariant(item).hex }"
                    :title="`色值: ${getActiveVariant(item).hex}`"
                  ></span>
                  <div class="base-tile-name font-bold text-sm text-slate-100 truncate" :title="getActiveVariant(item)?.prompt_name || item.name_zh">
                    {{ item.name_zh }}
                  </div>
                  <!-- 变体数量徽标 -->
                  <span
                    v-if="item.variants && item.variants.length > 1"
                    class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-studio-800 text-studio-cyan font-mono"
                    :title="`共 ${item.variants.length} 款工艺配方规格`"
                  >
                    {{ item.variants.length }}款工艺
                  </span>
                </div>

                <!-- 水平“从浅到深”颜色戳色轨 (Color Stamp Track) -->
                <div
                  v-if="item.variants && item.variants.length > 1"
                  class="color-stamp-track flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 no-scrollbar select-none"
                  @click.stop
                >
                  <button
                    v-for="v in item.variants"
                    :key="v.id"
                    type="button"
                    class="stamp-pill flex items-center gap-1 px-2 py-0.5 rounded-full border transition-all text-[11px] shrink-0 cursor-pointer"
                    :class="getActiveVariant(item)?.id === v.id
                      ? 'border-studio-accent bg-studio-accent/25 text-white font-bold ring-1 ring-studio-accent/50 shadow-sm'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/25 hover:bg-white/10 hover:text-white'"
                    :title="`${v.prompt_name || v.name_zh} (${v.external_sku || ''}) · 色值: ${v.hex} · 明度: ${v.lightness ?? '-'} · 工艺: ${getCraftLabel(v.external_sku)}`"
                    @mouseenter="setActiveVariant(item, v)"
                    @click.stop="setActiveVariant(item, v)"
                  >
                    <span
                      class="w-2.5 h-2.5 rounded-full border border-black/30 shrink-0 shadow-inner"
                      :style="{ backgroundColor: v.hex || '#e2e8f0' }"
                    ></span>
                    <span class="truncate max-w-[56px]">{{ getCraftLabel(v.external_sku) }}</span>
                  </button>
                </div>

                <!-- 属性徽标行 -->
                <div class="base-tile-tags flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
                  <!-- 常用次数徽标 -->
                  <span v-if="item.use_count > 0" class="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono text-[10px] flex items-center gap-0.5" title="复用频次">
                    <span>🔥</span>
                    <span>{{ item.use_count }}</span>
                  </span>
                  <!-- 瓷砖光泽与纹理 -->
                  <span v-if="getActiveVariant(item)?.gloss" class="px-1.5 py-0.5 rounded bg-studio-800 text-amber-300/90 font-medium">
                    {{ getActiveVariant(item).gloss === 'glossy' ? '亮光' : getActiveVariant(item).gloss === 'matte' ? '哑光' : '柔光' }}
                  </span>
                  <span v-if="getActiveVariant(item)?.pattern" class="px-1.5 py-0.5 rounded bg-studio-800 text-slate-300">
                    {{ getActiveVariant(item).pattern === 'stone' ? '石纹' : getActiveVariant(item).pattern === 'wood' ? '木纹' : getActiveVariant(item).pattern === 'floral' ? '拼花' : '纯色' }}
                  </span>
                  <!-- 木纹固有属性标签 -->
                  <template v-if="item.kind_key === 'wood'">
                    <span v-if="getActiveVariant(item)?.wood_species" class="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 font-medium">
                      {{ woodTagLabel('species', getActiveVariant(item).wood_species) }}
                    </span>
                    <span v-if="getActiveVariant(item)?.wood_tone" class="px-1.5 py-0.5 rounded bg-studio-800 text-amber-300/90">
                      {{ woodTagLabel('tones', getActiveVariant(item).wood_tone) }}
                    </span>
                    <span v-if="getActiveVariant(item)?.grain_type" class="px-1.5 py-0.5 rounded bg-studio-800 text-slate-300">
                      {{ woodTagLabel('grainTypes', getActiveVariant(item).grain_type) }}
                    </span>
                    <span v-if="getActiveVariant(item)?.grain_scale" class="px-1.5 py-0.5 rounded bg-studio-800 text-slate-400">
                      {{ woodTagLabel('scales', getActiveVariant(item).grain_scale) }}
                    </span>
                    <span v-if="getActiveVariant(item)?.grain_direction" class="px-1.5 py-0.5 rounded bg-studio-800 text-sky-300/90" title="源图方向，不做旋转">
                      {{ woodTagLabel('directions', getActiveVariant(item).grain_direction) }}
                    </span>
                    <span v-if="getActiveVariant(item)?.wood_layout && getActiveVariant(item).wood_layout !== 'plain'" class="px-1.5 py-0.5 rounded bg-studio-800 text-emerald-300/90">
                      {{ woodTagLabel('layouts', getActiveVariant(item).wood_layout) }}
                    </span>
                    <span v-if="getActiveVariant(item)?.surface_finish" class="px-1.5 py-0.5 rounded bg-studio-800 text-slate-400">
                      {{ woodTagLabel('finishes', getActiveVariant(item).surface_finish) }}
                    </span>
                    <span v-if="getActiveVariant(item)?.wood_species_source === 'inferred'" class="px-1.5 py-0.5 rounded bg-studio-800/80 text-slate-500" title="木种按花色名推断，后续可修正">
                      推断
                    </span>
                  </template>
                  <!-- 乳胶漆/微水泥色号与角色 -->
                  <span v-if="getActiveVariant(item)?.external_sku" class="px-1.5 py-0.5 rounded bg-studio-800 text-studio-cyan font-mono text-[10px]">
                    {{ getActiveVariant(item).external_sku }}
                  </span>
                  <span v-if="getActiveVariant(item)?.origin === 'photo'" class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">
                    照片
                  </span>
                  <span v-if="item.scheme_name" class="px-1.5 py-0.5 rounded bg-studio-800 text-studio-cyan">
                    {{ item.scheme_name }}
                  </span>
                  <span v-if="item.surface_label" class="px-1.5 py-0.5 rounded bg-studio-800 text-slate-300">
                    {{ item.surface_label }}
                  </span>
                  <span v-if="getActiveVariant(item)?.family" class="px-1.5 py-0.5 rounded bg-studio-800 text-slate-300">
                    {{ getActiveVariant(item).family }}
                  </span>
                  <span v-if="getActiveVariant(item)?.role_hint" class="px-1.5 py-0.5 rounded bg-studio-800/80 text-emerald-300/90">
                    {{ getActiveVariant(item).role_hint === 'base' ? '适合基底' : getActiveVariant(item).role_hint === 'accent' ? '适合强调' : '基底/强调' }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="displayedBaseItems.length > 0" class="py-12 text-center text-xs text-slate-500">
          {{ baseSection === 'scheme' ? `已展示全部 ${displayedBaseItems.length} 套方案` : `已加载全部 ${displayedBaseItems.length} 件基础素材` }}
        </div>
        <div v-if="displayedBaseItems.length === 0" class="base-empty py-20 text-center text-slate-400">
          <template v-if="baseSection === 'scheme'">
            <p>这个风格还没有方案</p>
            <button type="button" class="mt-4 px-4 py-2 rounded-lg bg-studio-accent text-white text-sm font-bold" @click="styleStudioOpen = true">去工作台新建</button>
          </template>
          <template v-else>暂无匹配的基础素材</template>
        </div>
      </div>

      <!-- 基础素材全屏高清预览大弹窗 -->
      <div
        v-if="activeBaseItemModal"
        class="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 md:p-8 select-none"
        @click.self="activeBaseItemModal = null"
      >
        <div class="relative w-full max-w-4xl max-h-[85vh] bg-studio-900 border border-studio-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row">
          <!-- 媒体预览大图 -->
          <div class="w-full md:w-[60%] bg-black flex items-center justify-center p-4 relative overflow-hidden">
            <img
              :src="getBaseItemImageUrl(activeBaseItemModal, activeBaseItemModal._showScene)"
              :alt="activeBaseItemModal.name_zh"
              class="max-w-full max-h-[60vh] md:max-h-[75vh] object-contain rounded-lg"
              @error="handleBaseImageError($event, activeBaseItemModal)"
            />
            <button
              v-if="activeBaseItemModal.scene_rel"
              type="button"
              class="absolute bottom-4 left-4 px-3 py-1 text-xs font-bold rounded-full backdrop-blur-md border border-white/20 transition-all shadow"
              :class="activeBaseItemModal._showScene ? 'bg-studio-accent text-white' : 'bg-black/70 text-slate-200'"
              @click.stop="activeBaseItemModal._showScene = !activeBaseItemModal._showScene"
            >
              {{ activeBaseItemModal._showScene ? '当前：空间实景图 (点击切回材质图)' : '当前：平面材质图 (点击查看空间搭配)' }}
            </button>
          </div>

          <!-- 右侧详情与提示词 -->
          <div class="w-full md:w-[40%] p-6 flex flex-col justify-between border-t md:border-t-0 md:border-l border-studio-800 bg-studio-900">
            <div class="flex flex-col gap-4">
              <div class="flex items-start justify-between">
                <div>
                  <span v-if="activeBaseItemModal.brand" class="text-xs font-bold text-studio-cyan bg-studio-800 px-2 py-0.5 rounded">
                    {{ activeBaseItemModal.brand }}
                  </span>
                  <h3 class="text-lg font-bold text-white mt-1">{{ activeBaseItemModal.name_zh }}</h3>
                </div>
                <div class="flex items-center space-x-2">
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer"
                    :class="activeBaseItemModal.is_pinned ? 'bg-amber-500 text-black shadow-md shadow-amber-500/30' : 'bg-studio-800 hover:bg-studio-700 text-slate-300 hover:text-white border border-studio-700'"
                    @click="toggleBaseItemPin(activeBaseItemModal)"
                    :title="activeBaseItemModal.is_pinned ? '取消置顶收藏' : '置顶收藏'"
                  >
                    <span>⭐</span>
                    <span>{{ activeBaseItemModal.is_pinned ? '已置顶' : '收藏置顶' }}</span>
                  </button>
                  <button
                    type="button"
                    class="w-8 h-8 rounded-full bg-studio-800 hover:bg-studio-700 text-slate-300 flex items-center justify-center text-sm cursor-pointer"
                    @click="activeBaseItemModal = null"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <!-- 弹窗内工艺规格切换色轨 -->
              <div v-if="activeBaseItemModal.variants && activeBaseItemModal.variants.length > 1" class="p-3 rounded-lg bg-studio-950 border border-white/5 flex flex-col gap-2">
                <div class="flex items-center justify-between text-[11px] font-bold text-slate-400">
                  <span>切换工艺配方规格 (共 {{ activeBaseItemModal.variants.length }} 款)</span>
                  <span class="text-studio-cyan font-mono text-[10px]">{{ getCraftLabel(activeBaseItemModal.external_sku) }}</span>
                </div>
                <div class="color-stamp-track flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 no-scrollbar select-none">
                  <button
                    v-for="v in activeBaseItemModal.variants"
                    :key="v.id"
                    type="button"
                    class="stamp-pill flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all text-xs shrink-0 cursor-pointer"
                    :class="activeBaseItemModal.id === v.id
                      ? 'border-studio-accent bg-studio-accent/25 text-white font-bold ring-1 ring-studio-accent/50 shadow-sm'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/25 hover:bg-white/10 hover:text-white'"
                    @click="selectModalVariant(v)"
                  >
                    <span
                      class="w-3 h-3 rounded-full border border-black/30 shrink-0 shadow-inner"
                      :style="{ backgroundColor: v.hex || '#e2e8f0' }"
                    ></span>
                    <span>{{ getCraftLabel(v.external_sku) }}</span>
                    <span class="text-[10px] text-slate-400 font-mono">({{ v.external_sku }})</span>
                  </button>
                </div>
              </div>

              <!-- 提示词规范名称 -->
              <div class="p-3 rounded-lg bg-studio-950 border border-white/5 flex flex-col gap-1">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-bold text-slate-400">生成提示词名称</span>
                  <span v-if="activeBaseItemModal.use_count > 0" class="text-[10px] text-amber-400 font-mono">🔥 复用 {{ activeBaseItemModal.use_count }} 次</span>
                </div>
                <span class="text-xs text-amber-200 font-mono select-all">{{ activeBaseItemModal.prompt_name || activeBaseItemModal.name_zh }}</span>
              </div>

              <!-- 属性卡片 -->
              <div class="grid grid-cols-2 gap-2 text-xs">
                <div v-if="activeBaseItemModal.gloss" class="p-2.5 rounded bg-studio-800/60 border border-white/5">
                  <span class="text-slate-400 block text-[10px]">光泽度</span>
                  <span class="font-bold text-amber-300">{{ activeBaseItemModal.gloss === 'glossy' ? '亮光' : activeBaseItemModal.gloss === 'matte' ? '哑光' : '柔光' }}</span>
                </div>
                <div v-if="activeBaseItemModal.pattern" class="p-2.5 rounded bg-studio-800/60 border border-white/5">
                  <span class="text-slate-400 block text-[10px]">表面纹理</span>
                  <span class="font-bold text-slate-200">{{ activeBaseItemModal.pattern === 'stone' ? '石纹' : activeBaseItemModal.pattern === 'wood' ? '木纹' : activeBaseItemModal.pattern === 'floral' ? '拼花' : '纯色' }}</span>
                </div>
                <div v-if="activeBaseItemModal.external_sku" class="p-2.5 rounded bg-studio-800/60 border border-white/5">
                  <span class="text-slate-400 block text-[10px]">型号 / 规格</span>
                  <span class="font-bold text-slate-200 font-mono text-[11px]">{{ activeBaseItemModal.external_sku }}</span>
                </div>
                <div v-if="activeBaseItemModal.family" class="p-2.5 rounded bg-studio-800/60 border border-white/5">
                  <span class="text-slate-400 block text-[10px]">色彩 / 色系</span>
                  <span class="font-bold text-slate-200">{{ activeBaseItemModal.family }}</span>
                </div>
                <div v-if="activeBaseItemModal.role_hint" class="p-2.5 rounded bg-studio-800/60 border border-white/5">
                  <span class="text-slate-400 block text-[10px]">角色建议</span>
                  <span class="font-bold text-emerald-300">{{ activeBaseItemModal.role_hint === 'base' ? '适合基底' : activeBaseItemModal.role_hint === 'accent' ? '适合强调' : '基底或强调' }}</span>
                </div>
                <div v-if="activeBaseItemModal.zone && activeBaseItemModal.zone !== 'any'" class="p-2.5 rounded bg-studio-800/60 border border-white/5">
                  <span class="text-slate-400 block text-[10px]">适用分区</span>
                  <span class="font-bold text-slate-200">{{ activeBaseItemModal.zone === 'dry' ? '干区' : activeBaseItemModal.zone === 'wet' ? '湿区' : '室外' }}</span>
                </div>
              </div>
            </div>

            <div class="mt-4 flex gap-2">
              <button
                type="button"
                class="flex-1 py-2 px-3 rounded-lg bg-studio-accent hover:bg-studio-accent/90 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow cursor-pointer"
                @click="copyBaseItemPrompt(activeBaseItemModal)"
              >
                <StudioIcon name="copy" :size="14" />
                <span>复制提示词</span>
              </button>
              <button
                type="button"
                class="flex-1 py-2 px-3 rounded-lg bg-studio-cyan/20 hover:bg-studio-cyan/30 text-studio-cyan border border-studio-cyan/40 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow cursor-pointer"
                @click="sendBaseItemToChat(activeBaseItemModal)"
                title="将此材质作为参考素材送入 AI 空间创作对话"
              >
                <StudioIcon name="wand" :size="14" />
                <span>送至 AI 创作</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="schemeDetail"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md sm:p-6"
        @click.self="closeSchemeDetail"
      >
        <div class="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-studio-700/80 bg-studio-900 shadow-2xl">
          <div class="flex items-start justify-between gap-3 border-b border-studio-800 px-5 py-4">
            <div class="min-w-0">
              <span v-if="schemeDetail.brand" class="rounded bg-studio-800 px-2 py-0.5 text-xs font-bold text-studio-cyan">
                {{ schemeDetail.brand }}
              </span>
              <h3 class="mt-1 truncate text-lg font-bold text-white">{{ schemeDetail.name_zh }}</h3>
            </div>
            <button
              type="button"
              class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-studio-800 text-sm text-slate-300 hover:bg-studio-700"
              aria-label="关闭方案"
              @click="closeSchemeDetail"
            >
              ✕
            </button>
          </div>
          <div class="scheme-detail-strips">
            <div
              v-for="strip in schemeDetail.strips"
              :key="strip.surface + ':' + strip.id"
              class="scheme-detail-strip"
            >
              <img
                v-if="strip.preview_rel"
                :src="getBaseItemImageUrl(strip)"
                :alt="strip.surface_label"
                @error="handleBaseImageError($event, strip)"
              />
              <span v-else class="scheme-strip-fill" :style="{ background: strip.hex || '#334155' }"></span>
              <span class="scheme-strip-label is-shown">{{ strip.surface_label }}</span>
              <span v-if="strip.wood_badges && strip.wood_badges.length" class="scheme-strip-wood is-detail">
                <span v-for="(badge, bi) in strip.wood_badges.slice(0, 3)" :key="bi" class="scheme-strip-wood-tag">{{ badge }}</span>
              </span>
            </div>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div class="mb-2 text-[11px] font-bold text-slate-400">提示词</div>
            <p v-if="schemeDetail.loading" class="text-sm text-slate-400">正在读取方案…</p>
            <p v-else-if="schemeDetail.error" class="text-sm text-amber-200">{{ schemeDetail.error }}</p>
            <p v-else class="whitespace-pre-wrap text-sm leading-6 text-slate-100">{{ schemeDetail.prompt }}</p>
            <div v-if="schemeDetailSlots.length" class="mt-4 flex flex-col gap-2">
              <div class="text-[11px] font-bold text-slate-400">配套</div>
              <div
                v-for="(slot, index) in schemeDetailSlots"
                :key="(slot.item_id || slot.id || index) + ':' + slot.surface + ':' + (slot.role || '')"
                class="flex items-center gap-3 rounded-lg border border-white/5 bg-studio-950 px-3 py-2"
              >
                <span class="w-14 shrink-0 text-xs font-bold text-slate-200">{{ schemeSlotFace(slot) }}</span>
                <span v-if="schemeSlotRole(slot.role)" class="shrink-0 rounded bg-studio-800 px-1.5 py-0.5 text-[10px] text-emerald-300">
                  {{ schemeSlotRole(slot.role) }}
                </span>
                <span class="min-w-0 flex-1 truncate text-xs text-slate-100">{{ slot.prompt_name || slot.name_zh }}</span>
                <span v-if="slotWoodBadges(slot).length" class="hidden shrink-0 items-center gap-1 sm:flex">
                  <span v-for="(badge, bi) in slotWoodBadges(slot).slice(0, 3)" :key="bi" class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">{{ badge }}</span>
                </span>
                <span v-if="slot.brand || slot.external_sku" class="shrink-0 font-mono text-[10px] text-studio-cyan">
                  {{ [slot.brand, slot.external_sku].filter(Boolean).join(' ') }}
                </span>
              </div>
            </div>
          </div>
          <div class="border-t border-studio-800 px-5 py-3">
            <button
              type="button"
              class="cursor-pointer rounded-lg bg-studio-accent px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!schemeDetail.prompt"
              @click="copySchemePrompt"
            >
              复制提示词
            </button>
          </div>
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
              <StudioIcon name="chevronLeft" :size="20" customClass="transition-transform group-hover:-translate-x-0.5" />
            </button>

            <button
              v-if="currentModalAssetIndex !== -1 && currentModalAssetIndex < assetsList.length - 1"
              @click.stop="navigateModalAsset(1)"
              class="absolute right-3 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full bg-studio-900/85 hover:bg-studio-accent text-white border border-studio-700/80 shadow-2xl flex items-center justify-center transition-all cursor-pointer backdrop-blur-md active:scale-95 group hover:shadow-studio-accent/40"
              title="下一件素材 (快捷键: →)"
            >
              <StudioIcon name="chevronRight" :size="20" customClass="transition-transform group-hover:translate-x-0.5" />
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
            <div class="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
              <span v-if="activeModalAsset.library_shelf === 'retouched'" class="px-2 py-1 rounded bg-cyan-400/15 border border-cyan-400/40 text-cyan-300 font-bold">精修</span>
              <span v-else-if="activeModalAsset.library_shelf === 'finished'" class="px-2 py-1 rounded bg-amber-400/15 border border-amber-400/40 text-amber-300 font-bold">成品</span>
              <span v-if="activeModalAsset.favorited_at" class="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold">已收藏</span>
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

            <!-- 动作坞：只保留对话引用、提取材质、回收站三个入口 -->
            <div class="pt-4 space-y-2 border-t border-studio-800">
              <template v-if="activeMainTab !== 'trash'">
                <button
                  @click="handleSendToChatFromModal"
                  class="w-full py-2.5 bg-gradient-to-r from-studio-accent to-studio-indigo hover:opacity-95 text-white font-bold rounded-xl transition-all shadow-lg shadow-studio-accent/25 flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <StudioIcon name="chat" :size="16" />
                  <span>对话引用</span>
                </button>

                <button
                  v-if="activeModalAsset.kind === 'image' || activeModalAsset.media_type === 'image'"
                  @click="openExtractMaterial"
                  class="w-full py-2.5 bg-studio-850 hover:bg-studio-800 text-slate-100 font-bold rounded-xl border border-studio-700 transition-all flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <StudioIcon name="wand" :size="16" />
                  <span>提取材质</span>
                </button>

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

    <StyleSchemeStudio
      :open="styleStudioOpen"
      @close="styleStudioOpen = false"
      @extract="styleStudioOpen = false; catalogIngestOpen = true"
      @saved="loadBaseCatalog"
    />

    <CatalogIngestPanel
      :open="catalogIngestOpen"
      :item-ids="clusterItemIds"
      :initial-asset="catalogIngestAsset"
      @close="catalogIngestOpen = false"
      @saved="loadBaseCatalog"
    />

    <!-- 视频/音频深度人声提炼工坊弹窗 (支持端侧 Web Audio/WebGPU 秒级预览 + 9000 服务端 MDX-Net 深度提炼) -->
    <div
      v-if="showVocalExtractorModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      @click.self="showVocalExtractorModal = false"
    >
      <div class="relative w-full max-w-xl bg-studio-900 border border-studio-700/80 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-5 text-slate-100">
        <!-- 弹窗标题 -->
        <div class="flex items-center justify-between border-b border-studio-800 pb-3">
          <div class="flex items-center space-x-2.5">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-studio-accent to-studio-cyan flex items-center justify-center shadow">
              <StudioIcon name="mic" :size="16" />
            </div>
            <div>
              <h3 class="text-sm font-extrabold text-white flex items-center gap-2">
                视频提炼人声与伴奏剥离工坊
                <span class="px-2 py-0.5 rounded text-[10px] bg-studio-cyan/15 text-studio-cyan border border-studio-cyan/30 font-mono">
                  MDX-Net + DNS64
                </span>
              </h3>
              <p class="text-xs text-slate-400 mt-0.5">
                支持端侧本地 0 秒试听预览，以及 GPU 服务端高保真人声深度分离
              </p>
            </div>
          </div>
          <button
            type="button"
            @click="showVocalExtractorModal = false"
            class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-studio-800 transition"
          >
            <StudioIcon name="close" :size="16" />
          </button>
        </div>

        <!-- 步骤 1：素材选取区 -->
        <div class="space-y-2">
          <label class="text-xs font-bold text-slate-300">1. 选择包含人声的视频或音频素材</label>
          <div
            @click="triggerVocalFilePicker"
            class="border-2 border-dashed border-studio-700 hover:border-studio-accent/70 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer bg-studio-950/60 hover:bg-studio-950/90 transition group"
          >
            <input
              ref="vocalFileInputRef"
              type="file"
              accept="video/*,audio/*"
              class="hidden"
              @change="onVocalVideoFileChanged"
            />
            <div class="w-10 h-10 rounded-full bg-studio-850 flex items-center justify-center text-studio-cyan group-hover:scale-110 transition shadow">
              <StudioIcon name="upload" :size="18" />
            </div>
            <div class="mt-2 text-xs font-bold text-slate-200">
              {{ vocalExtractVideoFile ? vocalExtractVideoFile.name : '点击选择或拖拽本地视频/音频文件到此处' }}
            </div>
            <div class="text-[11px] text-slate-400 mt-0.5 font-mono">
              {{ vocalExtractVideoFile ? `文件大小: ${(vocalExtractVideoFile.size / 1024 / 1024).toFixed(2)} MB` : '支持 MP4, MOV, MKV, MP3, WAV, M4A 等' }}
            </div>
          </div>
        </div>

        <!-- 步骤 2：端侧本地秒级预览试听区 -->
        <div v-if="vocalExtractVideoFile" class="rounded-xl bg-studio-950/80 border border-studio-800 p-3.5 space-y-2.5">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold text-studio-cyan flex items-center gap-1.5">
              <span>⚡ 端侧极速分离预览 (Web Audio 0ms本地)</span>
            </div>
            <button
              v-if="!clientPreviewUrl && !clientPreviewing"
              type="button"
              @click="runClientVocalPreview"
              class="px-2.5 py-1 rounded-lg bg-studio-800 hover:bg-studio-700 text-white text-xs font-bold border border-studio-700 cursor-pointer"
            >
              点击生成试听
            </button>
            <span v-else-if="clientPreviewing" class="text-xs text-studio-accent animate-pulse">
              {{ clientPreviewStage }}
            </span>
          </div>

          <!-- 试听播放控件 -->
          <div v-if="clientPreviewUrl" class="space-y-1.5 pt-1 border-t border-studio-800/80">
            <div class="text-[11px] text-slate-400 flex items-center justify-between">
              <span>试听已生成（已剥离伴奏与高低频底噪）：</span>
              <span class="text-emerald-400 font-mono">Ready ✓</span>
            </div>
            <audio :src="clientPreviewUrl" controls class="w-full h-8 outline-none rounded bg-studio-900"></audio>
          </div>
        </div>

        <!-- 步骤 3：提交服务端深度提炼并入库 -->
        <div class="pt-2">
          <button
            type="button"
            :disabled="!vocalExtractVideoFile || vocalExtracting"
            @click="startVocalExtraction"
            class="w-full py-2.5 rounded-xl bg-gradient-to-r from-studio-accent to-studio-cyan hover:brightness-110 active:scale-98 text-white font-extrabold text-xs shadow-lg flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <span v-if="vocalExtracting" class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            <span>{{ vocalExtracting ? vocalExtractStage : '🚀 提交服务端深度提炼并录入人声库' }}</span>
          </button>
        </div>

        <!-- 进度条 -->
        <div v-if="vocalExtracting" class="space-y-1 pt-1">
          <div class="flex justify-between text-[11px] text-slate-400 font-mono">
            <span>{{ vocalExtractStage }}</span>
            <span>{{ vocalExtractProgress }}%</span>
          </div>
          <div class="h-1.5 w-full bg-studio-950 rounded-full overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-studio-accent to-studio-cyan transition-all duration-300"
              :style="{ width: `${vocalExtractProgress}%` }"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 隐藏的本地素材上传 Input -->
    <input
      ref="assetFileInputRef"
      type="file"
      class="hidden"
      :accept="uploadAccept"
      multiple
      @change="onAssetFilesSelected"
    />

    <!-- 上传中全局轻量悬浮提示条 -->
    <div
      v-if="isUploadingAsset"
      class="fixed bottom-6 right-6 z-50 bg-studio-900/95 border border-studio-accent/50 text-white px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md flex items-center gap-3 animate-pulse"
    >
      <div class="w-4 h-4 border-2 border-studio-accent border-t-transparent rounded-full animate-spin"></div>
      <div class="text-xs font-bold">{{ uploadProgressText }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import StudioIcon from '../components/StudioIcon.vue';
import BaseLibraryPane from './library/BaseLibraryPane.vue';
import CatalogIngestPanel from './library/CatalogIngestPanel.vue';
import StyleSchemeStudio from './library/StyleSchemeStudio.vue';
import LineageGraph from '../components/LineageGraph.vue';
import { buildSchemeBrowse } from '../../../src/base-library/scheme-browse.mjs';
import SimilarityWorkbenchModal from '../components/SimilarityWorkbenchModal.vue';
import { processClientVocalPreview } from '../utils/audio-preview-webgpu.js';
import { onAssetChange } from '../service/sse.js';
import {
  ensureToken,
  getCurrentUser,
  fetchLibraryCatalog,
  fetchAssets,
  fetchTrashAssets,
  fetchAssetDetail,
  fetchTimelineDays,
  getDerivativeImageUrl,
  getDerivativeDownloadUrl,
  restoreFromTrash,
  purgeFromTrash,
  deleteAsset,
  deleteAssets,
  toggleFavorite,
  getAssetImageUrl,
  getBaseItemImageUrl,
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

const props = defineProps({
  libraryLane: { type: String, default: 'image' }
});
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
    { key: 'interior_exterior', label: '室内外设计' },
    { key: 'portrait', label: '空间人像' },
    { key: 'clothing', label: '服装服饰' },
    { key: 'furniture', label: '单品家具' }
  ],
  video: [
    { key: 'all', label: '全部视频' },
    { key: 'walkthrough', label: '空间漫游' },
    { key: 'product', label: '单品展示' },
    { key: 'detail', label: '细节特写' },
    { key: 'ad', label: '商业短片' },
    { key: 'portrait', label: '人像动态' }
  ],
  audio: [
    { key: 'bgm', label: '背景音乐' },
    { key: 'vocal', label: '人声参考' }
  ],
  trash: [
    { key: 'all', label: '全部废弃' },
    { key: 'gate_reject', label: 'AI 闸门拦截' },
    { key: 'web_user_deleted', label: '人工删除' }
  ]
};

// 画幅比例选项
const ORIENTATION_OPTIONS = [
  { key: '9:16', label: '9:16 竖图' },
  { key: '3:4', label: '3:4 竖图' },
  { key: '16:9', label: '16:9 横图' },
  { key: '1:1', label: '1:1 方图' }
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
  { key: 'clip', label: '剪辑素材' },
  { key: 'base', label: '基础素材' },
  { key: 'trash', label: '回收站' }
];

const DAM_MAIN_TABS = [
  { key: 'image', label: '图片', icon: 'image', subTitle: '图片品类细分' },
  { key: 'video', label: '视频', icon: 'video', subTitle: '视频形式细分' },
  { key: 'audio', label: '音频', icon: 'music', subTitle: '音频类型细分' }
];

const BASE_WAREHOUSES = [
  { key: 'material', label: '材质库' },
  { key: 'paint', label: '色号库' },
  { key: 'light', label: '灯具库' },
  { key: 'model', label: '模型库' }
];

const BASE_MAT_SOURCES = [
  { key: '', label: '全部渠道' },
  { key: 'ambientcg', label: 'ambientCG (CC0)' },
  { key: 'polyhaven', label: 'Poly Haven (CC0)' },
  { key: 'manual', label: '官方底色壳' }
];

const BASE_PAINT_BRANDS = [
  { key: '', label: '全部品牌' },
  { key: 'nippon-paint', label: '立邦' },
  { key: 'dulux', label: '多乐士' }
];

const BASE_PAINT_FAMILIES = [
  { key: '', label: '全部色系' },
  { key: 'off-white', label: '米白珍珠' },
  { key: 'beige', label: '暖调米咖' },
  { key: 'greige', label: '原麻灰米' },
  { key: 'gray', label: '现代冷灰' },
  { key: 'green', label: '复古草绿' },
  { key: 'ivory', label: '中性象牙' },
  { key: 'white', label: '纯净雪域' }
];

const BASE_LIGHT_DIRECTIONS = [
  { key: '', label: '全部方位' },
  { key: 'left', label: '画面左侧' },
  { key: 'upper_left', label: '左上方' },
  { key: 'top', label: '正上方' },
  { key: 'upper_right', label: '右上方' },
  { key: 'right', label: '画面右侧' }
];

const BASE_LIGHT_CCTS = [
  { key: '', label: '全部色温' },
  { key: '2700', label: '2700K 暖黄' },
  { key: '3000', label: '3000K 暖白' },
  { key: '4000', label: '4000K 自然白' },
  { key: '5000', label: '5000K 正白' },
  { key: '6500', label: '6500K 冷白' }
];

const BASE_MODEL_CATEGORIES = [
  { key: 'furniture', label: '活动家具' },
  { key: 'millwork', label: '定制柜体木作' },
  { key: 'sanitary', label: '卫浴与厨电五金' },
  { key: 'decor', label: '软装陈设与绿植' }
];

const CLIP_MEDIA_TYPES = [
  { key: '', label: '全部媒体' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' }
];
const clipMediaTypeFilter = ref('');

const libraryRail = ref('dam'); // 'dam' | 'base'
const baseWarehouse = ref('material'); // 'material' | 'paint' | 'light' | 'model'
const baseMaterialSurface = ref('');
const baseMaterialSource = ref('');
const baseMaterialShellOnly = ref(false);
const basePaintBrand = ref('');
const basePaintFamily = ref('');
const basePaintPinnedOnly = ref(false);
const baseLightDirection = ref('');
const baseLightCct = ref('');
const baseModelCategory = ref('furniture');
const baseSurfaces = ref([]);

async function loadBaseSurfaces() {
  try {
    const res = await fetch('/api/base-library/taxonomy', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('ml_token') || ''}` }
    });
    const json = await res.json();
    if (json.success && json.data?.surfaces) {
      baseSurfaces.value = json.data.surfaces;
    }
  } catch (e) {}
}

const sourcePlate = ref('original');
const plateTabs = computed(() => {
  if (sourcePlate.value === 'clip') {
    return [{ key: 'clip', label: '剪辑素材', icon: 'video', subTitle: '被剪辑工程引用' }];
  }
  if (sourcePlate.value === 'trash') return MAIN_TABS.filter((tab) => tab.key === 'trash');
  return MAIN_TABS.filter((tab) => tab.key !== 'trash');
});

function selectSourcePlate(key) {
  if (sourcePlate.value === key) return;
  sourcePlate.value = key;
  if (key === 'base') {
    libraryRail.value = 'items';
    loadBaseCatalog();
  } else {
    libraryRail.value = 'dam';
    if (key === 'trash') {
      activeMainTab.value = 'trash';
      activeSubCategory.value = 'all';
    } else if (key === 'clip') {
      activeMainTab.value = 'clip';
      activeSubCategory.value = 'input';
    } else {
      if (activeMainTab.value === 'trash' || activeMainTab.value === 'clip') {
        activeMainTab.value = 'image';
        activeSubCategory.value = 'interior_exterior';
      }
    }
    reloadAssets(true);
  }
}

function onSelectDamPlate(plateKey) {
  selectSourcePlate(plateKey);
}

function onSelectBaseWarehouse(whKey) {
  libraryRail.value = 'items';
  sourcePlate.value = 'base';
  if (whKey === 'material') {
    chooseBaseSection('material');
  } else if (whKey === 'paint') {
    chooseBaseSection('material');
    baseKind.value = 'latex';
  } else if (whKey === 'light' || whKey === 'model') {
    chooseBaseSection('product');
    baseProductTab.value = whKey === 'light' ? 'light' : 'furniture';
  }
}

function switchClipScope(key) {
  if (activeSubCategory.value === key) return;
  activeSubCategory.value = key;
  activeClipProject.value = '';
  reloadAssets(true);
}

function setSourcePlate(key) {
  selectSourcePlate(key);
}

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
  { key: 'input', label: '工程引用' },
  { key: 'output', label: '导出成片' }
];
// 精修/成品是资产属性，通过独立开关筛选，不再是互斥板块
const onlyRetouched = ref(false);
const onlyFinished = ref(false);

// 快捷筛选配置常量
const SPACES_OPTIONS = [
  { key: 'porch', label: '门外门廊' },
  { key: 'foyer', label: '门内门厅' },
  { key: 'living_room', label: '客厅' },
  { key: 'dining_room', label: '餐厅' },
  { key: 'kitchen', label: '厨房' },
  { key: 'bedroom', label: '卧室' },
  { key: 'bathroom', label: '卫浴' },
  { key: 'study', label: '书房' },
  { key: 'balcony', label: '阳台露台' },
  { key: 'walk_in_closet', label: '衣帽间' },
  { key: 'courtyard', label: '庭院' },
  { key: 'pond', label: '池塘' },
  { key: 'pool', label: '泳池' },
  { key: 'tea_space', label: '茶空间' },
  { key: 'bay_window', label: '飘窗' },
  { key: 'detail_closeup', label: '细节特写' },
  { key: 'other', label: '其他' }
];

const VIDEO_SOURCE_OPTIONS = [
  { key: 'all', label: '全部来源' },
  { key: 'sync', label: '手机实拍' },
  { key: 'ai', label: 'AI创作' }
];

const VIDEO_ORIENTATION_OPTIONS = [
  { key: 'all', label: '全部画幅' },
  { key: '16:9', label: '16:9 横屏' },
  { key: '9:16', label: '9:16 竖屏' }
];

// 基础素材分类选项：使用面、部位、品类
const BASE_SURFACE_TABS = [
  { key: 'wall', label: '墙面' },
  { key: 'ceiling', label: '顶面' },
  { key: 'floor', label: '地面' },
  { key: 'soft', label: '软装' },
  { key: 'millwork', label: '全屋定制' }
];

const BASE_DESIGN_TABS = [
  { key: 'ceiling', label: '吊顶' },
  { key: 'wall', label: '墙面' },
  { key: 'door', label: '门板' }
];

const BASE_PRODUCT_TABS = [
  { key: 'furniture', label: '家具' },
  { key: 'light', label: '灯具' },
  { key: 'sanitary', label: '洁具' },
  { key: 'soft', label: '软装' }
];

const baseSurface = ref('wall');
const baseKind = ref('');
const baseDesignTab = ref('ceiling');
const baseProductTab = ref('furniture');
const baseRole = ref('');
const baseTileGloss = ref('');
const baseTilePattern = ref('');
const baseHue = ref('');

// 木纹固有属性筛选（与 wood-taxonomy.js 词表一致；方向只记录源图，不做旋转）
const WOOD_FILTERS = {
  species: [
    { key: 'walnut', label: '胡桃' }, { key: 'white_oak', label: '白橡' }, { key: 'red_oak', label: '红橡' },
    { key: 'ash', label: '白蜡' }, { key: 'cherry', label: '樱桃' }, { key: 'teak', label: '柚木' },
    { key: 'maple', label: '枫木' }, { key: 'pine', label: '松木' }, { key: 'rosewood', label: '玫瑰木' },
    { key: 'sapele', label: '沙比利' }, { key: 'mahogany', label: '桃花心' }, { key: 'ebony', label: '黑檀' },
    { key: 'bamboo', label: '竹木' }, { key: 'elm', label: '榆木' }, { key: 'birch', label: '桦木' },
    { key: 'olive', label: '橄榄木' }, { key: 'okoume', label: '奥古曼' }, { key: 'engineered', label: '工程木' }
  ],
  tones: [
    { key: 'light', label: '浅色' }, { key: 'medium', label: '中色' }, { key: 'dark', label: '深色' }
  ],
  grainTypes: [
    { key: 'straight', label: '直纹' }, { key: 'cathedral', label: '山纹' }, { key: 'crossed', label: '交错' },
    { key: 'wavy', label: '波浪' }, { key: 'ripple', label: '水波纹' }, { key: 'ribbon', label: '丝带' },
    { key: 'knot', label: '结疤' }, { key: 'distressed', label: '做旧' }
  ],
  scales: [
    { key: 'fine', label: '细纹' }, { key: 'medium', label: '中纹' }, { key: 'coarse', label: '粗纹' }
  ],
  directions: [
    { key: 'horizontal', label: '横向' }, { key: 'vertical', label: '纵向' },
    { key: 'diagonal', label: '斜向' }, { key: 'mixed', label: '混合' }
  ],
  layouts: [
    { key: 'plain', label: '平板' }, { key: 'wide_plank', label: '宽板' }, { key: 'narrow_plank', label: '窄板' },
    { key: 'herringbone', label: '人字拼' }, { key: 'chevron', label: '鱼骨拼' },
    { key: 'parquet', label: '拼花' }, { key: 'block', label: '方块' }
  ],
  finishes: [
    { key: 'matte', label: '哑光' }, { key: 'satin', label: '缎面' }, { key: 'semi_gloss', label: '半亮' },
    { key: 'gloss', label: '亮光' }, { key: 'textured', label: '肌理' },
    { key: 'wire_brushed', label: '拉丝' }, { key: 'oiled', label: '木蜡油' }, { key: 'distressed', label: '做旧' }
  ]
};
const woodFilter = reactive({ species: '', tone: '', grainType: '', scale: '', direction: '', layout: '', finish: '' });
const isWoodKind = computed(() => baseSection.value === 'material' && baseKind.value === 'wood');
const hasWoodFilter = computed(() => Object.values(woodFilter).some(Boolean));
function resetWoodFilter() {
  for (const k of Object.keys(woodFilter)) woodFilter[k] = '';
}
const WOOD_LABEL_MAPS = Object.fromEntries(
  Object.entries(WOOD_FILTERS).map(([group, list]) => [group, Object.fromEntries(list.map((w) => [w.key, w.label]))])
);
function woodTagLabel(group, key) {
  return WOOD_LABEL_MAPS[group]?.[key] || key || '';
}
// 视频人声提炼弹窗状态
const showVocalExtractorModal = ref(false);
const vocalExtractVideoFile = ref(null);
const vocalExtracting = ref(false);
const vocalExtractProgress = ref(0);
const vocalExtractStage = ref('');

const vocalFileInputRef = ref(null);
const clientPreviewing = ref(false);
const clientPreviewStage = ref('');
const clientPreviewUrl = ref('');

function triggerVocalFilePicker() {
  if (vocalFileInputRef.value) {
    vocalFileInputRef.value.value = '';
    vocalFileInputRef.value.click();
  }
}

function onVocalVideoFileChanged(e) {
  const f = e.target.files?.[0];
  if (f) {
    vocalExtractVideoFile.value = f;
    if (clientPreviewUrl.value) {
      URL.revokeObjectURL(clientPreviewUrl.value);
      clientPreviewUrl.value = '';
    }
  }
}

async function runClientVocalPreview() {
  if (!vocalExtractVideoFile.value) return;
  clientPreviewing.value = true;
  clientPreviewStage.value = '端侧处理中...';
  try {
    const res = await processClientVocalPreview(vocalExtractVideoFile.value, {
      onProgress: (p, stage) => {
        clientPreviewStage.value = stage;
      }
    });
    clientPreviewUrl.value = res.wavUrl;
  } catch (err) {
    console.error('端侧试听生成失败:', err);
    alert('端侧试听生成失败: ' + err.message);
  } finally {
    clientPreviewing.value = false;
    clientPreviewStage.value = '';
  }
}

function openVocalExtractor() {
  showVocalExtractorModal.value = true;
  if (clientPreviewUrl.value) {
    URL.revokeObjectURL(clientPreviewUrl.value);
    clientPreviewUrl.value = '';
  }
}

async function startVocalExtraction() {
  if (!vocalExtractVideoFile.value) {
    alert('请先选择要提炼人声的视频文件');
    return;
  }
  vocalExtracting.value = true;
  vocalExtractProgress.value = 15;
  vocalExtractStage.value = '正在上传视频并分析音视频轨道...';
  try {
    const fd = new FormData();
    fd.append('file', vocalExtractVideoFile.value, vocalExtractVideoFile.value.name);
    fd.append('filename', vocalExtractVideoFile.value.name);
    const uploadRes = await authFetch('/api/tools/upload', { method: 'POST', body: fd });
    const uploadJson = await uploadRes.json();
    if (!uploadRes.ok || !uploadJson.success || !uploadJson.data) {
      throw new Error(uploadJson.error || '临时视频上传失败');
    }
    const videoPath = uploadJson.data.videoPath;
    vocalExtractProgress.value = 50;
    vocalExtractStage.value = '正在调用专业人声增强与伴奏抑制算法，剥离背景音乐与底噪...';

    const convRes = await authFetch('/api/tools/convert-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath,
        targetFormat: 'mp3',
        extractAudio: true,
        cleanVocal: true,
      })
    });
    const convJson = await convRes.json();
    if (!convRes.ok || !convJson.success || !convJson.data) {
      throw new Error(convJson.error || '人声提炼失败');
    }
    vocalExtractProgress.value = 85;
    vocalExtractStage.value = '正在归档至人声参考库...';

    const registered = await registerGeneratedAsset({
      previewUrl: convJson.data.downloadUrl,
      prompt: '视频提炼纯人声（去噪去伴奏）',
      model: 'ffmpeg_afftdn',
      mode: 'vocal_extract',
      kind: 'audio',
      category: 'voice',
      format: 'mp3'
    });

    vocalExtractProgress.value = 100;
    vocalExtractStage.value = '提炼成功！';
    alert('人声提炼圆满完成！已归档至素材库「人声参考」');
    showVocalExtractorModal.value = false;
    vocalExtractVideoFile.value = null;
    activeMainTab.value = 'audio';
    activeSubCategory.value = 'vocal';
    await reloadAssets(true);
  } catch (err) {
    alert('人声提炼失败: ' + err.message);
  } finally {
    vocalExtracting.value = false;
    vocalExtractProgress.value = 0;
    vocalExtractStage.value = '';
  }
}

// 本地资产上传状态与控制器
const assetFileInputRef = ref(null);
const isUploadingAsset = ref(false);
const uploadProgressText = ref('');

const uploadButtonLabel = computed(() => {
  if (activeMainTab.value === 'audio') {
    return activeSubCategory.value === 'vocal' ? '📤 上传人声' : '📤 上传音频';
  }
  if (activeMainTab.value === 'video') return '📤 上传视频';
  return '📤 上传图片';
});

const uploadButtonTitle = computed(() => {
  if (activeMainTab.value === 'audio') {
    return activeSubCategory.value === 'vocal'
      ? '上传本地音频文件（.mp3, .wav, .m4a 等）作为人声参考'
      : '上传本地音频文件（.mp3, .wav, .m4a 等）作为背景音乐';
  }
  if (activeMainTab.value === 'video') return '上传本地视频文件（.mp4, .mov 等）入库';
  return '上传本地空间效果图/实拍图入库';
});

const uploadAccept = computed(() => {
  if (activeMainTab.value === 'audio') return '.mp3,.wav,.m4a,.aac,.flac,.ogg';
  if (activeMainTab.value === 'video') return '.mp4,.mov,.avi,.webm,.mkv';
  return 'image/*';
});

function triggerAssetUpload() {
  if (assetFileInputRef.value) {
    assetFileInputRef.value.value = '';
    assetFileInputRef.value.click();
  }
}

async function onAssetFilesSelected(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  isUploadingAsset.value = true;
  let successCount = 0;
  let failCount = 0;

  let uploadCategory = 'interior';
  if (activeMainTab.value === 'audio') {
    uploadCategory = (activeSubCategory.value === 'vocal') ? 'voice' : 'music';
  } else if (activeMainTab.value === 'video') {
    uploadCategory = 'video';
  } else {
    uploadCategory = activeSubCategory.value || 'interior';
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    uploadProgressText.value = `正在上传 (${i + 1}/${files.length}): ${file.name}`;
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('filename', file.name);
      fd.append('category', uploadCategory);
      fd.append('source', 'manual');

      const res = await authFetch('/api/upload', {
        method: 'POST',
        body: fd
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      successCount++;
    } catch (err) {
      console.error(`上传文件 ${file.name} 失败:`, err);
      failCount++;
    }
  }

  isUploadingAsset.value = false;
  uploadProgressText.value = '';

  if (successCount > 0) {
    alert(`🎉 成功上传并入库 ${successCount} 项素材${failCount > 0 ? `，失败 ${failCount} 个` : ''}！`);
    reloadAssets(true);
  } else if (failCount > 0) {
    alert('❌ 上传失败，请检查文件格式或网络连接');
  }
}

const activeBaseItemModal = ref(null);
const schemeDetail = ref(null);
const SCHEME_SURFACE_LABELS = {
  ceiling: '天花',
  wall: '墙面',
  floor: '地面',
  millwork: '全屋定制',
  counter: '台面',
  furniture: '家具',
  soft: '软装',
  metal: '金属饰面'
};

function schemeSlotFace(slot) {
  if (!slot) return '';
  return slot.surface_label || SCHEME_SURFACE_LABELS[slot.surface] || slot.surface || '';
}

function schemeSlotRole(role) {
  if (role === 'base') return '基底';
  if (role === 'accent') return '强调';
  return '';
}

// compile 接口返回原始木纹字段，这里按词表派生标签
function slotWoodBadges(slot) {
  if (!slot || slot.kind_key !== 'wood') return [];
  const bits = [];
  if (slot.wood_species) bits.push(woodTagLabel('species', slot.wood_species));
  if (slot.grain_type) bits.push(woodTagLabel('grainTypes', slot.grain_type));
  if (slot.wood_layout && slot.wood_layout !== 'plain') bits.push(woodTagLabel('layouts', slot.wood_layout));
  if (slot.surface_finish && slot.surface_finish !== 'matte') bits.push(woodTagLabel('finishes', slot.surface_finish));
  if (slot.wood_tone) bits.push(woodTagLabel('tones', slot.wood_tone));
  return [...new Set(bits)];
}

const schemeDetailSlots = computed(() => {
  const detail = schemeDetail.value;
  if (!detail) return [];
  if (detail.slots?.length) return detail.slots;
  return detail.strips || [];
});

async function openSchemeDetail(scheme) {
  if (!scheme?.id) return;
  schemeDetail.value = {
    id: scheme.id,
    name_zh: scheme.name_zh || scheme.id,
    brand: scheme.brand || '',
    strips: scheme.strips || [],
    prompt: '',
    slots: [],
    loading: true,
    error: ''
  };
  try {
    const res = await authFetch(`/api/base-library/schemes/${encodeURIComponent(scheme.id)}/compile`);
    const data = await res.json().catch(() => ({}));
    if (!schemeDetail.value || schemeDetail.value.id !== scheme.id) return;
    if (!res.ok) throw new Error('load failed');
    schemeDetail.value = {
      ...schemeDetail.value,
      name_zh: data.name_zh || scheme.name_zh,
      brand: scheme.brand || data.slots?.find((slot) => slot.brand)?.brand || '',
      prompt: data.prompt || '',
      slots: Array.isArray(data.slots) ? data.slots : [],
      loading: false,
      error: ''
    };
  } catch {
    if (schemeDetail.value && schemeDetail.value.id === scheme.id) {
      schemeDetail.value = { ...schemeDetail.value, loading: false, error: '提示词暂时没有加载出来' };
    }
  }
}

function closeSchemeDetail() {
  schemeDetail.value = null;
}

function copySchemePrompt() {
  const text = schemeDetail.value?.prompt || '';
  if (!text) return;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

const TILE_GLOSS_TABS = [
  { key: '', label: '全部光泽' },
  { key: 'glossy', label: '亮光' },
  { key: 'soft', label: '柔光' },
  { key: 'matte', label: '哑光' }
];

const TILE_PATTERN_TABS = [
  { key: '', label: '全部纹理' },
  { key: 'stone', label: '石纹' },
  { key: 'wood', label: '木纹' },
  { key: 'floral', label: '拼花' },
  { key: 'solid', label: '纯色' }
];

const PAINT_HUE_TABS = [
  { key: '', label: '全部主色' },
  { key: 'white', label: '白' },
  { key: 'yellow', label: '黄' },
  { key: 'green', label: '绿' },
  { key: 'blue', label: '蓝' },
  { key: 'red', label: '红' },
  { key: 'gray', label: '灰' },
  { key: 'black', label: '黑' },
  { key: 'brown', label: '棕' }
];

const quickSpace = computed({
  get: () => filterState.space[0] || '',
  set: (val) => {
    filterState.space = val ? [val] : [];
    reloadAssets(true);
  }
});

function onQuickSpaceChange() {
  reloadAssets(true);
}

const currentVideoSource = computed(() => filterState.video_source[0] || 'all');
function setQuickVideoSource(key) {
  filterState.video_source = key === 'all' ? [] : [key];
  reloadAssets(true);
}

const currentVideoOrientation = computed(() => filterState.orientation[0] || 'all');
function setQuickVideoOrientation(key) {
  filterState.orientation = key === 'all' ? [] : [key];
  reloadAssets(true);
}

const hasActiveAdvancedFilters = computed(() => {
  return (
    filterState.style.length > 0 ||
    filterState.material.length > 0 ||
    filterState.orientation.length > 0 ||
    filterState.color.length > 0 ||
    filterState.mood.length > 0
  );
});

const activeAdvancedFilterCount = computed(() => {
  let c = 0;
  if (filterState.style.length) c++;
  if (filterState.material.length) c++;
  if (filterState.orientation.length) c++;
  if (filterState.color.length) c++;
  if (filterState.mood.length) c++;
  return c;
});

// 基础素材当前使用面下的种类细分
const materialKindTabs = computed(() => {
  const kindsMap = {
    wall: [
      { key: 'latex', label: '乳胶漆' },
      { key: 'microcement', label: '微水泥' },
      { key: 'wallpaper', label: '墙纸' },
      { key: 'wood', label: '木饰面' },
      { key: 'stone', label: '石材' },
      { key: 'tile', label: '瓷砖' }
    ],
    ceiling: [
      { key: 'latex', label: '乳胶漆' },
      { key: 'microcement', label: '微水泥' }
    ],
    floor: [
      { key: 'tile', label: '瓷砖' },
      { key: 'wood', label: '木地板' },
      { key: 'microcement', label: '微水泥' },
      { key: 'stone', label: '石材' }
    ],
    soft: [
      { key: 'fabric', label: '织物' },
      { key: 'leather', label: '皮革' },
      { key: 'carpet', label: '地毯' }
    ],
    millwork: [
      { key: 'wood', label: '木作板材' },
      { key: 'tile', label: '岩板瓷砖' },
      { key: 'stone', label: '台面石材' },
      { key: 'metal_finish', label: '金属饰面' }
    ]
  };
  return kindsMap[baseSurface.value] || [];
});

watch(baseSurface, () => {
  const tabs = materialKindTabs.value;
  if (!tabs.some(t => t.key === baseKind.value)) {
    baseKind.value = tabs[0]?.key || '';
  }
  baseTileGloss.value = '';
  baseTilePattern.value = '';
  baseHue.value = '';
  baseRole.value = '';
  resetWoodFilter();
}, { immediate: true });

const HUE_ORDER_MAP = {
  white: 1,
  yellow: 2,
  green: 3,
  blue: 4,
  red: 5,
  gray: 6,
  black: 7,
  brown: 8
};
const HUE_ZH_ORDER_MAP = {
  '白': 1,
  '黄': 2,
  '绿': 3,
  '蓝': 4,
  '红': 5,
  '灰': 6,
  '黑': 7,
  '棕': 8
};
const HUE_LABELS_ZH = {
  white: '白',
  yellow: '黄',
  green: '绿',
  blue: '蓝',
  red: '红',
  gray: '灰',
  black: '黑',
  brown: '棕'
};

function getCraftLabel(sku) {
  if (!sku) return '平涂';
  const s = String(sku).trim().toUpperCase();
  if (/^(?:NN|OW|RN|BN|GC|VC|GN|BC|YC|VN|RA|RAL|NP|B\d|G\d)[\s_-]?\d*/i.test(s)) return '平涂';
  if (/^[A-Z]{1,4}\d*(-\d+)?$/i.test(s)) return '平涂';
  if (s.includes('HZY')) return '海藻岩';
  if (s.includes('WJS')) return '微晶石';
  if (s.includes('ZGZ')) return '浮雕';
  if (s.includes('MMS')) return '玛莫石';
  if (s.includes('NMS')) return '奈姆石';
  if (s.includes('ZRC')) return '岩彩';
  if (s.includes('LGTER') || s.includes('TER')) return '天鹅绒';
  if (s.includes('NJS')) return '凝金砂';
  if (s.includes('CSC')) return '蚕丝';
  if (s.includes('QS')) return '清石';
  if (s.includes('TCS')) return '陶彩砂';
  if (s.includes('YDS')) return '影洞石';
  if (s.includes('LYC')) return '岩彩石';
  if (s.includes('XH3D') || s.includes('XHY')) return '雪花岩';
  if (s.includes('ZGD') || s.includes('ZGJ') || s.includes('ZGY') || s.includes('ZGS') || s.includes('ZGQ') || s.includes('ZGX')) return '质感';
  if (s.includes('HYW')) return '幻影微';
  if (s.includes('SJ')) return '水晶';
  if (s.includes('JW')) return '微水泥';
  if (s.includes('QHG')) return '清辉光';
  const prefix = sku.split(/[-_+]/)[0];
  return prefix && prefix.length <= 4 ? prefix : '质感';
}

const activeVariantsMap = ref({});

function getActiveVariant(item) {
  if (!item) return null;
  if (!item.variants || !item.variants.length) return item;
  return activeVariantsMap.value[item.name_zh] || item.defaultVariant || item.variants[0];
}

function setActiveVariant(item, variant) {
  if (!item || !item.name_zh || !variant) return;
  activeVariantsMap.value[item.name_zh] = variant;
}

function openBaseItemModal(item) {
  if (!item) return;
  const current = getActiveVariant(item);
  activeBaseItemModal.value = {
    ...current,
    _showScene: Boolean(item._showScene),
    is_pinned: Number(item.is_pinned || current?.is_pinned || 0),
    use_count: Number(item.use_count || current?.use_count || 0),
    variants: item.variants,
    parentItem: item
  };
}

function selectModalVariant(v) {
  if (!activeBaseItemModal.value || !v) return;
  activeBaseItemModal.value = {
    ...v,
    _showScene: Boolean(activeBaseItemModal.value._showScene),
    is_pinned: Number(activeBaseItemModal.value.parentItem?.is_pinned || v.is_pinned || 0),
    use_count: Number(activeBaseItemModal.value.parentItem?.use_count || v.use_count || 0),
    variants: activeBaseItemModal.value.variants,
    parentItem: activeBaseItemModal.value.parentItem
  };
  if (activeBaseItemModal.value.parentItem) {
    setActiveVariant(activeBaseItemModal.value.parentItem, v);
  }
}

// 计算最终展示的基础素材卡片 (严格限定：无参考图的条目不进瀑布流)
const catalogIngestOpen = ref(false);
const catalogIngestAsset = ref(null);
const styleStudioOpen = ref(false);
const isBaseAdmin = computed(() => getCurrentUser()?.role === 'admin');
const clusterItemIds = computed(() => {
  if (baseSection.value === 'scheme') {
    return displayedBaseItems.value.flatMap((card) => (card.strips || []).map((strip) => strip.item_id)).slice(0, 40);
  }
  return displayedBaseItems.value.map((item) => item.id).slice(0, 40);
});

const displayedBaseItems = computed(() => {
  if (baseSection.value === 'scheme') return schemeSlotCards.value;
  let list = baseItems.value || [];

  // 严格约束：没有参考图的条目不进瀑布流！
  list = list.filter(item => Boolean(item.preview_rel));

  if (baseSection.value === 'material') {
    // 过滤使用面挂载
    if (baseSurface.value) {
      list = list.filter(item => {
        if (!item.mounts) return false;
        const mounts = String(item.mounts).split(',');
        return mounts.includes(baseSurface.value);
      });
    }
    // 过滤材料细分类
    if (baseKind.value) {
      list = list.filter(item => item.kind_key === baseKind.value);
    }
    // 过滤常用推荐项
    if (basePick.value) {
      list = list.filter(item => item.id === basePick.value || item.name_zh === basePick.value);
    }
    // 瓷砖光泽与纹理过滤
    if (baseKind.value === 'tile') {
      if (baseTileGloss.value) {
        list = list.filter(item => item.gloss === baseTileGloss.value);
      }
      if (baseTilePattern.value) {
        list = list.filter(item => item.pattern === baseTilePattern.value);
      }
    }
    // 木纹固有属性过滤（木种/色调/纹理/粗细/源图方向/拼法/质感）
    if (baseKind.value === 'wood') {
      if (woodFilter.species) list = list.filter(item => item.wood_species === woodFilter.species);
      if (woodFilter.tone) list = list.filter(item => item.wood_tone === woodFilter.tone);
      if (woodFilter.grainType) list = list.filter(item => item.grain_type === woodFilter.grainType);
      if (woodFilter.scale) list = list.filter(item => item.grain_scale === woodFilter.scale);
      if (woodFilter.direction) list = list.filter(item => item.grain_direction === woodFilter.direction);
      if (woodFilter.layout) list = list.filter(item => item.wood_layout === woodFilter.layout);
      if (woodFilter.finish) list = list.filter(item => item.surface_finish === woodFilter.finish);
      list.sort((a, b) => {
        const la = Number(a.lab_l ?? a.lightness ?? 0);
        const lb = Number(b.lab_l ?? b.lightness ?? 0);
        if (lb !== la) return lb - la;
        return (a.name_zh || '').localeCompare(b.name_zh || '', 'zh-CN');
      });
    }
    // 微水泥：展示全部 37 款带参考图条目，按明度降序排布
    if (baseKind.value === 'microcement') {
      if (keyword.value) {
        const q = keyword.value.trim().toLowerCase();
        list = list.filter(item => (item.name_zh || '').toLowerCase().includes(q) || (item.prompt_name || '').toLowerCase().includes(q) || (item.external_sku || '').toLowerCase().includes(q));
      }
      list.sort((a, b) => {
        const hueA = HUE_ORDER_MAP[a.hue] || HUE_ZH_ORDER_MAP[a.family] || 99;
        const hueB = HUE_ORDER_MAP[b.hue] || HUE_ZH_ORDER_MAP[b.family] || 99;
        if (hueA !== hueB) return hueA - hueB;
        return (b.lightness ?? 0) - (a.lightness ?? 0);
      });
      return list;
    }
    // 乳胶漆：聚合同名款为单主卡片，内嵌“从浅到深”颜色戳色轨，并严格按 8 大主色 + 明度降序排列
    if (baseKind.value === 'latex') {
      // 1. 乳胶漆主色与角色建议先过滤
      if (baseHue.value) {
        list = list.filter(item => item.hue === baseHue.value || item.family === HUE_LABELS_ZH[baseHue.value]);
      }
      if (baseRole.value) {
        list = list.filter(item => item.role_hint === baseRole.value || item.role_hint === 'both');
      }

      // 2. 关键词初筛
      if (keyword.value) {
        const q = keyword.value.trim().toLowerCase();
        list = list.filter(item =>
          (item.name_zh || '').toLowerCase().includes(q) ||
          (item.prompt_name || '').toLowerCase().includes(q) ||
          (item.external_sku || '').toLowerCase().includes(q)
        );
      }

      // 3. 按 name_zh 聚合为唯一主卡片
      const groupsMap = new Map();
      for (const item of list) {
        const name = (item.name_zh || '').trim();
        if (!groupsMap.has(name)) {
          groupsMap.set(name, []);
        }
        groupsMap.get(name).push(item);
      }

      const aggregatedCards = [];
      for (const [name, variants] of groupsMap.entries()) {
        // 卡片内变体从左到右按明度降序排列 (95% -> 20%)
        variants.sort((a, b) => {
          const la = a.lightness ?? 0;
          const lb = b.lightness ?? 0;
          if (lb !== la) return lb - la;
          const craftA = getCraftLabel(a.external_sku);
          const craftB = getCraftLabel(b.external_sku);
          if (craftA === '平涂' && craftB !== '平涂') return -1;
          if (craftB === '平涂' && craftA !== '平涂') return 1;
          return (a.external_sku || '').localeCompare(b.external_sku || '');
        });

        // 默认激活戳：标准平涂 / 最浅基底款
        let defaultVariant = variants.find(v => getCraftLabel(v.external_sku) === '平涂');
        if (!defaultVariant) {
          defaultVariant = variants.find(v => v.role_hint === 'base') || variants[0];
        }

        const primaryCard = {
          ...defaultVariant,
          id: defaultVariant.id,
          name_zh: name,
          variants,
          defaultVariant,
          hue: defaultVariant.hue || variants[0].hue,
          family: defaultVariant.family || variants[0].family,
          lightness: defaultVariant.lightness ?? variants[0].lightness ?? 0,
          is_pinned: Number(variants.some(v => v.is_pinned) || defaultVariant.is_pinned || 0),
          use_count: Math.max(...variants.map(v => Number(v.use_count) || 0), Number(defaultVariant.use_count) || 0)
        };

        aggregatedCards.push(primaryCard);
      }

      // 4. 瀑布流顶层排序：
      // - 顶层按 8 大主色排序 (白 -> 黄 -> 绿 -> 蓝 -> 红 -> 灰 -> 黑 -> 棕)
      // - 主色内：卡片严格按明度从高到低降序排列 (从最浅最纯到最浓郁)，呈现连续光谱
      aggregatedCards.sort((cardA, cardB) => {
        const hueA = HUE_ORDER_MAP[cardA.hue] || HUE_ZH_ORDER_MAP[cardA.family] || 99;
        const hueB = HUE_ORDER_MAP[cardB.hue] || HUE_ZH_ORDER_MAP[cardB.family] || 99;
        if (hueA !== hueB) {
          return hueA - hueB;
        }
        const lightA = cardA.lightness ?? 0;
        const lightB = cardB.lightness ?? 0;
        if (lightB !== lightA) {
          return lightB - lightA;
        }
        return (cardA.name_zh || '').localeCompare(cardB.name_zh || '', 'zh-CN');
      });

      return aggregatedCards;
    }
  } else if (baseSection.value === 'design') {
    list = list.filter(item => item.kind === 'design');
    if (baseDesignTab.value) {
      list = list.filter(item => item.kind_key === `${baseDesignTab.value}_design` || item.mounts?.includes(baseDesignTab.value));
    }
  } else if (baseSection.value === 'product') {
    list = list.filter(item => item.kind === 'product');
    if (baseProductTab.value) {
      list = list.filter(item => item.kind_key === baseProductTab.value || item.mounts?.includes(baseProductTab.value));
    }
  }

  if (keyword.value) {
    const q = keyword.value.trim().toLowerCase();
    list = list.filter(item => (item.name_zh || '').toLowerCase().includes(q) || (item.prompt_name || '').toLowerCase().includes(q) || (item.external_sku || '').toLowerCase().includes(q));
  }
  return list;
});

// 三段式板块：置顶 (收藏) -> 常用 (Top 10) -> 常规
const pinnedBaseItems = computed(() => {
  return displayedBaseItems.value.filter(item => Number(item.is_pinned) === 1);
});

const frequentBaseItems = computed(() => {
  return displayedBaseItems.value
    .filter(item => !item.is_pinned && Number(item.use_count) > 0)
    .sort((a, b) => (Number(b.use_count || 0) - Number(a.use_count || 0)) || (Number(b.updated_at || 0) - Number(a.updated_at || 0)))
    .slice(0, 10);
});

const regularBaseItems = computed(() => {
  const pinOrFreqSet = new Set([
    ...pinnedBaseItems.value.map(i => i.id),
    ...frequentBaseItems.value.map(i => i.id)
  ]);
  return displayedBaseItems.value.filter(item => !pinOrFreqSet.has(item.id));
});

const baseTiers = computed(() => {
  const tiers = [];
  if (pinnedBaseItems.value.length > 0) {
    tiers.push({
      key: 'pinned',
      icon: '⭐',
      title: '置顶收藏',
      badge: `${pinnedBaseItems.value.length} 件`,
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      hint: '已置顶到顶部收藏栏',
      items: pinnedBaseItems.value
    });
  }
  if (frequentBaseItems.value.length > 0) {
    tiers.push({
      key: 'frequent',
      icon: '🔥',
      title: '常用素材',
      badge: `Top ${frequentBaseItems.value.length}`,
      badgeClass: 'bg-studio-accent/20 text-studio-accent border-studio-accent/40',
      hint: '按高频使用前10名排序',
      items: frequentBaseItems.value
    });
  }
  if (regularBaseItems.value.length > 0 || tiers.length === 0) {
    tiers.push({
      key: 'regular',
      icon: '🎨',
      title: '常规素材',
      badge: `${regularBaseItems.value.length} 件`,
      badgeClass: 'bg-studio-900 text-slate-300 border-studio-750',
      hint: '标准光谱与分类排序',
      items: regularBaseItems.value,
      showHeader: tiers.length > 0
    });
  }
  return tiers;
});

async function toggleBaseItemPin(item) {
  if (!item) return;
  const nextPinned = item.is_pinned ? 0 : 1;
  const oldPinned = item.is_pinned;
  item.is_pinned = nextPinned;
  if (item.variants) {
    item.variants.forEach(v => { v.is_pinned = nextPinned; });
  }
  if (activeBaseItemModal.value && (activeBaseItemModal.value.id === item.id || activeBaseItemModal.value.name_zh === item.name_zh)) {
    activeBaseItemModal.value.is_pinned = nextPinned;
    if (activeBaseItemModal.value.parentItem) activeBaseItemModal.value.parentItem.is_pinned = nextPinned;
  }
  const targets = baseItems.value.filter(b => b.id === item.id || b.name_zh === item.name_zh);
  targets.forEach(t => { t.is_pinned = nextPinned; });

  try {
    const res = await authFetch(`/api/base-library/items/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: nextPinned })
    });
    const json = await res.json();
    if (!json.success) {
      item.is_pinned = oldPinned;
      targets.forEach(t => { t.is_pinned = oldPinned; });
    }
  } catch (e) {
    item.is_pinned = oldPinned;
    targets.forEach(t => { t.is_pinned = oldPinned; });
  }
}

async function recordBaseItemUse(item) {
  if (!item) return;
  item.use_count = (Number(item.use_count) || 0) + 1;
  if (item.variants) {
    item.variants.forEach(v => { v.use_count = (Number(v.use_count) || 0) + 1; });
  }
  if (activeBaseItemModal.value && (activeBaseItemModal.value.id === item.id || activeBaseItemModal.value.name_zh === item.name_zh)) {
    activeBaseItemModal.value.use_count = item.use_count;
    if (activeBaseItemModal.value.parentItem) activeBaseItemModal.value.parentItem.use_count = item.use_count;
  }
  const targets = baseItems.value.filter(b => b.id === item.id || b.name_zh === item.name_zh);
  targets.forEach(t => { t.use_count = item.use_count; });

  try {
    await authFetch(`/api/base-library/items/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'use' })
    });
  } catch (e) {}
}

function copyBaseItemPrompt(item) {
  if (!item) return;
  const text = item.prompt_name || item.name_zh || '';
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  recordBaseItemUse(item);
}

function sendBaseItemToChat(item) {
  if (!item) return;
  recordBaseItemUse(item);
  const current = getActiveVariant(item) || item;
  const imgUrl = getBaseItemImageUrl(current, item._showScene);
  emit('sendToChat', {
    name: current.prompt_name || current.name_zh,
    url: imgUrl,
    imgUrl: imgUrl,
    prompt: current.prompt_name || current.name_zh,
    baseItem: {
      id: current.id,
      kind_key: current.kind_key,
      name_zh: current.name_zh,
      hex: current.hex,
      external_sku: current.external_sku
    }
  });
  activeBaseItemModal.value = null;
}



const filterOpen = ref(false);
const filterCloseBtn = ref(null);
watch(filterOpen, (open) => {
  if (open) nextTick(() => filterCloseBtn.value?.focus());
});
const baseSection = ref('material');
const baseSchemes = ref([]);
const baseStyles = ref([]);
const baseItems = ref([]);
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

function toggleOnlyRetouched() {
  onlyRetouched.value = !onlyRetouched.value;
  reloadAssets(true);
}

function toggleOnlyFinished() {
  onlyFinished.value = !onlyFinished.value;
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

// =============================================================================
// 多选（批量操作）：勾选态跨分页保留，退出多选 / 重新加载时清空
// =============================================================================
const selectMode = ref(false);
// fid -> 素材快照：勾选后跨「加载下一页」保留，送 AI 对话 / 剪辑时直接取用
const selectedAssetCache = {};

function isSelected(fid) {
  return selectedFids.value.includes(fid);
}

function toggleSelect(item) {
  if (!item?.fid) return;
  const idx = selectedFids.value.indexOf(item.fid);
  if (idx >= 0) {
    selectedFids.value.splice(idx, 1);
    delete selectedAssetCache[item.fid];
  } else {
    selectedFids.value.push(item.fid);
    selectedAssetCache[item.fid] = item;
  }
}

// 多选模式下点卡片 = 勾选/取消；普通模式 = 打开详情大弹窗
function onCardClick(item) {
  if (selectMode.value) {
    toggleSelect(item);
  } else {
    openAssetDetailModal(item);
  }
}

function selectAllVisible() {
  for (const item of assetsList.value) {
    if (!item?.fid) continue;
    if (!selectedAssetCache[item.fid]) {
      selectedFids.value.push(item.fid);
      selectedAssetCache[item.fid] = item;
    }
  }
}

function invertVisibleSelection() {
  for (const item of assetsList.value) {
    if (item?.fid) toggleSelect(item);
  }
}

function clearSelection() {
  selectedFids.value = [];
  for (const fid of Object.keys(selectedAssetCache)) delete selectedAssetCache[fid];
}

function toggleSelectMode() {
  selectMode.value = !selectMode.value;
  if (!selectMode.value) clearSelection();
}

function exitSelectMode() {
  selectMode.value = false;
  clearSelection();
}

function getSelectedAssets() {
  return selectedFids.value.map((fid) => selectedAssetCache[fid]).filter(Boolean);
}

// 多选 → 批量移入回收站（逐项容错；被剪辑工程引用的素材保留并提示）
async function handleBatchDelete() {
  const fids = selectedFids.value.slice();
  if (!fids.length) return;
  if (!confirm(`确认将选中的 ${fids.length} 个素材移入回收站吗？\n之后可从回收站恢复；被剪辑工程引用的素材会被保留。`)) return;
  let result;
  try {
    result = await deleteAssets(fids);
  } catch (e) {
    alert('批量删除失败: ' + (e?.message || e));
    return;
  }
  const ok = result?.ok || [];
  const failed = result?.failed || [];
  if (ok.length) {
    const okSet = new Set(ok);
    assetsList.value = assetsList.value.filter((a) => !okSet.has(a.fid));
    selectedFids.value = selectedFids.value.filter((fid) => !okSet.has(fid));
    for (const fid of okSet) delete selectedAssetCache[fid];
    trashTotal.value += ok.length;
    totalAssetsCount.value = Math.max(0, (totalAssetsCount.value || 0) - ok.length);
  }
  if (failed.length) {
    const lines = failed.slice(0, 5).map((f) => {
      const used = Array.isArray(f.usedBy) && f.usedBy.length
        ? `（被剪辑工程引用：${f.usedBy.slice(0, 2).map((x) => x.name || x).join('、')}${f.usedBy.length > 2 ? ' 等' : ''}）`
        : '';
      return `· ${f.fid}${used} ${f.error || ''}`.trim();
    });
    alert(`已移入回收站 ${ok.length} 个，失败 ${failed.length} 个：\n${lines.join('\n')}${failed.length > 5 ? `\n…等共 ${failed.length} 个` : ''}`);
  }
  if (!selectedFids.value.length && !failed.length) {
    // 全部处理完且无残留勾选：自动退出多选，回到常规浏览
    selectMode.value = false;
  }
}

// 多选 → 批量送入 AI 对话（挂成 @图1…@图N 多引用）
function handleBatchSendToChat() {
  const items = getSelectedAssets();
  if (!items.length) return;
  emit('sendToChat', {
    items: items.map((it) => ({ ...it, url: getAssetImageUrl(it.fid, it.mediaToken), imgUrl: getAssetImageUrl(it.fid, it.mediaToken) }))
  });
  exitSelectMode();
}

// 多选 → 批量送入多轨剪辑时间轴
function handleBatchSendToClip() {
  const items = getSelectedAssets();
  if (!items.length) return;
  emit('sendToClip', {
    items: items.map((it) => ({ ...it, url: getAssetImageUrl(it.fid, it.mediaToken), imgUrl: getAssetImageUrl(it.fid, it.mediaToken) }))
  });
  exitSelectMode();
}

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
  if (sourcePlate.value === 'base') {
    switch (baseWarehouse.value) {
      case 'material': return '搜索材质名称、纹理、来源...';
      case 'paint': return '搜索色号代码、名称、色系...';
      case 'light': return '搜索灯具方位、色温预设...';
      case 'model': return '搜索家具、木作、厨卫、软装...';
      default: return '搜索基础素材...';
    }
  }
  if (sourcePlate.value === 'clip') {
    return '搜索剪辑素材、工程名称…';
  }
  if (sourcePlate.value === 'trash') {
    return '搜索回收站废弃素材…';
  }
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
  if (activeMainTab.value !== 'trash' && activeMainTab.value !== 'clip') {
    params.lane = activeMainTab.value;
    params.section = activeSubCategory.value;
  }
  const shelves = [];
  if (onlyRetouched.value) shelves.push('retouched');
  if (onlyFinished.value) shelves.push('finished');
  if (shelves.length) params.shelf = shelves.join(',');

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
    if (activeSubCategory.value && activeSubCategory.value !== 'all') {
      params.video_purpose = activeSubCategory.value;
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
    for (const fid of Object.keys(selectedAssetCache)) delete selectedAssetCache[fid];
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
      if (scope === 'input' && clipMediaTypeFilter.value) {
        items = items.filter(it => it.kind === clipMediaTypeFilter.value);
      }
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

function openExtractMaterial() {
  const asset = activeModalAsset.value;
  catalogIngestAsset.value = asset ? {
    fid: asset.fid,
    mediaToken: asset.mediaToken,
    name: asset.file_name,
    url: getModalMainImageUrl()
  } : null;
  closeAssetDetailModal();
  catalogIngestOpen.value = true;
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

const measuredAspect = reactive({});

function isVideoItem(item) {
  return item?.kind === 'video' || item?.media_type === 'video';
}

function getThumbnailSrc(item) {
  if (!item) return '';
  if (isVideoItem(item)) return getAssetPosterUrl(item.fid, item.mediaToken);
  if (item.thumbUrl) {
    const t = localStorage.getItem('ml_token');
    return t ? `${item.thumbUrl}&token=${encodeURIComponent(t)}` : item.thumbUrl;
  }
  return getAssetImageUrl(item.fid, item.mediaToken);
}

function ratioLabelFromSize(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!(w > 0 && h > 0)) return '自适应';
  const ratio = w / h;
  if (ratio > 1.55) return '16:9';
  if (ratio < 0.68) return '9:16';
  if (ratio < 0.9) return '3:4';
  if (ratio > 0.9 && ratio < 1.12) return '1:1';
  return `${w}×${h}`;
}

function noteCardAspect(item, event) {
  const el = event?.target;
  const w = el?.naturalWidth || el?.videoWidth || 0;
  const h = el?.naturalHeight || el?.videoHeight || 0;
  if (!(w > 0 && h > 0) || !item?.fid) return;
  const prev = measuredAspect[item.fid];
  if (prev && prev.w === w && prev.h === h) return;
  measuredAspect[item.fid] = { w, h };
}

function getCardAspectStyle(item) {
  if (!item) return {};
  const measured = item.fid ? measuredAspect[item.fid] : null;
  const w = measured?.w || Number(item.width) || 0;
  const h = measured?.h || Number(item.height) || 0;
  if (w > 0 && h > 0) {
    return { aspectRatio: `${w} / ${h}`, minHeight: '120px' };
  }
  const ori = item.origin_orientation || item.orientation;
  if (ori === 'portrait' || ori === '9:16') return { aspectRatio: '9 / 16', minHeight: '220px' };
  if (ori === '3:4') return { aspectRatio: '3 / 4', minHeight: '180px' };
  if (ori === 'square' || ori === '1:1') return { aspectRatio: '1 / 1', minHeight: '160px' };
  if (isVideoItem(item)) return { minHeight: '180px' };
  return { aspectRatio: '16 / 9', minHeight: '140px' };
}

function getItemOrientationLabel(item) {
  const measured = item?.fid ? measuredAspect[item.fid] : null;
  if (measured?.w && measured?.h) return ratioLabelFromSize(measured.w, measured.h);
  if (Number(item?.width) > 0 && Number(item?.height) > 0) return ratioLabelFromSize(item.width, item.height);
  const ori = item?.origin_orientation || item?.orientation;
  if (ori === '9:16' || ori === 'portrait') return '9:16';
  if (ori === '3:4') return '3:4';
  if (ori === '16:9') return '16:9';
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
const BASE_PLACEHOLDER_IMG = 'data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="225" viewBox="0 0 300 225"><rect width="100%" height="100%" fill="%23162032"/><text x="50%" y="50%" font-size="13" fill="%2364748B" text-anchor="middle" dominant-baseline="middle">🖼️ 暂无参考图</text></svg>';

function handleBaseImageError(e, item) {
  const el = e?.target || e?.currentTarget;
  if (!el) return;
  const curSrc = el.getAttribute('src') || '';
  if (curSrc.startsWith('data:')) return;

  if (item && item.id && !curSrc.includes('/api/base-library/items/')) {
    const token = localStorage.getItem('ml_token') || '';
    const mediaType = item._showScene && item.scene_rel ? 'scene' : 'preview';
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    el.src = `/api/base-library/items/${encodeURIComponent(item.id)}/${mediaType}${qs}`;
    return;
  }

  el.onerror = null;
  el.src = BASE_PLACEHOLDER_IMG;
}

async function handleImageError(e) {
  const el = e?.target || e?.currentTarget;
  if (!el) return;
  const curSrc = el.getAttribute('src') || '';
  if (curSrc.startsWith('data:')) return;

  if (/\/api\/thumbs\//.test(curSrc) && el.dataset.posterTried !== '1') {
    el.dataset.posterTried = '1';
    const name = decodeURIComponent((curSrc.split('/api/thumbs/')[1] || '').split('?')[0]);
    const fid = name.replace(/\.[a-z0-9]+$/i, '');
    if (fid) {
      el.src = getAssetPosterUrl(fid);
      return;
    }
  }

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
  if (e.key === 'Escape' && schemeDetail.value) {
    closeSchemeDetail();
    return;
  }
  if (e.key === 'Escape' && filterOpen.value) {
    filterOpen.value = false;
    return;
  }
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

const BASE_SECTIONS = [
  { key: 'material', label: '材质' },
  { key: 'design', label: '做法' },
  { key: 'product', label: '选品' },
  { key: 'scheme', label: '风格方案' }
];
const STYLE_LEAF_LABELS = { american_country: '美式乡村' };
const sectionRow = computed(() => {
  if (sourcePlate.value === 'clip') return CLIP_SCOPES;
  if (activeMainTab.value === 'trash') return SUB_CATEGORIES_CONFIG.trash.filter((row) => row.key !== 'all');
  return SUB_CATEGORIES_CONFIG[activeMainTab.value] || [];
});
const showShelfSwitch = computed(() => ['image', 'video', 'audio'].includes(activeMainTab.value));
const schemeGroups = computed(() => {
  const map = new Map();
  for (const scheme of baseSchemes.value) {
    const leaf = scheme.style_id || scheme.style_leaf || 'ungrouped';
    if (!map.has(leaf)) {
      map.set(leaf, {
        label: scheme.style_name || STYLE_LEAF_LABELS[scheme.style_leaf] || leaf,
        schemes: []
      });
    }
    map.get(leaf).schemes.push(scheme);
  }
  return [...map.entries()].map(([leaf, group]) => ({
    leaf,
    label: group.label,
    schemes: group.schemes
  }));
});
const KIND_LABELS = {
  latex: '乳胶漆',
  wood: '木材',
  stone: '石材',
  tile: '瓷砖',
  microcement: '微水泥',
  wallpaper: '墙纸',
  metal: '金属',
  glass: '玻璃',
  fabric: '织物',
  leather: '皮革',
  rattan: '藤编',
  carpet: '地毯',
  ceiling_design: '天花',
  wall_design: '墙面',
  door_design: '门板',
  furniture: '家具',
  light: '灯具',
  fixture: '洁具五金',
  soft_goods: '软装'
};
const baseBrand = ref('');
const basePick = ref('');
const schemeLeaf = ref('');
const schemePick = ref('');
const HUE_LABELS = { white: '白', yellow: '黄', green: '绿', blue: '蓝', red: '红', gray: '灰', black: '黑', brown: '棕' };
function hueOf(item) {
  const text = `${item.family || ''}${item.name_zh || ''}`;
  if (/白|珍珠|菱花/.test(text)) return 'white';
  if (/绿/.test(text)) return 'green';
  if (/蓝/.test(text)) return 'blue';
  if (/红|粉/.test(text)) return 'red';
  if (/黑/.test(text)) return 'black';
  if (/灰/.test(text)) return 'gray';
  if (/黄|咖|奶|棕/.test(text)) return 'yellow';
  return '';
}
function chooseBaseKind(key) {
  baseKind.value = key;
  baseHue.value = '';
  baseBrand.value = '';
  basePick.value = '';
  baseTileGloss.value = '';
  baseTilePattern.value = '';
  baseRole.value = '';
  resetWoodFilter();
}
function clearBaseFilters() {
  baseHue.value = '';
  baseBrand.value = '';
  basePick.value = '';
  schemePick.value = '';
  baseTileGloss.value = '';
  baseTilePattern.value = '';
  baseRole.value = '';
  resetWoodFilter();
}
const visibleBaseItems = computed(() => {
  let list = [];
  if (baseSection.value === 'material') list = baseItems.value.filter((item) => item.kind === 'color' || item.kind === 'texture');
  else if (baseSection.value === 'design') list = baseItems.value.filter((item) => item.kind === 'design');
  else if (baseSection.value === 'product') list = baseItems.value.filter((item) => item.kind === 'product');
  const q = keyword.value.trim();
  if (!q) return list;
  return list.filter((item) => String(item.name_zh || '').includes(q) || String(item.prompt_name || '').includes(q));
});
const kindTabs = computed(() => {
  const order = Object.keys(KIND_LABELS);
  const keys = [...new Set(visibleBaseItems.value.map((item) => item.kind_key))];
  keys.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.map((key) => ({ key, label: KIND_LABELS[key] || key }));
});
const hueTabs = computed(() => {
  if (baseSection.value !== 'material' || baseKind.value !== 'latex') return [];
  const present = new Set(visibleBaseItems.value.filter((item) => item.kind_key === 'latex').map(hueOf).filter(Boolean));
  return Object.keys(HUE_LABELS).filter((key) => present.has(key)).map((key) => ({ key, label: HUE_LABELS[key] }));
});
const brandTabs = computed(() => [...new Set(visibleBaseItems.value.filter((item) => item.kind_key === baseKind.value && item.brand).map((item) => item.brand))]);
const nameChips = computed(() => visibleBaseItems.value.filter((item) => item.kind_key === baseKind.value && (!baseBrand.value || item.brand === baseBrand.value) && (!baseHue.value || hueOf(item) === baseHue.value)));
const kindItems = computed(() => nameChips.value.filter((item) => !basePick.value || item.id === basePick.value));
const photoItems = computed(() => kindItems.value.filter((item) => item.preview_rel));
const schemeBrowse = computed(() => buildSchemeBrowse({
  styles: baseStyles.value,
  schemes: baseSchemes.value,
  leaf: schemeLeaf.value,
  pick: schemePick.value
}));
const schemeSlotCards = computed(() => schemeBrowse.value.cards);
const schemeLeafTabs = computed(() => schemeBrowse.value.tabs);
const schemeNameChips = computed(() => schemeBrowse.value.kits);
const visibleSchemeGroups = computed(() => {
  return schemeGroups.value
    .filter((group) => !schemeLeaf.value || group.leaf === schemeLeaf.value)
    .map((group) => ({
      ...group,
      schemes: group.schemes.filter((scheme) => !schemePick.value || scheme.id === schemePick.value)
    }))
    .filter((group) => group.schemes.length);
});
watch(kindTabs, (tabs) => {
  if (tabs.some((tab) => tab.key === baseKind.value)) return;
  const withPhoto = tabs.find((tab) => visibleBaseItems.value.some((item) => item.kind_key === tab.key && item.preview_rel));
  baseKind.value = (withPhoto || tabs[0])?.key || '';
}, { immediate: true });
watch(schemeLeafTabs, (tabs) => {
  if (!tabs.some((tab) => tab.key === schemeLeaf.value)) schemeLeaf.value = tabs[0]?.key || '';
}, { immediate: true });
function itemPreviewSrc(item) {
  return `/api/base-library/items/${encodeURIComponent(item.id)}/preview`;
}
function itemCaption(item) {
  const bits = [];
  if (item.brand) bits.push(item.brand);
  if (item.family) bits.push(item.family);
  if (item.role_hint) bits.push(roleLabel(item.role_hint));
  if (item.name_status === 'pending') bits.push('待核对');
  return bits.join(' · ');
}
function roleLabel(role) {
  if (role === 'base') return '适合基底';
  if (role === 'accent') return '适合强调';
  if (role === 'both') return '基底或强调';
  return '';
}
async function loadBaseCatalog() {
  try {
    const fetchOne = (endpoint) => (typeof authFetch === 'function'
      ? authFetch(endpoint)
      : fetch(endpoint, { headers: { Authorization: `Bearer ${localStorage.getItem('ml_token') || ''}` } }));
    if (baseSection.value === 'scheme') {
      const [schemeRes, styleRes] = await Promise.all([
        fetchOne('/api/base-library/schemes'),
        fetchOne('/api/base-library/styles')
      ]);
      if (schemeRes.ok) {
        const json = await schemeRes.json();
        baseSchemes.value = json.data || [];
      } else {
        console.warn(`[loadBaseCatalog] /api/base-library/schemes returned ${schemeRes.status}`);
      }
      if (styleRes.ok) {
        const json = await styleRes.json();
        baseStyles.value = json.data || [];
      } else {
        console.warn(`[loadBaseCatalog] /api/base-library/styles returned ${styleRes.status}`);
      }
      return;
    }
    const res = await fetchOne('/api/base-library/items');
    if (!res.ok) {
      console.warn(`[loadBaseCatalog] /api/base-library/items returned ${res.status}`);
      return;
    }
    const json = await res.json();
    baseItems.value = json.data || [];
  } catch (err) {
    console.error('[loadBaseCatalog] failed:', err);
  }
}
function chooseBaseSection(key) {
  baseSection.value = key;
  clearBaseFilters();
  loadBaseCatalog();
}
function applyLibraryLane(lane) {
  const key = lane || 'image';
  if (key === 'base') {
    libraryRail.value = 'items';
    sourcePlate.value = 'base';
    loadBaseCatalog();
    return;
  }
  libraryRail.value = 'dam';
  if (key === 'clip') {
    sourcePlate.value = 'clip';
    activeMainTab.value = 'clip';
    activeSubCategory.value = 'input';
  } else if (key === 'trash') {
    sourcePlate.value = 'trash';
    activeMainTab.value = 'trash';
    activeSubCategory.value = 'gate_reject';
  } else {
    sourcePlate.value = 'original';
    activeMainTab.value = key;
    activeSubCategory.value = (SUB_CATEGORIES_CONFIG[key] && SUB_CATEGORIES_CONFIG[key][0].key) || 'interior_exterior';
  }
}
let stopAssetWatch = null;

onMounted(() => {
  applyLibraryLane(props.libraryLane);
  fetchLibraryCatalog().catch(() => {});
  loadBaseSurfaces();
  if (libraryRail.value === 'dam') reloadAssets(true);
  loadTimelineDays();
  setTimeout(setupIntersectionObserver, 300);
  window.addEventListener('keydown', handleKeyDown);
  stopServerWatch = onServerStatusChange((detail) => {
    activeServer.value = detail.label || serverLabel();
  });
  stopAssetWatch = onAssetChange(() => {
    if (libraryRail.value === 'dam') {
      reloadAssets(false);
    }
  });
});

onUnmounted(() => {
  if (observerInstance) observerInstance.disconnect();
  window.removeEventListener('keydown', handleKeyDown);
  if (stopServerWatch) stopServerWatch();
  if (stopAssetWatch) stopAssetWatch();
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
/* 多选批量操作坞按钮 */
.sel-bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--theme-text-primary);
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  cursor: pointer;
  white-space: nowrap;
}
.sel-bar-btn:hover:not(:disabled) { background: var(--theme-bg-hover); }
.sel-bar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.base-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.base-kinds .choice {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 12px;
  font-weight: 700;
  cursor: pointer;
}
.base-flow-scroll {
  overflow-y: auto;
  scroll-behavior: smooth;
}
.scheme-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
}
.scheme-card {
  display: flex;
  flex-direction: column;
  width: 500px;
  max-width: 100%;
  flex: 0 0 500px;
  min-width: 0;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--theme-border);
  background: var(--theme-bg-subtle);
  cursor: pointer;
}
.scheme-card:focus-visible {
  outline: 2px solid var(--theme-border);
  outline-offset: 2px;
}
@media (max-width: 540px) {
  .scheme-card {
    width: 100%;
    flex-basis: auto;
  }
}
.scheme-strips {
  position: relative;
  display: flex;
  width: 100%;
  aspect-ratio: 5 / 4;
  overflow: hidden;
  background: var(--theme-bg-subtle);
}
.scheme-strip {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  transition: flex-grow 0.32s cubic-bezier(0.22, 0.8, 0.3, 1);
}
.scheme-strips:hover .scheme-strip {
  flex-grow: 0.28;
}
.scheme-strips:hover .scheme-strip:hover {
  flex-grow: 3.2;
}
.scheme-strip img,
.scheme-strip-fill {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.scheme-strip-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.scheme-strips:hover .scheme-strip:hover .scheme-strip-label,
.scheme-strip-label.is-shown {
  opacity: 1;
}
.scheme-brand {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: var(--theme-chip-text);
  font-size: 10px;
  font-weight: 700;
  pointer-events: none;
}
.scheme-strip-wood {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 4px;
  z-index: 2;
  display: none;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  pointer-events: none;
}
.scheme-strips:hover .scheme-strip:hover .scheme-strip-wood,
.scheme-strip-wood.is-detail {
  display: flex;
}
.scheme-strip-wood-tag {
  max-width: 100%;
  overflow: hidden;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(120, 72, 20, 0.72);
  color: #ffe8c2;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.4;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.scheme-card-caption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px 10px;
}
.scheme-detail-strips {
  display: flex;
  height: 220px;
  overflow: hidden;
  background: #000;
}
.scheme-detail-strip {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .scheme-strip,
  .scheme-strip-label {
    transition: none;
  }
}
.base-flow-masonry,
.base-flow.is-masonry {
  columns: 2;
  column-gap: 16px;
  height: auto;
  width: 100%;
}
@media (min-width: 720px) { .base-flow-masonry, .base-flow.is-masonry { columns: 3; } }
@media (min-width: 1100px) { .base-flow-masonry, .base-flow.is-masonry { columns: 4; } }
@media (min-width: 1400px) { .base-flow-masonry, .base-flow.is-masonry { columns: 5; } }
.base-flow-grid,
.base-flow.is-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 16px;
  height: auto;
  width: 100%;
}
.base-tile {
  position: relative;
  break-inside: avoid;
  display: inline-block;
  width: 100%;
  margin-bottom: 16px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--theme-border);
  background: var(--theme-bg-subtle);
}
.base-flow-grid .base-tile,
.base-flow.is-grid .base-tile {
  display: block;
  margin-bottom: 0;
}
.base-tile img {
  display: block;
  width: 100%;
  height: auto;
}
.base-tile-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 28px 12px 10px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.62));
  color: #fff;
}
.base-tile-caption span {
  color: rgba(255, 255, 255, 0.86);
  font-size: 12px;
}
.base-empty {
  color: var(--theme-text-secondary);
  font-size: 14px;
}
.sel-exit {
  background: transparent;
}
.sel-bar-btn-danger {
  background: var(--theme-danger-bg);
  border-color: var(--theme-danger-border);
  color: var(--theme-danger-text);
}
.sel-bar-btn-danger:hover:not(:disabled) { background: var(--theme-danger-hover); }
.sel-bar-btn-success {
  background: var(--theme-bg-card);
  border-color: var(--theme-border);
  color: var(--theme-text-primary);
}
</style>
