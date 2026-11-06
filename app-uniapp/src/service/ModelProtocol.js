/**
 * 客户端模型规则引擎（移动端移植版）。
 *
 * 与服务端 src/unified-translator.js / src/models-contract.js 以及
 * web-pro/src/utils/model-protocol.js 保持同源：模式锁定、取值联动、
 * 字段抑制、字段选项覆盖与提示，全部由 schema 驱动，客户端不写死参数。
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

  // 1. 模式级约束（例如首尾帧锁定比例、视频编辑锁定时长）
  const mc = schema.modeConstraints && schema.modeConstraints[activeMode];
  if (mc) {
    if (mc.set && typeof mc.set === 'object') Object.assign(nextParams, mc.set);
    if (Array.isArray(mc.lock)) {
      for (const k of mc.lock) {
        lockedKeys.add(k);
        lockReasons[k] = mc.reason || '已由模型契约锁定';
      }
    }
  }

  // 2. 参数值级条件联动（例如图层拆分、透明底强制 PNG）
  const vcs = Array.isArray(schema.valueConstraints) ? schema.valueConstraints : [];
  for (const vc of vcs) {
    const val = nextParams[vc.ifKey];
    const matched = Array.isArray(vc.ifIn) && vc.ifIn.map(String).includes(String(val));
    if (!matched) continue;

    if (vc.set && typeof vc.set === 'object') Object.assign(nextParams, vc.set);
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
        if (!vc.effect.size_options.map(String).includes(String(nextParams.size))) {
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

/** schema 全字段默认值（common + advanced）。 */
export function schemaDefaults(schema) {
  const out = {};
  for (const field of [...((schema && schema.common) || []), ...((schema && schema.advanced) || [])]) {
    if (field && field.key) out[field.key] = field.default;
  }
  return out;
}

/** 在 common / advanced 中按 key 查字段。 */
export function fieldByKey(schema, key) {
  return [...((schema && schema.common) || []), ...((schema && schema.advanced) || [])].find((f) => f && f.key === key) || null;
}

/** 旧值是否仍符合字段契约（枚举成员 / 数值范围）。 */
export function valueStillFits(schema, key, value) {
  const field = fieldByKey(schema, key);
  if (!field) return false;
  if (field.type === 'enum') return (field.options || []).map(String).includes(String(value));
  if (['number', 'range', 'duration'].includes(field.type)) {
    if (value === '' || value == null) return false;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (field.min != null && n < Number(field.min)) return false;
    if (field.max != null && n > Number(field.max)) return false;
  }
  return true;
}

/** 把任意参数对象裁剪回 schema 允许的键与值。 */
export function clampParamsToSchema(schema, params = {}) {
  if (!schema) return { ...(params || {}) };
  const out = { ...(params || {}) };
  for (const field of [...(schema.common || []), ...(schema.advanced || [])]) {
    if (!field || !field.key) continue;
    const has = out[field.key] != null;
    if (!has) continue;
    if (field.type === 'enum' && !valueStillFits(schema, field.key, out[field.key])) {
      out[field.key] = field.default;
    } else if (['number', 'range', 'duration'].includes(field.type)) {
      const n = Number(out[field.key]);
      if (!Number.isFinite(n)) out[field.key] = field.default;
      else {
        if (field.min != null) out[field.key] = Math.max(Number(field.min), n);
        if (field.max != null) out[field.key] = Math.min(Number(field.max), out[field.key]);
      }
    }
  }
  return out;
}

/** 把 schema 模式适用的当前模式挑出来（无匹配则取第一个）。 */
export function resolveSchemaMode(schema, currentMode, refCounts = { images: 0, videos: 0, audios: 0 }) {
  const modes = ((schema && schema.modes) || []).map((m) => m.id).filter(Boolean);
  if (!modes.length) return currentMode;
  if (modes.includes(currentMode)) return currentMode;
  const hasRefs = Number(refCounts.images || 0) > 0 || Number(refCounts.videos || 0) > 0 || Number(refCounts.audios || 0) > 0;
  const preferred = hasRefs
    ? ['omni_reference', 'image_to_image', 'image_to_video', 'image_edit']
    : ['text_to_image', 'text_to_video', 'text_to_bgm', 'text_to_song'];
  return modes.find((m) => preferred.includes(m)) || modes[0];
}
