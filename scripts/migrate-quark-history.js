#!/usr/bin/env node
/**
 * 历史夸克素材迁移入 NAS 并触发新版打标脚本
 * 用法:
 *   node scripts/migrate-quark-history.js [--limit=50] [--delay=500] [--before=2026-09-09] [--dry-run]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { openDb } = require('../src/db');
const { resolveQuarkCli } = require('../src/quark');
const { ensureOriginalFile } = require('../src/originals');
const { nasDateOriginalPath, nasMaterialDir } = require('../src/nasstore');
const { WorkflowInterpreter } = require('../src/interpreter');
const { loadProjectEnv } = require('../src/env-keys');
loadProjectEnv();

// 解析 CLI 参数
const args = process.argv.slice(2);
function getArg(name, def) {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=')[1];
  return def;
}
const isDryRun = args.includes('--dry-run');
const batchLimit = parseInt(getArg('limit', '50'), 10);
const delayMs = parseInt(getArg('delay', '600'), 10);
const beforeDateStr = getArg('before', '2026-09-09');
const cutoffTime = new Date(`${beforeDateStr}T00:00:00+08:00`).getTime();

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
  console.log(`[migrate] === 开始 9.9 之前夸克历史数据迁移任务 ===`);
  console.log(`[migrate] 截止时间: ${beforeDateStr} (epoch: ${cutoffTime})`);
  console.log(`[migrate] 单批上限: ${batchLimit} 条 | 间隔: ${delayMs}ms | 模式: ${isDryRun ? 'DRY-RUN (仅预演)' : '正式执行'}`);
  console.log(`[migrate] NAS 目标目录: ${nasMaterialDir(config)}`);

  // 查询符合条件的资产：
  // 1. 发现/创建时间早于截止时间
  // 2. 来源为 quark 或衍生表中 origin 仍为 quark 存储
  const candidates = db.prepare(`
    SELECT DISTINCT a.fid, a.file_name, a.size, a.created_at, a.discovered_at, a.source, a.sha256
    FROM assets a
    LEFT JOIN derivatives d ON a.fid = d.asset_fid AND d.kind = 'origin'
    WHERE (a.created_at < ? OR a.discovered_at < ?)
      AND (d.storage_type = 'quark' OR d.storage_type IS NULL OR a.source = 'quark')
    ORDER BY a.created_at ASC, a.discovered_at ASC
    LIMIT ?
  `).all(cutoffTime, cutoffTime, batchLimit);

  console.log(`[migrate] 发现待迁移候选素材: ${candidates.length} 条`);
  if (!candidates.length) {
    console.log(`[migrate] 没有符合条件的待迁移夸克历史数据。已完成或已全部归档！`);
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const asset = candidates[i];
    const progress = `[${i + 1}/${candidates.length}]`;
    console.log(`\n${progress} 处理资产: fid=${asset.fid} (${asset.file_name || '未命名'}, ${asset.size || 0}B)`);

    if (isDryRun) {
      console.log(`${progress} [DRY-RUN] 将从夸克下载并搬迁入 NAS，然后送入工作流打标`);
      successCount++;
      continue;
    }

    try {
      // 1. 保证本地拿到原文件（若本地无则自夸克拉取）
      const localOriginPath = await ensureOriginalFile(services, asset);
      if (!localOriginPath || !fs.existsSync(localOriginPath)) {
        throw new Error('未能从夸克获取原图文件');
      }

      // 2. 规划 NAS 年月归档路径
      const nasTarget = nasDateOriginalPath(config, {
        fileName: asset.file_name || path.basename(localOriginPath),
        date: asset.created_at || asset.discovered_at || cutoffTime,
        hash: asset.sha256 || asset.fid
      });

      // 3. 将原文件安全落盘到 NAS
      if (path.resolve(localOriginPath) !== path.resolve(nasTarget.fullPath)) {
        fs.copyFileSync(localOriginPath, nasTarget.fullPath);
      }
      console.log(`${progress} 已成功存入 NAS: ${nasTarget.relPath}`);

      // 4. 更新数据库衍生图记录
      const originDeriv = db.prepare(`
        SELECT id FROM derivatives WHERE asset_fid = ? AND kind = 'origin' LIMIT 1
      `).get(asset.fid);

      if (originDeriv) {
        db.prepare(`
          UPDATE derivatives
          SET storage_type = 'nas', storage_ref = ?, updated_at = ?
          WHERE id = ?
        `).run(nasTarget.relPath, Date.now(), originDeriv.id);
      } else {
        db.prepare(`
          INSERT INTO derivatives (
            asset_fid, kind, storage_type, storage_ref, file_name, created_at
          ) VALUES (?, 'origin', 'nas', ?, ?, ?)
        `).run(asset.fid, nasTarget.relPath, nasTarget.fileName, Date.now());
      }

      // 更新 assets 标记
      db.prepare(`
        UPDATE assets
        SET source = 'nas', updated_at = ?
        WHERE fid = ?
      `).run(Date.now(), asset.fid);

      // 5. 触发新版 AI 解释器打标
      await interpreter.triggerRun({
        workflowId: 'default',
        assetFids: [asset.fid],
        trigger: 'migrate_quark_history'
      });
      console.log(`${progress} 已触发新版打标工作流`);

      successCount++;
    } catch (err) {
      console.error(`${progress} 迁移失败: ${err.message}`);
      failCount++;
    }

    if (i < candidates.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log(`\n[migrate] === 本批次完成 ===`);
  console.log(`[migrate] 成功: ${successCount} | 失败: ${failCount} | 剩余可再跑下一批`);
}

main().catch(e => {
  console.error('[migrate] 致命错误:', e);
  process.exit(1);
});
