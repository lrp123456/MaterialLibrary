<script>
import { store } from './service/SyncStateStore'
import { runSync, isSyncRunning } from './service/SyncEngine'
import { localMediaIndex } from './service/LocalMediaIndex'
import { checkAppUpdate } from './service/AppUpdater'
import { setNativeInfer } from './service/LocalModelRuntime'
import { createAndroidLocalInfer } from './service/AndroidLocalInfer'
import { ensureServerUrl } from './service/ServerResolve'
import { pushClient } from './service/PushClient'
import { prefetch } from './service/Prefetch'

/** 注入端侧 NCNN。标准 HBuilder 调试基座不含原生插件，此时静默走 YOLO/涂抹。 */
function bootstrapLocalInfer() {
  try {
    const impl = createAndroidLocalInfer()
    if (impl && typeof impl.segment === 'function') {
      setNativeInfer(impl)
      console.log('[LocalInfer] Android bridge attached')
      return
    }
  } catch (e) {
    console.warn('[LocalInfer] Android bridge failed', e && e.message)
  }
  console.warn('[LocalInfer] 当前基座无 NCNN。请制作含 uni-local-infer 的自定义调试基座，或打 APK。点选将回退 YOLO/涂抹。')
}

let autoSyncArmed = false

/** 打开即同步：延迟 + 防重入，避免调试基座启动阶段被原生扫描卡住 */
async function maybeAutoSync(tag) {
  try {
    if (isSyncRunning()) return
    if (!store.getServerUrl()) return
    if (!store.isAutoSyncEnabled()) return
    if (!store.isPhotoPermissionGranted()) return
    console.log('[AlbumSync] auto sync', tag)
    await runSync(false)
  } catch (e) {
    console.warn('[AlbumSync] auto sync failed', tag, e && (e.message || e))
  }
}

export default {
  onLaunch() {
    console.log('[AlbumSync] App Launch')
    // 首屏关键路径：立刻并发探活，首个列表请求就不必等探活超时
    ensureServerUrl().catch(() => {})
    // 推送长连接：已登录则立刻连上（未登录时会在登录页再触发一次）
    pushClient.start().catch(() => {})
    // 分层预取：订阅「素材入库」推送 + 冷启动预热（都推迟，别跟首屏抢资源）
    prefetch.start()
    prefetch.scheduleLaunchWarm()
    // #ifndef H5
    bootstrapLocalInfer()
    // 相册索引较重，推迟一点启动，避免与首屏渲染抢资源
    setTimeout(() => {
      localMediaIndex.initAsync()
    }, 1500)
    setTimeout(() => {
      checkAppUpdate({ silent: true }).catch(() => {})
    }, 3000)
    setTimeout(() => {
      autoSyncArmed = true
      maybeAutoSync('launch')
    }, 2500)
    // #endif
  },
  onShow() {
    // #ifndef H5
    if (!autoSyncArmed) return
    checkAppUpdate({ silent: true }).catch(() => {})
    const s = store.getLastSync()
    if (s.result === 'success' && Date.now() - s.time < 30 * 60 * 1000) return
    setTimeout(() => {
      maybeAutoSync('show')
    }, 1200)
    // #endif
  },
  onHide() {},
}
</script>

<style>
/* #ifdef H5 */
html,
body,
uni-app,
uni-page,
uni-page-body,
#app {
  width: 100% !important;
  max-width: none !important;
  min-height: 100%;
  margin: 0 !important;
  background: #f8fafc;
}
/* #endif */

page {
  background-color: #f8fafc;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Helvetica Neue', 'Plus Jakarta Sans', sans-serif;
  color: #0f172a;
  -webkit-font-smoothing: antialiased;
}

view, scroll-view, text, button, input, textarea {
  box-sizing: border-box;
}
</style>
