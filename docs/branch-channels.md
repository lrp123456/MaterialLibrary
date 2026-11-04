# 分支通道管理（master / test 并行运行）

> 目标：`master` 的产物继续占着 30002（平时在用的入口），`test` 分支的产物同时跑在 30003，
> 两边代码、前端产物、数据库互不干扰。验证通过后再把 test 合并回 master。

## 一句话原理

原来的「双通道」是**同一份工作树、两套进程**（30001/30002 正式 + 30000/30003 灰测），
两个端口跑的是同一份代码，只能验证"改动"，不能验证"分支"。
现在用 **git worktree** 给 test 分支单独开一份工作树，于是每个端口背后是**不同分支的不同产物**。

```
C:\Users\lrp\DevEcoStudioProjects\
├── MaterialLibraryServer\           ← master 工作树 → API 30001 / Web 30002
└── MaterialLibraryServer-test\      ← test   工作树 → API 30000 / Web 30003
```

worktree 放在项目**同级目录**而不是项目内部，是为了避开 Windows 260 字符路径限制
（仓库里有 200+ 字符的长路径文件）。`node_modules` 用 junction 链回主仓，不复制几十万文件。

## 通道一览

| 通道 | 分支 | 工作树 | API | Web | 数据目录 | 由谁管理 |
|---|---|---|---|---|---|---|
| prod | master | 项目根目录 | 30001 | **30002** | `~/.dsh-material-library`（WSL 内） | WSL `start.sh` / watchdog |
| test | test | `../MaterialLibraryServer-test` | 30000 | **30003** | `~/.dsh-material-library-test` | `scripts/branch-channel.js` |
| ~~gray（已退役）~~ | — | 代码归档 archive/gray-retired-20261103/ | 30000 | 30003 | `~/.dsh-material-library-gray`（磁盘保留） | 无；LANES.gray 仅留作端口互斥识别 |

**gray 已退役**：`scripts/branch-channel.js` 与 `mls-ctl` 对 gray 的任何变更类操作一律拒绝；LANES.gray 定义保留仅为在 `status` 中发现占用 30000/30003 的陈旧 gray 进程（查 PID 手动结束即可）。

## 日常用法

日常操作统一走两个入口，根目录不再有散落的 .bat：

- **素材库控制台**（双击根目录 `素材库控制台.bat` → http://127.0.0.1:3790/ ，
  「通道与发布」标签页）：启动/停止 test、查看两通道状态、合并发布。
- 命令行 `npm run ctl`（即 `scripts/mls-ctl.js`），等价子命令见下。

等价命令行：

```bash
node scripts/branch-channel.js --status              # 全局状态
node scripts/branch-channel.js --start test          # 构建并启动
node scripts/branch-channel.js --start test --no-build   # 只重启（改了 server.js/src 时）
node scripts/branch-channel.js --build test          # 只构建
node scripts/branch-channel.js --stop test           # 停止
node scripts/branch-channel.js --sync-data test      # 从正式库重拉数据库快照
node scripts/branch-channel.js --diff test           # 与 master 的差异 + 冲突预演
node scripts/branch-channel.js --diff fix/audit-20261020   # 支持任意分支名
```

**改了后端代码（`server.js` / `src/*.js`）必须重启** test 通道才生效；
只改前端（`web-pro/src`）也要重新 `--build`，静态产物不会热更新。

## 数据隔离

- **数据库**：`~/.dsh-material-library-test/material.db`，首次启动从正式库复制一份快照（266MB，实测 0.9s）。
  之后完全独立，test 里增删素材不会影响正式库。要重置就用 `--sync-data test`。
- **缓存/图片**：`cache` 是指向正式缓存目录的符号链接（只读共享），所以 test 里能看到正式素材的图，
  不用复制几十 GB。test 自己新上传的图会落到这个共享目录 —— 这跟旧灰测通道的行为一致。
- **绝不允许**两个进程共用同一个 `material.db`：SQLite 多进程写会锁库甚至写坏数据。

## 与正式端的关系

- `30002`（master）由 WSL 里的 `start.sh` + watchdog 管理，本脚本**只读状态、不启停**。
  停止/启动请在素材库控制台（3790）操作「正式端（整组）」，或 `npm run ctl -- restart prod`。
- `30003`（test）是 Windows 侧独立进程，`APP_CHANNEL=gray` 只借用它的两个行为：
  **不消费任务队列**（避免和正式抢 AI 任务）、**不自动重启**。所以页面上仍显示"灰测通道"徽标，
  这是刻意的——提醒你这页不是正式环境。

## 已知限制

1. **test 分支的内容 = 最后一次 commit**，不包含主工作树里未提交的改动。
   如果主工作树有大量在途改动（目前 200+ 项），test 通道看到的是"上一个提交点的样子"，
   缺什么功能属于正常现象，不是构建失败。
2. **30003 的 HTTPS** 依赖 `web-pro/server.cjs` 里同端口双协议那段代码。
   若 test 分支的该文件版本较旧，30003 只能 HTTP，剪辑台的 OPFS / WebCodecs 会被浏览器禁用。
   验证方法：`curl -k https://127.0.0.1:30003/` 或看 `~/.dsh-material-library-test/logs/web.log`
   里有没有 `[web-pro] HTTPS: 启用`。
3. test 与 30002 是不同 origin，浏览器本地剪辑工程（IndexedDB/OPFS）不互通，需导出/导入 `.mlsclip`。
4. 剪辑编辑器（3010）是两个通道共用的一个实例，不按分支隔离。

## 合并回 master

在素材库控制台「通道与发布」里点「test → 正式 合并发布」，或：

```bash
npm run ctl -- promote test            # 等价于旧的合并test到master.bat
```

它会先跑 `--promote test --dry-run`（只预演，列出提交、文件改动、冲突清单），
确认后再执行：`git merge --no-ff test` → 重建正式前端产物 → 通知 30001/30002 自重启。

硬性前置条件：

- **master 工作树必须干净**。有未提交改动时 `git merge` 会直接拒绝，脚本也会提前报错并给出
  `git stash` / `git commit` 两种处理方式。
- **test 工作树必须干净**（否则等于把半成品合进正式），确要强推加 `--force`。
- 合并冲突时脚本会停在冲突状态，解决后 `git add` + `git commit`，或 `git merge --abort` 放弃。
- 正式端自重启接口 `POST /api/system/restart` 在旧代码里可能不存在，失败时请在素材库控制台
  （3790）手动整组重启，或 WSL 内执行 `bash start.sh restart`。

## 加一个新通道（例如 fix 分支）

1. 在 `scripts/branch-channel.js` 的 `LANES` 里复制 `test` 那条，改 `key` / `branch` / 端口 / `worktree`。
2. `node scripts/branch-channel.js --prepare <key>` 建工作树。
3. `node scripts/branch-channel.js --start <key>`。

端口必须错开：目前 30000/30001/30002/30003 已被占用，新通道建议用 30004/30005 一组
（API 小号、Web 大号，跟现有一致）。
