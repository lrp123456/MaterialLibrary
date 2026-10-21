const { openDb } = require('../src/db');
const { syncEndpointToLegacyTables } = require('../src/models-contract');
const { applyRuntimeConfig } = require('../src/runtime-config');

async function run() {
  const db = openDb('./data');

  console.log('--- Testing Batch D: Architecture & Unwired Fixes ---');

  // 1. 测试四套模型表同步桥接器
  const testUrl = 'https://test-sync-url-' + Date.now() + '.volces.com/api/v3';
  db.prepare("UPDATE llm_endpoints SET base_url = ? WHERE id = 'volc_ark'").run(testUrl);
  syncEndpointToLegacyTables(db);

  const provRow = db.prepare("SELECT base_url FROM llm_providers WHERE id = 'volc_ark' OR id = 'volcengine'").get();
  if (!provRow || provRow.base_url !== testUrl) {
    console.error('FAIL: llm_providers base_url should sync with llm_endpoints, got:', provRow);
    process.exit(1);
  }
  console.log('[PASS] syncEndpointToLegacyTables synced successfully to llm_providers');

  // 2. 测试 applyRuntimeConfig
  const mockInterpreter = { tagConcurrency: 1, restageConcurrency: 1, concurrency: 2 };
  db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('runtime_config', ?)").run(JSON.stringify({
    tag_concurrency: 12,
    restage_concurrency: 5,
    http_proxy: 'http://127.0.0.1:7890'
  }));
  applyRuntimeConfig(db, { interpreter: mockInterpreter });

  if (mockInterpreter.tagConcurrency !== 12 || mockInterpreter.restageConcurrency !== 5) {
    console.error('FAIL: applyRuntimeConfig failed to update interpreter concurrency, got:', mockInterpreter);
    process.exit(1);
  }
  if (process.env.HTTP_PROXY !== 'http://127.0.0.1:7890') {
    console.error('FAIL: applyRuntimeConfig failed to update process.env.HTTP_PROXY, got:', process.env.HTTP_PROXY);
    process.exit(1);
  }
  console.log('[PASS] applyRuntimeConfig updated interpreter and env successfully');

  // 恢复代理
  delete process.env.HTTP_PROXY;
  delete process.env.http_proxy;

  console.log('PASS: Batch D verified!');
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
