/**
 * 快捷改 (物体替换) Handler
 * 严格遵循规范：
 * 1. 必须选带 glb 的单品，没有 glb 不能替换。
 * 2. 手机上为真实 3D 模型渲染：
 *    - 滑杆旋转模型本身，角度写进朝向句；
 *    - 拖动只改变观察相机，不改朝向；
 *    - 交给模型的参考图在固定机位拍摄：方位 45°、俯视约 85°；看到的模型朝向就是提交的朝向。
 * 3. 提交场景图 + 固定机位参考图 + 朝向句 + 选区，一次图像模型。
 * 4. 默认贴回 (pasteback !== false)，可关。
 */
const sharp = require('sharp');
const { pastebackToTarget, selectionBounds } = require('./image-ops');
const { findImageAdapter, readAdapterOutput } = require('./adapter-io');

/**
 * 朝向句生成 (随 yaw 角度分段)
 */
function buildFacingDesc(deg, productName = '该单品') {
  const d = ((Math.round(Number(deg) || 0) % 360) + 360) % 360;
  if (d <= 22 || d >= 338) return `正面朝向观察者，可清楚看到${productName}正面、主要结构和双侧细节`;
  if (d <= 67) return `右前侧斜向摆放，可同时看到${productName}正面、右侧面和部分背面细节`;
  if (d <= 112) return `右侧面朝向观察者，可完整看到${productName}右侧轮廓和厚度`;
  if (d <= 157) return `右后侧斜向摆放，可看到${productName}背面、右侧面细节`;
  if (d <= 202) return `背面朝向观察者，主要看到${productName}背面结构`;
  if (d <= 247) return `左后侧斜向摆放，可看到${productName}背面、左侧面细节`;
  if (d <= 292) return `左侧面朝向观察者，可完整看到${productName}左侧轮廓和厚度`;
  return `左前侧斜向摆放，可同时看到${productName}正面、左侧面和部分靠背/主体结构细节`;
}

/**
 * 替换任务提示词。
 * `areaPhrase` 由 handlers/region-route 按模型能力给出（坐标框 / 方位描述都可能），
 * 本文件不再自己拼 `<bbox>`，以便同一条管线能复用到吃 mask 或只吃语义的模型。
 */
function buildReplacePrompt({
  areaPhrase,
  box1Tag,
  productName = '该单品',
  facingSentence = '',
}) {
  // 兼容旧调用：只有 box1Tag 时退回「图中 <bbox>…</bbox> 区域」
  const where = areaPhrase || `图中 <bbox>${box1Tag}</bbox> 区域`;
  return `这是一张室内实拍照片。请把 ${where} 内的旧物体替换为参考图2中的真实${productName}：
· 新物体在空间中严格按照参考图展示的朝向摆放：${facingSentence}；
· 新物体严格落地/落台面，大小比例与空间周围家具环境协调，透视与房间地平线完美共面；
· 替换后完全继承场景的真实光影、冷暖色温与漫反射，并在接触面投射自然的投影与软阴影；
· 除 ${where} 及其接触阴影外，房间内其余背景、家具、地面和装饰物全部保持原样，逐像素不变。
只输出这一张修改后的高清实景照片本身，禁止输出多图对比或文字水印。`;
}

/**
 * 执行替换
 */
async function handleReplace(services, {
  sceneImageBuffer,
  fixedCameraRefBuffer, // 固定机位渲染的参考图 (方位 45°、俯视约 85°)
  glbFid = null,
  yaw = 0,
  productName = '该单品',
  quadOrBbox,
  pasteback = true,
  model = null,
  regionClauseText = null,
  maskPath = null,
  outSpec = null,
}) {
  if (!glbFid) throw new Error('改（物体替换）必须选择带 GLB 的单品');
  if (!fixedCameraRefBuffer) {
    throw new Error('改（物体替换）必须提供固定机位 3D 参考图');
  }

  const meta = await sharp(sceneImageBuffer).metadata();
  const sw = meta.width;
  const sh = meta.height;
  const { minX, minY, maxX, maxY } = selectionBounds(quadOrBbox, sw, sh);

  const nx1 = Math.min(999, Math.max(0, Math.round((minX / sw) * 1000)));
  const ny1 = Math.min(999, Math.max(0, Math.round((minY / sh) * 1000)));
  const nx2 = Math.min(999, Math.max(0, Math.round((maxX / sw) * 1000)));
  const ny2 = Math.min(999, Math.max(0, Math.round((maxY / sh) * 1000)));
  const box1Tag = `${nx1} ${ny1} ${nx2} ${ny2}`;

  const facingSentence = buildFacingDesc(yaw, productName);
  let prompt = '';
  if (services && services.db) {
    try {
      const { compileNodePrompt } = require('../prompt-compiler');
      const compiled = compileNodePrompt(services.db, {
        mountPointId: 'precision_edit',
        nodeType: 'edit_replace',
        promptId: 'precision_replace',
        modelId: model || 'seedream5pro',
        vars: {
          regionClause: regionClauseText || (box1Tag ? `图中 <bbox>${box1Tag}</bbox> 区域` : '选定区域'),
          box1Tag,
          product_name: productName,
          facing_desc: facingSentence,
        },
      });
      if (compiled && compiled.prompt) prompt = compiled.prompt;
    } catch (_) {}
  }
  if (!prompt) {
    prompt = buildReplacePrompt({
      areaPhrase: regionClauseText,
      box1Tag,
      productName,
      facingSentence,
    });
  }

  const adapter = findImageAdapter(services && services.db, model);
  if (!adapter) {
    throw new Error('未配置图像适配器（ark_seedream 或 agnes_image），替换已停止');
  }
  const { executeAdapter } = require('../gen');
  const sceneB64 = `data:image/jpeg;base64,${sceneImageBuffer.toString('base64')}`;
  const refB64 = `data:image/png;base64,${fixedCameraRefBuffer.toString('base64')}`;
  const res = await executeAdapter(services, adapter, {
    imageUrls: [sceneB64, refB64],
    prompt,
    kind: 'image',
    model: model || undefined,
    maskPath: maskPath || undefined,
    // 出图档位/画幅由 handlers/edit-size 从模型契约算出，这里只负责原样透传
    size: outSpec && outSpec.sizeField ? outSpec.sizeField : undefined,
    ratio: outSpec && outSpec.ratioField ? outSpec.ratioField : undefined,
  });
  const generatedBuffer = readAdapterOutput(res);
  if (!generatedBuffer) throw new Error('图像适配器未返回替换结果');

  if (pasteback !== false && String(pasteback) !== 'false') {
    return pastebackToTarget(sceneImageBuffer, generatedBuffer, {
      selection: quadOrBbox,
      outW: outSpec ? outSpec.outW : sw,
      outH: outSpec ? outSpec.outH : sh,
    });
  }
  return generatedBuffer;
}

module.exports = {
  buildFacingDesc,
  buildReplacePrompt,
  handleReplace,
};
