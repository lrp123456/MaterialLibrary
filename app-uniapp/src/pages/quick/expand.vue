<template>
  <view class="quick-page">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-left" @click="goBack">
        <text class="back-icon">‹</text>
        <text class="nav-title">扩图</text>
      </view>
    </view>
    <view class="preview-wrap">
      <image v-if="imgUrl" class="preview-img" :src="imgUrl" mode="aspectFit" />
      <view v-else class="preview-empty"><text class="preview-empty-t">未选择图片</text></view>
    </view>
    <view class="bottom-panel">
      <view class="options-row">
        <text class="option-label">扩展比例</text>
        <view class="ratio-row">
          <view v-for="r in ratios" :key="r" class="ratio-chip" :class="{ active: ratio === r }" @click="ratio = r">
            <text class="ratio-t">{{ r }}</text>
          </view>
        </view>
      </view>
      <view class="submit-btn" :class="{ disabled: !imgUrl || submitting }" @click="submitTask">
        <text class="submit-text">{{ submitting ? '提交中...' : '开始扩图' }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { handoffPreciseEdit } from '../../common/handoff'
import { fieldOf } from '../../service/QuickParams'

export default {
  data() {
    return {
      statusBarHeight: 20, fid: '', derivId: '', imgUrl: '', ratio: '',
      ratios: [],
      submitting: false,
    }
  },
  onLoad(opts) {
    try { this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20 } catch (e) {}
    this.fid = opts.fid || ''
    this.derivId = opts.derivId ? decodeURIComponent(opts.derivId) : ''
    this.imgUrl = opts.imgUrl ? decodeURIComponent(opts.imgUrl) : ''
    fieldOf('image', 'ratio').then((f) => {
      if (!f) return
      this.ratios = Array.isArray(f.options) ? f.options : []
      this.ratio = opts.ratio || f.default || this.ratios[0] || ''
    })
  },
  methods: {
    goBack() { uni.navigateBack() },
    async submitTask() {
      if (!this.imgUrl || this.submitting) return
      this.submitting = true
      handoffPreciseEdit({
        fid: this.fid,
        derivId: this.derivId,
        imgUrl: this.imgUrl,
        op: 'expand',
        recipe: this.ratio
          ? `将画面扩展到 ${this.ratio} 画幅，智能延展背景并保持主体完整。`
          : '智能扩展画面，延展背景并保持主体完整。',
        recipeHint: this.ratio ? `扩图至 ${this.ratio}` : '智能扩图',
        expandRatio: this.ratio || undefined,
        expandRatios: this.ratio ? [this.ratio] : undefined,
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
.ratio-row { display: flex; flex-wrap: wrap; gap: 8px; }
.ratio-chip { padding: 6px 12px; border-radius: 999px; background: #F1F5F9; border: 1rpx solid #E7ECF3; }
.ratio-chip.active { background: #EAF2FE; border-color: #BFDBFE; }
.ratio-t { font-size: 12px; color: #475569; }
.ratio-chip.active .ratio-t { color: #1D4ED8; font-weight: 600; }
.submit-btn { background: linear-gradient(135deg, #3B82F6, #6366F1); border-radius: 24px; padding: 14px 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(59,130,246,.25); }
.submit-btn.disabled { opacity: .5; }
.submit-text { font-size: 15px; font-weight: 600; color: #FFFFFF; }
</style>
