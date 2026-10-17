/**
 * 管线 B · vlm_text 出口的实际执行体
 *
 * 背景：像 Seedream 5.0 Lite、Agnes Image 这类模型不吃结构化选区。
 * 与其把 `<bbox>` 硬塞进去（模型会照着这个语法编出一个框来，即「幻觉」），
 * 不如把选区裁出来、交给多模态模型认一认，再用自然语言描述位置：
 *
 *   裁选区邻域 → VLM 识别 → { name_cn, attributes } → 拼「图1中位于下右部的胡桃木边几，细高腿」
 *
 * 为什么要裁剪：整图送 VLM 时，小选区里的物体在图里只占几个像素，
 * 模型往往答成「一张客厅照片」。裁出来放大，识别率显著提升。
 *
 * 依赖：handlers/image-ops.cropNeighborhood（选区外扩裁剪）、vlm.chatVision
 */
const sharp = require('sharp');
const { chatVision } = require('../vlm');

/** 识别结果的保守兜底：宁可描述得泛一点，也不要编一个不存在的物体名 */
function fallbackInfo(fallbackName) {
  return {
    name_cn: fallbackName || '目标物体',
    attributes: '',
    summary: '',
    fallback: true,
  };
}

const DESCRIBE_PROMPT = [
  '你看到的是从一张室内设计实景照片里裁出来的局部区域，裁切范围已经对准目标物体。',
  '请只识别这个区域里**最主要的那个家具或物件**，不要描述整个房间。',
  '只返回严格 JSON，不要任何解释文字，格式：',
  '{"name_cn":"中文名（4-8字，如 胡桃木边几 / 圆形地毯 / 落地灯）",',
  ' "attributes":"材质+颜色+风格，一句话，不超过20字",',
  ' "summary":"一句话说明它是什么、朝向如何"}',
  '若区域内确实没有可辨识的家具或物件（例如只是墙面、地面），name_cn 填「墙面」或「地面」。',
].join('\n');

/**
 * 从场景图 + 选区识别出目标物体的语义信息。
 *
 * @param {object} services           { db, config }
 * @param {object} p
 * @param {Buffer} p.sceneImageBuffer 场景原图
 * @param {object} p.selection        选区 IR
 * @param {number} p.natW,p.natH      原图像素尺寸
 * @param {string} [p.fallbackName]
 * @param {string} [p.model]          VLM 模型；缺省用治理台默认
 * @param {object} [p.logger]
 * @returns {Promise<{name_cn:string, attributes:string, summary:string, fallback?:boolean, error?:string}>}
 */
async function describeRegion(services, p) {
  const {
    sceneImageBuffer,
    selection,
    natW,
    natH,
    fallbackName,
    model,
    logger,
  } = p || {};

  if (!sceneImageBuffer || !selection) return fallbackInfo(fallbackName);

  try {
    // 1. 裁选区邻域（带外扩，让 VLM 有上下文）
    let cropBuffer = sceneImageBuffer;
    try {
      const { cropNeighborhood } = require('./image-ops');
      const cropped = await cropNeighborhood(sceneImageBuffer, selection);
      if (cropped && cropped.croppedBuffer) cropBuffer = cropped.croppedBuffer;
    } catch (e) {
      if (logger?.warn) logger.warn('[region-vlm] 裁剪失败，退化为整图识别:', e.message);
    }

    // 2. 控制体积：长边压到 1024 以内，过小则放大到 512 以上
    //    （小选区在整图里只占几个像素，VLM 会答成「一张客厅照片」）
    let b64;
    try {
      const meta = await sharp(cropBuffer).metadata();
      const long = Math.max(meta.width || 0, meta.height || 0);
      const pipe = sharp(cropBuffer);
      if (long > 1024) pipe.resize({ width: 1024, height: 1024, fit: 'inside' });
      else if (long > 0 && long < 512) pipe.resize({ width: 512, height: 512, fit: 'inside' });
      const buf = await pipe.jpeg({ quality: 88 }).toBuffer();
      b64 = buf.toString('base64');
    } catch (e) {
      b64 = cropBuffer.toString('base64');
    }

    // 3. 模型与网关都走治理台（作业绑定 → 目录默认），不在本文件写死任何 model code
    const genGov = require('../gen-governance');
    const ep = typeof genGov.resolveVlmEndpoint === 'function'
      ? genGov.resolveVlmEndpoint(services && services.db, services && services.config, model)
      : null;
    const vlmModel = (ep && ep.modelCode) || model;

    // chatVision 内部已做 JSON 解析（返回对象，不是字符串）
    const info = await chatVision({
      baseUrl: ep && ep.baseUrl,
      apiKey: ep && ep.apiKey,
      model: vlmModel,
      prompt: (() => {
        if (services && services.db) {
          try {
            const { compileNodePrompt } = require('../prompt-compiler');
            const compiled = compileNodePrompt(services.db, {
              mountPointId: 'wf_edit_replace_pipeline',
              nodeType: 'region_vlm',
              promptId: 'region_vlm_describe',
              snippetIds: [],
            });
            if (compiled && compiled.prompt) return compiled.prompt;
          } catch (_) {}
        }
        return DESCRIBE_PROMPT;
      })(),
      images: [b64],
    });

    if (!info || !info.name_cn) return fallbackInfo(fallbackName);

    return {
      name_cn: String(info.name_cn).trim(),
      attributes: String(info.attributes || '').trim(),
      summary: String(info.summary || '').trim(),
      fallback: false,
    };
  } catch (e) {
    if (logger?.warn) logger.warn('[region-vlm] 识别失败，走兜底描述:', e.message);
    return Object.assign(fallbackInfo(fallbackName), { error: e.message });
  }
}

/**
 * 只在该模型确实需要语义描述时才调用 VLM，避免无谓的开销。
 * coords_bbox / coords_point / mask 出口都不需要。
 */
function needsVlm(regionKind) {
  return regionKind === 'vlm_text';
}

module.exports = {
  describeRegion,
  needsVlm,
  fallbackInfo,
  DESCRIBE_PROMPT,
};
