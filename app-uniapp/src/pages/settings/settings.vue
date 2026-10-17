<template>
  <view class="page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />
    <view class="nav">
      <text v-if="canGoBack" class="back" @click="goBack">‹</text>
      <view v-else class="nav-placeholder" />
      <text class="nav-title">设置与个人中心</text>
      <view class="spacer" />
    </view>
    <scroll-view scroll-y class="scroll">
      <!-- 账号信息 -->
      <view class="card">
        <text class="section">当前账号</text>
        <view class="account-card">
          <view class="account-avatar">{{ (username || 'U').slice(0, 1).toUpperCase() }}</view>
          <view class="account-info">
            <text class="account-username">{{ username || '未登录' }}</text>
            <view class="account-badge">
              <text class="account-role">{{ roleText }}</text>
            </view>
          </view>
        </view>
        <button class="btn-logout" @click="logout">退出登录</button>
      </view>

      <!-- 版本与远程更新 -->
      <view class="card">
        <text class="section">版本与更新</text>
        <view class="row-between">
          <text class="label">当前版本</text>
          <text class="label">{{ appVersionLabel }}</text>
        </view>
        <text class="hint">支持 wgt 资源热更新；原生权限变更时会提示安装完整包。</text>
        <button class="btn-primary-sm" :disabled="checkingUpdate" @click="manualCheckUpdate">
          {{ checkingUpdate ? '检查中…' : '检查更新' }}
        </button>
      </view>

      <!-- 同步通道（AlbumSync 原能力） -->
      <view class="card">
        <text class="section">同步通道</text>
        <text class="hint">快照上传可单独使用 Bearer Token，与浏览会话相互独立。</text>
        <input class="input" v-model="serverToken" password placeholder="Bearer Token（可选，留空免鉴权）" />
        <view class="row-between">
          <text class="label">相册权限</text>
          <text class="perm" :class="{ ok: photoPerm }" @click="goPermission">
            {{ photoPerm ? '已授权' : '未授权 ›' }}
          </text>
        </view>
      </view>

      <!-- 智能同步 -->
      <view class="card">
        <text class="section">智能同步（辅助）</text>
        <text class="hint">
          直传至私有 NAS 素材库。相册只扫描近 3 天新图入库；库里已有素材不会因相册删除而消失，只有在本应用内删除才会移除。
        </text>
        <view class="row-between">
          <text class="label">打开应用时自动同步</text>
          <switch :checked="autoSync" color="#2563EB" @change="onAuto" />
        </view>
        <view class="row-between mt-sm">
          <text class="label">仅在 Wi-Fi 下同步原图/视频</text>
          <switch :checked="wifiOnly" color="#2563EB" @change="onWifiOnly" />
        </view>
        <view class="chips">
          <view
            v-for="d in dayOptions"
            :key="d"
            class="chip"
            :class="{ active: windowDays === d }"
            @click="windowDays = d"
          >{{ d === 0 ? '关闭' : d + ' 天' }}</view>
        </view>
        <text class="hint mt">下方天数仅作快照窗口记录；扫描范围固定近 3 天。72 小时冻结锁已停用。</text>
        <button class="btn-primary-sm" :disabled="syncing" @click="doSync">
          {{ syncing ? '同步中…' : '立即同步相册' }}
        </button>
        <view v-if="lastSyncText" class="sync-status">
          <text>{{ lastSyncText }}</text>
        </view>
        <view v-if="pendingText" class="sync-status warn">
          <text>{{ pendingText }}</text>
        </view>

        <!-- 媒体直传进度卡片 -->
        <view v-if="queueStats.isUploading || queueStats.total > 0" class="queue-card">
          <view class="row-between">
            <text class="queue-title">{{ queueStats.isUploading ? '正在直传至 NAS…' : 'NAS 传输已就绪' }}</text>
            <text class="queue-count">{{ queueStats.current }}/{{ queueStats.total }} 项</text>
          </view>
          <text v-if="queueStats.currentFileName" class="queue-filename">{{ queueStats.currentFileName }}</text>
          <progress :percent="queueStats.progressPercent" stroke-width="4" activeColor="#2563EB" backgroundColor="#E2E8F0" class="queue-bar" />
        </view>
      </view>


      <!-- 兜底落盘 -->
      <view class="card">
        <text class="section">兜底落盘目录（可选）</text>
        <text class="hint">
          上传失败时，除存入应用内待重传队列外，快照 JSON 会额外落盘到此目录。可选择网盘的自动同步监控目录，实现断网也能同步。
        </text>
        <view v-if="fallbackDir" class="mono-box">
          <text>{{ fallbackDir }}</text>
        </view>
        <view class="btn-row">
          <button class="btn-line half" @click="pickFallbackDir">选择目录</button>
          <button v-if="fallbackDir" class="btn-logout half" @click="clearFallbackDir">清除</button>
        </view>
      </view>

      <!-- 前端缓存与相册直连 -->
      <view class="card">
        <text class="section">前端缓存与直连</text>
        <text class="hint">
          SWR 双层数据缓存与手机相册快速索引，实现列表与详情 0 流量秒开，避免重复拉取网络图片。
        </text>
        <view class="row-between">
          <text class="label">数据缓存（SWR）</text>
          <text class="perm">{{ cacheStats.queryCount }} 组查询 · {{ cacheStats.detailCount }} 条详情</text>
        </view>
        <view class="row-between">
          <text class="label">相册直连索引</text>
          <text class="perm">{{ cacheStats.localIndexedCount }} 项本地照片</text>
        </view>
        <button class="btn-line" @click="clearFrontendCache">一键清空本地缓存</button>
      </view>

      <!-- 设备标识 -->
      <view class="card">
        <text class="section">设备标识</text>
        <text class="hint">首次启动本地生成的 UUID，作为快照 device_id 上传，服务器据此区分设备。</text>
        <view class="row-between">
          <text class="mono-text">{{ deviceId }}</text>
          <text class="copy" @click="copyDeviceId">复制</text>
        </view>
      </view>

      <!-- 定时说明 -->
      <view class="card">
        <text class="section">定时同步建议</text>
        <text class="hint">
          可用系统「快捷指令 / 自动化」或桌面小组件定时拉起本应用；开启上方「打开应用时自动同步」后，拉起即静默同步一次。
          鸿蒙端可配合「智慧生活」场景使用 autoSync 参数。
        </text>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { store } from '../../service/SyncStateStore'
import { logout as apiLogout } from '../../service/ViewerApi'
import { runSync } from '../../service/SyncEngine'
import { viewerCache } from '../../service/ViewerCache'
import { localMediaIndex } from '../../service/LocalMediaIndex'
import { WINDOW_DAY_OPTIONS, RESULT_SUCCESS, RESULT_PENDING_UPLOAD } from '../../common/Constants'
import { checkAppUpdate, currentAppVersionLabel } from '../../service/AppUpdater'

export default {
  data() {
    return {
      canGoBack: false,
      statusBarHeight: 20,
      username: '',
      role: '',
      serverToken: '',
      autoSync: true,
      wifiOnly: true,
      windowDays: 3,
      dayOptions: WINDOW_DAY_OPTIONS,
      lastSyncText: '',
      pendingText: '',
      deviceId: '',
      fallbackDir: '',
      photoPerm: false,
      syncing: false,
      queueStats: {
        isUploading: false,
        total: 0,
        current: 0,
        currentFileName: '',
        progressPercent: 0,
      },
      cacheStats: {
        queryCount: 0,
        detailCount: 0,
        localIndexedCount: 0,
      },
      checkingUpdate: false,
      appVersionLabel: '',
    }
  },
  computed: {
    roleText() {
      if (this.role === 'admin') return '系统管理员'
      if (this.role === 'viewer') return '普通查看者'
      return this.role ? `角色: ${this.role}` : '已登录'
    },
  },
  onLoad() {
    this.refresh()
    this.unsubQueue = store.onMediaQueueChange((stats) => {
      this.queueStats = { ...stats }
    })
  },
  onUnload() {
    if (this.unsubQueue) this.unsubQueue()
  },
  onShow() {
    this.refresh()
  },
  methods: {
    async manualCheckUpdate() {
      if (this.checkingUpdate) return
      this.checkingUpdate = true
      try {
        await checkAppUpdate({ silent: false, force: true })
        this.appVersionLabel = currentAppVersionLabel()
      } finally {
        this.checkingUpdate = false
      }
    },
    refresh() {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      this.canGoBack = pages.length > 1
      this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
      this.appVersionLabel = currentAppVersionLabel()
      this.username = store.getUsername()
      this.role = store.getRole()
      this.serverToken = store.getServerToken()
      this.autoSync = store.isAutoSyncEnabled()
      this.wifiOnly = store.isWifiOnlyEnabled()
      this.queueStats = store.getMediaQueueStatus()
      this.windowDays = store.getWindowDays()
      this.deviceId = store.getDeviceId()
      this.fallbackDir = store.getFallbackDir()
      this.photoPerm = store.isPhotoPermissionGranted()
      const s = store.getLastSync()
      this.lastSyncText =
        s.result && s.result !== 'none'
          ? store.resultText(s.result) +
            ' · ' +
            store.formatTime(s.time) +
            (s.count > 0 ? ` · ${s.count} 项` : '') +
            (s.cost > 0 ? ` · ${(s.cost / 1000).toFixed(1)}s` : '')
          : ''
      this.pendingText = s.pending > 0 ? `待重传 ${s.pending} 份快照` : ''

      const vStats = viewerCache.getStats()
      const lStats = localMediaIndex.getStats()
      this.cacheStats = {
        queryCount: vStats.queryCount,
        detailCount: vStats.detailCount,
        localIndexedCount: lStats.count,
      }
    },
    clearFrontendCache() {
      uni.showModal({
        title: '清除缓存',
        content: '确定要清空本地数据缓存与相册直连索引吗？',
        success: (r) => {
          if (r.confirm) {
            viewerCache.clearAll()
            localMediaIndex.clear()
            this.refresh()
            uni.showToast({ title: '已清空缓存', icon: 'success' })
          }
        },
      })
    },
    saveConfig() {
      store.setServerToken(this.serverToken)
      store.setAutoSyncEnabled(this.autoSync)
      store.setWifiOnlyEnabled(this.wifiOnly)
      store.setWindowDays(this.windowDays)
    },
    onAuto(e) {
      this.autoSync = !!e.detail.value
      this.saveConfig()
    },
    onWifiOnly(e) {
      this.wifiOnly = !!e.detail.value
      this.saveConfig()
    },
    logout() {
      uni.showModal({
        title: '退出登录',
        content: '确定要退出当前账号吗？',
        success: async (r) => {
          if (r.confirm) {
            await apiLogout()
            uni.reLaunch({
              url: '/pages/login/login?tip=' + encodeURIComponent('已退出登录'),
            })
          }
        },
      })
    },
    async doSync() {
      this.saveConfig()
      if (!store.isPhotoPermissionGranted()) {
        uni.showModal({
          title: '需要相册权限',
          content: '同步仅读取元数据。请先在权限页开启「读取图片和视频」。',
          confirmText: '去开启',
          success: (r) => {
            if (r.confirm) this.goPermission()
          },
        })
        return
      }
      this.syncing = true
      uni.showLoading({ title: '同步中…' })
      try {
        const r = await runSync(false)
        this.refresh()
        uni.hideLoading()
        uni.showToast({
          title:
            r === RESULT_SUCCESS
              ? '同步成功'
              : r === RESULT_PENDING_UPLOAD
                ? '已存待重传'
                : store.resultText(r),
          icon: 'none',
        })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: '同步失败', icon: 'none' })
      } finally {
        this.syncing = false
      }
    },
    pickFallbackDir() {
      // #ifdef APP-PLUS
      // Android：让用户粘贴/输入已授权的目录路径（SAF 完整选择器需原生插件）
      uni.showModal({
        title: '兜底目录',
        editable: true,
        placeholderText: '输入可写目录绝对路径',
        content: this.fallbackDir || '',
        success: (r) => {
          if (r.confirm && r.content) {
            store.setFallbackDir(r.content.trim())
            this.fallbackDir = store.getFallbackDir()
            uni.showToast({ title: '兜底目录已设置', icon: 'none' })
          }
        },
      })
      // #endif
      // #ifndef APP-PLUS
      uni.showModal({
        title: 'H5 演示',
        content: '浏览器无本地目录能力。真机 App 可配置网盘监控目录作为兜底。',
        showCancel: false,
      })
      // #endif
    },
    clearFallbackDir() {
      store.setFallbackDir('')
      this.fallbackDir = ''
      uni.showToast({ title: '已清除兜底目录', icon: 'none' })
    },
    copyDeviceId() {
      store.copyText(this.deviceId, '设备 ID 已复制')
    },
    goPermission() {
      uni.navigateTo({ url: '/pages/permission/permission' })
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
.back,
.nav-placeholder {
  width: 72rpx;
  height: 72rpx;
}
.back {
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
  width: 100%;
  box-sizing: border-box;
  padding: 16rpx 24rpx 60rpx;
}
.card {
  width: 100%;
  box-sizing: border-box;
  background: #fff;
  border-radius: 28rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
  border: 1rpx solid #e2e8f0;
  box-shadow: 0 4rpx 16rpx rgba(15, 23, 42, 0.03);
}
.section {
  font-size: 28rpx;
  font-weight: 700;
  color: #0f172a;
  display: block;
  margin-bottom: 10rpx;
}
.hint {
  font-size: 22rpx;
  color: #64748b;
  line-height: 1.55;
  display: block;
  margin-bottom: 18rpx;
}
.hint.mt {
  margin-top: 12rpx;
}
.input {
  height: 84rpx;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 18rpx;
  padding: 0 22rpx;
  font-size: 26rpx;
  margin-bottom: 14rpx;
  width: 100%;
  box-sizing: border-box;
  color: #0f172a;
}
.btn-line {
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 42rpx;
  background: #eff6ff;
  color: #2563eb;
  font-size: 26rpx;
  font-weight: 600;
  margin-top: 8rpx;
  border: 1rpx solid #bfdbfe;
}
.btn-line.half {
  flex: 1;
  margin-top: 0;
}
.btn-logout {
  height: 72rpx;
  line-height: 72rpx;
  border-radius: 36rpx;
  background: #fef2f2;
  color: #dc2626;
  font-size: 24rpx;
  margin-top: 16rpx;
}
.btn-logout.half {
  flex: 1;
  margin-top: 0;
  margin-left: 12rpx;
}
.btn-row {
  display: flex;
  align-items: center;
}
.row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}
.label {
  font-size: 26rpx;
  color: #0f172a;
  font-weight: 500;
}
.perm {
  font-size: 24rpx;
  color: #d97706;
  font-weight: 600;
}
.perm.ok {
  color: #059669;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.chip {
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  background: #f1f5f9;
  font-size: 24rpx;
  color: #64748b;
  border: 1rpx solid transparent;
}
.chip.active {
  background: #2563eb;
  color: #fff;
  font-weight: 600;
  border-color: #2563eb;
}
.btn-primary-sm {
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 44rpx;
  background: #2563eb;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  margin-top: 24rpx;
  box-shadow: 0 8rpx 20rpx rgba(37, 99, 235, 0.25);
}
.btn-primary-sm[disabled] {
  opacity: 0.6;
}
.sync-status {
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #64748b;
  text-align: center;
}
.sync-status.warn {
  color: #d97706;
  font-weight: 600;
}
.mono-box {
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 14rpx;
  padding: 16rpx;
  margin-bottom: 14rpx;
}
.mono-box text {
  font-size: 20rpx;
  color: #64748b;
  word-break: break-all;
}
.mono-text {
  flex: 1;
  font-size: 20rpx;
  color: #64748b;
  margin-right: 12rpx;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.copy {
  font-size: 24rpx;
  color: #2563eb;
  font-weight: 600;
  flex-shrink: 0;
}
.mt-sm {
  margin-top: 14rpx;
}
.queue-card {
  margin-top: 20rpx;
  background: #f1f5f9;
  border-radius: 16rpx;
  padding: 20rpx;
}
.queue-title {
  font-size: 24rpx;
  font-weight: 600;
  color: #1e293b;
}
.queue-count {
  font-size: 22rpx;
  color: #2563eb;
  font-weight: 600;
}
.queue-filename {
  font-size: 20rpx;
  color: #64748b;
  margin-top: 8rpx;
  margin-bottom: 12rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.queue-bar {
  border-radius: 4rpx;
}
.account-card {
  display: flex;
  align-items: center;
  padding: 16rpx 0 24rpx;
  gap: 20rpx;
}
.account-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 44rpx;
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6rpx 16rpx rgba(37, 99, 235, 0.25);
}
.account-info {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.account-username {
  font-size: 32rpx;
  font-weight: 700;
  color: #0f172a;
}
.account-badge {
  display: inline-flex;
  align-self: flex-start;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  background: #eff6ff;
  border: 1rpx solid #bfdbfe;
}
.account-role {
  font-size: 20rpx;
  font-weight: 600;
  color: #2563eb;
}
</style>

