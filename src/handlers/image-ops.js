/**
 * 快捷操作专用图像处理流水线函数 (Sharp + 纯像素高效变换)
 * 具备：边缘泛洪抠底、仿射透视贴图、邻域动态裁切、外扩 12% 精准羽化贴回
 */
const sharp = require('sharp');

/**
 * 1. 边缘泛洪抠底 (Flood Fill Cutout)
 * 探测图像四个角落/边缘的背景色，BFS 泛洪消除纯色/灰底背景，输出 RGBA 带透明通道的 Buffer 与边界 bbox
 */
async function floodFillCutout(imageBuffer, tolerance = 36) {
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
  const width = meta.width;
  const height = meta.height;

  const raw = await image.ensureAlpha().raw().toBuffer();
  const data = new Uint8Array(raw);
  const totalPixels = width * height;

  // 采样四个角的背景基准颜色 (RGB)
  const sampleIndices = [
    0, // 左上
    (width - 1) * 4, // 右上
    (height - 1) * width * 4, // 左下
    (totalPixels - 1) * 4, // 右下
  ];
  let bgR = 0, bgG = 0, bgB = 0;
  for (const idx of sampleIndices) {
    bgR += data[idx];
    bgG += data[idx + 1];
    bgB += data[idx + 2];
  }
  bgR = Math.round(bgR / sampleIndices.length);
  bgG = Math.round(bgG / sampleIndices.length);
  bgB = Math.round(bgB / sampleIndices.length);

  const tolSq = tolerance * tolerance;
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let qHead = 0;
  let qTail = 0;

  function isBgColor(pixelIdx) {
    const r = data[pixelIdx * 4];
    const g = data[pixelIdx * 4 + 1];
    const b = data[pixelIdx * 4 + 2];
    const a = data[pixelIdx * 4 + 3];
    if (a < 20) return true; // 原图原本就透明
    const dr = r - bgR;
    const dg = g - bgG;
    const db = b - bgB;
    return (dr * dr + dg * dg + db * db) <= tolSq;
  }

  // 边缘全周入队
  for (let x = 0; x < width; x++) {
    const top = x;
    const bottom = (height - 1) * width + x;
    if (isBgColor(top)) { visited[top] = 1; queue[qTail++] = top; }
    if (isBgColor(bottom)) { visited[bottom] = 1; queue[qTail++] = bottom; }
  }
  for (let y = 1; y < height - 1; y++) {
    const left = y * width;
    const right = y * width + width - 1;
    if (isBgColor(left)) { visited[left] = 1; queue[qTail++] = left; }
    if (isBgColor(right)) { visited[right] = 1; queue[qTail++] = right; }
  }

  // BFS 泛洪
  while (qHead < qTail) {
    const curr = queue[qHead++];
    data[curr * 4 + 3] = 0; // 置透明

    const cx = curr % width;
    const cy = Math.floor(curr / width);

    // 上下左右 4 邻域
    if (cy > 0) {
      const up = curr - width;
      if (!visited[up] && isBgColor(up)) { visited[up] = 1; queue[qTail++] = up; }
    }
    if (cy < height - 1) {
      const down = curr + width;
      if (!visited[down] && isBgColor(down)) { visited[down] = 1; queue[qTail++] = down; }
    }
    if (cx > 0) {
      const left = curr - 1;
      if (!visited[left] && isBgColor(left)) { visited[left] = 1; queue[qTail++] = left; }
    }
    if (cx < width - 1) {
      const right = curr + 1;
      if (!visited[right] && isBgColor(right)) { visited[right] = 1; queue[qTail++] = right; }
    }
  }

  // 寻找非透明区域 bbox [minX, minY, maxX, maxY]
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX > maxX || minY > maxY) {
    minX = 0; minY = 0; maxX = width - 1; maxY = height - 1;
  }

  const croppedW = Math.max(1, maxX - minX + 1);
  const croppedH = Math.max(1, maxY - minY + 1);

  const croppedBuffer = await sharp(Buffer.from(data.buffer), {
    raw: { width, height, channels: 4 }
  })
    .extract({ left: minX, top: minY, width: croppedW, height: croppedH })
    .png()
    .toBuffer();

  return {
    cutoutBuffer: croppedBuffer,
    bbox: [minX, minY, maxX, maxY],
    width: croppedW,
    height: croppedH,
  };
}

/**
 * 解析 <bbox>x1 y1 x2 y2</bbox> 或 [x1, y1, x2, y2] 或空格分隔字符串
 */
function parseBboxString(str) {
  if (typeof str !== 'string') return null;
  const cleaned = str.trim();
  const m = cleaned.match(/<bbox>\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*<\/bbox>/i)
    || cleaned.match(/\[?\s*([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)\s*\]?/);
  if (m) {
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
  }
  return null;
}

/**
 * 把一个轴上的数换成像素。
 * unit=px 一律按像素，即使数值 ≤100。
 * unit=percent 按 0–100。
 * unit=norm1000 / 0-1000 / seedream 按 0–1000 归一化。
 * 未标注时：0–1 视为相对边长的比例，其余视为像素。
 */
function axisToPx(raw, size, unit) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (unit === 'percent') return (n / 100) * size;
  if (unit === 'fraction') return n * size;
  if (unit === 'norm1000' || unit === '0-1000' || unit === 'seedream') return (n / 1000) * size;
  if (unit === 'px') return n;
  if (n >= 0 && n <= 1) return n * size;
  return n;
}

/**
 * 规格化四点/选区入参为像素坐标数组 [{x, y}, {x, y}, {x, y}, {x, y}]
 */
function normalizeQuadOrRect(input, sw, sh, unitHint) {
  const unit = unitHint || (input && typeof input === 'object' && !Array.isArray(input) ? (input.unit || null) : null);
  if (typeof input === 'string') {
    const parsed = parseBboxString(input);
    if (parsed) {
      return normalizeQuadOrRect({ bbox: parsed }, sw, sh, unit);
    }
  }
  if (Array.isArray(input)) {
    return input.map(p => {
      const rx = Array.isArray(p) ? p[0] : (typeof p === 'object' && p !== null ? p.x : p);
      const ry = Array.isArray(p) ? p[1] : (typeof p === 'object' && p !== null ? p.y : p);
      return {
        x: Math.round(axisToPx(rx, sw, unit)),
        y: Math.round(axisToPx(ry, sh, unit)),
      };
    });
  }
  if (input && typeof input === 'object') {
    if (Array.isArray(input.quad)) return normalizeQuadOrRect(input.quad, sw, sh, unit);
    if (Array.isArray(input.points)) return normalizeQuadOrRect(input.points, sw, sh, unit);
    if (Array.isArray(input.targetQuad)) return normalizeQuadOrRect(input.targetQuad, sw, sh, unit);
    if (Array.isArray(input.rect)) {
      const [rx, ry, rw, rh] = input.rect;
      const x = axisToPx(rx, sw, unit);
      const y = axisToPx(ry, sh, unit);
      const w = axisToPx(rw, sw, unit === 'percent' || unit === 'fraction' || unit === 'norm1000' || unit === '0-1000' ? unit : 'px');
      const h = axisToPx(rh, sh, unit === 'percent' || unit === 'fraction' || unit === 'norm1000' || unit === '0-1000' ? unit : 'px');
      return [
        { x: Math.round(x), y: Math.round(y) },
        { x: Math.round(x + w), y: Math.round(y) },
        { x: Math.round(x + w), y: Math.round(y + h) },
        { x: Math.round(x), y: Math.round(y + h) },
      ];
    }
    let rawBbox = input.bbox;
    if (typeof rawBbox === 'string') {
      rawBbox = parseBboxString(rawBbox);
    }
    if (Array.isArray(rawBbox) && rawBbox.length === 4) {
      const [b1, b2, b3, b4] = rawBbox.map(Number);
      const minX = Math.min(b1, b3);
      const maxX = Math.max(b1, b3);
      const minY = Math.min(b2, b4);
      const maxY = Math.max(b2, b4);
      let effectiveUnit = unit;
      if (!effectiveUnit) {
        // 智能识别 0~1000 归一化输入（如 Seedream <bbox>122 633 699 953</bbox>）
        const allInThousand = [minX, minY, maxX, maxY].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000);
        if (allInThousand) {
          effectiveUnit = [minX, minY, maxX, maxY].some((v) => v > 1) ? 'norm1000' : 'fraction';
        } else {
          effectiveUnit = 'px';
        }
      }
      return normalizeQuadOrRect([
        [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
      ], sw, sh, effectiveUnit);
    }
    if (Number.isFinite(Number(input.left)) && Number.isFinite(Number(input.top))) {
      const left = axisToPx(input.left, sw, unit);
      const top = axisToPx(input.top, sh, unit);
      const right = Number.isFinite(Number(input.right))
        ? axisToPx(input.right, sw, unit)
        : left + axisToPx(input.width || 0, sw, unit === 'percent' || unit === 'fraction' || unit === 'norm1000' || unit === '0-1000' ? unit : 'px');
      const bottom = Number.isFinite(Number(input.bottom))
        ? axisToPx(input.bottom, sh, unit)
        : top + axisToPx(input.height || 0, sh, unit === 'percent' || unit === 'fraction' || unit === 'norm1000' || unit === '0-1000' ? unit : 'px');
      return [
        { x: Math.round(left), y: Math.round(top) },
        { x: Math.round(right), y: Math.round(top) },
        { x: Math.round(right), y: Math.round(bottom) },
        { x: Math.round(left), y: Math.round(bottom) },
      ];
    }
  }
  return [];
}

function selectionBounds(input, sw, sh) {
  const pts = normalizeQuadOrRect(input, sw, sh);
  if (pts.length < 4) throw new Error('未指定有效选区');
  let minX = Math.round(Math.min(...pts.map(p => p.x)));
  let maxX = Math.round(Math.max(...pts.map(p => p.x)));
  let minY = Math.round(Math.min(...pts.map(p => p.y)));
  let maxY = Math.round(Math.max(...pts.map(p => p.y)));
  minX = Math.max(0, Math.min(sw - 1, minX));
  maxX = Math.max(minX + 1, Math.min(sw, maxX));
  minY = Math.max(0, Math.min(sh - 1, minY));
  maxY = Math.max(minY + 1, Math.min(sh, maxY));
  if (maxX - minX < 2 || maxY - minY < 2) throw new Error('选区过小');
  return { minX, minY, maxX, maxY, pts };
}

/**
 * 2. 仿射/透视贴入 (Affine / Perspective Composite)
 * 把抠底后的产品图贴入场景四边形中，像素死锁位置、大小与透视斜面
 * quad: 四个点 [{x, y}, {x, y}, {x, y}, {x, y}] (顺序：左上, 右上, 右下, 左下)
 */
async function affineCompositeToScene(sceneBuffer, cutoutPngBuffer, quad) {
  const sceneSharp = sharp(sceneBuffer);
  const sceneMeta = await sceneSharp.metadata();
  const sw = sceneMeta.width;
  const sh = sceneMeta.height;

  // 转换百分比/绝对坐标到场景像素
  const pts = normalizeQuadOrRect(quad, sw, sh);
  if (pts.length < 4) {
    throw new Error('affineCompositeToScene: 需要至少 4 个定位点');
  }

  // 判断是否为轴对齐直角矩形
  const isAxisAligned =
    Math.abs(pts[0].y - pts[1].y) <= 3 &&
    Math.abs(pts[3].y - pts[2].y) <= 3 &&
    Math.abs(pts[0].x - pts[3].x) <= 3 &&
    Math.abs(pts[1].x - pts[2].x) <= 3;

  if (isAxisAligned) {
    // 直角矩形情况：直接缩放至目标尺寸后叠加
    const left = Math.max(0, Math.min(pts[0].x, pts[3].x));
    const top = Math.max(0, Math.min(pts[0].y, pts[1].y));
    const right = Math.min(sw, Math.max(pts[1].x, pts[2].x));
    const bottom = Math.min(sh, Math.max(pts[2].y, pts[3].y));
    const targetW = Math.max(8, right - left);
    const targetH = Math.max(8, bottom - top);

    const resizedProduct = await sharp(cutoutPngBuffer)
      .resize(targetW, targetH, { fit: 'fill' })
      .png()
      .toBuffer();

    const compositeImage = await sceneSharp
      .composite([{ input: resizedProduct, left, top }])
      .jpeg({ quality: 95 })
      .toBuffer();

    return {
      compositeBuffer: compositeImage,
      placedRect: { left, top, right, bottom, width: targetW, height: targetH },
      pts,
    };
  }

  // 四点斜面情况：进行高质量双线性反向仿射插值映射
  const productSharp = sharp(cutoutPngBuffer);
  const prodMeta = await productSharp.metadata();
  const pw = prodMeta.width;
  const ph = prodMeta.height;
  const prodRaw = await productSharp.ensureAlpha().raw().toBuffer();
  const pData = new Uint8Array(prodRaw);

  // 场景底图转为 RGBA
  const sceneRaw = await sceneSharp.ensureAlpha().raw().toBuffer();
  const sData = new Uint8Array(sceneRaw);

  // 计算四边形外接包围盒
  const minX = Math.max(0, Math.min(pts[0].x, pts[1].x, pts[2].x, pts[3].x));
  const maxX = Math.min(sw - 1, Math.max(pts[0].x, pts[1].x, pts[2].x, pts[3].x));
  const minY = Math.max(0, Math.min(pts[0].y, pts[1].y, pts[2].y, pts[3].y));
  const maxY = Math.min(sh - 1, Math.max(pts[0].y, pts[1].y, pts[2].y, pts[3].y));

  // 前向仿射基底：以 pts[0] 为原点，(pts[1]-pts[0]) 为水平轴，(pts[3]-pts[0]) 为垂直轴
  const O = pts[0];
  const e1x = pts[1].x - O.x;
  const e1y = pts[1].y - O.y;
  const e2x = pts[3].x - O.x;
  const e2y = pts[3].y - O.y;
  const det = e1x * e2y - e1y * e2x;

  if (Math.abs(det) > 1e-4) {
    const invM00 = e2y / det;
    const invM01 = -e2x / det;
    const invM10 = -e1y / det;
    const invM11 = e1x / det;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - O.x;
        const dy = y - O.y;
        const u = invM00 * dx + invM01 * dy;
        const v = invM10 * dx + invM11 * dy;

        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
          // 在产品图里双线性采样
          const px = u * (pw - 1);
          const py = v * (ph - 1);
          const x0 = Math.floor(px);
          const y0 = Math.floor(py);
          const x1 = Math.min(pw - 1, x0 + 1);
          const y1 = Math.min(ph - 1, y0 + 1);
          const fx = px - x0;
          const fy = py - y0;

          const idx00 = (y0 * pw + x0) * 4;
          const idx10 = (y0 * pw + x1) * 4;
          const idx01 = (y1 * pw + x0) * 4;
          const idx11 = (y1 * pw + x1) * 4;

          const alpha =
            (1 - fx) * (1 - fy) * pData[idx00 + 3] +
            fx * (1 - fy) * pData[idx10 + 3] +
            (1 - fx) * fy * pData[idx01 + 3] +
            fx * fy * pData[idx11 + 3];

          if (alpha > 5) {
            const r =
              (1 - fx) * (1 - fy) * pData[idx00] +
              fx * (1 - fy) * pData[idx10] +
              (1 - fx) * fy * pData[idx01] +
              fx * fy * pData[idx11];
            const g =
              (1 - fx) * (1 - fy) * pData[idx00 + 1] +
              fx * (1 - fy) * pData[idx10 + 1] +
              (1 - fx) * fy * pData[idx01 + 1] +
              fx * fy * pData[idx11 + 1];
            const b =
              (1 - fx) * (1 - fy) * pData[idx00 + 2] +
              fx * (1 - fy) * pData[idx10 + 2] +
              (1 - fx) * fy * pData[idx01 + 2] +
              fx * fy * pData[idx11 + 2];

            const aNorm = alpha / 255;
            const sIdx = (y * sw + x) * 4;
            sData[sIdx] = Math.round(r * aNorm + sData[sIdx] * (1 - aNorm));
            sData[sIdx + 1] = Math.round(g * aNorm + sData[sIdx + 1] * (1 - aNorm));
            sData[sIdx + 2] = Math.round(b * aNorm + sData[sIdx + 2] * (1 - aNorm));
          }
        }
      }
    }
  }

  const compositeImage = await sharp(Buffer.from(sData.buffer), {
    raw: { width: sw, height: sh, channels: 4 }
  })
    .jpeg({ quality: 95 })
    .toBuffer();

  return {
    compositeBuffer: compositeImage,
    placedRect: { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX, height: maxY - minY },
    pts,
  };
}

/**
 * 3. 邻域裁切 (Crop Neighborhood)
 * 裁出四边形邻域（外扩约 90% 长边），放大不超过 4 倍、长边不超过 2048
 */
async function cropNeighborhood(sceneBuffer, quadOrRect) {
  const meta = await sharp(sceneBuffer).metadata();
  const sw = meta.width;
  const sh = meta.height;

  let minX, minY, maxX, maxY;
  const pts = normalizeQuadOrRect(quadOrRect, sw, sh);
  if (pts.length > 0) {
    minX = Math.min(...pts.map(p => p.x));
    maxX = Math.max(...pts.map(p => p.x));
    minY = Math.min(...pts.map(p => p.y));
    maxY = Math.max(...pts.map(p => p.y));
  } else if (quadOrRect && Number.isFinite(quadOrRect.left)) {
    minX = quadOrRect.left;
    minY = quadOrRect.top;
    maxX = Number.isFinite(quadOrRect.right) ? quadOrRect.right : quadOrRect.left + (quadOrRect.width || 0);
    maxY = Number.isFinite(quadOrRect.bottom) ? quadOrRect.bottom : quadOrRect.top + (quadOrRect.height || 0);
  } else {
    minX = 0; minY = 0; maxX = sw; maxY = sh;
  }

  const bw = Math.max(16, maxX - minX);
  const bh = Math.max(16, maxY - minY);
  const longSide = Math.max(bw, bh);

  // 外扩约 90% 长边
  const pad = Math.round(longSide * 0.9);
  let cropLeft = Math.max(0, Math.floor(minX - pad));
  let cropTop = Math.max(0, Math.floor(minY - pad));
  let cropRight = Math.min(sw, Math.ceil(maxX + pad));
  let cropBottom = Math.min(sh, Math.ceil(maxY + pad));

  let cropW = cropRight - cropLeft;
  let cropH = cropBottom - cropTop;

  // 限制长边不超过 2048，放大不超过 4 倍
  const scale = Math.min(4, 2048 / Math.max(cropW, cropH));
  const finalW = Math.round(cropW * (scale > 1 ? scale : 1));
  const finalH = Math.round(cropH * (scale > 1 ? scale : 1));

  let pipe = sharp(sceneBuffer).extract({
    left: cropLeft,
    top: cropTop,
    width: cropW,
    height: cropH,
  });

  if (scale > 1) {
    pipe = pipe.resize(finalW, finalH, { fit: 'fill' });
  }

  const croppedBuffer = await pipe.jpeg({ quality: 95 }).toBuffer();

  return {
    croppedBuffer,
    cropBox: {
      left: cropLeft,
      top: cropTop,
      right: cropRight,
      bottom: cropBottom,
      width: cropW,
      height: cropH,
      x: cropLeft,
      y: cropTop,
      w: cropW,
      h: cropH,
      scale,
    },
    originalTargetBox: { minX, minY, maxX, maxY, width: bw, height: bh },
  };
}

/**
 * 4. 选区外扩约 12% 羽化贴回 (Pasteback with 12% Expansion & Feathering)
 * 生成图缩回裁剪区域，只保留选区/四边形外扩约 12% 的范围，其余仍是原图
 */
async function pastebackComposite(originalSceneBuffer, generatedCropBuffer, cropRect, quadOrRect) {
  const origSharp = sharp(originalSceneBuffer);
  const origMeta = await origSharp.metadata();
  const sw = origMeta.width;
  const sh = origMeta.height;

  const cWidth = cropRect.width || cropRect.w || (cropRect.right - cropRect.left);
  const cHeight = cropRect.height || cropRect.h || (cropRect.bottom - cropRect.top);
  const cLeft = Number.isFinite(cropRect.left) ? cropRect.left : (cropRect.x || 0);
  const cTop = Number.isFinite(cropRect.top) ? cropRect.top : (cropRect.y || 0);

  // 1. 生成图缩放回裁剪区域的实际尺寸
  const resizedGenBuffer = await sharp(generatedCropBuffer)
    .resize(cWidth, cHeight, { fit: 'fill' })
    .png()
    .toBuffer();

  // 2. 在裁剪区域坐标系中计算选区范围
  let minX, minY, maxX, maxY;
  const pts = normalizeQuadOrRect(quadOrRect, sw, sh);
  if (pts.length > 0) {
    minX = Math.min(...pts.map(p => p.x)) - cLeft;
    maxX = Math.max(...pts.map(p => p.x)) - cLeft;
    minY = Math.min(...pts.map(p => p.y)) - cTop;
    maxY = Math.max(...pts.map(p => p.y)) - cTop;
  } else if (quadOrRect && Number.isFinite(quadOrRect.left)) {
    minX = quadOrRect.left - cLeft;
    minY = quadOrRect.top - cTop;
    maxX = (Number.isFinite(quadOrRect.right) ? quadOrRect.right : quadOrRect.left + (quadOrRect.width || 0)) - cLeft;
    maxY = (Number.isFinite(quadOrRect.bottom) ? quadOrRect.bottom : quadOrRect.top + (quadOrRect.height || 0)) - cTop;
  } else {
    minX = 0; minY = 0; maxX = cWidth; maxY = cHeight;
  }

  const tw = maxX - minX;
  const th = maxY - minY;
  // 外扩约 12%
  const expandX = Math.round(tw * 0.12);
  const expandY = Math.round(th * 0.12);
  const expLeft = Math.max(0, minX - expandX);
  const expTop = Math.max(0, minY - expandY);
  const expRight = Math.min(cWidth, maxX + expandX);
  const expBottom = Math.min(cHeight, maxY + expandY);

  // 3. 构造羽化遮罩。斜向四点用外扩后的四边形，直角框用外接矩形。
  const maskW = cWidth;
  const maskH = cHeight;
  const feather = Math.max(4, Math.round(Math.min(tw, th) * 0.08));
  const localPts = pts.map(p => ({ x: p.x - cLeft, y: p.y - cTop }));
  const axisAligned = localPts.length >= 4 &&
    Math.abs(localPts[0].y - localPts[1].y) <= 3 &&
    Math.abs(localPts[3].y - localPts[2].y) <= 3 &&
    Math.abs(localPts[0].x - localPts[3].x) <= 3 &&
    Math.abs(localPts[1].x - localPts[2].x) <= 3;
  let shape = `<rect x="${expLeft}" y="${expTop}" width="${Math.max(1, expRight - expLeft)}" height="${Math.max(1, expBottom - expTop)}" fill="white" rx="${feather}" ry="${feather}" filter="url(#blur)" />`;
  if (!axisAligned && localPts.length >= 4) {
    const cx = localPts.reduce((s, p) => s + p.x, 0) / localPts.length;
    const cy = localPts.reduce((s, p) => s + p.y, 0) / localPts.length;
    const poly = localPts
      .map(p => `${Math.round(cx + (p.x - cx) * 1.12)},${Math.round(cy + (p.y - cy) * 1.12)}`)
      .join(' ');
    shape = `<polygon points="${poly}" fill="white" filter="url(#blur)" />`;
  }

  const svgMask = `
    <svg width="${maskW}" height="${maskH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="blur">
          <feGaussianBlur stdDeviation="${feather}" />
        </filter>
      </defs>
      <!-- 底必须透明：dest-in 只认 alpha，不透明的黑底会让整幅生成图盖住框外 -->
      <rect width="${maskW}" height="${maskH}" fill="black" fill-opacity="0" />
      ${shape}
    </svg>
  `;

  const maskPng = await sharp(Buffer.from(svgMask)).png().toBuffer();

  // 4. 将羽化遮罩应用到生成裁切图上
  const maskedGenCrop = await sharp(resizedGenBuffer)
    .composite([{ input: maskPng, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 5. 贴回原图
  const finalResult = await origSharp
    .composite([{ input: maskedGenCrop, left: Math.round(cLeft), top: Math.round(cTop) }])
    .jpeg({ quality: 95 })
    .toBuffer();

  return finalResult;
}

/**
 * cover 居中裁切下「源画布像素 -> 目标画布像素」的映射。
 * 原图放大到目标档时会被裁掉一点点边，选区必须跟着同一变换走，否则贴回位置会偏。
 */
function coverTransform(srcW, srcH, dstW, dstH) {
  const s = Math.max(dstW / srcW, dstH / srcH);
  return { s, dx: (srcW * s - dstW) / 2, dy: (srcH * s - dstH) / 2 };
}

/** 回传 unit:'px'，避免整数坐标被 axisToPx 当成 0-1 比例重读 */
function scaleSelection(input, t, srcW, srcH) {
  const pts = normalizeQuadOrRect(input, srcW, srcH);
  if (!pts.length) return null;
  return {
    quad: pts.map((p) => ({ x: Math.round(p.x * t.s - t.dx), y: Math.round(p.y * t.s - t.dy) })),
    unit: 'px',
  };
}

function scaleRect(rect, t) {
  const left = Number(rect.left) || 0;
  const top = Number(rect.top) || 0;
  const width = Number(rect.width || (Number(rect.right) - left)) || 0;
  const height = Number(rect.height || (Number(rect.bottom) - top)) || 0;
  return {
    left: Math.round(left * t.s - t.dx),
    top: Math.round(top * t.s - t.dy),
    width: Math.round(width * t.s),
    height: Math.round(height * t.s),
  };
}

/**
 * 贴回并让输出真的落在目标像素档上：先把原图按 cover 放大到 outW×outH 当底，
 * 选区与裁切框同步映射，再把模型结果贴进框内。
 * 目标尺寸等于原图时直接走原路径，不做无谓重采样。
 */
async function pastebackToTarget(sceneBuffer, generatedBuffer, { selection = null, cropRect = null, outW = 0, outH = 0 } = {}) {
  const meta = await sharp(sceneBuffer).metadata();
  const sw = meta.width;
  const sh = meta.height;
  const fullRect = { left: 0, top: 0, width: sw, height: sh };
  if (!outW || !outH || (outW === sw && outH === sh)) {
    return pastebackComposite(sceneBuffer, generatedBuffer, cropRect || fullRect, selection || cropRect || fullRect);
  }
  const t = coverTransform(sw, sh, outW, outH);
  const baseBuffer = await sharp(sceneBuffer)
    .resize(outW, outH, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 96 })
    .toBuffer();
  // 没给裁剪框就是整幅：cover 之后目标画布整体都在可视区内，
  // 再拿源图尺寸去缩放会算出比画布更高的框（宽幅时直接溢出报错）。
  const scaledRect = cropRect
    ? scaleRect(cropRect, t)
    : { left: 0, top: 0, width: outW, height: outH };
  const scaledSel = selection ? scaleSelection(selection, t, sw, sh) : null;
  return pastebackComposite(baseBuffer, generatedBuffer, scaledRect, scaledSel || scaledRect);
}

/**
 * 选区内部裁切 (JEV 选区分类专用，严禁外扩 90%，严禁带标注)
 * 适配 TypeSafe System One: 短边 < 280 放大到 280，长边 > 1568 缩小到 1568；
 * 宽高比 > 5.6 时长边收至 1568，短边以边缘像素延展至 280。输出 JPEG quality 85。
 */
async function cropSelectionInterior(imageBuffer, selection, { minShort = 280, maxLong = 1568, quality = 85 } = {}) {
  let norm = null;
  let rawBbox = null;
  if (typeof selection === 'string') {
    rawBbox = parseBboxString(selection);
  } else if (Array.isArray(selection) && selection.length === 4 && typeof selection[0] === 'number') {
    rawBbox = selection;
  } else if (selection && typeof selection === 'object') {
    if (typeof selection.bbox === 'string') {
      rawBbox = parseBboxString(selection.bbox);
    } else if (Array.isArray(selection.bbox)) {
      rawBbox = selection.bbox;
    } else if (Array.isArray(selection.norm) && selection.norm.length === 4) {
      rawBbox = selection.norm;
    }
  }

  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width;
  const imgH = meta.height;

  if (rawBbox && rawBbox.length === 4) {
    const [b1, b2, b3, b4] = rawBbox.map(Number);
    const bMinX = Math.min(b1, b3);
    const bMaxX = Math.max(b1, b3);
    const bMinY = Math.min(b2, b4);
    const bMaxY = Math.max(b2, b4);
    let scaleX = 1;
    let scaleY = 1;
    if (bMaxX > 1000 || bMaxY > 1000) {
      scaleX = imgW || 1;
      scaleY = imgH || 1;
    } else if (bMinX > 1 || bMinY > 1 || bMaxX > 1 || bMaxY > 1) {
      scaleX = 1000;
      scaleY = 1000;
    }
    const nx = bMinX / scaleX;
    const ny = bMinY / scaleY;
    const nw = Math.max(0.001, (bMaxX - bMinX) / scaleX);
    const nh = Math.max(0.001, (bMaxY - bMinY) / scaleY);
    norm = { x: nx, y: ny, w: nw, h: nh };
  } else if (!selection) {
    norm = { x: 0, y: 0, w: 1, h: 1 };
  } else if (selection.norm_points && Array.isArray(selection.norm_points) && selection.norm_points.length > 0) {
    const pts = selection.norm_points;
    const minX = Math.min(...pts.map((p) => (p && typeof p.x === 'number' ? p.x : 0)));
    const maxX = Math.max(...pts.map((p) => (p && typeof p.x === 'number' ? p.x : 0)));
    const minY = Math.min(...pts.map((p) => (p && typeof p.y === 'number' ? p.y : 0)));
    const maxY = Math.max(...pts.map((p) => (p && typeof p.y === 'number' ? p.y : 0)));
    norm = { x: minX, y: minY, w: Math.max(0.001, maxX - minX), h: Math.max(0.001, maxY - minY) };
  } else if (selection.normPoints && Array.isArray(selection.normPoints) && selection.normPoints.length > 0) {
    const pts = selection.normPoints;
    const minX = Math.min(...pts.map((p) => (p && typeof p.x === 'number' ? p.x : 0)));
    const maxX = Math.max(...pts.map((p) => (p && typeof p.x === 'number' ? p.x : 0)));
    const minY = Math.min(...pts.map((p) => (p && typeof p.y === 'number' ? p.y : 0)));
    const maxY = Math.max(...pts.map((p) => (p && typeof p.y === 'number' ? p.y : 0)));
    norm = { x: minX, y: minY, w: Math.max(0.001, maxX - minX), h: Math.max(0.001, maxY - minY) };
  } else if (selection.norm && typeof selection.norm === 'object') {
    norm = selection.norm;
  } else if (typeof selection.x === 'number' && typeof selection.y === 'number') {
    norm = selection;
  } else {
    norm = { x: 0, y: 0, w: 1, h: 1 };
  }

  let left = 0;
  let top = 0;
  let width = imgW;
  let height = imgH;

  const maxNormX = Math.max(norm.x || 0, (norm.x || 0) + (norm.w || 0));
  const maxNormY = Math.max(norm.y || 0, (norm.y || 0) + (norm.h || 0));

  if (maxNormX > 1000 || maxNormY > 1000) {
    // 已经为绝对物理像素坐标，直接钳制取整，杜绝浮点往返截断误差
    left = Math.max(0, Math.min(imgW - 1, Math.round(norm.x || 0)));
    top = Math.max(0, Math.min(imgH - 1, Math.round(norm.y || 0)));
    width = Math.max(1, Math.min(imgW - left, Math.round(norm.w || (imgW - left))));
    height = Math.max(1, Math.min(imgH - top, Math.round(norm.h || (imgH - top))));
  } else {
    let scaleX = 1;
    let scaleY = 1;
    // norm 对象契约是 0~1 归一化分量；选区允许越界（x+w 可 >1，下面统一钳制），
    // 所以绝不能用 x+w 越界判断千分比——否则右下溢出选区会被整体缩小 1000 倍成 1px 方块。
    // 仅当某个分量本身明显超出比例域（>1.5，典型为 Seedream 0~1000 整数坐标误走 norm 通道）才按千分比解析。
    const normCompMax = Math.max(norm.x || 0, norm.y || 0, norm.w || 0, norm.h || 0);
    if (normCompMax > 1.5) {
      scaleX = 1000;
      scaleY = 1000;
    }
    const normX = (norm.x || 0) / scaleX;
    const normY = (norm.y || 0) / scaleY;
    const normW = (norm.w || 1) / scaleX;
    const normH = (norm.h || 1) / scaleY;

    left = Math.max(0, Math.floor(normX * imgW));
    top = Math.max(0, Math.floor(normY * imgH));
    width = Math.round(normW * imgW);
    height = Math.round(normH * imgH);

    if (left + width > imgW) width = imgW - left;
    if (top + height > imgH) height = imgH - top;
    left = Math.max(0, Math.min(left, imgW - 1));
    top = Math.max(0, Math.min(top, imgH - 1));
    width = Math.max(1, Math.min(width, imgW - left));
    height = Math.max(1, Math.min(height, imgH - top));
  }

  let pipeline = sharp(imageBuffer).extract({ left, top, width, height });

  const curW = width;
  const curH = height;
  const longEdge = Math.max(curW, curH);
  const shortEdge = Math.min(curW, curH);
  const ar = longEdge / shortEdge;
  const maxAr = maxLong / minShort; // 1568 / 280 = 5.6

  if (ar > maxAr) {
    if (curW >= curH) {
      const scaledW = maxLong;
      const scaledH = Math.max(1, Math.round(curH * (maxLong / curW)));
      pipeline = pipeline.resize(scaledW, scaledH);
      const diff = minShort - scaledH;
      if (diff > 0) {
        const topPad = Math.floor(diff / 2);
        const bottomPad = diff - topPad;
        pipeline = pipeline.extend({ top: topPad, bottom: bottomPad, extendWith: 'copy' });
      }
    } else {
      const scaledH = maxLong;
      const scaledW = Math.max(1, Math.round(curW * (maxLong / curH)));
      pipeline = pipeline.resize(scaledW, scaledH);
      const diff = minShort - scaledW;
      if (diff > 0) {
        const leftPad = Math.floor(diff / 2);
        const rightPad = diff - leftPad;
        pipeline = pipeline.extend({ left: leftPad, right: rightPad, extendWith: 'copy' });
      }
    }
  } else {
    if (shortEdge < minShort) {
      const scale = minShort / shortEdge;
      const targetW = Math.round(curW * scale);
      const targetH = Math.round(curH * scale);
      pipeline = pipeline.resize(targetW, targetH);
    } else if (longEdge > maxLong) {
      const scale = maxLong / longEdge;
      const targetW = Math.round(curW * scale);
      const targetH = Math.round(curH * scale);
      pipeline = pipeline.resize(targetW, targetH);
    }
  }

  return await pipeline.jpeg({ quality }).toBuffer();
}

module.exports = {
  axisToPx,
  parseBboxString,
  normalizeQuadOrRect,
  selectionBounds,
  floodFillCutout,
  affineCompositeToScene,
  cropNeighborhood,
  pastebackComposite,
  coverTransform,
  scaleSelection,
  scaleRect,
  pastebackToTarget,
  cropSelectionInterior,
};
