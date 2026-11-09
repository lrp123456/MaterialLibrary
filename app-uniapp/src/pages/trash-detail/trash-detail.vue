<template>
  <view class="page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />
    <view class="nav">
      <view class="nav-back" hover-class="nav-back-hover" @click="goBack"><text class="nav-back-icon">‹</text></view>
      <text class="nav-title">回收站详情</text>
      <view class="nav-back placeholder" />
    </view>

    <view v-if="loading" class="state-box">
      <view class="loading-spinner" />
      <text class="state-text">正在读取回收站记录…</text>
    </view>

    <view v-else-if="errorText" class="state-box" @click="load">
      <text class="state-title">无法打开</text>
      <text class="state-sub">{{ errorText }}</text>
      <text class="state-link">点击重试</text>
    </view>

    <scroll-view v-else scroll-y class="body">
      <view class="hero" :class="{ soon: detail.expiringSoon }" @click="previewImage">
        <image
          v-if="previewUrl && !imgFailed"
          class="hero-img"
          :src="previewUrl"
          mode="aspectFill"
          @error="onImgError"
        />
        <view v-else class="hero-placeholder">
          <text class="hero-placeholder-text">{{ fileExt }}</text>
        </view>
        <view class="hero-mask">
          <text class="hero-name">{{ detail.fileName }}</text>
          <text class="hero-sub">{{ detail.tagsText || '未打标签' }}</text>
        </view>
      </view>

      <view class="card">
        <view class="card-head">
          <text class="card-title">为何进入回收站</text>
          <text class="remain-pill" :class="{ soon: detail.expiringSoon }">{{ remainText }}</text>
        </view>
        <view class="reason-row">
          <text class="reason-chip">{{ detail.disposeLabel || '主动删除' }}</text>
          <text class="reason-time">{{ deleteTimeText }}</text>
        </view>
        <text class="reason-detail">{{ detail.disposeDetail || detail.disposeCriterion || '没有更多判定说明' }}</text>
        <text v-if="detail.disposeDetail && detail.disposeCriterion" class="reason-criterion">判定标准：{{ detail.disposeCriterion }}</text>
      </view>

      <view class="card">
        <text class="card-title">素材信息</text>
        <view class="meta-row"><text class="meta-key">类型</text><text class="meta-val">{{ typeText }}</text></view>
        <view class="meta-row"><text class="meta-key">尺寸</text><text class="meta-val">{{ sizeText }}</text></view>
        <view class="meta-row"><text class="meta-key">文件大小</text><text class="meta-val">{{ fileSizeText }}</text></view>
        <view class="meta-row"><text class="meta-key">删除时间</text><text class="meta-val">{{ deleteTimeText }}</text></view>
        <view class="meta-row"><text class="meta-key">衍生版本</text><text class="meta-val">{{ detail.deletedDerivCount || 0 }} 个</text></view>
        <view class="meta-row"><text class="meta-key">恢复期限</text><text class="meta-val">{{ remainText }}</text></view>
      </view>

      <view v-if="!detail.restoreReady" class="warn-card">
        <text class="warn-title">源文件已不可用</text>
        <text class="warn-sub">该素材的本地/云端文件已被清理，只能留在回收站查看记录，无法恢复。</text>
      </view>

      <view class="tips">
        恢复后素材会回到素材库；彻底粉碎会永久删除，不可撤销。
      </view>
      <view class="bottom-space" />
    </scroll-view>

    <view v-if="!loading && !errorText" class="action-bar">
      <view
        class="btn ghost"
        :class="{ disabled: !detail.restoreReady }"
        hover-class="btn-hover"
        @click="onRestore"
      >
        <text class="btn-text">恢复素材</text>
      </view>
      <view class="btn danger" hover-class="btn-hover" @click="onPurge">
        <text class="btn-text">彻底粉碎</text>
      </view>
    </view>
  </view>
</template>

<script>
import {
  fetchTrashDetail,
  restoreTrashAsset,
  purgeTrashAsset,
  mediaUrl,
  posterUrl,
} from '../../service/ViewerApi'

export default {
  data() {
    return {
      statusBarHeight: 20,
      loading: true,
      errorText: '',
      fid: '',
      detail: {},
      imgFailed: false,
    }
  },
  computed: {
    previewUrl() {
      if (!this.detail || !this.detail.fid) return ''
      return this.detail.kind === 'video' ? posterUrl(this.detail.fid) : mediaUrl(this.detail.fid)
    },
    fileExt() {
      const name = (this.detail && this.detail.fileName) || ''
      const idx = name.lastIndexOf('.')
      return (idx > -1 ? name.slice(idx + 1) : 'FILE').slice(0, 4).toUpperCase()
    },
    remainText() {
      const h = Number(this.detail && this.detail.remainingHours) || 0
      if (h <= 0) return '即将清理'
      if (h < 24) return `剩 ${h} 小时`
      const days = Math.ceil(h / 24)
      return `剩 ${days} 天`
    },
    deleteTimeText() {
      const ts = this.detail && this.detail.deletedAt
      if (!ts) return '未知'
      const d = new Date(ts)
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    },
    typeText() {
      const kind = this.detail && this.detail.kind
      if (kind === 'video') return '视频'
      if (kind === 'audio') return '音频'
      return '图片'
    },
    sizeText() {
      const w = Number(this.detail && this.detail.width) || 0
      const h = Number(this.detail && this.detail.height) || 0
      return w && h ? `${w} × ${h}` : '未知'
    },
    fileSizeText() {
      const n = Number(this.detail && this.detail.size) || 0
      if (!n) return '未知'
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    },
  },
  onLoad(options = {}) {
    const sys = uni.getSystemInfoSync()
    this.statusBarHeight = sys.statusBarHeight || 20
    this.fid = decodeURIComponent((options && options.fid) || '')
    if (!this.fid) {
      this.loading = false
      this.errorText = '缺少素材编号'
      return
    }
    this.load()
  },
  methods: {
    async load() {
      this.loading = true
      this.errorText = ''
      this.imgFailed = false
      try {
        const data = await fetchTrashDetail(this.fid)
        this.detail = data || {}
      } catch (e) {
        this.errorText = (e && e.message) || '读取失败'
      } finally {
        this.loading = false
      }
    },
    goBack() {
      uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/browse/browse' }) })
    },
    onImgError() {
      this.imgFailed = true
    },
    previewImage() {
      if (!this.previewUrl || this.imgFailed) return
      uni.previewImage({ urls: [this.previewUrl], current: this.previewUrl })
    },
    onRestore() {
      if (!this.detail || !this.detail.restoreReady) {
        uni.showToast({ title: '源文件已清理，无法恢复', icon: 'none' })
        return
      }
      uni.showModal({
        title: '恢复素材',
        content: `将「${this.detail.fileName || this.fid}」恢复到素材库。`,
        confirmText: '恢复',
        confirmColor: '#3B82F6',
        success: async (res) => {
          if (!res.confirm) return
          uni.showLoading({ title: '恢复中…', mask: true })
          try {
            const out = await restoreTrashAsset(this.fid)
            uni.hideLoading()
            const fail = (out.failed || []).find((f) => f.fid === this.fid)
            if (fail) {
              uni.showToast({ title: '恢复失败: ' + (fail.error || '未知原因'), icon: 'none' })
              return
            }
            uni.showToast({ title: '已恢复到素材库', icon: 'none' })
            setTimeout(() => this.goBack(), 700)
          } catch (e) {
            uni.hideLoading()
            uni.showToast({ title: '恢复失败: ' + ((e && e.message) || e), icon: 'none' })
          }
        },
      })
    },
    onPurge() {
      uni.showModal({
        title: '彻底粉碎',
        content: `将永久删除「${(this.detail && this.detail.fileName) || this.fid}」，不可恢复。`,
        confirmText: '粉碎',
        confirmColor: '#F43F5E',
        success: async (res) => {
          if (!res.confirm) return
          uni.showLoading({ title: '粉碎中…', mask: true })
          try {
            const out = await purgeTrashAsset(this.fid)
            uni.hideLoading()
            const fail = (out.failed || []).find((f) => f.fid === this.fid)
            if (fail) {
              uni.showToast({ title: '粉碎失败: ' + (fail.error || '未知原因'), icon: 'none' })
              return
            }
            uni.showToast({ title: '已彻底粉碎', icon: 'none' })
            setTimeout(() => this.goBack(), 700)
          } catch (e) {
            uni.hideLoading()
            uni.showToast({ title: '粉碎失败: ' + ((e && e.message) || e), icon: 'none' })
          }
        },
      })
    },
  },
}
</script>

<style scoped>
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  overflow: hidden;
}
.status-bar {
  background: #f8fafc;
  flex-shrink: 0;
}
.nav {
  height: 88rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.nav-back {
  width: 64rpx;
  height: 64rpx;
  border-radius: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  box-shadow: 0 2rpx 8rpx rgba(15, 23, 42, 0.06);
}
.nav-back.placeholder {
  background: transparent;
  box-shadow: none;
}
.nav-back-hover {
  background: #eef4fb;
}
.nav-back-icon {
  font-size: 40rpx;
  line-height: 40rpx;
  color: #0f172a;
  margin-top: -4rpx;
}
.nav-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.5rpx;
}
.body {
  flex: 1;
  min-height: 0;
  padding: 0 28rpx;
  box-sizing: border-box;
}
.hero {
  position: relative;
  margin-top: 8rpx;
  width: 100%;
  height: 420rpx;
  border-radius: 24rpx;
  overflow: hidden;
  background: #e2e8f0;
  box-shadow: 0 10rpx 30rpx rgba(15, 23, 42, 0.12);
}
.hero-img {
  width: 100%;
  height: 100%;
  display: block;
}
.hero-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #b0c4c8, #5f7f88);
}
.hero-placeholder-text {
  color: rgba(255, 255, 255, 0.75);
  font-size: 32rpx;
  font-weight: 700;
  letter-spacing: 4rpx;
}
.hero-mask {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 60rpx 24rpx 22rpx;
  background: linear-gradient(transparent, rgba(15, 23, 42, 0.8));
}
.hero-name {
  display: block;
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hero-sub {
  display: block;
  color: rgba(255, 255, 255, 0.72);
  font-size: 22rpx;
  margin-top: 6rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hero.soon {
  box-shadow: 0 10rpx 30rpx rgba(244, 63, 94, 0.24);
}
.card {
  margin-top: 20rpx;
  padding: 24rpx;
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(15, 23, 42, 0.05);
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-title {
  font-size: 26rpx;
  font-weight: 700;
  color: #0f172a;
}
.remain-pill {
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: #eaf2fe;
  color: #2563eb;
  font-size: 20rpx;
  font-weight: 600;
}
.remain-pill.soon {
  background: #fef2f2;
  color: #dc2626;
}
.reason-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16rpx;
}
.reason-chip {
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: #fff1f2;
  color: #e11d48;
  font-size: 22rpx;
  font-weight: 600;
}
.reason-time {
  font-size: 20rpx;
  color: #94a3b8;
}
.reason-detail {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  line-height: 1.65;
  color: #334155;
  word-break: break-all;
}
.reason-criterion {
  display: block;
  margin-top: 12rpx;
  font-size: 21rpx;
  line-height: 1.55;
  color: #94a3b8;
}
.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f1f5f9;
}
.meta-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.meta-key {
  font-size: 23rpx;
  color: #64748b;
}
.meta-val {
  font-size: 23rpx;
  color: #0f172a;
  font-weight: 500;
  max-width: 60%;
  text-align: right;
}
.warn-card {
  margin-top: 20rpx;
  padding: 22rpx 24rpx;
  background: #fff7ed;
  border: 1rpx solid #fed7aa;
  border-radius: 20rpx;
}
.warn-title {
  display: block;
  font-size: 24rpx;
  font-weight: 700;
  color: #c2410c;
}
.warn-sub {
  display: block;
  margin-top: 8rpx;
  font-size: 21rpx;
  line-height: 1.55;
  color: #9a3412;
}
.tips {
  margin-top: 22rpx;
  font-size: 20rpx;
  line-height: 1.6;
  color: #94a3b8;
  padding: 0 6rpx;
}
.bottom-space {
  height: 40rpx;
}
.action-bar {
  flex-shrink: 0;
  padding: 16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom));
  background: rgba(248, 250, 252, 0.94);
  border-top: 1rpx solid #e7ecf3;
  display: flex;
  gap: 16rpx;
}
.btn {
  flex: 1;
  height: 88rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-hover {
  opacity: 0.86;
}
.btn.ghost {
  background: #ffffff;
  border: 1rpx solid #dbe4f0;
}
.btn.ghost .btn-text {
  color: #1d4ed8;
}
.btn.danger {
  background: linear-gradient(135deg, #f43f5e, #e11d48);
  box-shadow: 0 8rpx 20rpx rgba(244, 63, 94, 0.28);
}
.btn.danger .btn-text {
  color: #ffffff;
}
.btn.disabled {
  opacity: 0.45;
}
.btn-text {
  font-size: 27rpx;
  font-weight: 700;
  color: #ffffff;
}
.state-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80rpx;
}
.loading-spinner {
  width: 44rpx;
  height: 44rpx;
  border: 4rpx solid #dbeafe;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.state-text {
  margin-top: 18rpx;
  font-size: 24rpx;
  color: #64748b;
}
.state-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #0f172a;
}
.state-sub {
  margin-top: 12rpx;
  font-size: 23rpx;
  line-height: 1.55;
  color: #94a3b8;
  text-align: center;
}
.state-link {
  margin-top: 20rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: #2563eb;
}
</style>
