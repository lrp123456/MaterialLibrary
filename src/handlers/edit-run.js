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
  pastebackComposite,
  selectionBounds,
  cropNeighborhood,
  floodFillCutout,
  affineCompositeToScene,
} = require('./image-ops');
const { findImageAdapter, readAdapterOutput } = require('./adapter-io');
const { regionClause, regionNoteOf, routeFor, reconcilePrompt, stripCoordSyntax } = require('./region-route');
const { describeRegion, needsVlm } = require('./region-vlm');

const OPS = new Set(['replace', 'insert', 'add', 'space', 'remove', 'expand', 'style_transfer', 'clarity']);

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
  });
  const out = readAdapterOutput(res);
  if (!out) throw new Error('图像适配器未返回结果');
  return out;
}

/** 增加：参考图 + 空地框，不贴回（物体可占框） */
async function handleAdd(services, { sceneImageBuffer, refImageBuffer, selection, prompt, productName, model, clauseText, maskPath }) {
  const meta = await sharp(sceneImageBuffer).metadata();
  const sw = meta.width;
  const sh = meta.height;
  const { minX, minY, maxX, maxY } = selectionBounds(selection, sw, sh);
  const box = apiBoxFromBounds(minX, minY, maxX, maxY, sw, sh);
  // 选区子句由 region-route 按模型能力生成；缺省才退回本地 bbox 文案
  const boxStr = clauseText || `<bbox>${box.x1} ${box.y1} ${box.x2} ${box.y2}</bbox>`;
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
  const finalPrompt =
    prompt ||
    compiledAddPrompt ||
    `图1是室内场景，图2是${productName || '物件'}参考图。【任务】将图2主体新增到 ${boxStr} 空地区域，不要删除或改动任何现有物体；底部贴地、接触阴影自然、完整落在框内；框外像素保持不变。只输出编辑后的照片。`;
  const images = refImageBuffer ? [sceneImageBuffer, refImageBuffer] : [sceneImageBuffer];
  const generated = await runAdapter(services, images, finalPrompt, model, { maskPath });
  // add 不强制贴回（新物体会占满框），但框外仍贴回保护
  return {
    buffer: await pastebackComposite(sceneImageBuffer, generated, { left: 0, top: 0, width: sw, height: sh }, selection),
    apiBox: box,
    bounds: { minX, minY, maxX, maxY },
    prompt: finalPrompt,
  };
}

/** 留白：单图推开两侧，不贴回 */
async function handleSpace(services, { sceneImageBuffer, selection, prompt, sideDesc, model, clauseText, maskPath }) {
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
  const generated = await runAdapter(services, [sceneImageBuffer], finalPrompt, model, { maskPath });
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
  const op = String(opts.op || 'replace').toLowerCase();
  if (!OPS.has(op)) throw new Error('不支持的操作: ' + op);
  const sceneImageBuffer = opts.sceneImageBuffer;
  if (!sceneImageBuffer) throw new Error('缺少场景图');
  const meta = await sharp(sceneImageBuffer).metadata();
  const sw = meta.width;
  const sh = meta.height;

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
      const generated = await runAdapter(services, [sceneImageBuffer], expandPrompt, pickedImageModel);
      const m2 = await sharp(generated).metadata();
      return {
        buffer: generated,
        apiBox: { x1: 0, y1: 0, x2: 999, y2: 999 },
        untouchedDiff: { unchangedRatio: null, method: `adapter:${pickedImageModel}` },
        meta: { width: m2.width, height: m2.height },
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
    const extraPrompt = stripCoordSyntax(opts.extraPrompt || opts.prompt || '');
    const fromDesc = sourceStyle ? `（原风格：${sourceStyle}）` : '';
    
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
            extra_prompt: extraPrompt ? `【用户特别要求】${extraPrompt}。` : '',
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
${extraPrompt ? `【用户特别要求】${extraPrompt}。\n` : ''}
【出图标准】整体光影渲染真实自然，材质质感极度细腻逼真，空间透视严丝合缝，无任何多余畸变杂物，商业室内设计大师级实景大片摄影。`;
    }

    // ★ 用户在客户端选的模型必须透传给适配器，否则「前端能选、服务端忽略」=选了个摆设
    const generated = await runAdapter(services, [sceneImageBuffer], finalPrompt, opts.model);

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

    const generated = await runAdapter(services, [sceneImageBuffer], finalPrompt, opts.model);
    return {
      buffer: generated,
      apiBox: { x1: 0, y1: 0, x2: 999, y2: 999 },
      untouchedDiff: { unchangedRatio: 1, note: '超分增强全图保真' },
      prompt: finalPrompt,
    };
  }

  const selection = normalizeSelection(opts.region, sw, sh);
  if (!selection) throw new Error('未指定有效选区');

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
  const combinedNote = [regionNote, rec.sanitized ? `提示词处理：${rec.note}` : ''].filter(Boolean).join('；');

  let result;

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
      pasteback: opts.pasteback !== false,
      model: opts.model,
      regionClauseText: clause.areaPhrase,
      maskPath: clause.mask ? clause.mask.destPath : null,
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
      pasteback: opts.pasteback !== false,
      model: opts.model,
      regionClauseText: clause.areaPhrase,
      maskPath: clause.mask ? clause.mask.destPath : null,
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
    });
  }

  const diff = result.skipPasteback
    ? { unchangedRatio: null, note: 'space 不贴回' }
    : await untouchedDiff(sceneImageBuffer, result.buffer, selection);

  return {
    buffer: result.buffer,
    apiBox: result.apiBox,
    untouchedDiff: diff,
    prompt: result.prompt,
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
};
