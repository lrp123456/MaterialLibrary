/**
 * Tier 3: 跨模块联动与接口契约组合测试 (Cross-Feature Combinations Suite)
 * 验证改表皮与空间编辑主链路跨组件深度端到端集成：
 * - Pipeline 1: 选区框选 -> 归一化坐标转换 -> 切片裁切 -> 部位识别分类 -> 抽屉基材推荐与色卡对齐 -> 提示词编译生成
 * - Pipeline 2: 空间多部位共存 (地面木地板 + 墙面乳胶漆 + 沙发皮革) 多轨道提示词与参考图协同编译
 * - Pipeline 3: 3D 选品库模型上架 -> 快照即时持久化 -> 空间编辑层目录查询与场景绑定联动
 */

const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const sharp = require('sharp');

// 把服务端数据目录（快照/缓存落盘）重定向到独立临时目录，杜绝污染生产 ~/.dsh-material-library
const _testDataDir = path.join(os.tmpdir(), 'dsh_tier3_mldata_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
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

// 全局外网熔断：分类主链路在 VLM 未配置时会降级到默认开启的 JEV，测试必须全部走几何/注入 mock
globalThis.fetch = async () => {
  throw new Error('unexpected real network fetch in tier3 unit test');
};

function createTestContext() {
  const testDir = path.join(os.tmpdir(), 'dsh_tier3_test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(testDir, { recursive: true });
  const db = openDb(testDir);
  ensureBaseLibrarySchema(db);
  seedMasterDictionary(db);

  db.prepare(`
    INSERT OR REPLACE INTO sessions (token, user_id, role, expires_at)
    VALUES (?, ?, ?, ?)
  `).run('test-tier3-token', 1, 'admin', Date.now() + 86400000);

  const mockServices = { db, config: {}, interpreter: null };

  function invokeApi(method, reqPath, body = null, userToken = 'test-tier3-token') {
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

async function runTier3Tests() {
  const results = {
    tier: 3,
    name: 'Tier 3 - Cross-Feature Combinations',
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
  console.log('🚀 Running Tier 3: Cross-Feature Integration Suites');
  console.log('======================================================\n');

  // --- Pipeline 1: 单人电动沙发全链路主流程验证 ---
  try {
    // 步骤 1: 准备 1152 x 2048 底图与沙发 0~1000 归一化选区
    const baseW = 1152;
    const baseH = 2048;
    const baseImg = await sharp({
      create: { width: baseW, height: baseH, channels: 3, background: { r: 215, g: 210, b: 205 } }
    }).jpeg().toBuffer();

    // 用户在画布框选: <bbox>122 633 699 953</bbox>
    const rawBox = [122, 633, 699, 953];
    const normSel = {
      type: 'rect',
      norm: {
        x: rawBox[0] / 1000,
        y: rawBox[1] / 1000,
        w: (rawBox[2] - rawBox[0]) / 1000,
        h: (rawBox[3] - rawBox[1]) / 1000
      }
    };

    // 步骤 2: 坐标换算 (normalizeQuadOrRect)
    const quad = normalizeQuadOrRect(
      { rect: [normSel.norm.x, normSel.norm.y, normSel.norm.w, normSel.norm.h], unit: 'fraction' },
      baseW,
      baseH
    );
    assert.strictEqual(quad.length, 4, '规格化应返回 4 个顶点');
    const minX = Math.min(...quad.map(p => p.x));
    const maxX = Math.max(...quad.map(p => p.x));
    const minY = Math.min(...quad.map(p => p.y));
    const maxY = Math.max(...quad.map(p => p.y));
    assert.ok(Math.abs(minX - 141) <= 2, `切片起始 X 应接近 141, 实际 ${minX}`);
    assert.ok(Math.abs(minY - 1296) <= 2, `切片起始 Y 应接近 1296, 实际 ${minY}`);

    // 步骤 3: 内部精准裁切 (cropSelectionInterior)
    const cropBuffer = await cropSelectionInterior(baseImg, normSel);
    assert.ok(Buffer.isBuffer(cropBuffer), '切片必须输出有效图像 Buffer');
    const cropMeta = await sharp(cropBuffer).metadata();
    assert.strictEqual(cropMeta.format, 'jpeg', '切片格式必须为 JPEG');
    const cropAr = cropMeta.width / cropMeta.height;
    const expectedAr = (maxX - minX) / (maxY - minY);
    assert.ok(Math.abs(cropAr - expectedAr) < 0.05, `切片长宽比 (${cropAr.toFixed(3)}) 应与选区 (${expectedAr.toFixed(3)}) 严格一致`);

    // 步骤 4: 部位分类与基材推荐 (classifyRegionPart)
    // 模拟 VLM/空间几何判断沙发
    const classifyRes = await classifyRegionPart(db, cropBuffer, {
      selection: normSel
    });
    assert.strictEqual(classifyRes.uncertain, false, '沙发选区必须获得确定性判定');
    assert.strictEqual(classifyRes.part, 'upholstery', '部位必须识别为 upholstery');
    assert.strictEqual(classifyRes.recommended_category_id, 'mat_cat_leather', '推荐基材品类必须为 mat_cat_leather');
    assert.ok(classifyRes.default_swatch, 'default_swatch 必须存在');
    assert.strictEqual(classifyRes.default_swatch.category_id, 'mat_cat_leather');

    // 步骤 5: 材质抽屉契约对齐 (ResurfaceDrawer Contract)
    const drawerDict = getDictionary(db, { part: classifyRes.part });
    const allowedCats = drawerDict.categories.map(c => c.id);
    assert.ok(allowedCats.includes(classifyRes.recommended_category_id), '抽屉允许品类中必须包含推荐基材品类');
    const leatherSwatches = drawerDict.swatches[classifyRes.recommended_category_id] || [];
    assert.ok(leatherSwatches.length >= 3, '推荐真皮品类色卡储备必须 >= 3');

    // 步骤 6: 提示词编译器编译 (compileBaseAttributes)
    const activeSwatch = classifyRes.default_swatch;
    const compileRes = compileBaseAttributes(db, {
      regions: [
        {
          region_id: 'reg_sofa_main',
          part: classifyRes.part,
          swatch_id: activeSwatch.id,
          bbox: { x1: rawBox[0], y1: rawBox[1], x2: rawBox[2], y2: rawBox[3] }
        }
      ]
    });
    assert.strictEqual(compileRes.clauses.length, 1);
    assert.ok(compileRes.prompt.includes('软体沙发') || compileRes.prompt.includes('沙发'), '提示词中应包含沙发部位描述');
    assert.ok(compileRes.prompt.includes(activeSwatch.name_zh), `提示词中必须包含色卡名称 ${activeSwatch.name_zh}`);
    assert.ok(compileRes.prompt.includes('保持原有结构体积与光影'), '必须包含沙发保形约束句');

    // 步骤 7: 持久化价签存储与查询回显 (ba_image_bindings)
    const sceneKey = 'fid:asset_living_sofa_e2e';
    putImageBindings(db, sceneKey, {
      regions: [
        {
          region_id: 'reg_sofa_main',
          part: classifyRes.part,
          category_id: classifyRes.recommended_category_id,
          swatch_id: activeSwatch.id,
          norm: normSel.norm
        }
      ]
    });
    const savedBindings = getImageBindings(db, sceneKey);
    assert.strictEqual(savedBindings.image_key, sceneKey);
    assert.strictEqual(savedBindings.regions[0].part, 'upholstery');
    assert.strictEqual(savedBindings.regions[0].swatch_id, activeSwatch.id);

    recordPass('Pipeline 1: 沙发选区切片 -> 识别 -> 抽屉基材推荐 -> 提示词编译 -> 价签持久化全链路');
  } catch (err) {
    recordFail('Pipeline 1: 沙发选区切片 -> 识别 -> 抽屉基材推荐 -> 提示词编译 -> 价签持久化全链路', err);
  }

  // --- Pipeline 2: 多部位空间共存多轨道编译 (地面木地板 + 墙面乳胶漆 + 沙发真皮) ---
  try {
    // 准备 3 种不同部位的色卡:
    // 1) 地面木地板 (纹理材质，Track B，需引用参考图)
    const woodFloorSwatch = db.prepare(`
      SELECT * FROM ba_material_swatches WHERE category_id = 'mat_cat_wood_floor' AND enabled = 1 LIMIT 1
    `).get();
    assert.ok(woodFloorSwatch, '必须存在木地板色卡');

    // 2) 墙面乳胶漆 (纯色，Track A，无参考图)
    const latexSwatch = db.prepare(`
      SELECT * FROM ba_material_swatches WHERE category_id = 'mat_cat_latex' AND enabled = 1 LIMIT 1
    `).get();
    assert.ok(latexSwatch, '必须存在乳胶漆色卡');

    // 3) 沙发真皮 (纯色/微质感，Track A)
    const leatherSwatch = db.prepare(`
      SELECT * FROM ba_material_swatches WHERE category_id = 'mat_cat_leather' AND enabled = 1 LIMIT 1
    `).get();
    assert.ok(leatherSwatch, '必须存在真皮色卡');

    const multiRegions = [
      {
        region_id: 'r_floor',
        part: 'floor',
        swatch_id: woodFloorSwatch.id,
        bbox: { x1: 0, y1: 800, x2: 999, y2: 999 }
      },
      {
        region_id: 'r_wall',
        part: 'wall',
        swatch_id: latexSwatch.id,
        bbox: { x1: 0, y1: 100, x2: 999, y2: 600 }
      },
      {
        region_id: 'r_sofa',
        part: 'upholstery',
        swatch_id: leatherSwatch.id,
        bbox: { x1: 150, y1: 500, x2: 850, y2: 850 }
      }
    ];

    const multiCompile = compileBaseAttributes(db, {
      regions: multiRegions,
      firstRefIndex: 1,
      maxRefs: 3
    });

    assert.strictEqual(multiCompile.clauses.length, 3, '应生成 3 个选区编译子句');

    // 验证木地板子句包含纹理对齐
    const floorClause = multiCompile.clauses.find(c => c.region_id === 'r_floor');
    assert.ok(floorClause, '应包含地面子句');
    if (woodFloorSwatch.item_type !== 'solid_color') {
      assert.strictEqual(floorClause.track, 'B', '纹理木地板必须走轨道 B');
      assert.ok(floorClause.reference !== null, '轨道 B 必须附带 reference 引用');
    }

    // 验证乳胶漆与真皮走轨道 A，无单独贴图
    const wallClause = multiCompile.clauses.find(c => c.region_id === 'r_wall');
    assert.strictEqual(wallClause.track, 'A', '纯色乳胶漆应走轨道 A');
    assert.strictEqual(wallClause.reference, null);

    const sofaClause = multiCompile.clauses.find(c => c.region_id === 'r_sofa');
    assert.strictEqual(sofaClause.track, 'A', '标准真皮色卡走轨道 A');

    // 验证提示词整体无部位白名单拦截警告
    assert.ok(!multiCompile.warnings.some(w => w.includes('part_asset_rejected')), '合法部位品类组合绝不能触发 part_asset_rejected');
    recordPass('Pipeline 2: 地面/墙面/沙发多部位共存与双轨道参考图协同编译');
  } catch (err) {
    recordFail('Pipeline 2: 地面/墙面/沙发多部位共存与双轨道参考图协同编译', err);
  }

  // --- Pipeline 3: 3D 选品库模型上架 -> 快照即时持久化 -> 空间编辑层集成 ---
  try {
    const presetId = 'preset_nordic_chair_cross';
    // 1) 管理员上传/保存 3D 单品
    const createRes = await invokeApi('PUT', `/api/products/presets/${presetId}`, {
      name: '北欧极简单人扶手椅',
      category: 'furniture',
      facing: 180,
      tags: ['单人椅', '实木', '北欧极简'],
      dimensions: { width: 800, depth: 850, height: 780 }
    });
    assert.strictEqual(createRes.statusCode, 200);

    // 2) 客户端 <model-viewer> 提取三视角快照并提交持久化
    const fakeDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const snapshotPayload = {
      snapshots: {
        front: fakeDataUri,
        right_45: fakeDataUri,
        top: fakeDataUri
      }
    };
    const snapRes = await invokeApi('POST', `/api/products/presets/${presetId}/snapshots`, snapshotPayload);
    assert.strictEqual(snapRes.statusCode, 200);

    // 3) 空间编辑器获取 3D 单品目录
    const listRes = await invokeApi('GET', '/api/products/presets');
    assert.strictEqual(listRes.statusCode, 200);
    const presets = listRes.json.data || listRes.json;
    const target = presets.find(p => p.id === presetId);
    assert.ok(target, '新创建的 3D 单品必须立即可在目录中查询');
    assert.ok(target.snapshots?.front || target.snapshots?.right_45, '快照必须在返回结果中包含');
    assert.ok(target.model_url.includes(presetId) || target.model_url.includes('glb'), 'model_url 应有效指向 GLB 资源');

    // 4) 模拟空间编辑层保存包含该 3D 单品的空间绑定
    const studioKey = 'fid:asset_studio_3d_integration';
    putImageBindings(db, studioKey, {
      regions: [],
      objects_3d: [
        {
          preset_id: presetId,
          x: 0.5,
          y: 0.7,
          scale: 1.0,
          rotation_y: 180
        }
      ]
    });
    const studioBindings = getImageBindings(db, studioKey);
    assert.strictEqual(studioBindings.image_key, studioKey);

    // 清理测试单品
    await invokeApi('DELETE', `/api/products/presets/${presetId}`);
    recordPass('Pipeline 3: 3D 选品库模型上架 -> 快照即时持久化 -> 空间编辑层集成');
  } catch (err) {
    recordFail('Pipeline 3: 3D 选品库模型上架 -> 快照即时持久化 -> 空间编辑层集成', err);
  }

  console.log(`\nTier 3 Finished: ${results.passed} Passed, ${results.failed} Failed\n`);

  // 清理本套件落盘物：POST snapshots 写 ML_DATA_DIR/previews 且镜像一份到仓 data/previews
  const _artifactNames = [
    'preset_nordic_chair_cross_front.png',
    'preset_nordic_chair_cross_right_45.png',
    'preset_nordic_chair_cross_top.png'
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
  try { db.close(); } catch {}
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(_testDataDir, { recursive: true, force: true }); } catch {}

  return results;
}

if (require.main === module) {
  runTier3Tests().then(res => {
    if (res.failed > 0) {
      console.error(`\n❌ Tier 3 测试存在 ${res.failed} 项失败！`);
      process.exitCode = 1;
    } else {
      console.log('\n🎉 Tier 3 所有跨模块组合集成测试全部通过！');
      process.exitCode = 0;
    }
  }).catch(e => {
    console.error('Tier 3 异常崩溃:', e);
    process.exitCode = 1;
  });
}

module.exports = { runTier3Tests };
