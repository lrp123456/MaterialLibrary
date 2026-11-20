/**
 * 回归：发送前不得改写已经挂上的地址。
 * 没有地址、失效 blob、丢了 derivative 的库图，都不许按 fid 换成另一张图。
 */
const assert = require('node:assert');
const path = require('node:path');

async function load() {
  const file = path.resolve(__dirname, '../web-pro/src/utils/revive-ref-url.js').replace(/\\/g, '/');
  return import('file://' + file);
}

function deps() {
  const alive = new Set(['blob:http://local/alive']);
  return {
    signAsset: (fid, mediaToken) => {
      const token = mediaToken ? `&media_token=${mediaToken}` : '';
      return `/api/viewer/assets/${fid}/image?token=fresh${token}`;
    },
    resignUrl: (url) => {
      if (!/\/api\/(?:viewer\/)?assets\//.test(url)) return url;
      if (/[?&]token=/.test(url)) return url.replace(/([?&]token=)[^&]*/, '$1resigned');
      return `${url}${url.includes('?') ? '&' : '?'}token=resigned`;
    },
    blobAlive: (url) => alive.has(url)
  };
}

async function runTests() {
  const { reviveRefUrl, sameMountedFile, adoptEditedPixels, revertEditedPixels } = await load();
  const d = deps();
  const cropped = 'data:image/jpeg;base64,CROPPED';

  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', mediaToken: 'm', url: cropped }, d),
    cropped,
    '裁剪 data URL 必须原样保留，不能按 fid 换回库原图'
  );

  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', url: '' }, d),
    '',
    '没有地址时不按 fid 另找一张图'
  );

  const mounted = '/api/viewer/assets/asset_1/image?token=stale';
  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', url: mounted }, d),
    mounted,
    '已经挂上的库图地址保持不变，不能每次发送都重签'
  );

  const derivative = '/api/viewer/assets/asset_1/image?derivative=30139&token=stale';
  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', derivativeId: 30139, url: derivative }, d),
    derivative,
    '9:16 衍生地址必须原样保留'
  );

  const ratio34 = '/api/viewer/assets/asset_1/image?derivative=30140&token=stale';
  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', derivativeId: 30140, derivativeKind: 'restage_3_4', url: ratio34 }, d),
    ratio34,
    '3:4 衍生地址必须原样保留'
  );

  const origin = '/api/viewer/assets/asset_1/image?raw=1&token=stale';
  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', derivativeId: '', url: origin }, d),
    origin,
    '原图 raw=1 不能被换成不带版本的地址'
  );

  const bare = '/api/viewer/assets/asset_1/image?token=stale';
  assert.strictEqual(
    reviveRefUrl({
      fid: 'asset_1',
      derivativeId: 30139,
      url: bare
    }, d),
    bare,
    '地址没写 derivative 时也不许按 derivativeId 改成另一版'
  );

  assert.strictEqual(
    reviveRefUrl({
      fid: 'asset_1',
      url: 'http://127.0.0.1:30001/api/viewer/assets/asset_1/image?derivative=30139&token=stale'
    }, d),
    'http://127.0.0.1:30001/api/viewer/assets/asset_1/image?derivative=30139&token=stale',
    '绝对地址的衍生图也原样保留'
  );

  assert.strictEqual(
    reviveRefUrl({ url: '/api/viewer/assets/asset_1/image?token=stale' }, d),
    '/api/viewer/assets/asset_1/image?token=stale',
    '已有 token 的库图不再刷新凭证'
  );

  assert.strictEqual(
    reviveRefUrl({ url: '/api/viewer/assets/asset_1/image?derivative=8' }, d),
    '/api/viewer/assets/asset_1/image?derivative=8',
    '没有凭证也不补写，避免发送前改地址'
  );

  assert.strictEqual(
    sameMountedFile(
      '/api/viewer/assets/asset_1/image?derivative=8',
      '/api/viewer/assets/asset_1/image?derivative=8&token=resigned'
    ),
    true,
    '只多了 token 仍是同一份文件'
  );
  assert.strictEqual(
    sameMountedFile(
      '/api/viewer/assets/asset_1/image?token=stale',
      '/api/viewer/assets/asset_1/image?token=stale&derivative=30139'
    ),
    false,
    '写回 derivative 是换了一版，和原来的裸地址不是同一份'
  );

  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', url: '/api/cache/temp/crop.jpg' }, d),
    '/api/cache/temp/crop.jpg',
    '非库图的 /api 地址不能被 fid 换成原图'
  );

  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', url: 'https://cdn.example.com/photo.jpg' }, d),
    'https://cdn.example.com/photo.jpg',
    '外链不能被 fid 换成库原图'
  );

  assert.strictEqual(
    reviveRefUrl({ url: 'blob:http://local/alive' }, d),
    'blob:http://local/alive',
    '仍有效的本地 blob 保持不变'
  );

  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', url: 'blob:http://local/alive' }, d),
    'blob:http://local/alive',
    '有效 blob 优先于 fid，避免把本地像素换回原图'
  );

  assert.strictEqual(
    reviveRefUrl({ url: 'blob:http://local/dead' }, d),
    'blob:http://local/dead',
    '失效 blob 保持原地址，不在发送前清掉或替换'
  );

  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', url: 'blob:http://local/dead' }, d),
    'blob:http://local/dead',
    '失效 blob 也不许按 fid 换成库图'
  );

  const edited = adoptEditedPixels({
    fid: 'asset_1',
    mediaToken: 'm',
    url: '/api/viewer/assets/asset_1/image?token=old',
    thumbUrl: '/api/viewer/assets/asset_1/image?tier=grid',
    name: '图1'
  }, cropped, { annotated: true });

  assert.strictEqual(edited.url, cropped);
  assert.strictEqual(edited.thumbUrl, cropped, '输入区缩略图优先读 thumbUrl，必须跟着裁剪结果走');
  assert.strictEqual(edited.fid, '');
  assert.strictEqual(edited.mediaToken, '');
  assert.strictEqual(edited.sourceFid, 'asset_1');
  assert.strictEqual(edited.originalUrl, '/api/viewer/assets/asset_1/image?token=old');
  assert.strictEqual(edited.annotated, true);
  assert.strictEqual(edited.name, '图1');

  const again = adoptEditedPixels(edited, 'data:image/jpeg;base64,AGAIN', { annotated: true });
  assert.strictEqual(again.originalUrl, edited.originalUrl, '再次编辑不能把撤回目标改成上一次裁剪图');
  assert.strictEqual(again.sourceFid, 'asset_1');

  const back = revertEditedPixels(edited);
  assert.strictEqual(back.url, edited.originalUrl);
  assert.strictEqual(back.thumbUrl, edited.originalUrl);
  assert.strictEqual(back.fid, 'asset_1');
  assert.strictEqual(back.annotated, false);
  assert.strictEqual(back.outpainted, false);

  console.log('revive-ref-url tests passed');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
