/**
 * 空间创作专业提示词引擎 (Prompt Engine)
 * 学习并继承 new-chat 工业级多图语义约束架构：
 * 1. 图片清单与角色语义绑定（抗模型序号错位）
 * 2. 局部重绘任务定义（逐像素保持原样、禁拼图）
 * 3. 相机与地面透视铁律（同机位、地板走向对齐、接触阴影、人机工学真尺度、切勿撑满参考框）
 * 4. 九宫格空间方位与自然语言观察者偏航角 (Yaw)
 * 5. 材质、光影衰减与空间动线避障
 * 6. 超写实室内摄影级画质
 * 7. 全局禁令清单（去线框/角标/灰底/水印/漂浮/拼接）
 */

import { calculateNormalizedBbox } from './model-protocol.js';

/**
 * 偏航角 (-180° ~ +180°) 转换为观察者视角自然语言描述
 */
export function getFacingDescription(deg = 0) {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;

  if (d >= -22 && d <= 22) {
    return '正面朝向观察者，可清楚看到正面、座垫和双侧扶手轮廓';
  }
  if (d > 22 && d <= 67) {
    return '右前侧斜向摆放（约45°透视），可同时看到正面、右侧面、座垫和部分靠背';
  }
  if (d > 67 && d <= 112) {
    return '右侧面朝向观察者（约90°侧视），可完整看到右侧侧面轮廓与结构厚度';
  }
  if (d > 112 && d <= 157) {
    return '右后侧斜向摆放，可看到背面、右侧面和部分靠背';
  }
  if (d > 157 || d < -157) {
    return '背面朝向观察者，主要看到靠背背面';
  }
  if (d >= -157 && d < -112) {
    return '左后侧斜向摆放，可看到背面、左侧面和部分靠背';
  }
  if (d >= -112 && d < -67) {
    return '左侧面朝向观察者（约90°侧视），可完整看到左侧侧面轮廓与结构厚度';
  }
  return '左前侧斜向摆放（约45°透视），可同时看到正面、左侧面、座垫和部分靠背';
}

/**
 * 九宫格空间定位计算
 */
export function getScreenPosition(box, imgW = 800, imgH = 600) {
  if (!box) return '画面中景';
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const w = imgW || 800;
  const h = imgH || 600;

  const col = cx < w / 3 ? '左' : (cx > (w * 2) / 3 ? '右' : '中');
  const row = cy < h / 3 ? '上' : (cy > (h * 2) / 3 ? '下' : '中');
  if (row === '中' && col === '中') return '画面中央';
  return `画面${row}${col === '中' ? '部' : col + '侧'}`;
}

/**
 * 人体工学真实物理尺度与防撑满约束
 */
export function getScaleConstraint(modelName = '') {
  if (modelName.includes('单人') || modelName.includes('椅') || modelName.includes('沙发')) {
    return '严格按照单人位真实人体工学比例（约宽85-95cm，深90cm，高90-105cm）置入，落脚点对齐地面透视线，切勿撑满整个参考框，严禁横向拉宽压扁，与原图周边三人沙发及茶几保持真实尺度与空间留白对比';
  }
  if (modelName.includes('茶几') || modelName.includes('桌')) {
    return '严格按照桌面真实标准高度与长宽比例置入，切勿撑满整个参考框，与周边沙发保持合理人体工学间距';
  }
  if (modelName.includes('灯')) {
    return '严格按照灯具真实尺度比例置入，切勿过度放大，与层高及地面保持合理视距';
  }
  return '严格保持真实人机工学尺度，切勿撑满整个参考框，严禁横向拉宽拉扁，与原图周边家具及动线保持自然比例与留白';
}

/**
 * 构建符合 new-chat 规范的结构化提示词套件
 */
import { guideSentence } from './guide-sentence.js';

export function buildStructuredPrompt({
  regions = [],
  imageIndex = 0,
  totalReferenceCount = 1,
  imgW = 800,
  imgH = 600,
  targetTag = '@图1',
  references = [],
  aspectRatio = null,
  colorPaletteHint = '',
  cameraPerspectiveConstraint = ''
}) {
  if (!Array.isArray(regions) || regions.length === 0) return '';

  const tag = targetTag || `@图${imageIndex + 1}`;
  const tuNum = imageIndex + 1;
  const has3D = regions.some(r => ['replace', 'add'].includes(r.op));
  const hasRecolor = regions.some(r => r.op === 'recolor');
  const hasErase = regions.some(r => r.op === 'erase');

  const sections = [];

  // ================= 1. 图片清单与角色定义 =================
  const imgRoles = [];
  imgRoles.push(`• 第1张【场景与空间标注】：室内实拍场景照片，定义输出的机位、地面透视、环境光与周围家具，是输出构图的唯一基准。图上彩色线框仅为空间定位标记——严禁将框线、角标或标签文字画进输出图。`);

  let currentRefIdx = totalReferenceCount > 1 ? 2 : 2;
  const regionRefMap = new Map();

  regions.forEach(reg => {
    if (['replace', 'add'].includes(reg.op)) {
      const snapTag = reg.params?.snapshotRefTag || `@图${currentRefIdx}`;
      regionRefMap.set(reg.id, snapTag);
      imgRoles.push(`• ${snapTag}【3D家具透视参考】：${reg.params?.modelName || '目标家具'}的款式、部件形态与空间朝向参考图。输出中的实际透视视角与正背朝向必须与本参考图保持 100% 完全一致，仅参考其三维造型、部件形态与几何空间朝向，忽略它的灰白背景与原本浅白色单一渲染质感，最终色彩与质感需与现场环境主色调融为一体。`);
      currentRefIdx++;
    } else if (reg.op === 'recolor' && reg.params?.materialTextureUrl) {
      const snapTag = `@图${currentRefIdx}`;
      regionRefMap.set(reg.id, snapTag);
      imgRoles.push(`• ${snapTag}【材质贴图参考】：${reg.params?.materialName || '目标表面'}的材质质感与纹理贴图。`);
      currentRefIdx++;
    }
  });

  sections.push(`【图片角色约定】\n本次提供如下图片，每张图的角色定义：\n${imgRoles.join('\n')}`);

  // ================= 2. 任务目标 =================
  const taskLines = [];
  const locationLines = [];
  regions.forEach(reg => {
    const box = reg.type === 'polygon' && reg.points?.length > 0
      ? {
          x: Math.min(...reg.points.map(p => p.x)),
          y: Math.min(...reg.points.map(p => p.y)),
          w: Math.max(...reg.points.map(p => p.x)) - Math.min(...reg.points.map(p => p.x)),
          h: Math.max(...reg.points.map(p => p.y)) - Math.min(...reg.points.map(p => p.y)),
        }
      : { x: reg.x, y: reg.y, w: reg.w, h: reg.h };

    const pos = getScreenPosition(box, imgW, imgH);
    const colorDesc = reg.color?.name || '彩色线框';
    const normBbox = calculateNormalizedBbox(reg, imgW, imgH);
    const bboxTag = normBbox ? ` <bbox>${normBbox}</bbox>` : '';
    const regLabel = `${tag}[${reg.name}]${bboxTag}（${colorDesc}）`;

    if (normBbox) locationLines.push(`• ${reg.name || '选区'} <bbox>${normBbox}</bbox>`);

    const refBboxTag = reg.params?.refBbox ? ` <bbox>${reg.params.refBbox}</bbox>` : '';

    if (reg.params?.compiledClause) {
      taskLines.push(`• ${reg.params.compiledClause}`);
    } else if (reg.guide && reg.guide.type) {
      const sentence = guideSentence(reg);
      if (sentence) {
        if (reg.guide.type === 'resurface') {
          taskLines.push(`• 对位于${pos}的 ${regLabel}：${sentence}`);
        } else {
          taskLines.push(`• ${sentence}`);
        }
      }
    } else if (reg.op === 'replace') {
      const snapTag = regionRefMap.get(reg.id) || `@图${tuNum + 1}`;
      const modelName = reg.params?.modelName || '单人电动功能沙发';
      const bgDesc = reg.params?.transparentBg !== false ? '透明背景融入' : '纯色遮底';
      taskLines.push(`• 对位于${pos}的 ${regLabel} 做局部重绘：将其替换为一张与【${snapTag} 3D家具透视参考】${refBboxTag}同款造型的${modelName}（${bgDesc}）。`);
    } else if (reg.op === 'add') {
      const snapTag = regionRefMap.get(reg.id) || `@图${tuNum + 1}`;
      const modelName = reg.params?.modelName || '单人电动功能沙发';
      const bgDesc = reg.params?.transparentBg !== false ? '透明背景融入' : '纯色遮底';
      taskLines.push(`• 在位于${pos}的 ${regLabel} 处新增一件与【${snapTag} 3D家具透视参考】${refBboxTag}同款造型的${modelName}（${bgDesc}）。`);
    } else if (reg.op === 'recolor') {
      const mat = reg.params?.materialName ? `材质重塑为${reg.params.materialName}` : '';
      const col = reg.params?.colorName ? `色彩调配为${reg.params.colorName}` : (reg.params?.colorHex ? `色彩调配为${reg.params.colorHex}` : '');
      const craft = reg.params?.craft ? `工艺工法采用${reg.params.craft}` : (reg.params?.prompt_craft || '');
      const finishDesc = reg.params?.finish ? `表面光泽呈现${reg.params.finish === 'matte' ? '哑光自然' : (reg.params.finish === 'satin' ? '柔抛丝光' : '通透高光')}` : '';
      const roughDesc = reg.params?.roughness !== undefined ? `微距触感粗糙度${reg.params.roughness}%` : '';
      const agingDesc = reg.params?.aging === 'vintage_worn' ? '复古做旧质感' : (reg.params?.aging === 'gentle_patina' ? '轻微包浆' : '');
      const descParts = [mat, col, craft, finishDesc, roughDesc, agingDesc].filter(Boolean);
      const actionText = descParts.length > 0 ? descParts.join('，') : '优化为高质感精工饰面';
      taskLines.push(`• 对位于${pos}的 ${regLabel} 做表面属性重塑：${actionText}。严格保持原本的结构骨架与空间透视。`);
    } else if (reg.op === 'erase') {
      taskLines.push(`• 对位于${pos}的 ${regLabel} 进行杂物消除修复：${reg.params?.eraseDesc || '修复为平整自然纹理'}。`);
    } else if (reg.op === 'custom') {
      taskLines.push(`• 对位于${pos}的 ${regLabel} 进行局部微调：${reg.params?.customDesc || '按设计要求优化细节'}。`);
    }
  });

  sections.push(`【任务目标】\n${taskLines.join('\n')}`);
  sections.push(`【保持其余画面】\n其余所有未框选区域严格逐像素保持【场景与空间标注】原样。输出必须是这一张修改后的实景照片本身。禁止输出多图拼接、宫格对比、多视角产品图或画册式排版。`);
  if (locationLines.length) sections.push(`【选区位置】\n${locationLines.join('\n')}`);

  // ================= 3. 相机与地面透视铁律 (最高优先级) =================
  const ratioConstraint = aspectRatio ? `5. 目标画幅比例为 ${aspectRatio}，画面立面结构与镜头纵深必须精准保持 ${aspectRatio} 标准比例，严禁画面横向压扁或纵向拉伸变形。` : '5. 画面立面结构与镜头纵深精准保持原有比例，严禁画面拉伸压扁变形。';
  if (has3D) {
    sections.push(`【相机与透视（最高优先级）】\n输出与【场景与空间标注】完全同机位：相同的视点、俯仰角、镜头焦段与构图透视。参考图仅提供产品形态，绝对禁止把独立参考图的机位或背景带入输出。新陈设必须按照场景原图的地面透视平稳摆放在目标位置的地面上：\n1. 底边必须与该处地砖/地板缝走向透视线严格平行对齐；\n2. 底部触地点平稳落地，带有自然真实的接触阴影（Contact Shadow）；\n3. ${getScaleConstraint(regions.find(r => ['replace', 'add'].includes(r.op))?.params?.modelName || '')}；\n4. 严格禁止悬浮漂移、倾斜歪放、贴纸式斜贴或底部裁剪；\n${ratioConstraint}`);
    sections.push(`【表面对齐与长宽比锁定（高于框选精度）】\n1. 定位框（bbox）仅作为空间摆放位置与地面落脚大致范围的参考，不必精确贴合框边界：严禁为了迎合框选宽度而横向拉宽或纵向压扁家具！\n2. 新陈设必须严格保持【3D家具透视参考】原本真实的三维立面长宽比例（标准单人位沙发真实人体工学尺寸约宽85-95cm，深90cm，高90-105cm，立面正视高宽比约1:0.9~1:1.1，切勿横向拉宽拉扁变矮墩，宁可两边留白融入地面，也绝对禁止拉宽变形）；\n3. 家具姿态以室内地面实际走向为准：底边与该处地砖/地板缝走向透视线严格平行对齐，随地面透视自然倾斜落位，底部触地点带有真实自然的接触阴影（Contact Shadow），严禁机械地撑满选区边框。`);
  } else {
    sections.push(`【透视与结构保持（最高优先级）】\n输出与原场景完全同机位、同透视：保持原有建筑结构、墙面地面交界线及透视进深绝对一致。\n${ratioConstraint}`);
  }

  // ================= 4. 摆放朝向 =================
  const orientLines = [];
  regions.forEach(reg => {
    if (['replace', 'add'].includes(reg.op)) {
      const snapTag = regionRefMap.get(reg.id) || `@图${tuNum + 1}`;
      const hasGuide = Boolean(reg.guide && reg.guide.type);
      const yawBit = (!hasGuide || reg.guide.yawTouched) ? `空间偏航角约 ${reg.params?.yaw || 0}°。` : '';
      orientLines.push(`• ${reg.name}：${yawBit}新家具的摆放朝向与观察者视角必须严格以【${snapTag} 3D家具透视参考】中呈现的三维结构、正背朝向及部件形态为唯一准则，在地面平稳对齐落脚，严禁自行调转朝向或翻转正背面。`);
    }
  });
  if (orientLines.length > 0) {
    sections.push(`【摆放朝向】\n${orientLines.join('\n')}`);
  }

  // ================= 5. 材质、光影与空间融入 =================
  const integrationLines = [];
  if (has3D) {
    const paletteGuide = colorPaletteHint
      ? `呼应场景空间色系（${colorPaletteHint}），使新陈设仿佛原本就属于该空间一套的高级定制家具`
      : `呼应场景中右侧主位的三人黑色高级真皮沙发、深色柜体及典雅室内色调，智能选择与环境融合度最高的和谐深雅配色（如典雅黑、深炭灰或沉稳复古深皮质色，切勿突兀孤立地使用与环境割裂的惨白或生硬高光色）`;
    integrationLines.push(`• 【造型与部件结构】：严格参考对应 3D 参考图的三维几何构造、扶手、靠背与机械部件，但不要复刻其 CG 渲染塑料感与死白反光，呈现高档真实皮质的自然微褶皱与细腻工艺缝线；`);
    integrationLines.push(`• 【色彩与材质智能融入（最高优先级）】：参考图仅供款式与朝向参考，其原本的浅白单一颜色请勿机械照搬！请主动分析并提取【场景与空间标注】中的室内空间色调与核心家具主色板，${paletteGuide}；`);
    integrationLines.push(`• 【环境光影与动线】：投影方向与【场景与空间标注】中主光源（窗外自然光/室内吊灯）方向完全一致，带有环境光吸收遮蔽（Ambient Occlusion），与周边茶几、地毯及主沙发保持自然动线间距，严禁穿插穿模。`);
  }
  if (hasRecolor) {
    integrationLines.push(`• 表面纹理贴合原有结构走势，漫反射与镜面高光符合真实物理渲染规律，无涂抹感。`);
  }
  if (hasErase) {
    integrationLines.push(`• 【杂物消除与平整修复】：消除区域需根据周围墙面、地面或桌面材质与自然光照走向，平整无缝补齐背景真实纹理，过渡边缘自然，绝对无涂抹痕迹、模糊色块或残影。`);
  }
  if (integrationLines.length > 0) {
    sections.push(`【材质、光影与空间融入】\n${integrationLines.join('\n')}`);
  }

  // ================= 6. 画面品质 =================
  sections.push(`【画面品质】\n超写实室内实拍摄影画质，细节清晰细腻，边缘过渡干净自然、无接缝、无重影，真实镜头焦外景深。`);

  // ================= 7. 全局禁令清单 =================
  const prohibitions = [
    '1. 任何彩色框线、角标、标签或标注文字（线框仅为指示，切勿画入成图）；',
    '2. 参考图的灰白底色、透明通道网格或独立背景；',
    '3. 任何水印、商标或文字Logo；',
    '4. 悬浮、倾斜歪放或体量比例失真的家具；',
    '5. 与室内环境光温冲突的荧光、高饱和度色彩；',
    '6. 多图拼接、画册排版或九宫格对比图；',
    '7. 任何由于画幅转换导致的强行横向拉宽、纵向压扁或画面拉伸变形。'
  ];
  if (hasErase) {
    prohibitions.push('8. 消除区域出现原杂物轮廓残影、空洞黑边或生硬修补接缝。');
  }
  sections.push(`【全局禁止】\n输出图中严禁出现：\n${prohibitions.join('\n')}`);

  const fullPrompt = sections.join('\n\n');
  return fullPrompt;
}

/**
 * 结构化 Prompt 模块化拆分（核心改动意图 vs 底层引擎固化规则）
 * 便于前端折叠大段固定规则，仅突出编辑核心需求
 */
export function buildModularPrompt(options) {
  const full = buildStructuredPrompt(options);
  if (!full) return { corePrompt: '', rulesPrompt: '', fullPrompt: '' };

  const taskMatch = full.match(/【任务目标】([\s\S]*?)(?=【保持其余画面|【选区位置|【相机与透视|【透视与结构保持|$)/);
  const corePrompt = taskMatch ? `【任务目标】${taskMatch[1].trim()}` : full;
  const rulesPrompt = full.replace(corePrompt, '').trim();

  return {
    corePrompt,
    rulesPrompt,
    fullPrompt: full
  };
}
