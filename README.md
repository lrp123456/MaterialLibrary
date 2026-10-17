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
POST /api/viewer/auth/login viewer/
POST /api/auth/login 504391119/
```

## 停止

双击 `停止素材库.bat`，或：

```bash
bash /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/start.sh stop
```

## 说明

- 源码以本目录为准；`node_modules` 为 WSL Linux 构建，**不要在 Windows npm install 覆盖**（会尝试 node-gyp 且失败）。
- 旧路径 `\\wsl$\smu\home\lrp\my_folder\smu\dsh_plugins\material_library` 可保留作备份，勿再双开同端口。
- watchdog 日志：`~/.dsh-material-library/watchdog.log`（WSL 内路径）。

