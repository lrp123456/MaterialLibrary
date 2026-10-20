/**
 * AI 试验场能力目录测试
 * 覆盖：目录结构、就绪探测、submit 校验、gateway/umbra 路由、process job 单查
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_lab_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_secret_123';
process.env.ML_VIEWER_PASS = 'viewer_secret_456';
process.env.UMBRA_BASE_URL = 'http://127.0.0.1:9';
process.env.UMBRA_TOKEN = 'test-token';
process.env.BFF_PUBLIC_BASE = 'http://127.0.0.1:18799';
process.env.TPL_WALKTHROUGH = 'tpl_walk_test';
process.env.TPL_TOUCH_EDITOR = 'tpl_touch_test';

const { openDb } = require('../src/db');
const db = openDb(testDir);
const services = {
  db,
  config: { dataDir: testDir, bffPublicBase: 'http://127.0.0.1:18799' },
  logger: { info: () => {}, warn: () => {}, error: () => {} }
};

const lab = require('../src/lab');
const processSvc = require('../src/process');

function ok(name) { console.log('✅ ' + name); }

function seedAsset(fid, kind = 'image') {
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO assets (fid, kind, file_name, status, has_watermark, in_managed_zone, created_at, discovered_at, updated_at)
    VALUES (?, ?, ?, 'ready', 0, 0, ?, ?, ?)
  `).run(fid, kind, `${fid}.jpg`, now, now, now);
  // 落原图供 gateway 使用
  const origDir = path.join(testDir, 'cache', 'originals');
  fs.mkdirSync(origDir, { recursive: true });
  const p = path.join(origDir, `${fid}.jpg`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return fid;
}

(async () => {
  console.log('=== 1. 能力目录结构 ===');
  const cat = lab.getCapabilityCatalog(services);
  assert(cat.engines, '缺 engines');
  assert(Array.isArray(cat.groups) && cat.groups.length >= 3, '缺 groups');
  assert(Array.isArray(cat.entries) && cat.entries.length >= 15, 'entries 数量不足: ' + cat.entries.length);

  const ids = cat.entries.map(e => e.id);
  for (const must of [
    'umbra.expand', 'umbra.remove', 'umbra.insert', 'umbra.replace', 'umbra.upscale',
    'umbra.spatial_walkthrough',
    'gateway.outpaint', 'gateway.ratio_convert', 'gateway.watermark_remove', 'gateway.upscale',
    'gateway.video_transcode', 'gateway.video_frames', 'gateway.video_generate',
    'gen.image', 'gen.video'
  ]) {
    assert(ids.includes(must), `缺入口 ${must}`);
  }
  ok('内置入口齐全 (' + cat.entries.length + ')');

  console.log('=== 2. 就绪探测 ===');
  assert(cat.engines.umbra.ready === true, '测试环境应配了 umbra token+templates');
  assert(cat.engines.umbra.touchReady === true);
  assert(cat.engines.umbra.walkReady === true);
  const expand = cat.entries.find(e => e.id === 'umbra.expand');
  assert(expand.ready === true, 'expand 应 ready');
  // migrate 种子自带 unified_gateway base_url，按现有 isGatewayConfigured 规则视为已配置
  assert(cat.engines.gateway.ready === true, '默认种子网关应 ready');
  ok('Umbra ready / Gateway ready (种子 base_url)');

  // 禁用网关后应置灰
  db.prepare("UPDATE gen_adapters SET enabled=0 WHERE id='unified_gateway'").run();
  const catGwOff = lab.getCapabilityCatalog(services);
  assert(catGwOff.engines.gateway.ready === false, '禁用网关后应 not ready');
  assert(catGwOff.entries.find(e => e.id === 'gateway.outpaint').ready === false);
  assert(catGwOff.entries.find(e => e.id === 'gateway.outpaint').unavailableReason);
  ok('禁用网关后入口置灰');

  console.log('=== 3. 模板未配时 Umbra 入口置灰 ===');
  // DEFAULT_TOKEN 在模块加载时已捕获；清空运行时 TPL env 使 templates 为空
  const savedWalk = process.env.TPL_WALKTHROUGH;
  const savedTouch = process.env.TPL_TOUCH_EDITOR;
  process.env.TPL_WALKTHROUGH = '';
  process.env.TPL_TOUCH_EDITOR = '';
  db.prepare("DELETE FROM kv WHERE key IN ('TPL_TOUCH_EDITOR','TPL_WALKTHROUGH')").run();
  const cat2 = lab.getCapabilityCatalog(services);
  assert(cat2.engines.umbra.touchReady === false, 'touch 模板应 not ready');
  assert(cat2.engines.umbra.walkReady === false, 'walk 模板应 not ready');
  assert(cat2.engines.umbra.ready === false, '无模板时 overall not ready');
  assert(cat2.entries.find(e => e.id === 'umbra.expand').ready === false);
  assert(cat2.entries.find(e => e.id === 'umbra.expand').unavailableReason);
  ok('Umbra 模板未配置时置灰');

  // 恢复
  process.env.TPL_WALKTHROUGH = savedWalk;
  process.env.TPL_TOUCH_EDITOR = savedTouch;

  console.log('=== 4. submit 校验 ===');
  await assert.rejects(
    () => lab.submitLabRun(services, { entryId: 'nope' }),
    /未知入口/
  );
  // 网关仍处于禁用态
  await assert.rejects(
    () => lab.submitLabRun(services, { entryId: 'gateway.outpaint', fid: seedAsset('lab_g1') }),
    /未配置|未就绪/
  );
  await assert.rejects(
    () => lab.submitLabRun(services, { entryId: 'umbra.expand' }),
    /至少需要/
  );
  await assert.rejects(
    () => lab.submitLabRun(services, {
      entryId: 'umbra.spatial_walkthrough',
      fids: [seedAsset('lab_w1')]
    }),
    /至少需要/
  );
  ok('非法提交均被拒绝');

  console.log('=== 5. Umbra expand 提交路由 ===');
  const fid = seedAsset('lab_expand_1');
  const run = await lab.submitLabRun(services, {
    entryId: 'umbra.expand',
    fid,
    params: { expand_ratio: '16:9' },
    createdBy: 'tester'
  });
  assert.strictEqual(run.engine, 'umbra');
  assert.strictEqual(run.mode, 'async');
  assert(run.runId && String(run.runId).startsWith('task_'), '应返回 task_id');
  assert.strictEqual(run.status, 'pending');

  const st = lab.getLabRunStatus(services, 'umbra', run.runId);
  assert.strictEqual(st.engine, 'umbra');
  assert(['pending', 'running', 'success', 'failed'].includes(st.status));
  ok('expand 入队 + 状态查询');

  console.log('=== 6. Gateway 提交（重新启用 adapter）===');
  db.prepare(`
    INSERT OR REPLACE INTO gen_adapters (id, label, kind, builtin, protocol, base_url, secrets_json, config_json, enabled, created_at, updated_at)
    VALUES ('unified_gateway', '统一处理网关', 'image', 1, 'unified_gateway', 'http://127.0.0.1:8798', '{}', '{"submitPath":"/","pollPath":"/"}', 1, ?, ?)
  `).run(Date.now(), Date.now());
  const gfid = seedAsset('lab_gw_1');
  const cat3 = lab.getCapabilityCatalog(services);
  assert(cat3.engines.gateway.ready === true, '写入 adapter 后 gateway 应 ready');
  const gwRun = await lab.submitLabRun(services, {
    entryId: 'gateway.watermark_remove',
    fid: gfid,
    params: {}
  });
  assert.strictEqual(gwRun.engine, 'gateway');
  assert.strictEqual(gwRun.mode, 'async');
  const gwSt = lab.getLabRunStatus(services, 'gateway', gwRun.runId);
  assert.strictEqual(gwSt.status, 'queued');
  ok('gateway 入队 + getLabRunStatus');

  const jobById = processSvc.getProcessJob(db, Number(gwRun.runId));
  assert(jobById && jobById.action === 'watermark_remove');
  ok('process job 单查');

  console.log('=== 7. Gen 适配器未就绪时 entry 置灰 ===');
  const genImg = cat3.entries.find(e => e.id === 'gen.image');
  assert(genImg, 'gen.image 存在');
  // 无 image adapter 时 ready=false
  const hasImg = cat3.engines.gen.imageAdapters.length > 0;
  assert.strictEqual(genImg.ready, hasImg);
  ok('gen.image ready 跟随适配器');

  console.log('\n全部 lab 测试通过');
  try { db.close(); } catch {}
  process.exit(0);
})().catch(e => {
  console.error('❌ 测试失败:', e);
  try { db.close(); } catch {}
  process.exit(1);
});
