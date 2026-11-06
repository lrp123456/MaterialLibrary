/**
 * 空间创作参数解析 —— 唯一的三层优先级实现。
 *
 *   1. 会话上一轮快照（最高）：回到旧会话必须和该会话上一轮完全一致
 *   2. 该模型在设置页的专属默认：perModel[modelKey]
 *   3. 全局默认：/api/studio/defaults 与 catalog.defaults，兜底 9:16
 *
 * 这是纯函数模块，不依赖 Vue / DOM，方便单测。
 * ChatStudio.vue 的 applyParamsSnapshot() 负责把解析结果写回各个 ref
 * （必须同时写 schemaParams 与顶层 ref，否则会被上一模型的残留 schema 盖掉）。
 *
 * 想临时恢复「挂参考图自动推断画幅」时，改 ChatStudio.vue 里的
 * AUTO_ADAPT_RATIO / AUTO_ADAPT_SIZE 两个常量即可，这里不用动。
 */

export const FALLBACK_PARAMS = Object.freeze({
  ratio: '9:16',
  size: '2K',
  duration: 5,
  video_resolution: '720p',
  quality: null,
  seed: null
});

// 允许随会话持久化的字段。schemaParams 是模型契约参数表的快照，必须一起存，
// 否则「16:9 复用后变成 1:1」这类残留覆盖问题会重现。
export const SNAPSHOT_KEYS = Object.freeze([
  'ratio', 'size', 'resolution', 'video_resolution', 'duration',
  'quality', 'seed', 'schemaParams',
  'imageModelKey', 'videoModelKey', 'chatModelKey',
  'activeModality', 'thinkingStrength'
]);

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/** global 既可以是 { params: {...} }（/api/studio/defaults 返回值），也可以是扁平对象。 */
function normalizeGlobal(global) {
  const p = (global && (global.params || global)) || {};
  return compact({
    ratio: p.ratio || p.image_ratio || FALLBACK_PARAMS.ratio,
    size: p.image_size || p.size || FALLBACK_PARAMS.size,
    duration: p.video_duration ?? FALLBACK_PARAMS.duration,
    video_resolution: p.video_resolution || FALLBACK_PARAMS.video_resolution
  });
}

/**
 * 解析最终参数。sessionSnapshot 传 null 即「跳过会话层」——新建会话时用。
 * 后写入者覆盖前者，所以顺序固定为 全局 → 模型 → 会话。
 */
export function resolveParams({ sessionSnapshot = null, modelKey = '', perModel = {}, global = null } = {}) {
  const base = { ...FALLBACK_PARAMS, ...normalizeGlobal(global) };
  const modelDefaults = (modelKey && perModel && perModel[modelKey]) ? compact(perModel[modelKey]) : {};
  const session = compact(sessionSnapshot || {});
  return { ...base, ...modelDefaults, ...session };
}

/** 从当前 UI 状态提炼可持久化的会话快照。 */
export function buildSessionSnapshot(state = {}) {
  const out = {};
  for (const key of SNAPSHOT_KEYS) {
    if (state[key] !== undefined && state[key] !== null && state[key] !== '') out[key] = state[key];
  }
  return out;
}

/**
 * 从 chat_messages 的一条消息恢复快照（阶段 2 前用它兜底，
 * 阶段 2 之后优先读 chat_sessions.params_json）。
 */
export function snapshotFromMessage(msg) {
  if (!msg) return null;
  const p = msg.params || msg.retryParams || (msg.result && msg.result.retryParams) || null;
  if (!p || typeof p !== 'object') return null;
  return compact(p);
}

/** 判断两个快照是否等价，避免无意义的重复写库。 */
export function snapshotsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const va = a[k];
    const vb = b[k];
    if (va && vb && typeof va === 'object' && typeof vb === 'object') {
      return JSON.stringify(va) === JSON.stringify(vb);
    }
    return va === vb;
  });
}
