/**
 * 内置生成协议只读清单 (Read-only Builtin Protocols Manifest)
 * 仅用于协议规范展示、管理端契约审计，不直接承接运行期请求转发。
 */

const BUILTIN_PROTOCOLS_MANIFEST = {
  http_json: {
    protocol: 'http_json',
    name: 'HTTP JSON 同步生成',
    method: 'POST',
    urlTemplate: '{{baseUrl}}{{path}}',
    paramLocations: {
      prompt: 'body.prompt',
      model: 'body.model',
      size: 'body.size',
      ratio: 'body.ratio',
      image: 'body.image / body.extra_body.image',
      apiKey: 'headers.Authorization (Bearer ***)',
    },
    note: '同步调用生成接口，适用于主流 OpenAI 格式、火山方舟 Seedream 及 Agnes 图像接口',
  },
  async_http_job: {
    protocol: 'async_http_job',
    name: '异步任务轮询协议',
    method: 'POST (提交) / GET (轮询)',
    urlTemplate: '提交: {{baseUrl}}{{submitPath}} | 轮询: {{baseUrl}}{{pollPathTemplate}}',
    pollUrlTemplateDefault: '/v1/tasks/{{taskId}}',
    paramLocations: {
      prompt: 'body.prompt',
      model: 'body.model',
      seconds: 'body.seconds',
      ratio: 'body.aspect_ratio',
      image: 'body.images',
      taskId: 'pollUrl.{{taskId}}',
      apiKey: 'headers.Authorization (Bearer ***)',
    },
    note: '异步提交任务并依据 task_id 轮询状态与产物 URL，适用于方舟 Seedance、Agnes Video 及魔搭视频生成',
  },
  unified_gateway: {
    protocol: 'unified_gateway',
    name: '统一处理网关协议',
    method: 'POST',
    urlTemplate: '{{baseUrl}}{{submitPath}}',
    paramLocations: {
      action: 'body.action',
      params: 'body.params',
      fid: 'body.input.fid',
      requestId: 'pollBody.request_id',
      apiKey: 'headers.Authorization (Bearer ***)',
    },
    note: '统一后台管线批处理提交与轮询协议',
  },
  qwenimage_local: {
    protocol: 'qwenimage_local',
    name: '本地 Qwen2.1-Image (ncnn-vulkan)',
    method: 'POST (提交) / GET (轮询)',
    urlTemplate: '面板 :9000 提交 {{baseUrl}}/api/qw/generate，轮询 {{baseUrl}}/api/qw/tasks/{{taskId}}；基址不是 :9000 时仍走 /api/generate 与 /api/tasks/{{taskId}}',
    paramLocations: {
      prompt: 'form.prompt',
      refs: 'form.refs (multipart)',
      cfg: 'form.cfg',
      taskId: 'pollUrl.task_id',
    },
    note: '管理台挂载 http://192.168.1.107:9000 的 /api/qw。宽高只在发给 Qwen 时对齐到 32 的倍数。产物仍从面板 /product/qw 取。',
  },
  doubao_music: {
    protocol: 'doubao_music',
    name: '火山引擎豆包音乐',
    method: 'POST',
    urlTemplate: 'https://open.volcengineapi.com/?Action=GenSongForTime&Version=2024-08-12',
    paramLocations: {
      prompt: 'body.Prompt / body.Lyrics',
      text: 'body.Text',
      duration: 'body.Duration',
      lang: 'body.Lang',
      ak_sk: 'headers.Authorization (Volcengine HMAC-SHA256)',
    },
    steps: [
      { step: '歌曲提交', method: 'POST', action: 'GenSongForTime', params: 'Lyrics 或 Prompt, Duration, Lang' },
      { step: '纯音乐提交', method: 'POST', action: 'GenBGMForTime', params: 'Text, Duration' },
      { step: '任务轮询', method: 'POST', action: 'QuerySong', params: 'TaskID' },
    ],
    note: '鉴权走请求头的火山 HMAC-SHA256 签名，由 resolveVolcCredentials 读取环境变量或系统配置中的 AK/SK',
  },
  gemini_interactions: {
    protocol: 'gemini_interactions',
    name: 'Google Gemini Interactions',
    method: 'POST',
    urlTemplate: 'https://generativelanguage.googleapis.com/v1beta/interactions?key={{apiKey}}',
    paramLocations: {
      prompt: 'body.input.text',
      model: 'body.model',
      apiKey: 'query.key / header.x-goog-api-key',
    },
    enabled: 0,
    status: '已停用保留',
    note: '已按规划停用，代码及出口定义保留，未来启用时恢复',
  },
  gemini_lyria: {
    protocol: 'gemini_lyria',
    name: 'Google Lyria 音乐',
    method: 'POST',
    urlTemplate: 'https://generativelanguage.googleapis.com/v1beta/interactions?key={{apiKey}}',
    paramLocations: {
      prompt: 'body.input.text',
      model: 'body.model',
      apiKey: 'query.key / header.x-goog-api-key',
    },
    enabled: 0,
    status: '已停用保留',
    note: '已按规划停用，代码及出口定义保留，未来启用时恢复',
  },
  gemini_veo: {
    protocol: 'gemini_veo',
    name: 'Google Veo 视频',
    method: 'POST',
    urlTemplate: 'https://generativelanguage.googleapis.com/v1beta/models/{{model}}:predictLongRunning?key={{apiKey}}',
    paramLocations: {
      prompt: 'body.instances.0.prompt',
      model: 'urlPath.model',
      apiKey: 'query.key / header.x-goog-api-key',
    },
    enabled: 0,
    status: '已停用保留',
    note: '已按规划停用，代码及出口定义保留，未来启用时恢复',
  },
};

const BUILTIN_PROTOCOL_KEYS = new Set(Object.keys(BUILTIN_PROTOCOLS_MANIFEST));

function isBuiltinProtocol(protocol) {
  return BUILTIN_PROTOCOL_KEYS.has(String(protocol || '').trim());
}

function getBuiltinProtocolManifest(protocol) {
  return BUILTIN_PROTOCOLS_MANIFEST[protocol] || null;
}

function listAllManifests() {
  return Object.values(BUILTIN_PROTOCOLS_MANIFEST);
}

const getProtocolManifest = getBuiltinProtocolManifest;

module.exports = {
  BUILTIN_PROTOCOLS_MANIFEST,
  isBuiltinProtocol,
  getBuiltinProtocolManifest,
  getProtocolManifest,
  listAllManifests,
};
