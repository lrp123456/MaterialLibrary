/**
 * 服务端推送通道客户端（长连接）
 *
 * 用途：取代 AiTaskManager 的 3 秒轮询。服务端在 AI 任务创建/完成/失败时
 * 通过 WebSocket 主动推事件（见 src/ws-server.js 的 broadcast）。
 *
 * 为什么走 uni.connectSocket 而不是 EventSource：
 *   APP 端（Android/iOS）没有 EventSource，原生只给 WebSocket。
 *
 * 断线重连：1s → 2s → 4s → 8s → 30s（封顶），连上后退回第一档。
 * 心跳：每 25 秒发一次应用层 ping，服务端回 pong；10 秒没等到就主动断开重连。
 *   （服务端另有 30 秒一次的协议层 PING，用来清僵死连接，与这里的应用层心跳互补。）
 */
import { store } from './SyncStateStore'
import { currentServerUrl, ensureServerUrl } from './ServerResolve'

const RECONNECT_STEPS = [1000, 2000, 4000, 8000, 30000]
const PING_INTERVAL_MS = 25000
const PONG_TIMEOUT_MS = 10000

function toWsUrl(base, token) {
  const url = String(base || '').trim().replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://').replace(/\/+$/, '')
  return url + '/api/push?token=' + encodeURIComponent(token || '')
}

class PushClient {
  constructor() {
    this.socket = null
    this.listeners = new Set()
    this.stateListeners = new Set()
    this.connected = false
    this.running = false
    this.retryIndex = 0
    this.retryTimer = null
    this.pingTimer = null
    this.pongTimer = null
    this.connectedToken = ''
  }

  isConnected() {
    return this.connected
  }

  /** 订阅推送事件：fn({ event, payload }) */
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {}
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** 订阅连接状态变化：fn(connected: boolean) */
  onState(fn) {
    if (typeof fn !== 'function') return () => {}
    this.stateListeners.add(fn)
    fn(this.connected)
    return () => this.stateListeners.delete(fn)
  }

  /** 启动连接（幂等）。登录后调用即可。 */
  async start() {
    this.running = true
    if (this.socket || this.retryTimer) return
    try {
      await ensureServerUrl()
    } catch (e) {
      // 探活失败不致命，等重连定时器再试
    }
    this.connect()
  }

  /** 停止连接并清掉重连/心跳定时器 */
  stop() {
    this.running = false
    this.clearTimers()
    this.closeSocket()
    this.setConnected(false)
  }

  clearTimers() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null }
  }

  closeSocket() {
    const s = this.socket
    this.socket = null
    if (!s) return
    try { s.close({}) } catch (e) { /* 已断开 */ }
  }

  connect() {
    if (!this.running) return
    if (this.socket) return

    const token = store.getToken()
    if (!token) {
      // 未登录：不连，退回 2 秒后重试（登录后自然会拿到 token）
      this.scheduleReconnect()
      return
    }
    // token 变了（重新登录）→ 旧连接的鉴权已失效，重连
    if (this.connectedToken && this.connectedToken !== token) {
      this.closeSocket()
    }

    const url = toWsUrl(currentServerUrl(), token)
    let task = null
    try {
      task = uni.connectSocket({ url, complete: () => {} })
    } catch (e) {
      this.scheduleReconnect()
      return
    }
    this.socket = task

    task.onOpen(() => {
      this.connectedToken = token
      this.retryIndex = 0
      this.setConnected(true)
      this.startHeartbeat()
    })

    task.onMessage((res) => {
      let msg = null
      try { msg = JSON.parse(res.data) } catch (e) { return }
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'pong') {
        if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null }
        return
      }
      if (msg.type === 'hello') return
      if (msg.type !== 'event') return
      this.emit({ event: msg.event, payload: msg.payload })
    })

    task.onClose(() => {
      this.onDisconnected()
    })

    task.onError(() => {
      this.onDisconnected()
    })
  }

  onDisconnected() {
    this.clearTimers()
    this.socket = null
    this.setConnected(false)
    this.scheduleReconnect()
  }

  setConnected(v) {
    if (this.connected === v) return
    this.connected = v
    for (const fn of this.stateListeners) {
      try { fn(v) } catch (e) { console.warn('[PushClient] state listener error', e) }
    }
  }

  emit(evt) {
    for (const fn of this.listeners) {
      try { fn(evt) } catch (e) { console.warn('[PushClient] listener error', e) }
    }
  }

  startHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = setInterval(() => {
      if (!this.socket || !this.connected) return
      try {
        this.socket.send({ data: JSON.stringify({ type: 'ping' }) })
      } catch (e) {
        this.onDisconnected()
        return
      }
      if (this.pongTimer) clearTimeout(this.pongTimer)
      this.pongTimer = setTimeout(() => {
        // 没等到 pong：连接多半已僵死，主动断开走重连
        this.onDisconnected()
      }, PONG_TIMEOUT_MS)
    }, PING_INTERVAL_MS)
  }

  scheduleReconnect() {
    if (!this.running) return
    if (this.retryTimer) return
    const delay = RECONNECT_STEPS[Math.min(this.retryIndex, RECONNECT_STEPS.length - 1)]
    this.retryIndex = Math.min(this.retryIndex + 1, RECONNECT_STEPS.length - 1)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }
}

export const pushClient = new PushClient()
export default pushClient
