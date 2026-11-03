# OpenCut 剪辑页「完全使用」接入实施方案

> 版本：v1.0（2026-10-20）
> 目标：把 OpenCut Classic 的剪辑页**整体**作为我们产品的剪辑板块使用——保留它的交互与渲染，把我们自己的登录、素材库、工程存储、成品架接上去。
> 前置结论：这条路可行（MIT + 自托管），但**不是"配置一下就能用"**。真正的工作量在四处：工程存储、素材注入、导出回收、汉化。

---

## 0. 先对齐一件事：你截图里跑的是哪个版本

截图 URL 是 `/projects/<uuid>`，而我手上的源码（`rea-install/analysis/opencut-classic`，commit `cf5e79e`）里编辑器路由是 **`/editor/[project_id]`**，`/projects` 只是工程列表页。

说明你跑的是一份**不同 commit**（很可能更新）。这不影响方案，但动手前必须先确认三处，否则后面全是白工：

| 要确认的 | 怎么查 |
|---|---|
| 编辑器路由 | `ls apps/web/src/app/projects/` 有没有 `[id]/page.tsx` |
| 存储实现 | `services/storage/service.ts` 里 `projectsAdapter` 是不是 `IndexedDBAdapter` |
| 导出出口 | `components/editor/export-button.tsx` 调的是不是 `downloadBuffer` |

本文按 `cf5e79e` 的代码结构写；若你的版本不同，按同样的"接缝"改即可。

---

## 1. 它现在的四个"不落地"之处

这些是"完全使用"必须先填的坑，全部有代码证据：

| # | 现状 | 证据 | 后果 |
|---|---|---|---|
| 1 | **工程存在浏览器 IndexedDB** | `services/storage/service.ts:60-70` 构造 `new IndexedDBAdapter()`；`db/schema.ts` 只有 users/sessions/accounts，**没有 projects 表** | 换浏览器/换机器/清缓存 = 工程全丢；无法备份、无法多端 |
| 2 | **素材存 OPFS 本地副本** | `services/storage/opfs-adapter.ts:11` `navigator.storage.getDirectory()` | 素材库里的资产进不来，只能手动上传 |
| 3 | **导出是浏览器下载** | `components/editor/export-button.tsx:132` → `export/index.ts:52-68` 创建 `<a download>` | 成片进不了我们的成品架；长片走 WebCodecs 有内存上限 |
| 4 | **英文硬编码、无 i18n** | 全仓无 `i18n/locale/messages`；文案直接写在 JSX 里 | 中文用户不可用 |

另外它默认还要 **Postgres（drizzle）+ Upstash Redis（限流）+ better-auth**——对内网自用是纯负担，应当直接摘掉。

---

## 2. 目标架构

```text
                    ┌─────────────────────────────────────────┐
  浏览器 :30002     │  web-pro (Vue 3 + Vite)                  │
                    │  /            → 现有素材库/创作页         │
                    │  /editor/*    → 反代到 OpenCut (3000)     │
                    └───────────────┬─────────────────────────┘
                                    │ 同域，共享 localStorage.ml_token
                    ┌───────────────▼─────────────────────────┐
                    │  OpenCut (Next.js, :3000)                │
                    │  改动点：                                 │
                    │   ├ HttpProjectsAdapter  ──┐              │
                    │   ├ LibraryMediaBridge   ──┤              │
                    │   ├ export → upload      ──┤              │
                    │   └ 汉化 / 去品牌         │              │
                    └───────────────────────────┼──────────────┘
                                                │
                    ┌───────────────────────────▼──────────────┐
                    │  server.js (:30001)                       │
                    │  /editor-api/projects  (已有, rev 乐观锁)  │
                    │  /api/viewer/assets/:fid/file (已有)      │
                    │  /api/.../(成品入库)                       │
                    └──────────────────────────────────────────┘
```

关键取舍：**同源**。OpenCut 挂到 30002 的 `/editor` 子路径下，才能直接读 `localStorage.ml_token`、直接调我们的 `/api`，不用跨域、不用再造一套登录。

---

## 3. 六个工作包

### P1 · 挂载与路由（0.5–1 天）

**方式 A（最快，推荐先做）**：OpenCut 跑 30003，Vue 壳里 `<iframe>` 嵌 `/editor`，用 `postMessage` 传 token 与素材库筛选条件。
- 优点：零改造，当天能点。
- 缺点：地址栏不同源、剪贴板/拖拽受限、体验割裂。

**方式 B（正式，推荐）**：同域反代。

1. OpenCut 的 `apps/web/next.config.*` 加：
   ```js
   basePath: '/editor',
   assetPrefix: '/editor',
   output: 'standalone',
   ```
2. 我们 `web-pro/server.cjs` 增加代理（照抄现有 `/api` 那段）：
   ```js
   if (pathname === '/editor' || pathname.startsWith('/editor/')) {
     return proxyRequest(req, res, 'http://127.0.0.1:3000');
   }
   ```
   > 注意：`/editor-api` 已经代理到 30001，`/editor` 不能写成 `startsWith('/editor')` 否则会把 `/editor-api` 一起吃掉。必须判断 `/editor` 精确或 `/editor/` 前缀。
3. Next 侧 `next build && next start -p 3000`，由我们的启动脚本一并拉起（三个进程：30001 后端、30002 前端、3000 编辑器）。

**验收**：`http://<host>:30002/editor/projects` 能打开工程列表，静态资源 200，刷新不 404。

---

### P2 · 摘掉 Postgres / Redis / better-auth（0.5 天）

内网单用户场景没有必要跑数据库和 Redis。

做法：加环境开关 `OPEN_CUT_SOLO=1`，在 `auth/server.ts`、`auth/rate-limit.ts` 的最前面短路：

```ts
export const checkRateLimit = async () => ({ success: true, limited: false });
```

`auth/client.ts` 的 `useSession` 返回固定的本地用户；所有 `if (!session) redirect('/login')` 的分支跳过。

⚠️ 不要删 `db/`，`drizzle` 的 schema 与 `db/index.ts` 还有引用；用 `if (process.env.OPEN_CUT_SOLO) return null` 这类早退最省事。

**若要保留多用户**：不摘，改为把 Postgres/Redis 用 Docker 起在同一台机器（`docker-compose.yml` 已有），代价是运维面变大、与我们的 SQLite 用户体系割裂（两套账号）。

**验收**：清空 cookie 直接访问 `/editor/projects`，不跳登录页。

---

### P3 · 素材库打通（2–4 天，**体验分水岭**）

目标是让剪辑页左侧的 Media 面板直接列出我们素材库的资产，点一下就能上时间轴。

**接缝**：`media/types.ts` 的 `MediaAsset = { file: File; url?: string }`，导入走 `media/processing.ts:85 processMediaAssets({ files, ... })`。

**做法**：新增一个面板入口 `components/editor/panels/assets/library-tab.tsx`：

```ts
// 1. 拉我们的素材列表
const res = await fetch('/api/viewer/assets?kind=video&limit=60', {
  headers: { Authorization: `Bearer ${localStorage.getItem('ml_token')}` },
});
const { items } = await res.json();

// 2. 选中后下载成 File，走它原有的处理链（自动进 OPFS + 生成缩略图/波形）
const blob = await (await fetch(`/api/viewer/assets/${fid}/file`, { headers })).blob();
const file = new File([blob], item.file_name, { type: item.mime });
await processMediaAssets({ files: [file], ... });
```

**不建议**改 `MediaAsset` 让它只存远程 URL：渲染器读的是 `asset.file`（`OffscreenCanvas` 上传纹理、`mediabunny` 解码都依赖 File/Blob），改成 URL 要动 `services/video-cache`、`media/mediabunny.ts`、合成器纹理上传三处，且远程地址还要处理鉴权与 Range 请求。成本高、收益低。

**代价**：素材会**复制一份进 OPFS**。10 分钟 4K 素材约 3–5 GB，OPFS 配额通常可用但需要提示用户清理。可以在导入完成后面板显示"本地副本占用 X GB"+ 一键清理。

**验收**：从素材库勾选 3 个视频 → Media 面板出现缩略图 → 拖上时间轴 → 预览可播。

---

### P4 · 工程存回服务端（1–2 周，**最大工作量**）

**接缝**：`StorageService` 的所有工程操作都只依赖 adapter 的五个方法。照 `indexeddb-adapter.ts` 写一个 HTTP 版即可。

```ts
// services/storage/http-projects-adapter.ts
export class HttpProjectsAdapter {
  private base = '/editor-api/projects';
  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('ml_token') || ''}`,
    };
  }
  async list() { /* GET  → items.map(i => i.id) */ }
  async get(key) { /* GET :id → JSON.parse(project.data) */ }
  async getAll() { /* GET 列表（或并发 get） */ }
  async set(key, value) { /* PUT :id，带 rev（我们已有乐观锁） */ }
  async remove(key) { /* DELETE :id */ }
  async clear() { /* 不实现，或明确拒绝 */ }
}
```

然后在 `StorageService` 构造函数里按环境切换：

```ts
this.projectsAdapter = process.env.NEXT_PUBLIC_PROJECT_STORE === 'server'
  ? new HttpProjectsAdapter()
  : new IndexedDBAdapter('opencut-projects', 'projects');
```

四个必须处理的细节：

1. **序列化格式**：`SerializedProject` 是 OpenCut 自己的结构，`saveProject()` 里会算 `duration` 并写 `metadata`。直接整体塞进我们 `editor_projects.data` 即可（我们的表就是整份 JSON）。但**不要**和现有 `proj_*` 工程混用同一张表的 id 空间——OpenCut 的 id 形如 `fe9457-d8a1-...`，不是 `proj_` 前缀。加一列 `kind`（`native` / `opencut`）区分，或单独建 `opencut_projects` 表。
2. **rev 乐观锁**：我们后端 PUT 支持 `If-Match`，adapter 要把 rev 缓存起来并在 409 时抛错，否则多标签页会静默覆盖。
3. **迁移**：`services/storage/migrations` 有版本迁移；从 IndexedDB 切到服务端时，`version` 字段要保持连续，否则 `runStorageMigrations` 会重跑。
4. **媒体资产仍在 OPFS**：`saveMediaAsset` 是另一套 adapter（`mediaAdapter`）。P4 只解决"工程定义"，**素材副本还是本地的**。跨机器打开工程会缺素材（缩略图在、文件不在）。要么接受（内部单机使用），要么 P4+ 把素材也传我们的对象存储——那是另一个 3–5 天。

**验收**：在 A 机器保存工程 → B 机器登录同账号打开 → 时间线结构一致（素材若未同步会有缺失提示）。

---

### P5 · 导出回成品架（2–3 天）

**接缝**：`export/index.ts:52 downloadBuffer({ buffer, filename, mimeType })`。

改造为双出口：

```ts
export async function deliverBuffer({ buffer, filename, mimeType, mode }) {
  if (mode === 'download') return downloadBuffer({ buffer, filename, mimeType });
  const blob = new Blob([buffer], { type: mimeType });
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('shelf', 'finished');
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('ml_token')}` },
    body: form,
  });
  return res.json(); // { fid, url }
}
```

导出按钮旁边加一个"导出到素材库"的选择（或直接默认）。

**两个必须知道的上限**：

- OpenCut 导出在**浏览器内**完成（`SceneExporter` + mediabunny/WebCodecs），内存随分辨率×时长线性涨。1080p/60s 没问题，**10 分钟以上或 4K 大概率 OOM**。
- 它的音频混音是浏览器侧实现，**不支持我们现有服务端 ffmpeg 的 `adelay/amix/atrim` 多轨精细控制**（淡入淡出、变速变调这类参数粒度会变粗）。

**如果这两点是硬需求**：保留我们自己的导出链路，让 OpenCut 只做"预览与编辑"，导出仍旧走"逐帧上传 + 服务端 ffmpeg"。但那需要把 OpenCut 的合成结果按帧取出——技术上可行（`getCompositorCanvas()` 读像素），工程量约 +1 周。

---

### P6 · 汉化与品牌（3–5 天）

它**完全没有 i18n 基础设施**，文案散在 JSX 里。三条路：

| 方案 | 工作量 | 效果 |
|---|---|---|
| **A. 只翻高频界面**（工具栏、面板标题、右键菜单、导出弹窗，约 200–300 条） | 3 天 | 80% 场景中文，长尾仍英文 |
| **B. 引入 next-intl，抽全量字符串**（约 2,000–3,000 条） | 2 周 | 完整，但改动面覆盖所有组件，后续跟进上游变难 |
| **C. 运行时字典替换**（DOM 后处理） | 1 天 | 快但脆，动态内容翻不到，不推荐 |

推荐 **A**，且用 `messages/zh.ts` 集中管理，组件里 `t('transform.width')` 替换字面量——以后要补全只需往字典加键。

品牌：MIT 只授权**代码**，不授权**名称与图标**。要去掉 OpenCut logo/名称，改成我们的；`app/brand` 与 `components/editor/editor-header.tsx` 是入口。

---

## 4. 动手前先做三个验证（各半天，失败就改路线）

| 验证 | 方法 | 失败意味着 |
|---|---|---|
| **V1 同域 basePath 能否跑通** | 按 P1 方式 B 改 `basePath:'/editor'`，`next build && next start`，从 30002 访问 | 不能 → 退回 iframe（方式 A），接受体验割裂 |
| **V2 WebGPU 在目标机器可用** | 在目标浏览器控制台 `!!navigator.gpu`；再看 `opencut-wasm` 是否走 WebGL 回退 | 全不可用 → OpenCut 预览会黑，整条路线作废（我们现有 Canvas2D 反而更稳） |
| **V3 OPFS 配额** | `navigator.storage.estimate()`，看 quota 与实际可用 | 配额太小 → 素材副本策略改成"引用 + 按需缓存" |

V2 最容易被忽略但最致命：**OpenCut 的渲染内核是 wgpu（WebGPU 优先、WebGL 回退）**。如果目标用户里有旧显卡/远程桌面/虚拟机，要实测。

---

## 5. 工作量与风险

| 工作包 | 乐观 | 保守 | 风险 |
|---|---|---|---|
| P1 挂载 | 0.5 天 | 1 天 | Next 静态资源 404 |
| P2 去外部依赖 | 0.5 天 | 1 天 | better-auth 的 middleware 遍布全站 |
| P3 素材打通 | 2 天 | 4 天 | OPFS 体积、缩略图生成耗时 |
| P4 工程上云 | 1 周 | 2 周 | 序列化格式漂移、rev 冲突 |
| P5 导出回收 | 2 天 | 3 天 | 长片 OOM、音频粒度退化 |
| P6 汉化+品牌 | 3 天 | 5 天 | 上游更新后文案对不上 |
| **合计** | **≈2.5 周** | **≈4.5 周** | |

**其他风险**

| 风险 | 说明 | 缓解 |
|---|---|---|
| 上游演进快 | OpenCut 更新频繁，我们一 fork 就进入"跟进上游"的长期成本 | 只改接缝文件，业务逻辑不碰；定期 rebase |
| 设计体系割裂 | 它的视觉是它自己的（shadcn + Tailwind），与我们暖纸工业风完全不同 | 要么接受（剪辑页自成一块），要么只改 token（`globals.css` 的 CSS 变量），别改结构 |
| 双编辑器并存 | 我们现有 `ClipStudio.vue` 与它功能重叠 | 明确二选一，别两边都维护；建议按工包迁移、迁完即删旧页 |

---

## 6. 一句话取舍

**"完全使用 OpenCut" 是可行的，最省事的形态是"同域子应用 + 三处接缝（素材、工程、导出）"。**

但要接受三个既成事实：

1. 上一轮做的 `clip-editor-v2.html` / `create-param-v2.html` 两份设计稿，在剪辑页这一块**作废**（创作页参数面板不受影响，仍可沿用）。
2. 工程从服务端 SQLite 变成"服务端定义 + 本地素材副本"的混合形态，**跨机器不完整**。
3. 导出从服务端 ffmpeg 退回浏览器 WebCodecs，**长片与多轨音频精度退化**。

如果这三条里有一条不能接受，那就该回到上一份评估里的 **L0 路线**（只换渲染器、保留我们自己的 UI 与导出），代价是小 10 倍但要自己继续写编辑器交互。
