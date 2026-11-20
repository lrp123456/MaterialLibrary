# Material Library (DSH 素材库总项目)

本项目为包含服务端与多端客户端（Web 桌面端、移动端、鸿蒙端）的整体架构工作区。

## 四端独立仓库说明
- **`material-library-server/`**：核心后端服务与算力中枢 (WSL Node.js, 端口 30001, 控制台 3790)  
  *远程仓库：https://github.com/lrp123456/material-library-server*
- **`material-library-web/`**：Material Studio Pro 桌面工作台 (Vue 3, 端口 30002) 与多轨剪辑器 (Next.js, 端口 3010)  
  *远程仓库：https://github.com/lrp123456/material-library-web*
- **`material-library-app/`**：移动端 (UniApp + Android 原生离线打包 Gradle 工程)  
  *远程仓库：https://github.com/lrp123456/material-library-app*
- **`material-library-harmony/`**：鸿蒙端 (DevEco Studio OpenHarmony / ArkTS 客户端)  
  *远程仓库：https://github.com/lrp123456/material-library-harmony*

## 快捷启动
- 双击 `一键启动素材库.bat`：拉起后台服务并打开 Service Hub 控制面板 (http://127.0.0.1:3790) 或 Web 桌面端 (http://127.0.0.1:30002)。
