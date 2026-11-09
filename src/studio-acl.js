/**
 * 模型可见性白名单（按用户维度隔离）。
 *
 * 规则：
 * - 默认账号只可见 PUBLIC_MODEL_IDS 列出的公共模型；
 * - 仅 users.allow_all_models = 1 的账号可见全部模型；
 * - admin 角色 **不** 自动获得全模型可见性，必须显式置 allow_all_models。
 *
 * 该模块只做「可见 / 不可见」判定，不改动任何契约与生成器逻辑。
 */
'use strict';

const PUBLIC_MODEL_IDS = [
  // 图片
  'gpt_image_2_5_sunburst_vip',
  'gemini_3_1_flash_image',
  'seedream5pro',
  'seedream5flash',
  // 视频
  'seedance2_0',
  'seedance2_5',
  'wan3_0_video',
  // 对话
  'gemini_4_argon',
];

const PUBLIC_SET = new Set(PUBLIC_MODEL_IDS);

// OFFICIAL_STUDIO 中公共模型的 id / dbId / model_code / aliases → 规范 id。
// 客户端可能用 model_code 或别名提交 b.model，这里一并放行，避免误 403。
let _aliasMap = null;
function aliasMap() {
  if (_aliasMap) return _aliasMap;
  _aliasMap = new Map();
  try {
    const { OFFICIAL_STUDIO } = require('./studio-catalog');
    for (const domain of Object.keys(OFFICIAL_STUDIO || {})) {
      const models = (OFFICIAL_STUDIO[domain] && OFFICIAL_STUDIO[domain].models) || [];
      for (const m of models) {
        if (!m || !PUBLIC_SET.has(m.id)) continue;
        const keys = [m.id, m.dbId, m.model_code].concat(Array.isArray(m.aliases) ? m.aliases : []);
        for (const k of keys) {
          if (k) _aliasMap.set(String(k), m.id);
        }
      }
    }
  } catch (_) {}
  for (const id of PUBLIC_MODEL_IDS) {
    if (!_aliasMap.has(id)) _aliasMap.set(id, id);
  }
  return _aliasMap;
}

/**
 * 返回该用户可见的模型 id 集合；返回 null 表示「全部可见，调用方无需过滤」。
 * @param {object|null} sessionUser 已登录用户（需带 allow_all_models 字段）
 */
function resolveVisibleModels(sessionUser) {
  const allowAll = Number(sessionUser && sessionUser.allow_all_models) === 1;
  if (allowAll) return null;
  return new Set(PUBLIC_MODEL_IDS);
}

/**
 * 校验提交上来的模型 id 是否允许。
 * - 未指定 modelId 时放行（沿用服务端默认模型，不阻断旧客户端）；
 * - 不在白名单时抛出带 status=403 的 Error。
 * @param {object} db         保留参数以与调用侧约定一致（当前不直接读库）
 * @param {object|null} sessionUser
 * @param {string} modelId
 */
function assertModelAllowed(db, sessionUser, modelId) {
  if (!modelId) return;
  const visible = resolveVisibleModels(sessionUser);
  if (visible === null) return; // allow_all_models=1：全放行
  const requested = String(modelId);
  const canonical = aliasMap().get(requested);
  if (canonical && visible.has(canonical)) return;
  const err = new Error(`模型 ${requested} 不在当前账号的可用范围内`);
  err.status = 403;
  err.statusCode = 403;
  err.code = 'model_not_allowed';
  throw err;
}

module.exports = {
  PUBLIC_MODEL_IDS,
  resolveVisibleModels,
  assertModelAllowed,
};
