# Material Library HarmonyOS Client (鸿蒙端)

素材库鸿蒙端同步客户端工程，基于 OpenHarmony / HarmonyOS NEXT ArkTS 开发。

## 工程规范
- 开发工具：DevEco Studio 5.0+
- 架构：ArkTS 声明式 UI + 端侧文件监听与后台同步
- 服务端对接：通过 REST API 与 WebSocket 连接 material-library-server (端口 30001)

## 模块说明
- entry/: 主应用模块与页面 UI、同步业务逻辑
- AppScope/: 全局应用资源与配置
