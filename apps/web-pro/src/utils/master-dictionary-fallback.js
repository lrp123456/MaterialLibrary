/**
 * 空间编辑 Master 字典前端离线兜底与美学赋名模块
 * 确保离线/弱网/极速加载时 100% 具备 8 大部位、12 大基材及常用色卡，消灭空白态
 */

export const FALLBACK_PARTS = [
  {
    id: 'wall',
    name_zh: '墙面 / 背景墙',
    name_en: 'interior wall',
    default_category_id: 'mat_cat_latex',
    sort_order: 10
  },
  {
    id: 'ceiling',
    name_zh: '天花板 / 吊顶',
    name_en: 'interior ceiling',
    default_category_id: 'mat_cat_latex',
    sort_order: 20
  },
  {
    id: 'floor',
    name_zh: '地面',
    name_en: 'flooring surface',
    default_category_id: 'mat_cat_wood_floor',
    sort_order: 30
  },
  {
    id: 'upholstery',
    name_zh: '软体家具（沙发/床头/软包）',
    name_en: 'upholstered furniture',
    default_category_id: 'mat_cat_leather',
    sort_order: 40
  },
  {
    id: 'cabinet_door',
    name_zh: '定制柜体 / 柜门 / 台面',
    name_en: 'cabinet door and countertop',
    default_category_id: 'mat_cat_cabinet_lacquer',
    sort_order: 50
  },
  {
    id: 'curtain_bedding',
    name_zh: '窗帘 / 抱枕 / 床品布艺',
    name_en: 'curtains and textiles',
    default_category_id: 'mat_cat_textile_drapery',
    sort_order: 60
  },
  {
    id: 'rug',
    name_zh: '地毯',
    name_en: 'carpet and area rug',
    default_category_id: 'mat_cat_carpet',
    sort_order: 70
  },
  {
    id: 'hard_furniture',
    name_zh: '硬质家具 / 桌几 / 金属构件',
    name_en: 'hard furniture and fixtures',
    default_category_id: 'mat_cat_wood_panel',
    sort_order: 80
  }
];

export const FALLBACK_CATEGORIES = [
  {
    id: 'mat_cat_latex',
    name_zh: '乳胶漆 / 纯色涂料',
    track_mode: 'track_a',
    allowed_parts: ['wall', 'ceiling'],
    default_finish_id: 'roller_matte',
    finishes: [
      { id: 'roller_matte', name_zh: '平涂哑光滚涂', prompt_zh: '微质感滚涂哑光乳胶漆肌理，光泽柔和漫反射' },
      { id: 'eggshell', name_zh: '蛋壳光 / 柔丝光', prompt_zh: '蛋壳光柔和微光泽，如珍珠般细腻低反光' }
    ],
    sort_order: 10
  },
  {
    id: 'mat_cat_art_plaster',
    name_zh: '艺术漆 / 微水泥 / 灰泥',
    track_mode: 'hybrid',
    allowed_parts: ['wall', 'ceiling', 'floor'],
    default_finish_id: 'trowel_microcement',
    finishes: [
      { id: 'trowel_microcement', name_zh: '手批批刮微水泥', prompt_zh: '无缝微水泥质感，带有手工批刮痕迹与自然斑驳明暗微纹理' },
      { id: 'velvet_stucco', name_zh: '天鹅绒艺术漆', prompt_zh: '天鹅绒珠光艺术漆，随光线角度产生阴阳渐变光泽' },
      { id: 'lime_rammed', name_zh: '粗粝石灰夯土', prompt_zh: '天然夯土与粗砂石灰肌理，质朴侘寂透气凹凸触感' }
    ],
    sort_order: 20
  },
  {
    id: 'mat_cat_leather',
    name_zh: '头层真皮 / 纳帕皮 / 油蜡皮',
    track_mode: 'track_a',
    allowed_parts: ['upholstery', 'hard_furniture'],
    default_finish_id: 'nappa_full_grain',
    finishes: [
      { id: 'nappa_full_grain', name_zh: '意大利纳帕头层皮', prompt_zh: '细腻极简纳帕真皮纹理，触感温润微孔透气，天然细致摔纹' },
      { id: 'vintage_oil_wax', name_zh: '复古油蜡牛皮质感', prompt_zh: '复古变色油蜡真皮，褶皱处呈现自然的深浅双色油润光泽' },
      { id: 'suede_nubuck', name_zh: '磨砂皮 / 翻毛牛皮', prompt_zh: '哑光磨砂翻毛牛皮触感，短绒漫反射，质感沉稳' }
    ],
    sort_order: 30
  },
  {
    id: 'mat_cat_fabric_upholstery',
    name_zh: '沙发软包布艺 / 圈绒 / 丝绒',
    track_mode: 'hybrid',
    allowed_parts: ['upholstery', 'hard_furniture'],
    default_finish_id: 'boucle_textured',
    finishes: [
      { id: 'boucle_textured', name_zh: '羊羔绒 / 颗粒圈绒', prompt_zh: '法式羊羔绒圈绒肌理，蓬松颗粒感与立体织造阴影' },
      { id: 'cotton_linen_heavy', name_zh: '重磅亚麻混纺', prompt_zh: '天然重磅棉麻平纹交织，经纬线清晰透气，质朴厚实' },
      { id: 'high_end_velvet', name_zh: '高定丝绒 / 天鹅绒', prompt_zh: '高定丝绒面料，光泽深邃垂顺，顺逆毛产生奢华反光' },
      { id: 'chenille_soft', name_zh: '亲肤雪尼尔', prompt_zh: '丰满雪尼尔纱线触感，微绒温润，立体柔软' }
    ],
    sort_order: 40
  },
  {
    id: 'mat_cat_wood_panel',
    name_zh: '实木护墙板 / 木饰面 / 木皮',
    track_mode: 'hybrid',
    allowed_parts: ['wall', 'cabinet_door', 'hard_furniture'],
    default_finish_id: 'wood_grain_straight',
    finishes: [
      { id: 'wood_grain_straight', name_zh: '直纹平铺木饰面', prompt_zh: '天然原木直纹木饰面，木纹清爽利落，开放漆微孔触感' },
      { id: 'wood_grain_mountain', name_zh: '大山纹拼花木皮', prompt_zh: '大山纹自然原木拼花，山水般舒展木结与层次纹理' },
      { id: 'fluted_wood_slats', name_zh: '实木格栅 / 长城板', prompt_zh: '立体实木格栅凹凸长城板造型，等间距竖向光影层次' }
    ],
    sort_order: 50
  },
  {
    id: 'mat_cat_wood_floor',
    name_zh: '实木木地板 / 复合地板',
    track_mode: 'hybrid',
    allowed_parts: ['floor'],
    default_finish_id: 'floor_plank_straight',
    finishes: [
      { id: 'floor_plank_straight', name_zh: '工字平铺大板', prompt_zh: '超长超宽工字缝实木大板，倒微V缝，微浮雕木纹脚感' },
      { id: 'floor_herringbone', name_zh: '法式人字拼 (Herringbone)', prompt_zh: '90度直角法式人字拼花地板，古典几何韵律与双向反光' },
      { id: 'floor_chevron', name_zh: '45度鱼骨拼 (Chevron)', prompt_zh: '45度尖角连续鱼骨拼花地板，延伸空间纵深感' }
    ],
    sort_order: 60
  },
  {
    id: 'mat_cat_stone',
    name_zh: '大理石 / 洞石 / 岩板 / 水磨石',
    track_mode: 'track_b',
    allowed_parts: ['wall', 'floor', 'cabinet_door', 'hard_furniture'],
    default_finish_id: 'stone_honed_matte',
    finishes: [
      { id: 'stone_honed_matte', name_zh: '哑光亚光面 (Honed)', prompt_zh: '亚光哑光打磨石材表面，触感温润不反强光，保留原石质感' },
      { id: 'stone_polished_high', name_zh: '亮光镜面抛光 (Polished)', prompt_zh: '高光镜面抛光大理石，清澈倒影与奢华晶体透光感' },
      { id: 'stone_leathered', name_zh: '复古皮革面 / 荔枝面', prompt_zh: '微浮雕皮革面触感，凹凸微肌理，防滑且富有手工岁月感' }
    ],
    sort_order: 70
  },
  {
    id: 'mat_cat_cabinet_lacquer',
    name_zh: '定制柜门烤漆 / PET / 肤感膜',
    track_mode: 'track_a',
    allowed_parts: ['cabinet_door'],
    default_finish_id: 'skin_feel_pet',
    finishes: [
      { id: 'skin_feel_pet', name_zh: '极致肤感微晶板 (Skin-Feel)', prompt_zh: '抗指纹超哑肤感膜，婴儿肌肤般温润触感，全消光无反光' },
      { id: 'piano_lacquer_high', name_zh: '高定钢琴烤漆', prompt_zh: '高丰满度镜面高光钢琴烤漆，光泽晶莹饱满无波纹' },
      { id: 'metal_edge_recessed', name_zh: '金属内嵌无拉手极简门板', prompt_zh: '极简免拉手柜门，45度斜边内嵌黑钛/香槟金收口条' }
    ],
    sort_order: 80
  },
  {
    id: 'mat_cat_metal',
    name_zh: '金属五金 / 拉丝黄铜 / 黑钛',
    track_mode: 'track_a',
    allowed_parts: ['hard_furniture', 'cabinet_door'],
    default_finish_id: 'brushed_metal',
    finishes: [
      { id: 'brushed_metal', name_zh: '精细拉丝纹理 (Brushed)', prompt_zh: '细腻平行金属拉丝纹理，各向异性柔和金属高光' },
      { id: 'sandblasted_matte', name_zh: '阳极氧化喷砂哑光', prompt_zh: '超细微喷砂阳极氧化工艺，柔和哑光漫反射金属质感' },
      { id: 'mirror_chrome', name_zh: '电镀镜面抛光', prompt_zh: '镜面镀铬抛光金属，清脆锋利的环境光反射' }
    ],
    sort_order: 90
  },
  {
    id: 'mat_cat_glass',
    name_zh: '玻璃镜面 / 长虹 / 灰茶玻',
    track_mode: 'track_a',
    allowed_parts: ['cabinet_door', 'hard_furniture'],
    default_finish_id: 'fluted_reeded_glass',
    finishes: [
      { id: 'fluted_reeded_glass', name_zh: '超白长虹竖条纹玻璃', prompt_zh: '超白长虹玻璃立挺竖纹折射，透光不透人的朦胧光影' },
      { id: 'tinted_translucent', name_zh: '透明有色灰/茶玻璃', prompt_zh: '高级灰/茶色通透钢化玻璃，通透低调的现代悬浮感' },
      { id: 'frosted_acid_etched', name_zh: '玉砂蒙砂半透玻璃', prompt_zh: '均匀酸洗玉砂蒙砂玻璃，极度柔和的雾面透光效果' }
    ],
    sort_order: 100
  },
  {
    id: 'mat_cat_textile_drapery',
    name_zh: '窗帘床品 / 棉麻纱帘',
    track_mode: 'track_a',
    allowed_parts: ['curtain_bedding'],
    default_finish_id: 'linen_drape',
    finishes: [
      { id: 'linen_drape', name_zh: '原生态高支麻纱垂帘', prompt_zh: '透光棉麻纱帘，微风般的垂坠折痕与柔和日光透射' },
      { id: 'blackout_soft_drape', name_zh: '定型遮光高密垂感布', prompt_zh: '高密厚实遮光垂帘，精准定型大折波浪，触感细腻沉重' }
    ],
    sort_order: 110
  },
  {
    id: 'mat_cat_carpet',
    name_zh: '地毯织物 / 羊毛圈绒',
    track_mode: 'hybrid',
    allowed_parts: ['rug'],
    default_finish_id: 'wool_cut_pile',
    finishes: [
      { id: 'wool_cut_pile', name_zh: '新西兰纯羊毛密割绒', prompt_zh: '密实细腻新西兰羊毛割绒，脚感厚实柔软，吸音低反光' },
      { id: 'loop_flatweave_sisal', name_zh: '天然剑麻平织地毯', prompt_zh: '质朴剑麻平织纹理，紧密质朴的编织网格触感' }
    ],
    sort_order: 120
  }
];

export const FALLBACK_SWATCHES = {
  mat_cat_latex: [
    { id: 'sw_latex_nippon_ow067_4', category_id: 'mat_cat_latex', item_type: 'solid_color', name_zh: '珍珠白', brand: '立邦', code: 'OW067-4', hex: '#F5EFE6', lrv: 86, color_family: 'off_white', pinned: true, sort_order: 1 },
    { id: 'sw_latex_nippon_ow033_4', category_id: 'mat_cat_latex', item_type: 'solid_color', name_zh: '菱花白', brand: '立邦', code: 'OW033-4', hex: '#F2EEE7', lrv: 84, color_family: 'off_white', pinned: true, sort_order: 2 },
    { id: 'sw_latex_dulux_30yy_78_035', category_id: 'mat_cat_latex', item_type: 'solid_color', name_zh: '奶油泡芙', brand: '多乐士', code: '30YY 78/035', hex: '#EFEAD8', lrv: 82, color_family: 'off_white', pinned: true, sort_order: 3 },
    { id: 'sw_latex_nippon_nn0107_4', category_id: 'mat_cat_latex', item_type: 'solid_color', name_zh: '可可蛋奶', brand: '立邦', code: 'NN0107-4', hex: '#E6DAC6', lrv: 72, color_family: 'beige_brown', pinned: true, sort_order: 6 },
    { id: 'sw_latex_nippon_nn0177_4', category_id: 'mat_cat_latex', item_type: 'solid_color', name_zh: '杏子灰', brand: '立邦', code: 'NN0177-4', hex: '#D6C9B8', lrv: 62, color_family: 'beige_brown', pinned: true, sort_order: 7 },
    { id: 'sw_latex_dulux_30yy_69_048', category_id: 'mat_cat_latex', item_type: 'solid_color', name_zh: '鹅绒暖灰', brand: '多乐士', code: '30YY 69/048', hex: '#DDD7CD', lrv: 68, color_family: 'warm_gray', pinned: true, sort_order: 10 },
    { id: 'sw_latex_nippon_nn7851_4', category_id: 'mat_cat_latex', item_type: 'solid_color', name_zh: '太空漫步', brand: '立邦', code: 'NN7851-4', hex: '#D5D7D8', lrv: 67, color_family: 'cool_gray', pinned: true, sort_order: 13 },
    { id: 'sw_latex_nippon_gn5310_4', category_id: 'mat_cat_latex', item_type: 'solid_color', name_zh: '鼠尾草绿', brand: '立邦', code: 'GN5310-4', hex: '#C7D0C2', lrv: 60, color_family: 'green_blue', pinned: true, sort_order: 15 }
  ],
  mat_cat_leather: [
    { id: 'sw_lth_saddle_brown', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '意式马鞍棕', brand: '意式纳帕皮色卡', code: 'LTH-SaddleBrown', hex: '#8B4A2B', lrv: 14, color_family: 'beige_brown', pinned: true, sort_order: 1 },
    { id: 'sw_lth_obsidian', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '曜石黑真皮', brand: '经典包豪斯色卡', code: 'LTH-Obsidian', hex: '#232325', lrv: 4, color_family: 'cool_gray', pinned: true, sort_order: 2 },
    { id: 'sw_lth_caramel', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '复古焦糖棕', brand: '意式纳帕皮色卡', code: 'LTH-Caramel', hex: '#A65E36', lrv: 20, color_family: 'beige_brown', pinned: true, sort_order: 3 },
    { id: 'sw_lth_cognac', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '干邑暖棕', brand: '复古油蜡皮色卡', code: 'LTH-Cognac', hex: '#945232', lrv: 16, color_family: 'beige_brown', pinned: true, sort_order: 4 },
    { id: 'sw_lth_mocha', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '摩卡深咖', brand: '奢品皮料色卡', code: 'LTH-Mocha', hex: '#4A352A', lrv: 7, color_family: 'beige_brown', pinned: true, sort_order: 5 },
    { id: 'sw_lth_etoupe', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '大象灰（爱马仕灰）', brand: '奢品皮料色卡', code: 'LTH-Etoupe', hex: '#8D847B', lrv: 27, color_family: 'warm_gray', pinned: true, sort_order: 6 },
    { id: 'sw_lth_milk_tea', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '浅驼奶茶皮', brand: '意式纳帕皮色卡', code: 'LTH-MilkTea', hex: '#C5A88E', lrv: 44, color_family: 'beige_brown', pinned: true, sort_order: 7 },
    { id: 'sw_lth_ivory_white', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '象牙奶油白皮', brand: '意式纳帕皮色卡', code: 'LTH-IvoryWhite', hex: '#EFEBE3', lrv: 83, color_family: 'off_white', pinned: true, sort_order: 8 }
  ],
  mat_cat_fabric_upholstery: [
    { id: 'sw_fab_boucle_white', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '羊羔绒云朵白', brand: '法式圈绒', code: 'FAB-Boucle-01', hex: '#F4EFE6', lrv: 86, color_family: 'off_white', pinned: true, sort_order: 1 },
    { id: 'sw_fab_linen_oat', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '燕麦原麻色', brand: '天然棉麻', code: 'FAB-Linen-02', hex: '#DFD3C3', lrv: 66, color_family: 'beige_brown', pinned: true, sort_order: 2 },
    { id: 'sw_fab_chenille_apricot', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '暖杏雪尼尔', brand: '重磅雪尼尔', code: 'FAB-Chenille-03', hex: '#CFBFA8', lrv: 55, color_family: 'beige_brown', pinned: true, sort_order: 3 },
    { id: 'sw_fab_linen_taupe', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '亚麻灰褐（Taupe）', brand: '意式亚麻', code: 'FAB-Linen-04', hex: '#A89C90', lrv: 35, color_family: 'warm_gray', pinned: true, sort_order: 4 },
    { id: 'sw_fab_chenille_charcoal', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '炭灰雪尼尔', brand: '重磅雪尼尔', code: 'FAB-Chenille-05', hex: '#585654', lrv: 11, color_family: 'cool_gray', pinned: true, sort_order: 5 }
  ],
  mat_cat_wood_floor: [
    { id: 'sw_flr_white_oak', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '北欧漂白橡木地板', brand: '天然原木色卡', code: 'FLR-WhiteOak-01', hex: '#DFCBB2', lrv: 62, color_family: 'beige_brown', pinned: true, sort_order: 1 },
    { id: 'sw_flr_natural_oak', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '日式原木暖橡地板', brand: '天然原木色卡', code: 'FLR-NaturalOak-02', hex: '#C8A97E', lrv: 44, color_family: 'beige_brown', pinned: true, sort_order: 2 },
    { id: 'sw_flr_cherry', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '蜂蜜暖调樱桃木地板', brand: '天然原木色卡', code: 'FLR-Cherry-03', hex: '#B37A4C', lrv: 26, color_family: 'beige_brown', pinned: true, sort_order: 3 },
    { id: 'sw_flr_teak', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '中古缅甸柚木地板', brand: '天然原木色卡', code: 'FLR-Teak-04', hex: '#965D34', lrv: 18, color_family: 'beige_brown', pinned: true, sort_order: 4 },
    { id: 'sw_flr_walnut', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '北美黑胡桃地板', brand: '天然原木色卡', code: 'FLR-Walnut-05', hex: '#5C4030', lrv: 8, color_family: 'beige_brown', pinned: true, sort_order: 5 },
    { id: 'sw_flr_smoked_oak', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '烟熏炭化乌木地板', brand: '天然原木色卡', code: 'FLR-SmokedOak-06', hex: '#362D28', lrv: 5, color_family: 'cool_gray', pinned: true, sort_order: 6 }
  ],
  mat_cat_art_plaster: [
    { id: 'sw_mc_bone_white', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '侘寂骨白微水泥', brand: '磐多魔/西卡参考', code: 'MC-01 Bone', hex: '#EAE4DC', lrv: 78, color_family: 'off_white', pinned: true, sort_order: 1 },
    { id: 'sw_mc_ivory', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '荒漠象牙微水泥', brand: '磐多魔/西卡参考', code: 'MC-02 Ivory', hex: '#DFD5C7', lrv: 67, color_family: 'beige_brown', pinned: true, sort_order: 2 },
    { id: 'sw_mc_warm_stone', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '岩石暖灰微水泥', brand: '磐多魔/西卡参考', code: 'MC-03 Warm Stone', hex: '#C2B9AE', lrv: 50, color_family: 'warm_gray', pinned: true, sort_order: 3 },
    { id: 'sw_mc_pandomo_sand', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '磐多魔暖沙灰', brand: '磐多魔/西卡参考', code: 'MC-05 Sand', hex: '#D3C9BC', lrv: 59, color_family: 'warm_gray', pinned: true, sort_order: 6 },
    { id: 'sw_mc_lime_rammed', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '石灰夯土暖褐', brand: '天然石灰夯土', code: 'MC-06 Rammed', hex: '#9E7D63', lrv: 24, color_family: 'beige_brown', pinned: true, sort_order: 7 }
  ],
  mat_cat_wood_panel: [
    { id: 'sw_wd_white_oak', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '北欧漂白橡木', brand: '天然原木色卡', code: 'WD-WhiteOak-01', hex: '#DFCBB2', lrv: 62, color_family: 'beige_brown', pinned: true, sort_order: 1 },
    { id: 'sw_wd_natural_oak', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '日式原木暖橡', brand: '天然原木色卡', code: 'WD-NaturalOak-02', hex: '#C8A97E', lrv: 44, color_family: 'beige_brown', pinned: true, sort_order: 2 },
    { id: 'sw_wd_cherry', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '蜂蜜暖调樱桃木', brand: '天然原木色卡', code: 'WD-Cherry-03', hex: '#B37A4C', lrv: 26, color_family: 'beige_brown', pinned: true, sort_order: 3 },
    { id: 'sw_wd_walnut', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '北美黑胡桃暖褐', brand: '天然原木色卡', code: 'WD-Walnut-05', hex: '#5C4030', lrv: 8, color_family: 'beige_brown', pinned: true, sort_order: 5 }
  ],
  mat_cat_stone: [
    { id: 'sw_stn_carrara_map', category_id: 'mat_cat_stone', item_type: 'texture_map', name_zh: '卡拉拉鱼肚白大理石（1K）', brand: '天然石材', code: 'mat_calacatta_marble', hex: '#ECEAE6', lrv: 82, color_family: 'off_white', pinned: true, sort_order: 1 },
    { id: 'sw_stn_travertine_map', category_id: 'mat_cat_stone', item_type: 'texture_map', name_zh: '意大利罗马米白洞石（1K）', brand: '天然石材', code: 'mat_roman_travertine', hex: '#D8CBB8', lrv: 61, color_family: 'beige_brown', pinned: true, sort_order: 2 },
    { id: 'sw_stn_bulgari', category_id: 'mat_cat_stone', item_type: 'solid_color', name_zh: '宝格丽黑金紫奢石', brand: '天然奢石花色', code: 'STN-Bulgari', hex: '#3A3235', lrv: 6, color_family: 'cool_gray', pinned: true, sort_order: 4 },
    { id: 'sw_stn_prada_green', category_id: 'mat_cat_stone', item_type: 'solid_color', name_zh: '普拉达绿天然大理石', brand: '天然奢石花色', code: 'STN-PradaGreen', hex: '#3B5244', lrv: 10, color_family: 'green_blue', pinned: true, sort_order: 5 }
  ],
  mat_cat_cabinet_lacquer: [
    { id: 'sw_cab_kemi_white', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '科米白（暖调肤感白）', brand: '定制柜门色卡', code: 'CAB-01', hex: '#F3EFE8', lrv: 85, color_family: 'off_white', pinned: true, sort_order: 1 },
    { id: 'sw_cab_cashmere', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '羊绒暖杏（Cashmere）', brand: '爱格W1000平替', code: 'CAB-02', hex: '#E2D7C7', lrv: 69, color_family: 'beige_brown', pinned: true, sort_order: 2 },
    { id: 'sw_cab_rock_gray', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '岩石暖灰（U702平替）', brand: '爱格U702平替', code: 'CAB-03', hex: '#B8B0A6', lrv: 46, color_family: 'warm_gray', pinned: true, sort_order: 3 },
    { id: 'sw_cab_graphite', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '石墨深灰（U961平替）', brand: '爱格U961平替', code: 'CAB-04', hex: '#3D3C3A', lrv: 7, color_family: 'cool_gray', pinned: true, sort_order: 4 }
  ],
  mat_cat_metal: [
    { id: 'sw_mtl_brushed_brass', category_id: 'mat_cat_metal', item_type: 'solid_color', name_zh: '拉丝黄铜 / 复古金色', brand: '意式五金', code: 'MTL-01', hex: '#C59B5F', lrv: 38, color_family: 'yellow_gold', pinned: true, sort_order: 1 },
    { id: 'sw_mtl_black_titanium', category_id: 'mat_cat_metal', item_type: 'solid_color', name_zh: '哑光黑钛 / 磨砂黑', brand: '黑钛五金', code: 'MTL-03', hex: '#28282A', lrv: 4, color_family: 'cool_gray', pinned: true, sort_order: 3 }
  ],
  mat_cat_glass: [
    { id: 'sw_gls_fluted', category_id: 'mat_cat_glass', item_type: 'solid_color', name_zh: '超白长虹竖纹玻璃', brand: '定制玻璃', code: 'GLS-01', hex: '#E4ECEE', lrv: 80, color_family: 'off_white', pinned: true, sort_order: 1 },
    { id: 'sw_gls_tinted_tea', category_id: 'mat_cat_glass', item_type: 'solid_color', name_zh: '意式茶色透明玻璃', brand: '钢化玻璃', code: 'GLS-02', hex: '#6E5849', lrv: 14, color_family: 'beige_brown', pinned: true, sort_order: 2 }
  ],
  mat_cat_textile_drapery: [
    { id: 'sw_drp_sheer_white', category_id: 'mat_cat_textile_drapery', item_type: 'solid_color', name_zh: '极简幻影透光白纱', brand: '高定纱帘', code: 'DRP-01', hex: '#FAF8F5', lrv: 93, color_family: 'off_white', pinned: true, sort_order: 1 },
    { id: 'sw_drp_linen_oat', category_id: 'mat_cat_textile_drapery', item_type: 'solid_color', name_zh: '燕麦色原麻窗帘', brand: '天然棉麻', code: 'DRP-02', hex: '#D7CABE', lrv: 60, color_family: 'beige_brown', pinned: true, sort_order: 2 },
    { id: 'sw_drp_taupe_drape', category_id: 'mat_cat_textile_drapery', item_type: 'solid_color', name_zh: '灰咖色垂感绒布', brand: '高密遮光布', code: 'DRP-04', hex: '#877B73', lrv: 23, color_family: 'warm_gray', pinned: true, sort_order: 4 }
  ],
  mat_cat_carpet: [
    { id: 'sw_cpt_cream_wool', category_id: 'mat_cat_carpet', item_type: 'solid_color', name_zh: '奶油白密割绒羊毛毯', brand: '新西兰羊毛', code: 'CPT-01', hex: '#F0ECE1', lrv: 83, color_family: 'off_white', pinned: true, sort_order: 1 },
    { id: 'sw_cpt_sand_sisal', category_id: 'mat_cat_carpet', item_type: 'solid_color', name_zh: '暖沙色剑麻平织地毯', brand: '天然剑麻', code: 'CPT-02', hex: '#CFBEA7', lrv: 54, color_family: 'beige_brown', pinned: true, sort_order: 2 },
    { id: 'sw_cpt_morandi_gray', category_id: 'mat_cat_carpet', item_type: 'solid_color', name_zh: '莫兰迪冷灰短绒毯', brand: '高密短绒', code: 'CPT-03', hex: '#9E9E9C', lrv: 36, color_family: 'cool_gray', pinned: true, sort_order: 3 }
  ]
};

export const FALLBACK_DICTIONARY = {
  parts: FALLBACK_PARTS,
  categories: FALLBACK_CATEGORIES,
  all_categories: FALLBACK_CATEGORIES,
  swatches: FALLBACK_SWATCHES
};

/**
 * 欧几里得 RGB 近似色彩差异
 */
function rgbDelta(hex1, hex2) {
  const parse = (h) => {
    let c = String(h || '').replace(/^#/, '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16) || 0;
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  };
  const [r1, g1, b1] = parse(hex1);
  const [r2, g2, b2] = parse(hex2);
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 10;
}

/**
 * 将十六进制颜色解析为 HSL
 */
export function hexToHslValues(hex) {
  let c = String(hex || '').replace(/^#/, '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16) || 0;
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

/**
 * 本地实时室内设计美学色彩赋名：彻底消灭「自定义色 (#...)」
 * 任意调色盘拖动或吸管拾色即时生成诸如「曜石深炭真皮」「温润焦糖暖棕皮」「奶油米杏雪尼尔」
 */
export function generateLocalAestheticName(hex, categoryId = 'mat_cat_latex', existingSwatches = []) {
  const normHex = String(hex || '#8B4A2B').trim().toUpperCase();

  // 1. 若在当前色卡库中有最近邻 (ΔE <= 5.5)，直接返回该色卡名称
  const pool = (Array.isArray(existingSwatches) && existingSwatches.length > 0)
    ? existingSwatches
    : (FALLBACK_SWATCHES[categoryId] || FALLBACK_SWATCHES.mat_cat_latex);

  let bestMatch = null;
  let minDelta = 999;
  for (const item of pool) {
    if (!item.hex) continue;
    const d = rgbDelta(normHex, item.hex);
    if (d < minDelta) {
      minDelta = d;
      bestMatch = item;
    }
  }
  if (bestMatch && minDelta <= 5.5) {
    return bestMatch.name_zh;
  }

  // 2. 根据 HSL 派生美学中文命名
  const { h, s, l } = hexToHslValues(normHex);

  // 明度前缀
  let lightPrefix = '雅致中调';
  if (l < 18) {
    lightPrefix = '曜石深炭';
  } else if (l < 35) {
    lightPrefix = '浓郁复古';
  } else if (l < 65) {
    lightPrefix = '温润素雅';
  } else if (l < 82) {
    lightPrefix = '柔光奶油';
  } else {
    lightPrefix = '云朵浅白';
  }

  // 色相主词
  let hueWord = '原色';
  if (s < 12) {
    hueWord = l > 60 ? '暖灰' : '冷灰';
  } else if (h >= 345 || h < 15) {
    hueWord = s > 50 ? '赤陶红' : '茱萸粉';
  } else if (h >= 15 && h < 45) {
    if (l < 30) hueWord = '深咖暖棕';
    else if (l < 55) hueWord = '焦糖暖棕';
    else hueWord = '米杏驼色';
  } else if (h >= 45 && h < 75) {
    hueWord = l > 70 ? '奶油香草' : '复古姜黄';
  } else if (h >= 75 && h < 165) {
    hueWord = l < 35 ? '墨绿' : '鼠尾草绿';
  } else if (h >= 165 && h < 260) {
    hueWord = l < 35 ? '藏蓝' : '迷雾蓝灰';
  } else if (h >= 260 && h < 345) {
    hueWord = '莫兰迪紫灰';
  }

  // 材质词尾
  let matSuffix = '';
  if (categoryId === 'mat_cat_leather') {
    matSuffix = '真皮';
  } else if (categoryId === 'mat_cat_fabric_upholstery') {
    matSuffix = '布艺';
  } else if (categoryId === 'mat_cat_wood_panel' || categoryId === 'mat_cat_wood_floor') {
    matSuffix = '木纹';
  } else if (categoryId === 'mat_cat_latex') {
    matSuffix = '柔光漆';
  } else if (categoryId === 'mat_cat_art_plaster') {
    matSuffix = '微水泥';
  } else if (categoryId === 'mat_cat_stone') {
    matSuffix = '大理石';
  } else if (categoryId === 'mat_cat_cabinet_lacquer') {
    matSuffix = '肤感板';
  } else if (categoryId === 'mat_cat_textile_drapery') {
    matSuffix = '垂帘';
  } else if (categoryId === 'mat_cat_carpet') {
    matSuffix = '羊毛毯';
  }

  return `${lightPrefix}${hueWord}${matSuffix}`;
}
