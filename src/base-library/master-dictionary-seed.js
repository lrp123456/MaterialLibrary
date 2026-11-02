/**
 * 室内设计「部位 ↔ 基材品类 ↔ 专属色卡/纹理花色」Master 权威全量字典种子
 * 包含 8 大空间部位、12 大基材品类、专属表面工艺与全部精选美学色卡/纹理资产。
 */

const { calculateLrv, deriveColorFamily } = require('./color-engine');
const { CURATED_PAINTS } = require('./curated-paints');

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
    name_zh: '窗帘 / 床品 / 软装织物',
    name_en: 'drapery and bedding textiles',
    jev_aliases: JSON.stringify(['窗帘', '纱帘', '床品', '被套', '抱枕', 'curtain', 'bedding']),
    preserve_clause_zh: '保持原有窗帘垂坠波浪褶皱、床品自然折痕与透光漫反射',
    preserve_clause_en: 'maintain natural fabric drape, organic wavy folds, soft wrinkles and translucent light transmission',
    default_category_id: 'mat_cat_textile_drapery',
    sort_order: 60,
    is_system: 1
  },
  {
    id: 'rug',
    name_zh: '地毯 / 地垫',
    name_en: 'area rug and carpet',
    jev_aliases: JSON.stringify(['地毯', '地垫', '块毯', 'rug', 'carpet']),
    preserve_clause_zh: '保持原有地毯边缘透视、茶几沙发压痕与地面接触阴影',
    preserve_clause_en: 'keep original rug edge perspective, furniture leg indentations and floor contact shadows',
    default_category_id: 'mat_cat_rug',
    sort_order: 70,
    is_system: 1
  },
  {
    id: 'hard_furniture',
    name_zh: '硬质家具 / 五金框架 / 玻璃桌面',
    name_en: 'hard furniture and fixtures',
    jev_aliases: JSON.stringify(['茶几', '餐桌', '金属架', '灯具', '门框', '踢脚线', '玻璃隔断', 'table', 'frame']),
    preserve_clause_zh: '保持原有家具几何结构、倒角高光与环境遮挡关系',
    preserve_clause_en: 'retain crisp architectural geometry, bevel highlights and occlusion with surrounding decor',
    default_category_id: 'mat_cat_wood_panel',
    sort_order: 80,
    is_system: 1
  }
];

// 2. 12 大基材品类定义 (含专属表面工艺)
const MASTER_CATEGORIES = [
  {
    id: 'mat_cat_latex',
    name_zh: '乳胶漆',
    name_en: 'interior latex paint',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['wall', 'ceiling']),
    default_finish_id: 'roller_matte',
    finishes_json: JSON.stringify([
      { id: 'roller_matte', name_zh: '哑光滚涂', prompt_zh: '细腻均匀的哑光乳胶漆滚涂肌理，极轻微漫反射，无明显刷痕', prompt_en: 'uniform matte roller-applied interior latex paint, soft diffuse reflection' },
      { id: 'eggshell_satin', name_zh: '蛋壳柔光', prompt_zh: '温润蛋壳光泽乳胶漆表面，带有柔和漫反射微光', prompt_en: 'eggshell satin finish latex paint with subtle warm sheen' },
      { id: 'airless_spray', name_zh: '无气喷涂平涂', prompt_zh: '无气喷涂超平滑零肌理哑光漆面，极致干净均匀', prompt_en: 'ultra-smooth airless sprayed flat matte paint surface' }
    ]),
    sort_order: 10,
    is_system: 1
  },
  {
    id: 'mat_cat_art_plaster',
    name_zh: '艺术漆与微水泥',
    name_en: 'microcement and Venetian plaster',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['wall', 'ceiling', 'floor']),
    default_finish_id: 'trowel_microcement',
    finishes_json: JSON.stringify([
      { id: 'trowel_microcement', name_zh: '微水泥手批肌理', prompt_zh: '连续无缝微水泥手工批刮肌理，呈现柔和阴阳色斑与自然批刀质感', prompt_en: 'seamless hand-troweled microcement texture with subtle tonal variation' },
      { id: 'velvet_art_paint', name_zh: '天鹅绒/小羊皮艺术漆', prompt_zh: '细腻丝滑的天鹅绒艺术漆肌理，带柔和珠光与云雾暗纹', prompt_en: 'silky velvet Venetian plaster finish with soft cloud-like sheen' },
      { id: 'travertine_plaster', name_zh: '洞石肌理艺术涂料', prompt_zh: '仿天然洞石微孔批刮艺术涂料，带有细微砂岩气孔', prompt_en: 'travertine-effect mineral plaster with fine porous stone texture' }
    ]),
    sort_order: 20,
    is_system: 1
  },
  {
    id: 'mat_cat_leather',
    name_zh: '头层真皮 / 油蜡皮 / 磨砂皮',
    name_en: 'full-grain upholstery leather',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['upholstery']),
    default_finish_id: 'nappa_full_grain',
    finishes_json: JSON.stringify([
      { id: 'nappa_full_grain', name_zh: '意式头层纳帕皮', prompt_zh: '细腻温润的意式头层纳帕牛皮质感，带自然微细毛孔与柔和半哑光皮质光泽', prompt_en: 'supple Italian full-grain Nappa leather with fine natural grain and soft semi-matte sheen' },
      { id: 'vintage_oil_wax', name_zh: '复古油蜡皮', prompt_zh: '饱满厚重的复古油蜡牛皮质感，折痕处带自然深浅明暗包浆光泽', prompt_en: 'vintage pull-up oil-wax leather with rich patina and warm highlights along creases' },
      { id: 'suede_nubuck', name_zh: '磨砂皮 / 翻毛皮', prompt_zh: '哑光细腻的头层磨砂牛皮质感，表面呈现微绒柔和漫反射', prompt_en: 'matte brushed nubuck suede leather with soft velvety nap' }
    ]),
    sort_order: 30,
    is_system: 1
  },
  {
    id: 'mat_cat_fabric_upholstery',
    name_zh: '沙发与软包布艺',
    name_en: 'upholstery fabric and bouclé',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['upholstery']),
    default_finish_id: 'cotton_linen_weave',
    finishes_json: JSON.stringify([
      { id: 'cotton_linen_weave', name_zh: '粗纺棉麻', prompt_zh: '自然粗纺亚麻与棉麻混纺交织肌理，经纬纱线清晰可见', prompt_en: 'natural slubbed cotton-linen woven upholstery fabric with visible warp and weft threads' },
      { id: 'boucle_fleece', name_zh: '羊羔绒 / 泰迪圈绒', prompt_zh: '立体蓬松的法式羊羔绒圈绒（Bouclé）织物肌理，颗粒饱满温暖', prompt_en: 'plush French bouclé looped yarn upholstery texture' },
      { id: 'chenille_heavy', name_zh: '重磅雪尼尔', prompt_zh: '厚实饱满的高克重雪尼尔提花织物肌理', prompt_en: 'heavyweight plush chenille woven upholstery fabric' },
      { id: 'silk_velvet', name_zh: '高定丝绒 / 天鹅绒', prompt_zh: '短密顺滑的丝绒表面，随软包褶皱呈现柔和明暗流光', prompt_en: 'luxurious short-pile silk velvet upholstery with rich directional sheen' }
    ]),
    sort_order: 40,
    is_system: 1
  },
  {
    id: 'mat_cat_wood_panel',
    name_zh: '实木护墙板 / 木饰面 / 家具木皮',
    name_en: 'architectural wood paneling and veneer',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['wall', 'ceiling', 'cabinet_door', 'hard_furniture']),
    default_finish_id: 'wood_open_pore',
    finishes_json: JSON.stringify([
      { id: 'wood_open_pore', name_zh: '哑光开放漆木皮', prompt_zh: '哑光开放漆实木饰面，清晰保留天然木材导管与细腻木纹', prompt_en: 'matte open-pore natural wood veneer with tactile wood grain' },
      { id: 'wood_closed_satin', name_zh: '柔光封闭漆', prompt_zh: '平滑温润的柔光封闭漆实木表面', prompt_en: 'smooth satin closed-pore lacquered wood surface' },
      { id: 'wood_fluted_slat', name_zh: '立体木格栅', prompt_zh: '垂直阵列实木格栅护墙板，凹凸光影层次分明', prompt_en: 'vertical fluted timber slat paneling' }
    ]),
    sort_order: 50,
    is_system: 1
  },
  {
    id: 'mat_cat_wood_floor',
    name_zh: '实木与复合木地板',
    name_en: 'hardwood parquet and plank flooring',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['floor']),
    default_finish_id: 'floor_plank_straight',
    finishes_json: JSON.stringify([
      { id: 'floor_plank_straight', name_zh: '工字平铺大板', prompt_zh: '宽幅实木地板工字平铺，板缝自然细腻，哑光木蜡油质感', prompt_en: 'wide-plank hardwood flooring in straight staggered bond, matte oil finish' },
      { id: 'floor_herringbone', name_zh: '法式人字拼', prompt_zh: '经典法式人字拼实木地板铺装，几何咬合精准', prompt_en: 'classic herringbone parquet wood flooring' },
      { id: 'floor_chevron', name_zh: '45度鱼骨拼', prompt_zh: '45度斜切鱼骨拼实木地板铺装，V型对缝工整优雅', prompt_en: '45-degree chevron parquet wood flooring' }
    ]),
    sort_order: 60,
    is_system: 1
  },
  {
    id: 'mat_cat_stone',
    name_zh: '天然大理石 / 洞石 / 岩板 / 水磨石',
    name_en: 'natural marble, travertine and sintered stone',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['wall', 'floor', 'cabinet_door', 'hard_furniture']),
    default_finish_id: 'stone_polished',
    finishes_json: JSON.stringify([
      { id: 'stone_polished', name_zh: '镜面抛光', prompt_zh: '高光泽镜面抛光天然石材表面，带清晰自然流体石纹与高光反射', prompt_en: 'high-gloss polished natural marble surface with crisp organic veining' },
      { id: 'stone_honed_matte', name_zh: '哑光柔抛面', prompt_zh: '温润不刺眼的哑光打磨石材表面', prompt_en: 'smooth honed matte natural stone surface' },
      { id: 'stone_porous_raw', name_zh: '天然毛孔洞石面', prompt_zh: '保留天然层状孔洞肌理的洞石表面', prompt_en: 'raw travertine stone surface with natural linear pores' }
    ]),
    sort_order: 70,
    is_system: 1
  },
  {
    id: 'mat_cat_cabinet_lacquer',
    name_zh: '定制柜门烤漆 / PET / 免漆板',
    name_en: 'custom cabinetry PET and lacquer',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['cabinet_door']),
    default_finish_id: 'skin_feel_pet',
    finishes_json: JSON.stringify([
      { id: 'skin_feel_pet', name_zh: '零度肤感哑光 PET', prompt_zh: '极致顺滑的零度肤感超哑光烤漆/PET柜门表面，边缘封边利落', prompt_en: 'ultra-matte anti-fingerprint skin-feel PET lacquered cabinet door surface' },
      { id: 'piano_high_gloss', name_zh: '钢琴高光烤漆', prompt_zh: '饱满通透的镜面高光钢琴烤漆柜门表面', prompt_en: 'mirror-like high-gloss piano lacquer cabinet door finish' },
      { id: 'metallic_brushed_lacquer', name_zh: '金属珠光烤漆', prompt_zh: '带极细微金属珠光漫反射的意式奢华烤漆柜门', prompt_en: 'subtle metallic pearl brushed lacquer cabinet finish' }
    ]),
    sort_order: 80,
    is_system: 1
  },
  {
    id: 'mat_cat_metal',
    name_zh: '金属五金 / 拉手包边',
    name_en: 'architectural hardware and metal',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['hard_furniture', 'cabinet_door']),
    default_finish_id: 'brushed_satin_metal',
    finishes_json: JSON.stringify([
      { id: 'brushed_satin_metal', name_zh: '金属拉丝', prompt_zh: '细腻金属拉丝表面与柔和各向异性高光', prompt_en: 'fine brushed satin metal finish with anisotropic highlights' },
      { id: 'mirror_polished_metal', name_zh: '镜面抛光电镀', prompt_zh: '高反射镜面电镀金属表面', prompt_en: 'high-reflection mirror polished chrome/metal finish' },
      { id: 'matte_sandblasted_metal', name_zh: '哑光喷砂金属', prompt_zh: '细腻磨砂哑光阳极氧化金属质感', prompt_en: 'matte sandblasted anodized metal surface' }
    ]),
    sort_order: 90,
    is_system: 1
  },
  {
    id: 'mat_cat_glass',
    name_zh: '玻璃与镜面',
    name_en: 'architectural glazing and fluted glass',
    track_mode: 'track_a',
    allowed_parts: JSON.stringify(['hard_furniture', 'cabinet_door', 'wall']),
    default_finish_id: 'fluted_reeded_glass',
    finishes_json: JSON.stringify([
      { id: 'fluted_reeded_glass', name_zh: '长虹竖纹玻璃', prompt_zh: '垂直凹凸条纹长虹玻璃，透光不透影', prompt_en: 'vertical fluted reeded privacy glass' },
      { id: 'tinted_clear_glass', name_zh: '通透有色钢化玻璃', prompt_zh: '半透明有色钢化玻璃，带清脆镜面反射', prompt_en: 'semi-transparent tinted tempered glass with crisp reflections' },
      { id: 'frosted_acid_glass', name_zh: '玉砂 / 磨砂玻璃', prompt_zh: '柔和漫反射雾面磨砂玻璃', prompt_en: 'frosted acid-etched translucent glass' }
    ]),
    sort_order: 100,
    is_system: 1
  },
  {
    id: 'mat_cat_textile_drapery',
    name_zh: '窗帘与床品面料',
    name_en: 'curtain drapery and bedding fabrics',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['curtain_bedding']),
    default_finish_id: 'heavy_drape_matte',
    finishes_json: JSON.stringify([
      { id: 'heavy_drape_matte', name_zh: '高精密垂感遮光布', prompt_zh: '高克重柔顺垂坠哑光窗帘面料', prompt_en: 'heavyweight soft-draping matte blackout curtain fabric' },
      { id: 'sheer_linen_voile', name_zh: '微透光亚麻纱帘', prompt_zh: '轻盈微透光的天然亚麻肌理白纱', prompt_en: 'lightweight translucent linen voile sheer curtain' },
      { id: 'washed_cotton_bedding', name_zh: '水洗长绒棉床品', prompt_zh: '亲肤哑光水洗长绒棉床品面料，带自然柔顺折痕', prompt_en: 'soft matte washed Egyptian cotton bedding fabric' }
    ]),
    sort_order: 110,
    is_system: 1
  },
  {
    id: 'mat_cat_rug',
    name_zh: '地毯与地垫织物',
    name_en: 'area rug and woven floor mats',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['rug']),
    default_finish_id: 'wool_loop_pile',
    finishes_json: JSON.stringify([
      { id: 'wool_loop_pile', name_zh: '羊毛高低圈绒', prompt_zh: '高克重立体羊毛高低圈绒编织地毯', prompt_en: 'heavyweight multi-level wool loop pile carpet' },
      { id: 'jute_sisal_braid', name_zh: '天然剑麻黄麻编织', prompt_zh: '质朴粗粝的天然剑麻黄麻紧密平织地毯', prompt_en: 'rustic tightly braided natural jute and sisal rug' },
      { id: 'short_velvet_rug', name_zh: '高密短绒平织', prompt_zh: '细腻丝滑的高密短绒印花地毯', prompt_en: 'dense short-pile printed velvet area rug' }
    ]),
    sort_order: 120,
    is_system: 1
  },
  {
    id: 'mat_cat_tile',
    name_zh: '瓷砖与复古花砖',
    name_en: 'ceramic and vintage encaustic tiles',
    track_mode: 'hybrid',
    allowed_parts: JSON.stringify(['wall', 'floor']),
    default_finish_id: 'matte_porcelain_large',
    finishes_json: JSON.stringify([
      { id: 'matte_porcelain_large', name_zh: '柔光素色大砖', prompt_zh: '750x1500 柔光素色大砖密缝平铺', prompt_en: 'large-format soft-matte porcelain tile with seamless joints' },
      { id: 'glossy_zellige_subway', name_zh: '手工摩洛哥亮面砖', prompt_zh: '手工凹凸釉面亮光鱼鳞/面包小砖', prompt_en: 'handcrafted glossy glazed zellige subway tile' },
      { id: 'vintage_encaustic_tile', name_zh: '法式复古几何花砖', prompt_zh: '法式复古水泥几何图案印花瓷砖', prompt_en: 'classic vintage French encaustic cement pattern tile' }
    ]),
    sort_order: 130,
    is_system: 1
  }
];

// 3. 各基材专属色卡与花色资产清单
const MASTER_SWATCHES_SPEC = [
  // ── A. 头层真皮 / 油蜡皮 (mat_cat_leather) ──
  { id: 'sw_lth_saddle_brown', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '意式马鞍棕', brand: 'Poltrona Frau 参考', code: 'SC-142 Saddle', hex: '#8B4A2B', color_family: 'beige_brown', style_tags: ['意式极简', '中古风'], pinned: 1 },
  { id: 'sw_lth_caramel', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '复古焦糖棕', brand: '意式油蜡皮色卡', code: 'LTH-Caramel', hex: '#A65E36', color_family: 'beige_brown', style_tags: ['美式复古', '中古风'], pinned: 1 },
  { id: 'sw_lth_cognac', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '干邑暖棕', brand: 'Baxter 参考', code: 'LTH-Cognac', hex: '#945232', color_family: 'beige_brown', style_tags: ['意式轻奢', '中古风'], pinned: 1 },
  { id: 'sw_lth_mocha', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '摩卡深咖', brand: '意式纳帕皮色卡', code: 'LTH-Mocha', hex: '#4A352A', color_family: 'beige_brown', style_tags: ['意式极简', '沉稳大宅'], pinned: 1 },
  { id: 'sw_lth_camel', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '浅驼奶茶皮', brand: 'Minotti 参考', code: 'LTH-Camel', hex: '#C5A88E', color_family: 'beige_brown', style_tags: ['现代轻奢', '温暖奶油'], pinned: 1 },
  { id: 'sw_lth_ivory', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '象牙奶油白皮', brand: '意式纳帕皮色卡', code: 'LTH-Ivory', hex: '#EFEBE3', color_family: 'off_white', style_tags: ['奶油风', '现代极简'], pinned: 1 },
  { id: 'sw_lth_etoupe', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '大象灰（爱马仕灰）', brand: '奢品皮料色卡', code: 'LTH-Etoupe', hex: '#8D847B', color_family: 'warm_gray', style_tags: ['意式极简', '高级灰'], pinned: 1 },
  { id: 'sw_lth_pebble', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '岩石浅灰皮', brand: '意式纳帕皮色卡', code: 'LTH-Pebble', hex: '#BFB8B0', color_family: 'warm_gray', style_tags: ['现代简约'], pinned: 1 },
  { id: 'sw_lth_obsidian', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '曜石黑真皮', brand: '经典包豪斯色卡', code: 'LTH-Obsidian', hex: '#232325', color_family: 'cool_gray', style_tags: ['包豪斯', '意式极简'], pinned: 1 },
  { id: 'sw_lth_orange', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '爱马仕橙皮', brand: '奢品皮料色卡', code: 'LTH-AmberOrange', hex: '#C85A28', color_family: 'terracotta_red', style_tags: ['跳色单椅', '现代轻奢'], pinned: 1 },
  { id: 'sw_lth_burgundy', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '勃艮第酒红皮', brand: '复古油蜡皮色卡', code: 'LTH-Burgundy', hex: '#5E2428', color_family: 'terracotta_red', style_tags: ['法式复古', '美式经典'], pinned: 1 },
  { id: 'sw_lth_british_green', category_id: 'mat_cat_leather', item_type: 'solid_color', name_zh: '复古墨绿真皮', brand: '英伦切斯特色卡', code: 'LTH-BritishGreen', hex: '#2B4238', color_family: 'green_blue', style_tags: ['英伦复古', '书房俱乐部'], pinned: 1 },

  // ── B. 沙发软包布艺 (mat_cat_fabric_upholstery) ──
  { id: 'sw_fab_boucle_white', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '羊羔绒云朵白', brand: '法式圈绒', code: 'FAB-Boucle-01', hex: '#F4EFE6', color_family: 'off_white', style_tags: ['奶油风', '法式简约'], pinned: 1 },
  { id: 'sw_fab_linen_oat', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '燕麦原麻色', brand: '天然棉麻', code: 'FAB-Linen-02', hex: '#DFD3C3', color_family: 'beige_brown', style_tags: ['原木风', '侘寂风'], pinned: 1 },
  { id: 'sw_fab_chenille_apricot', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '暖杏雪尼尔', brand: '重磅雪尼尔', code: 'FAB-Chenille-03', hex: '#CFBFA8', color_family: 'beige_brown', style_tags: ['现代简约'], pinned: 1 },
  { id: 'sw_fab_linen_taupe', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '亚麻灰褐（Taupe）', brand: '意式亚麻', code: 'FAB-Linen-04', hex: '#A89C90', color_family: 'warm_gray', style_tags: ['意式极简'], pinned: 1 },
  { id: 'sw_fab_chenille_charcoal', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '炭灰雪尼尔', brand: '重磅雪尼尔', code: 'FAB-Chenille-05', hex: '#585654', color_family: 'cool_gray', style_tags: ['现代极简'], pinned: 1 },
  { id: 'sw_fab_velvet_moss', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '复古苔藓绿丝绒', brand: '高定丝绒', code: 'FAB-Velvet-06', hex: '#4A5D4E', color_family: 'green_blue', style_tags: ['法式复古', '中古风'], pinned: 1 },
  { id: 'sw_fab_velvet_navy', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '藏蓝高定丝绒', brand: '高定丝绒', code: 'FAB-Velvet-07', hex: '#2C3E55', color_family: 'green_blue', style_tags: ['轻奢风', '艺术大宅'], pinned: 1 },
  { id: 'sw_fab_boucle_pumpkin', category_id: 'mat_cat_fabric_upholstery', item_type: 'solid_color', name_zh: '焦糖南瓜圈绒', brand: '法式圈绒', code: 'FAB-Boucle-08', hex: '#BA6838', color_family: 'terracotta_red', style_tags: ['跳色单椅', '中古风'], pinned: 1 },
  { id: 'sw_fab_linen_map', category_id: 'mat_cat_fabric_upholstery', item_type: 'texture_map', name_zh: '天然亚麻平纹（支持换色）', brand: '内置1K贴图', code: 'mat_linen_fabric', hex: '#DDD3C5', color_family: 'beige_brown', tintable: 1, pinned: 1 },
  { id: 'sw_fab_velvet_map', category_id: 'mat_cat_fabric_upholstery', item_type: 'texture_map', name_zh: '丝绒漫反射织物（支持换色）', brand: '内置1K贴图', code: 'mat_velvet_fabric', hex: '#8F8279', color_family: 'warm_gray', tintable: 1, pinned: 1 },

  // ── C. 艺术漆与微水泥 (mat_cat_art_plaster) ──
  { id: 'sw_mc_bone_white', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '侘寂骨白微水泥', brand: '磐多魔/西卡参考', code: 'MC-01 Bone', hex: '#EAE4DC', color_family: 'off_white', style_tags: ['侘寂风', '极简'], pinned: 1 },
  { id: 'sw_mc_ivory', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '荒漠象牙微水泥', brand: '磐多魔/西卡参考', code: 'MC-02 Ivory', hex: '#DFD5C7', color_family: 'beige_brown', style_tags: ['侘寂风', '原木风'], pinned: 1 },
  { id: 'sw_mc_warm_stone', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '岩石暖灰微水泥', brand: '磐多魔/西卡参考', code: 'MC-03 Warm Stone', hex: '#C2B9AE', color_family: 'warm_gray', style_tags: ['侘寂灰泥', '现代素雅'], pinned: 1 },
  { id: 'sw_mc_basalt', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '火山深灰微水泥', brand: '磐多魔/西卡参考', code: 'MC-04 Basalt', hex: '#7E7A75', color_family: 'cool_gray', style_tags: ['暗调极简', '侘寂'], pinned: 1 },
  { id: 'sw_ap_pearl', category_id: 'mat_cat_art_plaster', item_type: 'solid_color', name_zh: '小羊皮柔光珍珠白', brand: '卡百利/瓦科参考', code: 'AP-01 Pearl', hex: '#F1ECE3', color_family: 'off_white', style_tags: ['法式奶油', '蛋壳柔光'], pinned: 1 },
  { id: 'sw_mc_texture_map', category_id: 'mat_cat_art_plaster', item_type: 'texture_map', name_zh: '微水泥手批纹（支持任意换色）', brand: '内置1K贴图', code: 'mat_micro_cement', hex: '#C8C2B9', color_family: 'warm_gray', tintable: 1, pinned: 1 },

  // ── D. 实木护墙板与木地板 (mat_cat_wood_panel & mat_cat_wood_floor) ──
  { id: 'sw_wd_white_oak', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '北欧漂白橡木', brand: '天然原木色卡', code: 'WD-WhiteOak-01', hex: '#DFCBB2', color_family: 'beige_brown', style_tags: ['北欧风', '奶油原木'], pinned: 1 },
  { id: 'sw_wd_natural_oak', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '日式原木暖橡', brand: '天然原木色卡', code: 'WD-NaturalOak-02', hex: '#C8A97E', color_family: 'beige_brown', style_tags: ['日式原木', '无印风'], pinned: 1 },
  { id: 'sw_wd_cherry', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '蜂蜜暖调樱桃木', brand: '天然原木色卡', code: 'WD-Cherry-03', hex: '#B37A4C', color_family: 'beige_brown', style_tags: ['温馨美式', '复古原木'], pinned: 1 },
  { id: 'sw_wd_teak', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '中古缅甸柚木金棕', brand: '天然原木色卡', code: 'WD-Teak-04', hex: '#965D34', color_family: 'beige_brown', style_tags: ['中古风', '南洋复古'], pinned: 1 },
  { id: 'sw_wd_walnut', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '北美黑胡桃暖褐', brand: '天然原木色卡', code: 'WD-Walnut-05', hex: '#5C4030', color_family: 'beige_brown', style_tags: ['意式极简', '新中式'], pinned: 1 },
  { id: 'sw_wd_smoked_oak', category_id: 'mat_cat_wood_panel', item_type: 'solid_color', name_zh: '烟熏炭化乌木', brand: '天然原木色卡', code: 'WD-SmokedOak-06', hex: '#362D28', color_family: 'cool_gray', style_tags: ['暗调极简', '侘寂奢宅'], pinned: 1 },
  { id: 'sw_wd_oak_map', category_id: 'mat_cat_wood_panel', item_type: 'texture_map', name_zh: '天然白橡木直纹（1K贴图）', brand: '内置1K贴图', code: 'mat_oak_wood', hex: '#C8A97E', color_family: 'beige_brown', tintable: 1, pinned: 1 },
  { id: 'sw_wd_walnut_map', category_id: 'mat_cat_wood_panel', item_type: 'texture_map', name_zh: '北美黑胡桃木纹（1K贴图）', brand: '内置1K贴图', code: 'mat_walnut_wood', hex: '#5C4030', color_family: 'beige_brown', tintable: 1, pinned: 1 },

  // 地板同款同步
  { id: 'sw_flr_white_oak', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '北欧漂白橡木地板', brand: '天然原木色卡', code: 'FLR-WhiteOak-01', hex: '#DFCBB2', color_family: 'beige_brown', style_tags: ['北欧风', '奶油原木'], pinned: 1 },
  { id: 'sw_flr_natural_oak', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '日式原木暖橡地板', brand: '天然原木色卡', code: 'FLR-NaturalOak-02', hex: '#C8A97E', color_family: 'beige_brown', style_tags: ['日式原木', '无印风'], pinned: 1 },
  { id: 'sw_flr_walnut', category_id: 'mat_cat_wood_floor', item_type: 'solid_color', name_zh: '北美黑胡桃地板', brand: '天然原木色卡', code: 'FLR-Walnut-05', hex: '#5C4030', color_family: 'beige_brown', style_tags: ['意式极简', '大宅豪宅'], pinned: 1 },
  { id: 'sw_flr_oak_map', category_id: 'mat_cat_wood_floor', item_type: 'texture_map', name_zh: '白橡木地板纹理（1K贴图）', brand: '内置1K贴图', code: 'mat_oak_wood', hex: '#C8A97E', color_family: 'beige_brown', tintable: 1, pinned: 1 },

  // ── E. 天然大理石 / 洞石 / 岩板 / 水磨石 (mat_cat_stone) ──
  { id: 'sw_stn_carrara_map', category_id: 'mat_cat_stone', item_type: 'texture_map', name_zh: '卡拉拉鱼肚白大理石（1K）', brand: '天然石材', code: 'mat_carrara_marble', hex: '#ECEAE6', color_family: 'off_white', prompt_hint_zh: '象牙白底色配优雅灰金色流云纹理天然大理石', tintable: 0, pinned: 1 },
  { id: 'sw_stn_travertine_map', category_id: 'mat_cat_stone', item_type: 'texture_map', name_zh: '意大利罗马米白洞石（1K）', brand: '天然石材', code: 'mat_travertine', hex: '#D8CBB8', color_family: 'beige_brown', prompt_hint_zh: '温暖米黄色层状沉积岩纹理与自然细微孔洞', tintable: 0, pinned: 1 },
  { id: 'sw_stn_terrazzo_map', category_id: 'mat_cat_stone', item_type: 'texture_map', name_zh: '威尼斯彩色水磨石（1K）', brand: '天然水磨石', code: 'mat_terrazzo', hex: '#DEDAD2', color_family: 'warm_gray', prompt_hint_zh: '米白水泥基底镶嵌暖棕与灰白大理石骨料颗粒', tintable: 0, pinned: 1 },
  { id: 'sw_stn_bulgari', category_id: 'mat_cat_stone', item_type: 'solid_color', name_zh: '宝格丽黑金紫奢石', brand: '天然奢石花色', code: 'STN-Bulgari', hex: '#3A3235', color_family: 'cool_gray', prompt_hint_zh: '白色、深紫与黑金交织的戏剧性大花纹奢石', pinned: 1 },
  { id: 'sw_stn_prada_green', category_id: 'mat_cat_stone', item_type: 'solid_color', name_zh: '普拉达绿天然大理石', brand: '天然奢石花色', code: 'STN-PradaGreen', hex: '#3B5244', color_family: 'green_blue', prompt_hint_zh: '深邃森林绿底色交织白色冰裂纹天然奢石', pinned: 1 },
  { id: 'sw_stn_tundra_gray', category_id: 'mat_cat_stone', item_type: 'solid_color', name_zh: '云多拉灰大理石', brand: '经典大理石', code: 'STN-TundraGray', hex: '#8C8984', color_family: 'warm_gray', prompt_hint_zh: '意式极简高级暖灰底色配细腻白雾暗纹', pinned: 1 },
  { id: 'sw_stn_laurent_black', category_id: 'mat_cat_stone', item_type: 'solid_color', name_zh: '劳伦黑金大理石', brand: '经典大理石', code: 'STN-LaurentBlack', hex: '#222120', color_family: 'cool_gray', prompt_hint_zh: '纯正曜石黑底色配利落金白闪电直纹', pinned: 1 },

  // ── F. 定制柜门烤漆 / PET (mat_cat_cabinet_lacquer) ──
  { id: 'sw_cab_kemi_white', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '科米白（暖调肤感白）', brand: '定制柜门色卡', code: 'CAB-01', hex: '#F3EFE8', color_family: 'off_white', style_tags: ['奶油风', '原木风'], pinned: 1 },
  { id: 'sw_cab_cashmere', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '羊绒暖杏（Cashmere）', brand: '爱格W1000平替', code: 'CAB-02', hex: '#E2D7C7', color_family: 'beige_brown', style_tags: ['现代极简', '法式奶油'], pinned: 1 },
  { id: 'sw_cab_rock_gray', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '岩石暖灰（U702平替）', brand: '爱格U702平替', code: 'CAB-03', hex: '#B8B0A6', color_family: 'warm_gray', style_tags: ['现代极简'], pinned: 1 },
  { id: 'sw_cab_graphite', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '石墨深灰（U961平替）', brand: '爱格U961平替', code: 'CAB-04', hex: '#3D3C3A', color_family: 'cool_gray', style_tags: ['意式暗调', '现代极简'], pinned: 1 },
  { id: 'sw_cab_sage_green', category_id: 'mat_cat_cabinet_lacquer', item_type: 'solid_color', name_zh: '鼠尾草灰绿柜门', brand: '法式复古色卡', code: 'CAB-05', hex: '#9AA696', color_family: 'green_blue', style_tags: ['法式复古', '森系清新'], pinned: 1 },

  // ── G. 金属五金 (mat_cat_metal) ──
  { id: 'sw_mtl_brushed_brass', category_id: 'mat_cat_metal', item_type: 'solid_color', name_zh: '拉丝黄铜 / 复古金色', brand: '意式五金', code: 'MTL-01', hex: '#C59B5F', color_family: 'yellow_gold', style_tags: ['轻奢风', '中古风'], pinned: 1 },
  { id: 'sw_mtl_champagne_gold', category_id: 'mat_cat_metal', item_type: 'solid_color', name_zh: '意式香槟暗金', brand: '阳极氧化', code: 'MTL-02', hex: '#B8A282', color_family: 'yellow_gold', style_tags: ['现代极简', '意式轻奢'], pinned: 1 },
  { id: 'sw_mtl_black_titanium', category_id: 'mat_cat_metal', item_type: 'solid_color', name_zh: '哑光黑钛 / 磨砂黑', brand: '黑钛五金', code: 'MTL-03', hex: '#28282A', color_family: 'cool_gray', style_tags: ['极简黑金', '包豪斯'], pinned: 1 },
  { id: 'sw_mtl_mirror_chrome', category_id: 'mat_cat_metal', item_type: 'solid_color', name_zh: '包豪斯镜面镀铬银', brand: '电镀镜面', code: 'MTL-04', hex: '#D8DCDF', color_family: 'cool_gray', style_tags: ['包豪斯', '现代先锋'], pinned: 1 },

  // ── H. 玻璃镜面 (mat_cat_glass) ──
  { id: 'sw_gls_fluted', category_id: 'mat_cat_glass', item_type: 'solid_color', name_zh: '超白长虹竖纹玻璃', brand: '定制玻璃', code: 'GLS-01', hex: '#E4ECEE', color_family: 'off_white', style_tags: ['极简', '法式'], pinned: 1 },
  { id: 'sw_gls_tinted_tea', category_id: 'mat_cat_glass', item_type: 'solid_color', name_zh: '意式茶色透明玻璃', brand: '钢化玻璃', code: 'GLS-02', hex: '#6E5849', color_family: 'beige_brown', style_tags: ['意式轻奢', '中古风'], pinned: 1 },
  { id: 'sw_gls_smoked_gray', category_id: 'mat_cat_glass', item_type: 'solid_color', name_zh: '烟熏灰玻', brand: '钢化玻璃', code: 'GLS-03', hex: '#6E7378', color_family: 'cool_gray', style_tags: ['现代极简', '黑框门'], pinned: 1 },

  // ── I. 窗帘床品 (mat_cat_textile_drapery) ──
  { id: 'sw_drp_moon_white', category_id: 'mat_cat_textile_drapery', item_type: 'solid_color', name_zh: '月光透景白纱', brand: '亚麻白纱', code: 'DRP-01', hex: '#F7F5F0', color_family: 'off_white', style_tags: ['奶油风', '原木风'], pinned: 1 },
  { id: 'sw_drp_oat_linen', category_id: 'mat_cat_textile_drapery', item_type: 'solid_color', name_zh: '亚麻燕麦窗帘', brand: '垂感棉麻', code: 'DRP-02', hex: '#DFD4C4', color_family: 'beige_brown', style_tags: ['日式原木', '侘寂'], pinned: 1 },
  { id: 'sw_drp_milk_tea', category_id: 'mat_cat_textile_drapery', item_type: 'solid_color', name_zh: '奶茶暖咖遮光帘', brand: '高精密遮光', code: 'DRP-03', hex: '#B8A38E', color_family: 'beige_brown', style_tags: ['温馨卧室', '现代轻奢'], pinned: 1 },

  // ── J. 地毯织物 (mat_cat_rug) ──
  { id: 'sw_rug_raw_wool', category_id: 'mat_cat_rug', item_type: 'solid_color', name_zh: '原色未染羊毛白', brand: '纯羊毛地毯', code: 'RUG-01', hex: '#EAE3D5', color_family: 'off_white', style_tags: ['奶油风', '法式'], pinned: 1 },
  { id: 'sw_rug_sisal_brown', category_id: 'mat_cat_rug', item_type: 'solid_color', name_zh: '侘寂剑麻浅棕', brand: '天然剑麻', code: 'RUG-02', hex: '#C4AC8E', color_family: 'beige_brown', style_tags: ['日式原木', '侘寂风'], pinned: 1 },
  { id: 'sw_rug_geometric_gray', category_id: 'mat_cat_rug', item_type: 'solid_color', name_zh: '暖灰几何圈绒', brand: '现代地毯', code: 'RUG-03', hex: '#9E968D', color_family: 'warm_gray', style_tags: ['现代简约'], pinned: 1 },

  // ── K. 瓷砖与花砖 (mat_cat_tile) ──
  { id: 'sw_til_cream_matte', category_id: 'mat_cat_tile', item_type: 'solid_color', name_zh: '柔光奶油素色砖', brand: '素色大砖', code: 'TIL-01', hex: '#EFECE4', color_family: 'off_white', style_tags: ['奶油风', '极简卫生间'], pinned: 1 },
  { id: 'sw_til_cement_gray', category_id: 'mat_cat_tile', item_type: 'solid_color', name_zh: '水泥暖灰柔光砖', brand: '素色大砖', code: 'TIL-02', hex: '#B8B3AB', color_family: 'warm_gray', style_tags: ['现代极简', '侘寂'], pinned: 1 },
  { id: 'sw_til_green_zellige', category_id: 'mat_cat_tile', item_type: 'solid_color', name_zh: '手工翡翠绿面包砖', brand: '摩洛哥手工砖', code: 'TIL-03', hex: '#3B6E5C', color_family: 'green_blue', style_tags: ['法式复古', '中古厨房'], pinned: 1 }
];

/**
 * 幂等将 8 大部位、12 大基材品类及全部专属色卡写入数据库
 */
function seedMasterDictionary(db) {
  const now = new Date().toISOString();

  // 1. 部位落库 (ba_parts)
  const insPart = db.prepare(`
    INSERT INTO ba_parts (
      id, name_zh, name_en, jev_aliases, preserve_clause_zh, preserve_clause_en,
      default_category_id, sort_order, is_system, enabled, created_at, updated_at
    ) VALUES (
      @id, @name_zh, @name_en, @jev_aliases, @preserve_clause_zh, @preserve_clause_en,
      @default_category_id, @sort_order, @is_system, 1, @now, @now
    )
    ON CONFLICT(id) DO UPDATE SET
      name_zh = excluded.name_zh,
      name_en = excluded.name_en,
      jev_aliases = excluded.jev_aliases,
      preserve_clause_zh = excluded.preserve_clause_zh,
      preserve_clause_en = excluded.preserve_clause_en,
      default_category_id = excluded.default_category_id,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `);

  for (const part of MASTER_PARTS) {
    insPart.run({ ...part, now });
  }

  // 2. 基材品类落库 (ba_material_categories)
  const insCat = db.prepare(`
    INSERT INTO ba_material_categories (
      id, name_zh, name_en, track_mode, allowed_parts, default_finish_id,
      finishes_json, sort_order, is_system, enabled, created_at, updated_at
    ) VALUES (
      @id, @name_zh, @name_en, @track_mode, @allowed_parts, @default_finish_id,
      @finishes_json, @sort_order, @is_system, 1, @now, @now
    )
    ON CONFLICT(id) DO UPDATE SET
      name_zh = excluded.name_zh,
      name_en = excluded.name_en,
      track_mode = excluded.track_mode,
      allowed_parts = excluded.allowed_parts,
      default_finish_id = excluded.default_finish_id,
      finishes_json = excluded.finishes_json,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `);

  for (const cat of MASTER_CATEGORIES) {
    insCat.run({ ...cat, now });
  }

  // 3. 专属色卡与花色资产落库 (ba_material_swatches)
  const insSwatch = db.prepare(`
    INSERT INTO ba_material_swatches (
      id, category_id, item_type, name_zh, brand, code, hex, lrv, color_family,
      style_tags, finish_override, prompt_hint_zh, prompt_hint_en, texture_1k_path,
      preview_path, tintable, source_type, pinned, sort_order, enabled, created_at, updated_at
    ) VALUES (
      @id, @category_id, @item_type, @name_zh, @brand, @code, @hex, @lrv, @color_family,
      @style_tags, @finish_override, @prompt_hint_zh, @prompt_hint_en, @texture_1k_path,
      @preview_path, @tintable, @source_type, @pinned, @sort_order, 1, @now, @now
    )
    ON CONFLICT(id) DO UPDATE SET
      category_id = excluded.category_id,
      item_type = excluded.item_type,
      name_zh = excluded.name_zh,
      brand = excluded.brand,
      code = excluded.code,
      hex = excluded.hex,
      lrv = excluded.lrv,
      color_family = excluded.color_family,
      style_tags = excluded.style_tags,
      prompt_hint_zh = excluded.prompt_hint_zh,
      tintable = excluded.tintable,
      pinned = excluded.pinned,
      updated_at = excluded.updated_at
  `);

  // 先写入专属规格色卡
  for (const s of MASTER_SWATCHES_SPEC) {
    const lrv = s.lrv !== undefined ? s.lrv : calculateLrv(s.hex);
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

  // 随后将 CURATED_PAINTS (乳胶漆 72 色) 完整映射入库为 mat_cat_latex
  for (const cp of (CURATED_PAINTS || [])) {
    const swatchId = `sw_latex_${(cp.brand || 'paint').toLowerCase()}_${(cp.code || cp.id).toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
    const lrv = typeof cp.lrv === 'number' ? cp.lrv : calculateLrv(cp.hex);
    const colorFamily = cp.family_key || deriveColorFamily(cp.hex);
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
      pinned: cp.pinned ? 1 : 0,
      sort_order: 0,
      now
    });
  }
}

module.exports = {
  MASTER_PARTS,
  MASTER_CATEGORIES,
  MASTER_SWATCHES_SPEC,
  seedMasterDictionary
};
