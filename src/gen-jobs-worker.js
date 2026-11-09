/**
 * gen_jobs 后台任务 worker。
 *
 * - 模态分流并发池：IMG_CONCURRENCY=4，VID_CONCURRENCY=2，防止长耗时视频阻塞图片；
 * - 原子认领（changes===1 才执行）；
 * - 启动时回收超 15min 的 running 僵尸；
 * - 状态机：queued -> running -> succeeded | failed | cancelled；
 * - 内存维护 AbortController 注册表，支持外部调用 abortJob(jobId) 熔断；
 * - 成功后写 result_json + chat_messages 原子落库为 done；
 * - 失败后写 error_json + chat_messages 落库为 failed（保留重发上下文）；
 * - 取消后写 chat_messages 落库为 cancelled。
 */
'use strict';

const { eventBus, EVENTS } = require('./events');
const { getGenJob } = require('./gen-jobs');
const { runGeneration } = require('./gen-submit');

const IMG_CONCURRENCY = 4;
const VID_CONCURRENCY = 2;
const STALE_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const TICK_MS = 1500;

const activeControllers = new Map();

function abortJob(jobId) {
  const c = activeControllers.get(jobId);
  if (c) {
    try { c.abort(); } catch (_) {}
    activeControllers.delete(jobId);
    return true;
  }
  return false;
}

function modalityMode(modality) {
  if (modality === 'video') return 'text_to_video';
  if (modality === 'music' || modality === 'audio') return 'music';
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
    modelVideoUrl: r.modelVideoUrl || r.videoUrl || pickUrl('video'),
    vendorVideoUrl: r.vendorVideoUrl || '',
    srStatus: r.srStatus !== undefined ? r.srStatus : null,
    srError: r.srError || '',
    audioUrl: r.audioUrl || pickUrl('audio'),
    model: r.model || p.model || '',
    modelKey: p.model || '',
    userPrompt: p.prompt || '',
    refs: Array.isArray(p.refs) ? p.refs : (p.imageUrls || p.image ? (p.imageUrls || [p.image]) : []),
    ratio: p.ratio || (p.params && p.params.ratio) || '',
    resolution: r.resolution || p.size || p.resolution || (p.params && (p.params.resolution || p.params.size)) || '',
    duration: r.seconds || p.duration || p.durationSec || p.seconds || null,
    params: p,
  };
}

function broadcast(db, row, status, result, error) {
  const payload = {
    jobId: row.job_id,
    taskId: row.job_id,
    type: 'gen_job',
    status,
    result: result || null,
    error: error || null,
    sessionId: row.session_id || '',
    userId: row.user_id ?? null,
    modality: row.modality || '',
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

/**
 * 落一条 assistant 消息（done / failed / cancelled / running）
 */
function writeAssistantMessage(db, row, result, targetStatus = 'done') {
  if (!row.session_id) return null;
  const now = Date.now();
  const id = 'genmsg_' + row.job_id;
  const paramsJson = JSON.stringify(result.params || {});
  const promptText = result.content || result.prompt || '';
  const resultJson = JSON.stringify(result);

  try {
    db.prepare(`
      INSERT INTO chat_messages (
        id, session_id, user_id, role, mode, prompt, params_json, images_json,
        status, run_id, engine, result_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'assistant', ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status,
        prompt=excluded.prompt,
        params_json=excluded.params_json,
        result_json=excluded.result_json,
        updated_at=excluded.updated_at
    `).run(
      id,
      row.session_id,
      row.user_id,
      modalityMode(row.modality),
      promptText,
      paramsJson,
      targetStatus,
      row.job_id,
      row.model || '',
      resultJson,
      now,
      now,
    );
  } catch (e) {
    console.warn('[gen-jobs] 写回 assistant 消息失败:', e.message);
    return null;
  }

  try {
    db.prepare('UPDATE chat_sessions SET updated_at=?, params_json=COALESCE(?, params_json) WHERE id=?')
      .run(now, paramsJson, row.session_id);
  } catch (_) {}
  return id;
}

function createGenJobsWorker(services) {
  const { db } = services;
  let timer = null;
  let activeImg = 0;
  let activeVid = 0;
  let pumping = false;
  let stopped = false;

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
    if (!row || row.status === 'cancelled') return;

    let payload = {};
    try {
      payload = JSON.parse(row.payload_json || '{}');
    } catch (_) {}

    const controller = new AbortController();
    activeControllers.set(jobId, controller);

    try {
      const raw = await runGeneration(services, payload, { signal: controller.signal });
      activeControllers.delete(jobId);

      // 检查执行期间是否被取消
      const latest = getGenJob(db, jobId);
      if (latest && latest.status === 'cancelled') {
        const cancelResult = {
          role: 'assistant',
          modality: row.modality || 'image',
          isCancelled: true,
          content: '生成已取消',
          userPrompt: payload.prompt || '',
          refs: payload.imageUrls || payload.refs || [],
          params: payload,
        };
        writeAssistantMessage(db, row, cancelResult, 'cancelled');
        broadcast(db, row, 'cancelled', cancelResult, null);
        return;
      }

      const result = buildResult(raw, payload);
      const now = Date.now();
      db.prepare("UPDATE gen_jobs SET status='succeeded', progress=100, result_json=?, error_json=NULL, updated_at=?, completed_at=? WHERE job_id=?")
        .run(JSON.stringify(result), now, now, jobId);
      const messageId = writeAssistantMessage(db, row, result, 'done');
      broadcast(db, row, 'succeeded', { ...result, messageId }, null);
    } catch (e) {
      activeControllers.delete(jobId);
      const latest = getGenJob(db, jobId);
      if ((latest && latest.status === 'cancelled') || (controller.signal && controller.signal.aborted)) {
        const cancelResult = {
          role: 'assistant',
          modality: row.modality || 'image',
          isCancelled: true,
          content: '生成已取消',
          userPrompt: payload.prompt || '',
          refs: payload.imageUrls || payload.refs || [],
          params: payload,
        };
        writeAssistantMessage(db, row, cancelResult, 'cancelled');
        broadcast(db, row, 'cancelled', cancelResult, null);
        return;
      }

      const errObj = normalizeError(e);
      const now = Date.now();
      try {
        db.prepare("UPDATE gen_jobs SET status='failed', error_json=?, updated_at=?, completed_at=? WHERE job_id=?")
          .run(JSON.stringify(errObj), now, now, jobId);
      } catch (inner) {
        console.warn('[gen-jobs] 写失败状态异常:', inner.message);
      }
      const failResult = {
        role: 'assistant',
        modality: row.modality || 'image',
        isError: true,
        content: `生成遇到问题：${errObj.message || '生成失败'}`,
        model: '系统提示',
        retryPrompt: payload.prompt || '',
        retryRefs: payload.imageUrls || payload.refs || [],
        retryModel: row.model || payload.model || '',
        retryModality: row.modality || 'image',
        retryMode: payload.genMode || payload.mode || '',
        retryParams: payload,
      };
      writeAssistantMessage(db, row, failResult, 'failed');
      broadcast(db, row, 'failed', null, errObj);
    }
  }

  async function pump() {
    if (pumping || stopped) return;
    pumping = true;
    try {
      // 1. 视频独立并发池 (VID_CONCURRENCY)
      while (!stopped && activeVid < VID_CONCURRENCY) {
        let row;
        try {
          row = db.prepare("SELECT job_id FROM gen_jobs WHERE status='queued' AND modality='video' ORDER BY created_at ASC LIMIT 1").get();
        } catch (_) {
          break;
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
        activeVid++;
        processJob(row.job_id).finally(() => {
          activeVid--;
          if (!stopped) setImmediate(pump);
        });
      }

      // 2. 图片独立并发池 (IMG_CONCURRENCY)
      while (!stopped && activeImg < IMG_CONCURRENCY) {
        let row;
        try {
          row = db.prepare("SELECT job_id FROM gen_jobs WHERE status='queued' AND (modality IS NULL OR modality != 'video') ORDER BY created_at ASC LIMIT 1").get();
        } catch (_) {
          break;
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
        activeImg++;
        processJob(row.job_id).finally(() => {
          activeImg--;
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
    console.log(`[gen-jobs] worker 已启动 (img_concurrency=${IMG_CONCURRENCY}, vid_concurrency=${VID_CONCURRENCY})`);
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
  abortJob,
  IMG_CONCURRENCY,
  VID_CONCURRENCY,
  CONCURRENCY: IMG_CONCURRENCY + VID_CONCURRENCY,
  STALE_MS,
  MAX_ATTEMPTS,
};
