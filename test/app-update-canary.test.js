/**
 * App 灰度策略回归：百分比 rollout 稳定分桶、白名单优先、设备名册 sidecar。
 * 运行：node test/app-update-canary.test.js（全程临时目录，无外网/无 DB）
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const au = require(path.join(ROOT, 'src', 'app-update.js'));
const {
  pickLatest, rolloutBucket, publishUpdate, getUpdateState,
  recordDeviceSeen, listDevices, checkUpdate,
} = au;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-update-canary-'));
const config = { dataDir };

const canaryLatest = { versionCode: 2040008, wgtVersion: '2040008', type: 'wgt', url: '/files/x.wgt' };
const releaseLatest = { versionCode: 2040001, wgtVersion: '2040001', type: 'wgt', url: '/files/r.wgt' };

function grayManifest(over = {}) {
  return {
    latest: releaseLatest,
    channels: { internal: { latest: releaseLatest }, release: { latest: releaseLatest } },
    grayscale: { active: true, targetDevices: [], latest: canaryLatest, ...over },
  };
}

// ---------- 1. rolloutBucket 稳定性 ----------
assert.strictEqual(rolloutBucket(''), null, '空设备号不参与分桶');
assert.strictEqual(rolloutBucket('   '), null);
const b1 = rolloutBucket('android-id-abc');
assert.ok(Number.isInteger(b1) && b1 >= 0 && b1 < 100, '桶在 0-99');
assert.strictEqual(rolloutBucket('android-id-abc'), b1, '同设备号必须同桶');
assert.strictEqual(rolloutBucket('ANDROID-ID-ABC'), b1, '大小写归一');
let inBucket = 0;
for (let i = 0; i < 2000; i++) if (rolloutBucket('dev-' + i) < 50) inBucket++;
assert.ok(inBucket > 850 && inBucket < 1150, `pct=50 分布异常: ${inBucket}/2000`);

// ---------- 2. 缺省（无 rolloutPct）保持旧行为 ----------
const m = grayManifest();
assert.strictEqual(pickLatest(m, 'canary', 'dev-x', '', ''), canaryLatest, '缺省：尝鲜通道全量收灰度');
assert.strictEqual(pickLatest(m, 'internal', 'dev-x', '', ''), releaseLatest, '正式通道不收灰度');
assert.strictEqual(pickLatest(m, 'canary', '', '', '').url, canaryLatest.url, '缺省：无设备号也收');

// ---------- 3. 百分比门控 ----------
const m50 = grayManifest({ rolloutPct: 50 });
// 找一个桶内/桶外设备
let inId = null, outId = null;
for (let i = 0; i < 500 && !(inId && outId); i++) {
  const id = 'handset-' + i;
  if (rolloutBucket(id) < 50) inId = id; else outId = id;
}
assert.ok(inId && outId);
assert.strictEqual(pickLatest(m50, 'canary', inId, '', ''), canaryLatest, '桶内尝鲜设备收灰度');
assert.strictEqual(pickLatest(m50, 'canary', outId, '', ''), releaseLatest, '桶外尝鲜设备回落正式');
assert.strictEqual(pickLatest(m50, 'internal', inId, '', ''), releaseLatest, '非尝鲜通道永不收灰度');
assert.strictEqual(pickLatest(m50, 'canary', '', '', ''), releaseLatest, '无设备号不参与百分比');

const m0 = grayManifest({ rolloutPct: 0 });
assert.strictEqual(pickLatest(m0, 'canary', inId, '', ''), releaseLatest, 'pct=0 暂停全部下发');
const m100 = grayManifest({ rolloutPct: 100 });
assert.strictEqual(pickLatest(m100, 'canary', '', '', ''), canaryLatest, 'pct=100 无设备号也收');

// ---------- 4. 白名单优先且严格 ----------
const mWl = grayManifest({ targetDevices: ['hd1910'], rolloutPct: 0 });
assert.strictEqual(pickLatest(mWl, 'internal', 'uuid-1|HD1910', '', ''), canaryLatest, '白名单命中：通道无关，直接发');
assert.strictEqual(pickLatest(mWl, 'canary', outId, '', ''), releaseLatest, '白名单未命中：即便尝鲜+pct 也不发');
assert.strictEqual(pickLatest(mWl, 'internal', outId, 'Mozilla HD1910 Android', ''), canaryLatest, 'UA 型号命中');

// ---------- 5. publishUpdate 落盘 pct；白名单模式忽略 pct ----------
publishUpdate(config, {
  releaseMode: 'canary', versionCode: 2040008, wgtVersion: '2040008',
  type: 'wgt', url: '/files/x.wgt', rolloutPct: 30,
});
let st = getUpdateState(config);
assert.strictEqual(st.grayscale.rolloutPct, 30, 'pct 落盘');

publishUpdate(config, {
  releaseMode: 'canary', versionCode: 2040009, wgtVersion: '2040009',
  type: 'wgt', url: '/files/y.wgt', targetDevices: ['dev-a', 'dev-b'], rolloutPct: 30,
});
st = getUpdateState(config);
assert.strictEqual(st.grayscale.targetDevices.length, 2);
assert.ok(st.grayscale.rolloutPct === undefined, '白名单模式不接受 pct（白名单优先）');

publishUpdate(config, {
  releaseMode: 'canary', versionCode: 2040010, wgtVersion: '2040010',
  type: 'wgt', url: '/files/z.wgt', rolloutPct: 999,
});
st = getUpdateState(config);
assert.strictEqual(st.grayscale.rolloutPct, 100, 'pct 夹取到 100');

(async () => {
  // ---------- 6. checkUpdate 端到端 + 设备名册 ----------
  publishUpdate(config, {
    releaseMode: 'canary', versionCode: 2040020, wgtVersion: '2040020',
    type: 'wgt', url: '/files/c.wgt', rolloutPct: 100,
  });
  const r1 = await checkUpdate(config, {
    platform: 'android', versionCode: '2040001', wgtVersion: '2040001',
    channel: 'canary', deviceId: inId, userAgent: 'UA-X', clientIp: '192.168.1.31',
  });
  assert.strictEqual(r1.hasUpdate, true, '尝鲜设备在 pct=100 收到更新');

  const devices = listDevices(config);
  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].deviceId, inId);
  assert.strictEqual(devices[0].channel, 'canary');
  assert.strictEqual(devices[0].ip, '192.168.1.0', 'IP 末段脱敏');
  assert.ok(devices[0].userAgent.includes('UA-X'));

  // TTL 去抖：紧接着第二次报到不覆盖、hits 不增
  await checkUpdate(config, {
    platform: 'android', versionCode: '2040020', wgtVersion: '2040020',
    channel: 'internal', deviceId: inId, userAgent: 'UA-2', clientIp: '10.0.0.9',
  });
  const again = listDevices(config)[0];
  assert.strictEqual(again.hits, 1, 'TTL 内不重复落盘');
  assert.strictEqual(again.channel, 'canary', 'TTL 内不更新字段');

  // 空设备号不进名册
  await checkUpdate(config, {
    platform: 'android', versionCode: '1', channel: 'canary', deviceId: '',
  });
  assert.strictEqual(listDevices(config).length, 1, '无 deviceId 不建名册行');

  // ---------- 7. 名册 LRU 上限 ----------
  for (let i = 0; i < 502; i++) {
    recordDeviceSeen(config, { deviceId: 'bulk-' + i, channel: 'canary', clientIp: '1.2.3.4' });
  }
  const bulk = listDevices(config);
  assert.ok(bulk.length <= 500, `名册上限 500，实际 ${bulk.length}`);

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('✅ app-update-canary 全部通过（百分比分桶/白名单优先/设备名册/LRU）');
})();
