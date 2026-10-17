<template>
  <view class="edit-page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />
    <view class="top-bar">
      <view class="tb-btn" @click="goBack">‹ 返回</view>
      <text class="tb-title">精准编辑</text>
      <view class="tb-spacer"></view>
    </view>

    <scroll-view class="edit-body" scroll-y>
      <!-- 底图 + 选区 -->
      <view class="img-wrap">
        <image v-if="srcImage" class="edit-img" :src="srcImage" mode="widthFix" @load="onImgLoad" />
        <TouchSelector
          v-if="srcImage"
          ref="selector"
          :image-url="srcImage"
          :detections="detections"
          :mode="toolMode"
          @select="onSelect"
        />
      </view>

      <!-- ch04 检测 -->
      <view class="card">
        <view class="card-title">检测/分割</view>
        <view class="seg-row">
          <view class="op-pill" :class="{ active: toolMode === 'tap' }" @click="switchTool('tap')">检测点选</view>
          <view class="op-pill" :class="{ active: toolMode === 'box' }" @click="switchTool('box')">手动画框</view>
          <view class="op-pill" :class="{ active: toolMode === 'quad' }" @click="switchTool('quad')">四点定位</view>
          <view class="op-pill" :class="{ active: toolMode === 'multi' }" @click="switchTool('multi')">多选合并</view>
        </view>
        <view class="action-row">
          <button class="btn-ghost" :loading="segmenting" @click="runSegment">运行实例分割</button>
        </view>
        <view v-if="segNote" class="note">{{ segNote }}</view>
      </view>

      <!-- ch03 六操作 -->
      <view class="card">
        <view class="card-title">快捷操作</view>
        <view class="op-grid">
          <view v-for="op in ops" :key="op.id" :class="['op-cell', { active: op === selectedOp }]" @click="selectedOp = op.id">
            <text class="op-icon">{{ op.icon }}</text>
            <text class="op-name">{{ op.name }}</text>
          </view>
        </view>
        <input v-model="prompt" class="op-input" placeholder="描述要做什么（如：换成浅灰色三人沙发）" placeholder-class="ph" />
        <view v-if="selectedOp === 'replace'" class="op-ref">
          <button class="btn-ghost" @click="toggleGlb">替换物（GLB）调整</button>
        </view>
      </view>

      <!-- ch03 GLB 调整面板 -->
      <view v-if="glbOpen" class="card">
        <GlbAdjuster :model-name="glbName" :model-url="glbUrl" @confirm="onGlbConfirm" @change="onGlbChange" />
      </view>

      <!-- 执行 -->
      <view class="card">
        <view class="action-row">
          <button class="btn-primary" :loading="editing" @click="runEdit">生成并贴回</button>
          <button v-if="resultUrl" class="btn-ghost" @click="verifyPasteback">校验未选区</button>
        </view>
        <view v-if="editErr" class="err">{{ editErr }}</view>
        <view v-if="verifyResult" class="verify">
          未选区改动像素比例：{{ (verifyResult.outsideChangedRatio * 100).toFixed(2) }}%
          （{{ verifyResult.unselectedUntouched ? '未选区保持 ✓' : '存在改动 ✗' }}）
        </view>
      </view>

      <!-- 结果 -->
      <view v-if="resultUrl" class="card">
        <view class="card-title">结果（引擎：{{ engine }}）</view>
        <image class="result-img" :src="resultUrl" mode="widthFix" />
      </view>

      <view style="height: 40rpx" />
    </scroll-view>
  </view>
</template>

<script>
import TouchSelector from '../../components/TouchSelector.vue'
import GlbAdjuster from '../../components/GlbAdjuster.vue'
import { aiEdit, aiSegment, verifyPasteback, mediaUrl, genTaskSubmit } from '../../service/ViewerApi'

const OPS = [
  { id: 'replace', name: '替换', icon: '🔁' },
  { id: 'remove', name: '去除', icon: '🧽' },
  { id: 'add', name: '增加', icon: '➕' },
  { id: 'install', name: '安装', icon: '🛠️' },
  { id: 'space', name: '留白', icon: '↔️' },
  { id: 'expand', name: '扩图', icon: '🔍' }
]

export default {
  components: { TouchSelector, GlbAdjuster },
  data() {
    return {
      statusBarHeight: 20,
      fid: '',
      imgUrl: '',
      srcImage: '',
      naturalW: 0,
      naturalH: 0,
      detections: [],
      toolMode: 'box',
      selectedOp: 'replace',
      prompt: '',
      segmenting: false,
      editing: false,
      editErr: '',
      resultUrl: '',
      engine: '',
      verifyResult: null,
      segNote: '',
      glbOpen: false,
      glbUrl: '',
      glbName: '沙发替换物',
      glbTransform: { yaw: 180, pitch: 0, roll: 0, scale: 1, x: 0, y: 0 },
      ops: OPS
    }
  },
  onLoad(query) {
    this.statusBarHeight = (uni.getSystemInfoSync && uni.getSystemInfoSync().statusBarHeight) || 20
    this.fid = (query && query.fid) || ''
    this.imgUrl = (query && query.imgUrl) || ''
    // 服务端默认替换物（GLB），经 /api 提供本地下载
    if (this.fid) this.srcImage = mediaUrl(this.fid)
    else if (this.imgUrl) this.srcImage = this.imgUrl
  },
  methods: {
    goBack() {
      uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/home/home' }) })
    },
    onImgLoad(e) {
      this.naturalW = (e.detail && e.detail.width) || 0
      this.naturalH = (e.detail && e.detail.height) || 0
    },
    switchTool(m) {
      this.toolMode = m
      if (this.$refs.selector) this.$refs.selector.setMode(m)
    },
    onSelect(sel) {
      this.selection = sel
      this.editErr = ''
    },
    async runSegment() {
      this.segmenting = true
      this.segNote = ''
      try {
        // 用底图 URL（App 内走 media_token）
        const imageRef = this.fid || this.srcImage
        const data = await aiSegment({ image: imageRef, conf: 0.4, iou: 0.5 })
        this.detections = (data.detections || []).map((d) => ({
          id: d.id,
          label: d.label,
          bbox: d.bbox,   // 归一化 0-1
          polygon: d.polygon
        }))
        this.segNote = (data.fallback ? '检测服务不可用，已用内置兜底示例' : `识别到 ${this.detections.length} 个目标，点「检测点选」选择`)
      } catch (e) {
        this.segNote = '分割失败：' + e.message
      } finally {
        this.segmenting = false
      }
    },
    toggleGlb() {
      this.glbOpen = !this.glbOpen
    },
    onGlbChange(t) {
      this.glbTransform = t
    },
    onGlbConfirm(t) {
      this.glbTransform = t
      this.glbOpen = false
    },
    async runEdit() {
      const sel = this.selection
      if (!sel || (!sel.bbox && !sel.quad && !sel.polygon)) {
        uni.showToast({ title: '请先选区', icon: 'none' })
        return
      }
      this.editing = true
      this.editErr = ''
      this.resultUrl = ''
      try {
        const body = {
          fid: this.fid || undefined,
          imageUrl: this.fid ? undefined : this.srcImage,
          op: this.selectedOp,
          prompt: this.prompt || this.selectedOp,
          bbox: sel.bbox, quad: sel.quad, polygon: sel.polygon,
          glb: this.selectedOp === 'replace' && this.glbOpen ? this.glbTransform : undefined
        }
        const data = await aiEdit(body)
        const f = data.files && data.files[0]
        if (f && (f.localPath || f.url)) {
          this.resultUrl = await this.absUrl(f.url || f.localPath)
          this.engine = data.engine || 'server'
        }
      } catch (e) {
        this.editErr = e.message || '编辑失败'
      } finally {
        this.editing = false
      }
    },
    async verifyPasteback() {
      if (!this.resultUrl) return
      try {
        const data = await verifyPasteback({
          originalUrl: this.srcImage,
          editedUrl: this.resultUrl
        })
        this.verifyResult = data
      } catch (e) {
        this.editErr = '校验失败：' + e.message
      }
    },
    async absUrl(u) {
      if (!u) return ''
      if (/^https?:\/\//.test(u)) return u
      // 服务端相对路径：拼当前服务器地址
      const { store } = require('../../service/SyncStateStore')
      const srv = store.getServerUrl()
      return srv + (u.startsWith('/') ? u : '/' + u)
    }
  }
}
</script>

<style>
.edit-page { display: flex; flex-direction: column; height: 100vh; background: #F8FAFC; }
.status-bar { background: #F8FAFC; }
.top-bar { display: flex; align-items: center; justify-content: space-between; height: 96rpx; padding: 0 32rpx; background: #fff; border-bottom: 1rpx solid #E2E8F0; }
.tb-title { font-size: 34rpx; font-weight: 700; color: #0F172A; }
.tb-btn { font-size: 26rpx; color: #64748B; padding: 12rpx 16rpx; }
.tb-spacer { width: 100rpx; }
.edit-body { flex: 1; padding: 24rpx; }
.img-wrap { background: #fff; border-radius: 24rpx; padding: 16rpx; margin-bottom: 24rpx; }
.edit-img { width: 100%; border-radius: 16rpx; }
.result-img { width: 100%; border-radius: 16rpx; }
.card { background: #fff; border-radius: 24rpx; padding: 24rpx; margin-bottom: 24rpx; }
.card-title { font-size: 28rpx; font-weight: 700; color: #0F172A; margin-bottom: 16rpx; }
.seg-row { display: flex; flex-wrap: wrap; gap: 16rpx; }
.op-pill { padding: 14rpx 24rpx; background: #F1F5F9; border: 1rpx solid #E2E8F0; border-radius: 999rpx; font-size: 24rpx; color: #64748B; }
.op-pill.active { background: #2563EB; color: #fff; border-color: #2563EB; }
.op-grid { display: flex; flex-wrap: wrap; gap: 16rpx; }
.op-cell { width: calc(33.33% - 11rpx); background: #F8FAFC; border: 1rpx solid #E2E8F0; border-radius: 20rpx; padding: 24rpx 0; text-align: center; }
.op-cell.active { background: #EFF6FF; border-color: #2563EB; }
.op-icon { font-size: 40rpx; display: block; }
.op-name { font-size: 24rpx; color: #0F172A; display: block; margin-top: 8rpx; }
.op-input { margin-top: 20rpx; background: #F8FAFC; border: 1rpx solid #E2E8F0; border-radius: 16rpx; padding: 20rpx; font-size: 28rpx; }
.op-ref { margin-top: 16rpx; }
.ph { color: #94A3B8; font-size: 24rpx; }
.note { font-size: 24rpx; color: #64748B; margin-top: 16rpx; }
.err { font-size: 24rpx; color: #DC2626; margin-top: 16rpx; }
.verify { font-size: 24rpx; color: #059669; margin-top: 16rpx; }
.action-row { display: flex; gap: 20rpx; margin-top: 20rpx; }
.action-row button { flex: 1; margin: 0; font-size: 28rpx; }
.btn-primary { background: #2563EB; color: #fff; border-radius: 999rpx; }
.btn-ghost { background: #F1F5F9; color: #64748B; border-radius: 999rpx; }
.op-input::placeholder { color: #94A3B8; }
</style>
