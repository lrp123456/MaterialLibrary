<template>
  <view class="quick-page">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-left" @click="goBack">
        <text class="back-icon">‹</text>
        <text class="nav-title">软装置入</text>
      </view>
    </view>
    <view class="selector-wrap">
      <TouchSelector v-if="imgUrl" :img-url="imgUrl" default-mode="rect" :viewport-height="viewportH" @change="onSelectionChange" />
    </view>
    <view class="bottom-panel">
      <view class="options-row">
        <text class="option-label">置入物体描述</text>
        <input class="text-input" v-model="prompt" placeholder="如：一株绿植 / 北欧风单人沙发" />
      </view>
      <view class="options-row">
        <text class="option-label">局部精准贴回原图</text>
        <switch :checked="pasteback" color="#2563EB" @change="pasteback = $event.detail.value" />
      </view>
      <view class="submit-btn" :class="{ disabled: !hasSelection || !prompt || submitting }" @click="submitTask">
        <text class="submit-text">{{ submitting ? '提交中...' : (hasSelection && prompt ? '开始置入' : '请框选区域并填写描述') }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import TouchSelector from '../../components/TouchSelector.vue'
import { aiTaskManager } from '../../service/AiTaskManager'

export default {
  components: { TouchSelector },
  data() {
    return {
      statusBarHeight: 20, viewportH: 480, fid: '', imgUrl: '',
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
    this.imgUrl = opts.imgUrl ? decodeURIComponent(opts.imgUrl) : ''
  },
  methods: {
    goBack() { uni.navigateBack() },
    onSelectionChange(data) { this.hasSelection = data.hasSelection; this.selectionData = data },
    async submitTask() {
      if (!this.hasSelection || !this.prompt || this.submitting) return
      this.submitting = true
      try {
        const payload = {
          mode: 'insert', sub_mode: 'insert', pasteback: this.pasteback,
          prompt: this.prompt, image: this.imgUrl,
        }
        if (this.selectionData && this.selectionData.pixelRect) {
          const r = this.selectionData.pixelRect
          payload.coord_unit = 'px'
          payload.x1 = r.x; payload.y1 = r.y
          payload.x2 = r.x + r.w; payload.y2 = r.y + r.h
        }
        await aiTaskManager.createTask({
          fid: this.fid, type: 'insert', title: '软装置入', payload,
        })
        uni.showToast({ title: '已提交任务', icon: 'success' })
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
.selector-wrap { flex: 1; width: 100%; }
.bottom-panel { background: #1E293B; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); border-radius: 20px 20px 0 0; }
.options-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 12px; }
.option-label { font-size: 14px; color: #E2E8F0; flex-shrink: 0; }
.text-input { flex: 1; height: 36px; background: #334155; border-radius: 10px; padding: 0 12px; color: #F8FAFC; font-size: 13px; }
.submit-btn { background: #2563EB; border-radius: 24px; padding: 14px 0; display: flex; align-items: center; justify-content: center; }
.submit-btn.disabled { opacity: .5; }
.submit-text { font-size: 16px; font-weight: 600; color: #FFF; }
</style>
