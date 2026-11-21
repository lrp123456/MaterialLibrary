const assert = require('assert');
const {
  normalizeStructure,
  normalizeScene,
  candidatesInside,
  resolveFocus,
  applyScene,
  upsertRegion,
  markSelectionChanged,
  compileDraft,
  emptyReport
} = require('../src/image-analysis/contract');

const scene = {
  spaceType: '轻奢客厅',
  colors: ['#E8DCC8'],
  candidates: [
    { id: 'tv', nameZh: '电视', part: 'other', role: 'tv', box: { x: 0.4, y: 0.3, w: 0.2, h: 0.2 } },
    { id: 'wall', nameZh: '电视背景墙', part: 'wall', role: 'feature_wall', box: { x: 0.2, y: 0.15, w: 0.6, h: 0.7 } },
    { id: 'floor', nameZh: '地面', part: 'floor', role: 'floor', box: { x: 0.1, y: 0.8, w: 0.8, h: 0.15 } }
  ]
};

function regionInput(overrides) {
  return {
    id: 'r1',
    selection: { kind: 'rect', x: 0.15, y: 0.1, w: 0.7, h: 0.75 },
    phrase: '',
    structure: {
      opening: 'center', symmetry: 'symmetric', vertical: 'single',
      construction: 'slat', boundary: 'to_ceiling'
    },
    material: { family: 'wood' },
    color: { label: '#C4A574' },
    colorIntent: 'unset',
    materialIntent: 'unset',
    ...overrides
  };
}

const normalized = normalizeScene(scene);
const report = applyScene(emptyReport('fid1'), scene);

assert.strictEqual(normalized.spaceType, '未知', '词表外的空间类型必须是未知');
assert.strictEqual(report.scene.spaceType, '未知');

const inside = candidatesInside(report.scene, { kind: 'rect', x: 0.15, y: 0.1, w: 0.7, h: 0.75 });
assert.deepStrictEqual(inside.map((item) => item.id), ['tv', 'wall']);

const preselected = resolveFocus(inside, '请看电视背景墙');
assert.strictEqual(preselected.focusConfirmed, false);
assert.strictEqual(preselected.suggestedId, 'wall');

const onlyWall = resolveFocus([inside[1]], '');
assert.strictEqual(onlyWall.focusConfirmed, true);

const withFocus = upsertRegion(report, regionInput({ focusId: 'wall' }));
const contract = withFocus.regions[0];
assert.strictEqual(contract.focusConfirmed, true);
assert.strictEqual(contract.structure.grammar, 'wall');
assert.deepStrictEqual(contract.exclusions.map((item) => item.nameZh), ['电视']);

const soft = normalizeStructure('soft_panel', { coverage: 'partial', grid: 'square', relief: 'tufted', edge: 'none', depth: 'thin' });
assert.strictEqual(soft.grammar, 'soft_panel');
const wallAndSoft = upsertRegion(report, regionInput({ focusId: 'wall' }));
assert.strictEqual(wallAndSoft.regions[0].structure.grammar, 'wall');
assert.ok(!wallAndSoft.regions[0].structure.slots.coverage, '墙面焦点不能同时填软包栏');

const head = normalizeStructure('headboard', { relation: 'wall_panel', width: 'match', height: 'pillow', division: 'whole', outline: 'straight' });
assert.strictEqual(head.grammar, 'headboard');
assert.notStrictEqual(head.grammar, soft.grammar);

const custom = normalizeStructure('custom_millwork', { opening: 'none', symmetry: 'symmetric', vertical: 'two', construction: 'cabinet', boundary: 'to_ceiling' });
const loose = normalizeStructure('freestanding_cabinet', { height: 'low', front: 'doors', width: 'continuous', base: 'legs', top: 'lip' });
assert.strictEqual(custom.grammar, 'wall');
assert.strictEqual(loose.grammar, 'cabinet');

const floorGrammar = normalizeStructure('floor', { composition: 'single', pattern: 'straight', unit: 'plank', level: 'flat', edge: 'to_wall' });
const rugGrammar = normalizeStructure('rug', { shape: 'rect', scale: 'seating', edge: 'bordered', pattern: 'plain' });
assert.notStrictEqual(floorGrammar.grammar, rugGrammar.grammar);

const roller = normalizeStructure('curtain', { kind: 'roller', opening: 'double', layers: 'sheer_blackout', length: 'floor', pleat: 'pleated' });
assert.strictEqual(roller.slots.opening, 'na');
assert.strictEqual(roller.slots.pleat, 'na');
assert.strictEqual(roller.slots.layers, 'na');

const drape = normalizeStructure('curtain', { kind: 'drape', opening: 'double', layers: 'sheer_blackout', length: 'floor', pleat: 'pleated' });
assert.strictEqual(drape.slots.layers, 'sheer_blackout');

const draft = compileDraft(contract);
assert.strictEqual(draft.ok, true);
assert.ok(draft.text.includes('电视背景墙'));
assert.ok(draft.text.includes('格栅或条板'));
assert.ok(draft.text.includes('不要改动电视'));
assert.ok(draft.text.includes('@图1'));
assert.ok(!draft.text.includes('未知'));
assert.ok(!draft.text.includes('材质'));
assert.ok(!draft.text.includes('颜色'));

const follow = compileDraft({
  ...contract,
  colorIntent: 'follow_target',
  materialIntent: 'keep'
});
assert.ok(follow.text.includes('颜色跟随@图2'));
assert.ok(follow.text.includes('材质沿用木材'));

const stale = compileDraft({ ...contract, status: 'stale' });
assert.strictEqual(stale.ok, false);
assert.strictEqual(stale.reason, 'stale');

const unconfirmed = upsertRegion(report, regionInput({ phrase: '电视背景墙' }));
assert.strictEqual(unconfirmed.regions[0].focusConfirmed, false);
assert.strictEqual(compileDraft(unconfirmed.regions[0]).reason, 'unconfirmed');

const rerun = applyScene(withFocus, { ...scene, spaceType: '客厅' });
assert.strictEqual(rerun.scene.spaceType, '客厅');
assert.strictEqual(rerun.regions[0].status, 'stale');
assert.strictEqual(compileDraft(rerun.regions[0]).ok, false);

const moved = markSelectionChanged(withFocus, 'r1');
assert.strictEqual(moved.regions[0].status, 'stale');
assert.strictEqual(moved.regions[0].focusConfirmed, false);

const invented = normalizeStructure('feature_wall', { opening: 'marble-arch', symmetry: 'symmetric', vertical: 'single', construction: 'slat', boundary: 'to_ceiling' });
assert.strictEqual(invented.slots.opening, 'unknown');

console.log('image-analysis contract tests passed');
