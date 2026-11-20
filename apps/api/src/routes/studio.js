/**
 * AI 创作工作台与生图生视频领域路由 (Phase 2/4 - routes/studio.js)
 * 职责：
 *  - /chat/* 对话会话与消息流
 *  - /gen/* 生图生视频任务调度
 *  - /api/studio/jobs/:id/cancel & /gen/jobs/:id/cancel: 全系统全模型真实取消状态机 ("裁决在先、落态在后" + 409 IRREVERSIBLE + Deferred Cancel)
 */
'use strict';

const { getGenJob } = require('../gen-jobs');
const { abortJob } = require('../gen-jobs-worker');
let getModelCancelPolicy;
try {
  ({ getModelCancelPolicy } = require('@mls/api-contract'));
} catch (_) {
  try {
    ({ getModelCancelPolicy } = require('../../../../packages/api-contract'));
  } catch (e) {
    ({ getModelCancelPolicy } = require('../../../packages/api-contract'));
  }
}
const vendorCancel = require('../services/vendor-cancel');
const { eventBus, EVENTS } = require('../events');

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

/**
 * 核心取消状态机执行器
 */
async function cancelStudioJob(services, { jobId, userId, sessionUser }) {
  const { db } = services;

  const row = getGenJob(db, jobId);
  if (!row) {
    const err = new Error('任务不存在');
    err.status = 404;
    throw err;
  }

  // 越权校验：非管理员只能取消自己的任务
  const isOwner = sessionUser?.role === 'admin' ||
    String(row.user_id) === String(userId) ||
    (Number.isFinite(Number(row.user_id)) && Number(row.user_id) === Number(userId));
  if (!isOwner) {
    const err = new Error('无权操作该任务');
    err.status = 403;
    throw err;
  }

  // 如果已经完结（成功/失败/已取消），直接返回
  if (['succeeded', 'failed', 'cancelled'].includes(row.status)) {
    return {
      success: false,
      cancelled: false,
      status: row.status,
      message: '任务已结束，无法取消'
    };
  }

  const cancelPolicy = getModelCancelPolicy(row.model);
  let payloadObj = {};
  try { payloadObj = JSON.parse(row.payload_json || '{}'); } catch (_) {}
  let resultObj = {};
  try { resultObj = JSON.parse(row.result_json || '{}'); } catch (_) {}
  const vendorTaskId = payloadObj.vendorTaskId || resultObj.vendorTaskId || null;
  const msgId = 'genmsg_' + jobId;

  // 1. 排队态 (queued)：不论策略如何，排队态均支持本地/队列直接取消
  if (row.status === 'queued') {
    abortJob(jobId);
    const now = Date.now();
    db.prepare("UPDATE gen_jobs SET status='cancelled', stage='已取消', updated_at=?, completed_at=? WHERE job_id=?")
      .run(now, now, jobId);

    try {
      const existingMsg = db.prepare('SELECT result_json FROM chat_messages WHERE id=?').get(msgId);
      const cancelResult = {
        role: 'assistant',
        isCancelled: true,
        isGenerating: false,
        content: '生成已取消',
        ...(existingMsg?.result_json ? JSON.parse(existingMsg.result_json) : {})
      };
      db.prepare("UPDATE chat_messages SET status='cancelled', prompt='生成已取消', result_json=?, updated_at=? WHERE id=?")
        .run(JSON.stringify(cancelResult), now, msgId);
    } catch (_) {}

    try {
      eventBus.emit(EVENTS.TASK_UPDATED, { jobId, status: 'cancelled', type: 'gen_job', sessionId: payloadObj.sessionId || '' });
    } catch (_) {}

    return {
      success: true,
      cancelled: true,
      status: 'cancelled',
      message: '排队中任务已成功取消'
    };
  }

  // 2. 本地算力 (always_local)：全生命周期真取消，强杀进程树
  if (cancelPolicy === 'always_local') {
    const cancelRes = vendorCancel.cancelLocalTask({ model: row.model, jobId });
    const now = Date.now();
    db.prepare("UPDATE gen_jobs SET status='cancelled', stage='已取消', updated_at=?, completed_at=? WHERE job_id=?")
      .run(now, now, jobId);

    try {
      const existingMsg = db.prepare('SELECT result_json FROM chat_messages WHERE id=?').get(msgId);
      const cancelResult = {
        role: 'assistant',
        isCancelled: true,
        isGenerating: false,
        content: '本地任务已强制终止',
        ...(existingMsg?.result_json ? JSON.parse(existingMsg.result_json) : {}),
        cancellationAudit: cancelRes
      };
      db.prepare("UPDATE chat_messages SET status='cancelled', prompt='生成已取消', result_json=?, updated_at=? WHERE id=?")
        .run(JSON.stringify(cancelResult), now, msgId);
    } catch (_) {}

    try {
      eventBus.emit(EVENTS.TASK_UPDATED, { jobId, status: 'cancelled', type: 'gen_job', sessionId: payloadObj.sessionId || '', cancellationAudit: cancelRes });
    } catch (_) {}

    return {
      success: true,
      cancelled: true,
      status: 'cancelled',
      cancellationAudit: cancelRes
    };
  }

  // 3. queue_only 策略在 running / submitting 状态下绝对不可逆
  if (cancelPolicy === 'queue_only') {
    // 立即广播置灰，绝不修改 chat_messages 为 cancelled
    try {
      db.prepare("UPDATE gen_jobs SET cancellable = 0 WHERE job_id = ?").run(jobId);
    } catch (_) {}
    try {
      db.prepare("UPDATE chat_messages SET cancellable = 0 WHERE id = ? OR job_id = ?").run(msgId, jobId);
    } catch (_) {}
    try {
      eventBus.emit(EVENTS.TASK_UPDATED, { jobId, cancellable: false, status: row.status, sessionId: payloadObj.sessionId || '' });
    } catch (_) {}
    const err = new Error('任务已进入执行阶段，当前已无法取消，将继续为您等待生成结果');
    err.status = 409;
    err.code = 'IRREVERSIBLE';
    err.cancelled = false;
    throw err;
  }

  // 4. vendor_pending_only 策略 (Wan3 / 方舟)
  if (cancelPolicy === 'vendor_pending_only') {
    // 4.1 提交中窗口期 (submitting)：尚无 vendorTaskId
    if (!vendorTaskId) {
      vendorCancel.requestDeferredCancel(jobId);
      try {
        db.prepare("UPDATE gen_jobs SET cancel_requested = 1 WHERE job_id = ?").run(jobId);
      } catch (_) {}
      return {
        success: true,
        cancelled: true,
        deferred: true,
        message: '已登记取消请求，将在获取云端任务编号后立即向云端撤回'
      };
    }

    // 4.2 拿到 vendorTaskId：向云端单点发起一次真实取消（裁决在先、落态在后）
    const cancelAudit = await vendorCancel.cancelVendorTask({
      model: row.model,
      vendorTaskId,
      jobId
    });

    if (cancelAudit.realCloudCancelled) {
      // 云端真取消成功：落库 cancelled
      abortJob(jobId);
      const now = Date.now();
      const updatedResult = {
        ...(resultObj || {}),
        isCancelled: true,
        isGenerating: false,
        cancellationAudit: cancelAudit
      };
      db.prepare("UPDATE gen_jobs SET status='cancelled', stage='已取消', result_json=?, updated_at=?, completed_at=? WHERE job_id=?")
        .run(JSON.stringify(updatedResult), now, now, jobId);

      try {
        const existingMsg = db.prepare('SELECT result_json FROM chat_messages WHERE id=?').get(msgId);
        const cancelResult = {
          role: 'assistant',
          isCancelled: true,
          isGenerating: false,
          content: cancelAudit.auditSummary || '生成已取消',
          ...(existingMsg?.result_json ? JSON.parse(existingMsg.result_json) : {}),
          cancellationAudit: cancelAudit
        };
        db.prepare("UPDATE chat_messages SET status='cancelled', prompt='生成已取消', result_json=?, updated_at=? WHERE id=?")
          .run(JSON.stringify(cancelResult), now, msgId);
      } catch (_) {}

      try {
        eventBus.emit(EVENTS.TASK_UPDATED, { jobId, status: 'cancelled', type: 'gen_job', sessionId: payloadObj.sessionId || '', cancellationAudit: cancelAudit });
      } catch (_) {}

      return {
        success: true,
        cancelled: true,
        status: 'cancelled',
        cancellationAudit: cancelAudit
      };
    } else {
      // 云端不可逆 (400 UnsupportedOperation 或 409)：绝不修改 chat_messages！广播 cancellable=false 并抛 409
      try {
        db.prepare("UPDATE gen_jobs SET cancellable = 0 WHERE job_id = ?").run(jobId);
      } catch (_) {}
      try {
        db.prepare("UPDATE chat_messages SET cancellable = 0 WHERE id = ? OR job_id = ?").run(msgId, jobId);
      } catch (_) {}
      try {
        eventBus.emit(EVENTS.TASK_UPDATED, { jobId, cancellable: false, status: row.status, sessionId: payloadObj.sessionId || '', cancellationAudit: cancelAudit });
      } catch (_) {}

      const err = new Error(cancelAudit.message || '任务已进入渲染阶段，当前已无法取消，将继续为您等待生成结果');
      err.status = 409;
      err.code = 'IRREVERSIBLE';
      err.cancelled = false;
      err.cancellationAudit = cancelAudit;
      throw err;
    }
  }

  return { success: false, status: row.status };
}

async function handleStudioRoutes(services, req, res, pathname, urlObj, context) {
  const { sessionUser } = context || {};

  // POST /api/studio/jobs/:id/cancel 或 POST /gen/jobs/:id/cancel
  const mCancel = pathname.match(/^(?:\/api\/studio|\/gen)\/jobs\/([^\/]+)\/cancel$/);
  if (mCancel && req.method === 'POST') {
    if (!sessionUser) {
      sendJson(res, 401, { error: '未登录或会话已过期' });
      return true;
    }
    const jobId = decodeURIComponent(mCancel[1]);
    try {
      const result = await cancelStudioJob(services, {
        jobId,
        userId: sessionUser.id,
        sessionUser
      });
      sendJson(res, 200, result);
      return true;
    } catch (err) {
      if (err.status === 409 || err.code === 'IRREVERSIBLE') {
        sendJson(res, 409, {
          success: false,
          cancelled: false,
          code: 'IRREVERSIBLE',
          message: err.message || '任务已进入渲染阶段，当前已无法取消，将继续为您等待生成结果',
          cancellationAudit: err.cancellationAudit
        });
        return true;
      }
      sendJson(res, err.status || 500, { error: err.message, code: err.code });
      return true;
    }
  }

  return false;
}

module.exports = {
  handleStudioRoutes,
  cancelStudioJob
};
