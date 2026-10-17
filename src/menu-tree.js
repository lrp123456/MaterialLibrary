/**
 * 统一菜单树与工作台契约 (Server-Driven UI / Menu Tree & Studio Schema)
 * 供 Web 桌面端与 App 移动端统一消费，彻底实现“服务端提供内容与规则，客户端预留框架与插槽”。
 */
const { DOMINANT_COLORS } = require('./tags-seed');
const { MODEL_CATALOG } = require('./studio-catalog');

// 12色主色标准板
const COLOR_OPTIONS = [
  { value: '#FFFFFF', label: '纯白', hex: '#FFFFFF', isLight: true },
  { value: '#111827', label: '暗黑', hex: '#111827', isLight: false },
  { value: '#6B7280', label: '中灰', hex: '#6B7280', isLight: false },
  { value: '#EF4444', label: '烈红', hex: '#EF4444', isLight: false },
  { value: '#F97316', label: '亮橙', hex: '#F97316', isLight: false },
  { value: '#EAB308', label: '暖黄', hex: '#EAB308', isLight: true },
  { value: '#10B981', label: '翠绿', hex: '#10B981', isLight: false },
  { value: '#06B6D4', label: '青蓝', hex: '#06B6D4', isLight: false },
  { value: '#3B82F6', label: '科技蓝', hex: '#3B82F6', isLight: false },
  { value: '#8B5CF6', label: '典雅紫', hex: '#8B5CF6', isLight: false },
  { value: '#EC4899', label: '柔粉', hex: '#EC4899', isLight: false },
  { value: '#78350F', label: '胡桃棕', hex: '#78350F', isLight: false },
];

/**
 * 获取完整的三层素材库菜单与过滤体系
 * Level 1: 一级分类 (Parent Domain)
 * Level 2: 二级品类 (Subcategory Children)
 * Level 3: 关联过滤维度 (Facets) -> 区分 primary (快捷) 与 advanced (高级)
 */
function getMenuTree(db) {
  return [
    {
      key: 'all',
      label: '全部素材',
      icon: 'grid',
      children: [],
      facets: [
        {
          key: 'dominant_color',
          label: '主色',
          type: 'color_palette',
          multi: true,
          placement: 'primary',
          options: COLOR_OPTIONS,
        },
        {
          key: 'orientation',
          label: '画幅',
          type: 'radio_group',
          multi: false,
          placement: 'primary',
          options: [
            { value: '', label: '全部' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' },
            { value: '4:3', label: '4:3' },
            { value: '3:4', label: '3:4' },
          ],
        },
      ],
    },
    {
      key: 'interior',
      label: '室内空间',
      icon: 'sofa',
      children: [
        { key: 'living_room', label: '客厅' },
        { key: 'bedroom', label: '主卧' },
        { key: 'study', label: '书房' },
        { key: 'bathroom', label: '卫浴' },
        { key: 'kitchen', label: '厨房' },
        { key: 'dining_room', label: '餐厅' },
        { key: 'foyer', label: '门厅玄关' },
        { key: 'balcony', label: '阳台休闲' },
      ],
      facets: [
        {
          key: 'space',
          label: '空间类型',
          type: 'tag_group',
          multi: false,
          placement: 'primary',
          options: [
            { value: '客厅', label: '客厅' },
            { value: '主卧', label: '主卧' },
            { value: '书房', label: '书房' },
            { value: '卫浴', label: '卫浴' },
            { value: '厨房', label: '厨房' },
            { value: '餐厅', label: '餐厅' },
            { value: '门厅玄关', label: '玄关' },
          ],
        },
        {
          key: 'style_atom',
          label: '设计流派',
          type: 'tag_group',
          multi: true,
          placement: 'primary',
          options: [
            { value: '现代极简', label: '现代极简' },
            { value: '侘寂风', label: '侘寂风' },
            { value: '法式中古', label: '法式中古' },
            { value: '轻奢新中式', label: '轻奢中式' },
            { value: '工业美式', label: '工业风' },
          ],
        },
        {
          key: 'dominant_color',
          label: '空间主色',
          type: 'color_palette',
          multi: true,
          placement: 'primary',
          options: COLOR_OPTIONS,
        },
        {
          key: 'material_kind',
          label: '硬装/软装材质',
          type: 'tag_group',
          multi: true,
          placement: 'advanced',
          options: [
            { value: '微水泥', label: '微水泥' },
            { value: '大理石岩板', label: '岩板大理石' },
            { value: '胡桃原木', label: '胡桃原木' },
            { value: '亚麻棉麻', label: '亚麻布艺' },
            { value: '黄铜金属', label: '黄铜金属' },
          ],
        },
        {
          key: 'orientation',
          label: '画幅比例',
          type: 'radio_group',
          multi: false,
          placement: 'advanced',
          options: [
            { value: '', label: '全部' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' },
          ],
        },
      ],
    },
    {
      key: 'architecture',
      label: '建筑形态',
      icon: 'building',
      children: [
        { key: 'villa', label: '独栋别墅' },
        { key: 'commercial', label: '商业公建' },
        { key: 'cultural', label: '文化场馆' },
        { key: 'facade', label: '建筑立面' },
      ],
      facets: [
        {
          key: 'style_atom',
          label: '建筑风格',
          type: 'tag_group',
          multi: true,
          placement: 'primary',
          options: [
            { value: '清水混凝土', label: '清水混凝土' },
            { value: '现代主义悬挑', label: '几何悬挑' },
            { value: '参数化立面', label: '参数化' },
          ],
        },
        {
          key: 'dominant_color',
          label: '立面主色',
          type: 'color_palette',
          multi: true,
          placement: 'primary',
          options: COLOR_OPTIONS,
        },
        {
          key: 'orientation',
          label: '画幅',
          type: 'radio_group',
          multi: false,
          placement: 'advanced',
          options: [
            { value: '', label: '全部' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
          ],
        },
      ],
    },
    {
      key: 'furniture',
      label: '家具单品',
      icon: 'sofa',
      children: [
        { key: 'sofa', label: '沙发椅凳' },
        { key: 'table', label: '桌几茶几' },
        { key: 'cabinet', label: '储物柜架' },
        { key: 'bed', label: '床榻床头' },
        { key: 'lighting', label: '灯具照明' },
      ],
      facets: [
        {
          key: 'furniture_category',
          label: '家具品类',
          type: 'tag_group',
          multi: false,
          placement: 'primary',
          options: [
            { value: '沙发椅凳', label: '沙发椅凳' },
            { value: '桌几茶几', label: '桌几茶几' },
            { value: '储物柜架', label: '储物柜架' },
            { value: '灯具照明', label: '灯具照明' },
          ],
        },
        {
          key: 'dominant_color',
          label: '单品主色',
          type: 'color_palette',
          multi: true,
          placement: 'primary',
          options: COLOR_OPTIONS,
        },
        {
          key: 'material_kind',
          label: '材质',
          type: 'tag_group',
          multi: true,
          placement: 'advanced',
          options: [
            { value: '真皮头层皮', label: '皮质' },
            { value: '实木木纹', label: '实木' },
            { value: '岩板石材', label: '岩板' },
            { value: '不锈钢金属', label: '金属' },
          ],
        },
      ],
    },
    {
      key: 'clothing',
      label: '服装服饰',
      icon: 'shirt',
      children: [
        { key: 'tops', label: '上衣外套' },
        { key: 'bottoms', label: '裤装裙装' },
        { key: 'suit', label: '西服套装' },
        { key: 'shoes', label: '鞋履配饰' },
      ],
      facets: [
        {
          key: 'season',
          label: '季节',
          type: 'tag_group',
          multi: false,
          placement: 'primary',
          options: [
            { value: '春季', label: '春季' },
            { value: '夏季', label: '夏季' },
            { value: '秋季', label: '秋季' },
            { value: '冬季', label: '冬季' },
          ],
        },
        {
          key: 'clothing_style',
          label: '穿搭风格',
          type: 'tag_group',
          multi: true,
          placement: 'primary',
          options: [
            { value: '极简通勤', label: '极简通勤' },
            { value: '轻奢优雅', label: '轻奢优雅' },
            { value: '街头潮流', label: '街头潮流' },
          ],
        },
        {
          key: 'dominant_color',
          label: '主色',
          type: 'color_palette',
          multi: true,
          placement: 'primary',
          options: COLOR_OPTIONS,
        },
      ],
    },
    {
      key: 'portrait',
      label: '虚拟人像',
      icon: 'user',
      children: [
        { key: 'female', label: '女性人像' },
        { key: 'male', label: '男性人像' },
        { key: 'model', label: '超模展示' },
      ],
      facets: [
        {
          key: 'gender',
          label: '性别',
          type: 'tag_group',
          multi: false,
          placement: 'primary',
          options: [
            { value: '女性', label: '女性' },
            { value: '男性', label: '男性' },
          ],
        },
        {
          key: 'shot_type',
          label: '景别',
          type: 'tag_group',
          multi: false,
          placement: 'primary',
          options: [
            { value: '全身照', label: '全身' },
            { value: '半身特写', label: '半身' },
            { value: '面部微距', label: '面部特写' },
          ],
        },
      ],
    },
    {
      key: 'finished',
      label: '影视成品',
      icon: 'video',
      children: [
        { key: 'walkthrough', label: '空间漫游' },
        { key: 'ad', label: '商业短片' },
      ],
      facets: [
        {
          key: 'orientation',
          label: '视频画幅',
          type: 'radio_group',
          multi: false,
          placement: 'primary',
          options: [
            { value: '16:9', label: '16:9 横屏' },
            { value: '9:16', label: '9:16 竖屏' },
          ],
        },
      ],
    },
    {
      key: 'audio',
      label: '音乐音效',
      icon: 'music',
      children: [
        { key: 'bgm', label: '氛围背景乐' },
        { key: 'sfx', label: '环境音效' },
      ],
      facets: [
        {
          key: 'mood',
          label: '情绪调性',
          type: 'tag_group',
          multi: false,
          placement: 'primary',
          options: [
            { value: '舒缓放松', label: '舒缓' },
            { value: '高端奢华', label: '轻奢' },
            { value: '科技未来', label: '科技' },
          ],
        },
      ],
    },
    {
      key: 'trash',
      label: '回收站',
      icon: 'trash',
      children: [],
      facets: [],
    },
  ];
}

/**
 * 获取创作工坊驱动元数据 (Studio Schema)
 * 模型列表、输入框快捷/高级项配置、固定高优按钮与本地缓存策略
 */
function getStudioSchema() {
  return {
    version: '2026.10.11',
    // 1. 模型列表 (支持 Web 与 App 下拉切换)
    models: [
      {
        id: 'doubao-seed-2-0',
        name: 'Seedream 5.0 Flash',
        desc: '火山方舟毫秒级超快响应，支持原生交互编辑与精准重绘',
        provider: 'volcengine',
        isDefault: true,
        type: 'image',
        caps: ['coords_bbox', 'inpaint', 'relight', 'super_resolution'],
      },
      {
        id: 'doubao-seed-2-0-pro',
        name: 'Seedream 5.0 Pro',
        desc: '4K超高画质电影级渲染，精细光影与微距材质呈现',
        provider: 'volcengine',
        isDefault: false,
        type: 'image',
        caps: ['coords_bbox', 'inpaint', 'texture', 'swap', 'expand'],
      },
      {
        id: 'doubao-seedance-2-0-lite',
        name: 'Seedance 2.0 空间视频',
        desc: '首创空间拓扑一致性视频生成引擎，支持多机位漫游',
        provider: 'volcengine',
        isDefault: false,
        type: 'video',
        caps: ['camera_walkthrough', 'motion_control'],
      },
    ],

    // 2. 输入控制项 (服务端动态控制快捷项与高级抽屉项)
    inputControls: {
      quick: [
        {
          key: 'aspect_ratio',
          label: '画面比例',
          widget: 'select',
          defaultValue: '16:9',
          options: [
            { value: '16:9', label: '16:9 大屏壁纸' },
            { value: '9:16', label: '9:16 手机竖屏' },
            { value: '1:1', label: '1:1 正方形' },
            { value: '4:3', label: '4:3 经典空间' },
            { value: '21:9', label: '21:9 宽画幅电影' },
          ],
        },
        {
          key: 'quality',
          label: '画质等级',
          widget: 'select',
          defaultValue: 'hd',
          options: [
            { value: 'standard', label: '标准 2K' },
            { value: 'hd', label: '超清 4K (极致细节)' },
          ],
        },
      ],
      advanced: [
        {
          key: 'negative_prompt',
          label: '负向提示词 (排除项)',
          widget: 'textarea',
          defaultValue: '杂乱, 模糊, 偏色, 畸变, 噪点',
          placeholder: '输入希望在画面中避免出现的元素...',
        },
        {
          key: 'seed',
          label: '随机种子 (Seed)',
          widget: 'number',
          defaultValue: -1,
          placeholder: '-1 表示每次随机',
        },
        {
          key: 'steps',
          label: '采样步数 (Steps)',
          widget: 'slider',
          min: 15,
          max: 50,
          defaultValue: 30,
        },
        {
          key: 'cfg_scale',
          label: '文本引导度 (CFG)',
          widget: 'slider',
          min: 1.0,
          max: 15.0,
          step: 0.5,
          defaultValue: 7.5,
        },
      ],
    },

    // 3. 固定保留的客户端高优能力 (客户端在固定醒目位置渲染)
    fixedActions: {
      optimizePrompt: {
        id: 'optimize_prompt',
        label: '✨ 优化提示词',
        endpoint: '/api/chat/optimize-prompt',
        style: 'accent_pill',
        tooltip: '调用服务端专属 Skill 将简短提示词扩写为电影级画面描述',
      },
    },

    // 4. 客户端缓存与同步策略
    cachePolicy: {
      storageKey: 'studio_schema_cache',
      ttlSeconds: 86400,
      staleWhileRevalidate: true,
    },
  };
}

module.exports = {
  getMenuTree,
  getStudioSchema,
};
