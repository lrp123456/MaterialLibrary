<template>
  <view class="page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />

    <!-- 顶栏 -->
    <view class="topbar">
      <view class="topbar-side">
        <view v-if="canGoBack" class="back" @click="goBack" hover-class="back-hover"><text class="back-t">‹</text></view>
      </view>
      <text class="topbar-title">我的</text>
      <view class="topbar-side right">
        <view class="logout-link" @click="logout" hover-class="logout-link-hover"><text class="logout-t">退出</text></view>
      </view>
    </view>

    <!-- 入库横条（WS asset.ingested 推送） -->
    <view class="ingest-bar" :class="{ show: ingest.show }" :style="{ top: (statusBarHeight + 54) + 'px' }">
      <image v-if="ingest.show && ingest.thumb" :src="ingest.thumb" class="ingest-thumb" mode="aspectFill" />
      <view class="ingest-meta">
        <text class="ingest-title">{{ ingest.title }}</text>
        <text class="ingest-sub">{{ ingest.sub }}</text>
      </view>
      <view class="ingest-go" @click="openIngested" hover-class="ingest-go-hover"><text class="ingest-go-t">查看</text></view>
      <view class="ingest-close" @click="dismissIngest" hover-class="ingest-close-hover"><text class="ingest-close-t">✕</text></view>
    </view>

    <scroll-view scroll-y class="scroll" :style="{ height: 'calc(100vh - ' + (statusBarHeight + 48) + 'px)' }">
      <!-- 账号 -->
      <view class="profile rise d1">
        <view class="avatar">{{ (username || 'U').slice(0, 1).toUpperCase() }}</view>
        <view class="profile-meta">
          <text class="profile-name">{{ username || '未登录' }}</text>
          <view class="profile-tags">
            <text class="role">{{ roleText }}</text>
            <view class="conn" :class="{ ok: pushConnected }">
              <view class="conn-dot" />
              <text class="conn-t">{{ pushConnected ? '实时在线' : '离线缓存' }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 同步优先 -->
      <view class="sync-card rise d2">
        <view class="sync-head">
          <view class="sync-head-l">
            <text class="sync-title">相册同步</text>
            <text class="sync-sub">{{ lastSyncText || '还没同步过，先扫一次相册' }}</text>
          </view>
          <view class="sync-date" v-if="windowDays !== 0">
            <text class="sync-date-t">{{ windowDays }} 天窗口</text>
          </view>
        </view>

        <view v-if="pendingText" class="sync-alert warn">
          <text class="sync-alert-t">{{ pendingText }}</text>
          <text class="sync-alert-go" @click="doSync">重试</text>
        </view>
        <view v-if="!photoPerm" class="sync-alert perm">
          <text class="sync-alert-t">相册权限未开启，同步不会读取任何照片</text>
          <text class="sync-alert-go" @click="goPermission">去开启</text>
        </view>

        <view class="sync-btn" :class="{ busy: syncing }" @click="doSync" hover-class="sync-btn-hover">
          <text class="sync-btn-t">{{ syncing ? '同步中…' : '立即同步相册' }}</text>
          <text class="sync-btn-s">{{ photoPerm ? '新增照片自动入库' : '需先授权相册' }}</text>
        </view>

        <view v-if="queueStats.isUploading || queueStats.total > 0" class="queue">
          <view class="queue-head">
            <text class="queue-title">{{ queueStats.isUploading ? '正在直传 NAS…' : 'NAS 传输已就绪' }}</text>
            <text class="queue-count">{{ queueStats.current }}/{{ queueStats.total }}</text>
          </view>
          <text v-if="queueStats.currentFileName" class="queue-name">{{ queueStats.currentFileName }}</text>
          <progress :percent="queueStats.progressPercent" stroke-width="4" activeColor="#3B82F6" backgroundColor="#E2E8F0" class="queue-bar" />
        </view>

        <view class="switch-list">
          <view class="switch-row">
            <view class="switch-meta">
              <text class="switch-t">打开应用时自动同步</text>
              <text class="switch-s">只扫描近 3 天新图，库里已有素材不受影响</text>
            </view>
            <switch :checked="autoSync" color="#3B82F6" @change="onAuto" />
          </view>
          <view class="switch-row">
            <view class="switch-meta">
              <text class="switch-t">仅 Wi-Fi 同步原图 / 视频</text>
              <text class="switch-s">移动网络下只同步缩略与元数据</text>
            </view>
            <switch :checked="wifiOnly" color="#3B82F6" @change="onWifiOnly" />
          </view>
        </view>

        <view class="chips">
          <view
            v-for="d in dayOptions"
            :key="d"
            class="chip"
            :class="{ active: windowDays === d }"
            @click="setWindow(d)"
          >{{ d === 0 ? '关闭' : d + ' 天' }}</view>
        </view>
      </view>

      <!-- 快捷入口 -->
      <view class="quick-grid rise d3">
        <view class="quick" @click="openTrash" hover-class="quick-hover">
          <view class="quick-ico trash">🗑</view>
          <view class="quick-meta">
            <text class="quick-t">回收站</text>
            <text class="quick-s">{{ trashCount ? trashCount + ' 项待处理' : '暂无待处理' }}</text>
          </view>
          <text v-if="trashCount" class="quick-badge">{{ trashCount > 99 ? '99+' : trashCount }}</text>
        </view>

        <view class="quick" @click="goPermission" hover-class="quick-hover">
          <view class="quick-ico photo">📷</view>
          <view class="quick-meta">
            <text class="quick-t">相册权限</text>
            <text class="quick-s" :class="{ warn: !photoPerm }">{{ photoPerm ? '已授权' : '未授权' }}</text>
          </view>
          <text class="quick-chev">›</text>
        </view>

        <view class="quick" @click="clearFrontendCache" hover-class="quick-hover">
          <view class="quick-ico cache">✦</view>
          <view class="quick-meta">
            <text class="quick-t">清理缓存</text>
            <text class="quick-s">{{ cacheStats.queryCount }} 查询 · {{ cacheStats.localIndexedCount }} 本地</text>
          </view>
          <text class="quick-chev">›</text>
        </view>

        <view class="quick" @click="manualCheckUpdate" hover-class="quick-hover">
          <view class="quick-ico update">↓</view>
          <view class="quick-meta">
            <text class="quick-t">检查更新</text>
            <text class="quick-s">{{ checkingUpdate ? '检查中…' : appVersionLabel }}</text>
          </view>
          <text class="quick-chev">›</text>
        </view>
      </view>

      <!-- 高级设置 -->
      <view class="advanced rise d4">
        <view class="advanced-head" @click="advancedOpen = !advancedOpen">
          <view class="advanced-head-l">
            <text class="advanced-title">高级设置</text>
            <text class="advanced-sub">{{ serverHostLabel }} · {{ batteryWhitelistText }}</text>
          </view>
          <text class="chev" :class="{ open: advancedOpen }">›</text>
        </view>

        <view v-if="advancedOpen" class="advanced-body">
          <!-- 服务器 -->
          <view class="adv-block">
            <text class="adv-title">服务器地址</text>
            <text class="adv-hint">手机与电脑不在同一网络时，填电脑局域网地址（形如 http://192.168.1.59:30001）。留空自动探测。</text>
            <input class="input" v-model="serverUrlInput" placeholder="http://192.168.1.59:30001" />
            <view class="adv-row">
              <text class="adv-label">当前连接</text>
              <text class="adv-value" :class="{ ok: serverStatus === 'ok', bad: serverStatus === 'fail' }">{{ serverStatusText }}</text>
            </view>
            <view class="btn-row">
              <view class="btn-line half" :class="{ disabled: serverTesting }" @click="testServer" hover-class="btn-line-hover">
                <text class="btn-line-t">{{ serverTesting ? '测试中…' : '测试连接' }}</text>
              </view>
              <view class="btn-primary half" @click="saveServerUrl" hover-class="btn-primary-hover">
                <text class="btn-primary-t">保存地址</text>
              </view>
            </view>
            <text v-if="serverCandidatesText" class="adv-hint mt">候选：{{ serverCandidatesText }}</text>
          </view>

          <!-- Token -->
          <view class="adv-block">
            <text class="adv-title">Bearer Token</text>
            <text class="adv-hint">快照上传可单独使用，与浏览会话相互独立。留空免鉴权。</text>
            <input class="input" v-model="serverToken" password placeholder="Bearer Token（可选）" @blur="saveToken" />
          </view>

          <!-- 保活 -->
          <view class="adv-block">
            <view class="adv-row">
              <view class="adv-row-l">
                <text class="adv-label">后台保活</text>
                <text class="adv-hint">息屏后系统可能掐断长连接，AI 进度会停住。加入电池白名单可避免。</text>
              </view>
              <text class="adv-value" :class="{ ok: batteryWhitelisted }">{{ batteryWhitelistText }}</text>
            </view>
            <view class="btn-row">
              <view class="btn-line half" @click="openBatteryWhitelist" hover-class="btn-line-hover">
                <text class="btn-line-t">去系统设置</text>
              </view>
            </view>
          </view>

          <!-- 兜底落盘 -->
          <view class="adv-block">
            <text class="adv-title">兜底落盘目录</text>
            <text class="adv-hint">上传失败时，快照 JSON 额外落盘到此目录。可指向网盘自动同步目录，断网也能同步。</text>
            <view v-if="fallbackDir" class="mono-box"><text class="mono">{{ fallbackDir }}</text></view>
            <view class="btn-row">
              <view class="btn-line half" @click="pickFallbackDir" hover-class="btn-line-hover"><text class="btn-line-t">选择目录</text></view>
              <view v-if="fallbackDir" class="btn-danger half" @click="clearFallbackDir" hover-class="btn-line-hover"><text class="btn-danger-t">清除</text></view>
            </view>
          </view>

          <!-- 缓存 -->
          <view class="adv-block">
            <text class="adv-title">前端缓存</text>
            <view class="adv-row">
              <text class="adv-label">数据缓存（SWR）</text>
              <text class="adv-value">{{ cacheStats.queryCount }} 组 · {{ cacheStats.detailCount }} 详情</text>
            </view>
            <view class="adv-row">
              <text class="adv-label">相册直连索引</text>
              <text class="adv-value">{{ cacheStats.localIndexedCount }} 项</text>
            </view>
            <view class="btn-row">
              <view class="btn-line half" @click="clearFrontendCache" hover-class="btn-line-hover"><text class="btn-line-t">清空本地缓存</text></view>
            </view>
          </view>

          <!-- 设备 -->
          <view class="adv-block">
            <text class="adv-title">设备标识</text>
            <text class="adv-hint">首次启动生成的 UUID，作为快照 device_id，服务器据此区分设备。</text>
            <view class="device-row">
              <text class="device-id">{{ deviceId }}</text>
              <text class="copy" @click="copyDeviceId">复制</text>
            </view>
          </view>

          <!-- 更新与建议 -->
          <view class="adv-block last">
            <view class="adv-row">
              <view class="adv-row-l">
                <text class="adv-label">当前版本</text>
                <text class="adv-hint">支持 wgt 资源热更新；原生权限变更会提示安装完整包。</text>
              </view>
              <text class="adv-value">{{ appVersionLabel }}</text>
            </view>
            <view class="btn-row">
              <view class="btn-line half" :class="{ disabled: checkingUpdate }" @click="manualCheckUpdate" hover-class="btn-line-hover">
                <text class="btn-line-t">{{ checkingUpdate ? '检查中…' : '检查更新' }}</text>
              </view>
            </view>
            <text class="adv-hint mt">定时同步：用系统「快捷指令 / 自动化」定时拉起本应用；开启自动同步后，拉起即静默同步一次。</text>
          </view>
        </view>
      </view>

      <text class="footnote">素材只在本应用内删除才会从库里消失</text>
    </scroll-view>

    <!-- 全局后台 AI 任务状态浮窗 -->
    <ai-task-pill />
  </view>
</template>

<script>
import { store } from '../../service/SyncStateStore'
import { logout as apiLogout, fetchTrashAssets, gridUrl } from '../../service/ViewerApi'
import { runSync } from '../../service/SyncEngine'
import { viewerCache } from '../../service/ViewerCache'
import { localMediaIndex } from '../../service/LocalMediaIndex'
import { WINDOW_DAY_OPTIONS, RESULT_SUCCESS, RESULT_PENDING_UPLOAD } from '../../common/Constants'
import { checkAppUpdate, currentAppVersionLabel } from '../../service/AppUpdater'
import { currentServerUrl, buildCandidates, setManualServerUrl } from '../../service/ServerResolve'
import { pushClient } from '../../service/PushClient'
import { isIgnoringBatteryOptimizations, requestIgnoreBatteryOptimizations } from '../../service/KeepAlive'
import { switchTabTo } from '../../common/nav'
import AiTaskPill from '../../components/AiTaskPill.vue'

const INGEST_AUTO_HIDE_MS = 6000

export default {
  components: { AiTaskPill },
  data() {
    return {
      canGoBack: false,
      statusBarHeight: 20,
      username: '',
      role: '',
      serverToken: '',
      serverUrlInput: '',
      serverStatus: 'unknown',
      serverTesting: false,
      batteryWhitelisted: false,
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
      checkingUpdate: false,
      appVersionLabel: '',
      advancedOpen: false,
      pushConnected: false,
      trashCount: 0,
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
      ingest: {
        show: false,
        count: 0,
        thumb: '',
        title: '',
        sub: '',
        at: 0,
      },
    }
  },
  computed: {
    roleText() {
      if (this.role === 'admin') return '系统管理员'
      if (this.role === 'viewer') return '普通查看者'
      return this.role ? `角色：${this.role}` : '已登录'
    },
    serverStatusText() {
      if (this.serverStatus === 'ok') return '已连接'
      if (this.serverStatus === 'fail') return '连接失败'
      return '未检测'
    },
    serverHostLabel() {
      const raw = String(this.serverUrlInput || '').replace(/^https?:\/\//, '')
      if (!raw) return '自动探测'
      return raw.length > 26 ? raw.slice(0, 24) + '…' : raw
    },
    serverCandidatesText() {
      return buildCandidates().map((u) => u.replace(/^https?:\/\//, '')).join(' / ')
    },
    batteryWhitelistText() {
      return this.batteryWhitelisted ? '已加入' : '未加入'
    },
  },
  onLoad() {
    this.refresh()
    this.refreshTrashCount()
    this.unsubQueue = store.onMediaQueueChange((stats) => {
      this.queueStats = { ...stats }
    })
    this.unsubPush = pushClient.subscribe((evt) => {
      if (!evt || evt.event !== 'asset.ingested') return
      this.onAssetIngested(evt.payload)
    })
    this.unsubState = pushClient.onState((v) => {
      this.pushConnected = !!v
    })
  },
  onUnload() {
    if (this.unsubQueue) this.unsubQueue()
    if (this.unsubPush) this.unsubPush()
    if (this.unsubState) this.unsubState()
    if (this._ingestTimer) clearTimeout(this._ingestTimer)
  },
  onShow() {
    this.refresh()
    this.refreshBatteryWhitelist()
    this.refreshTrashCount()
  },
  methods: {
    // ─────────── 入库横条 ───────────
    onAssetIngested(payload) {
      const p = payload || {}
      const kind = p.kind === 'video' ? '视频' : p.kind === 'audio' ? '音频' : '图片'
      this.ingest.count = this.ingest.show ? this.ingest.count + 1 : 1
      this.ingest.thumb = p.fid ? gridUrl(p.fid) : ''
      this.ingest.title = this.ingest.count > 1 ? `${this.ingest.count} 项新素材已入库` : '新素材已入库'
      this.ingest.sub = `${kind} · 点开可直接查看`
      this.ingest.at = Date.now()
      this.ingest.show = true
      if (this._ingestTimer) clearTimeout(this._ingestTimer)
      this._ingestTimer = setTimeout(() => {
        this.ingest.show = false
      }, INGEST_AUTO_HIDE_MS)
    },
    dismissIngest() {
      this.ingest.show = false
      if (this._ingestTimer) {
        clearTimeout(this._ingestTimer)
        this._ingestTimer = null
      }
    },
    openIngested() {
      this.dismissIngest()
      switchTabTo('/pages/browse/browse')
    },

    // ─────────── 回收站 ───────────
    async refreshTrashCount() {
      try {
        const data = await fetchTrashAssets({ page: 1, pageSize: 1 })
        this.trashCount = Number((data && data.total) || 0)
      } catch (e) {
        // 未授权或离线时静默
      }
    },
    openTrash() {
      try { uni.setStorageSync('browse_tab', 'trash') } catch (e) {}
      switchTabTo('/pages/browse/browse')
    },

    // ─────────── 同步 ───────────
    refreshBatteryWhitelist() {
      this.batteryWhitelisted = isIgnoringBatteryOptimizations() === true
    },
    openBatteryWhitelist() {
      const ok = requestIgnoreBatteryOptimizations()
      if (!ok) {
        uni.showToast({ title: '当前环境不支持，请到系统设置手动放行', icon: 'none' })
        return
      }
      setTimeout(() => this.refreshBatteryWhitelist(), 1500)
    },
    setWindow(d) {
      if (this.windowDays === d) return
      this.windowDays = d
      this.saveConfig()
    },
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
    testServer() {
      if (this.serverTesting) return
      const url = String(this.serverUrlInput || '').trim().replace(/\/+$/, '')
      if (!url) {
        uni.showToast({ title: '请先填写地址', icon: 'none' })
        return
      }
      this.serverTesting = true
      uni.request({
        url: url + '/api/health',
        method: 'GET',
        timeout: 3000,
        success: (res) => {
          this.serverTesting = false
          if ((res.statusCode || 0) < 500) {
            this.serverStatus = 'ok'
            uni.showToast({ title: '连接成功', icon: 'success' })
          } else {
            this.serverStatus = 'fail'
            uni.showToast({ title: `服务返回 ${res.statusCode}`, icon: 'none' })
          }
        },
        fail: () => {
          this.serverTesting = false
          this.serverStatus = 'fail'
          uni.showToast({ title: '无法连接', icon: 'none' })
        },
      })
    },
    async saveServerUrl() {
      const url = String(this.serverUrlInput || '').trim().replace(/\/+$/, '')
      store.setManualServerUrl(url)
      const picked = await setManualServerUrl(url)
      this.serverUrlInput = store.getManualServerUrl() || picked
      this.serverStatus = picked && picked === url ? 'ok' : 'fail'
      pushClient.stop()
      pushClient.start()
      uni.showToast({
        title: this.serverStatus === 'ok' ? '已保存并连接' : `已保存，当前使用 ${picked || '未知'}`,
        icon: 'none',
      })
    },
    refresh() {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      this.canGoBack = pages.length > 1
      try {
        this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
      } catch (e) {
        this.statusBarHeight = 20
      }
      this.appVersionLabel = currentAppVersionLabel()
      this.username = store.getUsername()
      this.role = store.getRole()
      this.serverToken = store.getServerToken()
      this.serverUrlInput = store.getManualServerUrl() || currentServerUrl()
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
    saveToken() {
      store.setServerToken(String(this.serverToken || '').trim())
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
            pushClient.stop()
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
      if (this.syncing) return
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
        this.refreshTrashCount()
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
  height: 100vh;
  overflow: hidden;
  background: #f8fafc;
}
.status-bar {
  background: #f8fafc;
}

/* ── 顶栏 ─────────────────────────── */
.topbar {
  height: 48px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f8fafc;
}
.topbar-side {
  width: 64px;
  display: flex;
  align-items: center;
}
.topbar-side.right {
  justify-content: flex-end;
}
.back {
  width: 34px;
  height: 34px;
  border-radius: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  border: 1px solid #e7ecf3;
}
.back-hover {
  background: #f1f5f9;
}
.back-t {
  font-size: 20px;
  color: #0f172a;
  line-height: 1;
}
.topbar-title {
  font-size: 17px;
  font-weight: 700;
  color: #0f172a;
}
.logout-link {
  padding: 5px 10px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid #e7ecf3;
}
.logout-link-hover {
  background: #fef2f2;
}
.logout-t {
  font-size: 12px;
  color: #64748b;
  font-weight: 600;
}

/* ── 入库横条 ─────────────────────── */
.ingest-bar {
  position: fixed;
  left: 12px;
  right: 12px;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid #bfdbfe;
  box-shadow: 0 10px 28px rgba(37, 99, 235, 0.16);
  transform: translateY(-16px) scale(0.98);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.34s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s ease;
}
.ingest-bar.show {
  transform: translateY(0) scale(1);
  opacity: 1;
  pointer-events: auto;
}
.ingest-thumb {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #eff6ff;
  flex-shrink: 0;
}
.ingest-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ingest-title {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}
.ingest-sub {
  font-size: 11px;
  color: #64748b;
}
.ingest-go {
  padding: 7px 13px;
  border-radius: 999px;
  background: #3b82f6;
}
.ingest-go-hover {
  opacity: 0.82;
}
.ingest-go-t {
  font-size: 12px;
  font-weight: 700;
  color: #ffffff;
}
.ingest-close {
  width: 26px;
  height: 26px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ingest-close-hover {
  background: #f1f5f9;
}
.ingest-close-t {
  font-size: 12px;
  color: #94a3b8;
}

.scroll {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 14px 40px;
}

/* ── 进场 ─────────────────────────── */
.rise {
  animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.d1 { animation-delay: 40ms; }
.d2 { animation-delay: 90ms; }
.d3 { animation-delay: 140ms; }
.d4 { animation-delay: 190ms; }
@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── 账号 ─────────────────────────── */
.profile {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 14px;
  margin-bottom: 12px;
  background: #ffffff;
  border: 1px solid #e7ecf3;
  border-radius: 18px;
}
.avatar {
  width: 48px;
  height: 48px;
  border-radius: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
  font-weight: 700;
  color: #ffffff;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  box-shadow: 0 8px 18px rgba(59, 130, 246, 0.28);
}
.profile-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.profile-name {
  font-size: 17px;
  font-weight: 700;
  color: #0f172a;
}
.profile-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.role {
  font-size: 10px;
  font-weight: 700;
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #dbeafe;
  padding: 2px 8px;
  border-radius: 999px;
}
.conn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f1f5f9;
}
.conn-dot {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: #94a3b8;
}
.conn.ok {
  background: #ecfdf5;
}
.conn.ok .conn-dot {
  background: #10b981;
}
.conn-t {
  font-size: 10px;
  font-weight: 600;
  color: #64748b;
}
.conn.ok .conn-t {
  color: #047857;
}

/* ── 同步卡 ───────────────────────── */
.sync-card {
  padding: 16px 14px;
  margin-bottom: 12px;
  background: #ffffff;
  border: 1px solid #e7ecf3;
  border-radius: 18px;
}
.sync-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.sync-head-l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sync-title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}
.sync-sub {
  font-size: 11px;
  color: #64748b;
  line-height: 1.45;
}
.sync-date {
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid #e7ecf3;
}
.sync-date-t {
  font-size: 10px;
  font-weight: 600;
  color: #94a3b8;
}
.sync-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 12px;
}
.sync-alert.warn {
  background: #fffbeb;
  border: 1px solid #fde68a;
}
.sync-alert.perm {
  background: #fef2f2;
  border: 1px solid #fecaca;
}
.sync-alert-t {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: #92400e;
}
.sync-alert.perm .sync-alert-t {
  color: #b91c1c;
}
.sync-alert-go {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #2563eb;
}
.sync-btn {
  position: relative;
  margin-top: 12px;
  padding: 11px 16px;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  box-shadow: 0 10px 22px rgba(59, 130, 246, 0.26);
  transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
.sync-btn-hover {
  transform: scale(0.985);
}
.sync-btn.busy {
  opacity: 0.72;
}
.sync-btn-t {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
}
.sync-btn-s {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.78);
}
.queue {
  margin-top: 12px;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e7ecf3;
  border-radius: 12px;
}
.queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.queue-title {
  font-size: 12px;
  font-weight: 600;
  color: #1e293b;
}
.queue-count {
  font-size: 11px;
  font-weight: 700;
  color: #3b82f6;
}
.queue-name {
  display: block;
  margin: 4px 0 7px;
  font-size: 10px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.queue-bar {
  border-radius: 4px;
}
.switch-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.switch-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.switch-t {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.switch-s {
  font-size: 10px;
  color: #94a3b8;
  line-height: 1.4;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 12px;
}
.chip {
  padding: 5px 12px;
  border-radius: 999px;
  background: #f1f5f9;
  font-size: 11px;
  color: #64748b;
  border: 1px solid transparent;
  transition: background 0.2s ease, color 0.2s ease;
}
.chip.active {
  background: #eff6ff;
  color: #2563eb;
  font-weight: 700;
  border-color: #bfdbfe;
}

/* ── 快捷入口 ─────────────────────── */
.quick-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}
.quick {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 11px;
  background: #ffffff;
  border: 1px solid #e7ecf3;
  border-radius: 16px;
  transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s ease;
}
.quick-hover {
  transform: scale(0.975);
  background: #f8fafc;
}
.quick-ico {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}
.quick-ico.trash { background: #eff6ff; }
.quick-ico.photo { background: #f0fdf4; }
.quick-ico.cache { background: #fefce8; color: #ca8a04; font-size: 15px; }
.quick-ico.update { background: #f5f3ff; color: #7c3aed; font-weight: 700; }
.quick-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.quick-t {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.quick-s {
  font-size: 10px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.quick-s.warn {
  color: #d97706;
  font-weight: 600;
}
.quick-badge {
  position: absolute;
  top: 7px;
  right: 8px;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 9px;
  background: #ef4444;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}
.quick-chev {
  font-size: 16px;
  color: #cbd5e1;
  flex-shrink: 0;
}

/* ── 高级设置 ─────────────────────── */
.advanced {
  background: #ffffff;
  border: 1px solid #e7ecf3;
  border-radius: 18px;
  overflow: hidden;
}
.advanced-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
}
.advanced-head-l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.advanced-title {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}
.advanced-sub {
  font-size: 10px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chev {
  font-size: 16px;
  color: #cbd5e1;
  transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}
.chev.open {
  transform: rotate(90deg);
  color: #3b82f6;
}
.advanced-body {
  border-top: 1px solid #f1f5f9;
  animation: fadeIn 0.3s ease both;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.adv-block {
  padding: 14px;
  border-bottom: 1px solid #f1f5f9;
}
.adv-block.last {
  border-bottom: 0;
}
.adv-title {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 5px;
}
.adv-hint {
  display: block;
  font-size: 10px;
  color: #94a3b8;
  line-height: 1.5;
  margin-bottom: 9px;
}
.adv-hint.mt {
  margin-top: 8px;
  margin-bottom: 0;
}
.adv-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
}
.adv-row-l {
  flex: 1;
  min-width: 0;
}
.adv-row-l .adv-hint {
  margin-bottom: 0;
}
.adv-label {
  font-size: 12px;
  color: #334155;
  font-weight: 500;
}
.adv-value {
  flex-shrink: 0;
  font-size: 11px;
  color: #64748b;
  font-weight: 600;
  text-align: right;
}
.adv-value.ok {
  color: #059669;
}
.adv-value.bad {
  color: #dc2626;
}
.input {
  width: 100%;
  box-sizing: border-box;
  height: 40px;
  padding: 0 12px;
  margin-bottom: 6px;
  background: #f8fafc;
  border: 1px solid #e7ecf3;
  border-radius: 11px;
  font-size: 12px;
  color: #0f172a;
}
.btn-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.btn-line,
.btn-primary,
.btn-danger {
  flex: 1;
  height: 36px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-line {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}
.btn-line-hover {
  opacity: 0.78;
}
.btn-line-t {
  font-size: 12px;
  font-weight: 700;
  color: #2563eb;
}
.btn-primary {
  background: #3b82f6;
}
.btn-primary-hover {
  opacity: 0.86;
}
.btn-primary-t {
  font-size: 12px;
  font-weight: 700;
  color: #ffffff;
}
.btn-danger {
  background: #fef2f2;
  border: 1px solid #fecaca;
}
.btn-danger-t {
  font-size: 12px;
  font-weight: 700;
  color: #dc2626;
}
.disabled {
  opacity: 0.55;
  pointer-events: none;
}
.mono-box {
  padding: 8px 10px;
  margin-bottom: 4px;
  background: #f8fafc;
  border: 1px solid #e7ecf3;
  border-radius: 10px;
}
.mono {
  font-size: 10px;
  color: #64748b;
  word-break: break-all;
}
.device-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e7ecf3;
  border-radius: 10px;
}
.device-id {
  flex: 1;
  min-width: 0;
  font-size: 10px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.copy {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #2563eb;
}
.footnote {
  display: block;
  text-align: center;
  margin: 18px 0 0;
  font-size: 10px;
  color: #cbd5e1;
}
</style>
