<template>
  <view
    class="voice-btn"
    :class="{ recording, transcribing, disabled }"
    hover-class="voice-hover"
    @click="onTap"
    @longpress="onLongPress"
  >
    <view v-if="recording" class="voice-dot" />
    <AppIcon v-else name="mic" :size="16" :color="iconColor" />
    <text v-if="recording || transcribing" class="voice-t">{{ recording ? timeText : '转写中…' }}</text>
  </view>
</template>

<script>
import AppIcon from './AppIcon.vue'
import { transcribeVoiceFile, transcribeVoiceBlob, fetchAsrStatus } from '../service/ViewerApi'

const NUM_MAP = { 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' }

/** 语音里的「图一 / 图1 / 图片一 / 第1张图」归一化为 @图N，与桌面端一致 */
function normalizeSpeechRefMentions(str) {
  if (!str) return ''
  return String(str).replace(
    /(?:第\s*([一二两三四五六七八九十\d]+)\s*张\s*(?:图|图片)?|图片\s*([一二两三四五六七八九十\d]+)|图\s*([一二两三四五六七八九十\d]+))/g,
    (m, p1, p2, p3) => {
      const raw = p1 || p2 || p3
      return `@图${NUM_MAP[raw] || raw}`
    }
  )
}

const MAX_SECONDS = 60

export default {
  name: 'VoiceInputButton',
  components: { AppIcon },
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['text'],
  data() {
    return {
      recording: false,
      transcribing: false,
      seconds: 0
    }
  },
  computed: {
    timeText() {
      const m = Math.floor(this.seconds / 60)
      const s = this.seconds % 60
      return `${m}:${String(s).padStart(2, '0')}`
    },
    iconColor() {
      return this.disabled ? '#94A3B8' : '#475569'
    }
  },
  created() {
    this._timer = null
    this._discarded = false
    this._ignoreTap = false
    this._recorder = null
    this._mediaRecorder = null
    this._stream = null
    this._chunks = []
    this._statusChecked = false
  },
  mounted() {
    if (this.isH5()) return
    if (typeof uni === 'undefined' || typeof uni.getRecorderManager !== 'function') return
    const rec = uni.getRecorderManager()
    this._recorder = rec
    // 保存回调引用，卸载时 offStop/offError 注销：recorder 是单例，页面重挂会叠加监听
    this._onStop = (res) => {
      this.stopTimer()
      this.recording = false
      if (this._discarded) {
        this._discarded = false
        return
      }
      const path = res && res.tempFilePath
      if (path) this.handleRecordFile(path)
    }
    this._onError = (err) => {
      this.stopTimer()
      this.recording = false
      uni.showToast({ title: (err && err.errMsg) || '录音失败', icon: 'none' })
    }
    rec.onStop(this._onStop)
    rec.onError(this._onError)
  },
  beforeUnmount() {
    this.stopTimer()
    this.stopTracks()
    try {
      if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') this._mediaRecorder.stop()
      else if (this._recorder && this.recording) this._recorder.stop()
    } catch (e) {}
    try {
      if (this._recorder) {
        if (this._onStop && typeof this._recorder.offStop === 'function') this._recorder.offStop(this._onStop)
        if (this._onError && typeof this._recorder.offError === 'function') this._recorder.offError(this._onError)
      }
    } catch (e) {}
  },
  methods: {
    isH5() {
      try {
        const info = uni.getSystemInfoSync()
        return !!info && info.uniPlatform === 'web'
      } catch (e) {
        return false
      }
    },
    onTap() {
      if (this._ignoreTap) return
      if (this.transcribing) return
      if (this.recording) {
        this.stopRecording()
        return
      }
      if (this.disabled) {
        uni.showToast({ title: '当前状态不可录音', icon: 'none' })
        return
      }
      this.startRecording()
    },
    onLongPress() {
      if (!this.recording) return
      this._ignoreTap = true
      this._discarded = true
      this.stopRecording()
      setTimeout(() => { this._ignoreTap = false }, 600)
      uni.showToast({ title: '已取消本次录音', icon: 'none' })
    },
    startRecording() {
      this.checkStatus()
      if (this.isH5()) this.startH5()
      else this.startApp()
    },
    startApp() {
      if (!this._recorder) {
        uni.showToast({ title: '当前环境不支持录音', icon: 'none' })
        return
      }
      this._discarded = false
      this.seconds = 0
      try {
        this._recorder.start({
          duration: MAX_SECONDS * 1000,
          sampleRate: 16000,
          numberOfChannels: 1,
          encodeBitRate: 48000,
          format: 'mp3'
        })
        this.recording = true
        this.startTimer()
      } catch (e) {
        uni.showToast({ title: '无法启动录音', icon: 'none' })
      }
    },
    async startH5() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        uni.showToast({ title: '当前环境不支持麦克风录音', icon: 'none' })
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        this._stream = stream
        this._chunks = []
        let mimeType = ''
        if (typeof MediaRecorder !== 'undefined') {
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus'
          else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm'
          else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4'
        }
        const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        this._mediaRecorder = mr
        mr.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) this._chunks.push(e.data)
        }
        mr.onstop = () => {
          this.stopTimer()
          this.recording = false
          this.stopTracks()
          if (this._discarded) {
            this._discarded = false
            return
          }
          const type = mr.mimeType || 'audio/webm'
          const blob = new Blob(this._chunks, { type })
          this._chunks = []
          if (blob.size > 0) this.handleBlob(blob, type)
        }
        mr.start()
        this._discarded = false
        this.recording = true
        this.seconds = 0
        this.startTimer()
      } catch (err) {
        this.stopTracks()
        uni.showToast({ title: '无法访问麦克风：' + ((err && err.message) || ''), icon: 'none' })
      }
    },
    stopRecording() {
      this.stopTimer()
      if (this.isH5()) {
        const mr = this._mediaRecorder
        if (mr && mr.state !== 'inactive') mr.stop()
        else this.recording = false
        return
      }
      if (!this._recorder) {
        this.recording = false
        return
      }
      try {
        this._recorder.stop()
      } catch (e) {
        this.recording = false
      }
    },
    startTimer() {
      this.stopTimer()
      this._timer = setInterval(() => {
        this.seconds += 1
        if (this.seconds >= MAX_SECONDS) this.stopRecording()
      }, 1000)
    },
    stopTimer() {
      if (this._timer) {
        clearInterval(this._timer)
        this._timer = null
      }
    },
    stopTracks() {
      const stream = this._stream
      if (stream && stream.getTracks) {
        try { stream.getTracks().forEach((t) => t.stop()) } catch (e) {}
      }
      this._stream = null
    },
    async handleRecordFile(filePath) {
      this.transcribing = true
      try {
        const data = await transcribeVoiceFile(filePath)
        this.emitText(data)
      } catch (err) {
        uni.showToast({ title: (err && err.message) || '语音转写失败', icon: 'none', duration: 3000 })
      } finally {
        this.transcribing = false
      }
    },
    async handleBlob(blob, type) {
      this.transcribing = true
      try {
        const ext = String(type).includes('mp4') ? 'mp4' : 'webm'
        const data = await transcribeVoiceBlob(blob, `voice_recording.${ext}`)
        this.emitText(data)
      } catch (err) {
        uni.showToast({ title: (err && err.message) || '语音转写失败', icon: 'none', duration: 3000 })
      } finally {
        this.transcribing = false
      }
    },
    emitText(data) {
      const cleaned = String((data && data.text) || '').trim()
      const raw = String((data && data.raw_text) || '').trim()
      const fallback = String((data && (data.result || data.transcription)) || '').trim()
      const text = cleaned || raw || fallback
      if (!text) {
        uni.showToast({ title: '没有识别到语音内容', icon: 'none' })
        return
      }
      this.$emit('text', normalizeSpeechRefMentions(text))
    },
    async checkStatus() {
      if (this._statusChecked) return
      this._statusChecked = true
      try {
        const st = await fetchAsrStatus()
        if (st && st.transcribeReady === false) {
          uni.showToast({ title: st.hint || '整段语音转写服务未就绪', icon: 'none', duration: 3000 })
        }
      } catch (e) {}
      setTimeout(() => { this._statusChecked = false }, 120000)
    }
  }
}
</script>

<style scoped>
.voice-btn {
  height: 34px;
  min-width: 34px;
  padding: 0;
  box-sizing: border-box;
  border-radius: 17px;
  background: #F8FAFC;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.18s ease, padding 0.18s ease;
}

.voice-btn.recording {
  padding: 0 12px;
  background: #FEF2F2;
  border: 1px solid rgba(220, 38, 38, 0.22);
}

.voice-btn.transcribing {
  padding: 0 12px;
  opacity: 0.72;
}

.voice-btn.disabled {
  opacity: 0.35;
}

.voice-hover {
  background: #EFF6FF;
}

.voice-dot {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background: #DC2626;
  animation: voicePulse 1s ease-in-out infinite;
}

.voice-t {
  font-size: 11px;
  font-weight: 600;
  color: #B91C1C;
  white-space: nowrap;
}

@keyframes voicePulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.78); }
}
</style>
