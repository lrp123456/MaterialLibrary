/**
 * 去水印与消除。选区子句由 handlers/region-route 按模型能力给出
 * （可能是 `图1 <bbox>…</bbox>`，也可能是降级后的「九宫格方位 + 名称」）；
 * 只有在调用方没给子句时，才退回本文件自己拼的 bbox 文案。
 */
const sharp = require('sharp');
const { pastebackToTarget, selectionBounds } = require('./image-ops');
const { findImageAdapter, readAdapterOutput } = require('./adapter-io');

function buildPrompt(actionType, bboxNormStr, areaPhrase) {
  const where = areaPhrase || `图中 <bbox>${bboxNormStr}</bbox> 区域`;
  if (actionType === 'watermark') {
    return `请擦除 ${where} 内的水印、字幕、文字和 LOGO 标识，自然修补该区域被遮挡的原背景纹理、色彩与光影，使画面纯净连贯，除该局部修补外保持原图其余部分逐像素不变。`;
  }
  return `请消除 ${where} 内的物体/杂物，并根据周围环境纹理、材质、地面和墙面走向自然补齐被遮挡的背景与阴影，除该物体擦除并补齐背景外保持原图其余部分逐像素不变。`;
}

async function handleWatermarkOrRemove(services, {
  imageBuffer,
  actionType = 'remove',
  quadOrBbox,
  pasteback = true,
  model = null,
  regionClauseText = null,
  maskPath = null,
  outSpec = null,
}) {
  const meta = await sharp(imageBuffer).metadata();
  const sw = meta.width;
  const sh = meta.height;
  const { minX, minY, maxX, maxY } = selectionBounds(quadOrBbox, sw, sh);

  const nx1 = Math.min(999, Math.max(0, Math.round((minX / sw) * 1000)));
  const ny1 = Math.min(999, Math.max(0, Math.round((minY / sh) * 1000)));
  const nx2 = Math.min(999, Math.max(0, Math.round((maxX / sw) * 1000)));
  const ny2 = Math.min(999, Math.max(0, Math.round((maxY / sh) * 1000)));
  const box1Tag = `${nx1} ${ny1} ${nx2} ${ny2}`;
  let prompt = '';
  if (services && services.db) {
    try {
      const { compileNodePrompt } = require('../prompt-compiler');
      const isWm = actionType === 'watermark';
      const compiled = compileNodePrompt(services.db, {
        mountPointId: 'precision_edit',
        nodeType: isWm ? 'edit_clean' : 'edit_remove',
        promptId: isWm ? 'watermark_clean' : 'precision_remove',
        modelId: model || 'seedream5pro',
        vars: {
          regionClause: regionClauseText || `图中 <bbox>${box1Tag}</bbox> 区域`,
          box1Tag,
        },
      });
      if (compiled && compiled.prompt) prompt = compiled.prompt;
    } catch (_) {}
  }
  if (!prompt) {
    prompt = buildPrompt(actionType, box1Tag, regionClauseText);
  }

  const adapter = findImageAdapter(services && services.db, model);
  if (!adapter) {
    throw new Error('未配置图像适配器（ark_seedream 或 agnes_image），消除已停止');
  }
  const { executeAdapter } = require('../gen');
  const base64Data = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
  const result = await executeAdapter(services, adapter, {
    imageUrls: [base64Data],
    prompt,
    kind: 'image',
    model: model || undefined,
    maskPath: maskPath || undefined,
    // 出图档位/画幅由 handlers/edit-size 从模型契约算出，这里只负责原样透传
    size: outSpec && outSpec.sizeField ? outSpec.sizeField : undefined,
    ratio: outSpec && outSpec.ratioField ? outSpec.ratioField : undefined,
  });
  const generatedBuffer = readAdapterOutput(result);
  if (!generatedBuffer) throw new Error('图像适配器未返回消除结果');

  if (pasteback !== false && String(pasteback) !== 'false') {
    return pastebackToTarget(imageBuffer, generatedBuffer, {
      selection: quadOrBbox,
      outW: outSpec ? outSpec.outW : sw,
      outH: outSpec ? outSpec.outH : sh,
    });
  }
  return generatedBuffer;
}

module.exports = {
  buildPrompt,
  handleWatermarkOrRemove,
};
