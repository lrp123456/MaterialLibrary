/**
 * 入队 tag 节点重打标（P3）。
 * 用法: node scripts/queue-retag.js [batchSize] [total]
 * 默认 batch 200，total 5000；跳过已有本轮成功 tag 的资产（按 created_at 更简单：按 status 排序）。
 */
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { openDb } = require('../src/db');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const batch = Number(process.argv[2] || 200);
const total = Number(process.argv[3] || 5000);
const db = openDb(dataDir);

const wf = db.prepare(`SELECT * FROM workflows WHERE id='default' ORDER BY version DESC LIMIT 1`).get();
if (!wf) {
  console.error('no default workflow');
  process.exit(1);
}
const graph = JSON.parse(wf.graph_json || '{}');
const tagNode = (graph.nodes || []).find(n => n.type === 'tag' || n.id === 'tag');
if (!tagNode) {
  console.error('no tag node in graph');
  process.exit(1);
}

// 当前排队中的 tag 数量
const inflight = db.prepare(
  `SELECT COUNT(*) c FROM node_runs WHERE node_type='tag' AND status IN ('queued','running')`
).get().c;
if (inflight >= 400) {
  console.log('[retag] inflight', inflight, '— 等消化后再入队');
  process.exit(0);
}

// 优先：本地有原件、且很久没打过新标（或无 tag 记录）
const rows = db.prepare(`
  SELECT a.fid FROM assets a
  WHERE a.kind='image'
    AND NOT EXISTS (
      SELECT 1 FROM node_runs nr
      WHERE nr.asset_fid=a.fid AND nr.node_type='tag' AND nr.status IN ('queued','running')
    )
  ORDER BY a.discovered_at ASC
  LIMIT ?
`).all(Math.min(batch, Math.max(0, total - 0)));

if (!rows.length) {
  console.log('[retag] no candidates');
  process.exit(0);
}

const runId = `retag_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const now = Date.now();
const tx = db.transaction(() => {
  db.prepare(`
    INSERT INTO runs (id, workflow_id, workflow_version, trigger, status, asset_count, created_at)
    VALUES (?, ?, ?, 'manual_retag', 'queued', ?, ?)
  `).run(runId, wf.id, wf.version, rows.length, now);
  const ins = db.prepare(`
    INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, created_at, updated_at)
    VALUES (?, ?, ?, 'tag', ?, 'queued', ?, ?)
    ON CONFLICT(workflow_version, node_id, asset_fid) DO UPDATE SET
      status='queued', error=NULL, run_id=excluded.run_id, updated_at=excluded.updated_at, not_before=NULL
  `);
  for (const r of rows) ins.run(runId, wf.version, tagNode.id, r.fid, now, now);
});
tx();
const left = db.prepare(`SELECT COUNT(*) c FROM node_runs WHERE node_type='tag' AND status='queued'`).get().c;
console.log(JSON.stringify({ runId, queued: rows.length, tagQueued: left, inflightBefore: inflight }));
db.close();
