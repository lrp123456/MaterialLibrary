/**
 * 图片区域分析的词表、语法选择、契约变更和跳转草稿。
 * 不看图，不访问数据库。模型输出先经过这里，才能进入报告。
 */

const SPACE_TYPES = [
  '客厅', '客餐厅', '餐厅', '卧室', '厨房', '卫生间',
  '书房', '玄关', '儿童房', '阳台', '其他', '未知'
];

const PARTS = [
  'ceiling', 'wall', 'floor', 'millwork',
  'upholstery', 'hard_furniture', 'curtain_bedding', 'rug', 'other'
];

const ROLES_WITH_GRAMMAR = {
  feature_wall: 'wall',
  custom_millwork: 'wall',
  soft_panel: 'soft_panel',
  headboard: 'headboard',
  sofa: 'sofa',
  table: 'table',
  freestanding_cabinet: 'cabinet',
  floor: 'floor',
  ceiling: 'ceiling',
  curtain: 'curtain',
  bedding: 'bedding',
  rug: 'rug'
};

const ROLES_WITHOUT_GRAMMAR = ['tv', 'metal', 'pillow', 'other'];

const INTENTS = ['keep', 'follow_target', 'unset'];

const GRAMMARS = {
  wall: {
    id: 'wall',
    slots: {
      opening: ['center', 'offset', 'none', 'unknown'],
      symmetry: ['symmetric', 'asymmetric', 'unknown'],
      vertical: ['single', 'two', 'multi', 'unknown'],
      construction: ['flat', 'slat', 'cabinet', 'upholstered', 'unknown'],
      boundary: ['to_ceiling', 'below_ceiling', 'into_ceiling', 'unknown']
    }
  },
  sofa: {
    id: 'sofa',
    slots: {
      plan: ['straight', 'chaise', 'l', 'u', 'unknown'],
      seats: ['one', 'two', 'three', 'multi', 'unknown'],
      back: ['low', 'high', 'unknown'],
      arms: ['both', 'one', 'none', 'unknown'],
      base: ['flush', 'skirted', 'tall_legs', 'unknown']
    }
  },
  headboard: {
    id: 'headboard',
    slots: {
      width: ['match', 'wider', 'narrower', 'unknown'],
      height: ['low', 'pillow', 'above_pillow', 'to_top', 'unknown'],
      division: ['whole', 'left_right', 'stacked', 'grid', 'unknown'],
      outline: ['straight', 'winged', 'curved', 'unknown'],
      relation: ['independent', 'integrated', 'wall_panel', 'unknown']
    }
  },
  soft_panel: {
    id: 'soft_panel',
    slots: {
      coverage: ['partial', 'full_wall', 'unknown'],
      grid: ['none', 'vertical', 'square', 'diamond', 'unknown'],
      relief: ['flat', 'tufted', 'channel', 'unknown'],
      edge: ['none', 'bordered', 'unknown'],
      depth: ['thin', 'proud', 'unknown']
    }
  },
  table: {
    id: 'table',
    slots: {
      height: ['low', 'table', 'unknown'],
      top: ['round', 'rect', 'irregular', 'unknown'],
      support: ['four_legs', 'pedestal', 'flush', 'unknown'],
      layers: ['single', 'multi', 'nested', 'unknown'],
      storage: ['none', 'drawers', 'unknown']
    }
  },
  cabinet: {
    id: 'cabinet',
    slots: {
      height: ['low', 'tall', 'unknown'],
      front: ['doors', 'drawers', 'open', 'mixed', 'unknown'],
      width: ['continuous', 'segmented', 'unknown'],
      base: ['flush', 'legs', 'hung', 'unknown'],
      top: ['flat', 'lip', 'unknown']
    }
  },
  floor: {
    id: 'floor',
    slots: {
      composition: ['single', 'zoned', 'unknown'],
      pattern: ['straight', 'herringbone', 'brick', 'grid', 'unknown'],
      unit: ['plank', 'regular', 'large', 'unknown'],
      level: ['flat', 'platform', 'unknown'],
      edge: ['to_wall', 'border', 'unknown']
    }
  },
  ceiling: {
    id: 'ceiling',
    slots: {
      extent: ['original', 'partial', 'full', 'unknown'],
      levels: ['single', 'stepped', 'unknown'],
      shape: ['flat', 'tray', 'recessed', 'slat', 'unknown'],
      cove: ['none', 'present', 'unknown'],
      pelmet: ['none', 'present', 'unknown']
    }
  },
  curtain: {
    id: 'curtain',
    slots: {
      kind: ['drape', 'roman', 'roller', 'blind', 'unknown'],
      opening: ['double', 'single', 'na', 'unknown'],
      layers: ['single', 'sheer_blackout', 'na', 'unknown'],
      length: ['sill', 'floor', 'na', 'unknown'],
      pleat: ['none', 'pleated', 'na', 'unknown']
    }
  },
  bedding: {
    id: 'bedding',
    slots: {
      layers: ['single', 'multi', 'unknown'],
      skirt: ['none', 'present', 'unknown'],
      pillows: ['single', 'double', 'unknown'],
      foot: ['none', 'throw', 'unknown']
    }
  },
  rug: {
    id: 'rug',
    slots: {
      shape: ['rect', 'round', 'irregular', 'unknown'],
      scale: ['small', 'seating', 'unknown'],
      edge: ['none', 'bordered', 'unknown'],
      pattern: ['plain', 'border', 'allover', 'unknown']
    }
  }
};

const SLOT_PHRASE = {
  wall: {
    opening: '洞口', symmetry: '左右', vertical: '竖向分段', construction: '主体构造', boundary: '边界'
  },
  sofa: {
    plan: '平面', seats: '座位', back: '靠背', arms: '扶手', base: '落地'
  },
  headboard: {
    width: '宽度', height: '高度', division: '分块', outline: '轮廓', relation: '与床'
  },
  soft_panel: {
    coverage: '覆盖', grid: '分格', relief: '起伏', edge: '收边', depth: '厚度'
  },
  table: {
    height: '高度', top: '平面', support: '支撑', layers: '层', storage: '储物'
  },
  cabinet: {
    height: '高度', front: '正面', width: '左右', base: '落地', top: '顶部'
  },
  floor: {
    composition: '构成', pattern: '拼法', unit: '单元', level: '高低', edge: '边界'
  },
  ceiling: {
    extent: '范围', levels: '层级', shape: '造型', cove: '灯槽', pelmet: '窗帘盒'
  },
  curtain: {
    kind: '种类', opening: '开合', layers: '层数', length: '长度', pleat: '褶'
  },
  bedding: {
    layers: '层次', skirt: '床裙', pillows: '枕排', foot: '床尾'
  },
  rug: {
    shape: '形状', scale: '尺度', edge: '边', pattern: '纹样'
  }
};

const VALUE_LABELS = {
  wall: {
    opening: { center: '居中', offset: '偏一侧', none: '无' },
    symmetry: { symmetric: '对称', asymmetric: '不对称' },
    vertical: { single: '一段', two: '上下两段', multi: '多段' },
    construction: { flat: '平板', slat: '格栅或条板', cabinet: '柜体组合', upholstered: '软硬包' },
    boundary: { to_ceiling: '到顶', below_ceiling: '不到顶', into_ceiling: '接到吊顶' }
  },
  sofa: {
    plan: { straight: '一字', chaise: '带贵妃', l: 'L 型', u: 'U 型' },
    seats: { one: '单座', two: '双座', three: '三座', multi: '多段' },
    back: { low: '低背', high: '高背' },
    arms: { both: '双侧', one: '单侧', none: '无' },
    base: { flush: '贴地', skirted: '包腿或短腿', tall_legs: '露高腿' }
  },
  headboard: {
    width: { match: '齐床', wider: '宽于床', narrower: '窄于床' },
    height: { low: '低', pillow: '及枕', above_pillow: '高过枕', to_top: '接到顶部' },
    division: { whole: '一整块', left_right: '左右分块', stacked: '上下分层', grid: '分格' },
    outline: { straight: '平直', winged: '有翼', curved: '弧形' },
    relation: { independent: '独立床头板', integrated: '与床架一体', wall_panel: '墙面软包充当' }
  },
  soft_panel: {
    coverage: { partial: '局部一块', full_wall: '整面墙' },
    grid: { none: '不分格', vertical: '竖条', square: '方格', diamond: '菱形' },
    relief: { flat: '平整', tufted: '拉扣', channel: '通道缝' },
    edge: { none: '无边', bordered: '有围边' },
    depth: { thin: '薄贴', proud: '突出墙面' }
  },
  table: {
    height: { low: '矮几', table: '桌高' },
    top: { round: '圆', rect: '方或矩', irregular: '不规则' },
    support: { four_legs: '四腿', pedestal: '中心支撑', flush: '贴地' },
    layers: { single: '单层', multi: '双层或多层', nested: '套几' },
    storage: { none: '无', drawers: '有抽屉或隔层' }
  },
  cabinet: {
    height: { low: '矮柜', tall: '高柜' },
    front: { doors: '开门', drawers: '抽屉', open: '开放格', mixed: '混合' },
    width: { continuous: '通长', segmented: '左右分段' },
    base: { flush: '贴地', legs: '有腿', hung: '挂墙' },
    top: { flat: '平顶', lip: '带挡板' }
  },
  floor: {
    composition: { single: '单一铺装', zoned: '分区铺装' },
    pattern: { straight: '直铺', herringbone: '人字或鱼骨', brick: '工字', grid: '网格' },
    unit: { plank: '细长条', regular: '常规块', large: '大板' },
    level: { flat: '平', platform: '有地台或落差' },
    edge: { to_wall: '收到墙边', border: '有波打线' }
  },
  ceiling: {
    extent: { original: '原顶', partial: '局部吊顶', full: '满吊' },
    levels: { single: '单层', stepped: '跌级' },
    shape: { flat: '平板', tray: '回型', recessed: '中心下沉', slat: '格栅' },
    cove: { none: '无', present: '有' },
    pelmet: { none: '无', present: '有' }
  },
  curtain: {
    kind: { drape: '布帘', roman: '罗马帘', roller: '卷帘', blind: '百叶' },
    opening: { double: '双开', single: '单开' },
    layers: { single: '单层', sheer_blackout: '纱帘加遮光' },
    length: { sill: '至窗台', floor: '落地' },
    pleat: { none: '无褶', pleated: '有褶' }
  },
  bedding: {
    layers: { single: '单层', multi: '多层' },
    skirt: { none: '无', present: '有' },
    pillows: { single: '单排', double: '双排' },
    foot: { none: '无', throw: '有床尾巾' }
  },
  rug: {
    shape: { rect: '矩', round: '圆', irregular: '不规则' },
    scale: { small: '局部小块', seating: '覆盖主要家具区' },
    edge: { none: '无边', bordered: '有边' },
    pattern: { plain: '素', border: '有边框', allover: '满地纹' }
  }
};

const MATERIAL_LABELS = {
  paint: '乳胶漆',
  art_coat: '艺术涂料',
  wood: '木材',
  stone: '石材',
  leather: '皮革',
  fabric: '布艺',
  metal: '金属',
  glass: '玻璃',
  unknown: '未知'
};

function grammarForRole(role) {
  const id = ROLES_WITH_GRAMMAR[role];
  return id ? GRAMMARS[id] : null;
}

function normalizeRole(role) {
  if (grammarForRole(role) || ROLES_WITHOUT_GRAMMAR.includes(role)) return role;
  return 'other';
}

function clampEnum(value, allowed) {
  return allowed.includes(value) ? value : 'unknown';
}

function normalizeCurtain(raw) {
  const spec = GRAMMARS.curtain.slots;
  const slots = {};
  for (const key of Object.keys(spec)) slots[key] = clampEnum(raw && raw[key], spec[key]);
  if (slots.kind === 'roman' || slots.kind === 'roller' || slots.kind === 'blind') {
    slots.opening = 'na';
  }
  if (slots.kind === 'roller' || slots.kind === 'blind') slots.pleat = 'na';
  if (slots.kind !== 'drape' && slots.kind !== 'unknown') slots.layers = 'na';
  if (slots.kind === 'drape' && slots.layers === 'na') slots.layers = 'unknown';
  return slots;
}

function normalizeStructure(role, raw) {
  const grammar = grammarForRole(role);
  if (!grammar) return { grammar: null, slots: {} };
  if (grammar.id === 'curtain') return { grammar: 'curtain', slots: normalizeCurtain(raw) };
  const slots = {};
  for (const [key, allowed] of Object.entries(grammar.slots)) {
    slots[key] = clampEnum(raw && raw[key], allowed);
  }
  return { grammar: grammar.id, slots };
}

function normalizeSpaceType(value) {
  const text = String(value || '').trim();
  return SPACE_TYPES.includes(text) ? text : '未知';
}

function normalizePart(value) {
  const text = String(value || '').trim();
  return PARTS.includes(text) ? text : 'other';
}

function normalizeScene(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const candidates = Array.isArray(source.candidates) ? source.candidates : [];
  return {
    spaceType: normalizeSpaceType(source.spaceType),
    colors: Array.isArray(source.colors) ? source.colors.map((c) => String(c)).filter(Boolean).slice(0, 6) : [],
    candidates: candidates.map((item, index) => ({
      id: String(item.id || `c${index + 1}`),
      nameZh: String(item.nameZh || '未命名'),
      part: normalizePart(item.part),
      role: normalizeRole(item.role),
      box: normalizeBox(item.box)
    }))
  };
}

function normalizeBox(box) {
  if (!box || typeof box !== 'object') return null;
  const nums = ['x', 'y', 'w', 'h'].map((key) => Number(box[key]));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return {
    x: clamp01(nums[0]),
    y: clamp01(nums[1]),
    w: clamp01(nums[2]),
    h: clamp01(nums[3])
  };
}

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

function centerOf(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function pointInBox(point, box) {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

function pointInPolygon(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function selectionContains(selection, box) {
  if (!selection || !box) return false;
  const center = centerOf(box);
  if (selection.kind === 'rect') return pointInBox(center, selection);
  if (selection.kind === 'polygon' && Array.isArray(selection.points) && selection.points.length >= 3) {
    return pointInPolygon(center, selection.points);
  }
  return false;
}

function candidatesInside(scene, selection) {
  const list = scene && Array.isArray(scene.candidates) ? scene.candidates : [];
  return list.filter((item) => selectionContains(selection, item.box));
}

function resolveFocus(candidates, phrase) {
  const list = Array.isArray(candidates) ? candidates : [];
  const text = String(phrase || '').trim();
  const matched = text
    ? list.filter((item) => item.nameZh && text.includes(item.nameZh))
    : [];
  matched.sort((a, b) => b.nameZh.length - a.nameZh.length);
  const longest = matched.length
    ? matched.filter((item) => item.nameZh.length === matched[0].nameZh.length)
    : [];
  const suggested = longest.length === 1 ? longest[0] : null;
  if (list.length === 1) {
    return { focus: list[0], suggestedId: list[0].id, focusConfirmed: true };
  }
  return {
    focus: null,
    suggestedId: suggested ? suggested.id : null,
    focusConfirmed: false
  };
}

function emptyReport(fid) {
  return { fid, scene: null, regions: [], updatedAt: 0 };
}

function applyScene(report, scene) {
  const next = report && report.scene
    ? {
      ...report,
      regions: (report.regions || []).map((region) => ({ ...region, status: 'stale' }))
    }
    : { ...(report || emptyReport(scene && scene.fid)), regions: report && report.regions ? report.regions : [] };
  next.scene = normalizeScene(scene);
  next.updatedAt = Date.now();
  return next;
}

function upsertRegion(report, input) {
  const regions = (report.regions || []).slice();
  const selection = input.selection;
  const inside = candidatesInside(report.scene, selection);
  const resolved = resolveFocus(inside, input.phrase);
  const chosen = input.focusId
    ? inside.find((item) => item.id === input.focusId) || null
    : resolved.focus;
  const focusConfirmed = Boolean(chosen) && (Boolean(input.focusId) || resolved.focusConfirmed);
  const role = chosen ? chosen.role : (input.role || 'other');
  const structure = focusConfirmed ? normalizeStructure(role, input.structure) : { grammar: null, slots: {} };
  const exclusions = inside
    .filter((item) => !chosen || item.id !== chosen.id)
    .map((item) => ({ id: item.id, nameZh: item.nameZh }));
  const region = {
    id: input.id || `r${regions.length + 1}`,
    selection,
    phrase: String(input.phrase || ''),
    candidates: inside,
    suggestedId: resolved.suggestedId,
    focus: chosen,
    focusConfirmed,
    structure,
    material: normalizeMaterial(input.material),
    color: input.color ? { label: String(input.color.label || input.color.hex || '') } : null,
    colorIntent: INTENTS.includes(input.colorIntent) ? input.colorIntent : 'unset',
    materialIntent: INTENTS.includes(input.materialIntent) ? input.materialIntent : 'unset',
    exclusions,
    status: 'ready'
  };
  const index = regions.findIndex((item) => item.id === region.id);
  if (index >= 0) regions[index] = region;
  else regions.push(region);
  return { ...report, regions, updatedAt: Date.now() };
}

function normalizeMaterial(material) {
  if (!material || typeof material !== 'object') return null;
  const family = Object.prototype.hasOwnProperty.call(MATERIAL_LABELS, material.family) ? material.family : 'unknown';
  return { family, labelZh: MATERIAL_LABELS[family] };
}

function markSelectionChanged(report, regionId) {
  return {
    ...report,
    regions: (report.regions || []).map((region) => (
      region.id === regionId ? { ...region, status: 'stale', focusConfirmed: false } : region
    )),
    updatedAt: Date.now()
  };
}

function compileDraft(region) {
  if (!region || region.status === 'stale') return { ok: false, reason: 'stale' };
  if (!region.focusConfirmed || !region.focus) return { ok: false, reason: 'unconfirmed' };
  const bits = [];
  const grammarId = region.structure && region.structure.grammar;
  const phrases = SLOT_PHRASE[grammarId] || {};
  const valueLabels = VALUE_LABELS[grammarId] || {};
  const slots = (region.structure && region.structure.slots) || {};
  for (const [key, title] of Object.entries(phrases)) {
    const value = slots[key];
    if (!value || value === 'unknown' || value === 'na') continue;
    const label = (valueLabels[key] && valueLabels[key][value]) || value;
    bits.push(`${title}${label}`);
  }
  let text = `在@图1的框选区域，处理${region.focus.nameZh}`;
  if (bits.length) text += `，结构为${bits.join('，')}`;
  text += '。';
  if (region.materialIntent === 'keep' && region.material && region.material.family !== 'unknown') {
    text += `材质沿用${region.material.labelZh}。`;
  } else if (region.materialIntent === 'follow_target') {
    text += '材质跟随@图2。';
  }
  if (region.colorIntent === 'keep' && region.color && region.color.label) {
    text += `颜色沿用${region.color.label}。`;
  } else if (region.colorIntent === 'follow_target') {
    text += '颜色跟随@图2。';
  }
  const names = (region.exclusions || []).map((item) => item.nameZh).filter(Boolean);
  if (names.length) text += `不要改动${names.join('、')}。`;
  text += '框外画面保持原图像素。';
  return { ok: true, text };
}

function selectionToRegion(selection) {
  if (!selection) return null;
  if (selection.kind === 'rect') {
    const x = selection.x * 100;
    const y = selection.y * 100;
    const r = (selection.x + selection.w) * 100;
    const b = (selection.y + selection.h) * 100;
    return {
      id: 'analysis-box',
      type: 'polygon',
      pctPoints: [
        { x, y },
        { x: r, y },
        { x: r, y: b },
        { x, y: b }
      ]
    };
  }
  if (selection.kind === 'polygon' && Array.isArray(selection.points)) {
    return {
      id: 'analysis-box',
      type: 'polygon',
      pctPoints: selection.points.map((point) => ({ x: point.x * 100, y: point.y * 100 }))
    };
  }
  return null;
}

module.exports = {
  SPACE_TYPES,
  PARTS,
  GRAMMARS,
  MATERIAL_LABELS,
  grammarForRole,
  normalizeStructure,
  normalizeScene,
  candidatesInside,
  resolveFocus,
  emptyReport,
  applyScene,
  upsertRegion,
  markSelectionChanged,
  compileDraft,
  selectionToRegion
};
