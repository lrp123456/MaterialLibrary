export const BUILTIN_GUIDE_TEXT = {
  remove: '去掉框内物体，周围墙面、地面和光影自然补上。',
  blank: '去掉框内物体，这块保持干净空旷，周围结构延续。'
};

export const GUIDE_TYPE_TO_OP = {
  add: 'add',
  remove: 'erase',
  replace: 'replace',
  resurface: 'recolor',
  blank: 'blank',
  custom: 'custom'
};

const FINISH_LABELS = {
  matte: '哑光',
  satin: '柔抛',
  semi_gloss: '半光',
  gloss: '高光',
  high_gloss: '高光'
};

const AGING_LABELS = {
  lived_in: '自然包浆',
  gentle_patina: '轻微包浆',
  vintage: '复古做旧',
  vintage_worn: '复古做旧',
  weathered: '原始风化'
};

const SKIN_LABELS = {
  soft_leather: '真皮',
  soft_fabric: '织物',
  soft_veneer: '木皮',
  soft_metal: '金属'
};

export function emptyGuide() {
  return {
    type: '',
    surface: '',
    surfaceSource: '',
    subclass: '',
    assetId: '',
    materialName: '',
    colorHex: '',
    suggestion: null,
    objectCategory: '',
    objectName: '',
    objectUrl: '',
    yaw: 0,
    yawTouched: false,
    finish: '',
    roughness: null,
    aging: '',
    text: '',
    name: ''
  };
}

export function guideSentence(region) {
  const name = region?.name || '选区';
  const guide = region?.guide;
  if (!guide || !guide.type) return '';

  if (guide.type === 'remove') {
    return (guide.text || '').trim() || BUILTIN_GUIDE_TEXT.remove;
  }
  if (guide.type === 'blank') {
    return (guide.text || '').trim() || BUILTIN_GUIDE_TEXT.blank;
  }
  if (guide.type === 'custom') {
    const text = (guide.text || '').trim();
    return text ? `${name}：${text}` : '';
  }
  if (guide.type === 'resurface') {
    const colorHex = guide.colorHex || guide.hex || '';
    const materialName = guide.materialName || guide.displayName || '';
    if (!materialName && !colorHex) return '';

    const parts = [];
    if (guide.mode === 'recolor' || (!guide.mode && colorHex && !materialName)) {
      const colorDesc = guide.displayName ? `${guide.displayName}（${colorHex}）` : colorHex;
      parts.push(`只改变这块${name}的颜色，改为${colorDesc}，保持原有材质纹理、褶皱与光影结构`);
    } else if (guide.mode === 'rematerial' || materialName) {
      if (colorHex) {
        parts.push(`把这块${name}换成${materialName}，颜色对齐预染色 ${colorHex}`);
      } else {
        parts.push(`把这块${name}换成${materialName}，纹理与铺法以贴图固有色为准`);
      }
    } else {
      parts.push(`颜色改为 ${colorHex}，保持原有材质结构`);
    }

    if (guide.process) {
      const processMap = {
        roller_matte: '工艺采用标准滚筒平涂哑光',
        eggshell: '工艺采用丝光蛋壳光',
        trowel_microcement: '工艺采用艺术漆批刮微水泥',
        velvet: '工艺采用天鹅绒艺术漆',
        lime_rammed: '工艺采用粗粝石灰夯土'
      };
      if (processMap[guide.process]) parts.push(processMap[guide.process]);
    }
    if (guide.finish && FINISH_LABELS[guide.finish]) parts.push(`光泽 ${FINISH_LABELS[guide.finish]}`);
    parts.push('不要添加色块贴图，框外所有像素保持原样');
    return `${parts.join('，')}。`;
  }
  if (guide.type === 'add' || guide.type === 'replace') {
    if (!guide.objectName) return '';
    const verb = guide.type === 'add' ? '增加' : '换成';
    let sentence = `在${name}${verb}${guide.objectName}`;
    const materialBits = [];
    if (guide.materialName) materialBits.push(guide.materialName);
    if (guide.colorHex) materialBits.push(guide.colorHex);
    if (materialBits.length) sentence += `，材质 ${materialBits.join(' ')}`;
    if (guide.yawTouched) sentence += `，朝向 ${guide.yaw || 0}°`;
    return `${sentence}。`;
  }
  return '';
}

export function formatGuideRecipe(regions) {
  if (!Array.isArray(regions)) return '';
  return regions.map(guideSentence).filter(Boolean).join('\n');
}

export function skinLabel(key) {
  return SKIN_LABELS[key] || '';
}

function copyGuide(guide) {
  return {
    ...emptyGuide(),
    ...(guide || {}),
    suggestion: guide?.suggestion ? { ...guide.suggestion } : null
  };
}

export function applyGuide(currentGuide, savedGuide) {
  const current = copyGuide(currentGuide);
  const saved = copyGuide(savedGuide);
  const savedSurface = saved.surface || '';
  const currentSurface = current.surface || '';
  if (saved.type === 'resurface' && savedSurface && currentSurface && savedSurface !== currentSurface) {
    return { needsConfirm: true, guide: current };
  }
  return { needsConfirm: false, guide: saved };
}

export function commitGuide(savedGuide) {
  return copyGuide(savedGuide);
}
