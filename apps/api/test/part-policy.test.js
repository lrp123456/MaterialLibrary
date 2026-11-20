/**
 * Stage 3 单元测试：8 部位白名单与黑名单策略校验
 */

const assert = require('assert');
const {
  VALID_PARTS,
  PART_POLICIES,
  isSubclassAllowed,
  isAssetAllowedForPart
} = require('../src/base-library/part-policy');

function runTests() {
  console.log('=== 1. 测试 8 部位完整性 ===');
  assert.strictEqual(VALID_PARTS.length, 8);
  for (const p of VALID_PARTS) {
    assert.ok(PART_POLICIES[p], `缺少部位策略: ${p}`);
    assert.ok(PART_POLICIES[p].subclasses.length > 0, `部位 ${p} 白名单为空`);
  }
  console.log('✅ 8 大部位定义完整');

  console.log('=== 2. 测试黑名单强约束组合 ===');
  // 沙发部位 (upholstery) 拒绝 wall_paint、floor_wood、wall_stone
  assert.strictEqual(isSubclassAllowed('upholstery', 'wall_paint'), false);
  assert.strictEqual(isSubclassAllowed('upholstery', 'floor_wood'), false);
  assert.strictEqual(isSubclassAllowed('upholstery', 'wall_stone'), false);
  assert.strictEqual(isSubclassAllowed('upholstery', 'uph_leather'), true);
  assert.strictEqual(isSubclassAllowed('upholstery', 'uph_fabric'), true);

  // 天花 (ceiling) 拒绝 soft_rug、uph_leather
  assert.strictEqual(isSubclassAllowed('ceiling', 'soft_rug'), false);
  assert.strictEqual(isSubclassAllowed('ceiling', 'uph_leather'), false);
  assert.strictEqual(isSubclassAllowed('ceiling', 'ceiling_paint'), true);

  // 窗帘与床品 (curtain_bedding) 拒绝 soft_rug
  assert.strictEqual(isSubclassAllowed('curtain_bedding', 'soft_rug'), false);
  assert.strictEqual(isSubclassAllowed('curtain_bedding', 'soft_curtain'), true);
  assert.strictEqual(isSubclassAllowed('curtain_bedding', 'soft_bedding'), true);

  // 地毯 (rug) 拒绝 soft_curtain 和 wall_paint
  assert.strictEqual(isSubclassAllowed('rug', 'soft_curtain'), false);
  assert.strictEqual(isSubclassAllowed('rug', 'wall_paint'), false);
  assert.strictEqual(isSubclassAllowed('rug', 'soft_rug'), true);

  // 资产标签级别拦截 (isAssetAllowedForPart)
  assert.strictEqual(isAssetAllowedForPart('upholstery', [{ surface: 'wall', subclass: 'wall_paint' }]), false);
  assert.strictEqual(isAssetAllowedForPart('upholstery', [{ surface: 'soft', subclass: 'chair_fabric' }]), true);
  assert.strictEqual(isAssetAllowedForPart('ceiling', [{ surface: 'floor', subclass: 'floor_wood' }]), false);

  console.log('✅ 8 部位黑白名单强约束校验通过！');
}

runTests();
