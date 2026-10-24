<template>
  <view class="studio-page">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-left" @click="goBack">
        <text class="back-icon">‹</text>
        <text class="nav-title">AI 创作工坊</text>
      </view>
    </view>
    <scroll-view scroll-y class="body-scroll">
      <view class="hero">
        <text class="hero-title">开始创作</text>
        <text class="hero-desc">生图、生视频、配乐与人像，一站式空间创作</text>
      </view>
      <view class="feature-grid">
        <view v-for="d in domains" :key="d.id" class="feature-card" :style="{ background: d.tint }" @click="enterDomain(d.id)">
          <text class="feature-icon">{{ d.icon }}</text>
          <text class="feature-title">{{ d.label }}</text>
          <text class="feature-sub">{{ d.desc }}</text>
          <text class="feature-go">进入 ›</text>
        </view>
      </view>
      <view class="sec">
        <text class="sec-title">快捷工具</text>
        <view class="tool-grid">
          <view v-for="t in tools" :key="t.id" class="tool-card" @click="goTool(t)">
            <text class="tool-icon">{{ t.icon }}</text>
            <view class="tool-info">
              <text class="tool-title">{{ t.label }}</text>
              <text class="tool-sub">{{ t.sub }}</text>
            </view>
            <text class="tool-arrow">›</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { switchTabTo } from '../../common/nav'

export default {
  data() {
    return {
      statusBarHeight: 20,
      domains: [
        { id: 'image', label: 'AI 生图', icon: '🖼️', desc: '空间效果图', tint: '#EFF6FF' },
        { id: 'video', label: 'AI 生视频', icon: '🎬', desc: '漫游成片', tint: '#F5F3FF' },
        { id: 'music', label: 'AI 生音乐', icon: '🎵', desc: '配乐与歌曲', tint: '#F0FDFA' },
        { id: 'portrait', label: 'AI 生人像', icon: '👤', desc: '空间人像', tint: '#FDF2F8' },
      ],
      tools: [
        { id: 'expand', label: '扩图', sub: '向外延展画幅', icon: '📐', path: '/pages/quick/expand' },
        { id: 'enhance', label: '清晰度', sub: '本地 2x/4x 或云端', icon: '🔍', path: '/pages/quick/enhance' },
        { id: 'watermark', label: '去水印', sub: '框选擦除', icon: '✨', path: '/pages/quick/watermark' },
        { id: 'remove', label: '物体消除', sub: '消除瑕疵', icon: '🧹', path: '/pages/quick/remove' },
        { id: 'insert', label: '软装置入', sub: '框选置入', icon: '🛋️', path: '/pages/quick/insert' },
        { id: 'replace', label: '原位替换', sub: '框选替换', icon: '🔄', path: '/pages/quick/replace' },
        { id: 'walkthrough', label: '空间漫游', sub: '多空间成片', icon: '🎬', path: '/pages/quick/walkthrough' },
      ],
    }
  },
  onLoad(opts) {
    try { this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20 } catch (e) {}
    const d = opts && opts.domain
    if (d) this.enterDomain(d)
  },
  methods: {
    goBack() { uni.navigateBack() },
    enterDomain(domain) {
      switchTabTo('/pages/home/home', { view: 'operate', domain: domain || 'image' })
    },
    goTool(t) { if (t.path) uni.navigateTo({ url: t.path }) },
  },
}
</script>

<style scoped>
.studio-page { display: flex; flex-direction: column; height: 100vh; background: #F8FAFC; }
.nav-bar { display: flex; align-items: center; padding: 10px 16px; background: #FFF; border-bottom: 1px solid #E2E8F0; }
.nav-left { display: flex; align-items: center; }
.back-icon { font-size: 28px; color: #0F172A; margin-right: 8px; line-height: 1; }
.nav-title { font-size: 17px; font-weight: 600; color: #0F172A; }
.body-scroll { flex: 1; min-height: 0; }
.hero { padding: 28px 20px 12px; }
.hero-title { display: block; font-size: 26px; font-weight: 700; color: #0F172A; margin-bottom: 6px; }
.hero-desc { display: block; font-size: 13px; color: #64748B; }
.feature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px 16px; }
.feature-card { border-radius: 18px; padding: 16px; min-height: 120px; display: flex; flex-direction: column; gap: 4px; }
.feature-icon { font-size: 26px; }
.feature-title { font-size: 15px; font-weight: 700; color: #0F172A; }
.feature-sub { font-size: 11px; color: #64748B; flex: 1; }
.feature-go { font-size: 12px; font-weight: 600; color: #2563EB; }
.sec { padding: 8px 16px 32px; }
.sec-title { display: block; font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 10px; }
.tool-grid { display: flex; flex-direction: column; gap: 8px; }
.tool-card { display: flex; align-items: center; gap: 12px; background: #FFF; border: 1px solid #E2E8F0; border-radius: 14px; padding: 12px 14px; }
.tool-icon { font-size: 20px; }
.tool-info { flex: 1; }
.tool-title { display: block; font-size: 14px; font-weight: 600; color: #0F172A; }
.tool-sub { display: block; font-size: 11px; color: #94A3B8; }
.tool-arrow { font-size: 18px; color: #94A3B8; }
</style>
