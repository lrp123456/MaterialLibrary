/**
 * 分层预取
 *
 * L1（grid 256px）：把列表要用的网格图落到本地磁盘。
 *    服务端 grid 档已在磁盘缓存，App 这边再落一份，首屏/滚动就不用每次走网络。
 * L2（列表 JSON）：把常用筛选条件的列表结果预热进 ViewerCache（SWR 命中即秒开）。
 *
 * 触发时机：
 *   1. 收到服务端「素材入库」推送（asset.ingested）
 *   2. App 冷启动（首屏之后，不跟首屏抢资源）
 */
import { fetchAssets, gridUrl } from './ViewerApi'
import { viewerCache } from './ViewerCache'
import { pushClient } from './PushClient'

const INDEX_KEY = 'prefetch_grid_index'
const MAX_INDEX = 400
const MAX_PARALLEL = 3
/** 冷启动预取推迟多久，避免和首屏渲染抢 CPU/网络 */
const LAUNCH_DELAY_MS = 2500

function baseDir() {
  try {
    // APP 端 USER_DATA_PATH 指向应用私有目录，无需额外授权
    if (typeof uni !== 'undefined' && uni.env && uni.env.USER_DATA_PATH) {
      return uni.env.USER_DATA_PATH + '/prefetch'
    }
  } catch (_) {}
  return ''
}

function gridFile(fid) {
  const dir = baseDir()
  if (!dir) return ''
  return dir + '/grid_' + String(fid).replace(/[^\w.-]/g, '_') + '.jpg'
}

class PrefetchService {
  constructor() {
    this.index = {}
    this.inflight = new Set()
    this.unsub = null
    this.launchTimer = null
    this.restoreIndex()
  }

  restoreIndex() {
    try {
      const raw = uni.getStorageSync(INDEX_KEY)
      if (raw && typeof raw === 'object') this.index = raw
    } catch (e) {
      this.index = {}
    }
  }

  saveIndex() {
    try {
      const keys = Object.keys(this.index)
      if (keys.length > MAX_INDEX) {
        // 超量时丢最旧的一半
        const drop = keys.slice(0, Math.floor(keys.length / 2))
        for (const k of drop) delete this.index[k]
      }
      uni.setStorageSync(INDEX_KEY, this.index)
    } catch (e) {
      console.warn('[Prefetch] index save failed', e)
    }
  }

  /** 已落盘的网格图路径（没有则空串） */
  getLocalPath(fid) {
    if (!fid) return ''
    return this.index[String(fid)] || ''
  }

  async downloadOne(fid) {
    if (this.inflight.has(fid)) return ''
    const dest = gridFile(fid)
    if (!dest) return ''
    this.inflight.add(fid)
    try {
      const url = gridUrl(fid)
      const res = await new Promise((resolve) => {
        uni.downloadFile({
          url,
          filePath: dest,
          timeout: 15000,
          success: (r) => resolve(r),
          fail: () => resolve(null),
        })
      })
      if (res && res.statusCode === 200 && res.tempFilePath) {
        this.index[String(fid)] = dest
        return dest
      }
      return ''
    } catch (e) {
      return ''
    } finally {
      this.inflight.delete(fid)
    }
  }

  /** 批量预取（限流，避免打满局域网） */
  async prefetchGrid(fids) {
    const list = [...new Set((fids || []).filter(Boolean))]
    if (!list.length) return
    const pending = list.filter((fid) => !this.index[String(fid)])
    if (!pending.length) return

    let cursor = 0
    const worker = async () => {
      while (cursor < pending.length) {
        const fid = pending[cursor++]
        await this.downloadOne(fid)
      }
    }
    const workers = []
    for (let i = 0; i < Math.min(MAX_PARALLEL, pending.length); i++) workers.push(worker())
    await Promise.all(workers)
    this.saveIndex()
  }

  /** L2：预热常用列表（fetchAssets 内部会写 ViewerCache） */
  async warmList() {
    try {
      await fetchAssets({ page: 1, pageSize: 30, sort: 'latest', mediaType: 'image' })
    } catch (e) {
      // 预热失败不影响正常浏览
    }
  }

  /** 服务端推「素材入库」→ 预取该素材网格图 + 刷新列表缓存 */
  async onAssetIngested(payload) {
    const fid = payload && payload.fid
    if (!fid) return
    if (payload.kind && payload.kind !== 'image') return
    await this.prefetchGrid([fid])
    await this.warmList()
  }

  /** 冷启动预热：首屏之后跑一次 */
  scheduleLaunchWarm() {
    if (this.launchTimer) return
    this.launchTimer = setTimeout(async () => {
      this.launchTimer = null
      try {
        // pageSize 必须与素材库首屏一致（30）：makeListKey 不含 pageSize，
        // 用 12 会把首屏缓存覆盖成 12 条，回前台时列表会少一半。
        const data = await fetchAssets({ page: 1, pageSize: 30, sort: 'latest', mediaType: 'image' })
        const fids = ((data && data.items) || []).map((r) => r && r.fid).filter(Boolean)
        await this.prefetchGrid(fids)
      } catch (e) {
        console.warn('[Prefetch] launch warm failed', e)
      }
    }, LAUNCH_DELAY_MS)
  }

  start() {
    if (this.unsub) return
    this.unsub = pushClient.subscribe((evt) => {
      if (!evt || evt.event !== 'asset.ingested') return
      this.onAssetIngested(evt.payload)
    })
  }

  stop() {
    if (this.unsub) {
      this.unsub()
      this.unsub = null
    }
    if (this.launchTimer) {
      clearTimeout(this.launchTimer)
      this.launchTimer = null
    }
  }
}

export const prefetch = new PrefetchService()
export default prefetch
