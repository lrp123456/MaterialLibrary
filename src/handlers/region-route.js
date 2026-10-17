/**
 * 管线 B · 选区出口路由（唯一决策点）
 *
 * 选区在客户端只有三种形态（IR）：rect（矩形框）/ quad（四点）/ brush（涂抹）。
 * 模型在服务端只有四种出口（`caps.region.kind`）：
 *   coords_bbox   原生吃归一化矩形   → 把外接矩形写进正文
 *   coords_point  原生吃归一化点     → 用选区中心点写进正文
 *   mask          原生吃蒙版图       → 栅格化 PNG 作为一张参考图传入
 *   vlm_text      不吃结构化选区     → VLM 描述成「九宫格方位 + 名称」写进正文
 *
 * 两条纪律（不可违反）：
 *   1) 可降级不可升格 —— brush 可以降成 bbox；bbox 绝不能冒充 brush 的精度。
 *   2) 降级必须回写告知 —— 任何降级都在返回值里带 `regionNote`，客户端原样展示，
 *      不允许让用户以为「涂抹生效了」而其实只用了外接矩形。
 *
 * 新增模型只需在 studio-catalog 里给它一个 caps.region，本文件不需要改。
 */
const { capsFor } = require('../studio-catalog');
const {
  selectionToApiBox0999,
  selectionToPoint0999,
  buildMaskFromSelection,
  selectionBounds,
} = require('../maskBuilder');

/** 出口的保真度排序（越大越精确），用于判断「是否发生了降级」 */
const EXIT_FIDELITY = { mask: 3, coords_bbox: 2, coords_point: 2, vlm_text: 1 };

/** 选区形态的保真度：涂抹 > 四点 > 矩形 */
const SELECTION_FIDELITY = { rect: 1, quad: 2, brush: 3 };

const EXIT_LABEL = {
  coords_bbox: '归一化矩形坐标（0–1000）',
  coords_point: '归一化点坐标（0–1000）',
  mask: '蒙版图',
  vlm_text: '语义方位描述',
};

/**
 * 3 形态 × 4 出口 的降级矩阵。值 = 人类可读的「实际发生了什么」，
 * 用于自动生成 regionNote，避免每个 handler 各写一份文案。
 */
const DOWNGRADE = {
  coords_bbox: {
    rect: '矩形框原样用作坐标框',
    quad: '四点选区取外接矩形后作为坐标框',
    brush: '涂抹选区取外接矩形后作为坐标框（未使用逐像素蒙版）',
  },
  coords_point: {
    rect: '矩形框取中心点作为坐标点',
    quad: '四点选区取外接矩形中心作为坐标点',
    brush: '涂抹选区取外接矩形中心作为坐标点',
  },
  mask: {
    rect: '矩形栅格化为蒙版（白=重绘）',
    quad: '四点多边形按原轮廓栅格化为蒙版（白=重绘）',
    brush: '涂抹笔迹按原轮廓栅格化为蒙版（白=重绘）',
  },
  vlm_text: {
    rect: '矩形框换算为九宫格方位 + 物体名称',
    quad: '四点选区换算为九宫格方位 + 物体名称',
    brush: '涂抹选区换算为九宫格方位 + 物体名称',
  },
};

/** 归一化选区形态：兼容各种历史入参写法 */
function normalizeSelectionType(selection) {
  if (!selection) return null;
  if (Array.isArray(selection.strokes) && selection.strokes.length) return 'brush';
  if (Array.isArray(selection.points) && selection.points.length >= 3) return 'quad';
  if (Array.isArray(selection.quad) && selection.quad.length >= 3) return 'quad';
  // 画框：right|width 任一存在即成立
  const hasLeftTop = Number.isFinite(Number(selection.left)) && Number.isFinite(Number(selection.top));
  if (hasLeftTop && (Number.isFinite(Number(selection.right)) || Number.isFinite(Number(selection.width)))) {
    return 'rect';
  }
  if (selection.rectBox && Number.isFinite(Number(selection.rectBox.x))) return 'rect';
  if (selection.bbox && Number.isFinite(Number(selection.bbox.x1))) return 'rect';
  if (Array.isArray(selection.bbox) && selection.bbox.length >= 4) return 'rect';
  if (selection.type === 'mask') return 'quad';
  return null;
}

/**
 * 查该模型走哪个出口。
 * @returns {{ modelId:string, kind:string, caps:object|null, fidelity:number, known:boolean }}
 */
function routeFor(modelId) {
  const caps = capsFor(modelId) || null;
  const kind = (caps && caps.region && caps.region.kind) || 'vlm_text';
  return {
    modelId: modelId || null,
    kind,
    caps,
    fidelity: EXIT_FIDELITY[kind] || 1,
    known: Boolean(caps),
  };
}

/** 九宫格方位（中文），与客户端 promptBuilder.screenPosition 保持同口径 */
function screenPositionZh(bounds, natW, natH) {
  if (!bounds || !natW || !natH) return '画面中部';
  // 两套 bounds 键名并存：maskBuilder 用 {x1,y1,x2,y2}，image-ops 用 {minX,minY,maxX,maxY}。
  // 这里统一吃下两种，避免调用方选错形状就静默退化成「画面中部」。
  const x1 = Number(bounds.x1 != null ? bounds.x1 : bounds.minX);
  const y1 = Number(bounds.y1 != null ? bounds.y1 : bounds.minY);
  const x2 = Number(bounds.x2 != null ? bounds.x2 : bounds.maxX);
  const y2 = Number(bounds.y2 != null ? bounds.y2 : bounds.maxY);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return '画面中部';
  const cx = (x1 + x2) / 2 / natW;
  const cy = (y1 + y2) / 2 / natH;
  const col = cx < 0.33 ? '左' : cx > 0.66 ? '右' : '中';
  const row = cy < 0.33 ? '上' : cy > 0.66 ? '下' : '中';
  if (col === '中' && row === '中') return '画面中部';
  return `${row}${col}部`;
}

/** 从任一种 bounds 形状取像素外接框（统一形状漂移） */
function toXYWH(bounds) {
  if (!bounds) return null;
  const x1 = Number(bounds.x1 != null ? bounds.x1 : bounds.minX);
  const y1 = Number(bounds.y1 != null ? bounds.y1 : bounds.minY);
  const x2 = Number(bounds.x2 != null ? bounds.x2 : bounds.maxX);
  const y2 = Number(bounds.y2 != null ? bounds.y2 : bounds.maxY);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  return { x1, y1, x2, y2 };
}

/** `图1 <bbox>a b c d</bbox>（即 a b c d）` —— 两种官方等价写法同时给出，兼容性最好 */
function bboxClause(box) {
  const nums = `${box.x1} ${box.y1} ${box.x2} ${box.y2}`;
  return `图1 <bbox>${nums}</bbox>（等价写法：${nums}）`;
}

/**
 * 把路由结果压成两句话模板都能直接用的短语，避免每个 handler 自己拼「区域」二字：
 *   areaPhrase   —— 「…区域」形式，用于「在 areaPhrase 内做 X」
 *                   坐标出口：`图1 <bbox>a b c d</bbox>（等价写法：a b c d）区域`
 *                   语义出口：`图1中位于左下部的圆形地毯所在区域`
 *   objectPhrase —— 「…物体」形式，用于「把 objectPhrase 删掉/替换成 Y」
 *                   坐标出口：`图1 <bbox>…</bbox> 区域内的物体`
 *                   语义出口：`图1中位于左下部的圆形地毯`
 */
function buildAreaPhrase(out) {
  const t = out.text || '';
  if (!t) return '';
  if (out.kind === 'vlm_text') return `${t}所在区域`;
  return `${t}区域`;
}

function buildObjectPhrase(out) {
  const t = out.text || '';
  if (!t) return '';
  if (out.kind === 'vlm_text') return t;
  return `${t} 区域内的物体`;
}

/**
 * 构建选区子句（管线的「能力适配」阶段）。
 *
 * @param {object} p
 * @param {string} p.modelId        模型（任意 id / alias / model_code）
 * @param {object} p.selection      选区 IR（rect / quad / brush）
 * @param {number} p.natW,p.natH    原图像素尺寸
 * @param {string} [p.objName]      物体名（vlm_text 出口用）
 * @param {object} [p.vlmInfo]      可选 VLM 结果 { name_cn, attributes }
 * @param {object} [p.services]     需要栅格化时传入（含 db/config）
 * @param {string} [p.maskId]       栅格化蒙版的文件名/ID
 * @returns {Promise<object>} 见上方字段说明
 */
async function regionClause(p) {
  const out = await regionClauseRaw(p);
  out.areaPhrase = buildAreaPhrase(out);
  out.objectPhrase = buildObjectPhrase(out);
  return out;
}

async function regionClauseRaw(p) {  const { modelId, selection, natW, natH, objName, vlmInfo, services, maskId } = p || {};
  const route = routeFor(modelId);
  const kind = route.kind;
  const selType = normalizeSelectionType(selection);
  const caps = route.caps || {};
  const region = caps.region || {};

  const out = {
    kind,
    exit: kind,
    selectionType: selType,
    fidelity: route.fidelity,
    degraded: false,
    text: '',
    apiBox: null,
    point: null,
    mask: null,
    maskChannel: region.maskChannel || null,
    note: region.note || '',
  };

  if (!selection) {
    out.note = '未提供选区，按全图处理';
    out.degraded = true;
    out.text = '整张图';
    return out;
  }

  switch (kind) {
    case 'coords_bbox': {
      const box = selectionToApiBox0999(selection, natW, natH);
      out.apiBox = box;
      if (box) {
        out.text = bboxClause(box);
      } else {
        // 坐标换算失败 → 降到语义描述，绝不静默丢选区
        out.text = `图1中位于${screenPositionZh(selectionBounds(selection, natW, natH), natW, natH)}的目标区域`;
        out.degraded = true;
        out.note = '选区坐标换算失败，已降级为方位描述';
        return out;
      }
      if (selType && DOWNGRADE.coords_bbox[selType]) {
        out.note = DOWNGRADE.coords_bbox[selType];
        out.degraded = selType === 'quad' || selType === 'brush';
      }
      return out;
    }

    case 'coords_point': {
      const pt = selectionToPoint0999(selection, natW, natH);
      out.point = pt;
      if (pt) {
        out.text = `图1 <point>${pt.x} ${pt.y}</point>（等价写法：${pt.x} ${pt.y}）`;
      } else {
        out.text = `图1中位于${screenPositionZh(selectionBounds(selection, natW, natH), natW, natH)}的目标`;
        out.degraded = true;
        out.note = '选区坐标换算失败，已降级为方位描述';
        return out;
      }
      if (selType && DOWNGRADE.coords_point[selType]) {
        out.note = DOWNGRADE.coords_point[selType];
        out.degraded = true;
      }
      return out;
    }

    case 'mask': {
      // 客户端已经上传的 mask PNG 直接用，避免再栅格化出第二张不一样的图
      if (selection && selection.maskUrl) {
        out.mask = { url: selection.maskUrl, maskId: selection.maskId || null };
        out.apiBox = selectionToApiBox0999(selection, natW, natH);
        out.text = '';
        if (selType && DOWNGRADE.mask[selType]) out.note = DOWNGRADE.mask[selType];
        out.degraded = false;
        return out;
      }
      // 栅格化产物作为一张「参考图」交出；不产生正文子句
      const built = await buildMaskFromSelection(services && services.db, services && services.config, {
        selection,
        natW,
        natH,
        maskId: maskId || `route_${Date.now()}`,
      });
      out.mask = built || null;
      out.apiBox = (built && built.apiBox) || null;
      out.text = '';
      if (selType && DOWNGRADE.mask[selType]) out.note = DOWNGRADE.mask[selType];
      out.degraded = false; // 栅格化保留了原始轮廓，不算降级
      if (!built) {
        out.note = '蒙版栅格化失败，已改为坐标框';
        out.degraded = true;
        out.kind = 'coords_bbox';
        out.exit = 'coords_bbox';
        const box = selectionToApiBox0999(selection, natW, natH);
        out.apiBox = box;
        out.text = box ? bboxClause(box) : '图1中的目标区域';
      }
      return out;
    }

    case 'vlm_text':
    default: {
      const bounds = selectionBounds(selection, natW, natH);
      const pos = screenPositionZh(bounds, natW, natH);
      const name = (vlmInfo && vlmInfo.name_cn) || objName || '目标物体';
      const attrs = vlmInfo && vlmInfo.attributes ? `，${vlmInfo.attributes}` : '';
      out.text = `图1中位于${pos}的${name}${attrs}`;
      if (selType && DOWNGRADE.vlm_text[selType]) {
        out.note = DOWNGRADE.vlm_text[selType];
      }
      // 语义出口下，矩形框能表达的信息量本来就小于区域，但这是模型的事实上限，
      // 不算「我们主动降级」——只有四点/涂抹这种更精细的选区才算被抹平。
      out.degraded = selType === 'quad' || selType === 'brush';
      if (out.degraded) {
        out.note += '；该模型不接受结构化选区，精细轮廓信息无法传达';
      }
      return out;
    }
  }
}

/**
 * 把路由结果压成一句给用户看的提示，仅在有降级/异常时返回非空。
 */
function regionNoteOf(route, r) {
  if (!r) return '';
  if (!r.degraded) return '';
  return `选区处理：${r.note || '已按模型能力降级处理'}`;
}

/* ------------------------------------------------------------------ *
 * 提示词消毒：客户端会自带一份 prompt（本地 promptBuilder 生成），
 * 服务端必须在**发往模型之前**把它和该模型真实吃的能力对齐，否则：
 *   · 面向 vlm_text 模型时，本地模板里的 `<bbox>…</bbox>` 会被模型当成
 *     真实存在的坐标框而"照着画一个" —— 典型幻觉来源；
 *   · 面向 coords_* 模型时，若本地模板没写坐标（例如走了语义分支），
 *     选区就白选了。
 * 这一步是「管线 B · 能力适配」的最后一道闸门。
 * ------------------------------------------------------------------ */

const BBOX_RE = /<bbox>\s*-?\d+(?:\s+-?\d+){3}\s*<\/bbox>/gi;
const POINT_RE = /<point>\s*-?\d+(?:\s+-?\d+)\s*<\/point>/gi;
/** 归一化四/二连数字（官方裸写法），如「179 283 796 986」 */
const BARE4_RE = /\b\d{1,3}(?:\s+\d{1,3}){3}\b/g;

const COORD_EXITS = new Set(['coords_bbox', 'coords_point']);

/**
 * 纯语法级剥离：删掉所有坐标句法，不加任何定位文字。
 * 给 expand / style_transfer / clarity 这类「无选区全局操作」用 ——
 * 这类操作本来就没有选区，提示词里出现的坐标只会误导模型。
 */
function stripCoordSyntax(prompt) {
  const raw = String(prompt || '').trim();
  if (!raw) return '';
  let out = raw.replace(BBOX_RE, '').replace(POINT_RE, '');
  BBOX_RE.lastIndex = 0;
  POINT_RE.lastIndex = 0;
  if (!/<bbox>|<point>/i.test(out)) {
    out = out.replace(BARE4_RE, '');
    BARE4_RE.lastIndex = 0;
  }
  return out.replace(/\s{2,}/g, ' ').replace(/[（(]\s*[)）]/g, '').trim();
}

/**
 * @param {string} prompt      客户端传入的提示词（可为空）
 * @param {object} clause      regionClause 的结果
 * @returns {{ prompt:string, sanitized:boolean, note:string }}
 */
function reconcilePrompt(prompt, clause) {
  const raw = String(prompt || '').trim();
  const c = clause || {};
  const kind = c.kind || 'vlm_text';

  if (!raw) {
    // 客户端没给提示词：直接用服务端子句拼一条最小可执行指令
    return { prompt: c.text ? `【选区】${c.text}。` : '', sanitized: false, note: '' };
  }

  if (COORD_EXITS.has(kind)) {
    const hasCoord = BBOX_RE.test(raw) || POINT_RE.test(raw) || BARE4_RE.test(raw);
    // 复位 lastIndex（正则带 g 标志时 test 会推进游标）
    BBOX_RE.lastIndex = 0; POINT_RE.lastIndex = 0; BARE4_RE.lastIndex = 0;
    if (hasCoord || !c.text) return { prompt: raw, sanitized: false, note: '' };
    return {
      prompt: `${raw}\n【选区】${c.text}。只改该区域，其余像素保持不变。`,
      sanitized: true,
      note: '客户端提示词缺少坐标，已由服务端补入选区',
    };
  }

  // vlm_text 出口：必须剥掉所有坐标句法
  const hadCoord = BBOX_RE.test(raw) || POINT_RE.test(raw) || BARE4_RE.test(raw);
  BBOX_RE.lastIndex = 0; POINT_RE.lastIndex = 0; BARE4_RE.lastIndex = 0;
  if (!hadCoord) {
    // 没有坐标也要保证语义定位在句子里
    if (c.text && !raw.includes(c.text)) {
      return { prompt: `${raw}\n【定位】${c.text}。只改这一处。`, sanitized: true, note: '' };
    }
    return { prompt: raw, sanitized: false, note: '' };
  }

  // 语法级剥离（含裸四连数字，如「179 283 796 986」——官方等价写法）
  let cleaned = stripCoordSyntax(raw);
  // 清掉因删除坐标留下的「区域」「内的」等悬空表述
  cleaned = cleaned
    .replace(/(?:图\s*1)?\s*区域内的/g, '')
    .replace(/标记框|标记区域/g, '该区域')
    .replace(/\s{2,}/g, ' ')
    .replace(/[（(]\s*[)）]/g, '')
    .trim();
  BBOX_RE.lastIndex = 0; POINT_RE.lastIndex = 0; BARE4_RE.lastIndex = 0;
  const loc = c.text ? `【定位】${c.text}。` : '【定位】请按文字描述定位目标。';
  return {
    prompt: `${cleaned}\n${loc}该模型不接受结构化坐标，请勿输出或依赖任何坐标框。`,
    sanitized: true,
    note: '已剥离坐标句法（该模型不吃结构化选区，留着会诱发幻觉）',
  };
}

module.exports = {
  routeFor,
  regionClause,
  regionNoteOf,
  reconcilePrompt,
  stripCoordSyntax,
  normalizeSelectionType,
  screenPositionZh,
  bboxClause,
  EXIT_FIDELITY,
  SELECTION_FIDELITY,
  EXIT_LABEL,
  DOWNGRADE,
  buildAreaPhrase,
  buildObjectPhrase,
};
