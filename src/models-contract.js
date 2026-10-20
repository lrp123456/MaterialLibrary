/**
 * 模型契约、接入点与提交组装核心模块 (Models Contract & Endpoint Registry)
 * 严格按照管理台模型区规范设计：
 * - 厂商 -> 接入点 -> 能力 -> 模型
 * - 凭证列表来自接入点自身，支持多 Key 轮换，仅引用环境变量名，绝不保存/返回明文密钥
 * - 一次提交顺序组装：模板 -> 优化器 -> 写进提示词 -> 请求体字段/换算表/条件改交法 -> 厂商优化
 */
const crypto = require('crypto');
const { resolveModelCode, officialOf, OFFICIAL_STUDIO } = require('./studio-catalog');
const {
  CANONICAL_VOCABULARY,
  setDeepField,
  normalizeCanonicalInput,
  evaluateModelRules,
  compileModelDialect,
  transformFieldValue,
} = require('./unified-translator');

// 1. Seedream 5.0 Flash 官方核实换算表
const SEEDREAM_FLASH_SIZE_TABLE = {
  '1K_1:1': '1024x1024',
  '1K_4:3': '1152x864',
  '1K_3:4': '864x1152',
  '1K_16:9': '1424x800',
  '1K_9:16': '800x1424',
  '1K_3:2': '1248x832',
  '1K_2:3': '832x1248',
  '1K_21:9': '1568x672',
  '1.5K_1:1': '1536x1536',
  '1.5K_4:3': '1792x1344',
  '1.5K_3:4': '1344x1792',
  '1.5K_16:9': '2048x1152',
  '1.5K_9:16': '1152x2048',
  '1.5K_3:2': '1872x1248',
  '1.5K_2:3': '1248x1872',
  '1.5K_21:9': '2352x1008',
  '2K_1:1': '2048x2048',
  '2K_4:3': '2368x1776',
  '2K_3:4': '1776x2368',
  '2K_16:9': '2816x1584',
  '2K_9:16': '1584x2816',
  '2K_3:2': '2496x1664',
  '2K_2:3': '1664x2496',
  '2K_21:9': '3136x1344',
};

function contractEnum(key, label, options, def, extra) {
  return Object.assign({
    key, label, type: 'enum', default: def, options,
    visibility: 'public', location: 'body', body_field: key,
  }, extra || {});
}
function contractDuration(key, label, min, max, def, extra) {
  return Object.assign({
    key, label, type: 'duration', default: def, min, max,
    extra_stops: [], extra_labels: {},
    visibility: 'public', location: 'body', body_field: key,
  }, extra || {});
}
function contractBool(key, label, def, extra) {
  return Object.assign({
    key, label, type: 'boolean', default: !!def,
    visibility: 'advanced', location: 'body', body_field: key,
  }, extra || {});
}
function contractNumber(key, label, min, max, def, extra) {
  return Object.assign({
    key, label, type: 'number', default: def, min, max,
    visibility: 'advanced', location: 'body', body_field: key,
  }, extra || {});
}

const RATIO_SEEDANCE = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'];

function seedance20Params() {
  return [
    contractEnum('resolution', '分辨率', ['480p', '720p', '1080p', '4k'], '720p'),
    contractDuration('duration', '时长', 4, 15, 5, { extra_stops: [-1], extra_labels: { '-1': '智能' } }),
    contractEnum('ratio', '画幅', RATIO_SEEDANCE, '16:9'),
    contractBool('generate_audio', '生成同步音频', true, { visibility: 'public' }),
    contractEnum('mode', '模式', ['text_to_video', 'omni_reference', 'image_to_video', 'first_last_frame'], 'text_to_video', {
      location: 'none',
      option_labels: { text_to_video: '文生视频', omni_reference: '全能参考', image_to_video: '图生视频', first_last_frame: '首尾帧' },
    }),
    contractBool('watermark', 'AI 水印', false),
    contractNumber('seed', '种子', -1, 2147483647, -1),
    contractBool('camera_fixed', '镜头固定', false),
    contractBool('return_last_frame', '返回尾帧', false),
    contractBool('web_search', '联网搜索增强', false),
  ];
}

function seedance25Params() {
  return [
    contractEnum('resolution', '分辨率', ['480p', '720p', '1080p'], '720p'),
    contractDuration('duration', '时长', 4, 30, -1, { extra_stops: [-1], extra_labels: { '-1': '智能' } }),
    contractEnum('ratio', '画幅', RATIO_SEEDANCE, 'adaptive'),
    contractBool('generate_audio', '生成同步音频', true, { visibility: 'public' }),
    contractEnum('mode', '模式', ['text_to_video', 'omni_reference', 'image_to_video', 'first_last_frame', 'video_edit', 'video_extend', 'draft_to_final'], 'text_to_video', {
      location: 'none',
      option_labels: {
        text_to_video: '文生视频', omni_reference: '全能参考', image_to_video: '图生视频',
        first_last_frame: '首尾帧', video_edit: '视频编辑', video_extend: '视频延长', draft_to_final: '样片转正片',
      },
    }),
    contractBool('watermark', 'AI 水印', false),
    contractNumber('seed', '种子', -1, 2147483647, -1),
    contractEnum('output_format', '封装', ['mp4', 'mov'], 'mp4', { visibility: 'advanced' }),
    contractBool('return_last_frame', '返回尾帧', false),
    contractBool('draft', '样片预览模式(480p)', false, { visibility: 'advanced' }),
    contractBool('web_search', '联网搜索增强', false, { visibility: 'advanced' }),
    contractEnum('omni_reference_task_type', '任务类型', ['auto', 'reference', 'edit', 'extend'], 'auto', {
      visibility: 'advanced',
      option_labels: { auto: '自动', reference: '参考生视频', edit: '编辑', extend: '延长' },
    }),
  ];
}

// 文本模型只挂在本地网关。成员名单以 LiteLLM /model/info 为准，这里只挂显示名。
const LITELLM_TEXT_CONTRACTS = [
  ['agnes-3.0-flash', 'Agnes 3.0 Flash', 1, false],
  ['gemma-4-26b-a4b-it', 'Gemma 4 26B', 1, false],
  ['gemma-4-31b-it', 'Gemma 4 31B', 1, false],
  ['gemini-flash-lite-latest', 'Gemini Flash-Lite', 0, false],
  ['gemini-flash-latest', 'Gemini Flash', 0, false],
  ['doubao-seed-2-1-lite-260915', 'Doubao Seed 2.1 Lite', 1, false],
  ['doubao-seed-2-1-turbo-260628', 'Doubao Seed 2.1 Turbo', 1, false],
  ['doubao-seed-2-1-pro-260628', 'Doubao Seed 2.1 Pro', 1, false],
  ['workflow_vision', '识图组 workflow_vision', 1, true],
  ['workflow_vision_low', '识图组 workflow_vision_low', 1, true],
  ['model_text_input', '文本输入组 model_text_input', 1, true],
  ['model_image_input', '图像输入组 model_image_input', 1, true],
  ['model_video_input', '视频输入组 model_video_input', 1, true],
].map(([id, name, enabled, group]) => ({
  id,
  name,
  vendor_model_id: id,
  capability_id: 'litellm_chat',
  enabled,
  params: [],
  table_mappings: {},
  conditional_rules: group ? [{ type: 'litellm_group' }] : [],
  mutex_groups: [],
  optimizer: { optimizer_model_id: 'agnes-3.0-flash', prompt: '' },
}));

const GATEWAY_TEXT_NAMES = new Set(LITELLM_TEXT_CONTRACTS.map((c) => c.id));
const GATEWAY_GROUP_NAMES = new Set(
  LITELLM_TEXT_CONTRACTS.filter((c) => (c.conditional_rules || []).some((r) => r.type === 'litellm_group')).map((c) => c.id)
);

// 本机 Qwen 像素换算表（width x height）
const QWEN_SIZE_TABLE = {
  '1K_1:1': { width: 1024, height: 1024 },
  '1K_4:3': { width: 1152, height: 864 },
  '1K_3:4': { width: 864, height: 1152 },
  '1K_16:9': { width: 1280, height: 720 },
  '1K_9:16': { width: 720, height: 1280 },
  '2K_1:1': { width: 1536, height: 1536 },
  '2K_4:3': { width: 1536, height: 1152 },
  '2K_3:4': { width: 1152, height: 1536 },
  '2K_16:9': { width: 1920, height: 1080 },
  '2K_9:16': { width: 1080, height: 1920 },
};

// 种子接入点定义
const DEFAULT_ENDPOINTS = [
  {
    id: 'volc_ark',
    provider_id: 'volcengine',
    provider_name: '火山引擎',
    name: '火山方舟大模型',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    auth_type: 'bearer',
    sign_service: null,
    sign_version: null,
    credentials: ['ARK_API_KEY'],
    enabled: 1,
    capabilities: [
      { id: 'ark_image', name: '图片生成', kind: 'image', type: 'path', path: '/images/generations', method: 'POST' },
      { id: 'ark_video', name: '视频生成', kind: 'video', type: 'path', path: '/contents/generations/tasks', poll_path: '/contents/generations/tasks/{{taskId}}', method: 'POST' },
      { id: 'ark_chat', name: '对话理解', kind: 'chat', type: 'path', path: '/chat/completions', method: 'POST' },
    ]
  },
  {
    id: 'doubao_music',
    provider_id: 'volcengine',
    provider_name: '火山引擎',
    name: '豆包音乐',
    base_url: 'https://open.volcengineapi.com',
    auth_type: 'aksk',
    sign_service: 'imagination',
    sign_version: '2024-08-12',
    credentials: [{ ak_env: 'VOLC_AK', sk_env: 'VOLC_SK' }],
    enabled: 1,
    capabilities: [
      { id: 'doubao_music_bgm', name: '纯音乐生成', kind: 'music', type: 'action', action: 'GenBGMForTime', poll_action: 'QuerySong', method: 'POST' },
      { id: 'doubao_music_song', name: '人声歌曲生成', kind: 'music', type: 'action', action: 'GenSongForTime', poll_action: 'QuerySong', method: 'POST' },
    ]
  },
  {
    id: 'volc_portrait',
    provider_id: 'volcengine',
    provider_name: '火山引擎',
    name: '虚拟人像',
    base_url: 'https://ark.cn-beijing.volcengineapi.com',
    auth_type: 'aksk',
    sign_service: 'ark',
    sign_version: '2024-01-01',
    credentials: [{ ak_env: 'PORTRAIT_AK', sk_env: 'PORTRAIT_SK' }, { ak_env: 'ARK_PORTRAIT_AK', sk_env: 'ARK_PORTRAIT_SK' }],
    enabled: 1,
    capabilities: [
      { id: 'portrait_group', name: '创建人像资产组', kind: 'portrait', type: 'action', action: 'CreateAssetGroup', method: 'POST' },
    ]
  },
  {
    id: 'litellm',
    provider_id: 'litellm',
    provider_name: 'LiteLLM 本地网关',
    name: '本地网关',
    base_url: 'http://127.0.0.1:4000',
    auth_type: 'bearer',
    sign_service: null,
    sign_version: null,
    credentials: ['LITELLM_API_KEY'],
    enabled: 1,
    capabilities: [
      { id: 'litellm_chat', name: '对话与视觉打标', kind: 'chat', type: 'path', path: '/chat/completions', method: 'POST' },
    ]
  },
  {
    id: 'local_host',
    provider_id: 'local',
    provider_name: '本机',
    name: '本机 Umbra 与算法',
    base_url: 'http://127.0.0.1:3001',
    auth_type: 'bearer',
    sign_service: null,
    sign_version: null,
    credentials: ['UMBRA_TOKEN', 'CREATION_PUBLIC_TOKEN'],
    enabled: 1,
    capabilities: [
      { id: 'umbra.expand', name: '扩图', kind: 'image', type: 'path', path: '/api/expand', method: 'POST' },
      { id: 'umbra.insert', name: '局部添加', kind: 'image', type: 'path', path: '/api/insert', method: 'POST' },
      { id: 'umbra.remove', name: '智能消除', kind: 'image', type: 'path', path: '/api/remove', method: 'POST' },
      { id: 'umbra.replace', name: '精准替换', kind: 'image', type: 'path', path: '/api/replace', method: 'POST' },
      { id: 'unified_gateway', name: '去水印', kind: 'image', type: 'path', path: '/api/clean', method: 'POST' },
      { id: 'local-4x', name: '清晰度 (超分)', kind: 'image', type: 'path', path: '/api/enhance', method: 'POST' },
      { id: 'yolo_detect', name: 'YOLO 目标分割', kind: 'vision', type: 'path', path: '/detect', method: 'POST' },
      { id: 'local_esrgan', name: 'Real-ESRGAN 本地算法', kind: 'image', type: 'local' },
      { id: 'local_edgesam', name: 'EdgeSAM 快速分割', kind: 'vision', type: 'local' },
    ]
  },
  {
    id: 'agnes',
    provider_id: 'agnes',
    provider_name: 'Agnes AI',
    name: 'Agnes AI 创意生成服务',
    base_url: 'https://api.agnes-ai.cn/v1',
    auth_type: 'bearer',
    sign_service: null,
    sign_version: null,
    credentials: ['AGNES_API_KEY'],
    enabled: 1,
    capabilities: [
      { id: 'agnes_image', name: 'Agnes 图像生成', kind: 'image', type: 'path', path: '/images/generations', method: 'POST' },
      { id: 'agnes_video', name: 'Agnes 视频生成', kind: 'video', type: 'path', path: '/agnesapi/v1/videos/generations', poll_path: '/agnesapi/v1/videos/generations/{{taskId}}', method: 'POST' },
      { id: 'agnes_chat', name: 'Agnes 对话理解', kind: 'chat', type: 'path', path: '/chat/completions', method: 'POST' },
    ]
  },
  {
    id: 'agnes_intl',
    provider_id: 'agnes',
    provider_name: 'Agnes AI',
    name: 'Agnes AI 国际站',
    base_url: 'https://apihub.agnes-ai.com/v1',
    auth_type: 'bearer',
    sign_service: null,
    sign_version: null,
    credentials: [],
    enabled: 1,
    capabilities: [
      { id: 'agnes_intl_image', name: 'Agnes 国际站图像', kind: 'image', type: 'path', path: '/images/generations', method: 'POST' },
      { id: 'agnes_intl_video', name: 'Agnes 国际站视频', kind: 'video', type: 'path', path: '/agnesapi/v1/videos/generations', poll_path: '/agnesapi/v1/videos/generations/{{taskId}}', method: 'POST' },
      { id: 'agnes_intl_chat', name: 'Agnes 国际站对话', kind: 'chat', type: 'path', path: '/chat/completions', method: 'POST' },
    ]
  },
  {
    id: 'qwen_lan',
    provider_id: 'local',
    provider_name: '本机',
    name: '局域网 Qwen',
    base_url: 'http://192.168.1.107:9000',
    auth_type: 'none',
    sign_service: null,
    sign_version: null,
    credentials: [],
    enabled: 1,
    capabilities: [
      { id: 'qwenimage_local', name: '本机 Qwen-Image 2.1', kind: 'image', type: 'path', path: '/api/qw/generate', poll_path: '/api/qw/tasks/{{taskId}}', method: 'POST' },
      { id: 'indextts_local', name: 'IndexTTS 2.5', kind: 'music', type: 'path', path: '/api/voice/tts', poll_path: '/api/voice/tasks/{{taskId}}', method: 'POST' },
      { id: 'acestep_local', name: 'ACE-Step 1.5', kind: 'music', type: 'path', path: '/api/music/release_task', poll_path: '/api/music/query_result', method: 'POST' },
    ]
  },
  {
    id: 'gemini',
    provider_id: 'gemini',
    provider_name: 'Google AI Studio',
    name: 'Google AI Studio (Gemini)',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    auth_type: 'bearer',
    sign_service: null,
    sign_version: null,
    credentials: ['GEMINI_API_KEY'],
    enabled: 0,
    capabilities: [
      { id: 'gemini_chat', name: 'Gemini 对话理解', kind: 'chat', type: 'path', path: '/chat/completions', method: 'POST' },
    ]
  },
  {
    id: 'groq',
    provider_id: 'groq',
    provider_name: 'Groq',
    name: 'Groq 超高速推理平台',
    base_url: 'https://api.groq.com/openai/v1',
    auth_type: 'bearer',
    sign_service: null,
    sign_version: null,
    credentials: ['GROQ_API_KEY'],
    enabled: 1,
    capabilities: [
      { id: 'groq_chat', name: 'Groq 对话', kind: 'chat', type: 'path', path: '/chat/completions', method: 'POST' },
    ]
  },
  {
    id: 'kilo',
    provider_id: 'kilo',
    provider_name: 'Kilo AI',
    name: 'Kilo AI Gateway',
    base_url: 'https://api.kilo.ai/api/gateway',
    auth_type: 'bearer',
    sign_service: null,
    sign_version: null,
    credentials: ['KILO_API_KEY'],
    enabled: 1,
    capabilities: [
      { id: 'kilo_chat', name: 'Kilo 对话', kind: 'chat', type: 'path', path: '/chat/completions', method: 'POST' },
    ]
  },
  {
    id: 'modelscope',
    provider_id: 'modelscope',
    provider_name: '魔搭社区',
    name: '魔搭社区 (ModelScope)',
    base_url: 'https://api-inference.modelscope.cn/v1',
    auth_type: 'bearer',
    sign_service: null,
    sign_version: null,
    credentials: ['MODELSCOPE_API_KEY'],
    enabled: 1,
    capabilities: [
      { id: 'modelscope_chat', name: '魔搭对话/打标', kind: 'chat', type: 'path', path: '/chat/completions', method: 'POST' },
      { id: 'modelscope_image', name: '魔搭文生图', kind: 'image', type: 'path', path: '/images/generations', method: 'POST' },
      { id: 'modelscope_video', name: '魔搭文生视频', kind: 'video', type: 'path', path: '/videos/generations', method: 'POST' },
    ]
  }
];

// 默认模型契约定义
const DEFAULT_MODEL_CONTRACTS = [
  {
    id: 'seedream5flash',
    name: 'Seedream 5.0 Flash',
    vendor_model_id: 'doubao-seedream-5-0-flash-260915',
    capability_id: 'ark_image',
    converter: 'ark-seedream',
    refStyle: 'generic',
    polishHint: '1K/1.5K/2K · 原生交互编辑（bbox/point 进提示词） · 图层拆分',
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图生图' },
      { id: 'image_reference', label: '多参考' },
      { id: 'image_edit', label: '交互编辑' },
      { id: 'expand_fill', label: '扩边填白' },
    ],
    slots: { images: 6, videos: 0, audios: 0 },
    enabled: 1,
    params: [
      {
        key: 'size',
        label: '尺寸档',
        type: 'enum',
        default: '2K',
        options: ['1K', '1.5K', '2K'],
        visibility: 'public',
        location: 'table',
      },
      {
        key: 'ratio',
        label: '宽高比',
        type: 'enum',
        default: '1:1',
        options: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
        visibility: 'public',
        location: 'table',
      },
      {
        key: 'layer_decomposition',
        label: '图层拆分',
        type: 'boolean',
        default: false,
        visibility: 'public',
        location: 'body',
        body_field: 'layer_decomposition'
      },
      {
        key: 'background',
        label: '透明底',
        type: 'enum',
        default: 'opaque',
        options: ['opaque', 'transparent'],
        visibility: 'advanced',
        location: 'body',
        body_field: 'background'
      },
      {
        key: 'output_format',
        label: '输出格式',
        type: 'enum',
        default: 'jpeg',
        options: ['jpeg', 'png'],
        visibility: 'advanced',
        location: 'body',
        body_field: 'output_format'
      },
      {
        key: 'response_format',
        label: '返回格式',
        type: 'enum',
        default: 'url',
        options: ['url', 'b64_json'],
        visibility: 'advanced',
        location: 'body',
        body_field: 'response_format'
      },
      {
        key: 'watermark',
        label: '水印',
        type: 'boolean',
        default: false,
        visibility: 'advanced',
        location: 'body',
        body_field: 'watermark'
      },
      {
        key: 'optimize_prompt_options.mode',
        label: '厂商自动优化',
        type: 'enum',
        default: 'off',
        options: ['off', 'standard'],
        option_labels: {
          'off': '关闭',
          'standard': '开启 - 强 (标准)'
        },
        visibility: 'advanced',
        location: 'body',
        body_field: 'optimize_prompt_options.mode'
      },
      { key: 'bbox', label: '框选 0-999（x1 y1 x2 y2）', type: 'text', default: '', visibility: 'advanced', location: 'none' },
      { key: 'point', label: '落位中心点 0-999（x y）', type: 'text', default: '', visibility: 'advanced', location: 'none' }
    ],
    table_mappings: {
      size_ratio: SEEDREAM_FLASH_SIZE_TABLE
    },
    conditional_rules: [
      {
        type: 'layer_decomposition',
        when: { layer_decomposition: true },
        effect: {
          suppress: ['ratio'],
          size_mode: 'direct',
          size_options: ['1K', '1.5K', '2K', 'auto'],
          size_default: 'auto',
          require_single_image: true,
        }
      },
      {
        type: 'transparent_background',
        when: { background: 'transparent' },
        effect: {
          force: { output_format: 'png' },
          require_single_image: true,
        }
      }
    ],
    mutex_groups: [],
    optimizer: {
      optimizer_model_id: 'agnes3_0flash',
      prompt: '',
    }
  },
  {
    id: 'seedream5pro',
    name: 'Seedream 5.0 Pro',
    vendor_model_id: 'doubao-seedream-5-0-pro-260628',
    capability_id: 'ark_image',
    converter: 'ark-seedream',
    enabled: 1,
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图生图' },
      { id: 'image_reference', label: '多参考融合' },
      { id: 'image_edit', label: '交互坐标编辑' },
      { id: 'layer_split', label: '图层拆分' },
      { id: 'expand_fill', label: '扩边填白' },
    ],
    slots: { images: 10, videos: 0, audios: 0 },
    polishHint: '1K/1.5K/2K · 框内替换 · 图层拆分 · 支持极速提示优化(fast)',
    params: [
      { key: 'size', label: '尺寸档', type: 'enum', default: '2K', options: ['1K', '1.5K', '2K'], visibility: 'public', location: 'table' },
      { key: 'ratio', label: '宽高比', type: 'enum', default: '1:1', options: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], visibility: 'public', location: 'table' },
      { key: 'layer_decomposition', label: '图层拆分', type: 'boolean', default: false, visibility: 'public', location: 'body', body_field: 'layer_decomposition' },
      { key: 'background', label: '透明底', type: 'enum', default: 'opaque', options: ['opaque', 'transparent'], visibility: 'advanced', location: 'body', body_field: 'background' },
      { key: 'output_format', label: '输出格式', type: 'enum', default: 'jpeg', options: ['jpeg', 'png'], visibility: 'advanced', location: 'body', body_field: 'output_format' },
      { key: 'response_format', label: '返回格式', type: 'enum', default: 'url', options: ['url', 'b64_json'], visibility: 'advanced', location: 'body', body_field: 'response_format' },
      { key: 'watermark', label: '水印', type: 'boolean', default: false, visibility: 'advanced', location: 'body', body_field: 'watermark' },
      {
        key: 'optimize_prompt_options.mode',
        label: '厂商自动优化',
        type: 'enum',
        default: 'off',
        options: ['off', 'standard', 'fast'],
        option_labels: { off: '关闭', standard: '开启 - 强 (标准)', fast: '开启 - 极速 (Pro专属)' },
        visibility: 'advanced',
        location: 'body',
        body_field: 'optimize_prompt_options.mode',
      },
      { key: 'bbox', label: '框选 0-999（x1 y1 x2 y2）', type: 'text', default: '', visibility: 'advanced', location: 'none' },
      { key: 'point', label: '落位中心点 0-999（x y）', type: 'text', default: '', visibility: 'advanced', location: 'none' },
    ],
    table_mappings: { size_ratio: SEEDREAM_FLASH_SIZE_TABLE },
    conditional_rules: [
      {
        type: 'layer_decomposition',
        when: { layer_decomposition: true },
        effect: {
          suppress: ['ratio'],
          size_mode: 'direct',
          size_options: ['1K', '1.5K', '2K', 'auto'],
          size_default: 'auto',
          require_single_image: true,
        },
      },
      {
        type: 'transparent_background',
        when: { background: 'transparent' },
        effect: {
          force: { output_format: 'png' },
          require_single_image: true,
        },
      },
    ],
    mutex_groups: [],
    optimizer: { optimizer_model_id: 'agnes3_0flash', prompt: '' },
  },
  {
    id: 'seedream5lite',
    name: 'Seedream 5.0 Lite',
    vendor_model_id: 'doubao-seedream-5-0-260128',
    capability_id: 'ark_image',
    converter: 'ark-seedream',
    enabled: 1,
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图生图' },
      { id: 'image_reference', label: '多参考(最多14张)' },
    ],
    slots: { images: 14, videos: 0, audios: 0 },
    polishHint: '2K/3K/4K · 支持组图连拍(最多15张) · 支持联网生图',
    params: [
      { key: 'size', label: '尺寸档', type: 'enum', default: '2K', options: ['2K', '3K', '4K'], visibility: 'public', location: 'body', body_field: 'size' },
      { key: 'ratio', label: '宽高比', type: 'enum', default: '1:1', options: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], visibility: 'public', location: 'none' },
      { key: 'watermark', label: '水印', type: 'boolean', default: false, visibility: 'advanced', location: 'body', body_field: 'watermark' },
      { key: 'n', label: '组图张数', type: 'number', default: 1, min: 1, max: 15, visibility: 'advanced', location: 'body', body_field: 'max_images' },
      {
        key: 'sequential_image_generation',
        label: '组图模式',
        type: 'enum',
        default: 'disabled',
        options: ['disabled', 'auto'],
        option_labels: { disabled: '单张', auto: '组图 auto' },
        visibility: 'advanced',
        location: 'body',
        body_field: 'sequential_image_generation',
      },
      { key: 'output_format', label: '输出格式', type: 'enum', default: 'jpeg', options: ['jpeg', 'png'], visibility: 'advanced', location: 'body', body_field: 'output_format' },
      { key: 'web_search', label: '联网搜索生图', type: 'boolean', default: false, visibility: 'advanced', location: 'body', body_field: 'web_search' },
    ],
    table_mappings: {},
    conditional_rules: [],
    mutex_groups: [],
    optimizer: { optimizer_model_id: 'agnes3_0flash', prompt: '' },
  },
  {
    id: 'agnes_image_2_5_flash',
    name: 'Agnes Image 2.5 Flash',
    vendor_model_id: 'agnes-image-2.5-flash',
    capability_id: 'agnes_image',
    converter: 'agnes-image',
    enabled: 1,
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图生图' },
      { id: 'image_reference', label: '多参考' },
    ],
    slots: { images: 3, videos: 0, audios: 0 },
    free: { maxRefs: 3, sizes: ['1K', '2K'] },
    polishHint: '官方三结构 · 1K/2K/3K/4K 现价免费 · extra_body 规范封装',
    params: [
      {
        key: 'size',
        label: '尺寸档',
        type: 'enum',
        default: '2K',
        options: ['1K', '2K', '3K', '4K'],
        visibility: 'public',
        location: 'body',
        body_field: 'size'
      },
      {
        key: 'ratio',
        label: '宽高比',
        type: 'enum',
        default: '1:1',
        options: ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'],
        visibility: 'public',
        location: 'body',
        body_field: 'ratio'
      },
      {
        key: 'response_format',
        label: '返回格式(extra_body)',
        type: 'enum',
        default: 'url',
        options: ['url', 'b64_json'],
        visibility: 'advanced',
        location: 'body',
        body_field: 'extra_body.response_format'
      }
    ],
    table_mappings: {},
    conditional_rules: [],
    mutex_groups: [],
    optimizer: {
      optimizer_model_id: 'agnes3_0flash',
      prompt: ''
    }
  },
  {
    id: 'seedance2_0',
    name: 'Seedance 2.0',
    vendor_model_id: 'doubao-seedance-2-0-260128',
    capability_id: 'ark_video',
    converter: 'ark-seedance-video',
    refStyle: 'seedance',
    polishHint: '三类公式：参考/编辑/延长 · 4–15s · 图≤9',
    modes: [
      { id: 'text_to_video', label: '文生视频' },
      { id: 'omni_reference', label: '全能参考' },
      { id: 'image_to_video', label: '图生视频' },
      { id: 'first_last_frame', label: '首尾帧' },
    ],
    slots: { images: 9, videos: 3, audios: 3 },
    enabled: 1,
    params: seedance20Params(),
    table_mappings: {},
    conditional_rules: [
      { when: { mode: 'first_last_frame' }, set: { ratio: 'adaptive' }, lock: ['ratio'] },
    ],
    mutex_groups: [],
    optimizer: {
      optimizer_model_id: 'agnes3_0flash',
      prompt: ''
    }
  },
  {
    id: 'seedance2_5',
    name: 'Seedance 2.5',
    vendor_model_id: 'doubao-seedance-2-5-260628',
    capability_id: 'ark_video',
    converter: 'ark-seedance-video',
    refStyle: 'seedance',
    polishHint: '公式：主体+运镜+声音 · @图片1 · 4–30s',
    modes: [
      { id: 'text_to_video', label: '文生视频' },
      { id: 'omni_reference', label: '全能参考' },
      { id: 'image_to_video', label: '图生视频' },
      { id: 'first_last_frame', label: '首尾帧' },
      { id: 'video_edit', label: '视频编辑' },
      { id: 'video_extend', label: '视频延长' },
    ],
    slots: { images: 30, videos: 10, audios: 10 },
    enabled: 1,
    params: seedance25Params(),
    table_mappings: {},
    conditional_rules: [
      { when: { mode: 'first_last_frame' }, set: { ratio: 'adaptive' }, lock: ['ratio'] },
      { when: { mode: 'video_edit' }, set: { ratio: 'adaptive', duration: -1 }, lock: ['ratio', 'duration'] },
      { when: { mode: 'video_extend' }, set: { ratio: 'adaptive' }, lock: ['ratio'] },
    ],
    mutex_groups: [],
    optimizer: {
      optimizer_model_id: 'agnes3_0flash',
      prompt: ''
    }
  },
  {
    id: 'agnes_video_2_5_flash',
    name: 'Agnes Video 2.5 Flash',
    vendor_model_id: 'agnes-video-2.5-flash',
    capability_id: 'agnes_video',
    converter: 'agnes-video',
    refStyle: 'agnes',
    polishHint: '<Picture 1> · 仅 720P · 4–12s',
    modes: [
      { id: 'text_to_video', label: '文生视频' },
      { id: 'image_to_video', label: '参考' },
      { id: 'first_last_frame', label: '首尾帧' },
    ],
    slots: { images: 5, videos: 0, audios: 3 },
    free: { size: '720P', maxRefs: 5, maxAudios: 3, noVideoRef: true },
    enabled: 1,
    params: [
      {
        key: 'aspect_ratio',
        label: '画幅',
        type: 'enum',
        default: '16:9',
        options: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
        visibility: 'public',
        location: 'body',
        body_field: 'aspect_ratio'
      },
      {
        key: 'seconds',
        label: '时长',
        type: 'number',
        default: 5,
        min: 4,
        max: 12,
        visibility: 'public',
        location: 'body',
        body_field: 'seconds'
      },
      {
        key: 'size',
        label: '分辨率',
        type: 'string',
        default: '720P',
        visibility: 'advanced',
        location: 'body',
        body_field: 'size'
      }
    ],
    table_mappings: {},
    conditional_rules: [],
    mutex_groups: [],
    optimizer: {
      optimizer_model_id: 'agnes3_0flash',
      prompt: ''
    }
  },
  {
    id: 'doubao_bgm_v5',
    name: '豆包纯音乐 v5',
    vendor_model_id: 'doubao-bgm-v5',
    capability_id: 'doubao_music_bgm',
    converter: 'doubao-music',
    refStyle: 'generic',
    polishHint: '豆包纯音乐 v5 · 中文描述',
    modes: [
      { id: 'text_to_song', label: '文生歌曲' },
      { id: 'text_to_bgm', label: '文生纯音乐' },
    ],
    slots: { images: 0, videos: 0, audios: 0 },
    enabled: 1,
    params: [
      {
        key: 'Duration',
        label: '时长',
        type: 'number',
        default: 60,
        min: 30,
        max: 120,
        visibility: 'public',
        location: 'body',
        body_field: 'Duration'
      },
      {
        key: 'EnableInputRewrite',
        label: '文本改写',
        type: 'boolean',
        default: false,
        visibility: 'advanced',
        location: 'body',
        body_field: 'EnableInputRewrite'
      },
      {
        key: 'AigcWatermark',
        label: '水印',
        type: 'boolean',
        default: false,
        visibility: 'advanced',
        location: 'body',
        body_field: 'AigcWatermark'
      }
    ],
    table_mappings: {},
    conditional_rules: [],
    mutex_groups: [],
    optimizer: {
      optimizer_model_id: 'agnes3_0flash',
      prompt: ''
    }
  },
  {
    id: 'doubao_song_v5',
    name: '豆包歌曲 v5',
    vendor_model_id: 'doubao-song-v5',
    capability_id: 'doubao_music_song',
    converter: 'doubao-music',
    refStyle: 'generic',
    polishHint: '豆包歌曲 v5 · 提示词或歌词',
    modes: [
      { id: 'text_to_song', label: '文生歌曲' },
      { id: 'text_to_bgm', label: '文生纯音乐' },
    ],
    slots: { images: 0, videos: 0, audios: 0 },
    enabled: 1,
    params: [
      {
        key: 'lang',
        label: '语言',
        type: 'enum',
        default: 'Chinese',
        options: ['Chinese', 'English', 'Cantonese'],
        option_labels: { Chinese: '普通话', English: '英文', Cantonese: '粤语' },
        visibility: 'public',
        location: 'body',
        body_field: 'Lang'
      },
      {
        key: 'Duration',
        label: '时长',
        type: 'number',
        default: 60,
        min: 30,
        max: 240,
        visibility: 'public',
        location: 'body',
        body_field: 'Duration'
      },
      {
        key: 'AigcWatermark',
        label: '水印',
        type: 'boolean',
        default: false,
        visibility: 'advanced',
        location: 'body',
        body_field: 'AigcWatermark'
      }
    ],
    table_mappings: {},
    conditional_rules: [],
    mutex_groups: [],
    optimizer: {
      optimizer_model_id: 'agnes3_0flash',
      prompt: ''
    }
  },
  {
    id: 'qwenimage_local',
    name: 'Qwen-Image 2.1',
    vendor_model_id: 'qwen2.1-image',
    capability_id: 'qwenimage_local',
    enabled: 1,
    params: [
      {
        key: 'qwen_model',
        label: '模型',
        type: 'enum',
        default: 'base',
        options: ['base', 'turbo'],
        option_labels: { base: '标准', turbo: '加速 8 步' },
        visibility: 'public',
        location: 'body',
        body_field: 'qwen_model'
      },
      {
        key: 'size',
        label: '尺寸档',
        type: 'enum',
        default: '1K',
        options: ['1K', '2K'],
        visibility: 'public',
        location: 'table',
      },
      {
        key: 'ratio',
        label: '宽高比',
        type: 'enum',
        default: '1:1',
        options: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        visibility: 'public',
        location: 'table',
      }
    ],
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图像编辑' },
    ],
    slots: { images: 10, videos: 0, audios: 0 },
    table_mappings: {
      size_ratio: QWEN_SIZE_TABLE
    },
    conditional_rules: [],
    mutex_groups: [],
    optimizer: {
      optimizer_model_id: 'agnes3_0flash',
      prompt: ''
    }
  },
  {
    id: 'indextts_local',
    name: 'IndexTTS 2.5',
    vendor_model_id: 'index-tts-2.5',
    capability_id: 'indextts_local',
    enabled: 1,
    params: [
      {
        key: 'lang',
        label: '语言',
        type: 'enum',
        default: 'ZH',
        options: ['ZH', 'EN', 'JA', 'ES', 'AR'],
        option_labels: { ZH: '中文', EN: '英文', JA: '日文', ES: '西班牙文', AR: '阿拉伯文' },
        visibility: 'public',
        location: 'body',
        body_field: 'lang'
      },
      {
        key: 'duration_factor',
        label: '语速',
        type: 'number',
        default: 1,
        min: 0.5,
        max: 2,
        step: 0.1,
        visibility: 'public',
        location: 'body',
        body_field: 'duration_factor'
      }
    ],
    modes: [{ id: 'voice_clone', label: '声音克隆' }],
    slots: { images: 0, videos: 0, audios: 2 },
    table_mappings: {},
    conditional_rules: [],
    mutex_groups: [],
    optimizer: { optimizer_model_id: 'agnes3_0flash', prompt: '' }
  },
  {
    id: 'acestep_local',
    name: 'ACE-Step 1.5',
    vendor_model_id: 'acestep-1.5',
    capability_id: 'acestep_local',
    enabled: 1,
    params: [
      {
        key: 'duration',
        label: '时长',
        type: 'number',
        default: 30,
        min: 10,
        max: 240,
        visibility: 'public',
        location: 'body',
        body_field: 'audio_duration'
      },
      {
        key: 'batch_size',
        label: '数量',
        type: 'number',
        default: 1,
        min: 1,
        max: 4,
        visibility: 'advanced',
        location: 'body',
        body_field: 'batch_size'
      }
    ],
    modes: [
      { id: 'text_to_bgm', label: '纯音乐' },
      { id: 'text_to_song', label: '人声歌曲' },
    ],
    slots: { images: 0, videos: 0, audios: 0 },
    table_mappings: {},
    conditional_rules: [],
    mutex_groups: [],
    optimizer: { optimizer_model_id: 'agnes3_0flash', prompt: '' }
  },
  ...LITELLM_TEXT_CONTRACTS,
];

// ================= 官方提示词基线中心定义 =================
const {
  OFFICIAL_PROMPT_SNIPPETS,
  OFFICIAL_PROMPT_TEMPLATES,
  OPERATOR_CATALOG,
  getOperatorCatalog,
  getOperatorSpec,
} = require('./nodes/operator-catalog');

const {
  DICT_MACRO_SPECS,
  expandDictMacros,
  getDictMacroChips,
  interpolateVariables,
  defaultDialectForModel,
  resolveModelDialect,
  resolveSnippets,
  applyDialectTransforms,
  findActiveWorkflowNode,
  compileNodePrompt,
} = require('./prompt-compiler');

// ================= 预设工作流与挂载点清单 (大框架插座 + 中框架可增删改工作流) =================
const DEFAULT_MOUNT_POINTS = [
  {
    id: 'ingest_pre_gate',
    name: '入库前置门禁工作流',
    category: 'ingest',
    description: '素材落盘后首道前置门禁：源图落盘、轻量算法物理质检、多品类视觉门禁判定、AI 视觉缺陷拦截',
    trigger_type: 'event',
    trigger_config: { event: 'asset.materialized', slot: 'ingest.pre_gate' },
    is_builtin: 1,
    order_num: 1,
    enabled: 1
  },
  {
    id: 'ingest_post_process',
    name: '入库后置多品类打标与净画重构工作流',
    category: 'ingest',
    description: '通过门禁后的深度处理管线：四品类分支路由打标(室内/家具/服装/人像)、视觉查重归组、无模糊垫边双画幅净画重构、语义向量入库',
    trigger_type: 'event',
    trigger_config: { event: 'gate.passed', slot: 'ingest.post_process' },
    is_builtin: 1,
    order_num: 2,
    enabled: 1
  },
  {
    id: 'precision_edit',
    name: '精准修改综合算子工作流群',
    category: 'edit',
    description: '画布与素材详情触发的 8 大精修算子配置：扩图、局部安装、精准替换、局部新增、智能消除、去水印、留白、全屋风格重塑、超分',
    trigger_type: 'api',
    trigger_config: { path: '/api/edit/run', slot: 'edit.all_ops' },
    is_builtin: 1,
    order_num: 3,
    enabled: 1
  },
  {
    id: 'studio_generate',
    name: '生成工坊多模态创意工作流',
    category: 'studio',
    description: '工坊多模态生成：模型专属提示词优化（按需叠加公共积木）、效果图生图、视频漫游生成、空间氛围配乐生成',
    trigger_type: 'api',
    trigger_config: { path: '/api/gen/run', slot: 'studio.generate' },
    is_builtin: 1,
    order_num: 4,
    enabled: 1
  },
  {
    id: 'wf_edit_replace_pipeline',
    name: '精准替换 3 步原子节点工作流 (Replace)',
    category: 'edit',
    description: '将 3D/参考图单品替换拆解为 3 个可独立调优的工作流节点：选区语义路由 -> 3D 朝向合成重绘 -> 框外像素无损羽化贴回',
    trigger_type: 'api',
    trigger_config: { path: '/api/edit/run?op=replace', slot: 'edit.replace_pipeline' },
    is_builtin: 0,
    order_num: 5,
    enabled: 1
  },
  {
    id: 'wf_edit_insert_pipeline',
    name: '2D 软装局部安装 5 步原子节点工作流 (Insert)',
    category: 'edit',
    description: '将 2D 软装安装拆解为 5 个可增删改的工作流节点：边缘泛洪抠底 -> 模式C环境光预对齐 -> 四点透视仿射贴合 -> 接触阴影融合重绘 -> 外扩12%羽化贴回',
    trigger_type: 'api',
    trigger_config: { path: '/api/edit/run?op=insert', slot: 'edit.insert_pipeline' },
    is_builtin: 0,
    order_num: 6,
    enabled: 1
  },
  {
    id: 'wf_video_slice_frame',
    name: '视频镜头智能切片与关键帧抽帧打标工作流',
    category: 'video',
    description: '针对上传或入库的长视频：FFmpeg 镜头切换智能切片 -> 关键帧抽取 -> 模糊黑场帧质检过滤 -> 动态词典多维打标 -> 注册为独立新素材入库',
    trigger_type: 'api',
    trigger_config: { path: '/api/tools/extract-frames', slot: 'video.slice_and_frame' },
    is_builtin: 0,
    order_num: 7,
    enabled: 1
  },
  {
    id: 'wf_studio_walkthrough',
    name: '多图空间漫游与氛围配乐合成工作流',
    category: 'video',
    description: '针对 2-6 张空间实拍图：多图空间连通拓扑推断 -> 一镜到底漫游运镜导演脚本 -> 首尾帧视频渲染 -> 空间氛围纯音乐配乐生成',
    trigger_type: 'api',
    trigger_config: { path: '/api/ai/walkthrough', slot: 'studio.walkthrough' },
    is_builtin: 0,
    order_num: 8,
    enabled: 1
  }
];

// ================= 预设工作流节点清单 (中框架核心子单位：每个节点均可独立增删改与单步试跑) =================
const DEFAULT_MODULES = [
  // --- 1. 入库前置门禁工作流 (ingest_pre_gate) ---
  {
    id: 'mod_pre_qc',
    mount_point_id: 'ingest_pre_gate',
    name: '前置轻量算法质检',
    node_type: 'script_qc',
    model_id: null,
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { phashThreshold: 8, minShortSide: 480, minBytes: 15360, barRatio: 0.06, minLaplacianVar: 35 },
    order_num: 1,
    enabled: 1
  },
  {
    id: 'mod_pre_gate',
    mount_point_id: 'ingest_pre_gate',
    name: '多品类门禁视觉判定',
    node_type: 'gate',
    model_id: 'workflow_vision',
    prompt_id: 'gate_interior',
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { temperature: 0.1, timeoutMs: 30000, fallbackStrategy: 'manual_review' },
    order_num: 2,
    enabled: 1
  },
  {
    id: 'mod_pre_defect',
    mount_point_id: 'ingest_pre_gate',
    name: 'AI 视觉缺陷质检拦截',
    node_type: 'defect',
    model_id: 'workflow_vision',
    prompt_id: 'defect_inspection',
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { temperature: 0.1, timeoutMs: 30000, barCheck: true, fallbackStrategy: 'warn_continue' },
    order_num: 3,
    enabled: 1
  },

  // --- 2. 入库后置处理工作流 (ingest_post_process，含四品类显式路由分支节点) ---
  {
    id: 'mod_post_tag',
    mount_point_id: 'ingest_post_process',
    name: '【分支 1 · 室内/建筑】空间多维打标',
    node_type: 'tag',
    model_id: 'workflow_vision',
    prompt_id: 'tag_space_interior',
    prompt_override: null,
    condition_expr: "category == 'interior' || category == 'exterior'",
    branch_group: 'tag_category',
    snippet_ids: [],
    params: { temperature: 0.1, categoryScope: 'interior', skipCluster: true, phashThreshold: 5 },
    order_num: 1,
    enabled: 1
  },
  {
    id: 'mod_post_tag_furniture',
    mount_point_id: 'ingest_post_process',
    name: '【分支 2 · 家具单品】买手鉴定打标',
    node_type: 'tag_furniture',
    model_id: 'workflow_vision',
    prompt_id: 'tag_furniture',
    prompt_override: null,
    condition_expr: "category == 'furniture'",
    branch_group: 'tag_category',
    snippet_ids: [],
    params: { temperature: 0.1, categoryScope: 'furniture', skipCluster: true, phashThreshold: 5 },
    order_num: 2,
    enabled: 1
  },
  {
    id: 'mod_post_tag_clothing',
    mount_point_id: 'ingest_post_process',
    name: '【分支 3 · 服装穿搭】买手打标',
    node_type: 'tag_clothing',
    model_id: 'workflow_vision',
    prompt_id: 'tag_clothing',
    prompt_override: null,
    condition_expr: "category == 'clothing'",
    branch_group: 'tag_category',
    snippet_ids: [],
    params: { temperature: 0.1, categoryScope: 'clothing', skipCluster: true },
    order_num: 3,
    enabled: 1
  },
  {
    id: 'mod_post_tag_portrait',
    mount_point_id: 'ingest_post_process',
    name: '【分支 4 · 人物肖像】气质与景别打标',
    node_type: 'tag_portrait',
    model_id: 'workflow_vision',
    prompt_id: 'tag_portrait',
    prompt_override: null,
    condition_expr: "category == 'portrait'",
    branch_group: 'tag_category',
    snippet_ids: [],
    params: { temperature: 0.1, categoryScope: 'portrait', skipCluster: true },
    order_num: 4,
    enabled: 1
  },
  {
    id: 'mod_post_cluster',
    mount_point_id: 'ingest_post_process',
    name: '视觉查重与空间归组',
    node_type: 'cluster',
    model_id: null,
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { phashThreshold: 5, clusterWindowDays: 14 },
    order_num: 5,
    enabled: 1
  },
  {
    id: 'mod_post_restage',
    mount_point_id: 'ingest_post_process',
    name: 'AI 双画幅无损净画重构 (9:16 & 3:4 · 无模糊垫边)',
    node_type: 'restage_dual',
    model_id: 'agnes-image-2.5-flash',
    prompt_id: 'style_restage_dual',
    prompt_override: null,
    condition_expr: "category == 'interior' || category == 'exterior'",
    snippet_ids: ['snippet_interior_realism', 'snippet_clean_border'],
    params: { ratios: ['9:16', '3:4'], sizePreset: '1080p', timeoutMs: 120000 },
    order_num: 6,
    enabled: 1
  },
  {
    id: 'mod_post_index',
    mount_point_id: 'ingest_post_process',
    name: '多模态语义向量提取与入库',
    node_type: 'index',
    model_id: 'text-embedding-3-small',
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { embeddingProvider: 'litellm', embeddingModel: 'text-embedding-3-small' },
    order_num: 7,
    enabled: 1
  },

  // --- 3. 精准修改综合算子工作流群 (precision_edit) ---
  {
    id: 'mod_edit_expand',
    mount_point_id: 'precision_edit',
    name: '智能扩图 (Outpaint)',
    node_type: 'edit_expand',
    model_id: 'umbra.expand',
    prompt_id: 'precision_expand',
    prompt_override: null,
    condition_expr: "op == 'expand'",
    snippet_ids: ['snippet_clean_border'],
    params: { allowedRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
    order_num: 1,
    enabled: 1
  },
  {
    id: 'mod_edit_insert',
    mount_point_id: 'precision_edit',
    name: '局部安装融合 (Insert)',
    node_type: 'edit_insert',
    model_id: 'seedream5pro',
    prompt_id: 'precision_insert',
    prompt_override: null,
    condition_expr: "op == 'insert'",
    snippet_ids: ['snippet_interior_realism'],
    params: { detectSubjectBbox: true, mode: 'B' },
    order_num: 2,
    enabled: 1
  },
  {
    id: 'mod_edit_replace',
    mount_point_id: 'precision_edit',
    name: '精准替换单品 (Replace)',
    node_type: 'edit_replace',
    model_id: 'seedream5pro',
    prompt_id: 'precision_replace',
    prompt_override: null,
    condition_expr: "op == 'replace'",
    snippet_ids: ['snippet_interior_realism'],
    params: { yawAlign: true, pasteback: true },
    order_num: 3,
    enabled: 1
  },
  {
    id: 'mod_edit_add',
    mount_point_id: 'precision_edit',
    name: '空地局部新增 (Add)',
    node_type: 'edit_add',
    model_id: 'seedream5pro',
    prompt_id: 'precision_add',
    prompt_override: null,
    condition_expr: "op == 'add'",
    snippet_ids: ['snippet_interior_realism'],
    params: { pasteback: true },
    order_num: 4,
    enabled: 1
  },
  {
    id: 'mod_edit_remove',
    mount_point_id: 'precision_edit',
    name: '智能消除杂物 (Remove)',
    node_type: 'edit_remove',
    model_id: 'seedream5pro',
    prompt_id: 'precision_remove',
    prompt_override: null,
    condition_expr: "op == 'remove'",
    snippet_ids: ['snippet_interior_realism'],
    params: { pasteback: true },
    order_num: 5,
    enabled: 1
  },
  {
    id: 'mod_edit_clean',
    mount_point_id: 'precision_edit',
    name: '去水印净画 (Clean)',
    node_type: 'edit_clean',
    model_id: 'seedream5pro',
    prompt_id: 'watermark_clean',
    prompt_override: null,
    condition_expr: "op == 'watermark'",
    snippet_ids: [],
    params: { pasteback: true },
    order_num: 6,
    enabled: 1
  },
  {
    id: 'mod_edit_space',
    mount_point_id: 'precision_edit',
    name: '智能留白平移 (Space)',
    node_type: 'edit_space',
    model_id: 'seedream5pro',
    prompt_id: 'precision_space',
    prompt_override: null,
    condition_expr: "op == 'space'",
    snippet_ids: ['snippet_interior_realism'],
    params: { gapPct: 18 },
    order_num: 7,
    enabled: 1
  },
  {
    id: 'mod_edit_style_transfer',
    mount_point_id: 'precision_edit',
    name: '全空间风格系统重塑 (Style Transfer)',
    node_type: 'edit_style_transfer',
    model_id: 'seedream5pro',
    prompt_id: 'precision_style_transfer',
    prompt_override: null,
    condition_expr: "op == 'style_transfer'",
    snippet_ids: ['snippet_interior_realism'],
    params: { strengthLevel: 'standard' },
    order_num: 8,
    enabled: 1
  },
  {
    id: 'mod_edit_upscale',
    mount_point_id: 'precision_edit',
    name: '超分高清增强 (Upscale)',
    node_type: 'edit_upscale',
    model_id: 'seedream5pro',
    prompt_id: 'upscale_enhance',
    prompt_override: null,
    condition_expr: "op == 'clarity' || op == 'enhance'",
    snippet_ids: ['snippet_interior_realism'],
    params: { scale: 4 },
    order_num: 9,
    enabled: 1
  },

  // --- 4. 生成工坊多模态创意工作流 (studio_generate) ---
  {
    id: 'mod_gen_chat',
    mount_point_id: 'studio_generate',
    name: '对话与专属提示词优化器',
    node_type: 'chat_optimize',
    model_id: 'agnes-3.0-flash',
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: ['snippet_interior_realism'],
    params: { temperature: 0.4 },
    order_num: 1,
    enabled: 1
  },
  {
    id: 'mod_gen_image',
    mount_point_id: 'studio_generate',
    name: '多模态效果图生成',
    node_type: 'image_gen',
    model_id: 'seedream5flash',
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: ['snippet_interior_realism'],
    params: { auto_optimize: true },
    order_num: 2,
    enabled: 1
  },
  {
    id: 'mod_gen_video',
    mount_point_id: 'studio_generate',
    name: '视频漫游动态生成',
    node_type: 'video_gen',
    model_id: 'seedance2_0',
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { duration: 5 },
    order_num: 3,
    enabled: 1
  },
  {
    id: 'mod_gen_music',
    mount_point_id: 'studio_generate',
    name: '空间氛围配乐生成',
    node_type: 'music_gen',
    model_id: 'doubao_bgm_v5',
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: {},
    order_num: 4,
    enabled: 1
  },

  // --- 5. 精准替换 3 步原子节点工作流 (wf_edit_replace_pipeline) ---
  {
    id: 'mod_rep_step1_vlm',
    mount_point_id: 'wf_edit_replace_pipeline',
    name: '步骤 1：选区能力路由与局部物体识别',
    node_type: 'region_vlm',
    model_id: 'workflow_vision',
    prompt_id: 'region_vlm_describe',
    prompt_override: null,
    condition_expr: "dialect.region_mode == 'vlm_text'",
    snippet_ids: [],
    params: { expandPaddingRatio: 0.25, minCropPx: 512 },
    order_num: 1,
    enabled: 1
  },
  {
    id: 'mod_rep_step2_gen',
    mount_point_id: 'wf_edit_replace_pipeline',
    name: '步骤 2：3D 固定机位朝向合成与替换重绘',
    node_type: 'edit_replace',
    model_id: 'seedream5pro',
    prompt_id: 'precision_replace',
    prompt_override: null,
    condition_expr: '',
    snippet_ids: ['snippet_interior_realism'],
    params: { yawAlign: true },
    order_num: 2,
    enabled: 1
  },
  {
    id: 'mod_rep_step3_paste',
    mount_point_id: 'wf_edit_replace_pipeline',
    name: '步骤 3：选区外扩羽化无损贴回 (框外像素保护)',
    node_type: 'algo_pasteback',
    model_id: null,
    prompt_id: null,
    prompt_override: null,
    condition_expr: 'pasteback != false',
    snippet_ids: [],
    params: { expandFeatherPct: 0.12, verifyUntouchedDiff: true },
    order_num: 3,
    enabled: 1
  },

  // --- 6. 2D 软装局部安装 5 步原子节点工作流 (wf_edit_insert_pipeline) ---
  {
    id: 'mod_ins_step1_cutout',
    mount_point_id: 'wf_edit_insert_pipeline',
    name: '步骤 1：2D 单品边缘泛洪自动抠底 (透明 PNG)',
    node_type: 'algo_cutout',
    model_id: null,
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { tolerance: 36 },
    order_num: 1,
    enabled: 1
  },
  {
    id: 'mod_ins_step2_relit',
    mount_point_id: 'wf_edit_insert_pipeline',
    name: '步骤 2：模式 C 环境光色温预对齐重绘',
    node_type: 'edit_insert_relit',
    model_id: 'seedream5pro',
    prompt_id: 'precision_insert_mode_c',
    prompt_override: null,
    condition_expr: "mode == 'C'",
    snippet_ids: [],
    params: { cutoutTolerance: 40 },
    order_num: 2,
    enabled: 1
  },
  {
    id: 'mod_ins_step3_affine',
    mount_point_id: 'wf_edit_insert_pipeline',
    name: '步骤 3：四点透视仿射贴合与邻域外扩 90% 裁剪',
    node_type: 'algo_affine',
    model_id: null,
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { cropNeighborhoodRatio: 0.9, maxLongSide: 2048 },
    order_num: 3,
    enabled: 1
  },
  {
    id: 'mod_ins_step4_gen',
    mount_point_id: 'wf_edit_insert_pipeline',
    name: '步骤 4：接触阴影与场景漫反射融合重绘',
    node_type: 'edit_insert',
    model_id: 'seedream5pro',
    prompt_id: 'precision_insert',
    prompt_override: null,
    condition_expr: '',
    snippet_ids: ['snippet_interior_realism'],
    params: { forcePasteback: true },
    order_num: 4,
    enabled: 1
  },
  {
    id: 'mod_ins_step5_paste',
    mount_point_id: 'wf_edit_insert_pipeline',
    name: '步骤 5：外扩 12% 强制羽化贴回原图',
    node_type: 'algo_pasteback',
    model_id: null,
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { expandFeatherPct: 0.12 },
    order_num: 5,
    enabled: 1
  },

  // --- 7. 视频镜头智能切片与关键帧抽帧打标工作流 (wf_video_slice_frame) ---
  {
    id: 'mod_vid_step1_slice',
    mount_point_id: 'wf_video_slice_frame',
    name: '步骤 1：FFmpeg 视频镜头切换智能切片 (scdet)',
    node_type: 'video_slice',
    model_id: null,
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { sliceMode: 'scene_detect', sceneThreshold: 0.3, clipDurationSec: 5, maxClips: 12 },
    order_num: 1,
    enabled: 1
  },
  {
    id: 'mod_vid_step2_frames',
    mount_point_id: 'wf_video_slice_frame',
    name: '步骤 2：FFmpeg 抽取高清关键帧序列 (I-Frame)',
    node_type: 'video_extract_frames',
    model_id: null,
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { mode: 'keyframe', intervalSeconds: 2, maxFrames: 12 },
    order_num: 2,
    enabled: 1
  },
  {
    id: 'mod_vid_step3_qc',
    mount_point_id: 'wf_video_slice_frame',
    name: '步骤 3：抽取帧清晰度与黑场过滤质检',
    node_type: 'script_qc',
    model_id: null,
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { minShortSide: 480, barRatio: 0.08, minLaplacianVar: 40 },
    order_num: 3,
    enabled: 1
  },
  {
    id: 'mod_vid_step4_tag',
    mount_point_id: 'wf_video_slice_frame',
    name: '步骤 4：关键帧与分镜 VLM 多维打标',
    node_type: 'tag',
    model_id: 'workflow_vision',
    prompt_id: 'tag_space_interior',
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { temperature: 0.1 },
    order_num: 4,
    enabled: 1
  },
  {
    id: 'mod_vid_step5_save',
    mount_point_id: 'wf_video_slice_frame',
    name: '步骤 5：分镜视频与合格关键帧注册入库',
    node_type: 'save_derivative',
    model_id: null,
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { saveAs: 'new_asset', derivativeKind: 'video_frame' },
    order_num: 5,
    enabled: 1
  },

  // --- 8. 多图空间漫游与氛围配乐合成工作流 (wf_studio_walkthrough) ---
  {
    id: 'mod_wt_step1_topo',
    mount_point_id: 'wf_studio_walkthrough',
    name: '步骤 1：多图空间连通拓扑与房间顺序推断',
    node_type: 'vlm_topology',
    model_id: 'agnes-3.0-flash',
    prompt_id: 'walkthrough_topology',
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { temperature: 0.2, maxImages: 6 },
    order_num: 1,
    enabled: 1
  },
  {
    id: 'mod_wt_step2_dir',
    mount_point_id: 'wf_studio_walkthrough',
    name: '步骤 2：一镜到底漫游运镜导演脚本规划',
    node_type: 'vlm_topology',
    model_id: 'agnes-3.0-flash',
    prompt_id: 'walkthrough_director',
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { temperature: 0.3 },
    order_num: 2,
    enabled: 1
  },
  {
    id: 'mod_wt_step3_video',
    mount_point_id: 'wf_studio_walkthrough',
    name: '步骤 3：首尾帧空间漫游视频渲染',
    node_type: 'video_gen',
    model_id: 'seedance2_0',
    prompt_id: 'walkthrough_director',
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { duration: 5, resolution: '720p', ratio: '16:9' },
    order_num: 3,
    enabled: 1
  },
  {
    id: 'mod_wt_step4_bgm',
    mount_point_id: 'wf_studio_walkthrough',
    name: '步骤 4：空间氛围纯音乐配乐生成',
    node_type: 'music_gen',
    model_id: 'doubao_bgm_v5',
    prompt_id: null,
    prompt_override: null,
    condition_expr: '',
    snippet_ids: [],
    params: { duration: 30, instrumental: true },
    order_num: 4,
    enabled: 1
  }
];

function initModelRegistryTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS llm_endpoints (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT,
      auth_type TEXT NOT NULL DEFAULT 'bearer',
      sign_service TEXT,
      sign_version TEXT,
      credentials_json TEXT,
      config_json TEXT,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS llm_capabilities (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES llm_endpoints(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'path',
      path TEXT,
      action TEXT,
      method TEXT NOT NULL DEFAULT 'POST',
      poll_path TEXT,
      poll_action TEXT,
      config_json TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS model_contracts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      vendor_model_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      params_json TEXT,
      table_mappings_json TEXT,
      mutex_groups_json TEXT,
      conditional_rules_json TEXT,
      optimizer_json TEXT,
      dialect_json TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS prompt_snippets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'realism',
      description TEXT,
      positive_text TEXT NOT NULL DEFAULT '',
      negative_text TEXT NOT NULL DEFAULT '',
      is_builtin INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      version INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      template TEXT NOT NULL,
      variables_schema_json TEXT,
      is_builtin INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS workflow_mount_points (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'event',
      trigger_config_json TEXT,
      is_builtin INTEGER DEFAULT 0,
      order_num INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS workflow_modules (
      id TEXT PRIMARY KEY,
      mount_point_id TEXT NOT NULL REFERENCES workflow_mount_points(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      node_type TEXT NOT NULL,
      model_id TEXT,
      prompt_id TEXT,
      prompt_override TEXT,
      condition_expr TEXT DEFAULT '',
      branch_group TEXT DEFAULT '',
      snippet_ids_json TEXT DEFAULT '[]',
      input_mappings_json TEXT,
      params_json TEXT,
      order_num INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  try { db.exec('ALTER TABLE llm_capabilities ADD COLUMN poll_action TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE model_contracts ADD COLUMN dialect_json TEXT'); } catch (_) {}
  try { db.exec("ALTER TABLE workflow_modules ADD COLUMN condition_expr TEXT DEFAULT ''"); } catch (_) {}
  try { db.exec("ALTER TABLE workflow_modules ADD COLUMN branch_group TEXT DEFAULT ''"); } catch (_) {}
  try { db.exec("ALTER TABLE workflow_modules ADD COLUMN snippet_ids_json TEXT DEFAULT '[]'"); } catch (_) {}

  const now = Date.now();
  const insEndpoint = db.prepare(`
    INSERT INTO llm_endpoints (id, provider_id, name, base_url, auth_type, sign_service, sign_version, credentials_json, config_json, enabled, created_at, updated_at)
    VALUES (@id, @provider_id, @name, @base_url, @auth_type, @sign_service, @sign_version, @credentials_json, @config_json, @enabled, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      base_url=excluded.base_url,
      auth_type=excluded.auth_type,
      sign_service=excluded.sign_service,
      sign_version=excluded.sign_version,
      credentials_json=CASE
        WHEN excluded.id='agnes_intl' THEN
          CASE
            WHEN llm_endpoints.credentials_json = (SELECT credentials_json FROM llm_endpoints WHERE id='agnes') THEN '[]'
            WHEN REPLACE(REPLACE(REPLACE(COALESCE(llm_endpoints.credentials_json, ''), ' ', ''), '"', ''), '''', '') = '[AGNES_API_KEY]' THEN '[]'
            ELSE COALESCE(llm_endpoints.credentials_json, '[]')
          END
        ELSE excluded.credentials_json
      END,
      config_json=excluded.config_json,
      updated_at=excluded.updated_at
  `);

  const insCapability = db.prepare(`
    INSERT INTO llm_capabilities (id, endpoint_id, name, kind, type, path, action, method, poll_path, poll_action, config_json, created_at, updated_at)
    VALUES (@id, @endpoint_id, @name, @kind, @type, @path, @action, @method, @poll_path, @poll_action, @config_json, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      endpoint_id=excluded.endpoint_id,
      name=excluded.name,
      kind=excluded.kind,
      type=excluded.type,
      path=excluded.path,
      action=excluded.action,
      method=excluded.method,
      poll_path=excluded.poll_path,
      poll_action=excluded.poll_action,
      config_json=excluded.config_json,
      updated_at=excluded.updated_at
  `);

  const insContract = db.prepare(`
    INSERT INTO model_contracts (id, name, vendor_model_id, capability_id, enabled, params_json, table_mappings_json, mutex_groups_json, conditional_rules_json, optimizer_json, dialect_json, created_at, updated_at)
    VALUES (@id, @name, @vendor_model_id, @capability_id, @enabled, @params_json, @table_mappings_json, @mutex_groups_json, @conditional_rules_json, @optimizer_json, @dialect_json, @now, @now)
    ON CONFLICT(id) DO NOTHING
  `);

  for (const ep of DEFAULT_ENDPOINTS) {
    insEndpoint.run({
      id: ep.id,
      provider_id: ep.provider_id,
      name: ep.name,
      base_url: ep.base_url,
      auth_type: ep.auth_type,
      sign_service: ep.sign_service,
      sign_version: ep.sign_version,
      credentials_json: JSON.stringify(ep.credentials || []),
      config_json: JSON.stringify({}),
      enabled: ep.enabled ?? 1,
      now
    });

    for (const cap of (ep.capabilities || [])) {
      insCapability.run({
        id: cap.id,
        endpoint_id: ep.id,
        name: cap.name,
        kind: cap.kind,
        type: cap.type || 'path',
        path: cap.path || null,
        action: cap.action || null,
        method: cap.method || 'POST',
        poll_path: cap.poll_path || null,
        poll_action: cap.poll_action || null,
        config_json: JSON.stringify({}),
        now
      });
    }
  }

  for (const mc of DEFAULT_MODEL_CONTRACTS) {
    seedStoredContract(db, insContract, mc, now);
  }

  // 补齐存量模型契约的 dialect_json 三开关默认值
  try {
    const allMcRows = db.prepare('SELECT id, dialect_json FROM model_contracts').all();
    const updDialect = db.prepare('UPDATE model_contracts SET dialect_json=? WHERE id=?');
    for (const r of allMcRows) {
      if (!r.dialect_json) {
        updDialect.run(JSON.stringify(defaultDialectForModel(r.id)), r.id);
      }
    }
  } catch (_) {}

  // 种子化公共提示词积木中心 (Prompt Snippets)
  const insSnippet = db.prepare(`
    INSERT INTO prompt_snippets (id, name, category, description, positive_text, negative_text, is_builtin, enabled, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  for (const s of Object.values(OFFICIAL_PROMPT_SNIPPETS)) {
    insSnippet.run(s.id, s.name, s.category, s.description || '', s.positive_text, s.negative_text, s.is_builtin ? 1 : 0, s.enabled ?? 1, now, now);
  }

  // 种子化官方提示词基线中心 (同时自动修复旧版 10 行残缺的 tag_space_interior 为带 {{@dict.xxx}} 宏的完整版)
  const insPrompt = db.prepare(`
    INSERT INTO prompt_templates (id, name, category, template, variables_schema_json, is_builtin, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, '[]', 1, 1, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  for (const p of Object.values(OFFICIAL_PROMPT_TEMPLATES)) {
    insPrompt.run(p.id, p.name, p.category, p.template, now, now);
  }
  try {
    const oldTagRow = db.prepare("SELECT template FROM prompt_templates WHERE id='tag_space_interior'").get();
    if (oldTagRow && !String(oldTagRow.template).includes('{{@dict.space}}') && String(oldTagRow.template).length < 500) {
      db.prepare("UPDATE prompt_templates SET template=?, name=?, updated_at=? WHERE id='tag_space_interior'")
        .run(OFFICIAL_PROMPT_TEMPLATES.tag_space_interior.template, OFFICIAL_PROMPT_TEMPLATES.tag_space_interior.name, now);
    }
  } catch (_) {}

  // 种子化官方工作流挂载点
  const insMountPoint = db.prepare(`
    INSERT INTO workflow_mount_points (id, name, category, description, trigger_type, trigger_config_json, is_builtin, order_num, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  for (const mp of DEFAULT_MOUNT_POINTS) {
    insMountPoint.run(
      mp.id,
      mp.name,
      mp.category,
      mp.description,
      mp.trigger_type,
      JSON.stringify(mp.trigger_config || {}),
      mp.is_builtin,
      mp.order_num,
      mp.enabled,
      now,
      now
    );
  }

  // 种子化工作流节点 (Modules)
  const insModule = db.prepare(`
    INSERT INTO workflow_modules (id, mount_point_id, name, node_type, model_id, prompt_id, prompt_override, condition_expr, branch_group, snippet_ids_json, input_mappings_json, params_json, order_num, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      condition_expr=CASE WHEN COALESCE(workflow_modules.condition_expr, '')='' THEN excluded.condition_expr ELSE workflow_modules.condition_expr END,
      branch_group=CASE WHEN COALESCE(workflow_modules.branch_group, '')='' THEN excluded.branch_group ELSE workflow_modules.branch_group END,
      snippet_ids_json=CASE WHEN COALESCE(workflow_modules.snippet_ids_json, '[]')='[]' THEN excluded.snippet_ids_json ELSE workflow_modules.snippet_ids_json END
  `);
  for (const mod of DEFAULT_MODULES) {
    insModule.run(
      mod.id,
      mod.mount_point_id,
      mod.name,
      mod.node_type,
      mod.model_id,
      mod.prompt_id,
      mod.prompt_override,
      mod.condition_expr || '',
      mod.branch_group || '',
      JSON.stringify(mod.snippet_ids || []),
      JSON.stringify(mod.params || {}),
      mod.order_num,
      mod.enabled,
      now,
      now
    );
  }

  // 启动/初始化时立即将挂载点与节点配置（含 defect 视觉缺陷拦截节点）同步进 workflows.default
  syncMountPointsToWorkflowGraph(db);
  scrubEndpointCredentials(db);
}

function looksLikeSecretString(value) {
  const text = String(value || '');
  if (/^[A-Z][A-Z0-9_]+$/.test(text)) return false;
  if (text.length >= 24) return true;
  return /^(sk-|AIza|gsk_|AKIA)/.test(text);
}

function scrubEndpointCredentials(db) {
  let rows = [];
  try {
    rows = db.prepare('SELECT id, credentials_json FROM llm_endpoints').all();
  } catch (_) {
    return;
  }
  const upd = db.prepare('UPDATE llm_endpoints SET credentials_json=? WHERE id=?');
  for (const row of rows) {
    let creds = [];
    try { creds = JSON.parse(row.credentials_json || '[]'); } catch { creds = []; }
    if (!Array.isArray(creds)) continue;
    const next = [];
    let changed = false;
    for (const item of creds) {
      if (typeof item === 'string') {
        if (looksLikeSecretString(item)) { changed = true; continue; }
        next.push(item);
        continue;
      }
      if (item && typeof item === 'object') {
        if (item.source === 'provider_secrets') { changed = true; continue; }
        const copy = { ...item };
        for (const key of ['value', 'api_key', 'apiKey', 'ak', 'sk', 'key', 'token']) {
          if (Object.prototype.hasOwnProperty.call(copy, key)) {
            delete copy[key];
            changed = true;
          }
        }
        next.push(copy);
        continue;
      }
      next.push(item);
    }
    if (changed) upd.run(JSON.stringify(next), row.id);
  }
}

function seedanceParamsNeedRepair(params) {
  if (!Array.isArray(params) || !params.length) return true;
  const dur = params.find((p) => p.key === 'duration');
  if (!params.some((p) => p.key === 'resolution')) return true;
  if (!dur || Number(dur.max) === 12 || dur.type !== 'duration') return true;
  return false;
}

function baselineOptimizer(mc) {
  const { POLISH_PROMPTS } = require('./polish-prompts');
  const base = { ...(mc.optimizer || {}) };
  if (!String(base.prompt || '').trim() && POLISH_PROMPTS[mc.id]) base.prompt = POLISH_PROMPTS[mc.id];
  return base;
}

/** 新行写入官方技能。已有非空技能不覆盖。已保存的显示名与非 Seedance 参数不覆盖。Seedance 只在时长被收成 4–12 或丢掉分辨率时按原 schema 修回。 */
function seedStoredContract(db, insContract, mc, now) {
  const seedOpt = baselineOptimizer(mc);
  const existing = db.prepare('SELECT name, vendor_model_id, capability_id, optimizer_json, params_json FROM model_contracts WHERE id=?').get(mc.id);
  if (!existing) {
    insContract.run({
      id: mc.id,
      name: mc.name,
      vendor_model_id: mc.vendor_model_id,
      capability_id: mc.capability_id,
      enabled: mc.enabled ?? 1,
      params_json: JSON.stringify(mc.params || []),
      table_mappings_json: JSON.stringify(mc.table_mappings || {}),
      mutex_groups_json: JSON.stringify(mc.mutex_groups || []),
      conditional_rules_json: JSON.stringify(mc.conditional_rules || []),
      optimizer_json: JSON.stringify(seedOpt),
      dialect_json: JSON.stringify(defaultDialectForModel(mc.id)),
      now
    });
    return;
  }

  const modelName = existing.name || mc.name;
  let opt = {};
  try { opt = JSON.parse(existing.optimizer_json || '{}') || {}; } catch { opt = {}; }
  let optChanged = false;
  if (!String(opt.prompt || '').trim() && String(seedOpt.prompt || '').trim()) {
    opt = {
      ...seedOpt,
      ...opt,
      prompt: seedOpt.prompt,
      optimizer_model_id: opt.optimizer_model_id || seedOpt.optimizer_model_id,
    };
    optChanged = true;
  }

  let params = null;
  if (existing.params_json != null) {
    try { params = JSON.parse(existing.params_json); } catch { params = null; }
  }

  const isSeedance = (mc.id === 'seedance2_0' || mc.id === 'seedance2_5');
  const repair = isSeedance && seedanceParamsNeedRepair(params);

  if (repair) {
    params = mc.params || [];
    db.prepare(`
      UPDATE model_contracts
      SET name=?, params_json=?, conditional_rules_json=?, optimizer_json=?, updated_at=?
      WHERE id=?
    `).run(
      modelName,
      JSON.stringify(params), JSON.stringify(mc.conditional_rules || []), JSON.stringify(opt), now, mc.id
    );
    return;
  }

  // 非 Seedance 已有参数完全保留，即使为空数组也不覆盖；库里未存过（null）才写入种子参数
  if (params === null) {
    params = mc.params || [];
    db.prepare(`
      UPDATE model_contracts
      SET name=?, params_json=?, optimizer_json=?, updated_at=?
      WHERE id=?
    `).run(modelName, JSON.stringify(params), JSON.stringify(opt), now, mc.id);
    return;
  }

  if (mc.id === 'qwenimage_local' && Array.isArray(params) && !params.some((p) => p && p.key === 'qwen_model')) {
    const extra = (mc.params || []).filter((p) => p && p.key === 'qwen_model');
    params = params.concat(extra);
    db.prepare('UPDATE model_contracts SET name=?, params_json=?, updated_at=? WHERE id=?')
      .run(mc.name, JSON.stringify(params), now, mc.id);
  }

  if (optChanged) {
    db.prepare(`
      UPDATE model_contracts
      SET optimizer_json=?, updated_at=?
      WHERE id=?
    `).run(JSON.stringify(opt), now, mc.id);
  }
}

function pushUniqueKey(keys, value) {
  const s = String(value || '').trim();
  if (s && !keys.includes(s)) keys.push(s);
}

/** 供应商钥匙只来自环境变量。不读数据库，不读密钥文件，也不返回给页面。 */
function keysFromProviderStore(_db, providerId) {
  if (!providerId) return [];
  try {
    const { keysFromEnv } = require('./env-keys');
    return keysFromEnv(providerId);
  } catch (_) {
    return [];
  }
}

// 轮换计数器
const _rrIndexMap = new Map();
function pickRoundRobin(poolId, list) {
  if (!list || !list.length) return null;
  const n = _rrIndexMap.get(poolId) || 0;
  _rrIndexMap.set(poolId, n + 1);
  return list[n % list.length];
}

/**
 * 从接入点的凭证列表中轮换提取当前使用的钥匙（只读环境变量或插槽，不存明文）
 */
function resolveEndpointAuth(db, endpoint) {
  if (!endpoint) return { type: 'none' };
  const authType = endpoint.auth_type || 'bearer';
  if (authType === 'none') return { type: 'none' };

  let creds = [];
  try {
    creds = typeof endpoint.credentials_json === 'string'
      ? JSON.parse(endpoint.credentials_json)
      : (endpoint.credentials || []);
  } catch (_) {
    creds = [];
  }

  if (authType === 'bearer') {
    if (endpoint.id !== 'agnes_intl') {
      try {
        const { providerIdForEndpoint, keysFromEnv } = require('./env-keys');
        const providerId = providerIdForEndpoint(endpoint.id) || endpoint.provider_id;
        const envKeys = keysFromEnv(providerId);
        if (envKeys.length) {
          const picked = pickRoundRobin(endpoint.id, envKeys) || '';
          return { type: 'bearer', apiKey: picked, has_key: Boolean(picked) };
        }
      } catch (_) {}
    }
    const keys = [];
    for (const item of creds) {
      if (typeof item === 'string') {
        const val = process.env[item];
        if (val && String(val).trim()) keys.push(String(val).trim());
      } else if (item && typeof item === 'object') {
        const envName = item.env || item.env_var;
        if (envName && process.env[envName]) {
          const val = String(process.env[envName]).trim();
          if (val && !keys.includes(val)) keys.push(val);
        }
      }
    }
    // 兼容历史环境变量回退 (但绝不读适配器上的钥匙)
    if (!keys.length) {
      if (endpoint.id === 'volc_ark' && process.env.ARK_API_KEY) keys.push(process.env.ARK_API_KEY);
      else if (endpoint.id === 'litellm' && process.env.LITELLM_API_KEY) keys.push(process.env.LITELLM_API_KEY);
      else if (endpoint.id === 'agnes' && process.env.AGNES_API_KEY) keys.push(process.env.AGNES_API_KEY);
      else if (endpoint.id === 'gemini' && process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
      else if (endpoint.id === 'groq' && process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY);
      else if (endpoint.id === 'kilo' && process.env.KILO_API_KEY) keys.push(process.env.KILO_API_KEY);
      else if (endpoint.id === 'modelscope' && process.env.MODELSCOPE_API_KEY) keys.push(process.env.MODELSCOPE_API_KEY);
      else if (endpoint.id === 'local_host' && (process.env.UMBRA_TOKEN || process.env.CREATION_PUBLIC_TOKEN)) {
        keys.push(process.env.UMBRA_TOKEN || process.env.CREATION_PUBLIC_TOKEN);
      }
    }

    const picked = pickRoundRobin(endpoint.id, keys) || '';
    return {
      type: 'bearer',
      apiKey: picked,
      has_key: Boolean(picked),
    };
  }

  if (authType === 'aksk') {
    const pairs = [];
    for (const item of creds) {
      if (item && typeof item === 'object') {
        const akEnv = item.ak_env || item.env_ak;
        const skEnv = item.sk_env || item.env_sk;
        const ak = akEnv ? process.env[akEnv] : '';
        const sk = skEnv ? process.env[skEnv] : '';
        if (ak && sk) pairs.push({ ak, sk });
      }
    }
    // 专属环境变量回退（各接入点独立，严禁音乐与人像混用）
    if (!pairs.length) {
      if (endpoint.id === 'doubao_music') {
        const ak = process.env.VOLC_MUSIC_AK || process.env.VOLC_AK || process.env.VOLC_ACCESSKEY || '';
        const sk = process.env.VOLC_MUSIC_SK || process.env.VOLC_SK || process.env.VOLC_SECRETKEY || '';
        if (ak && sk) pairs.push({ ak, sk });
      } else if (endpoint.id === 'volc_portrait') {
        const ak = process.env.PORTRAIT_AK || process.env.ARK_PORTRAIT_AK || process.env.PORTRAIT_VOLC_AK || '';
        const sk = process.env.PORTRAIT_SK || process.env.ARK_PORTRAIT_SK || process.env.PORTRAIT_VOLC_SK || '';
        if (ak && sk) pairs.push({ ak, sk });
      }
    }
    const picked = pickRoundRobin(endpoint.id, pairs) || { ak: '', sk: '' };
    return {
      type: 'aksk',
      ak: picked.ak || '',
      sk: picked.sk || '',
      service: endpoint.sign_service || '',
      version: endpoint.sign_version || '',
      has_key: Boolean(picked.ak && picked.sk),
    };
  }

  return { type: 'none' };
}

/**
 * 根据模型标识（如 seedream5flash、doubao-seedream-5-0-flash-260915）解析对应接入点、能力与鉴权
 */
function resolveModelExecution(db, modelIdOrCode) {
  if (!modelIdOrCode) return null;
  const rawId = String(modelIdOrCode).trim();
  const hit = officialOf(rawId);
  const canonicalId = hit?.model?.id || rawId;
  const modelCode = hit?.model?.model_code || rawId;

  // 1. 查找 model_contracts
  let contract = null;
  if (db) {
    try {
      contract = db.prepare('SELECT * FROM model_contracts WHERE id=? OR vendor_model_id=?').get(canonicalId, modelCode);
    } catch (_) {}
  }
  if (!contract) {
    contract = DEFAULT_MODEL_CONTRACTS.find(m => m.id === canonicalId || m.vendor_model_id === modelCode);
  }

  // 2. 根据能力挂接找到 capability 与 endpoint
  let capId = contract?.capability_id;
  if (!capId) {
    // 智能推断能力
    if (/seedream/i.test(canonicalId) || /seedream/i.test(modelCode)) capId = 'ark_image';
    else if (/seedance/i.test(canonicalId) || /seedance/i.test(modelCode)) capId = 'ark_video';
    else if (/bgm/i.test(canonicalId) || /bgm/i.test(modelCode)) capId = 'doubao_music_bgm';
    else if (/song/i.test(canonicalId) || /song/i.test(modelCode)) capId = 'doubao_music_song';
    else if (/agnes.*image/i.test(canonicalId) || /agnes-image/i.test(modelCode)) capId = 'agnes_image';
    else if (/agnes.*video/i.test(canonicalId) || /agnes-video/i.test(modelCode)) capId = 'agnes_video';
    else if (/indextts|index-tts/i.test(canonicalId) || /indextts|index-tts/i.test(modelCode)) capId = 'indextts_local';
    else if (/acestep|ace-step/i.test(canonicalId) || /acestep|ace-step/i.test(modelCode)) capId = 'acestep_local';
    else if (/qwen/i.test(canonicalId) || /qwen/i.test(modelCode)) capId = 'qwenimage_local';
    else if (/portrait/i.test(canonicalId)) capId = 'portrait_group';
    else {
      // 现有对话和识图模型先挂在本地网关上
      capId = 'litellm_chat';
    }
  }

  let capability = null;
  let endpoint = null;
  if (db) {
    try {
      capability = db.prepare('SELECT * FROM llm_capabilities WHERE id=?').get(capId);
      if (capability) {
        endpoint = db.prepare('SELECT * FROM llm_endpoints WHERE id=?').get(capability.endpoint_id);
      }
    } catch (_) {}
  }

  if (!capability || !endpoint) {
    for (const ep of DEFAULT_ENDPOINTS) {
      const c = ep.capabilities.find(x => x.id === capId);
      if (c) {
        capability = c;
        endpoint = ep;
        break;
      }
    }
  }

  if (!endpoint || !capability) return null;

  const auth = resolveEndpointAuth(db, endpoint);

  const parseStored = (raw, fallback) => {
    if (raw == null || raw === '') return fallback;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch (_) { return fallback; }
    }
    return raw;
  };
  const seeded = DEFAULT_MODEL_CONTRACTS.find((m) => m.id === canonicalId) || {};
  const dialect = parseStored(contract?.dialect_json, null)
    || (contract?.dialect && typeof contract.dialect === 'object' ? contract.dialect : null)
    || defaultDialectForModel(canonicalId);

  return {
    model: {
      id: canonicalId,
      name: contract?.name || hit?.model?.name || canonicalId,
      vendor_model_id: contract?.vendor_model_id || modelCode,
      capability_id: capability.id,
      converter: contract?.converter || seeded.converter || '',
      failover_model_id: contract?.failover_model_id || seeded.failover_model_id || '',
      modes: parseStored(contract?.modes_json, contract?.modes || seeded.modes || []),
      dialect,
      enabled: contract ? (contract.enabled !== 0 && contract.enabled !== false) : true,
      params: contract?.params_json ? (typeof contract.params_json === 'string' ? JSON.parse(contract.params_json) : contract.params_json) : (contract?.params || []),
      table_mappings: contract?.table_mappings_json ? (typeof contract.table_mappings_json === 'string' ? JSON.parse(contract.table_mappings_json) : contract.table_mappings_json) : (contract?.table_mappings || {}),
      conditional_rules: contract?.conditional_rules_json ? (typeof contract.conditional_rules_json === 'string' ? JSON.parse(contract.conditional_rules_json) : contract.conditional_rules_json) : (contract?.conditional_rules || []),
      mutex_groups: contract?.mutex_groups_json ? (typeof contract.mutex_groups_json === 'string' ? JSON.parse(contract.mutex_groups_json) : contract.mutex_groups_json) : (contract?.mutex_groups || []),
      optimizer: contract?.optimizer_json ? (typeof contract.optimizer_json === 'string' ? JSON.parse(contract.optimizer_json) : contract.optimizer_json) : (contract?.optimizer || {}),
    },
    endpoint: {
      id: endpoint.id,
      provider_id: endpoint.provider_id,
      name: endpoint.name,
      base_url: endpoint.base_url,
      auth_type: endpoint.auth_type,
      sign_service: endpoint.sign_service,
      sign_version: endpoint.sign_version,
      enabled: endpoint.enabled !== 0 && endpoint.enabled !== false,
      credentials: endpoint.credentials_json ? (typeof endpoint.credentials_json === 'string' ? JSON.parse(endpoint.credentials_json) : endpoint.credentials_json) : (endpoint.credentials || [])
    },
    capability,
    auth,
  };
}

/**
 * 一次提交的顺序组装 pure function
 * 1. 工作流模板拼出可编辑提示词。
 * 2. 优化器改写这一段。
 * 3. 对每个「写进提示词」且值非空、又没被条件压住的参数，把固定句子接在优化器后面。
 * 4. 写请求体：直接字段、换算表、条件改交法。
 * 5. 若厂商优化参数开着，带上 optimize_prompt_options。
 */
function isArkSeedreamContract(contract) {
  if (!contract) return false;
  if (contract.converter === 'ark-seedream') return true;
  const id = String(contract.id || '');
  const vendor = String(contract.vendor_model_id || '');
  return id === 'seedream5flash' || id === 'seedream5pro' || id === 'seedream5lite'
    || /seedream/i.test(id)
    || /seedream-5-0-(flash|pro)/i.test(vendor)
    || /seedream/i.test(vendor);
}

function assembleModelPayload({
  modelContract,
  values = {},
  editablePrompt = '',
  optimizedPrompt = null,
  image = null,
  images = [],
  nodeOverrides = {},
  db = null,
  snippetIds = null,
}) {
  const contract = modelContract || {};
  const params = contract.params || [];
  const tableMappings = contract.table_mappings || {};
  const conditionalRules = contract.conditional_rules || [];
  const mutexGroups = contract.mutex_groups || [];

  // 合并节点写死的值与调用方的值
  const mergedValues = { ...values, ...nodeOverrides };

  // 1 & 2. 基础提示词（经过优化器改写后的内容优先）
  let promptText = (optimizedPrompt !== null && optimizedPrompt !== undefined)
    ? String(optimizedPrompt).trim()
    : String(editablePrompt || mergedValues.prompt || '').trim();

  // 条件改交法预检查
  const activeConditions = new Set();
  const suppressedKeys = new Set();
  const forcedValues = {};

  for (const rule of conditionalRules) {
    if (!rule.when) continue;
    let match = true;
    for (const [k, v] of Object.entries(rule.when)) {
      if (mergedValues[k] !== v) {
        match = false;
        break;
      }
    }
    if (match) {
      activeConditions.add(rule.type);
      if (rule.effect) {
        if (Array.isArray(rule.effect.suppress)) {
          rule.effect.suppress.forEach(k => suppressedKeys.add(k));
        }
        if (rule.effect.force) {
          Object.assign(forcedValues, rule.effect.force);
        }
      }
    }
  }

  // 3. 对每个「写进提示词」且值非空、又没被条件压住的参数，把固定句子接在优化器后面
  for (const p of params) {
    if (p.location === 'prompt' && !suppressedKeys.has(p.key)) {
      const val = mergedValues[p.key];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const sentence = (p.prompt_template || `${p.label} {{value}}`).replace(/\{\{value\}\}/g, String(val).trim());
        promptText = promptText ? `${promptText} ${sentence}` : sentence;
      }
    }
  }

  // 收集所有参考图以供校验约束
  const allRefs = [];
  if (image) allRefs.push(image);
  if (Array.isArray(images)) images.forEach(im => { if (im && !allRefs.includes(im)) allRefs.push(im); });
  if (mergedValues.image && !allRefs.includes(mergedValues.image)) allRefs.push(mergedValues.image);
  if (mergedValues.image_data_url && !allRefs.includes(mergedValues.image_data_url)) allRefs.push(mergedValues.image_data_url);
  if (Array.isArray(mergedValues.images)) mergedValues.images.forEach(im => { if (im && !allRefs.includes(im)) allRefs.push(im); });
  if (Array.isArray(mergedValues.imageUrls)) mergedValues.imageUrls.forEach(im => { if (im && !allRefs.includes(im)) allRefs.push(im); });
  if (Array.isArray(mergedValues.image_urls)) mergedValues.image_urls.forEach(im => { if (im && !allRefs.includes(im)) allRefs.push(im); });

  const isTransparentRequested = mergedValues.background === 'transparent' || forcedValues.background === 'transparent' || activeConditions.has('transparent_background');
  if (isTransparentRequested && allRefs.length !== 1) {
    throw new Error(`[${contract.name || 'Seedream 5.0 Flash'}] 透明背景必须且仅支持传入单张参考图`);
  }

  if (db && Array.isArray(snippetIds) && snippetIds.length) {
    const compiledSnippets = compileNodePrompt(db, {
      promptTemplate: promptText,
      snippetIds,
      modelId: contract.id || contract.vendor_model_id || '',
    });
    if (compiledSnippets && compiledSnippets.prompt) promptText = compiledSnippets.prompt;
  }

  // 4. Seedream 的尺寸、拆层、透明底只交给契约转换器，这里不再保留第二张换算表。
  if (isArkSeedreamContract(contract)) {
    const { convertArkSeedreamRequest } = require('./converters');
    const converted = convertArkSeedreamRequest({
      rawInput: {
        prompt: promptText,
        allowEmptyPrompt: true,
        model: contract.vendor_model_id || contract.id,
        values: { ...mergedValues, ...forcedValues },
        images: allRefs,
        mode: mergedValues.mode,
      },
      modelContract: contract,
      sizeTable: (tableMappings && tableMappings.size_ratio) || null,
    });
    return {
      prompt: converted.prompt || promptText,
      body: converted.body,
    };
  }

  // 4. 写请求体
  const body = {
    model: contract.vendor_model_id,
    prompt: promptText,
  };

  if (contract.id === 'qwenimage_local') {
    const sizePreset = mergedValues.size || '1K';
    const ratio = mergedValues.ratio || '1:1';
    const tableKey = `${sizePreset}_${ratio}`;
    const qwenTable = (tableMappings && tableMappings.size_ratio) || QWEN_SIZE_TABLE;
    const mapped = qwenTable[tableKey];
    if (!mapped) {
      throw new Error(`[本地 Qwen] 不支持的尺寸与宽高比组合: ${sizePreset} ${ratio}`);
    }
    body.width = mapped.width;
    body.height = mapped.height;
  }

  // 写入直接请求体字段
  for (const p of params) {
    if (p.location === 'body' && !suppressedKeys.has(p.key)) {
      const field = p.body_field || p.key;
      let val = mergedValues[p.key] !== undefined ? mergedValues[p.key] : p.default;

      // 覆盖被条件强制的值
      if (forcedValues[p.key] !== undefined) {
        val = forcedValues[p.key];
      }

      if (field === 'background') {
        if (val === 'transparent' || forcedValues.background === 'transparent') {
          // 没有恰好一张参考图时不允许打开
          if (allRefs.length !== 1) {
            throw new Error(`[${contract.name || 'Seedream 5.0 Flash'}] 透明背景必须且仅支持传入单张参考图`);
          }
          body.background = 'transparent';
          body.output_format = 'png';
        } else {
          body.background = 'opaque';
        }
        continue;
      }

      if (field === 'output_format') {
        if (body.background === 'transparent' || forcedValues.output_format === 'png') {
          body.output_format = 'png';
        } else {
          body.output_format = val || 'jpeg';
        }
        continue;
      }

      if (field && val !== undefined && val !== null) {
        const casted = transformFieldValue(val, p);
        if (field.includes('.')) {
          if (field === 'optimize_prompt_options.mode') {
            if (casted && casted !== 'off') setDeepField(body, field, casted);
          } else {
            setDeepField(body, field, casted);
          }
        } else {
          body[field] = casted;
        }
      }
    }
  }

  // 5. 厂商优化参数: optimize_prompt_options.mode
  const optMode = mergedValues['optimize_prompt_options.mode'] || (mergedValues.optimize_prompt_options && mergedValues.optimize_prompt_options.mode);
  if (optMode && optMode !== 'off') {
    body.optimize_prompt_options = { mode: optMode };
  }

  // 参考图挂载（如果提供）
  if (images && images.length) {
    body.image = images.length === 1 ? images[0] : images;
  } else if (image) {
    body.image = image;
  }

  return {
    prompt: promptText,
    body,
  };
}

/**
 * 工坊与试验场的客户端只读目录 (GET /api/studio/catalog)
 * 每款已启用模型返回：
 * - id、显示名、种类
 * - 共有控件：名字、可选值、默认值
 * - 对外专用参数：名字、可选值、默认值
 * 不返回提交位置、换算表、条件、密钥、高级参数。停用模型不出现。
 */
function getModelPublicCatalog(db) {
  const domains = ['image', 'video', 'music', 'chat', 'portrait'];
  const catalog = { studio: {}, schemas: {}, models: [] };

  let allContracts = [];
  if (db) {
    try {
      allContracts = db.prepare('SELECT * FROM model_contracts').all();
    } catch (_) {}
  }
  if (!allContracts || !allContracts.length) {
    allContracts = DEFAULT_MODEL_CONTRACTS;
  }

  for (const d of domains) {
    const block = OFFICIAL_STUDIO[d] || { models: [], defaultModel: null };
    const enabledOfficial = (block.models || []).filter(m => !m.disabled);
    const domainModels = [];

    for (const m of enabledOfficial) {
      if (m.disabled) continue;

      const contract = allContracts.find(c => c.id === m.id || c.vendor_model_id === m.model_code) ||
                       DEFAULT_MODEL_CONTRACTS.find(c => c.id === m.id || c.vendor_model_id === m.model_code);

      // 契约层明确停用则不出现
      if (contract && (contract.enabled === 0 || contract.enabled === false)) {
        continue;
      }

      const params = contract?.params_json
        ? (typeof contract.params_json === 'string' ? JSON.parse(contract.params_json) : contract.params_json)
        : (contract?.params || []);

      let commonControls = [];
      let publicParams = [];

      if (d === 'image') {
        const sizeParam = params.find(p => p.key === 'size') || { label: '尺寸档', options: m.params?.size || ['1K', '1.5K', '2K'], default: '2K' };
        const ratioParam = params.find(p => p.key === 'ratio') || { label: '宽高比', options: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], default: '1:1' };
        commonControls = [
          { name: sizeParam.label || '尺寸档', key: 'size', options: sizeParam.options || ['1K', '1.5K', '2K'], default: sizeParam.default || '2K' },
          { name: ratioParam.label || '宽高比', key: 'ratio', options: ratioParam.options || ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], default: ratioParam.default || '1:1' }
        ];
      } else if (d === 'video') {
        const ratioParam = params.find(p => p.key === 'ratio' || p.key === 'aspect_ratio') || { label: '画幅', options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], default: '16:9' };
        const durParam = params.find(p => p.key === 'duration' || p.key === 'seconds') || { label: '时长', min: 4, max: 12, default: 5 };
        commonControls = [
          { name: ratioParam.label || '画幅', key: 'ratio', options: ratioParam.options || ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], default: ratioParam.default || '16:9' },
          { name: durParam.label || '时长', key: 'duration', min: durParam.min || 4, max: durParam.max || 12, default: durParam.default || 5 }
        ];
      } else if (d === 'music') {
        const isSong = m.id.includes('song') || m.model_code.includes('song');
        const durParam = params.find(p => p.key === 'Duration' || p.key === 'duration') || { label: '时长', min: 30, max: isSong ? 240 : 120, default: 60 };
        commonControls = [
          { name: durParam.label || '时长', key: 'duration', min: durParam.min || 30, max: durParam.max || (isSong ? 240 : 120), default: durParam.default || 60 }
        ];
      } else {
        // chat 与 portrait 均无画幅/时长类共有控件
        commonControls = [];
      }

      for (const p of params) {
        if (p.visibility === 'public') {
          if (!['size', 'ratio', 'aspect_ratio', 'duration', 'seconds', 'Duration'].includes(p.key)) {
            publicParams.push({
              name: p.label || p.name || p.key,
              key: p.key,
              type: p.type || 'string',
              options: p.options || null,
              default: p.default !== undefined ? p.default : null
            });
          }
        }
      }

      const modelEntry = {
        id: m.id,
        name: m.name,
        kind: d,
        badge: m.badge || '',
        contextTokens: Number(m.caps?.contextTokens) > 0 ? Number(m.caps.contextTokens) : null,
        common_controls: commonControls,
        public_params: publicParams,
      };

      domainModels.push(modelEntry);
      catalog.models.push(modelEntry);
    }

    let defModel = block.defaultModel;
    if (!domainModels.some(m => m.id === defModel)) {
      defModel = domainModels.length > 0 ? domainModels[0].id : null;
    }

    catalog.studio[d] = {
      defaultModel: defModel,
      models: domainModels,
    };
  }

  catalog.schemas = getUnifiedSchemasMap(db);
  return catalog;
}

/**
 * 从单一权威契约 (Model Contract) 动态派生前端与适配器所需的 Schema 结构
 * 彻底消除 model-schemas.js 与 models-contract.js 的双轨硬编码分裂
 */
function buildSchemaForContract(c) {
  if (!c) return null;
  const defC = DEFAULT_MODEL_CONTRACTS.find(d => d.id === c.id) || {};
  const rawParams = c.params_json
    ? (typeof c.params_json === 'string' ? JSON.parse(c.params_json) : c.params_json)
    : (c.params || defC.params || []);
  const rawRules = c.conditional_rules_json
    ? (typeof c.conditional_rules_json === 'string' ? JSON.parse(c.conditional_rules_json) : c.conditional_rules_json)
    : (c.conditional_rules || defC.conditional_rules || []);
  const modes = c.modes_json
    ? (typeof c.modes_json === 'string' ? JSON.parse(c.modes_json) : c.modes_json)
    : (c.modes || defC.modes || []);
  const slots = c.slots_json
    ? (typeof c.slots_json === 'string' ? JSON.parse(c.slots_json) : c.slots_json)
    : (c.slots || defC.slots || { images: 0, videos: 0, audios: 0 });
  const free = c.free_json
    ? (typeof c.free_json === 'string' ? JSON.parse(c.free_json) : c.free_json)
    : (c.free || defC.free || undefined);

  const common = [];
  const advanced = [];
  const submitMap = {};

  for (const p of rawParams) {
    if (!p || !p.key || p.key === 'mode' || p.key === 'omni_reference_task_type') continue;
    let uiKey = p.key;
    if (p.key === 'seconds' || p.key === 'Duration') {
      uiKey = 'duration';
      submitMap.duration = p.body_field || p.key;
    } else if (p.key === 'aspect_ratio') {
      uiKey = 'ratio';
    } else if (p.key === 'resolution') {
      submitMap.size = 'resolution';
    } else if (p.key === 'size') {
      submitMap.size = p.body_field || 'size';
    } else if (p.key === 'duration') {
      submitMap.duration = p.body_field || 'duration';
    }

    let uiType = p.type || 'enum';
    if (uiType === 'boolean') uiType = 'bool';
    if (uiType === 'duration' || (uiKey === 'duration' && uiType === 'number')) uiType = 'range';
    if (uiType === 'string' && Array.isArray(p.options) && p.options.length) uiType = 'enum';
    else if (uiType === 'string' && p.key === 'size') uiType = 'enum';

    const fieldObj = {
      key: uiKey,
      rawKey: p.key,
      label: p.label || p.name || uiKey,
      type: uiType,
      default: p.default,
    };
    if (Array.isArray(p.options)) {
      fieldObj.options = p.options.slice();
    } else if (p.key === 'size' && typeof p.default === 'string') {
      fieldObj.options = [p.default];
    }
    if (p.min !== undefined) fieldObj.min = p.min;
    if (p.max !== undefined) fieldObj.max = p.max;
    if (p.step !== undefined) fieldObj.step = p.step;
    else if (uiType === 'range') fieldObj.step = (uiKey === 'duration' && (p.min >= 30) ? 10 : 1);
    if (Array.isArray(p.extra_stops) && p.extra_stops.length) fieldObj.extraStops = p.extra_stops;
    const labels = p.option_labels || p.extra_labels || p.labels;
    if (labels && Object.keys(labels).length) fieldObj.labels = labels;

    if (p.visibility === 'advanced') {
      advanced.push(fieldObj);
    } else {
      common.push(fieldObj);
    }
  }

  // Ensure seedream models expose watermark in common and bbox/point in advanced for backward compatibility
  if (c.id === 'seedream5flash' || c.id === 'seedream5pro' || c.id === 'seedream5lite') {
    const ratioField = common.find(f => f.key === 'ratio');
    if (ratioField && Array.isArray(ratioField.options) && !ratioField.options.includes('auto')) {
      ratioField.options = ['auto', ...ratioField.options];
    }
    const wmIdx = advanced.findIndex(f => f.key === 'watermark');
    if (wmIdx >= 0 && !common.some(f => f.key === 'watermark')) {
      const [wm] = advanced.splice(wmIdx, 1);
      common.push(wm);
    }
  }
  if (c.id === 'agnes_image_2_5_flash') {
    const sizeField = common.find(f => f.key === 'size');
    if (sizeField && free && Array.isArray(free.sizes)) {
      sizeField.options = free.sizes.slice();
    }
    if (!advanced.some(f => f.key === 'size3k')) {
      advanced.push({ key: 'size3k', label: '3K/4K（刊例价收费档）', type: 'enum', options: ['', '3K', '4K'], default: '' });
    }
  }

  const modeConstraints = {};
  const valueConstraints = [];
  for (const r of rawRules) {
    if (!r || !r.when) continue;
    if (r.when.mode && (r.set || r.lock || r.effect)) {
      modeConstraints[r.when.mode] = {
        set: r.set || (r.effect && r.effect.force) || {},
        lock: r.lock || (r.effect && r.effect.suppress) || [],
        reason: r.reason || (r.effect && r.effect.reason) || '',
      };
    } else {
      const entries = Object.entries(r.when);
      if (entries.length === 1) {
        const [ifKey, ifVal] = entries[0];
        valueConstraints.push({
          type: r.type || 'rule',
          ifKey,
          ifIn: Array.isArray(ifVal) ? ifVal : [ifVal],
          set: r.set || (r.effect && r.effect.force) || {},
          lock: r.lock || (r.effect && r.effect.suppress) || [],
          effect: r.effect || null,
          reason: r.reason || (r.effect && r.effect.reason) || '',
        });
      }
    }
  }

  return {
    polishId: c.id,
    refStyle: c.refStyle || defC.refStyle || (c.id.includes('agnes') ? 'agnes' : (c.id.includes('seedance') ? 'seedance' : 'generic')),
    polishHint: c.polish_hint || c.polishHint || defC.polishHint || '',
    converter: c.converter || defC.converter || '',
    modes,
    common,
    advanced,
    slots,
    ...(free ? { free } : {}),
    submitMap,
    ...(Object.keys(modeConstraints).length ? { modeConstraints } : {}),
    ...(valueConstraints.length ? { valueConstraints } : {}),
  };
}

function getUnifiedSchemasMap(db) {
  const map = {};
  let contracts = DEFAULT_MODEL_CONTRACTS;
  if (db) {
    try {
      contracts = getModelContractsList(db).models;
    } catch (_) {
      contracts = DEFAULT_MODEL_CONTRACTS;
    }
  }
  for (const c of contracts) {
    if (!c || !c.id) continue;
    if (GATEWAY_TEXT_NAMES.has(c.id)) continue;
    map[c.id] = buildSchemaForContract(c);
  }
  if (map.seedream5flash) map.seedream_portrait = map.seedream5flash;
  if (map.agnes_image_2_5_flash) map.agnes_portrait_2_5 = map.agnes_image_2_5_flash;
  return map;
}

const MODEL_SCHEMAS = new Proxy({}, {
  get(_target, prop) {
    const map = getUnifiedSchemasMap(null);
    return map[prop];
  },
  ownKeys() {
    return Reflect.ownKeys(getUnifiedSchemasMap(null));
  },
  getOwnPropertyDescriptor(_target, prop) {
    const map = getUnifiedSchemasMap(null);
    if (prop in map) {
      return { enumerable: true, configurable: true, value: map[prop] };
    }
    return undefined;
  }
});

function schemaFor(model, db = null) {
  if (!model) return null;
  if (model.schema) return model.schema;
  const map = getUnifiedSchemasMap(db);
  return map[model.id] || map[model.polishId] || null;
}

function optionLabel(field, value) {
  if (field && field.labels && field.labels[String(value)] != null) return field.labels[String(value)];
  if (value === -1) return '智能';
  return String(value);
}

function slotLimit(schema, kind) {
  const slots = (schema && schema.slots) || {};
  const free = (schema && schema.free) || {};
  if (kind === 'images') {
    const cap = Number(slots.images || 0);
    if (free.maxRefs != null) return Math.min(cap, Number(free.maxRefs));
    return cap;
  }
  if (kind === 'videos') {
    if (free.noVideoRef) return 0;
    return Number(slots.videos || 0);
  }
  if (kind === 'audios') {
    const cap = Number(slots.audios || 0);
    if (free.maxAudios != null) return Math.min(cap, Number(free.maxAudios));
    return cap;
  }
  return 0;
}

function applyConstraints(schema, mode, params) {
  const out = Object.assign({}, params || {});
  const locks = new Set();
  const mc = schema && schema.modeConstraints && schema.modeConstraints[mode];
  if (mc) {
    if (mc.set) Object.assign(out, mc.set);
    (mc.lock || []).forEach((k) => locks.add(k));
  }
  const vcs = (schema && schema.valueConstraints) || [];
  for (const vc of vcs) {
    const v = out[vc.ifKey];
    if (vc.ifIn && vc.ifIn.map(String).includes(String(v))) {
      if (vc.set) Object.assign(out, vc.set);
      (vc.lock || []).forEach((k) => locks.add(k));
    }
  }
  return { params: out, lock: Array.from(locks) };
}

function enumOptionsOf(schema, key) {
  if (!schema || !key) return [];
  const pools = [schema.common, schema.advanced, schema.modes];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const f of pool) {
      if (f && f.key === key && Array.isArray(f.options)) return f.options;
    }
  }
  return [];
}

function sizeOptionsOf(modelId, db = null) {
  const map = getUnifiedSchemasMap(db);
  const schema = map[modelId] || null;
  if (modelId === 'agnes_image_2_5_flash') {
    const contract = DEFAULT_MODEL_CONTRACTS.find(c => c.id === 'agnes_image_2_5_flash');
    const sp = contract?.params?.find(p => p.key === 'size');
    if (sp && Array.isArray(sp.options)) return sp.options;
  }
  const opts = enumOptionsOf(schema, 'size');
  if (opts.length) return opts;
  return enumOptionsOf(schema, 'resolution');
}

function uniqueUrls(list) {
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    const s = String(item || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function assertFreeTier(schema, { refs, videos, audios, size } = {}) {
  const free = schema && schema.free;
  if (!free) return;
  const refList = Array.isArray(refs) ? uniqueUrls(refs) : null;
  const nRefs = refList ? refList.length : Number(refs || 0);
  const nVid = Array.isArray(videos) ? videos.length : Number(videos || 0);
  const nAud = Array.isArray(audios) ? audios.length : Number(audios || 0);
  const err = (msg) => {
    const e = new Error(msg);
    e.code = 'free_tier';
    throw e;
  };
  if (free.maxRefs != null && nRefs > Number(free.maxRefs)) err(`本次提交了 ${nRefs} 张，免费档最多 ${free.maxRefs} 张`);
  if (free.noVideoRef && nVid > 0) err('免费档不支持视频参考');
  if (free.maxAudios != null && nAud > Number(free.maxAudios)) err(`免费档音频最多 ${free.maxAudios} 条`);
  if (free.size && size && String(size).toUpperCase() !== String(free.size).toUpperCase()) {
    err(`免费档分辨率仅 ${free.size}`);
  }
  if (Array.isArray(free.sizes) && size && !free.sizes.includes(size)) {
    err(`免费档分辨率仅 ${free.sizes.join('/')}`);
  }
}

function mapSubmitParams(schema, genParams) {
  const out = Object.assign({}, genParams || {});
  const sm = (schema && schema.submitMap) || {};
  if (sm.duration && out.duration != null && sm.duration !== 'duration') out[sm.duration] = out.duration;
  if (sm.size) {
    const v = out.size != null ? out.size : out.resolution;
    if (v != null) out[sm.size] = v;
  }
  return out;
}


const DEFAULT_WORKFLOWS_DOCUMENT = {
  unattended: {
    id: 'ingest_workflow',
    name: '素材自动入库工作流',
    pre_checks: {
      dup: { name: '指纹查重', enabled: true, phashThreshold: 8, checkDerivatives: true },
      size: { name: '尺寸体积', enabled: true, minShortSide: 800, minBytes: 100 * 1024 },
      quality: { name: '画质清晰度', enabled: true, minLaplacianVar: 12, solidColorRatio: 0.985 },
      ai_defect: { name: 'AI缺陷拦截', enabled: true, barCheck: true, barRatio: 0.06 }
    },
    nodes: [
      {
        id: 'gate',
        name: '室内闸门 (识图分类)',
        model_id: 'workflow_vision',
        template: '你是素材库分拣员。看图后只返回 JSON...',
        auto_optimize: false,
        fixed_params: {}
      },
      {
        id: 'tag',
        name: '空间打标',
        model_id: 'workflow_vision',
        template: '',
        auto_optimize: false,
        fixed_params: { skipCluster: true, phashThreshold: 5 }
      },
      {
        id: 'index',
        name: '语义向量入库',
        model_id: 'text-embedding-3-small',
        template: '',
        auto_optimize: false,
        fixed_params: { embeddingProvider: 'litellm', embeddingModel: 'text-embedding-3-small' }
      }
    ]
  },
  studio_single: {
    chat: {
      id: 'chat',
      name: '对话',
      default_model: 'agnes3_0flash',
      allow_models: ['agnes3_0flash', 'gemma_4_26b', 'gemma_4_31b'],
      show_optimize_button: false,
      fixed_params: {}
    },
    image: {
      id: 'image',
      name: '效果图生成',
      default_model: 'seedream5flash',
      allow_models: ['seedream5flash', 'seedream5pro', 'seedream5lite', 'agnes_image_2_5_flash'],
      show_optimize_button: true,
      fixed_params: {}
    },
    video: {
      id: 'video',
      name: '视频漫游',
      default_model: 'seedance2_0',
      allow_models: ['seedance2_0', 'seedance2_5', 'agnes_video_2_5_flash'],
      show_optimize_button: true,
      fixed_params: {}
    },
    music: {
      id: 'music',
      name: '配乐生成',
      default_model: 'doubao_bgm_v5',
      allow_models: ['doubao_bgm_v5', 'doubao_song_v5'],
      show_optimize_button: false,
      fixed_params: {}
    }
  },
  studio_triggered: {
    id: 'restage_pipeline',
    name: '效果图风格转换 (触发)',
    nodes: [
      {
        id: 'vision',
        name: '识图节点',
        model_id: 'workflow_vision',
        template: '分析原图空间风格与主体材质',
        extract_fields: ['style', 'room_type', 'color_palette'],
        fixed_params: {}
      },
      {
        id: 'text',
        name: '文本节点',
        model_id: 'agnes3_0flash',
        template: '结合原风格 {{sourceStyle}} 与用户补充 {{userPrompt}} 组织渲染提示词',
        fixed_params: {}
      },
      {
        id: 'gen',
        name: '生图节点',
        model_id: 'seedream5flash',
        auto_optimize: true,
        fixed_params: { size: '2K' }
      }
    ]
  }
};

function getWorkflowsDocument(db) {
  let doc = null;
  if (db) {
    try {
      const row = db.prepare("SELECT value FROM kv WHERE key='workflow_document'").get();
      if (row && row.value) doc = JSON.parse(row.value);
    } catch (_) {}
  }
  if (!doc) doc = JSON.parse(JSON.stringify(DEFAULT_WORKFLOWS_DOCUMENT));

  // 续 41 第 3 点：从真正在跑的 workflows.default 提取真实提示词与模型
  if (db) {
    try {
      const wfRow = db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get();
      if (wfRow && wfRow.graph_json) {
        const gj = JSON.parse(wfRow.graph_json);
        const wfNodes = Array.isArray(gj.nodes) ? gj.nodes : [];
        if (!doc.unattended) doc.unattended = { nodes: [] };
        if (!Array.isArray(doc.unattended.nodes)) doc.unattended.nodes = [];

        for (const targetId of ['gate', 'tag', 'index']) {
          let node = doc.unattended.nodes.find(n => n.id === targetId);
          const wfNode = wfNodes.find(n => n.id === targetId);
          if (!node) {
            const defNode = DEFAULT_WORKFLOWS_DOCUMENT.unattended.nodes.find(n => n.id === targetId);
            node = JSON.parse(JSON.stringify(defNode || { id: targetId, name: targetId }));
            doc.unattended.nodes.push(node);
          }
          if (targetId === 'gate') {
            const gatePrompt = wfNode?.config?.promptTemplate || require('./gate-route').GATE_PROMPT;
            node.template = gatePrompt;
            node.model_id = wfNode?.config?.model || node.model_id || 'workflow_vision';
          } else if (targetId === 'tag') {
            const customTpl = wfNode?.config?.promptTemplate;
            if (customTpl && String(customTpl).trim()) {
              node.template = customTpl;
            } else {
              try {
                const { tagSpacePrompt } = require('./nodes/index');
                node.template = tagSpacePrompt(db);
              } catch (_) {
                node.template = '你是室内设计空间素材标注器。只输出 JSON，不要 markdown。';
              }
            }
            node.model_id = wfNode?.config?.model || node.model_id || 'workflow_vision';
          } else if (targetId === 'index') {
            node.model_id = wfNode?.config?.embeddingModel || 'text-embedding-3-small';
            node.template = '';
            node.fixed_params = {
              embeddingProvider: wfNode?.config?.embeddingProvider || 'litellm',
              embeddingModel: wfNode?.config?.embeddingModel || 'text-embedding-3-small',
            };
          }
        }
      }
    } catch (_) {}
  }

  // 规范化旧的 agnes3_0flash 命名为契约 ID agnes-3.0-flash
  if (doc.studio_single?.chat) {
    if (doc.studio_single.chat.default_model === 'agnes3_0flash') {
      doc.studio_single.chat.default_model = 'agnes-3.0-flash';
    }
    if (Array.isArray(doc.studio_single.chat.allow_models)) {
      doc.studio_single.chat.allow_models = doc.studio_single.chat.allow_models.map(m => m === 'agnes3_0flash' ? 'agnes-3.0-flash' : m);
    }
  }
  if (doc.studio_triggered?.nodes) {
    for (const n of doc.studio_triggered.nodes) {
      if (n.model_id === 'agnes3_0flash') n.model_id = 'agnes-3.0-flash';
    }
  }

  return doc;
}

function saveWorkflowsDocument(db, doc) {
  if (!db || !doc) return doc;
  const val = JSON.stringify(doc);
  db.prepare(`
    INSERT INTO kv (key, value) VALUES ('workflow_document', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(val);

  // 续 41：双向同步写回 workflows.default 的图节点
  try {
    const wfRow = db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get();
    if (wfRow && wfRow.graph_json) {
      const gj = JSON.parse(wfRow.graph_json);
      const wfNodes = Array.isArray(gj.nodes) ? gj.nodes : [];
      if (Array.isArray(doc.unattended?.nodes)) {
        for (const un of doc.unattended.nodes) {
          const target = wfNodes.find(n => n.id === un.id);
          if (target) {
            if (!target.config) target.config = {};
            if (un.model_id && un.id !== 'index') target.config.model = un.model_id;
            if (un.id === 'index' && un.model_id) {
              target.config.embeddingModel = un.model_id;
              if (un.fixed_params?.embeddingModel) target.config.embeddingModel = un.fixed_params.embeddingModel;
            }
            if (un.template !== undefined && un.id !== 'index') {
              target.config.promptTemplate = un.template;
            }
          }
        }
        db.prepare("UPDATE workflows SET graph_json=?, updated_at=? WHERE id='default'").run(JSON.stringify(gj), Date.now());
      }
    }
  } catch (_) {}

  // 同步更新 gateway_config 中的四项前置拒收检查 (不触碰 content.categories)
  try {
    const gw = require('./gateway');
    const cur = gw.getConfig(db);
    if (doc.unattended?.pre_checks) {
      const pc = doc.unattended.pre_checks;
      if (pc.dup) cur.dup = { ...cur.dup, ...pc.dup };
      if (pc.size) cur.size = { ...cur.size, ...pc.size };
      if (pc.quality) cur.quality = { ...cur.quality, ...pc.quality };
      if (pc.ai_defect) cur.aiDefect = { ...cur.aiDefect, ...pc.ai_defect };
      gw.saveConfig(db, cur);
    }
  } catch (_) {}

  return getWorkflowsDocument(db);
}

function getEndpointsList(db) {
  let eps = [];
  if (db) {
    try {
      eps = db.prepare('SELECT * FROM llm_endpoints ORDER BY id ASC').all();
    } catch (_) {}
  }
  if (!eps || !eps.length) eps = DEFAULT_ENDPOINTS;

  return eps.map(ep => {
    let creds = [];
    try {
      creds = typeof ep.credentials_json === 'string' ? JSON.parse(ep.credentials_json) : (ep.credentials || []);
    } catch (_) { creds = []; }

    // 格式化凭证槽：仅输出环境变量名/指纹/尾号与配置状态，绝不出明文，亦不暴露密钥字符
    const credSlots = [];
    if (ep.id === 'agnes') {
      const storeKeys = keysFromProviderStore(db, 'agnes');
      if (storeKeys.length) {
        for (const k of storeKeys) {
          const tail = String(k).slice(-4);
          credSlots.push({
            type: 'bearer',
            source: 'env',
            env: 'AGNES_API_KEY',
            endpoint_id: 'agnes',
            fingerprint: crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 8),
            tail,
            has_value: true,
            masked: '••••••••' + tail,
          });
        }
      } else {
        credSlots.push({
          type: 'bearer',
          source: 'env',
          env: 'AGNES_API_KEY',
          endpoint_id: 'agnes',
          has_value: false,
          masked: ''
        });
      }
    } else if (ep.id === 'agnes_intl') {
      // 国际接入点先建好，钥匙空着
    } else {
      for (const c of creds) {
        if (typeof c === 'string') {
          const val = process.env[c] || '';
          credSlots.push({
            type: 'bearer',
            env: c,
            fingerprint: val ? crypto.createHash('sha256').update(val).digest('hex').slice(0, 8) : '',
            tail: val ? val.slice(-4) : '',
            has_value: Boolean(val),
            masked: val ? ('••••••••' + val.slice(-4)) : ''
          });
        } else if (c && typeof c === 'object') {
          if (c.source === 'env' || c.source === 'provider_secrets') {
            const pid = c.provider_id || ep.provider_id;
            const pkeys = keysFromProviderStore(db, pid);
            if (pkeys.length) {
              for (const k of pkeys) {
                const tail = String(k).slice(-4);
                credSlots.push({
                  type: 'bearer',
                  source: 'env',
                  env: c.env || '',
                  endpoint_id: ep.id,
                  fingerprint: crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 8),
                  tail,
                  has_value: true,
                  masked: '••••••••' + tail,
                });
              }
            } else {
              credSlots.push({
                type: 'bearer',
                source: 'env',
                env: c.env || '',
                endpoint_id: ep.id,
                has_value: false,
                masked: ''
              });
            }
          } else if (c.ak_env || c.sk_env) {
            const akVal = process.env[c.ak_env] || '';
            const skVal = process.env[c.sk_env] || '';
            credSlots.push({
              type: 'aksk',
              ak_env: c.ak_env,
              sk_env: c.sk_env,
              has_value: Boolean(akVal && skVal),
              masked: (akVal && skVal) ? '••••••••' : ''
            });
          }
        }
      }
    }

    let caps = [];
    if (db) {
      try {
        caps = db.prepare('SELECT * FROM llm_capabilities WHERE endpoint_id=?').all(ep.id);
      } catch (_) {}
    }
    if (!caps || !caps.length) {
      const defEp = DEFAULT_ENDPOINTS.find(d => d.id === ep.id);
      caps = defEp?.capabilities || [];
    }

    return {
      id: ep.id,
      provider_id: ep.provider_id,
      name: ep.name,
      base_url: ep.base_url || '',
      auth_type: ep.auth_type || 'bearer',
      sign_service: ep.sign_service || null,
      sign_version: ep.sign_version || null,
      enabled: ep.enabled !== 0 && ep.enabled !== false,
      credentials: credSlots,
      capabilities: caps,
    };
  });
}

function saveEndpointData(db, data) {
  if (!data || !data.id) throw new Error('接入点 ID 不能为空');
  const now = Date.now();
  const id = String(data.id).trim();

  // 凭证列表处理：只收录环境变量名或已有的 slots 引用
  let rawCreds = data.credentials || [];
  if (typeof rawCreds === 'string') {
    try { rawCreds = JSON.parse(rawCreds); } catch { rawCreds = []; }
  }
  const cleanCreds = rawCreds.map(c => {
    if (typeof c === 'string') return /^[A-Z][A-Z0-9_]+$/.test(c) ? c : null;
    if (c && typeof c === 'object') {
      if (c.env && /^[A-Z][A-Z0-9_]+$/.test(c.env)) return c.env;
      if (c.ak_env && c.sk_env && /^[A-Z][A-Z0-9_]+$/.test(c.ak_env) && /^[A-Z][A-Z0-9_]+$/.test(c.sk_env)) {
        return { ak_env: c.ak_env, sk_env: c.sk_env };
      }
    }
    return null;
  }).filter(Boolean);

  let cfgJson = '{}';
  if (data.config || data.config_json) {
    const raw = data.config || data.config_json;
    cfgJson = typeof raw === 'string' ? raw : JSON.stringify(raw);
  }

  db.prepare(`
    INSERT INTO llm_endpoints (id, provider_id, name, base_url, auth_type, sign_service, sign_version, credentials_json, config_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      base_url=excluded.base_url,
      auth_type=excluded.auth_type,
      sign_service=excluded.sign_service,
      sign_version=excluded.sign_version,
      credentials_json=excluded.credentials_json,
      config_json=excluded.config_json,
      enabled=excluded.enabled,
      updated_at=excluded.updated_at
  `).run(
    id,
    data.provider_id || id,
    data.name || id,
    data.base_url || '',
    data.auth_type || 'bearer',
    data.sign_service || null,
    data.sign_version || null,
    JSON.stringify(cleanCreds),
    cfgJson,
    data.enabled === false ? 0 : 1,
    now,
    now
  );

  // 能力列表处理：支持创建/更新能力
  if (Array.isArray(data.capabilities)) {
    for (let cap of data.capabilities) {
      if (typeof cap === 'string') cap = { id: cap, name: cap };
      if (!cap || !cap.id) continue;
      db.prepare(`
        INSERT INTO llm_capabilities (id, endpoint_id, name, kind, type, path, action, method, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name,
          kind=excluded.kind,
          type=excluded.type,
          path=excluded.path,
          action=excluded.action,
          method=excluded.method,
          updated_at=excluded.updated_at
      `).run(
        String(cap.id).trim(),
        id,
        cap.name || cap.id,
        cap.kind || 'chat',
        cap.type || 'path',
        cap.path || null,
        cap.action || null,
        cap.method || 'POST',
        now,
        now
      );
    }
  }

  return getEndpointsList(db).find(e => e.id === id);
}

function deleteEndpointData(db, id) {
  if (!db || !id) return false;
  // 检查是否有关联的模型契约
  const caps = db.prepare('SELECT id FROM llm_capabilities WHERE endpoint_id=?').all(id).map(c => c.id);
  if (caps.length) {
    const bound = db.prepare(`SELECT id, name FROM model_contracts WHERE capability_id IN (${caps.map(() => '?').join(',')})`).all(...caps);
    if (bound.length) {
      throw new Error(`无法删除接入点 ${id}：仍有 ${bound.length} 个模型契约正在使用 (${bound.map(b => b.name).slice(0, 3).join(', ')})`);
    }
  }
  db.prepare('DELETE FROM llm_capabilities WHERE endpoint_id=?').run(id);
  db.prepare('DELETE FROM llm_endpoints WHERE id=?').run(id);
  return true;
}


function getModelContractsList(db) {
  let contracts = [];
  if (db) {
    try {
      contracts = db.prepare('SELECT * FROM model_contracts ORDER BY id ASC').all();
    } catch (_) {}
  }
  if (!contracts || !contracts.length) contracts = DEFAULT_MODEL_CONTRACTS.slice();

  const existingIds = new Set((contracts || []).map(c => c.id));
  for (const defC of DEFAULT_MODEL_CONTRACTS) {
    if (!existingIds.has(defC.id)) {
      contracts.push(defC);
    }
  }

  let allCapabilities = [];
  if (db) {
    try {
      allCapabilities = db.prepare('SELECT * FROM llm_capabilities').all();
    } catch (_) {}
  }
  if (!allCapabilities.length) {
    DEFAULT_ENDPOINTS.forEach(ep => {
      allCapabilities.push(...(ep.capabilities || []));
    });
  }

  const { POLISH_PROMPTS } = require('./polish-prompts');

  const list = contracts.map(c => {
    const params = c.params_json ? (typeof c.params_json === 'string' ? JSON.parse(c.params_json) : c.params_json) : (c.params || []);
    const tables = c.table_mappings_json ? (typeof c.table_mappings_json === 'string' ? JSON.parse(c.table_mappings_json) : c.table_mappings_json) : (c.table_mappings || {});
    const rules = c.conditional_rules_json ? (typeof c.conditional_rules_json === 'string' ? JSON.parse(c.conditional_rules_json) : c.conditional_rules_json) : (c.conditional_rules || []);
    const mutex = c.mutex_groups_json ? (typeof c.mutex_groups_json === 'string' ? JSON.parse(c.mutex_groups_json) : c.mutex_groups_json) : (c.mutex_groups || []);
    const opt = c.optimizer_json ? (typeof c.optimizer_json === 'string' ? JSON.parse(c.optimizer_json) : c.optimizer_json) : (c.optimizer || {});
    const baseDialect = defaultDialectForModel(c.id);
    let dialect = baseDialect;
    if (c.dialect_json) {
      try {
        dialect = { ...baseDialect, ...(typeof c.dialect_json === 'string' ? JSON.parse(c.dialect_json) : c.dialect_json) };
      } catch (_) {}
    } else if (c.dialect) {
      dialect = { ...baseDialect, ...c.dialect };
    }

    if (db) {
      try {
        const pRow = db.prepare('SELECT prompt, optimizer_model_id FROM gen_polish_prompts WHERE model_id=?').get(c.id);
        if (pRow) {
          if (pRow.prompt) opt.prompt = pRow.prompt;
          if (pRow.optimizer_model_id) opt.optimizer_model_id = pRow.optimizer_model_id;
        }
      } catch (_) {}
    }

    const officialPrompt = POLISH_PROMPTS[c.id] || '';
    if (!String(opt.prompt || '').trim() && officialPrompt) {
      opt.prompt = officialPrompt;
    }
    opt.has_official = Boolean(officialPrompt);
    opt.official_prompt = officialPrompt;

    if (!opt.optimizer_model_id || opt.optimizer_model_id === 'agnes3_0flash') {
      opt.optimizer_model_id = 'agnes-3.0-flash';
    }

    const cap = allCapabilities.find(capItem => capItem.id === c.capability_id);

    const defContract = DEFAULT_MODEL_CONTRACTS.find(dc => dc.id === c.id) || {};
    const modes = c.modes_json ? (typeof c.modes_json === 'string' ? JSON.parse(c.modes_json) : c.modes_json) : (c.modes || defContract.modes || []);
    const slots = c.slots_json ? (typeof c.slots_json === 'string' ? JSON.parse(c.slots_json) : c.slots_json) : (c.slots || defContract.slots || { images: 0, videos: 0, audios: 0 });
    const free = c.free_json ? (typeof c.free_json === 'string' ? JSON.parse(c.free_json) : c.free_json) : (c.free || defContract.free || null);
    const converter = c.converter || defContract.converter || '';
    const refStyle = c.ref_style || c.refStyle || defContract.refStyle || 'generic';
    const polishHint = c.polish_hint || c.polishHint || defContract.polishHint || '';
    const failoverModelId = c.failover_model_id || defContract.failover_model_id || '';

    return {
      id: c.id,
      name: c.name,
      vendor_model_id: c.vendor_model_id,
      capability_id: c.capability_id,
      capability_name: cap ? `${cap.name} (${cap.id})` : c.capability_id,
      kind: cap?.kind || 'image',
      converter,
      refStyle,
      polishHint,
      failover_model_id: failoverModelId,
      modes,
      slots,
      free,
      enabled: c.enabled !== 0 && c.enabled !== false,
      params,
      table_mappings: tables,
      conditional_rules: rules,
      mutex_groups: mutex,
      optimizer: opt,
      dialect,
    };
  });

  return {
    models: list,
    capabilities: allCapabilities,
  };
}

function saveModelContractData(db, data) {
  if (!data || !data.id) throw new Error('模型 ID 不能为空');
  const now = Date.now();
  const id = String(data.id).trim();

  let baseContract = null;
  if (data.copy_from_id) {
    const existingList = getModelContractsList(db).models;
    baseContract = existingList.find(m => m.id === data.copy_from_id);
  }

  const name = data.name || (baseContract ? `${baseContract.name} (副本)` : id);
  const vendorId = data.vendor_model_id || baseContract?.vendor_model_id || id;
  const capId = data.capability_id || baseContract?.capability_id || 'ark_image';
  const params = data.params || baseContract?.params || [];
  const tables = data.table_mappings || baseContract?.table_mappings || {};
  const rules = data.conditional_rules || baseContract?.conditional_rules || [];
  const mutex = data.mutex_groups || baseContract?.mutex_groups || [];
  const opt = data.optimizer || baseContract?.optimizer || { optimizer_model_id: 'agnes-3.0-flash', prompt: '' };
  const dialect = {
    ...defaultDialectForModel(id),
    ...(baseContract?.dialect || {}),
    ...(data.dialect || {}),
  };

  try { db.exec('ALTER TABLE model_contracts ADD COLUMN dialect_json TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE model_contracts ADD COLUMN converter TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE model_contracts ADD COLUMN modes_json TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE model_contracts ADD COLUMN slots_json TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE model_contracts ADD COLUMN free_json TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE model_contracts ADD COLUMN polish_hint TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE model_contracts ADD COLUMN failover_model_id TEXT'); } catch (_) {}

  const converter = data.converter !== undefined ? data.converter : (baseContract?.converter || '');
  const modes = data.modes !== undefined ? data.modes : (baseContract?.modes || []);
  const slots = data.slots !== undefined ? data.slots : (baseContract?.slots || { images: 0, videos: 0, audios: 0 });
  const free = data.free !== undefined ? data.free : (baseContract?.free || null);
  const polishHint = data.polish_hint !== undefined ? data.polish_hint : (data.polishHint !== undefined ? data.polishHint : (baseContract?.polishHint || ''));
  const failoverModelId = data.failover_model_id !== undefined ? data.failover_model_id : (baseContract?.failover_model_id || '');

  db.prepare(`
    INSERT INTO model_contracts (id, name, vendor_model_id, capability_id, converter, modes_json, slots_json, free_json, polish_hint, failover_model_id, enabled, params_json, table_mappings_json, mutex_groups_json, conditional_rules_json, optimizer_json, dialect_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      vendor_model_id=excluded.vendor_model_id,
      capability_id=excluded.capability_id,
      converter=excluded.converter,
      modes_json=excluded.modes_json,
      slots_json=excluded.slots_json,
      free_json=excluded.free_json,
      polish_hint=excluded.polish_hint,
      failover_model_id=excluded.failover_model_id,
      enabled=excluded.enabled,
      params_json=excluded.params_json,
      table_mappings_json=excluded.table_mappings_json,
      mutex_groups_json=excluded.mutex_groups_json,
      conditional_rules_json=excluded.conditional_rules_json,
      optimizer_json=excluded.optimizer_json,
      dialect_json=excluded.dialect_json,
      updated_at=excluded.updated_at
  `).run(
    id,
    name,
    vendorId,
    capId,
    converter,
    JSON.stringify(modes),
    JSON.stringify(slots),
    free ? JSON.stringify(free) : null,
    polishHint,
    failoverModelId,
    data.enabled === false ? 0 : 1,
    JSON.stringify(params),
    JSON.stringify(tables),
    JSON.stringify(mutex),
    JSON.stringify(rules),
    JSON.stringify(opt),
    JSON.stringify(dialect),
    now,
    now
  );

  if (opt && opt.prompt) {
    try {
      db.prepare(`
        INSERT INTO gen_polish_prompts (model_id, prompt, optimizer_model_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(model_id) DO UPDATE SET
          prompt=excluded.prompt,
          optimizer_model_id=excluded.optimizer_model_id,
          updated_at=excluded.updated_at
      `).run(id, String(opt.prompt).trim(), opt.optimizer_model_id || 'agnes-3.0-flash', now);
    } catch (_) {}
  }

  return getModelContractsList(db).models.find(m => m.id === id);
}

function getAvailableEnvKeys() {
  const commonKeys = [
    'ARK_API_KEY',
    'VOLC_AK',
    'VOLC_SK',
    'VOLC_ACCESSKEY',
    'VOLC_SECRETKEY',
    'ARK_PORTRAIT_AK',
    'ARK_PORTRAIT_SK',
    'AGNES_API_KEY',
    'LITELLM_API_KEY',
    'GEMINI_API_KEY',
    'GROQ_API_KEY',
    'KILO_API_KEY',
    'MODELSCOPE_API_KEY',
    'ARK_API_KEYS',
    'AGNES_API_KEYS',
    'GEMINI_API_KEYS',
    'GROQ_API_KEYS',
    'LITELLM_API_KEYS',
    'LITELLM_MASTER_KEY',
    'KILO_API_KEYS',
    'MODELSCOPE_API_KEYS',
    'UMBRA_TOKEN',
    'CREATION_PUBLIC_TOKEN',
  ];
  const set = new Set(commonKeys);
  for (const k of Object.keys(process.env || {})) {
    if (k.endsWith('_KEY') || k.endsWith('_TOKEN') || k.endsWith('_AK') || k.endsWith('_SK') || k.startsWith('VOLC_') || k.startsWith('ARK_')) {
      set.add(k);
    }
  }
  return Array.from(set);
}

// ================= 公共提示词积木 (Prompt Snippets) CRUD =================
function getPromptSnippetsList(db) {
  let list = [];
  if (db) {
    try {
      list = db.prepare('SELECT * FROM prompt_snippets ORDER BY is_builtin DESC, id ASC').all();
    } catch (_) {}
  }
  if (!list.length) {
    list = Object.values(OFFICIAL_PROMPT_SNIPPETS);
  }
  return list.map(item => {
    const off = OFFICIAL_PROMPT_SNIPPETS[item.id];
    return {
      ...item,
      enabled: item.enabled !== 0 && item.enabled !== false,
      has_official: Boolean(off),
      official_positive: off?.positive_text || '',
      official_negative: off?.negative_text || '',
    };
  });
}

function savePromptSnippet(db, data) {
  if (!db || !data || !data.id) throw new Error('公共积木 ID 不能为空');
  const now = Date.now();
  const id = String(data.id).trim();
  const name = String(data.name || id).trim();
  const category = String(data.category || 'realism').trim();
  const description = String(data.description || '').trim();
  const positiveText = String(data.positive_text || '').trim();
  const negativeText = String(data.negative_text || '').trim();
  const isBuiltin = data.is_builtin || OFFICIAL_PROMPT_SNIPPETS[id] ? 1 : 0;
  const enabled = data.enabled === false ? 0 : 1;

  db.prepare(`
    INSERT INTO prompt_snippets (id, name, category, description, positive_text, negative_text, is_builtin, enabled, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      category=excluded.category,
      description=excluded.description,
      positive_text=excluded.positive_text,
      negative_text=excluded.negative_text,
      enabled=excluded.enabled,
      version=prompt_snippets.version + 1,
      updated_at=excluded.updated_at
  `).run(id, name, category, description, positiveText, negativeText, isBuiltin, enabled, now, now);

  syncMountPointsToWorkflowGraph(db);
  return getPromptSnippetsList(db).find(s => s.id === id);
}

function deletePromptSnippet(db, id) {
  if (!db || !id) return false;
  const row = db.prepare('SELECT is_builtin FROM prompt_snippets WHERE id=?').get(id);
  if ((row && row.is_builtin) || OFFICIAL_PROMPT_SNIPPETS[id]) {
    throw new Error('官方内置公共提示词积木不可删除。如需调整可直接编辑或随时恢复官方默认。');
  }
  db.prepare('DELETE FROM prompt_snippets WHERE id=?').run(id);
  return true;
}

function restorePromptSnippetDefault(db, id) {
  if (!db || !id) throw new Error('公共积木 ID 不能为空');
  const off = OFFICIAL_PROMPT_SNIPPETS[id];
  if (!off) throw new Error(`未找到 ID 为 ${id} 的官方公共积木基线`);
  const now = Date.now();
  db.prepare(`
    UPDATE prompt_snippets
    SET name=?, category=?, description=?, positive_text=?, negative_text=?, enabled=1, updated_at=?
    WHERE id=?
  `).run(off.name, off.category, off.description || '', off.positive_text, off.negative_text, now, id);
  syncMountPointsToWorkflowGraph(db);
  return getPromptSnippetsList(db).find(s => s.id === id);
}

// ================= 提示词中心 (Prompt Center) CRUD =================
function getPromptTemplatesList(db) {
  let list = [];
  if (db) {
    try {
      list = db.prepare('SELECT * FROM prompt_templates ORDER BY category ASC, id ASC').all();
    } catch (_) {}
  }
  return list.map(item => {
    const off = OFFICIAL_PROMPT_TEMPLATES[item.id];
    return {
      ...item,
      variables_schema: item.variables_schema_json ? JSON.parse(item.variables_schema_json) : [],
      has_official: Boolean(off),
      official_template: off?.template || '',
      expanded_preview: expandDictMacros(db, item.template),
    };
  });
}

function savePromptTemplate(db, data) {
  if (!db || !data || !data.id) throw new Error('提示词 ID 不能为空');
  const now = Date.now();
  const id = String(data.id).trim();
  const name = String(data.name || id).trim();
  const category = String(data.category || 'general').trim();
  const template = String(data.template || '').trim();
  const vars = data.variables_schema ? JSON.stringify(data.variables_schema) : (data.variables_schema_json || '[]');
  const isBuiltin = data.is_builtin || OFFICIAL_PROMPT_TEMPLATES[id] ? 1 : 0;

  db.prepare(`
    INSERT INTO prompt_templates (id, name, category, template, variables_schema_json, is_builtin, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      category=excluded.category,
      template=excluded.template,
      variables_schema_json=excluded.variables_schema_json,
      version=prompt_templates.version + 1,
      updated_at=excluded.updated_at
  `).run(id, name, category, template, vars, isBuiltin, now, now);

  // ★ 关键修复：保存提示词后立即双向同步到 workflows.default，消灭“改了提示词中心却不生效”的 Bug
  syncMountPointsToWorkflowGraph(db);
  return getPromptTemplatesList(db).find(p => p.id === id);
}

function deletePromptTemplate(db, id) {
  if (!db || !id) return false;
  const row = db.prepare('SELECT is_builtin FROM prompt_templates WHERE id=?').get(id);
  if (row && row.is_builtin) {
    throw new Error('官方内置提示词不可删除。如需自定义修改可直接编辑，或随时“恢复官方默认”。');
  }
  db.prepare('DELETE FROM prompt_templates WHERE id=?').run(id);
  return true;
}

function restorePromptTemplateDefault(db, id) {
  if (!db || !id) throw new Error('提示词 ID 不能为空');
  const off = OFFICIAL_PROMPT_TEMPLATES[id];
  if (!off) throw new Error(`未找到 ID 为 ${id} 的官方基线提示词`);
  const now = Date.now();
  db.prepare(`
    UPDATE prompt_templates
    SET template=?, name=?, category=?, updated_at=?
    WHERE id=?
  `).run(off.template, off.name, off.category, now, id);
  syncMountPointsToWorkflowGraph(db);
  return getPromptTemplatesList(db).find(p => p.id === id);
}

// ================= 模块化工作流与工作流节点 (Workflows & Workflow Nodes) CRUD =================
function getMountPointsList(db) {
  let list = [];
  if (db) {
    try {
      list = db.prepare('SELECT * FROM workflow_mount_points ORDER BY order_num ASC, id ASC').all();
    } catch (_) {}
  }
  return list.map(mp => {
    const modules = getMountModules(db, mp.id);
    return {
      ...mp,
      trigger_config: mp.trigger_config_json ? JSON.parse(mp.trigger_config_json) : {},
      modules,
    };
  });
}

function saveMountPoint(db, data) {
  if (!db || !data || !data.id) throw new Error('工作流/挂载点 ID 不能为空');
  const now = Date.now();
  const id = String(data.id).trim();
  const name = String(data.name || id).trim();
  const category = String(data.category || 'custom').trim();
  const desc = String(data.description || '').trim();
  const triggerType = String(data.trigger_type || 'api').trim();
  const triggerConfig = data.trigger_config ? JSON.stringify(data.trigger_config) : (data.trigger_config_json || '{}');
  const isBuiltin = data.is_builtin ? 1 : 0;
  const orderNum = Number(data.order_num) || 0;
  const enabled = data.enabled === false ? 0 : 1;

  db.prepare(`
    INSERT INTO workflow_mount_points (id, name, category, description, trigger_type, trigger_config_json, is_builtin, order_num, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      category=excluded.category,
      description=excluded.description,
      trigger_type=excluded.trigger_type,
      trigger_config_json=excluded.trigger_config_json,
      order_num=excluded.order_num,
      enabled=excluded.enabled,
      updated_at=excluded.updated_at
  `).run(id, name, category, desc, triggerType, triggerConfig, isBuiltin, orderNum, enabled, now, now);

  // 如果带有 clone_from_id，则一键克隆源工作流的所有子节点
  if (data.clone_from_id) {
    const srcMods = getMountModules(db, data.clone_from_id);
    for (const m of srcMods) {
      saveMountModule(db, {
        id: `${id}_${m.node_type}_${Math.random().toString(36).slice(2, 6)}`,
        mount_point_id: id,
        name: m.name,
        node_type: m.node_type,
        model_id: m.model_id,
        prompt_id: m.prompt_id,
        prompt_override: m.prompt_override,
        condition_expr: m.condition_expr,
        branch_group: m.branch_group,
        snippet_ids: m.snippet_ids,
        params: m.params,
        order_num: m.order_num,
        enabled: m.enabled,
      });
    }
  }

  return getMountPointsList(db).find(mp => mp.id === id);
}

function deleteMountPoint(db, id) {
  if (!db || !id) return false;
  const row = db.prepare('SELECT is_builtin FROM workflow_mount_points WHERE id=?').get(id);
  if (row && row.is_builtin) {
    throw new Error('系统核心内置挂载点不可删除（但您可以在其内部自由增删改工作流节点，或新建/克隆自定义工作流）');
  }
  db.prepare('DELETE FROM workflow_modules WHERE mount_point_id=?').run(id);
  db.prepare('DELETE FROM workflow_mount_points WHERE id=?').run(id);
  return true;
}

function getMountModules(db, mountPointId) {
  if (!db || !mountPointId) return [];
  const rows = db.prepare('SELECT * FROM workflow_modules WHERE mount_point_id=? ORDER BY order_num ASC, id ASC').all(mountPointId);
  return rows.map(m => {
    const spec = getOperatorSpec(m.node_type);
    let snippetIds = [];
    try { snippetIds = m.snippet_ids_json ? JSON.parse(m.snippet_ids_json) : []; } catch { snippetIds = []; }
    if (!snippetIds.length && spec?.defaultSnippets?.length && m.snippet_ids_json == null) {
      snippetIds = spec.defaultSnippets;
    }
    return {
      ...m,
      condition_expr: m.condition_expr || '',
      branch_group: m.branch_group || '',
      snippet_ids: snippetIds,
      operator_spec: spec ? {
        code: spec.code,
        name: spec.name,
        category: spec.category,
        categoryLabel: spec.categoryLabel,
        description: spec.description,
        needsModel: spec.needsModel,
        modelDomain: spec.modelDomain,
        needsPrompt: spec.needsPrompt,
        supportsSnippets: spec.supportsSnippets,
        outputs: spec.outputs || [],
      } : null,
      input_mappings: m.input_mappings_json ? JSON.parse(m.input_mappings_json) : {},
      params: m.params_json ? JSON.parse(m.params_json) : {},
    };
  });
}

function syncMountPointsToWorkflowGraph(db) {
  if (!db) return;
  try {
    const wfRow = db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get();
    if (!wfRow || !wfRow.graph_json) return;
    const gj = JSON.parse(wfRow.graph_json);
    const nodes = Array.isArray(gj.nodes) ? gj.nodes : [];

    // 若存量 workflows.default 缺少 defect 节点，插在闸门后面，只拆开闸门出去的那一条边
    if (nodes.length > 0 && !nodes.some(n => n.type === 'defect' || n.id === 'defect')) {
      const gateIdx = nodes.findIndex(n => n.type === 'gate' || n.id === 'gate');
      const defectNode = {
        id: 'defect',
        type: 'defect',
        name: 'AI 视觉缺陷质检拦截',
        enabled: true,
        config: {
          model: 'workflow_vision',
          promptId: 'defect_inspection',
          temperature: 0.1,
          timeoutMs: 30000,
          barCheck: true,
          fallbackStrategy: 'warn_continue'
        },
        position: { x: 664, y: 150 }
      };
      const insertAt = gateIdx >= 0 ? gateIdx + 1 : nodes.length;
      if (gateIdx >= 0) {
        const gate = nodes[gateIdx];
        const gx = Number(gate.position && gate.position.x);
        defectNode.position = {
          x: Number.isFinite(gx) ? gx + 200 : 664,
          y: (gate.position && gate.position.y) || 150,
        };
      }
      nodes.splice(insertAt, 0, defectNode);
      gj.nodes = nodes;
      // 只拆开闸门出去的那一条边，其它边保持原样
      const edges = Array.isArray(gj.edges) ? gj.edges : [];
      const gateId = gateIdx >= 0 ? nodes[gateIdx].id : null;
      if (gateId) {
        const outIdx = edges.findIndex((e) => e && e.source === gateId);
        const next = nodes[insertAt + 1];
        if (outIdx >= 0) {
          const nextId = edges[outIdx].target;
          edges[outIdx] = {
            ...edges[outIdx],
            id: `e_${gateId}_${defectNode.id}`,
            source: gateId,
            target: defectNode.id,
          };
          if (nextId && nextId !== defectNode.id && !edges.some((e) => e.source === defectNode.id && e.target === nextId)) {
            edges.push({
              id: `e_${defectNode.id}_${nextId}`,
              source: defectNode.id,
              target: nextId,
            });
          }
        } else if (next) {
          edges.push({ id: `e_${gateId}_${defectNode.id}`, source: gateId, target: defectNode.id });
          edges.push({ id: `e_${defectNode.id}_${next.id}`, source: defectNode.id, target: next.id });
        }
      }
      gj.edges = edges;
    }

    const preMods = getMountModules(db, 'ingest_pre_gate');
    const postMods = getMountModules(db, 'ingest_post_process');
    const allMods = [...preMods, ...postMods];

    for (const mod of allMods) {
      // 兼容 script_qc <-> qc 映射
      const matchTypes = mod.node_type === 'script_qc' ? ['script_qc', 'qc'] : [mod.node_type, mod.id];
      const targetNode = nodes.find(n => matchTypes.includes(n.id) || matchTypes.includes(n.type));
      if (targetNode) {
        if (!targetNode.config) targetNode.config = {};
        if (mod.model_id) targetNode.config.model = mod.model_id;
        if (mod.prompt_id) targetNode.config.promptId = mod.prompt_id;
        if (Array.isArray(mod.snippet_ids)) targetNode.config.snippetIds = mod.snippet_ids;

        // 实时展开 {{@dict.xxx}} 宏，杜绝残缺提示词覆盖动态词典
        const compiled = compileNodePrompt(db, {
          mountPointId: mod.mount_point_id,
          nodeId: mod.id,
          nodeType: mod.node_type,
          promptId: mod.prompt_id,
          promptTemplate: mod.prompt_override,
          snippetIds: mod.snippet_ids,
          modelId: mod.model_id,
        });
        if (compiled.expandedDictPrompt) {
          targetNode.config.promptTemplate = compiled.expandedDictPrompt;
        }
        if (mod.params && typeof mod.params === 'object') {
          targetNode.config = { ...targetNode.config, ...mod.params };
        }
        targetNode.enabled = mod.enabled !== 0;
      }
    }

    db.prepare("UPDATE workflows SET graph_json=?, updated_at=? WHERE id='default'").run(JSON.stringify(gj), Date.now());
  } catch (_) {}
}

function saveMountModule(db, data) {
  if (!db || !data || !data.mount_point_id) throw new Error('必须指定所属工作流/挂载点 ID');
  const now = Date.now();
  const id = String(data.id || `mod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`).trim();
  const mountPointId = String(data.mount_point_id).trim();
  const nodeType = String(data.node_type || 'gate').trim();
  const spec = getOperatorSpec(nodeType);
  const name = String(data.name || spec?.name || id).trim();
  const modelId = data.model_id !== undefined ? (data.model_id ? String(data.model_id).trim() : null) : (spec?.defaultModelId || null);
  const promptId = data.prompt_id !== undefined ? (data.prompt_id ? String(data.prompt_id).trim() : null) : (spec?.defaultPromptId || null);
  const promptOverride = data.prompt_override != null ? String(data.prompt_override) : null;
  const conditionExpr = data.condition_expr != null ? String(data.condition_expr).trim() : '';
  const branchGroup = data.branch_group != null ? String(data.branch_group).trim() : '';
  const snippetIds = Array.isArray(data.snippet_ids)
    ? JSON.stringify(data.snippet_ids)
    : (data.snippet_ids_json || JSON.stringify(spec?.defaultSnippets || []));
  const inputMappings = data.input_mappings ? JSON.stringify(data.input_mappings) : (data.input_mappings_json || '{}');
  const params = data.params
    ? JSON.stringify(data.params)
    : (data.params_json || JSON.stringify(spec?.defaultParams || {}));
  let orderNum = Number(data.order_num);
  if (!orderNum) {
    const existing = getMountModules(db, mountPointId);
    orderNum = existing.length + 1;
  }
  const enabled = data.enabled === false ? 0 : 1;

  try { db.exec("ALTER TABLE workflow_modules ADD COLUMN condition_expr TEXT DEFAULT ''"); } catch (_) {}
  try { db.exec("ALTER TABLE workflow_modules ADD COLUMN branch_group TEXT DEFAULT ''"); } catch (_) {}
  try { db.exec("ALTER TABLE workflow_modules ADD COLUMN snippet_ids_json TEXT DEFAULT '[]'"); } catch (_) {}

  db.prepare(`
    INSERT INTO workflow_modules (id, mount_point_id, name, node_type, model_id, prompt_id, prompt_override, condition_expr, branch_group, snippet_ids_json, input_mappings_json, params_json, order_num, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      mount_point_id=excluded.mount_point_id,
      name=excluded.name,
      node_type=excluded.node_type,
      model_id=excluded.model_id,
      prompt_id=excluded.prompt_id,
      prompt_override=excluded.prompt_override,
      condition_expr=excluded.condition_expr,
      branch_group=excluded.branch_group,
      snippet_ids_json=excluded.snippet_ids_json,
      input_mappings_json=excluded.input_mappings_json,
      params_json=excluded.params_json,
      order_num=excluded.order_num,
      enabled=excluded.enabled,
      updated_at=excluded.updated_at
  `).run(id, mountPointId, name, nodeType, modelId, promptId, promptOverride, conditionExpr, branchGroup, snippetIds, inputMappings, params, orderNum, enabled, now, now);

  syncMountPointsToWorkflowGraph(db);
  return getMountModules(db, mountPointId).find(m => m.id === id);
}

function deleteMountModule(db, id) {
  if (!db || !id) return false;
  const row = db.prepare('SELECT mount_point_id FROM workflow_modules WHERE id=?').get(id);
  db.prepare('DELETE FROM workflow_modules WHERE id=?').run(id);
  if (row?.mount_point_id) {
    syncMountPointsToWorkflowGraph(db);
  }
  return true;
}

/**
 * 工坊、试验场、/gen 共用的一次编译。
 * 先按契约 failover_model_id 决定用哪一份契约，再用同一份标准词编译报文。
 */
function prepareGovernedSubmit({
  db = null,
  modelId = '',
  editablePrompt = '',
  optimizedPrompt = null,
  values = {},
  images = [],
  snippetIds = null,
} = {}) {
  let contract = null;
  if (modelId) {
    const exec = resolveModelExecution(db, modelId);
    contract = exec?.model || null;
  }
  if (contract && contract.id) {
    const { selectSubmitContract } = require('./converters');
    const picked = selectSubmitContract(contract, (id) => {
      const next = resolveModelExecution(db, id);
      return next?.model || null;
    });
    contract = picked.contract;
  }
  if (!contract) return { contract: null, assembled: null };
  const assembled = assembleModelPayload({
    modelContract: contract,
    editablePrompt,
    optimizedPrompt,
    values,
    images,
    image: Array.isArray(images) ? (images[0] || null) : null,
    db,
    snippetIds,
  });
  return { contract, assembled };
}

function reorderMountModules(db, mountPointId, orderedIds) {
  if (!db || !mountPointId || !Array.isArray(orderedIds)) return [];
  const stmt = db.prepare('UPDATE workflow_modules SET order_num=?, updated_at=? WHERE id=? AND mount_point_id=?');
  const now = Date.now();
  orderedIds.forEach((id, idx) => {
    stmt.run(idx + 1, now, id, mountPointId);
  });
  syncMountPointsToWorkflowGraph(db);
  return getMountModules(db, mountPointId);
}

module.exports = {
  DEFAULT_ENDPOINTS,
  DEFAULT_MODEL_CONTRACTS,
  LITELLM_TEXT_NAMES: GATEWAY_TEXT_NAMES,
  LITELLM_TEXT_CONTRACTS,
  GATEWAY_TEXT_NAMES,
  GATEWAY_GROUP_NAMES,
  OFFICIAL_PROMPT_SNIPPETS,
  OFFICIAL_PROMPT_TEMPLATES,
  OPERATOR_CATALOG,
  getOperatorCatalog,
  getOperatorSpec,
  DEFAULT_MOUNT_POINTS,
  DEFAULT_MODULES,
  keysFromProviderStore,
  DEFAULT_WORKFLOWS_DOCUMENT,
  SEEDREAM_FLASH_SIZE_TABLE,
  QWEN_SIZE_TABLE,
  initModelRegistryTables,
  resolveModelExecution,
  resolveEndpointAuth,
  assembleModelPayload,
  prepareGovernedSubmit,
  pickRoundRobin,
  getModelPublicCatalog,
  getWorkflowsDocument,
  saveWorkflowsDocument,
  getEndpointsList,
  saveEndpointData,
  deleteEndpointData,
  getModelContractsList,
  saveModelContractData,
  getAvailableEnvKeys,
  interpolateVariables,
  expandDictMacros,
  getDictMacroChips,
  defaultDialectForModel,
  resolveModelDialect,
  compileNodePrompt,
  getPromptSnippetsList,
  savePromptSnippet,
  deletePromptSnippet,
  restorePromptSnippetDefault,
  getPromptTemplatesList,
  savePromptTemplate,
  deletePromptTemplate,
  restorePromptTemplateDefault,
  getMountPointsList,
  saveMountPoint,
  deleteMountPoint,
  getMountModules,
  saveMountModule,
  deleteMountModule,
  reorderMountModules,
  syncMountPointsToWorkflowGraph,
  buildSchemaForContract,
  getUnifiedSchemasMap,
  MODEL_SCHEMAS,
  schemaFor,
  optionLabel,
  slotLimit,
  applyConstraints,
  assertFreeTier,
  uniqueUrls,
  mapSubmitParams,
  enumOptionsOf,
  sizeOptionsOf,
  CANONICAL_VOCABULARY,
  normalizeCanonicalInput,
  evaluateModelRules,
  compileModelDialect,
};
