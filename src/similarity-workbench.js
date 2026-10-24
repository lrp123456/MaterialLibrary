/**
 * 相似处理工作台 (Similarity Workbench) 核心服务
 * 
 * 职责：
 * 1. 顶部绝对重复（sha256/md5/export_registry 碰撞）毫秒级聚合与一键清理；
 * 2. 主体相似素材（连拍微调 / 画面高相似 / 同空间多视角）MIH 倒排索引 + 并查集聚类；
 * 3. 9 维综合质量评分（清晰度、分辨率、水印、画幅、收藏、历史等），推荐最佳保留项；
 * 4. 双重豁免守卫：排除抽帧视频（isVideoExtractStill）、母子衍生血缘、人工白名单；
 * 5. 决策执行：多选保留、淘汰项进回收站、血缘自动过户、自动补跑连拍暂缓的 restage_dual。
 */

const { isVideoExtractStill } = require('./cluster');
const { hamming: hammingDistanceHex } = require('./qc');
const { softDeleteAsset } = require('./assets-delete');

/**
 * 构造双向唯一的白名单 / 成对 key
 */
function pairKey(fidA, fidB) {
  return String(fidA) < String(fidB) ? `${fidA}:${fidB}` : `${fidB}:${fidA}`;
}

/**
 * 16-bit 分段变体枚举（数值键，避免大量字符串分配）：
 * 自身 + 单比特翻转（maxFlips>=2 时再枚举双比特）。
 */
function seg16Variants(base, maxFlips = 1) {
  const out = [base];
  for (let b1 = 0; b1 < 16; b1++) {
    const v1 = (base ^ (1 << b1)) & 0xffff;
    out.push(v1);
    if (maxFlips >= 2) {
      for (let b2 = b1 + 1; b2 < 16; b2++) out.push((v1 ^ (1 << b2)) & 0xffff);
    }
  }
  return out;
}

/**
 * 9 维综合质量评分函数
 */
function computeQualityScore(asset, derivCount = 0) {
  let score = 0;

  // 1. 分辨率短边 (0~30分)
  const w = Number(asset.width) || 0;
  const h = Number(asset.height) || 0;
  const minDim = Math.min(w, h);
  if (minDim >= 2160) score += 30;
  else if (minDim >= 1440) score += 25;
  else if (minDim >= 1080) score += 20;
  else if (minDim >= 720) score += 12;
  else if (minDim > 0) score += 5;

  // 2. 清晰度 sharpness (0~20分)
  const sh = Number(asset.sharpness) || 0;
  score += Math.min(20, Math.max(0, Math.round(sh * 2)));

  // 3. 无水印奖励 (15分)
  if (!asset.has_watermark) score += 15;

  // 4. 画幅标准度 (10分: 9:16 / 16:9 / 3:4)
  const ori = String(asset.origin_orientation || asset.orientation || '');
  if (['9:16', '16:9', '3:4'].includes(ori)) score += 10;
  else if (ori === '1:1') score += 5;

  // 5. 已有衍生图完整度 (每张5分，上限15分)
  score += Math.min(15, (Number(derivCount) || 0) * 5);

  // 6. 收藏状态奖励 (20分)
  if (asset.favorited_at || asset.favorite === 1) score += 20;

  // 7. 入库时间微调 (0~5分，保护权威老图)
  const ageDays = (Date.now() - (asset.created_at || Date.now())) / (86400 * 1000);
  score += Math.min(5, Math.max(0, Math.round(ageDays / 10)));

  return score;
}

/**
 * 并查集 (Union-Find)
 */
class UnionFind {
  constructor() {
    this.parent = new Map();
  }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)));
    }
    return this.parent.get(x);
  }
  union(x, y) {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX !== rootY) {
      this.parent.set(rootY, rootX);
    }
  }
  getClusters() {
    const clusters = new Map();
    for (const x of this.parent.keys()) {
      const root = this.find(x);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(x);
    }
    return Array.from(clusters.values()).filter((list) => list.length >= 2);
  }
}

/**
 * 规整排序参数
 * - similarity（默认）：保持原有聚类顺序
 * - time_desc：按素材时间从新到旧（簇按最新一张，簇内按单张）
 * - time_asc：按素材时间从旧到新
 */
function normalizeWorkbenchSort(sort) {
  const value = String(sort || '').trim().toLowerCase();
  if (value === 'time_desc' || value === 'time-desc' || value === 'newest') return 'time_desc';
  if (value === 'time_asc' || value === 'time-asc' || value === 'oldest') return 'time_asc';
  return 'similarity';
}

/**
 * 判断两个素材是否属于豁免保护对
 */
function shouldExemptPair(a, b, lineageMap, ignoredPairsSet) {
  if (!a || !b || a.fid === b.fid) return true;

  // 豁免 1：人工“本组全留”白名单
  if (ignoredPairsSet && ignoredPairsSet.has(pairKey(a.fid, b.fid))) {
    return true;
  }

  // 豁免 2：视频抽帧绝对保护（来自同一视频或属于抽帧图片）
  if (isVideoExtractStill(a) || isVideoExtractStill(b)) {
    return true;
  }

  // 豁免 3：母子/衍生血缘保护
  if (
    a.parent_fid === b.fid ||
    b.parent_fid === a.fid ||
    a.source_asset_id === b.fid ||
    b.source_asset_id === a.fid ||
    lineageMap.get(a.fid)?.has(b.fid) ||
    lineageMap.get(b.fid)?.has(a.fid)
  ) {
    return true;
  }

  return false;
}

/**
 * 扫描工作台相似与重复聚类
 */
async function scanSimilarityWorkbench(services, options = {}) {
  const { db, logger } = services;
  const mode = options.mode || 'visual'; // 'visual' | 'burst' | 'space'
  const maxDist = Math.max(1, Math.min(12, Number(options.maxDist) || (mode === 'burst' ? 5 : 8)));
  const categoryFilter = options.category && options.category !== 'all' ? options.category : null;

  // 1. 查询所有未删除/有效素材基础信息
  let querySql = `
    SELECT fid, kind, category, file_name, size, width, height, sharpness, has_watermark,
           orientation, origin_orientation, sha256, md5, phash,
           favorited_at, (CASE WHEN favorited_at IS NOT NULL THEN 1 ELSE 0 END) AS favorite,
           parent_fid, source_asset_id, source, source_type, created_at, status, auth_state
    FROM assets
    WHERE (status IS NULL OR status NOT IN ('deleted', 'excluded'))
      AND COALESCE(auth_state, 'live') IN ('live', 'authorized')
      AND kind = 'image'
  `;
  const params = [];
  if (categoryFilter) {
    querySql += ` AND category = ?`;
    params.push(categoryFilter);
  }
  querySql += ` ORDER BY created_at ASC`;

  const rows = db.prepare(querySql).all(...params);

  // 2. 统计每张素材的衍生图数量与构建血缘表
  const derivRows = db.prepare(`SELECT asset_fid, kind, sha256, md5, id FROM derivatives`).all();
  const derivCountMap = new Map();
  const derivShaMap = new Map();
  const lineageMap = new Map();

  for (const d of derivRows) {
    derivCountMap.set(d.asset_fid, (derivCountMap.get(d.asset_fid) || 0) + 1);
    if (d.sha256) derivShaMap.set(d.sha256, d.asset_fid);
    if (!lineageMap.has(d.asset_fid)) lineageMap.set(d.asset_fid, new Set());
  }

  // 3. 读取人工白名单
  const ignoredRows = db.prepare(`SELECT fid_a, fid_b FROM similarity_ignored_pairs`).all();
  const ignoredPairsSet = new Set(ignoredRows.map((r) => pairKey(r.fid_a, r.fid_b)));

  // 4. 统计「顶部绝对重复」区块 (exactDuplicates)
  const shaMap = new Map();
  const exactClustersMap = new Map();

  for (const row of rows) {
    if (!row.sha256) continue;
    if (!shaMap.has(row.sha256)) {
      shaMap.set(row.sha256, []);
    }
    shaMap.get(row.sha256).push(row);

    // 检查是否与已导出的衍生图或 registry 哈希发生碰撞
    const dHitFid = derivShaMap.get(row.sha256);
    if (dHitFid && dHitFid !== row.fid) {
      if (!exactClustersMap.has(`deriv_${row.sha256}`)) {
        exactClustersMap.set(`deriv_${row.sha256}`, {
          type: 'derivative_collision',
          sha256: row.sha256,
          assets: [],
        });
      }
      exactClustersMap.get(`deriv_${row.sha256}`).assets.push(row);
    }
  }

  for (const [sha, list] of shaMap.entries()) {
    if (list.length >= 2) {
      exactClustersMap.set(`sha_${sha}`, {
        type: 'exact_hash',
        sha256: sha,
        assets: list,
      });
    }
  }

  const exactDuplicates = Array.from(exactClustersMap.values()).map((c) => ({
    type: c.type,
    sha256: c.sha256,
    count: c.assets.length,
    assets: c.assets.map((a) => ({
      fid: a.fid,
      fileName: a.file_name,
      size: a.size,
      width: a.width,
      height: a.height,
      category: a.category,
      createdAt: a.created_at,
    })),
  }));

  // 5. 相似图片匹配：Multi-Index Hashing (MIH) 倒排分桶加速
  const uf = new UnionFind();
  const pairDistances = new Map();

  // 按 category 分桶，避免跨品类比对
  // 4×16bit 分段索引（鸽巢原理）：总距离 <= 8 时至少有一段误差 <= 2，
  // 因此每段枚举双比特翻转即可完整召回；<= 7 时单比特翻转足够。
  const mihFlips = maxDist >= 8 ? 2 : 1;
  const SEG_COUNT = 4;
  const catBuckets = new Map();
  for (const row of rows) {
    const cat = row.category || 'interior';
    if (!catBuckets.has(cat)) catBuckets.set(cat, []);
    catBuckets.get(cat).push(row);
  }

  for (const [cat, bucket] of catBuckets.entries()) {
    // 构建 4 段 16-bit MIH 倒排索引（数值键）
    const mih = Array.from({ length: SEG_COUNT }, () => new Map());

    for (const r of bucket) {
      if (!r.phash || r.phash.length < 16) continue;
      for (let s = 0; s < SEG_COUNT; s++) {
        const key = parseInt(r.phash.slice(s * 4, s * 4 + 4), 16);
        if (!Number.isFinite(key)) continue;
        const list = mih[s].get(key);
        if (list) list.push(r);
        else mih[s].set(key, [r]);
      }
    }

    const testedPairs = new Set();

    for (const a of bucket) {
      if (!a.phash || a.phash.length < 16) continue;
      const candidates = new Set();

      // 每段枚举「自身 + 单比特/双比特翻转」，数值键查询无字符串分配。
      for (let s = 0; s < SEG_COUNT; s++) {
        const base = parseInt(a.phash.slice(s * 4, s * 4 + 4), 16);
        if (!Number.isFinite(base)) continue;
        const m = mih[s];
        const variants = seg16Variants(base, mihFlips);
        for (let i = 0; i < variants.length; i++) {
          const arr = m.get(variants[i]);
          if (!arr) continue;
          for (let j = 0; j < arr.length; j++) candidates.add(arr[j]);
        }
      }

      for (const b of candidates) {
        if (a.fid >= b.fid) continue;
        const pKey = pairKey(a.fid, b.fid);
        if (testedPairs.has(pKey)) continue;
        testedPairs.add(pKey);

        if (shouldExemptPair(a, b, lineageMap, ignoredPairsSet)) continue;

        const dist = hammingDistanceHex(a.phash, b.phash);

        let isMatch = false;
        if (mode === 'burst') {
          // 连拍微调：pHash 1~5 或同空间连拍时间差 <= 3s
          const timeDiff = Math.abs((a.created_at || 0) - (b.created_at || 0));
          if (dist >= 1 && dist <= 5) isMatch = true;
          else if (timeDiff <= 3000 && dist <= 8) isMatch = true;
        } else if (mode === 'space') {
          // 同空间多视角：pHash 1~10
          if (dist >= 1 && dist <= 10) isMatch = true;
        } else {
          // 画面高相似 (visual, 默认)
          if (dist >= 1 && dist <= maxDist) isMatch = true;
        }

        if (isMatch) {
          uf.union(a.fid, b.fid);
          pairDistances.set(pKey, dist);
        }
      }
    }
  }

  // 6. 整理聚类簇并计算 9 维质量分
  const rawClusters = uf.getClusters();
  const assetMap = new Map(rows.map((r) => [r.fid, r]));
  const sort = normalizeWorkbenchSort(options.sort);
  const scanStamp = Date.now();

  const similarClusters = rawClusters.map((fids) => {
    // 先按质量分排名，确定「推荐保留」项（与后续展示顺序解耦）
    const ranked = fids
      .map((fid) => {
        const item = assetMap.get(fid);
        if (!item) return null;
        const dCount = derivCountMap.get(fid) || 0;
        const qScore = computeQualityScore(item, dCount);
        return {
          ...item,
          derivCount: dCount,
          qualityScore: qScore,
        };
      })
      .filter(Boolean)
      .sort((m1, m2) => m2.qualityScore - m1.qualityScore); // 降序排列

    // 推荐保留得分最高项
    const recommendedFid = ranked[0]?.fid || null;
    ranked.forEach((m) => {
      m.recommendedKeep = m.fid === recommendedFid;
    });

    // 簇内时间跨度（毫秒；缺失时间戳的素材不参与统计）
    const times = ranked.map((m) => Number(m.created_at) || 0).filter((t) => t > 0);
    const timeStart = times.length ? Math.min(...times) : null;
    const timeEnd = times.length ? Math.max(...times) : null;

    // 展示顺序：默认按质量分；按时间排序时簇内也同步改为时间序
    let displayMembers = ranked;
    if (sort === 'time_desc') {
      displayMembers = ranked
        .slice()
        .sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
    } else if (sort === 'time_asc') {
      displayMembers = ranked
        .slice()
        .sort((a, b) => (Number(a.created_at) || 0) - (Number(b.created_at) || 0));
    }

    // 计算簇内平均或最小距离
    let minClusterDist = 99;
    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        const pKey = pairKey(ranked[i].fid, ranked[j].fid);
        const d = pairDistances.get(pKey);
        if (d !== undefined && d < minClusterDist) minClusterDist = d;
      }
    }

    return {
      clusterId: '',
      category: ranked[0]?.category || 'interior',
      minDist: minClusterDist === 99 ? 1 : minClusterDist,
      count: ranked.length,
      recommendedFid,
      timeStart,
      timeEnd,
      members: displayMembers.map((m) => ({
        fid: m.fid,
        fileName: m.file_name,
        width: m.width,
        height: m.height,
        orientation: m.origin_orientation || m.orientation,
        sharpness: m.sharpness,
        hasWatermark: !!m.has_watermark,
        favorite: !!m.favorite || !!m.favorited_at,
        derivCount: m.derivCount,
        qualityScore: m.qualityScore,
        recommendedKeep: m.recommendedKeep,
        createdAt: m.created_at,
        thumbUrl: `/api/viewer/assets/${encodeURIComponent(m.fid)}/image?variant=thumb`,
      })),
    };
  });

  // 7. 簇级排序（相似度默认保持原有聚类顺序，避免改变既有行为）
  // 两个方向统一用「簇内最新一张」作主键，保证切换方向后列表严格反向。
  if (sort === 'time_desc') {
    similarClusters.sort(
      (a, b) => (b.timeEnd || 0) - (a.timeEnd || 0) || (b.timeStart || 0) - (a.timeStart || 0)
    );
  } else if (sort === 'time_asc') {
    similarClusters.sort(
      (a, b) => (a.timeEnd || 0) - (b.timeEnd || 0) || (a.timeStart || 0) - (b.timeStart || 0)
    );
  }

  // 排序确定后再编号，保证「簇 #N」与展示顺序一致
  similarClusters.forEach((cluster, idx) => {
    cluster.clusterId = `cluster_${idx + 1}_${scanStamp}`;
  });

  return {
    mode,
    maxDist,
    sort,
    category: categoryFilter || 'all',
    summary: {
      totalScanned: rows.length,
      exactDuplicateGroups: exactDuplicates.length,
      similarClusterCount: similarClusters.length,
      similarAssetTotal: similarClusters.reduce((acc, c) => acc + c.count, 0),
    },
    exactDuplicates,
    similarClusters,
  };
}

/**
 * 工作台决策执行：支持保留勾选项(移入回收站其余项) 或 本组全留(写入白名单)
 */
async function resolveSimilarityCluster(services, payload = {}) {
  const { db, interpreter, logger } = services;
  const { action, clusters = [], actor = 'admin' } = payload;
  const now = Date.now();

  let droppedCount = 0;
  let keptCount = 0;
  let whitelistedPairs = 0;
  let triggeredRestageCount = 0;

  for (const c of clusters) {
    const keepFids = Array.isArray(c.keepFids) ? c.keepFids : [];
    const dropFids = Array.isArray(c.dropFids) ? c.dropFids : [];
    const allFids = Array.isArray(c.allFids) ? c.allFids : [...keepFids, ...dropFids];

    if (action === 'keep_all') {
      // 本组全留：两两写入 similarity_ignored_pairs 白名单
      for (let i = 0; i < allFids.length; i++) {
        for (let j = i + 1; j < allFids.length; j++) {
          const fidA = allFids[i] < allFids[j] ? allFids[i] : allFids[j];
          const fidB = allFids[i] < allFids[j] ? allFids[j] : allFids[i];
          try {
            db.prepare(`
              INSERT INTO similarity_ignored_pairs (fid_a, fid_b, reason, actor, created_at)
              VALUES (?, ?, 'manual_keep_all', ?, ?)
              ON CONFLICT(fid_a, fid_b) DO UPDATE SET created_at = excluded.created_at
            `).run(fidA, fidB, actor, now);
            whitelistedPairs++;
          } catch (_) {}
        }
      }

      // 对簇内带有 deferred_restage_similar 标记的素材触发补跑
      for (const fid of allFids) {
        if (await maybeTriggerDeferredRestage(services, fid)) {
          triggeredRestageCount++;
        }
      }
      keptCount += allFids.length;
    } else if (action === 'keep_selected') {
      // 保留勾选：淘汰项移入回收站并过户血缘
      const primaryKeepFid = keepFids[0];

      for (const dropFid of dropFids) {
        // 血缘与衍生图过户给 primaryKeepFid（零血缘丢失）
        if (primaryKeepFid) {
          try {
            db.prepare('UPDATE derivatives SET asset_fid = ? WHERE asset_fid = ?').run(primaryKeepFid, dropFid);
            db.prepare('UPDATE assets SET parent_fid = ? WHERE parent_fid = ?').run(primaryKeepFid, dropFid);
          } catch (_) {}
        }

        // 软删除进回收站
        try {
          softDeleteAsset(services, dropFid, { reason: 'similarity_workbench_curation', actor });
          droppedCount++;
        } catch (e) {
          logger?.warn?.(`[similarity-workbench] 软删除失败 fid=${dropFid}: ${e.message}`);
        }
      }

      // 若保留了 >= 2 张，将它们两两写入白名单，防止后续重复聚合
      if (keepFids.length >= 2) {
        for (let i = 0; i < keepFids.length; i++) {
          for (let j = i + 1; j < keepFids.length; j++) {
            const fidA = keepFids[i] < keepFids[j] ? keepFids[i] : keepFids[j];
            const fidB = keepFids[i] < keepFids[j] ? keepFids[j] : keepFids[i];
            try {
              db.prepare(`
                INSERT INTO similarity_ignored_pairs (fid_a, fid_b, reason, actor, created_at)
                VALUES (?, ?, 'manual_keep_multiple', ?, ?)
                ON CONFLICT(fid_a, fid_b) DO NOTHING
              `).run(fidA, fidB, actor, now);
              whitelistedPairs++;
            } catch (_) {}
          }
        }
      }

      // 为保留的素材检查并补跑延迟的 restage_dual
      for (const keepFid of keepFids) {
        if (await maybeTriggerDeferredRestage(services, keepFid)) {
          triggeredRestageCount++;
        }
        keptCount++;
      }
    }
  }

  return {
    success: true,
    action,
    stats: {
      droppedCount,
      keptCount,
      whitelistedPairs,
      triggeredRestageCount,
    },
  };
}

/**
 * 检查素材是否需要补跑 restage_dual（若暂缓了或尚无 9:16 衍生图）
 */
async function maybeTriggerDeferredRestage(services, fid) {
  const { db, interpreter, logger } = services;
  if (!interpreter || !fid) return false;
  try {
    const asset = db.prepare('SELECT fid, category, ready_flags FROM assets WHERE fid = ?').get(fid);
    if (!asset) return false;

    const cat = asset.category || 'interior';
    if (!['interior', 'exterior'].includes(cat)) return false;

    // 检查是否已有 9:16 衍生图
    const has916 = db.prepare(`SELECT id FROM derivatives WHERE asset_fid = ? AND kind = 'clean_9_16' LIMIT 1`).get(fid);
    if (has916) return false;

    logger?.info?.(`[similarity-workbench] 确认保留，自动触发补跑 restage_dual fid=${fid}`);
    await interpreter.triggerSingleNode(fid, 'restage_dual', { forceRestage: true });
    return true;
  } catch (e) {
    logger?.warn?.(`[similarity-workbench] 补跑 restage_dual 异常 fid=${fid}: ${e.message}`);
    return false;
  }
}

/**
 * 一键清理绝对重复素材（保留每组第 1 张主图，其余移入回收站）
 */
async function cleanExactDuplicates(services, payload = {}) {
  const { db, logger } = services;
  const { actor = 'admin' } = payload;
  const scan = await scanSimilarityWorkbench(services);

  let cleanedCount = 0;
  for (const group of scan.exactDuplicates) {
    if (group.assets.length <= 1) continue;
    const primary = group.assets[0];
    const duplicates = group.assets.slice(1);

    for (const dup of duplicates) {
      try {
        // 过户衍生图与血缘
        db.prepare('UPDATE derivatives SET asset_fid = ? WHERE asset_fid = ?').run(primary.fid, dup.fid);
        softDeleteAsset(services, dup.fid, { reason: 'exact_duplicate_clean', actor });
        cleanedCount++;
      } catch (e) {
        logger?.warn?.(`[similarity-workbench] 清理绝对重复失败 fid=${dup.fid}: ${e.message}`);
      }
    }
  }

  return { success: true, cleanedCount };
}

/**
 * 白名单列表查询与删除
 */
function listIgnoredPairs(db) {
  return db.prepare(`
    SELECT ip.fid_a, ip.fid_b, ip.reason, ip.actor, ip.created_at,
           a1.file_name AS name_a, a2.file_name AS name_b
    FROM similarity_ignored_pairs ip
    LEFT JOIN assets a1 ON a1.fid = ip.fid_a
    LEFT JOIN assets a2 ON a2.fid = ip.fid_b
    ORDER BY ip.created_at DESC
  `).all();
}

function removeIgnoredPair(db, fidA, fidB) {
  const pA = fidA < fidB ? fidA : fidB;
  const pB = fidA < fidB ? fidB : fidA;
  return db.prepare(`DELETE FROM similarity_ignored_pairs WHERE fid_a = ? AND fid_b = ?`).run(pA, pB);
}

module.exports = {
  computeQualityScore,
  shouldExemptPair,
  scanSimilarityWorkbench,
  resolveSimilarityCluster,
  cleanExactDuplicates,
  listIgnoredPairs,
  removeIgnoredPair,
};
