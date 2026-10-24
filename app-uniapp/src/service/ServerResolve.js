/**
 * 服务端地址解析（对标 web-pro/src/server-resolve.js）
 *
 * 候选链优先级：
 *   0) 用户在设置页手动填写的地址（最高，永不被探活覆盖）
 *   1) 上次探活成功的地址
 *   2) 运行时地址 RUNTIME_SERVER_URL（start-product 生成）
 *   3) 当前页面主机 :API_PORT（H5 场景，页面从 LAN IP 打开时后端就在同一台机）
 *   4) 已知局域网 IP :API_PORT
 *   5) 本机 127.0.0.1 :API_PORT
 *
 * 探活走 /api/health，**并行**发起，总耗时≈单次超时而非候选数×超时。
 */
import {
  SERVER_URL_CANDIDATES, API_HEALTH_PATH, API_PORT, KNOWN_LAN_HOSTS,
} from '../common/Constants'
import { RUNTIME_SERVER_URL } from '../common/server-port'
import { store } from './SyncStateStore'

let activeUrl = ''
let probing = null
const PROBE_TIMEOUT = 1200

function normalize(u) {
  return String(u || '').trim().replace(/\/+$/, '')
}

function isIpHost(h) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(h || ''))
}

/** 当前运行宿主（H5 下取页面 host，原生 App 下无 location） */
function here() {
  try {
    // #ifdef H5
    if (typeof location !== 'undefined' && location.host) {
      return { hostname: location.hostname, port: location.port }
    }
    // #endif
  } catch (_) {}
  return { hostname: '', port: '' }
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

/** 组装候选链（按优先级去重） */
export function buildCandidates() {
  const list = []
  const push = (u) => {
    const n = normalize(u)
    if (!n) return
    if (!/^https?:\/\//i.test(n)) return
    if (!list.includes(n)) list.push(n)
  }

  push(store.getManualServerUrl())
  push(store.getServerUrl())
  push(RUNTIME_SERVER_URL)

  const { hostname } = here()
  if (isIpHost(hostname)) push(`http://${hostname}:${API_PORT}`)

  for (const h of KNOWN_LAN_HOSTS) push(`http://${h}:${API_PORT}`)
  for (const u of SERVER_URL_CANDIDATES) push(u)

  return list
}

/** 当前应使用的 base（同步读缓存；首次请 await ensureServerUrl） */
export function currentServerUrl() {
  if (activeUrl) return activeUrl
  const candidates = buildCandidates()
  return candidates[0] || normalize(RUNTIME_SERVER_URL)
}

export function markServerDown(url) {
  const u = normalize(url)
  if (activeUrl && u === activeUrl) activeUrl = ''
}

/**
 * 用户在设置页改地址后调用：清缓存并立即重新探活
 */
export async function setManualServerUrl(url) {
  store.setManualServerUrl(url)
  activeUrl = ''
  return ensureServerUrl({ force: true })
}

export async function ensureServerUrl({ force = false } = {}) {
  if (activeUrl && !force) return activeUrl
  if (probing && !force) return probing

  probing = (async () => {
    const candidates = buildCandidates()
    if (!candidates.length) {
      const fallback = normalize(RUNTIME_SERVER_URL)
      store.setServerUrl(fallback)
      return fallback
    }

    // 并行探活，按候选链优先级定案（不是谁先回谁赢）
    const results = await Promise.all(candidates.map((u) => probeOne(u)))
    const idx = results.findIndex((ok) => ok)

    if (idx >= 0) {
      activeUrl = candidates[idx]
      store.setServerUrl(activeUrl)
      return activeUrl
    }

    // 全挂：回落到候选链第一个，错误由上层展示（设置页可手动改地址）
    activeUrl = candidates[0]
    store.setServerUrl(activeUrl)
    return activeUrl
  })().finally(() => {
    probing = null
  })
  return probing
}

export default { currentServerUrl, ensureServerUrl, markServerDown, setManualServerUrl, buildCandidates }
