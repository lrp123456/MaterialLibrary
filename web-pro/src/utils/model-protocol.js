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
        lockReasons[k] = mc.reason || '已由模型契约锁定';
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
  // 默认使用 Seedream 5.0 规范
  return MODEL_PRECISION_EDIT_REGISTRY.doubao_seedream_5;
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
  return new RegExp(`@图${tuNum}\\[(?:${nameUnion})\\](?:（[^）]*）)?`, 'g');
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

  // 正则同时匹配多区域聚合标签与单区域标签：@图1[区域1]、@图1[区域2]（红色线框） 或 @图1[区域1]（红色线框）
  const aggRegex = new RegExp(`(@图${tuNum}\\[[^\\]]+\\](?:、@图${tuNum}\\[[^\\]]+\\])*)(?:（([^）]*)）)?`, 'g');

  if (spec.mode === 'seedream_bbox') {
    dialectPrompt = dialectPrompt.replace(aggRegex, (match, targets, colorDesc) => {
      const nameMatches = [...targets.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
      const matchedRegs = nameMatches
        .map((name) => regions.find((r) => r.name === name || r.name.includes(name)))
        .filter(Boolean);
      const colorName = matchedRegs[0]?.color?.name || (colorDesc ? colorDesc.replace('线框', '') : '指定');
      
      // 多点选区 (polygon) 因几何不规则，Seedream bbox 不支持任意多边形坐标，自动采用 Qwen 式视觉线框描述
      const hasPolygon = matchedRegs.some((r) => r.type === 'polygon');
      if (hasPolygon) {
        if (matchedRegs.length > 1) {
          return `图${tuNum}（${colorName}线框内的各区域）`;
        }
        return `图${tuNum}（${colorName}线框内的区域）`;
      }

      // 矩形选区严格保留 Seedream 归一化 <bbox> 坐标
      const bboxes = (matchedRegs.length > 0 ? matchedRegs : regions)
        .map((r) => `<bbox>${calculateNormalizedBbox(r, dispW, dispH)}</bbox>`)
        .join(' ');
      return `图${tuNum} ${bboxes}（${colorName}线框）`;
    });
    dialectPrompt = dialectPrompt.replace(/@图(\d+)/g, '图$1');
    dialectPrompt = dialectPrompt.replace(/@图片(\d+)/g, '图$1');
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
    dialectPrompt = dialectPrompt.replace(/@图(\d+)/g, '【图$1】');
    dialectPrompt = dialectPrompt.replace(/@图片(\d+)/g, '【图$1】');
  } else {
    // Agnes / Default
    for (const reg of regions) {
      const colorName = reg.color?.name || '指定';
      dialectPrompt = dialectPrompt.replace(getRegionRegex(tuNum, reg), `@图${tuNum}[${reg.name}]（${colorName}线框）`);
    }
  }

  return {
    spec,
    dialectPrompt,
    requiresVisualMarker: spec.mode === 'qwen_visual',
  };
}
