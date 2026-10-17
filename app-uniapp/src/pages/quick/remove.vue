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
import { aiTaskManager } from '../../service/AiTaskManager'

export default {
  components: { TouchSelector },
  data() {
    return {
      statusBarHeight: 20,
      viewportH: 480,
      fid: '',
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
      try {
        const payload = {
          mode: 'remove',
          sub_mode: 'remove',
          pasteback: this.pasteback,
          image: this.imgUrl,
        }
        if (this.selectionData.mode === 'rect' && this.selectionData.pixelRect) {
          payload.coord_unit = 'px'
          payload.x1 = this.selectionData.pixelRect.x1
          payload.y1 = this.selectionData.pixelRect.y1
          payload.x2 = this.selectionData.pixelRect.x2
          payload.y2 = this.selectionData.pixelRect.y2
        } else if (this.selectionData.mode === 'quad') {
          payload.coord_unit = 'percent'
          payload.points = this.selectionData.points
        }

        await aiTaskManager.createTask({
          fid: this.fid,
          type: 'remove',
          title: '物体消除',
          payload,
        })
        uni.showToast({ title: '已提交消除任务', icon: 'success' })
        setTimeout(() => this.goBack(), 1200)
      } catch (e) {
        uni.showToast({ title: e.message || '提交失败', icon: 'none' })
      } finally {
        this.submitting = false
      }
    }
  }
}
</script>

<style scoped>
.quick-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #0F172A;
}

.nav-bar {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  background: #1E293B;
}

.nav-left {
  display: flex;
  align-items: center;
}

.back-icon {
  font-size: 28px;
  color: #FFFFFF;
  margin-right: 8px;
  line-height: 1;
}

.nav-title {
  font-size: 17px;
  font-weight: 600;
  color: #FFFFFF;
}

.selector-wrap {
  flex: 1;
  width: 100%;
}

.bottom-panel {
  background: #1E293B;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  border-radius: 20px 20px 0 0;
}

.options-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.option-label {
  font-size: 14px;
  color: #E2E8F0;
}

.submit-btn {
  background: #2563EB;
  border-radius: 24px;
  padding: 14px 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.submit-btn.disabled {
  opacity: 0.5;
}

.submit-text {
  font-size: 16px;
  font-weight: 600;
  color: #FFFFFF;
}
</style>
