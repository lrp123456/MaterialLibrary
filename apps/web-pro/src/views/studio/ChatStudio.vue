<template>
  <div class="chat-studio-root h-full flex flex-col bg-studio-950 text-slate-100 overflow-hidden relative font-sans">
    <!-- 头部工具栏 -->
    <header class="h-14 px-5 border-b border-studio-800 bg-studio-900/60 backdrop-blur-md flex items-center justify-between shrink-0">
      <div class="flex items-center gap-3">
        <h2 class="text-sm font-bold tracking-wide uppercase font-mono flex items-center gap-2">
          <StudioIcon name="sparkles" :size="16" class="text-studio-accent" />
          <span>AI 空间与影视创作工坊</span>
        </h2>
        <span v-if="currentGenerating && !hasGeneratingPlaceholder" class="px-2 py-0.5 rounded text-[10px] bg-studio-cyan/20 text-studio-cyan font-mono animate-pulse">
          当前会话正在生成…
        </span>
      </div>

      <div class="flex items-center gap-2 text-xs">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 border border-studio-700 text-slate-300 font-mono transition-colors"
          @click="openGlobalDrawer = true"
        >
          创作历史
        </button>
      </div>
    </header>

    <!-- 主消息滚动视口 -->
    <ChatMessageList
      :messages="sessionStore.currentMessages"
      @cancel="handleCancelJob"
      @preview="handlePreviewMessage"
      @preview-layer="handlePreviewLayer"
    />

    <!-- 底部输入与创作控制器 -->
    <StudioComposerBar
      v-model="promptText"
      v-model:modelKey="modelKey"
      v-model:aspectRatio="aspectRatio"
      v-model:resolution="resolution"
      :disabled="currentGenerating || uploadingCrop"
      :currentGenerating="currentGenerating"
      :uploadingCrop="sessionStore.uploadingCrop"
      :hasGeneratingPlaceholder="sessionStore.hasGeneratingPlaceholder"
      :hasInvalidChip="hasInvalidChip"
      :composerError="composerError"
      :referenceChips="referenceChips"
      :skills="STUDIO_SKILLS_REGISTRY"
      :activeSkillIds="activeSkillIds"
      @send="sendMessage"
      @remove-chip="removeChip"
      @toggle-skill="toggleSkill"
    />

    <!-- 模态弹窗与浮层挂载 -->
    <StudioViewer
      v-if="viewerVisible"
      :visible="viewerVisible"
      :item="activeViewerItem"
      @close="viewerVisible = false"
    />

    <StudioEditLayer
      v-if="editLayerVisible"
      :visible="editLayerVisible"
      :initialImage="editLayerImage"
      @close="editLayerVisible = false"
    />

    <StudioGlobalDrawer
      v-if="openGlobalDrawer"
      :visible="openGlobalDrawer"
      @close="openGlobalDrawer = false"
    />

    <OutpaintCanvasOverlay
      :visible="outpaintVisible"
      :sourceImage="outpaintImage"
      @close="outpaintVisible = false"
      @apply="applyOutpaint"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useStudioSessionStore } from '../../stores/studioSession.js';
import { useComposerDraft } from '../../composables/useComposerDraft.js';
import { useGenerationCancel } from '../../composables/useGenerationCancel.js';
import { useSseTaskStream } from '../../composables/useSseTaskStream.js';
import ChatMessageList from '../../components/studio/ChatMessageList.vue';
import StudioComposerBar from '../../components/studio/StudioComposerBar.vue';
import OutpaintCanvasOverlay from '../../components/studio/OutpaintCanvasOverlay.vue';
import StudioViewer from './StudioViewer.vue';
import StudioGlobalDrawer from './StudioGlobalDrawer.vue';
import StudioEditLayer from './StudioEditLayer.vue';
import DynamicModelParamBar from '../../components/DynamicModelParamBar.vue';

// ZCode 风格 Skills 挂载契约
const STUDIO_SKILLS_REGISTRY = [
  { id: 'skill_interior_realism', label: '空间写实增强', snippetIds: ['snippet_interior_realism'] },
  { id: 'skill_cinematic_lighting', label: '影视光影氛围', snippetIds: ['snippet_cinematic_lighting'] },
  { id: 'skill_vocal_sync', label: '视音频口型对齐', snippetIds: ['snippet_vocal_sync'] },
];

const sessionStore = useStudioSessionStore();
const { cancelJob } = useGenerationCancel();

const activeSkillIds = ref(['skill_interior_realism']);
const viewerVisible = ref(false);
const activeViewerItem = ref(null);
const editLayerVisible = ref(false);
const editLayerImage = ref('');
const openGlobalDrawer = ref(false);
const outpaintVisible = ref(false);
const outpaintImage = ref('');

// 组合式草稿控制器（单事实源与不可变提交快照）
const {
  promptText,
  modelKey,
  aspectRatio,
  resolution,
  referenceChips,
  composerError,
  hasInvalidChip,
  addChip,
  removeChip,
  buildFrozenSnapshot,
  clearDraft,
} = useComposerDraft({
  initialPrompt: '',
  initialModel: 'wan-2.1-t2v-plus',
  initialRatio: '16:9',
  initialResolution: '720p',
});

// 派生当前会话专属生成状态（杜绝全局单例干扰）
const currentGenerating = computed(() => {
  return sessionStore.currentGenerating;
});

function activeSnippetIds() {
  const ids = [];
  for (const skId of activeSkillIds.value) {
    const item = STUDIO_SKILLS_REGISTRY.find((s) => s.id === skId);
    if (item && item.snippetIds) ids.push(...item.snippetIds);
  }
  return ids;
}

function toggleSkill(id) {
  if (activeSkillIds.value.includes(id)) {
    activeSkillIds.value = activeSkillIds.value.filter((s) => s !== id);
  } else {
    activeSkillIds.value.push(id);
  }
}

// 必须清理旧错误消息尾部的调试参数
function sanitizeErrorMessage(err) {
  if (!err) return '';
  const s = String(err);
  if (s.includes('实际请求参数')) {
    return s.split('实际请求参数')[0].trim();
  }
  return s;
}

// 模板复用与模型修复支持
function repairStudioModelKeys() {
  if (!modelKey.value) modelKey.value = 'wan-2.1-t2v-plus';
}

function applyTemplate(tpl) {
  if (!tpl) return;
  if (tpl.prompt) promptText.value = tpl.prompt;
  if (tpl.model) modelKey.value = tpl.model;
  repairStudioModelKeys();
}

/**
 * 混排解析：提取 @视频N 与 @音频N 标签
 */
function parseMediaTags(text) {
  const re = /@(视频|音频)\d+/g;
  return String(text || '').match(re) || [];
}

/**
 * 发送生成请求：严格执行 WYSIWYG 铁律与冻结快照
 */
async function sendMessage() {
  // 铁律：遇失效/死芯片立即标红并阻断，绝不静默替代
  const deadChips = referenceChips.value.filter((c) => c.valid === false || !c.fid);
  if (deadChips.length > 0) {
    composerError.value = `检测到 ${deadChips.length} 个失效引用素材，已阻断提交`;
    return;
  }

  const snapshot = buildFrozenSnapshot();
  if (!snapshot) return;

  const currentSid = sessionStore.currentSessionId || 'default_session';
  sessionStore.setGenerating(currentSid, true);

  const userMsgId = `msg_${Date.now()}_u`;
  const assistantMsgId = `msg_${Date.now()}_a`;

  sessionStore.appendMessage(currentSid, {
    id: userMsgId,
    role: 'user',
    prompt: snapshot.prompt,
    createdAt: Date.now(),
  });

  sessionStore.appendMessage(currentSid, {
    id: assistantMsgId,
    role: 'assistant',
    modelKey: snapshot.modelKey,
    status: 'queued',
    stage: '排队中…',
    cancellable: true,
    layerStack: [],
    createdAt: Date.now(),
  });

  try {
    const tags = parseMediaTags(snapshot.prompt);
    const payload = {
      sessionId: currentSid,
      prompt: snapshot.prompt,
      modelKey: snapshot.modelKey,
      aspectRatio: snapshot.aspectRatio,
      resolution: snapshot.resolution,
      assets: snapshot.assets,
      mediaTags: tags,
      snippetIds: activeSnippetIds(),
      snapshotHash: snapshot.hash,
    };

    const res = await fetch('/api/gen/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errorMsg = `HTTP ${res.status}: ${errText}`;
      if (res.status === 429) errorMsg = 'HTTP 429|service is busy - 算力繁忙，请稍后重试';
      sessionStore.updateMessage(currentSid, assistantMsgId, {
        status: 'failed',
        error: errorMsg,
      });
      sessionStore.setGenerating(currentSid, false);
      return;
    }

    const json = await res.json();
    sessionStore.updateMessage(currentSid, assistantMsgId, {
      jobId: json.jobId,
      status: 'running',
      stage: '生成中…',
    });
  } catch (e) {
    let errorMsg = e.message;
    if (/aborted due to timeout/i.test(errorMsg)) {
      errorMsg = 'aborted due to timeout: 本地等待超时，已安全中止';
    }
    sessionStore.updateMessage(currentSid, assistantMsgId, {
      status: 'failed',
      error: errorMsg,
    });
    sessionStore.setGenerating(currentSid, false);
  } finally {
    clearDraft();
  }
}

async function handleCancelJob(jobId) {
  await cancelJob(jobId);
}

function handlePreviewMessage(msg) {
  activeViewerItem.value = msg;
  viewerVisible.value = true;
}

function handlePreviewLayer(layer, msg) {
  // 支持 Seedream 5.0 图层分解栈展示: msg.layerStack
  if (layer && layer.url) {
    activeViewerItem.value = { mediaUrl: layer.url, prompt: layer.name, layerStack: msg?.layerStack };
    viewerVisible.value = true;
  }
}

function applyOutpaint(cfg) {
  outpaintVisible.value = false;
  if (cfg && cfg.ratio) aspectRatio.value = cfg.ratio;
}

// SSE 事件流按组件生命周期自动绑定与安全解绑
useSseTaskStream('gen_job:updated', (evt) => {
  if (!evt || !evt.jobId) return;
  const sid = sessionStore.currentSessionId;
  if (evt.status === 'done' || evt.status === 'failed' || evt.status === 'cancelled') {
    sessionStore.setGenerating(sid, false);
  }
});

onMounted(() => {
  if (!sessionStore.currentSessionId) {
    sessionStore.setSessionId('sess_' + Date.now().toString(36));
  }
});
</script>
