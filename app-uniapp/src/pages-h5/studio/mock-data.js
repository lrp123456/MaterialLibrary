/**
 * 虚拟导演台预置室内底图与大模型建议数据
 */

// 预设镜头模板
export const CAMERA_SHOT_PRESETS = [
  {
    id: 'dolly_in',
    name: '经典推近特写 (Dolly In)',
    desc: '从全景平滑推进至产品侧面细节，突出皮质材质与缝线工艺',
    icon: '🔍',
    duration: 5,
    start: { pos: [0, 1.35, 3.4], target: [0, 0.45, 0], fov: 38 },
    end: { pos: [0.65, 0.85, 2.1], target: [0.15, 0.48, 0], fov: 28 },
    motionVector: { panX: 0.65, panY: -0.5, zoomZ: -1.3, promptStyle: 'Smooth cinematic dolly-in, shallow depth of field' }
  },
  {
    id: 'orbit_arc',
    name: '30° 弧形环视 (Orbit Arc)',
    desc: '低速沿产品左前方环绕至正前方，展现产品空间立体体量感',
    icon: '🔄',
    duration: 5,
    start: { pos: [-1.4, 1.25, 2.9], target: [0, 0.45, 0], fov: 36 },
    end: { pos: [0.8, 1.2, 2.9], target: [0, 0.45, 0], fov: 36 },
    motionVector: { panX: 2.2, panY: -0.05, zoomZ: 0, promptStyle: 'Subtle orbiting camera movement around luxury furniture' }
  },
  {
    id: 'crane_rise',
    name: '升降俯瞰扫视 (Crane Rise)',
    desc: '从低视平线升至微俯视视角，将产品与地板接触阴影完整呈现',
    icon: '📐',
    duration: 5,
    start: { pos: [0.1, 0.6, 2.8], target: [0, 0.4, 0], fov: 35 },
    end: { pos: [0, 1.65, 3.2], target: [0, 0.45, 0], fov: 38 },
    motionVector: { panX: -0.1, panY: 1.05, zoomZ: 0.4, promptStyle: 'Smooth camera pedestal up, architectural lighting' }
  }
]

// 大模型参谋 (Agent Co-Pilot) 建议库
export const AI_AGENT_ADVISES = [
  {
    type: 'lighting_and_pose',
    title: '采光与姿态建议',
    text: '大模型检测到房间主自然光由左侧落地窗引入（色温约 5200K）。建议将产品沿 Y 轴逆时针旋转 20°~25°，使皮质扶手产生优雅的侧逆光高光条，增强空间进深感。',
    actionLabel: '一键应用 22° 偏航朝向',
    applyAction: { rotationY: 0.38 }
  },
  {
    type: 'shot_rhythm',
    title: '运镜节奏建议',
    text: '当前所选沙发主要卖点在靠包柔软度与轻奢金属底脚。推荐采用“前 2.5 秒全景进场 + 后 2.5 秒微距推拉”的分镜节奏，已为您生成对应 Camera Control 指令。',
    actionLabel: '一键载入特写推近动线',
    applyPresetId: 'dolly_in'
  }
]

/**
 * 动态生成高质量室内实景 Canvas 底图（带旧家具与擦除后底图）
 */
export function generateLivingRoomScene(width = 1000, height = 620, options = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const { hasOldFurniture = true } = options

  // 1. 墙面背景（淡米灰温暖现代墙体）
  const wallGrad = ctx.createLinearGradient(0, 0, 0, height * 0.58)
  wallGrad.addColorStop(0, '#e5e7eb')
  wallGrad.addColorStop(0.7, '#f3f4f6')
  wallGrad.addColorStop(1, '#e5e7eb')
  ctx.fillStyle = wallGrad
  ctx.fillRect(0, 0, width, height * 0.58)

  // 2. 左侧大落地窗与自然光
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(40, 40, width * 0.28, height * 0.5)
  // 窗框
  ctx.lineWidth = 6
  ctx.strokeStyle = '#334155'
  ctx.strokeRect(40, 40, width * 0.28, height * 0.5)
  ctx.beginPath()
  ctx.moveTo(40 + width * 0.14, 40)
  ctx.lineTo(40 + width * 0.14, 40 + height * 0.5)
  ctx.stroke()
  // 窗外微光
  const winGlow = ctx.createRadialGradient(80, 80, 20, 80, 80, 300)
  winGlow.addColorStop(0, 'rgba(255,255,255,0.9)')
  winGlow.addColorStop(1, 'rgba(224,242,254,0.3)')
  ctx.fillStyle = winGlow
  ctx.fillRect(43, 43, width * 0.28 - 6, height * 0.5 - 6)

  // 3. 墙面装饰挂画（极简抽象几何）
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(width * 0.42, 70, 160, 200)
  ctx.lineWidth = 4
  ctx.strokeStyle = '#1e293b'
  ctx.strokeRect(width * 0.42, 70, 160, 200)
  // 挂画内部色块
  ctx.fillStyle = '#0284c7'
  ctx.beginPath()
  ctx.arc(width * 0.42 + 80, 150, 45, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#f59e0b'
  ctx.fillRect(width * 0.42 + 30, 190, 100, 35)

  // 4. 踢脚线 (Skirting board)
  ctx.fillStyle = '#334155'
  ctx.fillRect(0, height * 0.58 - 12, width, 12)

  // 5. 实木地板（透视斜木纹理）
  const floorTop = height * 0.58
  const floorGrad = ctx.createLinearGradient(0, floorTop, 0, height)
  floorGrad.addColorStop(0, '#c7a783')
  floorGrad.addColorStop(1, '#a6825c')
  ctx.fillStyle = floorGrad
  ctx.fillRect(0, floorTop, width, height - floorTop)

  // 地板木板分界线与反光
  ctx.strokeStyle = 'rgba(100,60,30,0.22)'
  ctx.lineWidth = 1.5
  for (let y = floorTop + 24; y < height; y += (y - floorTop) * 0.28 + 18) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }

  // 窗户投射在地板上的斜四边形柔和晨光 (Sunlight beam)
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.beginPath()
  ctx.moveTo(40, floorTop)
  ctx.lineTo(40 + width * 0.28, floorTop)
  ctx.lineTo(40 + width * 0.52, height)
  ctx.lineTo(80, height)
  ctx.closePath()
  ctx.fill()

  // 6. 如果包含旧家具：画上一只陈旧的深红褐色破旧沙发（作为待擦除主体）
  if (hasOldFurniture) {
    const ox = width * 0.46
    const oy = height * 0.65
    // 旧沙发阴影
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.ellipse(ox, oy + 65, 140, 25, 0, 0, Math.PI * 2)
    ctx.fill()
    // 旧沙发本体（深酒红褐色）
    ctx.fillStyle = '#7f1d1d'
    // 坐垫
    ctx.fillRect(ox - 130, oy, 260, 60)
    // 靠背
    ctx.fillStyle = '#991b1b'
    ctx.fillRect(ox - 130, oy - 65, 260, 70)
    // 扶手
    ctx.fillStyle = '#581c1c'
    ctx.fillRect(ox - 145, oy - 30, 20, 90)
    ctx.fillRect(ox + 125, oy - 30, 20, 90)
    // 旧沙发文字标签水印
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = 'bold 15px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('【待擦除的原有旧沙发】', ox, oy + 25)
  }

  return canvas
}

/**
 * 快速生成并返回 Base64 DataURL，保证页面加载即同步有图
 */
export function getPresetLivingRoomDataUrl(hasOldFurniture = true, width = 1200, height = 750) {
  try {
    const cvs = generateLivingRoomScene(width, height, { hasOldFurniture })
    return cvs.toDataURL('image/png')
  } catch (e) {
    return ''
  }
}

// 预设空间样板间列表
export const PRESET_ROOMS = [
  {
    id: 'modern_living_old',
    name: '极简明亮客厅 (含待换旧沙发)',
    desc: '左侧落地窗大自然采光 · 暖调橡木实木地板',
    style: '现代极简',
    lighting: '自然天光 5200K',
    hasOldFurniture: true
  },
  {
    id: 'modern_living_clean',
    name: '纯净客厅底图 (已无痕修复)',
    desc: '旧家具已擦除 · 地板与踢脚线完整保留',
    style: '现代极简',
    lighting: '自然天光 5200K',
    hasOldFurniture: false
  }
]
