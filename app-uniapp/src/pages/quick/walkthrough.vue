<template>
  <view class="quick-page">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-left" @click="goBack">
        <text class="back-icon">‹</text>
        <text class="nav-title">空间漫游</text>
      </view>
    </view>
    <scroll-view scroll-y class="body-scroll">
      <view class="sec">
        <text class="sec-title">游览空间 ({{ fids.length }})</text>
        <view class="fid-list">
          <view v-for="(f, i) in fids" :key="f" class="fid-item">
            <text class="fid-idx">{{ i + 1 }}</text>
            <text class="fid-name">{{ f }}</text>
          </view>
        </view>
        <view v-if="!fids.length" class="empty-box">
          <text class="empty-t">未传入空间素材，请返回重新选择 2~6 张</text>
        </view>
      </view>
      <view class="sec">
        <text class="sec-title">运镜风格</text>
        <view class="opt-row">
          <view v-for="s in styles" :key="s.key" class="opt-chip" :class="{ active: style === s.key }" @click="style = s.key">
            <text class="opt-t">{{ s.label }}</text>
          </view>
        </view>
      </view>
      <view class="sec">
        <text class="sec-title">画幅</text>
        <view class="opt-row">
          <view v-for="a in aspects" :key="a" class="opt-chip" :class="{ active: aspect === a }" @click="aspect = a">
            <text class="opt-t">{{ a }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
    <view class="bottom-panel">
      <view class="submit-btn" :class="{ disabled: fids.length < 2 || submitting }" @click="submitTask">
        <text class="submit-text">{{ submitting ? '提交中...' : (fids.length >= 2 ? '生成空间漫游成片' : '至少需要 2 个空间') }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { aiTaskManager } from '../../service/AiTaskManager'
import { fieldOf } from '../../service/QuickParams'

export default {
  data() {
    return {
      statusBarHeight: 20, fids: [],
      style: 'smooth_walk', aspect: '',
      styles: [
        { key: 'smooth_walk', label: '平稳推进' },
        { key: 'push_in', label: '穿入下一空间' },
        { key: 'panoramic_orbit', label: '广角环视' },
      ],
      // 画幅档位来自服务端视频模型契约，客户端不写死
      aspects: [],
      submitting: false,
    }
  },
  onLoad(opts) {
    try { this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20 } catch (e) {}
    try {
      const raw = opts.fids ? decodeURIComponent(opts.fids) : '[]'
      const arr = JSON.parse(raw)
      this.fids = Array.isArray(arr) ? arr.filter(Boolean) : []
    } catch (e) { this.fids = [] }
    if (opts.aspect) this.aspect = decodeURIComponent(opts.aspect)
    fieldOf('video', 'ratio').then((f) => {
      if (!f) return
      this.aspects = Array.isArray(f.options) ? f.options : []
      if (!this.aspect) this.aspect = f.default || this.aspects[0] || ''
    })
    if (opts.style) {
      const s = decodeURIComponent(opts.style)
      const found = this.styles.find(x => x.label === s || x.key === s)
      if (found) this.style = found.key
    }
  },
  methods: {
    goBack() { uni.navigateBack() },
    async submitTask() {
      if (this.fids.length < 2 || this.submitting) return
      this.submitting = true
      try {
        const styleMap = {
          smooth_walk: '平稳向前推进',
          push_in: '从门口向前穿入下一空间',
          panoramic_orbit: '广角平视缓慢环视',
        }
        await aiTaskManager.createTask({
          fid: this.fids[0], type: 'spatial_walkthrough', title: '室内空间漫游视频',
          sourceAssets: this.fids.map(fid => ({ fid })),
          payload: {
            mode: 'spatial_walkthrough', fids: this.fids,
            aspect: this.aspect || undefined, style: styleMap[this.style] || '平稳向前推进',
          },
        })
        uni.showToast({ title: '已提交漫游生成任务', icon: 'success' })
        setTimeout(() => this.goBack(), 1200)
      } catch (e) {
        uni.showToast({ title: e.message || '提交失败', icon: 'none' })
      } finally { this.submitting = false }
    },
  },
}
</script>

<style scoped>
.quick-page { display: flex; flex-direction: column; height: 100vh; background: #0F172A; }
.nav-bar { display: flex; align-items: center; padding: 10px 16px; background: #1E293B; }
.nav-left { display: flex; align-items: center; }
.back-icon { font-size: 28px; color: #FFF; margin-right: 8px; line-height: 1; }
.nav-title { font-size: 17px; font-weight: 600; color: #FFF; }
.body-scroll { flex: 1; min-height: 0; padding: 16px; }
.sec { margin-bottom: 22px; }
.sec-title { display: block; font-size: 15px; font-weight: 600; color: #F8FAFC; margin-bottom: 10px; }
.fid-list { display: flex; flex-direction: column; gap: 8px; }
.fid-item { display: flex; align-items: center; gap: 10px; background: #1E293B; border-radius: 12px; padding: 10px 12px; }
.fid-idx { width: 22px; height: 22px; border-radius: 11px; background: #2563EB; color: #fff; font-size: 12px; text-align: center; line-height: 22px; flex-shrink: 0; }
.fid-name { flex: 1; font-size: 12px; color: #CBD5E1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.empty-box { padding: 24px; background: #1E293B; border-radius: 12px; }
.empty-t { color: #64748B; font-size: 13px; }
.opt-row { display: flex; flex-wrap: wrap; gap: 10px; }
.opt-chip { padding: 8px 14px; border-radius: 999px; background: #334155; }
.opt-chip.active { background: #2563EB; }
.opt-t { font-size: 13px; color: #E2E8F0; }
.bottom-panel { background: #1E293B; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); border-radius: 20px 20px 0 0; }
.submit-btn { background: #2563EB; border-radius: 24px; padding: 14px 0; display: flex; align-items: center; justify-content: center; }
.submit-btn.disabled { opacity: .5; }
.submit-text { font-size: 16px; font-weight: 600; color: #FFF; }
</style>
