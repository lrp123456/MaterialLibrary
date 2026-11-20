/**
 * /edit/run 出图参数解析。
 *
 * 可选档位、可选画幅与「档位×画幅 → 像素」换算表全部读模型契约，本文件不写死任何一项；
 * 契约里没有这两个参数时如实返回 declared=false，由调用方原样透传而不是猜一个值。
 */

/** 无换算表的模型（Agnes 那类只吃档位关键字）用长边估算预期出图，仅用于展示。 */
const TIER_LONG_EDGE = {
  '1K': 1024,
  '1.5K': 1536,
  '2K': 2048,
  '3K': 3072,
  '4K': 4096,
  '8K': 7680,
};

function ratioNum(r) {
  const parts = String(r).split(':');
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  return a > 0 && b > 0 ? a / b : NaN;
}

function orderedUnique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = String(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function contractOf(db, modelIdOrCode) {
  if (!modelIdOrCode) return null;
  try {
    const { resolveModelExecution } = require('../models-contract');
    return (resolveModelExecution(db, String(modelIdOrCode)) || {}).model || null;
  } catch (_) {
    return null;
  }
}

function paramOf(contract, key) {
  const list = contract && Array.isArray(contract.params) ? contract.params : [];
  return list.find((p) => p && p.key === key) || null;
}

/** 契约声明的能力：有换算表时以表为准（表里没有的组合厂商会 400），否则退回参数 options。 */
function capabilities(contract) {
  const table = ((contract || {}).table_mappings || {}).size_ratio || null;
  const sizeP = paramOf(contract, 'size');
  const ratioP = paramOf(contract, 'ratio');
  const declaredTiers = orderedUnique(
    (sizeP && Array.isArray(sizeP.options) && sizeP.options.length ? sizeP.options : sizeP && sizeP.default ? [sizeP.default] : [])
      .map(String)
  );
  const declaredRatios = orderedUnique(
    (ratioP && Array.isArray(ratioP.options) && ratioP.options.length ? ratioP.options : ratioP && ratioP.default ? [ratioP.default] : [])
      .map(String)
  );

  if (!table) {
    return {
      table: null,
      tiers: declaredTiers,
      ratios: declaredRatios,
      defaultTier: String((sizeP || {}).default || declaredTiers[0] || ''),
      defaultRatio: String((ratioP || {}).default || declaredRatios[0] || ''),
    };
  }

  const tableTiers = [];
  const tableRatios = [];
  for (const key of Object.keys(table)) {
    const i = key.lastIndexOf('_');
    if (i <= 0) continue;
    tableTiers.push(key.slice(0, i));
    tableRatios.push(key.slice(i + 1));
  }
  const knownTiers = new Set(tableTiers);
  return {
    table,
    tiers: orderedUnique([...declaredTiers.filter((t) => knownTiers.has(t)), ...tableTiers]),
    ratios: orderedUnique([...declaredRatios, ...tableRatios]),
    defaultTier: String((sizeP || {}).default || declaredTiers[0] || tableTiers[0] || ''),
    defaultRatio: String((ratioP || {}).default || declaredRatios[0] || tableRatios[0] || ''),
  };
}

function matchTier(tiers, want, fallback) {
  const norm = String(want == null ? '' : want).trim().toUpperCase().replace(/\s+/g, '');
  const hit = tiers.find((t) => String(t).toUpperCase() === norm);
  if (hit) return hit;
  if (fallback && tiers.includes(fallback)) return fallback;
  return tiers[0] || null;
}

/** 按目标宽高比挑最接近的画幅；完全吻合时 gap=0，调用方据此判断要不要保留贴回。 */
function matchRatio(ratios, wantNum, fallback) {
  if (!ratios.length) return { ratio: null, gap: 0 };
  if (!Number.isFinite(wantNum) || wantNum <= 0) {
    return { ratio: fallback && ratios.includes(fallback) ? fallback : ratios[0], gap: 0 };
  }
  let best = ratios[0];
  let bestGap = Infinity;
  for (const r of ratios) {
    const n = ratioNum(r);
    if (!Number.isFinite(n)) continue;
    const gap = Math.abs(Math.log(n / wantNum));
    if (gap < bestGap) {
      bestGap = gap;
      best = r;
    }
  }
  return { ratio: best, gap: Number.isFinite(bestGap) ? bestGap : 0 };
}

/** 换算表两种写法都要吃：Seedream 存 '1776x2368'，Qwen 存 {width,height}。 */
function parsePx(entry) {
  if (!entry) return null;
  if (typeof entry === 'object') {
    const w = Number(entry.width || entry.w);
    const h = Number(entry.height || entry.h);
    return w > 0 && h > 0 ? { w, h } : null;
  }
  const m = String(entry).match(/^(\d{3,4})\s*[x×*]\s*(\d{3,4})$/i);
  if (!m) return null;
  return { w: Number(m[1]), h: Number(m[2]) };
}

function estimatePx(tier, ratio) {
  const long = TIER_LONG_EDGE[String(tier || '').toUpperCase()];
  const n = ratioNum(ratio);
  if (!long || !Number.isFinite(n) || n <= 0) return null;
  return n >= 1
    ? { w: long, h: Math.round(long / n) }
    : { w: Math.round(long * n), h: long };
}

/**
 * @param {object} p
 * @param {object} [p.db]        活动库句柄；缺省时退回内置默认契约
 * @param {string} [p.model]     契约 id 或厂商 model_code
 * @param {string} [p.size]      用户选的清晰度档位；缺省用契约默认值
 * @param {string} [p.ratio]     用户选的画幅；缺省按基准图挑最接近的
 * @param {number} p.baseW       真正送进模型那张图的宽
 * @param {number} p.baseH
 * @returns {{declared:boolean, tier:string|null, ratio:string|null, sizeField:string|null,
 *            ratioField:string|null, outW:number, outH:number, exact:boolean,
 *            followsSource:boolean, sourceRatio:string|null}}
 *   sizeField/ratioField 是真正写进请求体的值；outW/outH 是预期出图尺寸。
 */
function resolveEditSize({ db = null, model = null, size = null, ratio = null, baseW = 0, baseH = 0 } = {}) {
  const contract = contractOf(db, model);
  const caps = capabilities(contract);
  const baseNum = baseW > 0 && baseH > 0 ? baseW / baseH : NaN;

  if (!caps.tiers.length && !caps.ratios.length) {
    return {
      declared: false,
      tier: null,
      ratio: null,
      sizeField: size ? String(size) : null,
      ratioField: ratio ? String(ratio) : null,
      outW: baseW || 0,
      outH: baseH || 0,
      exact: false,
      followsSource: true,
      sourceRatio: null,
    };
  }

  const tier = matchTier(caps.tiers, size, caps.defaultTier);
  const wanted = String(ratio || '').trim();
  // 'auto' 在契约里是厂商自动档，没有确定像素，而换算表和贴回都要确定比例，
  // 所以它等同于「跟随原图」：按基准图挑最接近的一档。
  const named = wanted && wanted !== 'auto' && caps.ratios.includes(wanted);
  const picked = named
    ? { ratio: wanted, gap: 0 }
    : matchRatio(caps.ratios, baseNum, caps.defaultRatio);
  const chosenRatio = picked.ratio;

  // 用户点名的画幅若正好等于最接近原图的那一档，仍算「跟随原图」，贴回照旧
  const nearestToBase = matchRatio(caps.ratios, baseNum, caps.defaultRatio).ratio;
  const followsSource = chosenRatio === nearestToBase;

  let outW = baseW || 0;
  let outH = baseH || 0;
  let sizeField = null;
  let ratioField = chosenRatio;
  let exact = false;

  if (caps.table && tier && chosenRatio) {
    const px = parsePx(caps.table[`${tier}_${chosenRatio}`]);
    if (px) {
      sizeField = `${px.w}x${px.h}`;
      outW = px.w;
      outH = px.h;
      exact = true;
    }
  }
  if (!sizeField) {
    sizeField = tier;
    const est = estimatePx(tier, chosenRatio);
    if (est) {
      outW = est.w;
      outH = est.h;
    }
  }

  return {
    declared: true,
    tier,
    ratio: chosenRatio,
    sizeField,
    ratioField,
    outW,
    outH,
    exact,
    followsSource,
    sourceRatio: nearestToBase,
  };
}

module.exports = {
  resolveEditSize,
  capabilities,
  ratioNum,
  matchRatio,
  TIER_LONG_EDGE,
};
