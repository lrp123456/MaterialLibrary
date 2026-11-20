/**
 * 领域 Store 1：AI 创作工坊会话与任务状态机 (Studio Session Store)
 * 职责：
 *  - 会话列表、当前激活会话、会话消息流
 *  - 会话级并发生成状态管理（按会话隔离 currentGenerating，绝不用全局单例阻塞）
 *  - 冻结快照提交与取消状态机流转
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useStudioSessionStore = defineStore('studioSession', () => {
  const sessions = ref([]);
  const currentSessionId = ref(null);
  const sessionMessages = ref({}); // sessionId -> Message[]
  const generatingMap = ref({}); // sessionId -> boolean
  const uploadingCrop = ref(false);
  const activeTaskMap = ref({}); // jobId -> { status, progress, stage, cancellable }

  // 当前会话专属的生成中派生状态（隔离多会话，防止互相置灰）
  const currentGenerating = computed(() => {
    if (!currentSessionId.value) return false;
    return !!generatingMap.value[currentSessionId.value];
  });

  const currentMessages = computed(() => {
    if (!currentSessionId.value) return [];
    return sessionMessages.value[currentSessionId.value] || [];
  });

  const hasGeneratingPlaceholder = computed(() => {
    const list = currentMessages.value;
    if (!list.length) return false;
    const last = list[list.length - 1];
    return last && last.role === 'assistant' && (last.status === 'running' || last.status === 'queued');
  });

  function setSessionId(id) {
    currentSessionId.value = id;
    if (id && !sessionMessages.value[id]) {
      sessionMessages.value[id] = [];
    }
  }

  function setGenerating(sessionId, val) {
    if (!sessionId) return;
    generatingMap.value = { ...generatingMap.value, [sessionId]: !!val };
  }

  function appendMessage(sessionId, msg) {
    const sid = sessionId || currentSessionId.value;
    if (!sid) return;
    const cur = sessionMessages.value[sid] || [];
    sessionMessages.value[sid] = [...cur, msg];
  }

  function updateMessage(sessionId, msgId, patch) {
    const sid = sessionId || currentSessionId.value;
    if (!sid || !sessionMessages.value[sid]) return;
    sessionMessages.value[sid] = sessionMessages.value[sid].map((m) => {
      if (m.id === msgId) {
        return { ...m, ...patch };
      }
      return m;
    });
  }

  function registerTask(jobId, meta) {
    if (!jobId) return;
    activeTaskMap.value[jobId] = {
      ...(activeTaskMap.value[jobId] || {}),
      ...meta,
    };
  }

  function markJobCancelled(jobId) {
    if (!jobId) return;
    if (activeTaskMap.value[jobId]) {
      activeTaskMap.value[jobId].status = 'cancelled';
      activeTaskMap.value[jobId].cancellable = false;
    }
  }

  function resetCurrentSession() {
    if (currentSessionId.value) {
      sessionMessages.value[currentSessionId.value] = [];
      generatingMap.value[currentSessionId.value] = false;
    }
  }

  // ===== 会话与素材常用 API 方法 =====
  async function fetchSessions() {
    const res = await fetch('/api/chat/sessions');
    if (!res.ok) return [];
    const data = await res.json();
    sessions.value = data.sessions || [];
    return sessions.value;
  }

  async function deleteSession(id) {
    const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  }

  async function optimizePrompt(payload) {
    const res = await fetch('/api/chat/optimize-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok ? res.json() : null;
  }

  async function fetchTemplate(tplId) {
    const res = await fetch(`/api/creation-templates/${encodeURIComponent(tplId)}`);
    return res.ok ? res.json() : null;
  }

  async function fetchTemplates() {
    const res = await fetch('/api/creation-templates');
    return res.ok ? res.json() : null;
  }

  async function uploadAiMedia(formData) {
    const res = await fetch('/api/ai/upload', {
      method: 'POST',
      body: formData,
    });
    return res.ok ? res.json() : null;
  }

  async function asrTranscribe(formData) {
    const res = await fetch('/api/asr/transcribe?clean=1', {
      method: 'POST',
      body: formData,
    });
    return res.ok ? res.json() : null;
  }

  async function fetchAsset(fid) {
    const res = await fetch(`/api/assets/${encodeURIComponent(fid)}`);
    return res.ok ? res.json() : null;
  }

  async function fetchTagVocab() {
    const res = await fetch('/api/tag-vocab');
    return res.ok ? res.json() : null;
  }

  return {
    sessions,
    currentSessionId,
    sessionMessages,
    generatingMap,
    uploadingCrop,
    activeTaskMap,
    currentGenerating,
    currentMessages,
    hasGeneratingPlaceholder,
    setSessionId,
    setGenerating,
    appendMessage,
    updateMessage,
    registerTask,
    markJobCancelled,
    resetCurrentSession,
    fetchSessions,
    deleteSession,
    optimizePrompt,
    fetchTemplate,
    fetchTemplates,
    uploadAiMedia,
    asrTranscribe,
    fetchAsset,
    fetchTagVocab,
  };
});
