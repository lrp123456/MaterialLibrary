/**
 * 本地相册快速索引服务（LocalMediaIndex）
 * 建立「文件名 -> 本地路径」轻量映射，用于素材库浏览与详情零流量秒开本地原图。
 */
import { scanAlbum } from './AlbumScanner'
import { store } from './SyncStateStore'

const STORAGE_KEY = 'album_local_media_index'
const MAX_ENTRIES = 5000

export function isVideoFile(fileName) {
  return /\.(mp4|mov|avi|mkv|webm|m4v|3gp|wmv)$/i.test(String(fileName || ''))
}

class LocalMediaIndexService {
  constructor() {
    this._map = new Map()
    this._typeMap = new Map()
    this._initialized = false
    this._scanning = false
    this._restoreFromStorage()
  }

  _restoreFromStorage() {
    try {
      const data = uni.getStorageSync(STORAGE_KEY)
      if (data && typeof data === 'object') {
        const entries = Array.isArray(data) ? data : Object.entries(data)
        for (const [key, val] of entries) {
          if (key && val) {
            this._map.set(key, String(val))
          }
        }
      }
    } catch (e) {
      console.warn('[LocalMediaIndex] restore from storage failed', e)
    }
  }

  _saveToStorage() {
    try {
      // 限制持久化容量，保留最近的条目
      const entries = Array.from(this._map.entries())
      const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
      const obj = {}
      for (const [k, v] of trimmed) {
        obj[k] = v
      }
      uni.setStorageSync(STORAGE_KEY, obj)
    } catch (e) {
      console.warn('[LocalMediaIndex] save to storage failed', e)
    }
  }

  /**
   * 应用启动或后台触发异步初始化更新
   */
  async initAsync() {
    if (this._scanning) return
    this._scanning = true
    try {
      // 检查权限后静默扫描相册
      if (store.isPhotoPermissionGranted()) {
        const photos = await scanAlbum()
        if (Array.isArray(photos) && photos.length > 0) {
          this.updateFromPhotos(photos)
        }
      }
    } catch (e) {
      console.warn('[LocalMediaIndex] initAsync scan skipped or failed', e)
    } finally {
      this._scanning = false
      this._initialized = true
    }
  }

  /**
   * 使用相册扫描结果更新索引（增量/全量）
   * @param {Array} photos PhotoMeta 数组
   */
  updateFromPhotos(photos) {
    if (!Array.isArray(photos) || photos.length === 0) return
    let changed = false
    for (const p of photos) {
      if (!p || !p.name || !p.localPath) continue
      // 存储 fileName -> localPath
      this._map.set(p.name, p.localPath)
      const isVid = p.mediaType === 'video' || isVideoFile(p.name)
      this._typeMap.set(p.name, isVid ? 'video' : 'image')
      // 如果有大小，增加复合 key 支持同名精准区分
      if (p.size) {
        this._map.set(`${p.name}|${p.size}`, p.localPath)
      }
      changed = true
    }
    if (changed) {
      this._saveToStorage()
    }
  }

  /**
   * 快速同步查找本地图库绝对路径
   * @param {string} fileName 文件名，如 IMG_2024.jpg
   * @param {number} [size] 文件大小（可选）
   * @returns {string} 本地路径或空字符串
   */
  getLocalPath(fileName, size = 0) {
    if (!fileName) return ''
    if (size > 0) {
      const exact = this._map.get(`${fileName}|${size}`)
      if (exact) return exact
    }
    return this._map.get(fileName) || ''
  }

  /**
   * 判断文件是否为视频
   */
  isVideo(fileName) {
    if (!fileName) return false
    return this._typeMap.get(fileName) === 'video' || isVideoFile(fileName)
  }

  /**
   * 标记某个本地路径失效（例如本地被删除或权限不足）
   * @param {string} fileName
   */
  invalidate(fileName) {
    if (!fileName) return
    this._map.delete(fileName)
    this._saveToStorage()
  }

  /**
   * 获取索引统计信息
   */
  getStats() {
    return {
      count: this._map.size,
    }
  }

  /**
   * 清空所有本地索引
   */
  clear() {
    this._map.clear()
    try {
      uni.removeStorageSync(STORAGE_KEY)
    } catch (_) {}
  }
}

export const localMediaIndex = new LocalMediaIndexService()
