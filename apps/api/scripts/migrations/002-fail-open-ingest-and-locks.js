/**
 * Phase 3 可逆数据库迁移：双字段 Fail-Open 状态解耦与 Base Library 字段锁保护
 *
 * 变更内容：
 * 1. assets 表补充：
 *    - visibility: 'visible' | 'rejected_box' | 'deleted' (默认 'visible')
 *    - pipeline_status: 'queued' | 'running' | 'done' | 'partial_failed'
 *    - source_type: 'web_upload' | 'studio_save' | 'app_manual' | 'app_album_sync'
 * 2. ba_items 表补充：
 *    - origin: 'crawler' | 'manual'
 *    - locked_fields: JSON 数组字符串，记录人工锁定不被爬虫覆盖的字段名列表
 */

function addColumnIfMissing(db, table, columnDef) {
  try {
    const colName = columnDef.split(' ')[0];
    const info = db.prepare(`PRAGMA table_info("${table}")`).all();
    if (!info.some(c => c.name.toLowerCase() === colName.toLowerCase())) {
      db.exec(`ALTER TABLE "${table}" ADD COLUMN ${columnDef}`);
    }
  } catch (e) {
    // 忽略重复列或表不存在异常
  }
}

function up(db) {
  // 1. assets 双字段与来源扩展
  addColumnIfMissing(db, 'assets', "visibility TEXT DEFAULT 'visible'");
  addColumnIfMissing(db, 'assets', "pipeline_status TEXT DEFAULT 'done'");
  addColumnIfMissing(db, 'assets', "source_type TEXT DEFAULT 'web_upload'");

  try {
    // 存量 ready 数据初始化为 visible 与 done
    db.exec(`
      UPDATE assets SET visibility = 'visible' WHERE visibility IS NULL OR visibility = '';
      UPDATE assets SET pipeline_status = 'done' WHERE status = 'ready' AND (pipeline_status IS NULL OR pipeline_status = 'queued');
      CREATE INDEX IF NOT EXISTS idx_assets_visibility_browse ON assets(visibility, auth_state, created_at DESC);
    `);
  } catch (_) {}

  // 2. ba_items 人工锁定保护列
  addColumnIfMissing(db, 'ba_items', "origin TEXT DEFAULT 'crawler'");
  addColumnIfMissing(db, 'ba_items', "locked_fields TEXT DEFAULT '[]'");
}

function down(db) {
  // SQLite 不支持 DROP COLUMN 的旧版本中保留列，恢复默认值与索引清理
  try {
    db.exec(`
      DROP INDEX IF EXISTS idx_assets_visibility_browse;
      UPDATE assets SET visibility = NULL, pipeline_status = NULL WHERE 1=1;
      UPDATE ba_items SET origin = 'crawler', locked_fields = '[]' WHERE 1=1;
    `);
  } catch (_) {}
}

module.exports = { up, down };
