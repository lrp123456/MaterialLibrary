/**
 * 坐标/选区契约冒烟测试（node 直接跑）
 * 运行：node scripts/test-coords.mjs
 */
import {
  containLayout,
  displayToImage,
  imageToDisplay,
  displayRectToImageBBox,
  imageBBoxToApi0999,
  mergeBBoxes,
  quadToImage,
  frameImagePoints,
  viewToLocal,
  zoomViewAround,
  rectToBBox,
  bboxToRect,
  clamp,
} from '../src/common/coords.js'
import { adaptRegionForModel, getModel, modelStatusText } from '../src/common/modelCaps.js'
import { getOp, selectModesFor } from '../src/common/editModes.js'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('OK:', msg)
  }
}

// contain: 4000x3000 into 800x600 → scale 0.2, no letterbox
const L1 = containLayout(4000, 3000, 800, 600)
assert(L1.scale === 0.2 && L1.x === 0 && L1.y === 0, 'contain exact fit')

// contain: 4000x3000 into 800x800 → letterbox top/bottom (h=600, y=100)
const L2 = containLayout(4000, 3000, 800, 800)
assert(Math.abs(L2.scale - 0.2) < 1e-9 && Math.abs(L2.y - 100) < 1e-9 && Math.abs(L2.h - 600) < 1e-9, 'contain letterbox y=100')

// 显示点 (100, 100) in L2 → image: x=500, y=(100-100)/0.2=0
const p = displayToImage(100, 100, L2)
assert(Math.abs(p.x - 500) < 1e-6 && Math.abs(p.y - 0) < 1e-6, 'displayToImage')

// round-trip
const d = imageToDisplay(p.x, p.y, L2)
assert(Math.abs(d.x - 100) < 1e-6 && Math.abs(d.y - 100) < 1e-6, 'imageToDisplay round-trip')

// display rect → image bbox: (100,100)-(300,250) → image (500,0)-(1500,750)
const bb = displayRectToImageBBox({ x1: 100, y1: 100, x2: 300, y2: 250 }, L2, 4000, 3000)
assert(bb && bb.x1 === 500 && bb.y1 === 0 && bb.x2 === 1500 && bb.y2 === 750, 'displayRectToImageBBox')

// image bbox → 0-999
const api = imageBBoxToApi0999({ x1: 0, y1: 0, x2: 4000, y2: 3000 }, 4000, 3000)
assert(api.x1 === 0 && api.y1 === 0 && api.x2 === 999 && api.y2 === 999, 'api 0-999 full')

// merge
const m = mergeBBoxes([
  { x1: 10, y1: 20, x2: 30, y2: 40 },
  { x1: 5, y1: 25, x2: 20, y2: 50 },
])
assert(m.x1 === 5 && m.y1 === 20 && m.x2 === 30 && m.y2 === 50, 'mergeBBoxes')

// rect/bbox 互转（字段契约）
const r = rectToBBox({ x: 10, y: 20, w: 30, h: 40 })
assert(r.x1 === 10 && r.y1 === 20 && r.x2 === 40 && r.y2 === 60, 'rectToBBox')
const b2 = bboxToRect(r)
assert(b2.x === 10 && b2.y === 20 && b2.w === 30 && b2.h === 40, 'bboxToRect')

// 四点
const q = quadToImage(
  [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ],
  containLayout(1000, 500, 500, 250),
  1000,
  500
)
assert(q && q.points.length === 4 && q.bbox.x2 === 400, 'quadToImage')

const nat = { w: 1000, h: 800 }
const lay = containLayout(nat.w, nat.h, 500, 400)
const pts = [{ x: 200, y: 160 }]
const framed = frameImagePoints(pts, nat.w, nat.h, lay, 500, 400)
const centerLocal = viewToLocal(250, 200, framed)
const back = displayToImage(centerLocal.x, centerLocal.y, lay)
assert(Math.abs(back.x - 200) < 2 && Math.abs(back.y - 160) < 2, 'frame keeps image point at view center')
const zoomed = zoomViewAround(framed, 1.5, 250, 200)
const back2 = displayToImage(viewToLocal(250, 200, zoomed).x, viewToLocal(250, 200, zoomed).y, lay)
assert(Math.abs(back2.x - 200) < 2 && Math.abs(back2.y - 160) < 2, 'zoom does not move image point')
assert(zoomed.z > framed.z, 'zoom increases scale')

// model adapt: brush → bbox
const adapted = adaptRegionForModel(
  { type: 'mask', bbox: { x1: 10, y1: 10, x2: 50, y2: 50 } },
  'seedream-5.0-flash'
)
assert(adapted.region.type === 'bbox' && adapted.region.bbox.x2 === 50, 'mask→bbox for seedream')
assert(getModel('seedream-5.0-flash').point === true, 'seedream point support')
assert(modelStatusText('seedream-5.0-flash', null).includes('flash'), 'status text')
assert(getOp('expand').selectModes.length === 0, 'expand no select')
assert(selectModesFor('replace', getModel('seedream-5.0-flash')).includes('brush'), 'replace has brush')
assert(clamp(1500, 0, 999) === 999, 'clamp')

console.log('done')
