---
feature: stitch-ui-quark-install-p2p4
status: delivered
updated: 2026-09-11
branch: inplace-no-git
commits: n/a
---

# Stitch 双端 UI + 夸克一键授权 + P2–P4 增量

## Report

**What was built** — 夸克一键安装 API+UI（失败回滚）；双端 Stitch 令牌；P4 密钥外置至 `~/.dsh-material-library/providers-secrets.json`；P3 `colors.js` 三层色彩 + `basic_color` 列 + color_style/flags 字典 + 可断点批处理 `scripts/run-colors.js`；P2 presets/process 已在库中（10 预设）。

**Verification** — quark-install 403/400/过期 CAC 回滚均通过；quark-status authorized；providers key 长度非空；colors 批处理 8 资产写入；presets=10；web vite build 成功；:30001/:30002 200。

**Journey log** — CAC 一次性用尽；tag_dict 列名是 dimension 非 dim；原始图多在 cache/originals；全量 VLM 重打标未跑（需预算）。

## [S1] Problem

1. PC 服务端（`:30001` Vue 控制台）与移动客户端（`:30002` `index.html` + uni-app）**未按昨日 Stitch 稿**落地，视觉与信息架构脱节。
2. 夸克 Skill 升级/授权需人工在 WSL 下载 zip + `login --token`，缺少**管理员一键：URL + CAC → 自动安装并授权**。
3. 《素材库四阶段改造》中 P2–P4 尚未在本仓库增量落地（P1 已在原 WSL 工程完成）。

## [S2] Design

### S2.1 设计令牌（Stitch Atelier Curate，双端同源）

| 令牌 | 移动端 | PC 服务端 |
|------|--------|-----------|
| primary | `#2563EB` | `#3B82F6` |
| page bg | `#F8FAFC` | `#0B1220` |
| surface | `#FFFFFF` / `#F1F5F9` | `#0F172A` / `#111827` |
| text | `#0F172A` / `#64748B` | `#E2E8F0` / `#94A3B8` |
| border | `#E2E8F0` | `#1E293B` |
| radius | card 12–14px，chip/button pill | 同左 |
| font stack | Inter + PingFang SC + system-ui | 同左 |

信息架构保持现网功能：浏览/筛选/详情/设置/同步管理；PC 保留素材检验、工作流、运行、模型、治理、设置。

### S2.2 移动端（index.html + uni-app）

- **index.html**（公网 `:30002` 实际入口）：登录/浏览/详情/设置/同步管理按 `m-*` 稿改 token 与布局密度（顶栏品牌、搜索胶囊、筛选 chip、双列卡片、详情 hero）。
- **uni-app `src/pages/*`**：与 index.html 共用同一套 CSS 变量与文案层级；不引入第二套视觉语言。
- 默认服务器 `http://127.0.0.1:30001`（本机）/ 可填公网 `http://39.107.120.55:30001`。

### S2.3 PC 服务端 web/

- 以 `style.css` + `App.vue` shell 为 token 源：深色底 `#0B1220`、侧栏 `#0F172A`、主色 `#3B82F6`、卡片 `#111827`。
- 素材网格卡片：圆角、标签行、画幅角标、相似/AI 角标对齐 `pc-assets` 稿密度。
- **不**重写业务路由；仅视觉层 + 设置页新增夸克安装区块。

### S2.4 夸克一键安装 API

`POST /api/auth/quark-install`（**admin only**）

请求：
```json
{ "url": "https://.../quarkclouddrive-x.y.z.zip", "code": "CAC-..." }
```

行为：
1. 校验 url 为 http(s)、code 匹配 `^CAC-[A-Za-z0-9-]+$`。
2. 下载 zip 到临时目录；校验 zip 可解压且含 `scripts/quark-drive.cjs` + `SKILL.md`。
3. 备份当前 CLI → 写入 `~/.agents/skills/quarkclouddrive` 与 `~/.claude/skills/quarkclouddrive`（**保留** `openclaw/`、`claudecode/` 配置目录）。
4. 以 `OPENCLAW_CLI=1` + `OPENCLAW_SERVICE_MARKER=openclaw` 执行 `login --token {code}`。
5. 成功：返回 `{success, authorized, nickname, version, cliPath}`。
6. 失败：**回滚**备份的 scripts，返回 `{success:false, error}`，旧 CLI 可用。

管理端 SettingsView：URL + 授权码输入、「安装并授权」按钮、结果区。

### S2.5 四阶段增量（P2–P4）

本轮可独立验收项：

| 项 | 范围 |
|----|------|
| P2 | 若 `src/process.js` + presets 已存在则验收 viewer process API；否则仅补契约文档与 mock 脚本说明，不阻塞 UI |
| P3 | **不**触发全量 ~5k VLM；仅保证 filter/dict 代码路径不破坏；字典种子接口若已存在则保留 |
| P4 | 服务端：providers 密钥外置（若 providers.js 仍明文）、删除已知死代码 require；**不**在本轮做全量重嵌入 |

## [S3] Out of Scope

- 不新建 git 仓库 / worktree（两目录均无 git）。
- 不执行全量 VLM 重打标、不重跑全量色彩管线。
- 不改 `/api/snapshot` 快照契约、不改治理状态机语义（P1 保持）。
- 不实现 ArkUI MaterialViewer 原生改动（本轮客户端为 H5/uni-app）。
- 不处理公网隧道拓扑本身（仅保证应用监听与 CORS）。

## Tasks

- [x] T1: 写入本 Spec 并确认令牌表 — acceptance: 本文件存在且 status=in-progress (covers: S2.1)
- [x] T2: `POST /api/auth/quark-install` + 回滚 + admin 校验 — acceptance: 无效 URL/非 admin 4xx；模拟 zip 失败不破坏现有 CLI (covers: S2.4)
- [x] T3: SettingsView 增加夸克安装表单调 T2 — acceptance: 填 URL+CAC 可提交并展示结果 (covers: S2.4)
- [x] T4: PC web style.css/App/Browse 视觉对齐 Stitch 深色 — acceptance: `:30001` 主色/底色/卡片圆角符合 S2.1 (covers: S2.3)
- [x] T5: AlbumSyncUniAppX index.html 视觉对齐 m-* Stitch — acceptance: `:30002` 浏览/登录/设置使用 S2.1 令牌 (covers: S2.2)
- [x] T6: uni-app pages 与 index.html 令牌一致 — acceptance: src/pages 主色 #2563EB、底 #F8FAFC (covers: S2.2)
- [ ] T7: P4 密钥外置/死代码（若命中）— acceptance: 无明文 key 写死于 src；npm test 或启动冒烟通过 (covers: S2.5)
- [x] T8: 验证清单 — acceptance: 服务 30001/30002 可访问；quark-status authorized；关键 curl 通过 (covers: S2.4)



