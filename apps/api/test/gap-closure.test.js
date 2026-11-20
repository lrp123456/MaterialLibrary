/**
 * 四条出图缺口收口：一条契约、一次转换器编译、客户端只交标准词和积木 id。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

async function main() {
  const {
    DEFAULT_MODEL_CONTRACTS,
    assembleModelPayload,
  } = require(path.join(root, 'src/models-contract'));
  const { normalizeArkSeedreamPayload } = require(path.join(root, 'src/gen'));
  const {
    globalCircuitBreaker,
    selectSubmitContract,
    convertAgnesVideoRequest,
  } = require(path.join(root, 'src/converters'));

  const flash = DEFAULT_MODEL_CONTRACTS.find((m) => m.id === 'seedream5flash');
  const pro = DEFAULT_MODEL_CONTRACTS.find((m) => m.id === 'seedream5pro');
  const ctx = { apiKey: 'dummy-ark-key' };

  const flashBody = assembleModelPayload({
    modelContract: flash,
    editablePrompt: '客厅 @图片1',
    values: { size: '2K', ratio: '9:16' },
  });
  assert.strictEqual(flashBody.body.size, '1584x2816');
  assert.strictEqual(flashBody.body.ratio, undefined);

  const flashWire = normalizeArkSeedreamPayload(flashBody.body, flashBody.body, flashBody.body, ctx);
  assert.strictEqual(flashWire.size, '1584x2816', 'Flash 第二次经过发出前归一化仍是 1584x2816');
  assert.strictEqual(flashWire.layer_decomposition, undefined);

  const proBody = assembleModelPayload({
    modelContract: pro,
    editablePrompt: '拆层',
    values: { layer_decomposition: true, ratio: '16:9' },
    images: ['https://example.com/room.jpg'],
  });
  const proWire = normalizeArkSeedreamPayload(proBody.body, proBody.body, proBody.body, ctx);
  assert.strictEqual(proWire.layer_decomposition, true, 'Pro 拆层必须留在 executeAdapter 发出前的报文里');
  assert.strictEqual(proWire.size, 'auto');
  assert.strictEqual(proWire.ratio, undefined);
  assert.strictEqual(proWire.model, 'doubao-seedream-5-0-pro-260628');

  const agnesVideo = convertAgnesVideoRequest({
    contract: DEFAULT_MODEL_CONTRACTS.find((m) => m.id === 'agnes_video_2_5_flash'),
    prompt: '漫游 @图片1',
    mode: 'text_to_video',
    values: { seconds: 6 },
  });
  assert.strictEqual(typeof agnesVideo.body.seconds, 'string');
  assert.strictEqual(agnesVideo.body.seconds, '6');

  globalCircuitBreaker.reset('seedream5pro');
  globalCircuitBreaker.recordFailure('seedream5pro', 'fake-1');
  globalCircuitBreaker.recordFailure('seedream5pro', 'fake-2');
  globalCircuitBreaker.recordFailure('seedream5pro', 'fake-3');
  assert.strictEqual(globalCircuitBreaker.canExecute('seedream5pro'), false);
  const picked = selectSubmitContract(
    { ...pro, failover_model_id: 'seedream5flash' },
    (id) => DEFAULT_MODEL_CONTRACTS.find((m) => m.id === id)
  );
  assert.strictEqual(picked.switched, true);
  assert.strictEqual(picked.contract.id, 'seedream5flash');
  const failoverBody = assembleModelPayload({
    modelContract: picked.contract,
    editablePrompt: '备选客厅',
    values: { size: '2K', ratio: '9:16' },
  });
  assert.strictEqual(failoverBody.body.model, 'doubao-seedream-5-0-flash-260915');
  assert.strictEqual(failoverBody.body.size, '1584x2816');
  globalCircuitBreaker.reset('seedream5pro');

  const protocol = read('web-pro/src/utils/model-protocol.js');
  assert.ok(!protocol.includes('promptSuffix'), '技能注册表不再放提示词尾巴');
  assert.ok(!protocol.includes('8K超清细节'), '技能里不再写 8K 空话');
  assert.ok(protocol.includes("snippetIds: ['snippet_interior_realism']"));

  const chat = read('web-pro/src/views/studio/ChatStudio.vue');
  assert.ok(chat.includes('snippetIds: activeSnippetIds()'));

  const clarity = read('src/handlers/edit-run.js');
  const clarityBlock = clarity.slice(clarity.indexOf("op === 'clarity'"), clarity.indexOf('const selection = normalizeSelection'));
  assert.ok(clarityBlock.includes('compileNodePrompt'));
  assert.ok(clarityBlock.includes('upscale_enhance'));
  // 8K 只允许作为 Lanczos 目标长边档位存在（clarMap），不允许回到提示词空话
  assert.ok(!clarityBlock.includes('8K超清'), 'clarity 不再塞 8K 空话');
  assert.ok(clarityBlock.includes("'8K': 7680"), '8K 是真实的重采样目标档位');

  const lab = read('src/lab.js');
  assert.ok(!lab.includes("id.includes('agnes')"), '试验场不再按模型名改写引用');
  assert.ok(!lab.includes('video_agnes'));
  assert.ok(lab.includes('prepareGovernedSubmit'));
  assert.ok(!lab.includes('convertLabRefs(promptText'));

  console.log('✔ 四条缺口收口验收通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
