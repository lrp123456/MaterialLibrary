---
name: pe-agnes-text
description: Agnes 文本模型（agnes-2.5-flash / agnes-3.0-flash）提示词优化子 skill。由 media-prompt-gateway 路由加载，不直接触发。免费档硬约束：仅使用两个 flash 模型（现价 ¥0），禁止推荐 agnes-2.5-pro/pro-beta（收费）。含官方提示词结构 [角色]+[任务]+[上下文]+[要求]+[输出格式]、Thinking 模式用法、API 参数（temperature/top_p/max_tokens/stream/tools）、512K 上下文与 65.5K 最大输出。
agent_created: true
---

# Agnes 文本模型提示词优化

适用模型：`agnes-2.5-flash`（通用/编码/智能体）、`agnes-3.0-flash`（新一代，强化 Agent 任务执行与工具编排）。

**免费档红线：两个 flash 现价均 ¥0；禁止推荐 agnes-2.5-pro（¥3/¥6 每 M）与 agnes-2.5-pro-beta（收费）。**

## 一、官方提示词结构

```text
[角色] + [任务] + [上下文] + [要求] + [输出格式]
```

五段缺一不可，用户给的粗糙需求要按这五段补齐（缺的信息若无法推断，标 `[待确认]` 并追问，不许瞎编）。

| 段 | 作用 | 写法 |
| --- | --- | --- |
| 角色 | 设定专业视角 | `你是一名产品营销专家` / `你是一个自主调研智能体` |
| 任务 | 一句话说清要产出什么 | `为一款 AI 助手应用撰写简洁的应用商店描述` |
| 上下文 | 背景、素材、已有条件 | `产品定位是……，目标用户是……` |
| 要求 | 语气、篇幅、约束、禁忌 | `语气清晰、专业、用户友好` / `先解释原因，再给出修复代码` |
| 输出格式 | 结构、字段、能否 Markdown | `输出不超过 150 字` / `以结构化格式返回并附来源链接` |

## 二、官方示例（照此改写）

- **产品文案**：`你是一名产品营销专家。为一款 AI 助手应用撰写简洁的应用商店描述。语气清晰、专业、用户友好。输出不超过 150 字。`
- **编码任务**：`帮我调试这个 React 组件：点击按钮后状态未更新。先解释原因，再给出修复后的完整代码。`
- **智能体任务**：`你是一个自主调研智能体。检索相关信息，总结关键发现，以结构化格式返回并附来源链接。`

## 三、使用规则

- **选模**：日常对话 / 编码 / 多轮 → `agnes-2.5-flash`；复杂 Agent 任务、多步工具编排、长任务交付 → `agnes-3.0-flash`。
- **system / user 分工**：系统提示词写角色与边界；用户消息写任务与上下文。
- **长任务拆阶段**：拆成可验证的阶段，每轮保留目标、限制条件与关键结果，避免一次性塞满上下文。
- **Thinking 模式**（需要更强推理时建议启用）：
  - OpenAI 格式：`chat_template_kwargs: {"enable_thinking": true}`
  - Anthropic 格式：`thinking: {"type": "enabled", "budget_tokens": 2048}`
  - 常规编码从 2048 起步，复杂任务再提高预算。
- **图像理解**：仅在 messages 中传公开可访问的 `image_url`。

## 四、参数速查

| 参数 | 说明 |
| --- | --- |
| model | `agnes-2.5-flash` / `agnes-3.0-flash` |
| temperature / top_p | 控制随机性；确定性任务（提取、格式转换、代码修复）调低 |
| max_tokens | 最大输出；上限 **65,536**（上下文窗口 **512K**） |
| stream | 流式输出置 true |
| tools / tool_choice | 函数调用；工具描述与 JSON Schema 保持精确聚焦 |
| chat_template_kwargs / thinking | Thinking 模式开关 |

## 五、输出前自检

- 模型名是否 flash（未误推收费 pro）？
- 五段结构是否齐全？"输出格式"段是否明确（长度、结构、是否 Markdown）？
- 长任务是否拆了阶段？需要确定性时 temperature 是否调低？
- 需要更强推理时是否提示开启 Thinking？

## 六、交付模板

见 media-prompt-gateway 的输出契约。【推荐参数】含：model、temperature、max_tokens、是否开 Thinking。
