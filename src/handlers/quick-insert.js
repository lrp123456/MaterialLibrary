/**
 * 快捷增 (软装安装) Handler (模式 B / 模式 C 管线)
 * 严格遵循规范：
 * 1. 服务端把二维产品图抠底（边缘泛洪）。
 * 2. 画框先变成直角四边形；四点保持用户点的斜面。产品图按这个四边形仿射贴进场景。位置、大小、透视在这张图的像素里锁死。
 * 3. 模式 C 时先多一次调用：产品图加上安装位置的环境特写，只改光照、不改结构，输出黑底单体，再进入下一步。
 * 4. 裁出四边形邻域（外扩大约 90% 长边），放大不超过 4 倍、长边不超过 2048，送一次图像模型。
 * 5. 生成图缩回裁剪区域，只保留四边形外扩约 12% 的范围，其余仍是原图。
 * 6. 贴回必须做，此页不可关闭贴回！
 * 7. 增不显示 glb。没有二维图的单品不能安装。glb 滑杆不出现在这一页。
 */
const {
  floodFillCutout,
  affineCompositeToScene,
  cropNeighborhood,
  pastebackToTarget,
} = require('./image-ops');
const { findImageAdapter, readAdapterOutput } = require('./adapter-io');
const { resolveEditSize } = require('./edit-size');

const INSERT_PROMPT = `这是一张室内实拍照片。照片中贴着一张从产品照片抠出的单品图案——它只是设计占位图，用来标明安装位置、大小与透视角度，不是照片原有的物体。
【任务】把贴入的占位图案替换为真实安装在场景中的该单品，并让它完全融入室内光影：
· 位置、大小、透视角度与占位图案完全一致——占位图案的四条边界就是物件的物理边界：物件整体不得超出占位图案范围，也不得明显小于它；边界之外必须是原本的画面；
· 细节严格按占位图案还原：造型、比例、颜色、材质不简化、不重新设计、不遗漏；把产品照的摄影高光替换为场景环境光下的真实漫反射与反光；
· 与所在表面（地面/墙面/台面）紧贴不悬浮、不翘边；带自然的接触阴影与微弱投影，投影方向与照片环境光一致；
· 除该物件及其阴影外，照片其余部分（家具、墙面、地面、光影、构图）全部保持原样，逐像素不变。
输出这一张编辑后的照片本身；禁止输出拼图、多视角图或任何文字水印。`;

/**
 * 模式 C 前置微调：产品图 + 安装位置环境特写 -> 只改光照不改结构 -> 输出单体图
 */
async function runModeCLightingPass(services, cutoutPngBuffer, envCropBuffer) {
  const adapter = findImageAdapter(services && services.db);
  if (!adapter) {
    throw new Error('未配置图像适配器（ark_seedream 或 agnes_image），模式 C 已停止');
  }
  const { executeAdapter } = require('../gen');
  const pB64 = `data:image/png;base64,${cutoutPngBuffer.toString('base64')}`;
  const envB64 = `data:image/jpeg;base64,${envCropBuffer.toString('base64')}`;
  let prompt = '参考图2的环境光照特写，为图1中的产品单体重建符合该环境的光影与色彩色温，保持黑底单体，物体几何外形、结构与相对比例严格不变。';
  if (services && services.db) {
    try {
      const { compileNodePrompt } = require('../prompt-compiler');
      const compiled = compileNodePrompt(services.db, {
        mountPointId: 'wf_edit_insert_pipeline',
        nodeType: 'edit_insert_relit',
        promptId: 'precision_insert_mode_c',
        snippetIds: [],
      });
      if (compiled && compiled.prompt) prompt = compiled.prompt;
    } catch (_) {}
  }
  const res = await executeAdapter(services, adapter, {
    imageUrls: [pB64, envB64],
    prompt,
    kind: 'image',
  });
  const relitRaw = readAdapterOutput(res);
  if (!relitRaw) throw new Error('模式 C 光照重绘未返回图像');
  const reCut = await floodFillCutout(relitRaw, 40);
  return reCut.cutoutBuffer;
}

/**
 * 快捷增执行主函数
 */
async function handleInsert(services, {
  sceneImageBuffer,
  productImageBuffer,
  quadOrBbox,
  mode = 'B', // 'B' (默认) 或 'C'
  productName = '该单品',
  regionClauseText = null,
  maskPath = null,
  model = null,
  outSpec = null,
  prompt: callerPrompt = null,
}) {
  if (!productImageBuffer) {
    throw new Error('增（软装安装）必须提供二维产品图');
  }

  // 1. 服务端把二维产品图抠底 (边缘泛洪)
  const { cutoutBuffer, width: pw, height: ph } = await floodFillCutout(productImageBuffer);
  if (pw < 4 || ph < 4) {
    throw new Error('产品图抠底失败或无有效内容');
  }

  if (!quadOrBbox) throw new Error('未指定有效选区');
  const selection = quadOrBbox;

  let finalCutoutBuffer = cutoutBuffer;

  if (mode === 'C' || mode === 'c') {
    const env = await cropNeighborhood(sceneImageBuffer, selection);
    finalCutoutBuffer = await runModeCLightingPass(services, cutoutBuffer, env.croppedBuffer);
  }

  const { compositeBuffer } = await affineCompositeToScene(
    sceneImageBuffer,
    finalCutoutBuffer,
    selection
  );

  const cropped = await cropNeighborhood(compositeBuffer, selection);
  const cropRect = cropped.cropBox;

  const adapter = findImageAdapter(services && services.db, model);
  if (!adapter) {
    throw new Error('未配置图像适配器（ark_seedream 或 agnes_image），安装已停止');
  }
  // 送模型的是邻域裁剪而不是整张场景，画幅必须按裁剪自己的比例挑档；
  // 场景那一层的 outW/outH 只用于最终贴回后的画布尺寸。
  const cropSpec = outSpec
    ? resolveEditSize({
        db: services && services.db,
        model,
        size: outSpec.tier,
        ratio: null,
        baseW: cropRect.width,
        baseH: cropRect.height,
      })
    : null;
  const { executeAdapter } = require('../gen');
  const cropBase64 = `data:image/jpeg;base64,${cropped.croppedBuffer.toString('base64')}`;
  // 位置、大小、透视已由仿射合成锁死在像素里；用户配方句（已由调用方经
  // reconcilePrompt 按模型能力对齐）优先；缺省才退回内置安装规范模板。
  let prompt = String(callerPrompt || '').trim();
  if (!prompt) {
    prompt = INSERT_PROMPT.replace(/该单品/g, productName || '软装单品');
    if (regionClauseText) prompt += `\n【安装位置】${regionClauseText}。`;
  }
  const res = await executeAdapter(services, adapter, {
    imageUrls: [cropBase64],
    prompt,
    kind: 'image',
    model: model || undefined,
    maskPath: maskPath || undefined,
    size: cropSpec && cropSpec.sizeField ? cropSpec.sizeField : undefined,
    ratio: cropSpec && cropSpec.ratioField ? cropSpec.ratioField : undefined,
  });
  const genCropBuffer = readAdapterOutput(res);
  if (!genCropBuffer) throw new Error('图像适配器未返回安装结果');

  return pastebackToTarget(sceneImageBuffer, genCropBuffer, {
    selection,
    cropRect,
    outW: outSpec ? outSpec.outW : 0,
    outH: outSpec ? outSpec.outH : 0,
  });
}

module.exports = {
  handleInsert,
};
