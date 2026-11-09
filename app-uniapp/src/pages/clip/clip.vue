<template>
  <view class="clip-page" :style="themeStyle">
    <view class="clip-nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-btn" hover-class="nav-btn-hover" @click="goBack">
        <text class="nav-icon">‹</text>
      </view>
      <text class="nav-title">{{ navTitle }}</text>
      <view class="nav-btn" hover-class="nav-btn-hover" @click="reload">
        <text class="nav-icon reload">⟳</text>
      </view>
    </view>

    <view class="clip-body">
      <!-- #ifdef H5 -->
      <iframe
        v-if="url"
        :key="frameKey"
        class="clip-frame"
        :src="url"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
      <view v-else class="clip-loading">
        <view class="spinner" />
        <text class="clip-loading-t">{{ loadingText }}</text>
      </view>
      <!-- #endif -->

      <!-- #ifdef APP-PLUS -->
      <view v-if="!url" class="clip-loading">
        <view class="spinner" />
        <text class="clip-loading-t">{{ loadingText }}</text>
      </view>
      <!-- #endif -->
    </view>
  </view>
</template>

<script>
import { ensureServerUrl } from '../../service/ServerResolve'
import { store } from '../../service/SyncStateStore'
import { currentVars } from '../../common/theme'
import { consumeClipAssets, clipThemeParam } from '../../common/clip'

const NAV_HEIGHT = 48

export default {
  data() {
    return {
      statusBarHeight: 20,
      url: '',
      frameKey: 0,
      loadingText: '正在连接剪辑服务…',
      navTitle: '多轨剪辑',
      pendingAssets: [],
      subWebviewId: '',
    }
  },
  computed: {
    themeStyle() {
      return currentVars()
    },
  },
  onLoad() {
    try {
      const sys = uni.getSystemInfoSync()
      this.statusBarHeight = sys.statusBarHeight || 20
    } catch (e) {}
    this.pendingAssets = consumeClipAssets()
    if (this.pendingAssets.length === 1) {
      this.navTitle = '剪辑 · ' + this.pendingAssets[0].file_name
    } else if (this.pendingAssets.length > 1) {
      this.navTitle = '剪辑 · ' + this.pendingAssets.length + ' 个素材'
    }
    this.buildUrl()
  },
  onUnload() {
    this.closeSubWebview()
  },
  onBackPress() {
    // 交给顶部返回按钮与硬件返回统一处理：关闭内嵌编辑器再退出本页
    if (this.subWebviewId) {
      this.closeSubWebview()
      uni.navigateBack()
      return true
    }
    return false
  },
  methods: {
    async buildUrl() {
      this.loadingText = '正在连接剪辑服务…'
      let origin = ''
      try {
        origin = await ensureServerUrl()
      } catch (e) {
        origin = ''
      }
      if (!origin) {
        this.loadingText = '未找到素材服务器，请先在「我的」里检查服务地址'
        return
      }
      const token = store.getToken() || ''
      const params = []
      if (token) params.push('token=' + encodeURIComponent(token))
      params.push('theme=' + encodeURIComponent(clipThemeParam()))
      // App 内嵌环境常见自签证书/局域网 http；编辑器的安全上下文逃生口
      params.push('keep-http=1')
      for (const asset of this.pendingAssets) {
        params.push('import=' + encodeURIComponent(JSON.stringify(asset)))
      }
      const target = origin.replace(/\/+$/, '') + '/editor/projects?' + params.join('&')
      this.url = target
      this.$nextTick(() => this.attachSubWebview())
    },
    attachSubWebview() {
      // #ifdef APP-PLUS
      if (this.subWebviewId || !this.url) return
      try {
        const page = plus.webview.currentWebview()
        const id = 'mls-clip-' + Date.now()
        const sub = plus.webview.create(this.url, id, {
          top: this.statusBarHeight + NAV_HEIGHT,
          bottom: 0,
          bounce: 'none',
          popGesture: 'none',
          scalable: false,
          kernel: 'WKWebview',
        })
        page.append(sub)
        this.subWebviewId = id
      } catch (e) {
        this.loadingText = '无法打开剪辑页：' + (e && e.message ? e.message : e)
      }
      // #endif
    },
    closeSubWebview() {
      // #ifdef APP-PLUS
      if (!this.subWebviewId) return
      try {
        const sub = plus.webview.getWebviewById(this.subWebviewId)
        if (sub) sub.close('none')
      } catch (e) {}
      this.subWebviewId = ''
      // #endif
    },
    reload() {
      if (!this.url) {
        this.buildUrl()
        return
      }
      // #ifdef APP-PLUS
      if (this.subWebviewId) {
        try {
          const sub = plus.webview.getWebviewById(this.subWebviewId)
          if (sub) {
            sub.reload()
            return
          }
        } catch (e) {}
      }
      // #endif
      this.frameKey += 1
    },
    goBack() {
      this.closeSubWebview()
      uni.navigateBack()
    },
  },
}
</script>

<style>
.clip-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}
.clip-nav {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  box-sizing: content-box;
}
.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
}
.nav-btn-hover {
  background: var(--surface2);
}
.nav-icon {
  font-size: 26px;
  line-height: 1;
  color: var(--ink);
}
.nav-icon.reload {
  font-size: 20px;
  color: var(--ink2);
}
.nav-title {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.clip-body {
  position: relative;
  flex: 1;
  min-height: 0;
}
.clip-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.clip-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 0 32px;
}
.clip-loading-t {
  font-size: 13px;
  color: var(--ink2);
  text-align: center;
}
.spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  animation: clip-spin 0.9s linear infinite;
}
@keyframes clip-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
