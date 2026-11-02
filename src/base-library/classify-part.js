/**
 * 部位识别与材质族封闭枚举分类器
 * 优先调用治理台 VLM 封闭 JSON，若失败或未配置则在开启 base_library_jev 时降级回退至 JEV。
 */

const { getFlag } = require('./list');
const {
  VALID_PARTS,
  VALID_MATERIAL_FAMILIES,
  PART_POLICIES,
  PART_TO_SURFACE
} = require('./part-policy');
const { classifyRegionSurface } = require('./classify');

const CLASSIFY_PART_PROMPT = `你是一名室内设计与空间图像分析专家。分析附带的室内局部区域图像裁切，判断它属于哪个室内空间装修部位以及它的原有材质族。
严格输出如下 JSON 格式，不要包含任何额外说明或 markdown 标记：
{
  "part": "8个部位之一或null",
  "material_family": "9个材质族之一",
  "probability": 0.85
}

部位枚举必须且只能是以下 8 项之一（若为灯具、洁具或无法明确对应则输出 null）：
- ceiling (顶面天花、吊顶、石膏线)
- wall (墙面、护墙板、壁纸壁布)
- floor (地面、地砖、木地板、自流平)
- millwork (定制柜体、橱柜、衣柜门板、定制台面)
- upholstery (软体家具：沙发、软包床头、餐椅软包坐面、抱枕)
- hard_furniture (硬质家具与五金：餐桌、茶几、金属置物架、椅架)
- curtain_bedding (窗帘、窗纱、床品四件套)
- rug (地毯、地垫)

材质族枚举必须且只能是以下 9 项之一：
- paint (乳胶漆、滚涂平涂)
- art_coat (微水泥、天鹅绒漆、石灰漆等艺术涂料)
- wood (天然木材、木皮、木地板、实木)
- stone (大理石、岩板、花岗岩、水磨石)
- leather (真皮、仿皮、油蜡皮、马鞍皮)
- fabric (棉麻、丝绒、羊羔绒、布艺)
- metal (不锈钢、黄铜、铝合金、电镀金属)
- glass (透明玻璃、长虹玻璃、镜面)
- unknown (无法辨识或混合)

probability 为 0.0 到 1.0 的置信度数值。若判断概率低于 0.75，输出实际概率数值。`;

function parsePartJsonResponse(raw) {
  if (!raw) return null;
  let parsed = null;
  if (typeof raw === 'object' && raw !== null && (raw.part !== undefined || raw.material_family !== undefined)) {
    parsed = raw;
  } else if (typeof raw === 'string') {
    try {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch (_) {}
      }
    }
  }
  return parsed;
}

/**
 * 局部选区 8 部位识别
 * @param {object} db SQLite 数据库连接
 * @param {Buffer} cropJpegBuffer 选区图像 Buffer
 * @param {object} options 注入配置或上下文
 */
async function classifyRegionPart(db, cropJpegBuffer, options = {}) {
  let part = null;
  let material_family = 'unknown';
  let probability = 0;
  let uncertain = true;
  let modelUsed = 'vlm';
  let alternatives = [];

  // 1. 尝试优先使用 VLM 封闭 JSON
  const customChatVision = options.chatVision;
  const customFetch = options.fetch;
  let vlmSuccess = false;

  try {
    let resp = null;
    if (typeof customChatVision === 'function') {
      resp = await customChatVision({
        prompt: CLASSIFY_PART_PROMPT,
        images: [cropJpegBuffer],
        fetch: customFetch
      });
    } else {
      const { chatVision } = require('../vlm');
      const genGov = require('../gen-governance');
      const ep = typeof genGov.resolveVlmEndpoint === 'function'
        ? genGov.resolveVlmEndpoint(db, options.config || {}, options.model)
        : null;

      if (ep && (ep.baseUrl || ep.apiKey)) {
        resp = await chatVision({
          baseUrl: ep.baseUrl,
          apiKey: ep.apiKey,
          model: ep.modelCode || options.model || 'gemini-2.5-flash',
          prompt: CLASSIFY_PART_PROMPT,
          images: [cropJpegBuffer],
          timeoutMs: options.timeoutMs || 15000,
          fetch: customFetch
        });
      }
    }

    const parsed = parsePartJsonResponse(resp);
    if (parsed) {
      const prob = typeof parsed.probability === 'number' ? parsed.probability : parseFloat(parsed.probability) || 0;
      const validPart = VALID_PARTS.includes(parsed.part) ? parsed.part : null;
      const validFamily = VALID_MATERIAL_FAMILIES.includes(parsed.material_family) ? parsed.material_family : 'unknown';

      if (validPart && prob >= 0.75) {
        part = validPart;
        material_family = validFamily;
        probability = prob;
        uncertain = false;
        vlmSuccess = true;
      } else {
        probability = prob;
        uncertain = true;
        material_family = validFamily;
        vlmSuccess = true; // 判定有效返回，只是置信度不达标或为 null
      }
    }
  } catch (vlmErr) {
    // VLM 调用失败，准备进入 JEV 迁移回退
  }

  // 2. JEV 回退 (仅当 VLM 未能给出置信结果且 flag 开启时)
  if (uncertain && !vlmSuccess) {
    const flagJev = getFlag(db, 'base_library_jev', 1);
    if (flagJev) {
      try {
        const jevRes = await classifyRegionSurface(db, cropJpegBuffer, options);
        if (jevRes && jevRes.success && jevRes.data) {
          const jevSurface = jevRes.data.surface;
          const jevProb = jevRes.data.probability || 0;

          alternatives = [];
          // 核心治理规则升级：JEV 识别出 furniture 时，智能预选最高频的 upholstery (软体沙发) 并提供 hard_furniture 快捷候选，彻底杜绝空白停滞
          if (jevSurface === 'furniture') {
            part = 'upholstery';
            material_family = 'leather';
            probability = Math.max(0.85, jevProb);
            uncertain = false;
            alternatives = ['hard_furniture'];
            modelUsed = 'jev_smart_furniture';
          } else if (jevSurface === 'soft') {
            part = 'upholstery';
            material_family = 'fabric';
            probability = Math.max(0.82, jevProb);
            uncertain = false;
            alternatives = ['curtain_bedding', 'rug'];
            modelUsed = 'jev_smart_soft';
          } else if (VALID_PARTS.includes(jevSurface) && jevProb >= 0.75 && !jevRes.data.uncertain) {
            part = jevSurface;
            material_family = (PART_POLICIES[jevSurface] && PART_POLICIES[jevSurface].default_material_family) || 'unknown';
            probability = jevProb;
            uncertain = false;
            modelUsed = 'jev_fallback';
          } else {
            uncertain = true;
            part = null;
            probability = jevProb;
            modelUsed = 'jev_fallback_low_prob';
          }
        }
      } catch (_) {}
    }
  }

  const surface = PART_TO_SURFACE[part] || null;

  return {
    part,
    material_family,
    probability,
    uncertain,
    surface,
    alternatives: alternatives || [],
    model: modelUsed
  };
}

module.exports = {
  CLASSIFY_PART_PROMPT,
  classifyRegionPart
};
