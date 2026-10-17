const { openDb } = require('../src/db');
const path = require('path');
const os = require('os');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);

console.log('--- 资产状态分布 ---');
console.log(db.prepare("SELECT status, count(*) c FROM assets GROUP BY status").all());

console.log('\n--- 资产打标情况 ---');
const totalAssets = db.prepare("SELECT count(*) c FROM assets").get().c;
const taggedAssets = db.prepare("SELECT count(DISTINCT asset_fid) c FROM asset_tags").get().c;
console.log(`总资产数: ${totalAssets}, 拥有标签的资产数: ${taggedAssets}`);

console.log('\n--- 标签维度分布 ---');
console.log(db.prepare(`
  SELECT t.dimension, count(DISTINCT at.asset_fid) as asset_count, count(*) as tag_count
  FROM asset_tags at
  JOIN tag_dict t ON t.id = at.tag_id
  GROUP BY t.dimension
`).all());

console.log('\n--- 默认工作流定义 ---');
const wf = db.prepare("SELECT * FROM workflows WHERE id='default'").get();
if (wf) {
  const graph = JSON.parse(wf.graph_json || '{}');
  console.log('工作流版本:', wf.version, '名称:', wf.name);
  console.log('工作流节点列表:', graph.nodes?.map(n => ({ id: n.id, type: n.type, enabled: n.enabled, model: n.config?.model })));
} else {
  console.log('未找到 default 工作流');
}

console.log('\n--- 工作流批次与运行历史 ---');
console.log('最近批次:', db.prepare("SELECT id, trigger, status, asset_count, success_count, failed_count, created_at FROM runs ORDER BY id DESC LIMIT 3").all());
