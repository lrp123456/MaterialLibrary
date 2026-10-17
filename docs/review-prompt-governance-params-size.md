# 审查任务：素材库服务端、模型参数契约、客户端对接、仓库体积

你是审查代理。只读审查当前工作区里已经落地的代码，写出审查报告。不要改代码，不要重启 30001 / 30002，不要对活库 `~/.dsh-material-library/material.db` 做写操作。需要核对库时只用只读方式打开（`mode=ro`）。不要把密钥、`.env`、`providers-secrets.json`、数据库文件打进任何压缩包或报告附件。

仓库根：`/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer`
管理端源码：`web/`（页面由 `web/dist` 提供，端口 30001）
用户工作台源码：`web-pro/`（`web-pro/dist`，端口 30002）
同一份 `server.js` 同时听这两个端口，由 `scripts/watchdog.sh` 守护。
数据目录：`~/.dsh-material-library`。`src/db.js` 的 `openDb` 会跑 `migrate`，所以用应用自己的 `openDb` 打开活库等于再迁移一次。

报告用中文，先写结论，再写证据（文件路径和函数名）。每个问题给出：现状、缺口、建议改哪一层。建议停在方案，不要直接改。

---

## 一、已经拍板、不要当成未决问题重开

这些是本轮落地前用户确认过的。审查时核对代码是否做到，不要提出相反方案。

1. 治理只有一个入口：`web/src/views/ModelsView.vue`（AI 治理中心）。适配器页、旧工作流页、设置页不再做模型 / 提示词 / 工作流的活编辑器。运行时读这一套。旧 SQLite 表和已有素材、`tag_dict` 保留。
2. 工作流四层：挂载点、工作流、节点、原子算子。界面是左侧挂载点、右侧阶段卡片加品类分支。不要自由画布。
3. 打标提示词 = 模板 + `{{@dict.维度}}` + 展开预览。生图 / 净画重构 / 编辑的任务句各写一次。模型差异只有三开关，外加该模型自己的一句语法说明：
   - 选区：`coords_bbox` / `coords_point` / `mask` / `vlm_text`。沿用 `src/region-route.js`，不要再写一套平行编译器把它废掉。
   - 参考图：人写 `@图片N`。提交时按 `ref_syntax` 翻译成 `图N`、`<Picture N>` 或保持 `@图片N`。见 `src/prompt-compiler.js` 的 `applyDialectTransforms`。
   - 负向词：`field` 走独立字段，或 `append_prompt` 贴进正文「【严禁出现】」。
4. 提示词优化器是每个模型一份文档，按该模型官方说明写，模式写在这一份里面。不是按厂商一份，不是按按钮一份，也不是一份通用模板。硬编码的 `INDOOR` 前缀已经改成 `PARAM_HYGIENE`（`src/skill-loader.js`、`src/polish-prompts.js`）。
5. 公共提示词片段是库。节点勾选要不要拼上。第一份是「室内实拍真实感」。净画重构、室内生图、室内重绘默认开；视频、音乐、服装、人像默认关。模型本身不决定拼不拼。
6. 「上传模型文档生成优化器草稿」这条路径本轮明确不做。现有 `/governance/draft-from-doc` 留着，不要另起一套。
7. 挂载点试跑是真沙箱：1 到 3 张已有图，可用未保存草稿，不写素材库。`createDerivative` 在 `services.sandbox` 时直接返回，不复制文件。不要把沙箱标志写进进程级共享的 `services` 对象。
8. 净画重构是按所选画幅（9:16 或 3:4）做图生图，提示词要求别改结构。它不是扩图，不能把原图贴回画面中央，不能在前后做模糊垫边。模型返回什么字节就存什么，不裁、不重编码。扩图、精准重绘、全局重绘保持原样，`src/handlers/quick-expand.js` 和 `composeRatioCanvas` 的模糊垫边只留给扩图。
9. 算子对外 id 用下划线：`video_slice`、`ingest_pre_gate`。点号 id 只做查找别名。不要改回 `ingest.asset_pipeline` 这类点号主键。
10. 存量默认入库链只在门禁出去的那条边上插入缺陷质检：落盘 → 门禁 → 缺陷质检 → 质检 → 打标 → 归组 → 净画重构 → 向量 → 备份。不要整图推倒重连，不要把质检挪到门禁前面。`shouldUpgradeDefaultGraph` 不能仅仅因为没有 defect 就重建整张图。
11. 本轮不改 Harmony、MaterialViewer、AlbumSync、`agent-eval-bundle`，也不改 `web-pro` 源码。客户端要配套的改动写进下阶段说明，不要在审查时顺手改这些 App。
12. 明确否决、不要再建议：上 Redis、上 OSS、拆 BFF、删旧表、把原图贴回画面中央、再造一套 JSON Schema 响应格式、金标数据集、把活库和密钥打进代码包。

2026-10-17 已重启过一次。活库当时已经有：`prompt_snippets`（6 条）、`model_contracts.dialect_json`、`workflow_modules.snippet_ids_json`，以及上述缺陷质检插入。打标节点上的 `promptTemplate` 是词典展开后的文本。`prompt_templates.tag_space_interior` 仍保留带 `{{@dict.*}}` 的模板。

已知遗留，审查时要核对是否仍然成立，并判断该不该在下一轮改：

- `prompt_templates.style_restage_dual` 用 `ON CONFLICT DO NOTHING` 播种。活库里原来那句 58 字旧文案还在（「基于原图空间布局与风格特征，重构为适用于移动端展示的沉浸式高清效果图……」）。官方目录 `src/nodes/operator-catalog.js` 里同 id 的模板已经是「以参考图为基准、保持硬装几何结构」那版。节点上挂了 `snippet_interior_realism` 和 `snippet_clean_border`，真正执行时才会拼片段。任务句本身没有换成保持结构版。
- 优化器正文要求人写 `@图片N`，并写明不要改用别的占位符。Agnes 的参考图开关是 `<Picture N>`。这是两步：优化器和人使用内部记号 `@图片N`；`applyDialectTransforms` 在提交时把 `@图片1` 换成 `<Picture 1>`。合同头写在 `src/skill-loader.js` 的 `AT` 常量，会加在每一份 skill 前面。Agnes 图像说明在 `skills/media-prompt-skills/pe-agnes-image/SKILL.md`，正文也已经改成 `@图片N`。管理端把这两段放在同一个编辑框里，没有写明「发出去之前才翻译」，所以看起来互相打架。审查要判断：这层分工是否在界面和文档里说清楚；Agnes 官方若只认 `<Picture N>`，优化器禁止其它占位符会不会让改写模型写出 Agnes 不认、而翻译器又漏翻的句子。
- `executeRestage9x16` 是否仍绕过 `compileNodePrompt`。双画幅路径应走编译。
- 净画衍生物的 mime 若仍写死 `image/jpeg`，模型返回 png / webp 时标签会撒谎。字节本身按「返回什么存什么」保留。

---

## 二、这次要审的主题：模型可配置参数

用户在管理端打开「编辑模型契约」（例如 Agnes Image 2.5 Flash）时，只能改模型 ID、显示名、厂商模型 ID、挂载的接入能力、方言三开关、优化器文档。看不到画幅、清晰度、种子这些参数，也没有地方把一项标成常规或高级，更没有地方写「界面上的值怎样变成真实请求字段」。

请先分清下面两套已经并存的参数，不要再发明第三套。

### 套 A：写死在源码里，工作台真正在用

- 文件：`src/model-schemas.js` 的 `MODEL_SCHEMAS`。
- 形状：`common`（常规）和 `advanced`（高级），外加 `modes`、`slots`、`free`、`submitMap`。
- 例子：Seedance 的常规是分辨率、时长、画幅、同步音频；高级是水印、种子、封装、尾帧。Agnes 图像的常规是 `size`（1K/2K）和 `ratio`；3K/4K 放在 `advanced` 的 `size3k`。Seedream 5.0 Flash 的常规是尺寸档、比例、水印；高级是输出格式、bbox、point。
- 客户端怎么拿到：`GET /api/studio/catalog`（`src/api.js` 约 1536 行）把整份 `MODEL_SCHEMAS` 放进 `data.schemas`。
- `web-pro/src/views/studio/ChatStudio.vue` 读 `catalog.schemas`，用 `common` 画主控件，用 `advanced` 放进「高级」折叠。管理端改数据库不会改变这套控件。

### 套 B：模型契约表，提交请求时在用，管理端没有表单

- 文件：`src/models-contract.js`。种子在 `DEFAULT_MODEL_CONTRACTS`，列在 `model_contracts.params_json`。
- 字段已经有：`key`、`label`、`type`、`default`、`options`、`visibility`（`public` 或 `advanced`）、`location`（`body` / `none` / `prompt`）、`body_field`。
- 画幅和清晰度如何变成请求：`assembleModelPayload`。Seedream 有尺寸换算表 `SEEDREAM_FLASH_SIZE_TABLE`（例如 `2K_9:16` → `1584x2816`），按 `table_mappings.size_ratio` 取值。这张表只属于 Seedream Flash，不要抄到别的模型。Agnes 图像契约的 `size` 选项是 `1K/2K/3K/4K` 且 `visibility: public`，和套 A 里「常规只有 1K/2K、3K/4K 算高级收费档」不一致。
- 保存接口 `saveModelContractData` 能写入 `params_json` 和 `table_mappings_json`，但 `web/src/views/ModelsView.vue` 的契约编辑框没有参数表、没有常规/高级开关、没有换算表。
- `getModelPublicCatalog` 自己的注释写着：不返回提交位置、换算表、条件、密钥、高级参数。它还按种类写死共有控件：图像只抽 `size`+`ratio`，视频只抽画幅+时长，音乐只抽时长。其它 `visibility===public` 的项才进 `public_params`。高级项被丢掉。
- 同一次 `GET /api/studio/catalog` 又把套 A 的完整 `MODEL_SCHEMAS`（含 advanced）附在 `schemas` 上。所以「目录不给高级参数」这句注释，和实际响应是矛盾的。

### 请审查并回答

1. 以哪一套作为唯一事实来源。工作台控件、管理端编辑、真实 HTTP 请求体必须读同一份。说明另一套如何退场，而不是两套长期同步。
2. 常规参数和高级参数的划分规则。常规至少包括：画幅、清晰度或尺寸档、时长，以及用户每次出图都要看见的项。高级包括：随机种子、水印、封装格式、收费档、厂商提示词优化开关。某个官方模型没有的参数不要出现（例如 Seedream 5.0 Flash 没有组图、流式、联网搜索）。
3. 每个参数除了可选值和默认值，还要能表达它怎样进入真实请求：写进 body 的哪个字段、写进 query、写进提示词句子、或只影响模式不进 body（`location: none`）。换算表（尺寸档 × 画幅 → 像素）属于契约的一部分，管理端要能看见，客户端默认接口不要把整张内部表当作用户控件。
4. 客户端应通过一个请求知道「这个模型能配什么」。写清响应里常规、高级、默认值、可选项、锁定规则（例如首尾帧锁死画幅）各在哪个字段。现在 `web-pro`、`app-uniapp`、鸿蒙工程分别读的是哪一个接口，哪些客户端还在写死选项。
5. 管理端缺的编辑能力列成清单：参数增删、常规/高级、默认值、请求位置、换算表、条件互斥。说明现有 `saveModelContractData` 已经能存什么，界面差在哪里。
6. 对照各模型官方能力，列出服务端有、客户端没暴露的，以及客户端写死了、服务端契约里没有的。至少覆盖：Agnes 图像、Seedream Flash / Pro / Lite、Seedance 2.0 / 2.5、豆包音乐、本机 Umbra 与 Qwen。
7. 服务端怎样配合客户端：目录接口给控件，提交接口只接受该模型契约里有的键，未知键拒绝或忽略的规则要写明；节点可以钉死某个常规参数，但不能再维护第二份参数表。工坊单步只展示常规项；高级项默认折叠。优化器开关和厂商 `optimize_prompt_options` 的关系维持已拍板的做法：先跑我们的优化器，厂商优化是模型参数，默认关，模型不支持就不出现。

客户端范围：本轮审查要指出 `web-pro`、`app-uniapp`、仓库里的 `harmony/` 各自缺什么。不要在这次审查里改这些客户端。

---

## 三、服务端整体审查

在不推翻第一节的前提下，把服务端按调用链审一遍，找会让客户端对不上或下一轮启动再次改坏活库的点。

建议沿这几条链走，每条写「谁调用谁、状态存在哪」：

- 管理端保存模型契约 → `model_contracts` → `GET /api/studio/catalog` → 工作台控件 → 用户提交 → `assembleModelPayload` / `src/gen/index.js` → 厂商。
- 提示词：模板 `prompt_templates` → `compileNodePrompt` → 词典展开 → 片段 → 方言三开关 → 发出去的正文。
- 入库：`workflows.default` 与挂载点 `ingest_pre_gate` / `ingest_post_process` 的同步 `syncMountPointsToWorkflowGraph`。确认缺陷质检插入不会在下次启动时再洗掉其它边，也不会把已改过的打标提示词覆盖成残缺模板。
- 净画重构 vs 扩图：`src/ratio.js` 的 `calibrateGeneratedImage` 应只复制字节；`composeRatioCanvas` 的模糊垫边只留在扩图。
- 沙箱：`/governance/sandbox/run-node` 不写衍生物、不改主图。
- 异步能力：同步还是异步写在接入能力上，不写在整个供应商上。现有配方包括方舟视频、Agnes 视频、豆包音乐 QuerySong、本机 Qwen 轮询。审查它们是否仍和契约一致。
- 密钥：库里和接口响应里只有环境变量名或掩码，没有明文。日志不打印 key。

服务端文件很大的热点：`src/api.js`（约 6900 行）、`src/models-contract.js`（约 3500 行）、`src/nodes/index.js`（约 2300 行）。审查是否有两套目录、两套提示词、两套参数各写一摊。指出可以删掉的重复入口，但不要建议删除仍被活库或旧客户端读取的表。

测试：`test/modular-workflow-governance.test.js` 和 `test/suite.js` 已经在临时库上通过过。审查时说明它们覆盖了哪些契约、哪些客户端对接它们没覆盖。不要为了审查去跑会占用 30001 / 30002 的脚本，也不要跑会打开活库的 `scripts/check-users.js` 一类工具。

---

## 四、仓库为什么超过 100MB

2026-10-17 在本机量过，请复核，不要凭这份数字直接删文件。

`src/` 大约 1.8MB，治理改动不是体积来源。`MaterialLibraryServer` 工作区大约 2.7GB，`.git` 大约 411MB。

工作区里的大块：

- `web-pro/public` 与 `web-pro/dist` 各约 455MB。沙发模型 `sofa_default.glb`、`sofa_electric_single.glb`、`sofa_model.glb` 各约 74MB，在 `public/models`、`public/assets-3d` 以及对应的 `dist` 里各有一份。`web-pro/dist/` 和 `web-pro/public/models/` 已在 `.gitignore`。`dist` 是构建产物，磁盘上仍占一份。
- `data/` 约 343MB（本机模型 onnx / bin / pth，以及 data 下的 glb）。整目录已忽略。这是运行所需的模型权重，不是源码。活库 sqlite 不在这个目录，在 `~/.dsh-material-library/material.db`（约 279MB），不要打进仓库。
- `tools/` 约 274MB。Windows 版 ncnn 与 `pnnx.exe` 被 git 跟踪。
- `pack-studio/` 约 332MB。四个 apk 被 git 跟踪：`pack-studio/_shots/base.apk`、`base-with-zip4j.apk`、`zip4j-build/aligned.apk`、`zip4j-build/unsigned.apk`，每个约 75MB。它们也在 `.git/objects` 里。
- `node_modules`：服务端约 82MB，`web/node_modules` 约 113MB，`web-pro/node_modules` 约 135MB。已忽略。
- 仓库根的 `material-library-full-codebase.zip` 约 82MB，已被 `*.zip` 忽略。更早的一份重构 zip 曾到 167MB，是因为打进了活库和密钥；那份不能再打包进仓库。

请回答：

1. 人眼看到的「超过 100MB」到底是工作区、git 历史，还是某一次源码 zip。把三者分开报。
2. 一份给别人审查的源码包，去掉依赖、构建产物、权重、apk、数据库、密钥之后，源码本身有多大。
3. 要让 git 仓库降下来，需要停止跟踪哪些路径。历史里已经提交的 apk 和 ncnn 二进制不会因为加 gitignore 就变小，请说明要不要改历史，以及改历史的风险。
4. 沙发 glb 为什么在 public 里放了两套目录。构建是否必须把它们复制进 dist。给出保留一份的做法。
5. 明确不要删：`~/.dsh-material-library` 活库、`data/local-models` 里正在用的推理权重、任何密钥文件。不要为了变小去跑 `git filter-repo` 除非报告里把影响写清并等用户确认。

---

## 五、报告格式

按这个顺序写：

1. 结论（半页以内）：参数事实来源该收成哪一套；客户端现在实际读哪套；服务端与已拍板约定不一致的条目；体积的主因。
2. 参数契约：套 A 与套 B 的差异表（至少含 Agnes 图像的尺寸档、Seedream 的像素换算、Seedance 的种子和画幅锁定）。
3. 客户端对接：每个客户端读哪个接口、缺哪些能力。本轮不改客户端，只列出下一阶段要改的文件。
4. 服务端审查：与第一节逐条对照，做到的打勾，没做到的写文件和函数。
5. 体积：可移除项、必须保留项、源码包建议包含和排除的路径。
6. 风险：哪些建议一改就会在下次进程启动时改写活库的 `workflows.default`。

不要输出密钥，不要建议把数据库或 `node_modules` 提交进 git。
