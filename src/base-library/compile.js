/**
 * 基础属性编译器 (Compiler)
 * 将底图价签 (regions + light) 编译成结构化提示词与单选区唯一参考图契约 ({ kind, rel })
 */

const fs = require('fs');
const path = require('path');
const { normalizeHex6 } = require('./pretint');
const { processPrompt } = require('./processes');
const {
  VALID_PARTS,
  PART_POLICIES,
  resolvePartFromSurface,
  isAssetAllowedForPart
} = require('./part-policy');

const SURFACE_LABELS = {
  ceiling: '天花',
  wall: '墙面',
  floor: '地面',
  millwork: '全屋定制',
  furniture: '活动家具',
  upholstery: '软体沙发',
  hard_furniture: '硬家具',
  curtain_bedding: '窗帘床品',
  rug: '地毯',
  lighting: '灯具',
  fixture: '卫浴厨电',
  soft: '软装',
  metal: '金属饰面',
  counter: '台面'
};

const BRAND_LABELS = {
  'nippon-paint': '立邦',
  dulux: '多乐士'
};

const MATERIAL_FAMILY_LABELS = {
  paint: '乳胶漆',
  art_coat: '艺术涂料',
  wood: '木质',
  stone: '石材',
  leather: '真皮',
  fabric: '布艺织物',
  metal: '金属',
  glass: '玻璃'
};

const DIRECTION_LABELS = {
  left: '画面左侧',
  upper_left: '左上',
  top: '正上',
  upper_right: '右上',
  right: '画面右侧'
};

const FINISH_LABELS = {
  matte: '哑光',
  satin: '温润柔抛',
  semi_gloss: '半光漫射',
  high_gloss: '镜面高光'
};

function formatFinishSentence(finish) {
  if (!finish) return '';
  if (finish === 'matte') return '表面呈哑光。';
  const label = FINISH_LABELS[finish] || finish;
  return `表面呈${label}。`;
}

function formatRoughnessSentence(roughness) {
  if (typeof roughness !== 'number') return '';
  if (roughness <= 20) return '微距触感极平滑丝光细腻。';
  if (roughness >= 65) return '呈现凹凸明显的粗粝立体颗粒与微孔纹理。';
  if (roughness >= 45) return '微带自然细腻的原生肌理。';
  return '';
}

function locationPrefix(reg, baseImageTag) {
  if (reg.locationClause) return String(reg.locationClause);
  const b = reg.bbox;
  if (b && [b.x1, b.y1, b.x2, b.y2].every((n) => Number.isFinite(Number(n)))) {
    const nums = [b.x1, b.y1, b.x2, b.y2]
      .map((n) => Math.max(0, Math.min(999, Math.round(Number(n)))))
      .join(' ');
    return `${baseImageTag} <bbox>${nums}</bbox> 内`;
  }
  return `${baseImageTag}的指定区域`;
}

function fillRefTag(text, tag) {
  return String(text || '').split('{{ref}}').join(tag);
}

function dropRefText(text) {
  return String(text || '')
    .replace(/纹理与铺法对齐\{\{ref\}\}[^。]*。/g, '本次没有附上纹理参考图，按文字描述处理。')
    .split('{{ref}}')
    .join('参考图');
}

/**
 * 编译底图价签。
 * 轨道 A 与只换色不发参考图。轨道 B 的图号在截断之后按实际出图递增。
 */
function compileBaseAttributes(db, payload = {}) {
  const regions = payload.regions || [];
  const lightMode = payload.light_mode || null;
  const kelvin = payload.kelvin || null;
  const maxRefs = typeof payload.maxRefs === 'number' ? payload.maxRefs : 4;
  const baseImageTag = payload.baseImageTag || '图1';
  const firstRefIndex = Number.isInteger(payload.firstRefIndex) ? payload.firstRefIndex : 2;

  const clauses = [];
  const warnings = [];

  const hasMillworkDoor = regions.some(
    (r) => r.subclass === 'millwork_door' && (r.asset_id || r.color_name)
  );

  for (const reg of regions) {
    const regId = reg.region_id || ('reg_' + Math.random().toString(36).slice(2, 8));
    const part = reg.part || (VALID_PARTS.includes(reg.surface) ? reg.surface : resolvePartFromSurface(reg.surface)) || 'wall';
    const surface = reg.part || reg.surface || 'wall';
    const surfaceLabel = SURFACE_LABELS[part] || SURFACE_LABELS[surface] || '区域';
    const warehouse = reg.warehouse || (reg.mode === 'rematerial' ? 'material' : 'paint');
    const subclass = reg.subclass || '';
    const loc = locationPrefix(reg, baseImageTag);
    const mode = reg.mode || (warehouse === 'paint' ? 'recolor' : 'rematerial');

    let textLines = [];
    let reference = null;
    let track = 'A';

    if (reg.use_shell) warnings.push(`${regId}:shell_ignored`);

    // 部位资产白名单与黑名单强门禁校验
    let isPaintAsset = false;
    if (warehouse === 'paint' || (reg.asset_id && String(reg.asset_id).startsWith('paint_'))) {
      isPaintAsset = true;
    } else if (db && reg.asset_id) {
      try {
        const p = db.prepare('SELECT 1 FROM ba_paints WHERE id = ?').get(reg.asset_id);
        if (p) isPaintAsset = true;
      } catch (_) {}
    }

    if (part === 'upholstery' && isPaintAsset && reg.asset_id) {
      warnings.push(`${regId}:part_asset_rejected`);
      clauses.push({
        region_id: regId,
        text: `${loc}是${surfaceLabel}，该部位严禁涂刷乳胶漆，保持原样。`,
        reference: null,
        track: 'A'
      });
      continue;
    }

    if (db && reg.asset_id && !isPaintAsset) {
      let tags = [];
      try {
        tags = db.prepare('SELECT surface, subclass FROM ba_asset_tags WHERE asset_kind = "material" AND asset_id = ?').all(reg.asset_id);
      } catch (_) {}
      if (tags.length > 0 && !isAssetAllowedForPart(part, tags)) {
        warnings.push(`${regId}:part_asset_rejected`);
        clauses.push({
          region_id: regId,
          text: `${loc}是${surfaceLabel}，所选材料不符合该部位规范，保持原样。`,
          reference: null,
          track: 'A'
        });
        continue;
      }
    }

    if (reg.item_id) {
      let item = null;
      try {
        item = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(reg.item_id);
      } catch (_) {}
      if (!item) {
        textLines.push(`这块${surfaceLabel}的选定条目已不在库里，保持原样。`);
      } else if (item.kind === 'product' || !item.preview_rel) {
        textLines.push(`将这块${surfaceLabel}更换为${item.prompt_name || item.name_zh}。不要改变结构与透视。`);
      } else if (item.kind === 'color') {
        textLines.push(`${loc}是${surfaceLabel}。将颜色调为${item.name_zh}（${item.hex || ''}）。不要改变结构与透视。不要添加色块贴图。`);
      } else {
        track = 'B';
        reference = { kind: 'basecolor', rel: item.preview_rel, tinted: false, assetId: item.id };
        textLines.push(`${loc}是${surfaceLabel}。纹理与铺法对齐{{ref}}（${item.name_zh}）。不要复制{{ref}}的光照、透视或尺度。`);
      }
      clauses.push({ region_id: regId, text: textLines.join('\n'), reference, track });
      continue;
    }

    // 优先匹配 Master 统一字典资产 (ba_material_swatches)
    let masterSwatch = null;
    const swatchLookupId = reg.swatch_id || reg.asset_id;
    if (db && swatchLookupId) {
      try { masterSwatch = db.prepare('SELECT * FROM ba_material_swatches WHERE id = ? AND enabled = 1').get(swatchLookupId); } catch (_) {}
    }

    if (masterSwatch) {
      let catRow = null;
      let partRow = null;
      try { catRow = db.prepare('SELECT * FROM ba_material_categories WHERE id = ?').get(masterSwatch.category_id); } catch (_) {}
      try { partRow = db.prepare('SELECT * FROM ba_parts WHERE id = ?').get(part); } catch (_) {}

      // 提取专属工艺描述
      let finishPrompt = '';
      if (catRow && catRow.finishes_json) {
        try {
          const finishes = JSON.parse(catRow.finishes_json || '[]');
          const targetFinishId = reg.finish_id || reg.finish || masterSwatch.finish_override || catRow.default_finish_id;
          const matchFinish = finishes.find(f => f.id === targetFinishId) || finishes[0];
          if (matchFinish) finishPrompt = matchFinish.prompt_zh || '';
        } catch (_) {}
      }

      const preserveClause = (partRow && partRow.preserve_clause_zh) || '保持原有结构体积与光影';
      const categoryName = (catRow && catRow.name_zh) || '';
      const colorBrandCode = [masterSwatch.brand, masterSwatch.code].filter(Boolean).join(' ');
      const colorDetail = [masterSwatch.name_zh, colorBrandCode, masterSwatch.hex].filter(Boolean).join('，');

      if (masterSwatch.item_type === 'solid_color') {
        track = 'A';
        reference = null;
        textLines.push(`${loc}是${surfaceLabel}。将表面材质与色彩更换为${colorDetail}（${categoryName}）。`);
        if (finishPrompt) textLines.push(`表面呈现${finishPrompt}。`);
        if (masterSwatch.prompt_hint_zh) textLines.push(`${masterSwatch.prompt_hint_zh}。`);
        textLines.push(`${preserveClause}。不要添加色块贴图，框外像素保持原样。`);
      } else {
        track = 'B';
        const rel = masterSwatch.texture_1k_path || masterSwatch.preview_path || `cache/base-library/materials/${masterSwatch.id}/basecolor.jpg`;
        const tintHex = masterSwatch.tintable ? normalizeHex6(reg.hex || reg.tint) : null;
        reference = {
          kind: 'basecolor',
          rel,
          tinted: Boolean(tintHex),
          hex: tintHex ? `#${tintHex}` : null,
          assetId: masterSwatch.id
        };
        textLines.push(`${loc}是${surfaceLabel}。将这块${surfaceLabel}的材质纹理对齐{{ref}}（${masterSwatch.name_zh}）。`);
        if (finishPrompt) textLines.push(`表面呈现${finishPrompt}。`);
        textLines.push(`${preserveClause}。不要复制{{ref}}的光照、透视或尺度，框外像素保持原样。`);
      }

      clauses.push({ region_id: regId, text: textLines.join('\n'), reference, track });
      continue;
    }

    if (subclass === 'millwork_carcass' && !reg.asset_id) {
      textLines.push(hasMillworkDoor ? '柜体结构与门板使用同一材质。' : '柜体结构采用平整哑光饰面。');
    } else if (warehouse === 'light') {
      textLines.push('这一版不替换这里的灯具。');
    } else if (warehouse === 'model') {
      textLines.push('这一版不替换模型。');
    } else if (mode === 'recolor' || warehouse === 'paint') {
      let paint = null;
      if (reg.asset_id && warehouse === 'paint') {
        try { paint = db.prepare('SELECT * FROM ba_paints WHERE id = ?').get(reg.asset_id); } catch (_) {}
      }
      const colorName = (paint && (paint.display_name || paint.alias_zh || paint.name_zh || paint.name_en))
        || reg.display_name || reg.color_name || reg.material_name || '';
      const hex = (paint && paint.hex) || reg.hex || '';
      const brandLabel = paint ? (BRAND_LABELS[paint.brand] || paint.brand) : '';
      const code = paint ? paint.code : '';
      const rawFamily = reg.material_family || reg.materialFamily || PART_POLICIES[part]?.default_material_family || (['ceiling', 'wall'].includes(part) ? 'paint' : '');
      const family = MATERIAL_FAMILY_LABELS[rawFamily] || rawFamily || (['ceiling', 'wall'].includes(part) ? '乳胶漆' : '原有材料');
      const who = [colorName, brandLabel, code, hex].filter(Boolean).join('，');
      textLines.push(`${loc}是${surfaceLabel}，现有材料是${family}。`);
      textLines.push(who
        ? `只改变这块${surfaceLabel}的颜色，改为${who}。保持原有材质结构与光影。不要添加色块贴图，不要铺水泥或石材纹理。`
        : `将这块${surfaceLabel}的颜色调为标准室内色。不要改变整体结构与透视。不要添加色块贴图。`);
      const proc = (['ceiling', 'wall'].includes(part) || ['paint', 'art_coat'].includes(rawFamily))
        ? processPrompt(reg.process)
        : '';
      if (proc) textLines.push(proc);
      const finishSent = formatFinishSentence(reg.finish || 'matte');
      const roughSent = formatRoughnessSentence(reg.roughness);
      const secondLine = [finishSent, roughSent].filter(Boolean).join('，');
      if (secondLine) textLines.push(secondLine);
      textLines.push('框外所有像素保持原样。');
    } else if (warehouse === 'material') {
      let mat = null;
      if (reg.asset_id) {
        try {
          mat = db.prepare('SELECT * FROM ba_materials WHERE id = ? AND deleted_at IS NULL').get(reg.asset_id);
        } catch (_) {}
      }
      if (mat && mat.basecolor_rel) {
        if (payload.dataDir && !fs.existsSync(path.resolve(payload.dataDir, mat.basecolor_rel))) {
          warnings.push(`${regId}:texture_missing`);
          track = 'A';
          textLines.push(`${loc}是${surfaceLabel}。该材质贴图文件缺失，保持材质平整细腻。`);
        } else {
          track = 'B';
          const tintHex = normalizeHex6(reg.hex || reg.tint);
          reference = {
            kind: 'basecolor',
            rel: mat.basecolor_rel,
            tinted: Boolean(tintHex),
            hex: tintHex ? `#${tintHex}` : null,
            assetId: mat.id
          };
          if (tintHex) {
            const tintName = reg.display_name || reg.color_name || `#${tintHex}`;
            textLines.push(`${loc}是${surfaceLabel}。把这块${surfaceLabel}换成${mat.name_cn}。纹理与铺法对齐{{ref}}。{{ref}}已经是${tintName}（#${tintHex}），不要再改色。不要复制{{ref}}的光照、透视或比例。`);
          } else if ((subclass === 'chair_fabric' || subclass === 'soft_fabric') && reg.tint) {
            textLines.push(`${loc}是${surfaceLabel}。将这块织物的纹理对齐{{ref}}（${mat.name_cn}），颜色以{{ref}}为准。不要复制{{ref}}的光照、透视或尺度。`);
          } else {
            textLines.push(`${loc}是${surfaceLabel}。将这块${surfaceLabel}的纹理与颜色对齐{{ref}}（${mat.name_cn}）。不要复制{{ref}}的光照、透视或尺度。`);
          }
        }
      } else if (reg.asset_id) {
        warnings.push(`${regId}:texture_missing`);
        textLines.push(`这块${surfaceLabel}的原选定素材已下架或缺失，保持材质平整细腻。`);
      } else {
        const matName = reg.material_name || '自然高质感材质';
        textLines.push(`${loc}是${surfaceLabel}。将这块${surfaceLabel}的材质换为${matName}。不要改变空间采光与透视。`);
      }
      const finishSent = formatFinishSentence(reg.finish || 'satin');
      const roughSent = formatRoughnessSentence(reg.roughness);
      const secondLine = [finishSent, roughSent].filter(Boolean).join('，');
      if (secondLine) textLines.push(secondLine);
      textLines.push('框外保持原样。');
    }

    clauses.push({ region_id: regId, text: textLines.join('\n'), reference, track });
  }

  const refDropped = [];
  const wanted = [];
  clauses.forEach((clause, index) => {
    if (clause.reference) wanted.push(index);
  });
  wanted.forEach((index, order) => {
    if (order >= maxRefs) {
      clauses[index].reference = null;
      clauses[index].text = dropRefText(clauses[index].text);
      refDropped.push(clauses[index].region_id);
    }
  });

  const finalReferences = [];
  let cursor = firstRefIndex;
  for (const clause of clauses) {
    if (!clause.reference) {
      if (clause.text.includes('{{ref}}')) clause.text = dropRefText(clause.text);
      continue;
    }
    const tag = `图${cursor++}`;
    clause.reference.refImageTag = tag;
    clause.text = fillRefTag(clause.text, tag);
    finalReferences.push({
      region_id: clause.region_id,
      kind: clause.reference.kind,
      rel: clause.reference.rel,
      tinted: Boolean(clause.reference.tinted),
      hex: clause.reference.hex || null,
      assetId: clause.reference.assetId || null,
      refImageTag: tag
    });
  }

  // 全局光线子句
  let lightClause = '';
  if (lightMode === 'keep') {
    lightClause = '保持原图的主光方向和阴影形状。';
  } else if (lightMode && DIRECTION_LABELS[lightMode]) {
    const dirLabel = DIRECTION_LABELS[lightMode];
    lightClause = `主光来自${dirLabel}，阴影落向相反的一侧。这是这张照片的屏幕方向，不是罗盘方位。`;
    if (kelvin) {
      lightClause += `色温约 ${kelvin}K。`;
    }
  }

  const allPromptLines = clauses.map((c) => c.text).filter(Boolean);
  if (lightClause) {
    allPromptLines.push(lightClause);
  }
  const prompt = allPromptLines.join('\n');

  return {
    success: true,
    prompt,
    light_clause: lightClause,
    clauses,
    references: finalReferences,
    ref_dropped: refDropped,
    warnings
  };
}

module.exports = {
  compileBaseAttributes,
  SURFACE_LABELS,
  BRAND_LABELS,
  DIRECTION_LABELS,
  FINISH_LABELS
};
