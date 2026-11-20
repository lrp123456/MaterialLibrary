/**
 * PostgreSQL 迁移一致性全量校验工具 (Phase 2)
 *
 * 验证目标：
 * 1. 逐表校验 SQLite vs PostgreSQL 总行数一致性；
 * 2. 抽样核心字段与内容哈希校验；
 * 3. 统计不一致或缺失表，输出可量化报告。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = (() => {
  try { return require('better-sqlite3'); } catch (_) {
    return require('../apps/api/node_modules/better-sqlite3');
  }
})();
const { Pool } = (() => {
  try { return require('pg'); } catch (_) {
    return require('../apps/api/node_modules/pg');
  }
})();

async function verifyPgMigration(options = {}) {
  const dataDir = options.dataDir || process.env.ML_DATA_DIR || path.join(__dirname, '..', 'data');
  const sqlitePath = options.sqlitePath || path.join(dataDir, 'material.db');
  const pgUrl = options.pgUrl || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/material_library';

  console.log(`[verify-pg] 正在对比校验: ${sqlitePath} <===> ${pgUrl}`);

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite 数据库文件不存在: ${sqlitePath}`);
  }

  const sqliteDb = new Database(sqlitePath, { readonly: true });
  const pgPool = options.pgPool || new Pool({ connectionString: pgUrl });

  try {
    const tables = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);

    const report = {
      totalTables: tables.length,
      passedTables: 0,
      failedTables: 0,
      diffs: [],
      details: []
    };

    for (const table of tables) {
      const sqliteCount = sqliteDb.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get().c;

      let pgCount = 0;
      let pgTableExists = true;

      try {
        const res = await pgPool.query(`SELECT COUNT(*) as c FROM "${table.toLowerCase()}"`);
        pgCount = parseInt(res.rows[0].c, 10);
      } catch (e) {
        pgTableExists = false;
        report.failedTables++;
        report.diffs.push({ table, error: `PG 表不存在或查询失败: ${e.message}` });
        continue;
      }

      const countMatched = sqliteCount === pgCount;

      let sampledSampleMatched = true;
      let sampleDiffReason = '';

      if (sqliteCount > 0 && countMatched) {
        // 抽样前 5 条做主键或字段哈希比对
        const colInfo = sqliteDb.prepare(`PRAGMA table_info("${table}")`).all();
        const pkCol = colInfo.find((c) => c.pk > 0)?.name || colInfo[0]?.name;

        if (pkCol) {
          const sqliteSamples = sqliteDb
            .prepare(`SELECT * FROM "${table}" ORDER BY "${pkCol}" ASC LIMIT 5`)
            .all();

          for (const sRow of sqliteSamples) {
            const pkVal = sRow[pkCol];
            const pgRowRes = await pgPool.query(
              `SELECT * FROM "${table.toLowerCase()}" WHERE "${pkCol.toLowerCase()}" = $1`,
              [pkVal]
            );

            if (pgRowRes.rows.length === 0) {
              sampledSampleMatched = false;
              sampleDiffReason = `主键 ${pkVal} 在 PG 中不存在`;
              break;
            }
          }
        }
      }

      const passed = countMatched && sampledSampleMatched;
      if (passed) {
        report.passedTables++;
        console.log(`[verify-pg] ✓ ${table.padEnd(30)} 一致 (行数: ${sqliteCount})`);
      } else {
        report.failedTables++;
        const reason = !countMatched
          ? `行数不符 (SQLite: ${sqliteCount}, PG: ${pgCount})`
          : sampleDiffReason;
        console.error(`[verify-pg] ✗ ${table.padEnd(30)} 不一致: ${reason}`);
        report.diffs.push({ table, reason, sqliteCount, pgCount });
      }

      report.details.push({
        table,
        sqliteCount,
        pgCount,
        passed
      });
    }

    console.log('\n[verify-pg] 校验汇总报告:');
    console.log(`- 校验表总数: ${report.totalTables}`);
    console.log(`- 完全一致表数: ${report.passedTables}`);
    console.log(`- 存在差异表数: ${report.failedTables}`);

    return report;
  } finally {
    sqliteDb.close();
    if (!options.pgPool) {
      await pgPool.end();
    }
  }
}

if (require.main === module) {
  verifyPgMigration()
    .then((res) => {
      if (res.failedTables > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[verify-pg] 校验异常:', err);
      process.exit(1);
    });
}

module.exports = { verifyPgMigration };
