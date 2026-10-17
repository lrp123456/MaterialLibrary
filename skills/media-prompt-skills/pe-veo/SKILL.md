---
name: pe-veo
description: [已下架废弃归档] Google Veo 视频生成提示词优化子 skill。根据决策 D11 全面下架。
deprecated: true
agent_created: true
---

# Veo 提示词优化（Gemini API）

定位：原生带音频生成，文本/图片/视频输入。**提示词写英文**（官方仅完整支持 EN），交付时附一行中文对照。Veo 的视频带 SynthID 水印，2 天后从服务器删除。

## 一、模型选型

| 模型 | Model code | 输入模态 | 分辨率 | 时长 | 参考图 | 延长 |
| --- | --- | --- | --- | --- | --- | --- |
| Veo 3.1 | `veo-3.1-generate-preview` | 文生/图生/视频生视频 | 720p / 1080p(仅8s) / 4k(仅8s) | 4 / 6 / 8s | ✔ 最多 3 张 | ✔ |
| Veo 3.1 Fast | `veo-3.1-fast-generate-preview` | 同上（更快更省） | 同上 | 同上 | ✔ | ✔ |
| Veo 3.1 Lite | `veo-3.1-lite-generate-preview` | 文生/图生 | 720p / 1080p(仅8s) | 同上 | ✘ | ✘ |
| Veo 3（已弃用） | `veo-3.0-generate-001` | 文生/图生 | 720p / 1080p | 仅 8s | ✘ | ✘ |
| Veo 3 Fast（已弃用） | `veo-3.0-fast-generate-001` | 文生/图生 | 720p / 1080p | 仅 8s | ✘ | ✘ |

全部版本：24fps、每次请求 1 条视频、音频始终开启、文本输入上限 1,024 tokens。

## 二、七要素结构（官方 prompt writing basics）

| 要素 | 必需性 | 内容 | 示例词 |
| --- | --- | --- | --- |
| **Subject** 主体 | 必需 | 物体/人/动物/风景 | cityscape, nature, vehicles, puppies |
| **Action** 动作 | 必需 | 主体在做什么 | walking, running, turning their head |
| **Style** 风格 | 必需 | 具体电影风格词 | sci-fi, horror film, film noir, cartoon |
| **Camera positioning and motion** 机位与运镜 | 可选 | 机位+运动 | aerial view, eye-level, top-down shot, dolly shot, worm's eye |
| **Composition** 构图 | 可选 | 景别框取 | wide shot, close-up, single-shot, two-shot |
| **Focus and lens effects** 焦点与镜头 | 可选 | 焦段与景深效果 | shallow focus, deep focus, soft focus, macro lens, wide-angle lens |
| **Ambiance** 氛围 | 可选 | 色彩与光线 | blue tones, night, warm tones, natural light, sunrise |

写作要点：
- **用描述性语言**（形容词、副词）把画面讲清楚，而不是堆关键词。
- **强化面部细节**：以面部为焦点时用 `portrait` 等词点明。
- 官方节奏：先定核心想法 → 加修饰词 → 融入视频专用术语。

## 三、详略对比（官方示例，直接照此思路加密度）

**Icicles（要素齐备的紧凑写法）**
> Close up shot (composition) of melting icicles (subject) on a frozen rock wall (context) with cool blue tones (ambiance), zoomed in (camera motion) maintaining close-up detail of water drips (action).

**Man on the phone（详略对比的关键样本）**
- 略：`The camera dollies to show a close up of a desperate man in a green trench coat. He's making a call on a rotary-style wall phone with a green neon light. It looks like a movie scene.`
- 详：`A close-up cinematic shot follows a desperate man in a weathered green trench coat as he dials a rotary phone mounted on a gritty brick wall, bathed in the eerie glow of a green neon sign. The camera dollies in, revealing the tension in his jaw and the desperation etched on his face as he struggles to make the call. The shallow depth of field focuses on his furrowed brow and the black rotary phone, blurring the background into a sea of neon colors and indistinct shadows, creating a sense of urgency and isolation.`

→ 加密度的手法：机位/景别前置 → 服装与场景材质具体化 → 光线来源具体化 → 面部微表情外化 → 景深与背景处理 → 一句情绪收口。

## 四、音频提示（三通道，官方支持）

- **台词 Dialogue**：用引号包住具体说的话 —— `"This must be the key," he murmured.`
- **音效 SFX**：显式描述声音 —— `tires screeching loudly, engine roaring.`
- **环境声 Ambient Noise**：描述环境音景 —— `A faint, eerie hum resonates in the background.`

带台词的完整示例（官方）：
> A wide shot of a misty Pacific Northwest forest. Two exhausted hikers, a man and a woman, push through ferns when the man stops abruptly, staring at a tree. Close-up: Fresh, deep claw marks are gouged into the tree's bark. Man: (Hand on his hunting knife) "That's no ordinary bear." Woman: (Voice tight with fear, scanning the woods) "Then what is it?" A rough bark, snapping twigs, footsteps on the damp earth. A lone bird chirps.

台词可带括号表演指示（`(Voice tight with fear, ...)`），这是 Veo 音频可控性的关键写法。

## 五、素材输入三种用法

1. **首帧（image-to-video）**：输入图作为初始帧 → 挑最接近你要的"开场画面"的图；提示词只写"接下来发生什么"。
2. **参考图（referenceImages，仅 Veo 3.1）**：最多 **3 张**，用于同一个人/角色/产品，Veo 会保持其外观出现在视频里。提示词写"用这些素材做什么"，例如官方示例：`Create a silly cartoon version of the fish wearing the costume, swimming and waving the wand around.`
3. **首尾帧插值（lastFrame）**：`lastFrame` 必须与 `image` 同时使用，用首尾图约束构图；提示词描述中间过程/转场。

## 六、延长（仅 Veo 3.1 / 3.1 Fast）

- 输入：上一段生成的视频 + 可选文本提示；官方写法 `Extend this video with ...`。
- 机制：定稿原视频**最后一秒（24 帧）**并继续动作。**若最后 1 秒没有语音，声音无法被有效延续。**
- 硬约束：延长时必须 `durationSeconds="8"` 且 `resolution="720p"`。
- Veo 3.1 Lite **不支持**延长。

## 七、参数速查

| 参数 | 取值 | 备注 |
| --- | --- | --- |
| `prompt` | string | 支持音频线索；≤1,024 tokens |
| `image` / `lastFrame` | Image object | lastFrame 必须与 image 同用 |
| `referenceImages` | 最多 3 张 | 仅 Veo 3.1 系列 |
| `video` | 上一轮生成的 Video | 仅延长用 |
| `aspectRatio` | `"16:9"`(默认)、`"9:16"` | 全版本支持 |
| `durationSeconds` | `"4"` `"6"` `"8"` | **用延长 / 参考图 / 1080p / 4k 时必须 "8"** |
| `personGeneration` | 文生视频与延长：`"allow_all"`；图生视频/插值/参考图：`"allow_adult"` | 欧盟、英国、瑞士、MENA 只允许 `allow_adult` |
| `resolution` | `"720p"`(默认)、`"1080p"`(仅8s)、`"4k"`(仅8s) | **延长时只能 720p** |
| `seed` | int | 仅 Veo 3 系，不保证确定性，只略微提升 |

## 八、限制（写提示词时必须规避）

- 多视频提示（跨多条视频引用/推理）不支持 → 一条提示词只针对一条视频。
- 语言：EN 完整支持，其他语言未评估。
- 延迟：最短 11 秒，峰值可达 6 分钟。
- 保留：生成视频服务器仅存 2 天。
- 音频报错：Veo 3.1 偶因音频安全过滤/处理问题拦截生成（被拦截不计费）。

## 九、输出前自检

- 七要素里 Subject / Action / Style 是否都在？可选要素是否按需补了机位、构图、镜头、氛围？
- 提示词是否为英文？是否附了中文对照？
- 台词用引号、SFX 与环境声是否显式写出？（Veo 音频不是自动的"锦上添花"，要写才可控）
- 参数互斥是否处理：用参考图/1080p/4k/延长时 `durationSeconds` 是否已改为 `"8"`？延长时 `resolution` 是否 `"720p"`？
- `personGeneration` 是否与任务类型匹配？
- 参考图是否 ≤3 张且属于同一人/物？

## 十、交付模板

见 media-prompt-gateway 输出契约。【推荐参数】给出：`model`（model code）、`aspectRatio`、`durationSeconds`、`resolution`、`personGeneration`、素材槽位（image / lastFrame / referenceImages 数量）。
