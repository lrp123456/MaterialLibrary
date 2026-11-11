/**
 * gen_jobs 三段式计时回归：云端渲染 / 超分 / 系统开销。
 *
 * 覆盖：
 *  - 百炼北京时间字符串解析与渲染进度曲线边界；
 *  - generateWanVideo 落 timing（优先百炼官方渲染时间戳，缺失时退回本地计时）与阶段回调顺序；
 *  - summarizeJobTiming 的分账公式、空输入与负值钳制；
 *  - 超分未配置密钥时 ok:false 且 timing 为 null，不抛异常。
 * 全程离线：global.fetch 打桩，不访问外网。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Readable } = require('stream');

const testDir = path.join(os.tmpdir(), 'dsh_gen_timing_' + Date.now());
fs.mkdirSync(path.join(testDir, 'cache', 'temp'), { recursive: true });
const services = { config: { dataDir: testDir } };

const {
  generateWanVideo,
  setPollDelay,
  parseWanTaskTime,
  renderingProgress,
} = require('../src/services/wan-video');
const { superResolveFromPreview } = require('../src/services/video-sr-local');
const { summarizeJobTiming } = require('../src/gen-jobs-worker');

function ok(name) { console.log('✅ ' + name); }

function makeFetch({ withUpstreamTimestamps }) {
  return async (url, opts = {}) => {
    const href = String(url);
    if (href === 'https://cdn.example/clip.mp4') {
      return { ok: true, status: 200, body: Readable.toWeb(Readable.from(Buffer.alloc(256, 7))) };
    }
    if (href.includes('/api/v1/tasks/')) {
      const output = { task_status: 'SUCCEEDED', video_url: 'https://cdn.example/clip.mp4' };
      if (withUpstreamTimestamps) {
        output.submit_time = '2026-11-11 13:47:25.452';
        output.scheduled_time = '2026-11-11 13:47:25.518';
        output.end_time = '2026-11-11 13:56:23.058';
      }
      return { ok: true, status: 200, json: async () => ({ output }) };
    }
    // 提交任务
    return { ok: true, status: 200, json: async () => ({ output: { task_id: 'task_timing_1' } }) };
  };
}

async function main() {
  // 1) 百炼时间戳解析：北京时间字符串，结果与机器时区无关
  const submit = parseWanTaskTime('2026-11-11 13:47:25.452');
  const end = parseWanTaskTime('2026-11-11 13:56:23.058');
  assert.strictEqual(end - submit, 537606, '上游纯渲染应为 8分57.606秒');
  assert.strictEqual(parseWanTaskTime(''), null);
  assert.strictEqual(parseWanTaskTime(null), null);
  assert.strictEqual(parseWanTaskTime('not-a-date'), null);
  ok('百炼北京时间戳解析正确，脏输入返回 null');

  // 2) 渲染进度曲线：15% 起步、单调递增、82% 封顶
  assert.strictEqual(renderingProgress(0) >= 15, true);
  assert.strictEqual(renderingProgress(0), 15);
  assert.ok(renderingProgress(120000) > renderingProgress(0));
  assert.ok(renderingProgress(600000) <= 82);
  assert.strictEqual(renderingProgress(10 ** 12), 82);
  ok('渲染进度曲线 15% 起步且封顶 82%');

  const savedKey = process.env.ALIBAILIAN_KEY;
  const savedBase = process.env.ALIBAILIAN_BASE_URL;
  const originalFetch = global.fetch;
  process.env.ALIBAILIAN_KEY = 'test-bailian-token';
  process.env.ALIBAILIAN_BASE_URL = 'https://llm-test.example.com';
  setPollDelay(0);

  try {
    // 3) 带百炼官方时间戳：renderUpstreamMs 取官方值，阶段回调按序到达
    const stages = [];
    global.fetch = makeFetch({ withUpstreamTimestamps: true });
    const r1 = await generateWanVideo(
      services,
      { prompt: '一镜到底客餐厅', resolution: '720P', duration: 15, ratio: '9:16' },
      { onStage: (s) => stages.push(s.key) }
    );
    assert.strictEqual(r1.taskId, 'task_timing_1');
    const t1 = r1.timing;
    assert.ok(t1, '返回值必须带 timing');
    assert.strictEqual(t1.renderUpstreamMs, 537606, '官方渲染耗时透传');
    // 假时间戳是冻结历史值，本地实时计时只校验有限非负；线上真实场景下本地值天然 ≥ 官方值
    assert.ok(Number.isFinite(t1.renderLocalMs) && t1.renderLocalMs >= 0);
    assert.ok(t1.prepareMs >= 0 && t1.submitMs >= 0 && t1.downloadMs >= 0 && t1.totalMs >= 0);
    assert.ok(t1.pollCount >= 1);
    assert.strictEqual(stages[0], 'wan_prepare');
    assert.ok(stages.indexOf('wan_submit') < stages.indexOf('wan_download'));
    assert.ok(fs.existsSync(r1.files[0].localPath));
    ok('万相 timing 含百炼官方渲染耗时，阶段回调顺序正确');

    // 4) 上游不回时间戳：renderUpstreamMs 为 null，本地计时兜底不崩
    global.fetch = makeFetch({ withUpstreamTimestamps: false });
    const r2 = await generateWanVideo(
      services,
      { prompt: '海边微风', resolution: '720P', duration: 5, ratio: '16:9' }
    );
    assert.strictEqual(r2.timing.renderUpstreamMs, null);
    assert.ok(Number.isFinite(r2.timing.renderLocalMs) && r2.timing.renderLocalMs >= 0);
    assert.ok(Number.isFinite(r2.timing.totalMs));
    ok('上游缺时间戳时本地计时兜底');
  } finally {
    global.fetch = originalFetch;
    setPollDelay(10000);
    if (savedKey === undefined) delete process.env.ALIBAILIAN_KEY;
    else process.env.ALIBAILIAN_KEY = savedKey;
    if (savedBase === undefined) delete process.env.ALIBAILIAN_BASE_URL;
    else process.env.ALIBAILIAN_BASE_URL = savedBase;
  }

  // 5) summarizeJobTiming：三段分账公式
  const row = { created_at: 1000, started_at: 2000 };
  const rawTiming = {
    totalMs: 100000,
    prepareMs: 3000,
    submitMs: 500,
    renderLocalMs: 80000,
    renderUpstreamMs: 75000,
    upstreamQueueMs: 66,
    pollCount: 50,
    pollDetectMs: 4000,
    downloadMs: 7000,
    upstream: { submit_time: 'x', scheduled_time: 'y', end_time: 'z' },
    sr: { uploadMs: 5000, submitMs: 300, processingMs: 12000, downloadMs: 2700, totalMs: 20000, pollCount: 8 },
  };
  const sum = summarizeJobTiming(rawTiming, row, 102000);
  assert.strictEqual(sum.queueMs, 1000, '排队=started-created');
  assert.strictEqual(sum.totalMs, 100000, '总耗时=completed-started');
  assert.strictEqual(sum.renderMs, 75000, '渲染优先取官方值');
  assert.strictEqual(sum.srMs, 20000);
  assert.strictEqual(sum.systemMs, 5000, '系统=总-渲染-超分');
  assert.strictEqual(sum.wan.pollCount, 50);
  assert.deepStrictEqual(sum.sr, rawTiming.sr);
  ok('summarizeJobTiming 渲染/超分/系统三段分账正确');

  // 6) 空输入返回 null（行里也没有 started_at，无法兜底总耗时）；系统开销不为负
  assert.strictEqual(summarizeJobTiming(null, {}, 100), null);
  assert.strictEqual(summarizeJobTiming({}, {}, 100), null);
  const clamped = summarizeJobTiming(
    { renderUpstreamMs: 9000, sr: { totalMs: 5000 } },
    { created_at: 0, started_at: 0 },
    10000
  );
  assert.strictEqual(clamped.systemMs, 0, '分账重叠时系统开销钳到 0 不为负');
  assert.strictEqual(clamped.renderMs, 9000);
  // 时钟回拨造出负总耗时时，totalMs 钳到 0，不输出负数
  const skewed = summarizeJobTiming({ renderLocalMs: 500 }, { created_at: 2000, started_at: 2000 }, 1000);
  assert.strictEqual(skewed.totalMs, 0);
  assert.strictEqual(skewed.queueMs, 0);
  ok('空 timing 返回 null，系统开销/负总耗时均钳制');

  // 7) 超分缺密钥：结构化失败、timing 为 null，不抛异常
  const savedAk = process.env.ALIYUN_ACCESS_KEY_ID;
  const savedSk = process.env.ALIYUN_ACCESS_KEY_SECRET;
  delete process.env.ALIYUN_ACCESS_KEY_ID;
  delete process.env.ALIYUN_ACCESS_KEY_SECRET;
  try {
    const localMp4 = path.join(testDir, 'cache', 'temp', 'model.mp4');
    fs.writeFileSync(localMp4, Buffer.alloc(128, 1));
    const sr = await superResolveFromPreview(services, '/api/cache/temp/model.mp4');
    assert.strictEqual(sr.ok, false);
    assert.strictEqual(sr.timing, null);
    assert.match(sr.error, /未配置阿里云密钥/);
    ok('超分缺密钥时安全改播原片且不带 timing');
  } finally {
    if (savedAk !== undefined) process.env.ALIYUN_ACCESS_KEY_ID = savedAk;
    if (savedSk !== undefined) process.env.ALIYUN_ACCESS_KEY_SECRET = savedSk;
  }

  console.log('✔ gen_jobs 三段式计时与万相/超分阶段埋点全部通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
