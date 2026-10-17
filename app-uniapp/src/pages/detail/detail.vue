<template>
  <view class="page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />
    <view class="nav">
      <view class="back-touch-area" @click="goBack">
        <text class="back-icon">‹</text>
        <text class="nav-title">素材详情</text>
      </view>
      <view v-if="item && item.fid" class="nav-btn-box nav-del-box" @click="confirmDelete">
        <text class="nav-del-btn">删除</text>
      </view>
    </view>

    <scroll-view scroll-y class="scroll">
      <view v-if="loading" class="state-box">
        <text class="state-t">加载中…</text>
      </view>
      <view v-else-if="errorText" class="state-box">
        <text class="state-t err">{{ errorText }}</text>
        <view class="state-btn" @click="load"><text class="state-btn-t">重试</text></view>
      </view>
      <view v-else-if="item" class="detail-body">
        <image
          class="hero-img"
          :src="heroUrl"
          :mode="item.isPortrait || item.isFurniture ? 'aspectFit' : 'aspectFill'"
          @error="onImgError"
        />

        <view class="meta-card">
          <text class="file-name">{{ item.fileName || item.fid }}</text>
          <text class="meta-line">{{ item.width }}×{{ item.height }}<template v-if="item.size"> · {{ sizeText }}</template></text>
          <text v-if="item.tagsText" class="tags-text">{{ item.tagsText }}</text>
        </view>

        <view class="action-row">
          <view class="action-btn primary" @click="goEditor">
            <text class="action-t">AI 精修</text>
          </view>
          <view class="action-btn" @click="download">
            <text class="action-t">下载</text>
          </view>
        </view>

        <view v-if="derivatives && derivatives.length" class="deriv-card">
          <text class="sec-title">衍生版本</text>
          <view v-for="d in derivatives" :key="d.id || d.kind" class="deriv-row">
            <text class="deriv-kind">{{ d.kind || d.id }}</text>
            <text class="deriv-size" v-if="d.width">{{ d.width }}×{{ d.height }}</text>
          </view>
        </view>

        <view v-if="similar && similar.length" class="similar-card">
          <text class="sec-title">相似推荐</text>
          <scroll-view scroll-x class="similar-scroll">
            <view class="similar-row">
              <view v-for="s in similar" :key="s.fid" class="similar-item" @click="openSimilar(s)">
                <image class="similar-img" :src="s.thumbSrc || s.imgUrl" mode="aspectFill" />
              </view>
            </view>
          </scroll-view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { fetchDetail, deleteAsset, mediaUrl, videoUrl, posterUrl, downloadAndSaveToAlbum } from '../../service/ViewerApi'
import { mapServerDetail } from '../../common/assetMap'

export default {
  data() {
    return {
      statusBarHeight: 20,
      fid: '',
      item: null,
      loading: true,
      errorText: '',
      derivatives: [],
      similar: [],
    }
  },
  computed: {
    heroUrl() {
      if (!this.item) return ''
      return this.item.imgUrl || this.item.thumbSrc || this.item.serverUrl || ''
    },
    sizeText() {
      const s = this.item && this.item.size
      if (!s) return ''
      return (s / 1024 / 1024).toFixed(1) + ' MB'
    },
  },
  onLoad(opts) {
    try { this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20 } catch (e) {}
    this.fid = opts.fid || ''
    this.load()
  },
  methods: {
    goBack() { uni.navigateBack() },
    async load() {
      if (!this.fid) { this.errorText = '缺少素材 ID'; this.loading = false; return }
      this.loading = true
      this.errorText = ''
      try {
        const data = await fetchDetail(this.fid)
        const mapped = mapServerDetail(data)
        this.item = mapped
        this.derivatives = mapped.derivatives || []
        this.similar = mapped.similar || []
      } catch (e) {
        this.errorText = (e && e.message) || '加载失败'
      } finally {
        this.loading = false
      }
    },
    onImgError() {
      if (this.item && this.item.serverUrl && this.item.imgUrl !== this.item.serverUrl) {
        this.item.imgUrl = this.item.serverUrl
      }
    },
    goEditor() {
      if (!this.item) return
      uni.navigateTo({
        url: '/pages/editor/editor?fid=' + encodeURIComponent(this.item.fid),
      })
    },
    async download() {
      if (!this.item) return
      try {
        const url = this.item.serverUrl || this.item.imgUrl
        await downloadAndSaveToAlbum({ url, fileName: this.item.fileName, isVideo: this.item.isVideo, isAudio: this.item.isMusic })
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        uni.showToast({ title: e.message || '保存失败', icon: 'none' })
      }
    },
    confirmDelete() {
      if (!this.item) return
      uni.showModal({
        title: '删除素材',
        content: '将从素材库删除并加入黑名单，下次同步不会再入库。确定？',
        confirmColor: '#DC2626',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deleteAsset(this.item.fid)
            uni.showToast({ title: '已删除并拉黑', icon: 'none' })
            setTimeout(() => uni.navigateBack(), 800)
          } catch (e) {
            uni.showToast({ title: '删除失败: ' + (e.message || e), icon: 'none' })
          }
        },
      })
    },
    openSimilar(s) {
      if (!s || !s.fid) return
      uni.redirectTo({ url: '/pages/detail/detail?fid=' + encodeURIComponent(s.fid) })
    },
  },
}
</script>

<style scoped>
.page { min-height: 100vh; background: #f8fafc; }
.status-bar { flex-shrink: 0; }
.nav { display: flex; align-items: center; justify-content: space-between; padding: 12rpx 24rpx; background: #fff; border-bottom: 1rpx solid #e2e8f0; }
.back-touch-area { display: flex; align-items: center; }
.back-icon { font-size: 44rpx; color: #0f172a; margin-right: 8rpx; }
.nav-title { font-size: 30rpx; font-weight: 700; color: #0f172a; }
.nav-del-btn { font-size: 24rpx; color: #dc2626; font-weight: 600; padding: 8rpx 16rpx; }
.scroll { width: 100%; }
.state-box { padding: 120rpx 40rpx; display: flex; flex-direction: column; align-items: center; gap: 24rpx; }
.state-t { font-size: 28rpx; color: #64748b; }
.state-t.err { color: #dc2626; }
.state-btn { padding: 16rpx 40rpx; border-radius: 999rpx; background: #2563eb; }
.state-btn-t { color: #fff; font-size: 26rpx; }
.detail-body { padding: 20rpx 24rpx 60rpx; }
.hero-img { width: 100%; height: 560rpx; border-radius: 20rpx; background: #e2e8f0; }
.meta-card { background: #fff; border-radius: 20rpx; padding: 24rpx; margin-top: 20rpx; border: 1rpx solid #e2e8f0; }
.file-name { display: block; font-size: 28rpx; font-weight: 700; color: #0f172a; word-break: break-all; }
.meta-line { display: block; margin-top: 8rpx; font-size: 22rpx; color: #64748b; }
.tags-text { display: block; margin-top: 12rpx; font-size: 22rpx; color: #2563eb; }
.action-row { display: flex; gap: 16rpx; margin-top: 20rpx; }
.action-btn { flex: 1; height: 88rpx; border-radius: 44rpx; background: #fff; border: 1rpx solid #e2e8f0; display: flex; align-items: center; justify-content: center; }
.action-btn.primary { background: #2563eb; border-color: #2563eb; }
.action-t { font-size: 26rpx; font-weight: 600; color: #0f172a; }
.action-btn.primary .action-t { color: #fff; }
.deriv-card, .similar-card { background: #fff; border-radius: 20rpx; padding: 24rpx; margin-top: 20rpx; border: 1rpx solid #e2e8f0; }
.sec-title { display: block; font-size: 24rpx; font-weight: 700; color: #0f172a; margin-bottom: 12rpx; }
.deriv-row { display: flex; justify-content: space-between; padding: 12rpx 0; border-bottom: 1rpx solid #f1f5f9; }
.deriv-kind { font-size: 22rpx; color: #0f172a; }
.deriv-size { font-size: 20rpx; color: #94a3b8; }
.similar-scroll { white-space: nowrap; }
.similar-row { display: flex; gap: 12rpx; }
.similar-item { width: 160rpx; height: 160rpx; border-radius: 12rpx; overflow: hidden; flex-shrink: 0; }
.similar-img { width: 100%; height: 100%; }
</style>
