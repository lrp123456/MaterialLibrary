/**
 * Phase 3 验收门禁测试 4：基础素材库字段锁与防覆盖测试 (Base Library Locked Fields Test)
 *
 * 验证目标：
 * 1. 运营/管理员手动编辑 ba_items 条目字段时（如修改 prompt_name）：
 *    - 自动打上 origin = 'manual' 标记；
 *    - 将被编辑的字段名称准确记入 locked_fields JSON 数组；
 * 2. 爬虫/同步程序执行全量更新（upsertCatalogItem / build-base-library）：
 *    - 被锁定的字段（如 prompt_name）受到严格保护，绝对不被爬虫数据覆盖；
 *    - 未被锁定的字段（如 brand, gloss, hex 等）正常跟随爬虫更新；
 * 3. 支持多字段增量加锁，确保人机协同资产的最高安全性。
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { updateItem, upsertCatalogItem, ensureItems } = require('../../src/base-library/items');

async function run() {
  console.log('=== Phase 3 Gate 4: 基础素材库字段锁与防覆盖测试 ===');

  const testDbPath = path.join(os.tmpdir(), `mls_ba_lock_test_${Date.now()}.db`);
  const db = new Database(testDbPath);

  // 初始化基础素材库架构
  ensureItems(db);

  const itemId = 'test_item_paint_001';

  // 1. 爬虫初始注入素材
  upsertCatalogItem(db, {
    id: itemId,
    kind: 'material',
    kind_key: 'latex',
    name_zh: '立邦抗甲醛五合一',
    prompt_name: '原始爬虫生图品名',
    brand: '立邦',
    hex: '#ffffff',
    origin: 'crawler'
  });

  let initialRow = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(itemId);
  assert.strictEqual(initialRow.name_zh, '立邦抗甲醛五合一');
  assert.strictEqual(initialRow.prompt_name, '原始爬虫生图品名');
  assert.strictEqual(initialRow.brand, '立邦');

  // 2. 运营人员通过 updateItem 手动修改 prompt_name
  const updatedItem = updateItem(db, itemId, {
    prompt_name: '大师手调·极简奶油白'
  });

  assert.strictEqual(updatedItem.prompt_name, '大师手调·极简奶油白');
  assert.strictEqual(updatedItem.origin, 'manual', '手动修改后 origin 必须转为 manual');

  let lockedFields = JSON.parse(updatedItem.locked_fields || '[]');
  assert(Array.isArray(lockedFields), 'locked_fields 必须为有效数组');
  assert(lockedFields.includes('prompt_name'), 'locked_fields 必须包含被修改的 prompt_name');

  // 3. 爬虫后续再次执行全量同步/构建，传入新的 prompt_name 与新的 brand
  upsertCatalogItem(db, {
    id: itemId,
    kind: 'material',
    kind_key: 'latex',
    name_zh: '立邦抗甲醛五合一（新批次）',
    prompt_name: '爬虫新抓取的品名_欲覆盖',
    brand: '立邦高端净味系列',
    hex: '#fefefe'
  });

  const afterCrawlerRow = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(itemId);

  // 核心断言：被锁定的 prompt_name 坚决未被覆盖
  assert.strictEqual(
    afterCrawlerRow.prompt_name,
    '大师手调·极简奶油白',
    '[字段锁核心红线] prompt_name 处于锁定状态，绝对不得被爬虫数据覆盖！'
  );

  // 核心断言：未被锁定的 brand 正常被更新
  assert.strictEqual(
    afterCrawlerRow.brand,
    '立邦高端净味系列',
    '未锁定的 brand 字段应正常允许爬虫更新'
  );

  // 4. 继续对第二个字段 brand 加锁
  updateItem(db, itemId, {
    brand: '私家专属定制品牌'
  });

  const rowWithTwoLocks = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(itemId);
  const twoLocks = JSON.parse(rowWithTwoLocks.locked_fields || '[]');
  assert(twoLocks.includes('prompt_name'), '旧锁定字段必须保留');
  assert(twoLocks.includes('brand'), '新锁定字段必须追加');

  // 爬虫第三次同步试图覆盖 brand
  upsertCatalogItem(db, {
    id: itemId,
    prompt_name: '试图覆盖品名2',
    brand: '爬虫试图覆盖品牌'
  });

  const finalRow = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(itemId);
  assert.strictEqual(finalRow.prompt_name, '大师手调·极简奶油白', 'prompt_name 持续锁定');
  assert.strictEqual(finalRow.brand, '私家专属定制品牌', 'brand 也已被锁定');

  db.close();
  try { fs.unlinkSync(testDbPath); } catch (_) {}

  console.log('✓ Phase 3 Gate 4: 基础素材库字段锁与防覆盖测试全部通过！');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('基础库字段锁测试失败:', err);
    process.exit(1);
  });
}

module.exports = run;
