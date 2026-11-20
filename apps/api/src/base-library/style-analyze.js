/**
 * AI 风格分析：参考图/文字 -> 精细风格草稿 + 两套建议方案。
 * 只产草稿，必须由人工确认后才入库。
 */

const PARENT_STYLE_KEYS = [
  'wabi_sabi', 'song_aesthetic', 'neo_chinese', 'classical_chinese',
  'french', 'italian', 'mediterranean', 'tuscan',
  'modern_minimal', 'cream_style', 'mid_century', 'industrial',
  'american_modern', 'american_country', 'nanyang_resort',
  'natural_wood', 'dark_wood', 'natural_vintage_wood', 'dark_vintage_wood', 'other'
];

const ANALYZE_PROMPT = [
  '你在根据室内参考图分析一个可用于“换材质”的精细装修风格。筛选用的粗分类已经合并了很多名字，这里要给更具体的风格名。',
  `parent_style_key 只能从这些 dir 里选：${PARENT_STYLE_KEYS.join('、')}。`,
  '只看画面中已经存在的材质与配色，不要虚构不存在的家具或结构。',
  '输出严格 JSON，不要解释：',
  '{"style":{"name_zh":"例如 意式极简","parent_style_key":"italian","description":"一句话说明","palette":[{"hex":"#RRGGBB","role":"wall|ceiling|wood|floor|metal|soft|accent"}],"tags":[]},',
  '"schemes":[{"name_zh":"方案A名称","slots":[{"space_key":"any|living|bedroom|dining|study","surface":"wall|ceiling|floor|millwork|metal|soft|counter","role":"base|accent|sofa|curtain|rug|bed|chair|any","kind_key":"latex|wood|tile|stone|fabric|leather|metal_finish|wallpaper|wallcloth|microcement","name_zh":"","hex":"#RRGGBB或空","brand":"","external_sku":""}]}]}',
  '必须给出 2 套方案；每套至少包含 wall、ceiling、floor、millwork、metal 五个槽位，living 空间再给 sofa/curtain/rug。软装按空间填，拿不准用空字符串。'
].join('');

function safeParse(text) {
  if (!text) return null;
  const raw = String(text).replace(/^[^\{]*/, '').replace(/[^\}]*$/, '');
  try {
    const obj = JSON.parse(raw);
    if (!obj || !obj.style || !Array.isArray(obj.schemes)) return null;
    return obj;
  } catch (_) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      return obj && obj.style && Array.isArray(obj.schemes) ? obj : null;
    } catch (_) {
      return null;
    }
  }
}

async function analyzeStyle(services, imageBase64) {
  const genGov = require('../gen-governance');
  const { chatVision } = require('../vlm');
  const ep = typeof genGov.resolveVlmEndpoint === 'function'
    ? genGov.resolveVlmEndpoint(services.db, services.config, 'workflow_vision')
    : null;
  const info = await chatVision({
    baseUrl: ep && ep.baseUrl,
    apiKey: ep && ep.apiKey,
    model: (ep && ep.modelCode) || 'workflow_vision',
    prompt: ANALYZE_PROMPT,
    images: imageBase64 ? [String(imageBase64).replace(/^data:[^;]+;base64,/, '')] : []
  });
  const draft = safeParse(info.text || info.content || '');
  if (!draft) throw new Error('AI 没有返回可识别的风格 JSON');
  draft.style.source = 'ai';
  return draft;
}

module.exports = { PARENT_STYLE_KEYS, analyzeStyle };
