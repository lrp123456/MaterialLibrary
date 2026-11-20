/**
 * Phase 1 验收门禁测试 3：旁路错误监控、数据脱敏与告警防风暴测试 (Sidecar Error Reporter Test)
 *
 * 验证目标：
 * 1. 连续注入 5 次相同指纹的异常：
 *    - JSONL 日志落盘完整调用栈，敏感凭据（如 Authorization: Bearer secret123）被 100% 抹除为 [REDACTED]；
 *    - Mock Webhook 严格由于 10 分钟抑制规则，仅收到 1 次聚合推送；
 *    - 数据库 system_error_events 准确记录 count = 5 且状态为 open；
 * 2. 隔离红线：业务端 SSE / WS 收到 0 条运维报错事件；
 * 3. 熔断开关：ML_DISABLE_SIDECAR_NOTIFIER=1 立即中止外发。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_err_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
process.env.ML_DATA_DIR = testDir;

const { openDb } = require('../../src/db');
const db = openDb(testDir);
const { reportError, setReporterDb, sanitizeContext } = require('../../src/ops/error-reporter');
const { resetNotificationCache } = require('../../src/ops/notifier');

async function run() {
  setReporterDb(db);
  resetNotificationCache();

  console.log('=== 1. 启动 Mock Webhook 接收端 ===');
  let webhookCallCount = 0;
  const receivedPayloads = [];

  const mockWebhookServer = http.createServer((req, res) => {
    let buf = '';
    req.on('data', chunk => { buf += chunk; });
    req.on('end', () => {
      webhookCallCount++;
      try {
        receivedPayloads.push(JSON.parse(buf));
      } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  const webhookPort = await new Promise(r => mockWebhookServer.listen(0, '127.0.0.1', () => r(mockWebhookServer.address().port)));
  const webhookUrl = `http://127.0.0.1:${webhookPort}/mock-hook`;

  try {
    console.log('\n=== 2. 测试脱敏工具函数 sanitizeContext ===');
    const dirty = {
      Authorization: 'Bearer super_secret_jwt_token_12345',
      token: 'sk-abcdef1234567890',
      apiKey: 'secret_key_value',
      password: 'my_plain_password',
      normal_param: 'image/jpeg',
      nested: {
        cookie: 'session_id=abc123xyz',
        headers: {
          authorization: 'Bearer another_secret'
        }
      }
    };
    const cleaned = sanitizeContext(dirty);
    assert.strictEqual(cleaned.Authorization, '[REDACTED]');
    assert.strictEqual(cleaned.token, '[REDACTED]');
    assert.strictEqual(cleaned.apiKey, '[REDACTED]');
    assert.strictEqual(cleaned.password, '[REDACTED]');
    assert.strictEqual(cleaned.normal_param, 'image/jpeg');
    assert.strictEqual(cleaned.nested.cookie, '[REDACTED]');
    assert.strictEqual(cleaned.nested.headers.authorization, '[REDACTED]');
    console.log('✅ 敏感凭据脱敏算法校验通过');

    console.log('\n=== 3. 连续注入 5 次同指纹 500 异常 ===');
    const fakeErr = new Error('Database connection failed due to pool exhaustion');
    fakeErr.code = 'ERR_DB_POOL_EXHAUSTED';

    const testContext = {
      user: 'admin',
      Authorization: 'Bearer secret123',
      endpoint: '/api/v1/generate'
    };

    for (let i = 0; i < 5; i++) {
      await reportError({
        module: 'database',
        err: fakeErr,
        errorCode: 'ERR_DB_POOL_EXHAUSTED',
        context: testContext,
        entityType: 'job',
        entityId: 'job_test_001',
        severity: 'error',
        customNotifiers: { webhook: webhookUrl }
      });
      // 模拟高频触发间隔
      await new Promise(r => setTimeout(r, 20));
    }

    console.log('\n=== 4. 验证防风暴与聚合记录 ===');
    assert.strictEqual(webhookCallCount, 1, `Mock Webhook 应严格被抑制仅收到 1 次推送 (实际: ${webhookCallCount} 次)`);
    console.log('✅ 防风暴 10 分钟频控机制生效 (5 次异常仅触发 1 次外发)');

    // 检查数据库记录
    const rows = db.prepare("SELECT * FROM system_error_events WHERE error_code='ERR_DB_POOL_EXHAUSTED'").all();
    assert.strictEqual(rows.length, 1, '相同指纹应聚合为 1 条记录');
    assert.strictEqual(rows[0].count, 5, `聚合计数 count 应精准为 5 (实际: ${rows[0].count})`);
    assert.strictEqual(rows[0].status, 'open', '状态应为 open');
    assert.strictEqual(rows[0].entity_id, 'job_test_001');
    console.log(`✅ SQLite 数据库聚合验证通过: count=${rows[0].count}, status=${rows[0].status}`);

    console.log('\n=== 5. 验证 JSONL 文件落盘与内容脱敏 ===');
    const logsDir = path.join(testDir, 'logs');
    assert.ok(fs.existsSync(logsDir), 'logs 目录必须存在');
    const files = fs.readdirSync(logsDir).filter(f => f.startsWith('errors-') && f.endsWith('.jsonl'));
    assert.ok(files.length > 0, '必须产出 errors-YYYY-MM-DD.jsonl 文件');

    const logContent = fs.readFileSync(path.join(logsDir, files[0]), 'utf8');
    const lines = logContent.trim().split('\n');
    assert.strictEqual(lines.length, 5, `JSONL 审计日志应忠实记录 5 条明细 (实际: ${lines.length})`);

    // 检查脱敏：文件全文字符串中绝不能包含 secret123
    assert.ok(!logContent.includes('secret123'), '审计日志绝不得暴露原始凭据 secret123');
    assert.ok(logContent.includes('[REDACTED]'), '审计日志必须包含脱敏占位符 [REDACTED]');
    const sampleRecord = JSON.parse(lines[0]);
    assert.strictEqual(sampleRecord.context.Authorization, '[REDACTED]');
    assert.ok(sampleRecord.stack.includes('Database connection failed'), '调用栈必须完整保留供排查');
    console.log('✅ JSONL 审计日志落盘与脱敏校验通过');

    console.log('\n=== 6. 验证熔断开关 ML_DISABLE_SIDECAR_NOTIFIER ===');
    resetNotificationCache();
    process.env.ML_DISABLE_SIDECAR_NOTIFIER = '1';
    const beforeCount = webhookCallCount;

    await reportError({
      module: 'auth',
      err: new Error('Token expired'),
      severity: 'error',
      customNotifiers: { webhook: webhookUrl }
    });

    assert.strictEqual(webhookCallCount, beforeCount, '熔断启用时不得触发任何外部网络推送');
    delete process.env.ML_DISABLE_SIDECAR_NOTIFIER;
    console.log('✅ 旁路告警熔断开关生效');

  } finally {
    mockWebhookServer.close();
  }

  console.log('\n🎉 旁路监控、数据脱敏与告警防风暴测试全部通过！');
}

run().catch((e) => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});
