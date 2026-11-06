<template>
  <view v-if="show" class="drawer-mask" @click="$emit('close')">
    <view class="drawer-panel" @click.stop>
      <!-- 头部 -->
      <view class="drawer-head">
        <view class="drawer-head-left">
          <AppIcon name="chat" :size="20" color="#0F172A" />
          <text class="drawer-title">创作会话</text>
        </view>
        <view class="drawer-new" @click="$emit('new')" hover-class="drawer-new-hover">
          <AppIcon name="plus" :size="13" color="#007AFF" />
          <text class="drawer-new-t">新对话</text>
        </view>
      </view>

      <!-- 模态筛选器 -->
      <view class="drawer-filters">
        <view
          v-for="f in filters"
          :key="f.id"
          :class="['filter-chip', { active: activeFilter === f.id }]"
          @click="activeFilter = f.id"
        >
          <text class="filter-t">{{ f.label }}</text>
        </view>
      </view>

      <!-- 会话列表 -->
      <scroll-view scroll-y class="drawer-list" :scroll-with-animation="true">
        <view v-if="loading" class="drawer-empty">
          <text class="drawer-loading-t">同步云端会话中…</text>
        </view>
        <view v-else-if="filteredSessions.length === 0" class="drawer-empty">
          <AppIcon name="chat" :size="28" color="#CBD5E1" />
          <text class="drawer-empty-t">暂无此类会话</text>
          <text class="drawer-empty-sub">轻触右上角「新对话」随时开启</text>
        </view>
        <view
          v-for="s in filteredSessions"
          :key="s.sessionId"
          :class="['session-item', { current: s.sessionId === currentId }]"
          @click="$emit('select', s)"
          hover-class="session-item-hover"
        >
          <view class="session-kind" :style="{ background: kindStyle(s).soft }">
            <AppIcon :name="kindStyle(s).icon" :size="17" :color="kindStyle(s).tint" />
          </view>
          <view class="session-meta">
            <view class="session-meta-top">
              <text class="session-name" number-of-lines="1">{{ s.title || '未命名会话' }}</text>
              <text v-if="s.productCount || s.product_count" class="session-badge">
                {{ s.productCount || s.product_count }}个作品
              </text>
            </view>
            <text class="session-sub">{{ kindStyle(s).label }} · {{ fmtTime(s.updatedAt || s.createdAt) }}</text>
          </view>
          <view class="session-del" @click.stop="onDelete(s)" hover-class="session-del-hover">
            <AppIcon name="trash" :size="14" color="#94A3B8" />
          </view>
        </view>
        <view style="height: 32px" />
      </scroll-view>
    </view>
  </view>
</template>

<script>
import AppIcon from './AppIcon.vue'

export default {
  name: 'SessionDrawer',
  components: { AppIcon },
  props: {
    show: { type: Boolean, default: false },
    sessions: { type: Array, default: () => [] },
    currentId: { type: String, default: '' },
    loading: { type: Boolean, default: false },
    defaultFilter: { type: String, default: 'all' }
  },
  emits: ['close', 'select', 'new', 'delete'],
  data() {
    return {
      activeFilter: this.defaultFilter || 'all',
      filters: [
        { id: 'all', label: '全部' },
        { id: 'image', label: '生图' },
        { id: 'video', label: '视频' },
        { id: 'chat', label: '对话' },
        { id: 'music', label: '音频' },
      ],
    }
  },
  watch: {
    defaultFilter(val) {
      if (val) this.activeFilter = val
    }
  },
  computed: {
    filteredSessions() {
      if (this.activeFilter === 'all') return this.sessions
      return this.sessions.filter((s) => (s.type || 'chat') === this.activeFilter)
    },
  },
  methods: {
    kindStyle(s) {
      const t = (s && s.type) || 'chat'
      const map = {
        chat: { icon: 'chat', label: '对话', tint: '#0284C7', soft: '#E0F2FE' },
        image: { icon: 'image', label: '生图', tint: '#007AFF', soft: '#EFF6FF' },
        video: { icon: 'video', label: '视频', tint: '#8B5CF6', soft: '#F5F3FF' },
        music: { icon: 'audio', label: '音频', tint: '#F97316', soft: '#FFF7ED' },
        portrait: { icon: 'portrait', label: '人像', tint: '#EC4899', soft: '#FDF2F8' },
      }
      return map[t] || map.chat
    },
    fmtTime(ts) {
      const t = Number(ts)
      if (!t) return ''
      const d = new Date(ts)
      const pad = (n) => String(n).padStart(2, '0')
      const today = new Date()
      const sameDay = d.toDateString() === today.toDateString()
      if (sameDay) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    },
    onDelete(s) {
      uni.showModal({
        title: '删除会话',
        content: `确认删除「${s.title || '未命名会话'}」？删除后云端记录将同步移除。`,
        confirmText: '删除',
        confirmColor: '#EF4444',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) this.$emit('delete', s)
        },
      })
    },
  },
}
</script>

<style scoped>
.drawer-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 998;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.drawer-panel {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 82vw;
  max-width: 360px;
  background: #FFFFFF;
  border-radius: 0 20px 20px 0;
  padding-top: env(safe-area-inset-top);
  display: flex;
  flex-direction: column;
  box-shadow: 4px 0 24px rgba(15, 23, 42, 0.12);
  animation: slideInLeft 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideInLeft {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.drawer-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drawer-title {
  font-size: 16px;
  font-weight: 700;
  color: #0F172A;
}

.drawer-new {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #EFF6FF;
  border: 1px solid #DBEAFE;
  border-radius: 999px;
  padding: 6px 12px;
}

.drawer-new-hover {
  background: #DBEAFE;
}

.drawer-new-t {
  font-size: 12px;
  font-weight: 600;
  color: #007AFF;
}

.drawer-filters {
  display: flex;
  gap: 6px;
  padding: 10px 14px 10px;
  flex-wrap: wrap;
  background: #F8FAFC;
}

.filter-chip {
  border-radius: 8px;
  padding: 4px 10px;
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.06);
  transition: all 0.16s ease;
}

.filter-chip.active {
  background: #007AFF;
  border-color: #007AFF;
}

.filter-t {
  font-size: 11px;
  color: #64748B;
  font-weight: 500;
}

.filter-chip.active .filter-t {
  color: #FFFFFF;
  font-weight: 600;
}

.drawer-list {
  flex: 1;
  padding: 8px 12px;
}

.drawer-empty {
  padding: 56px 0;
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drawer-loading-t {
  color: #94A3B8;
  font-size: 12px;
}

.drawer-empty-t {
  color: #475569;
  font-size: 13px;
  font-weight: 600;
}

.drawer-empty-sub {
  color: #94A3B8;
  font-size: 11px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px;
  margin-bottom: 6px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.03);
  background: #FFFFFF;
  transition: all 0.15s ease;
}

.session-item.current {
  background: #EFF6FF;
  border-color: #BFDBFE;
}

.session-item-hover {
  background: #F8FAFC;
}

.session-kind {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  display: flex;
}

.session-meta {
  flex: 1;
  gap: 3px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.session-meta-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-name {
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
  flex: 1;
}

.session-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #F1F5F9;
  color: #64748B;
  flex-shrink: 0;
}

.session-sub {
  font-size: 11px;
  color: #94A3B8;
}

.session-del {
  width: 28px;
  height: 28px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.session-del-hover {
  background: #FEE2E2;
}
</style>
