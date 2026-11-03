const assert = require('node:assert');
const path = require('node:path');

async function runTests() {
  const mod = await import('file://' + path.resolve(__dirname, '../web-pro/src/utils/product-cover.js').replace(/\\/g, '/'));
  const { productCover, coverBadge, coverOrbit, thumbnailUrl } = mod;

  // 库里的 facing 是 180，但没有 180° 快照。封面仍是 45° 棚拍，角标和机位必须跟这张图，不能写成 180°。
  const recliner = {
    facing: 180,
    preview_url: '/api/viewer/products/previews/sofa_single.png',
    snapshots: {
      right_45: '/api/viewer/products/previews/sofa_electric_single_right_45.png',
      front: '/api/viewer/products/previews/sofa_electric_single_front.png',
      front_0: '/api/viewer/products/previews/sofa_electric_single_front_0.png'
    }
  };
  const cover = productCover(recliner);
  assert.strictEqual(cover.url, recliner.snapshots.right_45);
  assert.strictEqual(cover.key, 'right_45');
  assert.strictEqual(cover.yaw, 45);
  assert.strictEqual(coverBadge(cover), '标准 45°');
  assert.strictEqual(coverOrbit(cover), '45deg 75deg auto');
  assert.notStrictEqual(cover.yaw, recliner.facing);

  const frontOnly = {
    facing: 180,
    preview_url: '/previews/cover.png',
    snapshots: { front: '/previews/front.png' }
  };
  const frontCover = productCover(frontOnly);
  assert.strictEqual(thumbnailUrl(frontOnly), '/previews/front.png');
  assert.strictEqual(frontCover.label, '0°');
  assert.strictEqual(frontCover.yaw, 0);

  const photoOnly = { facing: 180, preview_url: '/previews/cover.png', snapshots: {} };
  const photo = productCover(photoOnly);
  assert.strictEqual(photo.url, '/previews/cover.png');
  assert.strictEqual(photo.yaw, null);
  assert.strictEqual(coverBadge(photo), '封面');
  assert.strictEqual(coverOrbit(photo), 'auto auto auto');

  assert.strictEqual(productCover(null).url, '');
  assert.strictEqual(coverBadge(productCover(null)), '');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
