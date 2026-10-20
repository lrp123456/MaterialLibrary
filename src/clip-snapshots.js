/**
 * 剪辑工程云端快照。
 *
 * 模型：本地是唯一编辑入口，云端只存"只读快照"。
 * - 备份 = 上传 SerializedProject + 素材 fid 清单（不传素材字节，素材本来就在库里）
 * - 分发 = 子机器显式拉取，拉下来成为本地工程
 * - 并发 = rev 乐观锁（与 editor_projects 同一套语义）
 *
 * 关键约束：清单里的 fid 必须真实存在。否则别的机器拉下来就是黑块。
 */
const crypto = require('crypto');

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function makeSnapId() {
  return `snap_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function ensureSnapshotTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clip_snapshots (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      owner_id       INTEGER NOT NULL DEFAULT 0,
      data_json      TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      thumbnail_fid  TEXT,
      size_bytes     INTEGER NOT NULL DEFAULT 0,
      rev            INTEGER NOT NULL DEFAULT 1,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clip_snapshot_assets (
      snapshot_id TEXT NOT NULL,
      fid         TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'media',
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (snapshot_id, fid)
    );
    CREATE INDEX IF NOT EXISTS idx_csa_fid ON clip_snapshot_assets(fid);
  `);
}

function normalizeAssets(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Map();
  for (const item of raw) {
    const fid = typeof item === 'string' ? item : item && item.fid;
    if (!fid || typeof fid !== 'string') continue;
    const role = (item && item.role) || 'media';
    if (!seen.has(fid)) seen.set(fid, String(role).slice(0, 24));
  }
  return [...seen.entries()].map(([fid, role]) => ({ fid, role }));
}

/** 校验素材都在库；返回缺失列表（不抛错，交给调用方决定状态码）。 */
function findMissingAssets(db, assets) {
  if (!assets.length) return [];
  const stmt = db.prepare('SELECT 1 AS ok FROM assets WHERE fid=?');
  const missing = [];
  for (const a of assets) {
    if (!stmt.get(a.fid)) missing.push(a.fid);
  }
  return missing;
}

function rowToSummary(row, assetsCount) {
  return {
    id: row.id,
    name: row.name,
    rev: Number(row.rev) || 1,
    schemaVersion: Number(row.schema_version) || 1,
    thumbnailFid: row.thumbnail_fid || null,
    sizeBytes: Number(row.size_bytes) || 0,
    assetsCount: Number(assetsCount) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listSnapshots(db) {
  const rows = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM clip_snapshot_assets a WHERE a.snapshot_id = s.id) AS assets_count
    FROM clip_snapshots s
    ORDER BY s.updated_at DESC
  `).all();
  return rows.map((r) => rowToSummary(r, r.assets_count));
}

function getSnapshot(db, id, { full = true } = {}) {
  const row = db.prepare('SELECT * FROM clip_snapshots WHERE id=?').get(id);
  if (!row) return null;
  const assets = db.prepare(
    'SELECT fid, role FROM clip_snapshot_assets WHERE snapshot_id=? ORDER BY fid',
  ).all(id);
  const out = rowToSummary(row, assets.length);
  out.assets = assets;
  if (full) {
    try {
      out.data = JSON.parse(row.data_json);
    } catch {
      throw Object.assign(new Error('快照数据损坏'), { status: 500 });
    }
  }
  return out;
}

function replaceAssets(db, snapshotId, assets) {
  db.prepare('DELETE FROM clip_snapshot_assets WHERE snapshot_id=?').run(snapshotId);
  const ins = db.prepare(
    'INSERT INTO clip_snapshot_assets (snapshot_id, fid, role, created_at) VALUES (?,?,?,?)',
  );
  const now = Date.now();
  for (const a of assets) ins.run(snapshotId, a.fid, a.role, now);
}

function createSnapshot(db, { name, data, assets, ownerId = 0, thumbnailFid = null }) {
  const id = makeSnapId();
  const payload = JSON.stringify(data);
  const now = Date.now();
  db.prepare(`
    INSERT INTO clip_snapshots (id, name, owner_id, data_json, schema_version, thumbnail_fid, size_bytes, rev, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(id, name, ownerId, payload, 1, thumbnailFid, Buffer.byteLength(payload), 1, now, now);
  replaceAssets(db, id, assets);
  return getSnapshot(db, id);
}

function updateSnapshot(db, id, { name, data, assets, rev, thumbnailFid = null }) {
  const cur = db.prepare('SELECT rev FROM clip_snapshots WHERE id=?').get(id);
  if (!cur) throw Object.assign(new Error('快照不存在'), { status: 404 });
  const payload = JSON.stringify(data);
  const expected = Number(rev);
  if (Number.isFinite(expected) && expected >= 0) {
    const r = db.prepare(`
      UPDATE clip_snapshots
      SET name=?, data_json=?, size_bytes=?, thumbnail_fid=?, rev=rev+1, updated_at=?
      WHERE id=? AND rev=?
    `).run(name, payload, Buffer.byteLength(payload), thumbnailFid, Date.now(), id, expected);
    if (!r.changes) {
      throw Object.assign(new Error('云端快照已被其它机器更新，请先拉取最新版本'), {
        status: 409,
        conflict: true,
        rev: Number(cur.rev) || 1,
      });
    }
  } else {
    db.prepare(`
      UPDATE clip_snapshots
      SET name=?, data_json=?, size_bytes=?, thumbnail_fid=?, rev=rev+1, updated_at=?
      WHERE id=?
    `).run(name, payload, Buffer.byteLength(payload), thumbnailFid, Date.now(), id);
  }
  replaceAssets(db, id, assets);
  return getSnapshot(db, id);
}

function deleteSnapshot(db, id) {
  db.prepare('DELETE FROM clip_snapshot_assets WHERE snapshot_id=?').run(id);
  const r = db.prepare('DELETE FROM clip_snapshots WHERE id=?').run(id);
  return r.changes > 0;
}

/**
 * 路由。返回 true 表示已处理。
 * GET    /editor-api/snapshots
 * GET    /editor-api/snapshots/:id
 * POST   /editor-api/snapshots           { name, data, assets }
 * PUT    /editor-api/snapshots/:id       { name, data, assets, rev }
 * DELETE /editor-api/snapshots/:id
 */
async function handleSnapshots(services, req, res, url) {
  const { db } = services;
  ensureSnapshotTables(db);

  const p = url.pathname;
  const match = /^\/editor-api\/snapshots\/([^/]+)$/.exec(p);

  if (p === '/editor-api/snapshots' && req.method === 'GET') {
    sendJson(res, 200, { items: listSnapshots(db) });
    return true;
  }

  if (p === '/editor-api/snapshots' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req, 64 * 1024 * 1024)).toString('utf8') || '{}');
    if (!body.data) throw Object.assign(new Error('缺少工程数据'), { status: 400 });
    const assets = normalizeAssets(body.assets);
    const missing = findMissingAssets(db, assets);
    if (missing.length) {
      throw Object.assign(new Error(`有 ${missing.length} 个素材未入库，请先上传`), {
        status: 400,
        missing,
      });
    }
    const snap = createSnapshot(db, {
      name: String(body.name || '未命名工程').slice(0, 120),
      data: body.data,
      assets,
      thumbnailFid: body.thumbnailFid || null,
    });
    sendJson(res, 200, { snapshot: snap });
    return true;
  }

  if (match) {
    const id = decodeURIComponent(match[1]);
    if (req.method === 'GET') {
      const snap = getSnapshot(db, id);
      if (!snap) sendJson(res, 404, { error: '快照不存在' });
      else sendJson(res, 200, { snapshot: snap });
      return true;
    }
    if (req.method === 'PUT') {
      const body = JSON.parse((await readBody(req, 64 * 1024 * 1024)).toString('utf8') || '{}');
      if (!body.data) throw Object.assign(new Error('缺少工程数据'), { status: 400 });
      const assets = normalizeAssets(body.assets);
      const missing = findMissingAssets(db, assets);
      if (missing.length) {
        throw Object.assign(new Error(`有 ${missing.length} 个素材未入库，请先上传`), {
          status: 400,
          missing,
        });
      }
      const snap = updateSnapshot(db, id, {
        name: String(body.name || '未命名工程').slice(0, 120),
        data: body.data,
        assets,
        rev: body.rev,
        thumbnailFid: body.thumbnailFid || null,
      });
      sendJson(res, 200, { snapshot: snap });
      return true;
    }
    if (req.method === 'DELETE') {
      const ok = deleteSnapshot(db, id);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '快照不存在' });
      return true;
    }
  }

  return false;
}

/** 被剪辑工程引用的素材（供素材库「剪辑素材」页与删除保护使用）。 */
function assetsUsedByProjects(db, fid) {
  ensureSnapshotTables(db);
  return db.prepare(`
    SELECT s.id, s.name, s.updated_at
    FROM clip_snapshot_assets a JOIN clip_snapshots s ON s.id = a.snapshot_id
    WHERE a.fid = ?
    ORDER BY s.updated_at DESC
  `).all(fid);
}

module.exports = {
  ensureSnapshotTables,
  handleSnapshots,
  listSnapshots,
  getSnapshot,
  assetsUsedByProjects,
};
