<template>
  <view class="page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />
    <view class="wrap">
      <view class="brand">
        <view class="logo">M</view>
        <text class="brand-en">MATERIAL LIBRARY</text>
        <text class="title">连接至素材工作流</text>
        <text class="sub">集中管理你的高保真创意与视觉素材</text>
      </view>

      <view class="form-card">
        <text class="field-label">账号 / 用户名</text>
        <view class="field-row">
          <input class="input" v-model="username" placeholder="请输入用户名" placeholder-class="ph" />
        </view>
        <text class="field-label">登录密码</text>
        <view class="field-row">
          <input class="input" password v-model="password" placeholder="请输入密码" placeholder-class="ph" />
        </view>

        <button class="btn" :disabled="loading" @click="doLogin">
          {{ loading ? '登录中…' : '立即登录 →' }}
        </button>
        <text v-if="errMsg" class="err">{{ errMsg }}</text>
      </view>

      <text class="footer-ver">AlbumSync · Material Viewer · v1.0</text>
    </view>
  </view>
</template>

<script>
import { login, sessionValid } from '../../service/ViewerApi'
import { store } from '../../service/SyncStateStore'
import { pushClient } from '../../service/PushClient'

export default {
  data() {
    return {
      statusBarHeight: 20,
      username: '',
      password: '',
      loading: false,
      errMsg: '',
      tip: '',
    }
  },
  onLoad(query) {
    if (sessionValid()) {
      uni.switchTab({ url: '/pages/home/home' })
      return
    }

    this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
    this.username = store.getUsername()
    if (query && query.tip) {
      this.tip = decodeURIComponent(query.tip)
      this.errMsg = this.tip
    }
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
        pushClient.start()
        uni.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => {
          uni.switchTab({ url: '/pages/home/home' })
        }, 400)
      } catch (e) {
        this.errMsg = e.message || '登录失败，请检查账号与密码'
      } finally {
        this.loading = false
      }
    },
  },
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f8fafc;
  display: flex;
  align-items: center;
}
.wrap {
  width: 100%;
  padding: 48rpx 40rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 36rpx;
}
.logo {
  width: 112rpx;
  height: 112rpx;
  border-radius: 28rpx;
  background: linear-gradient(145deg, #2563eb, #3b82f6 55%, #60a5fa);
  color: #fff;
  font-size: 52rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 16rpx 40rpx rgba(37, 99, 235, 0.35);
  margin-bottom: 20rpx;
}
.brand-en {
  font-size: 20rpx;
  letter-spacing: 4rpx;
  color: #64748b;
  font-weight: 600;
  margin-bottom: 12rpx;
}
.title {
  font-size: 40rpx;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -1rpx;
}
.sub {
  font-size: 24rpx;
  color: #64748b;
  margin-top: 8rpx;
}
.form-card {
  width: 100%;
  background: #fff;
  border-radius: 28rpx;
  padding: 28rpx 28rpx 32rpx;
  border: 1rpx solid #e2e8f0;
  box-shadow: 0 8rpx 28rpx rgba(15, 23, 42, 0.04);
}
.field-label {
  font-size: 22rpx;
  color: #64748b;
  font-weight: 600;
  margin-bottom: 10rpx;
}
.field-row {
  margin-bottom: 22rpx;
}
.input {
  width: 100%;
  height: 88rpx;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 20rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  box-sizing: border-box;
  color: #0f172a;
}
.ph {
  color: #94a3b8;
}
.btn {
  width: 100%;
  height: 96rpx;
  border-radius: 48rpx;
  background: #2563eb;
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 96rpx;
  border: none;
  margin-top: 8rpx;
  box-shadow: 0 10rpx 24rpx rgba(37, 99, 235, 0.28);
}
.btn[disabled] {
  opacity: 0.55;
}
.err {
  display: block;
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 14rpx;
  background: #fef2f2;
  color: #dc2626;
  font-size: 24rpx;
  line-height: 1.5;
}
.footer-ver {
  margin-top: 40rpx;
  font-size: 20rpx;
  color: #94a3b8;
}
</style>
