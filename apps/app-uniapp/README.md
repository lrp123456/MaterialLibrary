# Material Library Mobile App (移动端)

素材库移动客户端工程，支持 iOS / Android 双端（基于 UniApp 与 Android 离线原生 SDK 打包）。

## 工程结构
- src/: UniApp 跨端客户端源码 (Vue 3 / UTS)
- ndroid-offline/: Android 原生离线打包 Gradle 工程（包含原生 AAR 扩展与插件）
- 
ativeplugins/: 原生离线插件包 (如 uni-local-infer 本地离线推理插件)
- ndroid-so-guide.html: Android Native SO 库编译与排查指南
- local-infer-demo.html: 端侧推理离线测试原型

## 运行与构建
- 前端开发：通过 HBuilderX 或 Vite CLI 进行跨端开发
- 离线打包：导入 ndroid-offline 至 Android Studio，执行 ./gradlew assembleRelease
