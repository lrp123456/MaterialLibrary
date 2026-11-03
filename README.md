# MaterialLibraryServer

素材库服务端（自 WSL `dsh_plugins/material_library` 迁到本目录）。

## 路径

| 项 | 值 |
|----|-----|
| 工程 | `C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer` |
| 默认端口 | **30001**（`ML_PORT` 可覆盖） |
| 数据目录 | WSL `/home/lrp/.dsh-material-library`（`ML_DATA_DIR`） |
| 前端 | `web/dist`（由 `server.js` 静态托管） |

## 一键启动（Windows）

双击项目根目录下的 **`启动素材库.bat`**。

- 通过 WSL 在后台启动服务，并挂上 watchdog：进程崩溃会自动重启
- 10 分钟内崩溃超过 8 次会冷却 60 秒再拉起，避免死循环刷盘
- 配套脚本：`停止素材库.bat` / `查看状态.bat`
- 管理台：http://127.0.0.1:30001

也可直接命令行：

```powershell
wsl -d smu -e bash -lc "bash /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/start.sh start"
```

## 启动（推荐 · WSL）

Windows 侧缺 C++ 工具链，`better-sqlite3`/`sharp` 走 WSL Linux 原生模块：

```powershell
Start-Process wsl -ArgumentList '-d','smu','-e','bash','/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/start.sh','start' -WindowStyle Hidden
```

或在 WSL 中：

```bash
bash /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/start.sh start
```

`start.sh` 常用命令：

```bash
start.sh start     # 后台启动（默认，带 watchdog 自动重启）
start.sh stop      # 优雅停止服务与 watchdog
start.sh restart   # 重启
start.sh status    # 查看状态
start.sh logs      # 实时日志
start.sh fg        # 前台调试（无自动重启）
```

## 验证

```text
http://127.0.0.1:30001/                    → 200 管理台
POST /api/viewer/auth/login <账号>/<口令>
POST /api/auth/login <账号>/<口令>
```

测试与契约：

```text
npm test             # 显式清单运行器（unit/security/integration/e2e 共 53 项，全离线）
                     # Windows 侧门禁自动改道本机 Node 22（better-sqlite3 11.10 无 node24 预编译件），
                     # 运行期切换原生二进制并在退出时还原为 linux 件（prod 在 WSL 跑同一棵树）
npm run test:unit    # 分类运行；npm run test:list 查看清单
npm run contract     # 重新生成 docs/contract-manifest.json（三端路由×消费端契约）
```

## 分支通道与发布（test worktree → 正式）

遗留的同树灰测通道（src/gray.js + scripts/gray-release.js + dist-gray）已于
2026-11-03 退役归档（`archive/gray-retired-20261103/`，留档 7 天）。现行唯一机制是
**test 分支 git worktree 通道**，由 `scripts/mls-ctl.js` 统一控制：

| 通道 | API | 前端 | 产物 | 数据 |
| --- | --- | --- | --- | --- |
| 正式 | 30001（WSL） | http://127.0.0.1:30002/ | `web-pro/dist` | WSL `~/.dsh-material-library` |
| test | 30000（Windows） | http://127.0.0.1:30003/ | test worktree 的 `web-pro/dist` | `%USERPROFILE%\.dsh-material-library-test` |

```text
改代码 → npm run ctl -- start test        # 30003 上验证（与 prod 数据隔离）
       → npm run ctl -- promote test      # 默认 dry-run 预演
       → npm run ctl -- promote test --execute   # 合并 + 重建 + 同时重启 30001&30002
```

完整流程与故障排查见 **`docs/branch-channels.md`**；一屏总览：`npm run status`
或 service-hub 面板 http://127.0.0.1:3790/（「通道与发布」标签页）。

## 语音输入（FunASR / SenseVoice）

双击 **`启动语音识别.bat`**（HTTP 10095 / WS 10096）。
工作台右侧会出现悬浮麦克风，识别结果自动写回当前聚焦的输入框，
对话、提示词、搜索、设置里的所有输入框都通用。

## 停止

双击 `停止素材库.bat`，或：

```bash
bash /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/start.sh stop
```

## 说明

- 源码以本目录为准；`node_modules` 为 WSL Linux 构建，**不要在 Windows npm install 覆盖**（会尝试 node-gyp 且失败）。
- 旧路径 `\\wsl$\smu\home\lrp\my_folder\smu\dsh_plugins\material_library` 可保留作备份，勿再双开同端口。
- watchdog 日志：`~/.dsh-material-library/watchdog.log`（WSL 内路径）。

