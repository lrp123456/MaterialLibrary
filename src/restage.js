/**
 * 合格 AI 重构判定、列表封面选取、缺图扫描。
 * 9:16/3:4 对外成品必须是 Agnes 图生图，禁止 origin / 本地 contain 垫边冒充。
 */

function parseDerivativeParams(d) {
  if (!d) return {};
  if (d.params && typeof d.params === 'object' && !Buffer.isBuffer(d.params) && !Array.isArray(d.params)) {
    return d.params;
  }
  if (typeof d.params === 'string' && d.params) {
    try { return JSON.parse(d.params); } catch { return {}; }
  }
  return {};
}

function isQualifiedAgnes(d) {
  if (!d || !String(d.kind || '').startsWith('restage_')) return false;
  const p = parseDerivativeParams(d);
  if (p.recast) return false;
  if (p.composed && p.generated !== true) return false;
  return p.generated === true;
}

function findQualifiedKind(list, kind) {
  const hits = (list || []).filter(d => d.kind === kind && isQualifiedAgnes(d));
  return hits.length ? hits[hits.length - 1] : null;
}

function pickBrowseMain(derivs, { orientation } = {}) {
  const list = derivs || [];
  const origin = list.find(d => d.kind === 'origin') || null;
  const q916 = findQualifiedKind(list, 'restage_9_16');
  const q34 = findQualifiedKind(list, 'restage_3_4');
  if (orientation === '9:16') return q916 || origin;
  if (orientation === '3:4') return q34 || origin;
  return q916 || origin;
}

function isQueueFullError(err) {
  const m = String(err?.message || err || '');
  return /HTTP 503|HTTP 429|queue is full|image queue/i.test(m);
}

function nextRestageBackoff(prevError) {
  const s = String(prevError || '');
  const m = s.match(/attempt=(\d+)/);
  const n = m ? Number(m[1]) + 1 : 1;
  // 限流/排队满时放大退避，避免 8s 紧循环打爆免费额度
  const rateLimited = /429|rate.?limit|queue is full|image queue/i.test(s);
  const base = rateLimited ? 20000 : 8000;
  const ms = Math.min(180000, base * (2 ** Math.min(n - 1, 4)));
  return { attempt: n, ms };
}

function restageQueueRow(db, fid) {
  if (!fid) return null;
  return db.prepare(`
    SELECT id, status, error, not_before, updated_at, run_id
    FROM node_runs
    WHERE asset_fid = ? AND node_type IN ('restage_dual', 'restage_9_16')
    ORDER BY id DESC LIMIT 1
  `).get(fid) || null;
}

function slotStatusFromQueue(hasQualified, queueRow) {
  if (hasQualified) return 'ready';
  const st = queueRow?.status;
  if (st === 'running') return 'running';
  if (st === 'queued') return 'queued';
  if (st === 'failed') return 'failed';
  return 'missing';
}

function restageStatusForAsset(db, asset, derivatives) {
  const list = derivatives || [];
  const q916 = !!findQualifiedKind(list, 'restage_9_16');
  const q34 = !!findQualifiedKind(list, 'restage_3_4');
  // CONFLICT-002：重复组退役，血缘归属就是素材本身
  const queueFid = asset.fid;
  const queue = restageQueueRow(db, queueFid);
  return {
    restage_9_16: slotStatusFromQueue(q916, queue),
    restage_3_4: slotStatusFromQueue(q34, queue),
    queueFid,
    queueStatus: queue?.status || null,
    queueError: queue?.error || null
  };
}

const T_BACKLOG_DEADLINE = 1789056000000; // 2026-09-11 00:00:00+08:00

function isBacklogOriginAsset(asset) {
  if (!asset) return false;
  if (asset.source !== 'quark' && !String(asset.fid || '').startsWith('~')) return false;
  const match = (asset.file_name || '').match(/mmexport(\d{10,13})/i);
  let fileTime = null;
  if (match) {
    let t = Number(match[1]);
    if (match[1].length === 10) t *= 1000;
    fileTime = t;
  } else {
    fileTime = asset.discovered_at || asset.created_at;
  }
  return Number(fileTime) < T_BACKLOG_DEADLINE;
}

function listAssetsNeedingRestage(db, limit = 2000) {
  const rows = db.prepare(`
    SELECT a.fid, a.source, a.file_name, a.discovered_at, a.created_at
    FROM assets a
    WHERE a.kind = 'image'
      AND a.status = 'ready'
      AND a.fid NOT IN (
        SELECT asset_fid FROM node_runs
        WHERE node_type IN ('restage_dual', 'restage_9_16')
          AND status IN ('queued', 'running')
      )
    ORDER BY a.updated_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(5000, +limit || 2000)));

  const derivStmt = db.prepare('SELECT kind, params FROM derivatives WHERE asset_fid = ?');
  const fids = [];
  for (const r of rows) {
    if (isBacklogOriginAsset(r)) continue; // 排除历史积压资产，避免补跑 Agnes
    const derivs = derivStmt.all(r.fid);
    const has916 = findQualifiedKind(derivs, 'restage_9_16');
    const has34 = findQualifiedKind(derivs, 'restage_3_4');
    if (has916 && has34) continue;
    fids.push(r.fid);
  }
  return fids;
}

function resetUnqualifiedMains(db) {
  const rows = db.prepare(`
    SELECT a.fid, a.main_derivative_id, d.kind, d.params
    FROM assets a
    JOIN derivatives d ON d.id = a.main_derivative_id
    WHERE d.kind LIKE 'restage_%'
  `).all();
  let changed = 0;
  const upd = db.prepare('UPDATE assets SET main_derivative_id = ?, updated_at = ? WHERE fid = ?');
  const q916Stmt = db.prepare("SELECT id, kind, params FROM derivatives WHERE asset_fid=? AND kind='restage_9_16' ORDER BY id ASC");
  const originStmt = db.prepare("SELECT id FROM derivatives WHERE asset_fid=? AND kind='origin' LIMIT 1");
  const now = Date.now();
  for (const row of rows) {
    if (row.kind === 'restage_9_16' && isQualifiedAgnes(row)) continue;
    const q916 = findQualifiedKind(q916Stmt.all(row.fid), 'restage_9_16');
    const origin = originStmt.get(row.fid);
    const next = q916?.id || origin?.id || null;
    if (next && next !== row.main_derivative_id) {
      upd.run(next, now, row.fid);
      changed++;
    }
  }
  return changed;
}

function patchSkipIfAlreadyExact(db) {
  const wf = db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get();
  if (!wf?.graph_json) return false;
  let g;
  try { g = JSON.parse(wf.graph_json); } catch { return false; }
  let changed = false;
  for (const n of g.nodes || []) {
    if (n.type === 'restage_dual') {
      n.config = n.config || {};
      if (n.config.skipIfAlreadyExact !== false) {
        n.config.skipIfAlreadyExact = false;
        changed = true;
      }
    }
  }
  if (changed) {
    db.prepare('UPDATE workflows SET graph_json=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(g), Date.now(), 'default');
  }
  return changed;
}

module.exports = {
  parseDerivativeParams,
  isQualifiedAgnes,
  findQualifiedKind,
  pickBrowseMain,
  isQueueFullError,
  nextRestageBackoff,
  restageQueueRow,
  restageStatusForAsset,
  listAssetsNeedingRestage,
  resetUnqualifiedMains,
  patchSkipIfAlreadyExact
};
