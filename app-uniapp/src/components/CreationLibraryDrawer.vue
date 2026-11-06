<template>
  <view v-if="show" class="c-drawer-mask" @click="$emit('close')">
    <view class="c-drawer-panel" @click.stop>
      <!-- 头部 -->
      <view class="c-head">
        <view class="c-head-title-wrap">
          <AppIcon name="library" :size="18" color="#007AFF" />
          <text class="c-head-title">创作库</text>
        </view>
        <!-- 标签页切换 -->
        <view class="c-tabs">
          <view
            class="c-tab"
            :class="{ active: activeTab === 'history' }"
            @click="activeTab = 'history'"
          >
            <text class="c-tab-t">历史产物</text>
          </view>
          <view
            class="c-tab"
            :class="{ active: activeTab === 'templates' }"
            @click="activeTab = 'templates'"
          >
            <text class="c-tab-t">创作配方</text>
          </view>
        </view>
        <view class="c-close" @click="$emit('close')" hover-class="c-close-hover">
          <AppIcon name="close" :size="16" color="#64748B" />
        </view>
      </view>

      <!-- 历史产物 Tab -->
      <scroll-view
        v-if="activeTab === 'history'"
        scroll-y
        class="c-body"
        :scroll-with-animation="true"
      >
        <view v-if="!historyItems || !historyItems.length" class="c-empty">
          <view class="c-empty-icon">
            <AppIcon name="image" :size="32" color="#94A3B8" />
          </view>
          <text class="c-empty-t">暂无创作产物</text>
          <text class="c-empty-sub">生成图片或视频后，作品将自动归档至此</text>
        </view>
        <view v-else class="c-grid">
          <view
            v-for="(item, idx) in historyItems"
            :key="item.id || idx"
            class="c-card"
          >
            <view class="c-card-media" @click="onPreviewMedia(item)">
              <image
                v-if="item.kind !== 'video'"
                :src="item.url"
                class="c-card-img"
                mode="aspectFill"
              />
              <view v-else class="c-card-video-wrap">
                <image :src="item.poster || item.url" class="c-card-img" mode="aspectFill" />
                <view class="c-video-badge">
                  <AppIcon name="play" :size="12" color="#FFFFFF" />
                </view>
              </view>
              <view class="c-card-tag">
                <text class="c-card-tag-t">{{ item.kindLabel || '图片' }}</text>
              </view>
            </view>
            <view class="c-card-info">
              <text class="c-card-prompt" number-of-lines="2">{{ item.prompt || '无提示词' }}</text>
              <view class="c-card-foot">
                <text class="c-card-time">{{ fmtTime(item.createdAt) }}</text>
                <view class="c-card-actions">
                  <view class="c-act-btn" @click.stop="$emit('reuse-prompt', item.prompt)" title="复用提示词">
                    <AppIcon name="copy" :size="13" color="#007AFF" />
                    <text class="c-act-t">用词</text>
                  </view>
                  <view
                    v-if="item.url && item.kind !== 'audio'"
                    class="c-act-btn accent"
                    @click.stop="$emit('use-as-ref', item)"
                    title="作为参考图"
                  >
                    <AppIcon name="plus" :size="13" color="#007AFF" />
                    <text class="c-act-t">作参考</text>
                  </view>
                </view>
              </view>
            </view>
          </view>
        </view>
        <view style="height: 32px" />
      </scroll-view>

      <!-- 精选配方模板 Tab -->
      <scroll-view
        v-else
        scroll-y
        class="c-body"
        :scroll-with-animation="true"
      >
        <!-- 模板分类过滤 -->
        <view class="c-filter-row">
          <view
            v-for="cat in templateCategories"
            :key="cat.id"
            class="c-cat-pill"
            :class="{ active: activeCategory === cat.id }"
            @click="activeCategory = cat.id"
          >
            <text class="c-cat-t">{{ cat.label }}</text>
          </view>
        </view>

        <view class="c-tpl-list">
          <view
            v-for="tpl in filteredTemplates"
            :key="tpl.id"
            class="c-tpl-card"
            @click="onSelectTemplate(tpl)"
            hover-class="c-tpl-hover"
          >
            <view class="c-tpl-head">
              <text class="c-tpl-title">{{ tpl.title }}</text>
              <view class="c-tpl-badge">
                <text class="c-tpl-badge-t">{{ tpl.tag }}</text>
              </view>
            </view>
            <text class="c-tpl-desc" number-of-lines="2">{{ tpl.prompt }}</text>
            <view class="c-tpl-foot">
              <text class="c-tpl-meta">{{ tpl.modelHint || '推荐模型' }} · {{ tpl.ratio || '16:9' }}</text>
              <view class="c-tpl-apply">
                <text class="c-tpl-apply-t">应用此配方 →</text>
              </view>
            </view>
          </view>
        </view>
        <view style="height: 32px" />
      </scroll-view>
    </view>
  </view>
</template>

<script>
import AppIcon from './AppIcon.vue'

const PRESET_TEMPLATES = [
  {
    id: 'tpl-1',
    category: 'space',
    tag: '空间渲染',
    title: '现代极简客餐厅大平层',
    prompt: '高档现代极简客餐厅，大理石地砖通铺，悬浮吊顶与无主灯设计，巨幅落地窗映入柔和日光，高定意式皮革沙发，极简静谧质感，8k高画质室内摄影',
    modelHint: 'Seedream 5.0 Flash',
    ratio: '16:9'
  },
  {
    id: 'tpl-2',
    category: 'space',
    tag: '室内漫游',
    title: '法式复古主卧自然光漫游',
    prompt: '法式复古风格主卧，奶油白法式雕花护墙板，人字拼木地板，晨光透过百叶窗洒在复古大床上，胶片颗粒质感，电影级柔和光影',
    modelHint: 'Qwen-Image 3.0',
    ratio: '4:3'
  },
  {
    id: 'tpl-3',
    category: 'video',
    tag: '电影运镜',
    title: '慢速推镜头 · 室内空间特写',
    prompt: '摄像机平稳向前缓慢推入，展示客厅餐桌与落地窗外的黄昏天际线，光影随镜头微移产生丁达尔效应，电影级画质，4k60帧',
    modelHint: 'Kling 2.0',
    ratio: '16:9'
  },
  {
    id: 'tpl-4',
    category: 'portrait',
    tag: '大师人像',
    title: '自然光情绪肖像',
    prompt: '胶片质感人像摄影，年轻女性半身侧影，自然柔光照亮面部轮廓，眼神清澈深邃，发丝细节清晰，轻微景深虚化，哈苏镜头质感',
    modelHint: '豆包生图',
    ratio: '3:4'
  },
  {
    id: 'tpl-5',
    category: 'video',
    tag: '视频运镜',
    title: '环绕升格镜头 · 家具产品展示',
    prompt: '360度环绕慢动作升格运镜，高定意式单人沙发细节特写，皮革纹理与金属底座在摄影棚柔光箱下流光溢彩，质感高级',
    modelHint: 'Kling 2.0',
    ratio: '16:9'
  }
]

export default {
  name: 'CreationLibraryDrawer',
  components: { AppIcon },
  props: {
    show: { type: Boolean, default: false },
    historyItems: { type: Array, default: () => [] }
  },
  emits: ['close', 'reuse-prompt', 'use-as-ref', 'preview'],
  data() {
    return {
      activeTab: 'history',
      activeCategory: 'all',
      templateCategories: [
        { id: 'all', label: '全部' },
        { id: 'space', label: '空间' },
        { id: 'video', label: '视频' },
        { id: 'portrait', label: '人像' }
      ],
      templates: PRESET_TEMPLATES
    }
  },
  computed: {
    filteredTemplates() {
      if (this.activeCategory === 'all') return this.templates
      return this.templates.filter(t => t.category === this.activeCategory)
    }
  },
  methods: {
    fmtTime(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    },
    onPreviewMedia(item) {
      if (!item || !item.url) return
      this.$emit('preview', item)
    },
    onSelectTemplate(tpl) {
      this.$emit('reuse-prompt', tpl.prompt)
      this.$emit('close')
      uni.showToast({ title: '已应用配方提示词', icon: 'none' })
    }
  }
}
</script>

<style scoped>
.c-drawer-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 999;
  display: flex;
  justify-content: flex-end;
}

.c-drawer-panel {
  width: 86vw;
  max-width: 380px;
  height: 100%;
  background: #F8F9FC;
  box-shadow: -4px 0 24px rgba(15, 23, 42, 0.12);
  display: flex;
  flex-direction: column;
  animation: slideInRight 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.c-head {
  padding: 16px 16px 12px;
  background: #FFFFFF;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.c-head-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.c-head-title {
  font-size: 15px;
  font-weight: 700;
  color: #0F172A;
}

.c-tabs {
  display: flex;
  background: #F1F5F9;
  padding: 2px;
  border-radius: 8px;
}

.c-tab {
  padding: 4px 10px;
  border-radius: 6px;
  transition: all 0.18s ease;
}

.c-tab.active {
  background: #FFFFFF;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.c-tab-t {
  font-size: 12px;
  font-weight: 500;
  color: #64748B;
}

.c-tab.active .c-tab-t {
  color: #0F172A;
  font-weight: 600;
}

.c-close {
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background: #F1F5F9;
  display: flex;
  align-items: center;
  justify-content: center;
}

.c-close-hover {
  background: #E2E8F0;
}

.c-body {
  flex: 1;
  padding: 12px 14px;
  box-sizing: border-box;
}

.c-empty {
  padding: 60px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.c-empty-icon {
  width: 56px;
  height: 56px;
  border-radius: 28px;
  background: #EDE8F5;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
}

.c-empty-t {
  font-size: 14px;
  font-weight: 600;
  color: #475569;
}

.c-empty-sub {
  font-size: 12px;
  color: #94A3B8;
  text-align: center;
}

.c-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.c-card {
  background: #FFFFFF;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
}

.c-card-media {
  position: relative;
  width: 100%;
  height: 160px;
  background: #0F172A;
}

.c-card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.c-card-video-wrap {
  width: 100%;
  height: 100%;
  position: relative;
}

.c-video-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.c-card-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.c-card-tag-t {
  font-size: 10px;
  font-weight: 600;
  color: #FFFFFF;
}

.c-card-info {
  padding: 10px 12px 12px;
}

.c-card-prompt {
  font-size: 12px;
  line-height: 1.5;
  color: #1E293B;
  margin-bottom: 8px;
}

.c-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.c-card-time {
  font-size: 11px;
  color: #94A3B8;
}

.c-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.c-act-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 6px;
  background: #F1F5F9;
  border: 1px solid rgba(0, 0, 0, 0.04);
}

.c-act-btn.accent {
  background: #EFF6FF;
  border-color: #BFDBFE;
}

.c-act-t {
  font-size: 11px;
  font-weight: 500;
  color: #007AFF;
}

/* 模板样式 */
.c-filter-row {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.c-cat-pill {
  padding: 4px 12px;
  border-radius: 14px;
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.c-cat-pill.active {
  background: #007AFF;
  border-color: #007AFF;
}

.c-cat-t {
  font-size: 12px;
  color: #475569;
}

.c-cat-pill.active .c-cat-t {
  color: #FFFFFF;
  font-weight: 600;
}

.c-tpl-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.c-tpl-card {
  background: #FFFFFF;
  border-radius: 12px;
  padding: 12px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
  transition: transform 0.15s ease;
}

.c-tpl-hover {
  transform: scale(0.99);
}

.c-tpl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.c-tpl-title {
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
}

.c-tpl-badge {
  padding: 2px 6px;
  border-radius: 4px;
  background: #F1F5F9;
}

.c-tpl-badge-t {
  font-size: 10px;
  color: #64748B;
}

.c-tpl-desc {
  font-size: 12px;
  color: #475569;
  line-height: 1.45;
  margin-bottom: 8px;
}

.c-tpl-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px dashed #F1F5F9;
  padding-top: 6px;
}

.c-tpl-meta {
  font-size: 11px;
  color: #94A3B8;
}

.c-tpl-apply-t {
  font-size: 11px;
  font-weight: 600;
  color: #007AFF;
}
</style>
