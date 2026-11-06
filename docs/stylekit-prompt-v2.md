# 提示词 A · 风格层（STYLEKIT 适配 MATERIAL STUDIO PRO / v2）

> 用法：把本文件「第 2 节起」整段投喂给编码 Agent，并与 `docs/webpro-ia-motion-prompt.md`（提示词 B）同时使用。
> 分工：A 只决定**长什么样、怎么动得有风格**；B 决定**功能放哪里、怎么动得快、怎么保证不卡**。
> 冲突时以 B 的性能与适老化条款为准，A 的装饰性规则让位。
> 本文件是提示词与核查记录，**不代表代码已改动**。

---

## 0. 投喂前必读：项目事实（不可推翻，不得"顺手重构"）

| 项 | 实际情况 |
|---|---|
| 技术栈 | Vue 3.5 + Vite 5 + Tailwind 3.4（`tailwind.config.js` 已配 `content`，`plugins: []`），无路由库实际使用，四板块靠 `App.vue` 的 `v-if` + `defineAsyncComponent` 切换 |
| 主题 | **已存在三态**：`html.dark` / `html.light` / `html.eye-care`，由 `TopNav.vue` 右上角 radiogroup 切换，存 `localStorage.material_theme`，**默认 dark**（原提示词写"护眼默认"与现状冲突） |
| 配色真相源 | `src/styles/theme-tokens.css`（790 行）：`--theme-*` 语义变量 + `--studio-*-rgb` / `--slate-*-rgb` 通道变量；`tailwind.config.js` 把 `studio.*` / `slate.*` 映射到这些通道。另有大量针对具体 Tailwind 类名的 `!important` 覆写与属性选择器（如 `[class*="bg-emerald-"]`） |
| 适老化 | **已存在且默认开启**：`html.senior-mode`（`TopNav.vue` 首次默认 true），基准字号 16.5 / 17 / 18.5px，并强制把 `.text-[10px]…[12px]` 提到 13.5px、`.text-xs` 提到 15px。原提示词的 11px 标注与之直接冲突 |
| 动效现状 | 无动画库；`style.css` 无 `@keyframes`，仅 13 处 `transition`；`.vue` 内自定义 keyframes 仅 2 个（`voice-pulse`、`shimmerWave`）；大量 `animate-in fade-in duration-*` 类**因未安装 `tailwindcss-animate` 插件而是死类**（这是"动效太少"的直接原因之一）；已有 `@media (prefers-reduced-motion: reduce)` 但只覆盖 4 个选择器 |
| 现有违规 | `style.css:129` `.nav-indicator` 的 `transition` 含 `width/height`（原提示词明令禁止）；全站约 2000+ 处 `rounded-*` / `shadow-*` / `bg-gradient-*` / 小字号类，其中 `ChatStudio.vue` 375 处、`LibraryView.vue` 253 处、`QuickStudio.vue` 200 处 |
| 端口红线 | `3010` 是**内部反代端口**（`vite.config.js` / `server.cjs`），用户不进 3010；对外只见 30002（正式）/ 30003（test 通道）。`OpenCutView.vue:47` 现在把「端口 3010 未运行」写给用户看，必须改 |
| 外部资源 | `index.html:11` 已从 CDN 加载 `@google/model-viewer@3.5.0`（与 `package.json` 的 `^4.4.0` 版本不一致）。工作台运行在本机/局域网，**可能无外网**，任何新增字体 CDN 都会造成排版崩塌 |
| 大列表 | `VirtualMasonry.vue` 是窗口化挂载/卸载（屏外移除 DOM，`key=fid`，buffer 900px），不是节点池复用；卡片动效必须按"首次进入视口一次"设计 |
| 剪辑器 | `OpenCutView.vue` 用 iframe 挂 `/editor` 的 Next 子应用；`App.vue` 用 `v-if + :key` 切板块，切走会销毁 iframe、丢失编辑器现场 |

---

## 1. 符合性核查结论（原 STYLEKIT vs 实际项目）

| # | 原规则 | 判定 | 处理 |
|---|---|---|---|
| 1 | 禁圆角 / 投影 / 模糊 / 渐变 | ⚠️ 方向可接受，但**一次性全清不现实**（2000+ 处） | 保留为终态目标；改为「令牌化 + 分阶段收敛」，先全局兜底再逐页清，见 A-2 |
| 2 | 三套新变量 `--bg-stage` 等 | ❌ **最大冲突** | 不得另起一套变量，必须别名映射到 `--theme-*`，见 A-3；否则所有 `bg-studio-*` 组件颜色纹丝不动 |
| 3 | 护眼为默认主题 | ❌ | 沿用 `material_theme` 与默认 dark，不迁移用户偏好 |
| 4 | 11px / tracking 0.2em 机械标注 | ❌ 违反适老化 | 改 `clamp(13px,0.85rem,15px)`；中文标注字距降到 0.06em，见 A-6 |
| 5 | 字体 CDN `fonts.loli.net` | ❌ 致命 | 改本地自托管 woff2 + 中文系统字体栈，见 A-7 |
| 6 | Anybody / Archivo 巨字 | ⚠️ 无中文字形 | 中文回退系统字体后字重/字宽与英文不一致；中文巨字单独定规则 |
| 7 | `leading-[0.88]` + `tracking-tighter` | ❌ 中文会叠字/糊笔画 | 中文行高 ≥1.05、字距 ≥ -0.02em |
| 8 | 空心描边巨字 | ⚠️ | 仅装饰、必须 `aria-hidden` + 实字替代；禁止用于任何承载信息的文字 |
| 9 | 只动画 transform / opacity / `font-variation-settings` | ⚠️ 规则自身有技术漏洞 | `wght` 变化会改变字宽 → 触发布局重排，与"禁动画 width"自相矛盾；见 A-8 修订 |
| 10 | 一屏一主角 | ❌ 不适合工作台 | 工作台多面板并行；改为「一区一主角 + 全局循环动效预算 ≤2」，见 A-8 |
| 11 | 2px 墨线 0gap Bento 全站 | ⚠️ 密集数据区会变 4px 双线、表格噪声 | 分层：只 L0/L1 用 2px，L2/L3 用 hairline，见 A-5 |
| 12 | 端口 3010 离线警告 | ❌ 违反项目端口铁律 | 文案改为「剪辑服务未就绪」，不暴露端口号，见 B-8 |
| 13 | `85:10:4:1` 配比 | ⚠️ 定义含糊 | 明确按「UI 像素面积」统计，不含图片/视频内容像素 |
| 14 | 主按钮 `bg-[#FF4D00] text-[#0B0B0C]` | ✅ 对比度约 5.9:1 | 保留；但 #FF4D00 作文字在米白底仅约 2.7:1，禁止用于小字/正文 |

---

## 2. 【提示词正文 · A】风格层规格

你是本项目的资深视觉设计工程师。以下规则用于重构 `web-pro` 的视觉层，只改样式与主题令牌，**不得删除或改写任何业务功能**（功能归属见提示词 B）。

### A-1 绝对禁止（继承原规则，零妥协）

1. 禁止任何圆角：`rounded-*` 一律 `rounded-none`；构成主义圆形图元只允许用 SVG `<circle>` / `<ellipse>` 绘制。
2. 禁止投影与模糊：`shadow-*`、`drop-shadow-*`、`blur-*`、`backdrop-blur-*` 全部禁用；层次只用实色块叠加、2px 墨线、字号极差、留白建立。
3. 禁止渐变：`bg-gradient-*`、`bg-clip-text` 禁用，只允许刀切硬边实色平涂。
4. 禁止对 `top/left/width/height/margin/padding` 做动画或 transition。允许动画的属性仅限 `transform`、`opacity`、`color`、`background-color`、`border-color`。**`style.css:129` 的 `.nav-indicator` 必须改为纯 `transform` 方案**（滑块固定宽度或用 `scaleX`，不得动画 width/height）。
5. 禁止温和居中标题：除顶部跑马灯外，展示级巨字与章节标题一律左对齐。
6. 禁止忽略无障碍：所有动效必须写 `@media (prefers-reduced-motion: reduce)` 降级到静态终态；跑马灯支持 hover 暂停 + 显式暂停按钮（`aria-pressed`）。
7. **媒体叠层例外（唯一）**：`theme-tokens.css` 里 `.on-media` / `.media-badge` / `[data-scrim]` 系列是图片/视频上的白字保护，允许保留半透明深色实色遮罩，但**必须去掉 `box-shadow: 0 1px 4px …`**，改用 1px 实色描边保证可读性；不得扩大该例外到任何普通 UI 容器。
8. **迁移策略（替换"一次性全清"）**：由于现存 2000+ 处违规类，按 ①全局令牌兜底 → ②`TopNav` / `App.vue` / 通用组件 → ③四大视图主视口 → ④弹窗与抽屉 → ⑤边缘面板 的顺序分阶段收敛；每阶段结束必须跑一次 `vite build`。禁止用 `* { border-radius: 0 !important }` 这类全局通配覆盖（会误伤 SVG 图元与媒体容器），只允许针对明确的组件选择器改写。

### A-2 变量契约：只做别名，不建第二套真相源（最高优先级）

**禁止新增 `:root { --bg-stage: … }` 这种平行变量组。** 在 `theme-tokens.css` 的三个主题块内，把原提示词的新名字定义为**指向现有变量的别名**，让新旧写法都能读到同一份值：

| STYLEKIT 名 | 必须别名到 | 同时要改 |
|---|---|---|
| `--bg-stage` | `--theme-bg-canvas` | `tailwind.config.js` 的 `studio.950` |
| `--bg-surface` | `--theme-bg-card` | `studio.850` |
| `--fg-ink` | `--theme-text-primary` | `slate.100/200` |
| `--fg-muted` | `--theme-text-secondary` | `slate.300/400` |
| `--border-hairline` | `--theme-border-subtle` | `studio.750` |
| `--accent-signal` | `--theme-accent-primary` | `studio.accent` |
| `--kc-red` | `--theme-danger-text` | `studio.rose` |
| `--kc-blue` | `--theme-accent-secondary` | `studio.cyan` |
| `--kc-yellow` | `--theme-warning-text` | `studio.amber` |

- 三套主题的**色值**替换为 STYLEKIT 给定值：护眼 `#EFE9DC / #E6DEC8 / #17130E`，明亮 `#FAFAF8 / #F0EFEA / #0A0A0A`，暗黑 `#0B0B0C / #141416 / #F4F1EB`。
- 强调色跨主题恒定：`--accent-signal:#FF4D00`、`--kc-red:#E0231B`、`--kc-blue:#1C4A87`、`--kc-yellow:#F4B301`。
- 主题切换仍然只改 `html` 上的一个 class，**禁止用 JS 遍历 DOM 改样式**。
- 现有针对具体类名的 `!important` 覆写（约 30 组属性选择器）本次不改行为，但**禁止再新增同类写法**；新样式一律走语义变量。
- 现有 `html.light` 把整条 slate 色阶反转的 hack 保持不动，不要"顺手修正"，否则大面积字色会翻车。
- `85:10:4:1` 按 UI 像素面积统计（不含素材图片/视频像素）：85% 舞台底色、10% 抬升面板与墨线、4% 信号橙、1% 构成三原色。信号橙只用于主 CTA、当前一级模块标识、hover 边框/下划线、巨字核心词，**严禁大面积铺底**。

### A-3 对比度与用色下限（适老化硬指标）

- 正文/小字对比度 ≥7:1，次要注释 ≥4.5:1，≥24px 大字 ≥3:1。改完必须实测。
- 原提示词的 `--fg-muted: rgba(23,19,14,0.60)` 在米白底估算仅约 4.3:1，**不达标**；建议护眼提到 `rgba(23,19,14,0.72)`、明亮 `#71717A` 改 `#5E5E66`、暗黑 `rgba(244,241,235,0.55)` 提到 `0.68`，以实测为准。
- `#FF4D00` 在米白底约 2.7:1：禁止作为小于 24px 的文字色；巨字核心词改用 `#E84700` 或保留橙色但加 2px 墨色描边；CTA 保持橙底 + `#0B0B0C` 墨字。
- 构成红仅用于服务离线/错误边界/回收站闸门，群青蓝仅用于 AI 推理图元与视频轨微标，金黄仅用于精标图元与高思考强度微标。

### A-4 五层空间层次令牌（解决"层次感明显"）

只允许以下 5 级组合，禁止自造第 6 级：

| 层 | 用途 | 底色 | 边框 | 圆角/投影 |
|---|---|---|---|---|
| L0 舞台 | 全屏背景 | `--bg-stage` | 无 | 无 |
| L1 分舱 | 顶栏、左右主分区、时间轴 | `--bg-stage` | **2px `--fg-ink`** | 无 |
| L2 抬升面板 | 工具条、抽屉、输入舱 | `--bg-surface` | 1px `--border-hairline` | 无 |
| L3 内容卡 | DAM 卡片、消息气泡、列表行 | `--bg-surface` | 1px hairline + 顶部 2px `--fg-ink` | 无 |
| L4 浮层 | 模态、灯箱、Toast | `--bg-surface` | 2px `--fg-ink` + 实色遮罩 `rgba(0,0,0,.55)` | 无 |

- **0gap Bento 的正确画法**：相邻 L1 分舱不得各自写 2px 四边框（会叠成 4px）。统一用「父容器 `gap:2px; background:var(--fg-ink)`，子舱 `background:var(--bg-stage)`」的负空间描边，或只给子舱写 `border-right` / `border-bottom` 单侧边。
- 密集数据区（时间轴刻度、属性表、Token 计数）一律 L2 + hairline，**禁止 2px 墨线**，否则读表噪声过大。
- 层次优先级：字号极差 > 留白 > 边线 > 底色差。禁止靠"再深一点的底色"叠出第 6 层。

### A-5 字阶与双声部排印（中文 + 适老化修订版）

**字阶（senior-mode 开启时的实际值，不得更小）**

| 角色 | 字号 | 行高 | 字重 | 备注 |
|---|---|---|---|---|
| 展示巨字 | `clamp(2.75rem,7vw,6.5rem)` | 英文 0.88 / **中文 ≥1.05** | 800–900 | **仅空状态、离线诊断、板块切换瞬时横幅；不得常驻工作视口** |
| 章节序号 / 日期巨字 | `clamp(2rem,4.5vw,4.25rem)` | 1.0 | 800 | 左对齐 |
| 区块标题 | 24–28px | 1.3 | 700 | 左对齐 |
| 小标题 | 18–20px | 1.4 | 600 | 左对齐 |
| 正文 | 16–17px | **≥1.6** | 400–500 | 中文不用等宽 |
| 机械标注 | `clamp(13px,0.85rem,15px)` | 1.45 | 400 | **原 11px 作废**；只用于数字/英文代码 |

- 声部一（巨字）：`Anybody → Archivo → Noto Sans SC → sans-serif`，`uppercase` 对中文无意义，不要对中文节点套 `uppercase`；中文巨字 `letter-spacing ≥ -0.02em`，**禁用 `tracking-tighter`**；英文可用 `tracking-tighter`。
- 次要巨字行空心描边：`-webkit-text-stroke:1.5px var(--fg-ink); color:transparent`，hover 实心 `#FF4D00`。仅限装饰巨字，必须 `aria-hidden="true"` 并在相邻提供可读实字；禁止用于任何承载信息的文字；中文笔画细会断，中文巨字默认不用空心。
- 声部二（标注）：`Space Mono` + `tabular-nums` + `uppercase`；**英文/数字标注** `letter-spacing:0.12–0.2em`，**中文标注降到 0.06em** 且不套 `uppercase`；字号不小于上表下限。
- `html.senior-mode` 现有的字号提升规则全部保留且优先；任何新写的 `text-[11px]` / `text-xs` 视为违规。
- 保留 `body` 现有中文系统字体栈（`PingFang SC / Microsoft YaHei / …`）作为正文与中文标题主力，避免中文被拉丁字体的回退字形带偏。

### A-6 字体交付：离线自托管（替换 CDN）

1. **删除**原提示词的 `<link href="https://fonts.loli.net/...">`，本项目不允许运行时依赖外部字体 CDN。
2. 把 `Anybody`（可变 wdth/wght）、`Archivo`（700/800/900）、`Space Mono`（400/700）的 **Latin 子集 woff2** 放进 `web-pro/public/fonts/`，用 `@font-face` + `unicode-range: U+0000-00FF, U+2000-206F, U+2190-21BB` 只覆盖拉丁字符；中文交给系统字体，不下载中文字体子集（体积不可控）。
3. `font-display: swap`；关键字体在 `index.html` 用 `<link rel="preload" as="font" type="font/woff2" crossorigin>` 预载，配 `size-adjust` / `ascent-override` 兜底以减少 CLS。
4. 顺带把 `index.html:11` 的 `@google/model-viewer` CDN 改为本地 `import`（`package.json` 已有 `^4.4.0`），消除版本漂移与离线风险。
5. 验收：断网打开 30003，三态主题下巨字/标注不塌陷、不出现 FOUT 闪烁、`document.fonts.ready` 后无布局跳动。

### A-7 动力学动效配方（风格层；功能层清单见提示词 B）

1. **遮罩上升入场**：外层 `overflow:hidden`，内层 `translateY(110%) → 0`，缓动 `cubic-bezier(0.22,1,0.36,1)`，`0.75s`，逐词 `stagger 40ms`。**stagger 上限 6 项**（`Math.min(i,5)*40`），长列表不得排队。
2. **可变字体呼吸**：每屏仅 1 个状态关键词（`LIVE` / `STANDBY` / `0/0`）跑 `wght 300→900`，`2.4s ease-in-out infinite alternate`。
   **修订（必读）**：`wght` 会改变字宽并触发重排。该元素必须 `position:absolute` + 固定 `width` + `contain: layout paint`，脱离文档流；中文词不跑 `wght`，改用 `opacity` 呼吸。
3. **机械图元**（SVG/CSS，`transform` 硬件加速）：
   - `kc-orbit` 公转：空画布 / AI 思考态，外环 `rotate(360deg) 12s linear infinite`，子圆骑轮缘，用 `--kc-blue`。
   - `kc-pendulum` 钟摆：剪辑服务未就绪，红色三角 `transform-origin: top center`，`-22deg ↔ 22deg`，`2.2s ease-in-out infinite alternate`。
   - `kc-march` 步进：底部状态栏 / 加载条，小方块 `steps(3)` 机械行进。
   - `kc-sweep` 对角扫入：hover 菜单项/按钮，`translateX(-105%) skewX(-12deg) → translateX(0) skewX(-12deg)`，`0.35s cubic-bezier(0.16,1,0.3,1)`。
4. **「一屏一主角」改为「一区一主角」**：把视口按 L1 分舱切成区，每区最多 1 个循环动效；同一视口内**同时运行的无限循环动画 ≤2 个**；一次性反馈动效（hover、点击、入场、Toast）不计入预算。文字做遮罩上升时几何图元静止；几何图元公转时同区文字保持静态骨架。
5. 循环动画在 `document.hidden` 或元素不可见（IntersectionObserver）时 `animation-play-state: paused`；离开视口立即暂停，回来恢复。
6. 所有动效在 `@media (prefers-reduced-motion: reduce)` 下 `animation:none; transition:none` 并直接呈现终态（含 View Transitions 伪元素）。

### A-8 核心组件 Token（适配 Tailwind 3.4 现有写法）

```css
/* 按钮：统一在 style.css 定义 .kc-btn / .kc-btn-primary，模板逐步替换 */
.kc-btn {
  border-radius: 0; text-transform: uppercase; font-family: "Space Mono", ui-monospace, monospace;
  font-size: 15px; font-weight: 700; letter-spacing: .15em;
  border: 2px solid var(--fg-ink); min-height: 44px; padding: 10px 18px;
  transition: transform 300ms cubic-bezier(.22,1,.36,1), background-color 300ms, color 300ms;
}
.kc-btn:active { transform: scale(.98); }
.kc-btn-primary { background: #FF4D00; color: #0B0B0C; border-color: #FF4D00; }

/* DAM 卡片 */
.kc-card {
  border-radius: 0; background: var(--bg-surface);
  border: 1px solid var(--border-hairline); border-top: 2px solid var(--fg-ink);
  padding: 0; transition: border-color 300ms;
}
.kc-card:hover { border-top-color: #FF4D00; }

/* 输入 / Prompt 舱 */
.kc-input {
  background: transparent; border-radius: 0; border-bottom: 2px solid var(--fg-ink);
  font-family: "Space Mono", ui-monospace, monospace; font-size: 16px;
}
.kc-input:focus { border-bottom-color: #FF4D00; outline: none; }
```

- 主外壳：`border-2 border-[var(--fg-ink)]` 的 0gap 分舱（按 A-4 的单侧边规则实现）。
- 所有可点击控件最小触控区 **44×44px**，主 CTA **≥48px 高**；文字 ≥15px。
- 焦点态：保留现有 `outline:2px solid var(--theme-border-active); outline-offset:2px`，**不得用 shadow 代替焦点环**。

### A-9 验收清单（风格层）

- [ ] 断网 + 30003 灰测通道，三态主题切换后所有 `bg-studio-*` / `text-slate-*` 组件同步变化，无"新旧两套色"并存。
- [ ] 全站无 `rounded-*` / `shadow-*` / `blur-*` / `bg-gradient-*`（`.on-media` 例外仅保留遮罩与 1px 描边）；`vite build` 通过。
- [ ] 无任何 `transition` / `animation` 作用于 `top/left/width/height/margin/padding`；`.nav-indicator` 已改为纯 transform。
- [ ] `senior-mode` 开/关各测一遍：最小可见文字 ≥13px（senior ≥15px）、正文行高 ≥1.6、按钮 ≥44px。
- [ ] 对比度实测：正文 ≥7:1、次要 ≥4.5:1；无橙色小字。
- [ ] `prefers-reduced-motion: reduce` 下所有动效停于终态；跑马灯 hover 与暂停按钮均生效。
- [ ] 巨字不常驻工作视口；中文巨字不叠字、不用空心描边承载信息。
- [ ] 同时运行的无限循环动画 ≤2 个，切后台全部暂停。
