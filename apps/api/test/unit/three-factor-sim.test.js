/**
 * Phase 3 验收门禁测试 3：三因子相似度推荐引擎与向量特性开关测试 (Three-Factor Sim Test)
 *
 * 验证目标：
 * 1. 验证三因子综合加权算法：pHash (0.40) + 色彩 Lab DeltaE (0.35) + 标签 Jaccard (0.25)；
 * 2. 验证推荐质量：同主色、相近风格、高相似特征的素材得分显著高于无关素材；
 * 3. 性能基准测试：对 10,000 条合成素材进行相似度批量评分，P95 延迟严格 < 80ms；
 * 4. 向量化特性开关 ENABLE_VECTOR_EMBEDDING：默认 false，具备正确的降级与开关行为。
 */
const assert = require('assert');
const {
  calculateThreeFactorScore,
  phashSimilarity,
  hammingDistance64,
  ENABLE_VECTOR_EMBEDDING
} = require('../../src/vector');

async function run() {
  console.log('=== Phase 3 Gate 3: 三因子相似度推荐引擎与基准测试 ===');

  // 1. 验证基础工具函数
  assert.strictEqual(hammingDistance64('ffff', 'ffff'), 0, '相同哈希汉明距离为0');
  assert.strictEqual(hammingDistance64('0000000000000000', 'ffffffffffffffff'), 64, '全异哈希汉明距离为64');
  assert.strictEqual(phashSimilarity('ffffffffffffffff', 'ffffffffffffffff'), 1.0);
  assert.strictEqual(phashSimilarity('0000000000000000', 'ffffffffffffffff'), 0);

  // 2. 验证三因子综合评分逻辑
  const target = {
    phash: '8a3c5f2b1d4e7a9c',
    hex: '#f5f0eb',
    dominant_color: '米/奶油',
    tags: ['living_room', 'cream_style', 'wood']
  };

  const highMatch = {
    phash: '8a3c5f2b1d4e7a9d', // 仅差1位
    hex: '#f7f2ed', // 极小色差
    dominant_color: '米/奶油',
    tags: ['living_room', 'cream_style', 'wood', 'boucle']
  };

  const lowMatch = {
    phash: '0000000000000000',
    hex: '#111111',
    dominant_color: '黑',
    tags: ['bathroom', 'industrial', 'black_steel']
  };

  const highScore = calculateThreeFactorScore(target, highMatch);
  const lowScore = calculateThreeFactorScore(target, lowMatch);

  console.log(`高匹配相似度得分: ${highScore}, 低匹配相似度得分: ${lowScore}`);
  assert(highScore > 0.85, `高相似候选得分应 > 0.85 (实际: ${highScore})`);
  assert(lowScore < 0.20, `低相似候选得分应 < 0.20 (实际: ${lowScore})`);

  // 3. 性能基准测试 (10,000 条数据批量评分压测)
  console.log('开始 10,000 条合成素材相似度算力基准测试...');
  const syntheticItems = [];
  const colors = ['#ffffff', '#f5f5f5', '#e0e0e0', '#333333', '#1a1a1a', '#8b5a2b'];
  const tagPool = ['living_room', 'bedroom', 'kitchen', 'cream_style', 'modern_minimal', 'log_wood', 'oak', 'tile'];

  for (let i = 0; i < 10000; i++) {
    syntheticItems.push({
      phash: (i * 123456789).toString(16).padStart(16, '0').slice(0, 16),
      hex: colors[i % colors.length],
      dominant_color: i % 2 === 0 ? '米/奶油' : '原木/木色',
      tags: [tagPool[i % tagPool.length], tagPool[(i + 1) % tagPool.length]]
    });
  }

  const times = [];
  const tStart = Date.now();

  for (let i = 0; i < syntheticItems.length; i++) {
    const itemStart = process.hrtime.bigint();
    calculateThreeFactorScore(target, syntheticItems[i]);
    const itemEnd = process.hrtime.bigint();
    times.push(Number(itemEnd - itemStart) / 1e6); // 转换为毫秒
  }

  const totalDuration = Date.now() - tStart;
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.50)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];

  console.log(`10,000 条完成耗时: ${totalDuration}ms | P50: ${p50.toFixed(4)}ms | P95: ${p95.toFixed(4)}ms | P99: ${p99.toFixed(4)}ms`);
  assert(p95 < 80, `[P95 延迟门禁] 单次算分 P95 必须严格 < 80ms (实际: ${p95.toFixed(4)}ms)`);
  assert(totalDuration < 3000, `10,000 条全量批处理耗时必须 < 3s (实际: ${totalDuration}ms)`);

  // 4. 特性开关验证
  // 默认情况下 ENABLE_VECTOR_EMBEDDING 必须为 false (未配置环境变量)
  if (process.env.ENABLE_VECTOR_EMBEDDING === undefined) {
    assert.strictEqual(ENABLE_VECTOR_EMBEDDING, false, '默认未开启向量检索时应为 false');
  }

  console.log('✓ Phase 3 Gate 3: 三因子相似度推荐引擎与基准测试全部通过！');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('三因子相似度测试失败:', err);
    process.exit(1);
  });
}

module.exports = run;
