# 素材库服务端 (MaterialLibraryServer) 客户端对接与功能演进规范文档

> **版本**：v2.1  
> **面向对象**：素材库服务端（`MaterialLibraryServer`）研发与算法团队  
> **对接客户端**：移动端商业设计 App（`AlbumSyncUniAppX` - 素材库/AI工坊/AI精修）  
> **更新时间**：2026-09-14  

---

## 📌 一、项目现状与协议通信基准

移动端客户端目前已完成重构升级，包括首页素材流分类下拉、AI 工坊多模型双服务商调度与提示词优化、AI 精修双指缩放与真四点透视替换等功能。客户端通过统一的 `/api/viewer/*` 网关访问素材库服务端。

### 1. 通信基准规范
* **协议与 Base URL**：`http://<SERVER_HOST>:<PORT>/api/viewer`
* **身份鉴权**：
  * 除 `/api/auth/login` 外，所有客户端请求均在 Header 中附带 JWT Token：  
    `Authorization: Bearer <TOKEN>`
  * 媒体资源（图片/视频/遮罩）使用短期安全签名参数：`?media_token=<EXPIRE>:<SIG>` 或 `?token=<TOKEN>`。
* **统一响应体格式**：
  ```json
  // 成功响应 (HTTP 200)
  {
    "success": true,
    "data": { ... }
  }

  // 失败响应 (HTTP 4xx / 5xx)
  {
    "success": false,
    "error": "明确的错误提示信息"
  }
  ```

---

## 🚀 二、重点待服务端落地开发的功能规范

当前服务端部分接口处于 **Mock / Fallback** 状态，需服务端算法与研发同学完成实际落地接入：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        待服务端真正落地的核心功能模块                  │
├───────────────────────┬────────────────────────────────────────────────┤
│ 1. 实例分割与边缘提取 │ POST /api/viewer/ai/segment                    │
│ 2. 快捷工坊能力与调度 │ GET /api/viewer/lab/capabilities & runs        │
│ 3. 3D 软装模型预置库  │ GET /api/viewer/products/presets & models      │
│ 4. 真实 LLM 提示词扩写│ POST /api/viewer/chat/optimize-prompt          │
│ 5. 精修贴图上传防爆仓 │ POST /api/viewer/ai/upload                     │
└───────────────────────┴────────────────────────────────────────────────┘
```

---

### 1. 目标检测与实例分割接口 (Instance Segmentation)

#### 1.1 背景与需求
在客户端「AI 精修」模块中，用户可点击 **【🎯 智能拾取/贴合物体】** 按钮。客户端需要服务端根据输入的图片（或点击坐标/选框），自动检测出室内家具目标（沙发、茶几、门窗、单椅等），并返回其**精准多边形轮廓点云（Polygon）**以及**透视四点外接四边形（Quad）**，便于客户端一键吸附并进行透视安装或物体替换。

#### 1.2 接口定义
* **URL**: `POST /api/viewer/ai/segment`
* **Content-Type**: `application/json`
* **请求入参 (Request Body)**:
  ```json
  {
    "image": "data:image/jpeg;base64,...", // 或图片远程 URL / 素材 fid
    "mode": "auto",                        // "auto": 全图实例检测; "interactive": 点选交互分割
    "point": { "x": 520, "y": 780 },       // 可选，用户在图片上点击的绝对坐标（仅 interactive 模式有效）
    "bbox": { "x1": 100, "y1": 200, "x2": 600, "y2": 800 } // 可选，用户手动画出的参考矩形框
  }
  ```

* **预期返回响应 (Response Body)**:
  ```json
  {
    "success": true,
    "data": {
      "detections": [
        {
          "id": "det_sofa_001",
          "label": "意式三人真皮沙发",
          "class_name": "sofa",
          "confidence": 0.94,
          "bbox": { "x1": 150, "y1": 420, "x2": 780, "y2": 890 },
          // 关键：透视四点四边形 (从左上按顺时针排列: P1左上, P2右上, P3右下, P4左下)
          "quad": [
            [170, 440],
            [760, 425],
            [750, 875],
            [160, 885]
          ],
          // 精细分割多边形轮廓点云 (用于涂抹遮罩生成)
          "polygon": [
            [170, 440], [300, 435], [520, 430], [760, 425],
            [770, 600], [750, 875], [450, 880], [160, 885]
          ],
          "mask_url": "/api/viewer/ai/masks/seg_001.png" // 可选二值化透明遮罩
        }
      ],
      "fallback": false
    }
  }
  ```

#### 1.3 服务端推荐实现方案
* 服务端可以独立启动一个 Python 推理容器（如 FastAPI 暴露在 `http://127.0.0.1:5000/detect`），运行 **YOLOv8x-seg** 或 **Segment Anything (MobileSAM / SAM 2)** 模型。
* 若 Python 推理服务不可用，服务端当前已实现兜底机制 (`fallback: true`)，但线上环境请务必启动真实模型服务。

---

### 2. AI 快捷精修工坊能力目录与派发 (Lab Capabilities)

#### 2.1 背景与需求
客户端「AI工坊」包含两大分段：`🎨 对话创作` 与 `⚡ 快捷工坊`。在「快捷工坊」下，客户端动态调用 `GET /api/viewer/lab/capabilities`，按服务端配置展示算子入口卡片与参数表单；用户选图并填参后，通过 `POST /api/viewer/lab/runs` 统一提交。

#### 2.2 获取能力目录 (`GET /api/viewer/lab/capabilities`)
* **URL**: `GET /api/viewer/lab/capabilities`
* **响应格式要求**:
  ```json
  {
    "success": true,
    "data": {
      "engines": {
        "umbra": { "ready": true, "reason": null },
        "gateway": { "ready": true, "reason": null },
        "gen": { "ready": true, "imageAdapters": [...], "videoAdapters": [...] }
      },
      "groups": [
        { "id": "image_edit", "label": "图片精修", "sort": 10 },
        { "id": "generate", "label": "生成方案", "sort": 20 },
        { "id": "video", "label": "视频方案", "sort": 30 }
      ],
      "entries": [
        {
          "id": "umbra.expand",
          "engine": "umbra",
          "group": "image_edit",
          "label": "智能扩图",
          "description": "四向画幅无缝外延",
          "ready": true,
          "requiresAsset": true,
          "fields": [
            {
              "name": "expand_ratio",
              "label": "目标画幅",
              "type": "select",
              "options": ["16:9", "9:16", "1:1", "4:3", "3:4"],
              "default": "16:9",
              "required": true
            }
          ]
        },
        {
          "id": "umbra.remove",
          "engine": "umbra",
          "group": "image_edit",
          "label": "精准消除",
          "ready": true,
          "requiresAsset": true,
          "fields": [
            { "name": "mask_url", "label": "消除遮罩", "type": "text", "required": false }
          ]
        },
        {
          "id": "umbra.replace",
          "engine": "umbra",
          "group": "image_edit",
          "label": "物品透视替换",
          "ready": true,
          "requiresAsset": true,
          "fields": [
            { "name": "replacement_id", "label": "替换预设", "type": "text", "required": true },
            { "name": "facing", "label": "空间朝向角度", "type": "number", "default": 180 }
          ]
        }
      ]
    }
  }
  ```

#### 2.3 任务派发与轮询
* **派发任务**: `POST /api/viewer/lab/runs`
  * Body: `{ "entryId": "umbra.expand", "fid": "local_xxx", "params": { "expand_ratio": "16:9" } }`
  * 返回: `{ "engine": "umbra", "runId": "task_123", "mode": "async", "status": "queued" }`
* **状态轮询**: `GET /api/viewer/lab/runs/:engine/:runId`
  * 成功产物返回: `{ "status": "done", "result": { "kind": "derivative", "previewUrl": "..." } }`

---

### 3. 3D 软装模型预置库接口 (`GET /api/viewer/products/presets`)

#### 3.1 背景与需求
客户端在 AI 精修的「四点替换」中，提供了家具软装横滑选择栏。设计师在图片中框定 4 点后，可直接点击模型库中的家具将其替换入户，并支持 0°~360° 微调空间朝向。

#### 3.2 接口定义
* **URL**: `GET /api/viewer/products/presets`
* **响应数据结构 (Response Body)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "sofa_electric_single",
        "name": "极简单人电动真皮沙发",
        "category": "furniture",
        "facing": 180,                         // 默认朝向角度 (0~360°)
        "preview_url": "/api/viewer/products/previews/sofa_single.png", // 透明底或高质量免抠图
        "model_url": "/api/viewer/products/models/sofa_default.glb",    // 3D GLB 文件下载地址
        "tags": ["单人位", "电动展开", "意大利头层牛皮", "极简奶油风"],
        "dimensions": { "width": 950, "depth": 1050, "height": 920 }   // 毫米尺寸（可选）
      },
      {
        "id": "chair_nordic_lounge",
        "name": "意式轻奢休闲单椅",
        "category": "chair",
        "facing": 0,
        "preview_url": "/api/viewer/products/previews/chair_01.png",
        "model_url": "/api/viewer/products/models/chair_01.glb",
        "tags": ["单椅", "千鸟格", "黑胡桃木", "实木框架"]
      },
      {
        "id": "table_stone_coffee",
        "name": "极简悬浮岩板茶几",
        "category": "table",
        "facing": 90,
        "preview_url": "/api/viewer/products/previews/table_01.png",
        "model_url": "/api/viewer/products/models/table_01.glb",
        "tags": ["茶几", "劳伦黑金岩板", "悬浮设计"]
      }
    ]
  }
  ```
* **服务端开发任务**：
  1. 在数据库中建立 `product_presets` 表，并提供增删改查后台接口；
  2. 支持静态托管 `.glb` 3D 模型文件与高质量透明免抠 PNG 贴图；
  3. 支持从素材库中将分类为 `单品 (product)` 的素材一键关联为预设家具。

---

### 4. 真实 LLM 提示词智能优化扩写 (`POST /api/viewer/chat/optimize-prompt`)

#### 4.1 背景与需求
客户端在 AI 工坊输入框右上角提供了 **【✨ 优化生图词】** 和 **【✨ 优化运镜词】** 按钮。服务端需调用大模型对用户输入的原始描述进行专业扩写。

#### 4.2 接口定义
* **URL**: `POST /api/viewer/chat/optimize-prompt`
* **入参**:
  ```json
  {
    "prompt": "极简客厅",
    "mode": "image" // "image": 室内空间摄影扩写; "video": 空间动态运镜扩写
  }
  ```
* **扩写规则与 Prompt 规范**:
  * **生图模式 (`mode = 'image'`)**：
    * 强化商业空间摄影语言：哈苏中画幅相机拍摄、35mm 建筑广角视角、f/8 大景深、锐利对焦；
    * 补充微观物理材质：微水泥墙面颗粒、天然白橡木哑光肌理、大理石晶体自然纹路、亚麻织物经纬编织；
    * 塑造光影氛围：高动态范围 HDR、落地窗自然漫反射、晨昏冷暖对比、丁达尔光束；
    * 保证输出无畸变、8K 杂志级商业成图。
  * **生视频模式 (`mode = 'video'`)**：
    * 注入电影级摄影机运镜指令：缓慢平稳向前推镜、低角度慢移、微仰角顺时针环绕、焦点自然由前景过渡至背景；
    * 细化空间动态演变：晨光随视角推移产生的光斑位移、纱帘微风轻拂的流动感；
    * 明确 60fps 平滑度、无果冻效应、空间三维结构绝对稳定。

* **响应数据结构**:
  ```json
  {
    "success": true,
    "data": {
      "original": "极简客厅",
      "optimized": "极简客厅。实景室内空间摄影：哈苏中画幅相机拍摄，35mm人文建筑广角视角，f/8光圈大景深，焦点清晰锐利。材质光影细节：微水泥墙面微粒触感，天然原木哑光肌理，大理石逼真结晶纹路。灯光氛围：真实漫反射柔和自然光，无过曝高动态范围(HDR)。8k超高精分辨率，顶级设计杂志刊登画质。",
      "mode": "image"
    }
  }
  ```

---

### 5. 临时贴图与遮罩文件上传 (`POST /api/viewer/ai/upload`)

#### 5.1 规范与白名单说明
* **URL**: `POST /api/viewer/ai/upload`
* **Content-Type**: `multipart/form-data`
* **表单字段**: `file` (二进制文件，通常为涂抹遮罩 mask.png 或自定义贴图)
* **注意项**：
  * 此接口已加入 `VIEWER_WHITELIST`；
  * 上传成功后需返回带有安全签名 `media_token` 的可访问 URL，例如：  
    `{ "success": true, "data": { "id": "mask_123", "url": "http://<IP>:<PORT>/api/viewer/ai/masks/mask_123?media_token=..." } }`。

---

## 📋 三、现有已接入接口基准清单（供对照）

| 接口分类 | HTTP 方法与路径 | 用途说明 | 客户端状态 |
| :--- | :--- | :--- | :--- |
| **认证** | `POST /api/auth/login` | 账号密码登录，获取会话 Token | 已稳定接入 |
| **认证** | `GET /api/viewer/auth/me` | 查询当前登录用户信息与角色 | 已稳定接入 |
| **素材流** | `GET /api/viewer/assets` | 检索素材列表，支持分页、类型、风格、空间筛选 | 已稳定接入 |
| **素材流** | `GET /api/viewer/assets/:fid` | 获取素材详情与全部衍生规格产物 | 已稳定接入 |
| **素材流** | `GET /api/viewer/assets/:fid/image` | 读取原图或指定衍生规格二进制流 | 已稳定接入 |
| **会话管理** | `GET /api/viewer/chat/sessions` | 拉取当前账号的 AI 创作会话列表 | 已稳定接入 |
| **会话管理** | `POST /api/viewer/chat/sessions` | 创建/重命名 AI 创作会话 | 已稳定接入 |
| **会话管理** | `DELETE /api/viewer/chat/sessions/:id` | 删除指定的历史创作会话 | 已稳定接入 |
| **消息流** | `GET /api/viewer/chat/messages` | 读取会话内的全量对话与生成结果流 | 已稳定接入 |
| **消息流** | `POST /api/viewer/chat/messages` | 持久化保存一条用户/AI生成的图文或视频消息 | 已稳定接入 |
| **消息流** | `DELETE /api/viewer/chat/messages` | 清空指定会话内的全部历史消息 | 已稳定接入 |
| **相册直收** | `POST /api/viewer/snapshot` | 客户端推送相册清单快照防重复上传 | 已稳定接入 |

---

## 🧪 四、服务端自主测试套件运行指南

为了方便服务端开发人员在本地或部署服务器上**一键自测验证**已有接口与新增接口的健康度，我们在服务端源码目录内置了全自动自测脚本：

### 1. 运行自测脚本
在服务端根目录下直接执行：
```bash
# 默认自测本地 30001 端口 (viewer/ 账号)
node test/viewer_api_selftest.js
```

### 2. 自定义参数运行
若服务端运行在其他端口或测试环境中，支持传入环境变量：
```bash
ML_TEST_HOST=http://127.0.0.1:30001 ML_TEST_USER=viewer ML_TEST_PASS= node test/viewer_api_selftest.js
```

### 3. 自测覆盖的检测项
自测脚本执行时将全自动校验以下 8 大类核心场景：
1. **基础认证与会话**：验证 `/api/auth/login` 与 `/api/viewer/auth/me`；
2. **素材浏览与详情**：校验 `/api/viewer/assets` 分页过滤及 `:fid` 详情拉取；
3. **AI 工坊能力清单**：校验 `/api/viewer/lab/capabilities` 下发的 15 项能力就绪状态；
4. **对话会话与消息流**：完整执行 会话创建 -> 消息落库 -> 消息流读回 -> 会话销毁 闭环；
5. **提示词扩写测试**：分别验证 `image` 模式与 `video` 模式的扩写结果；
6. **实例分割接口探测**：发送样本图片至 `/api/viewer/ai/segment`，检测是否返回了真实推理数据或 Fallback 数据；
7. **3D 软装模型预置库**：检验 `/api/viewer/products/presets` 的模型丰富度与字段完整性；
8. **临时贴图 Multipart 上传**：通过模拟表单构造图片上传至 `/api/viewer/ai/upload`，验证文件持久化与 Token 生成。

### 4. 预期自测输出样例
```text
  ╔═══════════════════════════════════════════════════════╗
  ║     Material Library Viewer API Self-Test Suite       ║
  ║     目标服务器: http://127.0.0.1:30001              ║
  ╚═══════════════════════════════════════════════════════╝

══════════════════════════════════════════════════════════════
  1. 基础认证与会话 (Authentication)
══════════════════════════════════════════════════════════════
  ✔ [PASS] POST /api/auth/login (登录成功，Token: 23560e046e95...)
  ✔ [PASS] GET /api/viewer/auth/me (用户角色: viewer, 用户名: viewer)

══════════════════════════════════════════════════════════════
  2. 素材库浏览与检索 (Assets Feed & Details)
══════════════════════════════════════════════════════════════
  ✔ [PASS] GET /api/viewer/assets (获取到素材共 1318 件，当前页返回 5 件)
  ✔ [PASS] GET /api/viewer/assets/:fid (素材详情读取正常)

...
══════════════════════════════════════════════════════════════
  自测执行完毕总结 (Test Summary):
  总计通过 (PASS): 14
  需注意项 (WARN): 2
  执行失败 (FAIL): 0
══════════════════════════════════════════════════════════════
🎉 恭喜！所有核心端点通讯与协议验证已全部通过，客户端可稳定直连！
```

---

## 🤝 五、交付与沟通联络
* 若对数据字段结构有定制调整需求，请以本协议中定义的数据模型为准进行扩展，保留主键命名规范。
* 任何接口变更可通过本地运行 `node test/viewer_api_selftest.js` 快速确认是否破坏既有客户端兼容性。
