/**
 * 生成执行体（可复用）：把 /gen/images 的执行逻辑抽成纯函数，供同步端点与后台任务队列共用。
 *
 * 契约（严格遵守）：
 * - 只从 src/gen 取 executeAdapter，不改动 src/gen/index.js 的任何逻辑；
 * - payload 就是原 /gen/images 的 body 对象；
 * - 返回原 sendJson(res, 200, result) 里的 result（含 files 数组）；
 * - 任何失败以 throw 抛出，由调用方决定 HTTP 状态 / 任务状态。
 */
'use strict';

const { executeAdapter } = require('./gen');
const genGov = require('./gen-governance');
const { engineStatus } = require('./lab');
const { resolveModelExecution, prepareGovernedSubmit } = require('./models-contract');
const { pickAdapterId, adapterMissingError, isGoogleModel } = require('./adapter-match');

/** auto_optimize 分支的文本对话：等价 api.js executeChatCompletion 的纯文本路径。 */
async function optimizerChat(db, config, { model, messages, temperature, max_tokens, timeoutMs }) {
  const { completeChat } = require('./vlm');
  const { resolveLiteLlmChatConfig } = require('./providers');
  const llm = resolveLiteLlmChatConfig(db, config, model);
  return completeChat({
    baseUrl: llm.baseUrl,
    apiKey: llm.apiKey,
    model: llm.model,
    messages,
    temperature,
    max_tokens,
    timeoutMs,
  });
}

async function runGeneration(services, payload) {
  const { db, config } = services;
  const b = payload || {};
  const rawPrompt = (b.prompt || '').trim();
  let finalPrompt = rawPrompt;

  const modelExec = b.model ? resolveModelExecution(db, b.model) : null;
  const requestedContract = modelExec?.model;

  // 双轨机制：若指定 auto_optimize，调用对应生成模型的 Skill 自动优化
  let optimizedPrompt = null;
  if (b.auto_optimize && rawPrompt && b.model) {
    try {
      const polish = requestedContract?.optimizer?.prompt ? requestedContract.optimizer : genGov.polishFor(db, b.model);
      if (polish && polish.prompt) {
        const opt = genGov.resolveOptimizerModel(db, b.model);
        const optData = await optimizerChat(db, config, {
          model: opt.modelCode || opt.modelId,
          messages: [{ role: 'system', content: polish.prompt }, { role: 'user', content: rawPrompt }],
          temperature: opt.temperature,
          max_tokens: 2048,
          timeoutMs: opt.timeoutMs || 90000,
        });
        const txt = optData?.choices?.[0]?.message?.content?.trim();
        if (txt) {
          // 同闸门：剥掉提示词里的分辨率/时长/画幅比（它们由参数项承载）
          optimizedPrompt = require('./prompt-validate')
            .validateOptimizedPrompt(txt.replace(/^["'“”]+|["'“”]+$/g, '')).text;
          finalPrompt = optimizedPrompt;
        }
      }
    } catch (_) {}
  }

  // 提取输入中的参数（兼容旧字段与对外共有控件）
  const values = {
    size: b.size || '2K',
    ratio: b.ratio || '9:16',
    ...(b.params || {}),
    ...(b.extras || {}),
    ...(b.layer_decomposition != null ? { layer_decomposition: b.layer_decomposition } : {}),
    ...(b.decompose != null ? { layer_decomposition: b.decompose } : {}),
    ...(b.background != null ? { background: b.background } : {}),
    ...(b.output_format != null ? { output_format: b.output_format } : {}),
    ...(b.format != null ? { output_format: b.format } : {}),
  };

  const snippetIds = Array.isArray(b.snippetIds) ? b.snippetIds : (Array.isArray(b.snippet_ids) ? b.snippet_ids : null);
  const prepared = b.model ? prepareGovernedSubmit({
    db,
    modelId: b.model,
    editablePrompt: rawPrompt,
    optimizedPrompt,
    values,
    images: b.imageUrls || (b.image ? [b.image] : []),
    snippetIds,
  }) : { contract: requestedContract, assembled: null };
  const modelContract = prepared.contract || requestedContract;
  const assembled = prepared.assembled;
  if (assembled?.prompt) finalPrompt = assembled.prompt;

  const engines = engineStatus(db);
  const imgAdapters = engines.gen?.imageAdapters || [];
  const mCode = String(modelContract?.vendor_model_id || b.model || '');
  const execEndpointId = modelExec?.capability?.endpoint_id || modelExec?.endpoint?.id || '';
  const pickedId = pickAdapterId('image', mCode, imgAdapters, execEndpointId);
  let adapterRow = null;
  if (b.adapterId) {
    adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(b.adapterId);
  }
  if (pickedId && (!adapterRow || (isGoogleModel(mCode) && adapterRow.id !== pickedId))) {
    adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(pickedId);
  }
  if (!adapterRow && pickedId) {
    adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(pickedId);
  }
  if (!adapterRow) {
    const err = new Error(adapterMissingError('image', mCode));
    err.status = 503;
    err.statusCode = 503;
    err.code = 'adapter_missing';
    throw err;
  }

  const result = await executeAdapter(services, adapterRow, {
    kind: 'image',
    contractId: modelContract?.id || '',
    prompt: finalPrompt,
    model: mCode,
    size: assembled?.body?.size || b.size,
    ratio: assembled?.body?.ratio || b.ratio || '9:16',
    imageUrls: b.imageUrls || (b.image ? [b.image] : []),
    imageLocalPaths: b.imageLocalPaths || [],
    extras: {
      ...(b.extras || b.params || {}),
      ...(assembled?.body || {}),
      ...(b.mask != null ? { mask: b.mask } : {}),
      ...(b.bbox != null ? { bbox: b.bbox } : {}),
    },
  });
  return result;
}

module.exports = { runGeneration };
