/* 素材工作台 · 中文演示数据（全部本地，无外部请求） */

export const NAV = [
  { key:'assets', label:'资产', desc:'浏览、筛选与管理素材' },
  { key:'studio', label:'创作', desc:'智能生成与精准编辑' },
  { key:'clip', label:'剪辑', desc:'多轨剪辑与媒体工具' },
  { key:'settings', label:'设置', desc:'偏好、连接与品牌' },
];

export const LANES = [
  { key:'image', label:'图片', count:88 },
  { key:'video', label:'视频', count:26 },
  { key:'audio', label:'音频', count:14 },
  { key:'base', label:'基础素材', count:3713 },
  { key:'project', label:'剪辑工程', count:9 },
  { key:'trash', label:'回收站', count:3 },
];

export const ASSETS = [
  ['客厅软装实景', '图片', '11月04日', '精修', '#C9BFA8'],
  ['胡桃木饰面样板', '图片', '11月04日', '精标', '#8B6A45'],
  ['主卧清晨光线', '图片', '11月03日', '成品', '#D8C9AE'],
  ['水磨石地面细节', '图片', '11月03日', '原素材', '#BFB9AE'],
  ['样板间漫游短片', '视频', '11月02日', '成品', '#7C8A82'],
  ['材质特写运镜', '视频', '11月02日', '原素材', '#6E7A76'],
  ['空间环境音', '音频', '11月01日', '原素材', '#9A8F7C'],
  ['乳胶漆色卡', '基础素材', '10月31日', '精标', '#E0D4B8'],
  ['瓷砖铺贴实景', '基础素材', '10月31日', '精标', '#B9A98E'],
  ['灯具选型图', '基础素材', '10月30日', '原素材', '#A99C86'],
  ['秋季方案成片', '视频', '10月29日', '成品', '#8A7E6C'],
  ['布艺样本扫描', '图片', '10月28日', '精修', '#C4B39A'],
].map(([name,type,date,tag,color],i) => ({ id:i+1,name,type,date,tag,color }));

export const CHATS = [
  { group:'今天', items:['现代客厅软装方案','胡桃木色系搭配','主卧采光优化'] },
  { group:'昨天', items:['水磨石地面铺贴','秋季样板间成片','材质色卡整理'] },
];

export const MESSAGES = [
  { role:'me', text:'把这张客厅照片换成暖胡桃木饰面，保留原有采光和软装布局。' },
  { role:'ai', text:'已按「保留采光 / 保留布局」两项约束完成替换，墙面与柜体统一到暖胡桃木色系，并生成了 3 个衍生版本。' },
  { role:'asset', text:'衍生版本 · 共 3 张', count:3 },
];

export const MODES = [
  { key:'chat', label:'对话' }, { key:'image', label:'图片' },
  { key:'video', label:'视频' }, { key:'music', label:'音乐' },
];

export const CLIP_TOOLS = [
  { name:'视频寻帧', desc:'逐帧查看、关键帧抽取、静帧批量导出', points:['逐帧步进','智能抽帧','打包下载'] },
  { name:'格式转换', desc:'目标格式、分辨率、音频分离与深度人声提炼', points:['格式选择','音频分离','内嵌预览'] },
  { name:'智能压缩', desc:'按用途选预设，实时预估体积与清晰度', points:['三种预设','体积预估','结果对比'] },
];

export const TIMELINE = [
  { name:'视频轨一', color:'#1C4A87', clips:['开场','客厅','材质','收尾'] },
  { name:'视频轨二', color:'#1C4A87', clips:['空镜','特写'] },
  { name:'音频轨', color:'#F4B301', clips:['环境音','背景乐'] },
];

export const SETTINGS_GROUPS = [
  { key:'daily', label:'日常', desc:'创作默认值与显示偏好' },
  { key:'security', label:'连接与安全', desc:'服务状态、证书与设备信任' },
  { key:'model', label:'模型与密钥', desc:'推理服务、接口地址与调用配额' },
  { key:'storage', label:'存储', desc:'素材路径与挂载状态' },
  { key:'brand', label:'品牌标识', desc:'标识方案、设计依据与使用规范' },
  { key:'admin', label:'管理', desc:'账户、白名单与灰度发布' },
];

export const SETTING_FIELDS = {
  daily: [
    ['默认生成模式','图片生成','下拉'], ['思考强度','高','下拉'],
    ['每次生成数量','4 张','数值'], ['衍生图默认挂载','开启','开关'],
    ['适老化大字','开启（推荐）','开关'], ['减少动态效果','跟随系统','下拉'],
  ],
  security: [
    ['服务端连接','正常','状态'], ['安全证书','已安装','状态'],
    ['设备信任','4 台设备','状态'], ['连接失败自动回退','开启','开关'],
  ],
  model: [
    ['主模型','通用创作模型','下拉'], ['备用模型','轻量创作模型','下拉'],
    ['接口地址','本机服务','文本'], ['单日调用上限','2000 次','数值'],
  ],
  storage: [
    ['素材根目录','本机素材库','文本'], ['已用空间','186 GB','状态'],
    ['可用空间','742 GB','状态'], ['自动清理缓存','开启','开关'],
  ],
  admin: [
    ['管理员账户','管理员','文本'], ['设备白名单','已启用','开关'],
    ['灰度发布','正式通道','下拉'], ['操作日志','保留 90 天','下拉'],
  ],
};

/* ---------- 标识方案：纯本地 SVG，currentColor 跟随主题墨色 ---------- */
export const LOGO_PLANS = [
  {
    key:'four', name:'四分格', recommended:true,
    svg:`<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="1" y="1" width="28" height="28" fill="var(--logo-accent,#FF4D00)"/><rect x="35" y="1" width="28" height="28" fill="none" stroke="currentColor" stroke-width="4"/><rect x="1" y="35" width="28" height="28" fill="none" stroke="currentColor" stroke-width="4"/><rect x="35" y="35" width="28" height="28" fill="currentColor"/></svg>`,
    idea:'四个等分方格直接对应资产 / 创作 / 剪辑 / 设置四个板块，也对应工作台零间隙分舱的骨架。',
    why:'只有「方格」一个核心元素；橙色只占四分之一；对角实心与空心形成张力；缩到 24 像素仍清晰。',
    use:'推荐用于顶栏、站点图标、文档页眉。把橙色改成墨色即可用于单色印刷与传真。',
  },
  {
    key:'stack', name:'层叠材',
    svg:`<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="2" y="8" width="60" height="12" fill="currentColor"/><rect x="2" y="26" width="44" height="12" fill="currentColor"/><rect x="2" y="44" width="28" height="12" fill="var(--logo-accent,#FF4D00)"/></svg>`,
    idea:'三条递缩短条像材料样本、胶片帧与时间轴轨道，指向素材堆叠与剪辑。',
    why:'刻意的左对齐与长度递减制造不对称张力；留白超过一半；无需任何文字即可读出「层」。',
    use:'适合剪辑台启动页、导出水印、横向排版。窄高空间里表现不如四分格。',
  },
  {
    key:'orbit', name:'圆盘与方',
    svg:`<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="26" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="4"/><rect x="34" y="10" width="28" height="44" fill="currentColor"/><circle cx="48" cy="20" r="6" fill="var(--logo-accent,#FF4D00)"/></svg>`,
    idea:'圆盘是构成主义唯一允许的圆形图元，方形象征存储，橙点是骑在轮缘的生成状态。',
    why:'圆与方的对撞是本风格最典型的语法；橙点提供单一焦点。',
    use:'适合品牌宣传、空状态插画。缩到 16 像素时圆盘描边偏细，不建议做站点图标。',
  },
];

export const LOGO_METHOD = [
  ['信息收集','先定行业、核心概念、调性与主要使用场景，避免生成通用行业符号','已采用'],
  ['多方案生成','一次给出 3 个不同范式，每个附设计理念与适用场景','已采用'],
  ['交互式展示','在真实界面里切换标识，看它在顶栏、小尺寸、单色下的表现','已采用（本页可点）'],
  ['设计原则','极致简洁、留白四成以上、线宽 2.5–4 像素、有意不对称、单一焦点','已采用'],
  ['矢量交付','只交可编辑 SVG，不交位图；颜色用变量，跟随三态主题','已采用'],
  ['高端展示图','用 Gemini 生成 12 种背景样机','未采用：需要外部接口与密钥，且是位图，违反本地矢量约束'],
];

export const LOGO_REFS = [
  ['标识生成技能（op7418）','6 个以上几何变体 + 交互展示 + 设计理由 + 矢量交付；展示图依赖 Gemini 接口','借流程与六条设计原则'],
  ['标识设计技能（neonwatty）','纯原生能力、无需接口密钥，访谈 → 探索 → 精修 → 导出，全程纯 SVG','借零依赖纯 SVG 路线'],
  ['原生矢量模型（Recraft 等）','可直接产出可编辑路径的 SVG','未采用：需外部服务与商用授权确认'],
  ['位图生成 + 矢量化','创意发散强，但要额外转路径并清理杂点','未采用：界面标识需要精确几何与主题换色'],
  ['结构化提示词框架 / 设计技能聚合','提供品牌套件工作流与设计范式索引','借分类思路，不引入依赖'],
];
