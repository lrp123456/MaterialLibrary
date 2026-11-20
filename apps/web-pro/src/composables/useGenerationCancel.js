/**
 * 组合式 API 4：全生命周期取消与竞态保护 (useGenerationCancel)
 * 职责：
 *  - 统一调用 POST /api/studio/jobs/:id/cancel
 *  - 严格落实「先裁决、后落态」：
 *    - 遇 409 IRREVERSIBLE 严禁改写卡片为已取消，更新 cancellable = false 并提示成片保全
 *    - 遇 200/204 更新 store 状态为 cancelled
 */
import { ref } from 'vue';
import { useStudioSessionStore } from '../stores/studioSession.js';

export function useGenerationCancel() {
  const isCancelling = ref(false);
  const cancelError = ref('');
  const sessionStore = useStudioSessionStore();

  async function cancelJob(jobId) {
    if (!jobId || isCancelling.value) return false;
    isCancelling.value = true;
    cancelError.value = '';

    try {
      const res = await fetch(`/api/gen/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.status === 409) {
        // 409 IRREVERSIBLE：云端已在渲染或已扣费，无法取消
        const errJson = await res.json().catch(() => ({}));
        cancelError.value = errJson.message || '任务已不可撤销（正在渲染中），将为您保留成片';
        // 关键铁律：绝不标记卡片为已取消，仅关闭取消按钮
        sessionStore.registerTask(jobId, { cancellable: false });
        return false;
      }

      if (res.ok) {
        sessionStore.markJobCancelled(jobId);
        return true;
      }

      const errText = await res.text().catch(() => '');
      cancelError.value = `取消失败 (${res.status}): ${errText}`;
      return false;
    } catch (e) {
      cancelError.value = `网络异常: ${e.message}`;
      return false;
    } finally {
      isCancelling.value = false;
    }
  }

  return {
    isCancelling,
    cancelError,
    cancelJob,
  };
}
