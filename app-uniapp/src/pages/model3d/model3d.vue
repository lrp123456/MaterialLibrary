<template>
  <view class="page">
    <web-view v-if="src" :src="src" @message="onMessage" />
    <view v-else class="state">
      <text class="state-t">缺少 3D 模型地址</text>
      <view class="state-btn" @click="goBack"><text class="state-btn-t">返回</text></view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      src: '',
      product: null,
    }
  },
  onLoad(options = {}) {
    const sys = uni.getSystemInfoSync()
    const top = sys.statusBarHeight || 0
    const modelSrc = decodeURIComponent(options.src || '')
    const name = decodeURIComponent(options.name || '')
    const yaw = Number(options.yaw || 0) || 0
    const pitch = Number(options.pitch || 0) || 0
    this.product = {
      id: decodeURIComponent(options.id || ''),
      name,
      modelUrl: modelSrc,
    }
    if (!modelSrc || !/^https?:\/\//i.test(modelSrc)) {
      this.src = ''
      return
    }
    const q = [
      'src=' + encodeURIComponent(modelSrc),
      'name=' + encodeURIComponent(name),
      'yaw=' + encodeURIComponent(String(yaw)),
      'pitch=' + encodeURIComponent(String(pitch)),
      'top=' + encodeURIComponent(String(top)),
    ]
    this.src = '/static/model-yaw.html?' + q.join('&')
  },
  methods: {
    onMessage(e) {
      const raw = (e && e.detail && e.detail.data) || []
      const list = Array.isArray(raw) ? raw : [raw]
      for (const item of list) {
        let d = item
        if (typeof item === 'string') {
          try { d = JSON.parse(item) } catch (err) { continue }
        }
        if (!d || !d.type) continue
        if (d.type === 'model-cancel') {
          this.goBack()
          return
        }
        if (d.type === 'model-snapshot-ready' && d.dataUrl) {
          try {
            uni.setStorageSync('model3d_result', {
              productId: this.product.id,
              productName: this.product.name,
              modelUrl: this.product.modelUrl,
              yaw: Number(d.yaw) || 0,
              pitch: Number(d.pitch) || 0,
              dataUrl: d.dataUrl,
              at: Date.now(),
            })
          } catch (err) {
            uni.showToast({ title: '截图结果过大，无法回传', icon: 'none' })
            return
          }
          uni.showToast({ title: '已截取 3D 朝向图', icon: 'none' })
          setTimeout(() => this.goBack(), 400)
          return
        }
        if (d.type === 'model-snapshot-error') {
          uni.showToast({ title: (d.error || '截图失败') + '，未截图前不能发送', icon: 'none' })
        }
      }
    },
    goBack() {
      uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/home/home' }) })
    },
  },
}
</script>

<style scoped>
.page {
  width: 100%;
  height: 100vh;
  background: #f8fafc;
}
.state {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}
.state-t {
  font-size: 14px;
  color: #64748b;
}
.state-btn {
  padding: 10px 24px;
  border-radius: 999px;
  background: #3b82f6;
}
.state-btn-t {
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
}
</style>
