<template>
  <view v-if="task" class="atp-wrap" @click="onClickPill">
    <view class="atp-pill" :class="task.status">
      <view class="atp-dot" />
      <text class="atp-title">{{ task.title || 'AI 任务' }}</text>
      <text class="atp-status">{{ statusText }}</text>
    </view>
  </view>
</template>

<script>
import { aiTaskManager } from '../service/AiTaskManager'

export default {
  name: 'AiTaskPill',
  data() {
    return { task: null, unsub: null }
  },
  computed: {
    statusText() {
      const t = this.task
      if (!t) return ''
      if (t.status === 'success') return '完成'
      if (t.status === 'failed') return '失败'
      return t.progress != null ? `${t.progress}%` : '进行中'
    },
  },
  mounted() {
    this.unsub = aiTaskManager.subscribe((active, latest) => {
      this.task = latest || (active && active[0]) || null
    })
  },
  beforeDestroy() {
    if (this.unsub) { this.unsub(); this.unsub = null }
  },
  methods: {
    onClickPill() {
      if (!this.task) return
      if (this.task.status === 'success' && this.task.outputFid) {
        uni.navigateTo({ url: '/pages/detail/detail?fid=' + encodeURIComponent(this.task.outputFid) })
      } else if (this.task.status === 'failed') {
        uni.showToast({ title: this.task.error || '任务失败', icon: 'none' })
      }
    },
  },
}
</script>

<style scoped>
.atp-wrap { position: fixed; right: 24rpx; bottom: 160rpx; z-index: 999; }
.atp-pill { display: flex; align-items: center; gap: 12rpx; padding: 16rpx 24rpx; border-radius: 999rpx; background: #0f172a; color: #fff; box-shadow: 0 8rpx 24rpx rgba(15,23,42,.28); }
.atp-pill.success { background: #059669; }
.atp-pill.failed { background: #dc2626; }
.atp-dot { width: 12rpx; height: 12rpx; border-radius: 6rpx; background: #38bdf8; }
.atp-title { font-size: 22rpx; font-weight: 600; max-width: 220rpx; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.atp-status { font-size: 20rpx; opacity: .85; }
</style>
