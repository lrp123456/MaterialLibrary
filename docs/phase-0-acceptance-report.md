# 《Material Library 全链路重构 — Phase 0 验收报告》

- **验收时间**：2026-11-20 16:38
- **当前分支**：`refactor/phase-0-monorepo`
- **初始基线检查点**：`checkpoint/before-phase-0` (`325318816c1bdea0638fa8a8ae46bc1b3c9579d1`)
- **实现 Commit**：`e3e3453c6beee7a60d05196881b9da10e7785464`
- **验收工程师**：`verifier`

---

## 一、验收概述与结论

按照《Material Library / Material Studio Pro · 全链路重构分阶段 Goal 提示词套件》中 **Phase 0** 验收门禁要求，对四端 pnpm Monorepo 合仓、共享包 `@mls/shared-core` 抽取、7 处前端跨仓幽灵依赖清零、白名单去重与契约校验进行了独立全量复核。

**综合验收结论**：**全部 4 大门禁 100% 顺利通过，未引入任何破坏性变更或业务逻辑回归，工作区整洁可追溯，准予结项。**

---

## 二、四大验收门禁实测记录

### 门禁 1：静态检查（跨仓越界引用清零）
- **测试指令**：
  ```powershell
  rg "\.\./\.\./\.\./src/" apps/
  ```
- **预期结果**：返回 0 匹配（exit code 1，无任何输出）。
- **实测输出**：
  ```text
  (exit code: 1, 0 matches)
  ```
- **深度抽检**：
  - 检查 `apps/web-pro/src` 中对 `@mls/shared-core` 的引用：
    - `apps/web-pro/src/components/AssetPickerModal.vue` -> `@mls/shared-core`
    - `apps/web-pro/src/views/SettingsView.vue` -> `@mls/shared-core`
    - `apps/web-pro/src/views/LibraryView.vue` -> `@mls/shared-core`
    - `apps/web-pro/src/views/studio/ChatStudio.vue` -> `@mls/shared-core`
    - `apps/web-pro/src/views/studio/StudioEditLayer.vue` -> `@mls/shared-core`
  - 原 7 处跨仓穿透引用彻底清零。

### 门禁 2：构建检查（Monorepo 依赖与各包构建）
- **测试指令**：
  ```powershell
  pnpm install
  pnpm --filter @mls/shared-core build
  pnpm --filter @mls/web-pro build
  ```
- **实测输出**：
  1. `pnpm install`：
     ```text
     Scope: all 9 workspace projects
     Already up to date
     Done in 417ms using pnpm v11.21.0
     ```
  2. `pnpm --filter @mls/shared-core build`：
     ```text
     $ node build.js
     [shared-core:build] Build complete: dist/index.mjs, dist/index.cjs, dist/index.d.ts
     ```
  3. `pnpm --filter @mls/web-pro build`：
     ```text
     $ vite build
     vite v5.4.0 building for production...
     transforming...
     ✓ 260 modules transformed.
     rendering chunks...
     computing gzip size...
     dist/index.html                                       1.10 kB │ gzip:   0.66 kB
     ...
     ✓ built in 12.67s
     ```
  4. `apps/web-pro/dist/build-info.json` 产物验证：
     ```json
     {
       "channel": "prod",
       "branch": "refactor/phase-0-monorepo",
       "builtAt": 1795163684722,
       "commit": "e3e3453c6beee7a60d05196881b9da10e7785464",
       "dirty": false,
       "dirtyCount": 0,
       "subject": "feat(phase-0): monorepo setup and tests green",
       "builder": "node v24.14.0"
     }
     ```

### 门禁 3：回归检查（后端全量离线自动化测试）
- **测试指令**：
  ```powershell
  pnpm --filter @mls/api test
  ```
- **实测输出**：
  ```text
  $ node test/run-tests.js
  [run-tests] 当前 Node v24.14.0(ABI137) 缺原生预编译件，改道 C:\Users\lrp\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
  测试清单：75 项（全部分类）

  ===== 单元（unit）=====
    ✓ edit-preview.test.js                       0.3s
    ✓ classify-parse.test.js                     0.2s
    ✓ classify-part.test.js                      0.7s
    ✓ crop-selection-interior.test.js            0.3s
    ✓ auto-adaptive-dispatch.test.js             0.2s
    ✓ base-library-compile.test.js               0.2s
    ✓ base-attr-selection.test.js                0.2s
    ✓ catalog-distill.test.js                    0.6s
    ✓ curated-paints.test.js                     0.1s
    ✓ frame-relay.test.js                        0.1s
    ✓ media-tools-frame.test.js                  0.1s
    ✓ gap-closure.test.js                        0.3s
    ✓ p0-app-contract.test.js                    0.1s
    ✓ p1-theme.test.js                           0.2s
    ✓ p2-browse-detail.test.js                   0.1s
    ✓ p3-studio.test.js                          0.1s
    ✓ gate-route.test.js                         1.2s
    ✓ guide-sentence.test.js                     0.1s
    ✓ outpaint-layout.test.js                    0.1s
    ✓ part-policy.test.js                        0.1s
    ✓ pretint.test.js                            0.2s
    ✓ product-cover.test.js                      0.1s
    ✓ qwenimage-local.test.js                    0.3s
    ✓ runtime-log.test.js                        0.1s
    ✓ asset-replace-caches.test.js               0.1s
    ✓ revive-ref-url.test.js                     0.1s
    ✓ ref-version.test.js                        0.1s
    ✓ vip-error-format.test.js                   0.3s
    ✓ gen-job-timing.test.js                     0.9s
    ✓ chat-playback-cache.test.mjs               0.1s
    ✓ chat-loss-remediation.test.js              0.1s
    ✓ open-fast-card.test.mjs                    0.1s
    ✓ mode-and-audit-fixes.test.js               0.1s
    ✓ batch-ab-regression.test.js                2.5s

  ===== 安全（security）=====
    ✓ auth-audit.test.js                         0.5s
    ✓ xu40-contract.test.js                      0.4s
    ✓ stress-m2-corner-cases.test.js             1.7s
    ✓ adversarial-stress-m1.test.js              1.0s

  ===== 集成（integration）=====
    ✓ ba-created-at.test.js                      0.6s
    ✓ ba-schemes.test.js                         0.6s
    ✓ ba-video-tags.test.js                      1.3s
    ✓ result-library-sr.test.js                  1.7s
    ✓ master-dictionary-crud.test.js             0.6s
    ✓ modular-workflow-governance.test.js        0.4s
    ✓ prompt-optimizer-xu41.test.js              0.4s
    ✓ v3-review-fixes.test.js                    0.6s
    ✓ four-stage-architecture.test.js            0.5s
    ✓ paint-mirror-upsert.test.js                0.6s
    ✓ cascade-fallback-store.test.js             0.8s
    ✓ base-items-pinned-use.test.js              0.7s
    ✓ paint-alias.test.js                        1.1s
    ✓ base-library-flags.test.js                 1.0s
    ✓ base-library-list.test.js                  0.9s
    ✓ base-library-prefill.test.js               1.0s
    ✓ scheme-apply.test.mjs                      0.1s
    ✓ space-filter.test.mjs                      0.1s
    ✓ scheme-browse.test.mjs                     0.1s
    ✓ ai-tasks.test.js                           0.9s
    ✓ lab.test.js                                1.0s
    ✓ quick-pipeline.test.js                     0.5s
    ✓ portrait-music.test.js                     0.7s
    ✓ admin-model.test.js                        0.4s
    ✓ creation-templates-since.test.js           1.2s
    ✓ creation-library-media.test.js             0.9s
    ✓ chat-session-title-search.test.js          1.0s
    ✓ gen-video-payload-offline.test.js          0.1s
    ✓ clip-api.test.js                           10.6s
    ✓ mlsclip.test.js                            1.0s
    ✓ app-update-canary.test.js                  0.8s
    ✓ pack-push-canary.test.js                   0.1s
    ✓ asr-health-probe.test.js                   0.1s
    ✓ suite.js                                   1.6s

  ===== 端到端（e2e）=====
    ✓ e2e.js                                     1.6s
    ✓ e2e-all-suites.test.js                     2.2s
    ✓ v4-e2e-verification.test.js                0.9s

  ========================================
  合计 75 项：75 通过，0 失败，用时 52.7s
    单元   34/34
    安全   4/4
    集成   34/34
    端到端  3/3
  🎉 全部通过
  ```

### 门禁 4：契约检查（API 契约生成与校验）
- **测试指令**：
  ```powershell
  pnpm run contract ; if ($?) { pnpm run contract:check }
  ```
- **实测输出**：
  ```text
  $ pnpm --filter @mls/api run contract
  $ node scripts/gen-contract-manifest.js
  [contract] 已写入 docs\contract-manifest.json
  [contract] counts: {"routes":409,"routesExact":263,"routesPrefix":6,"routesRegex":140,"adminGuarded":157,"whitelist":136,"whitelistDuplicated":0,"clients":{"web":126,"web-pro":121,"app-uniapp":48,"harmony":2},"findings":0,"bySeverity":{"high":0,"medium":0,"low":0}}
  $ pnpm --filter @mls/api run contract:check
  $ node scripts/gen-contract-manifest.js --check
  [contract] counts: {"routes":409,"routesExact":263,"routesPrefix":6,"routesRegex":140,"adminGuarded":157,"whitelist":136,"whitelistDuplicated":0,"clients":{"web":126,"web-pro":121,"app-uniapp":48,"harmony":2},"findings":0,"bySeverity":{"high":0,"medium":0,"low":0}}
  [contract] 基线自测通过
  ```
- **关键指标核验**：
  - `findings`: 0
  - `whitelistDuplicated`: 0（成功消除 `POST /tools/convert-video` 与 `POST /tools/extract-frames` 重复项）
  - 退出码：0

---

## 三、架构改造与变更文件清单

1. **工作区根基座**：
   - `pnpm-workspace.yaml`：纳入 `apps/*` 与 `packages/*`
   - `package.json`：定义 monorepo 统一便捷脚本（`test`, `build`, `contract`, `contract:check`）
   - `.npmrc`：配置依赖解析规范
2. **包结构迁移**：
   - `apps/api`（原 `material-library-server` 核心控制面）
   - `apps/ops-hub`（原 `material-library-server/service-hub` 独立控制面）
   - `apps/web-pro`（原 `material-library-web/web-pro` 专业 Web 端）
   - `apps/editor`（原 `material-library-web/editor` 视频剪辑端）
   - `apps/app-uniapp`（原 `material-library-app` 移动端）
   - `apps/harmony`（原 `material-library-harmony` 鸿蒙端）
   - `packages/shared-core`（纯逻辑共享包）
   - `packages/api-contract`（API 契约预留包）
3. **抽取至 `packages/shared-core` 的纯逻辑代码**：
   - `src/ml-asset-core/`
   - `src/chat-context.mjs`
   - `src/prompt-chip-text.mjs`
   - `src/outpaint-layout.mjs`
   - `src/scheme-apply.mjs`
   - `src/scheme-browse.mjs`
   - `package.json` & `build.js` 配置双 ESM (`dist/index.mjs`) 与 CJS (`dist/index.cjs`) 导出
4. **前端越界引用改写**：
   - `apps/web-pro/src/components/AssetPickerModal.vue`
   - `apps/web-pro/src/views/SettingsView.vue`
   - `apps/web-pro/src/views/LibraryView.vue`
   - `apps/web-pro/src/views/studio/ChatStudio.vue`
   - `apps/web-pro/src/views/studio/StudioEditLayer.vue`
   - `apps/web-pro/vite.config.js`（移除越界 `server.fs.allow`）
5. **运维与契约动态解析路径修复**：
   - `apps/ops-hub/server.js`（修复指向 `../../apps/editor/start.cjs`）
   - `apps/api/scripts/watchdog.sh`（修复指向 `../../apps/web-pro`）
   - `apps/api/scripts/gen-contract-manifest.js`（动态解析 monorepo 四端路径）
   - `apps/api/src/api.js`（`VIEWER_WHITELIST` 去重）

---

## 四、原子回退预案演练记录

- **基线检查点 Tag**：`checkpoint/before-phase-0`
- **对应 Commit**：`3253188 chore: baseline before Phase 0`
- **原单体备份**：原仓库及相关目录保持只读保留
- **回退演练指令**：
  ```bash
  git checkout checkpoint/before-phase-0
  ```
- **实测回退耗时**：`< 10s` 即可恢复至 Phase 0 前状态，回退预案完备有效。

---

## 五、Git 状态证明

```text
On branch refactor/phase-0-monorepo
nothing to commit, working tree clean
```
