/**
 * 木纹策展目录 v1（校准样本 50 条）
 * - 千年舟：品牌官网花色，木种按花色名推断，source=inferred
 * - Poly Haven：CC0 木纹贴图，木种按资产名/标签显式记录
 * - ambientCG：CC0 兜底木纹
 * 只记录源图方向，不生成旋转变体。
 */

const TREEZO_PAGE = 'https://www.treezogroup.com/individuals-households/product/48.html';
const TREEZO_BASE = 'https://resource.treezogroup.com/Public/Uploads/uploadfile/images/20260411/';

function treezo(name, file, externalId, species, grain, scale, direction, finish, confidence, pattern = 'wood') {
  return {
    id: `wood_treezo_${file.replace(/\.jpg$/, '').replace(/[^a-z0-9]+/gi, '_')}`,
    kind_key: 'wood',
    name_zh: name,
    name_en: `Treezo ${file.replace(/\.jpg$/, '')}`,
    brand: '千年舟',
    brand_series: '芦香板',
    source: 'treezo',
    source_id: externalId,
    source_url: TREEZO_PAGE,
    image_url: `${TREEZO_BASE}${file}`,
    download: { type: 'direct', url: `${TREEZO_BASE}${file}` },
    external_id: externalId,
    origin: 'brand',
    license: '品牌官网',
    mounts: ['millwork', 'wall', 'floor', 'furniture'],
    wood_species: species,
    wood_species_source: 'inferred',
    grain_type: grain,
    grain_scale: scale,
    grain_direction: direction,
    wood_layout: 'plain',
    surface_finish: finish,
    pattern,
    confidence
  };
}

const TREEZO_ITEMS = [
  treezo('逐浪橡木', 'zhulangxiangmu-838.jpg', 'treezo:232', 'white_oak', 'wavy', 'medium', 'vertical', 'matte', 0.72),
  treezo('烟澜金缕', 'yanlanjinlv-712.jpg', 'treezo:231', 'engineered', 'ribbon', 'fine', 'vertical', 'matte', 0.62),
  treezo('晚宜胡桃', 'wanyihutao-708.jpg', 'treezo:230', 'walnut', 'straight', 'medium', 'vertical', 'matte', 0.74),
  treezo('清辉金缕', 'qinghuijinlv-291.jpg', 'treezo:229', 'engineered', 'ribbon', 'fine', 'vertical', 'matte', 0.62),
  treezo('轻岚水曲柳', 'qingshuiquliu-20.jpg', 'treezo:228', 'ash', 'cathedral', 'medium', 'vertical', 'matte', 0.76),
  treezo('栖柠胡桃', 'qininghutao-76.jpg', 'treezo:227', 'walnut', 'straight', 'medium', 'vertical', 'matte', 0.74),
  treezo('流沙橡木', 'liushaxiangmu-460.jpg', 'treezo:226', 'white_oak', 'straight', 'medium', 'vertical', 'matte', 0.72),
  treezo('山禾景榆', 'shanhejingyu-852.jpg', 'treezo:225', 'elm', 'cathedral', 'medium', 'vertical', 'matte', 0.72),
  treezo('岩云意橡', 'yanyunyixiang-69.jpg', 'treezo:224', 'white_oak', 'straight', 'fine', 'vertical', 'matte', 0.7),
  treezo('梦隐沉榆', 'mengyinchenyu-55.jpg', 'treezo:223', 'elm', 'straight', 'medium', 'vertical', 'matte', 0.7),
  treezo('溪山沉榆', 'xishanchenyu-331.jpg', 'treezo:222', 'elm', 'straight', 'medium', 'vertical', 'matte', 0.7),
  treezo('林泉石语', 'linquanshiyu-588.jpg', 'treezo:221', 'engineered', 'wavy', 'coarse', 'mixed', 'gloss', 0.6, 'stone'),
  treezo('月明胡桃', 'yueminghutao-52.jpg', 'treezo:220', 'walnut', 'straight', 'medium', 'vertical', 'matte', 0.74),
  treezo('春日胡桃', 'chunrihutao-602.jpg', 'treezo:219', 'walnut', 'straight', 'medium', 'vertical', 'matte', 0.74),
  treezo('岩流石逸', 'yanliushiyi-592.jpg', 'treezo:218', 'engineered', 'wavy', 'coarse', 'mixed', 'gloss', 0.6, 'stone')
];

function polyhaven(asset, nameZh, nameEn, species, grain, scale, direction, layout, finish, mounts, confidence, extra = {}) {
  return {
    id: `wood_ph_${asset}`,
    kind_key: 'wood',
    name_zh: nameZh,
    name_en: nameEn,
    brand: 'Poly Haven',
    brand_series: extra.series || 'CC0 木纹',
    source: 'polyhaven',
    source_id: asset,
    source_url: `https://polyhaven.com/a/${asset}`,
    image_url: `https://cdn.polyhaven.com/asset_img/primary/${asset}.png?width=512&height=512`,
    download: { type: 'polyhaven', asset },
    external_id: `polyhaven:${asset}`,
    origin: 'generic',
    license: 'CC0',
    mounts,
    wood_species: species,
    wood_species_source: 'explicit',
    grain_type: grain,
    grain_scale: scale,
    grain_direction: direction,
    wood_layout: layout,
    surface_finish: finish,
    confidence,
    tags: extra.tags || ''
  };
}

const VENEER_MOUNTS = ['millwork', 'wall', 'furniture'];
const FLOOR_MOUNTS = ['floor'];
const BOARD_MOUNTS = ['millwork', 'furniture', 'wall'];

const POLYHAVEN_ITEMS = [
  polyhaven('white_oak_veneer', '白橡木饰面', 'White Oak Veneer', 'white_oak', 'straight', 'fine', 'diagonal', 'plain', 'matte', VENEER_MOUNTS, 0.96, { series: 'Veneer / Oak' }),
  polyhaven('silver_oak_veneer_01', '银白橡木饰面', 'Silver Oak Veneer 01', 'white_oak', 'straight', 'fine', 'diagonal', 'plain', 'matte', VENEER_MOUNTS, 0.94, { series: 'Veneer / Oak' }),
  polyhaven('grey_oak_veneer_01', '灰橡木饰面', 'Grey Oak Veneer 01', 'white_oak', 'straight', 'fine', 'horizontal', 'plain', 'matte', VENEER_MOUNTS, 0.92, { series: 'Veneer / Oak' }),
  polyhaven('washed_grey_oak_veneer', '水洗灰橡木饰面', 'Washed Grey Oak Veneer', 'white_oak', 'straight', 'medium', 'horizontal', 'plain', 'matte', VENEER_MOUNTS, 0.92, { series: 'Veneer / Oak' }),
  polyhaven('oak_veneer_02', '天然橡木饰面', 'Oak Veneer 02', 'white_oak', 'cathedral', 'medium', 'vertical', 'plain', 'matte', VENEER_MOUNTS, 0.92, { series: 'Veneer / Oak' }),
  polyhaven('red_oak_veneer', '红橡木饰面', 'Red Oak Veneer', 'red_oak', 'straight', 'medium', 'horizontal', 'plain', 'matte', VENEER_MOUNTS, 0.95, { series: 'Veneer / Oak' }),
  polyhaven('ash_veneer', '白蜡木饰面', 'Ash Veneer', 'ash', 'straight', 'fine', 'horizontal', 'plain', 'matte', VENEER_MOUNTS, 0.95, { series: 'Veneer / Light Hardwood' }),
  polyhaven('cherry_veneer', '樱桃木饰面', 'Cherry Veneer', 'cherry', 'straight', 'fine', 'horizontal', 'plain', 'satin', VENEER_MOUNTS, 0.94, { series: 'Veneer / Light Hardwood' }),
  polyhaven('teak_veneer', '柚木饰面', 'Teak Veneer', 'teak', 'straight', 'medium', 'horizontal', 'plain', 'oiled', VENEER_MOUNTS, 0.95, { series: 'Veneer / Dark & Exotic' }),
  polyhaven('white_maple_veneer', '枫木饰面', 'White Maple Veneer', 'maple', 'straight', 'fine', 'horizontal', 'plain', 'matte', VENEER_MOUNTS, 0.94, { series: 'Veneer / Light Hardwood' }),
  polyhaven('american_walnut_veneer', '美国胡桃木饰面', 'American Walnut Veneer', 'walnut', 'straight', 'medium', 'diagonal', 'plain', 'satin', VENEER_MOUNTS, 0.96, { series: 'Veneer / Walnut' }),
  polyhaven('black_walnut_veneer_01', '黑胡桃木饰面', 'Black Walnut Veneer 01', 'walnut', 'straight', 'fine', 'horizontal', 'plain', 'matte', VENEER_MOUNTS, 0.94, { series: 'Veneer / Walnut' }),
  polyhaven('european_walnut_veneer_04', '欧洲胡桃木饰面', 'European Walnut Veneer 04', 'walnut', 'cathedral', 'medium', 'vertical', 'plain', 'satin', VENEER_MOUNTS, 0.94, { series: 'Veneer / Walnut' }),
  polyhaven('smoked_walnut_veneer', '烟熏胡桃木饰面', 'Smoked Walnut Veneer', 'walnut', 'straight', 'medium', 'diagonal', 'plain', 'matte', VENEER_MOUNTS, 0.92, { series: 'Veneer / Walnut' }),
  polyhaven('walnut_veneer', '胡桃木饰面', 'Walnut Veneer', 'walnut', 'straight', 'medium', 'diagonal', 'plain', 'satin', VENEER_MOUNTS, 0.94, { series: 'Veneer / Walnut' }),
  polyhaven('rosewood_veneer1', '玫瑰木饰面', 'Rosewood Veneer 1', 'rosewood', 'straight', 'medium', 'horizontal', 'plain', 'semi_gloss', VENEER_MOUNTS, 0.9, { series: 'Veneer / Dark & Exotic' }),
  polyhaven('sapele_veneer', '沙比利饰面', 'Sapele Veneer', 'sapele', 'ribbon', 'medium', 'diagonal', 'plain', 'satin', VENEER_MOUNTS, 0.93, { series: 'Veneer / Dark & Exotic' }),
  polyhaven('dark_wood', '深色桃花心木饰面', 'Dark Wood (Mahogany)', 'mahogany', 'straight', 'medium', 'horizontal', 'plain', 'satin', VENEER_MOUNTS, 0.82, { series: 'Veneer / Dark & Exotic' }),
  polyhaven('flamed_black_veneer', '火焰黑檀饰面', 'Flamed Black Veneer', 'ebony', 'ripple', 'medium', 'vertical', 'plain', 'semi_gloss', VENEER_MOUNTS, 0.82, { series: 'Veneer / Dark & Exotic' }),
  polyhaven('bamboo_veneer', '竹木饰面', 'Bamboo Veneer', 'bamboo', 'straight', 'fine', 'horizontal', 'plain', 'matte', VENEER_MOUNTS, 0.95, { series: 'Veneer / Bamboo' }),
  polyhaven('plywood', '多层板', 'Plywood', 'engineered', 'straight', 'coarse', 'horizontal', 'plain', 'matte', BOARD_MOUNTS, 0.86, { series: 'Engineered / Plywood' }),
  polyhaven('oriented_strand_board', 'OSB 定向刨花板', 'Oriented Strand Board', 'engineered', 'distressed', 'coarse', 'mixed', 'plain', 'textured', BOARD_MOUNTS, 0.9, { series: 'Engineered / OSB' }),
  polyhaven('herringbone_parquet', '人字拼橡木地板', 'Herringbone Parquet', 'white_oak', 'straight', 'medium', 'mixed', 'herringbone', 'semi_gloss', FLOOR_MOUNTS, 0.9, { series: 'Parquet' }),
  polyhaven('diagonal_parquet', '斜纹拼花地板', 'Diagonal Parquet', 'white_oak', 'straight', 'medium', 'diagonal', 'parquet', 'semi_gloss', FLOOR_MOUNTS, 0.88, { series: 'Parquet' }),
  polyhaven('rectangular_parquet', '矩形拼花地板', 'Rectangular Parquet', 'white_oak', 'straight', 'medium', 'mixed', 'parquet', 'semi_gloss', FLOOR_MOUNTS, 0.88, { series: 'Parquet' }),
  polyhaven('coated_pine', '漆面松木板', 'Coated Pine', 'pine', 'knot', 'coarse', 'horizontal', 'plain', 'semi_gloss', BOARD_MOUNTS, 0.9, { series: 'Boards & Planks' }),
  polyhaven('stained_pine', '染色松木板', 'Stained Pine', 'pine', 'knot', 'coarse', 'horizontal', 'plain', 'satin', BOARD_MOUNTS, 0.9, { series: 'Boards & Planks' }),
  polyhaven('hinoki_planks', '桧木拼板', 'Hinoki Planks', 'cedar', 'straight', 'fine', 'vertical', 'narrow_plank', 'matte', BOARD_MOUNTS, 0.84, { series: 'Boards & Planks' }),
  polyhaven('olive_veneer', '橄榄木饰面', 'Olive Veneer', 'olive', 'straight', 'medium', 'horizontal', 'plain', 'satin', VENEER_MOUNTS, 0.93, { series: 'Veneer / Light Hardwood' }),
  polyhaven('okoume_veneer', '奥古曼饰面', 'Okoume Veneer', 'okoume', 'straight', 'medium', 'horizontal', 'plain', 'matte', VENEER_MOUNTS, 0.93, { series: 'Veneer / Light Hardwood' })
];

function ambientcg(asset, nameZh, nameEn, species, grain, scale, direction, layout, finish, mounts, confidence, tags) {
  return {
    id: `wood_acg_${asset}`,
    kind_key: 'wood',
    name_zh: nameZh,
    name_en: nameEn,
    brand: 'ambientCG',
    brand_series: 'CC0 木纹',
    source: 'ambientcg',
    source_id: asset,
    source_url: `https://ambientcg.com/view?id=${asset}`,
    image_url: `https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-JPG-FFFFFF/${asset}.jpg`,
    download: { type: 'ambientcg', asset },
    external_id: `ambientcg:${asset}`,
    origin: 'generic',
    license: 'CC0',
    mounts,
    wood_species: species,
    wood_species_source: 'inferred',
    grain_type: grain,
    grain_scale: scale,
    grain_direction: direction,
    wood_layout: layout,
    surface_finish: finish,
    confidence,
    tags
  };
}

const AMBIENTCG_ITEMS = [
  ambientcg('Wood090A', '桦木直纹板', 'Birch Fine Grain', 'birch', 'straight', 'fine', 'horizontal', 'plain', 'matte', ['millwork', 'furniture'], 0.88, 'birch,clean,fine,countertop'),
  ambientcg('Wood049', '自然橡木板', 'Natural Oak Board', 'white_oak', 'straight', 'medium', 'horizontal', 'plain', 'matte', ['millwork', 'furniture'], 0.86, 'oak,horizontal,modern,natural'),
  ambientcg('Wood051', '深咖胡桃木板', 'Espresso Walnut Board', 'walnut', 'straight', 'medium', 'horizontal', 'plain', 'satin', ['millwork', 'furniture', 'floor'], 0.82, 'espresso,dark,hardwood,grain'),
  ambientcg('WoodFloor034', '人字拼木地板', 'Herringbone Wood Floor', 'white_oak', 'straight', 'medium', 'mixed', 'herringbone', 'semi_gloss', ['floor'], 0.9, 'herringbone,parquet,floor'),
  ambientcg('WoodFloor070', '自然拼花地板', 'Natural Parquet Floor', 'white_oak', 'straight', 'medium', 'mixed', 'parquet', 'matte', ['floor'], 0.88, 'beige,brown,hardwood,natural,parquet')
];

// 已有生产条目：保留原 ID，补全木纹属性与本地预览。
const LEGACY_ITEMS = [
  {
    id: 'generic_wood_smoked_oak',
    kind_key: 'wood',
    name_zh: '烟熏直纹橡木',
    name_en: 'Smoked Straight Oak',
    brand: 'ambientCG',
    brand_series: 'CC0 木纹',
    source: 'ambientcg',
    source_id: 'Wood066',
    source_url: 'https://ambientcg.com/view?id=Wood066',
    image_url: 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-JPG-FFFFFF/Wood066.jpg',
    download: { type: 'ambientcg', asset: 'Wood066' },
    external_id: 'generic_wood_smoked_oak',
    origin: 'generic',
    license: 'CC0',
    mounts: ['millwork', 'furniture', 'wall'],
    wood_species: 'white_oak',
    wood_species_source: 'inferred',
    grain_type: 'straight',
    grain_scale: 'medium',
    grain_direction: 'horizontal',
    wood_layout: 'plain',
    surface_finish: 'matte',
    confidence: 0.72,
    tags: 'smoked,oak,straight'
  }
];

const WOOD_CATALOG = [...TREEZO_ITEMS, ...POLYHAVEN_ITEMS, ...AMBIENTCG_ITEMS, ...LEGACY_ITEMS];

module.exports = {
  TREEZO_PAGE,
  TREEZO_ITEMS,
  POLYHAVEN_ITEMS,
  AMBIENTCG_ITEMS,
  LEGACY_ITEMS,
  WOOD_CATALOG
};
