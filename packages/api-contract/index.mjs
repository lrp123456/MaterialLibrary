/**
 * @mls/api-contract · 统一模型能力与取消策略契约 (ESM 导出)
 */

export const COMMON_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
export const COMMON_RESOLUTIONS = ['720p', '1080p', '2k', '4k'];
export const COMMON_DURATIONS = [5, 10];
export const COMMON_REF_MODES = ['style', 'subject', 'composition', 'inpaint', 'outpaint'];

export const MODEL_CAPABILITIES_MAP = {
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
  'style_transfer': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: false,
    refModes: ['style'],
    description: '单图风格迁移管线'
  },
  'region_inpaint': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutionTiers: ['1080p'],
    durationSecs: [],
    supportsSeed: false,
    refModes: ['inpaint'],
    description: '选区消除与局部重绘'
  },
  'clarity_upscale': {
    cancelPolicy: 'queue_only',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutionTiers: ['2k', '4k'],
    durationSecs: [],
    supportsSeed: false,
    refModes: [],
    description: '超分高清修复'
  },

  // ===== 2. vendor_pending_only (具备云端取消端点，仅在云端排队时可取消，一旦运行不可逆) =====
  'bailian_wanx': {
    cancelPolicy: 'vendor_pending_only',
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolutionTiers: ['720p', '1080p'],
    durationSecs: [5],
    supportsSeed: true,
    refModes: ['subject'],
    description: '阿里云百炼万相视频生成，云端 PENDING 阶段支持取消'
  },
  'ark_video': {
    cancelPolicy: 'vendor_pending_only',
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolutionTiers: ['720p', '1080p'],
    durationSecs: [5, 10],
    supportsSeed: true,
    refModes: ['subject', 'composition'],
    description: '火山方舟视频生成，云端 PENDING/QUEUED 阶段支持取消'
  },
  'kling_async': {
    cancelPolicy: 'vendor_pending_only',
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolutionTiers: ['720p', '1080p'],
    durationSecs: [5, 10],
    supportsSeed: true,
    refModes: ['subject'],
    description: '快手可灵异步视频任务，排队阶段支持取消'
  },
  'minimax_video': {
    cancelPolicy: 'vendor_pending_only',
    aspectRatios: ['16:9', '9:16'],
    resolutionTiers: ['720p', '1080p'],
    durationSecs: [5, 6],
    supportsSeed: false,
    refModes: ['subject'],
    description: 'MiniMax 海螺视频生成，云端排队支持取消'
  },

  // ===== 3. always_local (本地 GPU 显存推理 / 本地进程执行，全生命周期可 SIGKILL) =====
  'local_wan2_1': {
    cancelPolicy: 'always_local',
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolutionTiers: ['720p', '1080p'],
    durationSecs: [5],
    supportsSeed: true,
    refModes: ['subject', 'style'],
    description: '本地 Wan2.1 显存推理，全生命周期支持通过 PGID 彻底杀死释放显存'
  },
  'local_asr_whisper': {
    cancelPolicy: 'always_local',
    aspectRatios: [],
    resolutionTiers: [],
    durationSecs: [],
    supportsSeed: false,
    refModes: [],
    description: '本地 Whisper ASR 语音识别进程'
  },
  'local_lip_sync': {
    cancelPolicy: 'always_local',
    aspectRatios: ['16:9', '9:16'],
    resolutionTiers: ['720p', '1080p'],
    durationSecs: [5, 10],
    supportsSeed: false,
    refModes: ['subject'],
    description: '本地对口型算法推理进程'
  },
  'local_ffmpeg': {
    cancelPolicy: 'always_local',
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolutionTiers: ['720p', '1080p', '2k', '4k'],
    durationSecs: [],
    supportsSeed: false,
    refModes: [],
    description: '本地 FFmpeg 视频转码与抽帧进程'
  }
};

export function getModelCancelPolicy(modelOrProtocol) {
  const norm = String(modelOrProtocol || '').toLowerCase().trim();
  for (const [key, cap] of Object.entries(MODEL_CAPABILITIES_MAP)) {
    if (norm === key.toLowerCase() || norm.includes(key.toLowerCase())) {
      return cap.cancelPolicy;
    }
  }
  if (norm.includes('local') || norm.includes('ffmpeg') || norm.includes('whisper')) {
    return 'always_local';
  }
  if (norm.includes('wan') || norm.includes('ark') || norm.includes('kling') || norm.includes('minimax')) {
    return 'vendor_pending_only';
  }
  return 'queue_only';
}

export function isModelCancellableInStage(modelOrProtocol, stage) {
  if (stage === 'succeeded' || stage === 'failed' || stage === 'cancelled') {
    return false;
  }
  if (stage === 'queued') {
    return true;
  }
  const policy = getModelCancelPolicy(modelOrProtocol);
  if (policy === 'always_local') {
    return stage !== 'saving';
  }
  if (policy === 'vendor_pending_only') {
    return stage === 'submitting' || stage === 'vendor_pending';
  }
  return false;
}

export function getModelCapabilities(modelOrProtocol) {
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

export function validateComposerDraft(draft) {
  const errors = [];
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

export function createFrozenSubmitSnapshot(draft) {
  const deepCloned = JSON.parse(JSON.stringify(draft));
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

export default {
  version: '1.0.0',
  COMMON_ASPECT_RATIOS,
  COMMON_RESOLUTIONS,
  COMMON_DURATIONS,
  COMMON_REF_MODES,
  MODEL_CAPABILITIES_MAP,
  getModelCancelPolicy,
  isModelCancellableInStage,
  getModelCapabilities,
  validateComposerDraft,
  createFrozenSubmitSnapshot
};
