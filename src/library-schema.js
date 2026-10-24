/**
 * 每个库开放哪些标签维度。筛选条和打标 prompt 都读这里。
 * interior_design 是导航名，库存仍是 interior / exterior。
 */
const LIBRARIES = {
  interior_design: {
    storedCategories: ['interior', 'exterior'],
    primary: ['space', 'style_atom', 'wood_style', 'material_kind', 'dominant_color', 'orientation'],
    more: [],
  },
  portrait: {
    storedCategories: ['portrait'],
    primary: ['gender', 'person_style', 'shot_type', 'orientation'],
    more: [],
  },
  clothing: {
    storedCategories: ['clothing'],
    primary: ['clothing_category', 'clothing_style', 'season', 'dominant_color'],
    more: [],
  },
  furniture: {
    storedCategories: ['furniture'],
    primary: ['furniture_category', 'furniture_item', 'style_atom', 'wood_style', 'material_kind', 'dominant_color', 'orientation'],
    more: ['classic_design', 'furniture_craft', 'furniture_form'],
  },
  retouched: {
    storedCategories: [],
    primary: ['derivative_kind', 'space', 'style_atom', 'wood_style', 'orientation'],
    more: [],
  },
  finished: {
    storedCategories: ['finished'],
    primary: ['orientation'],
    more: [],
  },
  video: {
    storedCategories: [],
    primary: ['video_source', 'video_purpose', 'space', 'style_atom', 'orientation'],
    more: [],
  },
  music: {
    storedCategories: [],
    primary: ['mood'],
    more: [],
  },
};

const DERIVATIVE_KINDS = [
  { dir: 'style_transferred', label: '风格转换' },
  { dir: 'quick_replace', label: '局部替换' },
  { dir: 'quick_remove', label: '局部消除' },
  { dir: 'quick_insert', label: '局部插入' },
  { dir: 'clarity_enhanced', label: '高清' },
  { dir: 'expand', label: '扩图' },
  { dir: 'retouched', label: '精修' },
  { dir: 'manual_edit', label: '手动编辑' },
];

function schemaKey(library) {
  const key = String(library || '').trim();
  if (key === 'interior' || key === 'exterior') return 'interior_design';
  return key;
}

function schemaFor(library) {
  return LIBRARIES[schemaKey(library)] || null;
}

function dimensionsFor(library, tier = 'primary') {
  const row = schemaFor(library);
  if (!row) return [];
  if (tier === 'more') return row.more.slice();
  if (tier === 'all') return row.primary.concat(row.more);
  return row.primary.slice();
}

function categoryDimensions() {
  const out = {};
  for (const [key, row] of Object.entries(LIBRARIES)) {
    out[key] = row.primary.concat(row.more);
  }
  out.interior = out.interior_design;
  out.exterior = out.interior_design;
  return out;
}

module.exports = {
  LIBRARIES,
  DERIVATIVE_KINDS,
  schemaKey,
  schemaFor,
  dimensionsFor,
  categoryDimensions,
};
