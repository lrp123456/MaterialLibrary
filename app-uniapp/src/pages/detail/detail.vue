<template>
  <view class="page">
    <!-- 毛玻璃导航：随滚动收进 -->
    <view class="nav" :class="{ solid: navSolid }" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-bar">
        <view class="nav-btn" hover-class="nav-btn-hover" @click="goBack">
          <text class="nav-icon">‹</text>
        </view>
        <text class="nav-title" :class="{ show: navSolid }">{{ navTitle }}</text>
        <view class="nav-btn" hover-class="nav-btn-hover" @click="confirmDelete">
          <text class="nav-icon trash">🗑</text>
        </view>
      </view>
    </view>

    <scroll-view
      scroll-y
      class="scroll"
      :style="{ height: '100vh' }"
      :scroll-top="scrollTopForReset"
      @scroll="onScroll"
    >
      <view v-if="loading" class="state-full">
        <view class="spinner" />
        <text class="state-t">正在加载素材详情…</text>
      </view>

      <view v-else-if="errorText" class="state-full">
        <text class="state-title">看不到这件素材</text>
        <text class="state-t">{{ errorText }}</text>
        <view class="state-row">
          <view class="state-btn primary" @click="load"><text class="state-btn-t">重试</text></view>
          <view class="state-btn" @click="goTrash"><text class="state-btn-t">去回收站</text></view>
        </view>
      </view>

      <block v-else-if="item">
        <!-- 视差 Hero -->
        <view class="hero" :style="{ height: heroHeight + 'px' }">
          <view class="hero-inner" :style="heroStyle">
            <video
              v-if="item.isVideo && videoSrc"
              class="hero-video"
              :src="videoSrc"
              :poster="item.posterUrl || ''"
              :controls="true"
              :show-center-play-btn="true"
              object-fit="contain"
              @error="onVideoError"
            />
            <view v-else-if="item.isMusic" class="hero-audio" @click="openLightbox('audio')">
              <view class="audio-disc"><text class="audio-note">♪</text></view>
              <text class="audio-title">{{ item.fileName }}</text>
              <text class="audio-hint">轻点全屏播放</text>
            </view>
            <view v-else-if="isCurrentTabNotGenerated" class="hero-ungenerated" @click.stop>
              <view class="ungenerated-ratio" :class="ratioFrameClass">
                <text class="ungenerated-ratio-t">{{ activeTabLabel }}</text>
              </view>
              <text class="ungenerated-tip">此画幅尚未生成</text>
            </view>
            <image
              v-else-if="previewUrl"
              class="hero-img"
              :class="{ loaded: displayLoaded }"
              :src="previewUrl"
              mode="aspectFit"
              @load="onMediaLoaded"
              @error="onImgError"
              @click="openLightbox('image')"
            />
            <view v-if="!displayLoaded && !item.isVideo && !item.isMusic" class="hero-skeleton">
              <view class="spinner light" />
            </view>
          </view>
          <view class="hero-shade" />
          <view v-if="activeTabLabel && !isCurrentTabNotGenerated" class="hero-pill">
            <text class="hero-pill-t">{{ activeTabLabel }}</text>
          </view>
          <text v-if="!item.isVideo && !item.isMusic && !isCurrentTabNotGenerated" class="hero-hint">轻点查看大图</text>
        </view>

        <!-- 内容抽屉 -->
        <view class="sheet">
          <view class="head">
            <text class="file-name">{{ item.fileName || item.fid }}</text>
            <view class="meta-line">
              <text class="meta-t">{{ item.width }} × {{ item.height }}</text>
              <text v-if="item.size" class="meta-dot">·</text>
              <text v-if="item.size" class="meta-t">{{ sizeText }}</text>
              <text class="meta-dot">·</text>
              <text class="meta-t">{{ typeLabel }}</text>
            </view>
            <text v-if="item.tagsText" class="tags-text">{{ item.tagsText }}</text>
          </view>

          <!-- 画幅 / 版本切换 -->
          <view v-if="versionTabs.length > 1" class="tabs-wrap">
            <scroll-view scroll-x class="tabs-scroll" :show-scrollbar="false">
              <view class="tabs">
                <view
                  v-for="t in versionTabs"
                  :key="t.id"
                  class="tab"
                  :class="{ active: activeTab === t.id }"
                  @click="switchTab(t)"
                >
                  <text class="tab-t">{{ t.label }}</text>
                  <text v-if="t.statusText" class="tab-sub">{{ t.statusText }}</text>
                </view>
              </view>
            </scroll-view>
          </view>

          <!-- 未生成画幅 → 立即生成 -->
          <view v-if="isCurrentTabNotGenerated" class="gen-card">
            <view class="gen-head">
              <text class="gen-title">{{ activeTabLabel }} 画幅尚未生成</text>
              <text class="gen-sub">AI 构图引擎会依据原图智能重构并延展画幅</text>
            </view>
            <view class="gen-btn" :class="{ disabled: restaging }" @click="onRestage">
              <text class="gen-btn-t">{{ restaging ? '正在重构…' : '立即生成此画幅' }}</text>
            </view>
          </view>

          <!-- 操作区 -->
          <view class="action-grid">
            <view v-if="isImage && (item.isInterior !== false)" class="action" :class="{ disabled: restaging }" @click="onRestage">
              <text class="action-icon">🖼</text>
              <text class="action-t">{{ isCurrentTabNotGenerated ? '生成本画幅' : '重绘画幅' }}</text>
            </view>
            <view class="action" :class="{ disabled: !canSetMainCover || covering }" @click="onSetMainCover">
              <text class="action-icon">⭐</text>
              <text class="action-t">{{ covering ? '设置中…' : (isCurrentMain ? '当前封面' : '设为封面') }}</text>
            </view>
            <view v-if="isImage" class="action" @click="goEditor">
              <text class="action-icon">✂</text>
              <text class="action-t">精准编辑</text>
            </view>
            <view class="action" @click="download">
              <text class="action-icon">📥</text>
              <text class="action-t">下载素材</text>
            </view>
          </view>

          <!-- 质量评估 -->
          <view v-if="qualityDims.length" class="card quality-card">
            <view class="card-head" @click="qualityOpen = !qualityOpen">
              <text class="card-title">质量评估</text>
              <view class="quality-head-right">
                <text class="quality-total">{{ qualityTotal }} / {{ qualityMax }}</text>
                <text class="chev">{{ qualityOpen ? '▴' : '▾' }}</text>
              </view>
            </view>
            <view class="quality-bar"><view class="quality-fill" :style="{ width: qualityPercent + '%' }" /></view>
            <view v-if="qualityOpen" class="quality-list">
              <view v-for="d in qualityDims" :key="d.key" class="quality-row">
                <text class="quality-label">{{ d.label }}</text>
                <view class="quality-track"><view class="quality-fill soft" :style="{ width: dimPercent(d) + '%' }" /></view>
                <text class="quality-score">{{ d.score }}/{{ d.max }}</text>
                <text v-if="d.detail" class="quality-detail">{{ d.detail }}</text>
              </view>
            </view>
          </view>

          <!-- 衍生版本 -->
          <view v-if="derivatives.length" class="card">
            <text class="card-title">衍生版本</text>
            <view class="deriv-wrap">
              <view
                v-for="d in derivatives"
                :key="d.id || d.kind"
                class="deriv-chip"
                :class="{ active: isDerivActive(d) }"
                @click="onDerivTap(d)"
              >
                <text class="deriv-t">{{ derivLabel(d) }}</text>
                <text v-if="isMainDeriv(d)" class="deriv-main">封面</text>
              </view>
            </view>
          </view>

          <!-- 母素材 -->
          <view v-if="sourceAsset" class="card source-card" @click="openSource">
            <image class="source-img" :src="sourceAsset.thumbSrc || sourceAsset.imgUrl" mode="aspectFill" />
            <view class="source-info">
              <text class="source-title">母素材溯源</text>
              <text class="source-name">{{ sourceAsset.fileName || sourceAsset.fid }}</text>
              <text class="source-go">查看母素材 ›</text>
            </view>
          </view>

          <!-- 相似推荐 -->
          <view v-if="similar.length" class="card">
            <text class="card-title">相似推荐</text>
            <scroll-view scroll-x class="similar-scroll" :show-scrollbar="false">
              <view class="similar-row">
                <view v-for="s in similar" :key="s.fid" class="similar-item" @click="openSimilar(s)">
                  <image class="similar-img" :src="s.thumbSrc || s.imgUrl" mode="aspectFill" />
                </view>
              </view>
            </scroll-view>
          </view>

          <view class="bottom-space" />
        </view>
      </block>
    </scroll-view>

    <view v-if="restaging" class="busy-mask">
      <view class="busy-card">
        <view class="spinner" />
        <text class="busy-t">AI 正在重构画幅…</text>
      </view>
    </view>

    <ref-lightbox
      :show="lightboxVisible"
      :url="lightboxSrc"
      :kind="lightboxKind"
      :label="item && (item.fileName || item.fid)"
      @close="lightboxVisible = false"
      @download="download"
    />
  </view>
</template>

<script>
import {
  fetchDetail,
  fetchQuality,
  deleteAsset,
  mediaUrl,
  videoUrl,
  posterUrl,
  rawFileUrl,
  downloadAndSaveToAlbum,
  triggerRestage,
  setMainDerivativeApi,
} from '../../service/ViewerApi'
import { viewerCache } from '../../service/ViewerCache'
import { mapServerDetail } from '../../common/assetMap'
import RefLightbox from '../../components/RefLightbox.vue'

function decodeParam(raw) {
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch (e) {
    return String(raw)
  }
}

export default {
  components: { RefLightbox },
  data() {
    return {
      statusBarHeight: 20,
      windowWidth: 375,
      windowHeight: 800,
      heroHeight: 460,
      scrollTop: 0,
      scrollTopForReset: 0,
      navSolid: false,
      fid: '',
      tab: '',
      item: null,
      pending: null,
      loading: true,
      errorText: '',
      derivatives: [],
      similar: [],
      sourceAsset: null,
      activeTab: 'origin',
      previewUrl: '',
      displayLoaded: false,
      restaging: false,
      covering: false,
      qualityDims: [],
      qualityTotal: 0,
      qualityMax: 0,
      qualityOpen: false,
      lightboxVisible: false,
      lightboxKind: 'image',
      lightboxSrc: '',
      loadSeq: 0,
    }
  },
  computed: {
    navTitle() {
      return (this.item && (this.item.fileName || this.item.fid)) || '素材详情'
    },
    sizeText() {
      const s = this.item && this.item.size
      if (!s) return ''
      if (s < 1024 * 1024) return (s / 1024).toFixed(1) + ' KB'
      return (s / 1024 / 1024).toFixed(1) + ' MB'
    },
    typeLabel() {
      if (!this.item) return ''
      if (this.item.isVideo) return '视频'
      if (this.item.isMusic) return '音频'
      if (this.item.isPortrait) return '人像'
      if (this.item.isFurniture) return '单品'
      return '图片'
    },
    isImage() {
      return !!this.item && !this.item.isVideo && !this.item.isMusic
    },
    isInteriorLike() {
      if (!this.item) return false
      return !this.item.isPortrait && !this.item.isFurniture
    },
    videoSrc() {
      return this.item && this.item.isVideo ? videoUrl(this.item.fid) : ''
    },
    audioSrc() {
      return this.item && this.item.isMusic ? rawFileUrl(this.item.fid, false) : ''
    },
    activeTabLabel() {
      const t = this.versionTabs.find((x) => x.id === this.activeTab)
      return t ? t.label : ''
    },
    activeTabDerivId() {
      const t = this.versionTabs.find((x) => x.id === this.activeTab)
      return t && t.derivativeId ? t.derivativeId : 0
    },
    isCurrentTabNotGenerated() {
      if (this.activeTab === 'restage_9_16') return !this.item || !this.item.hasRestage916
      if (this.activeTab === 'restage_3_4') return !this.item || !this.item.hasRestage34
      return false
    },
    ratioFrameClass() {
      if (this.activeTab === 'restage_3_4') return 'frame-3-4'
      return 'frame-9-16'
    },
    versionTabs() {
      if (!this.item) return []
      const tabs = [{ id: 'origin', label: '原图', derivativeId: 0, statusText: '' }]
      if (this.isImage && this.isInteriorLike) {
        tabs.push({
          id: 'restage_9_16',
          label: '9:16',
          derivativeId: this.findDeriv('restage_9_16') ? this.findDeriv('restage_9_16').id : 0,
          statusText: this.item.hasRestage916 ? '' : '未生成',
        })
        tabs.push({
          id: 'restage_3_4',
          label: '3:4',
          derivativeId: this.findDeriv('restage_3_4') ? this.findDeriv('restage_3_4').id : 0,
          statusText: this.item.hasRestage34 ? '' : '未生成',
        })
      }
      for (const d of this.derivatives || []) {
        if (!d || !d.id) continue
        if (d.kind === 'origin' || d.kind === 'restage_9_16' || d.kind === 'restage_3_4') continue
        tabs.push({ id: 'deriv_' + d.id, label: this.derivLabel(d), derivativeId: d.id, statusText: '' })
      }
      return tabs
    },
    canSetMainCover() {
      const t = this.versionTabs.find((x) => x.id === this.activeTab)
      return !!(t && t.derivativeId > 0 && !t.statusText)
    },
    isCurrentMain() {
      if (!this.item) return false
      return Number(this.item.mainDerivativeId || 0) === Number(this.activeTabDerivId || 0)
    },
    qualityPercent() {
      if (!this.qualityMax) return 0
      return Math.max(0, Math.min(100, Math.round((this.qualityTotal / this.qualityMax) * 100)))
    },
    heroStyle() {
      const s = Math.max(0, this.scrollTop)
      const ty = Math.min(140, s * 0.32)
      const scale = 1 + Math.min(0.12, s / 7000)
      return `transform: translate3d(0, ${ty}px, 0) scale(${scale});`
    },
  },
  onLoad(opts = {}) {
    try {
      const sys = uni.getSystemInfoSync()
      this.statusBarHeight = sys.statusBarHeight || 20
      this.windowWidth = sys.windowWidth || 375
      this.windowHeight = sys.windowHeight || 800
    } catch (e) {}
    this.heroHeight = Math.max(320, Math.min(this.windowWidth * 1.25, this.windowHeight * 0.62))
    this.fid = decodeParam(opts.fid)
    this.tab = decodeParam(opts.tab)
    this.pending = viewerCache.getPendingDetailPreview(this.fid)
    if (this.pending) this.applyPending()
    this.load()
  },
  methods: {
    applyPending() {
      const p = this.pending
      if (!p) return
      this.item = { ...p }
      this.derivatives = Array.isArray(p.derivatives) ? p.derivatives.slice() : []
      this.loading = false
      this.navSolid = false
      const start = p.defaultTab || p.mainDerivativeKind || 'origin'
      this.activeTab = start === '9:16' ? 'restage_9_16' : (start === '3:4' ? 'restage_3_4' : start)
      this.previewUrl = p.localPath || p.imgUrl || p.serverUrl || ''
      this.displayLoaded = !!this.previewUrl
      if (!this.versionTabs.some((t) => t.id === this.activeTab)) this.activeTab = 'origin'
    },
    async load() {
      if (!this.fid) {
        this.errorText = '缺少素材 ID'
        this.loading = false
        return
      }
      const hadPreview = !!this.item
      if (!hadPreview) this.loading = true
      this.errorText = ''
      try {
        const data = await fetchDetail(this.fid)
        const mapped = mapServerDetail(data)
        this.item = mapped
        this.derivatives = mapped.derivatives || []
        this.similar = mapped.similar || []
        this.sourceAsset = mapped.sourceAsset || null
        let startTab = this.tab
        if (!startTab && this.pending) startTab = this.pending.defaultTab || ''
        if (!startTab && mapped.isRestage && mapped.mainDerivativeKind) startTab = mapped.mainDerivativeKind
        if (startTab === '9:16') startTab = 'restage_9_16'
        if (startTab === '3:4') startTab = 'restage_3_4'
        if (!this.versionTabs.some((t) => t.id === startTab)) startTab = 'origin'
        if (!hadPreview || this.activeTab === 'origin' || !this.pending) {
          this.activeTab = startTab
        }
        this.applyPreview()
      } catch (e) {
        if (!hadPreview) this.errorText = (e && e.message) || '加载失败'
      } finally {
        this.loading = false
      }
      this.loadQuality()
    },
    applyPreview() {
      const seq = ++this.loadSeq
      if (!this.item) return
      this.displayLoaded = false
      if (this.item.isVideo) {
        this.previewUrl = ''
        this.displayLoaded = true
        return
      }
      if (this.item.isMusic) {
        this.previewUrl = ''
        this.displayLoaded = true
        return
      }
      if (this.isCurrentTabNotGenerated) {
        this.previewUrl = ''
        this.displayLoaded = true
        return
      }
      const derivId = this.activeTabDerivId
      if (this.activeTab === 'origin' && this.pending && this.pending.localPath) {
        this.previewUrl = this.pending.localPath
      } else if (this.activeTab === 'origin' && this.pending && this.pending.serverUrl && !this.pending.mainDerivativeKind) {
        this.previewUrl = this.pending.serverUrl
      } else {
        this.previewUrl = mediaUrl(this.item.fid, derivId)
      }
      if (seq !== this.loadSeq) return
    },
    switchTab(t) {
      if (!t || this.activeTab === t.id) return
      this.activeTab = t.id
      this.applyPreview()
    },
    onMediaLoaded() {
      this.displayLoaded = true
    },
    onImgError() {
      if (!this.item) {
        this.displayLoaded = true
        return
      }
      const fallback = this.activeTabDerivId
        ? mediaUrl(this.item.fid, this.activeTabDerivId)
        : (this.item.serverUrl || mediaUrl(this.item.fid, 0))
      if (this.previewUrl !== fallback) {
        this.previewUrl = fallback
        return
      }
      this.displayLoaded = true
    },
    onVideoError() {
      uni.showToast({ title: '视频播放失败', icon: 'none' })
    },
    onScroll(e) {
      const top = (e && e.detail && e.detail.scrollTop) || 0
      this.scrollTop = top
      const solid = top > 96
      if (solid !== this.navSolid) this.navSolid = solid
    },
    dimPercent(d) {
      if (!d || !d.max) return 0
      return Math.max(0, Math.min(100, Math.round((d.score / d.max) * 100)))
    },
    async loadQuality() {
      try {
        const q = await fetchQuality(this.fid)
        if (!q) return
        this.qualityDims = Array.isArray(q.dims) ? q.dims : []
        this.qualityTotal = Number(q.total) || 0
        this.qualityMax = Number(q.max) || 0
      } catch (e) {
        // 质量评估是附加信息，失败不影响详情主体
      }
    },
    findDeriv(kind) {
      return (this.derivatives || []).find((d) => d && d.kind === kind) || null
    },
    derivLabel(d) {
      const kind = d && d.kind
      let params = d && d.params
      if (typeof params === 'string') {
        try { params = JSON.parse(params) } catch (e) { params = {} }
      }
      params = params || {}
      const style = params.targetStyle || params.style || ''
      const map = {
        origin: '原图',
        restage_9_16: '9:16',
        restage_3_4: '3:4',
        restage_dual: '双画幅',
        style_transferred: style ? ('风格 · ' + style) : '风格转换',
        clarity_enhanced: '清晰度',
        expand: '扩图',
        quick_replace: '精准改',
        quick_remove: '精准删',
        quick_insert: '精准增',
        ai_remove: '精准删',
        retouched: '精修',
        manual_edit: '精修',
        clean: '去水印',
        clothing_extract: '抽衣服',
        portrait_redraw: '重置人像',
      }
      return (kind && map[kind]) || kind || String((d && d.id) || '')
    },
    isDerivActive(d) {
      if (!d) return false
      if (d.kind === 'origin' && this.activeTab === 'origin') return true
      if (d.kind === this.activeTab) return true
      return this.activeTab === 'deriv_' + d.id
    },
    isMainDeriv(d) {
      if (!d || !this.item) return false
      return Number(this.item.mainDerivativeId || 0) === Number(d.id || 0)
    },
    onDerivTap(d) {
      if (!d) return
      if (d.kind === 'origin') {
        this.switchTab({ id: 'origin', derivativeId: 0 })
        return
      }
      const id = d.kind && d.kind.startsWith('restage_') ? d.kind : 'deriv_' + d.id
      this.switchTab({ id, derivativeId: d.id })
    },
    async onRestage() {
      if (!this.item || this.restaging) return
      const need = this.activeTab === 'restage_9_16'
        ? ['9:16']
        : this.activeTab === 'restage_3_4'
          ? ['3:4']
          : Array.from(new Set([
              ...(this.item.hasRestage916 ? [] : ['9:16']),
              ...(this.item.hasRestage34 ? [] : ['3:4']),
              ...(this.item.hasRestage916 && this.item.hasRestage34 ? ['9:16', '3:4'] : []),
            ]))
      this.restaging = true
      uni.showLoading({ title: '画幅重构中…', mask: true })
      try {
        const res = await triggerRestage(this.item.fid, {
          ratios: need,
          mainRatio: need[0] === '3:4' ? '3:4' : '9:16',
        })
        uni.hideLoading()
        const produced = (res && res.produced) || []
        if (!produced.length) {
          const why = (res && res.restage && (res.restage.error || res.restage.reason)) || '未产出任何画幅'
          uni.showToast({ title: String(why).slice(0, 40), icon: 'none' })
          return
        }
        uni.showToast({ title: '画幅已生成', icon: 'success' })
        this.pending = null
        await this.load()
        const want916 = need.includes('9:16')
        const want34 = need.includes('3:4')
        const got = (want916 && this.item.hasRestage916) || (want34 && this.item.hasRestage34)
        if (!got) uni.showToast({ title: '生成未入库，请稍后重试', icon: 'none' })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: (e && e.message) || '画幅重构失败', icon: 'none' })
      } finally {
        this.restaging = false
      }
    },
    async onSetMainCover() {
      if (!this.item || this.covering) return
      const t = this.versionTabs.find((x) => x.id === this.activeTab)
      if (!t || !t.derivativeId) {
        uni.showToast({ title: '请先选择已生成的画幅', icon: 'none' })
        return
      }
      this.covering = true
      try {
        await setMainDerivativeApi(this.item.fid, t.derivativeId)
        this.item.mainDerivativeId = t.derivativeId
        this.item.mainDerivativeKind = t.id === 'origin' ? 'origin' : (this.findDerivKind(t.derivativeId) || t.id)
        try { viewerCache.clearAll() } catch (e) {}
        uni.showToast({ title: '已设为列表封面', icon: 'success' })
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '设置封面失败', icon: 'none' })
      } finally {
        this.covering = false
      }
    },
    findDerivKind(id) {
      const d = (this.derivatives || []).find((x) => x && x.id === id)
      return d ? d.kind : ''
    },
    openLightbox(forceKind) {
      if (!this.item) return
      const kind = forceKind || (this.item.isVideo ? 'video' : (this.item.isMusic ? 'audio' : 'image'))
      this.lightboxKind = kind
      this.lightboxSrc = kind === 'image'
        ? (this.previewUrl || mediaUrl(this.item.fid, this.activeTabDerivId))
        : rawFileUrl(this.item.fid, false)
      this.lightboxVisible = true
    },
    goEditor() {
      if (!this.item) return
      const derivId = this.activeTabDerivId
      const imgUrl = encodeURIComponent(this.previewUrl || mediaUrl(this.item.fid, derivId))
      uni.navigateTo({
        url: `/pages/editor/editor?fid=${encodeURIComponent(this.item.fid)}&derivId=${derivId}&imgUrl=${imgUrl}`,
      })
    },
    async download() {
      if (!this.item) return
      try {
        const derivId = this.activeTabDerivId
        const url = (this.item.isVideo || this.item.isMusic)
          ? rawFileUrl(this.item.fid, true)
          : mediaUrl(this.item.fid, derivId, true)
        await downloadAndSaveToAlbum({
          url,
          fileName: this.item.fileName,
          isVideo: this.item.isVideo,
          isAudio: this.item.isMusic,
          fid: this.item.fid,
          kind: this.activeTab || 'origin',
        })
        uni.showToast({ title: '已保存到相册', icon: 'success' })
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
      }
    },
    goBack() {
      uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/browse/browse' }) })
    },
    confirmDelete() {
      if (!this.item) return
      uni.showModal({
        title: '移入回收站',
        content: `将「${this.item.fileName || this.item.fid}」移入回收站，保留期内可恢复；同步时也不会重复入库。`,
        confirmText: '移入',
        confirmColor: '#3B82F6',
        success: async (res) => {
          if (!res.confirm) return
          uni.showLoading({ title: '移入中…', mask: true })
          try {
            await deleteAsset(this.item.fid)
            uni.hideLoading()
            uni.showToast({ title: '已移入回收站', icon: 'none' })
            setTimeout(() => uni.navigateBack(), 700)
          } catch (e) {
            uni.hideLoading()
            uni.showToast({ title: (e && e.message) || '操作失败', icon: 'none' })
          }
        },
      })
    },
    goTrash() {
      try { uni.setStorageSync('browse_tab', 'trash') } catch (e) {}
      uni.switchTab({ url: '/pages/browse/browse' })
    },
    openSimilar(s) {
      if (!s || !s.fid) return
      this.pending = null
      this.scrollTopForReset = 0
      this.scrollTop = 0
      uni.redirectTo({ url: '/pages/detail/detail?fid=' + encodeURIComponent(s.fid) })
    },
    openSource() {
      if (!this.sourceAsset || !this.sourceAsset.fid) return
      this.pending = null
      this.scrollTop = 0
      this.scrollTopForReset = 0
      uni.redirectTo({ url: '/pages/detail/detail?fid=' + encodeURIComponent(this.sourceAsset.fid) })
    },
  },
}
</script>

<style scoped>
.page {
  position: relative;
  height: 100vh;
  background: #f8fafc;
  overflow: hidden;
}
.nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  transition: background 0.24s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.24s ease;
}
.nav.solid {
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(18px);
  box-shadow: 0 1px 0 rgba(226, 232, 240, 0.9);
}
.nav-bar {
  height: 44px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.nav-btn {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(10px);
}
.nav.solid .nav-btn {
  background: #f1f5f9;
}
.nav-btn-hover {
  opacity: 0.72;
}
.nav-icon {
  font-size: 24px;
  line-height: 24px;
  color: #ffffff;
  margin-top: -2px;
}
.nav-icon.trash {
  font-size: 15px;
  margin-top: 0;
}
.nav.solid .nav-icon {
  color: #0f172a;
}
.nav-title {
  max-width: 62%;
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.2s ease, transform 0.2s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nav-title.show {
  opacity: 1;
  transform: translateY(0);
  color: #0f172a;
}
.scroll {
  width: 100%;
}
.hero {
  position: relative;
  overflow: hidden;
  background: #0b1220;
}
.hero-inner {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  transition: transform 0.12s linear;
  will-change: transform;
}
.hero-img {
  width: 100%;
  height: 100%;
  opacity: 0;
  transform: scale(0.94);
  transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.hero-img.loaded {
  opacity: 1;
  transform: scale(1);
}
.hero-video {
  width: 100%;
  height: 100%;
}
.hero-audio {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 50% 35%, #1e293b, #060b14 72%);
}
.audio-disc {
  width: 132px;
  height: 132px;
  border-radius: 66px;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 18px 50px rgba(59, 130, 246, 0.35);
}
.audio-note {
  font-size: 44px;
  color: #ffffff;
}
.audio-title {
  margin-top: 22px;
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  max-width: 78%;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.audio-hint {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}
.hero-ungenerated {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.ungenerated-ratio {
  border: 1.5px dashed rgba(148, 197, 255, 0.55);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(59, 130, 246, 0.08);
}
.frame-9-16 {
  width: 132px;
  height: 235px;
}
.frame-3-4 {
  width: 168px;
  height: 224px;
}
.ungenerated-ratio-t {
  font-size: 13px;
  font-weight: 600;
  color: rgba(191, 219, 254, 0.9);
}
.ungenerated-tip {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.42);
}
.hero-shade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 38%;
  background: linear-gradient(transparent, rgba(8, 13, 24, 0.72));
  pointer-events: none;
}
.hero-pill {
  position: absolute;
  left: 16px;
  bottom: 18px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.92);
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);
}
.hero-pill-t {
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.3px;
}
.hero-hint {
  position: absolute;
  right: 16px;
  bottom: 18px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
.hero-skeleton {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0b1220;
}
.sheet {
  position: relative;
  z-index: 2;
  margin-top: -34px;
  padding: 26px 20px 0;
  border-radius: 26px 26px 0 0;
  background: #f8fafc;
  min-height: 60vh;
}
.head {
  padding-bottom: 4px;
}
.file-name {
  display: block;
  font-size: 17px;
  line-height: 1.35;
  font-weight: 700;
  color: #0f172a;
  word-break: break-all;
}
.meta-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 8px;
  gap: 8px;
}
.meta-t {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
}
.meta-dot {
  font-size: 11px;
  color: #cbd5e1;
}
.tags-text {
  display: block;
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.5;
  color: #3b82f6;
}
.tabs-wrap {
  margin-top: 18px;
}
.tabs-scroll {
  white-space: nowrap;
}
.tabs {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px;
}
.tab {
  flex-shrink: 0;
  padding: 8px 15px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #e7ecf3;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}
.tab:active {
  transform: scale(0.96);
}
.tab.active {
  background: #eaf2fe;
  border-color: #bfdbfe;
}
.tab-t {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}
.tab.active .tab-t {
  color: #1d4ed8;
}
.tab-sub {
  font-size: 9px;
  font-weight: 500;
  color: #94a3b8;
}
.gen-card {
  margin-top: 16px;
  padding: 16px;
  border-radius: 18px;
  background: linear-gradient(135deg, #eff6ff, #f5f3ff);
  border: 1px solid #dbeafe;
}
.gen-title {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: #1e3a8a;
}
.gen-sub {
  display: block;
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.55;
  color: #64748b;
}
.gen-btn {
  margin-top: 13px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 20px rgba(59, 130, 246, 0.28);
}
.gen-btn.disabled {
  opacity: 0.6;
}
.gen-btn-t {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
}
.action-grid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.action {
  min-height: 62px;
  border-radius: 16px;
  background: #ffffff;
  border: 1px solid #e7ecf3;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  transition: transform 0.16s ease, background 0.16s ease;
}
.action:active {
  transform: scale(0.98);
  background: #f8fafc;
}
.action.disabled {
  opacity: 0.5;
}
.action-icon {
  font-size: 18px;
  line-height: 1;
}
.action-t {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
}
.card {
  margin-top: 14px;
  padding: 16px;
  border-radius: 18px;
  background: #ffffff;
  border: 1px solid #eef2f7;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.035);
}
.card-title {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.quality-head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.quality-total {
  font-size: 11px;
  font-weight: 700;
  color: #2563eb;
}
.chev {
  font-size: 11px;
  color: #94a3b8;
}
.quality-bar {
  margin-top: 12px;
  height: 6px;
  border-radius: 4px;
  background: #eef2f7;
  overflow: hidden;
}
.quality-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6);
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.quality-fill.soft {
  background: linear-gradient(90deg, #60a5fa, #a78bfa);
}
.quality-list {
  margin-top: 14px;
}
.quality-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 7px 0;
}
.quality-label {
  width: 74px;
  font-size: 11px;
  color: #334155;
}
.quality-track {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: #eef2f7;
  overflow: hidden;
  margin-right: 8px;
}
.quality-score {
  width: 46px;
  text-align: right;
  font-size: 10px;
  color: #64748b;
}
.quality-detail {
  width: 100%;
  padding-left: 74px;
  font-size: 9px;
  color: #94a3b8;
  margin-top: 2px;
}
.deriv-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.deriv-chip {
  padding: 7px 12px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid #e7ecf3;
  display: flex;
  align-items: center;
  gap: 6px;
}
.deriv-chip.active {
  background: #eaf2fe;
  border-color: #bfdbfe;
}
.deriv-t {
  font-size: 11px;
  font-weight: 600;
  color: #475569;
}
.deriv-chip.active .deriv-t {
  color: #1d4ed8;
}
.deriv-main {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 999px;
  background: #3b82f6;
  color: #ffffff;
}
.source-card {
  display: flex;
  align-items: center;
  gap: 12px;
}
.source-img {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  flex-shrink: 0;
  background: #e2e8f0;
}
.source-info {
  flex: 1;
  min-width: 0;
}
.source-title {
  display: block;
  font-size: 11px;
  color: #94a3b8;
}
.source-name {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-go {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #3b82f6;
}
.similar-scroll {
  margin-top: 12px;
  white-space: nowrap;
}
.similar-row {
  display: inline-flex;
  gap: 8px;
}
.similar-item {
  width: 78px;
  height: 78px;
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
  background: #e2e8f0;
}
.similar-img {
  width: 100%;
  height: 100%;
}
.bottom-space {
  height: calc(28px + env(safe-area-inset-bottom));
}
.state-full {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  box-sizing: border-box;
}
.state-title {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}
.state-t {
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
  text-align: center;
}
.state-row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.state-btn {
  padding: 10px 22px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
}
.state-btn.primary {
  background: #3b82f6;
  border-color: #3b82f6;
}
.state-btn-t {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
}
.state-btn.primary .state-btn-t {
  color: #ffffff;
}
.spinner {
  width: 24px;
  height: 24px;
  border: 2.5px solid #dbeafe;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.spinner.light {
  border-color: rgba(255, 255, 255, 0.18);
  border-top-color: rgba(255, 255, 255, 0.75);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.busy-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.busy-card {
  padding: 22px 30px;
  border-radius: 18px;
  background: #ffffff;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.24);
}
.busy-t {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
</style>
