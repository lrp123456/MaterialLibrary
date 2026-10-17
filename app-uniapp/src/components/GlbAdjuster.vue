<template>
  <view class="glb-panel">
    <view class="glb-head">
      <text class="glb-title">替换物调整</text>
      <text class="glb-model">{{ modelName }}</text>
    </view>

    <!-- 预览（手势：拖动旋转、双指/按钮缩放、拖动位移；小屏可操作） -->
    <view
      class="glb-preview"
      @touchstart="onPrevStart"
      @touchmove="onPrevMove"
      @touchend="onPrevEnd"
      disable-scroll
    >
      <!-- 3D 示意：按 yaw/pitch/roll/scale/x/y 变换的家具轮廓 -->
      <view
        class="glb-object"
        :style="objectStyle"
      >
        <text class="glb-icon">🛋️</text>
      </view>
      <view v-if="!ready" class="glb-placeholder">加载模型中…</view>
    </view>

    <!-- 数值控件（与手势可组合） -->
    <view class="glb-rows">
      <view class="glb-row">
        <text class="glb-k">方向 yaw</text>
        <slider class="glb-slider" :value="Math.round(transform.yaw)" :min="0" :max="360" @change="(e)=>set({yaw:e.detail.value})" />
        <text class="glb-v">{{ Math.round(transform.yaw) }}°</text>
      </view>
      <view class="glb-row">
        <text class="glb-k">俯仰 pitch</text>
        <slider class="glb-slider" :value="Math.round(transform.pitch)" :min="-45" :max="45" @change="(e)=>set({pitch:e.detail.value})" />
        <text class="glb-v">{{ Math.round(transform.pitch) }}°</text>
      </view>
      <view class="glb-row">
        <text class="glb-k">侧翻 roll</text>
        <slider class="glb-slider" :value="Math.round(transform.roll)" :min="-45" :max="45" @change="(e)=>set({roll:e.detail.value})" />
        <text class="glb-v">{{ Math.round(transform.roll) }}°</text>
      </view>
      <view class="glb-row">
        <text class="glb-k">大小 scale</text>
        <slider class="glb-slider" :value="transform.scale.toFixed(2)" :min="0.5" :max="3" :step="0.05" @change="(e)=>set({scale:e.detail.value})" />
        <text class="glb-v">×{{ transform.scale.toFixed(2) }}</text>
      </view>
      <view class="glb-row">
        <text class="glb-k">位置 X</text>
        <slider class="glb-slider" :value="((transform.x+0.5)*100).toFixed(0)" :min="-50" :max="50" @change="(e)=>set({x:e.detail.value/100-0.5})" />
        <text class="glb-v">{{ Math.round(transform.x*100) }}</text>
      </view>
      <view class="glb-row">
        <text class="glb-k">位置 Y</text>
        <slider class="glb-slider" :value="((transform.y+0.5)*100).toFixed(0)" :min="-50" :max="50" @change="(e)=>set({y:e.detail.value/100-0.5})" />
        <text class="glb-v">{{ Math.round(transform.y*100) }}</text>
      </view>
    </view>

    <view class="glb-actions">
      <view class="glb-btn" @click="reset">复位</view>
      <view class="glb-btn primary" @click="confirm">落回场景</view>
    </view>
  </view>
</template>

<script>
export default {
  name: 'GlbAdjuster',
  props: {
    modelUrl: { type: String, default: '' },
    modelName: { type: String, default: '替换物' }
  },
  data() {
    return {
      ready: false,
      transform: { yaw: 180, pitch: 0, roll: 0, scale: 1, x: 0, y: 0 },
      _drag: null
    }
  },
  computed: {
    objectStyle() {
      const t = this.transform
      return {
        transform: `translate(${t.x * 120}px, ${t.y * 120}px) rotate(${t.yaw}deg) scale(${t.scale})`,
        opacity: this.ready ? 1 : 0
      }
    }
  },
  methods: {
    set(partial) {
      this.transform = { ...this.transform, ...partial }
      this.$emit('change', { ...this.transform })
    },
    reset() {
      this.set({ yaw: 180, pitch: 0, roll: 0, scale: 1, x: 0, y: 0 })
    },
    confirm() {
      this.$emit('confirm', { ...this.transform })
    },
    onPrevStart(e) {
      const t = e.touches[0]
      this._drag = { x: t.clientX, y: t.clientY, yaw: this.transform.yaw, pitch: this.transform.pitch, x: this.transform.x, y: this.transform.y, scale: this.transform.scale, two: e.touches.length >= 2, dist: 0 }
      if (e.touches.length >= 2) {
        this._drag.dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
      }
    },
    onPrevMove(e) {
      if (!this._drag) return
      if (e.touches.length >= 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        const k = d / (this._drag.dist || d)
        this.set({ scale: Math.min(3, Math.max(0.5, this._drag.scale * k)) })
        return
      }
      const t = e.touches[0]
      const dx = t.clientX - this._drag.x
      const dy = t.clientY - this._drag.y
      if (Math.abs(dx) > Math.abs(dy)) {
        this.set({ yaw: this._drag.yaw + dx * 0.8, pitch: this._drag.pitch })
      } else {
        this.set({ yaw: this._drag.yaw, pitch: this._drag.pitch + dy * 0.5 })
      }
    },
    onPrevEnd() {
      this._drag = null
      this.$emit('change', { ...this.transform })
    },
    // 由编辑页载入模型（GLB/图片预览均可）
    async load(url) {
      this.modelUrl = url || this.modelUrl
      // 真实 GLB 加载由上层用 three.js / WebView 处理；这里标记就绪即可用轮廓预览
      this.ready = true
    }
  }
}
</script>

<style>
.glb-panel { background: #fff; border-radius: 24rpx; padding: 24rpx; margin-bottom: 24rpx; }
.glb-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16rpx; }
.glb-title { font-size: 30rpx; font-weight: 700; color: #0F172A; }
.glb-model { font-size: 22rpx; color: #94A3B8; }
.glb-preview {
  position: relative; height: 320rpx; background: #F1F5F9; border-radius: 16rpx;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.glb-object {
  width: 160rpx; height: 160rpx; background: #EFF6FF; border: 2rpx solid #BFDBFE;
  border-radius: 24rpx; display: flex; align-items: center; justify-content: center;
  transition: transform 0.05s;
}
.glb-icon { font-size: 80rpx; }
.glb-placeholder { position: absolute; color: #94A3B8; font-size: 24rpx; }
.glb-rows { margin-top: 16rpx; }
.glb-row { display: flex; align-items: center; gap: 16rpx; margin: 12rpx 0; }
.glb-k { width: 150rpx; font-size: 24rpx; color: #64748B; flex-shrink: 0; }
.glb-slider { flex: 1; }
.glb-v { width: 100rpx; text-align: right; font-size: 24rpx; color: #0F172A; flex-shrink: 0; }
.glb-actions { display: flex; gap: 20rpx; margin-top: 20rpx; }
.glb-btn {
  flex: 1; height: 72rpx; line-height: 72rpx; text-align: center; border-radius: 999rpx;
  background: #F1F5F9; color: #64748B; font-size: 28rpx;
}
.glb-btn.primary { background: #2563EB; color: #fff; font-weight: 600; }
</style>
