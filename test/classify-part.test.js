/**
 * Stage 3 单元测试：classifyRegionPart 封闭 JSON 分类器与 JEV 回退门禁
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const testDir = path.join(os.tmpdir(), 'dsh_classify_part_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { setFlag } = require('../src/base-library/list');
const { classifyRegionPart } = require('../src/base-library/classify-part');

const db = openDb(testDir);
ensureBaseLibrarySchema(db);

// 全局外网熔断：任何忘记注入 fetch 的分支一旦真打网络，立即以明确错误失败
const _origGlobalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('unexpected real network fetch in classify-part unit test');
};

async function runTests() {
  const fakeBuf = Buffer.from('fake_image_bytes');
  // 单元测试铁律：绝不允许真实外网 JEV 调用（即使走到该分支也立即失败）
  const fetchDisabled = async () => { throw new Error('network disabled in unit test'); };

  console.log('=== 1. 测试 VLM 正常识别 (upholstery, leather, 0.88) ===');
  const mockVlmOk = async () => ({
    part: 'upholstery',
    material_family: 'leather',
    probability: 0.88
  });
  const resOk = await classifyRegionPart(db, fakeBuf, { chatVision: mockVlmOk });
  assert.strictEqual(resOk.uncertain, false);
  assert.strictEqual(resOk.part, 'upholstery');
  assert.strictEqual(resOk.material_family, 'leather');
  assert.strictEqual(resOk.surface, 'furniture');
  console.log('✅ 正常 VLM 封闭 JSON 识别通过');

  console.log('=== 2. 测试置信度不足门槛 (< 0.75) 判定为 uncertain ===');
  const mockVlmLowProb = async () => ({
    part: 'wall',
    material_family: 'paint',
    probability: 0.74
  });
  const resLow = await classifyRegionPart(db, fakeBuf, { chatVision: mockVlmLowProb });
  assert.strictEqual(resLow.uncertain, true);
  assert.strictEqual(resLow.part, null);
  console.log('✅ 0.74 置信度截断拦截通过');

  console.log('=== 3. 测试非法部位枚举拦截 ===');
  const mockVlmBadPart = async () => ({
    part: 'spaceship_hull',
    material_family: 'metal',
    probability: 0.99
  });
  const resBad = await classifyRegionPart(db, fakeBuf, { chatVision: mockVlmBadPart });
  assert.strictEqual(resBad.uncertain, true);
  assert.strictEqual(resBad.part, null);
  console.log('✅ 非法部位枚举拦截通过');

  console.log('=== 4. 测试 JEV 回退：遇到 furniture / soft 智能预选 upholstery 软体家具 ===');
  process.env.TYPESAFE_API_KEY = 'test_jev_key_for_unit_test';
  setFlag(db, 'base_library_jev', 1);

  // 模拟 VLM 报错，降级至 JEV
  const mockVlmFail = async () => { throw new Error('VLM endpoint error'); };

  const mockFetchFurniture = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'jev-1.14.0',
      answers: {
        surface: {
          choice: 'furniture',
          probabilities: { furniture: 0.95 },
          confidence: 0.90
        }
      }
    })
  });
  const resJevFurn = await classifyRegionPart(db, fakeBuf, {
    chatVision: mockVlmFail,
    fetch: mockFetchFurniture
  });
  assert.strictEqual(resJevFurn.uncertain, false, 'JEV 返回 furniture 时智能预选沙发 upholstery，彻底告别空白待确认');
  assert.strictEqual(resJevFurn.part, 'upholstery');
  assert.strictEqual(resJevFurn.material_family, 'leather');
  assert.ok(resJevFurn.alternatives.includes('hard_furniture'));

  const mockFetchSoft = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'jev-1.14.0',
      answers: {
        surface: {
          choice: 'soft',
          probabilities: { soft: 0.92 },
          confidence: 0.88
        }
      }
    })
  });
  const resJevSoft = await classifyRegionPart(db, fakeBuf, {
    chatVision: mockVlmFail,
    fetch: mockFetchSoft
  });
  assert.strictEqual(resJevSoft.uncertain, false, 'JEV 返回 soft 时智能预选布艺软包 upholstery');
  assert.strictEqual(resJevSoft.part, 'upholstery');
  assert.strictEqual(resJevSoft.material_family, 'fabric');

  console.log('=== 5. 测试 JEV 回退：明确装修面 (如 ceiling) 正常映射 ===');
  const mockFetchCeiling = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'jev-1.14.0',
      answers: {
        surface: {
          choice: 'ceiling',
          probabilities: { ceiling: 0.96 },
          confidence: 0.95
        }
      }
    })
  });
  const resJevCeiling = await classifyRegionPart(db, fakeBuf, {
    chatVision: mockVlmFail,
    fetch: mockFetchCeiling
  });
  assert.strictEqual(resJevCeiling.uncertain, false);
  assert.strictEqual(resJevCeiling.part, 'ceiling');
  assert.strictEqual(resJevCeiling.surface, 'ceiling');
  console.log('=== 6. 回归测试：1152x2048 下 <bbox>122 633 699 953</bbox> 沙发空间几何启发式判定 ===');
  // 选区: x 122~699 (cw=0.577), y 633~953 (ch=0.320, cy=0.793)
  const sofaBboxTag = '<bbox>122 633 699 953</bbox>';
  const resSofaTag = await classifyRegionPart(db, null, { selection: sofaBboxTag });
  assert.strictEqual(resSofaTag.uncertain, false, '空间几何必须直接给出明确置信判定');
  assert.strictEqual(resSofaTag.part, 'upholstery', '沙发绝对不得被识别为 wall 或 floor');
  assert.strictEqual(resSofaTag.surface, 'furniture');
  assert.strictEqual(resSofaTag.material_family, 'leather');
  assert.strictEqual(resSofaTag.recommended_category_id, 'mat_cat_leather', '推荐基材品类必须为真皮');
  assert.strictEqual(resSofaTag.model, 'heuristic_spatial_upholstery');
  assert.ok(resSofaTag.probability >= 0.85);
  assert.notStrictEqual(resSofaTag.part, 'wall');
  assert.notStrictEqual(resSofaTag.part, 'floor');

  const resSofaNorm = await classifyRegionPart(db, null, {
    selection: { norm: { x: 0.122, y: 0.633, w: 0.577, h: 0.320 } }
  });
  assert.strictEqual(resSofaNorm.part, 'upholstery');
  assert.strictEqual(resSofaNorm.recommended_category_id, 'mat_cat_leather');
  console.log('✅ 1152x2048 下 <bbox>122 633 699 953</bbox> 几何判定沙发通过 (杜绝误判 wall/floor)');

  console.log('=== 7. 回归测试：VLM 别名扩展映射至 upholstery ===');
  const sofaAliases = [
    'armchair', 'recliner', 'single_sofa', 'electric_sofa', 'couch',
    '单人沙发', '电动沙发', '沙发椅', 'sofa'
  ];
  for (const alias of sofaAliases) {
    const mockVlmAlias = async () => ({
      part: alias,
      material_family: 'leather',
      probability: 0.91
    });
    const resAlias = await classifyRegionPart(db, fakeBuf, { chatVision: mockVlmAlias });
    assert.strictEqual(resAlias.uncertain, false, `别名 ${alias} 必须正常置信`);
    assert.strictEqual(resAlias.part, 'upholstery', `别名 ${alias} 必须正确映射为 upholstery`);
    assert.strictEqual(resAlias.surface, 'furniture');
  }
  console.log('✅ 常见软体家具别名扩展全量测试通过');

  console.log('=== 8. 回归测试：VLM 假成功修复与平滑降级（Graceful Fallback）===');
  // 8a: VLM 返回 null 时，第 134 行不再假成功，平滑降级进入 Level 3 几何规则
  const mockVlmNull = async () => ({
    part: null,
    material_family: 'unknown',
    probability: 0.0
  });
  const resFallbackNull = await classifyRegionPart(db, fakeBuf, {
    chatVision: mockVlmNull,
    fetch: fetchDisabled,
    selection: sofaBboxTag
  });
  assert.strictEqual(resFallbackNull.uncertain, false, '降级至几何兜底必须成功给出品类');
  assert.strictEqual(resFallbackNull.part, 'upholstery');
  assert.strictEqual(resFallbackNull.recommended_category_id, 'mat_cat_leather');
  assert.strictEqual(resFallbackNull.model, 'heuristic_spatial_upholstery');

  // 8b: VLM 返回低置信度（如 0.60 的误判墙面），被截断后平滑降级至沙发几何兜底
  const mockVlmLowWall = async () => ({
    part: 'wall',
    material_family: 'paint',
    probability: 0.60
  });
  const resFallbackLow = await classifyRegionPart(db, fakeBuf, {
    chatVision: mockVlmLowWall,
    fetch: fetchDisabled,
    selection: sofaBboxTag
  });
  assert.strictEqual(resFallbackLow.uncertain, false);
  assert.strictEqual(resFallbackLow.part, 'upholstery', '低置信误判被拦截后成功纠偏为沙发');
  assert.strictEqual(resFallbackLow.recommended_category_id, 'mat_cat_leather');

  // 8c: VLM 网络或接口异常抛错时，平滑降级兜底
  const resFallbackErr = await classifyRegionPart(db, fakeBuf, {
    chatVision: mockVlmFail,
    fetch: fetchDisabled,
    selection: sofaBboxTag
  });
  assert.strictEqual(resFallbackErr.uncertain, false);
  assert.strictEqual(resFallbackErr.part, 'upholstery');
  console.log('✅ VLM 假成功消除与平滑降级兜底测试通过');

  console.log('=== 9. 回归测试：空间几何启发式边界判定与防截胡验证 ===');
  // 9a. 扁平地面 (ch < 0.20 && cy > 0.82)
  const resFloorFlat = await classifyRegionPart(db, null, {
    selection: { cy: 0.86, ch: 0.12, cw: 0.70 }
  });
  assert.strictEqual(resFloorFlat.part, 'floor');
  assert.strictEqual(resFloorFlat.model, 'heuristic_spatial_floor');

  // 9b. 极限底部地面 (cy > 0.88)
  const resFloorDeep = await classifyRegionPart(db, null, {
    selection: { cy: 0.92, ch: 0.15, cw: 0.70 }
  });
  assert.strictEqual(resFloorDeep.part, 'floor');

  // 9c. 吊顶天花 (cy < 0.22)
  const resCeiling = await classifyRegionPart(db, null, {
    selection: { cy: 0.12, ch: 0.20, cw: 0.80 }
  });
  assert.strictEqual(resCeiling.part, 'ceiling');

  // 9d. 宽幅背景墙面 (cw >= 0.88)
  const resWall = await classifyRegionPart(db, null, {
    selection: { cy: 0.50, ch: 0.60, cw: 0.95 }
  });
  assert.strictEqual(resWall.part, 'wall');
  assert.strictEqual(resWall.recommended_category_id, 'mat_cat_latex');

  console.log('✅ 空间几何天花/地面/墙面/沙发边界防截胡验证通过');

  console.log('=== 10. 回归测试：真实切片 Buffer + 模拟 JEV 返回 wall 假阳性时，系统依靠空间几何防截胡纠偏为 upholstery ===');
  const mockJevWall = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'jev-1.14.0',
      answers: { surface: { choice: 'wall', probabilities: { wall: 0.84 }, confidence: 0.82 } }
    })
  });
  const resJevVeto = await classifyRegionPart(db, fakeBuf, {
    chatVision: async () => { throw new Error('VLM offline'); },
    fetch: mockJevWall,
    selection: sofaBboxTag
  });
  assert.strictEqual(resJevVeto.uncertain, false, 'JEV 假阳性拦截后降级至空间启发式必须置信判定');
  assert.notStrictEqual(resJevVeto.part, 'wall', '严禁直接采纳 JEV 的 wall 假阳性');
  assert.strictEqual(resJevVeto.part, 'upholstery', '必须成功纠偏为 upholstery');
  assert.strictEqual(resJevVeto.recommended_category_id, 'mat_cat_leather', '必须推荐皮革品类');
  assert.strictEqual(resJevVeto.model, 'heuristic_spatial_upholstery', '模型应标记为 heuristic_spatial_upholstery');
  console.log('✅ JEV 假阳性防截胡与空间几何纠偏回归测试通过');

  console.log('\n🎉 classifyRegionPart 所有单测用例全部通过！');
}

function cleanup() {
  globalThis.fetch = _origGlobalFetch;
  try { db.close(); } catch {}
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
}

runTests().then(
  cleanup,
  (err) => {
    cleanup();
    console.error(err);
    process.exit(1);
  }
);
