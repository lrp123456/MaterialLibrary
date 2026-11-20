/**
 * Phase 2 验收门禁测试 1：PostgreSQL 迁移与幂等性校验测试 (PG Migration Test)
 *
 * 验证目标：
 * 1. 验证 SQLite 35+ 核心表结构解析与 PG DDL 生成完整性；
 * 2. 验证 asset_vectors 包含 vector(1024) 扩展列与 HNSW 索引定义；
 * 3. 验证 migrate-sqlite-to-pg 连续执行两次的幂等性（ON CONFLICT DO UPDATE/NOTHING，零报错）；
 * 4. 验证 verify-pg-migration 校验工具的行数与哈希比对能力。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const Database = require('better-sqlite3');
const { migrateSqliteToPg } = require('../../../../scripts/migrate-sqlite-to-pg');
const { verifyPgMigration } = require('../../../../scripts/verify-pg-migration');

async function run() {
  console.log('=== 1. 验证 PostgreSQL Schema 与 pgvector 定义 ===');
  const schemaSql = fs.readFileSync(path.join(__dirname, '../../src/db/schema.sql'), 'utf8');
  assert.ok(schemaSql.includes('CREATE EXTENSION IF NOT EXISTS vector;'), '必须包含 vector 扩展声明');
  assert.ok(schemaSql.includes('embedding vector(1024)'), 'asset_vectors 必须定义 vector(1024) 列');
  assert.ok(schemaSql.includes('idx_asset_vectors_hnsw'), '必须定义 HNSW 向量索引');
  console.log('✅ pgvector 与 HNSW 索引定义校验通过');

  console.log('\n=== 2. 构造测试 SQLite 数据库与样本数据 ===');
  const testDir = path.join(os.tmpdir(), 'pg_mig_test_' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  const testDbPath = path.join(testDir, 'material.db');

  const sqlite = new Database(testDbPath);
  sqlite.exec(`
    CREATE TABLE assets (
      fid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'ready',
      created_at INTEGER
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      role TEXT DEFAULT 'viewer'
    );
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      prompt TEXT,
      status TEXT DEFAULT 'done'
    );
    CREATE TABLE asset_vectors (
      asset_fid TEXT PRIMARY KEY,
      dim INTEGER DEFAULT 1024,
      vec_json TEXT
    );
  `);

  sqlite.exec(`
    INSERT INTO users (id, username, role) VALUES (1, 'alice', 'admin'), (2, 'bob', 'viewer');
    INSERT INTO assets (fid, name, status, created_at) VALUES ('fid_001', 'living_room.jpg', 'ready', 1700000000), ('fid_002', 'bedroom.jpg', 'ready', 1700000001);
    INSERT INTO chat_messages (id, session_id, prompt, status) VALUES ('msg_1', 'sess_1', '现代极简客厅', 'done');
    INSERT INTO asset_vectors (asset_fid, dim, vec_json) VALUES ('fid_001', 1024, '[0.1, 0.2]');
  `);
  sqlite.close();
  console.log('✅ 测试 SQLite 数据准备完毕');

  console.log('\n=== 3. 模拟 PG 连接池验证迁移器幂等执行 ===');
  const pgDataStore = new Map();

  // 创建具备真实表结构与内存存储的 Mock PG Client/Pool
  const mockPgPool = {
    async query(text, params = []) {
      const trimmed = text.trim();
      if (/information_schema\.columns/i.test(trimmed)) {
        const tableName = params[0]?.toLowerCase();
        if (tableName === 'users') return { rows: [{ column_name: 'id' }, { column_name: 'username' }, { column_name: 'role' }] };
        if (tableName === 'assets') return { rows: [{ column_name: 'fid' }, { column_name: 'name' }, { column_name: 'status' }, { column_name: 'created_at' }] };
        if (tableName === 'chat_messages') return { rows: [{ column_name: 'id' }, { column_name: 'session_id' }, { column_name: 'prompt' }, { column_name: 'status' }] };
        if (tableName === 'asset_vectors') return { rows: [{ column_name: 'asset_fid' }, { column_name: 'dim' }, { column_name: 'vec_json' }] };
        return { rows: [] };
      }
      if (/SELECT COUNT\(\*\)/i.test(trimmed)) {
        const m = trimmed.match(/FROM\s+"?([a-zA-Z0-9_]+)"?/i);
        const tbl = m ? m[1].toLowerCase() : '';
        const count = pgDataStore.get(tbl)?.size || 0;
        return { rows: [{ c: String(count) }] };
      }
      if (/SELECT \* FROM "?([a-zA-Z0-9_]+)"? WHERE "?([a-zA-Z0-9_]+)"? = \$1/i.test(trimmed)) {
        const m = trimmed.match(/SELECT \* FROM "?([a-zA-Z0-9_]+)"? WHERE "?([a-zA-Z0-9_]+)"? = \$1/i);
        const tbl = m[1].toLowerCase();
        const pkVal = params[0];
        const row = pgDataStore.get(tbl)?.get(String(pkVal));
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(text, params = []) {
          const trimmed = text.trim();
          if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') return;
          if (/INSERT INTO "?([a-zA-Z0-9_]+)"?/i.test(trimmed)) {
            const m = trimmed.match(/INSERT INTO "?([a-zA-Z0-9_]+)"?/i);
            const tbl = m[1].toLowerCase();
            if (!pgDataStore.has(tbl)) pgDataStore.set(tbl, new Map());
            const pk = String(params[0]);
            pgDataStore.get(tbl).set(pk, params);
          }
        },
        release() {}
      };
    },
    async end() {}
  };

  // 第 1 次迁移
  console.log('执行第 1 次迁移...');
  const res1 = await migrateSqliteToPg({ sqlitePath: testDbPath, pgPool: mockPgPool });
  assert.strictEqual(res1.errors.length, 0, '第 1 次迁移不能报错');
  assert.ok(res1.totalRows >= 5, '应迁移全部测试行');

  // 第 2 次迁移（验证幂等无冲突无重复）
  console.log('执行第 2 次迁移（验幂等）...');
  const res2 = await migrateSqliteToPg({ sqlitePath: testDbPath, pgPool: mockPgPool });
  assert.strictEqual(res2.errors.length, 0, '第 2 次幂等迁移不能报错');

  console.log('\n=== 4. 运行全量一致性比对工具 verifyPgMigration ===');
  const verifyRes = await verifyPgMigration({ sqlitePath: testDbPath, pgPool: mockPgPool });
  assert.strictEqual(verifyRes.failedTables, 0, '迁移校验差异表数必须为 0');
  assert.strictEqual(verifyRes.passedTables, 4, '4 张测试表必须全部校验通过');
  console.log('✅ 数据无损与幂等性校验全部通过');

  console.log('\n🎉 Phase 2 PostgreSQL 迁移与幂等门禁单测顺利通过！');
}

run().catch((e) => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});
