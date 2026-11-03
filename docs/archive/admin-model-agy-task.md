# 管理台模型区执行任务

这份文件是唯一任务说明。执行者没有先前的讨论记录。不要到会话目录里找计划，不要补写这份文件没写的产品规则。

工作目录：`/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer`

管理端是 `web/`，端口 30001。工坊是 `web-pro/`，端口 30002。服务端入口是 `server.js` 与 `src/api.js`。

## 交给 Antigravity

你如果正在执行这份文件，不要再启动另一个 Antigravity，也不要改它的登录和全局权限。监督方用下面的命令把本文件交出去：

```sh
python /home/lrp/.agents/skills/antigravity-cli/scripts/agy.py start \
  --cwd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer \
  --prompt-file /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/docs/design/admin-model-agy-task.md \
  --mode accept-edits \
  --effort high
```

完成后按本文「完成标准」核对 diff 和测试，不要把 helper 的 `completed` 当成验收。

## 目标

把分散的 AI 配置收成管理端「模型」里的三个页签：供应商、模型、工作流。服务端按模型把参数交到厂商。工坊这一轮不改视觉，但目录和生成接口要变成工坊下一轮能直接消费的形状。

## 禁止

- 不发明目录里没有的厂商和模型。不出现 Runway、Sora、Suno、MidJourney、Anthropic。
- 不把「尺寸档写进提示词」写成所有模型的规则。那只是方舟文档的方式 1，已经撤回。
- 不把 Seedream 5.0 Flash 的参数表抄到其他模型。
- 不在页面或数据库保存密钥全文。`.env` 只以变量名被点选。
- 不让适配器 `secrets_json.apiKey` 或 `api_key` 压过接入点的轮询列表。
- 查询串和请求头不是参数的提交位置。鉴权头留在接入点。
- 不新建「调用绑定」页，不恢复 AI 应用、AI 配置，不在系统设置里保留生成模型治理。
- 不画 Stitch 或 Figma。管理端沿用现有 Atelier 深色和横向行，不另起视觉体系。
- 不改 30002 的页面结构、文案和样式。
- 不把 LiteLLM 内部的部署轮换并进我们的密钥轮询。
- 不在人像库页面放第二套地址或 AK/SK 表单。
- 试验场不把结果写回模型或工作流。
- 入库失败不提供「改中间提示词再重跑」。事后拆盒只用在工坊触发。

## 现有代码锚点

先读这些文件，再改。事实以代码为准；和本文冲突时，先停下来说明，不要自行改规则。

| 事实 | 位置 |
| --- | --- |
| 供应商种子：litellm、volcengine、agnes、gemini、groq、kilo、modelscope | `src/providers.js` `DEFAULT_PROVIDERS` |
| Bearer 与 AK/SK 槽位 | `extractCredentialSlots` |
| API Key 轮询已有；适配器钥匙目前优先 | `collectApiKeys`、`pickRoundRobin`、`resolveProviderApiKey` |
| 文本和视觉目前强制走 litellm，缺失即抛 `litellm_disabled` | `resolveLiteLlmChatConfig` |
| 方舟图片组装；`ratio` 会被丢掉，`size` 仍可能是档位字符串 | `src/gen/index.js` `normalizeArkSeedreamPayload` |
| Agnes Image：`size` 为 1K/2K/3K/4K，`ratio` 为白名单 | 同文件 `normalizeAgnesImagePayload` |
| Agnes Video：`aspect_ratio`、`seconds`，`size` 固定 `720P` | `normalizeAgnesVideoPayload` |
| Seedance：`ratio`、`duration`，时长夹在 4 到 12 秒 | `normalizeVolcengineVideoPayload` |
| 豆包音乐：纯音乐 `GenBGMForTime`，人声 `GenSongForTime`，查询 `QuerySong` | `src/doubao-music.js` |
| 音乐时长：纯音乐 30 到 120，默认 60；人声 30 到 240，默认 60 | `buildBgmBody`、`buildSongBody` |
| 人像分组：host `ark.cn-beijing.volcengineapi.com`，service `ark`，version `2024-01-01`，Action `CreateAssetGroup` | `src/portrait-library.js` |
| 签名 | `src/volc-openapi.js` |
| 工坊目录 | `GET /api/studio/catalog`，数据来自 `src/studio-catalog.js` `OFFICIAL_STUDIO` |
| 治理接口 | `/api/governance/gen-models`、`gen-jobs`、`manual-defaults`、`ai-applications` |
| 供应商与适配器 | `/api/providers`、`/api/adapters` |
| 网关配置里的 `content.categories` 没有被读取 | `src/gateway.js`。内容阶段只做文件名降权 |
| 识图分类提示词 | `src/gate-route.js` `GATE_PROMPT` |
| 优化器按模型存 | `gen_polish_prompts`，`src/gen-governance.js` `savePolish`，正文在 `src/polish-prompts.js` |
| 运行行 | `node_runs`：`input_summary`、`output_summary`、状态。没有可编辑提示词列 |
| 管理端导航 | `web/src/App.vue`、路由 `web/src/main.js` |
| 另一套像素表，禁止当作 Seedream 换算表 | `web/src/restage-presets.js` |
| 本机 Umbra 默认 `http://127.0.0.1:3001` | `src/umbra.js`、`src/runtime-config.js` |
| 本机协议 | `src/gen/builtin-protocols.js`：`unified_gateway`、`qwenimage_local`、`doubao_music` |

目录里真实存在、可以挂接的模型包括：对话默认 `agnes3_0flash`；Gemini Flash 与 Flash-Lite 保持注册且 `disabled: true`，选择器里不出现；Gemma 4 26B/31B；`workflow_vision`、`workflow_vision_low`；Doubao-Seed-2.1 lite/turbo/pro。图片默认 `seedream5flash`，厂商 ID `doubao-seedream-5-0-flash-260915`。另有 Seedream 5.0 Pro、Lite，Agnes Image 2.5 Flash。视频默认 `seedance2_0`（Seedance 2.0），另有 Seedance 2.5、Agnes Video 2.5 Flash。音乐默认 `doubao_bgm_v5`，另有 `doubao_song_v5`。向量节点跟随现有作业绑定 `text-embedding-3-small`。

## 三个对象

都在导航项「模型」里。不要合成一张「谁用哪个模型」的大表。

### 供应商

厂商下面是接入点，接入点下面是能力。模型挂在能力上，不挂在厂商名字上。

接入点有：根地址、鉴权种类（Bearer 或 AK/SK）、签名 service、签名 version、凭证引用列表。

凭证：

- API Key 和 AK/SK 都可以多把，按请求轮换。音乐和虚拟人像可以各用各的密钥对。
- 列表项是环境变量名，或已有槽位的掩码。点选变量名算一把钥匙。响应和数据库都不含密钥全文。
- 一次请求只用该接入点自己的列表。

能力是子路径或 OpenAPI Action。同一 host 上的不同 Action 是不同能力，不是第三条根地址。

种子接入点：

1. 火山方舟大模型。根地址 `https://ark.cn-beijing.volces.com/api/v3`。Bearer，变量名 `ARK_API_KEY`。能力：图片 `POST /images/generations`，视频 `POST /contents/generations/tasks`（轮询 `/contents/generations/tasks/{{taskId}}`），对话 `POST /chat/completions`。
2. 豆包音乐。根地址 `https://open.volcengineapi.com`。AK/SK，HMAC-SHA256，service `imagination`，version `2024-08-12`。能力：`GenBGMForTime`、`GenSongForTime`、`QuerySong`。人声不是另一条根地址。当前代码纯音乐走后付费 `GenBGMForTime`，不要改去调预付费 `GenBGM`。
3. 虚拟人像。根地址 `https://ark.cn-beijing.volcengineapi.com`。AK/SK，service `ark`，version `2024-01-01`。能力：`CreateAssetGroup`。和音乐不是同一把密钥列表。
4. 本地网关。默认 `http://127.0.0.1:4000`。Bearer，走该接入点的轮询列表。现有对话和识图模型先挂在它的对话能力上，请求仍进 `:4000`。方舟和 Agnes 的对话能力留着，新模型可以改挂。只有挂在本地网关上的模型才要求网关开着。去掉「LiteLLM 未启用就拒绝一切文本和视觉」的 `litellm_disabled`。
5. 本机。Umbra 默认 `http://127.0.0.1:3001`，Bearer `UMBRA_TOKEN`（或现有 `CREATION_PUBLIC_TOKEN`）。扩图、增、删、改是 Umbra 的能力，通道 id 保持 `umbra.expand`、`umbra.insert`、`umbra.remove`、`umbra.replace`。去水印 `unified_gateway` 是本机的一项能力。清晰度 `local-4x` 也挂在本机。Qwen 协议 `qwenimage_local` 是一条接入点。YOLO 是一条运行时地址接入点。Real-ESRGAN、EdgeSAM 是没有请求 URL 的接入点（在磁盘上或需要下载）。不另做本机开关页。
6. 已经在 `DEFAULT_PROVIDERS` 里的 agnes、gemini、groq、kilo、modelscope 保留为厂商和接入点，地址用代码里的 `base_url`。不要为了整齐删掉它们。Gemini 模型保持停用。

### 模型

一款模型有：显示名、厂商模型 ID、挂在哪项能力、是否启用、参数契约、一份我们写的优化器。

优化器归模型。字段是对话模型 ID 和技能正文，可以按文生图、图生图、图层拆分分叉。工作流和对话只决定这次跑不跑，不另存一份优化提示词。现有 `gen_polish_prompts` 继续按 `model_id` 存。

厂商自带优化是普通参数，不是第二个优化器开关。方舟字段是 `optimize_prompt_options.mode`。默认关。没有该能力的模型不建这个参数。Pro 可选 `standard` 或 `fast`。Flash、Lite、4.5 没有 `fast`。两个都开时：先跑我们的优化器，再在请求体里带厂商字段。

新建模型时可以复制同一能力的上一款，保存后各改各的。

参数字段：

- 名字、含义、类型、默认值、可选值
- 对外或高级。工坊只看到对外。高级的默认在模型页改。节点可以写死任何一个参数的值，不另做一份参数清单
- 提交位置，只有三种：
  - 请求体字段，写明字段名
  - 写进提示词，写明固定句子，例如 `画面比例 {{value}}`。这是新建参数的默认
  - 不提交给厂商
- 可选：换算表、互斥组、条件改交法

写进提示词的句子不出现在模板编辑框和工坊输入框。值为空不拼，不留半句。

不提交给厂商的值只给工作流模板拼可编辑提示词。优化器改得到这段。模板没引用，这次请求里就没有它。试验场没有模板时，这个值不发给厂商。

互斥组：两个参数都要写同一个请求体字段时，收成一组，一次只提交选中的那个。关系记在模型上。Seedream 图片生成不靠这组来做尺寸，见下面的换算。互斥组留给真正会抢同一字段的参数，以及透明底对输出格式的约束。

### 一次提交的顺序

1. 工作流模板拼出可编辑提示词。这里可以引用「不提交给厂商」的参数和节点写死的值。
2. 若节点打开「提交前跑优化器」，或工坊用户按下优化按钮，我们的优化器只改写这一段。优化器看不到图。
3. 对每个「写进提示词」且值非空、又没被条件压住的参数，把固定句子接在优化器后面。
4. 写请求体：直接字段、换算表、条件改交法。
5. 若厂商优化参数开着，带上 `optimize_prompt_options`。

工坊两种开关互不影响：

- 工作流节点的「提交前跑优化器」：开了就自动跑，用户看不到改写。
- 工坊单步的「显示优化按钮」：关了不显示；开了由用户点，点完能看到改写再提交。

### 工坊共有层

只约束工坊上露出什么，不约束厂商字段名。

- 图片生成：每款都有尺寸档和宽高比。交法写在该模型上。
- 视频：每款都有画幅和时长。
- 配乐：每款都有时长。
- 对话：没有共有层。

专用参数只有该模型官方支持才出现，而且必须能配。模型没有的参数不出现。

没有换算表、也没有对应字段时，宽高比再用写进提示词。

## 已核实的交法

这些是代码和已确认文档里的事实。其他模型不要套用。

### Seedream 5.0 Flash

挂在方舟大模型的图片能力。厂商 ID `doubao-seedream-5-0-flash-260915`。

图片生成：尺寸档和宽高比按下面的参考表换成一个 `size=宽x高`。不传档位字符串，不把宽高比接进提示词。表里没有的组合不给选。禁止使用 `web/src/restage-presets.js` 的 720p/1080p/2K/4K 像素。

方舟原文：图片生成的 `size` 支持两种方式，不可混用。本模型的图片生成固定走方式 2 的像素值。方式 2 的总像素区间是 921600 到 4624220，宽高比区间是 1/16 到 16。下表里的值都在这个区间内。

| 尺寸档 | 宽高比 | size |
| --- | --- | --- |
| 1K | 1:1 | 1024x1024 |
| 1K | 4:3 | 1152x864 |
| 1K | 3:4 | 864x1152 |
| 1K | 16:9 | 1424x800 |
| 1K | 9:16 | 800x1424 |
| 1K | 3:2 | 1248x832 |
| 1K | 2:3 | 832x1248 |
| 1K | 21:9 | 1568x672 |
| 1.5K | 1:1 | 1536x1536 |
| 1.5K | 4:3 | 1792x1344 |
| 1.5K | 3:4 | 1344x1792 |
| 1.5K | 16:9 | 2048x1152 |
| 1.5K | 9:16 | 1152x2048 |
| 1.5K | 3:2 | 1872x1248 |
| 1.5K | 2:3 | 1248x1872 |
| 1.5K | 21:9 | 2352x1008 |
| 2K | 1:1 | 2048x2048 |
| 2K | 4:3 | 2368x1776 |
| 2K | 3:4 | 1776x2368 |
| 2K | 16:9 | 2816x1584 |
| 2K | 9:16 | 1584x2816 |
| 2K | 3:2 | 2496x1664 |
| 2K | 2:3 | 1664x2496 |
| 2K | 21:9 | 3136x1344 |

尺寸档默认 2K。可选 1K、1.5K、2K。

图层拆分 `layer_decomposition` 是这款唯一的对外专用参数，布尔，默认 false。

- 打开后：宽高比不提交，工坊不给填。尺寸档改交请求体 `size`，可选 `1K`、`1.5K`、`2K`、`auto`，默认 `auto`。不再查换算表。拆分时 `image` 必填且只能一张。
- 关掉后：恢复只发换算后的像素。

不建这些参数：组图 `sequential_image_generation`、流式 `stream`、联网搜索 `tools`。参考图上限 10，这是能力约束，不是工坊控件。

高级参数，工坊不露出，节点可以写死：

| 参数 | 字段 | 默认 | 约束 |
| --- | --- | --- | --- |
| 透明底 | `background` | `opaque` | 可选 `transparent`。选中后本次 `output_format` 固定 `png`，jpeg 不给选。没有恰好一张参考图时不允许打开 |
| 输出格式 | `output_format` | `jpeg` | `png` 或 `jpeg` |
| 返回格式 | `response_format` | `url` | `url` 或 `b64_json` |
| 水印 | `watermark` | `false` | 沿用当前组装。文档默认是 true，不要改回 true |
| 厂商优化 | `optimize_prompt_options.mode` | 关 | 只有 `standard`，没有 `fast` |

Pro 若单独预填，可以有 `fast`，并且不要把 Flash 的表抄过去之前先核对该模型文档。Lite 的档位是 2K/3K/4K，本任务不要用 Flash 的表填 Lite。

### Agnes Image 2.5 Flash

不建换算表。尺寸档写请求体 `size`，现有白名单 1K、2K、3K、4K，默认 2K。宽高比写请求体 `ratio`，现有白名单 `1:1`、`3:4`、`4:3`、`16:9`、`9:16`、`2:3`、`3:2`、`21:9`。

### 本机 Qwen

换算表写成两个字段 `width` 和 `height`。表的像素用该接入点现有提交逻辑能接受的值，不要套 Seedream 的表。当前提交函数读的就是 `input.width` 和 `input.height`。

### Agnes Video 2.5 Flash

共有画幅写 `aspect_ratio`，现有白名单 `21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`。时长写 `seconds`，现有范围 4 到 12，默认 5。`size` 保持代码里的固定 `720P`，作为高级写死，不进共有层。

### Seedance

共有画幅写现有的 `ratio`。时长写现有的 `duration`，保持 4 到 12 秒的夹取。不要改成 Agnes 的 `aspect_ratio` 或 `seconds`。

### 豆包音乐

共有时长写 `Duration`。纯音乐保持 30 到 120，默认 60，正文仍是 `Text`。人声保持 30 到 240，默认 60。`EnableInputRewrite` 保持高级且默认 false。它不是我们的优化器。`AigcWatermark` 保持当前 false。

## 工作流

三种类型同一页，和画布写同一条流程。画布只改节点顺序和开关。模型、模板、识图要保留的字段、优化器开关、写死的参数在工作流页改。工坊单步没有画布。

### 无人值守

入库是这种。最前一块不调用模型：查重、尺寸、画质、AI 缺陷。阈值沿用 `src/gateway.js` `DEFAULT_CONFIG` 里现有的 dup、size、quality、aiDefect。不要把 `content.categories` 做成可编辑名单，那份 `interior, material, exterior, furniture` 今天没有被读取。

内容分类只在后面的识图节点。类别保持 `GATE_PROMPT`：`interior`、`exterior`、`furniture`、`clothing`、`portrait`，`none` 拒收。`material` 继续收成 `none`。挡下原因仍在运行记录里看。入库失败只按原节点重试，不改中间文字。

识图是独立节点，不放进优化器。节点自选视觉模型，只保留约定字段，模板用变量，例如 `{{sourceStyle}}`。闸门和打标保持这种节点。现有识图模型先挂本地网关。

### 工坊单步

对话、效果图、视频、配乐。只配置：默认模型、允许的模型、是否显示优化按钮、哪些对外参数留给用户、哪些写死。没有画布。

### 工坊触发

风格转换是这种。用户只填对外参数和一句补充。提交后识图、文本节点、生图、模型优化器自动跑。文本节点不是优化器。用户看不到中间结果。

跑完若结果不理想，只拆这一次运行：展开该次识图字段和组装后的提示词，改完从生图步骤重跑。不改工作流模板，不改优化器技能。运行记录和工坊看到同一条链。入口在完成后的结果上。今天的 `node_runs` 没有可编辑提示词，这是新动作。

## 接口

不另起一套平行路由。改现有路由的形状。

### 管理端写

`GET/POST /api/providers`

- 读写厂商、接入点、能力。
- 凭证只出变量名和掩码。
- 方舟三个接入点、本地网关、本机、以及 `DEFAULT_PROVIDERS` 里其余厂商按上文落成行。

`/api/adapters` 不再保存钥匙。适配器页随导航删除。协议执行留在 `src/gen/`。`resolveProviderApiKey` 改为只读接入点轮询列表。

`GET/POST /api/governance/gen-models`

- 改成模型契约：能力 id、厂商模型 ID、启用、参数列表、换算表、互斥组、条件改交法、优化器。
- 复制同能力上一款是这个接口上的一个动作，或管理端先 GET 再 POST。保存后互不影响。

`GET /api/governance/gen-jobs` 与 `manual-defaults`

- 收成一份工作流文档。类型：无人值守、工坊单步、工坊触发。
- 节点字段：模型、模板、写死的参数、提交前是否跑优化器。
- 工坊单步另有默认模型、允许模型、显示优化按钮。
- 入库最前的四项拒收写在入库工作流上。`/api/gateway/config` 可以仍被执行代码读取，但管理界面不再编辑 `content.categories`，也不再从系统设置进模型地址和钥匙。

`/api/governance/ai-applications` 随「AI 应用」页删除。不要留一个没有入口的写接口还在改同一批数据。

### 客户端读

`GET /api/studio/catalog` 仍是工坊和试验场的读入口。每款已启用模型返回：

- id、显示名、种类
- 共有控件：名字、可选值、默认值
- 对外专用参数：同样只有名字、可选值、默认值

不返回提交位置、换算表、条件、密钥、高级参数。节点写死的值由工作流执行时自带。

停用模型不出现。Gemini 的停用模型继续不出现。

### 客户端写

保持入口：

- `POST /api/gen/images`
- `POST /api/gen/videos`
- `POST /api/gen/chat`

请求体带模型 id、可编辑提示词，以及目录里的对外值。工坊不传厂商字段名，不传像素表。

服务端按「一次提交的顺序」组装。旧字段 `ratio`、`size`、`duration` 在这一轮仍要能被认成共有控件的值，因为 30002 还没改视觉。

对话和识图：挂在本地网关的走 `:4000`。挂在别处的走那条接入点。网关关闭只影响挂在它上面的模型。

试验场复用目录和生成入口。请求带一个不落库的标记，结果不写回模型、工作流和优化器。

人像库现有组和素材接口保留。`CreateAssetGroup` 的地址和钥匙只从虚拟人像接入点取。

### 运行

运行记录继续读 `node_runs`。工坊触发增加：读出该次识图字段和最终提示词，提交修改后从生图节点重跑。不更新模板，不更新优化器技能。

## 页面

30001，`web/`。左侧保留：工作流画布 `/workflow`、运行与异常 `/runs`、模型、AI 试验场 `/lab`、人像库 `/portraits`、系统设置 `/settings`。

拿掉：AI 应用 `/ai-apps`、AI 配置 `/adapters`、系统设置里的生成模型治理。设置只留账号、标签字典、并发和端口、存储、备份槽、快照、向量重算的触发。地址、密钥、用哪款向量模型不在设置里。向量模型是入库工作流里的语义向量节点。

视觉：继续用 `web/tailwind.config.js` 里的 Atelier 色和现有字体。供应商列表用横向行：主名字，下面一行小号等宽地址，状态用小标签，操作在行尾。不要做新的仪表盘、不要加假指标。

模型内三个页签：

1. 供应商。一行一个接入点。展开后是能力列表和凭证引用。点选环境变量名。这一页不编辑模型参数。
2. 模型。一行一款，写明挂在哪项能力。详情编辑参数契约、换算表、互斥、条件改交法、优化器技能。新建可复制同能力上一款。只有 Seedream 5.0 Flash 预填上文那张表。
3. 工作流。三种类型同一页。无人值守最前是四项拒收，后面是识图等节点。工坊单步是表单。工坊触发是识图、文本、生图和优化器开关。画布入口仍在 `/workflow`，只改顺序和开关。

运行与异常保持结果列表。工坊触发的一条运行可以展开并重跑。试验场选一款已启用模型，按目录填一次，可选跑优化器，没有保存按钮。人像库只管组、同意书和素材。

30002 不改 Vue。它继续调用目录和 `/api/gen/*`。目录里新增的字段留给下一轮工坊。

## 实施顺序

按这个顺序做，做完一步再做下一步。

1. 让模型能解析到接入点、鉴权种类、能力路径或 Action。钥匙只来自该接入点列表。先写这一刀的失败测试，再让它通过。断言至少覆盖：Seedream Flash 走到方舟图片路径和 Bearer；豆包纯音乐走到 `GenBGMForTime` 和该接入点的 AK/SK；适配器上的旧 `apiKey` 不参与挑选；本地网关关闭时，挂在方舟对话能力上的模型不会因为 `litellm_disabled` 失败。
2. 提交组装：模板、优化器、空值不拼、换算、图层拆分改交法、透明底固定 png。用纯函数测 Seedream Flash 的三行：2K 加 9:16 得到 `size=1584x2816` 且 prompt 里没有比例句；拆分打开得到 `size=auto` 且没有宽高比；透明底把 `output_format` 收成 `png`。
3. 把组装接进 `/api/gen/images`、`/api/gen/videos`、`/api/gen/chat`。旧的 `ratio` 和 `size` 仍能进共有控件。
4. 改 `/api/studio/catalog` 的返回形状。高级参数和交法细节不出现。
5. 改管理端三个页签，并删掉两个旧导航和设置里的生成模型治理。
6. 工作流三种类型、入库最前四项、识图分类仍只用 `GATE_PROMPT` 那一份。
7. 工坊触发的单次拆盒。入库不走这条。

不要在第 1 步之前改 Vue。不要为了第 7 步去改 30002 的视觉。

## 完成标准

- 上文第 1 步和第 2 步的测试通过，并且没有改测试去迁就错误结果。
- `resolveProviderApiKey` 不再读取适配器钥匙。
- `resolveLiteLlmChatConfig` 不再对所有文本和视觉抛 `litellm_disabled`。
- Seedream Flash 图片生成请求体的 `size` 是表中的 `宽x高`，不是 `2K` 这种档位，prompt 不含「画面比例」。
- 管理端导航没有 AI 应用、AI 配置、生成模型治理。模型页能看见三个页签。
- 供应商响应里搜不到密钥全文。
- `web-pro/` 没有样式和结构 diff。
- 没有新增 Runway、Sora、Suno、MidJourney、Anthropic。
- 30001 和 30002 若原本在跑，不要为了这次任务重启它们，除非测试必须起一个独立端口。不要占用 30001 和 30002。

## 仍留给以后

- 30002 按新目录画出共有控件。这一轮服务端已经认旧字段。
- Seedream Pro、Lite 的换算表。不要用 Flash 的表填上去。
- 记忆文件 `topics/model-admin.md` 等这份实现被接受后再改。
