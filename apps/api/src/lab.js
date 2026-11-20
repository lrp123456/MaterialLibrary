/**
 * AI 试验场：能力目录发现 + 统一提交/轮询。
 * 不复制底层业务：Umbra 走 ai-tasks，网关走 process，生成走 gen executeAdapter。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getUmbraConfig } = require('./umbra');
const aiTasks = require('./ai-tasks');
const processSvc = require('./process');
const { executeAdapter } = require('./gen');
const { MODEL_SCHEMAS, assertFreeTier, uniqueUrls } = require('./model-schemas');
const {
  OFFICIAL_STUDIO,
  matchOfficial,
  providerDisplayName,
  officialNameFor,
  resolveModelCode,
  officialIdOf,
  capsFor,
  norm,
} = require('./studio-catalog');
const genGov = require('./gen-governance');
const { pickAdapterId, adapterMissingError, isGoogleModel } = require('./adapter-match');
const portraitLib = require('./portrait-library');
const { assertSeedanceOrEmpty } = require('./portrait-contract');
const doubaoMusic = require('./doubao-music');

function convertLabRefs(text) {
  return String(text || '');
}

function contractModesFor(db, modelCode) {
  try {
    const { resolveModelExecution } = require('./models-contract');
    const modes = resolveModelExecution(db, modelCode)?.model?.modes;
    if (Array.isArray(modes) && modes.length) return modes;
  } catch (_) {}
  return null;
}

const GROUPS = [
  { id: 'image_edit', label: '图片精修', sort: 10 },
  { id: 'generate', label: '生成方案', sort: 20 },
  { id: 'video', label: '视频方案', sort: 30 },
  { id: 'music', label: 'AI 音乐', sort: 40 },
  { id: 'portrait', label: 'AI 人像', sort: 50 }
];

const RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4', '2:3', '3:2', '21:9'];

/** 模型默认能力模板：params_json 未声明时自动补全 */
const MODE_TEMPLATES = {
  image: [
    { id: 'text_to_image', label: '文生图', apiMode: 'text', requiresImages: false },
    { id: 'image_to_image', label: '图生图', apiMode: 'image', requiresImages: true },
    { id: 'image_reference', label: '图参考', apiMode: 'image', requiresImages: true, multiImage: true },
    { id: 'omni_reference', label: '全能参考', apiMode: 'image', requiresImages: true, multiImage: true },
  ],
  video_generic: [
    { id: 'text_to_video', label: '文生视频', apiMode: 'text', requiresImages: false },
    { id: 'image_to_video', label: '图生视频', apiMode: 'reference', requiresImages: true },
  ],
};

function resolveModes(kind, _modelCode, declared) {
  if (Array.isArray(declared) && declared.length) return declared;
  if (kind === 'image' || kind === 'portrait') return MODE_TEMPLATES.image;
  if (kind === 'video') return MODE_TEMPLATES.video_generic;
  return [];
}

/** 同步 gen 结果的短时缓存，便于 lab status 回读 */
const genResultCache = new Map();
const GEN_CACHE_TTL_MS = 30 * 60 * 1000;

function cacheGenResult(runId, payload) {
  genResultCache.set(runId, { ...payload, cachedAt: Date.now() });
  if (genResultCache.size > 200) {
    const cutoff = Date.now() - GEN_CACHE_TTL_MS;
    for (const [k, v] of genResultCache) {
      if ((v.cachedAt || 0) < cutoff) genResultCache.delete(k);
    }
  }
}

function getGenResult(runId) {
  const hit = genResultCache.get(runId);
  if (!hit) return null;
  if (Date.now() - (hit.cachedAt || 0) > GEN_CACHE_TTL_MS) {
    genResultCache.delete(runId);
    return null;
  }
  return hit;
}

function adapterConfigured(a) {
  if (!a || !a.enabled) return false;
  const base = a.base_url || '';
  return Boolean(base) && !String(base).includes('UNCONFIGURED');
}

function listReadyAdapters(db, kind) {
  const rows = db.prepare(
    "SELECT id, label, kind, protocol, base_url, enabled FROM gen_adapters WHERE kind=? ORDER BY builtin DESC, id ASC"
  ).all(kind);
  return rows.filter(adapterConfigured).map(r => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    protocol: r.protocol,
    ready: true
  }));
}

/** 确保 music 适配器占位存在（配置 Key/端点后自动 ready） */
function ensureMusicAdapter(db) {
  try {
    const hit = db.prepare("SELECT id FROM gen_adapters WHERE id='volc_music'").get();
    if (hit) return;
    const now = Date.now();
    db.prepare(`
      INSERT OR IGNORE INTO gen_adapters
        (id, label, kind, builtin, protocol, base_url, secrets_json, config_json, enabled, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'volc_music',
      '火山音乐/TTS',
      'music',
      1,
      'http_json',
      'https://openspeech.bytedance.com',
      JSON.stringify({ apiKey: '' }),
      JSON.stringify({
        path: '/api/v1/tts',
        method: 'POST',
        defaultModel: 'volc_tts',
        bodyTemplate: {
          app: { appid: '{{appid}}', token: '{{apiKey}}', cluster: 'volcano_tts' },
          user: { uid: 'album_sync' },
          audio: { voice_type: 'BV001_streaming', encoding: 'mp3', speed_ratio: 1.0 },
          request: { reqid: '{{seed}}', text: '{{prompt}}', operation: 'query' }
        },
        resultB64Path: 'data',
        timeoutMs: 60000
      }),
      0,
      now,
      now
    );
  } catch (e) {
    // 表不存在等忽略
  }
}

function engineStatus(db) {
  const umbra = getUmbraConfig(db);
  const touchReady = Boolean(umbra.token && umbra.templates?.touch);
  const walkReady = Boolean(umbra.token && umbra.templates?.walkthrough);
  const umbraReady = Boolean(umbra.token) && (touchReady || walkReady);

  const gatewayAdapter = processSvc.getGatewayAdapter(db);
  const gatewayReady = processSvc.isGatewayConfigured(gatewayAdapter);

  const imageAdapters = listReadyAdapters(db, 'image');
  const videoAdapters = listReadyAdapters(db, 'video');
  let musicAdapters = [];
  try { musicAdapters = listReadyAdapters(db, 'music'); } catch (_) { musicAdapters = []; }

  let umbraReason = null;
  if (!umbraReady) {
    if (!umbra.token) umbraReason = '未配置 Umbra token';
    else umbraReason = '未配置 Umbra 模板 template_id';
  }

  return {
    umbra: {
      ready: umbraReady,
      touchReady,
      walkReady,
      reason: umbraReason,
      base: umbra.base || null
    },
    gateway: {
      ready: gatewayReady,
      adapterId: 'unified_gateway',
      reason: gatewayReady ? null : '统一处理网关未配置（unified_gateway.base_url）'
    },
    gen: {
      ready: imageAdapters.length > 0 || videoAdapters.length > 0,
      imageAdapters,
      videoAdapters,
      reason:
        imageAdapters.length || videoAdapters.length
          ? null
          : '没有可用的生成适配器（image/video 均未就绪）'
    },
    musicAdapters,
    volc: (() => {
      try {
        return portraitLib.volcReadiness({ db });
      } catch (e) {
        return {
          credentials: false,
          publicBaseOk: false,
          portraitReady: false,
          reason: e.message,
          portraitReason: e.message,
        };
      }
    })(),
  };
}

function entryBase(partial) {
  return {
    ready: true,
    unavailableReason: null,
    requiresAsset: true,
    multiAsset: false,
    minAssets: 1,
    maxAssets: 1,
    kindHint: 'image',
    fields: [],
    ...partial
  };
}

function buildEntries(engines) {
  const entries = [];
  const um = engines.umbra;
  const gw = engines.gateway;
  const gen = engines.gen;
  try {
    // music adapter 占位（幂等）
  } catch (_) {}

  // ---- Umbra 图片精修 ----
  const umbraImageOk = um.ready && um.touchReady;
  const umbraImageReason = !um.ready
    ? um.reason
    : !um.touchReady
      ? '未配置 touch 编辑模板 TPL_TOUCH_EDITOR'
      : null;

  entries.push(
    entryBase({
      id: 'umbra.expand',
      engine: 'umbra',
      group: 'image_edit',
      label: '智能扩图',
      description: '四向物理画幅智能扩展（Umbra touch）',
      ready: umbraImageOk,
      unavailableReason: umbraImageOk ? null : umbraImageReason,
      fields: [
        {
          name: 'expand_ratio',
          label: '目标画幅',
          type: 'select',
          options: ['16:9', '9:16', '1:1', '4:3', '3:4'],
          default: '16:9',
          required: true
        }
      ]
    }),
    entryBase({
      id: 'umbra.remove',
      engine: 'umbra',
      group: 'image_edit',
      label: '精准消除',
      description: '笔刷/区域消除（可 bbox 定位）',
      ready: umbraImageOk,
      unavailableReason: umbraImageOk ? null : umbraImageReason,
      fields: [
        {
          name: 'bbox',
          label: '区域 bbox (x1,y1,x2,y2)',
          type: 'text',
          placeholder: '例如 100,120,400,480',
          required: false
        }
      ]
    }),
    entryBase({
      id: 'umbra.insert',
      engine: 'umbra',
      group: 'image_edit',
      label: '透视安装',
      description: '四点透视安装软装/物件',
      ready: umbraImageOk,
      unavailableReason: umbraImageOk ? null : umbraImageReason,
      fields: [
        {
          name: 'perspective_quad',
          label: '透视四点 JSON',
          type: 'text',
          placeholder: '[{"x":20,"y":30},...] 或 bbox',
          required: false
        },
        {
          name: 'bbox',
          label: '区域 bbox (x1,y1,x2,y2)',
          type: 'text',
          required: false
        }
      ]
    }),
    entryBase({
      id: 'umbra.replace',
      engine: 'umbra',
      group: 'image_edit',
      label: '物品替换',
      description: '区域内物体替换/重绘',
      ready: umbraImageOk,
      unavailableReason: umbraImageOk ? null : umbraImageReason,
      fields: [
        {
          name: 'bbox',
          label: '区域 bbox (x1,y1,x2,y2)',
          type: 'text',
          required: false
        }
      ]
    }),
    entryBase({
      id: 'umbra.upscale',
      engine: 'umbra',
      group: 'image_edit',
      label: '高清放大',
      description: '超分细节增强（Umbra touch）',
      ready: umbraImageOk,
      unavailableReason: umbraImageOk ? null : umbraImageReason,
      fields: []
    })
  );

  // ---- Umbra 视频 ----
  const walkOk = um.ready && um.walkReady;
  const walkReason = !um.ready
    ? um.reason
    : !um.walkReady
      ? '未配置 walkthrough 模板 TPL_WALKTHROUGH'
      : null;

  entries.push(
    entryBase({
      id: 'umbra.spatial_walkthrough',
      engine: 'umbra',
      group: 'video',
      label: '空间漫游成片',
      description: '2–6 张空间图拼接漫游视频',
      ready: walkOk,
      unavailableReason: walkOk ? null : walkReason,
      multiAsset: true,
      minAssets: 2,
      maxAssets: 6,
      kindHint: 'image',
      fields: [
        {
          name: 'camera_style',
          label: '运镜风格',
          type: 'text',
          placeholder: '如 slow_pan / orbit',
          required: false
        },
        {
          name: 'aspect_ratio',
          label: '成片画幅',
          type: 'select',
          options: ['16:9', '9:16', '1:1'],
          default: '16:9',
          required: false
        },
        {
          name: 'scene_duration',
          label: '单场景时长(秒)',
          type: 'number',
          default: 3,
          required: false
        }
      ]
    })
  );

  // ---- Gateway ----
  const gwOk = gw.ready;
  const gwReason = gw.reason;

  const gwCommon = (partial) =>
    entryBase({
      engine: 'gateway',
      ready: gwOk,
      unavailableReason: gwOk ? null : gwReason,
      ...partial
    });

  entries.push(
    gwCommon({
      id: 'gateway.outpaint',
      group: 'image_edit',
      label: '网关扩图',
      description: '统一网关 outpaint 智能扩图',
      fields: [
        {
          name: 'ratio',
          label: '目标画幅',
          type: 'select',
          options: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          default: '16:9',
          required: true
        },
        {
          name: 'extend_side',
          label: '扩展方向',
          type: 'select',
          options: ['all', 'left', 'right', 'top', 'bottom'],
          default: 'all',
          required: false
        }
      ]
    }),
    gwCommon({
      id: 'gateway.ratio_convert',
      group: 'image_edit',
      label: '画幅转换',
      description: '网关 ratio_convert 重绘画幅',
      fields: [
        {
          name: 'target',
          label: '目标画幅',
          type: 'select',
          options: ['9:16', '3:4', '4:3', '16:9', '1:1'],
          default: '9:16',
          required: true
        }
      ]
    }),
    gwCommon({
      id: 'gateway.watermark_remove',
      group: 'image_edit',
      label: '去水印',
      description: '统一网关 watermark_remove',
      fields: []
    }),
    gwCommon({
      id: 'gateway.upscale',
      group: 'image_edit',
      label: '网关超分',
      description: '统一网关 upscale 2x/4x',
      fields: [
        {
          name: 'scale',
          label: '放大倍数',
          type: 'select',
          options: ['2', '4'],
          default: '2',
          required: true
        }
      ]
    })
  );

  // ---- Mask 精准编辑（端侧 EdgeSAM 选区 → 服务端路由） ----
  // ready：Umbra touch 或统一网关任一可用；云端 adapter 配置后可扩展
  const maskEditOk = umbraImageOk || gwOk;
  const maskEditReason = maskEditOk
    ? null
    : (umbraImageReason || gwReason || '无可用精准编辑引擎');
  entries.push(
    entryBase({
      id: 'edit.masked',
      engine: 'edit_mask',
      group: 'image_edit',
      label: '选区精准编辑',
      description: '端侧 mask/polygon 选区，服务端消除/替换/插入',
      ready: maskEditOk,
      unavailableReason: maskEditReason,
      fields: [
        {
          name: 'mode',
          label: '编辑类型',
          type: 'select',
          options: ['remove', 'replace', 'insert', 'refine'],
          default: 'remove',
          required: true
        },
        {
          name: 'maskUrl',
          label: 'Mask PNG URL',
          type: 'text',
          required: false
        },
        {
          name: 'polygon',
          label: '多边形顶点 JSON',
          type: 'text',
          required: false
        },
        {
          name: 'prompt',
          label: '编辑意图',
          type: 'text',
          required: false
        }
      ]
    })
  );

  // keep gateway.video after the block that previously contained it — restored below
  entries.push(
    gwCommon({
      id: 'gateway.video_transcode',
      group: 'video',
      label: '视频转码',
      description: '统一网关 video_transcode',
      kindHint: 'video',
      fields: [
        {
          name: 'codec',
          label: '编码',
          type: 'select',
          options: ['h264', 'h265'],
          default: 'h264',
          required: true
        },
        {
          name: 'crf',
          label: 'CRF',
          type: 'number',
          default: 23,
          required: false
        }
      ]
    }),
    gwCommon({
      id: 'gateway.video_frames',
      group: 'video',
      label: '视频抽帧',
      description: '统一网关 video_frames 抽封面帧',
      kindHint: 'video',
      fields: [
        {
          name: 'count',
          label: '抽帧数量',
          type: 'number',
          default: 1,
          required: false
        }
      ]
    }),
    gwCommon({
      id: 'gateway.video_generate',
      group: 'video',
      label: '网关图生视频',
      description: '统一网关 video_generate（以资产为底图）',
      kindHint: 'image',
      fields: [
        {
          name: 'prompt',
          label: '提示词',
          type: 'text',
          placeholder: '室内空间缓慢平移漫游',
          required: false
        },
        {
          name: 'duration',
          label: '时长(秒)',
          type: 'number',
          default: 5,
          required: false
        },
        {
          name: 'aspect',
          label: '画幅',
          type: 'select',
          options: ['16:9', '9:16', '1:1'],
          default: '16:9',
          required: false
        }
      ]
    })
  );

  // ---- AI 音乐 / 人像（工作流入口；引擎就绪前 ready=false） ----
  // music 适配器从 engines.gen 旁路读取：buildEntries 无 db
  const volc = engines.volc || {};
  const musicReady = !!volc.credentials;
  const portraitApiReady = !!volc.portraitReady;
  const musicReason = volc.reason || '未配置火山 AK/SK';
  entries.push(
    entryBase({
      id: 'music.bgm',
      engine: 'music',
      group: 'music',
      label: 'AI 背景音乐',
      description: '豆包纯音乐 v5，生成后转存到音乐库',
      ready: musicReady,
      unavailableReason: musicReady ? null : musicReason,
      requiresAsset: false,
      minAssets: 0,
      maxAssets: 0,
      kindHint: 'audio',
      fields: [
        { name: 'prompt', label: '风格描述', type: 'text', default: '温暖治愈的室内空间背景乐，钢琴与轻弦乐', required: true },
        { name: 'duration', label: '时长(秒)', type: 'number', default: 30, required: false },
        { name: 'mood', label: '情绪', type: 'select', options: ['平静', '温暖', '史诗', '悬疑', '欢快'], default: '温暖', required: false }
      ]
    }),
    entryBase({
      id: 'music.song',
      engine: 'music',
      group: 'music',
      label: 'AI 歌曲',
      description: '豆包歌曲 v5。提示词和歌词二选一',
      ready: musicReady,
      unavailableReason: musicReady ? null : musicReason,
      requiresAsset: false,
      minAssets: 0,
      maxAssets: 0,
      kindHint: 'audio',
      fields: [
        { name: 'prompt', label: '歌词/主题', type: 'text', default: '关于理想家的温暖流行歌', required: true },
        { name: 'duration', label: '时长(秒)', type: 'number', default: 60, required: false }
      ]
    }),
    entryBase({
      id: 'music.tts',
      engine: 'music',
      group: 'music',
      label: 'TTS 旁白',
      description: '火山语音合成旁白，可挂到视频',
      ready: false,
      unavailableReason: '本次不做',
      requiresAsset: false,
      minAssets: 0,
      maxAssets: 0,
      kindHint: 'audio',
      fields: [
        { name: 'prompt', label: '旁白文本', type: 'text', default: '欢迎来到这个充满自然光的理想之家。', required: true },
        { name: 'voice', label: '音色', type: 'select', options: ['通用女声', '通用男声', '知性女声'], default: '通用女声', required: false }
      ]
    }),
    entryBase({
      id: 'music.video_score',
      engine: 'music',
      group: 'music',
      label: '视频自动配乐',
      description: '为源视频/成片匹配并合成 BGM',
      ready: false,
      unavailableReason: '本次不做',
      requiresAsset: true,
      minAssets: 1,
      maxAssets: 1,
      kindHint: 'video',
      fields: [
        { name: 'prompt', label: '配乐风格（可选）', type: 'text', default: '电影感空间漫游配乐', required: false }
      ]
    }),
    entryBase({
      id: 'portrait.assets_api',
      engine: 'portrait',
      group: 'portrait',
      label: '虚拟人像资产入库',
      description: '方舟私域虚拟人像库 CreateAsset，图片需能被公网 HTTPS 拉取',
      ready: portraitApiReady,
      unavailableReason: portraitApiReady ? null : (volc.portraitReason || '未配置火山 AK/SK 或公网 HTTPS 地址'),
      requiresAsset: true,
      minAssets: 1,
      maxAssets: 1,
      kindHint: 'image',
      fields: [
        { name: 'asset_group', label: '资产组', type: 'text', default: 'default_virtual', required: true }
      ]
    })
  );

  // ---- Gen 适配器 ----
  const imgOk = gen.imageAdapters.length > 0;
  const vidOk = gen.videoAdapters.length > 0;

  const adapterField = (adapters) => ({
    name: 'adapterId',
    label: '生成适配器',
    type: 'select',
    options: adapters.map(a => a.id),
    labels: Object.fromEntries(adapters.map(a => [a.id, a.label])),
    default: adapters[0]?.id || null,
    required: true
  });

  entries.push(
    entryBase({
      id: 'gen.image',
      engine: 'gen',
      group: 'generate',
      label: '图片生成',
      description: '文生图；可选源素材做图生图',
      ready: imgOk,
      unavailableReason: imgOk ? null : '没有就绪的 image 生成适配器',
      requiresAsset: false,
      multiAsset: false,
      minAssets: 0,
      maxAssets: 1,
      kindHint: 'image',
      fields: [
        {
          name: 'prompt',
          label: '提示词',
          type: 'text',
          required: true,
          default: '现代极简客厅室内设计效果图，自然光，干净构图'
        },
        adapterField(gen.imageAdapters),
        {
          name: 'model',
          label: '模型（可选）',
          type: 'text',
          required: false
        },
        {
          name: 'ratio',
          label: '画幅',
          type: 'select',
          options: RATIO_OPTIONS,
          default: '9:16',
          required: false
        }
      ]
    }),
    entryBase({
      id: 'gen.video',
      engine: 'gen',
      group: 'generate',
      label: '视频生成',
      description: '文生视频；可选源素材做图生视频',
      ready: vidOk,
      unavailableReason: vidOk ? null : '没有就绪的 video 生成适配器',
      requiresAsset: false,
      multiAsset: false,
      minAssets: 0,
      maxAssets: 1,
      kindHint: 'image',
      fields: [
        {
          name: 'prompt',
          label: '提示词',
          type: 'text',
          required: true,
          default: '室内空间全景镜头缓慢平移漫游'
        },
        adapterField(gen.videoAdapters),
        {
          name: 'model',
          label: '模型（可选）',
          type: 'text',
          required: false
        },
        {
          name: 'ratio',
          label: '画幅',
          type: 'select',
          options: RATIO_OPTIONS,
          default: '16:9',
          required: false
        },
        {
          name: 'duration',
          label: '时长(秒)',
          type: 'number',
          default: 5,
          required: false
        }
      ]
    })
  );

  entries.push(
    entryBase({
      id: 'chat.assistant',
      engine: 'chat',
      group: 'generate',
      label: '对话助手',
      description: '文本/视觉对话（LiteLLM），可引用图片与视频抽帧',
      ready: true,
      requiresAsset: false,
      minAssets: 0,
      maxAssets: 0,
      kindHint: 'chat',
      fields: [
        { name: 'prompt', label: '消息', type: 'text', required: true },
        { name: 'model', label: '模型', type: 'text', required: false }
      ]
    }),
    entryBase({
      id: 'gen.music',
      engine: 'music',
      group: 'music',
      label: '文生音乐',
      description: '豆包歌曲或纯音乐。旧的 text_to_music 按纯音乐处理',
      ready: musicReady,
      unavailableReason: musicReady ? null : musicReason,
      requiresAsset: false,
      minAssets: 0,
      maxAssets: 0,
      kindHint: 'audio',
      fields: [
        { name: 'prompt', label: '风格描述', type: 'text', required: true },
        { name: 'model', label: '模型', type: 'text', required: false },
        { name: 'duration', label: '时长(秒)', type: 'number', default: 30, required: false }
      ]
    }),
    entryBase({
      id: 'gen.music.from_video',
      engine: 'music',
      group: 'music',
      label: '视频配乐',
      description: '抽帧理解画面后作曲',
      ready: false,
      unavailableReason: '本次不做',
      requiresAsset: false,
      minAssets: 0,
      maxAssets: 1,
      kindHint: 'video',
      fields: [
        { name: 'prompt', label: '配乐风格（可选）', type: 'text', required: false },
        { name: 'model', label: '模型', type: 'text', required: false },
        { name: 'videoUrl', label: '视频 URL', type: 'text', required: false }
      ]
    }),
    entryBase({
      id: 'gen.portrait',
      engine: 'gen',
      group: 'portrait',
      label: '文生人像',
      description: '人像走图片适配器 + 人像目录，不走火山 Entry',
      ready: imgOk,
      unavailableReason: imgOk ? null : '没有就绪的图片生成适配器',
      requiresAsset: false,
      minAssets: 0,
      maxAssets: 0,
      kindHint: 'image',
      fields: [
        { name: 'prompt', label: '提示词', type: 'text', required: true },
        { name: 'model', label: '模型', type: 'text', required: false },
        { name: 'ratio', label: '画幅', type: 'select', options: RATIO_OPTIONS, default: '9:16', required: false }
      ]
    }),
    entryBase({
      id: 'gen.portrait.from_image',
      engine: 'gen',
      group: 'portrait',
      label: '图生人像',
      description: '参考图走人像图片适配器',
      ready: imgOk,
      unavailableReason: imgOk ? null : '没有就绪的图片生成适配器',
      requiresAsset: false,
      minAssets: 0,
      maxAssets: 1,
      kindHint: 'image',
      fields: [
        { name: 'prompt', label: '提示词', type: 'text', required: true },
        { name: 'model', label: '模型', type: 'text', required: false }
      ]
    })
  );

  return entries;
}

function getCapabilityCatalog(services) {
  const { db } = services;
  try { ensureMusicAdapter(db); } catch (_) {}
  const engines = engineStatus(db);
  const entries = buildEntries(engines);
  let jobs = [];
  try { jobs = genGov.jobsForCapabilities(db); } catch (_) { jobs = []; }
  return {
    engines,
    groups: GROUPS,
    entries,
    // 移动端 AI 工坊：图片/视频分区模型目录（服务端 owns 真相）
    studio: buildStudioCatalog(db, engines),
    // ★ 扁平能力表：客户端唯一真相源（替代客户端自带的 modelCaps.js）
    modelCaps: buildModelCapsMap(),
    jobs,
    generatedAt: Date.now()
  };
}

/**
 * 给 App 的结构化模型目录。官方展示名为真相源，DB 只贡献启用态与适配器。
 */
function buildStudioCatalog(db, engines) {
  const imageAdapters = engines.gen?.imageAdapters || [];
  const videoAdapters = engines.gen?.videoAdapters || [];
  const musicAdapters = engines.musicAdapters || [];

  let modelRows = [];
  try {
    modelRows = db.prepare(`
      SELECT m.id, m.provider_id, m.name, m.model_code, m.capabilities, m.params_json, m.is_default, m.enabled
      FROM llm_models m
      WHERE m.enabled=1
      ORDER BY m.is_default DESC, m.provider_id ASC, m.id ASC
    `).all();
  } catch (e) {
    modelRows = [];
  }

  function adapterFor(kind, modelCode) {
    const list = kind === 'video'
      ? videoAdapters
      : kind === 'music'
        ? musicAdapters
        : imageAdapters;
    return pickAdapterId(kind === 'portrait' ? 'image' : kind, modelCode, list);
  }

  const usedRowIds = new Set();

  function hydrateOfficial(domain, kind) {
    const block = OFFICIAL_STUDIO[domain] || { models: [] };
    const entryId = kind === 'video' ? 'gen.video' : kind === 'image' ? 'gen.image' : `gen.${domain}`;
    return (block.models || []).map((om) => {
      const row = matchOfficial(om, modelRows);
      if (row) usedRowIds.add(row.id);
      const code = om.model_code;
      const adapterKind = kind === 'video' ? 'video' : kind === 'music' ? 'music' : 'image';
      const adapterId = (kind === 'image' || kind === 'video' || kind === 'portrait' || kind === 'music')
        ? adapterFor(adapterKind, code)
        : null;
      let rowParams = {};
      try { rowParams = JSON.parse(row?.params_json || '{}'); } catch {}
      return {
        id: om.id,
        catalogId: row?.id || om.dbId || om.id,
        model_code: code,
        provider: om.provider,
        providerName: om.providerName,
        name: om.name,
        badge: om.badge || '',
        description: om.badge || om.providerName,
        type: kind === 'video' ? 'video' : kind === 'image' || kind === 'portrait' ? 'image' : kind,
        default: om.id === block.defaultModel,
        adapterId,
        entryId,
        // ★ 能力描述符：客户端与管线 B 的唯一真相源（客户端不再自带模型表）
        caps: capsFor(code) || null,
        modes: resolveModes(kind === 'video' ? 'video' : 'image', code, contractModesFor(db, om.id) || contractModesFor(db, code) || rowParams.modes),
        ratios: rowParams.ratios || (kind === 'video'
          ? ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9']
          : ['9:16', '16:9', '1:1', '3:4', '4:3', '2:3', '3:2', '21:9']),
        durations: om.durations || rowParams.durations,
        sizeHint: (om.params && om.params.size && om.params.size[0]) || (kind === 'video' ? '720P' : '2K'),
        params: om.params || {},
        advanced: om.advanced || [],
        free: om.free || null,
        schema: (() => {
          let s = MODEL_SCHEMAS[om.id] ? JSON.parse(JSON.stringify(MODEL_SCHEMAS[om.id])) : (om.schema ? JSON.parse(JSON.stringify(om.schema)) : null);
          if (s && db) {
            try {
              const cs = genGov.getCustomSchema(db, om.id);
              if (cs && cs.custom_fields && cs.custom_fields.length > 0) {
                s.custom = cs.custom_fields;
                const existingKeys = new Set((s.advanced || []).map(f => f.key).concat((s.common || []).map(f => f.key)));
                for (const cf of cs.custom_fields) {
                  if (!existingKeys.has(cf.key)) {
                    s.advanced = (s.advanced || []).concat(cf);
                    existingKeys.add(cf.key);
                  }
                }
              }
            } catch (_) {}
          }
          return s;
        })(),
        polishHint: (MODEL_SCHEMAS[om.id] && MODEL_SCHEMAS[om.id].polishHint) || '',
      };
    });
  }

  function extraModels(kind) {
    const out = [];
    for (const r of modelRows) {
      if (usedRowIds.has(r.id)) continue;
      const caps = String(r.capabilities || '');
      const code = String(r.model_code || '');
      if (/^agnes-(2\.5|3\.0)/.test(code) && !code.includes('image') && !code.includes('video')) continue;
      if (code.includes('/') && /^(openai|gemini|volcengine|agnes)\//i.test(code)) continue;
      if ((kind === 'image' || kind === 'video') && ['agnes', 'volcengine', 'gemini'].includes(String(r.provider_id))) continue;
      if (kind === 'video') {
        if (!(caps.includes('video') && !caps.includes('image'))) continue;
      } else if (kind === 'image') {
        if (!caps.includes('image') || caps.includes('video')) continue;
      } else if (kind === 'chat') {
        if (!caps.includes('chat') && !caps.includes('vision')) continue;
        if (caps.includes('image') || caps.includes('video')) continue;
      } else continue;

      let params = {};
      try { params = JSON.parse(r.params_json || '{}'); } catch {}
      const adapterId = kind === 'chat' ? null : adapterFor(kind, code);
      out.push({
        id: r.id,
        catalogId: r.id,
        model_code: code,
        provider: r.provider_id,
        providerName: providerDisplayName(r.provider_id, code),
        name: officialNameFor(code, r.name || code),
        badge: params.badge || '',
        description: providerDisplayName(r.provider_id, code),
        type: kind,
        default: false,
        adapterId,
        entryId: kind === 'video' ? 'gen.video' : kind === 'image' ? 'gen.image' : `gen.${kind}`,
        modes: resolveModes(kind, code, contractModesFor(db, code) || params.modes),
        ratios: params.ratios,
        durations: params.durations,
        params: params,
        caps: capsFor(code) || null,
      });
    }

    // 补入自定义注册模型
    if (db) {
      try {
        const customRows = db.prepare("SELECT * FROM gen_model_custom_schemas WHERE custom_config_json IS NOT NULL").all();
        for (const cr of customRows) {
          const cfg = JSON.parse(cr.custom_config_json || '{}');
          if ((cfg.domain || 'image') === kind) {
            const cFields = JSON.parse(cr.custom_fields_json || '[]');
            const customSchema = {
              polishId: cfg.id,
              refStyle: 'generic',
              modes: cfg.modes || [{ id: 'default', label: '默认模式' }],
              common: cFields.slice(0, 3),
              advanced: cFields.slice(3),
              slots: { images: 4, videos: 0, audios: 0 }
            };
            out.push({
              id: cfg.id,
              catalogId: cfg.id,
              model_code: cfg.model_code || cfg.id,
              provider: cfg.provider || 'custom',
              providerName: cfg.providerName || '自定义',
              name: cfg.name || cfg.id,
              badge: '自定义',
              type: kind,
              default: false,
              adapterId: null,
              entryId: kind === 'video' ? 'gen.video' : 'gen.image',
              modes: cfg.modes || [{ id: 'default', label: '默认模式' }],
              schema: customSchema,
              custom_fields: cFields
            });
          }
        }
      } catch (_) {}
    }
    return out;
  }

  const imageModels = hydrateOfficial('image', 'image').concat(extraModels('image'));
  const videoModels = hydrateOfficial('video', 'video').concat(extraModels('video'));
  const chatModels = hydrateOfficial('chat', 'chat').concat(extraModels('chat'));
  const musicModels = hydrateOfficial('music', 'music');
  const portraitModels = hydrateOfficial('portrait', 'portrait');

  return {
    image: {
      ready: imageAdapters.length > 0,
      entryId: 'gen.image',
      defaultModel: OFFICIAL_STUDIO.image.defaultModel,
      modes: ['text_to_image', 'image_to_image', 'image_reference', 'omni_reference'],
      models: imageModels,
    },
    video: {
      ready: videoAdapters.length > 0,
      entryId: 'gen.video',
      defaultModel: OFFICIAL_STUDIO.video.defaultModel,
      modes: ['text_to_video', 'image_to_video', 'first_last_frame'],
      models: videoModels,
    },
    chat: {
      ready: true,
      entryId: 'chat.assistant',
      defaultModel: OFFICIAL_STUDIO.chat.defaultModel,
      models: chatModels,
    },
    music: {
      ready: musicAdapters.length > 0,
      entryId: 'gen.music',
      defaultModel: OFFICIAL_STUDIO.music.defaultModel,
      models: musicModels,
    },
    portrait: {
      ready: imageAdapters.length > 0,
      entryId: 'gen.portrait',
      defaultModel: OFFICIAL_STUDIO.portrait.defaultModel,
      models: portraitModels,
    },
    edit: buildEditCatalog(db, engines),
    quick: { ready: true },
  };
}

/** §12 studio.edit：从 llm_models 中筛 image_edit / mask 能力 */
function buildEditCatalog(db, engines) {
  const imageAdapters = engines.gen?.imageAdapters || [];
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT m.id, m.provider_id, m.name, m.model_code, m.capabilities, m.params_json, m.is_default
      FROM llm_models m
      WHERE m.enabled=1
        AND (
          instr(m.capabilities, 'image_edit') > 0
          OR instr(m.capabilities, 'mask_edit') > 0
          OR instr(lower(m.model_code), 'edit') > 0
          OR instr(lower(m.model_code), 'seedream') > 0
          OR instr(lower(m.model_code), 'qwen-image') > 0
        )
      ORDER BY m.is_default DESC, m.id ASC
    `).all();
  } catch (_) {
    rows = [];
  }

  const models = [];
  for (const r of rows) {
    let params = {};
    try { params = JSON.parse(r.params_json || '{}'); } catch {}
    const code = String(r.model_code || r.id || '');
    // 适配器：按 provider 关键字猜
    let adapterId = null;
    if (code.includes('seed') || code.includes('ark') || r.provider_id === 'volcengine') {
      adapterId = imageAdapters.find(a => a.id.includes('ark') || a.id.includes('seed'))?.id || null;
    } else if (code.includes('qwen') || r.provider_id === 'dashscope') {
      adapterId = imageAdapters.find(a => a.id.includes('qwen') || a.id.includes('dashscope'))?.id || null;
    }
    if (!adapterId) adapterId = imageAdapters[0]?.id || null;
    if (!adapterId) continue;

    const caps = capsFor(code) || null;
    const regionKind = caps && caps.region ? caps.region.kind : null;

    models.push({
      id: code,
      catalogId: r.id,
      model_code: code,
      name: officialNameFor(code, r.name || code),
      providerName: providerDisplayName(r.provider_id, code),
      type: 'image_edit',
      // ★ 能力描述符 + 由它派生的三个布尔（此前 supportsMask 默认 true，把 Seedream 谎报成支持蒙版）
      caps,
      regionKind,
      supportsMask: !!(caps && caps.region && caps.region.maskChannel),
      supportsCoords: regionKind === 'coords_bbox' || regionKind === 'coords_point',
      // 客户端选区形态（矩形/四点/涂抹）与模型无关：任何形态都可换算成像素 bbox，
      // 再按 regionKind 降级。故 polygons 不表达模型能力，仅为兼容保留。
      supportsPolygon: Boolean(params.supportsPolygon),
      supportsPrompt: params.supportsPrompt !== false,
      modes: params.modes || ['remove', 'replace', 'insert', 'refine'],
      // is_default 在 providers 侧被统一清零，不能当默认标记；默认取官方目录的 image.defaultModel
      default: code === (resolveModelCode(OFFICIAL_STUDIO.image.defaultModel) || ''),
      adapterId,
      entryId: 'edit.masked',
    });
  }

  // 无专用模型时：若 Umbra touch 可用，给一个逻辑默认（路由到 umbra）
  const umbraOk = Boolean(engines.umbra?.ready && engines.umbra?.touchReady);
  if (!models.length && umbraOk) {
    models.push({
      id: 'umbra-touch',
      name: 'Umbra Touch',
      providerName: 'Umbra',
      type: 'image_edit',
      supportsMask: true,
      supportsPolygon: false,
      supportsPrompt: true,
      modes: ['remove', 'replace', 'insert'],
      default: true,
      adapterId: null,
      entryId: 'umbra.remove',
      fallback: true,
    });
  }

  return {
    ready: models.length > 0,
    entryId: 'edit.masked',
    models,
  };
}

/**
 * 扁平能力表：{ [任意 key: catalogId | model_code | alias]: caps }
 * 客户端启动时拉一次，作为「模型能不能吃坐标 / 能不能吃 mask」判定的唯一真相源；
 * 离线时用客户端内置兜底表，联网后以服务端为准覆盖。
 */
function buildModelCapsMap() {
  const out = {};
  /**
   * 先到先得：多个目录条目可能共用同一 model_code
   * （如 seedream5flash 与 seedream_portrait 都是 doubao-seedream-5-0-flash-260915）。
   * domain 迭代序为 chat→image→video→music→portrait，因此 model_code 这类共享键
   * 会归到 image（规范归属），而 portrait 自己的 id/别名键仍照常登记。
   */
  const put = (k, entry) => {
    if (!k) return;
    const raw = String(k);
    if (!raw) return;
    if (!(raw in out)) out[raw] = entry;          // 原始键：seedream5flash / seedance2_0
    const nk = norm(raw);
    if (nk && !(nk in out)) out[nk] = entry;      // 归一键：seedance2-0
  };
  for (const domain of Object.keys(OFFICIAL_STUDIO)) {
    const block = OFFICIAL_STUDIO[domain] || {};
    for (const m of block.models || []) {
      if (!m.caps) continue;
      const entry = Object.assign(
        { domain, catalogId: m.id, modelCode: m.model_code, name: m.name },
        m.caps
      );
      const rawKeys = [m.id, m.dbId, m.catalogId, m.model_code, ...(m.aliases || [])];
      for (const k of rawKeys) put(k, entry);
    }
  }
  return out;
}

function findEntry(entryId) {
  // 用空引擎状态取静态 schema 再覆盖 ready — 避免 catalog 依赖 db 细节
  const dummy = {
    umbra: { ready: false, touchReady: false, walkReady: false, reason: 'probe' },
    gateway: { ready: false, reason: 'probe' },
    gen: { ready: false, imageAdapters: [], videoAdapters: [], reason: 'probe' },
    musicAdapters: [],
  };
  return buildEntries(dummy).find(e => e.id === entryId) || null;
}

function assetLocalPath(config, fid, fileName) {
  const origDir = path.join(config.dataDir, 'cache', 'originals');
  const candidates = [];
  if (fileName) candidates.push(path.join(origDir, `${fid}${path.extname(fileName) || ''}`));
  // 常见扩展名兜底
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.mp4']) {
    candidates.push(path.join(origDir, `${fid}${ext}`));
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function parseJsonMaybe(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/**
 * 统一提交试验场运行。
 * @returns {{engine, runId, mode, status, result?, entryId}}
 */
async function submitLabRun(services, { entryId, fid = null, fids = null, params = {}, createdBy = 'admin', userId = 0, userRole = '' }) {
  const { db, config } = services;
  const engines = engineStatus(services.db);
  const entries = buildEntries(engines);
  const entry = entries.find(e => e.id === entryId);
  if (!entry) {
    const err = new Error(`未知入口: ${entryId}`);
    err.code = 'unknown_entry';
    throw err;
  }
  if (!entry.ready) {
    const err = new Error(entry.unavailableReason || `入口未就绪: ${entryId}`);
    err.code = 'not_ready';
    err.entry = { id: entry.id, ready: false, unavailableReason: entry.unavailableReason };
    throw err;
  }

  let sourceFids = [];
  if (Array.isArray(fids) && fids.length) sourceFids = fids.map(String);
  else if (fid) sourceFids = [String(fid)];

  if (entry.requiresAsset || entry.minAssets > 0) {
    const min = entry.minAssets || 1;
    const max = entry.maxAssets || 1;
    if (sourceFids.length < min) {
      const err = new Error(`该入口至少需要 ${min} 个源素材`);
      err.code = 'missing_fid';
      throw err;
    }
    if (sourceFids.length > max) {
      const err = new Error(`该入口最多 ${max} 个源素材`);
      err.code = 'too_many_fids';
      throw err;
    }
  }

  const p = params || {};
  const primaryFid = sourceFids[0] || null;

  // ---- edit.masked：端侧选区 → Umbra touch（或后续云端 adapter） ----
  if (entry.engine === 'edit_mask' || entry.id === 'edit.masked') {
    const mode = String(p.mode || 'remove');
    const type = ['remove', 'replace', 'insert', 'refine', 'watermark', 'enhance'].includes(mode)
      ? mode
      : 'remove';
    const umbraType = type === 'refine' || type === 'enhance' ? 'replace' : (type === 'watermark' ? 'remove' : type);
    const payload = { ...p, selectionType: p.selectionType || (p.maskUrl ? 'mask' : 'polygon') };
    if (p.maskUrl) payload.mask_url = String(p.maskUrl);
    if (p.polygon) {
      const poly = parseJsonMaybe(p.polygon);
      if (poly) payload.polygon = poly;
    }
    if (!payload.mask_url && !payload.polygon && !payload.bbox) {
      const err = new Error('选区精准编辑需要 maskUrl / polygon / bbox');
      err.code = 'missing_selection';
      throw err;
    }
    if (!engines.umbra?.ready || !engines.umbra?.touchReady) {
      const err = new Error('无可用精准编辑引擎（Umbra touch 未就绪）');
      err.code = 'not_ready';
      throw err;
    }
    const task = aiTasks.enqueueAiTask(db, {
      fid: primaryFid,
      type: umbraType,
      sourceFids: sourceFids.length > 1 ? sourceFids : null,
      payload,
      createdBy
    });
    return {
      engine: 'umbra',
      entryId: 'edit.masked',
      runId: task.taskId,
      mode: 'async',
      status: task.status || 'pending',
      progress: task.progress || 0,
      pollPath: `/lab/runs/umbra/${task.taskId}`
    };
  }

  // ---- Umbra ----
  if (entry.engine === 'umbra') {
    const payload = { ...p };
    if (p.perspective_quad) {
      const quad = parseJsonMaybe(p.perspective_quad);
      if (quad) payload.perspective_quad = quad;
    }
    if (p.bbox) payload.bbox = String(p.bbox);
    if (p.expand_ratio) payload.expand_ratio = String(p.expand_ratio);
    if (p.maskUrl) payload.mask_url = String(p.maskUrl);
    if (p.mask_url) payload.mask_url = String(p.mask_url);
    if (p.polygon) {
      const poly = parseJsonMaybe(p.polygon);
      if (poly) payload.polygon = poly;
    }
    if (p.polygonUnit) payload.polygon_unit = String(p.polygonUnit);
    if (p.maskPolarity) payload.mask_polarity = String(p.maskPolarity);

    const type = entry.id.replace(/^umbra\./, '');
    const task = aiTasks.enqueueAiTask(db, {
      fid: primaryFid,
      type,
      sourceFids: sourceFids.length > 1 ? sourceFids : null,
      payload,
      createdBy
    });
    return {
      engine: 'umbra',
      entryId: entry.id,
      runId: task.taskId,
      mode: 'async',
      status: task.status || 'pending',
      progress: task.progress || 0,
      pollPath: `/lab/runs/umbra/${task.taskId}`
    };
  }

  // ---- Gateway ----
  if (entry.engine === 'gateway') {
    if (!primaryFid) {
      const err = new Error('网关入口需要源素材');
      err.code = 'missing_fid';
      throw err;
    }
    const action = entry.id.replace(/^gateway\./, '');
    const job = processSvc.enqueueProcessJob(db, {
      assetFid: primaryFid,
      action,
      params: p,
      createdBy
    });
    return {
      engine: 'gateway',
      entryId: entry.id,
      runId: String(job.id),
      mode: 'async',
      status: job.status || 'queued',
      progress: job.progress || 0,
      pollPath: `/lab/runs/gateway/${job.id}`
    };
  }

  // ---- 对话（LiteLLM） ----
  if (entry.engine === 'chat' || entry.id === 'chat.assistant') {
    const { completeChat } = require('./vlm');
    const { resolveLiteLlmChatConfig } = require('./providers');
    const { framesFromVideoRef } = require('./video-frames');
    const llm = resolveLiteLlmChatConfig(db, config, p.model);
    const imageUrls = Array.isArray(p.imageUrls) ? p.imageUrls.filter(Boolean) : [];
    const videoRefs = [
      ...(Array.isArray(p.videoUrls) ? p.videoUrls : []),
      ...(p.videoUrl ? [p.videoUrl] : []),
    ].filter(Boolean);
    const visionImages = [...imageUrls];
    const tempDir = path.join(config.dataDir, 'cache', 'temp');
    for (let i = 0; i < videoRefs.length; i++) {
      const frames = await framesFromVideoRef(videoRefs[i], tempDir, `labchat_${Date.now()}_${i}`);
      for (const f of frames) visionImages.push(f.dataUrl);
    }
    let messages = Array.isArray(p.messages) && p.messages.length
      ? p.messages
      : [{ role: 'user', content: String(p.prompt || '') }];
    if (visionImages.length) {
      const parts = [];
      const first = messages[messages.length - 1];
      if (first && typeof first.content === 'string') {
        parts.push({ type: 'text', text: first.content });
      } else {
        parts.push({ type: 'text', text: String(p.prompt || '') });
      }
      for (const img of visionImages) {
        const url = String(img).startsWith('data:') || /^https?:\/\//i.test(String(img))
          ? img
          : `data:image/jpeg;base64,${img}`;
        parts.push({ type: 'image_url', image_url: { url } });
      }
      messages = messages.slice(0, -1).concat([{ role: 'user', content: parts }]);
    }
    const start = Date.now();
    const data = await completeChat({
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      messages,
      temperature: p.temperature ?? 0.4,
      max_tokens: p.max_tokens ?? 2048,
      timeoutMs: p.timeoutMs || 90000,
    });
    const text = data?.choices?.[0]?.message?.content || '';
    const runId = `chat_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const result = {
      status: 'done',
      progress: 100,
      durationMs: Date.now() - start,
      text,
      kind: 'text',
    };
    cacheGenResult(runId, { entryId: entry.id, engine: 'chat', result });
    return {
      engine: 'chat',
      entryId: entry.id,
      runId,
      mode: 'sync',
      status: 'done',
      progress: 100,
      result,
    };
  }

  // ---- Gen 适配器（图/视频均异步，客户端轮询） ----
  if (entry.engine === 'gen') {
    // 客户端可不传 adapterId：按 kind + model 严格匹配，禁止回落到其它厂商
    let adapterId = p.adapterId;
    const kindGuess = entry.id === 'gen.video' ? 'video' : 'image';
    const ready = listReadyAdapters(db, kindGuess);
    const modelHint = String(resolveModelCode(p.model) || p.model || '');
    const pickedId = pickAdapterId(kindGuess, modelHint, ready);
    if (pickedId && (!adapterId || (isGoogleModel(modelHint) && adapterId !== pickedId))) {
      adapterId = pickedId;
    }
    if (!adapterId) adapterId = pickedId;
    if (!adapterId) {
      const err = new Error(adapterMissingError(kindGuess, modelHint));
      err.code = 'missing_adapter';
      throw err;
    }
    const adapter = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(adapterId);
    if (!adapter) {
      const err = new Error(`适配器不存在: ${adapterId}`);
      err.code = 'adapter_missing';
      throw err;
    }
    if (!adapterConfigured(adapter)) {
      const err = new Error(`适配器未就绪: ${adapterId}`);
      err.code = 'not_ready';
      throw err;
    }

    const kind = entry.id === 'gen.video' ? 'video' : 'image';
    if (adapter.kind && adapter.kind !== kind) {
      const err = new Error(`适配器 ${adapterId} 类型为 ${adapter.kind}，与入口 ${entry.id}(${kind}) 不匹配`);
      err.code = 'adapter_kind_mismatch';
      throw err;
    }
    const imageLocalPaths = [];
    if (primaryFid) {
      const asset = db.prepare('SELECT fid, file_name, kind FROM assets WHERE fid=?').get(primaryFid);
      if (!asset) {
        const err = new Error(`源素材不存在: ${primaryFid}`);
        err.code = 'fid_missing';
        throw err;
      }
      const lp = assetLocalPath(config, primaryFid, asset.file_name);
      if (lp) imageLocalPaths.push(lp);
    }

    // 客户端上传的公网参考图 URL（图生图/图生视频/首尾帧）
    const imageUrls = uniqueUrls(Array.isArray(p.imageUrls)
      ? p.imageUrls.filter(u => typeof u === 'string' && /^https?:\/\//i.test(u))
      : []);
    const firstFrame = typeof p.firstFrame === 'string' && /^https?:\/\//i.test(p.firstFrame)
      ? p.firstFrame : null;
    const lastFrame = typeof p.lastFrame === 'string' && /^https?:\/\//i.test(p.lastFrame)
      ? p.lastFrame : null;
    const genMode = p.mode || null; // text_to_image / first_last_frame / ...

    const officialId = officialIdOf(p.model);
    const sch = MODEL_SCHEMAS[officialId] || MODEL_SCHEMAS[p.model] || null;
    if (sch) {
      try {
        assertFreeTier(sch, {
          refs: imageUrls.length ? imageUrls : [firstFrame, lastFrame].filter(Boolean),
          videos: p.videoUrl ? [p.videoUrl] : [],
          audios: Array.isArray(p.audioUrls) ? p.audioUrls : [],
          size: p.size || p.resolution || (p.extras && (p.extras.size || p.extras.resolution)),
        });
      } catch (fe) {
        if (fe.code === 'free_tier') {
          fe.statusCode = 400;
          throw fe;
        }
        throw fe;
      }
    }

    const runId = `gen_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const start = Date.now();
    const extras = { ...(p.extras || {}) };
    const portraitIds = Array.isArray(p.portraitAssetIds)
      ? p.portraitAssetIds
      : (Array.isArray(extras.portraitAssetIds) ? extras.portraitAssetIds : []);
    if (kind === 'video' && portraitIds.length) {
      const portraits = portraitLib.loadActivePortraits(db, portraitIds);
      assertSeedanceOrEmpty(resolveModelCode(p.model) || p.model, portraits);
      extras.portrait_assets = portraits;
    }
    if (p.resolution) extras.resolution = p.resolution;
    if (p.size) extras.size = p.size;
    if (p.generate_audio != null) extras.generate_audio = p.generate_audio;
    if (p.watermark != null) extras.watermark = p.watermark;
    if (p.output_format) extras.output_format = p.output_format;
    if (p.thinking_level) extras.thinking_level = p.thinking_level;

    let promptText = p.prompt || '';
    let genImages = imageUrls;
    if (p.sessionId) {
      try {
        const { inheritGeneration, lastImageUrls } = require('./chat-context');
        const rows = db.prepare(
          'SELECT role, prompt, images_json FROM chat_messages WHERE session_id=? ORDER BY created_at ASC LIMIT 30'
        ).all(p.sessionId);
        const historyText = rows.map((r) => r.prompt).filter(Boolean).slice(-3).join('\n');
        const inherited = inheritGeneration({
          domain: kind === 'video' ? 'video' : 'image',
          prompt: promptText,
          historyText,
          images: genImages.length || /@(?:图|图片)\d+/.test(promptText) ? genImages : lastImageUrls(rows),
          videos: p.videoUrl ? [p.videoUrl] : [],
          atVideos: Array.isArray(p.atVideos) ? p.atVideos : [],
        });
        promptText = inherited.prompt;
        genImages = inherited.images;
        if (!inherited.videos.length) p.videoUrl = undefined;
      } catch (_) {}
    }

    let promptForModel = promptText;
    let modelForExec = resolveModelCode(p.model) || p.model || undefined;
    let extrasForExec = extras;
    let contractId = '';
    let compiledSize = p.size;
    let compiledRatio = p.ratio || undefined;
    let compiledDuration = p.duration != null ? Number(p.duration) : undefined;
    const { prepareGovernedSubmit } = require('./models-contract');
    const prepared = prepareGovernedSubmit({
      db,
      modelId: p.model,
      editablePrompt: promptText,
      values: {
        ...extras,
        ratio: p.ratio,
        size: p.size || extras.size,
        duration: p.duration,
        seconds: p.duration,
        mode: genMode,
      },
      images: genImages,
      snippetIds: Array.isArray(p.snippetIds) ? p.snippetIds : (Array.isArray(p.snippet_ids) ? p.snippet_ids : null),
    });
    if (prepared.assembled) {
      promptForModel = prepared.assembled.prompt || promptText;
      modelForExec = prepared.contract?.vendor_model_id || modelForExec;
      contractId = prepared.contract?.id || '';
      extrasForExec = { ...extras, ...prepared.assembled.body };
      if (prepared.assembled.body?.size != null) compiledSize = prepared.assembled.body.size;
      if (prepared.assembled.body?.ratio != null) compiledRatio = prepared.assembled.body.ratio;
      const dur = prepared.assembled.body?.duration ?? prepared.assembled.body?.seconds;
      if (dur != null && dur !== '') compiledDuration = dur;
    }

    const execInput = {
      kind,
      contractId,
      prompt: promptForModel,
      model: modelForExec,
      ratio: compiledRatio,
      size: compiledSize,
      durationSec: compiledDuration,
      imageLocalPaths,
      imageUrls: genImages,
      firstFrame,
      lastFrame,
      genMode,
      timeoutMs: kind === 'video' ? 480000 : 180000,
      extras: extrasForExec,
      onProgress: (prog) => {
        cacheGenResult(runId, {
          entryId: entry.id,
          engine: 'gen',
          result: { status: 'running', progress: Math.max(15, Math.min(90, Number(prog) || 15)) },
        });
      },
    };

    cacheGenResult(runId, {
      entryId: entry.id,
      engine: 'gen',
      result: { status: 'running', progress: 15, previewUrl: null },
    });
    setImmediate(() => {
      executeAdapter(services, adapter, execInput)
        .then((res) => {
          const first = res.files?.[0];
          const ok = res.ok || res.success;
          cacheGenResult(runId, {
            entryId: entry.id,
            engine: 'gen',
            result: {
              status: ok ? 'done' : 'failed',
              progress: 100,
              durationMs: Date.now() - start,
              previewUrl: first?.previewUrl || null,
              localPath: first?.localPath || null,
              mime: first?.mime || null,
              width: first?.width || null,
              height: first?.height || null,
              files: res.files || [],
              error: ok ? null : (res.error || '生成失败'),
            },
          });
        })
        .catch((e) => {
          cacheGenResult(runId, {
            entryId: entry.id,
            engine: 'gen',
            result: {
              status: 'failed',
              progress: 100,
              durationMs: Date.now() - start,
              error: e.message || String(e),
              previewUrl: null,
            },
          });
        });
    });
    return {
      engine: 'gen',
      entryId: entry.id,
      runId,
      mode: 'async',
      status: 'running',
      progress: 15,
      pollPath: `/lab/runs/gen/${runId}`,
    };
  }

  // ---- 豆包歌曲 / 纯音乐。视频配乐和 TTS 不在本次范围 ----
  if (entry.engine === 'music') {
    if (entry.id === 'music.tts' || entry.id === 'music.video_score' || entry.id === 'gen.music.from_video') {
      const err = new Error('本次不做');
      err.code = 'not_ready';
      throw err;
    }
    if (p.sessionId) {
      try {
        const { stickyFromRows } = require('./chat-context');
        const rows = db.prepare(
          'SELECT params_json FROM chat_messages WHERE session_id=? ORDER BY created_at ASC LIMIT 30'
        ).all(p.sessionId);
        const sticky = stickyFromRows(rows);
        if (p.duration == null && sticky.duration) p.duration = sticky.duration;
        if (!p.lang && sticky.lang) p.lang = sticky.lang;
        if (!p.model && sticky.model) p.model = sticky.model;
      } catch (_) {}
    }
    const musicKind = doubaoMusic.musicKindFrom(entry.id, p);
    const runId = `music_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const start = Date.now();
    cacheGenResult(runId, {
      entryId: entry.id,
      engine: 'music',
      result: { status: 'running', progress: 15, previewUrl: null },
    });
    setImmediate(() => {
      doubaoMusic.runMusicJob(services, {
        kind: musicKind,
        params: p,
        jobId: runId,
        onProgress: (prog) => {
          cacheGenResult(runId, {
            entryId: entry.id,
            engine: 'music',
            result: { status: 'running', progress: Math.max(15, Math.min(90, Number(prog) || 15)) },
          });
        },
      }).then((result) => {
        cacheGenResult(runId, {
          entryId: entry.id,
          engine: 'music',
          result: {
            ...result,
            durationMs: Date.now() - start,
            previewUrl: result.files && result.files[0] ? result.files[0].previewUrl : null,
            mime: 'audio/mpeg',
          },
        });
      }).catch((e) => {
        cacheGenResult(runId, {
          entryId: entry.id,
          engine: 'music',
          result: {
            status: 'failed',
            progress: 100,
            durationMs: Date.now() - start,
            error: e.message || String(e),
            previewUrl: null,
          },
        });
      });
    });
    return {
      engine: 'music',
      entryId: entry.id,
      runId,
      mode: 'async',
      status: 'running',
      progress: 15,
      pollPath: `/lab/runs/music/${runId}`,
    };
  }

  if (entry.engine === 'portrait') {
    if (entry.id !== 'portrait.assets_api') {
      const err = new Error('人像出图请使用 gen.portrait / gen.portrait.from_image');
      err.code = 'not_ready';
      throw err;
    }
    const actorId = Number(userId) || 0;
    let groupId = Number(p.groupId || p.group_id || 0);
    if (!groupId) {
      const name = String(p.asset_group || p.groupName || '').trim();
      if (!name) {
        const err = new Error('请指定素材组');
        err.code = 'invalid';
        throw err;
      }
      const hit = db.prepare(
        'SELECT id FROM portrait_groups WHERE name=? OR volc_group_id=?'
      ).get(name, name);
      if (hit) groupId = hit.id;
      else {
        const created = await portraitLib.createGroup(services, { name, userId: actorId });
        groupId = created.id;
      }
    }
    const asset = await portraitLib.addAsset(services, {
      groupId,
      fid: primaryFid,
      name: p.name || '',
      userId: actorId,
    });
    const runId = `portrait_${asset.id}`;
    const result = { status: asset.status, kind: 'portrait_asset', asset };
    cacheGenResult(runId, { entryId: entry.id, engine: 'portrait', result });
    return {
      engine: 'portrait',
      entryId: entry.id,
      runId,
      mode: 'sync',
      status: asset.status === 'Failed' ? 'failed' : 'running',
      progress: asset.status === 'Active' ? 100 : 30,
      result,
    };
  }

  const err = new Error(`未处理的引擎: ${entry.engine}`);
  err.code = 'unknown_engine';
  throw err;
}

function toDerivPreview(config, assetFid, derivativeId) {
  if (!derivativeId) return null;
  const q = new URLSearchParams({ derivative: String(derivativeId) });
  return `/api/assets/${encodeURIComponent(assetFid)}/image?${q.toString()}`;
}

/**
 * 查询试验场运行状态。
 */
function getLabRunStatus(services, engine, runId) {
  const { db, config } = services;

  if (engine === 'umbra') {
    const t = aiTasks.getAiTask(db, runId);
    if (!t) {
      const err = new Error('任务不存在');
      err.code = 'not_found';
      throw err;
    }
    const pub = aiTasks.toPublicTask(t);
    let previewUrl = null;
    if (pub.status === 'success') {
      if (pub.output_kind === 'derivative' && pub.output_fid) {
        previewUrl = toDerivPreview(config, t.fid, Number(pub.output_fid));
      } else if (pub.output_kind === 'video' && pub.output_fid) {
        previewUrl = `/api/assets/${encodeURIComponent(pub.output_fid)}/poster`;
      }
    }
    return {
      engine: 'umbra',
      runId,
      entryId: null,
      type: pub.type,
      status: pub.status,
      progress: pub.progress || 0,
      error: pub.error || null,
      result: pub.status === 'success'
        ? {
          kind: pub.output_kind,
          outputFid: pub.output_fid,
          derivativeId: pub.output_kind === 'derivative' ? pub.output_fid : null,
          previewUrl
        }
        : null,
      task: pub
    };
  }

  if (engine === 'gateway') {
    const job = processSvc.getProcessJob(db, Number(runId));
    if (!job) {
      const err = new Error('处理任务不存在');
      err.code = 'not_found';
      throw err;
    }
    return {
      engine: 'gateway',
      runId: String(job.id),
      entryId: null,
      type: job.action,
      status: job.status,
      progress: job.progress || 0,
      error: job.error || null,
      result: job.status === 'done'
        ? {
          kind: 'derivative',
          derivativeId: job.derivativeId,
          previewUrl: toDerivPreview(config, job.assetFid, job.derivativeId)
        }
        : null,
      job
    };
  }

  if (engine === 'gen' || engine === 'music' || engine === 'chat') {
    const hit = getGenResult(runId);
    if (!hit) {
      const err = new Error('同步生成结果不存在或已过期');
      err.code = 'not_found';
      throw err;
    }
    return {
      engine,
      runId,
      entryId: hit.entryId || null,
      type: hit.entryId || engine,
      status: hit.result?.status || 'unknown',
      progress: hit.result?.progress ?? 100,
      error: hit.result?.error || null,
      result: hit.result || null
    };
  }

  const err = new Error(`未知引擎: ${engine}`);
  err.code = 'unknown_engine';
  throw err;
}

module.exports = {
  GROUPS,
  convertLabRefs,
  getCapabilityCatalog,
  buildEntries,
  buildStudioCatalog,
  buildModelCapsMap,
  findEntry,
  engineStatus,
  submitLabRun,
  getLabRunStatus,
  adapterConfigured,
  listReadyAdapters,
  ensureMusicAdapter
};
