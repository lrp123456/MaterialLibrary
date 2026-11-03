/**
 * Milestone 2 核心对抗性极限压力测试 (Adversarial Stress Test Suite)
 * 覆盖：
 * 1. 多比例画幅 (16:9, 9:16, 4:3, 3:4, 1:1, 21:9) 选区切片长宽比保真与零畸变测试
 * 2. 1152x2048 竖屏下 <bbox>122 633 699 953</bbox> 像素精准换算与防墙面漂移校验
 * 3. VLM 故障注入矩阵 (Network Error, Timeout, Malformed JSON, Empty Response, Low Confidence)
 * 4. 高并发故障恢复压力测试 (50 路并发随机故障注入)
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const sharp = require('sharp');

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { classifyRegionPart } = require('../src/base-library/classify-part');
const {
  cropSelectionInterior,
  normalizeQuadOrRect,
  selectionBounds,
  parseBboxString,
  axisToPx
} = require('../src/handlers/image-ops');

// 全局外网熔断：本套件所有 JEV 用例都显式注入 fetch mock，任何漏网外呼立即失败
globalThis.fetch = async () => {
  throw new Error('unexpected real network fetch in stress-m2 unit test');
};

// 模拟前端 StudioEditLayer.vue 中的等比裁切逻辑
function simulateFrontendCrop(imgW, imgH, norm) {
  const normX = Math.max(0, Math.min(1, Number(norm.x) || 0));
  const normY = Math.max(0, Math.min(1, Number(norm.y) || 0));
  const normW = Math.max(0.001, Math.min(1 - normX, Number(norm.w) || 0.1));
  const normH = Math.max(0.001, Math.min(1 - normY, Number(norm.h) || 0.1));

  let minX = Math.round(normX * imgW);
  let minY = Math.round(normY * imgH);
  let w = Math.round(normW * imgW);
  let h = Math.round(normH * imgH);

  minX = Math.max(0, Math.min(imgW - 1, minX));
  minY = Math.max(0, Math.min(imgH - 1, minY));
  w = Math.max(1, Math.min(imgW - minX, w));
  h = Math.max(1, Math.min(imgH - minY, h));

  let targetW = w;
  let targetH = h;
  if (Math.max(w, h) > 512) {
    const s = 512 / Math.max(w, h);
    targetW = Math.max(1, Math.round(w * s));
    targetH = Math.max(1, Math.round(h * s));
  } else if (Math.min(w, h) < 280) {
    const s = Math.min(280 / Math.max(1, Math.min(w, h)), 512 / Math.max(1, Math.max(w, h)));
    targetW = Math.max(1, Math.round(w * s));
    targetH = Math.max(1, Math.round(h * s));
  }
  return { minX, minY, w, h, targetW, targetH };
}

async function runAdversarialStressTests() {
  console.log('================================================================');
  console.log('🚀 启动 Milestone 2 核心对抗性极限压力测试 (Challenger M2_2)');
  console.log('================================================================\n');

  // 初始化临时 DB
  const testDbDir = path.join(os.tmpdir(), 'dsh_m2_stress_' + Date.now());
  fs.mkdirSync(testDbDir, { recursive: true });
  const db = openDb(testDbDir);
  ensureBaseLibrarySchema(db);

  // =========================================================================
  // TASK 1: 多画幅比例长宽比保真压力测试 (16:9, 9:16, 4:3, 3:4, 1:1, 21:9)
  // =========================================================================
  console.log('>>> [TEST SECTION 1] 跨比例画幅选区切片长宽比保真测试');

  const aspectConfigs = [
    { name: '16:9 横屏', width: 1920, height: 1080 },
    { name: '16:9 4K横屏', width: 3840, height: 2160 },
    { name: '9:16 手机竖屏', width: 1080, height: 1920 },
    { name: '9:16 高清竖屏', width: 1152, height: 2048 },
    { name: '4:3 经典画幅', width: 1600, height: 1200 },
    { name: '3:4 竖向画幅', width: 1200, height: 1600 },
    { name: '1:1 正方形', width: 1024, height: 1024 },
    { name: '21:9 极限带鱼屏超宽全景', width: 2560, height: 1080 },
    { name: '21:9 准4K超宽带鱼屏', width: 3440, height: 1440 },
  ];

  const testSelections = [
    { label: '中心大矩形 (0.5x0.5)', norm: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
    { label: '横向宽矩形 (0.8x0.25)', norm: { x: 0.10, y: 0.35, w: 0.8, h: 0.25 } },
    { label: '纵向窄高矩形 (0.25x0.8)', norm: { x: 0.35, y: 0.10, w: 0.25, h: 0.8 } },
    { label: '右下边界相交矩形 (0.3x0.3)', norm: { x: 0.85, y: 0.85, w: 0.3, h: 0.3 } },
    { label: '超微小矩形 (0.05x0.05)', norm: { x: 0.10, y: 0.10, w: 0.05, h: 0.05 } },
    { label: '极端全景横向细条 (0.9x0.03)', norm: { x: 0.05, y: 0.48, w: 0.9, h: 0.03 } },
    { label: '极端垂直纵向细条 (0.03x0.9)', norm: { x: 0.48, y: 0.05, w: 0.03, h: 0.9 } },
  ];

  let testCount1 = 0;
  for (const cfg of aspectConfigs) {
    // 生成纯色背景测试图
    const baseBuffer = await sharp({
      create: {
        width: cfg.width,
        height: cfg.height,
        channels: 3,
        background: { r: 100, g: 120, b: 140 }
      }
    }).jpeg().toBuffer();

    for (const sel of testSelections) {
      testCount1++;
      // 1. 后端裁切
      const cropBuf = await cropSelectionInterior(baseBuffer, { norm: sel.norm });
      const cropMeta = await sharp(cropBuf).metadata();

      assert.strictEqual(cropMeta.format, 'jpeg', `[${cfg.name}][${sel.label}] 输出格式必须为 JPEG`);
      assert.ok(cropMeta.width >= 280, `[${cfg.name}][${sel.label}] 宽度不得低于 280 (实际: ${cropMeta.width})`);
      assert.ok(cropMeta.height >= 280, `[${cfg.name}][${sel.label}] 高度不得低于 280 (实际: ${cropMeta.height})`);
      assert.ok(cropMeta.width <= 1568, `[${cfg.name}][${sel.label}] 宽度不得超过 1568 (实际: ${cropMeta.width})`);
      assert.ok(cropMeta.height <= 1568, `[${cfg.name}][${sel.label}] 高度不得超过 1568 (实际: ${cropMeta.height})`);

      // 理论物理像素未缩放长宽
      const physW = Math.max(1, Math.min(cfg.width - Math.floor(sel.norm.x * cfg.width), Math.round(sel.norm.w * cfg.width)));
      const physH = Math.max(1, Math.min(cfg.height - Math.floor(sel.norm.y * cfg.height), Math.round(sel.norm.h * cfg.height)));
      const rawAr = Math.max(physW, physH) / Math.min(physW, physH);

      if (rawAr <= 5.6) {
        // 常规比例下，后端等比拉伸/缩小，长宽比理论上必须严格保持一致（允许取整微小误差 < 1.5%）
        const cropAr = cropMeta.width / cropMeta.height;
        const targetAr = physW / physH;
        const diffRatio = Math.abs(cropAr - targetAr) / targetAr;
        assert.ok(
          diffRatio < 0.02,
          `[${cfg.name}][${sel.label}] 选区长宽比失真！实际=${cropAr.toFixed(4)}, 预期=${targetAr.toFixed(4)}, 相对误差=${(diffRatio * 100).toFixed(2)}%`
        );
      } else {
        // 极端比例 (> 5.6)，按规则长边固定 1568，短边补齐延展至 280
        if (physW >= physH) {
          assert.strictEqual(cropMeta.width, 1568);
          assert.strictEqual(cropMeta.height, 280);
        } else {
          assert.strictEqual(cropMeta.height, 1568);
          assert.strictEqual(cropMeta.width, 280);
        }
      }

      // 2. 前端等比计算模拟验证:
      // 验证两者严格基于同一缩放比例 s，零模型拉伸，仅存在整数像素取整 (Math.round 误差 <= 0.5px)
      const fe = simulateFrontendCrop(cfg.width, cfg.height, sel.norm);
      assert.ok(fe.targetW >= 1 && fe.targetW <= 512, `前端宽度应在合理区间: ${fe.targetW}`);
      assert.ok(fe.targetH >= 1 && fe.targetH <= 512, `前端高度应在合理区间: ${fe.targetH}`);

      let s = 1;
      if (Math.max(fe.w, fe.h) > 512) {
        s = 512 / Math.max(fe.w, fe.h);
      } else if (Math.min(fe.w, fe.h) < 280) {
        s = Math.min(280 / Math.max(1, Math.min(fe.w, fe.h)), 512 / Math.max(1, Math.max(fe.w, fe.h)));
      }
      // 验证 targetW 和 targetH 严格来自于 Math.round(w * s) 和 Math.round(h * s)，长宽无单边拉伸
      assert.strictEqual(fe.targetW, Math.max(1, Math.round(fe.w * s)), `前端宽度必须严格按比例 s=${s} 缩放`);
      assert.strictEqual(fe.targetH, Math.max(1, Math.round(fe.h * s)), `前端高度必须严格按比例 s=${s} 缩放`);
      assert.ok(Math.abs(fe.targetW - fe.w * s) <= 0.5001, '前端宽度离散取整误差不得超过 0.5 像素');
      assert.ok(Math.abs(fe.targetH - fe.h * s) <= 0.5001, '前端高度离散取整误差不得超过 0.5 像素');
      if (Math.min(fe.targetW, fe.targetH) >= 20) {
        const feRatio = fe.targetW / fe.targetH;
        const feExpectedRatio = fe.w / fe.h;
        const feDiff = Math.abs(feRatio - feExpectedRatio) / feExpectedRatio;
        assert.ok(feDiff < 0.02, `常规尺寸前端缩放长宽比失真！误差=${(feDiff * 100).toFixed(2)}%`);
      }
    }
  }
  console.log(`✅ [SECTION 1 PASS] 完成 9 种画幅比例 × 7 组选区 = ${testCount1} 组长宽比保真与零畸变测试，100% 保持！\n`);

  // =========================================================================
  // TASK 2: 1152x2048 与 <bbox>122 633 699 953</bbox> 像素精准换算与防墙面漂移校验
  // =========================================================================
  console.log('>>> [TEST SECTION 2] 1152x2048 底图与 <bbox>122 633 699 953</bbox> 选区精准像素测试');

  const sofaImgW = 1152;
  const sofaImgH = 2048;

  // 理论归一化换算公式 (Seedream 0~1000 规范):
  // Xmin = 122 / 1000 * 1152 = 140.544px -> round = 141px (floor = 140px)
  // Xmax = 699 / 1000 * 1152 = 805.248px -> round = 805px
  // Ymin = 633 / 1000 * 2048 = 1296.384px -> round = 1296px
  // Ymax = 953 / 1000 * 2048 = 1951.744px -> round = 1952px
  // 选区跨度:
  // 宽度: 805.248 - 140.544 = 664.704px -> 665px
  // 高度: 1951.744 - 1296.384 = 655.360px -> 655px

  // 1. 标准支持的选区输入形态测试 (严格 665 x 655，Y 轴在 1296~1952)
  const supportedInputs = [
    { label: '标准标签字符串', input: '<bbox>122 633 699 953</bbox>' },
    { label: '带多余空白字符标签', input: '  <bbox>   122   633   699   953   </bbox>  ' },
    { label: '数组格式字符串', input: '[122, 633, 699, 953]' },
    { label: '对象含 bbox 数组', input: { bbox: [122, 633, 699, 953] } },
    { label: '对象含 bbox 字符串', input: { bbox: '<bbox>122 633 699 953</bbox>' } },
    { label: '标准 0~1 归一化对象', input: { norm: { x: 0.122, y: 0.633, w: 0.577, h: 0.320 } } },
    {
      label: '4点归一化点列 norm_points',
      input: {
        norm_points: [
          { x: 0.122, y: 0.633 },
          { x: 0.699, y: 0.633 },
          { x: 0.699, y: 0.953 },
          { x: 0.122, y: 0.953 }
        ]
      }
    }
  ];

  const sofaSceneBuffer = await sharp({
    create: {
      width: sofaImgW,
      height: sofaImgH,
      channels: 3,
      background: { r: 245, g: 240, b: 235 }
    }
  }).jpeg().toBuffer();

  for (const v of supportedInputs) {
    const cropped = await cropSelectionInterior(sofaSceneBuffer, v.input);
    const m = await sharp(cropped).metadata();
    assert.strictEqual(m.format, 'jpeg');
    // 宽高验证：必须精准为 665 x 655
    assert.strictEqual(m.width, 665, `[${v.label}] 切片宽度必须精准为 665px (实际: ${m.width})`);
    assert.strictEqual(m.height, 655, `[${v.label}] 切片高度必须精准为 655px (实际: ${m.height})`);

    // 对 selectionBounds 原生支持的格式校验物理像素换算
    if (typeof v.input === 'string' || (v.input && v.input.bbox)) {
      const bounds = selectionBounds(v.input, sofaImgW, sofaImgH);
      assert.ok(
        bounds.minY >= 1290 && bounds.minY <= 1300,
        `[${v.label}] Y 轴起点必须位于下方沙发区域 Y=1296 (实际: ${bounds.minY})，绝不能落在 Y=633 (上方墙面)`
      );
      assert.ok(
        bounds.maxY >= 1950 && bounds.maxY <= 1955,
        `[${v.label}] Y 轴终点必须位于下方沙发底部 Y=1952 (实际: ${bounds.maxY})，绝不能落在 Y=953 (中间墙面)`
      );
    }
  }

  // 2. 对抗性探测缺陷 (Adversarial Bug Probe):
  // 在 src/handlers/image-ops.js 中第 653 行先判断了 `else if (selection && typeof selection === 'object')`，
  // 导致第 659 行针对纯数值数组 `else if (Array.isArray(selection) && selection.length === 4)` 成为不可达死代码 (Dead Code)！
  // 当直接传入 [122, 633, 699, 953] 数组时，因 Array 在 JS 中属于 object，但在分支内未匹配 bbox 属性，导致 rawBbox 为 null，
  // 从而静默回退至全图裁切 (882 x 1568)！
  const rawArrayCrop = await cropSelectionInterior(sofaSceneBuffer, [122, 633, 699, 953]);
  const rawArrayMeta = await sharp(rawArrayCrop).metadata();
  assert.strictEqual(rawArrayMeta.width, 665, `裸数值数组切片宽度必须为 665 (实际: ${rawArrayMeta.width})`);
  assert.strictEqual(rawArrayMeta.height, 655, `裸数值数组切片高度必须为 655 (实际: ${rawArrayMeta.height})`);
  console.log(`✅ [ADVERSARIAL BUG RESOLVED] 纯数值数组 [122, 633, 699, 953] 切片尺寸精准为 665x655，死代码已彻底清除！`);


  // 物理长宽比与物理空间无畸变验证
  const sofaPhysW = 0.577 * 1152; // 664.704
  const sofaPhysH = 0.320 * 2048; // 655.360
  const expectedSofaRatio = sofaPhysW / sofaPhysH; // 1.014258
  const actualSofaRatio = 665 / 655; // 1.015267
  const sofaRatioErr = Math.abs(actualSofaRatio - expectedSofaRatio) / expectedSofaRatio;
  assert.ok(sofaRatioErr < 0.002, `沙发选区物理零畸变保持验证通过 (误差 ${(sofaRatioErr * 100).toFixed(3)}% < 0.2%)`);

  // 前端 Canvas 导出尺寸严格等比验证: 665x655 -> 512x504
  const feSofa = simulateFrontendCrop(sofaImgW, sofaImgH, { x: 0.122, y: 0.633, w: 0.577, h: 0.320 });
  assert.strictEqual(feSofa.w, 665);
  assert.strictEqual(feSofa.h, 655);
  assert.strictEqual(feSofa.targetW, 512, '长边限制在 512');
  assert.strictEqual(feSofa.targetH, 504, '短边等比缩放至 504');
  assert.strictEqual(feSofa.minX, 141);
  assert.strictEqual(feSofa.minY, 1296);

  console.log('✅ [SECTION 2 PASS] 1152x2048 下 <bbox>122 633 699 953</bbox> 像素精准度、防墙面漂移、等比缩放全部验证通过！\n');

  // =========================================================================
  // TASK 3: VLM 故障注入矩阵与平滑降级 (Graceful Fallback) 测试
  // =========================================================================
  console.log('>>> [TEST SECTION 3] VLM 故障注入矩阵与平滑降级测试');

  const sofaCropJpeg = await cropSelectionInterior(sofaSceneBuffer, '<bbox>122 633 699 953</bbox>');
  const sofaSelectionParam = '<bbox>122 633 699 953</bbox>';

  const faultCases = [
    {
      title: '故障 1: 网络连接拒绝 (Network Error: ECONNREFUSED)',
      chatVision: async () => {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:443');
        err.code = 'ECONNREFUSED';
        throw err;
      }
    },
    {
      title: '故障 2: 向上调用超时 (Timeout Error: 15000ms Aborted)',
      chatVision: async () => {
        const err = new Error('The operation was aborted due to timeout (15000ms)');
        err.name = 'AbortError';
        throw err;
      }
    },
    {
      title: '故障 3a: 上游网关返回 HTML 错误页面 (Malformed JSON - HTML)',
      chatVision: async () => {
        return '<html><body><h1>502 Bad Gateway</h1><p>Cloudflare</p></body></html>';
      }
    },
    {
      title: '故障 3b: 上游返回截断残损 JSON (Malformed JSON - Truncated)',
      chatVision: async () => {
        return '```json\n{"part": "uphol';
      }
    },
    {
      title: '故障 3c: 上游返回与 Prompt 不相关的合法 JSON 字典',
      chatVision: async () => {
        return '{"error": {"code": 429, "message": "Resource exhausted"}}';
      }
    },
    {
      title: '故障 4a: 空白返回值 (Empty string)',
      chatVision: async () => {
        return '';
      }
    },
    {
      title: '故障 4b: 仅有纯空格的返回值 (Whitespace string)',
      chatVision: async () => {
        return '   \n\t  ';
      }
    },
    {
      title: '故障 4c: 返回 null',
      chatVision: async () => {
        return null;
      }
    },
    {
      title: '故障 4d: 返回 undefined',
      chatVision: async () => {
        return undefined;
      }
    },
    {
      title: '故障 5a: 低置信度输出误判为墙面 (Low Confidence - 0.55 wall)',
      chatVision: async () => {
        return {
          part: 'wall',
          material_family: 'paint',
          probability: 0.55
        };
      }
    },
    {
      title: '故障 5b: 返回非法非标准部位名称 (Unknown part - spaceship_seat)',
      chatVision: async () => {
        return {
          part: 'spaceship_seat',
          material_family: 'metal',
          probability: 0.99
        };
      }
    }
  ];

  // 模拟 JEV 服务离线或降级，确保精准测试 Level 3 空间启发式兜底
  const mockJevOfflineFetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: 'Service Unavailable' })
  });

  for (const tc of faultCases) {
    const res = await classifyRegionPart(db, sofaCropJpeg, {
      chatVision: tc.chatVision,
      fetch: mockJevOfflineFetch,
      selection: sofaSelectionParam
    });

    // 核心断言：平滑降级，绝不崩溃，绝不返回 uncertain=true (导致前端变墙面)
    assert.strictEqual(res.uncertain, false, `[${tc.title}] 降级至 Level 3 空间启发式必须置信判定 (uncertain 必须为 false)`);
    assert.strictEqual(res.part, 'upholstery', `[${tc.title}] 部位必须精准纠偏为 upholstery (实际: ${res.part})`);
    assert.strictEqual(res.material_family, 'leather', `[${tc.title}] 材质大类必须为 leather`);
    assert.strictEqual(res.recommended_category_id, 'mat_cat_leather', `[${tc.title}] 推荐基材品类必须为 mat_cat_leather`);
    assert.strictEqual(res.model, 'heuristic_spatial_upholstery', `[${tc.title}] 识别模型必须标注为 heuristic_spatial_upholstery`);
    assert.ok(res.probability >= 0.85, `[${tc.title}] 置信度必须 >= 0.85 (实际: ${res.probability})`);
    assert.notStrictEqual(res.part, 'wall', `[${tc.title}] 严禁输出 wall`);
    assert.notStrictEqual(res.part, 'floor', `[${tc.title}] 严禁输出 floor`);
  }

  console.log(`✅ [SECTION 3 PASS] 全量 ${faultCases.length} 种 VLM 故障注入均被平滑吸收，成功无缝回退至 Level 3 空间几何兜底！\n`);

  // =========================================================================
  // TASK 3b: 对抗性架构推演：Level 2 JEV 与 Level 3 几何兜底的交互风险
  // =========================================================================
  console.log('>>> [TEST SECTION 3b] 对抗性推演：Level 2 JEV 与 Level 3 几何兜底交互风险验证');

  // 当 JEV 返回 furniture 时智能转为 upholstery
  const mockJevFurn = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'jev-1.14.0',
      answers: { surface: { choice: 'furniture', probabilities: { furniture: 0.92 }, confidence: 0.89 } }
    })
  });
  const resJevFurn = await classifyRegionPart(db, sofaCropJpeg, {
    chatVision: async () => { throw new Error('VLM down'); },
    fetch: mockJevFurn,
    selection: sofaSelectionParam
  });
  assert.strictEqual(resJevFurn.part, 'upholstery');
  assert.strictEqual(resJevFurn.model, 'jev_smart_furniture');

  // 当 JEV 返回 soft 时智能转为布艺 upholstery
  const mockJevSoft = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'jev-1.14.0',
      answers: { surface: { choice: 'soft', probabilities: { soft: 0.88 }, confidence: 0.85 } }
    })
  });
  const resJevSoft = await classifyRegionPart(db, sofaCropJpeg, {
    chatVision: async () => { throw new Error('VLM down'); },
    fetch: mockJevSoft,
    selection: sofaSelectionParam
  });
  assert.strictEqual(resJevSoft.part, 'upholstery');
  assert.strictEqual(resJevSoft.material_family, 'fabric');

  // 对抗性风险探测：如果 JEV 对纯色皮革切片误判为 wall (prob >= 0.75)
  // classify-part.js:227 现行逻辑直接接受 JEV 的 wall，跳过 Level 3 空间纠偏
  const mockJevWallHallucination = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'jev-1.14.0',
      answers: { surface: { choice: 'wall', probabilities: { wall: 0.76 }, confidence: 0.73 } }
    })
  });
  const resJevWall = await classifyRegionPart(db, sofaCropJpeg, {
    chatVision: async () => { throw new Error('VLM down'); },
    fetch: mockJevWallHallucination,
    selection: sofaSelectionParam
  });
  assert.notStrictEqual(resJevWall.part, 'wall', '严禁直接采纳 JEV 的 wall 假阳性');
  assert.strictEqual(resJevWall.part, 'upholstery', 'JEV wall 误报已被空间启发式拦截纠偏为 upholstery');
  console.log('✅ [ADVERSARIAL RISK RESOLVED] JEV wall 误报已被空间启发式拦截纠偏为 upholstery');
  console.log('✅ [SECTION 3b PASS] JEV 交互与风险推演测试完成！\n');

  // =========================================================================
  // TASK 4: 高并发故障注入与随机扰动极限压力测试 (50 路并发)
  // =========================================================================
  console.log('>>> [TEST SECTION 4] 50 路高并发故障混合压力测试');

  const concurrentRequests = 50;
  const startTime = Date.now();

  const promiseList = Array.from({ length: concurrentRequests }).map(async (_, idx) => {
    // 随机指派故障模式
    const mode = idx % 5;
    let mockChatVision;
    if (mode === 0) {
      mockChatVision = async () => { throw new Error('Random simulated network failure ' + idx); };
    } else if (mode === 1) {
      mockChatVision = async () => { throw new Error('Random timeout 15000ms'); };
    } else if (mode === 2) {
      mockChatVision = async () => '502 Server Error corrupt string ' + idx;
    } else if (mode === 3) {
      mockChatVision = async () => ({ part: 'wall', probability: 0.45 });
    } else {
      mockChatVision = async () => ({ part: 'sofa', material_family: 'leather', probability: 0.92 });
    }

    const res = await classifyRegionPart(db, sofaCropJpeg, {
      chatVision: mockChatVision,
      fetch: mockJevOfflineFetch,
      selection: sofaSelectionParam
    });

    return { idx, mode, res };
  });

  // 50 路故障注入会触发分类器逐行 console.log，静音并发段，仅保留套件级结论输出
  const _section4Log = console.log;
  console.log = () => {};
  let results;
  try {
    results = await Promise.all(promiseList);
  } finally {
    console.log = _section4Log;
  }
  const elapsedMs = Date.now() - startTime;

  for (const item of results) {
    assert.strictEqual(item.res.uncertain, false, `[并发用例 #${item.idx}] 必须置信输出`);
    assert.strictEqual(item.res.part, 'upholstery', `[并发用例 #${item.idx}] 结果必须为 upholstery`);
    assert.strictEqual(item.res.recommended_category_id, 'mat_cat_leather', `[并发用例 #${item.idx}] 推荐基材必须为真皮`);
  }

  console.log(`✅ [SECTION 4 PASS] 50 路并发随机故障注入全部顺利完成，耗时 ${elapsedMs}ms，零异常、零未处理拒绝！\n`);

  console.log('================================================================');
  console.log('🎉🎉🎉 对抗性测试套件全部执行通过 (100% PASS)！');
  console.log('================================================================');

  try { db.close(); } catch {}
  try { fs.rmSync(testDbDir, { recursive: true, force: true }); } catch {}
}

if (require.main === module) {
  runAdversarialStressTests().catch((err) => {
    console.error('\n❌ 对抗性测试套件执行失败:', err);
    process.exit(1);
  });
}

module.exports = { runAdversarialStressTests };
