<template>
  <view class="page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />
    <view class="nav">
      <text class="back" @click="goBack">‹</text>
      <text class="nav-title">相册权限说明</text>
      <view class="spacer" />
    </view>

    <scroll-view scroll-y class="scroll">
      <view class="card status-card" :class="{ ok: granted }">
        <text class="status-dot" />
        <view class="status-body">
          <text class="status-title">{{ granted ? '已授权' : '尚未授权读取相册' }}</text>
          <text class="status-sub">{{ granted ? '可以扫描近 N 天元数据并同步' : '点击下方按钮申请「读取图片和视频」' }}</text>
        </view>
      </view>

      <view class="card">
        <text class="section">为什么需要这个权限</text>
        <text class="hint">
          仅读取相册资源的文件名、大小、修改时间等元数据，生成快照上传到内网服务器。
          <b>不会读取、上传照片或视频内容</b>，也不计算文件 MD5。
        </text>
        <view class="steps">
          <view class="step"><text class="no">1</text><text class="txt">系统弹窗中选择「允许管理所有照片」</text></view>
          <view class="step"><text class="no">2</text><text class="txt">若曾拒绝且不再弹框，请到系统设置 → 应用 → 权限中手动开启</text></view>
          <view class="step"><text class="no">3</text><text class="txt">返回本页后状态会自动刷新</text></view>
        </view>
      </view>

      <button class="btn-primary" :disabled="requesting" @click="requestPermission">
        {{ requesting ? '申请中…' : granted ? '重新检查权限' : '申请相册权限' }}
      </button>
      <button class="btn-ghost" @click="jumpAppSettings">打开系统应用设置</button>
    </scroll-view>
  </view>
</template>

<script>
import { store } from '../../service/SyncStateStore'

export default {
  data() {
    return {
      statusBarHeight: 20,
      granted: false,
      requesting: false,
    }
  },
  onLoad() {
    this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
    this.refreshStatus()
  },
  onShow() {
    this.refreshStatus()
  },
  methods: {
    refreshStatus() {
      // #ifdef APP-PLUS
      this.checkAppPermission()
      // #endif
      // #ifndef APP-PLUS
      this.granted = store.isPhotoPermissionGranted()
      // #endif
    },
    checkAppPermission() {
      // #ifdef APP-PLUS
      try {
        if (typeof plus === 'undefined' || !plus.android) {
          this.granted = store.isPhotoPermissionGranted()
          return
        }
        const MainActivity = plus.android.runtimeMainActivity()
        const perm =
          parseFloat(String(plus.os.version)) >= 33
            ? 'android.permission.READ_MEDIA_IMAGES'
            : 'android.permission.READ_EXTERNAL_STORAGE'
        const code = Number(plus.android.invoke(MainActivity, 'checkSelfPermission', perm))
        const granted = code === 0
        this.granted = granted
        store.setPhotoPermissionGranted(granted)
      } catch (e) {
        console.warn('[PermissionGuide] check', e)
        this.granted = store.isPhotoPermissionGranted()
      }
      // #endif
    },
    requestPermission() {
      if (this.requesting) return
      this.requesting = true
      // #ifdef APP-PLUS
      this.requestAppPermission()
      // #endif
      // #ifndef APP-PLUS
      // H5/演示：模拟授权（真机 App 请用系统弹窗）
      store.setPhotoPermissionGranted(true)
      this.granted = true
      this.requesting = false
      uni.showToast({ title: '演示模式已标记授权', icon: 'none' })
      // #endif
    },
    requestAppPermission() {
      // #ifdef APP-PLUS
      const perms =
        parseFloat(String(plus.os.version)) >= 33
          ? ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO']
          : ['android.permission.READ_EXTERNAL_STORAGE']
      plus.android.requestPermissions(
        perms,
        (e) => {
          this.requesting = false
          const granted = e && e.granted && e.granted.length > 0
          this.granted = granted
          store.setPhotoPermissionGranted(granted)
          uni.showToast({
            title: granted ? '授权成功' : '未授权，同步无法工作',
            icon: granted ? 'success' : 'none',
          })
        },
        (e) => {
          this.requesting = false
          const deniedAlways = e && e.deniedAlways && e.deniedAlways.length > 0
          if (deniedAlways) this.jumpAppSettings()
          else uni.showToast({ title: '权限申请失败', icon: 'none' })
        }
      )
      // #endif
    },
    jumpAppSettings() {
      // #ifdef APP-PLUS
      if (typeof plus !== 'undefined' && plus.android) {
        const Intent = plus.android.importClass('android.content.Intent')
        const Settings = plus.android.importClass('android.provider.Settings')
        const Uri = plus.android.importClass('android.net.Uri')
        const MainActivity = plus.android.runtimeMainActivity()
        const intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        intent.setData(Uri.fromParts('package', MainActivity.getPackageName(), null))
        MainActivity.startActivity(intent)
        return
      }
      // #endif
      uni.showToast({ title: '请到系统设置中开启相册权限', icon: 'none' })
    },
    goBack() {
      uni.navigateBack()
    },
  },
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f8fafc;
}
.nav {
  height: 92rpx;
  display: flex;
  align-items: center;
  padding: 0 20rpx;
  background: #f8fafc;
}
.back {
  width: 72rpx;
  height: 72rpx;
  border-radius: 36rpx;
  background: #fff;
  border: 1rpx solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  color: #0f172a;
}
.nav-title {
  flex: 1;
  text-align: center;
  font-size: 30rpx;
  font-weight: 700;
  color: #0f172a;
}
.spacer {
  width: 72rpx;
}
.scroll {
  padding: 12rpx 24rpx 48rpx;
}
.card {
  background: #fff;
  border-radius: 28rpx;
  padding: 28rpx;
  margin-bottom: 20rpx;
  border: 1rpx solid #e2e8f0;
}
.status-card {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: #fef2f2;
  border-color: #fecaca;
}
.status-card.ok {
  background: #ecfdf5;
  border-color: #a7f3d0;
}
.status-dot {
  width: 20rpx;
  height: 20rpx;
  border-radius: 10rpx;
  background: #dc2626;
  flex-shrink: 0;
}
.status-card.ok .status-dot {
  background: #059669;
}
.status-body {
  display: flex;
  flex-direction: column;
  flex: 1;
}
.status-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #0f172a;
}
.status-sub {
  font-size: 22rpx;
  color: #64748b;
  margin-top: 4rpx;
}
.section {
  font-size: 28rpx;
  font-weight: 700;
  color: #0f172a;
  display: block;
  margin-bottom: 12rpx;
}
.hint {
  font-size: 24rpx;
  color: #64748b;
  line-height: 1.6;
  display: block;
}
.steps {
  margin-top: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}
.step {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
}
.no {
  width: 36rpx;
  height: 36rpx;
  border-radius: 18rpx;
  background: #eff6ff;
  color: #2563eb;
  font-size: 20rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.txt {
  font-size: 24rpx;
  color: #0f172a;
  line-height: 1.5;
  flex: 1;
}
.btn-primary {
  width: 100%;
  height: 92rpx;
  line-height: 92rpx;
  border-radius: 46rpx;
  background: #2563eb;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  border: none;
  margin-top: 8rpx;
}
.btn-ghost {
  width: 100%;
  height: 80rpx;
  line-height: 80rpx;
  border-radius: 40rpx;
  background: #fff;
  color: #64748b;
  font-size: 24rpx;
  border: 1rpx solid #e2e8f0;
  margin-top: 16rpx;
}
</style>
