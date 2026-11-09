<template>
  <view class="page" :style="themeStyle">
    <view class="header-container">
      <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />

      <!-- 顶部主导航栏 (Apple HIG 风格) -->
      <view class="apple-nav">
        <!-- 左侧：筛选抽屉入口 -->
        <view
          class="nav-drawer-btn"
          :class="{ 'has-active': activeFilterCount > 0 }"
          @click="openFilterDrawer"
        >
          <app-icon
            name="sliders"
            :size="18"
            :color="activeFilterCount > 0 ? '#007AFF' : '#1C1C1E'"
          />
          <text class="nav-drawer-text">筛选</text>
          <text v-if="activeFilterCount > 0" class="drawer-badge">{{ activeFilterCount }}</text>
        </view>

        <!-- 中间：Apple 原生风格分段控制器 (图片/视频/音频/回收站) -->
        <view class="apple-segmented">
          <view
            v-for="tab in mainMediaTabs"
            :key="tab.key"
            class="segmented-item"
            :class="{ active: activeMediaTab === tab.key }"
            @click="switchMediaTab(tab.key)"
          >
            <app-icon
              :name="tab.iconName"
              :size="14"
              :color="activeMediaTab === tab.key ? '#007AFF' : '#8E8E93'"
            />
            <text class="segmented-label">{{ tab.label }}</text>
          </view>
          <view
            class="segmented-item trash-item"
            :class="{ active: activeMediaTab === 'trash' }"
            @click="switchMediaTab('trash')"
          >
            <app-icon
              name="trash"
              :size="14"
              :color="activeMediaTab === 'trash' ? '#FF3B30' : '#8E8E93'"
            />
            <text class="segmented-label">回收站</text>
            <text v-if="trashCount > 0" class="trash-badge-dot">{{ trashCount > 99 ? '99+' : trashCount }}</text>
          </view>
        </view>

        <!-- 右侧：多选与刷新 -->
        <view class="nav-actions">
          <view
            class="action-text-btn"
            :class="{ active: isSelectMode }"
            @click="toggleSelectMode"
          >
            {{ isSelectMode ? '完成' : '多选' }}
          </view>
          <view class="refresh-circle-btn" @click="onRefresh">
            <app-icon name="refresh" :size="15" color="#8E8E93" :class="{ spinning: refreshing }" />
          </view>
        </view>
      </view>

      <!-- 二级细分品类：轻量紧凑水平滑动胶囊 -->
      <view v-if="activeMediaTab !== 'trash' && currentSections.length" class="section-pill-bar">
        <scroll-view scroll-x class="section-pill-scroll" :show-scrollbar="false">
          <view class="section-pill-inner">
            <view
              v-for="sec in currentSections"
              :key="sec.key"
              class="section-pill"
              :class="{ active: activeSection === sec.key }"
              @click="switchSection(sec.key)"
            >
              <app-icon
                :name="sectionIconName(sec.key)"
                :size="13"
                :color="activeSection === sec.key ? '#FFFFFF' : '#636366'"
              />
              <text class="section-pill-text">{{ sec.label }}</text>
            </view>
          </view>
        </scroll-view>
      </view>

      <!-- 回收站分类 -->
      <view v-else class="section-pill-bar">
        <scroll-view scroll-x class="section-pill-scroll" :show-scrollbar="false">
          <view class="section-pill-inner">
            <view
              v-for="s in trashSourceFilters"
              :key="'trash-src-' + (s.key || 'all')"
              class="section-pill"
              :class="{ active: trashSource === s.key }"
              @click="setTrashSource(s.key)"
            >
              <text class="section-pill-text">{{ s.label }}</text>
            </view>
          </view>
        </scroll-view>
      </view>

      <!-- 搜索栏与排序 -->
      <view class="search-sort-bar">
        <view class="search-field">
          <app-icon name="search" :size="15" color="#8E8E93" />
          <input
            class="search-input"
            v-model="keyword"
            :placeholder="searchPlaceholder"
            confirm-type="search"
            @confirm="reload"
          />
          <view v-if="keyword" class="search-clear-btn" @click="keyword = ''; reload()">
            <app-icon name="close" :size="12" color="#8E8E93" />
          </view>
        </view>
        <view class="sort-chip" @click="toggleSort">
          <app-icon name="sort" :size="13" color="#007AFF" />
          <text class="sort-chip-text">{{ sortLatest ? '最新' : '最早' }}</text>
        </view>
      </view>

      <!-- 快捷状态筛选：成片阶段 + 只看收藏 -->
      <view v-if="activeMediaTab !== 'trash' && activeMediaTab !== 'favorite'" class="quick-filter-bar">
        <view class="qf-chip" :class="{ active: shelfFilter === '' && !onlyFavorite }" @click="setShelf('')">全部</view>
        <view class="qf-chip" :class="{ active: shelfFilter === 'retouched' }" @click="setShelf('retouched')">仅精修</view>
        <view class="qf-chip" :class="{ active: shelfFilter === 'finished' }" @click="setShelf('finished')">仅成片</view>
        <view class="qf-chip qf-star" :class="{ active: onlyFavorite }" @click="toggleOnlyFavorite">
          <app-icon name="star" :size="11" :color="onlyFavorite ? '#FFFFFF' : '#8E8E93'" />
          <text>只看收藏</text>
        </view>
      </view>

      <!-- 生效筛选胶囊横条 (仅当抽屉里勾选了筛选时显示) -->
      <view v-if="activeMediaTab !== 'trash' && activeFilterCount > 0" class="active-chips-bar">
        <scroll-view scroll-x class="active-chips-scroll" :show-scrollbar="false">
          <view class="active-chips-inner">
            <view
              v-for="chip in activeFilterChips"
              :key="'chip-' + chip.dim + '-' + chip.key"
              class="active-chip"
              @click="toggleDimOption(chip.dim, chip.key)"
            >
              <text class="active-chip-text">{{ chip.title }} · {{ chip.label }}</text>
              <app-icon name="close" :size="10" color="#007AFF" />
            </view>
            <view class="chips-clear-all" @click="resetAllFilters">清空</view>
          </view>
        </scroll-view>
      </view>

      <!-- 回收站说明 -->
      <view v-if="activeMediaTab === 'trash'" class="trash-hint">
        <text class="trash-hint-text">保留期内可恢复；源文件被清理的记录仍会保留，但标记为不可恢复。</text>
      </view>
    </view>

    <!-- 主瀑布流内容区 -->
    <scroll-view
      scroll-y
      class="grid-scroll"
      :style="{ height: gridH ? gridH + 'px' : 'auto' }"
      :lower-threshold="200"
      :refresher-enabled="true"
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
      @scrolltolower="onScrollToLower"
      @scroll="onGridScroll"
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
          <view class="waterfall">
            <view v-for="col in g.columns" :key="g.key + '-' + col.id" class="wf-col">
            <view
              v-for="item in col.items"
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
                    <app-icon name="audio" :size="24" color="#007AFF" />
                  </view>
                  <view class="music-play-btn" @click.stop="togglePlayAudioItem(item)">
                    <app-icon
                      :name="currentlyPlayingFid === item.fid ? 'pause' : 'play'"
                      :size="14"
                      color="#FFFFFF"
                    />
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

                <!-- 多选模式下的复选框 -->
                <view
                  v-if="isSelectMode && (activeMediaTab === 'trash' || (!item.isVideo && !item.isMusic))"
                  class="select-checkbox"
                  :class="{ checked: isSelected(item.fid) }"
                  @click.stop="toggleSelect(item)"
                >
                  <app-icon v-if="isSelected(item.fid)" name="check" :size="12" color="#FFFFFF" />
                </view>
                <!-- 快捷收藏 -->
                <view
                  v-else-if="activeMediaTab !== 'trash' && !item.isMusic"
                  class="fav-star"
                  :class="{ on: !!item.favoritedAt }"
                  @click.stop="toggleFavorite(item)"
                >
                  <app-icon
                    :name="item.favoritedAt ? 'star-fill' : 'star'"
                    :size="13"
                    :color="item.favoritedAt ? '#F59E0B' : '#FFFFFF'"
                  />
                </view>

                <!-- 视频专属播放徽标与遮罩 -->
                <view v-if="item.isVideo" class="video-overlay">
                  <view class="play-bubble">
                    <app-icon name="play" :size="14" color="#FFFFFF" />
                  </view>
                </view>

                <!-- 来源/特性/品类角标 -->
                <view v-if="item.isVideo" class="badge vid" :class="{ ai: item.isAiVideo }">
                  <app-icon v-if="item.isAiVideo" name="sparkle" :size="10" color="#7C3AED" />
                  <text class="badge-text">{{ item.isAiVideo ? 'AI创作' : '实拍' }}</text>
                </view>
                <text v-else-if="item.isMusic" class="badge music-badge">{{ formatDuration(item.duration) }}</text>
                <text v-else-if="item.isPortrait" class="badge portrait-badge">人像</text>
                <text v-else-if="item.isFurniture" class="badge furn-badge">单品</text>
                <text v-else-if="item.isRestage" class="badge">AI</text>
                <text v-if="activeMediaTab !== 'trash' && item.libraryShelf === 'retouched'" class="badge shelf-badge retouched">精修</text>
                <text v-else-if="activeMediaTab !== 'trash' && item.libraryShelf === 'finished'" class="badge shelf-badge finished">成品</text>
                <text v-if="activeMediaTab === 'trash'" class="badge trash-badge" :class="{ soon: item.expiringSoon, missing: item.fileMissing }">{{ item.disposeLabel }}</text>
                <text v-if="activeMediaTab === 'trash'" class="badge trash-remain" :class="{ soon: item.expiringSoon }">{{ formatRemain(item.remainingHours) }}</text>
                <text v-if="item.hasWatermark" class="badge wm">水印</text>

                <!-- 回收站记录源文件已清理 -->
                <view v-if="activeMediaTab === 'trash' && item.fileMissing" class="missing-overlay">
                  <text class="missing-title">文件已清理</text>
                  <text class="missing-sub">仅保留记录 · 不可恢复</text>
                </view>

                <view class="card-caption">
                  <text class="cap-name">{{ item.fileName }}</text>
                  <text v-if="item.tagsText" class="cap-tag">{{ item.tagsText }}</text>
                </view>
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

    <!-- 滚动日期气泡 -->
    <text
      v-if="bubbleLabel && activeMediaTab !== 'trash' && !isSelectMode"
      class="date-bubble"
      :style="{ top: (gridTop + 8) + 'px' }"
    >{{ bubbleLabel }}</text>

    <!-- 左侧筛选抽屉 (Left Drawer) -->
    <view v-if="filterDrawerOpen" class="drawer-mask" @click="closeFilterDrawer" />
    <view v-if="filterDrawerOpen" class="drawer-panel">
        <!-- 抽屉头部 -->
        <view class="drawer-head">
          <view class="drawer-head-titles">
            <text class="drawer-main-title">高级筛选</text>
            <text class="drawer-sub-title">{{ currentSectionInfo.label }} · 共 {{ totalCount }} 项素材</text>
          </view>
          <view class="drawer-close-btn" @click="closeFilterDrawer">
            <app-icon name="close" :size="18" color="#8E8E93" />
          </view>
        </view>

        <!-- 抽屉滚动内容区：全展开自适应流式网格 -->
        <scroll-view scroll-y class="drawer-scroll-body">
          <view v-for="g in filterGroups" :key="'drawer-group-' + g.dim" class="drawer-group">
            <view class="drawer-group-header">
              <text class="drawer-group-title">{{ g.title }}</text>
              <text
                v-if="selectedCountOf(g.dim)"
                class="drawer-group-clear"
                @click="clearDim(g.dim)"
              >清空 ({{ selectedCountOf(g.dim) }})</text>
            </view>
            <view v-if="g.options.length" class="drawer-chips-wrap">
              <view
                v-for="opt in g.options"
                :key="g.dim + '-' + (opt.key || opt)"
                class="drawer-chip"
                :class="{ active: isDimChecked(g.dim, opt.key || opt) }"
                @click="toggleDimOption(g.dim, opt.key || opt)"
              >
                <view v-if="opt.hex" class="drawer-chip-dot" :style="{ backgroundColor: opt.hex }"></view>
                <text class="drawer-chip-text">{{ opt.label || opt }}</text>
                <app-icon
                  v-if="isDimChecked(g.dim, opt.key || opt)"
                  name="check"
                  :size="12"
                  color="#007AFF"
                />
              </view>
            </view>
            <text v-else class="drawer-empty-hint">暂无可用选项</text>
          </view>
        </scroll-view>

        <!-- 抽屉底部吸底栏 -->
        <view class="drawer-footer">
          <view class="drawer-btn reset" @click="resetAllFilters">
            <text class="drawer-btn-text reset-text">重置全部</text>
          </view>
          <view class="drawer-btn confirm" @click="closeFilterDrawer">
            <text class="drawer-btn-text confirm-text">查看结果 ({{ totalCount }})</text>
          </view>
        </view>
    </view>

    <!-- 多选批量操作浮条 -->
    <view v-if="isSelectMode && selectedFids.length > 0" class="batch-bar">
      <view class="batch-info">
        <text class="batch-count">已选 {{ selectedFids.length }}</text>
        <text class="batch-clear" @click="selectAllVisible">全选</text>
        <text class="batch-clear" @click="invertSelection">反选</text>
        <text class="batch-clear" @click="clearSelection">清空</text>
      </view>
      <view v-if="activeMediaTab === 'trash'" class="batch-actions">
        <view class="batch-btn ghost" @click="batchRestore">
          <text class="batch-btn-text">恢复</text>
        </view>
        <view class="batch-btn danger" @click="batchPurge">
          <text class="batch-btn-text">彻底粉碎</text>
        </view>
      </view>
      <view v-else class="batch-actions">
        <view class="batch-btn ghost" @click="batchClip">
          <text class="batch-btn-text">送入剪辑</text>
        </view>
        <view class="batch-btn" @click="batchCreate('image')">
          <text class="batch-btn-text">生图创作</text>
        </view>
        <view class="batch-btn" @click="batchCreate('video')">
          <text class="batch-btn-text">生视频</text>
        </view>
        <view class="batch-btn danger" @click="batchTrash">
          <text class="batch-btn-text">移入回收站</text>
        </view>
      </view>
    </view>

    <!-- 全局后台 AI 任务状态浮窗 -->
    <ai-task-pill />
  </view>
</template>

<script>
import {
  fetchAssets,
  fetchMe,
  sessionValid,
  mediaUrl,
  gridUrl,
  videoUrl,
  posterUrl,
  deleteAsset,
  setAssetFavorite,
  moveAssetShelf,
  fetchMenuTree,
  fetchTrashAssets,
  restoreTrashAsset,
  purgeTrashAsset,
} from '../../service/ViewerApi'
import { switchTabTo } from '../../common/nav'
import { openClip } from '../../common/clip'
import { store } from '../../service/SyncStateStore'
import { viewerCache } from '../../service/ViewerCache'
import { localMediaIndex } from '../../service/LocalMediaIndex'
import { prefetch } from '../../service/Prefetch'
import AiTaskPill from '../../components/AiTaskPill.vue'
import AppIcon from '../../components/AppIcon.vue'
import { currentVars } from '../../common/theme'

function goLogin(tip) {
  uni.reLaunch({
    url: '/pages/login/login?tip=' + encodeURIComponent(tip || '请先登录服务器'),
  })
}

export default {
  components: {
    AiTaskPill,
    AppIcon,
  },
  data() {
    return {
      statusBarHeight: 20,
      gridH: 500,
      activeMediaTab: 'image', // image | video | audio | trash
      activeSection: 'interior_exterior',
      mainMediaTabs: [
        { key: 'image', label: '图片', iconName: 'image', sections: [
          { key: 'interior_exterior', label: '室内外设计', iconName: 'architecture', desc: '空间 / 建筑效果图' },
          { key: 'portrait', label: '空间人像', iconName: 'portrait', desc: '人物与场景合成' },
          { key: 'clothing', label: '服装服饰', iconName: 'clothing', desc: '穿搭 / 单品服饰' },
          { key: 'furniture', label: '单品家具', iconName: 'furniture', desc: '家具白底 / 细节' },
        ] },
        { key: 'video', label: '视频', iconName: 'video', sections: [
          { key: 'all', label: '全部视频', iconName: 'video', desc: '所有视频素材' },
          { key: 'walkthrough', label: '空间漫游', iconName: 'video', desc: '空间穿梭运镜' },
          { key: 'product', label: '单品展示', iconName: 'image', desc: '产品环绕展示' },
          { key: 'detail', label: '细节特写', iconName: 'search', desc: '材质与工艺特写' },
          { key: 'ad', label: '商业短片', iconName: 'video', desc: '品牌广告成片' },
          { key: 'portrait', label: '人像动态', iconName: 'portrait', desc: '人物动态表演' },
        ] },
        { key: 'audio', label: '音频', iconName: 'audio', sections: [
          { key: 'bgm', label: '背景音乐', iconName: 'audio', desc: '氛围 / 空间配乐' },
          { key: 'vocal', label: '人声参考', iconName: 'audio', desc: '旁白 / 人声素材' },
        ] },
        { key: 'favorite', label: '收藏', iconName: 'star', sections: [] },
      ],
      filterSheetOpen: false,
      filterDrawerOpen: false,
      showMediaTypeMenu: false,
      selectedSubCategory: '',
      menuTree: [],
      mediaTypeList: [
        { key: 'image', label: '图片素材', icon: '🖼️' },
        { key: 'video', label: '空间视频', icon: '🎬' },
        { key: 'furniture', label: '单品家具', icon: '🛋️' },
        { key: 'music', label: '场景音乐', icon: '🎵' },
        { key: 'portrait', label: '空间人像', icon: '👤' },
        { key: 'trash', label: '回收站', icon: '🗑️' },
      ],
      isSelectMode: false,
      selectedFids: [],
      keyword: '',
      sortLatest: true,
      // '' | retouched | finished（服务端 library_shelf 阶段）；只看收藏叠加在当前类型上
      shelfFilter: '',
      onlyFavorite: false,

      // 回收站
      trashCount: 0,
      trashSource: '',
      trashSourceFilters: [
        { key: '', label: '全部', icon: '🗂', desc: '保留期内全部记录' },
        { key: 'user_delete', label: '主动删除', icon: '👤', desc: '手动移入回收站' },
        { key: 'dedupe', label: '查重命中', icon: '🧬', desc: '重复素材清理' },
        { key: 'gate_reject', label: 'AI 判定', icon: '🤖', desc: '质检未通过' },
        { key: 'gateway_reject', label: '网关拒收', icon: '⛔', desc: '上传网关拒收' },
        { key: 'album_removed', label: '相册已删除', icon: '📱', desc: '手机相册侧删除' },
      ],

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
      totalCount: 0,
      errorText: '',
      page: 1,
      userLabel: '',
      refreshing: false,
      gridScrollTop: 0,
      gridTop: 0,
      groupOffsets: [],
      bubbleLabel: '',
    }
  },
  watch: {
    groups() {
      this.$nextTick(() => this.measureGroupOffsets())
    },
  },
  computed: {
    themeStyle() {
      return currentVars()
    },
    isConnectError() {
      return /无法连接|连接超时|网络错误|HTTP 明文|响应异常/.test(this.errorText || '')
    },
    currentMediaTabInfo() {
      return this.mainMediaTabs.find((m) => m.key === this.activeMediaTab) || {
        key: 'image', label: '图片', icon: '🖼', sections: [],
      }
    },
    currentSections() {
      return (this.currentMediaTabInfo.sections || [])
    },
    currentSectionInfo() {
      if (this.activeMediaTab === 'trash') {
        return this.trashSourceFilters.find((s) => s.key === this.trashSource) || this.trashSourceFilters[0]
      }
      const list = this.currentSections
      return list.find((s) => s.key === this.activeSection) || list[0] || { key: '', label: this.currentMediaTabInfo.label, desc: '' }
    },
    totalCountLabel() {
      if (!this.loaded) return '加载中'
      return this.totalCount > this.all.length ? `${this.all.length} / ${this.totalCount} 项` : `${this.all.length} 项`
    },
    searchPlaceholder() {
      if (this.activeMediaTab === 'trash') return '搜索回收站素材、删除原因…'
      if (this.activeMediaTab === 'favorite') return '搜索收藏素材、名称、标签…'
      if (this.activeMediaTab === 'video') return '搜索视频名称、来源、标签…'
      if (this.activeMediaTab === 'audio') return '搜索配乐、情绪、场景…'
      const sec = this.activeSection
      if (sec === 'portrait') return '搜索人像、姿态、角色…'
      if (sec === 'clothing') return '搜索服装品类、风格…'
      if (sec === 'furniture') return '搜索家具单品、材质、风格…'
      return '搜索空间、风格、材质…'
    },
    filterGroups() {
      const mk = (dim, title) => ({
        dim,
        title,
        options: (this.getOptionsByDim(dim) || []).filter((o) => (o.key || o) !== ''),
      })
      const list = []
      if (this.activeMediaTab === 'video') {
        list.push(mk('videoSource', '视频来源'))
        list.push(mk('orientation', '画幅'))
      } else if (this.activeMediaTab === 'audio') {
        list.push(mk('mood', '情绪氛围'))
        list.push(mk('space', '场景空间'))
      } else {
        const sec = this.activeSection
        if (sec === 'furniture') list.push(mk('furniture', '家具品类'))
        else if (sec === 'portrait') {
          list.push(mk('pose', '姿态动作'))
          list.push(mk('character', '人物角色'))
        } else if (sec === 'clothing') list.push(mk('style', '穿搭风格'))
        else list.push(mk('space', '空间场景'))
        if (sec !== 'clothing') list.push(mk('style', '设计风格'))
        if (sec !== 'portrait' && sec !== 'clothing') list.push(mk('material', '材质'))
        list.push(mk('color', '主色'))
        list.push(mk('orientation', '画幅'))
      }
      return list.filter((g) => Array.isArray(g.options) && g.options.length)
    },
    quickFilterGroups() {
      const groups = this.filterGroups
      return this.activeMediaTab === 'video' ? groups.slice(0, 1) : groups.slice(0, 2)
    },
    activeFilterCount() {
      let n = 0
      for (const g of this.filterGroups) n += this.selectedCountOf(g.dim)
      return n
    },
    activeFilterChips() {
      const chips = []
      for (const g of this.filterGroups) {
        const list = this.getSelectedListByDim(g.dim) || []
        for (const val of list) {
          const found = g.options.find((o) => (o.key || o) === val)
          chips.push({ dim: g.dim, key: val, title: g.title, label: (found && (found.label || found.key)) || val })
        }
      }
      return chips
    },
    currentSubCategories() {
      return []
    },
    subCategoryLabel() {
      return ''
    },
    totalSelectedCount() {
      return this.activeFilterCount
    },
    selectedAssetsList() {
      if (!this.selectedFids.length) return []
      const set = new Set(this.selectedFids)
      return this.all.filter((a) => set.has(a.fid))
    },
    groups() {
      const filtered = this.all.filter((a) => {
        // 一级媒体类型兜底
        if (this.activeMediaTab === 'image') {
          if (a.isVideo || a.isMusic) return false
        } else if (this.activeMediaTab === 'video') {
          if (!a.isVideo) return false
        } else if (this.activeMediaTab === 'audio') {
          if (!a.isMusic) return false
        } else if (this.activeMediaTab === 'trash') {
          if (!a.is_trashed) return false
        } else if (this.activeMediaTab === 'favorite') {
          if (!a.favoritedAt) return false
        }

        // 视频模式下区分实拍与AI创作
        if (this.activeMediaTab === 'video' && this.selectedVideoSources.length > 0) {
          const matchSync = this.selectedVideoSources.includes('sync') && !a.isAiVideo
          const matchAi = this.selectedVideoSources.includes('ai') && a.isAiVideo
          if (!matchSync && !matchAi) return false
        }

        // 本地关键词检索兜底
        if (this.keyword && this.keyword.trim()) {
          const kw = this.keyword.trim().toLowerCase()
          const text = ((a.fileName || '') + ' ' + (a.tagsText || '') + ' ' + (a.mainLabel || '')).toLowerCase()
          if (!text.includes(kw)) return false
        }
        return true
      })

      const map = new Map()
      for (const a of filtered) {
        const k = this.dateKey(a.createdAt)
        if (!map.has(k)) map.set(k, { key: k, label: this.dateLabel(a.createdAt), items: [] })
        map.get(k).items.push(a)
      }
      // 真瀑布流：按预估高度把每条记录放进较矮的一列，保持列内时间顺序
      const result = Array.from(map.values())
      for (const g of result) {
        const cols = [{ id: 'l', h: 0, items: [] }, { id: 'r', h: 0, items: [] }]
        for (const it of g.items) {
          const target = cols[0].h <= cols[1].h ? cols[0] : cols[1]
          target.items.push(it)
          target.h += (Number(it.ratio) || 100) + 22
        }
        g.columns = cols
      }
      return result
    },
    visibleItems() {
      return this.groups.reduce((acc, g) => acc.concat(g.items), [])
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
    this.refreshTrashCount()
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
    // 详情页「去回收站」入口
    try {
      const wantedTab = uni.getStorageSync('browse_tab')
      if (wantedTab === 'trash') {
        uni.removeStorageSync('browse_tab')
        if (this.activeMediaTab !== 'trash') {
          this.switchMediaTab('trash')
        }
      }
    } catch (e) {}
    // 回收站可能在详情页被恢复/粉碎，回到列表时刷新计数与内容
    this.refreshTrashCount()
    if (this.activeMediaTab === 'trash' && this.loaded) {
      this.reload({ force: true })
    } else if (!this.loaded && !this.loading) {
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
    if (this._bubbleTimer) {
      clearTimeout(this._bubbleTimer)
      this._bubbleTimer = null
    }
  },
  // 返回键先关最上层弹层，避免直接退出页面
  onBackPress() {
    if (this.showMediaTypeMenu) {
      this.showMediaTypeMenu = false
      return true
    }
    if (this.filterDrawerOpen) {
      this.closeFilterDrawer()
      return true
    }
    if (this.filterSheetOpen) {
      this.filterSheetOpen = false
      return true
    }
    if (this.isSelectMode) {
      this.toggleSelectMode()
      return true
    }
    return false
  },
  methods: {
    onGridScroll(e) {
      this.gridScrollTop = (e && e.detail && e.detail.scrollTop) || 0
      if (this._bubbleTimer) return
      this._bubbleTimer = setTimeout(() => {
        this._bubbleTimer = null
        this.updateBubble()
      }, 80)
    },
    updateBubble() {
      const st = this.gridScrollTop
      let label = ''
      for (const o of this.groupOffsets) {
        if (o.top <= st + 8) label = o.label
        else break
      }
      this.bubbleLabel = st > 80 ? label : ''
    },
    measureGroupOffsets() {
      try {
        const q = uni.createSelectorQuery().in(this)
        q.select('.grid-scroll').boundingClientRect()
        q.selectAll('.date-group').boundingClientRect()
        q.exec((res) => {
          const box = res && res[0]
          const rects = (res && res[1]) || []
          if (!box || !rects.length) {
            this.groupOffsets = []
            return
          }
          this.gridTop = box.top
          this.groupOffsets = rects.map((r, i) => ({
            top: Math.max(0, r.top - box.top + this.gridScrollTop),
            label: (this.groups[i] && this.groups[i].label) || '',
          }))
          this.updateBubble()
        })
      } catch (e) {
        this.groupOffsets = []
      }
    },
    onCardLongPress(item) {
      if (!item || !item.fid) return
      if (this.activeMediaTab === 'trash') {
        const canRestore = !item.fileMissing
        const list = canRestore
          ? ['恢复此素材', '彻底粉碎（不可恢复）', '取消']
          : ['彻底粉碎（不可恢复）', '取消']
        uni.showActionSheet({
          itemList: list,
          success: (res) => {
            const idx = res.tapIndex
            if (canRestore && idx === 0) this.confirmRestore([item.fid], [item])
            if ((canRestore && idx === 1) || (!canRestore && idx === 0)) this.confirmPurge([item.fid], [item])
          },
        })
        return
      }
      uni.showActionSheet({
        itemList: ['移动素材架…', '移入回收站', '取消'],
        success: (res) => {
          if (res.tapIndex === 0) this.openShelfMenu([item])
          if (res.tapIndex === 1) this.confirmDeleteAsset(item)
        },
      })
    },
    openShelfMenu(items) {
      const list = (Array.isArray(items) ? items : [items]).filter((x) => x && x.fid)
      if (!list.length) return
      const options = [
        { shelf: 'original', label: '原素材' },
        { shelf: 'retouched', label: '精修素材' },
        { shelf: 'finished', label: '成品素材' },
      ]
      const current = list.length === 1 ? list[0].libraryShelf : ''
      uni.showActionSheet({
        itemList: options.map((o) => (o.shelf === current ? `✓ ${o.label}` : o.label)),
        success: async (res) => {
          const target = options[res.tapIndex]
          if (!target) return
          uni.showLoading({ title: '移动中…', mask: true })
          try {
            await moveAssetShelf('', target.shelf, list.map((x) => x.fid))
            for (const it of list) it.libraryShelf = target.shelf
            if (this.shelfFilter && this.shelfFilter !== target.shelf) {
              const moved = new Set(list.map((x) => x.fid))
              this.all = this.all.filter((a) => !moved.has(a.fid))
            }
            this.selectedFids = []
            this.isSelectMode = false
            uni.showToast({ title: `已移至${target.label}`, icon: 'none' })
          } catch (e) {
            uni.showToast({ title: (e && e.message) || '移动失败', icon: 'none' })
          } finally {
            uni.hideLoading()
          }
        },
      })
    },
    confirmDeleteAsset(item) {
      uni.showModal({
        title: '移入回收站',
        content: `「${item.fileName || item.fid}」将移入回收站，可在保留期内恢复；同步时也不会重复入库。`,
        confirmText: '移入',
        confirmColor: '#3B82F6',
        success: async (res) => {
          if (!res.confirm) return
          uni.showLoading({ title: '移入中…', mask: true })
          try {
            await deleteAsset(item.fid)
            this.all = this.all.filter((x) => x.fid !== item.fid)
            this.selectedFids = this.selectedFids.filter((fid) => fid !== item.fid)
            try { viewerCache.clearAll?.() } catch (e) {}
            uni.showToast({ title: '已移入回收站', icon: 'none' })
            this.refreshTrashCount()
          } catch (e) {
            uni.showToast({ title: '操作失败: ' + (e.message || e), icon: 'none' })
          } finally {
            uni.hideLoading()
          }
        },
      })
    },
    refreshTrashCount() {
      fetchTrashAssets({ page: 1, pageSize: 1 })
        .then((data) => {
          this.trashCount = Number((data && data.total) || 0)
        })
        .catch(() => {})
    },
    setTrashSource(key) {
      this.trashSource = key || ''
      this.reload({ force: true })
    },
    switchSection(key) {
      if (this.activeSection === key) return
      this.activeSection = key
      this.resetAllFilters(false)
      this.filterSheetOpen = false
      this.reload({ force: true })
      this.measureGridHeight()
    },
    getSelectedListByDim(dim) {
      switch (dim) {
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
        default: return []
      }
    },
    getOptionsByDim(dim) {
      switch (dim) {
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
    isDimChecked(dim, key) {
      return (this.getSelectedListByDim(dim) || []).includes(key)
    },
    selectedCountOf(dim) {
      return (this.getSelectedListByDim(dim) || []).length
    },
    toggleDimOption(dim, key) {
      const list = this.getSelectedListByDim(dim)
      if (!list) return
      const idx = list.indexOf(key)
      if (idx > -1) list.splice(idx, 1)
      else list.push(key)
      if (this._filterTimer) clearTimeout(this._filterTimer)
      this._filterTimer = setTimeout(() => {
        this._filterTimer = null
        this.reload()
      }, 220)
    },
    clearDim(dim) {
      const list = this.getSelectedListByDim(dim)
      if (list) list.splice(0, list.length)
      this.reload()
    },
    openFilterDrawer() {
      this.filterDrawerOpen = true
      try { uni.hideTabBar({ animation: true }) } catch (e) {}
    },
    closeFilterDrawer() {
      this.filterDrawerOpen = false
      try { uni.showTabBar({ animation: true }) } catch (e) {}
      this.reload()
    },
    sectionIconName(key) {
      switch (key) {
        case 'interior_exterior': return 'architecture'
        case 'portrait': return 'portrait'
        case 'clothing': return 'clothing'
        case 'furniture': return 'furniture'
        case 'walkthrough': return 'video'
        case 'product': return 'image'
        case 'detail': return 'search'
        case 'ad': return 'video'
        case 'bgm': return 'audio'
        case 'vocal': return 'audio'
        default: return 'grid'
      }
    },
    openFilterSheet() {
      this.filterSheetOpen = true
    },
    closeFilterSheet() {
      this.filterSheetOpen = false
      this.reload()
    },
    measureGridHeight() {
      const sys = uni.getSystemInfoSync()
      const winH = sys.windowHeight || 800
      const query = uni.createSelectorQuery().in(this)
      query.select('.header-container').boundingClientRect((data) => {
        if (data && data.bottom) {
          this.gridH = Math.max(300, winH - data.bottom)
        } else {
          this.gridH = Math.max(300, winH - 130)
        }
      }).exec()
    },
    onScrollToLower() {
      if (this.loading || this.loadingMore || this.finished) return
      if (this._scrollTimer) clearTimeout(this._scrollTimer)
      this._scrollTimer = setTimeout(() => {
        this.loadMore()
      }, 150)
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
          this.mediaTypeList = this.ensureTrashTab(list.map(item => ({
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
          })))

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
    ensureTrashTab(list) {
      const arr = Array.isArray(list) ? list.slice() : []
      if (!arr.some((x) => x.key === 'trash')) {
        arr.push({ key: 'trash', label: '回收站', icon: '🗑️', children: [], facets: [] })
      }
      return arr
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
      this.activeSection = tab === 'image' ? 'interior_exterior' : (tab === 'video' ? 'all' : (tab === 'audio' ? 'bgm' : ''))
      this.filterSheetOpen = false
      this.trashSource = ''
      this.shelfFilter = ''
      this.onlyFavorite = false
      this.isSelectMode = false
      this.selectedFids = []
      this.all = []
      this.totalCount = 0
      this.loading = true
      this.loaded = false
      this.resetAllFilters(false)
      this.reload({ force: true })
      this.$nextTick(() => this.measureGridHeight())
    },
    toggleSort() {
      this.sortLatest = !this.sortLatest
      this.reload()
    },
    setShelf(value) {
      if (value === '') {
        if (this.shelfFilter === '' && !this.onlyFavorite) return
        this.shelfFilter = ''
        this.onlyFavorite = false
        this.reload()
        return
      }
      const next = this.shelfFilter === value ? '' : value
      if (next === this.shelfFilter) return
      this.shelfFilter = next
      this.reload()
    },
    toggleOnlyFavorite() {
      this.onlyFavorite = !this.onlyFavorite
      this.reload()
    },
    async toggleFavorite(item) {
      if (!item || !item.fid || this._favBusy) return
      this._favBusy = true
      const next = !item.favoritedAt
      item.favoritedAt = next ? Date.now() : 0
      try {
        const res = await setAssetFavorite(item.fid, next)
        item.favoritedAt = res.favoritedAt || (next ? item.favoritedAt : 0)
        if (!next && (this.activeMediaTab === 'favorite' || this.onlyFavorite)) {
          this.all = this.all.filter((a) => a.fid !== item.fid)
          this.totalCount = Math.max(0, this.totalCount - 1)
        }
        uni.showToast({ title: next ? '已收藏' : '已取消收藏', icon: 'none' })
      } catch (e) {
        item.favoritedAt = next ? 0 : item.favoritedAt || Date.now()
        uni.showToast({ title: (e && e.message) || '操作失败', icon: 'none' })
      } finally {
        this._favBusy = false
      }
    },
    selectAllVisible() {
      this.selectedFids = this.visibleItems.map((a) => a.fid)
    },
    invertSelection() {
      const picked = new Set(this.selectedFids)
      this.selectedFids = this.visibleItems.filter((a) => !picked.has(a.fid)).map((a) => a.fid)
    },
    async reload(options = {}) {
      if (!sessionValid()) {
        this.redirectLogin('登录已过期，请重新登录')
        return
      }
      const forceRefresh = options && options.force === true
      if (this.activeMediaTab === 'trash') {
        this.errorText = ''
        this.page = 1
        this.loading = true
        try {
          const data = await fetchTrashAssets({
            page: 1,
            pageSize: 30,
            source: this.trashSource,
            sort: this.sortLatest ? 'latest' : 'oldest',
            keyword: this.keyword,
          })
          this.all = (data.items || []).map((r) => this.mapTrash(r))
          this.finished = this.all.length >= (Number(data.total) || 0)
          this.totalCount = Number(data.total) || 0
          this.trashCount = this.totalCount
        } catch (e) {
          const msg = e.message || '加载失败'
          if (/会话已过期|未登录|401/.test(msg)) {
            store.clearSession()
            this.redirectLogin(msg)
            return
          }
          this.errorText = msg
          this.all = []
        } finally {
          this.loading = false
          this.loaded = true
        }
        return
      }
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
        mediaType: this.activeMediaTab === 'audio' ? 'music' : this.activeMediaTab,
        lane: ['image', 'video', 'audio'].includes(this.activeMediaTab) ? this.activeMediaTab : '',
        section: this.activeSection,
        shelf: this.shelfFilter,
        onlyFavorite: this.onlyFavorite,
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
        this.totalCount = Number(data.total) || 0
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
        this.totalCount = Number(data.total) || 0
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
    mapTrash(r) {
      const isVid = r.kind === 'video' || this.isVideo(r.fileName)
      const isMus = r.kind === 'audio' || this.isAudio(r.fileName)
      const w = r.width || 1080
      const h = r.height || 1440
      let ratio = isMus ? 62 : (h / w) * 100
      if (ratio < 75) ratio = 75
      if (ratio > 135) ratio = 135
      const serverUrl = mediaUrl(r.fid)
      const gridImgUrl = isVid ? '' : gridUrl(r.fid)
      const imgUrl = isVid ? posterUrl(r.fid) : gridImgUrl
      return {
        fid: r.fid,
        fileName: r.fileName || r.fid,
        width: w,
        height: h,
        mediaType: isVid ? 'video' : (isMus ? 'music' : 'image'),
        isVideo: isVid,
        isMusic: isMus,
        isPortrait: false,
        isFurniture: false,
        is_trashed: true,
        truncated: false,
        duration: 0,
        createdAt: r.deletedAt || 0,
        tagsText: r.tagsText || '',
        rawTags: '',
        mainLabel: '',
        ratio,
        imgUrl,
        serverUrl,
        gridImgUrl,
        prefetchPath: '',
        localPath: '',
        posterUrl: isVid ? imgUrl : '',
        thumbUrl: r.thumbUrl || '',
        imgFailed: false,
        server: true,
        disposeSource: r.disposeSource || '',
        disposeLabel: r.disposeLabel || '主动删除',
        disposeCriterion: r.disposeCriterion || '',
        disposeDetail: r.disposeDetail || '',
        deletedDerivCount: r.deletedDerivCount || 0,
        expiresAt: r.expiresAt || 0,
        remainingHours: r.remainingHours || 0,
        expiringSoon: !!r.expiringSoon,
        fileMissing: !!r.fileMissing,
        restoreReady: r.restoreReady !== false && !r.fileMissing,
        size: r.size || 0,
      }
    },
    formatRemain(hours) {
      const h = Number(hours) || 0
      if (h <= 0) return '即将清理'
      if (h < 24) return `剩 ${h} 小时`
      return `剩 ${Math.ceil(h / 24)} 天`
    },
    async loadMore() {
      if (this.loading || this.loadingMore || this.finished) return
      this.loadingMore = true
      const nextPage = this.page + 1
      if (this.activeMediaTab === 'trash') {
        try {
          const data = await fetchTrashAssets({
            page: nextPage,
            pageSize: 30,
            source: this.trashSource,
            sort: this.sortLatest ? 'latest' : 'oldest',
            keyword: this.keyword,
          })
          const newItems = (data.items || []).map((r) => this.mapTrash(r))
          if (newItems.length > 0) {
            const existingFids = new Set(this.all.map((a) => a.fid))
            for (const it of newItems) {
              if (!existingFids.has(it.fid)) {
                this.all.push(it)
                existingFids.add(it.fid)
              }
            }
            this.page = nextPage
            this.finished = this.all.length >= (Number(data.total) || 0) || newItems.length === 0
          } else {
            this.finished = true
          }
        } catch (e) {
          console.warn('[browse] loadMore trash failed', e)
        } finally {
          this.loadingMore = false
        }
        return
      }
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
        mediaType: this.activeMediaTab === 'audio' ? 'music' : this.activeMediaTab,
        lane: ['image', 'video', 'audio'].includes(this.activeMediaTab) ? this.activeMediaTab : '',
        section: this.activeSection,
        shelf: this.shelfFilter,
        onlyFavorite: this.onlyFavorite,
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
      // 相邻素材上下文：详情页左右滑动按当前筛选结果切换
      try {
        const fids = this.visibleItems.map((a) => a.fid)
        const idx = fids.indexOf(item.fid)
        uni.setStorageSync('detail_nav_fids', fids.slice(0, 300))
        uni.setStorageSync('detail_nav_index', idx >= 0 ? idx : 0)
      } catch (e) {}
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
        url: '/pages/detail/detail?fid=' + encodeURIComponent(item.fid)
          + '&tab=' + encodeURIComponent(defaultTab)
          + (item.mainDerivativeId ? '&derivId=' + encodeURIComponent(item.mainDerivativeId) : ''),
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
      if (this.isSelectMode && (this.activeMediaTab === 'trash' || (!item.isVideo && !item.isMusic))) {
        this.toggleSelect(item)
        return
      }
      if (this.activeMediaTab === 'trash') {
        this.openTrashDetail(item)
        return
      }
      this.openDetail(item)
    },
    openTrashDetail(item) {
      if (this._navigating) return
      this._navigating = true
      uni.navigateTo({
        url: '/pages/trash-detail/trash-detail?fid=' + encodeURIComponent(item.fid),
        complete: () => {
          setTimeout(() => {
            this._navigating = false
          }, 500)
        },
      })
    },
    batchCreate(domain) {
      if (!this.selectedFids.length) return
      const fids = this.selectedFids.slice(0, 8)
      this.isSelectMode = false
      this.selectedFids = []
      switchTabTo('/pages/home/home', { fids, domain: domain === 'video' ? 'video' : 'image' })
    },
    batchClip() {
      const items = this.selectedAssetsList.slice(0, 20)
      if (!items.length) return
      this.isSelectMode = false
      this.selectedFids = []
      openClip(items)
    },
    batchTrash() {
      const fids = this.selectedFids.slice()
      if (!fids.length) return
      uni.showModal({
        title: '移入回收站',
        content: `将选中的 ${fids.length} 个素材移入回收站，可在保留期内恢复。`,
        confirmText: '移入',
        confirmColor: '#3B82F6',
        success: async (res) => {
          if (!res.confirm) return
          uni.showLoading({ title: '移入中…', mask: true })
          try {
            for (const fid of fids) {
              await deleteAsset(fid)
            }
            const set = new Set(fids)
            this.all = this.all.filter((x) => !set.has(x.fid))
            this.selectedFids = []
            this.isSelectMode = false
            try { viewerCache.clearAll?.() } catch (e) {}
            uni.showToast({ title: `已移入 ${fids.length} 个`, icon: 'none' })
            this.refreshTrashCount()
          } catch (e) {
            uni.showToast({ title: '操作失败: ' + (e.message || e), icon: 'none' })
          } finally {
            uni.hideLoading()
          }
        },
      })
    },
    confirmRestore(fids, items) {
      const list = Array.isArray(items) ? items : []
      const missing = new Set(list.filter((it) => it && (it.fileMissing || it.restoreReady === false)).map((it) => it.fid))
      const okFids = (fids || []).filter((fid) => !missing.has(fid))
      if (!okFids.length) {
        uni.showToast({ title: '所选记录源文件已清理，无法恢复', icon: 'none' })
        return
      }
      const skipped = (fids || []).length - okFids.length
      uni.showModal({
        title: '恢复素材',
        content: skipped > 0
          ? `将恢复 ${okFids.length} 个素材；另有 ${skipped} 个源文件已清理，只能保留记录。`
          : `将 ${okFids.length} 个素材恢复到素材库。`,
        confirmText: '恢复',
        confirmColor: '#3B82F6',
        success: async (res) => {
          if (!res.confirm) return
          uni.showLoading({ title: '恢复中…', mask: true })
          try {
            const out = await restoreTrashAsset(okFids)
            const done = new Set(out.restored || [])
            const failed = out.failed || []
            this.all = this.all.filter((x) => !done.has(x.fid))
            this.selectedFids = this.selectedFids.filter((fid) => !done.has(fid))
            try { viewerCache.clearAll?.() } catch (e) {}
            uni.showToast({ title: failed.length ? `已恢复 ${done.size} 个，${failed.length} 个失败` : `已恢复 ${done.size} 个`, icon: 'none' })
            this.refreshTrashCount()
          } catch (e) {
            uni.showToast({ title: '恢复失败: ' + (e.message || e), icon: 'none' })
          } finally {
            uni.hideLoading()
          }
        },
      })
    },
    confirmPurge(fids) {
      uni.showModal({
        title: '彻底粉碎',
        content: `将永久删除 ${fids.length} 个素材，此操作不可恢复。`,
        confirmText: '粉碎',
        confirmColor: '#F43F5E',
        success: async (res) => {
          if (!res.confirm) return
          uni.showLoading({ title: '粉碎中…', mask: true })
          try {
            const out = await purgeTrashAsset(fids)
            const done = new Set(out.purged || [])
            const failed = out.failed || []
            this.all = this.all.filter((x) => !done.has(x.fid))
            this.selectedFids = this.selectedFids.filter((fid) => !done.has(fid))
            uni.showToast({ title: failed.length ? `已粉碎 ${done.size} 个，${failed.length} 个失败` : `已粉碎 ${done.size} 个`, icon: 'none' })
            this.refreshTrashCount()
          } catch (e) {
            uni.showToast({ title: '粉碎失败: ' + (e.message || e), icon: 'none' })
          } finally {
            uni.hideLoading()
          }
        },
      })
    },
    batchRestore() {
      if (!this.selectedFids.length) return
      this.confirmRestore(this.selectedFids.slice(), this.selectedAssetsList)
    },
    batchPurge() {
      if (!this.selectedFids.length) return
      this.confirmPurge(this.selectedFids.slice())
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
.popover-item-badge {
  min-width: 34rpx;
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  background: #ef4444;
  color: #ffffff;
  font-size: 18rpx;
  font-weight: 700;
  text-align: center;
  line-height: 30rpx;
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
.waterfall {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 16rpx;
  box-sizing: border-box;
}
.wf-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.card {
  width: 100%;
  margin-right: 0;
  margin-bottom: 16rpx;
  border-radius: var(--cardr, 24rpx);
  overflow: hidden;
  background: var(--surface, #fff);
  border: 1rpx solid #e2e8f0;
  box-sizing: border-box;
  box-shadow: 0 4rpx 12rpx rgba(15, 23, 42, 0.04);
  transition: transform var(--ms, 220ms) var(--ease-out, cubic-bezier(.23,1,.32,1)),
    box-shadow var(--ms, 220ms) var(--ease-out, cubic-bezier(.23,1,.32,1));
}
.card.selected {
  border: 2rpx solid var(--accent, #2563eb);
  box-shadow: 0 4rpx 18rpx rgba(37, 99, 235, 0.2);
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
.badge.trash-badge {
  background: rgba(244, 63, 94, 0.9);
  max-width: 60%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge.trash-badge.soon {
  background: rgba(185, 28, 28, 0.95);
}
.badge.trash-badge.missing {
  background: rgba(100, 116, 139, 0.92);
}
.badge.trash-remain {
  left: auto;
  right: 14rpx;
  background: rgba(15, 23, 42, 0.82);
}
.badge.trash-remain.soon {
  background: rgba(217, 119, 6, 0.95);
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
  flex-shrink: 0;
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
.batch-actions {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  justify-content: flex-end;
  scrollbar-width: none;
}
.batch-actions::-webkit-scrollbar {
  display: none;
}
.batch-actions > view {
  flex-shrink: 0;
}
.batch-btn {
  background: linear-gradient(135deg, #2563eb, #6366f1);
  padding: 14rpx 22rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 14rpx rgba(37, 99, 235, 0.4);
}
.batch-btn.ghost {
  background: rgba(59, 130, 246, 0.16);
  border: 1rpx solid rgba(147, 197, 253, 0.5);
  box-shadow: none;
}
.batch-btn.danger {
  background: linear-gradient(135deg, #f43f5e, #e11d48);
  box-shadow: 0 4rpx 14rpx rgba(244, 63, 94, 0.35);
}
.batch-btn-text {
  color: #ffffff;
  font-size: 22rpx;
  font-weight: 700;
  white-space: nowrap;
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
/* 素材架角标：避开左上角来源/品类角标，贴在信息条上方 */
.badge.shelf-badge {
  top: auto;
  bottom: 88rpx;
  left: 14rpx;
  background: rgba(6, 182, 212, 0.92);
}
.badge.shelf-badge.finished {
  background: rgba(245, 158, 11, 0.94);
}

/* ========== 一级媒体 Tab ========== */
.nav-heading {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}
.nav-title {
  font-size: 34rpx;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.5rpx;
}
.nav-sub {
  font-size: 20rpx;
  color: #94a3b8;
  margin-top: 2rpx;
  max-width: 360rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.media-tabs {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 0 28rpx 12rpx;
  background: #f8fafc;
}
.media-tab {
  flex: 1;
  min-width: 0;
  height: 66rpx;
  border-radius: 18rpx;
  background: #ffffff;
  border: 1rpx solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  transition: all 0.18s ease;
}
.media-tab.active {
  background: #3b82f6;
  border-color: #3b82f6;
  box-shadow: 0 6rpx 18rpx rgba(59, 130, 246, 0.24);
}
.media-tab-icon {
  font-size: 26rpx;
}
.media-tab-label {
  font-size: 25rpx;
  font-weight: 700;
  color: #475569;
}
.media-tab.active .media-tab-label {
  color: #ffffff;
}
.media-tab.active .media-tab-icon {
  filter: saturate(1.1);
}
.media-tab.trash-tab {
  position: relative;
  flex: 0 0 auto;
  padding: 0 18rpx;
}
.media-tab-badge {
  position: absolute;
  top: -10rpx;
  right: -6rpx;
  min-width: 30rpx;
  height: 30rpx;
  line-height: 30rpx;
  padding: 0 7rpx;
  border-radius: 999rpx;
  background: #f43f5e;
  color: #ffffff;
  font-size: 17rpx;
  font-weight: 700;
  text-align: center;
  box-shadow: 0 3rpx 8rpx rgba(244, 63, 94, 0.35);
}

/* ========== 二级板块 ========== */
.section-rail-wrap {
  background: #f8fafc;
  padding-bottom: 10rpx;
}
.section-rail {
  width: 100%;
  white-space: nowrap;
}
.section-rail-inner {
  display: inline-flex;
  gap: 14rpx;
  padding: 2rpx 28rpx 4rpx;
}
.section-card {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 22rpx 14rpx 16rpx;
  border-radius: 20rpx;
  background: #ffffff;
  border: 1rpx solid #e6ebf2;
  box-shadow: 0 3rpx 10rpx rgba(15, 23, 42, 0.03);
  transition: all 0.18s ease;
}
.section-card.active {
  background: linear-gradient(135deg, #eff6ff, #dbeafe);
  border-color: #93c5fd;
  box-shadow: 0 6rpx 16rpx rgba(59, 130, 246, 0.14);
}
.section-icon {
  width: 52rpx;
  height: 52rpx;
  border-radius: 14rpx;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  text-align: center;
  line-height: 52rpx;
}
.section-card.active .section-icon {
  background: #ffffff;
}
.section-meta {
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}
.section-label {
  font-size: 24rpx;
  font-weight: 700;
  color: #0f172a;
}
.section-card.active .section-label {
  color: #1d4ed8;
}
.section-desc {
  font-size: 18rpx;
  color: #94a3b8;
  white-space: nowrap;
}
.section-card.trash-source-card {
  padding-right: 20rpx;
}

/* ========== 快捷筛选 ========== */
.quick-filter-wrap {
  background: #f8fafc;
  padding-bottom: 8rpx;
}
.quick-filter-scroll {
  width: 100%;
  white-space: nowrap;
}
.quick-filter-inner {
  display: inline-flex;
  align-items: center;
  gap: 18rpx;
  padding: 0 28rpx;
}
.quick-group {
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
}
.quick-title {
  font-size: 20rpx;
  font-weight: 700;
  color: #64748b;
  padding-right: 2rpx;
}
.quick-options {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
}
.quick-chip {
  height: 50rpx;
  padding: 0 16rpx;
  border-radius: 999rpx;
  background: #ffffff;
  border: 1rpx solid #e2e8f0;
  display: inline-flex;
  align-items: center;
  gap: 6rpx;
  white-space: nowrap;
}
.quick-chip.checked {
  background: #eff6ff;
  border-color: #3b82f6;
}
.quick-chip-text {
  font-size: 21rpx;
  color: #475569;
}
.quick-chip.checked .quick-chip-text {
  color: #1d4ed8;
  font-weight: 600;
}
.filter-open-btn {
  flex: 0 0 auto;
  height: 54rpx;
  padding: 0 20rpx;
  border-radius: 999rpx;
  background: #0f172a;
  display: inline-flex;
  align-items: center;
  gap: 6rpx;
}
.filter-open-btn.active {
  background: #3b82f6;
}
.filter-open-icon {
  font-size: 22rpx;
  color: #ffffff;
}
.filter-open-text {
  font-size: 21rpx;
  font-weight: 700;
  color: #ffffff;
}

/* ========== 已选筛选 ========== */
.active-filter-row {
  background: #f8fafc;
  padding-bottom: 8rpx;
}
.active-filter-scroll {
  width: 100%;
  white-space: nowrap;
}
.active-filter-inner {
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
  padding: 0 28rpx;
}
.active-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6rpx;
  height: 46rpx;
  padding: 0 14rpx;
  border-radius: 999rpx;
  background: #eff6ff;
  border: 1rpx solid #bfdbfe;
}
.active-filter-text {
  font-size: 20rpx;
  color: #1d4ed8;
}
.active-filter-x {
  font-size: 18rpx;
  color: #64748b;
}
.active-filter-clear {
  font-size: 20rpx;
  font-weight: 700;
  color: #3b82f6;
  padding: 0 12rpx;
}

/* ========== 筛选抽屉 ========== */
.filter-sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  z-index: 900;
  display: flex;
  align-items: flex-end;
}
.filter-sheet {
  width: 100%;
  max-height: 76vh;
  background: #ffffff;
  border-radius: 28rpx 28rpx 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
}
.filter-sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 26rpx 28rpx 16rpx;
}
.filter-sheet-title {
  display: block;
  font-size: 30rpx;
  font-weight: 800;
  color: #0f172a;
}
.filter-sheet-sub {
  display: block;
  margin-top: 4rpx;
  font-size: 20rpx;
  color: #94a3b8;
}
.filter-sheet-close {
  font-size: 30rpx;
  color: #64748b;
  padding: 0 6rpx;
}
.filter-sheet-body {
  max-height: 54vh;
  padding: 0 28rpx 16rpx;
}
.filter-group {
  padding: 16rpx 0 6rpx;
  border-bottom: 1rpx solid #f1f5f9;
}
.filter-group:last-child {
  border-bottom: none;
}
.filter-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.filter-group-title {
  font-size: 23rpx;
  font-weight: 700;
  color: #0f172a;
}
.filter-group-reset {
  font-size: 20rpx;
  color: #3b82f6;
}
.filter-options-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}
.filter-option {
  padding: 10rpx 18rpx;
  border-radius: 12rpx;
  background: #f8fafc;
  border: 1rpx solid #e8edf4;
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.filter-option.checked {
  background: #eff6ff;
  border-color: #3b82f6;
}
.filter-option-text {
  font-size: 21rpx;
  color: #475569;
}
.filter-option.checked .filter-option-text {
  color: #1d4ed8;
  font-weight: 600;
}
.filter-empty {
  font-size: 20rpx;
  color: #cbd5e1;
}
.filter-sheet-foot {
  display: flex;
  gap: 14rpx;
  padding: 14rpx 28rpx 22rpx;
  border-top: 1rpx solid #f1f5f9;
}
.filter-foot-btn {
  flex: 1;
  height: 76rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 25rpx;
  font-weight: 700;
}
.filter-foot-btn.ghost {
  background: #f1f5f9;
  color: #475569;
}
.filter-foot-btn.primary {
  background: #3b82f6;
  color: #ffffff;
  box-shadow: 0 6rpx 18rpx rgba(59, 130, 246, 0.25);
}

/* ========== 回收站说明与缺失标记 ========== */
.trash-hint {
  margin: 0 28rpx 10rpx;
  padding: 14rpx 18rpx;
  border-radius: 16rpx;
  background: #fff7ed;
  border: 1rpx solid #fed7aa;
}
.trash-hint-text {
  font-size: 20rpx;
  color: #9a3412;
  line-height: 1.5;
}
.missing-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.62);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  z-index: 3;
}
.missing-title {
  font-size: 24rpx;
  font-weight: 800;
  color: #ffffff;
}
.missing-sub {
  font-size: 18rpx;
  color: #fecdd3;
}


/* ===== Apple HIG Refined Styles ===== */
.header-container {
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 0.5px solid rgba(60, 60, 67, 0.12);
  position: relative;
  z-index: 50;
}

.apple-nav {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  gap: 10px;
}

.nav-drawer-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  background: #F2F2F7;
  border-radius: 18px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}
.nav-drawer-btn:active {
  transform: scale(0.95);
  background: #E5E5EA;
}
.nav-drawer-btn.has-active {
  background: rgba(0, 122, 255, 0.12);
}
.nav-drawer-text {
  font-size: 13px;
  font-weight: 500;
  color: #1C1C1E;
}
.nav-drawer-btn.has-active .nav-drawer-text {
  color: #007AFF;
  font-weight: 600;
}
.drawer-badge {
  background: #007AFF;
  color: #FFFFFF;
  font-size: 10px;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  border-radius: 8px;
  padding: 0 4px;
}

/* Apple Segmented Control */
.apple-segmented {
  flex: 1;
  max-width: 250px;
  height: 34px;
  background: rgba(118, 118, 128, 0.12);
  border-radius: 9px;
  padding: 2px;
  display: flex;
  align-items: center;
}
.segmented-item {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 7px;
  cursor: pointer;
  position: relative;
  transition: all 0.22s cubic-bezier(0.32, 0.72, 0, 1);
}
.segmented-item.active {
  background: #FFFFFF;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12), 0 0 1px rgba(0, 0, 0, 0.08);
}
.segmented-label {
  font-size: 12px;
  font-weight: 500;
  color: #8E8E93;
}
.segmented-item.active .segmented-label {
  color: #1C1C1E;
  font-weight: 600;
}
.trash-badge-dot {
  position: absolute;
  top: 1px;
  right: 2px;
  background: #FF3B30;
  color: #FFFFFF;
  font-size: 9px;
  font-weight: 700;
  height: 14px;
  min-width: 14px;
  line-height: 14px;
  text-align: center;
  border-radius: 7px;
  padding: 0 3px;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.action-text-btn {
  font-size: 14px;
  color: #007AFF;
  font-weight: 500;
  padding: 4px 6px;
  cursor: pointer;
}
.action-text-btn.active {
  font-weight: 600;
}
.refresh-circle-btn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background: #F2F2F7;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s;
}
.refresh-circle-btn:active {
  transform: scale(0.92);
}

/* 二级板块极简滑动胶囊 */
.section-pill-bar {
  padding: 4px 14px 6px;
}
.section-pill-inner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.section-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  background: #F2F2F7;
  border-radius: 16px;
  transition: all 0.2s cubic-bezier(0.32, 0.72, 0, 1);
  cursor: pointer;
}
.section-pill:active {
  transform: scale(0.96);
}
.section-pill.active {
  background: #007AFF;
  box-shadow: 0 2px 8px rgba(0, 122, 255, 0.3);
}
.section-pill-text {
  font-size: 12px;
  font-weight: 500;
  color: #3A3A3C;
}
.section-pill.active .section-pill-text {
  color: #FFFFFF;
  font-weight: 600;
}

/* 紧凑搜索栏 + 排序 */
.search-sort-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 14px 8px;
}
.search-field {
  flex: 1;
  height: 34px;
  background: #EFEFF4;
  border-radius: 10px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 7px;
}
.search-input {
  flex: 1;
  font-size: 13px;
  color: #1C1C1E;
  height: 100%;
}
.search-clear-btn {
  width: 18px;
  height: 18px;
  border-radius: 9px;
  background: rgba(142, 142, 147, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.sort-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  height: 34px;
  background: #F2F2F7;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}
.sort-chip:active {
  transform: scale(0.95);
}
.sort-chip-text {
  font-size: 12px;
  font-weight: 500;
  color: #007AFF;
}

/* 生效筛选标签栏 */
.active-chips-bar {
  padding: 2px 14px 8px;
}
.active-chips-inner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.active-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 122, 255, 0.1);
  border: 0.5px solid rgba(0, 122, 255, 0.3);
  padding: 3px 8px;
  border-radius: 12px;
  cursor: pointer;
}
.active-chip-text {
  font-size: 11px;
  color: #007AFF;
  font-weight: 500;
}
.chips-clear-all {
  font-size: 11px;
  color: #8E8E93;
  padding: 3px 6px;
  cursor: pointer;
}

/* ===== 左侧筛选抽屉 (Left Drawer) ===== */
.drawer-mask {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 999;
  display: flex;
  justify-content: flex-start;
  animation: fadeIn 0.22s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.drawer-panel {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  width: 82vw;
  max-width: 360px;
  height: 100%;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  box-shadow: 8px 0 24px rgba(0, 0, 0, 0.15);
  animation: slideInLeft 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes slideInLeft {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

.drawer-head {
  padding: 44px 18px 14px;
  border-bottom: 0.5px solid rgba(60, 60, 67, 0.12);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #FAFAFA;
}
.drawer-main-title {
  font-size: 18px;
  font-weight: 700;
  color: #1C1C1E;
}
.drawer-sub-title {
  font-size: 12px;
  color: #8E8E93;
  margin-top: 2px;
  display: block;
}
.drawer-close-btn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background: #E5E5EA;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.drawer-close-btn:active {
  transform: scale(0.92);
}

.drawer-scroll-body {
  flex: 1;
  height: 0;
  min-height: 0;
  padding: 16px 18px;
}
.drawer-footer {
  flex-shrink: 0;
  padding: 12px 18px 24px;
  border-top: 0.5px solid rgba(60, 60, 67, 0.12);
  background: #FFFFFF;
  display: flex;
  gap: 12px;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.06);
}
.drawer-group {
  margin-bottom: 22px;
}
.drawer-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.drawer-group-title {
  font-size: 13px;
  font-weight: 600;
  color: #8E8E93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.drawer-group-clear {
  font-size: 12px;
  color: #007AFF;
  cursor: pointer;
}
.drawer-chips-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.drawer-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: #F2F2F7;
  border-radius: 16px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.32, 0.72, 0, 1);
}
.drawer-chip:active {
  transform: scale(0.96);
}
.drawer-chip.active {
  background: rgba(0, 122, 255, 0.1);
  border-color: #007AFF;
}
.drawer-chip-text {
  font-size: 13px;
  font-weight: 500;
  color: #1C1C1E;
  white-space: nowrap;
}
.drawer-chip.active .drawer-chip-text {
  color: #007AFF;
  font-weight: 600;
}
.drawer-chip-dot {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  box-shadow: 0 0 1px rgba(0, 0, 0, 0.2);
}
.drawer-empty-hint {
  font-size: 12px;
  color: #C7C7CC;
}

.drawer-footer {
  padding: 14px 18px 24px;
  border-top: 0.5px solid rgba(60, 60, 67, 0.12);
  background: #FFFFFF;
  display: flex;
  gap: 12px;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.04);
}
.drawer-btn {
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}
.drawer-btn:active {
  transform: scale(0.97);
}
.drawer-btn.reset {
  width: 35%;
  background: #F2F2F7;
}
.drawer-btn.confirm {
  flex: 1;
  background: #007AFF;
  box-shadow: 0 3px 12px rgba(0, 122, 255, 0.35);
}
.drawer-btn-text {
  font-size: 14px;
  font-weight: 600;
}
.reset-text {
  color: #636366;
}
.confirm-text {
  color: #FFFFFF;
}

/* 滚动日期气泡 */
.date-bubble {
  position: fixed;
  left: 16px;
  z-index: 30;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(30, 27, 22, 0.62);
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  pointer-events: none;
}

/* 快捷状态筛选 */
.quick-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px 8px;
  overflow-x: auto;
}
.qf-chip {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface2, #f2f2f7);
  border: 0.5px solid transparent;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink2, #636366);
}
.qf-chip.active {
  background: var(--accent-soft, #eff6ff);
  border-color: var(--accent-border, #bfd6ff);
  color: var(--accent, #007aff);
  font-weight: 600;
}
.qf-star {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.qf-star.active {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #ffffff;
}

/* 卡片快捷收藏 */
.fav-star {
  position: absolute;
  right: 8px;
  bottom: 34px;
  width: 26px;
  height: 26px;
  border-radius: 13px;
  background: rgba(15, 23, 42, 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  backdrop-filter: blur(6px);
}
.fav-star.on {
  background: rgba(255, 255, 255, 0.92);
}

/* ===== 主题令牌覆盖（warm/cool，由根节点 :style 注入 CSS 变量） ===== */
.page {
  background: var(--bg, #f8fafc);
  color: var(--ink, #0f172a);
}
.header-container {
  background: var(--glass-bg, rgba(255, 255, 255, 0.94));
  border-bottom-color: var(--line, rgba(60, 60, 67, 0.12));
}
.nav-drawer-btn,
.refresh-circle-btn,
.section-pill,
.sort-chip {
  background: var(--surface2, #f2f2f7);
}
.nav-drawer-btn:active,
.refresh-circle-btn:active {
  background: var(--accent-soft, #eff6ff);
}
.nav-drawer-text,
.segmented-item.active .segmented-label {
  color: var(--ink, #1c1c1e);
}
.nav-drawer-btn.has-active {
  background: var(--accent-soft, rgba(0, 122, 255, 0.12));
}
.nav-drawer-text.accent,
.nav-drawer-btn.has-active .nav-drawer-text,
.action-text-btn,
.sort-chip-text {
  color: var(--accent, #007aff);
}
.drawer-badge,
.section-pill.active,
.drawer-btn.confirm {
  background: var(--accent, #007aff);
  box-shadow: 0 2px 8px var(--accent-border, rgba(0, 122, 255, 0.3));
}
.apple-segmented {
  background: var(--surface2, rgba(118, 118, 128, 0.12));
}
.segmented-item.active {
  background: var(--surface, #ffffff);
}
.segmented-label {
  color: var(--ink2, #8e8e93);
}
.section-pill-text {
  color: var(--ink2, #3a3a3c);
}
.search-field {
  background: var(--surface2, #efeff4);
}
.search-input {
  color: var(--ink, #1c1c1e);
}
.card {
  background: var(--surface, #ffffff);
  border-color: var(--line, #e2e8f0);
  border-radius: var(--cardr, 12px);
  transition: transform var(--ms, 220ms) var(--ease-out, ease-out);
}
.card.selected {
  border-color: var(--accent, #2563eb);
}
.card-media,
.card-placeholder {
  background: var(--surface2, #f1f5f9);
}
.batch-bar {
  background: var(--surface, #ffffff);
  border-color: var(--line, #e2e8f0);
}
.batch-count {
  color: var(--ink, #0f172a);
}
.drawer-panel {
  background: var(--surface, #ffffff);
  border-radius: var(--topr, 30px) var(--topr, 30px) 0 0;
  transition: transform var(--ms, 320ms) var(--ease-drawer, ease-out);
}
.drawer-head,
.drawer-footer {
  background: var(--surface, #ffffff);
  border-color: var(--line, rgba(60, 60, 67, 0.12));
}
.drawer-main-title,
.drawer-group-title {
  color: var(--ink, #1c1c1e);
}
.drawer-sub-title,
.drawer-chip-text {
  color: var(--ink2, #636366);
}
.drawer-chip {
  background: var(--surface2, #f2f2f7);
  border-color: var(--line, transparent);
}
.drawer-chip.active {
  background: var(--accent-soft, #eff6ff);
  border-color: var(--accent-border, #bfd6ff);
}
.drawer-chip.active .drawer-chip-text {
  color: var(--accent, #007aff);
}
.drawer-btn.reset {
  background: var(--surface2, #f2f2f7);
}
</style>
