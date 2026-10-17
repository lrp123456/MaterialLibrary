/**
 * 私域人像库与豆包音乐的纯规则，以及带假火山客户端的入库。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const sharp = require('sharp');

process.env.BFF_PUBLIC_BASE = 'http://127.0.0.1:18799';
delete process.env.ASSET_PUBLIC_BASE;
delete process.env.VOLC_ACCESSKEY;
delete process.env.VOLC_SECRETKEY;
delete process.env.PORTRAIT_AK;
delete process.env.PORTRAIT_SK;
process.env.MLS_FETCH_SECRET = 'test-fetch-secret';

const {
  assertPublicHttpsBase,
  validateImageMeta,
  shapeVolcVideo,
  mergePrompt,
} = require('../src/portrait-contract');
const { buildSongBody, buildBgmBody, stripVendorPayload } = require('../src/doubao-music');
const portraitLib = require('../src/portrait-library');
const { openDb } = require('../src/db');

function ok(name) {
  console.log('✅ ' + name);
}

function throws(fn, pattern) {
  assert.throws(fn, (err) => {
    assert.match(err.message, pattern);
    return true;
  });
}

throws(() => assertPublicHttpsBase('http://127.0.0.1:18799'), /火山无法/);
throws(() => assertPublicHttpsBase('https://localhost/library'), /内网|本机/);
throws(() => assertPublicHttpsBase('https://192.168.1.8'), /内网|本机/);
throws(() => assertPublicHttpsBase('https://10.0.0.4'), /内网|本机/);
throws(() => assertPublicHttpsBase(''), /未配置/);
assert.strictEqual(assertPublicHttpsBase('https://library.example.com/'), 'https://library.example.com');
ok('公网地址拒绝本机和内网');

throws(() => validateImageMeta({ width: 300, height: 800, bytes: 2000, fileName: 'a.jpg' }), /300, 6000/);
throws(() => validateImageMeta({ width: 6000, height: 800, bytes: 2000, fileName: 'a.jpg' }), /300, 6000/);
throws(() => validateImageMeta({ width: 400, height: 1000, bytes: 2000, fileName: 'a.jpg' }), /0\.4, 2\.5/);
throws(() => validateImageMeta({ width: 2500, height: 1000, bytes: 2000, fileName: 'a.jpg' }), /0\.4, 2\.5/);
throws(() => validateImageMeta({ width: 800, height: 800, bytes: 30 * 1024 * 1024, fileName: 'a.jpg' }), /30 MB/);
const good = validateImageMeta({ width: 800, height: 1200, bytes: 2000, fileName: 'a.png' });
assert.strictEqual(good.width, 800);
ok('图片宽高比与体积按开区间校验');

const both = buildSongBody({
  lyrics: '记得那一天我们相恋很久',
  prompt: '关于星空的歌',
  duration: 45,
  lang: '普通话',
  jobId: 'job-1',
});
assert.strictEqual(both.Lyrics, '记得那一天我们相恋很久');
assert.strictEqual(both.Prompt, undefined);
assert.strictEqual(both.ModelVersion, 'v5.0');
assert.strictEqual(both.SkipCopyCheck, false);
assert.strictEqual(both.AigcWatermark, false);
assert.strictEqual(both.ImplicitWaterMark.Enable, true);
assert.strictEqual(both.ImplicitWaterMark.ContentProducer, '素材库');
assert.strictEqual(both.Genre, undefined);

const promptOnly = buildSongBody({ prompt: '关于星空的歌', lang: 'English', jobId: 'job-2' });
assert.strictEqual(promptOnly.Prompt, '关于星空的歌');
assert.strictEqual(promptOnly.Lyrics, undefined);
assert.strictEqual(promptOnly.Lang, 'English');
throws(() => buildSongBody({ lyrics: '', prompt: '' }), /提示词或歌词/);
ok('歌曲歌词与提示词互斥');

const bgm = buildBgmBody({ prompt: '咖啡馆里的钢琴，时长大约一分钟', duration: 20, jobId: 'job-3' });
assert.strictEqual(bgm.Version, 'v5.0');
assert.strictEqual(bgm.Duration, 30);
assert.strictEqual(bgm.EnableInputRewrite, false);
assert.strictEqual(bgm.Genre, undefined);
assert.strictEqual(bgm.Mood, undefined);
throws(() => buildBgmBody({ prompt: 'soft piano in a cafe' }), /中文/);
ok('纯音乐只收中文描述');

throws(() => shapeVolcVideo({
  isVolc: false,
  model: 'agnes-video-2.5-flash',
  prompt: '走路',
  portraits: [{ volc_asset_id: 'asset-1', groupName: '角色A' }],
}), /Seedance/);
ok('非 Seedance 带人像会被拒绝');

const shaped = shapeVolcVideo({
  isVolc: true,
  model: 'doubao-seedance-2-0-260128',
  prompt: '【图片说明】旧说明\n女孩整理柜台上的物品',
  images: ['https://cdn.example/first.jpg', 'https://cdn.example/jar.jpg'],
  genMode: 'image_to_video',
  ratio: '16:9',
  duration: 11,
  portraits: [{ volc_asset_id: 'asset-2026', groupName: '角色A' }],
});
assert.strictEqual(shaped.content[1].role, 'first_frame');
assert.strictEqual(shaped.content[1].image_url.url, 'https://cdn.example/first.jpg');
assert.strictEqual(shaped.content[2].image_url.url, 'asset://asset-2026');
assert.strictEqual(shaped.content[2].role, 'reference_image');
assert.strictEqual(shaped.content[3].image_url.url, 'https://cdn.example/jar.jpg');
assert.match(shaped.content[0].text, /图片1是首帧/);
assert.match(shaped.content[0].text, /图片2是角色A的形象/);
assert.doesNotMatch(shaped.content[0].text, /asset-2026/);
assert.strictEqual((shaped.content[0].text.match(/【图片说明】/g) || []).length, 1);
assert.match(shaped.content[0].text, /女孩整理柜台上的物品/);
assert.strictEqual(shaped.duration, 11);
const again = mergePrompt(shaped.content[0].text, shaped.caption);
assert.strictEqual((again.match(/【图片说明】/g) || []).length, 1);
ok('图片序号与 content 顺序一致，首帧是图片1');

const stripped = stripVendorPayload({
  Result: { SongDetail: { AudioUrl: 'https://v3-default.douyinvod.com/a.mp3', Duration: 60 } },
});
const packed = JSON.stringify(stripped);
assert.doesNotMatch(packed, /douyinvod|AudioUrl/);
assert.strictEqual(stripped.Result.SongDetail.Duration, 60);
ok('转存结果去掉火山音频地址');

async function integration() {
  const testDir = path.join(os.tmpdir(), 'dsh_portrait_music_' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  const db = openDb(testDir);
  const services = {
    db,
    config: { dataDir: testDir },
    logger: { info() {}, warn() {}, error() {} },
  };
  process.env.VOLC_ACCESSKEY = 'ak';
  process.env.VOLC_SECRETKEY = 'sk';
  process.env.PORTRAIT_AK = 'ak';
  process.env.PORTRAIT_SK = 'sk';
  const blocked = portraitLib.volcReadiness(services);
  assert.strictEqual(blocked.credentials, true);
  assert.strictEqual(blocked.portraitReady, false);
  assert.match(blocked.portraitReason, /火山无法|本机|内网|HTTPS/);
  await assert.rejects(
    () => portraitLib.createGroup(services, { name: '角色A', userId: 7, volc: async () => ({ Id: 'group-x' }) }),
    (err) => /权属|公网|火山无法|本机/.test(err.message)
  );
  portraitLib.acceptConsent(db, 7);
  await assert.rejects(
    () => portraitLib.createGroup(services, { name: '角色A', userId: 7, volc: async () => ({ Id: 'group-x' }) }),
    (err) => /火山无法|本机|内网|HTTPS/.test(err.message)
  );
  ok('未配置公网地址时拒绝入库');

  process.env.ASSET_PUBLIC_BASE = 'https://library.example.com';
  const calls = [];
  const volc = async (action, body) => {
    calls.push({ action, body });
    if (action === 'CreateAssetGroup') return { Id: 'group-test' };
    if (action === 'CreateAsset') return { Id: 'asset-test' };
    if (action === 'GetAsset') return { Status: 'Active' };
    if (action === 'DeleteAsset') {
      const e = new Error('火山删除失败');
      throw e;
    }
    return {};
  };
  const group = await portraitLib.createGroup(services, { name: '角色A', userId: 7, volc });
  const png = await sharp({
    create: { width: 800, height: 1200, channels: 3, background: { r: 20, g: 40, b: 80 } },
  }).png().toBuffer();
  const asset = await portraitLib.addAsset(services, {
    groupId: group.id,
    buffer: png,
    fileName: 'face.png',
    name: '正面',
    userId: 7,
    volc,
  });
  assert.strictEqual(asset.status, 'Processing');
  const createCall = calls.find((c) => c.action === 'CreateAsset');
  assert.match(createCall.body.URL, /^https:\/\/library\.example\.com\/api\/portrait-library\/fetch\//);
  assert.doesNotMatch(createCall.body.URL, /127\.0\.0\.1|localhost/);

  const token = createCall.body.URL.split('/fetch/')[1];
  const res1 = { status: 0, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
  portraitLib.serveFetch(services, token, res1);
  assert.strictEqual(res1.status, 200);

  const listed = await portraitLib.listLibrary(services, volc);
  const saved = listed[0].assets[0];
  assert.strictEqual(saved.status, 'Active');
  const res2 = { status: 0, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
  portraitLib.serveFetch(services, token, res2);
  assert.strictEqual(res2.status, 410);

  await assert.rejects(
    () => portraitLib.deleteAsset(services, { id: saved.id, user: { id: 7, role: 'viewer' }, volc }),
    /火山删除失败/
  );
  const still = db.prepare('SELECT id FROM portrait_assets WHERE id=?').get(saved.id);
  assert.ok(still);
  ok('签名地址完成后作废，火山删除失败则保留本地记录');
}

integration().then(() => {
  console.log('portrait-music.test.js passed');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
