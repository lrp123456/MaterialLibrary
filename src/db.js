/**
 * SQLite 数据层（WAL 模式，单机权威源）
 * 启动时通过 migrate.js 保证 Schema、衍生血缘、内置适配器与默认工作流的幂等升级。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { DIMENSIONS, VALUES, calculateOriginOrientation } = require('./tags-seed');
const { migrate } = require('../scripts/migrate');

function ensureUltimateSchema(db) {
  // ── Batch A & F：全量可见图绝对查重列、导出暗标列与高性能复合索引 ──
  const addColIfMissing = (table, col, def) => {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch (_) {}
  };
  addColIfMissing('assets', 'export_tag', 'TEXT');
  addColIfMissing('assets', 'preview_sha256', 'TEXT');
  addColIfMissing('assets', 'preview_md5', 'TEXT');
  addColIfMissing('assets', 'thumb_sha256', 'TEXT');
  addColIfMissing('assets', 'thumb_md5', 'TEXT');
  addColIfMissing('assets', 'sharpness', 'REAL');
  addColIfMissing('assets', 'favorited_at', 'INTEGER');
  addColIfMissing('assets', 'source_type', 'TEXT');
  addColIfMissing('assets', 'source_note', 'TEXT');
  addColIfMissing('derivatives', 'sha256', 'TEXT');
  addColIfMissing('derivatives', 'md5', 'TEXT');
  addColIfMissing('derivatives', 'phash', 'TEXT');
  addColIfMissing('derivatives', 'file_size', 'INTEGER');
  // 历史库里 export_registry 是旧版结构（sha256/phash/source_fid/kind/marker），缺这些列
  addColIfMissing('export_registry', 'md5', 'TEXT');
  addColIfMissing('export_registry', 'variant', 'TEXT');
  addColIfMissing('export_registry', 'file_size', 'INTEGER');
  addColIfMissing('export_registry', 'exported_by', 'TEXT');
  addColIfMissing('export_registry', 'exported_at', 'INTEGER');

  // 每条 DDL 单独兜底：老库结构漂移不应阻断整个服务启动
  const tryExec = (sql, label) => {
    try {
      db.exec(sql);
    } catch (e) {
      console.warn(`[db] 结构补充跳过 ${label}: ${e.message}`);
    }
  };

  tryExec(`
    CREATE TABLE IF NOT EXISTS export_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sha256 TEXT NOT NULL,
      md5 TEXT,
      phash TEXT,
      source_fid TEXT NOT NULL,
      variant TEXT DEFAULT 'origin',
      file_size INTEGER,
      exported_by TEXT,
      exported_at INTEGER NOT NULL
    );
  `, 'export_registry.table');
  tryExec('CREATE UNIQUE INDEX IF NOT EXISTS idx_export_reg_sha256 ON export_registry(sha256);', 'idx_export_reg_sha256');
  tryExec('CREATE INDEX IF NOT EXISTS idx_export_reg_md5 ON export_registry(md5);', 'idx_export_reg_md5');
  tryExec('CREATE INDEX IF NOT EXISTS idx_export_reg_fid ON export_registry(source_fid);', 'idx_export_reg_fid');
  tryExec('CREATE INDEX IF NOT EXISTS idx_derivatives_sha256 ON derivatives(sha256);', 'idx_derivatives_sha256');
  tryExec('CREATE INDEX IF NOT EXISTS idx_derivatives_md5 ON derivatives(md5);', 'idx_derivatives_md5');
  tryExec('CREATE INDEX IF NOT EXISTS idx_derivatives_fid_kind ON derivatives(asset_fid, kind);', 'idx_derivatives_fid_kind');
  tryExec('CREATE INDEX IF NOT EXISTS idx_assets_browse ON assets(status, auth_state, created_at DESC, fid DESC);', 'idx_assets_browse');
  tryExec('CREATE INDEX IF NOT EXISTS idx_assets_preview_sha ON assets(preview_sha256);', 'idx_assets_preview_sha');
  tryExec('CREATE INDEX IF NOT EXISTS idx_assets_thumb_sha ON assets(thumb_sha256);', 'idx_assets_thumb_sha');
  tryExec('CREATE INDEX IF NOT EXISTS idx_node_runs_fid_node_id ON node_runs(asset_fid, node_id, id DESC);', 'idx_node_runs_fid_node_id');
  // 批次结算按 run_id 聚合 node_runs；缺索引时每次聚合都要全表扫（实测 15 万行 × 84 个活跃批次 ≈ 5.4s 同步阻塞）
  tryExec('CREATE INDEX IF NOT EXISTS idx_node_runs_run_id_status ON node_runs(run_id, status);', 'idx_node_runs_run_id_status');
  tryExec('CREATE INDEX IF NOT EXISTS idx_asset_tags_tag_fid ON asset_tags(tag_id, asset_fid);', 'idx_asset_tags_tag_fid');

  tryExec(`
    CREATE TABLE IF NOT EXISTS similarity_ignored_pairs (
      fid_a TEXT NOT NULL,
      fid_b TEXT NOT NULL,
      reason TEXT DEFAULT 'manual_keep_all',
      actor TEXT DEFAULT 'admin',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (fid_a, fid_b)
    );
  `, 'similarity_ignored_pairs');
}

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  // 幂等执行增量补齐与表结构保障
  const db = migrate(dataDir, { doBackup: false });

  // 保证 Batch A & F 必备字段、索引与查重表
  ensureUltimateSchema(db);

  // export_registry 历史遗留两套列集，回填缺失的时间列
  try {
    const { backfillLegacyTimestamps } = require('./export-registry');
    const n = backfillLegacyTimestamps(db);
    if (n) console.log(`[db] export_registry 回填 created_at ${n} 行`);
  } catch (e) {
    console.warn('[db] export_registry 回填跳过:', e.message);
  }

  // 常用预编译语句挂载
  db.getTag = db.prepare('SELECT * FROM tag_dict WHERE dimension=? AND dir=?');
  db.tagCount = db.prepare('SELECT COUNT(*) c FROM tag_dict').get;
  return db;
}

module.exports = { openDb, ensureUltimateSchema, DIMENSIONS, VALUES, calculateOriginOrientation };
