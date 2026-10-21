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

// ---------- 8. 能力插件：镜头切分（operation） ----------
// 声明式插件只登记「用哪个 runner、吃哪些输入、吐什么产物、有哪些参数」，
// 执行体固定在 <dataDir>/clip-ai-runners/scene-split.js；
// 包目录里只有 manifest.json，没有任何可执行文件，因此不存在"加载即执行"。
writePack('com.mls.plugin.scene-split', {
  schemaVersion: 1,
  id: 'com.mls.plugin.scene-split',
  type: 'operation',
  name: { zh: '镜头切分', en: 'Scene Split' },
  description: {
    zh: '按画面突变切分镜头，产出切点时间表（秒）。执行体由服务端 runner 提供。',
  },
  version: '1.0.0',
  engine: { minEditor: '0.1.0' },
  tags: ['AI', '镜头检测', '切点'],
  operation: {
    input: ['video'],
    output: 'cuts',
    runner: 'scene-split',
    params: [
      { key: 'threshold', type: 'number', label: { zh: '切分阈值' }, default: 27, min: 1, max: 100, step: 1 },
      { key: 'minSceneLen', type: 'number', label: { zh: '最短镜头（秒）' }, default: 1, min: 0, max: 30, step: 0.1 },
    ],
  },
  license: { type: 'internal', source: '自研', commercialUse: true },
});

// ---------- 9. 文字模板（数据就绪，渲染待接入） ----------
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

// ---------- 7. 转场包（12 个 mode，走 compositor 的 transition 通道） ----------
// mode 常量与 editor/rust/crates/compositor/src/shaders/transition.wgsl 一一对应；
// uniforms.mode 由包内写死，u_scalar0..3 / u_direction 由元素 params 在运行时代入。
const TRANSITIONS = [
  {
    id: 'dissolve',
    name: '叠化',
    en: 'Dissolve',
    mode: 0,
    duration: 0.8,
    desc: '最通用的交叉溶解，软硬由柔和度控制。',
    tags: ['基础', '叠化', '通用'],
    params: [
      { key: 'softness', label: '柔和度', default: 0.6, min: 0, max: 1, step: 0.01 },
    ],
    uniforms: { u_scalar0: '$softness' },
  },
  {
    id: 'dip-black',
    name: '黑场过渡',
    en: 'Dip to Black',
    mode: 1,
    duration: 0.9,
    desc: '先压到全黑再拉起，适合段落之间留呼吸。',
    tags: ['黑场', '段落'],
    params: [],
    uniforms: {},
  },
  {
    id: 'dip-white',
    name: '白场过渡',
    en: 'Dip to White',
    mode: 2,
    duration: 0.9,
    desc: '闪白过场，适合明亮空间与快节奏剪辑。',
    tags: ['白场', '闪白'],
    params: [],
    uniforms: {},
  },
  {
    id: 'push-left',
    name: '左推',
    en: 'Push Left',
    mode: 3,
    duration: 0.7,
    desc: '画面整体向左推出，右侧带入下一段。',
    tags: ['推移', '方向感'],
    params: [],
    uniforms: { u_direction: '[1,0]' },
  },
  {
    id: 'push-up',
    name: '上推',
    en: 'Push Up',
    mode: 4,
    duration: 0.7,
    desc: '画面向上推出，适合竖向空间关系。',
    tags: ['推移', '竖向'],
    params: [],
    uniforms: {},
  },
  {
    id: 'zoom-in',
    name: '缩放推近',
    en: 'Zoom Push',
    mode: 5,
    duration: 0.75,
    desc: '前一段推近淡出，后一段从略小拉回原尺寸。',
    tags: ['缩放', '推近'],
    params: [
      { key: 'amount', label: '推近幅度', default: 0.65, min: 0, max: 1, step: 0.01 },
    ],
    uniforms: { u_scalar1: '$amount' },
  },
  {
    id: 'rotate',
    name: '旋转',
    en: 'Rotate',
    mode: 6,
    duration: 0.8,
    desc: '两段反向旋转交接，适合节奏感的转场点。',
    tags: ['旋转', '动感'],
    params: [
      { key: 'amount', label: '旋转角度', default: 0.7, min: 0, max: 1, step: 0.01 },
    ],
    uniforms: { u_scalar1: '$amount' },
  },
  {
    id: 'blur',
    name: '模糊过渡',
    en: 'Blur Dissolve',
    mode: 7,
    duration: 0.9,
    desc: '中点最糊、两端清晰，用模糊掩盖剪辑点。',
    tags: ['模糊', '柔化'],
    params: [
      { key: 'softness', label: '模糊强度', default: 0.45, min: 0, max: 1, step: 0.01 },
    ],
    uniforms: { u_scalar0: '$softness' },
  },
  {
    id: 'wipe-linear',
    name: '线性擦除',
    en: 'Linear Wipe',
    mode: 8,
    duration: 0.8,
    desc: '沿方向线性推开，羽化控制边缘软硬。',
    tags: ['擦除', '方向'],
    params: [
      { key: 'softness', label: '羽化', default: 0.12, min: 0, max: 0.5, step: 0.01 },
    ],
    uniforms: { u_scalar0: '$softness', u_direction: '[1,0]' },
  },
  {
    id: 'blinds',
    name: '百叶窗',
    en: 'Blinds',
    mode: 9,
    duration: 0.85,
    desc: '横向条带依次翻面，条数与羽化可调。',
    tags: ['条带', '结构感'],
    params: [
      { key: 'amount', label: '条带密度', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'softness', label: '边缘羽化', default: 0.05, min: 0, max: 0.5, step: 0.01 },
    ],
    uniforms: { u_scalar0: '$softness', u_scalar1: '$amount' },
  },
  {
    id: 'glitch',
    name: '置换故障',
    en: 'Glitch Shift',
    mode: 10,
    duration: 0.5,
    desc: '按行随机位移 + 通道分离，故障风格专用。',
    tags: ['故障', '赛博'],
    params: [
      { key: 'amount', label: '强度', default: 0.7, min: 0, max: 1, step: 0.01 },
    ],
    uniforms: { u_scalar1: '$amount' },
  },
  {
    id: 'page-turn',
    name: '翻页',
    en: 'Page Turn',
    mode: 11,
    duration: 1.0,
    desc: '沿方向翻页，折痕处带镜像与高光。',
    tags: ['翻页', '立体'],
    params: [
      { key: 'softness', label: '折页宽度', default: 0.4, min: 0, max: 1, step: 0.01 },
    ],
    uniforms: { u_scalar0: '$softness', u_direction: '[1,0]' },
  },
];

for (const t of TRANSITIONS) {
  writePack(`com.mls.transition.${t.id}`, {
    schemaVersion: 1,
    id: `com.mls.transition.${t.id}`,
    type: 'transition',
    name: { zh: t.name, en: t.en },
    description: { zh: t.desc },
    version: '1.0.0',
    engine: { minEditor: '0.1.0' },
    tags: t.tags,
    params: t.params.map((p) => ({
      key: p.key,
      type: 'number',
      label: { zh: p.label },
      default: p.default,
      min: p.min,
      max: p.max,
      step: p.step,
      keyframable: false,
    })),
    render: {
      passes: [
        {
          shader: 'transition',
          // mode 写死；标量走 $param，由加载器在帧构建时代入
          uniforms: { mode: String(t.mode), ...t.uniforms },
        },
      ],
    },
    transition: { defaultDuration: t.duration, mode: t.mode },
    license: { type: 'internal', source: '自研', commercialUse: true },
  });
}

const dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
console.log(`已生成 ${dirs.length} 个资源包：`);
for (const d of dirs) console.log('  -', d.name);
console.log(`目录：${ROOT}`);
