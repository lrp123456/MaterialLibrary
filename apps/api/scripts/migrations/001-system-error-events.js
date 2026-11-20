/**
 * 001-system-error-events.js
 * 可逆数据库迁移：创建/销毁旁路错误监控表 system_error_events
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_error_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT UNIQUE NOT NULL,
      module TEXT NOT NULL,
      error_code TEXT,
      message TEXT,
      stack TEXT,
      entity_type TEXT,
      entity_id TEXT,
      context_json TEXT,
      severity TEXT NOT NULL DEFAULT 'error',
      count INTEGER NOT NULL DEFAULT 1,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_at INTEGER,
      resolved_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_err_events_status ON system_error_events(status, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_err_events_fingerprint ON system_error_events(fingerprint);
  `);
}

function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_err_events_fingerprint;
    DROP INDEX IF EXISTS idx_err_events_status;
    DROP TABLE IF EXISTS system_error_events;
  `);
}

module.exports = { up, down };
