/**
 * AI 任务调度 + 多模态资产流 测试
 * 覆盖：表结构、enqueue、状态映射、quadToBbox、列表过滤、离线降级、Range 头解析逻辑
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const http = require('http');

const testDir = path.join(os.tmpdir(), 'dsh_ai_tasks_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_secret_123';
process.env.ML_VIEWER_PASS = 'viewer_secret_456';
process.env.UMBRA_BASE_URL = 'http://127.0.0.1:9'; // 不可达，测离线降级
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

const aiTasks = require('../src/ai-tasks');
const umbra = require('../src/umbra');

function ok(name) { console.log('✅ ' + name); }

(async () => {
  // --- 1. 表结构 ---
  console.log('=== 1. ai_tasks 表与 assets 补列 ===');
  assert(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='ai_tasks'").get().c === 1, 'ai_tasks 表缺失');
  const cols = db.prepare('PRAGMA table_info(assets)').all().map(c => c.name);
  assert(cols.includes('is_ai'), 'assets.is_ai 缺失');
  assert(cols.includes('source_asset_id'), 'assets.source_asset_id 缺失');
  assert(cols.includes('poster_path'), 'assets.poster_path 缺失');
  ok('Schema 迁移');

  // --- 2. 状态映射 ---
  console.log('=== 2. 引擎状态映射 ===');
  assert.strictEqual(umbra.mapEngineStatus('pending'), 'pending');
  assert.strictEqual(umbra.mapEngineStatus('running'), 'running');
  assert.strictEqual(umbra.mapEngineStatus('succeeded'), 'success');
  assert.strictEqual(umbra.mapEngineStatus('completed'), 'success');
  assert.strictEqual(umbra.mapEngineStatus('failed'), 'failed');
  assert.strictEqual(umbra.mapEngineStatus('canceled'), 'failed');
  ok('状态映射 pending/running/success/failed');

  // --- 3. quad → bbox ---
  console.log('=== 3. perspective_quad → bbox ===');
  const bbox = umbra.quadToBbox([
    { x: 10, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 300 }, { x: 10, y: 300 }
  ]);
  assert.strictEqual(bbox, '10,20,200,300');
  assert.strictEqual(umbra.quadToBbox([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }]), null);
  const pct = umbra.quadToBbox(
    [{ x: 25, y: 30 }, { x: 75, y: 28 }, { x: 80, y: 72 }, { x: 20, y: 75 }],
    { width: 1000, height: 2000, unit: 'percent' }
  );
  assert.strictEqual(pct, '200,560,800,1500');
  ok('quadToBbox');

  // --- 4. bindings 构造 ---
  console.log('=== 4. bindings 构造 ===');
  const wb = umbra.buildWalkthroughBindings({
    imageUrls: ['http://a/1.jpg', 'http://a/2.jpg'],
    cameraStyle: 'smooth_walk',
    aspectRatio: '16:9',
    sceneDuration: 4
  });
  assert.strictEqual(wb.images.length, 2);
  assert.strictEqual(wb.camera_style, 'smooth_walk');
  assert.strictEqual(wb.scene_duration, '4');
  const tb = umbra.buildTouchBindings({
    imageUrl: 'http://a/1.jpg',
    mode: 'remove',
    bbox: '1,2,3,4',
    maskUrl: 'http://a/mask.png',
    subjectUrl: 'http://a/sofa.jpg',
    quad: '10,20,200,20,200,300,10,300'
  });
  assert.strictEqual(tb.mode, 'remove');
  assert.strictEqual(tb.bbox, '1,2,3,4');
  assert.strictEqual(tb.mask, 'http://a/mask.png');
  assert.strictEqual(tb.subject, 'http://a/sofa.jpg');
  assert.ok(tb.quad);
  assert.throws(() => umbra.buildWalkthroughBindings({ imageUrls: ['http://a/1.jpg'] }), /至少/);
  ok('walkthrough / touch bindings');

  console.log('=== 4b. 涂抹栅格化 ===');
  const maskPath = path.join(testDir, 'stroke-mask.png');
  await umbra.rasterizeTouchMask({
    width: 200,
    height: 200,
    destPath: maskPath,
    strokes: [{ points: [{ x: 20, y: 20 }, { x: 80, y: 80 }], size: 40, unit: 'percent' }]
  });
  assert.ok(fs.existsSync(maskPath) && fs.statSync(maskPath).size > 0);
  ok('rasterizeTouchMask');

  // --- 5. enqueue ---
  console.log('=== 5. enqueueAiTask ===');
  const now = Date.now();
  const fid = 'src_img_001';
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, status, created_at)
    VALUES (?, 'image', 'living.jpg', 1080, 1920, 'ready', ?)
  `).run(fid, now);
  const fid2 = 'src_img_002';
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, status, created_at)
    VALUES (?, 'image', 'bedroom.jpg', 1080, 1920, 'ready', ?)
  `).run(fid2, now);

  const t1 = aiTasks.enqueueAiTask(db, {
    fid,
    type: 'spatial_walkthrough',
    taskId: 'task_client_abc123',
    payload: {
      camera_style: 'smooth_walk',
      aspect_ratio: '16:9',
      scene_duration: 4,
      ordered_fids: [{ fid, order: 1 }, { fid: fid2, order: 2 }]
    },
    createdBy: 'viewer'
  });
  assert.strictEqual(t1.taskId, 'task_client_abc123');
  assert.strictEqual(t1.status, 'pending');
  assert.strictEqual(t1.source_asset_id, fid);
  assert.strictEqual(t1.sourceFids.length, 2);
  ok('客户端 task_id 被采纳');

  // 冲突 task_id → 另造
  const t2 = aiTasks.enqueueAiTask(db, {
    fid,
    type: 'expand',
    taskId: 'task_client_abc123',
    payload: { expand_ratio: '9:16' }
  });
  assert.notStrictEqual(t2.taskId, 'task_client_abc123');
  assert.strictEqual(t2.type, 'expand');
  ok('task_id 冲突自动另造');

  // 非法 type
  assert.throws(() => aiTasks.enqueueAiTask(db, { fid, type: 'unknown_x' }), /不支持/);
  assert.throws(() => aiTasks.enqueueAiTask(db, { fid: 'nope', type: 'remove' }), /不存在/);
  ok('类型与资产校验');

  // --- 6. 最新查询 ---
  console.log('=== 6. listLatestByFid ===');
  const latest = aiTasks.listLatestByFid(db, fid);
  assert.strictEqual(latest.taskId, t2.taskId, '应返回最新 expand 任务');
  const walk = aiTasks.listLatestByFid(db, fid, 'spatial_walkthrough');
  assert.strictEqual(walk.taskId, t1.taskId);
  ok('按 fid / type 查最新');

  // --- 7. 公开字段 ---
  console.log('=== 7. toPublicTask ===');
  const pub = aiTasks.toPublicTask(t1);
  assert.strictEqual(pub.task_id, t1.taskId);
  assert.ok(['pending', 'running', 'success', 'failed'].includes(pub.status));
  ok('toPublicTask');

  // --- 8. 离线降级：startAiTask 引擎不可达 → failed ---
  console.log('=== 8. 引擎离线降级 ===');
  const startRes = await aiTasks.startAiTask(services, t1.taskId);
  assert.strictEqual(startRes.success, false);
  const failed = aiTasks.getAiTask(db, t1.taskId);
  assert.strictEqual(failed.status, 'failed');
  assert.ok(failed.error, '应记录错误信息');
  ok('离线提交落库 failed: ' + failed.error.slice(0, 60));

  // --- 9. 源图 URL ---
  console.log('=== 9. assetPublicUrl ===');
  const url = umbra.assetPublicUrl(services.config, db, fid);
  assert.ok(url.startsWith('http://127.0.0.1:18799/api/viewer/assets/'), url);
  assert.ok(url.includes('media_token='), '应带 media_token');
  ok('BFF_PUBLIC_BASE 拼 URL');

  // --- 10. HTTP 层：viewer 白名单 + 新端点 ---
  console.log('=== 10. HTTP API ===');
  const { handleApi } = require('../src/api');
  const auth = require('../src/auth');
  const login = auth.login(db, 'viewer', 'viewer_secret_456');

  // 插入 AI 成片资产
  const aiVid = 'ai_task_testvid_001';
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, size, width, height, duration_s, status, is_ai, source_asset_id, poster_path, source, created_at, discovered_at, updated_at)
    VALUES (?, 'video', 'AI漫游_x.mp4', 1024, 1920, 1080, 8.5, 'ready', 1, ?, ?, 'ai', ?, ?, ?)
  `).run(aiVid, fid, 'cache/ai_posters/' + aiVid + '.jpg', now, now, now);

  // 同步视频
  const syncVid = 'sync_vid_001';
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, size, width, height, duration_s, status, is_ai, source, created_at, discovered_at, updated_at)
    VALUES (?, 'video', 'phone.mp4', 2048, 1080, 1920, 12, 'ready', 0, 'sync', ?, ?, ?)
  `).run(syncVid, now, now, now);

  function req(method, urlPath, { token, body } = {}) {
    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        try {
          await handleApi(services, req, res, '/api');
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
        }
      });
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const r = http.request({
          host: '127.0.0.1', port, path: urlPath, method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: 'Bearer ' + token } : {})
          }
        }, (res2) => {
          let d = '';
          res2.on('data', c => d += c);
          res2.on('end', () => {
            server.close();
            let json = null;
            try { json = JSON.parse(d); } catch {}
            resolve({ status: res2.statusCode, body: json, raw: d, headers: res2.headers });
          });
        });
        r.on('error', (e) => { server.close(); resolve({ status: 0, error: e.message }); });
        if (body) r.write(JSON.stringify(body));
        r.end();
      });
    });
  }

  // POST /api/viewer/ai/tasks
  const submitRes = await req('POST', '/api/viewer/ai/tasks', {
    token: login.token,
    body: {
      fid,
      type: 'remove',
      task_id: 'task_http_remove_1',
      payload: { perspective_quad: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }
    }
  });
  assert.strictEqual(submitRes.status, 200);
  assert.strictEqual(submitRes.body.success, true);
  assert.strictEqual(submitRes.body.data.task_id, 'task_http_remove_1');
  assert.strictEqual(submitRes.body.data.status, 'pending');
  ok('POST /ai/tasks');

  // GET /api/viewer/ai/tasks/:taskId
  const getRes = await req('GET', '/api/viewer/ai/tasks/task_http_remove_1', { token: login.token });
  assert.strictEqual(getRes.status, 200);
  assert.strictEqual(getRes.body.data.type, 'remove');
  ok('GET /ai/tasks/:taskId');

  // GET /api/viewer/assets/:fid/ai/tasks
  const latestRes = await req('GET', `/api/viewer/assets/${fid}/ai/tasks`, { token: login.token });
  assert.strictEqual(latestRes.status, 200);
  assert.strictEqual(latestRes.body.data.task_id, 'task_http_remove_1');
  ok('GET /assets/:fid/ai/tasks 最新');

  // 列表 media_type=video & video_source=ai
  const listAi = await req('GET', '/api/viewer/assets?media_type=video&video_source=ai&skip_facets=1', { token: login.token });
  assert.strictEqual(listAi.status, 200);
  const aiItems = listAi.body.data.items || [];
  assert.ok(aiItems.some(x => x.fid === aiVid), '应含 AI 视频');
  assert.ok(!aiItems.some(x => x.fid === syncVid), '不应含同步视频');
  assert.ok(aiItems.find(x => x.fid === aiVid).source_asset, '应带 source_asset');
  assert.strictEqual(aiItems.find(x => x.fid === aiVid).media_type, 'video');
  assert.strictEqual(aiItems.find(x => x.fid === aiVid).is_ai, 1);
  ok('列表 media_type=video & video_source=ai + source_asset');

  const listSync = await req('GET', '/api/viewer/assets?media_type=video&video_source=sync&skip_facets=1', { token: login.token });
  const syncItems = listSync.body.data.items || [];
  assert.ok(syncItems.some(x => x.fid === syncVid));
  assert.ok(!syncItems.some(x => x.fid === aiVid));
  ok('列表 video_source=sync');

  const listImg = await req('GET', '/api/viewer/assets?media_type=image&skip_facets=1', { token: login.token });
  const imgItems = listImg.body.data.items || [];
  assert.ok(imgItems.some(x => x.fid === fid));
  assert.ok(!imgItems.some(x => x.fid === aiVid));
  ok('列表 media_type=image');

  // 详情 source_asset
  const detailRes = await req('GET', `/api/viewer/assets/${aiVid}`, { token: login.token });
  assert.strictEqual(detailRes.status, 200);
  assert.ok(detailRes.body.data.asset.source_asset);
  assert.strictEqual(detailRes.body.data.asset.source_asset.fid, fid);
  assert.strictEqual(detailRes.body.data.asset.is_ai, 1);
  ok('详情 source_asset / is_ai');

  // poster 无文件时 404
  const posterRes = await req('GET', `/api/viewer/assets/${aiVid}/poster`, { token: login.token });
  assert.strictEqual(posterRes.status, 404);
  ok('poster 缺文件 404');

  // poster 有文件时 200
  const posterAbs = path.join(testDir, 'cache', 'ai_posters', aiVid + '.jpg');
  fs.mkdirSync(path.dirname(posterAbs), { recursive: true });
  fs.writeFileSync(posterAbs, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const posterRes2 = await req('GET', `/api/viewer/assets/${aiVid}/poster`, { token: login.token });
  assert.strictEqual(posterRes2.status, 200);
  assert.ok(String(posterRes2.headers['content-type']).includes('image/jpeg'));
  ok('poster 200');

  // 未登录 401
  const noAuth = await req('GET', '/api/viewer/ai/tasks/task_http_remove_1');
  assert.strictEqual(noAuth.status, 401);
  ok('未登录 401');

  // 白名单外 404（viewer 不能打管理端）
  const notAllowed = await req('POST', '/api/viewer/scan', { token: login.token, body: {} });
  assert.strictEqual(notAllowed.status, 404);
  ok('白名单外 404');

  console.log('\n🎉 AI 任务调度测试全部通过');
  process.exit(0);
})().catch(e => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});
