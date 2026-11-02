/**
 * 风格方案映射到已有表面选区：按名称和空间取槽位，不覆盖已有陈设操作。
 */
import assert from 'node:assert/strict';
import { detectRegionTarget, pickSchemeSlot, mapSchemeToRegions } from '../src/base-library/scheme-apply.mjs';

const slots = [
  { surface: 'wall', role: 'base', space_key: 'any', item_id: 'wall-base', name_zh: '燕麦墙', hex: '#E4D5C8', kind_key: 'latex', preview_rel: 'wall.jpg' },
  { surface: 'wall', role: 'accent', space_key: 'any', item_id: 'wall-accent', name_zh: '灰绿点缀', kind_key: 'latex' },
  { surface: 'floor', role: 'any', space_key: 'any', item_id: 'floor-stone', name_zh: '暖灰岩板', kind_key: 'stone', preview_rel: 'floor.jpg' },
  { surface: 'soft', role: 'sofa', space_key: 'living', item_id: 'sofa-liv', name_zh: '客厅沙发布', kind_key: 'fabric' },
  { surface: 'soft', role: 'curtain', space_key: 'living', item_id: 'curtain-liv', name_zh: '客厅帘', kind_key: 'fabric' },
  { surface: 'soft', role: 'curtain', space_key: 'bedroom', item_id: 'curtain-bed', name_zh: '卧室帘', kind_key: 'fabric' }
];

assert.deepStrictEqual(detectRegionTarget({ name: '床头墙' }), { surface: 'wall', role: null });
assert.deepStrictEqual(detectRegionTarget({ name: '点缀墙' }), { surface: 'wall', role: 'accent' });
assert.deepStrictEqual(detectRegionTarget({ name: '区域2', inferredSurface: 'floor' }), { surface: 'floor', role: null });
assert.strictEqual(detectRegionTarget({ name: '区域3' }), null);

assert.strictEqual(pickSchemeSlot(slots, { surface: 'soft', role: 'curtain', spaceKey: 'bedroom' }).item_id, 'curtain-bed');
assert.strictEqual(pickSchemeSlot(slots, { surface: 'soft', role: 'chair', spaceKey: 'living' }), null);
assert.strictEqual(pickSchemeSlot(slots, { surface: 'wall', role: 'accent', spaceKey: 'living' }).item_id, 'wall-accent');

const scheme = { id: 'italian_minimal_a', slots };
const mapped = mapSchemeToRegions([
  { id: 'w', name: '床头墙', op: 'custom', params: {} },
  { id: 'f', name: '地面', op: 'custom', params: {} },
  { id: 's', name: '沙发', op: 'custom', params: {} },
  { id: 'c', name: '窗帘', op: 'custom', params: {} },
  { id: 'k', name: '餐椅', op: 'custom', params: {} },
  { id: 'r', name: '单人沙发', op: 'replace', params: { glbUrl: '/models/sofa.glb' } },
  { id: 'u', name: '区域9', op: 'custom', params: {} }
], scheme, { spaceKey: 'bedroom' });

assert.strictEqual(mapped.applied.length, 3);
assert.strictEqual(mapped.regions.find((row) => row.id === 'w').params.baseAttr.item_id, 'wall-base');
assert.strictEqual(mapped.regions.find((row) => row.id === 'w').params.baseAttr.subclass, 'wall_paint');
assert.strictEqual(mapped.regions.find((row) => row.id === 'w').op, 'recolor');
assert.ok(mapped.regions.find((row) => row.id === 'w').params.materialTextureUrl.includes('wall-base'));
assert.strictEqual(mapped.regions.find((row) => row.id === 'c').params.item_id, 'curtain-bed');
assert.strictEqual(mapped.regions.find((row) => row.id === 's').op, 'custom');
assert.strictEqual(mapped.regions.find((row) => row.id === 'k').op, 'custom');
assert.strictEqual(mapped.regions.find((row) => row.id === 'r').op, 'replace');
assert.strictEqual(mapped.regions.find((row) => row.id === 'r').params.glbUrl, '/models/sofa.glb');
assert.ok(mapped.skipped.some((row) => row.id === 'u' && row.reason === '未识别表面'));
assert.ok(mapped.skipped.some((row) => row.id === 's'));

console.log('scheme-apply ok');
