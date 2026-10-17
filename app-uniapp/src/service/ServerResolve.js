/**
 * 服务端地址解析：127.0.0.1 → 192.168.1.59 → 公网。
 * /api/health 探活，短超时并行/顺序回退；成功结果缓存，失败时重探。
 */
import { SERVER_URL_CANDIDATES, API_HEALTH_PATH } from '../common/Constants'
import { RUNTIME_SERVER_URL } from '../common/server-port'
import { store } from './SyncStateStore'

let activeUrl = ''
let probing = null
const PROBE_TIMEOUT = 2500

function normalize(u) {
  return String(u || '').trim().replace(/\/+$/, '')
}

function probeOne(url) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT)
    try {
      uni.request({
        url: normalize(url) + API_HEALTH_PATH,
        method: 'GET',
        timeout: PROBE_TIMEOUT,
        success: (res) => {
          clearTimeout(timer)
          finish((res.statusCode || 0) < 500)
        },
        fail: () => {
          clearTimeout(timer)
          finish(false)
        },
      })
    } catch (e) {
      clearTimeout(timer)
      finish(false)
    }
  })
}

/** 当前应使用的 base（同步读缓存；首次请 await ensureServerUrl） */
export function currentServerUrl() {
  if (activeUrl) return activeUrl
  const runtime = normalize(RUNTIME_SERVER_URL)
  return runtime || normalize(store.getServerUrl() || SERVER_URL_CANDIDATES[0])
}

export function markServerDown(url) {
  const u = normalize(url)
  if (activeUrl && u === activeUrl) activeUrl = ''
}

export async function ensureServerUrl({ force = false } = {}) {
  if (activeUrl && !force) return activeUrl
  if (probing && !force) return probing

  probing = (async () => {
    const candidates = []
    // 一键启动脚本迁移端口时写入的运行时地址（最高优先），保证 App 连到迁移后的端口
    const runtime = normalize(RUNTIME_SERVER_URL)
    if (runtime) candidates.push(runtime)
    const saved = normalize(store.getServerUrl())
    if (saved && !candidates.includes(saved)) candidates.push(saved)
    for (const u of SERVER_URL_CANDIDATES) {
      const n = normalize(u)
      if (!candidates.includes(n)) candidates.push(n)
    }

    for (const url of candidates) {
      if (await probeOne(url)) {
        activeUrl = url
        store.setServerUrl(url)
        return url
      }
    }
    // 全挂：仍回落到本机，错误由上层展示
    activeUrl = candidates[0] || SERVER_URL_CANDIDATES[0]
    store.setServerUrl(activeUrl)
    return activeUrl
  })().finally(() => {
    probing = null
  })
  return probing
}

export default { currentServerUrl, ensureServerUrl, markServerDown }
