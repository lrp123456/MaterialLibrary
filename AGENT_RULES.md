# Material Studio Pro · 系统架构与 Agent 开发全景规范 (2026 权威真值版)

> **核心原则**：本文档为全系统的唯一全局架构真值源（Single Source of Truth）。一切开发、部署、运维与 Agent 代码交互，均以此规范为最高准绳，坚决避免「文档写在 A、代码跑在 B、数据库落在 C」的认知割裂。

---

## 一、物理拓扑与环境边界 (Windows vs WSL)

| 节点 / 组件 | 运行环境 | 物理路径 / 端口 | 核心职责 |
| :--- | :--- | :--- | :--- |
| **代码仓库 (Git)** | Windows 宿主 | `C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer`<br>(WSL 内部对应: `/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer`) | 所有业务源码、前端源码、构建脚本的唯一工作区 |
| **核心业务后端** | **WSL (Linux)** | **端口：`30001`**<br>主进程文件：`server.js`（根目录；src/api.js 是手工路由主体） | 核心业务路由、SQLite 连接池、AI 抠图生成、音频 Demucs、Whisper 语音、FFmpeg 剪辑转码等 Linux 原生算力中枢 |
| **唯一生产数据库** | **WSL (Linux)** | **`/home/lrp/.dsh-material-library/material.db`**<br>(包含 WAL: `material.db-wal`, `material.db-shm`) | **全系统唯一真实生产数据库**（包含全部资产库、2000+条基础素材、向量特征）。**严禁在 Windows 目录建立孤立库**！ |
| **桌面工作台网关** | Windows / WSL | **端口：`30002`**<br>主进程文件：`web-pro/server.cjs` | 高性能静态服务器与反向代理网关：托管 `web-pro/dist`，并将所有 `/api/*` 请求代理转发至 WSL 30001 |
| **浏览器交互端** | Windows 桌面 | `http://localhost:30002/static/preview.html` 或 `http://localhost:30002/` | 用户直面 UI（Vue 3 SPA），包含素材库 (DAM)、空间创作 (Studio)、媒体剪辑 (MediaHub)、系统设置 (Settings) |
| **剪辑器子应用** | WSL (Linux) | **端口：`3010`**<br>工作目录：`editor/apps/web` (Next.js) | 以 `basePath=/editor` 启动，经 30002 网关无缝反向代理嵌入主应用 iframe |

---

## 二、项目代码目录结构清单 (各模块绝对归属)

```
MaterialLibraryServer/
├── src/                          # 【30001 核心后端】Node.js 业务服务层
│   ├── server.js                 # HTTP 服务主入口 (端口 30001)
│   ├── db.js                     # SQLite 连接管理 (跨平台加载 better_sqlite3.node，配置 busy_timeout)
│   ├── auth.js                   # 账号鉴权与 Token 管理（口令不入仓：见数据目录 bootstrap-credentials.txt 或由管理员重置）
│   ├── menu-tree.js              # 服务端驱动的分类菜单树与 Studio 参数 Schema
│   ├── base-library/             # 基础素材核心业务模块
│   │   ├── items.js              # 基础素材 CRUD、多使用面挂载、光泽/纹理/主色清洗
│   │   ├── taxonomy.js           # 分类法字典 (墙面/顶面/地面/软装/全屋定制/选品)
│   │   └── compiler.js           # 空间提示词与风格方案编译器
│   └── routes/                   # 各板块 REST API 路由
│
├── web-pro/                      # 【30002 桌面端前端】Vue 3 + Vite + Tailwind CSS
│   ├── server.cjs                # 30002 独立高性能 Web 服务器与 API 反向代理网关
│   ├── dist/                     # 前端生产构建产物 (由 npm run build 生成)
│   └── src/                      # 前端组件与业务逻辑源码
│       ├── App.vue               # 全局根组件 (顶栏导航、全局登录框、新版本感知、白屏容错屏障)
│       ├── api.js                # 前端统一 API 封装与会话管理
│       ├── views/                # 四大主板块核心视口
│       │   ├── LibraryView.vue   # 素材库 (DAM 大资产生态 + 基础素材四板块瀑布流)
│       │   ├── StudioView.vue    # 空间创作 (对话式生成 + 6大精准模式控制台)
│       │   ├── MediaHubView.vue  # 媒体多轨剪辑与 FFmpeg 工具箱
│       │   └── SettingsView.vue  # 系统设置与双通道灰度发布
│       └── components/           # 通用原子 UI 组件
│
├── scripts/                      # 【运维与数据自动化】工具集
│   ├── build-base-library.js     # 一体化基础素材生产库构建与同步注入器 (核心推荐)
│   ├── crawl-latex-nippon.js     # 立邦乳胶漆 (898款带真实空间实景图与主色分类)
│   ├── crawl-tiles-guanzhu.js    # 冠珠瓷砖 (884款带单片材质图、铺贴实景图、光泽、纹理)
│   ├── migrate.js                # SQLite 数据库表结构迁移与种子化
│   └── watchdog.sh               # WSL 内部生产服务守护进程 (崩溃自愈拉起)
│
├── editor/                       # 【3010 剪辑子应用】基于 Next.js 的多轨剪辑核心
└── docs/                         # 【系统架构与设计文档】
    └── SYSTEM_ARCHITECTURE.md    # 系统底层运转与全流程详解手册
```

---

## 三、基础素材业务标准与架构规范

### 1. 板块划分与使用面定义
- **第一行四大板块**：`材质`（material）、`做法`（design）、`选品`（product）、`风格方案`（scheme）。
- **材质细分五大使用面**：
  1. **墙面 (`wall`)**：乳胶漆、微水泥、墙纸、墙布、木饰面（木饰面仅收上墙饰面板）；
  2. **顶面 (`ceiling`)**：乳胶漆、微水泥（与墙面共用记录，同一条多处挂载）；
  3. **地面 (`floor`)**：瓷砖、木地板（实木/复合地板）；
  4. **软装 (`soft`)**：织物（棉麻为筛选项）、皮革；
  5. **全屋定制 (`millwork`)**：板材、门（材质与颜色）、门套、踢脚线、台面与窗台石（岩板/石材）。
- **选品 (`product`)**：茶几、餐桌、灯、地毯、成品柜、成品门。
- **已废弃类目**：玻璃（`glass`）、金属（`metal`）、藤编（`rattan`）已彻底清理，严禁死灰复燃。

### 2. 挂载模型与瀑布流铁律
1. **一条记录多处挂载，严禁复制记录**：
   - 同一款立邦乳胶漆，同时挂载到【墙面】与【顶面】；
   - 同一款大板/岩板瓷砖，同时挂载到【地面】与【墙面】；若是岩板，再额外挂载到【全屋定制】（台面与窗台石）；
   - 一款门若带有成品样式图，同时挂载到【全屋定制】与【选品】。
2. **看图说话铁律（无参考图条目严格不进瀑布流）**：
   - 瀑布流卡片必须以「高清参考图」为主体，品牌、名称、光泽、主色叠在图下方；
   - 凡 `preview_rel` 为空的条目，**坚决不进瀑布流**！用户替换材质时只认图，不看孤立的名字。
3. **瓷砖双图机制**：
   - 首图采用单片平面材质图，卡片悬浮/点击可查看实物铺贴空间搭配图；
   - 提示词中强制附加光泽（亮光/柔光/哑光）与纹理（木纹/石纹/拼花/纯色）。
4. **乳胶漆色系与色号规范**：
   - 主色仅使用 8 大基准：白、黄、绿、蓝、红、灰、黑、棕，默认按此顺序排序；
   - 卡片内嵌真实纯色块徽标与官方色号，明度自动派生角色建议（基底/强调）。

---

## 四、启动、构建与运维标准工作流

### 1. 核心后端启动 / 重启 (WSL)
在 WSL 终端中执行：
```bash
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
./start.sh restart
```
该命令会自动检查端口、启动守护进程 `scripts/watchdog.sh`，并在 30001 端口拉起主服务。

### 2. 前端构建与热更新发布 (Windows)
在 Windows PowerShell 或终端中执行：
```powershell
npm --prefix web-pro run build
```
打包成功后，静态文件输出至 `web-pro/dist`。30002 网关已配置 `index.html` 的 `Cache-Control: no-cache, no-store, must-revalidate`，前端页面内置了入口哈希心跳感知，浏览器端可通过点击左下角【立即更新】或按 <kbd>Ctrl</kbd> + <kbd>F5</kbd> 强刷生效。

### 3. 基础素材生产库重构与同步
若爬取了新数据或更新了分类挂载，只需在 WSL 终端中运行：
```bash
wsl -e bash -lc "cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer && node scripts/build-base-library.js"
```
脚本会自动以原子事务安全写入 WSL 生产库 `/home/lrp/.dsh-material-library/material.db`（带 15 秒并发防锁重试），并输出各使用面的挂载统计，前台网页立刻即可检索到全量内容。
