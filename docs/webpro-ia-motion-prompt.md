# 提示词 B · 功能架构 / 性能 / 动效（配合风格层 v2）

> 与 `docs/stylekit-prompt-v2.md`（提示词 A）**一起投喂**。A 管视觉与风格动效，B 管功能落位、动效选型、性能预算、适老化交互。
> 目标：功能一个不少、层次分明、常用外置、低频内置、主体突出、动效够用但不掉帧、适老化不倒退。
> 本文件是提示词，**不代表代码已改动**。

---

## 0. 最高约束：功能冻结清单

**任何改造不得删除、合并掉、隐藏到无法抵达的功能。** 只允许四种操作：换位置、改层级、折叠（一键可达）、二次进入（≤2 次点击）。下表是验收基线，改完逐条指认落点，指不出来即为回归缺陷。

| 板块 | 必须保留的功能组（当前承载文件 / 大致行号） |
|---|---|
| 全局 | 四板块切换、素材库 6 泳道（`TopNav.vue:133-150,193-198`）、适老关怀开关、三态主题、用户/登出、登录弹窗、新版本提示、崩溃屏障（复制错误/返回素材库/重置会话/刷新）、语音输入、`ml_auth_required` / `visibilitychange` / chunk 错误自动刷新 |
| 素材库 | 6 泳道（图片/视频/音频/基础素材/剪辑工程/回收站）；上传本地素材；视频提炼人声入口；只看精修/成品；图片空间/收藏/高级筛选；视频来源/画幅；音频情绪抽屉；基础素材 7 类短筛；筛选侧栏 + 关键词搜索；4 套独立筛选区；原素材/精修/成品状态筛选；剪辑工程 scope；基础素材材质/色号/灯具/模型独立筛选；回收站专属操作；左侧时间轴（刻度/年份跳转/可拖拽游标）；瀑布流（骨架/错误/手动指定备用服务器/空态/sticky 日期/触底加载）；卡片翻版/封面/播放标记/多选/收藏/元数据/悬停四操作（详情·AI 对话·剪辑·下载）；多选批量坞（全选/反选/清空/相似/AI 对话/剪辑/删除，回收站＝恢复/粉碎）；基础素材三段式 sticky 区；4 类弹窗（高清预览、Pinterest 详情＋衍生版本/智能打标/动作坞、人声提炼工坊、上传提示条）；`BaseLibraryPane.vue` 全部（色号库品牌/管理员远程入库/装修面/色系/材质·色号·灯具·模型网格/PBR 详情） |
| 空间创作 | 左侧会话抽屉（对话/创作库 Tab、新建、会话分类过滤、历史）；消息流（出站报文审查、图文混排、生成中占位、产物四操作、图层分解、视频/音乐产物、思考折叠、错误卡片、接续建议、回底）；看图区；输入舱（4 模态、对话/生图/视频/配乐模型 + 参数条 + `DynamicModelParamBar`、模型目录重试、`@` 引用双 Tab 子选区、`#` 匹配、配方句编辑、补充句、语音、优化、技能挂载、预览请求、发送）；`AssetPickerModal`、`RequestPreviewModal`；灯箱；存入创作库/新建配方；全屏配方详情与复用工作台；全屏创作库画廊（多维筛选/置顶手风琴/Top10/时间轴/分页）；划词迁移气泡；`StudioEditLayer` 全屏编辑（10 工具、扩图 HUD、马赛克/SVG/箭头/选区/裁剪/文字/3D、两阶段配置、guideTypes 6 类、ResurfaceDrawer、确认浮层、切片预览）；`StudioGlobalDrawer` 4 Tab（风格转换/换空间/超分/去水印）+ 光照微调；`QuickStudio` 6 大精准模式（替换/安装/增加/留白/去除/扩图）＋ 4 扩图方案 ＋ 全局重绘增强（超分/风格迁移/去水印）＋ 模型与 BaseAttrPicker 四仓库；`ResurfaceDrawer` 全部（部位/JEV/基材/调色盘/色相明度/HEX/建议配色/工艺/色卡库/1K 肌理） |
| 剪辑 | 二级导航（多轨剪辑 / 媒体工具）、处理模式指示、`OpenCutView` iframe ＋ 服务探活兜底 ＋ 防嵌套提示；`MediaToolsView` 3 工具（寻帧：WebCodecs/WGSL 锐化/Frame Info/智能抽帧/Quick Jump/胶片条/静帧池 ZIP·清空·智能入库；格式转换：目标格式/分辨率/音频分离/人声提炼/进度/内嵌预览；智能压缩：3 预设/CRF/预估体积/结果）＋ 3 弹窗（批量抽帧配置、大图对比灯箱、视频选择器） |
| 设置 | 11 个模块全部保留：服务器连接与三级回退、HTTPS 证书与 4 平台安装指南、AI 模型与密钥、New API 网关、灰度通道与白名单、网关分流与互斥审核、创作全局默认参数、衍生图默认挂载、存储路径与 NAS、换色预置方案＋常用单色库、管理员账户密码 |

---

## 1. 信息架构：三级分布（解决"单页功能点太多"）

```
L0 全局常驻条（≤7 个可点控件，跨板块高频，永远外置）
L1 工作区（每个板块固定三区：左导航/筛选 · 中主视口 · 右上下文）
L2 折叠区（低频参数、管理项；一个按钮外露，展开后 ≤1 屏）
L3 全屏工作台 / 模态（复杂任务；统一「返回 + Esc + 面包屑」）
```

### L0 全局常驻（把跨板块高频从各页提出来）
四板块切换、6 泳道、**全局搜索**（跨 DAM/创作库/会话，新增，命令面板 `Ctrl/Cmd+K`）、**上传**（任意板块可用）、**语音输入**、主题 + 适老化（合并为一个「显示」菜单）、用户。
> 当前顶栏只有板块/适老/主题/用户；`TopNav.vue` 里已维护 `online / probing / serverLabelText / candidatesText` 却没有渲染——把服务状态做成**一个常驻状态灯**（点击展开诊断），不要做成一排指标。

### L1 三区固定
- 左区：导航 / 筛选（可折叠，**默认展开**，宽 240–280px）
- 中区：主视口（唯一视觉主体，占宽 ≥55%，承载展示级巨字与主要动效）
- 右区：上下文抽屉（默认收起，展开时宽 ≤380px，用 `translateX` 进出）

### L2 / L3 归属原则
| 判定 | 落点 |
|---|---|
| 每次使用都要点（发送、上传、搜索、泳道、模式切换、卡片详情） | L0 或 L1 主工具条 / 卡片悬停快捷坞，**不得进下拉菜单** |
| 每次任务用一次（模型选择、参数、筛选条件、目标格式） | L1 右区或 L2 折叠，**但当前值必须常显在按钮上** |
| 一周用一次（高级筛选、批量管理、调试、证书、密钥、白名单） | L2 / 设置分区 |
| 独占一屏的复杂任务（全屏编辑、配方画廊、人声工坊、灯箱、Pinterest 详情） | L3，保持全屏，统一退出路径 |

---

## 2. 逐页面处方（只挪位置，不删功能）

| 文件 | 现状拥挤点 | 处方 |
|---|---|---|
| `TopNav.vue` | 6 泳道藏在 hover 下拉（400ms 延迟 + 鼠标精度，对适老化极不友好） | 泳道改为**左侧竖向常驻导航**（图标 + 文字，最小 44px 行高），当前泳道高亮用 2px 墨线 + 信号橙左条；hover 下拉可保留为快捷方式但不再是唯一入口 |
| `LibraryView.vue`（template 1–2720） | 6 泳道 + 2 行工具栏 + 侧栏 + 4 套筛选 + 时间轴 + 瀑布流 + 多选坞 + 4 类弹窗 | 顶部只留「搜索 / 上传 / 视图切换 / 筛选（带激活数）」4 个常驻动作；4 套筛选区**合并为一个筛选抽屉**，按泳道动态渲染同一套组件；时间轴可折叠（默认展开但可收）；多选操作坞保持底部悬浮且按钮 ≥44px；弹窗族统一 L3 壳 |
| `ChatStudio.vue`（输入舱 734–1424） | 模型+参数+`@`/`#`+配方句+语音+优化+4 模式+挂载+技能+预览+发送挤在一段 | **常驻层**：4 模态条 + 输入框 + 发送（信号橙）+ `@` 引用 + 挂载素材 + 语音；**参数抽屉**：模型/思考强度/上下文/技能/预览请求，外露按钮显示「当前模型名 + 参数摘要」；配方句编辑态升级为独立浮层；左会话栏可折叠为 56px 图标条 |
| `QuickStudio.vue`（右抽屉 476–949） | 6 模式 + 底图 + 模型 + 参数 + 四仓库 + 各模式面板 + 3D 预览 | 6 模式提到**左侧竖排模式条常置**（图标＋中文，不要藏进抽屉）；右抽屉只渲染当前模式参数；扩图 4 方案与 3D 预览放 L3 工作台 |
| `StudioGlobalDrawer` / `ResurfaceDrawer` | 4 Tab + 10 组参数平铺 | Tab 常置；参数分组用 accordion，**默认只展开第 1 组**；每组标题显示已选值摘要 |
| `StudioEditLayer.vue` | 10 工具 + 两阶段配置 + 多浮层 | 工具条固定左 64px（加大到 72px，触控 ≥44）；右侧两阶段改为步骤条（阶段 1/2 明确），非当前阶段折叠；确认/切片弹窗统一 L3 壳 |
| `MediaToolsView.vue` | 3 工具 + 3 弹窗，结构已较清晰 | 保持三工具 Tab；弹窗统一 L3 壳；WGSL 锐化/深度人声/CRF 微调归入「高级参数」折叠 |
| `SettingsView.vue` | 11 模块一页平铺到底 | 左侧分组导航 + 右侧单模块，配设置内搜索；分组：日常 / 连接与安全 / 模型与密钥 / 存储 / 管理（5 组，11 模块一个不少） |
| `OpenCutView.vue` | 兜底卡片与防嵌套提示同页；**文案暴露 3010** | 合并为一张 L3 诊断卡：标题「剪辑服务未就绪」+ 原因 + 「打开服务控制台」CTA（信号橙）+ `kc-pendulum` 红三角；**删除所有端口号字样** |
| `App.vue` | `v-if + :key` 切板块会销毁 iframe，剪辑工程现场丢失 | 四视图改 `keep-alive`（或 `v-show` 保活 `OpenCutView`），切走时暂停该视图的循环动画与 RAF；`sessionTick` 只在登录/登出时递增，不再作为切板块的重建理由 |

---

## 3. 动效库选型（回答"Motion UI？还是别的"）

### 结论（按优先级）
1. **View Transitions API（0KB，原生）** — 四板块切换 / L3 全屏工作台进出首选。同文档 SPA 过渡在 Chrome/Edge、Safari 18+、Firefox 133+ 已可用，合成线程执行，不占主线程；不支持时自动降级为无动画切换，零风险。**注意**：`view-transition-name` 只给主视口大元素（≤3 个），给 iframe 容器显式 `view-transition-name: none`，连续切换时先 `skipTransition()`，`prefers-reduced-motion` 下禁用伪元素动画。
2. **`motion`（motion.dev，原 Framer Motion 团队，现 13.x，MIT，官方提供 Vue API）** — 主力 JS 动效。`animate()` mini 约 3.2KB、full 约 22KB，tree-shaking 友好，基于 WAAPI + 硬件加速，提供 `stagger()` / `inView()` / 时间线 / 进出场。Vue 侧可用 `motion-v` 的 `<motion.div>` + `AnimatePresence` 处理 `v-if` 浮层退场，或直接用 vanilla `animate()` 配 `onMounted` 组合式函数。**这是"用得更多、效果更好、体积更小"的答案**（官方对标 GSAP：mini 3.2KB vs GSAP 23KB，且在未知值动画上更快）。
3. **`tailwindcss-animate`（约 1KB CSS）** — **只为清理现有死类**：项目里 `animate-in fade-in duration-*` 目前因 `tailwind.config.js` 的 `plugins: []` 完全没生效。装上插件即可让十几个弹窗/抽屉恢复淡入，或统一改用 `motion.animate()`，二选一，**不要两套并存**。
4. **CSS 原生补位** — `kc-orbit/pendulum/march/sweep`、`@keyframes`、CSS scroll-driven animations（渐进增强）、`IntersectionObserver` 触发一次入场。简单 hover/active 一律 CSS，不用 JS 库。

### 明确不推荐
| 方案 | 原因 |
|---|---|
| **Motion UI**（Foundation 的 Sass 动效库）/ **animate.css** | 上一代产物，需 Sass 或全局类名，和 Vue3 + Tailwind 的组件化状态动效不匹配；且今天 "Motion UI" 这个名字更多指 motion.dev 的**React 预制区块商店**（Motion+ 付费），不是 Vue 工作台该引入的东西 |
| **GSAP + ScrollTrigger** | 23KB+ 且旧架构不易 tree-shake；时间线确实强，但本项目没有长滚动叙事页，只在"多阶段精确编排"确有需求时**按需动态 import**，不做全局依赖 |
| **anime.js / Lottie / Lenis** | anime.js 生态较小；Lottie 适合插画不适合 UI 反馈；Lenis 平滑滚动会与 `VirtualMasonry` 的窗口化计算打架，禁止引入 |
| **`@vueuse/motion`** | 可行备选（v-motion 指令最贴近现有模板），但与 `motion-v` 二选一，**不要混用两套运行时同时改同一元素的 transform** |

### 依赖与体积预算
新增运行时依赖 **≤1 个**（`motion` 或 `motion-v`），总体新增 gzip **≤15KB**；`tailwindcss-animate` 仅 dev 依赖。禁止再引入第二个动画运行时。

---

## 4. 动效清单：补的是"功能反馈"，不是装饰（解决"当前动效太少"）

按用途配齐，每一条都必须有明确的状态含义；同一时刻只允许 1 个"主角"循环动效。

| 场景 | 动效 | 时长 / 缓动 | 实现 |
|---|---|---|---|
| 四板块切换 | 主视口交叉淡入 + 巨字遮罩上升（**仅切换瞬间，不常驻**） | 250ms / 0.75s expo-out | View Transitions + `motion` stagger ≤6 |
| 导航 / 泳道高亮 | 指示块 `translateX` 位移（**去掉 width/height 动画**） | 180ms expo-out | CSS |
| 按钮 / 菜单 hover | `kc-sweep` 对角实色扫入；`:active` scale .98 | 350ms / 120ms | CSS |
| 抽屉 / 弹窗进出 | `translateX` + `opacity`（禁止 backdrop-blur，用实色遮罩） | 240–320ms | `motion-v` AnimatePresence 或 Vue `<Transition>` |
| 卡片首次进入视口 | 一次性 `opacity + translateY(12px→0)`，stagger ≤6 项 | 300ms | `inView()` / IntersectionObserver，`once:true` |
| 列表增删 | 删除用 `opacity+transform`，**不做高度塌陷动画**；新增只动新项 | 200ms | `motion` |
| 生成中 / AI 推理 | `kc-orbit` 群青公转 + 阶段文案静态骨架；每区≤1 个 | 12s linear | CSS `transform` |
| 服务离线（剪辑/网关） | `kc-pendulum` 构成红三角 ±22° | 2.2s alternate | CSS `transform` |
| 加载 / 导出进度 | `kc-march` steps(3) 方块行进 + 实色进度条 `scaleX` | 900ms / 线性 | CSS |
| Toast / 成功 / 错误 | 从边缘 `translateY` 滑入，2.5s 后自动收 | 240ms | `motion` |
| 计数器 / Token 数字 | **不逐帧改 DOM 数字**；只用 `tabular-nums` + 一次 `opacity` 切换，避免字宽变化引发重排 | 150ms | CSS |
| 适老 / 主题切换 | 只做 `color/background-color` 200ms 过渡，不移动布局 | 200ms | CSS |

**强制降级**：以上全部在 `@media (prefers-reduced-motion: reduce)` 下 `animation:none; transition:none` 并直接显示终态；跑马灯 hover 暂停 + 显式暂停按钮（`aria-pressed`），`document.hidden` 时所有循环动画 `animation-play-state:paused`。

---

## 5. 性能预算与硬规则（保证"性能优秀"）

1. **可动画属性白名单**：`transform`、`opacity`、`color`、`background-color`、`border-color`、`font-variation-settings`（后者仅按提示词 A-7 的脱离文档流约束使用）。禁止 `top/left/width/height/margin/padding/filter:blur()`。
2. `will-change` 只在动画**开始前**加、结束后移除；**禁止在 `v-for` 的每一项上常驻 `will-change`**（`VirtualMasonry` 卡片、`ChatStudio` 消息流）。
3. `VirtualMasonry`：入场动画必须 `once:true`（按 `fid` 记忆），滚动回视口**不重播**；`key=fid` 的节点复用不做 FLIP 布局动画；`buffer` 与 `maxRenderPerCol` 不得因动效而调大。
4. 循环动画：`IntersectionObserver` 不可见即暂停；**同一视口同时运行的无限循环动画 ≤2 个**；`document.hidden` 全停。
5. iframe 保活：按第 2 节改 `keep-alive`；隐藏时暂停 iframe 内可见动画（发一次 postMessage 或用 `visibility` 通知），回来恢复，避免销毁重建造成的整页重载。
6. 主题切换只改 `html` class（现有机制正确，保持）；禁止 JS 遍历 DOM 改内联样式；禁止再新增 `[class*="..."]` 属性选择器覆写。
7. 保留现有四视图 `defineAsyncComponent` 懒加载；动效库按板块 `import()` 分包，不进首屏 chunk；首屏新增 JS ≤15KB gzip。
8. 筛选 / 排序 / 相似度计算走 `computed` 缓存 + 输入防抖（≥150ms），禁止在 `watch` 里对 6498 行组件整体触发重渲染；大列表骨架屏用 `opacity` 切换，不用逐项动画。
9. 性能验收指标（DevTools Performance，参考机 1920×1080）：板块切换 INP <200ms；滚动瀑布流稳定 ≥55fps；动画轨道落在 Compositor 而非 Main；主题切换无布局抖动（CLS <0.01）；L3 全屏工作台进出无长任务 >80ms。

---

## 6. 适老化与尺寸契约（与提示词 A-5 一致，且不得倒退）

- 保留 `html.senior-mode` 默认开启与 `16.5 / 17 / 18.5px` 基准；字号提升规则优先于任何新样式。
- 正文 ≥16px、行高 ≥1.6；机械标注 ≥13px（senior ≥15px）；**中文标注不用等宽、不套 uppercase、`letter-spacing ≤0.06em`**。
- 所有可点控件 ≥44×44px，主 CTA ≥48px 高；主工具条按钮带**中文文字标签**，不得只有图标（图标 + 文字并列）。
- 常用功能不许藏在 hover / 右键 / 长按 / 二级下拉里；hover 下拉最多作为快捷方式，必须有等价的常驻点击入口。
- 焦点环保留 `outline:2px solid var(--theme-border-active); outline-offset:2px`；所有 L3 浮层支持 `Esc` 关闭并把焦点还给触发元素。
- 巨字、空心描边字、跑马灯一律 `aria-hidden` 或提供等价可读文本；动态状态用 `aria-live="polite"`，禁止高频刷屏。

---

## 7. 文案与端口红线

- 用户可见文案**禁止出现 3010 / 30000 / 30001 / 30003 / 内部端口**；对外只说 30002（正式）或"灰测/test 通道"。
- `OpenCutView.vue:47` 改为「剪辑服务未就绪」+ 服务控制台入口，不写端口。
- 服务状态用一个状态灯 + 诊断抽屉表达，不铺一排技术参数。
- 主 CTA 文案用动词短语（「上传素材」「立即生成」「进入剪辑」），中文优先，英文只做等宽标注。

---

## 8. 执行顺序（每步可独立验收，避免一次性大改）

1. **清理死动效 + 定基线**：装 `tailwindcss-animate`（或统一改 `motion.animate()`），修 `.nav-indicator` 的 width/height transition，补全局 reduced-motion 覆盖。
2. **变量别名映射**：按提示词 A-2 把三态色值写入现有三个主题块，跑三态主题回归（这一步做完视觉就统一了，风险最低）。
3. **L0 / L1 骨架**：顶栏常驻控件、泳道竖向导航、三区栅格、L3 统一壳（返回 + Esc + 面包屑）；功能只挪不删。
4. **逐页减负**：按第 2 节处方依次处理 `LibraryView` → `ChatStudio` 输入舱 → `QuickStudio` / `StudioGlobalDrawer` → `SettingsView` → `MediaToolsView` / `OpenCutView`；每页结束核对第 0 节冻结清单。
5. **补功能动效**：View Transitions 板块切换 → `motion` 微反馈 → `kc-*` 机械图元；控制循环动效预算。
6. **性能与适老回归**：按第 5、6 节指标实测；先发 30003/test 通道验证，再走「双通道灰度发布」推正式。

---

## 9. 验收清单（功能层）

- [ ] 第 0 节冻结清单逐条可指认落点，任一功能到达路径 ≤2 次点击（L3 全屏任务 ≤3 次）。
- [ ] 每个板块 L1 常驻动作 ≤7 个；`LibraryView` 顶部动作 ≤4 个；`ChatStudio` 输入舱常驻层 ≤6 个控件。
- [ ] 常用操作（搜索/上传/发送/泳道/模式/卡片详情）不在任何 hover 菜单里作为唯一入口。
- [ ] 四板块切换后 `OpenCutView` iframe 不重载、工程现场保留。
- [ ] 无 `animate-in fade-in` 死类残留；新增动画运行时 ≤1 个，首屏新增 JS ≤15KB gzip。
- [ ] 同时运行无限循环动画 ≤2 个；后台标签页全部暂停；reduced-motion 下全站静止于终态。
- [ ] `senior-mode` 开关两种状态各测一遍，最小字号/触控区/对比度全部达标。
- [ ] 用户可见文案无内部端口号。
- [ ] 30003 验证通过后才发布到 30002；`vite build` 无新增错误。
