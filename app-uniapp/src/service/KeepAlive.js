/**
 * 后台保活（纯 JS 侧可落地部分）
 *
 * 为什么没有直接起 Android 前台服务：
 *   plus.android 反射无法启动未在 manifest 里声明的 Android Service，
 *   前台服务必须走自定义基座 / 离线打包（Kotlin 模块 + 通知渠道）。
 *   manifest 侧已补齐 FOREGROUND_SERVICE / FOREGROUND_SERVICE_DATA_SYNC /
 *   WAKE_LOCK / REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 权限，等自定义基座就绪即可启用。
 *
 * 现在能做且立刻生效的：
 *   1. 引导用户把 App 加进「电池优化白名单」——不加的话系统会在息屏后掐掉长连接。
 *   2. 长连接保活由 PushClient 的应用层心跳负责（每 25s ping，10s 无 pong 主动重连）。
 */
const PKG_ACTION_REQUEST_IGNORE = 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'

function androidClass(name) {
  try {
    if (typeof plus === 'undefined' || !plus.android) return null
    return plus.android.importClass(name)
  } catch (e) {
    return null
  }
}

/** 当前是否已在电池优化白名单里 */
export function isIgnoringBatteryOptimizations() {
  const PowerManager = androidClass('android.os.PowerManager')
  if (!PowerManager) return null
  try {
    const ctx = plus.android.runtimeMainActivity()
    const pm = ctx.getSystemService(plus.android.POWER_SERVICE)
    return !!pm.isIgnoringBatteryOptimizations(ctx.getPackageName())
  } catch (e) {
    return null
  }
}

/** 拉起系统「忽略电池优化」授权页；返回是否真的发起了 */
export function requestIgnoreBatteryOptimizations() {
  const Intent = androidClass('android.content.Intent')
  const Uri = androidClass('android.net.Uri')
  if (!Intent || !Uri) return false
  try {
    const ctx = plus.android.runtimeMainActivity()
    const intent = new Intent()
    intent.setAction(PKG_ACTION_REQUEST_IGNORE)
    intent.setData(Uri.parse('package:' + ctx.getPackageName()))
    intent.addFlags(plus.android.Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(intent)
    return true
  } catch (e) {
    console.warn('[KeepAlive] 电池优化白名单引导失败', e && e.message)
    return false
  }
}

/** 保持屏幕常亮（编辑页用，退出即释放） */
export function keepScreenOn(on = true) {
  try {
    if (typeof plus === 'undefined' || !plus.android) return false
    const WindowManager = androidClass('android.view.WindowManager$LayoutParams')
    if (!WindowManager) return false
    const ctx = plus.android.runtimeMainActivity()
    const win = ctx.getWindow()
    if (on) {
      win.addFlags(plus.android.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    } else {
      win.clearFlags(plus.android.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    return true
  } catch (e) {
    return false
  }
}

/** App 是否已在后台运行（用于决定要不要省电降频） */
export function isAppInBackground() {
  try {
    if (typeof plus === 'undefined' || !plus.android) return false
    const ActivityManager = androidClass('android.app.ActivityManager')
    if (!ActivityManager) return false
    const ctx = plus.android.runtimeMainActivity()
    const am = ctx.getSystemService(plus.android.ACTIVITY_SERVICE)
    const tasks = am.getRunningTasks(1)
    if (!tasks || !tasks.length) return false
    return tasks[0].isRunning === false
  } catch (e) {
    return false
  }
}
