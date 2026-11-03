const fs = require('fs');
const file = './src/assets-delete.js';
let content = fs.readFileSync(file, 'utf8');

const target = "CREATE INDEX IF NOT EXISTS idx_phash_bl ON phash_blacklist(phash);\r\n  `);\r\n  // 历史表补列";
const replacement = `CREATE INDEX IF NOT EXISTS idx_phash_bl ON phash_blacklist(phash);\r\n  \`);\r\n  // 保证 phash_blacklist 唯一索引 (Batch D.5)\r\n  try {\r\n    db.exec(\`\r\n      DELETE FROM phash_blacklist WHERE id NOT IN (\r\n        SELECT MIN(id) FROM phash_blacklist GROUP BY phash\r\n      );\r\n      CREATE UNIQUE INDEX IF NOT EXISTS idx_phash_blacklist_phash ON phash_blacklist(phash);\r\n    \`);\r\n  } catch (_) {}\r\n\r\n  // assets 表补充 reject_reason/detail\r\n  try {\r\n    const aCols = db.prepare('PRAGMA table_info(assets)').all().map((r) => r.name);\r\n    if (!aCols.includes('reject_reason')) db.exec('ALTER TABLE assets ADD COLUMN reject_reason TEXT');\r\n    if (!aCols.includes('reject_detail')) db.exec('ALTER TABLE assets ADD COLUMN reject_detail TEXT');\r\n  } catch (_) {}\r\n\r\n  // 历史表补列`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(file, content, 'utf8');
  console.log('[PASS] src/assets-delete.js patched successfully');
} else {
  console.log('[WARN] Target not found');
}
