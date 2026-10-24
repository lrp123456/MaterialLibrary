/**
 * 统一多模态协议转换器与智能路由网关 (Unified Media Converters & CC-Switch ProviderRouter)
 *
 * 对齐文档真相源：
 * - 方舟-图片生成.md (Seedream 5.0 Pro / Flash / Lite / 4.5)
 * - 方舟-视频生成.md (Seedance 2.5 / 2.0 / 1.0)
 * - 方舟-文本生成.md & 方舟-文本生成2.md & 方舟-文件api.md (Responses API / Chat / Files API)
 * - agnes-图像.md (agnes-image-2.5-flash: extra_body.image & extra_body.response_format)
 * - agnes-视频.md (agnes-video-2.5-flash: mode=text|keyframe|reference, seconds string, /agnesapi poll)
 * - agnes-文本.md (agnes-3.0-flash: chat/completions, responses, messages)
 */
const {
  normalizeCanonicalInput,
  evaluateModelRules,
  compileModelDialect,
} = require('../unified-translator');
const { shapeVolcVideo } = require('../portrait-contract');

// ==================== 1. CC-Switch 风格熔断与故障转移路由器 ====================
class ProviderCircuitBreaker {
  constructor({ failureThreshold = 3, cooldownMs = 60000, openDurationMs = null } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = openDurationMs != null ? openDurationMs : cooldownMs;
    this.states = new Map(); // targetId -> { failures, successes, state, lastFailureAt, lastError }
  }

  _entry(id) {
    if (!this.states.has(id)) {
      this.states.set(id, {
        id,
        failures: 0,
        successes: 0,
        state: 'CLOSED',
        lastFailureAt: 0,
        lastError: '',
      });
    }
    return this.states.get(id);
  }

  canPass(id) { return this.canExecute(id); }

  canExecute(id) {
    const st = this._entry(id);
    if (st.state === 'CLOSED') return true;
    if (st.state === 'OPEN') {
      if (Date.now() - st.lastFailureAt >= this.cooldownMs) {
        st.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(id) {
    const st = this._entry(id);
    st.failures = 0;
    st.successes += 1;
    st.state = 'CLOSED';
    st.lastError = '';
  }

  recordFailure(id, errText = '') {
    const st = this._entry(id);
    st.failures += 1;
    st.lastFailureAt = Date.now();
    st.lastError = String(errText || '').slice(0, 200);
    if (st.failures >= this.failureThreshold) {
      st.state = 'OPEN';
    }
  }

  reset(id) {
    if (id) this.states.delete(id);
    else this.states.clear();
  }

  snapshot() {
    const out = {};
    for (const [k, v] of this.states.entries()) {
      out[k] = { ...v };
    }
    return out;
  }
}

const globalCircuitBreaker = new ProviderCircuitBreaker();

// ==================== 2. 专用媒体转换器注册表 ====================
const CONVERTER_SPECS = [
  {
    id: 'ark-seedream',
    name: '火山方舟 Seedream 图像转换器',
    modality: 'image',
    submit_path: '/images/generations',
    description: '支持 5.0 Pro/Flash 图层拆分(layer_decomposition)、透明底(background=transparent)、坐标框编辑(<bbox>)及 5.0 Lite 组图连拍与联网生图',
  },
  {
    id: 'agnes-image',
    name: 'Agnes Image 2.5 图像转换器',
    modality: 'image',
    submit_path: '/images/generations',
    description: '自动将参考图与 response_format 封装进 extra_body，剔除顶层非法字段，支持 1K~4K 全免费档位',
  },
  {
    id: 'ark-seedance-video',
    name: '火山方舟 Seedance 视频转换器',
    modality: 'video',
    submit_path: '/contents/generations/tasks',
    poll_path: '/contents/generations/tasks/{{taskId}}',
    description: '组装 content[] 多模态角色数组（first_frame/last_frame/reference_image/reference_video/reference_audio/draft_task）与 omni_reference_task_type',
  },
  {
    id: 'agnes-video',
    name: 'Agnes Video 2.5 视频转换器',
    modality: 'video',
    submit_path: '/v1/videos',
    poll_path: '/agnesapi?video_id={{taskId}}&model_name={{model}}',
    description: '自动映射 text/keyframe/reference 三模式、将时长转为字符串 seconds、转译 <Picture N>/<Audio N> 并对接 /agnesapi 轮询',
  },
  {
    id: 'doubao-music',
    name: '火山引擎豆包音乐转换器 (AK/SK)',
    modality: 'music',
    submit_action: 'GenBGMForTime / GenSongForTime',
    poll_action: 'QuerySong',
    description: '区分 BGM 纯音乐与人声歌曲，自动映射首字母大写的 Duration / Genre / Mood / Gender / Format',
  },
  {
    id: 'qwenimage-local',
    name: '本地 Qwen2.1-Image 转换器',
    modality: 'image',
    submit_path: '/api/qw/generate',
    poll_path: '/api/qw/tasks/{{taskId}}',
    description: '将尺寸档与宽高比换算为 32 倍数对齐的 width × height 像素值',
  },
  {
    id: 'openai-chat',
    name: '标准 Chat Completions 文本/视觉转换器',
    modality: 'chat',
    submit_path: '/chat/completions',
    description: '兼容 OpenAI / 方舟 / Agnes / LiteLLM 的 /chat/completions 协议，自动适配深度思考开关',
  },
  {
    id: 'openai-responses',
    name: '标准 Responses Agent 协议转换器',
    modality: 'chat',
    submit_path: '/responses',
    description: '支持方舟与 Agnes /responses 多轮状态续接(previous_response_id)、Web Search、图像旋转点选工具(image_process)、MCP 与 Files API 视频理解',
  },
  {
    id: 'messages-v1',
    name: 'Messages 协议转换器 (/v1/messages)',
    modality: 'chat',
    submit_path: '/messages',
    description: '支持顶层 system 字段与 thinking.budget_tokens 扩展思考预算',
  },
];

// ==================== 3. 方舟 Seedream 图像转换器 ====================
function convertArkSeedreamRequest({
  rawInput = {},
  modelContract = null,
  sizeTable = null,
}) {
  const canon = normalizeCanonicalInput(rawInput, modelContract);
  const ruleEval = evaluateModelRules(modelContract, canon);
  const merged = ruleEval.values;
  const vendorModel = canon.vendorModelId || 'doubao-seedream-5-0-flash-260915';
  const modelId = String(modelContract?.id || canon.modelId || '').toLowerCase();

  const isFlashOrPro5 =
    modelId === 'seedream5flash' ||
    modelId === 'seedream5pro' ||
    /seedream-5-0-(flash|pro)/i.test(vendorModel);
  const isPro5 = modelId === 'seedream5pro' || /seedream-5-0-pro/i.test(vendorModel);
  const isLite5 = modelId === 'seedream5lite' || /seedream-5-0-260128/i.test(vendorModel);
  const supportsSequential = isLite5 || modelId === 'seedream45' || /seedream-4-[05]/i.test(vendorModel);

  const compiled = compileModelDialect({
    prompt: canon.optimizedPrompt != null ? canon.optimizedPrompt : canon.prompt,
    negativePrompt: canon.negativePrompt,
    dialect: modelContract?.dialect,
    mode: canon.mode,
    modelId,
    region: canon.region,
  });

  let promptText = compiled.prompt;
  if (!promptText && !rawInput.allowEmptyPrompt) {
    throw new Error('[火山方舟 Seedream] prompt 为必填参数且不能为空');
  }
  if (isFlashOrPro5) {
    promptText = promptText.replace(/\s*画面比例\s*[\w:]+/g, '').trim();
  }

  const maxRefs = supportsSequential ? 14 : 10;
  const images = canon.refs.images.slice(0, maxRefs);

  const payload = {
    model: vendorModel,
    prompt: promptText,
    watermark: Boolean(merged.watermark ?? false),
    response_format: merged.response_format || 'url',
  };

  if (images.length > 0) {
    payload.image = images.length === 1 ? images[0] : images;
  }

  const isLayerDecomp = Boolean(merged.layer_decomposition || canon.mode === 'layer_split');
  if (isFlashOrPro5 && isLayerDecomp) {
    payload.layer_decomposition = true;
    const allowedDecomp = ['1K', '1.5K', '2K', 'auto'];
    const rawPassedSize =
      rawInput?.values?.size ??
      rawInput?.size ??
      rawInput?.layer_decomposition_size ??
      rawInput?.layerDecompositionSize ??
      rawInput?.extras?.layer_decomposition_size ??
      rawInput?.extras?.decompose_size ??
      '';
    const decompSize = String(rawPassedSize || '').trim() || 'auto';
    if (!allowedDecomp.includes(decompSize)) {
      throw new Error(`Seedream 5.0 图层分解 size 仅支持 1K, 1.5K, 2K, auto，收到: ${decompSize}`);
    }
    payload.size = decompSize;
  } else if (isFlashOrPro5) {
    const rawSizeStr = String(merged.size || '2K').trim();
    if (/^\d{3,4}\s*x\s*\d{3,4}$/i.test(rawSizeStr)) {
      payload.size = rawSizeStr.toLowerCase().replace(/\s+/g, '');
    } else {
      const { SEEDREAM_FLASH_SIZE_TABLE } = require('../models-contract');
      const table = sizeTable || modelContract?.table_mappings?.size_ratio || SEEDREAM_FLASH_SIZE_TABLE;
      const tier = rawSizeStr.toUpperCase();
      const ratio = merged.ratio || '1:1';
      const key = `${tier}_${ratio}`;
      const px = table[key];
      if (!px) {
        throw new Error(`Seedream Flash 换算表不支持尺寸档位和比例组合: ${key}`);
      }
      payload.size = px;
    }
  } else {
    // Seedream 5.0 Lite / 4.5
    const rawSizeStr = String(merged.size || '2K').trim();
    if (/^\d{3,4}\s*x\s*\d{3,4}$/i.test(rawSizeStr)) {
      payload.size = rawSizeStr.toLowerCase().replace(/\s+/g, '');
    } else if (['1K', '1.5K', '2K', '3K', '4K'].includes(rawSizeStr.toUpperCase())) {
      payload.size = rawSizeStr.toUpperCase();
    }
  }

  // 透明底与输出格式校验
  const isTransparent = merged.background === 'transparent';
  if (isTransparent) {
    if (images.length !== 1) {
      throw new Error(`[${modelContract?.name || 'Seedream 5.0 Flash'}] 透明背景必须且仅支持传入单张参考图`);
    }
    payload.background = 'transparent';
    payload.output_format = 'png';
  } else if (merged.background === 'opaque') {
    payload.background = 'opaque';
  }

  if (!isTransparent && merged.output_format && ['jpeg', 'png'].includes(String(merged.output_format).toLowerCase())) {
    if (isFlashOrPro5 || isLite5) {
      payload.output_format = String(merged.output_format).toLowerCase();
    }
  }

  // 组图连拍（仅 5.0 Lite / 4.5 支持）
  const seqMode = merged.sequential_image_generation || (Number(merged.max_images) > 1 ? 'auto' : null);
  if (supportsSequential && seqMode) {
    payload.sequential_image_generation = seqMode === 'auto' ? 'auto' : 'disabled';
    if (payload.sequential_image_generation === 'auto') {
      const maxAllowed = Math.max(1, 15 - images.length);
      const reqMax = Number(merged.max_images ?? merged.sequential_image_generation_options?.max_images ?? 3);
      const clamped = Number.isFinite(reqMax) ? Math.max(1, Math.min(maxAllowed, Math.round(reqMax))) : Math.min(3, maxAllowed);
      payload.sequential_image_generation_options = { max_images: clamped };
    }
  }

  // 联网搜索（仅 5.0 Lite 支持）
  if (isLite5 && merged.web_search === true) {
    payload.tools = [{ type: 'web_search' }];
  }

  // 厂商自动优化提示词
  const optMode = merged['optimize_prompt_options.mode'];
  if (optMode && optMode !== 'off') {
    if (optMode === 'fast' && !isPro5) {
      payload.optimize_prompt_options = { mode: 'standard' };
    } else {
      payload.optimize_prompt_options = { mode: optMode };
    }
  }

  if (merged.seed != null && Number(merged.seed) >= 0) {
    payload.seed = Number(merged.seed);
  }

  return {
    prompt: promptText,
    body: payload,
    canonical: canon,
    ruleEval,
  };
}

/**
 * 归一化 Seedream 响应（特别是 layer_decomposition 多图层拆解返回结构）
 */
function normalizeArkSeedreamResponse(rawResp = {}, opts = {}) {
  const dataList = Array.isArray(rawResp?.data) ? rawResp.data : [];
  const isDecomp = Boolean(opts?.layerDecomposition) || dataList.some((item) => item && (item.z_index !== undefined || item.bounding_box));
  const layers = dataList
    .map((item, idx) => {
      const z = item?.z_index ?? idx;
      return {
        index: z,
        z_index: z,
        role: isDecomp ? (z === 0 ? 'background' : `foreground_${z}`) : `image_${z + 1}`,
        label: item?.name || (isDecomp ? (z === 0 ? '底层背景 (Layer 0)' : `独立前景图层 #${z}`) : `生成图 #${z + 1}`),
        is_base_image: z === 0,
        name: item?.name || (z === 0 ? '原始底图' : `图层 #${z}`),
        description: item?.description || '',
        url: item?.url || '',
        b64_json: item?.b64_json || '',
        size: item?.size || '',
        width: item?.width || null,
        height: item?.height || null,
        bounding_box: item?.bounding_box || null,
        visible: true,
      };
    })
    .sort((a, b) => a.z_index - b.z_index);

  return {
    kind: isDecomp ? 'layer_stack' : 'multi_image',
    count: layers.length,
    is_layer_decomposition: isDecomp && layers.length > 0,
    layer_count: layers.length > 0 ? Math.max(0, layers.length - 1) : 0,
    layers,
    images: dataList.map((d) => ({
      url: d.url || '',
      b64_json: d.b64_json || '',
      size: d.size || '',
      z_index: d.z_index,
      bounding_box: d.bounding_box || null,
      name: d.name || '',
    })),
    usage: rawResp?.usage || null,
  };
}

// ==================== 4. Agnes Image 2.5 Flash 转换器 ====================
function convertAgnesImageRequest({
  rawInput = {},
  modelContract = null,
}) {
  const canon = normalizeCanonicalInput(rawInput, modelContract);
  const ruleEval = evaluateModelRules(modelContract, canon);
  const merged = ruleEval.values;

  const compiled = compileModelDialect({
    prompt: canon.optimizedPrompt != null ? canon.optimizedPrompt : canon.prompt,
    negativePrompt: canon.negativePrompt,
    dialect: modelContract?.dialect || { ref_syntax: '<Picture N>', region_mode: 'vlm_text', negative_mode: 'append_prompt' },
    mode: canon.mode,
    modelId: canon.modelId || 'agnes_image_2_5_flash',
    region: canon.region,
  });

  if (!compiled.prompt) {
    throw new Error('[Agnes Image] prompt 为必填参数且不能为空');
  }

  const VALID_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'];
  let ratio = String(merged.ratio || '1:1').trim();
  if (!VALID_RATIOS.includes(ratio)) ratio = '9:16';

  const VALID_SIZES = ['1K', '2K', '3K', '4K'];
  let size = String(merged.size3k || merged.size || '2K').toUpperCase().trim();
  if (!VALID_SIZES.includes(size)) size = '2K';

  const respFmt = merged.response_format === 'b64_json' ? 'b64_json' : 'url';
  const payload = {
    model: canon.vendorModelId || 'agnes-image-2.5-flash',
    prompt: compiled.prompt,
    size,
    ratio,
    extra_body: {
      response_format: respFmt,
      ...(rawInput?.extra_body || {}),
    },
  };

  if (merged.return_base64 === true) {
    payload.return_base64 = true;
  }

  const images = canon.refs.images.slice(0, 10);
  if (images.length > 0) {
    payload.extra_body.image = images.length === 1 ? images[0] : images;
  }

  // 严格遵守 agnes-图像.md：严禁在顶层携带 response_format / image / tags
  delete payload.response_format;
  delete payload.image;
  delete payload.tags;

  if (payload.first_frame) payload.first_frame_image = payload.first_frame;
  if (payload.last_frame) payload.last_frame_image = payload.last_frame;
  return {
    ...payload,
    prompt: compiled.prompt,
    body: payload,
    payload,
    canonical: canon,
    ruleEval,
  };
}

// ==================== 5. 方舟 Seedance 2.5 / 2.0 视频转换器 ====================
function convertArkSeedanceVideoRequest({
  rawInput = {},
  modelContract = null,
}) {
  const canon = normalizeCanonicalInput(rawInput, modelContract);
  const ruleEval = evaluateModelRules(modelContract, canon);
  const merged = ruleEval.values;
  const vendorModel = canon.vendorModelId || 'doubao-seedance-2-5-260628';
  const modelId = String(modelContract?.id || canon.modelId || '').toLowerCase();
  const isSeedance25 = modelId === 'seedance2_5' || /seedance-2-5/i.test(vendorModel);

  const compiled = compileModelDialect({
    prompt: canon.optimizedPrompt != null ? canon.optimizedPrompt : canon.prompt,
    negativePrompt: canon.negativePrompt,
    dialect: modelContract?.dialect || { ref_syntax: '@图片N', region_mode: 'vlm_text', negative_mode: 'append_prompt' },
    mode: canon.mode,
    modelId: modelId || 'seedance2_5',
    region: canon.region,
  });

  const portraits = canon.refs.portrait_assets || [];
  const promptText = portraits.length ? compiled.prompt : (compiled.prompt || '室内空间全景镜头平移漫游效果');

  // 若携带了方舟私域虚拟人像资产，优先复用经过严格校验的 shapeVolcVideo
  if (portraits.length > 0) {
    const shaped = shapeVolcVideo({
      isVolc: true,
      model: vendorModel,
      prompt: promptText,
      images: canon.refs.images,
      firstFrameUrl: canon.refs.first_frame || '',
      lastFrameUrl: canon.refs.last_frame || '',
      genMode: canon.mode,
      ratio: merged.ratio,
      duration: merged.duration,
      portraits,
    });
    if (shaped) {
      const out = { ...shaped };
      delete out.caption;
      return { prompt: promptText, body: out, canonical: canon, ruleEval };
    }
  }

  const content = [];
  if (promptText) {
    content.push({ type: 'text', text: promptText });
  }

  const mode = canon.mode || 'text_to_video';
  const maxImages = isSeedance25 ? 30 : 9;
  const maxVideos = isSeedance25 ? 10 : 3;
  const maxAudios = isSeedance25 ? 10 : 3;

  // 1) Draft 样片转正片模式 (Seedance 2.5 专属)
  if (canon.refs.draft_task_id && isSeedance25) {
    content.push({
      type: 'draft_task',
      draft_task: { id: canon.refs.draft_task_id },
    });
  } else if (mode === 'first_last_frame' || (canon.refs.first_frame && canon.refs.last_frame)) {
    const first = canon.refs.first_frame || canon.refs.images[0];
    const last = canon.refs.last_frame || canon.refs.images[1];
    if (first) content.push({ type: 'image_url', image_url: { url: first }, role: 'first_frame' });
    if (last) content.push({ type: 'image_url', image_url: { url: last }, role: 'last_frame' });
  } else if (mode === 'image_to_video' && canon.refs.images.length === 1 && !canon.refs.videos.length && !canon.refs.audios.length) {
    content.push({
      type: 'image_url',
      image_url: { url: canon.refs.first_frame || canon.refs.images[0] },
      role: 'first_frame',
    });
  } else {
    // 全能参考 (omni_reference) / 视频编辑 (video_edit) / 视频延长 (video_extend)
    const imgs = canon.refs.images.slice(0, maxImages);
    const vids = canon.refs.videos.slice(0, maxVideos);
    const auds = canon.refs.audios.slice(0, maxAudios);

    if (!isSeedance25 && auds.length > 0 && imgs.length === 0 && vids.length === 0) {
      throw new Error('[Seedance 2.0] 不支持单独输入音频，必须至少包含 1 张参考图或 1 个参考视频（Seedance 2.5 支持纯音频生视频）');
    }

    if (imgs.length === 1 && vids.length === 0 && auds.length === 0 && mode !== 'omni_reference') {
      content.push({ type: 'image_url', image_url: { url: imgs[0] } });
    } else {
      for (const u of imgs) {
        content.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' });
      }
    }
    for (const v of vids) {
      content.push({ type: 'video_url', video_url: { url: v }, role: 'reference_video' });
    }
    for (const a of auds) {
      content.push({ type: 'audio_url', audio_url: { url: a }, role: 'reference_audio' });
    }
  }

  const body = {
    model: vendorModel,
    content,
  };

  // 分辨率 resolution
  const rawRes = String(merged.resolution || merged.size || '720p').toLowerCase();
  const validRes = isSeedance25 ? ['480p', '720p', '1080p'] : ['480p', '720p', '1080p', '4k'];
  body.resolution = validRes.includes(rawRes) ? rawRes : '720p';

  // Draft 模式强制 480p
  if (isSeedance25 && merged.draft === true) {
    body.draft = true;
    body.resolution = '480p';
  }

  // 画幅 ratio
  let ratio = merged.ratio || (isSeedance25 ? 'adaptive' : '16:9');
  if (isSeedance25 && ['first_last_frame', 'video_edit', 'video_extend'].includes(mode)) {
    ratio = 'adaptive';
  }
  if (ratio) body.ratio = ratio;

  // 时长 duration
  const durNum = Number(merged.duration);
  const maxDur = isSeedance25 ? 30 : 15;
  if (isSeedance25 && mode === 'video_edit') {
    body.duration = -1;
  } else if (durNum === -1) {
    body.duration = -1;
  } else if (Number.isFinite(durNum) && durNum > 0) {
    body.duration = Math.max(4, Math.min(maxDur, Math.round(durNum)));
  }

  if (merged.generate_audio !== undefined) body.generate_audio = Boolean(merged.generate_audio);
  if (merged.watermark !== undefined) body.watermark = Boolean(merged.watermark);
  if (merged.return_last_frame !== undefined) body.return_last_frame = Boolean(merged.return_last_frame);
  if (merged.camera_fixed !== undefined && !isSeedance25) body.camera_fixed = Boolean(merged.camera_fixed);
  if (merged.seed != null && Number(merged.seed) >= 0) body.seed = Number(merged.seed);

  if (isSeedance25) {
    if (merged.output_format && ['mp4', 'mov'].includes(String(merged.output_format).toLowerCase())) {
      body.output_format = String(merged.output_format).toLowerCase();
    }
    const taskTypeMap = {
      video_edit: 'edit',
      video_extend: 'extend',
      omni_reference: 'reference',
    };
    const explicitTaskType = merged.omni_reference_task_type || taskTypeMap[mode];
    if (explicitTaskType && ['auto', 'reference', 'edit', 'extend'].includes(explicitTaskType)) {
      body.omni_reference_task_type = explicitTaskType;
    }
  }

  if (merged.priority != null && Number(merged.priority) >= 0) {
    body.priority = Math.max(0, Math.min(9, Math.round(Number(merged.priority))));
  }

  if (merged.web_search === true) {
    body.tools = [{ type: 'web_search' }];
  }

  return {
    prompt: promptText,
    body,
    canonical: canon,
    ruleEval,
  };
}

// ==================== 6. Agnes Video 2.5 Flash 转换器 ====================
function convertAgnesVideoRequest(arg = {}) {
  const modelContract = arg.modelContract || arg.contract || null;
  const rawInput = arg.rawInput || (arg.prompt !== undefined || arg.values !== undefined ? {
    prompt: arg.prompt,
    mode: arg.mode,
    values: arg.values,
    images: arg.images,
    audios: arg.audios,
  } : arg);
  const canon = normalizeCanonicalInput(rawInput, modelContract);
  const ruleEval = evaluateModelRules(modelContract, canon);
  const merged = ruleEval.values;

  if (canon.refs.videos.length > 0) {
    const err = new Error('[Agnes Video 2.5 Flash] 官方接口不支持传入参考视频 (videos is not supported)');
    err.code = 'free_tier';
    throw err;
  }

  const compiled = compileModelDialect({
    prompt: canon.optimizedPrompt != null ? canon.optimizedPrompt : canon.prompt,
    negativePrompt: canon.negativePrompt,
    dialect: modelContract?.dialect || { ref_syntax: '<Picture N>', region_mode: 'vlm_text', negative_mode: 'append_prompt' },
    mode: canon.mode,
    modelId: 'agnes_video_2_5_flash',
    region: canon.region,
  });

  if (!compiled.prompt) {
    throw new Error('[Agnes Video] prompt 为必填参数且不能为空');
  }

  const isHttp = (u) => u && (String(u).startsWith('http://') || String(u).startsWith('https://'));
  const images = canon.refs.images.filter(isHttp);
  const audios = canon.refs.audios.filter(isHttp);
  const firstFrame = isHttp(canon.refs.first_frame) ? canon.refs.first_frame : null;
  const lastFrame = isHttp(canon.refs.last_frame) ? canon.refs.last_frame : null;

  const clientMode = String(canon.mode || '');
  let mode = 'text';
  if (clientMode === 'first_last_frame' || clientMode === 'keyframe' || firstFrame || lastFrame) {
    mode = 'keyframe';
  } else if (
    images.length > 0 ||
    audios.length > 0 ||
    ['image_to_video', 'image_reference', 'omni_reference', 'reference'].includes(clientMode)
  ) {
    mode = 'reference';
  }

  const VALID_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
  let aspect_ratio = String(merged.aspect_ratio || merged.ratio || '16:9').trim();
  if (!VALID_RATIOS.includes(aspect_ratio)) {
    const err = new Error(`[Agnes Video] 画幅不支持「${aspect_ratio}」，可选：${VALID_RATIOS.join(' / ')}`);
    err.code = 'agnes_bad_ratio';
    throw err;
  }

  // 时长：官方仅支持 4–12 秒整数。越界必须显式报错，不能静默回退（否则前端显示 60s、实际却按 5s 生成）。
  const rawSec = merged.seconds ?? merged.duration ?? 5;
  const secNum = parseInt(String(rawSec), 10);
  if (isNaN(secNum) || secNum < 4 || secNum > 12) {
    const err = new Error(`[Agnes Video] 时长需在 4–12 秒之间（当前：${rawSec}），请调整时长参数后重试`);
    err.code = 'agnes_bad_duration';
    throw err;
  }
  const seconds = String(secNum);

  const payload = {
    model: canon.vendorModelId || 'agnes-video-2.5-flash',
    prompt: compiled.prompt,
    mode,
    size: '720P',
    aspect_ratio,
    seconds,
    n: 1,
  };

  if (merged.seed != null && Number(merged.seed) >= 0) {
    payload.seed = Number(merged.seed);
  }

  if (mode === 'keyframe') {
    const f1 = firstFrame || images[0] || null;
    const f2 = lastFrame || (firstFrame ? null : images[1]) || null;
    if (f1) payload.first_frame = f1;
    if (f2) payload.last_frame = f2;
    if (!payload.first_frame && !payload.last_frame) {
      const err = new Error('[Agnes Video 首尾帧] 需要至少一张首帧或尾帧图片（云端会自行拉取）。请重新上传首尾帧图片，或切换到「文生视频」模式');
      err.code = 'agnes_keyframe_missing';
      throw err;
    }
  } else if (mode === 'reference') {
    if (images.length > 0) payload.images = images.slice(0, 5);
    if (audios.length > 0) payload.audios = audios.slice(0, 3);
  }

  // 注意：Agnes Video 云端只接受 first_frame/last_frame，
  // 不接受 first_frame_image/last_frame_image（会 400 invalid_request），
  // 因此这里**不能**像图片协议那样补 *_image 别名字段。
  return {
    ...payload,
    prompt: compiled.prompt,
    body: payload,
    payload,
    canonical: canon,
    ruleEval,
  };
}

// ==================== 7. 方舟 Files API 预处理辅助器 (对齐《方舟-文件api.md》) ====================
function buildArkFileUploadMeta({ purpose = 'user_data', ttlDays = 7, videoFps = 1.0, maxVideoTokens = null, minFrames = null } = {}) {
  const fps = Math.max(0.2, Math.min(5.0, Number(videoFps) || 1.0));
  const videoCfg = { fps };
  if (maxVideoTokens != null && Number(maxVideoTokens) > 0) videoCfg.max_video_tokens = Number(maxVideoTokens);
  if (minFrames != null && Number(minFrames) > 0) videoCfg.min_frames = Number(minFrames);
  const expire_at = Math.floor(Date.now() / 1000) + Math.round((Number(ttlDays) || 7) * 86400);
  return {
    endpoint_path: '/files',
    purpose,
    expire_at,
    preprocess_configs: {
      video: videoCfg,
    },
  };
}

// ==================== 8. 统一转换调度入口 ====================
function inferConverterType(modelContract, fallbackId = '') {
  if (modelContract?.converter) return modelContract.converter;
  const id = String(modelContract?.id || modelContract?.vendor_model_id || fallbackId || '').toLowerCase();
  const capId = String(modelContract?.capability_id || '').toLowerCase();
  if (id.includes('seedream') || capId === 'ark_image') return 'ark-seedream';
  if (id.includes('agnes-image') || id.includes('agnes_image') || capId.includes('agnes_image')) return 'agnes-image';
  if (id.includes('seedance') || capId === 'ark_video') return 'ark-seedance-video';
  if (id.includes('agnes-video') || id.includes('agnes_video') || capId.includes('agnes_video')) return 'agnes-video';
  if (id.includes('bgm') || id.includes('song') || capId.includes('doubao_music')) return 'doubao-music';
  if (id.includes('qwen')) return 'qwenimage-local';
  return 'openai-chat';
}

/**
 * 发出前的唯一熔断选择。契约上的 failover_model_id 是唯一备选声明。
 * 主模型可以执行时原样返回。打开后只换一次备选契约，由调用方用同一份标准词再编译。
 */
function selectSubmitContract(contract, loadContract) {
  if (!contract || !contract.id) return { contract, switched: false };
  if (globalCircuitBreaker.canExecute(contract.id)) {
    return { contract, switched: false };
  }
  const backupId = String(contract.failover_model_id || '').trim();
  if (!backupId) {
    const err = new Error(`模型 ${contract.id} 连续失败已熔断，没有备选模型`);
    err.code = 'circuit_open';
    throw err;
  }
  const backup = typeof loadContract === 'function' ? loadContract(backupId) : null;
  if (!backup || !backup.id) {
    const err = new Error(`模型 ${contract.id} 已熔断，备选 ${backupId} 不存在`);
    err.code = 'circuit_open';
    throw err;
  }
  return { contract: backup, switched: true, fromId: contract.id };
}

function previewUnifiedConversion(arg = {}) {
  const modelContract = arg.modelContract || arg.contract || null;
  const rawInput = arg.rawInput || arg.canonicalInput || {};
  const converter = inferConverterType(modelContract, rawInput.model);
  if (converter === 'ark-seedream') {
    const r = convertArkSeedreamRequest({ rawInput, modelContract });
    return { converter, ...r, payload: r.body };
  }
  if (converter === 'agnes-image') {
    const r = convertAgnesImageRequest({ rawInput, modelContract });
    return { converter, ...r, payload: r.body };
  }
  if (converter === 'ark-seedance-video') {
    const r = convertArkSeedanceVideoRequest({ rawInput, modelContract });
    return { converter, ...r, payload: r.body };
  }
  if (converter === 'agnes-video') {
    const r = convertAgnesVideoRequest({ rawInput, modelContract });
    return { converter, ...r, payload: r.body };
  }
  const canon = normalizeCanonicalInput(rawInput, modelContract);
  const ruleEval = evaluateModelRules(modelContract, canon);
  const compiled = compileModelDialect({
    prompt: canon.optimizedPrompt != null ? canon.optimizedPrompt : canon.prompt,
    negativePrompt: canon.negativePrompt,
    dialect: modelContract?.dialect,
    mode: canon.mode,
    modelId: canon.modelId,
    region: canon.region,
  });
  return {
    converter,
    prompt: compiled.prompt,
    body: {
      model: canon.vendorModelId,
      prompt: compiled.prompt,
      ...ruleEval.values,
    },
    canonical: canon,
    ruleEval,
  };
}

module.exports = {
  ProviderCircuitBreaker,
  globalCircuitBreaker,
  CONVERTER_SPECS,
  inferConverterType,
  selectSubmitContract,
  convertArkSeedreamRequest,
  normalizeArkSeedreamResponse,
  convertAgnesImageRequest,
  convertArkSeedanceVideoRequest,
  convertAgnesVideoRequest,
  buildArkFileUploadMeta,
  previewUnifiedConversion,
};
