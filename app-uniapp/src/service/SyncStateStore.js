/**
 * 状态存储（自 SyncStateStore.ets 迁移）
 * 使用 uni storage 持久化；device_id 首次生成。
 * 含 AlbumSync 同步状态 + MaterialViewer 会话字段。
 */
import {
  PREF_STORE_NAME, KEY_DEVICE_ID, KEY_SERVER_URL, KEY_SERVER_TOKEN,
  KEY_AUTO_SYNC_ENABLED, KEY_LAST_SYNC_TIME, KEY_LAST_SYNC_RESULT,
  KEY_LAST_SYNC_COUNT, KEY_LAST_SYNC_COST, KEY_PENDING_COUNT,
  KEY_FALLBACK_DIR, KEY_WINDOW_DAYS, KEY_PHOTO_PERM,
  KEY_VIEWER_TOKEN, KEY_USERNAME, KEY_ROLE,
  DEFAULT_WINDOW_DAYS, DEFAULT_SERVER_URL, APP_VERSION,
  RESULT_SUCCESS, RESULT_FAILED, RESULT_PENDING_UPLOAD,
  RESULT_UNAUTHORIZED, RESULT_NONE,
} from '../common/Constants'

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/x/g, () =>
    ((Math.random() * 16) | 0).toString(16)
  )
}

const storage = uni.getStorageSync.bind(uni)

function get(key, def) {
  try {
    const v = storage(key)
    return v === '' || v === undefined || v === null ? def : v
  } catch {
    return def
  }
}

function set(key, value) {
  try {
    uni.setStorageSync(key, value)
  } catch (e) {
    console.error('[SyncStateStore]', key, e)
  }
}

export const store = {
  getDeviceId() {
    let id = String(get(KEY_DEVICE_ID, '') || '').trim()
    if (id) return id

    // 1. 尝试在 App-Plus 环境下获取 Android 原生 Settings.Secure.ANDROID_ID
    // #ifdef APP-PLUS
    try {
      if (typeof plus !== 'undefined' && plus.os && plus.os.name === 'Android') {
        const Settings = plus.android.importClass('android.provider.Settings')
        const mainActivity = plus.android.runtimeMainActivity()
        if (mainActivity && Settings && Settings.Secure) {
          const androidId = Settings.Secure.getString(mainActivity.getContentResolver(), 'android_id')
          if (androidId && androidId.length >= 8 && androidId !== '9774d56d682e549c') {
            id = `and_${androidId}`
            set(KEY_DEVICE_ID, id)
            return id
          }
        }
      }
    } catch (e) {
      console.warn('[SyncStateStore] read android_id error', e)
    }

    // 2. 尝试使用 plus.device.uuid
    try {
      if (typeof plus !== 'undefined' && plus.device && plus.device.uuid) {
        const devUuid = String(plus.device.uuid).trim()
        if (devUuid && devUuid.length >= 8) {
          id = `dev_${devUuid.replace(/[^a-zA-Z0-9_-]/g, '')}`
          set(KEY_DEVICE_ID, id)
          return id
        }
      }
    } catch (e) {}
    // #endif

    // 3. 尝试使用 uni.getSystemInfoSync().deviceId
    try {
      const sys = uni.getSystemInfoSync()
      if (sys && sys.deviceId && String(sys.deviceId).trim().length >= 8) {
        id = `sys_${String(sys.deviceId).trim()}`
        set(KEY_DEVICE_ID, id)
        return id
      }
    } catch (e) {}

    // 4. 兜底随机 UUID
    id = uuid()
    set(KEY_DEVICE_ID, id)
    return id
  },

  getServerUrl() {
    let url = String(get(KEY_SERVER_URL, '') || '').replace(/\/+$/, '')
    if (!url) {
      url = DEFAULT_SERVER_URL
      set(KEY_SERVER_URL, url)
    }
    return url
  },
  setServerUrl(url) {
    set(KEY_SERVER_URL, String(url || '').trim().replace(/\/+$/, ''))
  },

  /** 快照上传用 Bearer Token（AlbumSync） */
  getServerToken() {
    return String(get(KEY_SERVER_TOKEN, '') || '')
  },
  setServerToken(token) {
    set(KEY_SERVER_TOKEN, String(token || '').trim())
  },

  /** 素材库会话 Token（MaterialViewer / ViewerApi） */
  getToken() {
    return String(get(KEY_VIEWER_TOKEN, '') || '')
  },
  setToken(token) {
    set(KEY_VIEWER_TOKEN, String(token || ''))
  },

  getUsername() {
    return String(get(KEY_USERNAME, '') || '')
  },
  setUsername(name) {
    set(KEY_USERNAME, String(name || ''))
  },

  getRole() {
    return String(get(KEY_ROLE, '') || '')
  },
  setRole(role) {
    set(KEY_ROLE, String(role || ''))
  },

  /** 清除登录态（保留 username 方便下次重新登录时预填） */
  clearSession() {
    set(KEY_VIEWER_TOKEN, '')
    set(KEY_ROLE, '')
  },

  isAutoSyncEnabled() {
    const v = get(KEY_AUTO_SYNC_ENABLED, true)
    return v === true || v === 'true'
  },
  setAutoSyncEnabled(enabled) {
    set(KEY_AUTO_SYNC_ENABLED, !!enabled)
  },

  /** 仅在 Wi-Fi 网络下同步原图/视频（防止消耗蜂窝流量） */
  isWifiOnlyEnabled() {
    const v = get('sync_wifi_only', true)
    return v === true || v === 'true'
  },
  setWifiOnlyEnabled(enabled) {
    set('sync_wifi_only', !!enabled)
  },

  /** 实时媒体上传队列状态 */
  _queueListeners: [],
  _queueStats: {
    isUploading: false,
    total: 0,
    current: 0,
    currentFileName: '',
    progressPercent: 0,
    successCount: 0,
    failCount: 0
  },
  getMediaQueueStatus() {
    return { ...this._queueStats }
  },
  updateMediaQueueStatus(stats) {
    this._queueStats = { ...this._queueStats, ...stats }
    for (const fn of this._queueListeners) {
      try { fn(this._queueStats) } catch (_) {}
    }
  },
  onMediaQueueChange(fn) {
    if (typeof fn === 'function') this._queueListeners.push(fn)
    return () => {
      this._queueListeners = this._queueListeners.filter(f => f !== fn)
    }
  },

  getWindowDays() {
    const n = Number(get(KEY_WINDOW_DAYS, DEFAULT_WINDOW_DAYS))
    return Number.isNaN(n) ? DEFAULT_WINDOW_DAYS : n
  },
  setWindowDays(days) {
    set(KEY_WINDOW_DAYS, Number(days))
  },

  getFallbackDir() {
    return String(get(KEY_FALLBACK_DIR, '') || '')
  },
  setFallbackDir(uri) {
    set(KEY_FALLBACK_DIR, String(uri || ''))
  },

  getPendingCount() {
    const n = Number(get(KEY_PENDING_COUNT, 0))
    return Number.isNaN(n) ? 0 : n
  },
  setPendingCount(c) {
    set(KEY_PENDING_COUNT, Number(c) || 0)
  },

  isPhotoPermissionGranted() {
    return get(KEY_PHOTO_PERM, false) === true || get(KEY_PHOTO_PERM, 'true') === 'true'
  },
  setPhotoPermissionGranted(ok) {
    set(KEY_PHOTO_PERM, !!ok)
  },

  getAppVersion() {
    return APP_VERSION
  },

  recordSync(result, count, costMs) {
    set(KEY_LAST_SYNC_RESULT, result)
    set(KEY_LAST_SYNC_TIME, Date.now())
    set(KEY_LAST_SYNC_COUNT, count)
    set(KEY_LAST_SYNC_COST, costMs)
  },

  getLastSync() {
    return {
      result: String(get(KEY_LAST_SYNC_RESULT, RESULT_NONE) || RESULT_NONE),
      time: Number(get(KEY_LAST_SYNC_TIME, 0)) || 0,
      count: Number(get(KEY_LAST_SYNC_COUNT, 0)) || 0,
      cost: Number(get(KEY_LAST_SYNC_COST, 0)) || 0,
      pending: store.getPendingCount(),
    }
  },

  resultText(result) {
    if (result === RESULT_SUCCESS) return '同步成功'
    if (result === RESULT_FAILED) return '同步失败'
    if (result === RESULT_PENDING_UPLOAD) return '已存待重传'
    if (result === RESULT_UNAUTHORIZED) return '未授权'
    return '尚未同步'
  },

  resultColor(result) {
    if (result === RESULT_SUCCESS) return '#059669'
    if (result === RESULT_FAILED) return '#DC2626'
    if (result === RESULT_PENDING_UPLOAD || result === RESULT_UNAUTHORIZED)
      return '#D97706'
    return '#94A3B8'
  },

  formatTime(ts) {
    if (!ts || ts <= 0) return '暂无记录'
    const d = new Date(ts)
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  listPending() {
    try {
      const raw = storage('pending_queue')
      const arr = Array.isArray(raw) ? raw : []
      return arr
    } catch {
      return []
    }
  },

  savePending(json) {
    try {
      const arr = store.listPending()
      arr.push({ id: String(Date.now()), json, savedAt: Date.now() })
      set('pending_queue', arr)
      store.setPendingCount(arr.length)
      return true
    } catch (e) {
      console.error('[SyncStateStore] savePending', e)
      return false
    }
  },

  removePending(id) {
    try {
      const arr = store.listPending().filter((x) => x.id !== id)
      set('pending_queue', arr)
      store.setPendingCount(arr.length)
    } catch (e) {
      console.error('[SyncStateStore] removePending', e)
    }
  },

  /** 复制文本到剪贴板（device_id 等） */
  copyText(text, tip = '已复制') {
    uni.setClipboardData({
      data: String(text || ''),
      success: () => uni.showToast({ title: tip, icon: 'none' }),
      fail: () => uni.showToast({ title: '复制失败', icon: 'none' }),
    })
  },

  /** 登记已从 App 保存到系统相册的媒体，防止相册扫描重复入库 */
  recordExportedMedia(fileName, hash = '') {
    try {
      const records = get('exported_media_records', []) || []
      const fn = (fileName || '').trim().toLowerCase()
      if (!records.some((r) => (r.name || '').toLowerCase() === fn || (hash && r.hash === hash))) {
        records.push({ name: fileName, hash, time: Date.now() })
        set('exported_media_records', records.slice(-500))
      }
    } catch (e) {
      console.warn('[SyncStateStore] recordExportedMedia failed', e)
    }
  },

  /** 检查文件是否为本端导出的媒体（三重防重复判定） */
  isExportedMedia(filePath, fileName) {
    try {
      const fn = (fileName || '').trim().toLowerCase()
      const fp = (filePath || '').trim().toLowerCase()
      // 1. 文件名特征与目录特征
      if (fn.startsWith('ml_saved_') || fp.includes('materiallibrary') || fp.includes('material_library')) {
        return true
      }
      // 2. 本地已导出白名单账本
      const records = get('exported_media_records', []) || []
      return records.some((r) => (r.name || '').toLowerCase() === fn)
    } catch {
      return false
    }
  },
}

void PREF_STORE_NAME
