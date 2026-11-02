/**
 * 室内设计「部位 ↔ 基材品类 ↔ 专属色卡/纹理花色」Master 权威全量字典种子
 * 包含 8 大空间部位、12 大基材品类、专属表面工艺与全部精选美学色卡/纹理资产。
 */

const { calculateLrv, deriveColorFamily } = require('./color-engine');
const { CURATED_PAINTS } = require('./curated-paints');

function mapLegacyPaintFamily(familyKey, hex) {
  const normKey = (familyKey || '').toLowerCase();
  if (normKey === 'warm_white' || normKey === 'cream' || normKey === 'ivory') return 'off_white';
  if (normKey === 'greige' || normKey === 'caramel' || normKey === 'earth_brown') return 'beige_brown';
  if (normKey === 'earth' || normKey === 'morandi' || normKey === 'taupe') return 'warm_gray';
  if (normKey === 'cool_gray' || normKey === 'ink' || normKey === 'slate') return 'cool_gray';
  if (normKey === 'green' || normKey === 'blue' || normKey === 'green_blue') return 'green_blue';
  if (normKey === 'terracotta_red' || normKey === 'red' || normKey === 'pink') return 'terracotta_red';
  if (normKey === 'yellow_gold' || normKey === 'gold' || normKey === 'yellow') return 'yellow_gold';
  return deriveColorFamily(hex);
}

// 1. 8 大空间部位定义 (对齐 JEV 识别别名与保持句)
const MASTER_PARTS = [
  {
    id: 'wall',
    name_zh: '墙面 / 背景墙',
    name_en: 'interior wall',
    jev_aliases: JSON.stringify(['墙面', '背景墙', '墙体', 'wall']),
    preserve_clause_zh: '保持原有墙面透视、门窗边界、踢脚线与室内自然光影过渡',
    preserve_clause_en: 'maintain original wall perspective, door and window boundaries, baseboards and natural lighting transition',
    default_category_id: 'mat_cat_latex',
    sort_order: 10,
    is_system: 1
  },
  {
    id: 'ceiling',
    name_zh: '天花板 / 吊顶',
    name_en: 'interior ceiling',
    jev_aliases: JSON.stringify(['天花板', '吊顶', '顶面', 'ceiling']),
    preserve_clause_zh: '保持原有吊顶造型、灯具开孔、灯带漫反射与空间光影',
    preserve_clause_en: 'preserve original ceiling structure, recessed light cutouts, linear cove lighting and soft ambient shadow',
    default_category_id: 'mat_cat_latex',
    sort_order: 20,
    is_system: 1
  },
  {
    id: 'floor',
    name_zh: '地面',
    name_en: 'flooring surface',
    jev_aliases: JSON.stringify(['地面', '地板', '地砖', 'floor']),
    preserve_clause_zh: '保持原有地面透视、家具落地的接触阴影与环境漫反射',
    preserve_clause_en: 'maintain original floor perspective, contact shadows beneath furniture and soft diffuse reflections',
    default_category_id: 'mat_cat_wood_floor',
    sort_order: 30,
    is_system: 1
  },
  {
    id: 'upholstery',
    name_zh: '软体家具（沙发/床头/软包）',
    name_en: 'upholstered furniture',
    jev_aliases: JSON.stringify(['沙发', '软包', '床头', '床头软包', '餐椅坐垫', '扶手椅', '单人椅', 'sofa', 'upholstery', 'furniture']),
    preserve_clause_zh: '保持原有沙发与软包造型、车缝线、褶皱深度及明暗体积光影',
    preserve_clause_en: 'strictly retain the original sofa silhouette, stitching lines, realistic organic crease depth and volumetric light and shadow',
    default_category_id: 'mat_cat_leather',
    sort_order: 40,
    is_system: 1
  },
  {
    id: 'cabinet_door',
    name_zh: '定制柜体 / 柜门 / 台面',
    name_en: 'cabinet door and countertop',
    jev_aliases: JSON.stringify(['橱柜', '衣柜', '柜门', '餐边柜', '电视柜', '岛台', '台面', 'cabinet']),
    preserve_clause_zh: '保持原有柜门分缝、拉手五金、倒角边缘与阴影遮挡关系',
    preserve_clause_en: 'preserve exact cabinet reveal gaps, handle hardware, beveled edges and ambient occlusion',
    default_category_id: 'mat_cat_cabinet_lacquer',
    sort_order: 50,
    is_system: 1
  },
  {
    id: 'curtain_bedding',
    name_zh: '窗帘 / 抱枕 / 床品布艺',
    name_en: 'curtains and textiles',
    jev_aliases: JSON.stringify(['窗帘', '纱帘', '抱枕', '床品', '搭毯', 'textile', 'curtain']),
    preserve_clause_zh: '保持原有布艺垂坠褶皱、透光柔和度与自然垂坠感',
    preserve_clause_en: 'preserve soft fabric drape ripples, translucent light filtering and organic textile fold geometry',
    default_category_id: 'mat_cat_textile_drapery',
    sort_order: 60,
    is_system: 1
  },
  {
    id: 'rug',
    name_zh: '地毯',
    name_en: 'carpet and area rug',
    jev_aliases: JSON.stringify(['地毯', '地垫', '毯子', 'rug', 'carpet']),
    preserve_clause_zh: '保持原有地毯摆位边缘、毛绒边缘微阴影与家具压痕真实感',
    preserve_clause_en: 'retain precise carpet boundary edges, micro plush contact shadows and natural indentation under furniture',
    default_category_id: 'mat_cat_carpet',
    sort_order: 70,
    is_system: 1
  },
  {
    id: 'hard_furniture',
    name_zh: '硬质家具 / 桌几 / 金属构件',
    name_en: 'hard furniture and fixtures',
    jev_aliases: JSON.stringify(['茶几', '餐桌', '椅子', '书桌', '置物架', '金属构件', '桌几', 'table', 'chair']),
    preserve_clause_zh: '保持原有家具立体三维结构、边角高光与环境镜面反射',
    preserve_clause_en: 'maintain three-dimensional edge chamfers, crisp specular highlights and realistic environmental reflections',
    default_category_id: 'mat_cat_wood_panel',
    sort_order: 80,
    is_system: 1
  }
];

// 2. 12 大基材品类定义 (严格挂载合法部位与专属表面工艺)
const MASTER_CATEGORIES = [
  {
    id: 'mat_cat_latex',
    name_zh: '乳胶漆 / 纯色涂料',
    name_en: 'latex emulsion paint',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['wall', 'ceiling']),
    default_finish_id: 'roller_matte',
    finishes_json: JSON.stringify([
      { id: 'roller_matte', name_zh: '平涂哑光滚涂', prompt_zh: '微质感滚涂哑光乳胶漆肌理，光泽柔和漫反射', prompt_en: 'matte roller emulsion wall paint, velvety diffuse reflection' },
      { id: 'eggshell', name_zh: '蛋壳光 / 柔丝光', prompt_zh: '蛋壳光柔和微光泽，如珍珠般细腻低反光', prompt_en: 'eggshell finish paint, delicate pearlescent soft sheen' }
    ]),
    sort_order: 10,
    is_system: 1
  },
  {
    id: 'mat_cat_art_plaster',
    name_zh: '艺术漆 / 微水泥 / 灰泥',
    name_en: 'microcement and art plaster',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['wall', 'ceiling', 'floor']),
    default_finish_id: 'trowel_microcement',
    finishes_json: JSON.stringify([
      { id: 'trowel_microcement', name_zh: '手批批刮微水泥', prompt_zh: '无缝微水泥质感，带有手工批刮痕迹与自然斑驳明暗微纹理', prompt_en: 'seamless microcement plaster, hand-troweled subtle organic texture' },
      { id: 'velvet_stucco', name_zh: '天鹅绒艺术漆', prompt_zh: '天鹅绒珠光艺术漆，随光线角度产生阴阳渐变光泽', prompt_en: 'velvet metallic stucco, directional luster shift with ambient light' },
      { id: 'lime_rammed', name_zh: '粗粝石灰夯土', prompt_zh: '天然夯土与粗砂石灰肌理，质朴侘寂透气凹凸触感', prompt_en: 'rammed earth texture, rustic natural lime plaster with organic grain' }
    ]),
    sort_order: 20,
    is_system: 1
  },
  {
    id: 'mat_cat_leather',
    name_zh: '头层真皮 / 纳帕皮 / 油蜡皮',
    name_en: 'genuine top-grain leather',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['upholstery', 'hard_furniture']),
    default_finish_id: 'nappa_full_grain',
    finishes_json: JSON.stringify([
      { id: 'nappa_full_grain', name_zh: '意大利纳帕头层皮', prompt_zh: '细腻极简纳帕真皮纹理，触感温润微孔透气，天然细致摔纹', prompt_en: 'Italian full-grain Nappa leather, ultra-soft micro pore natural grain' },
      { id: 'vintage_oil_wax', name_zh: '复古油蜡牛皮质感', prompt_zh: '复古变色油蜡真皮，褶皱处呈现自然的深浅双色油润光泽', prompt_en: 'vintage pull-up wax leather, organic two-tone aging luster along folds' },
      { id: 'suede_nubuck', name_zh: '磨砂皮 / 翻毛牛皮', prompt_zh: '哑光磨砂翻毛牛皮触感，短绒漫反射，质感沉稳', prompt_en: 'matte nubuck suede leather, ultra-fine velvety nap, low specular' }
    ]),
    sort_order: 30,
    is_system: 1
  },
  {
    id: 'mat_cat_fabric_upholstery',
    name_zh: '沙发软包布艺 / 圈绒 / 丝绒',
    name_en: 'upholstery fabric and boucle',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['upholstery', 'hard_furniture']),
    default_finish_id: 'boucle_textured',
    finishes_json: JSON.stringify([
      { id: 'boucle_textured', name_zh: '羊羔绒 / 颗粒圈绒', prompt_zh: '法式羊羔绒圈绒肌理，蓬松颗粒感与立体织造阴影', prompt_en: 'cozy textured boucle weave, three-dimensional looped yarn shadow' },
      { id: 'cotton_linen_heavy', name_zh: '重磅亚麻混纺', prompt_zh: '天然重磅棉麻平纹交织，经纬线清晰透气，质朴厚实', prompt_en: 'heavyweight cotton linen weave, visible warp and weft organic texture' },
      { id: 'high_end_velvet', name_zh: '高定丝绒 / 天鹅绒', prompt_zh: '高定丝绒面料，光泽深邃垂顺，顺逆毛产生奢华反光', prompt_en: 'luxury plush velvet, deep lustrous sheen, elegant directional sheen' },
      { id: 'chenille_soft', name_zh: '亲肤雪尼尔', prompt_zh: '丰满雪尼尔纱线触感，微绒温润，立体柔软', prompt_en: 'soft chenille yarn fabric, plush tactile warmth and subtle texture' }
    ]),
    sort_order: 40,
    is_system: 1
  },
  {
    id: 'mat_cat_wood_panel',
    name_zh: '实木护墙板 / 木饰面 / 木皮',
    name_en: 'wood veneer paneling',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['wall', 'cabinet_door', 'hard_furniture']),
    default_finish_id: 'wood_grain_straight',
    finishes_json: JSON.stringify([
      { id: 'wood_grain_straight', name_zh: '直纹平铺木饰面', prompt_zh: '天然原木直纹木饰面，木纹清爽利落，开放漆微孔触感', prompt_en: 'straight grain natural wood veneer, open-pore matte wood texture' },
      { id: 'wood_grain_mountain', name_zh: '大山纹拼花木皮', prompt_zh: '大山纹自然原木拼花，山水般舒展木结与层次纹理', prompt_en: 'cathedral crown cut wood veneer, fluid organic wood grain pattern' },
      { id: 'fluted_wood_slats', name_zh: '实木格栅 / 长城板', prompt_zh: '立体实木格栅凹凸长城板造型，等间距竖向光影层次', prompt_en: 'fluted vertical wooden slats, rhythmic architectural shadow reveals' }
    ]),
    sort_order: 50,
    is_system: 1
  },
  {
    id: 'mat_cat_wood_floor',
    name_zh: '实木木地板 / 复合地板',
    name_en: 'wood flooring',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['floor']),
    default_finish_id: 'floor_plank_straight',
    finishes_json: JSON.stringify([
      { id: 'floor_plank_straight', name_zh: '工字平铺大板', prompt_zh: '超长超宽工字缝实木大板，倒微V缝，微浮雕木纹脚感', prompt_en: 'wide plank wood flooring, staggered joint, micro-bevel edge relief' },
      { id: 'floor_herringbone', name_zh: '法式人字拼 (Herringbone)', prompt_zh: '90度直角法式人字拼花地板，古典几何韵律与双向反光', prompt_en: 'classic French herringbone parquet flooring, 90-degree interlocking' },
      { id: 'floor_chevron', name_zh: '45度鱼骨拼 (Chevron)', prompt_zh: '45度尖角连续鱼骨拼花地板，延伸空间纵深感', prompt_en: '45-degree chevron parquet flooring, sleek directional chevron seams' }
    ]),
    sort_order: 60,
    is_system: 1
  },
  {
    id: 'mat_cat_stone',
    name_zh: '大理石 / 洞石 / 岩板 / 水磨石',
    name_en: 'natural marble, travertine and sintered stone',
    track_mode: 'track_b',
    allowed_parts: JSON.stringify(['wall', 'floor', 'cabinet_door', 'hard_furniture']),
    default_finish_id: 'stone_honed_matte',
    finishes_json: JSON.stringify([
      { id: 'stone_honed_matte', name_zh: '哑光亚光面 (Honed)', prompt_zh: '亚光哑光打磨石材表面，触感温润不反强光，保留原石质感', prompt_en: 'honed matte stone finish, smooth tactile surface without glaring glare' },
      { id: 'stone_polished_high', name_zh: '亮光镜面抛光 (Polished)', prompt_zh: '高光镜面抛光大理石，清澈倒影与奢华晶体透光感', prompt_en: 'mirror polished high gloss marble, crystalline clarity and reflection' },
      { id: 'stone_leathered', name_zh: '复古皮革面 / 荔枝面', prompt_zh: '微浮雕皮革面触感，凹凸微肌理，防滑且富有手工岁月感', prompt_en: 'leathered antique stone finish, undulating tactile relief texture' }
    ]),
    sort_order: 70,
    is_system: 1
  },
  {
    id: 'mat_cat_cabinet_lacquer',
    name_zh: '定制柜门烤漆 / PET / 肤感膜',
    name_en: 'lacquer, PET and skin-feel cabinet finish',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['cabinet_door']),
    default_finish_id: 'skin_feel_pet',
    finishes_json: JSON.stringify([
      { id: 'skin_feel_pet', name_zh: '极致肤感微晶板 (Skin-Feel)', prompt_zh: '抗指纹超哑肤感膜，婴儿肌肤般温润触感，全消光无反光', prompt_en: 'anti-fingerprint ultra-matte skin-feel PET finish, zero-specular touch' },
      { id: 'piano_lacquer_high', name_zh: '高定钢琴烤漆', prompt_zh: '高丰满度镜面高光钢琴烤漆，光泽晶莹饱满无波纹', prompt_en: 'flawless high-gloss piano lacquer, deep mirror reflection, glass smooth' },
      { id: 'metal_edge_recessed', name_zh: '金属内嵌无拉手极简门板', prompt_zh: '极简免拉手柜门，45度斜边内嵌黑钛/香槟金收口条', prompt_en: 'j-pull recessed handle integrated channel, minimal gap reveals' }
    ]),
    sort_order: 80,
    is_system: 1
  },
  {
    id: 'mat_cat_metal',
    name_zh: '金属五金 / 拉丝黄铜 / 黑钛',
    name_en: 'architectural metal and hardware',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['hard_furniture', 'cabinet_door']),
    default_finish_id: 'brushed_metal',
    finishes_json: JSON.stringify([
      { id: 'brushed_metal', name_zh: '精细拉丝纹理 (Brushed)', prompt_zh: '细腻平行金属拉丝纹理，各向异性柔和金属高光', prompt_en: 'anisotropic brushed metal finish, subtle linear hairline grain' },
      { id: 'sandblasted_matte', name_zh: '阳极氧化喷砂哑光', prompt_zh: '超细微喷砂阳极氧化工艺，柔和哑光漫反射金属质感', prompt_en: 'sandblasted anodized matte metal, velvety diffuse metallic sheen' },
      { id: 'mirror_chrome', name_zh: '电镀镜面抛光', prompt_zh: '镜面镀铬抛光金属，清脆锋利的环境光反射', prompt_en: 'electroplated chrome mirror finish, sharp crystal reflections' }
    ]),
    sort_order: 90,
    is_system: 1
  },
  {
    id: 'mat_cat_glass',
    name_zh: '玻璃镜面 / 长虹 / 灰茶玻',
    name_en: 'architectural glass and mirror',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['cabinet_door', 'hard_furniture']),
    default_finish_id: 'fluted_reeded_glass',
    finishes_json: JSON.stringify([
      { id: 'fluted_reeded_glass', name_zh: '超白长虹竖条纹玻璃', prompt_zh: '超白长虹玻璃立挺竖纹折射，透光不透人的朦胧光影', prompt_en: 'fluted reeded ribbed glass, ultra-clear prismatic light refraction' },
      { id: 'tinted_translucent', name_zh: '透明有色灰/茶玻璃', prompt_zh: '高级灰/茶色通透钢化玻璃，通透低调的现代悬浮感', prompt_en: 'tinted smoked bronze tempered glass, translucent minimalist luxury' },
      { id: 'frosted_acid_etched', name_zh: '玉砂蒙砂半透玻璃', prompt_zh: '均匀酸洗玉砂蒙砂玻璃，极度柔和的雾面透光效果', prompt_en: 'acid-etched frosted satin glass, soft translucent glow diffusion' }
    ]),
    sort_order: 100,
    is_system: 1
  },
  {
    id: 'mat_cat_textile_drapery',
    name_zh: '窗帘床品 / 棉麻纱帘',
    name_en: 'drapery and bed textiles',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['curtain_bedding']),
    default_finish_id: 'linen_drape',
    finishes_json: JSON.stringify([
      { id: 'linen_drape', name_zh: '原生态高支麻纱垂帘', prompt_zh: '透光棉麻纱帘，微风般的垂坠折痕与柔和日光透射', prompt_en: 'linen sheer drapery, organic hanging ripples and diffused daylight' },
      { id: 'blackout_soft_drape', name_zh: '定型遮光高密垂感布', prompt_zh: '高密厚实遮光垂帘，精准定型大折波浪，触感细腻沉重', prompt_en: 'heavy blackout curtain fabric, tailored deep wave pleats' }
    ]),
    sort_order: 110,
    is_system: 1
  },
  {
    id: 'mat_cat_carpet',
    name_zh: '地毯织物 / 羊毛圈绒',
    name_en: 'carpet and area rugs',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['rug']),
    default_finish_id: 'wool_cut_pile',
    finishes_json: JSON.stringify([
      { id: 'wool_cut_pile', name_zh: '新西兰纯羊毛密割绒', prompt_zh: '密实细腻新西兰羊毛割绒，脚感厚实柔软，吸音低反光', prompt_en: 'dense New Zealand wool cut-pile rug, thick plush walking comfort' },
      { id: 'loop_flatweave_sisal', name_zh: '天然剑麻平织地毯', prompt_zh: '质朴剑麻平织纹理，紧密质朴的编织网格触感', prompt_en: 'natural sisal flatweave carpet, rustic geometric woven grain' }
    ]),
    sort_order: 120,
    is_system: 1
  }
];

// 20 款室内设计师最高频乳胶漆常用色 (pinned: 1, sort_order: 1..20)
const TOP_20_CURATED_PAINTS = [
  // off_white (暖白奶油)
  { id: 'sw_latex_nippon_ow067_4', name_zh: '珍珠白', brand: '立邦', code: 'OW067-4', hex: '#F5EFE6', color_family: 'off_white', pinned: 1, sort_order: 1 },
  { id: 'sw_latex_nippon_ow033_4', name_zh: '菱花白', brand: '立邦', code: 'OW033-4', hex: '#F2EEE7', color_family: 'off_white', pinned: 1, sort_order: 2 },
  { id: 'sw_latex_dulux_30yy_78_035', name_zh: '奶油泡芙', brand: '多乐士', code: '30YY 78/035', hex: '#EFEAD8', color_family: 'off_white', pinned: 1, sort_order: 3 },
  { id: 'sw_latex_benjamin_1624', name_zh: '象牙暖白', brand: '本杰明摩尔', code: '1624 Skylight', hex: '#F3F0E8', color_family: 'off_white', pinned: 1, sort_order: 4 },
  { id: 'sw_latex_nippon_nn2510_4', name_zh: '奶酪薄荷', brand: '立邦', code: 'NN2510-4', hex: '#E5DEC9', color_family: 'off_white', pinned: 1, sort_order: 5 },
  // beige_brown (米杏大地)
  { id: 'sw_latex_nippon_nn0107_4', name_zh: '可可蛋奶', brand: '立邦', code: 'NN0107-4', hex: '#E6DAC6', color_family: 'beige_brown', pinned: 1, sort_order: 6 },
  { id: 'sw_latex_nippon_nn0177_4', name_zh: '杏子灰', brand: '立邦', code: 'NN0177-4', hex: '#D6C9B8', color_family: 'beige_brown', pinned: 1, sort_order: 7 },
  { id: 'sw_latex_jotun_12075', name_zh: '汝窑浅驼', brand: '佐敦', code: '12075', hex: '#C8B9A6', color_family: 'beige_brown', pinned: 1, sort_order: 8 },
  { id: 'sw_latex_nippon_nn1370_3', name_zh: '焦糖拿铁', brand: '立邦', code: 'NN1370-3', hex: '#B89B7D', color_family: 'beige_brown', pinned: 1, sort_order: 9 },
  // warm_gray (暖灰侘寂)
  { id: 'sw_latex_dulux_30yy_69_048', name_zh: '鹅绒暖灰', brand: '多乐士', code: '30YY 69/048', hex: '#DDD7CD', color_family: 'warm_gray', pinned: 1, sort_order: 10 },
  { id: 'sw_latex_nippon_nn3910_4', name_zh: '伦敦雾', brand: '立邦', code: 'NN3910-4', hex: '#CBC5BC', color_family: 'warm_gray', pinned: 1, sort_order: 11 },
  { id: 'sw_latex_jotun_10342', name_zh: '灰泥暖咖', brand: '佐敦', code: '10342', hex: '#B5ADA2', color_family: 'warm_gray', pinned: 1, sort_order: 12 },
  // cool_gray (冷灰现代)
  { id: 'sw_latex_nippon_nn7851_4', name_zh: '太空漫步', brand: '立邦', code: 'NN7851-4', hex: '#D5D7D8', color_family: 'cool_gray', pinned: 1, sort_order: 13 },
  { id: 'sw_latex_nippon_nn7870_3', name_zh: '银烛台', brand: '立邦', code: 'NN7870-3', hex: '#A8AEB2', color_family: 'cool_gray', pinned: 1, sort_order: 14 },
  // green_blue (自然绿蓝)
  { id: 'sw_latex_nippon_gn5310_4', name_zh: '鼠尾草绿', brand: '立邦', code: 'GN5310-4', hex: '#C7D0C2', color_family: 'green_blue', pinned: 1, sort_order: 15 },
  { id: 'sw_latex_jotun_8469', name_zh: '复古橄榄绿', brand: '佐敦', code: '8469', hex: '#7B846B', color_family: 'green_blue', pinned: 1, sort_order: 16 },
  { id: 'sw_latex_dulux_90bg_41_040', name_zh: '迷雾冰蓝', brand: '多乐士', code: '90BG 41/040', hex: '#AEBEC4', color_family: 'green_blue', pinned: 1, sort_order: 17 },
  { id: 'sw_latex_nippon_bn7570_2', name_zh: '静谧海湾蓝', brand: '立邦', code: 'BN7570-2', hex: '#5C768D', color_family: 'green_blue', pinned: 1, sort_order: 18 },
  // terracotta_red (赤陶暖红)
  { id: 'sw_latex_nippon_rn0085_4', name_zh: '脏粉茱萸', brand: '立邦', code: 'RN0085-4', hex: '#DFC5C0', color_family: 'terracotta_red', pinned: 1, sort_order: 19 },
  { id: 'sw_latex_jotun_20120', name_zh: '摩洛哥赤陶', brand: '佐敦', code: '20120', hex: '#A66858', color_family: 'terracotta_red', pinned: 1, sort_order: 20 },
];

// 3. 各基材专属精选常用色卡与真实 1K 材质贴图资产规范
const MASTER_SWATCHES_SPEC = [
  // ── A. 头层真皮 (mat_cat_leather) ──
  { id: 'sw_lth_obsidian', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '曜石黑真皮', brand: '经典包豪斯色卡', code: 'LTH-Obsidian', hex: '#232325', color_family: 'cool_gray', style_tags: ['包豪斯', '意式极简'], pinned: 1, sort_order: 1 },
  { id: 'sw_lth_saddle_brown', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '意式马鞍棕', brand: '意式纳帕皮色卡', code: 'LTH-SaddleBrown', hex: '#8B4A2B', color_family: 'beige_brown', style_tags: ['意式轻奢', '中古风'], pinned: 1, sort_order: 2 },
  { id: 'sw_lth_caramel', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '复古焦糖棕', brand: '意式纳帕皮色卡', code: 'LTH-Caramel', hex: '#A65E36', color_family: 'beige_brown', style_tags: ['复古法式', '温馨中古'], pinned: 1, sort_order: 3 },
  { id: 'sw_lth_cognac', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '干邑暖棕', brand: '复古油蜡皮色卡', code: 'LTH-Cognac', hex: '#945232', color_family: 'beige_brown', style_tags: ['美式复古', '意式奢华'], pinned: 1, sort_order: 4 },
  { id: 'sw_lth_mocha', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '摩卡深咖', brand: '奢品皮料色卡', code: 'LTH-Mocha', hex: '#4A352A', color_family: 'beige_brown', style_tags: ['沉稳大宅', '现代黑金'], pinned: 1, sort_order: 5 },
  { id: 'sw_lth_etoupe', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '大象灰（爱马仕灰）', brand: '奢品皮料色卡', code: 'LTH-Etoupe', hex: '#8D847B', color_family: 'warm_gray', style_tags: ['意式极简', '高级灰'], pinned: 1, sort_order: 6 },
  { id: 'sw_lth_milk_tea', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '浅驼奶茶皮', brand: '意式纳帕皮色卡', code: 'LTH-MilkTea', hex: '#C5A88E', color_family: 'beige_brown', style_tags: ['奶油风', '原木风'], pinned: 1, sort_order: 7 },
  { id: 'sw_lth_ivory_white', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '象牙奶油白皮', brand: '意式纳帕皮色卡', code: 'LTH-IvoryWhite', hex: '#EFEBE3', color_family: 'off_white', style_tags: ['法式奶油', '现代极简'], pinned: 1, sort_order: 8 },
  { id: 'sw_lth_orange', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '爱马仕橙皮', brand: '奢品皮料色卡', code: 'LTH-AmberOrange', hex: '#C85A28', color_family: 'terracotta_red', style_tags: ['跳色单椅', '现代轻奢'], pinned: 1, sort_order: 9 },
  { id: 'sw_lth_burgundy', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '勃艮第酒红皮', brand: '复古油蜡皮色卡', code: 'LTH-Burgundy', hex: '#5E2428', color_family: 'terracotta_red', style_tags: ['法式复古', '美式经典'], pinned: 1, sort_order: 10 },
  { id: 'sw_lth_british_green', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '复古墨绿真皮', brand: '英伦切斯特色卡', code: 'LTH-BritishGreen', hex: '#2B4238', color_family: 'green_blue', style_tags: ['英伦复古', '书房俱乐部'], pinned: 1, sort_order: 11 },
  { id: 'sw_lth_pebble', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '岩石浅灰皮', brand: '意式纳帕皮色卡', code: 'LTH-Pebble', hex: '#BFB8B0', color_family: 'warm_gray', style_tags: ['现代简约'], pinned: 1, sort_order: 12 },
  { id: 'sw_lth_camel', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '经典暖驼真皮', brand: '意式纳帕皮色卡', code: 'LTH-Camel', hex: '#C29668', color_family: 'beige_brown', style_tags: ['现代意式', '温馨'], pinned: 1, sort_order: 13 },

  // ── B. 沙发软包布艺 (mat_cat_fabric_upholstery) ──
  { id: 'sw_fab_boucle_white', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '羊羔绒云朵白', brand: '法式圈绒', code: 'FAB-Boucle-01', hex: '#F4EFE6', color_family: 'off_white', style_tags: ['奶油风', '法式简约'], pinned: 1, sort_order: 1 },
  { id: 'sw_fab_linen_oat', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '燕麦原麻色', brand: '天然棉麻', code: 'FAB-Linen-02', hex: '#DFD3C3', color_family: 'beige_brown', style_tags: ['原木风', '侘寂风'], pinned: 1, sort_order: 2 },
  { id: 'sw_fab_chenille_apricot', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '暖杏雪尼尔', brand: '重磅雪尼尔', code: 'FAB-Chenille-03', hex: '#CFBFA8', color_family: 'beige_brown', style_tags: ['现代简约'], pinned: 1, sort_order: 3 },
  { id: 'sw_fab_linen_taupe', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '亚麻灰褐（Taupe）', brand: '意式亚麻', code: 'FAB-Linen-04', hex: '#A89C90', color_family: 'warm_gray', style_tags: ['意式极简'], pinned: 1, sort_order: 4 },
  { id: 'sw_fab_chenille_charcoal', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '炭灰雪尼尔', brand: '重磅雪尼尔', code: 'FAB-Chenille-05', hex: '#585654', color_family: 'cool_gray', style_tags: ['现代极简'], pinned: 1, sort_order: 5 },
  { id: 'sw_fab_velvet_moss', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '复古苔藓绿丝绒', brand: '高定丝绒', code: 'FAB-Velvet-06', hex: '#4A5D4E', color_family: 'green_blue', style_tags: ['法式复古', '中古风'], pinned: 1, sort_order: 6 },
  { id: 'sw_fab_velvet_navy', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '藏蓝高定丝绒', brand: '高定丝绒', code: 'FAB-Velvet-07', hex: '#2C3E55', color_family: 'green_blue', style_tags: ['轻奢风', '艺术大宅'], pinned: 1, sort_order: 7 },
  { id: 'sw_fab_boucle_pumpkin', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '焦糖南瓜圈绒', brand: '法式圈绒', code: 'FAB-Boucle-08', hex: '#BA6838', color_family: 'terracotta_red', style_tags: ['跳色单椅', '中古风'], pinned: 1, sort_order: 8 },
  { id: 'sw_fab_linen_map', category_id: 'mat_cat_fabric_upholstery', item_type: 'texture_map', name_zh: '天然亚麻平纹（支持换色）', brand: '内置1K贴图', code: 'mat_linen_fabric', hex: '#DDD3C5', color_family: 'beige_brown', texture_1k_path: 'cache/base-library/materials/mat_linen_fabric/basecolor.jpg', preview_path: '/api/base-library/materials/mat_linen_fabric/basecolor', tintable: 1, pinned: 1, sort_order: 20 },

  // ── C. 艺术漆与微水泥 (mat_cat_art_plaster) ──
  { id: 'sw_mc_bone_white', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '侘寂骨白微水泥', brand: '磐多魔/西卡参考', code: 'MC-01 Bone', hex: '#EAE4DC', color_family: 'off_white', style_tags: ['侘寂风', '极简'], pinned: 1, sort_order: 1 },
  { id: 'sw_mc_ivory', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '荒漠象牙微水泥', brand: '磐多魔/西卡参考', code: 'MC-02 Ivory', hex: '#DFD5C7', color_family: 'beige_brown', style_tags: ['侘寂风', '原木风'], pinned: 1, sort_order: 2 },
  { id: 'sw_mc_warm_stone', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '岩石暖灰微水泥', brand: '磐多魔/西卡参考', code: 'MC-03 Warm Stone', hex: '#C2B9AE', color_family: 'warm_gray', style_tags: ['侘寂灰泥', '现代素雅'], pinned: 1, sort_order: 3 },
  { id: 'sw_mc_basalt', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '火山深灰微水泥', brand: '磐多魔/西卡参考', code: 'MC-04 Basalt', hex: '#7E7A75', color_family: 'cool_gray', style_tags: ['暗调极简', '侘寂'], pinned: 1, sort_order: 4 },
  { id: 'sw_ap_pearl', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '小羊皮柔光珍珠白', brand: '卡百利/瓦科参考', code: 'AP-01 Pearl', hex: '#F1ECE3', color_family: 'off_white', style_tags: ['法式奶油', '蛋壳柔光'], pinned: 1, sort_order: 5 },
  { id: 'sw_mc_texture_map', category_id: 'mat_cat_art_plaster', item_type: 'texture_map', name_zh: '微水泥手批纹（支持任意换色）', brand: '内置1K贴图', code: 'mat_micro_cement', hex: '#C8C2B9', color_family: 'warm_gray', texture_1k_path: 'cache/base-library/materials/mat_micro_cement/basecolor.jpg', preview_path: '/api/base-library/materials/mat_micro_cement/basecolor', tintable: 1, pinned: 1, sort_order: 20 },

  // ── D. 实木护墙板与木地板 (mat_cat_wood_panel & mat_cat_wood_floor) ──
  { id: 'sw_wd_white_oak', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '北欧漂白橡木', brand: '天然原木色卡', code: 'WD-WhiteOak-01', hex: '#DFCBB2', color_family: 'beige_brown', style_tags: ['北欧风', '奶油原木'], pinned: 1, sort_order: 1 },
  { id: 'sw_wd_natural_oak', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '日式原木暖橡', brand: '天然原木色卡', code: 'WD-NaturalOak-02', hex: '#C8A97E', color_family: 'beige_brown', style_tags: ['日式原木', '无印风'], pinned: 1, sort_order: 2 },
  { id: 'sw_wd_cherry', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '蜂蜜暖调樱桃木', brand: '天然原木色卡', code: 'WD-Cherry-03', hex: '#B37A4C', color_family: 'beige_brown', style_tags: ['温馨美式', '复古原木'], pinned: 1, sort_order: 3 },
  { id: 'sw_wd_teak', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '中古缅甸柚木金棕', brand: '天然原木色卡', code: 'WD-Teak-04', hex: '#965D34', color_family: 'beige_brown', style_tags: ['中古风', '南洋复古'], pinned: 1, sort_order: 4 },
  { id: 'sw_wd_walnut', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '北美黑胡桃暖褐', brand: '天然原木色卡', code: 'WD-Walnut-05', hex: '#5C4030', color_family: 'beige_brown', style_tags: ['意式极简', '新中式'], pinned: 1, sort_order: 5 },
  { id: 'sw_wd_smoked_oak', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '烟熏炭化乌木', brand: '天然原木色卡', code: 'WD-SmokedOak-06', hex: '#362D28', color_family: 'cool_gray', style_tags: ['暗调极简', '侘寂奢宅'], pinned: 1, sort_order: 6 },
  { id: 'sw_wd_oak_map', category_id: 'mat_cat_wood_panel', item_type: 'texture_map', name_zh: '天然白橡木直纹（1K贴图）', brand: '内置1K贴图', code: 'mat_white_oak', hex: '#C8A97E', color_family: 'beige_brown', texture_1k_path: 'cache/base-library/materials/mat_white_oak/basecolor.jpg', preview_path: '/api/base-library/materials/mat_white_oak/basecolor', tintable: 1, pinned: 1, sort_order: 20 },
  { id: 'sw_wd_walnut_map', category_id: 'mat_cat_wood_panel', item_type: 'texture_map', name_zh: '北美黑胡桃木纹（1K贴图）', brand: '内置1K贴图', code: 'mat_black_walnut', hex: '#5C4030', color_family: 'beige_brown', texture_1k_path: 'cache/base-library/materials/mat_black_walnut/basecolor.jpg', preview_path: '/api/base-library/materials/mat_black_walnut/basecolor', tintable: 1, pinned: 1, sort_order: 21 },

  // 地板同款同步
  { id: 'sw_flr_white_oak', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '北欧漂白橡木地板', brand: '天然原木色卡', code: 'FLR-WhiteOak-01', hex: '#DFCBB2', color_family: 'beige_brown', style_tags: ['北欧风', '奶油原木'], pinned: 1, sort_order: 1 },
  { id: 'sw_flr_natural_oak', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '日式原木暖橡地板', brand: '天然原木色卡', code: 'FLR-NaturalOak-02', hex: '#C8A97E', color_family: 'beige_brown', style_tags: ['日式原木', '无印风'], pinned: 1, sort_order: 2 },
  { id: 'sw_flr_walnut', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '北美黑胡桃地板', brand: '天然原木色卡', code: 'FLR-Walnut-05', hex: '#5C4030', color_family: 'beige_brown', style_tags: ['意式极简', '大宅豪宅'], pinned: 1, sort_order: 3 },
  { id: 'sw_flr_oak_map', category_id: 'mat_cat_wood_floor', item_type: 'texture_map', name_zh: '白橡木地板纹理（1K贴图）', brand: '内置1K贴图', code: 'mat_white_oak', hex: '#C8A97E', color_family: 'beige_brown', texture_1k_path: 'cache/base-library/materials/mat_white_oak/basecolor.jpg', preview_path: '/api/base-library/materials/mat_white_oak/basecolor', tintable: 1, pinned: 1, sort_order: 20 },

  // ── E. 天然大理石 / 洞石 / 岩板 / 水磨石 (mat_cat_stone) ──
  { id: 'sw_stn_carrara_map', category_id: 'mat_cat_stone', item_type: 'texture_map', name_zh: '卡拉拉鱼肚白大理石（1K）', brand: '天然石材', code: 'mat_calacatta_marble', hex: '#ECEAE6', color_family: 'off_white', texture_1k_path: 'cache/base-library/materials/mat_calacatta_marble/basecolor.jpg', preview_path: '/api/base-library/materials/mat_calacatta_marble/basecolor', prompt_hint_zh: '象牙白底色配优雅灰金色流云纹理天然大理石', tintable: 0, pinned: 1, sort_order: 1 },
  { id: 'sw_stn_travertine_map', category_id: 'mat_cat_stone', item_type: 'texture_map', name_zh: '意大利罗马米白洞石（1K）', brand: '天然石材', code: 'mat_roman_travertine', hex: '#D8CBB8', color_family: 'beige_brown', texture_1k_path: 'cache/base-library/materials/mat_roman_travertine/basecolor.jpg', preview_path: '/api/base-library/materials/mat_roman_travertine/basecolor', prompt_hint_zh: '温暖米黄色层状沉积岩纹理与自然细微孔洞', tintable: 0, pinned: 1, sort_order: 2 },
  { id: 'sw_stn_terrazzo_map', category_id: 'mat_cat_stone', item_type: 'texture_map', name_zh: '威尼斯水磨石（1K）', brand: '天然水磨石', code: 'mat_terrazzo_gray', hex: '#DEDAD2', color_family: 'warm_gray', texture_1k_path: 'cache/base-library/materials/mat_terrazzo_gray/basecolor.jpg', preview_path: '/api/base-library/materials/mat_terrazzo_gray/basecolor', prompt_hint_zh: '米白水泥基底镶嵌暖棕与灰白大理石骨料颗粒', tintable: 0, pinned: 1, sort_order: 3 },
  { id: 'sw_stn_bulgari', category_id: 'mat_cat_stone', item_type: 'solid_color', name_zh: '宝格丽黑金紫奢石', brand: '天然奢石花色', code: 'STN-Bulgari', hex: '#3A3235', color_family: 'cool_gray', prompt_hint_zh: '白色、深紫与黑金交织的戏剧性大花纹奢石', pinned: 1, sort_order: 4 },
  { id: 'sw_stn_prada_green', category_id: 'mat_cat_stone', item_type: 'solid_color', name_zh: '普拉达绿天然大理石', brand: '天然奢石花色', code: 'STN-PradaGreen', hex: '#3B5244', color_family: 'green_blue', prompt_hint_zh: '深邃森林绿底色交织白色冰裂纹天然奢石', pinned: 1, sort_order: 5 },
  { id: 'sw_stn_tundra_gray', category_id: 'mat_cat_stone', item_type: 'solid_color', name_zh: '云多拉灰大理石', brand: '经典大理石', code: 'STN-TundraGray', hex: '#8C8984', color_family: 'warm_gray', prompt_hint_zh: '意式极简高级暖灰底色配细腻白雾暗纹', pinned: 1, sort_order: 6 },
  { id: 'sw_stn_laurent_black', category_id: 'mat_cat_stone', item_type: 'solid_color', name_zh: '劳伦黑金大理石', brand: '经典大理石', code: 'STN-LaurentBlack', hex: '#222120', color_family: 'cool_gray', prompt_hint_zh: '纯正曜石黑底色配利落金白闪电直纹', pinned: 1, sort_order: 7 },

  // ── F. 定制柜门烤漆 / PET (mat_cat_cabinet_lacquer) ──
  { id: 'sw_cab_kemi_white', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '科米白（暖调肤感白）', brand: '定制柜门色卡', code: 'CAB-01', hex: '#F3EFE8', color_family: 'off_white', style_tags: ['奶油风', '原木风'], pinned: 1, sort_order: 1 },
  { id: 'sw_cab_cashmere', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '羊绒暖杏（Cashmere）', brand: '爱格W1000平替', code: 'CAB-02', hex: '#E2D7C7', color_family: 'beige_brown', style_tags: ['现代极简', '法式奶油'], pinned: 1, sort_order: 2 },
  { id: 'sw_cab_rock_gray', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '岩石暖灰（U702平替）', brand: '爱格U702平替', code: 'CAB-03', hex: '#B8B0A6', color_family: 'warm_gray', style_tags: ['现代极简'], pinned: 1, sort_order: 3 },
  { id: 'sw_cab_graphite', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '石墨深灰（U961平替）', brand: '爱格U961平替', code: 'CAB-04', hex: '#3D3C3A', color_family: 'cool_gray', style_tags: ['意式暗调', '现代极简'], pinned: 1, sort_order: 4 },
  { id: 'sw_cab_sage_green', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '鼠尾草灰绿柜门', brand: '法式复古色卡', code: 'CAB-05', hex: '#9AA696', color_family: 'green_blue', style_tags: ['法式复古', '森系清新'], pinned: 1, sort_order: 5 },

  // ── G. 金属五金 (mat_cat_metal) ──
  { id: 'sw_mtl_brushed_brass', category_id: 'mat_cat_metal', item_type: 'solid_color', name_zh: '拉丝黄铜 / 复古金色', brand: '意式五金', code: 'MTL-01', hex: '#C59B5F', color_family: 'yellow_gold', style_tags: ['轻奢风', '中古风'], pinned: 1, sort_order: 1 },
  { id: 'sw_mtl_champagne_gold', category_id: 'mat_cat_metal', item_type: 'solid_color', name_zh: '意式香槟暗金', brand: '阳极氧化', code: 'MTL-02', hex: '#B8A282', color_family: 'yellow_gold', style_tags: ['现代极简', '意式轻奢'], pinned: 1, sort_order: 2 },
  { id: 'sw_mtl_black_titanium', category_id: 'mat_cat_metal', item_type: 'solid_color', name_zh: '哑光黑钛 / 磨砂黑', brand: '黑钛五金', code: 'MTL-03', hex: '#28282A', color_family: 'cool_gray', style_tags: ['极简黑金', '包豪斯'], pinned: 1, sort_order: 3 },
  { id: 'sw_mtl_mirror_chrome', category_id: 'mat_cat_metal', item_type: 'solid_color', name_zh: '包豪斯镜面镀铬银', brand: '电镀镜面', code: 'MTL-04', hex: '#D8DCDF', color_family: 'cool_gray', style_tags: ['包豪斯', '现代先锋'], pinned: 1, sort_order: 4 },

  // ── H. 玻璃镜面 (mat_cat_glass) ──
  { id: 'sw_gls_fluted', category_id: 'mat_cat_glass', item_type: 'solid_color', name_zh: '超白长虹竖纹玻璃', brand: '定制玻璃', code: 'GLS-01', hex: '#E4ECEE', color_family: 'off_white', style_tags: ['极简', '法式'], pinned: 1, sort_order: 1 },
  { id: 'sw_gls_tinted_tea', category_id: 'mat_cat_glass', item_type: 'solid_color', name_zh: '意式茶色透明玻璃', brand: '钢化玻璃', code: 'GLS-02', hex: '#6E5849', color_family: 'beige_brown', style_tags: ['意式轻奢', '中古风'], pinned: 1, sort_order: 2 },
  { id: 'sw_gls_smoked_gray', category_id: 'mat_cat_glass', item_type: 'solid_color', name_zh: '烟熏灰玻', brand: '钢化玻璃', code: 'GLS-03', hex: '#6E7378', color_family: 'cool_gray', style_tags: ['现代极简', '黑框门'], pinned: 1, sort_order: 3 },

  // ── I. 窗帘床品 (mat_cat_textile_drapery) ──
  { id: 'sw_drp_sheer_white', category_id: 'mat_cat_textile_drapery', item_type: 'solid_color', name_zh: '极简幻影透光白纱', brand: '高定纱帘', code: 'DRP-01', hex: '#FAF8F5', color_family: 'off_white', style_tags: ['奶油风', '法式简约'], pinned: 1, sort_order: 1 },
  { id: 'sw_drp_linen_oat', category_id: 'mat_cat_textile_drapery', item_type: 'solid_color', name_zh: '燕麦色原麻窗帘', brand: '天然棉麻', code: 'DRP-02', hex: '#D7CABE', color_family: 'beige_brown', style_tags: ['原木风', '侘寂'], pinned: 1, sort_order: 2 },
  { id: 'sw_drp_taupe_drape', category_id: 'mat_cat_textile_drapery', item_type: 'solid_color', name_zh: '灰咖色垂感绒布', brand: '高密遮光布', code: 'DRP-03', hex: '#877B73', color_family: 'warm_gray', style_tags: ['意式极简'], pinned: 1, sort_order: 3 },

  // ── J. 地毯织物 (mat_cat_carpet) ──
  { id: 'sw_cpt_cream_wool', category_id: 'mat_cat_carpet', item_type: 'solid_color', name_zh: '奶油白密割绒羊毛毯', brand: '新西兰羊毛', code: 'CPT-01', hex: '#F0ECE1', color_family: 'off_white', style_tags: ['奶油风', '极简'], pinned: 1, sort_order: 1 },
  { id: 'sw_cpt_sand_sisal', category_id: 'mat_cat_carpet', item_type: 'solid_color', name_zh: '暖沙色剑麻平织地毯', brand: '天然剑麻', code: 'CPT-02', hex: '#CFBEA7', color_family: 'beige_brown', style_tags: ['侘寂风', '原木风'], pinned: 1, sort_order: 2 },
  { id: 'sw_cpt_morandi_gray', category_id: 'mat_cat_carpet', item_type: 'solid_color', name_zh: '莫兰迪冷灰短绒毯', brand: '高密短绒', code: 'CPT-03', hex: '#9E9E9C', color_family: 'cool_gray', style_tags: ['现代简约'], pinned: 1, sort_order: 3 }
];

/**
 * 将 Master 字典完整种子化到数据库中
 */
function seedMasterDictionary(db) {
  const now = Date.now();

  // 1. 部位表 ba_parts
  const insPart = db.prepare(`
    INSERT OR REPLACE INTO ba_parts (
      id, name_zh, name_en, jev_aliases, preserve_clause_zh, preserve_clause_en,
      default_category_id, sort_order, is_system, enabled, created_at, updated_at
    ) VALUES (
      :id, :name_zh, :name_en, :jev_aliases, :preserve_clause_zh, :preserve_clause_en,
      :default_category_id, :sort_order, :is_system, 1, :now, :now
    )
  `);
  for (const p of MASTER_PARTS) {
    insPart.run({ ...p, now });
  }

  // 2. 基材品类表 ba_material_categories
  const insCat = db.prepare(`
    INSERT OR REPLACE INTO ba_material_categories (
      id, name_zh, name_en, track_mode, allowed_parts, default_finish_id,
      finishes_json, sort_order, is_system, enabled, created_at, updated_at
    ) VALUES (
      :id, :name_zh, :name_en, :track_mode, :allowed_parts, :default_finish_id,
      :finishes_json, :sort_order, :is_system, 1, :now, :now
    )
  `);
  for (const c of MASTER_CATEGORIES) {
    insCat.run({ ...c, now });
  }

  // 3. 专属色卡/纹理花色表 ba_material_swatches
  const insSwatch = db.prepare(`
    INSERT OR REPLACE INTO ba_material_swatches (
      id, category_id, item_type, name_zh, brand, code, hex, lrv,
      color_family, style_tags, finish_override, prompt_hint_zh, prompt_hint_en,
      texture_1k_path, preview_path, tintable, source_type, pinned, sort_order,
      enabled, created_at, updated_at
    ) VALUES (
      :id, :category_id, :item_type, :name_zh, :brand, :code, :hex, :lrv,
      :color_family, :style_tags, :finish_override, :prompt_hint_zh, :prompt_hint_en,
      :texture_1k_path, :preview_path, :tintable, :source_type, :pinned, :sort_order,
      1, :now, :now
    )
  `);

  // 先写入全品类精选资产 (含真皮、木饰面、布艺、大理石等)
  for (const s of MASTER_SWATCHES_SPEC) {
    const lrv = typeof s.lrv === 'number' ? s.lrv : calculateLrv(s.hex);
    const colorFamily = s.color_family || deriveColorFamily(s.hex);
    insSwatch.run({
      id: s.id,
      category_id: s.category_id,
      item_type: s.item_type || 'solid_color',
      name_zh: s.name_zh,
      brand: s.brand || '',
      code: s.code || '',
      hex: s.hex,
      lrv,
      color_family: colorFamily,
      style_tags: JSON.stringify(s.style_tags || []),
      finish_override: s.finish_override || '',
      prompt_hint_zh: s.prompt_hint_zh || '',
      prompt_hint_en: s.prompt_hint_en || '',
      texture_1k_path: s.texture_1k_path || '',
      preview_path: s.preview_path || '',
      tintable: s.tintable ? 1 : 0,
      source_type: s.source_type || 'curated',
      pinned: s.pinned !== undefined ? s.pinned : 1,
      sort_order: s.sort_order || 0,
      now
    });
  }

  // 写入 20 款最高频置顶乳胶漆常用色 (pinned: 1, sort_order: 1..20)
  for (const p20 of TOP_20_CURATED_PAINTS) {
    const lrv = calculateLrv(p20.hex);
    insSwatch.run({
      id: p20.id,
      category_id: 'mat_cat_latex',
      item_type: 'solid_color',
      name_zh: p20.name_zh,
      brand: p20.brand,
      code: p20.code,
      hex: p20.hex,
      lrv,
      color_family: p20.color_family,
      style_tags: JSON.stringify(['设计师最高频常用色']),
      finish_override: '',
      prompt_hint_zh: '',
      prompt_hint_en: '',
      texture_1k_path: '',
      preview_path: '',
      tintable: 0,
      source_type: 'curated',
      pinned: 1,
      sort_order: p20.sort_order,
      now
    });
  }

  // 将 CURATED_PAINTS (其余乳胶漆) 映射入库，规范化 color_family
  let orderOffset = 100;
  for (const cp of (CURATED_PAINTS || [])) {
    const swatchId = `sw_latex_${(cp.brand || 'paint').toLowerCase()}_${(cp.code || cp.id).toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
    // 若已在 top 20 中，跳过
    if (TOP_20_CURATED_PAINTS.some(t => t.id === swatchId || t.code === cp.code)) continue;

    const lrv = typeof cp.lrv === 'number' ? cp.lrv : calculateLrv(cp.hex);
    const colorFamily = mapLegacyPaintFamily(cp.family_key, cp.hex);
    insSwatch.run({
      id: swatchId,
      category_id: 'mat_cat_latex',
      item_type: 'solid_color',
      name_zh: cp.display_name || cp.name_zh || cp.code,
      brand: cp.brand || '立邦',
      code: cp.code || '',
      hex: cp.hex,
      lrv,
      color_family: colorFamily,
      style_tags: JSON.stringify([cp.role_hint || '乳胶漆经典']),
      finish_override: '',
      prompt_hint_zh: '',
      prompt_hint_en: '',
      texture_1k_path: '',
      preview_path: cp.swatch_rel || '',
      tintable: 0,
      source_type: 'curated',
      pinned: 0,
      sort_order: orderOffset++,
      now
    });
  }

  // 4. 将全部专属色卡同步写入 ba_items 与 ba_item_mounts (打通素材库主页面)
  try {
    const catMap = {};
    for (const c of MASTER_CATEGORIES) {
      let allowedParts = [];
      try { allowedParts = JSON.parse(c.allowed_parts || '[]'); } catch (_) {}
      catMap[c.id] = { ...c, allowedParts };
    }

    const KIND_MAP = {
      mat_cat_latex: { kind: '乳胶漆', kind_key: 'latex' },
      mat_cat_art_plaster: { kind: '艺术漆/微水泥', kind_key: 'microcement' },
      mat_cat_leather: { kind: '头层真皮', kind_key: 'leather' },
      mat_cat_fabric_upholstery: { kind: '沙发软包布艺', kind_key: 'fabric' },
      mat_cat_wood_panel: { kind: '实木护墙板与木皮', kind_key: 'wood' },
      mat_cat_wood_floor: { kind: '实木木地板', kind_key: 'wood_flooring' },
      mat_cat_stone: { kind: '大理石与洞石岩板', kind_key: 'stone' },
      mat_cat_cabinet_lacquer: { kind: '定制柜门烤漆/PET', kind_key: 'cabinet_lacquer' },
      mat_cat_metal: { kind: '金属五金', kind_key: 'metal' },
      mat_cat_glass: { kind: '玻璃镜面', kind_key: 'glass' },
      mat_cat_textile_drapery: { kind: '窗帘床品', kind_key: 'drapery' },
      mat_cat_carpet: { kind: '地毯织物', kind_key: 'carpet' },
      mat_cat_tile: { kind: '瓷砖花砖', kind_key: 'tile' }
    };

    const allSwatches = db.prepare('SELECT * FROM ba_material_swatches WHERE enabled=1').all();
    const insItem = db.prepare(`
      INSERT OR REPLACE INTO ba_items (
        id, kind, kind_key, name_zh, prompt_name, hex, family, lightness,
        role_hint, zone, preview_rel, external_sku, created_at, updated_at
      ) VALUES (
        :id, :kind, :kind_key, :name_zh, :prompt_name, :hex, :family, :lightness,
        :role_hint, 'any', :preview_rel, :external_sku, :now, :now
      )
    `);
    const insMount = db.prepare(`
      INSERT OR IGNORE INTO ba_item_mounts (item_id, mount) VALUES (?, ?)
    `);

    for (const sw of allSwatches) {
      const kInfo = KIND_MAP[sw.category_id] || { kind: '基础基材', kind_key: 'base' };
      const cat = catMap[sw.category_id];

      insItem.run({
        id: sw.id,
        kind: kInfo.kind,
        kind_key: kInfo.kind_key,
        name_zh: sw.name_zh,
        prompt_name: sw.name_zh,
        hex: sw.hex,
        family: sw.color_family,
        lightness: sw.lrv,
        role_hint: sw.brand ? `${sw.brand} ${sw.code || ''}`.trim() : '',
        preview_rel: sw.preview_path || '',
        external_sku: sw.code || '',
        now
      });

      if (cat && cat.allowedParts) {
        for (const pt of cat.allowedParts) {
          insMount.run(sw.id, pt);
        }
      }
    }
  } catch (syncErr) {
    console.warn('[master-seed] 同步到 ba_items 警告:', syncErr.message);
  }
}

module.exports = {
  MASTER_PARTS,
  MASTER_CATEGORIES,
  MASTER_SWATCHES_SPEC,
  TOP_20_CURATED_PAINTS,
  mapLegacyPaintFamily,
  seedMasterDictionary
};
