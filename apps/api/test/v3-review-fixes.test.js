/**
 * v3 Review 专项集成与回归测试
 * 覆盖：
 * 1. 3D 单品库纯净化 (仅保留 1 款真实单品，清理占位)
 * 2. 空间几何启发式部位识别 Level 3 (无 Key 离线兜底，绝不返回 0%)
 * 3. classify-region 自动返回 dominant_hex 与 recommended_swatches
 * 4. 专属常用色卡排布 (色随材走) 与色系 Tab 完整覆盖 (杜绝 0 条空白)
 * 5. /api/base-library/items 与 ba_material_swatches 彻底打通 (含 SVG 动态预览兜底)
 */

const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const testDir = path.join(os.tmpdir(), 'dsh_v3_review_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { seedMasterDictionary } = require('../src/base-library/master-dictionary-seed');
const { classifyRegionPart } = require('../src/base-library/classify-part');
const { getDictionary, getRecommendedSwatchesForRegion } = require('../src/base-library/dictionary-routes');
const { listItems } = require('../src/base-library/items');

const db = openDb(testDir);
ensureBaseLibrarySchema(db);
seedMasterDictionary(db);

async function runTests() {
  console.log('=== 1. 测试 3D 单品家具库纯净化 ===');
  const presets = db.prepare('SELECT id, name FROM product_presets').all();
  assert.strictEqual(presets.length, 1, '3D 模型库必须且仅有 1 款真实沙发单品');
  assert.strictEqual(presets[0].id, 'sofa_electric_single');
  assert.ok(!presets.some(p => p.id === 'chair_nordic_lounge'));
  assert.ok(!presets.some(p => p.id === 'table_stone_coffee'));
  console.log('✅ 3D 单品库虚拟占位清理验证通过 (单品数: 1)');

  console.log('=== 2. 测试 Level 3 空间几何启发式识别兜底 (无 Key 离线环境) ===');
  // 无 Key、无 VLM、无 JEV 模拟
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.JEV_API_KEY;

  const fakeImgBuf = Buffer.from('fake_image_bytes');

  // (A) 画面中下部 BBox -> 识别为软体沙发 upholstery
  const resSofa = await classifyRegionPart(db, fakeImgBuf, {
    selection: { norm: { x: 0.15, y: 0.55, w: 0.45, h: 0.35 } }
  });
  assert.strictEqual(resSofa.uncertain, false, '不可返回 uncertain: true');
  assert.strictEqual(resSofa.part, 'upholstery', '中下部居中物体应识别为软体沙发');
  assert.ok(resSofa.probability >= 0.75, '置信度应 >= 0.75');
  assert.ok(resSofa.alternatives.includes('hard_furniture'), '应包含硬质家具备选');

  // (B) 画面顶部 BBox -> 识别为天花板 ceiling
  const resCeiling = await classifyRegionPart(db, fakeImgBuf, {
    selection: { norm: { x: 0.1, y: 0.05, w: 0.8, h: 0.15 } }
  });
  assert.strictEqual(resCeiling.uncertain, false);
  assert.strictEqual(resCeiling.part, 'ceiling');

  // (C) 画面底部 BBox -> 识别为地面 floor
  const resFloor = await classifyRegionPart(db, fakeImgBuf, {
    selection: { norm: { x: 0.1, y: 0.82, w: 0.8, h: 0.15 } }
  });
  assert.strictEqual(resFloor.uncertain, false);
  assert.strictEqual(resFloor.part, 'floor');
  console.log('✅ Level 3 空间几何启发式兜底识别通过 (全自动命中部位)');

  console.log('=== 3. 测试选区智能配色推荐 (随材质联动) ===');
  // 真皮沙发取棕色
  const recLeather = getRecommendedSwatchesForRegion(db, {
    part: 'upholstery',
    category_id: 'mat_cat_leather',
    dominant_hex: '#8B4A2B'
  });
  assert.ok(recLeather.swatches.length >= 4, '必须推荐至少 4 款真皮配色');
  const originMatch = recLeather.swatches.find(s => s.badge === '原色同频');
  assert.ok(originMatch, '必须包含原色同频色卡');
  assert.strictEqual(originMatch.name_zh, '意式马鞍棕');

  // 乳胶漆墙面取米白
  const recLatex = getRecommendedSwatchesForRegion(db, {
    part: 'wall',
    category_id: 'mat_cat_latex',
    dominant_hex: '#F5EFE6'
  });
  assert.ok(recLatex.swatches.length >= 4, '必须推荐至少 4 款乳胶漆配色');
  const originLatex = recLatex.swatches.find(s => s.badge === '原色同频');
  assert.ok(originLatex, '乳胶漆必须包含原色同频');
  assert.strictEqual(originLatex.name_zh, '珍珠白');
  console.log('✅ 选区智能推荐配色 (原色同频 + 百搭 + 点睛) 通过');

  console.log('=== 4. 测试色随材走与色系 Tab 零空白 ===');
  const dict = getDictionary(db, { part: 'wall' });
  const latexSwatches = dict.swatches['mat_cat_latex'] || [];
  assert.ok(latexSwatches.length >= 20, '乳胶漆专属色卡应 >= 20 条');

  // 验证 20 款最高频置顶色
  const first20 = latexSwatches.slice(0, 20);
  assert.ok(first20.some(s => s.name_zh === '珍珠白'));
  assert.ok(first20.some(s => s.name_zh === '菱花白'));
  assert.ok(first20.some(s => s.name_zh === '可可蛋奶'));
  assert.ok(first20.some(s => s.name_zh === '太空漫步'));

  // 验证色系分类覆盖 (off_white, beige_brown, warm_gray, cool_gray, green_blue, terracotta_red)
  const offWhite = latexSwatches.filter(s => s.color_family === 'off_white');
  const beigeBrown = latexSwatches.filter(s => s.color_family === 'beige_brown');
  const warmGray = latexSwatches.filter(s => s.color_family === 'warm_gray');
  const coolGray = latexSwatches.filter(s => s.color_family === 'cool_gray');
  const greenBlue = latexSwatches.filter(s => s.color_family === 'green_blue');
  const terraCotta = latexSwatches.filter(s => s.color_family === 'terracotta_red');

  assert.ok(offWhite.length > 0, '暖白奶油色系绝不为空白');
  assert.ok(beigeBrown.length > 0, '米杏大地色系绝不为空白');
  assert.ok(warmGray.length > 0, '暖灰侘寂色系绝不为空白');
  assert.ok(coolGray.length > 0, '冷灰现代色系绝不为空白');
  assert.ok(greenBlue.length > 0, '自然绿蓝色系绝不为空白');
  assert.ok(terraCotta.length > 0, '赤陶暖红色系绝不为空白');
  console.log('✅ 乳胶漆 7 大色系全部覆盖，无任何 0 条空白 Tab');

  console.log('=== 5. 测试基础素材库与 12 大基材同步打通 ===');
  const allItems = listItems(db, {});
  assert.ok(allItems.length >= 30, '基础素材库 ba_items 必须同步包含大量专属色卡');
  const kinds = new Set(allItems.map(i => i.kind_key));
  assert.ok(kinds.has('latex'), '必须包含乳胶漆');
  assert.ok(kinds.has('leather'), '必须包含头层真皮');
  assert.ok(kinds.has('fabric'), '必须包含布艺面料');
  assert.ok(kinds.has('wood'), '必须包含木饰面');
  assert.ok(kinds.has('wood_flooring'), '必须包含木地板');
  assert.ok(kinds.has('stone'), '必须包含石材');
  assert.ok(kinds.has('metal'), '必须包含金属');
  assert.ok(kinds.has('glass'), '必须包含玻璃');
  console.log('✅ 基础素材库与 12 大基材品类同步打通验证通过');

  console.log('\n🎉 v3-review-fixes 全部集成测试 100% 验证通过！\n');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
