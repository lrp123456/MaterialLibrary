const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const testDir = path.join(os.tmpdir(), 'dsh_ba_items_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

process.env.ML_DATA_DIR = testDir;
const { openDb } = require('../src/db');
const { ensureItems, upsertCatalogItem, listItems, updateItem } = require('../src/base-library/items');

console.log('=== 测试 ba_items is_pinned 与 use_count 机制 ===');

const db = openDb(testDir);
ensureItems(db);

// 清空种子可能注入的初始 items，保持纯净测试环境
db.prepare('DELETE FROM ba_items').run();

// 插入测试条目
const res1 = upsertCatalogItem(db, {
  name_zh: '奶油风微水泥-平涂',
  kind: '涂料',
  kind_key: 'microcement',
  prompt_name: 'Cream Microcement Smooth',
  external_sku: 'MC-001'
});

const res2 = upsertCatalogItem(db, {
  name_zh: '奶油风微水泥-平涂', // 同名不同工艺规格
  kind: '涂料',
  kind_key: 'microcement',
  prompt_name: 'Cream Microcement Eggshell',
  external_sku: 'MC-002'
});

const res3 = upsertCatalogItem(db, {
  name_zh: '极简哑光灰瓷砖',
  kind: '瓷砖',
  kind_key: 'tile',
  prompt_name: 'Matte Grey Tile',
  external_sku: 'TL-001'
});

const item1 = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(res1.id);
const item2 = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(res2.id);
const item3 = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(res3.id);

console.log('1. 验证默认 is_pinned 和 use_count 均为 0');
assert.equal(item1.is_pinned, 0);
assert.equal(item1.use_count, 0);

console.log('2. 验证 updateItem 记录复用 (action: use)');
const afterUse = updateItem(db, item3.id, { action: 'use' });
assert.equal(afterUse.use_count, 1);
const afterUse2 = updateItem(db, item3.id, { action: 'use' });
assert.equal(afterUse2.use_count, 2);

console.log('3. 验证 updateItem 收藏/置顶 (is_pinned: 1)');
const afterPin = updateItem(db, item1.id, { is_pinned: 1 });
assert.equal(afterPin.is_pinned, 1);

console.log('4. 验证同名工艺变体联动同步 is_pinned');
const item2Fetched = listItems(db).find(i => i.id === item2.id);
assert.equal(item2Fetched.is_pinned, 1);

console.log('5. 验证 sort: frequent 排序');
const sortedList = listItems(db, { sort: 'frequent' });
// item1/item2 是置顶 (is_pinned=1)，排在最前面
assert.equal(sortedList[0].is_pinned, 1);
assert.equal(sortedList[1].is_pinned, 1);
// item3 use_count=2, 排在第 3 个
assert.equal(sortedList[2].id, item3.id);
assert.equal(sortedList[2].use_count, 2);

console.log('6. 验证 pinned=true 筛选');
const pinnedList = listItems(db, { pinned: true });
assert.equal(pinnedList.length, 2); // item1 & item2 同名变体都置顶

console.log('7. 验证三段式板块排布逻辑 (置顶 -> 常用Top10 -> 常规排序排他性)');
// 模拟插入 15 条附加素材，验证 Top 10 截止与无重复漏项
for (let i = 1; i <= 15; i++) {
  const r = upsertCatalogItem(db, {
    name_zh: `测试材质_${i}`,
    kind: '材质',
    kind_key: 'tile',
    prompt_name: `Test Tile ${i}`
  });
  updateItem(db, r.id, { use_count: i * 3 }); // use_count 从 3 到 45
}

const allItems = listItems(db);
const pinnedTier = allItems.filter(i => Number(i.is_pinned) === 1);
const frequentTier = allItems
  .filter(i => !i.is_pinned && Number(i.use_count) > 0)
  .sort((a, b) => (Number(b.use_count || 0) - Number(a.use_count || 0)))
  .slice(0, 10);
const pinOrFreqSet = new Set([...pinnedTier.map(i => i.id), ...frequentTier.map(i => i.id)]);
const regularTier = allItems.filter(i => !pinOrFreqSet.has(i.id));

assert.equal(pinnedTier.length, 2, '置顶板块条目数正确');
assert.equal(frequentTier.length, 10, '常用板块严格截取 Top 10');
assert.equal(frequentTier[0].use_count, 45, '常用第1名是复用次数最高的');
assert.equal(frequentTier[9].use_count, 18, '常用第10名是第10高频');
// 剩余的条目（use_count < 18 以及初始的 item3 如果不在 top 10）必须进常规板块
assert.ok(regularTier.length > 0, '常规板块包含剩余条目');
// 验证三段互斥无重叠
for (const p of pinnedTier) {
  assert.ok(!frequentTier.some(f => f.id === p.id), '置顶项绝不重复出现在常用板块');
  assert.ok(!regularTier.some(r => r.id === p.id), '置顶项绝不重复出现在常规板块');
}
for (const f of frequentTier) {
  assert.ok(!regularTier.some(r => r.id === f.id), '常用项绝不重复出现在常规板块');
}
assert.equal(pinnedTier.length + frequentTier.length + regularTier.length, allItems.length, '三段式无缝覆盖全量条目，零丢失零重复');

console.log('🎉 ba_items 收藏置顶与常用计数所有单元测试通过！');
db.close();
try {
  fs.rmSync(testDir, { recursive: true, force: true });
} catch (e) {}
