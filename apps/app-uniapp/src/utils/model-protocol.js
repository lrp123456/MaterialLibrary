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
