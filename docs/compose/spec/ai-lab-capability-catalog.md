---
feature: ai-lab-capability-catalog
status: delivered
updated: 2026-02-14
branch: inplace-no-git
commits: n/a
---

# AI 试验场：能力目录 + 动态入口

## Report

**What was built** — 管理端新增「AI 试验场」：`GET /api/lab/capabilities` 按 Umbra / 统一网关 / 生成适配器三套后端的配置状态动态给出 15 个内置入口（扩图、增/删/改、超分、漫游、网关扩图/画幅/去水印/超分/视频、生图/生视频），未就绪置灰并带原因。`POST /api/lab/runs` 统一提交并路由到既有 `ai-tasks` / `process` / `executeAdapter`；`GET /api/lab/runs/:engine/:runId` 轮询；另补 `GET /api/process/jobs/:id`。前端 `LabView.vue` 按目录动态渲染分组入口卡片、schema 表单、源素材选择与结果预览。

**Verification** — WSL `node test/lab.test.js` 全绿（15 入口、就绪探测、submit 校验、umbra/gateway 路由）；`node test/ai-tasks.test.js` 全绿；`web` vite build 成功；线上冒烟：admin 登录后 `capabilities` 返回 15 entries，umbra/gateway/gen 均 ready。`test/suite.js` 中 `local_feature_v2` vs `local_semantic_hash_v1` 为 **PRE-EXISTING**，与本改动无关。

**Journey log** — 本目录非 git，沿用 `inplace-no-git`；better-sqlite3 仅 WSL 可跑；migrate 种子自带 `unified_gateway` base_url，按现有 `isGatewayConfigured` 视为已配置；独立评审无 critical，已修 major：gen 可选源图 UI、adapter kind 校验、预览 URL 补 token / API_BASE 改写、视频结果用 `<video>`。模型下拉仍为文本输入（动态 models 清单可后续接 `/models`）。

## [S1] Problem

服务端已有三套 AI/媒体能力，但入口分散、前端不可发现：

1. **Umbra AI 任务**（`/ai/tasks`）：扩图 / 增 / 删 / 改 / 超分 / 空间漫游；Harmony 客户端可用，PC 管理端无入口。
2. **统一网关 process**（`/assets/:fid/process` + presets）：去水印、画幅转换、扩图、超分、视频转码/抽帧/图生视频；管理端无测试页。
3. **生成适配器**（`gen_adapters` + `/adapters/test`）：文生图 / 文生视频；仅有简单 prompt 测试，无法选源图、比例、模型。

管理端需要一个「AI 试验场」：向服务端询问**当前有哪些工作流/能力可用**，并**按配置动态渲染**可测入口（就绪高亮、未配置置灰），覆盖扩图、增删改元素、生图、生视频等。

## [S2] Design

### S2.1 能力目录 API

`GET /api/lab/capabilities`（**admin**）

返回：

```json
{
  "engines": {
    "umbra": { "ready": true, "reason": null },
    "gateway": { "ready": false, "reason": "unified_gateway 未配置" },
    "gen": { "ready": true, "imageAdapters": [...], "videoAdapters": [...] }
  },
  "groups": [
    { "id": "image_edit", "label": "图片精修" },
    { "id": "generate", "label": "生成" },
    { "id": "video", "label": "视频" }
  ],
  "entries": [
    {
      "id": "umbra.expand",
      "engine": "umbra",
      "group": "image_edit",
      "label": "智能扩图",
      "description": "四向物理画幅扩展",
      "ready": true,
      "unavailableReason": null,
      "requiresAsset": true,
      "multiAsset": false,
      "maxAssets": 1,
      "fields": [
        { "name": "expand_ratio", "label": "目标画幅", "type": "select", "options": ["16:9","9:16","1:1","4:3","3:4"], "default": "16:9", "required": true }
      ],
      "submit": { "path": "/lab/runs", "method": "POST" }
    }
  ]
}
```

**就绪判定**

| 引擎 | ready 条件 |
|------|-----------|
| umbra | `umbra_token` 非空，且按 entry 所需 template 已配（touch / walkthrough） |
| gateway | `gen_adapters.unified_gateway` enabled 且 `base_url` 有效（复用 `isGatewayConfigured`） |
| gen.image | 至少一个 enabled 且 `kind='image'` 且 base_url 有效的 adapter |
| gen.video | 同上，`kind='video'` |

未就绪 entry 仍返回，但 `ready=false` + `unavailableReason`，前端置灰。

### S2.2 内置入口清单

**image_edit / umbra**（需源素材；需 touch 模板）

| id | label | fields |
|----|-------|--------|
| `umbra.expand` | 智能扩图 | `expand_ratio` select |
| `umbra.remove` | 精准消除 | `bbox` text（x1,y1,x2,y2，可选） |
| `umbra.insert` | 透视安装 | `bbox` 或 `perspective_quad` text（可选） |
| `umbra.replace` | 物品替换 | `bbox` text（可选） |
| `umbra.upscale` | 高清放大 | 无 |

**video / umbra**

| id | label | fields |
|----|-------|--------|
| `umbra.spatial_walkthrough` | 空间漫游成片 | `camera_style` text, `aspect_ratio` select, `scene_duration` number；`multiAsset` 2–6 |

**image_edit / gateway**（需源素材 + 网关）

| id | action | fields |
|----|--------|--------|
| `gateway.outpaint` | 网关扩图 | `ratio` select, `extend_side` select |
| `gateway.ratio_convert` | 画幅转换 | `target` select |
| `gateway.watermark_remove` | 去水印 | 无 |
| `gateway.upscale` | 超分放大 | `scale` select 2/4 |

**video / gateway**

| id | action | fields |
|----|--------|--------|
| `gateway.video_transcode` | 视频转码 | `codec` select, `crf` number |
| `gateway.video_frames` | 视频抽帧 | `count` number |
| `gateway.video_generate` | 网关图生视频 | `prompt` text, `duration` number, `aspect` select |

**generate / gen**（源素材可选）

| id | kind | fields |
|----|------|--------|
| `gen.image` | image | `prompt` required, `model` select(动态), `ratio` select, `adapterId` select(动态), 可选 `fid` 当图生图 |
| `gen.video` | video | `prompt` required, `model`, `ratio`, `duration`, `adapterId` |

### S2.3 统一提交 / 轮询

**提交** `POST /api/lab/runs`（admin）

```json
{
  "entryId": "umbra.expand",
  "fid": "local_xxx",
  "fids": ["local_a", "local_b"],
  "params": { "expand_ratio": "16:9" }
}
```

路由到既有引擎，**不复制业务逻辑**：

| engine | 动作 | 返回 |
|--------|------|------|
| umbra | `aiTasks.enqueueAiTask` | `{ engine:'umbra', runId: taskId, mode:'async' }` |
| gateway | `processSvc.enqueueProcessJob` | `{ engine:'gateway', runId: String(job.id), mode:'async' }` |
| gen | `executeAdapter`（同步或 async 轮询内完成） | `{ engine:'gen', mode:'sync', status:'done'\|'failed', result }` |

**轮询** `GET /api/lab/runs/:engine/:runId`（admin）

| engine | 查询 |
|--------|------|
| umbra | `getAiTask` → status/progress/error + 成功时 output_kind/derivative |
| gateway | `getProcessJob` → status/progress/derivativeId/error |
| gen | 仅 sync 任务；返回上次结果缓存或 404（gen 同步返回，一般不再轮询） |

**进程任务单查** 同时补 `GET /api/process/jobs/:id`（admin），试验场与运维共用。

### S2.4 前端「AI 试验场」

新路由 `/lab`（admin），`web/src/views/LabView.vue`：

1. 进入页 `GET /lab/capabilities`。
2. 左侧/顶部按 `groups` 分组渲染 entry 卡片：就绪主色、未就绪置灰并显示 `unavailableReason`。
3. 选中 entry 后：
   - 若 `requiresAsset`：素材选择器（最近 ready 图/视频，walkthrough 可多选）。
   - 按 `fields` schema 动态表单（select/text/number）。
   - `gen.*` 额外渲染动态 adapter/model 下拉（来自 capabilities）。
4. 提交 → `POST /lab/runs` → 轮询 `GET /lab/runs/:engine/:runId`（async）或直接展示 sync 结果。
5. 结果区：预览图/视频（`previewUrl` / 素材 image 直链）、错误信息、再测按钮。

导航：`App.vue` 侧栏「AI 试验场」（icon: `science`），路由 `requiresAdmin`。

### S2.5 边界与错误

- 非 admin → 403。
- entry 不存在 / 未就绪 → 400，带 `unavailableReason`。
- 缺 fid（requiresAsset）→ 400。
- walkthrough 源图 <2 或 >6 → 400。
- 网关/Umbra/生成适配器底层失败：async 落 failed，sync 返回 `{status:'failed', error}`；HTTP 仍 200 带 success 标记，与现有 process/ai-tasks 风格一致。

## [S3] Out of Scope

- 不改 Harmony App / viewer 白名单契约。
- 不做新模型接入或 adapter 配置向导（仍用「模型与供应商」页）。
- 不做 lab_runs 独立历史表；试验场展示「当前这次」运行结果 + 可复用既有任务 ID。
- 不自动触发产线默认工作流重跑。

## Tasks

- [x] T1: 实现 `src/lab.js` 能力目录 + 就绪探测 + 统一 submit/status — acceptance: `getCapabilityCatalog` 返回三套引擎 entries；`submitLabRun` 能路由到 umbra/gateway/gen (covers: S2.1, S2.2, S2.3)
- [x] T2: `src/api.js` 挂载 `/lab/capabilities`、`/lab/runs`、`/lab/runs/:engine/:runId`、`GET /process/jobs/:id` — acceptance: admin 可调通；viewer 403 (covers: S2.3, S2.5; depends: T1)
- [x] T3: 前端 `LabView.vue` + 路由 + 导航 + api 封装 — acceptance: 页面按目录动态渲染入口，可提交并轮询结果 (covers: S2.4; depends: T2)
- [x] T4: 单测 `test/lab.test.js` 覆盖目录结构与 submit 校验 — acceptance: `node test/lab.test.js` 通过 (covers: S2.1, S2.5; depends: T1)
