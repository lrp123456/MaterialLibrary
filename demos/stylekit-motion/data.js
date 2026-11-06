/* 动效落点地图 · 基于 web-pro 真实组件只读盘点，非虚构示例 */

export const GROUPS = {
  GLOBAL: '全局壳与导航', LIB: '素材库', STUDIO: '空间创作',
  MEDIA: '剪辑与媒体工具', SET: '设置与状态', ERR: '错误与空状态',
};

// id / 分组 / 落点 / 真实位置 / 触发 / 动效类型 / 形变对 / 预算 / reduced-motion 终态
export const SPOTS = [
  [1,'GLOBAL','主板块导航指示器滑块','TopNav.vue:13 · style.css:121','切换四大板块 / resize','转场','—','B','滑块直接落在当前 tab'],
  [2,'GLOBAL','主题分段指示器滑块','TopNav.vue:86,172','暗黑/明朗/护眼切换','转场','—','A','滑块直接落在选中主题'],
  [3,'GLOBAL','主题切换按钮图标','TopNav.vue:85-100','点击主题 radio','状态反馈 / 形变','moon↔sun','A','直接显示目标主题图标'],
  [4,'GLOBAL','适老关怀开关','TopNav.vue:73-83','切换 senior-mode','状态反馈','—','A','保持 is-on 高亮，字号为静态终值'],
  [5,'GLOBAL','素材库一级下拉面板','TopNav.vue:32-55','hover 展开 / 400ms 收起','入场','—','A','面板直接显示/隐藏'],
  [6,'GLOBAL','四大板块视图切换','App.vue:17-44','点顶部板块 / 登录重建','转场','—','A','新视图直接渲染，无交叉淡入'],
  [7,'GLOBAL','语音麦克风录音环','VoiceInputButton.vue:53,426','recording=true','循环','—','A','静态红环 + 静态 FAB，voice-pulse 停止'],
  [8,'GLOBAL','语音识别结果面板','VoiceInputButton.vue:5,448','panelOpen 切换','入场','—','A','面板直接显隐，位移归零'],
  [9,'LIB','多选批量操作坞','LibraryView.vue:1445','selectMode / 退出','入场','—','B','底部坞直接位于终位，无上浮'],
  [10,'LIB','卡片多选勾选框','LibraryView.vue:1290','点击勾选/取消','状态反馈 / 形变','plus→check','A','选中显示实心 check，未选为空框'],
  [11,'LIB','卡片悬停四操作遮罩','LibraryView.vue:1350','hover 卡片','入场','maximize↔minimize','A','四按钮直接可见，opacity 无过渡'],
  [12,'LIB','收藏星标按钮','LibraryView.vue:1326','点收藏/取消','状态反馈','—','A','实心/空心终态，无 scale 弹跳'],
  [13,'LIB','瀑布流↔网格切换','LibraryView.vue:872 · VirtualMasonry.vue:357','点布局按钮','转场 / 数据变化','—','A','卡片直接以目标列数排布'],
  [14,'LIB','首屏加载骨架屏','LibraryView.vue:1056','loading && 列表为空','加载','—','A','静态圆环 + 文案，不旋转'],
  [15,'LIB','上传中悬浮提示条','LibraryView.vue:2711','isUploadingAsset','加载 / 反馈','—','A','静态显示当前文件名'],
  [16,'LIB','侧栏抽屉与筛选遮罩','style.css:847,894','折叠侧栏 / 打开筛选','转场','—','A','抽屉直接展开到位'],
  [17,'STUDIO','生成中占位卡片流光','ChatStudio.vue:298,9157','isGenerating && 图片/视频','循环 / 加载','—','C','静态蓝图网格，ping+spin 全停'],
  [18,'STUDIO','生成阶段文字 + 进度条','ChatStudio.vue:358,5699','阶段切换 / 百分比变化','数据变化','—','B','进度条停在目标百分比'],
  [19,'STUDIO','已耗时秒表','ChatStudio.vue:336,5680','每秒计时','数据变化','—','A','显示最终耗时，不逐帧刷新'],
  [20,'STUDIO','「接着可以」接续建议','ChatStudio.vue:639','助手回复完成','入场','—','A','建议 chip 直接列出'],
  [21,'STUDIO','复制提示词 / 复制全文','ChatStudio.vue:290,1888','点击复制','状态反馈 / 形变','copy→check','A','按钮文字直接为「已复制！」'],
  [22,'STUDIO','发送按钮 → 生成中','ChatStudio.vue:663,1405','点发送 / generating','状态反馈','—','A','按钮直接为禁用态，无打字机'],
  [23,'MEDIA','剪辑器 iframe 加载遮罩','OpenCutView.vue:14,171','canMount && !loaded','加载','—','B','静态圆环，@load 后直接移除'],
  [24,'MEDIA','剪辑服务未就绪提示','OpenCutView.vue:38,93','HEAD 探活失败','循环 / 错误','—','A','静态琥珀圆点 + 兜底卡片'],
  [25,'MEDIA','多轨剪辑↔媒体工具子导航','MediaHubView.vue:6,43','activeSub 变化','转场','—','A','目标子视图直接渲染'],
  [26,'MEDIA','播放 / 暂停按钮','MediaToolsView.vue:458','isPlaying 切换','状态反馈 / 形变','play↔pause','A','直接显示 play 或 pause'],
  [27,'MEDIA','抽帧 / 转码批量进度条','MediaToolsView.vue:338,722','batchProcessing / converting','数据变化','—','A','进度条直接停在最终百分比'],
  [28,'SET','服务器连接状态灯','SettingsView.vue:13,1093','probing / online 变化','循环 / 反馈','—','A','静态绿/红/琥珀圆点 + 文案'],
  [29,'SET','保存成功反馈','SettingsView.vue:398,881','保存请求返回','状态反馈 / 形变','edit→check','A','直接显示「✓ 已成功保存」'],
  [30,'SET','复制证书直链','SettingsView.vue:127,771','点「复制直链」','状态反馈 / 形变','copy→check','A','按钮直接显示「✓ 已复制」'],
  [31,'SET','设备导入指南选项卡','SettingsView.vue:154,172','切换 4 个平台','转场','—','B','直接显示对应系统步骤'],
  [32,'ERR','素材加载失败错误面板','LibraryView.vue:1062','loadError','入场','—','B','面板直接显示，含回退链'],
  [33,'ERR','空数据提示','LibraryView.vue:1119 · QuickStudio.vue:275','列表为 0','入场','—','A','图标 + 文案 + 清空按钮直接可见'],
  [34,'ERR','崩溃屏障 + 复制错误','App.vue:64,109','onErrorCaptured / chunk 失败','入场 / 反馈','copy→check','A','按钮文字为「✓ 已复制」'],
  [35,'ERR','全局登录弹窗','App.vue:48 · LoginModal.vue:2','未登录 / 会话过期','入场','—','A','弹窗直接可见，静态 spinner'],
].map(([id,g,n,l,t,k,m,b,f]) => ({ id,g,n,l,t,k,m,b,f }));

export const NO_MOTION = [
  ['虚拟滚动卡片槽','VirtualMasonry.vue:10-18,145','屏外节点从 DOM 移除、滚回重新挂载；入场动画会在每次滚动/分页重播，产生闪烁与重排风暴'],
  ['OpenCut iframe 内部文档','OpenCutView.vue:4-12,80','独立文档，父页 CSS/WAAPI 不可穿透；只允许外层加载遮罩'],
  ['逐帧改 DOM 的数值','ChatStudio.vue:5680 · MediaToolsView.vue:1202','与 ResizeObserver / MutationObserver / 共享 rAF 队列互相触发；生成百分比是推算值，补间等于伪造进度'],
  ['SSE asset:changed 合并通道','sse.js:31-61,221','200ms trailing + rAF 聚批，N 条事件合并成一次刷新，逐条入场会造成 N 次重排'],
  ['animate-in fade-in 死类','tailwind.config.js:47','plugins: [] 且无对应 keyframes，线上不产生任何动画，不能当作已有动效叠加'],
  ['senior-mode / iframe 主题同步','TopNav.vue:290 · OpenCutView.vue:126','历史 zoom 曾导致双重放大与 100vh 溢出；scale 类动画会破坏画布精确渲染'],
  ['全局按钮按压 scale','style.css:89-94','已对全站 button:active 生效，再叠加会双倍缩放'],
  ['音频采集回调','VoiceInputButton.vue:251-286','200ms 一包发 WebSocket，节奏由音频缓冲决定，不得由动画帧驱动'],
];

export const INSPIRATION = [
  ['Motion · Examples / Showcase','motion.dev','410+ 可复制示例：进入、滚动、悬停、反馈、布局、时间线；官方 Vue API 与 AI Kit','只借交互模式，代码按本项目令牌重写'],
  ['Motion+ Vault','motion.dev','330+ 预制动画与 100+ 教程（付费），适合查缓动与编排参数','不引入付费资源，仅作参数参考'],
  ['Web Motion Showcase','Gitee · ISC','60+ 克制的 Web UI 动效目录，按 进入/滚动/悬停/反馈/图片/布局 分类，含 reduced-motion 与可复制 prompt','分类法直接借用，素材零搬运'],
  ['Refs.Gallery / WebInteractions','refs.gallery · webinteractions.gallery','按组件类型检索 hover、page transition、menu、scroll 的真实站点模式','只作节奏与上手感参考'],
  ['UI Animation / Animista','uianimation.com · animista.net','按钮反馈、加载、列表展开等 CSS 预设，需确认署名与许可','本 demo 一律自写 CSS，不复制预设代码'],
  ['「Motion Shelf」核查结论','—','未检索到确切的同名动效灵感产品；同名结果指向 Live Photo 管理工具、MotionBuilder Shelf、视频模板库，与本项目无关','改用以上来源组合成灵感板'],
];

export const SKILLS = [
  ['UI设计技能库','ui-design-library','全代码库动效审计 / 动画构建与评审 / 13 个专家技能（Emil Kowalski 体系）'],
  ['动效设计 动画生成 视觉叙事','motion-skills','把数据或文件转成结构化动效设计结果，支持批量与置信度标注'],
  ['百型智能网页交互动效','bx-motion-design','设计或评审连续、可中断的网页动效，兼顾性能、清理与 reduced-motion'],
  ['动效原语工程','motion-primitives-engineering','33 个动效原语选型、弹簧调参与组合配方'],
  ['动效设计','metago-motion-designer','快速输出动效原则与参数要点'],
];

export const THEMES = [
  { key:'eye-care', label:'护眼', en:'CONSTRUCTIVIST PAPER', stage:'#EFE9DC', surface:'#E6DEC8', ink:'#17130E', muted:'rgba(23,19,14,.72)' },
  { key:'light', label:'明亮', en:'OVERSIZED GALLERY', stage:'#FAFAF8', surface:'#F0EFEA', ink:'#0A0A0A', muted:'#5E5E66' },
  { key:'dark', label:'暗黑', en:'KINETIC INK STAGE', stage:'#0B0B0C', surface:'#141416', ink:'#F4F1EB', muted:'rgba(244,241,235,.68)' },
];
