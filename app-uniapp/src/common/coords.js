/**
 * 三级坐标约定（契约 C5）：
 *   - 原图像素 pixel：以原图宽高为基准的真实像素
 *   - 显示坐标 display：canvas/屏幕上的 CSS/rpx 坐标（带缩放因子）
 *   - API 归一化 norm：0-1（另有 0-999 记号兼容）
 * 所有变换在此集中，确保检测/手框/四点/选区 → 编辑 → 贴回 不漂。
 */

// 归一化 → 像素
export function norm01ToPixel(pt, w, h) {
  if (pt == null) return 0
  return Math.round(pt <= 1.001 ? pt * (w || 1) : pt)
}
export function norm999ToPixel(pt, w, h) {
  if (pt == null) return 0
  return Math.round(pt > 1.001 && pt <= 999 ? (pt / 999) * (w || 1) : pt)
}
// 像素 → 归一化 0-1
export function pixelToNorm01(x, w) {
  if (w <= 0) return 0
  return Math.round((x / w) * 1000) / 1000
}

/** 把任意坐标（像素/0-1/0-999）统一成原图像素 bbox */
export function bboxToPixel(b, w, h) {
  if (!b) return null
  const conv = (v, total) => (v <= 1.001 ? v * total : v > 1.001 && v <= 999 ? (v / 999) * total : v)
  const x1 = conv(b.x1, w), y1 = conv(b.y1, h)
  const x2 = conv(b.x2, w), y2 = conv(b.y2, h)
  return {
    x1: Math.round(Math.min(x1, x2)), y1: Math.round(Math.min(y1, y2)),
    x2: Math.round(Math.max(x1, x2)), y2: Math.round(Math.max(y1, y2))
  }
}

/** 四边形点统一成原图像素（按 x 坐标归一/像素自动判定） */
export function quadToPixel(quad, w, h) {
  if (!quad || quad.length < 4) return null
  const xs = quad.map(p => p[0])
  const isNorm999 = xs.some(v => v > 1.001 && v <= 999)
  const conv = (v, total) => {
    if (v <= 1.001) return Math.round(v * total)
    if (isNorm999) return Math.round((v / 999) * total)
    return Math.round(v)
  }
  return quad.map(p => [conv(p[0], w), conv(p[1], h)])
}

/** 手画/四点选区输出 bbox 与 polygon（像素坐标，0-1 归一给 API） */
export function selectionToApi({ bbox, quad, polygon, w, h }) {
  const out = { w, h }
  if (bbox) {
    const b = bboxToPixel(bbox, w, h)
    out.bbox = b
    out.bboxNorm = {
      x1: pixelToNorm01(b.x1, w), y1: pixelToNorm01(b.y1, h),
      x2: pixelToNorm01(b.x2, w), y2: pixelToNorm01(b.y2, h)
    }
  }
  if (quad) {
    const q = quadToPixel(quad, w, h)
    out.quad = q
    out.quadNorm = q.map(p => [pixelToNorm01(p[0], w), pixelToNorm01(p[1], h)])
  }
  if (polygon) {
    out.polygon = polygon
    out.polygonNorm = polygon.map(p => [pixelToNorm01(p[0], w), pixelToNorm01(p[1], h)])
  }
  return out
}

/** 顺时针四点排序（左上、右上、右下、左下） */
export function sortQuadClockwise(pts) {
  const sorted = [...pts].sort((a, b) => a[0] + a[1] - (b[0] + b[1]))
  const tl = sorted[0]
  const br = sorted[sorted.length - 1]
  const rest = sorted.slice(1, -1)
  const tr = rest.sort((a, b) => a[1] - b[1])[0] // 更靠上 = 右上
  const bl = rest.sort((a, b) => a[0] - b[0])[0]  // 更靠左 = 左下
  return [tl, tr, br, bl]
}
