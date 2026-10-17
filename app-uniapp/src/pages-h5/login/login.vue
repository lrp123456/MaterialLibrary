<template>
  <view class="h5-page login-page">
    <view class="shell">
      <view class="brand">
        <view class="logo">M</view>
        <text class="brand-en">MATERIAL LIBRARY</text>
        <text class="title">素材工作台</text>
        <text class="sub">连接素材库服务端 · 浏览 · 预览 · 下载</text>
      </view>
      <view class="card h5-card form">
        <text class="h5-label">账号 / 用户名</text>
        <input class="h5-input" v-model="username" placeholder="请输入用户名" placeholder-class="ph" />
        <text class="h5-label">登录密码</text>
        <input class="h5-input" password v-model="password" placeholder="请输入密码" placeholder-class="ph" @confirm="doLogin" />
        <button class="h5-btn primary btn" :disabled="loading" @click="doLogin">
          {{ loading ? '登录中…' : '登录' }}
        </button>
        <text v-if="errMsg" class="err">{{ errMsg }}</text>
        <text class="server">服务端 {{ serverUrl }}</text>
      </view>
      <text class="footer">AlbumSync · Material Viewer Web · v1</text>
    </view>
  </view>
</template>

<script>
import { login, sessionValid } from '../../service/ViewerApi'
import { store } from '../../service/SyncStateStore'
import { H5_CSS } from '../h5-theme'

export default {
  data() {
    return {
      username: '',
      password: '',
      loading: false,
      errMsg: '',
    }
  },
  computed: {
    serverUrl() {
      return store.getServerUrl()
    },
  },
  onLoad() {
    if (sessionValid()) {
      uni.reLaunch({ url: '/pages-h5/library/library' })
    }
    this.username = store.getUsername()
  },
  created() {
    // #ifdef H5
    const style = document.createElement('style')
    style.textContent = H5_CSS
    document.head.appendChild(style)
    // #endif
  },
  methods: {
    async doLogin() {
      this.errMsg = ''
      if (!this.username.trim() || !this.password) {
        this.errMsg = '请填写用户名与密码'
        return
      }
      this.loading = true
      try {
        await login(this.username.trim(), this.password)
        uni.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => uni.reLaunch({ url: '/pages-h5/library/library' }), 300)
      } catch (e) {
        this.errMsg = e.message || '登录失败'
      } finally {
        this.loading = false
      }
    },
  },
}
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
}
.shell {
  width: 100%;
  max-width: 420px;
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 28px;
}
.logo {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  background: linear-gradient(145deg, #2563eb, #3b82f6 55%, #60a5fa);
  color: #fff;
  font-size: 34px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12px 32px rgba(37, 99, 235, 0.3);
  margin-bottom: 14px;
}
.brand-en {
  font-size: 11px;
  letter-spacing: 0.18em;
  color: #2563eb;
  font-weight: 600;
}
.title {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 650;
}
.sub {
  margin-top: 6px;
  font-size: 13px;
  color: #64748b;
}
.form {
  width: 100%;
  padding: 24px;
}
.form .h5-label {
  margin-top: 12px;
}
.form .h5-label:first-child {
  margin-top: 0;
}
.btn {
  width: 100%;
  margin-top: 20px;
}
.err {
  display: block;
  margin-top: 12px;
  color: #dc2626;
  font-size: 13px;
  text-align: center;
}
.server {
  display: block;
  margin-top: 14px;
  font-size: 12px;
  color: #94a3b8;
  text-align: center;
  word-break: break-all;
}
.footer {
  margin-top: 24px;
  font-size: 12px;
  color: #94a3b8;
}
.ph {
  color: #94a3b8;
}
</style>
