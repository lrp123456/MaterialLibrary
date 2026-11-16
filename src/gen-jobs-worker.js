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

function normalizeError(e, row = {}) {
  const upstreamStatus = Number(e && (e.status || e.statusCode)) || null;
  const now = Date.now();
  const startedAt = row.started_at || null;
  const createdAt = row.created_at || null;
  const durationMs = startedAt ? (now - startedAt) : (createdAt ? (now - createdAt) : null);

  return {
    name: (e && e.name) || 'Error',
    message: (e && e.message) || '生成失败',
    code: (e && e.code) || 'generation_failed',
    upstreamStatus,
    requestId: (e && (e.requestId || e.request_id)) || null,
    taskId: (e && e.taskId) || null,
    stack: (e && e.stack) || '',
    cause: e?.cause ? (e.cause.message || String(e.cause)) : null,
    timing: {
      createdAt,
      startedAt,
      completedAt: now,
      durationMs,
      durationSec: durationMs ? Number((durationMs / 1000).toFixed(1)) : null,
    },
  };
}

function fmtMs(ms) {
  return ms == null ? '-' : `${(Number(ms) / 1000).toFixed(1)}s`;
}

/**
 * 把各服务采集的原始 timing 汇总成用户要的三段账：
 * 渲染（优先百炼官方纯渲染，缺失时退回本地计时）、超分、系统开销（排队/提交/下载等其余一切）。
 * 纯函数，便于单测；没有任何 timing 素材时返回 null。
 */
function summarizeJobTiming(rawTiming, rowLike, completedAt) {
  const t = rawTiming && typeof rawTiming === 'object' ? rawTiming : {};
  const startedAt = rowLike?.started_at ?? null;
  const createdAt = rowLike?.created_at ?? null;
  const rawTotal = startedAt != null && completedAt != null ? completedAt - startedAt : (t.totalMs ?? null);
  if (rawTotal == null && t.renderUpstreamMs == null && t.renderLocalMs == null && !t.sr) return null;
  // 时钟回拨等异常下 totalMs 可能为负，统一钳到 0，避免日志出现 -1.9s
  const totalMs = rawTotal != null ? Math.max(0, rawTotal) : null;

  const queueMs = startedAt != null && createdAt != null ? Math.max(0, startedAt - createdAt) : null;
  const renderMs = t.renderUpstreamMs ?? t.renderLocalMs ?? null;
  const srMs = t.sr?.totalMs ?? null;
  const accounted = (renderMs || 0) + (srMs || 0);
  const systemMs = totalMs != null ? Math.max(0, totalMs - accounted) : null;

  return {
    queueMs,
    totalMs,
    renderMs,
    renderUpstreamMs: t.renderUpstreamMs ?? null,
    srMs,
    systemMs,
    wan: {
      prepareMs: t.prepareMs ?? null,
      submitMs: t.submitMs ?? null,
      renderLocalMs: t.renderLocalMs ?? null,
      upstreamQueueMs: t.upstreamQueueMs ?? null,
      pollCount: t.pollCount ?? null,
      pollDetectMs: t.pollDetectMs ?? null,
      downloadMs: t.downloadMs ?? null,
      upstream: t.upstream || null,
    },
    sr: t.sr || null,
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

function broadcast(db, row, status, result, error, extra = null) {
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
    ...(extra || {}),
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

    // 阶段上报：落 gen_jobs.stage/progress 并经事件总线+WS 广播给前端占位卡。
    // 轮询类回调天然 3~10s 一次，再加 2.5s 最小间隔与同阶段去重，避免超分轮询刷库。
    let lastStageKey = '';
    let lastStageAt = 0;
    let lastProgress = 10;
    const onStage = (stage) => {
      try {
        if (!stage || typeof stage !== 'object') return;
        const now = Date.now();
        if (stage.key === lastStageKey && now - lastStageAt < 2500) return;
        const progress = Math.max(lastProgress, Math.min(99, Number(stage.progress) || lastProgress));
        lastStageKey = String(stage.key || '');
        lastStageAt = now;
        lastProgress = progress;
        const label = String(stage.label || '');
        const info = { key: lastStageKey, label, detail: stage.detail || null };
        db.prepare("UPDATE gen_jobs SET stage=?, progress=?, updated_at=? WHERE job_id=? AND status='running'")
          .run(label, progress, now, jobId);
        broadcast(db, row, 'running', null, null, { stage: info, progress });
      } catch (e) {
        console.warn('[gen-jobs] 阶段上报失败:', e.message);
      }
    };

    try {
      const raw = await runGeneration(services, payload, { signal: controller.signal, onStage });
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
      const timing = summarizeJobTiming(raw?.timing, row, now);
      if (timing) {
        result.timing = timing;
        if (timing.renderMs != null || timing.srMs != null) {
          console.log(
            `[gen-jobs] 任务完成 jobId=${jobId} model=${row.model} 总耗时=${fmtMs(timing.totalMs)}` +
            ` | 云端渲染=${fmtMs(timing.renderMs)}` +
            ` | 超分=${timing.srMs != null ? fmtMs(timing.srMs) : '未触发'}` +
            ` | 系统开销=${fmtMs(timing.systemMs)}（排队 ${fmtMs(timing.queueMs)}）`
          );
        } else {
          console.log(`[gen-jobs] 任务完成 jobId=${jobId} model=${row.model} 总耗时=${fmtMs(timing.totalMs)}`);
        }
      }
      db.prepare("UPDATE gen_jobs SET status='succeeded', stage=?, progress=100, result_json=?, error_json=NULL, updated_at=?, completed_at=? WHERE job_id=?")
        .run('已完成', JSON.stringify(result), now, now, jobId);
      const messageId = writeAssistantMessage(db, row, result, 'done');
      broadcast(db, row, 'succeeded', { ...result, messageId }, null, { progress: 100, stage: { key: 'done', label: '已完成' } });
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

      const now = Date.now();
      const errObj = normalizeError(e, row);
      console.error(`[gen-jobs] 任务失败: jobId=${jobId} model=${row.model} error=${errObj.message} 耗时=${errObj.timing?.durationSec}s`);
      if (errObj.stack) {
        console.error(`[gen-jobs] 堆栈: ${errObj.stack.split('\n').slice(0, 5).join('\n')}`);
      }
      try {
        db.prepare("UPDATE gen_jobs SET status='failed', stage=?, error_json=?, updated_at=?, completed_at=? WHERE job_id=?")
          .run('执行失败', JSON.stringify(errObj), now, now, jobId);
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
        jobId: row.job_id,
        rawError: errObj,
        timing: errObj.timing,
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
          claim = db.prepare("UPDATE gen_jobs SET status='running', stage=?, progress=10, started_at=?, updated_at=? WHERE job_id=? AND status='queued'")
            .run('开始执行', Date.now(), Date.now(), row.job_id);
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
          claim = db.prepare("UPDATE gen_jobs SET status='running', stage=?, progress=10, started_at=?, updated_at=? WHERE job_id=? AND status='queued'")
            .run('开始执行', Date.now(), Date.now(), row.job_id);
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
  summarizeJobTiming,
  abortJob,
  IMG_CONCURRENCY,
  VID_CONCURRENCY,
  CONCURRENCY: IMG_CONCURRENCY + VID_CONCURRENCY,
  STALE_MS,
  MAX_ATTEMPTS,
};
