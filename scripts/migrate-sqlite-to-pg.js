/**
 * SQLite 到 PostgreSQL 幂等无损全量数据迁移工具 (Phase 2)
 *
 * 核心要求：
 * 1. 只读读取原 SQLite material.db（绝不修改原库）；
 * 2. 幂等执行（ON CONFLICT DO UPDATE / NOTHING，多次运行不报错、不重、不漏）；
 * 3. 逐表分批迁移，支持进度输出与统计。
 */
const path = require('path');
const fs = require('fs');
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
const { initPgSchema } = require('../apps/api/src/db/pg');

const BATCH_SIZE = 500;

async function migrateSqliteToPg(options = {}) {
  const dataDir = options.dataDir || process.env.ML_DATA_DIR || path.join(__dirname, '..', 'data');
  const sqlitePath = options.sqlitePath || path.join(dataDir, 'material.db');
  const pgUrl = options.pgUrl || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/material_library';

  console.log(`[migrate-to-pg] 源 SQLite 数据库: ${sqlitePath}`);
  console.log(`[migrate-to-pg] 目标 PostgreSQL URL: ${pgUrl}`);

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite 数据库文件不存在: ${sqlitePath}`);
  }

  // 1. 严格只读打开 SQLite
  const sqliteDb = new Database(sqlitePath, { readonly: true });
  sqliteDb.pragma('query_only = ON');

  // 2. 连接 PostgreSQL
  const pgPool = options.pgPool || new Pool({ connectionString: pgUrl });

  try {
    // 初始化 Schema
    console.log('[migrate-to-pg] 正在初始化 PostgreSQL Schema...');
    await initPgSchema(pgPool);

    // 获取 SQLite 全量表清单
    const tables = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);

    console.log(`[migrate-to-pg] 发现 ${tables.length} 张待迁移表`);

    const summary = {
      totalTables: tables.length,
      migratedTables: 0,
      totalRows: 0,
      errors: []
    };

    for (const table of tables) {
      try {
        const countRow = sqliteDb.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get();
        const total = countRow ? countRow.c : 0;
        if (total === 0) {
          summary.migratedTables++;
          continue;
        }

        // 获取表列信息与主键
        const colInfo = sqliteDb.prepare(`PRAGMA table_info("${table}")`).all();
        const colNames = colInfo.map((c) => c.name);
        const pkCols = colInfo.filter((c) => c.pk > 0).map((c) => c.name);

        // 获取 PG 表实际存在的列，避免 SQLite 旧版多余列或类型不匹配
        const pgColsRes = await pgPool.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
          [table.toLowerCase()]
        );
        const validPgCols = new Set(pgColsRes.rows.map((r) => r.column_name.toLowerCase()));
        const targetCols = colNames.filter((c) => validPgCols.has(c.toLowerCase()));

        if (targetCols.length === 0) {
          console.warn(`[migrate-to-pg] 表 ${table} 在 PG 中无匹配列，跳过数据导入`);
          continue;
        }

        const validPkCols = pkCols.filter((c) => validPgCols.has(c.toLowerCase()));

        // 分批读取并写入
        let offset = 0;
        let inserted = 0;

        while (offset < total) {
          const rows = sqliteDb
            .prepare(`SELECT ${targetCols.map((c) => `"${c}"`).join(', ')} FROM "${table}" LIMIT ${BATCH_SIZE} OFFSET ${offset}`)
            .all();

          if (!rows || rows.length === 0) break;

          const client = await pgPool.connect();
          try {
            await client.query('BEGIN');

            for (const row of rows) {
              const vals = targetCols.map((c) => row[c]);
              const colList = targetCols.map((c) => `"${c.toLowerCase()}"`).join(', ');
              const placeholders = targetCols.map((_, i) => `$${i + 1}`).join(', ');

              let onConflictClause = 'ON CONFLICT DO NOTHING';
              if (validPkCols.length > 0) {
                const pkConstraint = validPkCols.map((c) => `"${c.toLowerCase()}"`).join(', ');
                const updateSets = targetCols
                  .filter((c) => !validPkCols.includes(c))
                  .map((c) => `"${c.toLowerCase()}" = EXCLUDED."${c.toLowerCase()}"`)
                  .join(', ');

                if (updateSets.length > 0) {
                  onConflictClause = `ON CONFLICT (${pkConstraint}) DO UPDATE SET ${updateSets}`;
                } else {
                  onConflictClause = `ON CONFLICT (${pkConstraint}) DO NOTHING`;
                }
              }

              const sql = `INSERT INTO "${table.toLowerCase()}" (${colList}) VALUES (${placeholders}) ${onConflictClause}`;
              await client.query(sql, vals);
            }

            await client.query('COMMIT');
          } catch (batchErr) {
            await client.query('ROLLBACK');
            throw batchErr;
          } finally {
            client.release();
          }

          inserted += rows.length;
          offset += rows.length;
        }

        summary.migratedTables++;
        summary.totalRows += inserted;
        console.log(`[migrate-to-pg] ✓ 表 ${table.padEnd(28)}: ${inserted} 行迁移成功`);
      } catch (tableErr) {
        console.error(`[migrate-to-pg] ✗ 表 ${table} 迁移失败:`, tableErr.message);
        summary.errors.push({ table, error: tableErr.message });
      }
    }

    console.log('\n[migrate-to-pg] 迁移全部完成:');
    console.log(`- 成功表数: ${summary.migratedTables}/${summary.totalTables}`);
    console.log(`- 迁移数据行数: ${summary.totalRows}`);
    console.log(`- 失败表数: ${summary.errors.length}`);

    return summary;
  } finally {
    sqliteDb.close();
    if (!options.pgPool) {
      await pgPool.end();
    }
  }
}

if (require.main === module) {
  migrateSqliteToPg()
    .then((res) => {
      if (res.errors.length > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate-to-pg] 迁移发生未捕获异常:', err);
      process.exit(1);
    });
}

module.exports = { migrateSqliteToPg };
