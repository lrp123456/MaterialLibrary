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
      <view v-if="mode === 'local'" class="dep-tip">
        <text class="dep-tip-t">本地超分依赖 Android 原生推理插件（仅 Android 生效）；未启用时由云端增强流程承接。</text>
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
import { handoffGlobalEdit } from '../../common/handoff'

export default {
  data() {
    return {
      statusBarHeight: 20, fid: '', derivId: '', imgUrl: '',
      mode: 'local', scale: 2,
      modes: [{ key: 'local', label: '本地超分 · 需原生插件' }, { key: 'cloud', label: '云端重绘' }],
      scales: [2, 4], submitting: false,
    }
  },
  onLoad(opts) {
    try { this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20 } catch (e) {}
    this.fid = opts.fid || ''
    this.derivId = opts.derivId ? decodeURIComponent(opts.derivId) : ''
    this.imgUrl = opts.imgUrl ? decodeURIComponent(opts.imgUrl) : ''
  },
  methods: {
    goBack() { uni.navigateBack() },
    async submitTask() {
      if (!this.imgUrl || this.submitting) return
      this.submitting = true
      handoffGlobalEdit({
        fid: this.fid,
        derivId: this.derivId,
        imgUrl: this.imgUrl,
        op: 'clarity',
        recipe: this.mode === 'cloud'
          ? `请对参考图进行云端重绘级清晰度增强，提升到 ${this.scale}x 细节。`
          : `请对参考图进行 ${this.scale}x 清晰度增强，保持原构图与色彩。`,
        recipeHint: `${this.mode === 'cloud' ? '云端重绘' : '本地超分（需原生插件）'} · ${this.scale}x`,
        scale: this.scale,
        globalParams: { mode: this.mode, scale: this.scale },
      })
      this.submitting = false
    },
  },
}
</script>

<style scoped>
.quick-page { display: flex; flex-direction: column; height: 100vh; background: #F8FAFC; }
.nav-bar { display: flex; align-items: center; padding: 10px 16px; background: #FFFFFF; border-bottom: 1rpx solid #E7ECF3; }
.nav-left { display: flex; align-items: center; }
.back-icon { font-size: 28px; color: #0F172A; margin-right: 8px; line-height: 1; }
.nav-title { font-size: 17px; font-weight: 600; color: #0F172A; }
.preview-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px; min-height: 0; }
.preview-img { width: 100%; height: 100%; border-radius: 16px; }
.preview-empty { padding: 40px; }
.preview-empty-t { color: #94A3B8; font-size: 14px; }
.bottom-panel { background: #FFFFFF; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); border-radius: 20px 20px 0 0; border-top: 1rpx solid #E7ECF3; }
.options-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px; }
.option-label { font-size: 13px; color: #334155; }
.dep-tip { background: #EAF2FE; border-radius: 10px; padding: 9px 11px; margin-bottom: 14px; }
.dep-tip-t { font-size: 11px; line-height: 1.55; color: #475569; }
.ratio-row { display: flex; flex-wrap: wrap; gap: 8px; }
.ratio-chip { padding: 6px 12px; border-radius: 999px; background: #F1F5F9; border: 1rpx solid #E7ECF3; }
.ratio-chip.active { background: #EAF2FE; border-color: #BFDBFE; }
.ratio-t { font-size: 12px; color: #475569; }
.ratio-chip.active .ratio-t { color: #1D4ED8; font-weight: 600; }
.submit-btn { background: linear-gradient(135deg, #3B82F6, #6366F1); border-radius: 24px; padding: 14px 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(59,130,246,.25); }
.submit-btn.disabled { opacity: .5; }
.submit-text { font-size: 15px; font-weight: 600; color: #FFFFFF; }
</style>
