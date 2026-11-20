/**
 * 领域 Store 4：实时事件连接池 (Realtime Events Store)
 * 职责：
 *  - 全局唯一单例 SSE / WebSocket 连接池，杜绝多实例重复连接
 *  - 提供 topic / job:id / asset:changed 按需订阅与精准分发
 *  - 严格记录订阅数，支持组件卸载时自动解绑，保持 0 净增长
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { sseClient } from '../service/sse.js';

export const useRealtimeEventsStore = defineStore('realtimeEvents', () => {
  const isConnected = ref(false);
  const activeListenerCount = ref(0);
  const listenersMap = new Map(); // topic -> Set(callbacks)

  // 初始化或激活全局单例连接
  function ensureConnected() {
    if (!sseClient.isConnected && !sseClient.eventSource) {
      sseClient.connect();
    }
    isConnected.value = sseClient.isConnected;
  }

  /**
   * 订阅特定主题事件
   * @param {string} topic - 事件名称，如 'task:updated', 'asset:changed'
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅的销毁函数
   */
  function subscribe(topic, callback) {
    if (typeof callback !== 'function') return () => {};
    ensureConnected();

    if (!listenersMap.has(topic)) {
      listenersMap.set(topic, new Set());
      // 首次挂载底层 SSE 派发器
      sseClient.on(topic, (data) => {
        const cbs = listenersMap.get(topic);
        if (cbs) {
          for (const cb of cbs) {
            try { cb(data); } catch (e) { console.error(`[realtime:${topic}] error:`, e); }
          }
        }
      });
    }

    const set = listenersMap.get(topic);
    set.add(callback);
    activeListenerCount.value += 1;

    // 返回解绑函数，便于 composables 在 onScopeDispose 中调用
    return () => {
      unsubscribe(topic, callback);
    };
  }

  /**
   * 显式取消订阅
   */
  function unsubscribe(topic, callback) {
    const set = listenersMap.get(topic);
    if (set && set.has(callback)) {
      set.delete(callback);
      activeListenerCount.value = Math.max(0, activeListenerCount.value - 1);
    }
  }

  /**
   * 订阅特定任务 ID 的状态变更
   */
  function subscribeTask(taskId, callback) {
    if (!taskId || typeof callback !== 'function') return () => {};
    ensureConnected();
    const unsub = sseClient.onTask(taskId, callback);
    activeListenerCount.value += 1;
    return () => {
      try { unsub(); } catch (_) {}
      activeListenerCount.value = Math.max(0, activeListenerCount.value - 1);
    };
  }

  function close() {
    sseClient.close();
    listenersMap.clear();
    activeListenerCount.value = 0;
    isConnected.value = false;
  }

  return {
    isConnected,
    activeListenerCount,
    ensureConnected,
    subscribe,
    unsubscribe,
    subscribeTask,
    close,
  };
});
