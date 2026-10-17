/**
 * 云端清晰度：整图重绘一次。不贴回，也不把原图当成结果。
 */
const { findImageAdapter, readAdapterOutput } = require('./adapter-io');

const ENHANCE_PROMPT = '请把这张室内实拍整图重绘得更清晰：加强材质纹理、边缘和光影层次，保持原有构图、物体位置、透视、色彩和画面内容。不要裁切，不要加文字或水印，不要改变房间结构。只输出这一张更高清晰度的照片。';

async function handleEnhance(services, { imageBuffer }) {
  const adapter = findImageAdapter(services && services.db);
  if (!adapter) {
    throw new Error('未配置图像适配器（ark_seedream 或 agnes_image），云端清晰度已停止');
  }
  const { executeAdapter } = require('../gen');
  const dataUrl = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
  const result = await executeAdapter(services, adapter, {
    imageUrls: [dataUrl],
    prompt: (() => {
      if (services && services.db) {
        try {
          const { compileNodePrompt } = require('../prompt-compiler');
          const compiled = compileNodePrompt(services.db, {
            mountPointId: 'precision_edit',
            nodeType: 'edit_upscale',
            promptId: 'upscale_enhance',
          });
          if (compiled && compiled.prompt) return compiled.prompt;
        } catch (_) {}
      }
      return ENHANCE_PROMPT;
    })(),
    kind: 'image',
  });
  const buf = readAdapterOutput(result);
  if (!buf) throw new Error('云端清晰度未返回图像');
  return buf;
}

module.exports = { handleEnhance, ENHANCE_PROMPT };
