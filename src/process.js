/**
 * 按需快捷处理：预设注册 + 统一网关任务编排 + 视频分批解冻。
 * 任务落在 node_runs(node_type='process')，由独立 worker 消费，不进入默认工作流 DAG。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { executeAdapter, getNested } = require('./gen');

const PROCESS_NODE_TYPE = 'process';
const WORKER_INTERVAL_MS = 2000;
const UNFREEZE_BATCH = 50;
const PROCESS_CONCURRENCY = Math.max(1, Math.floor(Number(process.env.ML_PROCESS_CONCURRENCY || 3)) || 3);

function getGatewayAdapter(db) {
  return db.prepare("SELECT * FROM gen_adapters WHERE id='unified_gateway' AND enabled=1").get() || null;
}

function isGatewayConfigured(adapter) {
  if (!adapter) return false;
  const base = adapter.base_url || '';
  return Boolean(base) && !base.includes('UNCONFIGURED');
}

function listPresets(db, { includeDisabled = false } = {}) {
  const sql = includeDisabled
    ? 'SELECT * FROM presets ORDER BY sort ASC, id ASC'
    : 'SELECT * FROM presets WHERE enabled=1 ORDER BY sort ASC, id ASC';
  return db.prepare(sql).all().map(r => ({
    id: r.id,
    label: r.label,
    action: r.action,
    params: JSON.parse(r.params_json || '{}'),
    builtin: !!r.builtin,
    enabled: !!r.enabled,
    sort: r.sort
  }));
}

function upsertPreset(db, p) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO presets (id, label, action, params_json, builtin, enabled, sort, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label=excluded.label, action=excluded.action, params_json=excluded.params_json,
      enabled=excluded.enabled, sort=excluded.sort, updated_at=excluded.updated_at
  `).run(p.id, p.label, p.action, JSON.stringify(p.params || {}), p.builtin ? 1 : 0,
    p.enabled === false ? 0 : 1, p.sort || 0, now, now);
}

function deletePreset(db, id) {
  const row = db.prepare('SELECT builtin FROM presets WHERE id=?').get(id);
  if (!row) return false;
  if (row.builtin) throw new Error('内置预设不可删除，可改为 enabled=0');
  db.prepare('DELETE FROM presets WHERE id=?').run(id);
  return true;
}

function resolveProcessRequest(db, { presetId, action, params }) {
  if (presetId) {
    const preset = db.prepare('SELECT * FROM presets WHERE id=? AND enabled=1').get(presetId);
    if (!preset) throw new Error(`预设不存在或已禁用: ${presetId}`);
    return {
      presetId: preset.id,
      action: preset.action,
      params: { ...JSON.parse(preset.params_json || '{}'), ...(params || {}) }
    };
  }
  if (!action) throw new Error('缺少 preset_id 或 action');
  const allowed = ['outpaint', 'ratio_convert', 'watermark_remove', 'upscale', 'video_transcode', 'video_frames', 'video_generate'];
  if (!allowed.includes(action)) throw new Error(`不支持的 action: ${action}`);
  return { presetId: null, action, params: params || {} };
}

function enqueueProcessJob(db, { assetFid, presetId, action, params, createdBy = 'viewer' }) {
  const asset = db.prepare('SELECT fid, kind, file_name FROM assets WHERE fid=?').get(assetFid);
  if (!asset) throw new Error('资产不存在');
  const resolved = resolveProcessRequest(db, { presetId, action, params });
  const now = Date.now();
  const payload = {
    action: resolved.action,
    params: resolved.params,
    preset_id: resolved.presetId,
    created_by: createdBy,
    fid: assetFid
  };
  const runId = `process_${now}_${crypto.randomBytes(3).toString('hex')}`;
  const nodeId = `adhoc_${resolved.action}_${now}_${crypto.randomBytes(2).toString('hex')}`;
  const info = db.prepare(`
    INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, input_summary, created_at, updated_at)
    VALUES (?, 0, ?, ?, ?, 'queued', ?, ?, ?)
  `).run(
    runId,
    nodeId,
    PROCESS_NODE_TYPE,
    assetFid,
    JSON.stringify(payload),
    now,
    now
  );
  return getProcessJob(db, info.lastInsertRowid);
}

function getProcessJob(db, id) {
  const r = db.prepare(`
    SELECT nr.*, a.file_name, a.kind AS asset_kind
    FROM node_runs nr
    LEFT JOIN assets a ON a.fid = nr.asset_fid
    WHERE nr.id=?
  `).get(id);
  if (!r) return null;
  let input = {};
  try { input = JSON.parse(r.input_summary || '{}'); } catch {}
  let output = {};
  try { output = JSON.parse(r.output_summary || '{}'); } catch {}
  return {
    id: r.id,
    runId: r.run_id,
    assetFid: r.asset_fid,
    fileName: r.file_name || '',
    nodeType: r.node_type,
    status: r.status,
    progress: r.progress == null ? (r.status === 'done' ? 100 : 0) : r.progress,
    action: input.action || '',
    params: input.params || {},
    presetId: input.preset_id || null,
    derivativeId: r.derivative_id || output.derivativeId || null,
    error: r.error || output.error || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    durationMs: r.duration_ms || null
  };
}

function listProcessJobs(db, assetFid, { limit = 20 } = {}) {
  const rows = db.prepare(`
    SELECT id FROM node_runs
    WHERE asset_fid=? AND node_type=?
    ORDER BY id DESC LIMIT ?
  `).all(assetFid, PROCESS_NODE_TYPE, limit);
  return rows.map(r => getProcessJob(db, r.id)).filter(Boolean);
}

function localOriginPath(config, asset) {
  const origDir = path.join(config.dataDir, 'cache', 'originals');
  const ext = path.extname(asset.file_name || '.jpg') || '.jpg';
  const p = path.join(origDir, `${asset.fid}${ext}`);
  return fs.existsSync(p) ? p : null;
}

/**
 * 执行一个 process 任务：提交统一网关 → 轮询 → 落盘 derivative。
 */
async function executeProcessJob(services, jobRow) {
  const { db, config, logger } = services;
  const adapter = getGatewayAdapter(db);
  if (!isGatewayConfigured(adapter)) {
    db.prepare("UPDATE node_runs SET status='failed', error=?, updated_at=? WHERE id=?")
      .run('统一处理网关未配置（gen_adapters.unified_gateway.base_url）', Date.now(), jobRow.id);
    return { success: false, error: 'gateway_unconfigured' };
  }

  const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(jobRow.asset_fid);
  if (!asset) {
    db.prepare("UPDATE node_runs SET status='failed', error='资产不存在', updated_at=? WHERE id=?")
      .run(Date.now(), jobRow.id);
    return { success: false, error: 'asset_missing' };
  }

  let input = {};
  try { input = JSON.parse(jobRow.input_summary || '{}'); } catch {}
  const action = input.action;
  const params = input.params || {};

  const originPath = localOriginPath(config, asset);
  if (!originPath && action !== 'video_generate') {
    db.prepare("UPDATE node_runs SET status='failed', error='原图未落盘，请先完成 materialize', updated_at=? WHERE id=?")
      .run(Date.now(), jobRow.id);
    return { success: false, error: 'origin_missing' };
  }

  db.prepare("UPDATE node_runs SET status='running', progress=5, updated_at=? WHERE id=?")
    .run(Date.now(), jobRow.id);

  try {
    const setProgress = (p) => {
      const v = Math.max(5, Math.min(99, Math.round(Number(p) || 0)));
      db.prepare('UPDATE node_runs SET progress=?, updated_at=? WHERE id=?').run(v, Date.now(), jobRow.id);
    };
    const res = await executeAdapter(services, adapter, {
      kind: asset.kind === 'video' || String(action).startsWith('video') ? 'video' : 'image',
      imageLocalPaths: originPath ? [originPath] : [],
      prompt: params.prompt || '',
      extras: {
        action,
        params,
        fid: asset.fid,
        file_name: asset.file_name
      },
      timeoutMs: 300000,
      onProgress: setProgress
    });

    if (!res.ok || !res.files?.[0]?.localPath) {
      throw new Error(res.error || '网关未返回产物');
    }

    const srcPath = res.files[0].localPath;
    const { createDerivative } = require('./derivatives');
    const kind = action === 'watermark_remove' ? 'clean'
      : action === 'upscale' ? 'upscale'
      : action === 'ratio_convert' ? `ratio_${String(params.target || '').replace(':', '_')}`
      : action === 'outpaint' ? 'outpaint'
      : action === 'video_frames' ? 'poster'
      : action;

    const deriv = await createDerivative(services, {
      assetFid: asset.fid,
      kind,
      srcPath,
      fileName: `${action}_${asset.file_name || 'out'}`,
      mime: res.files[0].mime || (kind === 'poster' ? 'image/jpeg' : 'image/jpeg'),
      params: { action, presetId: input.preset_id || null, gatewayTaskId: res.taskId || null, ...params }
    });

    db.prepare(`
      UPDATE node_runs SET status='done', progress=100, derivative_id=?, output_summary=?, error=NULL, duration_ms=?, updated_at=?
      WHERE id=?
    `).run(
      deriv.id,
      JSON.stringify({ derivativeId: deriv.id, action, taskId: res.taskId || null }),
      Date.now() - jobRow.created_at,
      Date.now(),
      jobRow.id
    );
    logger?.info?.(`[process] 资产 ${asset.fid} ${action} 完成 → derivative #${deriv.id}`);
    return { success: true, derivative: deriv };
  } catch (e) {
    db.prepare("UPDATE node_runs SET status='failed', error=?, updated_at=? WHERE id=?")
      .run(String(e.message || e), Date.now(), jobRow.id);
    logger?.warn?.(`[process] 资产 ${asset.fid} ${action} 失败: ${e.message}`);
    return { success: false, error: e.message };
  }
}

class ProcessWorker {
  constructor(services) {
    this.services = services;
    this.timer = null;
    this.active = 0;
    this.concurrency = PROCESS_CONCURRENCY;
  }

  start(intervalMs = WORKER_INTERVAL_MS) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(e => this.services.logger?.warn?.(`[process-worker] ${e.message}`));
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    while (this.active < this.concurrency) {
      const { db } = this.services;
      let job = null;
      try {
        const claim = db.transaction(() => {
          const row = db.prepare(`
            SELECT * FROM node_runs
            WHERE node_type=? AND status='queued'
            ORDER BY id ASC LIMIT 1
          `).get(PROCESS_NODE_TYPE);
          if (row) {
            db.prepare("UPDATE node_runs SET status='running', updated_at=? WHERE id=?")
              .run(Date.now(), row.id);
            job = row;
          }
        });
        claim();
      } catch (e) {
        this.services.logger?.warn?.(`[process-worker] claim ${e.message}`);
        return;
      }
      if (!job) return;
      this.active++;
      Promise.resolve()
        .then(() => executeProcessJob(this.services, job))
        .catch(e => this.services.logger?.warn?.(`[process-worker] ${e.message}`))
        .finally(() => {
          this.active--;
        });
    }
  }
}

/**
 * 视频分批解冻：不再把视频改回 discovered 去挤图片队列。
 * 存量 frozen 视频直接标记为 ready 可播放。
 */
function unfreezeVideos(db, limit = UNFREEZE_BATCH) {
  try {
    const r = db.prepare(`
      UPDATE assets SET status='ready', updated_at=?
      WHERE kind='video' AND status='frozen'
    `).run(Date.now());
    return r.changes || 0;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  PROCESS_NODE_TYPE,
  listPresets,
  upsertPreset,
  deletePreset,
  enqueueProcessJob,
  getProcessJob,
  listProcessJobs,
  executeProcessJob,
  ProcessWorker,
  unfreezeVideos,
  getGatewayAdapter,
  isGatewayConfigured
};
