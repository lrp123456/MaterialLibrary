/**
 * 每模型 schema：前后端同一份契约。选择器只渲染这些字段。
 * enum=chips；range=滑轨；bool=开关；number=数字。-1 时长表示智能。
 */
function en(key, label, options, def, extra) {
  return Object.assign({ key, label, type: 'enum', options, default: def }, extra || {})
}
function tog(key, label, def) {
  return { key, label, type: 'bool', default: !!def }
}
function num(key, label, min, max, def) {
  return { key, label, type: 'number', min, max, default: def }
}
function rng(key, label, min, max, def, extra) {
  return Object.assign({ key, label, type: 'range', min, max, step: 1, default: def }, extra || {})
}
function txt(key, label, def) {
  return { key, label, type: 'text', default: def || '' }
}

const RATIO_SD = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']
const RATIO_IMG = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']
const RATIO_AGNES_IMG = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9']
const SD_LOCK_ADAPTIVE = { set: { ratio: 'adaptive' }, lock: ['ratio'] }
const SD_LOCK_EDIT = { set: { ratio: 'adaptive', duration: -1 }, lock: ['ratio', 'duration'] }

const MODEL_SCHEMAS = {
  seedance2_5: {
    polishId: 'seedance2_5',
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
    common: [
      en('resolution', '分辨率', ['480p', '720p', '1080p'], '720p'),
      rng('duration', '时长', 4, 30, -1, { extraStops: [-1], labels: { '-1': '智能' } }),
      en('ratio', '比例', RATIO_SD, 'adaptive'),
      tog('generate_audio', '生成同步音频', true),
    ],
    advanced: [
      tog('watermark', 'AI 水印', false),
      num('seed', '种子', -1, 2147483647, -1),
      en('output_format', '封装', ['mp4', 'mov'], 'mp4'),
      tog('return_last_frame', '返回尾帧', false),
      en('omni_reference_task_type', '任务类型', ['auto', 'reference', 'edit', 'extend'], 'auto', {
        labels: { auto: '自动', reference: '参考生视频', edit: '编辑', extend: '延长' },
      }),
    ],
    slots: { images: 30, videos: 10, audios: 10 },
    submitMap: { duration: 'duration', size: 'resolution' },
    modeConstraints: {
      first_last_frame: SD_LOCK_ADAPTIVE,
      video_edit: SD_LOCK_EDIT,
      video_extend: SD_LOCK_ADAPTIVE,
    },
  },
  seedance2_0: {
    polishId: 'seedance2_0',
    refStyle: 'seedance',
    polishHint: '三类公式：参考/编辑/延长 · 4–15s · 图≤9',
    modes: [
      { id: 'text_to_video', label: '文生视频' },
      { id: 'omni_reference', label: '全能参考' },
      { id: 'image_to_video', label: '图生视频' },
      { id: 'first_last_frame', label: '首尾帧' },
    ],
    common: [
      en('resolution', '分辨率', ['480p', '720p', '1080p'], '720p'),
      rng('duration', '时长', 4, 15, 5, { extraStops: [-1], labels: { '-1': '智能' } }),
      en('ratio', '比例', RATIO_SD, '16:9'),
      tog('generate_audio', '生成同步音频', true),
    ],
    advanced: [tog('watermark', 'AI 水印', false), num('seed', '种子', -1, 2147483647, -1), tog('camera_fixed', '镜头固定', false)],
    slots: { images: 9, videos: 3, audios: 3 },
    submitMap: { duration: 'duration', size: 'resolution' },
    modeConstraints: {
      first_last_frame: SD_LOCK_ADAPTIVE,
    },
  },
  agnes_video_2_5_flash: {
    polishId: 'agnes_video_2_5_flash',
    refStyle: 'agnes',
    polishHint: '<Picture 1> · 仅 720P · 4–12s',
    modes: [
      { id: 'text_to_video', label: '文生视频' },
      { id: 'image_to_video', label: '参考' },
      { id: 'first_last_frame', label: '首尾帧' },
    ],
    common: [
      en('size', '分辨率', ['720P'], '720P'),
      rng('duration', '时长', 4, 12, 5),
      en('ratio', '比例', ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], '16:9'),
    ],
    advanced: [],
    slots: { images: 5, videos: 0, audios: 3 },
    free: { size: '720P', maxRefs: 5, maxAudios: 3, noVideoRef: true },
    submitMap: { duration: 'seconds', size: 'size' },
  },
  /** ★ 主动生图 / 人像默认：Seedream 5.0 Flash（原生交互编辑） */
  seedream5flash: {
    polishId: 'seedream5flash',
    refStyle: 'generic',
    polishHint: '1K/1.5K/2K · 原生交互编辑（bbox/point 进提示词）',
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图生图' },
      { id: 'image_reference', label: '多参考' },
      { id: 'image_edit', label: '交互编辑' },
      { id: 'expand_fill', label: '扩边填白' },
    ],
    common: [
      en('size', '分辨率', ['1K', '1.5K', '2K'], '2K'),
      en('ratio', '比例', RATIO_IMG, '9:16'),
      tog('watermark', 'AI 水印', false),
    ],
    advanced: [
      en('output_format', '格式', ['png', 'jpeg'], 'png'),
      txt('bbox', '框选 0-999（x1 y1 x2 y2）', ''),
      txt('point', '落位中心点 0-999（x y）', ''),
    ],
    slots: { images: 6, videos: 0, audios: 0 },
    submitMap: { size: 'size' },
  },
  seedream5pro: {
    polishId: 'seedream5pro',
    refStyle: 'generic',
    polishHint: '1K/1.5K/2K · 框内替换 · 支持极速提示优化',
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图生图' },
      { id: 'image_reference', label: '多参考' },
      { id: 'image_edit', label: '交互编辑' },
      { id: 'expand_fill', label: '扩边填白' },
    ],
    common: [
      en('size', '分辨率', ['1K', '1.5K', '2K'], '2K'),
      en('ratio', '比例', RATIO_IMG, '9:16'),
      tog('watermark', 'AI 水印', false),
    ],
    advanced: [
      en('output_format', '格式', ['png', 'jpeg'], 'png'),
      en('prompt_priority', '提示优化', ['standard', 'fast'], 'standard'),
      txt('bbox', '框选 0-999（x1 y1 x2 y2）', ''),
      txt('point', '落位中心点 0-999（x y）', ''),
    ],
    slots: { images: 6, videos: 0, audios: 0 },
    submitMap: { size: 'size' },
  },
  seedream5lite: {
    polishId: 'seedream5lite',
    refStyle: 'generic',
    polishHint: '2K/3K/4K · 无交互编辑',
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图生图' },
      { id: 'image_reference', label: '多参考' },
    ],
    common: [
      en('size', '分辨率', ['2K', '3K', '4K'], '2K'),
      en('ratio', '比例', RATIO_IMG, '9:16'),
      tog('watermark', 'AI 水印', false),
    ],
    advanced: [
      num('n', '张数', 1, 4, 1),
      en('sequential_image_generation', '组图', ['disabled', 'auto'], 'disabled', {
        labels: { disabled: '单张', auto: '组图 auto' },
      }),
    ],
    slots: { images: 6, videos: 0, audios: 0 },
    submitMap: { size: 'size' },
  },
  agnes_image_2_5_flash: {
    polishId: 'agnes_image_2_5_flash',
    refStyle: 'agnes',
    polishHint: '官方三结构 · 参考≤3',
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图生图' },
      { id: 'image_reference', label: '多参考' },
    ],
    common: [
      en('size', '分辨率', ['1K', '2K'], '2K'),
      en('ratio', '比例', RATIO_AGNES_IMG, '9:16'),
    ],
    advanced: [en('size3k', '3K/4K（刊例价收费档）', ['', '3K', '4K'], '')],
    slots: { images: 3, videos: 0, audios: 0 },
    free: { maxRefs: 3, sizes: ['1K', '2K'] },
    submitMap: { size: 'size' },
  },
  doubao_song_v5: {
    polishId: 'doubao_song_v5',
    refStyle: 'generic',
    polishHint: '豆包歌曲 v5 · 提示词或歌词',
    modes: [
      { id: 'text_to_song', label: '文生歌曲' },
      { id: 'text_to_bgm', label: '文生纯音乐' },
    ],
    common: [
      en('lang', '语言', ['Chinese', 'English', 'Cantonese'], 'Chinese', { labels: { Chinese: '普通话', English: '英文', Cantonese: '粤语' } }),
      rng('duration', '时长', 30, 240, 60, { step: 10 }),
    ],
    advanced: [],
    slots: { images: 0, videos: 0, audios: 0 },
    submitMap: {},
  },
  doubao_bgm_v5: {
    polishId: 'doubao_bgm_v5',
    refStyle: 'generic',
    polishHint: '豆包纯音乐 v5 · 中文描述',
    modes: [
      { id: 'text_to_song', label: '文生歌曲' },
      { id: 'text_to_bgm', label: '文生纯音乐' },
    ],
    common: [
      rng('duration', '时长', 30, 120, 60, { step: 10 }),
    ],
    advanced: [],
    slots: { images: 0, videos: 0, audios: 0 },
    submitMap: {},
  },
}

MODEL_SCHEMAS.seedream_portrait = MODEL_SCHEMAS.seedream5flash
MODEL_SCHEMAS.agnes_portrait_2_5 = MODEL_SCHEMAS.agnes_image_2_5_flash

function schemaFor(model) {
  if (!model) return null
  if (model.schema) return model.schema
  return MODEL_SCHEMAS[model.id] || MODEL_SCHEMAS[model.polishId] || null
}

function optionLabel(field, value) {
  if (field && field.labels && field.labels[String(value)] != null) return field.labels[String(value)]
  if (value === -1) return '智能'
  return String(value)
}

function slotLimit(schema, kind) {
  const slots = (schema && schema.slots) || {}
  const free = (schema && schema.free) || {}
  if (kind === 'images') {
    const cap = Number(slots.images || 0)
    if (free.maxRefs != null) return Math.min(cap, Number(free.maxRefs))
    return cap
  }
  if (kind === 'videos') {
    if (free.noVideoRef) return 0
    return Number(slots.videos || 0)
  }
  if (kind === 'audios') {
    const cap = Number(slots.audios || 0)
    if (free.maxAudios != null) return Math.min(cap, Number(free.maxAudios))
    return cap
  }
  return 0
}

function applyConstraints(schema, mode, params) {
  const out = Object.assign({}, params || {})
  const locks = new Set()
  const mc = schema && schema.modeConstraints && schema.modeConstraints[mode]
  if (mc) {
    if (mc.set) Object.assign(out, mc.set)
    ;(mc.lock || []).forEach((k) => locks.add(k))
  }
  const vcs = (schema && schema.valueConstraints) || []
  for (const vc of vcs) {
    const v = out[vc.ifKey]
    if (vc.ifIn && vc.ifIn.map(String).includes(String(v))) {
      if (vc.set) Object.assign(out, vc.set)
      ;(vc.lock || []).forEach((k) => locks.add(k))
    }
  }
  return { params: out, lock: Array.from(locks) }
}

/**
 * 取某模型已声明的 enum 字段候选值（唯一权威源）。
 * 供 gen/index.js 等适配器规范化层复用，避免在规范层再抄一份白名单。
 */
function enumOptionsOf(schema, key) {
  if (!schema || !key) return []
  const pools = [schema.common, schema.advanced, schema.modes]
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue
    for (const f of pool) {
      if (f && f.key === key && Array.isArray(f.options)) return f.options
    }
  }
  return []
}

/** 分辨率档位白名单（按 official code 或 alias 查 schema） */
function sizeOptionsOf(modelId) {
  const schema = MODEL_SCHEMAS[modelId] || null
  const opts = enumOptionsOf(schema, 'size')
  if (opts.length) return opts
  return enumOptionsOf(schema, 'resolution')
}

function uniqueUrls(list) {
  const out = []
  const seen = new Set()
  for (const item of list || []) {
    const s = String(item || '').trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function assertFreeTier(schema, { refs, videos, audios, size } = {}) {
  const free = schema && schema.free
  if (!free) return
  const refList = Array.isArray(refs) ? uniqueUrls(refs) : null
  const nRefs = refList ? refList.length : Number(refs || 0)
  const nVid = Array.isArray(videos) ? videos.length : Number(videos || 0)
  const nAud = Array.isArray(audios) ? audios.length : Number(audios || 0)
  const err = (msg) => {
    const e = new Error(msg)
    e.code = 'free_tier'
    throw e
  }
  if (free.maxRefs != null && nRefs > Number(free.maxRefs)) err(`本次提交了 ${nRefs} 张，免费档最多 ${free.maxRefs} 张`)
  if (free.noVideoRef && nVid > 0) err('免费档不支持视频参考')
  if (free.maxAudios != null && nAud > Number(free.maxAudios)) err(`免费档音频最多 ${free.maxAudios} 条`)
  if (free.size && size && String(size).toUpperCase() !== String(free.size).toUpperCase()) {
    err(`免费档分辨率仅 ${free.size}`)
  }
  if (Array.isArray(free.sizes) && size && !free.sizes.includes(size)) {
    err(`免费档分辨率仅 ${free.sizes.join('/')}`)
  }
}

function mapSubmitParams(schema, genParams) {
  const out = Object.assign({}, genParams || {})
  const sm = (schema && schema.submitMap) || {}
  if (sm.duration && out.duration != null && sm.duration !== 'duration') out[sm.duration] = out.duration
  if (sm.size) {
    const v = out.size != null ? out.size : out.resolution
    if (v != null) out[sm.size] = v
  }
  return out
}

module.exports = {
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
}
