# 生成类提示词优化 Skill 套件（media-prompt-skills）

一套「1 个网关 + 11 个模型子 skill」的提示词优化系统。你说清要优化哪个模型的提示词，网关会识别模型 → 加载对应子 skill → 按该模型的**官方文档规范**输出优化后的提示词、可提交参数和优化说明。

全部内容依据官方原文编写：火山方舟《Seedance 2.0 / 2.5 提示词指南》《Seedream 5.0 pro / lite 提示词指南》、Agnes 官方 API 文档与计费规则、Google Gemini API 的 Veo / Omni / Lyria / 图像生成文档。

---

## 一、套件内容

```
media-prompt-skills/
├─ README.md                    ← 本文件（安装与使用说明）
├─ install.ps1                  ← 一键安装脚本（Windows）
├─ media-prompt-gateway/        ← 网关（总入口，负责路由）
│   └─ SKILL.md
├─ pe-seedance25/               ← 方舟 Seedance 2.5
├─ pe-seedance20/               ← 方舟 Seedance 2.0
├─ pe-seedream5-pro/            ← 方舟 Seedream 5.0 pro
├─ pe-seedream5-lite/           ← 方舟 Seedream 5.0 lite
├─ pe-agnes-text/               ← Agnes 文本（2.5 / 3.0 flash）
├─ pe-agnes-image/              ← Agnes 图像（2.5 flash）
├─ pe-agnes-video/              ← Agnes 视频（2.5 flash）
├─ pe-gemini-image/             ← Gemini 图像（Nano Banana 系）
├─ pe-veo/                      ← Google Veo 视频
├─ pe-gemini-omni/              ← Gemini Omni Flash 视频
└─ pe-lyria-music/              ← Google Lyria 音乐
```

每个子 skill 的 `SKILL.md` 都含：**该模型的提示词结构/公式 → 参数速查表 → 官方示例 → 限制与硬约束 → 输出前自检 → 交付模板**。

---

## 二、安装

Skill 只有放到 Agent 的 skills 目录才会被识别。默认装在**用户级**目录（对所有项目生效）：

```
C:\Users\<你的用户名>\.workbuddy\skills\
```

对当前这台机器就是 `C:\Users\lrp\.workbuddy\skills\`。

### 方式 A：一键安装（推荐）

在**本文件夹**打开 PowerShell，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

或在文件资源管理器里按住 `Shift` 右键本文件夹空白处 → 「在此处打开 PowerShell 窗口」→ 粘贴上面那行回车。

脚本做三件事：
1. 把 12 个 skill 文件夹复制到 `~\.workbuddy\skills\`；
2. 覆盖同名旧版本前，先把旧目录重命名备份为 `xxx.bak-时间戳`；
3. 打印安装结果清单。

### 方式 B：手动安装

把 `media-prompt-skills` 里的**12 个文件夹**（`media-prompt-gateway` 及所有 `pe-*`）整个复制到：

```
C:\Users\lrp\.workbuddy\skills\
```

注意：
- 复制的是**文件夹本身**，不是文件夹里的 `SKILL.md`（路径必须是 `skills\pe-veo\SKILL.md`）；
- 如果之前装过旧版本（例如 `skills\pe-veo` 已存在），先删掉或改名，再复制新的，避免新旧混用。

### 方式 C：需要项目级安装时

放到项目目录的 `.workbuddy\skills\` 下即可（路径同结构），只对该项目生效：

```
<你的项目>\.workbuddy\skills\pe-veo\SKILL.md
```

### 安装后验证

**新开一个会话**（技能列表在会话启动时加载，旧会话不会热更新），然后说一句：

> 帮我优化一下 Seedance 2.5 的提示词：一只猫在窗台上晒太阳

预期：网关先识别到 Seedance 2.5，加载 `pe-seedance25`，按四段契约（目标模型 / 优化后提示词 / 推荐参数 / 优化说明）交付。

---

## 三、怎么用

### 1）指定模型（最常用）

```
帮我优化 Veo 的提示词：雨天夜晚的街头，一名男子撑着伞快步走过
帮我写一段 Seedream 5.0 pro 的提示词，要做一张产品海报（附产品图）
把这段提示词改成 Lyria 能用的：轻松愉快的夏天开车旅行歌曲
Agnes 视频，用这张首帧生成一段 5 秒的视频
```

### 2）不指定模型

网关只会**追问一次**并给出选项（视频还是图片？哪一家？）；你说"随便/通用/直接给"时，它会按输出形态取默认（视频→Seedance 2.5，图片→Seedream 5.0 lite）并标注 `[假设]`。

### 3）可以一起给素材

参考图、首尾帧、参考视频、参考音频、原提示词、想要的效果描述都可以一起丢过来。网关会把素材编号写进提示词（各家指代语法不同：方舟 `<图片N>` / `@图片N`，Agnes `<Picture N>` / `<Audio N>`，Omni `<IMAGE_REF_N>` / `<VIDEO_REF_N>`，Veo 走参考图槽位）。

### 4）多模型链路

"先用 Seedream 出图，再用 Seedance 生成视频"这类需求，网关会按链路依次加载多个子 skill，各自按所属模型规范输出。

---

## 四、Agnes 免费档红线（已硬编码进 skill）

| 类型 | 允许 | 限制 |
| --- | --- | --- |
| 文本 | `agnes-2.5-flash`、`agnes-3.0-flash`（¥0） | 禁止推荐 `agnes-2.5-pro` / `pro-beta`（收费） |
| 图像 | `agnes-image-2.5-flash` | 参考图**严格 ≤3 张**（第 4 张起 ¥0.02/张） |
| 视频 | `agnes-video-2.5-flash`（¥0/秒） | `size` 固定 720P、参考图 ≤5、参考音频 ≤3、**禁传参考视频**；禁止推荐 `agnes-video-2.5`（¥0.15/秒起） |

网关和三个 Agnes 子 skill 里都写了"禁止推荐计费模型"，交付时不会给你超预算的方案。

---

## 五、更新与卸载

- **更新**：改这里的 `SKILL.md` 后重新跑一次 `install.ps1`（旧版会自动备份成 `*.bak-<时间戳>`），或直接改 `~\.workbuddy\skills\` 里对应的文件。
- **卸载**：删除 `C:\Users\lrp\.workbuddy\skills\` 下的 `media-prompt-gateway` 和全部 `pe-*` 文件夹即可（备份的 `*.bak-*` 目录可一并删）。
- 各子 skill 的 frontmatter 里带 `agent_created: true` 标记，便于和别人的 skill 区分。

---

## 六、常见问题

**Q：装了没反应？**
A：三查 —— ① 路径是否真的是 `~\.workbuddy\skills\<skill名>\SKILL.md`（多套了一层目录会失效）；② 是否开了新会话；③ frontmatter 的 `name` 是否与目录名一致。

**Q：网关说找不到子 skill？**
A：网关的加载顺序是「先读自己同级目录下的兄弟文件夹」，再回落到 `~\.workbuddy\skills\`。所以只要 12 个文件夹放在同一层就不会找不到；别把子 skill 单独挪走。

**Q：子 skill 能单独触发吗？**
A：设计上由网关路由，正常通过网关调用即可。

**Q：为什么方舟系提示词是中文、Google 系是英文？**
A：方舟 Seedance / Seedream 官方指南以中文自然语言为范例；Google 官方文档明确「EN 完整支持，其他语言未评估」，所以英文更稳，交付时会附中文对照方便核对。Lyria 例外：**歌词语言跟着提示词语言走**，按需切换。

**Q：和已有的 `video-prompt-architect` skill 冲突吗？**
A：两者在 Seedance 上有覆盖重叠。建议明确分工：本套件负责「按官方规范的提示词优化」，`video-prompt-architect` 若保留则用于其它用途；避免同一句话触发两套规则给出不同写法。
