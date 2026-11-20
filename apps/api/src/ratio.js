/**
 * 画幅真值分桶、分辨率预设、生成图原样落盘。
 * 9:16 / 3:4 只在与真值误差 ≤ 2% 时作为标签。
 * 画幅重构 (restage_dual / restage_9_16) 严禁调用 composeRatioCanvas 高斯模糊垫边，
 * 出图后直接复制原始字节落盘，禁止旋转重编码、禁止缩放、禁止裁切、禁止把原图叠回中心。
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MATCH_TOL = 0.02;
const CALIBRATE_TOL = 0.01;

/** height / width 目标比 */
const RATIO_HW = {
  '9:16': 16 / 9,
  '3:4': 4 / 3,
  '2:3': 3 / 2,
  '1:1': 1,
  '4:3': 3 / 4,
  '3:2': 2 / 3,
  '16:9': 9 / 16,
  '21:9': 9 / 21
};

const RATIO_ORDER = ['9:16', '3:4', '2:3', '1:1', '4:3', '3:2', '16:9', '21:9'];

/** 短边优先、保持目标比的像素档 */
const SIZE_PRESETS = {
  '720p': {
    '9:16': [720, 1280],
    '3:4': [720, 960],
    '2:3': [720, 1080],
    '1:1': [720, 720],
    '4:3': [960, 720],
    '16:9': [1280, 720]
  },
  '1080p': {
    '9:16': [1080, 1920],
    '3:4': [1080, 1440],
    '2:3': [1080, 1620],
    '1:1': [1080, 1080],
    '4:3': [1440, 1080],
    '16:9': [1920, 1080]
  },
  '2K': {
    '9:16': [1440, 2560],
    '3:4': [1536, 2048],
    '2:3': [1440, 2160],
    '1:1': [1440, 1440],
    '4:3': [2048, 1536],
    '16:9': [2560, 1440]
  },
  '4K': {
    '9:16': [2160, 3840],
    '3:4': [2160, 2880],
    '2:3': [2160, 3240],
    '1:1': [2160, 2160],
    '4:3': [2880, 2160],
    '16:9': [3840, 2160]
  }
};

const AGNES_SIZE = { '720p': '1K', '1080p': '2K', '2K': '3K', '4K': '4K' };

const PHONE_DISPLAY = [
  [9, 19.5, 19.5 / 9],
  [9, 20, 20 / 9],
  [9, 21, 21 / 9],
  [9, 18, 2],
  [10, 21, 2.1]
];

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

function simplifyRatioLabel(width, height) {
  const hw = height / width;
  for (const [a, b, t] of PHONE_DISPLAY) {
    if (Math.abs(hw - t) <= 0.03) return `${a}:${b}`;
  }
  const g = gcd(width, height);
  return `${Math.round(width / g)}:${Math.round(height / g)}`;
}

function classifyOrientation(width, height) {
  if (!width || !height) {
    return { bucket: 'landscape', display: '未知', ratio: null, exact: false };
  }
  const hw = height / width;
  for (const dir of RATIO_ORDER) {
    if (Math.abs(hw - RATIO_HW[dir]) <= MATCH_TOL) {
      return { bucket: dir, display: dir, ratio: hw, exact: true };
    }
  }
  if (Math.abs(hw - 1) <= 0.05) {
    return { bucket: 'square', display: simplifyRatioLabel(width, height), ratio: hw, exact: false };
  }
  if (hw < 0.95) {
    return { bucket: 'landscape', display: simplifyRatioLabel(width, height), ratio: hw, exact: false };
  }
  return { bucket: 'portrait', display: simplifyRatioLabel(width, height), ratio: hw, exact: false };
}

function calculateOriginOrientation(width, height) {
  return classifyOrientation(width, height).bucket;
}

function pixelSizeFor(ratioKey, sizePreset = '1080p') {
  const table = SIZE_PRESETS[sizePreset] || SIZE_PRESETS['1080p'];
  const pair = table[ratioKey] || table['9:16'];
  return { width: pair[0], height: pair[1] };
}

function agnesSizeForPreset(sizePreset) {
  return AGNES_SIZE[sizePreset] || '2K';
}

function kindForRatio(ratioKey) {
  return `restage_${String(ratioKey).replace(':', '_')}`;
}

function isStandardRatio(width, height, originOrientation) {
  if (originOrientation === '9:16' || originOrientation === '3:4') return true;
  const c = classifyOrientation(width, height);
  return c.bucket === '9:16' || c.bucket === '3:4';
}

const RESTAGE_NEGATIVE_TOKENS = [
  '黑边', '白边', 'letterbox', 'pillarbox', '模糊条带', '字幕条', '纯色衬底',
  '文字', '文字水印', '标识', 'logo', '水印', '签名',
  '拉伸', '挤压', '畸变', '拼接痕迹', '低质量', '模糊',
];

const RESTAGE_BAR_CONSTRAINT =
  '延展区域必须是真实墙面、天花、地面或家具的自然延续，不得出现非场景填充。';

const RESTAGE_DEFAULTS = {
  useNegativeTokens: true,
  useBarConstraintInPrompt: true,
  negativeTokens: RESTAGE_NEGATIVE_TOKENS,
  barConstraintText: RESTAGE_BAR_CONSTRAINT,
};

function restageParams(overrides = {}) {
  return { ...RESTAGE_DEFAULTS, ...(overrides || {}) };
}

/** 构造负面提示词文本（进 negativePrompt 字段） */
function restageNegativePrompt(overrides = {}) {
  const p = restageParams(overrides);
  const extra = String(p.extraNegative || '').trim();
  const base = Array.isArray(p.negativeTokens) && p.negativeTokens.length
    ? p.negativeTokens.join(', ')
    : RESTAGE_NEGATIVE_TOKENS.join(', ');
  return extra ? `${base}, ${extra}` : base;
}

function restagePromptForRatio(ratio, template, category = 'interior', paramOverrides = {}) {
  const P = restageParams(paramOverrides);
  const bar = P.useBarConstraintInPrompt ? P.barConstraintText : '';
  if (category === 'furniture') {
    const furnitureBase = template || '高端家具产品静物摄影大片，单品居中，严格保持原有造型结构与材质肌理比例，极简纯净背景向外自然延展，高保真画质。';
    const furnitureExtra = {
      '3:4': `目标画幅 3:4 竖幅。单品主体完整居中呈现，四周极简纯净背景微调延伸，严禁篡改家具本身的造型、结构与材质比例，彻底清除边缘任何杂乱印记与文字。${bar}`,
      '9:16': `目标画幅 9:16 竖屏。单品主体完整居中，上下留出适度呼吸空间，极简纯净背景自然延伸，严禁拉伸挤压单品，边缘纯净无覆层。${bar}`
    };
    return furnitureExtra[ratio] ? `${furnitureBase} ${furnitureExtra[ratio]}` : `${furnitureBase} 目标画幅 ${ratio}。纯净画面，严禁拉伸挤压。${bar}`;
  }

  const base = template || '室内设计与建筑空间摄影大片，极其纯净通透的画面质感，高保真材质肌理，商业画册级洁净镜头，沿用参考图整体色调与光影质感，远景镜头，完整保留原有硬装结构与空间透视，彻底消除边缘杂质并以周围天然材质无痕修补。';
  const extra = {
    '3:4': `目标画幅 3:4 竖幅。保持参考图空间结构、家具比例与透视不变，自然补全墙面与家具，不要上下裁切天花和地面，严禁拉伸或挤压家具比例与透视，四角边缘纯净无覆层。${bar}`,
    '9:16': `目标画幅 9:16 竖屏。展示完整室内纵深与空间开阔感，主体不被裁切，严禁横向拉伸，上下延展天花与地面时保持真实透视，不要把顶部或底部拉变形。${bar}`
  };
  return extra[ratio] ? `${base} ${extra[ratio]}` : `${base} 目标画幅 ${ratio}。纯净无杂质，严禁拉伸挤压。${bar}`;
}

/**
 * 历史兼容保留函数（注：restage_dual / restage_9_16 重构路径已严禁调用此函数，绝不再使用高斯模糊垫边）
 */
async function composeRatioCanvas(srcPath, destPath, ratioKey, sizePreset = '1080p') {
  const target = pixelSizeFor(ratioKey, sizePreset);
  const want = RATIO_HW[ratioKey] || RATIO_HW['9:16'];
  const meta = await sharp(srcPath, { failOn: 'none' }).rotate().metadata();
  const actual = (meta.height || 1) / (meta.width || 1);
  const mismatch = Math.abs(actual - want) / want;
  const needsCalibrate = mismatch > CALIBRATE_TOL
    || meta.width !== target.width
    || meta.height !== target.height;
  const strategy = mismatch > 0.05 ? 'contain_pad' : 'cover';

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  if (strategy === 'contain_pad') {
    const bg = await sharp(srcPath, { failOn: 'none' })
      .rotate()
      .resize(target.width, target.height, { fit: 'cover', position: 'centre' })
      .blur(28)
      .toBuffer();
    const fg = await sharp(srcPath, { failOn: 'none' })
      .rotate()
      .resize(target.width, target.height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false
      })
      .ensureAlpha()
      .png()
      .toBuffer();
    await sharp(bg)
      .composite([{ input: fg, gravity: 'centre' }])
      .jpeg({ quality: 90 })
      .toFile(destPath);
  } else {
    await sharp(srcPath, { failOn: 'none' })
      .rotate()
      .resize(target.width, target.height, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 90 })
      .toFile(destPath);
  }

  const out = await sharp(destPath).metadata();
  return {
    width: out.width,
    height: out.height,
    calibrated: needsCalibrate,
    destPath,
    targetRatio: ratioKey,
    sizePreset,
    strategy
  };
}

/**
 * 净画重构产物原样保存：
 * 严格遵循「出图后只复制字节，不旋转重编码、不缩放、不裁切、不把原图盖回中心」规则！
 */
async function calibrateGeneratedImage(srcPath, destPath, ratioKey, sizePreset = '1080p') {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (path.resolve(srcPath) !== path.resolve(destPath)) {
    fs.copyFileSync(srcPath, destPath);
  }
  let out = { width: null, height: null };
  try {
    out = await sharp(destPath, { failOn: 'none' }).metadata();
  } catch (_) {}
  return {
    width: out.width || null,
    height: out.height || null,
    calibrated: false,
    destPath,
    targetRatio: ratioKey,
    sizePreset,
    strategy: 'raw_byte_copy'
  };
}

function orientationLabelMap() {
  return {
    '9:16': '9:16 竖图',
    '3:4': '3:4 竖图',
    '2:3': '2:3 竖图',
    '1:1': '1:1 方图',
    portrait: '竖图（非标准）',
    landscape: '横图',
    square: '方图',
    '16:9': '16:9 横图',
    '4:3': '4:3 横图'
  };
}

/**
 * 智能感知与自适应：根据自然宽高与候选列表，自动推导最匹配的标准画幅 ratio 与分辨率 size 档位。
 * 杜绝竖屏 9:16 底图被 16:9 / 1:1 强行压扁变形。
 */
function detectOptimalRatioAndSize(width, height, supportedRatios = null) {
  if (!width || !height) {
    return { ratio: '1:1', size: '2K', videoResolution: '1080p', orientation: 'square', exact: false, hw: 1 };
  }
  const hw = height / width;
  const c = classifyOrientation(width, height);
  let bestRatio = c.bucket;
  if (!RATIO_ORDER.includes(bestRatio)) {
    if (hw > 1.45) bestRatio = '9:16';
    else if (hw > 1.25) bestRatio = '3:4';
    else if (hw > 1.1) bestRatio = '2:3';
    else if (hw >= 0.9 && hw <= 1.1) bestRatio = '1:1';
    else if (hw < 0.52) bestRatio = '21:9';
    else if (hw < 0.65) bestRatio = '16:9';
    else if (hw < 0.72) bestRatio = '3:2';
    else if (hw < 0.88) bestRatio = '4:3';
    else bestRatio = '1:1';
  }
  if (Array.isArray(supportedRatios) && supportedRatios.length > 0) {
    if (!supportedRatios.includes(bestRatio)) {
      let minDiff = Infinity;
      let closest = supportedRatios[0];
      for (const r of supportedRatios) {
        const targetHw = RATIO_HW[r] != null ? RATIO_HW[r] : (r === 'adaptive' ? hw : 1);
        const diff = Math.abs(hw - targetHw);
        if (diff < minDiff) {
          minDiff = diff;
          closest = r;
        }
      }
      bestRatio = closest;
    }
  }

  const maxDim = Math.max(width, height);
  let size = '2K';
  if (maxDim >= 3000) size = '4K';
  else if (maxDim >= 1800) size = '2K';
  else if (maxDim >= 1200) size = '1.5K';
  else size = '1K';

  let videoRes = '1080p';
  if (maxDim >= 1800) videoRes = '1080p';
  else if (maxDim < 900) videoRes = '720p';

  return {
    ratio: bestRatio,
    size,
    videoResolution: videoRes,
    orientation: c.bucket,
    exact: c.exact,
    hw
  };
}

module.exports = {
  MATCH_TOL,
  CALIBRATE_TOL,
  RATIO_HW,
  RATIO_ORDER,
  SIZE_PRESETS,
  classifyOrientation,
  calculateOriginOrientation,
  pixelSizeFor,
  agnesSizeForPreset,
  kindForRatio,
  isStandardRatio,
  composeRatioCanvas,
  calibrateGeneratedImage,
  restagePromptForRatio,
  restageNegativePrompt,
  restageParams,
  RESTAGE_NEGATIVE_TOKENS,
  RESTAGE_BAR_CONSTRAINT,
  simplifyRatioLabel,
  orientationLabelMap,
  detectOptimalRatioAndSize
};
