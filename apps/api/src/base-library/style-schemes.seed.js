/**
 * 精细风格 -> 风格方案种子（21 风格 × 2 套 = 42 套）
 *
 * 选材原则：
 * - 墙面/天花：生产库立邦真实色号（有预览）
 * - 地面：冠珠瓷砖真实 SKU（有预览），木纹/微水泥按风格选择
 * - 全屋定制/台面/金属/软装：51 条木纹 + 20 条通用材质（导入后均有本地预览）
 * - 每套 8–9 槽位：墙面基底、天花基底、地面、全屋定制、台面、金属、沙发、窗帘、地毯
 * - 方案种子必须幂等；自定义风格不在本表内
 */

const FINE_STYLES = [
  { id: 'italian_minimal', name_zh: '意式极简', parent_style_key: 'italian', sort: 10, description: '低饱和大地色、柔光岩板、直纹木作与哑光金属。' },
  { id: 'italian_luxury', name_zh: '意式轻奢', parent_style_key: 'italian', sort: 11, description: '深色木饰面、亮面石材、香槟金与细腻皮革。' },
  { id: 'french_luxury', name_zh: '法式轻奢', parent_style_key: 'french', sort: 20, description: '石膏线、暖白墙、浅橡、丝绒与黄铜细节。' },
  { id: 'french_country', name_zh: '法式田园', parent_style_key: 'french', sort: 21, description: '米白墙、原木、碎花墙布、亚麻与复古砖。' },
  { id: 'modern_minimal', name_zh: '现代极简', parent_style_key: 'modern_minimal', sort: 30, description: '白灰墙面、微水泥、净色板材与克制金属。' },
  { id: 'cream_style', name_zh: '奶油风', parent_style_key: 'cream_style', sort: 31, description: '奶油白墙、浅木、暖米软装与柔光地砖。' },
  { id: 'mid_century', name_zh: '中古风', parent_style_key: 'mid_century', sort: 32, description: '胡桃木、皮革、墨绿/焦糖点缀与水磨石。' },
  { id: 'industrial', name_zh: '工业风', parent_style_key: 'industrial', sort: 33, description: '水泥、黑钢、做旧皮革与裸顶结构。' },
  { id: 'wabi_sabi', name_zh: '侘寂', parent_style_key: 'wabi_sabi', sort: 40, description: '微水泥、洞石、原木肌理与低饱和织物。' },
  { id: 'song_aesthetic', name_zh: '宋式美学', parent_style_key: 'song_aesthetic', sort: 41, description: '米灰墙、直纹木、宣纸感墙面与素雅织物。' },
  { id: 'neo_chinese', name_zh: '新中式', parent_style_key: 'neo_chinese', sort: 42, description: '暖白墙、深色木格栅、岩板与皮质/丝绸软装。' },
  { id: 'classical_chinese', name_zh: '古典中式', parent_style_key: 'classical_chinese', sort: 43, description: '红木色木作、花格、青砖灰与丝绸纹样。' },
  { id: 'natural_wood', name_zh: '自然原木', parent_style_key: 'natural_wood', sort: 50, description: '白墙、原木、棉麻与柔光暖砖。' },
  { id: 'dark_wood', name_zh: '深色原木', parent_style_key: 'dark_wood', sort: 51, description: '深胡桃木、米灰墙、皮革与低反光金属。' },
  { id: 'natural_vintage_wood', name_zh: '自然复古原木', parent_style_key: 'natural_vintage_wood', sort: 52, description: '浅橡、米白、旧砖与亚麻软装。' },
  { id: 'dark_vintage_wood', name_zh: '深色复古原木', parent_style_key: 'dark_vintage_wood', sort: 53, description: '烟熏木、暖灰岩板、皮革与深色织物。' },
  { id: 'american_country', name_zh: '美式乡村', parent_style_key: 'american_country', sort: 60, description: '木梁、壁炉、米白墙、胡桃木与格纹织物。' },
  { id: 'american_modern', name_zh: '现代美式', parent_style_key: 'american_modern', sort: 61, description: '暖白墙、浅橡、皮革沙发与柔光石材。' },
  { id: 'nanyang_resort', name_zh: '南洋度假', parent_style_key: 'nanyang_resort', sort: 70, description: '藤编、原木、热带绿植、亚麻与暖光。' },
  { id: 'mediterranean', name_zh: '地中海', parent_style_key: 'mediterranean', sort: 80, description: '白墙、蓝调点缀、陶土砖与棉麻。' },
  { id: 'tuscan', name_zh: '托斯卡纳', parent_style_key: 'tuscan', sort: 81, description: '暖黄墙、赤陶砖、做旧木与铁艺。' }
];

// 立邦真实色号（生产库，带预览）
const PAINT = {
  milkCoffee: 'nippon_HZY-NN0020',   // 奶咖
  linghua: 'nippon_HZY-OW025',       // 菱花白
  pearl: 'nippon_OW033-4',           // 珍珠白
  chrysanthemum: 'nippon_OW029-4',   // 菊蕊白
  cocoa: 'nippon_NN0907-4',          // 可可蛋奶
  silk: 'nippon_ON0067-4',           // 米绸色
  apricot: 'nippon_OW067-4',         // 杏子灰
  beige: 'nippon_QS-R022',           // 浅米色
  pureGray: 'nippon_OW056-4',        // 纯净灰
  aluminum: 'nippon_NN0372-4',       // 铝灰
  lightGray: 'nippon_NN7860-4',      // 浅灰
  deepGray: 'nippon_B01',            // 深灰
  clayBrown: 'nippon_NN0132-2',      // 灰泥
  redTile: 'nippon_OA2000-1',        // 红砖瓦
  burgundy: 'nippon_RA0700-1',       // 勃艮地红
  sage: 'nippon_HZY-GN6107',         // 布鲁塞尔灰（灰绿）
  frostGreen: 'nippon_GC5501-4',     // 霜绿
  microCocoa: 'nippon_JW-O027',      // 微水泥 可可蛋奶
  lotusPink: 'nippon_VC0035-4',      // 香芋奶昔
  seaBlue: 'nippon_OW111-4'          // 青白（偏冷）
};

// 冠珠真实瓷砖 SKU（生产库，带预览）
const TILE = {
  softLightGray: 'guanzhu_31018',    // 西朗特斯-浅灰 柔光
  softMidGray: 'guanzhu_31031',      // 西朗特斯-浅灰 柔光
  softMidGray2: 'guanzhu_31014',     // 西朗特斯-米灰 柔光
  softBeige: 'guanzhu_31005',        // 拉斯维亚-米黄 柔光
  softCream: 'guanzhu_25750',        // 云拉米白 柔光
  softKhaki: 'guanzhu_25752',        // 卡森米黄 柔光
  softAnde: 'guanzhu_25755',         // 安德浅灰 柔光
  silverFrost: 'guanzhu_11095',      // 银霜灰 哑光
  earthGray: 'guanzhu_11096',        // 大地灰 哑光
  duskGray: 'guanzhu_11097',         // 暮云灰 哑光
  darkGray: 'guanzhu_10701',         // 奥维尔-深灰 哑光
  lightGray: 'guanzhu_10702',        // 奥维尔-浅灰 哑光
  polarWhite: 'guanzhu_649',         // 极地白 岩板
  galaxySilver: 'guanzhu_648',       // 星河银 岩板
  phantomGray: 'guanzhu_647',        // 幻影灰 岩板
  obsidian: 'guanzhu_646',           // 曜岩黑 岩板
  terrazzoLight: 'guanzhu_704',      // 水磨石-浅灰
  terrazzoDark: 'guanzhu_706',       // 水磨石-深灰
  terrazzoKhaki: 'guanzhu_707',      // 水磨石-浅卡其
  snowWhite: 'guanzhu_106126',       // 雪岭初白
  ivory: 'guanzhu_106133',           // 象牙米白
  cloudBeige: 'guanzhu_106136',      // 云贝米黄
  warmSand: 'guanzhu_106317',        // 陶山暖砂
  whiteTravertine: 'guanzhu_46563',  // 白洞石岩板
  yellowTravertine: 'guanzhu_46565', // 黄洞石岩板
  redTravertine: 'guanzhu_46561',    // 红洞石岩板
  bulgariBlack: 'guanzhu_46558',     // 宝格丽黑 亮光
  saintLaurent: 'guanzhu_81550',     // 圣罗兰黑金 亮光
  snowMountain: 'guanzhu_82098',     // 雪山白 亮光
  glacierWhite: 'guanzhu_18214',     // 冰川白 亮光
  bohemWhite: 'guanzhu_56830',       // 波西米白 亮光
  bohemYellow: 'guanzhu_56846',      // 波西米黄 亮光
  blackWhiteRoot: 'guanzhu_474',     // 宝格丽深棕 亮光
  inkAgarwood: 'guanzhu_9495',       // 墨玉沉香 哑光
  munich: 'guanzhu_9498',            // 慕尼黑 哑光
  xuanIron: 'guanzhu_106026',        // 玄铁墨黑
  inkDye: 'guanzhu_63633',           // 墨染
  moonlight: 'guanzhu_10937',        // 月光白 肌肤釉
  cloudBrown: 'guanzhu_10941',       // 云雾棕 肌肤釉
  primrose: 'guanzhu_10939',         // 樱草黄 肌肤釉
  terracotta: 'guanzhu_74930',       // 赤陶棕 花砖
  peacock: 'guanzhu_74936',          // 孔雀绿 花砖
  deepBlue: 'guanzhu_74938',         // 深海蓝 花砖
  wheat: 'guanzhu_74923',            // 麦穗黄 花砖
  nightBlack: 'guanzhu_74941',       // 夜幕黑 花砖
  cinnabar: 'guanzhu_74934',         // 朱砂红 花砖
  flowerMist: 'guanzhu_106721',      // 浅雾花信
  orchid: 'guanzhu_106728',          // 青枝兰语
  autumnBegonia: 'guanzhu_102169',   // 秋棠花语-米黄
  carrara: 'guanzhu_518',            // 卡拉拉花白
  frenchOakLight: 'guanzhu_731',     // 法国橡木-浅咖 木纹砖
  frenchOakDark: 'guanzhu_729',      // 法国橡木-深黄
  frenchOakGray: 'guanzhu_733',      // 法国橡木-中灰
  walnutPear: 'guanzhu_21982',       // 胡桃木-梨黄
  walnutChestnut: 'guanzhu_21983',   // 胡桃木-栗咖
  teak: 'guanzhu_11104',             // 柚木-中咖
  elmCoffee: 'guanzhu_11102',        // 榆木-浅咖
  nanmuLight: 'guanzhu_10709',       // 香楠-浅棕
  ash: 'guanzhu_10705',              // 北欧岑木
  woodApricot: 'guanzhu_79652',      // 木羽-浅杏
  woodCoffee: 'guanzhu_79657',       // 木羽-深咖
  woodGray: 'guanzhu_9525',          // 木纹-浅灰
  oakFlowLight: 'guanzhu_106692',    // 橡语流光-浅棕
  oakFlowDark: 'guanzhu_106694',     // 橡语流光-深棕
  bamboo: 'guanzhu_46940'            // 竹月 木纹砖
};

// 木纹（wood-catalog.js 导入后的 ID）
// 注：千年舟 14 款按 external_id 合并到既有 cat_wood_* 条目，仅逐浪橡木为新 ID
const WOOD = {
  tz_oakWave: 'wood_treezo_zhulangxiangmu_838',       // 逐浪橡木 treezo:232
  tz_walnutEvening: 'cat_wood_1793248387227_xbagxl', // 晚宜胡桃 treezo:230
  tz_ash: 'cat_wood_1793248387381_smzwav',            // 轻岚水曲柳 treezo:228
  tz_walnutLemon: 'cat_wood_1793248387453_c4suv7',   // 栖柠胡桃 treezo:227
  tz_oakSand: 'cat_wood_1793248387508_u1wa3f',       // 流沙橡木 treezo:226
  tz_elmMountain: 'cat_wood_1793248387567_9i2ayd',   // 山禾景榆 treezo:225
  tz_oakRock: 'cat_wood_1793248387623_kdt114',       // 岩云意橡 treezo:224
  tz_elmDream: 'cat_wood_1793248387682_m3v7lo',      // 梦隐沉榆 treezo:223
  tz_elmCreek: 'cat_wood_1793248387741_xnxrp8',      // 溪山沉榆 treezo:222
  tz_walnutMoon: 'cat_wood_1793248387865_oked7b',    // 月明胡桃 treezo:220
  tz_walnutSpring: 'cat_wood_1793248387920_1c03am',  // 春日胡桃 treezo:219
  tz_ribbonMist: 'cat_wood_1793248387062_5s188v',    // 烟澜金缕 treezo:231
  tz_ribbonMoon: 'cat_wood_1793248387316_gi1q9w',    // 清辉金缕 treezo:229
  ph_whiteOak: 'wood_ph_white_oak_veneer',
  ph_silverOak: 'wood_ph_silver_oak_veneer_01',
  ph_greyOak: 'wood_ph_grey_oak_veneer_01',
  ph_washedOak: 'wood_ph_washed_grey_oak_veneer',
  ph_oak: 'wood_ph_oak_veneer_02',
  ph_redOak: 'wood_ph_red_oak_veneer',
  ph_ash: 'wood_ph_ash_veneer',
  ph_cherry: 'wood_ph_cherry_veneer',
  ph_teak: 'wood_ph_teak_veneer',
  ph_maple: 'wood_ph_white_maple_veneer',
  ph_amWalnut: 'wood_ph_american_walnut_veneer',
  ph_bwWalnut: 'wood_ph_black_walnut_veneer_01',
  ph_euWalnut: 'wood_ph_european_walnut_veneer_04',
  ph_smokedWalnut: 'wood_ph_smoked_walnut_veneer',
  ph_walnut: 'wood_ph_walnut_veneer',
  ph_rosewood: 'wood_ph_rosewood_veneer1',
  ph_sapele: 'wood_ph_sapele_veneer',
  ph_mahogany: 'wood_ph_dark_wood',
  ph_ebony: 'wood_ph_flamed_black_veneer',
  ph_bamboo: 'wood_ph_bamboo_veneer',
  ph_plywood: 'wood_ph_plywood',
  ph_osb: 'wood_ph_oriented_strand_board',
  ph_herringbone: 'wood_ph_herringbone_parquet',
  ph_parquet: 'wood_ph_rectangular_parquet',
  ph_coatedPine: 'wood_ph_coated_pine',
  ph_stainedPine: 'wood_ph_stained_pine',
  ph_hinoki: 'wood_ph_hinoki_planks',
  ph_olive: 'wood_ph_olive_veneer',
  ph_okoume: 'wood_ph_okoume_veneer',
  acg_birch: 'wood_acg_Wood090A',
  acg_oak: 'wood_acg_Wood049',
  acg_walnut: 'wood_acg_Wood051',
  acg_herringbone: 'wood_acg_WoodFloor034',
  acg_parquet: 'wood_acg_WoodFloor070',
  smokedOak: 'generic_wood_smoked_oak'
};

// 20 条通用材质（generic-catalog.js 导入后的 ID）
const G = {
  marbleWhite: 'generic_marble_white',
  marbleBlack: 'generic_marble_black',
  travertine: 'generic_travertine_beige',
  terrazzoLight: 'generic_terrazzo_light',
  terrazzoWarm: 'generic_terrazzo_warm',
  champagne: 'generic_metal_champagne',
  silver: 'generic_metal_graphite',
  brass: 'generic_metal_brass',
  blackSteel: 'generic_metal_black',
  linen: 'generic_fabric_linen_natural',
  boucle: 'generic_fabric_boucle_cream',
  oliveFabric: 'generic_fabric_velvet_olive',
  sheer: 'generic_fabric_sheer_white',
  cognacLeather: 'generic_leather_cognac',
  blackLeather: 'generic_leather_black',
  creamLeather: 'generic_leather_cream',
  rugGray: 'generic_carpet_wool_gray',
  rugCream: 'generic_carpet_jute',
  microLight: 'generic_concrete_micro',
  microWarm: 'generic_concrete_warm'
};

function slot(surface, role, item, space = 'any') {
  return { space_key: space, surface, role, item_id: item };
}
// 软装快捷组
const softLiving = (sofa, curtain = G.sheer, rug = G.rugCream) => [
  slot('soft', 'sofa', sofa, 'living'),
  slot('soft', 'curtain', curtain, 'living'),
  slot('soft', 'rug', rug, 'living')
];

const SCHEMES = {
  italian_minimal: [
    {
      id: 'italian_minimal_a', name_zh: '燕麦暖岩',
      description: '奶咖墙、菱花白顶、烟熏橡木、柔光浅灰岩板、哑光黑钢与燕麦软装。',
      palette: ['#E4D5C8', '#F3F0EA', '#5A4632', '#C4C0B8', '#5D5D5F', '#D8C7A8'],
      space_scope: ['living'],
      slots: [
        slot('wall', 'base', PAINT.milkCoffee), slot('ceiling', 'base', PAINT.linghua),
        slot('floor', 'any', TILE.softLightGray), slot('millwork', 'any', WOOD.smokedOak),
        slot('counter', 'any', G.travertine), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.boucle, G.linen, G.rugGray)
      ]
    },
    {
      id: 'italian_minimal_b', name_zh: '浅橡灰岩',
      description: '菱花白墙顶、深胡桃饰面、米灰柔光砖、拉丝银灰与亚麻软装。',
      palette: ['#F3F0EA', '#4A3A2E', '#C4C0B8', '#7D8994', '#D8C7A8', '#BCB194'],
      space_scope: ['living', 'bedroom'],
      slots: [
        slot('wall', 'base', PAINT.linghua), slot('ceiling', 'base', PAINT.linghua),
        slot('floor', 'any', TILE.softMidGray), slot('millwork', 'any', WOOD.tz_walnutEvening),
        slot('counter', 'any', TILE.softMidGray2), slot('metal', 'any', G.silver),
        ...softLiving(G.linen, G.sheer, G.rugGray)
      ]
    }
  ],
  italian_luxury: [
    {
      id: 'italian_luxury_a', name_zh: '黑金曜岩',
      description: '象牙白墙、黑檀木饰面、宝格丽黑岩板、香槟金与焦糖真皮。',
      palette: ['#F5F1E8', '#1A1819', '#0E0E10', '#FFE49D', '#633828', '#F4F3F1'],
      space_scope: ['living'],
      slots: [
        slot('wall', 'base', PAINT.chrysanthemum), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.obsidian), slot('millwork', 'any', WOOD.ph_ebony),
        slot('counter', 'any', G.marbleBlack), slot('metal', 'any', G.champagne),
        ...softLiving(G.cognacLeather, G.boucle, G.rugGray)
      ]
    },
    {
      id: 'italian_luxury_b', name_zh: '玫瑰铜光',
      description: '奶咖墙、玫瑰木饰面、雪山白亮面地砖、黄铜与米白真皮。',
      palette: ['#E4D5C8', '#6B3A30', '#F4F3F1', '#B08D4F', '#EFE6DA', '#BCB194'],
      space_scope: ['living', 'dining'],
      slots: [
        slot('wall', 'base', PAINT.milkCoffee), slot('ceiling', 'base', PAINT.linghua),
        slot('floor', 'any', TILE.snowMountain), slot('millwork', 'any', WOOD.ph_rosewood),
        slot('counter', 'any', G.marbleWhite), slot('metal', 'any', G.brass),
        ...softLiving(G.creamLeather, G.sheer, G.rugCream)
      ]
    }
  ],
  french_luxury: [
    {
      id: 'french_luxury_a', name_zh: '白橡石膏线',
      description: '珍珠白墙、银白橡饰面、卡拉拉花白地砖、黄铜与奶油羊羔绒。',
      palette: ['#FFFDF0', '#CFC9BE', '#EDEBE6', '#B08D4F', '#F1E7DC', '#D8C7A8'],
      space_scope: ['living', 'bedroom'],
      slots: [
        slot('wall', 'base', PAINT.pearl), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.carrara), slot('millwork', 'any', WOOD.ph_silverOak),
        slot('counter', 'any', G.marbleWhite), slot('metal', 'any', G.brass),
        ...softLiving(G.boucle, G.sheer, G.rugCream)
      ]
    },
    {
      id: 'french_luxury_b', name_zh: '樱桃丝绒',
      description: '菊蕊白墙、樱桃木饰面、象牙米白古堡砖、香槟金与橄榄绿丝绒。',
      palette: ['#F3F0E6', '#8A4A38', '#E7DFCF', '#FFE49D', '#5C6B4E', '#BCB194'],
      space_scope: ['living'],
      slots: [
        slot('wall', 'base', PAINT.chrysanthemum), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.ivory), slot('millwork', 'any', WOOD.ph_cherry),
        slot('counter', 'any', G.travertine), slot('metal', 'any', G.champagne),
        ...softLiving(G.oliveFabric, G.linen, G.rugGray)
      ]
    }
  ],
  french_country: [
    {
      id: 'french_country_a', name_zh: '杏色亚麻',
      description: '杏子灰墙、白橡饰面、雪岭初白哑光砖、拉丝银灰与亚麻织物。',
      palette: ['#E5E0D6', '#C9B89A', '#ECE8DF', '#7D8994', '#D8C7A8', '#BCB194'],
      space_scope: ['living', 'dining'],
      slots: [
        slot('wall', 'base', PAINT.apricot), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.snowWhite), slot('millwork', 'any', WOOD.tz_oakSand),
        slot('counter', 'any', TILE.ivory), slot('metal', 'any', G.silver),
        ...softLiving(G.linen, G.linen, G.rugCream)
      ]
    },
    {
      id: 'french_country_b', name_zh: '花信米黄',
      description: '米绸色墙、枫木饰面、秋棠花语花砖点缀地面、黄铜与纱帘。',
      palette: ['#F9E8D6', '#D7B483', '#EFE0C8', '#B08D4F', '#F1F1F1', '#D8C7A8'],
      space_scope: ['living'],
      slots: [
        slot('wall', 'base', PAINT.silk), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.autumnBegonia), slot('millwork', 'any', WOOD.ph_maple),
        slot('counter', 'any', G.travertine), slot('metal', 'any', G.brass),
        ...softLiving(G.boucle, G.sheer, G.rugCream)
      ]
    }
  ],
  modern_minimal: [
    {
      id: 'modern_minimal_a', name_zh: '净白微水泥',
      description: '纯净灰白墙顶、浅灰微水泥地、水洗灰橡、哑光黑钢与本白软装。',
      palette: ['#E2E4E4', '#B3BEC1', '#9EA89C', '#5D5D5F', '#F1F1F1', '#BCB194'],
      space_scope: ['living'],
      slots: [
        slot('wall', 'base', PAINT.pureGray), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', G.microLight), slot('millwork', 'any', WOOD.ph_washedOak),
        slot('counter', 'any', G.microLight), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.linen, G.sheer, G.rugGray)
      ]
    },
    {
      id: 'modern_minimal_b', name_zh: '灰白极简',
      description: '铝灰墙、菱花白顶、奥维尔浅灰砖、白橡饰面、拉丝银灰与灰色软装。',
      palette: ['#C8CACA', '#F3F0EA', '#BFC4C8', '#D2C6B0', '#7D8994', '#B6B7B9'],
      space_scope: ['living', 'bedroom'],
      slots: [
        slot('wall', 'base', PAINT.aluminum), slot('ceiling', 'base', PAINT.linghua),
        slot('floor', 'any', TILE.lightGray), slot('millwork', 'any', WOOD.ph_whiteOak),
        slot('counter', 'any', TILE.phantomGray), slot('metal', 'any', G.silver),
        ...softLiving(G.boucle, G.sheer, G.rugGray)
      ]
    }
  ],
  cream_style: [
    {
      id: 'cream_style_a', name_zh: '可可奶霜',
      description: '可可蛋奶墙顶、流沙橡木、云拉米白柔光砖、香槟金与奶油羊羔绒。',
      palette: ['#ECE4D8', '#D8C29A', '#EFE8DA', '#FFE49D', '#F1E7DC', '#E2D3B8'],
      space_scope: ['living', 'bedroom'],
      slots: [
        slot('wall', 'base', PAINT.cocoa), slot('ceiling', 'base', PAINT.cocoa),
        slot('floor', 'any', TILE.softCream), slot('millwork', 'any', WOOD.tz_oakSand),
        slot('counter', 'any', G.terrazzoLight), slot('metal', 'any', G.champagne),
        ...softLiving(G.boucle, G.sheer, G.rugCream)
      ]
    },
    {
      id: 'cream_style_b', name_zh: '奶油云贝',
      description: '浅米色墙、珍珠白顶、云贝米黄古堡砖、白蜡木、黄铜与米白地毯。',
      palette: ['#F1E7DC', '#FFFDF0', '#E4D5BD', '#D7C08E', '#B08D4F', '#E8DEC8'],
      space_scope: ['living'],
      slots: [
        slot('wall', 'base', PAINT.beige), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.cloudBeige), slot('millwork', 'any', WOOD.tz_ash),
        slot('counter', 'any', G.travertine), slot('metal', 'any', G.brass),
        ...softLiving(G.creamLeather, G.linen, G.rugCream)
      ]
    }
  ],
  mid_century: [
    {
      id: 'mid_century_a', name_zh: '胡桃水磨石',
      description: '奶咖墙、美国胡桃饰面、浅灰水磨石地、焦糖真皮与墨绿织物。',
      palette: ['#E4D5C8', '#5A3E2C', '#A08E75', '#633828', '#5C6B4E', '#A08E75'],
      space_scope: ['living', 'study'],
      slots: [
        slot('wall', 'base', PAINT.milkCoffee), slot('ceiling', 'base', PAINT.linghua),
        slot('floor', 'any', G.terrazzoLight), slot('millwork', 'any', WOOD.ph_amWalnut),
        slot('counter', 'any', TILE.terrazzoLight), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.cognacLeather, G.oliveFabric, G.rugGray)
      ]
    },
    {
      id: 'mid_century_b', name_zh: '墨绿柚木',
      description: '布鲁塞尔灰绿墙、柚木饰面、浅卡其水磨石、黄铜与焦糖皮革。',
      palette: ['#B7C4B7', '#8A6034', '#B2A68A', '#B08D4F', '#633828', '#8E8474'],
      space_scope: ['living', 'study'],
      slots: [
        slot('wall', 'base', PAINT.sage), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.terrazzoKhaki), slot('millwork', 'any', WOOD.ph_teak),
        slot('counter', 'any', G.terrazzoWarm), slot('metal', 'any', G.brass),
        ...softLiving(G.cognacLeather, G.oliveFabric, G.rugGray)
      ]
    }
  ],
  industrial: [
    {
      id: 'industrial_a', name_zh: '黑钢水泥',
      description: '深灰墙、浅灰顶、浅灰微水泥地、OSB 板与哑光黑钢、做旧黑皮。',
      palette: ['#5E656A', '#B3BEC1', '#A8ABB0', '#7A6A52', '#2E2E30', '#1A1819'],
      space_scope: ['living'],
      slots: [
        slot('wall', 'base', PAINT.deepGray), slot('ceiling', 'base', PAINT.lightGray),
        slot('floor', 'any', G.microLight), slot('millwork', 'any', WOOD.ph_osb),
        slot('counter', 'any', G.microWarm), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.blackLeather, G.linen, G.rugGray)
      ]
    },
    {
      id: 'industrial_b', name_zh: '烟熏旧木',
      description: '灰泥棕墙、水泥森林顶、格莱斯深灰水泥砖、烟熏胡桃与黑钢。',
      palette: ['#A2968D', '#74777B', '#56595C', '#3F3229', '#2E2E30', '#4A4138'],
      space_scope: ['living', 'loft'],
      slots: [
        slot('wall', 'base', PAINT.clayBrown), slot('ceiling', 'base', 'nippon_JW-N007'),
        slot('floor', 'any', 'guanzhu_11063'), slot('millwork', 'any', WOOD.ph_smokedWalnut),
        slot('counter', 'any', TILE.darkGray), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.blackLeather, G.linen, G.rugGray)
      ]
    }
  ],
  wabi_sabi: [
    {
      id: 'wabi_sabi_a', name_zh: '洞石原土',
      description: '奶咖墙、暖灰微水泥地、白洞石、天然橡木与本白亚麻。',
      palette: ['#E4D5C8', '#C9B9A2', '#E0CCAD', '#B89A72', '#D8C7A8', '#BCB194'],
      space_scope: ['living', 'bedroom', 'tea'],
      slots: [
        slot('wall', 'base', PAINT.milkCoffee), slot('ceiling', 'base', PAINT.cocoa),
        slot('floor', 'any', G.microWarm), slot('millwork', 'any', WOOD.acg_oak),
        slot('counter', 'any', G.travertine), slot('metal', 'any', G.silver),
        ...softLiving(G.linen, G.linen, G.rugCream)
      ]
    },
    {
      id: 'wabi_sabi_b', name_zh: '素砂侘寂',
      description: '可可蛋奶墙、陶山暖砂砖、天然橡饰面、米白洞石与素色织物。',
      palette: ['#ECE4D8', '#C8AE85', '#D8C3A2', '#B09878', '#EFE6DA', '#BCB194'],
      space_scope: ['living', 'bedroom'],
      slots: [
        slot('wall', 'base', PAINT.cocoa), slot('ceiling', 'base', PAINT.silk),
        slot('floor', 'any', TILE.warmSand), slot('millwork', 'any', WOOD.ph_oak),
        slot('counter', 'any', TILE.whiteTravertine), slot('metal', 'any', G.silver),
        ...softLiving(G.boucle, G.linen, G.rugCream)
      ]
    }
  ],
  song_aesthetic: [
    {
      id: 'song_aesthetic_a', name_zh: '宣纸直纹',
      description: '纯净灰墙、菱花白顶、银霜灰砖、白蜡直纹木与素雅亚麻。',
      palette: ['#E2E4E4', '#F3F0EA', '#C2C5C4', '#CBBFA9', '#B6B7B9', '#D8C7A8'],
      space_scope: ['living', 'study', 'tea'],
      slots: [
        slot('wall', 'base', PAINT.pureGray), slot('ceiling', 'base', PAINT.linghua),
        slot('floor', 'any', TILE.silverFrost), slot('millwork', 'any', WOOD.ph_ash),
        slot('counter', 'any', TILE.cloudBeige), slot('metal', 'any', G.silver),
        ...softLiving(G.linen, G.sheer, G.rugCream)
      ]
    },
    {
      id: 'song_aesthetic_b', name_zh: '竹影月白',
      description: '青白墙、珍珠白顶、月光白肌肤釉、竹木饰面与白色纱帘。',
      palette: ['#DFE9EF', '#FFFDF0', '#E7E8DA', '#B9A878', '#F1F1F1', '#BCB194'],
      space_scope: ['study', 'tea', 'living'],
      slots: [
        slot('wall', 'base', PAINT.seaBlue), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.moonlight), slot('millwork', 'any', WOOD.ph_bamboo),
        slot('counter', 'any', TILE.ivory), slot('metal', 'any', G.silver),
        ...softLiving(G.linen, G.sheer, G.rugGray)
      ]
    }
  ],
  neo_chinese: [
    {
      id: 'neo_chinese_a', name_zh: '胡桃岩板',
      description: '可可蛋奶墙、晚宜胡桃饰面、星河银岩板、哑光黑钢与米白真皮。',
      palette: ['#ECE4D8', '#4E3C2E', '#9CA0A2', '#2E2E30', '#EFE6DA', '#8E8474'],
      space_scope: ['living', 'dining'],
      slots: [
        slot('wall', 'base', PAINT.cocoa), slot('ceiling', 'base', PAINT.linghua),
        slot('floor', 'any', TILE.galaxySilver), slot('millwork', 'any', WOOD.tz_walnutEvening),
        slot('counter', 'any', TILE.phantomGray), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.creamLeather, G.sheer, G.rugGray)
      ]
    },
    {
      id: 'neo_chinese_b', name_zh: '沙比利墨',
      description: '奶咖墙、沙比利丝带纹木、墨染深灰砖、黄铜与黑色真皮。',
      palette: ['#E4D5C8', '#6A3E30', '#3A3D40', '#B08D4F', '#1A1819', '#7A6A52'],
      space_scope: ['living', 'study'],
      slots: [
        slot('wall', 'base', PAINT.milkCoffee), slot('ceiling', 'base', PAINT.silk),
        slot('floor', 'any', TILE.inkDye), slot('millwork', 'any', WOOD.ph_sapele),
        slot('counter', 'any', G.marbleBlack), slot('metal', 'any', G.brass),
        ...softLiving(G.blackLeather, G.linen, G.rugGray)
      ]
    }
  ],
  classical_chinese: [
    {
      id: 'classical_chinese_a', name_zh: '红木青砖',
      description: '勃艮地红点缀墙、桃花心木饰面、玄铁墨黑地砖、黄铜与深色织物。',
      palette: ['#834643', '#5C2E22', '#23262A', '#B08D4F', '#3A3230', '#564A42'],
      space_scope: ['living', 'dining'],
      slots: [
        slot('wall', 'base', PAINT.silk), slot('wall', 'accent', PAINT.burgundy),
        slot('ceiling', 'base', PAINT.silk),
        slot('floor', 'any', TILE.xuanIron), slot('millwork', 'any', WOOD.ph_mahogany),
        slot('counter', 'any', G.marbleBlack), slot('metal', 'any', G.brass),
        ...softLiving(G.blackLeather, G.linen, G.rugGray)
      ]
    },
    {
      id: 'classical_chinese_b', name_zh: '玫瑰紫檀',
      description: '灰泥棕墙、玫瑰木饰面、墨玉沉香砖、香槟金与焦糖真皮。',
      palette: ['#A2968D', '#5A2E26', '#232221', '#FFE49D', '#633828', '#4A3E38'],
      space_scope: ['living', 'study'],
      slots: [
        slot('wall', 'base', PAINT.clayBrown), slot('ceiling', 'base', PAINT.silk),
        slot('floor', 'any', TILE.inkAgarwood), slot('millwork', 'any', WOOD.ph_rosewood),
        slot('counter', 'any', TILE.bulgariBlack), slot('metal', 'any', G.champagne),
        ...softLiving(G.cognacLeather, G.linen, G.rugGray)
      ]
    }
  ],
  natural_wood: [
    {
      id: 'natural_wood_a', name_zh: '白蜡原林',
      description: '珍珠白墙顶、白蜡木饰面、胡桃梨黄木纹砖、原木家具与棉麻软装。',
      palette: ['#FFFDF0', '#D8C29A', '#D4B483', '#C9B084', '#D8C7A8', '#E8DEC8'],
      space_scope: ['living', 'bedroom'],
      slots: [
        slot('wall', 'base', PAINT.pearl), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.walnutPear), slot('millwork', 'any', WOOD.ph_ash),
        slot('counter', 'any', TILE.ivory), slot('metal', 'any', G.silver),
        ...softLiving(G.linen, G.sheer, G.rugCream)
      ]
    },
    {
      id: 'natural_wood_b', name_zh: '北欧岑木',
      description: '菊蕊白墙、北欧岑木木纹砖、白橡饰面、浅灰软装与纱帘。',
      palette: ['#F3F0E6', '#D6C4A6', '#E2D6C2', '#C2B9A8', '#F1F1F1', '#D0CCC4'],
      space_scope: ['living', 'bedroom'],
      slots: [
        slot('wall', 'base', PAINT.chrysanthemum), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.ash), slot('millwork', 'any', WOOD.ph_whiteOak),
        slot('counter', 'any', TILE.snowWhite), slot('metal', 'any', G.silver),
        ...softLiving(G.boucle, G.sheer, G.rugCream)
      ]
    }
  ],
  dark_wood: [
    {
      id: 'dark_wood_a', name_zh: '深胡桃书房',
      description: '菱花白顶、米灰墙、美国胡桃饰面、栗咖木纹砖、黑钢与黑皮。',
      palette: ['#F3F0EA', '#C7C4BE', '#4A3226', '#6B4B34', '#2E2E30', '#1A1819'],
      space_scope: ['study', 'living'],
      slots: [
        slot('wall', 'base', PAINT.aluminum), slot('ceiling', 'base', PAINT.linghua),
        slot('floor', 'any', TILE.walnutChestnut), slot('millwork', 'any', WOOD.ph_amWalnut),
        slot('counter', 'any', TILE.duskGray), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.blackLeather, G.linen, G.rugGray)
      ]
    },
    {
      id: 'dark_wood_b', name_zh: '黑檀雪茄',
      description: '浅灰墙、黑檀饰面、曜岩黑地砖、黄铜与焦糖真皮。',
      palette: ['#B3BEC1', '#161210', '#111214', '#B08D4F', '#633828', '#3F3733'],
      space_scope: ['living', 'study'],
      slots: [
        slot('wall', 'base', PAINT.lightGray), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.obsidian), slot('millwork', 'any', WOOD.ph_ebony),
        slot('counter', 'any', G.marbleBlack), slot('metal', 'any', G.brass),
        ...softLiving(G.cognacLeather, G.linen, G.rugGray)
      ]
    }
  ],
  natural_vintage_wood: [
    {
      id: 'natural_vintage_wood_a', name_zh: '浅橡旧居',
      description: '杏子灰墙、法国浅咖橡木砖、天然橡饰面、暖灰水磨石台面与亚麻。',
      palette: ['#E5E0D6', '#C7A878', '#D2B790', '#9E9488', '#D8C7A8', '#BCB194'],
      space_scope: ['living', 'bedroom'],
      slots: [
        slot('wall', 'base', PAINT.apricot), slot('ceiling', 'base', PAINT.chrysanthemum),
        slot('floor', 'any', TILE.frenchOakLight), slot('millwork', 'any', WOOD.ph_oak),
        slot('counter', 'any', G.terrazzoWarm), slot('metal', 'any', G.brass),
        ...softLiving(G.linen, G.linen, G.rugCream)
      ]
    },
    {
      id: 'natural_vintage_wood_b', name_zh: '松木花信',
      description: '米绸色墙、漆面松木板、香楠浅棕木纹砖、结疤松木家具与纱帘。',
      palette: ['#F9E8D6', '#D8B37A', '#C4A478', '#E2C9A2', '#F1F1F1', '#D8C7A8'],
      space_scope: ['bedroom', 'living'],
      slots: [
        slot('wall', 'base', PAINT.silk), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.nanmuLight), slot('millwork', 'any', WOOD.ph_coatedPine),
        slot('counter', 'any', TILE.flowerMist), slot('metal', 'any', G.silver),
        ...softLiving(G.boucle, G.sheer, G.rugCream)
      ]
    }
  ],
  dark_vintage_wood: [
    {
      id: 'dark_vintage_wood_a', name_zh: '烟熏酒廊',
      description: '灰泥棕墙、烟熏胡桃饰面、橡语流光深棕木纹砖、黑钢与黑色真皮。',
      palette: ['#A2968D', '#3E2E24', '#5A4230', '#2E2E30', '#1A1819', '#4A3E36'],
      space_scope: ['living', 'study'],
      slots: [
        slot('wall', 'base', PAINT.clayBrown), slot('ceiling', 'base', PAINT.aluminum),
        slot('floor', 'any', TILE.oakFlowDark), slot('millwork', 'any', WOOD.ph_smokedWalnut),
        slot('counter', 'any', TILE.darkGray), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.blackLeather, G.linen, G.rugGray)
      ]
    },
    {
      id: 'dark_vintage_wood_b', name_zh: '染色旧木',
      description: '奶咖墙、染色松木板、慕尼黑哑光深砖、黄铜与焦糖皮革。',
      palette: ['#E4D5C8', '#6E4E32', '#3A3838', '#B08D4F', '#633828', '#6B5B4C'],
      space_scope: ['living', 'dining'],
      slots: [
        slot('wall', 'base', PAINT.milkCoffee), slot('ceiling', 'base', PAINT.silk),
        slot('floor', 'any', TILE.munich), slot('millwork', 'any', WOOD.ph_stainedPine),
        slot('counter', 'any', G.marbleBlack), slot('metal', 'any', G.brass),
        ...softLiving(G.cognacLeather, G.linen, G.rugGray)
      ]
    }
  ],
  american_country: [
    {
      id: 'american_country_a', name_zh: '胡桃木梁',
      description: '珍珠白墙、胡桃木梁与饰面、法国深黄橡木砖、焦糖皮与格纹织物。',
      palette: ['#FFFDF0', '#5A3E2C', '#B98A4E', '#633828', '#D8C7A8', '#8E8474'],
      space_scope: ['living', 'dining'],
      slots: [
        slot('wall', 'base', PAINT.pearl), slot('ceiling', 'base', PAINT.chrysanthemum),
        slot('floor', 'any', TILE.frenchOakDark), slot('millwork', 'any', WOOD.ph_walnut),
        slot('counter', 'any', G.terrazzoWarm), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.cognacLeather, G.linen, G.rugGray)
      ]
    },
    {
      id: 'american_country_b', name_zh: '浅橡壁炉',
      description: '菱花白墙、流沙橡木、法国浅咖橡木砖、米白洞石壁炉与布艺沙发。',
      palette: ['#F3F0EA', '#CBB08A', '#D2B790', '#E0CCAD', '#D8C7A8', '#BCB194'],
      space_scope: ['living'],
      slots: [
        slot('wall', 'base', PAINT.linghua), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.frenchOakLight), slot('millwork', 'any', WOOD.tz_oakSand),
        slot('counter', 'any', G.travertine), slot('metal', 'any', G.silver),
        ...softLiving(G.boucle, G.linen, G.rugCream)
      ]
    }
  ],
  american_modern: [
    {
      id: 'american_modern_a', name_zh: '暖白浅橡',
      description: '可可蛋奶墙、白橡饰面、云拉米白柔光砖、米白真皮与黄铜细节。',
      palette: ['#ECE4D8', '#D2C0A2', '#EFE8DA', '#B08D4F', '#EFE6DA', '#D8C7A8'],
      space_scope: ['living', 'bedroom'],
      slots: [
        slot('wall', 'base', PAINT.cocoa), slot('ceiling', 'base', PAINT.linghua),
        slot('floor', 'any', TILE.softCream), slot('millwork', 'any', WOOD.tz_oakRock),
        slot('counter', 'any', G.marbleWhite), slot('metal', 'any', G.brass),
        ...softLiving(G.creamLeather, G.sheer, G.rugCream)
      ]
    },
    {
      id: 'american_modern_b', name_zh: '胡桃柔光',
      description: '浅米色墙、晚宜胡桃、西朗特斯米灰柔光砖、拉丝银灰与灰色地毯。',
      palette: ['#F1E7DC', '#4E3C2E', '#C9C3BC', '#7D8994', '#B6B7B9', '#BCB194'],
      space_scope: ['living', 'bedroom'],
      slots: [
        slot('wall', 'base', PAINT.beige), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.softMidGray2), slot('millwork', 'any', WOOD.tz_walnutEvening),
        slot('counter', 'any', TILE.softAnde), slot('metal', 'any', G.silver),
        ...softLiving(G.creamLeather, G.linen, G.rugGray)
      ]
    }
  ],
  nanyang_resort: [
    {
      id: 'nanyang_resort_a', name_zh: '柚木藤影',
      description: '米绸色墙、柚木饰面、陶山暖砂砖、藤编与亚麻、香槟金点缀。',
      palette: ['#F9E8D6', '#9A6E3E', '#C8A470', '#B08D4F', '#D8C7A8', '#BCB194'],
      space_scope: ['living', 'balcony'],
      slots: [
        slot('wall', 'base', PAINT.silk), slot('ceiling', 'base', PAINT.chrysanthemum),
        slot('floor', 'any', TILE.warmSand), slot('millwork', 'any', WOOD.ph_teak),
        slot('counter', 'any', TILE.yellowTravertine), slot('metal', 'any', G.champagne),
        ...softLiving(G.linen, G.linen, G.rugCream)
      ]
    },
    {
      id: 'nanyang_resort_b', name_zh: '竹月雨林',
      description: '霜绿墙、竹木饰面、竹月木纹砖、米白洞石与白色纱帘。',
      palette: ['#DAEADA', '#B3A06A', '#D8C392', '#E0CCAD', '#F1F1F1', '#C9C8A8'],
      space_scope: ['living', 'balcony'],
      slots: [
        slot('wall', 'base', PAINT.frostGreen), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.bamboo), slot('millwork', 'any', WOOD.ph_bamboo),
        slot('counter', 'any', G.travertine), slot('metal', 'any', G.brass),
        ...softLiving(G.boucle, G.sheer, G.rugCream)
      ]
    }
  ],
  mediterranean: [
    {
      id: 'mediterranean_a', name_zh: '爱琴海白',
      description: '珍珠白墙顶、雪岭初白砖、白蜡木、深海蓝花砖点缀与黑色金属。',
      palette: ['#FFFDF0', '#ECE8DF', '#CBB992', '#2E4A5E', '#5D5D5F', '#B6B7B9'],
      space_scope: ['living', 'dining'],
      slots: [
        slot('wall', 'base', PAINT.pearl), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.snowWhite), slot('millwork', 'any', WOOD.tz_ash),
        slot('counter', 'any', TILE.carrara), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.linen, G.sheer, G.rugCream)
      ]
    },
    {
      id: 'mediterranean_b', name_zh: '蓝白陶土',
      description: '青白墙、赤陶棕花砖、橄榄木饰面、白洞石与棉麻软装。',
      palette: ['#DFE9EF', '#B5693F', '#B09870', '#E0CCAD', '#F1F1F1', '#BCB194'],
      space_scope: ['living', 'dining'],
      slots: [
        slot('wall', 'base', PAINT.seaBlue), slot('ceiling', 'base', PAINT.pearl),
        slot('floor', 'any', TILE.terracotta), slot('millwork', 'any', WOOD.ph_olive),
        slot('counter', 'any', TILE.whiteTravertine), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.linen, G.linen, G.rugCream)
      ]
    }
  ],
  tuscan: [
    {
      id: 'tuscan_a', name_zh: '赤陶暖阳',
      description: '米绸色墙、红砖瓦点缀、柚木饰面、赤陶棕花砖与做旧铁艺。',
      palette: ['#F9E8D6', '#AE6C4A', '#9A6E3E', '#5D5D5F', '#D8C7A8', '#8E6A4C'],
      space_scope: ['living', 'dining'],
      slots: [
        slot('wall', 'base', PAINT.silk), slot('wall', 'accent', PAINT.redTile),
        slot('ceiling', 'base', PAINT.chrysanthemum),
        slot('floor', 'any', TILE.terracotta), slot('millwork', 'any', WOOD.ph_teak),
        slot('counter', 'any', TILE.yellowTravertine), slot('metal', 'any', G.blackSteel),
        ...softLiving(G.cognacLeather, G.linen, G.rugCream)
      ]
    },
    {
      id: 'tuscan_b', name_zh: '橄榄金麦',
      description: '樱草黄墙、橄榄木饰面、麦穗黄花砖、黄铜与橄榄绿织物。',
      palette: ['#F2E2B0', '#9E8556', '#D8B84E', '#B08D4F', '#5C6B4E', '#A98E5E'],
      space_scope: ['living', 'dining'],
      slots: [
        slot('wall', 'base', 'nippon_JW-Y012'), slot('ceiling', 'base', PAINT.silk),
        slot('floor', 'any', TILE.wheat), slot('millwork', 'any', WOOD.ph_olive),
        slot('counter', 'any', TILE.warmSand), slot('metal', 'any', G.brass),
        ...softLiving(G.oliveFabric, G.linen, G.rugCream)
      ]
    }
  ]
};

function seedStyleSchemes(db, { dryRun = false, style = '' } = {}) {
  const { ensureItems, upsertStyle, upsertScheme } = require('./items');
  ensureItems(db);
  const now = Date.now();
  const styleFilter = style ? String(style).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const plan = { styles: [], generic_items: 0, schemes: 0, skipped: [], validation: { missing_items: [], schemes: 0, slots: 0 } };

  // 校验：所有槽位 item_id 必须存在且有预览
  const itemStmt = db.prepare('SELECT id, preview_rel FROM ba_items WHERE id = ?');
  const seenItems = new Set();
  for (const styleRow of FINE_STYLES) {
    for (const scheme of SCHEMES[styleRow.id] || []) {
      plan.validation.schemes += 1;
      for (const s of scheme.slots) {
        plan.validation.slots += 1;
        if (seenItems.has(s.item_id)) continue;
        seenItems.add(s.item_id);
        const row = itemStmt.get(s.item_id);
        if (!row) plan.validation.missing_items.push({ scheme: scheme.id, item_id: s.item_id, reason: 'not_found' });
        else if (!row.preview_rel) plan.validation.missing_items.push({ scheme: scheme.id, item_id: s.item_id, reason: 'no_preview' });
      }
    }
  }

  for (const styleRow of FINE_STYLES) {
    if (styleFilter.length && !styleFilter.includes(styleRow.id) && !styleFilter.includes(styleRow.parent_style_key)) continue;
    const schemes = SCHEMES[styleRow.id] || [];
    if (!schemes.length) plan.skipped.push(styleRow.id);
    plan.styles.push({ id: styleRow.id, name_zh: styleRow.name_zh, schemes: schemes.length });
    if (dryRun) {
      plan.schemes += schemes.length;
      continue;
    }
    upsertStyle(db, { ...styleRow, source: 'human' });
    schemes.forEach((scheme, index) => {
      upsertScheme(db, {
        ...scheme,
        style_id: styleRow.id,
        style_leaf: styleRow.parent_style_key,
        sort: index
      });
      plan.schemes += 1;
    });
  }

  // 旧的美式乡村孤儿方案（style_id 为空）挂到精细风格下，保持每风格恰好 2 套：
  // 本次 42 套已完整覆盖 american_country，旧两套保留但软删除，避免同风格出现 4 套。
  if (!dryRun) {
    db.prepare(`
      UPDATE ba_schemes SET deleted_at = ?, updated_at = ?
      WHERE id IN ('us_walnut_beam', 'us_oak_cream') AND deleted_at IS NULL
    `).run(now, now);
    plan.archived_legacy = ['us_walnut_beam', 'us_oak_cream'];
  } else {
    plan.archived_legacy = ['us_walnut_beam', 'us_oak_cream'];
  }

  return { ...plan, dry_run: dryRun, generated_at: now };
}

module.exports = { FINE_STYLES, SCHEMES, seedStyleSchemes };
