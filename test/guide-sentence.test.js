const assert = require('node:assert');
const path = require('node:path');
const Database = require('better-sqlite3');
const { SKIN_SUBCLASSES, isValidSubclass } = require('../src/base-library/taxonomy');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { createGuide, listGuides, deleteGuide } = require('../src/base-library/guides');

async function runTests() {
  const mod = await import('file://' + path.resolve(__dirname, '../web-pro/src/utils/guide-sentence.js').replace(/\\/g, '/'));
  const { guideSentence, applyGuide, BUILTIN_GUIDE_TEXT } = mod;

  const resurface = guideSentence({
    name: '区域1',
    guide: { type: 'resurface', materialName: '微水泥', colorHex: '', finish: '', roughness: null, aging: '' }
  });
  assert.ok(resurface.includes('微水泥'));
  assert.ok(resurface.includes('框外所有像素保持原样'));
  assert.ok(!resurface.includes('#'));
  assert.ok(!resurface.includes('粗糙'));
  assert.ok(!resurface.includes('光泽'));

  const colored = guideSentence({
    name: '区域1',
    guide: { type: 'resurface', materialName: '微水泥', colorHex: '#B5B4AF', roughness: 25, finish: 'matte' }
  });
  assert.ok(colored.includes('微水泥'));
  assert.ok(colored.includes('#B5B4AF'));
  assert.ok(colored.includes('哑光'));
  assert.ok(colored.includes('框外所有像素保持原样'));

  assert.strictEqual(guideSentence({ name: '区域2', guide: { type: 'remove', text: '' } }), BUILTIN_GUIDE_TEXT.remove);
  assert.strictEqual(guideSentence({ name: '区域3', guide: { type: 'blank', text: '' } }), BUILTIN_GUIDE_TEXT.blank);

  const added = guideSentence({
    name: '区域1',
    guide: { type: 'add', objectName: '意式单人沙发', suggestion: { label: '织物', hex: '#112233', accepted: false } }
  });
  assert.strictEqual(added, '在区域1增加意式单人沙发。');
  assert.ok(!added.includes('#112233'));

  const current = { type: 'resurface', surface: 'floor', materialName: '木地板' };
  const saved = { type: 'resurface', surface: 'wall', materialName: '微水泥' };
  const pending = applyGuide(current, saved);
  assert.strictEqual(pending.needsConfirm, true);
  assert.strictEqual(pending.guide.materialName, '木地板');
  assert.strictEqual(current.materialName, '木地板');

  const same = applyGuide({ type: 'resurface', surface: 'wall', materialName: '乳胶漆' }, saved);
  assert.strictEqual(same.needsConfirm, false);
  assert.strictEqual(same.guide.materialName, '微水泥');

  assert.ok(isValidSubclass('wall_microcement'));
  assert.ok(isValidSubclass('floor_microcement'));
  for (const skin of SKIN_SUBCLASSES) assert.ok(isValidSubclass(skin.key));

  const db = new Database(':memory:');
  ensureBaseLibrarySchema(db);
  const stored = createGuide(db, 'user-a', {
    name: '暖灰微水泥',
    type: 'resurface',
    slots: { type: 'resurface', surface: 'wall', materialName: '微水泥' }
  });
  assert.strictEqual(listGuides(db, 'user-a').length, 1);
  assert.strictEqual(listGuides(db, 'user-b').length, 0);
  assert.strictEqual(deleteGuide(db, 'user-a', stored.id), true);
  assert.strictEqual(listGuides(db, 'user-a').length, 0);
  console.log('guide sentence and taxonomy checks passed');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
