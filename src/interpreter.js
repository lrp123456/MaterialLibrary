/**
 * 同进程工作流解释器 (In-process DAG Workflow Interpreter)
 * 纯 Node.js 单 worker 顺序调度，无 Prefect/Temporal 等复杂依赖。
 * 具备 DAG 拓扑排序校验、崩溃恢复自动对账、增量断点续跑与致命/非致命错误分级流转能力。
 */
const crypto = require('crypto');
const { NODE_REGISTRY } = require('./nodes');

function topologicalSort(nodes, edges) {
  const inDegree = new Map();
  const adj = new Map();
  const nodeMap = new Map();

  nodes.forEach(n => {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
    nodeMap.set(n.id, n);
  });

  edges.forEach(e => {
    const from = e.source || e.from;
    const to = e.target || e.to;
    if (adj.has(from) && inDegree.has(to)) {
      adj.get(from).push(to);
      inDegree.set(to, inDegree.get(to) + 1);
    }
  });

  const queue = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const sorted = [];
  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(nodeMap.get(id));
    for (const nextId of adj.get(id)) {
      inDegree.set(nextId, inDegree.get(nextId) - 1);
      if (inDegree.get(nextId) === 0) queue.push(nextId);
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('工作流图存在环路循环依赖，无法执行拓扑排序');
  }

  return sorted;
}

function validateWorkflowGraph(db, graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('工作流定义格式无效：必须包含 nodes 与 edges 数组');
  }

  for (const node of graph.nodes) {
    if (!NODE_REGISTRY[node.type]) {
      throw new Error(`节点 ${node.id} 使用了未注册的节点类型: ${node.type}`);
    }
    if (node.type === 'restage_9_16' && node.enabled) {
      const adapterId = node.config?.adapterId;
      if (adapterId) {
        const adp = db.prepare('SELECT enabled FROM gen_adapters WHERE id=?').get(adapterId);
        if (!adp || !adp.enabled) {
          // 不抛致命错误，但记录告警（执行时自动降级）
        }
      }
    }
  }

  return topologicalSort(graph.nodes, graph.edges);
}

function recoverCrashedRuns(db, logger) {
  const rRuns = db.prepare("UPDATE runs SET status='queued', error=NULL WHERE status='running'").run();
  const rNodeRuns = db.prepare("UPDATE node_runs SET status='queued' WHERE status='running'").run();
  if (rRuns.changes > 0 || rNodeRuns.changes > 0) {
    logger?.info?.(`[interpreter] 启动崩溃恢复: 重置 ${rRuns.changes} 个批次与 ${rNodeRuns.changes} 个节点运行为 queued`);
  }
}

function migrateJobsLegacy(db, logger) {
  const jobsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
  if (!jobsTableExists) return;

  const queuedImageJobs = db.prepare(`
    SELECT * FROM jobs
    WHERE status IN ('queued','running') AND type IN ('gate','tag','clean')
    ORDER BY id ASC
  `).all();

  if (queuedImageJobs.length > 0) {
    const runId = 'run_migration_baseline';
    const now = Date.now();
    const existingRun = db.prepare('SELECT id FROM runs WHERE id=?').get(runId);
    if (!existingRun) {
      db.prepare(`
        INSERT INTO runs (id, workflow_id, workflow_version, trigger, status, asset_count, created_at)
        VALUES (?, 'default', 1, 'migration', 'queued', ?, ?)
      `).run(runId, queuedImageJobs.length, now);
    }

    const insNodeRun = db.prepare(`
      INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, created_at, updated_at)
      VALUES (?, 1, ?, ?, ?, 'queued', ?, ?)
      ON CONFLICT(workflow_version, node_id, asset_fid) DO UPDATE SET status='queued'
    `);

    queuedImageJobs.forEach(j => {
      insNodeRun.run(runId, j.type, j.type, j.asset_fid, now, now);
    });

    logger?.info?.(`[interpreter] 已平滑迁移 ${queuedImageJobs.length} 条历史待处理任务至 node_runs (run_migration_baseline)`);
  }

  // 停用并重命名 jobs 为 jobs_legacy
  try {
    db.exec('ALTER TABLE jobs RENAME TO jobs_legacy;');
    logger?.info?.('[interpreter] 历史 jobs 表已重命名为 jobs_legacy');
  } catch (e) {
    // 若已存在 jobs_legacy 则跳过
  }
}

const RESTAGE_NODE_TYPES = new Set(['restage_dual', 'restage_9_16']);
const T_BACKLOG_DEADLINE = 1789056000000; // 2026-09-11 00:00:00+08:00

function isVideoAssetRow(asset) {
  if (!asset) return false;
  const k = String(asset.kind || '').toLowerCase();
  const n = String(asset.file_name || '').toLowerCase();
  return k === 'video' || /\.(mp4|mov|webm|mkv|m4v)$/i.test(n);
}

function isBacklogAssetRow(asset) {
  if (!asset) return false;
  if (asset.kind !== 'image') return false;
  if (asset.source !== 'quark' && !String(asset.fid || '').startsWith('~')) return false;
  if (['ready', 'rejected', 'excluded', 'deleted'].includes(asset.status)) return false;

  const match = (asset.file_name || '').match(/mmexport(\d{10,13})/i);
  let fileTime = null;
  if (match) {
    let t = Number(match[1]);
    if (match[1].length === 10) t *= 1000;
    fileTime = t;
  } else {
    fileTime = asset.discovered_at || asset.created_at;
  }
  return Number(fileTime) < T_BACKLOG_DEADLINE;
}

function reconcileBacklogTasks(db, logger) {
  const now = Date.now();
  // 1. 打标失败的十几条重置为 queued（running 的不打断）
  const rFailedTags = db.prepare(`
    UPDATE node_runs
    SET status = 'queued', error = NULL, updated_at = ?
    WHERE node_type = 'tag' AND status = 'failed'
      AND asset_fid IN (
        SELECT fid FROM assets
        WHERE kind = 'image' AND (source = 'quark' OR fid LIKE '~%')
          AND status NOT IN ('ready', 'rejected', 'excluded', 'deleted')
      )
  `).run(now);

  if (rFailedTags.changes > 0) {
    logger?.info?.(`[interpreter] 历史积压对账: 已重置 ${rFailedTags.changes} 条打标失败记录为 queued`);
  }

  // 2. 这一批里已经排上的重构节点改为 skipped，若还没有入库节点则排上入库
  const queuedRestages = db.prepare(`
    SELECT nr.id, nr.run_id, nr.workflow_version, nr.asset_fid, a.file_name, a.discovered_at, a.created_at, a.status, a.kind, a.source
    FROM node_runs nr
    JOIN assets a ON a.fid = nr.asset_fid
    WHERE nr.node_type IN ('restage_dual', 'restage_9_16') AND nr.status = 'queued'
      AND a.kind = 'image' AND (a.source = 'quark' OR a.fid LIKE '~%')
      AND a.status NOT IN ('ready', 'rejected', 'excluded', 'deleted')
  `).all();

  const skipRestageStmt = db.prepare(`
    UPDATE node_runs
    SET status = 'skipped', error = 'backlog_skip_restage', output_summary = ?, updated_at = ?
    WHERE id = ?
  `);

  const hasIndexStmt = db.prepare(`
    SELECT 1 FROM node_runs WHERE asset_fid = ? AND node_type = 'index' LIMIT 1
  `);

  const queueIndexStmt = db.prepare(`
    INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, created_at, updated_at)
    VALUES (?, ?, 'index', 'index', ?, 'queued', ?, ?)
    ON CONFLICT(workflow_version, node_id, asset_fid) DO UPDATE SET status = 'queued', error = NULL, updated_at = excluded.updated_at
  `);

  let skippedCount = 0;
  let indexQueuedCount = 0;
  for (const row of queuedRestages) {
    if (!isBacklogAssetRow(row)) continue;
    skipRestageStmt.run(JSON.stringify({ reason: 'backlog_skip_restage' }), now, row.id);
    skippedCount++;

    if (!hasIndexStmt.get(row.asset_fid)) {
      queueIndexStmt.run(row.run_id, row.workflow_version || 1, row.asset_fid, now, now);
      indexQueuedCount++;
    }
  }

  if (skippedCount > 0 || indexQueuedCount > 0) {
    logger?.info?.(`[interpreter] 历史积压对账: 将 ${skippedCount} 条已排队重构节点改为 skipped，补入库 ${indexQueuedCount} 条`);
  }

  // 3. 视频素材误排入 restage_dual / restage_9_16 的历史失败/排队记录自动对账为 skipped
  const rVideoRestages = db.prepare(`
    UPDATE node_runs
    SET status = 'skipped', error = 'video_skip_restage',
        output_summary = '{"skipped":true,"reason":"video_skip_restage"}',
        updated_at = ?
    WHERE node_type IN ('restage_dual', 'restage_9_16')
      AND status IN ('failed', 'queued')
      AND asset_fid IN (
        SELECT fid FROM assets
        WHERE kind = 'video' OR file_name LIKE '%.mp4' OR file_name LIKE '%.mov' OR file_name LIKE '%.webm' OR file_name LIKE '%.mkv' OR file_name LIKE '%.m4v'
      )
  `).run(now);

  if (rVideoRestages.changes > 0) {
    logger?.info?.(`[interpreter] 视频资产对账: 已将 ${rVideoRestages.changes} 条视频画幅重构失败/排队记录自动修正为 skipped`);
  }
}

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

class WorkflowInterpreter {
  constructor(services) {
    this.services = services;
    this.db = services.db;
    this.logger = services.logger || console;
    this.tagConcurrency = envInt('ML_TAG_CONCURRENCY', 8);
    this.restageConcurrency = envInt('ML_RESTAGE_CONCURRENCY', 4);
    this.concurrency = this.tagConcurrency + this.restageConcurrency;
    this.activeTagWorkers = 0;
    this.activeRestageWorkers = 0;
    this.stopped = false;
    this.timer = null;

    // 启动即执行崩溃对账与历史 jobs 迁移
    recoverCrashedRuns(this.db, this.logger);
    migrateJobsLegacy(this.db, this.logger);
    reconcileBacklogTasks(this.db, this.logger);
    this.logger.info?.(`[interpreter] 并发: 打标/闸门=${this.tagConcurrency} 转生=${this.restageConcurrency}`);
  }

  async queueIndoorRetagIfNeeded() {
    const kv = this.db.prepare("SELECT value FROM kv WHERE key='indoor_tags_rebuild_v1'").get()?.value;
    if (kv !== 'wiped') return;
    const fids = this.db.prepare(`
      SELECT fid FROM assets
      WHERE kind='image'
        AND COALESCE(category, 'interior') NOT IN ('furniture', 'portrait', 'music')
        AND (status IS NULL OR status NOT IN ('deleted', 'excluded'))
      ORDER BY created_at ASC
    `).all().map(r => r.fid);
    if (!fids.length) {
      this.db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES('indoor_tags_rebuild_v1','done')").run();
      this.logger.info?.('[interpreter] 室内重打: 无室内图');
      return;
    }
    const CHUNK = 1500;
    let queued = 0;
    for (let i = 0; i < fids.length; i += CHUNK) {
      const slice = fids.slice(i, i + CHUNK);
      const r = await this.triggerRun({
        assetFids: slice,
        trigger: 'indoor_retag_v1',
        targetNodeId: 'tag',
        mode: 'all'
      });
      queued += r.count || slice.length;
    }
    this.db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES('indoor_tags_rebuild_v1','queued')").run();
    this.logger.info?.(`[interpreter] 室内重打已入队 ${queued} 张 (空间/风格/材质)`);
  }

  startWorkerLoop(intervalMs = 3000) {
    this.stopped = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.processNextBatch().catch(e => {
      this.logger.error?.('[interpreter] worker 处理循环异常:', e.message);
    }), intervalMs);
    this.timer.unref?.();
    setImmediate(() => this.queueIndoorRetagIfNeeded().catch(e => {
      this.logger.warn?.('[interpreter] 室内重打入队失败:', e.message);
    }));
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async triggerRun({ workflowId = 'default', assetFids = [], trigger = 'manual', limit = 200, mode = 'unprocessed', targetNodeId = null } = {}) {
    const wf = this.db.prepare('SELECT * FROM workflows WHERE id=?').get(workflowId);
    if (!wf) throw new Error(`工作流 ${workflowId} 不存在`);

    const graph = JSON.parse(wf.graph_json);
    const sortedNodes = validateWorkflowGraph(this.db, graph);

    // 若未显式传入 assetFids，按模式拉取资产
    let fids = assetFids;
    if (fids.length === 0) {
      const parsedLimit = Math.max(1, Math.min(2000, +limit || 200));
      if (mode === 'watermarked') {
        fids = this.db.prepare(`
          SELECT fid FROM assets
          WHERE kind='image' AND has_watermark=1 AND status != 'frozen'
          ORDER BY updated_at DESC LIMIT ?
        `).all(parsedLimit).map(r => r.fid);
      } else if (mode === 'non_vertical') {
        fids = this.db.prepare(`
          SELECT fid FROM assets
          WHERE kind='image' AND origin_orientation IS NOT NULL AND origin_orientation != '9:16' AND status != 'frozen'
          ORDER BY updated_at DESC LIMIT ?
        `).all(parsedLimit).map(r => r.fid);
      } else if (mode === 'all') {
        fids = this.db.prepare(`
          SELECT fid FROM assets
          WHERE kind='image' AND status != 'frozen'
          ORDER BY created_at ASC LIMIT ?
        `).all(parsedLimit).map(r => r.fid);
      } else if (mode === 'restage_missing') {
        const { listAssetsNeedingRestage } = require('./restage');
        fids = listAssetsNeedingRestage(this.db, parsedLimit);
        targetNodeId = targetNodeId || 'restage_dual';
      } else {
        // 默认 unprocessed
        fids = this.db.prepare(`
          SELECT fid FROM assets
          WHERE kind='image' AND status IN ('discovered', 'processing')
          ORDER BY created_at ASC LIMIT ?
        `).all(parsedLimit).map(r => r.fid);
      }
    }

    if (fids.length === 0) return { runId: null, count: 0, message: '无可处理的资产' };

    const runId = `run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO runs (id, workflow_id, workflow_version, trigger, status, asset_count, created_at)
        VALUES (?, ?, ?, ?, 'queued', ?, ?)
      `).run(runId, wf.id, wf.version, trigger, fids.length, now);

      const insNodeRun = this.db.prepare(`
        INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, created_at, updated_at, not_before)
        VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, NULL)
        ON CONFLICT(workflow_version, node_id, asset_fid) DO UPDATE SET
          status='queued', error=NULL, run_id=excluded.run_id, updated_at=excluded.updated_at, not_before=NULL
      `);

      // 确定起始执行节点 (若指定 targetNodeId 则从该节点开始)
      const startNode = (targetNodeId
        ? (sortedNodes.find(n => n.id === targetNodeId) || sortedNodes.find(n => n.type === targetNodeId))
        : null) || sortedNodes.find(n => n.enabled);
      if (startNode) {
        fids.forEach(fid => {
          insNodeRun.run(runId, wf.version, startNode.id, startNode.type, fid, now, now);
        });
      }
    });

    tx();
    this.logger.info?.(`[interpreter] 已创建运行批次 ${runId} (版本 v${wf.version}, 模式 ${mode})，入队资产 ${fids.length} 张`);

    // 异步拉起处理
    setImmediate(() => this.processNextBatch());
    return { runId, count: fids.length, version: wf.version };
  }

  async queueMissingRestage({ limit = 2000 } = {}) {
    const { listAssetsNeedingRestage } = require('./restage');
    const fids = listAssetsNeedingRestage(this.db, limit);
    if (!fids.length) return { runId: null, count: 0, message: '没有缺合格 AI 重构的代表图' };
    const wf = this.db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get();
    let targetNodeId = 'restage_dual';
    try {
      const g = JSON.parse(wf.graph_json);
      const n = (g.nodes || []).find(x => x.type === 'restage_dual' && x.enabled !== false)
        || (g.nodes || []).find(x => x.type === 'restage_dual');
      if (n?.id) targetNodeId = n.id;
    } catch { /* default id */ }
    return this.triggerRun({
      assetFids: fids,
      trigger: 'restage_backfill',
      mode: 'restage_missing',
      targetNodeId
    });
  }

  async retryNodeRun(nodeRunId) {
    const nr = this.db.prepare('SELECT * FROM node_runs WHERE id=?').get(nodeRunId);
    if (!nr) throw new Error(`节点运行记录 ${nodeRunId} 不存在`);

    this.db.prepare("UPDATE node_runs SET status='queued', error=NULL, updated_at=? WHERE id=?")
      .run(Date.now(), nodeRunId);

    setImmediate(() => this.processNextBatch());
    return { success: true, nodeRunId };
  }

  isRestageType(nodeType) {
    return RESTAGE_NODE_TYPES.has(String(nodeType || ''));
  }

  async processNextBatch() {
    if (this.stopped) return;
    const tagRoom = this.activeTagWorkers < this.tagConcurrency;
    const restageRoom = this.activeRestageWorkers < this.restageConcurrency;
    if (!tagRoom && !restageRoom) return;

    while (!this.stopped) {
      const canTag = this.activeTagWorkers < this.tagConcurrency;
      const canRestage = this.activeRestageWorkers < this.restageConcurrency;
      if (!canTag && !canRestage) break;

      const now = Date.now();
      let nodeRun = null;
      const skipRestage = !canRestage;
      const skipTag = !canTag;

      const claimTx = this.db.transaction(() => {
        const candidate = this.db.prepare(`
          SELECT nr.*, r.workflow_id, r.workflow_version AS r_ver
          FROM node_runs nr
          LEFT JOIN runs r ON r.id = nr.run_id
          WHERE nr.status = 'queued'
            AND nr.node_type != 'process'
            AND (nr.not_before IS NULL OR nr.not_before <= ?)
            AND NOT (? = 1 AND nr.node_type IN ('restage_dual','restage_9_16'))
            AND NOT (? = 1 AND nr.node_type NOT IN ('restage_dual','restage_9_16'))
          ORDER BY
            CASE WHEN nr.asset_fid LIKE 'local_%' THEN 0 ELSE 1 END ASC,
            CASE nr.node_type
              WHEN 'materialize' THEN 1
              WHEN 'gate' THEN 2
              WHEN 'qc' THEN 3
              WHEN 'index' THEN 4
              WHEN 'tag' THEN 5
              WHEN 'cluster' THEN 6
              WHEN 'restage_dual' THEN 7
              WHEN 'restage_9_16' THEN 8
              WHEN 'clean' THEN 9
              WHEN 'backup' THEN 10
              ELSE 11
            END ASC,
            nr.id ASC
          LIMIT 1
        `).get(now, skipRestage ? 1 : 0, skipTag ? 1 : 0);

        if (candidate) {
          this.db.prepare("UPDATE node_runs SET status='running', updated_at=? WHERE id=?").run(Date.now(), candidate.id);
          if (candidate.run_id) {
            this.db.prepare("UPDATE runs SET status='running', started_at=COALESCE(started_at, ?), updated_at=? WHERE id=?")
              .run(Date.now(), Date.now(), candidate.run_id);
          }
          nodeRun = candidate;
        }
      });
      claimTx();

      if (!nodeRun) {
        this.settleFinishedRuns();
        break;
      }

      const restage = this.isRestageType(nodeRun.node_type);
      if (restage) this.activeRestageWorkers++;
      else this.activeTagWorkers++;
      this.executeWorker(nodeRun).finally(() => {
        if (restage) this.activeRestageWorkers--;
        else this.activeTagWorkers--;
        if (!this.stopped) {
          setImmediate(() => this.processNextBatch().catch(e => {
            this.logger.error?.('[interpreter] 连续调度异常:', e.message);
          }));
        }
      });
    }
  }

  async executeWorker(nodeRun) {
    try {
      await this.executeNodeRun(nodeRun);
    } catch (e) {
      this.logger.error?.(`[interpreter] worker 执行异常 (id=${nodeRun?.id}):`, e.message);
    }
  }

  async executeNodeRun(nodeRun) {
    const wfId = nodeRun.workflow_id || 'default';
    const wf = this.db.prepare('SELECT * FROM workflows WHERE id=?').get(wfId);
    if (!wf) {
      this.db.prepare("UPDATE node_runs SET status='failed', error='对应工作流已删除', updated_at=? WHERE id=?")
        .run(Date.now(), nodeRun.id);
      return;
    }

    const graph = JSON.parse(wf.graph_json);
    const sortedNodes = validateWorkflowGraph(this.db, graph);
    const targetNode = sortedNodes.find(n => n.id === nodeRun.node_id);

    if (!targetNode) {
      this.db.prepare("UPDATE node_runs SET status='failed', error='图中未找到该节点定义', updated_at=? WHERE id=?")
        .run(Date.now(), nodeRun.id);
      return;
    }

    const asset = this.db.prepare('SELECT * FROM assets WHERE fid=?').get(nodeRun.asset_fid);
    if (!asset) {
      this.db.prepare("UPDATE node_runs SET status='failed', error='对应资产记录不存在', updated_at=? WHERE id=?")
        .run(Date.now(), nodeRun.id);
      return;
    }

    try {
      require('./gen-governance').applyBindingToNodeConfig(this.db, targetNode);
    } catch (e) {
      this.logger?.warn?.('[interpreter] 作业绑定未套用', e.message);
    }

    const handler = NODE_REGISTRY[targetNode.type];
    if (!handler) {
      this.db.prepare("UPDATE node_runs SET status='failed', error='无对应处理器实现', updated_at=? WHERE id=?")
        .run(Date.now(), nodeRun.id);
      return;
    }

    // 准备执行上下文：同一 run + 同一 fid 的全部上游节点 output 形成 n8n 式上下文
    const runCtx = {
      accumulatedFlags: [],
      lastOutput: null,
      prevError: nodeRun.error || null,
      trigger: '',
      nodes: {},
      $node: {},
    };
    if (nodeRun.run_id) {
      const runRow = this.db.prepare('SELECT trigger FROM runs WHERE id=?').get(nodeRun.run_id);
      runCtx.trigger = runRow?.trigger || '';
      try {
        const priorRuns = this.db.prepare(`
          SELECT node_id, output_summary FROM node_runs
          WHERE run_id=? AND asset_fid=?
        `).all(nodeRun.run_id, nodeRun.asset_fid);
        for (const pr of priorRuns) {
          if (pr.output_summary) {
            try {
              const parsed = JSON.parse(pr.output_summary);
              runCtx.nodes[pr.node_id] = parsed;
              runCtx.$node[pr.node_id] = parsed;
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
    const currentIndex = sortedNodes.findIndex(n => n.id === nodeRun.node_id);
    if (currentIndex > 0) {
      const prevNode = sortedNodes[currentIndex - 1];
      const prevRun = this.db.prepare(`
        SELECT output_summary FROM node_runs
        WHERE run_id=? AND asset_fid=? AND node_id=?
        ORDER BY id DESC LIMIT 1
      `).get(nodeRun.run_id, nodeRun.asset_fid, prevNode.id);
      if (prevRun?.output_summary) {
        try { runCtx.lastOutput = JSON.parse(prevRun.output_summary); } catch { runCtx.lastOutput = null; }
      }
    }

    if (targetNode.config && targetNode.config.promptTemplate) {
      try {
        const { interpolateVariables } = require('./models-contract');
        targetNode.config.promptTemplate = interpolateVariables(targetNode.config.promptTemplate, {
          $node: runCtx.$node,
          nodes: runCtx.nodes,
          asset: {
            fid: asset.fid,
            file_name: asset.file_name,
            width: asset.width,
            height: asset.height,
            category: asset.category,
          }
        });
      } catch (_) {}
    }

    const spaceTag = this.db.prepare(`
      SELECT t.dir FROM asset_tags at
      JOIN tag_dict t ON t.id = at.tag_id
      WHERE at.asset_fid=? AND t.dimension='space' LIMIT 1
    `).get(asset.fid)?.dir || null;
    let dictRetag = null;
    try {
      const prevIn = nodeRun.input_summary ? JSON.parse(nodeRun.input_summary) : null;
      if (prevIn?.dictRetag) {
        dictRetag = { dimensions: prevIn.dimensions || [], reason: prevIn.reason || 'dictionary_change' };
        runCtx.dictRetag = dictRetag;
      }
    } catch { /* ignore */ }
    const inputSummary = {
      source: runCtx.lastOutput?.originalPath || runCtx.lastOutput?.refPath || null,
      width: asset.width,
      height: asset.height,
      phash: asset.phash || null,
      spaceTag,
      previousNode: currentIndex > 0 ? sortedNodes[currentIndex - 1].id : null,
      ...(dictRetag || {})
    };
    this.db.prepare('UPDATE node_runs SET input_summary=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(inputSummary), Date.now(), nodeRun.id);

    const startTs = Date.now();
    try {
      // 节点如果被禁用，直接 skip 透传
      if (!targetNode.enabled) {
        this.db.prepare(`
          UPDATE node_runs SET status='skipped', output_summary='{"skipped":true,"reason":"node_disabled"}',
          duration_ms=0, updated_at=? WHERE id=?
        `).run(Date.now(), nodeRun.id);
        this.scheduleNextNode(sortedNodes, targetNode, nodeRun, runCtx);
        return;
      }

      const res = await handler(this.services, targetNode.config || {}, asset, runCtx);
      const durationMs = Date.now() - startTs;

      if (res.requeue) {
        const notBefore = Date.now() + (res.backoffMs || 8000);
        this.db.prepare(`
          UPDATE node_runs SET status='queued', error=?, output_summary=?, duration_ms=?, not_before=?, updated_at=? WHERE id=?
        `).run(
          res.error || 'requeue',
          JSON.stringify(res.output || {}),
          durationMs,
          notBefore,
          Date.now(),
          nodeRun.id
        );
        this.logger.info?.(`[interpreter] 资产 ${asset.fid} 节点 ${targetNode.id} 排队重试 ${res.backoffMs || 8000}ms`);
        return;
      }

      // 致命排除中断 (如 Gate 判定非素材)
      if (res.excluded) {
        this.db.prepare(`
          UPDATE node_runs SET status='done', output_summary=?, duration_ms=?, updated_at=? WHERE id=?
        `).run(JSON.stringify(res.output || {}), durationMs, Date.now(), nodeRun.id);
        // 状态归位：AI 判定「不是素材」必须真正落到回收站，否则素材会带着 ready 状态
        // 继续混在列表里（2026-10-02 状态统一机制）。判定原文一并留存供客户端展示。
        // 判定理由要做 undefined 兜底：节点只回 { excluded:true } 而不给 reason 时，
        // 直接模板拼接会产出「闸门判定非素材：undefined」这种脏文案。
        const verdict = [res.reason, res.output && res.output.reason]
          .map((x) => String(x == null ? '' : x).trim())
          .find((x) => x && x !== 'undefined' && x !== 'null');
        try {
          const assetsDelete = require('./assets-delete');
          assetsDelete.softDeleteAsset(this.services, asset.fid, {
            deletedBy: 'interpreter-gate',
            reason: 'gate_reject',
            disposeSource: 'gate_reject',
            disposeDetail: verdict
              ? `闸门判定非素材：${verdict}`
              : '闸门判定非素材（AI 未给出具体理由）',
          });
        } catch (e) {
          this.logger.warn?.(`[interpreter] 资产 ${asset.fid} 闸门排除落回收站失败：${e.message}`);
        }
        this.logger.info?.(`[interpreter] 资产 ${asset.fid} 在节点 ${targetNode.id} 闸门排除，已入回收站并中断下游链路`);
        return;
      }

      // 非致命失败或正常成功
      const status = res.success ? (res.skipped ? 'skipped' : 'done') : 'failed';
      const derivId = res.derivative?.id || null;

      this.db.prepare(`
        UPDATE node_runs SET status=?, output_summary=?, derivative_id=?, error=?, duration_ms=?, updated_at=? WHERE id=?
      `).run(
        status,
        JSON.stringify(res.output || {}),
        derivId,
        res.error || null,
        durationMs,
        Date.now(),
        nodeRun.id
      );

      if (res.flags && res.flags.length > 0) {
        runCtx.accumulatedFlags.push(...res.flags);
      }
      runCtx.lastOutput = res.output;

      // 流转至下游节点
      this.scheduleNextNode(sortedNodes, targetNode, nodeRun, runCtx);
    } catch (e) {
      const durationMs = Date.now() - startTs;
      this.db.prepare(`
        UPDATE node_runs SET status='failed', error=?, duration_ms=?, updated_at=? WHERE id=?
      `).run(String(e.message).slice(0, 300), durationMs, Date.now(), nodeRun.id);

      this.logger.error?.(`[interpreter] 节点 ${targetNode.id} 执行失败 (fid=${asset.fid}): ${e.message}`);
    }
  }

  isBacklogAsset(fid) {
    const asset = this.db.prepare('SELECT fid, kind, source, file_name, status, discovered_at, created_at FROM assets WHERE fid=?').get(fid);
    return isBacklogAssetRow(asset);
  }

  isVideoAsset(fid) {
    const asset = this.db.prepare('SELECT fid, kind, file_name FROM assets WHERE fid=?').get(fid);
    return isVideoAssetRow(asset);
  }

  scheduleNextNode(sortedNodes, currentNode, nodeRun, runCtx) {
    if (nodeRun.run_id) {
      const trigger = this.db.prepare('SELECT trigger FROM runs WHERE id=?').get(nodeRun.run_id)?.trigger;
      if (trigger === 'restage_backfill') return;
    }
    const currentIndex = sortedNodes.findIndex(n => n.id === currentNode.id);
    if (currentIndex < 0 || currentIndex >= sortedNodes.length - 1) return;

    // 寻找下一个节点
    let nextIndex = currentIndex + 1;
    let nextNode = sortedNodes[nextIndex];
    if (!nextNode) return;

    const now = Date.now();

    // 视频素材或历史积压资产跳过画幅重构 (restage_dual / restage_9_16)，直接排上下游向量入库
    if (this.isRestageType(nextNode.type)) {
      const isVideo = this.isVideoAsset(nodeRun.asset_fid);
      const isBacklog = !isVideo && this.isBacklogAsset(nodeRun.asset_fid);
      if (isVideo || isBacklog) {
        const reason = isVideo ? 'video_skip_restage' : 'backlog_skip_restage';
        this.db.prepare(`
          INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, error, output_summary, created_at, updated_at, not_before)
          VALUES (?, ?, ?, ?, ?, 'skipped', ?, ?, ?, ?, NULL)
          ON CONFLICT(workflow_version, node_id, asset_fid) DO UPDATE SET
            status='skipped', error=excluded.error, output_summary=excluded.output_summary, run_id=excluded.run_id, updated_at=excluded.updated_at, not_before=NULL
        `).run(nodeRun.run_id, nodeRun.workflow_version, nextNode.id, nextNode.type, nodeRun.asset_fid, reason, JSON.stringify({ reason }), now, now);

        nextIndex++;
        nextNode = sortedNodes[nextIndex];
        if (!nextNode) return;
      }
    }

    this.db.prepare(`
      INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, created_at, updated_at, not_before)
      VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, NULL)
      ON CONFLICT(workflow_version, node_id, asset_fid) DO UPDATE SET
        status='queued', error=NULL, run_id=excluded.run_id, updated_at=excluded.updated_at, not_before=NULL
    `).run(nodeRun.run_id, nodeRun.workflow_version, nextNode.id, nextNode.type, nodeRun.asset_fid, now, now);
  }

  settleFinishedRuns() {
    const runningRuns = this.db.prepare("SELECT * FROM runs WHERE status IN ('running', 'queued')").all();
    for (const r of runningRuns) {
      const stats = this.db.prepare(`
        SELECT
          SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as s,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as f,
          SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) as pending
        FROM node_runs WHERE run_id=?
      `).get(r.id);

      if ((stats.pending || 0) === 0) {
        const status = (stats.f || 0) > 0 ? 'partial_failed' : 'done';
        this.db.prepare(`
          UPDATE runs SET status=?, success_count=?, failed_count=?, finished_at=?, updated_at=? WHERE id=?
        `).run(status, stats.s || 0, stats.f || 0, Date.now(), Date.now(), r.id);
      } else {
        this.db.prepare(`
          UPDATE runs SET success_count=?, failed_count=?, updated_at=? WHERE id=?
        `).run(stats.s || 0, stats.f || 0, Date.now(), r.id);
      }
    }
  }
}

module.exports = {
  WorkflowInterpreter,
  topologicalSort,
  validateWorkflowGraph,
  recoverCrashedRuns,
  migrateJobsLegacy,
  isBacklogAssetRow,
  reconcileBacklogTasks
};
