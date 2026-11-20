---
name: create-skill
description: 自动为新引入的生图/生视频/生音乐/对话模型起草与生成专属提示词工程子技能 (Sub-skill)。当用户或管理员要求为新模型接入设计提示词优化规范，或通过官方文档 URL / API 规范起草 Skill 时使用。负责产出符合 media-prompt-skills 契约的子技能目录结构、SKILL.md、模型参数推荐、四段式提示词模板，并自动注册到 model-map.json 与主网关导航。
agent_created: true
---

# 新模型提示词工程技能生成器 (create-skill)

本 Skill 用于将官方技术文档或模型 API 规格转化为标准的提示词工程子 Skill (`pe-<model_code>`)，并接入素材库的统一模型治理体系。

## 目标目录结构

所有生成类子技能统一存放在：
`MaterialLibraryServer/skills/media-prompt-skills/`
每个模型独立子目录：`pe-<model_code>/SKILL.md`

## 工作流程（严格执行）

1. **解析模型元数据**：
   - 提取模型厂商（Volcengine / Agnes / OpenAI / 本地等）、模型标识符 `model_code`（如 `doubao-seedream-5-0-flash-260915`）、模型分类（`image` / `video` / `music` / `chat`）。
   - 提取参数规格：推荐画幅/分辨率（size）、时长（duration）、步数/遵循度、多图参考上限（上限张数与指代语法，如 `@图片N`）。
   - 提取精准编辑模式：`coords_bbox`（外接矩形坐标）、`mask`（遮罩黑白图）、`vlm_text`（视觉语言方位描述）。

2. **生成规范的子技能文档 (`pe-<clean_code>/SKILL.md`)**：
   - 包含严格的 YAML Frontmatter：
     ```yaml
     ---
     name: pe-<clean_code>
     description: <模型名称> 提示词优化与参数推荐子 skill。由 media-prompt-gateway 路由加载，不直接触发。...
     agent_created: true
     ---
     ```
   - 包含核心四段式写作模板：
     - ① 素材绑定（`@图片N` 严格与上传顺序对齐）
     - ② 一句话概述（主体 + 空间场景 + 风格定位）
     - ③ 具体情节与细节（空间透视、材质光影、镜头机位）
     - ④ 结尾环境细节（光影氛围、色温、质感）
   - 包含官方推荐参数 YAML 块。

3. **双向注册与路由更新**：
   - 将模型别名与代码注册进 `skills/media-prompt-skills/model-map.json`：
     ```json
     {
       "<model_id>": "pe-<clean_code>",
       "<model_code>": "pe-<clean_code>"
     }
     ```
   - 触发刷新 `skills/media-prompt-skills/media-prompt-gateway/SKILL.md` 里的「路由表」。

4. **模型废弃与软删除规则**：
   - 当服务端下架或废弃某模型时：
     - 在对应的 `pe-<clean_code>/SKILL.md` 顶部 Frontmatter 写入 `deprecated: true`，保留历史作为归档，不硬删除物理文件。
     - 从 `model-map.json` 中移除该模型的映射键值。
     - 刷新主网关 `media-prompt-gateway/SKILL.md` 的路由表，确保在架路由表只展示健康可用的模型。
