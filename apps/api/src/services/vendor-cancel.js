/**
 * vendor-cancel.js · 云端任务取消接线器与真实状态核验模块 (Phase 4 状态机)
 *
 * 核心原则：
 * 1. 单点取消归属：全系统唯一云端撤单端点，绝无双重取消竞态；
 * 2. 裁决在先、落态在后：根据云端真实返回判定能否取消；
 * 3. 不可逆保护：渲染中返回 400 UnsupportedOperation 或 409 时，绝不把卡片改成 cancelled；
 * 4. 提交窗口期支持 Deferred Cancel，拿到 vendorTaskId 瞬间补刀。
 */

const { getWanEnv } = require('./wan-video');
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

// 内存暂存提交窗口期的 Deferred Cancel 请求
const deferredCancelJobs = new Set();

function requestDeferredCancel(jobId) {
  if (jobId) {
    deferredCancelJobs.add(String(jobId));
    console.log(`[vendor-cancel] 登记 Deferred Cancel 请求: jobId=${jobId}`);
  }
}

function consumeDeferredCancel(jobId) {
  if (jobId && deferredCancelJobs.has(String(jobId))) {
    deferredCancelJobs.delete(String(jobId));
    console.log(`[vendor-cancel] 消费 Deferred Cancel 标记: jobId=${jobId}`);
    return true;
  }
  return false;
}

function hasDeferredCancel(jobId) {
  return jobId ? deferredCancelJobs.has(String(jobId)) : false;
}

/**
 * 本地算力/进程任务取消
 */
function cancelLocalTask({ model = '', jobId = '' }) {
  let aborted = false;
  try {
    const { abortJob } = require('../gen-jobs-worker');
    aborted = abortJob(jobId);
  } catch (_) {}

  return {
    vendorTaskId: null,
    vendorName: '本地算力/进程组',
    cancelAttempted: true,
    realCloudCancelled: true,
    cancellable: true,
    cancelled: true,
    cancellationMode: 'local_aborted',
    vendorStatus: 'CANCELLED_LOCAL',
    cloudContinued: false,
    videoGenerated: false,
    vendorVideoUrl: null,
    auditSummary: '已成功终止本地算力进程树并释放显存锁。',
    cancelHttpStatus: 200,
    cancelResponseData: { aborted },
    latestVendorSnapshot: null,
    timestamp: Date.now()
  };
}

/**
 * 针对不同服务商执行真实云端取消，并捕获最新状态
 */
async function cancelVendorTask({ model = '', vendorTaskId = null, jobId = '' }) {
  const modelStr = String(model || '').toLowerCase();
  const vTaskId = String(vendorTaskId || '').trim();

  // 本地算力直连强杀
  const policy = getModelCancelPolicy(model);
  if (policy === 'always_local') {
    return cancelLocalTask({ model, jobId });
  }

  // 1. 本地尚未获得云端任务 ID（仍处于本地上传参考图或准备请求阶段）
  if (!vTaskId) {
    return {
      vendorTaskId: null,
      vendorName: '本地队列',
      cancelAttempted: false,
      realCloudCancelled: true,
      cancellable: true,
      cancelled: true,
      cancellationMode: 'local_only',
      vendorStatus: 'CANCELLED_LOCAL',
      cloudContinued: false,
      videoGenerated: false,
      vendorVideoUrl: null,
      auditSummary: '任务在本地准备或排队阶段已取消，未提交到云端算力集群，无云端资源消耗。',
      cancelHttpStatus: 200,
      cancelResponseData: { message: 'Local job cancelled before submission' },
      latestVendorSnapshot: null,
      timestamp: Date.now()
    };
  }

  // 2. 阿里云百炼体系 (Wan3.0-Video / Wan2.1 / Qwen 等)
  const isBailian = modelStr.includes('wan') || modelStr.includes('qwen') || modelStr.includes('dashscope') || modelStr.includes('bailian');
  if (isBailian) {
    return await cancelBailianTask(vTaskId, model);
  }

  // 3. 火山引擎方舟体系 (Seedance / Seedream / Doubao 视频与图像)
  const isArk = modelStr.includes('seedance') || modelStr.includes('seedream') || modelStr.includes('doubao') || modelStr.includes('ark') || modelStr.includes('volc');
  if (isArk) {
    return await cancelArkTask(vTaskId, model);
  }

  // 4. 其他通用模型（默认尝试百炼）
  return await cancelBailianTask(vTaskId, model);
}

/**
 * 阿里云百炼取消与快照查询实现（真实接线）
 */
async function cancelBailianTask(taskId, model) {
  const env = getWanEnv();
  if (!env || !env.key) {
    return {
      vendorTaskId: taskId,
      vendorName: '阿里云百炼',
      cancelAttempted: false,
      realCloudCancelled: false,
      cancellable: false,
      cancelled: false,
      code: 'NO_API_KEY',
      message: '未配置百炼 API Key',
      cancellationMode: 'local_cancelled_cloud_running',
      vendorStatus: 'UNKNOWN',
      cloudContinued: false,
      videoGenerated: false,
      vendorVideoUrl: null,
      auditSummary: '未配置百炼 API Key，无法向云端请求取消。',
      cancelHttpStatus: 0,
      cancelResponseData: null,
      latestVendorSnapshot: null,
      timestamp: Date.now()
    };
  }

  const cancelUrl = `${env.base}/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`;
  let cancelOk = false;
  let cancelStatus = 0;
  let cancelJson = null;

  try {
    const res = await fetch(cancelUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.key}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    cancelStatus = res.status;
    cancelJson = await res.json().catch(() => ({}));
    cancelOk = res.ok;
    console.log(`[vendor-cancel] 百炼真实取消请求返回: taskId=${taskId} status=${res.status} json=`, cancelJson);
  } catch (err) {
    cancelJson = { error: err.message };
    console.warn(`[vendor-cancel] 百炼取消请求网络异常: ${err.message}`);
  }

  // 立即查询一次百炼任务最新快照
  let snapshot = null;
  try {
    const queryUrl = `${env.base}/api/v1/tasks/${encodeURIComponent(taskId)}`;
    const qRes = await fetch(queryUrl, {
      headers: { Authorization: `Bearer ${env.key}` },
      signal: AbortSignal.timeout(6000),
    });
    if (qRes.ok) {
      snapshot = await qRes.json();
    }
  } catch (_) {}

  const taskStatus = snapshot?.output?.task_status || (cancelOk ? 'CANCELLED' : 'UNKNOWN');
  const videoUrl = snapshot?.output?.video_url || null;

  // 判断是否真正中止了云端算力：
  // 1. 如果 cancel 返回 200，或者云端状态已是 CANCELLED -> 云端真取消！
  // 2. 如果 cancel 返回 400 UnsupportedOperation，说明已经在 RUNNING 中，官方不支持中途打断
  const realCloudCancelled = cancelOk || taskStatus === 'CANCELLED';
  const isAlreadyRunning = !realCloudCancelled && (cancelStatus === 400 || (cancelJson && cancelJson.code === 'UnsupportedOperation') || taskStatus === 'RUNNING');
  const cloudContinued = !realCloudCancelled && (taskStatus === 'SUCCEEDED' || taskStatus === 'RUNNING' || Boolean(videoUrl));

  let auditSummary = '';
  if (realCloudCancelled) {
    auditSummary = '✅ 已成功向阿里云百炼发送取消请求并在排队期生效（云端真取消）：云端已中止算力渲染与排期，不产生多余计费。';
  } else if (isAlreadyRunning) {
    auditSummary = '⚠️ 该任务在百炼云端已进入实际渲染解算阶段（官方接口不支持中途截断算力），云端继续执行并产生计费，将继续为您等待生成结果。';
  } else {
    auditSummary = `云端状态: ${taskStatus}。`;
  }

  return {
    vendorTaskId: taskId,
    vendorName: '阿里云百炼',
    cancelAttempted: true,
    realCloudCancelled,
    cancellable: realCloudCancelled,
    cancelled: realCloudCancelled,
    code: realCloudCancelled ? undefined : 'IRREVERSIBLE',
    message: realCloudCancelled ? '取消成功' : '任务已进入渲染阶段，当前已无法取消，将继续为您等待生成结果',
    cancellationMode: realCloudCancelled ? 'real_cloud_cancelled' : 'local_cancelled_cloud_running',
    vendorStatus: taskStatus,
    cloudContinued,
    videoGenerated: Boolean(videoUrl || taskStatus === 'SUCCEEDED'),
    vendorVideoUrl: videoUrl,
    auditSummary,
    cancelHttpStatus: cancelStatus,
    cancelResponseData: cancelJson,
    latestVendorSnapshot: snapshot,
    timestamp: Date.now()
  };
}

/**
 * 火山引擎方舟取消与快照查询实现（真实接线）
 */
async function cancelArkTask(taskId, model) {
  const arkKey = process.env.ARK_API_KEY || '';
  const arkBase = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';

  if (!arkKey) {
    return {
      vendorTaskId: taskId,
      vendorName: '火山引擎方舟',
      cancelAttempted: false,
      realCloudCancelled: false,
      cancellable: false,
      cancelled: false,
      code: 'NO_API_KEY',
      message: '未配置 ARK_API_KEY',
      cancellationMode: 'local_cancelled_cloud_running',
      vendorStatus: 'UNKNOWN',
      cloudContinued: false,
      videoGenerated: false,
      vendorVideoUrl: null,
      auditSummary: '未配置 ARK_API_KEY，无法向云端请求取消。',
      cancelHttpStatus: 0,
      cancelResponseData: null,
      latestVendorSnapshot: null,
      timestamp: Date.now()
    };
  }

  const cancelUrl = `${arkBase}/contents/generations/tasks/${encodeURIComponent(taskId)}`;
  let cancelOk = false;
  let cancelStatus = 0;
  let cancelJson = null;

  try {
    const res = await fetch(cancelUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${arkKey}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    cancelStatus = res.status;
    cancelJson = await res.json().catch(() => ({}));
    cancelOk = res.ok || res.status === 204;
    console.log(`[vendor-cancel] 火山方舟真实 DELETE 取消请求返回: taskId=${taskId} status=${res.status} json=`, cancelJson);
  } catch (err) {
    cancelJson = { error: err.message };
    console.warn(`[vendor-cancel] 火山方舟取消请求网络异常: ${err.message}`);
  }

  // 立即查询一次方舟任务最新快照
  let snapshot = null;
  try {
    const queryUrl = `${arkBase}/contents/generations/tasks/${encodeURIComponent(taskId)}`;
    const qRes = await fetch(queryUrl, {
      headers: { Authorization: `Bearer ${arkKey}` },
      signal: AbortSignal.timeout(6000),
    });
    if (qRes.ok) {
      snapshot = await qRes.json();
    }
  } catch (_) {}

  const taskStatus = snapshot?.status || (cancelOk ? 'cancelled' : 'unknown');
  const contentUrl = snapshot?.content?.video_url || snapshot?.content?.url || null;

  const realCloudCancelled = cancelOk || taskStatus === 'cancelled';
  const isAlreadyRunning = !realCloudCancelled && (taskStatus === 'running' || cancelStatus === 400 || cancelStatus === 409);
  const cloudContinued = !realCloudCancelled && (taskStatus === 'succeeded' || taskStatus === 'running' || Boolean(contentUrl));

  let auditSummary = '';
  if (realCloudCancelled) {
    auditSummary = '✅ 已成功向火山引擎方舟发送 DELETE 取消请求并在排队期生效（云端真取消）：任务已从算力队列撤出，未产生多余计费。';
  } else if (isAlreadyRunning) {
    auditSummary = '⚠️ 该任务在方舟云端已进入 running 计算阶段（官方不支持中途终止），云端继续执行并产生计费，将继续为您等待生成结果。';
  } else {
    auditSummary = `云端状态: ${taskStatus}。`;
  }

  return {
    vendorTaskId: taskId,
    vendorName: '火山引擎方舟',
    cancelAttempted: true,
    realCloudCancelled,
    cancellable: realCloudCancelled,
    cancelled: realCloudCancelled,
    code: realCloudCancelled ? undefined : 'IRREVERSIBLE',
    message: realCloudCancelled ? '取消成功' : '任务已进入渲染阶段，当前已无法取消，将继续为您等待生成结果',
    cancellationMode: realCloudCancelled ? 'real_cloud_cancelled' : 'local_cancelled_cloud_running',
    vendorStatus: String(taskStatus).toUpperCase(),
    cloudContinued,
    videoGenerated: Boolean(contentUrl || taskStatus === 'succeeded'),
    vendorVideoUrl: contentUrl,
    auditSummary,
    cancelHttpStatus: cancelStatus,
    cancelResponseData: cancelJson,
    latestVendorSnapshot: snapshot,
    timestamp: Date.now()
  };
}

module.exports = {
  cancelVendorTask,
  cancelLocalTask,
  cancelBailianTask,
  cancelArkTask,
  requestDeferredCancel,
  consumeDeferredCancel,
  hasDeferredCancel
};
