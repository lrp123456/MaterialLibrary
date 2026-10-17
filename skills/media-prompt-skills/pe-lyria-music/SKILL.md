---
name: pe-lyria-music
description: [已下架废弃归档] Google Lyria 音乐生成提示词优化子 skill。根据决策 D11 全面下架。
deprecated: true
agent_created: true
---

# Lyria 音乐生成提示词优化（Gemini API）

定位：文本或图片 → 44.1kHz 高保真立体声，含人声、对齐歌词与完整器乐编排。模型内部会先规划音乐结构（intro/verse/chorus/bridge）再生成音频，因此**结构写得越清楚，成品越连贯**。

## 一、模型选型

| 模型 | Model ID | 适合 | 时长 | 输出 |
| --- | --- | --- | --- | --- |
| **Lyria 3 Clip** | `lyria-3-clip-preview` | 短片段、循环、试听 | **固定 30 秒** | MP3 |
| **Lyria 3.5** | `lyria-3.5` | 完整歌曲（主歌/副歌/桥段） | 分钟级（用提示词控制） | MP3 |

- 通过 **Interactions API** 调用（`interactions.create`），支持文本与图片输入。
- 响应里可同时取到音频（`output_audio`）与**歌词+结构**（`output_text`）；复杂交错输出需手动遍历 `steps`。

## 二、六段提示框架（按此顺序组织）

1. **Genre 流派** —— 提示词**开头就点明流派**，可混搭、可带年代。
2. **Instruments 乐器** —— 默认按流派配乐器，**非常规乐器必须显式要求**（舞曲不会有萨克斯，除非你写）。
3. **Song structure 曲式** —— 用箭头或列表写段落流向；可写能量变化；可写精确时间点。
4. **Lyrics 歌词** —— 默认自动生成；可自定义、可要求纯器乐、可指定语言。
5. **Vocals 人声** —— 写明歌手的性别、音色、音域。
6. **其他参数** —— BPM、调性、情绪氛围、时长。

## 三、逐段写法（官方要点）

### Genre
- 直接打头：`hip hop` / `rock` / `rap`。
- 可混搭：`A fusion of metal and rap`、`A combination of death metal and opera`、`A classical piece with electronic drone elements`、`Modern electronic dance music (EDM) mixed with Europop`。
- 可加年代：`Early 90s hip-hop`、`60s French ye-ye pop`、`80s electronic experimentation`、`2000s mainstream pop`。
- 小众地域流派（`Berlin techno`、`Bay area hyphy`）模型会尽力还原，但不保证准确。

### Instruments
- 默认不必过度指定；**要特别音色时必须点名**：`A dance track with a driving beat, shimmering synthesizers, and a catchy, anthemic chorus. A saxophone solo should come in during the bridge.`
- 可描述音色与乐器间的相互作用：
  - `A dirty, distorted bassline fighting against clean, crisp hi-hats`
  - `Warm, analog synthesizer pads swelling underneath a dry, intimate acoustic guitar`
  - `A wall of sound created by multiple layers of fuzzy guitars, with buried, distant vocals`

### Song structure
- 箭头式：`[Intro]` -> `[Verse 1]` -> `[Chorus]` -> `[Verse 2]` -> `[Chorus]` -> `[Bridge]` -> `[Outro]`
- 叙述式：`Start with a quiet piano intro, build into a loud verse, drop into a silence, then explode into the chorus.`
- 能量变化：`Build tension in the pre-chorus, then drop to silence before a massive, explosive chorus` / `Gradual crescendo throughout the song, adding one instrument at a time until a chaotic wall of sound` / `Sudden stop after the bridge, followed by an acapella chorus`
- 精确时间点（自然语言即可）：`Build to a drop at 12s`、`Someone says "what" every 2 seconds`、`The chorus kicks in at 22s`

### Lyrics
- **语言＝提示词语言**：用中文写提示词 → 中文歌词。要别的语言就明说：`Write the lyrics in French`。
- **自定义歌词**：用 `Lyrics:` 前缀，并明显与音乐指令分开（换段写）：

```text
Lyrics:

[Intro]
Oooh, oooh

[Verse 1]
Let's go
Let's go
Go with the flow

[Chorus]
...
```

- 段落标签可用 `[Intro]` `[Verse 1]` `[Pre-chorus]` `[Chorus]` `[Outro]`。
- 回声/和声：用括号 —— `Let's go (go)`。
- **让模型写词时必须给主题**，否则它会从音乐提示里猜：
  > The lyrics are about lost love and the pain of heartbreak. The singer is reminiscing about a past relationship and the memories that come flooding back.
- 想要重复副歌就明说：`... A powerful chorus focuses on getting over the pain and moving on.`
- 可要非歌词的人声效果：`A repeating sample from a movie says "I can't believe this!" throughout the song`、`A high energy techno track, right before the drop the sound all stops and a little voice says "I don't know what I'm doing here", then the music drops.`

### Vocals（官方五种配置，直接引用效果最稳）
- **Female Soprano**：Clear, crystalline timbre with an agile, soaring quality. Capable of hitting whistly high notes with an airy, breathy texture.
- **Female Alto**：Rich, warm, and husky lower range. Smoky timbre with a touch of vocal fry, soulful and resonant.
- **Male Tenor**：Bright, piercing, and energetic. Youthful timbre with a slight nasal edge, cutting through the mix with high belting power.
- **Male Baritone**：Deep, chocolatey, and velvet-smooth. Resonant chest voice with a soothing, crooning delivery.
- **Weathered Rocker (Male)**：Raspy and textured with a gravelly timbre, reminiscent of 90s grunge. Strained upper range for emotional intensity.

### 其他参数
- **BPM**：`120 BPM`、`slow tempo around 70 BPM`
- **Key/Scale**：`in G major`、`D minor`
- **Mood**：`nostalgic`、`aggressive`、`ethereal`、`dreamy`
- **Duration**：Clip 固定 30s；Pro 在提示词里写 `create a 2-minute song` 或用时间戳控制

## 四、官方示例（照此密度写）

- `A 30-second lofi hip hop beat with dusty vinyl crackle, mellow Rhodes piano chords, a slow boom-bap drum pattern at 85 BPM, and a jazzy upright bass line. Instrumental only.`
- `An upbeat, feel-good pop song in G major at 120 BPM with bright acoustic guitar strumming, claps, and warm vocal harmonies about a summer road trip.`
- `A dark, atmospheric trap beat at 140 BPM with heavy 808 bass, eerie synth pads, sharp hi-hats, and a haunting vocal sample. In D minor.`
- 极简也可以：`a folk song about cute cats avoiding puddles, female vocals and the noise of rain`
- 结构化长提示词范式：
  > A 1980s-style synth-pop track with a driving beat, shimmering synthesizers, and a catchy, anthemic chorus. The song should have a retro-futuristic feel, reminiscent of classic 80s pop hits, with a modern production polish. The tempo should be upbeat and danceable, around 120 BPM, with a clear verse-chorus structure and a memorable instrumental hook. The lyrics are about the feeling of getting ready for a party.

另外：**可以从图片生成音乐**（把图片作为输入，提示词描述你想要的音乐）。

## 五、最佳实践（官方）

1. **先用 Clip 迭代**：用更快的 `lyria-3-clip-preview` 试提示词，满意后再用 `lyria-3.5` 出完整版。
2. **要具体**：模糊提示词只会得到平庸结果 —— 写明乐器、BPM、调性、情绪、结构。
3. **语言对齐**：要什么语言的歌词，就用什么语言写提示词。
4. **用段落标签**：`[Verse]` `[Chorus]` `[Bridge]` 给模型明确结构。
5. **歌词与指令分离**：自定义歌词必须与音乐指令清晰分开。

## 六、限制

- **安全**：所有提示词过安全过滤；**请求特定歌手音色或生成受版权保护的歌词会被拦截**。
- **水印**：所有音频带 SynthID 音频水印（人耳不可闻）。
- **单轮**：音乐生成是单轮过程，**不支持通过多轮提示词迭代修改已生成的片段**。
- **时长**：Clip 固定 30 秒；Pro 分钟级，靠提示词影响。
- **不确定性**：同一提示词多次调用结果会不同。

## 七、输出前自检

- 流派是否放在开头？非常规乐器是否显式点名？
- 曲式是否写了（箭头或叙述）？需要精确控制时是否加了时间点？
- 歌词语言是否与提示词语言一致（或明确指定了他语言）？自定义歌词是否用 `Lyrics:` 前缀并分段？
- 让模型写词时是否给了主题？想要重复副歌是否明确提出？
- 人声是否给了性别+音色+音域（优先套用官方五种配置）？
- BPM / 调性 / 情绪 / 时长是否补齐？做纯器乐是否写了 `Instrumental only`？
- 有没有触碰安全红线（模仿具体歌手、受版权歌词）？

## 八、交付模板

见 media-prompt-gateway 输出契约。【推荐参数】给出：`model`（`lyria-3-clip-preview` 或 `lyria-3.5`）、输出格式（MP3）、是否需要时长控制、歌词语言。
