# Material Library Server (素材库核心服务端)

全系统核心业务底座与算力中枢，统一为 Web 桌面端、移动端 (App)、鸿蒙端 (HarmonyOS) 提供 REST API、WebSocket 推送、AI 算力调度与 SQLite 生产数据持久化服务。

## 物理拓扑与架构规范
- **运行环境**: WSL (Linux) / Node.js 22+
- **核心端口**: `30001` (REST API / WebSocket 主服务，入口 `server.js`)
- **运维控制台**: `3790` (Service Hub 面板，入口 `service-hub/server.js`)
- **唯一生产数据库**: `/home/lrp/.dsh-material-library/material.db` (SQLite + WAL)

## 四端多仓协同体系
本项目作为核心服务端，为其他端提供契约化 API 支持：
1. **[Web 桌面工作台]**: `material-library-web` (Vue 3 + Vite, 端口 30002 / 剪辑器 3010)
2. **[移动客户端]**: `material-library-app` (UniApp / Android 离线工程)
3. **[鸿蒙客户端]**: `material-library-harmony` (OpenHarmony / ArkTS)

## 常用指令
```bash
# 启动 WSL 核心后端服务（带崩溃自愈 watchdog）
bash start.sh start

# 停止 / 重启
bash start.sh stop
bash start.sh restart

# 运行自动化测试与契约检测
npm test
npm run contract:check
```

详细架构与开发规范请参阅 `AGENT_RULES.md` 与 `docs/SYSTEM_ARCHITECTURE.md`。
