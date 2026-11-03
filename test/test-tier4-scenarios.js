/**
 * Tier 4: 真实业务场景全链路测试套件 (Real-World Application Scenarios)
 * 基于 ORIGINAL_REQUEST.md 与 TEST_INFRA.md 真实室内空间 5 大业务场景：
 * - Scenario 1: 竖屏 1152x2048 客餐厅底图框选白色单人电动沙发 (精准裁切与防误判为墙面/地面)
 * - Scenario 2: 横屏主卧场景木地板与背景墙边界精准判定
 * - Scenario 3: 3D 单品家具库卡片展示、上传烘焙快照与数据持久化
 * - Scenario 4: 空间编辑层选品替换与改表皮提示词编译 (兼容 id 与 code 查询)
 * - Scenario 5: VLM 故障与网络超时降级兜底 (无缝降级至空间几何启发式规则)
 */

const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const sharp = require('sharp');

// 把服务端数据目录（快照/缓存落盘）重定向到独立临时目录，杜绝污染生产 ~/.dsh-material-library
const _testDataDir = path.join(os.tmpdir(), 'dsh_tier4_mldata_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
process.env.ML_DATA_DIR = _testDataDir;
fs.mkdirSync(_testDataDir, { recursive: true });

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { seedMasterDictionary } = require('../src/base-library/master-dictionary-seed');
const { getDictionary } = require('../src/base-library/dictionary-routes');
const { classifyRegionPart } = require('../src/base-library/classify-part');
const { cropSelectionInterior, normalizeQuadOrRect } = require('../src/handlers/image-ops');
const { compileBaseAttributes } = require('../src/base-library/compile');
const { handleApi } = require('../src/api');

// 全局外网熔断：S1/S5 的 VLM 缺省与超时用例会降级到默认开启的 JEV，必须拦在本机
globalThis.fetch = async () => {
  throw new Error('unexpected real network fetch in tier4 unit test');
};

function createTestContext() {
  const testDir = path.join(os.tmpdir(), 'dsh_tier4_test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(testDir, { recursive: true });
  const db = openDb(testDir);
  ensureBaseLibrarySchema(db);
  seedMasterDictionary(db);

  db.prepare(`
    INSERT OR REPLACE INTO sessions (token, user_id, role, expires_at)
    VALUES (?, ?, ?, ?)
  `).run('test-tier4-token', 1, 'admin', Date.now() + 86400000);

  const mockServices = { db, config: {}, interpreter: null };

  function invokeApi(method, reqPath, body = null, userToken = 'test-tier4-token') {
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

async function runTier4Tests() {
  const results = {
    tier: 4,
    name: 'Tier 4 - Real-World Application Scenarios',
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
  console.log('🚀 Running Tier 4: Real-World Scenarios (S1 ~ S5)');
  console.log('======================================================\n');

  // --- Scenario 1: 竖屏 1152x2048 客餐厅底图框选白色单人电动沙发 ---
  try {
    const imgW = 1152;
    const imgH = 2048;
    const sofaScene = await sharp({
      create: { width: imgW, height: imgH, channels: 3, background: { r: 230, g: 228, b: 220 } }
    }).jpeg().toBuffer();

    // 框选参数: <bbox>122 633 699 953</bbox>
    const rawBbox = [122, 633, 699, 953];
    const normSel = {
      type: 'rect',
      norm: {
        x: rawBbox[0] / 1000,
        y: rawBbox[1] / 1000,
        w: (rawBbox[2] - rawBbox[0]) / 1000,
        h: (rawBbox[3] - rawBbox[1]) / 1000
      }
    };

    // 1) 验证切片坐标与像素对应
    const crop = await cropSelectionInterior(sofaScene, normSel);
    assert.ok(Buffer.isBuffer(crop));
    const cropMeta = await sharp(crop).metadata();
    assert.strictEqual(cropMeta.format, 'jpeg');
    const arActual = cropMeta.width / cropMeta.height;
    const arExpected = (normSel.norm.w * imgW) / (normSel.norm.h * imgH); // (0.577 * 1152) / (0.320 * 2048) = 1.014
    assert.ok(Math.abs(arActual - arExpected) < 0.05, `物理像素长宽比保持一致: ${arActual.toFixed(3)} vs ${arExpected.toFixed(3)}`);

    // 2) 验证智能分类判断: 绝对不能是 wall 或 floor
    const classifyRes = await classifyRegionPart(db, crop, {
      selection: normSel
    });
    assert.notStrictEqual(classifyRes.part, 'wall', '严重缺陷拦截：下半区沙发选区绝不能识别为 wall (墙面)');
    assert.notStrictEqual(classifyRes.part, 'floor', '严重缺陷拦截：立体高度 ch=0.32 的沙发绝不能识别为 floor (地面)');
    assert.strictEqual(classifyRes.part, 'upholstery', '必须精准识别为 upholstery (软体家具)');
    assert.strictEqual(classifyRes.recommended_category_id, 'mat_cat_leather', '单人电动沙发首选推荐真皮品类');
    assert.ok(classifyRes.default_swatch, '必须返回默认推荐色卡');
    assert.strictEqual(classifyRes.default_swatch.category_id, 'mat_cat_leather');

    recordPass('Scenario 1: 竖屏 1152x2048 客餐厅沙发选区识别为 upholstery/leather (拒绝误判为墙/地)');
  } catch (err) {
    recordFail('Scenario 1: 竖屏 1152x2048 客餐厅沙发选区识别为 upholstery/leather (拒绝误判为墙/地)', err);
  }

  // --- Scenario 2: 横屏主卧场景木地板与背景墙边界精准判定 ---
  try {
    const imgW = 1920;
    const imgH = 1080;

    // 选区 A: 底部贴地木地板 (扁平、靠底 cy=0.88, ch=0.14, cw=0.85)
    const floorSel = {
      norm: { x: 0.05, y: 0.81, w: 0.85, h: 0.14 } // cy = 0.88
    };
    const floorRes = await classifyRegionPart(db, null, { selection: floorSel });
    assert.strictEqual(floorRes.part, 'floor', '卧室底部大面积扁平区域必须识别为 floor');
    assert.strictEqual(floorRes.recommended_category_id, 'mat_cat_wood_floor', '地面应推荐木地板');

    // 选区 B: 顶部/中部大面积垂直墙面 (大面积主背景墙 cw=0.90, ch=0.55, cy=0.40)
    const wallSel = {
      norm: { x: 0.05, y: 0.12, w: 0.90, h: 0.55 } // cy = 0.395, cw >= 0.88
    };
    const wallRes = await classifyRegionPart(db, null, { selection: wallSel });
    assert.strictEqual(wallRes.part, 'wall', '中上部垂直大面积主背景墙必须识别为 wall');
    assert.ok(['mat_cat_latex', 'mat_cat_art_plaster'].includes(wallRes.recommended_category_id), '墙面应推荐乳胶漆或艺术涂料');

    recordPass('Scenario 2: 横屏主卧场景木地板 (floor) 与背景墙 (wall) 边界精准区分');
  } catch (err) {
    recordFail('Scenario 2: 横屏主卧场景木地板 (floor) 与背景墙 (wall) 边界精准区分', err);
  }

  // --- Scenario 3: 3D 单品家具库卡片展示、上传烘焙快照与数据持久化 ---
  try {
    // 1) 验证现有预设列表与卡片数据
    const listRes = await invokeApi('GET', '/api/products/presets');
    assert.strictEqual(listRes.statusCode, 200);
    const presets = listRes.json.data || listRes.json;
    const electricSofa = presets.find(p => p.id === 'sofa_electric_single');
    assert.ok(electricSofa, '必须包含沙发预设');
    assert.ok(!electricSofa.preview_url.includes('undefined'), 'preview_url 必须合法');

    // 2) 模拟上传新 3D 模型
    const newPresetId = 'scenario3_nordic_sofa';
    const putRes = await invokeApi('PUT', `/api/products/presets/${newPresetId}`, {
      name: '意式极简三人真皮沙发',
      category: 'furniture',
      facing: 45,
      tags: ['三人位', '意式极简', '头层牛皮']
    });
    assert.strictEqual(putRes.statusCode, 200);

    // 3) 模拟前端利用 <model-viewer> 提取渲染快照并持久化
    const fakeDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const snapRes = await invokeApi('POST', `/api/products/presets/${newPresetId}/snapshots`, {
      snapshots: {
        front: fakeDataUri,
        right_45: fakeDataUri
      }
    });
    assert.strictEqual(snapRes.statusCode, 200);

    // 4) 重新拉取列表验证快照有效性
    const reList = await invokeApi('GET', '/api/products/presets');
    const updated = (reList.json.data || reList.json).find(p => p.id === newPresetId);
    assert.ok(updated, '新创建的模型预设应可查询');
    assert.ok(updated.snapshots?.right_45 || updated.snapshots?.front, '新模型的渲染快照已成功持久化并返回');

    // 清理
    await invokeApi('DELETE', `/api/products/presets/${newPresetId}`);
    recordPass('Scenario 3: 3D 单品库卡片渲染快照与新模型即时快照持久化闭环');
  } catch (err) {
    recordFail('Scenario 3: 3D 单品库卡片渲染快照与新模型即时快照持久化闭环', err);
  }

  // --- Scenario 4: 空间编辑层选品替换与改表皮提示词编译 (兼容 id 与 code) ---
  try {
    // 获取带有编码的色卡
    const sampleSwatch = db.prepare(`
      SELECT * FROM ba_material_swatches WHERE enabled = 1 AND code IS NOT NULL LIMIT 1
    `).get();
    assert.ok(sampleSwatch, '必须存在带编码的色卡样本');

    // 使用色卡业务编码 (code) 作为入参编译提示词
    const compileRes = compileBaseAttributes(db, {
      regions: [
        {
          region_id: 'reg_sofa_code_test',
          part: 'upholstery',
          swatch_id: sampleSwatch.code, // 传入业务 code (如 LTH-SaddleBrown)
          bbox: { x1: 122, y1: 633, x2: 699, y2: 953 }
        }
      ]
    });

    assert.ok(compileRes.prompt.includes(sampleSwatch.name_zh), `提示词应成功匹配并包含色卡名称 ${sampleSwatch.name_zh}`);
    assert.ok(compileRes.prompt.includes(sampleSwatch.code), `提示词应包含色卡编码 ${sampleSwatch.code}`);
    assert.ok(!compileRes.warnings.some(w => w.includes('texture_missing')), '不应产生材质贴图丢失警告');

    recordPass('Scenario 4: 空间编辑层选品改表皮提示词编译 (兼容色卡 id 与 code 查询)');
  } catch (err) {
    recordFail('Scenario 4: 空间编辑层选品改表皮提示词编译 (兼容色卡 id 与 code 查询)', err);
  }

  // --- Scenario 5: VLM 故障与网络超时降级兜底 ---
  try {
    const dummyImg = Buffer.from('test_image_payload');

    // 模拟远程 VLM 超时与网络中断
    const mockTimeoutVision = async () => {
      throw new Error('ETIMEDOUT: VLM service connection timeout after 15000ms');
    };

    // 系统在 VLM 超时不可用时，无缝降级至空间几何启发式规则，平稳输出合理分类与基材
    const fallbackRes = await classifyRegionPart(db, dummyImg, {
      chatVision: mockTimeoutVision,
      selection: {
        norm: { x: 0.15, y: 0.60, w: 0.50, h: 0.30 } // 沙发区域
      }
    });

    assert.ok(fallbackRes, '降级调用必须安全返回对象');
    assert.strictEqual(fallbackRes.uncertain, false, '降级至 Level 3 空间几何规则后必须给出确定性建议');
    assert.strictEqual(fallbackRes.part, 'upholstery', '沙发几何选区降级后仍精准识别为 upholstery');
    assert.strictEqual(fallbackRes.recommended_category_id, 'mat_cat_leather', '降级后仍能给出建议基材');
    assert.ok(fallbackRes.confidence >= 0.8, '降级建议置信度应保持在合理范围 (>= 0.8)');

    recordPass('Scenario 5: VLM 服务超时中断时无缝平滑降级至空间启发式规则');
  } catch (err) {
    recordFail('Scenario 5: VLM 服务超时中断时无缝平滑降级至空间启发式规则', err);
  }

  console.log(`\nTier 4 Finished: ${results.passed} Passed, ${results.failed} Failed\n`);

  // 清理本套件落盘物：POST snapshots 写 ML_DATA_DIR/previews 且镜像一份到仓 data/previews
  const _artifactNames = [
    'scenario3_nordic_sofa_front.png',
    'scenario3_nordic_sofa_right_45.png'
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
  runTier4Tests().then(res => {
    if (res.failed > 0) {
      console.error(`\n❌ Tier 4 测试存在 ${res.failed} 项失败！`);
      process.exitCode = 1;
    } else {
      console.log('\n🎉 Tier 4 所有真实业务场景测试用例全部通过！');
      process.exitCode = 0;
    }
  }).catch(e => {
    console.error('Tier 4 异常崩溃:', e);
    process.exitCode = 1;
  });
}

module.exports = { runTier4Tests };
