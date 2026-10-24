/**
 * 模型目录 —— 仅用于「服务端还没连上」时把 tab 和模型名占住。
 * 这里刻意不带任何参数（档位、参考图上限、时长）：
 * 参数一律由服务端 /lab/capabilities 的 model.schema 下发，
 * 由 utils/model-protocol.js 的同一份规则引擎解释。
 */

export const MODEL_CATALOG = {
  image: {
    label: 'AI 生图',
    models: [
      { id: 'seedream5flash', model_code: 'doubao-seedream-5-0-flash-260915', name: 'Seedream 5.0 图像（主力）' },
      { id: 'agnes_image_2_5_flash', model_code: 'agnes-image-2.5-flash', name: 'Agnes 图像（冒烟）' }
    ]
  },
  video: {
    label: 'AI 生视频',
    models: [
      { id: 'seedance2_0', model_code: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0 视频' }
    ]
  },
  music: {
    label: 'AI 生音乐',
    models: [
      { id: 'doubao_song_v5', model_code: 'doubao-song-v5', name: 'GenSong 歌曲' },
      { id: 'doubao_bgm_v5', model_code: 'doubao-bgm-v5', name: 'GenBGM 背景音乐' }
    ]
  },
  portrait: { label: 'AI 生人像', models: [] },
  chat: {
    label: '元素标签对话',
    models: [
      { id: 'litellm_doubao_seed_2_0_lite', model_code: 'doubao-seed-2-0-lite-260428', name: '豆包对话' }
    ]
  }
}

/** 合并服务端下发目录与本地占位目录（服务端字段优先）。 */
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
