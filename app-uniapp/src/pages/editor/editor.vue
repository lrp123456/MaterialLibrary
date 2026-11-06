<template>
  <view class="editor-page">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-left" @click="goBack">
        <text class="back-icon">‹</text>
        <text class="nav-title">AI 触控精修</text>
      </view>
      <view class="nav-right">
        <text class="nav-action" :class="{ disabled: submitting }" @click="submitRetouch">{{ submitting ? '处理中…' : '带入创作' }}</text>
      </view>
    </view>
    <view class="canvas-wrap">
      <TouchSelector v-if="imgUrl" :img-url="imgUrl" default-mode="rect" :viewport-height="viewportH" @change="onSelectionChange" />
      <view v-else class="empty-box"><text class="empty-t">未加载图片</text></view>
    </view>
    <view class="panel">
      <view class="panel-tip">选区与提示词会原样带到创作页，可在「预览请求」中核对后再发送。</view>
      <view class="mode-row">
        <view v-for="m in modes" :key="m.key" class="mode-chip" :class="{ active: mode === m.key }" @click="mode = m.key">
          <text class="mode-t">{{ m.label }}</text>
        </view>
      </view>
      <input class="prompt-input" v-model="prompt" :placeholder="promptPlaceholder" />
      <view class="submit-btn" :class="{ disabled: !canSubmit || submitting }" @click="submitRetouch">
        <text class="submit-t">{{ submitting ? '交接中…' : submitLabel }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import TouchSelector from '../../components/TouchSelector.vue'
import { handoffPreciseEdit, handoffGlobalEdit } from '../../common/handoff'
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
      return '带入创作页'
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
        const map = { inpaint: 'remove', replace: 'replace', enhance: 'clarity', expand: 'expand' }
        const op = map[this.mode] || 'replace'
        const recipe = this.prompt || {
          inpaint: '请修补选区内的瑕疵，并按周围环境自然补全。',
          replace: '请按提示替换选区内容，保持透视与光照一致。',
          enhance: '请对参考图整体提升清晰度与细节。',
          expand: '请向外扩展画面并自然延展背景。',
        }[this.mode]
        if (this.mode === 'enhance') {
          handoffGlobalEdit({
            fid: this.fid,
            imgUrl: this.imgUrl,
            op,
            recipe,
            recipeHint: '整图清晰增强',
          })
        } else {
          handoffPreciseEdit({
            fid: this.fid,
            imgUrl: this.imgUrl,
            op,
            recipe,
            recipeHint: this.modes.find((m) => m.key === this.mode)?.label || '',
            selection: this.selectionData,
          })
        }
      } catch (e) {
        uni.showToast({ title: e.message || '无法带入创作页', icon: 'none' })
      } finally {
        this.submitting = false
      }
    },
  },
}
</script>

<style scoped>
.editor-page { display: flex; flex-direction: column; height: 100vh; background: #F8FAFC; }
.nav-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #FFFFFF; border-bottom: 1rpx solid #E7ECF3; }
.nav-left { display: flex; align-items: center; }
.back-icon { font-size: 28px; color: #0F172A; margin-right: 8px; line-height: 1; }
.nav-title { font-size: 17px; font-weight: 600; color: #0F172A; }
.nav-action { font-size: 14px; font-weight: 600; color: #3B82F6; padding: 6px 10px; }
.nav-action.disabled { opacity: .5; }
.canvas-wrap { flex: 1; min-height: 0; padding: 12px; }
.empty-box { height: 100%; display: flex; align-items: center; justify-content: center; }
.empty-t { color: #94A3B8; font-size: 14px; }
.panel { background: #FFFFFF; padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); border-radius: 20px 20px 0 0; border-top: 1rpx solid #E7ECF3; }
.panel-tip { font-size: 11px; line-height: 1.55; color: #64748B; background: #EAF2FE; border-radius: 10px; padding: 10px; margin-bottom: 12px; }
.mode-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.mode-chip { padding: 7px 12px; border-radius: 999px; background: #F1F5F9; border: 1rpx solid #E7ECF3; }
.mode-chip.active { background: #EAF2FE; border-color: #BFDBFE; }
.mode-t { font-size: 12px; color: #475569; }
.mode-chip.active .mode-t { color: #1D4ED8; font-weight: 600; }
.prompt-input { height: 40px; background: #F8FAFC; border: 1rpx solid #E7ECF3; border-radius: 12px; padding: 0 12px; color: #0F172A; font-size: 13px; margin-bottom: 12px; }
.opt-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.opt-label { font-size: 13px; color: #334155; }
.submit-btn { background: linear-gradient(135deg, #3B82F6, #6366F1); border-radius: 24px; padding: 13px 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(59,130,246,.25); }
.submit-btn.disabled { opacity: .5; }
.submit-t { font-size: 15px; font-weight: 600; color: #FFFFFF; }
</style>
