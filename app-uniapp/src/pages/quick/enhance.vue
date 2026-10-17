<template>
  <view class="quick-page">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-left" @click="goBack">
        <text class="back-icon">‹</text>
        <text class="nav-title">清晰度增强</text>
      </view>
    </view>
    <view class="preview-wrap">
      <image v-if="imgUrl" class="preview-img" :src="imgUrl" mode="aspectFit" />
      <view v-else class="preview-empty"><text class="preview-empty-t">未选择图片</text></view>
    </view>
    <view class="bottom-panel">
      <view class="options-row">
        <text class="option-label">增强方式</text>
        <view class="ratio-row">
          <view v-for="m in modes" :key="m.key" class="ratio-chip" :class="{ active: mode === m.key }" @click="mode = m.key">
            <text class="ratio-t">{{ m.label }}</text>
          </view>
        </view>
      </view>
      <view class="options-row">
        <text class="option-label">放大倍数</text>
        <view class="ratio-row">
          <view v-for="s in scales" :key="s" class="ratio-chip" :class="{ active: scale === s }" @click="scale = s">
            <text class="ratio-t">{{ s }}x</text>
          </view>
        </view>
      </view>
      <view class="submit-btn" :class="{ disabled: !imgUrl || submitting }" @click="submitTask">
        <text class="submit-text">{{ submitting ? '提交中...' : '开始增强清晰度' }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { aiTaskManager } from '../../service/AiTaskManager'

export default {
  data() {
    return {
      statusBarHeight: 20, fid: '', imgUrl: '',
      mode: 'local', scale: 2,
      modes: [{ key: 'local', label: '本地 2x/4x' }, { key: 'cloud', label: '云端重绘' }],
      scales: [2, 4], submitting: false,
    }
  },
  onLoad(opts) {
    try { this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20 } catch (e) {}
    this.fid = opts.fid || ''
    this.imgUrl = opts.imgUrl ? decodeURIComponent(opts.imgUrl) : ''
  },
  methods: {
    goBack() { uni.navigateBack() },
    async submitTask() {
      if (!this.imgUrl || this.submitting) return
      this.submitting = true
      try {
        await aiTaskManager.createTask({
          fid: this.fid, type: 'enhance', title: '清晰度增强',
          payload: { mode: 'enhance', sub_mode: this.mode, scale: this.scale, image: this.imgUrl },
        })
        uni.showToast({ title: '已提交增强任务', icon: 'success' })
        setTimeout(() => this.goBack(), 1200)
      } catch (e) {
        uni.showToast({ title: e.message || '提交失败', icon: 'none' })
      } finally { this.submitting = false }
    },
  },
}
</script>

<style scoped>
.quick-page { display: flex; flex-direction: column; height: 100vh; background: #0F172A; }
.nav-bar { display: flex; align-items: center; padding: 10px 16px; background: #1E293B; }
.nav-left { display: flex; align-items: center; }
.back-icon { font-size: 28px; color: #FFF; margin-right: 8px; line-height: 1; }
.nav-title { font-size: 17px; font-weight: 600; color: #FFF; }
.preview-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px; min-height: 0; }
.preview-img { width: 100%; height: 100%; }
.preview-empty { padding: 40px; }
.preview-empty-t { color: #64748B; font-size: 14px; }
.bottom-panel { background: #1E293B; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); border-radius: 20px 20px 0 0; }
.options-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px; }
.option-label { font-size: 14px; color: #E2E8F0; }
.ratio-row { display: flex; flex-wrap: wrap; gap: 8px; }
.ratio-chip { padding: 6px 12px; border-radius: 999px; background: #334155; }
.ratio-chip.active { background: #2563EB; }
.ratio-t { font-size: 12px; color: #E2E8F0; }
.submit-btn { background: #2563EB; border-radius: 24px; padding: 14px 0; display: flex; align-items: center; justify-content: center; }
.submit-btn.disabled { opacity: .5; }
.submit-text { font-size: 16px; font-weight: 600; color: #FFF; }
</style>
