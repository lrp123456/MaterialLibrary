/**
 * AI 任务全局管理服务 (AiTaskManager)
 * 负责客户端异步 AI 任务（如多空间漫游视频渲染、图像精修等）的生命周期管理、
 * 本地持久化、后台静默状态轮询与全局浮窗通知联动。
 */
import { submitAiTask, queryAiTask, queryAiTaskById } from './ViewerApi'
import { viewerCache } from './ViewerCache'

const STORAGE_KEY = 'ai_active_tasks'
const POLL_INTERVAL_MS = 3000

class AiTaskManager {
  constructor() {
    this.tasks = []
    this.listeners = new Set()
    this.pollTimer = null
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
    // 若存在未完成任务，启动后台轮询
    if (this.getActiveTasks().length > 0) {
      this.startPolling()
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
      fn(this.getActiveTasks(), this.getLatestActiveTask())
    }
    return () => {
      this.listeners.delete(fn)
    }
  }

  notify() {
    const active = this.getActiveTasks()
    const latest = this.getLatestActiveTask()
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

  getAllTasks() {
    return [...this.tasks]
  }

  /**
   * 提交并注册一个全新任务
   */
  async createTask({ fid, type = 'spatial_walkthrough', title = '室内漫游视频生成', sourceAssets = [], payload = {} }) {
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
    this.startPolling()

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

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  async pollCycle() {
    const active = this.getActiveTasks()
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
              task.outputKind = res.output_kind || res.outputKind || (task.type === 'walkthrough' ? 'video' : 'derivative')
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
