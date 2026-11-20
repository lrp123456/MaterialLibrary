---
name: pe-seedream55
description: Seedream 5.5（火山方舟 doubao-seedream-5-5-261028）图像生成提示词优化子 skill。由 media-prompt-gateway 路由加载，不直接触发。支持文生图、单图/多参考图生图（≤10）、交互编辑、原生 RGBA（文生图与图生图，background auto/transparent/opaque）、图层拆分（1 张底图 + 最多 99 层，layer_decomposition_options.max_images 2–100）和规整文字富文本 OCR。不支持组图、流式、联网。当目标模型为 Seedream 5.5 时按本 skill 改写提示词。
agent_created: true
---

# Seedream 5.5 提示词优化

模型 ID：`doubao-seedream-5-5-261028`。调用 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`。

通用写法与 5.0 相同：主体 + 行为 + 环境，画面文字放英文双引号，参考图用 `@图片N` 且与上传顺序一致，少堆词。中文建议不超过 300 字，英文不超过 600 词。

## 一、交互编辑与多轮编辑

定位方式与 5.0 pro 相同：手绘标记，或归一化坐标 `<point>x y</point>` / `<bbox>x1 y1 x2 y2</bbox>`（0–999）。多主体时点名要改的对象，并写明保持不变的部分。

多轮编辑把上一轮输出当作下一轮的 `image`。每轮写清「改什么」和「保持人物身份、构图、未编辑区域不变」。优先用不带透明通道的图，并把 `background` 设为 `opaque`。

## 二、原生透明底

`background: transparent` 且 `output_format: png`。文生图可以不传 `image`；图生图最多 10 张，输入图不必自带透明通道。`jpeg` 不能配 `transparent`。`auto` 由模型按提示词判断，配 `jpeg` 时结果不含透明通道。图层拆分不要传 `background`。

## 三、图层拆分与文字识别

`layer_decomposition: true`，且只传 1 张 png/jpeg。`prompt` 可省略，省略时模型自动拆主要元素。

- `layer_decomposition_options.max_images`：含底图，范围 2–100，默认 30。值越大通常拆得越细。
- `layer_decomposition_options.text_recognition: true` 时，规整文字图层返回 `text_recognition`（全文、逐行框、字体/颜色/粗体/斜体/下划线/删除线/阴影/半透明）。艺术字和手写不返回。
- `size` 只能是 `1K` / `1.5K` / `2K` / `auto`（默认 `auto`）。

## 四、输出规格

- 生图 `size`：`1K` / `1.5K` / `2K`（默认 `2K`），或总像素 921600–4624220、宽高比 1/16–16 的 `宽x高`。两种写法不要混用。指定了宽高比时，素材库按官方像素表换算后下发像素值。
- `output_format`：`png`（默认）或 `jpeg`。拆分时该字段只决定底图格式，图层始终是 png。
- 参考图最多 10 张。不支持组图、`sequential_image_generation`、流式、联网搜索、4K。
- 素材库默认 `watermark: false`。上游默认是 true，需要「AI生成」角标时再打开。

## 五、输出前自检

- 透明底是否用了 png，且没有误传到图层拆分？
- 图层拆分是否只有一张输入图，`max_images` 是否在 2–100？
- 有没有组图、4K、联网或流式诉求？
- 多轮编辑是否写了本轮修改项和必须保持不变的内容？

## 六、交付模板

见 media-prompt-gateway 输出契约。【推荐参数】给出 model（`doubao-seedream-5-5-261028`）、`size`（优先 `1.5K` 或 `2K`）、`output_format`、`background`、`watermark`、需要时的 `layer_decomposition` 与 `layer_decomposition_options`、参考图清单（≤10）。
