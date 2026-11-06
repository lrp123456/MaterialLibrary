/**
 * AI 任务全局管理服务 (AiTaskManager)
 *
 * 两类任务共用这一份状态：
 * 1) 服务端异步任务（/lab 提交，带 remoteTaskId，靠 WS 推送或轮询更新）；
 * 2) 创作页同步生成（/gen/images|videos|audio、/edit/run），由页面用
 *    trackTask / finishTask / failTask 手动登记，用于跨 Tab 的任务浮窗。
 *
 * 统一负责：本地持久化、进度呼吸、后台轮询兜底与全局浮窗联动。
 */
import { submitAiTask, queryAiTask, queryAiTaskById } from './ViewerApi'
import { viewerCache } from './ViewerCache'
import { pushClient } from './PushClient'

const STORAGE_KEY = 'ai_active_tasks'
const POLL_INTERVAL_MS = 3000
const TICK_INTERVAL_MS = 1800
const TRACKED_TTL_MS = 6 * 60 * 1000

class AiTaskManager {
  constructor() {
    this.tasks = []
    this.listeners = new Set()
    this.pollTimer = null
    this.tickTimer = null
    this.init()
  }

  init() {
    try {
      const stored = uni.getStorageSync(STORAGE_KEY)
      if (Array.isArray(stored)) {
        this.tasks = stored
      }
    } catch (e) {
      this.tasks = []
    }
    // 推送通道连通后由事件驱动状态更新；未连通时才回落到轮询
    pushClient.subscribe((evt) => this.onPushEvent(evt))
    pushClient.onState((connected) => {
      if (connected) {
        this.stopPolling()
      } else if (this.getActiveTasks().length > 0) {
        this.startPolling()
      }
    })
    if (this.getActiveTasks().length > 0) {
      this.ensureFallbackPolling()
      // 上次退出时仍在跑的前台生成任务：靠本地 tick 推进并在超时后收口
      if (this.getActiveTasks().some((t) => !t.fid && !t.remoteTaskId)) {
        this.startTick()
      }
    }
  }

  save() {
    try {
      uni.setStorageSync(STORAGE_KEY, this.tasks.slice(0, 30))
    } catch (e) {
      console.warn('[AiTaskManager] save failed', e)
    }
  }

  subscribe(fn) {
    if (typeof fn === 'function') {
      this.listeners.add(fn)
      fn(this.getActiveTasks(), this.getLatestTask())
    }
    return () => {
      this.listeners.delete(fn)
    }
  }

  notify() {
    const active = this.getActiveTasks()
    const latest = this.getLatestTask()
    for (const fn of this.listeners) {
      try {
        fn(active, latest)
      } catch (e) {
        console.error('[AiTaskManager] listener error', e)
      }
    }
  }

  getActiveTasks() {
    return this.tasks.filter((t) => t.status === 'pending' || t.status === 'running')
  }

  getLatestActiveTask() {
    const active = this.getActiveTasks()
    return active.length ? active[0] : null
  }

  /** 最近一条任务（含已完成，供浮窗短暂展示结果） */
  getLatestTask() {
    return this.tasks.length ? this.tasks[0] : null
  }

  getAllTasks() {
    return [...this.tasks]
  }

  // ─────────── 创作页同步生成任务（跨 Tab 浮窗） ───────────
  /**
   * 登记一条前台生成任务。页面拿到结果后调用 finishTask / failTask。
   * 与 createTask 的区别：不提交服务端、不轮询，只做本地进度与浮窗。
   */
  trackTask(meta = {}) {
    const taskId = meta.taskId || 'gen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    const task = {
      taskId,
      type: meta.type || 'generation',
      title: meta.title || 'AI 生成',
      status: 'running',
      progress: Number(meta.progress) || 8,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: meta.sessionId || '',
      messageId: meta.messageId || '',
      outputFid: null,
      outputKind: meta.outputKind || '',
      error: null,
    }
    this.tasks = [task, ...this.tasks].slice(0, 30)
    this.save()
    this.startTick()
    this.notify()
    return task
  }

  updateTask(taskId, patch = {}) {
    const task = this.tasks.find((t) => t.taskId === taskId)
    if (!task) return null
    Object.assign(task, patch, { updatedAt: Date.now() })
    this.save()
    this.notify()
    return task
  }

  finishTask(taskId, { outputFid = null, outputKind = '' } = {}) {
    const task = this.tasks.find((t) => t.taskId === taskId)
    if (!task) return null
    task.status = 'success'
    task.progress = 100
    task.outputFid = outputFid || null
    if (outputKind) task.outputKind = outputKind
    task.updatedAt = Date.now()
    this.save()
    this.stopTickIfIdle()
    this.notify()
    return task
  }

  failTask(taskId, error) {
    const task = this.tasks.find((t) => t.taskId === taskId)
    if (!task) return null
    task.status = 'failed'
    task.error = error || '生成失败'
    task.updatedAt = Date.now()
    this.save()
    this.stopTickIfIdle()
    this.notify()
    return task
  }

  startTick() {
    if (this.tickTimer) return
    this.tickTimer = setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const t of this.tasks) {
        if (t.status !== 'running' && t.status !== 'pending') continue
        // 只推进本地登记的任务；服务端任务由推送/轮询给出真实进度
        if (t.remoteTaskId || t.fid) continue
        if (now - (t.createdAt || now) > TRACKED_TTL_MS) {
          t.status = 'failed'
          t.error = '任务超时，请回创作页重试'
          t.updatedAt = now
          changed = true
          continue
        }
        const p = Number(t.progress) || 0
        const next = Math.min(92, Math.round(p + (92 - p) * 0.08 + 0.5))
        if (next !== p) {
          t.progress = next
          t.updatedAt = now
          changed = true
        }
      }
      if (changed) {
        this.save()
        this.notify()
      }
      this.stopTickIfIdle()
    }, TICK_INTERVAL_MS)
  }

  stopTickIfIdle() {
    if (this.getActiveTasks().length > 0) return
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  /**
   * 提交并注册一个全新任务
   */
  async createTask({ fid, type = 'generation', title = 'AI 生成', sourceAssets = [], payload = {} }) {
    const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    const task = {
      taskId,
      fid,
      type,
      title,
      status: 'running',
      progress: 5,
      createdAt: Date.now(),
      sourceAssets: sourceAssets.map((s) => ({
        fid: s.fid,
        fileName: s.fileName,
        imgUrl: s.imgUrl,
        space: s.space || '',
      })),
      outputFid: null,
      error: null,
    }

    // 先推入队列并触发 UI 渲染
    this.tasks.unshift(task)
    this.save()
    this.notify()
    this.ensureFallbackPolling()

    try {
      const res = await submitAiTask(fid, {
        task_id: taskId,
        type,
        title,
        source_fids: sourceAssets.map((s) => s.fid).filter(Boolean),
        payload,
        ...payload,
      })
      if (res && (res.task_id || res.taskId)) {
        task.remoteTaskId = res.task_id || res.taskId
      }
      if (res && res.status === 'failed') {
        task.status = 'failed'
        task.error = res.error || '服务端拒绝任务'
        this.onTaskFailed(task)
      }
      this.save()
      this.notify()
    } catch (e) {
      console.warn('[AiTaskManager] submitAiTask failed:', e.message)
      task.status = 'failed'
      task.error = e.message || '提交服务端失败'
      this.onTaskFailed(task)
      this.save()
      this.notify()
      throw e
    }

    return task
  }

  startPolling() {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      this.pollCycle()
    }, POLL_INTERVAL_MS)
  }

  /** 轮询只是推送通道不通时的兜底 */
  ensureFallbackPolling() {
    if (pushClient.isConnected()) {
      this.stopPolling()
      return
    }
    this.startPolling()
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  async pollCycle() {
    const active = this.getActiveTasks().filter((t) => t.fid || t.remoteTaskId)
    if (!active.length) {
      this.stopPolling()
      return
    }

    let changed = false

    for (const task of active) {
      try {
        const res = task.remoteTaskId
          ? await queryAiTaskById(task.remoteTaskId).catch(() => queryAiTask(task.fid))
          : await queryAiTask(task.fid)
          if (res) {
            if (res.status === 'idle') {
              // 服务端尚无任务记录，保持运行并轻微推进
              task.progress = Math.min(90, (task.progress || 0) + 5)
              changed = true
            } else if (res.status === 'success' || res.status === 'completed' || res.status === 'done') {
              task.status = 'success'
              task.progress = 100
              task.outputFid = res.output_fid || res.outputFid || res.fid || task.fid
              task.outputKind = res.output_kind || res.outputKind || (task.type === 'video' ? 'video' : 'derivative')
              this.onTaskSuccess(task)
              changed = true
            } else if (res.status === 'failed' || res.status === 'error') {
              task.status = 'failed'
              task.error = res.error || '渲染任务失败'
              this.onTaskFailed(task)
              changed = true
            } else if (res.progress != null) {
              task.progress = Math.min(99, Math.max(task.progress || 0, Math.round(res.progress)))
              task.status = 'running'
              changed = true
            } else {
              // 自增少量进度保持呼吸感
              task.progress = Math.min(90, (task.progress || 0) + 10)
              changed = true
            }
          }
      } catch (e) {
        // 网络抖动，保持运行状态并自增少量进度
        task.progress = Math.min(90, (task.progress || 0) + 8)
        changed = true
      }
    }

    if (changed) {
      this.save()
      this.notify()
    }
  }

  /**
   * 服务端推送的 AI 任务事件（ai.task.created / completed / failed）
   */
  onPushEvent(evt) {
    const name = evt && evt.event
    const p = (evt && evt.payload) || {}
    if (!name || String(name).indexOf('ai.task.') !== 0) return

    const remoteId = p.task_id || p.taskId || ''
    const fid = p.fid || ''
    let task = null
    if (remoteId) {
      task = this.tasks.find((t) => t.remoteTaskId === remoteId || t.taskId === remoteId) || null
    }
    if (!task && fid) {
      task = this.tasks.find((t) => t.fid === fid && t.status !== 'success' && t.status !== 'failed') || null
    }
    if (!task) return
    // 终态任务不再被推送改写，避免与轮询重复弹 toast
    if (task.status === 'success' || task.status === 'failed') return

    if (remoteId && !task.remoteTaskId) task.remoteTaskId = remoteId

    const status = p.status || ''
    if (status === 'success' || status === 'completed' || status === 'done') {
      task.status = 'success'
      task.progress = 100
      task.outputFid = p.output_fid || p.outputFid || p.fid || task.fid
      task.outputKind = p.output_kind || p.outputKind || (task.type === 'video' ? 'video' : 'derivative')
      this.onTaskSuccess(task)
    } else if (status === 'failed' || status === 'error') {
      task.status = 'failed'
      task.error = p.error || '渲染任务失败'
      this.onTaskFailed(task)
    } else {
      if (p.progress != null) {
        task.progress = Math.min(99, Math.max(task.progress || 0, Math.round(p.progress)))
      }
      task.status = status === 'pending' ? 'running' : (status || 'running')
    }

    this.save()
    this.notify()
  }

  onTaskSuccess(task) {
    viewerCache.clearAll() // 任务完成，清除素材库缓存以展示最新视频
    uni.showToast({
      title: `✨ ${task.title} 已就绪！`,
      icon: 'success',
      duration: 3500,
    })
  }

  onTaskFailed(task) {
    uni.showToast({
      title: `${task.title} 失败: ${task.error || '请重试'}`,
      icon: 'none',
      duration: 3500,
    })
  }

  dismissTask(taskId) {
    this.tasks = this.tasks.filter((t) => t.taskId !== taskId)
    this.save()
    this.notify()
  }
}

export const aiTaskManager = new AiTaskManager()
