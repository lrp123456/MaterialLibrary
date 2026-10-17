<template>
  <view class="h5-page shell">
    <aside class="sidebar">
      <view class="side-brand">
        <view class="mini-logo">M</view>
        <view>
          <text class="side-title">素材工作台</text>
          <text class="side-sub">Material Library</text>
        </view>
      </view>
      <text class="side-group">媒体类型</text>
      <view
        v-for="m in mediaTypes"
        :key="m.key"
        class="side-item"
        :class="{ on: activeMedia === m.key }"
        @click="switchMedia(m.key)"
      >
        <text class="side-icon">{{ m.icon }}</text>
        <text>{{ m.label }}</text>
      </view>
      <text class="side-group">AI 创作</text>
      <view class="side-item studio-btn" @click="goCreate">
        <text class="side-icon">✨</text>
        <text>AI 创作台</text>
      </view>
      <view class="side-item studio-btn" @click="goStudio">
        <text class="side-icon">🎬</text>
        <text>3D 视频工坊</text>
      </view>
      <view class="side-foot">
        <view class="side-item" @click="goSettings">
          <text class="side-icon">⚙️</text>
          <text>设置</text>
        </view>
        <view class="side-item" @click="doLogout">
          <text class="side-icon">🚪</text>
          <text>退出登录</text>
        </view>
      </view>
    </aside>

    <main class="main">
      <header class="top">
        <view class="search-wrap">
          <input
            class="h5-input search"
            v-model="keyword"
            :placeholder="searchPlaceholder"
            confirm-type="search"
            @confirm="reload"
          />
        </view>
        <view class="top-actions">
          <view class="h5-btn primary" @click="goChat">💬 元素对话</view>
          <view class="h5-btn ghost" @click="toggleLayout">{{ layout === 'grid' ? '瀑布流' : '网格' }}</view>
          <picker :range="sortLabels" @change="onSort">
            <view class="h5-btn ghost">{{ sortLabel }}</view>
          </picker>
          <view class="h5-btn ghost" @click="showFilters = !showFilters">
            筛选{{ filterCount ? ` (${filterCount})` : '' }}
          </view>
        </view>
      </header>

      <view v-if="showFilters" class="filters h5-card">
        <view class="frow">
          <text class="flabel">空间</text>
          <view class="chips">
            <view v-for="s in spaceList" :key="s" class="h5-chip" :class="{ on: selectedSpaces.includes(s) }" @click="toggleSel(selectedSpaces, s)">{{ s }}</view>
          </view>
        </view>
        <view class="frow">
          <text class="flabel">风格</text>
          <view class="chips">
            <view v-for="s in styleList" :key="s" class="h5-chip" :class="{ on: selectedStyles.includes(s) }" @click="toggleSel(selectedStyles, s)">{{ s }}</view>
          </view>
        </view>
        <view class="frow" v-if="activeMedia === 'furniture' || activeMedia === 'image'">
          <text class="flabel">家具</text>
          <view class="chips">
            <view v-for="s in furnitureList" :key="s" class="h5-chip" :class="{ on: selectedFurniture.includes(s) }" @click="toggleSel(selectedFurniture, s)">{{ s }}</view>
          </view>
        </view>
        <view class="frow">
          <text class="flabel">材质</text>
          <view class="chips">
            <view v-for="s in materialList" :key="s" class="h5-chip" :class="{ on: selectedMaterials.includes(s) }" @click="toggleSel(selectedMaterials, s)">{{ s }}</view>
          </view>
        </view>
        <view class="frow">
          <text class="flabel">色系</text>
          <view class="chips">
            <view v-for="s in colorList" :key="s" class="h5-chip" :class="{ on: selectedColors.includes(s) }" @click="toggleSel(selectedColors, s)">{{ s }}</view>
          </view>
        </view>
        <view class="frow" v-if="activeMedia === 'video'">
          <text class="flabel">来源</text>
          <view class="chips">
            <view v-for="s in videoSourceList" :key="s.key" class="h5-chip" :class="{ on: selectedVideoSources.includes(s.key) }" @click="toggleSel(selectedVideoSources, s.key)">{{ s.label }}</view>
          </view>
        </view>
        <view class="frow">
          <text class="flabel">画幅</text>
          <view class="chips">
            <view v-for="s in orientationList" :key="s.key" class="h5-chip" :class="{ on: selectedOrientations.includes(s.key) }" @click="toggleSel(selectedOrientations, s.key)">{{ s.label }}</view>
          </view>
        </view>
        <view class="frow" v-if="activeMedia === 'music'">
          <text class="flabel">情绪</text>
          <view class="chips">
            <view v-for="s in moodList" :key="s" class="h5-chip" :class="{ on: selectedMoods.includes(s) }" @click="toggleSel(selectedMoods, s)">{{ s }}</view>
          </view>
        </view>
        <view class="frow" v-if="activeMedia === 'portrait'">
          <text class="flabel">姿态</text>
          <view class="chips">
            <view v-for="s in poseList" :key="s" class="h5-chip" :class="{ on: selectedPoses.includes(s) }" @click="toggleSel(selectedPoses, s)">{{ s }}</view>
          </view>
        </view>
        <view class="frow" v-if="activeMedia === 'portrait'">
          <text class="flabel">角色</text>
          <view class="chips">
            <view v-for="s in characterList" :key="s" class="h5-chip" :class="{ on: selectedCharacters.includes(s) }" @click="toggleSel(selectedCharacters, s)">{{ s }}</view>
          </view>
        </view>
        <view class="factions">
          <view class="h5-btn ghost" @click="clearFilters">清空筛选</view>
          <view class="h5-btn primary" @click="reload">应用</view>
        </view>
      </view>

      <view v-if="selectedFids.length" class="batch-bar h5-card">
        <text class="batch-text">已选 {{ selectedFids.length }} 项</text>
        <view class="batch-actions">
          <view class="h5-btn ghost" @click="selectPage">全选本页</view>
          <view class="h5-btn ghost" @click="clearSelect">取消选择</view>
          <view class="h5-btn primary" :disabled="batching" @click="batchDownload('origin')">
            {{ batching && batchKind==='origin' ? batchProgressText : '下载原图 ZIP' }}
          </view>
          <view class="h5-btn ghost" :disabled="batching" @click="batchDownload('restage_9_16')">
            {{ batching && batchKind==='restage_9_16' ? batchProgressText : '下载 9:16 ZIP' }}
          </view>
          <view class="h5-btn ghost" :disabled="batching" @click="batchDownload('restage_3_4')">
            {{ batching && batchKind==='restage_3_4' ? batchProgressText : '下载 3:4 ZIP' }}
          </view>
        </view>
      </view>
      <view v-else class="batch-bar light">
        <text class="batch-text h5-muted">点击卡片右上角勾选可批量下载</text>
        <view class="h5-btn ghost" @click="selectPage">全选本页</view>
      </view>

      <view v-if="errorText" class="error-box">{{ errorText }}</view>
      <view v-if="loading && !items.length" class="empty">加载中…</view>
      <view v-else-if="!items.length" class="empty">暂无素材</view>

      <view class="grid" :class="{ masonry: layout === 'masonry' }">
        <view
          v-for="item in items"
          :key="item.fid"
          class="card-tile"
          :class="{ sel: selectedFids.includes(item.fid) }"
          @click="openDetail(item)"
        >
          <view class="check" @click.stop="toggleSelect(item)">
            <view class="box" :class="{ on: selectedFids.includes(item.fid) }">✓</view>
          </view>
          <view class="thumb" :style="layout === 'masonry' ? { paddingTop: item.ratio + '%' } : {}">
            <view class="img-bg" :style="thumbStyle(item)"></view>
            <view v-if="!thumbStyle(item).backgroundImage" class="ph">无预览</view>
            <view v-if="item.isVideo" class="badge">视频</view>
            <view v-else-if="item.isMusic" class="badge">音频</view>
            <view v-else-if="item.isModel" class="badge">3D</view>
          </view>
          <view class="meta">
            <text class="name">{{ item.fileName || item.fid }}</text>
            <text class="tags">{{ item.tagsText }}</text>
          </view>
        </view>
      </view>

      <view v-if="items.length && !finished" class="more">
        <view class="h5-btn ghost" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </view>
      </view>
      <view v-if="items.length" class="more h5-muted">
        共 {{ total }} 项 · 已加载 {{ items.length }}{{ finished ? ' · 已全部加载' : '' }}
      </view>
    </main>
  </view>
</template>

<script>
import { fetchAssets, fetchDetail, logout, sessionValid } from '../../service/ViewerApi'
import { mapServerAsset } from '../../common/assetMap'
import {
  MEDIA_TYPES, DEFAULT_SPACES, DEFAULT_STYLES, DEFAULT_FURNITURE, DEFAULT_MATERIALS,
  DEFAULT_COLORS, MOOD_LIST, POSE_LIST, CHARACTER_LIST, ORIENTATION_LIST,
  VIDEO_SOURCE_LIST, SORT_LIST, mergeFacetList, extractFacetLabels,
} from '../../common/filters'
import { ensureServerUrl } from '../../service/ServerResolve'
import { authMediaUrl, getMediaObjectUrl, downloadBatchZip } from '../../service/WebDownload'
import { H5_CSS } from '../h5-theme'

export default {
  data() {
    return {
      mediaTypes: MEDIA_TYPES,
      activeMedia: 'image',
      keyword: '',
      sort: 'latest',
      layout: 'grid',
      showFilters: false,
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
      spaceList: [...DEFAULT_SPACES],
      styleList: [...DEFAULT_STYLES],
      furnitureList: [...DEFAULT_FURNITURE],
      materialList: [...DEFAULT_MATERIALS],
      colorList: [...DEFAULT_COLORS],
      moodList: [...MOOD_LIST],
      poseList: [...POSE_LIST],
      characterList: [...CHARACTER_LIST],
      orientationList: ORIENTATION_LIST,
      videoSourceList: VIDEO_SOURCE_LIST,
      items: [],
      page: 1,
      total: 0,
      finished: false,
      loading: false,
      loadingMore: false,
      errorText: '',
      selectedFids: [],
      batching: false,
      batchKind: '',
      batchProgressText: '',
    }
  },
  computed: {
    searchPlaceholder() {
      const map = {
        video: '搜索视频名称、来源、标签…',
        furniture: '搜索单品家具、材质、风格…',
        music: '搜索设计配乐、情绪、场景…',
        portrait: '搜索人像贴图、姿态、角色…',
      }
      return map[this.activeMedia] || '搜索文件名、标签、空间…'
    },
    sortLabels() {
      return SORT_LIST.map((s) => s.label)
    },
    sortLabel() {
      return (SORT_LIST.find((s) => s.key === this.sort) || SORT_LIST[0]).label
    },
    filterCount() {
      return (
        this.selectedSpaces.length +
        this.selectedStyles.length +
        this.selectedFurniture.length +
        this.selectedMaterials.length +
        this.selectedColors.length +
        this.selectedOrientations.length +
        this.selectedVideoSources.length +
        this.selectedMoods.length +
        this.selectedPoses.length +
        this.selectedCharacters.length
      )
    },
  },
  onLoad() {
    if (!sessionValid()) {
      uni.reLaunch({ url: '/pages-h5/login/login' })
      return
    }
    this.reload()
  },
  created() {
    // #ifdef H5
    const style = document.createElement('style')
    style.textContent = H5_CSS
    document.head.appendChild(style)
    // #endif
  },
  methods: {
    toggleSel(arr, val) {
      const i = arr.indexOf(val)
      if (i >= 0) arr.splice(i, 1)
      else arr.push(val)
    },
    clearFilters() {
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
      this.reload()
    },
    switchMedia(key) {
      if (this.activeMedia === key) return
      this.activeMedia = key
      this.clearFilters()
    },
    toggleLayout() {
      this.layout = this.layout === 'grid' ? 'masonry' : 'grid'
    },
    onSort(e) {
      const idx = Number(e.detail.value || 0)
      this.sort = SORT_LIST[idx].key
      this.reload()
    },
    goSettings() {
      uni.navigateTo({ url: '/pages-h5/settings/settings' })
    },
    goChat() {
      uni.navigateTo({ url: '/pages-h5/chat/chat' })
    },
    goStudio() {
      uni.navigateTo({ url: '/pages-h5/studio/director-studio' })
    },
    goCreate() {
      uni.navigateTo({ url: '/pages-h5/create/create' })
    },
    async doLogout() {
      await logout()
      uni.reLaunch({ url: '/pages-h5/login/login' })
    },
    thumbStyle(item) {
      const u = item.displayUrl || item.thumbSrc || ''
      if (!u) return {}
      return {
        backgroundImage: `url("${u}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    },
    openDetail(item) {
      uni.navigateTo({ url: '/pages-h5/detail/detail?fid=' + encodeURIComponent(item.fid) })
    },
    toggleSelect(item) {
      const i = this.selectedFids.indexOf(item.fid)
      if (i >= 0) this.selectedFids.splice(i, 1)
      else this.selectedFids.push(item.fid)
    },
    selectPage() {
      this.selectedFids = this.items.map((x) => x.fid)
    },
    clearSelect() {
      this.selectedFids = []
    },
    buildQuery(page) {
      return {
        page,
        pageSize: 40,
        keyword: this.keyword.trim(),
        mediaType: this.activeMedia,
        sort: this.sort,
        space: this.selectedSpaces.join(','),
        style: this.selectedStyles.join(','),
        material: this.selectedMaterials.join(','),
        colors: this.selectedColors.join(','),
        furniture_item: this.selectedFurniture.join(','),
        orientation: this.selectedOrientations.join(','),
        videoSource: this.selectedVideoSources.join(','),
        mood: this.selectedMoods.join(','),
        pose: this.selectedPoses.join(','),
        character: this.selectedCharacters.join(','),
        // 首页要 facets 校准词表；加载更多 skip 加速
        skipFacets: this.page > 1,
      }
    },
    applyServerFilters(data) {
      const facets = (data && (data.filterOptions || data.facets || data.filters)) || {}
      this.spaceList = mergeFacetList(DEFAULT_SPACES, extractFacetLabels(facets.space || facets.spaces))
      this.styleList = mergeFacetList(DEFAULT_STYLES, extractFacetLabels(facets.style_atom || facets.styles))
      this.furnitureList = mergeFacetList(DEFAULT_FURNITURE, extractFacetLabels(facets.furniture_item || facets.furniture_items || facets.furniture_category))
      this.materialList = mergeFacetList(DEFAULT_MATERIALS, extractFacetLabels(facets.material_kind || facets.materials))
      this.colorList = mergeFacetList(DEFAULT_COLORS, extractFacetLabels(facets.colors || facets.color))
      this.moodList = mergeFacetList(MOOD_LIST, extractFacetLabels(facets.mood || facets.moods))
      this.poseList = mergeFacetList(POSE_LIST, extractFacetLabels(facets.pose || facets.poses))
      this.characterList = mergeFacetList(CHARACTER_LIST, extractFacetLabels(facets.character || facets.characters))
    },
    async reload() {
      await ensureServerUrl()
      this.page = 1
      this.finished = false
      this.items = []
      this.selectedFids = []
      await this.fetchPage(true)
    },
    async fetchPage(reset) {
      if (this.loading || this.loadingMore) return
      if (reset) this.loading = true
      else this.loadingMore = true
      this.errorText = ''
      try {
        const data = await fetchAssets(this.buildQuery(this.page))
        const rows = (data && data.items) || []
        const mapped = []
        for (const r of rows) {
          try {
            mapped.push(mapServerAsset(r))
          } catch (e) {}
        }
        // 先上卡片，再异步补缩略图，避免整页 blob 卡住列表
        if (reset) this.items = mapped
        else {
          const seen = new Set(this.items.map((x) => x.fid))
          for (const m of mapped) {
            if (!seen.has(m.fid)) this.items.push(m)
          }
        }
        const totalNum = Number(data && data.total)
        this.total = Number.isFinite(totalNum) ? totalNum : this.items.length
        this.applyServerFilters(data)
        if (!rows.length || this.items.length >= this.total) this.finished = true
        this.hydrateThumbs(mapped)
      } catch (e) {
        this.errorText = e.message || '加载失败'
        if (/未登录|过期/.test(this.errorText)) {
          setTimeout(() => uni.reLaunch({ url: '/pages-h5/login/login' }), 600)
        }
      } finally {
        this.loading = false
        this.loadingMore = false
      }
    },
    async hydrateThumbs(list) {
      // 列表直接用 thumbSrc（/image?token&local=1）即可；Blob 仅作可选加速，失败不写坏 URL
      const queue = list.slice()
      const workers = Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const it = queue.shift()
          if (!it || it.displayUrl) continue
          try {
            const url = it.isVideo
              ? authMediaUrl(it.fid, { kind: 'poster' })
              : authMediaUrl(it.fid, { derivativeId: it.mainDerivativeId || 0, kind: 'image' })
            it.displayUrl = await getMediaObjectUrl('thumb:' + it.fid, url)
          } catch (e) {
            // 保留 thumbSrc
          }
        }
      })
      await Promise.all(workers)
    },
    async loadMore() {
      if (this.finished) return
      this.page += 1
      await this.fetchPage(false)
      if (!this.items.length) this.finished = true
    },
    async batchDownload(derivativeKind = 'origin') {
      const chosen = this.items.filter((x) => this.selectedFids.includes(x.fid))
      if (!chosen.length) return
      this.batching = true
      this.batchKind = derivativeKind
      try {
        const res = await downloadBatchZip(
          chosen.map((x) => ({
            fid: x.fid,
            fileName: x.fileName,
            derivativeId: 0,
            derivatives: x.derivatives,
            isVideo: x.isVideo,
            isMusic: x.isMusic,
            isModel: x.isModel,
          })),
          {
            derivativeKind,
            resolveDerivatives: async (it) => {
              const d = await fetchDetail(it.fid)
              return (d && d.derivatives) || []
            },
            onProgress: ({ done, total, currentName }) => {
              this.batchProgressText = `打包 ${done + 1}/${total}${currentName ? ' · ' + currentName : ''}`
            },
          }
        )
        const skip = (res && res.skipped && res.skipped.length) || 0
        uni.showToast({
          title: skip ? `已下载 ${res.count}，跳过无版本 ${skip}` : '已开始下载 ZIP',
          icon: 'none',
        })
        this.clearSelect()
      } catch (e) {
        uni.showToast({ title: e.message || '批量下载失败', icon: 'none' })
      } finally {
        this.batching = false
        this.batchKind = ''
        this.batchProgressText = ''
      }
    },
  },
}
</script>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 240px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #e2e8f0;
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
  height: 100vh;
}
.side-brand {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 18px;
  padding: 0 8px;
}
.mini-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(145deg, #2563eb, #60a5fa);
  color: #fff;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.side-title {
  display: block;
  font-size: 14px;
  font-weight: 650;
}
.side-sub {
  display: block;
  font-size: 11px;
  color: #94a3b8;
}
.side-group {
  font-size: 11px;
  color: #94a3b8;
  padding: 8px 10px 6px;
  letter-spacing: 0.06em;
}
.side-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 10px;
  border-radius: 10px;
  color: #0f172a;
  font-size: 14px;
  cursor: pointer;
}
.side-item:hover {
  background: #f1f5f9;
}
.side-item.on {
  background: #eff6ff;
  color: #2563eb;
  font-weight: 600;
}
.side-icon {
  width: 20px;
  text-align: center;
}
.side-foot {
  margin-top: auto;
  border-top: 1px solid #e2e8f0;
  padding-top: 10px;
}
.main {
  flex: 1;
  padding: 20px 24px 40px;
  min-width: 0;
}
.top {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 14px;
}
.search-wrap {
  flex: 1;
}
.search {
  max-width: 520px;
}
.top-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.filters {
  padding: 16px;
  margin-bottom: 12px;
}
.frow {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}
.flabel {
  width: 48px;
  flex-shrink: 0;
  font-size: 13px;
  color: #64748b;
  line-height: 28px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.factions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 14px;
}
.batch-bar.light {
  background: transparent;
  border-style: dashed;
}
.batch-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.batch-text {
  font-size: 13px;
  font-weight: 600;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}
.grid.masonry {
  display: block;
  columns: 4 200px;
  column-gap: 14px;
}
.grid.masonry .card-tile {
  break-inside: avoid;
  margin-bottom: 14px;
}
.card-tile {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
}
.card-tile:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.05);
}
.card-tile.sel {
  outline: 2px solid #2563eb;
}
.check {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
}
.box {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1.5px solid #cbd5e1;
  background: #fff;
  color: transparent;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.box.on {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.thumb {
  position: relative;
  background: #f1f5f9;
  height: 160px;
  overflow: hidden;
}
.grid.masonry .thumb {
  height: 0;
  min-height: 0;
}
.img-bg {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background-color: #e2e8f0;
  background-size: cover;
  background-position: center;
}
.grid.masonry .img-bg {
  position: absolute;
}
.ph {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-size: 12px;
}
.badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  background: rgba(15, 23, 42, 0.65);
  color: #fff;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
}
.meta {
  padding: 10px 12px 12px;
}
.name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tags {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.empty,
.error-box,
.more {
  text-align: center;
  padding: 28px 12px;
  font-size: 13px;
  color: #64748b;
}
.error-box {
  color: #dc2626;
}
.studio-btn {
  background: linear-gradient(135deg, rgba(37,99,235,0.06), rgba(99,102,241,0.06)) !important;
  border: 1px dashed rgba(37,99,235,0.35) !important;
  font-weight: 600 !important;
  color: #2563eb !important;
}
.studio-btn:hover {
  background: linear-gradient(135deg, rgba(37,99,235,0.12), rgba(99,102,241,0.12)) !important;
  border-color: #2563eb !important;
}
</style>
