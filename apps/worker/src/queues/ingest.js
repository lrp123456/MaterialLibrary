/**
 * 队列 1：入库质检与缩略图打标队列 (q:ingest)
 *
 * Phase 3 Fail-Open 铁律：
 * 1. 4 源分流：
 *    - web_upload / studio_save / app_manual: 100% 跳过门禁，直接跑特征提取与打标；
 *    - app_album_sync: 入库瞬间默认 visible，异步轻量门禁；仅高置信度拒收规则改写为 rejected_box；
 * 2. 任何节点报错（VLM 502/超时、Sharp 异常）：
 *    - 严禁修改 visibility = 'visible'！
 *    - pipeline_status 设为 'partial_failed'；
 *    - 异步上报至 Phase 1 旁路监控系统。
 */
const { Worker, Queue } = require('bullmq');
const { publishEvent } = require('../pubsub');

const QUEUE_NAME = 'q:ingest';

function createIngestQueue(connection) {
  return new Queue(QUEUE_NAME, { connection });
}

async function handleIngestPipeline(data, options = {}) {
  const {
    assetFid,
    userId = 1,
    sourceType = 'web_upload',
    isDuplicate = false,
    isPureBlack = false,
    vlmHandler
  } = data;

  const db = options.db;
  const reportError = options.reportError || (() => {});

  let visibility = 'visible';
  let pipelineStatus = 'running';

  // 1. 门禁分流判断
  if (sourceType === 'app_album_sync') {
    // 仅针对相册自动同步跑高置信度拒收过滤
    if (isDuplicate || isPureBlack) {
      visibility = 'rejected_box';
      pipelineStatus = 'done';

      if (db) {
        try {
          db.prepare("UPDATE assets SET visibility = ?, pipeline_status = ? WHERE fid = ?")
            .run(visibility, pipelineStatus, assetFid);
        } catch (_) {}
      }

      await publishEvent('mls:events:asset_changed', {
        userId,
        assetFid,
        action: 'rejected',
        visibility,
        pipelineStatus,
        reason: isDuplicate ? 'exact_duplicate' : 'pure_black'
      });

      return { assetFid, visibility, pipelineStatus, rejected: true };
    }
  }

  // 2. 主动上传与创作源 (web_upload, studio_save, app_manual) 100% 保持 visible
  visibility = 'visible';

  // 3. 执行特征提取与 VLM 打标（Fail-Open 保护）
  try {
    // 模拟或调用外部 VLM 打标处理器
    if (vlmHandler) {
      await vlmHandler(data);
    }
    pipelineStatus = 'done';
  } catch (err) {
    // Fail-Open 铁律：任何异常绝不能把可见性改没！必须保持 visible，仅标记 partial_failed
    console.warn(`[ingest:fail-open] fid=${assetFid} 在打标/特征节点报错，触发 Fail-Open 保护:`, err.message);
    pipelineStatus = 'partial_failed';

    // 错误上报至旁路监控
    try {
      reportError({
        module: 'ingest',
        err,
        errorCode: 'ERR_VLM_OR_PIPELINE',
        context: { assetFid, sourceType, userId }
      });
    } catch (_) {}
  }

  // 更新数据库
  if (db) {
    try {
      db.prepare("UPDATE assets SET visibility = ?, pipeline_status = ? WHERE fid = ?")
        .run(visibility, pipelineStatus, assetFid);
    } catch (_) {}
  }

  // 向客户端推送就绪或部分失败通知（素材均在列表可见）
  await publishEvent('mls:events:asset_changed', {
    userId,
    assetFid,
    action: 'ingest_status_updated',
    visibility,
    pipelineStatus
  });

  return { assetFid, visibility, pipelineStatus, rejected: false };
}

function createIngestWorker(connection, options = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[worker:ingest] 处理入库任务: ${job.id}, fid=${job.data?.assetFid}`);
      return await handleIngestPipeline(job.data, options);
    },
    {
      connection,
      concurrency: options.concurrency || 5,
      ...options
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker:ingest] 任务 ${job?.id} 失败:`, err.message);
  });

  return worker;
}

module.exports = {
  QUEUE_NAME,
  createIngestQueue,
  createIngestWorker,
  handleIngestPipeline
};
