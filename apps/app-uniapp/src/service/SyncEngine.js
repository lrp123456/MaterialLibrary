/**
 * 同步引擎（自 SyncEngine.ets 迁移）
 * 流程：权限 → 重传队列 → 扫描 → 快照 → 上传 → 记状态
 */
import {
  RESULT_SUCCESS,
  RESULT_FAILED,
  RESULT_PENDING_UPLOAD,
  RESULT_UNAUTHORIZED,
  KEY_LAST_SYNC_RESULT,
  RESULT_NONE,
} from '../common/Constants'
import { createSnapshot } from '../common/Types'
import { store } from './SyncStateStore'
import { scanAlbum } from './AlbumScanner'
import { uploadSnapshot, retryPending } from './Uploader'
import { startUploadQueue } from './MediaUploader'
import { localMediaIndex } from './LocalMediaIndex'
import { isAndroidTiramisu } from './android-permission.js'

let running = false

export function isSyncRunning() {
  return running
}

export function isPermissionGranted() {
  // #ifdef APP-PLUS
  return new Promise((resolve) => {
    try {
      if (typeof plus === 'undefined' || !plus.android) {
        resolve(store.isPhotoPermissionGranted())
        return
      }
      const MainActivity = plus.android.runtimeMainActivity()
      let sdkInt = 0
      try {
        const Build = plus.android.importClass('android.os.Build')
        if (Build && Build.VERSION && Build.VERSION.SDK_INT) {
          sdkInt = Number(Build.VERSION.SDK_INT) || 0
        }
      } catch (_) {}
      if (!sdkInt) {
        try {
          const Version = plus.android.importClass('android.os.Build$VERSION')
          if (Version && Version.SDK_INT) sdkInt = Number(Version.SDK_INT) || 0
        } catch (_) {}
      }
      const perm = isAndroidTiramisu(plus.os && plus.os.version, sdkInt)
        ? 'android.permission.READ_MEDIA_IMAGES'
        : 'android.permission.READ_EXTERNAL_STORAGE'
      // plus 桥：必须 invoke；PERMISSION_GRANTED === 0
      const code = Number(plus.android.invoke(MainActivity, 'checkSelfPermission', perm))
      const granted = code === 0
      store.setPhotoPermissionGranted(granted)
      resolve(granted)
    } catch (e) {
      console.warn('[SyncEngine] permission check', e)
      resolve(store.isPhotoPermissionGranted())
    }
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.resolve(store.isPhotoPermissionGranted())
  // #endif
}

export async function runSync(showLog = true) {
  if (running) {
    console.warn('[SyncEngine] already running')
    return store.getLastSync().result || RESULT_NONE
  }
  running = true
  const start = Date.now()
  try {
    const granted = await isPermissionGranted()
    if (!granted) {
      store.recordSync(RESULT_UNAUTHORIZED, 0, 0)
      return RESULT_UNAUTHORIZED
    }
    await retryPending()
    const photos = await scanAlbum()
    try {
      localMediaIndex.updateFromPhotos(photos)
    } catch (_) {}
    const snapshot = createSnapshot(
      store.getDeviceId(),
      store.getAppVersion(),
      store.getWindowDays(),
      photos
    )
    const json = JSON.stringify(snapshot)
    const { status, data } = await uploadSnapshot(json)
    const cost = Date.now() - start
    if (status === 'SUCCESS') {
      store.recordSync(RESULT_SUCCESS, photos.length, cost)
      if (showLog) console.log('[SyncEngine] 快照对账成功', photos.length)

      // 提取服务端返回的待上传媒体差量
      const needed = (data && data.data && Array.isArray(data.data.needed_uploads))
        ? data.data.needed_uploads
        : []

      if (needed.length > 0) {
        if (showLog) console.log('[SyncEngine] 待上传差量媒体文件:', needed.length)
        // 匹配本地实际路径 localPath 与 mediaType
        const photoMap = new Map()
        for (const p of photos) {
          photoMap.set(p.id, p)
          photoMap.set(`${p.name}|${p.size}`, p)
        }

        const itemsToUpload = needed.map((item) => {
          const local = photoMap.get(item.id) || photoMap.get(`${item.name}|${item.size}`)
          return {
            ...item,
            localPath: local ? local.localPath : '',
            mediaType: local ? local.mediaType : 'image'
          }
        })

        // 异步启动媒体队列直传 NAS（不阻塞快照结束标记）
        startUploadQueue(itemsToUpload).catch((e) => {
          console.error('[SyncEngine] 媒体文件直传异常:', e)
        })
      }

      return RESULT_SUCCESS
    }
    store.recordSync(RESULT_PENDING_UPLOAD, photos.length, cost)
    return RESULT_PENDING_UPLOAD
  } catch (err) {
    console.error('[SyncEngine] failed', err)
    store.recordSync(RESULT_FAILED, 0, Date.now() - start)
    return RESULT_FAILED
  } finally {
    running = false
  }
}

