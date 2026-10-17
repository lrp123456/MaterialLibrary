/**
 * 生成参数字段 schema（独立交付模式的最小可用定义）。
 * 提供 home.vue 参数面板所需的：字段定义、档位映射、槽位限制、约束应用。
 * 真实参数以服务端 /gen/options 与各模型官方为准，这里给通用默认。
 */

const SCHEMAS = {
  image: {
    polishHint: '按 Seedream 结构：主体/环境/构图/光线/质感 + 负向约束',
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图生图' }
    ],
    common: [
      { key: 'size', type: 'select', label: '画幅', options: ['1:1', '3:4', '9:16', '16:9'] }
    ],
    advanced: [],
    submitMap: { size: 'ratio' }
  },
  video: {
    polishHint: '按 Seedance 七段式：主体/动作/环境/镜头运动/光线/风格/声音（简短）',
    modes: [
      { id: 'text_to_video', label: '文生视频' },
      { id: 'image_to_video', label: '图生视频' }
    ],
    common: [
      { key: 'duration', type: 'select', label: '时长(s)', options: [5, 8, 10], min: 0 }
    ],
    advanced: [{ key: 'resolution', type: 'select', label: '清晰度', options: ['480p', '720p'], hint: '调测最低清' }],
    submitMap: { duration: 'durationSec', size: 'ratio' }
  },
  music: {
    polishHint: 'GenSong/GenBGM：风格+氛围+短时长，歌词用主输入',
    modes: [
      { id: 'text_to_song', label: '生成歌曲' },
      { id: 'text_to_bgm', label: '生成BGM' }
    ],
    common: [
      { key: 'duration', type: 'select', label: '时长(s)', options: [15, 30, 60], min: 0 },
      { key: 'style', type: 'text', label: '风格', default: '轻音乐' }
    ],
    advanced: [],
    submitMap: { size: 'ratio' }
  }
}

/** 按模型/模式返回 schema（兜底通用图像 schema）。 */
export function schemaFor(model) {
  if (!model) return null
  const id = `${model.id || ''} ${model.model_code || ''}`
  if (/seedance|video/i.test(id)) return SCHEMAS.video
  if (/imagination|music|song|bgm/i.test(id)) return SCHEMAS.music
  return SCHEMAS.image
}

/** 字段选项标签（select 档位直接显示）。 */
export function optionLabel(field, opt) {
  if (opt == null) return ''
  if (opt === -1) return '智能'
  if (typeof opt === 'number') return String(opt)
  return String(opt)
}

/** 槽位限制（参考图等）。 */
export function slotLimit(schema, key) {
  if (!schema) return 9
  if (key === 'images') {
    if (/video/i.test(schema.polishHint)) return 3
    if (/agnes/i.test(JSON.stringify(schema))) return 3
    return 9
  }
  return 9
}

/** 应用约束：按 mode 过滤参数（视频清最低档、音乐短时长）。 */
export function applyConstraints(schema, mode, params = {}) {
  const out = { ...(params || {}) }
  if (/video/i.test(mode || '') || /seedance/i.test(JSON.stringify(schema))) {
    out.resolution = '480p'
    out.duration = out.duration || 5
  }
  if (/music|song|bgm/i.test(mode || '')) {
    out.duration = Math.min(out.duration || 15, 30)
    out.style = out.style || '轻音乐'
  }
  if (/image/i.test(mode || '')) {
    out.ratio = out.ratio || out.size || '9:16'
  }
  return { params: out, mode: mode || 'text_to_image' }
}
