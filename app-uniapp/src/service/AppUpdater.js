/**
 * App 远程更新（wgt 优先）
 * - 安装成功后尽量冷启动（Alarm 自拉起 + quit）；restart() 在华为自定义基座上经常是空操作
 * - 已装成功的版本不再反复强制弹窗；拦自启时提示从桌面打开
 * - 通道与打包脚本对齐为 internal
 */
import { store } from './SyncStateStore'
import { APP_VERSION } from '../common/Constants'

const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000
const SILENT_THROTTLE_MS = 30 * 60 * 1000
const KEY_LAST_CHECK = 'app_update_last_check'
const KEY_SKIPPED_WGT = 'app_update_skipped_wgt'
const KEY_DOWNLOADED = 'app_update_downloaded_path'
const KEY_INSTALLED_WGT = 'app_update_installed_wgt'
const KEY_PENDING_RELAUNCH = 'app_update_pending_relaunch'
const UPDATE_CHANNEL = 'internal'

function clientVersionCode() {
  try {
    // #ifdef APP-PLUS
    const info = plus.runtime.versionCode
    if (info) return Number(info)
    // #endif
  } catch (e) {}
  return 100
}

function clientWgtVersion() {
  try {
    // #ifdef APP-PLUS
    const wv = plus.runtime.wgtVersion || plus.runtime.version
    if (wv) return String(wv)
    // #endif
  } catch (e) {}
  return String(clientVersionCode())
}

function probeRuntimeWgtVersion() {
  return new Promise((resolve) => {
    const fallback = clientWgtVersion()
    try {
      // #ifdef APP-PLUS
      if (typeof plus !== 'undefined' && plus.runtime && typeof plus.runtime.getProperty === 'function') {
        plus.runtime.getProperty(plus.runtime.appid, (inf) => {
          const v = inf && (inf.version || inf.versionCode)
          resolve(v ? String(v) : fallback)
        })
        return
      }
      // #endif
    } catch (e) {}
    resolve(fallback)
  })
}

function sameWgt(a, b) {
  return String(a || '') !== '' && String(a) === String(b || '')
}

function infoWgtKey(info) {
  return String((info && (info.wgtVersion || info.versionCode)) || '')
}

function baseUrl() {
  return store.getServerUrl() || ''
}

function request(path, query = []) {
  return new Promise((resolve, reject) => {
    const server = baseUrl()
    if (!server) {
      reject(new Error('未配置服务器'))
      return
    }
    let url = server + path
    const q = query.filter(Boolean)
    if (q.length) url += '?' + q.join('&')
    uni.request({
      url,
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        const root = res.data
        if (!root || (root.success !== true && root.success !== 'true')) {
          reject(new Error((root && root.error) || `HTTP ${res.statusCode}`))
          return
        }
        resolve(root.data)
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '网络错误')),
    })
  })
}

function showRelaunchHint() {
  uni.showModal({
    title: '更新已安装',
    content: '已安装，请点桌面图标打开',
    showCancel: false,
    confirmText: '知道了',
  })
}

function androidRelaunchThenQuit() {
  // #ifdef APP-PLUS
  try {
    const main = plus.android.runtimeMainActivity()
    const Intent = plus.android.importClass('android.content.Intent')
    const PendingIntent = plus.android.importClass('android.app.PendingIntent')
    const AlarmManager = plus.android.importClass('android.app.AlarmManager')
    const pkg = main.getPackageName()
    const launch = main.getPackageManager().getLaunchIntentForPackage(pkg)
    if (launch) {
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
      const piFlags = PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
      const pi = PendingIntent.getActivity(main, 1, launch, piFlags)
      const am = main.getSystemService('alarm')
      am.set(AlarmManager.RTC_WAKEUP, Date.now() + 900, pi)
    }
  } catch (e) {
    console.warn('[AppUpdater] android relaunch', e && e.message)
  }
  try {
    plus.runtime.restart()
  } catch (e) {}
  setTimeout(() => {
    try {
      plus.runtime.quit()
    } catch (e) {}
  }, 400)
  // 若进程仍在（restart/quit 空操作），提示从桌面打开，避免再弹强制更新
  setTimeout(() => {
    try {
      showRelaunchHint()
    } catch (e) {}
  }, 2200)
  // #endif
}

export async function checkAppUpdate({ silent = true, force = false } = {}) {
  try {
    const last = Number(uni.getStorageSync(KEY_LAST_CHECK) || 0)
    if (!force) {
      const throttle = silent ? SILENT_THROTTLE_MS : CHECK_THROTTLE_MS
      if (Date.now() - last < throttle) {
        return { hasUpdate: false, reason: 'throttled' }
      }
    }

    const runtimeVer = await probeRuntimeWgtVersion()
    const installed = String(uni.getStorageSync(KEY_INSTALLED_WGT) || '')
    if (installed && sameWgt(runtimeVer, installed)) {
      uni.removeStorageSync(KEY_PENDING_RELAUNCH)
    }

    const data = await request('/api/app/update', [
      'platform=android',
      'versionCode=' + clientVersionCode(),
      'wgtVersion=' + encodeURIComponent(runtimeVer),
      'channel=' + UPDATE_CHANNEL,
    ])
    uni.setStorageSync(KEY_LAST_CHECK, Date.now())
    if (!data || !data.hasUpdate || !data.url) {
      if (!silent) {
        uni.showToast({ title: '已是最新版本 ' + APP_VERSION, icon: 'none' })
      }
      return data || { hasUpdate: false }
    }

    const incoming = infoWgtKey(data)
    if (incoming && (sameWgt(incoming, installed) || sameWgt(incoming, runtimeVer))) {
      if (uni.getStorageSync(KEY_PENDING_RELAUNCH)) {
        if (!silent) showRelaunchHint()
      }
      return { hasUpdate: true, alreadyInstalled: true, ...data }
    }

    const skipped = String(uni.getStorageSync(KEY_SKIPPED_WGT) || '')
    if (!data.force && data.type === 'wgt' && skipped && skipped === incoming) {
      return { hasUpdate: true, skipped: true, ...data }
    }
    await promptAndUpdate(data)
    return data
  } catch (e) {
    console.warn('[AppUpdater] check failed', e && e.message)
    if (!silent) {
      uni.showToast({ title: '检查更新失败: ' + (e.message || ''), icon: 'none' })
    }
    return { hasUpdate: false, error: e.message }
  }
}

function promptAndUpdate(info) {
  return new Promise((resolve) => {
    const isApk = info.type === 'apk'
    const title = info.force ? '发现重要更新' : isApk ? '发现新安装包' : '发现热更新'
    const content = `${info.versionName || ''} (code ${info.versionCode})\n${info.note || ''}`.trim()
    uni.showModal({
      title,
      content: content || '是否立即更新？',
      confirmText: '立即更新',
      cancelText: info.force ? '退出' : '稍后',
      success: async (res) => {
        if (!res.confirm) {
          if (info.force) {
            try {
              // #ifdef APP-PLUS
              plus.runtime.quit()
              // #endif
            } catch (e) {}
          } else if (info.type === 'wgt') {
            uni.setStorageSync(KEY_SKIPPED_WGT, infoWgtKey(info))
          }
          resolve(false)
          return
        }
        try {
          if (isApk) {
            await downloadAndInstallApk(info)
          } else {
            await downloadAndInstallWgt(info)
          }
          resolve(true)
        } catch (e) {
          uni.showToast({ title: '更新失败: ' + (e.message || e), icon: 'none' })
          resolve(false)
        }
      },
      fail: () => resolve(false),
    })
  })
}

function absoluteUrl(u) {
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  const s = baseUrl()
  return (s.replace(/\/$/, '') + '/' + String(u).replace(/^\//, ''))
}

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode === 200) resolve(res.tempFilePath)
        else reject(new Error('下载失败 HTTP ' + res.statusCode))
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '下载失败')),
    })
  })
}

async function downloadAndInstallWgt(info) {
  // #ifndef APP-PLUS
  throw new Error('热更新仅支持 App 端')
  // #endif
  // #ifdef APP-PLUS
  const url = absoluteUrl(info.url)
  if (!url) throw new Error('更新包地址为空')
  uni.showLoading({ title: '下载热更新包...', mask: true })
  try {
    const path = await downloadFile(url)
    uni.setStorageSync(KEY_DOWNLOADED, path)
    uni.hideLoading()
    uni.showLoading({ title: '安装中...', mask: true })
    await new Promise((resolve, reject) => {
      plus.runtime.install(
        path,
        { force: true },
        () => {
          uni.hideLoading()
          const ver = infoWgtKey(info)
          if (ver) uni.setStorageSync(KEY_INSTALLED_WGT, ver)
          uni.setStorageSync(KEY_PENDING_RELAUNCH, '1')
          uni.showToast({ title: '更新完成，即将重启', icon: 'none' })
          setTimeout(() => androidRelaunchThenQuit(), 1800)
          resolve()
        },
        (e) => {
          uni.hideLoading()
          reject(new Error((e && e.message) || 'wgt 安装失败'))
        }
      )
    })
  } catch (e) {
    uni.hideLoading()
    throw e
  }
  // #endif
}

async function downloadAndInstallApk(info) {
  // #ifdef APP-PLUS
  const url = absoluteUrl(info.url)
  if (!url) throw new Error('安装包地址为空')
  uni.showLoading({ title: '下载安装包...', mask: true })
  try {
    const path = await downloadFile(url)
    uni.hideLoading()
    plus.runtime.install(path, { force: false }, () => {
      uni.showToast({ title: '已拉起安装', icon: 'none' })
    }, (e) => {
      uni.showToast({ title: '请在系统页确认安装', icon: 'none' })
      console.warn('[AppUpdater] apk install', e)
    })
  } catch (e) {
    uni.hideLoading()
    throw e
  }
  // #endif
  // #ifndef APP-PLUS
  throw new Error('整包更新仅支持 App 端')
  // #endif
}

export function currentAppVersionLabel() {
  return `${APP_VERSION} (${clientVersionCode()})`
}

export default {
  checkAppUpdate,
  currentAppVersionLabel,
}
