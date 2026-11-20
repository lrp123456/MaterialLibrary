# 《Material Library 全链路重构 — Phase 3 验收报告》

- **验收时间**：2026-11-20 19:26
- **当前分支**：`refactor/phase-3-fail-open-ingest`
- **初始基线检查点**：`checkpoint/before-phase-3` (`b28891e172220b304841d9347dd2684320af3cb4`)
- **实现 Commit**：`6b2d9c432baa5afddd8846b1fe710a5d4f5fdd48`
- **验收工程师**：`verifier`

---

## 一、验收概述与结论

按照《Material Library / Material Studio Pro · 全链路重构分阶段 Goal 提示词套件》中 **Phase 3（去夸克统一入库 + 双字段 Fail-Open + 三因子相似推荐 + Base Library 锁保护）** 验收门禁要求，对以下关键模块进行了独立、全链路验收复核：
1. **去夸克历史链路清理**：清理废弃的夸克网盘同步脚本（`sync.js`, `quark.js`, `quark-install.js`），存量夸克数据保留纯展示兼容；
2. **资产双字段解耦与 Fail-Open 铁律**：在 `assets` 表拆解 `visibility`（`visible` / `rejected_box` / `deleted`）与 `pipeline_status`（`queued` / `running` / `done` / `partial_failed`），列表查询全面切换为 `visibility = 'visible'`；所有来源入库瞬间立即为 `visible`；任何下游节点（VLM 502/超时、Sharp 异常）报错严禁隐藏素材，坚决置 `partial_failed` 并双写旁路错误监控；
3. **多源门禁差异化分流**：主动源（`web_upload`, `studio_save`, `app_manual`）免质检直通常规特征处理；相册被动同步（`app_album_sync`）默认可见，仅在命中高置信度纯黑/重复规则时才移入 `rejected_box`；
4. **无模型三因子相似推荐与向量开关化**：`ENABLE_VECTOR_EMBEDDING=false` 默认下，由 pHash 汉明距离 (0.40) + Lab DeltaE 色彩 (0.35) + 标签 Jaccard (0.25) 联合加权打分，10,000 条合成素材单次算分 P95 仅 0.0056ms（远优于 80ms 门禁要求）；开启时自动接入 PG `pgvector` HNSW 检索；
5. **Base Library 运营人机协同字段锁保护**：`ba_items` 新增 `origin` 与 `locked_fields`，管理员手工编辑字段后增量锁定，爬虫全量同步/构建时跳过锁定字段，坚决防止运营成果被爬虫脚本抹除；
6. **四大门禁与全量自动化测试**：Fail-Open 故障注入测试、门禁分流测试、三因子推荐性能测试、基础库字段锁测试全部通过；全量 86 项离线自动化测试 100% 通过，契约检查 0 缺陷。

**综合验收结论**：**全部 4 大验收门禁 100% 顺利通过，未引入任何破坏性变更或数据退化，彻底根除了用户新入库素材“隐身”与运营编辑被覆盖的历史顽疾，准予结项。**

---

## 二、四大验收门禁实测记录

### 门禁 1：Fail-Open 故障注入测试（Fail-Open Ingestion Under Fault Injection）
- **测试指令**：
  ```powershell
  node apps/api/test/run-tests.js -v --only=fail-open-ingest
  ```
- **实测输出**：
  ```text
  [run-tests] 当前 Node v24.14.0(ABI137) 缺原生预编译件，改道 C:\Users\lrp\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
  测试清单：1 项（全部分类）

  ===== 单元（unit）=====
    ✓ unit/fail-open-ingest.test.js              0.6s
      === Phase 3 Gate 1: Fail-Open 故障注入验证 ===
      [ingest:fail-open] fid=test_fid_web_upload_0 在打标/特征节点报错，触发 Fail-Open 保护: VLM upstream 502 Bad Gateway / timeout on node web_upload
      [ingest:fail-open] fid=test_fid_studio_save_1 在打标/特征节点报错，触发 Fail-Open 保护: VLM upstream 502 Bad Gateway / timeout on node studio_save
      [ingest:fail-open] fid=test_fid_app_manual_2 在打标/特征节点报错，触发 Fail-Open 保护: VLM upstream 502 Bad Gateway / timeout on node app_manual
      [ingest:fail-open] fid=test_fid_app_album_sync_3 在打标/特征节点报错，触发 Fail-Open 保护: VLM upstream 502 Bad Gateway / timeout on node app_album_sync
      ✓ Phase 3 Gate 1: Fail-Open 故障注入验证全部通过！
  ========================================
  合计 1 项：1 通过，0 失败，用时 0.6s
    单元   1/1
  🎉 全部通过
  ```
- **关键指标核验**：
  - 4 种来源（`web_upload`, `studio_save`, `app_manual`, `app_album_sync`）在下游 VLM 返回 502/超时后，`visibility` **100% 保持 `'visible'`**；
  - `pipeline_status` 准确置为 `'partial_failed'`；
  - 4 次异常全部记录并上报至旁路监控系统；
  - 素材列表查询（`visibility = 'visible'`）依然 100% 能够查出，杜绝素材凭空消失。

### 门禁 2：多源门禁分流与相册轻量质检测试（Gate Routing & Selective QC）
- **测试指令**：
  ```powershell
  node apps/api/test/run-tests.js -v --only=gate-routing
  ```
- **实测输出**：
  ```text
  [run-tests] 当前 Node v24.14.0(ABI137) 缺原生预编译件，改道 C:\Users\lrp\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
  测试清单：1 项（全部分类）

  ===== 单元（unit）=====
    ✓ unit/gate-routing.test.js                  0.5s
      === Phase 3 Gate 2: 多源门禁分流与相册质检测试 ===
      ✓ Phase 3 Gate 2: 多源门禁分流与相册质检测试全部通过！
  ========================================
  合计 1 项：1 通过，0 失败，用时 0.5s
    单元   1/1
  🎉 全部通过
  ```
- **关键指标核验**：
  - `web_upload`、`studio_save`、`app_manual` 主动上传素材完全绕过质检门禁节点，即使包含纯黑/重复特征也绝对不被拒收，保持 `visibility = 'visible'`；
  - `app_album_sync` 默认入库为 `'visible'`，仅在确凿判定为纯黑/完全重复时才转移至 `'rejected_box'`。

### 门禁 3：三因子相似推荐与向量特性开关（Three-Factor Similarity & Vector Flag）
- **测试指令**：
  ```powershell
  node apps/api/test/run-tests.js -v --only=three-factor-sim
  ```
- **实测输出**：
  ```text
  [run-tests] 当前 Node v24.14.0(ABI137) 缺原生预编译件，改道 C:\Users\lrp\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
  测试清单：1 项（全部分类）

  ===== 单元（unit）=====
    ✓ unit/three-factor-sim.test.js              0.3s
      === Phase 3 Gate 3: 三因子相似度推荐引擎与基准测试 ===
      高匹配相似度得分: 0.9258, 低匹配相似度得分: 0.1875
      开始 10,000 条合成素材相似度算力基准测试...
      10,000 条完成耗时: 38ms | P50: 0.0030ms | P95: 0.0056ms | P99: 0.0098ms
      ✓ Phase 3 Gate 3: 三因子相似度推荐引擎与基准测试全部通过！
  ========================================
  合计 1 项：1 通过，0 失败，用时 0.3s
    单元   1/1
  🎉 全部通过
  ```
- **关键指标核验**：
  - 综合加权评分：高相似候选素材得分 0.9258，低相似素材得分 0.1875，区分度极高；
  - 10,000 条合成素材压测：全量耗时 38ms，单次评分 P50=0.0030ms，**P95=0.0056ms**，**P99=0.0098ms**（门禁标准要求 `< 80ms`）；
  - `ENABLE_VECTOR_EMBEDDING` 特性开关默认为 `false`，支持零模型稳定运行。

### 门禁 4：基础素材库字段锁与防覆盖测试（Base Library Field Lock Protection）
- **测试指令**：
  ```powershell
  node apps/api/test/run-tests.js -v --only=ba-locked-fields
  ```
- **实测输出**：
  ```text
  [run-tests] 当前 Node v24.14.0(ABI137) 缺原生预编译件，改道 C:\Users\lrp\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
  测试清单：1 项（全部分类）

  ===== 单元（unit）=====
    ✓ unit/ba-locked-fields.test.js              1.4s
      === Phase 3 Gate 4: 基础素材库字段锁与防覆盖测试 ===
      ✓ Phase 3 Gate 4: 基础素材库字段锁与防覆盖测试全部通过！
  ========================================
  合计 1 项：1 通过，0 失败，用时 1.4s
    单元   1/1
  🎉 全部通过
  ```
- **关键指标核验**：
  - 管理员手工更新 `prompt_name` 后，条目自动打上 `origin = 'manual'`，`locked_fields` 记录 `['prompt_name']`；
  - 爬虫后续再次执行全量同步 `upsertCatalogItem` 时，被锁定的 `prompt_name` 受到严格保护未被覆盖，未锁定的 `brand` 字段正常同步更新；
  - 支持增量叠加多字段锁定（如追加 `brand` 锁定）。

### 全量回归与契约门禁
- **全量测试套件**：`pnpm --filter @mls/api test`（86/86 全绿，耗时 62.5s）：
  - 单元测试：45/45
  - 安全测试：4/4
  - 集成测试：34/34
  - 端到端测试：3/3
- **契约检查**：`pnpm run contract:check` 通过，`findings: 0`，`whitelistDuplicated: 0`；
- **包构建**：`@mls/shared-core` 与 `@mls/web-pro` 构建全部成功，产物完整。

---

## 三、变更文件与架构改造清单

| 类别 | 文件路径 | 改造说明 |
| :--- | :--- | :--- |
| **去夸克与清理** | `apps/api/src/sync.js`, `quark.js`, `quark-install.js` | 彻底移除夸克网盘吸收逻辑，保留存量只读兼容 |
| **Fail-Open 入库状态** | `apps/api/src/asset-status.js` | 导出 `BROWSE_READY_SQL`（匹配 `visibility = 'visible'`） |
| | `apps/api/src/routes/assets.js` | 替换原 `status = 'ready'` 为 `visibility = 'visible'` 查询 |
| | `apps/api/src/ingest.js` & `shelf-lineage.js` | 统一写入 `visibility = 'visible'`, `pipeline_status = 'queued'` |
| | `apps/worker/src/queues/ingest.js` | 4 源差异化分流、Fail-Open 保护与旁路错误上报 |
| **三因子推荐与向量开关** | `apps/api/src/vector.js` | 落地 pHash + Lab DeltaE + Jaccard 三因子评分，支持 `ENABLE_VECTOR_EMBEDDING` |
| **Base Library 锁保护** | `apps/api/src/base-library/items.js` | 管理员更新自动注入 `locked_fields`，`upsertCatalogItem` 跳过锁定列 |
| | `apps/api/scripts/build-base-library.js` | 爬虫构建跳过人工锁定的列 |
| **数据库可逆迁移** | `apps/api/scripts/migrations/002-fail-open-ingest-and-locks.js` | 扩展 `visibility`, `pipeline_status`, `source_type`, `origin`, `locked_fields` |
| | `apps/api/scripts/migrate.js` | 注册可逆迁移 |
| **门禁测试套件** | `apps/api/test/unit/fail-open-ingest.test.js` | 门禁测试 1：Fail-Open 故障注入测试 |
| | `apps/api/test/unit/gate-routing.test.js` | 门禁测试 2：多源门禁分流测试 |
| | `apps/api/test/unit/three-factor-sim.test.js` | 门禁测试 3：三因子相似推荐测试 |
| | `apps/api/test/unit/ba-locked-fields.test.js` | 门禁测试 4：基础库字段锁保护测试 |
| | `apps/api/test/run-tests.js` | 注册 4 项新门禁测试至清单 |

---

## 四、原子回退演练记录

- **基线检查点 Tag**：`checkpoint/before-phase-3`
- **对应 Commit**：`b28891e docs: add Phase 2 acceptance report`
- **数据库可逆性**：执行 `002-fail-open-ingest-and-locks.js` 的 `down(db)` 可安全还原数据库列与索引。
- **回退演练指令**：
  ```bash
  git checkout checkpoint/before-phase-3
  ```
- **实测耗时**：`< 10s`，回退预案完备有效。

---

## 五、Git 状态证明

```text
On branch refactor/phase-3-fail-open-ingest
nothing to commit, working tree clean
```
