/**
 * 标签字典种子：
 * 室内主维：space（单选）/ style_atom（文化风格与木系风格，多选0-3个，永不为空）/ material_kind（硬装≤2 + 软装≤2）/ orientation（质检）
 * 主色走 assets.dominant_color 与 asset_colors（12 色板质检，不进 VLM）
 * 单品主维：furniture_* / classic_design（本轮不重打）
 * 辅助维与 flags/color_style/旧 palette/wood_style 等全部 deprecated
 * 风格树：地域/文化/木系大区 → 叶子；四种木色并入 style_atom 统一打标与检索；去除「混搭」，兜底落入「其他风格」
 */

const DIMENSIONS = [
  { dimKey: 'space',              label: '空间',         multi: false, isPrimary: true },
  { dimKey: 'style_atom',         label: '风格',         multi: true,  isPrimary: true },
  { dimKey: 'style_region',       label: '风格大区',     multi: false, isPrimary: false },
  { dimKey: 'wood_style',         label: '木系风格',     multi: false, deprecated: true },
  { dimKey: 'material_kind',     label: '材质',         multi: true,  isPrimary: true },
  { dimKey: 'orientation',        label: '画幅',         multi: false, isPrimary: true },

  { dimKey: 'furniture_category', label: '家具大类',     multi: false, isPrimary: true, isFurniture: true },
  { dimKey: 'furniture_item',     label: '单品品类',     multi: false, isPrimary: true, isFurniture: true },
  { dimKey: 'furniture_craft',    label: '表面工艺',     multi: true,  isPrimary: false, isFurniture: true, isAdvanced: true },
  { dimKey: 'furniture_form',     label: '造型特征',     multi: false, isPrimary: false, isFurniture: true, isAdvanced: true },
  { dimKey: 'classic_design',     label: '经典款名',     multi: false, isPrimary: true, isFurniture: true },

  // 人像维度
  { dimKey: 'gender',             label: '性别',         multi: false, isPrimary: true, isPortrait: true },
  { dimKey: 'person_style',       label: '人物风格',     multi: true,  isPrimary: true, isPortrait: true },
  { dimKey: 'shot_type',          label: '景别',         multi: false, isPrimary: true, isPortrait: true },

  // 服装维度
  { dimKey: 'clothing_category',  label: '服装品类',     multi: false, isPrimary: true, isClothing: true },
  { dimKey: 'clothing_style',     label: '穿搭风格',     multi: true,  isPrimary: true, isClothing: true },
  { dimKey: 'season',             label: '季节',         multi: false, isPrimary: true, isClothing: true },
  { dimKey: 'mood',               label: '情绪',         multi: false, isPrimary: true },
  { dimKey: 'video_purpose',      label: '成片用途',     multi: false, isPrimary: true },
  { dimKey: 'audio_role',         label: '音频角色',     multi: false, isPrimary: true },

  { dimKey: 'color_style',        label: '色系',         multi: true,  deprecated: true },
  { dimKey: 'flags',              label: '标记',         multi: true,  deprecated: true },
  { dimKey: 'palette',            label: '配色主题',     multi: false, deprecated: true },
  { dimKey: 'luxury',             label: '奢华度',       multi: false, deprecated: true },
  { dimKey: 'era',                label: '时代感',       multi: false, deprecated: true },
  { dimKey: 'temperature',        label: '温度',         multi: false, deprecated: true },
  { dimKey: 'functional',         label: '功能性',       multi: false, deprecated: true },
  { dimKey: 'quality',            label: '质量档',       multi: false, deprecated: true },
  { dimKey: 'region',             label: '文化地域',     multi: false, deprecated: true },
  { dimKey: 'material_family',    label: '材质族',       multi: true,  deprecated: true },
  { dimKey: 'tone',               label: '调性氛围',     multi: true,  deprecated: true },
  { dimKey: 'view_composition',   label: '构图景别',     multi: false, deprecated: true },
  { dimKey: 'view_angle',         label: '机位视角',     multi: false, deprecated: true },
  { dimKey: 'lighting',           label: '光线',         multi: false, deprecated: true }
];

// [dir, label, dim, parent?, aliases?]
const VALUES = [
  // space（17，玄关门厅拆成门外门廊 / 门内门厅）
  ['porch','门外门廊','space', null, ['门外','门廊']],
  ['foyer','门内门厅','space', null, ['门厅','玄关','玄关门厅','entryway']],
  ['living_room','客厅','space'],
  ['dining_room','餐厅','space'],
  ['kitchen','厨房','space'],
  ['bedroom','卧室','space'],
  ['bathroom','卫浴','space'],
  ['study','书房','space'],
  ['balcony','阳台露台','space'],
  ['walk_in_closet','衣帽间','space'],
  ['courtyard','庭院','space'],
  ['pond','池塘','space'],
  ['pool','泳池','space'],
  ['tea_space','茶空间','space'],
  ['bay_window','飘窗','space'],
  ['detail_closeup','细节特写','space'],
  ['other','其他','space'],
  ['entryway','玄关门厅','space'],

  // style_region（大区，供两层筛选分组；不直接打标）
  ['east_asia','东亚','style_region'],
  ['europe','欧洲','style_region'],
  ['americas','美洲','style_region'],
  ['southeast_asia','东南亚南洋','style_region'],
  ['modern_movement','现代流派','style_region'],
  ['other_region','其他','style_region'],
  ['wood_system','木系','style_region'],

  // style_atom（文化叶子 16，多选；两层：大区 parent）
  // 东亚：宋式/新中式/古典中式 三分；日式已取消（并入木系表面）
  ['wabi_sabi','侘寂','style_atom','east_asia', ['侘寂风']],
  ['song_aesthetic','宋式美学','style_atom','east_asia', ['宋式','宋代美学']],
  ['neo_chinese','新中式','style_atom','east_asia'],
  ['classical_chinese','古典中式','style_atom','east_asia', ['中式古典','明清中式']],
  // 欧洲：法式/意式/托斯卡纳/地中海；北欧、英式取消；欧式轻奢废除
  ['french','法式','style_atom','europe', ['法式风']],
  ['italian','意式','style_atom','europe', ['意式风']],
  ['tuscan','托斯卡纳','style_atom','europe', ['托斯卡纳风']],
  ['mediterranean','地中海','style_atom','europe', ['地中海风']],
  // 现代流派：中古MCM→中古风
  ['modern_minimal','现代极简','style_atom','modern_movement', ['现代简约','极简主义']],
  ['cream_style','奶油风','style_atom','modern_movement'],
  ['industrial','工业风','style_atom','modern_movement', ['工业']],
  ['mid_century','中古风','style_atom','modern_movement', ['中古MCM','MCM','中古现代']],
  // 美洲：拆现代美式 / 美式乡村
  ['american_modern','现代美式','style_atom','americas', ['美式']],
  ['american_country','美式乡村','style_atom','americas', ['美式农舍','农舍','美式乡村风']],
  // 东南亚 / 其他
  ['nanyang_resort','南洋度假','style_atom','southeast_asia', ['南洋','度假风']],
  ['other','其他风格','style_atom','other_region', ['其他','未分类风格','混搭','其他混搭']],

  // 木系风格 4 种（并入 style_atom 统一打标与检索）
  ['natural_wood','自然原木风','style_atom','wood_system', ['原木风','浅色原木','日式','浅色原木风']],
  ['dark_wood','深色原木风','style_atom','wood_system', ['深色原木','深木','深木风']],
  ['natural_vintage_wood','自然复古原木风','style_atom','wood_system', ['浅色做旧原木','做旧原木']],
  ['dark_vintage_wood','深色复古原木风','style_atom','wood_system', ['深色做旧原木','深色石头复古']],

  // ---------------- 人像专属维度 ----------------
  ['female','女','gender', null, ['女性','女生','女士']],
  ['male','男','gender', null, ['男性','男生','男士']],
  ['child','儿童','gender', null, ['小孩','女童','男童','幼童']],
  ['neutral','中性','gender'],

  // person_style (人物风格 / 气质)
  ['gentle','温婉','person_style', null, ['温婉柔美','柔和']],
  ['dignified','大方','person_style', null, ['端庄大方','端庄']],
  ['capable','干练','person_style', null, ['精明干练','利落']],
  ['intellectual','知性','person_style', null, ['知性优雅','优雅']],
  ['sweet','甜美','person_style', null, ['甜美清新','甜妹']],
  ['guofeng','国风','person_style', null, ['国风古韵','新中式','汉服']],
  ['cool','酷飒','person_style', null, ['酷冷','冷艳','中性帅气']],
  ['workplace','职场','person_style', null, ['商务职场','白领']],
  ['casual_home','居家休闲','person_style', null, ['休闲随性','生活感']],

  // shot_type (景别)
  ['close_up','特写','shot_type', null, ['面部特写','头部']],
  ['half_body','半身','shot_type', null, ['胸像','大半身','半身像']],
  ['full_body','全身','shot_type', null, ['全身立绘','全身照']],

  // ---------------- 服装专属维度 ----------------
  // clothing_category (服装品类)
  ['top','上衣','clothing_category', null, ['衬衫','T恤','毛衣','卫衣']],
  ['pants','裤装','clothing_category', null, ['长裤','短裤','阔腿裤','牛仔裤']],
  ['skirt','裙装','clothing_category', null, ['连衣裙','半身裙']],
  ['coat','外套','clothing_category', null, ['大衣','风衣','羽绒服','西装外套','夹克']],
  ['suit','套装','clothing_category', null, ['西装套装','休闲套装']],
  ['shoes_bags','鞋包','clothing_category', null, ['包包','鞋子','配饰']],

  ['commute','通勤','clothing_style', null, ['通勤职场','职场装','商务通勤']],
  ['casual','休闲','clothing_style', null, ['日常休闲']],
  ['sport','运动','clothing_style', null, ['运动户外','山系','户外']],
  ['formal','礼服','clothing_style'],
  ['guochao','国潮','clothing_style', null, ['新中式国潮','汉元素']],
  ['french','法式','clothing_style', null, ['法式复古']],
  ['minimal','极简','clothing_style'],
  ['sweet_cool','甜酷','clothing_style', null, ['甜美淑女']],
  ['french_retro','法式复古','clothing_style'],
  ['chinese_tide','新中式国潮','clothing_style'],
  ['street','街头潮牌','clothing_style'],
  ['sweet','甜美淑女','clothing_style'],

  ['spring_summer','春夏','season', null, ['春','夏','春季','夏季']],
  ['autumn_winter','秋冬','season', null, ['秋','冬','秋季','冬季']],
  ['all_season','通季','season', null, ['四季通用','四季']],
  ['spring','春','season'],
  ['summer','夏','season'],
  ['autumn','秋','season'],
  ['winter','冬','season'],

  ['easy','轻松','mood'],
  ['lyrical','抒情','mood'],
  ['cheerful','欢快','mood'],
  ['quiet','安静','mood'],
  ['epic','史诗','mood'],
  ['tense','紧张','mood'],
  ['warm','温暖','mood'],
  ['retro','复古','mood'],

  ['walkthrough','空间漫游','video_purpose', null, ['漫游','空间走查']],
  ['product','单品展示','video_purpose', null, ['环绕','产品展示']],
  ['detail','细节特写','video_purpose', null, ['特写','微距']],
  ['ad','商业短片','video_purpose', null, ['广告','宣传片']],
  ['portrait','人像动态','video_purpose', null, ['人物动态']],
  ['other','其他','video_purpose'],

  ['bgm','氛围背景乐','audio_role', null, ['背景乐','纯音乐']],
  ['sfx','环境音效','audio_role', null, ['音效','环境声']],

  // 旧值（deprecated，仅迁移/兼容）
  ['european_light_luxury','欧式轻奢','style_atom', null, ['法式轻奢','意式极简','意式轻奢']],
  ['log_wood','原木日式','style_atom'],
  ['japanese','日式','style_atom'],
  ['nordic','北欧','style_atom', null, ['北欧风']],
  ['british','英式','style_atom'],
  ['french_light_luxury','法式轻奢','style_atom'],
  ['italian_modern','意式极简/轻奢','style_atom'],
  ['japandi','Japandi','style_atom'],
  ['american','美式','style_atom'],
  ['american_farmhouse','美式乡村/农舍','style_atom'],
  ['mid_century_global','中古MCM','style_atom'],
  ['tuscan_country','地中海/托斯卡纳','style_atom'],

  // material_family（12）
  ['wood','木','material_family'],['stone','石','material_family'],['coating','涂层','material_family'],
  ['metal','金属','material_family'],['fabric','织物','material_family'],['leather','皮革','material_family'],
  ['glass','玻璃','material_family'],['ceramic','陶砖','material_family'],['rattan_bamboo','藤竹','material_family'],
  ['composite','复合材','material_family'],['board','板材基材','material_family'],['concrete_inorganic','混凝土无机','material_family'],

  // material_kind（22）
  ['oak','橡木','material_kind','wood'],['walnut','胡桃木','material_kind','wood', ['红木']],['teak','柚木','material_kind','wood'],
  ['light_wood','浅木','material_kind','wood', ['浅木(松/桦)','松木','桦木']],
  ['marble','大理石','material_kind','stone'],['travertine','洞石','material_kind','stone', ['洞石/石灰华','石灰华']],
  ['terrazzo','水磨石','material_kind','concrete_inorganic'],
  ['sintered_stone','岩板','material_kind','composite'],
  ['microcement','微水泥','material_kind','coating'],['art_coating','艺术漆','material_kind','coating'],
  ['lime_plaster','灰泥','material_kind','coating', ['灰泥/石灰抹面']],['paint','乳胶漆','material_kind','coating'],
  ['tile','瓷砖','material_kind','ceramic', ['瓷砖/花砖']],['terracotta','赤陶','material_kind','ceramic'],
  ['brass','黄铜','material_kind','metal'],['black_steel','黑钢','material_kind','metal', ['黑钢/黑钛']],
  ['glass_clear','玻璃','material_kind','glass'],
  ['linen','棉麻/亚麻','material_kind','fabric'],['velvet','丝绒','material_kind','fabric', ['丝绒/绒布']],
  ['boucle','羊羔绒','material_kind','fabric'],['leather_real','真皮','material_kind','leather', ['真皮/皮革']],
  ['rattan','藤编','material_kind','rattan_bamboo'],

  // orientation（真值分桶：误差 ≤ 2% 才标 9:16/3:4/2:3）
  ['9:16','9:16','orientation'],
  ['3:4','3:4','orientation'],
  ['2:3','2:3','orientation'],
  ['portrait','竖图（非标准）','orientation'],
  ['landscape','横图','orientation'],
  ['square','方图','orientation'],
  ['16:9','16:9','orientation'],
  ['4:3','4:3','orientation'],
  ['1:1','1:1','orientation'],

  // color_style（8，派生，P3）
  ['mono_minimal','黑白灰极简','color_style'],
  ['wood_japandi','原木日系','color_style'],
  ['earth_wabi','大地侘寂','color_style'],
  ['morandi','莫兰迪低饱和','color_style'],
  ['cream_macaron','奶油马卡龙','color_style'],
  ['warm_tone','暖色调','color_style'],
  ['cool_tone','冷色调','color_style'],
  ['high_sat_clash','高饱和撞色','color_style'],

  // flags 布尔弱标签
  ['ai_generated','AI生成','flags'],
  ['renovation','装修实拍','flags'],
  ['commercial','商业空间','flags'],
  ['residential','住宅','flags'],

  // ---------------- 单品专精维度 (Furniture Dimensions) ----------------
  // furniture_category (7 大类)
  ['seating','坐具','furniture_category'],
  ['table','案几台桌','furniture_category'],
  ['storage','收纳柜架','furniture_category'],
  ['bedding','卧具寝具','furniture_category'],
  ['lighting_device','灯具照明','furniture_category'],
  ['decor_soft','软装饰品','furniture_category'],
  ['sanitary','卫浴洁具','furniture_category'],

  // furniture_item (细分单品)
  ['armchair','休闲椅/扶手椅','furniture_item','seating'],
  ['dining_chair','餐椅','furniture_item','seating'],
  ['bar_stool','吧椅','furniture_item','seating'],
  ['sofa_single','单人沙发','furniture_item','seating'],
  ['sofa_multi','三人/组合沙发','furniture_item','seating'],
  ['bench_ottoman','长凳/换鞋凳/脚踏','furniture_item','seating'],
  ['coffee_table','茶几','furniture_item','table'],
  ['dining_table','餐桌','furniture_item','table'],
  ['side_table','边几/角几','furniture_item','table'],
  ['desk','书桌/工作台','furniture_item','table'],
  ['tv_cabinet','电视柜','furniture_item','storage'],
  ['sideboard','餐边柜','furniture_item','storage'],
  ['chest_of_drawers','斗柜','furniture_item','storage'],
  ['bookcase_shelf','书架/展示柜','furniture_item','storage'],
  ['wardrobe','衣柜','furniture_item','storage'],
  ['bed','床/床架','furniture_item','bedding'],
  ['nightstand','床头柜','furniture_item','bedding'],
  ['pendant_light','吊灯','furniture_item','lighting_device'],
  ['floor_lamp','落地灯','furniture_item','lighting_device'],
  ['table_lamp','台灯','furniture_item','lighting_device'],
  ['wall_sconce','壁灯','furniture_item','lighting_device'],
  ['carpet','地毯','furniture_item','decor_soft'],
  ['vase_flower','花器/花瓶','furniture_item','decor_soft'],
  ['artwork_sculpture','摆件/雕塑/挂画','furniture_item','decor_soft'],
  ['mirror','镜子/穿衣镜','furniture_item','decor_soft'],
  ['bathtub','浴缸','furniture_item','sanitary'],
  ['washbasin','台盆/洗手台','furniture_item','sanitary'],

  // furniture_craft (表面工艺与质感)
  ['matte_lacquer','哑光烤漆','furniture_craft'],
  ['gloss_lacquer','高光烤漆','furniture_craft'],
  ['vintage_distressed','做旧复古','furniture_craft'],
  ['brushed_metal','拉丝金属','furniture_craft'],
  ['anodized','阳极氧化','furniture_craft'],
  ['electroplated','电镀抛光','furniture_craft'],
  ['smoked_wood','烟熏碳化','furniture_craft'],
  ['wood_wax_oil','木蜡油天然','furniture_craft'],
  ['raw_texture','粗粝肌理','furniture_craft'],

  // furniture_form (造型结构特征)
  ['organic_curve','有机流线型','furniture_form'],
  ['geometric_block','方正几何','furniture_form'],
  ['modular','模块化组合','furniture_form'],
  ['cantilever','悬挑/悬浮','furniture_form'],
  ['curved_irregular','弧形/异形','furniture_form'],
  ['slender_legs','极简细脚','furniture_form'],
  ['solid_volume','实心体块','furniture_form'],

  // classic_design (经典名品款名)
  ['wassily_chair','瓦西里椅','classic_design'],
  ['eames_lounge','伊姆斯休闲椅','classic_design'],
  ['barcelona_chair','巴塞罗那椅','classic_design'],
  ['chandigarh_chair','昌迪加尔椅','classic_design'],
  ['togo_sofa','毛毛虫沙发','classic_design'],
  ['camaleonda_sofa','变色龙沙发','classic_design'],
  ['up50_chair','母性之爱椅(UP50)','classic_design'],
  ['diamond_chair','钻石椅','classic_design'],
  ['ghost_chair','幽灵椅','classic_design'],
  ['cesca_chair','塞斯卡椅','classic_design'],
  ['other_classic','其他经典名品','classic_design'],

  // ---------------- 辅助检索维度 ----------------
  // region（8）
  ['chinese','中式','region'],['japanese','日式','region'],['nordic','北欧','region'],
  ['italian_mediterranean','意式-地中海','region'],['french','法式','region'],['american','美式','region'],
  ['southeast_asian_tropical','东南亚-热带','region'],['eclectic_global','混搭-全球风','region'],

  // tone（10）
  ['minimal','极简','tone'],['light_luxury','轻奢','tone'],['natural_log','原木调','tone'],
  ['wabi_sabi_texture','侘寂质感','tone'],['cream','奶油','tone'],['resort','度假','tone'],
  ['industrial_cold','工业冷峻','tone'],['rustic','乡村田园','tone'],['modern','现代','tone'],['eclectic','混搭','tone'],

  // view_composition / view_angle / lighting
  ['full_view','全景','view_composition'],['medium_view','中景','view_composition'],['closeup_view','特写','view_composition'],
  ['eye_level','平视','view_angle'],['high_angle','俯瞰','view_angle'],['low_angle','仰视','view_angle'],['aerial','鸟瞰','view_angle'],
  ['natural_day','白天自然光','lighting'],['dusk','黄昏','lighting'],['night','夜景','lighting'],['artificial','人工氛围光','lighting'],

  // ---------------- 废弃维度 (保留历史数据查询兼容，但在 seed 时置 deprecated=1) ----------------
  ['warm_cream','奶白米杏暖咖','palette'],['cool_earth','黑白灰冷大地','palette'],
  ['achromatic','纯黑白灰无彩','palette'],['morandi_old','莫兰迪低饱和灰调','palette'],
  ['deep_wood_cn','深木国风色','palette'],['white_wood_accent','白浅木跳色','palette'],
  ['blue_white_med','蓝白地中海','palette'],['terracotta_stone','赤陶暖石','palette'],
  ['deep_green_walnut','深绿胡桃','palette'],['sage_olive','鼠尾草/橄榄灰绿','palette'],
  ['black_luxury','黑金深暗+金属','palette'],['earthy_warm','焦糖大地棕','palette'],
  ['mixed_other','其它/混搭','palette'],
  ['plain','质朴素雅','luxury'],['restrained','克制微奢','luxury'],['high_end','高奢华美','luxury'],
  ['vintage','复古经典','era'],['contemporary','当代现代','era'],['futuristic','未来前卫','era'],
  ['warm','暖调温馨','temperature'],['neutral','中性平和','temperature'],['cool','冷峻冷静','temperature'],
  ['aesthetic','偏陈设美学','functional'],['balanced','美学实用平衡','functional'],['practical','强功能收纳','functional'],
  ['waste','废片','quality'],['usable','可用','quality'],['good','较好','quality'],['excellent','优秀','quality']
].map(([dir, label, dim, parent, aliases]) => ({ dir, label, dim, parent, aliases }));

const DOMINANT_COLORS = [
  { name: '白', hex: '#FAFAF8', desc: '纯白/冷白/微白' },
  { name: '米/奶油', hex: '#F3E8D2', desc: '奶油色/米杏/暖白' },
  { name: '原木/木色', hex: '#C49A6C', desc: '橡木/原木/胡桃木色' },
  { name: '灰', hex: '#9E9E9E', desc: '微水泥灰/浅灰/深灰' },
  { name: '黑', hex: '#212121', desc: '纯黑/碳黑/深色金属' },
  { name: '红', hex: '#D32F2F', desc: '枣红/朱砂红/复古红' },
  { name: '粉', hex: '#F48FB1', desc: '脏粉/莫兰迪粉/淡粉' },
  { name: '橙', hex: '#FB8C00', desc: '爱马仕橙/赤陶橙/鲜橙' },
  { name: '黄', hex: '#FDD835', desc: '姜黄/明黄/鹅黄' },
  { name: '绿', hex: '#4CAF50', desc: '鼠尾草绿/橄榄绿/墨绿' },
  { name: '蓝', hex: '#1976D2', desc: '克莱因蓝/深蓝灰/天蓝' },
  { name: '紫', hex: '#7E57C2', desc: '薰衣草紫/暗紫' },
];

const HARD_MATERIALS = new Set([
  'oak', 'walnut', 'teak', 'light_wood',
  'marble', 'travertine', 'terrazzo', 'sintered_stone',
  'microcement', 'art_coating', 'lime_plaster', 'paint',
  'tile', 'terracotta',
  'brass', 'black_steel', 'glass_clear'
]);

const SOFT_MATERIALS = new Set([
  'linen', 'velvet', 'boucle', 'leather_real', 'rattan'
]);

function getMaterialGroup(dir) {
  if (HARD_MATERIALS.has(dir)) return 'hard';
  if (SOFT_MATERIALS.has(dir)) return 'soft';
  return 'other';
}

const { calculateOriginOrientation, classifyOrientation } = require('./ratio');

module.exports = {
  DIMENSIONS,
  VALUES,
  DOMINANT_COLORS,
  HARD_MATERIALS,
  SOFT_MATERIALS,
  getMaterialGroup,
  calculateOriginOrientation,
  classifyOrientation
};
