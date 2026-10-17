/**
 * 专用扩图：按目标比例算出上下左右，调用 veImageX，再把原图像素盖回正中。
 * 未配置凭证时直接失败，不用灰边垫图。
 */
const sharp = require('sharp');
const { expandWithImagex, imagexReady, resolveImagexConfig } = require('./veimagex-expand');

const RATIO_MAP = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
};

function calculatePadding(srcW, srcH, targetRatioStr) {
  const targetRatio = RATIO_MAP[targetRatioStr];
  if (!targetRatio) {
    throw new Error('扩图只接受 16:9、9:16、1:1、4:3、3:4');
  }
  const currentRatio = srcW / srcH;

  let outW = srcW;
  let outH = srcH;

  if (Math.abs(targetRatio - currentRatio) < 0.004) {
    outW = srcW;
    outH = srcH;
  } else if (targetRatio > currentRatio) {
    outW = Math.round(srcH * targetRatio);
    outH = srcH;
  } else {
    outW = srcW;
    outH = Math.round(srcW / targetRatio);
  }

  if (outW % 2 !== 0) outW++;
  if (outH % 2 !== 0) outH++;
  if (outW < srcW) outW = srcW + (srcW % 2);
  if (outH < srcH) outH = srcH + (srcH % 2);

  const padLeft = Math.floor((outW - srcW) / 2);
  const padRight = outW - srcW - padLeft;
  const padTop = Math.floor((outH - srcH) / 2);
  const padBottom = outH - srcH - padTop;

  return {
    srcW,
    srcH,
    outW,
    outH,
    padLeft,
    padRight,
    padTop,
    padBottom,
    targetRatio: targetRatioStr,
  };
}

async function handleExpand(services, { imageBuffer, expandRatio = '16:9' }) {
  const oriented = await sharp(imageBuffer).rotate().toBuffer();
  const meta = await sharp(oriented).metadata();
  const padInfo = calculatePadding(meta.width, meta.height, expandRatio);

  if (padInfo.padLeft === 0 && padInfo.padRight === 0 && padInfo.padTop === 0 && padInfo.padBottom === 0) {
    return oriented;
  }

  if (!imagexReady(resolveImagexConfig(services))) {
    throw new Error('未配置 veImageX：需要 VOLC_ACCESSKEY、VOLC_SECRETKEY、IMAGEX_SERVICE_ID');
  }

  const generated = await expandWithImagex(services, oriented, padInfo);
  const genResized = await sharp(generated)
    .rotate()
    .resize(padInfo.outW, padInfo.outH, { fit: 'fill' })
    .toBuffer();

  return sharp(genResized)
    .composite([{
      input: oriented,
      left: padInfo.padLeft,
      top: padInfo.padTop,
    }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

module.exports = {
  calculatePadding,
  handleExpand,
  RATIO_MAP,
};
