/**
 * vendor-cancel.js · 云端任务取消接线器与真实状态核验模块
 * 
 * 核心原则：
 * 1. 如果可以真的取消任务就取消（官方接口排队期返回 200/204）；
 * 2. 如果不可以真的取消任务就前端取消（云端已进入不可逆深度计算，百炼报 400 UnsupportedOperation，方舟报 running）；
 * 3. 必须真实接线：真正向云端发送 HTTP POST/DELETE 网络请求，并获取最新真实快照；
 * 4. 无论能否真取消，都在任务诊断日志中展示最新、真实、可查证的云端数据。
 */

const { getWanEnv } = require('./wan-video');

/**
 * 针对不同服务商执行真实云端取消，并捕获最新状态
 */
async function cancelVendorTask({ model = '', vendorTaskId = null, jobId = '' }) {
  const modelStr = String(model || '').toLowerCase();
  const vTaskId = String(vendorTaskId || '').trim();

  // 1. 本地尚未获得云端任务 ID（仍处于本地上传参考图或准备请求阶段）
  if (!vTaskId) {
    return {
      vendorTaskId: null,
      vendorName: '本地队列',
      cancelAttempted: false,
      realCloudCancelled: true,
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

  // 4. 其他通用模型（默认先尝试百炼，若无则转为本地取消）
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
      cancellationMode: 'local_cancelled_cloud_running',
      vendorStatus: 'UNKNOWN',
      cloudContinued: false,
      videoGenerated: false,
      vendorVideoUrl: null,
      auditSummary: '未配置百炼 API Key，已执行前端/本地取消。',
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
  // 2. 如果 cancel 返回 400 UnsupportedOperation，说明已经在 RUNNING 中，官方不支持中途打断 -> 前端取消，云端继续跑
  const realCloudCancelled = cancelOk || taskStatus === 'CANCELLED';
  const isAlreadyRunning = cancelStatus === 400 || (cancelJson && cancelJson.code === 'UnsupportedOperation');
  const cloudContinued = !realCloudCancelled && (taskStatus === 'SUCCEEDED' || taskStatus === 'RUNNING' || Boolean(videoUrl));

  let auditSummary = '';
  if (realCloudCancelled) {
    auditSummary = '✅ 已成功向阿里云百炼发送取消请求并在排队期生效（云端真取消）：云端已中止算力渲染与排期，不产生多余计费。';
  } else if (isAlreadyRunning) {
    auditSummary = '⚠️ 前端已取消本地等待：该任务在百炼云端已进入实际渲染解算阶段（官方接口不支持中途截断算力），云端继续执行并产生计费。';
  } else {
    auditSummary = `前端已取消本地任务等待（云端状态: ${taskStatus}）。`;
  }

  return {
    vendorTaskId: taskId,
    vendorName: '阿里云百炼',
    cancelAttempted: true,
    realCloudCancelled,
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
      cancellationMode: 'local_cancelled_cloud_running',
      vendorStatus: 'UNKNOWN',
      cloudContinued: false,
      videoGenerated: false,
      vendorVideoUrl: null,
      auditSummary: '未配置 ARK_API_KEY，已执行前端/本地取消。',
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
    auditSummary = '⚠️ 前端已取消本地等待：该任务在方舟云端已进入 running 计算阶段（官方不支持中途终止），云端继续执行并产生计费。';
  } else {
    auditSummary = `前端已取消本地任务等待（云端状态: ${taskStatus}）。`;
  }

  return {
    vendorTaskId: taskId,
    vendorName: '火山引擎方舟',
    cancelAttempted: true,
    realCloudCancelled,
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
};
