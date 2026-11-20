---
name: pe-gemini-omni
description: [已下架废弃归档] Gemini Omni Flash（gemini-omni-1.1-flash）视频生成/编辑提示词优化子 skill。根据决策 D11 全面下架。
deprecated: true
agent_created: true
---

# Gemini Omni Flash 提示词优化

模型：`gemini-omni-1.1-flash`。定位：**原生多模态**（文本/图像/音频/视频同时处理）、**对话式编辑**（多轮改片）、世界知识（物理+文化常识）。提示词写**英文**，附中文对照。

## 一、任务类型与提示词重心

| 任务 | 提示词重心 |
| --- | --- |
| 文生视频 | 场景描述 + 运镜 + 光线 + 情绪 |
| 图生视频 | 说明图片角色（首帧 or 参考），描述"接下来发生什么" |
| 编辑视频 | **提示词要短**，只说要改什么 + 保留什么 |
| 延长视频 | `Extend this video` / `The scene continues` + 后续情节与音频走向 |

## 二、文生/图生视频要点

- 官方建议：`Write prompts with details like scene description, camera movement, lighting and mood for best results.`
- **默认会自动剪成多镜头并编叙事**。要单镜头必须显式写：`In a single unbroken scene` / `In a single continuous shot` / `No scene cuts`。
  官方示例：
  > Continuous, unbroken handheld shot of a fluffy tabby cat sitting on a sunny windowsill, looking out into a leafy garden. The cat's tail twitches slowly, and its ears rotate slightly toward ambient noises. Sunbeams illuminate dust motes in the air. Sound design: Gentle breeze, distant bird chirps. No dialogue.
- **不想要的元素 → 把负向要求写进正文**（该模型不支持 negative prompt / system instruction / temperature / top_p / stop sequences）：
  `No dialogue`、`No embellishments`、`No extra sound effects`，或写成 `Do not do X`。

## 三、编辑提示词（核心规则：越短越好）

官方明确：**编辑用简单提示词效果最好，过度描述会导致意外改动。**
- 好例子：`Make this video anime` / `Put a fashionable hat on this person` / `Change the lighting to be more dramatic` / `Change the text on the sign to say "Omni Flash"`
- **改局部时必须加** `Keep everything else the same`。

官方对照案例（照此改写用户的长描述）：

- ❌ `In the video of the man sitting on the sofa, please add a small black cat that runs from the right side of the screen, jumps onto his lap, and then he starts to stroke its head while looking down.`
  ✅ `Add a cat that jumps onto his lap, he begins to pet it. Keep everything else the same.`
- ❌ `Please remove the cell phone that the person is holding in their hand and fill in the background so it looks like they are just holding their hand empty.`
  ✅ `Make the phone invisible. Keep everything else the same.`

## 四、音频提示

默认会自动配乐，但常常不是你想要的，**要音乐就必须显式写**：
- `Include calm background music`
- `The video has a high energy techno beat`
- `The audio is a low tinny radio broadcast in the background, playing a song`

## 五、时间控制（无专用语法，自然语言即可）

- `After 3 seconds, a woman enters the scene.`
- `At 5s the chorus starts in the background audio.`
- `Every 2s cut to a new frame.`
- `In a rapid fire sequence, every half a second (12 frames at 24fps) change the scene to a new location.`
- 时间码写法：

```text
[0-3s] A person is walking
[3-6s] They stop and turn around
[6-10s] They start running
```

## 六、元提示（提升整体质量）

- `Consider micro-detail, expression and timing to create a very rich, detailed but entirely natural scene.`
- `Be extremely detailed in your descriptions of characters and environments. Apply costume design principles to characters. Be very specific about the people, items and objects in the scene.`
- `Include plenty of appropriate detail in the background elements to make the scene feel realistic and natural.`
- `Make a rapid fire video that shows a different rare [thing] every 1s, upbeat music, include text to label the thing.`

## 七、视频内文字

Omni 能正确、可读地渲染文字；背景里自然出现的文字也建议明确写出内容：
- `One word on the screen at a time: "did, you, know, that, Omni, can, do, awesome, text?" Each word appears for 1s with a different animated style. No dialogue.`
- `There is a street sign that says: "This is an AI generation by Omni", there is a storefront that says: "All you need AI", there's a car with the number plate: "OMNI1.1"`

## 八、素材角色标签（关键，决定素材怎么被用）

### 1）简单标签（推荐）
| 标签 | 作用 |
| --- | --- |
| `<FIRST_FRAME>` | 作为起始帧，如 `<FIRST_FRAME> a woman is walking` |
| `<LAST_FRAME>` | 作为结束帧，**必须与 `<FIRST_FRAME>` 同用** |
| `<IMAGE_REF_N>` | 图像参考（**从 0 开始**），如 `in the style of <IMAGE_REF_0> a woman <IMAGE_REF_1> is walking` |
| `<VIDEO_REF_N>` | 视频参考（**从 0 开始**），如 `the person in <VIDEO_REF_0> is playing the violin` |

多参考图官方示例：
```text
[0-3s] A studio fashion sequence. Starting with woman <IMAGE_REF_0>, she is holding <IMAGE_REF_1>
[3-6s] Then we see the man <IMAGE_REF_2> holding <IMAGE_REF_3>
[6-10s] And finally another woman <IMAGE_REF_4> who is holding <IMAGE_REF_5> while walking.
```

### 2）显式声明（多素材多角色时用，**写在提示词开头**）
- `[# Sources <FIRST_FRAME>@Image1]`
- `[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2]`
- `[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1]`（同图首尾 → 无缝循环视频）
- `[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2]`
- `[# Sources <VIDEO_0>@Video1]`（作为待编辑的主视频）
- `[# Sources <PREVIOUS_VIDEO>@Video1]`（延长上一轮视频）
- `[# References <IMAGE_REF_0>@Image1 <IMAGE_REF_1>@Image2]`、`[# References <VIDEO_REF_0>@Video1]`

配套引导句（写在提示词末尾）：
- 起始帧：`Use this image as the starting frame.`
- 首尾循环：`Use this image as the first frame and the last frame.`
- 图像参考：`Use the given image(s) as references for video generation. The images should not be used as literal initial frames.`
- 视频参考：`Use the given video(s) as references. Do not use them as a source for video editing.`

## 九、延长视频

- 触发：`Extend this video` / `The scene continues`。
- 规格：**每次延长 10s，总长上限 40s**；以原视频**最后 10s** 为上下文保持画面/运动/角色/音频连贯，输入视频的末尾若干帧会被改写以平滑过渡。
- 时间基准：**0s 指延长部分的起点**（延长一个 10s 视频时，`After 2s cut to a new scene` 落在原视频 12s 处）。
- 提示词照旧适用：描述音频走向（`The music continues into the chorus`）、说明是继续还是切新场景（`Show the same characters in the next scene`）、可引入参考素材（`The person shown in the reference image enters the scene`、`The dog in the reference video <VIDEO_REF_0> jumps onto the sofa`）。

## 十、参数速查

| 参数 | 取值 | 备注 |
| --- | --- | --- |
| `model` | `gemini-omni-1.1-flash` | — |
| `response_format.aspect_ratio` | `"16:9"`(默认)、`"9:16"` | 仅这两个值 |
| `response_format.resolution` | `360p` / `720p`(默认) / `1080p`(上采样) / `4k`(上采样) | — |
| `response_format.delivery` | `"uri"` | 视频 >4MB 时用，避免负载上限 |
| `video_config.task` | `text_to_video` / `image_to_video` / `reference_to_video` / `edit` / `extend` | **官方建议优先靠提示词**，只在提示词不生效时才用（该字段会引入约束） |
| `background` / `store` / `stream` | 均设 `false` | 更快；`store=false` 后该视频不能用 `previous_interaction_id` 续编 |

## 十一、限制（写提示词时必须规避）

- **不支持**：negative prompt、system instructions、temperature、top_p、stop sequences（负向要求写进正文）；音频参考上传；YouTube 视频作素材；预置吞吐。
- 输入视频（编辑/延长）上传时**必须 ≤10 秒**；延长**只能续尾**，不能前插或改中段。
- 上传的视频里有人在说话时，**不能延长来加新台词**（角色保持沉默可以；多轮 `previous_interaction_id` 可以）。
- 视频参考最多 **3 段、每段 ≤3 秒**，且只保 likeness，参考视频里的音频被忽略。
- 跨多视频引用/推理不支持。
- 区域限制：EEA / 瑞士 / 英国不能上传并编辑含未成年人的图片，不能编辑/延长**上传**的视频（模型自己生成的视频在这些地区可以）。
- 语言：EN 完整支持，其他语言结果可能有波动。所有输出带 SynthID 水印。

## 十二、输出前自检

- 默认会多镜头 —— 需要单场景时是否写了 `In a single continuous shot` / `No scene cuts`？
- 编辑任务提示词是否已精简到"改什么 + Keep everything else the same"？
- 负向要求是否以正文句子写出（没有用 negative prompt 参数）？
- 素材标签是否用对（`<IMAGE_REF_N>`/`<VIDEO_REF_N>` 从 0 开始；`<LAST_FRAME>` 是否与 `<FIRST_FRAME>` 同用）？多素材时是否在开头写了 `[# Sources ...]` / `[# References ...]` 并配了引导句？
- 要音乐是否显式描述了音频？视频 >4MB 是否用 `delivery: uri`？
- 提示词是否英文 + 中文对照？

## 十三、交付模板

见 media-prompt-gateway 输出契约。【推荐参数】给出：`model`、`response_format`（aspect_ratio / resolution / delivery）、`video_config.task`（如需要）、素材标签清单。
