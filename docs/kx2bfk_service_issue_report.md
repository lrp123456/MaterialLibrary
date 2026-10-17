# KX2BFK_umbra_quick 服务提供方缺陷与联调排查分析报告

> **目标对象**：`KX2BFK_umbra_quick` 维护团队与管理 Agent  
> **报告发起方**：素材库服务端（`MaterialLibraryServer`）研发团队  
> **联调时间**：2026-09-14  
> **涉及服务**：`apps/ts-api-gateway` (3001) / `Python Worker` (8000) / `backend_server.py` (5001)  

---

## 📌 报告背景
在与客户端（移动端商业设计 App `AlbumSyncUniAppX`）以及素材库服务端（`MaterialLibraryServer`）进行端到端联调测试过程中，我们针对「AI 快捷工坊」中的**触控精修（扩图/消除/替换）**与**多空间漫游成片（spatial_walkthrough）**功能进行了全流程实测。

测试发现：素材库服务端提交给 `KX2BFK_umbra_quick` 的任务中，部分由于底层服务实现的边界缺陷导致任务执行中断或失败。经深层源码排查，梳理出以下 4 项核心缺陷及改进建议。

---

## 🚩 缺陷清单与详细分析

### 1. 契约公共 API 内存状态未持久化，服务重启后自动封闭（403 `api_not_exposed`）

* **涉及文件**：`apps/ts-api-gateway/src/modules/creation-workflow/remoteAccess.ts`
* **问题现象**：
  外部客户端/BFF 访问 `/api/v1/creation/public/templates` 或提交 runs 时，频繁出现：
  ```json
  { "success": false, "error": "api_not_exposed" }
  ```
* **根本原因**：
  `remoteAccess.ts` 中控制远程访问的开关为一个纯内存变量：
  ```typescript
  let remoteEnabled = false;
  let remoteToken = process.env.CREATION_PUBLIC_TOKEN || '';
  ```
  每次网关重启、重新部署或通过 `tsx watch` 触发热重载时，`remoteEnabled` 必然重置为 `false`。必须外部再主动发一次 `POST /api/v1/creation/remote/start` 才能恢复可用。
* **修复建议**：
  在 `remoteAccess.ts` 中支持环境变量直接开启，例如：
  ```typescript
  let remoteEnabled = process.env.CREATION_PUBLIC_ENABLED === 'true' || Boolean(process.env.CREATION_PUBLIC_TOKEN);
  ```
  或者将开启状态持久化至数据库/配置文件中，保证服务重启后对外契约始终就绪。

---

### 2. 公网 AI 服务商（火山方舟 volcengine）无法拉取本地内网图片（Connection Refused）

* **涉及文件**：`apps/ts-api-gateway/src/services/mediaGen/providers/volcengine.ts`
* **问题现象**：
  当执行消除 (`umbra.remove`) 等需要调用火山方舟（Seedream / Seedance）的操作时，任务在 38% 处失败：
  ```text
  volcengine: The parameter `image` specified in the request are not valid: 
  Error while downloading: http://127.0.0.1:30001/api/viewer/assets/.../image?media_token=..., 
  error: Get "...": dial tcp 127.0.0.1:30001: connect: connection refused.
  ```
* **根本原因**：
  `volcengine.ts` 的 `generateImage` / `generateVideo` 直接将收到的 `req.imageUrls` 透传给了云端火山方舟的公网 API。当工作流运行在本地测试或私有云开发环境时，图片地址为 `http://127.0.0.1:30001/...`，火山方舟公网集群尝试连接其本地 `127.0.0.1` 必然失败。
* **修复建议**：
  1. `volcengine.ts` 在向火山引擎提交生图/生视频请求前，应判断图片 URL 是否为局域网/回环地址（`127.0.0.1`, `localhost`, `192.168.x.x`）；
  2. 若为内网地址，则先通过 HTTP 下载流，将其上传至系统已配置的阿里云 OSS（`.env` 中已配置 `naite-mes` bucket 与 `img.naite.cc`），再将返回的公网 OSS URL 发送给火山方舟；
  3. 或者直接将图片编码为 base64 data URI（火山方舟支持 base64 内联输入）。

---

### 3. 铺画布算子（image.canvas）返回临时路径导致跨进程/跨环境找不到文件（ENOENT）

* **涉及文件**：`apps/ts-api-gateway/src/modules/creation-workflow/runner.ts` 与 Python Worker
* **问题现象**：
  在执行智能扩图 (`umbra.expand`) 工作流时，任务执行至 63% 崩溃：
  ```text
  ENOENT: no such file or directory, open '/tmp/cw_h6cucjep/out.png'
  ```
* **根本原因**：
  在 `runner.ts` 中：
  1. 节点调用 Python Worker (8000 端口) 执行 `image.canvas` 算子；
  2. Python Worker 将产物写入其自身的临时路径（`/tmp/cw_h6cucjep/out.png`）并作为 `result.url` 返回；
  3. 下游 `outpaint` 算子直接尝试通过 Node.js `fs.readFile('/tmp/cw_h6cucjep/out.png')` 打开该路径；
  4. 由于 Python Worker 运行在独立环境（或容器内），宿主网关根本找不到该临时文件，抛出 `ENOENT`。
* **修复建议**：
  Python Worker 执行 `image.canvas` 等算子时，输出的产物必须提供 HTTP 访问 URL（例如挂载在 Python Worker 的静态文件路由 `/files/out_xxx.png`），下游算子通过 HTTP 拉取，或统一写入公共挂载卷/OSS 存储。

---

### 4. YOLO-seg 实例分割后端缺少常驻进程守护机制

* **涉及文件**：`backend_server.py` (根目录下 5001 端口服务)
* **问题现象**：
  `MaterialLibraryServer` 调用 `http://127.0.0.1:5001/detect` 进行家具实例分割与轮廓提取时，若服务未手动通过 `python backend_server.py` 拉起，接口只能触发 Fallback 假数据。
* **根本原因**：
  `backend_server.py` 目前作为独立演示脚本存在，未被集成至项目的统一启动脚本（如 `start.sh`、`docker-compose.yml` 或 PM2 配置）中。
* **修复建议**：
  将 `backend_server.py` 加入系统服务守护清单，使其与 `ts-api-gateway` 和 `python worker` 保持同步常驻运行，确保 5001 端口开箱即用。

---

## 🤝 协作建议
素材库服务端（`MaterialLibraryServer`）目前已完成内部代码全面升级（包含媒体签名统一共享、YOLO 轮廓提取增强、3D 模型预设库、真实大模型提示词优化）。

若贵方能针对上述 4 点（特别是 **`remoteEnabled` 自动开启** 与 **火山方舟内网图片 OSS 转存**）进行对应适配修复，全链路即可实现 100% 真实算法与云端算力的无缝打通。
