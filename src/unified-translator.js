/**
 * 双向统一转接层 (Bidirectional Unified Translation Layer)
 *
 * 核心职责：
 * 1. 对客暴露唯一标准词表 (Canonical Vocabulary)：屏蔽不同模型对同一概念的异构命名
 *    （如 ratio vs aspect_ratio、duration vs seconds vs Duration、size vs resolution、extra_body.image vs image vs content[]）。
 * 2. 前后端同源条件联动计算 (evaluateModelRules)：处理模型独有参数与模式硬约束
 *    （如 Seedance 2.5 首尾帧/编辑锁定 ratio=adaptive、编辑锁定 duration=-1、样片锁定 480p、Seedream 5.0 透明底锁定单张参考图+png、图层拆分切换 size=auto）。
 * 3. 提示词方言三开关编译 (compileModelDialect)：自动转译 @图片N / @视频N / @音频N、<bbox> 坐标框与负向词通道。
 * 4. 声明式字段映射与换算表展开 (applyDeclarativeOptionMap)：借鉴 ZCode @zcode/model-option-map 的 JSON Merge Patch 思想，
 *    统一执行 direct（同名直传）、rename（路径重命名如 extra_body.response_format）、cast（类型强转如 seconds 字符串）、table_lookup（二维查表换算）与 template_patch。
 */

const CANONICAL_VOCABULARY = {
  mode: {
    key: 'mode',
    label: '生成模式',
    type: 'enum',
    tier: 'common',
    aliases: ['genMode', 'gen_mode', 'client_mode', 'schemaMode'],
    description: '统一生成子模式标识（如 text_to_image, image_to_image, layer_split, text_to_video, first_last_frame, omni_reference, video_edit, video_extend）',
  },
  size: {
    key: 'size',
    label: '分辨率/尺寸档',
    type: 'enum',
    tier: 'common',
    aliases: ['resolution', 'image_size', 'sizePreset'],
    description: '生图尺寸档（1K/1.5K/2K/3K/4K/auto）或视频清晰度档（480p/720p/1080p/4k）',
  },
  ratio: {
    key: 'ratio',
    label: '宽高比',
    type: 'enum',
    tier: 'common',
    aliases: ['aspect_ratio', 'aspectRatio', 'aspect', 'expand_ratio'],
    description: '统一画幅宽高比（16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3, 21:9, adaptive）',
  },
  duration: {
    key: 'duration',
    label: '时长(秒)',
    type: 'duration',
    tier: 'common',
    aliases: ['seconds', 'Duration', 'durationSec', 'durationSeconds'],
    description: '视频或音频生成秒数（整数秒，-1 代表智能时长）',
  },
  generate_audio: {
    key: 'generate_audio',
    label: '生成同步音频',
    type: 'boolean',
    tier: 'common',
    aliases: ['sync_audio', 'enable_audio'],
    description: '视频生成时是否同步生成环境音/配音/音效',
  },
  layer_decomposition: {
    key: 'layer_decomposition',
    label: '图层拆分',
    type: 'boolean',
    tier: 'common',
    aliases: ['decompose', 'layerDecomposition'],
    description: 'Seedream 5.0 Pro/Flash 专属：将输入图像拆分为底图与多个独立透明 PNG 图层',
  },
  max_images: {
    key: 'max_images',
    label: '连拍组图张数',
    type: 'number',
    tier: 'common',
    aliases: ['n', 'maxImages'],
    description: 'Seedream 5.0 Lite / 4.5 组图最大输出张数（1 为单张，2~15 自动开启组图模式）',
  },
  background: {
    key: 'background',
    label: '背景通道',
    type: 'enum',
    tier: 'advanced',
    aliases: ['transparent_background'],
    description: 'opaque（不透明）或 transparent（透明 PNG 通道，需 1 张参考图）',
  },
  output_format: {
    key: 'output_format',
    label: '输出文件格式',
    type: 'enum',
    tier: 'advanced',
    aliases: ['format', 'Format', 'outputFormat'],
    description: '生图 jpeg/png；视频 mp4/mov；音乐 mp3/wav',
  },
  response_format: {
    key: 'response_format',
    label: '返回数据格式',
    type: 'enum',
    tier: 'advanced',
    aliases: ['responseFormat'],
    description: 'url 或 b64_json（Agnes 图像自动映射至 extra_body.response_format）',
  },
  watermark: {
    key: 'watermark',
    label: 'AI 水印',
    type: 'boolean',
    tier: 'advanced',
    aliases: ['AigcWatermark'],
    description: '是否在生成产物中保留 AI 水印',
  },
  seed: {
    key: 'seed',
    label: '随机种子',
    type: 'number',
    tier: 'advanced',
    aliases: [],
    description: '固定随机种子可复现结果，-1 表示随机',
  },
  return_last_frame: {
    key: 'return_last_frame',
    label: '返回视频尾帧',
    type: 'boolean',
    tier: 'advanced',
    aliases: ['returnLastFrame'],
    description: '返回视频尾帧图片 URL，便于连续生成多镜头接力视频',
  },
  draft: {
    key: 'draft',
    label: '样片预览模式(Draft)',
    type: 'boolean',
    tier: 'advanced',
    aliases: ['is_draft'],
    description: 'Seedance 2.5 专属：低成本快速生成 480p 预览样片，满意后可用 draft_task_id 转正片',
  },
  priority: {
    key: 'priority',
    label: '队列优先级',
    type: 'number',
    tier: 'advanced',
    aliases: [],
    description: '方舟队列调度优先级（0~9）',
  },
  omni_reference_task_type: {
    key: 'omni_reference_task_type',
    label: '全能参考子任务类型',
    type: 'enum',
    tier: 'advanced',
    aliases: [],
    description: 'Seedance 2.5 专属：auto / reference / edit / extend',
  },
  camera_fixed: {
    key: 'camera_fixed',
    label: '固定机位',
    type: 'boolean',
    tier: 'advanced',
    aliases: ['cameraFixed'],
    description: '是否锁定摄影机运动',
  },
  web_search: {
    key: 'web_search',
    label: '联网搜索增强',
    type: 'boolean',
    tier: 'advanced',
    aliases: ['enable_web_search', 'webSearch'],
    description: '自动组装为方舟标准 tools: [{ type: "web_search" }]',
  },
  optimize_prompt_mode: {
    key: 'optimize_prompt_options.mode',
    label: '厂商提示词自动优化',
    type: 'enum',
    tier: 'advanced',
    aliases: ['prompt_priority', 'optimize_prompt_mode'],
    description: 'off（关闭不传）/ standard（标准）/ fast（极速，仅 Seedream 5.0 Pro 支持）',
  },
  thinking: {
    key: 'thinking',
    label: '深度思考模式',
    type: 'enum',
    tier: 'common',
    aliases: ['enable_thinking', 'deepThinking'],
    description: 'LLM 思考模式：enabled / disabled / auto',
  },
  reasoning_effort: {
    key: 'reasoning_effort',
    label: '思考深度档位',
    type: 'enum',
    tier: 'advanced',
    aliases: ['thinking_level'],
    description: 'none / minimal / low / medium / high / xhigh / max',
  },
};

function setDeepField(target, fieldPath, value) {
  if (!target || !fieldPath) return;
  const parts = String(fieldPath).split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
      cur[p] = {};
    }
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function getDeepField(target, fieldPath) {
  if (!target || !fieldPath) return undefined;
  return String(fieldPath)
    .split('.')
    .reduce((acc, part) => (acc != null ? acc[part] : undefined), target);
}

function deleteDeepField(target, fieldPath) {
  if (!target || !fieldPath) return;
  const parts = String(fieldPath).split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') return;
    cur = cur[p];
  }
  delete cur[parts[parts.length - 1]];
}

function uniqueNonEmptyStrings(list) {
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    if (!item) continue;
    const s = String(item).trim();
    if (!s || s === 'undefined' || s === 'null' || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * 1. 将客户端或旧接口传入的任意参数归一化为 Canonical 标准结构
 */
function normalizeCanonicalInput(rawInput = {}, modelContract = null) {
  const inp = rawInput || {};
  const merged = {
    ...(inp.params || {}),
    ...(inp.extras || {}),
    ...(inp.values || {}),
    ...inp,
  };

  const values = {};

  // 先复制所有原始键值对
  for (const [k, v] of Object.entries(merged)) {
    if (['params', 'extras', 'values', 'refs', 'region', 'modelContract'].includes(k)) continue;
    if (v !== undefined) values[k] = v;
  }

  // 归一化标准词表别名 -> 标准词与模型契约声明键双向同步
  const sizeVal = merged.size ?? merged.resolution ?? merged.image_size ?? merged.sizePreset;
  if (sizeVal !== undefined) {
    values.size = sizeVal;
    if (values.resolution === undefined) values.resolution = sizeVal;
  }

  const ratioVal = merged.ratio ?? merged.aspect_ratio ?? merged.aspectRatio ?? merged.aspect ?? merged.expand_ratio;
  if (ratioVal !== undefined) {
    values.ratio = ratioVal;
    if (values.aspect_ratio === undefined) values.aspect_ratio = ratioVal;
  }

  const durVal = merged.duration ?? merged.seconds ?? merged.Duration ?? merged.durationSec ?? merged.durationSeconds;
  if (durVal !== undefined && durVal !== '') {
    const numDur = Number(durVal);
    values.duration = Number.isFinite(numDur) ? numDur : durVal;
    if (values.seconds === undefined) values.seconds = values.duration;
    if (values.Duration === undefined) values.Duration = values.duration;
  }

  const decompVal = merged.layer_decomposition ?? merged.decompose ?? merged.layerDecomposition;
  if (decompVal !== undefined) {
    values.layer_decomposition = Boolean(decompVal);
  }

  if (merged.transparentBackground === true && !values.background) {
    values.background = 'transparent';
  }

  const outFmt = merged.output_format ?? merged.format ?? merged.Format ?? merged.outputFormat;
  if (outFmt !== undefined && outFmt !== '') {
    values.output_format = String(outFmt).toLowerCase();
  }

  const optMode =
    merged['optimize_prompt_options.mode'] ??
    merged.optimize_prompt_options?.mode ??
    merged.prompt_priority ??
    merged.optimize_prompt_mode;
  if (optMode !== undefined) {
    values['optimize_prompt_options.mode'] = optMode;
  }

  const webSearchVal = merged.web_search ?? merged.enable_web_search ?? merged.webSearch;
  if (webSearchVal !== undefined) {
    values.web_search = Boolean(webSearchVal);
  }

  const modeVal = merged.mode ?? merged.genMode ?? merged.gen_mode ?? merged.client_mode ?? merged.schemaMode ?? '';
  if (modeVal) {
    values.mode = String(modeVal);
  }

  // 归一化多模态参考槽位 refs
  const rawRefs = inp.refs && typeof inp.refs === 'object' && !Array.isArray(inp.refs) ? inp.refs : {};
  const imageCandidates = [
    ...(Array.isArray(rawRefs.images) ? rawRefs.images : []),
    ...(Array.isArray(inp.arkImages) ? inp.arkImages : []),
    ...(inp.image ? (Array.isArray(inp.image) ? inp.image : [inp.image]) : []),
    ...(inp.image_data_url ? [inp.image_data_url] : []),
    ...(Array.isArray(inp.extra_image_data_urls) ? inp.extra_image_data_urls : []),
    ...(Array.isArray(inp.images) ? inp.images : []),
    ...(Array.isArray(inp.imageUrls) ? inp.imageUrls : []),
    ...(Array.isArray(inp.image_urls) ? inp.image_urls : []),
    ...(Array.isArray(merged.images) ? merged.images : []),
    ...(Array.isArray(merged.imageUrls) ? merged.imageUrls : []),
    ...(Array.isArray(merged.image_urls) ? merged.image_urls : []),
  ];

  const videoCandidates = [
    ...(Array.isArray(rawRefs.videos) ? rawRefs.videos : []),
    ...(inp.videoUrl ? [inp.videoUrl] : []),
    ...(inp.video_url ? [inp.video_url] : []),
    ...(Array.isArray(inp.videoUrls) ? inp.videoUrls : []),
    ...(Array.isArray(inp.videos) ? inp.videos : []),
  ];

  const audioCandidates = [
    ...(Array.isArray(rawRefs.audios) ? rawRefs.audios : []),
    ...(inp.audioUrl ? [inp.audioUrl] : []),
    ...(inp.audio_url ? [inp.audio_url] : []),
    ...(Array.isArray(inp.audioUrls) ? inp.audioUrls : []),
    ...(Array.isArray(inp.audios) ? inp.audios : []),
  ];

  const firstFrame = rawRefs.first_frame || inp.firstFrame || inp.first_frame || merged.firstFrame || merged.first_frame || null;
  const lastFrame = rawRefs.last_frame || inp.lastFrame || inp.last_frame || merged.lastFrame || merged.last_frame || null;
  const draftTaskId = rawRefs.draft_task_id || inp.draftTaskId || inp.draft_task_id || merged.draft_task_id || null;

  const refs = {
    first_frame: firstFrame ? String(firstFrame).trim() : null,
    last_frame: lastFrame ? String(lastFrame).trim() : null,
    images: uniqueNonEmptyStrings(imageCandidates),
    videos: uniqueNonEmptyStrings(videoCandidates),
    audios: uniqueNonEmptyStrings(audioCandidates),
    draft_task_id: draftTaskId ? String(draftTaskId).trim() : null,
    portrait_assets: Array.isArray(merged.portrait_assets) ? merged.portrait_assets : [],
  };

  const region = {
    bbox: merged.bbox || inp.region?.bbox || '',
    point: merged.point || inp.region?.point || '',
    mask: merged.mask || merged.mask_url || merged.maskUrl || inp.region?.mask || null,
  };

  return {
    modelId: modelContract?.id || inp.modelId || inp.model || '',
    vendorModelId: modelContract?.vendor_model_id || inp.model || '',
    mode: values.mode || '',
    prompt: String(inp.editablePrompt ?? inp.prompt ?? merged.prompt ?? '').trim(),
    optimizedPrompt: inp.optimizedPrompt !== undefined ? inp.optimizedPrompt : null,
    negativePrompt: String(inp.negativePrompt ?? inp.negative_prompt ?? merged.negativePrompt ?? merged.negative_prompt ?? '').trim(),
    values,
    refs,
    region,
  };
}

/**
 * 2. 前后端同源的条件规则计算引擎 (evaluateModelRules)
 * 支持：
 * - when: { key: val } 或 { mode_in: [...] } 或 { param_equals: { ... } }
 * - set / effect.force: 强制设定参数值
 * - lock / then.lock_params: 锁定参数（前端置灰、后端覆写）
 * - effect.suppress: 抑制某参数使其不进入请求体与提示词
 * - effect.size_options / effect.size_default: 动态改写可选档位与默认值
 * - effect.require_single_image: 强校验单张参考图
 */
function evaluateModelRules(modelContract, canonicalInput) {
  const contract = modelContract || {};
  const rules = Array.isArray(contract.conditional_rules) ? contract.conditional_rules : [];
  const values = { ...(canonicalInput?.values || {}) };
  const mode = canonicalInput?.mode || values.mode || '';

  const activeRuleTypes = new Set();
  const suppressedKeys = new Set();
  const lockedKeys = new Set();
  const forcedValues = {};
  const dynamicOptions = {};
  const dynamicDefaults = {};
  const lockReasons = {};
  let requireSingleImage = false;

  for (const rule of rules) {
    if (!rule || !rule.when) continue;
    let match = true;
    for (const [k, v] of Object.entries(rule.when)) {
      if (k === 'mode_in' && Array.isArray(v)) {
        if (!v.includes(mode)) {
          match = false;
          break;
        }
      } else if (k === 'param_equals' && v && typeof v === 'object') {
        for (const [pk, pv] of Object.entries(v)) {
          if (values[pk] !== pv) {
            match = false;
            break;
          }
        }
      } else if (k === 'mode') {
        if (mode !== v && values.mode !== v) {
          match = false;
          break;
        }
      } else if (values[k] !== v) {
        match = false;
        break;
      }
    }

    if (!match) continue;

    if (rule.type || rule.id) activeRuleTypes.add(rule.type || rule.id);

    // 兼容 { set: {...}, lock: [...] } 与 { effect: { force, suppress, ... } } 与 { then: { lock_params } }
    if (rule.set && typeof rule.set === 'object') {
      Object.assign(forcedValues, rule.set);
      Object.assign(values, rule.set);
    }
    if (Array.isArray(rule.lock)) {
      for (const lk of rule.lock) {
        lockedKeys.add(lk);
        if (rule.reason) lockReasons[lk] = rule.reason;
      }
    }
    if (rule.then && typeof rule.then === 'object') {
      if (rule.then.lock_params && typeof rule.then.lock_params === 'object') {
        Object.assign(forcedValues, rule.then.lock_params);
        Object.assign(values, rule.then.lock_params);
        for (const lk of Object.keys(rule.then.lock_params)) {
          lockedKeys.add(lk);
          if (rule.then.reason || rule.reason) lockReasons[lk] = rule.then.reason || rule.reason;
        }
      }
    }
    if (rule.effect && typeof rule.effect === 'object') {
      if (Array.isArray(rule.effect.suppress)) {
        rule.effect.suppress.forEach((sk) => suppressedKeys.add(sk));
      }
      if (rule.effect.force && typeof rule.effect.force === 'object') {
        Object.assign(forcedValues, rule.effect.force);
        Object.assign(values, rule.effect.force);
        for (const fk of Object.keys(rule.effect.force)) {
          lockedKeys.add(fk);
          if (rule.reason) lockReasons[fk] = rule.reason;
        }
      }
      if (Array.isArray(rule.effect.size_options)) {
        dynamicOptions.size = rule.effect.size_options;
      }
      if (rule.effect.size_default !== undefined) {
        dynamicDefaults.size = rule.effect.size_default;
      }
      if (rule.effect.require_single_image) {
        requireSingleImage = true;
      }
    }
  }

  return {
    values,
    activeRuleTypes,
    suppressedKeys,
    lockedKeys,
    forcedValues,
    dynamicOptions,
    dynamicDefaults,
    lockReasons,
    requireSingleImage,
  };
}

/**
 * 3. 提示词方言编译器 (compileModelDialect)
 * 将统一的 @图片1 / @图1 / @视频1 / @音频1、选区坐标与负向词编译为目标模型方言
 */
function compileModelDialect({
  prompt = '',
  negativePrompt = '',
  dialect = {},
  mode = '',
  modelId = '',
  region = {},
}) {
  let text = String(prompt || '').trim();
  const neg = String(negativePrompt || '').trim();
  const idLower = String(modelId || '').toLowerCase();
  const refSyntax = dialect?.ref_syntax || (idLower.includes('agnes') ? '<Picture N>' : idLower.includes('seedance') ? '@图片N' : '图N');
  const regionMode = dialect?.region_mode || 'coords_bbox';
  const negativeMode = dialect?.negative_mode || 'append_prompt';

  // 1) 参考素材标记转译
  if (refSyntax === '<Picture N>') {
    text = text.replace(/@(?:图片|图)(\d+)(?:\[[^\]]*\])?/g, '<Picture $1>');
    text = text.replace(/@视频(\d+)(?:\[[^\]]*\])?/g, '<Video $1>');
    text = text.replace(/@音频(\d+)(?:\[[^\]]*\])?/g, '<Audio $1>');
  } else if (refSyntax === '@图片N') {
    text = text.replace(/@图(\d+)(?:\[[^\]]*\])?/g, '@图片$1');
    text = text.replace(/@图片(\d+)\[[^\]]*\]/g, '@图片$1');
    text = text.replace(/@视频(\d+)\[[^\]]*\]/g, '@视频$1');
    text = text.replace(/@音频(\d+)\[[^\]]*\]/g, '@音频$1');
  } else if (refSyntax === '图N') {
    text = text.replace(/@(?:图片|图)(\d+)/g, '图$1');
    text = text.replace(/@视频(\d+)/g, '视频$1');
    text = text.replace(/@音频(\d+)/g, '音频$1');
  } else if (idLower.includes('omni')) {
    if (mode === 'first_last_frame') {
      text = text.replace(/@(?:图片|图)1/g, '<FIRST_FRAME>');
      text = text.replace(/@(?:图片|图)2/g, '<LAST_FRAME>');
    }
    text = text.replace(/@(?:图片|图)(\d+)/g, (_, n) => `<IMAGE_REF_${Number(n) - 1}>`);
    text = text.replace(/@视频(\d+)/g, (_, n) => `<VIDEO_REF_${Number(n) - 1}>`);
    text = text.replace(/@音频(\d+)/g, (_, n) => `<AUDIO_REF_${Number(n) - 1}>`);
  }

  // 2) 选区坐标注入（当参数中有 bbox / point 且正文中尚未包含时）
  if (regionMode === 'coords_bbox' && region?.bbox) {
    const cleanBbox = String(region.bbox).trim().replace(/,/g, ' ');
    if (cleanBbox && !text.includes('<bbox>')) {
      text = `${text} 图中 <bbox>${cleanBbox}</bbox> 区域`.trim();
    }
  }
  if ((regionMode === 'coords_bbox' || regionMode === 'coords_point') && region?.point) {
    const cleanPt = String(region.point).trim().replace(/,/g, ' ');
    if (cleanPt && !text.includes('<point>')) {
      text = `${text} 图中 <point>${cleanPt}</point> 位置`.trim();
    }
  }

  // 3) 负向词通道处理
  let finalNegative = '';
  if (neg) {
    if (negativeMode === 'append_prompt') {
      if (!text.includes(neg.slice(0, 12))) {
        text = `${text}\n【严禁出现】：${neg}。`;
      }
    } else if (negativeMode === 'field') {
      finalNegative = neg;
    }
  }

  return {
    prompt: text.trim(),
    negative_prompt: finalNegative,
  };
}

/**
 * 4. 执行值类型转换与格式化
 */
function transformFieldValue(val, paramSpec = {}) {
  if (val === undefined || val === null) return val;
  let out = val;
  if (paramSpec.cast === 'string') {
    out = String(out);
  } else if (paramSpec.cast === 'number' || paramSpec.cast === 'integer') {
    const n = Number(out);
    if (Number.isFinite(n)) out = paramSpec.cast === 'integer' ? Math.round(n) : n;
  } else if (paramSpec.cast === 'boolean') {
    out = Boolean(out);
  }
  if (typeof out === 'string') {
    if (paramSpec.transform === 'uppercase') out = out.toUpperCase();
    else if (paramSpec.transform === 'lowercase') out = out.toLowerCase();
  }
  return out;
}

module.exports = {
  CANONICAL_VOCABULARY,
  setDeepField,
  getDeepField,
  deleteDeepField,
  uniqueNonEmptyStrings,
  normalizeCanonicalInput,
  evaluateModelRules,
  compileModelDialect,
  transformFieldValue,
};
