/**
 * 服务端素材行 → UI 模型（App / Web 共用）
 * 改字段映射时必须同步检查两端列表与详情。
 */
import { mediaUrl, videoUrl, posterUrl } from '../service/ViewerApi'
import { store } from '../service/SyncStateStore'
import { currentServerUrl } from '../service/ServerResolve'

function buildImageSrc(fid, derivativeId = 0) {
  const server = String(currentServerUrl() || '').replace(/\/+$/, '')
  const token = store.getToken() || ''
  const q = ['token=' + encodeURIComponent(token), 'local=1']
  if (derivativeId > 0) q.push('derivative=' + derivativeId)
  return server + '/api/viewer/assets/' + encodeURIComponent(fid) + '/image?' + q.join('&')
}

export function isVideoName(name) {
  return /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(name || '')
}
export function isAudioName(name) {
  return /\.(mp3|wav|m4a|aac|flac)$/i.test(name || '')
}

function findLabel(tags, dims) {
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i] || {}
    const dim = t.dimension || ''
    if (dims.indexOf(dim) >= 0 && t.label) return t.label
  }
  return ''
}

function coerceAssetTs(v) {
  if (!v) return 0
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

export function mapServerAsset(r) {
  const w = r.width || 1080
  const h = r.height || 1440
  const mainDeriv = r.mainDerivative || {}
  const derivId = mainDeriv.id || r.main_derivative_id || 0
  const fileName = r.file_name || ''
  const isVid =
    isVideoName(fileName) ||
    r.media_type === 'video' ||
    !!(r.mime && String(r.mime).startsWith('video/')) ||
    (!!r.duration && !isAudioName(fileName))
  const isMus =
    r.media_type === 'music' ||
    r.category === 'music' ||
    r.kind === 'audio' ||
    isAudioName(fileName)
  const isPort = r.media_type === 'portrait' || r.category === 'portrait'
  const isFurn = r.media_type === 'furniture' || r.category === 'furniture'
  const isAiVid =
    isVid &&
    (r.is_ai === 1 ||
      r.is_ai === true ||
      !!r.source_asset_id ||
      (mainDeriv.kind && String(mainDeriv.kind).includes('ai_video')))
  const isRestage =
    !isVid &&
    !isMus &&
    !isPort &&
    !isFurn &&
    !!(mainDeriv.kind && String(mainDeriv.kind).startsWith('restage_'))
  const isModel = isFurn && /\.glb$/i.test(fileName)

  const serverUrl = isVid ? videoUrl(r.fid) : buildImageSrc(r.fid, derivId)
  const poster = isVid
    ? posterUrl(r.fid)
    : ''
  const imgUrl = isVid ? poster || serverUrl : serverUrl

  const tags = Array.isArray(r.tags) ? r.tags : []
  const space = findLabel(tags, ['space'])
  const style = findLabel(tags, ['style_atom', 'style'])
  const furn = findLabel(tags, ['furniture_item', 'furniture_category'])
  const mat = findLabel(tags, ['material_kind', 'material'])
  const mood = findLabel(tags, ['mood'])
  const pose = findLabel(tags, ['pose'])
  const character = findLabel(tags, ['character'])
  const genre = findLabel(tags, ['genre'])
  const domColor = r.dominant_color || ''

  let parts = []
  if (isMus) parts = [mood, genre, space].filter(Boolean)
  else if (isPort) parts = [pose, character, style].filter(Boolean)
  else if (isFurn) parts = [furn, mat, style, domColor ? domColor + '调' : ''].filter(Boolean)
  else parts = [space, style, furn, mat, domColor ? domColor + '调' : ''].filter(Boolean)
  const tagsText = parts.length ? parts.join(' · ') : fileName

  let ratio = (h / w) * 100
  if (isMus) ratio = 72
  else {
    if (ratio < 75) ratio = 75
    if (ratio > 140) ratio = 140
  }

  return {
    fid: r.fid,
    fileName,
    width: w,
    height: h,
    mime: r.mime || '',
    size: r.size || 0,
    isVideo: isVid,
    isAiVideo: isAiVid,
    isMusic: isMus,
    isPortrait: isPort,
    isFurniture: isFurn,
    isModel,
    isRestage,
    duration: r.duration || 0,
    orientation: r.origin_orientation || '',
    tagsText,
    rawTags: tags.map((t) => t.label || '').join(' '),
    spaceTag: space,
    styleTag: style,
    furnitureTag: furn,
    materialTag: mat,
    moodTag: mood,
    poseTag: pose,
    characterTag: character,
    genreTag: genre,
    dominantColor: domColor,
    mainDerivativeId: derivId,
    main_derivative_id: derivId,
    mainDerivativeKind: (mainDeriv && mainDeriv.kind) || r.main_derivative_kind || '',
    hasWatermark: r.has_watermark === 1 || r.has_watermark === true,
    media_type: isMus
      ? 'music'
      : isPort
        ? 'portrait'
        : isFurn
          ? 'furniture'
          : isVid
            ? 'video'
            : 'image',
    derivatives: Array.isArray(r.derivatives) ? r.derivatives : [],
    sourceAssetId: r.source_asset_id || '',
    isAi: r.is_ai === 1 || r.is_ai === true,
    ratio,
    imgUrl,
    serverUrl,
    posterUrl: poster,
    thumbUrl: '',
    // 列表/详情展示一律走 /image?token&local=1
    thumbSrc: buildImageSrc(r.fid, derivId),
    mediaToken: r.mediaToken || '',
    ts: coerceAssetTs(r.taken_at || r.takenAt || r.shot_time || r.exif_time || r.created_at || r.createdAt),
    takenAt: coerceAssetTs(r.taken_at || r.takenAt),
    createdAt: coerceAssetTs(r.created_at || r.createdAt),
    raw: r,
  }
}

/**
 * 详情接口返回包装结构：{ asset, tags, colors, derivatives, similar, source_asset, ... }
 * 列表行是扁平结构。两端都必须走这里，禁止直接 mapServerAsset(详情)。
 */
export function mapServerDetail(d) {
  const wrap = d && typeof d === 'object' ? d : {}
  const a = wrap.asset && typeof wrap.asset === 'object' ? wrap.asset : wrap
  const tags = Array.isArray(wrap.tags) ? wrap.tags : Array.isArray(a.tags) ? a.tags : []
  const derivatives = Array.isArray(wrap.derivatives)
    ? wrap.derivatives
    : Array.isArray(a.derivatives)
      ? a.derivatives
      : []
  const row = {
    ...a,
    tags,
    derivatives,
    mainDerivative:
      a.mainDerivative ||
      derivatives.find((x) => x && x.id && a.main_derivative_id && x.id === a.main_derivative_id) ||
      derivatives.find((x) => x && x.kind === 'origin') ||
      {},
  }
  const base = mapServerAsset(row)
  const similar = (Array.isArray(wrap.similar) ? wrap.similar : []).map((s) => {
    const sfid = s.fid || s.asset_fid || ''
    const sm = s.main_derivative_id || s.mainDerivativeId || 0
    return {
      fid: sfid,
      fileName: s.file_name || s.fileName || '',
      width: s.width || 1080,
      height: s.height || 1440,
      thumbSrc: sfid ? buildImageSrc(sfid, sm) : '',
      imgUrl: sfid ? buildImageSrc(sfid, sm) : '',
    }
  })
  const rawSource = wrap.source_asset || wrap.sourceAsset || a.source_asset || null
  const sourceAsset = rawSource
    ? {
        fid: rawSource.fid,
        fileName: rawSource.file_name || rawSource.fileName || '',
        tagsText: (rawSource.tags || []).map((t) => (t && t.label) || '').filter(Boolean).join(' · '),
        thumbSrc: rawSource.fid
          ? buildImageSrc(rawSource.fid, rawSource.main_derivative_id || 0)
          : '',
        imgUrl: rawSource.fid
          ? buildImageSrc(rawSource.fid, rawSource.main_derivative_id || 0)
          : '',
      }
    : null
  return {
    ...base,
    tags,
    colors: Array.isArray(wrap.colors) ? wrap.colors : [],
    derivatives,
    similar,
    sourceAsset,
    dupMembers: Array.isArray(wrap.dupMembers) ? wrap.dupMembers : [],
    hasRestage916: derivatives.some((d) => d && d.kind === 'restage_9_16'),
    hasRestage34: derivatives.some((d) => d && d.kind === 'restage_3_4'),
    tagsText:
      tags.map((t) => (t && t.label) || '').filter(Boolean).join(' · ') || base.tagsText,
  }
}

export function mediaTypeOf(item) {
  if (!item) return 'image'
  if (item.isMusic) return 'music'
  if (item.isVideo) return 'video'
  if (item.isPortrait) return 'portrait'
  if (item.isFurniture) return 'furniture'
  return 'image'
}
