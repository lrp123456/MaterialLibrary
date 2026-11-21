/**
 * 一张参考图的版本只能来自挂载时写上的标记，或地址里写明的 derivative / raw=1。
 * 不根据素材的主衍生、缩略图或浏览器实际画出的画面去猜。
 */

const LABELS = new Set(['原图', '9:16', '3:4', '裁剪', '线框', '生成结果', '衍生']);

function parsed(url) {
  try {
    return new URL(String(url || ''), 'http://local.invalid');
  } catch {
    return null;
  }
}

const KIND_LABELS = {
  origin: '原图',
  restage_9_16: '9:16',
  restage_3_4: '3:4',
  restage_1_1: '1:1',
  restage_dual: '双画幅',
  clean: '净画精修',
  style_transferred: '风格重绘',
  portrait_redraw: '人像重绘',
  clarity_enhanced: '超分高清',
  expand: '扩图延展',
  retouched: '精修版本',
  manual_edit: '手动编辑',
  quick_replace: '快速替换',
  quick_remove: '快速移除',
  quick_insert: '快速插入',
};

export function labelForDerivativeKind(kind) {
  const k = String(kind || '');
  if (!k) return '';
  return KIND_LABELS[k] || '衍生';
}

/** 有明确版本时返回标签，否则返回空字符串。 */
export function explicitVersionLabel(ref) {
  if (!ref || typeof ref === 'string') {
    const url = typeof ref === 'string' ? ref : '';
    return labelFromUrl(url, '');
  }
  const stamped = String(ref.versionLabel || '');
  if (LABELS.has(stamped)) return stamped;
  if (ref.isWireframe) return '线框';
  const url = String(ref.url || '');
  if ((ref.annotated || ref.isCustomEdited) && (url.startsWith('data:') || url.startsWith('blob:'))) {
    return '裁剪';
  }
  return labelFromUrl(url, ref.derivativeKind);
}

function labelFromUrl(url, derivativeKind) {
  const u = parsed(url);
  if (!u) return '';
  if (u.searchParams.get('raw') === '1') return '原图';
  if (u.searchParams.get('derivative')) return labelForDerivativeKind(derivativeKind) || '衍生';
  if (/\/media\/origin\//.test(u.pathname)) return '原图';
  return '';
}

export function hasExplicitVersion(ref) {
  return Boolean(explicitVersionLabel(ref));
}

/** 界面角标。历史消息没有版本时显示「未标明」，不把主衍生填回去。 */
export function versionBadge(ref) {
  return explicitVersionLabel(ref) || '未标明';
}
