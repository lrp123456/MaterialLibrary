/**
 * 空间结构读取与相近材质推荐模块
 * 用于「换空间」全局操作：从原图结构化读取 6 面材质与颜色，并在基础属性库中按 Lab 色差给出推荐
 */
const { deltaE, extractColorRoles } = require('../colors');

const SURFACE_SPECS = [
  { key: 'ceiling', label: '天花', defaultKind: 'latex', kinds: ['latex', 'microcement', 'wood'] },
  { key: 'wall', label: '墙面', defaultKind: 'latex', kinds: ['latex', 'wallpaper', 'microcement', 'wood', 'tile', 'stone'] },
  { key: 'floor', label: '地面', defaultKind: 'tile', kinds: ['tile', 'wood_flooring', 'microcement', 'carpet'] },
  { key: 'millwork', label: '木作定制', defaultKind: 'wood', kinds: ['wood', 'stone', 'latex'] },
  { key: 'soft', label: '软装布艺', defaultKind: 'fabric', kinds: ['fabric', 'leather', 'furniture'] },
  { key: 'metal', label: '金属五金', defaultKind: 'metal_finish', kinds: ['metal_finish', 'fixture'] }
];

const EXTRACT_PROMPT = `
分析这张室内空间图。识别天花（ceiling）、墙面（wall）、地面（floor）、木作定制（millwork）、软装家具（soft）、金属饰面（metal）六个表面的当前材质类型与主导十六进制颜色代码。
材质类型只能从以下选取：latex(乳胶漆), wallpaper(墙纸/布), microcement(微水泥), wood(木纹), wood_flooring(木地板), tile(瓷砖/地砖), stone(大理石/石材), fabric(布艺), leather(皮革), metal_finish(金属)。
必须输出纯 JSON，不要 markdown 格式，不要多余字符：
{
  "ceiling": { "kind_key": "latex", "hex": "#F5F3ED", "desc": "暖白微粉天花乳胶漆" },
  "wall": { "kind_key": "latex", "hex": "#E6D7C3", "desc": "奶咖色艺术漆墙面" },
  "floor": { "kind_key": "wood_flooring", "hex": "#C4A574", "desc": "原木直铺地板" },
  "millwork": { "kind_key": "wood", "hex": "#8B5E3C", "desc": "胡桃木定制柜体" },
  "soft": { "kind_key": "fabric", "hex": "#EFEBE4", "desc": "米白亚麻棉麻织物" },
  "metal": { "kind_key": "metal_finish", "hex": "#2B2B2B", "desc": "黑色哑光极窄五金" }
}
`.trim();

function safeParseJson(text) {
  if (!text) return null;
  const raw = String(text).replace(/^[^\{]*/, '').replace(/[^\}]*$/, '');
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (__) {
        return null;
      }
    }
    return null;
  }
}

async function extractSpaceSurfaces(services, imageBuffer) {
  let vlmData = null;
  if (services) {
    try {
      const genGov = require('../gen-governance');
      const { chatVision } = require('../vlm');
      const ep = typeof genGov.resolveVlmEndpoint === 'function'
        ? genGov.resolveVlmEndpoint(services.db, services.config, 'workflow_vision')
        : null;
      const b64 = Buffer.isBuffer(imageBuffer) ? imageBuffer.toString('base64') : String(imageBuffer || '');
      const resp = await chatVision({
        baseUrl: ep && ep.baseUrl,
        apiKey: ep && ep.apiKey,
        model: (ep && ep.modelCode) || 'workflow_vision',
        prompt: EXTRACT_PROMPT,
        images: b64 ? [b64.replace(/^data:[^;]+;base64,/, '')] : []
      });
      vlmData = safeParseJson(resp.text || resp.content || '');
    } catch (_) {}
  }

  // 若 VLM 解析失败或离线，用色彩系统提取主色调建立保底
  let palette = null;
  if (Buffer.isBuffer(imageBuffer)) {
    try {
      palette = await extractColorRoles(imageBuffer);
    } catch (_) {}
  }

  const result = {};
  for (const spec of SURFACE_SPECS) {
    const item = vlmData && vlmData[spec.key];
    if (item && item.hex) {
      result[spec.key] = {
        surface: spec.key,
        label: spec.label,
        kind_key: item.kind_key || spec.defaultKind,
        hex: item.hex,
        desc: item.desc || spec.label
      };
    } else {
      // 备用根据调色板估算
      const colors = (palette && palette.colors) || [];
      const fallbackHex = colors.length ? colors[Math.min(colors.length - 1, 0)].hex : '#E5E5E5';
      result[spec.key] = {
        surface: spec.key,
        label: spec.label,
        kind_key: spec.defaultKind,
        hex: fallbackHex,
        desc: spec.label
      };
    }
  }

  return result;
}

/**
 * 在同种类或同安装面上按 Lab 色差给出推荐
 */
function recommendSurfaceItems(db, surface, kindKey, targetHex, limit = 8) {
  const spec = SURFACE_SPECS.find(s => s.key === surface) || { kinds: [kindKey] };
  const effectiveKind = kindKey || spec.defaultKind || 'latex';

  let rows = db.prepare(`
    SELECT DISTINCT i.*
    FROM ba_items i
    LEFT JOIN ba_item_mounts m ON m.item_id = i.id
    WHERE (i.kind_key = ? OR m.mount = ?)
      AND i.preview_rel IS NOT NULL AND i.preview_rel != ''
    LIMIT 200
  `).all(effectiveKind, surface);

  if (rows.length === 0) {
    // 宽泛兜底
    rows = db.prepare(`
      SELECT * FROM ba_items
      WHERE kind_key = ?
      LIMIT 50
    `).all(effectiveKind);
  }

  const cleanHex = String(targetHex || '').trim();
  const scored = rows.map(item => {
    let dist = 999;
    if (cleanHex && item.hex) {
      dist = deltaE(item.hex, cleanHex);
    } else if (!cleanHex && item.lightness != null) {
      dist = 50;
    }
    return {
      ...item,
      delta_e: Math.round(dist * 10) / 10
    };
  });

  scored.sort((a, b) => a.delta_e - b.delta_e);
  return scored.slice(0, limit);
}

module.exports = {
  SURFACE_SPECS,
  extractSpaceSurfaces,
  recommendSurfaceItems
};
