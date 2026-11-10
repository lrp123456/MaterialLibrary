/**
 * GPT Image VIP 报错文案与网络错误归类的回归。
 *
 * 背景：连续两次失败分别是上游 429（service is busy）与本地 180s 等待超时。
 * 旧文案把上游 JSON + 「实际请求参数」整段甩给用户，UI 又因为 JSON 里的
 * "ratio":"3:4" 误提示「去改画幅」。这里锁定新的结构化文案。
 */
const assert = require('assert');
const {
  vipFailureInfo,
  vipTimeoutMessage,
  classifyVipNetworkError,
} = require('../src/gen/index');

function main() {
  // 1) 429：解析 JSON 内层 message，抠出 request id，不再带「实际请求参数」
  const busyBody = JSON.stringify({
    error: { message: 'The service is busy. Please try again later. (request id: 2026111007403984207841496e93ae300w8qveU)' }
  });
  const busy = vipFailureInfo(429, busyBody);
  assert.strictEqual(busy.code, 'upstream_busy');
  assert.ok(busy.title.includes('429'), '429 标题必须带状态码');
  assert.ok(!busy.detail.includes('实际请求参数'), '可见文案不能再拼调试参数');
  assert.ok(/service is busy/i.test(busy.detail), '保留上游内层 message 便于排查');
  assert.strictEqual(busy.requestId, '2026111007403984207841496e93ae300w8qveU');

  // 2) 其它状态码：鉴权/模型不存在/5xx 各自的错误码
  assert.strictEqual(vipFailureInfo(401, '{"error":"invalid api key"}').code, 'upstream_auth');
  assert.strictEqual(vipFailureInfo(404, '{"error":{"message":"model not found"}}').code, 'model_not_found');
  assert.strictEqual(vipFailureInfo(503, 'service unavailable').code, 'upstream_error');
  assert.strictEqual(vipFailureInfo(400, '{"error":{"message":"invalid size"}}').code, 'upstream_bad_request');

  // 3) 非 JSON body 也不能崩
  const plain = vipFailureInfo(429, 'The service is busy');
  assert.ok(plain.detail.includes('The service is busy'));

  // 4) 超时分类：应用层超时 vs 建连超时
  const genTimeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  assert.strictEqual(classifyVipNetworkError(genTimeout), 'gen');
  const connectTimeout = Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
  assert.strictEqual(classifyVipNetworkError(connectTimeout), 'connect');
  assert.strictEqual(classifyVipNetworkError(new Error('socket hang up')), 'other');

  // 5) 超时文案要明确「上游可能仍在出图，先别重复提交」
  const msg = vipTimeoutMessage(300000);
  assert.ok(msg.includes('300 秒'));
  assert.ok(msg.includes('不要重复提交'));
  assert.ok(msg.includes('回到本会话'));

  console.log('✔ GPT Image VIP 429/timeout 文案与网络错误归类通过');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
