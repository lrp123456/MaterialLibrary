import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { expandSpaceFilterValues } = require('../src/space-filter.js');

const living = expandSpaceFilterValues('living');
assert.ok(living.includes('living_room'), 'living expands to living_room');
assert.ok(living.includes('客厅'), 'living expands to 客厅');

const room = expandSpaceFilterValues('living_room');
assert.ok(room.includes('living_room') && room.includes('客厅'));

const legacy = expandSpaceFilterValues('porch_out,dining,cloakroom,tea_room,detail');
for (const key of ['porch', '门外门廊', 'dining_room', '餐厅', 'walk_in_closet', '衣帽间', 'tea_space', '茶空间', 'detail_closeup', '细节特写']) {
  assert.ok(legacy.includes(key), `missing ${key}`);
}

assert.deepEqual(expandSpaceFilterValues(''), []);
assert.deepEqual(expandSpaceFilterValues('kitchen'), ['kitchen']);

console.log('space-filter ok');
