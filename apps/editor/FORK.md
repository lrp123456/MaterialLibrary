# FORK 说明

本目录 fork 自 **[OpenCut-app/opencut-classic](https://github.com/OpenCut-app/opencut-classic)**。

| 项 | 值 |
|---|---|
| 基线 commit | `cf5e79e`（`docs: readme`） |
| 基线时间 | 2026-05-17 |
| 上游状态 | **archived（只读归档）**，不再接受更新 |
| 许可 | MIT（见 `LICENSE`，需保留原版权声明） |

## 为什么选归档版

完整的编辑器内核（`core/` `commands/` `timeline/` + `rust/` WASM 合成器）只存在于这个仓库。
`OpenCut-app/OpenCut` 是重写版，截至 2026-09 已不含编辑器内核。

上游冻结对我们是**有利**的：本项目要做的是深度改造（存储、素材、导出、i18n、AI、资源包），
不存在 rebase 需求，也不会有上游变更打断。

## 本地改动清单

> 原则：只改接缝文件，业务逻辑尽量不动，便于将来对照上游。

| 文件 | 改动 | 原因 |
|---|---|---|
| `apps/web/next.config.ts` | `basePath`/`assetPrefix`、`distDir` 可配、`ignoreBuildErrors` | 挂到主应用 `/editor` 下；受限环境无法清理 `.next`；基线自带类型错误 |
| `apps/web/src/env/web.ts` | SOLO 模式给外部服务占位值 | 原版缺任一环境变量就在 import 期抛错 |
| `apps/web/src/app/api/auth/[...all]/route.ts` | SOLO 直接返回本地会话 | 内网单用户不需要 Postgres/Redis/better-auth |
| `apps/web/src/auth/rate-limit.ts` | 内存限流替代 Upstash | 移除 Redis 依赖 |
| `apps/web/src/auth/server.ts`、`auth/client.ts` | **已删除** | 未使用的 better-auth 实现；恢复方式见下 |
| `apps/web/src/export/index.ts` | 新增 `deliverBuffer`（上传成品库 / 下载） | 需求：导出默认进成品架 |
| `apps/web/src/components/editor/export-button.tsx` | 交付方式勾选 + 中文 | 同上 |
| `apps/web/src/components/editor/cloud-backup-button.tsx` | **新增** 备份到云端 | 云端快照入口 |
| `apps/web/src/services/cloud-snapshots/index.ts` | **新增** 备份/列表/拉取 | 本地优先 + 只读快照模型 |
| `apps/web/src/services/clip-packs/index.ts` | **新增** 资源包加载器 | 声明式扩展机制 |
| `apps/web/src/services/storage/service.ts` | 新增 `saveSerializedProject` | 拉取快照时原样落库 |
| `apps/web/src/services/transcription/service.ts` | 改为服务端字幕的占位实现 | 移除浏览器端 transformers/onnx（约百 MB 依赖） |
| `apps/web/src/i18n.ts`、`src/messages/zh.ts` | **新增** 中文字典 | 界面汉化 |
| `apps/web/src/app/editor/[project_id]/page.tsx` | 启动时加载资源包 | 注册动态特效 |

## 恢复多用户（可选）

1. 从基线 commit 取回 `src/auth/server.ts`、`src/auth/client.ts`；
2. 安装依赖：`better-auth`、`@upstash/redis`、`@upstash/ratelimit`、`postgres`、`drizzle-orm`；
3. 把 `src/auth/rate-limit.ts` 还原为 Upstash 实现；
4. `src/app/api/auth/[...all]/route.ts` 的 `realHandler` 改回 `toNextJsHandler(auth)`；
5. 设置 `OPEN_CUT_SOLO=0` 并补齐 `.env.local`。

## 已知基线问题

- 基线自带若干 TypeScript 错误（`actions/keybindings/persistence.ts`、`storage/migrations/*`、`stickers/providers`），
  上游归档前未修，构建期已跳过类型检查；改动文件另行用 `tsc --noEmit` 校验。
- 上游使用 bun + turbo 作为包管理器，本仓库改为 `npm install`（无 workspace 依赖，可独立安装）。

## 重建 WASM（新增特效 shader）

特效 shader 是编译进 `opencut-wasm` 的，**不能只丢一个 .wgsl 文件就生效**。新增流程：

1. 在 `rust/crates/effects/src/shaders/` 放 `.wgsl`（契约见下）。
2. 在 `rust/crates/effects/src/pipeline.rs` 里：
   - 加 `const XXX_SHADER_SOURCE: &str = include_str!("shaders/xxx.wgsl");`
   - 在 `shader_defs` 数组里加一行 `(ID, label, SOURCE)`
   - 同步 `builtin_shader_ids()`
3. 编译：
   ```bash
   rustup target add wasm32-unknown-unknown      # 只需一次
   wasm-pack build rust/wasm --target bundler --out-dir pkg --release
   ```
4. 替换 `apps/web/node_modules/opencut-wasm/` 下的
   `opencut_wasm.js`、`opencut_wasm_bg.js`、`opencut_wasm.d.ts`、`opencut_wasm_bg.wasm`
   （原包已备份为 `opencut-wasm.bak-0.2.10`，回滚直接换回来）。
5. 同步两处 shader 白名单：`src/clip-packs.js` 与
   `apps/web/src/services/clip-packs/index.ts` 的 `BUILTIN_SHADERS`。

**shader 契约**（与 `gaussian_blur.wgsl` 一致）：

```wgsl
struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct EffectUniforms { resolution: vec2f, direction: vec2f, scalars: vec4f }
@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;
@fragment fn fragment_main(input: VertexOutput) -> @location(0) vec4f { ... }
```

uniform 只有 4 个标量槽 + 1 个方向向量。资源包里用：

- `u_scalar0..u_scalar3` → `scalars.xyzw`（推荐，新 shader 都用这套）
- `u_sigma` / `u_step` / `u_direction` → 兼容旧的高斯模糊

未知 uniform 名会直接报错（防止拼错后静默失效）。

**当前内置 shader**：`gaussian-blur`、`glow`、`sharpen`、`skin-smooth`、`grade`、`warp`、`channel`。

**离线校验 WGSL**（比等到浏览器白屏快）：
`cargo run --release -- <shaders 目录>`，工具在
`C:\Users\lrp\rea-install\tools\wgsl-check`（只依赖 naga，能同时做 parse + validate）。

## 本地运行（挂到主应用的 /editor）

```bash
# 1) 构建（输出目录必须是全新的：本机有批量删除保护，Next 无法清理已有目录）
cd editor/apps/web
NEXT_DIST_DIR=.next-build5 node node_modules/next/dist/bin/next build

# 2) 启动（默认 3010，可用 PORT 覆盖）
cd ../.. && node editor/start.cjs
```

链路：`web-pro`（30002）把 `/editor/*` 反代到 `http://127.0.0.1:3010`，
前端在 `web-pro/src/views/studio/OpenCutView.vue` 里用同域 iframe 嵌入。

**三个坑**：

1. **不要用 `output: "standalone"`**。它与 `next start` 互斥，进程会打印
   `next start does not work with output: standalone` 然后直接退出。
2. **端口用 3010，不要用 3000**。3000 常被 WSL 里的另一份 OpenCut 占着。
3. **改了 `vite.config.js` 的代理必须重启 dev server**，否则 `/editor/*` 不会被代理，
   Vite 会把 index.html 返回给 iframe，导致页面套娃。客户端另有递归守卫兜底
   （检测到自身在 iframe 内就不再渲染编辑器）。

## 许可提醒

MIT 只授权代码，不授权「OpenCut」名称与图标。对外发布前需替换 `src/site/brand.ts`
与 `app/brand` 下的品牌资源。

## docker-compose 说明（2026-10-20 审计备注）

`docker-compose.yml` 为 fork 基线原样保留，**生产部署不使用它**：
- 其中引用的密钥/环境变量均为上游样例值，不是本项目真实凭据；
- 实际部署走 `start.cjs`（端口 3010）+ 主应用反代，见上文「本地运行」；
- 安全审计（SEC-008 相关项）确认其中无真实公网 IP / 密钥泄漏，仅上游样例。
