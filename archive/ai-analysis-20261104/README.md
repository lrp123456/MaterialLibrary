# 他方 AI 专项分析产物留档（2026-11-04）

> 来源：另一 AI 编码工具在工作树中留下的未跟踪产物（3 份报告 + 1 个压测脚本 + 2 个"对抗测试"）。
> 处置：不接门禁、不入活动文档区，留档 7 天，**2026-11-11 后可整目录删除**。
> 处置人复核日期：2026-11-04。

## 目录

- `docs/全链路Bug清单与系统稳定性治理方案.md`（21 项 Bug + 熔断器/WS 重放/streamFileSafely 等容错设计）
- `docs/全系统性能瓶颈与架构深度诊断报告.md`（App/Web/后端性能诊断与路线图）
- `docs/系统性能测量指标体系与基准采集规范.md`（指标口径 + 基准数据 + 探针/压测工具说明）
- `scripts/benchmark_backend.js`（零依赖压测脚本）
- `tests/adversarial-challenger2.test.js`、`tests/adversarial-challenger2-iter2.test.js`（对抗"测试"）

## 为什么两个 challenger 文件不接 npm test（与 B0 删除 adversarial-stress-m2 同类理由）

1. **不测生产代码**：两份文件 require 的全是自己内联复制的"方案代码"
   （`ProposedCircuitBreaker` / `RemediatedCircuitBreaker` / `createWsReplaySystem` /
   `streamFileSafely` / 内联 `parseBody`），生产模块一个都没 require。
2. **所谓"已合入的 6 大补丁"在生产代码中不存在**（2026-11-04 全仓 grep 复核）：
   无 `halfOpenInFlight`/滑动窗口熔断器（生产侧根本没有 CircuitBreaker）、
   无 `SERVER_EPOCH`/`resync_required`/`BUFFER_EVICTED`（WS 无 lastEventId 重放协议）、
   无 `streamFileSafely`、无 TRUNCATE 定时检查点（B6 只做了 PASSIVE，见 src/db.js:30）、
   server.js 无 `headersTimeout`/`requestTimeout`。iter2 的 100% PASS 只证明
   "报告里的示例代码自洽"，对仓库零保护力。
3. **iter1 是假门禁**：每个用例 catch 后只打印 `[FAIL / VULNERABILITY CONFIRMED]`，
   1.2/2.1/2.2 无条件 throw，进程最终 exit 0——接进 npm test 等于噪声+虚假安全感。
4. **iter2 仍有水货断言**：5.1 在 win32 直接跳过 SQLite 用例并打印"[确证]"
   （npm test 的 Windows 侧正好是 win32）；4.2 的 408 用例在服务端无任何响应时
   也靠 fallback 默认值 `408` 通过。

## 已逐条核实的真实项（可作后续批次输入）

| 报告条目 | 复核结论 |
|---|---|
| BUG-BE-01 Slowloris：server.js 无传输层超时 | **属实**。无 headersTimeout/requestTimeout/keepAliveTimeout/setTimeout |
| BUG-BE-01 超限无 413 | **已由 B6 修复**：parseBody 哨兵 + 4 处调用点（api.js:3160/3409/4375/8828）+ /products/upload 2GB 封顶 |
| BUG-BE-01 坏 JSON 静默 {} | **已由 B6 修复**：api.js:417-423 显式 400/BAD_JSON |
| BUG-BE-02 `b += c` 跨 chunk UTF-8 截断 | **属实但低危**：api.js:402 仍为字符串累加；JSON 请求体通常单 chunk，症状是坏字符→400 而非静默损坏。可用 Buffer 数组或 StringDecoder 收口 |
| BUG-WEB-06 web/index.html:7 Google 字体外链 | **属实**：离线阻断/图标乱码风险仍在（旧管理台） |
| BUG-WEB-07 web-pro/index.html:8 jsdelivr CDN model-viewer | **属实**：`<head>` 同步外链 + 包内 model-viewer 并存，离线首屏阻断 |
| 熔断/WS epoch/GAP/TRUNCATE 等 §4 容错设计 | 生产代码不存在对应实现，属于**新功能提案**而非回归项；如采纳应先落代码再按生产模块写测试 |
| benchmark_backend.js | 骨架可用但**现状跑不出有效数据**：端点路径少 `/api` 前缀且无鉴权头（/assets 等必 401），仅 /health 根路径存在 |

其余 App/Web 条目（BUG-APP-01~08、BUG-WEB-01~05、BUG-BE-03~06 等）未逐条复核；
注意 App 正源在仓外 AlbumSyncUniAppX，仓内 app-uniapp 为实验端，APP 类条目只能出改动单。
