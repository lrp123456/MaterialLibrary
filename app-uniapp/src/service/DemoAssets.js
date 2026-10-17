/**
 * 演示素材（无服务器时可视化预览用）
 * 模拟 MaterialViewer 瀑布流：日期分组 + 双列卡片 + 标签
 */
const HUES = [
  ['#c7b8a5', '#8a7a68'], ['#a8b5a2', '#5f7359'],
  ['#b0c4c8', '#5f7f88'], ['#d4c4b0', '#9a7e62'],
  ['#9aa8b8', '#5a6a7a'], ['#c9b8c0', '#8a6a7a'],
  ['#a8d0b8', '#4a8a6a'], ['#e0c8a0', '#a08050'],
  ['#8898a8', '#4a5868'], ['#c8b090', '#8a6a40'],
  ['#b8c8a0', '#6a7a40'], ['#a0b8c8', '#4a6878'],
]

const SPACES = ['客厅', '卧室', '餐厅', '厨房', '书房', '卫浴', '阳台', '玄关']
const STYLES = ['现代简约', '北欧', '轻奢', '日式', '侘寂', '奶油风']
const MATS = ['大理石', '胡桃木', '微水泥', '亚麻', '金属', '藤编']

export function mockAssets() {
  const now = Date.now()
  const day = 86400000
  const list = []
  for (let i = 0; i < 24; i++) {
    const createdAt = now - i * 3 * 3600000
    const h = i % HUES.length
    list.push({
      fid: 'demo_' + i,
      fileName: 'IMG_' + String(1000 + i) + '.jpg',
      width: 1080,
      height: i % 3 === 0 ? 1440 : 1080,
      orientation: i % 3 === 0 ? '3:4' : '1:1',
      status: 'ready',
      isRestage: i % 4 === 0,
      dupCount: 1,
      createdAt,
      mainLabel: SPACES[i % SPACES.length],
      tags: [
        { dimension: 'space', label: SPACES[i % SPACES.length] },
        { dimension: 'style', label: STYLES[i % STYLES.length] },
        { dimension: 'material', label: MATS[i % MATS.length] },
      ],
      colors: [
        { hex: '#e8e0d4', role: 'main', name: '米白', weight: 0.55 },
        { hex: '#8a7050', role: 'secondary', name: '胡桃', weight: 0.3 },
        { hex: '#c45c26', role: 'accent', name: '赤陶', weight: 0.15 },
      ],
      demoGradient: `linear-gradient(145deg, ${HUES[h][0]}, ${HUES[h][1]})`,
      demoKind: i % 7 === 0 ? 'video' : 'image',
      tagsText: [
        SPACES[i % SPACES.length],
        STYLES[i % STYLES.length],
        MATS[i % MATS.length],
      ].join(' · '),
    })
  }
  return list
}

export function mockDetail(fid) {
  const base = mockAssets().find((a) => a.fid === fid) || mockAssets()[0]
  return {
    ...base,
    derivatives: [
      { id: 1, kind: 'origin', width: base.width, height: base.height, mime: 'image/jpeg' },
      { id: 2, kind: 'restage_9_16', width: 1080, height: 1920, mime: 'image/jpeg' },
      { id: 3, kind: 'restage_3_4', width: 1080, height: 1440, mime: 'image/jpeg' },
    ],
    dupMembers: [],
    similar: mockAssets()
      .filter((a) => a.fid !== fid)
      .slice(0, 6),
  }
}

export const DEMO_FILTER_OPTIONS = {
  spaces: ['客厅', '卧室', '餐厅', '厨房', '书房', '卫浴'],
  styles: ['现代简约', '北欧', '轻奢', '日式', '侘寂', '奶油风'],
  materials: ['大理石', '胡桃木', '微水泥', '亚麻', '金属', '藤编'],
  orientations: ['3:4', '1:1', '9:16'],
}
