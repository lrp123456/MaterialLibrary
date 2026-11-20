#!/usr/bin/env node
/**
 * 审计整改迁移脚本（2026-10-20）—— CONFLICT-002 重复组退役的存量数据清理。
 *
 * 背景：用户拍板「删除重复的概念，清除这个字段」。代码层已整体拆除
 *   聚类/归组/组代表逻辑（src/cluster.js 瘦身、api/vector/restage 等同步清理），
 *   数据库列 dup_group_id / is_representative 按「先置空、不 DROP」策略保留在
 *   schema 中（避免 SQLite 重建表风险），本脚本负责把存量值统一置空。
 *
 * 操作（幂等，可重复执行）：
 *   1. UPDATE assets SET dup_group_id=NULL, is_representative=0（仅脏行）
 *   2. DELETE FROM dup_groups（表存在才执行）
 *   3. kv 记录迁移标记与影响行数
 *
 * 用法：
 *   node scripts/migrate-audit-20261020.js            # 默认 dry-run，只统计不写入
 *   node scripts/migrate-audit-20261020.js --yes      # 真正执行写入
 *   ML_DATA_DIR=/path node scripts/migrate-audit-20261020.js --yes
 *
 * 建议先手动备份 material.db（migrate 主流程亦会自动备份），再执行 --yes。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const CONFIRM = process.argv.includes('--yes');
const dataDir = process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library');
const dbFile = path.join(dataDir, 'material.db');

if (!fs.existsSync(dbFile)) {
  console.error(`[migrate-audit-20261020] 未找到数据库: ${dbFile}`);
  process.exit(1);
}

const db = new Database(dbFile);
db.pragma('busy_timeout = 8000');
db.pragma('journal_mode = WAL');

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

const dirty = db.prepare(`
  SELECT COUNT(*) c FROM assets
  WHERE dup_group_id IS NOT NULL OR is_representative != 0
`).get().c;
const groups = tableExists('dup_groups')
  ? db.prepare('SELECT COUNT(*) c FROM dup_groups').get().c
  : 0;

console.log(`[migrate-audit-20261020] 数据目录: ${dataDir}`);
console.log(`[migrate-audit-20261020] 待置空 assets 行: ${dirty}`);
console.log(`[migrate-audit-20261020] 待清空 dup_groups 行: ${groups}`);

if (!CONFIRM) {
  console.log('[migrate-audit-20261020] dry-run 结束（未写入）。确认无误后加 --yes 执行。');
  db.close();
  process.exit(0);
}

const tx = db.transaction(() => {
  const r1 = db.prepare(`
    UPDATE assets
    SET dup_group_id = NULL, is_representative = 0, updated_at = updated_at
    WHERE dup_group_id IS NOT NULL OR is_representative != 0
  `).run();
  let r2 = { changes: 0 };
  if (tableExists('dup_groups')) {
    r2 = db.prepare('DELETE FROM dup_groups').run();
  }
  db.prepare(`
    INSERT INTO kv (key, value) VALUES ('audit_20261020_dup_group_retired', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify({
    retiredAt: Date.now(),
    assetsReset: r1.changes,
    groupsDeleted: r2.changes
  }));
  return { assetsReset: r1.changes, groupsDeleted: r2.changes };
});

const result = tx();
console.log(`[migrate-audit-20261020] 完成：assets 置空 ${result.assetsReset} 行，dup_groups 删除 ${result.groupsDeleted} 行。`);
console.log('[migrate-audit-20261020] kv 标记 audit_20261020_dup_group_retired 已写入。');
db.close();
