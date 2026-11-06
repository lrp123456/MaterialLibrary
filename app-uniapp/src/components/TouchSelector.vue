<template>
  <view class="ts">
    <image
      class="ts-img"
      :src="realImageUrl"
      mode="widthFix"
      @load="onImgLoad"
    />
    <canvas
      canvas-id="tsCanvas"
      :style="{ width: (cssW ? cssW + 'px' : '100%'), height: (cssH ? cssH + 'px' : '100%') }"
      class="ts-canvas"
      @touchstart="onStart"
      @touchmove="onMove"
      @touchend="onEnd"
      disable-scroll
    />
    <!-- 选区工具栏 -->
    <view class="ts-tools">
      <view
        v-for="t in tools"
        :key="t.id"
        :class="['ts-tool', { active: currentMode === t.id }]"
        @click="setMode(t.id)"
      >
        {{ t.label }}
      </view>
    </view>
    <!-- 操作提示 / 清除 -->
    <view class="ts-footer">
      <text class="ts-hint">{{ hintText }}</text>
      <view class="ts-clear" @click="clearSelection">清除选区</view>
    </view>
  </view>
</template>

<script>
import { sortQuadClockwise } from '../common/coords'
import { buildSelectionPayload } from '../common/selection-payload.js'

export default {
  name: 'TouchSelector',
  props: {
    imageUrl: { type: String, default: '' },
    imgUrl: { type: String, default: '' },
    // 检测结果（ch04）：[{ id,label,bbox(norm 0-1), polygon(norm) }]
    detections: { type: Array, default: () => [] },
    mode: { type: String, default: 'box' },
    defaultMode: { type: String, default: 'box' },
    viewportHeight: { type: [Number, String], default: 0 },
  },
  data() {
    return {
      imgCssW: 0,
      imgCssH: 0,
      imgNaturalW: 0,
      imgNaturalH: 0,
      drawing: false,
      box: null,
      quadPts: [],
      polyIds: [],
      poly: [],
      _rect: null,
      internalMode: '',
      tools: [
        { id: 'box', label: '框选' },
        { id: 'quad', label: '四点' },
        { id: 'tap', label: '点选' },
        { id: 'multi', label: '多选' }
      ]
    }
  },
  computed: {
    cssW() {
      return this.imgCssW || 0
    },
    cssH() {
      return this.imgCssH || (Number(this.viewportHeight) || 0)
    },
    realImageUrl() {
      return this.imageUrl || this.imgUrl || ''
    },
    currentMode() {
      if (this.internalMode) return this.internalMode
      if (this.defaultMode === 'rect') return 'box'
      return this.mode || this.defaultMode || 'box'
    },
    hintText() {
      if (this.polyIds.length) return '已选 ' + this.polyIds.length + ' 个目标'
      if (this.quadPts.length) return '已定位 ' + this.quadPts.length + '/4 点'
      if (this.box) return '选区已就绪'
      if (this.currentMode === 'tap') return '点击图中的检测框'
      if (this.currentMode === 'quad') return '依次点四个角，前两点定长边角度'
      return '按住拖动画矩形'
    }
  },
  methods: {
    setMode(m) {
      this.internalMode = m
      this.redraw()
    },
    onImgLoad(e) {
      this.imgNaturalW = (e.detail && e.detail.width) || 0
      this.imgNaturalH = (e.detail && e.detail.height) || 0
      this.$nextTick(() => this.measure())
    },
    measure() {
      // #ifndef H5
      uni.createSelectorQuery()
        .in(this)
        .select('.ts-canvas')
        .boundingClientRect((rect) => {
          if (rect) {
            this.imgCssW = rect.width
            this.imgCssH = rect.height
            this._rect = rect
            this.redraw()
          }
        })
        .exec()
      // #endif
      // #ifdef H5
      this.$nextTick(() => {
        const el = this.$el && this.$el.querySelector ? this.$el.querySelector('.ts-canvas') : null
        if (el) {
          this.imgCssW = el.offsetWidth
          this.imgCssH = el.offsetHeight
          this._rect = el.getBoundingClientRect()
          this.redraw()
        }
      })
      // #endif
    },
    toNorm(cx, cy) {
      const r = this._rect
      if (!r) return { x: 0, y: 0 }
      return {
        x: Math.min(1, Math.max(0, (cx - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (cy - r.top) / r.height))
      }
    },
    async onStart(e) {
      const r = await this.getRect()
      if (!r) return
      const t = e.touches[0]
      if (this.currentMode === 'box') {
        this.drawing = true
        const n = this.toNorm(t.clientX, t.clientY)
        this.box = { x1: n.x, y1: n.y, x2: n.x, y2: n.y }
      } else if (this.currentMode === 'quad') {
        const n = this.toNorm(t.clientX, t.clientY)
        this.quadPts.push([n.x, n.y])
        if (this.quadPts.length > 4) this.quadPts.shift()
      } else if (this.mode === 'tap' || this.mode === 'multi') {
        this.tapSelect(t.clientX, t.clientY)
      }
      this.redraw()
    },
    onMove(e) {
      if (!this.drawing || this.mode !== 'box') return
      const t = e.touches[0]
      const n = this.toNorm(t.clientX, t.clientY)
      this.box = { ...this.box, x2: n.x, y2: n.y }
      this.redraw()
    },
    onEnd() {
      this.drawing = false
      this.emitSelection()
    },
    tapSelect(cx, cy) {
      const r = this._rect
      if (!r) return
      const nx = (cx - r.left) / r.width
      const ny = (cy - r.top) / r.height
      const hit = this.detections.find((d) => {
        const b = d.bbox
        if (!b) return false
        const left = Math.min(b.x1, b.x2), right = Math.max(b.x1, b.x2)
        const top = Math.min(b.y1, b.y2), bottom = Math.max(b.y1, b.y2)
        return nx >= left && nx <= right && ny >= top && ny <= bottom
      })
      if (!hit) return
      const id = hit.id
      const idx = this.polyIds.indexOf(id)
      if (this.currentMode === 'multi') {
        if (idx >= 0) this.polyIds.splice(idx, 1)
        else this.polyIds.push(id)
      } else {
        this.polyIds = [id]
      }
      this.buildPoly()
      this.redraw()
      this.emitSelection()
    },
    buildPoly() {
      const pts = []
      for (const id of this.polyIds) {
        const d = this.detections.find((x) => x.id === id)
        if (d && d.polygon) pts.push(...d.polygon)
      }
      this.poly = pts
    },
    clearSelection() {
      this.box = null
      this.quadPts = []
      this.polyIds = []
      this.poly = []
      this.redraw()
      this.emitSelection()
    },
    getRect() {
      return new Promise((resolve) => {
        // #ifndef H5
        uni.createSelectorQuery()
          .in(this)
          .select('.ts-canvas')
          .boundingClientRect((rect) => { this._rect = rect; resolve(rect) })
          .exec()
        // #endif
        // #ifdef H5
        const el = this.$el && this.$el.querySelector ? this.$el.querySelector('.ts-canvas') : null
        const r = el ? el.getBoundingClientRect() : null
        this._rect = r
        resolve(r)
        // #endif
      })
    },
    redraw() {
      // #ifndef H5
      const ctx = uni.createCanvasContext('tsCanvas', this)
      if (!ctx || !this.imgCssW) return
      const W = this.imgCssW
      const H = this.imgCssH
      ctx.clearRect(0, 0, W, H)
      for (const d of this.detections) {
        if (d.bbox) {
          const b = d.bbox
          const x = Math.min(b.x1, b.x2) * W
          const y = Math.min(b.y1, b.y2) * H
          const w = Math.abs(b.x2 - b.x1) * W
          const h = Math.abs(b.y2 - b.y1) * H
          ctx.setStrokeStyle(this.polyIds.includes(d.id) ? '#059669' : '#2563EB')
          ctx.setLineWidth(2)
          ctx.strokeRect(x, y, w, h)
          if (d.label) {
            ctx.setFillStyle('rgba(37,99,235,0.9)')
            ctx.fillRect(x, y - 22, Math.min(140, w), 20)
            ctx.setFillStyle('#fff')
            ctx.setFontSize(11)
            ctx.fillText(String(d.label).slice(0, 8), x + 4, y - 7)
          }
        }
      }
      ctx.setFillStyle('rgba(37,99,235,0.22)')
      ctx.setStrokeStyle('#2563EB')
      ctx.setLineWidth(2)
      if (this.box) {
        const x = Math.min(this.box.x1, this.box.x2) * W
        const y = Math.min(this.box.y1, this.box.y2) * H
        const w = Math.abs(this.box.x2 - this.box.x1) * W
        const h = Math.abs(this.box.y2 - this.box.y1) * H
        ctx.fillRect(x, y, w, h)
        ctx.strokeRect(x, y, w, h)
      }
      if (this.quadPts.length === 4) {
        const p = this.quadPts
        ctx.beginPath()
        ctx.moveTo(p[0][0] * W, p[0][1] * H)
        for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0] * W, p[i][1] * H)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.setFillStyle('#2563EB')
        for (let i = 0; i < 4; i++) {
          ctx.beginPath()
          ctx.arc(p[i][0] * W, p[i][1] * H, 6, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.draw()
      // #endif
    },
    emitSelection() {
      const quad = this.quadPts.length === 4 ? sortQuadClockwise(this.quadPts) : null
      const payload = buildSelectionPayload({
        currentMode: this.currentMode,
        box: this.box,
        quad,
        polygon: this.poly,
        naturalW: this.imgNaturalW,
        naturalH: this.imgNaturalH,
      })
      this.$emit('select', payload)
      this.$emit('change', payload)
    }
  }
}
</script>

<style>
.ts { position: relative; background: #fff; border-radius: 16rpx; }
.ts-img { width: 100%; display: block; border-radius: 16rpx; }
.ts-canvas { position: absolute; left: 0; top: 0; z-index: 2; border-radius: 16rpx; }
.ts-tools { display: flex; gap: 16rpx; margin-top: 20rpx; padding: 0 8rpx; }
.ts-tool {
  flex: 1; text-align: center; padding: 16rpx 0; font-size: 26rpx;
  background: #F1F5F9; border: 1rpx solid #E2E8F0; border-radius: 40rpx; color: #64748B;
}
.ts-tool.active { background: #2563EB; color: #fff; border-color: #2563EB; font-weight: 600; }
.ts-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 16rpx; padding: 0 8rpx; }
.ts-hint { font-size: 24rpx; color: #64748B; }
.ts-clear { font-size: 24rpx; color: #DC2626; padding: 8rpx 20rpx; }
</style>
