---
name: pe-gemini-image
description: [已下架废弃归档] Google Gemini（Nano Banana）图像生成与编辑提示词优化子 skill。根据决策 D11 全面下架。
deprecated: true
agent_created: true
---

# Gemini 图像（Nano Banana）提示词优化

模型选择（按任务挑，别默认最贵的）：

| 模型 | ID | 适用 |
| --- | --- | --- |
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | 最快最省；**不擅长多参考图与多轮编辑** |
| Nano Banana 2 | `gemini-3.1-flash-image` | 全能主力：4K、文字渲染、多参考图一致性 |
| Nano Banana Pro | `gemini-3-pro-image` | 最复杂任务：世界知识、本地化、品牌一致性、精细创意控制 |
| Nano Banana（legacy） | `gemini-2.5-flash-image` | 旧版，建议迁移到 2 Lite |

**核心原则：描述场景，而不是罗列关键词。** 一段叙述性的描述几乎总能得到比关键词列表更连贯的图。

## 一、生成类模板（英文提示词）

1. **写实场景**
```text
A photorealistic [type of shot] of a [subject description] in a [setting description]. [Description of the light]. Shot from a [camera angle] with a [lens type].
```
2. **风格插画 / 贴纸**
```text
A [style] of a [subject, with details about accessories or actions] doing [activity]. The design features [visual qualities, e.g., bold outlines, cel-shading] and [color/background preference].
```
3. **图中有准确文字**
```text
Create a [image type] for [brand/concept] with the text "[text to render]" in a [font style]. The design should be [style description], with a [color scheme].
```
> 需要专业文字资产（海报、包装、品牌物料）时用 `gemini-3-pro-image`。文字内容放**双引号**，并说明字体风格、位置与配色。
4. **产品图 / 商业摄影**
```text
A high-resolution, studio-lit product photograph of a [product description] on a [background surface/description]. The lighting is a [lighting setup, e.g., three-point softbox setup] to [lighting purpose]. The camera angle is a [angle type] to showcase [specific feature]. Ultra-realistic, with sharp focus on [key detail]. [Aspect ratio].
```
5. **极简 / 大面积留白**（做背景墙、PPT、文字叠加底板）
```text
A minimalist composition featuring a single [subject] positioned in the [bottom-right/top-left/etc.] of the frame. The background is a vast, empty [color] canvas, creating significant negative space. Soft, subtle lighting. [Aspect ratio].
```
6. **连环画 / 分镜**
```text
Make a 3 panel comic in a [style]. Put the character in a [type of scene].
```
7. **联网检索生图**（新闻、天气、时效性题材）：提示词直接写「Use search to find …」，模型检索后再生成。

## 二、编辑类模板（必须附输入图）

1. **增删元素**
```text
Using the provided image of [subject], please [add/remove/modify] [element] to/from the scene. Ensure the change is [description of how the change should integrate].
```
2. **语义遮罩局部修复（inpainting）**
```text
Using the provided image, change only the [specific element] to [new element/description]. Keep everything else in the image exactly the same, preserving the original style, lighting, and composition.
```
3. **风格迁移**
```text
Transform the provided photograph of [subject] into the artistic style of [artist/art style]. Preserve the original composition but render it with [description of stylistic elements].
```
4. **多图合成**
```text
Create a new image by combining the elements from the provided images. Take the [element from image 1] and place it with/on the [element from image 2]. The final image should be a [description of the final scene].
```
5. **高保真细节保留**（人脸、logo 不能变）
```text
Using the provided images, place [element from image 2] onto [element from image 1]. Ensure that the features of [element from image 1] remain completely unchanged. The added element should [description of how the element should integrate].
```
6. **草图成图**
```text
Turn this rough [medium] sketch of a [subject] into a [style description] photo. Keep the [specific features] from the sketch but add [new details/materials].
```
7. **角色 360° 一致性**：逐角度迭代提示，后续提示里带上之前生成的图；复杂姿势另附姿势参考图。
```text
A studio portrait of [person] against [background], [looking forward/in profile looking right/etc.]
```

## 三、编辑纪律

- **一次只改一件事**，分步改比一条巨型指令成功率高。
- **明确保护对象**：写上 `Keep everything else the same` / `preserve the original style, lighting, and composition` / `Ensure the features remain completely unchanged`。
- **避免自相矛盾**（「夜晚场景」＋「明亮日光」）。
- 支持多轮对话式编辑：下一轮继续基于上一轮结果修改。

## 四、参数与限制

- 输出规格：`response_format: { type: "image", aspect_ratio, image_size }`。
- `aspect_ratio`：1:1（默认，无参考图时）、16:9、9:16、4:3、3:4、3:2、2:3、21:9、1:4、4:1、1:8、8:1、4:5、5:4 等（不同型号支持范围不同；3.1 Flash Lite 新增 1:1/3:2/2:3/3:4/4:3/4:5/5:4/9:16/16:9/21:9）。
- `image_size`：1K / 2K / 4K（3.1 Flash Image 还支持 512px 档）；默认与输入图一致，否则 1:1。
- 参考图：Gemini 3 系列最多 **14 张**（多参考图建议控制在合理数量内，多图一致性优先用 `gemini-3.1-flash-image`）。
- 所有生成图带 **SynthID 水印**（不可见）。
- 输入图片需自行确认版权与合规。

## 五、输出前自检

- 是叙述式描述，不是关键词堆砌？
- 图中的文字是否用双引号、说明了字体与位置？选对模型了吗（专业文字用 Pro）？
- 编辑类是否写明「保持其余不变」并只改一处？
- 多图任务是否说明了「第几张图放什么、放在哪」？
- `aspect_ratio` / `image_size` 是否与用途匹配？

## 六、交付模板

见 media-prompt-gateway 输出契约。**提示词主体写英文**，末尾附一行中文对照。【推荐参数】给出 model、`aspect_ratio`、`image_size`、参考图数量与角色说明。
