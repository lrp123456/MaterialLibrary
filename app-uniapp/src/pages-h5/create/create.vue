<template>
  <view class="h5-page shell">
    <view class="topbar">
      <view class="h5-btn ghost" @click="goBack">← 返回</view>
      <text class="title">AI 创作台</text>
    </view>
    <view class="card h5-card">
      <text class="sec">创作方向</text>
      <view class="grid">
        <view v-for="d in domains" :key="d.id" class="domain-card" :style="{ background: d.tint }" @click="domain = d.id">
          <text class="domain-icon">{{ d.icon }}</text>
          <text class="domain-title">{{ d.label }}</text>
          <text class="domain-desc">{{ d.desc }}</text>
        </view>
      </view>
      <text class="sec">提示词</text>
      <textarea class="h5-area" v-model="prompt" placeholder="描述你想生成的空间画面、光影与风格…" :maxlength="2000" />
      <view class="actions">
        <view class="h5-btn ghost" @click="goBack">取消</view>
        <view class="h5-btn primary" :disabled="!prompt || sending" @click="submit">{{ sending ? '提交中…' : '开始生成' }}</view>
      </view>
      <text v-if="resultText" class="tip">{{ resultText }}</text>
    </view>
  </view>
</template>

<script>
import { submitAiTask } from '../../service/ViewerApi'

export default {
  data() {
    return {
      domain: 'image', prompt: '', sending: false, resultText: '',
      domains: [
        { id: 'image', label: 'AI 生图', icon: '🖼️', desc: '空间效果图', tint: '#EFF6FF' },
        { id: 'video', label: 'AI 生视频', icon: '🎬', desc: '漫游成片', tint: '#F5F3FF' },
        { id: 'music', label: 'AI 生音乐', icon: '🎵', desc: '配乐与歌曲', tint: '#F0FDFA' },
        { id: 'portrait', label: 'AI 生人像', icon: '👤', desc: '空间人像', tint: '#FDF2F8' },
      ],
    }
  },
  methods: {
    goBack() { uni.navigateBack() },
    async submit() {
      if (!this.prompt || this.sending) return
      this.sending = true
      this.resultText = ''
      try {
        await submitAiTask('', {
          type: this.domain, title: 'AI 创作台',
          prompt: this.prompt, payload: { mode: this.domain, prompt: this.prompt },
        })
        this.resultText = '已提交生成任务。'
        uni.showToast({ title: '已提交', icon: 'success' })
      } catch (e) {
        this.resultText = e.message || '提交失败'
        uni.showToast({ title: this.resultText, icon: 'none' })
      } finally { this.sending = false }
    },
  },
}
</script>

<style scoped>
.shell { max-width: 720px; margin: 0 auto; padding: 24px; }
.topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.title { font-size: 20px; font-weight: 650; }
.card { padding: 22px; }
.sec { display: block; margin: 18px 0 10px; font-size: 12px; font-weight: 650; color: #64748b; }
.sec:first-child { margin-top: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.domain-card { border-radius: 12px; padding: 14px; cursor: pointer; }
.domain-icon { font-size: 22px; }
.domain-title { display: block; margin-top: 6px; font-size: 14px; font-weight: 650; }
.domain-desc { display: block; font-size: 12px; color: #64748b; }
.h5-area { width: 100%; min-height: 120px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 14px; box-sizing: border-box; }
.actions { display: flex; gap: 8px; margin-top: 18px; justify-content: flex-end; }
.tip { display: block; margin-top: 10px; font-size: 13px; color: #64748b; }
</style>
