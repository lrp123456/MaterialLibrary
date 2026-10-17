/**
 * 模型目录（独立交付模式）。
 * 与服务端 /gen/options 对应：图像 seedream(主力)/agnes(冒烟)，视频 seedance 2.0，
 * 音乐 GenSong/GenBGM，豆包对话。提供 home.vue AI 工坊所需的目录与 Agnes 自由档校验。
 */

export const MODEL_CATALOG = {
  image: {
    label: 'AI 生图',
    models: [
      { id: 'doubao-seedream-5-0-flash', model_code: 'doubao-seedream-5-0-flash', name: 'Seedream 5.0 图像（主力）', providerName: '方舟', freeTier: true, maxRefs: 9, modes: ['text_to_image', 'image_to_image'] },
      { id: 'agnes-3.0', model_code: 'agnes-3.0', name: 'Agnes 图像（冒烟）', providerName: 'Agnes', freeTier: true, maxRefs: 3, modes: ['text_to_image', 'image_to_image'] }
    ]
  },
  video: {
    label: 'AI 生视频',
    models: [
      { id: 'doubao-seedance-2-0', model_code: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0 视频', providerName: '方舟', freeTier: true, maxRefs: 3, durations: [5, 8, 10], modes: ['image_to_video', 'text_to_video'] }
    ]
  },
  music: {
    label: 'AI 生音乐',
    models: [
      { id: 'doubao_song_v5', model_code: 'volcengine-imagination', name: 'GenSong 歌曲（短时长）', providerName: '火山', freeTier: true, maxRefs: 1, durations: [15, 30, 60], modes: ['text_to_song'] },
      { id: 'doubao_bgm_v5', model_code: 'volcengine-imagination', name: 'GenBGM 背景音乐（短时长）', providerName: '火山', freeTier: true, maxRefs: 1, durations: [15, 30, 60], modes: ['text_to_bgm'] }
    ]
  },
  portrait: { label: 'AI 生人像', models: [] },
  chat: {
    label: '元素标签对话',
    models: [
      { id: 'doubao-seed-2-0-lite', model_code: 'doubao-seed-2-0-lite-260428', name: '豆包对话', providerName: '方舟', freeTier: true, maxRefs: 9, modes: ['chat'] }
    ]
  }
}

/** Agnes 自由档校验（返回 { ok, message }）。 */
export function assertAgnesFreeTier(modelInfo, { imageCount = 0, size = '' } = {}) {
  if (!modelInfo) return { ok: true }
  const name = `${modelInfo.id || ''} ${modelInfo.model_code || ''} ${modelInfo.name || ''}`
  if (/agnes/i.test(name)) {
    if (imageCount > (modelInfo.maxRefs || 3)) {
      return { ok: false, message: `Agnes 图像最多支持 ${modelInfo.maxRefs || 3} 张参考图` }
    }
    if (/1080|720/i.test(size || '')) {
      return { ok: false, message: 'Agnes 冒烟档请用最低清晰度尺寸' }
    }
  }
  return { ok: true }
}

/** 合并服务端下发目录与本地默认目录（服务端字段可能缺失）。 */
export function mergeStudioCatalog(serverCatalog = null, localCatalog = MODEL_CATALOG) {
  const merged = JSON.parse(JSON.stringify(localCatalog))
  const s = serverCatalog || {}
  for (const key of Object.keys(merged)) {
    if (s[key] && Array.isArray(s[key].models) && s[key].models.length) {
      const localMap = new Map(merged[key].models.map((m) => [m.id, m]))
      for (const m of s[key].models) {
        localMap.set(m.id, { ...(localMap.get(m.id) || {}), ...m })
      }
      merged[key].models = Array.from(localMap.values())
    }
  }
  return merged
}

export default MODEL_CATALOG
