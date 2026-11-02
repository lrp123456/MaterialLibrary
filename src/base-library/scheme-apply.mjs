/**
 * 把一套风格方案的槽位写到已有表面选区。
 * 名称优先于模型识别：用户把选区叫做「墙面」时，按墙面槽位填充。
 */

const NAME_RULES = [
  { re: /台面/, surface: 'counter' },
  { re: /金属|五金|拉手/, surface: 'metal' },
  { re: /天花|吊顶|顶面/, surface: 'ceiling' },
  { re: /地面|地板|地砖/, surface: 'floor' },
  { re: /木作|柜门|定制/, surface: 'millwork' },
  { re: /墙/, surface: 'wall' },
  { re: /沙发/, surface: 'soft', role: 'sofa' },
  { re: /窗帘|窗纱/, surface: 'soft', role: 'curtain' },
  { re: /地毯/, surface: 'soft', role: 'rug' },
  { re: /床/, surface: 'soft', role: 'bed' },
  { re: /餐椅|座椅|椅子|椅/, surface: 'soft', role: 'chair' },
  { re: /软装/, surface: 'soft' }
];

const INFERRED_MAP = {
  ceiling: 'ceiling',
  wall: 'wall',
  floor: 'floor',
  millwork: 'millwork',
  counter: 'counter',
  metal: 'metal',
  soft: 'soft',
  furniture: 'soft',
  fixture: 'metal'
};

const LOCKED_OPS = new Set(['replace', 'add', 'erase', 'blank']);

function roleFromName(name, surface) {
  if (surface === 'wall' && /强调|点缀/.test(name)) return 'accent';
  if (surface !== 'soft') return null;
  if (/沙发/.test(name)) return 'sofa';
  if (/窗帘|窗纱/.test(name)) return 'curtain';
  if (/地毯/.test(name)) return 'rug';
  if (/床/.test(name)) return 'bed';
  if (/餐椅|座椅|椅子|椅/.test(name)) return 'chair';
  return null;
}

export function detectRegionTarget(region) {
  const name = String(region?.name || '');
  const named = NAME_RULES.find((rule) => rule.re.test(name));
  if (named) {
    return {
      surface: named.surface,
      role: named.role || roleFromName(name, named.surface)
    };
  }
  const explicit = region?.inferredSurface || region?.params?.baseAttr?.surface || region?.params?.surface || '';
  const surface = INFERRED_MAP[explicit];
  if (!surface) return null;
  return { surface, role: roleFromName(name, surface) };
}

export function pickSchemeSlot(slots, { surface, role, spaceKey }) {
  const list = (slots || []).filter((slot) => {
    if (slot.surface !== surface) return false;
    const space = slot.space_key || 'any';
    return space === 'any' || space === spaceKey;
  });
  const score = (slot) => {
    let n = 0;
    if (spaceKey && slot.space_key === spaceKey) n += 4;
    if (role && slot.role === role) n += 8;
    if (!role && (slot.role === 'base' || slot.role === 'any')) n += 3;
    return n;
  };
  const ranked = [...list].sort((a, b) => score(b) - score(a));
  if (!ranked.length) return null;
  if (role) {
    const exact = ranked.find((slot) => slot.role === role);
    if (exact) return exact;
    if (surface === 'soft') return null;
    return ranked.find((slot) => slot.role === 'base' || slot.role === 'any') || null;
  }
  return ranked.find((slot) => slot.role === 'base' || slot.role === 'any') || null;
}

export function subclassForSlot(slot) {
  const kind = slot?.kind_key || '';
  const surface = slot?.surface;
  if (surface === 'wall') {
    if (kind === 'latex') return 'wall_paint';
    if (kind === 'wallpaper') return 'wall_paper';
    if (kind === 'wallcloth') return 'wall_cloth';
    if (kind === 'tile' || kind === 'stone') return 'wall_tile';
    return 'wall_paneling';
  }
  if (surface === 'ceiling') return kind === 'latex' ? 'ceiling_paint' : 'ceiling_panel';
  if (surface === 'floor') {
    if (kind === 'wood') return 'floor_wood';
    if (kind === 'fabric') return 'floor_carpet';
    return 'floor_stone';
  }
  if (surface === 'counter') return 'millwork_top';
  if (surface === 'millwork') return 'millwork_door';
  if (surface === 'metal') return 'fixture';
  if (surface === 'soft') return 'soft_fabric';
  return '';
}

function finishOf(slot) {
  if (slot?.gloss === 'gloss' || slot?.gloss === 'high_gloss') return 'gloss';
  if (slot?.gloss === 'satin' || slot?.gloss === 'semi_gloss') return 'satin';
  return 'matte';
}

export function mapSchemeToRegions(regions, scheme, { spaceKey = 'living', previewUrl } = {}) {
  const applied = [];
  const skipped = [];
  const slots = scheme?.slots || [];
  const next = (regions || []).map((region) => {
    if (LOCKED_OPS.has(region?.op)) {
      skipped.push({ id: region.id, name: region.name || '', reason: '该选区已有替换、增加、消除或留白操作' });
      return region;
    }
    const target = detectRegionTarget(region);
    if (!target) {
      skipped.push({ id: region.id, name: region.name || '', reason: '未识别表面' });
      return region;
    }
    const slot = pickSchemeSlot(slots, { ...target, spaceKey });
    if (!slot?.item_id) {
      skipped.push({
        id: region.id,
        name: region.name || '',
        reason: '方案没有对应槽位'
      });
      return region;
    }
    const params = { ...(region.params || {}) };
    const materialName = slot.name_zh || slot.prompt_name || '';
    params.materialName = materialName;
    if (slot.hex) params.colorHex = slot.hex;
    if (slot.preview_rel) {
      params.materialTextureUrl = typeof previewUrl === 'function'
        ? previewUrl(slot)
        : `/api/base-library/items/${encodeURIComponent(slot.item_id)}/preview`;
      params.materialTextureName = materialName;
    } else if (String(params.materialTextureUrl || '').endsWith('.svg')) {
      params.materialTextureUrl = null;
    }
    const partMap = {
      ceiling: 'ceiling',
      wall: 'wall',
      floor: 'floor',
      counter: 'millwork',
      millwork: 'millwork',
      metal: 'hard_furniture',
      soft: (slot.role === 'rug') ? 'rug' : (slot.role === 'curtain' || slot.role === 'bed') ? 'curtain_bedding' : 'upholstery'
    };
    const part = partMap[slot.surface] || 'wall';

    params.item_id = slot.item_id;
    params.surface = slot.surface;
    params.part = part;
    params.mode = 'recolor';
    params.baseAttr = {
      part,
      mode: 'recolor',
      surface: slot.surface,
      subclass: subclassForSlot(slot),
      warehouse: 'base_item',
      asset_id: null,
      item_id: slot.item_id,
      use_shell: false,
      hex: slot.hex || null,
      finish: finishOf(slot),
      roughness: typeof params.baseAttr?.roughness === 'number' ? params.baseAttr.roughness : 15
    };
    applied.push({
      id: region.id,
      name: region.name || '',
      surface: slot.surface,
      role: slot.role,
      item_id: slot.item_id,
      materialName
    });
    return { ...region, op: 'recolor', params };
  });
  return { regions: next, applied, skipped };
}
