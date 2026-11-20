<template>
  <view v-if="show" class="lightbox" @touchstart.stop="onTouchStart" @touchmove.stop.prevent="onTouchMove" @touchend.stop="onTouchEnd" @touchcancel.stop="onTouchEnd">
    <!-- 顶部：标题 + 关闭 -->
    <view class="lb-topbar">
      <text class="lb-title" number-of-lines="1">{{ label }}</text>
      <view class="lb-close" @click="close"><text class="lb-close-x">✕</text></view>
    </view>

    <!-- 图片：双指缩放 + 拖动平移 + 单击/双击切换 1:1（手势在 touchend 统一判定） -->
    <view v-if="kind === 'image'" class="lb-stage">
      <image
        :src="url"
        class="lb-img"
        mode="aspectFit"
        :style="imgStyle"
        :show-menu-by-longpress="true"
        @load="onImgLoad"
      />
      <view v-if="loading" class="lb-loading"><view class="lb-spinner" /></view>
    </view>

    <!-- 视频 -->
    <view v-else-if="kind === 'video'" class="lb-stage">
      <video :src="url" class="lb-video" controls :autoplay="true" object-fit="contain" />
    </view>

    <!-- 音频 -->
    <view v-else-if="kind === 'audio'" class="lb-stage lb-audio-stage">
      <view class="lb-audio-disc"><text class="lb-audio-icon">♪</text></view>
      <text class="lb-audio-label" number-of-lines="2">{{ label || '音频' }}</text>
      <audio :src="url" :name="label" :author="''" :controls="true" class="lb-audio" />
    </view>

    <!-- 底部工具条 -->
    <view v-if="kind === 'image'" class="lb-bottombar" @touchstart.stop @touchend.stop @touchmove.stop>
      <view class="lb-tool" @click="toggleZoom"><text class="lb-tool-t">{{ zoomed ? '适应屏幕' : '1 : 1' }}</text></view>
      <view class="lb-tool primary" @click="$emit('download')"><text class="lb-tool-t">保存到相册</text></view>
    </view>
  </view>
</template>

<script>
export default {
  name: 'RefLightbox',
  props: {
    show: { type: Boolean, default: false },
    url: { type: String, default: '' },
    kind: { type: String, default: 'image' },
    label: { type: String, default: '' },
  },
  emits: ['close', 'download'],
  data() {
    return {
      loading: true,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      zoomed: false,
      // 触摸状态
      startDist: 0,
      startScale: 1,
      startX: 0,
      startY: 0,
      startOffsetX: 0,
      startOffsetY: 0,
      stageW: 0,
      stageH: 0,
      _moved: false,
      _pinching: false,
      _tapCount: 0,
      _tapTimer: null,
    }
  },
  computed: {
    imgStyle() {
      return `transform: translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale});`
    },
  },
  watch: {
    show(v) {
      if (v) this.resetState()
      else this.clearTapTimer()
    },
  },
  beforeUnmount() {
    this.clearTapTimer()
  },
  methods: {
    resetState() {
      this.scale = 1
      this.offsetX = 0
      this.offsetY = 0
      this.zoomed = false
      this.loading = true
      this.startDist = 0
      this._moved = false
      this.clearTapTimer()
      try {
        const sys = uni.getSystemInfoSync()
        this.stageW = sys.windowWidth || 375
        this.stageH = sys.windowHeight || 800
      } catch (e) {}
    },
    clearTapTimer() {
      if (this._tapTimer) {
        clearTimeout(this._tapTimer)
        this._tapTimer = null
      }
    },
    onImgLoad() {
      this.loading = false
    },
    close() {
      this.clearTapTimer()
      this.$emit('close')
    },
    toggleZoom() {
      this.zoomed = !this.zoomed
      this.scale = this.zoomed ? 2 : 1
      this.offsetX = 0
      this.offsetY = 0
    },
    touchList(e) {
      return (e.touches || []).length ? e.touches : (e.changedTouches || [])
    },
    onTouchStart(e) {
      const ts = this.touchList(e)
      if (ts.length >= 2) {
        // 双指：开始缩放
        const dx = ts[0].pageX - ts[1].pageX
        const dy = ts[0].pageY - ts[1].pageY
        this.startDist = Math.hypot(dx, dy) || 1
        this.startScale = this.scale
        this.startOffsetX = this.offsetX
        this.startOffsetY = this.offsetY
        this._moved = true
        this._pinching = true
      } else if (ts.length === 1) {
        this.startX = ts[0].pageX
        this.startY = ts[0].pageY
        this.startOffsetX = this.offsetX
        this.startOffsetY = this.offsetY
        this._moved = false
      }
    },
    onTouchMove(e) {
      const ts = this.touchList(e)
      if (ts.length >= 2 && this.startDist > 0) {
        const dx = ts[0].pageX - ts[1].pageX
        const dy = ts[0].pageY - ts[1].pageY
        const dist = Math.hypot(dx, dy) || 1
        let next = this.startScale * (dist / this.startDist)
        next = Math.min(4, Math.max(1, next))
        this.scale = next
        this.zoomed = next > 1.05
        if (!this.zoomed) {
          this.offsetX = 0
          this.offsetY = 0
        }
      } else if (ts.length === 1) {
        const dx = ts[0].pageX - this.startX
        const dy = ts[0].pageY - this.startY
        if (Math.hypot(dx, dy) > 8) this._moved = true
        if (this.scale > 1.05) {
          // 放大后平移：限制在图幅范围内，避免拖飞
          const maxX = ((this.scale - 1) * this.stageW) / 2
          const maxY = ((this.scale - 1) * this.stageH) / 2
          this.offsetX = Math.max(-maxX, Math.min(maxX, this.startOffsetX + dx))
          this.offsetY = Math.max(-maxY, Math.min(maxY, this.startOffsetY + dy))
        }
      }
    },
    onTouchEnd(e) {
      // touchend 时 e.touches 为空、e.changedTouches 才是抬起的点
      if (((e.touches || []).length) !== 0) return
      this.startDist = 0
      if (this._pinching) {
        this._pinching = false
        this._moved = false
        return
      }
      if (this._moved) {
        // 未放大时下滑关闭；其余情况回弹
        const dx = (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].pageX : this.startX) - this.startX
        const dy = (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].pageY : this.startY) - this.startY
        if (!this.zoomed && dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.2) {
          this.$emit('close')
          return
        }
        if (!this.zoomed) {
          this.scale = 1
          this.offsetX = 0
          this.offsetY = 0
        }
        this._moved = false
        return
      }
      // 单击 / 双击：双击立即放大，单击稍等 280ms 以区分双击
      this._tapCount += 1
      if (this._tapCount >= 2) {
        this.clearTapTimer()
        this._tapCount = 0
        this.toggleZoom()
        return
      }
      this.clearTapTimer()
      this._tapTimer = setTimeout(() => {
        this._tapTimer = null
        this._tapCount = 0
        this.toggleZoom()
      }, 280)
    },
  },
}
</script>

<style scoped>
.lightbox {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0; z-index: 999;
  background: rgba(6, 10, 18, .96);
  display: flex; flex-direction: column;
}
.lb-topbar {
  display: flex; align-items: center; padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top));
  gap: 12px;
}
.lb-title { flex: 1; color: #E2E8F0; font-size: 13px; }
.lb-close {
  width: 40px; height: 40px; border-radius: 999px;
  background: rgba(255, 255, 255, .12);
  align-items: center; justify-content: center; display: flex;
}
.lb-close-x { color: #F1F5F9; font-size: 18px; line-height: 1; }
.lb-stage { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; }
.lb-img { width: 100%; height: 100%; }
.lb-loading { position: absolute; align-items: center; justify-content: center; display: flex; }
.lb-spinner {
  width: 34px; height: 34px; border-radius: 999px;
  border: 3px solid rgba(255,255,255,.25); border-top-color: #fff;
  animation: ml-spin .9s linear infinite;
}
@keyframes ml-spin { to { transform: rotate(360deg); } }
.lb-video { width: 100%; max-height: 100%; }
.lb-audio-stage { flex-direction: column; gap: 16px; padding: 0 32px; }
.lb-audio-disc {
  width: 132px; height: 132px; border-radius: 999px;
  background: linear-gradient(145deg, #1E293B, #0F172A);
  border: 1px solid #27354D;
  align-items: center; justify-content: center; display: flex;
}
.lb-audio-icon { color: #3B82F6; font-size: 44px; }
.lb-audio-label { color: #E2E8F0; font-size: 14px; text-align: center; }
.lb-audio { width: 100%; }
.lb-bottombar {
  display: flex; gap: 12px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
}
.lb-tool {
  flex: 1; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, .12);
  align-items: center; justify-content: center; display: flex;
}
.lb-tool.primary { background: #3B82F6; }
.lb-tool-t { color: #F8FAFC; font-size: 13px; font-weight: 600; }
</style>
