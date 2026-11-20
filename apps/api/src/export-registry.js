/**
 * 本端保存到相册的结果登记。
 * 入库用 sha256 精确拒绝，不扫全库 pHash。
 *
 * 本模块历史上使用 (kind/marker/created_at) 列集，而 src/db.js 使用
 * (variant/exported_by/exported_at) 列集。建表语句因 IF NOT EXISTS 不会冲突，
 * 但两个写入方各自只填一半列，导致按时间窗/按 md5 的查重查询静默漏命中。
 * 现在两套列集互为镜像，任何一方写入后另一套列都能查到。
 */

const COLUMN_DEFS = [
  ['sha256', 'TEXT'],
  ['md5', 'TEXT'],
  ['phash', 'TEXT'],
  ['source_fid', 'TEXT'],
  ['kind', 'TEXT'],
  ['marker', 'TEXT'],
  ['created_at', 'INTEGER'],
  ['variant', 'TEXT'],
  ['file_size', 'INTEGER'],
  ['exported_by', 'TEXT'],
  ['exported_at', 'INTEGER'],
];

const schemaReady = new WeakSet();

function ensureExportRegistry(db) {
  if (!db) return;
  if (schemaReady.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS export_registry (
      sha256 TEXT PRIMARY KEY,
      md5 TEXT,
      phash TEXT,
      source_fid TEXT,
      kind TEXT,
      marker TEXT,
      created_at INTEGER,
      variant TEXT,
      file_size INTEGER,
      exported_by TEXT,
      exported_at INTEGER
    );
  `);
  let cols = [];
  try {
    cols = db.prepare('PRAGMA table_info(export_registry)').all().map((c) => c.name);
  } catch (_) {
    cols = [];
  }
  for (const [name, def] of COLUMN_DEFS) {
    if (cols.includes(name)) continue;
    try {
      db.exec(`ALTER TABLE export_registry ADD COLUMN ${name} ${def}`);
    } catch (_) {}
  }
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_export_reg_sha256 ON export_registry(sha256);');
  } catch (_) {}
  schemaReady.add(db);
}

function findExportBySha(db, sha256) {
  if (!db || !sha256) return null;
  try {
    ensureExportRegistry(db);
    return db.prepare(`
      SELECT sha256,
             phash,
             source_fid,
             COALESCE(kind, variant) AS kind,
             COALESCE(marker, exported_by) AS marker,
             COALESCE(created_at, exported_at) AS created_at
      FROM export_registry WHERE sha256 = ?
    `).get(sha256) || null;
  } catch (_) {
    return null;
  }
}

function registerExport(db, { sha256, md5 = '', phash = '', sourceFid = '', kind = 'edit', marker = '', createdAt = Date.now() } = {}) {
  if (!db || !sha256) throw new Error('缺少 sha256');
  ensureExportRegistry(db);
  const now = Number(createdAt) || Date.now();
  const kindVal = String(kind || 'edit');
  const markerVal = String(marker || '');
  db.prepare(`
    INSERT INTO export_registry (sha256, md5, phash, source_fid, kind, marker, created_at, variant, exported_by, exported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sha256) DO UPDATE SET
      md5 = COALESCE(excluded.md5, export_registry.md5),
      phash = COALESCE(excluded.phash, export_registry.phash),
      source_fid = COALESCE(excluded.source_fid, export_registry.source_fid),
      kind = excluded.kind,
      marker = excluded.marker,
      created_at = excluded.created_at,
      variant = excluded.variant,
      exported_by = excluded.exported_by,
      exported_at = excluded.exported_at
  `).run(
    String(sha256), String(md5 || ''), String(phash || ''), String(sourceFid || ''),
    kindVal, markerVal, now,
    kindVal, markerVal, now
  );
  return findExportBySha(db, sha256);
}

/** 旧行回填：把只写了 db.js 列集的记录补上时间列，让时间窗查重能扫到它们 */
function backfillLegacyTimestamps(db) {
  if (!db) return 0;
  try {
    ensureExportRegistry(db);
    const info = db.prepare(
      'UPDATE export_registry SET created_at = exported_at WHERE created_at IS NULL AND exported_at IS NOT NULL'
    ).run();
    return info.changes || 0;
  } catch (_) {
    return 0;
  }
}

module.exports = { ensureExportRegistry, findExportBySha, registerExport, backfillLegacyTimestamps };
