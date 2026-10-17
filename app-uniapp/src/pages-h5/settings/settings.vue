<template>
  <view class="h5-page shell">
    <view class="topbar">
      <view class="h5-btn ghost" @click="goBack">← 返回</view>
      <text class="title">设置</text>
    </view>

    <view class="card h5-card">
      <text class="sec">服务器</text>
      <text class="h5-label">服务端地址（回退链：127.0.0.1 → 192.168.1.59 → 公网）</text>
      <input class="h5-input" v-model="serverUrl" placeholder="http://host:port" />
      <text class="tip">当前生效：{{ activeUrl || '探测中…' }} · 候选 {{ candidatesText }}</text>
      <view class="actions">
        <view class="h5-btn ghost" @click="resetServer">恢复默认</view>
        <view class="h5-btn ghost" @click="reprobe">重新探测</view>
        <view class="h5-btn primary" @click="saveServer">保存</view>
      </view>

      <text class="sec">账号</text>
      <view class="kv"><text class="k">用户名</text><text class="v">{{ username || '—' }}</text></view>
      <view class="kv"><text class="k">角色</text><text class="v">{{ role || 'viewer' }}</text></view>

      <text class="sec">本地缓存</text>
      <text class="tip">清除 Web 端预览缓存与列表缓存，不会退出登录。</text>
      <view class="actions">
        <view class="h5-btn ghost" @click="clearCache">清本地缓存</view>
        <view class="h5-btn ghost" @click="doLogout">退出登录</view>
      </view>
    </view>
  </view>
</template>

<script>
import { store } from '../../service/SyncStateStore'
import { viewerCache, logout } from '../../service/ViewerApi'
import { clearMediaObjectUrls } from '../../service/WebDownload'
import { DEFAULT_SERVER_URL, SERVER_URL_CANDIDATES } from '../../common/Constants'
import { ensureServerUrl, currentServerUrl } from '../../service/ServerResolve'
import { H5_CSS } from '../h5-theme'

export default {
  data() {
    return {
      serverUrl: '',
      username: '',
      role: '',
      activeUrl: '',
    }
  },
  computed: {
    candidatesText() {
      return SERVER_URL_CANDIDATES.join(' / ')
    },
  },
  async onLoad() {
    this.serverUrl = store.getServerUrl()
    this.username = store.getUsername()
    this.role = store.getRole()
    this.activeUrl = currentServerUrl()
    await ensureServerUrl()
    this.activeUrl = currentServerUrl()
  },
  created() {
    // #ifdef H5
    const style = document.createElement('style')
    style.textContent = H5_CSS
    document.head.appendChild(style)
    // #endif
  },
  methods: {
    goBack() {
      uni.navigateBack()
    },
    resetServer() {
      this.serverUrl = SERVER_URL_CANDIDATES[0]
    },
    async reprobe() {
      uni.showLoading({ title: '探测服务端…' })
      try {
        this.activeUrl = await ensureServerUrl({ force: true })
        this.serverUrl = this.activeUrl
        uni.showToast({ title: '已连接 ' + this.activeUrl, icon: 'none' })
      } finally {
        uni.hideLoading()
      }
    },
    async saveServer() {
      const url = String(this.serverUrl || '').trim().replace(/\/+$/, '')
      if (!url) {
        uni.showToast({ title: '地址不能为空', icon: 'none' })
        return
      }
      store.setServerUrl(url)
      this.serverUrl = store.getServerUrl()
      this.activeUrl = await ensureServerUrl({ force: true })
      uni.showToast({ title: '已保存 ' + this.activeUrl, icon: 'success' })
    },
    clearCache() {
      try {
        viewerCache.clearAll()
      } catch (e) {}
      clearMediaObjectUrls()
      uni.showToast({ title: '缓存已清除', icon: 'success' })
    },
    async doLogout() {
      await logout()
      uni.reLaunch({ url: '/pages-h5/login/login' })
    },
  },
}
</script>

<style scoped>
.shell {
  max-width: 640px;
  margin: 0 auto;
  padding: 24px;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.title {
  font-size: 20px;
  font-weight: 650;
}
.card {
  padding: 22px;
}
.sec {
  display: block;
  margin: 18px 0 10px;
  font-size: 12px;
  font-weight: 650;
  color: #64748b;
  letter-spacing: 0.04em;
}
.sec:first-child {
  margin-top: 0;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.kv {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 14px;
  border-bottom: 1px solid #f1f5f9;
}
.k {
  color: #64748b;
}
.tip {
  display: block;
  font-size: 13px;
  color: #64748b;
  margin-bottom: 4px;
}
</style>
