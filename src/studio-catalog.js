/**
 * 官方模型目录：展示名、API model_code、常用/高级参数、**能力描述符 caps**。
 * /lab/capabilities 与 llm_models 种子都以这里为准。
 *
 * ★ 本文件是**模型治理的唯一权威源**（见 AGENTS.md 铁律 0）：
 *   客户端不得自行判断"某模型支不支持 mask / 坐标"，一律读这里下发的 caps。
 *
 * caps.region.kind —— 选区出口（见 AI_CONTRACT.md §3.3，四选一）：
 *   'coords_bbox'  坐标写进 prompt 正文（Seedream Pro/Flash 族）
 *   'coords_point' 中心点写进 prompt 正文（落位类）
 *   'mask'         白=重绘 PNG，走 maskChannel 指定字段（Flux Fill / Umbra）
 *   'vlm_text'     不接受结构化选区，改用 VLM 语义描述 + 九宫格方位
 * fallbacks：可自动降级到的出口，**有序，禁止升格**。
 */
const { MODEL_SCHEMAS } = require('./model-schemas');

function M(partial) {
  return partial;
}

/* ---------- 复用的 region 描述（避免逐模型手写漂移） ---------- */

/** Seedream Pro / Flash 族：原生交互编辑，坐标 0–1000 归一化网格写进正文 */
const R_SEEDREAM_EDIT = {
  kind: 'coords_bbox',
  fallbacks: ['vlm_text'],
  coordSpace: '0-1000',
  // 两种官方等价写法都接受：① 正文直接写 4 个归一化整数；② <bbox> 包裹。
  // 项目现有 promptBuilder 走 ②，故 syntax 取 ②；syntaxAlt 供扩展层切换。
  syntax: '<bbox>x1 y1 x2 y2</bbox>',
  syntaxAlt: 'x1 y1 x2 y2',
  pointSyntax: '<point>x y</point>',
  refPrefix: '图1/图2',
  maskChannel: null,
  note: '原生交互编辑：坐标以「图1/图2」指代图片顺序后写进正文；只改框内、框外不变；也可直接在图上画圈/箭头/草图。无 mask 参数。',
};

/** 无交互编辑能力的模型：不硬塞坐标，改走 VLM 语义描述 */
const R_DESCRIBE_ONLY = {
  kind: 'vlm_text',
  fallbacks: [],
  coordSpace: null,
  syntax: null,
  pointSyntax: null,
  maskChannel: null,
  note: '不接受结构化选区，用九宫格方位 + VLM 语义描述定位',
};

/** 原生吃 mask 的模型（当前 studio 目录内暂无，Flux Fill / Umbra 接入时使用） */
function rMask(maskChannel, note) {
  return {
    kind: 'mask',
    fallbacks: ['coords_bbox', 'vlm_text'],
    coordSpace: '0-999',
    syntax: null,
    pointSyntax: null,
    maskChannel: maskChannel || 'field:mask',
    note: note || '白=重绘、黑=保留的 PNG',
  };
}

/** 视频 / 音乐：无选区概念 */
const R_NONE = {
  kind: 'vlm_text',
  fallbacks: [],
  coordSpace: null,
  syntax: null,
  pointSyntax: null,
  maskChannel: null,
  note: '该域不使用选区',
};

/* ---------- 文本模型思考能力（客户端据此渲染档位选择器） ---------- *
 * 档位以模型真实能力为准：前端只渲染 levels，后端只接受 levels 内的值。
 * 官方文档（2026-10）：
 *   Gemini 3.8 Flash        low / medium / high，默认 medium，不支持 minimal
 *   Gemini 3.5 Flash-Lite   minimal / low / medium / high，默认 minimal
 *   豆包 Seed 2.1           minimal / low / medium / high，默认 high
 * Gemini 的 OpenAI 兼容入口只认扁平 reasoning_effort；发 none 会被上游拒绝，
 * 再叠加 LiteLLM fallback 就会出现「选 Gemini、Agnes 回答」的静默替换。
 */
const REASONING = {
  geminiFlashLite: {
    supported: true,
    mode: 'levels',
    levels: ['minimal', 'low', 'medium', 'high'],
    default: 'minimal',
    wire: 'reasoning_effort',
    note: 'Gemini Flash-Lite 支持 minimal/low/medium/high，默认 minimal；只影响思考深度，思考过程不回传',
  },
  geminiFlash: {
    supported: true,
    mode: 'levels',
    levels: ['low', 'medium', 'high'],
    default: 'medium',
    wire: 'reasoning_effort',
    note: 'Gemini Flash 当前别名支持 low/medium/high，默认 medium；上游不接受 minimal',
  },
  gemmaAlways: {
    supported: false,
    mode: 'always',
    levels: [],
    default: null,
    note: 'Gemma 4 内置思考，无法通过参数关闭；正文中的 <thought> 会自动拆到思考块',
  },
  doubaoLevels: {
    supported: true,
    mode: 'levels',
    levels: ['minimal', 'low', 'medium', 'high'],
    default: 'high',
    wire: 'reasoning_effort',
    note: '豆包 Seed 2.1 支持 minimal/low/medium/high，官方默认 high；reasoning_content 自动拆到思考块',
  },
  agnesNone: {
    supported: false,
    mode: 'none',
    levels: [],
    default: null,
    note: 'Agnes 上游未提供思考档位控制',
  },
  litellmNone: {
    supported: false,
    mode: 'none',
    levels: [],
    default: null,
    note: '网关池模型不开放思考档位',
  },
};

const OFFICIAL_STUDIO = {
  chat: {
    defaultModel: 'agnes3_0flash',
    models: [
      M({
        id: 'gemini_flash_lite_latest', name: 'Gemini Flash-Lite', model_code: 'gemini-flash-lite-latest',
        provider: 'gemini', providerName: 'Google', badge: '多模态免费', capabilities: 'chat,vision,tag',
        caps: { output: 'text', input: { images: 4, videos: 0, audios: 0 }, region: R_NONE, multiRef: true, ratioFromImage1: false, refStyle: 'generic', polishId: null, freeTier: true, reasoning: REASONING.geminiFlashLite },
      }),
      M({
        id: 'agnes3_0flash', name: 'Agnes 3.0 Flash', model_code: 'agnes-3.0-flash',
        provider: 'agnes', providerName: 'Agnes AI', badge: '高可用免费', capabilities: 'chat,vision,tag',
        caps: { output: 'text', input: { images: 4, videos: 0, audios: 0 }, region: R_NONE, multiRef: true, ratioFromImage1: false, refStyle: 'generic', polishId: null, freeTier: true, reasoning: REASONING.agnesNone },
      }),
      M({
        id: 'gemma_4_26b', name: 'Gemma 4 26B', model_code: 'gemma-4-26b-a4b-it',
        provider: 'gemini', providerName: 'Google', badge: '开源视觉', capabilities: 'chat,vision',
        caps: { output: 'text', input: { images: 4, videos: 0, audios: 0 }, contextTokens: 262144, region: R_NONE, multiRef: true, ratioFromImage1: false, refStyle: 'generic', polishId: null, freeTier: true, reasoning: REASONING.gemmaAlways },
      }),
      M({
        id: 'gemma_4_31b', name: 'Gemma 4 31B', model_code: 'gemma-4-31b-it',
        provider: 'gemini', providerName: 'Google', badge: '开源视觉 · 低优先', capabilities: 'chat,vision',
        caps: { output: 'text', input: { images: 4, videos: 0, audios: 0 }, region: R_NONE, multiRef: true, ratioFromImage1: false, refStyle: 'generic', polishId: null, freeTier: true, reasoning: REASONING.gemmaAlways },
      }),
      M({
        id: 'workflow_vision', name: '工作流视觉（免费池）', model_code: 'workflow_vision',
        provider: 'litellm', providerName: 'LiteLLM', badge: '无人值守', capabilities: 'chat,vision,tag',
        caps: { output: 'text', input: { images: 4, videos: 0, audios: 0 }, region: R_NONE, multiRef: true, ratioFromImage1: false, refStyle: 'generic', polishId: null, freeTier: true, reasoning: REASONING.litellmNone },
      }),
      M({
        id: 'workflow_vision_low', name: '工作流视觉（低优先）', model_code: 'workflow_vision_low',
        provider: 'litellm', providerName: 'LiteLLM', badge: '队列满时', capabilities: 'chat,vision,tag',
        caps: { output: 'text', input: { images: 4, videos: 0, audios: 0 }, region: R_NONE, multiRef: true, ratioFromImage1: false, refStyle: 'generic', polishId: null, freeTier: true, reasoning: REASONING.litellmNone },
      }),
      M({
        id: 'gemini_flash_latest', name: 'Gemini Flash', model_code: 'gemini-flash-latest',
        provider: 'gemini', providerName: 'Google', badge: '多模态备用', capabilities: 'chat,vision,tag',
        caps: { output: 'text', input: { images: 4, videos: 0, audios: 0 }, region: R_NONE, multiRef: true, ratioFromImage1: false, refStyle: 'generic', polishId: null, freeTier: false, reasoning: REASONING.geminiFlash },
      }),
      M({
        id: 'doubao_seed_2_1_lite', dbId: 'volc_doubao_seed_2_1_lite', name: 'Doubao-Seed-2.1-lite', model_code: 'doubao-seed-2-1-lite-260915',
        provider: 'volcengine', providerName: '火山方舟', badge: '2.1 Lite(付费)', capabilities: 'vision,tag,chat',
        caps: { output: 'text', input: { images: 4, videos: 0, audios: 0 }, contextTokens: 1048576, region: R_NONE, multiRef: true, ratioFromImage1: false, refStyle: 'generic', polishId: null, freeTier: false, reasoning: REASONING.doubaoLevels },
      }),
      M({
        id: 'doubao_seed_2_1_turbo', dbId: 'volc_doubao_seed_2_1_turbo', name: 'Doubao-Seed-2.1-turbo', model_code: 'doubao-seed-2-1-turbo-260628',
        provider: 'volcengine', providerName: '火山方舟', badge: '2.1 Turbo(付费)', capabilities: 'vision,tag,chat',
        caps: { output: 'text', input: { images: 4, videos: 0, audios: 0 }, region: R_NONE, multiRef: true, ratioFromImage1: false, refStyle: 'generic', polishId: null, freeTier: false, reasoning: REASONING.doubaoLevels },
      }),
      M({
        id: 'doubao_seed_2_1_pro', dbId: 'volc_doubao_seed_2_1_pro', name: 'Doubao-Seed-2.1-pro', model_code: 'doubao-seed-2-1-pro-260628',
        provider: 'volcengine', providerName: '火山方舟', badge: '2.1 Pro(付费)', capabilities: 'vision,tag,chat',
        caps: { output: 'text', input: { images: 4, videos: 0, audios: 0 }, region: R_NONE, multiRef: true, ratioFromImage1: false, refStyle: 'generic', polishId: null, freeTier: false, reasoning: REASONING.doubaoLevels },
      }),
    ],
  },

  image: {
    /** ★ 主动生图默认 = Seedream 5.0 Flash（支持交互编辑 + 价格低） */
    defaultModel: 'seedream5flash',
    models: [
      M({
        id: 'seedream5flash',
        name: 'Seedream 5.0 Flash',
        model_code: 'doubao-seedream-5-0-flash-260915',
        provider: 'volcengine',
        providerName: '火山方舟',
        badge: '推荐 · 交互编辑',
        capabilities: 'image,image_edit',
        dbId: 'volc_seedream_5_flash',
        aliases: ['volc_seedream_5_flash', 'doubao-seedream-5-0-flash'],
        params: { ratio: true, size: ['1K', '1.5K', '2K'], bbox: true, point: true, refs: 6 },
        advanced: ['watermark', 'output_format'],
        caps: {
          output: 'image',
          input: { images: 10, videos: 0, audios: 0 }, // 官方上限 10（UI 推荐槽位见 params.refs）
          region: R_SEEDREAM_EDIT,
          multiRef: true,
          ratioFromImage1: false,
          refStyle: 'generic',
          polishId: 'seedream5flash',
          freeTier: false,
        },
      }),
      M({
        id: 'seedream5pro',
        name: 'Seedream 5.0 Pro',
        model_code: 'doubao-seedream-5-0-pro-260628',
        provider: 'volcengine',
        providerName: '火山方舟',
        badge: '高精换物',
        capabilities: 'image,image_edit',
        dbId: 'volc_seedream_image',
        aliases: ['volc_seedream_image', 'doubao-image-seedream', 'doubao-seedream-5-0-pro'],
        params: { ratio: true, size: ['1K', '1.5K', '2K'], bbox: true, point: true, refs: 6 },
        advanced: ['watermark', 'output_format', 'prompt_priority'],
        caps: {
          output: 'image',
          input: { images: 10, videos: 0, audios: 0 }, // 官方上限 10
          region: Object.assign({}, R_SEEDREAM_EDIT, { note: '原生交互编辑；额外支持极速(fast)提示优化模式' }),
          multiRef: true,
          ratioFromImage1: false,
          refStyle: 'generic',
          polishId: 'seedream5pro',
          freeTier: false,
        },
      }),
      M({
        id: 'seedream5lite',
        name: 'Seedream 5.0 Lite',
        model_code: 'doubao-seedream-5-0-260128',
        provider: 'volcengine',
        providerName: '火山方舟',
        badge: '极速 · 组图 2K/4K',
        capabilities: 'image',
        dbId: 'volc_seedream_5_lite',
        aliases: ['volc_seedream_5_lite'],
        params: { ratio: true, size: ['2K', '3K', '4K'], refs: 6 },
        advanced: ['n', 'sequential_image_generation'],
        caps: {
          output: 'image',
          input: { images: 14, videos: 0, audios: 0 }, // 官方上限 14；唯一支持组图的 5.0 代际
          region: Object.assign({}, R_DESCRIBE_ONLY, {
            // ⚠ 待验证：官方文档把 «region-based editing» 列为 5.0 通用能力，但本档 capabilities
            //   未标 image_edit。在拿到一次真实坐标编辑回包前，按「无交互编辑」保守处理。
            note: '本档按无交互编辑处理：只做增删改替 + 明确写明保持不变的部分，禁止写 bbox / 草图线句法（待验证）',
          }),
          multiRef: true,
          ratioFromImage1: false,
          refStyle: 'generic',
          polishId: 'seedream5lite',
          freeTier: false,
        },
      }),
      M({
        id: 'agnes_image_2_5_flash',
        name: 'Agnes Image 2.5 Flash',
        model_code: 'agnes-image-2.5-flash',
        provider: 'agnes',
        providerName: 'Agnes AI',
        badge: 'Flash 免费',
        capabilities: 'image',
        params: { ratio: true, size: ['1K', '2K'], refs: 3 },
        free: { maxRefs: 3, sizes: ['1K', '2K'] },
        advanced: ['size3k'],
        caps: {
          output: 'image',
          input: { images: 3, videos: 0, audios: 0 },
          region: Object.assign({}, R_DESCRIBE_ONLY, {
            note: '走官方三结构；必须写 @图片N，严禁“参考图/第一张图”这类模糊代词',
          }),
          multiRef: true,
          ratioFromImage1: false,
          refStyle: 'agnes',
          polishId: 'agnes_image_2_5_flash',
          freeTier: true,
        },
      }),
      M({
        id: 'qwenimage_local',
        name: 'Qwen-Image 2.1',
        model_code: 'qwen2.1-image',
        provider: 'local',
        providerName: '本机',
        badge: '文生图 · 可垫图',
        capabilities: 'image',
        dbId: 'qwenimage_local',
        params: { ratio: true, size: ['1K', '2K'], refs: 10 },
        caps: {
          output: 'image',
          input: { images: 10, videos: 0, audios: 0 },
          region: R_DESCRIBE_ONLY,
          multiRef: false,
          ratioFromImage1: false,
          refStyle: 'generic',
          polishId: 'qwenimage_local',
          freeTier: false,
        },
      }),
    ],
  },

  video: {
    defaultModel: 'seedance2_0',
    models: [
      M({
        id: 'seedance2_5',
        name: 'Seedance 2.5',
        model_code: 'doubao-seedance-2-5-260628',
        provider: 'volcengine',
        providerName: '火山方舟',
        badge: '漫游 · 可编辑',
        capabilities: 'video',
        dbId: 'volc_seedance_video',
        aliases: ['volc_seedance_video', 'doubao-video-seedance', 'doubao-seedance-2-5'],
        params: { duration: true, resolution: ['480p', '720p', '1080p'], refs: 30 },
        caps: {
          output: 'video',
          input: { images: 30, videos: 10, audios: 10 },
          region: R_NONE,
          multiRef: true,
          ratioFromImage1: false,
          refStyle: 'seedance',
          polishId: 'seedance2_5',
          freeTier: false,
        },
      }),
      M({
        id: 'seedance2_0',
        name: 'Seedance 2.0',
        model_code: 'doubao-seedance-2-0-260128',
        provider: 'volcengine',
        providerName: '火山方舟',
        badge: '稳定 · 默认',
        capabilities: 'video',
        dbId: 'volc_seedance_2_0',
        aliases: ['volc_seedance_2_0', 'doubao-seedance-2-0'],
        params: { duration: true, resolution: ['480p', '720p', '1080p'], refs: 9 },
        caps: {
          output: 'video',
          input: { images: 9, videos: 3, audios: 3 },
          region: R_NONE,
          multiRef: true,
          ratioFromImage1: false,
          refStyle: 'seedance',
          polishId: 'seedance2_0',
          freeTier: false,
        },
      }),
      M({
        id: 'agnes_video_2_5_flash',
        name: 'Agnes Video 2.5 Flash',
        model_code: 'agnes-video-2.5-flash',
        provider: 'agnes',
        providerName: 'Agnes AI',
        badge: 'Flash 免费',
        capabilities: 'video',
        free: { size: '720P', maxRefs: 5, maxAudios: 3, noVideoRef: true },
        params: { duration: true, resolution: ['720P'], refs: 5 },
        caps: {
          output: 'video',
          input: { images: 5, videos: 0, audios: 3 },
          region: R_NONE,
          multiRef: true,
          ratioFromImage1: false,
          refStyle: 'agnes',
          polishId: 'agnes_video_2_5_flash',
          freeTier: true,
          /** 免费档参考视频一律禁止（见 model-schemas.free.noVideoRef） */
          noVideoRef: true,
        },
      }),
    ],
  },

  music: {
    defaultModel: 'doubao_bgm_v5',
    models: [
      M({
        id: 'doubao_song_v5', name: '豆包歌曲 v5', model_code: 'doubao-song-v5',
        provider: 'volcengine', providerName: '火山方舟', badge: '人声', capabilities: 'music',
        caps: { output: 'audio', input: { images: 0, videos: 0, audios: 0 }, region: R_NONE, multiRef: false, ratioFromImage1: false, refStyle: 'generic', polishId: 'doubao_song_v5', freeTier: false },
      }),
      M({
        id: 'doubao_bgm_v5', name: '豆包纯音乐 v5', model_code: 'doubao-bgm-v5',
        provider: 'volcengine', providerName: '火山方舟', badge: '纯音乐', capabilities: 'music',
        caps: { output: 'audio', input: { images: 0, videos: 0, audios: 0 }, region: R_NONE, multiRef: false, ratioFromImage1: false, refStyle: 'generic', polishId: 'doubao_bgm_v5', freeTier: false },
      }),
      M({
        id: 'acestep_local', name: 'ACE-Step 1.5', model_code: 'acestep-1.5',
        provider: 'local', providerName: '本机', badge: '本地音乐', capabilities: 'music',
        caps: { output: 'audio', input: { images: 0, videos: 0, audios: 0 }, region: R_NONE, multiRef: false, ratioFromImage1: false, refStyle: 'generic', polishId: 'acestep_local', freeTier: false },
      }),
      M({
        id: 'indextts_local', name: 'IndexTTS 2.5', model_code: 'index-tts-2.5',
        provider: 'local', providerName: '本机', badge: '声音克隆', capabilities: 'music',
        caps: { output: 'audio', input: { images: 0, videos: 0, audios: 2 }, region: R_NONE, multiRef: false, ratioFromImage1: false, refStyle: 'generic', polishId: 'indextts_local', freeTier: false },
      }),
    ],
  },

  portrait: {
    /** ★ 人像默认同样是 5.0 Flash */
    defaultModel: 'seedream_portrait',
    models: [
      M({
        id: 'seedream_portrait',
        name: 'Seedream 5.0 Flash 人像',
        model_code: 'doubao-seedream-5-0-flash-260915',
        provider: 'volcengine',
        providerName: '火山方舟',
        badge: '推荐 · 交互编辑',
        capabilities: 'image,image_edit',
        dbId: 'volc_seedream_portrait',
        params: { ratio: true, size: ['1K', '1.5K', '2K'], bbox: true, point: true, refs: 6, portrait: true },
        caps: {
          output: 'image',
          input: { images: 6, videos: 0, audios: 0 },
          region: Object.assign({}, R_SEEDREAM_EDIT, { note: '人像域：保持人物身份一致，仅改框内' }),
          multiRef: true,
          ratioFromImage1: false,
          refStyle: 'generic',
          polishId: 'seedream5flash',
          freeTier: false,
        },
      }),
      M({
        id: 'agnes_portrait_2_5',
        name: 'Agnes Image 2.5 Flash 人像',
        model_code: 'agnes-image-2.5-flash',
        provider: 'agnes',
        providerName: 'Agnes AI',
        badge: '免费兜底',
        free: { maxRefs: 3 },
        capabilities: 'image',
        caps: {
          output: 'image',
          input: { images: 3, videos: 0, audios: 0 },
          region: R_DESCRIBE_ONLY,
          multiRef: true,
          ratioFromImage1: false,
          refStyle: 'agnes',
          polishId: 'agnes_image_2_5_flash',
          freeTier: true,
        },
      }),
    ],
  },
};

/* ------------------------------------------------------------------ *
 * 查询工具
 * ------------------------------------------------------------------ */

function norm(s) {
  return String(s || '').toLowerCase().replace(/_/g, '-').replace(/\s+/g, '');
}

function keysOf(m) {
  const list = [m.id, m.dbId, m.catalogId, m.model_code, ...(m.aliases || [])];
  return list.filter(Boolean).map(norm);
}

/** 按任意 id / dbId / model_code / alias 找官方目录记录 */
function officialOf(idOrCode) {
  const n = norm(idOrCode);
  if (!n) return null;
  for (const domain of Object.keys(OFFICIAL_STUDIO)) {
    for (const m of OFFICIAL_STUDIO[domain].models || []) {
      if (keysOf(m).includes(n)) return { domain, model: m };
    }
  }
  return null;
}

/** ★ 能力描述符查询：客户端与管线 B 的唯一入口 */
function capsFor(idOrCode, db) {
  const hit = officialOf(idOrCode);
  if (hit && hit.model.caps) {
    return Object.assign({ modelId: hit.model.id, domain: hit.domain }, hit.model.caps);
  }
  // 自定义注册模型（治理台创建）兜底：从 model-schemas 推一个保守 caps
  if (db) {
    try {
      const { getCustomSchema } = require('./gen-governance');
      const cfgRow = db.prepare('SELECT model_id, custom_config_json FROM gen_model_custom_schemas WHERE model_id=?').get(String(idOrCode));
      if (cfgRow) {
        return {
          modelId: cfgRow.model_id,
          domain: 'custom',
          output: 'image',
          input: { images: 4, videos: 0, audios: 0 },
          region: R_DESCRIBE_ONLY,
          multiRef: true,
          ratioFromImage1: false,
          refStyle: 'generic',
          polishId: cfgRow.model_id,
          freeTier: false,
          isCustom: true,
        };
      }
    } catch (_) {}
  }
  return null;
}

/** 取某模型的选区出口（含有序降级链） */
function regionChainFor(idOrCode, db) {
  const caps = capsFor(idOrCode, db);
  if (!caps || !caps.region) return ['vlm_text'];
  const chain = [caps.region.kind];
  for (const f of caps.region.fallbacks || []) {
    if (!chain.includes(f)) chain.push(f);
  }
  return chain;
}

function hasMaskChannel(idOrCode, db) {
  const caps = capsFor(idOrCode, db);
  return !!(caps && caps.region && caps.region.kind === 'mask' && caps.region.maskChannel);
}

function matchOfficial(official, rows) {
  if (!official || !Array.isArray(rows) || !rows.length) return null;
  const want = new Set(keysOf(official));
  const exact = rows.find((r) => want.has(norm(r.id)) || want.has(norm(r.model_code)));
  if (exact) return exact;
  return null;
}

/* ------------------------------------------------------------------ *
 * 提供商 / 模型族分类（客户端下拉分组与治理台共用）
 * 分类方案共 3 层：
 *   1. 提供商组：Google / 字节跳动 / Agnes / 本机 / LiteLLM
 *   2. 模型族：gemini、gemma、nano；seedream、seedance、seed；agnes；qwen；local
 *   3. 模态域：chat / image / video / music（由 OFFICIAL_STUDIO 的 domain 决定）
 * 新增模型只要 id / model_code 命中下面的规则即可自动归类，无需逐条登记。
 * ------------------------------------------------------------------ */
const FAMILY_RULES = [
  { family: 'gemini', name: 'Gemini', re: /gemini/i },
  { family: 'gemma', name: 'Gemma', re: /gemma/i },
  { family: 'nano', name: 'Nano', re: /nano/i },
  { family: 'seedream', name: 'Seedream', re: /seedream/i },
  { family: 'seedance', name: 'Seedance', re: /seedance/i },
  { family: 'seed', name: 'Seed', re: /(^|[-_/])seed([-_/]|$)|doubao-seed/i },
  { family: 'agnes', name: 'Agnes', re: /agnes/i },
  { family: 'qwen', name: 'Qwen', re: /qwen/i },
  { family: 'local', name: '本机', re: /(local|acestep|index-tts)/i },
];

/** 从模型 id / model_code 推导模型族（提供商内部再细分） */
function familyOf(idOrCode, providerId) {
  const text = `${idOrCode || ''}`;
  for (const rule of FAMILY_RULES) {
    if (rule.re.test(text)) return { family: rule.family, familyName: rule.name };
  }
  const p = String(providerId || '');
  if (p === 'gemini') return { family: 'gemini', familyName: 'Gemini' };
  if (p === 'volcengine') return { family: 'seed', familyName: 'Seed' };
  if (p === 'agnes') return { family: 'agnes', familyName: 'Agnes' };
  if (p === 'local') return { family: 'local', familyName: '本机' };
  if (p === 'litellm') return { family: 'litellm', familyName: '网关池' };
  return { family: p || 'other', familyName: p || '其他' };
}

/** 提供商组：客户端只按这一层显示分组标题 */
function providerGroupOf(providerId) {
  const p = String(providerId || '');
  if (p === 'gemini') return 'Google';
  if (p === 'volcengine') return '字节跳动';
  if (p === 'agnes') return 'Agnes';
  if (p === 'local') return '本机';
  if (p === 'litellm') return 'LiteLLM';
  return p || '其他';
}

function providerDisplayName(providerId, code) {
  const p = String(providerId || '');
  const c = String(code || '').toLowerCase();
  if (p === 'agnes' || c.includes('agnes')) return 'Agnes AI';
  if (p === 'volcengine' || c.includes('doubao') || c.includes('seedream') || c.includes('seedance')) return '火山方舟';
  if (p === 'gemini' || c.includes('gemini') || c.includes('veo') || c.includes('lyria') || c.includes('gemma') || c.includes('nano')) return 'Google';
  if (p === 'modelscope' || c.includes('damo/') || c.includes('qwen')) return 'ModelScope';
  return p || '其他';
}

function resolveModelCode(idOrCode) {
  const hit = officialOf(idOrCode);
  return hit ? hit.model.model_code : idOrCode;
}

function officialIdOf(idOrCode) {
  const hit = officialOf(idOrCode);
  return hit ? hit.model.id : idOrCode;
}

function officialNameFor(code, fallback) {
  const hit = officialOf(code);
  return hit ? hit.model.name : (fallback || code);
}

/** 把官方目录转成 llm_models 种子行（保留稳定主键） */
function toDefaultModelRows() {
  const rows = [];
  const seen = new Set();
  const domains = ['chat', 'image', 'video', 'music', 'portrait'];
  for (const domain of domains) {
    for (const m of OFFICIAL_STUDIO[domain].models || []) {
      const id = m.dbId || m.id;
      if (seen.has(id) || seen.has(m.model_code)) continue;
      seen.add(id);
      seen.add(m.model_code);
      rows.push({
        id,
        provider_id: m.provider,
        name: m.name,
        model_code: m.model_code,
        capabilities: m.capabilities || domain,
        params_json: JSON.stringify({
          ...(m.params || {}),
          durations: m.durations,
          free: m.free,
          badge: m.badge,
          advanced: m.advanced,
          studioId: m.id,
          caps: m.caps || null,
        }),
        is_default: OFFICIAL_STUDIO[domain].defaultModel === m.id ? 1 : 0,
        enabled: m.disabled ? 0 : 1,
      });
    }
  }
  return rows;
}

module.exports = {
  OFFICIAL_STUDIO,
  matchOfficial,
  providerDisplayName,
  providerGroupOf,
  familyOf,
  officialNameFor,
  resolveModelCode,
  officialIdOf,
  toDefaultModelRows,
  keysOf,
  norm,
  // —— 能力描述符（管线 A/B 与客户端共用） ——
  officialOf,
  capsFor,
  regionChainFor,
  hasMaskChannel,
  R_DESCRIBE_ONLY,
  R_SEEDREAM_EDIT,
  R_NONE,
  rMask,
};
