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

## 双通道灰测（30003 → 30002）

| 通道 | API | 前端 | 产物 | 数据 |
| --- | --- | --- | --- | --- |
| 正式 | 30001 | http://127.0.0.1:30002/ | `web-pro/dist` | WSL `~/.dsh-material-library` |
| 灰测 | 30000 | http://127.0.0.1:30003/ | `web-pro/dist-gray` | `%USERPROFILE%\.dsh-material-library-gray` |

```text
改代码 → 启动灰测通道.bat（或 node scripts/gray-release.js）
       → 30003 上验证
       → 设置 → 双通道灰度发布 → 发布到正式版
```

首次使用发布功能需要手动「停止素材库.bat → 启动素材库.bat」一次，
让正式端加载到自重启接口。完整流程、故障排查见
**`docs/双通道灰度发布与语音输入.md`**。

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

