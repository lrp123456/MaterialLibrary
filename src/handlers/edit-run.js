/**
 * 统一 /edit/run 管线（八操作）
 * 输入：assetFid/image, op, region{bbox|quad|strokes}, prompt?, glb?, product?
 * 输出：{ image:{b64}, apiBox, untouchedDiff, regionNote }
 *
 * 复用 handlers/image-ops 贴回与安装合成；生图走 executeAdapter(ark_seedream)
 *
 * ★ 选区走向由 handlers/region-route.js 按 caps.region.kind 决定（四出口）：
 *    coords_bbox / coords_point / mask / vlm_text
 *   本文件不再硬编码 <bbox> —— 只消费 route 给出的 `text`（见 regionClause）。
 *   任何降级都会通过 regionNote 回写，客户端原样展示给用户。
 */
const sharp = require('sharp');
const {
  pastebackToTarget,
  selectionBounds,
  cropNeighborhood,
  floodFillCutout,
  affineCompositeToScene,
} = require('./image-ops');
const { findImageAdapter, readAdapterOutput } = require('./adapter-io');
const { resolveEditSize } = require('./edit-size');
const { regionClause, regionNoteOf, routeFor, reconcilePrompt, stripCoordSyntax } = require('./region-route');
const { describeRegion, needsVlm } = require('./region-vlm');

const OPS = new Set(['replace', 'insert', 'add', 'space', 'remove', 'expand', 'style_transfer', 'clarity', 'install', 'gap']);
const OP_ALIAS = {
  install: 'insert',
  gap: 'space',
  watermark: 'remove',
  upscale: 'clarity',
};

/**
 * 精修结果统一落盘为 derivatives（自动计算 sha256/md5/phash 并登记 export_registry）
 */
async function persistEditDerivative(services, assetFid, kind, buffer, params = {}) {
  if (!assetFid || !services || !services.db || !buffer || !buffer.length) return null;
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmpFile = path.join(os.tmpdir(), `edit_${kind}_${assetFid}_${Date.now()}.jpg`);
  try {
    fs.writeFileSync(tmpFile, buffer);
    const { createDerivative } = require('../derivatives');
    const meta = await sharp(buffer).metadata().catch(() => ({}));
    return await createDerivative(services, {
      assetFid,
      kind,
      srcPath: tmpFile,
      fileName: `${kind}_${Date.now()}.jpg`,
      width: meta.width || null,
      height: meta.height || null,
      mime: 'image/jpeg',
      params,
    });
  } catch (e) {
    console.warn('[edit-run] 写入衍生图失败:', e.message);
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

/** 自定义风格的 AI 锚定描述 + 用户特别要求，合成一段可直插模板的约束文本。 */
function buildStyleExtraPrompt(stylePrompt, extraPrompt) {
  const blocks = [];
  const anchor = String(stylePrompt || '').trim();
  if (anchor) {
    blocks.push(`【风格锚定描述（必须逐条在画面中落实，但不要改变空间几何结构）】${anchor}`);
  }
  const extra = String(extraPrompt || '').trim();
  if (extra) blocks.push(`【用户特别要求】${extra}。`);
  return blocks.join('\n');
}

/** 出图参数回显给客户端的形状：选了什么都照实说，包括有没有真的贴回。 */
function publicOutSize(spec, pastedBack) {
  return {
    declared: spec.declared,
    tier: spec.tier,
    ratio: spec.ratio,
    sizeField: spec.sizeField,
    outW: spec.outW || null,
    outH: spec.outH || null,
    exact: spec.exact,
    followsSource: spec.followsSource,
    pasteback: !!pastedBack,
  };
}

function apiBoxFromBounds(minX, minY, maxX, maxY, sw, sh) {
  return {
    x1: Math.min(999, Math.max(0, Math.round((minX / sw) * 999))),
    y1: Math.min(999, Math.max(0, Math.round((minY / sh) * 999))),
    x2: Math.min(999, Math.max(0, Math.round((maxX / sw) * 999))),
    y2: Math.min(999, Math.max(0, Math.round((maxY / sh) * 999))),
  };
}

function normalizeSelection(region, sw, sh) {
  if (!region) return null;
  if (Array.isArray(region.strokes) && region.strokes.length) {
    return {
      type: 'brush',
      strokes: region.strokes,
      bbox: region.bbox || null,
      maskUrl: region.maskUrl || null,
      maskId: region.maskId || null,
      unit: 'px',
    };
  }
  if (region.maskUrl && region.bbox) {
    return {
      type: 'brush',
      bbox: region.bbox,
      maskUrl: region.maskUrl,
      maskId: region.maskId || null,
      unit: 'px',
    };
  }
  if (region.type === 'mask' && region.bbox) {
    return {
      left: region.bbox.x1,
      top: region.bbox.y1,
      right: region.bbox.x2,
      bottom: region.bbox.y2,
      unit: 'px',
    };
  }
  if (region.points && region.points.length >= 4) {
    return { quad: region.points, unit: 'px' };
  }
  const b = region.bbox || region;
  if (b.x1 != null) {
    return { left: b.x1, top: b.y1, right: b.x2, bottom: b.y2, unit: 'px' };
  }
  return null;
}

/** 框外逐像素对比：返回 unchangedRatio 与 diffPixels */
async function untouchedDiff(originalBuf, resultBuf, selection) {
  try {
    const metaA = await sharp(originalBuf).metadata();
    const sw = metaA.width;
    const sh = metaA.height;
    const rawA = await sharp(originalBuf).resize(sw, sh).ensureAlpha().raw().toBuffer();
    const rawB = await sharp(resultBuf).resize(sw, sh, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    let bounds;
    try {
      bounds = selectionBounds(selection, sw, sh);
    } catch {
      bounds = { minX: 0, minY: 0, maxX: sw, maxY: sh };
    }
    let outside = 0;
    let same = 0;
    const threshold = 12;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const inside =
          x >= bounds.minX - 2 && x <= bounds.maxX + 2 && y >= bounds.minY - 2 && y <= bounds.maxY + 2;
        if (inside) continue;
        outside++;
        const i = (y * sw + x) * 4;
        const dr = Math.abs(rawA[i] - rawB[i]);
        const dg = Math.abs(rawA[i + 1] - rawB[i + 1]);
        const db = Math.abs(rawA[i + 2] - rawB[i + 2]);
        if (dr <= threshold && dg <= threshold && db <= threshold) same++;
      }
    }
    const unchangedRatio = outside ? Math.round((same / outside) * 10000) / 10000 : 1;
    return { unchangedRatio, diffPixels: outside - same, outsidePixels: outside };
  } catch (e) {
    return { unchangedRatio: null, error: e.message };
  }
}

async function runAdapter(services, imageBuffers, prompt, preferredModel, extra) {
  const adapter = findImageAdapter(services && services.db, preferredModel);
  if (!adapter) {
    throw new Error('未配置图像适配器（ark_seedream 或 agnes_image），编辑已停止');
  }
  const { executeAdapter } = require('../gen');
  const imageUrls = imageBuffers.map((buf, i) => {
    const mime = i === 0 ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  });
  const res = await executeAdapter(services, adapter, {
    imageUrls,
    prompt,
    kind: 'image',
    model: preferredModel || undefined,
    // mask 出口：栅格化蒙版由 executeAdapter 追加为最后一张参考图
    maskPath: (extra && extra.maskPath) || undefined,
    // 出图参数由调用方经 edit-size 换算后才进来，本文件不再兜任何默认档
    size: (extra && extra.size) || undefined,
    ratio: (extra && extra.ratio) || undefined,
  });
  const out = readAdapterOutput(res);
  if (!out) throw new Error('图像适配器未返回结果');
  return out;
}

/** 增加：参考图(或纯文本) + 空地框，支持留白约束与避让区保护 */
async function handleAdd(services, {
  sceneImageBuffer,
  refImageBuffer,
  selection,
  prompt,
  productName,
  model,
  clauseText,
  maskPath,
  avoidBBox,
  gapPct,
  outSpec = null,
  pasteback = false,
}) {
  const meta = await sharp(sceneImageBuffer).metadata();
  const sw = meta.width;
  const sh = meta.height;
  const { minX, minY, maxX, maxY } = selectionBounds(selection, sw, sh);
  const box = apiBoxFromBounds(minX, minY, maxX, maxY, sw, sh);
  // 选区子句由 region-route 按模型能力生成；缺省才退回本地 bbox 文案
  const boxStr = clauseText || `<bbox>${box.x1} ${box.y1} ${box.x2} ${box.y2}</bbox>`;

  // 1. 留白约束子句
  let gapClause = '';
  const gPct = Number(gapPct) || 0;
  if (gPct > 0) {
    gapClause = `\n【留白约束】新增物件与周边现有物体（茶几、沙发、电视柜等）之间必须留出明显空隙（不小于标记框宽度的 ${gPct}%），不得挤靠或紧贴任何现有家具。`;
  }

  // 2. 避让保护区子句
  let avoidClause = '';
  if (avoidBBox && avoidBBox.x1 != null) {
    const ax1 = Math.min(avoidBBox.x1, avoidBBox.x2);
    const ay1 = Math.min(avoidBBox.y1, avoidBBox.y2);
    const ax2 = Math.max(avoidBBox.x1, avoidBBox.x2);
    const ay2 = Math.max(avoidBBox.y1, avoidBBox.y2);
    const abox = apiBoxFromBounds(ax1, ay1, ax2, ay2, sw, sh);
    avoidClause = `\n【避让保护区约束】图1 <bbox>${abox.x1} ${abox.y1} ${abox.x2} ${abox.y2}</bbox> 为严格保护区域：禁止任何新增物体或阴影侵入该区域，该区域所有像素绝对严格保持原样！`;
  }

  let compiledAddPrompt = '';
  if (!prompt && services && services.db) {
    try {
      const { compileNodePrompt } = require('../prompt-compiler');
      const compiled = compileNodePrompt(services.db, {
        mountPointId: 'precision_edit',
        nodeType: 'edit_add',
        promptId: 'precision_add',
        modelId: model || 'seedream5pro',
        vars: {
          regionClause: boxStr,
          box1Tag: `${box.x1} ${box.y1} ${box.x2} ${box.y2}`,
          product_name: productName || '物件',
        },
      });
      if (compiled && compiled.prompt) compiledAddPrompt = compiled.prompt;
    } catch (_) {}
  }

  let finalPrompt = prompt || compiledAddPrompt;
  if (!finalPrompt) {
    if (refImageBuffer) {
      finalPrompt = `图1是待编辑的室内场景实拍照片，图2是${productName || '物件'}的款式与朝向参考图。
【任务】在图1 ${boxStr} 标记的区域内新增图2所示款式的${productName || '物件'}：该处目前没有这个物体，把它添加进去——不要删除、移动或改动画面中的任何现有物体。
【位置与落地】${productName || '物件'}必须完整落在 ${boxStr} 标记框内，随地面透视自然落位，底部贴合地面/地毯面，带真实自然的接触阴影与漫反射投影，不悬浮、不倾斜。${gapClause}${avoidClause}
【保持不变】除新增的${productName || '物件'}及其阴影外，图1其余所有物体、家具、墙面、地面、光影完全保持原样不变。只输出这一张修改后的高清实景照片。`;
    } else {
      finalPrompt = `图1是待编辑的室内场景实拍照片。
【任务】在图1 ${boxStr} 标记的区域内新增一件纯正优雅的【${productName || '现代软装家具'}】：该处目前没有这个物体，把它添加进去——不要删除、移动或改动画面中的任何现有物体。
【位置与落地】新增物件必须完整落在 ${boxStr} 标记框内，随地面透视自然落位，底部贴合地面/地毯面，带真实自然的接触阴影与漫反射投影，不悬浮、不倾斜。${gapClause}${avoidClause}
【保持不变】除新增的物件及其阴影外，图1其余所有物体、家具、墙面、地面、光影完全保持原样不变。只输出这一张修改后的高清实景照片。`;
    }
  }

  const images = refImageBuffer ? [sceneImageBuffer, refImageBuffer] : [sceneImageBuffer];
  const generated = await runAdapter(services, images, finalPrompt, model, {
    maskPath,
    size: outSpec && outSpec.sizeField,
    ratio: outSpec && outSpec.ratioField,
  });
  const finalBuf = pasteback
    ? await pastebackToTarget(sceneImageBuffer, generated, {
        selection,
        outW: outSpec ? outSpec.outW : sw,
        outH: outSpec ? outSpec.outH : sh,
      })
    : generated;

  return {
    buffer: finalBuf,
    apiBox: box,
    bounds: { minX, minY, maxX, maxY },
    prompt: finalPrompt,
  };
}

/** 留白：单图推开两侧，不贴回 */
async function handleSpace(services, { sceneImageBuffer, selection, prompt, sideDesc, model, clauseText, maskPath, outSpec = null }) {
  const meta = await sharp(sceneImageBuffer).metadata();
  const sw = meta.width;
  const sh = meta.height;
  const { minX, minY, maxX, maxY } = selectionBounds(selection, sw, sh);
  const box = apiBoxFromBounds(minX, minY, maxX, maxY, sw, sh);
  const boxStr = clauseText || `<bbox>${box.x1} ${box.y1} ${box.x2} ${box.y2}</bbox>`;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const horizontal = bh >= bw;
  const sideA = horizontal ? '左侧' : '上方';
  const sideB = horizontal ? '右侧' : '下方';
  const dirTxt = horizontal ? '沿水平方向向外平移' : '沿垂直方向向外平移';
  let compiledSpacePrompt = '';
  if (!prompt && services && services.db) {
    try {
      const { compileNodePrompt } = require('../prompt-compiler');
      const compiled = compileNodePrompt(services.db, {
        mountPointId: 'precision_edit',
        nodeType: 'edit_space',
        promptId: 'precision_space',
        modelId: model || 'seedream5pro',
        vars: {
          regionClause: boxStr,
          side_a: sideA,
          side_b: sideB,
          side_desc: sideDesc ? `（${sideDesc}）` : '',
        },
      });
      if (compiled && compiled.prompt) compiledSpacePrompt = compiled.prompt;
    } catch (_) {}
  }
  const finalPrompt =
    prompt ||
    compiledSpacePrompt ||
    `【任务】${boxStr} 是${sideA}物体与${sideB}物体之间的狭窄通道${sideDesc ? `（${sideDesc}）` : ''}：把两侧物体向两边挪开，使框内变成空旷地面。【位移约束】只整体平移不旋转不变形；【地面补全】纹理自然延续；其余像素保持不变。`;
  const generated = await runAdapter(services, [sceneImageBuffer], finalPrompt, model, {
    maskPath,
    size: outSpec && outSpec.sizeField,
    ratio: outSpec && outSpec.ratioField,
  });
  // 物体被推到框外，禁止贴回
  return {
    buffer: generated,
    apiBox: box,
    bounds: { minX, minY, maxX, maxY },
    prompt: finalPrompt,
    skipPasteback: true,
  };
}

/**
 * 主入口
 * @param {object} services
 * @param {object} opts
 */
async function handleEditRun(services, opts) {
  let op = String(opts.op || 'replace').toLowerCase();
  op = OP_ALIAS[op] || op;
  if (!OPS.has(op)) throw new Error('不支持的操作: ' + op);
  const sceneImageBuffer = opts.sceneImageBuffer;
  if (!sceneImageBuffer) throw new Error('缺少场景图');
  const meta = await sharp(sceneImageBuffer).metadata();
  const sw = meta.width;
  const sh = meta.height;

  // 出图参数（清晰度 / 画幅）：档位与换算表都取自模型契约，解析结果原样回给客户端，
  // 让「界面上选的值」和「真正发出去的 size」是同一个数。
  const outSpecBase = resolveEditSize({
    db: services && services.db,
    model: opts.model,
    size: opts.size,
    ratio: opts.ratio,
    baseW: sw,
    baseH: sh,
  });
  let outSpec = outSpecBase;
  let sizeNote = '';
  // 画幅一旦偏离原图，框外逐像素保留就不可能了：自动不贴回，并如实写进 regionNote。
  // 「增」是例外——它的贴回不可关闭（见 quick-insert 规范第 6 条），若按所选画幅出图，
  // 贴回前得先把场景 cover 裁一刀，框外像素照样保不住。所以安装只认清晰度、画幅强制
  // 跟随原图，并把「你选的画幅没生效」直说，而不是悄悄地按原图办。
  if (op === 'insert') {
    if (!outSpecBase.followsSource) {
      outSpec = resolveEditSize({
        db: services && services.db,
        model: opts.model,
        size: opts.size,
        ratio: null,
        baseW: sw,
        baseH: sh,
      });
      sizeNote = `安装必须贴回原图，画幅固定跟随原图（你选的 ${outSpecBase.ratio} 未生效，实际按 ${outSpec.ratio} 出图）；清晰度 ${outSpec.tier} 照常生效`;
    }
  } else {
    sizeNote = outSpecBase.followsSource
      ? ''
      : `画幅 ${outSpec.ratio} 与原图不符，已改为整幅重绘，框外像素不再逐像素保留`;
  }
  const pastebackAllowed = op === 'insert' ? true : outSpecBase.followsSource;

  // expand：默认走即梦/veImageX（画幅外扩专用通道）；用户显式指定了官方生图模型时改走该模型
  if (op === 'expand') {
    const { expandWithJimeng, jimengReady } = require('./jimeng-expand');
    const { handleExpand } = require('./quick-expand');
    const ratios = opts.expandRatios || { top: 0.2, bottom: 0.2, left: 0.2, right: 0.2 };
    // 判定「用户是否显式选了一个目录里的生图模型」：只有真模型才走适配器，
    // umbra.* / unified_gateway / local-4x 这类通道 id 仍走原来的即梦/ImageX。
    let pickedImageModel = '';
    try {
      const { OFFICIAL_STUDIO } = require('../studio-catalog');
      const hit = (OFFICIAL_STUDIO.image.models || []).find((m) => m.id === opts.model);
      if (hit) pickedImageModel = hit.id;
    } catch (_) {}

    if (pickedImageModel && opts.useAdapterExpand !== false) {
      const extra = stripCoordSyntax(opts.prompt || '');
      const expandPrompt = `【画幅外扩】以图1为基准向四周延展画幅，补全被裁掉的墙面、地面、天花与相邻空间，透视与光影必须与原图无缝延续。${extra ? '补充要求：' + extra : ''}`;
      // 扩图的画幅由「目标画幅」决定，不能拿原图比例去换算，否则外扩方向会被方图吃掉
      const expandSpec = resolveEditSize({
        db: services && services.db,
        model: pickedImageModel,
        size: opts.size,
        ratio: opts.expandRatio || opts.ratio,
        baseW: sw,
        baseH: sh,
      });
      const generated = await runAdapter(services, [sceneImageBuffer], expandPrompt, pickedImageModel, {
        size: expandSpec.sizeField,
        ratio: expandSpec.ratioField,
      });
      const m2 = await sharp(generated).metadata();
      await persistEditDerivative(services, opts.assetFid, 'ai_expand', generated, {
        op: 'expand',
        model: pickedImageModel,
        size: expandSpec.sizeField || null,
        ratio: expandSpec.ratioField || null,
      });
      const expandOut = publicOutSize(expandSpec, false);
      expandOut.outW = m2.width;
      expandOut.outH = m2.height;
      return {
        buffer: generated,
        apiBox: { x1: 0, y1: 0, x2: 999, y2: 999 },
        untouchedDiff: { unchangedRatio: null, method: `adapter:${pickedImageModel}` },
        meta: { width: m2.width, height: m2.height },
        outSize: expandOut,
      };
    }

    let buffer;
    let method = 'jimeng';
    if (jimengReady(services) && opts.useJimeng !== false) {
      const out = await expandWithJimeng(services, {
        imageB64: sceneImageBuffer.toString('base64'),
        top: ratios.top,
        bottom: ratios.bottom,
        left: ratios.left,
        right: ratios.right,
        prompt: stripCoordSyntax(opts.prompt),
      });
      buffer = Buffer.from(out.b64, 'base64');
    } else {
      method = 'imagex';
      const ratioKey = opts.expandRatio || '3:4';
      buffer = await handleExpand(services, {
        imageBuffer: sceneImageBuffer,
        expandRatio: ratioKey,
        prompt: stripCoordSyntax(opts.prompt),
      });
    }
    const m2 = await sharp(buffer).metadata();
    await persistEditDerivative(services, opts.assetFid, 'ai_expand', buffer, {
      op: 'expand',
      method,
    });
    return {
      buffer,
      apiBox: { x1: 0, y1: 0, x2: 999, y2: 999 },
      untouchedDiff: { unchangedRatio: 1, method },
      meta: { width: m2.width, height: m2.height },
    };
  }

  // style_transfer：全空间全局重塑，在提示词中表达结构不变，全屋材质软装系统级重塑
  if (op === 'style_transfer') {
    const targetStyle = opts.targetStyle || opts.productName || '意式';
    const sourceStyle = opts.sourceStyle || '';
    const stylePrompt = stripCoordSyntax(opts.stylePrompt || '');
    const extraPrompt = stripCoordSyntax(opts.extraPrompt || opts.prompt || '');
    const fromDesc = sourceStyle ? `（原风格：${sourceStyle}）` : '';
    const promptExtra = buildStyleExtraPrompt(stylePrompt, extraPrompt);
    
    let finalPrompt = '';
    if (services && services.db) {
      try {
        const { compileNodePrompt } = require('../prompt-compiler');
        const compiled = compileNodePrompt(services.db, {
          mountPointId: 'precision_edit',
          nodeType: 'edit_style_transfer',
          promptId: 'precision_style_transfer',
          modelId: opts.model || 'seedream5pro',
          vars: {
            source_style: fromDesc,
            target_style: targetStyle,
            extra_prompt: promptExtra ? `${promptExtra}\n` : '',
          },
        });
        if (compiled && compiled.prompt) finalPrompt = compiled.prompt;
      } catch (_) {}
    }
    if (!finalPrompt) {
      finalPrompt = `【专业室内设计 · 全空间风格重塑】
将图1室内空间${fromDesc}全方位重塑为纯正典雅的【${targetStyle}】风格。
【空间刚性几何约束】严格保持原图房间的挑高层高、户型进深、空间透视灭点、承重梁柱位置以及主要门窗采光开洞朝向不变。
【材质与软装系统级更替】
1. 墙面与天花：将现有饰面全面替换为符合${targetStyle}风格的标准材质、护墙板或艺术漆，调整吊顶与现代灯光照明系统；
2. 地面铺装：将原地面替换为匹配${targetStyle}的通铺大理石、微水泥或高级地板；
3. 软装与家具：将沙发、茶几、单椅、地毯、窗帘、灯具与软装摆件彻底重塑为地道的${targetStyle}设计经典款；
${promptExtra ? `${promptExtra}\n` : ''}
【出图标准】整体光影渲染真实自然，材质质感极度细腻逼真，空间透视严丝合缝，无任何多余畸变杂物，商业室内设计大师级实景大片摄影。`;
    }

    // ★ 用户在客户端选的模型必须透传给适配器，否则「前端能选、服务端忽略」=选了个摆设
    const generated = await runAdapter(services, [sceneImageBuffer], finalPrompt, opts.model, {
      size: outSpec.sizeField,
      ratio: outSpec.ratioField,
    });

    if (opts.assetFid && services && services.db) {
      try {
        const { createDerivative } = require('../derivatives');
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const tmpFile = path.join(os.tmpdir(), `style_${opts.assetFid}_${Date.now()}.jpg`);
        fs.writeFileSync(tmpFile, generated);
        await createDerivative(services, {
          assetFid: opts.assetFid,
          kind: 'style_transferred',
          srcPath: tmpFile,
          fileName: `style_${targetStyle}_${Date.now()}.jpg`,
          width: sw,
          height: sh,
          mime: 'image/jpeg',
          params: {
            targetStyle,
            sourceStyle: sourceStyle || null,
            strengthLevel: opts.strengthLevel || 'standard',
            stylePrompt: stylePrompt || null,
            extraPrompt: extraPrompt || null,
          }
        });
        try { fs.unlinkSync(tmpFile); } catch (e) {}
      } catch (e) {
        console.warn('[edit-run] style_transfer save derivative failed:', e.message);
      }
    }

    return {
      buffer: generated,
      apiBox: { x1: 0, y1: 0, x2: 999, y2: 999 },
      untouchedDiff: { unchangedRatio: null, note: '全局风格转换不贴回' },
      prompt: finalPrompt,
      outSize: publicOutSize(outSpec, false),
    };
  }

  // clarity：超分高清增强。正文只来自超分模板和节点勾选的积木。
  if (op === 'clarity') {
    let finalPrompt = '';
    if (services && services.db) {
      try {
        const { compileNodePrompt } = require('../prompt-compiler');
        const compiled = compileNodePrompt(services.db, {
          mountPointId: 'precision_edit',
          nodeType: 'edit_upscale',
          promptId: 'upscale_enhance',
          modelId: opts.model || 'seedream5pro',
        });
        if (compiled && compiled.prompt) finalPrompt = compiled.prompt;
      } catch (_) {}
    }
    if (!finalPrompt) {
      const { OFFICIAL_PROMPT_TEMPLATES } = require('../nodes/operator-catalog');
      finalPrompt = OFFICIAL_PROMPT_TEMPLATES.upscale_enhance.template;
    }

    const generated = await runAdapter(services, [sceneImageBuffer], finalPrompt, opts.model, {
      size: outSpec.sizeField,
      ratio: outSpec.ratioField,
    });
    let finalBuffer = generated;
    // targetClarity: 2K / 4K / 8K —— 按目标长边做 Lanczos 重采样，真正落实档位
    const clarMap = { '2K': 2048, '4K': 3840, '8K': 7680 };
    const targetLong = clarMap[String(opts.targetClarity || '').toUpperCase()] || 0;
    if (targetLong) {
      try {
        const gm = await sharp(finalBuffer).metadata();
        const long = Math.max(gm.width || 0, gm.height || 0);
        if (long && long < targetLong) {
          const resizeOpt = gm.width >= gm.height ? { width: targetLong } : { height: targetLong };
          finalBuffer = await sharp(finalBuffer)
            .resize({ ...resizeOpt, fit: 'inside', withoutEnlargement: false, kernel: 'lanczos3' })
            .jpeg({ quality: 92 })
            .toBuffer();
        }
      } catch (e) {
        console.warn('[edit-run] clarity resize failed:', e.message);
      }
    }
    await persistEditDerivative(services, opts.assetFid, 'ai_clarity', finalBuffer, {
      targetClarity: opts.targetClarity || null,
      model: opts.model || null,
    });
    // 超分的最终尺寸由 targetClarity 决定，回显以真实出图为准，而不是模型那一档
    const clarSize = publicOutSize(outSpec, false);
    const fm = await sharp(finalBuffer).metadata().catch(() => null);
    if (fm && fm.width && fm.height) {
      clarSize.outW = fm.width;
      clarSize.outH = fm.height;
      clarSize.tier = String(opts.targetClarity || clarSize.tier || '').toUpperCase() || clarSize.tier;
    }
    return {
      buffer: finalBuffer,
      apiBox: { x1: 0, y1: 0, x2: 999, y2: 999 },
      untouchedDiff: { unchangedRatio: 1, note: '超分增强全图保真' },
      prompt: finalPrompt,
      outSize: clarSize,
    };
  }

  let selection = normalizeSelection(opts.region, sw, sh);
  if (!selection) {
    // 全局去水印：未给选区时按整图处理，交由提示词完成全图水印清除
    if (op === 'remove' && opts.removeWatermark) {
      selection = { left: 0, top: 0, right: sw, bottom: sh, unit: 'px' };
    } else {
      throw new Error('未指定有效选区');
    }
  }

  // ★ 出口路由：一次性决定「这个模型到底能吃什么选区」，并把结果转成提示词子句。
  //   coords_bbox → `图1 <bbox>…</bbox>`；coords_point → `<point>`；
  //   mask → 产出蒙版图（作为额外参考图）；vlm_text → 「九宫格方位 + 名称」。
  const route = routeFor(opts.model);

  // vlm_text 出口才需要先认出「这里是什么东西」；其余出口用坐标/蒙版足够。
  // 调用方已给 vlmInfo 就跳过（省一次多模态调用）。
  let vlmInfo = opts.vlmInfo || null;
  if (!vlmInfo && needsVlm(route.kind) && opts.describeRegion !== false) {
    try {
      vlmInfo = await describeRegion(services, {
        sceneImageBuffer,
        selection,
        natW: sw,
        natH: sh,
        fallbackName: opts.productName || opts.objName,
        model: opts.vlmModel,
        logger: services && services.logger,
      });
    } catch (e) {
      vlmInfo = null;
    }
  }

  const clause = await regionClause({
    modelId: opts.model,
    selection,
    natW: sw,
    natH: sh,
    objName: opts.productName || opts.objName,
    vlmInfo,
    services,
    maskId: opts.maskId,
  });
  const regionNote = regionNoteOf(route, clause);

  // ★ 提示词消毒：客户端本地 promptBuilder 生成的提示词里可能带着该模型
  //   并不支持的坐标句法（或缺少坐标）。这一步统一对齐，是防幻觉的最后闸门。
  const rec = reconcilePrompt(opts.prompt, clause);
  const safePrompt = rec.prompt || opts.prompt;
  const combinedNote = [regionNote, rec.sanitized ? `提示词处理：${rec.note}` : '', sizeNote].filter(Boolean).join('；');

  let result;
  const wantPasteback = pastebackAllowed && opts.pasteback !== false;

  if (op === 'insert') {
    const productBuffer = opts.productImageBuffer;
    if (!productBuffer) throw new Error('安装需要二维产品图');
    const { handleInsert } = require('./quick-insert');
    const buffer = await handleInsert(services, {
      sceneImageBuffer,
      productImageBuffer: productBuffer,
      quadOrBbox: selection,
      mode: opts.installMode || 'B',
      productName: opts.productName || '该单品',
      regionClauseText: clause.areaPhrase,
      maskPath: clause.mask ? clause.mask.destPath : null,
      model: opts.model,
      outSpec,
    });
    const bounds = selectionBounds(selection, sw, sh);
    result = {
      buffer,
      apiBox: apiBoxFromBounds(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, sw, sh),
      bounds,
      prompt: opts.prompt || 'install composite',
    };
  } else if (op === 'replace') {
    const refBuffer = opts.refImageBuffer;
    if (!refBuffer) throw new Error('替换需要 GLB 固定机位参考图或产品图');
    const { handleReplace } = require('./quick-replace');
    const buffer = await handleReplace(services, {
      sceneImageBuffer,
      fixedCameraRefBuffer: refBuffer,
      glbFid: opts.glbFid || 'custom',
      yaw: opts.yaw != null ? opts.yaw : 45,
      productName: opts.productName || '该单品',
      quadOrBbox: selection,
      pasteback: wantPasteback,
      model: opts.model,
      regionClauseText: clause.areaPhrase,
      maskPath: clause.mask ? clause.mask.destPath : null,
      outSpec,
    });
    const bounds = selectionBounds(selection, sw, sh);
    result = {
      buffer,
      apiBox: apiBoxFromBounds(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, sw, sh),
      bounds,
      prompt: opts.prompt || 'replace',
    };
  } else if (op === 'remove') {
    const { handleWatermarkOrRemove } = require('./quick-watermark-remove');
    const buffer = await handleWatermarkOrRemove(services, {
      imageBuffer: sceneImageBuffer,
      actionType: 'remove',
      quadOrBbox: selection,
      pasteback: wantPasteback,
      model: opts.model,
      regionClauseText: clause.areaPhrase,
      maskPath: clause.mask ? clause.mask.destPath : null,
      outSpec,
    });
    const bounds = selectionBounds(selection, sw, sh);
    result = {
      buffer,
      apiBox: apiBoxFromBounds(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, sw, sh),
      bounds,
      prompt: opts.prompt || 'remove',
    };
  } else if (op === 'add') {
    result = await handleAdd(services, {
      sceneImageBuffer,
      refImageBuffer: opts.refImageBuffer,
      selection,
      prompt: safePrompt,
      productName: opts.productName,
      model: opts.model,
      clauseText: clause.text,
      maskPath: clause.mask ? clause.mask.destPath : null,
      avoidBBox: opts.avoidBBox,
      gapPct: opts.gapPct,
      outSpec,
      pasteback: wantPasteback,
    });
  } else if (op === 'space') {
    result = await handleSpace(services, {
      sceneImageBuffer,
      selection,
      prompt: safePrompt,
      sideDesc: opts.productName,
      model: opts.model,
      clauseText: clause.text,
      maskPath: clause.mask ? clause.mask.destPath : null,
      outSpec,
    });
  }

  const diff = result.skipPasteback
    ? { unchangedRatio: null, note: 'space 不贴回' }
    : await untouchedDiff(sceneImageBuffer, result.buffer, selection);

  await persistEditDerivative(services, opts.assetFid, 'ai_' + op, result.buffer, {
    op,
    model: opts.model || null,
    prompt: result.prompt || null,
    size: outSpec.sizeField || null,
    ratio: outSpec.ratioField || null,
    installMode: op === 'insert' ? (opts.installMode || null) : undefined,
  });

  return {
    buffer: result.buffer,
    apiBox: result.apiBox,
    untouchedDiff: diff,
    prompt: result.prompt,
    // ★ 真正发出去的出图参数与预期尺寸，客户端原样展示，不再让用户猜
    outSize: publicOutSize(outSpec, pastebackAllowed && !result.skipPasteback),
    // ★ 选区走向与降级告知（客户端直接展示 regionNote，非空即为已降级）
    region: {
      exit: clause.exit,
      selectionType: clause.selectionType,
      fidelity: clause.fidelity,
      degraded: clause.degraded,
      text: clause.text,
      maskUrl: clause.mask ? clause.mask.url : null,
      maskId: clause.mask ? clause.mask.maskId : null,
      vlmInfo: vlmInfo || null,
    },
    regionNote: combinedNote,
  };
}

module.exports = {
  handleEditRun,
  handleAdd,
  handleSpace,
  untouchedDiff,
  normalizeSelection,
  apiBoxFromBounds,
  buildStyleExtraPrompt,
};
