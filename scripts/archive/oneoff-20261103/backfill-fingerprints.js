/**
 * 回填 assets / derivatives 的 md5 + phash 指纹。
 * 用于：入库前与「曾经入库 + 已 9:16/3:4 化」的图做哈希比对。
 * 用法: node scripts/backfill-fingerprints.js [dataDir]
 */
const path = require('path');
const fs = require('fs');
const { openDb } = require('../src/db');
const { computeFingerprints, ensureFingerprintColumns, saveAssetFingerprints, saveDerivativeFingerprints } = require('../src/fingerprint');
const { resolveDerivativeFile } = require('../src/derivatives');

async function resolveFile(services, row) {
  try {
    const d = await resolveDerivativeFile(services, {
      storage_type: row.storage_type,
      storage_ref: row.storage_ref,
      file_name: row.file_name,
      asset_fid: row.asset_fid,
    });
    return d || null;
  } catch {
    return null;
  }
}

async function main() {
  const dataDir = process.argv[2] || path.join(__dirname, '..', 'data');
  const db = openDb(dataDir);
  ensureFingerprintColumns(db);
  const services = { db, config: { dataDir } };

  // 1) assets：补 md5 / phash
  const assets = db.prepare(`
    SELECT fid, file_name, sha256, md5, phash, size FROM assets
    WHERE status IS NULL OR status != 'deleted'
  `).all();
  let aDone = 0;
  for (const a of assets) {
    if (a.md5 && a.phash) continue;
    const file = await resolveFile(services, {
      storage_type: 'local_cache',
      storage_ref: `cache/originals/${a.fid}${path.extname(a.file_name || '.jpg') || '.jpg'}`,
      file_name: a.file_name,
      asset_fid: a.fid,
    });
    // 再尝试 derivatives.origin
    let abs = file;
    if (!abs || !fs.existsSync(abs)) {
      const od = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? AND kind='origin' LIMIT 1").get(a.fid);
      if (od) abs = await resolveFile(services, od);
    }
    if (!abs || !fs.existsSync(abs)) continue;
    try {
      const fp = await computeFingerprints(fs.readFileSync(abs), a.file_name);
      saveAssetFingerprints(db, a.fid, { md5: fp.md5, sha256: a.sha256 || fp.sha256, phash: fp.phash });
      aDone++;
    } catch (e) {
      console.warn('asset', a.fid, e.message);
    }
  }

  // 2) derivatives：补 md5 / sha256 / phash（含 restage_9_16 / restage_3_4）
  const drows = db.prepare(`
    SELECT id, asset_fid, kind, storage_type, storage_ref, file_name, mime, md5, phash
    FROM derivatives
    WHERE (md5 IS NULL OR md5 = '' OR phash IS NULL OR phash = '')
      AND (mime IS NULL OR mime LIKE 'image/%')
  `).all();
  let dDone = 0;
  for (const d of drows) {
    const abs = await resolveFile(services, d);
    if (!abs || !fs.existsSync(abs)) continue;
    try {
      const fp = await computeFingerprints(fs.readFileSync(abs), d.file_name);
      saveDerivativeFingerprints(db, d.id, { md5: fp.md5, sha256: fp.sha256, phash: fp.phash });
      dDone++;
    } catch (e) {
      console.warn('deriv', d.id, e.message);
    }
  }

  console.log(`[backfill-fingerprints] assets=${aDone} derivatives=${dDone}`);
  try { db.close(); } catch (_) {}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
