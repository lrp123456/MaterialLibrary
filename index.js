/**
 * DSH 素材库插件 (Material Library)
 *
 * 夸克网盘室内设计素材自动吸收：定时扫描 -> 素材闸门(VLM) -> 打标查重 ->
 * 自动去水印 -> 9:16 AI重新构图 -> 向量检索 / 缓存代理下载。
 * 权威元数据 = 主机本地 SQLite；网盘 = 原始存储。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadProjectEnv } = require('./src/env-keys');
loadProjectEnv();
const { resolveQuarkCli } = require('./src/quark');
const { openDb } = require('./src/db');
const { WorkflowInterpreter } = require('./src/interpreter');
const api = require('./src/api');
const sync = require('./src/sync');

const name = 'dsh-material-library';
const inject = ['tools'];

const DEFAULT_CONFIG = {
  quarkCliPath: '',
  rootFid: '225f01205b7942b1a75bb0c2d7a0565a',
  systemFid: 'a082098178f74add99cbf6de2c4caa8a',
  dataDir: '',
  scanIntervalMs: 30 * 60 * 1000,
  autoScan: true,
  litellmBaseUrl: 'http://127.0.0.1:4000',
  litellmApiKey: process.env.LITELLM_API_KEY || '',
  litellmModel: 'doubao-seed-2-0-lite-260428'
};

function apply(ctx) {
  const config = { ...DEFAULT_CONFIG, ...(ctx.config || {}) };
  const dataDir = config.dataDir || path.join(os.homedir(), '.dsh-material-library');
  config.cliPath = resolveQuarkCli(config.quarkCliPath);
  config.dataDir = dataDir;

  const db = openDb(dataDir);
  ctx.on?.('dispose', () => db.close());

  const services = { ctx, config, db, logger: ctx.logger || console };

  // 解释器调度引擎
  const interpreter = new WorkflowInterpreter(services);
  services.interpreter = interpreter;
  interpreter.startWorkerLoop(3000);
  ctx.on?.('dispose', () => interpreter.stop());
  setTimeout(() => {
    interpreter.queueMissingRestage({ limit: 2000 }).then(r => {
      if (r.count) (ctx.logger || console).info?.(`[restage] 已入队 ${r.count} 张缺合格 AI 重构的代表图`);
    }).catch(e => (ctx.logger || console).warn?.('[restage] 补跑入队失败: ' + e.message));
  }, 1500);

  const { applyGovernance } = require('./src/governance');
  const { ProcessWorker, unfreezeVideos } = require('./src/process');
  applyGovernance(db);
  (ctx.logger || console).info?.('[governance] 启动时首次治理完成');
  const processWorker = new ProcessWorker(services);
  processWorker.start(2000);
  ctx.on?.('dispose', () => processWorker.stop());
  try {
    const n = unfreezeVideos(db, 50);
    if (n) (ctx.logger || console).info?.(`[process] 启动解冻视频 ${n} 个`);
  } catch (e) {}
  setInterval(() => {
    const r = applyGovernance(db);
    if (r.live || r.revoked || r.frozen || r.frozenRevoked || r.revived) {
      (ctx.logger || console).info?.(`[governance] 定时治理: live=${r.live} revoked=${r.revoked} frozen=${r.frozen} frozen_revoked=${r.frozenRevoked} revived=${r.revived}`);
    }
    try {
      const n = unfreezeVideos(db, 50);
      if (n) (ctx.logger || console).info?.(`[process] 定时解冻视频 ${n} 个`);
    } catch (e) {}
  }, 3600_000);

  // HTTP API 端点绑定
  api.register(services);

  // 夸克定时扫描已收口：不再自动定时拉取新图；runScan 仅供排障手动调用
  const runScan = async (manual = false) => {
    try {
      const stats = await sync.runScan(services, { manual });
      // 扫描发现新图片后自动触发工作流批次
      await interpreter.triggerRun({ trigger: manual ? 'manual_scan' : 'scheduled_scan' });
      return stats;
    } catch (e) {
      ctx.logger?.error?.('[material-library] 扫描失败:', e.message);
    }
  };

  // 定时自动扫描已停用 (autoScan: false)
  let timer = null;

  // Agent Tools
  if (ctx.tools && typeof ctx.tools.register === 'function') {
    ctx.tools.register({
      name: 'material_scan_now',
      description: '立即扫描夸克网盘，吸收新增室内设计素材入库（闸门->打标->去水印->9:16构图->向量流水线）',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const stats = await runScan(true);
        return { scanned: stats };
      }
    });

    ctx.tools.register({
      name: 'material_search',
      description: '按关键词/空间/风格/材质多维检索室内设计素材库，返回主图及维度标签',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '关键词' },
          space: { type: 'string' },
          style: { type: 'string' },
          material: { type: 'string' },
          page: { type: 'number' },
          pageSize: { type: 'number' }
        }
      },
      execute: async (args) => {
        return api.queryAssets(db, args);
      }
    });

    ctx.tools.register({
      name: 'material_status',
      description: '查看室内设计素材库状态：总数、已就绪、待处理队列与夸克授权',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const stats = api.getStats(db);
        return { ...stats, cliPath: config.cliPath || '(未找到夸克 CLI)' };
      }
    });
  }

  ctx.logger?.info?.(`[material-library] 已加载，数据目录 ${dataDir}，CLI ${config.cliPath || '未探测到'}`);
}

module.exports = { name, inject, apply, DEFAULT_CONFIG };
