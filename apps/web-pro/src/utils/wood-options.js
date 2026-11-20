export const WOOD_SPECIES_OPTION = {
  walnut: '胡桃木', white_oak: '白橡木', red_oak: '红橡木', ash: '白蜡木', cherry: '樱桃木',
  teak: '柚木', maple: '枫木', pine: '松木', rosewood: '玫瑰木', sapele: '沙比利',
  mahogany: '桃花心木', ebony: '黑檀', wenge: '鸡翅木', bamboo: '竹木', elm: '榆木',
  birch: '桦木', beech: '榉木', cedar: '杉木', olive: '橄榄木', okoume: '奥古曼',
  engineered: '工程木', mixed: '混拼木'
};

export const WOOD_GRAIN_OPTION = {
  straight: '直纹', cathedral: '山纹', crossed: '交错', wavy: '波浪',
  ripple: '水波纹', ribbon: '丝带', knot: '结疤', distressed: '做旧'
};

export const WOOD_LAYOUT_OPTION = {
  wide_plank: '宽板', narrow_plank: '窄板', herringbone: '人字拼',
  chevron: '鱼骨拼', parquet: '拼花', block: '方块'
};

export function itemWoodSuffix(item) {
  if (!item || item.kind_key !== 'wood') return '';
  const bits = [];
  if (item.wood_species) bits.push(WOOD_SPECIES_OPTION[item.wood_species] || item.wood_species);
  if (item.grain_type) bits.push(WOOD_GRAIN_OPTION[item.grain_type] || item.grain_type);
  if (item.wood_layout && item.wood_layout !== 'plain') {
    bits.push(WOOD_LAYOUT_OPTION[item.wood_layout] || item.wood_layout);
  }
  return bits.slice(0, 3).join('/');
}

export const parentStyles = [
  { key: 'wabi_sabi', label: '侘寂' }, { key: 'song_aesthetic', label: '宋式美学' },
  { key: 'neo_chinese', label: '新中式' }, { key: 'classical_chinese', label: '古典中式' },
  { key: 'french', label: '法式' }, { key: 'italian', label: '意式' },
  { key: 'mediterranean', label: '地中海' }, { key: 'tuscan', label: '托斯卡纳' },
  { key: 'modern_minimal', label: '现代极简' }, { key: 'cream_style', label: '奶油风' },
  { key: 'mid_century', label: '中古风' }, { key: 'industrial', label: '工业风' },
  { key: 'american_modern', label: '现代美式' }, { key: 'american_country', label: '美式乡村' },
  { key: 'nanyang_resort', label: '南洋度假' },
  { key: 'natural_wood', label: '自然原木' }, { key: 'dark_wood', label: '深色原木' },
  { key: 'natural_vintage_wood', label: '自然复古原木' }, { key: 'dark_vintage_wood', label: '深色复古原木' },
  { key: 'other', label: '其他风格' }
];

export const SLOT_GROUPS = [
  { key: 'base', label: '基础表面', rows: [
    { key: 'any:wall:base', space_key: 'any', surface: 'wall', role: 'base', roleLabel: '墙面基底', surfaceLabel: 'wall' },
    { key: 'any:ceiling:base', space_key: 'any', surface: 'ceiling', role: 'base', roleLabel: '顶面', surfaceLabel: 'ceiling' },
    { key: 'any:floor:any', space_key: 'any', surface: 'floor', role: 'any', roleLabel: '地面', surfaceLabel: 'floor' },
    { key: 'any:millwork:any', space_key: 'any', surface: 'millwork', role: 'any', roleLabel: '木作', surfaceLabel: 'millwork' },
    { key: 'any:metal:any', space_key: 'any', surface: 'metal', role: 'any', roleLabel: '金属饰面', surfaceLabel: 'metal' },
    { key: 'any:counter:any', space_key: 'any', surface: 'counter', role: 'any', roleLabel: '台面/石材', surfaceLabel: 'counter' }
  ]},
  { key: 'living', label: '软装 · 客厅', rows: [
    { key: 'living:soft:sofa', space_key: 'living', surface: 'soft', role: 'sofa', roleLabel: '沙发', surfaceLabel: 'soft' },
    { key: 'living:soft:curtain', space_key: 'living', surface: 'soft', role: 'curtain', roleLabel: '窗帘', surfaceLabel: 'soft' },
    { key: 'living:soft:rug', space_key: 'living', surface: 'soft', role: 'rug', roleLabel: '地毯', surfaceLabel: 'soft' }
  ]},
  { key: 'bedroom', label: '软装 · 卧室', rows: [
    { key: 'bedroom:soft:bed', space_key: 'bedroom', surface: 'soft', role: 'bed', roleLabel: '床/软包', surfaceLabel: 'soft' },
    { key: 'bedroom:soft:curtain', space_key: 'bedroom', surface: 'soft', role: 'curtain', roleLabel: '窗帘', surfaceLabel: 'soft' },
    { key: 'bedroom:soft:rug', space_key: 'bedroom', surface: 'soft', role: 'rug', roleLabel: '地毯', surfaceLabel: 'soft' }
  ]},
  { key: 'dining', label: '软装 · 餐厅', rows: [
    { key: 'dining:soft:chair', space_key: 'dining', surface: 'soft', role: 'chair', roleLabel: '餐椅', surfaceLabel: 'soft' },
    { key: 'dining:soft:table', space_key: 'dining', surface: 'soft', role: 'table', roleLabel: '餐桌', surfaceLabel: 'soft' }
  ]}
];
