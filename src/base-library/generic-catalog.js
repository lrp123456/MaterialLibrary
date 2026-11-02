/**
 * 方案槽位通用材质（CC0，ambientCG）
 * 用于保证墙面/台面/金属/沙发/窗帘/地毯等槽位都有可访问预览。
 */

const GENERIC_MATERIALS = [
  {
    id: 'generic_marble_white', asset: 'Marble021', kind_key: 'stone', name_zh: '雪花白大理石',
    prompt_name: '雪花白大理石，细纹，亮光', mounts: ['wall', 'floor', 'counter', 'millwork'],
    gloss: 'gloss', pattern: 'stone', tone: 'light'
  },
  {
    id: 'generic_marble_black', asset: 'Marble006', kind_key: 'stone', name_zh: '黑白根大理石',
    prompt_name: '黑白根大理石，深色，亮光', mounts: ['wall', 'floor', 'counter'],
    gloss: 'gloss', pattern: 'stone', tone: 'dark'
  },
  {
    id: 'generic_travertine_beige', asset: 'Travertine009', kind_key: 'stone', name_zh: '米白洞石',
    prompt_name: '米白洞石，横向纹理，哑光', mounts: ['wall', 'floor', 'counter'],
    gloss: 'matte', pattern: 'stone', tone: 'light'
  },
  {
    id: 'generic_terrazzo_light', asset: 'Terrazzo019L', kind_key: 'tile', name_zh: '米白水磨石',
    prompt_name: '米白水磨石，细颗粒，哑光', mounts: ['floor', 'wall'],
    gloss: 'matte', pattern: 'stone', tone: 'light'
  },
  {
    id: 'generic_terrazzo_warm', asset: 'Terrazzo008', kind_key: 'tile', name_zh: '暖灰水磨石',
    prompt_name: '暖灰水磨石，中颗粒，哑光', mounts: ['floor', 'wall'],
    gloss: 'matte', pattern: 'stone', tone: 'medium'
  },
  {
    id: 'generic_metal_champagne', asset: 'Metal048A', kind_key: 'metal_finish', name_zh: '香槟金',
    prompt_name: '香槟金金属饰面', mounts: ['metal'],
    gloss: 'satin', pattern: 'solid', tone: 'light'
  },
  {
    id: 'generic_metal_graphite', asset: 'Metal032', kind_key: 'metal_finish', name_zh: '拉丝银灰',
    prompt_name: '拉丝银灰金属饰面', mounts: ['metal'],
    gloss: 'satin', pattern: 'solid', tone: 'medium'
  },
  {
    id: 'generic_metal_brass', asset: 'Metal034', kind_key: 'metal_finish', name_zh: '黄铜',
    prompt_name: '黄铜金属饰面', mounts: ['metal'],
    gloss: 'satin', pattern: 'solid', tone: 'medium'
  },
  {
    id: 'generic_metal_black', asset: 'Metal046A', kind_key: 'metal_finish', name_zh: '哑光黑钢',
    prompt_name: '哑光黑钢金属饰面', mounts: ['metal'],
    gloss: 'matte', pattern: 'solid', tone: 'dark'
  },
  {
    id: 'generic_fabric_linen_natural', asset: 'Fabric019', kind_key: 'fabric', name_zh: '本白亚麻',
    prompt_name: '本白亚麻织物，细纹，哑光', mounts: ['soft'],
    gloss: 'matte', pattern: 'fabric', tone: 'light'
  },
  {
    id: 'generic_fabric_boucle_cream', asset: 'Fabric036', kind_key: 'fabric', name_zh: '奶油羊羔绒',
    prompt_name: '奶油色羊羔绒织物，颗粒肌理，哑光', mounts: ['soft'],
    gloss: 'matte', pattern: 'fabric', tone: 'light'
  },
  {
    id: 'generic_fabric_velvet_olive', asset: 'Fabric018', kind_key: 'fabric', name_zh: '橄榄绿织物',
    prompt_name: '橄榄绿织物，柔光', mounts: ['soft'],
    gloss: 'satin', pattern: 'fabric', tone: 'medium'
  },
  {
    id: 'generic_fabric_sheer_white', asset: 'Fabric082A', kind_key: 'fabric', name_zh: '白色纱帘',
    prompt_name: '白色半透纱帘织物', mounts: ['soft'],
    gloss: 'matte', pattern: 'fabric', tone: 'light'
  },
  {
    id: 'generic_leather_cognac', asset: 'Leather038', kind_key: 'leather', name_zh: '焦糖真皮',
    prompt_name: '焦糖色真皮，细腻纹理，柔光', mounts: ['soft', 'furniture'],
    gloss: 'satin', pattern: 'solid', tone: 'medium'
  },
  {
    id: 'generic_leather_black', asset: 'Leather026', kind_key: 'leather', name_zh: '黑色真皮',
    prompt_name: '黑色真皮，细腻纹理，柔光', mounts: ['soft', 'furniture'],
    gloss: 'satin', pattern: 'solid', tone: 'dark'
  },
  {
    id: 'generic_leather_cream', asset: 'Leather035D', kind_key: 'leather', name_zh: '米白真皮',
    prompt_name: '米白真皮，细腻纹理，柔光', mounts: ['soft', 'furniture'],
    gloss: 'satin', pattern: 'solid', tone: 'light'
  },
  {
    id: 'generic_carpet_wool_gray', asset: 'Carpet001', kind_key: 'carpet', name_zh: '浅灰羊毛地毯',
    prompt_name: '浅灰羊毛短绒地毯', mounts: ['soft'],
    gloss: 'matte', pattern: 'fabric', tone: 'medium'
  },
  {
    id: 'generic_carpet_jute', asset: 'Carpet016', kind_key: 'carpet', name_zh: '米白羊毛地毯',
    prompt_name: '米白羊毛编织地毯，哑光', mounts: ['soft'],
    gloss: 'matte', pattern: 'fabric', tone: 'light'
  },
  {
    id: 'generic_concrete_micro', asset: 'Concrete034', kind_key: 'microcement', name_zh: '浅灰微水泥',
    prompt_name: '浅灰微水泥，细腻肌理，哑光', mounts: ['wall', 'ceiling', 'floor'],
    gloss: 'matte', pattern: 'solid', tone: 'light'
  },
  {
    id: 'generic_concrete_warm', asset: 'Concrete030', kind_key: 'microcement', name_zh: '暖灰微水泥',
    prompt_name: '暖灰微水泥，细腻肌理，哑光', mounts: ['wall', 'ceiling', 'floor'],
    gloss: 'matte', pattern: 'solid', tone: 'medium'
  }
];

module.exports = { GENERIC_MATERIALS };
