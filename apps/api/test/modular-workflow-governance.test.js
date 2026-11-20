/**
 * 三级架构工作流编排（大框架挂载点 + 中框架工作流与子节点 + 小框架算子/提示词/公共积木/词典芯片/模型三开关）全量自动化测试
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  initModelRegistryTables,
  interpolateVariables,
  expandDictMacros,
  getDictMacroChips,
  compileNodePrompt,
  getOperatorCatalog,
  getPromptSnippetsList,
  savePromptSnippet,
  deletePromptSnippet,
  restorePromptSnippetDefault,
  getPromptTemplatesList,
  savePromptTemplate,
  deletePromptTemplate,
  restorePromptTemplateDefault,
  getMountPointsList,
  saveMountPoint,
  deleteMountPoint,
  getMountModules,
  saveMountModule,
  deleteMountModule,
  reorderMountModules,
  saveEndpointData,
  deleteEndpointData,
  getEndpointsList,
  getModelContractsList,
  saveModelContractData,
  syncMountPointsToWorkflowGraph,
} = require(path.join(root, 'src/models-contract'));

const { NODE_REGISTRY } = require(path.join(root, 'src/nodes/index'));
const { calibrateGeneratedImage } = require(path.join(root, 'src/ratio'));

async function runTests() {
  console.log('=== 测试 1：n8n 风格变量插槽与 {{@dict.xxx}} 动态标签词典芯片解析引擎 ===');
  const context = {
    $node: {
      gate: { category: 'interior', reason: '客厅实景软装完整' },
      tag: { space: '客厅', style: '现代极简' }
    },
    nodes: {
      gate: { category: 'interior', reason: '客厅实景软装完整' },
      tag: { space: '客厅', style: '现代极简' }
    },
    asset: {
      fid: 'asset_123',
      file_name: 'living_room.jpg',
      width: 1920,
      height: 1080
    }
  };

  const tpl1 = '根据闸门分类 {{$node["gate"].category}} 和标签 {{nodes.tag.space}} 生成效果图，源文件: {{asset.file_name}}';
  const res1 = interpolateVariables(tpl1, context);
  assert.strictEqual(res1, '根据闸门分类 interior 和标签 客厅 生成效果图，源文件: living_room.jpg');

  const tpl2 = '单引号测试: {{$node[\'gate\'].reason}}';
  const res2 = interpolateVariables(tpl2, context);
  assert.strictEqual(res2, '单引号测试: 客厅实景软装完整');

  const tplNull = '未知字段: {{$node["missing"].foo}} 结束';
  const resNull = interpolateVariables(tplNull, context);
  assert.strictEqual(resNull, '未知字段:  结束');
  console.log('✔ 测试 1 通过');

  console.log('=== 测试 2：预置节点算子库 (28+ 算子)、公共提示词积木与业务提示词中心 CRUD ===');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT,
      version INTEGER DEFAULT 1,
      graph_json TEXT,
      updated_at INTEGER
    );
    INSERT INTO workflows (id, name, version, graph_json, updated_at)
    VALUES ('default', '默认产线', 1, '{"nodes":[{"id":"materialize","type":"materialize"},{"id":"qc","type":"qc"},{"id":"gate","type":"gate"},{"id":"tag","type":"tag"},{"id":"cluster","type":"cluster"},{"id":"restage_dual","type":"restage_dual"},{"id":"index","type":"index"},{"id":"backup","type":"backup"}],"edges":[]}', 0);

    CREATE TABLE IF NOT EXISTS tag_dict (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dimension TEXT NOT NULL,
      dir TEXT NOT NULL,
      label TEXT NOT NULL,
      aliases TEXT,
      criteria TEXT,
      deprecated INTEGER DEFAULT 0
    );
    INSERT INTO tag_dict (dimension, dir, label, aliases, criteria, deprecated)
    VALUES
      ('space', 'living_room', '客厅', '["起居室"]', '主沙发与电视茶几核心会客区', 0),
      ('style_atom', 'cream_style', '奶油风', '["温柔奶油"]', '无法式线脚的浅暖米白软融质感', 0);
  `);
  initModelRegistryTables(db);

  const operators = getOperatorCatalog();
  assert.ok(operators.length >= 25, `预置节点算子数量必须 >= 25，实得 ${operators.length}`);
  assert.ok(operators.some(o => o.type === 'video_slice'), '必须预置视频镜头智能切片算子 video_slice');
  assert.ok(operators.some(o => o.type === 'video_extract_frames'), '必须预置视频抽帧算子 video_extract_frames');
  assert.ok(operators.some(o => o.type === 'algo_cutout'), '必须预置泛洪抠底算子 algo_cutout');
  for (const op of operators) {
    assert.strictEqual(op.id, op.type, `算子 id 必须统一为下划线 type: ${op.type}`);
    assert.strictEqual(op.code, op.type, `算子 code 必须统一为下划线 type: ${op.type}`);
    assert.ok(!op.type.includes('.'), `算子标识不得再混用点号风格: ${op.type}`);
  }

  const snippets = getPromptSnippetsList(db);
  assert.ok(snippets.length >= 6, `预置公共提示词积木数量必须 >= 6，实得 ${snippets.length}`);
  const realismSnip = snippets.find(s => s.id === 'snippet_interior_realism');
  assert.ok(realismSnip, '必须存在《室内实拍真实感与反塑料感》公共积木');
  assert.ok(realismSnip.positive_text.includes('墙顶按真实刷漆'));

  const prompts = getPromptTemplatesList(db);
  assert.ok(prompts.length >= 18, `预置提示词数量必须 >= 18，实得 ${prompts.length}`);

  const tagP = prompts.find(p => p.id === 'tag_space_interior');
  assert.ok(tagP && tagP.template.includes('{{@dict.space}}'), '室内打标模板必须包含 {{@dict.space}} 动态词典宏');
  const expandedTag = expandDictMacros(db, tagP.template);
  assert.ok(expandedTag.includes('living_room(客厅(起居室))｜主沙发与电视茶几核心会客区'), '词典芯片必须实时展开 tag_dict 中的 dir、别名与视觉判据');

  // 测试自定义修改与“恢复官方默认”
  savePromptTemplate(db, {
    id: 'gate_interior',
    name: '用户自定义修改的门禁',
    category: 'gate',
    template: '自定义精简门禁内容'
  });
  const modified = getPromptTemplatesList(db).find(p => p.id === 'gate_interior');
  assert.strictEqual(modified.template, '自定义精简门禁内容');

  restorePromptTemplateDefault(db, 'gate_interior');
  const restored = getPromptTemplatesList(db).find(p => p.id === 'gate_interior');
  assert.ok(restored.template.includes('你是素材库分拣员'), '恢复官方默认后必须还原为官方基线');
  console.log('✔ 测试 2 通过');

  console.log('=== 测试 3：三级架构工作流与工作流节点全量 CRUD、克隆及编译转译 ===');
  const mountPoints = getMountPointsList(db);
  assert.ok(mountPoints.length >= 8, `必须预置 >= 8 条核心与扩展工作流，实得 ${mountPoints.length}`);

  const ingestPre = mountPoints.find(mp => mp.id === 'ingest_pre_gate');
  assert.ok(ingestPre);
  assert.strictEqual(ingestPre.modules.length, 3);
  assert.deepStrictEqual(ingestPre.modules.map(m => m.node_type), ['script_qc', 'gate', 'defect']);

  // 验证 workflows.default 已自动同步接入 defect 节点
  const wfDefaultRow = db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get();
  const wfDefaultGraph = JSON.parse(wfDefaultRow.graph_json);
  assert.ok(
    wfDefaultGraph.nodes.some(n => n.type === 'defect' || n.id === 'defect'),
    'workflows.default 实际入库图必须自动接入 defect 视觉缺陷拦截节点'
  );

  const videoWf = mountPoints.find(mp => mp.id === 'wf_video_slice_frame');
  assert.ok(videoWf, '必须预置视频镜头切片与关键帧抽帧工作流');
  assert.ok(videoWf.modules.some(m => m.node_type === 'video_slice'));
  assert.ok(videoWf.modules.some(m => m.node_type === 'video_extract_frames'));

  // 测试模型三开关 + 公共积木 + 任务模板的统一编译 (append_prompt vs field)
  const compiledReplace = compileNodePrompt(db, {
    mountPointId: 'precision_edit',
    nodeType: 'edit_replace',
    modelId: 'seedream5pro',
    vars: {
      box1Tag: '100 200 500 600',
      product_name: '胡桃木单椅',
      facing_desc: '正面朝向观察者',
    },
  });
  assert.ok(compiledReplace.prompt.includes('<bbox>100 200 500 600</bbox>'), 'Seedream 5.0 Pro 必须按 coords_bbox 开关自动注入 <bbox>');
  assert.ok(compiledReplace.prompt.includes('参考图2'), 'Seedream 5.0 Pro 必须按 图N 开关转译参考图2');
  assert.ok(compiledReplace.prompt.includes('墙顶按真实刷漆'), '必须自动叠加勾选的《室内实拍真实感》公共积木');
  assert.ok(compiledReplace.prompt.includes('【严禁出现】'), '必须按 append_prompt 开关将负向词附在正文末尾');
  assert.strictEqual(compiledReplace.negative_prompt, '', 'append_prompt 模式下独立 negative_prompt 字段应置空');

  const compiledFieldMode = compileNodePrompt(db, {
    mountPointId: 'precision_edit',
    nodeType: 'edit_expand',
    modelId: 'umbra.expand',
  });
  assert.ok(!compiledFieldMode.prompt.includes('【严禁出现】'), 'negative_mode=field 时不得将【严禁出现】拼进正向 prompt');
  assert.ok(compiledFieldMode.negative_prompt.includes('黑边'), 'negative_mode=field 时负向词必须进入独立 negative_prompt 字段');

  // 测试克隆工作流及子节点增删改
  saveMountPoint(db, {
    id: 'mp_custom_video_clone',
    name: '克隆视频处理流',
    category: 'video',
    clone_from_id: 'wf_video_slice_frame',
    trigger_type: 'api',
  });
  let clonedMods = getMountModules(db, 'mp_custom_video_clone');
  assert.strictEqual(clonedMods.length, videoWf.modules.length, '克隆工作流必须完整复制所有子工作流节点');

  deleteMountPoint(db, 'mp_custom_video_clone');
  assert.ok(!getMountPointsList(db).some(mp => mp.id === 'mp_custom_video_clone'));
  console.log('✔ 测试 3 通过');

  console.log('=== 测试 4：供应商全量 CRUD 与安全级联 ===');
  saveEndpointData(db, {
    id: 'custom_llm_server',
    name: '自定义私有推理网关',
    base_url: 'http://192.168.1.200:8000/v1',
    auth_type: 'bearer',
    credentials: ['CUSTOM_LLM_KEY'],
    capabilities: [
      { id: 'custom_chat', name: '私有对话', kind: 'chat', path: '/chat/completions', method: 'POST' }
    ]
  });
  saveModelContractData(db, {
    id: 'custom_deepseek',
    name: '私有 DeepSeek 模型',
    vendor_model_id: 'deepseek-v3',
    capability_id: 'custom_chat',
    dialect: { region_mode: 'vlm_text', ref_syntax: '@图片N', negative_mode: 'field' },
    enabled: 1
  });
  const savedModel = getModelContractsList(db).models.find(m => m.id === 'custom_deepseek');
  assert.strictEqual(savedModel.dialect.region_mode, 'vlm_text');

  assert.throws(() => {
    deleteEndpointData(db, 'custom_llm_server');
  }, /仍有 1 个模型契约正在使用/);

  db.prepare('DELETE FROM model_contracts WHERE id=?').run('custom_deepseek');
  deleteEndpointData(db, 'custom_llm_server');
  console.log('✔ 测试 4 通过');

  console.log('=== 测试 5：节点执行器注册与非空壳校验 ===');
  for (const op of operators) {
    assert.ok(typeof NODE_REGISTRY[op.type] === 'function', `NODE_REGISTRY 必须注册算子 ${op.type}`);
  }
  await assert.rejects(
    async () => NODE_REGISTRY.edit_replace({}, {}, {}, {}),
    /缺少必要交互入参/,
    '缺少交互入参的算子必须明确报错，不得返回假成功 stub'
  );
  console.log('✔ 测试 5 通过');

  console.log('=== 测试 6：净画重构纯字节复制零重编码 & 前后端差距报告一致性校验 ===');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml_gap_test_'));
  const rawSrc = path.join(tmpDir, 'src_raw.bin');
  const rawDest = path.join(tmpDir, 'dest_raw.bin');
  const randomBytes = Buffer.from('RAW_MODEL_IMAGE_BYTES_DO_NOT_REENCODE_2026_10_17');
  fs.writeFileSync(rawSrc, randomBytes);
  const calOut = await calibrateGeneratedImage(rawSrc, rawDest, '9:16', '1080p');
  assert.strictEqual(calOut.strategy, 'raw_byte_copy', 'calibrateGeneratedImage 必须采用 raw_byte_copy 策略');
  assert.strictEqual(Buffer.compare(fs.readFileSync(rawSrc), fs.readFileSync(rawDest)), 0, '重构出图落盘必须逐字节 100% 一致，禁止重编码');

  const nodesIndexCode = fs.readFileSync(path.join(root, 'src/nodes/index.js'), 'utf8');
  assert.ok(!nodesIndexCode.includes('composeRatioCanvas'), 'nodes/index.js 严禁再引用或调用 composeRatioCanvas');

  const appVueCode = fs.readFileSync(path.join(root, 'web/src/App.vue'), 'utf8');
  assert.ok(!appVueCode.includes('to="/workflow"'), 'App.vue 左侧导航栏必须移除独立的 /workflow 菜单项');
  assert.ok(!appVueCode.includes('to="/adapters"'), 'App.vue 左侧导航栏不得包含 /adapters 菜单项');

  const modelsVueCode = fs.readFileSync(path.join(root, 'web/src/views/ModelsView.vue'), 'utf8');
  assert.ok(modelsVueCode.includes('sandboxAssetFids'), 'ModelsView.vue 必须支持勾选 1~3 张已有素材图 (sandboxAssetFids)');
  assert.ok(!modelsVueCode.includes('mod.operator_spec?.code'), 'ModelsView.vue 必须统一展示下划线算子 ID');
  console.log('✔ 测试 6 通过');

  console.log('\n🎉 全部三级架构、工作流节点 CRUD、差距报告 7 项一致性与编译器测试 100% 通过！');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
