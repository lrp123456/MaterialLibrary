/**
 * 基础属性编译器 (Compiler)
 * 将底图价签 (regions + light) 编译成结构化提示词与单选区唯一参考图契约 ({ kind, rel })
 */

const { getFlag } = require('./list');

const SURFACE_LABELS = {
  ceiling: '天花',
  wall: '墙面',
  floor: '地面',
  millwork: '全屋定制',
  furniture: '活动家具',
  lighting: '灯具',
  fixture: '卫浴厨电',
  soft: '软装'
};

const BRAND_LABELS = {
  'nippon-paint': '立邦',
  dulux: '多乐士'
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

/**
 * 编译底图价签
 * @param {object} db SQLite 数据库
 * @param {object} payload { regions, light_mode, kelvin, maxRefs = 4 }
 */
function compileBaseAttributes(db, payload = {}) {
  const regions = payload.regions || [];
  const lightMode = payload.light_mode || null;
  const kelvin = payload.kelvin || null;
  const maxRefs = typeof payload.maxRefs === 'number' ? payload.maxRefs : 4;

  const flagMaterials = getFlag(db, 'base_library');
  const flagPaints = getFlag(db, 'base_library_paints');

  const clauses = [];
  const rawReferences = [];
  const refDropped = [];

  // 判断同批次中是否有柜门绑定
  const hasMillworkDoor = regions.some(
    (r) => r.subclass === 'millwork_door' && (r.asset_id || r.color_name)
  );

  for (const reg of regions) {
    const regId = reg.region_id || ('reg_' + Math.random().toString(36).slice(2, 8));
    const surface = reg.surface || 'wall';
    const surfaceLabel = SURFACE_LABELS[surface] || '区域';
    const warehouse = reg.warehouse || 'paint';
    const subclass = reg.subclass || '';

    let textLines = [];
    let reference = null;

    if (subclass === 'millwork_carcass' && !reg.asset_id) {
      // 柜体结构板跟随门板
      if (hasMillworkDoor) {
        textLines.push('柜体结构与门板使用同一材质。');
      } else {
        textLines.push('柜体结构采用平整哑光饰面。');
      }
    } else if (warehouse === 'light') {
      textLines.push('这一版不替换这里的灯具。');
    } else if (warehouse === 'model') {
      textLines.push('这一版不替换模型。');
    } else if (warehouse === 'paint') {
      let paint = null;
      if (reg.asset_id) {
        paint = db.prepare('SELECT * FROM ba_paints WHERE id = ?').get(reg.asset_id);
      }

      if (paint) {
        const brandLabel = BRAND_LABELS[paint.brand] || paint.brand;
        const paintName = paint.alias_zh || paint.name_zh || paint.name_en || paint.code;

        // 仅在 flag.base_library_paints 开启时提供参考图
        if (flagPaints) {
          if (reg.use_shell && paint.shell_material_id) {
            const shellMat = db
              .prepare('SELECT * FROM ba_materials WHERE id = ? AND deleted_at IS NULL')
              .get(paint.shell_material_id);
            if (shellMat) {
              reference = {
                kind: 'basecolor',
                rel: shellMat.basecolor_rel
              };
              textLines.push(
                `将这块${surfaceLabel}的质感对齐参考图，并把颜色调为色号：${paintName}（${brandLabel}，${paint.code}，${paint.hex}）。不要复制参考图的光照、透视或尺度。`
              );
            }
          }

          if (!reference) {
            reference = {
              kind: 'swatch',
              rel: paint.swatch_rel || `cache/base-library/paints/${paint.id}/swatch.png`
            };
            textLines.push(
              `将这块${surfaceLabel}的颜色对齐参考图的色号：${paintName}（${brandLabel}，${paint.code}，${paint.hex}）。不要复制参考图的光照、透视或尺度。`
            );
          }
        } else {
          // 色号标志关闭，仅输出文字
          textLines.push(
            `将这块${surfaceLabel}的颜色调为色号：${paintName}（${brandLabel}，${paint.code}，${paint.hex}）。`
          );
        }
      } else {
        // 无色号数据，文字兜底
        const colorDesc = reg.color_name || reg.hex || '标准室内色';
        textLines.push(`将这块${surfaceLabel}的颜色调为${colorDesc}。不要改变整体结构与透视。`);
      }

      const finishSent = formatFinishSentence(reg.finish || 'matte');
      const roughSent = formatRoughnessSentence(reg.roughness);
      const secondLine = [finishSent, roughSent].filter(Boolean).join('，');
      if (secondLine) textLines.push(secondLine);
    } else if (warehouse === 'material') {
      let mat = null;
      if (reg.asset_id) {
        mat = db
          .prepare('SELECT * FROM ba_materials WHERE id = ? AND deleted_at IS NULL')
          .get(reg.asset_id);
      }

      if (mat) {
        if (flagMaterials) {
          reference = {
            kind: 'basecolor',
            rel: mat.basecolor_rel
          };
          const isFabric = subclass === 'chair_fabric' || subclass === 'soft_fabric';
          if (isFabric && reg.tint) {
            textLines.push(
              `将这块织物的纹理对齐参考图，并把颜色染成${reg.tint}。不要复制参考图的光照、透视或尺度。`
            );
          } else {
            textLines.push(
              `将这块${surfaceLabel}的纹理与颜色对齐参考图（${mat.name_cn}）。不要复制参考图的光照、透视或尺度。`
            );
          }
        } else {
          // 材质库标志关闭
          textLines.push(`将这块${surfaceLabel}的饰面质感优化为平整高质感天然纹理。`);
        }
      } else {
        if (reg.asset_id) {
          textLines.push(`这块${surfaceLabel}的原选定素材已下架，保持材质平整细腻。`);
        } else {
          const matName = reg.material_name || '自然高质感材质';
          textLines.push(`将这块${surfaceLabel}的材质换为${matName}。不要改变空间采光与透视。`);
        }
      }

      const finishSent = formatFinishSentence(reg.finish || 'satin');
      const roughSent = formatRoughnessSentence(reg.roughness);
      const secondLine = [finishSent, roughSent].filter(Boolean).join('，');
      if (secondLine) textLines.push(secondLine);
    }

    clauses.push({
      region_id: regId,
      text: textLines.join('\n'),
      reference
    });

    if (reference) {
      rawReferences.push({
        region_id: regId,
        clauseIndex: clauses.length - 1,
        kind: reference.kind,
        rel: reference.rel
      });
    }
  }

  // 截断参考图超出上限部分
  const finalReferences = [];
  for (let i = 0; i < rawReferences.length; i++) {
    const item = rawReferences[i];
    if (i < maxRefs) {
      finalReferences.push({
        region_id: item.region_id,
        kind: item.kind,
        rel: item.rel
      });
    } else {
      // 超额参考图丢弃，保留文字
      clauses[item.clauseIndex].reference = null;
      refDropped.push(item.region_id);
    }
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
    ref_dropped: refDropped
  };
}

module.exports = {
  compileBaseAttributes,
  SURFACE_LABELS,
  BRAND_LABELS,
  DIRECTION_LABELS,
  FINISH_LABELS
};
