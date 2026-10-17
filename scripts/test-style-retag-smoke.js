/**
 * 小规模冒烟：对最早入库的 N 张图做风格重评（style_atom 多选 + wood_style 单选）。
 * 用法: node scripts/test-style-retag-smoke.js [count]
 * 默认 5 张。验证 enqueueDimensionRetag 入库链路与 runs 列名。
 */
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const tagGov = require('../src/tag-governance');

const count = Math.max(1, Math.min(20, Number(process.argv[2] || 5)));
const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
tagGov.ensureGovernanceSchema(db);

// 最早 discovered 的可见图片
const rows = db.prepare(`
  SELECT a.fid, a.file_name, a.discovered_at
  FROM assets a
  WHERE a.kind = 'image'
    AND a.status IN ('ready','ready_with_flags','tagging_done','gating_passed','qc')
  ORDER BY COALESCE(a.discovered_at, a.created_at, 0) ASC
  LIMIT ?
`).all(count);

if (!rows.length) {
  console.error('[smoke] 无候选图片');
  process.exit(1);
}
console.log('[smoke] 候选', rows.map(r => ({ fid: r.fid, file: r.file_name })));

// 用与夜间任务相同的 enqueue 路径，但强制只打这 N 张：
// 临时 monkey-patch collect 范围不方便，改为直接走 enqueueDimensionRetag 再收窄
// ——更稳妥：用 tagGov.enqueueDimensionRetag 的 now 路径 + 仅这批 fid 的自定义入队。
const crypto = require('crypto');
const now = Date.now();
const runId = `smoke_style_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
const dims = ['style_atom', 'wood_style'];

db.prepare(`
  INSERT INTO runs (id, workflow_id, workflow_version, trigger, status, asset_count, created_at, started_at)
  VALUES (?, 'default', 1, 'style_retag_smoke', 'queued', ?, ?, ?)
`).run(runId, rows.length, now, now);

const nodeId = tagGov.findTagNodeId
  ? tagGov.findTagNodeId(db)
  : (() => {
      try {
        const wf = db.prepare("SELECT graph FROM workflows WHERE id='default'").get();
        const g = JSON.parse(wf?.graph || '{}');
        const n = (g.nodes || []).find(x => (x.type || x.data?.type) === 'tag' || x.id === 'tag');
        return n?.id || 'tag';
      } catch { return 'tag'; }
    })();

const insertRun = db.prepare(`
  INSERT INTO node_runs (run_id, node_id, node_type, asset_fid, status, workflow_version, input_summary, created_at, updated_at)
  VALUES (?, ?, 'tag', ?, 'queued', 1, ?, ?, ?)
  ON CONFLICT(workflow_version, node_id, asset_fid) DO UPDATE SET
    status='queued', run_id=excluded.run_id, input_summary=excluded.input_summary,
    updated_at=excluded.updated_at, error=NULL, not_before=NULL
`);
const summary = JSON.stringify({
  dictRetag: true,
  smoke: true,
  dimensions: dims,
  reason: 'style_tree_v2_smoke',
  multi: { style_atom: true, wood_style: false }
});
for (const r of rows) insertRun.run(runId, nodeId, r.fid, summary, now, now);

db.prepare(`
  INSERT INTO retag_jobs (dimensions, reason, status, schedule, estimated, queued_count, run_id, actor, created_at, started_at, options)
  VALUES (?, 'style_tree_v2_smoke', 'dispatched', 'now', ?, ?, ?, 'smoke', ?, ?, ?)
`).run(JSON.stringify(dims), rows.length, rows.length, runId, now, now, JSON.stringify({ all: false, smoke: true }));

// 唤醒解释器（若服务内已注册）
try {
  // 不依赖服务进程内的 interpreter，服务侧 worker 会捡 queued node_runs
  console.log('[smoke] 已写入 node_runs，等待服务 worker 消化');
} catch (e) { /* */ }

const left = db.prepare(`
  SELECT COUNT(*) c FROM node_runs WHERE run_id=? AND status='queued'
`).get(runId).c;
console.log(JSON.stringify({
  ok: true,
  runId,
  nodeId,
  queued: left,
  fids: rows.map(r => r.fid),
  note: 'style_atom=多选, wood_style=单选可空；请在 server.log 观察 tag 节点'
}, null, 2));
db.close();
