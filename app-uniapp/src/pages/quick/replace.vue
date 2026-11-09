<template>
  <view class="quick-page">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-left" @click="goBack">
        <text class="back-icon">‹</text>
        <text class="nav-title">原位替换</text>
      </view>
    </view>
    <view class="selector-wrap">
      <TouchSelector v-if="imgUrl" :img-url="imgUrl" default-mode="rect" :viewport-height="viewportH" @change="onSelectionChange" />
    </view>
    <view class="bottom-panel">
      <view class="options-row">
        <text class="option-label">替换成什么</text>
        <input class="text-input" v-model="prompt" placeholder="如：换成胡桃木茶几 / 换成米色地毯" />
      </view>
      <view class="options-row">
        <text class="option-label">局部精准贴回原图</text>
        <switch :checked="pasteback" color="#2563EB" @change="pasteback = $event.detail.value" />
      </view>
      <view class="submit-btn" :class="{ disabled: !hasSelection || !prompt || submitting }" @click="submitTask">
        <text class="submit-text">{{ submitting ? '提交中...' : (hasSelection && prompt ? '开始替换' : '请框选区域并填写描述') }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import TouchSelector from '../../components/TouchSelector.vue'
import { handoffPreciseEdit } from '../../common/handoff'

export default {
  components: { TouchSelector },
  data() {
    return {
      statusBarHeight: 20, viewportH: 480, fid: '', derivId: '', imgUrl: '',
      hasSelection: false, selectionData: null, prompt: '',
      pasteback: true, submitting: false,
    }
  },
  onLoad(opts) {
    try {
      const sys = uni.getSystemInfoSync()
      this.statusBarHeight = sys.statusBarHeight || 20
      this.viewportH = (sys.windowHeight || 667) - this.statusBarHeight - 50 - 180
    } catch (e) {}
    this.fid = opts.fid || ''
    this.derivId = opts.derivId ? decodeURIComponent(opts.derivId) : ''
    this.imgUrl = opts.imgUrl ? decodeURIComponent(opts.imgUrl) : ''
  },
  methods: {
    goBack() { uni.navigateBack() },
    onSelectionChange(data) { this.hasSelection = data.hasSelection; this.selectionData = data },
    async submitTask() {
      if (!this.hasSelection || !this.prompt || this.submitting) return
      this.submitting = true
      handoffPreciseEdit({
        fid: this.fid,
        derivId: this.derivId,
        imgUrl: this.imgUrl,
        op: 'replace',
        recipe: `将选区内的物体替换为：${this.prompt}。保持原图构图、透视与光照一致。`,
        recipeHint: `替换为：${this.prompt}`,
        productName: this.prompt,
        selection: this.selectionData,
        pasteback: this.pasteback,
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
.selector-wrap { flex: 1; min-height: 0; padding: 12px; }
.bottom-panel { background: #FFFFFF; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); border-radius: 20px 20px 0 0; border-top: 1rpx solid #E7ECF3; }
.options-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 12px; }
.option-label { font-size: 13px; color: #334155; flex-shrink: 0; }
.text-input { flex: 1; height: 36px; background: #F8FAFC; border: 1rpx solid #E7ECF3; border-radius: 10px; padding: 0 12px; color: #0F172A; font-size: 13px; }
.submit-btn { background: linear-gradient(135deg, #3B82F6, #6366F1); border-radius: 24px; padding: 14px 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(59,130,246,.25); }
.submit-btn.disabled { opacity: .5; }
.submit-text { font-size: 15px; font-weight: 600; color: #FFFFFF; }
</style>
