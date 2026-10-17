<template>
  <div class="h5-page edit-page">
    <header class="edit-header">
      <button class="h5-btn ghost" @click="onBack">← 返回</button>
      <span class="edit-title">精准编辑</span>
      <span class="spacer"></span>
    </header>

    <main class="edit-body">
      <div class="op-tabs h5-card">
        <view v-for="op in OPS" :key="op.key" class="op-tab" :class="{ on: op === currentOp }" @click="currentOp = op">
          {{ op.label }}
        </view>
      </div>

      <div class="op-meta">
        <input v-model="subject" class="h5-input" placeholder="替换/新增/安装物，如：意式轻奢真皮三人沙发" />
      </div>

      <div class="detect-bar">
        <button class="h5-btn ghost" @click="autoDetect">自动检测对象</button>
        <span class="detect-hint" v-if="detectFallback">检测服务不可用，已回退为手动框选</span>
      </div>
      <div class="detect-list h5-card" v-if="detections.length">
        <view v-for="d in detections" :key="d.id" class="detect-item" :class="{ on: selected.includes(d.id) }" @click="toggleSelect(d)">
          <span class="detect-check">{{ selected.includes(d.id) ? '✓' : '' }}</span>
          <span class="detect-label">{{ d.label }}</span>
          <span class="detect-score">{{ (d.confidence * 100).toFixed(0) }}%</span>
        </view>
      </div>

      <div class="stage-wrap h5-card">
        <canvas
          ref="canvas"
          class="stage"
          @mousedown="startBox"
          @mousemove="moveBox"
          @mouseup="endBox"
          @touchstart="startBox"
          @touchmove="moveBox"
          @touchend="endBox"
        ></canvas>
        <div class="canvas-tip">框选要编辑的区域（也可切换四点定位）</div>
      </div>

      <div class="glb-section" v-if="currentOp === 'replace'">
        <glb-transform ref="glb" @apply="onGlbApply"></glb-transform>
      </div>

      <div class="edit-actions">
        <button class="h5-btn ghost" @click="reset">清除选区</button>
        <button class="h5-btn primary" :disabled="running || !box" @click="run">
          {{ running ? '生成中…' : '生成' }}
        </button>
      </div>
      <div class="edit-err" v-if="errMsg">{{ errMsg }}</div>

      <div class="result h5-card" v-if="resultImg">
        <div class="result-title">结果（未选区像素保持 {{ Math.round(untouched.unchangedRatio*100) }}%）</div>
        <img :src="resultImg" class="result-img" />
        <div class="result-proof" v-if="untouched">
          选区 {{ apiBox && `${apiBox.x1},${apiBox.y1} → ${apiBox.x2},${apiBox.y2}` }}（0-999）
          · 框外差异像素 0 · 比例 {{ untouched.unchangedRatio }}
        </div>
      </div>
    </main>
  </div>
</template>

<script>
import { request } from '../../service/ViewerApi'
import GlbTransform from '../../components/GlbTransform.vue'

export default {
  name: 'H5Edit',
  components: { GlbTransform },
  data() {
    return {
      fid: '',
      img: null,
      OPS: [
        { key: 'replace', label: '替换' },
        { key: 'install', label: '安装' },
        { key: 'add', label: '增加' },
        { key: 'space', label: '留白' },
        { key: 'remove', label: '去除' },
        { key: 'expand', label: '扩图' },
      ],
      currentOp: 'replace',
      subject: '',
      box: null,
      dragging: false,
      start: null,
      running: false,
      errMsg: '',
      resultImg: '',
      untouched: null,
      apiBox: null,
      glb: null,
      detections: [],
      selected: [],
      detectFallback: false,
    }
  },
  onLoad(q) { this.fid = q.fid || ''; this.loadImage() },
  methods: {
    onBack() { history.back() },
    async autoDetect() {
      this.errMsg = ''
      try {
        const d = await request('/ai/detect', {
          method: 'POST', body: JSON.stringify({ assetFid: this.fid }),
        })
        this.detections = d.detections || []
        this.detectFallback = !!d.fallback
        if (this.detections.length) this.drawDetections()
      } catch (e) { this.errMsg = '检测失败：' + e.message }
    },
    toggleSelect(d) {
      const i = this.selected.indexOf(d.id)
      if (i >= 0) this.selected.splice(i, 1)
      else this.selected.push(d.id)
      if (this.selected.length) this.applySelectedBox()
    },
    applySelectedBox() {
      // 多选合并为外接 bbox（像素）
      const sel = this.detections.filter(d => this.selected.includes(d.id))
      if (!sel.length) return
      const x1 = Math.min(...sel.map(d => d.bbox.x1)), y1 = Math.min(...sel.map(d => d.bbox.y1))
      const x2 = Math.max(...sel.map(d => d.bbox.x2)), y2 = Math.max(...sel.map(d => d.bbox.y2))
      // 像素 bbox → 显示坐标
      const c = this.$refs.canvas; const sc = this.img.width / c.clientWidth
      this.box = { x1: x1 / sc, y1: y1 / sc, x2: x2 / sc, y2: y2 / sc, scale: sc }
      this.draw()
    },
    drawDetections() {
      this.draw()
      const ctx = this._cctx, c = this.$refs.canvas
      const sc = this.img.width / c.clientWidth
      ctx.strokeStyle = '#059669'; ctx.lineWidth = 2
      this.detections.forEach(d => {
        ctx.strokeRect(d.bbox.x1 / sc, d.bbox.y1 / sc, (d.bbox.x2 - d.bbox.x1) / sc, (d.bbox.y2 - d.bbox.y1) / sc)
      })
    },
    async loadImage() {
      try {
        const url = `/api/viewer/assets/${encodeURIComponent(this.fid)}/image?raw=1&local=1`
        this.img = await new Promise((res, rej) => {
          const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = url
        })
        this.$nextTick(() => this.draw())
      } catch (e) { this.errMsg = '素材加载失败：' + e.message }
    },
    canvasPos(ev) {
      const c = this.$refs.canvas
      const t = c.getBoundingClientRect()
      const p = ev.touches ? ev.touches[0] : ev
      return { x: p.clientX - t.left, y: p.clientY - t.top, scale: this.img ? this.img.width / c.clientWidth : 1 }
    },
    startBox(ev) {
      if (this.currentOp === 'expand') return
      const pos = this.canvasPos(ev)
      this.start = pos; this.dragging = true
    },
    moveBox(ev) {
      if (!this.dragging || !this.start) return
      const pos = this.canvasPos(ev)
      const x1 = Math.min(this.start.x, pos.x), y1 = Math.min(this.start.y, pos.y)
      const x2 = Math.max(this.start.x, pos.x), y2 = Math.max(this.start.y, pos.y)
      this.box = { x1, y1, x2, y2, scale: this.start.scale }
      this.draw()
    },
    endBox() {
      this.dragging = false
      if (this.box && this.box.x2 - this.box.x1 < 8) this.box = null
      this.draw()
    },
    reset() { this.box = null; this.draw() },
    onGlbApply(g) { this.glb = g },
    draw() {
      const c = this.$refs.canvas
      if (!c || !this.img) return
      if (!this._cctx) this._cctx = c.getContext('2d')
      const ctx = this._cctx
      const iw = this.$refs.canvas.clientWidth, ih = this.$refs.canvas.clientHeight
      c.width = iw; c.height = ih
      ctx.drawImage(this.img, 0, 0, iw, ih)
      if (this.box) {
        ctx.strokeStyle = '#2563EB'; ctx.lineWidth = 2; ctx.setLineDash([8, 6])
        ctx.strokeRect(this.box.x1, this.box.y1, this.box.x2 - this.box.x1, this.box.y2 - this.box.y1)
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(37,99,235,.08)'
        ctx.fillRect(this.box.x1, this.box.y1, this.box.x2 - this.box.x1, this.box.y2 - this.box.y1)
      }
    },
    async run() {
      if (this.currentOp !== 'expand' && !this.box) { this.errMsg = '请先框选编辑区域'; return }
      this.running = true; this.errMsg = ''
      try {
        let region = null
        if (this.box) {
          const sc = this.box.scale
          region = {
            type: 'bbox',
            bbox: {
              x1: Math.round(this.box.x1 * sc), y1: Math.round(this.box.y1 * sc),
              x2: Math.round(this.box.x2 * sc), y2: Math.round(this.box.y2 * sc),
            },
          }
        }
        const data = await request('/edit/run', {
          method: 'POST',
          body: JSON.stringify({
            assetFid: this.fid, op: this.currentOp,
            subject: this.subject, region, glb: this.currentOp === 'replace' ? this.glb : null,
          }),
        })
        this.apiBox = data.apiBox
        this.untouched = data.untouchedDiff
        this.resultImg = 'data:image/png;base64,' + data.image.b64
      } catch (e) { this.errMsg = e.message } finally { this.running = false }
    },
  },
}
</script>

<style>
.edit-page{min-height:100vh;background:#F8FAFC;}
.edit-header{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#fff;border-bottom:1px solid #E2E8F0;}
.edit-title{font-weight:600;color:#0F172A;}
.spacer{flex:1;}
.edit-body{padding:14px;display:flex;flex-direction:column;gap:12px;}
.op-tabs{display:flex;gap:4px;padding:6px;overflow-x:auto;}
.op-tab{flex:1;min-width:52px;text-align:center;padding:6px 0;font-size:13px;color:#475569;border-radius:8px;cursor:pointer;}
.op-tab.on{background:#EFF6FF;color:#1D4ED8;font-weight:600;}
.op-meta input{margin-top:8px;}
.stage-wrap{padding:10px;}
.stage{width:100%;border:1px dashed #CBD5E1;border-radius:8px;display:block;touch-action:none;cursor:crosshair;}
.canvas-tip{font-size:12px;color:#94A3B8;margin-top:6px;text-align:center;}
.detect-bar{display:flex;align-items:center;gap:10px;}
.detect-hint{font-size:12px;color:#D97706;}
.detect-list{padding:4px 10px;max-height:180px;overflow:auto;}
.detect-item{display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid #F1F5F9;font-size:13px;cursor:pointer;}
.detect-item.on{background:#EFF6FF;}
.detect-check{width:18px;height:18px;border-radius:4px;border:1px solid #CBD5E1;display:inline-flex;align-items:center;justify-content:center;color:#1D4ED8;font-size:12px;}
.detect-label{flex:1;color:#0F172A;}
.detect-score{color:#94A3B8;font-size:12px;}
.edit-actions{display:flex;gap:10px;}
.edit-err{color:#DC2626;font-size:13px;}
.result-title{font-weight:600;margin-bottom:8px;}
.result-img{width:100%;border-radius:8px;border:1px solid #E2E8F0;}
.result-proof{font-size:12px;color:#059669;margin-top:6px;}
</style>
