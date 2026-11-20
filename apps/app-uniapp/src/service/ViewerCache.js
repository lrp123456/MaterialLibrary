/**
 * 素材库数据缓存管理器（ViewerCache）
 * 实现 SWR（Stale-While-Revalidate）双层缓存：内存 Map + 本地 Storage 持久化。
 * 包含查询分键缓存（上限 20 组）与素材详情缓存（上限 100 条），TTL 5 分钟。
 */

const STORAGE_KEY_LIST = 'album_viewer_cache_list'
const STORAGE_KEY_DETAIL = 'album_viewer_cache_detail'

const DEFAULT_TTL = 5 * 60 * 1000 // 5 分钟
const MAX_LIST_CACHE = 20
const MAX_DETAIL_CACHE = 100

/**
 * 列表查询序列化（fetchAssets 与 makeListKey 共用，保证缓存 key 与实际请求同源）。
 * 返回 query 片段数组，空串表示该维度未启用；buildUrl 会 filter(Boolean) 后 join('&')。
 * 任何影响服务端结果的维度都必须在此登记，否则跨板块/筛选会碰撞脏缓存。
 */
export function buildAssetsQuery(opts = {}) {
  const {
    page = 1, pageSize = 30, keyword = '', space = '', style = '', material = '',
    colors = '', colorStyle = '', color_style = '', orientation = '', sort = 'latest',
    mediaType = '', videoSource = '', videoPurpose = '', category = '', lane = '',
    section = '', shelf = '', onlyFavorite = false, furniture_item = '', furniture_category = '', mood = '',
    genre = '', pose = '', character = '', skipFacets = false,
  } = opts
  const resolvedSort = sort === 'oldest' ? 'earliest' : sort
  const resolvedColorStyle = colorStyle || color_style
  return [
    `page=${page}`,
    `pageSize=${pageSize}`,
    keyword ? `keyword=${encodeURIComponent(keyword)}` : '',
    category ? `category=${encodeURIComponent(category)}` : '',
    space ? `space=${encodeURIComponent(space)}` : '',
    style ? `style=${encodeURIComponent(style)}` : '',
    material ? `material=${encodeURIComponent(material)}` : '',
    furniture_item ? `furniture_item=${encodeURIComponent(furniture_item)}` : '',
    furniture_category ? `furniture_category=${encodeURIComponent(furniture_category)}` : '',
    mood ? `mood=${encodeURIComponent(mood)}` : '',
    genre ? `genre=${encodeURIComponent(genre)}` : '',
    pose ? `pose=${encodeURIComponent(pose)}` : '',
    character ? `character=${encodeURIComponent(character)}` : '',
    colors ? `colors=${encodeURIComponent(colors)}` : '',
    resolvedColorStyle ? `color_style=${encodeURIComponent(resolvedColorStyle)}` : '',
    orientation ? `orientation=${encodeURIComponent(orientation)}` : '',
    resolvedSort ? `sort=${encodeURIComponent(resolvedSort)}` : '',
    mediaType ? `media_type=${encodeURIComponent(mediaType)}` : '',
    lane ? `lane=${encodeURIComponent(lane)}` : '',
    section ? `section=${encodeURIComponent(section)}` : '',
    shelf ? `shelf=${encodeURIComponent(shelf)}` : '',
    videoSource ? `video_source=${encodeURIComponent(videoSource)}` : '',
    videoPurpose ? `video_purpose=${encodeURIComponent(videoPurpose)}` : '',
    onlyFavorite ? 'only_favorite=1' : '',
    skipFacets ? 'skip_facets=1' : '',
  ]
}

class ViewerCacheService {
  constructor() {
    this._listMap = new Map()
    this._detailMap = new Map()
    this._pendingDetailPreview = null
    this._restoreFromStorage()
  }

  _restoreFromStorage() {
    try {
      const listData = uni.getStorageSync(STORAGE_KEY_LIST)
      if (listData && typeof listData === 'object') {
        for (const [k, v] of Object.entries(listData)) {
          if (v && v.data) this._listMap.set(k, v)
        }
      }
      const detailData = uni.getStorageSync(STORAGE_KEY_DETAIL)
      if (detailData && typeof detailData === 'object') {
        for (const [k, v] of Object.entries(detailData)) {
          if (v && v.data) this._detailMap.set(k, v)
        }
      }
    } catch (e) {
      console.warn('[ViewerCache] restore failed', e)
    }
  }

  _saveToStorage(type = 'both') {
    try {
      if (type === 'list' || type === 'both') {
        const obj = {}
        for (const [k, v] of this._listMap.entries()) {
          obj[k] = v
        }
        uni.setStorageSync(STORAGE_KEY_LIST, obj)
      }
      if (type === 'detail' || type === 'both') {
        const obj = {}
        for (const [k, v] of this._detailMap.entries()) {
          obj[k] = v
        }
        uni.setStorageSync(STORAGE_KEY_DETAIL, obj)
      }
    } catch (e) {
      console.warn('[ViewerCache] save failed', e)
    }
  }

  /**
   * 生成列表查询缓存 Key：直接复用请求序列化，key 即实际 query string，杜绝维度遗漏碰撞。
   */
  makeListKey(opts = {}) {
    return 'list:' + buildAssetsQuery(opts).filter(Boolean).join('&')
  }

  /**
   * 生成详情缓存 Key
   */
  makeDetailKey(fid) {
    return `detail:${String(fid || '')}`
  }

  /**
   * 获取列表缓存（SWR）
   */
  getList(key, ttl = DEFAULT_TTL) {
    const item = this._listMap.get(key)
    if (!item) return null
    const age = Date.now() - (item.timestamp || 0)
    return {
      data: item.data,
      timestamp: item.timestamp,
      isFresh: age < ttl,
      age,
    }
  }

  /**
   * 设置列表缓存
   */
  setList(key, data) {
    if (!key || !data) return
    // LRU 限制容量
    if (this._listMap.size >= MAX_LIST_CACHE && !this._listMap.has(key)) {
      const oldestKey = this._listMap.keys().next().value
      this._listMap.delete(oldestKey)
    }
    this._listMap.set(key, {
      data,
      timestamp: Date.now(),
    })
    this._saveToStorage('list')
  }

  /**
   * 获取详情缓存（SWR）
   */
  getDetail(fid, ttl = DEFAULT_TTL) {
    const key = this.makeDetailKey(fid)
    const item = this._detailMap.get(key)
    if (!item) return null
    const age = Date.now() - (item.timestamp || 0)
    return {
      data: item.data,
      timestamp: item.timestamp,
      isFresh: age < ttl,
      age,
    }
  }

  /**
   * 设置详情缓存
   */
  setDetail(fid, data) {
    const key = this.makeDetailKey(fid)
    if (!fid || !data) return
    if (this._detailMap.size >= MAX_DETAIL_CACHE && !this._detailMap.has(key)) {
      const oldestKey = this._detailMap.keys().next().value
      this._detailMap.delete(oldestKey)
    }
    this._detailMap.set(key, {
      data,
      timestamp: Date.now(),
    })
    this._saveToStorage('detail')
  }

  /**
   * 设置待进入详情页的列表预览元数据（跨页秒开桥接）
   */
  setPendingDetailPreview(item) {
    this._pendingDetailPreview = item ? { ...item } : null
  }

  /**
   * 获取并消费待进入详情页的预览元数据
   */
  getPendingDetailPreview(fid) {
    if (this._pendingDetailPreview && (!fid || this._pendingDetailPreview.fid === fid)) {
      const p = this._pendingDetailPreview
      this._pendingDetailPreview = null
      return p
    }
    return null
  }

  /**
   * 获取缓存统计指标
   */
  getStats() {
    return {
      queryCount: this._listMap.size,
      detailCount: this._detailMap.size,
      totalCount: this._listMap.size + this._detailMap.size,
    }
  }

  /**
   * 清空所有业务数据缓存
   */
  clearAll() {
    this._listMap.clear()
    this._detailMap.clear()
    this._pendingDetailPreview = null
    try {
      uni.removeStorageSync(STORAGE_KEY_LIST)
      uni.removeStorageSync(STORAGE_KEY_DETAIL)
    } catch (_) {}
  }

  clear() {
    this.clearAll()
  }
}

export const viewerCache = new ViewerCacheService()
