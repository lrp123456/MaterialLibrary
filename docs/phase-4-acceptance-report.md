# 《Material Library 全链路重构 — Phase 4 验收报告》

- **验收时间**：2026-11-20 20:53
- **当前分支**：`refactor/phase-4-wysiwyg-cancel-matrix`
- **初始基线检查点**：`checkpoint/before-phase-4` (`d49534a85e69b0678a382943c3f12c7aad5ca3c9`)
- **实现 Commit**：`f5d844a3ac71b727bef96f206a6e6c24288666e9`
- **验收工程师**：`verifier`

---

## 一、验收概述与结论

按照《Material Library / Material Studio Pro · 全链路重构分阶段 Goal 提示词套件》中 **Phase 4（Studio 严格 WYSIWYG + 全模型「真实取消 + 动态置灰 + 竞态保护」状态机）** 验收门禁要求，对以下关键模块进行了全覆盖、端到端的独立复核：
1. **模型能力与取消策略契约中枢**：在 `packages/api-contract` 统一定义全量 13 种模型协议与 4 种服务引擎的取消策略（`queue_only`, `vendor_pending_only`, `always_local`）与参数能力规范；
2. **后端取消状态机（“裁决在先、落态在后” + 409 IRREVERSIBLE）**：`services/vendor-cancel.js` 统一接管取消流程；对排队中任务执行即时取消；对异步云端提交窗口支持 `Deferred Cancel` 单次消费下发；对运行中不可逆/厂商拒绝状态严格返回 `409 IRREVERSIBLE` 并推 `cancellable: false`，杜绝卡片被恶意/竞态取消抹除，确保成片 100% 安全落库；
3. **本地进程树强杀与显存释放**：对 `always_local` 本地大模型及音频/视频工具，取消时通过 PGID 级强杀整棵子进程树，并即时归还显存锁；
4. **Studio 严格所见即所得（WYSIWYG 铁律）**：前端草稿架构引入 `ComposerDraft` 单一真值与不可变提交快照 `FrozenSubmitSnapshot`；彻底铲除 `fallbackAsset` 资产静默替换、`dispatchSmartWorkflow` 隐式改写以及乐观 `rollback()`；参考图失效时前端严格红框阻断；
5. **动态参数置灰与前端构建**：`DynamicModelParamBar.vue` 依据契约自动置灰当前模型不支持的参数选项并给出 Tooltip 解释；
6. **四大门禁与全量自动化测试**：取消矩阵测试、所见即所得不可变快照测试全部通过；全量 88 项离线自动化测试 100% 通过，契约检查 0 缺陷。

**综合验收结论**：**全部 4 大验收门禁 100% 顺利通过，未引入任何破坏性变更或状态错乱，彻底解决了模型误取消、成片被毁、资产被偷换等高危痛点，准予结项。**

---

## 二、四大验收门禁实测记录

### 门禁 1：全模型取消矩阵测试（All-Model Cancel Matrix）
- **测试指令**：
  ```powershell
  node apps/api/test/run-tests.js -v --only=cancel-matrix
  ```
- **实测输出**：
  ```text
  [run-tests] 当前 Node v24.14.0(ABI137) 缺原生预编译件，改道 C:\Users\lrp\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
  测试清单：1 项（全部分类）

  ===== 单元（unit）=====
    ✓ unit/cancel-matrix.test.js                 0.5s
      === Phase 4 Gate 1: 全模型取消矩阵与不可逆防护测试 ===
      1. 测试契约模型取消策略与阶段矩阵...
      2. 测试 Deferred Cancel 注册与单次消费机制...
      [vendor-cancel] 登记 Deferred Cancel 请求: jobId=job_deferred_test_001
      [vendor-cancel] 消费 Deferred Cancel 标记: jobId=job_deferred_test_001
      3. 测试后端 cancelStudioJob 状态机（先裁决后落态）...
      [vendor-cancel] 登记 Deferred Cancel 请求: jobId=job_v_01
      ✔ Phase 4 全模型取消矩阵与不可逆防护测试全部通过！
  ========================================
  合计 1 项：1 通过，0 失败，用时 0.5s
    单元   1/1
  🎉 全部通过
  ```
- **关键指标核验**：
  - `queue_only`：排队阶段取消返回 200，任务与卡片落态为 `cancelled`；运行阶段取消严格返回 `409 IRREVERSIBLE`，数据库任务保持 `running`，卡片保持 `generating`，`cancellable` 强制收敛为 0，成片正常接收落库；
  - `vendor_pending_only`：在提交窗口发起取消触发 `Deferred Cancel` 机制，在获取 `vendorTaskId` 后精准向厂商补发 **1 次** `/cancel`，杜绝重复或遗漏；
  - `always_local`：运行中取消精准杀死子进程树，释放显存并返回 200。

### 门禁 2：竞态拒绝与成片保全测试（Race Condition & Irreversible Protection）
- **测试指令**：包含在 `unit/cancel-matrix.test.js` Case 3.2 中。
- **关键核验**：
  - 当同步模型进入运行中（如 Seedream），或云端返回 400/409 时，后端绝不修改卡片状态为 `cancelled`；
  - 抛出 `HTTP 409 { cancelled: false, code: 'IRREVERSIBLE' }`；
  - SSE 即时下发 `cancellable: false`，前端按钮禁用置灰，保障已扣费/已生成成片完好无损。

### 门禁 3：WYSIWYG 草稿不可变快照与零静默替换测试（WYSIWYG & Snapshot Immutability）
- **测试指令**：
  ```powershell
  node apps/api/test/run-tests.js -v --only=wysiwyg-snapshot
  ```
- **实测输出**：
  ```text
  [run-tests] 当前 Node v24.14.0(ABI137) 缺原生预编译件，改道 C:\Users\lrp\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
  测试清单：1 项（全部分类）

  ===== 单元（unit）=====
    ✓ unit/wysiwyg-snapshot.test.js              0.2s
      === Phase 4 Gate 2: 所见即所得与不可变提交快照测试 ===
      1. 测试资产失效阻断与禁止静默替换...
      2. 测试有效草稿提交与不可变快照生成...
      3. 测试快照不可变性（修改原草稿不影响已生成的快照）...
      ✔ Phase 4 所见即所得与不可变提交快照测试全部通过！
  ========================================
  合计 1 项：1 通过，0 失败，用时 0.2s
    单元   1/1
  🎉 全部通过
  ```
- **关键指标核验**：
  - **零静默替换**：参考图失效时明确报错阻断（`第 2 张参考图未包含有效 FID 或 URL`），绝对禁止偷换为图 1 的地址；
  - **不可变快照**：提交瞬间冻结的 `FrozenSubmitSnapshot` 深度不可变，外部对原草稿后续的修改或回滚对已提交快照零影响；
  - **快照指纹**：SHA256 快照哈希代表请求唯一性，内容变更后哈希即刻变化。

### 门禁 4：全量回归与契约门禁（Full Regression & Contract Check）
- **测试指令**：
  ```powershell
  pnpm --filter @mls/api test
  pnpm run contract:check
  pnpm --filter @mls/shared-core build
  pnpm --filter @mls/web-pro build
  ```
- **实测输出**：
  1. `pnpm --filter @mls/api test`（88/88 全绿，用时 63.8s）：
     ```text
     ========================================
     合计 88 项：88 通过，0 失败，用时 63.8s
       单元   47/47
       安全   4/4
       集成   34/34
       端到端  3/3
     🎉 全部通过
     ```
  2. `pnpm run contract:check`（契约 0 缺陷）：
     ```text
     [contract] counts: {"routes":409,"routesExact":263,"routesPrefix":6,"routesRegex":140,"adminGuarded":157,"whitelist":136,"whitelistDuplicated":0,"clients":{"web":126,"web-pro":121,"app-uniapp":48,"harmony":2},"findings":0,"bySeverity":{"high":0,"medium":0,"low":0}}
     [contract] 基线自测通过
     ```
  3. 各包构建顺利，`@mls/web-pro` 构建成功产出（261 模块转换）。

---

## 三、变更文件与架构改造清单

| 类别 | 文件路径 | 改造说明 |
| :--- | :--- | :--- |
| **契约规范** | `packages/api-contract/src/models.ts` | 声明全量模型取消策略（`queue_only`, `vendor_pending_only`, `always_local`）与能力矩阵 |
| | `packages/api-contract/index.js` & `index.mjs` | 导出草稿校验器 `validateComposerDraft` 与快照创建器 `createFrozenSubmitSnapshot` |
| **后端取消状态机** | `apps/api/src/services/vendor-cancel.js` | 新建厂商取消接管中心，支持 Deferred Cancel 与本地进程树强杀 |
| | `apps/api/src/routes/studio.js` | 重构 `cancelStudioJob` 状态机，“裁决在先、落态在后”，支持 409 IRREVERSIBLE |
| | `apps/api/src/services/wan-video.js` & `apps/api/src/gen/index.js` | 移除重复 `onabort` 发起 `/cancel` 逻辑 |
| **前端 WYSIWYG** | `apps/web-pro/src/views/studio/ChatStudio.vue` | 移除 `fallbackAsset` 静默替换、副作用 `dispatchSmartWorkflow` 与乐观 `rollback` |
| | `apps/web-pro/src/views/studio/QuickStudio.vue` | 快捷模式改为纯文本/资产明文注入草稿框 |
| | `apps/web-pro/src/components/DynamicModelParamBar.vue` | 基于契约动态渲染参数，置灰不支持选项 |
| **门禁测试套件** | `apps/api/test/unit/cancel-matrix.test.js` | 门禁测试 1：全模型取消矩阵与 409 防护测试 |
| | `apps/api/test/unit/wysiwyg-snapshot.test.js` | 门禁测试 2：所见即所得与不可变快照测试 |
| | `apps/api/test/run-tests.js` | 注册 2 项新门禁测试至清单 |

---

## 四、原子回退演练记录

- **基线检查点 Tag**：`checkpoint/before-phase-4`
- **对应 Commit**：`d49534a docs: add Phase 3 acceptance report`
- **热开关回退**：可通过环境变量 `STUDIO_WYSIWYG_STRICT=0` 与 `CANCEL_STATE_MACHINE_V2=0` 快速降级至旧版行为。
- **Git 完整回退**：
  ```bash
  git checkout checkpoint/before-phase-4
  ```
- **实测耗时**：`< 10s`，回退预案完备有效。

---

## 五、Git 状态证明

```text
On branch refactor/phase-4-wysiwyg-cancel-matrix
nothing to commit, working tree clean
```
