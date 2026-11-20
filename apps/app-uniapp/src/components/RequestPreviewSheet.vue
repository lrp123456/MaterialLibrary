<template>
  <view v-if="show" class="rpbs-mask" @click="$emit('close')">
    <view class="rpbs-sheet" @click.stop>
      <view class="rpbs-head">
        <view class="rpbs-head-l">
          <icon class="rpbs-shield" type="waiting" size="16" color="#3B82F6" />
          <text class="rpbs-title">请求预览 · 发送前可核对每一处</text>
        </view>
        <view class="rpbs-close" @click="$emit('close')"><text class="rpbs-close-x">✕</text></view>
      </view>

      <scroll-view v-if="loading" scroll-y class="rpbs-body" :scroll-with-animation="true">
        <view class="rpbs-loading">
          <view class="rpbs-spinner" />
          <text class="rpbs-loading-t">正在组装请求…</text>
        </view>
      </scroll-view>

      <view v-else-if="error" class="rpbs-body rpbs-error-wrap">
        <text class="rpbs-error-title">预览失败</text>
        <text class="rpbs-error-text" selectable>{{ error }}</text>
        <view class="rpbs-btn ghost" @click="fetchPreview"><text class="rpbs-btn-t">重试</text></view>
      </view>

      <scroll-view v-else scroll-y class="rpbs-body" :scroll-with-animation="true">
        <!-- 路由与模型徽章 -->
        <view class="rpbs-route">
          <view :class="['rpbs-badge', kindBadgeClass]"><text class="rpbs-badge-t">{{ kindLabel }}</text></view>
          <text class="rpbs-model" number-of-lines="1">{{ modelLabel }}</text>
        </view>

        <!-- 原文 -->
        <view class="rpbs-sec">
          <text class="rpbs-sec-t">① 你写的配方句</text>
          <text class="rpbs-pre" selectable>{{ recipeText || '（未填写）' }}</text>
        </view>

        <!-- 真正发出的正文 -->
        <view class="rpbs-sec">
          <text class="rpbs-sec-t">② 真正发给模型的正文</text>
          <text class="rpbs-pre accent" selectable>{{ compiledText }}</text>
        </view>

        <!-- 参考图 -->
        <view class="rpbs-sec">
          <text class="rpbs-sec-t">③ 参考图（{{ images.length }} 张）</text>
          <view v-if="!images.length" class="rpbs-empty"><text class="rpbs-empty-t">无参考图 · 纯文本请求</text></view>
          <view v-for="(img, idx) in images" :key="idx" class="rpbs-imgrow">
            <view class="rpbs-imgtag"><text class="rpbs-imgtag-t">{{ img.tag }}</text></view>
            <view class="rpbs-imgmeta">
              <text class="rpbs-imglabel">{{ img.label }}</text>
              <text class="rpbs-imgsrc">{{ img.sourceLabel }}{{ img.sizeText ? ' · ' + img.sizeText : '' }}</text>
              <text class="rpbs-imgurl" selectable>{{ img.urlText }}</text>
            </view>
          </view>
        </view>

        <!-- 出站 JSON -->
        <view v-if="jsonText" class="rpbs-sec">
          <view class="rpbs-sec-head">
            <text class="rpbs-sec-t">④ 出站请求（JSON）</text>
            <view class="rpbs-copy" @click="copyJson"><text class="rpbs-copy-t">复制</text></view>
          </view>
          <text class="rpbs-pre mono" selectable>{{ jsonText }}</text>
        </view>

        <!-- 风险与降级提示 -->
        <view v-if="allNotes.length" class="rpbs-sec">
          <text class="rpbs-sec-t">提示</text>
          <view v-for="(n, i) in allNotes" :key="i" class="rpbs-note">
            <text class="rpbs-note-t">• {{ n }}</text>
          </view>
        </view>

        <view class="rpbs-foot-note"><text class="rpbs-foot-t">此预览由服务端与真实发送共用同一段组装逻辑完成；Authorization 等凭证不展示。</text></view>
        <view style="height: 24px" />
      </scroll-view>

      <view class="rpbs-bottom">
        <view class="rpbs-btn" @click="$emit('close')"><text class="rpbs-btn-t">返回修改</text></view>
        <view class="rpbs-btn primary" @click="$emit('confirm')"><text class="rpbs-btn-t">就是这份请求 · 发送</text></view>
      </view>
    </view>
  </view>
</template>

<script>
import { previewAiGeneration, previewEditRun } from '../service/ViewerApi'

export default {
  name: 'RequestPreviewSheet',
  props: {
    show: { type: Boolean, default: false },
    /** 'gen' | 'edit' */
    kind: { type: String, default: 'gen' },
    /** 发给预览接口的请求体 */
    payload: { type: Object, default: () => ({}) },
    /** 客户端附带的额外提示（如挂图来源） */
    extraNotes: { type: Array, default: () => [] },
    /** 按钮文案（默认「就是这份请求 · 发送」） */
    confirmText: { type: String, default: '就是这份请求 · 发送' },
  },
  emits: ['close', 'confirm', 'error'],
  data() {
    return {
      loading: false,
      error: '',
      result: null,
      copied: false,
    }
  },
  computed: {
    kindLabel() {
      return this.kind === 'edit' ? '精准编辑' : (this.kind === 'chat' ? '对话' : '生成')
    },
    kindBadgeClass() {
      return this.kind === 'edit' ? 'edit' : (this.kind === 'chat' ? 'chat' : 'gen')
    },
    modelLabel() {
      const r = this.result || {}
      return r.adapterId || (r.request && r.request.model) || this.payload.model || '默认模型'
    },
    recipeText() {
      const r = this.result || {}
      if (this.kind === 'edit') return r.recipe != null ? r.recipe : (r.prompt && String(r.prompt)) || ''
      return r.rawPrompt != null ? r.rawPrompt : (r.prompt != null ? r.prompt : '')
    },
    compiledText() {
      const r = this.result || {}
      if (this.kind === 'edit') return r.prompt || ''
      return r.compiledPrompt || r.dialectPrompt || r.prompt || ''
    },
    images() {
      const r = this.result || {}
      const list = Array.isArray(r.images) ? r.images : []
      return list.map((img, idx) => {
        const tag = img.tag || (img.label ? String(img.label).replace('@', '图') : `图${idx + 1}`)
        const rawUrl = String(img.url || '')
        let urlText = ''
        let sizeText = ''
        if (rawUrl.startsWith('data:')) {
          const kb = Math.round(rawUrl.length / 1024)
          urlText = `（内嵌 base64，约 ${kb} KB）`
          sizeText = `约 ${kb} KB`
        } else if (rawUrl) {
          urlText = safeUrl(rawUrl)
        }
        const src = String(img.source || '')
        const sourceLabel = src === 'history' ? '来源：历史消息' : src === '3d_snapshot' ? '来源：3D 朝向截图' : src === 'stage' ? '来源：本次看图区' : '来源：参考图'
        const label = img.label && !/^@?图\d+$/.test(String(img.label)) ? String(img.label) : sourceLabel.replace('来源：', '')
        return { tag, label, sourceLabel, sizeText, urlText: urlText || '（服务端未回显地址）' }
      })
    },
    jsonText() {
      const r = this.result || {}
      let body = null
      if (this.kind === 'edit') {
        body = {
          op: r.op,
          prompt: r.prompt,
          size: r.size,
          ratio: r.ratio,
          pasteback: r.pasteback,
          apiBox: r.apiBox,
          region: r.region,
          outSize: r.outSize,
          adapterId: r.adapterId,
        }
      } else if (r.request && r.request.body) {
        body = r.request.body
      }
      if (!body) return ''
      try {
        return JSON.stringify(body, null, 2)
      } catch (_) {
        return String(body)
      }
    },
    allNotes() {
      const r = this.result || {}
      const out = []
      if (Array.isArray(r.notes)) out.push(...r.notes)
      if (r.regionNote) out.push(`选区说明：${r.regionNote}`)
      if (r.fallbackPrompt) out.push('配方句为空：将使用服务端兜底模板')
      if (r.region && r.region.degraded) out.push('选区已自动降级为语义定位，且会回写提示词')
      if (r.ref_dropped && r.ref_dropped.length) out.push(`参考图超过上限，已丢弃：${r.ref_dropped.join('、')}`)
      if (Array.isArray(this.extraNotes)) out.push(...this.extraNotes)
      return out
    },
  },
  watch: {
    show(v) {
      if (v) this.fetchPreview()
    },
  },
  methods: {
    async fetchPreview() {
      this.loading = true
      this.error = ''
      this.result = null
      try {
        if (this.kind === 'chat') {
          // 对话模型不编译方言：直接回显真实出站体，服务端无需参与
          const body = { ...(this.payload || {}) }
          this.result = {
            prompt: body.prompt || '',
            rawPrompt: body.prompt || '',
            compiledPrompt: body.prompt || '',
            modality: 'chat',
            images: (Array.isArray(body.imageUrls) ? body.imageUrls : (Array.isArray(body.images) ? body.images : []))
              .map((u, idx) => ({ label: `@图${idx + 1}`, source: 'stage', url: u })),
            request: {
              url: '/gen/chat',
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: { prompt: body.prompt, model: body.model, images: body.imageUrls || body.images },
            },
            notes: ['对话模型不编译方言，正文即你输入的原文'],
          }
          return
        }
        const fn = this.kind === 'edit' ? previewEditRun : previewAiGeneration
        const data = await fn(this.payload || {})
        this.result = data || {}
      } catch (e) {
        this.error = (e && e.message) || '预览请求失败'
        this.$emit('error', this.error)
      } finally {
        this.loading = false
      }
    },
    copyJson() {
      if (!this.jsonText) return
      uni.setClipboardData({
        data: this.jsonText,
        success: () => {
          this.copied = true
          uni.showToast({ title: '已复制 JSON', icon: 'none' })
          setTimeout(() => { this.copied = false }, 1500)
        },
      })
    },
  },
}

function safeUrl(url) {
  try {
    const u = new URL(String(url))
    return u.origin + u.pathname
  } catch (_) {
    return String(url).split('?')[0]
  }
}
</script>

<style scoped>
.rpbs-mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0; z-index: 998;
  background: rgba(6, 10, 18, .55);
  display: flex; flex-direction: column; justify-content: flex-end;
}
.rpbs-sheet {
  background: #FFFFFF; border-radius: 20px 20px 0 0;
  max-height: 88vh; display: flex; flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
}
.rpbs-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 12px; border-bottom: 1px solid #E7ECF3;
}
.rpbs-head-l { display: flex; align-items: center; gap: 8px; flex: 1; }
.rpbs-title { font-size: 15px; font-weight: 700; color: #0F172A; }
.rpbs-close {
  width: 36px; height: 36px; border-radius: 999px;
  background: #EFF4FA; align-items: center; justify-content: center; display: flex;
}
.rpbs-close-x { font-size: 16px; color: #64748B; line-height: 1; }
.rpbs-body { flex: 1; padding: 12px 16px; }
.rpbs-loading { align-items: center; justify-content: center; display: flex; flex-direction: column; padding: 48px 0; gap: 12px; }
.rpbs-spinner {
  width: 30px; height: 30px; border-radius: 999px;
  border: 3px solid #E2E8F0; border-top-color: #3B82F6;
  animation: rpbs-spin .8s linear infinite;
}
@keyframes rpbs-spin { to { transform: rotate(360deg); } }
.rpbs-loading-t { color: #64748B; font-size: 12px; }
.rpbs-error-wrap { padding-top: 24px; display: flex; flex-direction: column; gap: 10px; }
.rpbs-error-title { font-size: 15px; font-weight: 700; color: #F43F5E; }
.rpbs-error-text { font-size: 12px; color: #64748B; background: #FEF2F2; border-radius: 10px; padding: 10px; }

.rpbs-route { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.rpbs-badge { border-radius: 999px; padding: 4px 10px; background: #EFF4FA; }
.rpbs-badge.gen { background: #EAF2FE; }
.rpbs-badge.edit { background: #F5F3FF; }
.rpbs-badge.chat { background: #ECFDF5; }
.rpbs-badge-t { font-size: 11px; font-weight: 700; color: #3B82F6; }
.rpbs-badge.edit .rpbs-badge-t { color: #7C3AED; }
.rpbs-badge.chat .rpbs-badge-t { color: #0D9488; }
.rpbs-model { flex: 1; font-size: 12px; color: #64748B; }

.rpbs-sec { margin-bottom: 14px; }
.rpbs-sec-t { font-size: 12px; font-weight: 700; color: #0F172A; margin-bottom: 6px; display: block; }
.rpbs-sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.rpbs-pre {
  font-size: 12px; color: #0F172A; background: #F8FAFC;
  border: 1px solid #E7ECF3; border-radius: 10px; padding: 10px;
  line-height: 1.6; white-space: pre-wrap; word-break: break-all;
}
.rpbs-pre.accent { background: #EAF2FE; border-color: #BFDBFE; }
.rpbs-pre.mono { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 11px; max-height: 220px; overflow: scroll; }
.rpbs-copy { background: #EFF4FA; border-radius: 999px; padding: 4px 12px; }
.rpbs-copy-t { font-size: 11px; color: #3B82F6; font-weight: 600; }

.rpbs-empty { padding: 10px; background: #F8FAFC; border-radius: 10px; align-items: center; display: flex; }
.rpbs-empty-t { font-size: 12px; color: #A8B4C7; }
.rpbs-imgrow { display: flex; gap: 10px; align-items: center; padding: 8px; background: #F8FAFC; border: 1px solid #E7ECF3; border-radius: 12px; margin-bottom: 6px; }
.rpbs-imgtag {
  width: 44px; height: 44px; border-radius: 10px; background: #3B82F6;
  align-items: center; justify-content: center; display: flex; flex-shrink: 0;
}
.rpbs-imgtag-t { color: #FFF; font-size: 12px; font-weight: 700; }
.rpbs-imgmeta { flex: 1; gap: 2px; display: flex; flex-direction: column; }
.rpbs-imglabel { font-size: 12px; color: #0F172A; font-weight: 600; }
.rpbs-imgsrc { font-size: 10px; color: #64748B; }
.rpbs-imgurl { font-size: 10px; color: #A8B4C7; }

.rpbs-note { background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 10px; padding: 8px 10px; margin-bottom: 6px; }
.rpbs-note-t { font-size: 11px; color: #92400E; line-height: 1.5; }
.rpbs-foot-note { padding: 4px 2px; }
.rpbs-foot-t { font-size: 10px; color: #A8B4C7; line-height: 1.5; }

.rpbs-bottom {
  display: flex; gap: 10px; padding: 10px 16px; border-top: 1px solid #E7ECF3;
}
.rpbs-btn {
  flex: 1; height: 48px; border-radius: 14px;
  background: #EFF4FA; align-items: center; justify-content: center; display: flex;
}
.rpbs-btn.primary { background: #3B82F6; }
.rpbs-btn.ghost { background: #F8FAFC; }
.rpbs-btn-t { font-size: 14px; font-weight: 700; color: #0F172A; }
.rpbs-btn.primary .rpbs-btn-t { color: #FFF; }
</style>
