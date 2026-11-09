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

      <!-- 创作配方 Tab（与桌面端共用 creation_templates） -->
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
          <view class="c-refresh-pill" :class="{ busy: templatesLoading }" @click="loadTemplates(true)">
            <AppIcon name="refresh" :size="11" color="#64748B" />
            <text class="c-refresh-t">刷新</text>
          </view>
        </view>

        <view
          class="c-save-row"
          :class="{ disabled: !currentRecipe || !currentRecipe.prompt }"
          @click="saveCurrentRecipe"
        >
          <AppIcon name="plus" :size="13" color="#007AFF" />
          <text class="c-save-t">把当前输入存为配方</text>
        </view>

        <view v-if="templatesLoading && !templates.length" class="c-empty">
          <view class="c-empty-icon"><AppIcon name="library" :size="30" color="#94A3B8" /></view>
          <text class="c-empty-t">正在加载配方…</text>
        </view>
        <view v-else-if="templatesError" class="c-empty">
          <view class="c-empty-icon"><AppIcon name="library" :size="30" color="#94A3B8" /></view>
          <text class="c-empty-t">配方加载失败</text>
          <text class="c-empty-sub">{{ templatesError }}</text>
          <view class="c-retry" @click="loadTemplates(true)"><text class="c-retry-t">重试</text></view>
        </view>
        <view v-else-if="!filteredTemplates.length" class="c-empty">
          <view class="c-empty-icon"><AppIcon name="library" :size="30" color="#94A3B8" /></view>
          <text class="c-empty-t">还没有创作配方</text>
          <text class="c-empty-sub">生成作品后可在桌面端保存配方，或从外部数据源拉取</text>
          <view class="c-retry" :class="{ busy: pullingExternal }" @click="pullExternal">
            <text class="c-retry-t">{{ pullingExternal ? '拉取中…' : '拉取外部配方' }}</text>
          </view>
        </view>

        <view v-else class="c-tpl-list">
          <view
            v-for="tpl in filteredTemplates"
            :key="tpl.id"
            class="c-tpl-card"
            @click="onApplyTemplate(tpl)"
            @longpress="openTemplateMenu(tpl)"
            hover-class="c-tpl-hover"
          >
            <view class="c-tpl-head">
              <text class="c-tpl-title">{{ tpl.title }}</text>
              <view class="c-tpl-head-right">
                <text v-if="tpl.is_pinned" class="c-pin-t">置顶</text>
                <view class="c-tpl-badge">
                  <text class="c-tpl-badge-t">{{ typeLabel(tpl.type) }}</text>
                </view>
              </view>
            </view>
            <text class="c-tpl-desc" number-of-lines="2">{{ tpl.prompt }}</text>
            <view class="c-tpl-foot">
              <text class="c-tpl-meta">{{ tpl.aspect_ratio || '16:9' }} · 复用 {{ tpl.use_count || 0 }} 次</text>
              <view class="c-tpl-apply">
                <text class="c-tpl-apply-t">应用此配方 →</text>
              </view>
            </view>
            <view class="c-tpl-tools">
              <text class="c-tpl-tool" @click.stop="togglePin(tpl)">{{ tpl.is_pinned ? '取消置顶' : '置顶' }}</text>
              <text class="c-tpl-tool" @click.stop="renameTemplate(tpl)">重命名</text>
              <text class="c-tpl-tool danger" @click.stop="removeTemplate(tpl)">删除</text>
            </view>
          </view>
          <view class="c-pull-row" :class="{ busy: pullingExternal }" @click="pullExternal">
            <AppIcon name="cloud" :size="13" color="#007AFF" />
            <text class="c-pull-t">{{ pullingExternal ? '正在拉取外部配方…' : '拉取外部数据源配方' }}</text>
          </view>
        </view>
        <view style="height: 32px" />
      </scroll-view>
    </view>
  </view>
</template>

<script>
import AppIcon from './AppIcon.vue'
import {
  fetchCreationTemplates,
  createCreationTemplate,
  markCreationTemplateUsed,
  patchCreationTemplate,
  deleteCreationTemplate,
  pullExternalCreationTemplates,
} from '../service/ViewerApi'

const TYPE_LABELS = { image: '图片', video: '视频', audio: '音频', music: '音乐' }

export default {
  name: 'CreationLibraryDrawer',
  components: { AppIcon },
  props: {
    show: { type: Boolean, default: false },
    historyItems: { type: Array, default: () => [] },
    currentRecipe: { type: Object, default: null }
  },
  emits: ['close', 'reuse-prompt', 'use-as-ref', 'preview', 'apply-template'],
  data() {
    return {
      activeTab: 'history',
      activeCategory: 'all',
      templates: [],
      templatesLoading: false,
      templatesError: '',
      templatesLoaded: false,
      pullingExternal: false
    }
  },
  computed: {
    templateCategories() {
      const counts = {}
      for (const t of this.templates) {
        const type = t.type || 'image'
        counts[type] = (counts[type] || 0) + 1
      }
      const cats = [{ id: 'all', label: '全部' }]
      for (const type of ['image', 'video', 'audio']) {
        if (counts[type]) cats.push({ id: type, label: TYPE_LABELS[type] || type })
      }
      for (const type of Object.keys(counts)) {
        if (!['image', 'video', 'audio'].includes(type)) {
          cats.push({ id: type, label: TYPE_LABELS[type] || type })
        }
      }
      return cats
    },
    filteredTemplates() {
      const list = this.activeCategory === 'all'
        ? this.templates
        : this.templates.filter(t => (t.type || 'image') === this.activeCategory)
      return [...list].sort((a, b) => {
        const pinDiff = Number(b.is_pinned || 0) - Number(a.is_pinned || 0)
        if (pinDiff) return pinDiff
        const useDiff = Number(b.use_count || 0) - Number(a.use_count || 0)
        if (useDiff) return useDiff
        return Number(b.updated_at || 0) - Number(a.updated_at || 0)
      })
    }
  },
  watch: {
    show(val) {
      if (val && this.activeTab === 'templates' && !this.templatesLoaded) this.loadTemplates()
    },
    activeTab(val) {
      if (val === 'templates' && this.show && !this.templatesLoaded && !this.templatesLoading) {
        this.loadTemplates()
      }
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
    typeLabel(type) {
      return TYPE_LABELS[type] || type || '图片'
    },
    async loadTemplates(force = false) {
      if (this.templatesLoading) return
      if (!force && this.templatesLoaded) return
      this.templatesLoading = true
      this.templatesError = ''
      try {
        this.templates = await fetchCreationTemplates()
        this.templatesLoaded = true
      } catch (err) {
        this.templatesError = (err && err.message) || '网络异常'
        this.templatesLoaded = false
      } finally {
        this.templatesLoading = false
      }
    },
    async onApplyTemplate(tpl) {
      if (!tpl || !tpl.id) return
      this.$emit('apply-template', tpl)
      this.$emit('close')
      try {
        const res = await markCreationTemplateUsed(tpl.id)
        const bumped = res && res.use_count !== undefined ? Number(res.use_count) : Number(tpl.use_count || 0) + 1
        const row = this.templates.find(t => t.id === tpl.id)
        if (row) row.use_count = bumped
      } catch (err) {
        // 频次累加失败不影响应用
      }
    },
    async togglePin(tpl) {
      if (!tpl || !tpl.id) return
      const next = tpl.is_pinned ? 0 : 1
      try {
        const res = await patchCreationTemplate(tpl.id, { is_pinned: next })
        tpl.is_pinned = res && res.is_pinned !== undefined ? Number(res.is_pinned) : next
        uni.showToast({ title: next ? '已置顶' : '已取消置顶', icon: 'none' })
      } catch (err) {
        uni.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
      }
    },
    renameTemplate(tpl) {
      if (!tpl || !tpl.id) return
      uni.showModal({
        title: '重命名配方',
        editable: true,
        placeholderText: '输入新的配方名称',
        content: tpl.title || '',
        success: async (res) => {
          if (!res.confirm) return
          const title = String(res.content || '').trim()
          if (!title) {
            uni.showToast({ title: '名称不可为空', icon: 'none' })
            return
          }
          try {
            await patchCreationTemplate(tpl.id, { title })
            tpl.title = title
            uni.showToast({ title: '已重命名', icon: 'none' })
          } catch (err) {
            uni.showToast({ title: (err && err.message) || '重命名失败', icon: 'none' })
          }
        }
      })
    },
    removeTemplate(tpl) {
      if (!tpl || !tpl.id) return
      uni.showModal({
        title: '删除配方',
        content: `确定删除「${tpl.title || '该配方'}」吗？`,
        confirmText: '删除',
        confirmColor: '#DC2626',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deleteCreationTemplate(tpl.id)
            this.templates = this.templates.filter(t => t.id !== tpl.id)
            uni.showToast({ title: '已删除', icon: 'none' })
          } catch (err) {
            uni.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          }
        }
      })
    },
    openTemplateMenu(tpl) {
      if (!tpl || !tpl.id) return
      uni.showActionSheet({
        itemList: [tpl.is_pinned ? '取消置顶' : '置顶', '重命名', '删除'],
        success: (res) => {
          if (res.tapIndex === 0) this.togglePin(tpl)
          else if (res.tapIndex === 1) this.renameTemplate(tpl)
          else if (res.tapIndex === 2) this.removeTemplate(tpl)
        }
      })
    },
    saveCurrentRecipe() {
      const recipe = this.currentRecipe
      if (!recipe || !recipe.prompt) {
        uni.showToast({ title: '先在输入框写下创作想法', icon: 'none' })
        return
      }
      const fallbackTitle = String(recipe.prompt).slice(0, 16)
      uni.showModal({
        title: '保存为配方',
        editable: true,
        content: fallbackTitle,
        placeholderText: '给配方起个名字',
        success: async (res) => {
          if (!res.confirm) return
          const title = String(res.content || '').trim() || fallbackTitle
          try {
            const created = await createCreationTemplate({ ...recipe, title })
            if (created && created.id) {
              this.templates = [{
                ...created,
                params: recipe.params || {},
                origin_images: recipe.origin_images || [],
                aspect_ratio: created.aspect_ratio || recipe.aspect_ratio || '16:9',
                updated_at: created.updated_at || Date.now()
              }, ...this.templates]
              this.activeCategory = 'all'
              this.templatesLoaded = true
            } else {
              await this.loadTemplates(true)
            }
            uni.showToast({ title: '已存入创作配方', icon: 'none' })
          } catch (err) {
            uni.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
          }
        }
      })
    },
    async pullExternal() {
      if (this.pullingExternal) return
      this.pullingExternal = true
      try {
        const res = await pullExternalCreationTemplates()
        const count = Number((res && (res.count || res.imported || res.cards)) || 0)
        await this.loadTemplates(true)
        uni.showToast({
          title: count > 0 ? `已拉取 ${count} 条配方` : '拉取完成',
          icon: 'none'
        })
      } catch (err) {
        uni.showToast({ title: (err && err.message) || '拉取失败', icon: 'none' })
      } finally {
        this.pullingExternal = false
      }
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
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
}

.c-refresh-pill {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 10px;
  border-radius: 14px;
  background: #F8FAFC;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.c-refresh-pill.busy {
  opacity: 0.55;
}

.c-refresh-t {
  font-size: 11px;
  color: #64748B;
}

.c-retry {
  margin-top: 4px;
  padding: 7px 18px;
  border-radius: 999px;
  background: #007AFF;
}

.c-retry.busy {
  opacity: 0.6;
}

.c-retry-t {
  font-size: 12px;
  font-weight: 600;
  color: #FFFFFF;
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
  flex: 1;
  min-width: 0;
  margin-right: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.c-tpl-head-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.c-pin-t {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.12);
  font-size: 10px;
  font-weight: 600;
  color: #B45309;
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

.c-tpl-tools {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed #F1F5F9;
}

.c-tpl-tool {
  font-size: 11px;
  color: #64748B;
}

.c-tpl-tool.danger {
  color: #DC2626;
}

.c-save-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin-bottom: 10px;
  padding: 10px;
  border-radius: 12px;
  background: rgba(0, 122, 255, 0.07);
  border: 1px solid rgba(0, 122, 255, 0.16);
}

.c-save-row.disabled {
  opacity: 0.45;
}

.c-save-t {
  font-size: 12px;
  font-weight: 600;
  color: #007AFF;
}

.c-pull-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin-top: 4px;
  padding: 11px;
  border-radius: 12px;
  border: 1px dashed rgba(0, 122, 255, 0.28);
  background: rgba(0, 122, 255, 0.04);
}

.c-pull-row.busy {
  opacity: 0.6;
}

.c-pull-t {
  font-size: 12px;
  font-weight: 500;
  color: #007AFF;
}
</style>
