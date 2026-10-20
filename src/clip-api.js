/**
 * 剪辑板块新增接口的统一入口与鉴权。
 *
 * 挂载点：server.js 在 /editor-api 分支里，先交给本模块，
 * 未命中的路径再落到原来的 editor-projects。
 *
 * 路由分组：
 *   /editor-api/snapshots*   云端快照
 *   /editor-api/packs*       声明式资源包
 *   /editor-api/ai/*         AI 任务
 *   /editor-api/clip-assets* 剪辑素材库视图
 */
const { handleSnapshots, ensureSnapshotTables } = require('./clip-snapshots');
const { handlePacks } = require('./clip-packs');
const { handleAiJobs } = require('./clip-ai');

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function clipAssetsList(db, { limit = 60, offset = 0 } = {}) {
  ensureSnapshotTables(db);
  const rows = db.prepare(`
    SELECT a.fid, a.file_name, a.kind, a.width, a.height, a.duration_s AS duration,
           a.thumb_url, a.size, a.updated_at,
           COUNT(cs.snapshot_id) AS used_by
    FROM assets a
    JOIN clip_snapshot_assets cs ON cs.fid = a.fid
    GROUP BY a.fid
    ORDER BY used_by DESC, a.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(Math.min(200, Math.max(1, limit)), Math.max(0, offset));
  const total = db.prepare(`
    SELECT COUNT(DISTINCT fid) AS c FROM clip_snapshot_assets
  `).get().c;
  return { items: rows, total: Number(total) || 0 };
}

async function handleClipApi(services, req, res) {
  const { db } = services;
  const auth = require('./auth');
  const url = new URL(req.url, 'http://127.0.0.1');
  const token = String(req.headers.authorization || '').startsWith('Bearer ')
    ? String(req.headers.authorization).slice(7).trim()
    : '';
  // SEC-001：已移除免密内部会话，剪辑接口一律真实登录。
  const user = auth.verifySession(db, token);
  if (!user) {
    sendJson(res, 401, { error: '需要登录' });
    return true;
  }

  const p = url.pathname;
  try {
    if (p.startsWith('/editor-api/snapshots')) {
      if (await handleSnapshots(services, req, res, url)) return true;
    }
    if (p.startsWith('/editor-api/packs')) {
      if (await handlePacks(services, req, res, url)) return true;
    }
    if (p.startsWith('/editor-api/ai/')) {
      if (await handleAiJobs(services, req, res, url)) return true;
    }
    if (p === '/editor-api/clip-assets' && req.method === 'GET') {
      const data = clipAssetsList(db, {
        limit: Number(url.searchParams.get('limit')) || 60,
        offset: Number(url.searchParams.get('offset')) || 0,
      });
      sendJson(res, 200, data);
      return true;
    }
    if (p === '/editor-api/clip-assets/usage' && req.method === 'GET') {
      const { assetsUsedByProjects } = require('./clip-snapshots');
      const fid = String(url.searchParams.get('fid') || '');
      if (!fid) { sendJson(res, 400, { error: '缺少 fid' }); return true; }
      sendJson(res, 200, { items: assetsUsedByProjects(db, fid) });
      return true;
    }
  } catch (e) {
    const status = e.status || 500;
    if (!res.headersSent) {
      sendJson(res, status, {
        error: e.message || String(e),
        ...(e.conflict ? { conflict: true, rev: e.rev } : {}),
        ...(e.missing ? { missing: e.missing } : {}),
      });
    }
    return true;
  }

  // 未命中：交回 editor-projects（工程读写、导出帧等）
  return false;
}

module.exports = { handleClipApi };
