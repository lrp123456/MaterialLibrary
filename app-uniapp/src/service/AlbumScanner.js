/**
 * 相册扫描（自 AlbumScanner.ets 迁移）
 * 近 SNAPSHOT_SCAN_DAYS 天（按 modified 倒序，越界即停）。
 * - App-Android：plus.android 查询 MediaStore（仅元数据）
 * - 其他平台：演示 mockPhotos
 */
import { SNAPSHOT_SCAN_DAYS, PAGE_SIZE } from '../common/Constants'
import { createPhotoMeta } from '../common/Types'
import { store } from './SyncStateStore'

/** 演示/未接原生插件时的 mock 相册（近 3 天） */
export function mockPhotos() {
  const now = Date.now()
  const day = 86400000
  const names = [
    'IMG_001.jpg', 'IMG_002.jpg', 'VID_001.mp4',
    'screenshot.png', 'camera_2024.jpg', 'old_outside_window.jpg',
  ]
  return names.map((name, i) => {
    const modified = i === 5 ? now - 10 * day : now - i * 3600000
    const size = 102400 + i * 4096
    const id = `mock_${i}_${size}`
    return createPhotoMeta(id, name, size, modified)
  })
}

/**
 * 扫描近 N 天相册元数据。
 * @returns {Promise<Array>} PhotoMeta[]
 */
export async function scanAlbum() {
  const cutoff = Date.now() - SNAPSHOT_SCAN_DAYS * 86400000

  // #ifdef APP-PLUS
  try {
    const photos = await scanViaMediaStore()
    return photos.filter((p) => p.modified >= cutoff || p.modified === 0).slice(0, 5000)
  } catch (e) {
    console.warn('[AlbumScanner] native scan failed, fallback mock', e)
    return mockPhotos().filter((p) => p.modified >= cutoff)
  }
  // #endif

  // #ifndef APP-PLUS
  if (store.isPhotoPermissionGranted()) {
    return mockPhotos().filter((p) => p.modified >= cutoff)
  }
  return []
  // #endif
}

/** Android MediaStore：图片+视频分表查询，避免 Files URI / selection 转换失败 */
function scanViaMediaStore() {
  // #ifdef APP-PLUS
  return new Promise((resolve, reject) => {
    try {
      if (typeof plus === 'undefined' || !plus.android) {
        reject(new Error('plus.android unavailable'))
        return
      }
      const main = plus.android.runtimeMainActivity()
      // 把 Activity 实例导入 JS，之后才能直接 getContentResolver()
      try { plus.android.importClass(main) } catch (_) {}
      let resolver = null
      try { resolver = main.getContentResolver() } catch (_) {}
      if (!resolver) resolver = plus.android.invoke(main, 'getContentResolver')
      if (!resolver) {
        reject(new Error('ContentResolver unavailable'))
        return
      }
      try { plus.android.importClass(resolver) } catch (_) {}

      const MediaStore = plus.android.importClass('android.provider.MediaStore')
      const cutoff = Date.now() - SNAPSHOT_SCAN_DAYS * 86400000
      const photos = []
      const COL_ID = '_id'
      const COL_NAME = '_display_name'
      const COL_SIZE = '_size'
      const COL_MOD = 'date_modified'
      const COL_DATA = '_data'
      const projection = [COL_ID, COL_NAME, COL_SIZE, COL_MOD, COL_DATA]
      const sortOrder = COL_MOD + ' DESC'
      const MAX = PAGE_SIZE * 10

      const readCursor = (cursor, mediaKind = 'image') => {
        if (!cursor) return
        try {
          const idIdx = plus.android.invoke(cursor, 'getColumnIndex', COL_ID)
          const nameIdx = plus.android.invoke(cursor, 'getColumnIndex', COL_NAME)
          const sizeIdx = plus.android.invoke(cursor, 'getColumnIndex', COL_SIZE)
          const modIdx = plus.android.invoke(cursor, 'getColumnIndex', COL_MOD)
          const dataIdx = plus.android.invoke(cursor, 'getColumnIndex', COL_DATA)
          while (plus.android.invoke(cursor, 'moveToNext') && photos.length < MAX) {
            const id = String(plus.android.invoke(cursor, 'getString', idIdx) || '')
            const name = String(plus.android.invoke(cursor, 'getString', nameIdx) || '')
            const size = Number(plus.android.invoke(cursor, 'getLong', sizeIdx) || 0)
            const modSec = Number(plus.android.invoke(cursor, 'getLong', modIdx) || 0)
            const modified = modSec > 0 ? modSec * 1000 : 0
            let localPath = ''
            if (dataIdx >= 0) {
              try { localPath = String(plus.android.invoke(cursor, 'getString', dataIdx) || '') } catch (_) {}
            }
            if (!localPath && id) {
              localPath = mediaKind === 'video'
                ? `content://media/external/video/media/${id}`
                : `content://media/external/images/media/${id}`
            }
            if (!id) continue
            // 近 N 天窗口在 JS 侧过滤，避免 SQL selectionArgs 桥接失败
            if (modified > 0 && modified < cutoff) continue
            // 过滤 App 导出的已保存素材（防重复入库）
            if (store.isExportedMedia(localPath, name)) continue
            photos.push(createPhotoMeta(id, name, size, modified, localPath, mediaKind))
          }
        } finally {
          try { plus.android.invoke(cursor, 'close') } catch (_) {}
        }
      }

      const queryUri = (uri, label, mediaKind = 'image') => {
        if (!uri) return
        let cursor = null
        try {
          cursor = plus.android.invoke(resolver, 'query', uri, projection, null, null, sortOrder)
        } catch (e1) {
          try {
            cursor = resolver.query(uri, projection, null, null, sortOrder)
          } catch (e2) {
            console.warn('[AlbumScanner] query fail', label, e1 && e1.message, e2 && e2.message)
          }
        }
        if (cursor) readCursor(cursor, mediaKind)
        else console.warn('[AlbumScanner] cursor null', label)
      }

      // 图片 / 视频分表（比 Files 更稳）
      try {
        queryUri(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, 'images', 'image')
      } catch (e) { console.warn('[AlbumScanner] images uri', e) }
      try {
        queryUri(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, 'video', 'video')
      } catch (e) { console.warn('[AlbumScanner] video uri', e) }

      // 兜底：Files external
      if (!photos.length) {
        try {
          const Files = plus.android.importClass('android.provider.MediaStore$Files')
          const fileUri = plus.android.invoke(Files, 'getContentUri', 'external')
          queryUri(fileUri, 'files')
        } catch (e) { console.warn('[AlbumScanner] files uri', e) }
      }

      if (!photos.length) {
        // 权限/空相册都可能 0 条；有权限时返回空数组也合法
        const permOk = store.isPhotoPermissionGranted()
        if (!permOk) {
          reject(new Error('no media permission or empty album'))
          return
        }
      }
      console.log('[AlbumScanner] scanned', photos.length, 'items')
      resolve(photos)
    } catch (e) {
      reject(e)
    }
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.reject(new Error('MediaStore only on App'))
  // #endif
}

export { PAGE_SIZE }
