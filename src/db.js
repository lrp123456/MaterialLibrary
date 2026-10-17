/**
 * SQLite 数据层（WAL 模式，单机权威源）
 * 启动时通过 migrate.js 保证 Schema、衍生血缘、内置适配器与默认工作流的幂等升级。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { DIMENSIONS, VALUES, calculateOriginOrientation } = require('./tags-seed');
const { migrate } = require('../scripts/migrate');

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  // 幂等执行增量补齐与表结构保障
  const db = migrate(dataDir, { doBackup: false });

  // 常用预编译语句挂载
  db.getTag = db.prepare('SELECT * FROM tag_dict WHERE dimension=? AND dir=?');
  db.tagCount = db.prepare('SELECT COUNT(*) c FROM tag_dict').get;
  return db;
}

module.exports = { openDb, DIMENSIONS, VALUES, calculateOriginOrientation };
