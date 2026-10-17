<script>
import { store } from './service/SyncStateStore'
import { runSync, isSyncRunning } from './service/SyncEngine'
import { localMediaIndex } from './service/LocalMediaIndex'
import { checkAppUpdate } from './service/AppUpdater'
import { setNativeInfer } from './service/LocalModelRuntime'
import { createAndroidLocalInfer } from './service/AndroidLocalInfer'

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
    // #ifndef H5
    bootstrapLocalInfer()
    localMediaIndex.initAsync()
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
