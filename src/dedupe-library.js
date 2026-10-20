/**
 * 全库图片去重（多手段）
 * 对比：每个「原图条目」↔ 全部原图 + 全部衍生（origin/restage_9_16/restage_3_4…）
 * 手段：MD5/SHA256、pHash、导出标记 MLX1、母素材血缘（source_asset / restage）
 * 规则：一般留 created_at 更早；独立条 vs 更早母素材的衍生 → 删独立条
 * 默认 dry-run，只出报告不删除。
 */
const fs = require('fs');
const path = require('path');
const { hamming } = require('./qc');

const PHASH_STRICT = 5;
const PHASH_NEAR = 8;

function isImageName(name, kind) {
  const k = String(kind || '');
  if (k === 'video' || k === 'audio' || k === 'music') return false;
  return /\.(jpe?g|png|webp|bmp|tiff?|heic|heif)$/i.test(String(name || '')) || k === 'image';
}

function loadExportTagFromFile(db, services, row) {
  // 尽量读文件里的 MLX1；读不到则返回 null
  try {
    const { extractExportTag } = require('./export-tag');
    const abs = resolveAnyFile(services, row);
    if (!abs || !fs.existsSync(abs)) return null;
    const fd = fs.openSync(abs, 'r');
    try {
      const head = Buffer.alloc(Math.min(65536, fs.statSync(abs).size));
      fs.readSync(fd, head, 0, head.length, 0);
      return extractExportTag(head);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return null;
  }
}

function resolveAnyFile(services, row) {
  try {
    const { config } = services || {};
    const dataDir = (config && config.dataDir) || '';
    const ref = String(row.storage_ref || row.relPath || '');
    if (!ref) return null;
    if (path.isAbsolute(ref)) return ref;
    if (dataDir) {
      const p = path.join(dataDir, ref);
      if (fs.existsSync(p)) return p;
    }
    // 原图缓存约定
    if (row.fid && dataDir) {
      const ext = path.extname(row.file_name || '.jpg') || '.jpg';
      const orig = path.join(dataDir, 'cache', 'originals', `${row.fid}${ext}`);
      if (fs.existsSync(orig)) return orig;
    }
    return ref;
  } catch (_) {
    return null
  }
}

function lineageKeys(asset, derivs) {
  const keys = new Set();
  if (asset.source_asset_id) keys.add(`src:${asset.source_asset_id}`);
  for (const d of derivs) {
    const kind = String(d.kind || '');
    if (kind.startsWith('restage_')) keys.add(`restage:${asset.fid}:${kind}`);
    if (kind === 'origin') keys.add(`origin:${asset.fid}`);
  }
  return keys;
}

/**
 * @param {{db:any, config?:object, logger?:object}} services
 * @returns {{scanned, pairs, matched, dryRun, options}}
 */
function scanLibraryDuplicates(services, options = {}) {
  const db = services && services.db
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('scanLibraryDuplicates: services.db 无效')
  }
  const {
    dryRun = true,
    phashStrict = PHASH_STRICT,
    phashNear = PHASH_NEAR,
    readExportTags = true,
  } = options;

  const assets = db.prepare(`
    SELECT fid, file_name, kind, size, width, height, sha256, md5, phash,
           created_at, source_asset_id, main_derivative_id, status
    FROM assets
    WHERE (status IS NULL OR status != 'deleted')
    ORDER BY COALESCE(created_at, 0) ASC, fid ASC
  `).all();

  const derivsAll = db.prepare(`
    SELECT id, asset_fid, kind, width, height, sha256, md5, phash, file_name, storage_type, storage_ref, mime
    FROM derivatives
  `).all();

  const derivsByFid = new Map();
  for (const d of derivsAll) {
    if (!derivsByFid.has(d.asset_fid)) derivsByFid.set(d.asset_fid, []);
    derivsByFid.get(d.asset_fid).push(d);
  }

  // 仅图片资产参与；对比范围按用户口径：
  //  1) 原图 ↔ 原图
  //  2) 原图 ↔ 别的资产的衍生图（restage/origin 衍生）
  // drop 只针对「被重复的原图条目」，不删母素材本体。
  const nodes = [];
  for (const a of assets) {
    const ds = derivsByFid.get(a.fid) || [];
    const imageLike = isImageName(a.file_name, a.kind) || ds.some((d) => isImageName(d.file_name, d.kind));
    if (!imageLike) continue;

    // 本条目自身的「原图」指纹
    const ownHashes = new Set();
    const ownPhashes = [];
    if (a.sha256) ownHashes.add(String(a.sha256).toLowerCase());
    if (a.md5) ownHashes.add(String(a.md5).toLowerCase());
    if (a.phash) ownPhashes.push({ phash: a.phash, kind: 'self', derivId: null });

    // 该资产下的衍生图指纹（只作对照，不单独成为 drop 对象）
    const derivHashes = new Set();
    const derivPhashes = [];
    for (const d of ds) {
      const kind = String(d.kind || '');
      const isRestage = kind.startsWith('restage_');
      const isOriginDeriv = kind === 'origin';
      if (!isRestage && !isOriginDeriv && !isImageName(d.file_name, d.kind)) continue;
      if (d.sha256) derivHashes.add(String(d.sha256).toLowerCase());
      if (d.md5) derivHashes.add(String(d.md5).toLowerCase());
      if (d.phash) derivPhashes.push({ phash: d.phash, kind, derivId: d.id });
    }

    let exportTag = null;
    if (readExportTags) {
      exportTag = loadExportTagFromFile(db, services, {
        ...a,
        storage_ref: (ds.find((x) => x.kind === 'origin') || {}).storage_ref,
      });
    }

    nodes.push({
      fid: a.fid,
      fileName: a.file_name,
      createdAt: Number(a.created_at) || 0,
      ownHashes,
      ownPhashes,
      derivHashes,
      derivPhashes,
      restageKinds: ds.filter((d) => String(d.kind || '').startsWith('restage_')).map((d) => d.kind),
      hasRestage: ds.some((d) => String(d.kind || '').startsWith('restage_')),
      sourceAssetId: a.source_asset_id || '',
      exportTag,
      lineage: lineageKeys(a, ds),
      raw: a,
    });
  }

  const pairs = [];
  const dropSet = new Set();

  /** 一般去留：更早 / 更像母素材 */
  const preferKeep = (a, b) => {
    // CONFLICT-002：重复组退役，isRepresentative 权重移除
    const score = (x) => (x.hasRestage ? 3 : 0) + (x.exportTag ? -3 : 0);
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa > sb ? a : b;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? a : b;
    return String(a.fid) < String(b.fid) ? a : b;
  };

  const minHamming = (pa, pb) => {
    let best = 64;
    for (const x of pa) {
      for (const y of pb) {
        const d = hamming(x.phash, y.phash);
        if (d < best) best = d;
      }
    }
    return best;
  };

  const hitExactHash = (setA, setB) => {
    for (const h of setA) {
      if (setB.has(h)) return h.length === 32 ? 'md5' : 'sha256';
    }
    return '';
  };

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (dropSet.has(a.fid)) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      if (dropSet.has(b.fid)) continue;

      let reason = '';
      let dist = null;
      let matchKind = ''; // 'orig_orig' | 'orig_deriv'

      // —— 1) 原图 ↔ 原图 ——
      const hashOO = hitExactHash(a.ownHashes, b.ownHashes);
      if (hashOO) {
        reason = hashOO;
        dist = 0;
        matchKind = 'orig_orig';
      } else if (a.ownPhashes.length && b.ownPhashes.length) {
        const d = minHamming(a.ownPhashes, b.ownPhashes);
        if (d <= phashStrict) {
          reason = `orig_phash:${d}`;
          dist = d;
          matchKind = 'orig_orig';
        }
      }

      // —— 2) 原图 ↔ 别人资产的衍生图 ——
      if (!reason) {
        // a 的原图 对 b 的衍生
        const ab = hitExactHash(a.ownHashes, b.derivHashes);
        const ba = hitExactHash(b.ownHashes, a.derivHashes);
        if (ab) {
          reason = `orig_vs_deriv_${ab}`;
          dist = 0;
          matchKind = 'orig_deriv';
        } else if (ba) {
          reason = `orig_vs_deriv_${ba}`;
          dist = 0;
          matchKind = 'orig_deriv';
        } else {
          let best = 64;
          if (a.ownPhashes.length && b.derivPhashes.length) {
            best = Math.min(best, minHamming(a.ownPhashes, b.derivPhashes));
          }
          if (b.ownPhashes.length && a.derivPhashes.length) {
            best = Math.min(best, minHamming(b.ownPhashes, a.derivPhashes));
          }
          if (best <= phashStrict) {
            reason = `orig_vs_deriv_phash:${best}`;
            dist = best;
            matchKind = 'orig_deriv';
          } else if (best <= phashNear) {
            const lineageHit =
              (a.sourceAssetId && a.sourceAssetId === b.fid) ||
              (b.sourceAssetId && b.sourceAssetId === a.fid) ||
              (a.exportTag && a.exportTag.fid === b.fid) ||
              (b.exportTag && b.exportTag.fid === a.fid);
            if (lineageHit) {
              reason = `orig_vs_deriv_near+lineage:${best}`;
              dist = best;
              matchKind = 'orig_deriv';
            }
          }
        }
      }

      // —— 3) 导出标记 / 血缘（仍只服务「原图重复」）——
      if (!reason) {
        if (a.exportTag && a.exportTag.fid === b.fid) {
          reason = 'export_tag';
          dist = 0;
          matchKind = 'orig_deriv';
        } else if (b.exportTag && b.exportTag.fid === a.fid) {
          reason = 'export_tag';
          dist = 0;
          matchKind = 'orig_deriv';
        } else if (a.sourceAssetId && a.sourceAssetId === b.fid) {
          reason = 'lineage:source';
          dist = 0;
          matchKind = 'orig_deriv';
        } else if (b.sourceAssetId && b.sourceAssetId === a.fid) {
          reason = 'lineage:source';
          dist = 0;
          matchKind = 'orig_deriv';
        }
      }

      if (!reason) continue;

      // 去留：只删「被重复的那条原图资产」
      // 原图 vs 衍生：删疑似回传/独立副本，保母素材
      // 原图 vs 原图：留更早（或更像母素材）
      let keep;
      if (matchKind === 'orig_deriv') {
        const aExportish = !!(a.exportTag || (a.sourceAssetId && a.sourceAssetId !== ''));
        const bExportish = !!(b.exportTag || (b.sourceAssetId && b.sourceAssetId !== ''));
        if (aExportish && !bExportish && b.hasRestage) keep = b;
        else if (bExportish && !aExportish && a.hasRestage) keep = a;
        else if (a.hasRestage && !b.hasRestage) keep = a;
        else if (b.hasRestage && !a.hasRestage) keep = b;
        else keep = preferKeep(a, b);
      } else {
        keep = preferKeep(a, b);
      }

      let drop = keep.fid === a.fid ? b : a;
      if (dropSet.has(drop.fid)) continue;

      // CONFLICT-002：重复组退役——原「代表项保护」逻辑（isRepresentative
      // 交换 keep/drop）随之移除，isRepresentative 恒 false 已是死分支。

      dropSet.add(drop.fid);

      pairs.push({
        keepFid: keep.fid,
        keepName: keep.fileName,
        keepCreatedAt: keep.createdAt,
        dropFid: drop.fid,
        dropName: drop.fileName,
        dropCreatedAt: drop.createdAt,
        reason,
        dist,
        matchKind,
        note: matchKind === 'orig_deriv' ? 'orig_vs_derivative' : 'orig_vs_orig',
      });
    }
  }

  return {
    dryRun,
    scanned: nodes.length,
    matched: pairs.length,
    pairs,
    options: { phashStrict, phashNear, readExportTags },
    generatedAt: Date.now(),
  };
}

/** 执行删除（对 dropFid 调 softDelete） */
function applyDedupePairs(services, pairs, { deleteFn } = {}) {
  const results = [];
  for (const p of pairs) {
    try {
      if (typeof deleteFn === 'function') {
        deleteFn(p.dropFid);
      } else {
        const assetsDelete = require('./assets-delete');
        // 显式标 dedupe 来源：回收站按来源分档窗口（去重 7 天），并展示「查重命中」标签
        assetsDelete.softDeleteAsset(services, p.dropFid, {
          deletedBy: 'dedupe-library',
          reason: 'dedupe',
          disposeSource: 'dedupe',
          disposeDetail: p.reason
            ? `查重命中：${p.reason}`
            : `与代表性素材 ${p.keepFid || ''} 指纹或近似度重复，已保留更优的一份`.trim(),
        });
      }
      results.push({ fid: p.dropFid, ok: true });
    } catch (e) {
      results.push({ fid: p.dropFid, ok: false, error: e.message });
    }
  }
  return {
    attempted: pairs.length,
    deleted: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

function formatReportCsv(report) {
  const head = ['keepFid', 'keepName', 'dropFid', 'dropName', 'reason', 'dist', 'note', 'keepCreatedAt', 'dropCreatedAt'];
  const lines = [head.join(',')];
  for (const p of report.pairs || []) {
    lines.push(
      [
        p.keepFid,
        JSON.stringify(p.keepName || ''),
        p.dropFid,
        JSON.stringify(p.dropName || ''),
        p.reason,
        p.dist == null ? '' : p.dist,
        p.note || '',
        p.keepCreatedAt || 0,
        p.dropCreatedAt || 0,
      ].join(',')
    );
  }
  return lines.join('\n');
}

module.exports = {
  PHASH_STRICT,
  PHASH_NEAR,
  scanLibraryDuplicates,
  applyDedupePairs,
  formatReportCsv,
};
