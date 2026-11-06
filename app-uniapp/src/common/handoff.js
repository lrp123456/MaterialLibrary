/**
 * 编辑/快捷页 → 创作页的一次性交接。
 *
 * 设计原则：任何生成动作都不在选区页直接发生；选区页只负责把
 * 「底图 + 操作 + 选区 + 实际提示词」交给创作页，由创作页展示预览后再发送。
 */
import { switchTabTo } from './nav'

const HOME = '/pages/home/home'

/** 精准编辑（带选区）：走 /edit/preview + /edit/run，创作页可见实际参考图与请求体 */
export function handoffPreciseEdit(payload = {}) {
  const sel = payload.selection || null
  const region = payload.region || (sel
    ? {
        bbox: sel.bbox || sel.rect || null,
        quad: sel.quad || sel.points || null,
        polygon: sel.polygon || null,
        pixelRect: sel.pixelRect || null,
        mode: sel.mode || '',
      }
    : null)
  switchTabTo(HOME, {
    kind: 'precise',
    op: payload.op || 'replace',
    sourceFid: payload.fid || payload.sourceFid || '',
    sourceName: payload.fileName || payload.sourceName || '',
    sourceImgUrl: payload.imgUrl || '',
    region,
    recipe: payload.recipe || '',
    recipeHint: payload.recipeHint || '',
    productName: payload.productName || '',
    productImageUrl: payload.productImageUrl || '',
    refImageUrl: payload.refImageUrl || '',
    refs: Array.isArray(payload.refs) ? payload.refs : [],
    yaw: payload.yaw,
    pitch: payload.pitch,
    style: payload.style,
    targetClarity: payload.targetClarity,
    intensity: payload.intensity,
    expandRatios: payload.expandRatios,
    expandRatio: payload.expandRatio,
    gapPct: payload.gapPct,
  })
}

/** 全局操作（不框选）：走 /gen/images + /gen/preview，不占用精准编辑通道 */
export function handoffGlobalEdit(payload = {}) {
  switchTabTo(HOME, {
    kind: 'global',
    op: payload.op || 'style_transfer',
    sourceFid: payload.fid || payload.sourceFid || '',
    sourceName: payload.fileName || payload.sourceName || '',
    sourceImgUrl: payload.imgUrl || '',
    recipe: payload.recipe || '',
    recipeHint: payload.recipeHint || '',
    style: payload.style || '',
    scale: payload.scale || 0,
    intensity: payload.intensity,
    globalParams: payload.globalParams || null,
  })
}

/** 仅带入参考图创作（不锁操作） */
export function handoffCreateWithRefs(fids, payload = {}) {
  const list = Array.isArray(fids) ? fids.filter(Boolean) : []
  switchTabTo(HOME, {
    fids: list,
    domain: payload.domain === 'video' ? 'video' : 'image',
    recipe: payload.recipe || '',
    recipeHint: payload.recipeHint || '',
  })
}
