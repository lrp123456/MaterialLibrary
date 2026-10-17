<template>
  <view class="editor-page">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-left" @click="goBack">
        <text class="back-icon">‹</text>
        <text class="nav-title">AI 触控精修</text>
      </view>
      <view class="nav-right">
        <text class="nav-action" :class="{ disabled: submitting }" @click="submitRetouch">{{ submitting ? '处理中…' : '提交精修' }}</text>
      </view>
    </view>
    <view class="canvas-wrap">
      <TouchSelector v-if="imgUrl" :img-url="imgUrl" default-mode="rect" :viewport-height="viewportH" @change="onSelectionChange" />
      <view v-else class="empty-box"><text class="empty-t">未加载图片</text></view>
    </view>
    <view class="panel">
      <view class="mode-row">
        <view v-for="m in modes" :key="m.key" class="mode-chip" :class="{ active: mode === m.key }" @click="mode = m.key">
          <text class="mode-t">{{ m.label }}</text>
        </view>
      </view>
      <input class="prompt-input" v-model="prompt" :placeholder="promptPlaceholder" />
      <view class="opt-row">
        <text class="opt-label">局部精准贴回原图</text>
        <switch :checked="pasteback" color="#2563EB" @change="pasteback = $event.detail.value" />
      </view>
      <view class="submit-btn" :class="{ disabled: !canSubmit || submitting }" @click="submitRetouch">
        <text class="submit-t">{{ submitting ? '提交中…' : submitLabel }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import TouchSelector from '../../components/TouchSelector.vue'
import { aiTaskManager } from '../../service/AiTaskManager'
import { mediaUrl } from '../../service/ViewerApi'

export default {
  components: { TouchSelector },
  data() {
    return {
      statusBarHeight: 20, viewportH: 420,
      fid: '', imgUrl: '', mode: 'inpaint', prompt: '',
      pasteback: true, hasSelection: false, selectionData: null, submitting: false,
      modes: [
        { key: 'inpaint', label: '智能修补' },
        { key: 'replace', label: '替换重绘' },
        { key: 'enhance', label: '清晰增强' },
        { key: 'expand', label: '向外扩图' },
      ],
    }
  },
  computed: {
    promptPlaceholder() {
      return { inpaint: '描述要修补的内容…', replace: '描述要把选区换成什么…', enhance: '可描述增强重点', expand: '可描述扩展方向' }[this.mode] || '描述精修需求…'
    },
    submitLabel() {
      if (!this.hasSelection && this.mode !== 'expand' && this.mode !== 'enhance') return '请先框选精修区域'
      return '开始 AI 精修'
    },
    canSubmit() {
      if (this.mode === 'expand' || this.mode === 'enhance') return !!this.imgUrl
      return this.hasSelection
    },
  },
  onLoad(opts) {
    try {
      const sys = uni.getSystemInfoSync()
      this.statusBarHeight = sys.statusBarHeight || 20
      this.viewportH = Math.max(280, (sys.windowHeight || 667) - this.statusBarHeight - 50 - 220)
    } catch (e) {}
    this.fid = opts.fid || ''
    if (opts.imgUrl) this.imgUrl = decodeURIComponent(opts.imgUrl)
    if (opts.mode) this.mode = decodeURIComponent(opts.mode)
    if (this.fid && !this.imgUrl) this.imgUrl = mediaUrl(this.fid, 0)
  },
  methods: {
    goBack() { uni.navigateBack() },
    onSelectionChange(data) { this.hasSelection = data.hasSelection; this.selectionData = data },
    async submitRetouch() {
      if (!this.canSubmit || this.submitting) return
      this.submitting = true
      try {
        const payload = { mode: this.mode, sub_mode: this.mode, pasteback: this.pasteback, prompt: this.prompt, image: this.imgUrl }
        if (this.selectionData && this.selectionData.pixelRect) {
          const r = this.selectionData.pixelRect
          payload.coord_unit = 'px'
          payload.x1 = r.x; payload.y1 = r.y; payload.x2 = r.x + r.w; payload.y2 = r.y + r.h
        }
        await aiTaskManager.createTask({ fid: this.fid, type: this.mode, title: 'AI 精修', payload })
        uni.showToast({ title: '已提交精修任务', icon: 'success' })
        setTimeout(() => this.goBack(), 1200)
      } catch (e) {
        uni.showToast({ title: e.message || '提交失败', icon: 'none' })
      } finally { this.submitting = false }
    },
  },
}
</script>

<style scoped>
.editor-page { display: flex; flex-direction: column; height: 100vh; background: #0F172A; }
.nav-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #1E293B; }
.nav-left { display: flex; align-items: center; }
.back-icon { font-size: 28px; color: #FFF; margin-right: 8px; line-height: 1; }
.nav-title { font-size: 17px; font-weight: 600; color: #FFF; }
.nav-action { font-size: 14px; font-weight: 600; color: #60A5FA; padding: 6px 10px; }
.nav-action.disabled { opacity: .5; }
.canvas-wrap { flex: 1; min-height: 0; }
.empty-box { height: 100%; display: flex; align-items: center; justify-content: center; }
.empty-t { color: #64748B; font-size: 14px; }
.panel { background: #1E293B; padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); border-radius: 20px 20px 0 0; }
.mode-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.mode-chip { padding: 7px 12px; border-radius: 999px; background: #334155; }
.mode-chip.active { background: #2563EB; }
.mode-t { font-size: 12px; color: #E2E8F0; }
.prompt-input { height: 40px; background: #334155; border-radius: 12px; padding: 0 12px; color: #F8FAFC; font-size: 13px; margin-bottom: 12px; }
.opt-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.opt-label { font-size: 13px; color: #E2E8F0; }
.submit-btn { background: #2563EB; border-radius: 24px; padding: 13px 0; display: flex; align-items: center; justify-content: center; }
.submit-btn.disabled { opacity: .5; }
.submit-t { font-size: 15px; font-weight: 600; color: #FFF; }
</style>
