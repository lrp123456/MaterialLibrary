/**
 * 9 维素材质量分（只读评估）
 *
 * 为什么要有这个：
 *   原来的 computeQualityScore（similarity-workbench.js）只有 7 维，其中
 *   「锐度」读的是 assets.sharpness —— 这列在 db.js 里建了，但生产链路从不写，
 *   永远是 NULL，所以那一维实际恒为 0 分；「无水印」也只是个布尔开关。
 *   本模块把这两维改成真实检测值，并新增「饱和度」「构图占比」两维，共 9 维。
 *
 * 9 维与满分（合计 145）：
 *   1. resolution   分辨率短边      30
 *   2. sharpness    锐度（拉普拉斯方差） 20
 *   3. watermark    水印洁净度      15
 *   4. aspect       画幅标准度      10
 *   5. saturation   饱和度分布      15
 *   6. composition  构图主体占比    15
 *   7. derivatives  衍生图完整度    15
 *   8. favorite     收藏状态        20
 *   9. freshness    入库时间        5
 *
 * 只读：本模块只写 asset_quality_score 这张专门的表，
 * 绝不改 assets 的业务字段，也绝不提供淘汰/删除入口。
 */
const fs = require('fs');

/** 分析时统一缩到多少像素以内（够用且快） */
const ANALYSIS_SIZE = 256;

const DIMENSIONS = [
  { key: 'resolution', label: '分辨率', max: 30 },
  { key: 'sharpness', label: '锐度', max: 20 },
  { key: 'watermark', label: '水印洁净度', max: 15 },
  { key: 'aspect', label: '画幅标准度', max: 10 },
  { key: 'saturation', label: '饱和度分布', max: 15 },
  { key: 'composition', label: '构图主体占比', max: 15 },
  { key: 'derivatives', label: '衍生图完整度', max: 15 },
  { key: 'favorite', label: '收藏状态', max: 20 },
  { key: 'freshness', label: '入库时间', max: 5 },
];

const TOTAL_MAX = DIMENSIONS.reduce((s, d) => s + d.max, 0);

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * 一次 sharp 解码，拿到缩放后的原始 RGB 像素。
 * 后面 4 个像素级维度都从这份数据算，避免重复解码原图。
 */
async function loadPixels(filePath) {
  const sharp = require('sharp');
  const { data, info } = await sharp(filePath, { failOn: 'none' })
    .rotate()
    .resize(ANALYSIS_SIZE, ANALYSIS_SIZE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels || 3 };
}

/** 灰度化（Rec.601 亮度） */
function toGray(px) {
  const { data, width, height, channels } = px;
  const g = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += channels, p++) {
    g[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return g;
}

/**
 * 拉普拉斯方差：邻域 4 邻差分的方差。清晰图边缘密度高 → 方差大。
 */
function laplacianVariance(gray, w, h) {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

/** 平均饱和度：(max-min)/max，0（灰）~1（纯色） */
function meanSaturation(px) {
  const { data, width, height, channels } = px;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    sum += mx === 0 ? 0 : (mx - mn) / mx;
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * 构图主体占比：先找主导色（量化后取众数桶），再统计偏离主导色的像素比例。
 * 偏离比例 ≈ 主体（家具/人物等）在画面中的占比。
 */
function subjectRatio(px) {
  const { data, width, height, channels } = px;
  const buckets = new Map();
  const q = (v) => (v >> 4) & 0x0f; // 每通道 4bit
  for (let i = 0; i < data.length; i += channels) {
    const key = (q(data[i]) << 8) | (q(data[i + 1]) << 4) | q(data[i + 2]);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  let bestKey = 0;
  let bestCount = -1;
  for (const [k, c] of buckets) {
    if (c > bestCount) { bestCount = c; bestKey = k; }
  }
  const dr = ((bestKey >> 8) & 0x0f) * 16 + 8;
  const dg = ((bestKey >> 4) & 0x0f) * 16 + 8;
  const db = (bestKey & 0x0f) * 16 + 8;

  let subject = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += channels) {
    const d = Math.abs(data[i] - dr) + Math.abs(data[i + 1] - dg) + Math.abs(data[i + 2] - db);
    if (d > 96) subject++;
    n++;
  }
  return n ? subject / n : 0;
}

/**
 * 水印嫌疑度（0~1，越大越像有水印）。
 *
 * 启发式依据：文字/半透明 logo 水印通常落在画面右下角，呈**横向笔画**，
 * 且亮度远高于其上下背景。这里在右下 30% × 18% 区域里找「亮且横向成段」的像素。
 * 这是启发式，不是 OCR —— 只能当参考分，不能当定论。
 */
function watermarkSuspicion(gray, w, h) {
  if (w < 16 || h < 16) return 0;
  const x0 = Math.floor(w * 0.70);
  const y0 = Math.floor(h * 0.82);
  const bw = w - x0;
  const bh = h - y0;
  if (bw < 4 || bh < 3) return 0;

  let strokePixels = 0;
  let brightPixels = 0;
  for (let y = y0; y < h; y++) {
    let run = 0;
    for (let x = x0; x < w; x++) {
      const i = y * w + x;
      const g = gray[i];
      if (g >= 225) {
        brightPixels++;
        run++;
      } else {
        if (run >= 2) strokePixels += run;
        run = 0;
      }
    }
    if (run >= 2) strokePixels += run;
  }
  const bandPixels = bw * bh;
  if (!bandPixels) return 0;
  const brightRatio = brightPixels / bandPixels;
  const strokeRatio = strokePixels / bandPixels;
  // 亮像素占比本身不大（否则就是大片高光，不是水印），
  // 但其中有相当比例组成横向笔画时，才判为有嫌疑
  if (brightRatio > 0.30) return 0;
  if (strokeRatio < 0.01) return 0;
  return clamp01(strokeRatio / 0.06);
}

/**
 * 对一张图做像素级分析。
 * @returns {{sharpness:number, watermark:number, saturation:number, composition:number}} 全部 0~1
 */
async function analyzeImage(filePath) {
  const empty = { sharpness: 0, watermark: 1, saturation: 0, composition: 0 };
  if (!filePath || !fs.existsSync(filePath)) return empty;
  let px;
  try {
    px = await loadPixels(filePath);
  } catch (e) {
    return empty;
  }
  const gray = toGray(px);
  const lv = laplacianVariance(gray, px.width, px.height);
  // 拉普拉斯方差跨图差异大，取 log 归一到 0~1（1 → 0，1000+ → 1）
  const sharpness = clamp01(Math.log10(lv + 1) / 3);
  const saturation = clamp01(meanSaturation(px));
  const composition = clamp01(subjectRatio(px));
  const watermark = watermarkSuspicion(gray, px.width, px.height);
  return { sharpness, watermark, saturation, composition };
}

/** 各维度的打分函数：输入 0~1 的归一值或元数据，输出 {score, detail} */
function scoreResolution(asset) {
  const w = Number(asset.width) || 0;
  const h = Number(asset.height) || 0;
  const minDim = Math.min(w, h);
  let score = 5;
  let detail = `${minDim}px`;
  if (minDim >= 2160) score = 30;
  else if (minDim >= 1440) score = 25;
  else if (minDim >= 1080) score = 20;
  else if (minDim >= 720) score = 12;
  else if (minDim > 0) score = 5;
  return { score, detail };
}

function scoreSharpness(media) {
  const v = clamp01(media.sharpness);
  return { score: Math.round(v * 20), detail: v.toFixed(3) };
}

function scoreWatermark(asset, media) {
  // AI 打标的水印位是硬信号；像素启发式是软信号，取更严重的一边
  const flagged = asset.has_watermark ? 1 : 0;
  const suspicion = Math.max(flagged, clamp01(media.watermark));
  return {
    score: Math.round((1 - suspicion) * 15),
    detail: suspicion >= 1 ? '检出' : suspicion > 0 ? `疑似 ${(suspicion * 100).toFixed(0)}%` : '未检出',
  };
}

function scoreAspect(asset) {
  const ori = String(asset.origin_orientation || asset.orientation || '');
  let score = 0;
  if (['9:16', '16:9', '3:4'].includes(ori)) score = 10;
  else if (ori === '1:1') score = 5;
  return { score, detail: ori || '未知' };
}

function scoreSaturation(media) {
  const s = clamp01(media.saturation);
  let t;
  if (s < 0.12) t = (s / 0.12) * 0.6;                       // 过于灰暗
  else if (s <= 0.45) t = 0.6 + 0.4 * ((s - 0.12) / 0.33);   // 自然区间最佳
  else t = 1 - Math.min(1, (s - 0.45) / 0.35) * 0.5;          // 过饱和扣分
  return { score: Math.round(t * 15), detail: s.toFixed(3) };
}

function scoreComposition(media) {
  const r = clamp01(media.composition);
  let t;
  if (r < 0.15) t = (r / 0.15) * 0.7;                          // 主体太小
  else if (r <= 0.75) t = 1;                                   // 合理区间
  else t = Math.max(0.3, 1 - ((r - 0.75) / 0.25) * 0.7);       // 主体过满
  return { score: Math.round(t * 15), detail: `${(r * 100).toFixed(0)}%` };
}

function scoreDerivatives(derivCount) {
  const n = Number(derivCount) || 0;
  return { score: Math.min(15, n * 5), detail: `${n} 张` };
}

function scoreFavorite(asset) {
  const fav = !!asset.favorited_at || asset.favorite === 1;
  return { score: fav ? 20 : 0, detail: fav ? '已收藏' : '未收藏' };
}

function scoreFreshness(asset) {
  const ageDays = (Date.now() - (asset.created_at || Date.now())) / (86400 * 1000);
  return { score: Math.min(5, Math.max(0, Math.round(ageDays / 10))), detail: `${Math.max(0, Math.round(ageDays))} 天` };
}

/**
 * 汇总 9 维得分。
 * @param {object} asset    assets 表行
 * @param {number} derivCount 衍生图数量
 * @param {object} media    analyzeImage 的结果（无像素分析时传 {}）
 */
function scoreAsset(asset, derivCount = 0, media = {}) {
  const m = {
    sharpness: 0, watermark: 1, saturation: 0, composition: 0, ...media,
  };
  const raw = {
    resolution: scoreResolution(asset),
    sharpness: scoreSharpness(m),
    watermark: scoreWatermark(asset, m),
    aspect: scoreAspect(asset),
    saturation: scoreSaturation(m),
    composition: scoreComposition(m),
    derivatives: scoreDerivatives(derivCount),
    favorite: scoreFavorite(asset),
    freshness: scoreFreshness(asset),
  };
  const dims = DIMENSIONS.map((d) => {
    const r = raw[d.key] || { score: 0, detail: '' };
    return {
      key: d.key,
      label: d.label,
      score: Math.max(0, Math.min(d.max, Math.round(r.score))),
      max: d.max,
      detail: r.detail,
    };
  });
  const total = dims.reduce((s, d) => s + d.score, 0);
  return { total, max: TOTAL_MAX, dims };
}

/** 建表（幂等） */
function ensureQualityTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_quality_score (
      fid TEXT PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0,
      max_score INTEGER NOT NULL DEFAULT 0,
      dims_json TEXT,
      media_json TEXT,
      analyzed_at INTEGER,
      updated_at INTEGER
    )
  `);
}

/** 写入分数 */
function persistQualityScore(db, fid, result, media) {
  ensureQualityTable(db);
  db.prepare(`
    INSERT INTO asset_quality_score (fid, total, max_score, dims_json, media_json, analyzed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fid) DO UPDATE SET
      total=excluded.total, max_score=excluded.max_score,
      dims_json=excluded.dims_json,
      media_json=COALESCE(excluded.media_json, asset_quality_score.media_json),
      analyzed_at=COALESCE(excluded.analyzed_at, asset_quality_score.analyzed_at),
      updated_at=excluded.updated_at
  `).run(
    fid, result.total, result.max, JSON.stringify(result.dims),
    media ? JSON.stringify(media) : null,
    media ? Date.now() : null,
    Date.now(),
  );
}

/** 读取分数 */
function getQualityScore(db, fid) {
  ensureQualityTable(db);
  const row = db.prepare('SELECT * FROM asset_quality_score WHERE fid=?').get(fid);
  if (!row) return null;
  let dims = [];
  let media = null;
  try { dims = JSON.parse(row.dims_json || '[]'); } catch (_) {}
  try { media = row.media_json ? JSON.parse(row.media_json) : null; } catch (_) {}
  return {
    fid: row.fid,
    total: row.total,
    max: row.max_score,
    dims,
    media,
    analyzedAt: row.analyzed_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 取资产的可读原图路径（主衍生优先）。
 * @returns {Promise<string|null>}
 */
async function resolveAssetImagePath(services, asset) {
  if (!asset || !asset.fid) return null;
  const { db } = services;
  let derivatives = [];
  try {
    derivatives = require('./derivatives').getDerivatives(db, asset.fid);
  } catch (_) {}
  if (!derivatives.length) return null;
  let derivative = null;
  if (asset.main_derivative_id) {
    derivative = derivatives.find((d) => d.id === asset.main_derivative_id) || null;
  }
  if (!derivative) derivative = derivatives.find((d) => d.kind === 'origin') || derivatives[0];
  if (!derivative) return null;
  try {
    return await require('./derivatives').resolveDerivativeFile(services, derivative);
  } catch (_) {
    return null;
  }
}

/**
 * 入库后立刻分析：把真实锐度写回 assets.sharpness，并落 9 维分。
 *
 * 注意 assets.sharpness 的量纲沿用 similarity-workbench 的老约定（0~10），
 * 而 analyzeImage 返回的是 0~1 归一值，这里换算成 0~10 再写库。
 */
async function analyzeAndPersist(services, fid, filePath) {
  const { db } = services;
  const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
  if (!asset) return null;
  const media = await analyzeImage(filePath);
  db.prepare('UPDATE assets SET sharpness=? WHERE fid=?').run(media.sharpness * 10, fid);
  const derivCount = db.prepare('SELECT COUNT(*) AS c FROM derivatives WHERE asset_fid=?').get(fid).c;
  const result = scoreAsset(asset, derivCount, media);
  persistQualityScore(db, fid, result, media);
  return result;
}

/**
 * 读取（或按需计算）某素材的 9 维分。
 *
 * 像素指标（锐度/水印/饱和度/构图）跟业务字段无关，缓存一次即可；
 * 收藏、衍生图数量这类会变的维度每次按当前行重算，所以不必重新解码。
 */
async function computeAssetQuality(services, fid, options = {}) {
  const { db } = services;
  const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
  if (!asset) return null;
  ensureQualityTable(db);

  let stored = getQualityScore(db, fid);
  let media = stored && stored.media ? stored.media : null;
  if (!media || options.force) {
    const filePath = options.filePath || (await resolveAssetImagePath(services, asset));
    media = await analyzeImage(filePath);
    stored = null;
    // 锐度是真实测量值，同步写回 assets，让老的评分函数也能用上这一维
    db.prepare('UPDATE assets SET sharpness=? WHERE fid=?').run(media.sharpness * 10, fid);
  }

  const derivCount = db.prepare('SELECT COUNT(*) AS c FROM derivatives WHERE asset_fid=?').get(fid).c;
  const result = scoreAsset(asset, derivCount, media);
  persistQualityScore(db, fid, result, media);
  return { ...result, fid, media };
}

/**
 * 找某素材的相似组（只读提示，不做任何淘汰动作）。
 *
 * 用 assets.phash 做汉明距离比对：同品类内两两比对，
 * 距离 <= maxDist 视为相似；再用并查集把互相接近的连成一组。
 */
function findSimilarGroups(services, fid, options = {}) {
  const { db } = services;
  const maxDist = Math.max(1, Math.min(16, Number(options.maxDist) || 8));
  const limit = Math.max(1, Math.min(50, Number(options.limit) || 12));

  const target = db.prepare(`
    SELECT fid, kind, category, file_name, width, height, phash, sha256, md5,
           parent_fid, source_asset_id, source, source_type, origin_orientation, created_at, status
    FROM assets WHERE fid=?
  `).get(fid);
  if (!target || !target.phash) return { groups: [], count: 0, maxDist };

  const { hamming } = require('./qc');
  const { shouldExemptPair } = require('./similarity-workbench');

  const candidates = db.prepare(`
    SELECT fid, kind, category, file_name, width, height, phash, sha256, md5,
           parent_fid, source_asset_id, source, source_type, origin_orientation, created_at
    FROM assets
    WHERE fid <> ?
      AND phash IS NOT NULL AND phash <> ''
      AND (status IS NULL OR status NOT IN ('deleted','excluded'))
      AND COALESCE(auth_state,'live') IN ('live','authorized')
      AND COALESCE(category, 'interior') = COALESCE(?, 'interior')
  `).all(fid, target.category);

  const ignoredRows = db.prepare('SELECT fid_a, fid_b FROM similarity_ignored_pairs').all();
  const ignoredSet = new Set(ignoredRows.map((r) => (
    String(r.fid_a) < String(r.fid_b) ? `${r.fid_a}:${r.fid_b}` : `${r.fid_b}:${r.fid_a}`
  )));

  // 母子/衍生血缘（同一素材的衍生图不算「相似素材」）
  const lineageMap = new Map();
  try {
    const derivRows = db.prepare('SELECT asset_fid FROM derivatives').all();
    for (const d of derivRows) {
      if (!lineageMap.has(d.asset_fid)) lineageMap.set(d.asset_fid, new Set());
      lineageMap.get(d.asset_fid).add(d.asset_fid);
    }
  } catch (_) {}

  const hits = [];
  for (const c of candidates) {
    if (!c.phash || c.phash.length < 16) continue;
    if (shouldExemptPair(target, c, lineageMap, ignoredSet)) continue;
    const dist = hamming(target.phash, c.phash);
    if (dist > maxDist) continue;
    hits.push({ ...c, distance: dist });
  }

  hits.sort((a, b) => a.distance - b.distance);

  // 并查集：互相接近的相似素材归为一组
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  };
  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  for (const h of hits) {
    parent.set(h.fid, find(h.fid));
    union(fid, h.fid);
  }
  const buckets = new Map();
  for (const h of hits) {
    const root = find(h.fid);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(h);
  }

  const groups = Array.from(buckets.values()).map((members) => ({
    size: members.length + 1,
    members: members.slice(0, limit).map((m) => ({
      fid: m.fid,
      fileName: m.file_name,
      distance: m.distance,
      width: m.width,
      height: m.height,
      orientation: m.origin_orientation,
    })),
  }));
  // 越靠前的组越相似（距离升序），前端直接取前 N 组展示
  groups.sort((a, b) => (a.members[0]?.distance ?? 99) - (b.members[0]?.distance ?? 99));

  return {
    groups: groups.slice(0, 6),
    count: hits.length,
    maxDist,
  };
}

module.exports = {
  DIMENSIONS,
  TOTAL_MAX,
  analyzeImage,
  scoreAsset,
  ensureQualityTable,
  persistQualityScore,
  getQualityScore,
  resolveAssetImagePath,
  analyzeAndPersist,
  computeAssetQuality,
  findSimilarGroups,
};
