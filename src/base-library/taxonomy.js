/**
 * 基础属性库 8 装修面与子类分类法
 * 作为服务端与客户端的单一事实来源 (Single Source of Truth)
 */

const SURFACES = [
  {
    key: 'ceiling',
    label: '天花',
    subclasses: [
      { key: 'ceiling_paint', label: '天花-乳胶漆', warehouses: ['paint'] },
      { key: 'ceiling_panel', label: '天花-吊顶板', warehouses: ['material'] },
      { key: 'ceiling_cornice', label: '天花-石膏线', warehouses: ['material', 'paint'] }
    ]
  },
  {
    key: 'wall',
    label: '墙面',
    subclasses: [
      { key: 'wall_paint', label: '墙面-乳胶漆', warehouses: ['paint'] },
      { key: 'wall_microcement', label: '墙面-微水泥', warehouses: ['material'] },
      { key: 'wall_paper', label: '墙面-墙纸', warehouses: ['material'] },
      { key: 'wall_cloth', label: '墙面-墙布', warehouses: ['material'] },
      { key: 'wall_paneling', label: '墙面-护墙', warehouses: ['material'] },
      { key: 'wall_tile', label: '墙面-背景墙砖', warehouses: ['material'] }
    ]
  },
  {
    key: 'floor',
    label: '地面',
    subclasses: [
      { key: 'floor_wood', label: '地面-木地板', warehouses: ['material'] },
      { key: 'floor_stone', label: '地面-瓷砖石材', warehouses: ['material'] },
      { key: 'floor_carpet', label: '地面-地毯', warehouses: ['material'] },
      { key: 'floor_microcement', label: '地面-微水泥', warehouses: ['material'] },
      { key: 'floor_epoxy', label: '地面-地坪漆', warehouses: ['paint'] }
    ]
  },
  {
    key: 'millwork',
    label: '全屋定制',
    subclasses: [
      { key: 'millwork_door', label: '全屋定制-柜门', warehouses: ['material', 'paint'] },
      { key: 'millwork_trim', label: '全屋定制-线条', warehouses: ['material', 'paint'] },
      { key: 'millwork_top', label: '全屋定制-台面', warehouses: ['material'] }
    ]
  },
  {
    key: 'furniture',
    label: '活动家具',
    subclasses: [
      { key: 'furniture_top', label: '活动家具-桌面', warehouses: ['material'] },
      { key: 'chair_frame', label: '餐椅-框架', warehouses: ['material'] },
      { key: 'chair_fabric', label: '餐椅-织物', warehouses: ['material'] },
      { key: 'furniture_wood', label: '活动家具-木作', warehouses: ['material'] }
    ]
  },
  {
    key: 'soft',
    label: '软装',
    subclasses: [
      { key: 'soft_leather', label: '真皮', warehouses: ['material'] },
      { key: 'soft_fabric', label: '织物', warehouses: ['material'] },
      { key: 'soft_veneer', label: '木皮', warehouses: ['material'] },
      { key: 'soft_metal', label: '金属', warehouses: ['material'] },
      { key: 'soft_model', label: '挂画/摆件/绿植等', warehouses: ['model'] }
    ]
  },
  {
    key: 'lighting',
    label: '灯具',
    subclasses: [
      { key: 'lighting', label: '灯具', warehouses: ['light'] }
    ]
  },
  {
    key: 'fixture',
    label: '卫浴厨电五金',
    subclasses: [
      { key: 'fixture', label: '卫浴厨电五金', warehouses: ['model'] }
    ]
  }
];

const VALID_SURFACE_KEYS = new Set(SURFACES.map(s => s.key));
const VALID_SUBCLASS_KEYS = new Set();
const SUBCLASS_MAP = new Map();

for (const s of SURFACES) {
  for (const sub of s.subclasses) {
    VALID_SUBCLASS_KEYS.add(sub.key);
    SUBCLASS_MAP.set(sub.key, { ...sub, surface: s.key, surfaceLabel: s.label });
  }
}

function isValidSurface(surface) {
  return VALID_SURFACE_KEYS.has(surface);
}

function isValidSubclass(subclass) {
  return VALID_SUBCLASS_KEYS.has(subclass);
}

function getSubclassMeta(subclass) {
  return SUBCLASS_MAP.get(subclass) || null;
}

const SKIN_SUBCLASSES = [
  { key: 'soft_leather', label: '真皮', warehouses: ['material'] },
  { key: 'soft_fabric', label: '织物', warehouses: ['material'] },
  { key: 'soft_veneer', label: '木皮', warehouses: ['material'] },
  { key: 'soft_metal', label: '金属', warehouses: ['material'] }
];

function getTaxonomy() {
  return { surfaces: SURFACES, skins: SKIN_SUBCLASSES };
}

module.exports = {
  SURFACES,
  VALID_SURFACE_KEYS,
  VALID_SUBCLASS_KEYS,
  isValidSurface,
  isValidSubclass,
  getSubclassMeta,
  getTaxonomy,
  SKIN_SUBCLASSES
};
