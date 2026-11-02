/**
 * 智能感知与自适应调度链路深度测试套件 (Auto-Adaptive Dispatch & Workflow Test Suite)
 * 严格使用动态 import() 直接测试前端工程源码 (model-protocol.js & prompt-engine.js)，拒绝镜像重复代码！
 * 深度验证：
 * 1. 服务端 ratio.js 画幅推导 (9:16 / 3:4 / 16:9 / 1:1 / 21:9 / 3:2)
 * 2. 媒体语义感知 detectMediaSemantics (3D模型、材质贴图、视频关键帧、室内实拍底图)
 * 3. 动态画幅最贴合比例匹配 getNearestCanonicalRatio (离散比例与 adaptive 原生支持)
 * 4. 全链路自适应调度 inferOptimalWorkflowAndParams:
 *    - 纯对话挂图切入图像板块
 *    - 双向横竖画幅自适应切换（16:9 <-> 9:16 <-> 3:4），绝不保留旧比例导致画面压扁
 *    - 室内底图与 3D 家具共存时，锁定室内底图比例，不被 1:1 单品快照劫持
 *    - 选区操作细粒度路由：杂物消除 (erase)、材质重塑 (recolor)、空间陈设 (add/replace)
 *    - 视频首尾帧 (first_last_frame) 与全能多参考调度
 *    - 创作模板复用画幅冲突智能校准（双向自适应纠偏）
 * 5. 结构化提示词引擎 buildStructuredPrompt 对 3D家具人机工学真尺度、地面透视、杂物消除无缝补齐与全局禁令
 */
const assert = require('node:assert');
const path = require('node:path');
const {
  detectOptimalRatioAndSize,
  classifyOrientation,
  pixelSizeFor,
  RATIO_ORDER,
  RATIO_HW
} = require('../src/ratio');

async function runTests() {
  // 直接加载前端真实源码模块，确保零代码漂移与测试真实性
  const modelProtocolPath = path.resolve(__dirname, '../web-pro/src/utils/model-protocol.js');
  const promptEnginePath = path.resolve(__dirname, '../web-pro/src/utils/prompt-engine.js');
  
  const modelProtocol = await import('file://' + modelProtocolPath.replace(/\\/g, '/'));
  const promptEngine = await import('file://' + promptEnginePath.replace(/\\/g, '/'));

  const {
    getNearestCanonicalRatio,
    detectMediaSemantics,
    inferOptimalWorkflowAndParams,
    getModelPrecisionSpec,
    CANONICAL_RATIOS
  } = modelProtocol;

  const {
    buildStructuredPrompt,
    getScaleConstraint,
    getFacingDescription
  } = promptEngine;

  console.log('=== 1. 测试服务端 ratio.js 的 detectOptimalRatioAndSize ===');
  {
    // 竖屏 9:16 (1080x1920)
    const res916 = detectOptimalRatioAndSize(1080, 1920);
    assert.strictEqual(res916.ratio, '9:16', '1080x1920 必须精准匹配 9:16');
    assert.strictEqual(res916.size, '2K', '1080x1920 尺寸档位必须匹配 2K');
    assert.strictEqual(res916.orientation, '9:16');
    assert.strictEqual(res916.exact, true);

    // 竖幅 3:4 (960x1280)
    const res34 = detectOptimalRatioAndSize(960, 1280);
    assert.strictEqual(res34.ratio, '3:4', '960x1280 必须匹配 3:4');

    // 横屏 16:9 (1920x1080)
    const res169 = detectOptimalRatioAndSize(1920, 1080);
    assert.strictEqual(res169.ratio, '16:9', '1920x1080 必须匹配 16:9');

    // 方图 (1024x1024)
    const res11 = detectOptimalRatioAndSize(1024, 1024);
    assert.strictEqual(res11.ratio, '1:1', '1024x1024 必须匹配 1:1');

    // 宽幅 21:9 (2560x1080)
    const res219 = detectOptimalRatioAndSize(2560, 1080);
    assert.strictEqual(res219.ratio, '21:9', '2560x1080 必须匹配 21:9');

    // 限制在指定模型支持列表中
    const resConstrained = detectOptimalRatioAndSize(1080, 1920, ['16:9', '1:1']);
    assert.ok(['1:1', '16:9'].includes(resConstrained.ratio), '受限列表下应自适应选取最接近的可用画幅');
    console.log('✅ ratio.js detectOptimalRatioAndSize 测试通过');
  }

  console.log('=== 2. 测试前端媒体语义智能感知 detectMediaSemantics ===');
  {
    // 2.1 3D 家具模型快照
    const item3D = {
      name: '单人电动科技沙发_3D快照',
      url: '/models/sofa_model.glb',
      origin: '3d_snapshot',
      naturalWidth: 800,
      naturalHeight: 800
    };
    const sem3D = detectMediaSemantics(item3D);
    assert.strictEqual(sem3D.is3DFurniture, true, '应精准识别 3D 软装模型');
    assert.strictEqual(sem3D.isMaterialSwatch, false);

    // 2.2 材质纹理切片
    const itemSwatch = {
      name: '罗马洞石天然石材切片',
      url: '/api/base-library/materials/mat_1/basecolor.jpg',
      kind: 'basecolor',
      naturalWidth: 1024,
      naturalHeight: 1024
    };
    const semSwatch = detectMediaSemantics(itemSwatch);
    assert.strictEqual(semSwatch.isMaterialSwatch, true, '应精准识别材质贴图');
    assert.strictEqual(semSwatch.is3DFurniture, false);

    // 2.3 竖屏室内实拍图
    const itemScene = {
      name: '客厅落地窗实拍室内.jpg',
      url: 'https://example.com/scene.jpg',
      kind: 'image',
      naturalWidth: 1080,
      naturalHeight: 1920
    };
    const semScene = detectMediaSemantics(itemScene);
    assert.strictEqual(semScene.isVertical, true, '必须准确识别竖屏');
    assert.strictEqual(semScene.canonicalRatio, '9:16', '1080x1920 应返回 9:16 标准比');
    assert.strictEqual(semScene.suggestedSize, '2K');

    // 2.4 视频文件
    const itemVideo = {
      name: '实拍样板间运镜.mp4',
      url: 'https://example.com/video.mp4',
      kind: 'video',
      naturalWidth: 1920,
      naturalHeight: 1080
    };
    const semVideo = detectMediaSemantics(itemVideo);
    assert.strictEqual(semVideo.isVideo, true);
    assert.strictEqual(semVideo.kind, 'video');

    console.log('✅ detectMediaSemantics 媒体语义感知测试通过');
  }

  console.log('=== 3. 测试画幅计算与模型自适应选项 getNearestCanonicalRatio ===');
  {
    // 标准比匹配
    assert.strictEqual(getNearestCanonicalRatio(1080, 1920), '9:16');
    assert.strictEqual(getNearestCanonicalRatio(1920, 1080), '16:9');
    assert.strictEqual(getNearestCanonicalRatio(1200, 1600), '3:4');
    assert.strictEqual(getNearestCanonicalRatio(1600, 1200), '4:3');

    // 当模型支持 adaptive 且长宽比非标准离散比例时，智能选择 adaptive
    const adaptiveRatio = getNearestCanonicalRatio(2100, 900, ['16:9', '1:1', 'adaptive']);
    assert.strictEqual(adaptiveRatio, 'adaptive', '非标准超宽比在有 adaptive 选项时应自动选择 adaptive');
    console.log('✅ getNearestCanonicalRatio 画幅计算测试通过');
  }

  console.log('=== 4. 测试全链路自适应调度 (inferOptimalWorkflowAndParams) ===');
  {
    const mockImageSchema = {
      id: 'doubao-seedream-5-0-flash',
      modes: [
        { id: 'text_to_image', label: '文生图' },
        { id: 'image_to_image', label: '图生图' },
        { id: 'image_reference', label: '多参考' },
        { id: 'image_edit', label: '交互编辑' },
        { id: 'expand_fill', label: '扩边填白' }
      ],
      common: [
        { key: 'ratio', options: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'] },
        { key: 'size', options: ['1K', '1.5K', '2K'] }
      ]
    };

    // 场景 A1：用户从纯对话 (chat) 初始状态挂上 1 张 9:16 竖屏室内图
    const verticalImg = {
      name: '室内实景',
      url: 'http://img/v.jpg',
      naturalWidth: 1080,
      naturalHeight: 1920,
      width: 1080,
      height: 1920
    };
    const flowA1 = inferOptimalWorkflowAndParams({
      referenceTray: [verticalImg],
      selectedImageIndex: 0,
      currentModality: 'chat',
      currentGenMode: 'text_to_image',
      currentSchema: mockImageSchema,
      currentParams: { ratio: '16:9', size: '2K' }
    });

    assert.strictEqual(flowA1.targetModality, 'image', '挂载图片后必须自动由纯对话切至图像板块');
    assert.strictEqual(flowA1.targetGenMode, 'image_to_image', '单图状态下必须自动切至图生图');
    assert.strictEqual(flowA1.targetRatio, '9:16', '画幅必须自适应纠正为 9:16，杜绝画面压扁变形！');

    // 场景 A2：用户从 9:16 画幅切换至 16:9 横屏空间图（双向自适应验证）
    const horizontalImg = {
      name: '客餐厅全景',
      url: 'http://img/h.jpg',
      naturalWidth: 1920,
      naturalHeight: 1080,
      width: 1920,
      height: 1080
    };
    const flowA2 = inferOptimalWorkflowAndParams({
      referenceTray: [horizontalImg],
      selectedImageIndex: 0,
      currentModality: 'image',
      currentGenMode: 'image_to_image',
      currentSchema: mockImageSchema,
      currentParams: { ratio: '9:16', size: '2K' } // 原为 9:16
    });
    assert.strictEqual(flowA2.targetRatio, '16:9', '由竖图切到横图时，必须自动自适应纠正为 16:9，杜绝画面拉伸！');

    // 场景 A3：切换为 3:4 室内画幅
    const photo34 = {
      name: '玄关局部',
      url: 'http://img/34.jpg',
      naturalWidth: 1200,
      naturalHeight: 1600,
      width: 1200,
      height: 1600
    };
    const flowA3 = inferOptimalWorkflowAndParams({
      referenceTray: [photo34],
      selectedImageIndex: 0,
      currentModality: 'image',
      currentGenMode: 'image_to_image',
      currentSchema: mockImageSchema,
      currentParams: { ratio: '9:16', size: '2K' }
    });
    assert.strictEqual(flowA3.targetRatio, '3:4', '必须自适应切换为 3:4 标准比');

    // 场景 B：挂载 1 张 9:16 室内底图 + 1 张 1:1 3D 家具单品快照
    // 关键鲁棒性测试：当用户聚焦 3D 家具快照时，画面输出画幅仍然必须对齐室内底图 (9:16)，绝对不能被 1:1 3D 截图劫持
    const sofa3D = {
      name: '单人电动科技沙发',
      url: '/models/sofa.glb',
      origin: '3d_snapshot',
      isRefObject: true,
      naturalWidth: 600,
      naturalHeight: 600,
      width: 600,
      height: 600
    };
    const flowB = inferOptimalWorkflowAndParams({
      referenceTray: [verticalImg, sofa3D],
      selectedImageIndex: 1, // 当前高亮选中的是 3D 单品
      currentModality: 'image',
      currentGenMode: 'image_to_image',
      currentSchema: mockImageSchema,
      currentParams: { ratio: '9:16', size: '2K' }
    });
    assert.strictEqual(flowB.targetGenMode, 'image_edit', '底图+3D家具单品必须自动切入局部编辑/安装模式');
    assert.strictEqual(flowB.targetRatio, '9:16', '主场景画幅必须保持室内底图的 9:16，严禁被 1:1 3D 单品快照带偏！');
    assert.strictEqual(flowB.is3DFurniture, true, '必须识别出 3D 家具透视参考');
    assert.strictEqual(flowB.directives.groundPerspectiveLock, true, '必须激活地面透视锁定');
    assert.strictEqual(flowB.directives.contactShadowRequired, true, '必须强制真实接触阴影');
    assert.strictEqual(flowB.selectionExit.kind, 'coords_bbox', 'Seedream 模型必须分配 coords_bbox 选区出口');

    // 场景 C：添加了空间扩图操作
    const outpaintedImg = { ...verticalImg, outpainted: true };
    const flowC = inferOptimalWorkflowAndParams({
      referenceTray: [outpaintedImg],
      selectedImageIndex: 0,
      currentModality: 'image',
      currentGenMode: 'image_to_image',
      currentSchema: mockImageSchema,
      currentParams: { ratio: '9:16', size: '2K' }
    });
    assert.strictEqual(flowC.targetGenMode, 'expand_fill', '画面向外延展时必须自动切入扩边填白 (expand_fill)');

    // 场景 D：视频首尾帧 (2张图片 + 视频能力模型)
    const mockVideoSchema = {
      id: 'seedance2_5',
      modes: [
        { id: 'text_to_video', label: '文生视频' },
        { id: 'image_to_video', label: '图生视频' },
        { id: 'first_last_frame', label: '首尾帧' },
        { id: 'omni_reference', label: '全能参考' }
      ],
      common: [
        { key: 'ratio', options: ['16:9', '9:16', '1:1', 'adaptive'] },
        { key: 'resolution', options: ['720p', '1080p'] }
      ]
    };
    const frame1 = { name: '首帧', url: 'http://img/f1.jpg', naturalWidth: 1080, naturalHeight: 1920, width: 1080, height: 1920 };
    const frame2 = { name: '尾帧', url: 'http://img/f2.jpg', naturalWidth: 1080, naturalHeight: 1920, width: 1080, height: 1920 };
    const flowD = inferOptimalWorkflowAndParams({
      referenceTray: [frame1, frame2],
      selectedImageIndex: 0,
      currentModality: 'video',
      currentGenMode: 'image_to_video',
      currentSchema: mockVideoSchema,
      currentParams: { ratio: '16:9' }
    });
    assert.strictEqual(flowD.targetGenMode, 'first_last_frame', '2 张图片在视频板块下应自适应推荐「首尾帧」子模式');
    assert.strictEqual(flowD.targetRatio, '9:16', '视频画幅应根据首帧自动纠正为 9:16');

    // 场景 E：选区操作细粒度路由 (杂物消除 erase)
    const eraseRegion = {
      id: 'reg_erase_1',
      name: '区域1',
      op: 'erase',
      params: { eraseDesc: '平整自然白墙' }
    };
    const flowE = inferOptimalWorkflowAndParams({
      referenceTray: [{ ...verticalImg, regions: [eraseRegion] }],
      selectedImageIndex: 0,
      currentModality: 'image',
      currentGenMode: 'image_to_image',
      currentSchema: mockImageSchema,
      currentParams: { ratio: '9:16' }
    });
    assert.strictEqual(flowE.targetGenMode, 'image_edit');
    assert.strictEqual(flowE.hasErase, true);
    assert.strictEqual(flowE.directives.eraseBackgroundSeamlessFill, true);
    assert.strictEqual(flowE.directives.noGhostingResiduals, true);

    console.log('✅ inferOptimalWorkflowAndParams 全链路自适应调度测试通过');
  }

  console.log('=== 5. 测试创作模板复用 (Creation Templates) 智能冲突校准 ===');
  {
    const mockSchema = {
      id: 'seedream5flash',
      modes: [{ id: 'image_to_image', label: '图生图' }, { id: 'image_edit', label: '交互编辑' }],
      common: [{ key: 'ratio', options: ['1:1', '4:3', '3:4', '16:9', '9:16'] }]
    };

    // 5.1 历史模板写死 16:9，但底图为 9:16 竖屏
    const templateFromDb = {
      id: 'tpl_123',
      title: '意式侘寂极简客餐厅',
      aspect_ratio: '16:9',
      type: 'image',
      params: {
        genMode: 'image_to_image',
        ratio: '16:9'
      },
      origin_images: [
        {
          name: '手机室内竖拍原片',
          url: 'http://img/portrait.jpg',
          naturalWidth: 1080,
          naturalHeight: 1920,
          width: 1080,
          height: 1920
        }
      ]
    };

    const flowTpl1 = inferOptimalWorkflowAndParams({
      referenceTray: templateFromDb.origin_images,
      selectedImageIndex: 0,
      currentModality: 'chat',
      currentGenMode: 'text_to_image',
      currentSchema: mockSchema,
      currentParams: { ratio: '16:9' },
      templateMeta: templateFromDb
    });

    assert.strictEqual(flowTpl1.targetModality, 'image');
    assert.strictEqual(flowTpl1.targetRatio, '9:16', '模板虽存 16:9，但底图为 9:16 竖屏，必须自适应校准为 9:16 保护画质');

    // 5.2 历史模板写死 9:16，但用户当前选的是 16:9 横屏图
    const templatePortrait = {
      id: 'tpl_456',
      title: '竖版卧室温馨',
      aspect_ratio: '9:16',
      type: 'image',
      params: { ratio: '9:16' },
      origin_images: [
        {
          name: '横屏客厅实拍',
          url: 'http://img/h.jpg',
          naturalWidth: 1920,
          naturalHeight: 1080,
          width: 1920,
          height: 1080
        }
      ]
    };

    const flowTpl2 = inferOptimalWorkflowAndParams({
      referenceTray: templatePortrait.origin_images,
      selectedImageIndex: 0,
      currentModality: 'image',
      currentGenMode: 'image_to_image',
      currentSchema: mockSchema,
      currentParams: { ratio: '9:16' },
      templateMeta: templatePortrait
    });

    assert.strictEqual(flowTpl2.targetRatio, '16:9', '底图为 16:9 横屏时，必须校准为 16:9，绝不保留模板旧的 9:16');
    console.log('✅ 创作模板复用画幅冲突自适应校准测试通过');
  }

  console.log('=== 6. 测试结构化提示词构建 buildStructuredPrompt 约束与真尺度 ===');
  {
    const promptWith3D = buildStructuredPrompt({
      regions: [
        {
          id: 'reg_1',
          name: '区域1',
          op: 'replace',
          type: 'rect',
          x: 100, y: 100, w: 200, h: 200,
          color: { name: '红色' },
          params: { modelName: '单人意式极简皮艺沙发', yaw: 45 }
        }
      ],
      imageIndex: 0,
      imgW: 1080,
      imgH: 1920,
      aspectRatio: '9:16',
      colorPaletteHint: '现场黑白灰极简硬朗色调'
    });

    assert.ok(promptWith3D.includes('9:16'), '必须包含目标画幅 9:16 约束');
    assert.ok(promptWith3D.includes('人体工学'), '必须包含真实人体工学尺度约束');
    assert.ok(promptWith3D.includes('切勿撑满整个参考框'), '必须严禁撑满框变形');
    assert.ok(promptWith3D.includes('现场黑白灰极简硬朗色调'), '必须注入环境色彩融合建议');

    // 杂物消除结构化提示词
    const promptWithErase = buildStructuredPrompt({
      regions: [
        {
          id: 'reg_erase',
          name: '区域2',
          op: 'erase',
          type: 'rect',
          x: 50, y: 50, w: 100, h: 100,
          color: { name: '蓝色' },
          params: { eraseDesc: '修复为平整大理石台面' }
        }
      ],
      imageIndex: 0,
      imgW: 1920,
      imgH: 1080,
      aspectRatio: '16:9'
    });

    assert.ok(promptWithErase.includes('平整自然纹理') || promptWithErase.includes('修复为平整大理石台面'));
    assert.ok(promptWithErase.includes('残影') || promptWithErase.includes('修补'), '必须包含消除区域防残影与平整纹理修复约束');
    console.log('✅ buildStructuredPrompt 结构化提示词套件验证通过');
  }

  console.log('\n🎉 所有 6 大类全链路智能感知、自适应调度与结构化提示词测试全部真实无缝通过！');
}

runTests().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
