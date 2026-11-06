/**
 * 客户端统一协议与动态参数规则引擎 (Stage 3: Client Canonical Protocol & Layer Stack)
 * 与服务端 src/unified-translator.js & src/models-contract.js 保持严格同源契约：
 * 1. 动态解析 schema.common / schema.advanced / schema.modes / schema.slots
 * 2. 实时计算 modeConstraints 与 valueConstraints (如 图层拆分 锁定比例并切换 size 为 auto/1K/1.5K/2K，透明底强制 PNG)
 * 3. 将 Seedream 5.0 Pro/Flash 多图层返回 (data[]) 或 Lite 组图返回规范化为 CanvasLayerStack
 * 4. 提供 ZCode 风格的常用创作 Skill 预设挂载
 */

export const STUDIO_SKILLS_REGISTRY = [
  {
    id: 'skill_interior_lighting',
    name: '空间自然采光大师',
    badge: '光影强化',
    modality: ['image', 'video', 'chat'],
    snippetIds: ['snippet_interior_realism'],
    desc: '提交公共积木「室内实拍真实感」，正文由服务端编译',
  },
  {
    id: 'skill_layer_decompose',
    name: 'Seedream 5.0 智能拆层重绘',
    badge: '图层拆分',
    modality: ['image'],
    autoParams: { layer_decomposition: true, size: 'auto', output_format: 'png' },
    desc: '只打开图层拆分、尺寸 auto 和 PNG，不另写提示词',
  },
  {
    id: 'skill_transparent_cutout',
    name: '软装单品透明底精抠',
    badge: '透明 PNG',
    modality: ['image'],
    autoParams: { background: 'transparent', output_format: 'png' },
    desc: '只打开透明底并锁定 PNG，不另写提示词',
  },
  {
    id: 'skill_seedance_director',
    name: 'Seedance 2.5 一镜到底导演运镜',
    badge: '影视运镜',
    modality: ['video'],
    autoParams: { generate_audio: true },
    desc: '只打开同步音频，不另写提示词',
  },
];

/**
 * 评估当前模型 Schema 下的条件联动规则（Mode 约束 + Value 约束）
 */
/**
 * 模式级锁定的人话说明：契约里只写了 lock 数组，没写 reason，
 * 直接显示「已由模型契约锁定」用户会以为参数坏了（尤其首尾帧画幅是灰的）。
 */
function modeLockReason(mode, key) {
  if (key === 'ratio' || key === 'aspect_ratio') {
    if (mode === 'first_last_frame') return '首尾帧模式的画幅由两张关键帧决定，已自动锁定；想换画幅请改用「图生视频」或「全能参考」';
    if (mode === 'video_edit') return '视频编辑沿用原片画幅，无法单独改比例';
    if (mode === 'video_extend') return '视频续写沿用原片画幅，无法单独改比例';
  }
  if (key === 'duration' && mode === 'video_edit') return '视频编辑的时长由原片决定，已锁定';
  return '已由模型契约锁定';
}

export function evaluateClientModelRules(schema, activeMode, currentParams = {}, refCounts = { images: 0, videos: 0, audios: 0 }) {
  const nextParams = { ...(currentParams || {}) };
  const lockedKeys = new Set();
  const suppressedKeys = new Set();
  const lockReasons = {};
  const fieldOverrides = {};
  const warnings = [];

  if (!schema) {
    return {
      params: nextParams,
      lockedKeys: [],
      suppressedKeys: [],
      lockReasons,
      fieldOverrides,
      warnings,
    };
  }

  // 1. 模式级约束 (例如 first_last_frame 锁定 ratio=adaptive; video_edit 锁定 ratio=adaptive, duration=-1)
  const mc = schema.modeConstraints && schema.modeConstraints[activeMode];
  if (mc) {
    if (mc.set && typeof mc.set === 'object') {
      Object.assign(nextParams, mc.set);
    }
    if (Array.isArray(mc.lock)) {
      for (const k of mc.lock) {
        lockedKeys.add(k);
        lockReasons[k] = mc.reason || modeLockReason(activeMode, k);
      }
    }
  }

  // 2. 参数值级条件联动 (例如 layer_decomposition=true 或 background=transparent)
  const vcs = Array.isArray(schema.valueConstraints) ? schema.valueConstraints : [];
  for (const vc of vcs) {
    const val = nextParams[vc.ifKey];
    const matched = Array.isArray(vc.ifIn) && vc.ifIn.map(String).includes(String(val));
    if (!matched) continue;

    if (vc.set && typeof vc.set === 'object') {
      Object.assign(nextParams, vc.set);
    }
    const ruleReason = vc.reason || (vc.effect && vc.effect.reason) || '已由模型契约锁定';
    if (Array.isArray(vc.lock)) {
      for (const k of vc.lock) {
        lockedKeys.add(k);
        lockReasons[k] = ruleReason;
      }
    }
    if (vc.effect) {
      if (Array.isArray(vc.effect.suppress)) {
        for (const k of vc.effect.suppress) {
          suppressedKeys.add(k);
          lockedKeys.add(k);
          lockReasons[k] = ruleReason;
        }
      }
      if (vc.effect.force && typeof vc.effect.force === 'object') {
        Object.assign(nextParams, vc.effect.force);
        for (const fk of Object.keys(vc.effect.force)) {
          lockedKeys.add(fk);
          lockReasons[fk] = `已由「${vc.ifKey}=${val}」强制设为 ${vc.effect.force[fk]}`;
        }
      }
      if (vc.effect.size_options) {
        fieldOverrides.size = {
          options: vc.effect.size_options,
          default: vc.effect.size_default || 'auto',
        };
        if (!vc.effect.size_options.includes(nextParams.size)) {
          nextParams.size = vc.effect.size_default || 'auto';
        }
      }
      if (vc.effect.require_single_image && Number(refCounts.images || 0) !== 1) {
        warnings.push(
          vc.type === 'transparent_background'
            ? '透明背景 (transparent) 必须且仅支持挂载 1 张参考图'
            : '图层拆分模式建议挂载 1 张底图进行智能拆层'
        );
      }
    }
  }

  return {
    params: nextParams,
    lockedKeys: Array.from(lockedKeys),
    suppressedKeys: Array.from(suppressedKeys),
    lockReasons,
    fieldOverrides,
    warnings,
  };
}

/**
 * 将后端 /api/gen/run 返回的多图层/多图数组转换为前端画布图层栈
 */
export function normalizeClientLayerStack(res, params = {}) {
  if (res?.layerStack && Array.isArray(res.layerStack.layers) && res.layerStack.layers.length > 0) {
    return res.layerStack;
  }
  const files = Array.isArray(res?.files) ? res.files : [];
  if (files.length <= 1) return null;

  const isDecomp = Boolean(params?.layer_decomposition);
  return {
    kind: isDecomp ? 'layer_stack' : 'multi_image',
    count: files.length,
    layers: files.map((f, idx) => ({
      index: idx,
      role: isDecomp ? (idx === 0 ? 'background' : `foreground_${idx}`) : `image_${idx + 1}`,
      label: f.label || (isDecomp ? (idx === 0 ? '底层背景 (Layer 0)' : `独立前景图层 #${idx}`) : `生成图 #${idx + 1}`),
      url: f.previewUrl || f.url || '',
      width: f.width || null,
      height: f.height || null,
      mime: f.mime || (isDecomp ? 'image/png' : 'image/jpeg'),
      visible: true,
    })),
  };
}

/**
 * 标准 6 色系分配 (按区域顺序循环赋予，保证视觉鲜明区分)
 */
export const REGION_COLORS = [
  { name: '蓝色', hex: '#3B82F6', lightBg: 'rgba(59, 130, 246, 0.18)', border: '#3B82F6', badgeClass: 'bg-blue-500 text-white', tag: '蓝色线框' },
  { name: '红色', hex: '#EF4444', lightBg: 'rgba(239, 68, 68, 0.18)', border: '#EF4444', badgeClass: 'bg-rose-500 text-white', tag: '红色线框' },
  { name: '黄色', hex: '#EAB308', lightBg: 'rgba(234, 179, 8, 0.18)', border: '#EAB308', badgeClass: 'bg-amber-500 text-slate-950 font-bold', tag: '黄色线框' },
  { name: '绿色', hex: '#10B981', lightBg: 'rgba(16, 185, 129, 0.18)', border: '#10B981', badgeClass: 'bg-emerald-500 text-white', tag: '绿色线框' },
  { name: '紫色', hex: '#8B5CF6', lightBg: 'rgba(139, 92, 246, 0.18)', border: '#8B5CF6', badgeClass: 'bg-purple-500 text-white', tag: '紫色线框' },
  { name: '青色', hex: '#06B6D4', lightBg: 'rgba(6, 182, 212, 0.18)', border: '#06B6D4', badgeClass: 'bg-cyan-500 text-slate-950 font-bold', tag: '青色线框' },
  { name: '橙色', hex: '#F97316', lightBg: 'rgba(249, 115, 22, 0.18)', border: '#F97316', badgeClass: 'bg-orange-500 text-white', tag: '橙色线框' },
  { name: '白色', hex: '#FFFFFF', lightBg: 'rgba(255, 255, 255, 0.18)', border: '#CBD5E1', badgeClass: 'bg-slate-200 text-slate-950 font-bold', tag: '白色线框' },
];

/**
 * 图片编辑模型区域与要求指定体系注册表
 * 划分 4 大主流范式：
 * 1. seedream_bbox: Seedream 5.0 Pro/Flash 归一化 [0, 999] 坐标体系 + 自然语言 (如 图1 <bbox>120 180 640 760</bbox> (蓝色框内的沙发))
 * 2. qwen_visual: Qwen-Image 2.1 视觉画框标记 + 引用符 (中文【图1】英文<image1> + 蓝色框内的区域)
 * 3. inpaint_mask: Flux/SD/Imagen 二值蒙版 (黑底白框/涂抹) + 局部重绘 Prompt
 * 4. text_only: 语义自动识别 (Titan/一句话改图)
 */
export const MODEL_PRECISION_EDIT_REGISTRY = {
  // Seedream 5.0 系列
  'doubao_seedream_5': {
    name: 'Seedream 5.0',
    mode: 'seedream_bbox',
    refSyntax: 'cn_tu', // 图1
    supportsNormalizedBbox: true,
    supportsPoints: true,
  },
  'seedream_5_pro': {
    name: 'Seedream 5.0 Pro',
    mode: 'seedream_bbox',
    refSyntax: 'cn_tu',
    supportsNormalizedBbox: true,
    supportsPoints: true,
  },
  'seedream_5_flash': {
    name: 'Seedream 5.0 Flash',
    mode: 'seedream_bbox',
    refSyntax: 'cn_tu',
    supportsNormalizedBbox: true,
    supportsPoints: true,
  },
  // Qwen-Image 系列
  'qwen_image_2_1': {
    name: 'Qwen-Image 2.1',
    mode: 'qwen_visual',
    refSyntax: 'bracket_tu', // 【图1】
    supportsVisualMarker: true,
  },
  'qwen_image': {
    name: 'Qwen-Image',
    mode: 'qwen_visual',
    refSyntax: 'bracket_tu',
    supportsVisualMarker: true,
  },
  // SD / Flux 蒙版重绘系列
  'flux_inpaint': {
    name: 'Flux Inpaint',
    mode: 'inpaint_mask',
    refSyntax: 'at_tu',
    supportsMask: true,
  },
  'sd_inpaint': {
    name: 'Stable Diffusion Inpaint',
    mode: 'inpaint_mask',
    refSyntax: 'at_tu',
    supportsMask: true,
  },
  // Agnes 空间灵感交互
  'agnes': {
    name: 'Agnes 空间助手',
    mode: 'general_natural',
    refSyntax: 'at_tu',
    supportsVisualMarker: true,
  },
};

/**
 * 获得指定模型的精度编辑能力规范
 */
export function getModelPrecisionSpec(modelKey = '') {
  const k = String(modelKey || '').toLowerCase();
  for (const [key, spec] of Object.entries(MODEL_PRECISION_EDIT_REGISTRY)) {
    if (k.includes(key) || key.includes(k)) {
      return spec;
    }
  }
  // 智能推断：根据命名包含判断
  if (k.includes('seedream') || k.includes('doubao')) {
    return MODEL_PRECISION_EDIT_REGISTRY.doubao_seedream_5;
  }
  if (k.includes('qwen') || k.includes('wanx')) {
    return MODEL_PRECISION_EDIT_REGISTRY.qwen_image_2_1;
  }
  if (k.includes('flux') || k.includes('sd') || k.includes('inpaint')) {
    return MODEL_PRECISION_EDIT_REGISTRY.flux_inpaint;
  }
  if (k.includes('agnes') || k.includes('chat')) {
    return MODEL_PRECISION_EDIT_REGISTRY.agnes;
  }
  // 默认使用 Agnes 视觉线框规范
  return MODEL_PRECISION_EDIT_REGISTRY.agnes;
}

/**
 * 将区域像素矩形换算为 Seedream 5.0 标准的 0~999 归一化坐标字符串
 * x1 = round((x / width) * 1000), 取值范围 [0, 999]
 */
export function calculateNormalizedBbox(reg, dispW = 800, dispH = 600) {
  if (!reg) return '0 0 0 0';

  if (reg.norm && typeof reg.norm.x === 'number') {
    const x1 = Math.min(999, Math.max(0, Math.round(reg.norm.x * 1000)));
    const y1 = Math.min(999, Math.max(0, Math.round(reg.norm.y * 1000)));
    const x2 = Math.min(999, Math.max(0, Math.round((reg.norm.x + reg.norm.w) * 1000)));
    const y2 = Math.min(999, Math.max(0, Math.round((reg.norm.y + reg.norm.h) * 1000)));
    return `${x1} ${y1} ${x2} ${y2}`;
  }

  const w = Math.max(1, dispW);
  const h = Math.max(1, dispH);

  let rx = reg.x || 0;
  let ry = reg.y || 0;
  let rw = reg.w || 20;
  let rh = reg.h || 20;

  if (reg.type === 'polygon' && Array.isArray(reg.points) && reg.points.length > 0) {
    const xs = reg.points.map((p) => p.x);
    const ys = reg.points.map((p) => p.y);
    rx = Math.min(...xs);
    ry = Math.min(...ys);
    rw = Math.max(...xs) - rx;
    rh = Math.max(...ys) - ry;
  }

  const x1 = Math.min(999, Math.max(0, Math.round((rx / w) * 1000)));
  const y1 = Math.min(999, Math.max(0, Math.round((ry / h) * 1000)));
  const x2 = Math.min(999, Math.max(0, Math.round(((rx + rw) / w) * 1000)));
  const y2 = Math.min(999, Math.max(0, Math.round(((ry + rh) / h) * 1000)));

  return `${x1} ${y1} ${x2} ${y2}`;
}

function getRegionRegex(tuNum, reg) {
  const names = [];
  if (reg.name) {
    names.push(reg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const m = reg.name.match(/\d+/);
    if (m) {
      names.push(`区域${m[0]}`);
    }
  } else {
    names.push('区域\\d+');
  }
  const nameUnion = Array.from(new Set(names)).join('|');
  return new RegExp(`@?图${tuNum}\\[(?:${nameUnion})\\](?:\\s*<bbox>[^<]+<\\/bbox>)?(?:[（\\(][^）\\)]*[）\\)])?`, 'g');
}

/**
 * 客户端精准编辑提示词转译器
 * 根据当前选中的目标模型，将前端抽象的 @图1[区域1] 转换为该模型最偏好的方言格式
 */
export function compilePrecisionEditPrompt({
  rawPrompt = '',
  regions = [],
  imageIndex = 0,
  targetModelKey = '',
  dispW = 800,
  dispH = 600,
}) {
  const spec = getModelPrecisionSpec(targetModelKey);
  let dialectPrompt = rawPrompt;
  const tuNum = imageIndex + 1;

  // 正则同时匹配包含或不包含 @ 的多区域聚合标签与单区域标签，兼容已存在 <bbox> 坐标的情况，中英文括号均兼容
  const aggRegex = new RegExp(`(@?图${tuNum}\\[[^\\]]+\\](?:\\s*<bbox>[^<]+<\\/bbox>)?(?:、@?图${tuNum}\\[[^\\]]+\\](?:\\s*<bbox>[^<]+<\\/bbox>)?)*)(?:[（\\(]([^）\\)]*)[）\\)])?`, 'g');

  if (spec.mode === 'seedream_bbox') {
    dialectPrompt = dialectPrompt.replace(aggRegex, (match, targets, colorDesc) => {
      const nameMatches = [...targets.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
      const matchedRegs = nameMatches
        .map((name) => regions.find((r) => r.name === name || r.name.includes(name)))
        .filter(Boolean);
      const colorName = matchedRegs[0]?.color?.name || (colorDesc ? colorDesc.replace('线框', '') : '指定');
      
      // 多点选区 (polygon) 因几何不规则，Seedream bbox 不支持任意多边形顶点，采用「外接矩形 BBox + 视觉线框」双重定位
      const hasPolygon = matchedRegs.some((r) => r.type === 'polygon');
      if (hasPolygon) {
        const polyRegs = matchedRegs.filter((r) => r.type === 'polygon');
        const rectRegs = matchedRegs.filter((r) => r.type !== 'polygon');
        if (rectRegs.length > 0) {
          const rectBoxes = rectRegs.map((r) => `<bbox>${calculateNormalizedBbox(r, dispW, dispH)}</bbox>`).join(' ');
          const polyBoxes = polyRegs.map((r) => `<bbox>${calculateNormalizedBbox(r, dispW, dispH)}</bbox>`).join(' ');
          return `图${tuNum} 矩形区 ${rectBoxes} 与 多边形区 ${polyBoxes}（彩色线框内区域）`;
        }
        const outerBbox = calculateNormalizedBbox(matchedRegs[0], dispW, dispH);
        const bboxPart = outerBbox ? ` <bbox>${outerBbox}</bbox>` : '';
        if (matchedRegs.length > 1) {
          return `图${tuNum}${bboxPart}（${colorName}多边形线框内的各区域）`;
        }
        return `图${tuNum}${bboxPart}（${colorName}多边形线框内的区域）`;
      }

      // 矩形选区严格保留 Seedream 归一化 <bbox> 坐标
      const bboxes = (matchedRegs.length > 0 ? matchedRegs : regions)
        .map((r) => `<bbox>${calculateNormalizedBbox(r, dispW, dispH)}</bbox>`)
        .join(' ');
      return `图${tuNum} ${bboxes}（${colorName}线框）`;
    });
    dialectPrompt = dialectPrompt.replace(/@?图(\d+)/g, '图$1');
    dialectPrompt = dialectPrompt.replace(/@?图片(\d+)/g, '图$1');
  } else if (spec.mode === 'qwen_visual') {
    dialectPrompt = dialectPrompt.replace(aggRegex, (match, targets, colorDesc) => {
      const nameMatches = [...targets.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
      const matchedRegs = nameMatches
        .map((name) => regions.find((r) => r.name === name || r.name.includes(name)))
        .filter(Boolean);
      const colorName = matchedRegs[0]?.color?.name || (colorDesc ? colorDesc.replace('线框', '') : '标注');
      if (matchedRegs.length > 1) {
        return `【图${tuNum}】${colorName}线框内的各区域`;
      }
      return `【图${tuNum}】${colorName}线框内的区域`;
    });
    dialectPrompt = dialectPrompt.replace(/@?图(\d+)/g, '【图$1】');
    dialectPrompt = dialectPrompt.replace(/@?图片(\d+)/g, '【图$1】');
  } else {
    // Agnes / 通用生图重绘默认：规范输出选区名并注入归一化 <bbox> 坐标
    for (const reg of regions) {
      const colorName = reg.color?.name || '指定';
      const normBbox = calculateNormalizedBbox(reg, dispW, dispH);
      const bboxPart = normBbox ? ` <bbox>${normBbox}</bbox>` : '';
      dialectPrompt = dialectPrompt.replace(
        getRegionRegex(tuNum, reg),
        `@图${tuNum}[${reg.name}]${bboxPart}（${colorName}线框）`
      );
    }
  }

  return {
    spec,
    dialectPrompt,
    requiresVisualMarker: spec.mode === 'qwen_visual' || spec.supportsVisualMarker || !spec.supportsNormalizedBbox,
  };
}

/**
 * 在原图上绘制指定区域的彩色线框，生成供模型视觉定位的线框指示图
 */
export async function createWireframeOverlayImage(imageUrl, regions = []) {
  if (!imageUrl || !Array.isArray(regions) || regions.length === 0) return imageUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 800;
        canvas.height = img.naturalHeight || img.height || 600;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const w = canvas.width;
        const h = canvas.height;

        regions.forEach((reg) => {
          const color = reg.color?.border || '#3B82F6';
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(3.5, Math.round(w * 0.0035));
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          if (reg.type === 'polygon' && Array.isArray(reg.points) && reg.points.length >= 3) {
            ctx.beginPath();
            reg.points.forEach((pt, idx) => {
              const px = pt.norm ? pt.norm.x * w : (pt.x != null ? (pt.x / (reg.imgW || w)) * w : 0);
              const py = pt.norm ? pt.norm.y * h : (pt.y != null ? (pt.y / (reg.imgH || h)) * h : 0);
              if (idx === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            });
            ctx.closePath();
            ctx.stroke();
          } else {
            let rx, ry, rw, rh;
            if (reg.norm && typeof reg.norm.x === 'number') {
              rx = reg.norm.x * w;
              ry = reg.norm.y * h;
              rw = reg.norm.w * w;
              rh = reg.norm.h * h;
            } else {
              const baseW = reg.imgW || (img.clientWidth || w);
              const baseH = reg.imgH || (img.clientHeight || h);
              rx = (reg.x / baseW) * w;
              ry = (reg.y / baseH) * h;
              rw = (reg.w / baseW) * w;
              rh = (reg.h / baseH) * h;
            }
            ctx.strokeRect(rx, ry, rw, rh);
          }
        });

        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        console.warn('动态生成线框指示图失败:', e);
        resolve(imageUrl);
      }
    };
    img.onerror = () => resolve(imageUrl);
    img.src = imageUrl;
  });
}

/**
 * 标准画幅宽高比候选集，用于自动适配原图画幅（杜绝 9:16 底图被 16:9 强行压扁变形）
 */
export const CANONICAL_RATIOS = [
  { val: 1, ratio: '1:1' },
  { val: 3 / 4, ratio: '3:4' },
  { val: 4 / 3, ratio: '4:3' },
  { val: 16 / 9, ratio: '16:9' },
  { val: 9 / 16, ratio: '9:16' },
  { val: 3 / 2, ratio: '3:2' },
  { val: 2 / 3, ratio: '2:3' },
  { val: 21 / 9, ratio: '21:9' },
];

/**
 * 根据图片自然宽高计算最接近的标准比例
/**
 * 根据图片自然宽高计算最接近的标准比例，支持在当前模型允许的选项集中寻找最优解
 */
export function getNearestCanonicalRatio(w, h, allowedOptions = null) {
  if (!w || !h) return (Array.isArray(allowedOptions) && allowedOptions.length) ? allowedOptions[0] : '1:1';
  const r = w / h;

  let candidates = CANONICAL_RATIOS;
  if (Array.isArray(allowedOptions) && allowedOptions.length > 0) {
    const filtered = CANONICAL_RATIOS.filter(c => allowedOptions.includes(c.ratio));
    if (filtered.length > 0) {
      candidates = filtered;
    } else if (allowedOptions.includes('adaptive')) {
      return 'adaptive';
    } else {
      return allowedOptions[0];
    }
  }

  let best = candidates[0];
  let minDiff = Math.abs(best.val - r);
  for (const opt of candidates) {
    const diff = Math.abs(opt.val - r);
    if (diff < minDiff) {
      minDiff = diff;
      best = opt;
    }
  }

  // 若模型原生支持自适应画幅 adaptive，且离散标准比例与原图偏差较大（>12%），优先保留真实比例
  if (Array.isArray(allowedOptions) && allowedOptions.includes('adaptive') && (minDiff / r > 0.12)) {
    return 'adaptive';
  }

  return best.ratio;
}

/**
 * 智能分析媒体对象语义属性（分辨率、比例、类型、3D属性、材质属性）
 */
export function detectMediaSemantics(item) {
  if (!item) return {
    kind: 'image',
    is3DFurniture: false,
    isMaterialSwatch: false,
    isVideo: false,
    isAudio: false,
    isVertical: false,
    isHorizontal: false,
    isSquare: true,
    canonicalRatio: '1:1',
    suggestedSize: '2K',
    suggestedVideoRes: '1080p',
    width: 0,
    height: 0
  };

  const name = String(item.name || item.file_name || item.title || '');
  const url = String(item.url || '');
  const rawKind = String(item.kind || item.category || item.media_type || '');

  const isVideo = rawKind === 'video' || /\.(mp4|mov|webm)$/i.test(url) || /\.(mp4|mov|webm)$/i.test(name);
  const isAudio = rawKind === 'audio' || rawKind === 'music' || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(url) || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(name);
  
  const is3DFurniture = (item.origin === '3d_snapshot' && (item.glb || item.modelUrl || item.targetRegionId))
    || Boolean(item.glb || item.modelUrl)
    || item.kind === '3d'
    || item.category === '3d'
    || /\.(glb|gltf|obj)($|\?)/i.test(url)
    || /\.(glb|gltf|obj)$/i.test(name);

  const isMaterialSwatch = item.kind === 'swatch'
    || item.kind === 'basecolor'
    || Boolean(item.materialTextureUrl)
    || /(swatch|material|texture|basecolor|贴图|材质|面料|石材|木纹|洞石|皮质)/i.test(name)
    || /(swatch|basecolor|material|texture)/i.test(url);

  const w = Number(item.naturalWidth || item.width || 0);
  const h = Number(item.naturalHeight || item.height || 0);

  const isVertical = w > 0 && h > 0 ? (h / w >= 1.15) : false;
  const isHorizontal = w > 0 && h > 0 ? (w / h >= 1.15) : false;
  const isSquare = w > 0 && h > 0 ? (!isVertical && !isHorizontal) : true;

  const canonicalRatio = (w > 0 && h > 0) ? getNearestCanonicalRatio(w, h) : (isVertical ? '9:16' : (isHorizontal ? '16:9' : '1:1'));

  const maxDim = Math.max(w, h);
  let suggestedSize = '2K';
  if (maxDim >= 3000) suggestedSize = '4K';
  else if (maxDim >= 1800) suggestedSize = '2K';
  else if (maxDim >= 1200) suggestedSize = '1.5K';
  else if (maxDim > 0 && maxDim < 900) suggestedSize = '1K';

  let suggestedVideoRes = '1080p';
  if (maxDim >= 1800) suggestedVideoRes = '1080p';
  else if (maxDim > 0 && maxDim < 900) suggestedVideoRes = '720p';

  return {
    kind: isVideo ? 'video' : (isAudio ? 'audio' : 'image'),
    is3DFurniture,
    isMaterialSwatch,
    isVideo,
    isAudio,
    isVertical,
    isHorizontal,
    isSquare,
    canonicalRatio,
    suggestedSize,
    suggestedVideoRes,
    width: w,
    height: h
  };
}

/**
 * 全链路智能感知与自适应调度引擎 (Intelligent Perception & Adaptive Dispatch Engine)
 * 在整个工作流中通过分析用户选择的图片属性（分辨率、比例、类型）、选区的操作类型（add / replace / recolor / erase / outpaint）、复用的模板元数据，
 * 自动切到最合适的板块（modality / mode / 模型能力），并自动推导出最匹配的参数（ratio、size、相机透视、色彩融入、选区出口路由），杜绝画面拉伸变形与配置冲突。
 */
export function inferOptimalWorkflowAndParams({
  referenceTray = [],
  selectedImageIndex = 0,
  currentModality = 'chat',
  currentGenMode = '',
  currentSchema = null,
  currentParams = {},
  templateMeta = null,
  editRegions = []
} = {}) {
  const tray = Array.isArray(referenceTray) ? referenceTray : [];
  const reasons = [];

  // 1. 模态研判与自适应调度 (Modality Dispatch)
  let targetModality = currentModality;

  // 1.1 检查模板显式元数据
  if (templateMeta) {
    const tplType = String(templateMeta.type || '').toLowerCase();
    const tplModality = String(templateMeta.params?.modality || templateMeta.params?.genMode || templateMeta.params?.mode || '').toLowerCase();
    if (tplType === 'video' || tplModality === 'video' || ['first_last_frame', 'omni_reference', 'image_to_video'].includes(templateMeta.params?.schemaMode)) {
      targetModality = 'video';
      reasons.push('复用视频创作配方，自动切入视频生成板块');
    } else if (tplType === 'audio' || tplType === 'music' || tplModality === 'music' || tplModality === 'audio') {
      targetModality = 'music';
      reasons.push('复用音频配方，自动切入配乐生成板块');
    } else if (tplType === 'chat' || tplModality === 'chat') {
      targetModality = 'chat';
    } else {
      targetModality = 'image';
      reasons.push('复用图像创作配方，自动切入图像生成板块');
    }
  }

  // 1.2 检查挂载素材属性
  const hasVideo = tray.some(it => detectMediaSemantics(it).isVideo);
  const hasAudio = tray.some(it => detectMediaSemantics(it).isAudio);
  const imageItems = tray.filter(it => !detectMediaSemantics(it).isVideo && !detectMediaSemantics(it).isAudio);

  if (hasVideo) {
    if (targetModality !== 'video') {
      targetModality = 'video';
      reasons.push('检测到视频参考素材，自动自适应切至视频板块');
    }
  } else if (hasAudio) {
    if (targetModality !== 'music') {
      targetModality = 'music';
      reasons.push('检测到音频素材，自动自适应切至配乐板块');
    }
  } else if (imageItems.length > 0 && targetModality === 'chat') {
    // 关键优化：挂载图片时，绝不僵化停留在纯对话框，自动激活图像板块
    targetModality = 'image';
    reasons.push('检测到挂载图片素材，自动由纯对话切至图像生成板块');
  }

  // 2. 子模式研判与自适应调度 (Sub-Mode Dispatch)
  let targetGenMode = currentGenMode;
  const modes = currentSchema?.modes || [];
  const hasMode = (id) => modes.some(m => m.id === id);

  // 检查是否有选区与局部重绘方案
  const effectiveRegions = (Array.isArray(editRegions) && editRegions.length > 0)
    ? editRegions
    : tray.flatMap(it => Array.isArray(it.regions) ? it.regions : []);
  const hasOutpaint = tray.some(it => Boolean(it.outpainted));
  const hasRegions = effectiveRegions.length > 0;
  const hasErase = effectiveRegions.some(r => r.op === 'erase');
  const hasRecolor = effectiveRegions.some(r => r.op === 'recolor');
  const has3D = effectiveRegions.some(r => ['replace', 'add'].includes(r.op))
    || tray.some(it => detectMediaSemantics(it).is3DFurniture);

  if (targetModality === 'image') {
    if (hasOutpaint && hasMode('expand_fill')) {
      targetGenMode = 'expand_fill';
      reasons.push('检测到画幅向外延展操作，自动切入「扩边填白 (expand_fill)」模式');
    } else if (hasRegions && hasMode('image_edit')) {
      targetGenMode = 'image_edit';
      if (hasErase && !has3D && !hasRecolor) {
        reasons.push('检测到杂物消除选区，自动切入「交互编辑」消除修复模式，智能重构背景平整纹理');
      } else if (hasRecolor && !has3D) {
        reasons.push('检测到材质色板/表面重塑选区，自动切入「交互编辑」材质重塑模式');
      } else if (has3D) {
        reasons.push('检测到 3D 软装家具陈设选区，自动切入「交互编辑」并锁定地面透视与真实物理尺度');
      } else {
        reasons.push('检测到空间局部标注选区，自动切入「交互编辑 (image_edit)」精准重绘模式');
      }
    } else if (imageItems.length === 1) {
      if (hasMode('image_to_image')) targetGenMode = 'image_to_image';
      else if (hasMode('image_reference')) targetGenMode = 'image_reference';
    } else if (imageItems.length > 1) {
      const hasSwatch = tray.some(it => detectMediaSemantics(it).isMaterialSwatch);
      if ((has3D || hasSwatch) && hasMode('image_edit')) {
        targetGenMode = 'image_edit';
        reasons.push(has3D ? '识别到 3D 软装家具透视参考，自动激活空间局部编辑模式' : '识别到材质色板贴图参考，自动激活材质重塑模式');
      } else if (hasMode('image_reference')) {
        targetGenMode = 'image_reference';
      } else if (hasMode('image_to_image')) {
        targetGenMode = 'image_to_image';
      }
    } else if (imageItems.length === 0) {
      if (hasMode('text_to_image')) targetGenMode = 'text_to_image';
    }
  } else if (targetModality === 'video') {
    if (imageItems.length === 2 && hasMode('first_last_frame')) {
      targetGenMode = 'first_last_frame';
      reasons.push('检测到 2 张画面关键帧，自动切入「首尾帧 (first_last_frame)」视频生成');
    } else if (imageItems.length > 1 && hasMode('omni_reference')) {
      targetGenMode = 'omni_reference';
    } else if (imageItems.length === 1 && hasMode('image_to_video')) {
      targetGenMode = 'image_to_video';
    }
  }

  // 3. 画幅比例 (Ratio) 与分辨率档位 (Size) 智能自适应
  // 核心原则：场景底图（优先选取非 3D 模型快照、非材质色板的真实空间照片）真实自然宽高决定比例，杜绝压扁或拉伸变形！
  let baseSceneImage = null;
  const currentSelected = tray[selectedImageIndex >= 0 && selectedImageIndex < tray.length ? selectedImageIndex : 0];
  if (currentSelected && !detectMediaSemantics(currentSelected).is3DFurniture && !detectMediaSemantics(currentSelected).isMaterialSwatch) {
    baseSceneImage = currentSelected;
  }
  if (!baseSceneImage) {
    baseSceneImage = tray.find(it => {
      const s = detectMediaSemantics(it);
      return !s.is3DFurniture && !s.isMaterialSwatch && !s.isVideo && !s.isAudio;
    }) || currentSelected || imageItems[0] || tray[0] || null;
  }
  const baseMeta = detectMediaSemantics(baseSceneImage);

  const ratioOptions = (currentSchema?.common || []).find(f => f.key === 'ratio')?.options
    || (currentSchema?.params || []).find(p => p.key === 'ratio')?.options
    || ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];

  const sizeOptions = (currentSchema?.common || []).find(f => f.key === 'size')?.options
    || (currentSchema?.params || []).find(p => p.key === 'size')?.options
    || ['1K', '1.5K', '2K', '4K'];

  let targetRatio = currentParams.ratio;
  let targetSize = currentParams.size;
  let targetVideoResolution = currentParams.resolution || '1080p';

  if (baseSceneImage && (baseMeta.width > 0 && baseMeta.height > 0)) {
    const optimalRatio = getNearestCanonicalRatio(baseMeta.width, baseMeta.height, ratioOptions);

    if (targetRatio !== optimalRatio) {
      targetRatio = optimalRatio;
      if (templateMeta && (templateMeta.aspect_ratio || templateMeta.params?.ratio) && (templateMeta.aspect_ratio !== optimalRatio && templateMeta.params?.ratio !== optimalRatio)) {
        const oldR = templateMeta.aspect_ratio || templateMeta.params?.ratio;
        reasons.push(`复用历史配方（原 ${oldR}），检测到当前底图为 ${optimalRatio}，已自适应纠偏为 ${optimalRatio} 杜绝画面拉伸变形`);
      } else if (baseMeta.isVertical) {
        reasons.push(`底图为 ${baseMeta.canonicalRatio} 竖屏室内实拍图，系统已自适应切换至 ${optimalRatio} 画幅，杜绝画面压扁变形`);
      } else if (baseMeta.isHorizontal) {
        reasons.push(`底图为 ${baseMeta.canonicalRatio} 横屏空间图，系统已自适应切换至 ${optimalRatio} 画幅，杜绝画面拉伸变形`);
      } else {
        reasons.push(`底图为 1:1 方形构图，系统已自适应切换至 1:1 画幅`);
      }
    }

    // 分辨率档位自适应
    if (sizeOptions.includes(baseMeta.suggestedSize)) {
      targetSize = baseMeta.suggestedSize;
    }
    targetVideoResolution = baseMeta.suggestedVideoRes;
  } else if (templateMeta) {
    // 模板无对应底图时，优先恢复模板保存的画幅
    const tplRatio = templateMeta.aspect_ratio || templateMeta.params?.ratio;
    if (tplRatio && ratioOptions.includes(tplRatio)) {
      targetRatio = tplRatio;
    }
  }

  // 兜底保障 ratio 合法性
  if (!ratioOptions.includes(targetRatio)) {
    targetRatio = ratioOptions.includes('adaptive') ? 'adaptive' : (ratioOptions[0] || '1:1');
  }

  // 4. 选区出口路由 (Selection Exit Routing)
  const modelKey = currentSchema?.id || currentSchema?.name || '';
  const spec = getModelPrecisionSpec(modelKey);
  let selectionExit = {
    kind: 'vlm_text',
    channel: null,
    syntax: null,
    description: '自然语言方位与视觉线框引导'
  };
  if (spec.mode === 'seedream_bbox') {
    selectionExit = {
      kind: 'coords_bbox',
      channel: 'prompt',
      syntax: '<bbox>x1 y1 x2 y2</bbox>',
      coordSpace: '0-1000',
      description: '归一化 0-1000 BBox 坐标写进提示词正文'
    };
  } else if (spec.mode === 'inpaint_mask') {
    selectionExit = {
      kind: 'mask',
      channel: 'mask',
      coordSpace: '0-999',
      description: '白=重绘、黑=保留的黑白 PNG 蒙版通道'
    };
  } else if (spec.mode === 'qwen_visual') {
    selectionExit = {
      kind: 'vlm_visual',
      channel: 'overlay_wireframe',
      description: '原图叠加彩色线框指示图交付给多模态大模型'
    };
  }

  return {
    targetModality,
    targetGenMode,
    targetRatio,
    targetSize,
    targetVideoResolution,
    is3DFurniture: has3D,
    hasMaterialSwatch: tray.some(it => detectMediaSemantics(it).isMaterialSwatch),
    hasErase,
    hasRecolor,
    reasons,
    selectionExit,
    directives: {
      preventDeformation: true,
      groundPerspectiveLock: has3D,
      contactShadowRequired: has3D,
      colorHarmonyGuidance: has3D ? '主动汲取室内环境主色系，使陈设质感自然融入' : '',
      eraseBackgroundSeamlessFill: hasErase,
      noGhostingResiduals: hasErase,
      surfaceRecolorRequired: hasRecolor,
      textureAlignmentRequired: hasRecolor
    }
  };
}

/**
 * 快速提取场景底图主色调倾向（供 3D 家具与新陈设色彩自动融入环境）
 */
export function extractDominantScenePalette(canvasOrImg) {
  if (!canvasOrImg) return '经典室内高级深雅色系（呼应主场景黑色皮质与深色木饰面）';
  try {
    let canvas = canvasOrImg;
    if (typeof HTMLCanvasElement !== 'undefined' && canvasOrImg instanceof HTMLImageElement) {
      canvas = document.createElement('canvas');
      canvas.width = Math.min(200, canvasOrImg.naturalWidth || 200);
      canvas.height = Math.min(200, canvasOrImg.naturalHeight || 200);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(canvasOrImg, 0, 0, canvas.width, canvas.height);
    }
    if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let i = 0; i < data.length; i += 16) {
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        count++;
      }
      const rAvg = rSum / (count || 1);
      const gAvg = gSum / (count || 1);
      const bAvg = bSum / (count || 1);
      const brightness = (rAvg * 299 + gAvg * 587 + bAvg * 114) / 1000;

      if (brightness < 80) {
        return '深邃典雅暗调（建议呼应现场深炭黑、黑曜石、胡桃木与深色皮革）';
      }
      if (brightness > 180) {
        return '明亮通透浅暖调（建议呼应现场奶油白、浅暖灰、原木色与细腻棉麻）';
      }
      return '温润雅致中性灰调（建议呼应现场意式极简烟灰、暖咖色与高质感哑光皮）';
    }
  } catch (_) {}
  return '经典室内高级深雅色系（呼应主场景黑色皮质与深色木饰面）';
}

/**
 * 扫描 3D 模型渲染快照/抠图，计算非透明/非背景实体主体的 0-999 归一化 BBox
 */
export async function computeImageEntityBbox(dataUrl) {
  if (!dataUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width || 400;
        c.height = img.naturalHeight || img.height || 400;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, c.width, c.height);
        const data = imgData.data;
        let x1 = c.width, y1 = c.height, x2 = 0, y2 = 0, cnt = 0;
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            const idx = (y * c.width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];
            // 排除透明背景与纯白/纯黑大底
            const isWhiteBg = r >= 242 && g >= 242 && b >= 242;
            const isBlackBg = r <= 15 && g <= 15 && b <= 15 && a > 240;
            if (a > 25 && !isWhiteBg && !isBlackBg) {
              if (x < x1) x1 = x;
              if (y < y1) y1 = y;
              if (x > x2) x2 = x;
              if (y > y2) y2 = y;
              cnt++;
            }
          }
        }
        if (cnt < 50 || x2 <= x1 || y2 <= y1) {
          resolve(null);
          return;
        }
        const c999 = (v) => Math.max(0, Math.min(999, Math.round(v)));
        const nx1 = c999((x1 / c.width) * 1000);
        const ny1 = c999((y1 / c.height) * 1000);
        const nx2 = c999((x2 / c.width) * 1000);
        const ny2 = c999((y2 / c.height) * 1000);
        resolve(`${nx1} ${ny1} ${nx2} ${ny2}`);
      } catch (err) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

