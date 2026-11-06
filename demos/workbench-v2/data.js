/* 素材工作台 · 改版数据（全中文、全部本地） */

export const NAV = [
  { key:'assets', label:'资产' }, { key:'studio', label:'创作' },
  { key:'clip', label:'剪辑' }, { key:'settings', label:'设置' },
];

/* 三级菜单：一级板块 → 二级泳道 → 三级归类 */
export const LANES_BY_VIEW = {
  assets: [
    { key:'image', label:'图片', count:88 }, { key:'video', label:'视频', count:26 },
    { key:'audio', label:'音频', count:14 }, { key:'base', label:'基础素材', count:3713 },
    { key:'project', label:'剪辑工程', count:9 }, { key:'trash', label:'回收站', count:3 },
  ],
  studio: [
    { key:'chat', label:'对话' }, { key:'library', label:'创作库' }, { key:'recipe', label:'配方' },
  ],
  clip: [
    { key:'timeline', label:'多轨剪辑' }, { key:'tools', label:'媒体工具' }, { key:'projects', label:'工程列表' },
  ],
  settings: [
    { key:'daily', label:'日常' }, { key:'security', label:'连接与安全' },
    { key:'model', label:'模型与密钥' }, { key:'storage', label:'存储' },
    { key:'brand', label:'品牌标识' }, { key:'admin', label:'管理' },
  ],
};

export const CATEGORIES = [
  { key:'interior_exterior', label:'室内外设计' }, { key:'portrait', label:'空间人像' },
  { key:'clothing', label:'服装服饰' }, { key:'furniture', label:'单品家具' },
];

/* 第二栏：左「归类」互斥分段 + 右「收窄」叠加开关 */
export const BARS = {
  assets: {
    classify: CATEGORIES,
    narrow: [
      { key:'space', label:'空间', type:'select' },
      { key:'retouched', label:'只看精修', type:'toggle' },
      { key:'finished', label:'只看成品', type:'toggle' },
      { key:'favorite', label:'只看收藏', type:'toggle' },
      { key:'layout', label:'视图切换', type:'action' },
      { key:'multi', label:'多选', type:'toggle' },
      { key:'filters', label:'筛选条件', type:'drawer', badge:3 },
    ],
  },
  studio: {
    classify: [{key:'chat',label:'对话'},{key:'image',label:'图片'},{key:'video',label:'视频'},{key:'music',label:'音乐'}],
    narrow: [
      { key:'ref', label:'引用素材', type:'action' }, { key:'attach', label:'挂载素材', type:'action' },
      { key:'skill', label:'技能挂载', type:'action' }, { key:'params', label:'生成参数', type:'drawer', badge:2 },
    ],
  },
  clip: {
    classify: [{key:'timeline',label:'多轨剪辑'},{key:'tools',label:'媒体工具'}],
    narrow: [
      { key:'hardware', label:'硬件解码', type:'toggle' },
      { key:'snap', label:'对齐吸附', type:'toggle' },
      { key:'export', label:'导出成片', type:'action' },
      { key:'advanced', label:'更多工具', type:'drawer', badge:0 },
    ],
  },
  settings: {
    classify: [], // 设置没有三级归类，二级泳道已在导航行，第二栏只留收窄组
    narrow: [
      { key:'reset', label:'恢复默认', type:'action' },
      { key:'log', label:'操作日志', type:'action' },
      { key:'help', label:'使用说明', type:'drawer', badge:0 },
    ],
  },
};

/* 第一栏按板块切换：搜索提示、主按钮、结果／状态信息 */
export const FIRST_BAR = {
  assets:   { placeholder:'搜索资产、会话、配方……', action:'上传素材', count:'共匹配 12 件素材', toast:'已打开本地文件上传' },
  studio:   { placeholder:'搜索会话、配方、生成记录……', action:'新建对话', count:'当前会话 · 通用创作模型', toast:'已新建对话' },
  clip:     { placeholder:'搜索工程、片段……', action:'导出成片', count:'当前工程 · 秋季方案成片', toast:'已开始导出成片' },
  settings: { placeholder:'搜索设置项……', action:'保存设置', count:'本机工作台 · 设置', toast:'设置已保存并立即生效' },
};

export const ASSETS = [
  ['客厅软装实景','图片','11月04日','精修','interior_exterior','#C9BFA8','室内 / 客厅'],
  ['主卧清晨光线','图片','11月03日','成品','interior_exterior','#D8C9AE','室内 / 主卧'],
  ['水磨石地面细节','图片','11月03日','原素材','interior_exterior','#BFB9AE','室内 / 地面'],
  ['样板间漫游短片','视频','11月02日','成品','interior_exterior','#7C8A82','室内 / 样板间'],
  ['乳胶漆色卡','基础素材','10月31日','精标','interior_exterior','#E0D4B8','室内 / 墙面'],
  ['瓷砖铺贴实景','基础素材','10月31日','精标','interior_exterior','#B9A98E','室内 / 地面'],
  ['人像采光样片','图片','11月02日','精修','portrait','#A98F7E','室内 / 人像'],
  ['空间人物特写','视频','11月01日','原素材','portrait','#8E7A6C','室内 / 人像'],
  ['布艺样本扫描','图片','10月28日','精修','clothing','#C4B39A','软装 / 面料'],
  ['服装陈列细节','图片','10月27日','原素材','clothing','#B0A48C','软装 / 服饰'],
  ['胡桃木饰面样板','图片','11月04日','精标','furniture','#8B6A45','家具 / 木饰面'],
  ['灯具选型图','基础素材','10月30日','原素材','furniture','#A99C86','家具 / 灯具'],
].map(([name,type,date,tag,category,color,space],i) => ({ id:i+1,name,type,date,tag,category,color,space }));

export const CHATS = [
  { group:'今天', items:['现代客厅软装方案','胡桃木色系搭配','主卧采光优化'] },
  { group:'昨天', items:['水磨石地面铺贴','秋季样板间成片','材质色卡整理'] },
];

export const MESSAGES = [
  { role:'me', text:'把这张客厅照片换成暖胡桃木饰面，保留原有采光和软装布局。' },
  { role:'ai', text:'已按「保留采光 / 保留布局」完成替换，生成 3 个衍生版本。' },
];

export const TIMELINE = [
  { name:'视频轨一', color:'#1C4A87', clips:['开场','客厅','材质','收尾'] },
  { name:'视频轨二', color:'#1C4A87', clips:['空镜','特写'] },
  { name:'音频轨', color:'#F4B301', clips:['环境音','背景乐'] },
];

export const CLIP_TOOLS = [
  { name:'视频寻帧', desc:'逐帧查看、关键帧抽取、静帧批量导出', points:['逐帧步进','智能抽帧','打包下载'] },
  { name:'格式转换', desc:'目标格式、分辨率、音频分离与深度人声提炼', points:['格式选择','音频分离','内嵌预览'] },
  { name:'智能压缩', desc:'按用途选预设，实时预估体积与清晰度', points:['三种预设','体积预估','结果对比'] },
];

export const SETTING_FIELDS = {
  daily: [['默认生成模式','图片生成'],['思考强度','高'],['每次生成数量','4 张'],['衍生图默认挂载','开启'],['适老化大字','开启'],['减少动态效果','跟随系统']],
  security: [['服务端连接','正常'],['安全证书','已安装'],['设备信任','4 台设备'],['失败自动回退','开启']],
  model: [['主模型','通用创作模型'],['备用模型','轻量创作模型'],['接口地址','本机服务'],['单日调用上限','2000 次']],
  storage: [['素材根目录','本机素材库'],['已用空间','186 GB'],['可用空间','742 GB'],['自动清理缓存','开启']],
  admin: [['管理员账户','管理员'],['设备白名单','已启用'],['灰度发布','正式通道'],['操作日志','保留 90 天']],
  brand: [['标识方案','四分格'],['主信号色','信号橙'],['单色适配','支持'],['最小尺寸','24 像素']],
};

/* 标识方案：纯本地 SVG，currentColor 跟随主题 */
export const LOGO_PLANS = [
  { key:'four', name:'四分格', recommended:true,
    svg:`<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="1" y="1" width="28" height="28" fill="var(--logo-accent,#FF4D00)"/><rect x="35" y="1" width="28" height="28" fill="none" stroke="currentColor" stroke-width="4"/><rect x="1" y="35" width="28" height="28" fill="none" stroke="currentColor" stroke-width="4"/><rect x="35" y="35" width="28" height="28" fill="currentColor"/></svg>`,
    idea:'四个等分方格对应四个板块，也对应零间隙分舱', why:'只有一个核心元素，橙色仅占四分之一，缩到 24 像素仍清晰', use:'顶栏、站点图标、文档页眉' },
  { key:'stack', name:'层叠材',
    svg:`<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="2" y="8" width="60" height="12" fill="currentColor"/><rect x="2" y="26" width="44" height="12" fill="currentColor"/><rect x="2" y="44" width="28" height="12" fill="var(--logo-accent,#FF4D00)"/></svg>`,
    idea:'三条递缩短条像材料样本与时间轴', why:'左对齐与长度递减制造张力，留白过半', use:'剪辑启动页、导出水印' },
  { key:'orbit', name:'圆盘与方',
    svg:`<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="26" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="4"/><rect x="34" y="10" width="28" height="44" fill="currentColor"/><circle cx="48" cy="20" r="6" fill="var(--logo-accent,#FF4D00)"/></svg>`,
    idea:'构成主义圆盘 + 存储方 + 轮缘橙点', why:'圆与方对撞，橙点提供单一焦点', use:'品牌宣传、空状态插画' },
];

export const FILTER_GROUPS = [
  ['空间',['全部','客厅','主卧','样板间','全屋']],
  ['风格',['全部','现代','原木','侘寂','中式']],
  ['色系',['全部','暖木','米白','灰石','深咖']],
  ['更多条件',['品牌','部位','品类','日期范围']],
];
