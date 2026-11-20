/**
 * 木纹属性词表 v1
 * 只记录源图本身的属性，不生成旋转/横竖变体。
 * 颜色以 CIELAB 为准，hex 仅用于展示与兜底。
 */

const WOOD_SPECIES = [
  { key: 'walnut', label: '胡桃木' },
  { key: 'white_oak', label: '白橡木' },
  { key: 'red_oak', label: '红橡木' },
  { key: 'ash', label: '白蜡木' },
  { key: 'cherry', label: '樱桃木' },
  { key: 'teak', label: '柚木' },
  { key: 'maple', label: '枫木' },
  { key: 'pine', label: '松木' },
  { key: 'rosewood', label: '玫瑰木' },
  { key: 'sapele', label: '沙比利' },
  { key: 'mahogany', label: '桃花心木' },
  { key: 'ebony', label: '黑檀' },
  { key: 'wenge', label: '鸡翅木' },
  { key: 'bamboo', label: '竹木' },
  { key: 'elm', label: '榆木' },
  { key: 'birch', label: '桦木' },
  { key: 'beech', label: '榉木' },
  { key: 'cedar', label: '杉木' },
  { key: 'olive', label: '橄榄木' },
  { key: 'okoume', label: '奥古曼' },
  { key: 'engineered', label: '工程木' },
  { key: 'mixed', label: '混拼木' }
];

const WOOD_TONES = [
  { key: 'light', label: '浅色' },
  { key: 'medium', label: '中色' },
  { key: 'dark', label: '深色' }
];

const GRAIN_TYPES = [
  { key: 'straight', label: '直纹' },
  { key: 'cathedral', label: '山纹' },
  { key: 'crossed', label: '交错纹' },
  { key: 'wavy', label: '波浪纹' },
  { key: 'ripple', label: '水波纹' },
  { key: 'burl', label: '瘤疤' },
  { key: 'birdseye', label: '鸟眼' },
  { key: 'knot', label: '结疤' },
  { key: 'distressed', label: '做旧' },
  { key: 'ribbon', label: '丝带状' }
];

const GRAIN_SCALES = [
  { key: 'fine', label: '细纹' },
  { key: 'medium', label: '中纹' },
  { key: 'coarse', label: '粗纹' }
];

const GRAIN_DIRECTIONS = [
  { key: 'horizontal', label: '横向' },
  { key: 'vertical', label: '纵向' },
  { key: 'diagonal', label: '斜向' },
  { key: 'mixed', label: '混合方向' }
];

const WOOD_LAYOUTS = [
  { key: 'plain', label: '平板' },
  { key: 'wide_plank', label: '宽板' },
  { key: 'narrow_plank', label: '窄板' },
  { key: 'herringbone', label: '人字拼' },
  { key: 'chevron', label: '鱼骨拼' },
  { key: 'parquet', label: '拼花' },
  { key: 'block', label: '方块拼' }
];

const SURFACE_FINISHES = [
  { key: 'matte', label: '哑光' },
  { key: 'satin', label: '缎面' },
  { key: 'semi_gloss', label: '半亮' },
  { key: 'gloss', label: '亮光' },
  { key: 'textured', label: '肌理' },
  { key: 'wire_brushed', label: '拉丝' },
  { key: 'oiled', label: '木蜡油' },
  { key: 'distressed', label: '做旧' }
];

function labelMap(list) {
  return Object.fromEntries(list.map((row) => [row.key, row.label]));
}

const WOOD_SPECIES_LABELS = labelMap(WOOD_SPECIES);
const WOOD_TONE_LABELS = labelMap(WOOD_TONES);
const GRAIN_TYPE_LABELS = labelMap(GRAIN_TYPES);
const GRAIN_SCALE_LABELS = labelMap(GRAIN_SCALES);
const GRAIN_DIRECTION_LABELS = labelMap(GRAIN_DIRECTIONS);
const WOOD_LAYOUT_LABELS = labelMap(WOOD_LAYOUTS);
const SURFACE_FINISH_LABELS = labelMap(SURFACE_FINISHES);

const SPECIES_ALIASES = [
  ['walnut', /胡桃|walnut/i],
  ['red_oak', /红橡|red\s*oak/i],
  ['white_oak', /白橡|white\s*oak|silver\s*oak|grey\s*oak|gray\s*oak|washed\s*grey\s*oak/i],
  ['white_oak', /橡|oak/i],
  ['ash', /水曲柳|白蜡|ash\b/i],
  ['cherry', /樱桃|cherry/i],
  ['teak', /柚木|teak/i],
  ['maple', /枫|maple/i],
  ['pine', /松木|松|pine/i],
  ['rosewood', /玫瑰木|rosewood/i],
  ['sapele', /沙比利|sapele/i],
  ['mahogany', /桃花心|mahogany/i],
  ['ebony', /黑檀|ebony|flamed\s*black/i],
  ['wenge', /鸡翅|wenge/i],
  ['bamboo', /竹|bamboo/i],
  ['elm', /榆|elm/i],
  ['birch', /桦|birch/i],
  ['beech', /榉|beech/i],
  ['cedar', /杉|cedar/i],
  ['olive', /橄榄|olive/i],
  ['okoume', /奥古曼|okoume/i],
  ['engineered', /工程木|engineered|laminate|plywood|osb|人造板|金缕|石语|石逸/i],
  ['mixed', /混拼|mixed/i]
];

const GRAIN_ALIASES = [
  ['cathedral', /山纹|cathedral/i],
  ['crossed', /交错|cross(ed)?\s*grain/i],
  ['wavy', /波浪|wavy/i],
  ['ripple', /水波|ripple|curly/i],
  ['burl', /瘤疤|瘤|burl/i],
  ['birdseye', /鸟眼|birdseye|bird's\s*eye/i],
  ['knot', /结疤|节疤|knot/i],
  ['distressed', /做旧|distressed|weathered|aged|worn/i],
  ['ribbon', /丝带|ribbon|fiddleback/i],
  ['straight', /直纹|straight|fine\s*grain/i]
];

const LAYOUT_ALIASES = [
  ['herringbone', /人字|herringbone/i],
  ['chevron', /鱼骨|chevron/i],
  ['parquet', /拼花|parquet/i],
  ['wide_plank', /宽板|wide\s*plank/i],
  ['narrow_plank', /窄板|narrow\s*plank/i],
  ['block', /方块|block/i],
  ['plain', /平板|veneer|饰面|plain|flat/i]
];

const FINISH_ALIASES = [
  ['gloss', /亮光|高光|gloss|polished|reflective/i],
  ['semi_gloss', /半亮|半哑|semi[-\s]*gloss/i],
  ['satin', /缎面|satin/i],
  ['oiled', /木蜡油|oiled/i],
  ['wire_brushed', /拉丝|wire\s*brushed/i],
  ['distressed', /做旧|distressed|weathered/i],
  ['textured', /肌理|凹凸|rough|textured/i],
  ['matte', /哑光|matte|matt/i]
];

function firstMatch(aliases, text) {
  for (const [key, re] of aliases) {
    if (re.test(text)) return key;
  }
  return '';
}

function inferSpecies(text) {
  const key = firstMatch(SPECIES_ALIASES, String(text || ''));
  return { key: key || 'mixed', confidence: key ? 0.78 : 0.5 };
}

function inferGrainType(text) {
  const key = firstMatch(GRAIN_ALIASES, String(text || ''));
  return { key: key || 'straight', confidence: key ? 0.76 : 0.55 };
}

function inferGrainScale(text) {
  const s = String(text || '');
  if (/细纹|fine|smooth|clean/i.test(s)) return { key: 'fine', confidence: 0.78 };
  if (/粗纹|coarse|rough|heavy\s*grain/i.test(s)) return { key: 'coarse', confidence: 0.78 };
  return { key: 'medium', confidence: 0.55 };
}

function inferDirection(text, layout) {
  if (layout === 'herringbone' || layout === 'chevron' || layout === 'parquet' || layout === 'block') {
    return { key: 'mixed', confidence: 0.9 };
  }
  if (/纵向|竖纹|vertical/i.test(String(text || ''))) return { key: 'vertical', confidence: 0.8 };
  if (/斜向|斜纹|diagonal/i.test(String(text || ''))) return { key: 'diagonal', confidence: 0.8 };
  if (/横向|横纹|horizontal/i.test(String(text || ''))) return { key: 'horizontal', confidence: 0.8 };
  return { key: 'horizontal', confidence: 0.58 };
}

function inferLayout(text) {
  const key = firstMatch(LAYOUT_ALIASES, String(text || ''));
  return { key: key || 'plain', confidence: key ? 0.8 : 0.55 };
}

function inferFinish(text, gloss) {
  const g = String(gloss || '').toLowerCase();
  if (g === 'gloss') return { key: 'gloss', confidence: 0.9 };
  if (g === 'satin') return { key: 'satin', confidence: 0.85 };
  if (g === 'matte') return { key: 'matte', confidence: 0.9 };
  const key = firstMatch(FINISH_ALIASES, String(text || ''));
  return { key: key || 'matte', confidence: key ? 0.76 : 0.55 };
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const to = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function srgbToLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000;
  const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return {
    l: Math.round((116 * fy - 16) * 10) / 10,
    a: Math.round((500 * (fx - fy)) * 10) / 10,
    b: Math.round((200 * (fy - fz)) * 10) / 10
  };
}

function hexToLab(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToLab(rgb.r, rgb.g, rgb.b) : null;
}

function classifyTone(lab) {
  if (!lab || !Number.isFinite(Number(lab.l))) return 'medium';
  const l = Number(lab.l);
  if (l >= 65) return 'light';
  if (l < 35) return 'dark';
  return 'medium';
}

function normalizeWoodFields(input = {}) {
  const text = [input.name_zh, input.name_en, input.prompt_name, input.brand_series, input.tags]
    .filter(Boolean)
    .join(' ');
  const speciesInferred = inferSpecies(text);
  const layoutInferred = inferLayout(text);
  const grainInferred = inferGrainType(text);
  const scaleInferred = inferGrainScale(text);
  const directionInferred = inferDirection(text, input.wood_layout || layoutInferred.key);
  const finishInferred = inferFinish(text, input.gloss);

  const lab = input.lab && Number.isFinite(Number(input.lab.l))
    ? input.lab
    : hexToLab(input.hex);

  return {
    wood_species: input.wood_species || speciesInferred.key,
    wood_species_source: input.wood_species_source || (speciesInferred.confidence >= 0.7 ? 'inferred' : 'inferred'),
    wood_tone: input.wood_tone || classifyTone(lab),
    grain_type: input.grain_type || grainInferred.key,
    grain_scale: input.grain_scale || scaleInferred.key,
    grain_direction: input.grain_direction || directionInferred.key,
    wood_layout: input.wood_layout || layoutInferred.key,
    surface_finish: input.surface_finish || finishInferred.key,
    lab_l: lab ? Number(lab.l) : null,
    lab_a: lab ? Number(lab.a) : null,
    lab_b: lab ? Number(lab.b) : null
  };
}

module.exports = {
  WOOD_SPECIES,
  WOOD_TONES,
  GRAIN_TYPES,
  GRAIN_SCALES,
  GRAIN_DIRECTIONS,
  WOOD_LAYOUTS,
  SURFACE_FINISHES,
  WOOD_SPECIES_LABELS,
  WOOD_TONE_LABELS,
  GRAIN_TYPE_LABELS,
  GRAIN_SCALE_LABELS,
  GRAIN_DIRECTION_LABELS,
  WOOD_LAYOUT_LABELS,
  SURFACE_FINISH_LABELS,
  hexToRgb,
  rgbToHex,
  rgbToLab,
  hexToLab,
  classifyTone,
  inferSpecies,
  inferGrainType,
  inferGrainScale,
  inferDirection,
  inferLayout,
  inferFinish,
  normalizeWoodFields
};
