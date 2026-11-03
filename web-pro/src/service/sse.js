/**
 * SSE 客户端服务 (Server-Sent Events)
 * 连接 /api/events，支持鉴权 token、自动重连与事件派发
 *
 * asset:changed（入库/删除/对账）走 200ms+rAF 合并通道：批量入库时 N 个事件
 * 只派发一次合并事件，消费者只刷新一次列表；task:updated、心跳与重连逻辑不受影响。
 */
import { getToken } from '../api.js';
import { resolveApiUrl } from '../server-resolve.js';

class SSEClient {
  constructor() {
    this.eventSource = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 3000;
    this.listeners = new Map(); // eventName -> Set(callbacks)
    this.taskListeners = new Map(); // taskId -> Set(callbacks)
    this.isConnected = false;
    this.isManualClosed = false;
    // asset:changed 合并刷新：一个 tick 内的 N 个入库/删除事件只触发一次列表刷新
    this.pendingAssetChanges = [];
    this.assetChangeTimer = null;
    this.assetChangeRaf = 0;
  }

  /**
   * 合并 asset:changed：200ms trailing 窗口聚批，可见时再用 rAF 对齐渲染帧，
   * 一批入库（几十上百条 SSE）只触发一次消费者刷新；页面隐藏时 rAF 不执行，
   * 直接派发（此时仍受 200ms 窗口节流，避免隐藏期 N 请求）。
   */
  queueAssetChange(entry) {
    this.pendingAssetChanges.push(entry);
    if (this.assetChangeTimer != null) return;
    this.assetChangeTimer = setTimeout(() => {
      this.assetChangeTimer = null;
      const run = () => {
        this.assetChangeRaf = 0;
        const batch = this.pendingAssetChanges.splice(0);
        if (!batch.length) return;
        let merged;
        if (batch.length === 1) {
          merged = batch[0];
        } else {
          const last = batch[batch.length - 1];
          merged = {
            action: 'batch',
            data: last && last.data,
            count: batch.length,
            actions: batch.map((e) => e && e.action).filter(Boolean),
          };
        }
        this.dispatch('asset:changed', merged);
      };
      if (typeof requestAnimationFrame === 'function'
        && typeof document !== 'undefined' && !document.hidden) {
        this.assetChangeRaf = requestAnimationFrame(run);
      } else {
        run();
      }
    }, 200);
  }

  connect() {
    if (this.eventSource || typeof window === 'undefined' || !window.EventSource) {
      return;
    }
    this.isManualClosed = false;
    const token = getToken();
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const rawUrl = `/api/events${query}`;
    const url = resolveApiUrl(rawUrl);

    try {
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        this.isConnected = true;
        this.reconnectDelay = 3000;
      };

      this.eventSource.onerror = (err) => {
        this.close();
        if (!this.isManualClosed) {
          this.scheduleReconnect();
        }
      };

      // 任务更新
      this.eventSource.addEventListener('task:updated', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.dispatch('task:updated', data);
          if (data && (data.taskId || data.task_id)) {
            const tid = data.taskId || data.task_id;
            const cbs = this.taskListeners.get(tid);
            if (cbs) {
              cbs.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } });
            }
          }
        } catch (e) {
          console.warn('[SSE] 解析 task:updated 失败', e);
        }
      });

      // 资产入库
      this.eventSource.addEventListener('asset:ingested', (event) => {
        try {
          const data = JSON.parse(event.data);
          // 原始事件立即派发；变更合并走聚批通道
          this.dispatch('asset:ingested', data);
          this.queueAssetChange({ action: 'ingested', data });
        } catch (e) {
          console.warn('[SSE] 解析 asset:ingested 失败', e);
        }
      });

      // 资产删除
      this.eventSource.addEventListener('asset:deleted', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.dispatch('asset:deleted', data);
          this.queueAssetChange({ action: 'deleted', data });
        } catch (e) {
          console.warn('[SSE] 解析 asset:deleted 失败', e);
        }
      });

      // 对账完成
      this.eventSource.addEventListener('sync:reconcile_done', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.dispatch('sync:reconcile_done', data);
          this.queueAssetChange({ action: 'reconcile_done', data });
        } catch (e) {
          console.warn('[SSE] 解析 sync:reconcile_done 失败', e);
        }
      });
    } catch (e) {
      console.warn('[SSE] 创建 EventSource 失败', e);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  close() {
    this.isConnected = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  disconnect() {
    this.isManualClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.assetChangeTimer != null) {
      clearTimeout(this.assetChangeTimer);
      this.assetChangeTimer = null;
    }
    if (this.assetChangeRaf && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.assetChangeRaf);
      this.assetChangeRaf = 0;
    }
    this.pendingAssetChanges = [];
    this.close();
  }

  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
    if (!this.eventSource && !this.isManualClosed) {
      this.connect();
    }
    return () => {
      const set = this.listeners.get(eventName);
      if (set) {
        set.delete(callback);
      }
    };
  }

  dispatch(eventName, data) {
    const set = this.listeners.get(eventName);
    if (set) {
      set.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } });
    }
  }

  onTaskUpdate(taskId, callback) {
    if (!taskId) {
      return this.on('task:updated', callback);
    }
    if (!this.taskListeners.has(taskId)) {
      this.taskListeners.set(taskId, new Set());
    }
    this.taskListeners.get(taskId).add(callback);
    if (!this.eventSource && !this.isManualClosed) {
      this.connect();
    }
    return () => {
      const set = this.taskListeners.get(taskId);
      if (set) {
        set.delete(callback);
      }
    };
  }

  onAssetChange(callback) {
    return this.on('asset:changed', callback);
  }
}

export const sseClient = new SSEClient();
export const onTaskUpdate = (taskId, callback) => sseClient.onTaskUpdate(taskId, callback);
export const onAssetChange = (callback) => sseClient.onAssetChange(callback);

export default sseClient;
