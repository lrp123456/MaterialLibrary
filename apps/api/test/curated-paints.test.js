/**
 * 策展色卡单元测试：
 * 1. 验证 9 大色系每系至少 6 款颜色；
 * 2. 验证同系内部 LRV 严格降序排列；
 * 3. 验证 display_name 杜绝“暖调/冷调”机械前后缀；
 * 4. 验证 HEX 格式正确合法。
 */

const assert = require('assert');
const { PAINT_FAMILIES, CURATED_PAINTS } = require('../src/base-library/curated-paints');

function runTests() {
  console.log('=== 1. 测试色系覆盖度与数量 ===');
  assert.strictEqual(PAINT_FAMILIES.length, 9, '必须包含 9 大色系');
  const familyKeys = PAINT_FAMILIES.map(f => f.key);

  const byFamily = {};
  for (const f of familyKeys) byFamily[f] = [];

  for (const p of CURATED_PAINTS) {
    assert.ok(familyKeys.includes(p.family_key), `非法色系: ${p.family_key}`);
    assert.strictEqual(p.curated, 1, '策展色卡 curated 必须为 1');
    assert.match(p.hex, /^#[0-9A-Fa-f]{6}$/, `HEX 格式不合规: ${p.hex}`);
    assert.ok(typeof p.lrv === 'number' && p.lrv >= 0 && p.lrv <= 100, `LRV 异常: ${p.lrv}`);
    assert.ok(p.display_name && p.display_name.trim().length > 0, '缺失 display_name');
    assert.ok(!p.display_name.includes('暖调') && !p.display_name.includes('冷调'), `display_name 包含机械字样: ${p.display_name}`);
    byFamily[p.family_key].push(p);
  }

  for (const f of familyKeys) {
    const list = byFamily[f];
    assert.ok(list.length >= 6, `色系 ${f} 颜色数量不足 6 款: 当前 ${list.length}`);
    console.log(`  - 色系 ${f}: ${list.length} 款`);

    // 验证 LRV 严格单调不增 (降序)
    for (let i = 1; i < list.length; i++) {
      assert.ok(
        list[i].lrv <= list[i - 1].lrv,
        `色系 ${f} 未按 LRV 降序排列: ${list[i - 1].display_name}(${list[i - 1].lrv}) < ${list[i].display_name}(${list[i].lrv})`
      );
    }
  }

  console.log('✅ 策展色卡数据格式、色系覆盖与降序排列全部通过！');
}

runTests();
