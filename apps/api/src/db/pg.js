/**
 * PostgreSQL 数据层客户端与连接池基座 (Phase 2)
 * 支持 pgvector 向量检索与标准 Repository 模式
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;

function getPgConfig() {
  const connString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/material_library';
  return {
    connectionString: connString,
    max: parseInt(process.env.PG_MAX_POOL || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(getPgConfig());
    pool.on('error', (err) => {
      console.error('[pg] Unexpected error on idle client:', err);
    });
  }
  return pool;
}

function isPgConfigured() {
  return Boolean(process.env.DATABASE_URL || process.env.USE_POSTGRES === '1');
}

/**
 * 执行参数化 SQL 查询
 * @param {string} text - SQL 语句
 * @param {Array} [params] - 参数数组
 */
async function query(text, params = []) {
  const p = getPool();
  const start = Date.now();
  try {
    const res = await p.query(text, params);
    return res;
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`[pg] Query error (${duration}ms):`, { text: text.slice(0, 100), error: err.message });
    throw err;
  }
}

/**
 * 从连接池获取单个 Client 用于高级控制
 */
async function getClient() {
  const p = getPool();
  return await p.connect();
}

/**
 * 事务包裹执行器
 * @param {Function} callback - async (client) => result
 */
async function withTransaction(callback) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 初始化 PostgreSQL Schema（执行 schema.sql）
 */
async function initPgSchema(customPool) {
  const p = customPool || getPool();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // 先尝试加载 pgvector 扩展；若环境未装 pgvector，忽略扩展失败并剥离 vector 列定义进行 fallback
  try {
    await p.query('CREATE EXTENSION IF NOT EXISTS vector;');
  } catch (e) {
    console.warn('[pg] pgvector extension not available in current environment, vector operations will fallback:', e.message);
  }

  // 分块执行建表语句
  try {
    await p.query(sql);
  } catch (e) {
    // 若因 vector 扩展缺失报错，剥离 vector 关键字重试
    if (/type "vector" does not exist/i.test(e.message)) {
      console.warn('[pg] Fallback schema without vector(1024) column type...');
      const fallbackSql = sql
        .replace(/embedding vector\(1024\),/g, 'embedding TEXT,')
        .replace(/CREATE INDEX IF NOT EXISTS idx_asset_vectors_hnsw ON asset_vectors USING hnsw \(embedding vector_cosine_ops\);/g, '-- HNSW skipped without pgvector');
      await p.query(fallbackSql);
    } else {
      throw e;
    }
  }
}

/**
 * 关闭连接池
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  isPgConfigured,
  query,
  getClient,
  withTransaction,
  initPgSchema,
  closePool,
};
