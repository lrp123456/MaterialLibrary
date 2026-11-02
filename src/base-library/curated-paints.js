/**
 * 策展色卡：精选 9 大室内设计色系，每系 7~8 款落地色，按 LRV 严格降序排列。
 * display_name 为人工设计师命名，杜绝机械“暖调/冷调”前后缀。
 */

const PAINT_FAMILIES = [
  { key: 'warm_white', label: '暖白', desc: 'LRV 90–75，墙顶空间纯净基底' },
  { key: 'cream', label: '奶油', desc: 'LRV 85–65，温润柔和奶油调' },
  { key: 'ivory', label: '象牙', desc: 'LRV 82–60，微暖高贵象牙色' },
  { key: 'greige', label: '原麻灰米', desc: 'LRV 70–40，亚麻与灰米平衡' },
  { key: 'earth', label: '大地侘寂', desc: 'LRV 55–25，驼、陶土、卡其矿物色' },
  { key: 'cool_gray', label: '现代冷灰', desc: 'LRV 75–20，极简高级冷蓝灰' },
  { key: 'morandi', label: '莫兰迪', desc: 'LRV 60–30，低饱和柔和彩色' },
  { key: 'caramel', label: '焦糖', desc: 'LRV 45–15，木质与皮具染色' },
  { key: 'ink', label: '静谧深色', desc: 'LRV ≤ 25，深邃质感收口色' }
];

const CURATED_PAINTS = [
  // 1. warm_white 暖白 (LRV 90–75)
  {
    brand: 'nippon-paint',
    code: 'NN0001-4',
    name_en: 'Alpine Snow',
    display_name: '雪域白',
    family_key: 'warm_white',
    hex: '#F7F6F2',
    lrv: 88,
    role_hint: 'base'
  },
  {
    brand: 'nippon-paint',
    code: 'OW038-4',
    name_en: 'Pearl White',
    display_name: '珍珠白',
    family_key: 'warm_white',
    hex: '#F4F1EA',
    lrv: 82,
    role_hint: 'base'
  },
  {
    brand: 'dulux',
    code: '30YY 72/018',
    name_en: 'Alabaster White',
    display_name: '雪花石白',
    family_key: 'warm_white',
    hex: '#F3EFE6',
    lrv: 80,
    role_hint: 'base'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0002-4',
    name_en: 'Water Lily',
    display_name: '菱花白',
    family_key: 'warm_white',
    hex: '#F1EDE4',
    lrv: 78,
    role_hint: 'base'
  },
  {
    brand: 'dulux',
    code: '40YY 73/028',
    name_en: 'Calico',
    display_name: '细棉白',
    family_key: 'warm_white',
    hex: '#EFEBE1',
    lrv: 77,
    role_hint: 'base'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0037-4',
    name_en: 'Misty Cloud',
    display_name: '云雾白',
    family_key: 'warm_white',
    hex: '#EEEAE0',
    lrv: 76,
    role_hint: 'base'
  },
  {
    brand: 'dulux',
    code: '50YY 74/033',
    name_en: 'Chalk Dust',
    display_name: '浅垩白',
    family_key: 'warm_white',
    hex: '#ECE7DC',
    lrv: 75,
    role_hint: 'base'
  },

  // 2. cream 奶油 (LRV 85–65)
  {
    brand: 'nippon-paint',
    code: 'NN0107-4',
    name_en: 'Cream Apricot',
    display_name: '奶油杏',
    family_key: 'cream',
    hex: '#F3E6D4',
    lrv: 78,
    role_hint: 'base'
  },
  {
    brand: 'dulux',
    code: '35YY 68/112',
    name_en: 'Oat Milk',
    display_name: '燕麦奶',
    family_key: 'cream',
    hex: '#EEE0CD',
    lrv: 74,
    role_hint: 'base'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0907-4',
    name_en: 'Soft Custard',
    display_name: '软卡仕达',
    family_key: 'cream',
    hex: '#EAD9C4',
    lrv: 71,
    role_hint: 'base'
  },
  {
    brand: 'dulux',
    code: '30YY 64/120',
    name_en: 'Shortbread',
    display_name: '黄油酥饼',
    family_key: 'cream',
    hex: '#E6D4BD',
    lrv: 68,
    role_hint: 'both'
  },
  {
    brand: 'nippon-paint',
    code: 'NN1950-4',
    name_en: 'Light Latte',
    display_name: '淡奶咖',
    family_key: 'cream',
    hex: '#E2CEB4',
    lrv: 66,
    role_hint: 'both'
  },
  {
    brand: 'dulux',
    code: '20YY 60/104',
    name_en: 'Vanilla Cloud',
    display_name: '香草舒芙蕾',
    family_key: 'cream',
    hex: '#DFCBAC',
    lrv: 65,
    role_hint: 'both'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0208-4',
    name_en: 'Warm Sand Dune',
    display_name: '暖沙丘',
    family_key: 'cream',
    hex: '#DCC5A8',
    lrv: 63,
    role_hint: 'both'
  },

  // 3. ivory 象牙 (LRV 82–60)
  {
    brand: 'nippon-paint',
    code: 'NN0020-4',
    name_en: 'Classic Ivory',
    display_name: '经典象牙',
    family_key: 'ivory',
    hex: '#EDE8DE',
    lrv: 78,
    role_hint: 'base'
  },
  {
    brand: 'dulux',
    code: '45YY 71/067',
    name_en: 'Antique Ivory',
    display_name: '古董象牙',
    family_key: 'ivory',
    hex: '#E9E3D6',
    lrv: 74,
    role_hint: 'base'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0028-4',
    name_en: 'Rice Paper',
    display_name: '米象牙',
    family_key: 'ivory',
    hex: '#E4DEC0',
    lrv: 71,
    role_hint: 'base'
  },
  {
    brand: 'dulux',
    code: '38YY 65/080',
    name_en: 'Ivory Lace',
    display_name: '象牙蕾丝',
    family_key: 'ivory',
    hex: '#DFD8CC',
    lrv: 67,
    role_hint: 'both'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0035-4',
    name_en: 'Bleached Bone',
    display_name: '素净骨瓷',
    family_key: 'ivory',
    hex: '#D8D1C4',
    lrv: 64,
    role_hint: 'both'
  },
  {
    brand: 'dulux',
    code: '40YY 58/086',
    name_en: 'Vintage Linen',
    display_name: '典雅米白',
    family_key: 'ivory',
    hex: '#D3CCBF',
    lrv: 61,
    role_hint: 'both'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0042-4',
    name_en: 'Warm Parchment',
    display_name: '羊皮纸米',
    family_key: 'ivory',
    hex: '#CEC7BA',
    lrv: 59,
    role_hint: 'both'
  },

  // 4. greige 原麻灰米 (LRV 70–40)
  {
    brand: 'dulux',
    code: '30YY 56/060',
    name_en: 'Natural Hessian',
    display_name: '原麻',
    family_key: 'greige',
    hex: '#CDC8C1',
    lrv: 58,
    role_hint: 'both'
  },
  {
    brand: 'nippon-paint',
    code: 'NN2034-4',
    name_en: 'Abacadabra',
    display_name: '亚麻灰',
    family_key: 'greige',
    hex: '#C8C3BA',
    lrv: 55,
    role_hint: 'both'
  },
  {
    brand: 'dulux',
    code: '20YY 51/078',
    name_en: 'Mushroom Cap',
    display_name: '灰米',
    family_key: 'greige',
    hex: '#C3BCB2',
    lrv: 52,
    role_hint: 'both'
  },
  {
    brand: 'nippon-paint',
    code: 'NN2650-4',
    name_en: 'Fossil Gray',
    display_name: '化石灰米',
    family_key: 'greige',
    hex: '#BDB6AB',
    lrv: 49,
    role_hint: 'both'
  },
  {
    brand: 'dulux',
    code: '10YY 44/072',
    name_en: 'Pebble Walk',
    display_name: '原石漫道',
    family_key: 'greige',
    hex: '#B6AEA3',
    lrv: 46,
    role_hint: 'both'
  },
  {
    brand: 'nippon-paint',
    code: 'NN2660-4',
    name_en: 'Stone Harbor',
    display_name: '岩灰米',
    family_key: 'greige',
    hex: '#AEA59A',
    lrv: 43,
    role_hint: 'both'
  },
  {
    brand: 'dulux',
    code: '00YY 38/065',
    name_en: 'Dappled Gray',
    display_name: '素木灰米',
    family_key: 'greige',
    hex: '#A69D92',
    lrv: 40,
    role_hint: 'both'
  },

  // 5. earth 大地侘寂 (LRV 55–25)
  {
    brand: 'nippon-paint',
    code: 'NN3910-4',
    name_en: 'Desert Camel',
    display_name: '浅驼',
    family_key: 'earth',
    hex: '#B8A48D',
    lrv: 48,
    role_hint: 'both'
  },
  {
    brand: 'dulux',
    code: '20YY 38/155',
    name_en: 'Warm Clay',
    display_name: '暖陶土',
    family_key: 'earth',
    hex: '#AF9980',
    lrv: 42,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN3920-4',
    name_en: 'Wabi Khaki',
    display_name: '侘寂卡其',
    family_key: 'earth',
    hex: '#A58E74',
    lrv: 37,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '10YY 30/106',
    name_en: 'Baked Earth',
    display_name: '红陶土',
    family_key: 'earth',
    hex: '#9C8368',
    lrv: 33,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN3950-4',
    name_en: 'Roasted Tea',
    display_name: '焦茶',
    family_key: 'earth',
    hex: '#92785D',
    lrv: 29,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '05YY 24/090',
    name_en: 'Deep Umber',
    display_name: '深赭石',
    family_key: 'earth',
    hex: '#876D52',
    lrv: 26,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN3970-4',
    name_en: 'Mineral Bark',
    display_name: '矿物古木',
    family_key: 'earth',
    hex: '#7D6348',
    lrv: 24,
    role_hint: 'accent'
  },

  // 6. cool_gray 现代冷灰 (LRV 75–20)
  {
    brand: 'nippon-paint',
    code: 'NN0004-4',
    name_en: 'Silver Cloud',
    display_name: '云灰',
    family_key: 'cool_gray',
    hex: '#DFE2E4',
    lrv: 73,
    role_hint: 'base'
  },
  {
    brand: 'dulux',
    code: '50BG 64/028',
    name_en: 'Morning Mist',
    display_name: '朝雾灰',
    family_key: 'cool_gray',
    hex: '#CCD2D5',
    lrv: 62,
    role_hint: 'both'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0070-4',
    name_en: 'Space Walk',
    display_name: '太空漫步',
    family_key: 'cool_gray',
    hex: '#B8BCBF',
    lrv: 48,
    role_hint: 'both'
  },
  {
    brand: 'dulux',
    code: '30BB 47/019',
    name_en: 'Muted Harbor',
    display_name: '静音灰',
    family_key: 'cool_gray',
    hex: '#A7ADB1',
    lrv: 41,
    role_hint: 'both'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0080-4',
    name_en: 'Cast Iron',
    display_name: '精铸灰',
    family_key: 'cool_gray',
    hex: '#939AA0',
    lrv: 33,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '30BB 31/024',
    name_en: 'Slate Shadow',
    display_name: '岩板暗灰',
    family_key: 'cool_gray',
    hex: '#7E858B',
    lrv: 26,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0090-4',
    name_en: 'Deep Graphite',
    display_name: '深石墨灰',
    family_key: 'cool_gray',
    hex: '#6B7177',
    lrv: 20,
    role_hint: 'accent'
  },

  // 7. morandi 莫兰迪 (LRV 60–30)
  {
    brand: 'nippon-paint',
    code: 'NN6510-4',
    name_en: 'Sage Green',
    display_name: '鼠尾草',
    family_key: 'morandi',
    hex: '#B5C4B7',
    lrv: 50,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '10GG 48/098',
    name_en: 'Olive Mist',
    display_name: '橄榄雾',
    family_key: 'morandi',
    hex: '#AAB8AC',
    lrv: 46,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN7810-4',
    name_en: 'Dusty Pink',
    display_name: '灰粉',
    family_key: 'morandi',
    hex: '#CAB3B5',
    lrv: 44,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '50BG 40/074',
    name_en: 'Mist Blue',
    display_name: '雾蓝',
    family_key: 'morandi',
    hex: '#9EB0B7',
    lrv: 41,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN6820-4',
    name_en: 'Eucalyptus',
    display_name: '尤加利',
    family_key: 'morandi',
    hex: '#96A699',
    lrv: 37,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '70RR 32/085',
    name_en: 'Vintage Rose',
    display_name: '干枯玫瑰',
    family_key: 'morandi',
    hex: '#B1979A',
    lrv: 33,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN5220-4',
    name_en: 'Smoky Teal',
    display_name: '烟蓝绿',
    family_key: 'morandi',
    hex: '#84969A',
    lrv: 30,
    role_hint: 'accent'
  },

  // 8. caramel 焦糖 (LRV 45–15)
  {
    brand: 'nippon-paint',
    code: 'NN3410-4',
    name_en: 'Warm Latte',
    display_name: '奶咖',
    family_key: 'caramel',
    hex: '#AFA08C',
    lrv: 43,
    role_hint: 'both'
  },
  {
    brand: 'dulux',
    code: '20YY 32/178',
    name_en: 'Toffee Crunch',
    display_name: '太妃糖',
    family_key: 'caramel',
    hex: '#A38B6E',
    lrv: 36,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN3420-4',
    name_en: 'Classic Caramel',
    display_name: '焦糖',
    family_key: 'caramel',
    hex: '#967856',
    lrv: 30,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '10YY 24/180',
    name_en: 'Warm Amber',
    display_name: '琥珀棕',
    family_key: 'caramel',
    hex: '#8C6C47',
    lrv: 25,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN3450-4',
    name_en: 'Walnut Shell',
    display_name: '胡桃棕',
    family_key: 'caramel',
    hex: '#7A5B39',
    lrv: 20,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '08YY 17/160',
    name_en: 'Smoked Chestnut',
    display_name: '烟熏栗色',
    family_key: 'caramel',
    hex: '#6A4D2F',
    lrv: 16,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN3470-4',
    name_en: 'Dark Espresso',
    display_name: '浓缩咖啡',
    family_key: 'caramel',
    hex: '#5A3F24',
    lrv: 14,
    role_hint: 'accent'
  },

  // 9. ink 静谧深色 (LRV ≤ 25)
  {
    brand: 'nippon-paint',
    code: 'NN6150-4',
    name_en: 'Forest Pine',
    display_name: '墨绿',
    family_key: 'ink',
    hex: '#3E4D43',
    lrv: 22,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '90BG 17/090',
    name_en: 'Midnight Ocean',
    display_name: '夜蓝',
    family_key: 'ink',
    hex: '#344550',
    lrv: 18,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN7450-4',
    name_en: 'Black Plum',
    display_name: '玄黑乌木',
    family_key: 'ink',
    hex: '#363438',
    lrv: 15,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '50RR 08/038',
    name_en: 'Smoked Charcoal',
    display_name: '炭黑',
    family_key: 'ink',
    hex: '#2B2B2D',
    lrv: 11,
    role_hint: 'accent'
  },
  {
    brand: 'nippon-paint',
    code: 'NN0099-4',
    name_en: 'Deep Obsidian',
    display_name: '黑曜石',
    family_key: 'ink',
    hex: '#222325',
    lrv: 8,
    role_hint: 'accent'
  },
  {
    brand: 'dulux',
    code: '00NN 05/000',
    name_en: 'Abyssal Black',
    display_name: '极夜纯黑',
    family_key: 'ink',
    hex: '#18191B',
    lrv: 5,
    role_hint: 'accent'
  }
];

// 补充统一生成的唯一 ID 与来源 URL
CURATED_PAINTS.forEach((p) => {
  p.id = `paint_${p.brand}_${p.code.replace(/[\s\/-]+/g, '_')}`;
  p.curated = 1;
  p.interior = 1;
  p.source_url = p.source_url || `https://paintdb.com/colors/${p.brand}/${encodeURIComponent(p.code)}`;
});

module.exports = {
  PAINT_FAMILIES,
  CURATED_PAINTS
};
