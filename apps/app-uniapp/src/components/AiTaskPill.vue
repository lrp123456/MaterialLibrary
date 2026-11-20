<template>
  <view v-if="visible && task" class="atp-wrap" @click="onClickPill">
    <view class="atp-pill" :class="task.status">
      <view class="atp-row">
        <view class="atp-dot" />
        <text class="atp-title">{{ task.title || 'AI 生成' }}</text>
        <text class="atp-status">{{ statusText }}</text>
        <view class="atp-close" @click.stop="dismiss" hover-class="atp-close-hover">
          <text class="atp-close-t">✕</text>
        </view>
      </view>
      <view class="atp-track">
        <view class="atp-fill" :class="task.status" :style="{ width: pct + '%' }" />
      </view>
    </view>
  </view>
</template>

<script>
import { aiTaskManager } from '../service/AiTaskManager'
import { switchTabTo } from '../common/nav'

const TERMINAL_HIDE_MS = 5000
const STALE_MS = 12000

export default {
  name: 'AiTaskPill',
  data() {
    return {
      task: null,
      visible: false,
      unsub: null,
      hideTimer: null,
      tick: 0,
    }
  },
  computed: {
    statusText() {
      const t = this.task
      if (!t) return ''
      if (t.status === 'success') return '完成'
      if (t.status === 'failed') return '失败'
      const p = t.progress != null ? Math.max(1, Math.min(99, Math.round(t.progress))) : 0
      return p + '%'
    },
    pct() {
      const t = this.task
      if (!t) return 0
      if (t.status === 'success') return 100
      if (t.status === 'failed') return 100
      return Math.max(2, Math.min(99, Math.round(Number(t.progress) || 0)))
    },
  },
  mounted() {
    this.unsub = aiTaskManager.subscribe((active, latest) => {
      this.applyTask(latest, active)
    })
    this.elapsedTimer = setInterval(() => {
      // 触发视图更新，让「进行中」的进度条持续呼吸
      this.tick = (this.tick + 1) % 1000
    }, 1000)
  },
  beforeDestroy() {
    if (this.unsub) {
      this.unsub()
      this.unsub = null
    }
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer)
      this.elapsedTimer = null
    }
  },
  methods: {
    applyTask(task, active) {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer)
        this.hideTimer = null
      }
      if (!task) {
        this.task = null
        this.visible = false
        return
      }
      const running = task.status === 'running' || task.status === 'pending'
      const settled = task.status === 'success' || task.status === 'failed'
      // 太久以前的终态任务不展示（例如上次启动留下的记录）
      if (settled && Date.now() - (task.updatedAt || task.createdAt || 0) > STALE_MS) {
        this.task = null
        this.visible = false
        return
      }
      this.task = task
      this.visible = true
      if (settled) {
        this.hideTimer = setTimeout(() => {
          this.visible = false
          this.hideTimer = null
          // 终态展示完就清掉，避免下次进入再弹一次
          if (task.taskId) aiTaskManager.dismissTask(task.taskId)
        }, TERMINAL_HIDE_MS)
      }
    },
    dismiss() {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer)
        this.hideTimer = null
      }
      this.visible = false
      const id = this.task && this.task.taskId
      this.task = null
      if (id) aiTaskManager.dismissTask(id)
    },
    onClickPill() {
      if (!this.task) return
      if (this.task.status === 'success' && this.task.outputFid) {
        uni.navigateTo({ url: '/pages/detail/detail?fid=' + encodeURIComponent(this.task.outputFid) })
      } else if (this.task.status === 'failed') {
        uni.showToast({ title: this.task.error || '任务失败，请回创作页重试', icon: 'none' })
      } else {
        // 进行中 / 成功但无素材：回到创作会话看结果
        switchTabTo('/pages/home/home')
      }
    },
  },
}
</script>

<style scoped>
.atp-wrap {
  position: fixed;
  right: 12px;
  bottom: calc(env(safe-area-inset-bottom) + 208px);
  z-index: 999;
  animation: atpIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes atpIn {
  from { opacity: 0; transform: translateY(10px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.atp-pill {
  min-width: 176px;
  max-width: 244px;
  padding: 9px 10px 8px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid #dbeafe;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}
.atp-pill.success {
  border-color: #bbf7d0;
}
.atp-pill.failed {
  border-color: #fecaca;
}
.atp-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.atp-dot {
  width: 7px;
  height: 7px;
  border-radius: 4px;
  background: #3b82f6;
  flex-shrink: 0;
  animation: atpPulse 1.4s ease-in-out infinite;
}
.atp-pill.success .atp-dot {
  background: #10b981;
  animation: none;
}
.atp-pill.failed .atp-dot {
  background: #ef4444;
  animation: none;
}
@keyframes atpPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.8); }
}
.atp-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.atp-status {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #2563eb;
  font-variant-numeric: tabular-nums;
}
.atp-pill.success .atp-status {
  color: #059669;
}
.atp-pill.failed .atp-status {
  color: #dc2626;
}
.atp-close {
  width: 18px;
  height: 18px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.atp-close-hover {
  background: #f1f5f9;
}
.atp-close-t {
  font-size: 9px;
  color: #94a3b8;
}
.atp-track {
  margin-top: 7px;
  height: 3px;
  border-radius: 2px;
  background: #eef2f7;
  overflow: hidden;
}
.atp-fill {
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(90deg, #3b82f6, #6366f1);
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s ease;
}
.atp-fill.success {
  background: #10b981;
}
.atp-fill.failed {
  background: #ef4444;
}
</style>
