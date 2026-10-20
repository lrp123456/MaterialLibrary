/**
 * 生成首批声明式资源包（可重复执行，内容幂等）。
 *
 * 现状约束：OpenCut 的 wasm 只内置了 `gaussian-blur` 一个 shader，
 * 所以特效包目前只能做"模糊类预设"。要新增发光/锐化等，必须先改
 * editor/rust/crates/effects/src/pipeline.rs 并重编 opencut-wasm。
 *
 * 运行：node scripts/seed-clip-packs.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'data', 'clip-packs');

function writePack(id, manifest, files = {}) {
  const dir = path.join(ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function blurPasses(paramKey = 'intensity') {
  return [
    {
      shader: 'gaussian-blur',
      uniforms: { u_sigma: `$${paramKey}`, u_step: '1', u_direction: '[1,0]' },
    },
    {
      shader: 'gaussian-blur',
      uniforms: { u_sigma: `$${paramKey}`, u_step: '1', u_direction: '[0,1]' },
    },
  ];
}

// ---------- 1. 柔焦（人像/空间都能用） ----------
writePack('com.mls.effect.soft-focus', {
  schemaVersion: 1,
  id: 'com.mls.effect.soft-focus',
  type: 'effect',
  name: { zh: '柔焦', en: 'Soft Focus' },
  description: { zh: '轻微高斯模糊，压掉数码锐感，适合空间漫游的空镜。' },
  version: '1.0.0',
  engine: { minEditor: '0.1.0' },
  tags: ['模糊', '柔化', '空镜'],
  params: [
    {
      key: 'intensity',
      type: 'number',
      label: { zh: '强度', en: 'Intensity' },
      default: 8,
      min: 0,
      max: 40,
      step: 1,
      keyframable: true,
    },
  ],
  render: { passes: blurPasses() },
  license: { type: 'internal', source: '自研', commercialUse: true },
});

// ---------- 2. 强景深（模拟大光圈背景虚化） ----------
writePack('com.mls.effect.deep-defocus', {
  schemaVersion: 1,
  id: 'com.mls.effect.deep-defocus',
  type: 'effect',
  name: { zh: '强景深', en: 'Deep Defocus' },
  description: { zh: '重度模糊，用于模拟大光圈景深或做转场前的失焦。' },
  version: '1.0.0',
  engine: { minEditor: '0.1.0' },
  tags: ['模糊', '景深', '失焦'],
  params: [
    {
      key: 'intensity',
      type: 'number',
      label: { zh: '虚化程度', en: 'Amount' },
      default: 45,
      min: 0,
      max: 120,
      step: 1,
      keyframable: true,
    },
  ],
  render: { passes: blurPasses() },
  license: { type: 'internal', source: '自研', commercialUse: true },
});

// ---------- 3. 发光（glow shader） ----------
writePack('com.mls.effect.glow', {
  schemaVersion: 1,
  id: 'com.mls.effect.glow',
  type: 'effect',
  name: { zh: '发光', en: 'Glow' },
  description: { zh: '提取亮部并叠加柔光，适合窗光、灯带、夜景。' },
  version: '1.0.0',
  engine: { minEditor: '0.1.0' },
  tags: ['光效', '柔光', '氛围'],
  params: [
    { key: 'threshold', type: 'number', label: { zh: '亮度阈值' }, default: 0.75, min: 0, max: 1, step: 0.01, keyframable: false },
    { key: 'intensity', type: 'number', label: { zh: '强度' }, default: 0.8, min: 0, max: 3, step: 0.05, keyframable: true },
    { key: 'radius', type: 'number', label: { zh: '扩散半径' }, default: 12, min: 1, max: 64, step: 1, keyframable: false },
  ],
  render: {
    passes: [{
      shader: 'glow',
      uniforms: { u_scalar0: '$threshold', u_scalar1: '$intensity', u_scalar2: '$radius' },
    }],
  },
  license: { type: 'internal', source: '自研', commercialUse: true },
});

// ---------- 4. 锐化（sharpen shader） ----------
writePack('com.mls.effect.sharpen', {
  schemaVersion: 1,
  id: 'com.mls.effect.sharpen',
  type: 'effect',
  name: { zh: '锐化', en: 'Sharpen' },
  description: { zh: '反锐化掩模，救回缩放后的糊感；过量会有白边。' },
  version: '1.0.0',
  engine: { minEditor: '0.1.0' },
  tags: ['清晰度', '锐化'],
  params: [
    { key: 'amount', type: 'number', label: { zh: '强度' }, default: 0.6, min: 0, max: 3, step: 0.05, keyframable: true },
    { key: 'radius', type: 'number', label: { zh: '半径' }, default: 1, min: 0.5, max: 4, step: 0.1, keyframable: false },
  ],
  render: {
    passes: [{
      shader: 'sharpen',
      uniforms: { u_scalar0: '$amount', u_scalar1: '$radius' },
    }],
  },
  license: { type: 'internal', source: '自研', commercialUse: true },
});

// ---------- 5. 磨皮（skin-smooth shader，全局保边平滑） ----------
writePack('com.mls.effect.skin-smooth', {
  schemaVersion: 1,
  id: 'com.mls.effect.skin-smooth',
  type: 'effect',
  name: { zh: '磨皮', en: 'Skin Smooth' },
  description: { zh: '双边滤波近似，保边平滑。全局生效，不做人脸检测。' },
  version: '1.0.0',
  engine: { minEditor: '0.1.0' },
  tags: ['美颜', '磨皮', '人像'],
  params: [
    { key: 'strength', type: 'number', label: { zh: '强度' }, default: 0.6, min: 0, max: 1, step: 0.01, keyframable: true },
    { key: 'radius', type: 'number', label: { zh: '半径' }, default: 3, min: 1, max: 12, step: 0.5, keyframable: false },
  ],
  render: {
    passes: [{
      shader: 'skin-smooth',
      uniforms: { u_scalar0: '$strength', u_scalar1: '$radius' },
    }],
  },
  license: { type: 'internal', source: '自研', commercialUse: true },
});

// ---------- 6. 贴纸包（SVG 生成，可直接用） ----------
const stickerSvg = (label, bg, fg = '#ffffff') => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96" viewBox="0 0 320 96">
  <rect x="4" y="4" width="312" height="88" rx="44" fill="${bg}"/>
  <text x="160" y="60" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif"
        font-size="36" font-weight="600" fill="${fg}" letter-spacing="2">${label}</text>
</svg>
`;

writePack(
  'com.mls.sticker.area-labels',
  {
    schemaVersion: 1,
    id: 'com.mls.sticker.area-labels',
    type: 'sticker',
    name: { zh: '空间标签', en: 'Area Labels' },
    version: '1.0.0',
    engine: { minEditor: '0.1.0' },
    tags: ['标签', '户型', '空间'],
    assets: [
      { path: 'living-room.svg', kind: 'sticker', width: 320, height: 96 },
      { path: 'bedroom.svg', kind: 'sticker', width: 320, height: 96 },
      { path: 'kitchen.svg', kind: 'sticker', width: 320, height: 96 },
      { path: 'balcony.svg', kind: 'sticker', width: 320, height: 96 },
    ],
    license: { type: 'internal', source: '自研（脚本生成）', commercialUse: true },
  },
  {
    'living-room.svg': stickerSvg('客 厅', '#1b1a17'),
    'bedroom.svg': stickerSvg('卧 室', '#3d4a3e'),
    'kitchen.svg': stickerSvg('厨 房', '#8a4b2a'),
    'balcony.svg': stickerSvg('阳 台', '#2f5d6b'),
  },
);

// ---------- 4. 文字模板（数据就绪，渲染待接入） ----------
writePack('com.mls.text.gallery-title', {
  schemaVersion: 1,
  id: 'com.mls.text.gallery-title',
  type: 'textTemplate',
  name: { zh: '案例标题', en: 'Case Title' },
  version: '1.0.0',
  engine: { minEditor: '0.1.0' },
  tags: ['标题', '片头'],
  textTemplate: {
    defaultText: { zh: '极简明亮客厅', en: 'Minimal Living Room' },
    inAnimation: 'fade',
    outAnimation: 'fade',
    fields: [
      {
        key: 'fontSize',
        type: 'number',
        label: { zh: '字号' },
        default: 96,
        min: 24,
        max: 240,
        step: 2,
        keyframable: false,
      },
    ],
  },
  license: { type: 'internal', source: '自研', commercialUse: true },
});

const dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
console.log(`已生成 ${dirs.length} 个资源包：`);
for (const d of dirs) console.log('  -', d.name);
console.log(`目录：${ROOT}`);
