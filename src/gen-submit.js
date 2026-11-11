/**
 * 生成执行体（可复用）：处理后台任务队列与直接调用的生成逻辑。
 * 支持 image、video、music 等全模态。
 * 视频模型支持自动判定 x2 超分档，并调用本地超分流水线。
 */
'use strict';

const { executeAdapter } = require('./gen');
const genGov = require('./gen-governance');
const { engineStatus } = require('./lab');
const { resolveModelExecution, prepareGovernedSubmit, stripVideoResolution } = require('./models-contract');
const { pickAdapterId, adapterMissingError, isGoogleModel } = require('./adapter-match');
const { isWanModel, generateWanVideo } = require('./services/wan-video');

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

async function runGeneration(services, payload, { signal, onStage } = {}) {
  const emitStage = (stage) => {
    if (typeof onStage !== 'function') return;
    try { onStage(stage); } catch (e) { console.warn('[gen-submit] 阶段回调失败:', e.message); }
  };
  const { db, config } = services;
  const b = payload || {};
  const rawPrompt = (b.prompt || '').trim();
  let finalPrompt = rawPrompt;
  const modality = String(b.modality || 'image').toLowerCase();

  const modelExec = b.model ? resolveModelExecution(db, b.model) : null;
  const requestedContract = modelExec?.model;

  // 1. auto_optimize 分支
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
          optimizedPrompt = require('./prompt-validate')
            .validateOptimizedPrompt(txt.replace(/^["'“”]+|["'“”]+$/g, '')).text;
          finalPrompt = optimizedPrompt;
        }
      }
    } catch (_) {}
  }

  // 2. 提取参数
  const values = {
    size: b.size || (modality === 'image' ? '2K' : undefined),
    ratio: b.ratio || b.aspect_ratio || (modality === 'video' ? '16:9' : '9:16'),
    aspect_ratio: b.aspect_ratio || b.ratio || '16:9',
    duration: b.duration || b.seconds || b.durationSec || 5,
    seconds: b.seconds || b.duration || b.durationSec || 5,
    resolution: b.resolution || b.size || '720px2（超分）',
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
  const mCode = String(modelContract?.vendor_model_id || b.model || '');
  const execEndpointId = modelExec?.capability?.endpoint_id || modelExec?.endpoint?.id || '';

  // 3. 模态分流
  if (modality === 'video') {
    let result = null;
    const rawRes = String(b.resolution || b.size || (b.params && (b.params.resolution || b.params.size)) || values.resolution || '').trim();
    const needSr = /x2|超分/i.test(rawRes);
    const cleanedRes = stripVideoResolution(rawRes);

    if (isWanModel(b.model) || isWanModel(mCode) || isWanModel(modelContract?.id)) {
      result = await generateWanVideo(services, {
        prompt: finalPrompt,
        ratio: assembled?.body?.ratio || b.ratio,
        resolution: cleanedRes,
        duration: assembled?.body?.duration || assembled?.body?.seconds || b.duration || b.durationSec || b.seconds,
        imageUrls: b.imageUrls || (b.image ? [b.image] : []),
        firstFrame: b.firstFrame || b.first_frame,
        lastFrame: b.lastFrame || b.last_frame,
        genMode: b.genMode || b.mode,
      }, { signal, onStage: emitStage });
    } else {
      const vidAdapters = engines.gen?.videoAdapters || [];
      const pickedId = pickAdapterId('video', mCode, vidAdapters);
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
        const err = new Error(adapterMissingError('video', mCode));
        err.status = 503;
        err.statusCode = 503;
        err.code = 'adapter_missing';
        throw err;
      }
      emitStage({ key: 'video_submit', label: '提交视频生成任务', progress: 15 });
      result = await executeAdapter(services, adapterRow, {
        kind: 'video',
        contractId: modelContract?.id || '',
        prompt: finalPrompt,
        model: mCode,
        size: cleanedRes,
        resolution: cleanedRes,
        ratio: assembled?.body?.ratio || b.ratio,
        durationSec: assembled?.body?.duration || assembled?.body?.seconds || b.durationSec || b.seconds || b.duration,
        imageUrls: b.imageUrls || (b.image ? [b.image] : []),
        firstFrame: b.firstFrame || b.first_frame,
        lastFrame: b.lastFrame || b.last_frame,
        extras: {
          ...(b.extras || b.params || {}),
          ...(assembled?.body || {}),
        },
      });
      emitStage({ key: 'video_finalize', label: '视频生成完成，准备成片', progress: 88 });
    }

    // 超分按需执行：只有带 x2 档位才在生成后上传上海临时 OSS 发起 SuperResolveVideo
    const modelVideoUrl = result.videoUrl || result.files?.[0]?.previewUrl || result.files?.[0]?.url || '';
    const vendorVideoUrl = result.files?.[0]?.remoteUrl || (String(modelVideoUrl).startsWith('http') ? modelVideoUrl : '');

    if (needSr && modelVideoUrl) {
      const { superResolveFromPreview } = require('./services/video-sr-local');
      try {
        const srRes = await superResolveFromPreview(services, modelVideoUrl, vendorVideoUrl, { onStage: emitStage });
        if (srRes && srRes.ok && srRes.srVideoUrl) {
          result.videoUrl = srRes.srVideoUrl;
          result.modelVideoUrl = srRes.modelVideoUrl || modelVideoUrl;
          result.vendorVideoUrl = vendorVideoUrl;
          result.srStatus = 'done';
          result.srError = '';
          const baseName = cleanedRes.toLowerCase();
          result.resolution = `${baseName} x 2`;
          result.timing = { ...(result.timing || {}), sr: srRes.timing || null };
        } else {
          result.videoUrl = modelVideoUrl;
          result.modelVideoUrl = modelVideoUrl;
          result.vendorVideoUrl = vendorVideoUrl;
          result.srStatus = 'failed';
          result.srError = srRes?.error || '超分失败，已改播模型原片';
          result.resolution = cleanedRes.toLowerCase();
          result.timing = { ...(result.timing || {}), sr: null, srError: srRes?.error || '超分失败' };
        }
      } catch (srErr) {
        result.videoUrl = modelVideoUrl;
        result.modelVideoUrl = modelVideoUrl;
        result.vendorVideoUrl = vendorVideoUrl;
        result.srStatus = 'failed';
        result.srError = srErr.message || '超分失败，已改播模型原片';
        result.resolution = cleanedRes.toLowerCase();
        result.timing = { ...(result.timing || {}), sr: null, srError: srErr.message };
      }
    } else {
      // 纯分辨率不调用超分，不显示「超分中」
      result.videoUrl = modelVideoUrl;
      result.modelVideoUrl = modelVideoUrl;
      result.vendorVideoUrl = vendorVideoUrl;
      result.srStatus = null;
      result.resolution = cleanedRes.toLowerCase();
      result.timing = { ...(result.timing || {}), sr: null };
    }

    return result;
  }

  if (modality === 'music' || modality === 'audio') {
    const audioAdapters = engines.gen?.audioAdapters || [];
    const pickedId = pickAdapterId('music', mCode, audioAdapters);
    let adapterRow = null;
    if (b.adapterId) adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(b.adapterId);
    if (!adapterRow && pickedId) adapterRow = db.prepare('SELECT * FROM gen_adapters WHERE id=?').get(pickedId);
    if (!adapterRow) {
      const err = new Error(adapterMissingError('music', mCode));
      err.status = 503;
      err.statusCode = 503;
      err.code = 'adapter_missing';
      throw err;
    }
    return executeAdapter(services, adapterRow, {
      kind: 'music',
      contractId: modelContract?.id || '',
      prompt: finalPrompt,
      model: mCode,
      duration: b.duration || b.seconds || 30,
      audioUrls: b.audioUrls || [],
      extras: { ...(b.extras || b.params || {}), ...(assembled?.body || {}) },
    });
  }

  // 默认图片生成
  const imgAdapters = engines.gen?.imageAdapters || [];
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
