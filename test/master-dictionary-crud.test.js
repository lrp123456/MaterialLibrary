/**
 * 单元测试：Master 统一字典架构、全量 CRUD、编译器精准输出与「物理测色 + VLM 智能美学赋名」验证
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const testDir = path.join(os.tmpdir(), 'dsh_master_dict_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const {
  getDictionary,
  createPart,
  updatePart,
  deletePart,
  createCategory,
  updateCategory,
  deleteCategory,
  listSwatches,
  createSwatch,
  updateSwatch,
  deleteSwatch,
  recognizeVlmSwatch
} = require('../src/base-library/dictionary-routes');
const { compileBaseAttributes } = require('../src/base-library/compile');
const { hexToLab, deltaE00, calculateLrv, deriveColorFamily } = require('../src/base-library/color-engine');

const db = openDb(testDir);
ensureBaseLibrarySchema(db);

async function runTests() {
  console.log('=== 1. 测试部位-基材品类白名单严格隔离 ===');
  const dictUpholstery = getDictionary(db, { part: 'upholstery' });
  assert.ok(dictUpholstery.categories.length > 0, '沙发部位必须有合法基材');
  const catIdsForSofa = dictUpholstery.categories.map(c => c.id);
  assert.ok(catIdsForSofa.includes('mat_cat_leather'), '沙发必须包含真皮品类');
  assert.ok(catIdsForSofa.includes('mat_cat_fabric_upholstery'), '沙发必须包含布艺面料');
  assert.strictEqual(catIdsForSofa.includes('mat_cat_latex'), false, '沙发严禁包含乳胶漆');
  assert.strictEqual(catIdsForSofa.includes('mat_cat_wood_floor'), false, '沙发严禁包含木地板');
  console.log('✅ 沙发部位基材白名单隔离通过');

  console.log('=== 2. 测试专属色卡与表面工艺隔离 ===');
  const leatherSwatches = dictUpholstery.swatches['mat_cat_leather'] || [];
  assert.ok(leatherSwatches.length >= 12, '真皮品类必须包含专属 12 色');
  const saddleBrown = leatherSwatches.find(s => s.name_zh === '意式马鞍棕');
  assert.ok(saddleBrown, '真皮色卡中必须有意式马鞍棕');
  assert.strictEqual(saddleBrown.hex, '#8B4A2B');

  const leatherCat = dictUpholstery.categories.find(c => c.id === 'mat_cat_leather');
  assert.ok(leatherCat.finishes.some(f => f.id === 'vintage_oil_wax'), '真皮必须包含复古油蜡皮工艺');
  assert.ok(leatherCat.finishes.some(f => f.id === 'nappa_full_grain'), '真皮必须包含纳帕真皮工艺');
  console.log('✅ 专属色卡与表面工艺隔离通过');

  console.log('=== 3. 测试 Master 编译器精准输出 (真皮沙发严禁出现 roller_matte 且为 Track A) ===');
  const compileResult = compileBaseAttributes(db, {
    regions: [{
      region_id: 'reg_sofa',
      part: 'upholstery',
      surface: 'upholstery',
      swatch_id: saddleBrown.id,
      finish_id: 'vintage_oil_wax'
    }],
    baseImageTag: '图1'
  });

  assert.strictEqual(compileResult.success, true);
  assert.strictEqual(compileResult.references.length, 0, 'Track A 纯色模式绝不发送参考图');
  const clauseText = compileResult.clauses[0].text;
  assert.ok(clauseText.includes('意式马鞍棕'), '提示词必须包含意式马鞍棕');
  assert.ok(clauseText.includes('复古油蜡牛皮质感') || clauseText.includes('油蜡'), '提示词必须包含油蜡皮工艺');
  assert.ok(clauseText.includes('车缝线') || clauseText.includes('褶皱深度'), '提示词必须包含沙发光影褶皱保持句');
  assert.strictEqual(clauseText.includes('roller_matte'), false, '真皮提示词严禁混入滚涂乳胶漆');
  assert.strictEqual(clauseText.includes('乳胶漆'), false, '真皮提示词严禁出现乳胶漆');
  console.log('✅ 编译器精准输出校验通过');

  console.log('=== 4. 测试专属色卡全量 CRUD 闭环 ===');
  const newSwatch = createSwatch(db, {
    category_id: 'mat_cat_leather',
    name_zh: '高定祖母绿油蜡皮',
    brand: 'Poltrona Frau 限量',
    code: 'SC-999 Emerald',
    hex: '#1C3A2B',
    style_tags: ['复古大宅', '现代极简']
  });
  assert.ok(newSwatch.id, '新建色卡必须返回 ID');
  assert.strictEqual(newSwatch.color_family, 'green_blue', '应自动推导绿蓝色系');
  assert.ok(typeof newSwatch.lrv === 'number', '应自动由 HEX 计算 LRV');

  // 修改
  const updatedSwatch = updateSwatch(db, newSwatch.id, {
    name_zh: '高定英伦复古墨绿皮'
  });
  assert.strictEqual(updatedSwatch.name_zh, '高定英伦复古墨绿皮');

  // 查询
  const foundList = listSwatches(db, { q: '英伦复古墨绿' });
  assert.ok(foundList.length > 0);

  // 删除
  const delOk = deleteSwatch(db, newSwatch.id);
  assert.strictEqual(delOk, true);
  const reFound = listSwatches(db, { q: '英伦复古墨绿' });
  assert.strictEqual(reFound.length, 0);
  console.log('✅ 专属色卡 CRUD 闭环校验通过');

  console.log('=== 5. 测试「物理测色 + ΔE00 品牌近邻 + VLM 美学赋名」===');
  const recResult = await recognizeVlmSwatch(db, {
    hex: '#8B4A2B',
    partHint: 'upholstery'
  });
  assert.strictEqual(recResult.hex, '#8B4A2B');
  assert.strictEqual(recResult.recommended_category_id, 'mat_cat_leather', '沙发取棕色应精准推荐真皮品类');
  assert.ok(recResult.name_zh, '必须给出诗意美学色名');
  assert.ok(recResult.closest_brand_matches.length > 0, '必须匹配近邻品牌色号');
  const topMatch = recResult.closest_brand_matches[0];
  assert.ok(topMatch.delta_e < 5.0, '马鞍棕标准色与库内马鞍棕色差 ΔE00 必须极小 (< 5.0)');
  console.log(`✅ 识色与近邻匹配通过 (Top1: ${topMatch.name_zh}, ΔE00: ${topMatch.delta_e})`);

  console.log('\n🎉 master-dictionary-crud 全部单元测试 100% 通过！\n');
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
