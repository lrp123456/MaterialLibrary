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

const PART_TRANSLATIONS = {
  sofa: 'upholstery',
  couch: 'upholstery',
  furniture: 'upholstery',
  armchair: 'upholstery',
  recliner: 'upholstery',
  single_sofa: 'upholstery',
  electric_sofa: 'upholstery',
  '单人沙发': 'upholstery',
  '电动沙发': 'upholstery',
  '沙发椅': 'upholstery',
  '沙发': 'upholstery',
  chair: 'upholstery',
  bed: 'upholstery',
  cushion: 'upholstery',
  ceiling: 'ceiling',
  wall: 'wall',
  floor: 'floor',
  millwork: 'millwork',
  cabinet: 'millwork',
  wardrobe: 'millwork',
  hard_furniture: 'hard_furniture',
  table: 'hard_furniture',
  desk: 'hard_furniture',
  shelf: 'hard_furniture',
  curtain_bedding: 'curtain_bedding',
  curtain: 'curtain_bedding',
  bedding: 'curtain_bedding',
  rug: 'rug',
  carpet: 'rug'
};

function resolvePartCandidate(rawPart) {
  if (!rawPart) return null;
  const str = String(rawPart).trim().toLowerCase();
  if (PART_TRANSLATIONS[str]) return PART_TRANSLATIONS[str];
  if (VALID_PARTS.includes(str)) return str;
  if (str.includes('沙发') || str.includes('sofa') || str.includes('recliner') || str.includes('armchair') || str.includes('couch')) {
    return 'upholstery';
  }
  if (str.includes('天花') || str.includes('吊顶') || str.includes('ceiling')) {
    return 'ceiling';
  }
  if (str.includes('地板') || str.includes('地砖') || str.includes('地面') || str.includes('floor')) {
    return 'floor';
  }
  if (str.includes('墙') || str.includes('wall')) {
    return 'wall';
  }
  if (str.includes('柜') || str.includes('橱柜') || str.includes('衣柜') || str.includes('cabinet') || str.includes('millwork')) {
    return 'millwork';
  }
  if (str.includes('窗帘') || str.includes('床品') || str.includes('curtain') || str.includes('bedding')) {
    return 'curtain_bedding';
  }
  if (str.includes('地毯') || str.includes('地垫') || str.includes('rug') || str.includes('carpet')) {
    return 'rug';
  }
  return null;
}

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
 * 软体家具（沙发/单椅）空间几何判定（JEV 防截胡与 Level 3 兜底共用同一谓词）：
 * 立体高度、中心偏下、底边贴地、宽度不能是整面墙。回归基线：真实沙发框选
 * cy≈0.79/ch≈0.32/bottom≈0.95/cw≈0.58；而 cy=0.5/ch=0.6/cw=0.95 的宽幅背景必须判 wall。
 */
function isSofaGeometry(ch, cy, bottom, cw) {
  return ch >= 0.18 &&
    cy >= 0.55 && cy <= 0.86 &&
    bottom >= 0.82 &&
    cw <= 0.85;
}

/**
 * 提取选区空间几何特征 (cy, ch, cw, nx, ny)
 */
function extractSpatialGeometry(options) {
  if (!options) return null;
  const sel = (options && typeof options === 'object' && (options.selection || options.norm || options.bbox))
    ? (options.selection || options.norm || options.bbox)
    : options;
  if (!sel) return null;

  let cy = 0.5;
  let ch = 0.4;
  let cw = 0.4;
  let rawBbox = null;

  if (typeof sel === 'string') {
    const { parseBboxString } = require('../handlers/image-ops');
    rawBbox = parseBboxString(sel);
  } else if (Array.isArray(sel) && sel.length === 4 && typeof sel[0] === 'number') {
    rawBbox = sel;
  } else if (typeof sel === 'object') {
    if (typeof sel.bbox === 'string') {
      const { parseBboxString } = require('../handlers/image-ops');
      rawBbox = parseBboxString(sel.bbox);
    } else if (Array.isArray(sel.bbox)) {
      rawBbox = sel.bbox;
    } else if (Array.isArray(sel.norm) && sel.norm.length === 4) {
      rawBbox = sel.norm;
    }
  }

  if (rawBbox && rawBbox.length === 4) {
    const nums = rawBbox.map(Number);
    // 非有限数（NaN/Infinity，如 [.1,.2,.3,'x']）不产生几何结论，
    // 否则后续比较全部为 false，会错误地兜底成 wall/0.85 的确定结论
    if (nums.some((n) => !Number.isFinite(n))) return null;
    const [b1, b2, b3, b4] = nums;
    const minX = Math.min(b1, b3);
    const maxX = Math.max(b1, b3);
    const minY = Math.min(b2, b4);
    const maxY = Math.max(b2, b4);

    let scaleX = 1;
    let scaleY = 1;
    if (options && options.base_image_dims && (options.base_image_dims.width || options.base_image_dims.w)) {
      const baseW = options.base_image_dims.width || options.base_image_dims.w;
      const baseH = options.base_image_dims.height || options.base_image_dims.h;
      if (maxX > 1000 || maxY > 1000) {
        scaleX = baseW;
        scaleY = baseH;
      } else if (minX > 1 || minY > 1 || maxX > 1 || maxY > 1) {
        scaleX = 1000;
        scaleY = 1000;
      }
    } else if (maxX > 1000 || maxY > 1000) {
      scaleX = maxX <= 1152 ? 1152 : (maxX <= 2048 ? 2048 : Math.pow(2, Math.ceil(Math.log2(maxX))));
      scaleY = maxY <= 2048 ? 2048 : (maxY <= 4096 ? 4096 : Math.pow(2, Math.ceil(Math.log2(maxY))));
    } else if (minX > 1 || minY > 1 || maxX > 1 || maxY > 1) {
      scaleX = 1000;
      scaleY = 1000;
    }

    const nx = minX / scaleX;
    const ny = minY / scaleY;
    cw = Math.max(0.001, (maxX - minX) / scaleX);
    ch = Math.max(0.001, (maxY - minY) / scaleY);
    cy = ny + ch / 2;
    return { cy, ch, cw, nx, ny };
  } else if (typeof sel.cy === 'number') {
    cy = sel.cy;
    ch = typeof sel.ch === 'number' ? sel.ch : 0.4;
    cw = typeof sel.cw === 'number' ? sel.cw : 0.4;
    return { cy, ch, cw };
  } else if (sel.norm && typeof sel.norm.y === 'number') {
    ch = typeof sel.norm.h === 'number' ? sel.norm.h : 0.4;
    cw = typeof sel.norm.w === 'number' ? sel.norm.w : 0.4;
    cy = sel.norm.y + ch / 2;
    return { cy, ch, cw };
  } else if (typeof sel.y === 'number') {
    ch = typeof sel.h === 'number' ? sel.h : 0.4;
    cw = typeof sel.w === 'number' ? sel.w : 0.4;
    cy = sel.y + ch / 2;
    return { cy, ch, cw };
  } else if (Array.isArray(sel.norm_points) && sel.norm_points.length > 0) {
    const minX = Math.min(...sel.norm_points.map((p) => (p && typeof p.x === 'number' ? p.x : 0)));
    const maxX = Math.max(...sel.norm_points.map((p) => (p && typeof p.x === 'number' ? p.x : 0)));
    const minY = Math.min(...sel.norm_points.map((p) => (p && typeof p.y === 'number' ? p.y : 0)));
    const maxY = Math.max(...sel.norm_points.map((p) => (p && typeof p.y === 'number' ? p.y : 0)));
    cw = Math.max(0.001, maxX - minX);
    ch = Math.max(0.001, maxY - minY);
    cy = minY + ch / 2;
    return { cy, ch, cw };
  } else if (Array.isArray(sel.normPoints) && sel.normPoints.length > 0) {
    const minX = Math.min(...sel.normPoints.map((p) => (p && typeof p.x === 'number' ? p.x : 0)));
    const maxX = Math.max(...sel.normPoints.map((p) => (p && typeof p.x === 'number' ? p.x : 0)));
    const minY = Math.min(...sel.normPoints.map((p) => (p && typeof p.y === 'number' ? p.y : 0)));
    const maxY = Math.max(...sel.normPoints.map((p) => (p && typeof p.y === 'number' ? p.y : 0)));
    cw = Math.max(0.001, maxX - minX);
    ch = Math.max(0.001, maxY - minY);
    cy = minY + ch / 2;
    return { cy, ch, cw };
  }
  return null;
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

  // 1. 尝试优先使用 VLM 封闭 JSON (当存在图像数据时)
  const customChatVision = options.chatVision;
  const customFetch = options.fetch;
  let vlmSuccess = false;
  let jevSuccess = false;

  if (cropJpegBuffer && Buffer.isBuffer(cropJpegBuffer) && cropJpegBuffer.length > 0) {
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
        const candidatePart = resolvePartCandidate(parsed.part);
        const validPart = VALID_PARTS.includes(candidatePart) ? candidatePart : null;
        const validFamily = VALID_MATERIAL_FAMILIES.includes(parsed.material_family) ? parsed.material_family : 'unknown';

        if (validPart && prob >= 0.75) {
          part = validPart;
          material_family = validFamily;
          probability = prob;
          uncertain = false;
          vlmSuccess = true;
        } else {
          part = null;
          probability = prob;
          uncertain = true;
          material_family = validFamily;
          vlmSuccess = false;
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
            if (jevSurface === 'furniture' || jevSurface === 'sofa' || jevSurface === 'upholstery') {
              jevSuccess = true;
              part = 'upholstery';
              material_family = 'leather';
              probability = Math.max(0.86, jevProb);
              uncertain = false;
              alternatives = ['hard_furniture', 'cabinet_door'];
              modelUsed = 'jev_smart_furniture';
            } else if (jevSurface === 'soft') {
              jevSuccess = true;
              part = 'upholstery';
              material_family = 'fabric';
              probability = Math.max(0.85, jevProb);
              uncertain = false;
              alternatives = ['curtain_bedding', 'rug'];
              modelUsed = 'jev_smart_soft';
            } else if (VALID_PARTS.includes(jevSurface) && jevProb >= 0.75 && !jevRes.data.uncertain) {
              const geom = extractSpatialGeometry(options);
              const bottom = geom ? geom.cy + geom.ch / 2 : 0;
              // 家具几何必须贴地、中心偏下且不是整面墙宽；过宽/悬浮的选区应放行 wall/floor 结论
              const isSpatialFurniture = geom && isSofaGeometry(geom.ch, geom.cy, bottom, geom.cw);
              if ((jevSurface === 'wall' || jevSurface === 'floor') && isSpatialFurniture) {
                // 空间几何防截胡校验：JEV 命中 wall/floor 但选区呈独立立体家具几何特征，严禁采纳 JEV 的 wall/floor 结论
                // 放行至 Level 3 空间几何启发式规则
                jevSuccess = false;
                part = null;
                uncertain = true;
                modelUsed = 'jev_spatial_veto_furniture';
              } else {
                jevSuccess = true;
                part = jevSurface;
                material_family = (PART_POLICIES[jevSurface] && PART_POLICIES[jevSurface].default_material_family) || 'unknown';
                probability = jevProb;
                uncertain = false;
                modelUsed = 'jev_fallback';
              }
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
  }

  // 3. Level 3 空间几何与图像色度启发式识别兜底 (当无外部 Key 或离线时，绝不返回 0% 空白)
  if (!part && !vlmSuccess && !jevSuccess) {
    const geom = extractSpatialGeometry(options);
    if (geom) {
      const { cy, ch, cw } = geom;
      const bottom = cy + ch / 2;

      // 重构几何启发式规则：
      // 1. 天花板：极顶部区域
      if (cy < 0.22 || bottom < 0.30) {
        part = 'ceiling';
        material_family = 'paint';
        probability = 0.86;
        uncertain = false;
        alternatives = ['wall'];
        modelUsed = 'heuristic_spatial_ceiling';
      }
      // 2. 地面：扁平低位特征或极限贴底大面积
      else if ((ch < 0.20 && cy > 0.80) || cy > 0.88 || (bottom >= 0.96 && ch <= 0.25 && cw >= 0.70)) {
        part = 'floor';
        material_family = 'wood';
        probability = 0.85;
        uncertain = false;
        alternatives = ['rug'];
        modelUsed = 'heuristic_spatial_floor';
      }
      // 3. 软体家具（沙发/单椅等）：立体高度 + 中心偏下 + 底边贴地 + 非整面墙宽
      else if (isSofaGeometry(ch, cy, bottom, cw)) {
        part = 'upholstery';
        material_family = 'leather';
        probability = 0.86;
        uncertain = false;
        alternatives = ['hard_furniture', 'wall', 'millwork'];
        modelUsed = 'heuristic_spatial_upholstery';
      }
      // 4. 其余区域归为立面墙体
      else {
        part = 'wall';
        material_family = 'paint';
        probability = 0.85;
        uncertain = false;
        alternatives = ['millwork', 'curtain_bedding'];
        modelUsed = 'heuristic_spatial_wall';
      }
    }
  }

  // 派生建议基材品类 ID
  let recommended_category_id = 'mat_cat_latex';
  if (part === 'upholstery') {
    recommended_category_id = (material_family === 'fabric') ? 'mat_cat_fabric_upholstery' : 'mat_cat_leather';
  } else if (part === 'floor') {
    recommended_category_id = (material_family === 'stone') ? 'mat_cat_stone' : 'mat_cat_wood_floor';
  } else if (part === 'ceiling') {
    recommended_category_id = 'mat_cat_latex';
  } else if (part === 'wall') {
    recommended_category_id = (material_family === 'wood') ? 'mat_cat_wood_panel' : ((material_family === 'art_coat') ? 'mat_cat_art_plaster' : 'mat_cat_latex');
  } else if (part === 'millwork' || part === 'cabinet_door') {
    // 识别链输出 millwork（8 部位白名单），字典历史 id 为 cabinet_door，二者等价
    recommended_category_id = (material_family === 'wood')
      ? 'mat_cat_wood_panel'
      : (material_family === 'stone')
        ? 'mat_cat_stone'
        : (material_family === 'metal')
          ? 'mat_cat_metal'
          : 'mat_cat_cabinet_lacquer';
  } else if (part === 'curtain_bedding') {
    recommended_category_id = 'mat_cat_textile_drapery';
  } else if (part === 'rug') {
    recommended_category_id = 'mat_cat_carpet';
  } else if (part === 'hard_furniture') {
    recommended_category_id = (material_family === 'metal') ? 'mat_cat_metal' : 'mat_cat_wood_panel';
  }

  const surface = PART_TO_SURFACE[part] || null;

  let default_swatch = null;
  if (db) {
    try {
      default_swatch = db.prepare('SELECT * FROM ba_material_swatches WHERE category_id = ? AND enabled = 1 ORDER BY pinned DESC, sort_order ASC, lrv DESC LIMIT 1').get(recommended_category_id) || null;
    } catch (_) {}
  }

  return {
    part,
    material_family,
    recommended_category_id,
    default_swatch,
    probability,
    confidence: probability,
    uncertain,
    surface,
    alternatives: alternatives || [],
    model: modelUsed
  };
}

module.exports = {
  CLASSIFY_PART_PROMPT,
  PART_TRANSLATIONS,
  resolvePartCandidate,
  extractSpatialGeometry,
  classifyRegionPart
};
