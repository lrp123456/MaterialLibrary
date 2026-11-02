/**
 * 空间局部编辑：8 部位白名单与黑名单策略定义 (Part Policy)
 * 单一事实来源，供前端 ResurfaceDrawer 与服务端 compileBaseAttributes 共用校验。
 */

const VALID_PARTS = [
  'ceiling',
  'wall',
  'floor',
  'millwork',
  'upholstery',
  'hard_furniture',
  'curtain_bedding',
  'rug'
];

const VALID_MATERIAL_FAMILIES = [
  'paint',
  'art_coat',
  'wood',
  'stone',
  'leather',
  'fabric',
  'metal',
  'glass',
  'unknown'
];

const PART_POLICIES = {
  ceiling: {
    key: 'ceiling',
    label: '顶面',
    default_material_family: 'paint',
    default_families: ['warm_white', 'cream', 'cool_gray'],
    lrv_min_default: 70,
    subclasses: ['ceiling_paint', 'ceiling_art', 'ceiling_wood'],
    forbidden_subclasses: [
      'floor_wood', 'floor_stone', 'floor_tile', 'floor_terrazzo', 'floor_coat', 'floor_microcement',
      'soft_rug', 'soft_curtain', 'soft_bedding',
      'uph_leather', 'uph_fabric', 'uph_boucle', 'uph_velvet',
      'wall_paper', 'wall_tile'
    ]
  },
  wall: {
    key: 'wall',
    label: '墙面',
    default_material_family: 'paint',
    default_families: ['warm_white', 'cream', 'ivory', 'greige', 'earth', 'cool_gray', 'morandi', 'caramel', 'ink'],
    lrv_min_default: null,
    subclasses: ['wall_paint', 'wall_art', 'wall_wood', 'wall_stone', 'wall_paper', 'wall_tile'],
    forbidden_subclasses: [
      'floor_wood', 'floor_stone', 'floor_terrazzo', 'floor_coat',
      'soft_rug', 'soft_curtain', 'soft_bedding',
      'uph_leather', 'uph_fabric', 'uph_boucle', 'uph_velvet'
    ]
  },
  floor: {
    key: 'floor',
    label: '地面',
    default_material_family: 'wood',
    default_families: ['caramel', 'greige', 'warm_white', 'earth', 'cool_gray'],
    lrv_min_default: null,
    subclasses: ['floor_wood', 'floor_stone', 'floor_tile', 'floor_terrazzo', 'floor_coat', 'floor_microcement'],
    forbidden_subclasses: [
      'wall_paint', 'ceiling_paint', 'wall_paper',
      'uph_leather', 'uph_fabric', 'uph_boucle', 'uph_velvet',
      'soft_curtain', 'soft_bedding', 'mill_lacquer'
    ]
  },
  millwork: {
    key: 'millwork',
    label: '定制柜体',
    default_material_family: 'paint',
    default_families: ['warm_white', 'cream', 'greige', 'caramel', 'cool_gray', 'ink'],
    lrv_min_default: null,
    subclasses: ['mill_lacquer', 'mill_veneer', 'mill_stone'],
    subclass_labels: {
      mill_lacquer: '柜门-烤漆',
      mill_veneer: '柜门-木皮',
      mill_stone: '台面-石材岩板'
    },
    forbidden_subclasses: [
      'wall_paint', 'ceiling_paint', 'floor_wood', 'floor_tile',
      'soft_rug', 'soft_curtain', 'soft_bedding',
      'uph_leather', 'uph_fabric', 'uph_boucle', 'uph_velvet'
    ]
  },
  upholstery: {
    key: 'upholstery',
    label: '软体',
    default_material_family: 'leather',
    default_families: ['caramel', 'cream', 'ink', 'morandi', 'earth'],
    lrv_min_default: null,
    subclasses: ['uph_leather', 'uph_fabric', 'uph_boucle', 'uph_velvet'],
    forbidden_subclasses: [
      'wall_paint', 'ceiling_paint', 'wall_art', 'wall_stone', 'wall_paper', 'wall_tile',
      'floor_wood', 'floor_stone', 'floor_tile', 'floor_terrazzo', 'floor_coat', 'floor_microcement',
      'hard_metal', 'hard_glass'
    ]
  },
  hard_furniture: {
    key: 'hard_furniture',
    label: '硬家具与五金',
    default_material_family: 'wood',
    default_families: ['caramel', 'earth', 'cool_gray', 'ink'],
    lrv_min_default: null,
    subclasses: ['hard_wood', 'hard_stone', 'hard_metal', 'hard_glass'],
    forbidden_subclasses: [
      'wall_paint', 'ceiling_paint', 'wall_paper',
      'soft_rug', 'soft_curtain', 'soft_bedding',
      'uph_boucle'
    ]
  },
  curtain_bedding: {
    key: 'curtain_bedding',
    label: '窗帘与床品',
    default_material_family: 'fabric',
    default_families: ['ink', 'morandi', 'cream', 'earth', 'greige'],
    lrv_min_default: null,
    subclasses: ['soft_curtain', 'soft_bedding'],
    forbidden_subclasses: [
      'soft_rug', 'wall_paint', 'ceiling_paint',
      'floor_stone', 'floor_wood', 'floor_tile',
      'hard_metal', 'hard_glass', 'uph_leather'
    ]
  },
  rug: {
    key: 'rug',
    label: '地毯',
    default_material_family: 'fabric',
    default_families: ['earth', 'greige', 'ink', 'cream'],
    lrv_min_default: null,
    subclasses: ['soft_rug'],
    forbidden_subclasses: [
      'soft_curtain', 'soft_bedding', 'wall_paint', 'ceiling_paint',
      'floor_stone', 'floor_wood', 'floor_tile',
      'hard_metal', 'uph_leather'
    ]
  }
};

const PART_TO_SURFACE = {
  ceiling: 'ceiling',
  wall: 'wall',
  floor: 'floor',
  millwork: 'millwork',
  upholstery: 'furniture',
  hard_furniture: 'furniture',
  curtain_bedding: 'soft',
  rug: 'soft'
};

const SURFACE_TO_PART = {
  ceiling: 'ceiling',
  wall: 'wall',
  floor: 'floor',
  millwork: 'millwork',
  furniture: 'upholstery',
  soft: 'curtain_bedding',
  lighting: null,
  fixture: null
};

// 宽松的旧子类与新白名单兼容映射
const SUBCLASS_COMPAT_MAP = {
  wall_paneling: 'wall_wood',
  millwork_door: 'mill_veneer',
  millwork_carcass: 'mill_lacquer',
  millwork_top: 'mill_stone',
  floor_epoxy: 'floor_coat',
  chair_fabric: 'uph_fabric',
  soft_fabric: 'uph_fabric',
  ceiling_panel: 'ceiling_paint',
  ceiling_cornice: 'ceiling_art'
};

/**
 * 判断某个子类在给定部位下是否合法
 */
function isSubclassAllowed(part, subclass) {
  if (!part || !PART_POLICIES[part]) return false;
  const policy = PART_POLICIES[part];
  const mappedSubclass = SUBCLASS_COMPAT_MAP[subclass] || subclass;

  if (policy.forbidden_subclasses.includes(mappedSubclass) || policy.forbidden_subclasses.includes(subclass)) {
    return false;
  }
  return policy.subclasses.includes(mappedSubclass) || policy.subclasses.includes(subclass);
}

/**
 * 校验资产挂载的全部 tags 是否能在该部位使用
 */
function isAssetAllowedForPart(part, tags = []) {
  if (!part || !PART_POLICIES[part]) return false;
  if (!Array.isArray(tags) || tags.length === 0) return true; // 无标签时不直接硬拒

  // 如果所有标签都在黑名单，则明确拒绝
  const policy = PART_POLICIES[part];
  const hasForbidden = tags.some(t => {
    const sc = (t && t.subclass) || '';
    return policy.forbidden_subclasses.includes(sc) || policy.forbidden_subclasses.includes(SUBCLASS_COMPAT_MAP[sc]);
  });
  if (hasForbidden) return false;

  // 检查是否至少有一个标签命中白名单
  return tags.some(t => {
    const sc = (t && t.subclass) || '';
    return policy.subclasses.includes(sc) || policy.subclasses.includes(SUBCLASS_COMPAT_MAP[sc]);
  });
}

function resolvePartFromSurface(surface) {
  return SURFACE_TO_PART[surface] || null;
}

function resolveSurfaceFromPart(part) {
  return PART_TO_SURFACE[part] || null;
}

module.exports = {
  VALID_PARTS,
  VALID_MATERIAL_FAMILIES,
  PART_POLICIES,
  PART_TO_SURFACE,
  SURFACE_TO_PART,
  SUBCLASS_COMPAT_MAP,
  isSubclassAllowed,
  isAssetAllowedForPart,
  resolvePartFromSurface,
  resolveSurfaceFromPart
};
