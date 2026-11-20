/**
 * 异步生成任务查询与结果兑现中心
 * 支持火山方舟 Seedance (cgt-*)、ModelScope、Agnes 等异步任务的轮询与产物本地化
 */
const fs = require('fs');
const path = require('path');
const { resolveProviderApiKey } = require('../providers');
const { fetchNet } = require('./net-retry');

async function downloadToFileBackground(url, destPath) {
  try {
    const res = await fetchNet(url, {}, { timeoutMs: 180000, what: '后台产物缓存' });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, buf);
    }
  } catch (e) {
    console.warn('[task-query] 后台缓存产物失败:', e.message);
  }
}

async function queryGenTask(services, taskId) {
  const { db, config } = services;
  const tid = String(taskId || '').trim();
  if (!tid) throw new Error('缺少 taskId');

  const tempDir = path.join(config.dataDir, 'cache', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // 1. 火山方舟任务 (cgt-*)
  if (tid.startsWith('cgt-') || tid.includes('cgt-')) {
    const adapter = db ? db.prepare("SELECT * FROM gen_adapters WHERE id='ark_seedance' OR id LIKE '%seedance%'").get() : null;
    const secrets = adapter?.secrets_json ? JSON.parse(adapter.secrets_json) : {};
    const apiKey = (db && adapter ? resolveProviderApiKey(db, adapter, secrets) : '') || process.env.ARK_API_KEY;
    if (!apiKey) throw new Error('未配置 ARK_API_KEY，无法查询火山方舟任务');

    const pollUrl = `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${tid}`;
    const res = await fetchNet(pollUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    }, { timeoutMs: 30000, what: '查询方舟任务' });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`查询火山方舟任务失败 HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const status = String(data.status || '').toLowerCase();

    if (['succeeded', 'success', 'completed'].includes(status)) {
      const remoteVideoUrl = data.content?.video_url || data.video_url || data.output_video;
      if (!remoteVideoUrl) throw new Error('任务已完成但未返回视频地址');

      const cachedFileName = `gen_${tid}.mp4`;
      const cachedFilePath = path.join(tempDir, cachedFileName);
      const localPreviewUrl = `/api/cache/temp/${cachedFileName}`;

      if (fs.existsSync(cachedFilePath)) {
        return {
          success: true,
          ok: true,
          status: 'succeeded',
          taskId: tid,
          videoUrl: localPreviewUrl,
          files: [{
            localPath: cachedFilePath,
            previewUrl: localPreviewUrl,
            url: localPreviewUrl,
            remoteUrl: remoteVideoUrl,
            mime: 'video/mp4'
          }],
          raw: data
        };
      }

      // 未下载完成前，先返回远程可播放 URL，并在后台异步抓取落盘
      downloadToFileBackground(remoteVideoUrl, cachedFilePath);

      return {
        success: true,
        ok: true,
        status: 'succeeded',
        taskId: tid,
        videoUrl: remoteVideoUrl,
        previewUrl: remoteVideoUrl,
        files: [{
          previewUrl: remoteVideoUrl,
          url: remoteVideoUrl,
          remoteUrl: remoteVideoUrl,
          mime: 'video/mp4'
        }],
        raw: data
      };
    }

    if (['failed', 'fail', 'error'].includes(status)) {
      const errMsg = data.error?.message || data.error || '火山方舟任务渲染失败';
      return {
        success: false,
        ok: false,
        status: 'failed',
        taskId: tid,
        error: String(errMsg),
        raw: data
      };
    }

    // running / pending / queued
    return {
      success: true,
      ok: true,
      status: status || 'running',
      pending: true,
      taskId: tid,
      message: `云端渲染排队中（状态: ${status || 'running'}）`,
      raw: data
    };
  }

  // 2. 本地 ai_tasks 表任务
  if (db) {
    try {
      const aiTask = db.prepare('SELECT * FROM ai_tasks WHERE task_id=?').get(tid);
      if (aiTask) {
        return {
          success: true,
          ok: true,
          status: aiTask.status,
          pending: ['pending', 'running'].includes(aiTask.status),
          taskId: tid,
          progress: aiTask.progress,
          outputFid: aiTask.output_fid,
          error: aiTask.error
        };
      }
    } catch (_) {}
  }

  throw new Error(`暂不支持该格式的外部任务 ID 查询: ${tid}`);
}

module.exports = {
  queryGenTask
};
