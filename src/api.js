/**
 * 统一 HTTP API 处理器 (API Router & Pure Data Layer)
 * 供独立服务 (server.js /api) 与 DSH Cordis 插件 (index.js /plugins/material/api) 同源复用。
 * 严格两档权限隔离：Viewer 仅保留检索/详情/下载，Admin 享有工作流、适配器、异常治理与账号管理。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Quark, resolveQuarkCli } = require('./quark');
const { searchSimilar, getVectorStatus, embedCaption, storeVector } = require('./vector');
const {
  getDerivatives, getDerivativeById, setMainDerivative, resolveDerivativeFile, ensurePreviewJpeg
} = require('./derivatives');
const {
  parseDerivativeParams,
  isQualifiedAgnes,
  findQualifiedKind,
  pickBrowseMain,
  restageStatusForAsset
} = require('./restage');
const { orientationLabelMap } = require('./ratio');
const { executeAdapter } = require('./gen');
const { AUTH_VISIBLE_SQL } = require('./governance');
const { BROWSE_READY_SQL, PROCESSING_STATUSES, VALID_STATUSES } = require('./asset-status');
const processSvc = require('./process');
const aiTasks = require('./ai-tasks');
const umbra = require('./umbra');
const labSvc = require('./lab');
const portraitLib = require('./portrait-library');
const { assertSeedanceOrEmpty } = require('./portrait-contract');
const auth = require('./auth');
const appUpdate = require('./app-update');
const assetsDelete = require('./assets-delete');
const tagGov = require('./tag-governance');
const genGov = require('./gen-governance');
const { resolveModelCode } = require('./studio-catalog');
const { getCapabilities } = require('./handlers/registry');
const {
  inferRoomTopology,
  generatePascal3DGeometry,
  inferCameraSequence,
  scheduleSeedanceRender,
} = require('./handlers/walkthrough-pipeline');
const mediaTools = require('./media-tools');
const studioPresets = require('./studio-presets');
const menuTree = require('./menu-tree');

// PERF-05：按 db 实例缓存表结构自检结果，避免每个 HTTP 请求重复跑 PRAGMA / 抛异常的 ALTER TABLE。
const dbSchemaCache = new WeakMap();
function schemaCheckedOnce(db, key) {
  let keys = dbSchemaCache.get(db);
  if (!keys) { keys = new Set(); dbSchemaCache.set(db, keys); }
  if (keys.has(key)) return true;
  keys.add(key);
  return false;
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4'
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/**
 * 幂等解码路径参数（fid 等），最多解 3 轮。
 *
 * 背景：部分 fid 为夸克网盘风格，含特殊字符 `|`（如 `~1xxx...|yyy`）。
 * 老版本客户端在 App 原生端从 navigateTo query 拿到的是**未解码**的 `%7C`，
 * 再经 `encodeURIComponent` 变成 `%257C`；服务端只解一次 → 得到字面量 `%7C`
 * → 查不到资产 → 误报 404「资产不存在」。
 *
 * 解到稳定为止后，`%257C` / `%7C` / `|` 三种入参都会收敛到同一个真实 fid，
 * 老版本客户端无需升级即可恢复。
 */
function decodeParamLoose(raw) {
  let s = String(raw == null ? '' : raw);
  for (let i = 0; i < 3; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) break;
    let next;
    try {
      next = decodeURIComponent(s);
    } catch (e) {
      break; // 含非法/不完整转义（如原串本身带 %），原样返回
    }
    if (next === s) break;
    s = next;
  }
  return s;
}

async function executeChatCompletion(db, config, {
  model, messages, images, videos, videoUrls, videoLocalPaths,
  temperature = 0.4, max_tokens = 1024, timeoutMs = 60000, reasoning = null,
}) {
  const { completeChat } = require('./vlm');
  const { resolveLiteLlmChatConfig } = require('./providers');
  const llm = resolveLiteLlmChatConfig(db, config, model);

  const extraImages = Array.isArray(images) ? images.filter(Boolean) : [];
  const videoRefs = [
    ...(Array.isArray(videos) ? videos : []),
    ...(Array.isArray(videoUrls) ? videoUrls : []),
    ...(Array.isArray(videoLocalPaths) ? videoLocalPaths : []),
  ].filter(Boolean);
  if (videoRefs.length) {
    const { framesFromVideoRef } = require('./video-frames');
    const tempDir = path.join(config.dataDir || path.join(__dirname, '..', 'data'), 'cache', 'temp');
    for (let i = 0; i < videoRefs.length; i++) {
      const frames = await framesFromVideoRef(videoRefs[i], tempDir, `chatv_${Date.now()}_${i}`);
      for (const f of frames) extraImages.push(f.dataUrl);
    }
  }

  let msgs = Array.isArray(messages) ? messages.map((m) => ({ ...m })) : [];
  if (extraImages.length) {
    const { chatImageDataUrl } = require('./chat-images');
    const imageParts = [];
    for (const img of extraImages) {
      const url = await chatImageDataUrl(db, config, img);
      if (url) imageParts.push({ type: 'image_url', image_url: { url } });
    }
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      if (typeof lastUser.content === 'string') {
        lastUser.content = [{ type: 'text', text: lastUser.content }, ...imageParts];
      } else if (Array.isArray(lastUser.content)) {
        lastUser.content = [...lastUser.content, ...imageParts];
      } else {
        lastUser.content = imageParts;
      }
    } else {
      msgs.push({ role: 'user', content: imageParts });
    }
  }

  try {
    return await completeChat({
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      messages: msgs,
      temperature,
      max_tokens,
      timeoutMs,
      extraBody: reasoning && typeof reasoning === 'object' ? reasoning : null,
    });
  } catch (e) {
    const msg = String(e.message || e);
    if (/ECONNREFUSED|fetch failed|network|ENOTFOUND|timed out|timeout/i.test(msg)) {
      throw new Error(`LiteLLM 不可用（${llm.baseUrl}）：${msg}`);
    }
    throw e;
  }
}

/**
 * 按模型声明的思考能力组装透传参数。
 * 只接受上层 caps.reasoning 里列出的档位，避免客户端把任意字段塞进上游请求。
 * caps.reasoning.wire：
 *   'reasoning'（默认，豆包等）→ 扁平 { reasoning_effort: level }
 *   'reasoning-object'（Gemini）→ { reasoning: { effort: level } }
 *   LiteLLM 对 Gemini 只在后者形态下返回可读的 message.reasoning_content。
 */
function buildChatReasoningPayload(reasoningCaps, body = {}) {
  if (!reasoningCaps || !reasoningCaps.supported) return null;
  const out = {};
  if (reasoningCaps.mode === 'levels') {
    const level = String(body.reasoning_effort || body.thinkingStrength || reasoningCaps.default || '');
    if (Array.isArray(reasoningCaps.levels) && reasoningCaps.levels.includes(level)) {
      if (reasoningCaps.wire === 'reasoning-object') {
        out.reasoning = { effort: level };
      } else {
        out.reasoning_effort = level;
      }
    }
  } else if (reasoningCaps.mode === 'toggle') {
    const raw = String(body.thinkingStrength || body.thinking || reasoningCaps.default || 'on').toLowerCase();
    const enabled = !['off', 'disabled', 'false', '0', 'none'].includes(raw);
    out.thinking = { type: enabled ? 'enabled' : 'disabled' };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 对话模型的上游超时（毫秒）。
 * Gemini Flash（非 Lite）经 LiteLLM 实测常需 90~140s，放宽到 240s；
 * Flash-Lite 与其它模型保持 90s，让真正的故障尽快失败。
 * 客户端显式传 b.timeoutMs 时以其为准（但不低于默认值，避免被故意设小绕过）。
 */
function chatTimeoutMs(modelCaps, raw) {
  const DEFAULT_MS = 90000;
  const SLOW_MS = 240000;
  const id = String(modelCaps?.modelId || '').toLowerCase();
  const slow = /gemini[_-]?flash(?!.*lite)/.test(id);
  const base = slow ? SLOW_MS : DEFAULT_MS;
  const asked = Number(raw);
  if (Number.isFinite(asked) && asked > 0) return Math.max(asked, base);
  return base;
}

/**
 * 把模型返回的思考内容从正文里拆出来：
 * - Doubao 等走 message.reasoning_content
 * - Gemma 4 把 <thought>…</thought>（或 <thinking>）直接混在 content 里
 * 返回 { content, reasoning }，客户端分别渲染思考块与回答块。
 */
function splitChatThinking(data) {
  const msg = data?.choices?.[0]?.message;
  if (!msg) return data;
  let reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '';
  let content = typeof msg.content === 'string' ? msg.content : '';

  const blockRe = /<(thought|thinking)>([\s\S]*?)<\/\1>/gi;
  content = content.replace(blockRe, (_, __, inner) => {
    if (inner && inner.trim()) reasoning = reasoning ? `${reasoning}\n${inner.trim()}` : inner.trim();
    return '';
  });
  // 未闭合的思考标签：把后半段整体当思考，正文留空由客户端兜底
  const openRe = /<(thought|thinking)>([\s\S]*)$/i;
  const open = content.match(openRe);
  if (open) {
    if (open[2] && open[2].trim()) reasoning = reasoning ? `${reasoning}\n${open[2].trim()}` : open[2].trim();
    content = content.replace(openRe, '');
  }

  content = content.replace(/^\s+|\s+$/g, '');
  reasoning = reasoning.replace(/^\s+|\s+$/g, '');
  msg.content = content;
  if (reasoning) msg.reasoning_content = reasoning;
  else delete msg.reasoning_content;
  data.reasoning = reasoning;
  return data;
}

// 音频等无画面媒体的浏览占位图（sharp 生成，缓存到 thumbs）
async function ensureMediaPlaceholder(services, fid, kind, fileName) {
  const dataDir = services?.config?.dataDir || process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library');
  const out = path.join(dataDir, 'cache', 'thumbs', `${fid}.jpg`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const sharp = require('sharp');
    const isMusic = kind === 'audio' || kind === 'music' || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(fileName || '');
    const label = isMusic ? '♪' : '▶';
    const bg = isMusic ? '#1e293b' : '#334155';
    const svg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
        <rect width="512" height="512" fill="${bg}"/>
        <circle cx="256" cy="230" r="90" fill="none" stroke="#94a3b8" stroke-width="8"/>
        <text x="256" y="250" text-anchor="middle" font-size="96" fill="#e2e8f0" font-family="sans-serif">${label}</text>
        <text x="256" y="380" text-anchor="middle" font-size="28" fill="#94a3b8" font-family="sans-serif">${isMusic ? 'Audio' : 'Media'}</text>
      </svg>
    `);
    await sharp(svg).jpeg({ quality: 80 }).toFile(out);
    return fs.existsSync(out) ? out : null;
  } catch (e) {
    console.warn('[api] 生成媒体占位图失败', fid, e.message);
    return null;
  }
}

// 后台为缺失缩略图的视频抽帧（不阻塞请求）
async function ensureVideoThumbAsync(services, fid, deriv) {
  try {
    const dataDir = services?.config?.dataDir || process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library');
    const out = path.join(dataDir, 'cache', 'thumbs', `${fid}.jpg`);
    if (fs.existsSync(out) && fs.statSync(out).size > 1000) return true;
    const db = services?.db;
    if (!db || !deriv) return false;
    // 已有较大真实缩略图则跳过（占位图通常 < 20KB）
    if (fs.existsSync(out) && fs.statSync(out).size > 20000) return true;
    const vidPath = await resolveDerivativeFile(services, deriv);
    if (!vidPath || !fs.existsSync(vidPath)) return false;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const { extractPoster } = require('./umbra');
    const ok = await extractPoster(vidPath, out);
    return !!(ok && fs.existsSync(out));
  } catch (e) {
    console.warn('[api] 后台视频抽帧失败', fid, e.message);
    return false;
  }
}

function parseBody(req, limit = 2 * 1024 * 1024) {
  return new Promise(resolve => {
    let b = '';
    let overflow = false;
    req.on('data', c => {
      if (overflow) return;
      b += c;
      if (b.length > limit) {
        overflow = true;
        b = '';
        try { req.destroy(); } catch (_) {}
        resolve({ __bodyTooLarge: true });
      }
    });
    req.on('end', () => {
      if (overflow) return;
      try { resolve(b ? JSON.parse(b) : {}); }
      catch { resolve({}); }
    });
    req.on('error', () => { if (!overflow) resolve({}); });
  });
}

function extractToken(req, urlObj, opts = {}) {
  const allowQuery = opts.allowQuery === true;
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();

  const cookie = req.headers.cookie || '';
  const match = cookie.match(/ml_session=([^;]+)/);
  if (match) return match[1];

  // Query token 仅媒体 GET 使用（App <image src>）；敏感接口勿传 token 到 URL
  if (allowQuery) return urlObj.searchParams.get('token') || '';
  return '';
}

// BROWSE_READY_FACET_PATCH：与 queryAssets 默认（all=0）可浏览集合完全一致的口径
//
// 2026-10-03 状态收敛：原先是 5 个状态的 IN 白名单
//   ('ready','ready_with_flags','tagging_done','gating_passed','qc')
// 但实测真实库后 4 个全是 0 条僵尸，且 nodes/index.js 仍在往
// gating_passed / tagging_done 写值 —— 它们在白名单里意味着
// 「流水线跑到一半的半成品素材会被当成可用素材返回」。
// 判据收敛为唯一真源 asset-status.js 的 BROWSE_READY_SQL。
// CONFLICT-002：重复组概念已退役——is_representative / dup_group_id 不再参与可见性。
const BROWSE_READY = `(${BROWSE_READY_SQL} AND ${AUTH_VISIBLE_SQL})`;

let cachedFilterOptions = null;
let cachedFilterOptionsTs = 0;
const FILTER_OPTIONS_TTL_MS = 60000; // 60s 内存缓存

function invalidateFilterOptionsCache() {
  cachedFilterOptions = null;
  cachedFilterOptionsTs = 0;
}

function filterOptions(db, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedFilterOptions && (now - cachedFilterOptionsTs < FILTER_OPTIONS_TTL_MS)) {
    return cachedFilterOptions;
  }

  // 多维主筛选与单品维度：space / style_atom / wood_style / material_kind / orientation / ...
  const primaryDims = [
    'space', 'style_atom', 'wood_style', 'style_region', 'material_kind', 'orientation',
    'furniture_category', 'furniture_item', 'furniture_craft', 'furniture_form', 'classic_design'
  ];
  const out = {};

  // 素材大类统计（全部 / 室内空间 / 独立单品 / 材质纹理 / 建筑室外 / 空间漫游）
  const catRows = db.prepare(`
    SELECT COALESCE(a.category, 'interior') as dir, COUNT(*) as count
    FROM assets a
    WHERE ${BROWSE_READY}
    GROUP BY COALESCE(a.category, 'interior')
  `).all();
  const catLabelMap = {
    interior: '室内空间',
    furniture: '独立单品',
    material: '材质纹理',
    exterior: '建筑室外'
  };
  out.categories = catRows.map(r => ({ dir: r.dir, label: catLabelMap[r.dir] || r.dir, count: r.count }));

  // 统计视频大类数量 (kind=video)
  const videoCountRow = db.prepare(`
    SELECT COUNT(*) as count FROM assets a
    WHERE a.kind = 'video' AND ${AUTH_VISIBLE_SQL}
  `).get();
  const videoCount = videoCountRow?.count || 0;
  out.videoCount = videoCount;
  out.categories.push({ dir: 'video', label: '空间漫游', count: videoCount });

  const musicCountRow = db.prepare(`
    SELECT COUNT(*) as count FROM assets a
    WHERE (a.kind = 'audio' OR a.category = 'music' OR a.file_name LIKE '%.mp3' OR a.file_name LIKE '%.wav') AND ${AUTH_VISIBLE_SQL}
  `).get();
  out.musicCount = musicCountRow?.count || 0;

  const portraitCountRow = db.prepare(`
    SELECT COUNT(*) as count FROM assets a
    WHERE a.category = 'portrait' AND ${AUTH_VISIBLE_SQL}
  `).get();
  out.portraitCount = portraitCountRow?.count || 0;

  const retouchedCountRow = db.prepare(`
    SELECT COUNT(DISTINCT a.fid) as count FROM assets a
    JOIN derivatives d ON d.asset_fid = a.fid
    WHERE d.kind IN ('style_transferred', 'quick_replace', 'quick_remove', 'quick_insert', 'clarity_enhanced', 'expand', 'retouched', 'manual_edit') AND ${AUTH_VISIBLE_SQL} AND ${BROWSE_READY}
  `).get();
  out.retouchedCount = retouchedCountRow?.count || 0;

  // 需要特殊结构（materials_hard/soft、wood_style 兼容、画幅标签映射）的维度单独处理；
  // 其余普通标签维度合并为 1 条批量聚合 SQL（PERF-07）。
  const specialDims = new Set(['orientation', 'material_kind', 'style_atom', 'wood_style']);

  if (primaryDims.includes('orientation')) {
    const rows = db.prepare(`
      SELECT '9:16' as dir, COUNT(*) as c FROM assets a
      WHERE ${BROWSE_READY} AND
        (a.origin_orientation = '9:16' OR a.fid IN (SELECT asset_fid FROM derivatives WHERE kind = 'restage_9_16'))
      UNION ALL
      SELECT '3:4' as dir, COUNT(*) as c FROM assets a
      WHERE ${BROWSE_READY} AND
        (a.origin_orientation = '3:4' OR a.fid IN (SELECT asset_fid FROM derivatives WHERE kind = 'restage_3_4'))
      UNION ALL
      SELECT a.origin_orientation as dir, COUNT(*) as c FROM assets a
      WHERE ${BROWSE_READY} AND a.origin_orientation IS NOT NULL
        AND a.origin_orientation NOT IN ('9:16','3:4')
      GROUP BY a.origin_orientation
      ORDER BY c DESC
    `).all();
    const labelMap = orientationLabelMap();
    out.orientation = rows
      .filter(r => r.c > 0)
      .map(r => ({ dir: r.dir, label: labelMap[r.dir] || r.dir, count: r.c }));
  }

  if (primaryDims.includes('material_kind')) {
    const rows = db.prepare(`
      SELECT t.dir, t.label, COUNT(DISTINCT at.asset_fid) as count
      FROM tag_dict t
      JOIN asset_tags at ON at.tag_id = t.id
      JOIN assets a ON a.fid = at.asset_fid
      WHERE t.dimension = ? AND (t.deprecated IS NULL OR t.deprecated = 0) AND ${BROWSE_READY}
      GROUP BY t.id HAVING count > 0
      ORDER BY count DESC
    `).all('material_kind');
    const { getMaterialGroup } = require('./tags-seed');
    out.material_kind = rows.map(r => ({
      ...r,
      group: getMaterialGroup(r.dir)
    }));
    out.materials_hard = out.material_kind.filter(r => r.group === 'hard');
    out.materials_soft = out.material_kind.filter(r => r.group === 'soft');
  }

  if (primaryDims.includes('style_atom')) {
    out.style_atom = db.prepare(`
      SELECT t.dir, t.label, t.parent_dir as region, COUNT(DISTINCT a.fid) as count
      FROM tag_dict t
      LEFT JOIN asset_tags at ON at.tag_id = t.id
      LEFT JOIN assets a ON a.fid = at.asset_fid AND ${BROWSE_READY}
      WHERE t.dimension = 'style_atom' AND (t.deprecated IS NULL OR t.deprecated = 0)
      GROUP BY t.id
      ORDER BY count DESC, t.id ASC
    `).all();
    // 向后兼容旧客户端对 wood_style 的读取
    out.wood_style = out.style_atom.filter(r => r.region === 'wood_system');
  } else if (primaryDims.includes('wood_style') && !out.wood_style) {
    // 保持空或已由 style_atom.wood_system 供给
    out.wood_style = (out.style_atom || []).filter(r => r.region === 'wood_system');
  }

  const normalDims = primaryDims.filter(d => !specialDims.has(d));
  if (normalDims.length) {
    const ph = normalDims.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT t.dimension, t.dir, t.label, COUNT(DISTINCT at.asset_fid) as count
      FROM tag_dict t
      JOIN asset_tags at ON at.tag_id = t.id
      JOIN assets a ON a.fid = at.asset_fid
      WHERE t.dimension IN (${ph}) AND (t.deprecated IS NULL OR t.deprecated = 0) AND ${BROWSE_READY}
      GROUP BY t.dimension, t.id HAVING count > 0
      ORDER BY t.dimension ASC, count DESC
    `).all(...normalDims);
    for (const d of normalDims) out[d] = [];
    for (const r of rows) {
      if (!out[r.dimension]) out[r.dimension] = [];
      out[r.dimension].push({ dir: r.dir, label: r.label, count: r.count });
    }
  }

  // 12 室内设计主色统计（从 assets.dominant_color 唯一主色统计）
  const dominantColorRows = db.prepare(`
    SELECT a.dominant_color as dir, a.dominant_color as label, COUNT(*) as count
    FROM assets a
    WHERE a.dominant_color IS NOT NULL AND a.dominant_color != '' AND ${BROWSE_READY}
    GROUP BY a.dominant_color HAVING count > 0
    ORDER BY count DESC
  `).all();
  out.colors = dominantColorRows;

  cachedFilterOptions = out;
  cachedFilterOptionsTs = now;
  return out;
}

function ensureAssetShelfColumns(db) {
  if (schemaCheckedOnce(db, 'shelf_cols')) return;
  const names = new Set(db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name));
  if (!names.has('library_shelf')) {
    db.exec("ALTER TABLE assets ADD COLUMN library_shelf TEXT DEFAULT 'original'");
  }
  if (!names.has('category_locked')) {
    db.exec('ALTER TABLE assets ADD COLUMN category_locked INTEGER DEFAULT 0');
  }
  if (!names.has('lineage_json')) {
    db.exec('ALTER TABLE assets ADD COLUMN lineage_json TEXT');
  }
}

function queryAssets(db, query = {}) {
  try { ensureAssetShelfColumns(db); } catch (_) {}
  const {
    keyword, category, space, style, wood_style: woodStyle, style_region: styleRegion,
    material, materials, orientation,
    color_style, colors, flags, region, tone,
    furniture_category, furniture_item, furniture_craft, furniture_form, classic_design,
    palette, luxury, era, temperature, functional,
    media_type: mediaType, video_source: videoSource,
    page = 1, pageSize = 24, all = 0, sort, skip_facets
  } = query;

  // 列表可见判据与筛选项/详情统一（BROWSE_READY_SQL = "a.status = 'ready'"）
  const where = [BROWSE_READY_SQL, AUTH_VISIBLE_SQL];
  const args = [];

  // media_type: image | video | furniture | music | portrait | clothing | material | favorite | retouched | finished | interior_design
  try { require('./favorites').ensureFavoriteColumn(db); } catch (_) {}
  const isOnlyFavorite = (
    String(query.only_favorite || '') === '1' || query.only_favorite === true ||
    String(query.favorite || '') === '1' || query.favorite === true ||
    mediaType === 'favorite'
  );
  if (isOnlyFavorite) {
    where.push('a.favorited_at IS NOT NULL');
  }

  const effectiveCat = category || (mediaType !== 'favorite' ? mediaType : null);
  if (effectiveCat === 'favorites' || effectiveCat === 'all_favorites') {
    if (!isOnlyFavorite) where.push('a.favorited_at IS NOT NULL');
  } else if (effectiveCat === 'interior_design' || effectiveCat === 'interior' || effectiveCat === 'interior_exterior') {
    where.push("(a.kind = 'image' AND COALESCE(a.category, 'interior') IN ('interior', 'exterior'))");
  } else if (effectiveCat === 'exterior') {
    where.push("a.category = 'exterior'");
  } else if (effectiveCat === 'finished') {
    where.push("a.category = 'finished'");
  } else if (effectiveCat === 'clothing') {
    where.push("a.category = 'clothing'");
  } else if (effectiveCat === 'portrait') {
    where.push("a.category = 'portrait'");
  } else if (effectiveCat === 'furniture') {
    where.push("(a.category = 'furniture' OR a.kind = 'furniture')");
  } else if (effectiveCat === 'portrait_dynamic') {
    where.push("(a.kind = 'video' OR a.kind = 'audio' OR COALESCE(a.category, '') IN ('portrait', 'finished', 'music', 'video'))");
  } else if (effectiveCat === 'retouched') {
    where.push("a.fid IN (SELECT asset_fid FROM derivatives WHERE kind IN ('style_transferred', 'quick_replace', 'quick_remove', 'quick_insert', 'clarity_enhanced', 'expand', 'retouched', 'manual_edit'))");
  } else if (effectiveCat === 'video') {
    where.push("a.kind = 'video'");
  } else if (effectiveCat === 'music' || effectiveCat === 'audio') {
    where.push("(a.kind = 'audio' OR a.category = 'music' OR a.file_name LIKE '%.mp3' OR a.file_name LIKE '%.wav' OR a.file_name LIKE '%.m4a')");
  } else if (effectiveCat === 'image') {
    where.push("a.kind = 'image'");
  } else if (category && !['furniture', 'music', 'portrait', 'clothing', 'finished', 'retouched', 'interior_design', 'interior', 'exterior', 'interior_exterior', 'favorites', 'all_favorites'].includes(category)) {
    where.push("COALESCE(a.category, 'interior') = ?");
    args.push(category);
  }

  const shelf = String(query.shelf || '').trim();
  if (shelf === 'finished') {
    where.push("(a.category = 'finished' OR a.library_shelf = 'finished')");
  } else if (shelf === 'retouched') {
    where.push("(a.library_shelf = 'retouched' OR a.is_ai = 1 OR (a.source_asset_id IS NOT NULL AND a.source_asset_id != ''))");
  } else if (shelf === 'original') {
    where.push("COALESCE(a.category, '') != 'finished'");
    where.push("(a.library_shelf IS NULL OR a.library_shelf = '' OR a.library_shelf = 'original')");
    where.push("(a.is_ai IS NULL OR a.is_ai = 0)");
    where.push("(a.source_asset_id IS NULL OR a.source_asset_id = '')");
  }

  // video_source: all | sync（手机实拍 is_ai=0）| ai（AI创作 is_ai=1）
  const favoriteWithin = String(query.favorite_within || '');
  if ((isOnlyFavorite || effectiveCat === 'favorites' || effectiveCat === 'all_favorites') && favoriteWithin) {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const start = favoriteWithin === 'today'
      ? startOfToday.getTime()
      : favoriteWithin === '7d'
        ? now - 7 * 86400000
        : favoriteWithin === '30d'
          ? now - 30 * 86400000
          : 0;
    if (start) {
      where.push('a.favorited_at >= ?');
      args.push(start);
    }
  }

  if (effectiveCat === 'video' || videoSource) {
    if (videoSource === 'sync') {
      where.push('(a.is_ai IS NULL OR a.is_ai = 0)');
    } else if (videoSource === 'ai') {
      where.push('a.is_ai = 1');
    }
  }

  if (!all) {
    // CONFLICT-002：重复组已退役，不再隐藏任何素材。
  }

  // 精准日期过滤 (YYYY-MM-DD 或 YYYY-MM)
  if (query.date) {
    const dStr = String(query.date).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
      const [y, m, d] = dStr.split('-').map(Number);
      const startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
      const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
      where.push('a.created_at >= ? AND a.created_at <= ?');
      args.push(startOfDay, endOfDay);
    } else if (/^\d{4}-\d{2}$/.test(dStr)) {
      const [y, m] = dStr.split('-').map(Number);
      const startOfMonth = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
      const endOfMonth = new Date(y, m, 0, 23, 59, 59, 999).getTime();
      where.push('a.created_at >= ? AND a.created_at <= ?');
      args.push(startOfMonth, endOfMonth);
    }
  }

  // 相对时间范围（剪辑器素材库选择器使用）：7d / 30d / all，按入库时间倒推自然天数。
  // 与精确 date 互斥，传了 date 时以 date 为准，避免两套时间条件互相裁剪。
  const createdWithin = String(query.created_within || '').trim();
  if (!query.date && (createdWithin === '7d' || createdWithin === '30d')) {
    const days = createdWithin === '7d' ? 7 : 30;
    where.push('COALESCE(a.created_at, a.discovered_at, 0) >= ?');
    args.push(Date.now() - days * 86400000);
  }

  const addTagFilter = (dim, val) => {
    if (!val) return;
    const list = (Array.isArray(val) ? val : String(val).split(','))
      .map(s => s.trim())
      .filter(Boolean);
    if (!list.length) return;
    if (list.length === 1) {
      where.push(`
        a.fid IN (
          SELECT at.asset_fid FROM asset_tags at
          JOIN tag_dict t ON t.id = at.tag_id
          WHERE t.dimension = ? AND (t.dir = ? OR t.label = ?)
        )
      `);
      args.push(dim, list[0], list[0]);
    } else {
      const conds = list.map(() => '(t.dir = ? OR t.label = ?)').join(' OR ');
      where.push(`
        a.fid IN (
          SELECT at.asset_fid FROM asset_tags at
          JOIN tag_dict t ON t.id = at.tag_id
          WHERE t.dimension = ? AND (${conds})
        )
      `);
      args.push(dim);
      for (const item of list) {
        args.push(item, item);
      }
    }
  };

  addTagFilter('space', space);
  addTagFilter('style_atom', style);
  if (woodStyle) {
    // 兼容旧 wood_style 入参，映射到已合并的 style_atom 及旧 wood_style
    addTagFilter('style_atom', woodStyle);
    addTagFilter('wood_style', woodStyle);
  }
  // 大区筛选：资产挂 style_atom 叶子，经 parent_dir 归属大区
  if (styleRegion) {
    const regions = (Array.isArray(styleRegion) ? styleRegion : String(styleRegion).split(','))
      .map(s => s.trim()).filter(Boolean);
    if (regions.length) {
      const conds = regions.map(() => '(t.parent_dir = ? OR rt.dir = ? OR rt.label = ?)').join(' OR ');
      where.push(`
        a.fid IN (
          SELECT at.asset_fid FROM asset_tags at
          JOIN tag_dict t ON t.id = at.tag_id
          LEFT JOIN tag_dict rt ON rt.dimension = 'style_region' AND (rt.dir = t.parent_dir OR rt.label = t.parent_dir)
          WHERE t.dimension = 'style_atom' AND (${conds})
        )
      `);
      for (const r of regions) args.push(r, r, r);
    }
  }

  // 材质多选 AND 严格过滤（同时包含所有已选材质）
  const matParam = materials || material;
  if (matParam) {
    const matList = (Array.isArray(matParam) ? matParam : String(matParam).split(','))
      .map(s => s.trim())
      .filter(Boolean);
    for (const m of matList) {
      where.push(`
        a.fid IN (
          SELECT at.asset_fid FROM asset_tags at
          JOIN tag_dict t ON t.id = at.tag_id
          WHERE t.dimension = 'material_kind' AND (t.dir = ? OR t.label = ?)
        )
      `);
      args.push(m, m);
    }
  }

  addTagFilter('color_style', color_style);
  addTagFilter('flags', flags);
  addTagFilter('region', region);
  addTagFilter('tone', tone);
  addTagFilter('furniture_category', furniture_category);
  addTagFilter('furniture_item', furniture_item);
  addTagFilter('furniture_craft', furniture_craft);
  addTagFilter('furniture_form', furniture_form);
  addTagFilter('classic_design', classic_design);
  addTagFilter('palette', palette);
  addTagFilter('luxury', luxury);
  addTagFilter('era', era);
  addTagFilter('temperature', temperature);
  addTagFilter('functional', functional);
  addTagFilter('mood', query.mood);
  addTagFilter('genre', query.genre);
  addTagFilter('pose', query.pose);
  addTagFilter('character', query.character);
  addTagFilter('gender', query.gender);
  addTagFilter('person_style', query.person_style);
  addTagFilter('shot_type', query.shot_type);
  addTagFilter('clothing_category', query.clothing_category);
  addTagFilter('clothing_style', query.clothing_style);
  addTagFilter('season', query.season);

  const derivativeKind = query.derivative_kind || query.deriv_kind;
  if (derivativeKind && effectiveCat === 'retouched') {
    const kinds = (Array.isArray(derivativeKind) ? derivativeKind : String(derivativeKind).split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    if (kinds.length) {
      where.push(`a.fid IN (SELECT asset_fid FROM derivatives WHERE kind IN (${kinds.map(() => '?').join(',')}))`);
      args.push(...kinds);
    }
  }

  // 12 室内设计主色检索：支持单选或多选匹配
  const targetColor = colors || query.color;
  if (targetColor) {
    const colorList = (Array.isArray(targetColor) ? targetColor : String(targetColor).split(','))
      .map(s => s.trim())
      .filter(Boolean);
    if (colorList.length === 1) {
      where.push('a.dominant_color = ?');
      args.push(colorList[0]);
    } else if (colorList.length > 1) {
      const qmarks = colorList.map(() => '?').join(',');
      where.push(`a.dominant_color IN (${qmarks})`);
      args.push(...colorList);
    }
  }


  if (orientation) {
    if (orientation === '9:16') {
      where.push(`(a.origin_orientation = '9:16' OR a.fid IN (SELECT asset_fid FROM derivatives WHERE kind = 'restage_9_16'))`);
    } else if (orientation === '3:4') {
      where.push(`(a.origin_orientation = '3:4' OR a.fid IN (SELECT asset_fid FROM derivatives WHERE kind = 'restage_3_4'))`);
    } else {
      where.push('a.origin_orientation = ?');
      args.push(orientation);
    }
  }

  // q 为 keyword 的短别名：剪辑器素材库选择器统一用 q 下发关键词，
  // 两种写法语义完全一致（文件名 + 标签 label/dir），keyword 仍优先。
  const keywordValue = keyword || query.q;
  if (keywordValue) {
    where.push(`
      (a.file_name LIKE ? OR a.fid IN (
        SELECT at.asset_fid FROM asset_tags at
        JOIN tag_dict t ON t.id = at.tag_id
        WHERE t.label LIKE ? OR t.dir LIKE ?
      ))
    `);
    args.push(`%${keywordValue}%`, `%${keywordValue}%`, `%${keywordValue}%`);
  }

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM assets a WHERE ${whereSql}`).get(...args).c;

  const p = Math.max(1, +page || 1);
  const ps = Math.max(1, Math.min(100, +pageSize || 24));
  const offset = (p - 1) * ps;

  // 排序：默认时间倒序（最新优先），与移动端相册时间线对齐展示今天、昨天、……；
  // 可选 sort=earliest（时间正序）、sort=recommend（AI重构与画幅优先）
  let orderSql = `COALESCE(a.created_at, a.discovered_at, 0) DESC, (CASE WHEN EXISTS (SELECT 1 FROM derivatives d WHERE d.asset_fid = a.fid AND d.kind IN ('restage_dual', 'restage_9_16', 'restage_3_4')) THEN 0 ELSE 1 END) ASC, a.fid DESC`;
  // 显式排序优先于「收藏/精修」的默认排序：调用方传了 name / size 就是要按它排。
  // 这两个值只影响新调用方，latest / earliest / recommend 的既有分支保持不变。
  if (sort === 'name') {
    orderSql = 'a.file_name COLLATE NOCASE ASC, a.fid ASC';
  } else if (sort === 'size') {
    orderSql = 'COALESCE(a.size, 0) DESC, a.fid DESC';
  } else if (isOnlyFavorite || mediaType === 'favorite' || mediaType === 'favorites' || mediaType === 'all_favorites') {
    orderSql = 'a.favorited_at DESC, a.fid DESC';
  } else if (mediaType === 'retouched' || category === 'retouched') {
    orderSql = `(SELECT COALESCE(MAX(created_at), 0) FROM derivatives WHERE asset_fid = a.fid AND kind IN ('style_transferred', 'quick_replace', 'quick_remove', 'quick_insert', 'clarity_enhanced', 'expand', 'retouched', 'manual_edit')) DESC, a.fid DESC`;
  } else if (sort === 'earliest') {
    orderSql = 'COALESCE(a.created_at, a.discovered_at, 0) ASC, a.fid ASC';
  } else if (sort === 'recommend') {
    orderSql = `
      (CASE WHEN EXISTS (SELECT 1 FROM derivatives d WHERE d.asset_fid = a.fid AND d.kind IN ('restage_dual', 'restage_9_16', 'restage_3_4')) THEN 0 ELSE 1 END) ASC,
      (CASE WHEN a.has_watermark = 0 AND (a.origin_orientation IN ('9:16', '3:4')) THEN 0
            WHEN a.has_watermark = 0 THEN 1
            ELSE 2 END) ASC,
      COALESCE(a.created_at, a.discovered_at, 0) DESC,
      a.fid DESC`;
  }

  const items = db.prepare(`
    SELECT a.fid, a.file_name, a.width, a.height, a.orientation, a.origin_orientation,
           COALESCE(a.category, 'interior') AS category, a.dominant_color,
           a.thumb_url, a.main_derivative_id, a.status, a.ready_flags,
           a.has_watermark, a.auth_state, COALESCE(a.created_at, a.discovered_at, 0) AS created_at,
           a.kind, a.is_ai, a.source_asset_id, a.poster_path, a.duration_s, a.size,
           a.phash, a.md5, a.sha256, a.favorited_at
    FROM assets a
    WHERE ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ? OFFSET ?
  `).all(...args, ps, offset);

  // 批量消除 N+1 查询：将 96 次循环单条 SQL 压降为 4 次批量查询
  if (items.length > 0) {
    const fids = items.map(it => it.fid);
    const placeholders = fids.map(() => '?').join(',');

    // 1. 批量获取 tags
    const allTags = db.prepare(`
      SELECT at.asset_fid, t.dimension, t.dir, t.label, at.role, at.source
      FROM asset_tags at
      JOIN tag_dict t ON t.id = at.tag_id
      WHERE at.asset_fid IN (${placeholders})
    `).all(...fids);
    const tagsByFid = new Map();
    for (const t of allTags) {
      if (!tagsByFid.has(t.asset_fid)) tagsByFid.set(t.asset_fid, []);
      tagsByFid.get(t.asset_fid).push({
        dimension: t.dimension,
        dir: t.dir,
        label: t.label,
        role: t.role,
        source: t.source
      });
    }

    // 2. 批量获取 colors
    const allColors = db.prepare(`
      SELECT asset_fid, hex, role, name, weight, basic_color
      FROM asset_colors
      WHERE asset_fid IN (${placeholders})
    `).all(...fids);
    const colorsByFid = new Map();
    for (const c of allColors) {
      if (!colorsByFid.has(c.asset_fid)) colorsByFid.set(c.asset_fid, []);
      colorsByFid.get(c.asset_fid).push({
        hex: c.hex,
        role: c.role,
        name: c.name,
        weight: c.weight,
        basic_color: c.basic_color
      });
    }

    // 3. 批量获取 derivatives
    const allDerivs = db.prepare(`
      SELECT id, asset_fid, kind, storage_type, storage_ref, width, height, mime, params, phash, md5, sha256
      FROM derivatives
      WHERE asset_fid IN (${placeholders})
    `).all(...fids);
    const derivsByFid = new Map();
    const derivById = new Map();
    for (const d of allDerivs) {
      if (!derivsByFid.has(d.asset_fid)) derivsByFid.set(d.asset_fid, []);
      derivsByFid.get(d.asset_fid).push(d);
      derivById.set(d.id, d);
    }

    // CONFLICT-002：重复组退役，dupCount 批量统计已移除（列表恒为独立素材）。

    // 5. 批量获取 AI 产物的母素材 source_asset
    const sourceFids = [...new Set(items.map(it => it.source_asset_id).filter(Boolean))];
    const sourceMap = new Map();
    if (sourceFids.length > 0) {
      const sp = sourceFids.map(() => '?').join(',');
      const sources = db.prepare(`
        SELECT a.fid, a.file_name, a.width, a.height, a.main_derivative_id, a.thumb_url,
               COALESCE(a.created_at, a.discovered_at, 0) AS created_at
        FROM assets a
        WHERE a.fid IN (${sp})
      `).all(...sourceFids);
      const sourceTags = db.prepare(`
        SELECT at.asset_fid, t.label
        FROM asset_tags at
        JOIN tag_dict t ON t.id = at.tag_id
        WHERE at.asset_fid IN (${sp})
      `).all(...sourceFids);
      const tagsOf = new Map();
      for (const st of sourceTags) {
        if (!tagsOf.has(st.asset_fid)) tagsOf.set(st.asset_fid, []);
        tagsOf.get(st.asset_fid).push(st.label);
      }
      for (const s of sources) {
        const labels = tagsOf.get(s.fid) || [];
        sourceMap.set(s.fid, {
          fid: s.fid,
          fileName: s.file_name,
          file_name: s.file_name,
          imgUrl: `/api/viewer/assets/${encodeURIComponent(s.fid)}/image`,
          tagsText: labels.join(' · '),
          tags: labels,
          main_derivative_id: s.main_derivative_id,
          width: s.width,
          height: s.height
        });
      }
    }

    // 组装回 items
    for (const it of items) {
      it.tags = tagsByFid.get(it.fid) || [];
      it.colors = colorsByFid.get(it.fid) || [];
      const derivs = derivsByFid.get(it.fid) || [];

      const explicitMain = it.main_derivative_id ? (derivById.get(it.main_derivative_id) || null) : null;
      let picked = explicitMain || pickBrowseMain(derivs, { orientation });
      if ((mediaType === 'retouched' || category === 'retouched') && derivs.length > 0) {
        const retouchedList = derivs.filter(d => ['style_transferred', 'quick_replace', 'quick_remove', 'quick_insert', 'clarity_enhanced', 'expand', 'retouched', 'manual_edit'].includes(d.kind)).sort((a, b) => (b.id || 0) - (a.id || 0));
        if (retouchedList.length > 0) picked = retouchedList[0];
      }
      if (picked) {
        it.mainDerivative = picked;
        it.main_derivative_id = picked.id;
        it.main_derivative_kind = picked.kind;
      } else {
        it.mainDerivative = it.main_derivative_id ? (derivById.get(it.main_derivative_id) || null) : null;
      }

      // CONFLICT-002：重复组退役，dupCount 恒为 1（兼容旧客户端字段）
      it.dupCount = 1;
      try { it.readyFlags = JSON.parse(it.ready_flags || '[]'); } catch { it.readyFlags = []; }
      it.mediaToken = auth.generateMediaToken(it.fid, 900);

      it.media_type = it.kind === 'video' ? 'video'
        : (it.kind === 'audio' || it.category === 'music' ? 'music'
        : (it.category === 'portrait' ? 'portrait'
        : (it.category === 'clothing' ? 'clothing'
        : (it.category === 'material' ? 'material'
        : (it.category === 'furniture' ? 'furniture' : 'image')))));
      it.is_ai = it.is_ai ? 1 : 0;
      it.duration = it.duration_s || 0;
      it.poster_url = it.poster_path
        ? `/api/viewer/assets/${encodeURIComponent(it.fid)}/poster`
        : (it.kind === 'video' ? `/api/viewer/assets/${encodeURIComponent(it.fid)}/poster` : '');
      it.source_asset = it.source_asset_id ? (sourceMap.get(it.source_asset_id) || null) : null;
    }
  }

  return {
    items,
    total,
    page: p,
    pageSize: ps,
    filterOptions: skip_facets === '1' ? undefined : filterOptions(db)
  };
}

/**
 * 回收站素材的文件回读。
 *
 * 软删时原文件被 rename 到 dataDir/trash/，但 derivatives.storage_ref 仍指向原路径，
 * 所以 /image 解析不到。回收站详情页要能预览，就从这里兜底读回。
 * 命中返回 true（已写响应），未命中返回 false 交给调用方走 404。
 */
function serveFromTrash(services, fid, res) {
  const { db, config } = services;
  if (!config?.dataDir) return false;
  let row = null;
  try {
    row = db.prepare('SELECT trash_rel FROM asset_trash WHERE fid=? ORDER BY id DESC LIMIT 1').get(fid);
  } catch (_) { return false; }
  if (!row?.trash_rel) return false;
  const p = row.trash_rel.includes('/') || row.trash_rel.includes('\\')
    ? (require('path').isAbsolute(row.trash_rel) ? row.trash_rel : require('path').join(config.dataDir, row.trash_rel))
    : row.trash_rel;
  if (!fs.existsSync(p)) return false;
  let buf = null;
  try { buf = fs.readFileSync(p); } catch (_) { return false; }
  if (!buf || !buf.length) return false;
  const ext = String(p).split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': buf.length,
    'Cache-Control': 'private, max-age=300',
  });
  res.end(buf);
  return true;
}

/**
 * 素材详情。
 *
 * 可见性判据与列表统一（2026-10-02 状态统一机制）：
 * 列表只出 BROWSE_READY 的素材，详情也必须用同一套 status 白名单，
 * 否则会出现「详情 200 但文件已被移走 → 前端空图/加载失败」，
 * 比直接 404 更难排查。
 *
 * 内部编排调用（如 AI 编辑流水线回读母素材）传 allowNonReady=true 走旁路，
 * 因为那些流程本来就在处理中间态素材。
 */
function getAssetDetail(services, fid, { allowNonReady = false, includeSimilar = false } = {}) {
  const { db } = services;
  const statusSql = allowNonReady ? '' : ' AND ' + BROWSE_READY_SQL;
  const asset = db.prepare('SELECT * FROM assets a WHERE a.fid = ? AND ' + AUTH_VISIBLE_SQL + statusSql).get(fid);
  if (!asset) return null;

  try { asset.readyFlags = JSON.parse(asset.ready_flags || '[]'); } catch { asset.readyFlags = []; }
  asset.category = asset.category || 'interior';
  asset.dominant_color = asset.dominant_color || '';
  asset.media_type = asset.kind === 'video' ? 'video'
    : (asset.kind === 'audio' || asset.category === 'music' ? 'music'
    : (asset.category === 'portrait' ? 'portrait'
    : (asset.category === 'furniture' ? 'furniture' : 'image')));
  asset.is_ai = asset.is_ai ? 1 : 0;
  asset.duration = asset.duration_s || 0;
  asset.poster_url = asset.poster_path || asset.kind === 'video'
    ? `/api/viewer/assets/${encodeURIComponent(fid)}/poster`
    : '';

  // AI 产物：挂母素材卡片
  let source_asset = null;
  if (asset.source_asset_id) {
    const s = db.prepare(`
      SELECT fid, file_name, width, height, main_derivative_id, thumb_url
      FROM assets WHERE fid=?
    `).get(asset.source_asset_id);
    if (s) {
      const sLabels = db.prepare(`
        SELECT t.label FROM asset_tags at
        JOIN tag_dict t ON t.id = at.tag_id
        WHERE at.asset_fid = ?
      `).all(s.fid).map(r => r.label);
      source_asset = {
        fid: s.fid,
        fileName: s.file_name,
        file_name: s.file_name,
        imgUrl: `/api/viewer/assets/${encodeURIComponent(s.fid)}/image`,
        tagsText: sLabels.join(' · '),
        tags: sLabels.map(label => ({ label })),
        main_derivative_id: s.main_derivative_id,
        width: s.width,
        height: s.height
      };
    }
  }
  asset.source_asset = source_asset;

  const tags = db.prepare(`
    SELECT t.dimension, t.dir, t.label, at.role, at.source FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id WHERE at.asset_fid = ?
  `).all(fid);

  const colors = db.prepare('SELECT hex, role, name, weight, basic_color FROM asset_colors WHERE asset_fid = ?').all(fid);
  const derivatives = getDerivatives(db, fid);

  // CONFLICT-002：重复组概念已退役，组员/组长查询全部移除。

  // PERF-01：详情弹窗默认不阻塞在同步全表相似计算上；
  // 仅当显式 include_similar=1（或内部明确需要）时才计算。
  const similar = includeSimilar ? searchSimilar(services, fid, { limit: 8 }) : [];
  const originIdStmt = db.prepare("SELECT id FROM derivatives WHERE asset_fid=? AND kind='origin' LIMIT 1");
  for (const s of similar || []) {
    const sfid = s.fid || s.asset_fid;
    if (sfid) s.origin_derivative_id = originIdStmt.get(sfid)?.id || null;
  }

  const parsedDerivs = (derivatives || []).map(d => {
    const params = parseDerivativeParams(d);
    return { ...d, params, generated: isQualifiedAgnes({ ...d, params }) };
  });

  // CONFLICT-002：重复组退役，血缘归属就是素材本身
  const restageOwnerFid = asset.fid;
  let restageOwnerDerivs = parsedDerivs;
  if (restageOwnerFid && restageOwnerFid !== fid) {
    restageOwnerDerivs = (getDerivatives(db, restageOwnerFid) || []).map(d => {
      const params = parseDerivativeParams(d);
      return { ...d, params, generated: isQualifiedAgnes({ ...d, params }), ownerFid: restageOwnerFid };
    });
  }

  const displayDerivs = parsedDerivs.filter(d => !String(d.kind || '').startsWith('restage_') || isQualifiedAgnes(d));
  for (const kind of ['restage_9_16', 'restage_3_4']) {
    if (!findQualifiedKind(displayDerivs, kind)) {
      const shared = findQualifiedKind(restageOwnerDerivs, kind);
      if (shared) displayDerivs.push({ ...shared, sharedFromRepresentative: restageOwnerFid !== fid, ownerFid: restageOwnerFid });
    }
  }

  const restageStatus = restageStatusForAsset(db, asset, restageOwnerDerivs);
  let lineage = null;
  try {
    lineage = require('./shelf-lineage').lineageTree(db, fid);
  } catch (e) {
    lineage = null;
  }

  return {
    asset,
    tags,
    colors,
    lineage,
    derivatives: displayDerivs,
    allDerivatives: parsedDerivs,
    restageOwnerFid,
    restageStatus,
    // CONFLICT-002：重复组退役，组员/组原因字段保留为空以兼容旧客户端
    dupMembers: [],
    similar,
    matchReason: null
  };
}

function getStats(db) {
  // 2026-10-03 状态收敛：原先统计 ready_with_flags / tagging_done / frozen
  // 三个零数据僵尸字段，永远返回 0，纯属误导。改为按 asset-status.js 的
  // 有效状态集统计，并显式暴露 unknownStatus 便于发现脏数据。
  const base = {
    total: db.prepare('SELECT COUNT(*) c FROM assets').get().c,
    ready: db.prepare("SELECT COUNT(*) c FROM assets WHERE status='ready'").get().c,
    readyWithFlags: db.prepare("SELECT COUNT(*) c FROM assets WHERE status='ready_with_flags'").get().c,
    processing: db.prepare("SELECT COUNT(*) c FROM assets WHERE status IN ('discovered','processing')").get().c,
    rejected: db.prepare("SELECT COUNT(*) c FROM assets WHERE status='rejected'").get().c,
    deleted: db.prepare("SELECT COUNT(*) c FROM assets WHERE status='deleted'").get().c,
    images: db.prepare("SELECT COUNT(*) c FROM assets WHERE kind='image'").get().c,
    queuedNodeRuns: db.prepare("SELECT COUNT(*) c FROM node_runs WHERE status IN ('queued','running')").get().c,
    failedNodeRuns: db.prepare("SELECT COUNT(*) c FROM node_runs WHERE status='failed'").get().c,
    // 待治理失败数：与 /exceptions 的 actionable 口径完全一致（存活资产 + 最新运行仍失败
    // + 近 7 天 + 偶发错误 + 非废弃来源）。顶栏卡片必须等于清单条数，否则会出现「卡片 2810 / 清单 28」
    // 这种自相矛盾、让人怀疑治理台漏报的数字。
    actionableFailedRuns: (() => {
      const { isTransientErrorText, isDeterministicErrorText } = require('./nodes/index');
      const rows = db.prepare(`
        SELECT nr.error, COALESCE(a.source,'') as source FROM node_runs nr
        JOIN (
          SELECT asset_fid, node_id, MAX(id) as mid FROM node_runs
          WHERE updated_at >= ? OR updated_at IS NULL
          GROUP BY asset_fid, node_id
        ) x ON x.mid = nr.id
        JOIN assets a ON a.fid = nr.asset_fid
        LEFT JOIN asset_trash t ON t.fid = a.fid
        LEFT JOIN (SELECT DISTINCT fid FROM asset_blacklist) b ON b.fid = a.fid
        WHERE nr.status = 'failed'
          AND t.fid IS NULL AND b.fid IS NULL
          AND COALESCE(a.status, '') NOT IN ('deleted','rejected','excluded')
        LIMIT 300
      `).all(Date.now() - 7 * 86400000);
      return rows.filter(r =>
        !['quark'].includes(String(r.source || '').toLowerCase())
        && !isDeterministicErrorText(r.error)
        && isTransientErrorText(r.error)
      ).length;
    })(),
    restageQueued: db.prepare("SELECT COUNT(*) c FROM node_runs WHERE node_type IN ('restage_dual','restage_9_16') AND status IN ('queued','running')").get().c,
    lastScan: JSON.parse(db.prepare("SELECT value FROM kv WHERE key='last_scan'").get()?.value || 'null')
  };
  // 脏数据自检：出现非 VALID_STATUSES 的状态说明有写入路径漏改
  const ph = VALID_STATUSES.map(() => '?').join(',');
  const unknown = db.prepare('SELECT COALESCE(status,\'(NULL)\') s, COUNT(*) c FROM assets WHERE status IS NULL OR status NOT IN (' + ph + ') GROUP BY 1').all(...VALID_STATUSES);
  base.unknownStatus = {};
  for (const r of unknown) base.unknownStatus[r.s] = r.c;
  base.unknownStatusTotal = Object.values(base.unknownStatus).reduce((a, b) => a + b, 0);
  const authRows = db.prepare("SELECT COALESCE(auth_state,'unmanaged') AS state, COUNT(*) c FROM assets GROUP BY auth_state").all();
  base.authStateCounts = {};
  for (const r of authRows) base.authStateCounts[r.state] = r.c;
  return base;
}

function applyHumanTag(db, fid, dimension, dir) {
  const t = db.prepare('SELECT id FROM tag_dict WHERE dimension=? AND (dir=? OR label=?)').get(dimension, dir, dir);
  if (!t) return false;
  db.prepare(`
    INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at)
    VALUES (?, ?, NULL, 'human', 1.0, ?)
    ON CONFLICT(asset_fid, tag_id, role) DO UPDATE SET
      source='human', confidence=1.0, updated_at=excluded.updated_at
  `).run(fid, t.id, Date.now());
  return true;
}

// 核心 HTTP 请求路由调度
async function handleApi(services, req, res, prefix = '/api') {
  const { db, config, interpreter } = services;
  const urlObj = new URL(req.url, 'http://127.0.0.1');
  let pathname = urlObj.pathname;
  if (prefix && pathname.startsWith(prefix)) {
    pathname = pathname.slice(prefix.length) || '/';
  }

  // 跨域头与预检
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Filename, X-Source, X-Client-Asset-Id, X-Upload-Id, X-Chunk-Index, X-Total-Chunks');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 会话提取
  const token = extractToken(req, urlObj, {
    allowQuery: req.method === 'GET' && /(image|poster|file|mask|temp|masks)/.test(pathname || urlObj.pathname || ''),
  });
  const isViewerRoute = pathname === '/viewer' || pathname.startsWith('/viewer/');
  // SEC-001：已移除 lanInternalSession 免密提权后门——会话只认真实登录 token。
  const sessionUser = auth.verifySession(db, token);
  const isAdmin = sessionUser?.role === 'admin';
  const isViewerOrAdmin = !!sessionUser;

  // ===== 视角端白名单 (/api/viewer/*)：浏览/详情/媒体 + 同步快照 + App/H5 写操作（删除/画幅/AI/生成）=====
  // 非只读：DELETE assets、restage、main-derivative、AI/gen/chat、portrait 等供客户端使用。
  // 白名单外一律 404；完整治理/后台接口不在 /viewer 前缀内。
  const VIEWER_WHITELIST = [
    ['POST', /^\/auth\/login$/],
    ['GET', /^\/auth\/me$/],
    ['POST', /^\/auth\/logout$/],
    ['GET', /^\/assets$/],
    ['GET', /^\/assets\/timeline-days$/],
    ['GET', /^\/assets\/trash$/],
    ['GET', /^\/assets\/trash\/[^\/]+$/],
    ['POST', /^\/assets\/trash\/restore$/],
    ['POST', /^\/assets\/trash\/purge$/],
    ['POST', /^\/assets\/trash\/rehome-gate$/],
    ['POST', /^\/assets\/[^\/]+\/favorite$/],
    ['POST', /^\/assets\/[^\/]+\/library-prep$/],
    ['GET', /^\/assets\/[^\/]+$/],
    ['GET', /^\/assets\/[^\/]+\/similar$/],
    ['GET', /^\/assets\/[^\/]+\/image$/],
    ['HEAD', /^\/assets\/[^\/]+\/image$/],
    // 导出下载：/assets/<fid>/image/ML_SAVED_xxx.jpg（客户端另存/分享走同一路由）
    ['GET', /^\/assets\/[^\/]+\/image\/[^\/]+$/],
    ['HEAD', /^\/assets\/[^\/]+\/image\/[^\/]+$/],
    ['GET', /^\/assets\/[^\/]+\/file$/],
    ['HEAD', /^\/assets\/[^\/]+\/file$/],
    ['GET', /^\/assets\/[^\/]+\/video$/],
    ['HEAD', /^\/assets\/[^\/]+\/video$/],
    ['GET', /^\/assets\/[^\/]+\/poster$/],
    ['HEAD', /^\/assets\/[^\/]+\/poster$/],
    ['GET', /^\/assets\/[^\/]+\/process$/],
    ['POST', /^\/assets\/[^\/]+\/process$/],
    ['GET', /^\/assets\/[^\/]+\/ai\/tasks$/],
    ['POST', /^\/ai\/tasks$/],
    ['GET', /^\/ai\/tasks\/[^\/]+$/],
    ['GET', /^\/ai\/masks\/[^\/]+$/],
    ['HEAD', /^\/ai\/masks\/[^\/]+$/],
    ['GET', /^\/presets$/],
    ['GET', /^\/dict$/],
    ['GET', /^\/dict\/menu-tree$/],
    ['GET', /^\/studio\/schema$/],
    ['GET', /^\/studio\/catalog$/],
    ['POST', /^\/tools\/convert-video$/],
    ['POST', /^\/tools\/extract-frames$/],
    ['GET', /^\/stats$/],
    ['GET', /^\/vectors\/status$/],
    ['POST', /^\/snapshot$/],
    // SEC-007：/sync/reconcile 为批量删除对账，仅管理员（已移出 viewer 白名单）
    ['POST', /^\/assets\/[^\/]+\/restage$/],
    ['POST', /^\/assets\/[^\/]+\/main-derivative$/],
    ['GET', /^\/lab\/capabilities$/],
    ['GET', /^\/lab\/model-caps$/],
    ['GET', /^\/lab\/filter-vocabulary$/],
    ['GET', /^\/lab\/quick-models$/],
    ['GET', /^\/lab\/local-models$/],
    ['POST', /^\/lab\/runs$/],
    ['GET', /^\/lab\/runs\/[^\/]+\/[^\/]+$/],
    ['GET', /^\/cache\/temp\/[^\/]+$/],
    ['HEAD', /^\/cache\/temp\/[^\/]+$/],
    // 云端视频供应商凭 media_token 免登拉取首帧/尾帧（帧中继：/frames/<token>/<file>）
    ['GET', /^\/frames\/[^/]+\/[^/]+$/],
    ['HEAD', /^\/frames\/[^/]+\/[^/]+$/],
    ['GET', /^\/app\/update$/],
    ['DELETE', /^\/assets\/[^\/]+$/],
    ['POST', /^\/assets\/[^\/]+\/delete$/],
    // SEC-007：dedupe-scan / dedupe-library（含 apply 全库软删）与 purge 同级，仅管理员
    ['GET', /^\/rejected$/],
    ['GET', /^\/rejected\/[^\/]+$/],
    ['POST', /^\/rejected\/[^\/]+\/restore$/],
    ['POST', /^\/rejected\/restore-batch$/],
    ['GET', /^\/gateway\/config$/],
    ['GET', /^\/chat\/sessions$/],
    ['POST', /^\/chat\/sessions$/],
    ['DELETE', /^\/chat\/sessions\/[^\/]+$/],
    ['GET', /^\/chat\/messages$/],
    ['POST', /^\/chat\/messages$/],
    ['DELETE', /^\/chat\/messages$/],
    ['POST', /^\/chat\/optimize-prompt$/],
    ['POST', /^\/ai\/segment$/],
    ['POST', /^\/ai\/detect$/],
    ['GET', /^\/ai\/capabilities$/],
    ['POST', /^\/ai\/expand-jimeng$/],
    ['POST', /^\/ai\/vlm-describe$/],
    ['POST', /^\/edit\/run$/],
    ['POST', /^\/exports\/register$/],
    ['POST', /^\/ai\/upload$/],
    ['GET', /^\/products\/presets$/],
    ['GET', /^\/products\/models\/[^\/]+$/],
    ['GET', /^\/products\/previews\/[^\/]+$/],
    // SEC-007：治理台读接口对 viewer 保留，写接口（POST/PUT/DELETE/accept/沙盒）
    // 一律移出白名单，仅管理员经 /api/* 访问。
    ['GET', /^\/governance\/gen-models$/],
    ['GET', /^\/governance\/gen-jobs$/],
    ['GET', /^\/governance\/workflows$/],
    ['GET', /^\/governance\/prompts$/],
    ['GET', /^\/governance\/mount-points$/],
    ['GET', /^\/governance\/mount-points\/[^\/]+\/modules$/],
    ['GET', /^\/governance\/operators$/],
    ['GET', /^\/governance\/dict-macros$/],
    ['GET', /^\/governance\/snippets$/],
    ['POST', /^\/governance\/prompts\/preview-compile$/],
    ['GET', /^\/runs\/[^\/]+\/unpack$/],
    ['POST', /^\/gen\/images$/],
    ['POST', /^\/gen\/videos$/],
    ['POST', /^\/gen\/chat$/],
    ['GET', /^\/portrait-library$/],
    ['GET', /^\/portrait-library\/catalog$/],
    ['GET', /^\/portrait-library\/consent$/],
    ['POST', /^\/portrait-library\/consent$/],
    ['POST', /^\/portrait-library\/groups$/],
    ['POST', /^\/portrait-library\/groups\/[^\/]+\/assets$/],
    ['DELETE', /^\/portrait-library\/assets\/[^\/]+$/],
    ['DELETE', /^\/portrait-library\/groups\/[^\/]+$/],
    ['POST', /^\/ai\/walkthrough\/infer-topology$/],
    ['POST', /^\/ai\/walkthrough\/generate-3d$/],
    ['POST', /^\/ai\/walkthrough\/confirm-topology$/],
    ['POST', /^\/ai\/walkthrough\/infer-sequence$/],
    ['POST', /^\/ai\/walkthrough\/confirm-sequence$/],
    ['GET', /^\/studio\/presets$/],
    // SEC-007：presets 写操作移出 viewer 白名单（管理员经 /api/* 操作）
    ['POST', /^\/tools\/extract-frames$/],
    ['POST', /^\/tools\/convert-video$/],
    ['GET', /^\/assets\/similarity-workbench$/],
    ['POST', /^\/assets\/similarity-workbench\/resolve$/],
    ['POST', /^\/assets\/similarity-workbench\/clean-exact$/],
    ['GET', /^\/assets\/similarity-workbench\/ignored$/],
    ['DELETE', /^\/assets\/similarity-workbench\/ignored$/]
  ];
  if (pathname === '/viewer' || pathname.startsWith('/viewer/')) {
    pathname = pathname.slice('/viewer'.length) || '/';
    // 管理员直接豁免白名单限制；普通 viewer 校验白名单
    if (!isAdmin) {
      const hit = VIEWER_WHITELIST.some(([m, re]) => req.method === m && re.test(pathname));
      if (!hit) return sendJson(res, 404, { error: `视角端不支持的端点: ${pathname}` });
    }
  }

  // SEC-007：治理台写操作 / 技能流水线 / 沙盒执行一律管理员。
  // viewer 只保留治理台读接口与提示词编译预览。
  const isGovernanceWrite = pathname.startsWith('/governance/') && req.method !== 'GET'
    && pathname !== '/governance/prompts/preview-compile';
  if ((isGovernanceWrite || pathname === '/skills/create') && !isAdmin) {
    return sendJson(res, 403, { error: '需要管理员权限' });
  }
  if (pathname.startsWith('/v1/gen/')) {
    pathname = pathname.slice('/v1'.length);
  }

  // 公开健康探测（客户端 ServerResolve 依赖 2xx/401）
  if ((pathname === '/health' || pathname === '/api/health') && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, service: 'material-library', ts: Date.now() });
  }

  if (pathname.startsWith('/portrait-library')) {
    const handled = await portraitLib.handlePortraitApi(services, req, res, pathname, {
      sendJson,
      parseBody,
      sessionUser,
      isAdmin,
    });
    if (handled) return;
  }

  // 帧中继公网读取（云端视频供应商拉取首帧/尾帧；免会话，token 在路径中段、文件名在末段）
  const mFrame = pathname.match(/^\/frames\/([^/]+)\/([^/]+)$/);
  if (mFrame && (req.method === 'GET' || req.method === 'HEAD')) {
    return require('./frame-relay').serveFrame(
      services, req, res,
      decodeURIComponent(mFrame[2]),
      decodeURIComponent(mFrame[1])
    );
  }

  // 公开/登录接口
  if (pathname === '/auth/login' && req.method === 'POST') {
    const b = await parseBody(req);
    const clientIp = (req.socket?.remoteAddress || '').replace(/^::ffff:/i, '');
    try {
      const loginRes = auth.login(db, b.username, b.password, clientIp);
      if (!loginRes) return sendJson(res, 401, { error: '用户名或密码错误' });
      res.setHeader('Set-Cookie', `ml_session=${loginRes.token}; Path=/; Max-Age=${30*24*3600}; HttpOnly; SameSite=Lax`);
      return sendJson(res, 200, { success: true, data: loginRes });
    } catch (err) {
      if (err.code === 'RATE_LIMITED') {
        return sendJson(res, 429, { error: err.message });
      }
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/auth/logout' && req.method === 'POST') {
    if (token) auth.logout(db, token);
    res.setHeader('Set-Cookie', 'ml_session=; Path=/; Max-Age=0');
    return sendJson(res, 200, { success: true });
  }

  // ===== App 远程更新：检查与下载对客户端公开（启动静默检查无需会话） =====
  if (pathname === '/app/update' && req.method === 'GET') {
    try {
      const userAgent = String(req.headers['user-agent'] || '');
      const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
      const data = await appUpdate.checkUpdate(config, {
        platform: urlObj.searchParams.get('platform') || 'android',
        versionCode: urlObj.searchParams.get('versionCode') || '0',
        wgtVersion: urlObj.searchParams.get('wgtVersion') || urlObj.searchParams.get('versionCode') || '0',
        channel: urlObj.searchParams.get('channel') || 'private',
        deviceId: urlObj.searchParams.get('deviceId') || '',
        userAgent,
        clientIp,
      });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 灰度版本状态获取（正式版 vs 灰度版，公开供状态检查与监控面板查询）
  if (pathname === '/app/update/state' && req.method === 'GET') {
    try {
      const state = appUpdate.getUpdateState(config);
      return sendJson(res, 200, { success: true, data: state });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  const mUpdFilePub = pathname.match(/^\/app\/update\/files\/([^\/]+)$/);
  if (mUpdFilePub && req.method === 'GET') {
    const fileName = decodeURIComponent(mUpdFilePub[1]);
    const fp0 = appUpdate.resolveUpdateFilePath(config, fileName);
    if (!fp0) return sendJson(res, 404, { error: '更新包不存在' });
    const isApk = fileName.toLowerCase().endsWith('.apk');

    // wgt 公开下载；apk 仍需会话/token，避免公网裸奔安装包。
    //
    // 为什么 wgt 必须公开（2026-10-03 设备实证的真实故障）：
    //   /app/update（检查）本来就是公开的，App 冷启动 3 秒后就会弹更新；
    //   但下载要 token，而全新安装 / 登录过期时 App 根本没有 token，
    //   结果是「弹窗能出来、点立即更新就失败」，
    //   401 让 uni.downloadFile 走 fail 分支，用户只看到一句无意义的网络错误。
    //   设备日志：HTTP/1.1 401 {"error":"下载更新包需要登录"}。
    //   wgt 只是 JS 资源包（不含可执行代码、不含密钥），公开下载不扩大风险面。
    if (isApk) {
      const upTok = extractToken(req, urlObj, { allowQuery: true });
      const upSess = upTok ? auth.verifySession(db, upTok) : null;
      if (!upSess && !isViewerOrAdmin) {
        return sendJson(res, 401, { error: '下载更新包需要登录' });
      }
    }
    const fp = fp0;
    const stat = fs.statSync(fp);
    res.writeHead(200, {
      'Content-Type': fp.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${path.basename(fp)}"`,
    });
    fs.createReadStream(fp).pipe(res);
    return;
  }

  // ===== 统一菜单树与工作台契约 (Server-Driven UI 元数据开放只读) =====
  if (pathname === '/dict/menu-tree' && req.method === 'GET') {
    try {
      const data = menuTree.getMenuTree(db);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/studio/schema' && req.method === 'GET') {
    try {
      const data = menuTree.getStudioSchema(db);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 鉴权拦截（临时生成预览产物同样需要会话；前端 <img> 标签走 ml_session Cookie 鉴权；或走 15min media_token）
  // SEC-002：/tools/* 不再免鉴权直达——未登录只放行公共模型目录与合法 media_token 的媒体读取。
  if (!isViewerOrAdmin) {
    if (pathname === '/studio/catalog') {
      // 仅允许公共模型目录直达
    } else {
      const mImgCheck = pathname.match(/^\/assets\/([^\/]+)\/(?:image|file)(?:\/([^\/]+))?$/);
      const mMaskCheck = pathname.match(/^\/ai\/masks\/([^\/]+)$/);
      const mTempCheck = pathname.match(/^\/cache\/temp\/([^\/]+)$/);
      const mediaToken = urlObj.searchParams.get('media_token');
      const hasValidMediaToken =
        req.method === 'GET' &&
        !!mediaToken &&
        ((mImgCheck && auth.verifyMediaToken(decodeURIComponent(mImgCheck[1]), mediaToken)) ||
          (mMaskCheck && auth.verifyMediaToken(`mask:${decodeURIComponent(mMaskCheck[1])}`, mediaToken)));
      if (!hasValidMediaToken) {
        return sendJson(res, 401, { error: '未登录或会话已过期' });
      }
    }
  }

  if (pathname === '/auth/me' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, data: sessionUser });
  }

  // ===== 创作库配方 (Studio Presets / Recipes) =====
  if (pathname === '/studio/presets' && req.method === 'GET') {
    try {
      const category = urlObj.searchParams.get('category') || 'all';
      const list = studioPresets.listPresets(db, category);
      return sendJson(res, 200, { success: true, data: list });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/studio/presets' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '需要管理员权限（SEC-007）' });
    try {
      const body = await parseBody(req);
      const created = studioPresets.createPreset(db, body);
      return sendJson(res, 200, { success: true, data: created });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const mPresetDel = pathname.match(/^\/studio\/presets\/([^\/]+)$/);
  if (mPresetDel && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '需要管理员权限（SEC-007）' });
    try {
      const ok = studioPresets.deletePreset(db, mPresetDel[1]);
      return sendJson(res, 200, { success: true, deleted: ok });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // ===== FFmpeg 媒体实用工具 (视频抽帧、格式转换、音频分离) =====
  // SEC-002：客户端直传的 videoPath 必须落在受控目录（dataDir/nasDir）内，
  // 防止未受信路径被塞进 ffmpeg 读取任意本地文件；fid 解析路径为服务端自产，免检。
  const isAllowedMediaPath = (p) => {
    try {
      const resolved = path.resolve(String(p));
      const roots = [path.resolve(config.dataDir || '')];
      if (config.nasDir) roots.push(path.resolve(config.nasDir));
      return roots.some((r) => r && (resolved === r || resolved.startsWith(r + path.sep)));
    } catch {
      return false;
    }
  };

  if (pathname === '/tools/extract-frames' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      let videoPath = body.videoPath;
      if (videoPath && !isAllowedMediaPath(videoPath)) {
        return sendJson(res, 403, { error: 'videoPath 超出允许的目录范围' });
      }
      if (!videoPath && body.fid) {
        const deriv = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? ORDER BY CASE kind WHEN 'origin' THEN 0 ELSE 1 END LIMIT 1").get(body.fid);
        if (deriv) videoPath = await resolveDerivativeFile(services, deriv);
      }
      if (!videoPath || !fs.existsSync(videoPath)) {
        return sendJson(res, 400, { error: '未找到有效视频文件，请提供有效 fid 或 videoPath' });
      }
      const tempDir = path.join(config.dataDir, 'cache', 'frames', String(Date.now()));
      const result = await mediaTools.extractFrames({
        videoPath,
        destDir: tempDir,
        mode: body.mode || 'interval',
        intervalSeconds: Number(body.intervalSeconds) || 2,
        maxFrames: Number(body.maxFrames) || 16,
      });
      return sendJson(res, 200, { success: true, data: result });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/tools/convert-video' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      let videoPath = body.videoPath;
      if (videoPath && !isAllowedMediaPath(videoPath)) {
        return sendJson(res, 403, { error: 'videoPath 超出允许的目录范围' });
      }
      if (!videoPath && body.fid) {
        const deriv = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? ORDER BY CASE kind WHEN 'origin' THEN 0 ELSE 1 END LIMIT 1").get(body.fid);
        if (deriv) videoPath = await resolveDerivativeFile(services, deriv);
      }
      if (!videoPath) {
        const sampleCandidate = path.join(config.dataDir, 'cache', 'temp', 'gen_1789653572125_a6ba8d28.mp4');
        if (fs.existsSync(sampleCandidate)) videoPath = sampleCandidate;
      }
      if (!videoPath || !fs.existsSync(videoPath)) {
        return sendJson(res, 400, { error: '未找到有效视频文件，请提供有效 fid 或 videoPath' });
      }
      const outDir = path.join(config.dataDir, 'cache', 'temp');
      const result = await mediaTools.convertVideo({
        videoPath,
        destDir: outDir,
        targetFormat: body.targetFormat || 'mp4',
        crf: Number(body.crf) || 23,
        extractAudio: !!body.extractAudio,
      });
      return sendJson(res, 200, {
        success: true,
        data: {
          ...result,
          downloadUrl: `/api/cache/temp/${result.outputFile}`,
        }
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // ===== 官方创作模型目录与 Schema 契约 (唯一权威源) =====
  if (pathname === '/studio/catalog' && req.method === 'GET') {
    const { getModelPublicCatalog } = require('./models-contract');
    const { MODEL_SCHEMAS } = require('./model-schemas');
    const cat = getModelPublicCatalog(db);
    return sendJson(res, 200, {
      success: true,
      data: {
        studio: cat.studio,
        schemas: MODEL_SCHEMAS,
        models: cat.models,
      }
    });
  }

  // ===== 素材删除 + 全局黑名单（viewer/admin） =====
  const mAssetDel = pathname.match(/^\/assets\/([^\/]+)$/);
  if (mAssetDel && req.method === 'DELETE') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    // 幂等解码：素材 fid 含 `|` 时客户端可能编两次（%257C），
    // 单次 decodeURIComponent 会得到字面量 "%7C" → 查不到 → 误报「素材不存在」
    const fid = decodeParamLoose(mAssetDel[1]);
    try {
      const out = assetsDelete.softDeleteAsset(services, fid, {
        deletedBy: sessionUser?.username || 'user',
      });
      return sendJson(res, 200, { success: true, data: out });
    } catch (e) {
      if (e.code === 'not_found') {
        // 区分「从未存在」/「已删除可恢复」/「已清理」，
        // 让客户端能给用户「去回收站」的可行动提示
        const { missingAssetBody } = require('./asset-missing');
        const body = missingAssetBody(db, fid);
        return sendJson(res, body.code, body);
      }
      // 被剪辑工程引用：409 + 引用方清单
      if (e.status === 409) {
        return sendJson(res, 409, { error: e.message, code: e.code, usedBy: e.usedBy || [] });
      }
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mAssetDel2 = pathname.match(/^\/assets\/([^\/]+)\/delete$/);
  if (mAssetDel2 && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const fid = decodeParamLoose(mAssetDel2[1]);
    try {
      const out = assetsDelete.softDeleteAsset(services, fid, {
        deletedBy: sessionUser?.username || 'user',
      });
      return sendJson(res, 200, { success: true, data: out });
    } catch (e) {
      if (e.code === 'not_found') {
        const { missingAssetBody } = require('./asset-missing');
        const body = missingAssetBody(db, fid);
        return sendJson(res, body.code, body);
      }
      // 被剪辑工程引用：409 + 引用方清单，前端据此提示"先解除引用"
      if (e.status === 409) {
        return sendJson(res, 409, { error: e.message, code: e.code, usedBy: e.usedBy || [] });
      }
      return sendJson(res, 400, { error: e.message });
    }
  }
  if (pathname === '/assets/blacklist' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      assetsDelete.ensureTables(db);
      return sendJson(res, 200, { success: true, data: assetsDelete.listBlacklist(db) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // GET /assets/trash — 回收站列表（保留窗口按处置来源分档）
  if (pathname === '/assets/trash' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const page = parseInt(urlObj.searchParams.get('page'), 10) || 1;
      const pageSize = parseInt(urlObj.searchParams.get('pageSize'), 10) || 30;
      const source = String(urlObj.searchParams.get('source') || '').trim();
      const sort = String(urlObj.searchParams.get('sort') || '').trim();
      const keyword = String(urlObj.searchParams.get('keyword') || '').trim().slice(0, 100);
      const data = assetsDelete.listTrash(services, { page, pageSize, source, sort, keyword });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // GET /assets/trash/:fid — 回收站单条详情（含「为何进入回收站」判定原文与判定标准）
  // 注意：这条路由必须在 /assets/:fid 详情之前匹配，否则会被当成普通素材详情。
  const mTrashDetail = pathname.match(/^\/assets\/trash\/([^/]+)$/);
  if (mTrashDetail && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const fid = decodeParamLoose(mTrashDetail[1]);
      const data = assetsDelete.getTrashDetail(services, fid);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      const code = e.code === 'not_found' ? 404 : 500;
      return sendJson(res, code, { error: e.message });
    }
  }

  const mFavorite = pathname.match(/^\/assets\/([^\/]+)\/favorite$/);
  if (mFavorite && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      const { setFavorite } = require('./favorites');
      const fid = decodeParamLoose(mFavorite[1]);
      const onParam = (b && typeof b.on !== 'undefined') ? (b.on !== false && b.on !== 0) : undefined;
      const data = setFavorite(db, fid, onParam);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      const code = e.code === 'not_found' ? 404 : 400;
      return sendJson(res, code, { error: e.message });
    }
  }

  const mPrep = pathname.match(/^\/assets\/([^\/]+)\/library-prep$/);
  if (mPrep && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      const { runLibraryPrep } = require('./library-prep');
      const data = await runLibraryPrep(services, decodeURIComponent(mPrep[1]), b || {}, sessionUser);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      const code = e.code === 'not_found' ? 404 : 400;
      return sendJson(res, code, { error: e.message });
    }
  }

  if (pathname === '/assets/trash/rehome-gate' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const data = assetsDelete.rehomeGateRejects(services);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // POST /assets/shelf — 在原素材、精修素材、成品素材之间移动
  if (pathname === '/assets/shelf' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    ensureAssetShelfColumns(db);
    const body = await parseBody(req);
    const shelf = String(body.shelf || '');
    const fids = [].concat(body.fids || body.fid || []).filter(Boolean);
    if (!['original', 'retouched', 'finished'].includes(shelf)) {
      return sendJson(res, 400, { error: 'shelf 只能是 original、retouched、finished' });
    }
    const stmt = db.prepare('UPDATE assets SET library_shelf=?, updated_at=? WHERE fid=?');
    const now = Date.now();
    for (const fid of fids) stmt.run(shelf, now, fid);
    return sendJson(res, 200, { ok: true, count: fids.length, shelf });
  }

  // POST /assets/classify — 人工改分类并锁住，闸门不再覆盖
  if (pathname === '/assets/classify' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    ensureAssetShelfColumns(db);
    const body = await parseBody(req);
    const fid = String(body.fid || '');
    const category = String(body.category || '');
    const allowed = ['interior', 'exterior', 'furniture', 'clothing', 'portrait', 'finished'];
    if (!fid) return sendJson(res, 400, { error: '缺少素材' });
    let space = null;
    if (category) {
      if (!allowed.includes(category)) return sendJson(res, 400, { error: '分类不在允许范围内' });
      db.prepare('UPDATE assets SET category=?, category_locked=1, updated_at=? WHERE fid=?').run(category, Date.now(), fid);
    }
    if (body.space) {
      try {
        space = require('./shelf-lineage').setManualSpace(db, fid, body.space);
      } catch (e) {
        return sendJson(res, e.code === 404 ? 404 : 400, { error: e.message });
      }
    }
    const dims = body.dims && typeof body.dims === 'object' ? body.dims : null;
    const savedDims = {};
    if (dims) {
      try {
        const { setManualTag } = require('./shelf-lineage');
        for (const [dim, label] of Object.entries(dims)) {
          if (!label) continue;
          savedDims[dim] = setManualTag(db, fid, dim, label);
        }
      } catch (e) {
        return sendJson(res, e.code === 404 ? 404 : 400, { error: e.message });
      }
    }
    if (!category && !space && !Object.keys(savedDims).length) return sendJson(res, 400, { error: '要改分类或空间' });
    return sendJson(res, 200, { ok: true, fid, category: category || null, space, dims: savedDims });
  }

  if (pathname === '/assets/retag' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const body = await parseBody(req);
    try {
      const data = require('./shelf-lineage').requeueRetag(db, String(body.fid || ''));
      return sendJson(res, 200, { ok: true, ...data });
    } catch (e) {
      return sendJson(res, e.code === 404 ? 404 : 400, { error: e.message });
    }
  }

  if (pathname === '/assets/from-generation' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const body = await parseBody(req);
    try {
      const data = await require('./shelf-lineage').registerGenerated(services, body || {});
      return sendJson(res, 200, { ok: true, ...data });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // POST /assets/trash/restore — 从回收站恢复素材（支持 fid 或 fids 批量）
  if (pathname === '/assets/trash/restore' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    const list = Array.isArray(b.fids) ? b.fids : (b.fid ? [b.fid] : []);
    if (!list.length) return sendJson(res, 400, { error: '缺少素材 fid' });
    try {
      const out = assetsDelete.restoreTrashAsset(services, list);
      return sendJson(res, 200, { success: true, data: out });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // POST /assets/trash/purge — 彻底粉碎删除（支持 fid 或 fids 批量）
  if (pathname === '/assets/trash/purge' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '需要管理员权限（SEC-007）' });
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    const list = Array.isArray(b.fids) ? b.fids : (b.fid ? [b.fid] : []);
    if (!list.length) return sendJson(res, 400, { error: '缺少素材 fid' });
    try {
      const out = assetsDelete.purgeTrashAsset(services, list);
      return sendJson(res, 200, { success: true, data: out });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // ── 相似处理工作台 (Similarity Workbench) ──
  if (pathname === '/assets/similarity-workbench' && req.method === 'GET') {
    try {
      const { scanSimilarityWorkbench } = require('./similarity-workbench');
      const mode = urlObj.searchParams.get('mode') || 'visual';
      const maxDist = urlObj.searchParams.get('maxDist') || urlObj.searchParams.get('max_dist');
      const category = urlObj.searchParams.get('category') || 'all';
      const result = await scanSimilarityWorkbench(services, { mode, maxDist, category });
      return sendJson(res, 200, { success: true, data: result });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/assets/similarity-workbench/resolve' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '需要管理员权限' });
    try {
      const body = await parseBody(req);
      const { resolveSimilarityCluster } = require('./similarity-workbench');
      const result = await resolveSimilarityCluster(services, { ...body, actor: sessionUser?.username || 'admin' });
      return sendJson(res, 200, { success: true, data: result });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/assets/similarity-workbench/clean-exact' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '需要管理员权限' });
    try {
      const { cleanExactDuplicates } = require('./similarity-workbench');
      const result = await cleanExactDuplicates(services, { actor: sessionUser?.username || 'admin' });
      return sendJson(res, 200, { success: true, data: result });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/assets/similarity-workbench/ignored' && req.method === 'GET') {
    try {
      const { listIgnoredPairs } = require('./similarity-workbench');
      const result = listIgnoredPairs(db);
      return sendJson(res, 200, { success: true, data: result });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/assets/similarity-workbench/ignored' && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '需要管理员权限' });
    try {
      const body = await parseBody(req);
      const { removeIgnoredPair } = require('./similarity-workbench');
      removeIgnoredPair(db, body.fidA || body.fid_a, body.fidB || body.fid_b);
      return sendJson(res, 200, { success: true });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 指纹去重扫描：MD5/SHA/pHash，对比原图 + 全部衍生（含 9:16/3:4）
  if (pathname === '/assets/dedupe-scan' && req.method === 'POST') {
    try {
      const fp = require('./fingerprint');
      fp.ensureFingerprintColumns(db);
      const { hamming } = require('./qc');
      const body = await parseBody(req);
      const phashThreshold = Number(body.phashThreshold) > 0 ? Number(body.phashThreshold) : 5;
      const includeNear = body.includeNear !== false;
      const nearThreshold = Number(body.nearThreshold) > 0 ? Number(body.nearThreshold) : 8;

      const assets = db.prepare(`
        SELECT fid, file_name, size, width, height, sha256, md5, phash,
               created_at, main_derivative_id
        FROM assets
        WHERE status IS NULL OR status != 'deleted'
        ORDER BY COALESCE(created_at, 0) ASC, fid ASC
      `).all();

      const derivs = db.prepare(`
        SELECT id, asset_fid, kind, width, height, sha256, md5, phash
        FROM derivatives
        WHERE (phash IS NOT NULL AND phash != '') OR (md5 IS NOT NULL AND md5 != '') OR (sha256 IS NOT NULL AND sha256 != '')
      `).all();

      // 收集每个资产的「内容指纹集」= 自身 + 其衍生
      const byFid = new Map();
      for (const a of assets) {
        byFid.set(a.fid, {
          ...a,
          hashes: new Set(),
          phashes: [],
          restageKinds: new Set(),
        });
        const slot = byFid.get(a.fid);
        if (a.sha256) slot.hashes.add(String(a.sha256).toLowerCase());
        if (a.md5) slot.hashes.add(String(a.md5).toLowerCase());
        if (a.phash) slot.phashes.push({ phash: a.phash, kind: 'origin', id: null });
      }
      for (const d of derivs) {
        const slot = byFid.get(d.asset_fid);
        if (!slot) continue;
        if (String(d.kind || '').startsWith('restage_')) slot.restageKinds.add(d.kind);
        if (d.sha256) slot.hashes.add(String(d.sha256).toLowerCase());
        if (d.md5) slot.hashes.add(String(d.md5).toLowerCase());
        if (d.phash) slot.phashes.push({ phash: d.phash, kind: d.kind, id: d.id });
      }

      const list = [...byFid.values()];
      const pairs = [];
      const deletedSet = new Set();

      const rankKeep = (a, b) => {
        // 保留：有 restage 衍生 / 衍生更多 / 更早（CONFLICT-002：代表图概念已退役）
        const score = (x) =>
          (x.restageKinds.size > 0 ? 4 : 0) +
          (x.phashes.length > 1 ? 2 : 0) +
          (x.main_derivative_id ? 1 : 0);
        const sa = score(a);
        const sb = score(b);
        if (sa !== sb) return sb - sa;
        return (Number(a.created_at) || 0) - (Number(b.created_at) || 0);
      };

      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (deletedSet.has(a.fid)) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (deletedSet.has(b.fid)) continue;

          let reason = '';
          let dist = null;

          // 精确字节哈希
          for (const h of a.hashes) {
            if (b.hashes.has(h)) {
              reason = h.length === 32 ? 'md5' : 'sha256';
              dist = 0;
              break;
            }
          }

          // 感知哈希：资产自身 + 各自衍生互相比较
          if (!reason) {
            let bestDist = 64;
            for (const pa of a.phashes) {
              for (const pb of b.phashes) {
                const d = hamming(pa.phash, pb.phash);
                if (d < bestDist) bestDist = d;
              }
            }
            if (bestDist <= phashThreshold) {
              reason = `phash:${bestDist}`;
              dist = bestDist;
            } else if (includeNear && bestDist <= nearThreshold) {
              reason = `phash_near:${bestDist}`;
              dist = bestDist;
            }
          }

          if (!reason) continue;

          const ordered = rankKeep(a, b) >= 0 ? [a, b] : [b, a];
          const keep = ordered[0];
          const drop = ordered[1];
          pairs.push({
            keepFid: keep.fid,
            keepName: keep.file_name,
            dropFid: drop.fid,
            dropName: drop.file_name,
            reason,
            dist,
            dropHasRestage: drop.restageKinds.size > 0,
            keepHasRestage: keep.restageKinds.size > 0,
          });
          deletedSet.add(drop.fid);
        }
      }

      return sendJson(res, 200, {
        success: true,
        data: {
          scanned: list.length,
          pairs,
          matched: pairs.length,
          phashThreshold,
          nearThreshold,
          phashReady: list.filter((x) => x.phashes.length > 0).length,
        },
      });
    } catch (e) {
      console.error('[dedupe-scan]', e);
      return sendJson(res, 500, { error: e.message || '指纹扫描失败' });
    }
  }

  // ===== 拒收箱 =====
  if (pathname === '/rejected' && req.method === 'GET') {
    try {
      const page = Number(urlObj.searchParams.get('page')) || 1;
      const pageSize = Number(urlObj.searchParams.get('pageSize')) || 30;
      const data = require('./reject-box').listRejected(db, { page, pageSize });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  const mRejectRestore = pathname.match(/^\/rejected\/([^\/]+)\/restore$/);
  if (mRejectRestore && req.method === 'POST') {
    try {
      const fid = decodeURIComponent(mRejectRestore[1]);
      const b = await parseBody(req);
      if (!b.reason) return sendJson(res, 400, { error: '请选择恢复原因' });
      const data = require('./reject-box').restore(db, fid, {
        reason: b.reason,
        note: b.note || '',
        actor: sessionUser?.username || 'user',
      });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      const code = e.code === 'not_found' ? 404 : e.code === 'not_rejected' ? 400 : 500;
      return sendJson(res, code, { error: e.message });
    }
  }

  if (pathname === '/rejected/restore-batch' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      const fids = Array.isArray(b.fids) ? b.fids : [];
      if (!fids.length) return sendJson(res, 400, { error: '缺少 fids' });
      if (!b.reason) return sendJson(res, 400, { error: '请选择恢复原因' });
      const data = require('./reject-box').restoreBatch(db, fids, {
        reason: b.reason,
        note: b.note || '',
        actor: sessionUser?.username || 'user',
      });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  const mRejectedOne = pathname.match(/^\/rejected\/([^\/]+)$/);
  if (mRejectedOne && req.method === 'GET') {
    try {
      const fid = decodeURIComponent(mRejectedOne[1]);
      const data = require('./reject-box').getRejectedDetail(db, fid);
      if (!data) return sendJson(res, 404, { error: '拒收件不存在' });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 网关配置（读：所有登录用户；写：管理员，见下方非 viewer 路由）
  if (pathname === '/gateway/config' && req.method === 'GET') {
    try {
      const data = require('./gateway').getConfig(db);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 全库图片多手段去重：原图×原图×衍生（MD5/SHA/pHash/导出标记/血缘）
  // body: { apply?: boolean, phashStrict?, phashNear?, readExportTags? }
  if (pathname === '/assets/dedupe-library' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '需要管理员权限（SEC-007）' });
    try {
      const body = await parseBody(req);
      const apply = body.apply === true;
      const { scanLibraryDuplicates, applyDedupePairs, formatReportCsv } = require('./dedupe-library');
      const report = scanLibraryDuplicates(services, {
        dryRun: !apply,
        phashStrict: Number(body.phashStrict) || undefined,
        phashNear: Number(body.phashNear) || undefined,
        readExportTags: body.readExportTags !== false,
      });
      if (!apply) {
        return sendJson(res, 200, { success: true, data: { ...report, applied: false } });
      }
      const applied = applyDedupePairs(services, report.pairs || []);
      return sendJson(res, 200, {
        success: true,
        data: { ...report, dryRun: false, applied: true, applyResult: applied },
      });
    } catch (e) {
      console.error('[dedupe-library]', e);
      return sendJson(res, 500, { error: e.message || '全库去重失败' });
    }
  }

  // 夸克授权状态
  if (pathname === '/auth/quark-status' && req.method === 'GET') {
    const q = new Quark(config.cliPath);
    return sendJson(res, 200, { success: true, data: await q.getUserInfo() });
  }
  if (pathname === '/auth/quark-login' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    const q = new Quark(config.cliPath);
    return sendJson(res, 200, { success: true, data: await q.loginToken(b.code) });
  }
  // 一键安装夸克 Skill + CAC 授权（失败自动回滚旧 CLI）
  if (pathname === '/auth/quark-install' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    const { installQuarkSkill } = require('./quark-install');
    const r = await installQuarkSkill({
      url: b.url,
      code: b.code,
      cliPath: config.cliPath,
    });
    if (!r.success) return sendJson(res, 400, { success: false, error: r.error });
    // 刷新进程内 cliPath（下次 Quark 实例用新路径）
    try {
      const { resolveQuarkCli } = require('./quark');
      config.cliPath = resolveQuarkCli() || config.cliPath;
    } catch {}
    return sendJson(res, 200, { success: true, data: r });
  }

  if (pathname === '/auth/reset' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    if (!b.fid) return sendJson(res, 400, { error: '缺少 fid' });
    db.prepare("UPDATE assets SET auth_state=NULL, auth_matched_at=NULL, auth_frozen_at=NULL, auth_revoked_at=NULL, updated_at=? WHERE fid=?").run(Date.now(), b.fid);
    const { applyGovernance } = require('./governance');
    applyGovernance(db);
    return sendJson(res, 200, { success: true });
  }

  // 检索接口
  if (pathname === '/assets' && req.method === 'GET') {
    const q = Object.fromEntries(urlObj.searchParams);
    if (q.all && !isAdmin) return sendJson(res, 403, { error: '权限不足' });
    return sendJson(res, 200, { success: true, data: queryAssets(db, q) });
  }

  // 侧边时间轴精准天数统计
  if (pathname === '/assets/timeline-days' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const mediaType = urlObj.searchParams.get('media_type');
      const category = urlObj.searchParams.get('category');
      const whereParts = [BROWSE_READY_SQL, AUTH_VISIBLE_SQL];
      const args = [];
      if (category === 'interior_exterior' || category === 'interior') {
        whereParts.push("(a.kind = 'image' AND COALESCE(a.category, 'interior') IN ('interior', 'exterior'))");
      } else if (category === 'portrait') {
        whereParts.push("a.category = 'portrait'");
      } else if (category === 'clothing') {
        whereParts.push("a.category = 'clothing'");
      } else if (category === 'furniture') {
        whereParts.push("(a.category = 'furniture' OR a.kind = 'furniture')");
      } else if (mediaType === 'image') {
        whereParts.push("a.kind = 'image'");
      } else if (mediaType === 'video' || category === 'video') {
        whereParts.push("a.kind = 'video'");
      } else if (mediaType === 'music' || mediaType === 'audio' || category === 'music') {
        whereParts.push("(a.kind = 'audio' OR a.category = 'music')");
      }
      const sql = `
        SELECT 
          date(COALESCE(a.created_at, a.discovered_at, a.updated_at)/1000, 'unixepoch', 'localtime') as day,
          count(*) as count
        FROM assets a
        WHERE ${whereParts.join(' AND ')}
        GROUP BY day
        ORDER BY day DESC
        LIMIT 150
      `;
      const rows = db.prepare(sql).all(...args);
      return sendJson(res, 200, { success: true, data: rows });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/stats' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, data: getStats(db) });
  }

  // 相册快照直收：合并版 App（素材库）推送全量相册清单；任意登录账号可推（仅写本设备清单，非破坏性）
  if (pathname === '/snapshot' && req.method === 'POST') {
    const b = await parseBody(req);
    const { ingestSnapshot } = require('./snapshot');
    const { applyGovernance } = require('./governance');
    try {
      const data = ingestSnapshot(db, b);
      applyGovernance(db);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // ===== 相册删除对账（高级配置，破坏性操作）=====
  // preview 只统计无副作用；apply 会把条目移入回收站（可恢复）。
  // 不自动执行：素材库是共享资产，必须由用户主动触发。
  if (pathname === '/sync/reconcile' && (req.method === 'POST' || req.method === 'GET')) {
    if (!isAdmin) return sendJson(res, 403, { error: '需要管理员权限（SEC-007）' });
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = req.method === 'POST' ? await parseBody(req) : {};
    const q = urlObj.searchParams;
    const deviceId = String(b.deviceId || q.get('deviceId') || sessionUser?.device_id || '').trim();
    if (!deviceId) return sendJson(res, 400, { error: '缺少设备 ID（请先执行一次相册同步）' });
    const graceRaw = b.graceDays !== undefined ? b.graceDays : q.get('graceDays');
    const graceDays = graceRaw === null || graceRaw === undefined || graceRaw === ''
      ? null : Number(graceRaw);
    const apply = req.method === 'POST' && (b.apply === true || b.apply === 'true');
    try {
      const albumReconcile = require('./album-reconcile');
      if (apply) {
        const out = albumReconcile.applyReconcile(services, {
          deviceId,
          graceDays,
          limit: b.limit,
          actor: sessionUser?.username || 'user',
        });
        return sendJson(res, 200, { success: true, data: out });
      }
      const out = albumReconcile.previewReconcile(services, { deviceId, graceDays });
      return sendJson(res, 200, { success: true, data: out });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // 手机端相册媒体文件直传落盘 NAS（单文件流式/multipart）
  if (pathname === '/sync/upload' && req.method === 'POST') {
    const { handleDirectUpload } = require('./stream-upload');
    try {
      const data = await handleDirectUpload(services, req);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // 手机端大视频/大文件分片上传
  if (pathname === '/sync/chunk' && req.method === 'POST') {
    const { handleChunkUpload } = require('./stream-upload');
    const uploadId = req.headers['x-upload-id'] || urlObj.searchParams.get('upload_id');
    const chunkIndex = req.headers['x-chunk-index'] || urlObj.searchParams.get('chunk_index');
    const totalChunks = req.headers['x-total-chunks'] || urlObj.searchParams.get('total_chunks');
    try {
      const data = await handleChunkUpload(services, req, { uploadId, chunkIndex, totalChunks });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // 手机端大视频/大文件分片合并完成
  if (pathname === '/sync/complete' && req.method === 'POST') {
    const b = await parseBody(req);
    const { handleCompleteChunkUpload } = require('./stream-upload');
    try {
      const data = await handleCompleteChunkUpload(services, {
        uploadId: b.uploadId || b.upload_id,
        fileName: b.fileName || b.file_name,
        totalChunks: b.totalChunks || b.total_chunks,
        dateModified: b.dateModified || b.date_modified || b.taken_at,
        clientAssetId: b.clientAssetId || b.client_asset_id,
        source: b.source || 'sync'
      });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // 快捷处理预设（viewer 只读；admin 可管理）
  if (pathname === '/presets' && req.method === 'GET') {
    const gatewayReady = processSvc.isGatewayConfigured(processSvc.getGatewayAdapter(db));
    return sendJson(res, 200, { success: true, data: { presets: processSvc.listPresets(db), gatewayReady } });
  }

  if (pathname === '/presets' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    if (!b.id || !b.label || !b.action) return sendJson(res, 400, { error: '缺少 id/label/action' });
    try {
      processSvc.upsertPreset(db, { ...b, builtin: false });
      return sendJson(res, 200, { success: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const mDelPreset = pathname.match(/^\/presets\/([^\/]+)$/);
  if (mDelPreset && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const ok = processSvc.deletePreset(db, decodeURIComponent(mDelPreset[1]));
      return sendJson(res, ok ? 200 : 404, ok ? { success: true } : { error: '预设不存在' });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // 管理端：发布更新元数据
  if (pathname === '/app/update' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const manifest = appUpdate.publishUpdate(config, b);
      return sendJson(res, 200, { success: true, data: manifest });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // 管理端：一键强制推送（不重新打包，只把已发布包标 force，手机下次检查立刻弹）
  if (pathname === '/app/update/quick-push' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { forcePush } = require('./app-quick-push');
      const b = await parseBody(req);
      const manifest = forcePush(config, b);
      return sendJson(res, 200, { success: true, data: manifest.latest });
    } catch (e) {
      const code = e.code === 'no_package' ? 400 : 400;
      return sendJson(res, code, { error: e.message, code: e.code || null });
    }
  }

  // 管理端：上传 wgt/apk 并自动写入清单
  if (pathname === '/app/update/upload' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const chunks = [];
      const raw = await new Promise((resolve, reject) => {
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      // 支持 multipart/form-data 或 raw body + query
      let buffer = raw;
      let fileName = urlObj.searchParams.get('fileName') || `app-${Date.now()}.wgt`;
      const fields = {};
      const ctype = String(req.headers['content-type'] || '');
      if (ctype.includes('multipart/form-data')) {
        const m = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        const boundary = (m && (m[1] || m[2])) || '';
        if (boundary) {
          const parts = raw.toString('binary').split('--' + boundary);
          for (const part of parts) {
            if (!part || part === '--\r\n' || part === '--') continue;
            const headerEnd = part.indexOf('\r\n\r\n');
            if (headerEnd < 0) continue;
            const head = part.slice(0, headerEnd);
            let body = part.slice(headerEnd + 4);
            if (body.endsWith('\r\n')) body = body.slice(0, -2);
            const nameM = head.match(/name="([^"]+)"/i);
            const fileM = head.match(/filename="([^"]+)"/i);
            const name = nameM ? nameM[1] : '';
            if (fileM) {
              fileName = fileM[1] || fileName;
              buffer = Buffer.from(body, 'binary');
            } else if (name) {
              fields[name] = body.replace(/\r\n$/, '');
            }
          }
        }
      } else {
        // JSON 包 base64，或 raw 二进制（Content-Type: application/octet-stream + ?fileName=）
        try {
          const j = JSON.parse(raw.toString('utf8'));
          if (j.fileName) fileName = j.fileName;
          if (j.buffer || j.base64) buffer = Buffer.from(j.buffer || j.base64, 'base64');
          Object.assign(fields, j.fields || {
            versionCode: j.versionCode,
            versionName: j.versionName,
            wgtVersion: j.wgtVersion,
            force: j.force,
            note: j.note,
            channel: j.channel,
          });
        } catch {
          // raw binary: keep buffer, read fields from query
          for (const k of ['versionCode', 'versionName', 'wgtVersion', 'force', 'note', 'channel', 'releaseMode', 'targetDevices']) {
            const v = urlObj.searchParams.get(k);
            if (v != null) fields[k] = v;
          }
        }
      }
      const out = await appUpdate.publishFile(config, { fileName, buffer, fields });
      return sendJson(res, 200, { success: true, data: out });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // 灰度版本状态获取（正式版 vs 灰度版）
  if (pathname === '/app/update/state' && req.method === 'GET') {
    try {
      const state = appUpdate.getUpdateState(config);
      return sendJson(res, 200, { success: true, data: state });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 管理端：一键将当前灰度版本转正为全量正式发布
  if (pathname === '/app/update/promote' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const manifest = appUpdate.promoteCanary(config);
      return sendJson(res, 200, { success: true, data: manifest.latest });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // 管理端：撤回当前灰度版本
  if (pathname === '/app/update/revoke-canary' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const manifest = appUpdate.revokeCanary(config);
      return sendJson(res, 200, { success: true, data: manifest });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // ===== AI 试验场 (/api/lab) =====
  // 能力目录：动态告知前端当前有哪些工作流/入口可用
  if (pathname === '/lab/capabilities' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      return sendJson(res, 200, { success: true, data: labSvc.getCapabilityCatalog(services) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // ★ 扁平模型能力表：客户端唯一真相源（caps.region.kind 决定坐标/mask/vlm 走向）
  // 客户端启动拉一次并缓存；离线用内置兜底表，联网后以本接口为准。
  if (pathname === '/lab/model-caps' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const { buildModelCapsMap } = require('./lab');
      return sendJson(res, 200, {
        success: true,
        data: { caps: buildModelCapsMap(), generatedAt: Date.now() },
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // ★ 快捷操作 / 编辑op 的模型配置表：每个 op 的「默认模型 + 可选模型池」。
  //   与 /lab/model-caps 的分工：
  //     model-caps 回答「这个模型会什么」（region能力）；
  //     本接口回答「这个操作默认用谁、用户能换成谁」（治理配置）。
  //   客户端 quick/*.vue与 edit.vue 的模型下拉一律以此为准。
  if (pathname === '/lab/quick-models' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const genGov = require('./gen-governance');
      const jobs = genGov.listJobBindings(db)
        .filter((j) => j.group === 'quick')
        .map((j) => ({
          job_id: j.job_id,
          label: j.label,
          default_model: j.model_id,
          selectable: (j.selectable || []).map((m) => ({
            id: m.id,
            name: m.name,
            model_code: m.model_code || '',
            provider: m.provider || '',
            free: !!m.free,
          })),
          updated_at: j.updated_at || 0,
        }));
      return sendJson(res, 200, {
        success: true,
        data: { jobs, generatedAt: Date.now() },
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // ★ 面向客户端的「当前生效筛选词表」（viewer 权限即可，不需要管理员）。
  //   客户端据此动态重建筛选器，不再依赖本地硬编码兜底表：
  //   - active：当前生效的全部标签（含库中还没用到的，usage_count=0 也返回）
  //   - deprecated：已移除的旧标签 → 客户端比对素材上的风格，命中即视为「需重新评估」
  if (pathname === '/lab/filter-vocabulary' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const tagGov = require('./tag-governance');
      const dimension = urlObj.searchParams.get('dimension') || null;
      const catParam = urlObj.searchParams.get('library') || urlObj.searchParams.get('category') || null;
      const data = tagGov.filterVocabulary(db, dimension, catParam);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 上传前看一眼闸门建议。不入库、不改库。
  if (pathname === '/lab/gate-preview' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const b = await parseBody(req, 16 * 1024 * 1024);
      if (b && b.__bodyTooLarge) return sendJson(res, 413, { error: '图片过大' });
      const dataUrl = String((b && b.dataUrl) || '');
      if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(dataUrl)) {
        return sendJson(res, 400, { error: '需要 data:image base64' });
      }
      const { previewGateCategory } = require('./nodes');
      const data = await previewGateCategory(services, dataUrl);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message || '识别失败' });
    }
  }

  // ★ 校验某个素材的风格标签是否已失效（风格重评估后老素材仍挂旧风格）。
  //   返回 needRetag 与失效标签；客户端据此提示「该素材风格已过期，重新评估中」，
  //   并在评估完成前按 fallbackLabel（默认「混搭」）当作当前风格展示。
  if (pathname === '/lab/stale-tags' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const b = await parseBody(req);
      const labels = Array.isArray(b.labels) ? b.labels.map(String).filter(Boolean) : [];
      if (!labels.length) return sendJson(res, 200, { success: true, data: { stale: [], needRetag: false } });
      const deprecated = new Set();
      const rows = db.prepare(`SELECT label FROM tag_dict WHERE deprecated=1`).all();
      for (const r of rows) deprecated.add(r.label);
      const stale = labels.filter((l) => deprecated.has(l));
      return sendJson(res, 200, {
        success: true,
        data: {
          stale,
          needRetag: stale.length > 0,
          fallbackLabel: b.fallbackLabel || '其他风格',
        },
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 端侧本地模型目录（元数据；推理在客户端）
  if (pathname === '/lab/local-models' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const localModels = require('./local-models');
      const data = await localModels.listLocalModels(config);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  const mLocalDl = pathname.match(/^\/lab\/local-models\/([^\/]+)\/download$/);
  if (mLocalDl && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const localModels = require('./local-models');
      const assetKind = urlObj.searchParams.get('asset') || '';
      const hit = localModels.resolveDownload(config, decodeURIComponent(mLocalDl[1]), assetKind);
      if (!hit) return sendJson(res, 404, { error: '模型文件不存在或未发布到服务端' });
      const st = fs.statSync(hit.filePath);
      const etag = `"${hit.meta.id}-${hit.meta.version}-${st.size}-${assetKind || 'param'}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag });
        return res.end();
      }
      const range = req.headers.range;
      const headers = {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(st.size),
        'Content-Disposition': `attachment; filename="${hit.fileName || hit.meta.fileName}"`,
        ETag: etag,
        'X-Model-Version': hit.meta.version,
        'X-Model-Id': hit.meta.id,
        'Accept-Ranges': 'bytes',
      };
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
          if (start <= end && start < st.size) {
            res.writeHead(206, {
              ...headers,
              'Content-Range': `bytes ${start}-${end}/${st.size}`,
              'Content-Length': String(end - start + 1),
            });
            return fs.createReadStream(hit.filePath, { start, end }).pipe(res);
          }
        }
      }
      res.writeHead(200, headers);
      return fs.createReadStream(hit.filePath).pipe(res);
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 统一提交试验场运行
  if (pathname === '/lab/runs' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    if (!b.entryId) return sendJson(res, 400, { error: '缺少 entryId' });
    try {
      const run = await labSvc.submitLabRun(services, {
        entryId: b.entryId,
        fid: b.fid || null,
        fids: b.fids || b.source_fids || null,
        params: b.params || {},
        createdBy: sessionUser?.username || 'user',
        userId: sessionUser?.id || 0,
        userRole: sessionUser?.role || ''
      });
      return sendJson(res, 200, { success: true, data: run });
    } catch (e) {
      const status = e.code === 'not_found' || e.code === 'fid_missing' ? 404
        : e.code === 'not_ready' || e.code === 'unknown_entry' || e.code === 'missing_fid'
          || e.code === 'too_many_fids' || e.code === 'missing_adapter' || e.code === 'adapter_missing'
          ? 400
          : e.code === 'gen_failed' ? 200 : 400;
      // gen 同步失败仍 200，便于前端展示 result.error
      if (e.code === 'gen_failed') {
        return sendJson(res, 200, {
          success: false,
          error: e.message,
          data: {
            engine: 'gen',
            runId: e.runId,
            mode: 'sync',
            status: 'failed',
            result: e.result || null
          }
        });
      }
      return sendJson(res, status, {
        success: false,
        error: e.message,
        code: e.code || null,
        data: e.entry || null
      });
    }
  }

  // 轮询试验场运行状态
  const mLabRun = pathname.match(/^\/lab\/runs\/([^\/]+)\/([^\/]+)$/);
  if (mLabRun && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const engine = decodeURIComponent(mLabRun[1]);
    const runId = decodeURIComponent(mLabRun[2]);
    try {
      const st = labSvc.getLabRunStatus(services, engine, runId);
      return sendJson(res, 200, { success: true, data: st });
    } catch (e) {
      const status = e.code === 'not_found' ? 404 : 400;
      return sendJson(res, status, { success: false, error: e.message, code: e.code || null });
    }
  }

  // process 任务单查（试验场 / 运维共用）
  const mProcJob = pathname.match(/^\/process\/jobs\/([^\/]+)$/);
  if (mProcJob && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const id = Number(decodeURIComponent(mProcJob[1]));
    if (!Number.isFinite(id)) return sendJson(res, 400, { error: '非法任务 ID' });
    const job = processSvc.getProcessJob(db, id);
    if (!job) return sendJson(res, 404, { error: '处理任务不存在' });
    return sendJson(res, 200, { success: true, data: job });
  }

  // ===== 企业级 AI 对话流持久化 (/api/chat/*) =====
  // 1. 会话列表
  // ===== Chat 会话与消息 =====
  // SEC-007：chat 会话属主校验。规则：管理员全通；会话不存在视为可创建（无数据可泄露）；
  // user_id=0 为共享默认会话；其余仅属主可读写。
  const chatSessionOwned = (sId) => {
    if (isAdmin) return true;
    const row = db.prepare('SELECT user_id FROM chat_sessions WHERE id=?').get(String(sId || ''));
    if (!row) return true;
    const uid = Number(row.user_id || 0);
    return uid === 0 || uid === Number(sessionUser?.id || 0);
  };

  if (pathname === '/chat/sessions' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const sessions = db.prepare('SELECT * FROM chat_sessions WHERE user_id=? OR user_id=0 ORDER BY updated_at DESC LIMIT 50')
      .all(sessionUser?.id || 0);
    return sendJson(res, 200, { success: true, data: sessions });
  }

  // 2. 创建或更新会话
  if (pathname === '/chat/sessions' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    const sessionId = b.id || `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const title = (b.title || '新创作会话').slice(0, 50);
    const now = Date.now();
    db.prepare(`
      INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at
    `).run(sessionId, sessionUser?.id || 0, title, now, now);
    return sendJson(res, 200, { success: true, data: { id: sessionId, title, updated_at: now } });
  }

  // 3. 删除会话
  const mDelSess = pathname.match(/^\/chat\/sessions\/([^\/]+)$/);
  if (mDelSess && req.method === 'DELETE') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const sId = decodeURIComponent(mDelSess[1]);
    if (!chatSessionOwned(sId)) return sendJson(res, 403, { error: '无权操作该会话' });
    db.prepare('DELETE FROM chat_messages WHERE session_id=?').run(sId);
    db.prepare('DELETE FROM chat_sessions WHERE id=?').run(sId);
    return sendJson(res, 200, { success: true });
  }

  // 4. 获取会话消息流
  if (pathname === '/chat/messages' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const sId = urlObj.searchParams.get('sessionId') || 'default_session';
    if (!chatSessionOwned(sId)) return sendJson(res, 403, { error: '无权读取该会话' });
    const limit = Math.min(200, parseInt(urlObj.searchParams.get('limit') || '100', 10));
    const messages = db.prepare(`
      SELECT * FROM chat_messages
      WHERE session_id=?
      ORDER BY created_at ASC LIMIT ?
    `).all(sId, limit);
    return sendJson(res, 200, { success: true, data: messages.map(m => {
      let params = {};
      let images = [];
      let result = null;
      try { params = JSON.parse(m.params_json || '{}'); } catch {}
      try { images = JSON.parse(m.images_json || '[]'); } catch {}
      try { result = JSON.parse(m.result_json || 'null'); } catch {}
      return { ...m, params, images, result };
    }) });
  }

  // 5. 新增/更新单条消息
  if (pathname === '/chat/messages' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    const sessionId = b.sessionId || 'default_session';
    if (!chatSessionOwned(sessionId)) return sendJson(res, 403, { error: '无权写入该会话' });
    const msgId = b.id || `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();
    const role = b.role || 'user';
    const mode = b.mode || 'text_to_image';
    const prompt = b.prompt || '';
    const paramsJson = JSON.stringify(b.params || {});
    const imagesJson = JSON.stringify(b.images || []);
    const status = b.status || 'done';
    const runId = b.runId || null;
    const engine = b.engine || null;
    const resultJson = b.result ? JSON.stringify(b.result) : null;

    db.prepare(`
      INSERT INTO chat_messages (id, session_id, user_id, role, mode, prompt, params_json, images_json, status, run_id, engine, result_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status,
        result_json=COALESCE(excluded.result_json, chat_messages.result_json),
        updated_at=excluded.updated_at
    `).run(msgId, sessionId, sessionUser?.id || 0, role, mode, prompt, paramsJson, imagesJson, status, runId, engine, resultJson, b.createdAt || now, now);

    if (b.generate === true && role === 'user' && prompt) {
      try {
        const { packHistory } = require('./chat-context');
        const { OFFICIAL_STUDIO, resolveModelCode } = require('./studio-catalog');
        const rows = db.prepare(
          'SELECT role, prompt FROM chat_messages WHERE session_id=? ORDER BY created_at ASC'
        ).all(sessionId);
        const packed = packHistory(rows);
        let messages = packed.messages.slice();
        if (packed.overflow && packed.olderText) {
          const summed = await executeChatCompletion(db, config, {
            model: 'workflow_vision',
            messages: [{ role: 'user', content: `把下面的对话压成一段中文摘要，不要编造：\n${packed.olderText.slice(0, 8000)}` }],
            max_tokens: 400,
            timeoutMs: 60000,
          });
          const summary = summed?.choices?.[0]?.message?.content || packed.olderText.slice(0, 800);
          messages = [{ role: 'system', content: `更早对话摘要：${summary}` }, ...messages];
        }
        const chatCode = resolveModelCode(b.model || OFFICIAL_STUDIO.chat.defaultModel) || b.model;
        const data = await executeChatCompletion(db, config, {
          model: chatCode,
          messages,
          images: Array.isArray(b.images) ? b.images : [],
          max_tokens: b.max_tokens || 1024,
          timeoutMs: b.timeoutMs || 90000,
        });
        const reply = data?.choices?.[0]?.message?.content || '';
        const asstId = `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const asstNow = Date.now();
        db.prepare(`
          INSERT INTO chat_messages (id, session_id, user_id, role, mode, prompt, params_json, images_json, status, run_id, engine, result_json, created_at, updated_at)
          VALUES (?, ?, ?, 'assistant', ?, ?, '{}', '[]', 'done', NULL, 'chat', NULL, ?, ?)
        `).run(asstId, sessionId, sessionUser?.id || 0, mode, reply, asstNow, asstNow);
        return sendJson(res, 200, { success: true, data: { id: msgId, reply, status: 'done', updated_at: asstNow } });
      } catch (e) {
        return sendJson(res, 200, { success: true, data: { id: msgId, reply: '', error: e.message, status: 'failed' } });
      }
    }

    // 自动维护 session 的 updated_at
    const sessionTitle = (prompt ? prompt.slice(0, 30) : 'AI 创作会话');
    db.prepare(`
      INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at=excluded.updated_at,
        title=CASE
          WHEN chat_sessions.title IN ('新创作会话', '空间美学创作会话', 'AI 创作会话', '')
          THEN excluded.title
          ELSE chat_sessions.title
        END
    `).run(sessionId, sessionUser?.id || 0, sessionTitle, now, now);

    return sendJson(res, 200, { success: true, data: { id: msgId, status, updated_at: now } });
  }

  // 6. 清空会话内消息
  if (pathname === '/chat/messages' && req.method === 'DELETE') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const sId = urlObj.searchParams.get('sessionId') || 'default_session';
    if (!chatSessionOwned(sId)) return sendJson(res, 403, { error: '无权操作该会话' });
    db.prepare('DELETE FROM chat_messages WHERE session_id=?').run(sId);
    return sendJson(res, 200, { success: true });
  }

  // 7. 按生成模型系统提示词优化（无万能稿）
  if (pathname === '/chat/optimize-prompt' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    const rawPrompt = (b.prompt || '').trim();
    if (!rawPrompt) return sendJson(res, 400, { error: '提示词不能为空' });
    const modelId = String(b.modelId || b.model_id || '').trim();
    const mode = String(b.mode || '').trim() || 'default';
    if (!modelId) return sendJson(res, 400, { error: '必须提供 modelId' });
    const polish = genGov.polishFor(db, modelId);
    const customPrompt = typeof b.draftPrompt === 'string' ? b.draftPrompt.trim() : (typeof b.customSkillPrompt === 'string' ? b.customSkillPrompt.trim() : '');
    let systemPrompt = customPrompt || polish.prompt;
    if (!systemPrompt) return sendJson(res, 400, { error: `模型 ${modelId} 没有系统提示词` });

    // 按需叠加勾选的公共提示词积木（如《室内实拍真实感与反塑料感》），不污染未勾选的视频/音乐/人像/服装
    const requestedSnippets = Array.isArray(b.snippetIds)
      ? b.snippetIds
      : (b.includeInteriorRealism ? ['snippet_interior_realism'] : []);
    if (requestedSnippets.length) {
      try {
        const { resolveSnippets } = require('./prompt-compiler');
        const snips = resolveSnippets(db, requestedSnippets);
        if (snips.length) {
          const posBlock = snips.map(s => s.positive_text).filter(Boolean).join('\n');
          const negBlock = snips.map(s => s.negative_text).filter(Boolean).join(', ');
          systemPrompt += `\n\n【本次生成附加画面真实感与质量积木要求（请自然融入改写结果，不要生硬照抄标题）】：\n${posBlock}`;
          if (negBlock) {
            systemPrompt += `\n【严禁出现的负面元素与空话】：${negBlock}`;
          }
        }
      } catch (_) {}
    }
    const opt = genGov.resolveOptimizerModel(db, modelId);
    const chosenModel = b.optimizerModelId || opt.modelCode || opt.modelId;
    const slots = b.slots || {};
    const locked = b.locked || b.params || {};
    const refImages = [
      ...(Array.isArray(b.imageUrls) ? b.imageUrls : []),
      ...(Array.isArray(b.images) ? b.images : []),
      ...(b.image ? [b.image] : [])
    ].filter(Boolean);
    // 优化只吃「当前提示词 + 本次上传的图片」，不再携带会话上下文
    const userMsg = [
      `原文：\n${rawPrompt}`,
      `当前生成模型: ${modelId}`,
      `当前模式: ${mode}`,
      `已挂槽位: ${JSON.stringify(slots)}`,
      refImages.length ? `已挂载参考图 ${refImages.length} 张。请结合图片里的真实空间、材质和光影来写。正文必须保留 @图片1 到 @图片${refImages.length}，每个编号都要出现，不要删掉，也不要改成「参考图」「这张图」或「图1」。` : '',
      `已锁定参数（不要写进提示词）: ${JSON.stringify(locked)}`,
    ].filter(Boolean).join('\n');

    try {
      const data = await executeChatCompletion(db, config, {
        model: chosenModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg }
        ],
        images: refImages,
        temperature: opt.temperature,
        max_tokens: 2048,
        timeoutMs: opt.timeoutMs || 90000
      });
      const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
      if (!content) return sendJson(res, 502, { error: '优化器未返回内容' });
      const optimized = content.replace(/^["'“”]+|["'“”]+$/g, '');
      // ★ 管线 A 最后一道闸门：分辨率 / 时长 / 画幅比属于参数，不得留在提示词正文里
      const check = require('./prompt-validate').validateOptimizedPrompt(optimized);
      return sendJson(res, 200, {
        success: true,
        data: {
          original: rawPrompt,
          optimized: check.text,
          mode,
          modelId,
          warnings: check.warnings,
          stripped: check.stripped,
        },
      });
    } catch (e) {
      const msg = e.name === 'AbortError' || /timeout/i.test(e.message || '') ? '提示词优化超时，请重试' : (e.message || '优化失败');
      return sendJson(res, 502, { error: msg });
    }
  }

  // ===== 企业级 AI 创作库 (配方模板、原图、目标图、分类筛选与参数复用) (/api/creation-templates) =====
  if (pathname === '/creation-templates' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const kw = (urlObj.searchParams.get('q') || '').trim();
    const filterType = (urlObj.searchParams.get('type') || '').trim(); // 'image' | 'video' | 'audio'
    const filterSpace = (urlObj.searchParams.get('space') || '').trim();
    const filterStyle = (urlObj.searchParams.get('style') || '').trim();
    const pinnedOnly = urlObj.searchParams.get('pinned_only') === '1';

    if (!schemaCheckedOnce(db, 'creation_templates')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS creation_templates (
          id TEXT PRIMARY KEY,
          user_id INTEGER DEFAULT 1,
          title TEXT NOT NULL,
          prompt TEXT NOT NULL,
          aspect_ratio TEXT DEFAULT '16:9',
          origin_images TEXT DEFAULT '[]',
          result_images TEXT DEFAULT '[]',
          params_json TEXT DEFAULT '{}',
          tags TEXT DEFAULT '[]',
          type TEXT DEFAULT 'image',
          space TEXT DEFAULT '',
          style TEXT DEFAULT '',
          is_pinned INTEGER DEFAULT 0,
          use_count INTEGER DEFAULT 0,
          created_at INTEGER,
          updated_at INTEGER
        );
      `);
      try { db.exec("ALTER TABLE creation_templates ADD COLUMN type TEXT DEFAULT 'image';"); } catch (e) {}
      try { db.exec("ALTER TABLE creation_templates ADD COLUMN space TEXT DEFAULT '';"); } catch (e) {}
      try { db.exec("ALTER TABLE creation_templates ADD COLUMN style TEXT DEFAULT '';"); } catch (e) {}
      try { db.exec("ALTER TABLE creation_templates ADD COLUMN is_pinned INTEGER DEFAULT 0;"); } catch (e) {}
      try { db.exec("ALTER TABLE creation_templates ADD COLUMN use_count INTEGER DEFAULT 0;"); } catch (e) {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_creation_tpl_sort ON creation_templates(is_pinned DESC, use_count DESC, updated_at DESC);"); } catch (e) {}
    }

    let sql = 'SELECT * FROM creation_templates WHERE 1=1';
    const params = [];

    if (filterType && filterType !== 'all') {
      sql += ' AND type = ?';
      params.push(filterType);
    }
    if (filterSpace && filterSpace !== 'all' && filterSpace !== '全部空间') {
      sql += ' AND space = ?';
      params.push(filterSpace);
    }
    if (filterStyle && filterStyle !== 'all' && filterStyle !== '全部风格') {
      sql += ' AND style = ?';
      params.push(filterStyle);
    }
    if (pinnedOnly) {
      sql += ' AND is_pinned = 1';
    }
    if (kw) {
      sql += ' AND (LOWER(title) LIKE ? OR LOWER(prompt) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(space) LIKE ? OR LOWER(style) LIKE ?)';
      params.push(`%${kw.toLowerCase()}%`, `%${kw.toLowerCase()}%`, `%${kw.toLowerCase()}%`, `%${kw.toLowerCase()}%`, `%${kw.toLowerCase()}%`);
    }

    sql += ' ORDER BY is_pinned DESC, use_count DESC, updated_at DESC LIMIT 100';
    const rows = db.prepare(sql).all(...params);

    return sendJson(res, 200, {
      success: true,
      data: rows.map(r => {
        let origin_images = [];
        let result_images = [];
        let params = {};
        let tags = [];
        try { origin_images = JSON.parse(r.origin_images || '[]'); } catch {}
        try { result_images = JSON.parse(r.result_images || '[]'); } catch {}
        try { params = JSON.parse(r.params_json || '{}'); } catch {}
        try { tags = JSON.parse(r.tags || '[]'); } catch {}
        return {
          ...r,
          type: r.type || 'image',
          space: r.space || '',
          style: r.style || '',
          is_pinned: Number(r.is_pinned || 0),
          use_count: Number(r.use_count || 0),
          origin_images,
          result_images,
          params,
          tags
        };
      })
    });
  }

  // 保存/收藏创作配方 (新建或全量保存)
  if (pathname === '/creation-templates' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    const title = (b.title || '').trim();
    const prompt = (b.prompt || '').trim();
    if (!title || !prompt) return sendJson(res, 400, { error: '创作标题与提示词不可为空' });

    const id = b.id || `tpl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const aspectRatio = b.aspect_ratio || b.aspectRatio || '16:9';
    const originImages = JSON.stringify(b.origin_images || b.originImages || []);
    const resultImages = JSON.stringify(b.result_images || b.resultImages || []);
    const paramsJson = JSON.stringify(b.params || {});
    const tagsJson = JSON.stringify(b.tags || ['用户自定义']);
    const type = b.type || 'image'; // image / video / audio
    const space = (b.space || '').trim();
    const style = (b.style || '').trim();
    const isPinned = b.is_pinned ? 1 : 0;
    const useCount = Number(b.use_count || 0);
    const now = Date.now();

    db.prepare(`
      INSERT INTO creation_templates (id, user_id, title, prompt, aspect_ratio, origin_images, result_images, params_json, tags, type, space, style, is_pinned, use_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,
        prompt=excluded.prompt,
        aspect_ratio=excluded.aspect_ratio,
        origin_images=excluded.origin_images,
        result_images=excluded.result_images,
        params_json=excluded.params_json,
        tags=excluded.tags,
        type=excluded.type,
        space=excluded.space,
        style=excluded.style,
        is_pinned=excluded.is_pinned,
        use_count=excluded.use_count,
        updated_at=excluded.updated_at
    `).run(id, sessionUser?.id || 1, title, prompt, aspectRatio, originImages, resultImages, paramsJson, tagsJson, type, space, style, isPinned, useCount, b.createdAt || now, now);

    return sendJson(res, 200, {
      success: true,
      data: { id, title, prompt, type, space, style, is_pinned: isPinned, use_count: useCount, updated_at: now }
    });
  }

  // 快捷更新创作配方 (重命名、置顶/常用切换、复用自增、修改标签)
  const mPatchTpl = pathname.match(/^\/creation-templates\/([^\/]+)$/);
  if (mPatchTpl && req.method === 'PATCH') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const tplId = decodeURIComponent(mPatchTpl[1]);
    const b = await parseBody(req);
    const existing = db.prepare('SELECT * FROM creation_templates WHERE id=?').get(tplId);
    if (!existing) return sendJson(res, 404, { error: '作品配方不存在' });
    // SEC-007：仅属主或管理员可改他人配方
    if (!isAdmin && Number(existing.user_id) !== Number(sessionUser?.id)) {
      return sendJson(res, 403, { error: '无权修改他人配方' });
    }

    let newTitle = b.title !== undefined ? String(b.title).trim() : existing.title;
    if (!newTitle) return sendJson(res, 400, { error: '作品名称不可为空' });
    let newIsPinned = b.is_pinned !== undefined ? (b.is_pinned ? 1 : 0) : Number(existing.is_pinned || 0);
    let newUseCount = Number(existing.use_count || 0);
    if (b.action === 'use') {
      newUseCount += 1;
    } else if (b.use_count !== undefined) {
      newUseCount = Number(b.use_count) || 0;
    }
    let newSpace = b.space !== undefined ? String(b.space).trim() : (existing.space || '');
    let newStyle = b.style !== undefined ? String(b.style).trim() : (existing.style || '');
    let newType = b.type !== undefined ? String(b.type).trim() : (existing.type || 'image');
    let newPrompt = b.prompt !== undefined ? String(b.prompt).trim() : existing.prompt;
    let newTags = b.tags !== undefined ? JSON.stringify(b.tags) : existing.tags;
    const now = Date.now();

    db.prepare(`
      UPDATE creation_templates 
      SET title=?, is_pinned=?, use_count=?, space=?, style=?, type=?, prompt=?, tags=?, updated_at=?
      WHERE id=?
    `).run(newTitle, newIsPinned, newUseCount, newSpace, newStyle, newType, newPrompt, newTags, now, tplId);

    return sendJson(res, 200, {
      success: true,
      data: {
        id: tplId,
        title: newTitle,
        is_pinned: newIsPinned,
        use_count: newUseCount,
        space: newSpace,
        style: newStyle,
        type: newType,
        updated_at: now
      }
    });
  }

  // 删除创作配方
  const mDelTpl = pathname.match(/^\/creation-templates\/([^\/]+)$/);
  if (mDelTpl && req.method === 'DELETE') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const tplId = decodeURIComponent(mDelTpl[1]);
    // SEC-007：仅属主或管理员可删
    const tplRow = db.prepare('SELECT user_id FROM creation_templates WHERE id=?').get(tplId);
    if (tplRow && !isAdmin && Number(tplRow.user_id) !== Number(sessionUser?.id)) {
      return sendJson(res, 403, { error: '无权删除他人配方' });
    }
    db.prepare('DELETE FROM creation_templates WHERE id=?').run(tplId);
    return sendJson(res, 200, { success: true, data: { id: tplId } });
  }


  // 8. 快捷实例分割 (YOLO-seg 探测 + 顺时针透视四点 quad 与多边形 polygon 提取)
  if ((pathname === '/ai/segment' || pathname === '/ai/detect') && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    const yoloHost = process.env.YOLO_SEG_URL || 'http://127.0.0.1:5001/detect';
    
    // 默认高精度室内家具 Fallback 数据 (符合客户端吸附与替换规范)
    const buildFallbackDetections = () => [
      {
        id: 'det_sofa_001',
        label: '意式三人真皮沙发',
        class_name: 'sofa',
        confidence: 0.94,
        bbox: { x1: 150, y1: 420, x2: 780, y2: 890 },
        quad: [[170, 440], [760, 425], [750, 875], [160, 885]],
        polygon: [[170, 440], [300, 435], [520, 430], [760, 425], [770, 600], [750, 875], [450, 880], [160, 885]],
        mask_url: '/api/viewer/ai/masks/seg_sofa_001.png'
      },
      {
        id: 'det_table_002',
        label: '极简悬浮岩板茶几',
        class_name: 'dining table',
        confidence: 0.89,
        bbox: { x1: 320, y1: 720, x2: 680, y2: 980 },
        quad: [[330, 730], [670, 725], [660, 970], [325, 975]],
        polygon: [[330, 730], [500, 726], [670, 725], [665, 850], [660, 970], [490, 973], [325, 975], [328, 850]]
      },
      {
        id: 'det_chair_003',
        label: '意式轻奢休闲单椅',
        class_name: 'chair',
        confidence: 0.86,
        bbox: { x1: 50, y1: 450, x2: 240, y2: 750 },
        quad: [[60, 460], [230, 455], [225, 740], [55, 745]],
        polygon: [[60, 460], [145, 458], [230, 455], [228, 600], [225, 740], [140, 743], [55, 745], [58, 600]]
      }
    ];

    try {
      if (b.image) {
        let imgBuf = null;
        const rawImg = String(b.image).trim();
        if (rawImg.startsWith('data:image')) {
          const parts = rawImg.split(',');
          if (parts.length === 2) imgBuf = Buffer.from(parts[1], 'base64');
        } else if (/^https?:\/\//i.test(rawImg)) {
          const r = await fetch(rawImg, { signal: AbortSignal.timeout(3000) });
          if (r.ok) imgBuf = Buffer.from(await r.arrayBuffer());
        } else {
          // LOGIC-003：原实现走 HTTP 自环 fetch，且引用了本模块不存在的 PORT 变量——
          // 必然 ReferenceError 被空 catch 吞掉，imgBuf 恒为 null，YOLO 必失败，
          // 最终退回 buildFallbackDetections 的硬编码假坐标。改为进程内直接解析：
          // 缩略图优先（与原 /image 端点行为一致），缺失时回退主产物/origin。
          try {
            const thumb = path.join(config.dataDir, 'cache', 'thumbs', `${rawImg}.jpg`);
            if (fs.existsSync(thumb)) {
              imgBuf = fs.readFileSync(thumb);
            } else {
              let deriv = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? AND kind='origin' LIMIT 1").get(rawImg);
              if (!deriv) {
                const a = db.prepare('SELECT main_derivative_id FROM assets WHERE fid=?').get(rawImg);
                if (a?.main_derivative_id) deriv = db.prepare('SELECT * FROM derivatives WHERE id=?').get(a.main_derivative_id);
              }
              if (!deriv) {
                deriv = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? ORDER BY CASE kind WHEN 'origin' THEN 0 ELSE 1 END LIMIT 1").get(rawImg);
              }
              if (deriv) {
                const fp = await resolveDerivativeFile(services, deriv);
                if (fp && fs.existsSync(fp)) imgBuf = fs.readFileSync(fp);
              }
            }
          } catch (e) {}
        }

        if (imgBuf && imgBuf.length > 0) {
          const form = new FormData();
          const blob = new Blob([imgBuf], { type: 'image/jpeg' });
          form.append('image', blob, 'input.jpg');
          if (b.conf) form.append('conf', String(b.conf));
          if (b.iou) form.append('iou', String(b.iou));

          const controller = new AbortController();
          const tId = setTimeout(() => controller.abort(), 6000);
          const yoloRes = await fetch(yoloHost, {
            method: 'POST',
            body: form,
            signal: controller.signal
          }).finally(() => clearTimeout(tId));

          if (yoloRes.ok) {
            const yoloData = await yoloRes.json();
            if (yoloData.success && Array.isArray(yoloData.detections)) {
              // 提取并补齐 quad 与 polygon
              const detections = yoloData.detections.map((d, idx) => {
                const bx = d.bbox || {};
                const x1 = bx.x1 ?? 0;
                const y1 = bx.y1 ?? 0;
                const x2 = bx.x2 ?? 100;
                const y2 = bx.y2 ?? 100;
                const quad = d.quad || [
                  [Math.round(x1), Math.round(y1)],
                  [Math.round(x2), Math.round(y1)],
                  [Math.round(x2), Math.round(y2)],
                  [Math.round(x1), Math.round(y2)]
                ];
                const polygon = d.polygon || [
                  [Math.round(x1), Math.round(y1)],
                  [Math.round((x1 + x2) / 2), Math.round(y1)],
                  [Math.round(x2), Math.round(y1)],
                  [Math.round(x2), Math.round((y1 + y2) / 2)],
                  [Math.round(x2), Math.round(y2)],
                  [Math.round((x1 + x2) / 2), Math.round(y2)],
                  [Math.round(x1), Math.round(y2)],
                  [Math.round(x1), Math.round((y1 + y2) / 2)]
                ];
                return {
                  id: `det_${d.class_name || 'obj'}_${idx + 1}`,
                  label: d.label || d.class_name || '家具对象',
                  class_name: d.class_name || 'object',
                  confidence: d.score ?? d.confidence ?? 0.9,
                  bbox: { x1, y1, x2, y2 },
                  quad,
                  polygon,
                  mask_url: d.mask_png || undefined
                };
              });

              return sendJson(res, 200, {
                success: true,
                data: {
                  detections,
                  fallback: false,
                  inference_time: yoloData.inference_time
                }
              });
            }
          }
        }
      }
    } catch (e) {}

    return sendJson(res, 200, {
      success: true,
      data: {
        detections: buildFallbackDetections(),
        fallback: true
      }
    });
  }

  // 9. 产品模型预置列表与预览图/GLB下载
  if (pathname === '/products/presets' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    let rows = [];
    try {
      rows = db.prepare('SELECT * FROM product_presets WHERE enabled=1 ORDER BY sort ASC, id ASC').all();
    } catch (e) {}
    
    if (!rows || rows.length === 0) {
      rows = [
        {
          id: 'sofa_electric_single',
          name: '极简单人电动真皮沙发',
          category: 'furniture',
          facing: 45,
          preview_file: 'sofa_single.png',
          model_file: 'sofa_electric_single.glb',
          tags_json: JSON.stringify(['单人位', '电动展开', '意大利头层牛皮', '极简奶油风']),
          dimensions_json: JSON.stringify({ width: 950, depth: 1050, height: 920 })
        }
      ];
    }

    const presets = rows.map(r => {
      let tags = [];
      let dimensions = null;
      try { tags = JSON.parse(r.tags_json || '[]'); } catch {}
      try { dimensions = JSON.parse(r.dimensions_json || '{}'); } catch {}
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        facing: typeof r.facing === 'number' ? r.facing : 180,
        preview_url: `/api/viewer/products/previews/${r.preview_file || (r.id + '.png')}`,
        model_url: `/api/viewer/products/models/${r.model_file || 'sofa_default.glb'}`,
        tags,
        dimensions
      };
    });
    return sendJson(res, 200, { success: true, data: presets });
  }

  const mProdPreview = pathname.match(/^\/products\/previews\/([^\/]+)$/);
  if (mProdPreview && req.method === 'GET') {
    // SEC-003：先解码再取 basename，杜绝 ..%2F..%2F 型 URL 编码路径穿越。
    const fn = path.basename(decodeURIComponent(mProdPreview[1]));
    if (!fn || fn === '.' || fn === '..') return sendJson(res, 400, { error: '非法文件名' });
    const candidateDirs = [
      path.join(__dirname, '../data/previews'),
      path.join(process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library'), 'previews')
    ];
    let found = null;
    for (const d of candidateDirs) {
      const cp = path.join(d, fn);
      if (fs.existsSync(cp)) { found = cp; break; }
    }
    if (!found) return sendJson(res, 404, { error: '预览图未找到' });
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400'
    });
    return fs.createReadStream(found).pipe(res);
  }

  const mProdGlb = pathname.match(/^\/products\/models\/([^\/]+)$/);
  if (mProdGlb && req.method === 'GET') {
    // SEC-003：同 previews，basename 防穿越。
    const fn = path.basename(decodeURIComponent(mProdGlb[1]));
    if (!fn || fn === '.' || fn === '..') return sendJson(res, 400, { error: '非法文件名' });
    const candidatePaths = [
      path.join(__dirname, '../data/models', fn),
      path.join(process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library'), 'models', fn),
      path.join('Y:/home/lrp/my_folder/smu/KX2BFK_umbra_quick', fn),
      path.join('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/data/models', fn),
      path.join('C:/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/data/models', fn),
      path.join('C:/Users/lrp/Doubao/chats/2026-09-04/new-chat', fn),
      path.join('/mnt/c/Users/lrp/Doubao/chats/2026-09-04/new-chat', fn)
    ];
    let found = null;
    for (const cp of candidatePaths) {
      if (fs.existsSync(cp)) { found = cp; break; }
    }
    if (!found) return sendJson(res, 404, { error: '3D 模型文件未找到' });
    res.writeHead(200, {
      'Content-Type': 'model/gltf-binary',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400'
    });
    return fs.createReadStream(found).pipe(res);
  }

  // 上传单品 GLB / 预览
  // POST /products/upload  { name, model_b64, preview_b64?, tags?, dimensions? }
  if (pathname === '/products/upload' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      const name = String(b.name || '自定义单品').slice(0, 80);
      const id = 'custom_' + Date.now().toString(36);
      let modelFile = id + '.glb';
      const modelB64 = String(b.model_b64 || b.modelB64 || '').replace(/^data:[^,]+,/, '');
      if (!modelB64) return sendJson(res, 400, { error: '缺少 model_b64（GLB）' });
      const modelsDir = path.join(
        process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library'),
        'models'
      );
      fs.mkdirSync(modelsDir, { recursive: true });
      const modelPath = path.join(modelsDir, modelFile);
      fs.writeFileSync(modelPath, Buffer.from(modelB64, 'base64'));
      let previewFile = '';
      const previewB64 = String(b.preview_b64 || b.previewB64 || '').replace(/^data:[^,]+,/, '');
      if (previewB64) {
        previewFile = id + '.png';
        const previewsDir = path.join(
          process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library'),
          'previews'
        );
        fs.mkdirSync(previewsDir, { recursive: true });
        fs.writeFileSync(path.join(previewsDir, previewFile), Buffer.from(previewB64, 'base64'));
      }
      try {
        db.prepare(`
          CREATE TABLE IF NOT EXISTS product_presets (
            id TEXT PRIMARY KEY,
            name TEXT,
            category TEXT,
            facing REAL DEFAULT 45,
            preview_file TEXT,
            model_file TEXT,
            tags_json TEXT,
            dimensions_json TEXT,
            enabled INTEGER DEFAULT 1,
            sort INTEGER DEFAULT 100,
            created_at INTEGER
          )
        `).run();
        db.prepare(`
          INSERT INTO product_presets (id, name, category, facing, preview_file, model_file, tags_json, dimensions_json, enabled, sort, created_at)
          VALUES (?,?,?,?,?,?,?,?,1,?,?)
        `).run(
          id,
          name,
          b.category || 'furniture',
          Number(b.facing || 45),
          previewFile,
          modelFile,
          JSON.stringify(b.tags || []),
          JSON.stringify(b.dimensions || {}),
          100,
          Date.now()
        );
      } catch (e) {
        return sendJson(res, 500, { error: '入库失败: ' + e.message });
      }
      return sendJson(res, 200, {
        success: true,
        data: {
          id,
          name,
          model_url: `/api/viewer/products/models/${modelFile}`,
          preview_url: previewFile ? `/api/viewer/products/previews/${previewFile}` : null,
        },
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 按需处理任务：提交 / 查询
  const mProc = pathname.match(/^\/assets\/([^\/]+)\/process$/);
  if (mProc && req.method === 'POST') {
    const fid = decodeURIComponent(mProc[1]);
    const b = await parseBody(req);
    try {
      const job = processSvc.enqueueProcessJob(db, {
        assetFid: fid,
        presetId: b.preset_id || null,
        action: b.action,
        params: b.params,
        createdBy: sessionUser?.username || 'viewer'
      });
      return sendJson(res, 200, { success: true, data: job });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  if (mProc && req.method === 'GET') {
    const fid = decodeURIComponent(mProc[1]);
    return sendJson(res, 200, { success: true, data: { items: processSvc.listProcessJobs(db, fid) } });
  }

  // GET /ai/masks/:id — 引擎拉取涂抹/四点栅格化遮罩
  const mAiMask = pathname.match(/^\/ai\/masks\/([^\/]+)$/);
  if (mAiMask && req.method === 'GET') {
    const maskId = decodeURIComponent(mAiMask[1]);
    const filePath = umbra.resolveMaskFile(config, maskId);
    if (!filePath) return sendJson(res, 404, { success: false, error: '遮罩不存在' });
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=300' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // POST /ai/upload — 精修贴图/遮罩临时上传，返回引擎可拉 URL
  if (pathname === '/ai/upload' && req.method === 'POST') {
    try {
      const { parseMultipart, readRequestBuffer } = require('./ingest');
      const ct = String(req.headers['content-type'] || '');
      if (!ct.includes('multipart/form-data')) {
        return sendJson(res, 400, { success: false, error: '需要 multipart file' });
      }
      const buf = await readRequestBuffer(req, 40 * 1024 * 1024);
      const { files } = parseMultipart(buf, ct);
      const file = files.find((f) => f.name === 'file') || files[0];
      if (!file || !file.data) return sendJson(res, 400, { success: false, error: '缺少 file' });
      const ext = path.extname(file.filename || '') || '.png';
      const saved = await umbra.persistUploadedBuffer(db, config, file.data, ext);
      return sendJson(res, 200, { success: true, data: { id: saved.maskId, url: saved.url } });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // ===== 快捷操作能力注册表与就绪状态查询 =====
  // GET /ai/capabilities
  if (pathname === '/ai/capabilities' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const caps = getCapabilities(db);
    return sendJson(res, 200, { success: true, data: caps });
  }

  if (pathname === '/exports/register' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req, 16 * 1024 * 1024);
    try {
      const { registerExport } = require('./export-registry');
      const crypto = require('crypto');
      let sha = String(b.sha256 || '').trim().toLowerCase();
      let phash = String(b.phash || '').trim();
      const raw = b.image || b.imageBase64 || '';
      if (raw) {
        const cleaned = String(raw).replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(cleaned, 'base64');
        if (!buf.length) return sendJson(res, 400, { error: '图片为空' });
        sha = crypto.createHash('sha256').update(buf).digest('hex');
        try {
          const fp = require('./fingerprint');
          const info = await fp.computeFingerprints(buf, 'export.jpg');
          phash = info.phash || phash;
        } catch (_) {}
      }
      if (!/^[a-f0-9]{64}$/.test(sha)) return sendJson(res, 400, { error: '缺少有效 sha256' });
      const row = registerExport(services.db, {
        sha256: sha,
        phash,
        sourceFid: b.sourceFid || b.fid || '',
        kind: b.kind || 'edit',
        marker: b.marker || '',
      });
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message || '登记失败' });
    }
  }

  // ===== 统一精修 /edit/run =====
  // POST /edit/run  { assetFid|image, op, region, prompt?, glb?, product? }
  if (pathname === '/edit/run' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      const { handleEditRun } = require('./handlers/edit-run');
      const aiTasksMod = require('./ai-tasks');
      // 复用素材解析
      const resolveAssetBuffer = aiTasksMod.resolveAssetBuffer || (async (svc, raw) => {
        if (!raw) return null;
        const s = String(raw).trim();
        if (s.startsWith('data:image/')) return Buffer.from(s.split(',')[1], 'base64');
        const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(s);
        if (!asset) return null;
        const { ensureOriginalFile } = require('./originals');
        const p = await ensureOriginalFile(services, asset);
        return p ? fs.readFileSync(p) : null;
      });
      const sceneImageBuffer = await resolveAssetBuffer(services, b.image || b.assetFid || b.fid);
      if (!sceneImageBuffer) return sendJson(res, 400, { error: '无法读取源图' });

      let refImageBuffer = null;
      if (b.refImage || b.ref_image || (b.glb && b.glb.viewDataUrl)) {
        refImageBuffer = await resolveAssetBuffer(services, b.refImage || b.ref_image || (b.glb && b.glb.viewDataUrl));
      }
      let productImageBuffer = null;
      if (b.productImage || b.product_image) {
        productImageBuffer = await resolveAssetBuffer(services, b.productImage || b.product_image);
      }

      const out = await handleEditRun(services, {
        sceneImageBuffer,
        op: b.op,
        region: b.region,
        prompt: b.prompt,
        productName: b.subject || b.productName,
        targetStyle: b.targetStyle || b.style || b.target_style,
        sourceStyle: b.sourceStyle || b.source_style,
        strengthLevel: b.strengthLevel || b.strength,
        stylePrompt: b.stylePrompt || b.style_prompt || b.styleDescription,
        extraPrompt: b.extraPrompt || b.extra_prompt,
        assetFid: b.assetFid || b.fid,
        yaw: (b.glb && b.glb.yaw) != null ? b.glb.yaw : (b.yaw != null ? b.yaw : b.modelYaw),
        refImageBuffer,
        productImageBuffer,
        glbFid: (b.glb && b.glb.modelUrl) || b.glbFid,
        pasteback: b.pasteback,
        installMode: b.installMode || b.fidelity || 'B',
        expandRatios: b.expandRatios,
        expandRatio: b.expandRatio,
        useJimeng: b.useJimeng !== false,
        model: b.model,
        targetClarity: b.targetClarity || b.clarity || null,
        removeWatermark: b.removeWatermark === true || b.remove_watermark === true,
        vlmInfo: b.vlmInfo || b.vlm_info || null,
        describeRegion: b.describeRegion,
        avoidBBox: b.avoidBBox || b.clearBBox,
        gapPct: b.gapPct || b.addGapPct,
      });

      return sendJson(res, 200, {
        success: true,
        data: {
          image: { b64: out.buffer.toString('base64') },
          apiBox: out.apiBox,
          untouchedDiff: out.untouchedDiff,
          prompt: out.prompt,
          // ★ 选区出口 / 是否降级 / 降级原因；客户端必须把 regionNote 原样展示给用户
          region: out.region || null,
          regionNote: out.regionNote || '',
        },
      });
    } catch (e) {
      console.error('[edit/run] 执行失败:', e);
      return sendJson(res, 502, { success: false, error: e.message });
    }
  }

  // ===== 自定义风格库（风格迁移） =====
  if (pathname === '/custom-styles' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const { listCustomStyles } = require('./custom-styles');
      return sendJson(res, 200, { success: true, data: listCustomStyles(db) });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message || '自定义风格读取失败' });
    }
  }
  if (pathname === '/custom-styles' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      const { createCustomStyle } = require('./custom-styles');
      const row = createCustomStyle(db, {
        name: b.name,
        description: b.description || b.desc,
        aiPrompt: b.aiPrompt || b.ai_prompt,
        actor: sessionUser?.username || '',
      });
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message || '自定义风格保存失败' });
    }
  }
  const mCustomStyle = pathname.match(/^\/custom-styles\/([^/]+)$/);
  if (mCustomStyle && (req.method === 'PUT' || req.method === 'DELETE')) {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const styleId = decodeURIComponent(mCustomStyle[1]);
    const styleStore = require('./custom-styles');
    const existing = styleStore.getCustomStyle(db, styleId);
    if (!existing) return sendJson(res, 404, { success: false, error: '自定义风格不存在' });
    if (!isAdmin && existing.createdBy && existing.createdBy !== (sessionUser?.username || '')) {
      return sendJson(res, 403, { success: false, error: '只能修改自己创建的风格' });
    }
    try {
      if (req.method === 'DELETE') {
        styleStore.deleteCustomStyle(db, styleId);
        return sendJson(res, 200, { success: true, data: { id: styleId } });
      }
      const b = await parseBody(req);
      const row = styleStore.updateCustomStyle(db, styleId, {
        name: b.name,
        description: b.description != null ? b.description : b.desc,
        aiPrompt: b.aiPrompt != null ? b.aiPrompt : b.ai_prompt,
      });
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message || '自定义风格更新失败' });
    }
  }

  // ★ 用一次 LLM 把自定义风格翻译成生图模型更吃透的「风格锚定描述」
  if (pathname === '/ai/style/analyze' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    const name = String(b.name || '').trim();
    if (!name) return sendJson(res, 400, { success: false, error: '请先填写风格名称' });
    const description = String(b.description || b.desc || '').trim();
    try {
      const { STYLE_ANALYZER_PROMPT, buildStyleAnalyzerUserMessage } = require('./custom-styles');
      const opt = genGov.resolveOptimizerModel(db, '');
      const data = await executeChatCompletion(db, config, {
        model: b.optimizerModelId || opt.modelCode || opt.modelId,
        messages: [
          { role: 'system', content: STYLE_ANALYZER_PROMPT },
          { role: 'user', content: buildStyleAnalyzerUserMessage(name, description) },
        ],
        temperature: 0.5,
        max_tokens: 800,
        timeoutMs: opt.timeoutMs || 90000,
      });
      const content = ((data && data.choices && data.choices[0] && data.choices[0].message
        && data.choices[0].message.content) || '').trim().replace(/^["'“”]+|["'“”]+$/g, '');
      if (!content) return sendJson(res, 502, { success: false, error: 'AI 未返回风格描述' });
      return sendJson(res, 200, { success: true, data: { name, description, aiPrompt: content } });
    } catch (e) {
      console.error('[ai/style/analyze] 执行失败:', e);
      return sendJson(res, 502, { success: false, error: e.message || 'AI 风格解析失败' });
    }
  }

  if (pathname === '/ai/expand-jimeng' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      const { expandWithJimeng, jimengReady } = require('./handlers/jimeng-expand');
      if (!jimengReady(services)) {
        return sendJson(res, 500, {
          error: '未配置火山引擎 AK/SK：请在服务端设置 VOLC_ACCESSKEY / VOLC_SECRETKEY（即梦视觉与方舟 Ark Key 不是同一套）'
        });
      }
      let imgB64 = b.image || b.imageB64 || '';
      if (!imgB64 && (b.image_url || b.imageUrl)) {
        const u = b.image_url || b.imageUrl;
        if (u.startsWith('data:image')) {
          imgB64 = u;
        } else if (u.startsWith('http://') || u.startsWith('https://')) {
          const fetchRes = await fetch(u);
          const buf = await fetchRes.arrayBuffer();
          imgB64 = Buffer.from(buf).toString('base64');
        }
      }

      let top = b.top !== undefined ? Number(b.top) : 0;
      let bottom = b.bottom !== undefined ? Number(b.bottom) : 0;
      let left = b.left !== undefined ? Number(b.left) : 0;
      let right = b.right !== undefined ? Number(b.right) : 0;

      // 如果提供了 ratio (如 '16:9', '21:9', '4:3') 但未指定具体数值，自动按画幅居中外扩
      if (!b.mask && !b.maskB64 && top === 0 && bottom === 0 && left === 0 && right === 0 && b.ratio) {
        const ratioMap = {
          '16:9': 16 / 9,
          '21:9': 21 / 9,
          '4:3': 4 / 3,
          '1:1': 1.0,
          '9:16': 9 / 16,
          '3:2': 3 / 2,
          '2:3': 2 / 3
        };
        const targetRatio = ratioMap[b.ratio] || 16 / 9;
        // 假定基准为 1:1 或 4:3 扩展
        if (targetRatio > 1.2) {
          left = Math.min(0.5, (targetRatio - 1) / 2);
          right = left;
        } else if (targetRatio < 0.8) {
          top = Math.min(0.5, (1 / targetRatio - 1) / 2);
          bottom = top;
        } else {
          top = 0.15; bottom = 0.15; left = 0.15; right = 0.15;
        }
      }

      const out = await expandWithJimeng(services, {
        imageB64: imgB64,
        maskB64: b.mask || b.maskB64,
        top,
        bottom,
        left,
        right,
        prompt: b.prompt,
      });
      const dataUrl = `data:image/png;base64,${out.b64}`;
      return sendJson(res, 200, {
        success: true,
        data: {
          b64_json: out.b64,
          url: dataUrl,
          image_url: dataUrl,
          task_id: out.taskId
        }
      });
    } catch (e) {
      console.error('[edit/run] 执行失败:', e);
      return sendJson(res, 502, { success: false, error: e.message });
    }
  }

  // ===== VLM 选区描述（无局部编辑能力时优化提示词） =====
  // POST /ai/vlm-describe  { assetFid | image, region? }
  if (pathname === '/ai/vlm-describe' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      // LOGIC-004：原实现把 services 当 completeChat 首参传入（其签名是单对象解构），
      // 100% 抛「LiteLLM 未配置 base_url」后退化为空兜底。改用 chatVision + 治理台端点解析。
      const { chatVision } = require('./vlm');
      const genGov = require('./gen-governance');
      const ep = genGov.resolveVlmEndpoint(services.db, services.config, b.model);
      const prompt =
        '识别图中指定区域（若有 bbox 则为该框内）的家具/物件。只返回 JSON：' +
        '{"name_cn":"中文名","attributes":"材质/颜色/风格一句话","summary":"一句定位描述"}' +
        (b.region ? `\nbbox=${JSON.stringify(b.region)}` : '');
      let info = null;
      if (b.image && ep && ep.baseUrl) {
        info = await chatVision({
          baseUrl: ep.baseUrl,
          apiKey: ep.apiKey,
          model: ep.modelCode || b.model,
          prompt,
          images: [String(b.image)],
        }).catch(() => null);
      }
      if (!info || !info.name_cn) {
        info = { name_cn: b.fallbackName || '目标物体', attributes: '', summary: '' };
      }
      return sendJson(res, 200, { success: true, data: info });
    } catch (e) {
      return sendJson(res, 200, {
        success: true,
        data: { name_cn: b.fallbackName || '目标物体', attributes: '', summary: '', fallback: true, error: e.message },
      });
    }
  }

  // ===== 空间漫游三段式双确认接口 =====
  // 1. 段 1：照片拓扑推断 (2-6张空间照片推导房间与门洞连接)
  // POST /ai/walkthrough/infer-topology
  if (pathname === '/ai/walkthrough/infer-topology' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      const topo = await inferRoomTopology(services, {
        photoFids: b.photo_fids || b.fids || [],
        photoUrls: b.photo_urls || [],
        photosBase64: b.photos_base64 || b.photosBase64 || b.images || [],
        photos: b.photos || [],
        model: b.model || null,
      });
      return sendJson(res, 200, { success: true, data: topo });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // 1.5 建筑 3D 几何挤出生成
  // POST /ai/walkthrough/generate-3d
  if (pathname === '/ai/walkthrough/generate-3d' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      const scene3D = generatePascal3DGeometry(b.plan || b, b.options || {});
      return sendJson(res, 200, { success: true, data: scene3D });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // 2. 确认 1：人工确认/微调房间连接示意图
  // POST /ai/walkthrough/confirm-topology
  if (pathname === '/ai/walkthrough/confirm-topology' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    // 校验输入结构完整性并透传确认后的拓扑数据
    if (!Array.isArray(b.rooms) || !b.rooms.length) {
      return sendJson(res, 400, { success: false, error: '拓扑确认必须包含至少一个房间' });
    }
    return sendJson(res, 200, {
      success: true,
      data: {
        confirmed_topology: {
          rooms: b.rooms,
          connections: b.connections || [],
          photos: b.photos || []
        },
        confirmed_at: Date.now()
      }
    });
  }

  // 3. 段 2：由确认后的拓扑推导运镜序列
  // POST /ai/walkthrough/infer-sequence
  if (pathname === '/ai/walkthrough/infer-sequence' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      const seq = await inferCameraSequence(services, {
        rooms: b.rooms || [],
        connections: b.connections || [],
        photos: b.photos || []
      });
      return sendJson(res, 200, { success: true, data: seq });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // 4. 确认 2：确认镜头顺序、画幅、每段时长、运镜风格，并直接创建渲染任务
  // POST /ai/walkthrough/confirm-sequence
  if (pathname === '/ai/walkthrough/confirm-sequence' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    const photoFids = b.photo_fids || b.fids || [];
    const mainFid = photoFids[0] || b.fid;
    if (!mainFid) {
      return sendJson(res, 400, { success: false, error: '缺少主要照片 fid' });
    }
    try {
      const task = aiTasks.enqueueAiTask(db, {
        fid: mainFid,
        type: 'spatial_walkthrough',
        taskId: b.task_id || b.taskId || null,
        title: `全景漫游·${(b.shots || []).length || photoFids.length}镜头`,
        sourceFids: photoFids,
        payload: {
          sequence_data: {
            aspect_ratio: b.aspect_ratio || '16:9',
            duration_per_shot: b.duration_per_shot || 4,
            style: b.style || '平稳向前推进',
            shots: b.shots || []
          },
          ...b
        },
        createdBy: sessionUser?.username || 'viewer'
      });
      return sendJson(res, 200, { success: true, data: aiTasks.toPublicTask(task) });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // ===== AI 任务调度 (/api/viewer/ai/tasks) =====
  // POST /ai/tasks — 提交（兼容客户端 task_id + type）
  if (pathname === '/ai/tasks' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    try {
      const task = aiTasks.enqueueAiTask(db, {
        fid: b.fid,
        type: b.type,
        taskId: b.task_id || b.taskId || null,
        title: b.title || '',
        sourceFids: b.source_fids || b.sourceFids || null,
        payload: b.payload || b,
        createdBy: sessionUser?.username || 'viewer'
      });
      // 异步由 worker 消费；提交失败会在 start 时落 failed
      return sendJson(res, 200, { success: true, data: aiTasks.toPublicTask(task) });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // GET /ai/tasks/:taskId — 按任务 ID 查询
  const mAiTask = pathname.match(/^\/ai\/tasks\/([^\/]+)$/);
  if (mAiTask && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const taskId = decodeURIComponent(mAiTask[1]);
    const task = aiTasks.getAiTask(db, taskId);
    if (!task) return sendJson(res, 404, { success: false, error: '任务不存在' });
    return sendJson(res, 200, { success: true, data: aiTasks.toPublicTask(task) });
  }

  // GET /assets/:fid/ai/tasks — 该素材最新一条 AI 任务（客户端轮询）
  const mFidAiTasks = pathname.match(/^\/assets\/([^\/]+)\/ai\/tasks$/);
  if (mFidAiTasks && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const fid = decodeURIComponent(mFidAiTasks[1]);
    const type = urlObj.searchParams.get('type') || null;
    const task = aiTasks.listLatestByFid(db, fid, type);
    if (!task) {
      return sendJson(res, 200, { success: true, data: { status: 'idle', progress: 0, error: null } });
    }
    return sendJson(res, 200, { success: true, data: aiTasks.toPublicTask(task) });
  }

  // 视频封面
  const mPoster = pathname.match(/^\/assets\/([^\/]+)\/poster$/);
  if (mPoster && (req.method === 'GET' || req.method === 'HEAD')) {
    const fid = decodeParamLoose(mPoster[1]);
    const visCheck = db.prepare('SELECT auth_state, poster_path, kind, main_derivative_id FROM assets WHERE fid=?').get(fid);
    if (!visCheck) return sendJson(res, 404, { error: '资产不存在' });
    if (visCheck.auth_state && !['live', 'frozen'].includes(visCheck.auth_state)) {
      return sendJson(res, 404, { error: '资产不可见' });
    }
    const candidates = [];
    if (visCheck.poster_path) candidates.push(path.join(config.dataDir, visCheck.poster_path));
    candidates.push(path.join(config.dataDir, 'cache', 'thumbs', `${fid}.jpg`));
    // poster derivative
    try {
      const posterDeriv = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? AND kind='poster' ORDER BY id DESC LIMIT 1").get(fid);
      if (posterDeriv) {
        const p = await resolveDerivativeFile(services, posterDeriv);
        if (p) candidates.unshift(p);
      }
    } catch {}
    for (const p of candidates) {
      if (p && fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': buf.length,
          'Cache-Control': 'public, max-age=86400'
        });
        if (req.method === 'HEAD') return res.end();
        return res.end(buf);
      }
    }

    // 动态生成兜底：若磁盘暂无海报，但属于视频资产，调用 FFmpeg 实时截取第 1 秒画面并持久化缓存
    if (visCheck.kind === 'video' || visCheck.main_derivative_id) {
      try {
        const vidDeriv = db.prepare(`
          SELECT * FROM derivatives 
          WHERE asset_fid=? AND (mime LIKE 'video/%' OR file_name LIKE '%.mp4' OR file_name LIKE '%.mov')
          ORDER BY id DESC LIMIT 1
        `).get(fid) || (visCheck.main_derivative_id ? db.prepare("SELECT * FROM derivatives WHERE id=?").get(visCheck.main_derivative_id) : null);

        if (vidDeriv) {
          const vidPath = await resolveDerivativeFile(services, vidDeriv);
          if (vidPath && fs.existsSync(vidPath)) {
            const outThumb = path.join(config.dataDir, 'cache', 'thumbs', `${fid}.jpg`);
            const { extractPoster } = require('./umbra');
            const ok = await extractPoster(vidPath, outThumb);
            if (ok && fs.existsSync(outThumb) && fs.statSync(outThumb).size > 0) {
              const relPath = path.relative(config.dataDir, outThumb).replace(/\\/g, '/');
              try {
                db.prepare("UPDATE assets SET poster_path=? WHERE fid=? AND (poster_path IS NULL OR poster_path='')").run(relPath, fid);
              } catch {}
              const buf = fs.readFileSync(outThumb);
              res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': buf.length,
                'Cache-Control': 'public, max-age=86400'
              });
              return res.end(buf);
            }
          }
        }
      } catch (err) {
        console.warn(`[api] 动态生成视频海报失败 (${fid}):`, err.message);
      }

      // 云盘视频缩略图兜底（若存量带有 thumb_url）
      try {
        const assetRow = db.prepare('SELECT thumb_url FROM assets WHERE fid=?').get(fid);
        if (assetRow?.thumb_url && assetRow.thumb_url.startsWith('http')) {
          const resp = await fetch(assetRow.thumb_url, { signal: AbortSignal.timeout(6000) });
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            const outThumb = path.join(config.dataDir, 'cache', 'thumbs', `${fid}.jpg`);
            fs.mkdirSync(path.dirname(outThumb), { recursive: true });
            fs.writeFileSync(outThumb, buf);
            res.writeHead(200, {
              'Content-Type': 'image/jpeg',
              'Content-Length': buf.length,
              'Cache-Control': 'public, max-age=86400'
            });
            return res.end(buf);
          }
        }
      } catch {}
    }

    return sendJson(res, 404, { error: '海报不存在' });
  }

  // 单个资产详情
  const mDetail = pathname.match(/^\/assets\/([^\/]+)$/);
  if (mDetail && req.method === 'GET') {
    const fid = decodeParamLoose(mDetail[1]);
    const detail = getAssetDetail(services, fid, {
      includeSimilar: urlObj.searchParams.get('include_similar') === '1',
    });
    if (!detail) {
      // 区分「从未存在」/「已删除可恢复」/「已清理」，
      // 客户端据此展示「去回收站」按钮而不是一句「资产不存在」
      const { missingAssetBody } = require('./asset-missing');
      const body = missingAssetBody(db, fid);
      return sendJson(res, body.code, body);
    }
    return sendJson(res, 200, { success: true, data: detail });
  }

  // 单个资产向量相似
  const mSim = pathname.match(/^\/assets\/([^\/]+)\/similar$/);
  if (mSim && req.method === 'GET') {
    const fid = decodeURIComponent(mSim[1]);
    const limit = +(urlObj.searchParams.get('limit') || 8);
    const items = searchSimilar(services, fid, { limit });
    return sendJson(res, 200, { success: true, data: items });
  }

  // 人工打标
  const mTag = pathname.match(/^\/assets\/([^\/]+)\/tags$/);
  if (mTag && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const fid = decodeURIComponent(mTag[1]);
    const b = await parseBody(req);
    return sendJson(res, 200, { success: applyHumanTag(db, fid, b.dimension, b.dir) });
  }

  // 单个资产主动触发 AI 重构 (3:4 & 9:16 双画幅净画生图)
  const mRestage = pathname.match(/^\/assets\/([^\/]+)\/restage$/);
  if (mRestage && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const fid = decodeURIComponent(mRestage[1]);
    const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
    if (!asset) return sendJson(res, 404, { error: '资产不存在' });
    if (asset.status === 'deleted') return sendJson(res, 410, { error: '素材已删除，不能重构' });
    try {
      const { isBlacklisted } = require('./assets-delete');
      if (isBlacklisted(db, { fid, sha256: asset.sha256, clientAssetId: asset.client_asset_id })) {
        return sendJson(res, 410, { error: '素材已在黑名单，不能重构' });
      }
    } catch (_) {}

    const { executeRestageDual } = require('./nodes/index');
    const b = await parseBody(req);
    let cfg = {
      adapterId: 'agnes_image',
      model: 'agnes-image-2.5-flash',
      promptTemplate: '图生图，沿用参考图整体色调、光影质感、画面风格，远景镜头，完整保留原有场景结构，画面干净，不含任何文字、标识、水印。延展必须是真实场景延续，严禁黑边、白边、letterbox、模糊条带或纯色衬底。',
      ratios: ['9:16', '3:4'],
      sizePreset: '1080p',
      mainRatio: '9:16',
      skipIfAlreadyExact: false
    };
    try {
      const wf = db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get();
      const graph = JSON.parse(wf.graph_json);
      const node = (graph.nodes || []).find(n => n.type === 'restage_dual')
        || (graph.nodes || []).find(n => n.type === 'restage_9_16');
      if (node?.config) cfg = { ...cfg, ...node.config };
    } catch { /* keep defaults */ }
    if (b && typeof b === 'object') {
      if (Array.isArray(b.ratios) && b.ratios.length) cfg.ratios = b.ratios;
      if (b.sizePreset) cfg.sizePreset = b.sizePreset;
      if (b.mainRatio) cfg.mainRatio = b.mainRatio;
      if (b.adapterId) cfg.adapterId = b.adapterId;
      if (b.model) cfg.model = b.model;
      if (b.promptTemplate) cfg.promptTemplate = b.promptTemplate;
      if (b.skipIfAlreadyExact != null) cfg.skipIfAlreadyExact = !!b.skipIfAlreadyExact;
      if (b.extraPrompt != null) cfg.extraPrompt = String(b.extraPrompt || '').trim();
      if (b.replaceExisting != null) cfg.replaceExisting = !!b.replaceExisting;
      if (b.forceMember != null) cfg.forceMember = !!b.forceMember;
    }
    cfg.skipIfAlreadyExact = false;
    cfg.replaceExisting = cfg.replaceExisting !== false;
    cfg.forceMember = true;
    let target = asset;
    // CONFLICT-002：重复组退役，不再重定向到组长，直接对素材本身执行
    const resRestage = await executeRestageDual(services, cfg, target, { lastOutput: {} });
    const updatedDetail = getAssetDetail(services, fid);

    // 契约：只有真的产出了合格衍生图才算成功。
    // 历史上这里无条件 success:true，导致上游 429/503/网络失败时客户端照样弹「画幅已生成」，
    // 但库里一个 restage_* 都没有 —— 用户看到的就是「提示成功、进去仍未生成」。
    const producedKinds = Object.entries((resRestage && resRestage.output && resRestage.output.derivatives) || {})
      .filter(([, v]) => v && v.id && !v.reused)
      .map(([k]) => k);
    const queueFull = !!(resRestage && resRestage.requeue);

    // 失败原因分层：限流/队列满给可重试语义，其余给真实错误原文（截断防超长）
    let failReason = String((resRestage && (resRestage.error || resRestage.reason)) || '').trim();
    if (!failReason) {
      const errs = (resRestage && resRestage.output && resRestage.output.genErrors) || [];
      failReason = errs.length ? errs.join(' | ') : '未能生成任何画幅';
    }
    if (/429|rate.?limit|速率限制/i.test(failReason)) failReason = '生图服务限流（429），请稍后重试';
    else if (/503|queue is full|队列已满/i.test(failReason)) failReason = '生图队列已满（503），请稍后重试';
    failReason = failReason.slice(0, 200);

    if (!producedKinds.length) {
      if (resRestage && resRestage.skipped) {
        return sendJson(res, 409, { error: `该素材无需画幅重构（${resRestage.reason || 'skipped'}）` });
      }
      return sendJson(res, queueFull ? 503 : 502, {
        error: failReason,
        data: { restage: resRestage, detail: updatedDetail, produced: [] },
      });
    }

    return sendJson(res, 200, {
      success: true,
      data: { restage: resRestage, detail: updatedDetail, produced: producedKinds },
    });
  }

  // 流式输出图片 / 视频 / 音频 / 原始文件
  const mImg = pathname.match(/^\/assets\/([^\/]+)\/(image|file|video)(?:\/([^\/]+))?$/);
  if (mImg && (req.method === 'GET' || req.method === 'HEAD')) {
    const fid = decodeParamLoose(mImg[1]);
    const actionType = mImg[2]; // 'image' | 'file' | 'video'
    const requestedFileName = mImg[3] ? decodeURIComponent(mImg[3]) : null;
    const isFileOrVideo = actionType === 'file' || actionType === 'video';
    const visCheck = db.prepare('SELECT auth_state FROM assets WHERE fid=?').get(fid);
    if (!visCheck) return sendJson(res, 404, { error: '资产不存在' });
    if (visCheck.auth_state && !['live', 'frozen'].includes(visCheck.auth_state)) {
      return sendJson(res, 404, { error: '资产不可见' });
    }
    const derivativeId = urlObj.searchParams.get('derivative');
    const isDl = urlObj.searchParams.get('dl') === '1' || urlObj.searchParams.get('download') === '1' || (actionType === 'file' && urlObj.searchParams.get('download') === '1') || !!requestedFileName;
    const isRaw = urlObj.searchParams.get('raw') === '1' || isFileOrVideo;
    const forceLocal = urlObj.searchParams.get('local') === '1';
    const thumb = path.join(config.dataDir, 'cache', 'thumbs', `${fid}.jpg`);
    const assetRow = db.prepare('SELECT thumb_url, main_derivative_id FROM assets WHERE fid=?').get(fid);

    const buildStandardDisposition = (targetName, defaultExt = '.jpg', kind = 'origin') => {
      const ext = path.extname(targetName || '') || defaultExt;
      const safeFid = String(fid).replace(/[^A-Za-z0-9_-]/g, '');
      const safeVar = String(kind || 'origin').replace(/[^A-Za-z0-9_-]/g, '');
      let baseName = requestedFileName || targetName;
      if (!baseName || !baseName.toLowerCase().startsWith('ml_saved_')) {
        baseName = `ML_SAVED_${safeFid}_${safeVar}${ext}`;
      }
      const asciiExportName = baseName.replace(/[^\w.-]/g, '_');
      const utf8ExportName = baseName;
      const dispositionType = (isDl || urlObj.searchParams.get('download') === '1' || urlObj.searchParams.get('export') === '1') ? 'attachment' : 'inline';
      return `${dispositionType}; filename="${asciiExportName}"; filename*=UTF-8''${encodeURIComponent(utf8ExportName)}`;
    };

    // 仅在「公网隧道且未指定产物」时 302 外链；内网/本机直接读 NAS，更快
    const host = String(req.headers.host || '').split(':')[0] || '';
    const isPrivateHost =
      host === '127.0.0.1' || host === 'localhost' || host === '::1'
      || /^192\.168\./.test(host) || /^10\./.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    if (!isFileOrVideo && !isDl && !isRaw && !derivativeId && !forceLocal && !isPrivateHost && assetRow?.thumb_url && !fs.existsSync(thumb)) {
      res.writeHead(302, {
        'Location': assetRow.thumb_url,
        'Cache-Control': 'public, max-age=3600'
      });
      return res.end();
    }

    let deriv = null;
    if (derivativeId) {
      deriv = getDerivativeById(db, derivativeId);
      if (deriv && deriv.asset_fid !== fid) deriv = null;
    } else {
      // 浏览网格：无 derivative 时允许共享缩略图；raw=1 时强制拉高清原图
      if (!isFileOrVideo && !isDl && !isRaw && fs.existsSync(thumb)) {
        const tbuf = fs.readFileSync(thumb);
        try {
          const { registerVisibleImageHashes } = require('./export-tag');
          registerVisibleImageHashes(db, { buffer: tbuf, sourceFid: fid, variant: 'thumb', exportedBy: 'thumb_serve' });
        } catch (_) {}
        const thumbDisp = buildStandardDisposition(`ML_SAVED_${fid}_thumb.jpg`, '.jpg', 'thumb');
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': tbuf.length,
          'Content-Disposition': thumbDisp,
          'Cache-Control': 'public, max-age=86400'
        });
        if (req.method === 'HEAD') return res.end();
        return res.end(tbuf);
      }
      if (isRaw) {
        deriv = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? AND kind='origin' LIMIT 1").get(fid);
      }
      if (!deriv) {
        const asset = db.prepare('SELECT main_derivative_id FROM assets WHERE fid=?').get(fid);
        if (asset?.main_derivative_id) {
          deriv = getDerivativeById(db, asset.main_derivative_id);
        }
      }
      if (!deriv) {
        deriv = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? AND kind='origin' LIMIT 1").get(fid);
      }
    }

    if (!deriv) {
      // 详情优先本地产物，避免 origin=quark 现场下载超时导致「图片丢失」
      const localDeriv = db.prepare(`
        SELECT * FROM derivatives
        WHERE asset_fid=? AND storage_type='local_cache'
        ORDER BY CASE kind
          WHEN 'clean' THEN 0 WHEN 'restage_9_16' THEN 1 WHEN 'restage_3_4' THEN 2
          WHEN 'origin' THEN 3 ELSE 4 END
        LIMIT 1
      `).get(fid);
      if (localDeriv) deriv = localDeriv;
    }

    if (!deriv) {
      if (!isRaw && fs.existsSync(thumb)) {
        const b = fs.readFileSync(thumb);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': b.length, 'Cache-Control': 'public, max-age=86400' });
        if (req.method === 'HEAD') return res.end();
        return res.end(b);
      }
      return sendJson(res, 404, { error: '文件或产物不存在' });
    }

    // 列表/详情的 <img> 会带上 video/audio 的 main_derivative_id。
    // 非下载、非播放时不能把 mp4/mp3 当图片流回去，否则前端裂图。
    const derivMime = String(deriv.mime || '').toLowerCase();
    const derivName = String(deriv.file_name || '').toLowerCase();
    const isMediaNonImage =
      derivMime.includes('video') || derivMime.includes('audio')
      || deriv.kind === 'gen_video'
      || /\.(mp4|mov|m4v|webm|avi|mp3|wav|m4a|aac|flac|ogg)$/.test(derivName);
    const wantPlay = isFileOrVideo || urlObj.searchParams.get('play') === '1' || !!req.headers.range;
    if (!isDl && isMediaNonImage && !wantPlay && actionType === 'image') {
      const serveThumbIfAny = () => {
        if (fs.existsSync(thumb)) {
          const b = fs.readFileSync(thumb);
          try {
            const { registerVisibleImageHashes } = require('./export-tag');
            registerVisibleImageHashes(db, { buffer: b, sourceFid: fid, variant: 'thumb', exportedBy: 'thumb_serve' });
          } catch (_) {}
          const thumbDisp = buildStandardDisposition(`ML_SAVED_${fid}_thumb.jpg`, '.jpg', 'thumb');
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': b.length, 'Content-Disposition': thumbDisp, 'Cache-Control': 'public, max-age=86400' });
          res.end(b);
          return true;
        }
        return false;
      };
      if (serveThumbIfAny()) return;
      // 视频：立刻回占位图，后台补抽帧，避免列表请求卡在 NAS/ffmpeg
      const kindRow = db.prepare('SELECT kind FROM assets WHERE fid=?').get(fid);
      const isVid = kindRow?.kind === 'video' || derivMime.includes('video') || deriv.kind === 'gen_video';
      if (isVid) {
        setImmediate(() => {
          ensureVideoThumbAsync(services, fid, deriv).catch(() => {});
        });
      }
      const placeholder = await ensureMediaPlaceholder(services, fid, kindRow?.kind || (isVid ? 'video' : 'audio'), deriv.file_name || '');
      if (placeholder && fs.existsSync(placeholder)) {
        const b = fs.readFileSync(placeholder);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': b.length, 'Cache-Control': 'public, max-age=600' });
        return res.end(b);
      }
      return sendJson(res, 404, { error: '媒体缩略图不存在' });
    }

    let filePath = null;
    try {
      filePath = await resolveDerivativeFile(services, deriv);
    } catch (e) {
      // 夸克下载失败时优先外链，再回落缩略图
      if (!isDl && assetRow?.thumb_url) {
        res.writeHead(302, { Location: assetRow.thumb_url, 'Cache-Control': 'public, max-age=600' });
        return res.end();
      }
      if (fs.existsSync(thumb)) {
        const b = fs.readFileSync(thumb);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': b.length, 'Cache-Control': 'public, max-age=600' });
        return res.end(b);
      }
      if (serveFromTrash(services, fid, res)) return;
      return sendJson(res, 404, { error: e.message || '文件未找到或夸克拉取失败' });
    }
    if (!filePath || !fs.existsSync(filePath)) {
      if (!isDl && assetRow?.thumb_url) {
        res.writeHead(302, { Location: assetRow.thumb_url, 'Cache-Control': 'public, max-age=600' });
        return res.end();
      }
      if (fs.existsSync(thumb)) {
        const b = fs.readFileSync(thumb);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': b.length, 'Cache-Control': 'public, max-age=600' });
        return res.end(b);
      }
      // 回收站素材：原文件已移到 dataDir/trash/，从那里回读（回收站详情页预览依赖这条）
      if (serveFromTrash(services, fid, res)) return;
      return sendJson(res, 404, { error: '文件未找到或夸克拉取失败' });
    }

    if (filePath && !fs.existsSync(thumb)) {
      const sharp = require('sharp');
      sharp(filePath).rotate().resize(512, 512, { fit: 'inside' }).jpeg({ quality: 80 }).toFile(thumb).catch(() => {});
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = deriv.mime || MIME[ext] || 'image/jpeg';
    const fileName = deriv.file_name || path.basename(filePath);
    const isVideo = (deriv.mime || '').includes('video') || deriv.kind === 'gen_video' || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(fileName);
    const isAudio = (deriv.mime || '').includes('audio') || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(fileName);

    if (!isDl && !isRaw && !isVideo && !isAudio && actionType === 'image') {
      try {
        const preview = await ensurePreviewJpeg(services, fid, deriv, filePath);
        if (preview && fs.existsSync(preview)) {
          const buf = fs.readFileSync(preview);
          const previewDisp = buildStandardDisposition(path.basename(preview), '.jpg', deriv?.kind || 'preview');
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': buf.length,
            'Content-Disposition': previewDisp,
            'Cache-Control': 'private, max-age=3600, must-revalidate'
          });
          if (req.method === 'HEAD') return res.end();
          return res.end(buf);
        }
      } catch { /* 预览失败则回落原文件，仍不走共享 thumb */ }
    }

    // 视频与音频：Range 分段流（原生播放器视频拖拽与音频平滑播放）
    if (isVideo || isAudio) {
      const stat = fs.statSync(filePath);
      const total = stat.size;
      const defaultMime = isAudio ? 'audio/mpeg' : 'video/mp4';
      const mime = (contentType.includes('video') || contentType.includes('audio')) ? contentType : defaultMime;
      const range = req.headers.range;
      const acceptRanges = 'bytes';
      const mediaDisp = buildStandardDisposition(fileName, ext, deriv?.kind || (isVideo ? 'video' : 'audio'));

      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
        if (m) {
          let start = m[1] === '' ? null : parseInt(m[1], 10);
          let end = m[2] === '' ? null : parseInt(m[2], 10);
          if (start == null && end != null) {
            start = Math.max(0, total - end);
            end = total - 1;
          } else {
            if (start == null) start = 0;
            if (end == null || end >= total) end = total - 1;
          }
          if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < total) {
            res.writeHead(206, {
              'Content-Type': mime,
              'Content-Length': end - start + 1,
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Accept-Ranges': acceptRanges,
              'Content-Disposition': mediaDisp,
              'Cache-Control': isDl ? 'private, no-store' : 'private, max-age=3600, must-revalidate'
            });
            if (req.method === 'HEAD') return res.end();
            return fs.createReadStream(filePath, { start, end }).pipe(res);
          }
          res.writeHead(416, { 'Content-Range': `bytes */${total}` });
          return res.end();
        }
      }

      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': total,
        'Accept-Ranges': acceptRanges,
        'Content-Disposition': mediaDisp,
        'Cache-Control': isDl ? 'private, no-store' : 'private, max-age=3600, must-revalidate'
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(filePath).pipe(res);
    }

    let outBuf = fs.readFileSync(filePath);
    const isJpeg = (contentType || '').includes('jpeg') || (contentType || '').includes('jpg') || ext === '.jpg' || ext === '.jpeg';
    if ((isDl || urlObj.searchParams.get('download') === '1' || urlObj.searchParams.get('export') === '1') && isJpeg) {
      try {
        const { prepareExportableBuffer } = require('./export-tag');
        outBuf = prepareExportableBuffer(db, outBuf, { fid, variant: deriv?.kind || 'origin', mime: contentType, exportedBy: 'http_export' });
      } catch (_) {}
    } else {
      try {
        const { registerVisibleImageHashes } = require('./export-tag');
        registerVisibleImageHashes(db, { buffer: outBuf, sourceFid: fid, variant: deriv?.kind || 'origin', exportedBy: 'http_serve' });
      } catch (_) {}
    }
    const finalDisp = buildStandardDisposition(fileName, ext, deriv?.kind || 'origin');
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': outBuf.length,
      'Content-Disposition': finalDisp,
      'Cache-Control': isDl ? 'private, no-store' : 'private, max-age=3600, must-revalidate'
    });
    if (req.method === 'HEAD') return res.end();
    return res.end(outBuf);
  }

  // 临时生成产物预览直出 (用于模型与适配器即时测试生成结果)
  const mTemp = pathname.match(/^\/cache\/temp\/([^/]+)$/);
  if (mTemp && (req.method === 'GET' || req.method === 'HEAD')) {
    const fName = path.basename(decodeURIComponent(mTemp[1]));
    const targetPath = path.join(config.dataDir, 'cache', 'temp', fName);
    if (!fs.existsSync(targetPath)) {
      return sendJson(res, 404, { error: '文件未找到' });
    }
    const ext = path.extname(targetPath).toLowerCase();
    const mimeMap = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
      '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.flac': 'audio/flac'
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes'
    });
    return fs.createReadStream(targetPath).pipe(res);
  }

  // 管理员专用：扫描
  if (pathname === '/scan' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { runScan } = require('./sync');
    const scanStats = await runScan(services, { manual: true });
    return sendJson(res, 200, { success: true, data: scanStats });
  }

  // 管理员专用：工作流管理
  // 管理员专用：工作流管理 (支持 default 图片产线与 video 视频空图产线)
  const mWfGet = pathname.match(/^\/workflows\/([^\/]+)$/);
  if (mWfGet && req.method === 'GET' && mWfGet[1] !== 'catalog') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const wfId = decodeURIComponent(mWfGet[1]);
    let wf = db.prepare('SELECT * FROM workflows WHERE id=?').get(wfId);
    const now = Date.now();

    if (!wf && wfId === 'video') {
      db.prepare(`
        INSERT INTO workflows (id, name, version, is_default, graph_json, created_at, updated_at)
        VALUES ('video', '视频工作流', 1, 0, '{"nodes":[],"edges":[]}', ?, ?)
      `).run(now, now);
      wf = db.prepare("SELECT * FROM workflows WHERE id='video'").get();
    }

    if (!wf) return sendJson(res, 200, { success: true, data: null });
    let graph = { nodes: [], edges: [] };
    try { graph = JSON.parse(wf.graph_json || '{"nodes":[],"edges":[]}'); } catch {}

    const lastRun = db.prepare('SELECT id FROM runs WHERE workflow_id=? ORDER BY created_at DESC LIMIT 1').get(wfId);
    let nodeStats = {};
    if (lastRun) {
      const rows = db.prepare(`
        SELECT node_id, node_type,
          SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) as queued,
          SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done,
          SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) as skipped,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
          COUNT(*) as total
        FROM node_runs WHERE run_id=? GROUP BY node_id, node_type
      `).all(lastRun.id);
      rows.forEach(r => { nodeStats[r.node_id] = r; });
    }
    const { NODE_CATALOG } = require('./nodes/catalog');
    const indexNode = (graph.nodes || []).find(n => n.type === 'index');
    const vectorStatus = getVectorStatus(db, {
      configuredModel: indexNode?.config?.embeddingModel || 'text-embedding-3-small',
      configuredProvider: indexNode?.config?.embeddingProvider || 'litellm'
    });

    let videoStats = null;
    if (wfId === 'video') {
      const totalCount = db.prepare("SELECT count(*) as c FROM assets WHERE kind='video' AND status NOT IN ('deleted', 'excluded')").get()?.c || 0;
      const readyCount = db.prepare("SELECT count(*) as c FROM assets WHERE kind='video' AND status='ready'").get()?.c || 0;
      videoStats = { total: totalCount, ready: readyCount };
    }

    return sendJson(res, 200, {
      success: true,
      data: { ...wf, graph, nodeStats, lastRunId: lastRun?.id || null, catalog: NODE_CATALOG, vectorStatus, videoStats }
    });
  }

  // 视频工作流保存支持 PUT /workflows/video
  if (pathname === '/workflows/video' && req.method === 'PUT') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    const wfId = 'video';
    const currentWf = db.prepare('SELECT version FROM workflows WHERE id=?').get(wfId);
    const newVersion = (currentWf?.version || 1) + 1;
    const now = Date.now();
    const graphJson = JSON.stringify(b.graph || { nodes: [], edges: [] });

    db.prepare(`
      INSERT INTO workflows (id, name, version, is_default, graph_json, created_at, updated_at)
      VALUES ('video', '视频工作流', ?, 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version=excluded.version, graph_json=excluded.graph_json, updated_at=excluded.updated_at
    `).run(newVersion, graphJson, now, now);

    return sendJson(res, 200, { success: true, data: { id: wfId, version: newVersion } });
  }

  // 视频侧启动：把未删除、未排除、还不是 ready 的视频置为 ready，不写 node_runs；返回可播放列表
  if (pathname === '/workflows/video/start' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const now = Date.now();
    const upd = db.prepare(`
      UPDATE assets SET status='ready', updated_at=?
      WHERE kind='video' AND status NOT IN ('deleted', 'excluded', 'ready')
    `).run(now);

    const videos = db.prepare(`
      SELECT fid, file_name, kind, status, width, height, duration_s, poster_path, created_at, updated_at
      FROM assets
      WHERE kind='video' AND status NOT IN ('deleted', 'excluded')
      ORDER BY updated_at DESC
      LIMIT 100
    `).all();
    const totalCount = db.prepare("SELECT count(*) as c FROM assets WHERE kind='video' AND status NOT IN ('deleted', 'excluded')").get()?.c || 0;

    return sendJson(res, 200, {
      success: true,
      data: {
        newlyReady: upd.changes || 0,
        totalVideos: totalCount,
        videos
      }
    });
  }

  // 视频画布列表读取
  if (pathname === '/workflows/video/assets' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const page = Math.max(1, +(urlObj.searchParams.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, +(urlObj.searchParams.get('pageSize') || 24)));
    const offset = (page - 1) * pageSize;

    const totalCount = db.prepare("SELECT count(*) as c FROM assets WHERE kind='video' AND status NOT IN ('deleted', 'excluded')").get()?.c || 0;
    const readyCount = db.prepare("SELECT count(*) as c FROM assets WHERE kind='video' AND status='ready'").get()?.c || 0;

    const videos = db.prepare(`
      SELECT fid, file_name, kind, status, width, height, duration_s, poster_path, created_at, updated_at
      FROM assets
      WHERE kind='video' AND status NOT IN ('deleted', 'excluded')
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(pageSize, offset);

    return sendJson(res, 200, {
      success: true,
      data: {
        total: totalCount,
        readyCount,
        page,
        pageSize,
        videos
      }
    });
  }

  if (pathname === '/workflows/catalog' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { NODE_CATALOG } = require('./nodes/catalog');
    return sendJson(res, 200, { success: true, data: NODE_CATALOG });
  }

  if (pathname === '/workflows' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    const wfId = b.id || 'default';
    const currentWf = db.prepare('SELECT version FROM workflows WHERE id=?').get(wfId);
    const newVersion = (currentWf?.version || 1) + 1;
    const now = Date.now();
    const graphJson = JSON.stringify(b.graph || { nodes: [], edges: [] });

    db.prepare(`
      INSERT INTO workflows (id, name, version, is_default, graph_json, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version=excluded.version, graph_json=excluded.graph_json, updated_at=excluded.updated_at
    `).run(wfId, wfId === 'video' ? '视频工作流' : '自定义工作流', newVersion, graphJson, now, now);

    return sendJson(res, 200, { success: true, data: { id: wfId, version: newVersion } });
  }

  // 管理员专用：运行参数 (kv runtime_config 覆盖同名环境变量)
  if (pathname === '/settings/runtime-config' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { getRuntimeConfig } = require('./runtime-config');
    return sendJson(res, 200, { success: true, data: getRuntimeConfig(db) });
  }

  if (pathname === '/settings/runtime-config' && (req.method === 'PUT' || req.method === 'POST')) {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    const { setRuntimeConfig } = require('./runtime-config');
    const updated = setRuntimeConfig(db, b);
    return sendJson(res, 200, { success: true, data: updated });
  }

  // 管理员专用：运行批次与异常治理
  if (pathname === '/runs' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const runs = db.prepare(`
      SELECT 
        r.id,
        r.workflow_id,
        r.workflow_version,
        r.trigger,
        r.status,
        r.asset_count,
        r.error,
        r.created_at,
        r.started_at,
        r.finished_at,
        r.updated_at,
        COALESCE(ns.done_count, r.success_count, 0) as success_count,
        COALESCE(ns.failed_count, r.failed_count, 0) as failed_count,
        COALESCE(ns.pending_count, 0) as pending_count,
        COALESCE(ns.queued_count, 0) as queued_count,
        COALESCE(ns.running_count, 0) as running_count,
        COALESCE(ns.total_nodes, 0) as total_nodes,
        COALESCE(ast.ready_count, 0) as ready_asset_count,
        COALESCE(ast.excluded_count, 0) as excluded_asset_count,
        COALESCE(ast.processing_count, 0) as processing_asset_count
      FROM runs r
      LEFT JOIN (
        SELECT 
          run_id,
          COUNT(*) as total_nodes,
          SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done_count,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed_count,
          SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) as queued_count,
          SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) as running_count
        FROM node_runs
        GROUP BY run_id
      ) ns ON ns.run_id = r.id
      LEFT JOIN (
        SELECT 
          nr.run_id,
          COUNT(DISTINCT CASE WHEN a.status = 'ready' THEN a.fid END) as ready_count,
          COUNT(DISTINCT CASE WHEN a.status IN ('rejected','excluded') THEN a.fid END) as excluded_count,
          COUNT(DISTINCT CASE WHEN a.status IN ('discovered','processing') THEN a.fid END) as processing_count
        FROM node_runs nr
        JOIN assets a ON a.fid = nr.asset_fid AND a.kind = 'image'
        GROUP BY nr.run_id
      ) ast ON ast.run_id = r.id
      ORDER BY r.created_at DESC LIMIT 50
    `).all();

    const runIds = runs.map(r => r.id);
    const summaryMap = {};
    if (runIds.length > 0) {
      const placeholders = runIds.map(() => '?').join(',');
      const batchRows = db.prepare(`
        SELECT 
          nr.run_id,
          COUNT(DISTINCT a.fid) as total_images,
          COUNT(DISTINCT CASE WHEN a.status = 'excluded' THEN a.fid END) as gate_excluded,
          COUNT(DISTINCT CASE WHEN a.status != 'excluded' AND a.category = 'interior' THEN a.fid END) as gate_interior,
          COUNT(DISTINCT CASE WHEN a.status != 'excluded' AND a.category = 'furniture' THEN a.fid END) as gate_furniture,
          COUNT(DISTINCT CASE WHEN a.status != 'excluded' AND a.category = 'material' THEN a.fid END) as gate_material,
          COUNT(DISTINCT CASE WHEN a.status != 'excluded' AND a.category = 'exterior' THEN a.fid END) as gate_exterior,
          COUNT(DISTINCT CASE WHEN a.status = 'ready' THEN a.fid END) as final_ready,
          COUNT(DISTINCT CASE WHEN a.status IN ('rejected','excluded') THEN a.fid END) as final_excluded,
          COUNT(DISTINCT CASE WHEN a.status IN ('discovered','processing') THEN a.fid END) as final_processing
        FROM node_runs nr
        JOIN assets a ON a.fid = nr.asset_fid AND a.kind = 'image'
        WHERE nr.run_id IN (${placeholders})
        GROUP BY nr.run_id
      `).all(...runIds);

      const failedRows = db.prepare(`
        SELECT nr.run_id, nr.node_type, COUNT(*) as count
        FROM node_runs nr
        JOIN assets a ON a.fid = nr.asset_fid AND a.kind = 'image'
        WHERE nr.status = 'failed' AND nr.run_id IN (${placeholders})
        GROUP BY nr.run_id, nr.node_type
      `).all(...runIds);

      for (const b of batchRows) {
        summaryMap[b.run_id] = {
          totalImages: b.total_images || 0,
          gate: {
            interior: b.gate_interior || 0,
            furniture: b.gate_furniture || 0,
            material: b.gate_material || 0,
            exterior: b.gate_exterior || 0,
            excluded: b.gate_excluded || 0
          },
          finalStatus: {
            ready: b.final_ready || 0,
            excluded: b.final_excluded || 0,
            processing: b.final_processing || 0
          },
          failures: {},
          totalFailures: 0
        };
      }

      for (const f of failedRows) {
        if (!summaryMap[f.run_id]) {
          summaryMap[f.run_id] = {
            totalImages: 0,
            gate: { interior: 0, furniture: 0, material: 0, exterior: 0, excluded: 0 },
            finalStatus: { ready: 0, excluded: 0, processing: 0 },
            failures: {},
            totalFailures: 0
          };
        }
        summaryMap[f.run_id].failures[f.node_type] = f.count;
        summaryMap[f.run_id].totalFailures += f.count;
      }
    }

    const data = runs.map(r => ({
      ...r,
      batchSummary: summaryMap[r.id] || {
        totalImages: 0,
        gate: { interior: 0, furniture: 0, material: 0, exterior: 0, excluded: 0 },
        finalStatus: { ready: 0, excluded: 0, processing: 0 },
        failures: {},
        totalFailures: 0
      }
    }));
    return sendJson(res, 200, { success: true, data });
  }

  if (pathname === '/runs' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    if (!interpreter) return sendJson(res, 500, { error: '解释器未就绪' });
    const r = await interpreter.triggerRun({
      workflowId: b.workflowId || 'default',
      assetFids: b.assetFids || [],
      trigger: b.trigger || 'manual',
      limit: b.limit,
      mode: b.mode,
      targetNodeId: b.targetNodeId
    });
    return sendJson(res, 200, { success: true, data: r });
  }

  const mRunGraph = pathname.match(/^\/runs\/([^\/]+)\/graph$/);
  if (mRunGraph && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const runId = decodeURIComponent(mRunGraph[1]);
    const run = db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    if (!run) return sendJson(res, 404, { error: '批次不存在' });
    const wf = db.prepare('SELECT * FROM workflows WHERE id=?').get(run.workflow_id || 'default');
    let graph = { nodes: [], edges: [] };
    try { graph = JSON.parse(wf?.graph_json || '{}'); } catch { graph = { nodes: [], edges: [] }; }
    const inspectFid = urlObj.searchParams.get('fid');
    const agg = db.prepare(`
      SELECT node_id, node_type,
        SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) as skipped,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
        COUNT(*) as total
      FROM node_runs WHERE run_id=? GROUP BY node_id, node_type
    `).all(runId);
    const nodeStats = {};
    agg.forEach(r => { nodeStats[r.node_id] = r; });
    let inspect = null;
    if (inspectFid) {
      const parse = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
      const nrs = db.prepare(`
        SELECT * FROM node_runs WHERE run_id=? AND asset_fid=? ORDER BY id ASC
      `).all(runId, inspectFid);
      const asset = db.prepare('SELECT fid, file_name, status FROM assets WHERE fid=?').get(inspectFid) || null;
      // CONFLICT-002：重复组退役，cluster 信息恒为 null（字段保留兼容旧客户端）
      const cluster = null;
      inspect = {
        fid: inspectFid,
        asset,
        cluster,
        nodes: nrs.map(nr => ({
          ...nr,
          input: parse(nr.input_summary),
          output: parse(nr.output_summary)
        }))
      };
    }

    // 批次内图片专属统计总表
    const batchRow = db.prepare(`
      SELECT 
        COUNT(DISTINCT a.fid) as total_images,
        COUNT(DISTINCT CASE WHEN a.status = 'excluded' THEN a.fid END) as gate_excluded,
        COUNT(DISTINCT CASE WHEN a.status != 'excluded' AND a.category = 'interior' THEN a.fid END) as gate_interior,
        COUNT(DISTINCT CASE WHEN a.status != 'excluded' AND a.category = 'furniture' THEN a.fid END) as gate_furniture,
        COUNT(DISTINCT CASE WHEN a.status != 'excluded' AND a.category = 'material' THEN a.fid END) as gate_material,
        COUNT(DISTINCT CASE WHEN a.status != 'excluded' AND a.category = 'exterior' THEN a.fid END) as gate_exterior,
        COUNT(DISTINCT CASE WHEN a.status = 'ready' THEN a.fid END) as final_ready,
        COUNT(DISTINCT CASE WHEN a.status IN ('rejected','excluded') THEN a.fid END) as final_excluded,
        COUNT(DISTINCT CASE WHEN a.status IN ('discovered','processing') THEN a.fid END) as final_processing
      FROM node_runs nr
      JOIN assets a ON a.fid = nr.asset_fid AND a.kind = 'image'
      WHERE nr.run_id = ?
    `).get(runId);

    const failedRows = db.prepare(`
      SELECT nr.node_type, COUNT(*) as count
      FROM node_runs nr
      JOIN assets a ON a.fid = nr.asset_fid AND a.kind = 'image'
      WHERE nr.status = 'failed' AND nr.run_id = ?
      GROUP BY nr.node_type
    `).all(runId);

    const failures = {};
    let totalFailures = 0;
    (failedRows || []).forEach(f => {
      failures[f.node_type] = f.count;
      totalFailures += f.count;
    });

    const batchSummary = {
      totalImages: batchRow?.total_images || 0,
      gate: {
        interior: batchRow?.gate_interior || 0,
        furniture: batchRow?.gate_furniture || 0,
        material: batchRow?.gate_material || 0,
        exterior: batchRow?.gate_exterior || 0,
        excluded: batchRow?.gate_excluded || 0
      },
      finalStatus: {
        ready: batchRow?.final_ready || 0,
        excluded: batchRow?.final_excluded || 0,
        processing: batchRow?.final_processing || 0
      },
      failures,
      totalFailures
    };

    // 资产列表分页支持（移除 40 张截断限制）
    const totalCountRow = db.prepare(`
      SELECT COUNT(DISTINCT nr.asset_fid) as total
      FROM node_runs nr
      LEFT JOIN assets a ON a.fid = nr.asset_fid
      WHERE nr.run_id = ? AND (a.kind = 'image' OR a.kind IS NULL)
    `).get(runId);
    const total = totalCountRow?.total || 0;
    const page = Math.max(1, parseInt(urlObj.searchParams.get('page') || '1', 10));
    const pageSize = Math.max(1, Math.min(100, parseInt(urlObj.searchParams.get('pageSize') || '24', 10)));
    const totalPages = Math.ceil(total / pageSize) || 1;
    const offset = (page - 1) * pageSize;

    const assets = db.prepare(`
      SELECT nr.asset_fid as fid, a.file_name, a.thumb_url, a.status as asset_status, a.category,
        CASE
          WHEN SUM(CASE WHEN nr.status='running' THEN 1 ELSE 0 END) > 0 THEN 'running'
          WHEN SUM(CASE WHEN nr.status='queued' THEN 1 ELSE 0 END) > 0 THEN 'queued'
          WHEN SUM(CASE WHEN nr.status='failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
          WHEN SUM(CASE WHEN nr.status='done' THEN 1 ELSE 0 END) > 0 THEN 'done'
          ELSE 'skipped'
        END as last_status,
        MAX(nr.id) as last_id
      FROM node_runs nr
      LEFT JOIN assets a ON a.fid = nr.asset_fid
      WHERE nr.run_id=? AND (a.kind = 'image' OR a.kind IS NULL)
      GROUP BY nr.asset_fid
      ORDER BY
        CASE last_status
          WHEN 'running' THEN 0
          WHEN 'queued' THEN 1
          WHEN 'failed' THEN 2
          WHEN 'done' THEN 3
          ELSE 4
        END,
        last_id DESC
      LIMIT ? OFFSET ?
    `).all(runId, pageSize, offset);

    return sendJson(res, 200, {
      success: true,
      data: {
        run,
        graph,
        nodeStats,
        inspect,
        assets,
        pagination: {
          page,
          pageSize,
          total,
          totalPages
        },
        batchSummary
      }
    });
  }

  const mRunDetail = pathname.match(/^\/runs\/([^\/]+)$/);
  if (mRunDetail && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const runId = decodeURIComponent(mRunDetail[1]);
    const run = db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    if (!run) return sendJson(res, 404, { error: '批次不存在' });

    const page = Math.max(1, parseInt(urlObj.searchParams.get('page') || '1', 10));
    const pageSize = Math.max(1, Math.min(100, parseInt(urlObj.searchParams.get('pageSize') || '20', 10)));
    const offset = (page - 1) * pageSize;

    const totalRow = db.prepare(`
      SELECT COUNT(DISTINCT nr.asset_fid) as total
      FROM node_runs nr
      LEFT JOIN assets a ON a.fid = nr.asset_fid
      WHERE nr.run_id = ? AND (a.kind = 'image' OR a.kind IS NULL)
    `).get(runId);
    const total = totalRow?.total || 0;
    const totalPages = Math.ceil(total / pageSize) || 1;

    const assets = db.prepare(`
      SELECT 
        nr.asset_fid,
        a.file_name,
        a.thumb_url,
        a.status as asset_status,
        COUNT(nr.id) as node_count,
        CASE
          WHEN SUM(CASE WHEN nr.status='running' THEN 1 ELSE 0 END) > 0 THEN 'running'
          WHEN SUM(CASE WHEN nr.status='queued' THEN 1 ELSE 0 END) > 0 THEN 'queued'
          WHEN SUM(CASE WHEN nr.status='failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
          WHEN SUM(CASE WHEN nr.status='done' THEN 1 ELSE 0 END) > 0 THEN 'done'
          ELSE 'skipped'
        END as last_status
      FROM node_runs nr
      LEFT JOIN assets a ON a.fid = nr.asset_fid
      WHERE nr.run_id = ? AND (a.kind = 'image' OR a.kind IS NULL)
      GROUP BY nr.asset_fid
      ORDER BY
        CASE last_status
          WHEN 'running' THEN 0
          WHEN 'queued' THEN 1
          WHEN 'failed' THEN 2
          WHEN 'done' THEN 3
          ELSE 4
        END,
        MAX(nr.id) DESC
      LIMIT ? OFFSET ?
    `).all(runId, pageSize, offset);

    return sendJson(res, 200, {
      success: true,
      data: {
        run,
        assets,
        pagination: { page, pageSize, total, totalPages }
      }
    });
  }

  // ===== 工坊触发单次拆盒与重跑生图 =====
  const mRunUnpack = pathname.match(/^\/runs\/([^\/]+)\/unpack$/);
  if (mRunUnpack && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const runId = decodeURIComponent(mRunUnpack[1]);
    const run = db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    if (!run) return sendJson(res, 404, { error: '运行记录不存在' });

    // 拒绝非工坊运行拆盒：入库失败不提供「改中间提示词再重跑」，拆盒仅用于工坊触发
    if (run.trigger !== 'studio') {
      return sendJson(res, 400, { error: '入库运行不支持拆盒重跑，事后拆盒仅适用于工坊触发运行' });
    }

    const nrs = db.prepare('SELECT * FROM node_runs WHERE run_id=? ORDER BY id ASC').all(runId);
    let visionFields = {};
    let promptSummary = null;
    let genSummary = null;
    let model = 'seedream5flash';

    for (const nr of nrs) {
      let inp = {};
      let out = {};
      try { inp = nr.input_summary ? JSON.parse(nr.input_summary) : {}; } catch (_) {}
      try { out = nr.output_summary ? JSON.parse(nr.output_summary) : {}; } catch (_) {}

      if (nr.node_type === 'vision' || nr.node_id === 'vision' || nr.node_type === 'gate') {
        visionFields = {
          category: out.category || out.room_type || inp.category || '',
          style: out.style || inp.style || '',
          materials: out.materials || out.material || inp.materials || '',
          room_type: out.room_type || inp.room_type || '',
          description: out.description || out.analysis || inp.description || '',
          raw: out
        };
      } else if (nr.node_type === 'text' || nr.node_id === 'text') {
        promptSummary = {
          prompt: out.prompt || out.text || inp.prompt,
          template: inp.template,
        };
      } else if (nr.node_type === 'gen' || nr.node_id === 'gen' || nr.node_type === 'restage' || nr.node_type === 'image') {
        genSummary = {
          nodeRunId: nr.id,
          model: inp.model || out.model || model,
          prompt: inp.prompt || out.prompt,
          params: inp.params || inp.extras || {},
          status: nr.status,
          error: nr.error,
          output: out
        };
        if (inp.model) model = inp.model;
      }
    }

    const finalPrompt = genSummary?.prompt || promptSummary?.prompt || '';
    return sendJson(res, 200, {
      success: true,
      data: {
        runId,
        trigger: run.trigger,
        status: run.status,
        visionFields,
        editablePrompt: finalPrompt,
        finalPrompt,
        model,
        params: genSummary?.params || {},
        lastResult: genSummary?.output || null
      }
    });
  }

  const mRunRerunGen = pathname.match(/^\/runs\/([^\/]+)\/rerun-gen$/);
  if (mRunRerunGen && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const runId = decodeURIComponent(mRunRerunGen[1]);
    const run = db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    if (!run) return sendJson(res, 404, { error: '运行记录不存在' });

    if (run.trigger !== 'studio') {
      return sendJson(res, 400, { error: '入库运行不支持拆盒重跑，事后拆盒仅适用于工坊触发运行' });
    }

    const b = await parseBody(req);
    const newPrompt = (b.prompt || '').trim();
    if (!newPrompt) return sendJson(res, 400, { error: '提示词不能为空' });

    const { executeAdapter } = require('./gen');
    const { resolveModelExecution, assembleModelPayload } = require('./models-contract');
    const { pickAdapterId, adapterMissingError } = require('./adapter-match');
    const { engineStatus } = require('./lab');

    const now = Date.now();
    if (b.visionFields && typeof b.visionFields === 'object') {
      const visionNode = db.prepare("SELECT * FROM node_runs WHERE run_id=? AND (node_type IN ('vision','gate') OR node_id='vision') ORDER BY id DESC").get(runId);
      if (visionNode) {
        let prevOut = {};
        try { prevOut = JSON.parse(visionNode.output_summary || '{}'); } catch (_) {}
        const mergedOut = { ...prevOut, ...b.visionFields };
        db.prepare('UPDATE node_runs SET output_summary=?, updated_at=? WHERE id=?')
          .run(JSON.stringify(mergedOut), now, visionNode.id);
      }
    }

    const genNode = db.prepare("SELECT * FROM node_runs WHERE run_id=? AND (node_type IN ('gen','restage','image') OR node_id='gen') ORDER BY id DESC").get(runId);
    let genInp = {};
    try { genInp = genNode?.input_summary ? JSON.parse(genNode.input_summary) : {}; } catch (_) {}

    const targetModel = b.model || genInp.model || 'seedream5flash';
    const exec = resolveModelExecution(db, targetModel);

    const values = {
      ...(genInp.params || {}),
      ...(genInp.extras || {}),
      ...(b.params || {}),
      size: b.size || genInp.size || '2K',
      ratio: b.ratio || genInp.ratio || '1:1',
    };

    let assembled = null;
    if (exec?.model) {
      assembled = assembleModelPayload({
        modelContract: exec.model,
        editablePrompt: newPrompt,
        values
      });
    }

    const engines = engineStatus(db);
    const imgAdapters = engines.gen?.imageAdapters || [];
    const mCode = String(exec?.model?.vendor_model_id || targetModel);
    const pickedId = pickAdapterId('image', mCode, imgAdapters);
    const adapterRow = pickedId ? db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(pickedId) : null;
    if (!adapterRow) return sendJson(res, 503, { error: adapterMissingError('image', mCode) });

    try {
      const resData = await executeAdapter(services, adapterRow, {
        kind: 'image',
        prompt: assembled?.prompt || newPrompt,
        model: mCode,
        size: assembled?.body?.size || values.size,
        ratio: assembled?.body?.ratio || values.ratio,
        imageUrls: b.image ? [b.image] : (genInp.imageUrls || []),
        extras: {
          ...values,
          ...(assembled?.body || {})
        }
      });

      if (genNode) {
        db.prepare(`
          UPDATE node_runs SET
            status='done',
            error=NULL,
            input_summary=?,
            output_summary=?,
            updated_at=?
          WHERE id=?
        `).run(
          JSON.stringify({ prompt: newPrompt, model: targetModel, params: values, visionFields: b.visionFields || undefined }),
          JSON.stringify(resData),
          now,
          genNode.id
        );
      }
      db.prepare("UPDATE runs SET status='done', updated_at=? WHERE id=?").run(now, runId);

      return sendJson(res, 200, { success: true, data: resData });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  const mRunAsset = pathname.match(/^\/runs\/([^\/]+)\/assets\/([^\/]+)$/);
  if (mRunAsset && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const runId = decodeURIComponent(mRunAsset[1]);
    const fid = decodeURIComponent(mRunAsset[2]);
    const run = db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    if (!run) return sendJson(res, 404, { error: '批次不存在' });
    const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
    const nodeRuns = db.prepare(`
      SELECT nr.*, a.file_name
      FROM node_runs nr
      LEFT JOIN assets a ON a.fid = nr.asset_fid
      WHERE nr.run_id=? AND nr.asset_fid=?
      ORDER BY nr.id ASC
    `).all(runId, fid);
    const parse = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
    const nodes = nodeRuns.map(nr => ({
      ...nr,
      input: parse(nr.input_summary),
      output: parse(nr.output_summary)
    }));
    // CONFLICT-002：重复组退役，cluster 信息恒为 null（字段保留兼容旧客户端）
    const cluster = null;
    return sendJson(res, 200, { success: true, data: { run, asset, nodes, cluster } });
  }

  if (pathname === '/exceptions' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    // 治理台异常清单必须只列「真正还需要人管」的条目，否则永远 100 条起步的噪音。
    // 四类噪音必须剔除：
    //   1) 历史陈旧 —— 几天前的失败，今天早已无人关心（用 days 窗口，默认 7 天）
    //   2) 僵尸记录 —— 资产已被硬删/进回收站/拉黑，node_runs 还留着 failed 行，重试必然又是「对应资产记录不存在」
    //   3) 已恢复   —— 同一节点后来重跑成功了（以「最新一次运行」为准，而非「最新一次失败」）
    //   4) 确定性错误 —— 缺配置/参数错/模型没部署 这类，重试一万次也是同样结果
    const scope = String(urlObj.searchParams.get('scope') || 'actionable'); // actionable | all
    const days = Math.max(1, Math.min(365, parseInt(urlObj.searchParams.get('days') || '7', 10) || 7));
    const since = Date.now() - days * 86400000;
    const { isTransientErrorText, isDeterministicErrorText } = require('./nodes/index');

    // 第五类噪音：已废弃来源（2026-10-03 用户决定）
    // 夸克网盘源已废弃，不再新拉；历史拉取进来的资产保持「已拉取」状态不动它们的数据。
    // 但它们仍会在流水线里失败（源文件超 50MB 上限、CLI 已不在、连接不通），
    // 这些失败重试一万次也是同样结果，属于纯噪音，不该占用治理台待治理名额。
    // 注意：只从「待治理清单」里排除，**不删除资产、不删除 derivatives**——
    // 它们的源文件仍靠 storage_type='quark' 读取，删了就真的读不到了。
    const RETIRED_SOURCES = ['quark'];

    // 关键：以「最新一次运行」为准，而不是「最新一次失败」。
    // 否则 10-02 失败、10-03 重跑成功的节点，今天仍会被当成异常 —— 这正是历史噪音复现的根源。
    const latestPerNode = `
      SELECT nr.* FROM node_runs nr
      JOIN (
        SELECT asset_fid, node_id, MAX(id) as mid
        FROM node_runs
        WHERE updated_at >= ? OR updated_at IS NULL
        GROUP BY asset_fid, node_id
      ) x ON x.mid = nr.id
      WHERE nr.status = 'failed'
    `;
    const rows = db.prepare(`
      SELECT
        nr.id as node_run_id,
        a.fid as fid,
        a.file_name,
        '/api/assets/' || a.fid || '/image' as thumb_url,
        a.ready_flags,
        a.status as asset_status,
        COALESCE(a.source, '') as asset_source,
        COALESCE(nr.node_id, 'restage_9_16') as node_id,
        COALESCE(nr.node_type, nr.node_id, 'restage_9_16') as node_type,
        COALESCE(nr.status, 'failed') as node_status,
        COALESCE(nr.error, a.error_note, '包含异常警告标记') as error,
        COALESCE(nr.updated_at, a.updated_at, a.created_at) as updated_at
      FROM (${latestPerNode}) nr
      JOIN assets a ON a.fid = nr.asset_fid
      LEFT JOIN asset_trash t ON t.fid = a.fid
      LEFT JOIN (SELECT DISTINCT fid FROM asset_blacklist) b ON b.fid = a.fid
      WHERE t.fid IS NULL AND b.fid IS NULL
        AND COALESCE(a.status, '') NOT IN ('deleted', 'rejected', 'excluded')
      ORDER BY nr.updated_at DESC
      LIMIT 300
    `).all(since);

    const existingFids = new Set(rows.map(r => r.fid));
    const flaggedRows = db.prepare(`
      SELECT
        0 as node_run_id,
        a.fid as fid,
        a.file_name,
        '/api/assets/' || a.fid || '/image' as thumb_url,
        a.ready_flags,
        a.status as asset_status,
        COALESCE(a.source, '') as asset_source,
        'flagged_asset' as node_id,
        'flagged_asset' as node_type,
        'failed' as node_status,
        COALESCE(a.error_note, '包含异常警告标记') as error,
        COALESCE(a.updated_at, a.created_at) as updated_at
      FROM assets a
      LEFT JOIN asset_trash t ON t.fid = a.fid
      LEFT JOIN (SELECT DISTINCT fid FROM asset_blacklist) b ON b.fid = a.fid
      WHERE t.fid IS NULL AND b.fid IS NULL
        AND (a.status = 'ready_with_flags' OR (a.ready_flags IS NOT NULL AND a.ready_flags NOT IN ('', '[]')))
        AND COALESCE(a.status, '') NOT IN ('deleted', 'rejected', 'excluded')
      LIMIT 100
    `).all().filter(r => !existingFids.has(r.fid));
    rows.push(...flaggedRows);

    const stats = { total: rows.length, actionable: 0, zombie: 0, recovered: 0, deterministic: 0, retired_source: 0 };
    const list = [];

    for (const r of rows) {
      // 资产级僵尸：node_run 还在但资产已不可用（上面 SQL 已挡一层，这里兜底防御）
      if (!r.fid) { stats.zombie++; continue; }

      const isFlagged = r.node_id === 'flagged_asset' || r.asset_status === 'ready_with_flags';

      // 废弃来源：不算待治理，也不重试（数据保持原样，异常标记资产除外）
      // scope=all 时仍列出（标注 retired_source），保证「废弃源还剩多少」随时可查
      if (!isFlagged && RETIRED_SOURCES.includes(String(r.asset_source || '').toLowerCase())) {
        stats.retired_source++;
        if (scope === 'all') {
          list.push({
            ...r,
            retryable: false,
            error_kind: 'retired_source',
            asset_source: r.asset_source,
          });
        }
        continue;
      }

      // 已恢复判定：restage 类节点看是否已有合格产物（generated=true 且非 recast/垫边）
      if (String(r.node_type || r.node_id || '').startsWith('restage')) {
        try {
          const derivs = db.prepare('SELECT kind, params FROM derivatives WHERE asset_fid=?').all(r.fid);
          const hasQualified = derivs.some(d => {
            if (d.kind !== 'restage_9_16' && d.kind !== 'restage_3_4') return false;
            return isQualifiedAgnes({ kind: d.kind, params: d.params });
          });
          // 只有「本次失败后没补出图」才算异常；补出了就是历史噪音
          const failedAt = Number(r.updated_at || 0);
          const laterQualified = derivs.some(d => {
            if (d.kind !== 'restage_9_16' && d.kind !== 'restage_3_4') return false;
            if (!isQualifiedAgnes({ kind: d.kind, params: d.params })) return false;
            return Number(d.created_at || 0) >= failedAt;
          });
          if (hasQualified && laterQualified) { stats.recovered++; continue; }
        } catch (_) { /* derivatives 表异常不阻断列表 */ }
      }

      const isDeterministic = !isFlagged && isDeterministicErrorText(r.error);
      if (isDeterministic) {
        stats.deterministic++;
      } else {
        stats.actionable++;
      }
      list.push({
        ...r,
        retryable: !isDeterministic,
        error_kind: isDeterministic ? 'deterministic' : (isFlagged || isTransientErrorText(r.error) ? 'transient' : 'other'),
      });
    }

    // 默认只返回「可重试 + 偶发性」的；其他类噪音可通过 ?scope=all 查看
    const data = scope === 'all' ? list : list.filter(x => x.retryable && x.error_kind === 'transient');
    return sendJson(res, 200, { success: true, data, meta: { scope, stats, returned: data.length } });
  }

  const mRetry = pathname.match(/^\/exceptions\/(\d+)\/retry$/);
  if (mRetry && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const nrId = +mRetry[1];
    if (!interpreter) return sendJson(res, 500, { error: '解释器未就绪' });
    const r = await interpreter.retryNodeRun(nrId);
    return sendJson(res, 200, { success: true, data: r });
  }

  // 管理员专用：适配器列表与测试
  if (pathname === '/adapters' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { getProtocolManifest, listAllManifests } = require('./gen/builtin-protocols');
    const { getAdapterModule, listLoadedCustomAdapters } = require('./gen/adapters');
    const rows = db.prepare('SELECT id, label, kind, builtin, protocol, base_url, secrets_json, config_json, enabled, created_at, updated_at FROM gen_adapters ORDER BY builtin DESC, id ASC').all();
    const adapters = rows.map((r) => {
      const manifest = getProtocolManifest(r.protocol) || getAdapterModule(r.protocol) || {};
      let hasKey = false;
      let maskedKey = null;
      try {
        const sec = JSON.parse(r.secrets_json || '{}');
        if (sec.apiKey) {
          hasKey = true;
          const k = String(sec.apiKey);
          maskedKey = k.length > 8 ? `${k.slice(0, 4)}••••${k.slice(-4)}` : '••••••••';
        }
      } catch (_) {}
      return {
        id: r.id,
        label: r.label,
        kind: r.kind,
        builtin: r.builtin,
        protocol: r.protocol,
        base_url: r.base_url,
        config_json: r.config_json,
        enabled: r.enabled,
        created_at: r.created_at,
        updated_at: r.updated_at,
        method: manifest.method || 'POST',
        urlTemplate: manifest.urlTemplate || '',
        paramLocations: manifest.paramLocations || null,
        hasKey,
        maskedKey,
      };
    });
    return sendJson(res, 200, {
      success: true,
      data: adapters,
      manifests: listAllManifests().concat(listLoadedCustomAdapters()),
    });
  }

  if (pathname === '/adapters' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    const now = Date.now();
    const id = b.id || `adp_${Date.now()}`;

    // 适配器不再保存钥匙，鉴权由接入点与环境变量管理
    db.prepare(`
      INSERT INTO gen_adapters (id, label, kind, builtin, protocol, base_url, secrets_json, config_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, NULL, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label=excluded.label, kind=excluded.kind, protocol=excluded.protocol,
        base_url=excluded.base_url, secrets_json=NULL,
        config_json=excluded.config_json, updated_at=excluded.updated_at
    `).run(id, b.label, b.kind || 'image', b.protocol, b.base_url, JSON.stringify(b.config || {}), now, now);

    return sendJson(res, 200, { success: true, data: { id } });
  }

  const mAdpToggle = pathname.match(/^\/adapters\/([^\/]+)\/toggle$/);
  if (mAdpToggle && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const id = decodeURIComponent(mAdpToggle[1]);
    const b = await parseBody(req);
    db.prepare('UPDATE gen_adapters SET enabled=?, updated_at=? WHERE id=?').run(b.enabled ? 1 : 0, Date.now(), id);
    return sendJson(res, 200, { success: true });
  }

  const mAdpDel = pathname.match(/^\/adapters\/([^\/]+)$/);
  if (mAdpDel && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const id = decodeURIComponent(mAdpDel[1]);
    const target = db.prepare('SELECT builtin FROM gen_adapters WHERE id=?').get(id);
    if (!target) return sendJson(res, 404, { error: '适配器不存在' });
    if (target.builtin) return sendJson(res, 400, { error: '内置适配器不允许删除' });
    db.prepare('DELETE FROM gen_adapters WHERE id=?').run(id);
    return sendJson(res, 200, { success: true, data: { id } });
  }

  if (pathname === '/adapters/test' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    const adapter = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(b.adapterId) || b.adapter;
    if (!adapter) return sendJson(res, 400, { error: '缺少适配器定义' });

    const start = Date.now();
    try {
      const resData = await executeAdapter(services, adapter, {
        kind: adapter.kind === 'video' ? 'video' : 'image',
        prompt: b.prompt || '现代极简客厅室内设计效果图',
        model: b.model
      });
      const firstFile = resData.files?.[0];
      const previewUrl = firstFile?.previewUrl || (firstFile?.localPath ? `/api/cache/temp/${path.basename(firstFile.localPath)}` : null);
      return sendJson(res, 200, {
        success: true,
        data: {
          ...resData,
          success: true,
          previewUrl,
          durationMs: Date.now() - start
        }
      });
    } catch (e) {
      return sendJson(res, 200, { success: false, error: e.message, durationMs: Date.now() - start });
    }
  }

  // ================= 供应商与接入点 (Providers / Endpoints) 接口 =================
  if (pathname === '/providers' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { getEndpointsList } = require('./models-contract');
    return sendJson(res, 200, { success: true, data: getEndpointsList(db) });
  }

  if (pathname === '/providers/env-keys' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { getAvailableEnvKeys } = require('./models-contract');
    return sendJson(res, 200, { success: true, data: getAvailableEnvKeys() });
  }

  if (pathname === '/providers/env-secrets' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { inspectEnvKey, KNOWN_SECRET_ENV_SPECS } = require('./env-secrets');
    const { getAvailableEnvKeys } = require('./models-contract');
    const keys = getAvailableEnvKeys();
    return sendJson(res, 200, {
      success: true,
      data: {
        items: keys.map(k => inspectEnvKey(k)),
        specs: KNOWN_SECRET_ENV_SPECS,
      }
    });
  }

  if (pathname === '/providers/env-secrets' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const { writeEnvUpdates } = require('./env-secrets');
      const result = writeEnvUpdates(b?.updates || {});
      return sendJson(res, 200, { success: true, data: result });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/providers' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { saveEndpointData } = require('./models-contract');
    const b = await parseBody(req);
    try {
      const p = saveEndpointData(db, b);
      return sendJson(res, 200, { success: true, data: p });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const mProvDel = pathname.match(/^\/providers\/([^\/]+)$/);
  if (mProvDel && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const id = decodeURIComponent(mProvDel[1]);
    try {
      const { deleteEndpointData } = require('./models-contract');
      deleteEndpointData(db, id);
      return sendJson(res, 200, { success: true, data: { id } });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const mProvToggle = pathname.match(/^\/providers\/([^\/]+)\/toggle$/);
  if (mProvToggle && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const id = decodeURIComponent(mProvToggle[1]);
    const b = await parseBody(req);
    const enabled = b.enabled ? 1 : 0;
    try {
      db.prepare('UPDATE llm_endpoints SET enabled=?, updated_at=? WHERE id=?').run(enabled, Date.now(), id);
      try { db.prepare('UPDATE llm_providers SET enabled=?, updated_at=? WHERE id=?').run(enabled, Date.now(), id); } catch (_) {}
      return sendJson(res, 200, { success: true, id, enabled: !!b.enabled });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/providers/litellm/toggle-batch' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { toggleLiteLLMBatch } = require('./providers');
    const b = await parseBody(req);
    const r = toggleLiteLLMBatch(db, b.enabled);
    return sendJson(res, 200, r);
  }

  // ================= 大模型 (Models) 接口 =================
  if (pathname === '/models' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { getModels } = require('./providers');
    const provId = urlObj.searchParams.get('provider_id');
    const cap = urlObj.searchParams.get('capability');
    return sendJson(res, 200, { success: true, data: getModels(db, { provider_id: provId, capability: cap }) });
  }

  if (pathname === '/models' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { saveModel } = require('./providers');
    const b = await parseBody(req);
    try {
      const m = saveModel(db, b);
      return sendJson(res, 200, { success: true, data: m });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const mModelDel = pathname.match(/^\/models\/([^\/]+)$/);
  if (mModelDel && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { deleteModel } = require('./providers');
    const id = decodeURIComponent(mModelDel[1]);
    const r = deleteModel(db, id);
    return sendJson(res, 200, r);
  }

  const mModelToggle = pathname.match(/^\/models\/([^\/]+)\/toggle$/);
  if (mModelToggle && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { toggleModel } = require('./providers');
    const id = decodeURIComponent(mModelToggle[1]);
    const b = await parseBody(req);
    const r = toggleModel(db, id, b.enabled);
    return sendJson(res, 200, r);
  }

  const mModelTest = pathname.match(/^\/models\/([^\/]+)\/test$/);
  if (mModelTest && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { testModel } = require('./providers');
    const id = decodeURIComponent(mModelTest[1]);
    const b = await parseBody(req);
    try {
      const r = await testModel(services, id, b);
      return sendJson(res, 200, { success: true, data: r });
    } catch (e) {
      return sendJson(res, 200, { success: false, error: e.message });
    }
  }

  if (pathname === '/models/sync-litellm' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { syncFromLiteLLM, litellmAdmin } = require('./providers');
    try {
      const { baseUrl, apiKey } = litellmAdmin(db, services.config);
      if (!apiKey) throw new Error('本地网关没有钥匙');
      const r = await syncFromLiteLLM(db, baseUrl, apiKey);
      return sendJson(res, 200, { success: true, data: r });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 批量重跑所有失败节点 (一键异常治理重试)
  if (pathname === '/runs/retry-all-failed' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    // 与 /exceptions 的 actionable 口径保持一致：只重试「资产还活着 + 偶发错误 + 近期」，
    // 否则会把已删素材的僵尸记录和历史陈旧失败也重跑一遍，白白刷失败数。
    const days = Math.max(1, Math.min(365, parseInt(urlObj.searchParams.get('days') || '7', 10) || 7));
    const since = Date.now() - days * 86400000;
    const { isTransientErrorText, isDeterministicErrorText } = require('./nodes/index');
    const rows = db.prepare(`
      SELECT nr.id as id, nr.error, COALESCE(a.source,'') as source FROM node_runs nr
      JOIN (
        SELECT asset_fid, node_id, MAX(id) as mid FROM node_runs
        WHERE updated_at >= ? OR updated_at IS NULL
        GROUP BY asset_fid, node_id
      ) x ON x.mid = nr.id
      JOIN assets a ON a.fid = nr.asset_fid
      LEFT JOIN asset_trash t ON t.fid = a.fid
      LEFT JOIN (SELECT DISTINCT fid FROM asset_blacklist) b ON b.fid = a.fid
      WHERE nr.status = 'failed'
        AND t.fid IS NULL AND b.fid IS NULL
        AND COALESCE(a.status, '') NOT IN ('deleted','rejected','excluded')
      ORDER BY nr.updated_at DESC LIMIT 300
    `).all(since);
    // 与 /exceptions 同一口径：废弃来源（夸克）不重试。
    // 源已废弃，重试必然还是同样错误，纯属白跑。
    const RETIRED_SOURCES = ['quark'];
    const afterRetired = rows.filter(r => !RETIRED_SOURCES.includes(String(r.source || '').toLowerCase()));
    const retiredSkipped = rows.length - afterRetired.length;
    const ids = afterRetired
      .filter(r => !isDeterministicErrorText(r.error) && isTransientErrorText(r.error))
      .map(r => r.id);
    const skipped = afterRetired.length - ids.length;

    let count = 0;
    for (const id of ids) {
      try {
        await interpreter.retryNodeRun(id);
        count++;
      } catch (err) {
        console.error('[retry-all] 重试节点失败:', id, err.message);
      }
    }
    return sendJson(res, 200, {
      success: true,
      data: { retried_count: count, skipped_noise: skipped, skipped_retired_source: retiredSkipped },
    });
  }

  // CONFLICT-002：重复组概念已退役——/dup-groups/representative、/dup-groups/ungroup、
  // /dup-groups/recluster 三条路由连同 cluster.js 模块一并移除。
  // 旧客户端调用将得到 404（进入下方兜底）。

  // 网关配置写入（管理员，热生效）
  if (pathname === '/gateway/config' && (req.method === 'PUT' || req.method === 'POST')) {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const data = require('./gateway').setConfig(db, b.config || b, { actor: sessionUser?.username || 'admin' });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 手动触发过期拒收件清理
  if (pathname === '/gateway/purge' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const data = require('./reject-box').purgeExpired(services, { keepDays: Number(b.keepDays) || undefined, limit: Number(b.limit) || 500 });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // 存量已删素材回灌拒收箱（保留 keepDays 天）
  if (pathname === '/gateway/regurgitate' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const data = require('./reject-box').regurgitateDeletedIntoRejected(services, {
        keepDays: Number(b.keepDays) || 3,
        limit: Number(b.limit) || 5000,
      });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // CONFLICT-002：/dup-groups/recluster 已随重复组退役移除。

  const mMainDeriv = pathname.match(/^\/assets\/([^\/]+)\/main-derivative$/);
  if (mMainDeriv && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const fid = decodeURIComponent(mMainDeriv[1]);
    const b = await parseBody(req);
    if (!b.derivativeId) return sendJson(res, 400, { error: '缺少 derivativeId' });
    const deriv = getDerivativeById(db, b.derivativeId);
    if (!deriv || deriv.asset_fid !== fid) return sendJson(res, 404, { error: '衍生图不存在' });
    if (deriv.kind === 'restage_3_4') {
      return sendJson(res, 400, { error: '3:4 不能设为列表封面；主图只表示重复组代表照片' });
    }
    if (String(deriv.kind || '').startsWith('restage_') && !isQualifiedAgnes(deriv)) {
      return sendJson(res, 400, { error: '不合格重构图不能作为封面' });
    }
    setMainDerivative(services, fid, b.derivativeId);
    return sendJson(res, 200, { success: true });
  }

  if (pathname === '/assets/ingest' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { ingestBuffer, parseMultipart, readRequestBuffer } = require('./ingest');
    const ct = req.headers['content-type'] || '';
    try {
      if (ct.includes('multipart/form-data')) {
        const buf = await readRequestBuffer(req);
        const { fields, files } = parseMultipart(buf, ct);
        const file = files.find(f => f.name === 'file') || files[0];
        if (!file) return sendJson(res, 400, { error: '缺少 file' });
        const r = await ingestBuffer(services, {
          buffer: file.data,
          fileName: file.filename || fields.filename || 'upload.jpg',
          source: fields.source || 'upload',
          clientAssetId: fields.client_asset_id || null,
          takenAt: fields.taken_at ? Number(fields.taken_at) : null,
          category: fields.category || null,
          shelf: fields.shelf || null
        });
        return sendJson(res, 200, { success: true, data: r });
      }
      if (ct.includes('application/octet-stream') || ct.includes('image/')) {
        const buf = await readRequestBuffer(req);
        const r = await ingestBuffer(services, {
          buffer: buf,
          fileName: req.headers['x-filename'] || 'upload.jpg',
          source: req.headers['x-source'] || 'upload',
          clientAssetId: req.headers['x-client-asset-id'] || null
        });
        return sendJson(res, 200, { success: true, data: r });
      }
      return sendJson(res, 400, { error: '请使用 multipart/form-data 或 octet-stream 上传原图' });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/settings/backup' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { getBackupSettings } = require('./ingest');
    return sendJson(res, 200, { success: true, data: getBackupSettings(db, config) });
  }
  if (pathname === '/settings/backup' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { saveBackupSettings } = require('./ingest');
    const b = await parseBody(req);
    return sendJson(res, 200, { success: true, data: saveBackupSettings(db, b, config) });
  }

  // 管理员专用：快照设备状态（内置直收，取代原外部接收器代理）
  if (pathname === '/snapshot-status' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { getSnapshotDevices, getSyncDashboard } = require('./snapshot');
    const authCounts = db.prepare(`
      SELECT COALESCE(auth_state, 'unmanaged') AS state, COUNT(*) c FROM assets GROUP BY auth_state
    `).all();
    const authStateCounts = {};
    for (const r of authCounts) authStateCounts[r.state] = r.c;
    const dash = getSyncDashboard(db, { limit: Number(urlObj.searchParams.get('limit') || 50) });
    return sendJson(res, 200, {
      success: true,
      data: {
        ok: true,
        devices: getSnapshotDevices(db),
        now: Date.now(),
        authStateCounts,
        lastSync: dash.lastSync,
        summary: dash.summary,
        events: dash.events
      }
    });
  }

  // 管理员：同步变更日志（新增/移除/冻结 × 图/视频）
  if (pathname === '/sync-log' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const { getSyncDashboard } = require('./snapshot');
    const limit = Number(urlObj.searchParams.get('limit') || 50);
    const deviceId = urlObj.searchParams.get('device_id') || '';
    const type = urlObj.searchParams.get('type') || '';
    let dash = getSyncDashboard(db, { limit, deviceId });
    if (type) {
      dash = { ...dash, events: dash.events.filter((e) => e.type === type) };
    }
    return sendJson(res, 200, { success: true, data: dash });
  }

  if (pathname === '/vectors/status' && req.method === 'GET') {
    const wf = db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get();
    let configuredModel = 'text-embedding-3-small';
    let configuredProvider = 'litellm';
    try {
      const g = JSON.parse(wf?.graph_json || '{}');
      const idx = (g.nodes || []).find(n => n.type === 'index');
      if (idx?.config?.embeddingModel) configuredModel = idx.config.embeddingModel;
      if (idx?.config?.embeddingProvider) configuredProvider = idx.config.embeddingProvider;
    } catch { /* defaults */ }
    return sendJson(res, 200, { success: true, data: getVectorStatus(db, { configuredModel, configuredProvider }) });
  }

  if (pathname === '/vectors/recompute' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const wf = db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get();
    let embeddingModel = 'text-embedding-3-small';
    let embeddingProvider = 'litellm';
    try {
      const g = JSON.parse(wf?.graph_json || '{}');
      const idx = (g.nodes || []).find(n => n.type === 'index');
      if (idx?.config?.embeddingModel) embeddingModel = idx.config.embeddingModel;
      if (idx?.config?.embeddingProvider) embeddingProvider = idx.config.embeddingProvider;
    } catch { /* defaults */ }
    const assets = db.prepare(`
      SELECT fid, file_name FROM assets WHERE status = 'ready'
    `).all();
    // PERF-08：一次性批量取标签，避免逐素材 N+1 查询。
    const allTagRows = db.prepare(`
      SELECT at.asset_fid, t.dimension, t.label FROM asset_tags at
      JOIN tag_dict t ON t.id = at.tag_id
    `).all();
    const tagsByFid = new Map();
    for (const t of allTagRows) {
      if (!tagsByFid.has(t.asset_fid)) tagsByFid.set(t.asset_fid, []);
      tagsByFid.get(t.asset_fid).push(t);
    }
    const jobs = assets.map((a) => {
      const tagMap = {};
      for (const t of tagsByFid.get(a.fid) || []) {
        if (!tagMap[t.dimension]) tagMap[t.dimension] = [];
        tagMap[t.dimension].push(t.label);
      }
      const parts = [];
      if (tagMap.space) parts.push(`空间:${tagMap.space.join(',')}`);
      if (tagMap.style_atom) parts.push(`风格:${tagMap.style_atom.join(',')}`);
      if (tagMap.material_kind) parts.push(`材质:${tagMap.material_kind.join(',')}`);
      if (tagMap.palette) parts.push(`配色:${tagMap.palette.join(',')}`);
      if (a.file_name) parts.push(`文件:${a.file_name}`);
      return { fid: a.fid, caption: parts.join(' ') || '室内设计现代空间素材' };
    });

    // PERF-08：并发度 6 的批处理池，替代逐条串行等待 Embedding 接口。
    const CONCURRENCY = 6;
    let updated = 0;
    let fallback = 0;
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= jobs.length) return;
        const job = jobs[i];
        const embed = await embedCaption(services, job.caption, { provider: embeddingProvider, model: embeddingModel });
        storeVector(db, job.fid, embed.vec, embed.model);
        updated++;
        if (embed.fallback) fallback++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) || 1 }, worker));
    return sendJson(res, 200, {
      success: true,
      data: { updated, fallback, status: getVectorStatus(db, { configuredModel: embeddingModel, configuredProvider: embeddingProvider }) }
    });
  }

  if (pathname === '/runs/restage-backfill' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    if (!interpreter) return sendJson(res, 500, { error: '解释器未就绪' });
    const b = await parseBody(req).catch(() => ({}));
    const r = await interpreter.queueMissingRestage({ limit: b?.limit || 2000 });
    return sendJson(res, 200, { success: true, data: r });
  }

  // 管理员：模型契约治理
  if (pathname === '/governance/gen-models' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { getModelContractsList } = require('./models-contract');
      return sendJson(res, 200, { success: true, data: getModelContractsList(db) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  if (pathname === '/governance/litellm-groups' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { listLiteLlmMembers } = require('./providers');
      const name = urlObj.searchParams.get('model') || '';
      const data = await listLiteLlmMembers(db, services.config, name);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      const err = String(e.message || '')
        .replace(/sk-[A-Za-z0-9_\-]+/gi, 'sk-***')
        .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
        .replace(/"(api_?key|secret_?key|password|token|master_?key)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
        .replace(/(api_?key|secret_?key|password|token|master_?key)\s*=\s*[^\s&]+/gi, '$1=***');
      return sendJson(res, 400, { error: err });
    }
  }
  const mGroupMember = pathname.match(/^\/governance\/litellm-groups\/([^/]+)\/members$/);
  if (mGroupMember && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { addLiteLlmMember } = require('./providers');
      const b = await parseBody(req);
      const modelName = decodeURIComponent(mGroupMember[1]);
      await addLiteLlmMember(db, services.config, modelName, b.upstream);
      return sendJson(res, 200, { success: true });
    } catch (e) {
      const err = String(e.message || '')
        .replace(/sk-[A-Za-z0-9_\-]+/gi, 'sk-***')
        .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
        .replace(/"(api_?key|secret_?key|password|token|master_?key)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
        .replace(/(api_?key|secret_?key|password|token|master_?key)\s*=\s*[^\s&]+/gi, '$1=***');
      return sendJson(res, 400, { error: err });
    }
  }
  const mGroupRemove = pathname.match(/^\/governance\/litellm-groups\/([^/]+)\/members\/([^/]+)$/);
  if (mGroupRemove && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { removeLiteLlmMember } = require('./providers');
      await removeLiteLlmMember(db, services.config, decodeURIComponent(mGroupRemove[1]), decodeURIComponent(mGroupRemove[2]));
      return sendJson(res, 200, { success: true });
    } catch (e) {
      const err = String(e.message || '')
        .replace(/sk-[A-Za-z0-9_\-]+/gi, 'sk-***')
        .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
        .replace(/"(api_?key|secret_?key|password|token|master_?key)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
        .replace(/(api_?key|secret_?key|password|token|master_?key)\s*=\s*[^\s&]+/gi, '$1=***');
      return sendJson(res, 400, { error: err });
    }
  }
  if (pathname === '/governance/gen-models/preview-convert' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const { getModelContractsList, assembleModelPayload } = require('./models-contract');
      const { previewUnifiedConversion } = require('./converters');
      const list = getModelContractsList(db).models;
      const contract = b.contract || list.find(m => m.id === b.model_id) || list[0];
      const assembled = assembleModelPayload({
        modelContract: contract,
        values: b.values || {},
        editablePrompt: b.prompt || '现代极简客厅，落地窗自然采光，@图片1 沙发细节保留',
        images: b.images || ['https://example.com/ref1.jpg'],
      });
      const converted = previewUnifiedConversion({
        contract,
        canonicalInput: {
          prompt: b.prompt || '现代极简客厅，落地窗自然采光，@图片1 沙发细节保留',
          negativePrompt: b.negativePrompt || '模糊，伪影，水渍',
          mode: b.mode || 'text_to_image',
          params: b.values || {},
          refs: { images: b.images || ['https://example.com/ref1.jpg'], videos: b.videos || [], audios: b.audios || [] },
          selection: b.selection || { bbox: [120, 200, 680, 760] },
        }
      });
      return sendJson(res, 200, {
        success: true,
        data: {
          assembled,
          converted,
        }
      });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/governance/gen-models' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const { saveModelContractData } = require('./models-contract');
      const row = saveModelContractData(db, b);
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mCustomSchema = pathname.match(/^\/governance\/gen-models\/([^/]+)\/schema$/);
  if (mCustomSchema && req.method === 'PUT') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const row = genGov.saveCustomFields(db, decodeURIComponent(mCustomSchema[1]), b.fields || b.custom_fields, sessionUser?.username);
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mCustomDelete = pathname.match(/^\/governance\/gen-models\/([^/]+)$/);
  if (mCustomDelete && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const modelId = decodeURIComponent(mCustomDelete[1]);
      db.prepare('DELETE FROM model_contracts WHERE id=?').run(modelId);
      try { db.prepare('DELETE FROM llm_models WHERE id=?').run(modelId); } catch (_) {}
      return sendJson(res, 200, { success: true, data: { id: modelId } });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mPolish = pathname.match(/^\/governance\/gen-models\/([^/]+)\/polish$/);
  if (mPolish && req.method === 'PUT') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const row = genGov.savePolish(db, decodeURIComponent(mPolish[1]), b, sessionUser?.username);
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const mGenModelToggle = pathname.match(/^\/governance\/gen-models\/([^/]+)\/toggle$/);
  if (mGenModelToggle && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const modelId = decodeURIComponent(mGenModelToggle[1]);
      const b = await parseBody(req);
      const enabled = b.enabled ? 1 : 0;
      db.prepare("UPDATE model_contracts SET enabled=?, updated_at=? WHERE id=? OR vendor_model_id=?").run(enabled, Date.now(), modelId, modelId);
      try {
        db.prepare("UPDATE llm_models SET enabled=?, updated_at=? WHERE id=? OR model_code=?").run(enabled, Date.now(), modelId, modelId);
      } catch (_) {}
      return sendJson(res, 200, { success: true, modelId, enabled: !!b.enabled });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mPolishReset = pathname.match(/^\/governance\/gen-models\/([^/]+)\/polish\/reset$/);
  if (mPolishReset && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const row = genGov.resetPolish(db, decodeURIComponent(mPolishReset[1]));
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // ================= 工作流 (Workflows) 统一文档接口 =================
  if (pathname === '/governance/workflows' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { getWorkflowsDocument } = require('./models-contract');
      return sendJson(res, 200, { success: true, data: getWorkflowsDocument(db) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  if (pathname === '/governance/workflows' && (req.method === 'PUT' || req.method === 'POST')) {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const { saveWorkflowsDocument } = require('./models-contract');
      const doc = saveWorkflowsDocument(db, b);
      return sendJson(res, 200, { success: true, data: doc });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // ================= 提示词中心 (Prompts Center) 治理接口 =================
  if (pathname === '/governance/prompts' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { getPromptTemplatesList } = require('./models-contract');
      return sendJson(res, 200, { success: true, data: getPromptTemplatesList(db) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  if (pathname === '/governance/prompts' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const { savePromptTemplate } = require('./models-contract');
      const saved = savePromptTemplate(db, b);
      return sendJson(res, 200, { success: true, data: saved });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mPromptDel = pathname.match(/^\/governance\/prompts\/([^/]+)$/);
  if (mPromptDel && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const id = decodeURIComponent(mPromptDel[1]);
    try {
      const { deletePromptTemplate } = require('./models-contract');
      deletePromptTemplate(db, id);
      return sendJson(res, 200, { success: true, data: { id } });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mPromptRestore = pathname.match(/^\/governance\/prompts\/([^/]+)\/restore$/);
  if (mPromptRestore && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const id = decodeURIComponent(mPromptRestore[1]);
    try {
      const { restorePromptTemplateDefault } = require('./models-contract');
      const restored = restorePromptTemplateDefault(db, id);
      return sendJson(res, 200, { success: true, data: restored });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // ================= 模块化挂载点与工作流编排 (Mount Points & Modules) 接口 =================
  if (pathname === '/governance/mount-points' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { getMountPointsList } = require('./models-contract');
      return sendJson(res, 200, { success: true, data: getMountPointsList(db) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  if (pathname === '/governance/mount-points' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const { saveMountPoint } = require('./models-contract');
      const saved = saveMountPoint(db, b);
      return sendJson(res, 200, { success: true, data: saved });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mMountDel = pathname.match(/^\/governance\/mount-points\/([^/]+)$/);
  if (mMountDel && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const id = decodeURIComponent(mMountDel[1]);
    try {
      const { deleteMountPoint } = require('./models-contract');
      deleteMountPoint(db, id);
      return sendJson(res, 200, { success: true, data: { id } });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mMountMods = pathname.match(/^\/governance\/mount-points\/([^/]+)\/modules$/);
  if (mMountMods && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const mountId = decodeURIComponent(mMountMods[1]);
    try {
      const { getMountModules } = require('./models-contract');
      return sendJson(res, 200, { success: true, data: getMountModules(db, mountId) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  if (mMountMods && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const mountId = decodeURIComponent(mMountMods[1]);
    try {
      const b = await parseBody(req);
      const { saveMountModule } = require('./models-contract');
      const saved = saveMountModule(db, { ...b, mount_point_id: mountId });
      return sendJson(res, 200, { success: true, data: saved });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mMountModDel = pathname.match(/^\/governance\/mount-points\/([^/]+)\/modules\/([^/]+)$/);
  if (mMountModDel && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const moduleId = decodeURIComponent(mMountModDel[2]);
    try {
      const { deleteMountModule } = require('./models-contract');
      deleteMountModule(db, moduleId);
      return sendJson(res, 200, { success: true, data: { id: moduleId } });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mMountReorder = pathname.match(/^\/governance\/mount-points\/([^/]+)\/reorder$/);
  if (mMountReorder && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const mountId = decodeURIComponent(mMountReorder[1]);
    try {
      const b = await parseBody(req);
      const { reorderMountModules } = require('./models-contract');
      const list = reorderMountModules(db, mountId, b.orderedIds || []);
      return sendJson(res, 200, { success: true, data: list });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  // ================= 算子目录、词典宏芯片、公共积木、编译预览与真机沙盒试跑接口 =================
  if (pathname === '/governance/operators' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { getOperatorCatalog } = require('./models-contract');
      return sendJson(res, 200, { success: true, data: getOperatorCatalog() });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/governance/dict-macros' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { getDictMacroChips } = require('./models-contract');
      return sendJson(res, 200, { success: true, data: getDictMacroChips(db) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/governance/snippets' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { getPromptSnippetsList } = require('./models-contract');
      return sendJson(res, 200, { success: true, data: getPromptSnippetsList(db) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  if (pathname === '/governance/snippets' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const { savePromptSnippet } = require('./models-contract');
      const saved = savePromptSnippet(db, b);
      return sendJson(res, 200, { success: true, data: saved });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mSnippetDel = pathname.match(/^\/governance\/snippets\/([^/]+)$/);
  if (mSnippetDel && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { deletePromptSnippet } = require('./models-contract');
      const id = decodeURIComponent(mSnippetDel[1]);
      deletePromptSnippet(db, id);
      return sendJson(res, 200, { success: true, data: { id } });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mSnippetRestore = pathname.match(/^\/governance\/snippets\/([^/]+)\/restore$/);
  if (mSnippetRestore && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const { restorePromptSnippetDefault } = require('./models-contract');
      const id = decodeURIComponent(mSnippetRestore[1]);
      const restored = restorePromptSnippetDefault(db, id);
      return sendJson(res, 200, { success: true, data: restored });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/governance/prompts/preview-compile' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const { compileNodePrompt } = require('./models-contract');
      const compiled = compileNodePrompt(db, {
        mountPointId: b.mountPointId || null,
        nodeId: b.nodeId || null,
        nodeType: b.nodeType || null,
        category: b.category || 'interior',
        promptId: b.promptId || null,
        promptTemplate: b.promptTemplate || b.template || null,
        snippetIds: Array.isArray(b.snippetIds) ? b.snippetIds : null,
        modelId: b.modelId || null,
        vars: b.vars || {
          box1Tag: '240 360 760 880',
          product_name: '意式极简真皮沙发',
          facing_desc: '正面朝向观察者，四脚平稳贴地',
          source_style: '（原风格：现代极简）',
          target_style: '奶油侘寂风',
          side_a: '左侧',
          side_b: '右侧',
          asset: { fid: 'sample_fid_001', file_name: 'living_room_sample.jpg', width: 1920, height: 1080, category: 'interior' },
        },
      });
      return sendJson(res, 200, { success: true, data: compiled });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/governance/sandbox/run-node' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const { compileNodePrompt } = require('./models-contract');
      const { NODE_REGISTRY } = require('./nodes');
      const draftNode = b.draft_node || b.draftNode || null;
      const draftSnippets = b.draft_snippets || b.draftSnippets || null;
      const draftDialect = b.draft_dialect || b.draftDialect || null;

      const nodeType = String(
        draftNode?.node_type || draftNode?.nodeType || b.nodeType || b.node_type || 'gate'
      ).trim();

      // 支持选 1~3 张已有素材图 (asset_fids / assetFids / assetFid)
      const rawFids = Array.isArray(b.asset_fids)
        ? b.asset_fids
        : Array.isArray(b.assetFids)
          ? b.assetFids
          : (b.assetFid || b.fid ? [b.assetFid || b.fid] : []);
      const requestedFids = rawFids.map(f => String(f || '').trim()).filter(Boolean).slice(0, 3);

      let selectedAssets = [];
      for (const fid of requestedFids) {
        const a = db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
        if (a) selectedAssets.push(a);
      }
      if (!selectedAssets.length) {
        selectedAssets = db.prepare("SELECT * FROM assets WHERE status='ready' AND kind='image' ORDER BY updated_at DESC LIMIT 1").all();
        if (!selectedAssets.length) {
          selectedAssets = db.prepare('SELECT * FROM assets ORDER BY updated_at DESC LIMIT 1').all();
        }
      }
      selectedAssets = selectedAssets.slice(0, 3);
      const primaryAsset = selectedAssets[0] || null;

      const getBeforeSnapshot = (assetItem) => {
        if (!assetItem) return { category: null, status: null, tags: [] };
        let tags = [];
        try {
          tags = db.prepare(`
            SELECT t.dimension, t.dir, t.label, at.confidence
            FROM asset_tags at JOIN tag_dict t ON t.id = at.tag_id
            WHERE at.asset_fid = ?
          `).all(assetItem.fid);
        } catch (_) {}
        return {
          category: assetItem.category || null,
          status: assetItem.status || null,
          tags,
        };
      };

      const compiled = compileNodePrompt(db, {
        mountPointId: draftNode?.mount_point_id || b.mountPointId || null,
        nodeId: draftNode?.id || b.nodeId || null,
        nodeType,
        category: b.category || primaryAsset?.category || 'interior',
        promptId: draftNode?.prompt_id || b.promptId || b.prompt_id || null,
        promptTemplate: draftNode?.prompt_override || b.promptTemplate || b.prompt_override || null,
        snippetIds: Array.isArray(draftNode?.snippet_ids)
          ? draftNode.snippet_ids
          : Array.isArray(b.snippetIds)
            ? b.snippetIds
            : (Array.isArray(b.snippet_ids) ? b.snippet_ids : null),
        modelId: draftNode?.model_id || b.modelId || b.model_id || null,
        draftNode,
        draftSnippets,
        draftDialect,
        vars: {
          ...(b.vars || {}),
          box1Tag: b.box1Tag || '240 360 760 880',
          product_name: b.productName || '意式真皮沙发',
          facing_desc: b.facingDesc || '正面朝向观察者',
          target_style: b.targetStyle || '中古风',
          asset: primaryAsset || { fid: 'sandbox_demo', file_name: 'demo.jpg', width: 1080, height: 1440, category: 'interior' },
        },
      });

      const startedAt = Date.now();
      const liveResults = [];

      if (b.executeLive && selectedAssets.length && NODE_REGISTRY[nodeType]) {
        const nodeCfg = {
          ...(compiled.nodeParams || {}),
          ...(draftNode?.params || {}),
          ...(b.params || {}),
          model: compiled.modelId || b.modelId,
          promptId: compiled.promptId,
          promptTemplate: compiled.prompt,
          snippetIds: compiled.snippetIds,
          forceCustomPrompt: true,
        };
        for (const assetItem of selectedAssets) {
          const itemStart = Date.now();
          const beforeSnap = getBeforeSnapshot(assetItem);
          let itemLive = null;
          // ★ 沙盒事务保护点：试跑后无条件回滚任何数据库写入，严禁污染正式库 assets / asset_tags / derivatives
          try { db.exec('SAVEPOINT sandbox_dry_run'); } catch (_) {}
          try {
            const sandboxServices = { ...services, sandbox: true };
            itemLive = await NODE_REGISTRY[nodeType](sandboxServices, nodeCfg, assetItem, { sandbox: true });
          } catch (execErr) {
            itemLive = { success: false, error: execErr.message };
          } finally {
            try { db.exec('ROLLBACK TO SAVEPOINT sandbox_dry_run'); } catch (_) {}
            try { db.exec('RELEASE SAVEPOINT sandbox_dry_run'); } catch (_) {}
          }
          liveResults.push({
            asset: {
              fid: assetItem.fid,
              file_name: assetItem.file_name,
              category: assetItem.category,
              width: assetItem.width,
              height: assetItem.height,
              status: assetItem.status,
            },
            before: beforeSnap,
            live_result: itemLive,
            duration_ms: Date.now() - itemStart,
          });
        }
      }

      const primaryBefore = getBeforeSnapshot(primaryAsset);
      return sendJson(res, 200, {
        success: true,
        data: {
          node_type: nodeType,
          sandbox: true,
          duration_ms: Date.now() - startedAt,
          asset_count: selectedAssets.length,
          assets: selectedAssets.map(a => ({
            fid: a.fid,
            file_name: a.file_name,
            category: a.category,
            width: a.width,
            height: a.height,
            status: a.status,
          })),
          asset: primaryAsset ? {
            fid: primaryAsset.fid,
            file_name: primaryAsset.file_name,
            category: primaryAsset.category,
            width: primaryAsset.width,
            height: primaryAsset.height,
            status: primaryAsset.status,
          } : null,
          before: primaryBefore,
          compiled: {
            prompt: compiled.prompt,
            negativePrompt: compiled.negativePrompt,
            negative_prompt: compiled.negative_prompt,
            modelId: compiled.modelId,
            promptId: compiled.promptId,
            snippetsUsed: compiled.snippetsUsed,
            dialect: compiled.dialect,
          },
          live_result: liveResults[0]?.live_result || null,
          live_results: liveResults,
        },
      });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const mMountExec = pathname.match(/^\/governance\/mount-points\/([^/]+)\/execute$/);
  if (mMountExec && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const mountId = decodeURIComponent(mMountExec[1]);
    try {
      const { getMountModules, compileNodePrompt } = require('./models-contract');
      const mods = getMountModules(db, mountId);
      const stepReports = mods.filter(m => m.enabled !== 0).map((mod, idx) => {
        const comp = compileNodePrompt(db, {
          mountPointId: mountId,
          nodeId: mod.id,
          nodeType: mod.node_type,
          promptId: mod.prompt_id,
          promptTemplate: mod.prompt_override,
          snippetIds: mod.snippet_ids,
          modelId: mod.model_id,
          vars: {
            box1Tag: '240 360 760 880',
            product_name: '测试家具单品',
            facing_desc: '正面朝向观察者',
            target_style: '现代极简',
            asset: { fid: 'test_asset', file_name: 'sample.jpg', width: 1080, height: 1440, category: 'interior' },
          },
        });
        return {
          step: idx + 1,
          id: mod.id,
          name: mod.name,
          node_type: mod.node_type,
          condition_expr: mod.condition_expr || '无条件 (默认串行)',
          model_id: comp.modelId || '(本地算子/无需大模型)',
          prompt_id: comp.promptId || null,
          snippets_used: comp.snippetsUsed,
          dialect: comp.dialect,
          compiled_prompt_preview: comp.prompt ? (comp.prompt.length > 320 ? comp.prompt.slice(0, 320) + '...' : comp.prompt) : '(纯算法节点无提示词)',
          compiled_prompt_length: comp.prompt ? comp.prompt.length : 0,
          params: mod.params,
        };
      });
      return sendJson(res, 200, {
        success: true,
        data: {
          mount_point_id: mountId,
          executed_at: Date.now(),
          modules_count: mods.length,
          active_steps_count: stepReports.length,
          steps: stepReports,
          status: 'success',
          message: `工作流 ${mountId} 真实编译校验通过 (${stepReports.length} 个启用节点已完成词典芯片展开、公共积木拼接与模型方言转译)`
        }
      });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname === '/governance/gen-jobs' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      return sendJson(res, 200, { success: true, data: genGov.listJobBindings(db) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  const mJob = pathname.match(/^\/governance\/gen-jobs\/([^/]+)$/);
  if (mJob && req.method === 'PUT') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const row = genGov.saveJobBinding(db, decodeURIComponent(mJob[1]), b, sessionUser?.username);
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  const mJobReset = pathname.match(/^\/governance\/gen-jobs\/([^/]+)\/reset$/);
  if (mJobReset && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const row = genGov.resetJobBinding(db, decodeURIComponent(mJobReset[1]), sessionUser?.username);
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // ★ 手动工坊各操作的「默认模型 + 可选模型池」覆盖。
  if (pathname === '/governance/manual-defaults' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      return sendJson(res, 200, { success: true, data: genGov.getManualOverrides(db) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  if (pathname === '/governance/manual-defaults' && req.method === 'PUT') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const data = genGov.saveManualOverride(db, b || {}, sessionUser?.username);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // ================= 文档起草与 Skill 治理 (Drafting & Skills) =================
  if (pathname === '/governance/draft-from-doc' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const row = await genGov.draftSkillFromDocs(db, {
        docUrls: b.doc_urls || b.docUrls || [],
        modelCode: b.model_code || b.modelCode,
        domain: b.domain || 'image',
        promptNotes: b.prompt_notes || b.promptNotes || '',
        modelName: b.model_name || b.modelName || ''
      });
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/governance/skill-drafts' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      return sendJson(res, 200, { success: true, data: genGov.listSkillDrafts(db) });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  const EMPTY_ADAPTER_TEMPLATE = `/**
 * 自定义生成协议适配器
 * 必须导出规范的 6 个核心要素：protocol, method, urlTemplate, paramLocations, buildRequest, parseResponse
 */
module.exports = {
  protocol: 'custom_proto',
  name: '自定义协议',
  method: 'POST',
  urlTemplate: '{{baseUrl}}/v1/generate',
  paramLocations: {
    prompt: 'body.prompt',
    image: 'body.image_url',
    model: 'body.model'
  },
  buildRequest(ctx) {
    const { baseUrl, apiKey, model, prompt, refs, config } = ctx;
    return {
      url: \`\${baseUrl.replace(/\\/+$/, '')}/v1/generate\`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': \`Bearer \${apiKey}\` } : {})
      },
      body: JSON.stringify({
        model: model || config.defaultModel || 'default',
        prompt,
        image_url: refs?.[0]?.dataUrl || undefined
      })
    };
  },
  parseResponse(data, ctx) {
    const url = data?.data?.[0]?.url || data?.output_url || data?.url;
    if (!url) throw new Error('未能从响应中解析出有效的输出 URL');
    return {
      status: 'success',
      files: [{ previewUrl: url }]
    };
  }
};
`;

  if (pathname === '/governance/skill-drafts' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const now = Date.now();
      const id = b.id || `draft_${Date.now()}`;
      const kind = b.kind || b.schema_draft?.kind || 'adapter';
      const modelId = (b.model_id || b.modelId || b.model_code || b.modelCode || id).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const modelCode = b.model_code || b.modelCode || modelId;
      const domain = b.domain || 'image';

      let skillContent = b.skill_content || b.skillContent || '';
      let schemaDraft = b.schema_draft || b.schemaDraft || { kind };
      schemaDraft.kind = kind;

      if (kind === 'adapter') {
        if (!skillContent) {
          if (b.dialogue_model && b.prompt) {
            const systemPrompt = `你是一个生成协议适配器编写专家。请为用户提供一个符合规范的 Node.js 适配器模块。
必须且仅能导出以下 6 个要素：
1. protocol: 协议标识字符串（全小写下划线）
2. method: HTTP 方法（如 'POST' 或 'GET'）
3. urlTemplate: 请求完整路径或模板，例如 '{{baseUrl}}/v1/generate'
4. paramLocations: 参数落点说明对象，例如 { prompt: 'body.prompt', image: 'body.image_url' }
5. buildRequest(ctx): 组装 HTTP 请求对象的函数，返回 { url, method, headers, body }
6. parseResponse(data, ctx): 解析响应提取媒体产物地址，返回 { status: 'success', files: [{ previewUrl }] }

代码仅使用 CommonJS (module.exports = ...)，不得引用第三方外部包。
只输出纯 JavaScript 代码（可用 \`\`\`javascript 包裹）。`;

            const chatRes = await executeChatCompletion(db, config, {
              model: b.dialogue_model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: b.prompt }
              ],
              temperature: 0.2,
              max_tokens: 3000,
              timeoutMs: 90000
            });
            const rawContent = chatRes?.choices?.[0]?.message?.content || '';
            const matchCode = rawContent.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
            skillContent = matchCode ? matchCode[1].trim() : rawContent.trim();
          } else {
            skillContent = EMPTY_ADAPTER_TEMPLATE.replace(/custom_proto/g, modelId);
          }
        }
      }

      db.prepare(`
        INSERT INTO gen_skill_drafts
          (id, model_id, model_code, domain, doc_urls_json, schema_draft_json, polish_draft, skill_content, status, actor, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(
        id,
        modelId,
        modelCode,
        domain,
        JSON.stringify(b.doc_urls || []),
        JSON.stringify(schemaDraft),
        b.polish_draft || '',
        skillContent,
        sessionUser?.username || '',
        now,
        now
      );

      return sendJson(res, 200, {
        success: true,
        data: {
          id,
          model_id: modelId,
          model_code: modelCode,
          domain,
          schema_draft: schemaDraft,
          skill_content: skillContent,
          status: 'pending'
        }
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  const mSkillDraftItem = pathname.match(/^\/governance\/skill-drafts\/([^/]+)$/);
  if (mSkillDraftItem && req.method === 'PUT') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const draftId = decodeURIComponent(mSkillDraftItem[1]);
      const b = await parseBody(req);
      const existing = db.prepare('SELECT * FROM gen_skill_drafts WHERE id=?').get(draftId);
      if (!existing) return sendJson(res, 404, { error: '草稿不存在' });

      const now = Date.now();
      const schemaDraft = b.schema_draft !== undefined ? JSON.stringify(b.schema_draft) : existing.schema_draft_json;
      const skillContent = b.skill_content !== undefined ? String(b.skill_content) : existing.skill_content;
      const polishDraft = b.polish_draft !== undefined ? String(b.polish_draft) : existing.polish_draft;

      db.prepare(`
        UPDATE gen_skill_drafts
        SET schema_draft_json=?, skill_content=?, polish_draft=?, actor=?, updated_at=?
        WHERE id=?
      `).run(schemaDraft, skillContent, polishDraft, sessionUser?.username || '', now, draftId);

      return sendJson(res, 200, { success: true, data: { id: draftId } });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (mSkillDraftItem && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const draftId = decodeURIComponent(mSkillDraftItem[1]);
      db.prepare('DELETE FROM gen_skill_drafts WHERE id=?').run(draftId);
      return sendJson(res, 200, { success: true, data: { deleted: draftId } });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  const mSkillAccept = pathname.match(/^\/governance\/skill-drafts\/([^/]+)\/accept$/);
  if (mSkillAccept && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const draftId = decodeURIComponent(mSkillAccept[1]);
      const r = genGov.acceptSkillDraft(db, draftId, sessionUser?.username);
      return sendJson(res, 200, { success: true, data: r });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const mSkillDeprecate = pathname.match(/^\/governance\/models\/([^/]+)\/deprecate-skill$/);
  if (mSkillDeprecate && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const modelCode = decodeURIComponent(mSkillDeprecate[1]);
      const r = genGov.deprecateModelSkill(db, modelCode, sessionUser?.username);
      return sendJson(res, 200, { success: true, data: r });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // ===== 统一大模型网关适配器 (Media Gen Gateway) =====
  // 供前端工坊直连与 Umbra 工作流（空间漫游/精准替换/智能消除）统一调用
  if (pathname === '/gen/images' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const b = await parseBody(req);
      const { executeAdapter } = require('./gen');
      const { engineStatus } = require('./lab');
      const { resolveModelExecution, prepareGovernedSubmit } = require('./models-contract');
      const rawPrompt = (b.prompt || '').trim();
      let finalPrompt = rawPrompt;

      const modelExec = b.model ? resolveModelExecution(db, b.model) : null;
      const requestedContract = modelExec?.model;

      // 双轨机制：若指定 auto_optimize，调用对应生成模型的 Skill 自动优化
      let optimizedPrompt = null;
      if (b.auto_optimize && rawPrompt && b.model) {
        try {
          const polish = requestedContract?.optimizer?.prompt ? requestedContract.optimizer : genGov.polishFor(db, b.model);
          if (polish && polish.prompt) {
            const opt = genGov.resolveOptimizerModel(db, b.model);
            const optData = await executeChatCompletion(db, config, {
              model: opt.modelCode || opt.modelId,
              messages: [{ role: 'system', content: polish.prompt }, { role: 'user', content: rawPrompt }],
              temperature: opt.temperature,
              max_tokens: 2048,
              timeoutMs: opt.timeoutMs || 90000
            });
            const txt = optData?.choices?.[0]?.message?.content?.trim();
            if (txt) {
              // 同闸门：剥掉提示词里的分辨率/时长/画幅比（它们由参数项承载）
              optimizedPrompt = require('./prompt-validate')
                .validateOptimizedPrompt(txt.replace(/^["'“”]+|["'“”]+$/g, '')).text;
              finalPrompt = optimizedPrompt;
            }
          }
        } catch (_) {}
      }

      // 提取输入中的参数（兼容旧字段与对外共有控件）
      const values = {
        size: b.size || '2K',
        ratio: b.ratio || '1:1',
        ...(b.params || {}),
        ...(b.extras || {}),
        ...(b.layer_decomposition != null ? { layer_decomposition: b.layer_decomposition } : {}),
        ...(b.decompose != null ? { layer_decomposition: b.decompose } : {}),
        ...(b.background != null ? { background: b.background } : {}),
        ...(b.output_format != null ? { output_format: b.output_format } : {}),
        ...(b.format != null ? { output_format: b.format } : {}),
      };

      const snippetIds = Array.isArray(b.snippetIds) ? b.snippetIds : (Array.isArray(b.snippet_ids) ? b.snippet_ids : null);
      const prepared = b.model ? prepareGovernedSubmit({
        db,
        modelId: b.model,
        editablePrompt: rawPrompt,
        optimizedPrompt,
        values,
        images: b.imageUrls || (b.image ? [b.image] : []),
        snippetIds,
      }) : { contract: requestedContract, assembled: null };
      const modelContract = prepared.contract || requestedContract;
      const assembled = prepared.assembled;
      if (assembled?.prompt) finalPrompt = assembled.prompt;

      const engines = engineStatus(db);
      const imgAdapters = engines.gen?.imageAdapters || [];
      const { pickAdapterId, adapterMissingError, isGoogleModel } = require('./adapter-match');
      const mCode = String(modelContract?.vendor_model_id || b.model || '');
      const pickedId = pickAdapterId('image', mCode, imgAdapters);
      let adapterRow = null;
      if (b.adapterId) {
        adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(b.adapterId);
      }
      if (pickedId && (!adapterRow || (isGoogleModel(mCode) && adapterRow.id !== pickedId))) {
        adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(pickedId);
      }
      if (!adapterRow && pickedId) {
        adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(pickedId);
      }
      if (!adapterRow) return sendJson(res, 503, { error: adapterMissingError('image', mCode) });

      const result = await executeAdapter(services, adapterRow, {
        kind: 'image',
        contractId: modelContract?.id || '',
        prompt: finalPrompt,
        model: mCode,
        size: assembled?.body?.size || b.size,
        ratio: assembled?.body?.ratio || b.ratio,
        imageUrls: b.imageUrls || (b.image ? [b.image] : []),
        imageLocalPaths: b.imageLocalPaths || [],
        extras: {
          ...(b.extras || b.params || {}),
          ...(assembled?.body || {}),
          ...(b.mask != null ? { mask: b.mask } : {}),
          ...(b.bbox != null ? { bbox: b.bbox } : {}),
        }
      });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/gen/videos' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const b = await parseBody(req);
      const { executeAdapter } = require('./gen');
      const { engineStatus } = require('./lab');
      const { resolveModelExecution, prepareGovernedSubmit } = require('./models-contract');
      const rawPrompt = (b.prompt || '').trim();
      let finalPrompt = rawPrompt;

      const modelExec = b.model ? resolveModelExecution(db, b.model) : null;
      const requestedContract = modelExec?.model;

      let optimizedPrompt = null;
      if (b.auto_optimize && rawPrompt && b.model) {
        try {
          const polish = requestedContract?.optimizer?.prompt ? requestedContract.optimizer : genGov.polishFor(db, b.model);
          if (polish && polish.prompt) {
            const opt = genGov.resolveOptimizerModel(db, b.model);
            const optData = await executeChatCompletion(db, config, {
              model: opt.modelCode || opt.modelId,
              messages: [{ role: 'system', content: polish.prompt }, { role: 'user', content: rawPrompt }],
              temperature: opt.temperature,
              max_tokens: 2048,
              timeoutMs: opt.timeoutMs || 90000
            });
            const txt = optData?.choices?.[0]?.message?.content?.trim();
            if (txt) {
              // 同闸门：剥掉提示词里的分辨率/时长/画幅比（它们由参数项承载）
              optimizedPrompt = require('./prompt-validate')
                .validateOptimizedPrompt(txt.replace(/^["'“”]+|["'“”]+$/g, '')).text;
              finalPrompt = optimizedPrompt;
            }
          }
        } catch (_) {}
      }

      const values = {
        ratio: b.ratio || b.aspect_ratio || '16:9',
        aspect_ratio: b.aspect_ratio || b.ratio || '16:9',
        duration: b.duration || b.seconds || b.durationSec || 5,
        seconds: b.seconds || b.duration || b.durationSec || 5,
        size: b.size || '720P',
        ...(b.params || {}),
        ...(b.extras || {}),
      };

      const snippetIds = Array.isArray(b.snippetIds) ? b.snippetIds : (Array.isArray(b.snippet_ids) ? b.snippet_ids : null);
      const prepared = b.model ? prepareGovernedSubmit({
        db,
        modelId: b.model,
        editablePrompt: rawPrompt,
        optimizedPrompt,
        values,
        images: b.imageUrls || (b.image ? [b.image] : []),
        snippetIds,
      }) : { contract: requestedContract, assembled: null };
      const modelContract = prepared.contract || requestedContract;
      const assembled = prepared.assembled;
      if (assembled?.prompt) finalPrompt = assembled.prompt;

      const engines = engineStatus(db);
      const vidAdapters = engines.gen?.videoAdapters || [];
      const { pickAdapterId, adapterMissingError, isGoogleModel } = require('./adapter-match');
      const mCode = String(modelContract?.vendor_model_id || b.model || '');
      const pickedId = pickAdapterId('video', mCode, vidAdapters);
      let adapterRow = null;
      if (b.adapterId) {
        adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(b.adapterId);
      }
      if (pickedId && (!adapterRow || (isGoogleModel(mCode) && adapterRow.id !== pickedId))) {
        adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(pickedId);
      }
      if (!adapterRow && pickedId) {
        adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(pickedId);
      }
      if (!adapterRow) return sendJson(res, 503, { error: adapterMissingError('video', mCode) });

      const portraitIds = Array.isArray(b.portraitAssetIds)
        ? b.portraitAssetIds
        : (b.extras && Array.isArray(b.extras.portraitAssetIds) ? b.extras.portraitAssetIds : []);
      const portraitAssets = portraitIds.length ? portraitLib.loadActivePortraits(db, portraitIds) : [];
      if (portraitAssets.length) assertSeedanceOrEmpty(b.model, portraitAssets);

      const result = await executeAdapter(services, adapterRow, {
        kind: 'video',
        contractId: modelContract?.id || '',
        prompt: finalPrompt,
        model: mCode,
        size: assembled?.body?.size || b.size,
        ratio: assembled?.body?.ratio || b.ratio,
        durationSec: assembled?.body?.duration || assembled?.body?.seconds || b.durationSec || b.seconds || b.duration,
        imageUrls: b.imageUrls || (b.image ? [b.image] : []),
        firstFrame: b.firstFrame || b.first_frame,
        lastFrame: b.lastFrame || b.last_frame,
        genMode: b.genMode || b.mode,
        extras: {
          ...(b.extras || b.params || {}),
          ...(assembled?.body || {}),
          ...(portraitAssets.length ? { portrait_assets: portraitAssets } : {}),
        },
        allowPendingTimeout: true,
        timeoutMs: Number(b.timeoutMs) || 90000,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      const userFixable = [
        'seedance_required', 'portrait_missing', 'portrait_not_active',
        'agnes_keyframe_missing', 'agnes_bad_duration', 'agnes_bad_ratio',
        'public_base_missing', 'public_base_private',
        'frame_blob', 'frame_bad_data_url', 'frame_unresolved',
      ].includes(e.code);
      const status = userFixable ? 400 : 500;
      return sendJson(res, status, { error: e.message, code: e.code || 'error' });
    }
  }

  if (pathname === '/gen/audio' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const b = await parseBody(req, 12 * 1024 * 1024);
      if (b.__bodyTooLarge) return sendJson(res, 413, { error: '参考音频过大' });
      const { executeAdapter } = require('./gen');
      const { engineStatus } = require('./lab');
      const { resolveModelExecution, prepareGovernedSubmit } = require('./models-contract');
      const rawPrompt = (b.prompt || '').trim();
      const modelExec = b.model ? resolveModelExecution(db, b.model) : null;
      const prepared = b.model ? prepareGovernedSubmit({
        db,
        modelId: b.model,
        editablePrompt: rawPrompt,
        values: {
          ...(b.params || {}),
          ...(b.extras || {}),
          duration: b.duration || b.durationSec,
          mode: b.genMode || b.mode,
        },
        images: [],
        snippetIds: Array.isArray(b.snippetIds) ? b.snippetIds : null,
      }) : { contract: modelExec?.model || null, assembled: null };
      const modelContract = prepared.contract || modelExec?.model;
      const assembled = prepared.assembled;
      const engines = engineStatus(db);
      const musicAdapters = engines.musicAdapters || [];
      const { pickAdapterId, adapterMissingError } = require('./adapter-match');
      const mCode = String(modelContract?.vendor_model_id || b.model || '');
      const pickedId = pickAdapterId('music', mCode, musicAdapters);
      const adapterRow = pickedId ? db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(pickedId) : null;
      if (!adapterRow) return sendJson(res, 503, { error: adapterMissingError('music', mCode) });
      const audioUrls = []
        .concat(Array.isArray(b.audioUrls) ? b.audioUrls : [])
        .concat(Array.isArray(b.audios) ? b.audios : [])
        .filter(Boolean);
      const result = await executeAdapter(services, adapterRow, {
        kind: 'audio',
        contractId: modelContract?.id || '',
        prompt: assembled?.prompt || rawPrompt,
        model: mCode,
        genMode: b.genMode || b.mode,
        durationSec: assembled?.body?.audio_duration || assembled?.body?.duration || b.duration || b.durationSec,
        audioUrls,
        timeoutMs: 600000,
        extras: {
          ...(b.extras || b.params || {}),
          ...(assembled?.body || {}),
          mode: b.genMode || b.mode,
        },
      });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/gen/chat' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const b = await parseBody(req);
      const model = b.model || 'agnes-3.0-flash';
      const { resolveModelExecution, assembleModelPayload } = require('./models-contract');
      const { capsFor } = require('./studio-catalog');
      const { contextBudgetTokens, trimChatMessages } = await import('./chat-context.mjs');
      const exec = resolveModelExecution(db, model);
      let messages = Array.isArray(b.messages) ? b.messages.map(m => ({ ...m })) : [];
      let promptText = String(b.prompt || '');
      if (!promptText && messages.length) {
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        if (lastUser && typeof lastUser.content === 'string') {
          promptText = lastUser.content;
        }
      }
      if (exec?.model) {
        const assembled = assembleModelPayload({
          modelContract: exec.model,
          editablePrompt: promptText,
          values: b
        });
        if (assembled?.prompt) {
          if (messages.length) {
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            if (lastUser && typeof lastUser.content === 'string') {
              lastUser.content = assembled.prompt;
            } else if (!lastUser) {
              messages.push({ role: 'user', content: assembled.prompt });
            }
          } else {
            messages = [{ role: 'user', content: assembled.prompt }];
          }
        }
      } else if (!messages.length) {
        messages = [{ role: 'user', content: promptText }];
      }

      const modelCaps = capsFor(model, db);
      const budget = contextBudgetTokens(modelCaps && modelCaps.contextTokens);
      const trimmed = trimChatMessages(messages, budget);
      messages = trimmed.messages.length ? trimmed.messages : messages;

      // 思考档位：只按该模型在官方目录声明的能力组装，未声明则忽略客户端传值
      const reasoningPayload = buildChatReasoningPayload(modelCaps && modelCaps.reasoning, b);

      const data = splitChatThinking(await executeChatCompletion(db, config, {
        model,
        messages,
        images: b.images,
        temperature: b.temperature ?? 0.4,
        max_tokens: b.max_tokens ?? 1024,
        timeoutMs: chatTimeoutMs(modelCaps, b.timeoutMs),
        reasoning: reasoningPayload,
      }));
      return sendJson(res, 200, {
        ...data,
        reasoning: data.reasoning || '',
        reasoning_caps: modelCaps && modelCaps.reasoning ? modelCaps.reasoning : null,
        applied_reasoning: reasoningPayload,
        context: {
          kept: trimmed.kept,
          dropped: trimmed.dropped,
          tokens: trimmed.tokens,
          budget: trimmed.budget,
          modelWindow: modelCaps && modelCaps.contextTokens ? modelCaps.contextTokens : null,
        },
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (pathname === '/skills/create' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const { createSkill } = require('./skill-loader');
      const out = createSkill(b);
      return sendJson(res, 200, { success: true, data: out });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // 管理员专用：标签字典治理
  if (pathname === '/dict' && req.method === 'GET') {
    try {
      const includeDeprecated = urlObj.searchParams.get('include_deprecated') !== '0';
      const data = tagGov.listDict(db, { includeDeprecated });
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  if (pathname === '/dict' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const row = tagGov.upsertTag(db, b, sessionUser?.username);
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }
  if (pathname === '/dict/deprecate' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const row = tagGov.setDeprecated(db, { ...b, deprecated: true }, sessionUser?.username);
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }
  if (pathname === '/dict/restore' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const row = tagGov.setDeprecated(db, { ...b, deprecated: false }, sessionUser?.username);
      return sendJson(res, 200, { success: true, data: row });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }
  if (pathname === '/dict/retag/estimate' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const dims = Array.isArray(b.dimensions) ? b.dimensions : [b.dimension].filter(Boolean);
      const est = tagGov.estimateRetag(db, dims);
      return sendJson(res, 200, { success: true, data: { total: est.total, byDimension: est.byDimension, sampleFids: est.sampleFids } });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }
  if (pathname === '/dict/retag' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    try {
      const b = await parseBody(req);
      const dims = Array.isArray(b.dimensions) ? b.dimensions : [b.dimension].filter(Boolean);
      const schedule = b.schedule === 'night' ? 'night' : 'now';
      const all = !!(b.all || b.forceAll || b.full_library);
      const est = tagGov.estimateRetag(db, dims, { all });
      if (schedule === 'now' && est.total > 400 && !b.force) {
        return sendJson(res, 200, {
          success: true,
          data: { needsConfirm: true, estimated: est.total, byDimension: est.byDimension }
        });
      }
      const r = tagGov.enqueueDimensionRetag(db, {
        dimensions: dims,
        schedule,
        all,
        actor: sessionUser?.username,
        interpreter,
        reason: b.reason || (all ? 'full_library_retag' : 'dictionary_change')
      });
      return sendJson(res, 200, { success: true, data: r });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }
  if (pathname === '/dict/retag/jobs' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    return sendJson(res, 200, { success: true, data: tagGov.listRetagJobs(db) });
  }
  if (pathname === '/dict/audit' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const dimension = urlObj.searchParams.get('dimension') || null;
    return sendJson(res, 200, { success: true, data: tagGov.listDictAudit(db, { dimension }) });
  }
  if (pathname === '/dict/draft-criteria' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const b = await parseBody(req);
    return sendJson(res, 200, { success: true, data: { criteria: tagGov.draftCriteria(b.dimension, b.label) } });
  }
  const mAuditAssets = pathname.match(/^\/dict\/audit\/(\d+)\/assets$/);
  if (mAuditAssets && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    return sendJson(res, 200, { success: true, data: tagGov.assetsAffectedByAudit(db, Number(mAuditAssets[1])) });
  }
  const mTagHist = pathname.match(/^\/assets\/([^\/]+)\/tag-history$/);
  if (mTagHist && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '权限不足' });
    const fid = decodeURIComponent(mTagHist[1]);
    return sendJson(res, 200, { success: true, data: tagGov.listAssetTagHistory(db, fid) });
  }

  // 管理员专用：用户管理（严格限定仅超级管理员 admin 可管理用户与密码，naite 账号永久锁定）
  if (pathname === '/users' && req.method === 'GET') {
    if (sessionUser?.username !== 'admin') {
      return sendJson(res, 403, { error: '只有超级管理员 admin 才能管理用户和密码' });
    }
    return sendJson(res, 200, { success: true, data: auth.listUsers(db) });
  }
  if (pathname === '/users' && req.method === 'POST') {
    if (sessionUser?.username !== 'admin') {
      return sendJson(res, 403, { error: '只有超级管理员 admin 才能管理用户和密码' });
    }
    const b = await parseBody(req);
    try {
      const nu = auth.createUser(db, { username: b.username, password: b.password, role: b.role || 'viewer' }, sessionUser.username);
      return sendJson(res, 200, { success: true, data: nu });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const mUserPwd = pathname.match(/^\/users\/(\d+)\/password$/);
  if (mUserPwd && (req.method === 'POST' || req.method === 'PUT')) {
    if (sessionUser?.username !== 'admin') {
      return sendJson(res, 403, { error: '只有超级管理员 admin 才能管理用户和密码' });
    }
    const userId = Number(mUserPwd[1]);
    const b = await parseBody(req);
    try {
      auth.changePassword(db, userId, b.password, sessionUser.username);
      return sendJson(res, 200, { success: true, message: '密码修改成功' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/users/password' && (req.method === 'POST' || req.method === 'PUT')) {
    if (sessionUser?.username !== 'admin') {
      return sendJson(res, 403, { error: '只有超级管理员 admin 才能管理用户和密码' });
    }
    const b = await parseBody(req);
    let userId = b.id ? Number(b.id) : null;
    if (!userId && b.username) {
      const u = db.prepare('SELECT id FROM users WHERE username = ?').get(b.username);
      if (u) userId = u.id;
    }
    if (!userId) return sendJson(res, 400, { error: '请指定目标用户 ID 或用户名' });
    try {
      auth.changePassword(db, userId, b.password, sessionUser.username);
      return sendJson(res, 200, { success: true, message: '密码修改成功' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const mUserId = pathname.match(/^\/users\/(\d+)$/);
  if (mUserId && req.method === 'DELETE') {
    if (sessionUser?.username !== 'admin') {
      return sendJson(res, 403, { error: '只有超级管理员 admin 才能管理用户和密码' });
    }
    const userId = Number(mUserId[1]);
    try {
      auth.deleteUser(db, userId, sessionUser.username);
      return sendJson(res, 200, { success: true, message: '用户已删除' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }
  if (mUserId && req.method === 'PUT') {
    if (sessionUser?.username !== 'admin') {
      return sendJson(res, 403, { error: '只有超级管理员 admin 才能管理用户和密码' });
    }
    const userId = Number(mUserId[1]);
    const b = await parseBody(req);
    try {
      const u = auth.updateUser(db, userId, { role: b.role }, sessionUser.username);
      return sendJson(res, 200, { success: true, data: u });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // POST /upload — 剪辑台（OpenCut fork）统一上传入口。
  // 编辑器侧历史调用为 /api/upload，此前后端未实现，导致「未知的 API 端点: /upload」。
  // 这里复用流式上传（支持视频/图片、大文件），返回顶层 fid 供前端直接使用。
  if (pathname === '/upload' && req.method === 'POST') {
    if (!sessionUser) return sendJson(res, 401, { error: '未登录或会话已过期' });
    try {
      const { handleDirectUpload } = require('./stream-upload');
      const r = await handleDirectUpload(services, req, { source: 'edit' });
      if (!r || !r.fid) return sendJson(res, 400, { error: '入库失败' });
      return sendJson(res, 200, { success: true, ...r });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  return sendJson(res, 404, { error: `未知的 API 端点: ${pathname}` });
}

// 供 DSH 插件注册的封装函数
function register(services) {
  const { ctx } = services;
  const router = ctx.router;
  if (!router || typeof router.all !== 'function') return;

  const P = '/plugins/material/api';
  router.all(`${P}/(.*)`, async (c) => {
    // 转换为原生 req/res 兼容对象
    await new Promise(resolve => {
      handleApi(services, c.req, c.res, P).then(resolve).catch(err => {
        c.status = 500;
        c.body = { error: err.message };
        resolve();
      });
    });
  });
}

module.exports = {
  handleApi,
  register,
  queryAssets,
  getAssetDetail,
  getStats,
  applyHumanTag,
  filterOptions,
  invalidateFilterOptionsCache
};
