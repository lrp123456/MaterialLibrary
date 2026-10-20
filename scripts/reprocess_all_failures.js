const fs = require('fs');
const path = require('path');
const { openDb } = require('../src/db');
const { resolveQuarkCli } = require('../src/quark');
const { WorkflowInterpreter } = require('../src/interpreter');
const { loadProjectEnv } = require('../src/env-keys');
loadProjectEnv();

const dataDir = process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library');
const db = openDb(dataDir);
const config = {
  dataDir,
  cliPath: resolveQuarkCli(process.env.QUARK_CLI_PATH),
  litellmApiKey: process.env.LITELLM_API_KEY || ''
};
const services = {
  db,
  config,
  logger: console
};

const interpreter = new WorkflowInterpreter(services);

async function main() {
  console.log('=== 1. 批量就绪视频资产 (kind=video) ===');
  const videoRows = db.prepare(`
    SELECT fid, file_name, status, poster_path, thumb_url
    FROM assets
    WHERE kind = 'video' AND status = 'discovered'
  `).all();
  console.log(`发现待就绪视频: ${videoRows.length} 个`);

  if (videoRows.length > 0) {
    const updVideo = db.prepare(`
      UPDATE assets
      SET status = 'ready', auth_state = 'live', updated_at = ?
      WHERE fid = ?
    `);

    const now = Date.now();
    let updatedVideos = 0;
    for (const v of videoRows) {
      updVideo.run(now, v.fid);
      updatedVideos++;
    }
    console.log(`已将 ${updatedVideos} 个视频资产更新为 ready 状态并设为代表图!`);
  }

  console.log('\n=== 2. 重置所有失败的 node_runs 与 runs ===');
  const resetRuns = db.prepare(`
    UPDATE runs
    SET status = 'queued', error = NULL, updated_at = ?
    WHERE status IN ('partial_failed', 'failed')
  `).run(Date.now());
  console.log(`已重置 ${resetRuns.changes} 个失败的 runs 批次为 queued`);

  const resetNodes = db.prepare(`
    UPDATE node_runs
    SET status = 'queued', error = NULL, updated_at = ?
    WHERE status = 'failed'
  `).run(Date.now());
  console.log(`已重置 ${resetNodes.changes} 个失败的 node_runs 任务为 queued`);

  console.log('\n=== 3. 将未处理的同步图片批量加入流水线 ===');
  // 优先处理手机同步的图片
  const syncImages = db.prepare(`
    SELECT fid FROM assets
    WHERE kind = 'image' AND status = 'discovered' AND source = 'sync'
    ORDER BY created_at DESC
  `).all().map(r => r.fid);

  console.log(`发现手机同步待处理图片: ${syncImages.length} 张`);
  if (syncImages.length > 0) {
    const res = await interpreter.triggerRun({
      workflowId: 'default',
      assetFids: syncImages,
      trigger: 'manual:reprocess_sync'
    });
    console.log(`已将 ${syncImages.length} 张手机同步图片入队! Run ID: ${res.runId}`);
  }

  // 检查其余待处理图片，分批入队
  const otherImages = db.prepare(`
    SELECT fid FROM assets
    WHERE kind = 'image' AND status = 'discovered'
      AND NOT EXISTS (SELECT 1 FROM node_runs nr WHERE nr.asset_fid = assets.fid AND nr.status IN ('queued', 'running'))
    ORDER BY created_at DESC
    LIMIT 300
  `).all().map(r => r.fid);

  console.log(`发现其他待处理图片: ${otherImages.length} 张 (本批调度 300 张)`);
  if (otherImages.length > 0) {
    const res2 = await interpreter.triggerRun({
      workflowId: 'default',
      assetFids: otherImages,
      trigger: 'manual:reprocess_batch'
    });
    console.log(`已将 ${otherImages.length} 张待处理图片入队! Run ID: ${res2.runId}`);
  }

  console.log('\n=== 4. 统计最新就绪资产概况 ===');
  const readyStats = db.prepare("SELECT kind, count(*) as count FROM assets WHERE status IN ('ready', 'ready_with_flags', 'tagging_done') GROUP BY kind").all();
  console.log('当前素材库可用素材:', readyStats);

  console.log('\n=== 全量重跑与资产就绪完成! ===');
}

main()
  .catch(console.error)
  .finally(() => db.close());
