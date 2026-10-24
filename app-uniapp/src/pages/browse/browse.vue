<template>
  <view class="page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />
    <view class="nav">
      <view class="nav-brand">
        <view class="nav-logo">M</view>
        <view class="media-type-dropdown-trigger" @click="toggleMediaTypeMenu">
          <text class="media-type-icon">{{ currentMediaTabInfo.icon }}</text>
          <text class="media-type-label">{{ currentMediaTabInfo.label }}</text>
          <text class="media-type-arrow">{{ showMediaTypeMenu ? '▴' : '▾' }}</text>
        </view>
      </view>
      <view class="nav-right-box">
        <text
          v-if="activeMediaTab === 'image'"
          class="nav-action-btn"
          :class="{ active: isSelectMode }"
          @click="toggleSelectMode"
        >{{ isSelectMode ? '完成' : '多选' }}</text>
        <view class="refresh-pill-btn" @click="onRefresh" title="刷新">
          <text class="refresh-icon" :class="{ spinning: refreshing }">↻</text>
        </view>
      </view>
    </view>

    <!-- 素材类型精致下拉菜单 -->
    <view v-if="showMediaTypeMenu" class="media-type-popover-mask" @click="showMediaTypeMenu = false">
      <view class="media-type-popover" :style="{ top: (statusBarHeight + 48) + 'px' }" @click.stop>
        <view
          v-for="item in mediaTypeList"
          :key="item.key"
          class="popover-item"
          :class="{ active: activeMediaTab === item.key }"
          @click="selectMediaType(item.key)"
        >
          <text class="popover-item-icon">{{ item.icon }}</text>
          <text class="popover-item-text">{{ item.label }}</text>
          <text v-if="activeMediaTab === item.key" class="popover-item-check">✓</text>
        </view>
      </view>
    </view>

    <view class="search-row">
      <view class="search-box">
        <text class="search-icon">⌕</text>
        <input
          class="search-input"
          v-model="keyword"
          :placeholder="searchPlaceholder"
          confirm-type="search"
          @confirm="reload"
        />
      </view>
      <text class="sort-btn" @click="toggleSort">{{ sortLatest ? '最新' : '最早' }}</text>
    </view>

    <!-- 聚合下拉多选筛选条（按当前素材库 Tab 定制维度，多维聚合下拉，支持多选） -->
    <view class="filter-bar-container">
      <scroll-view scroll-x class="filter-bar-scroll" :show-scrollbar="false">
        <view class="filter-bar">
          <!-- 0. 二级子品类细分 (当选中的一级分类存在 children 时自适应展示) -->
          <view
            v-if="currentSubCategories.length > 0"
            class="dropdown-trigger"
            :class="{ active: activeDropdown === 'subCategory', selected: selectedSubCategory !== '' }"
            @click="toggleDropdown('subCategory')"
          >
            <text class="trigger-label">{{ subCategoryLabel }}</text>
            <text class="trigger-arrow">{{ activeDropdown === 'subCategory' ? '▴' : '▾' }}</text>
          </view>

          <!-- 1. 视频模式聚合下拉 -->
          <template v-if="activeMediaTab === 'video'">
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'videoSource', selected: selectedVideoSources.length > 0 }"
              @click="toggleDropdown('videoSource')"
            >
              <text class="trigger-label">{{ dropdownLabel('videoSource', '视频来源', selectedVideoSources) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'videoSource' ? '▴' : '▾' }}</text>
            </view>
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'orientation', selected: selectedOrientations.length > 0 }"
              @click="toggleDropdown('orientation')"
            >
              <text class="trigger-label">{{ dropdownLabel('orientation', '画幅', selectedOrientations) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'orientation' ? '▴' : '▾' }}</text>
            </view>
          </template>

          <!-- 2. 单品家具聚合下拉 -->
          <template v-else-if="activeMediaTab === 'furniture'">
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'furniture', selected: selectedFurniture.length > 0 }"
              @click="toggleDropdown('furniture')"
            >
              <text class="trigger-label">{{ dropdownLabel('furniture', '家具品类', selectedFurniture) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'furniture' ? '▴' : '▾' }}</text>
            </view>
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'style', selected: selectedStyles.length > 0 }"
              @click="toggleDropdown('style')"
            >
              <text class="trigger-label">{{ dropdownLabel('style', '风格', selectedStyles) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'style' ? '▴' : '▾' }}</text>
            </view>
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'material', selected: selectedMaterials.length > 0 }"
              @click="toggleDropdown('material')"
            >
              <text class="trigger-label">{{ dropdownLabel('material', '材质', selectedMaterials) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'material' ? '▴' : '▾' }}</text>
            </view>
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'color', selected: selectedColors.length > 0 }"
              @click="toggleDropdown('color')"
            >
              <text class="trigger-label">{{ dropdownLabel('color', '主色', selectedColors) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'color' ? '▴' : '▾' }}</text>
            </view>
          </template>

          <!-- 3. 音乐素材聚合下拉 -->
          <template v-else-if="activeMediaTab === 'music'">
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'mood', selected: selectedMoods.length > 0 }"
              @click="toggleDropdown('mood')"
            >
              <text class="trigger-label">{{ dropdownLabel('mood', '情绪氛围', selectedMoods) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'mood' ? '▴' : '▾' }}</text>
            </view>
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'space', selected: selectedSpaces.length > 0 }"
              @click="toggleDropdown('space')"
            >
              <text class="trigger-label">{{ dropdownLabel('space', '场景空间', selectedSpaces) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'space' ? '▴' : '▾' }}</text>
            </view>
          </template>

          <!-- 4. 人像素材聚合下拉 -->
          <template v-else-if="activeMediaTab === 'portrait'">
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'pose', selected: selectedPoses.length > 0 }"
              @click="toggleDropdown('pose')"
            >
              <text class="trigger-label">{{ dropdownLabel('pose', '姿态动作', selectedPoses) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'pose' ? '▴' : '▾' }}</text>
            </view>
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'character', selected: selectedCharacters.length > 0 }"
              @click="toggleDropdown('character')"
            >
              <text class="trigger-label">{{ dropdownLabel('character', '人物角色', selectedCharacters) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'character' ? '▴' : '▾' }}</text>
            </view>
          </template>

          <!-- 5. 图片模式聚合下拉（支持空间、风格、材质、主色、画幅） -->
          <template v-else>
            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'space', selected: selectedSpaces.length > 0 }"
              @click="toggleDropdown('space')"
            >
              <text class="trigger-label">{{ dropdownLabel('space', '空间', selectedSpaces) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'space' ? '▴' : '▾' }}</text>
            </view>

            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'style', selected: selectedStyles.length > 0 }"
              @click="toggleDropdown('style')"
            >
              <text class="trigger-label">{{ dropdownLabel('style', '风格', selectedStyles) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'style' ? '▴' : '▾' }}</text>
            </view>

            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'material', selected: selectedMaterials.length > 0 }"
              @click="toggleDropdown('material')"
            >
              <text class="trigger-label">{{ dropdownLabel('material', '材质', selectedMaterials) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'material' ? '▴' : '▾' }}</text>
            </view>

            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'color', selected: selectedColors.length > 0 }"
              @click="toggleDropdown('color')"
            >
              <text class="trigger-label">{{ dropdownLabel('color', '主色', selectedColors) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'color' ? '▴' : '▾' }}</text>
            </view>

            <view
              class="dropdown-trigger"
              :class="{ active: activeDropdown === 'orientation', selected: selectedOrientations.length > 0 }"
              @click="toggleDropdown('orientation')"
            >
              <text class="trigger-label">{{ dropdownLabel('orientation', '画幅', selectedOrientations) }}</text>
              <text class="trigger-arrow">{{ activeDropdown === 'orientation' ? '▴' : '▾' }}</text>
            </view>
          </template>

          <!-- 一键清空重置按钮 -->
          <view v-if="totalSelectedCount > 0" class="reset-chip" @click="resetAllFilters">
            <text class="reset-text">清空筛选 ({{ totalSelectedCount }}) ✕</text>
          </view>
        </view>
      </scroll-view>

      <!-- 下拉多选弹层面板 -->
      <view v-if="activeDropdown" class="dropdown-panel-wrapper">
        <view class="dropdown-mask" @click="closeDropdown" />
        <view class="dropdown-panel">
          <view class="panel-header">
            <text class="panel-title">{{ currentDropdownTitle }}</text>
            <text class="panel-hint">可多选 · 点击选择或反选</text>
          </view>

          <scroll-view scroll-y class="panel-options-scroll">
            <view class="options-grid">
              <view
                v-for="opt in currentDropdownOptions"
                :key="opt.key || opt"
                class="option-chip"
                :class="{ checked: isOptionChecked(opt.key || opt) }"
                @click="toggleOption(opt.key || opt)"
              >
                <view v-if="opt.hex" class="color-chip-dot" :style="{ backgroundColor: opt.hex }"></view>
                <text class="opt-check" v-if="isOptionChecked(opt.key || opt)">✓</text>
                <text class="opt-text">{{ opt.label || opt }}</text>
              </view>
            </view>
          </scroll-view>

          <view class="panel-footer">
            <view class="panel-btn reset" @click="clearCurrentDropdown">清空本项</view>
            <view class="panel-btn confirm" @click="confirmDropdown">
              确定 {{ currentDropdownSelectedCount ? `(${currentDropdownSelectedCount})` : '' }}
            </view>
          </view>
        </view>
      </view>
    </view>

    <scroll-view
      scroll-y
      class="grid-scroll"
      :style="{ height: gridH ? gridH + 'px' : 'auto' }"
      :lower-threshold="200"
      :refresher-enabled="true"
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
      @scrolltolower="onScrollToLower"
    >
      <view v-if="loading && !loaded" class="state-box">
        <view class="loading-spinner-wrap">
          <view class="loading-spinner"></view>
          <text class="loading-spinner-text">正在加载素材库…</text>
        </view>
      </view>
      <view v-else-if="errorText" class="state-box" @click="reload">
        <text class="state-text err">{{ errorText }}</text>
        <text class="state-sub">点击重试</text>
        <text v-if="isConnectError" class="state-link" @click.stop="openSettings">设置服务器地址 ›</text>
      </view>
      <view v-else-if="groups.length === 0" class="state-box">
        <text class="state-text">没有符合条件的素材</text>
      </view>
      <view v-else>
        <view v-for="g in groups" :key="g.key" class="date-group">
          <text class="date-label">{{ g.label }}</text>
          <view class="cards">
            <view
              v-for="item in g.items"
              :key="item.fid"
              class="card"
              :class="{ selected: isSelected(item.fid) }"
              @click="onCardClick(item)"
            >
              <view
                class="card-media"
                :class="{
                  'portrait-media': item.isPortrait,
                  'music-media': item.isMusic,
                  'furniture-media': item.isFurniture
                }"
                :style="{ paddingTop: item.ratio + '%' }"
                @longpress="onCardLongPress(item)"
              >
                <!-- 1. 音乐专属卡片渲染 -->
                <view v-if="item.isMusic" class="music-card-body">
                  <view class="music-disc" :class="{ playing: currentlyPlayingFid === item.fid }">
                    <text class="music-icon-note">🎵</text>
                  </view>
                  <view class="music-play-btn" @click.stop="togglePlayAudioItem(item)">
                    <text class="music-play-icon">{{ currentlyPlayingFid === item.fid ? '❚❚' : '▶' }}</text>
                  </view>
                </view>

                <!-- 2. 普通视觉媒体（图片/人像/单品） -->
                <image
                  v-else-if="item.imgUrl && !item.imgFailed"
                  class="card-img"
                  :class="{ 'contain-img': item.isPortrait || item.isFurniture }"
                  :src="item.imgUrl"
                  :mode="(item.isPortrait || item.isFurniture) ? 'aspectFit' : 'aspectFill'"
                  :lazy-load="true"
                  @error="onImgError(item)"
                />
                <view v-else class="card-placeholder" :style="cardStyle(item)">
                  <text class="placeholder-text">{{ placeholderExt(item.fileName) }}</text>
                </view>

                <!-- 多选模式下的复选框（仅图片支持空间漫游多选） -->
                <view
                  v-if="isSelectMode && !item.isVideo && !item.isMusic"
                  class="select-checkbox"
                  :class="{ checked: isSelected(item.fid) }"
                  @click.stop="toggleSelect(item)"
                >
                  <text v-if="isSelected(item.fid)" class="check-icon">✓</text>
                </view>

                <!-- 视频专属播放徽标与遮罩 -->
                <view v-if="item.isVideo" class="video-overlay">
                  <view class="play-bubble">
                    <text class="play-icon">▶</text>
                  </view>
                </view>

                <!-- 来源/特性/品类角标 -->
                <text v-if="item.isVideo" class="badge vid" :class="{ ai: item.isAiVideo }">
                  {{ item.isAiVideo ? '✨ AI 创作' : '📱 手机实拍' }}
                </text>
                <text v-else-if="item.isMusic" class="badge music-badge">{{ formatDuration(item.duration) }}</text>
                <text v-else-if="item.isPortrait" class="badge portrait-badge">人像</text>
                <text v-else-if="item.isFurniture" class="badge furn-badge">单品</text>
                <text v-else-if="item.isRestage" class="badge">AI</text>
                <text v-if="item.hasWatermark" class="badge wm">水印</text>

                <view class="card-caption">
                  <text class="cap-name">{{ item.fileName }}</text>
                  <text v-if="item.tagsText" class="cap-tag">{{ item.tagsText }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
        <view class="footer">
          <view v-if="loadingMore" class="loading-spinner-wrap">
            <view class="loading-spinner"></view>
            <text class="loading-spinner-text">正在加载更多素材…</text>
          </view>
          <text v-else-if="finished && all.length > 0" class="finished-text">已加载全部素材</text>
        </view>
      </view>
    </scroll-view>

    <!-- 多选批量操作浮条 -->
    <view v-if="isSelectMode && selectedFids.length > 0" class="batch-bar">
      <view class="batch-info">
        <text class="batch-count">已选 {{ selectedFids.length }} 个空间</text>
        <text class="batch-clear" @click="clearSelection">清空</text>
      </view>
      <view class="batch-btn" @click="openWalkthroughDrawer">
        <text class="batch-btn-text">✨ 生成空间漫游成片</text>
      </view>
    </view>

    <!-- 空间漫游装配抽屉 -->
    <walkthrough-drawer
      :visible="drawerVisible"
      :selected-assets="selectedAssetsList"
      @close="drawerVisible = false"
      @success="onWalkthroughSuccess"
    />

    <!-- 全局后台 AI 任务状态浮窗 -->
    <ai-task-pill />
  </view>
</template>

<script>
import { fetchAssets, fetchMe, sessionValid, mediaUrl, gridUrl, videoUrl, posterUrl, deleteAsset, fetchMenuTree } from '../../service/ViewerApi'
import { switchTabTo } from '../../common/nav'
import { store } from '../../service/SyncStateStore'
import { viewerCache } from '../../service/ViewerCache'
import { localMediaIndex } from '../../service/LocalMediaIndex'
import { prefetch } from '../../service/Prefetch'
import WalkthroughDrawer from '../../components/WalkthroughDrawer.vue'
import AiTaskPill from '../../components/AiTaskPill.vue'

function goLogin(tip) {
  uni.reLaunch({
    url: '/pages/login/login?tip=' + encodeURIComponent(tip || '请先登录服务器'),
  })
}

export default {
  components: {
    WalkthroughDrawer,
    AiTaskPill,
  },
  data() {
    return {
      statusBarHeight: 20,
      gridH: 500,
      activeMediaTab: 'image', // 'image' | 'video'
      showMediaTypeMenu: false,
      selectedSubCategory: '',
      menuTree: [],
      mediaTypeList: [
        { key: 'image', label: '图片素材', icon: '🖼️' },
        { key: 'video', label: '空间视频', icon: '🎬' },
        { key: 'furniture', label: '单品家具', icon: '🛋️' },
        { key: 'music', label: '场景音乐', icon: '🎵' },
        { key: 'portrait', label: '空间人像', icon: '👤' },
      ],
      isSelectMode: false,
      selectedFids: [],
      drawerVisible: false,
      keyword: '',
      sortLatest: true,

      // 当前展开的下拉面板：'' | 'space' | 'style' | 'furniture' | 'material' | 'color' | 'orientation' | 'videoSource' | 'mood' | 'pose' | 'character'
      activeDropdown: '',

      // 多选选中的数组
      selectedSpaces: [],
      selectedStyles: [],
      selectedFurniture: [],
      selectedMaterials: [],
      selectedColors: [],
      selectedOrientations: [],
      selectedVideoSources: [],
      selectedMoods: [],
      selectedPoses: [],
      selectedCharacters: [],

      // 维度选项池：全部来自服务端 filterOptions，客户端不自带词表
      spaceList: [],
      styleList: [],
      furnitureList: [],
      materialList: [],
      colorList: [],
      moodList: [],
      poseList: [],
      characterList: [],
      orientationList: [],
      videoSourceList: [],
      // 菜单树里的 12 色标准板：filterOptions 没数据时兜底
      paletteList: [],

      currentlyPlayingFid: '',
      audioCtx: null,

      all: [],
      loading: false,
      loadingMore: false,
      loaded: false,
      finished: true,
      errorText: '',
      page: 1,
      userLabel: '',
      refreshing: false,
    }
  },
  computed: {
    isConnectError() {
      return /无法连接|连接超时|网络错误|HTTP 明文|响应异常/.test(this.errorText || '')
    },
    currentMediaTabInfo() {
      return (
        this.mediaTypeList.find((m) => m.key === this.activeMediaTab) || {
          key: 'image',
          label: '图片素材',
          icon: '🖼️',
          children: [],
        }
      )
    },
    currentSubCategories() {
      const cur = this.mediaTypeList.find((m) => m.key === this.activeMediaTab)
      return (cur && cur.children) || []
    },
    subCategoryLabel() {
      if (!this.selectedSubCategory) return '子品类'
      const found = this.currentSubCategories.find((c) => c.key === this.selectedSubCategory)
      return found ? (found.label || found.key) : this.selectedSubCategory
    },
    searchPlaceholder() {
      switch (this.activeMediaTab) {
        case 'video': return '搜索视频名称、来源、标签…'
        case 'furniture': return '搜索单品家具、材质、风格…'
        case 'music': return '搜索设计配乐、情绪、场景…'
        case 'portrait': return '搜索人像贴图、姿态、角色…'
        default: return '搜索文件名、标签、空间…'
      }
    },
    totalSelectedCount() {
      const subCount = this.selectedSubCategory ? 1 : 0
      if (this.activeMediaTab === 'video') {
        return subCount + this.selectedVideoSources.length + this.selectedOrientations.length
      }
      if (this.activeMediaTab === 'furniture') {
        return (
          subCount +
          this.selectedFurniture.length +
          this.selectedStyles.length +
          this.selectedMaterials.length +
          this.selectedColors.length
        )
      }
      if (this.activeMediaTab === 'music') {
        return subCount + this.selectedMoods.length + this.selectedSpaces.length
      }
      if (this.activeMediaTab === 'portrait') {
        return subCount + this.selectedPoses.length + this.selectedCharacters.length
      }
      return (
        subCount +
        this.selectedSpaces.length +
        this.selectedStyles.length +
        this.selectedMaterials.length +
        this.selectedColors.length +
        this.selectedOrientations.length
      )
    },
    currentDropdownTitle() {
      switch (this.activeDropdown) {
        case 'subCategory': return '二级品类细分'
        case 'space': return '空间区域筛选'
        case 'style': return '设计风格筛选'
        case 'furniture': return '家具品类筛选'
        case 'material': return '表面材质筛选'
        case 'color': return '色彩基调筛选'
        case 'orientation': return '画幅比例筛选'
        case 'videoSource': return '视频来源类型'
        case 'mood': return '情绪氛围筛选'
        case 'pose': return '人像姿态筛选'
        case 'character': return '人物角色筛选'
        default: return '多选筛选'
      }
    },
    currentDropdownOptions() {
      switch (this.activeDropdown) {
        case 'subCategory': return this.currentSubCategories
        case 'space': return this.spaceList
        case 'style': return this.styleList
        case 'furniture': return this.furnitureList
        case 'material': return this.materialList
        case 'color': return this.colorList
        case 'orientation': return this.orientationList
        case 'videoSource': return this.videoSourceList
        case 'mood': return this.moodList
        case 'pose': return this.poseList
        case 'character': return this.characterList
        default: return []
      }
    },
    currentDropdownSelectedCount() {
      const list = this.getSelectedListByDim(this.activeDropdown)
      return list ? list.length : 0
    },
    selectedAssetsList() {
      if (!this.selectedFids.length) return []
      const set = new Set(this.selectedFids)
      return this.all.filter((a) => set.has(a.fid))
    },
    groups() {
      const filtered = this.all.filter((a) => {
        // 区分多级素材分类（支持全部/图片/视频/室内/建筑/服装/人像/单品/音乐/回收站）
        if (this.activeMediaTab === 'image') {
          if (a.isVideo || a.isMusic) return false
        } else if (this.activeMediaTab === 'video' || this.activeMediaTab === 'finished') {
          if (!a.isVideo && a.kind !== 'video') return false
        } else if (this.activeMediaTab === 'furniture') {
          if (!a.isFurniture && a.category !== 'furniture') return false
        } else if (this.activeMediaTab === 'music' || this.activeMediaTab === 'audio') {
          if (!a.isMusic && a.kind !== 'audio') return false
        } else if (this.activeMediaTab === 'portrait') {
          if (!a.isPortrait && a.category !== 'portrait') return false
        } else if (this.activeMediaTab === 'clothing') {
          if (a.category !== 'clothing' && !(a.tagsText || '').includes('服装')) return false
        } else if (this.activeMediaTab === 'architecture') {
          if (a.category !== 'architecture' && !(a.tagsText || '').includes('建筑')) return false
        } else if (this.activeMediaTab === 'interior') {
          if (a.category !== 'interior' && !(a.tagsText || '').includes('室内') && (a.isVideo || a.isMusic)) return false
        } else if (this.activeMediaTab === 'trash') {
          if (!a.is_trashed && a.status !== 'trashed') return false
        }

        // 二级子品类细分过滤
        if (this.selectedSubCategory && this.selectedSubCategory !== 'all') {
          const subObj = this.currentSubCategories.find((s) => s.key === this.selectedSubCategory)
          const subLabel = subObj ? subObj.label : this.selectedSubCategory
          const tagMatch = (a.tagsText || '').includes(subLabel) || (a.rawTags || '').includes(subLabel)
          const subMatch = a.subcategory === this.selectedSubCategory
          if (!tagMatch && !subMatch) return false
        }

        // 视频模式下区分手机实拍 vs AI 创作（支持多选）
        if (this.activeMediaTab === 'video' && this.selectedVideoSources.length > 0) {
          const matchSync = this.selectedVideoSources.includes('sync') && !a.isAiVideo
          const matchAi = this.selectedVideoSources.includes('ai') && a.isAiVideo
          if (!matchSync && !matchAi) return false
        }

        // 画幅多选
        if (this.selectedOrientations.length > 0) {
          if (!this.selectedOrientations.includes(a.orientation)) return false
        }

        const text = (a.tagsText || '') + ' ' + (a.mainLabel || '') + ' ' + (a.rawTags || '')

        // 空间多选
        if (this.selectedSpaces.length > 0) {
          const hit = this.selectedSpaces.some((s) => text.includes(s) || (a.spaceTag && a.spaceTag.includes(s)))
          if (!hit) return false
        }

        // 风格多选
        if (this.selectedStyles.length > 0) {
          const hit = this.selectedStyles.some((s) => text.includes(s) || (a.styleTag && a.styleTag.includes(s)))
          if (!hit) return false
        }

        // 单品多选
        if (this.selectedFurniture.length > 0) {
          const hit = this.selectedFurniture.some((f) => {
            const shortF = f.replace(/\/.*$/, '')
            return text.includes(f) || text.includes(shortF) || (a.furnitureTag && a.furnitureTag.includes(shortF))
          })
          if (!hit) return false
        }

        // 材质多选
        if (this.selectedMaterials.length > 0) {
          const hit = this.selectedMaterials.some((m) => {
            const shortM = m.replace(/\/.*$/, '')
            return text.includes(m) || text.includes(shortM) || (a.materialTag && a.materialTag.includes(shortM))
          })
          if (!hit) return false
        }

        // 颜色多选（与打标系统 100% 统一，支持 12 色标准板 hex 与名称匹配）
        if (this.selectedColors.length > 0) {
          const domColor = (a.dominantColor || a.dominant_color || '').toLowerCase()
          const hit = this.selectedColors.some((c) => {
            const cStr = typeof c === 'string' ? c : (c.label || c.key || '')
            const cVal = typeof c === 'object' ? (c.value || c.hex || '') : ''
            return (cVal && domColor.includes(cVal.toLowerCase())) ||
                   (cStr && domColor.includes(cStr.toLowerCase())) ||
                   (cStr && text.includes(cStr))
          })
          if (!hit) return false
        }

        // 情绪多选（音乐）
        if (this.selectedMoods.length > 0) {
          const hit = this.selectedMoods.some((m) => {
            const shortM = m.replace(/\/.*$/, '')
            return text.includes(m) || text.includes(shortM) || (a.moodTag && a.moodTag.includes(shortM))
          })
          if (!hit) return false
        }

        // 姿态多选（人像）
        if (this.selectedPoses.length > 0) {
          const hit = this.selectedPoses.some((p) => text.includes(p) || (a.poseTag && a.poseTag.includes(p)))
          if (!hit) return false
        }

        // 角色多选（人像）
        if (this.selectedCharacters.length > 0) {
          const hit = this.selectedCharacters.some((c) => text.includes(c) || (a.characterTag && a.characterTag.includes(c)))
          if (!hit) return false
        }

        if (this.keyword && !(a.fileName || '').toLowerCase().includes(this.keyword.toLowerCase())) {
          return false
        }
        return true
      })

      const map = new Map()
      for (const a of filtered) {
        const k = this.dateKey(a.createdAt)
        if (!map.has(k)) map.set(k, { key: k, label: this.dateLabel(a.createdAt), items: [] })
        map.get(k).items.push(a)
      }
      return Array.from(map.values())
    },
  },
  onLoad() {
    if (!sessionValid()) {
      this.redirectLogin('未登录或会话已失效，请先登录')
      return
    }
    const sys = uni.getSystemInfoSync()
    this.statusBarHeight = sys.statusBarHeight || 20
    const topEstimate = this.statusBarHeight + 180
    this.gridH = Math.max(300, (sys.windowHeight || 800) - topEstimate)
    this.userLabel = store.getUsername()
    this.loadMenuTree()
    this.reload()
    this.verifySessionInBackground()
    this.maybeAskPhotoPermission()
  },
  onReady() {
    this.$nextTick(() => {
      this.measureGridHeight()
    })
  },
  onShow() {
    if (this._redirecting) return
    if (!sessionValid()) {
      this.redirectLogin('登录已过期，请重新登录')
      return
    }
    this.userLabel = store.getUsername()
    const autoSelect = uni.getStorageSync('auto_enter_select_mode')
    if (autoSelect === '1') {
      uni.removeStorageSync('auto_enter_select_mode')
      this.activeMediaTab = 'image'
      this.isSelectMode = true
      uni.showToast({ title: '请勾选 2~6 张需要生成漫游的照片', icon: 'none' })
    }
    if (!this.loaded && !this.loading) {
      this.reload()
    }
  },
  onUnload() {
    if (this.audioCtx) {
      this.audioCtx.destroy()
      this.audioCtx = null
    }
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer)
      this._scrollTimer = null
    }
  },
  methods: {
    onCardLongPress(item) {
      if (!item || !item.fid) return
      uni.showActionSheet({
        itemList: ['删除并拉黑（不再入库）', '取消'],
        success: (res) => {
          if (res.tapIndex === 0) this.confirmDeleteAsset(item)
        },
      })
    },
    confirmDeleteAsset(item) {
      uni.showModal({
        title: '删除素材',
        content: `将删除「${item.fileName || item.fid}」并加入黑名单，下次同步不会再入库。`,
        confirmColor: '#DC2626',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deleteAsset(item.fid)
            this.groups = (this.groups || []).map((g) => ({
              ...g,
              items: (g.items || []).filter((x) => x.fid !== item.fid),
            })).filter((g) => (g.items || []).length > 0)
            try { viewerCache.clearAll?.() } catch (e) {}
            uni.showToast({ title: '已删除并拉黑', icon: 'none' })
          } catch (e) {
            uni.showToast({ title: '删除失败: ' + (e.message || e), icon: 'none' })
          }
        },
      })
    },
    toggleMediaTypeMenu() {
      this.showMediaTypeMenu = !this.showMediaTypeMenu
    },
    selectMediaType(key) {
      this.showMediaTypeMenu = false
      this.switchMediaTab(key)
    },
    measureGridHeight() {
      const sys = uni.getSystemInfoSync()
      const winH = sys.windowHeight || 800
      uni.createSelectorQuery().in(this).select('.filter-bar-container').boundingClientRect((data) => {
        if (data && data.bottom) {
          const calculated = winH - data.bottom
          if (calculated > 100) {
            this.gridH = calculated
            return
          }
        }
        const topH = (sys.statusBarHeight || 20) + 180
        this.gridH = Math.max(300, winH - topH)
      }).exec()
    },
    onScrollToLower() {
      if (this.loading || this.loadingMore || this.finished) return
      if (this._scrollTimer) clearTimeout(this._scrollTimer)
      this._scrollTimer = setTimeout(() => {
        this.loadMore()
      }, 150)
    },
    getSelectedListByDim(dim) {
      switch (dim) {
        case 'subCategory': return this.selectedSubCategory ? [this.selectedSubCategory] : []
        case 'space': return this.selectedSpaces
        case 'style': return this.selectedStyles
        case 'furniture': return this.selectedFurniture
        case 'material': return this.selectedMaterials
        case 'color': return this.selectedColors
        case 'orientation': return this.selectedOrientations
        case 'videoSource': return this.selectedVideoSources
        case 'mood': return this.selectedMoods
        case 'pose': return this.selectedPoses
        case 'character': return this.selectedCharacters
        default: return null
      }
    },
    getOptionsByDim(dim) {
      switch (dim) {
        case 'subCategory': return this.currentSubCategories
        case 'space': return this.spaceList
        case 'style': return this.styleList
        case 'furniture': return this.furnitureList
        case 'material': return this.materialList
        case 'color': return this.colorList
        case 'orientation': return this.orientationList
        case 'videoSource': return this.videoSourceList
        case 'mood': return this.moodList
        case 'pose': return this.poseList
        case 'character': return this.characterList
        default: return []
      }
    },
    toggleDropdown(dim) {
      this.activeDropdown = this.activeDropdown === dim ? '' : dim
    },
    closeDropdown() {
      this.activeDropdown = ''
    },
    dropdownLabel(dim, defaultText, list) {
      if (!list || !list.length) return defaultText
      if (list.length === 1) {
        const val = list[0]
        const opts = this.getOptionsByDim(dim)
        const found = opts.find((o) => (o.key || o) === val)
        const txt = (found && (found.label || found.key)) || val
        return txt.length > 5 ? txt.slice(0, 4) + '…' : txt
      }
      return `${defaultText} (${list.length})`
    },
    isOptionChecked(optKey) {
      if (this.activeDropdown === 'subCategory') {
        return this.selectedSubCategory === optKey
      }
      const list = this.getSelectedListByDim(this.activeDropdown)
      return list ? list.includes(optKey) : false
    },
    toggleOption(optKey) {
      if (this.activeDropdown === 'subCategory') {
        this.selectedSubCategory = this.selectedSubCategory === optKey ? '' : optKey
        return
      }
      const list = this.getSelectedListByDim(this.activeDropdown)
      if (!list) return
      const idx = list.indexOf(optKey)
      if (idx > -1) {
        list.splice(idx, 1)
      } else {
        list.push(optKey)
      }
    },
    clearCurrentDropdown() {
      if (this.activeDropdown === 'subCategory') {
        this.selectedSubCategory = ''
        this.reload()
        return
      }
      const list = this.getSelectedListByDim(this.activeDropdown)
      if (list) {
        list.splice(0, list.length)
      }
      this.reload()
    },
    confirmDropdown() {
      this.activeDropdown = ''
      this.reload()
    },
    resetAllFilters(shouldReload = true) {
      this.selectedSubCategory = ''
      this.selectedSpaces = []
      this.selectedStyles = []
      this.selectedFurniture = []
      this.selectedMaterials = []
      this.selectedColors = []
      this.selectedOrientations = []
      this.selectedVideoSources = []
      this.selectedMoods = []
      this.selectedPoses = []
      this.selectedCharacters = []
      this.activeDropdown = ''
      if (shouldReload) {
        this.reload()
      }
    },
    async loadMenuTree() {
      try {
        const list = await fetchMenuTree()
        if (Array.isArray(list) && list.length > 0) {
          this.menuTree = list
          this.mediaTypeList = list.map(item => ({
            key: item.key,
            label: item.label,
            icon: item.icon === 'grid' ? '📦' :
                  item.icon === 'sofa' ? '🛋️' :
                  item.icon === 'building' ? '🏛️' :
                  item.icon === 'shirt' ? '👔' :
                  item.icon === 'user' ? '👤' :
                  item.icon === 'video' ? '🎬' :
                  item.icon === 'music' ? '🎵' :
                  item.icon === 'trash' ? '🗑️' : '📁',
            children: item.children || [],
            facets: item.facets || []
          }))

          // 12 色标准板（菜单树下发的兜底；filterOptions 有数据时优先用它）
          const allCat = list.find(c => c.key === 'all')
          const colorFacet = allCat?.facets?.find(f => f.key === 'dominant_color')
          if (colorFacet && colorFacet.options) {
            this.paletteList = colorFacet.options.map(o => ({
              key: o.value || o.label,
              label: o.label,
              hex: o.hex || '',
              count: 0
            }))
          }
        }
      } catch (e) {
        // 弱网兜底保留现有配置
      }
    },
    async onRefresh() {
      this.refreshing = true
      try {
        await this.reload({ force: true })
      } finally {
        this.refreshing = false
      }
    },
    async verifySessionInBackground() {
      try {
        const me = await fetchMe()
        if (me && me.username) {
          store.setUsername(me.username)
          if (me.role) store.setRole(me.role)
          this.userLabel = me.username
        }
      } catch (e) {
        const msg = (e && e.message) || ''
        if (/会话已过期|未登录|401/.test(msg)) {
          store.clearSession()
          this.redirectLogin('会话已过期，请重新登录')
        }
      }
    },
    redirectLogin(tip) {
      if (this._redirecting) return
      this._redirecting = true
      goLogin(tip)
    },
    // 权限页不再是启动页：首屏先渲染素材库，授权引导延后到首帧之后
    maybeAskPhotoPermission() {
      if (store.isPhotoPermissionGranted()) return
      if (uni.getStorageSync('photo_perm_prompted') === '1') return
      uni.setStorageSync('photo_perm_prompted', '1')
      setTimeout(() => {
        uni.navigateTo({
          url: '/pages/permission/permission',
          fail: () => {},
        })
      }, 1200)
    },
    dateKey(ts) {
      if (!ts) return 'unknown'
      const d = new Date(ts)
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
    },
    dateLabel(ts) {
      if (!ts) return '未知时间'
      const d = new Date(ts)
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      if (ts >= start) return '今天'
      if (ts >= start - 86400000) return '昨天'
      if (d.getFullYear() === now.getFullYear())
        return d.getMonth() + 1 + '月' + d.getDate() + '日'
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
    },
    cardStyle(item) {
      if (item.isMusic) {
        return { background: 'linear-gradient(135deg, #312e81, #1e1b4b)' }
      }
      if (item.demoGradient) {
        return { background: item.demoGradient }
      }
      return { background: 'linear-gradient(145deg,#b0c4c8,#5f7f88)' }
    },
    switchMediaTab(tab) {
      if (this.activeMediaTab === tab) return
      if (this.audioCtx) {
        this.audioCtx.stop()
        this.currentlyPlayingFid = ''
      }
      this.activeMediaTab = tab
      this.activeDropdown = ''
      this.isSelectMode = false
      this.selectedFids = []
      this.all = []
      this.loading = true
      this.loaded = false
      this.resetAllFilters(false)
      this.reload({ force: true })
    },
    toggleSort() {
      this.sortLatest = !this.sortLatest
      this.reload()
    },
    async reload(options = {}) {
      if (!sessionValid()) {
        this.redirectLogin('登录已过期，请重新登录')
        return
      }
      const forceRefresh = options && options.force === true
      const queryOpts = {
        page: 1,
        keyword: this.keyword,
        space: this.selectedSpaces.join(','),
        style: this.selectedStyles.join(','),
        furniture_item: this.selectedFurniture.join(','),
        material: this.selectedMaterials.join(','),
        colors: this.selectedColors.join(','),
        orientation: this.selectedOrientations.join(','),
        sort: this.sortLatest ? 'latest' : 'earliest',
        mediaType: this.activeMediaTab,
        videoSource: this.selectedVideoSources.join(','),
        mood: this.selectedMoods.join(','),
        pose: this.selectedPoses.join(','),
        character: this.selectedCharacters.join(','),
      }
      const cacheKey = viewerCache.makeListKey(queryOpts)
      const cached = viewerCache.getList(cacheKey)

      // SWR：若有本地缓存且非下拉强制刷新，立即呈现缓存数据（瞬时秒开，零白屏）
      if (cached && cached.data && !forceRefresh) {
        const data = cached.data
        this.all = (data.items || []).map((r) => this.mapServer(r))
        this.finished = this.all.length >= (data.total || 0)
        this.applyServerFilters(data)
        this.loaded = true
        this.errorText = ''
        if (cached.isFresh) {
          this.loading = false
          return
        }
      }

      if (!this.all.length) {
        this.loading = true
        this.loaded = false
      }
      this.errorText = ''
      this.page = 1
      try {
        const data = await fetchAssets(queryOpts)
        this.all = (data.items || []).map((r) => this.mapServer(r))
        this.finished = this.all.length >= (data.total || 0)
        this.applyServerFilters(data)
      } catch (e) {
        const msg = e.message || '加载失败'
        if (/会话已过期|未登录|401/.test(msg)) {
          store.clearSession()
          this.redirectLogin(msg)
          return
        }
        if (!this.all.length) {
          this.errorText = msg
        }
      } finally {
        this.loading = false
        this.loaded = true
      }
    },
    applyServerFilters(data) {
      const facets = data.filterOptions || data.facets || data.filters || {}
      const dims = Array.isArray(facets.dimensions) ? facets.dimensions : []
      const toOptions = (arr) => {
        if (!Array.isArray(arr)) return []
        return arr
          .map((x) => {
            if (x && typeof x === 'object') {
              const key = x.dir || x.value || x.key || x.label
              if (!key) return null
              return {
                key,
                label: x.label || x.dir || key,
                hex: x.hex || '',
                count: Number(x.count) || 0,
              }
            }
            if (!x) return null
            return { key: x, label: x, hex: '', count: 0 }
          })
          .filter(Boolean)
      }

      for (const dim of dims) {
        const listKey = `${dim.key}List`
        if (!this[listKey]) continue
        const sources = Array.isArray(dim.source) ? dim.source : [dim.source]
        let opts = []
        for (const s of sources) opts = opts.concat(toOptions(facets[s]))
        const seen = new Set()
        opts = opts.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true)))
        if (dim.key === 'color' && !opts.length) opts = this.paletteList
        this[listKey] = opts
      }
    },
    placeholderExt(name) {
      if (!name) return 'IMG'
      const idx = name.lastIndexOf('.')
      return (idx > -1 ? name.slice(idx + 1) : name).slice(0, 4).toUpperCase()
    },
    isVideo(name) {
      return /\.(mp4|mov|avi|mkv|webm)$/i.test(name || '')
    },
    isAudio(name) {
      return /\.(mp3|wav|aac|flac|m4a|ogg)$/i.test(name || '')
    },
    formatDuration(sec) {
      if (!sec) return '00:00'
      const m = Math.floor(sec / 60)
      const s = Math.floor(sec % 60)
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    },
    togglePlayAudioItem(item) {
      if (this.currentlyPlayingFid === item.fid) {
        if (this.audioCtx) {
          this.audioCtx.pause()
          this.currentlyPlayingFid = ''
        }
        return
      }
      if (this.audioCtx) {
        this.audioCtx.stop()
        this.audioCtx.destroy()
        this.audioCtx = null
      }
      this.audioCtx = uni.createInnerAudioContext()
      this.audioCtx.src = mediaUrl(item.fid, 0)
      this.currentlyPlayingFid = item.fid
      this.audioCtx.onPlay(() => { this.currentlyPlayingFid = item.fid })
      this.audioCtx.onPause(() => { this.currentlyPlayingFid = '' })
      this.audioCtx.onEnded(() => { this.currentlyPlayingFid = '' })
      this.audioCtx.onError((e) => {
        console.warn('[browse audio error]', e)
        this.currentlyPlayingFid = ''
        uni.showToast({ title: '播放失败', icon: 'none' })
      })
      this.audioCtx.play()
    },
    onImgError(item) {
      if (item.localPath && item.imgUrl === item.localPath && item.serverUrl) {
        localMediaIndex.invalidate(item.fileName)
        item.localPath = ''
        item.imgUrl = item.serverUrl
        return
      }
      if (item.prefetchPath && item.imgUrl === item.prefetchPath) {
        // 预取的本地网格图可能已被系统清理，退回网络网格档
        item.prefetchPath = ''
        item.imgUrl = item.gridImgUrl || item.serverUrl
        return
      }
      if (item.gridImgUrl && item.imgUrl === item.gridImgUrl) {
        item.imgUrl = item.serverUrl
        return
      }
      if (item.thumbUrl && item.imgUrl !== item.thumbUrl) {
        item.imgUrl = item.thumbUrl
      } else {
        item.imgFailed = true
      }
    },
    mapServer(r) {
      const w = r.width || 1080
      const h = r.height || 1440
      const mainDeriv = r.mainDerivative || {}
      const derivId = mainDeriv.id || 0
      const fileName = r.file_name || ''
      const isVid =
        this.isVideo(fileName) ||
        r.media_type === 'video' ||
        !!(r.mime && r.mime.startsWith('video/')) ||
        (!!r.duration && !this.isAudio(fileName))
      const isMus =
        r.media_type === 'music' ||
        r.category === 'music' ||
        r.kind === 'audio' ||
        this.isAudio(fileName)
      const isPort = r.media_type === 'portrait' || r.category === 'portrait'
      const isFurn = r.media_type === 'furniture' || r.category === 'furniture'

      const isAiVid =
        isVid &&
        (r.is_ai === 1 ||
          r.is_ai === true ||
          !!r.source_asset_id ||
          (mainDeriv.kind && String(mainDeriv.kind).includes('ai_video')))
      const isRestage =
        !isVid && !isMus && !isPort && !isFurn && !!(mainDeriv.kind && String(mainDeriv.kind).startsWith('restage_'))

      const serverUrl = isVid ? videoUrl(r.fid) : mediaUrl(r.fid, derivId)
      const gridImgUrl = isVid ? '' : gridUrl(r.fid)
      const poster = isVid ? ((r.poster_url && r.poster_url.startsWith('http')) ? r.poster_url : posterUrl(r.fid)) : ''

      let localPath = ''
      if (!isRestage && !isAiVid && !isMus && fileName) {
        localPath = localMediaIndex.getLocalPath(fileName, r.size || 0)
      }
      // 预取落盘的网格图优先于网络网格档（省一次往返）
      const prefetchPath = isVid ? '' : prefetch.getLocalPath(r.fid)
      // 列表走 256px 网格档；加载失败时 onImgError 逐级回落到预览图
      const imgUrl = isVid
        ? (poster || localPath || serverUrl)
        : (localPath || prefetchPath || gridImgUrl || serverUrl)

      const tags = r.tags || []
      const space = tags.find((t) => t.dimension === 'space')?.label || ''
      const style =
        tags.find((t) => t.dimension === 'style_atom' || t.dimension === 'style')?.label || ''
      const furn =
        tags.find((t) => t.dimension === 'furniture_item' || t.dimension === 'furniture_category')?.label || ''
      const mat =
        tags.find((t) => t.dimension === 'material_kind' || t.dimension === 'material')?.label || ''
      const mood = tags.find((t) => t.dimension === 'mood')?.label || ''
      const genre = tags.find((t) => t.dimension === 'genre')?.label || ''
      const pose = tags.find((t) => t.dimension === 'pose')?.label || ''
      const character = tags.find((t) => t.dimension === 'character')?.label || ''
      const domColor = r.dominant_color || ''

      let parts = []
      if (isMus) {
        parts = [mood, genre, space].filter(Boolean)
      } else if (isPort) {
        parts = [pose, character, style].filter(Boolean)
      } else if (isFurn) {
        parts = [furn, mat, style, domColor ? `${domColor}调` : ''].filter(Boolean)
      } else {
        parts = [space, style, furn, mat, domColor ? `${domColor}调` : ''].filter(Boolean)
      }

      const tagsText = parts.length ? parts.join(' · ') : (r.mainLabel || (tags[0] && tags[0].label) || '')
      const rawTags = tags.map((t) => t.label).join(' ')

      let ratio = (h / w) * 100
      if (isMus) {
        ratio = 62
      } else {
        if (ratio < 75) ratio = 75
        if (ratio > 135) ratio = 135
      }

      return {
        fid: r.fid,
        fileName,
        width: w,
        height: h,
        orientation: r.origin_orientation || '',
        mediaType: r.media_type || (isMus ? 'music' : (isPort ? 'portrait' : (isFurn ? 'furniture' : (isVid ? 'video' : 'image')))),
        isVideo: isVid,
        isAiVideo: isAiVid,
        isMusic: isMus,
        isPortrait: isPort,
        isFurniture: isFurn,
        sourceAssetId: r.source_asset_id || null,
        duration: r.duration || 0,
        isRestage,
        mainDerivativeKind: mainDeriv.kind || '',
        hasWatermark: r.has_watermark === 1 || r.has_watermark === true,
        createdAt: r.createdAt || r.created_at || 0,
        tagsText,
        spaceTag: space,
        styleTag: style,
        furnitureTag: furn,
        materialTag: mat,
        moodTag: mood,
        genreTag: genre,
        poseTag: pose,
        characterTag: character,
        dominantColor: r.dominant_color || '',
        rawTags,
        mainLabel: r.mainLabel || '',
        ratio,
        imgUrl,
        serverUrl,
        gridImgUrl,
        prefetchPath,
        localPath,
        posterUrl: poster,
        thumbUrl: r.thumb_url || '',
        imgFailed: false,
        server: true,
      }
    },
    async loadMore() {
      if (this.loading || this.loadingMore || this.finished) return
      this.loadingMore = true
      const nextPage = this.page + 1
      const queryOpts = {
        page: nextPage,
        pageSize: 30,
        keyword: this.keyword,
        space: this.selectedSpaces.join(','),
        style: this.selectedStyles.join(','),
        furniture_item: this.selectedFurniture.join(','),
        material: this.selectedMaterials.join(','),
        colors: this.selectedColors.join(','),
        orientation: this.selectedOrientations.join(','),
        sort: this.sortLatest ? 'latest' : 'earliest',
        mediaType: this.activeMediaTab,
        videoSource: this.selectedVideoSources.join(','),
        mood: this.selectedMoods.join(','),
        pose: this.selectedPoses.join(','),
        character: this.selectedCharacters.join(','),
      }
      try {
        const data = await fetchAssets(queryOpts)
        const newItems = (data.items || []).map((r) => this.mapServer(r))
        if (newItems.length > 0) {
          const existingFids = new Set(this.all.map((a) => a.fid))
          for (const it of newItems) {
            if (!existingFids.has(it.fid)) {
              this.all.push(it)
              existingFids.add(it.fid)
            }
          }
          this.page = nextPage
          this.finished = this.all.length >= (data.total || 0) || newItems.length === 0
        } else {
          this.finished = true
        }
      } catch (e) {
        console.warn('[browse] loadMore failed', e)
      } finally {
        this.loadingMore = false
      }
    },
    openDetail(item) {
      if (this._navigating) return
      this._navigating = true
      const defaultTab = (item.isRestage && item.mainDerivativeKind) ? item.mainDerivativeKind : 'origin'
      const initialDerivs = (item.isRestage && item.mainDerivativeKind)
        ? [{ kind: item.mainDerivativeKind, id: 0 }]
        : []
      // 将已成功渲染的图片地址、本地路径、尺寸、默认画幅等完整透传，详情页0毫秒秒开，内外画幅无缝对齐
      viewerCache.setPendingDetailPreview({
        ...item,
        defaultTab,
        mainDerivativeKind: item.mainDerivativeKind,
        imgUrl: item.imgUrl,
        localPath: item.localPath,
        serverUrl: item.serverUrl,
        posterUrl: item.posterUrl,
        derivatives: initialDerivs,
      })
      uni.navigateTo({
        url: '/pages/detail/detail?fid=' + encodeURIComponent(item.fid) + '&tab=' + encodeURIComponent(defaultTab),
        complete: () => {
          setTimeout(() => {
            this._navigating = false
          }, 500)
        },
      })
    },
    openSettings() {
      if (this._navigating) return
      this._navigating = true
      uni.switchTab({
        url: '/pages/settings/settings',
        complete: () => {
          setTimeout(() => {
            this._navigating = false
          }, 500)
        },
      })
    },
    openStudio() {
      if (this._navigating) return
      this._navigating = true
      switchTabTo('/pages/home/home', { view: 'operate' })
      setTimeout(() => {
        this._navigating = false
      }, 500)
    },
    toggleSelectMode() {
      this.isSelectMode = !this.isSelectMode
      if (!this.isSelectMode) {
        this.selectedFids = []
      }
    },
    isSelected(fid) {
      return this.selectedFids.includes(fid)
    },
    toggleSelect(item) {
      const idx = this.selectedFids.indexOf(item.fid)
      if (idx > -1) {
        this.selectedFids.splice(idx, 1)
      } else {
        this.selectedFids.push(item.fid)
      }
    },
    clearSelection() {
      this.selectedFids = []
    },
    onCardClick(item) {
      if (this.isSelectMode && !item.isVideo && !item.isMusic) {
        this.toggleSelect(item)
        return
      }
      this.openDetail(item)
    },
    openWalkthroughDrawer() {
      if (this.selectedFids.length < 2) {
        uni.showToast({ title: '至少勾选 2 张空间照片以生成漫游', icon: 'none' })
        return
      }
      this.drawerVisible = true
    },
    onWalkthroughSuccess() {
      this.isSelectMode = false
      this.selectedFids = []
      this.switchMediaTab('video')
    },
  },
}
</script>

<style scoped>
.page {
  height: 100vh;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.grid-scroll {
  flex: 1;
  height: 0;
  width: 100%;
}
.nav {
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28rpx;
  background: #f8fafc;
}
.nav-brand {
  display: flex;
  align-items: center;
  gap: 14rpx;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.nav-logo {
  width: 52rpx;
  height: 52rpx;
  border-radius: 14rpx;
  background: linear-gradient(145deg, #2563eb, #60a5fa);
  color: #fff;
  font-size: 24rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.media-type-dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 10rpx;
  background: #ffffff;
  border: 1rpx solid #e2e8f0;
  border-radius: 999rpx;
  padding: 10rpx 22rpx 10rpx 16rpx;
  box-shadow: 0 2rpx 8rpx rgba(15, 23, 42, 0.05);
  transition: all 0.2s;
}
.media-type-dropdown-trigger:active {
  background: #f1f5f9;
}
.media-type-icon {
  font-size: 28rpx;
}
.media-type-label {
  font-size: 26rpx;
  font-weight: 700;
  color: #0f172a;
}
.media-type-arrow {
  font-size: 22rpx;
  color: #64748b;
  margin-left: 2rpx;
}

/* 下拉菜单蒙层与气泡 */
.media-type-popover-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  background: rgba(15, 23, 42, 0.2);
}
.media-type-popover {
  position: absolute;
  left: 88rpx;
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 16rpx 48rpx rgba(15, 23, 42, 0.16);
  border: 1rpx solid #e2e8f0;
  padding: 12rpx;
  min-width: 280rpx;
}
.popover-item {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  transition: all 0.15s;
}
.popover-item:active {
  background: #f1f5f9;
}
.popover-item.active {
  background: #eff6ff;
}
.popover-item-icon {
  font-size: 28rpx;
}
.popover-item-text {
  flex: 1;
  font-size: 26rpx;
  font-weight: 600;
  color: #334155;
}
.popover-item.active .popover-item-text {
  color: #2563eb;
  font-weight: 700;
}
.popover-item-check {
  font-size: 24rpx;
  color: #2563eb;
  font-weight: bold;
}
.nav-title {
  font-size: 36rpx;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -1rpx;
}
.nav-right-box {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}
.nav-action-btn {
  font-size: 24rpx;
  color: #2563eb;
  font-weight: 600;
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: #eff6ff;
  transition: all 0.2s;
}
.nav-action-btn.active {
  background: #2563eb;
  color: #ffffff;
}
.refresh-pill-btn {
  width: 54rpx;
  height: 54rpx;
  border-radius: 50%;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.refresh-pill-btn:active {
  background: #e2e8f0;
}
.refresh-icon {
  font-size: 28rpx;
  color: #64748b;
  font-weight: bold;
}
.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.search-row {
  display: flex;
  align-items: center;
  padding: 8rpx 28rpx 16rpx;
  gap: 16rpx;
}
.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  height: 80rpx;
  background: #fff;
  border: 1rpx solid #e2e8f0;
  border-radius: 40rpx;
  padding: 0 24rpx;
  gap: 10rpx;
}
.search-icon {
  font-size: 30rpx;
  color: #94a3b8;
}
.search-input {
  flex: 1;
  height: 80rpx;
  font-size: 26rpx;
  color: #0f172a;
}
.sort-btn {
  font-size: 24rpx;
  color: #2563eb;
  font-weight: 600;
  padding: 8rpx 4rpx;
}
/* 聚合下拉筛选条容器 */
.filter-bar-container {
  position: relative;
  z-index: 100;
  background: #f8fafc;
}
.filter-bar-scroll {
  white-space: nowrap;
  padding-bottom: 12rpx;
}
.filter-bar {
  display: flex;
  align-items: center;
  padding: 4rpx 28rpx;
  gap: 14rpx;
}
.dropdown-trigger {
  display: inline-flex;
  align-items: center;
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  background: #f1f5f9;
  border: 1.5rpx solid #e2e8f0;
  font-size: 24rpx;
  color: #475569;
  gap: 6rpx;
  flex-shrink: 0;
  transition: all 0.2s ease;
}
.dropdown-trigger.selected {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #2563eb;
  font-weight: 600;
}
.dropdown-trigger.active {
  border-color: #2563eb;
  box-shadow: 0 2rpx 10rpx rgba(37, 99, 235, 0.18);
}
.trigger-label {
  font-size: 24rpx;
}
.trigger-arrow {
  font-size: 20rpx;
  color: #94a3b8;
  margin-left: 2rpx;
}
.dropdown-trigger.selected .trigger-arrow {
  color: #2563eb;
}
.reset-chip {
  display: inline-flex;
  align-items: center;
  padding: 12rpx 22rpx;
  border-radius: 999rpx;
  background: #fef2f2;
  border: 1.5rpx solid #fecaca;
  flex-shrink: 0;
}
.reset-text {
  font-size: 22rpx;
  color: #ef4444;
  font-weight: 600;
}

/* 下拉多选面板遮罩与弹出层 */
.dropdown-panel-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 995;
}
.dropdown-mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
}
.dropdown-panel {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 72vh;
  background: #ffffff;
  border-radius: 36rpx 36rpx 0 0;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -8rpx 36rpx rgba(0, 0, 0, 0.16);
  padding-bottom: calc(20rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  animation: panelSlideUp 0.25s ease-out;
}
@keyframes panelSlideUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
.panel-header {
  padding: 32rpx 32rpx 20rpx;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1rpx solid #f1f5f9;
}
.panel-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #0f172a;
}
.panel-hint {
  font-size: 22rpx;
  color: #94a3b8;
}
.panel-options-scroll {
  max-height: 48vh;
  padding: 24rpx 32rpx;
  box-sizing: border-box;
}
.options-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}
.option-chip {
  display: inline-flex;
  align-items: center;
  padding: 14rpx 28rpx;
  border-radius: 999rpx;
  background: #f8fafc;
  border: 1.5rpx solid #e2e8f0;
  font-size: 26rpx;
  color: #334155;
  transition: all 0.18s ease;
}
.color-chip-dot {
  width: 22rpx;
  height: 22rpx;
  border-radius: 50%;
  margin-right: 12rpx;
  border: 1.5rpx solid rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
}
.option-chip.checked {
  background: #eff6ff;
  border-color: #2563eb;
  color: #2563eb;
  font-weight: 600;
  box-shadow: 0 2rpx 10rpx rgba(37, 99, 235, 0.16);
}
.opt-check {
  margin-right: 8rpx;
  font-weight: 800;
  font-size: 24rpx;
  color: #2563eb;
}
.opt-text {
  font-size: 26rpx;
}
.panel-footer {
  display: flex;
  padding: 20rpx 32rpx;
  gap: 20rpx;
  border-top: 1rpx solid #f1f5f9;
}
.panel-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 84rpx;
  border-radius: 42rpx;
  font-size: 28rpx;
  box-sizing: border-box;
}
.panel-btn.reset {
  flex: 1;
  background: #f1f5f9;
  color: #64748b;
  font-weight: 600;
}
.panel-btn.confirm {
  flex: 2;
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #ffffff;
  font-weight: 700;
  box-shadow: 0 4rpx 14rpx rgba(37, 99, 235, 0.35);
}
.grid-scroll {
  flex: 1;
  padding: 8rpx 20rpx 32rpx;
  box-sizing: border-box;
}
.date-group {
  margin-bottom: 12rpx;
}
.date-label {
  display: block;
  padding: 20rpx 4rpx 14rpx;
  font-size: 26rpx;
  font-weight: 700;
  color: #0f172a;
}
.cards {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  box-sizing: border-box;
}
.card {
  width: calc(50% - 10rpx);
  margin-right: 20rpx;
  margin-bottom: 20rpx;
  border-radius: 20rpx;
  overflow: hidden;
  background: #fff;
  border: 1rpx solid #e2e8f0;
  box-sizing: border-box;
  box-shadow: 0 4rpx 12rpx rgba(15, 23, 42, 0.04);
  transition: all 0.2s ease;
}
.card.selected {
  border: 2rpx solid #2563eb;
  box-shadow: 0 4rpx 18rpx rgba(37, 99, 235, 0.2);
}
.card:nth-child(2n) {
  margin-right: 0;
}
.select-checkbox {
  position: absolute;
  top: 14rpx;
  right: 14rpx;
  width: 44rpx;
  height: 44rpx;
  border-radius: 22rpx;
  border: 3rpx solid rgba(255, 255, 255, 0.95);
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.3);
}
.select-checkbox.checked {
  background: #2563eb;
  border-color: #ffffff;
}
.check-icon {
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 700;
}
.card-media {
  position: relative;
  width: 100%;
  height: 0;
  overflow: hidden;
  background: #f1f5f9;
}
.card-img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.card-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.placeholder-text {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 700;
  letter-spacing: 2rpx;
}
.badge {
  position: absolute;
  top: 14rpx;
  left: 14rpx;
  background: rgba(99, 102, 241, 0.92);
  color: #fff;
  font-size: 18rpx;
  padding: 6rpx 12rpx;
  border-radius: 999rpx;
  z-index: 2;
  font-weight: 600;
}
.badge.wm {
  left: auto;
  right: 14rpx;
  background: rgba(217, 119, 6, 0.92);
}
.badge.vid {
  position: absolute;
  top: 14rpx;
  left: 14rpx;
  background: rgba(30, 41, 59, 0.85);
  color: #fff;
  font-size: 18rpx;
  padding: 6rpx 14rpx;
  border-radius: 999rpx;
  z-index: 2;
  font-weight: 600;
}
.badge.vid.ai {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  box-shadow: 0 2rpx 8rpx rgba(99, 102, 241, 0.4);
}
.video-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1;
}
.play-bubble {
  width: 72rpx;
  height: 72rpx;
  border-radius: 36rpx;
  background: rgba(15, 23, 42, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.2);
}
.play-icon {
  color: #ffffff;
  font-size: 28rpx;
  margin-left: 4rpx;
}
.card-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 36rpx 16rpx 14rpx;
  background: linear-gradient(transparent, rgba(15, 23, 42, 0.75));
  z-index: 2;
}
.cap-name {
  display: block;
  color: #fff;
  font-size: 22rpx;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cap-tag {
  display: block;
  color: rgba(255, 255, 255, 0.78);
  font-size: 18rpx;
  margin-top: 2rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.state-box {
  padding: 100rpx 0;
  text-align: center;
}
.state-text {
  font-size: 28rpx;
  color: #64748b;
}
.state-text.err {
  color: #dc2626;
}
.state-sub {
  display: block;
  margin-top: 14rpx;
  font-size: 24rpx;
  color: #2563eb;
  font-weight: 600;
}
.state-link {
  display: block;
  margin-top: 18rpx;
  font-size: 26rpx;
  color: #2563eb;
  font-weight: 600;
}
.footer {
  text-align: center;
  padding: 32rpx 0 54rpx;
  font-size: 22rpx;
  color: #94a3b8;
}
.loading-spinner-wrap {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  padding: 16rpx 0;
}
.loading-spinner {
  width: 32rpx;
  height: 32rpx;
  border: 4rpx solid #e2e8f0;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.loading-spinner-text {
  font-size: 24rpx;
  color: #64748b;
  font-weight: 500;
}
.finished-text {
  font-size: 22rpx;
  color: #94a3b8;
}
.batch-bar {
  position: fixed;
  bottom: 36rpx;
  left: 28rpx;
  right: 28rpx;
  background: rgba(15, 23, 42, 0.94);
  backdrop-filter: blur(12px);
  border-radius: 999rpx;
  padding: 12rpx 16rpx 12rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 16rpx 40rpx rgba(0, 0, 0, 0.28);
  z-index: 990;
  animation: slideInUp 0.25s ease-out;
}
@keyframes slideInUp {
  from { transform: translateY(100rpx); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.batch-info {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.batch-count {
  font-size: 26rpx;
  font-weight: 600;
  color: #ffffff;
}
.batch-clear {
  font-size: 22rpx;
  color: #94a3b8;
  padding: 6rpx 10rpx;
}
.batch-btn {
  background: linear-gradient(135deg, #2563eb, #6366f1);
  padding: 16rpx 32rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 14rpx rgba(37, 99, 235, 0.4);
}
.batch-btn-text {
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 700;
}

/* ========== 五大素材Tab横向滚动 ========== */
.seg-scroll {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

/* ========== 音乐卡片内容 ========== */
.music-media {
  background: linear-gradient(135deg, #312e81, #1e1b4b) !important;
}
.music-card-body {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
}
.music-disc {
  width: 100rpx;
  height: 100rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 20rpx rgba(99, 102, 241, 0.5);
}
.music-disc.playing {
  animation: rotateDisc 3s linear infinite;
}
@keyframes rotateDisc {
  to { transform: rotate(360deg); }
}
.music-icon-note {
  font-size: 44rpx;
}
.music-play-btn {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.music-play-icon {
  font-size: 28rpx;
  color: #ffffff;
}

/* ========== 人像/单品卡片渲染 ========== */
.portrait-media {
  background: #f8fafc !important;
}
.furniture-media {
  background: #faf5ff !important;
}
.contain-img {
  object-fit: contain !important;
}
.card-img.contain-img {
  background: transparent;
}

/* ========== 分类角标（覆盖/补充.badge） ========== */
.badge.music-badge {
  background: rgba(99, 102, 241, 0.92);
}
.badge.portrait-badge {
  background: rgba(16, 185, 129, 0.92);
}
.badge.furn-badge {
  background: rgba(139, 92, 246, 0.88);
}
</style>

