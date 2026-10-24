/**
 * 多模型挂载回归（workflow_modules.model_ids_json → config.modelIds 通道链）
 *
 * 用 Node 内置 node:sqlite 代替 better-sqlite3（Windows 侧跑不了 Linux 原生模块）。
 * Node < 22.5 没有 node:sqlite 时自动跳过，不阻塞其它测试。
 *
 * 运行：node test/test_multi_model_mount.js
 */
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (_) {
  console.log('⏭  当前 Node 没有 node:sqlite，跳过多模型挂载回归');
  process.exit(0);
}

const mc = require('../src/models-contract');

let pass = 0;
let fail = 0;
function eq(label, got, want) {
  const ok = String(got) === String(want);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✔' : '✘'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
}

const db = new DatabaseSync(':memory:');
mc.initModelRegistryTables(db);

db.prepare(`
  INSERT OR REPLACE INTO workflow_mount_points
    (id, name, category, description, trigger_type, trigger_config_json, is_builtin, order_num, enabled, created_at, updated_at)
  VALUES ('ingest_post_process','入库后处理','post','test','event','{}',0,1,1,0,0)
`).run();

const MOUNT = 'ingest_post_process';
const CHAIN = ['agnes_image_2_5_flash', 'qwenimage_local', 'qwenimage_modelscope'];

console.log('=== 1. 多模型存取 ===');
const saved = mc.saveMountModule(db, {
  id: 'mod_test_1',
  mount_point_id: MOUNT,
  name: 'AI 双比例画幅重构',
  node_type: 'restage_dual',
  model_ids: CHAIN,
});
eq('保存返回 model_ids', JSON.stringify(saved.model_ids), JSON.stringify(CHAIN));
eq('保存返回 model_id = 首项', saved.model_id, 'agnes_image_2_5_flash');

const mods = mc.getMountModules(db, MOUNT);
eq('读取条数', mods.length, 1);
eq('读取 model_ids', JSON.stringify(mods[0].model_ids), JSON.stringify(CHAIN));

console.log('=== 2. 兼容性 ===');
db.prepare(`INSERT INTO workflow_modules
  (id, mount_point_id, name, node_type, model_id, prompt_id, prompt_override, condition_expr, branch_group, snippet_ids_json, input_mappings_json, params_json, order_num, enabled, created_at, updated_at)
  VALUES ('mod_old', ?, '老节点', 'restage_dual', 'qwenimage_local', NULL, '', '', '', '[]', '{}', '{}', 2, 1, 0, 0)`).run(MOUNT);
const oldMod = mc.getMountModules(db, MOUNT).find((m) => m.id === 'mod_old');
eq('老行（只有 model_id）回填成数组', JSON.stringify(oldMod.model_ids), JSON.stringify(['qwenimage_local']));

const savedLegacy = mc.saveMountModule(db, {
  id: 'mod_test_1', mount_point_id: MOUNT, name: '单选', node_type: 'restage_dual', model_id: 'qwenimage_local',
});
eq('老前端单选 → 数组长度 1', savedLegacy.model_ids.length, 1);
eq('老前端单选 → 首项一致', savedLegacy.model_ids[0], 'qwenimage_local');

const savedEmpty = mc.saveMountModule(db, {
  id: 'mod_test_1', mount_point_id: MOUNT, name: '纯本地', node_type: 'restage_dual', model_id: null, model_ids: [],
});
eq('清空后 model_ids 为空', savedEmpty.model_ids.length, 0);
eq('清空后 model_id 为空', savedEmpty.model_id, 'null');

console.log('=== 3. 同步到运行时工作流图 ===');
db.exec(`CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, name TEXT, version INTEGER, is_default INTEGER, graph_json TEXT, created_at INTEGER, updated_at INTEGER)`);
db.prepare(`INSERT OR REPLACE INTO workflows (id, name, version, is_default, graph_json, created_at, updated_at)
  VALUES ('default','默认',1,1,?,0,0)`).run(JSON.stringify({
  nodes: [{ id: 'restage_dual', type: 'restage_dual', config: {} }],
  edges: [],
}));
mc.saveMountModule(db, {
  id: 'mod_test_1', mount_point_id: MOUNT, name: 'AI 双比例画幅重构', node_type: 'restage_dual', model_ids: CHAIN,
});
const graph = JSON.parse(db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get().graph_json);
const node = graph.nodes.find((n) => n.id === 'restage_dual');
eq('config.model = 主模型', node.config.model, 'agnes_image_2_5_flash');
eq('config.modelIds = 完整链', JSON.stringify(node.config.modelIds), JSON.stringify(CHAIN));

console.log(`\n${fail ? `${fail} 项失败` : `全部通过（${pass} 项）`}`);
process.exit(fail ? 1 : 0);
