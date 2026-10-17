/**
 * 多层次查重：先打标再归组。
 * 同组 = 近重复或同空间连拍，禁止把不同空间因导出前缀粘在一起。
 */
const { cosineSimilarity } = require('./vector');
const { isStandardRatio } = require('./ratio');

const GENERIC_EXPORT_PREFIX = /^(mmexport|fb_img_?|img_?|dsc_?|screenshot|wx_camera_?|pxl_?|mvimg_?|vid_?|photo_?|camera_?|wx_?)/i;

function hamming(a, b) {
  if (!a || !b || a.length !== 16 || b.length !== 16) return 999;
  let d = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x > 0) { d += x & 1; x >>= 1; }
  }
  return d;
}

function parseFilenameMetadata(filename) {
  if (!filename) return null;
  const m = filename.match(/^([a-zA-Z_-]+)(\d{10,14})/);
  if (m) {
    return {
      prefix: m[1],
      timestamp: parseInt(m[2], 10)
    };
  }
  return null;
}

function isGenericExportPrefix(prefix) {
  if (!prefix) return true;
  return GENERIC_EXPORT_PREFIX.test(prefix);
}

function isRatioClose(w1, h1, w2, h2, tolerance = 0.08) {
  if (!w1 || !h1 || !w2 || !h2) return false;
  const r1 = w1 / h1;
  const r2 = w2 / h2;
  return Math.abs(r1 - r2) <= tolerance;
}

function calcColorOverlap(colorsA, colorsB) {
  if (!colorsA || !colorsB || colorsA.length === 0 || colorsB.length === 0) return 0;
  const mapA = new Map(colorsA.map(c => [String(c.hex || '').toLowerCase(), c.weight || 1]));
  const mapB = new Map(colorsB.map(c => [String(c.hex || '').toLowerCase(), c.weight || 1]));
  let dot = 0, normA = 0, normB = 0;
  for (const [hex, wA] of mapA) {
    normA += wA * wA;
    if (mapB.has(hex)) dot += wA * mapB.get(hex);
  }
  for (const [, wB] of mapB) normB += wB * wB;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getAssetTags(db, fid) {
  return db.prepare(`
    SELECT t.dimension, t.dir FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id WHERE at.asset_fid = ?
  `).all(fid);
}

function spaceOf(db, fid, targetTags) {
  if (targetTags) {
    const hit = targetTags.find(t => t.dimension === 'space');
    if (hit) return hit.dir;
  }
  const tRows = getAssetTags(db, fid);
  return tRows.find(t => t.dimension === 'space')?.dir || null;
}

function assignToGroup(db, assetFid, groupId, reason) {
  if (!groupId || !assetFid) return;
  db.prepare('UPDATE assets SET dup_group_id = ? WHERE fid = ?').run(groupId, assetFid);
  const count = db.prepare('SELECT COUNT(*) c FROM assets WHERE dup_group_id = ? OR fid = ?').get(groupId, groupId).c;
  const existing = db.prepare('SELECT match_reason, representative_fid FROM dup_groups WHERE id = ?').get(groupId);
  db.prepare(`
    INSERT INTO dup_groups (id, representative_fid, member_count, match_reason, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      member_count = excluded.member_count,
      match_reason = COALESCE(dup_groups.match_reason, excluded.match_reason),
      updated_at = excluded.updated_at
  `).run(groupId, existing?.representative_fid || assetFid, count, reason || null, Date.now());
}

/** 相册「从视频提取图片」：`mmexport….mp4-6000.jpg`。每张抽帧都是独立素材，禁止按文件名/相似度归组藏起来。 */
function isVideoExtractStill(fileName) {
  const n = String(fileName || '');
  if (!/\.jpe?g$/i.test(n)) return false;
  return /\.(?:mp4|mov|avi)[-_]?\d+/i.test(n) || /\.(?:mp4|mov|avi).+\.jpe?g$/i.test(n);
}

function findGroupForAsset(db, asset, { phashThreshold = 5, targetTags = null, targetColors = null } = {}) {
  if (isVideoExtractStill(asset.file_name)) return null;

  const spaceTag = spaceOf(db, asset.fid, targetTags);
  const styleTag = (targetTags || getAssetTags(db, asset.fid)).find(t => t.dimension === 'style_atom')?.dir || null;
  const colors = targetColors || db.prepare('SELECT hex, weight FROM asset_colors WHERE asset_fid = ?').all(asset.fid);
  const meta = parseFilenameMetadata(asset.file_name);

  const candidates = db.prepare(`
    SELECT fid, file_name, phash, dup_group_id, width, height, has_watermark, origin_orientation
    FROM assets WHERE fid != ? AND (phash IS NOT NULL OR file_name LIKE '%.jpg' OR file_name LIKE '%.jpeg')
  `).all(asset.fid).filter((c) => !isVideoExtractStill(c.file_name));

  const colorCache = new Map();
  const spaceCache = new Map();
  const getCSpace = (fid) => {
    if (!spaceCache.has(fid)) spaceCache.set(fid, spaceOf(db, fid, null));
    return spaceCache.get(fid);
  };
  const getCColors = (fid) => {
    if (!colorCache.has(fid)) {
      colorCache.set(fid, db.prepare('SELECT hex, weight FROM asset_colors WHERE asset_fid = ?').all(fid));
    }
    return colorCache.get(fid);
  };

  if (asset.phash) {
    let bestStrict = null;
    for (const c of candidates) {
      if (!c.phash) continue;
      const dist = hamming(asset.phash, c.phash);
      if (dist <= 5) {
        if (!bestStrict || dist < bestStrict.dist) {
          bestStrict = { groupId: c.dup_group_id || c.fid, reason: `phash:${dist}`, dist, peerFid: c.fid };
        }
      }
    }
    if (bestStrict) return bestStrict;

    let bestNear = null;
    for (const c of candidates) {
      if (!c.phash) continue;
      const dist = hamming(asset.phash, c.phash);
      if (dist < 6 || dist > 8) continue;
      const cSpace = getCSpace(c.fid);
      const sameSpace = spaceTag && cSpace && spaceTag === cSpace;
      const bothUntagged = !spaceTag && !cSpace;
      const colorHit = bothUntagged && calcColorOverlap(colors, getCColors(c.fid)) >= 0.95;
      if (sameSpace || colorHit) {
        if (!bestNear || dist < bestNear.dist) {
          bestNear = {
            groupId: c.dup_group_id || c.fid,
            reason: sameSpace ? `phash:${dist}+space` : `phash:${dist}+color`,
            dist,
            peerFid: c.fid
          };
        }
      }
    }
    if (bestNear) return bestNear;
  }

  if (meta && !isGenericExportPrefix(meta.prefix) && spaceTag) {
    for (const c of candidates) {
      const cMeta = parseFilenameMetadata(c.file_name);
      if (!cMeta || cMeta.prefix !== meta.prefix) continue;
      if (isGenericExportPrefix(cMeta.prefix)) continue;
      const diffMs = Math.abs(cMeta.timestamp - meta.timestamp);
      if (diffMs > 3000) continue;
      const cSpace = getCSpace(c.fid);
      if (cSpace && cSpace === spaceTag) {
        const dist = (asset.phash && c.phash) ? hamming(asset.phash, c.phash) : null;
        return {
          groupId: c.dup_group_id || c.fid,
          reason: 'same_space_burst',
          dist,
          peerFid: c.fid
        };
      }
    }
  }

  if (asset.phash) {
    let bestVariant = null;
    for (const c of candidates) {
      if (!c.phash) continue;
      const dist = hamming(asset.phash, c.phash);
      if (dist > 6) continue;
      if (!bestVariant || dist < bestVariant.dist) {
        bestVariant = {
          groupId: c.dup_group_id || c.fid,
          reason: `variant:phash:${dist}`,
          dist,
          peerFid: c.fid
        };
      }
    }
    if (bestVariant) return bestVariant;
  }

  const targetVecRow = db.prepare('SELECT embedding, dimensions, model FROM asset_vectors WHERE asset_fid = ?').get(asset.fid);
  const hashEmbed = !targetVecRow?.model || /hash|local_semantic/i.test(String(targetVecRow.model));
  if (targetVecRow && targetVecRow.embedding && spaceTag && !hashEmbed) {
    const targetVec = new Float32Array(targetVecRow.embedding.buffer, targetVecRow.embedding.byteOffset, targetVecRow.dimensions);
    const vecCandidates = db.prepare(`
      SELECT av.asset_fid, av.embedding, av.dimensions, av.model, a.dup_group_id, a.phash, a.file_name
      FROM asset_vectors av
      JOIN assets a ON a.fid = av.asset_fid
      WHERE av.asset_fid != ? AND av.dimensions = ?
    `).all(asset.fid, targetVec.length);

    let bestEmb = null;
    for (const vc of vecCandidates) {
      if (isVideoExtractStill(vc.file_name)) continue;
      if (!vc.model || /hash|local_semantic/i.test(String(vc.model))) continue;
      const cVec = new Float32Array(vc.embedding.buffer, vc.embedding.byteOffset, vc.embedding.byteLength / 4);
      const cos = cosineSimilarity(targetVec, cVec);
      if (cos < 0.92) continue;
      const cSpace = getCSpace(vc.asset_fid);
      if (cSpace && cSpace === spaceTag) {
        if (asset.phash && vc.phash && hamming(asset.phash, vc.phash) > 10) continue;
        if (!bestEmb || cos > bestEmb.cos) {
          bestEmb = {
            groupId: vc.dup_group_id || vc.asset_fid,
            reason: `embed:${cos.toFixed(2)}`,
            dist: null,
            cos,
            peerFid: vc.asset_fid
          };
        }
      }
    }
    if (bestEmb) return bestEmb;
  }

  return null;
}

function reElectGroupRepresentative(db, groupId) {
  if (!groupId) return null;

  db.prepare('UPDATE assets SET dup_group_id = ? WHERE fid = ? OR dup_group_id = ?').run(groupId, groupId, groupId);

  const members = db.prepare(`
    SELECT a.fid, a.width, a.height, a.has_watermark, a.quality, a.origin_orientation, a.created_at,
           a.rep_source, a.source, a.thumb_url, a.size,
           (SELECT COUNT(*) FROM derivatives d WHERE d.asset_fid = a.fid AND d.kind LIKE 'restage_%') as restage_count
    FROM assets a
    WHERE a.dup_group_id = ?
  `).all(groupId);

  if (members.length === 0) return null;

  const human = members.find(m => m.rep_source === 'human');
  const qRank = { excellent: 0, good: 1, usable: 2, waste: 9 };

  members.sort((a, b) => {
    // 1. 真实落盘/缩略图有效性优先（杜绝无图/无大小幽灵资产抢占代表）
    const realA = (a.thumb_url || (a.size && a.size > 0)) ? 1 : 0;
    const realB = (b.thumb_url || (b.size && b.size > 0)) ? 1 : 0;
    if (realB !== realA) return realB - realA;

    // 2. 有效创建时间优先（杜绝 created_at 为 null 的资产抢占代表图导致时间轴漏图）
    const hasDateA = (a.created_at && a.created_at > 0) ? 1 : 0;
    const hasDateB = (b.created_at && b.created_at > 0) ? 1 : 0;
    if (hasDateB !== hasDateA) return hasDateB - hasDateA;

    // 3. 用户相册同步素材（source=sync）优先于旧远端转存
    const syncA = (a.source === 'sync') ? 1 : 0;
    const syncB = (b.source === 'sync') ? 1 : 0;
    if (syncB !== syncA) return syncB - syncA;

    // 4. 已有 AI 画幅重构版本的优先
    const rDiff = (b.restage_count || 0) - (a.restage_count || 0);
    if (rDiff !== 0) return rDiff;

    // 5. 无水印且标准画幅优先
    const aStdNoWm = (a.has_watermark === 0 && isStandardRatio(a.width, a.height, a.origin_orientation)) ? 1 : 0;
    const bStdNoWm = (b.has_watermark === 0 && isStandardRatio(b.width, b.height, b.origin_orientation)) ? 1 : 0;
    if (aStdNoWm !== bStdNoWm) return bStdNoWm - aStdNoWm;

    // 6. 无水印优先
    const wmA = a.has_watermark || 0;
    const wmB = b.has_watermark || 0;
    if (wmA !== wmB) return wmA - wmB;

    // 7. 质量等级
    const qA = qRank[a.quality] ?? 3;
    const qB = qRank[b.quality] ?? 3;
    if (qA !== qB) return qA - qB;

    // 8. 真实分辨率
    const resA = (a.width || 0) * (a.height || 0);
    const resB = (b.width || 0) * (b.height || 0);
    if (resB !== resA) return resB - resA;

    // 9. 时间戳越新越优先
    const tA = a.created_at || 0;
    const tB = b.created_at || 0;
    if (tB !== tA) return tB - tA;

    return a.fid.localeCompare(b.fid);
  });

  const repFid = human ? human.fid : members[0].fid;
  const fids = members.map(m => m.fid);

  db.prepare(`
    UPDATE assets SET is_representative = CASE WHEN fid = ? THEN 1 ELSE 0 END
    WHERE fid IN (${fids.map(() => '?').join(',')})
  `).run(repFid, ...fids);

  const nRep = db.prepare(
    'SELECT COUNT(*) c FROM assets WHERE dup_group_id = ? AND is_representative = 1'
  ).get(groupId)?.c || 0;
  if (!nRep && members.length) {
    db.prepare('UPDATE assets SET is_representative = 1 WHERE fid = ?').run(repFid);
  }

  const reasonRow = db.prepare('SELECT match_reason FROM dup_groups WHERE id = ?').get(groupId);
  db.prepare(`
    INSERT INTO dup_groups (id, representative_fid, member_count, match_reason, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      representative_fid = excluded.representative_fid,
      member_count = excluded.member_count,
      match_reason = COALESCE(dup_groups.match_reason, excluded.match_reason),
      updated_at = excluded.updated_at
  `).run(groupId, repFid, members.length, reasonRow?.match_reason || null, Date.now());

  return members.find(m => m.fid === repFid) || members[0];
}

function clusterAllAssets(db) {
  // 2026-10-03 状态收敛：原白名单含 4 个零数据僵尸状态，
  // 实际只有 ready 有数据；保留 discovered/processing 是因为重建聚类
  // 需要覆盖尚未跑完流水线的素材
  const assets = db.prepare(`
    SELECT fid, file_name, phash, dup_group_id, is_representative, width, height, has_watermark, quality, origin_orientation, created_at
    FROM assets WHERE status IN ('ready', 'discovered', 'processing')
  `).all();

  const groupIds = new Set(assets.map(a => a.dup_group_id).filter(Boolean));

  for (const a of assets) {
    if (a.dup_group_id) continue;
    const found = findGroupForAsset(db, a, { phashThreshold: 5 });
    if (found && found.groupId) {
      assignToGroup(db, a.fid, found.groupId, found.reason);
      a.dup_group_id = found.groupId;
      groupIds.add(found.groupId);
    }
  }

  let repCount = 0;
  for (const gid of groupIds) {
    const rep = reElectGroupRepresentative(db, gid);
    if (rep) repCount++;
  }

  return { totalGroups: groupIds.size, repCount };
}

function ungroupAsset(db, fid) {
  const row = db.prepare('SELECT dup_group_id FROM assets WHERE fid = ?').get(fid);
  const groupId = row?.dup_group_id;
  db.prepare("UPDATE assets SET dup_group_id = NULL, is_representative = 0 WHERE fid = ?").run(fid);
  if (!groupId) return { groupId: null, remaining: 0 };

  const remaining = db.prepare('SELECT COUNT(*) c FROM assets WHERE dup_group_id = ?').get(groupId).c;
  if (remaining < 2) {
    db.prepare('UPDATE assets SET dup_group_id = NULL, is_representative = 0 WHERE dup_group_id = ?').run(groupId);
    db.prepare('DELETE FROM dup_groups WHERE id = ?').run(groupId);
    return { groupId, remaining: 0, dissolved: true };
  }
  reElectGroupRepresentative(db, groupId);
  return { groupId, remaining, dissolved: false };
}

function ungroupVideoFrameClusters(db) {
  const rows = db.prepare(`
    SELECT fid, file_name, dup_group_id FROM assets
    WHERE file_name LIKE '%.jpg' OR file_name LIKE '%.jpeg' OR file_name LIKE '%.JPG'
  `).all();
  const extractFids = [];
  const groupIds = new Set();
  for (const r of rows) {
    if (!isVideoExtractStill(r.file_name)) continue;
    extractFids.push(r.fid);
    if (r.dup_group_id) groupIds.add(r.dup_group_id);
  }
  try {
    const vf = db.prepare("SELECT id FROM dup_groups WHERE match_reason = 'video_frames' OR id LIKE 'video_%'").all();
    for (const g of vf) groupIds.add(g.id);
  } catch (_) {}

  const tx = db.transaction(() => {
    for (const fid of extractFids) {
      db.prepare('UPDATE assets SET dup_group_id = NULL, is_representative = 0 WHERE fid = ?').run(fid);
    }
    for (const gid of groupIds) {
      const remaining = db.prepare('SELECT COUNT(*) c FROM assets WHERE dup_group_id = ?').get(gid).c;
      if (remaining < 2) {
        db.prepare('UPDATE assets SET dup_group_id = NULL, is_representative = 0 WHERE dup_group_id = ?').run(gid);
        try { db.prepare('DELETE FROM dup_groups WHERE id = ?').run(gid); } catch (_) {}
      } else {
        reElectGroupRepresentative(db, gid);
      }
    }
    try {
      db.prepare(`
        DELETE FROM dup_groups
        WHERE (match_reason = 'video_frames' OR id LIKE 'video_%')
          AND id NOT IN (SELECT DISTINCT dup_group_id FROM assets WHERE dup_group_id IS NOT NULL)
      `).run();
    } catch (_) {}
  });
  tx();
  return { extracts: extractFids.length, groupsTouched: groupIds.size };
}

function reclusterAllAssets(db) {
  const humanReps = db.prepare("SELECT fid, dup_group_id FROM assets WHERE rep_source = 'human' AND is_representative = 1").all();
  db.prepare('UPDATE assets SET dup_group_id = NULL, is_representative = 0').run();
  try { db.exec('DELETE FROM dup_groups'); } catch { /* ignore */ }
  const stats = clusterAllAssets(db);
  for (const h of humanReps) {
    const cur = db.prepare('SELECT dup_group_id FROM assets WHERE fid = ?').get(h.fid);
    if (cur?.dup_group_id) {
      db.prepare("UPDATE assets SET rep_source = 'human' WHERE fid = ?").run(h.fid);
      db.prepare('UPDATE assets SET is_representative = CASE WHEN fid = ? THEN 1 ELSE 0 END WHERE dup_group_id = ?')
        .run(h.fid, cur.dup_group_id);
      db.prepare('UPDATE dup_groups SET representative_fid = ?, updated_at = ? WHERE id = ?')
        .run(h.fid, Date.now(), cur.dup_group_id);
    }
  }
  return { ...stats, preservedHumanReps: humanReps.length };
}

module.exports = {
  hamming,
  parseFilenameMetadata,
  isGenericExportPrefix,
  isVideoExtractStill,
  isRatioClose,
  isStandardRatio,
  calcColorOverlap,
  findGroupForAsset,
  assignToGroup,
  reElectGroupRepresentative,
  clusterAllAssets,
  ungroupAsset,
  ungroupVideoFrameClusters,
  reclusterAllAssets,
  getAssetTags
};
