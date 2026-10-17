/**
 * ground-perspective.js
 * 空间透视地面求解器与坐标重映射纯函数
 *
 * 核心能力：
 * 1. 四点透视几何解算：基于地面四边形底边与侧边消隐线，解算地面偏航角（Yaw）与相机俯仰角（Pitch）。
 * 2. 0-999 坐标归一化：生成火山方舟 Seedream 5.0 Pro 所需的标准 <bbox> 标签。
 * 3. 朝向语义分段描述句生成（与服务端/模型严格对齐）。
 * 4. 扩图外扩坐标重映射：当进行镜头拉远（Padding）时，将原图上的坐标精准映射到新全景图。
 */

/**
 * 朝向语义分段描述句 (0-360° 归一化)
 * 严格遵循物体替换与新增的官方约束
 */
export function buildFacingDesc(deg = 0, productName = '该单品') {
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
 * 从四点透视 (P1, P2, P3, P4) 解算地面倾角与透视参数
 * 约定四点顺时针：
 * P1: 左下 (地面基线起点)
 * P2: 右下 (地面基线终点)
 * P3: 右上 (纵向进深端点)
 * P4: 左上 (纵向进深端点)
 * 
 * points 格式为归一化百分比坐标: [{x: 20, y: 70}, ...]
 */
export function computeGroundPlaneFromQuad(points, imgWidth = 1000, imgHeight = 1000) {
  if (!Array.isArray(points) || points.length < 4) {
    return {
      yaw: 0,
      pitch: 18,
      bbox0999: '0 0 999 999',
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      facingDesc: buildFacingDesc(0),
    };
  }

  const p1 = points[0];
  const p2 = points[1];
  const p3 = points[2];
  const p4 = points[3];

  // 1. 求解地面横向基线 P1 -> P2 的倾斜角度 (Yaw)
  const dx = (p2.x - p1.x) * (imgWidth / 100);
  const dy = (p2.y - p1.y) * (imgHeight / 100);
  // 倾斜反正切角 (弧度转角度)
  let baseAngleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
  // 归一化到 0-360
  baseAngleDeg = ((baseAngleDeg % 360) + 360) % 360;

  // 2. 估算相机的俯仰角 (Pitch)
  // 利用两侧纵向边 P4->P1 和 P3->P2 的收拢程度 (消失线)
  // 若两条纵向边在上方相交 (Vanishing Point 上方)，则说明相机为俯视视角
  let estimatedPitch = 20; // 默认室内常规俯视角 ~20°
  try {
    const depthLeft = Math.abs(p1.y - p4.y);
    const depthRight = Math.abs(p2.y - p3.y);
    const avgDepth = (depthLeft + depthRight) / 2;
    const avgWidth = Math.abs(p2.x - p1.x);
    // 纵深越扁平，说明俯角越低 (接近平视)；纵深越大，说明俯角越高
    if (avgWidth > 0) {
      const ratio = avgDepth / avgWidth;
      estimatedPitch = Math.min(45, Math.max(8, Math.round(ratio * 30)));
    }
  } catch (e) {
    estimatedPitch = 20;
  }

  // 3. 计算外接矩形与 0-999 归一化坐标
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.max(0, Math.min(...xs));
  const maxX = Math.min(100, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(100, Math.max(...ys));

  const nx1 = Math.min(999, Math.max(0, Math.round((minX / 100) * 1000)));
  const ny1 = Math.min(999, Math.max(0, Math.round((minY / 100) * 1000)));
  const nx2 = Math.min(999, Math.max(0, Math.round((maxX / 100) * 1000)));
  const ny2 = Math.min(999, Math.max(0, Math.round((maxY / 100) * 1000)));
  const bbox0999 = `${nx1} ${ny1} ${nx2} ${ny2}`;

  return {
    yaw: baseAngleDeg,
    pitch: estimatedPitch,
    bbox0999,
    bboxTag: `<bbox>${bbox0999}</bbox>`,
    bounds: { minX, minY, maxX, maxY },
    facingDesc: buildFacingDesc(baseAngleDeg),
  };
}

/**
 * 从普通矩形框选解算
 * rect: { x1: 20, y1: 30, x2: 60, y2: 80 } (百分比 0-100)
 */
export function computeGroundPlaneFromRect(rect, defaultYaw = 0) {
  if (!rect) {
    return {
      yaw: 0,
      pitch: 18,
      bbox0999: '0 0 999 999',
      bboxTag: '<bbox>0 0 999 999</bbox>',
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      facingDesc: buildFacingDesc(0),
    };
  }

  const minX = Math.min(rect.x1, rect.x2);
  const maxX = Math.max(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2);
  const maxY = Math.max(rect.y1, rect.y2);

  const nx1 = Math.min(999, Math.max(0, Math.round((minX / 100) * 1000)));
  const ny1 = Math.min(999, Math.max(0, Math.round((minY / 100) * 1000)));
  const nx2 = Math.min(999, Math.max(0, Math.round((maxX / 100) * 1000)));
  const ny2 = Math.min(999, Math.max(0, Math.round((maxY / 100) * 1000)));
  const bbox0999 = `${nx1} ${ny1} ${nx2} ${ny2}`;

  return {
    yaw: defaultYaw,
    pitch: 20,
    bbox0999,
    bboxTag: `<bbox>${bbox0999}</bbox>`,
    bounds: { minX, minY, maxX, maxY },
    facingDesc: buildFacingDesc(defaultYaw),
  };
}

/**
 * 扩图拉远坐标重映射
 * 当原图以 padding 方式扩展为新画布尺寸时：
 * srcW, srcH: 原图像素尺寸
 * padLeft, padRight, padTop, padBottom: 四周扩充的留白像素
 * outW = srcW + padLeft + padRight
 * outH = srcH + padTop + padBottom
 * 
 * 将原图百分比坐标 (0-100) 映射到新全景图的百分比坐标与 0-999 归一化坐标
 */
export function remapCoordinates(originalPercentBoxOrQuad, padInfo) {
  if (!padInfo || (!padInfo.padLeft && !padInfo.padTop && !padInfo.padRight && !padInfo.padBottom)) {
    return originalPercentBoxOrQuad;
  }

  const { srcW, srcH, outW, outH, padLeft, padTop } = padInfo;

  const remapPoint = (pt) => {
    // 原始像素坐标
    const px = (pt.x / 100) * srcW;
    const py = (pt.y / 100) * srcH;
    // 新画布中的绝对像素坐标
    const newPx = px + padLeft;
    const newPy = py + padTop;
    // 转换回新画布百分比
    return {
      x: (newPx / outW) * 100,
      y: (newPy / outH) * 100,
    };
  };

  // 如果是四点透视数组
  if (Array.isArray(originalPercentBoxOrQuad)) {
    return originalPercentBoxOrQuad.map(remapPoint);
  }

  // 如果是矩形 { x1, y1, x2, y2 }
  if (originalPercentBoxOrQuad && originalPercentBoxOrQuad.x1 !== undefined) {
    const p1 = remapPoint({ x: originalPercentBoxOrQuad.x1, y: originalPercentBoxOrQuad.y1 });
    const p2 = remapPoint({ x: originalPercentBoxOrQuad.x2, y: originalPercentBoxOrQuad.y2 });
    return {
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
    };
  }

  return originalPercentBoxOrQuad;
}

/**
 * 计算画幅扩图所需的填充边距
 */
export function calculateOutpaintPadding(srcW, srcH, ratioOrRatioStr = '16:9', zoomFactor = 0) {
  let targetRatio = 16 / 9;
  if (typeof ratioOrRatioStr === 'number') {
    targetRatio = ratioOrRatioStr;
  } else {
    const map = {
      '16:9': 16 / 9,
      '9:16': 9 / 16,
      '4:3': 4 / 3,
      '3:4': 3 / 4,
      '1:1': 1,
      '21:9': 21 / 9,
    };
    targetRatio = map[ratioOrRatioStr] || 16 / 9;
  }

  const currentRatio = srcW / srcH;
  let outW = srcW;
  let outH = srcH;

  // 1. 先根据目标比例适配
  if (Math.abs(targetRatio - currentRatio) > 0.005) {
    if (targetRatio > currentRatio) {
      outW = Math.round(srcH * targetRatio);
      outH = srcH;
    } else {
      outW = srcW;
      outH = Math.round(srcW / targetRatio);
    }
  }

  // 2. 结合额外的镜头后拉幅度 (zoomFactor, 例如 0.2 代表额外后退 20%)
  if (zoomFactor > 0) {
    outW = Math.round(outW * (1 + zoomFactor));
    outH = Math.round(outH * (1 + zoomFactor));
  }

  // 偶数对齐
  if (outW % 2 !== 0) outW++;
  if (outH % 2 !== 0) outH++;

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
    ratio: ratioOrRatioStr,
  };
}
