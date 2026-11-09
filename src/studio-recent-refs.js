/**
 * 「最近使用的素材」服务端存储（跨对话共享）。
 *
 * 之前这套数据只活在前端内存 `sessionRefPool` 里：切板块就没了，换个对话又会串，
 * 刷新后彻底归零。现在按用户维度落库，保留最近 50 条，素材选择器可以分
 * 「本对话 / 其他对话」两栏展示。
 *
 * 关键约定：
 * - ref_key 优先用 `fid:<fid>`，没有 fid 的生成产物用 `url:<sha1(去token的路径)>`；
 * - 存 URL 时剥掉 token（token 是会话级短期凭证，存下来下次必 401），返回时前端重签；
 * - 唯一键 (user_id, ref_key)：同一素材换对话只更新时间，不重复堆行。
 */
'use strict';

const crypto = require('crypto');

const MAX_PER_USER = 50;
const schemaEnsured = new WeakSet();

function ensureSchema(db) {
  if (schemaEnsured.has(db)) return;
  schemaEnsured.add(db);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS studio_recent_refs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        ref_key TEXT NOT NULL,
        fid TEXT DEFAULT '',
        url TEXT DEFAULT '',
        name TEXT DEFAULT '',
        kind TEXT DEFAULT 'image',
        origin TEXT DEFAULT 'upload',
        session_id TEXT DEFAULT '',
        hit_count INTEGER DEFAULT 1,
        created_at INTEGER,
        used_at INTEGER,
        UNIQUE(user_id, ref_key)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_recent_refs_user_key
        ON studio_recent_refs(user_id, ref_key);
      CREATE INDEX IF NOT EXISTS idx_recent_refs_user_time
        ON studio_recent_refs(user_id, used_at DESC);
      CREATE INDEX IF NOT EXISTS idx_recent_refs_user_session
        ON studio_recent_refs(user_id, session_id, used_at DESC);
    `);
  } catch (e) {
    console.warn('[recent-refs] 建表失败:', e.message);
  }
}

/** 剥掉短期凭证，只留可重签的稳定路径。 */
function stripToken(url) {
  const raw = String(url || '').trim();
  if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return '';
  if (!raw.startsWith('/')) return raw;
  try {
    const u = new URL(raw, 'http://local.invalid');
    u.searchParams.delete('token');
    u.searchParams.delete('media_token');
    return `${u.pathname}${u.search}`;
  } catch (_) {
    return raw;
  }
}

function refKeyOf({ fid = '', url = '' }) {
  if (fid) return `fid:${fid}`;
  const stable = stripToken(url);
  if (!stable) return '';
  return `url:${crypto.createHash('sha1').update(stable).digest('hex')}`;
}

function normalizeItems(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const fid = String(item.fid || '');
    const url = stripToken(item.url);
    const key = refKeyOf({ fid, url });
    if (!key) continue;
    out.push({
      ref_key: key,
      fid,
      url,
      name: String(item.name || '').slice(0, 120),
      kind: String(item.kind || 'image').slice(0, 16),
      origin: String(item.origin || 'upload').slice(0, 16),
    });
  }
  return out;
}

/** 记录一批「刚用过/刚生成」的素材，并把该用户的历史裁到最近 50 条。 */
function recordRecentRefs(db, userId, sessionId, items) {
  ensureSchema(db);
  const list = normalizeItems(items);
  if (!userId || !list.length) return { inserted: 0, skipped: 0 };
  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO studio_recent_refs
      (user_id, ref_key, fid, url, name, kind, origin, session_id, hit_count, created_at, used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(user_id, ref_key) DO UPDATE SET
      used_at = excluded.used_at,
      session_id = excluded.session_id,
      name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE studio_recent_refs.name END,
      url = CASE WHEN excluded.url <> '' THEN excluded.url ELSE studio_recent_refs.url END,
      fid = CASE WHEN excluded.fid <> '' THEN excluded.fid ELSE studio_recent_refs.fid END,
      origin = excluded.origin,
      hit_count = studio_recent_refs.hit_count + 1
  `);
  const trim = db.prepare(`
    DELETE FROM studio_recent_refs
    WHERE user_id = ? AND id NOT IN (
      SELECT id FROM studio_recent_refs WHERE user_id = ? ORDER BY used_at DESC, id DESC LIMIT ${MAX_PER_USER}
    )
  `);

  let inserted = 0;
  // 用显式事务而不是 db.transaction()：这个模块也会在 node:sqlite（测试/脚本）下跑，那边没有 transaction 包装器
  try {
    db.exec('BEGIN');
    for (const item of list) {
      upsert.run(
        userId, item.ref_key, item.fid, item.url, item.name, item.kind, item.origin,
        String(sessionId || ''), now, now
      );
      inserted += 1;
    }
    trim.run(userId, userId);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    console.warn('[recent-refs] 写入失败:', e.message);
    return { inserted: 0, skipped: list.length };
  }
  return { inserted, skipped: 0 };
}

function shapeRow(row) {
  return {
    fid: row.fid || '',
    url: row.url || '',
    name: row.name || '',
    kind: row.kind || 'image',
    origin: row.origin || 'upload',
    sessionId: row.session_id || '',
    sessionTitle: row.session_title || '',
    usedAt: Number(row.used_at || 0),
  };
}

/**
 * 分两栏取数：current = 当前对话用过的；others = 其他对话用过的（同素材不重复出现）。
 * 每栏最多 20 条（库里已按 50 条裁剪，这里只是控制渲染量）。
 */
function listRecentRefs(db, userId, sessionId, { limit = 20 } = {}) {
  ensureSchema(db);
  if (!userId) return { current: [], others: [] };
  const sid = String(sessionId || '');
  const per = Math.max(1, Math.min(50, Number(limit) || 20));
  const baseSql = `
    SELECT r.*, COALESCE(s.title, '') AS session_title
    FROM studio_recent_refs r
    LEFT JOIN chat_sessions s ON s.id = r.session_id
    WHERE r.user_id = ?
  `;
  const current = sid
    ? db.prepare(`${baseSql} AND r.session_id = ? ORDER BY r.used_at DESC, r.id DESC LIMIT ?`).all(userId, sid, per)
    : [];
  const currentKeys = new Set(current.map((r) => r.ref_key));
  const othersRaw = db.prepare(`${baseSql} AND r.session_id <> ? ORDER BY r.used_at DESC, r.id DESC LIMIT ?`)
    .all(userId, sid, per + currentKeys.size + 10);
  const others = [];
  for (const row of othersRaw) {
    if (currentKeys.has(row.ref_key)) continue;
    others.push(row);
    if (others.length >= per) break;
  }
  return { current: current.map(shapeRow), others: others.map(shapeRow) };
}

module.exports = { ensureSchema, recordRecentRefs, listRecentRefs, stripToken, refKeyOf };
