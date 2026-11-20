/**
 * 组合式 API 1：SSE 实时任务流自动订阅与解绑 (useSseTaskStream)
 * 职责：
 *  - 依托 useRealtimeEventsStore 单例，提供按组件生命周期的安全事件订阅
 *  - 严格通过 onScopeDispose 自动解绑，确保组件切换 20 次后监听器 0 净增长
 */
import { onScopeDispose, onMounted } from 'vue';
import { useRealtimeEventsStore } from '../stores/realtimeEvents.js';

export function useSseTaskStream(topic, callback) {
  const realtimeStore = useRealtimeEventsStore();
  let unsubscribe = null;

  onMounted(() => {
    realtimeStore.ensureConnected();
    if (topic && typeof callback === 'function') {
      unsubscribe = realtimeStore.subscribe(topic, callback);
    }
  });

  onScopeDispose(() => {
    if (typeof unsubscribe === 'function') {
      unsubscribe();
      unsubscribe = null;
    }
  });

  return {
    isConnected: realtimeStore.isConnected,
    subscribeTask: (taskId, cb) => {
      const unsub = realtimeStore.subscribeTask(taskId, cb);
      onScopeDispose(() => {
        try { unsub(); } catch (_) {}
      });
      return unsub;
    },
  };
}
