---
name: pe-agnes-video
description: Agnes 视频模型提示词优化子 skill（免费档强制 agnes-video-2.5-flash）。由 media-prompt-gateway 路由加载，不直接触发。免费档硬约束：size 固定 720P、参考图 ≤5 张、参考音频 ≤3 段、禁止参考视频、seconds 字符串 "4"-"12"；禁止推荐收费的 agnes-video-2.5。含官方提示词六段顺序（主体场景→动作变化→镜头语言→视觉风格→声音节奏→一致性要求）、text/keyframe/reference 三模式规则、<Picture N>/<Audio N> 素材占位符用法。
agent_created: true
---

# Agnes Video 提示词优化（免费档 = 2.5 Flash）

**免费档红线（硬约束）**：
- 只用 `agnes-video-2.5-flash`（限时 ¥0/秒）；**禁止推荐 `agnes-video-2.5`**（720P ¥0.15/秒起收费）。
- `size` 固定字符串 `"720P"`（其他值 HTTP 400）。
- `reference` 模式：参考图 **≤5 张**、参考音频 **≤3 段**、**禁止传入参考视频**（HTTP 400）。
- `seconds` 用字符串 `"4"`–`"12"`，默认 `"5"`；`n` 固定 1。

## 官方提示词六段顺序（按此组织）

1. **主体与场景**：人物、物体、环境、时间。
2. **动作与变化**：主体如何移动，场景如何变化。
3. **镜头语言**：推/拉/摇/移/跟拍/固定镜头/景别。
4. **视觉风格**：光线、色彩、材质、写实程度、氛围。
5. **声音与节奏**：环境声、动作声，或引用音频素材。
6. **一致性要求**：需保持不变的主体外观、产品细节、构图。

示例（官方）：`雨后的未来城市街道，霓虹灯倒映在地面，一辆银色跑车缓慢驶过，电影级运镜，自然环境声`

## 三种生成模式

| mode | 用途 | 必需媒体 | 不允许字段 |
| --- | --- | --- | --- |
| text | 纯文本生视频 | 无 | first_frame、last_frame、images、audios、videos |
| keyframe | 首帧/尾帧/首尾帧控制 | first_frame 与 last_frame 至少一个 | images、audios、videos |
| reference | 图片或音频参考生成 | images 或 audios 至少一类非空 | first_frame、last_frame、videos |

- 素材占位符：`images` 数组第 N 张 → 提示词写 `<Picture N>`（从 1 开始）；`audios` 第 N 段 → `<Audio N>`。
- reference 模式必须在提示词写明素材用途：`以 <Picture 1> 中的角色和美术风格为参考，角色在花田中自然奔跑，保持外观一致` —— 只上传不解释用途，结果不可控。
- keyframe 写法：`人物从首帧姿态自然转身走向窗边，镜头缓慢推进并平滑过渡到尾帧`。

## 参数速查

| 参数 | 说明 |
| --- | --- |
| model | `agnes-video-2.5-flash` |
| prompt | 六段顺序组织 |
| mode | text / keyframe / reference |
| seconds | 字符串 "4"-"12"，默认 "5" |
| size | 固定 "720P" |
| aspect_ratio | 默认 16:9；21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16（720P 下 16:9 实测 1280x704，9:16 为 720x1280） |
| seed | 整数，复现用 |
| images / audios | reference 模式；≤5 张 / ≤3 段；URL 须公开可访问且任务完成前有效 |

查询任务：`GET /agnesapi?video_id=<ID>&model_name=agnes-video-2.5-flash`（keyframe/reference 必须带 model_name），每 1-2 秒轮询至 completed/failed。

## 输出前自检

- 模型为 flash 且 size=720P？mode 与媒体字段匹配（未混入禁止字段）？参考图/音频数量在限内？占位符编号与数组顺序一致？素材用途已写进提示词？

## 交付模板

见 media-prompt-gateway 的输出契约。【推荐参数】给出可直接提交的 JSON 片段（model/prompt/mode/seconds/size/aspect_ratio/媒体数组）。
