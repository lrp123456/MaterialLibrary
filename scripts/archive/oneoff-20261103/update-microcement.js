/**
 * Update JW-% items to microcement and family = '微水泥'
 * Ensure wall and ceiling mounts in ba_item_mounts
 */
const Database = require('../node_modules/better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

function getDbPath() {
  if (process.argv[2]) return process.argv[2];
  if (process.platform === 'linux') {
    return path.join(os.homedir(), '.dsh-material-library', 'material.db');
  }
  return path.join(process.env.USERPROFILE || 'C:\\Users\\lrp', '.dsh-material-library', 'material.db');
}

const dbPath = getDbPath();
console.log(`[update-microcement] Opening DB: ${dbPath}`);
const db = new Database(dbPath, { timeout: 15000 });
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 15000');

const tx = db.transaction(() => {
  const now = Date.now();
  const updateStmt = db.prepare(`
    UPDATE ba_items
    SET kind = 'texture',
        kind_key = 'microcement',
        family = '\u5fae\u6c34\u6ce5',
        updated_at = ?
    WHERE (id LIKE 'nippon_JW-%' OR external_sku LIKE 'JW-%' OR (kind_key = 'microcement' AND (family IS NULL OR family = '???')))
  `);
  const res = updateStmt.run(now);
  console.log(`[update-microcement] Updated ${res.changes} items to microcement`);

  const items = db.prepare("SELECT id FROM ba_items WHERE kind_key = 'microcement'").all();
  const insMount = db.prepare('INSERT OR IGNORE INTO ba_item_mounts (item_id, mount) VALUES (?, ?)');
  let addedMounts = 0;
  for (const item of items) {
    const r1 = insMount.run(item.id, 'wall');
    const r2 = insMount.run(item.id, 'ceiling');
    addedMounts += r1.changes + r2.changes;
  }
  console.log(`[update-microcement] Total microcement items: ${items.length}, new mounts added: ${addedMounts}`);
});

tx();
db.close();
console.log('[update-microcement] Done successfully.');
