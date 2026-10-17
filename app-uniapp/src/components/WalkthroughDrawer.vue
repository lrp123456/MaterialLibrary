<template>
  <view v-if="visible" class="drawer-mask" @click="onMaskClick">
    <view class="drawer-body" @click.stop>
      <!-- 顶部拖拽条与标题 -->
      <view class="drawer-handle" />
      <view class="drawer-header">
        <view>
          <text class="drawer-title">室内空间漫游装配</text>
          <text class="drawer-sub">串联多个空间实景，自动生成连贯游览成片</text>
        </view>
        <text class="drawer-close" @click="onClose">✕</text>
      </view>

      <scroll-view scroll-y class="drawer-scroll">
        <!-- 1. 空间时序编排 -->
        <view class="drawer-sec">
          <view class="sec-head">
            <text class="sec-name">游览动线时序 ({{ localAssets.length }} 个空间)</text>
            <text class="sec-tip">可点击左右箭头微调前后顺序</text>
          </view>
          <scroll-view scroll-x class="seq-scroll" :show-scrollbar="false">
            <view class="seq-row">
              <view
                v-for="(item, idx) in localAssets"
                :key="item.fid"
                class="seq-card"
              >
                <view class="seq-thumb-box">
                  <image class="seq-img" :src="item.imgUrl" mode="aspectFill" />
                  <view class="seq-order-badge">
                    <text class="seq-order-num">{{ idx + 1 }}</text>
                  </view>
                  <text class="seq-remove" @click="removeItem(idx)">✕</text>
                </view>
                <text class="seq-name-label">{{ item.tagsText || item.fileName }}</text>
                <view class="seq-moves">
                  <text
                    class="move-btn"
                    :class="{ disabled: idx === 0 }"
                    @click="moveItem(idx, -1)"
                  >‹</text>
                  <text
                    class="move-btn"
                    :class="{ disabled: idx === localAssets.length - 1 }"
                    @click="moveItem(idx, 1)"
                  >›</text>
                </view>
              </view>
            </view>
          </scroll-view>
        </view>

        <!-- 2. 运镜风格预设 -->
        <view class="drawer-sec">
          <text class="sec-name">漫游运镜预设</text>
          <view class="opt-grid">
            <view
              v-for="c in cameraStyles"
              :key="c.id"
              class="opt-card"
              :class="{ active: cameraStyle === c.id }"
              @click="cameraStyle = c.id"
            >
              <text class="opt-icon">{{ c.icon }}</text>
              <view class="opt-info">
                <text class="opt-title">{{ c.title }}</text>
                <text class="opt-desc">{{ c.desc }}</text>
              </view>
            </view>
          </view>
        </view>

        <!-- 3. 画幅比例与时长 -->
        <view class="drawer-sec">
          <text class="sec-name">画幅与成片规格</text>
          <view class="row-opts">
            <view
              v-for="r in aspectRatios"
              :key="r.id"
              class="pill-opt"
              :class="{ active: aspectRatio === r.id }"
              @click="aspectRatio = r.id"
            >
              {{ r.label }}
            </view>
            <view class="pill-divider" />
            <view
              v-for="d in durations"
              :key="d.id"
              class="pill-opt"
              :class="{ active: sceneDuration === d.id }"
              @click="sceneDuration = d.id"
            >
              {{ d.label }}
            </view>
          </view>
        </view>
      </scroll-view>

      <!-- 底部操作栏 -->
      <view class="drawer-footer">
        <view class="footer-summary">
          <text class="sum-text">共 {{ localAssets.length }} 个空间 · 预计成片 {{ totalSeconds }} 秒</text>
        </view>
        <view class="footer-actions">
          <view class="btn-cancel" @click="onClose">取消</view>
          <button
            class="btn-submit"
            :loading="submitting"
            :disabled="submitting || localAssets.length < 2"
            @click="onSubmit"
          >
            进入路线确认
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  name: 'WalkthroughDrawer',
  props: {
    visible: {
      type: Boolean,
      default: false,
    },
    selectedAssets: {
      type: Array,
      default: () => [],
    },
  },
  data() {
    return {
      localAssets: [],
      cameraStyle: 'smooth_walk',
      aspectRatio: '16:9',
      sceneDuration: 4,
      submitting: false,
      cameraStyles: [
        { id: 'smooth_walk', icon: '🚶‍♂️', title: '沉浸平缓漫游', desc: '镜头平稳前推与视角微旋，居室经典质感' },
        { id: 'push_in', icon: '🚪', title: '空间推拉穿梭', desc: '从门厅自然穿入下个空间，转场丝滑' },
        { id: 'panoramic_orbit', icon: '🔄', title: '广角全景环视', desc: '大空间环视微扫，客餐厅大视野呈现' },
      ],
      aspectRatios: [
        { id: '16:9', label: '16:9 横屏漫游' },
        { id: '9:16', label: '9:16 竖屏短视频' },
      ],
      durations: [
        { id: 3, label: '3秒/空间' },
        { id: 4, label: '4秒/空间 (推荐)' },
        { id: 5, label: '5秒/空间' },
      ],
    }
  },
  computed: {
    totalSeconds() {
      return this.localAssets.length * this.sceneDuration
    },
  },
  watch: {
    selectedAssets: {
      immediate: true,
      handler(val) {
        this.localAssets = [...(val || [])]
      },
    },
  },
  methods: {
    onMaskClick() {
      this.onClose()
    },
    onClose() {
      this.$emit('close')
    },
    removeItem(idx) {
      this.localAssets.splice(idx, 1)
      if (this.localAssets.length === 0) {
        this.onClose()
      }
    },
    moveItem(idx, dir) {
      const target = idx + dir
      if (target < 0 || target >= this.localAssets.length) return
      const temp = this.localAssets[idx]
      this.localAssets.splice(idx, 1)
      this.localAssets.splice(target, 0, temp)
    },
    onSubmit() {
      if (this.localAssets.length < 2) {
        uni.showToast({ title: '至少需要 2 个空间照片生成漫游', icon: 'none' })
        return
      }
      if (this.localAssets.length > 6) {
        uni.showToast({ title: '漫游最多 6 张空间照片', icon: 'none' })
        return
      }
      const styleMap = {
        smooth_walk: '平稳向前推进',
        push_in: '从门口向前穿入下一空间',
        panoramic_orbit: '广角平视缓慢环视',
      }
      const fids = this.localAssets.map(a => a.fid).filter(Boolean)
      const q = [
        `fids=${encodeURIComponent(JSON.stringify(fids))}`,
        `aspect=${encodeURIComponent(this.aspectRatio)}`,
        `duration=${encodeURIComponent(this.sceneDuration)}`,
        `style=${encodeURIComponent(styleMap[this.cameraStyle] || '平稳向前推进')}`,
      ]
      this.onClose()
      uni.navigateTo({ url: `/pages/quick/walkthrough?${q.join('&')}` })
    },
  },
}
</script>

<style scoped>
.drawer-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.drawer-body {
  background: #ffffff;
  border-radius: 36rpx 36rpx 0 0;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
  animation: slideUp 0.28s ease-out;
}
@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.drawer-handle {
  width: 72rpx;
  height: 8rpx;
  background: #cbd5e1;
  border-radius: 4rpx;
  margin: 16rpx auto 8rpx;
}
.drawer-header {
  padding: 16rpx 32rpx 20rpx;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1rpx solid #f1f5f9;
}
.drawer-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #0f172a;
  display: block;
}
.drawer-sub {
  font-size: 22rpx;
  color: #64748b;
  margin-top: 4rpx;
  display: block;
}
.drawer-close {
  font-size: 32rpx;
  color: #94a3b8;
  padding: 8rpx;
}
.drawer-scroll {
  flex: 1;
  padding: 24rpx 32rpx;
  box-sizing: border-box;
  max-height: 55vh;
}
.drawer-sec {
  margin-bottom: 32rpx;
}
.sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16rpx;
}
.sec-name {
  font-size: 26rpx;
  font-weight: 700;
  color: #1e293b;
  display: block;
  margin-bottom: 14rpx;
}
.sec-tip {
  font-size: 20rpx;
  color: #94a3b8;
}
.seq-scroll {
  white-space: nowrap;
}
.seq-row {
  display: flex;
  gap: 20rpx;
  padding: 4rpx 0 12rpx;
}
.seq-card {
  width: 170rpx;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.seq-thumb-box {
  width: 170rpx;
  height: 220rpx;
  border-radius: 18rpx;
  overflow: hidden;
  position: relative;
  background: #f1f5f9;
  border: 1rpx solid #e2e8f0;
}
.seq-img {
  width: 100%;
  height: 100%;
  display: block;
}
.seq-order-badge {
  position: absolute;
  top: 10rpx;
  left: 10rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 20rpx;
  background: #2563eb;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.seq-order-num {
  font-size: 22rpx;
  font-weight: 700;
}
.seq-remove {
  position: absolute;
  top: 8rpx;
  right: 8rpx;
  width: 36rpx;
  height: 36rpx;
  border-radius: 18rpx;
  background: rgba(15, 23, 42, 0.6);
  color: #ffffff;
  font-size: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.seq-name-label {
  font-size: 20rpx;
  color: #334155;
  margin-top: 8rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  text-align: center;
}
.seq-moves {
  display: flex;
  gap: 16rpx;
  margin-top: 6rpx;
}
.move-btn {
  width: 44rpx;
  height: 44rpx;
  border-radius: 22rpx;
  background: #f1f5f9;
  color: #1e293b;
  font-size: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
.move-btn.disabled {
  opacity: 0.3;
  pointer-events: none;
}
.opt-grid {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}
.opt-card {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 20rpx;
  border-radius: 18rpx;
  border: 1rpx solid #e2e8f0;
  background: #f8fafc;
}
.opt-card.active {
  border-color: #2563eb;
  background: #eff6ff;
}
.opt-icon {
  font-size: 34rpx;
}
.opt-info {
  flex: 1;
}
.opt-title {
  font-size: 24rpx;
  font-weight: 600;
  color: #0f172a;
  display: block;
}
.opt-desc {
  font-size: 20rpx;
  color: #64748b;
  margin-top: 2rpx;
  display: block;
}
.row-opts {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
}
.pill-opt {
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  background: #f1f5f9;
  color: #64748b;
  border: 1rpx solid transparent;
}
.pill-opt.active {
  background: #eff6ff;
  color: #2563eb;
  border-color: #bfdbfe;
  font-weight: 600;
}
.pill-divider {
  width: 1rpx;
  height: 28rpx;
  background: #e2e8f0;
  margin: 0 4rpx;
}
.drawer-footer {
  padding: 18rpx 32rpx 28rpx;
  border-top: 1rpx solid #f1f5f9;
  background: #ffffff;
}
.footer-summary {
  margin-bottom: 16rpx;
  text-align: center;
}
.sum-text {
  font-size: 22rpx;
  color: #64748b;
}
.footer-actions {
  display: flex;
  gap: 20rpx;
}
.btn-cancel {
  flex: 1;
  height: 84rpx;
  border-radius: 42rpx;
  background: #f1f5f9;
  color: #64748b;
  font-size: 26rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-submit {
  flex: 2;
  height: 84rpx;
  border-radius: 42rpx;
  background: linear-gradient(135deg, #2563eb, #6366f1);
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
}
.btn-submit[disabled] {
  opacity: 0.5;
}
</style>
