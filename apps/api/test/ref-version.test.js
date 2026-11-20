const assert = require('node:assert');
const path = require('node:path');

async function load() {
  const file = path.resolve(__dirname, '../web-pro/src/utils/ref-version.js').replace(/\\/g, '/');
  return import('file://' + file);
}

async function main() {
  const { explicitVersionLabel, hasExplicitVersion, versionBadge, labelForDerivativeKind } = await load();

  assert.strictEqual(labelForDerivativeKind('restage_9_16'), '9:16');
  assert.strictEqual(labelForDerivativeKind('restage_3_4'), '3:4');
  assert.strictEqual(labelForDerivativeKind('origin'), '原图');
  assert.strictEqual(labelForDerivativeKind('clean'), '净画精修');
  assert.strictEqual(labelForDerivativeKind('unknown_kind'), '衍生');

  assert.strictEqual(
    explicitVersionLabel({
      url: '/api/viewer/assets/fid/image?derivative=30181&token=a',
      derivativeKind: 'restage_3_4',
    }),
    '3:4'
  );
  assert.strictEqual(
    explicitVersionLabel({
      url: '/api/viewer/assets/fid/image?derivative=30139&token=a',
      derivativeKind: 'restage_9_16',
    }),
    '9:16'
  );
  assert.strictEqual(
    explicitVersionLabel({ url: '/api/viewer/assets/fid/image?raw=1&token=a' }),
    '原图'
  );
  assert.strictEqual(
    explicitVersionLabel({
      url: '/api/viewer/assets/fid/image?token=a',
      derivativeKind: 'restage_9_16',
      derivativeId: 30139,
    }),
    '',
    '只有种类、地址没写版本时不能当成 9:16'
  );
  assert.strictEqual(hasExplicitVersion({ url: '/api/viewer/assets/fid/image?token=a' }), false);
  assert.strictEqual(versionBadge({ url: '/api/viewer/assets/fid/image?token=a' }), '未标明');
  assert.strictEqual(
    explicitVersionLabel({ url: '/api/creation-templates/tpl/media/origin/0?token=a' }),
    '原图'
  );
  assert.strictEqual(explicitVersionLabel({ url: 'blob:http://local/x', versionLabel: '原图' }), '原图');
  assert.strictEqual(explicitVersionLabel({ url: 'data:image/png;base64,xx', annotated: true }), '裁剪');
  assert.strictEqual(explicitVersionLabel({ url: 'data:image/png;base64,xx', isWireframe: true }), '线框');
  assert.strictEqual(explicitVersionLabel({ url: '/api/cache/temp/a.png', versionLabel: '生成结果' }), '生成结果');

  console.log('ref-version tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
