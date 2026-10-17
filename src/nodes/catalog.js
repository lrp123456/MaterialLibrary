/**
 * 工作流节点目录：统一从 operator-catalog 导出全量预置节点算子与默认产线图
 */
const { GATE_PROMPT } = require('../gate-route');
const { OPERATOR_CATALOG, OFFICIAL_PROMPT_TEMPLATES } = require('./operator-catalog');

const RESTAGE_PROMPT = OFFICIAL_PROMPT_TEMPLATES.style_restage_dual.template;

const NODE_CATALOG = OPERATOR_CATALOG.map((op) => ({
  id: op.type,
  type: op.type,
  code: op.type,
  name: op.name,
  category: op.category,
  categoryLabel: op.categoryLabel,
  description: op.description,
  icon: op.icon,
  needsModel: op.needsModel,
  modelDomain: op.modelDomain,
  needsPrompt: op.needsPrompt,
  defaultPromptId: op.defaultPromptId,
  supportsSnippets: op.supportsSnippets,
  defaultSnippets: op.defaultSnippets || [],
  outputs: op.outputs || [],
  defaultConfig: {
    ...(op.defaultModelId ? { model: op.defaultModelId } : {}),
    ...(op.defaultPromptId ? { promptId: op.defaultPromptId } : {}),
    ...(op.defaultSnippets?.length ? { snippetIds: op.defaultSnippets } : {}),
    ...(op.defaultParams || {}),
  },
}));

// 兼容旧版节点名 'qc'、'clean'、'restage_9_16'
if (!NODE_CATALOG.some((n) => n.type === 'qc')) {
  NODE_CATALOG.push({
    id: 'qc',
    type: 'qc',
    code: 'qc',
    name: '本地质检',
    category: 'image_algo',
    description: 'sharp 量宽高、pHash、色板、画幅真值分桶',
    icon: 'straighten',
    defaultConfig: { phashThreshold: 8, minShortSide: 480, minBytes: 15360, barRatio: 0.06, minLaplacianVar: 35 },
  });
}
if (!NODE_CATALOG.some((n) => n.type === 'clean')) {
  NODE_CATALOG.push({
    id: 'clean',
    type: 'clean',
    code: 'clean',
    name: '去水印',
    category: 'image_ai',
    description: '统一网关 watermark_remove；未配置网关时非致命跳过',
    icon: 'cleaning_services',
    defaultConfig: { adapterId: 'unified_gateway' },
  });
}
if (!NODE_CATALOG.some((n) => n.type === 'restage_9_16')) {
  NODE_CATALOG.push({
    id: 'restage_9_16',
    type: 'restage_9_16',
    code: 'restage_9_16',
    name: '9:16 重构',
    category: 'image_ai',
    description: '兼容旧图：只生成 9:16',
    icon: 'crop_16_9',
    defaultConfig: {
      adapterId: 'agnes_image',
      model: 'agnes-image-2.5-flash',
      promptTemplate: RESTAGE_PROMPT,
      sizePreset: '1080p',
      skipIfVertical: true,
    },
  });
}

function defaultNode(type, { id, x, y, db } = {}) {
  const spec = NODE_CATALOG.find(n => n.type === type);
  if (!spec) throw new Error(`未知节点类型: ${type}`);
  const node = {
    id: id || type,
    type: spec.type,
    name: spec.name,
    enabled: type !== 'backup' && type !== 'clean' && type !== 'restage_9_16',
    config: JSON.parse(JSON.stringify(spec.defaultConfig || {})),
    position: { x: x || 80, y: y || 160 }
  };
  if (db) {
    try {
      require('../gen-governance').applyBindingToNodeConfig(db, node);
    } catch (_) {}
  }
  return node;
}

function buildDefaultWorkflowGraph(db) {
  const specs = ['materialize', 'gate', 'defect', 'qc', 'tag', 'cluster', 'restage_dual', 'index', 'backup'];
  const nodes = specs.map((type, i) => {
    const n = defaultNode(type, { x: 64 + i * 200, y: 150, db });
    if (type === 'backup') n.enabled = false;
    if (type === 'tag') n.config.skipCluster = true;
    return n;
  });
  const edges = [];
  for (let i = 0; i < specs.length - 1; i++) {
    edges.push({
      id: `e_${specs[i]}_${specs[i + 1]}`,
      source: specs[i],
      target: specs[i + 1]
    });
  }
  return {
    nodes,
    edges,
    trigger: { scanIntervalMs: 1800000, imageOnly: true }
  };
}

function shouldUpgradeDefaultGraph(graph) {
  const nodes = graph?.nodes || [];
  const types = nodes.map(n => n.type);
  if (types.includes('clean') && !types.includes('restage_dual')) return true;
  if (types.includes('restage_9_16') && !types.includes('restage_dual') && !types.includes('cluster')) return true;
  if (!types.includes('cluster') && !types.includes('qc') && !types.includes('materialize')) return true;
  return false;
}

function mergePreservedConfig(oldGraph, newGraph) {
  const oldRestage = (oldGraph.nodes || []).find(n => n.type === 'restage_dual' || n.type === 'restage_9_16');
  const neu = (newGraph.nodes || []).find(n => n.type === 'restage_dual');
  if (oldRestage && neu) {
    neu.config = {
      ...neu.config,
      adapterId: oldRestage.config?.adapterId || neu.config.adapterId,
      model: oldRestage.config?.model || neu.config.model,
      promptTemplate: oldRestage.config?.promptTemplate || neu.config.promptTemplate
    };
  }
  const oldTag = (oldGraph.nodes || []).find(n => n.type === 'tag');
  const neuTag = (newGraph.nodes || []).find(n => n.type === 'tag');
  if (oldTag?.config?.promptTemplate && neuTag) neuTag.config.promptTemplate = oldTag.config.promptTemplate;
  const { promptIncludesLibraries } = require('../gate-route');
  const oldGate = (oldGraph.nodes || []).find(n => n.type === 'gate');
  const neuGate = (newGraph.nodes || []).find(n => n.type === 'gate');
  if (oldGate?.config?.promptTemplate && neuGate && promptIncludesLibraries(oldGate.config?.promptTemplate)) {
    neuGate.config.promptTemplate = oldGate.config.promptTemplate;
  }
  return newGraph;
}

module.exports = {
  NODE_CATALOG,
  OPERATOR_CATALOG,
  GATE_PROMPT,
  RESTAGE_PROMPT,
  defaultNode,
  buildDefaultWorkflowGraph,
  shouldUpgradeDefaultGraph,
  mergePreservedConfig
};
