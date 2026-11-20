/**
 * 风格方案页的横条和列表。
 * 横条来自全部精细风格，再补上不在风格表里的旧方案分组。
 * 一个方案是一个单元格，格内按使用面竖向并排材质。
 */

// 木纹标签（与 wood-taxonomy.js 的 *_LABELS 保持一致；此处内置以兼容
// Vite 生产构建对 root 外 CJS 模块不做命名导出转换的限制）
const WOOD_SPECIES_LABELS = {
  walnut: '胡桃木', white_oak: '白橡木', red_oak: '红橡木', ash: '白蜡木', cherry: '樱桃木',
  teak: '柚木', maple: '枫木', pine: '松木', rosewood: '玫瑰木', sapele: '沙比利',
  mahogany: '桃花心木', ebony: '黑檀', wenge: '鸡翅木', bamboo: '竹木', elm: '榆木',
  birch: '桦木', beech: '榉木', cedar: '杉木', olive: '橄榄木', okoume: '奥古曼',
  engineered: '工程木', mixed: '混拼木'
};
const WOOD_TONE_LABELS = { light: '浅色', medium: '中色', dark: '深色' };
const GRAIN_TYPE_LABELS = {
  straight: '直纹', cathedral: '山纹', crossed: '交错', wavy: '波浪',
  ripple: '水波纹', ribbon: '丝带', knot: '结疤', distressed: '做旧'
};
const WOOD_LAYOUT_LABELS = {
  plain: '平板', wide_plank: '宽板', narrow_plank: '窄板', herringbone: '人字拼',
  chevron: '鱼骨拼', parquet: '拼花', block: '方块'
};
const SURFACE_FINISH_LABELS = {
  matte: '哑光', satin: '缎面', semi_gloss: '半亮', gloss: '亮光',
  textured: '肌理', wire_brushed: '拉丝', oiled: '木蜡油', distressed: '做旧'
};

const STRIP_ORDER = ['wall', 'ceiling', 'floor', 'soft', 'millwork', 'counter', 'metal', 'furniture'];

function woodBadges(slot = {}) {
  if (slot.kind_key !== 'wood') return [];
  const bits = [];
  if (slot.wood_species) bits.push(WOOD_SPECIES_LABELS[slot.wood_species] || slot.wood_species);
  if (slot.grain_type) bits.push(GRAIN_TYPE_LABELS[slot.grain_type] || slot.grain_type);
  if (slot.wood_layout && slot.wood_layout !== 'plain') {
    bits.push(WOOD_LAYOUT_LABELS[slot.wood_layout] || slot.wood_layout);
  }
  if (slot.surface_finish && slot.surface_finish !== 'matte') {
    bits.push(SURFACE_FINISH_LABELS[slot.surface_finish] || slot.surface_finish);
  }
  if (slot.wood_tone) bits.push(WOOD_TONE_LABELS[slot.wood_tone] || slot.wood_tone);
  return [...new Set(bits)];
}

function stripLabel(slot) {
  if (slot?.surface_label) return slot.surface_label;
  const labels = {
    wall: '墙面',
    ceiling: '天花',
    floor: '地面',
    soft: '软装',
    millwork: '全屋定制',
    counter: '台面',
    metal: '金属',
    furniture: '家具'
  };
  return labels[slot?.surface] || slot?.surface || '材质';
}

function schemeStrips(scheme) {
  const ranked = [...(scheme.slots || [])].sort((a, b) => {
    const ia = STRIP_ORDER.indexOf(a.surface);
    const ib = STRIP_ORDER.indexOf(b.surface);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const strips = [];
  const seen = new Set();
  for (const slot of ranked) {
    const surface = slot?.surface || slot?.surface_label || 'other';
    if (!slot?.item_id || seen.has(surface)) continue;
    if (!slot.preview_rel && !slot.hex) continue;
    seen.add(surface);
    strips.push({
      id: slot.item_id,
      item_id: slot.item_id,
      name_zh: slot.name_zh || slot.item_id,
      prompt_name: slot.prompt_name || slot.name_zh || '',
      preview_rel: slot.preview_rel || '',
      hex: slot.hex || '',
      brand: slot.brand || '',
      surface: slot.surface || '',
      surface_label: stripLabel(slot),
      kind_key: slot.kind_key || '',
      wood_species: slot.wood_species || '',
      wood_tone: slot.wood_tone || '',
      grain_type: slot.grain_type || '',
      wood_layout: slot.wood_layout || '',
      surface_finish: slot.surface_finish || '',
      wood_badges: woodBadges(slot)
    });
  }
  return strips;
}
export function buildSchemeBrowse({ styles = [], schemes = [], leaf = '', pick = '' } = {}) {
  const tabs = [];
  const seen = new Set();
  const sortedStyles = [...styles].sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0));
  for (const style of sortedStyles) {
    const key = String(style.id || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tabs.push({
      key,
      label: style.name_zh || key,
      count: Number(style.scheme_count) || 0
    });
  }
  for (const scheme of schemes) {
    const key = String(scheme.style_id || scheme.style_leaf || 'ungrouped');
    if (seen.has(key)) continue;
    seen.add(key);
    const count = schemes.filter((row) => String(row.style_id || row.style_leaf || 'ungrouped') === key).length;
    tabs.push({
      key,
      label: scheme.style_name || scheme.style_leaf || key,
      count
    });
  }
  for (const tab of tabs) {
    if (tab.count) continue;
    tab.count = schemes.filter((row) => String(row.style_id || row.style_leaf || 'ungrouped') === tab.key).length;
  }

  const active = tabs.some((tab) => tab.key === leaf) ? leaf : (tabs[0]?.key || '');
  const kits = schemes.filter((scheme) => String(scheme.style_id || scheme.style_leaf || 'ungrouped') === active);
  const matched = pick ? kits.filter((scheme) => scheme.id === pick) : kits;
  const cards = matched.map((scheme) => {
    const strips = schemeStrips(scheme);
    return {
      id: scheme.id,
      name_zh: scheme.name_zh || scheme.id,
      brand: strips.find((strip) => strip.brand)?.brand || '',
      lead_hex: strips.find((strip) => strip.hex)?.hex || '',
      summary: strips.map((strip) => strip.name_zh).filter(Boolean).join(' · '),
      strips
    };
  });
  return {
    tabs,
    active,
    kits,
    cards,
    empty: matched.length === 0
  };
}
