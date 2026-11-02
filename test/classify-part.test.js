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

async function runTests() {
  const fakeBuf = Buffer.from('fake_image_bytes');

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
  console.log('✅ JEV 明确面正常映射通过');

  console.log('\n🎉 classifyRegionPart 所有单测用例全部通过！');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
