/**
 * 统一提示词与模型方言编译引擎 (Unified Prompt & Dialect Compiler)
 *
 * 负责将：
 *   [1. 业务任务提示词模板 (Prompt Center)]
 * + [2. 动态标签词典芯片 {{@dict.xxx}} (Tag Dictionary)]
 * + [3. 节点上下文变量插槽 {{$node...}} / {{var}}]
 * + [4. 节点勾选的公共提示词积木 (Prompt Snippets，如《室内实拍真实感》)]
 * + [5. 目标模型的方言三开关 (Model Dialect: region_mode / ref_syntax / negative_mode)]
 * 编译为最终下发给模型驱动的 { prompt, negativePrompt, negative_prompt, modelId, dialect, snippetsUsed, params }。
 */

const { HARD_MATERIALS, SOFT_MATERIALS } = require('./tags-seed');
const {
  OFFICIAL_PROMPT_SNIPPETS,
  OFFICIAL_PROMPT_TEMPLATES,
} = require('./nodes/operator-catalog');

// 动态词典维度元数据（供前端渲染可点击的 {{@dict.xxx}} 蓝色词典芯片）
const DICT_MACRO_SPECS = [
  { macro: '{{@dict.space}}', dim: 'space', label: '空间类型枚举 (17类)', scope: 'interior' },
  { macro: '{{@dict.style_atom}}', dim: 'style_atom', label: '文化/流派风格与判据 (16类)', scope: 'all' },
  { macro: '{{@dict.wood_style}}', dim: 'wood_style', label: '木系质感与做旧判据', scope: 'interior' },
  { macro: '{{@dict.material_hard}}', dim: 'material_hard', label: '硬装主材枚举', scope: 'interior' },
  { macro: '{{@dict.material_soft}}', dim: 'material_soft', label: '软装主材枚举', scope: 'interior' },
  { macro: '{{@dict.furniture_category}}', dim: 'furniture_category', label: '家具大类枚举', scope: 'furniture' },
  { macro: '{{@dict.furniture_item}}', dim: 'furniture_item', label: '家具细分单品枚举', scope: 'furniture' },
  { macro: '{{@dict.furniture_craft}}', dim: 'furniture_craft', label: '家具表面工艺枚举', scope: 'furniture' },
  { macro: '{{@dict.furniture_form}}', dim: 'furniture_form', label: '家具造型结构枚举', scope: 'furniture' },
  { macro: '{{@dict.classic_design}}', dim: 'classic_design', label: '经典大师名品款名', scope: 'furniture' },
  { macro: '{{@dict.dominant_color}}', dim: 'dominant_color', label: '12 视觉主色调枚举', scope: 'all' },
  { macro: '{{@dict.clothing_category}}', dim: 'clothing_category', label: '服装品类枚举', scope: 'clothing' },
  { macro: '{{@dict.clothing_style}}', dim: 'clothing_style', label: '穿搭风格枚举', scope: 'clothing' },
  { macro: '{{@dict.season}}', dim: 'season', label: '适穿季节枚举', scope: 'clothing' },
  { macro: '{{@dict.gender}}', dim: 'gender', label: '人像性别枚举', scope: 'portrait' },
  { macro: '{{@dict.person_style}}', dim: 'person_style', label: '人像气质风格枚举', scope: 'portrait' },
  { macro: '{{@dict.shot_type}}', dim: 'shot_type', label: '人像景别构图枚举', scope: 'portrait' },
];

function formatTagRow(r) {
  const aliases = (() => {
    if (!r.aliases) return '';
    try {
      const a = JSON.parse(r.aliases);
      return Array.isArray(a) && a.length ? `(${a.join('/')})` : '';
    } catch {
      return '';
    }
  })();
  const base = `${r.dir}(${r.label}${aliases})`;
  return r.criteria ? `${base}｜${r.criteria}` : base;
}

function queryDictDimensionText(db, dimKey) {
  if (!db) return '';
  try {
    if (dimKey === 'material_hard' || dimKey === 'material_soft') {
      const set = dimKey === 'material_hard' ? HARD_MATERIALS : SOFT_MATERIALS;
      const rows = db
        .prepare("SELECT dir, label, criteria, aliases FROM tag_dict WHERE dimension='material_kind' AND deprecated=0 ORDER BY id")
        .all();
      return rows
        .filter((r) => set.has(r.dir))
        .map(formatTagRow)
        .join(', ');
    }
    const rows = db
      .prepare('SELECT dir, label, criteria, aliases FROM tag_dict WHERE dimension=? AND deprecated=0 ORDER BY id')
      .all(dimKey);
    return rows.map(formatTagRow).join(', ');
  } catch (_) {
    return '';
  }
}

/**
 * 展开模板中的 {{@dict.xxx}} 动态标签词典芯片
 */
function expandDictMacros(db, template) {
  if (!template || typeof template !== 'string') return template || '';
  return template.replace(/\{\{\s*@dict\.([a-zA-Z0-9_]+)\s*\}\}/g, (match, dimKey) => {
    const expanded = queryDictDimensionText(db, dimKey);
    return expanded || match;
  });
}

function getDictMacroChips(db) {
  return DICT_MACRO_SPECS.map((spec) => {
    let preview = '';
    if (db) {
      const full = queryDictDimensionText(db, spec.dim);
      preview = full.length > 140 ? full.slice(0, 140) + '...' : full;
    }
    return {
      ...spec,
      preview,
    };
  });
}

/**
 * 解析 n8n 风格变量插槽 {{$node["gate"].category}} 与普通变量 {{product_name}}
 */
function interpolateVariables(template, context = {}) {
  if (!template || typeof template !== 'string') return template || '';
  return template.replace(/\{\{\s*([a-zA-Z0-9_$.'"\[\]\s|]+)\s*\}\}/g, (match, rawExpr) => {
    // 跳过 @dict.xxx / @region / @ref_N 特殊宏（由专门阶段处理）
    if (rawExpr.trim().startsWith('@')) return match;
    try {
      const alternatives = rawExpr.split('||').map((s) => s.trim());
      for (const expr of alternatives) {
        if ((expr.startsWith("'") && expr.endsWith("'")) || (expr.startsWith('"') && expr.endsWith('"'))) {
          return expr.slice(1, -1);
        }
        const normalized = expr
          .replace(/\$node\[["']([^"']+)["']\]/g, 'nodes.$1')
          .replace(/\$node\.([a-zA-Z0-9_]+)/g, 'nodes.$1');
        const parts = normalized.split('.');
        let val = context;
        for (const p of parts) {
          if (val == null) break;
          val = val[p];
        }
        if (val !== undefined && val !== null && val !== '') {
          return typeof val === 'object' ? JSON.stringify(val) : String(val);
        }
      }
      return '';
    } catch (_) {
      return '';
    }
  });
}

/**
 * 默认模型方言三开关推断
 */
function defaultDialectForModel(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('seedream') && (id.includes('pro') || id.includes('flash'))) {
    return {
      region_mode: 'coords_bbox',
      ref_syntax: '图N',
      negative_mode: 'append_prompt',
    };
  }
  if (id.includes('seedream') && id.includes('lite')) {
    return {
      region_mode: 'vlm_text',
      ref_syntax: '图N',
      negative_mode: 'append_prompt',
    };
  }
  if (id.includes('agnes')) {
    return {
      region_mode: 'vlm_text',
      ref_syntax: '<Picture N>',
      negative_mode: 'append_prompt',
    };
  }
  if (id.includes('umbra') || id.includes('flux')) {
    return {
      region_mode: 'mask',
      ref_syntax: '图N',
      negative_mode: 'field',
    };
  }
  return {
    region_mode: 'coords_bbox',
    ref_syntax: '图N',
    negative_mode: 'field',
  };
}

function resolveModelDialect(db, modelId, draftDialect = null) {
  const base = defaultDialectForModel(modelId);
  let resolved = { ...base };
  if (db && modelId) {
    try {
      const row = db.prepare('SELECT dialect_json FROM model_contracts WHERE id=? OR vendor_model_id=?').get(modelId, modelId);
      if (row && row.dialect_json) {
        const parsed = JSON.parse(row.dialect_json);
        resolved = { ...resolved, ...parsed };
      }
    } catch (_) {}
  }
  if (draftDialect && typeof draftDialect === 'object') {
    resolved = { ...resolved, ...draftDialect };
  }
  return resolved;
}

/**
 * 读取指定 ID 列表的公共提示词积木（支持沙盒未保存草稿积木覆盖）
 */
function resolveSnippets(db, snippetIds = [], draftSnippets = null) {
  if (!Array.isArray(snippetIds) || !snippetIds.length) return [];
  const draftMap = new Map();
  if (Array.isArray(draftSnippets)) {
    for (const ds of draftSnippets) {
      if (ds && ds.id) draftMap.set(ds.id, ds);
    }
  } else if (draftSnippets && typeof draftSnippets === 'object') {
    for (const [k, v] of Object.entries(draftSnippets)) {
      if (v && typeof v === 'object') draftMap.set(k, { id: k, ...v });
    }
  }

  const results = [];
  for (const sid of snippetIds) {
    if (draftMap.has(sid)) {
      results.push(draftMap.get(sid));
      continue;
    }
    let row = null;
    if (db) {
      try {
        row = db.prepare('SELECT * FROM prompt_snippets WHERE id=? AND enabled=1').get(sid);
      } catch (_) {}
    }
    if (!row && OFFICIAL_PROMPT_SNIPPETS[sid]) {
      row = OFFICIAL_PROMPT_SNIPPETS[sid];
    }
    if (row) results.push(row);
  }
  return results;
}

/**
 * 执行模型三开关（选区语法、参考图称呼、负向词通道）转译
 */
function applyDialectTransforms(promptText, negativeText, dialect, vars = {}) {
  let text = String(promptText || '');
  const neg = String(negativeText || '').trim();
  const d = dialect || defaultDialectForModel('');

  // 1. 开关一：选区传递方式 (region_mode)
  let regionReplacement = vars.regionClause || vars.areaPhrase || '';
  if (!regionReplacement) {
    if (d.region_mode === 'coords_bbox' && vars.box1Tag) {
      regionReplacement = `图中 <bbox>${vars.box1Tag}</bbox> 区域`;
    } else if (d.region_mode === 'coords_point' && vars.pointTag) {
      regionReplacement = `图中 <point>${vars.pointTag}</point> 位置`;
    } else if (vars.box1Tag) {
      regionReplacement = `图中 <bbox>${vars.box1Tag}</bbox> 区域`;
    } else {
      regionReplacement = '选定区域';
    }
  }
  text = text.replace(/\{\{\s*@region\s*\}\}/g, regionReplacement);

  // 2. 开关二：参考图称呼记号 (ref_syntax: '图N' | '<Picture N>' | '@图片N')
  const formatRef = (n) => {
    if (d.ref_syntax === '<Picture N>') return `<Picture ${n}>`;
    if (d.ref_syntax === '@图片N') return `@图片${n}`;
    return n === 1 ? '图1' : `参考图${n}`;
  };
  text = text.replace(/\{\{\s*@ref_(\d+)\s*\}\}/g, (_, n) => formatRef(Number(n)));
  if (d.ref_syntax === '<Picture N>') {
    text = text.replace(/@图片(\d+)/g, '<Picture $1>');
  } else if (d.ref_syntax === '图N') {
    text = text.replace(/@图片(\d+)/g, (_, n) => formatRef(Number(n)));
  }

  // 3. 开关三：负向提示词通道 (negative_mode: 'field' | 'append_prompt')
  let finalPositive = text.trim();
  let finalNegativeField = '';
  if (neg) {
    if (d.negative_mode === 'append_prompt') {
      if (!finalPositive.includes(neg.slice(0, 12))) {
        finalPositive = `${finalPositive}\n【严禁出现】：${neg}。`;
      }
      finalNegativeField = '';
    } else {
      // negative_mode === 'field'：负向词走独立字段，绝不拼入正向 prompt
      finalNegativeField = neg;
    }
  }

  return {
    prompt: finalPositive,
    negativePrompt: finalNegativeField,
    negative_prompt: finalNegativeField,
    rawNegativeText: neg,
  };
}

/**
 * 查找某个挂载点/算子当前生效的工作流节点配置
 */
function findActiveWorkflowNode(db, { mountPointId, nodeType, nodeId, category } = {}) {
  if (!db) return null;
  try {
    let rows = [];
    if (nodeId) {
      const r = db.prepare('SELECT * FROM workflow_modules WHERE id=?').get(nodeId);
      if (r) rows = [r];
    } else if (mountPointId && nodeType) {
      rows = db
        .prepare('SELECT * FROM workflow_modules WHERE mount_point_id=? AND node_type=? AND enabled=1 ORDER BY order_num ASC')
        .all(mountPointId, nodeType);
    } else if (nodeType) {
      rows = db
        .prepare('SELECT * FROM workflow_modules WHERE node_type=? AND enabled=1 ORDER BY order_num ASC')
        .all(nodeType);
    }

    if (!rows.length && category && (nodeType === 'tag' || nodeType === 'vlm.tag_router')) {
      const catNodeMap = {
        interior: 'tag_space',
        exterior: 'tag_space',
        furniture: 'tag_furniture',
        clothing: 'tag_clothing',
        portrait: 'tag_portrait',
      };
      const mappedType = catNodeMap[category] || 'tag_space';
      rows = db
        .prepare('SELECT * FROM workflow_modules WHERE node_type IN (?, ?) AND enabled=1 ORDER BY order_num ASC')
        .all(mappedType, 'tag');
    }

    if (!rows.length) return null;
    const chosen = rows[0];
    return {
      ...chosen,
      params: chosen.params_json ? JSON.parse(chosen.params_json) : {},
      snippet_ids: chosen.snippet_ids_json ? JSON.parse(chosen.snippet_ids_json) : [],
    };
  } catch (_) {
    return null;
  }
}

/**
 * 统一编译工作流节点的提示词、公共积木与模型方言
 */
function compileNodePrompt(db, opts = {}) {
  const {
    mountPointId = null,
    nodeType = null,
    nodeId = null,
    category = null,
    promptId: explicitPromptId = null,
    promptTemplate: explicitTemplate = null,
    snippetIds: explicitSnippets = null,
    modelId: explicitModelId = null,
    draftNode = null,
    draftSnippets = null,
    draftDialect = null,
    vars = {},
  } = opts;

  const wfNode = draftNode || findActiveWorkflowNode(db, { mountPointId, nodeType, nodeId, category });
  const resolvedModelId = explicitModelId || wfNode?.model_id || '';
  const resolvedPromptId = explicitPromptId || wfNode?.prompt_id || '';

  // 1. 获取基础模板（优先级：显式草稿模板 > 节点行内覆盖 > 提示词中心数据库表 > 官方内置基线）
  let rawTemplate = '';
  if (explicitTemplate && String(explicitTemplate).trim()) {
    rawTemplate = String(explicitTemplate).trim();
  } else if (wfNode?.prompt_override && String(wfNode.prompt_override).trim()) {
    rawTemplate = String(wfNode.prompt_override).trim();
  } else if (resolvedPromptId) {
    if (db) {
      try {
        const ptRow = db.prepare('SELECT template FROM prompt_templates WHERE id=?').get(resolvedPromptId);
        if (ptRow && ptRow.template) rawTemplate = ptRow.template;
      } catch (_) {}
    }
    if (!rawTemplate && OFFICIAL_PROMPT_TEMPLATES[resolvedPromptId]) {
      rawTemplate = OFFICIAL_PROMPT_TEMPLATES[resolvedPromptId].template;
    }
  }

  // 2. 展开 {{@dict.xxx}} 动态标签词典芯片
  const afterDict = expandDictMacros(db, rawTemplate);

  // 3. 展开 {{$node}} 与业务上下文变量
  const afterVars = interpolateVariables(afterDict, {
    ...vars,
    $node: vars.$node || vars.nodes || {},
    nodes: vars.nodes || vars.$node || {},
    asset: vars.asset || {},
  });

  // 4. 拼接该节点勾选的公共提示词积木 (Prompt Snippets)
  const activeSnippetIds = Array.isArray(explicitSnippets)
    ? explicitSnippets
    : Array.isArray(wfNode?.snippet_ids)
      ? wfNode.snippet_ids
      : [];
  const snippets = resolveSnippets(db, activeSnippetIds, draftSnippets);

  const positiveParts = [afterVars.trim()].filter(Boolean);
  const negativeParts = [];
  if (vars.extraNegative) negativeParts.push(String(vars.extraNegative).trim());

  for (const s of snippets) {
    if (s.positive_text) positiveParts.push(String(s.positive_text).trim());
    if (s.negative_text) negativeParts.push(String(s.negative_text).trim());
  }

  const combinedPositive = positiveParts.join('\n\n');
  const combinedNegative = negativeParts.join(', ');

  // 5. 应用目标模型的三开关转译
  const dialect = resolveModelDialect(db, resolvedModelId, draftDialect);
  const transformed = applyDialectTransforms(combinedPositive, combinedNegative, dialect, vars);

  return {
    prompt: transformed.prompt,
    negativePrompt: transformed.negativePrompt,
    negative_prompt: transformed.negative_prompt,
    rawNegativeText: transformed.rawNegativeText,
    rawTemplate,
    expandedDictPrompt: afterDict,
    modelId: resolvedModelId,
    promptId: resolvedPromptId,
    snippetIds: activeSnippetIds,
    snippetsUsed: snippets.map((s) => ({ id: s.id, name: s.name })),
    dialect,
    nodeParams: wfNode?.params || {},
  };
}

module.exports = {
  DICT_MACRO_SPECS,
  expandDictMacros,
  getDictMacroChips,
  interpolateVariables,
  defaultDialectForModel,
  resolveModelDialect,
  resolveSnippets,
  applyDialectTransforms,
  findActiveWorkflowNode,
  compileNodePrompt,
};
