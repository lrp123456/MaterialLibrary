/**
 * workshop-ai.js — 工坊模型桥（默认本地策略 B，避免误清会话）
 */
import {
  bakePlacementDraft,
  bakeOrientationRef,
  runStrategyB,
  expandToRatio,
  defaultPrompt,
  loadImage,
} from './workshop-model.js';

export async function runStackOp({
  op,
  parentDataUrl,
  drawing,
  yaw = 0,
  scalePct = 100,
  product = null,
  productPhotoDataUrl = null,
  materialRef = null,
  outpaintRatio = '16:9',
  strategyC = false,
  promptOverride = null,
  forceFail = false,
  preferServer = false,
}) {
  void preferServer;
  const prompt =
    promptOverride ||
    defaultPrompt(op, { yaw, productName: (product && product.name) || '目标物体' });

  if (forceFail) {
    return {
      ok: false,
      reason: '模拟失败（合同：失败保留上一张成功）',
      prompt,
      via: 'local',
      frozen: { params: { op, yaw, scalePct } },
    };
  }

  let baseParent = parentDataUrl;
  if (strategyC && (op === 'replace' || op === 'add' || op === 'install')) {
    try {
      baseParent = await relight(parentDataUrl);
    } catch (e) {}
  }

  let neighborhood = null;
  let draftDataUrl = null;
  let orientationRef = null;
  const inputs = [{ src: parentDataUrl, label: '父快照' }];

  if (op === 'outpaint') {
    const expanded = await expandToRatio(baseParent, outpaintRatio);
    neighborhood = { x: 0, y: 0, w: expanded.outW, h: expanded.outH };
    draftDataUrl = expanded.dataUrl;
    inputs.push({ src: expanded.dataUrl, label: '扩图画布' });
  } else if (op === 'clarity') {
    draftDataUrl = baseParent;
  } else if (drawing) {
    const baked = await bakePlacementDraft({
      parentDataUrl: baseParent,
      quad: drawing.points || drawing.rect,
      yaw,
      scalePct,
      productDataUrl: productPhotoDataUrl,
      productHasModel: !!(product && product.hasModel),
      materialRef,
      op,
    });
    draftDataUrl = baked.draftDataUrl;
    neighborhood = baked.neighborhood;
    inputs.push({ src: baked.draftDataUrl, label: '摆放草稿' });
    if (op === 'replace' || op === 'add') {
      orientationRef = await bakeOrientationRef({
        parentDataUrl: baseParent,
        quad: drawing.points || drawing.rect,
        yaw,
        scalePct,
      });
      inputs.push({ src: orientationRef, label: '朝向参考' });
    }
  }

  const frozen = {
    inputs: { parentUrl: parentDataUrl, selection: drawing, draft: draftDataUrl, neighborhood },
    params: { op, yaw, scalePct, productId: product && product.id, strategy: strategyC ? 'C→B' : 'B', prompt },
    outputs: null,
  };

  try {
    let outputUrl = null;
    if (op === 'clarity') {
      outputUrl = await localSharpen(baseParent);
    } else {
      const res = await runStrategyB({
        parentDataUrl: baseParent,
        draftDataUrl: draftDataUrl || baseParent,
        neighborhood: neighborhood || { x: 0, y: 0, w: 1, h: 1 },
        op,
        prompt,
        materialRef,
      });
      if (!res.ok) {
        return { ok: false, reason: res.reason, prompt, via: 'local', frozen, orientationRef, inputs };
      }
      outputUrl = res.outputUrl;
    }
    frozen.outputs = outputUrl;
    return { ok: true, outputUrl, prompt, via: 'local', orientationRef, inputs, frozen };
  } catch (e) {
    return {
      ok: false,
      reason: e && e.message,
      prompt,
      via: 'local',
      frozen,
      orientationRef,
      inputs,
    };
  }
}

async function localSharpen(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.92);
}

async function relight(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const g = ctx.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, 'rgba(255,240,220,0.18)');
  g.addColorStop(1, 'rgba(200,220,255,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}
