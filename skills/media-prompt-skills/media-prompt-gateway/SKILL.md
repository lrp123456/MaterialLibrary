---
name: media-prompt-gateway
description: 多模型生成提示词优化网关（总入口）。当用户要求优化/撰写/改写视频、图片、音乐或文本生成提示词，或提到 Seedance、即梦、豆包视频、Seedream、豆包图片、Agnes、豆包音乐、BGM生成、文生视频、图生视频、文生图、图像编辑等时使用。本 skill 识别目标模型并把请求路由到对应的子 skill（pe-seedream5-flash / pe-seedream5-pro / pe-seedream5-lite / pe-seedance20 / pe-seedance25 / pe-doubao-music / pe-agnes-image / pe-agnes-video / pe-agnes-text），再按该模型官方规范输出优化后的提示词、推荐参数与优化说明。
agent_created: true
---

# 生成类提示词优化网关

用户丢过来的东西可能是：一句粗糙想法、一段自己写的提示词、一张参考图、一段参考视频/音频、首尾帧，或"把这个改得更好"的模糊要求。本 skill 不直接产出最终提示词，而是**先判模型、再加载该模型的子 skill、最后按子 skill 的官方规范交付**。

## 工作流程（严格按序）

1. **识别目标模型**：从用户输入匹配下方路由表的别名（模型名、产品名、平台名、"即梦/豆包"等）。
2. **模型缺失 → 追问一次**：只有一个问题，给选项式提问（如"Seedance 2.5 / Seedance 2.0 / Seedream 5.0 pro / lite？"）。用户说"随便/通用/直接给"时，才允许按输出形态选默认（视频→Seedance 2.5，图片→Seedream 5.0 lite）并标注 `[假设]`。
3. **加载子 skill**：读取对应子 skill 的 SKILL.md。优先读本套件同级目录（与网关同父目录的子目录）；若父目录没有，再到 `~/.workbuddy/skills/<子skill名>/SKILL.md` 读取。**必须真正读完再动手**。
4. **按子 skill 规范改写**：结构、句式、模板、参数、限制一律以子 skill 为准；网关不覆盖子 skill 的专业规则。
5. **按输出契约交付**（见下）。

## 路由表

| 用户提到的模型/别名 | 子 skill |
| --- | --- |
| seedream5flash | `pe-seedream5-flash` |
| doubao-seedream-5-0-flash-260915 | `pe-seedream5-flash` |
| seedream5pro | `pe-seedream5-pro` |
| doubao-seedream-5-0-pro-260628 | `pe-seedream5-pro` |
| seedream5lite | `pe-seedream5-lite` |
| seedream_portrait | `pe-seedream5-flash` |
| seedance2_0 | `pe-seedance20` |
| doubao-seedance-2-0 | `pe-seedance20` |
| seedance2_5 | `pe-seedance25` |
| doubao-seedance-2-5 | `pe-seedance25` |
| agnes_image_2_5_flash | `pe-agnes-image` |
| agnes_portrait_2_5 | `pe-agnes-image` |
| agnes_video_2_5_flash | `pe-agnes-video` |
| agnes_text | `pe-agnes-text` |
| doubao_bgm_v5 | `pe-doubao-music` |
| doubao_song_v5 | `pe-doubao-music` |

同一请求涉及多模型（如"先出图再生成视频"）时，**按链路依次加载多个子 skill**，各自按所属模型规范输出。

## 铁律

1. **忠实用户意图**：不得擅自新增角色、物体、背景、字幕、品牌、剧情转折。
2. **模型未定不硬编**：见工作流程第 2 步。
3. **素材与提示词要对应**：用户给了参考图/视频/音频/首尾帧时，必须在提示词里写明素材编号与用途（各模型的指代语法见子 skill）。
4. **参数给具体值**：交付时给出可提交的参数（分辨率、时长、画幅、模式、数量等），不写"适当调整"。
5. **价格与免费档红线**：
   - **Agnes 固定按免费档交付**：文本只用 `agnes-2.5-flash` / `agnes-3.0-flash`；图片只用 `agnes-image-2.5-flash` 且**参考图 ≤3 张**；视频只用 `agnes-video-2.5-flash`（720P、参考图 ≤5、音频 ≤3、禁视频输入）。**禁止推荐计费模型**（`agnes-video-2.5`、`agnes-2.5-pro`）。
   - 方舟 Seedance/Seedream、火山豆包音乐无需在此处做额度限制，按子 skill 的规格给参数即可。
6. **语言规则**：方舟系（Seedance/Seedream/豆包音乐）默认中文提示词；参考图严格使用 `@图片N`。
7. **不堆无效词**：不写"8K、masterpiece、best quality"这类空词，每个词都要对应可执行的画面/动作/镜头/参数控制。

## 输出契约（固定四段）

```text
① 目标模型
模型 ID / 版本 + 任务类型（如：Seedance 2.5 · 参考生视频；agnes-image-2.5-flash · 图生图）
（若含假设，标注 [假设]；若含待确认项，标注 [待确认] 并在末尾追问）

② 优化后的提示词
按子 skill 规定的结构写，可直接复制使用。
（多分镜/多镜头时保持层次清晰；含素材占位符时与其编号一致）

③ 推荐参数
```yaml
model: ...
（该模型的关键参数：分辨率/尺寸、时长、画幅、模式、素材数组、seed、语言等）
```

④ 优化说明
- 改了什么（3-6 条，说明为什么这样改更贴合该模型）
- 还缺什么（需要用户补充才会更准的信息）
```

## 自检（交付前）

- 模型判对了吗？子 skill 真的加载了吗？
- 输出是否严格符合子 skill 的结构与限制（字数上限、符号规范、必须的句式）？
- Agnes 请求是否严格落在免费档内？
- 素材指代写法与该模型一致（`@图片N` / `<图片N>` / `<Picture N>` / `<IMAGE_REF_N>` / 图N，各不相同）？
- 参数是否与任务互斥关系冲突（如 Seedance 编辑任务 ratio 必须 adaptive）？
- 有没有替用户新增他没要的东西？
