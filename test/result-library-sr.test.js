/**
 * 入库、临时令牌、原生分辨率、超分按需触发、万相走百炼、任务取消。
 * 单元测试覆盖：x2 档会发起超分、纯分辨率不发起、百炼提交和公网下载。
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_result_sr_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
process.env.ML_DATA_DIR = testDir;
delete process.env.BFF_PUBLIC_BASE;
delete process.env.PUBLIC_BASE_URL;

const { openDb } = require('../src/db');
const db = openDb(testDir);
const services = {
  db,
  config: { dataDir: testDir },
  logger: { info() {}, warn() {}, error() {} },
};
const { registerGenerated } = require('../src/shelf-lineage');
const auth = require('../src/auth');
const { seedanceParamsNeedRepair, DEFAULT_MODEL_CONTRACTS, VIDEO_RESOLUTIONS_SIX } = require('../src/models-contract');
const { superResolveFromPreview } = require('../src/services/video-sr-local');
const { classifyJobStatus, uploadLocalForViapi, isShanghaiOssUrl } = require('../src/services/aliyun-video-sr');
const { generateWanVideo, mapResolution, buildSubmitBody, setPollDelay } = require('../src/services/wan-video');
const { chooseFetchUrl } = require('../src/services/video-sr-local');
const { PUBLIC_MODEL_IDS } = require('../src/studio-acl');
const { enqueueGenJob, cancelGenJob, getGenJob } = require('../src/gen-jobs');
const { abortJob } = require('../src/gen-jobs-worker');
const { runGeneration } = require('../src/gen-submit');

function ok(name) { console.log('✅ ' + name); }

(async () => {
  const tempDir = path.join(testDir, 'cache', 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  await assert.rejects(
    () => registerGenerated(services, { previewUrl: '/api/cache/temp/gone.mp4' }),
    /临时文件已清理，请重新生成/
  );
  ok('临时文件缺失有单独提示');

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const server = http.createServer((req, res) => {
    if (String(req.url || '').endsWith('.jpg')) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpeg.length });
      res.end(jpeg);
      return;
    }
    const body = Buffer.from('remote-video');
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const filed = await registerGenerated(services, {
      previewUrl: `http://127.0.0.1:${port}/vendor/still.jpg`,
      prompt: '远程成片',
      mode: 'image',
    });
    assert.ok(filed.fid);
    const row = db.prepare('SELECT file_name, kind FROM assets WHERE fid=?').get(filed.fid);
    assert.strictEqual(row.kind, 'image');
    assert.ok(fs.existsSync(path.join(tempDir, row.file_name)));
    await assert.rejects(
      () => registerGenerated(services, {
        previewUrl: `http://127.0.0.1:${port}/vendor/clip.mp4`,
        prompt: '远程视频',
        mode: 'video',
      }),
      /封面没有生成，成片未入库/
    );
    const leftover = db.prepare("SELECT COUNT(*) AS n FROM assets WHERE kind='video'").get();
    assert.strictEqual(leftover.n, 0);
    const recovered = await registerGenerated(services, {
      previewUrl: '/api/cache/temp/missing-local.jpg',
      vendorUrl: `http://127.0.0.1:${port}/vendor/still.jpg`,
      prompt: '临时文件没了，改拉公网原片',
      mode: 'image',
    });
    assert.ok(recovered.fid);
    const recoveredRow = db.prepare('SELECT file_name FROM assets WHERE fid=?').get(recovered.fid);
    assert.ok(fs.existsSync(path.join(tempDir, recoveredRow.file_name)));
  } finally {
    server.close();
  }
  ok('远程结果先下载再入库，封面失败不留视频记录');

  const token = auth.generateMediaToken(auth.tempMediaSubject('clip.mp4'), 60, testDir);
  assert.strictEqual(auth.verifyMediaToken(auth.tempMediaSubject('clip.mp4'), token, testDir), true);
  assert.strictEqual(auth.verifyMediaToken(auth.tempMediaSubject('other.mp4'), token, testDir), false);
  ok('临时文件令牌只放行对应文件');

  // 1. 分辨率菜单六档断言
  const seedance = DEFAULT_MODEL_CONTRACTS.find((item) => item.id === 'seedance2_0');
  const resolution = seedance.params.find((item) => item.key === 'resolution');
  assert.deepStrictEqual(resolution.options, [
    '480p',
    '480px2（超分）',
    '720p',
    '720px2（超分）',
    '1080p',
    '1080px2（超分）',
  ]);
  assert.strictEqual(resolution.default, '720px2（超分）');
  assert.strictEqual(seedanceParamsNeedRepair(seedance.params), false);
  assert.strictEqual(seedanceParamsNeedRepair([
    { key: 'resolution', options: ['480p', '720p', '1080p'] },
    { key: 'duration', type: 'duration', max: 15 },
  ]), true);
  assert.strictEqual(seedanceParamsNeedRepair([
    { key: 'resolution', options: ['480p_sr2x', '720p'] },
    { key: 'duration', type: 'duration', max: 15 },
  ]), true);
  ok('万相与 Seedance 分辨率改为六档并默认 720px2（超分）');

  fs.writeFileSync(path.join(tempDir, 'model.mp4'), Buffer.from('model-original'));
  const savedAk = process.env.ALIYUN_ACCESS_KEY_ID;
  const savedSk = process.env.ALIYUN_ACCESS_KEY_SECRET;
  delete process.env.ALIYUN_ACCESS_KEY_ID;
  delete process.env.ALIYUN_ACCESS_KEY_SECRET;
  const sr = await superResolveFromPreview(services, '/api/cache/temp/model.mp4');
  if (savedAk === undefined) delete process.env.ALIYUN_ACCESS_KEY_ID;
  else process.env.ALIYUN_ACCESS_KEY_ID = savedAk;
  if (savedSk === undefined) delete process.env.ALIYUN_ACCESS_KEY_SECRET;
  else process.env.ALIYUN_ACCESS_KEY_SECRET = savedSk;
  assert.strictEqual(sr.ok, false);
  assert.strictEqual(sr.modelVideoUrl, '/api/cache/temp/model.mp4');
  assert.match(sr.error, /未配置阿里云密钥/);
  ok('本地成片超分不依赖本服务公网地址');

  assert.strictEqual(
    chooseFetchUrl({ vendorUrl: '' }, 'https://ark.example/content/video.mp4'),
    'https://ark.example/content/video.mp4'
  );
  assert.strictEqual(chooseFetchUrl({ vendorUrl: 'http://127.0.0.1:30001/api/cache/temp/a.mp4' }, ''), '');
  ok('超分优先用模型返回的公网视频地址');

  // 2. 万相百炼异步任务断言
  assert.ok(PUBLIC_MODEL_IDS.includes('wan3_0_video'));
  assert.strictEqual(mapResolution('720px2（超分）'), '720P');
  assert.strictEqual(mapResolution('480p'), '480P');
  assert.strictEqual(mapResolution('1080px2（超分）'), '1080P');

  const savedBailianKey = process.env.ALIBAILIAN_KEY;
  const savedBailianBase = process.env.ALIBAILIAN_BASE_URL;
  delete process.env.ALIBAILIAN_KEY;
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error('不应发出网络请求');
  };
  try {
    await assert.rejects(
      () => generateWanVideo(services, { prompt: '一只猫' }),
      /未配置 ALIBAILIAN_KEY/
    );
    assert.strictEqual(called, false);
  } finally {
    global.fetch = originalFetch;
    if (savedBailianKey === undefined) delete process.env.ALIBAILIAN_KEY;
    else process.env.ALIBAILIAN_KEY = savedBailianKey;
  }
  ok('万相缺百炼密钥时不发请求，提示未配置 ALIBAILIAN_KEY');

  process.env.ALIBAILIAN_KEY = 'test-bailian-token';
  process.env.ALIBAILIAN_BASE_URL = 'https://llm-test.example.com';
  setPollDelay(0);
  const seen = [];
  global.fetch = async (url, opts = {}) => {
    const href = String(url);
    seen.push({ href, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body || '' });
    const { Readable } = require('stream');
    if (href === 'https://cdn.example/clip.mp4') {
      assert.ok(!opts.headers || !opts.headers.Authorization);
      return { ok: true, status: 200, body: Readable.toWeb(Readable.from(Buffer.alloc(128, 1))) };
    }
    if (href.includes('/api/v1/tasks/task_local')) {
      return { ok: true, status: 200, json: async () => ({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.example/clip.mp4' } }) };
    }
    if ((opts.method || 'GET') === 'POST') {
      return { ok: true, status: 200, json: async () => ({ output: { task_id: 'task_local' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ output: { task_id: 'task_local', task_status: 'SUCCEEDED' } }) };
  };
  try {
    const body = buildSubmitBody({ prompt: '海边', resolution: '720px2（超分）', duration: 5, ratio: '16:9' }, []);
    assert.strictEqual(body.model, 'wan3.0-video');
    assert.strictEqual(body.parameters.resolution, '720P');
    assert.strictEqual(body.parameters.duration, 5);
    const filed = await generateWanVideo(services, { prompt: '海边', resolution: '720px2（超分）', duration: 5, ratio: '16:9' });
    assert.ok(filed.files[0].previewUrl.includes('/api/cache/temp/wan_task_local.mp4'));
    assert.strictEqual(filed.files[0].remoteUrl, 'https://cdn.example/clip.mp4');
    assert.ok(seen.some((item) => item.method === 'POST' && item.href === 'https://llm-test.example.com/api/v1/services/aigc/video-generation/video-synthesis'));
    assert.ok(seen.some((item) => item.href === 'https://llm-test.example.com/api/v1/tasks/task_local'));
    const post = seen.find((item) => item.method === 'POST');
    assert.strictEqual(post.headers.Authorization, 'Bearer test-bailian-token');
    assert.strictEqual(post.headers['X-DashScope-Async'], 'enable');
    assert.ok(fs.existsSync(path.join(tempDir, 'wan_task_local.mp4')));
  } finally {
    global.fetch = originalFetch;
    setPollDelay(10000);
    if (savedBailianKey === undefined) delete process.env.ALIBAILIAN_KEY;
    else process.env.ALIBAILIAN_KEY = savedBailianKey;
    if (savedBailianBase === undefined) delete process.env.ALIBAILIAN_BASE_URL;
    else process.env.ALIBAILIAN_BASE_URL = savedBailianBase;
  }
  ok('万相通过百炼 DashScope 异步提交并下载公网视频');

  // 3. 超分按需触发与纯分辨率跳过超分断言
  process.env.ALIBAILIAN_KEY = 'test-bailian-token';
  process.env.ALIBAILIAN_BASE_URL = 'https://llm-test.example.com';
  setPollDelay(0);
  global.fetch = async (url, opts = {}) => {
    const href = String(url);
    const { Readable } = require('stream');
    if (href === 'https://cdn.example/clip.mp4') {
      return { ok: true, status: 200, body: Readable.toWeb(Readable.from(Buffer.alloc(128, 1))) };
    }
    if (href.includes('/api/v1/tasks/task_local')) {
      return { ok: true, status: 200, json: async () => ({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.example/clip.mp4' } }) };
    }
    if ((opts.method || 'GET') === 'POST') {
      return { ok: true, status: 200, json: async () => ({ output: { task_id: 'task_local' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ output: { task_id: 'task_local', task_status: 'SUCCEEDED' } }) };
  };
  try {
    // 纯 720p 档：不调用超分，srStatus 为 null
    const pureRes = await runGeneration(services, {
      model: 'wan3_0_video',
      modality: 'video',
      prompt: '海边微风',
      resolution: '720p',
      duration: 5,
    });
    assert.strictEqual(pureRes.srStatus, null);
    assert.strictEqual(pureRes.resolution, '720p');

    // 720px2（超分）档：发起超分（未配阿里云密钥时进入 failed 改播原片逻辑，保留对比）
    const srRes = await runGeneration(services, {
      model: 'wan3_0_video',
      modality: 'video',
      prompt: '海边微风',
      resolution: '720px2（超分）',
      duration: 5,
    });
    assert.ok(['done', 'failed'].includes(srRes.srStatus));
    assert.ok(srRes.videoUrl);
  } finally {
    global.fetch = originalFetch;
    setPollDelay(10000);
    if (savedBailianKey === undefined) delete process.env.ALIBAILIAN_KEY;
    else process.env.ALIBAILIAN_KEY = savedBailianKey;
    if (savedBailianBase === undefined) delete process.env.ALIBAILIAN_BASE_URL;
    else process.env.ALIBAILIAN_BASE_URL = savedBailianBase;
  }
  ok('分辨率决定是否超分：x2 档触发超分流水线，纯分辨率不调用超分');

  // 4. 任务取消断言
  const enq = enqueueGenJob(db, {
    model: 'wan3_0_video',
    modality: 'video',
    prompt: '待取消的任务',
    userId: 1,
    sessionId: 'sess_cancel_test',
  });
  assert.ok(enq.jobId);
  assert.strictEqual(enq.status, 'queued');

  const cancelResult = cancelGenJob(db, enq.jobId, 1);
  assert.strictEqual(cancelResult.success, true);
  assert.strictEqual(cancelResult.status, 'cancelled');

  const cancelledRow = getGenJob(db, enq.jobId);
  assert.strictEqual(cancelledRow.status, 'cancelled');
  assert.ok(cancelledRow.completed_at);
  ok('后台任务支持优雅取消与状态流转');

  assert.strictEqual(classifyJobStatus('PROCESS_SUCCESS'), 'success');
  assert.strictEqual(classifyJobStatus('SUCCESS'), 'success');
  assert.strictEqual(classifyJobStatus('PROCESSING'), 'pending');
  assert.strictEqual(classifyJobStatus('PROCESS_FAILED'), 'fail');
  assert.strictEqual(classifyJobStatus('TIMEOUT_FAILED'), 'fail');
  ok('超分任务认得出处理成功');

  assert.strictEqual(isShanghaiOssUrl('http://viapi-customer-temp.oss-cn-shanghai.aliyuncs.com/a/b.mp4'), true);
  assert.strictEqual(isShanghaiOssUrl('https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/a.mp4'), false);
  const clip = path.join(tempDir, 'local-clip.mp4');
  fs.writeFileSync(clip, Buffer.alloc(128, 2));
  const savedAk2 = process.env.ALIYUN_ACCESS_KEY_ID;
  const savedSk2 = process.env.ALIYUN_ACCESS_KEY_SECRET;
  process.env.ALIYUN_ACCESS_KEY_ID = 'LTAI_TEST_ONLY';
  process.env.ALIYUN_ACCESS_KEY_SECRET = 'test-secret';
  const seenUpload = [];
  global.fetch = async (url, opts = {}) => {
    seenUpload.push({ href: String(url), method: opts.method || 'GET' });
    if (String(url).includes('viapiutils.cn-shanghai.aliyuncs.com')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          Data: { AccessKeyId: 'STS.TEST', AccessKeySecret: 'sts-secret', SecurityToken: 'sts-token' },
        }),
      };
    }
    if (String(url).includes('viapi-customer-temp.oss-cn-shanghai.aliyuncs.com') && opts.method === 'PUT') {
      assert.strictEqual(opts.headers['x-oss-security-token'], 'sts-token');
      return { ok: true, status: 200, text: async () => '' };
    }
    throw new Error('不应请求超分算法');
  };
  try {
    const uploaded = await uploadLocalForViapi(clip);
    const parsed = new URL(uploaded);
    assert.strictEqual(parsed.hostname, 'viapi-customer-temp.oss-cn-shanghai.aliyuncs.com');
    assert.ok(parsed.pathname.startsWith('/LTAI_TEST_ONLY/'));
    assert.ok(parsed.pathname.endsWith('/local-clip.mp4'));
    assert.ok(seenUpload.some((item) => item.method === 'PUT'));
    assert.ok(seenUpload.every((item) => !item.href.includes('videoenhan')));
  } finally {
    global.fetch = originalFetch;
    if (savedAk2 === undefined) delete process.env.ALIYUN_ACCESS_KEY_ID;
    else process.env.ALIYUN_ACCESS_KEY_ID = savedAk2;
    if (savedSk2 === undefined) delete process.env.ALIYUN_ACCESS_KEY_SECRET;
    else process.env.ALIYUN_ACCESS_KEY_SECRET = savedSk2;
  }
  ok('本地视频先上传到上海临时 OSS');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
