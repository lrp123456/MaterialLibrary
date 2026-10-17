<template>
  <div class="h5-page chat-page">
    <header class="chat-header">
      <button class="h5-btn ghost back-btn" @click="onBack">← 返回</button>
      <span class="chat-title">元素标签对话</span>
      <button class="h5-btn ghost" @click="onNew">新会话</button>
    </header>

    <main class="chat-main" ref="mainEl">
      <div v-if="messages.length === 0" class="chat-empty">
        <div class="chat-empty-inner">
          <div class="logo">@</div>
          <p>用 <b>@</b> 引用素材，和我聊聊这张图</p>
          <p class="hint">芯片有底色、可单独删除；发送后引用会随话术一并送给模型</p>
        </div>
      </div>

      <div v-for="(m, i) in messages" :key="i" class="msg-row" :class="m.role">
        <div class="bubble" :class="m.role">
          <div class="bubble-chips" v-if="(m.chips||[]).length">
            <span v-for="c in m.chips" :key="c.fid" class="msg-chip" :class="m.role">
              <img v-if="c.thumb" :src="c.thumb" class="chip-thumb" @error="(e)=>onImgErr(e,c)" />
              <span class="chip-label">@{{ c.label }}</span>
            </span>
          </div>
          <div class="bubble-text">{{ m.text }}</div>
          <div v-if="m.error" class="bubble-error">⚠ {{ m.error }}</div>
        </div>
      </div>

      <div v-if="sending" class="msg-row assistant">
        <div class="bubble assistant typing">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
      </div>
    </main>

    <footer class="composer">
      <!-- 已选芯片（输入区内联），可单独删除 -->
      <div class="chips-wrap" v-if="chips.length">
        <span v-for="c in chips" :key="c.fid" class="chip" :class="{ active: !!c.thumb }">
          <img v-if="c.thumb" :src="c.thumb" class="chip-thumb" />
          <span class="chip-label">@{{ c.label }}</span>
          <i class="chip-x" @click="removeChip(c)">×</i>
        </span>
      </div>

      <!-- @ 素材联想 -->
      <div v-if="showSuggest" class="suggest">
        <div class="suggest-t">@ 选择素材（{{ suggestList.length }}）</div>
        <div class="suggest-search">
          <input v-model="suggestQuery" class="h5-input" placeholder="搜索素材名…" />
        </div>
        <div class="suggest-list">
          <div v-if="filteredSuggest.length === 0" class="suggest-empty">无匹配素材</div>
          <div v-for="a in filteredSuggest" :key="a.fid" class="suggest-item" @click="pickAsset(a)">
            <img :src="thumbOf(a)" class="suggest-thumb" />
            <div class="suggest-meta">
              <div class="suggest-name">{{ a.file_name }}</div>
              <div class="suggest-sub">{{ a.fid }} · {{ a.kind || 'image' }} · {{ a.width }}×{{ a.height }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="input-row">
        <button class="at-btn" @click="toggleSuggest" :class="{ on: showSuggest }">@</button>
        <textarea
          v-model="input"
          class="chat-input"
          rows="1"
          placeholder="输入消息，@ 引用素材…"
          @keydown="onKeydown"
          @input="onInput"
        ></textarea>
        <button class="h5-btn primary send-btn" :disabled="sending || (!input.trim() && chips.length === 0)" @click="onSend">
          {{ sending ? '发送中…' : '发送' }}
        </button>
      </div>
    </footer>
  </div>
</template>

<script>
import { sendChat, fetchAssets, fetchChatMessages } from '../../service/ViewerApi'
import { H5 } from '../h5-theme'

export default {
  name: 'H5Chat',
  data() {
    return {
      sessionId: 'sess_h5_' + Date.now(),
      input: '',
      chips: [],
      messages: [],
      sending: false,
      showSuggest: false,
      suggestQuery: '',
      suggestList: [],
      theme: H5,
    }
  },
  computed: {
    filteredSuggest() {
      const q = this.suggestQuery.trim().toLowerCase()
      if (!q) return this.suggestList
      return this.suggestList.filter(a =>
        (a.file_name || '').toLowerCase().includes(q) ||
        (a.fid || '').toLowerCase().includes(q)
      )
    },
  },
  onLoad() {
    this.loadHistory()
    this.loadAssets()
  },
  methods: {
    async loadAssets() {
      try {
        const d = await fetchAssets({ pageSize: 50 })
        this.suggestList = (d.items || []).map(a => ({
          fid: a.fid,
          label: a.file_name,
          file_name: a.file_name,
          kind: a.kind,
          width: a.width,
          height: a.height,
          thumb: this.thumbOf(a),
        }))
      } catch (e) {
        console.warn('素材联想加载失败', e)
      }
    },
    async loadHistory() {
      try {
        const rows = await fetchChatMessages(this.sessionId, 50)
        this.messages = (rows || []).map(m => ({
          role: m.role,
          text: m.prompt || '',
          chips: this.extractChips(m),
          error: m.status === 'failed' ? (m.result && m.result.error) : '',
        }))
      } catch { /* 忽略历史失败 */ }
    },
    extractChips(m) {
      try {
        const p = JSON.parse(m.params_json || '{}')
        const chips = p.chips || p.referencedChips || []
        return chips.map(c => ({ fid: c.fid, label: c.label || c.file_name, found: c.found !== false, thumb: c.thumb || '' }))
      } catch { return [] }
    },
    thumbOf(a) {
      // 浏览网格直出：本地 /image?token&local=1 由服务端处理
      if (a.thumb_url && /^https?:/.test(a.thumb_url)) return a.thumb_url
      return `/api/viewer/assets/${encodeURIComponent(a.fid)}/image?local=1`
    },
    onImgErr(e, c) { if (e) e.target.style.display = 'none'; },
    toggleSuggest() { this.showSuggest = !this.showSuggest; if (this.show) this.suggestQuery = '' },
    pickAsset(a) {
      if (this.chips.some(c => c.fid === a.fid)) { this.showSuggest = false; return }
      this.chips.push({ fid: a.fid, label: a.label || a.file_name, thumb: a.thumb })
      this.showSuggest = false
      this.input += (this.input.endsWith(' ') || this.input === '' ? '' : ' ') // 自然衔接
    },
    removeChip(c) {
      // 删除后该引用不再进入提交载荷
      this.chips = this.chips.filter(x => x.fid !== c.fid)
    },
    onInput(e) {
      const v = e.target.value
      if (v.endsWith('@')) { this.suggestQuery = ''; this.showSuggest = true }
    },
    onKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); this.onSend() }
    },
    async onSend() {
      const text = this.input.trim()
      if (!text && this.chips.length === 0) return
      if (this.sending) return
      const payload = { sessionId: this.sessionId, prompt: text, chips: this.chips.map(c => ({ fid: c.fid, label: c.label })) }
      this.messages.push({ role: 'user', text: text || '（仅引用素材）', chips: this.chips.map(c => ({ fid: c.fid, label: c.label, thumb: c.thumb })) })
      this.input = ''
      this.chips = []
      this.sending = true
      try {
        const d = await sendChat({ sessionId: this.sessionId, prompt: payload.prompt, chips: payload.chips })
        this.messages.push({
          role: 'assistant',
          text: d.reply || '（无回复）',
          chips: (d.referencedChips || []).map(c => ({ fid: c.fid, label: c.label })),
          error: d.error || '',
        })
      } catch (e) {
        this.messages.push({ role: 'assistant', text: '抱歉，发送失败：' + (e.message || e), chips: [], error: e.message })
      } finally {
        this.sending = false
        this.scrollBottom()
      }
    },
    scrollBottom() {
      this.$nextTick(() => { try { this.$el.querySelector('.chat-main').scrollTop = 1e6 } catch {} })
    },
    onBack() { history.back() },
    onNew() { this.sessionId = 'sess_h5_' + Date.now(); this.messages = []; this.input = ''; this.chips = [] },
  },
}
</script>

<style>
.chat-page{display:flex;flex-direction:column;height:100vh;}
.chat-header{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#fff;border-bottom:1px solid #E2E8F0;}
.chat-title{font-weight:600;font-size:16px;color:#0F172A;flex:1;text-align:center;}
.back-btn{height:32px;padding:0 12px;}
.chat-main{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:#F8FAFC;}
.chat-empty{margin:auto;text-align:center;color:#94A3B8;}
.chat-empty-inner .logo{width:64px;height:64px;border-radius:50%;background:#EFF6FF;color:#2563EB;font-size:34px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-weight:700;}
.chat-empty p{margin:4px 0;font-size:14px;}
.chat-empty .hint{font-size:12px;color:#CBD5E1;}
.msg-row{display:flex;}
.msg-row.user{justify-content:flex-end;}
.bubble{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.6;}
.bubble.user{background:#2563EB;color:#fff;border-top-right-radius:4px;}
.bubble.assistant{background:#fff;color:#0F172A;border:1px solid #E2E8F0;border-top-left-radius:4px;}
.bubble.error{color:#DC2626;}
.bubble-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;}
.msg-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 4px 2px 6px;font-size:12px;}
.msg-chip img{width:18px;height:18px;border-radius:50%;object-fit:cover;}
.msg-chip.user{background:rgba(255,255,255,.2);}
.msg-chip.assistant{background:#EDE9FE;color:#5B21B6;}
.bubble-text{white-space:pre-wrap;}
.bubble-error{font-size:12px;margin-top:4px;}
.typing{display:inline-flex;gap:4px;align-items:center;padding:12px;}
.typing .dot{width:6px;height:6px;border-radius:50%;background:#CBD5E1;animation:b 1.2s infinite;}
.typing .dot:nth-child(2){animation-delay:.2s}.typing .dot:nth-child(3){animation-delay:.4s}
@keyframes b{0%,100%{opacity:.3}50%{opacity:1}}
.composer{border-top:1px solid #E2E8F0;background:#fff;padding:10px 12px;position:relative;}
.chips-wrap{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;}
.chip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 10px;border-radius:999px;background:#DBEAFE;color:#1D4ED8;border:1px solid #BFDBFE;font-size:12px;}
.chip img{width:18px;height:18px;border-radius:50%;object-fit:cover;}
.chip .chip-x{width:16px;height:16px;border-radius:50%;background:#1D4ED8;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;cursor:pointer;line-height:1;}
.chip .chip-x:hover{background:#DC2626;}
.suggest{position:absolute;left:12px;right:12px;bottom:calc(100% + 8px);background:#fff;border:1px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 30px rgba(15,23,42,.12);overflow:hidden;max-height:320px;display:flex;flex-direction:column;z-index:20;}
.suggest-t{padding:6px 12px;background:#F1F5F9;font-size:11px;color:#64748B;}
.suggest-search{padding:6px 12px;border-bottom:1px solid #F1F5F9;}
.suggest-list{overflow-y:auto;max-height:220px;}
.suggest-empty{padding:16px;text-align:center;color:#94A3B8;font-size:13px;}
.suggest-item{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;}
.suggest-item:hover{background:#F8FAFC;}
.suggest-thumb{width:38px;height:38px;border-radius:8px;object-fit:cover;}
.suggest-name{font-size:13px;color:#0F172A;}
.suggest-sub{font-size:11px;color:#94A3B8;}
.input-row{display:flex;align-items:flex-end;gap:8px;}
.at-btn{width:36px;height:36px;border-radius:10px;border:1px solid #CBD5E1;background:#F8FAFC;color:#2563EB;font-size:18px;font-weight:700;cursor:pointer;}
.at-btn.on{background:#EFF6FF;border-color:#2563EB;}
.chat-input{flex:1;border:1px solid #CBD5E1;border-radius:10px;padding:8px 10px;font-size:14px;background:#F8FAFC;resize:none;max-height:120px;font-family:inherit;}
.chat-input:focus{border-color:#2563EB;background:#fff;}
.send-btn{height:36px;padding:0 18px;}
</style>
