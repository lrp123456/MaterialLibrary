<template>
  <view class="ws-page">
    <view class="ws-top">
      <view class="ws-top-left">
        <text class="ws-back" @click="goBack">←</text>
        <text class="ws-title">3D 视频工坊</text>
        <text class="ws-crumb">{{ crumb }}</text>
      </view>
      <view class="ws-top-right">
        <view
          v-for="t in tabs"
          :key="t.id"
          class="ws-tab"
          :class="{ on: activeTab === t.id }"
          @click="switchTab(t.id)"
        >{{ t.label }}</view>
      </view>
    </view>
    <view v-show="activeTab === 'stack'" class="ws-body" ref="stackHost"></view>
    <view v-show="activeTab === 'tour'" class="ws-body" ref="tourHost"></view>
  </view>
</template>

<script>
import { ImageStackPage } from './workshop/image-stack-page'
import { FloorTourPage } from './workshop/floor-tour-page'
import { WorkshopStore } from './workshop/workshop-store'

export default {
  name: 'DirectorStudio',
  data() {
    return {
      activeTab: 'stack',
      tabs: [
        { id: 'stack', label: '图片栈' },
        { id: 'tour', label: '户型导览' },
      ],
    }
  },
  computed: {
    crumb() {
      return this.activeTab === 'stack'
        ? '八操作 · 按图线性栈 · 保存才入库'
        : '矢量户型 → 3D → 动线 → 分镜 → 视频'
    },
  },
  mounted() {
    this._store = new WorkshopStore()
    this._toast = (msg, type) => {
      uni.showToast({ title: String(msg).slice(0, 40), icon: type === 'err' ? 'none' : 'success' })
    }
    this.$nextTick(() => this.mountPages())
  },
  methods: {
    goBack() {
      uni.navigateBack()
    },
    switchTab(id) {
      this.activeTab = id
    },
    queryBody(index) {
      const nodes = document.querySelectorAll('.ws-body')
      return nodes[index] || null
    },
    mountPages() {
      const stackEl = this.resolveEl(this.$refs.stackHost) || this.queryBody(0)
      const tourEl = this.resolveEl(this.$refs.tourHost) || this.queryBody(1)
      if (stackEl && !this.stackPage) {
        this.stackPage = new ImageStackPage(stackEl, this._store, this._toast)
      }
      if (tourEl && !this.tourPage) {
        this.tourPage = new FloorTourPage(tourEl, this._store, this._toast, {
          getStackSnapshot: async () => {
            const p = this.stackPage
            if (!p || !p.activeImage) return null
            const frame = p.activeFrame
            return {
              dataUrl: (frame && frame.dataUrl) || p.activeImage.dataUrl,
              frameId: (frame && frame.id) || 'origin',
              taskId: p.task.id,
            }
          },
        })
      }
    },
    resolveEl(ref) {
      if (!ref) return null
      if (typeof HTMLElement !== 'undefined' && ref instanceof HTMLElement) return ref
      const node = ref.$el || ref
      if (node && node.nodeType === 1) return node
      return null
    },
  },
}
</script>

<style scoped>
.ws-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  color: #0f172a;
}
.ws-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
}
.ws-title {
  font-size: 16px;
  font-weight: 700;
}
.ws-back {
  font-size: 20px;
  cursor: pointer;
  color: #64748b;
  padding: 0 6px;
}
.ws-top-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ws-crumb {
  color: #64748b;
  font-size: 12px;
}
.ws-tab {
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #f1f5f9;
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
}
.ws-tab.on {
  background: rgba(37, 99, 235, 0.12);
  border-color: #2563eb;
  color: #1d4ed8;
}
.ws-body {
  flex: 1;
  min-height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
}
.ws-body > * {
  flex: 1;
  min-height: 0;
}
</style>

<style>
@import './workshop/workshop.css';
</style>
