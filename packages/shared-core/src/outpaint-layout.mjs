/**
 * 扩图比例只由目标画幅、原图占比和位移决定。
 * 预览为了塞进窗口而缩放时，不得改这些比例。
 *
 * occupancy：原图长边占新画布对应边的比例，0.4–0.9。
 * offsetX / offsetY：相对居中位置的位移，单位与抽象画布相同。
 */
export function computeOutpaintNorm({
  nativeW = 800,
  nativeH = 600,
  targetRatio = '16:9',
  occupancy = 0.7,
  offsetX = 0,
  offsetY = 0
} = {}) {
  const parts = String(targetRatio || '16:9').split(':').map(Number);
  const tw = parts[0] > 0 ? parts[0] : 16;
  const th = parts[1] > 0 ? parts[1] : 9;
  const tRatio = tw / th;
  const nW = nativeW > 0 ? nativeW : 800;
  const nH = nativeH > 0 ? nativeH : 600;
  const nRatio = nW / nH;
  const scale = Math.min(0.9, Math.max(0.4, Number(occupancy) || 0.7));

  const canvasW = tRatio;
  const canvasH = 1;
  let innerW;
  let innerH;
  if (nW >= nH) {
    innerW = canvasW * scale;
    innerH = innerW / nRatio;
    if (innerH > canvasH) {
      innerH = canvasH * scale;
      innerW = innerH * nRatio;
    }
  } else {
    innerH = canvasH * scale;
    innerW = innerH * nRatio;
    if (innerW > canvasW) {
      innerW = canvasW * scale;
      innerH = innerW / nRatio;
    }
  }

  const centeredLeft = (canvasW - innerW) / 2;
  const centeredTop = (canvasH - innerH) / 2;
  let left = centeredLeft + (Number(offsetX) || 0);
  let top = centeredTop + (Number(offsetY) || 0);
  left = Math.max(0, Math.min(canvasW - innerW, left));
  top = Math.max(0, Math.min(canvasH - innerH, top));
  const right = canvasW - left - innerW;
  const bottom = canvasH - top - innerH;

  return {
    canvasW,
    canvasH,
    innerW,
    innerH,
    left,
    top,
    leftPct: Math.round((left / innerW) * 100),
    rightPct: Math.round((right / innerW) * 100),
    topPct: Math.round((top / innerH) * 100),
    bottomPct: Math.round((bottom / innerH) * 100)
  };
}
