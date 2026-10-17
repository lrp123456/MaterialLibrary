#!/usr/bin/env node
/**
 * 受控分批触发新版 VLM 打标工作流
 * 用法:
 *   node scripts/batch-run-tagging.js [--limit=50] [--delay=1000] [--dry-run]
 */
const path = require('path');
const os = require('os');
const { loadProjectEnv } = require('../src/env-keys');
loadProjectEnv();
const { openDb } = require('../src/db');
const { WorkflowInterpreter } = require('../src/interpreter');
const { resolveQuarkCli } = require('../src/quark');

const args = process.argv.slice(2);
function getArg(name, def) {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=')[1];
  return def;
}
const isDryRun = args.includes('--dry-run');
const limit = parseInt(getArg('limit', '50'), 10);
const delayMs = parseInt(getArg('delay', '1000'), 10);

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');

const config = {
  cliPath: resolveQuarkCli(process.env.QUARK_CLI_PATH),
  rootFid: process.env.QUARK_ROOT_FID || '225f01205b7942b1a75bb0c2d7a0565a',
  systemFid: process.env.QUARK_SYSTEM_FID || 'a082098178f74add99cbf6de2c4caa8a',
  dataDir,
  nasDir: process.env.ML_NAS_DIR || '/mnt/synology/material',
  litellmBaseUrl: process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000',
  litellmApiKey: process.env.LITELLM_API_KEY || '',
  litellmModel: process.env.LITELLM_MODEL || 'doubao-seed-2-0-lite-260428'
};

const db = openDb(dataDir);
const services = { db, config, logger: console };
const interpreter = new WorkflowInterpreter(services);
services.interpreter = interpreter;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== 开始执行待打标素材受控推进任务 ===');
  console.log(`模式: ${isDryRun ? 'DRY-RUN' : '正式执行'} | 批次数量: ${limit} | 间隔: ${delayMs}ms`);

  const pending = db.prepare(`
    SELECT fid, file_name, size, created_at, discovered_at
    FROM assets
    WHERE status = 'discovered'
    ORDER BY created_at DESC, discovered_at DESC
    LIMIT ?
  `).all(limit);

  console.log(`发现待打标素材: ${pending.length} 项 (全库 discovered 总数: ${db.prepare("SELECT count(*) c FROM assets WHERE status='discovered'").get().c})`);

  if (!pending.length) {
    console.log('当前没有待打标素材。');
    return;
  }

  let queued = 0;
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const progress = `[${i + 1}/${pending.length}]`;
    console.log(`${progress} 入队打标: fid=${item.fid} (${item.file_name || '未命名'})`);

    if (!isDryRun) {
      try {
        const res = await interpreter.triggerRun({
          workflowId: 'default',
          assetFids: [item.fid],
          trigger: 'batch_tagging'
        });
        queued++;
      } catch (err) {
        console.error(`${progress} 入队失败: ${err.message}`);
      }
    } else {
      queued++;
    }

    if (i < pending.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log(`\n=== 本批次完成 ===`);
  console.log(`已成功送入打标工作流队列: ${queued} 项。后台 Worker 正在异步执行初筛与打标。`);
}

main().catch(e => {
  console.error('致命错误:', e);
  process.exit(1);
});
