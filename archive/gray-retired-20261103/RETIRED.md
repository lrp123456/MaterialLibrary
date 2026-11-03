# 遗留同树 gray（灰测）通道退役说明

- **退役日期**：2026-11-03
- **留档期限**：7 天（至 2026-11-10），到期后本目录整体删除
- **替代机制**：test 分支 **git worktree** 通道（`../MaterialLibraryServer-test`，30000/30003），
  由 `scripts/branch-channel.js` / `scripts/mls-ctl.js` 管理；详见 `docs/branch-channels.md`。

## 归档物

| 原路径 | 说明 |
| --- | --- |
| `src/gray.js` | 双通道状态汇总 +「发布到正式版」实现（重建 dist + 自重启） |
| `scripts/gray-release.js` | 同树灰测进程拉起脚本（30000/30003 + dist-gray + gray 数据目录） |
| `启动灰测通道.bat` / `停止灰测通道.bat` | 上述脚本的 Windows 入口 |
| `docs/双通道灰度发布与语音输入.md` | 旧双通道流程文档（语音输入能力未退役，仅本说明文档归档） |

## 同步摘除的挂载点

- `src/api.js`：`GET/POST /api/gray/status`、`GET/POST /api/gray/publish` 三个端点删除。
- `web-pro/src/views/SettingsView.vue`：设置页「双通道灰度发布（A/B）」面板整体删除。
  下方「灰度发布与应用更新管理」面板是 **App 包灰度（白名单 canary）**，与本通道无关，保留。
- `service-hub`：B2 已移除启停按钮；B4 起 `/api/mls/action` 收到 `target=gray` 返 410。
- `scripts/branch-channel.js` 的 `LANES.gray` **定义保留**（标 `retired: true`），
  仅用于 30000/30003 端口互斥、陈旧 PID 识别与 `status` 可见；变更类操作一律拒绝。

## 刻意保留的「gray」痕迹（不是漏删）

- `APP_CHANNEL=gray` 环境变量语义仍在 `server.js` / `web-pro/server.cjs` 生效：
  test worktree 通道启动时借用它实现「不消费后台任务队列 + 不自我重启 + 网关通道徽标」。
  这只是一个字符串开关，不再对应任何 gray 通道代码。
- `/api/system/restart` 自重启端点保留：`mls-ctl promote` 仍用它完成正式端双重启。
- `web-pro/dist-gray/`（未跟踪构建产物）与 `~/.dsh-material-library-gray/`（独立数据目录）
  保留在磁盘上不删，避免误伤可能还在跑的旧进程数据；确认无旧进程后可手工清理。
