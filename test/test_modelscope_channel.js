/**
 * 魔搭云端 Qwen-Image 2.1 通道（qwenimage_modelscope）离线回归
 *
 * 不联网、不依赖 sqlite：只校验「路由 / 目录 / 合同组装 / 尺寸换算 / 参考图归一」
 * 这几处最容易回归的接缝。真机联通性由管理台「适配器连通测试」验证。
 *
 * 运行：node test/test_modelscope_channel.js
 */
const assert = require('assert');

let pass = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`✔ ${label}`);
  } catch (e) {
    console.error(`✘ ${label}\n  ${e.message}`);
    process.exitCode = 1;
  }
}
async function checkAsync(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`✔ ${label}`);
  } catch (e) {
    console.error(`✘ ${label}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

const { pickAdapterId } = require('../src/adapter-match');
const catalog = require('../src/studio-catalog');
const { resolveModelExecution, assembleModelPayload } = require('../src/models-contract');
const msQwen = require('../src/gen/qwenimage-modelscope');

const ADAPTERS = [
  { id: 'qwenimage_local', kind: 'image', protocol: 'qwenimage_local' },
  { id: 'qwenimage_modelscope', kind: 'image', protocol: 'qwenimage_modelscope' },
  { id: 'modelscope_image_diffusion', kind: 'image', protocol: 'http_json' },
  { id: 'ark_seedream', kind: 'image', protocol: 'http_json' },
];

(async () => {
  console.log('=== 1. 适配器路由 ===');
  check('魔搭 repo id 走云端 Qwen', () => {
    assert.strictEqual(pickAdapterId('image', 'Qwen/Qwen-Image-2.1-Turbo', ADAPTERS), 'qwenimage_modelscope');
  });
  check('本地 qwen2.1-image 仍走本机', () => {
    assert.strictEqual(pickAdapterId('image', 'qwen2.1-image', ADAPTERS), 'qwenimage_local');
  });
  check('魔搭非 Qwen 模型不被云端 Qwen 抢走', () => {
    assert.strictEqual(
      pickAdapterId('image', 'damo/cv_diffusion_text-to-image-synthesis', ADAPTERS),
      'modelscope_image_diffusion'
    );
  });
  check('Seedream 路由不受影响', () => {
    assert.strictEqual(pickAdapterId('image', 'doubao-seedream-5-0-flash-260915', ADAPTERS), 'ark_seedream');
  });

  console.log('=== 2. 官方目录 ===');
  check('目录登记', () => {
    const hit = catalog.officialOf('Qwen/Qwen-Image-2.1-Turbo');
    assert.ok(hit, '目录里找不到 Qwen-Image 2.1 Turbo');
    assert.strictEqual(hit.model.id, 'qwenimage_modelscope');
    assert.strictEqual(hit.domain, 'image');
  });
  check('id ↔ model_code 互查', () => {
    assert.strictEqual(catalog.resolveModelCode('qwenimage_modelscope'), 'Qwen/Qwen-Image-2.1-Turbo');
    assert.strictEqual(catalog.officialIdOf('Qwen/Qwen-Image-2.1-Turbo'), 'qwenimage_modelscope');
  });
  check('参考图槽位 3 张', () => {
    assert.strictEqual(catalog.capsFor('Qwen/Qwen-Image-2.1-Turbo').input.images, 3);
  });
  check('提供商分组 = 魔搭社区', () => {
    assert.strictEqual(catalog.providerGroupOf('modelscope'), '魔搭社区');
  });

  console.log('=== 3. 合同组装 ===');
  const exec = resolveModelExecution(null, 'Qwen/Qwen-Image-2.1-Turbo');
  check('能力挂到 modelscope 接入点', () => {
    assert.ok(exec, 'resolveModelExecution 返回空');
    assert.strictEqual(exec.capability.id, 'qwenimage_modelscope');
    assert.strictEqual(exec.endpoint.id, 'modelscope');
  });
  check('1K 16:9 → body.size = 1280x720', () => {
    const r = assembleModelPayload({
      modelContract: exec.model, values: { size: '1K', ratio: '16:9' }, editablePrompt: '猫',
    });
    assert.strictEqual(r.body.model, 'Qwen/Qwen-Image-2.1-Turbo');
    assert.strictEqual(r.body.size, '1280x720');
    assert.strictEqual(r.body.width, undefined, '云端不应下发 width');
  });
  check('直传像素不再查档位表', () => {
    const r = assembleModelPayload({
      modelContract: exec.model, values: { size: '1664x928', ratio: '16:9' }, editablePrompt: '猫',
    });
    assert.strictEqual(r.body.size, '1664x928');
  });
  check('负向提示词落到 body.negative_prompt', () => {
    const r = assembleModelPayload({
      modelContract: exec.model, values: { size: '1K', ratio: '1:1', negative_prompt: '模糊' }, editablePrompt: '猫',
    });
    assert.strictEqual(r.body.negative_prompt, '模糊');
  });
  check('本机 Qwen 仍下发 width/height', () => {
    const local = resolveModelExecution(null, 'qwen2.1-image');
    const r = assembleModelPayload({
      modelContract: local.model, values: { size: '1K', ratio: '16:9' }, editablePrompt: '猫',
    });
    assert.strictEqual(local.capability.id, 'qwenimage_local');
    assert.strictEqual(r.body.width, 1280);
    assert.strictEqual(r.body.height, 720);
    assert.strictEqual(r.body.size, undefined);
  });

  console.log('=== 4. 尺寸与 URL 归一 ===');  check('尺寸换算', () => {
    assert.strictEqual(msQwen.resolveSize({ size: '1024x1024' }), '1024x1024');
    assert.strictEqual(msQwen.resolveSize({ extras: { size: '2K', ratio: '9:16' } }), '1080x1920');
    assert.strictEqual(msQwen.resolveSize({}), '1024x1024');
  });
  check('基址兼容带/不带 /v1', () => {
    assert.strictEqual(msQwen.submitUrl('https://api-inference.modelscope.cn'),
      'https://api-inference.modelscope.cn/v1/images/generations');
    assert.strictEqual(msQwen.submitUrl('https://api-inference.modelscope.cn/v1/'),
      'https://api-inference.modelscope.cn/v1/images/generations');
  });
  await checkAsync('data URI 小图原样透传', async () => {
    const uri = 'data:image/png;base64,' + Buffer.from('x').toString('base64');
    assert.strictEqual(await msQwen.toImageUrl(uri), uri);
  });
  await checkAsync('公网 URL 交给云端拉取', async () => {
    const url = 'https://modelscope.oss-cn-beijing.aliyuncs.com/Dog.png';
    assert.strictEqual(await msQwen.toImageUrl(url), url);
  });
  await checkAsync('内网地址不会被塞给云端', async () => {
    assert.strictEqual(await msQwen.toImageUrl('http://192.168.1.107:9000/a.png'), null);
  });

  console.log('=== 5. 多模型挂载 → 通道链 ===');
  const { buildModelChain, nodeModelIds } = require('../src/nodes');
  const GEN_ADAPTERS = [
    { id: 'agnes_image', kind: 'image', protocol: 'http_json' },
    { id: 'qwenimage_local', kind: 'image', protocol: 'qwenimage_local' },
    { id: 'qwenimage_modelscope', kind: 'image', protocol: 'qwenimage_modelscope' },
    { id: 'ark_seedream', kind: 'image', protocol: 'http_json' },
  ];
  check('三个模型各自映射到自己的适配器（不串台）', () => {
    const chain = buildModelChain(
      ['agnes_image_2_5_flash', 'qwenimage_local', 'qwenimage_modelscope'],
      GEN_ADAPTERS
    );
    assert.deepStrictEqual(chain.map((c) => c.adapter.id), [
      'agnes_image', 'qwenimage_local', 'qwenimage_modelscope',
    ]);
  });
  check('链里的模型是各自的 model_code', () => {
    const chain = buildModelChain(['qwenimage_modelscope'], GEN_ADAPTERS);
    assert.strictEqual(chain[0].model, 'Qwen/Qwen-Image-2.1-Turbo');
    assert.strictEqual(chain[0].adapter.id, 'qwenimage_modelscope');
  });
  check('未知模型被丢弃，不会落到别的适配器', () => {
    const chain = buildModelChain(['not-a-real-model'], GEN_ADAPTERS);
    assert.strictEqual(chain.length, 0);
  });
  check('老配置只有单值 model 时也能取到链', () => {
    assert.deepStrictEqual(nodeModelIds({ model: 'qwenimage_local' }), ['qwenimage_local']);
    assert.deepStrictEqual(nodeModelIds({ modelIds: ['a', 'b'], model: 'a' }), ['a', 'b']);
  });

  console.log(`\n${process.exitCode ? '存在失败项' : `全部通过（${pass} 项）`}`);
})();
