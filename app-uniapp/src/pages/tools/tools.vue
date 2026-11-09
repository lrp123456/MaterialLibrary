<template>
  <view class="page" :style="themeStyle">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />
    <view class="topbar">
      <view class="back" @click="goBack" hover-class="back-hover"><text class="back-t">‹</text></view>
      <text class="topbar-title">媒体工具</text>
      <view class="topbar-side" />
    </view>

    <scroll-view scroll-y class="scroll" :style="{ height: 'calc(100vh - ' + (statusBarHeight + 48) + 'px)' }">
      <!-- 工具切换 -->
      <view class="seg-wrap">
        <view
          v-for="t in tabs"
          :key="t.key"
          class="seg"
          :class="{ active: tab === t.key }"
          @click="tab = t.key"
        >
          <text class="seg-ico">{{ t.icon }}</text>
          <text class="seg-t">{{ t.label }}</text>
        </view>
      </view>

      <!-- 素材来源 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">素材来源</text>
          <text v-if="source.name" class="card-side">{{ source.kind === 'local' ? '本机' : '素材库' }}</text>
        </view>
        <view v-if="source.name" class="src-row">
          <image v-if="posterSrc" class="src-thumb" :src="posterSrc" mode="aspectFill" />
          <view v-else class="src-thumb empty"><text class="src-thumb-t">▶</text></view>
          <view class="src-meta">
            <text class="src-name" number-of-lines="1">{{ source.name }}</text>
            <text class="src-sub">{{ sourceSub }}</text>
          </view>
        </view>
        <view v-else class="src-empty">
          <text class="src-empty-t">先挑一段视频，三个工具都基于同一段素材</text>
        </view>
        <view class="btn-row">
          <view class="btn-line" @click="openPicker" hover-class="btn-line-hover">
            <text class="btn-line-t">素材库选视频</text>
          </view>
          <view class="btn-line" @click="chooseLocalVideo" hover-class="btn-line-hover">
            <text class="btn-line-t">相册选视频</text>
          </view>
        </view>
        <view v-if="sourceBusy" class="hint">{{ sourceBusyText }}</view>
        <view v-if="meta.duration" class="meta-row">
          <text class="meta-t">{{ meta.width }} × {{ meta.height }}</text>
          <text class="meta-dot">·</text>
          <text class="meta-t">{{ meta.fps ? meta.fps.toFixed(1) + ' fps' : '未知帧率' }}</text>
          <text class="meta-dot">·</text>
          <text class="meta-t">{{ fmtTime(meta.duration) }}</text>
        </view>
        <view v-if="sourceErr" class="err">{{ sourceErr }}</view>
      </view>

      <!-- 寻帧 -->
      <block v-if="tab === 'frames'">
        <view class="card">
          <view class="card-head">
            <text class="card-title">逐帧寻读</text>
            <text class="card-side">{{ fmtTime(frameTime) }}</text>
          </view>
          <view class="frame-stage" @click="loadFrame('full')">
            <image v-if="frameSrc" class="frame-img" :src="frameSrc" mode="aspectFit" @error="onFrameImgError" />
            <view v-else class="frame-placeholder">
              <text class="frame-ph-t">{{ frameBusy ? '正在解码…' : '选好视频后这里显示当前帧' }}</text>
            </view>
            <view v-if="frameBusy" class="frame-mask"><view class="spinner" /></view>
          </view>
          <text class="hint">轻点画面按原画导出预览；拖动滑块或点胶片条跳帧</text>

          <scroll-view v-if="filmstrip.length" scroll-x class="strip-scroll" :show-scrollbar="false">
            <view class="strip">
              <view
                v-for="(f, i) in filmstrip"
                :key="i"
                class="strip-item"
                :class="{ active: Math.abs(f.time - frameTime) < 0.15 }"
                @click="jumpTo(f.time)"
              >
                <image class="strip-img" :src="f.dataUrl" mode="aspectFill" />
                <text class="strip-t">{{ fmtTime(f.time) }}</text>
              </view>
            </view>
          </scroll-view>

          <view v-if="meta.duration" class="slider-block">
            <slider
              :min="0"
              :max="Math.max(0.1, meta.duration)"
              :step="0.04"
              :value="frameTime"
              activeColor="#0A6CFF"
              block-size="20"
              @changing="onFrameSlider"
              @change="onFrameSlider"
            />
          </view>

          <view class="btn-row">
            <view class="btn-primary" :class="{ disabled: !frameSrc || frameBusy }" @click="saveFrame" hover-class="btn-primary-hover">
              <text class="btn-primary-t">{{ savingFrame ? '归档中…' : '保存当前帧到素材库' }}</text>
            </view>
          </view>
          <view v-if="frameNote" class="hint ok">{{ frameNote }}</view>
        </view>
      </block>

      <!-- 格式转换 / 音频提取 -->
      <block v-if="tab === 'convert'">
        <view class="card">
          <text class="card-title">目标格式</text>
          <view class="chips">
            <view
              v-for="f in convertFormats"
              :key="f.key"
              class="chip"
              :class="{ active: convertFormat === f.key }"
              @click="pickConvertFormat(f.key)"
            >{{ f.label }}</view>
          </view>

          <view class="switch-row">
            <view class="switch-meta">
              <text class="switch-t">只提取音频</text>
              <text class="switch-s">选 mp3 / wav 自动切换为提取音频</text>
            </view>
            <switch :checked="extractAudio" color="#0A6CFF" @change="onExtractAudio" />
          </view>

          <view v-if="extractAudio" class="switch-row">
            <view class="switch-meta">
              <text class="switch-t">人声分离 / 降噪</text>
              <text class="switch-s">GPU 可用时走 MDX-Net，否则本地频域降噪</text>
            </view>
            <switch :checked="cleanVocal" color="#0A6CFF" @change="onCleanVocal" />
          </view>

          <view v-if="!extractAudio" class="slider-block">
            <view class="slider-head">
              <text class="slider-label">画质 CRF</text>
              <text class="slider-value">{{ convertCrf }}</text>
            </view>
            <slider :min="14" :max="32" :step="1" :value="convertCrf" activeColor="#0A6CFF" block-size="20" @change="onConvertCrf" />
            <text class="hint">数值越小画质越高、体积越大；18–23 适合归档，26+ 适合快速分享</text>
          </view>

          <view class="btn-row">
            <view class="btn-primary" :class="{ disabled: converting || !source.name }" @click="runConvert" hover-class="btn-primary-hover">
              <text class="btn-primary-t">{{ converting ? convertStage : '开始转换' }}</text>
            </view>
          </view>
          <view v-if="convertErr" class="err">{{ convertErr }}</view>
        </view>

        <view v-if="result" class="card">
          <view class="card-head">
            <text class="card-title">转换结果</text>
            <text class="card-side">{{ formatSize(result.size) }}</text>
          </view>
          <video v-if="resultIsVideo" class="result-video" :src="resultUrl" controls />
          <image v-else-if="resultIsImage" class="result-gif" :src="resultUrl" mode="widthFix" />
          <view v-else class="result-audio">
            <text class="result-audio-t">🎧 {{ result.outputFile }}</text>
            <audio :src="resultUrl" controls />
          </view>
          <view class="btn-row">
            <view class="btn-line" @click="saveResultToAlbum" hover-class="btn-line-hover">
              <text class="btn-line-t">保存到相册</text>
            </view>
            <view class="btn-primary" :class="{ disabled: archiving }" @click="archiveResult" hover-class="btn-primary-hover">
              <text class="btn-primary-t">{{ archiving ? '归档中…' : '归档到素材库' }}</text>
            </view>
          </view>
          <view v-if="resultNote" class="hint ok">{{ resultNote }}</view>
        </view>
      </block>

      <!-- 视频智能压缩 -->
      <block v-if="tab === 'compress'">
        <view class="card">
          <text class="card-title">压缩档位</text>
          <view class="chips">
            <view
              v-for="p in compressPresets"
              :key="p.key"
              class="chip"
              :class="{ active: compressPreset === p.key }"
              @click="applyPreset(p)"
            >{{ p.label }}</view>
          </view>
          <view class="slider-block">
            <view class="slider-head">
              <text class="slider-label">CRF</text>
              <text class="slider-value">{{ compressCrf }}</text>
            </view>
            <slider :min="18" :max="32" :step="1" :value="compressCrf" activeColor="#0A6CFF" block-size="20" @change="onCompressCrf" />
            <text class="hint">{{ compressHint }}</text>
          </view>
          <view class="btn-row">
            <view class="btn-primary" :class="{ disabled: converting || !source.name }" @click="runCompress" hover-class="btn-primary-hover">
              <text class="btn-primary-t">{{ converting ? compressStage : '启动智能压缩' }}</text>
            </view>
          </view>
          <view v-if="convertErr" class="err">{{ convertErr }}</view>
        </view>

        <view v-if="result" class="card">
          <view class="card-head">
            <text class="card-title">压缩结果</text>
            <text class="card-side">{{ formatSize(result.size) }}</text>
          </view>
          <video class="result-video" :src="resultUrl" controls />
          <view class="btn-row">
            <view class="btn-line" @click="saveResultToAlbum" hover-class="btn-line-hover">
              <text class="btn-line-t">保存到相册</text>
            </view>
            <view class="btn-primary" :class="{ disabled: archiving }" @click="archiveResult" hover-class="btn-primary-hover">
              <text class="btn-primary-t">{{ archiving ? '归档中…' : '归档到素材库' }}</text>
            </view>
          </view>
          <view v-if="resultNote" class="hint ok">{{ resultNote }}</view>
        </view>
      </block>

      <view style="height: 40rpx" />
    </scroll-view>

    <!-- 素材库视频选择 -->
    <view v-if="pickerOpen" class="mask" @click="pickerOpen = false">
      <view class="sheet" @click.stop>
        <view class="sheet-head">
          <text class="sheet-title">选择视频素材</text>
          <text class="sheet-close" @click="pickerOpen = false">✕</text>
        </view>
        <input class="search" v-model="pickerKeyword" placeholder="搜索文件名 / 标签" placeholder-class="ph" @confirm="loadPicker(true)" />
        <scroll-view scroll-y class="sheet-list" @scrolltolower="loadPicker(false)">
          <view v-if="pickerLoading && !pickerItems.length" class="sheet-state"><view class="spinner" /></view>
          <view v-else-if="!pickerItems.length" class="sheet-state">
            <text class="sheet-state-t">{{ pickerErr || '素材库里还没有视频' }}</text>
          </view>
          <view
            v-for="it in pickerItems"
            :key="it.fid"
            class="pick-row"
            @click="usePickerItem(it)"
          >
            <image class="pick-thumb" :src="it.thumb" mode="aspectFill" />
            <view class="pick-meta">
              <text class="pick-name" number-of-lines="1">{{ it.name }}</text>
              <text class="pick-sub">{{ it.duration ? fmtTime(it.duration) : '视频' }}</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script>
import { fetchAssets, mediaUrl, posterUrl, downloadAndSaveToAlbum } from '../../service/ViewerApi'
import {
  videoOpen,
  videoFilmstrip,
  frameAt,
  convertVideo,
  registerToolResult,
  registerFrameResult,
  toolMediaUrl,
} from '../../service/MediaToolsApi'
import { currentVars } from '../../common/theme'

const TABS = [
  { key: 'frames', label: '逐帧寻读', icon: '🎬' },
  { key: 'convert', label: '转换提取', icon: '🔄' },
  { key: 'compress', label: '智能压缩', icon: '🗜️' },
]

const CONVERT_FORMATS = [
  { key: 'mp4', label: 'MP4' },
  { key: 'mov', label: 'MOV' },
  { key: 'webm', label: 'WebM' },
  { key: 'gif', label: 'GIF' },
  { key: 'mp3', label: 'MP3' },
  { key: 'wav', label: 'WAV' },
]

const COMPRESS_PRESETS = [
  { key: 'wechat', label: '微信分享', crf: 28 },
  { key: 'web', label: '网页播放', crf: 25 },
  { key: 'fidelity', label: '高保真', crf: 21 },
]

export default {
  data() {
    return {
      statusBarHeight: 20,
      tabs: TABS,
      tab: 'frames',
      source: { kind: '', fid: '', videoPath: '', filePath: '', name: '' },
      sourceBusy: false,
      sourceBusyText: '',
      sourceErr: '',
      meta: { width: 0, height: 0, fps: 0, duration: 0, gopSec: 2, frame0: '' },
      filmstrip: [],
      frameTime: 0,
      frameSrc: '',
      frameBusy: false,
      savingFrame: false,
      frameNote: '',
      convertFormats: CONVERT_FORMATS,
      convertFormat: 'mp4',
      extractAudio: false,
      cleanVocal: false,
      convertCrf: 23,
      converting: false,
      convertStage: '',
      convertErr: '',
      compressPresets: COMPRESS_PRESETS,
      compressPreset: 'web',
      compressCrf: 25,
      compressStage: '',
      result: null,
      resultNote: '',
      archiving: false,
      pickerOpen: false,
      pickerKeyword: '',
      pickerItems: [],
      pickerPage: 1,
      pickerFinished: false,
      pickerLoading: false,
      pickerErr: '',
      frameSeq: 0,
      frameTimer: null,
    }
  },
  computed: {
    themeStyle() {
      return currentVars()
    },
    posterSrc() {
      if (this.source.fid) return posterUrl(this.source.fid)
      return this.meta.frame0 || ''
    },
    sourceSub() {
      if (this.source.kind === 'local') return this.source.videoPath ? '已上传到服务端' : '本机文件，操作时自动上传'
      return this.source.fid || '素材库视频'
    },
    resultUrl() {
      return this.result && this.result.downloadUrl ? toolMediaUrl(this.result.downloadUrl) : ''
    },
    resultIsVideo() {
      const f = this.result && String(this.result.format || '').toLowerCase()
      // GIF 也走转码端点，但产物是图片：不能因为 type=video 就按 <video> 渲染/存相册
      if (f === 'gif') return false
      return f === 'mp4' || f === 'mov' || f === 'webm' || Boolean(this.result && this.result.type === 'video')
    },
    resultIsImage() {
      return this.result && String(this.result.format || '').toLowerCase() === 'gif'
    },
    compressHint() {
      if (this.compressPreset === 'wechat') return '微信/社交分享优先，画质让位于体积'
      if (this.compressPreset === 'fidelity') return '尽量保留画面细节，体积收益较小'
      return '网页播放均衡档，体积与观感平衡'
    },
  },
  onLoad(query) {
    try {
      const sys = uni.getSystemInfoSync()
      this.statusBarHeight = sys.statusBarHeight || 20
    } catch (e) {}
    const q = query || {}
    if (q.fid) {
      this.source = { kind: 'cloud', fid: String(q.fid), videoPath: '', filePath: '', name: q.name ? String(q.name) : String(q.fid) }
      this.tab = q.tab && TABS.some((t) => t.key === q.tab) ? q.tab : 'frames'
      this.loadSourceMeta()
    }
  },
  onUnload() {
    if (this.frameTimer) clearTimeout(this.frameTimer)
  },
  methods: {
    goBack() {
      uni.navigateBack()
    },
    fmtTime(sec) {
      const s = Math.max(0, Number(sec) || 0)
      const m = Math.floor(s / 60)
      const r = s - m * 60
      return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1)
    },
    formatSize(bytes) {
      const b = Number(bytes) || 0
      if (!b) return '—'
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
      return (b / 1024 / 1024).toFixed(1) + ' MB'
    },
    apiSource() {
      if (this.source.fid) return { fid: this.source.fid }
      if (this.source.videoPath) return { videoPath: this.source.videoPath }
      return null
    },
    async ensureUploaded() {
      if (this.source.fid || this.source.videoPath) return this.apiSource()
      if (!this.source.filePath) throw new Error('请先选择视频')
      this.sourceBusy = true
      this.sourceBusyText = '正在上传视频到服务端…'
      try {
        const { uploadToolVideo } = await import('../../service/MediaToolsApi')
        const up = await uploadToolVideo(this.source.filePath, this.source.name || 'media_tool_source.mp4')
        if (!up || !up.videoPath) throw new Error('上传失败：服务端没有返回临时文件')
        this.source.videoPath = up.videoPath
        return { videoPath: up.videoPath }
      } finally {
        this.sourceBusy = false
        this.sourceBusyText = ''
      }
    },
    resetResult() {
      this.result = null
      this.resultNote = ''
      this.convertErr = ''
    },
    async chooseLocalVideo() {
      this.sourceErr = ''
      uni.chooseVideo({
        sourceType: ['album', 'camera'],
        compressed: false,
        success: async (res) => {
          const path = res.tempFilePath
          const name = (path || '').split('/').pop() || 'media_tool_source.mp4'
          this.source = { kind: 'local', fid: '', videoPath: '', filePath: path, name }
          this.meta = { width: 0, height: 0, fps: 0, duration: res.duration || 0, gopSec: 2, frame0: '' }
          this.filmstrip = []
          this.frameSrc = ''
          this.frameTime = 0
          this.resetResult()
          if (this.tab === 'frames') await this.loadSourceMeta()
        },
        fail: (err) => {
          if (err && /cancel/i.test(err.errMsg || '')) return
          this.sourceErr = (err && err.errMsg) || '选择视频失败'
        },
      })
    },
    openPicker() {
      this.pickerOpen = true
      this.pickerErr = ''
      if (!this.pickerItems.length) this.loadPicker(true)
    },
    async loadPicker(reset) {
      if (this.pickerLoading) return
      if (reset) {
        this.pickerPage = 1
        this.pickerItems = []
        this.pickerFinished = false
      }
      if (this.pickerFinished) return
      this.pickerLoading = true
      try {
        const data = await fetchAssets({
          page: this.pickerPage,
          pageSize: 20,
          keyword: this.pickerKeyword.trim(),
          mediaType: 'video',
          skipFacets: true,
        })
        const items = (data.items || []).map((it) => ({
          fid: it.fid,
          name: it.file_name || it.fid,
          duration: Number(it.duration) || 0,
          thumb: posterUrl(it.fid),
        }))
        this.pickerItems = this.pickerItems.concat(items)
        this.pickerFinished = items.length < 20 || this.pickerItems.length >= Number(data.total || 0)
        this.pickerPage += 1
      } catch (e) {
        this.pickerErr = e.message || '加载视频失败'
      } finally {
        this.pickerLoading = false
      }
    },
    async usePickerItem(it) {
      this.pickerOpen = false
      this.sourceErr = ''
      this.source = { kind: 'cloud', fid: it.fid, videoPath: '', filePath: '', name: it.name }
      this.meta = { width: 0, height: 0, fps: 0, duration: it.duration || 0, gopSec: 2, frame0: '' }
      this.filmstrip = []
      this.frameSrc = ''
      this.frameTime = 0
      this.resetResult()
      await this.loadSourceMeta()
    },
    async loadSourceMeta() {
      if (!this.source.name) return
      this.sourceBusy = true
      this.sourceBusyText = this.source.kind === 'local' ? '正在上传并解析视频…' : '正在解析视频…'
      this.frameBusy = true
      try {
        const body = await this.ensureUploaded()
        const data = await videoOpen(body)
        this.meta = {
          width: data.width || 0,
          height: data.height || 0,
          fps: Number(data.fps) || 0,
          duration: Number(data.duration) || 0,
          gopSec: Number(data.gopSec) || 2,
          frame0: data.frame0 || '',
        }
        this.frameSrc = data.frame0 || ''
        this.frameTime = 0
        if (this.tab === 'frames') this.loadFilmstrip()
      } catch (e) {
        this.sourceErr = e.message || '解析视频失败'
      } finally {
        this.sourceBusy = false
        this.sourceBusyText = ''
        this.frameBusy = false
      }
    },
    async loadFilmstrip() {
      try {
        const body = this.apiSource()
        if (!body) return
        if (!this.apiSource().fid && !this.apiSource().videoPath) return
        this.filmstrip = await videoFilmstrip(body, 12)
      } catch (e) {
        this.filmstrip = []
      }
    },
    jumpTo(time) {
      this.frameTime = Number(time) || 0
      this.loadFrame('preview')
    },
    onFrameSlider(e) {
      const v = Number(e.detail && e.detail.value)
      if (!Number.isFinite(v)) return
      this.frameTime = v
      if (this.frameTimer) clearTimeout(this.frameTimer)
      this.frameTimer = setTimeout(() => this.loadFrame('preview'), 120)
    },
    async loadFrame(purpose) {
      const body = this.apiSource()
      if (!body) {
        this.frameBusy = false
        return
      }
      const seq = ++this.frameSeq
      this.frameBusy = true
      try {
        const data = await frameAt(body, {
          time: this.frameTime,
          purpose: purpose === 'full' ? 'full' : 'preview',
          maxEdge: 1280,
          gopSec: this.meta.gopSec,
          fps: this.meta.fps || 30,
          duration: this.meta.duration,
        })
        if (seq !== this.frameSeq) return
        if (data && data.dataUrl) this.frameSrc = data.dataUrl
      } catch (e) {
        if (seq === this.frameSeq) this.sourceErr = e.message || '取帧失败'
      } finally {
        if (seq === this.frameSeq) this.frameBusy = false
      }
    },
    onFrameImgError() {
      this.frameSrc = ''
    },
    async saveFrame() {
      if (this.savingFrame || !this.source.name) return
      const body = this.apiSource()
      if (!body) return
      this.savingFrame = true
      this.frameNote = ''
      try {
        const data = await frameAt(body, {
          time: this.frameTime,
          purpose: 'original',
          gopSec: this.meta.gopSec,
          fps: this.meta.fps || 30,
          duration: this.meta.duration,
        })
        const out = await registerFrameResult({
          dataUrl: data.dataUrl,
          prompt: '视频抽帧 ' + this.source.name + ' ' + this.fmtTime(this.frameTime),
          frame: Math.round(this.frameTime * (this.meta.fps || 30)),
          time: this.frameTime,
        })
        this.frameNote = out && out.fid ? '已归档到素材库：' + out.fid : '已归档到素材库'
      } catch (e) {
        this.sourceErr = e.message || '保存帧失败'
      } finally {
        this.savingFrame = false
      }
    },
    pickConvertFormat(key) {
      this.convertFormat = key
      this.extractAudio = key === 'mp3' || key === 'wav'
      if (this.extractAudio) this.cleanVocal = false
    },
    onExtractAudio(e) {
      const on = !!(e.detail && e.detail.value)
      this.extractAudio = on
      if (on && !['mp3', 'wav'].includes(this.convertFormat)) this.convertFormat = 'mp3'
      if (!on && ['mp3', 'wav'].includes(this.convertFormat)) this.convertFormat = 'mp4'
    },
    onCleanVocal(e) {
      this.cleanVocal = !!(e.detail && e.detail.value)
    },
    onConvertCrf(e) {
      this.convertCrf = Number(e.detail && e.detail.value) || 23
    },
    onCompressCrf(e) {
      this.compressCrf = Number(e.detail && e.detail.value) || 25
      this.compressPreset = ''
    },
    applyPreset(p) {
      this.compressPreset = p.key
      this.compressCrf = p.crf
    },
    async runConvert() {
      await this.runTool('convert')
    },
    async runCompress() {
      await this.runTool('compress')
    },
    async runTool(mode) {
      if (this.converting || !this.source.name) return
      this.convertErr = ''
      this.result = null
      this.resultNote = ''
      this.converting = true
      const isCompress = mode === 'compress'
      this.convertStage = '正在准备视频…'
      this.compressStage = '正在准备视频…'
      try {
        const body = await this.ensureUploaded()
        const format = isCompress ? 'mp4' : this.convertFormat
        const extract = !isCompress && (this.extractAudio || format === 'mp3' || format === 'wav')
        this.convertStage = extract ? '正在提取音频…' : '正在转码…'
        this.compressStage = '正在两趟量化压缩…'
        const data = await convertVideo({
          source: body,
          targetFormat: format,
          crf: isCompress ? this.compressCrf : this.convertCrf,
          extractAudio: extract,
          cleanVocal: extract && this.cleanVocal,
        })
        this.result = data
      } catch (e) {
        this.convertErr = e.message || '处理失败'
      } finally {
        this.converting = false
        this.convertStage = ''
        this.compressStage = ''
      }
    },
    async saveResultToAlbum() {
      if (!this.result || !this.result.downloadUrl) return
      try {
        await downloadAndSaveToAlbum({
          url: this.resultUrl,
          fileName: this.result.outputFile || 'media_tool_result',
          isVideo: this.result.type !== 'audio',
          isAudio: this.result.type === 'audio',
        })
        this.resultNote = '已保存到相册'
      } catch (e) {
        this.convertErr = e.message || '保存到相册失败'
      }
    },
    async archiveResult() {
      if (!this.result || !this.result.downloadUrl || this.archiving) return
      this.archiving = true
      this.resultNote = ''
      try {
        const out = await registerToolResult({
          previewUrl: this.result.downloadUrl,
          prompt: '媒体工具 · ' + this.source.name + ' · ' + (this.result.format || ''),
          model: 'ffmpeg',
          mode: this.tab === 'compress' ? 'compress' : 'convert',
        })
        this.resultNote = out && out.fid ? '已归档到素材库：' + out.fid : '已归档到素材库'
      } catch (e) {
        this.convertErr = e.message || '归档失败'
      } finally {
        this.archiving = false
      }
    },
  },
}
</script>

<style>
.page {
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
}
.status-bar {
  background: var(--bg);
}
.topbar {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--bg);
}
.topbar-side {
  width: 40px;
}
.back {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
}
.back-hover {
  background: var(--surface2);
}
.back-t {
  font-size: 26px;
  line-height: 1;
  color: var(--ink);
}
.topbar-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
}
.scroll {
  box-sizing: border-box;
  padding: 0 16px;
}
.seg-wrap {
  display: flex;
  gap: 8px;
  margin: 8px 0 12px;
}
.seg {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 8px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line);
  transition: background var(--ms, 320ms) var(--ease-out, ease-out);
}
.seg.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
}
.seg-ico {
  font-size: 14px;
}
.seg-t {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink2);
}
.seg.active .seg-t {
  color: var(--accent);
}
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--cardr, 12px);
  padding: 14px;
  margin-bottom: 12px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}
.card-side {
  font-size: 12px;
  color: var(--ink2);
}
.src-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.src-thumb {
  width: 64px;
  height: 44px;
  border-radius: 8px;
  background: var(--surface2);
  flex-shrink: 0;
}
.src-thumb.empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
.src-thumb-t {
  color: var(--ink2);
  font-size: 18px;
}
.src-meta {
  flex: 1;
  min-width: 0;
}
.src-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.src-sub {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.src-empty {
  padding: 12px;
  border-radius: 10px;
  background: var(--surface2);
  margin-bottom: 10px;
}
.src-empty-t {
  font-size: 12px;
  color: var(--ink2);
}
.btn-row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.btn-line,
.btn-primary {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  border-radius: 10px;
}
.btn-line {
  background: var(--surface2);
  border: 1px solid var(--line);
}
.btn-primary {
  background: var(--accent);
}
.btn-primary.disabled,
.btn-line.disabled {
  opacity: 0.45;
}
.btn-line-t {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.btn-primary-t {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}
.btn-line-hover {
  background: var(--accent-soft);
}
.btn-primary-hover {
  opacity: 0.88;
}
.hint {
  display: block;
  margin-top: 8px;
  font-size: 11px;
  color: var(--ink2);
  line-height: 1.5;
}
.hint.ok {
  color: var(--ok);
}
.err {
  margin-top: 8px;
  font-size: 12px;
  color: var(--danger);
  line-height: 1.5;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
.meta-t {
  font-size: 11px;
  color: var(--ink2);
}
.meta-dot {
  font-size: 11px;
  color: var(--ink2);
}
.frame-stage {
  position: relative;
  width: 100%;
  height: 210px;
  border-radius: 10px;
  overflow: hidden;
  background: #141414;
  display: flex;
  align-items: center;
  justify-content: center;
}
.frame-img {
  width: 100%;
  height: 100%;
}
.frame-placeholder {
  padding: 0 24px;
}
.frame-ph-t {
  color: #9aa0a6;
  font-size: 12px;
  text-align: center;
}
.frame-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
}
.strip-scroll {
  margin-top: 10px;
  white-space: nowrap;
}
.strip {
  display: flex;
  gap: 6px;
}
.strip-item {
  width: 76px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  background: var(--surface2);
}
.strip-item.active {
  border-color: var(--accent);
}
.strip-img {
  width: 76px;
  height: 44px;
  display: block;
}
.strip-t {
  display: block;
  text-align: center;
  font-size: 9px;
  color: var(--ink2);
  padding: 2px 0;
}
.slider-block {
  margin-top: 8px;
}
.slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}
.slider-label {
  font-size: 12px;
  color: var(--ink2);
}
.slider-value {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.chip {
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--surface2);
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--ink2);
}
.chip.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent);
  font-weight: 600;
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}
.switch-meta {
  flex: 1;
  min-width: 0;
}
.switch-t {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.switch-s {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink2);
}
.result-video {
  width: 100%;
  height: 200px;
  border-radius: 10px;
  background: #000;
}
.result-gif {
  width: 100%;
  border-radius: 10px;
}
.result-audio {
  padding: 10px;
  border-radius: 10px;
  background: var(--surface2);
}
.result-audio-t {
  display: block;
  font-size: 12px;
  color: var(--ink);
  margin-bottom: 8px;
  word-break: break-all;
}
.spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  animation: mt-spin 0.9s linear infinite;
}
@keyframes mt-spin {
  to {
    transform: rotate(360deg);
  }
}
.mask {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  z-index: 60;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 76vh;
  background: var(--surface);
  border-radius: var(--topr, 30px) var(--topr, 30px) 0 0;
  padding: 14px 16px calc(14px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.sheet-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}
.sheet-close {
  font-size: 16px;
  color: var(--ink2);
  padding: 4px 6px;
}
.search {
  height: 38px;
  border-radius: 10px;
  background: var(--surface2);
  border: 1px solid var(--line);
  padding: 0 12px;
  font-size: 13px;
  color: var(--ink);
  margin-bottom: 10px;
}
.ph {
  color: var(--ink2);
}
.sheet-list {
  flex: 1;
  min-height: 120px;
}
.sheet-state {
  padding: 30px 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet-state-t {
  font-size: 12px;
  color: var(--ink2);
}
.pick-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.pick-thumb {
  width: 72px;
  height: 48px;
  border-radius: 8px;
  background: var(--surface2);
  flex-shrink: 0;
}
.pick-meta {
  flex: 1;
  min-width: 0;
}
.pick-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pick-sub {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink2);
}
</style>
