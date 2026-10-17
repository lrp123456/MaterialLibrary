/**
 * 相册快照直收 (Snapshot Ingest)：
 * 接收 App 推送的相册清单，只用来发现新图并计算 needed_uploads。
 * - live：本次清单命中；
 * - frozen：相册里已不在，快照行保留（永不因相册删除而删条目）；
 * - 库内已有资产的可见性不由本模块改写。
 */

// 48h 有效性口径（与 sync.js 新鲜度保护一致，用于设备状态展示）
const DEVICE_EXPIRED_MS = 48 * 3600 * 1000;

const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|m4v|3gp|wmv)$/i;

// 时间戳归一化：快照字段可能是秒级或毫秒级，< 10^12 视为秒统一乘 1000
function toEpochMs(v) {
  const n = Number(v) || 0;
  if (!n) return 0;
  return n < 1e12 ? n * 1000 : n;
}

// 快照条目键：沿用接收器惯例 `${name}|${size}`（与 sync.js 幽灵判定键一致）
function itemKey(name, size) {
  return `${name}|${Number(size) || 0}`;
}

function mediaKindOf(name) {
  return VIDEO_EXT.test(String(name || '')) ? 'video' : 'image';
}

function ensureSyncEvents(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT,
      event_type TEXT NOT NULL,
      media_kind TEXT NOT NULL DEFAULT 'image',
      name TEXT,
      size INTEGER,
      item_key TEXT,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_events_at ON sync_events(at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_events_type ON sync_events(event_type, at DESC);
    CREATE TABLE IF NOT EXISTS asset_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fid TEXT NOT NULL,
      item_key TEXT NOT NULL,
      client_asset_id TEXT,
      file_name TEXT,
      size INTEGER,
      created_at INTEGER,
      UNIQUE(fid, item_key)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_aliases_key ON asset_aliases(item_key);
    CREATE INDEX IF NOT EXISTS idx_asset_aliases_cid ON asset_aliases(client_asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_aliases_fid ON asset_aliases(fid);
  `);
}

/**
 * 摄入一次全量快照（事务性、幂等，可重复推送）。
 * payload: { device_id, timestamp, app_version, window_days, total_count,
 *            photos: [{ id, name, size, modified, fingerprint }] }
 * 返回 { deviceId, windowDays, received, live, frozen, removed, frozenMarked }
 */
function ingestSnapshot(db, payload, nowMs = Date.now()) {
  const p = payload || {};
  const deviceId = String(p.device_id || '').trim();
  if (!deviceId || deviceId.length > 128) throw new Error('缺少有效的 device_id');
  if (!Array.isArray(p.photos)) throw new Error('缺少 photos 数组');
  if (p.photos.length > 200000) throw new Error('photos 数量超限 (200000)');

  ensureSyncEvents(db);

  const run = db.transaction(() => {
    const now = nowMs;

    // 1. 设备 upsert；window_days 缺省时沿用设备历史值，全新设备默认 3 天（与快照统计范围/72h 冻结对齐）
    const prev = db.prepare('SELECT window_days FROM snapshot_devices WHERE device_id = ?').get(deviceId);
    let windowDays;
    if (Number.isFinite(Number(p.window_days))) {
      windowDays = Math.max(0, Math.floor(Number(p.window_days)));
    } else {
      windowDays = prev ? prev.window_days : 3;
    }
    db.prepare(`
      INSERT INTO snapshot_devices
        (device_id, app_version, window_days, total_count, first_seen_at, last_push_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        app_version=excluded.app_version, window_days=excluded.window_days,
        total_count=excluded.total_count, last_push_at=excluded.last_push_at
    `).run(deviceId, String(p.app_version || ''), windowDays, p.photos.length, now, now);

    // 2. 本次清单键集（同名同尺寸自动去重，后写覆盖）
    const incoming = new Map();
    for (const ph of p.photos) {
      const name = String(ph?.name || '').trim();
      if (!name) continue;
      incoming.set(itemKey(name, ph?.size), ph);
    }

    const prevItems = db.prepare(
      'SELECT item_key, name, size, state, modified FROM snapshot_items WHERE device_id = ?'
    ).all(deviceId);
    const prevKeys = new Set(prevItems.map((r) => r.item_key));

    const insEvent = db.prepare(
      `INSERT INTO sync_events (device_id, event_type, media_kind, name, size, item_key, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    // 3. 逐条 upsert：命中清单 → live（frozen 项复活亦回 live）
    const upsert = db.prepare(`
      INSERT INTO snapshot_items
        (device_id, item_key, name, size, modified, fingerprint, state, first_seen_at, last_seen_at, frozen_at)
      VALUES (?, ?, ?, ?, ?, ?, 'live', ?, ?, NULL)
      ON CONFLICT(device_id, item_key) DO UPDATE SET
        name=excluded.name, size=excluded.size, modified=excluded.modified,
        fingerprint=excluded.fingerprint, state='live',
        last_seen_at=excluded.last_seen_at, frozen_at=NULL
    `);
    for (const [key, ph] of incoming) {
      const name = String(ph.name);
      const size = Number(ph.size) || 0;
      const isNew = !prevKeys.has(key);
      upsert.run(deviceId, key, name, size,
        toEpochMs(ph.modified) || null, String(ph.fingerprint || ''), now, now);
      if (isNew) {
        insEvent.run(deviceId, 'added', mediaKindOf(name), name, size, key, now);
      }
    }

    // 4. 未命中清单的存量条目：只冻结、不删除（相册消失不得传导到素材库）
    const existing = db.prepare('SELECT item_key, name, size, state, modified FROM snapshot_items WHERE device_id = ?').all(deviceId);
    const freezeStmt = db.prepare("UPDATE snapshot_items SET state='frozen', frozen_at=? WHERE device_id=? AND item_key=?");
    let removed = 0;
    let frozenMarked = 0;
    for (const row of existing) {
      if (incoming.has(row.item_key)) continue;
      if (row.state !== 'frozen') {
        freezeStmt.run(now, deviceId, row.item_key);
        frozenMarked++;
        insEvent.run(deviceId, 'frozen', mediaKindOf(row.name), row.name, Number(row.size) || 0, row.item_key, now);
      }
    }

    // 保留最近 2000 条事件，避免无限增长
    db.prepare(`
      DELETE FROM sync_events WHERE id NOT IN (
        SELECT id FROM sync_events ORDER BY at DESC, id DESC LIMIT 2000
      )
    `).run();

    // 5. 对账：计算哪些条目在 assets 库中尚未落地原文件，需要手机端补传
    // 增强：sha256/client_id/黑名单；避免「同图不同名」被重复索要
    const { isBlacklisted } = require('./assets-delete');
    let existingAssets = [];
    try {
      existingAssets = db.prepare(
        "SELECT file_name, size, client_asset_id, sha256, fid, status FROM assets WHERE status IS NULL OR status != 'deleted'"
      ).all();
    } catch (_) {
      existingAssets = db.prepare(
        "SELECT file_name, size, client_asset_id FROM assets"
      ).all();
    }
    const knownKeys = new Set(existingAssets.map(a => `${a.file_name}|${Number(a.size) || 0}`));
    const knownClientIds = new Set(existingAssets.map(a => String(a.client_asset_id || '')).filter(Boolean));
    const knownSha = new Set(existingAssets.map(a => String(a.sha256 || '')).filter(Boolean));
    // 衍生图指纹（origin / restage_9_16 / restage_3_4）也算已入库，避免 9:16 导出再被索要
    try {
      const dsha = db.prepare('SELECT sha256, md5 FROM derivatives WHERE sha256 IS NOT NULL OR md5 IS NOT NULL').all();
      for (const d of dsha) {
        if (d.sha256) knownSha.add(String(d.sha256));
        if (d.md5) knownSha.add(String(d.md5));
      }
    } catch (_) {}

    // 合并 asset_aliases 多别名映射（同哈希副本多名称/多ID对账）
    try {
      const aliases = db.prepare("SELECT item_key, client_asset_id FROM asset_aliases").all();
      for (const al of aliases) {
        if (al.item_key) knownKeys.add(al.item_key);
        if (al.client_asset_id) knownClientIds.add(String(al.client_asset_id));
      }
    } catch (_) {}

    const neededUploads = [];
    let skippedBlacklist = 0;
    let skippedKnown = 0;
    for (const [key, ph] of incoming) {
      const clientId = String(ph.id || '');
      const fp = String(ph.fingerprint || '');
      if (knownKeys.has(key) || (clientId && knownClientIds.has(clientId)) || (fp && knownSha.has(fp))) {
        skippedKnown++;
        continue;
      }
      // 全局黑名单：删除过的素材再次同步也不索要
      if (isBlacklisted(db, { itemKey: key, clientAssetId: clientId, sha256: fp })) {
        skippedBlacklist++;
        continue;
      }
      neededUploads.push({
        id: ph.id || '',
        name: ph.name || '',
        size: Number(ph.size) || 0,
        modified: toEpochMs(ph.modified) || 0,
        fingerprint: String(ph.fingerprint || '')
      });
    }

    try {
      console.log(`[snapshot] device=${deviceId} incoming=${incoming.size} skip_known=${skippedKnown} skip_blacklist=${skippedBlacklist} needed=${neededUploads.length}`);
    } catch (_) {}

    const cnt = db.prepare(`
      SELECT COALESCE(SUM(state='live'), 0) AS live, COALESCE(SUM(state='frozen'), 0) AS frozen
      FROM snapshot_items WHERE device_id = ?
    `).get(deviceId);

    return {
      deviceId, windowDays,
      received: incoming.size,
      live: cnt.live, frozen: cnt.frozen,
      removed, frozenMarked,
      needed_uploads: neededUploads,
      needed_count: neededUploads.length
    };

  });
  return run();
}


/**
 * 管理端同步看板：上次同步 + 最近变更（新增/移除/冻结 × 图/视频）。
 */
function getSyncDashboard(db, { limit = 50, deviceId = '' } = {}) {
  ensureSyncEvents(db);
  const now = Date.now();
  const devices = getSnapshotDevices(db, now);
  const lastDevice = devices[0] || null;

  let eventSql = `
    SELECT id, device_id, event_type, media_kind, name, size, at
    FROM sync_events
  `;
  const args = [];
  if (deviceId) {
    eventSql += ' WHERE device_id = ?';
    args.push(deviceId);
  }
  eventSql += ' ORDER BY at DESC, id DESC LIMIT ?';
  args.push(Math.min(500, Math.max(1, limit)));

  const events = db.prepare(eventSql).all(...args).map((r) => ({
    id: r.id,
    deviceId: r.device_id || '',
    type: r.event_type,
    kind: r.media_kind,
    name: r.name || '',
    size: r.size || 0,
    at: r.at,
  }));

  const countWhere = (type, kind) => {
    let sql = 'SELECT COUNT(*) c FROM sync_events WHERE event_type=? AND media_kind=?';
    const a = [type, kind];
    if (deviceId) {
      sql += ' AND device_id=?';
      a.push(deviceId);
    }
    return db.prepare(sql).get(...a).c;
  };

  return {
    now,
    lastSync: lastDevice,
    devices,
    summary: {
      addedImages: countWhere('added', 'image'),
      addedVideos: countWhere('added', 'video'),
      removedImages: countWhere('removed', 'image'),
      removedVideos: countWhere('removed', 'video'),
      frozenImages: countWhere('frozen', 'image'),
      frozenVideos: countWhere('frozen', 'video'),
    },
    events,
  };
}

/**
 * 跨设备 live∪frozen 并集键集（幽灵过滤数据源）。
 * 返回 Set<`${name}|${size}`>；尚无任何设备推送过快照时返回 null（调用方 fail-open 不过滤）。
 */
function getSnapshotKeySet(db) {
  const has = db.prepare('SELECT COUNT(*) c FROM snapshot_devices').get().c;
  if (!has) return null;
  const rows = db.prepare("SELECT item_key FROM snapshot_items WHERE state IN ('live','frozen')").all();
  return new Set(rows.map(r => r.item_key));
}

/**
 * 设备清单（/snapshot-status 展示用）：含 live/frozen 计数、最近推送时间与 48h 有效性。
 * 字段命名与原外部接收器 /api/devices 对齐（last_seen/expired），web 端零改动兼容。
 */
function getSnapshotDevices(db, nowMs = Date.now()) {
  return db.prepare(`
    SELECT sd.device_id, sd.app_version, sd.window_days, sd.total_count, sd.last_push_at,
      (SELECT COUNT(*) FROM snapshot_items si WHERE si.device_id = sd.device_id AND si.state = 'live') AS live_count,
      (SELECT COUNT(*) FROM snapshot_items si WHERE si.device_id = sd.device_id AND si.state = 'frozen') AS frozen_count
    FROM snapshot_devices sd
    ORDER BY sd.last_push_at DESC
  `).all().map(d => ({
    device_id: d.device_id,
    app_version: d.app_version || '',
    window_days: d.window_days,
    total_count: d.total_count,
    live_count: d.live_count,
    frozen_count: d.frozen_count,
    last_push_at: Number(d.last_push_at) || 0,
    last_seen: d.last_push_at ? new Date(d.last_push_at).toLocaleString('zh-CN', { hour12: false }) : '',
    expired: !d.last_push_at || (nowMs - d.last_push_at) > DEVICE_EXPIRED_MS
  }));
}

module.exports = { ingestSnapshot, getSnapshotKeySet, getSnapshotDevices, getSyncDashboard, toEpochMs, itemKey };
