/**
 * 本端保存到相册的结果登记。
 * 入库用 sha256 精确拒绝，不扫全库 pHash。
 */
function ensureExportRegistry(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS export_registry (
      sha256 TEXT PRIMARY KEY,
      phash TEXT,
      source_fid TEXT,
      kind TEXT,
      marker TEXT,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_export_registry_created ON export_registry(created_at);
  `);
}

function findExportBySha(db, sha256) {
  if (!db || !sha256) return null;
  try {
    ensureExportRegistry(db);
    return db.prepare('SELECT sha256, phash, source_fid, kind, marker, created_at FROM export_registry WHERE sha256 = ?').get(sha256) || null;
  } catch (_) {
    return null;
  }
}

function registerExport(db, { sha256, phash = '', sourceFid = '', kind = 'edit', marker = '', createdAt = Date.now() } = {}) {
  if (!db || !sha256) throw new Error('缺少 sha256');
  ensureExportRegistry(db);
  db.prepare(`
    INSERT INTO export_registry (sha256, phash, source_fid, kind, marker, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(sha256) DO UPDATE SET
      phash = excluded.phash,
      source_fid = excluded.source_fid,
      kind = excluded.kind,
      marker = excluded.marker,
      created_at = excluded.created_at
  `).run(String(sha256), String(phash || ''), String(sourceFid || ''), String(kind || 'edit'), String(marker || ''), Number(createdAt) || Date.now());
  return findExportBySha(db, sha256);
}

module.exports = { ensureExportRegistry, findExportBySha, registerExport };
