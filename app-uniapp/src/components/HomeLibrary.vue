<template>
  <view class="hl">
    <!-- 快捷入口 -->
    <view class="hl-quick-row">
      <view v-for="q in quickEntries" :key="q.key" class="hl-quick" @click="$emit('quick', q.key)">
        <view class="hl-quick-ico"><text class="hl-quick-glyph">{{ q.icon }}</text></view>
        <text class="hl-quick-label">{{ q.label }}</text>
      </view>
    </view>

    <!-- 最近入库 -->
    <view class="hl-head">
      <text class="hl-title">最近入库</text>
      <text class="hl-more" @click="$emit('open-picker')">全部素材 ›</text>
    </view>

    <scroll-view scroll-x class="hl-scroll" :show-scrollbar="false" enable-flex>
      <view v-if="loading && !items.length" class="hl-empty">
        <text class="hl-empty-t">正在读取素材库…</text>
      </view>
      <view v-else-if="!items.length" class="hl-empty">
        <text class="hl-empty-t">素材库暂无图片，去「素材库」标签上传或同步</text>
      </view>
      <view v-else class="hl-row">
        <view v-for="it in items" :key="it.fid" class="hl-card" @click="$emit('use', it)">
          <image :src="it.imgUrl" class="hl-img" mode="aspectFill" :lazy-load="true" />
          <text v-if="it.category" class="hl-cap">{{ it.category }}</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { fetchAssets, gridUrl } from '../service/ViewerApi'

export default {
  name: 'HomeLibrary',
  props: {
    active: { type: Boolean, default: false },
  },
  data() {
    return {
      items: [],
      loading: false,
      loaded: false,
      quickEntries: [
        { key: 'chat', icon: '💬', label: '标签对话' },
        { key: 'edit', icon: '🎯', label: '精准编辑' },
        { key: 'pick', icon: '🖼️', label: '选参考图' },
        { key: 'roam', icon: '🚶', label: '空间漫游' },
      ],
    }
  },
  watch: {
    active(v) {
      if (v) this.load()
    },
  },
  mounted() {
    if (this.active) this.load()
  },
  methods: {
    async load() {
      if (this.loading) return
      this.loading = true
      try {
        const res = await fetchAssets({ page: 1, pageSize: 12, sort: 'latest', mediaType: 'image' })
        const list = Array.isArray(res) ? res : ((res && (res.items || res.data || res.assets)) || [])
        this.items = list.map((a) => ({
          fid: a.fid,
          imgUrl: gridUrl(a.fid),
          fileName: a.file_name || a.fileName || a.fid,
          category: a.category === 'furniture' ? '单品' : (a.category === 'portrait' ? '人像' : '场景'),
          tagsText: [a.space, a.style, a.furniture_item, a.material].filter(Boolean).slice(0, 2).join(' · '),
        }))
        this.loaded = true
      } catch (e) {
        this.items = []
      } finally {
        this.loading = false
      }
    },
  },
}
</script>

<style scoped>
.hl {
  padding: 12px 16px 24px;
}
.hl-quick-row {
  display: flex;
  flex-direction: row;
}
.hl-quick {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 4px;
  margin-right: 8px;
  background: #FFFFFF;
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}
.hl-quick:last-child {
  margin-right: 0;
}
.hl-quick-ico {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: #F1F5F9;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hl-quick-glyph {
  font-size: 20px;
  line-height: 1;
}
.hl-quick-label {
  margin-top: 8px;
  font-size: 11px;
  color: #475569;
}
.hl-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin: 20px 0 10px;
}
.hl-title {
  font-size: 15px;
  font-weight: 600;
  color: #0F172A;
}
.hl-more {
  font-size: 12px;
  color: #2563EB;
}
.hl-scroll {
  white-space: nowrap;
  width: 100%;
}
.hl-row {
  display: flex;
  flex-direction: row;
}
.hl-card {
  width: 104px;
  margin-right: 10px;
  flex-shrink: 0;
}
.hl-img {
  width: 104px;
  height: 132px;
  border-radius: 12px;
  background: #E2E8F0;
}
.hl-cap {
  display: block;
  margin-top: 5px;
  font-size: 11px;
  color: #64748B;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hl-empty {
  padding: 28px 0;
  width: 100%;
}
.hl-empty-t {
  font-size: 12px;
  color: #94A3B8;
}
</style>
