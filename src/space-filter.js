/**
 * 素材库空间筛选别名。
 * 下拉曾经发送 living / porch_out 等旧键，标签目录用 living_room / porch，卡片展示用中文 label。
 * 展开后 dir 与 label 都能命中同一条标签。
 */
const SPACE_ALIASES = {
  living: ['living', 'living_room', '客厅'],
  living_room: ['living_room', 'living', '客厅'],
  porch_out: ['porch_out', 'porch', '门外门廊'],
  porch: ['porch', 'porch_out', '门外门廊'],
  porch_in: ['porch_in', 'foyer', '门内门厅'],
  foyer: ['foyer', 'porch_in', '门内门厅'],
  entryway: ['entryway', '玄关门厅'],
  dining: ['dining', 'dining_room', '餐厅'],
  dining_room: ['dining_room', 'dining', '餐厅'],
  cloakroom: ['cloakroom', 'walk_in_closet', '衣帽间'],
  walk_in_closet: ['walk_in_closet', 'cloakroom', '衣帽间'],
  tea_room: ['tea_room', 'tea_space', '茶空间'],
  tea_space: ['tea_space', 'tea_room', '茶空间'],
  detail: ['detail', 'detail_closeup', '细节特写'],
  detail_closeup: ['detail_closeup', 'detail', '细节特写']
};

function expandSpaceFilterValues(value) {
  const list = (Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => String(item).trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const extras = SPACE_ALIASES[item] || [item];
    for (const key of extras) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

module.exports = { SPACE_ALIASES, expandSpaceFilterValues };
