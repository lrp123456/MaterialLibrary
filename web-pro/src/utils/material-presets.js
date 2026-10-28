/**
 * 室内设计基础属性标准矩阵与材质色板预设库
 * 严格对齐《室内设计属性优化》标准化体系：
 * 1. 基础材质类别 (Base Material) - 木质/石材泥料/织物皮革/金属玻璃
 * 2. 色彩系统与调色 (Color Palette) - 室内经典色系 + 原生取色器 + 明度/饱和度微调
 * 3. 表面物理属性 (Finish & Roughness) - 4档光泽单选 + 连续粗糙度滑块 (0%~100%)
 * 4. 做旧与年代感 (Aging & Patina) - 4档年代单选
 */

export const MATERIAL_CATEGORIES = [
  {
    id: 'wood',
    name: '木质',
    items: [
      { id: 'black_walnut', name: '北美黑胡桃', color: '#4A3525', textureType: 'wood_dark', desc: '深沉优雅，经典大山纹' },
      { id: 'white_oak', name: '自然白橡木', color: '#C8B293', textureType: 'wood_light', desc: '浅淡温润，山形纹理' },
      { id: 'cherry_wood', name: '温暖樱桃木', color: '#8E4A35', textureType: 'wood_cherry', desc: '温润细腻，红润暖调' },
      { id: 'charred_wood', name: '炭化黑木', color: '#1E1D1F', textureType: 'wood_charred', desc: '侘寂深邃，裂纹质感' },
      { id: 'plywood', name: '桦木海洋板', color: '#DEC8A6', textureType: 'wood_light', desc: '极简工业，层压切面' },
    ]
  },
  {
    id: 'stone',
    name: '石材与泥料',
    items: [
      { id: 'roman_travertine', name: '罗马洞石', color: '#D8CBB7', textureType: 'stone_travertine', desc: '天然气孔，米黄侘寂' },
      { id: 'micro_cement', name: '极简微水泥', color: '#B5B4AF', textureType: 'cement', desc: '平整无缝，素雅骨料' },
      { id: 'calacatta_marble', name: '鱼肚白大理石', color: '#EAEBEB', textureType: 'stone_marble', desc: '白底灰金网纹，奢石通透' },
      { id: 'terrazzo', name: '复古水磨石', color: '#C5BEB5', textureType: 'stone_terrazzo', desc: '多彩骨料碎石，复古活泼' },
      { id: 'limestone', name: '极简莱姆石', color: '#CDC5B4', textureType: 'stone_limestone', desc: '亚光柔和，原生贝类沉积' },
    ]
  },
  {
    id: 'fabric',
    name: '织物与皮革',
    items: [
      { id: 'boucle', name: '羊羔绒 (Bouclé)', color: '#EDE8E1', textureType: 'fabric_boucle', desc: '立体颗粒卷毛，治愈温暖' },
      { id: 'linen', name: '高精密棉麻', color: '#D2C8BA', textureType: 'fabric_linen', desc: '天然粗细节纱，透气朴素' },
      { id: 'velvet', name: '复古丝绒', color: '#2B423B', textureType: 'fabric_velvet', desc: '丰满绒毛，流动光泽' },
      { id: 'wax_leather', name: '复古油蜡皮', color: '#6A442E', textureType: 'leather_wax', desc: '变色双色光泽，温润折痕' },
      { id: 'chenille', name: '雪尼尔面料', color: '#D9D0C5', textureType: 'fabric_chenille', desc: '厚实羽纱，亲肤软糯' },
    ]
  },
  {
    id: 'metal_glass',
    name: '金属与玻璃',
    items: [
      { id: 'brushed_brass', name: '拉丝黄铜', color: '#C6A15B', textureType: 'metal_brass', desc: '哑光拉丝纹，奢华复古' },
      { id: 'black_titanium', name: '哑光黑钛', color: '#25262A', textureType: 'metal_black', desc: '冷峻金属微光，现代极简' },
      { id: 'chrome_steel', name: '镜面镀铬钢', color: '#D8DEE4', textureType: 'metal_chrome', desc: '清冷镜面高光，包豪斯现代' },
      { id: 'fluted_glass', name: '长虹竖纹玻璃', color: '#D4E2E0', textureType: 'glass_fluted', desc: '竖条肌理，透光不透人' },
      { id: 'tea_glass', name: '琥珀茶色玻璃', color: '#825E3B', textureType: 'glass_tea', desc: '通透复古茶褐，暖光过滤' },
    ]
  }
];

export const INTERIOR_COLOR_PALETTES = [
  {
    id: 'earth_tone',
    name: '温暖大地色',
    hex: '#8C6D53',
    desc: '自然质朴，棕褐陶土暖意',
    tag: '大地色系'
  },
  {
    id: 'cream_apricot',
    name: '奶油米杏',
    hex: '#EAE3DC',
    desc: '温柔治愈，高明度微暖白调',
    tag: '奶油风'
  },
  {
    id: 'morandi_green',
    name: '莫兰迪灰绿',
    hex: '#6B8E8E',
    desc: '清冷松弛，低饱和植物自然感',
    tag: '莫兰迪'
  },
  {
    id: 'caramel_walnut',
    name: '焦糖黑胡桃',
    hex: '#5A3D28',
    desc: '深邃复古，中古大宅质感',
    tag: '中古复古'
  },
  {
    id: 'quiet_black',
    name: '静谧暗夜黑',
    hex: '#26292E',
    desc: '意式暗调，纯粹深邃轮廓',
    tag: '极简暗调'
  },
  {
    id: 'minimal_white',
    name: '极简米白',
    hex: '#ECE7DE',
    desc: '纯净透亮，现代极简基底',
    tag: '极简现代'
  },
  {
    id: 'terracotta_red',
    name: '复古陶土红',
    hex: '#A36855',
    desc: '法式复古，热情微醺点缀',
    tag: '法式复古'
  },
];

export const FINISH_OPTIONS = [
  { id: 'matte', name: '素雅全哑光', en: 'Matte', desc: '无高光反光，朴素内敛，侘寂极简首选' },
  { id: 'satin', name: '温润柔抛', en: 'Satin', desc: '微光漫反射，高级细腻触感，轻奢首选' },
  { id: 'semi_gloss', name: '半光漫射', en: 'Semi-Gloss', desc: '通透自然光感，日常实木与皮质质感' },
  { id: 'high_gloss', name: '镜面高光', en: 'High-Gloss', desc: '清澈倒影，钢琴烤漆、奢石与金属感' },
];

export const AGING_OPTIONS = [
  { id: 'brand_new', name: '全新无瑕', en: 'Brand New', desc: '出厂崭新平整，现代工整无痕' },
  { id: 'lived_in', name: '自然包浆', en: 'Lived-in', desc: '日常温润使用痕迹，居家温馨感' },
  { id: 'vintage', name: '复古做旧', en: 'Vintage', desc: '岁月氧化色差与微磨损，中古质感' },
  { id: 'weathered', name: '原始风化', en: 'Weathered', desc: '粗粝斑驳风化裂纹，自然雕琢' },
];

/**
 * 生成轻量且逼真的基础材质 SVG 纹理预览 Data URL
 */
export function generateMaterialPatternDataUrl(type, baseColor = '#C8B293') {
  let svgContent = '';

  if (type.includes('wood')) {
    svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
        <rect width="60" height="60" fill="${baseColor}" />
        <path d="M0,15 Q30,12 60,18 M0,32 Q30,36 60,30 M0,48 Q30,44 60,50" stroke="rgba(0,0,0,0.18)" stroke-width="1.8" fill="none" />
        <path d="M0,8 Q30,6 60,10 M0,24 Q30,28 60,22 M0,40 Q30,38 60,42" stroke="rgba(255,255,255,0.08)" stroke-width="1" fill="none" />
      </svg>
    `;
  } else if (type.includes('stone') || type.includes('travertine') || type.includes('cement')) {
    svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
        <rect width="60" height="60" fill="${baseColor}" />
        <circle cx="12" cy="18" r="3" fill="rgba(0,0,0,0.14)" />
        <circle cx="42" cy="14" r="2" fill="rgba(0,0,0,0.1)" />
        <circle cx="28" cy="38" r="4" fill="rgba(0,0,0,0.12)" />
        <circle cx="50" cy="46" r="2.5" fill="rgba(0,0,0,0.15)" />
        <circle cx="20" cy="52" r="1.5" fill="rgba(255,255,255,0.15)" />
        <ellipse cx="36" cy="26" rx="5" ry="2" fill="rgba(0,0,0,0.1)" />
      </svg>
    `;
  } else if (type.includes('fabric') || type.includes('boucle') || type.includes('linen')) {
    svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
        <rect width="40" height="40" fill="${baseColor}" />
        <circle cx="8" cy="8" r="3.5" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.5" />
        <circle cx="28" cy="8" r="3.5" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1.5" />
        <circle cx="18" cy="24" r="3.5" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" />
        <circle cx="36" cy="28" r="3.5" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="1.5" />
        <circle cx="8" cy="36" r="3" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1.2" />
      </svg>
    `;
  } else if (type.includes('metal')) {
    svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
        <rect width="60" height="60" fill="${baseColor}" />
        <line x1="0" y1="5" x2="60" y2="5" stroke="rgba(255,255,255,0.25)" stroke-width="0.8" />
        <line x1="0" y1="12" x2="60" y2="12" stroke="rgba(0,0,0,0.15)" stroke-width="0.8" />
        <line x1="0" y1="22" x2="60" y2="22" stroke="rgba(255,255,255,0.3)" stroke-width="1.2" />
        <line x1="0" y1="35" x2="60" y2="35" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
        <line x1="0" y1="48" x2="60" y2="48" stroke="rgba(255,255,255,0.2)" stroke-width="0.8" />
      </svg>
    `;
  } else {
    svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
        <rect width="40" height="40" fill="${baseColor}" />
      </svg>
    `;
  }

  const encoded = encodeURIComponent(svgContent.trim());
  return `data:image/svg+xml;utf8,${encoded}`;
}

/**
 * 智能聚合配方句生成函数
 */
export function buildBaseAttributesRecipe({
  tag = '@图1',
  regName = '区域1',
  colorTag = '蓝色线框',
  materialName = '',
  colorName = '',
  colorHex = '',
  finish = 'matte',
  roughness = 40,
  aging = 'brand_new',
  textureUrl = null,
  textureName = '',
  isCustomTargetStr = false,
}) {
  const parts = [];

  // 1. 材质与色彩主体
  const mat = materialName ? materialName.trim() : '';
  const col = colorName ? colorName.trim() : '';

  if (mat && col) {
    parts.push(`材质调整为${mat}，色彩调为${col}${colorHex && colorHex !== '#FFFFFF' ? `（${colorHex}）` : ''}`);
  } else if (mat) {
    parts.push(`材质调整为${mat}`);
  } else if (col) {
    parts.push(`色彩调整为${col}${colorHex && colorHex !== '#FFFFFF' ? `（${colorHex}）` : ''}`);
  } else {
    parts.push('进行表面材质与色彩质感重构');
  }

  // 2. 表面光泽度
  const finishObj = FINISH_OPTIONS.find((f) => f.id === finish);
  if (finishObj) {
    parts.push(`表面呈现${finishObj.name}`);
  }

  // 3. 肌理粗糙度 (0% ~ 100%)
  if (roughness <= 20) {
    parts.push('微距触感极平滑丝光细腻');
  } else if (roughness >= 65) {
    parts.push('呈现凹凸明显的粗粝立体颗粒与微孔纹理');
  } else if (roughness >= 45) {
    parts.push('微带自然细腻的原生肌理');
  }

  // 4. 做旧与年代感
  const agingObj = AGING_OPTIONS.find((a) => a.id === aging);
  if (agingObj && aging !== 'brand_new') {
    parts.push(`质感微带${agingObj.name}`);
  }

  let prompt = isCustomTargetStr ? `将 ${regName}（${colorTag}）${parts.join('，')}。` : `将 ${tag}[${regName}]（${colorTag}）${parts.join('，')}。`;

  // 5. 若挂载了材质实拍贴图
  if (textureUrl) {
    prompt += ` 参考所附材质实拍贴图${textureName ? `「${textureName}」` : ''}的微观纹理与质感走向。`;
  }

  return prompt;
}
