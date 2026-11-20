/**
 * 回归：图片裁剪/标绘/扩图落地后的像素地址，发送前不能被素材 fid 重签回原图。
 *
 * 看图区确认裁剪后 url 已是 data:，但托盘项仍带着库 fid。
 * 发送时 reviveRefUrl 若见 fid 就无条件换回 /api/viewer/assets/:fid/image，
 * 看图区、气泡缩略图和出站 imageUrls 会一起回到原图。
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
  const { reviveRefUrl, adoptEditedPixels, revertEditedPixels } = await load();
  const d = deps();
  const cropped = 'data:image/jpeg;base64,CROPPED';

  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', mediaToken: 'm', url: cropped }, d),
    cropped,
    '裁剪 data URL 必须原样保留，不能按 fid 换回库原图'
  );

  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', url: '' }, d),
    '/api/viewer/assets/asset_1/image?token=fresh',
    '没有地址时仍按 fid 重签'
  );

  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', url: '/api/viewer/assets/asset_1/image?token=stale' }, d),
    '/api/viewer/assets/asset_1/image?token=fresh',
    '库图地址上的过期 token 仍要重签'
  );

  assert.strictEqual(
    reviveRefUrl({
      fid: 'asset_1',
      url: 'http://127.0.0.1:30001/api/viewer/assets/asset_1/image?token=stale'
    }, d),
    '/api/viewer/assets/asset_1/image?token=fresh',
    '绝对地址的库图同样按 fid 重签'
  );

  assert.strictEqual(
    reviveRefUrl({ url: '/api/viewer/assets/asset_1/image?token=stale' }, d),
    '/api/viewer/assets/asset_1/image?token=resigned',
    '没有 fid 的库图地址仍刷新 token'
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
    '',
    '失效且没有 fid 的 blob 救不回来'
  );

  assert.strictEqual(
    reviveRefUrl({ fid: 'asset_1', url: 'blob:http://local/dead' }, d),
    '/api/viewer/assets/asset_1/image?token=fresh',
    '失效 blob 仍可按 fid 回到库图'
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
