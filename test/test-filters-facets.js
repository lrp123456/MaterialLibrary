/**
 * 验证多维筛选聚合 (filterOptions) 与多维查询 (queryAssets)
 */
const { openDb } = require('../src/db');
const { queryAssets, filterOptions } = require('../src/api');
const path = require('path');
const os = require('os');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);

console.log('=== [TEST] 开始验证多维筛选与聚合统计 ===\n');

// 1. 验证 filterOptions 维度是否完整
console.log('Test 1: 验证 filterOptions 聚合返回字段...');
const facets = filterOptions(db, true);
const requiredKeys = ['space', 'style_atom', 'material_kind', 'orientation', 'palette', 'luxury', 'era', 'temperature', 'functional', 'colors'];

for (const k of requiredKeys) {
  const list = facets[k];
  if (!Array.isArray(list)) {
    throw new Error(`缺少维度 ${k} 的聚合数据`);
  }
  console.log(`  ✓ 维度 [${k}]: 包含 ${list.length} 个选项, 首项:`, list[0] ? `${list[0].label} (${list[0].count})` : '无数据项');
}
console.log('  ✓ Test 1 通过!\n');

// 2. 验证多维组合查询
console.log('Test 2: 验证 queryAssets 多维过滤参数...');

// 2.1 配色主题查询
if (facets.palette.length > 0) {
  const targetPalette = facets.palette[0].dir;
  const resPalette = queryAssets(db, { palette: targetPalette, pageSize: 5 });
  console.log(`  [配色主题: ${targetPalette}] 查找到素材: ${resPalette.total} 张 (返回 items: ${resPalette.items.length})`);
  if (resPalette.total === 0) throw new Error('配色主题筛选未能命中素材');
}

// 2.2 空间查询
if (facets.space.length > 0) {
  const targetSpace = facets.space[0].dir;
  const resSpace = queryAssets(db, { space: targetSpace, pageSize: 5 });
  console.log(`  [空间: ${targetSpace}] 查找到素材: ${resSpace.total} 张 (返回 items: ${resSpace.items.length})`);
  if (resSpace.total === 0) throw new Error('空间筛选未能命中素材');
}

// 2.3 奢华度查询
if (facets.luxury.length > 0) {
  const targetLux = facets.luxury[0].dir;
  const resLux = queryAssets(db, { luxury: targetLux, pageSize: 5 });
  console.log(`  [奢华度: ${targetLux}] 查找到素材: ${resLux.total} 张 (返回 items: ${resLux.items.length})`);
  if (resLux.total === 0) throw new Error('奢华度筛选未能命中素材');
}

// 2.4 时代感查询
if (facets.era.length > 0) {
  const targetEra = facets.era[0].dir;
  const resEra = queryAssets(db, { era: targetEra, pageSize: 5 });
  console.log(`  [时代感: ${targetEra}] 查找到素材: ${resEra.total} 张 (返回 items: ${resEra.items.length})`);
  if (resEra.total === 0) throw new Error('时代感筛选未能命中素材');
}

// 2.5 基础单色查询
if (facets.colors.length > 0) {
  const targetColor = facets.colors[0].dir;
  const resColor = queryAssets(db, { colors: targetColor, pageSize: 5 });
  console.log(`  [基础单色: ${targetColor}] 查找到素材: ${resColor.total} 张 (返回 items: ${resColor.items.length})`);
  if (resColor.total === 0) throw new Error('基础单色筛选未能命中素材');
}

console.log('  ✓ Test 2 通过!\n');

// 3. 验证未打标资产的绝对隔离
console.log('Test 3: 验证未打标 discovered 资产绝对不进入前台素材库...');
const totalReadyInLibrary = queryAssets(db, { all: 1, pageSize: 1 }).total;
const discoveredCountInDb = db.prepare("SELECT count(*) c FROM assets WHERE status='discovered'").get().c;
console.log(`  前台素材库总可见数: ${totalReadyInLibrary}`);
console.log(`  后台待打标 discovered 数: ${discoveredCountInDb}`);
const leaked = queryAssets(db, { all: 1, pageSize: 1000 }).items.find(it => it.status === 'discovered');
if (leaked) {
  throw new Error(`严重：发现未打标资产泄露进入了素材库列表！fid: ${leaked.fid}`);
}
console.log('  ✓ 确认 0 张 discovered 资产泄露，准入隔离严密！');
console.log('  ✓ Test 3 通过!\n');

console.log('🎉 所有多维筛选与准入测试 100% 通过！');
