/**
 * Tier 1: 核心功能单点覆盖测试 (Feature Coverage Suite)
 * 覆盖 F1 ~ F13 各功能特性的隔离契约验证：
 * - F1: 3D 预设高清渲染快照与种子数据
 * - F2: 3D 选品库外部卡片展示契约与视角回退
 * - F3 & F4: 3D 模型上传即时快照提取与持久化 API
 * - F5: 选区切片几何内部裁切 (cropSelectionInterior)
 * - F6: 归一化坐标转换与坐标系修复 (normalizeQuadOrRect / axisToPx)
 * - F7: VLM 假成功抑制修复与别名映射扩展
 * - F8: 空间几何启发式规则立体化重构 (3D 立体高度 ch 判定)
 * - F9: 选区切片与分类器自动化回归单点契约
 * - F10: 部位推荐基材品类与色卡数据对齐
 * - F11: 空间编辑器 3D 单品目录动态接口契约
 * - F12: 提示词编译器色卡查询兼容 id 与 code
 * - F13: 字典外键与选区持久化字段补齐 (ba_image_bindings)
 */

const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const sharp = require('sharp');

// 把服务端数据目录（快照/缓存落盘）重定向到独立临时目录，杜绝污染生产 ~/.dsh-material-library
const _testDataDir = path.join(os.tmpdir(), 'dsh_tier1_mldata_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
process.env.ML_DATA_DIR = _testDataDir;
fs.mkdirSync(_testDataDir, { recursive: true });

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { seedMasterDictionary } = require('../src/base-library/master-dictionary-seed');
const { getDictionary } = require('../src/base-library/dictionary-routes');
const { classifyRegionPart } = require('../src/base-library/classify-part');
const { cropSelectionInterior, normalizeQuadOrRect } = require('../src/handlers/image-ops');
const { compileBaseAttributes } = require('../src/base-library/compile');
const { putImageBindings, getImageBindings } = require('../src/base-library/bindings');
const { handleApi } = require('../src/api');

// 全局外网熔断：JEV 回退默认开启，任何忘记注入 fetch 的分支一旦真打外网立即以明确错误失败
globalThis.fetch = async () => {
  throw new Error('unexpected real network fetch in tier1 unit test');
};

function createTestContext() {
  const testDir = path.join(os.tmpdir(), 'dsh_tier1_test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(testDir, { recursive: true });
  const db = openDb(testDir);
  ensureBaseLibrarySchema(db);
  seedMasterDictionary(db);

  // 初始化管理员会话用于 API 权限校验
  db.prepare(`
    INSERT OR REPLACE INTO sessions (token, user_id, role, expires_at)
    VALUES (?, ?, ?, ?)
  `).run('test-tier1-token', 1, 'admin', Date.now() + 86400000);

  const mockServices = { db, config: {}, interpreter: null };

  function invokeApi(method, reqPath, body = null, userToken = 'test-tier1-token') {
    return new Promise((resolve) => {
      const req = new http.IncomingMessage(null);
      req.method = method;
      req.url = reqPath;
      req.headers = {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json'
      };

      const res = {
        _headers: {},
        statusCode: 200,
        setHeader(k, v) { this._headers[k] = v; },
        getHeader(k) { return this._headers[k]; },
        writeHead(code, headers = {}) {
          this.statusCode = code;
          Object.assign(this._headers, headers);
        },
        end(data) {
          try {
            resolve({ statusCode: this.statusCode, json: JSON.parse(data) });
          } catch (_) {
            resolve({ statusCode: this.statusCode, raw: data });
          }
        }
      };

      if (body) {
        req.push(JSON.stringify(body));
      }
      req.push(null);

      handleApi(mockServices, req, res).catch(e => {
        resolve({ statusCode: 500, error: e.message });
      });
    });
  }

  return { testDir, db, invokeApi };
}

async function runTier1Tests() {
  const results = {
    tier: 1,
    name: 'Tier 1 - Feature Coverage',
    passed: 0,
    failed: 0,
    tests: [],
    errors: []
  };

  function recordPass(testName) {
    results.passed++;
    results.tests.push({ name: testName, status: 'PASSED' });
    console.log(`  ✅ [PASS] ${testName}`);
  }

  function recordFail(testName, err) {
    results.failed++;
    const errMsg = err?.message || String(err);
    results.tests.push({ name: testName, status: 'FAILED', error: errMsg });
    results.errors.push({ testName, error: errMsg });
    console.error(`  ❌ [FAIL] ${testName}: ${errMsg}`);
  }

  const { testDir, db, invokeApi } = createTestContext();

  console.log('\n======================================================');
  console.log('🚀 Running Tier 1: Feature Coverage Suites (F1 ~ F13)');
  console.log('======================================================\n');

  // --- F1: 3D 预设高清渲染快照素材生成与替换 ---
  try {
    const previewPath = path.join(__dirname, '../data/previews/sofa_single.png');
    assert.ok(fs.existsSync(previewPath), `预览文件必须存在于 ${previewPath}`);
    const stats = fs.statSync(previewPath);
    assert.ok(stats.size > 1024, `sofa_single.png 大小 (${stats.size} 字节) 必须大于 1KB，杜绝空图`);
    const meta = await sharp(previewPath).metadata();
    assert.strictEqual(meta.format, 'png', '预览格式必须为 PNG');
    assert.ok(meta.width >= 64 && meta.height >= 64, `尺寸 (${meta.width}x${meta.height}) 应达到清晰度要求`);

    // 检查数据库种子化记录
    const sofaPreset = db.prepare('SELECT * FROM product_presets WHERE id = ?').get('sofa_electric_single');
    assert.ok(sofaPreset, '数据库中必须存在 sofa_electric_single 预设种子数据');
    assert.strictEqual(sofaPreset.name, '极简单人电动真皮沙发');
    assert.ok(sofaPreset.preview_file, 'preview_file 不能为空');
    recordPass('F1: 3D 预设高清渲染快照素材与种子持久化');
  } catch (err) {
    recordFail('F1: 3D 预设高清渲染快照素材与种子持久化', err);
  }

  // --- F2: 3D 选品库外部卡片展示契约与视角回退 ---
  try {
    const res = await invokeApi('GET', '/api/products/presets');
    assert.strictEqual(res.statusCode, 200, 'GET /api/products/presets 必须返回 200');
    assert.ok(Array.isArray(res.json.data || res.json), '返回结果必须包含预设列表');
    const presets = res.json.data || res.json;
    assert.ok(presets.length >= 1, '预设列表不能为空');
    const sofa = presets.find(p => p.id === 'sofa_electric_single');
    assert.ok(sofa, '必须包含 sofa_electric_single 预设');
    assert.ok(sofa.preview_url, 'preview_url 必须存在且有效');
    assert.ok(sofa.model_url, 'model_url 必须存在且有效');
    assert.ok(typeof sofa.snapshots === 'object' && sofa.snapshots !== null, 'snapshots 必须为对象结构');

    // 视角回退链测试: right_45 || front || preview_url
    const chosenUrl = sofa.snapshots?.right_45 || sofa.snapshots?.front || sofa.preview_url;
    assert.ok(typeof chosenUrl === 'string' && chosenUrl.length > 0, '多视角快照回退链应返回有效 URL');
    recordPass('F2: 3D 选品库外部卡片数据契约与快照回退链');
  } catch (err) {
    recordFail('F2: 3D 选品库外部卡片数据契约与快照回退链', err);
  }

  // --- F3 & F4: 3D 模型上传即时快照提取与持久化 API ---
  try {
    const testPresetId = 'test_tier1_preset_armchair';
    // 1) PUT 创建
    const putRes = await invokeApi('PUT', `/api/products/presets/${testPresetId}`, {
      name: '测试包豪斯扶手椅',
      category: 'furniture',
      facing: 90,
      tags: ['包豪斯', '真皮', '设计经典']
    });
    assert.strictEqual(putRes.statusCode, 200);
    assert.strictEqual(putRes.json.success, true);

    // 2) POST 保存快照 Base64
    const fakeSnapshotPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const postRes = await invokeApi('POST', `/api/products/presets/${testPresetId}/snapshots`, {
      snapshots: {
        front: fakeSnapshotPng,
        right_45: fakeSnapshotPng
      }
    });
    assert.strictEqual(postRes.statusCode, 200);
    assert.strictEqual(postRes.json.success, true);

    // 3) 数据库底层核查
    const dbPreset = db.prepare('SELECT * FROM product_presets WHERE id = ?').get(testPresetId);
    assert.ok(dbPreset, '预设必须写入数据库');
    const dbSnapshots = JSON.parse(dbPreset.snapshots_json || '{}');
    assert.ok(dbSnapshots.front || dbSnapshots.right_45, 'snapshots_json 必须包含快照记录');

    // 4) 幂等清理
    await invokeApi('DELETE', `/api/products/presets/${testPresetId}`);
    recordPass('F3 & F4: 3D 模型预设保存与快照 Base64 持久化 API');
  } catch (err) {
    recordFail('F3 & F4: 3D 模型预设保存与快照 Base64 持久化 API', err);
  }

  // --- F5: 选区底图跨域与切片几何裁切重构 ---
  try {
    const baseBuffer = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: { r: 180, g: 190, b: 200 } }
    }).jpeg().toBuffer();

    const selection = {
      type: 'rect',
      norm: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } // 600 x 450 (ar = 1.333)
    };
    const cropped = await cropSelectionInterior(baseBuffer, selection);
    assert.ok(Buffer.isBuffer(cropped), '裁切产物必须是 Buffer');
    const cropMeta = await sharp(cropped).metadata();
    assert.strictEqual(cropMeta.format, 'jpeg', '输出必须为 JPEG 格式');
    const croppedAr = cropMeta.width / cropMeta.height;
    assert.ok(Math.abs(croppedAr - (600 / 450)) < 0.05, `裁切长宽比 (${croppedAr.toFixed(3)}) 应与选区 (1.333) 保持严格一致`);
    assert.ok(cropMeta.width >= 280 && cropMeta.height >= 280, '裁切边长必须满足最小尺寸限制 280');
    assert.ok(cropMeta.width <= 1568 && cropMeta.height <= 1568, '裁切边长必须不超过最大限制 1568');
    recordPass('F5: 选区切片几何裁切 (cropSelectionInterior)');
  } catch (err) {
    recordFail('F5: 选区切片几何裁切 (cropSelectionInterior)', err);
  }

  // --- F6: 归一化坐标转换与坐标系修复 ---
  try {
    // 0~1 浮点归一化转换验证
    const rectFraction = { rect: [0.1, 0.2, 0.5, 0.4], unit: 'fraction' };
    const quadFraction = normalizeQuadOrRect(rectFraction, 1000, 1000);
    assert.strictEqual(quadFraction.length, 4);
    assert.strictEqual(quadFraction[0].x, 100);
    assert.strictEqual(quadFraction[0].y, 200);
    assert.strictEqual(quadFraction[2].x, 600);
    assert.strictEqual(quadFraction[2].y, 600);

    // 0~1000 整数归一化适配验证 (例如 1152x2048 底图上的 <bbox>122 633 699 953</bbox>，无 unit 传参时自动智能识别为 0~1000 归一化)
    const bbox1000 = { bbox: [122, 633, 699, 953] };
    const quadBbox = normalizeQuadOrRect(bbox1000, 1152, 2048);
    assert.strictEqual(quadBbox.length, 4);
    // 122/1000 * 1152 = 140.54 -> 141
    // 699/1000 * 1152 = 805.25 -> 805
    // 633/1000 * 2048 = 1296.38 -> 1296
    // 953/1000 * 2048 = 1951.74 -> 1952
    assert.ok(Math.abs(quadBbox[0].x - 141) <= 2, `X1 应接近 141, 实际为 ${quadBbox[0].x}`);
    assert.ok(Math.abs(quadBbox[0].y - 1296) <= 2, `Y1 应接近 1296, 实际为 ${quadBbox[0].y}`);
    assert.ok(Math.abs(quadBbox[2].x - 805) <= 2, `X2 应接近 805, 实际为 ${quadBbox[2].x}`);
    assert.ok(Math.abs(quadBbox[2].y - 1952) <= 2, `Y2 应接近 1952, 实际为 ${quadBbox[2].y}`);
    recordPass('F6: 归一化坐标转换与坐标系修复 (normalizeQuadOrRect)');
  } catch (err) {
    recordFail('F6: 归一化坐标转换与坐标系修复 (normalizeQuadOrRect)', err);
  }

  // --- F7: VLM 假成功抑制修复与别名映射扩展 ---
  try {
    const dummyImg = Buffer.from('dummy_image_data');

    // 1) 低置信度截断 (< 0.75) 必须标记 uncertain
    const lowConfVlm = async () => ({
      part: 'wall',
      material_family: 'paint',
      probability: 0.71
    });
    const lowRes = await classifyRegionPart(db, dummyImg, { chatVision: lowConfVlm });
    assert.strictEqual(lowRes.uncertain, true, '概率小于 0.75 时必须判定为 uncertain');
    assert.strictEqual(lowRes.part, null, '概率小于 0.75 时 part 应为 null 或不予采信');

    // 2) 别名映射扩展: armchair / couch / 单人沙发 应映射至 upholstery
    const aliasVlm = async () => ({
      part: 'armchair',
      material_family: 'leather',
      probability: 0.89
    });
    const aliasRes = await classifyRegionPart(db, dummyImg, { chatVision: aliasVlm });
    assert.strictEqual(aliasRes.uncertain, false);
    assert.strictEqual(aliasRes.part, 'upholstery', 'armchair 应别名归一化映射至 upholstery');
    assert.strictEqual(aliasRes.material_family, 'leather');

    // 3) 非法枚举拦截: spaceship 应被拦截
    const invalidVlm = async () => ({
      part: 'spaceship_thruster',
      material_family: 'metal',
      probability: 0.99
    });
    const invRes = await classifyRegionPart(db, dummyImg, { chatVision: invalidVlm });
    assert.strictEqual(invRes.uncertain, true, '非 8 大标准部位枚举必须置 uncertain: true');
    recordPass('F7: VLM 假成功抑制修复与别名映射扩展');
  } catch (err) {
    recordFail('F7: VLM 假成功抑制修复与别名映射扩展', err);
  }

  // --- F8: 空间几何启发式规则立体化重构 (3D 立体高度 ch 判定) ---
  try {
    // 典型单人电动沙发：位于下半区 (cy=0.793)，但具有显著立体高度 (ch=0.320 >= 0.18)，宽度适中 (cw=0.577 < 0.88)
    const sofaSpatial = await classifyRegionPart(db, null, {
      selection: {
        norm: { x: 0.122, y: 0.633, w: 0.577, h: 0.320 }
      }
    });
    assert.strictEqual(sofaSpatial.part, 'upholstery', '具备立体高度的下半区家具选区必须判定为 upholstery，绝不能被误判为 floor 或 wall');
    assert.strictEqual(sofaSpatial.recommended_category_id, 'mat_cat_leather', '沙发应推荐真皮 mat_cat_leather');

    // 典型天花：画面顶部 (cy < 0.22)
    const ceilingSpatial = await classifyRegionPart(db, null, {
      selection: {
        norm: { x: 0.1, y: 0.05, w: 0.8, h: 0.15 } // cy = 0.125 < 0.22
      }
    });
    assert.strictEqual(ceilingSpatial.part, 'ceiling', '顶部选区必须判定为 ceiling');

    // 典型扁平地面：位于画面极限下部且扁平 (ch < 0.20, cy > 0.82)
    const floorSpatial = await classifyRegionPart(db, null, {
      selection: {
        norm: { x: 0.05, y: 0.85, w: 0.9, h: 0.12 } // cy = 0.91, ch = 0.12
      }
    });
    assert.strictEqual(floorSpatial.part, 'floor', '极限底部扁平选区应判定为 floor');
    recordPass('F8: 空间几何启发式规则立体化重构 (立体高度 ch 与 cy 协同判定)');
  } catch (err) {
    recordFail('F8: 空间几何启发式规则立体化重构 (立体高度 ch 与 cy 协同判定)', err);
  }

  // --- F9: 选区切片与分类器自动化回归单点契约 ---
  try {
    // 1152x2048 选区参数回归验证
    const imgW = 1152;
    const imgH = 2048;
    const norm = { x: 122 / 1000, y: 633 / 1000, w: (699 - 122) / 1000, h: (953 - 633) / 1000 };
    const cy = norm.y + norm.h / 2;
    const ch = norm.h;
    const cw = norm.w;

    assert.ok(Math.abs(cy - 0.793) < 0.01, `计算 cy 应为 0.793, 实际为 ${cy.toFixed(3)}`);
    assert.ok(Math.abs(ch - 0.320) < 0.01, `计算 ch 应为 0.320, 实际为 ${ch.toFixed(3)}`);
    assert.ok(Math.abs(cw - 0.577) < 0.01, `计算 cw 应为 0.577, 实际为 ${cw.toFixed(3)}`);

    const regResult = await classifyRegionPart(db, null, {
      selection: { norm }
    });
    assert.notStrictEqual(regResult.part, 'wall', '决不能判定为 wall 墙面');
    assert.notStrictEqual(regResult.part, 'floor', '决不能判定为 floor 地面');
    assert.strictEqual(regResult.part, 'upholstery', '必须判定为 upholstery 沙发');
    recordPass('F9: 1152x2048 沙发选区自动化回归契约');
  } catch (err) {
    recordFail('F9: 1152x2048 沙发选区自动化回归契约', err);
  }

  // --- F10: 前端抽屉推荐基材与色卡数据对齐 ---
  try {
    const dict = getDictionary(db);
    assert.ok(dict.parts.some(p => p.id === 'upholstery'), '主字典必须包含 upholstery 部位');

    // 软体家具部位应可用皮革与布艺
    const uphDict = getDictionary(db, { part: 'upholstery' });
    const uphCatIds = uphDict.categories.map(c => c.id);
    assert.ok(uphCatIds.includes('mat_cat_leather'), 'upholstery 必须包含 mat_cat_leather');
    assert.ok(uphCatIds.includes('mat_cat_fabric_upholstery'), 'upholstery 必须包含 mat_cat_fabric_upholstery');

    // 智能识别结果联动核查
    const sofaClassify = await classifyRegionPart(db, null, {
      selection: { norm: { x: 0.2, y: 0.55, w: 0.4, h: 0.3 } }
    });
    assert.strictEqual(sofaClassify.recommended_category_id, 'mat_cat_leather');
    assert.ok(sofaClassify.default_swatch, 'default_swatch 必须存在');
    assert.strictEqual(sofaClassify.default_swatch.category_id, 'mat_cat_leather');
    assert.ok(sofaClassify.default_swatch.name_zh, '色卡中文名必须存在');
    recordPass('F10: 部位推荐基材品类与色卡数据对齐');
  } catch (err) {
    recordFail('F10: 部位推荐基材品类与色卡数据对齐', err);
  }

  // --- F11: 空间编辑器 3D 单品目录动态接口对接 ---
  try {
    const res = await invokeApi('GET', '/api/products/presets');
    assert.strictEqual(res.statusCode, 200);
    const presets = res.json.data || res.json;
    for (const item of presets) {
      assert.ok(item.id, '3D 模型预设必须包含 id');
      assert.ok(item.name, '3D 模型预设必须包含 name');
      assert.ok(item.preview_url, '3D 模型预设必须包含 preview_url');
      assert.ok(item.model_url, '3D 模型预设必须包含 model_url');
      assert.ok(typeof item.facing === 'number', '3D 模型预设必须包含数字 facing 角度');
    }
    recordPass('F11: 空间编辑器 3D 单品目录动态接口字段契约');
  } catch (err) {
    recordFail('F11: 空间编辑器 3D 单品目录动态接口字段契约', err);
  }

  // --- F12: 提示词编译器色卡查询兼容 id 与 code ---
  try {
    // 选取已有的色卡样本
    const sampleSwatch = db.prepare('SELECT * FROM ba_material_swatches WHERE enabled = 1 LIMIT 1').get();
    assert.ok(sampleSwatch, '数据库中必须存在色卡样本');

    // 1) 使用主键 ID 查询编译
    const resById = compileBaseAttributes(db, {
      regions: [
        {
          region_id: 'reg_id_lookup',
          part: 'upholstery',
          swatch_id: sampleSwatch.id
        }
      ]
    });
    assert.ok(resById.prompt.includes(sampleSwatch.name_zh), `按 id 查询时提示词应包含色卡名 ${sampleSwatch.name_zh}`);
    assert.strictEqual(resById.clauses[0].reference, null, '纯色色卡应走轨道 A');

    // 2) 若色卡具有业务编码 code，使用 code 兼容查询编译
    if (sampleSwatch.code) {
      const resByCode = compileBaseAttributes(db, {
        regions: [
          {
            region_id: 'reg_code_lookup',
            part: 'upholstery',
            swatch_id: sampleSwatch.code
          }
        ]
      });
      assert.ok(resByCode.prompt.includes(sampleSwatch.name_zh), `按 code (${sampleSwatch.code}) 兼容查询时提示词应包含色卡名 ${sampleSwatch.name_zh}`);
    }
    recordPass('F12: 提示词编译器色卡查询兼容 id 与 code');
  } catch (err) {
    recordFail('F12: 提示词编译器色卡查询兼容 id 与 code', err);
  }

  // --- F13: 字典外键与选区持久化字段补齐 ---
  try {
    const testImageKey = 'fid:asset_tier1_binding_test';
    const testPayload = {
      regions: [
        {
          region_id: 'reg_sofa_tier1',
          part: 'upholstery',
          category_id: 'mat_cat_leather',
          swatch_id: 'swatch_leather_saddle_brown',
          norm: { x: 0.12, y: 0.63, w: 0.58, h: 0.32 }
        }
      ],
      light_mode: 'upper_left',
      kelvin: 3500
    };

    putImageBindings(db, testImageKey, testPayload);
    const retrieved = getImageBindings(db, testImageKey);
    assert.strictEqual(retrieved.image_key, testImageKey);
    assert.strictEqual(retrieved.regions.length, 1);
    assert.strictEqual(retrieved.regions[0].part, 'upholstery');
    assert.strictEqual(retrieved.regions[0].category_id, 'mat_cat_leather');
    assert.strictEqual(retrieved.regions[0].swatch_id, 'swatch_leather_saddle_brown');
    assert.strictEqual(retrieved.light_mode, 'upper_left');
    assert.strictEqual(retrieved.kelvin, 3500);

    // 验证外键关联有效性
    const categoryExists = db.prepare('SELECT id FROM ba_material_categories WHERE id = ?').get('mat_cat_leather');
    assert.ok(categoryExists, '引用的 category_id 必须存在于 ba_material_categories');
    recordPass('F13: 字典外键与选区持久化字段补齐 (ba_image_bindings)');
  } catch (err) {
    recordFail('F13: 字典外键与选区持久化字段补齐 (ba_image_bindings)', err);
  }

  console.log(`\nTier 1 Finished: ${results.passed} Passed, ${results.failed} Failed\n`);

  // 清理本套件落盘物：POST snapshots 写 ML_DATA_DIR/previews 且镜像一份到仓 data/previews
  const _artifactNames = [
    'test_tier1_preset_armchair_front.png',
    'test_tier1_preset_armchair_right_45.png'
  ];
  const _artifactDirs = [
    path.join(_testDataDir, 'previews'),
    path.join(process.env.ML_DATA_DIR || _testDataDir, 'previews'),
    path.join(__dirname, '..', 'data', 'previews')
  ];
  for (const dir of _artifactDirs) {
    for (const f of _artifactNames) {
      try { fs.rmSync(path.join(dir, f), { force: true }); } catch {}
    }
  }
  // Windows 下 better-sqlite3 句柄不关闭会导致目录 rm 失败，先关库再清理
  try { db.close(); } catch {}
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(_testDataDir, { recursive: true, force: true }); } catch {}

  return results;
}

if (require.main === module) {
  runTier1Tests().then(res => {
    if (res.failed > 0) {
      console.error(`\n❌ Tier 1 测试存在 ${res.failed} 项失败！`);
      process.exitCode = 1;
    } else {
      console.log('\n🎉 Tier 1 所有单点特性测试全部通过！');
      process.exitCode = 0;
    }
  }).catch(e => {
    console.error('Tier 1 异常崩溃:', e);
    process.exitCode = 1;
  });
}

module.exports = { runTier1Tests };
