/**
 * 网页素材库目录体系与分类字典。
 * 手机端仍读 menu-tree，不改动旧契约。
 */

const SHELVES = [
  { key: 'original', label: '原素材' },
  { key: 'retouched', label: '精修素材' },
  { key: 'finished', label: '成品素材' }
];

const LANES = [
  {
    key: 'image',
    label: '图片',
    shelf: true,
    sections: [
      { key: 'interior_exterior', label: '室内外设计' },
      { key: 'portrait', label: '空间人像' },
      { key: 'clothing', label: '服装服饰' },
      { key: 'furniture', label: '单品家具' }
    ]
  },
  {
    key: 'video',
    label: '视频',
    shelf: true,
    sections: [
      { key: 'walkthrough', label: '空间漫游' },
      { key: 'product', label: '单品展示' },
      { key: 'detail', label: '细节特写' },
      { key: 'ad', label: '商业短片' },
      { key: 'portrait', label: '人像动态' }
    ]
  },
  {
    key: 'audio',
    label: '音频',
    shelf: true,
    sections: [
      { key: 'bgm', label: '氛围背景乐' },
      { key: 'sfx', label: '环境音效' }
    ]
  },
  {
    key: 'base',
    label: '基础素材',
    shelf: false,
    sections: [
      { key: 'material', label: '材质' },
      { key: 'design', label: '做法' },
      { key: 'product', label: '选品' },
      { key: 'scheme', label: '风格方案' }
    ]
  },
  {
    key: 'clip',
    label: '剪辑工程',
    shelf: false,
    sections: [
      { key: 'input', label: '工程引用' },
      { key: 'output', label: '导出成片' }
    ]
  },
  {
    key: 'trash',
    label: '回收站',
    shelf: false,
    sections: [
      { key: 'gate_reject', label: 'AI 闸门拦截' },
      { key: 'user_delete', label: '人工删除' }
    ]
  }
];

// 基础素材二级槽位规范：
// 材质第一栏（使用面）：墙面、顶面、地面、软装、全屋定制（删除微水泥、金属、玻璃、藤编，地毯只进选品）
// 做法第二行：吊顶、墙面、门板
// 选品第二行：家具、灯具、洁具、软装
const BASE_SURFACES = [
  { key: 'wall', label: '墙面' },
  { key: 'ceiling', label: '顶面' },
  { key: 'floor', label: '地面' },
  { key: 'soft', label: '软装' },
  { key: 'millwork', label: '全屋定制' }
];

const SURFACE_SUBCLASSES = {
  wall: [
    { key: 'latex', label: '乳胶漆' },
    { key: 'microcement', label: '微水泥' },
    { key: 'wallpaper', label: '墙纸' },
    { key: 'wallcloth', label: '墙布' },
    { key: 'wood_veneer', label: '木饰面' }
  ],
  ceiling: [
    { key: 'latex', label: '乳胶漆' },
    { key: 'microcement', label: '微水泥' }
  ],
  floor: [
    { key: 'tile', label: '瓷砖' },
    { key: 'wood_flooring', label: '木地板' }
  ],
  soft: [
    { key: 'fabric', label: '织物' },
    { key: 'leather', label: '皮革' }
  ],
  millwork: [
    { key: 'board', label: '板材' },
    { key: 'door_finish', label: '门材质与颜色' },
    { key: 'door_casing', label: '门套' },
    { key: 'baseboard', label: '踢脚线' },
    { key: 'countertop', label: '台面与窗台石' }
  ]
};

const TILE_GLOSS_OPTIONS = [
  { key: '', label: '全部光泽' },
  { key: 'glossy', label: '亮光' },
  { key: 'soft', label: '柔光' },
  { key: 'matte', label: '哑光' }
];

const TILE_PATTERN_OPTIONS = [
  { key: '', label: '全部纹理' },
  { key: 'stone', label: '石纹' },
  { key: 'wood', label: '木纹' },
  { key: 'floral', label: '拼花' },
  { key: 'solid', label: '纯色' }
];

const PAINT_HUE_OPTIONS = [
  { key: '', label: '全部主色' },
  { key: 'white', label: '白' },
  { key: 'yellow', label: '黄' },
  { key: 'green', label: '绿' },
  { key: 'blue', label: '蓝' },
  { key: 'red', label: '红' },
  { key: 'gray', label: '灰' },
  { key: 'black', label: '黑' },
  { key: 'brown', label: '棕' }
];

const BASE_DESIGNS = [
  { key: 'ceiling', label: '吊顶' },
  { key: 'wall', label: '墙面' },
  { key: 'door', label: '门板' }
];

const BASE_PRODUCTS = [
  { key: 'furniture', label: '家具' },
  { key: 'light', label: '灯具' },
  { key: 'sanitary', label: '洁具' },
  { key: 'soft', label: '软装' }
];

function getLibraryCatalog() {
  return {
    lanes: LANES,
    shelves: SHELVES,
    baseSurfaces: BASE_SURFACES,
    surfaceSubclasses: SURFACE_SUBCLASSES,
    tileGlossOptions: TILE_GLOSS_OPTIONS,
    tilePatternOptions: TILE_PATTERN_OPTIONS,
    paintHueOptions: PAINT_HUE_OPTIONS,
    baseDesigns: BASE_DESIGNS,
    baseProducts: BASE_PRODUCTS
  };
}

module.exports = {
  LANES,
  SHELVES,
  BASE_SURFACES,
  SURFACE_SUBCLASSES,
  TILE_GLOSS_OPTIONS,
  TILE_PATTERN_OPTIONS,
  PAINT_HUE_OPTIONS,
  BASE_DESIGNS,
  BASE_PRODUCTS,
  getLibraryCatalog
};
