/**
 * gen_jobs 后台任务 worker。
 *
 * - CONCURRENCY=2 的 Promise 池，不复用 ai_tasks 的单 busy + LIMIT 1 串行 worker；
 * - 用 UPDATE ... WHERE status='queued' 原子认领（changes===1 才执行）；
 * - 启动时回收超 15min 的 running 僵尸（attempt+1，超 3 次直接 failed）；
 * - 状态机：queued -> running -> succeeded | failed | cancelled；
 * - 成功后写 result_json + 按 session_id/user_id 落一条 assistant 消息 + 广播 TASK_UPDATED；
 * - 失败后写 error_json（保留 upstreamStatus/requestId）+ 同样广播。
 */
'use strict';

const crypto = require('crypto');
const { eventBus, EVENTS } = require('./events');
const { getGenJob } = require('./gen-jobs');
const { runGeneration } = require('./gen-submit');

const CONCURRENCY = 2;
const STALE_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const TICK_MS = 1500;

function modalityMode(modality) {
  if (modality === 'video') return 'text_to_video';
  if (modality === 'music') return 'music';
  if (modality === 'chat') return 'chat';
  return 'text_to_image';
}

function normalizeError(e) {
  const upstreamStatus = Number(e && (e.status || e.statusCode)) || null;
  return {
    message: (e && e.message) || '生成失败',
    code: (e && e.code) || 'generation_failed',
    upstreamStatus,
    requestId: (e && (e.requestId || e.request_id)) || null,
  };
}

/** 把执行结果归一化成前端 fetchChatMessages 能直接渲染的结果卡形状。 */
function buildResult(result, payload) {
  const r = result && typeof result === 'object' ? result : {};
  const files = Array.isArray(r.files) ? r.files : [];
  const pickUrl = (kind) => {
    for (const f of files) {
      if (!f || typeof f !== 'object') continue;
      const mime = String(f.mime || f.type || '');
      const k = String(f.kind || '');
      const hit = kind === 'image'
        ? (mime.startsWith('image/') || k === 'image')
        : kind === 'video'
          ? (mime.startsWith('video/') || k === 'video')
          : (mime.startsWith('audio/') || k === 'audio');
      if (hit) return f.previewUrl || f.url || f.localPath || null;
    }
    return null;
  };
  const p = payload || {};
  return {
    ...r,
    files,
    imageUrl: r.imageUrl || pickUrl('image'),
    videoUrl: r.videoUrl || pickUrl('video'),
    audioUrl: r.audioUrl || pickUrl('audio'),
    model: r.model || p.model || '',
    modelKey: p.model || '',
    userPrompt: p.prompt || '',
    refs: Array.isArray(p.refs) ? p.refs : (p.imageUrls || p.image ? (p.imageUrls || [p.image]) : []),
    ratio: p.ratio || (p.params && p.params.ratio) || '',
    resolution: p.size || p.resolution || (p.params && p.params.resolution) || '',
    duration: p.duration || p.durationSec || p.seconds || null,
    // 完整参数快照：刷新后 fetchChatMessages 的 m.params / m.result 都能还原
    params: p,
  };
}

function broadcast(db, jobId, status, result, error) {
  const payload = {
    jobId,
    taskId: jobId,
    type: 'gen_job',
    status,
    result: result || null,
    error: error || null,
  };
  try {
    eventBus.emit(EVENTS.TASK_UPDATED, payload);
  } catch (e) {
    console.warn('[gen-jobs] 事件总线派发失败:', e.message);
  }
  try {
    const ws = require('./ws-server');
    if (ws && typeof ws.broadcast === 'function') ws.broadcast(EVENTS.TASK_UPDATED, payload);
  } catch (_) {}
}

/** 按 session_id + user_id 落一条 assistant 结果消息，供前端刷新后直接看到结果卡。 */
function writeAssistantMessage(db, row, result) {
  if (!row.session_id) return;
  const now = Date.now();
  const id = 'msg_' + now.toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  const paramsJson = JSON.stringify(result.params || {});
  try {
    db.prepare(`
      INSERT INTO chat_messages (
        id, session_id, user_id, role, mode, prompt, params_json, images_json,
        status, run_id, engine, result_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'assistant', ?, '', ?, '[]', 'done', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      id,
      row.session_id,
      row.user_id,
      modalityMode(row.modality),
      paramsJson,
      row.job_id,
      row.model || '',
      JSON.stringify(result),
      now,
      now,
    );
  } catch (e) {
    console.warn('[gen-jobs] 写回 assistant 消息失败:', e.message);
    return;
  }
  // 会话 updated_at 与 params_json 快照（列缺失时静默跳过，不影响主流程）
  try {
    db.prepare('UPDATE chat_sessions SET updated_at=?, params_json=COALESCE(?, params_json) WHERE id=?')
      .run(now, paramsJson, row.session_id);
  } catch (_) {}
}

function createGenJobsWorker(services) {
  const { db } = services;
  let timer = null;
  let active = 0;
  let pumping = false;
  let stopped = false;

  /** 启动回收：running 超 15min 视为僵尸。 */
  function recoverZombies() {
    let rows = [];
    try {
      rows = db.prepare("SELECT job_id, attempt FROM gen_jobs WHERE status='running' AND started_at < ?")
        .all(Date.now() - STALE_MS);
    } catch (_) {
      return;
    }
    for (const r of rows) {
      const nextAttempt = Number(r.attempt || 0) + 1;
      try {
        if (nextAttempt > MAX_ATTEMPTS) {
          db.prepare("UPDATE gen_jobs SET status='failed', error_json=?, updated_at=?, completed_at=? WHERE job_id=? AND status='running'")
            .run(JSON.stringify(normalizeError(new Error('任务超时重试次数过多'))), Date.now(), Date.now(), r.job_id);
        } else {
          db.prepare("UPDATE gen_jobs SET status='queued', attempt=?, started_at=NULL, updated_at=? WHERE job_id=? AND status='running'")
            .run(nextAttempt, Date.now(), r.job_id);
        }
      } catch (e) {
        console.warn('[gen-jobs] 僵尸回收失败:', e.message);
      }
    }
    if (rows.length) console.log(`[gen-jobs] 已回收 ${rows.length} 个超时 running 任务`);
  }

  async function processJob(jobId) {
    const row = getGenJob(db, jobId);
    if (!row) return;
    let payload = {};
    try {
      payload = JSON.parse(row.payload_json || '{}');
    } catch (_) {}

    try {
      const raw = await runGeneration(services, payload);
      const result = buildResult(raw, payload);
      const now = Date.now();
      db.prepare("UPDATE gen_jobs SET status='succeeded', progress=100, result_json=?, error_json=NULL, updated_at=?, completed_at=? WHERE job_id=?")
        .run(JSON.stringify(result), now, now, jobId);
      writeAssistantMessage(db, row, result);
      broadcast(db, jobId, 'succeeded', result, null);
    } catch (e) {
      const errObj = normalizeError(e);
      const now = Date.now();
      try {
        db.prepare("UPDATE gen_jobs SET status='failed', error_json=?, updated_at=?, completed_at=? WHERE job_id=?")
          .run(JSON.stringify(errObj), now, now, jobId);
      } catch (inner) {
        console.warn('[gen-jobs] 写失败状态异常:', inner.message);
      }
      broadcast(db, jobId, 'failed', null, errObj);
    }
  }

  /** 填充到 CONCURRENCY 为止；每个任务用原子 UPDATE 认领，抢不到就跳过。 */
  async function pump() {
    if (pumping || stopped) return;
    pumping = true;
    try {
      while (!stopped && active < CONCURRENCY) {
        let row;
        try {
          row = db.prepare("SELECT job_id FROM gen_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1").get();
        } catch (_) {
          break; // 表还没建（migrate 未跑），等下个 tick
        }
        if (!row) break;
        let claim;
        try {
          claim = db.prepare("UPDATE gen_jobs SET status='running', progress=10, started_at=?, updated_at=? WHERE job_id=? AND status='queued'")
            .run(Date.now(), Date.now(), row.job_id);
        } catch (_) {
          break;
        }
        if (claim.changes !== 1) continue;
        active++;
        processJob(row.job_id).finally(() => {
          active--;
          if (!stopped) setImmediate(pump);
        });
      }
    } finally {
      pumping = false;
    }
  }

  function start() {
    if (timer) return;
    stopped = false;
    recoverZombies();
    pump();
    timer = setInterval(() => pump(), TICK_MS);
    if (timer.unref) timer.unref();
    console.log(`[gen-jobs] worker 已启动 (concurrency=${CONCURRENCY})`);
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop };
}

module.exports = {
  createGenJobsWorker,
  buildResult,
  normalizeError,
  CONCURRENCY,
  STALE_MS,
  MAX_ATTEMPTS,
};
