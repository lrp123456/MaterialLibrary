/**
 * 打开三个库用的瘦数据：创作卡片不带提示词，对话屏幕不带快照和内嵌大图。
 */
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { toCreationCard } = require('../src/creation-card');
const { screenMessage } = require('../src/chat-screen');

function ok(name) { console.log('✅ ' + name); }

const card = toCreationCard({
  id: 'tpl_1',
  title: '沙发',
  type: 'image',
  prompt: '柜门，暖光',
  params: { ratio: '16:9', model: 'secret' },
  tags: ['客厅'],
  result_images: [{ fid: 'fid_a', url: '/api/viewer/assets/fid_a/image', w: 100, h: 200 }],
  origin_images: [{ url: 'data:image/png;base64,AAAA' }],
});
assert.equal(card.card, true);
assert.equal(card.prompt, undefined);
assert.equal(card.params, undefined);
assert.equal(card.result_images[0].fid, 'fid_a');
assert.equal(card.result_images[0].url, '/api/viewer/assets/fid_a/image');
assert.deepEqual(card.origin_images, []);
ok('创作卡片只留封面，不带提示词');

const msg = screenMessage({
  id: 'm1',
  role: 'assistant',
  mode: 'text_to_image',
  prompt: '柜门',
  status: 'done',
  created_at: 1,
  params: {
    ratio: '9:16',
    requestSnapshot: { body: 'huge' },
    refs: [{ url: 'data:image/png;base64,BBBB' }],
  },
  images: ['data:image/jpeg;base64,CCCC', '/api/cache/temp/a.jpg'],
  result: {
    imageUrl: '/api/cache/temp/out.jpg',
    userPrompt: '柜门',
    raw: { inline: 'x'.repeat(9000) },
    requestSnapshot: { a: 1 },
    audioUrl: '',
  },
});
assert.equal(msg.prompt, '柜门');
assert.equal(msg.result.imageUrl, '/api/cache/temp/out.jpg');
assert.equal(msg.result.userPrompt, '柜门');
assert.equal(msg.result.raw, undefined);
assert.equal(msg.result.requestSnapshot, undefined);
assert.equal(msg.params.requestSnapshot, undefined);
assert.equal(msg.params.ratio, '9:16');
assert.deepEqual(msg.params.refs, []);
assert.deepEqual(msg.images, ['/api/cache/temp/a.jpg']);
ok('对话屏幕丢掉快照和内嵌大图，保留正文和封面地址');

console.log('open-fast-card: ok');
