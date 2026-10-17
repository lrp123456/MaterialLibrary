<template>
  <view class="chat-page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />

    <!-- 顶栏：返回 + 模型统一选择下拉 + 清空 -->
    <view class="top-bar">
      <view class="tb-btn" @click="goBack">‹ 返回</view>
      
      <!-- 统一模型下拉选择器 (Server-Driven Models) -->
      <picker mode="selector" :range="modelLabels" :value="selectedModelIndex" @change="onModelChange">
        <view class="model-badge">
          <text class="model-badge-icon">⚡</text>
          <text class="model-badge-name">{{ currentModelLabel }}</text>
          <text class="model-badge-arrow">▾</text>
        </view>
      </picker>

      <view class="tb-btn tb-clear" @click="clearAll">清空</view>
    </view>

    <!-- 对话流 -->
    <scroll-view class="chat-stream" scroll-y :scroll-into-view="scrollTo" scroll-with-animation>
      <view class="day">今天</view>
      <view v-for="(m, i) in messages" :key="m.id" :id="'msg-' + i" :class="['bubble-row', m.role === 'user' ? 'right' : 'left']">
        <view :class="['bubble', m.role === 'user' ? 'b-user' : 'b-ai']">
          <view v-if="m.chips && m.chips.length" class="chip-row">
            <view v-for="c in m.chips" :key="c.fid" class="chip chip-readonly">
              <view class="chip-thumb" :style="{ backgroundImage: 'url(' + c.imgUrl + ')' }" />
              <text class="chip-name">{{ c.name }}</text>
            </view>
          </view>
          <text class="bubble-text">{{ m.text }}</text>
          <view v-if="m.err" class="bubble-err">{{ m.err }}</view>
        </view>
      </view>
      <view v-if="replying" class="bubble-row left">
        <view class="bubble b-ai">
          <text class="bubble-text">正在思考推理…</text>
        </view>
      </view>
      <view style="height: 40rpx" />
    </scroll-view>

    <!-- @ 联想浮层 -->
    <view v-if="pickerOpen" class="picker" @touchmove.stop.prevent>
      <view class="picker-title">选择要引用的素材</view>
      <scroll-view scroll-y class="picker-list">
        <view v-for="a in pickerItems" :key="a.fid" class="picker-item" @click="pickRef(a)">
          <view class="pi-thumb" :style="{ backgroundImage: 'url(' + a.imgUrl + ')' }" />
          <view class="pi-meta">
            <text class="pi-name">{{ a.name }}</text>
            <text class="pi-sub">{{ a.sub }}</text>
          </view>
        </view>
        <view v-if="!pickerItems.length" class="picker-empty">没有可引用的素材</view>
      </scroll-view>
    </view>

    <!-- 底部输入区 -->
    <view class="input-zone">
      <!-- 已选芯片图文混排栏 -->
      <scroll-view v-if="chips.length" class="chip-scroll" scroll-x>
        <view class="chip-wrap">
          <view v-for="c in chips" :key="c.fid" class="chip chip-editable">
            <view class="chip-thumb" :style="{ backgroundImage: 'url(' + c.imgUrl + ')' }" />
            <text class="chip-name">{{ c.name }}</text>
            <view class="chip-del" @click="removeChip(c.fid)">×</view>
          </view>
        </view>
      </scroll-view>

      <!-- 快捷控制参数栏 + 固定高优【✨ 优化提示词】插槽 -->
      <view class="controls-action-bar">
        <!-- 动态快捷参数胶囊 (Schema-Driven) -->
        <scroll-view scroll-x class="quick-scroll" :show-scrollbar="false">
          <view class="quick-pills">
            <view
              v-for="ctl in quickControls"
              :key="ctl.key"
              class="param-pill"
            >
              <picker
                mode="selector"
                :range="ctl.options.map(o => o.label)"
                @change="(e) => onParamChange(ctl.key, ctl.options[e.detail.value].value)"
              >
                <text class="param-pill-text">{{ ctl.label }}: {{ getParamLabel(ctl) }}</text>
              </picker>
            </view>
          </view>
        </scroll-view>

        <!-- 固定高优专属插槽：✨ 优化提示词 -->
        <view
          class="optimize-btn"
          :class="{ disabled: !draft.trim() || optimizing }"
          @click="optimizePrompt"
        >
          <text class="optimize-icon">{{ optimizing ? '↻' : '✨' }}</text>
          <text class="optimize-text">{{ optimizing ? '优化中…' : '优化提示词' }}</text>
        </view>
      </view>

      <!-- 输入栏 -->
      <view class="input-row">
        <view class="at-btn" @click="openPicker">@</view>
        <input
          class="chat-input"
          v-model="draft"
          :placeholder="placeholder"
          placeholder-class="ph"
          confirm-type="send"
          @confirm="send"
        />
        <view :class="['send-btn', { disabled: !canSend }]" @click="send">发送</view>
      </view>
    </view>
  </view>
</template>

<script>
import {
  chatComplete,
  fetchAssets,
  mediaUrl,
  fetchStudioSchema,
  optimizePromptApi
} from '../../service/ViewerApi'

export default {
  data() {
    return {
      statusBarHeight: 20,
      draft: '',
      chips: [],          // 已选引用：{ fid, name, imgUrl, sub }
      messages: [],       // { id, role, text, chips, err }
      pickerOpen: false,
      pickerItems: [],
      allAssets: [],
      replying: false,
      optimizing: false,
      scrollTo: '',
      seq: 0,
      
      // Server-Driven UI 工作台模型与控制项
      studioSchema: {
        models: [
          { id: 'doubao-seed-2-0', name: 'Seedream 5.0 Flash', badge: '极速 2K', isDefault: true },
          { id: 'seedream-5.0-pro', name: 'Seedream 5.0 Pro', badge: '极致 4K', isDefault: false },
          { id: 'seedance-2-0', name: 'Seedance 2.0', badge: '运镜视频', isDefault: false }
        ],
        inputControls: {
          quick: [
            { key: 'aspectRatio', label: '画幅', defaultValue: '16:9', options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }] },
            { key: 'quality', label: '画质', defaultValue: 'hd', options: [{ value: 'standard', label: '2K标准' }, { value: 'hd', label: '4K超清' }] }
          ]
        }
      },
      selectedModelIndex: 0,
      activeParams: {
        aspectRatio: '16:9',
        quality: 'hd'
      }
    }
  },
  computed: {
    canSend() {
      return (this.draft.trim() || this.chips.length) && !this.replying
    },
    placeholder() {
      return this.chips.length ? '继续输入画面要求…' : '输入描述，或点左侧 @ 引用素材'
    },
    modelLabels() {
      return (this.studioSchema.models || []).map(m => `${m.name} (${m.badge || ''})`)
    },
    currentModelLabel() {
      const m = (this.studioSchema.models || [])[this.selectedModelIndex]
      return m ? m.name : 'Seedream 5.0'
    },
    currentModelId() {
      const m = (this.studioSchema.models || [])[this.selectedModelIndex]
      return m ? m.id : 'doubao-seed-2-0'
    },
    quickControls() {
      return (this.studioSchema.inputControls && this.studioSchema.inputControls.quick) || []
    }
  },
  onLoad() {
    this.statusBarHeight = (uni.getSystemInfoSync && uni.getSystemInfoSync().statusBarHeight) || 20
    this.loadAssets()
    this.loadSchema()
  },
  methods: {
    goBack() {
      uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/home/home' }) })
    },
    async loadSchema() {
      try {
        const schema = await fetchStudioSchema()
        if (schema && schema.models && schema.models.length) {
          this.studioSchema = schema
        }
      } catch (e) {
        // 使用兜底 Schema
      }
    },
    onModelChange(e) {
      this.selectedModelIndex = Number(e.detail.value)
    },
    onParamChange(key, val) {
      this.$set(this.activeParams, key, val)
    },
    getParamLabel(ctl) {
      const val = this.activeParams[ctl.key] || ctl.defaultValue
      const found = (ctl.options || []).find(o => o.value === val)
      return found ? found.label : val
    },
    async loadAssets() {
      try {
        const data = await fetchAssets({ page: 1, pageSize: 30, skipFacets: true })
        const items = (data && data.items) || []
        this.allAssets = items.map((a) => ({
          fid: a.fid,
          name: (a.file_name || a.fid).replace(/\.[^.]+$/, ''),
          sub: (a.tagsText || (a.tags || []).map((t) => t.label).filter(Boolean).join(' · ')) || '',
          imgUrl: mediaUrl(a.fid)
        }))
      } catch (e) {
        this.allAssets = []
      }
    },
    openPicker() {
      const chosen = new Set(this.chips.map((c) => c.fid))
      this.pickerItems = this.allAssets.filter((a) => !chosen.has(a.fid))
      this.pickerOpen = true
    },
    pickRef(a) {
      if (this.chips.some((c) => c.fid === a.fid)) return
      this.chips.push({ fid: a.fid, name: a.name, imgUrl: a.imgUrl, sub: a.sub })
      this.pickerOpen = false
    },
    removeChip(fid) {
      this.chips = this.chips.filter((c) => c.fid !== fid)
    },
    clearAll() {
      this.messages = []
      this.chips = []
    },
    // 固定高优【✨ 优化提示词】调用
    async optimizePrompt() {
      if (!this.draft.trim() || this.optimizing) return
      this.optimizing = true
      try {
        const res = await optimizePromptApi({
          prompt: this.draft.trim(),
          modelId: this.currentModelId,
          mode: 'image_generate',
          imageUrls: this.chips.map(c => c.imgUrl).filter(Boolean)
        })
        if (res && res.optimized) {
          this.draft = res.optimized
          uni.showToast({ title: '提示词已增强', icon: 'success' })
        }
      } catch (e) {
        uni.showToast({ title: e.message || '优化失败', icon: 'none' })
      } finally {
        this.optimizing = false
      }
    },
    async send() {
      if (!this.canSend) return
      const text = this.draft.trim()
      const refChips = this.chips.map((c) => ({ fid: c.fid, name: c.name, imgUrl: c.imgUrl, sub: c.sub }))
      this.messages.push({ id: ++this.seq, role: 'user', text: text || '（引用了素材）', chips: refChips })
      this.draft = ''
      this.chips = []
      this.replying = true
      this.scrollToMsg()
      try {
        const refs = refChips.map((c) => ({ fid: c.fid, name: c.name }))
        const data = await chatComplete({ text, refs, model: this.currentModelId })
        const replyChips = (data.refs || []).map((r) => {
          const src = refChips.find((c) => c.fid === r.fid)
          return { fid: r.fid, name: r.name, imgUrl: src && src.imgUrl, sub: r.tagsText || '' }
        })
        let err = ''
        if (data.missingRefs && data.missingRefs.length) err = '部分引用素材已失效：' + data.missingRefs.map((m) => m.name).join('、')
        this.messages.push({ id: ++this.seq, role: 'ai', text: data.reply, chips: replyChips, err })
      } catch (e) {
        this.messages.push({ id: ++this.seq, role: 'ai', text: '', err: e.message || '对话失败，请重试' })
      } finally {
        this.replying = false
        this.scrollToMsg()
      }
    },
    scrollToMsg() {
      this.$nextTick(() => {
        this.scrollTo = 'msg-' + this.messages.length
        setTimeout(() => { this.scrollTo = '' }, 120)
      })
    }
  }
}
</script>

<style>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #F8FAFC;
}
.status-bar { background: #F8FAFC; }
.top-bar {
  display: flex; align-items: center; justify-content: space-between;
  height: 96rpx; padding: 0 24rpx; background: #fff;
  border-bottom: 1rpx solid #E2E8F0;
}
.tb-title { font-size: 34rpx; font-weight: 700; color: #0F172A; }
.tb-btn { font-size: 26rpx; color: #64748B; padding: 12rpx 16rpx; }
.tb-clear { color: #2563EB; }

/* 统一模型选择器徽标 */
.model-badge {
  display: flex; align-items: center; gap: 8rpx;
  background: #EFF6FF; border: 1rpx solid #BFDBFE; border-radius: 999rpx;
  padding: 8rpx 20rpx;
}
.model-badge-icon { font-size: 24rpx; color: #2563EB; }
.model-badge-name { font-size: 26rpx; font-weight: 700; color: #1D4ED8; }
.model-badge-arrow { font-size: 22rpx; color: #60A5FA; }

.chat-stream { flex: 1; padding: 24rpx 28rpx; box-sizing: border-box; }
.day { font-size: 22rpx; color: #94A3B8; text-align: center; margin: 12rpx 0 24rpx; }
.bubble-row { display: flex; margin-bottom: 24rpx; }
.bubble-row.right { justify-content: flex-end; }
.bubble-row.left { justify-content: flex-start; }
.bubble { max-width: 78%; border-radius: 24rpx; padding: 22rpx 26rpx; }
.b-user { background: #2563EB; }
.b-ai { background: #fff; border: 1rpx solid #E2E8F0; }
.bubble-text { font-size: 30rpx; line-height: 1.5; color: #0F172A; white-space: pre-wrap; }
.b-user .bubble-text { color: #fff; }
.bubble-err { font-size: 24rpx; color: #DC2626; margin-top: 10rpx; }

/* 芯片 */
.chip-row { display: flex; flex-wrap: wrap; gap: 12rpx; margin-bottom: 16rpx; }
.chip {
  display: inline-flex; align-items: center; gap: 10rpx;
  background: #EFF6FF; border: 1rpx solid #BFDBFE; border-radius: 999rpx;
  padding: 8rpx 14rpx; max-width: 100%;
}
.chip-thumb { width: 32rpx; height: 32rpx; border-radius: 8rpx; background-color: #C7B8A5; background-size: cover; background-position: center; flex-shrink: 0; }
.chip-name { font-size: 24rpx; color: #1D4ED8; font-weight: 600; max-width: 200rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-del {
  width: 40rpx; height: 40rpx; line-height: 38rpx; text-align: center;
  font-size: 30rpx; color: #1D4ED8; border-radius: 999rpx; flex-shrink: 0;
}
.chip-editable { padding-right: 10rpx; }

/* @ 联想 */
.picker {
  margin: 0 24rpx 16rpx; background: #fff; border: 1rpx solid #BFDBFE;
  border-radius: 20rpx; box-shadow: 0 8rpx 30rpx rgba(37,99,235,0.08);
  overflow: hidden;
}
.picker-title { background: #EFF6FF; padding: 18rpx 24rpx; font-size: 26rpx; color: #2563EB; font-weight: 600; }
.picker-list { max-height: 360rpx; }
.picker-item { display: flex; align-items: center; gap: 20rpx; padding: 16rpx 24rpx; border-bottom: 1rpx solid #F1F5F9; }
.picker-item:active { background: #F8FAFC; }
.pi-thumb { width: 72rpx; height: 72rpx; border-radius: 12rpx; background: #c7b8a5; background-size: cover; background-position: center; flex-shrink: 0; }
.pi-name { font-size: 28rpx; color: #0F172A; font-weight: 600; display: block; }
.pi-sub { font-size: 22rpx; color: #94A3B8; display: block; margin-top: 4rpx; }
.picker-empty { padding: 40rpx; text-align: center; color: #94A3B8; font-size: 26rpx; }

/* 输入区与快捷操作栏 */
.input-zone { background: #fff; border-top: 1rpx solid #E2E8F0; padding: 16rpx 24rpx 24rpx; }
.chip-scroll { max-height: 90rpx; white-space: nowrap; margin-bottom: 12rpx; }
.chip-wrap { display: inline-flex; gap: 12rpx; padding-right: 20rpx; }

.controls-action-bar {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14rpx; gap: 16rpx;
}
.quick-scroll { flex: 1; white-space: nowrap; overflow: hidden; }
.quick-pills { display: inline-flex; gap: 12rpx; }
.param-pill {
  padding: 6rpx 16rpx; background: #F1F5F9; border-radius: 8rpx;
  font-size: 22rpx; color: #475569;
}
.param-pill-text { font-size: 22rpx; color: #475569; font-weight: 500; }

/* 固定专属：✨ 优化提示词按钮 */
.optimize-btn {
  display: flex; align-items: center; gap: 6rpx;
  padding: 8rpx 18rpx; border-radius: 999rpx;
  background: linear-gradient(135deg, #FEF3C7, #FDE68A);
  border: 1rpx solid #F59E0B; flex-shrink: 0;
}
.optimize-icon { font-size: 24rpx; color: #D97706; }
.optimize-text { font-size: 22rpx; font-weight: 700; color: #B45309; }
.optimize-btn.disabled { opacity: 0.4; }

.input-row { display: flex; align-items: center; gap: 16rpx; }
.at-btn {
  width: 72rpx; height: 72rpx; line-height: 70rpx; text-align: center;
  background: #EFF6FF; border: 1rpx solid #BFDBFE; border-radius: 999rpx;
  color: #2563EB; font-size: 36rpx; font-weight: 700; flex-shrink: 0;
}
.chat-input {
  flex: 1; height: 72rpx; background: #F1F5F9; border-radius: 999rpx;
  padding: 0 28rpx; font-size: 28rpx; color: #0F172A;
}
.ph { color: #94A3B8; font-size: 26rpx; }
.send-btn {
  height: 72rpx; line-height: 72rpx; padding: 0 32rpx; background: #2563EB;
  color: #fff; border-radius: 999rpx; font-size: 30rpx; font-weight: 600; flex-shrink: 0;
}
.send-btn.disabled { background: #BFDBFE; }
</style>
