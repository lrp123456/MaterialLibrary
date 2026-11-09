<template>
  <view class="quick-page">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-left" @click="goBack">
        <text class="back-icon">‹</text>
        <text class="nav-title">物体消除</text>
      </view>
    </view>

    <!-- 12px 屏幕恒定锚点、首点自动放大选区组件 -->
    <view class="selector-wrap">
      <TouchSelector
        v-if="imgUrl"
        :img-url="imgUrl"
        default-mode="rect"
        :viewport-height="viewportH"
        @change="onSelectionChange"
      />
    </view>

    <!-- 底部控制面板 -->
    <view class="bottom-panel">
      <view class="options-row">
        <text class="option-label">局部精准贴回原图</text>
        <switch :checked="pasteback" color="#2563EB" @change="pasteback = $event.detail.value" />
      </view>

      <view class="submit-btn" :class="{ disabled: !hasSelection || submitting }" @click="submitTask">
        <text class="submit-text">{{ submitting ? '提交中...' : (hasSelection ? '开始消除并修补背景' : '请在图上框选要消除的物体') }}</text>
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
      statusBarHeight: 20,
      viewportH: 480,
      fid: '',
      derivId: '',
      imgUrl: '',
      hasSelection: false,
      selectionData: null,
      pasteback: true,
      submitting: false,
    }
  },
  onLoad(opts) {
    try {
      const sys = uni.getSystemInfoSync()
      this.statusBarHeight = sys.statusBarHeight || 20
      this.viewportH = (sys.windowHeight || 667) - this.statusBarHeight - 50 - 140
    } catch (e) {}
    this.fid = opts.fid || ''
    this.derivId = opts.derivId ? decodeURIComponent(opts.derivId) : ''
    this.imgUrl = opts.imgUrl ? decodeURIComponent(opts.imgUrl) : ''
  },
  methods: {
    goBack() {
      uni.navigateBack()
    },
    onSelectionChange(data) {
      this.hasSelection = data.hasSelection
      this.selectionData = data
    },
    async submitTask() {
      if (!this.hasSelection || this.submitting) return
      this.submitting = true
      handoffPreciseEdit({
        fid: this.fid,
        derivId: this.derivId,
        imgUrl: this.imgUrl,
        op: 'remove',
        recipe: '请消除选区内的物体，并根据周围环境自然补全背景。',
        recipeHint: '消除选区内的物体',
        selection: this.selectionData,
        pasteback: this.pasteback,
      })
      this.submitting = false
    }
  }
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
.options-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.option-label { font-size: 13px; color: #334155; }
.submit-btn { background: linear-gradient(135deg, #3B82F6, #6366F1); border-radius: 24px; padding: 14px 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(59,130,246,.25); }
.submit-btn.disabled { opacity: 0.5; }
.submit-text { font-size: 15px; font-weight: 600; color: #FFFFFF; }
</style>
