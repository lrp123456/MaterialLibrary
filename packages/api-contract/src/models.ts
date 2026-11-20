/**
 * @mls/api-contract · 统一模型能力与取消策略契约 (Phase 4)
 *
 * 声明全系统 13 个 gen/index 协议 + 4 个 services 引擎 + handlers 扩图/编辑 + 本地音视频进程的
 * 真实取消策略 (cancelPolicy) 与前端通用控件能力 (capabilities)。
 */

export type CancelPolicy = 'queue_only' | 'vendor_pending_only' | 'always_local';

export type JobLifecycleStage =
  | 'queued'
  | 'submitting'
  | 'vendor_pending'
  | 'running'
  | 'saving'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface ModelCapabilities {
  cancelPolicy: CancelPolicy;
  aspectRatios: string[];
  resolutionTiers: string[];
  durationSecs: number[];
  supportsSeed: boolean;
  refModes: string[];
  description?: string;
}

export interface ComposerAssetRef {
  fid: string;
  url: string;
  name?: string;
  mime?: string;
}

export interface ComposerDraft {
  prompt: string;
  model: string;
  assets: ComposerAssetRef[];
  aspectRatio?: string;
  resolutionTier?: string;
  durationSec?: number;
  seed?: number | null;
  refMode?: string;
  maskData?: string | null;
  bbox?: number[] | null;
  extraParams?: Record<string, any>;
}

export interface FrozenSubmitSnapshot {
  snapshotId: string;
  frozenAt: number;
  draft: ComposerDraft;
  hash: string;
}

export const COMMON_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
export const COMMON_RESOLUTIONS = ['720p', '1080p', '2k', '4k'];
export const COMMON_DURATIONS = [5, 10];
export const COMMON_REF_MODES = ['style', 'subject', 'composition', 'inpaint', 'outpaint'];

export const MODEL_CAPABILITIES_MAP: Record<string, ModelCapabilities> = {
  // ===== 1. queue_only (同步接口 / 无取消端点异步云模型) =====
  'http_json': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['1:1', '16:9', '9:16'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: true,
    refModes: ['subject', 'style'],
    description: '标准同步 HTTP JSON 接口，仅在排队中可取消'
  },
  'seedream': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutionTiers: ['1080p', '2k'],
    durationSecs: [],
    supportsSeed: true,
    refModes: ['style', 'composition'],
    description: '火山 Seedream 同步出图模型'
  },
  'gemini_generate_content': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['1:1', '16:9', '9:16'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: false,
    refModes: ['subject'],
    description: 'Google Gemini 同步图文理解与生图'
  },
  'newapi_gpt_image': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['1:1', '16:9', '9:16'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: false,
    refModes: ['style'],
    description: 'OpenAI 协议同步出图网关'
  },
  'unified_gateway': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['1:1', '16:9', '9:16'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: true,
    refModes: ['style', 'subject'],
    description: '统一多模态网关同步接口'
  },
  'gemini_veo': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['16:9', '9:16'],
    resolutionTiers: ['720p', '1080p'],
    durationSecs: [5, 10],
    supportsSeed: false,
    refModes: ['subject'],
    description: 'Google Veo 异步视频生成（云端无取消端点）'
  },
  'gemini_interactions': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['1:1'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: false,
    refModes: [],
    description: 'Gemini 交互式多轮协议'
  },
  'gemini_lyria': {
    cancelPolicy: 'queue_only',
    aspectRatios: [],
    resolutionTiers: [],
    durationSecs: [30, 60],
    supportsSeed: false,
    refModes: [],
    description: 'Lyria 音乐生成引擎'
  },
  'doubao_music': {
    cancelPolicy: 'queue_only',
    aspectRatios: [],
    resolutionTiers: [],
    durationSecs: [30, 60],
    supportsSeed: false,
    refModes: [],
    description: '火山豆包音乐异步生成'
  },
  'jimeng_expand': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['16:9', '9:16', '4:3', '3:4'],
    resolutionTiers: ['1080p', '2k'],
    durationSecs: [],
    supportsSeed: false,
    refModes: ['outpaint'],
    description: '即梦智能扩图'
  },
  'veimagex_expand': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['16:9', '9:16', '4:3', '3:4'],
    resolutionTiers: ['1080p', '2k'],
    durationSecs: [],
    supportsSeed: false,
    refModes: ['outpaint'],
    description: '火山 VeImageX 扩图服务'
  },
  'agnes': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['1:1', '16:9', '9:16'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: false,
    refModes: ['style'],
    description: 'Agnes 风格化滤镜'
  },

  // ===== 2. vendor_pending_only (具备排队期取消端点的异步大模型) =====
  'wan3.0-video': {
    cancelPolicy: 'vendor_pending_only',
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolutionTiers: ['720p', '1080p'],
    durationSecs: [5],
    supportsSeed: true,
    refModes: ['subject', 'composition'],
    description: '阿里百炼万相视频 3.0：云端排队期可真取消，进入 RUNNING 渲染后不可逆计费'
  },
  'wan2.1': {
    cancelPolicy: 'vendor_pending_only',
    aspectRatios: ['16:9', '9:16'],
    resolutionTiers: ['720p'],
    durationSecs: [5],
    supportsSeed: true,
    refModes: ['subject'],
    description: '万相视频 2.1 基础版'
  },
  'qwenimage-modelscope': {
    cancelPolicy: 'vendor_pending_only',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutionTiers: ['1080p', '2k'],
    durationSecs: [],
    supportsSeed: true,
    refModes: ['subject', 'style'],
    description: '魔搭社区 Qwen-Image 异步集群'
  },
  'aliyun-video-sr': {
    cancelPolicy: 'vendor_pending_only',
    aspectRatios: ['16:9', '9:16'],
    resolutionTiers: ['2k', '4k'],
    durationSecs: [],
    supportsSeed: false,
    refModes: [],
    description: '阿里云视频超分辨率重建'
  },
  'seedance': {
    cancelPolicy: 'vendor_pending_only',
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolutionTiers: ['720p', '1080p'],
    durationSecs: [5, 10],
    supportsSeed: true,
    refModes: ['subject', 'composition'],
    description: '火山方舟 Seedance 异步视频任务'
  },

  // ===== 3. always_local (本地自建进程/GPU 全周期真取消) =====
  'qwenimage-local': {
    cancelPolicy: 'always_local',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: true,
    refModes: ['subject', 'style', 'inpaint'],
    description: '本地私有化 GPU Qwen-Image 实例'
  },
  'acestep-local': {
    cancelPolicy: 'always_local',
    aspectRatios: ['1:1', '16:9', '9:16'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: true,
    refModes: ['style'],
    description: '本地 ACE-Step 风格加速渲染'
  },
  'indextts-local': {
    cancelPolicy: 'always_local',
    aspectRatios: [],
    resolutionTiers: [],
    durationSecs: [10, 30, 60],
    supportsSeed: false,
    refModes: [],
    description: '本地 IndexTTS 语音合成引擎'
  },
  'video-sr-local': {
    cancelPolicy: 'always_local',
    aspectRatios: ['16:9', '9:16'],
    resolutionTiers: ['2k', '4k'],
    durationSecs: [],
    supportsSeed: false,
    refModes: [],
    description: '本地 Real-ESRGAN / Waifu2x 显卡超分进程'
  },
  'clip-ai': {
    cancelPolicy: 'always_local',
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: false,
    refModes: [],
    description: '本地音视频 AI 剪辑伴侣进程组'
  },
  'lip-sync-runner': {
    cancelPolicy: 'always_local',
    aspectRatios: ['9:16', '16:9'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: false,
    refModes: [],
    description: '本地数字人唇形对齐进程组'
  },
  'editor-projects': {
    cancelPolicy: 'always_local',
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolutionTiers: ['1080p', '2k'],
    durationSecs: [],
    supportsSeed: false,
    refModes: [],
    description: '本地多轨合成与导出流'
  }
};

/**
 * 获取指定模型或协议的取消策略
 */
export function getModelCancelPolicy(modelOrProtocol: string): CancelPolicy {
  const norm = String(modelOrProtocol || '').toLowerCase().trim();
  for (const [key, cap] of Object.entries(MODEL_CAPABILITIES_MAP)) {
    if (norm === key.toLowerCase() || norm.includes(key.toLowerCase())) {
      return cap.cancelPolicy;
    }
  }
  if (norm.includes('local') || norm.includes('clip') || norm.includes('ffmpeg') || norm.includes('lip')) {
    return 'always_local';
  }
  if (norm.includes('wan') || norm.includes('dashscope') || norm.includes('ark') || norm.includes('seedance')) {
    return 'vendor_pending_only';
  }
  return 'queue_only';
}

/**
 * 判断指定模型在给定的生命周期阶段是否可取消
 */
export function isModelCancellableInStage(modelOrProtocol: string, stage: JobLifecycleStage): boolean {
  if (stage === 'succeeded' || stage === 'failed' || stage === 'cancelled') {
    return false;
  }
  if (stage === 'queued') {
    return true;
  }
  const policy = getModelCancelPolicy(modelOrProtocol);
  if (policy === 'always_local') {
    // 本地算力直到 saving 收尾之前均可由 SIGKILL 强杀
    return stage !== 'saving';
  }
  if (policy === 'vendor_pending_only') {
    // 提交期支持 Deferred Cancel，云端排队期支持真取消；进入 running 立即不可逆
    return stage === 'submitting' || stage === 'vendor_pending';
  }
  // queue_only 进入 submitting 瞬间即不可逆
  return false;
}

/**
 * 获取模型完整能力项
 */
export function getModelCapabilities(modelOrProtocol: string): ModelCapabilities {
  const norm = String(modelOrProtocol || '').toLowerCase().trim();
  for (const [key, cap] of Object.entries(MODEL_CAPABILITIES_MAP)) {
    if (norm === key.toLowerCase() || norm.includes(key.toLowerCase())) {
      return cap;
    }
  }
  return {
    cancelPolicy: getModelCancelPolicy(norm),
    aspectRatios: COMMON_ASPECT_RATIOS,
    resolutionTiers: ['1080p'],
    durationSecs: [5],
    supportsSeed: true,
    refModes: ['subject', 'style'],
    description: '通用生成模型'
  };
}

/**
 * 校验 ComposerDraft 是否合法（严格 WYSIWYG 规则）
 * 1. 挂载素材必须具备有效 FID 与 URL；
 * 2. 严禁静默 fallback 替换；
 */
export function validateComposerDraft(draft: ComposerDraft): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!draft) {
    return { valid: false, errors: ['草稿对象为空'] };
  }
  if (!draft.prompt && (!draft.assets || draft.assets.length === 0)) {
    errors.push('提示词与参考图不能同时为空');
  }
  if (Array.isArray(draft.assets)) {
    for (let i = 0; i < draft.assets.length; i++) {
      const a = draft.assets[i];
      if (!a || (!a.fid && !a.url)) {
        errors.push(`第 ${i + 1} 张参考图未包含有效 FID 或 URL`);
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 生成提交不可变冻结快照 FrozenSubmitSnapshot
 */
export function createFrozenSubmitSnapshot(draft: ComposerDraft): FrozenSubmitSnapshot {
  const deepCloned: ComposerDraft = JSON.parse(JSON.stringify(draft));
  const rawString = JSON.stringify(deepCloned);
  let hashVal = 0;
  for (let i = 0; i < rawString.length; i++) {
    hashVal = ((hashVal << 5) - hashVal + rawString.charCodeAt(i)) | 0;
  }
  const hash = Math.abs(hashVal).toString(16).padStart(8, '0');
  const now = Date.now();
  return {
    snapshotId: `snap_${now}_${hash}`,
    frozenAt: now,
    draft: deepCloned,
    hash
  };
}
