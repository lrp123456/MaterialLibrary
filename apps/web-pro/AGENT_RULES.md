# Material Studio Pro 前端开发规范 (web-pro 专属子规范)

本文件继承根目录 [`AGENT_RULES.md`](../AGENT_RULES.md) 的全部全局规则，重点规范 `web-pro/src` 内部的组件契约与交互行为：

## 一、组件与数据流归属
1. **四大核心视口 (`web-pro/src/views/`)**：
   - `LibraryView.vue`：素材库板块（全能 DAM + 基础素材瀑布流）；
   - `StudioView.vue`：AI 空间创作（对话流 + 6大精准模式）；
   - `MediaHubView.vue`：媒体剪辑与 FFmpeg 格式转换；
   - `SettingsView.vue`：系统设置。
2. **顶栏导航 (`web-pro/src/components/TopNav.vue`)**：
   - 管理一级四大板块切换与素材库下的二级泳道（图片、视频、音频、基础素材、剪辑工程、回收站）。
3. **全局应用壳 (`web-pro/src/App.vue`)**：
   - 管理会话登录态、适老关怀模式、`onErrorCaptured` 全局错误屏障、入口文件指纹版本感知与无缓存热重载。

## 二、基础素材展示交互铁律
1. **无参考图不进瀑布流**：
   - `displayedBaseItems` 计算属性必须显式过滤：`list = list.filter(item => Boolean(item.preview_rel));`。
2. **看图说话卡片设计**：
   - 卡片主体必须是高清效果图，下方半透明/渐变遮罩浮层呈现品牌、中文名称、光泽、主色色号；
   - 瓷砖卡片首图为平面材质图，支持鼠标悬浮或点击快速翻转预览铺贴实景效果；
   - 乳胶漆卡片主体为立邦官方真实空间搭配图，角标嵌入真实纯色 Hex 色块。
3. **严格遵从四大板块与五大使用面**：
   - 第一行板块：材质、做法、选品、风格方案；
   - 材质细分五大使用面：墙面、顶面、地面、软装、全屋定制；
   - 绝不硬编码已删除的废弃类目（玻璃、金属、藤编）。
