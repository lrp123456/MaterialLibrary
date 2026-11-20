/**
 * JEV 分类解析与门禁逻辑测试 (classify-parse)
 * 验证：0.75 仅比对 probabilities[choice]、confidence 仅记日志不参与判定、
 * 频控 (每用户 10 分钟 20 次)、flag 开关控制、上游非 200/超时优雅降级
 */

const assert = require('assert');
const Database = require('better-sqlite3');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const {
  parseJevResponse,
  checkClassifyRateLimit,
  resetClassifyRateLimits,
  classifyRegionSurface
} = require('../src/base-library/classify');
const { setFlag } = require('../src/base-library/list');

async function runTests() {
  console.log('=== 1. 测试 parseJevResponse 概率门槛 ===');
  // 案例 1: 概率 >= 0.75，正常返回
  const sampleOk = {
    model: 'jev-1.14.0',
    answers: {
      surface: {
        choice: 'wall',
        probabilities: { wall: 0.94, floor: 0.03, ceiling: 0.03 },
        confidence: 0.88
      }
    }
  };
  const r1 = parseJevResponse(sampleOk);
  assert.strictEqual(r1.surface, 'wall');
  assert.strictEqual(r1.probability, 0.94);
  assert.strictEqual(r1.uncertain, false);
  assert.strictEqual(r1.model, 'jev-1.14.0');
  assert.strictEqual(r1.confidence, 0.88);
  console.log('✅ >= 0.75 正常识别通过');

  // 案例 2: confidence 极高 (0.95)，但 probabilities 只有 0.65 (< 0.75) -> 必须 uncertain
  const sampleLowProb = {
    model: 'jev-1.14.0',
    answers: {
      surface: {
        choice: 'ceiling',
        probabilities: { ceiling: 0.65, wall: 0.25, soft: 0.1 },
        confidence: 0.95
      }
    }
  };
  const r2 = parseJevResponse(sampleLowProb);
  assert.strictEqual(r2.surface, null, '概率低于 0.75 时 surface 必须为 null');
  assert.strictEqual(r2.uncertain, true, '概率低于 0.75 时 uncertain 必须为 true');
  assert.strictEqual(r2.probability, 0.65);
  console.log('✅ confidence 不影响 0.75 概率门槛判定');

  // 案例 3: choice 不在 8 个合法面内
  const sampleInvalidChoice = {
    model: 'jev-1.14.0',
    answers: {
      surface: {
        choice: 'alien_wall',
        probabilities: { alien_wall: 0.99 }
      }
    }
  };
  const r3 = parseJevResponse(sampleInvalidChoice);
  assert.strictEqual(r3.uncertain, true);
  assert.strictEqual(r3.surface, null);
  console.log('✅ 非法 surface choice 拦截通过');

  // 案例 4: 缺少 probabilities
  const sampleNoProbs = {
    model: 'jev-1.14.0',
    answers: {
      surface: {
        choice: 'floor'
      }
    }
  };
  const r4 = parseJevResponse(sampleNoProbs);
  assert.strictEqual(r4.uncertain, true);
  assert.strictEqual(r4.surface, null);
  console.log('✅ 缺少 probabilities 优雅标记 uncertain 通过');

  console.log('=== 2. 测试频控 (10 分钟最多 20 次) ===');
  resetClassifyRateLimits();
  const testUserId = 'user_test_888';
  for (let i = 0; i < 20; i++) {
    const ok = checkClassifyRateLimit(testUserId);
    assert.strictEqual(ok, true, `第 ${i + 1} 次调用必须放行`);
  }
  const overflowCall = checkClassifyRateLimit(testUserId);
  assert.strictEqual(overflowCall, false, '第 21 次调用必须被频控拦截');

  // 其他用户不受影响
  const otherUserCall = checkClassifyRateLimit('user_test_999');
  assert.strictEqual(otherUserCall, true, '不同用户不应被同一频控阻塞');

  resetClassifyRateLimits();
  assert.strictEqual(checkClassifyRateLimit(testUserId), true, 'reset 之后恢复放行');
  console.log('✅ 频控逻辑校验通过');

  console.log('=== 3. 测试 classifyRegionSurface 与 Flag / 环境变量门禁 ===');
  const db = new Database(':memory:');
  ensureBaseLibrarySchema(db);

  const fakeJpeg = Buffer.from('fake_jpeg_content');

  setFlag(db, 'base_library_jev', 0);
  const resDisabled = await classifyRegionSurface(db, fakeJpeg);
  assert.strictEqual(resDisabled.success, true);
  assert.strictEqual(resDisabled.data.uncertain, true);
  assert.strictEqual(resDisabled.data.model, 'disabled');
  console.log('✅ base_library_jev 默认关闭时返回 uncertain: true 通过');

  // 开启 base_library_jev，但未配置 TYPESAFE_API_KEY
  setFlag(db, 'base_library_jev', 1);
  const oldKey = process.env.TYPESAFE_API_KEY;
  const oldJevKey = process.env.JEV_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.JEV_API_KEY;

  const resNoKey = await classifyRegionSurface(db, fakeJpeg);
  assert.strictEqual(resNoKey.success, true);
  assert.strictEqual(resNoKey.data.uncertain, true);
  assert.strictEqual(resNoKey.data.model, 'no_key');
  console.log('✅ 未配置 TYPESAFE_API_KEY 时返回 uncertain: true 通过');

  // 配置假 Key 并注入 mock fetch 模拟上游成功响应
  process.env.TYPESAFE_API_KEY = 'test_typesafe_key';
  const mockFetchOk = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'jev-1.14.0',
      answers: {
        surface: {
          choice: 'floor',
          probabilities: { floor: 0.98, wall: 0.01 },
          confidence: 0.97
        }
      }
    })
  });

  const resOk = await classifyRegionSurface(db, fakeJpeg, { fetch: mockFetchOk });
  assert.strictEqual(resOk.success, true);
  assert.strictEqual(resOk.data.uncertain, false);
  assert.strictEqual(resOk.data.surface, 'floor');
  assert.strictEqual(resOk.data.probability, 0.98);
  console.log('✅ 正常上游响应代理与解析通过');

  // 模拟上游 500 错误
  const mockFetch500 = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'internal_error' })
  });
  const res500 = await classifyRegionSurface(db, fakeJpeg, { fetch: mockFetch500 });
  assert.strictEqual(res500.success, true);
  assert.strictEqual(res500.data.uncertain, true);
  assert.strictEqual(res500.data.model, 'http_500');
  console.log('✅ 上游 500 错误平稳返回 uncertain: true 通过');

  // 恢复环境变量
  if (oldKey) process.env.TYPESAFE_API_KEY = oldKey;
  else delete process.env.TYPESAFE_API_KEY;

  console.log('\n🎉 classify-parse 单元测试全部通过！');
}

runTests().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
