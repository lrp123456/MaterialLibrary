/**
 * 一次性：把已落盘的 discovered 视频改为 ready，便于素材库展示。
 * 不改 auth_state（冻结仍冻结）；不入打标队列。
 * 直接打开 material.db，避免 openDb 走 migrate 抢写锁。
 */
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library');
const db = new Database(path.join(dataDir, 'material.db'));
db.pragma('busy_timeout = 8000');
db.pragma('journal_mode = WAL');

const now = Date.now();
const r = db.prepare(`
  UPDATE assets
  SET status = 'ready',
      is_representative = 1,
      updated_at = ?
  WHERE kind = 'video'
    AND status = 'discovered'
    AND EXISTS (
      SELECT 1 FROM derivatives d
      WHERE d.asset_fid = assets.fid AND d.kind = 'origin'
    )
`).run(now);

const left = db.prepare(`
  SELECT COUNT(*) AS c FROM assets WHERE kind = 'video' AND status = 'discovered'
`).get().c;
const ready = db.prepare(`
  SELECT COUNT(*) AS c FROM assets WHERE kind = 'video' AND status = 'ready'
`).get().c;

console.log(`promoted=${r.changes} remaining_discovered=${left} ready=${ready}`);
db.close();
