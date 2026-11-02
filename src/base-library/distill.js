/**
 * 照片提炼只产出草稿。确认入库走 catalog/distill。
 * 材质必须带色值。做法和选品只保留名称。
 */

const { SURFACES } = require('./items');

const MATERIAL_KEYS = new Set(['latex', 'microcement', 'wallpaper', 'wallcloth', 'tile', 'wood', 'stone', 'fabric', 'leather', 'metal_finish']);
const DESIGN_KEYS = new Set(['ceiling_design', 'wall_design', 'door_design']);
const PRODUCT_KEYS = new Set(['furniture', 'light', 'fixture', 'soft_goods', 'carpet']);

const SERIES = [
  { library: 'material', kind_key: 'latex', label: '乳胶漆' },
  { library: 'material', kind_key: 'microcement', label: '微水泥' },
  { library: 'material', kind_key: 'wallpaper', label: '墙纸' },
  { library: 'material', kind_key: 'wallcloth', label: '墙布' },
  { library: 'material', kind_key: 'fabric', label: '织物' },
  { library: 'material', kind_key: 'leather', label: '皮革' },
  { library: 'material', kind_key: 'metal_finish', label: '金属饰面' },
  { library: 'material', kind_key: 'tile', label: '瓷砖' },
  { library: 'material', kind_key: 'wood', label: '木作' },
  { library: 'material', kind_key: 'stone', label: '石材' },
  { library: 'design', kind_key: 'ceiling_design', label: '天花' },
  { library: 'design', kind_key: 'wall_design', label: '墙面' },
  { library: 'design', kind_key: 'door_design', label: '门板' },
  { library: 'product', kind_key: 'furniture', label: '家具' },
  { library: 'product', kind_key: 'light', label: '灯具' },
  { library: 'product', kind_key: 'fixture', label: '洁具五金' },
  { library: 'product', kind_key: 'soft_goods', label: '软装' },
  { library: 'product', kind_key: 'carpet', label: '地毯' }
];

const DISTILL_PROMPT = [
  '看这张室内照片或选区，只列出能认出来的装修条目。',
  '每条必须先判断它属于哪个库、哪个系列。',
  '材质库 series_zh：乳胶漆、微水泥、墙纸、墙布、瓷砖、木作、石材、织物、皮革、金属饰面。',
  '做法库 series_zh：天花、墙面、门板。',
  '选品库 series_zh：家具、灯具、洁具五金、软装、地毯。',
  'kind_key 与系列对应：latex 乳胶漆、microcement 微水泥、wallpaper 墙纸、wallcloth 墙布、tile 瓷砖、wood 木作、stone 石材、fabric 织物、leather 皮革、metal_finish 金属饰面、ceiling_design 天花、wall_design 墙面、door_design 门板、furniture 家具、light 灯具、fixture 洁具五金、soft_goods 软装、carpet 地毯。',
  'library 只能是 material、design、product，并且和系列一致。',
  '材质尽量给 #RRGGBB 主色；做法和选品不要编色值。',
  'brand 只在画面上写明品牌时填写，否则空字符串。',
  'mount 只能是 ceiling、wall、floor、millwork、counter、furniture、soft、metal 之一。',
  '只返回 JSON：{"items":[{"library":"material","series_zh":"乳胶漆","kind_key":"latex","name_zh":"","brand":"","hex":"#RRGGBB","mount":"wall"}]}',
  '认不出就返回 {"items":[]}。不要解释，不要发明系列名。'
].join('');

function seriesOf(raw) {
  const kindKey = String(raw && raw.kind_key || '').trim();
  const byKey = SERIES.find((row) => row.kind_key === kindKey);
  if (byKey) return byKey;
  const label = String(raw && (raw.series_zh || raw.series) || '').trim();
  return SERIES.find((row) => row.label === label) || null;
}

function normalizeDraftItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const series = seriesOf(raw);
  if (!series) return null;
  const kindKey = series.kind_key;
  const bucket = series.library;
  const name = String(raw.name_zh || '').trim();
  if (!name) return null;
  let hex = String(raw.hex || '').trim();
  if (hex && !hex.startsWith('#')) hex = `#${hex}`;
  if (bucket === 'material') {
    const requireHex = kindKey === 'latex' || kindKey === 'microcement';
    const validHex = /^#[0-9a-fA-F]{6}$/.test(hex);
    if (requireHex && !validHex) return null;
    if (!validHex) hex = '';
  } else {
    hex = '';
  }
  const mount = SURFACES.includes(raw.mount) ? raw.mount : '';
  const brand = String(raw.brand || '').trim().slice(0, 40);
  return {
    bucket,
    library: bucket,
    series_zh: series.label,
    kind: bucket === 'material' ? (kindKey === 'latex' ? 'color' : 'texture') : bucket,
    kind_key: kindKey,
    name_zh: name,
    brand,
    hex,
    mount
  };
}

function draftsFromVision(payload) {
  const list = Array.isArray(payload)
    ? payload
    : (payload && (payload.items || payload.swatches)) || [];
  return list.map(normalizeDraftItem).filter(Boolean);
}

async function distillImage(services, imageBase64) {
  const genGov = require('../gen-governance');
  const { chatVision } = require('../vlm');
  const ep = typeof genGov.resolveVlmEndpoint === 'function'
    ? genGov.resolveVlmEndpoint(services.db, services.config, 'workflow_vision')
    : null;
  const info = await chatVision({
    baseUrl: ep && ep.baseUrl,
    apiKey: ep && ep.apiKey,
    model: (ep && ep.modelCode) || 'workflow_vision',
    prompt: DISTILL_PROMPT,
    images: [String(imageBase64 || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')]
  });
  return draftsFromVision(info);
}

module.exports = {
  MATERIAL_KEYS,
  DESIGN_KEYS,
  PRODUCT_KEYS,
  SERIES,
  normalizeDraftItem,
  draftsFromVision,
  distillImage
};
