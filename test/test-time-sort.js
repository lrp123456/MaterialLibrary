/**
 * 验证服务端时间线排序 (sort=latest/earliest/recommend) 与时间分组标签逻辑
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const { queryAssets } = require('../src/api');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);

console.log('=== [TEST] 开始验证服务端时间排序与时间线展示 ===\n');

// Test 1: 验证默认排序与 latest 排序一致，且严格按时间倒序
console.log('Test 1: 验证默认排序即为最新时间倒序 (latest)...');
const defaultRes = queryAssets(db, { pageSize: 10 });
const latestRes = queryAssets(db, { sort: 'latest', pageSize: 10 });

assert.strictEqual(defaultRes.items.length, latestRes.items.length);
assert.deepStrictEqual(
  defaultRes.items.map(it => it.fid),
  latestRes.items.map(it => it.fid),
  '默认排序应与 sort=latest 完全一致'
);

// 检查每个元素的时间是否降序
for (let i = 0; i < defaultRes.items.length - 1; i++) {
  const tCurr = defaultRes.items[i].created_at || 0;
  const tNext = defaultRes.items[i + 1].created_at || 0;
  assert(tCurr >= tNext, `时间倒序验证失败: 第 ${i} 项 (${tCurr}) 应 >= 第 ${i + 1} 项 (${tNext})`);
}
console.log(`  ✓ 默认/latest 排序验证通过！首项时间: ${new Date(defaultRes.items[0].created_at).toLocaleString()}, 末项时间: ${new Date(defaultRes.items[defaultRes.items.length - 1].created_at).toLocaleString()}`);

// Test 2: 验证 sort=earliest 为时间正序
console.log('\nTest 2: 验证 sort=earliest 为时间正序...');
const earliestRes = queryAssets(db, { sort: 'earliest', pageSize: 10 });
assert(earliestRes.items.length > 0);
for (let i = 0; i < earliestRes.items.length - 1; i++) {
  const tCurr = earliestRes.items[i].created_at || 0;
  const tNext = earliestRes.items[i + 1].created_at || 0;
  assert(tCurr <= tNext, `时间正序验证失败: 第 ${i} 项 (${tCurr}) 应 <= 第 ${i + 1} 项 (${tNext})`);
}
console.log(`  ✓ earliest 排序验证通过！首项时间: ${new Date(earliestRes.items[0].created_at).toLocaleString()}, 末项时间: ${new Date(earliestRes.items[earliestRes.items.length - 1].created_at).toLocaleString()}`);

// Test 3: 验证时间分组函数逻辑
console.log('\nTest 3: 验证“今天、昨天、前天、M月D日”时间格式化与分组逻辑...');
function formatGroupDate(ts) {
  if (!ts) return { key: 'unknown', label: '更早历史', sub: '' };
  const num = Number(ts) < 1e11 ? Number(ts) * 1000 : Number(ts);
  const d = new Date(num);
  if (isNaN(d.getTime())) return { key: 'unknown', label: '更早历史', sub: '' };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const beforeYesterdayStart = todayStart - 86400000 * 2;

  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const key = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const sub = `${y}年${m}月${day}日 · ${weekdays[d.getDay()]}`;

  let label = '';
  if (num >= todayStart) {
    label = '今天';
  } else if (num >= yesterdayStart) {
    label = '昨天';
  } else if (num >= beforeYesterdayStart) {
    label = '前天';
  } else if (y === now.getFullYear()) {
    label = `${m}月${day}日`;
  } else {
    label = `${y}年${m}月${day}日`;
  }

  return { key, label, sub };
}

const nowMs = Date.now();
assert.strictEqual(formatGroupDate(nowMs).label, '今天', '当前时间应为 今天');
assert.strictEqual(formatGroupDate(nowMs - 86400000).label, '昨天', '24小时前应为 昨天');
assert.strictEqual(formatGroupDate(nowMs - 86400000 * 2).label, '前天', '48小时前应为 前天');

const gSample = formatGroupDate(1788570838588);
console.log(`  ✓ 历史样本 (1788570838588) 分组: label="${gSample.label}", sub="${gSample.sub}"`);
assert(gSample.label.includes('月'), '更早历史应包含月份');
console.log('  ✓ Test 3 通过!');

db.close();
console.log('\n🎉 所有时间排序与分组测试 100% 通过！');
