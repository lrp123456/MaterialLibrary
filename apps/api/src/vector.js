/**
 * 向量相似度计算与结构化图搜图 (Vector Search & Hybrid Structured Similarity)
 * 基于 68 维室内设计显式特征向量（12主色 + 16风格 + 18空间 + 22材质双轨），
 * 融合主色强加权(+0.30)、风格加权(+0.20)、材质双轨Jaccard与空间隔离，
 * 彻底解决跨色跳跃、跨空间乱推与同组重复问题。
 */
const { AUTH_VISIBLE_SQL } = require('./governance');
const { HARD_MATERIALS, SOFT_MATERIALS } = require('./tags-seed');

const VECTOR_MODEL = 'local_feature_v2';

const COLORS = ['白', '米/奶油', '原木/木色', '灰', '黑', '红', '粉', '橙', '黄', '绿', '蓝', '紫'];
const STYLES = [
  'modern_minimal', 'french_light_luxury', 'italian_modern', 'cream_style',
  'wabi_sabi', 'log_wood', 'japandi', 'nordic',
  'american_farmhouse', 'american_modern', 'mid_century_global', 'neo_chinese',
  'industrial', 'nanyang_resort', 'tuscan_country', 'eclectic_other'
];
const SPACES = [
  'living_room', 'bedroom', 'dining_room', 'kitchen', 'bathroom', 'study',
  'entrance', 'balcony', 'cloakroom', 'corridor', 'tearoom', 'commercial_space',
  'office', 'kids_room', 'stairs', 'outdoor', 'detail_closeup', 'other'
];
const MATERIALS = [
  'oak', 'walnut', 'teak', 'light_wood', 'marble', 'travertine', 'terrazzo',
  'microcement', 'art_coating', 'lime_plaster', 'paint', 'sintered_stone',
  'tile', 'terracotta', 'brass', 'black_steel', 'linen', 'velvet', 'boucle',
  'leather_real', 'glass_clear', 'rattan'
];

const VECTOR_DIM = COLORS.length + STYLES.length + SPACES.length + MATERIALS.length; // 68

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function jaccard(setA, setB) {
  if (!setA || !setB || (setA.size === 0 && setB.size === 0)) return 0;
  let intersect = 0;
  for (const item of setA) {
    if (setB.has(item)) intersect++;
  }
  const union = setA.size + setB.size - intersect;
  return union > 0 ? intersect / union : 0;
}

function buildStructuredVector({ dominant_color, colors = [], space, style_main, style_sec, materials = [] }) {
  const vec = new Float32Array(VECTOR_DIM);
  let offset = 0;

  // 1. 颜色段 (0..11)
  if (dominant_color) {
    const idx = COLORS.indexOf(dominant_color);
    if (idx >= 0) vec[offset + idx] = 1.0;
  }
  for (const c of colors) {
    const name = c.basic_color || c.name;
    const idx = COLORS.indexOf(name);
    if (idx >= 0 && vec[offset + idx] < 0.5) vec[offset + idx] = 0.4;
  }
  offset += COLORS.length;

  // 2. 风格段 (12..27)
  if (style_main) {
    const idx = STYLES.indexOf(style_main);
    if (idx >= 0) vec[offset + idx] = 1.0;
  }
  if (style_sec) {
    const idx = STYLES.indexOf(style_sec);
    if (idx >= 0 && vec[offset + idx] === 0) vec[offset + idx] = 0.5;
  }
  offset += STYLES.length;

  // 3. 空间段 (28..45)
  if (space) {
    const idx = SPACES.indexOf(space);
    if (idx >= 0) vec[offset + idx] = 1.0;
  }
  offset += SPACES.length;

  // 4. 材质段 (46..67)
  for (const m of materials) {
    const idx = MATERIALS.indexOf(m);
    if (idx >= 0) {
      vec[offset + idx] = HARD_MATERIALS.has(m) ? 0.8 : 0.5;
    }
  }

  // 归一化
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  if (sumSq > 0) {
    const norm = Math.sqrt(sumSq);
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

function extractAssetVector(db, fid, assetHint = null) {
  const asset = assetHint || db.prepare('SELECT fid, file_name, dominant_color, category, phash FROM assets WHERE fid=?').get(fid);
  if (!asset) return null;

  const tags = db.prepare(`
    SELECT t.dimension, t.dir, t.label, at.role FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id WHERE at.asset_fid = ?
  `).all(fid);
  const colors = db.prepare('SELECT hex, role, name, basic_color FROM asset_colors WHERE asset_fid = ?').all(fid);

  const space = tags.find(t => t.dimension === 'space')?.dir || null;
  const styles = tags.filter(t => t.dimension === 'style_atom').map(t => t.dir);
  const materials = tags.filter(t => t.dimension === 'material_kind').map(t => t.dir);

  return buildStructuredVector({
    dominant_color: asset.dominant_color,
    colors,
    space,
    style_main: styles[0],
    style_sec: styles[1],
    materials
  });
}

// 兼容旧接口
function generateSemanticVector(text, dim = 64) {
  const floatArr = new Float32Array(dim);
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h) + text.charCodeAt(i);
    h |= 0;
  }
  for (let i = 0; i < dim; i++) {
    floatArr[i] = Math.sin(h + i * 0.1);
  }
  return floatArr;
}

function storeVector(db, assetFid, floatArray, model = VECTOR_MODEL) {
  const buf = Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);
  db.prepare(`
    INSERT INTO asset_vectors (asset_fid, embedding, dimensions, model, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(asset_fid) DO UPDATE SET
      embedding=excluded.embedding, dimensions=excluded.dimensions, model=excluded.model, created_at=excluded.created_at
  `).run(assetFid, buf, floatArray.length, model, Date.now());
}

function rebuildStructuredVectors(db) {
  const assets = db.prepare("SELECT fid, file_name, dominant_color, category, phash FROM assets WHERE status = 'ready'").all();
  const tx = db.transaction(() => {
    for (const a of assets) {
      const vec = extractAssetVector(db, a.fid, a);
      if (vec) storeVector(db, a.fid, vec, VECTOR_MODEL);
    }
  });
  tx();
  return assets.length;
}

function searchSimilar(services, targetFid, { limit = 8, filter = {} } = {}) {
  const { db } = services;

  // 1. 获取目标资产基本信息
  // CONFLICT-002：重复组退役，组折叠逻辑随之移除；phash/文件名排重保留
  const targetAsset = db.prepare('SELECT fid, file_name, phash, ready_flags, status, dominant_color, category FROM assets WHERE fid = ?').get(targetFid);
  if (!targetAsset) return [];

  const targetPhash = targetAsset.phash;
  const targetName = targetAsset.file_name;

  // 2. 获取目标标签
  const targetTags = db.prepare(`
    SELECT t.dimension, t.dir, t.label, at.role FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE at.asset_fid = ?
  `).all(targetFid);

  const targetCategory = targetAsset.category || 'interior';
  const targetSpace = targetTags.find(t => t.dimension === 'space')?.dir;
  const targetStyles = targetTags.filter(t => t.dimension === 'style_atom').map(t => t.dir);
  const targetStyle = targetStyles[0] || null;
  const targetStyleSec = targetStyles[1] || null;
  const targetItem = targetTags.find(t => t.dimension === 'furniture_item')?.dir;
  const targetFurnCat = targetTags.find(t => t.dimension === 'furniture_category')?.dir;

  const targetMaterials = targetTags.filter(t => t.dimension === 'material_kind').map(t => t.dir);
  const targetHardMats = new Set(targetMaterials.filter(m => HARD_MATERIALS.has(m)));
  const targetSoftMats = new Set(targetMaterials.filter(m => !HARD_MATERIALS.has(m)));

  // 3. 获取目标向量（若缺失或非最新模型，即时生成落库）
  let targetRow = db.prepare('SELECT embedding, dimensions, model FROM asset_vectors WHERE asset_fid = ?').get(targetFid);
  let targetVec = null;
  if (targetRow && targetRow.model === VECTOR_MODEL && targetRow.dimensions === VECTOR_DIM) {
    targetVec = new Float32Array(
      targetRow.embedding.buffer,
      targetRow.embedding.byteOffset,
      targetRow.dimensions
    );
  } else {
    targetVec = extractAssetVector(db, targetFid, targetAsset);
    if (targetVec) {
      storeVector(db, targetFid, targetVec, VECTOR_MODEL);
    }
  }

  // 4. 读取候选向量库
  const candidates = db.prepare(`
    SELECT a.fid, a.file_name, a.phash, a.width, a.height, a.orientation, a.origin_orientation,
           a.thumb_url, a.main_derivative_id, a.status, a.ready_flags,
           a.dominant_color, COALESCE(a.category, 'interior') AS category,
           av.embedding, av.dimensions, av.model
    FROM assets a
    LEFT JOIN asset_vectors av ON av.asset_fid = a.fid AND av.model = ?
    WHERE a.status = 'ready'
      AND ${AUTH_VISIBLE_SQL}
      AND a.fid != ?
  `).all(VECTOR_MODEL, targetFid);

  // 5. 批取候选者标签
  const candFids = candidates.map(c => c.fid);
  const tagMap = new Map();
  if (candFids.length > 0) {
    const candTags = db.prepare(`
      SELECT at.asset_fid, t.dimension, t.dir, at.role FROM asset_tags at
      JOIN tag_dict t ON t.id = at.tag_id
      WHERE at.asset_fid IN (${candFids.map(() => '?').join(',')})
    `).all(...candFids);

    for (const t of candTags) {
      if (!tagMap.has(t.asset_fid)) {
        tagMap.set(t.asset_fid, {
          space: null,
          style: null,
          style_sec: null,
          furniture_item: null,
          furniture_category: null,
          hardMats: new Set(),
          softMats: new Set()
        });
      }
      const entry = tagMap.get(t.asset_fid);
      if (t.dimension === 'space') entry.space = t.dir;
      if (t.dimension === 'style_atom') {
        if (!entry.style) entry.style = t.dir;
        else if (!entry.style_sec) entry.style_sec = t.dir;
      }
      if (t.dimension === 'furniture_item') entry.furniture_item = t.dir;
      if (t.dimension === 'furniture_category') entry.furniture_category = t.dir;
      if (t.dimension === 'material_kind') {
        if (HARD_MATERIALS.has(t.dir)) entry.hardMats.add(t.dir);
        else entry.softMats.add(t.dir);
      }
    }
  }

  // 6. 综合算分
  const seenHashes = new Set();
  const seenNames = new Set();

  if (targetPhash) seenHashes.add(targetPhash);
  if (targetName) seenNames.add(targetName);

  const scored = [];
  for (const cand of candidates) {
    if (targetPhash && cand.phash === targetPhash) continue;
    if (targetName && cand.file_name === targetName) continue;

    let cos = 0;
    if (targetVec) {
      let candVec = null;
      if (cand.embedding && cand.dimensions === VECTOR_DIM && cand.model === VECTOR_MODEL) {
        candVec = new Float32Array(
          cand.embedding.buffer,
          cand.embedding.byteOffset,
          cand.dimensions
        );
      } else {
        candVec = extractAssetVector(db, cand.fid, cand);
        if (candVec) storeVector(db, cand.fid, candVec, VECTOR_MODEL);
      }
      if (candVec) cos = cosineSimilarity(targetVec, candVec);
    }

    const cTags = tagMap.get(cand.fid) || {
      space: null, style: null, style_sec: null, furniture_item: null, furniture_category: null,
      hardMats: new Set(), softMats: new Set()
    };

    // 色彩相似度（+0.30 强加权，杜绝跳色）
    let colorScore = 0;
    if (targetAsset.dominant_color && cand.dominant_color) {
      if (targetAsset.dominant_color === cand.dominant_color) {
        colorScore = 1.0;
      } else if (
        (['米/奶油', '原木/木色', '黄', '橙'].includes(targetAsset.dominant_color) && ['米/奶油', '原木/木色', '黄', '橙'].includes(cand.dominant_color)) ||
        (['蓝', '绿', '灰'].includes(targetAsset.dominant_color) && ['蓝', '绿', '灰'].includes(cand.dominant_color))
      ) {
        colorScore = 0.3;
      }
    }

    // 风格加权 (+0.20)
    let styleScore = 0;
    if (targetStyle && cTags.style) {
      if (targetStyle === cTags.style) styleScore = 1.0;
      else if (targetStyleSec && targetStyleSec === cTags.style) styleScore = 0.5;
    }

    // 材质 Jaccard 双轨加权 (硬装 0.15, 软装 0.05)
    const hardMatScore = jaccard(targetHardMats, cTags.hardMats);
    const softMatScore = jaccard(targetSoftMats, cTags.softMats);

    // 空间匹配与隔离
    let spaceMultiplier = 1.0;
    if (targetCategory === 'furniture') {
      const itemScore = (targetItem && cTags.furniture_item && targetItem === cTags.furniture_item) ? 1.0
        : (targetFurnCat && cTags.furniture_category && targetFurnCat === cTags.furniture_category ? 0.6 : 0);
      const sameCatBonus = cand.category === 'furniture' ? 0.1 : 0;
      const base = 0.35 * cos + 0.25 * colorScore + 0.15 * itemScore + 0.15 * styleScore + 0.10 * hardMatScore + sameCatBonus;
      scored.push({
        ...cand,
        score: +base.toFixed(4),
        cosine: +cos.toFixed(4)
      });
      continue;
    } else {
      if (targetSpace && cTags.space) {
        if (targetSpace === cTags.space) spaceMultiplier = 1.0;
        else if (cTags.space === 'detail_closeup' || targetSpace === 'detail_closeup') spaceMultiplier = 0.8;
        else spaceMultiplier = 0.2; // 跨空间强行降权，杜绝看浴室推荐厨房
      }
    }

    const baseScore = 0.30 * cos + 0.30 * colorScore + 0.20 * styleScore + 0.15 * hardMatScore + 0.05 * softMatScore;
    const finalScore = baseScore * spaceMultiplier;

    scored.push({
      ...cand,
      score: +finalScore.toFixed(4),
      cosine: +cos.toFixed(4)
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // 7. 排重过滤与结果折叠
  const results = [];
  for (const item of scored) {
    if (item.phash && seenHashes.has(item.phash)) continue;
    if (item.file_name && seenNames.has(item.file_name)) continue;

    results.push(item);
    if (item.phash) seenHashes.add(item.phash);
    if (item.file_name) seenNames.add(item.file_name);

    if (results.length >= limit) break;
  }

  // 兜底补齐
  if (results.length < limit) {
    const fallbackItems = db.prepare(`
      SELECT a.fid, a.file_name, a.phash, a.width, a.height, a.orientation, a.origin_orientation,
             a.thumb_url, a.main_derivative_id, a.status, a.ready_flags, a.dominant_color
      FROM assets a
      WHERE a.status = 'ready'
        AND ${AUTH_VISIBLE_SQL}
        AND a.fid != ?
      ORDER BY a.created_at DESC LIMIT 100
    `).all(targetFid);

    for (const item of fallbackItems) {
      if (results.some(r => r.fid === item.fid)) continue;
      if (targetPhash && item.phash === targetPhash) continue;
      if (targetName && item.file_name === targetName) continue;
      if (item.phash && seenHashes.has(item.phash)) continue;
      if (item.file_name && seenNames.has(item.file_name)) continue;

      results.push(item);
      if (item.phash) seenHashes.add(item.phash);
      if (item.file_name) seenNames.add(item.file_name);

      if (results.length >= limit) break;
    }
  }

  return results;
}

async function embedCaption(services, caption, { provider = 'litellm', model = 'text-embedding-3-small' } = {}) {
  const { db, config, logger } = services;
  const HASH = VECTOR_MODEL;
  const hashVec = () => generateSemanticVector(caption || '室内设计现代空间素材', VECTOR_DIM);

  // 远程 embedding 默认关闭（ML_EMBEDDING=remote 可打开）。当前业务几乎不用向量检索，
  // 继续打 LiteLLM /v1/embeddings 只会空转报 400 并拖慢事件循环。
  const embeddingMode = String(process.env.ML_EMBEDDING || 'local').toLowerCase();
  if (embeddingMode !== 'remote' && provider !== 'remote') {
    return { vec: hashVec(), model: HASH, fallback: true, quiet: true, error: '远程 embedding 已关闭' };
  }

  if (provider === 'local_hash' || provider === 'local') {
    return { vec: hashVec(), model: HASH, fallback: true, quiet: true, error: '显式本地哈希' };
  }

  const litellmProv = db.prepare("SELECT enabled FROM llm_providers WHERE id='litellm'").get();
  const useLite = provider === 'litellm' && litellmProv && litellmProv.enabled === 1;
  if (useLite) {
    try {
      const embedUrl = `${(config.litellmBaseUrl || 'http://127.0.0.1:4000').replace(/\/$/, '')}/v1/embeddings`;
      const res = await fetch(embedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.litellmApiKey ? { Authorization: `Bearer ${config.litellmApiKey}` } : {})
        },
        body: JSON.stringify({ input: caption, model }),
        signal: AbortSignal.timeout(30000)
      });
      if (res.ok) {
        const data = await res.json();
        const vec = data.data?.[0]?.embedding;
        if (Array.isArray(vec) && vec.length > 0) {
          return { vec: new Float32Array(vec), model, fallback: false };
        }
        return { vec: hashVec(), model: HASH, fallback: true, error: 'embeddings 响应无向量' };
      }
      const errText = await res.text().catch(() => '');
      logger?.warn?.(`[vector] embeddings HTTP ${res.status}: ${errText.slice(0, 180)}`);
      return { vec: hashVec(), model: HASH, fallback: true, error: `网关 HTTP ${res.status}` };
    } catch (e) {
      logger?.warn?.(`[vector] embeddings 异常: ${e.message}`);
      return { vec: hashVec(), model: HASH, fallback: true, error: e.message };
    }
  }

  return {
    vec: hashVec(),
    model: HASH,
    fallback: true,
    error: litellmProv?.enabled === 1 ? '未走 embedding 接口' : 'LiteLLM 未启用，网关无 embedding'
  };
}

function getVectorStatus(db, { configuredModel = 'text-embedding-3-small', configuredProvider = 'litellm' } = {}) {
  const ready = db.prepare("SELECT COUNT(*) c FROM assets WHERE status = 'ready'").get().c;
  const rows = db.prepare('SELECT COUNT(*) c FROM asset_vectors').get().c;
  const byModel = db.prepare(`
    SELECT model, dimensions, COUNT(*) AS count
    FROM asset_vectors
    GROUP BY model, dimensions
    ORDER BY count DESC
  `).all();
  const primary = byModel[0] || null;
  const litellmOn = db.prepare("SELECT enabled FROM llm_providers WHERE id='litellm'").get()?.enabled === 1;
  return {
    configuredModel,
    configuredProvider,
    litellmEnabled: !!litellmOn,
    rows,
    readyAssets: ready,
    coverage: ready ? +(rows / ready).toFixed(4) : 0,
    byModel,
    storedModel: primary?.model || null,
    storedDimensions: primary?.dimensions || null,
    isHash: false,
    warning: null,
    formula: '0.30*cos(68维特征) + 0.30*同主色 + 0.20*同风格 + 0.15*硬装Jaccard + 0.05*软装Jaccard (跨空间*0.2)',
    source: '68维结构化特征向量(12色+16风格+18空间+22材质)',
    hint: null
  };
}

module.exports = {
  cosineSimilarity,
  jaccard,
  buildStructuredVector,
  extractAssetVector,
  rebuildStructuredVectors,
  generateSemanticVector,
  storeVector,
  searchSimilar,
  embedCaption,
  getVectorStatus,
  VECTOR_MODEL,
  VECTOR_DIM
};
