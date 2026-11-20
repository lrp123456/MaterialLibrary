/**
 * 框选载荷。快捷页有两套读法，必须同时满足：
 * - replace / insert / editor：pixelRect.{x,y,w,h}
 * - remove / watermark：mode === 'rect' 且 pixelRect.{x1,y1,x2,y2}；四点读 points
 * box 坐标是 0..1，像素按原图像素宽高换算。
 */
export function buildSelectionPayload({ currentMode, box, quad, polygon, naturalW, naturalH }) {
  const modeName = currentMode || 'box'
  let bbox = null
  if (box) {
    bbox = {
      x1: Math.min(box.x1, box.x2),
      y1: Math.min(box.y1, box.y2),
      x2: Math.max(box.x1, box.x2),
      y2: Math.max(box.y1, box.y2),
    }
  }
  const quadPts = quad && quad.length === 4 ? quad : null
  const poly = polygon && polygon.length ? polygon : null
  const hasSelection = !!(bbox || quadPts || poly)

  let mode = modeName
  if (bbox && (modeName === 'box' || modeName === 'rect')) mode = 'rect'
  else if (quadPts && modeName === 'quad') mode = 'quad'

  const w = Number(naturalW) || 0
  const h = Number(naturalH) || 0
  let pixelRect = null
  if (bbox && w > 0 && h > 0) {
    const x1 = bbox.x1 * w
    const y1 = bbox.y1 * h
    const x2 = bbox.x2 * w
    const y2 = bbox.y2 * h
    pixelRect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1, x1, y1, x2, y2 }
  }

  return {
    method: modeName,
    mode,
    hasSelection,
    bbox,
    quad: quadPts,
    polygon: poly,
    points: quadPts,
    rect: bbox,
    pixelRect,
    w,
    h,
  }
}
