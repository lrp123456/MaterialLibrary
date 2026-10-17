/**
 * 筛选维度词表（App / Web 共用）
 * 标签必须与 MaterialLibraryServer tags-seed / filterOptions 对齐，否则命中 0 条。
 */
export const MEDIA_TYPES = [
  { key: 'image', label: '图片素材', icon: '🖼️' },
  { key: 'video', label: '空间视频', icon: '🎬' },
  { key: 'furniture', label: '单品家具', icon: '🛋️' },
  { key: 'music', label: '场景音乐', icon: '🎵' },
  { key: 'portrait', label: '空间人像', icon: '👤' },
]

export const DEFAULT_SPACES = [
  '门外门廊', '门内门厅', '客厅', '餐厅', '厨房', '卧室', '卫浴', '书房',
  '阳台露台', '衣帽间', '庭院', '池塘', '泳池', '茶空间', '飘窗', '细节特写', '其他',
]
export const DEFAULT_STYLES = [
  '现代极简', '奶油风', '欧式轻奢', '侘寂', '原木日式', '北欧', '美式',
  '中古MCM', '新中式', '工业风', '南洋度假', '地中海', '其他混搭',
]
export const DEFAULT_FURNITURE = [
  '三人/组合沙发', '单人沙发', '休闲椅/扶手椅', '茶几', '餐桌', '餐椅',
  '电视柜', '餐边柜', '书架/展示柜', '书桌/工作台', '床/床架', '床头柜',
  '衣柜', '地毯', '吊灯', '落地灯', '台灯', '壁灯', '花器/花瓶', '摆件/雕塑', '浴缸',
]
export const DEFAULT_MATERIALS = [
  '橡木', '胡桃木', '柚木', '浅木', '大理石', '洞石', '水磨石', '岩板',
  '微水泥', '艺术漆', '灰泥', '乳胶漆', '瓷砖', '赤陶', '黄铜', '黑钢', '玻璃',
  '棉麻/亚麻', '丝绒', '羊羔绒', '真皮', '藤编',
]
export const DEFAULT_COLORS = ['白', '米/奶油', '原木/木色', '灰', '黑', '红', '粉', '橙', '黄', '绿', '蓝', '紫']
export const MOOD_LIST = [
  '治愈/温暖', '现代轻奢', '空灵/静谧', '明快/活力', '电影感/史诗', '爵士复古', '科技未来',
]
export const POSE_LIST = ['站姿', '坐姿', '行走', '倚靠', '交谈/互动']
export const CHARACTER_LIST = ['商务精英', '居家男女', '亲子家庭', '青年学生', '休闲独处']
/** 与服务端 origin_orientation / orientation 标签一致 */
export const ORIENTATION_LIST = [
  { key: '9:16', label: '9:16' },
  { key: '3:4', label: '3:4' },
  { key: '2:3', label: '2:3' },
  { key: 'landscape', label: '横图' },
  { key: 'square', label: '方图' },
  { key: '16:9', label: '16:9' },
  { key: '4:3', label: '4:3' },
  { key: '1:1', label: '1:1' },
]
export const VIDEO_SOURCE_LIST = [
  { key: 'sync', label: '手机实拍' },
  { key: 'ai', label: 'AI 创作' },
]
/** 服务端：默认 latest；正序 earliest；推荐 recommend。不要用 oldest */
export const SORT_LIST = [
  { key: 'latest', label: '最新优先' },
  { key: 'earliest', label: '最早优先' },
  { key: 'recommend', label: '推荐优先' },
]

/** 合并服务端 filterOptions facets，保证菜单与命中数一致 */
export function mergeFacetList(base, facetArr) {
  const labels = []
  if (Array.isArray(facetArr)) {
    for (const x of facetArr) {
      const v = typeof x === 'object' ? (x.label || x.dir) : x
      if (v) labels.push(v)
    }
  }
  if (!labels.length) return [...base]
  return Array.from(new Set([...labels, ...base]))
}

export function extractFacetLabels(arr) {
  if (!Array.isArray(arr) || !arr.length) return []
  return arr
    .map((x) => (typeof x === 'object' ? (x.label || x.dir) : x))
    .filter(Boolean)
}
