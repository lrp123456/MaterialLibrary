# 素材库服务端 API 对接契约规范 (Material Library Server API Spec)

**版本**: v2.5.0  
**基准端口**: `30001`  
**网关前缀**: `/api/viewer`  
**数据交换格式**: JSON (UTF-8) / 二进制媒体流  

---

## 1. 总体架构与鉴权机制

素材库服务端作为全功能 BFF (Backend For Frontend) 统一网关，对外提供素材检索、流媒体分发、相册增量快照直收及 AI 异步算子调度。客户端不直接连接底层 GPU 模型或引擎独立端口，全部请求统一归一到 `30001` 端口。

### 1.1 鉴权方式
- **Header 鉴权（接口通用）**：`Authorization: Bearer <token>`
- **Query 参数鉴权（图片/音频/视频媒体流）**：`?token=<token>` 或短期防盗链签名 `?media_token=<media_token>`

### 1.2 状态码与通用响应格式
```json
// 成功响应
{
  "success": true,
  "data": { ... }
}

// 错误响应
{
  "success": false,
  "error": "错误描述信息"
}
```

---

## 2. 账号与会话接口

### 2.1 用户登录
- **路径**：`POST /api/viewer/auth/login`
- **请求体**：
  ```json
  {
    "username": "viewer",
    "password": ""
  }
  ```
- **响应示例**：
  ```json
  {
    "success": true,
    "data": {
      "token": "23dc916edde143ed763a7009c9d6fec2aae72022df4327c7e5fba2314c467f4d",
      "user": {
        "username": "viewer",
        "role": "viewer"
      }
    }
  }
  ```

---

## 3. 五大素材库分类检索接口

- **路径**：`GET /api/viewer/assets`
- **通用参数**：
  - `page`: 页码（从 1 开始，默认 1）
  - `pageSize`: 分页大小（默认 30，最大 100）
  - `keyword`: 关键词模糊检索（匹配文件名、标签等）
  - `sort`: 排序策略，`latest`（最新，默认）、`earliest`（最早）、`recommend`（推荐画幅优先）
  - `media_type`: **核心分类筛选**，支持以下枚举：
    - `image`: 空间实景与设计图片（排除独立单品）
    - `video`: 空间全景漫游视频
    - `furniture`: 独立单品与软装模型库
    - `music`: 背景音乐与环境音素材库（完全由服务端拉取）
    - `portrait`: 比例人物透明立绘立裁库（完全由服务端拉取）

---

### 3.1 单品素材库 (`media_type=furniture`)
- **专用筛选参数**：
  - `furniture_category`: 家具大类（沙发/椅子/桌几/床具/储物/灯具等）
  - `furniture_item`: 具体单品细类（单人沙发/餐椅/吊灯/茶几等）
  - `material`: 材质（胡桃木/大理石/真皮/棉麻/微水泥/金属等）
  - `style`: 设计风格（现代简约/轻奢/日式/侘寂/奶油风等）
- **响应元素扩展**：
  - `category`: `'furniture'`
  - `media_type`: `'furniture'`
  - 缩略图与高清图：白底/透明底单品大图，直接展示单品主体

---

### 3.2 音乐素材库 (`media_type=music`)
- **专用筛选参数**：
  - `mood`: 情绪氛围（`治愈舒缓`、`轻奢大气`、`禅意空灵`、`节奏律动` 等）
  - `space`: 推荐匹配空间（`客厅`、`卧室`、`书房`、`茶室` 等）
  - `style`: 推荐匹配风格（`现代简约`、`轻奢`、`日式` 等）
- **返回数据结构**：
  ```json
  {
    "fid": "audio_mat_001_morning_breeze",
    "file_name": "极简空间·晨曦流转.mp3",
    "category": "music",
    "media_type": "music",
    "kind": "audio",
    "duration": 42,
    "size": 680000,
    "created_at": 1789365000000,
    "tags": [
      { "dimension": "mood", "label": "治愈舒缓" },
      { "dimension": "space", "label": "客厅" }
    ]
  }
  ```
- **音频流媒体播放**：
  - `GET /api/viewer/assets/:fid/image?token=<token>`
  - 响应 Content-Type: `audio/mpeg` 或 `audio/wav`，支持 HTTP 206 Range 拖拽缓冲试听。

---

### 3.3 人像素材库 (`media_type=portrait`)
- **专用筛选参数**：
  - `pose`: 动作姿态（`站姿立绘`、`坐姿休闲`、`互动交谈` 等）
  - `character`: 人物角色分类（`商务白领`、`亲子家庭`、`居家休闲` 等）
  - `space`: 适配场景空间
- **返回数据结构**：
  ```json
  {
    "fid": "portrait_mat_001_business_man",
    "file_name": "现代商务男性_立姿.png",
    "category": "portrait",
    "media_type": "portrait",
    "kind": "image",
    "width": 600,
    "height": 1200,
    "orientation": "3:4",
    "size": 240000,
    "created_at": 1789365000000,
    "tags": [
      { "dimension": "pose", "label": "站姿立绘" },
      { "dimension": "character", "label": "商务白领" }
    ]
  }
  ```
- **透明底立绘拉取**：
  - `GET /api/viewer/assets/:fid/image?token=<token>`
  - 响应 Content-Type: `image/png`（保留完整 Alpha 透明通道）。

---

## 4. 媒体流与原图/视频获取

### 4.1 图像与音频/视频流
- **路径**：`GET /api/viewer/assets/:fid/image`
- **参数**：
  - `derivative`: 可选，衍生图 ID（0 为原图，>0 为指定 9:16 或 3:4 衍生图）
  - `dl`: 可选，`1` 表示强制下载（触发 `Content-Disposition: attachment`）
  - `token`: 会话 Token

### 4.2 视频封面（Poster）
- **路径**：`GET /api/viewer/assets/:fid/poster`
- **说明**：对视频资产返回由 FFmpeg 动态抽帧生成的高保真首帧封面。

---

## 5. AI 任务全生命周期调度接口 (统一 30001 端口)

### 5.1 提交 AI 处理任务
- **路径**：`POST /api/viewer/ai/tasks`
- **请求体**：
  ```json
  {
    "fid": "local_1234567890",
    "type": "expand",
    "title": "智能物理向外扩图",
    "source_fids": ["local_1234567890"],
    "payload": {
      "expand_ratio": "16:9",
      "perspective_quad": [
        { "x": 25, "y": 30 },
        { "x": 75, "y": 28 },
        { "x": 80, "y": 72 },
        { "x": 20, "y": 75 }
      ]
    }
  }
  ```
- **支持的任务类型 (`type`)**：
  - `spatial_walkthrough`: 室内多空间实景照片拼接漫游成片
  - `remove`: 智能去水印与局部笔刷涂抹消除
  - `insert`: 物理四点透视软装/地毯安装
  - `expand`: 16:9 / 9:16 四向物理画幅智能扩图
  - `upscale`: 2x/4x 超分辨率细节无损放大
- **响应示例**：
  ```json
  {
    "success": true,
    "data": {
      "taskId": "task_1789365197524_b11c6b",
      "fid": "local_1234567890",
      "type": "expand",
      "status": "pending",
      "progress": 0,
      "created_at": 1789365197524
    }
  }
  ```

### 5.2 按任务 ID 查询状态
- **路径**：`GET /api/viewer/ai/tasks/:taskId`
- **状态流转**：`pending` → `running` → `success` / `failed`
- **成功响应**：当 `status === 'success'` 时，`output_fid` 为生成入库的新素材或新衍生图 ID。

### 5.3 资产主动触发画幅重构 (Restage)
- **路径**：`POST /api/viewer/assets/:fid/restage`
- **请求体**：
  ```json
  {
    "ratios": ["9:16", "3:4"],
    "mainRatio": "9:16"
  }
  ```
- **说明**：同步执行或异步提交双画幅无水印重绘，生成并持久化 9:16 与 3:4 标准衍生图。

---

## 6. 相册下载与防重复入库协同规范

### 6.1 客户端下载动作
客户端通过 `uni.downloadFile` 下载云端资产，并通过系统 API 保存至系统公共相册：
- 导出文件名前缀规则：`ML_SAVED_{fid}_{timestamp}.jpg`；
- 导出目录推荐：`DCIM/MaterialLibrary/`。

### 6.2 客户端白名单防重账本
客户端在下载成功的瞬间，将文件名与文件特征写入本地 Storage `local_exported_records`。
相册自动同步服务（`SyncEngine`）在扫描相册目录时：
1. 检查文件名是否以 `ML_SAVED_` 开头，或者是否位于 `MaterialLibrary` 专用目录；
2. 检查本地白名单账本；
3. 命中任意一条即判定为“已归档导出媒体”，直接跳过，杜绝二次上传。

### 6.3 服务端 SHA-256 兜底去重
即使客户端改名或重新移动，服务端在接收相册快照 `POST /api/snapshot` 时，根据文件的 SHA-256 摘要进行全局去重。如果哈希值已存在于 `assets` 或 `derivatives` 表中，服务端自动复用并合并，绝不创建冗余脏数据。
