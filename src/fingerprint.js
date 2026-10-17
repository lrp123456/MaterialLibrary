/**
 * 入库指纹去重（MD5 / SHA256 / pHash）
 * 精确哈希全库查找。pHash 只比近三天的原图，以及近三天的 3:4 / 9:16 衍生。
 */
const crypto = require('crypto');
const { inspect, hamming } = require('./qc');

/** pHash 汉明距离阈值：≤8 一律视为重复/相似（用户确认的入库网关阈值） */
const PHASH_SAME = 8;
/** 保持兼容：与 SAME 相同 */
const PHASH_NEAR = 8;
/** 入库 pHash 只比这个窗口。SHA256 / MD5 不看窗口，先查全库。 */
const PHASH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** 三天感知哈希要覆盖的精修结果。原图衍生 origin 不在这里。 */
const PHASH_WINDOW_DERIV_KINDS = [
  'restage_3_4',
  'restage_9_16',
  'style_transferred',
  'quick_replace',
  'quick_remove',
  'quick_insert',
  'clarity_enhanced',
  'expand',
  'retouched',
  'manual_edit',
  'ai_remove',
  'clean',
];

function md5Of(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function sha256Of(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 计算内容指纹：md5 + sha256 + phash（图片）
 * @returns {Promise<{md5,sha256,phash,width,height,size,isImage}>}
 */
async function computeFingerprints(buffer, fileName = '') {
  const md5 = md5Of(buffer);
  const sha256 = sha256Of(buffer);
  const size = buffer.length;
  const isImage = /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(String(fileName || '')) || true;
  let phash = '';
  let width = 0;
  let height = 0;
  try {
    const info = await inspect(buffer);
    phash = String(info.phash || '');
    width = Number(info.width) || 0;
    height = Number(info.height) || 0;
  } catch (_) {
    /* 非图或解码失败时仅用字节哈希 */
  }
  return { md5, sha256, phash, width, height, size, isImage };
}

function ensureFingerprintColumns(db) {
  try {
    const aCols = db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name);
    if (!aCols.includes('md5')) db.exec('ALTER TABLE assets ADD COLUMN md5 TEXT;');
    const dCols = db.prepare('PRAGMA table_info(derivatives)').all().map((c) => c.name);
    if (!dCols.includes('md5')) db.exec('ALTER TABLE derivatives ADD COLUMN md5 TEXT;');
    if (!dCols.includes('sha256')) db.exec('ALTER TABLE derivatives ADD COLUMN sha256 TEXT;');
    if (!dCols.includes('phash')) db.exec('ALTER TABLE derivatives ADD COLUMN phash TEXT;');
    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_assets_md5 ON assets(md5) WHERE md5 IS NOT NULL;');
      db.exec('CREATE INDEX IF NOT EXISTS idx_deriv_md5 ON derivatives(md5) WHERE md5 IS NOT NULL;');
    } catch (_) {}
  } catch (e) {
    console.warn('[fingerprint] ensure columns failed:', e.message);
  }
}

/**
 * 在库内查找指纹命中（assets + derivatives）。
 * @returns {{hit:boolean,reason:string,fid:string,derivativeId:number|null,dist:number|null,kind:string}|null}
 */
function findFingerprintHit(db, { md5, sha256, phash, excludeFid = '' } = {}, opts = {}) {
  const sameThreshold = Number(opts.sameThreshold || PHASH_SAME);
  const nearThreshold = Number(opts.nearThreshold || PHASH_NEAR);

  // 1) 精确字节哈希先查全库（原图、全部衍生、导出登记）。命中即返回，不再算感知哈希。
  if (sha256) {
    const row = db
      .prepare('SELECT fid FROM assets WHERE sha256 = ? AND (? = \'\' OR fid != ?)')
      .get(sha256, excludeFid, excludeFid);
    if (row) return { hit: true, reason: 'sha256', fid: row.fid, derivativeId: null, dist: 0, kind: 'origin' };
  }
  if (md5) {
    try {
      const row = db
        .prepare('SELECT fid FROM assets WHERE md5 = ? AND (? = \'\' OR fid != ?)')
        .get(md5, excludeFid, excludeFid);
      if (row) return { hit: true, reason: 'md5', fid: row.fid, derivativeId: null, dist: 0, kind: 'origin' };
    } catch (_) {}
  }

  // 2) 精确字节哈希：全部衍生，含三天内和三天外的精修结果
  if (sha256 || md5) {
    try {
      const row = db
        .prepare(
          `SELECT asset_fid AS fid, id AS derivativeId, kind, sha256 AS dsha, md5 AS dmd5
           FROM derivatives
           WHERE (sha256 = ? OR md5 = ?)
             AND (? = '' OR asset_fid != ?)
           LIMIT 1`
        )
        .get(sha256 || '', md5 || '', excludeFid, excludeFid);
      if (row) {
        return {
          hit: true,
          reason: (sha256 && row.dsha === sha256) ? 'deriv_sha256' : 'deriv_md5',
          fid: row.fid,
          derivativeId: row.derivativeId,
          dist: 0,
          kind: row.kind || 'derivative',
        };
      }
    } catch (_) {}
  }
  if (sha256) {
    try {
      const { findExportBySha } = require('./export-registry');
      const exp = findExportBySha(db, sha256);
      if (exp) {
        return {
          hit: true,
          reason: 'export_registry',
          fid: exp.source_fid || '',
          derivativeId: null,
          dist: 0,
          kind: exp.kind || 'export',
        };
      }
    } catch (_) {}
  }

  if (!phash) return null;

  const since = Date.now() - PHASH_WINDOW_MS;

  // 3) 感知哈希：近三天入库的原图
  let best = null;
  try {
    const rows = db
      .prepare(
        `SELECT fid, phash FROM assets
         WHERE phash IS NOT NULL AND phash != ''
           AND created_at >= ?
           AND (? = '' OR fid != ?)`
      )
      .all(since, excludeFid, excludeFid);
    for (const r of rows) {
      const dist = hamming(phash, r.phash);
      if (dist > nearThreshold) continue;
      const cand = {
        hit: true,
        reason: dist <= sameThreshold ? `phash:${dist}` : `phash_near:${dist}`,
        fid: r.fid,
        derivativeId: null,
        dist,
        kind: 'origin',
      };
      if (!best || cand.dist < best.dist) best = cand;
      if (dist <= sameThreshold) return best;
    }
  } catch (_) {}

  // 4) 感知哈希：近三天的画幅重构和精修结果（不含 origin）
  try {
    const rows = db
      .prepare(
        `SELECT asset_fid AS fid, id AS derivativeId, kind, phash
         FROM derivatives
         WHERE phash IS NOT NULL AND phash != ''
           AND kind IN (${PHASH_WINDOW_DERIV_KINDS.map(() => '?').join(',')})
           AND created_at >= ?
           AND (? = '' OR asset_fid != ?)`
      )
      .all(...PHASH_WINDOW_DERIV_KINDS, since, excludeFid, excludeFid);
    for (const r of rows) {
      const dist = hamming(phash, r.phash);
      if (dist > nearThreshold) continue;
      const cand = {
        hit: true,
        reason: dist <= sameThreshold ? `deriv_phash:${dist}` : `deriv_phash_near:${dist}`,
        fid: r.fid,
        derivativeId: r.derivativeId,
        dist,
        kind: r.kind || 'derivative',
      };
      if (!best || cand.dist < best.dist) best = cand;
      if (dist <= sameThreshold) return best;
    }
  } catch (_) {}

  try {
    const rows = db.prepare(
      `SELECT source_fid AS fid, kind, phash FROM export_registry
       WHERE phash IS NOT NULL AND phash != '' AND created_at >= ?`
    ).all(since);
    for (const r of rows) {
      const dist = hamming(phash, r.phash);
      if (dist > nearThreshold) continue;
      const cand = {
        hit: true,
        reason: dist <= sameThreshold ? `export_phash:${dist}` : `export_phash_near:${dist}`,
        fid: r.fid || '',
        derivativeId: null,
        dist,
        kind: r.kind || 'export',
      };
      if (!best || cand.dist < best.dist) best = cand;
      if (dist <= sameThreshold) return best;
    }
  } catch (_) {}

  return best;
}

/**
 * 入库前完整指纹检查（异步，可算 phash）。
 * @returns {Promise<{hit:boolean,reason:string,fid:string,derivativeId:number|null,dist:number|null,kind:string}|null>}
 */
async function matchIncomingMedia(db, buffer, fileName = '', opts = {}) {
  const fp = await computeFingerprints(buffer, fileName);
  const hit = findFingerprintHit(
    db,
    { md5: fp.md5, sha256: fp.sha256, phash: fp.phash, excludeFid: opts.excludeFid || '' },
    opts
  );
  return hit ? { ...hit, fingerprints: fp } : null;
}

/** 将指纹写入 assets / derivatives */
function saveAssetFingerprints(db, fid, { md5, sha256, phash } = {}) {
  try {
    if (md5) db.prepare('UPDATE assets SET md5 = ? WHERE fid = ?').run(md5, fid);
    if (phash) db.prepare('UPDATE assets SET phash = ? WHERE fid = ? AND (phash IS NULL OR phash = \'\')').run(phash, fid);
    if (sha256) db.prepare('UPDATE assets SET sha256 = ? WHERE fid = ? AND (sha256 IS NULL OR sha256 = \'\')').run(sha256, fid);
  } catch (e) {
    console.warn('[fingerprint] saveAssetFingerprints', e.message);
  }
}

function saveDerivativeFingerprints(db, derivativeId, { md5, sha256, phash } = {}) {
  try {
    const sets = [];
    const args = [];
    if (md5) { sets.push('md5 = ?'); args.push(md5); }
    if (sha256) { sets.push('sha256 = ?'); args.push(sha256); }
    if (phash) { sets.push('phash = ?'); args.push(phash); }
    if (!sets.length) return;
    args.push(derivativeId);
    db.prepare(`UPDATE derivatives SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  } catch (e) {
    console.warn('[fingerprint] saveDerivativeFingerprints', e.message);
  }
}

module.exports = {
  PHASH_SAME,
  PHASH_NEAR,
  PHASH_WINDOW_MS,
  PHASH_WINDOW_DERIV_KINDS,
  computeFingerprints,
  findFingerprintHit,
  matchIncomingMedia,
  ensureFingerprintColumns,
  saveAssetFingerprints,
  saveDerivativeFingerprints,
  md5Of,
  sha256Of,
};
