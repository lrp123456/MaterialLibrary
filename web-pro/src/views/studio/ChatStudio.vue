<template>
  <div class="chat-root flex-1 min-h-0 flex overflow-hidden bg-studio-950 font-sans text-slate-100 text-sm">
    <!-- ========================================================================= -->
    <!-- 1. 左侧抽屉栏：豆包/千问双模式（会话历史 / 我的创作库） -->
    <!-- ========================================================================= -->
    <aside class="w-80 bg-studio-900 border-r border-studio-750 flex flex-col justify-between shrink-0 select-none">
      <div class="flex flex-col flex-1 overflow-hidden">
        <!-- 侧栏顶部 Tab：会话历史 vs 我的创作库 -->
        <div class="p-3 border-b border-studio-800 flex items-center justify-between bg-studio-950/60">
          <div class="flex items-center space-x-1.5 flex-1 min-w-0">
            <span class="px-2.5 py-1.5 rounded-lg bg-studio-800 text-white text-xs font-bold border border-studio-700 flex items-center space-x-1.5 shrink-0 shadow-xs">
              <StudioIcon name="history" :size="14" class="text-studio-accent" />
              <span>对话历史</span>
            </span>

            <button
              type="button"
              @click="openCreationLibraryModal"
              class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-studio-accent/20 hover:bg-studio-accent/30 text-studio-accent hover:text-white border border-studio-accent/40 text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs truncate group"
              title="点击直接打开全屏创作库弹窗"
            >
              <StudioIcon name="wand" :size="13" class="group-hover:rotate-12 transition-transform" />
              <span class="truncate">我的创作库</span>
              <span class="text-[10px] opacity-75 font-mono">⛶</span>
            </button>
          </div>

          <button
            @click="createNewSession"
            class="p-2 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 text-xs border border-studio-700 transition-all cursor-pointer shrink-0"
            title="新建对话"
          >
            <StudioIcon name="plus" :size="14" />
          </button>
        </div>

        <!-- 模式 A：对话历史列表 -->
        <div class="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin">
          <div v-if="sessions.length === 0" class="text-center py-12 text-xs text-slate-500">
            暂无历史对话
          </div>
          <div
            v-for="s in sessions"
            :key="s.id"
            @click="selectSession(s)"
            :class="[
              'group px-3.5 py-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between text-xs',
              currentSessionId === s.id
                ? 'bg-studio-850 border-studio-accent text-white font-bold shadow-md'
                : 'bg-studio-950/50 border-studio-800 hover:bg-studio-850 hover:border-studio-700 text-slate-300'
            ]"
          >
            <div class="flex items-center space-x-2.5 truncate">
              <StudioIcon name="chat" :size="15" :class="currentSessionId === s.id ? 'text-studio-accent' : 'text-slate-500'" />
              <span class="truncate font-medium">{{ s.title }}</span>
            </div>
            <button
              @click.stop="deleteSession(s.id)"
              class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1 transition-opacity cursor-pointer"
            >
              <StudioIcon name="close" :size="12" />
            </button>
          </div>
        </div>
      </div>

      <div class="p-3 bg-studio-950/80 border-t border-studio-800 text-xs text-slate-400 flex items-center justify-between">
        <button
          type="button"
          @click="openCreationLibraryModal"
          class="flex items-center gap-1.5 text-slate-300 hover:text-studio-accent cursor-pointer transition-colors"
          title="点击直接打开全屏创作库"
        >
          <StudioIcon name="wand" :size="14" class="text-studio-accent" />
          <span># 创作库 · @ 引用素材</span>
        </button>
        <span class="text-[11px] font-mono text-emerald-400 font-bold">DAM 数据库已连接</span>
      </div>
    </aside>

    <!-- ========================================================================= -->
    <!-- 2. 中央核心工作区：空状态【大号参考图主工作台】 VS 消息流 -->
    <!-- ========================================================================= -->
    <main class="chat-main flex-1 flex flex-col justify-between overflow-hidden bg-studio-950 relative p-4 space-y-3">
      <!-- 2.1 中间工作区：空状态居中灵感与参考看板 VS 真实消息流 -->
      <div class="relative flex min-h-0 flex-1 flex-col">
      <div
        ref="messageScroller"
        class="chat-scroll flex-1 overflow-y-auto px-2 space-y-4 scrollbar-thin"
        @scroll.passive="onChatScroll"
      >
        <!-- 空状态展示 (根据当前底部选中的主模式，展示不同形态的大号参考图工作台！) -->
        <div v-if="messages.length === 0" class="h-full flex flex-col items-center justify-center text-center max-w-4xl mx-auto py-4 space-y-5 select-none">
          <!-- A. 纯对话模式 (默认) -->
          <template v-if="activeModality === 'chat'">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-xl">
              <StudioIcon name="chat" :size="32" />
            </div>

            <div class="space-y-1">
              <h2 class="text-xl font-extrabold text-white tracking-tight">室内空间 AI 智能多模态对话中枢</h2>
              <p class="text-xs text-slate-400 leading-relaxed max-w-xl">
                支持直接在下方输入框中提问，或从私有素材库选取实景图进行空间诊断、色彩分析、软装搭配评估与提示词润色。
              </p>
            </div>

            <!-- 大号参考图/问答图卡槽 (类似 App 居中大号展示) -->
            <div class="w-full max-w-2xl p-4 rounded-2xl bg-studio-900 border border-studio-750 shadow-lg space-y-3 text-left">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-2">
                  <span>🖼️ 空间多模态问答参考图 (可选)</span>
                  <span class="text-studio-cyan font-mono text-xs">{{ referenceTray.length > 0 ? '已载入 1 张' : '未挂载' }}</span>
                </span>
                <span class="text-[11px] text-slate-400">挂载后 AI 将结合视觉画面回答问题</span>
              </div>

              <div class="flex items-center space-x-3">
                <div
                  v-if="referenceTray.length > 0"
                  class="relative w-32 h-32 rounded-xl overflow-hidden border-2 border-studio-accent bg-studio-950 shrink-0 group shadow-md cursor-pointer"
                  @click="openMediaPreview(referenceTray[0], 'image')"
                >
                  <img :src="referenceTray[0].url" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  <div class="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2 text-xs">
                    <div class="flex items-center justify-between text-white">
                      <span class="font-bold truncate">{{ referenceTray[0].name }}</span>
                      <button @click.stop="openMediaPreview(referenceTray[0], 'image')" class="p-1 rounded bg-black/60 text-studio-cyan hover:text-white" title="查看大图">🔍</button>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-[10px] text-slate-300 underline font-mono">点击预览</span>
                      <button @click.stop="removeRef(0)" class="text-rose-400 hover:text-rose-300 font-bold cursor-pointer">移除 ✕</button>
                    </div>
                  </div>
                </div>

                <button
                  v-else
                  @click="openAssetSelectorModal"
                  class="w-32 h-32 rounded-xl border-2 border-dashed border-studio-600 hover:border-studio-accent bg-studio-950/70 hover:bg-studio-950 flex flex-col items-center justify-center text-slate-400 hover:text-studio-accent space-y-2 shrink-0 transition-all cursor-pointer group"
                >
                  <div class="w-9 h-9 rounded-full bg-studio-800 group-hover:bg-studio-accent/20 flex items-center justify-center">
                    <StudioIcon name="plus" :size="18" />
                  </div>
                  <span class="text-xs font-bold">选择分析图片</span>
                </button>

                <div class="flex-1 space-y-2 text-xs text-slate-400">
                  <p class="leading-relaxed text-slate-300">
                    💡 您可以在右侧快速点击常见空间设计问题，或在底部输入框输入：
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="q in chatQuickStarters"
                      :key="q"
                      @click="applyPromptText(q)"
                      class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-200 border border-studio-750 text-xs text-left cursor-pointer transition-all"
                    >
                      {{ q }} ➔
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- B. 图像生成模式 (大号参考生图工作台，对齐 App) -->
          <template v-else-if="activeModality === 'image'">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-studio-accent to-studio-cyan flex items-center justify-center text-white shadow-xl">
              <StudioIcon name="wand" :size="32" />
            </div>

            <div class="space-y-1">
              <h2 class="text-xl font-extrabold text-white tracking-tight">AI 空间图像创作工作台</h2>
              <p class="text-xs text-slate-400 leading-relaxed max-w-xl">
                参考下方大号槽位中的真实素材，在提示词中键入 @ 可直接挂载图文混排胶囊（如“参考@图1的采光，加入@图2的沙发”）。
              </p>
            </div>

            <!-- 大号参考生图槽位。上限只读契约；契约没写张数时不显示分母。 -->
            <div class="w-full max-w-3xl p-4 rounded-2xl bg-studio-900 border border-studio-750 shadow-xl space-y-3 text-left">
              <div class="flex items-center justify-between">
                <span class="text-xs font-extrabold text-white flex items-center gap-2">
                  <span>🖼️ 参考生图 / 素材挂载 (可选)</span>
                  <span class="text-studio-cyan font-mono font-bold">{{ referenceTray.length }}<template v-if="refCap() != null">/{{ refCap() }}</template></span>
                </span>
                <span class="text-[11px] text-slate-400">
                  大号槽位已连接私有 DAM 素材库，点击可从素材库选择或本地上传
                </span>
              </div>

              <!-- 大号参考图槽位带 (至少 110px x 110px) -->
              <div class="flex items-center space-x-3.5 overflow-x-auto py-2 scrollbar-none">
                <!-- 已载入的大号参考图卡片 -->
                <div
                  v-for="(refItem, idx) in referenceTray"
                  :key="refItem.name + idx"
                  class="relative w-28 h-28 rounded-xl overflow-hidden border-2 border-studio-accent bg-studio-950 shrink-0 group shadow-lg cursor-pointer"
                  @click="openMediaPreview(refItem, refItem.kind === 'video' ? 'video' : 'image')"
                >
                  <img :src="refItem.url" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  <!-- 遮罩与权重/移除/大图预览 -->
                  <div class="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2 text-xs">
                    <div class="flex justify-between items-center text-white">
                      <span class="truncate font-bold">@图{{ idx + 1 }}</span>
                      <div class="flex items-center space-x-1.5">
                        <button @click.stop="openMediaPreview(refItem, refItem.kind === 'video' ? 'video' : 'image')" class="text-studio-cyan hover:text-white font-bold cursor-pointer" title="查看高清大图">🔍</button>
                        <button @click.stop="removeRef(idx)" class="text-rose-400 hover:text-rose-300 font-bold cursor-pointer" title="移除">✕</button>
                      </div>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-studio-cyan font-mono font-bold text-[10px]">
                        权重: {{ refItem.weight }}%
                      </span>
                      <span class="text-[10px] text-slate-300 underline font-mono">点击预览</span>
                    </div>
                  </div>
                  <span class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] text-white font-mono group-hover:opacity-0 truncate max-w-[90%]">
                    @图{{ idx + 1 }}: {{ refItem.name }}
                  </span>
                </div>

                <!-- 大号添加参考图插槽 -->
                <button
                  v-if="refCap() == null || referenceTray.length < refCap()"
                  @click="openAssetSelectorModal"
                  class="w-28 h-28 rounded-xl border-2 border-dashed border-studio-600 hover:border-studio-accent bg-studio-950/70 hover:bg-studio-950 flex flex-col items-center justify-center text-slate-400 hover:text-studio-accent space-y-2 shrink-0 transition-all cursor-pointer group"
                >
                  <div class="w-10 h-10 rounded-full bg-studio-800 group-hover:bg-studio-accent/20 flex items-center justify-center">
                    <StudioIcon name="plus" :size="20" />
                  </div>
                  <span class="text-xs font-bold">添加参考</span>
                </button>
              </div>

              <!-- 4 组图像创作灵感快捷起手 -->
              <div class="grid grid-cols-2 gap-2.5 pt-2 border-t border-studio-800">
                <div
                  v-for="rec in imageQuickStarters"
                  :key="rec.title"
                  @click="applyQuickStarter(rec)"
                  class="p-2.5 rounded-xl bg-studio-950/60 border border-studio-750 hover:border-studio-accent hover:bg-studio-850 cursor-pointer transition-all space-y-1 group"
                >
                  <div class="text-xs font-bold text-white group-hover:text-studio-accent flex items-center justify-between">
                    <span>{{ rec.title }}</span>
                    <span class="text-xs opacity-75">➔</span>
                  </div>
                  <p class="text-[11px] text-slate-400 line-clamp-1 leading-relaxed">{{ rec.desc }}</p>
                </div>
              </div>
            </div>
          </template>

          <!-- C. 视频生成模式 (首尾帧 / 全能参考大号双槽位) -->
          <template v-else-if="activeModality === 'video'">
            <div class="w-16 h-16 rounded-2xl bg-studio-accent flex items-center justify-center text-white shadow-xl">
              <StudioIcon name="film" :size="32" />
            </div>

            <div class="space-y-1">
              <h2 class="text-xl font-extrabold text-white tracking-tight">影视级空间 AI 视频动态中枢</h2>
              <p class="text-xs text-slate-400 leading-relaxed max-w-xl">
                支持首尾帧平滑过渡、运镜轨迹控制与空间音频同步生成，构建影视级漫游视频。
              </p>
            </div>

            <!-- 视频大号槽位工作台 (支持首尾帧双槽位 / 全能槽位) -->
            <div class="w-full max-w-3xl p-4 rounded-2xl bg-studio-900 border border-studio-750 shadow-xl space-y-3.5 text-left">
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                  <span class="text-xs font-bold text-white">视频动态构建模式:</span>
                  <div class="flex items-center space-x-1 bg-studio-950 p-1 rounded-lg border border-studio-750">
                    <button
                      @click="setGenMode('first_last_frame')"
                      :class="['px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer', activeGenMode === 'first_last_frame' ? 'bg-studio-indigo text-white shadow-sm' : 'text-slate-400 hover:text-white']"
                    >
                      🎞️ 首尾帧过渡
                    </button>
                    <button
                      @click="setGenMode(activeModality === 'video' && currentSchema?.modes?.some((mode) => mode.id === 'omni_reference') ? 'omni_reference' : 'image_to_video')"
                      :class="['px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer', activeGenMode === 'omni_reference' || activeGenMode === 'image_to_video' ? 'bg-studio-indigo text-white shadow-sm' : 'text-slate-400 hover:text-white']"
                    >
                      🎬 全能多参考
                    </button>
                    <button
                      @click="setGenMode('text_to_video')"
                      :class="['px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer', activeGenMode === 'text_to_video' ? 'bg-studio-indigo text-white shadow-sm' : 'text-slate-400 hover:text-white']"
                    >
                      ✍️ 文生视频
                    </button>
                  </div>
                </div>

                <span class="text-[11px] text-studio-cyan font-mono font-bold">Seedance 2.5 驱动</span>
              </div>

              <!-- 若是首尾帧模式：并列展示两大核心卡槽 -->
              <div v-if="videoSubMode === 'first_last'" class="grid grid-cols-2 gap-4">
                <!-- 首帧槽位 -->
                <div class="p-3 rounded-xl bg-studio-950 border border-studio-750 flex flex-col items-center justify-center space-y-2 relative group min-h-[140px]">
                  <span class="text-xs font-bold text-white self-start">🎬 起步首帧 (Start Frame):</span>
                  <div v-if="referenceTray[0]" class="relative w-full h-24 rounded-lg overflow-hidden border border-studio-accent group cursor-pointer" @click="openMediaPreview(referenceTray[0], 'image')">
                    <img :src="referenceTray[0].url" class="w-full h-full object-cover" />
                    <div class="absolute top-1 right-1 flex items-center space-x-1">
                      <button @click.stop="openMediaPreview(referenceTray[0], 'image')" class="p-1 rounded bg-black/70 text-studio-cyan text-xs cursor-pointer" title="查看大图">🔍</button>
                      <button @click.stop="removeRef(0)" class="p-1 rounded bg-black/70 text-rose-400 text-xs cursor-pointer">✕</button>
                    </div>
                    <span class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] text-white">@首帧: {{ referenceTray[0].name }}</span>
                  </div>
                  <button
                    v-else
                    @click="openAssetSelectorModal"
                    class="w-full h-24 rounded-lg border-2 border-dashed border-studio-700 hover:border-studio-accent flex flex-col items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                  >
                    <StudioIcon name="plus" :size="18" />
                    <span class="text-xs mt-1">从素材库选择首帧</span>
                  </button>
                </div>

                <!-- 尾帧槽位 -->
                <div class="p-3 rounded-xl bg-studio-950 border border-studio-750 flex flex-col items-center justify-center space-y-2 relative group min-h-[140px]">
                  <span class="text-xs font-bold text-white self-start">🏁 落幅尾帧 (End Frame):</span>
                  <div v-if="referenceTray[1]" class="relative w-full h-24 rounded-lg overflow-hidden border border-studio-indigo group cursor-pointer" @click="openMediaPreview(referenceTray[1], 'image')">
                    <img :src="referenceTray[1].url" class="w-full h-full object-cover" />
                    <div class="absolute top-1 right-1 flex items-center space-x-1">
                      <button @click.stop="openMediaPreview(referenceTray[1], 'image')" class="p-1 rounded bg-black/70 text-studio-cyan text-xs cursor-pointer" title="查看大图">🔍</button>
                      <button @click.stop="removeRef(1)" class="p-1 rounded bg-black/70 text-rose-400 text-xs cursor-pointer">✕</button>
                    </div>
                    <span class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] text-white">@尾帧: {{ referenceTray[1].name }}</span>
                  </div>
                  <button
                    v-else
                    @click="openAssetSelectorModal"
                    class="w-full h-24 rounded-lg border-2 border-dashed border-studio-700 hover:border-studio-indigo flex flex-col items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                  >
                    <StudioIcon name="plus" :size="18" />
                    <span class="text-xs mt-1">从素材库选择尾帧</span>
                  </button>
                </div>
              </div>

              <!-- 全能参考模式槽位 -->
              <div v-else-if="videoSubMode === 'multi_ref'" class="flex items-center space-x-3 overflow-x-auto py-1 scrollbar-none">
                <div
                  v-for="(refItem, idx) in referenceTray"
                  :key="refItem.name + idx"
                  class="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-studio-indigo bg-studio-950 shrink-0 group shadow-md cursor-pointer"
                  @click="openMediaPreview(refItem, 'image')"
                >
                  <img :src="refItem.url" class="w-full h-full object-cover" />
                  <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-1.5 text-xs">
                    <div class="flex items-center justify-between">
                      <span class="truncate font-bold text-white">@图{{ idx + 1 }}</span>
                      <button @click.stop="openMediaPreview(refItem, 'image')" class="text-studio-cyan hover:text-white" title="查看大图">🔍</button>
                    </div>
                    <button @click.stop="removeRef(idx)" class="text-rose-400 hover:text-rose-300 self-end cursor-pointer">✕</button>
                  </div>
                </div>

                <button
                  v-if="referenceTray.length < 5"
                  @click="openAssetSelectorModal"
                  class="w-24 h-24 rounded-xl border-2 border-dashed border-studio-600 hover:border-studio-indigo bg-studio-950 flex flex-col items-center justify-center text-slate-400 hover:text-white space-y-1 shrink-0 cursor-pointer"
                >
                  <StudioIcon name="plus" :size="18" />
                  <span class="text-xs font-bold">添加参考图</span>
                </button>
              </div>

              <!-- 快捷视频动态灵感胶囊 -->
              <div class="grid grid-cols-2 gap-2 pt-2 border-t border-studio-800">
                <div
                  v-for="rec in videoQuickStarters"
                  :key="rec.title"
                  @click="applyQuickStarter(rec)"
                  class="p-2.5 rounded-xl bg-studio-950/60 border border-studio-750 hover:border-studio-indigo hover:bg-studio-850 cursor-pointer transition-all space-y-1 group"
                >
                  <div class="text-xs font-bold text-white group-hover:text-studio-indigo flex items-center justify-between">
                    <span>{{ rec.title }}</span>
                    <span class="text-xs opacity-75">🎬</span>
                  </div>
                  <p class="text-[11px] text-slate-400 line-clamp-1 leading-relaxed">{{ rec.desc }}</p>
                </div>
              </div>
            </div>
          </template>

          <!-- D. 音乐生成模式 -->
          <template v-else-if="activeModality === 'music'">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-xl">
              <StudioIcon name="music" :size="32" />
            </div>

            <div class="space-y-1">
              <h2 class="text-xl font-extrabold text-white tracking-tight">空间氛围音效与影视配乐生成</h2>
              <p class="text-xs text-slate-400 leading-relaxed max-w-xl">
                为室内空间设计效果图或漫游视频量身定制白噪音、北欧轻音乐与场景环绕音效。
              </p>
            </div>

            <div class="w-full max-w-2xl p-4 rounded-2xl bg-studio-900 border border-studio-750 shadow-xl space-y-3 text-left">
              <span class="text-xs font-bold text-white block">🎵 推荐配乐与音效主题：</span>
              <div class="grid grid-cols-2 gap-2.5">
                <button
                  v-for="m in musicStarters"
                  :key="m.title"
                  @click="applyPromptText(m.desc)"
                  class="p-3 rounded-xl bg-studio-950 border border-studio-750 hover:border-emerald-500 hover:bg-studio-850 text-left transition-all cursor-pointer space-y-1"
                >
                  <div class="text-xs font-bold text-white flex justify-between">
                    <span>{{ m.title }}</span>
                    <span class="text-emerald-400 font-mono">{{ m.duration }}</span>
                  </div>
                  <p class="text-[11px] text-slate-400 line-clamp-1">{{ m.desc }}</p>
                </button>
              </div>
            </div>
          </template>
        </div>

        <!-- 真实消息流列表 -->
        <div v-for="(msg, i) in messages" :key="i" class="flex flex-col space-y-2">
          <!-- 用户消息 (图文混排呈现) -->
          <div v-if="msg.role === 'user'" class="flex justify-end">
            <div class="max-w-2xl rounded-2xl rounded-tr-xs bg-studio-accent px-4 py-3 text-white text-xs leading-relaxed shadow-lg select-text">
              <div class="space-y-2">
                <div v-if="msg.referencedCard" class="px-2 py-1 rounded bg-black/25 text-studio-cyan text-[11px] border border-studio-cyan/40 flex items-center space-x-1.5">
                  <StudioIcon name="wand" :size="12" />
                  <span>已调用创作库模板: {{ msg.referencedCard }}</span>
                </div>

                <!-- 图文混排渲染区 -->
                <div class="font-sans leading-relaxed text-sm flex flex-wrap items-center gap-1">
                  <template v-for="(segment, sIdx) in parseRichSegments(msg.content, msg)" :key="sIdx">
                    <span v-if="segment.type === 'text'" class="whitespace-pre-wrap">{{ segment.text }}</span>
                    <button
                      v-else-if="segment.type === 'chip'"
                      type="button"
                      class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/20 border border-white/40 text-white font-bold text-xs shadow-sm align-middle"
                      :class="segment.ref && segment.ref.url ? 'cursor-zoom-in' : 'cursor-default'"
                      @click="segment.ref && segment.ref.url && openMediaPreview(segment.ref)"
                    >
                      <img v-if="segment.thumb" :src="segment.thumb" class="w-4 h-4 rounded-full object-cover border border-white/50" alt="" />
                      <span>{{ segment.tag }}: {{ segment.name }}</span>
                    </button>
                  </template>
                </div>
                <div v-if="messageAttachments(msg).length" class="flex flex-wrap gap-2 pt-1">
                  <button
                    v-for="(item, aIdx) in messageAttachments(msg)"
                    :key="(item.url || item.name) + aIdx"
                    type="button"
                    class="rounded-lg border border-white/40 bg-black/20 overflow-hidden cursor-zoom-in"
                    @click="openMediaPreview(item)"
                  >
                    <img v-if="mediaKind(item) === 'image'" :src="item.url" :alt="item.name || '图片'" class="h-16 w-16 object-cover" />
                    <video v-else-if="mediaKind(item) === 'video'" :src="item.url" class="h-16 w-24 object-cover" muted></video>
                    <span v-else class="flex h-16 w-28 items-center px-2 text-left text-[11px] font-bold text-white">音频 {{ item.name || '附件' }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- AI 生成产物消息 -->
          <div v-else class="flex justify-start">
            <div class="max-w-3xl w-full rounded-2xl rounded-tl-xs bg-studio-900 border border-studio-750 p-4 text-slate-200 text-xs shadow-md space-y-3 select-text">
              <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono pb-2 border-b border-studio-800">
                <span class="flex items-center gap-1.5 text-studio-accent font-medium">
                  <StudioIcon :name="msg.modality === 'video' ? 'video' : (msg.modality === 'music' ? 'music' : 'sparkles')" :size="14" />
                  {{ msg.model || 'Seedream 5.0 Flash' }}
                </span>
                <span class="flex items-center gap-2">
                  <span v-if="!msg.isError">
                    {{ msg.modality === 'video' ? `时长: ${msg.duration || '5s'} · 分辨率: ${msg.resolution || '1080p'}` : (msg.modality === 'music' ? `时长: ${msg.duration || '30s'} · 320kbps` : `耗时: ${msg.duration || ''} · 分辨率: ${msg.resolution || ''}`) }}
                  </span>
                  <button
                    v-if="!msg.isError && msg.content"
                    type="button"
                    class="msg-copy-all"
                    title="复制这条回复的 Markdown 原文"
                    @click="copyText(msg.content, $event.currentTarget)"
                  >
                    复制全文
                  </button>
                </span>
              </div>

              <!-- 情况 A：生图产物展示 (图片大图 + 存入创作库 + 精准重绘) -->
              <div v-if="msg.imageUrl && msg.modality === 'image'" class="relative group rounded-xl overflow-hidden border border-studio-750 bg-studio-950">
                <img :src="msg.imageUrl" @click="openMediaPreview(msg.imageUrl, 'image')" class="w-full max-h-[460px] object-contain cursor-zoom-in hover:brightness-105 transition-all" title="点击查看高清大图" />

                <!-- 悬浮功能条 -->
                <div class="absolute bottom-3 right-3 flex items-center space-x-2 bg-studio-950/90 backdrop-blur px-3 py-1.5 rounded-lg border border-studio-700 shadow-xl">
                  <button @click="openMediaPreview(msg.imageUrl, 'image')" class="flex items-center space-x-1 text-slate-200 hover:text-white text-xs font-bold cursor-pointer">
                    <span>🔍 大图</span>
                  </button>
                  <div class="h-3 w-px bg-studio-750"></div>
                  <button @click="openSaveToLibraryModal(msg)" class="flex items-center space-x-1 text-studio-cyan hover:text-white text-xs font-bold cursor-pointer">
                    <StudioIcon name="star" :size="13" />
                    <span>存入创作库</span>
                  </button>
                  <button v-if="msg.assetFid" @click="moveAssetShelf(msg.assetFid, 'retouched')" class="text-xs font-bold cursor-pointer">移入精修</button>
                  <button v-if="msg.assetFid" @click="moveAssetShelf(msg.assetFid, 'original')" class="text-xs font-bold cursor-pointer">移出精修</button>
                  <div class="h-3 w-px bg-studio-750"></div>
                  <button @click="triggerPrecisionEdit(msg)" class="flex items-center space-x-1 text-studio-accent hover:text-blue-300 text-xs font-bold cursor-pointer">
                    <StudioIcon name="edit" :size="13" />
                    <span>精准重绘</span>
                  </button>
                  <div class="h-3 w-px bg-studio-750"></div>
                  <a :href="msg.imageUrl" target="_blank" download class="flex items-center space-x-1 text-slate-300 hover:text-white text-xs font-bold">
                    <StudioIcon name="download" :size="13" />
                    <span>下载</span>
                  </a>
                </div>
              </div>
              <!-- Seedream 5.0 图层分解 (layer_decomposition) / Lite 组图连拍 交互画布图层栈 -->
              <div
                v-if="msg.layerStack && Array.isArray(msg.layerStack.layers) && msg.layerStack.layers.length > 1"
                class="rounded-xl bg-studio-950 border border-studio-750 p-3 space-y-2.5"
              >
                <div class="flex items-center justify-between text-xs">
                  <span class="font-bold text-studio-cyan flex items-center gap-1.5">
                    <span>🗂️ {{ msg.layerStack.kind === 'layer_stack' ? 'Seedream 5.0 透明图层拆分栈' : '多图连拍画廊' }}</span>
                    <span class="px-1.5 py-0.5 rounded bg-studio-850 text-[10px] font-mono text-white border border-studio-700">
                      共 {{ msg.layerStack.layers.length }} 层
                    </span>
                  </span>
                  <span class="text-[11px] text-slate-400">点击单层可切换大图预览，或一键挂载为 @图1 进行二次精修</span>
                </div>
                <div class="grid grid-cols-4 gap-2.5">
                  <div
                    v-for="layer in msg.layerStack.layers"
                    :key="layer.index"
                    class="group relative rounded-lg overflow-hidden border bg-studio-900 cursor-pointer transition-all"
                    :class="msg.imageUrl === layer.url ? 'border-studio-accent ring-1 ring-studio-accent' : 'border-studio-750 hover:border-studio-cyan'"
                    @click="msg.imageUrl = layer.url"
                  >
                    <div class="h-24 w-full bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:8px_8px] flex items-center justify-center">
                      <img :src="layer.url" class="max-h-24 w-full object-contain" />
                    </div>
                    <div class="p-1.5 bg-studio-950/90 flex items-center justify-between text-[10px]">
                      <span class="font-bold text-slate-200 truncate">{{ layer.label }}</span>
                      <button
                        type="button"
                        class="px-1.5 py-0.5 rounded bg-studio-accent/20 hover:bg-studio-accent text-studio-cyan hover:text-white font-bold cursor-pointer shrink-0"
                        @click.stop="mountAssetFromLibrary({ url: layer.url, name: layer.label, kind: 'image' })"
                        title="挂载为 @图1 继续二次编辑"
                      >
                        @引用
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <p v-if="msg.imageUrl && msg.modality === 'image'" class="text-xs text-slate-400 leading-relaxed">
                这一轮留在对话历史，并写入精修素材。创作库仍要点「存入创作库」，保存这一轮的提示词、模型和画幅。
              </p>

              <!-- 情况 B：视频产物展示 (完整高保真 HTML5 视频播放器) -->
              <div v-else-if="!msg.isError && (msg.videoUrl || msg.modality === 'video')" class="space-y-3">
                <div class="rounded-xl overflow-hidden border border-studio-750 bg-black relative group shadow-inner">
                  <video
                    :ref="el => registerVideoEl(i, el)"
                    :src="msg.videoUrl || sampleVideoUrl"
                    class="w-full max-h-[400px] object-contain bg-black"
                    controls
                    playsinline
                  ></video>
                </div>

                <div class="flex items-center justify-between p-2.5 rounded-xl bg-studio-950 border border-studio-750 text-xs">
                  <div class="flex items-center space-x-3 text-slate-300">
                    <span class="flex items-center gap-1 text-studio-indigo font-bold">
                      <StudioIcon name="film" :size="14" />
                      <span>运镜: {{ msg.camera || videoCameraMove }}</span>
                    </span>
                    <span class="text-slate-500">|</span>
                    <span class="font-mono text-emerald-400 font-bold">30 FPS</span>
                    <span class="text-slate-500">|</span>
                    <span class="text-studio-cyan font-mono font-bold">{{ msg.resolution || '1080P' }}</span>
                  </div>

                  <div class="flex items-center space-x-2">
                    <button
                      @click="captureFrameFromVideo(msg)"
                      class="px-2.5 py-1 rounded-lg bg-studio-850 hover:bg-studio-800 text-studio-cyan font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer"
                    >
                      <StudioIcon name="camera" :size="13" />
                      <span>截取帧</span>
                    </button>

                    <button
                      @click="sendVideoToClip(msg)"
                      class="px-2.5 py-1 rounded-lg bg-studio-indigo hover:brightness-110 text-white font-bold shadow flex items-center space-x-1 cursor-pointer"
                    >
                      <StudioIcon name="video" :size="13" />
                      <span>送入剪辑</span>
                    </button>

                    <button
                      @click="openSaveToLibraryModal(msg)"
                      class="px-2.5 py-1 rounded-lg bg-studio-850 hover:bg-studio-800 text-studio-cyan font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer"
                    >
                      <StudioIcon name="star" :size="13" />
                      <span>存入配方</span>
                    </button>

                    <a
                      :href="msg.videoUrl || sampleVideoUrl"
                      download="space_cinematic.mp4"
                      class="px-3 py-1 rounded-lg bg-studio-accent text-white font-bold shadow flex items-center space-x-1 cursor-pointer"
                    >
                      <StudioIcon name="download" :size="13" />
                      <span>下载 MP4</span>
                    </a>
                  </div>
                </div>
              </div>

              <!-- 情况 C：音乐产物展示 -->
              <div v-else-if="!msg.isError && (msg.audioUrl || msg.modality === 'music')" class="space-y-3">
                <div class="p-4 rounded-xl bg-studio-950 border border-studio-750 space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-white flex items-center gap-2">
                      <span>🎵</span>
                      <span>{{ msg.audioTitle || '空间环境原声 · Nordic Ambient' }}</span>
                    </span>
                    <span class="text-emerald-400 font-mono text-xs font-bold">{{ msg.duration || '30s' }}</span>
                  </div>
                  <audio :src="msg.audioUrl" controls class="w-full h-10"></audio>
                  <div class="flex items-center justify-end space-x-2 pt-1 border-t border-studio-800/80">
                    <button
                      @click="openSaveToLibraryModal(msg)"
                      class="px-2.5 py-1 rounded-lg bg-studio-850 hover:bg-studio-800 text-studio-cyan font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer text-xs"
                    >
                      <StudioIcon name="star" :size="13" />
                      <span>存入创作库</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- 模型替换 / 图片未送达等非致命问题：必须显式告知，不能静默 -->
              <div v-if="msg.warning" class="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                {{ msg.warning }}
              </div>

              <!-- 思考过程：与回答正文分离，默认折叠，可展开查看 -->
              <div v-if="msg.thinking" class="rounded-xl border border-studio-750 bg-studio-950/70 overflow-hidden">
                <button
                  type="button"
                  class="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold text-studio-cyan hover:bg-studio-900/60 cursor-pointer"
                  @click="expandedThinking[i] = !expandedThinking[i]"
                >
                  <span class="flex items-center gap-1.5">
                    <span>🧠 思考过程</span>
                    <span class="text-slate-500 font-normal font-mono">{{ msg.thinking.length }} 字</span>
                  </span>
                  <span class="text-slate-400 font-normal">{{ expandedThinking[i] ? '收起' : '展开' }}</span>
                </button>
                <pre v-if="expandedThinking[i]" class="px-3 pb-3 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-400 max-h-72 overflow-y-auto scrollbar-thin">{{ msg.thinking }}</pre>
              </div>

              <!-- 错误卡片：图标 + 标题 + 正文 + 处置建议 + 操作 -->
              <div v-if="msg.isError" class="gen-error">
                <div class="gen-error-head">
                  <span class="gen-error-icon">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2v-5z"/></svg>
                  </span>
                  <span class="gen-error-title">生成未成功</span>
                </div>
                <p class="gen-error-body">{{ friendlyErrorText(msg.content) }}</p>
                <p v-if="errorHint(msg.content)" class="gen-error-hint">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                  {{ errorHint(msg.content) }}
                </p>
                <div class="gen-error-actions">
                  <button type="button" class="gen-error-retry" @click="openRetry(msg)">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                    重试
                  </button>
                  <button type="button" class="gen-error-edit" @click="editFromError(msg)">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    编辑后再发
                  </button>
                </div>
              </div>
              <div v-else class="chat-md" v-html="renderMarkdown(msg.content)" @click="onMdClick"></div>
            </div>
          </div>
        </div>

        <div v-if="generating" class="flex justify-start">
          <div class="rounded-xl bg-studio-900 border border-studio-750 px-4 py-3 text-slate-300 text-xs flex items-center gap-2.5 max-w-xl">
            <StudioIcon name="refresh" :size="16" class="animate-spin text-studio-accent shrink-0" />
            <span class="leading-relaxed">{{ generatingHint }}</span>
          </div>
        </div>
      </div>

      <!-- 快速回底：仅在用户上滑脱离钉底时出现；流式输出期间带红点提示有新内容 -->
      <button
        v-show="!pinned"
        type="button"
        class="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-studio-850 text-slate-200 shadow-xl border border-studio-700 hover:bg-studio-800 hover:text-white transition-all cursor-pointer"
        title="回到最新"
        @click="jumpToLatest"
      >
        <StudioIcon name="arrowDown" :size="18" />
        <span
          v-if="hasNewBelow"
          class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-studio-rose ring-2 ring-studio-950"
        ></span>
      </button>
      </div>

      <!-- ========================================================================= -->
      <!-- 2.2 底部对话输入中枢卡片 (模型参数紧密集成 + 底部模式选择行) -->
      <!-- ========================================================================= -->
      <section class="rounded-2xl bg-studio-900 border border-studio-750 p-3.5 shadow-2xl space-y-2.5 shrink-0">
        <!-- 2.2.1 顶部紧密控制条：根据当前模式联动展示模型选择与参数 -->
        <div class="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-studio-800 text-xs">
          <!-- A. 纯对话专属控制条 -->
          <template v-if="activeModality === 'chat'">
            <div class="flex items-center space-x-2">
              <span class="text-slate-400 font-bold">对话模型:</span>
              <select v-model="chatModelKey" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <optgroup v-for="group in chatModelGroups" :key="group.label" :label="group.label">
                  <option v-for="m in group.models" :key="m.id" :value="m.id">
                    {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                  </option>
                </optgroup>
              </select>
            </div>

            <div class="flex items-center space-x-3">
              <label class="flex items-center space-x-1.5 text-studio-cyan font-bold">
                <span>🧠 思考强度</span>
                <select
                  v-if="chatReasoningCaps && chatReasoningCaps.supported"
                  v-model="thinkingStrength"
                  class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2 py-1 outline-none"
                  :title="chatReasoningCaps.note || ''"
                >
                  <option v-for="lv in chatReasoningCaps.levels" :key="lv" :value="lv">{{ thinkingLevelLabel(lv) }}</option>
                </select>
                <span v-else class="text-slate-400 font-normal" :title="chatReasoningCaps?.note || '模型未声明思考档位'">
                  {{ chatReasoningCaps?.mode === 'always' ? '内置思考·不可调' : (chatReasoningCaps?.mode === 'none' ? '该模型无思考档位' : '未声明') }}
                </span>
              </label>
              <span class="text-slate-500">|</span>
              <span class="text-slate-300" :title="contextNoteTitle">{{ contextNote }}</span>
            </div>
          </template>

          <!-- B. 生图 / 视频 / 音乐：和对话同一行密度，参数仍跟当前模型契约 -->
          <template v-else>
            <div class="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
              <span class="text-slate-400 font-bold">{{ activeModality === 'video' ? '视频模型' : (activeModality === 'music' ? '配乐' : '生图模型') }}:</span>
              <select v-if="activeModality === 'image'" v-model="imageModelKey" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <optgroup v-for="group in imageModelGroups" :key="group.label" :label="group.label">
                  <option v-for="m in group.models" :key="m.id" :value="m.id">
                    {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                  </option>
                </optgroup>
              </select>
              <select v-else-if="activeModality === 'video'" v-model="videoModelKey" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <optgroup v-for="group in videoModelGroups" :key="group.label" :label="group.label">
                  <option v-for="m in group.models" :key="m.id" :value="m.id">
                    {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                  </option>
                </optgroup>
              </select>
              <select v-else v-model="musicType" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <optgroup v-for="group in musicModelGroups" :key="group.label" :label="group.label">
                  <option v-for="m in group.models" :key="m.id" :value="m.id">
                    {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                  </option>
                </optgroup>
              </select>
              <DynamicModelParamBar
                v-if="currentSchema"
                :schema="currentSchema"
                :activeMode="activeGenMode"
                v-model="schemaParams"
                v-model:showAdvanced="showAdvanced"
                :refCounts="currentRefCounts"
                @select-mode="setGenMode"
              />
            </div>
            <p v-if="activeModality === 'image' && imageModelKey === 'qwenimage_local'" class="basis-full text-xs text-slate-300 leading-relaxed">
              文生图，或挂最多 10 张参考图做编辑。标准模型和加速 8 步在上面选。
            </p>
            <p v-else-if="audioOnlyModel()" class="basis-full text-xs text-slate-300 leading-relaxed">
              先上传一段参考音频，10 到 15 秒最合适。上面的文字是要说的话。
            </p>
            <p v-else-if="activeModality === 'music' && musicType === 'acestep_local'" class="basis-full text-xs text-slate-300 leading-relaxed">
              纯音乐只写风格。人声歌曲先写【风格】，再写【歌词】。默认出 1 条。
            </p>
            <p v-else-if="!currentSchema" class="basis-full text-xs text-slate-300">这个模型的参数表还没接入，这次只提交提示词。</p>
            <p v-if="oldRecipeNote" class="basis-full text-xs text-slate-300">这是旧配方，模型未记录，已改用 Agnes Image 2.5 Flash。</p>
            <p v-if="composerError" class="basis-full text-xs font-bold text-rose-400">{{ composerError }}</p>
          </template>
        </div>

        <!-- 2.2.2 提示词富文本输入中枢 (图文混排) -->
        <div class="rounded-xl bg-studio-950 border border-studio-700/80 p-3 relative shadow-inner space-y-2">
          <div v-if="referenceTray.length" class="flex items-center gap-2 overflow-x-auto">
            <span class="shrink-0 text-xs font-bold text-slate-300">即将提交 {{ referenceTray.length }} {{ audioOnlyModel() ? '段音频' : '张' }}</span>
            <div v-for="(item, idx) in referenceTray" :key="(item.url || item.name) + idx" class="relative shrink-0">
              <button type="button" class="block text-left" @click="openMediaPreview(item)">
                <audio v-if="mediaKind(item) === 'audio'" :src="item.url" class="h-10 w-36" controls @click.stop></audio>
                <img v-else :src="item.url" class="h-10 w-10 rounded-lg object-cover" :alt="item.name" />
                <span class="block max-w-16 truncate text-[10px] text-slate-300">{{ activeGenMode === 'first_last_frame' ? (idx === 0 ? '首帧' : '尾帧') : (item.tag || item.name) }}</span>
              </button>
              <button type="button" class="tray-ref-delete" title="移除" @click.stop="removeRef(idx)">×</button>
            </div>
          </div>
          <!-- # 符号悬浮模糊匹配浮层 -->
          <div
            v-if="showHashMenu"
            class="absolute bottom-full left-4 mb-2 w-80 bg-studio-900 border border-studio-700 rounded-xl shadow-2xl p-2 z-40 max-h-72 overflow-y-auto scrollbar-thin"
          >
            <div class="text-[11px] text-slate-400 font-mono px-2 py-1 border-b border-studio-800 flex items-center justify-between">
              <span>调用创作库配方 (# 快捷呼出):</span>
              <span class="text-studio-accent">{{ filteredTemplates.length }} 个可用</span>
            </div>
            <div
              v-for="tpl in filteredTemplates"
              :key="tpl.id"
              @click="selectHashTemplate(tpl)"
              class="px-2.5 py-2 rounded-lg hover:bg-studio-800 cursor-pointer text-xs text-slate-200 flex items-center space-x-2.5 transition-colors"
            >
              <img v-if="tpl.result_images?.[0]" :src="tpl.result_images[0].url" class="w-8 h-8 rounded object-cover border border-white/10 shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="font-bold text-white truncate">#{{ tpl.title }}</div>
                <div class="text-[11px] text-slate-400 truncate">{{ tpl.prompt }}</div>
              </div>
            </div>
          </div>

          <!-- 富文本可编辑提示词容器 -->
          <div class="relative">
            <div
              ref="richEditorRef"
              contenteditable="true"
              class="rich-prompt-editor text-slate-100 text-sm leading-relaxed font-medium min-h-[44px] max-h-36 overflow-y-auto outline-none"
              :class="activeModality === 'chat' ? 'pr-3' : (optimizeUndo ? 'pr-48' : 'pr-32')"
              :data-placeholder="getEditorPlaceholder()"
              @input="onEditorInput"
              @keyup="onEditorKeyup"
              @keydown="onEditorKeydown"
            ></div>

            <div v-if="activeModality !== 'chat'" class="absolute top-0 right-0 flex items-center gap-1.5">
              <button
                v-if="optimizeUndo"
                type="button"
                @click="undoOptimize"
                :disabled="optimizing"
                class="px-2.5 py-1.5 rounded-lg border border-studio-700 bg-studio-900 text-slate-200 text-xs font-extrabold cursor-pointer disabled:opacity-40"
                title="撤回优化前的提示词"
              >
                撤回
              </button>
              <button
                type="button"
                @click="optimizePrompt"
                :disabled="optimizing"
                class="px-3 py-1.5 rounded-lg bg-studio-accent/20 hover:bg-studio-accent/30 text-studio-accent text-xs font-extrabold border border-studio-accent/40 flex items-center space-x-1.5 transition-all disabled:opacity-40 cursor-pointer shadow-sm"
                title="根据当前模型专属提示词规则进行智能优化"
              >
                <StudioIcon name="wand" :size="13" :class="{ 'animate-spin': optimizing }" />
                <span>{{ optimizing ? '优化中...' : '✨ 优化提示词' }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 2.2.3 底部核心：模式选择行 + 操作按钮 (完全对齐豆包底栏结构！) -->
        <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
          <!-- 底部主模式切换行 (纯对话 / 图片生成 / 视频生成 / 音乐生成) -->
          <div class="flex items-center space-x-1.5 bg-studio-950 p-1 rounded-xl border border-studio-750">
            <button
              @click="switchModality('chat')"
              :class="[
                'px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1.5 cursor-pointer',
                'choice',
                activeModality === 'chat' ? 'is-on' : ''
              ]"
            >
              <span class="choice-mark"></span>
              <StudioIcon name="chat" :size="14" />
              <span>纯对话</span>
              <span v-if="activeModality === 'chat'" class="choice-now">当前</span>
            </button>

            <button
              @click="switchModality('image')"
              :class="[
                'px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1.5 cursor-pointer',
                'choice',
                activeModality === 'image' ? 'is-on' : ''
              ]"
            >
              <span class="choice-mark"></span>
              <StudioIcon name="image" :size="14" />
              <span>图片生成</span>
              <span v-if="activeModality === 'image'" class="choice-now">当前</span>
            </button>

            <button
              @click="switchModality('video')"
              :class="[
                'px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1.5 cursor-pointer',
                'choice',
                activeModality === 'video' ? 'is-on' : ''
              ]"
            >
              <span class="choice-mark"></span>
              <StudioIcon name="video" :size="14" />
              <span>视频生成</span>
              <span v-if="activeModality === 'video'" class="choice-now">当前</span>
            </button>

            <button
              @click="switchModality('music')"
              :class="[
                'px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1.5 cursor-pointer',
                'choice',
                activeModality === 'music' ? 'is-on' : ''
              ]"
            >
              <span class="choice-mark"></span>
              <StudioIcon name="music" :size="14" />
              <span>音乐生成</span>
              <span v-if="activeModality === 'music'" class="choice-now">当前</span>
            </button>
          </div>

          <!-- 中间与右侧快捷工具与生成按钮 -->
          <div class="flex items-center space-x-2 text-xs">
            <button
              @click="openAssetSelectorModal"
              class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-studio-cyan text-xs font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer"
              title="选择私有素材库资产并作为图文混排标签插入"
            >
              <span>@ 素材引用</span>
            </button>

            <button
              @click="showHashMenu = !showHashMenu"
              class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-studio-indigo text-xs font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer"
              title="选择创作库模块"
            >
              <span># 创作库</span>
            </button>

            <div class="relative">
              <button
                type="button"
                @click="showSkillsMenu = !showSkillsMenu"
                class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 text-emerald-400 text-xs font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer"
                title="挂载模型专属创作技能 (Skills)"
              >
                <span>🧩 技能挂载{{ activeSkillIds.length ? ` (${activeSkillIds.length})` : '' }}</span>
              </button>
              <div
                v-if="showSkillsMenu"
                class="absolute bottom-full right-0 mb-2 w-80 rounded-xl bg-studio-900 border border-studio-700 shadow-2xl p-2.5 z-40 space-y-1.5"
              >
                <div class="flex items-center justify-between text-[11px] text-slate-400 pb-1 border-b border-studio-800">
                  <span class="font-bold text-white">🧩 空间与多模态专属技能 (Skills)</span>
                  <button type="button" class="text-slate-400 hover:text-white cursor-pointer" @click="showSkillsMenu = false">✕</button>
                </div>
                <div
                  v-for="sk in availableStudioSkills"
                  :key="sk.id"
                  @click="toggleStudioSkill(sk)"
                  class="p-2 rounded-lg border cursor-pointer transition-all"
                  :class="activeSkillIds.includes(sk.id) ? 'bg-studio-accent/20 border-studio-accent text-white' : 'bg-studio-950/60 border-studio-800 text-slate-300 hover:border-studio-700'"
                >
                  <div class="flex items-center justify-between text-xs font-bold">
                    <span>{{ sk.name }}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-studio-850 text-emerald-400 border border-studio-750">{{ sk.badge }}</span>
                  </div>
                  <p class="text-[11px] text-slate-400 mt-0.5 leading-snug">{{ sk.desc }}</p>
                </div>
              </div>
            </div>

            <!-- 立即生成/发送按钮 -->
            <button
              @click="sendMessage"
              :disabled="generating"
              class="px-5 py-2 rounded-xl bg-gradient-to-r from-studio-accent to-studio-cyan hover:brightness-110 text-white text-xs font-extrabold flex items-center space-x-2 shadow-lg shadow-studio-accent/25 transition-all disabled:opacity-40 cursor-pointer ml-2"
            >
              <span>{{ getSendButtonText() }}</span>
              <StudioIcon name="send" :size="13" />
            </button>
          </div>
        </div>
      </section>
    </main>

    <!-- 3. 共享素材选择器（AI 对话 / 快捷编辑同一组件） -->
    <AssetPickerModal
      :visible="showAssetSelector"
      context="chat"
      :max-select="10"
      :recent="assetPickerRecent"
      upload-enabled
      @close="showAssetSelector = false"
      @confirm="onAssetPickerConfirm"
      @upload="onAssetPickerUpload"
    />

    <!-- ========================================================================= -->
    <!-- 4. 高清媒体预览灯箱 (Media Lightbox Modal: 大图缩放与视频播放) -->
    <!-- ========================================================================= -->
    <div
      v-if="previewModal.visible"
      class="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      @click.self="closeMediaPreview"
    >
      <div class="relative max-w-6xl w-full max-h-[92vh] flex flex-col items-center justify-center space-y-3">
        <!-- 预览顶栏 -->
        <div class="w-full flex items-center justify-between px-4 py-2 rounded-xl bg-studio-900/90 border border-studio-750 backdrop-blur-md shadow-xl text-xs">
          <div class="flex items-center space-x-2.5 truncate max-w-[60%]">
            <span class="text-sm">{{ previewModal.type === 'video' ? '🎬' : '🖼️' }}</span>
            <span class="font-bold text-white truncate">{{ previewModal.title }}</span>
          </div>

          <div class="flex items-center space-x-2">
            <!-- 缩放工具 (仅图片) -->
            <template v-if="previewModal.type === 'image'">
              <button @click="zoomPreview(-0.25)" class="px-2 py-1 rounded bg-studio-800 hover:bg-studio-750 text-slate-200 font-bold cursor-pointer">-</button>
              <span class="text-studio-cyan font-mono font-bold w-12 text-center">{{ Math.round(previewModal.scale * 100) }}%</span>
              <button @click="zoomPreview(0.25)" class="px-2 py-1 rounded bg-studio-800 hover:bg-studio-750 text-slate-200 font-bold cursor-pointer">+</button>
              <button @click="previewModal.scale = 1.0" class="px-2 py-1 rounded bg-studio-800 hover:bg-studio-750 text-slate-300 text-[11px] cursor-pointer">1:1</button>
              <div class="h-3 w-px bg-studio-750 mx-1"></div>
            </template>

            <a :href="previewModal.url" download target="_blank" class="px-3 py-1 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 font-bold flex items-center space-x-1">
              <span>⬇ 下载</span>
            </a>
            <button @click="closeMediaPreview" class="w-7 h-7 rounded-lg bg-studio-800 hover:bg-rose-600 text-white flex items-center justify-center font-bold cursor-pointer transition-all ml-1">
              ✕
            </button>
          </div>
        </div>

        <!-- 媒体主体展示区 -->
        <div class="w-full max-h-[82vh] flex items-center justify-center overflow-hidden rounded-2xl bg-black/60 border border-studio-800 shadow-2xl p-2 relative">
          <!-- 图片视图 -->
          <img
            v-if="previewModal.type === 'image'"
            :src="previewModal.url"
            :style="{ transform: `scale(${previewModal.scale})` }"
            class="max-h-[78vh] max-w-full object-contain transition-transform duration-100 select-none rounded-lg"
          />

          <!-- 视频播放视图 -->
          <video
            v-else-if="previewModal.type === 'video'"
            :src="previewModal.url"
            controls
            autoplay
            class="max-h-[78vh] max-w-full rounded-xl bg-black shadow-2xl"
          ></video>
          <audio
            v-else
            :src="previewModal.url"
            controls
            autoplay
            class="w-full max-w-xl"
          ></audio>
        </div>
      </div>
    </div>

    <!-- 4. 模态弹窗：存入创作库与新建配方 -->
    <div
      v-if="saveModal.visible"
      class="fixed inset-0 z-[75] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      @click.self="saveModal.visible = false"
    >
      <div class="w-full max-w-lg rounded-2xl bg-studio-900 border border-studio-750 p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-studio-800">
          <span class="text-sm font-bold text-white flex items-center gap-2">
            <span>⭐</span>
            <span>{{ saveModal.msg ? '存入创作库' : '新建创作配方' }}</span>
          </span>
          <button @click="saveModal.visible = false" class="text-slate-400 hover:text-white cursor-pointer">✕</button>
        </div>

        <p class="text-xs text-slate-400">将优质创作结果沉淀为标准化配方，支持空间与风格多维归档及一键复用。</p>
        <div class="space-y-3.5 text-xs">
          <!-- 创作大类单选 -->
          <div>
            <label class="text-slate-300 font-bold block mb-1.5">创作大类：</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                type="button"
                @click="saveModal.type = 'image'"
                class="py-2 px-3 rounded-lg border font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
                :class="saveModal.type === 'image' ? 'bg-studio-accent text-white border-studio-accent shadow' : 'bg-studio-950 text-slate-400 border-studio-800 hover:text-slate-200'"
              >
                <StudioIcon name="image" :size="14" />
                <span>生图</span>
              </button>
              <button
                type="button"
                @click="saveModal.type = 'video'"
                class="py-2 px-3 rounded-lg border font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
                :class="saveModal.type === 'video' ? 'bg-purple-600 text-white border-purple-500 shadow' : 'bg-studio-950 text-slate-400 border-studio-800 hover:text-slate-200'"
              >
                <StudioIcon name="video" :size="14" />
                <span>生视频</span>
              </button>
              <button
                type="button"
                @click="saveModal.type = 'audio'"
                class="py-2 px-3 rounded-lg border font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
                :class="saveModal.type === 'audio' ? 'bg-emerald-600 text-white border-emerald-500 shadow' : 'bg-studio-950 text-slate-400 border-studio-800 hover:text-slate-200'"
              >
                <StudioIcon name="music" :size="14" />
                <span>生音频</span>
              </button>
            </div>
          </div>

          <!-- 空间与风格两列选择 -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-slate-300 font-bold block mb-1">空间分类：</label>
              <select
                v-model="saveModal.space"
                class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white outline-none font-bold"
              >
                <option v-for="sp in SPACE_OPTIONS.filter(s => s !== '全部空间')" :key="sp" :value="sp">{{ sp }}</option>
              </select>
            </div>
            <div>
              <label class="text-slate-300 font-bold block mb-1">设计风格：</label>
              <select
                v-model="saveModal.style"
                class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white outline-none font-bold"
              >
                <option v-for="st in STYLE_OPTIONS.filter(s => s !== '全部风格')" :key="st" :value="st">{{ st }}</option>
              </select>
            </div>
          </div>

          <!-- 作品名称 -->
          <div>
            <label class="text-slate-300 font-bold block mb-1">作品名称：</label>
            <input
              v-model="saveModal.title"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white outline-none font-bold"
              placeholder="例如：意式极简全景客厅扩图"
            />
          </div>

          <!-- 提示词内容 -->
          <div>
            <label class="text-slate-300 font-bold block mb-1">提示词内容：</label>
            <textarea
              v-model="saveModal.prompt"
              rows="3"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-slate-200 outline-none"
              placeholder="描述生成提示词、材质、光影或运镜要求..."
            ></textarea>
          </div>

          <!-- 设为常用勾选 -->
          <div class="pt-1 flex items-center">
            <label class="flex items-center space-x-2 text-xs text-amber-300 font-bold cursor-pointer">
              <input type="checkbox" v-model="saveModal.is_pinned" class="rounded accent-amber-500 w-4 h-4 cursor-pointer" />
              <span>⭐ 标为常用配方（在创作库中置顶高亮显示）</span>
            </label>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-2 border-t border-studio-800">
          <button @click="saveModal.visible = false" class="px-4 py-1.5 rounded-lg text-slate-400 hover:text-white text-xs cursor-pointer">取消</button>
          <button
            @click="submitSaveToLibrary"
            :disabled="savingTpl"
            class="px-5 py-2 rounded-lg bg-studio-accent text-white font-bold text-xs shadow hover:brightness-110 cursor-pointer disabled:opacity-50"
          >
            {{ savingTpl ? '保存中...' : '确认存入创作库' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 5. 模态弹窗：配方详情与复用 -->
    <div
      v-if="detailModal.visible"
      class="fixed inset-0 z-[75] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      @click.self="detailModal.visible = false"
    >
      <div class="w-full max-w-3xl rounded-2xl bg-studio-900 border border-studio-700 p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-studio-800">
          <div class="flex items-center space-x-2">
            <span class="text-base">📖</span>
            <span class="text-sm font-bold text-white">创作配方详情</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold border" :class="getTemplateTypeBadgeClass(detailModal.tpl)">
              {{ getTemplateTypeLabel(detailModal.tpl) }}
            </span>
            <button
              type="button"
              @click="toggleTemplatePin(detailModal.tpl)"
              class="px-2 py-0.5 rounded text-xs font-bold transition-all cursor-pointer flex items-center space-x-1"
              :class="detailModal.tpl.is_pinned ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50' : 'bg-studio-800 text-slate-400 hover:text-white border border-studio-700'"
            >
              <span>⭐</span>
              <span>{{ detailModal.tpl.is_pinned ? '常用' : '设为常用' }}</span>
            </button>
          </div>
          <button @click="detailModal.visible = false" class="text-slate-400 hover:text-white cursor-pointer" title="关闭 (Esc)">✕</button>
        </div>

        <div class="space-y-4 text-xs">
          <!-- 标题展示与快捷重命名 -->
          <div class="flex items-center space-x-2 bg-studio-950 p-3 rounded-xl border border-studio-800">
            <span class="text-slate-400 font-bold shrink-0">作品名称:</span>
            <input
              v-model="detailModal.tpl.title"
              class="flex-1 bg-transparent text-white font-bold outline-none text-xs"
              @change="confirmRenameTemplate(detailModal.tpl)"
              placeholder="输入作品标题"
            />
            <span v-if="detailModal.tpl.space" class="px-2 py-0.5 rounded bg-studio-900 text-slate-300 border border-studio-800 font-medium">
              🏠 {{ detailModal.tpl.space }}
            </span>
            <span v-if="detailModal.tpl.style" class="px-2 py-0.5 rounded bg-studio-900 text-studio-cyan border border-studio-800 font-medium">
              🎨 {{ detailModal.tpl.style }}
            </span>
            <span v-if="detailModal.tpl.use_count > 0" class="text-amber-400 font-mono font-bold">
              🔥 复用 {{ detailModal.tpl.use_count }} 次
            </span>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <span class="text-[10px] text-slate-400 font-mono font-bold">参考原图 (Origin):</span>
              <div
                class="aspect-[16/10] rounded-xl overflow-hidden bg-studio-950 border border-studio-800 flex items-center justify-center text-slate-500 relative group cursor-pointer"
                @click="detailModal.tpl.origin_images?.[0]?.url && openMediaPreview(detailModal.tpl.origin_images[0], 'image')"
              >
                <img v-if="detailModal.tpl.origin_images?.[0]?.url" :src="detailModal.tpl.origin_images[0].url" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                <span v-else>无参考图</span>
                <span v-if="detailModal.tpl.origin_images?.[0]?.url" class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity">🔍 查看大图</span>
              </div>
            </div>
            <div class="space-y-1">
              <span class="text-[10px] text-studio-cyan font-mono font-bold">最终产物 (Render Result):</span>
              <div class="aspect-[16/10] rounded-xl overflow-hidden bg-studio-950 border border-studio-accent/40 flex items-center justify-center text-slate-500 relative group">
                <video
                  v-if="detailModal.tpl.type === 'video' && detailModal.tpl.result_images?.[0]?.url"
                  :src="detailModal.tpl.result_images[0].url"
                  controls
                  class="w-full h-full object-cover"
                ></video>
                <audio
                  v-else-if="detailModal.tpl.type === 'audio' && detailModal.tpl.result_images?.[0]?.url"
                  :src="detailModal.tpl.result_images[0].url"
                  controls
                  class="w-full px-4"
                ></audio>
                <div v-else-if="detailModal.tpl.result_images?.[0]?.url" class="w-full h-full cursor-pointer relative group" @click="openMediaPreview(detailModal.tpl.result_images[0], 'image')">
                  <img
                    :src="detailModal.tpl.result_images[0].url"
                    class="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <span class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity">🔍 查看大图</span>
                </div>
                <span v-else>无成果展示</span>
              </div>
            </div>
          </div>

          <div>
            <span class="text-[11px] text-slate-400 block mb-1 font-bold">使用的提示词：</span>
            <div class="p-3 rounded-lg bg-studio-950 border border-studio-800 text-slate-200 leading-relaxed font-medium max-h-32 overflow-y-auto">
              {{ detailModal.tpl.prompt }}
            </div>
            <p v-if="recipeIsLegacy(detailModal.tpl)" class="mt-2 text-xs text-slate-300">旧配方，模型未记录。复用时使用 Agnes Image 2.5 Flash。</p>
          </div>
        </div>

        <div class="flex items-center justify-between pt-3 border-t border-studio-800">
          <button @click="deleteTemplate(detailModal.tpl.id)" class="text-rose-400 hover:underline text-xs cursor-pointer font-bold">删除此配方</button>
          <div class="flex items-center space-x-2">
            <button @click="detailModal.visible = false" class="px-4 py-1.5 rounded-lg text-slate-400 hover:text-white text-xs cursor-pointer">关闭</button>
            <button @click="applyTemplate(detailModal.tpl)" class="px-5 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold shadow hover:brightness-110 cursor-pointer">
              🚀 复用此配方开始创作
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 6. 全景放大创作库画廊工作台 (Expanded Library Studio) -->
    <div
      v-if="showExpandedLibrary"
      :class="[
        'fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md transition-all',
        isLibraryFullscreen ? 'p-0' : 'p-3 sm:p-5 lg:p-6'
      ]"
      @click.self="showExpandedLibrary = false"
    >
      <div
        :class="[
          'bg-studio-900 border border-studio-700 shadow-2xl flex flex-col overflow-hidden animate-fade-in transition-all',
          isLibraryFullscreen
            ? 'w-full h-full rounded-none border-none'
            : 'w-full max-w-[97vw] 2xl:max-w-[95vw] h-[95vh] rounded-3xl'
        ]"
      >
        <!-- 弹窗顶部栏 -->
        <div class="px-6 py-4 border-b border-studio-800 flex items-center justify-between bg-studio-950/70 shrink-0">
          <div class="flex items-center space-x-3">
            <div class="w-9 h-9 rounded-xl bg-studio-accent/20 border border-studio-accent/40 flex items-center justify-center text-studio-accent">
              <StudioIcon name="wand" :size="20" />
            </div>
            <div>
              <div class="flex items-center space-x-2">
                <h3 class="text-base font-bold text-white tracking-wide">灵感创作资产库</h3>
                <span class="text-xs px-2 py-0.5 rounded-full bg-studio-800 text-slate-300 font-mono border border-studio-700">
                  共 {{ templates.length }} 项 · 过滤 {{ filteredTemplates.length }} 项
                </span>
              </div>
              <p class="text-xs text-slate-400">大画幅多维筛选、原图/目标图全景对比、一键复用与资产治理</p>
            </div>
          </div>

          <!-- 右侧操作 -->
          <div class="flex items-center space-x-2 sm:space-x-3">
            <button
              @click="openAddTemplateModal"
              class="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-studio-accent hover:brightness-110 text-white text-xs font-bold shadow-md flex items-center space-x-1.5 cursor-pointer transition-all"
            >
              <StudioIcon name="plus" :size="14" />
              <span>新建配方</span>
            </button>
            <button
              @click="toggleLibraryFullscreen"
              class="w-8 h-8 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
              :title="isLibraryFullscreen ? '退出全屏 (还原窗口)' : '全屏最大化显示'"
            >
              <span v-if="!isLibraryFullscreen" class="text-xs font-bold">⛶</span>
              <span v-else class="text-xs font-bold">🗗</span>
            </button>
            <button
              @click="showExpandedLibrary = false"
              class="w-8 h-8 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- 综合多维筛选控制面板 -->
        <div class="px-6 py-3 border-b border-studio-800 bg-studio-900/90 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div class="flex flex-wrap items-center gap-2.5">
            <!-- 模态 Segment: 全部 / 生图 / 生视频 / 生音频 -->
            <div class="flex p-0.5 rounded-xl bg-studio-950 border border-studio-800 text-xs font-bold">
              <button
                v-for="mod in MODALITY_OPTIONS"
                :key="mod.id"
                @click="tplTypeFilter = mod.id"
                class="px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center space-x-1.5"
                :class="tplTypeFilter === mod.id ? 'bg-studio-accent text-white shadow' : 'text-slate-400 hover:text-slate-200'"
              >
                <span>{{ mod.label }}</span>
              </button>
            </div>

            <div class="h-5 w-px bg-studio-800"></div>

            <!-- 空间分类选择 -->
            <div class="flex items-center space-x-1.5">
              <span class="text-xs text-slate-400 font-bold">空间:</span>
              <select
                v-model="tplSpaceFilter"
                class="bg-studio-950 border border-studio-750 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-medium"
              >
                <option v-for="sp in SPACE_OPTIONS" :key="sp" :value="sp">{{ sp }}</option>
              </select>
            </div>

            <!-- 设计风格选择 -->
            <div class="flex items-center space-x-1.5">
              <span class="text-xs text-slate-400 font-bold">风格:</span>
              <select
                v-model="tplStyleFilter"
                class="bg-studio-950 border border-studio-750 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-medium"
              >
                <option v-for="st in STYLE_OPTIONS" :key="st" :value="st">{{ st }}</option>
              </select>
            </div>

            <!-- 仅看常用 -->
            <button
              @click="tplPinnedOnly = !tplPinnedOnly"
              class="px-3 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer"
              :class="tplPinnedOnly ? 'bg-amber-500/20 border-amber-500/60 text-amber-300' : 'bg-studio-950 border-studio-750 text-slate-400 hover:text-white'"
            >
              <span>⭐</span>
              <span>仅看常用</span>
            </button>
          </div>

          <!-- 搜索框 -->
          <div class="flex items-center bg-studio-950 px-3 py-1.5 rounded-xl border border-studio-750 text-xs text-slate-300 w-64">
            <StudioIcon name="search" :size="14" class="text-slate-400 mr-2 shrink-0" />
            <input
              v-model="tplSearch"
              type="text"
              placeholder="搜索标题、风格、空间或提示词..."
              class="bg-transparent outline-none text-xs w-full text-slate-100 placeholder-slate-500"
            />
            <button v-if="tplSearch" @click="tplSearch = ''" class="text-slate-500 hover:text-slate-300 text-xs">✕</button>
          </div>
        </div>

        <!-- 卡片网格展示区 (Grid 3 列) -->
        <div class="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <!-- 创作库为空 -->
          <div v-if="templates.length === 0" class="h-full flex flex-col items-center justify-center text-center py-16">
            <div class="w-16 h-16 rounded-3xl bg-studio-850 border border-studio-750 flex items-center justify-center text-studio-accent mb-4 shadow-lg">
              <StudioIcon name="wand" :size="32" />
            </div>
            <h3 class="text-base font-bold text-white mb-2">创作库中暂无配方作品</h3>
            <p class="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
              您可以在当前工作台中点击上方【+ 新建配方】手动沉淀，或在 AI 对话完成生图/生视频后，点击结果卡片上的【存入创作库】一键保存。
            </p>
            <button
              @click="openAddTemplateModal"
              class="px-5 py-2.5 rounded-xl bg-studio-accent hover:brightness-110 text-white text-xs font-bold shadow-lg transition-all flex items-center space-x-2 cursor-pointer"
            >
              <StudioIcon name="plus" :size="15" />
              <span>立即新建首个创作配方</span>
            </button>
          </div>

          <!-- 筛选后无结果 -->
          <div v-else-if="filteredTemplates.length === 0" class="h-full flex flex-col items-center justify-center text-center py-16">
            <StudioIcon name="search" :size="32" class="text-slate-500 mb-3" />
            <p class="text-sm font-bold text-slate-300 mb-2">未找到符合当前多维筛选条件的配方</p>
            <p class="text-xs text-slate-500 mb-4">请尝试切换模态分类、重置空间/风格筛选或清除搜索关键词</p>
            <button
              @click="resetTplFilters"
              class="px-4 py-2 rounded-xl bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-200 text-xs font-bold cursor-pointer"
            >
              重置所有筛选条件
            </button>
          </div>

          <!-- 网格卡片列表 -->
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
            <div
              v-for="tpl in filteredTemplates"
              :key="tpl.id"
              class="rounded-2xl bg-studio-850 border border-studio-750 hover:border-studio-accent/70 transition-all shadow-md hover:shadow-2xl flex flex-col overflow-hidden group/card"
            >
              <!-- 卡片大预览区域 -->
              <div
                class="relative aspect-video bg-studio-950 overflow-hidden border-b border-studio-800 cursor-pointer"
                @click="openTemplateDetail(tpl)"
                title="点击查看配方详情"
              >
                <!-- 图片模式：展示成果大图 + 角标原图 -->
                <template v-if="!tpl.type || tpl.type === 'image'">
                  <img
                    v-if="tpl.result_images?.[0]?.url"
                    :src="tpl.result_images[0].url"
                    class="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-300"
                  />
                  <div v-else class="w-full h-full flex items-center justify-center text-slate-600 text-xs">
                    无渲染成果图
                  </div>

                  <!-- 原图画中画浮窗 -->
                  <div
                    v-if="tpl.origin_images?.[0]?.url"
                    class="absolute bottom-2 left-2 flex items-center space-x-1.5 bg-black/70 backdrop-blur-xs p-1 rounded-lg border border-white/10 hover:border-studio-accent transition-colors"
                    title="点击查看原图"
                    @click.stop="openMediaPreview(tpl.origin_images[0], 'image')"
                  >
                    <span class="text-[9px] text-slate-400 font-bold px-1">原图</span>
                    <img :src="tpl.origin_images[0].url" class="w-9 h-9 rounded object-cover border border-white/20" />
                  </div>
                </template>

                <!-- 视频模式：视频播放或海报 -->
                <template v-else-if="tpl.type === 'video'">
                  <video
                    v-if="tpl.result_images?.[0]?.url"
                    :src="tpl.result_images[0].url"
                    controls
                    class="w-full h-full object-cover"
                  ></video>
                  <div v-else class="w-full h-full flex flex-col items-center justify-center text-purple-400 bg-purple-950/30">
                    <StudioIcon name="video" :size="32" class="mb-2" />
                    <span class="text-xs font-bold">空间动态视频配方</span>
                  </div>
                </template>

                <!-- 音频模式：播放器与波形 -->
                <template v-else-if="tpl.type === 'audio'">
                  <div class="w-full h-full flex flex-col items-center justify-center p-4 bg-emerald-950/20 space-y-3">
                    <div class="w-12 h-12 rounded-2xl bg-emerald-900/40 border border-emerald-700/50 flex items-center justify-center text-emerald-400 shadow-inner">
                      <StudioIcon name="music" :size="24" />
                    </div>
                    <audio
                      v-if="tpl.result_images?.[0]?.url"
                      :src="tpl.result_images[0].url"
                      controls
                      class="w-full h-9"
                    ></audio>
                    <span class="text-xs text-emerald-300 font-medium font-mono">空间氛围原声</span>
                  </div>
                </template>

                <!-- 顶部徽章悬浮条 -->
                <div class="absolute top-2 left-2 right-2 flex items-center justify-between gap-1.5 pointer-events-none">
                  <div class="flex items-center space-x-1 pointer-events-auto">
                    <!-- 常用/置顶快捷星标 -->
                    <button
                      type="button"
                      @click.stop="toggleTemplatePin(tpl)"
                      class="px-2 py-0.5 rounded-full text-xs font-bold shadow-md flex items-center space-x-1 cursor-pointer transition-all"
                      :class="tpl.is_pinned ? 'bg-amber-500 text-black shadow-amber-500/30' : 'bg-black/60 backdrop-blur text-slate-300 hover:text-amber-300 border border-white/20'"
                    >
                      <span>⭐</span>
                      <span>{{ tpl.is_pinned ? '常用' : '设常用' }}</span>
                    </button>

                    <!-- 模态标签 -->
                    <span
                      class="px-2 py-0.5 rounded-full text-[11px] font-bold backdrop-blur shadow-sm border"
                      :class="getTemplateTypeBadgeClass(tpl)"
                    >
                      {{ getTemplateTypeLabel(tpl) }}
                    </span>
                  </div>

                  <span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-black/60 backdrop-blur text-slate-300 border border-white/20 font-bold">
                    {{ tpl.aspect_ratio || '16:9' }}
                  </span>
                </div>
              </div>

              <!-- 卡片信息区 -->
              <div class="p-4 flex-1 flex flex-col space-y-3">
                <!-- 空间/风格标签行 -->
                <div class="flex items-center space-x-2 text-[11px]">
                  <span v-if="tpl.space" class="px-2 py-0.5 rounded-md bg-studio-950 text-slate-300 border border-studio-800 font-bold">
                    🏠 {{ tpl.space }}
                  </span>
                  <span v-if="tpl.style" class="px-2 py-0.5 rounded-md bg-studio-950 text-studio-cyan border border-studio-800 font-bold">
                    🎨 {{ tpl.style }}
                  </span>
                  <div class="flex-1"></div>
                  <span v-if="tpl.use_count > 0" class="text-[11px] text-amber-400 font-mono font-bold flex items-center space-x-1">
                    <span>🔥</span>
                    <span>复用 {{ tpl.use_count }} 次</span>
                  </span>
                </div>

                <!-- 标题与编辑 -->
                <div class="flex items-center justify-between group/title min-h-[26px]">
                  <div v-if="editingTemplateId === tpl.id" class="flex-1 flex items-center space-x-2" @click.stop>
                    <input
                      v-model="editingTemplateTitle"
                      type="text"
                      maxlength="50"
                      class="flex-1 bg-studio-950 border border-studio-accent rounded-lg px-2.5 py-1 text-xs text-white outline-none font-bold"
                      @keydown.enter.prevent="confirmRenameTemplate(tpl)"
                      @keydown.esc="editingTemplateId = ''"
                      autofocus
                    />
                    <button @click.stop="confirmRenameTemplate(tpl)" class="text-emerald-400 hover:text-emerald-300 text-xs font-bold px-2 py-1 bg-emerald-950/40 rounded">保存</button>
                    <button @click.stop="editingTemplateId = ''" class="text-slate-400 hover:text-slate-300 text-xs px-1.5 py-1">取消</button>
                  </div>
                  <div v-else class="flex-1 flex items-center justify-between min-w-0">
                    <h4 class="text-sm font-bold text-white truncate group-hover/card:text-studio-accent transition-colors" :title="tpl.title">
                      {{ tpl.title }}
                    </h4>
                    <button
                      type="button"
                      @click.stop="startRenameTemplate(tpl)"
                      class="text-slate-400 hover:text-studio-accent transition-colors text-xs p-1 ml-1 cursor-pointer"
                      title="重命名作品"
                    >
                      <StudioIcon name="edit" :size="13" />
                    </button>
                  </div>
                </div>

                <!-- 提示词内容 -->
                <div class="p-2.5 rounded-xl bg-studio-950 border border-studio-800 text-[11px] text-slate-300 leading-relaxed max-h-20 overflow-y-auto scrollbar-thin">
                  {{ tpl.prompt }}
                </div>

                <!-- 底部操作按钮 -->
                <div class="pt-2 border-t border-studio-800 flex items-center justify-between gap-2 mt-auto">
                  <button
                    type="button"
                    class="text-xs font-bold text-rose-400 hover:text-rose-300 cursor-pointer flex items-center space-x-1"
                    @click.stop="deleteTemplate(tpl.id)"
                  >
                    <StudioIcon name="trash" :size="13" />
                    <span>删除</span>
                  </button>

                  <div class="flex items-center space-x-2">
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-200 text-xs font-bold cursor-pointer"
                      @click="openTemplateDetail(tpl)"
                    >
                      查看详情
                    </button>
                    <button
                      type="button"
                      class="px-4 py-1.5 rounded-xl bg-studio-accent hover:brightness-110 text-white text-xs font-bold shadow-md cursor-pointer flex items-center space-x-1"
                      @click="applyTemplate(tpl)"
                    >
                      <span>🚀 复用创作</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="retryDialog.visible" class="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4">
      <div class="w-full max-w-md rounded-2xl bg-studio-900 border border-studio-700 p-5 space-y-4">
        <p class="text-sm font-bold text-white">按刚才的提示词、参考图和模型再提交一次。</p>
        <div class="flex gap-2">
          <button type="button" class="flex-1 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" @click="confirmDirectRetry">直接重试</button>
          <button type="button" class="flex-1 py-2 rounded-lg border border-studio-700 text-xs font-bold cursor-pointer" @click="editFromRetryDialog">改为编辑</button>
        </div>
      </div>
    </div>
    <div v-if="retryNotice" class="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4">
      <div class="w-full max-w-md rounded-2xl bg-studio-900 border border-studio-700 p-5 space-y-4">
        <p class="text-sm text-slate-100">已重新提交。视频队列满时可能还会失败，可以稍后再试。</p>
        <button type="button" class="w-full py-2 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" @click="retryNotice = false">知道了</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import StudioIcon from '../../components/StudioIcon.vue';
import DynamicModelParamBar from '../../components/DynamicModelParamBar.vue';
import AssetPickerModal from '../../components/AssetPickerModal.vue';
import { STUDIO_SKILLS_REGISTRY, evaluateClientModelRules, normalizeClientLayerStack } from '../../utils/model-protocol';
import { contextBudgetTokens, trimChatMessages } from '../../../../src/chat-context.mjs';
import {
  getAssetImageUrl,
  authFetch,
  generateAiImage,
  generateAiVideo,
  generateAiAudio,
  generateAiChat,
  fetchChatSessions,
  fetchChatMessages,
  saveChatMessage,
  deleteChatSession,
  registerGeneratedAsset,
  moveAssetShelf,
  fetchStudioCatalog
} from '../../api';

const props = defineProps({
  initialPayload: { type: Object, default: null }
});

const emit = defineEmits(['sendToPrecisionEdit', 'sendToClip']);

// 侧栏与基础状态
const sidebarTab = ref('history'); // 'history' | 'library'
const currentSessionId = ref('default_session');
const tplSearch = ref('');
const generating = ref(false);
// 等待文案按模型/模式给出真实预期，本地 Qwen 是分钟级，不再显示误导性的「3 秒」
const generatingHint = computed(() => {
  if (activeModality.value === 'video') return '视频云端渲染通常需要 1~3 分钟，完成后会自动出现在对话中，可继续输入其他需求…';
  if (activeModality.value === 'music') return '配乐合成中，通常需要 30~60 秒…';
  if (activeModality.value === 'image' && imageModelKey.value === 'qwenimage_local') {
    const size = schemaParams.value.size === '2K' ? '2K' : '1K';
    const base = size === '2K'
      ? '本机 Qwen-Image 2K 生成约需 4~7 分钟（模型加载与逐像素扩散），1K 约 1.5~3 分钟'
      : '本机 Qwen-Image 正在加载模型并逐像素扩散，1K 约 1.5~3 分钟，期间不占用云端额度';
    return `${base}，完成后自动显示…`;
  }
  return '云端生图引擎推理中，通常 10~30 秒…';
});
const optimizing = ref(false);
const optimizeUndo = ref(null);
const showHashMenu = ref(false);
const showAssetSelector = ref(false);
const richEditorRef = ref(null);
const messageScroller = ref(null);
const sessionRefPool = ref([]);

// 核心底栏 4 模态：'chat' (纯对话) | 'image' (图片生成) | 'video' (视频生成) | 'music' (音乐生成)
const activeModality = ref('chat'); // 默认纯对话！

// 纯对话专属状态
const chatModelKey = ref('volc_doubao_seed_2_1_pro');
// 思考强度：取值由当前模型在官方目录声明的 caps.reasoning 决定
const thinkingStrength = ref('');
const expandedThinking = ref({});

// 图像模式专属参数
const imageModelKey = ref('seedream5flash');
const selectedResolution = ref('2K');
const selectedRatio = ref('16:9');
const selectedStylePreset = ref('default');
const imageWatermark = ref(false);

// 视频模式专属参数
const videoSubMode = ref('first_last'); // 'first_last' | 'multi_ref' | 'prompt_only'
const videoModelKey = ref('seedance2_5');
const videoDuration = ref('5');
const videoResolution = ref('1080p');
const videoCameraMove = ref('zoom_in');
const videoSyncAudio = ref(true);
const sampleVideoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

// 音乐模式专属参数
const musicType = ref('doubao_bgm_v5');
const musicDuration = ref('30');
const studioSchemas = ref({});
const studioModels = ref({
  chat: [],
  image: [],
  video: [],
  music: []
});

// ---- 模型按「提供商 · 模型族」两级分组（原生 optgroup，无需自绘下拉） ----
function groupModelsByProvider(models) {
  const groups = [];
  const index = new Map();
  for (const m of models || []) {
    const provider = m.providerGroup || m.providerName || '其他';
    const family = m.familyName || '';
    const label = family ? `${provider} · ${family}` : provider;
    if (!index.has(label)) {
      index.set(label, { label, models: [] });
      groups.push(index.get(label));
    }
    index.get(label).models.push(m);
  }
  return groups;
}
const chatModelGroups = computed(() => groupModelsByProvider(studioModels.value.chat));
const imageModelGroups = computed(() => groupModelsByProvider(studioModels.value.image));
const videoModelGroups = computed(() => groupModelsByProvider(studioModels.value.video));
const musicModelGroups = computed(() => groupModelsByProvider(studioModels.value.music));

const currentChatModel = computed(() => (studioModels.value.chat || []).find((m) => m.id === chatModelKey.value) || null);
const chatReasoningCaps = computed(() => currentChatModel.value?.reasoning || null);
const THINKING_LABELS = { off: '关闭', on: '开启', none: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' };
function thinkingLevelLabel(level) {
  return THINKING_LABELS[level] || level;
}
watch(chatReasoningCaps, (caps) => {
  thinkingStrength.value = caps && caps.supported ? (caps.default || caps.levels?.[0] || '') : '';
}, { immediate: true });
// 兜底拆分：部分上游（如 Gemma）把 <thought> 混在正文里，服务端未拆分时客户端再拆一次
function splitClientThinking(content, reasoning) {
  let think = typeof reasoning === 'string' ? reasoning : '';
  let text = typeof content === 'string' ? content : '';
  const take = (inner) => {
    const t = (inner || '').trim();
    if (t) think = think ? `${think}\n${t}` : t;
  };
  text = text.replace(/<(thought|thinking)>([\s\S]*?)<\/\1>/gi, (_, __, inner) => { take(inner); return ''; });
  const open = text.match(/<(thought|thinking)>([\s\S]*)$/i);
  if (open) { take(open[2]); text = text.replace(/<(thought|thinking)>[\s\S]*$/i, ''); }
  return { content: text.trim(), thinking: think.trim() };
}

// 助手正文按 Markdown 渲染：marked 解析 + DOMPurify 净化，再组装成「可选中、可分段复制」的文本块。
// 分块规则：h1–h4 按层级嵌套成卡片（标题即卡片头），代码块/引用/表格各自独立成块，
// 每块一个复制按钮；点击只写入构建期算好的纯文本，不依赖 innerText 的渲染态。
marked.setOptions({ gfm: true, breaks: true });
// 所有外链安全地在新标签打开（DOMPurify 净化后再补属性）
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node && node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});
const MD_SANITIZE = {
  ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','strong','b','em','i','del','code','pre','blockquote','ul','ol','li','a','img','table','thead','tbody','tr','th','td','span','div'],
  ALLOWED_ATTR: ['href','src','alt','title','class','target','rel'],
  RETURN_DOM: true,
};
const MD_BLOCK_TAGS = new Set(['H1','H2','H3','H4','H5','H6','P','UL','OL','LI','BLOCKQUOTE','PRE','TABLE','THEAD','TBODY','TR','DIV']);

function mdNodeText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.hasAttribute('data-md-no-copy')) return '';
  if (node.tagName === 'BR') return '\n';
  let s = '';
  for (let i = 0; i < node.childNodes.length; i += 1) s += mdNodeText(node.childNodes[i]);
  if (node.tagName === 'TD' || node.tagName === 'TH') return `${s.trim()}\t`;
  if (MD_BLOCK_TAGS.has(node.tagName)) return s.trim() ? `\n${s.trim()}\n` : '';
  return s;
}

function mdPlainText(el) {
  return mdNodeText(el)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mdCodeLang(pre) {
  const code = pre && pre.querySelector('code');
  const m = code ? /language-([\w-]+)/.exec(code.className || '') : null;
  return m ? m[1] : '文本';
}

function mdUnitBox(kind, labelText) {
  const box = document.createElement('div');
  box.className = `md-unit md-unit-${kind}`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'md-copy-btn';
  btn.setAttribute('data-md-copy', '1');
  btn.setAttribute('data-md-no-copy', '1');
  btn.textContent = '复制';
  if (labelText) {
    const bar = document.createElement('div');
    bar.className = 'md-unit-bar';
    bar.setAttribute('data-md-no-copy', '1');
    const label = document.createElement('span');
    label.className = 'md-unit-label';
    label.textContent = labelText;
    bar.appendChild(label);
    bar.appendChild(btn);
    box.appendChild(bar);
  } else {
    box.appendChild(btn);
  }
  return { box, btn };
}

// 代码块/引用/表格是「可独立复制的叶子块」，无论出现在正文顶层还是列表项内部都要成块：
// 反向遍历保证先包最深层，已被包裹的不再重复包裹。
function mdWrapLeaves(root) {
  const found = Array.from(root.querySelectorAll('pre, blockquote, table'));
  for (let i = found.length - 1; i >= 0; i -= 1) {
    const node = found[i];
    if (node.parentElement && node.parentElement.closest('.md-unit')) continue;
    const kind = node.tagName === 'PRE' ? 'code' : node.tagName === 'TABLE' ? 'table' : 'quote';
    const unit = mdUnitBox(kind, kind === 'code' ? mdCodeLang(node) : null);
    node.parentNode.replaceChild(unit.box, node);
    unit.box.appendChild(node);
  }
}

function buildMdUnits(root) {
  mdWrapLeaves(root);
  const out = document.createElement('div');
  const stack = [];
  const target = () => (stack.length ? stack[stack.length - 1].box : out);
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent && node.textContent.trim()) target().appendChild(node);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName;
    const heading = /^H([1-4])$/.exec(tag);
    if (heading) {
      const level = Number(heading[1]);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const unit = mdUnitBox('sec');
      target().appendChild(unit.box);
      unit.box.appendChild(node);
      stack.push({ level, box: unit.box });
      continue;
    }
    // 分隔线只用来结束当前分段：卡片本身已有边框，再画一条反而杂乱
    if (tag === 'HR') {
      stack.length = 0;
      continue;
    }
    target().appendChild(node);
  }
  // 只取直接子按钮，嵌套卡片的按钮不会被外层认领
  for (const unit of Array.from(out.querySelectorAll('.md-unit'))) {
    const btn = unit.querySelector(':scope > .md-copy-btn, :scope > .md-unit-bar > .md-copy-btn');
    if (btn) btn.setAttribute('data-copy', mdPlainText(unit));
  }
  return out;
}

const mdHtmlCache = new Map();
function renderMarkdown(src) {
  const text = typeof src === 'string' ? src : '';
  if (!text) return '';
  const hit = mdHtmlCache.get(text);
  if (hit !== undefined) return hit;
  const dom = DOMPurify.sanitize(marked.parse(text, { async: false }), MD_SANITIZE);
  const html = buildMdUnits(dom).innerHTML;
  mdHtmlCache.set(text, html);
  if (mdHtmlCache.size > 200) mdHtmlCache.delete(mdHtmlCache.keys().next().value);
  return html;
}

// 30002 常以 http://内网IP 访问，非安全上下文下 navigator.clipboard 直接不可用，
// 所以必须保留 textarea + execCommand 这条兜底路径。
function legacyCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

// 复制反馈只改按钮自身文案（本项目没有全局 toast，也不为一个提示引入依赖）
function flashCopyBtn(btn, label) {
  if (!btn) return;
  const idle = btn.getAttribute('data-idle-label') || btn.textContent;
  btn.setAttribute('data-idle-label', idle);
  btn.textContent = label;
  setTimeout(() => {
    btn.textContent = idle;
  }, 1500);
}

async function copyText(text, btn) {
  const value = typeof text === 'string' ? text : '';
  if (!value) {
    flashCopyBtn(btn, '无内容');
    return;
  }
  let ok = false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) ok = legacyCopyText(value);
  flashCopyBtn(btn, ok ? '已复制' : '复制失败');
}

// 分段复制：按钮在 renderMarkdown 构建期写好 data-copy，事件由 .chat-md 容器委托
// （v-html 内容无法直接绑 Vue 事件）。
function onMdClick(event) {
  const btn = event.target.closest('[data-md-copy]');
  if (!btn) return;
  event.stopPropagation();
  copyText(btn.getAttribute('data-copy'), btn);
}
const activeGenMode = ref('');
const schemaParams = ref({});
const showAdvanced = ref(false);
const showSkillsMenu = ref(false);
const activeSkillIds = ref([]);
const availableStudioSkills = computed(() =>
  STUDIO_SKILLS_REGISTRY.filter((s) => !s.modality || s.modality.includes(activeModality.value))
);
const currentRefCounts = computed(() => {
  const list = referenceTray.value || [];
  return {
    images: list.filter((r) => !r.kind || r.kind === 'image').length,
    videos: list.filter((r) => r.kind === 'video').length,
    audios: list.filter((r) => r.kind === 'audio' || r.kind === 'music').length,
  };
});
function activeSnippetIds() {
  const ids = [];
  for (const skillId of activeSkillIds.value) {
    const skill = STUDIO_SKILLS_REGISTRY.find((item) => item.id === skillId);
    if (skill && Array.isArray(skill.snippetIds)) ids.push(...skill.snippetIds);
  }
  return ids;
}

function toggleStudioSkill(skill) {
  if (!skill) return;
  const idx = activeSkillIds.value.indexOf(skill.id);
  if (idx >= 0) {
    activeSkillIds.value.splice(idx, 1);
  } else {
    activeSkillIds.value.push(skill.id);
    if (skill.autoParams && typeof skill.autoParams === 'object') {
      schemaParams.value = clampParamsToSchema(currentSchema.value, { ...schemaParams.value, ...skill.autoParams });
      applyModeLocks();
    }
  }
}
const oldRecipeNote = ref(false);
const composerError = ref('');
const retryDialog = ref({ visible: false, msg: null });
const retryNotice = ref(false);
let suppressSchemaReset = false;
let reparsingEditor = false;

function modelKeyNow() {
  if (activeModality.value === 'image') return imageModelKey.value;
  if (activeModality.value === 'video') return videoModelKey.value;
  if (activeModality.value === 'music') return musicType.value;
  return '';
}
const currentSchema = computed(() => {
  const key = modelKeyNow();
  if (studioSchemas.value[key]) return studioSchemas.value[key];
  return null;
});
// 共享素材选择器的「最近素材」：本会话最近上传与生成的素材，置顶并标记来源
const assetPickerRecent = computed(() => {
  const list = [];
  for (let i = sessionRefPool.value.length - 1; i >= 0 && list.length < 12; i -= 1) {
    const item = sessionRefPool.value[i];
    if (!item?.url) continue;
    list.push({
      ...item,
      mark: item.origin === 'generated' ? '本次生成' : '对话使用',
    });
  }
  return list;
});
const commonFields = computed(() => {
  const schema = currentSchema.value;
  if (!schema) return [];
  const fields = [...(schema.common || [])];
  if (activeGenMode.value === 'image_edit') {
    for (const key of ['bbox', 'point']) {
      const field = (schema.advanced || []).find((item) => item.key === key);
      if (field && !fields.some((item) => item.key === key)) fields.push(field);
    }
  }
  return fields;
});
const advancedFields = computed(() => {
  const schema = currentSchema.value;
  if (!schema) return [];
  return (schema.advanced || []).filter((field) => !(activeGenMode.value === 'image_edit' && (field.key === 'bbox' || field.key === 'point')));
});
function optionText(field, value) {
  if (field.labels && field.labels[String(value)] != null) return field.labels[String(value)];
  if (value === -1 || value === '-1') return '智能';
  return String(value);
}
function schemaDefaults(schema) {
  const out = {};
  for (const field of [...(schema.common || []), ...(schema.advanced || [])]) out[field.key] = field.default;
  return out;
}
function fieldByKey(schema, key) {
  return [...(schema?.common || []), ...(schema?.advanced || [])].find((field) => field.key === key);
}
function valueStillFits(schema, key, value) {
  const field = fieldByKey(schema, key);
  if (!field) return false;
  if (field.type === 'enum') return (field.options || []).map(String).includes(String(value));
  if (['number', 'range', 'duration'].includes(field.type)) {
    if (value === '' || value == null) return false;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (field.min != null && n < Number(field.min)) return false;
    if (field.max != null && n > Number(field.max)) return false;
  }
  return true;
}
function lockedKeySet() {
  const evaluated = evaluateClientModelRules(currentSchema.value, activeGenMode.value, schemaParams.value, currentRefCounts.value);
  return new Set(evaluated.lockedKeys || []);
}
function isFieldLocked(key) {
  return lockedKeySet().has(key);
}
function applyModeLocks() {
  const evaluated = evaluateClientModelRules(currentSchema.value, activeGenMode.value, schemaParams.value, currentRefCounts.value);
  schemaParams.value = evaluated.params;
}
function resetSchemaForModel() {
  const schema = currentSchema.value;
  showAdvanced.value = false;
  if (!schema) {
    activeGenMode.value = '';
    schemaParams.value = {};
    return;
  }
  const modes = schema.modes || [];
  if (!modes.some((mode) => mode.id === activeGenMode.value)) activeGenMode.value = modes[0]?.id || '';
  const next = schemaDefaults(schema);
  for (const key of Object.keys(next)) {
    if (schemaParams.value[key] != null && valueStillFits(schema, key, schemaParams.value[key])) next[key] = schemaParams.value[key];
  }
  schemaParams.value = next;
  applyModeLocks();
  const id = activeGenMode.value;
  if (id === 'first_last_frame') videoSubMode.value = 'first_last';
  else if (id === 'text_to_video' || id === 'text_to_image') videoSubMode.value = 'prompt_only';
  else if (id) videoSubMode.value = 'multi_ref';
}
function setGenMode(id) {
  const modes = currentSchema.value?.modes || [];
  if (modes.length && !modes.some((mode) => mode.id === id)) return;
  activeGenMode.value = id;
  applyModeLocks();
  if (id === 'first_last_frame') videoSubMode.value = 'first_last';
  else if (id === 'text_to_video' || id === 'text_to_image') videoSubMode.value = 'prompt_only';
  else if (id) videoSubMode.value = 'multi_ref';
}
function setSchemaParam(key, value) {
  if (isFieldLocked(key)) return;
  schemaParams.value = { ...schemaParams.value, [key]: value };
}
function audioOnlyModel() {
  const schema = currentSchema.value;
  return activeModality.value === 'music'
    && Number(schema?.slots?.audios || 0) > 0
    && Number(schema?.slots?.images || 0) === 0;
}
const fileAccept = computed(() => (audioOnlyModel() ? 'audio/*' : 'image/*,video/*,audio/*'));
function refCap() {
  const schema = currentSchema.value;
  if (audioOnlyModel()) return Number(schema.slots.audios);
  const raw = schema?.slots?.images;
  if (raw == null || raw === '') return null;
  const slots = Number(raw);
  if (!Number.isFinite(slots)) return null;
  const free = schema.free?.maxRefs;
  let cap = free != null ? Math.min(slots, Number(free)) : slots;
  if (activeGenMode.value === 'first_last_frame') cap = Math.min(cap, 2);
  if (activeGenMode.value === 'image_edit' || activeGenMode.value === 'expand_fill') cap = Math.min(cap, 1);
  return cap;
}
function modeRefError(tray) {
  const items = Array.isArray(tray) ? tray : [];
  if (audioOnlyModel()) {
    const audios = items.filter((item) => mediaKind(item) === 'audio').length;
    const cap = Number(currentSchema.value.slots.audios);
    if (audios < 1) return '这个模型需要一段参考音频，10 到 15 秒最合适';
    if (audios > cap) return `参考音频最多 ${cap} 段`;
    return '';
  }
  const count = items.filter((item) => mediaKind(item) !== 'audio').length;
  const cap = refCap();
  const mode = activeGenMode.value;
  if (cap != null && count > cap) return `当前 ${count} 张，这个模型最多 ${cap} 张`;
  if (mode === 'first_last_frame' && count !== 2) return '首尾帧需要两张图，第一张是首帧，第二张是尾帧';
  if ((mode === 'image_edit' || mode === 'expand_fill') && count !== 1) return '这个模式需要一张底图';
  if (['image_to_image', 'image_reference', 'image_to_video', 'omni_reference'].includes(mode) && count < 1) return '这个模式需要至少一张参考图';
  return '';
}
function declaredParams() {
  const schema = currentSchema.value;
  const keys = new Set([...(schema?.common || []), ...(schema?.advanced || [])].map((field) => field.key));
  const extras = {};
  for (const key of keys) {
    const value = schemaParams.value[key];
    if (value != null && value !== '') extras[key] = value;
  }
  return extras;
}
function recipeIsLegacy(tpl) {
  const params = tpl?.params || {};
  const mode = params.genMode || params.mode;
  const modelKey = params.modelKey || params.model;
  const hasResult = Array.isArray(tpl?.result_images) && tpl.result_images.some((item) => item && item.url);
  return !mode && !modelKey && hasResult;
}
watch([activeModality, imageModelKey, videoModelKey, musicType], () => {
  if (suppressSchemaReset) return;
  resetSchemaForModel();
});

// 模态弹窗状态与创作库高级分类体系
const saveModal = ref({
  visible: false,
  title: '',
  prompt: '',
  type: 'image',
  space: '客厅',
  style: '意式极简',
  is_pinned: false,
  msg: null
});
const detailModal = ref({ visible: false, tpl: {} });
const savingTpl = ref(false);

// 创作库分类、筛选、放大画廊与重命名状态
const tplTypeFilter = ref('all'); // 'all', 'image', 'video', 'audio'
const tplSpaceFilter = ref('全部空间');
const tplStyleFilter = ref('全部风格');
const tplPinnedOnly = ref(false);
const showExpandedLibrary = ref(false);
const isLibraryFullscreen = ref(false);
const editingTemplateId = ref('');
const editingTemplateTitle = ref('');

function openCreationLibraryModal() {
  showExpandedLibrary.value = true;
}

function toggleLibraryFullscreen() {
  isLibraryFullscreen.value = !isLibraryFullscreen.value;
}

const SPACE_OPTIONS = [
  '全部空间', '客厅', '主卧', '次卧', '餐厅', '厨房', '阳台', '玄关', '卫浴', '书房', '商业展厅', '建筑庭院'
];

const STYLE_OPTIONS = [
  '全部风格', '意式极简', '法式轻奢', '现代简约', '侘寂风', '奶油风', '新中式', '美式复古', '工业Loft', '原木风'
];

const MODALITY_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '生图' },
  { id: 'video', label: '生视频' },
  { id: 'audio', label: '生音频' }
];

function sortTemplates() {
  templates.value.sort((a, b) => {
    const pinA = a.is_pinned ? 1 : 0;
    const pinB = b.is_pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    const useA = Number(a.use_count || 0);
    const useB = Number(b.use_count || 0);
    if (useA !== useB) return useB - useA;
    return (b.updated_at || 0) - (a.updated_at || 0);
  });
}

function resetTplFilters() {
  tplSearch.value = '';
  tplTypeFilter.value = 'all';
  tplSpaceFilter.value = '全部空间';
  tplStyleFilter.value = '全部风格';
  tplPinnedOnly.value = false;
}

function getTemplateTypeLabel(tpl) {
  const type = tpl.type || (tpl.params?.genMode === 'music' ? 'audio' : (tpl.params?.genMode === 'video' ? 'video' : 'image'));
  if (type === 'video') return '🎬 生视频';
  if (type === 'audio') return '🎵 生音频';
  return '🖼️ 生图';
}

function getTemplateTypeBadgeClass(tpl) {
  const type = tpl.type || (tpl.params?.genMode === 'music' ? 'audio' : (tpl.params?.genMode === 'video' ? 'video' : 'image'));
  if (type === 'video') return 'bg-purple-950/80 text-purple-200 border-purple-700/60';
  if (type === 'audio') return 'bg-emerald-950/80 text-emerald-200 border-emerald-700/60';
  return 'bg-studio-950 text-studio-cyan border-studio-800';
}

function detectSpaceFromText(text) {
  if (!text) return '客厅';
  const s = String(text);
  if (s.includes('主卧')) return '主卧';
  if (s.includes('次卧') || s.includes('儿童房') || s.includes('客卧')) return '次卧';
  if (s.includes('卧室') || s.includes('床头')) return '主卧';
  if (s.includes('客厅') || s.includes('客餐厅') || s.includes('起居室')) return '客厅';
  if (s.includes('餐厅') || s.includes('餐边') || s.includes('岛台')) return '餐厅';
  if (s.includes('厨房') || s.includes('橱柜')) return '厨房';
  if (s.includes('卫浴') || s.includes('卫生间') || s.includes('浴室') || s.includes('洗手台')) return '卫浴';
  if (s.includes('阳台') || s.includes('露台')) return '阳台';
  if (s.includes('玄关') || s.includes('入户')) return '玄关';
  if (s.includes('书房') || s.includes('工作区') || s.includes('茶室')) return '书房';
  if (s.includes('展厅') || s.includes('商业') || s.includes('店铺') || s.includes('酒店')) return '商业展厅';
  if (s.includes('庭院') || s.includes('建筑') || s.includes('外立面')) return '建筑庭院';
  return '客厅';
}

function detectStyleFromText(text) {
  if (!text) return '意式极简';
  const s = String(text);
  if (s.includes('法式') || s.includes('轻奢') || s.includes('法师')) return '法式轻奢';
  if (s.includes('意式') || s.includes('极简') || s.includes('极简主义')) return '意式极简';
  if (s.includes('现代') || s.includes('纯白')) return '现代简约';
  if (s.includes('侘寂') || s.includes('微水泥')) return '侘寂风';
  if (s.includes('奶油') || s.includes('法式奶油')) return '奶油风';
  if (s.includes('中式') || s.includes('新中式') || s.includes('东方')) return '新中式';
  if (s.includes('美式') || s.includes('复古')) return '美式复古';
  if (s.includes('工业') || s.includes('Loft') || s.includes('水泥')) return '工业Loft';
  if (s.includes('原木') || s.includes('日式')) return '原木风';
  return '意式极简';
}

function startRenameTemplate(tpl) {
  editingTemplateId.value = tpl.id;
  editingTemplateTitle.value = tpl.title;
}

async function confirmRenameTemplate(tpl) {
  const newTitle = (editingTemplateTitle.value || '').trim();
  if (!newTitle) {
    editingTemplateId.value = '';
    return;
  }
  const oldTitle = tpl.title;
  tpl.title = newTitle;
  editingTemplateId.value = '';
  try {
    const res = await authFetch(`/api/creation-templates/${encodeURIComponent(tpl.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    });
    const json = await res.json();
    if (!json.success) {
      tpl.title = oldTitle;
      alert('修改作品名称失败: ' + (json.error || '未知错误'));
    }
  } catch (e) {
    tpl.title = oldTitle;
    alert('修改作品名称失败: ' + e.message);
  }
}

async function toggleTemplatePin(tpl) {
  const nextPinned = tpl.is_pinned ? 0 : 1;
  const oldPinned = tpl.is_pinned;
  tpl.is_pinned = nextPinned;
  sortTemplates();
  try {
    const res = await authFetch(`/api/creation-templates/${encodeURIComponent(tpl.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: nextPinned })
    });
    const json = await res.json();
    if (!json.success) {
      tpl.is_pinned = oldPinned;
      sortTemplates();
      alert('标常用操作失败: ' + (json.error || '未知错误'));
    }
  } catch (e) {
    tpl.is_pinned = oldPinned;
    sortTemplates();
    alert('标常用操作失败: ' + e.message);
  }
}

// 对话列表
const sessions = ref([]);
const promptHistory = ref([]);
const historyIndex = ref(-1);
let currentDraftText = '';
let currentDraftTray = [];

const templates = ref([]);
const messages = ref([]);

// 真实参考托盘 (初始为空，杜绝写死假数据！)
const referenceTray = ref([]);

// 媒体大图/视频预览弹窗
const previewModal = ref({
  visible: false,
  url: '',
  type: 'image', // 'image' | 'video'
  title: '',
  scale: 1.0
});

// 灵感胶囊预设
const chatQuickStarters = [
  '分析当前客餐厅采光与透视动线，提出优化建议',
  '根据现有地面木纹，推荐 3 套温润协调的软装材质搭配方案',
  '如何将传统中式客餐厅改造成极简新中式空间？'
];

const imageQuickStarters = [
  { title: '极简真皮沙发置换', desc: '参考@图1的空间格局，精准替换为现代轻奢真皮沙发，保留自然采光' },
  { title: '开关面板墙面贴合', desc: '在指定床头或玄关墙面安装极简磨砂智能触控开关，边缘贴合无缝' },
  { title: '全景超宽空间扩图', desc: '向左右两侧拓展室内视界，补全落地大窗与现代开放式岛台' },
  { title: '原木侘寂风全局改造', desc: '将冷白亮光瓷砖转换为温润微水泥与原木肌理，营造静谧氛围' }
];

const videoQuickStarters = [
  { title: '慢速推镜穿过落地窗', desc: '镜头从客厅全景缓缓向前推入，阳光微移，窗帘随微风轻拂，进入开阔阳台' },
  { title: '晨曦光影在木地板上的流动', desc: '固定机位室内延时摄影，晨曦金色阳光在原木地板上缓慢拉长，空间光影流转' },
  { title: '360度环绕沙发展示透视', desc: '环绕镜头以沙发为中心顺时针旋转60度，展示家具立体质感与室内纵深' },
  { title: '昼夜室内光线柔和渐变', desc: '首帧为清晨自然采光，随镜头平移柔和过渡至夜幕暖色氛围壁灯点亮' }
];

const musicStarters = [
  { title: 'Nordic Morning (北欧轻晨)', duration: '00:30', desc: '清晨微风穿过薄纱窗帘，原声木吉他与温和晨光' },
  { title: 'Deep Focus Ambient (空间白噪音)', duration: '00:30', desc: '静谧微水泥空间，细微环境回响，极度放松舒适' },
  { title: 'Modern Luxury Elegance (轻奢弦乐)', duration: '00:30', desc: '现代大平层室内宣传片大提琴与钢琴柔和交织' }
];

const filteredTemplates = computed(() => {
  const q = tplSearch.value.trim().toLowerCase();
  const type = tplTypeFilter.value;
  const space = tplSpaceFilter.value;
  const style = tplStyleFilter.value;
  const pinnedOnly = tplPinnedOnly.value;

  return templates.value.filter(tpl => {
    if (pinnedOnly && !tpl.is_pinned) return false;
    if (type !== 'all') {
      const tType = tpl.type || (tpl.params?.genMode === 'music' ? 'audio' : (tpl.params?.genMode === 'video' ? 'video' : 'image'));
      if (tType !== type) return false;
    }
    if (space !== '全部空间' && tpl.space && tpl.space !== space) return false;
    if (style !== '全部风格' && tpl.style && tpl.style !== style) return false;
    if (q) {
      const matchTitle = (tpl.title || '').toLowerCase().includes(q);
      const matchPrompt = (tpl.prompt || '').toLowerCase().includes(q);
      const matchSpace = (tpl.space || '').toLowerCase().includes(q);
      const matchStyle = (tpl.style || '').toLowerCase().includes(q);
      const matchTags = Array.isArray(tpl.tags) && tpl.tags.some(t => String(t).toLowerCase().includes(q));
      if (!matchTitle && !matchPrompt && !matchSpace && !matchStyle && !matchTags) return false;
    }
    return true;
  });
});

// 监听从素材库一键送入对话的跨板块联动！
watch(() => props.initialPayload, (payload) => {
  if (!payload) return;
  mountAssetFromLibrary(payload);
}, { immediate: true });

onMounted(async () => {
  try {
    const catalog = await fetchStudioCatalog();
    studioSchemas.value = catalog.schemas || {};
    if (catalog.studio) {
      if (catalog.studio.chat?.models) studioModels.value.chat = catalog.studio.chat.models;
      if (catalog.studio.image?.models) studioModels.value.image = catalog.studio.image.models;
      if (catalog.studio.video?.models) studioModels.value.video = catalog.studio.video.models;
      if (catalog.studio.music?.models) studioModels.value.music = catalog.studio.music.models;

      // 如果当前选中的模型不在已启用的列表里，自动回退到默认或首个模型
      if (studioModels.value.chat.length > 0 && !studioModels.value.chat.some(m => m.id === chatModelKey.value)) {
        chatModelKey.value = catalog.studio.chat.defaultModel || studioModels.value.chat[0].id;
      }
      if (studioModels.value.image.length > 0 && !studioModels.value.image.some(m => m.id === imageModelKey.value)) {
        imageModelKey.value = catalog.studio.image.defaultModel || studioModels.value.image[0].id;
      }
      if (studioModels.value.video.length > 0 && !studioModels.value.video.some(m => m.id === videoModelKey.value)) {
        videoModelKey.value = catalog.studio.video.defaultModel || studioModels.value.video[0].id;
      }
      if (studioModels.value.music.length > 0 && !studioModels.value.music.some(m => m.id === musicType.value)) {
        musicType.value = catalog.studio.music.defaultModel || studioModels.value.music[0].id;
      }
    }
  } catch (e) {
    console.warn('模型参数表读取失败', e);
  }
  resetSchemaForModel();
  window.addEventListener('keydown', handleGlobalKeydown);
  streamRO = new ResizeObserver(() => {
    if (pinned.value) {
      if (!pinRaf) pinRaf = requestAnimationFrame(() => { pinRaf = 0; stickToBottom(); });
    } else {
      hasNewBelow.value = true;
    }
  });
  streamMO = new MutationObserver(() => observeStreamRows());
  if (messageScroller.value) {
    streamMO.observe(messageScroller.value, { childList: true });
    observeStreamRows();
  }
  await loadTemplates();
  await loadSessions();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  if (pinRaf) cancelAnimationFrame(pinRaf);
  pinRaf = 0;
  if (streamRO) streamRO.disconnect();
  if (streamMO) streamMO.disconnect();
  streamRO = null;
  streamMO = null;
});

function handleGlobalKeydown(e) {
  if (e.key === 'Escape') {
    if (previewModal.value.visible) {
      previewModal.value.visible = false;
    } else if (detailModal.value.visible) {
      detailModal.value.visible = false;
    } else if (saveModal.value.visible) {
      saveModal.value.visible = false;
    } else if (showAssetSelector.value) {
      showAssetSelector.value = false;
    } else if (showExpandedLibrary.value) {
      if (isLibraryFullscreen.value) {
        isLibraryFullscreen.value = false;
      } else {
        showExpandedLibrary.value = false;
      }
    }
  }
}

function fileNameFromUrl(url) {
  try {
    const base = decodeURIComponent(String(url || '').split('?')[0].split('/').pop() || '');
    if (base && base.includes('.')) return base;
  } catch (e) {}
  return '';
}
function namesInPrompt(text) {
  const names = [];
  const re = /@(?:图|图片|视频|音频)(\d+)\[([^\]]+)\]/g;
  let match;
  while ((match = re.exec(String(text || '')))) names[Number(match[1]) - 1] = match[2];
  return names;
}
function labelForRef(url, promptName) {
  if (promptName && !/^参考图\d+$/.test(promptName)) return promptName;
  return fileNameFromUrl(url) || promptName || '未命名图片';
}
function rememberSessionRefs(items, origin = 'upload') {
  for (const item of items || []) {
    if (!item?.url && !item?.fid) continue;
    const url = item.url || '';
    if (sessionRefPool.value.some((hit) => (item.fid && hit.fid === item.fid) || (url && hit.url === url))) continue;
    sessionRefPool.value.push({
      fid: item.fid || '',
      name: labelForRef(url, item.name),
      url,
      kind: item.kind || 'image',
      tag: item.tag || '',
      origin: item.origin || origin
    });
  }
}
// ---- 消息流「钉底」滚动 ----------------------------------------------------
// chat-scroll 是真正的滚动容器（适老化的 overflow:visible 补丁已删除），
// 用 ResizeObserver 观察每一行消息：新行、流式文字增长、图片加载撑高都会触发，
// 钉住时跟到底，用户上滑后只提示不抢滚动条。
const PIN_THRESHOLD = 48;
const pinned = ref(true);
const hasNewBelow = ref(false);
let streamRO = null;
let streamMO = null;
let pinRaf = 0;
let programmaticUntil = 0;

function stickToBottom() {
  const el = messageScroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function observeStreamRows() {
  const el = messageScroller.value;
  if (!el || !streamRO) return;
  for (const row of el.children) streamRO.observe(row);
}

function onChatScroll() {
  if (Date.now() < programmaticUntil) return;
  const el = messageScroller.value;
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
  if (atBottom) {
    pinned.value = true;
    hasNewBelow.value = false;
  } else {
    pinned.value = false;
  }
}

function scrollToBottom({ behavior = 'auto' } = {}) {
  pinned.value = true;
  hasNewBelow.value = false;
  nextTick(() => {
    const el = messageScroller.value;
    if (!el) return;
    if (behavior === 'smooth') {
      programmaticUntil = Date.now() + 700;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      stickToBottom();
    }
  });
}

function jumpToLatest() {
  scrollToBottom({ behavior: 'smooth' });
}

// 跨板块：将真实素材直接挂载为 @图1 并插入富文本输入框！
function mountAssetFromLibrary(item) {
  const assetUrl = item.url || getAssetImageUrl(item.fid, item.mediaToken);
  const assetName = item.file_name || item.name || '选定素材';

  // 清空历史假参考，实打实挂载选中资产为 @图1
  referenceTray.value = [{
    name: assetName,
    url: assetUrl,
    weight: 90,
    tag: '@图1',
    fid: item.fid
  }];

  // 若素材为视频，自动切换到底栏【视频生成】；若为图片，默认切换到【图片生成】或【纯对话】
  if (item.category === 'video' || item.kind === 'video') {
    activeModality.value = 'video';
  } else {
    activeModality.value = 'image';
  }

  nextTick(() => {
    if (richEditorRef.value) {
      richEditorRef.value.innerHTML = '';
      appendRichSegmentText('参考 ');
      insertChipToEditor(referenceTray.value[0]);
      appendRichSegmentText(' 的空间结构与采光风格，在中央布置家具并保持温润通透质感。');
    }
  });
}

function getEditorPlaceholder() {
  if (activeModality.value === 'chat') {
    return '输入空间设计疑问，或键入 @ 引用素材，键入 # 调用创作库配方...';
  } else if (activeModality.value === 'image') {
    return '描述画面构想；键入 @ 插入素材库图文混排胶囊（如：参考@图1的采光，换成@图2的沙发）；键入 # 调用创作库...';
  } else if (activeModality.value === 'video') {
    return '输入视频运镜描述；可定义@图1为首帧起点，@图2为目标落幅，描述镜头推拉流转...';
  } else if (audioOnlyModel()) {
    return '写下要说的话。先上传一段 10 到 15 秒的参考音频。';
  } else if (musicType.value === 'acestep_local') {
    return '纯音乐写风格。人声歌曲写成【风格】……【歌词】[主歌]……[副歌]……';
  } else {
    return '描述想要的音乐情绪、空间白噪音或影视级配乐风格...';
  }
}

function getSendButtonText() {
  if (activeModality.value === 'chat') return '发送提问';
  if (activeModality.value === 'image') return '立即生图';
  if (activeModality.value === 'video') return '立即生视频';
  if (audioOnlyModel()) return '生成语音';
  return '立即生音乐';
}

function switchModality(mode) {
  activeModality.value = mode;
}

function appendRichSegmentText(text) {
  if (!richEditorRef.value) return;
  const textNode = document.createTextNode(text);
  richEditorRef.value.appendChild(textNode);
}

function applyPromptText(txt) {
  if (!richEditorRef.value) return;
  richEditorRef.value.innerHTML = '';
  appendRichSegmentText(txt);
}

function applyQuickStarter(rec) {
  if (!richEditorRef.value) return;
  richEditorRef.value.innerHTML = '';
  appendRichSegmentText(rec.desc);
}

function paintChipTag(chip, tag) {
  chip.setAttribute('data-tag', tag);
  const span = [...chip.querySelectorAll('span')].find((el) => !el.classList.contains('inline-asset-delete'));
  if (span) span.textContent = `${tag} ${chip.getAttribute('data-name') || ''}`.trim();
}

function syncTrayFromEditor() {
  if (!richEditorRef.value) {
    referenceTray.value = [];
    return;
  }
  const chips = [...richEditorRef.value.querySelectorAll('.inline-asset-chip')];
  const next = [];
  chips.forEach((chip) => {
    const url = chip.getAttribute('data-url') || '';
    const resolved = chip.getAttribute('data-resolved') !== '0';
    if (!resolved || !url) return;
    const existing = next.find((item) => item.url === url);
    const tag = existing ? existing.tag : `@图${next.length + 1}`;
    paintChipTag(chip, tag);
    if (existing) return;
    next.push({
      name: chip.getAttribute('data-name') || labelForRef(url, ''),
      url,
      fid: chip.getAttribute('data-fid') || '',
      kind: chip.getAttribute('data-kind') || 'image',
      origin: chip.getAttribute('data-origin') || 'upload',
      weight: 85,
      tag
    });
  });
  const prev = referenceTray.value;
  const same = prev.length === next.length && next.every((item, i) => item.url === prev[i].url && item.tag === prev[i].tag);
  if (!same) referenceTray.value = next;
}
function editorHasRawMention() {
  if (!richEditorRef.value) return false;
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return /@(?:图|图片|视频|音频)\d+\[[^\]]+\]/.test(node.nodeValue || '');
    if (node.nodeType === Node.ELEMENT_NODE && !(node.classList && node.classList.contains('inline-asset-chip'))) {
      return [...node.childNodes].some(walk);
    }
    return false;
  };
  return [...richEditorRef.value.childNodes].some(walk);
}
function reparseEditorChips(extraAssets) {
  if (!richEditorRef.value || reparsingEditor) return;
  const text = getRawEditorText();
  const names = namesInPrompt(text);
  const pools = [...(extraAssets || []), ...referenceTray.value, ...sessionRefPool.value];
  const tray = names.map((name, index) => {
    const hit = pools.find((asset) => asset && asset.url && (asset.name === name || asset.file_name === name)) || (extraAssets || [])[index];
    if (!hit || !hit.url) return { name: name || '未命名图片', url: '', tag: `@图${index + 1}`, resolved: false };
    return { ...hit, name: hit.name || name, tag: `@图${index + 1}`, resolved: true, origin: hit.origin || 'upload' };
  });
  reparsingEditor = true;
  restorePromptContent(text, tray);
  syncTrayFromEditor();
  reparsingEditor = false;
}
function onEditorInput() {
  const text = getRawEditorText();
  if (text.endsWith('#')) {
    showHashMenu.value = true;
  } else if (!text.includes('#')) {
    showHashMenu.value = false;
  }

  if (text.endsWith('@')) {
    openAssetSelectorModal();
  }
  if (reparsingEditor) return;
  if (editorHasRawMention()) reparseEditorChips([]);
  else syncTrayFromEditor();
}

function onEditorKeyup(e) {
  if (reparsingEditor) return;
  if (e.key === 'Backspace' || e.key === 'Delete') syncTrayFromEditor();
}

function pushPromptHistory(text, tray) {
  if (!text) return;
  const last = promptHistory.value[promptHistory.value.length - 1];
  if (last && last.text === text) return;
  promptHistory.value.push({
    text,
    tray: Array.isArray(tray) ? JSON.parse(JSON.stringify(tray)) : []
  });
  historyIndex.value = promptHistory.value.length;
}

function normalizeRefMentions(text) {
  return String(text || '').replace(/<(Picture|Audio|Video)\s+(\d+)\s*>/gi, (_, kind, n) => {
    const word = { picture: '图片', audio: '音频', video: '视频' }[String(kind).toLowerCase()] || '图片';
    return `@${word}${n}`;
  });
}

function mentionedRefNumbers(text) {
  const nums = new Set();
  const regex = /@(图片|视频|音频|图)(\d+)/g;
  let match;
  while ((match = regex.exec(normalizeRefMentions(text)))) nums.add(Number(match[2]));
  return nums;
}

function withKeptRefMentions(text, tray) {
  const items = (Array.isArray(tray) ? tray : []).filter((item) => item && item.url);
  if (!items.length) return text;
  const mentioned = mentionedRefNumbers(text);
  const missing = items.filter((_, index) => !mentioned.has(index + 1));
  if (!missing.length) return text;
  const prefix = missing.map((item, index) => {
    const kind = mediaKind(item);
    const word = kind === 'audio' ? '音频' : (kind === 'video' ? '视频' : '图片');
    const num = (Array.isArray(tray) ? tray : []).indexOf(item) + 1;
    return `@${word}${num || index + 1}`;
  }).join(' ');
  return `${prefix} ${String(text || '')}`.trim();
}

function restorePromptContent(text, tray) {
  referenceTray.value = Array.isArray(tray) ? JSON.parse(JSON.stringify(tray)) : [];
  if (!richEditorRef.value) return;
  richEditorRef.value.innerHTML = '';
  if (!text) {
    syncTrayFromEditor();
    return;
  }

  const source = normalizeRefMentions(text);
  const regex = /@(图片|视频|音频|图)(\d+)(?:\[([^\]]*)\])?/g;
  let lastIdx = 0;
  let match;
  let found = false;
  while ((match = regex.exec(source)) !== null) {
    found = true;
    if (match.index > lastIdx) appendRichSegmentText(source.slice(lastIdx, match.index));
    const num = parseInt(match[2], 10);
    const bracketName = match[3] || '';
    const matchedAsset = referenceTray.value[num - 1] || {
      name: bracketName || `参考${num}`,
      url: '',
      tag: `@图${num}`,
      resolved: false
    };
    insertChipToEditor(matchedAsset);
    lastIdx = regex.lastIndex;
  }
  if (!found) appendRichSegmentText(source);
  else if (lastIdx < source.length) appendRichSegmentText(source.slice(lastIdx));
  syncTrayFromEditor();
}

function handleEditorArrowKey(direction) {
  if (promptHistory.value.length === 0) return false;

  if (direction === 'up') {
    if (historyIndex.value >= promptHistory.value.length) {
      currentDraftText = getRawEditorText();
      currentDraftTray = JSON.parse(JSON.stringify(referenceTray.value));
    }
    if (historyIndex.value > 0) {
      historyIndex.value--;
      const item = promptHistory.value[historyIndex.value];
      restorePromptContent(item.text, item.tray);
      return true;
    }
  } else if (direction === 'down') {
    if (historyIndex.value < promptHistory.value.length - 1) {
      historyIndex.value++;
      const item = promptHistory.value[historyIndex.value];
      restorePromptContent(item.text, item.tray);
      return true;
    } else if (historyIndex.value === promptHistory.value.length - 1) {
      historyIndex.value = promptHistory.value.length;
      restorePromptContent(currentDraftText, currentDraftTray);
      return true;
    }
  }
  return false;
}

function onEditorKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  } else if (e.key === 'ArrowUp') {
    if (handleEditorArrowKey('up')) {
      e.preventDefault();
    }
  } else if (e.key === 'ArrowDown') {
    if (handleEditorArrowKey('down')) {
      e.preventDefault();
    }
  }
}

function getRawEditorText() {
  if (!richEditorRef.value) return '';
  let result = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.nodeValue;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.classList && node.classList.contains('inline-asset-chip')) {
        const tag = node.getAttribute('data-tag') || '@图1';
        const name = node.getAttribute('data-name') || '';
        result += ` ${tag}[${name}] `;
      } else {
        node.childNodes.forEach(walk);
      }
    }
  };
  richEditorRef.value.childNodes.forEach(walk);
  return result.trim();
}

function insertChipToEditor(asset) {
  if (!richEditorRef.value) return;
  const last = richEditorRef.value.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) {
    last.nodeValue = String(last.nodeValue || '').replace(/@\s*$/, '');
  }
  const chip = document.createElement('span');
  chip.className = 'inline-asset-chip';
  chip.contentEditable = 'false';
  const tag = asset.tag || `@图${referenceTray.value.indexOf(asset) + 1}`;
  chip.setAttribute('data-tag', tag);
  chip.setAttribute('data-name', asset.name || '');
  chip.setAttribute('data-url', asset.url || '');
  chip.setAttribute('data-fid', asset.fid || '');
  chip.setAttribute('data-kind', asset.kind || 'image');
  chip.setAttribute('data-origin', asset.origin || 'upload');
  chip.setAttribute('data-resolved', asset.url && asset.resolved !== false ? '1' : '0');
  chip.onclick = () => {
    if (asset.url) openMediaPreview(asset);
  };

  const img = document.createElement('img');
  if (asset.url) img.src = asset.url;
  img.className = 'inline-asset-thumb';

  const textSpan = document.createElement('span');
  textSpan.innerText = `${tag} ${asset.name || ''}`.trim();

  const delBtn = document.createElement('span');
  delBtn.className = 'inline-asset-delete';
  delBtn.innerText = '×';
  delBtn.onclick = (e) => {
    e.stopPropagation();
    chip.remove();
    syncTrayFromEditor();
  };

  chip.appendChild(img);
  chip.appendChild(textSpan);
  chip.appendChild(delBtn);

  richEditorRef.value.appendChild(chip);
  richEditorRef.value.appendChild(document.createTextNode(' '));
  richEditorRef.value.focus();
}

const localFileByUrl = new Map();

function mediaKind(item) {
  const kind = String(item?.kind || item?.media_type || '').toLowerCase();
  const url = String(item?.url || '');
  if (kind === 'video' || kind === 'audio' || kind === 'music') return kind === 'music' ? 'audio' : kind;
  if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) return 'video';
  if (/\.(mp3|wav|m4a|aac|flac|ogg)(\?|$)/i.test(url)) return 'audio';
  return 'image';
}

function messageAttachments(msg) {
  const refs = Array.isArray(msg?.refs) ? msg.refs.filter((item) => item && item.url) : [];
  if (refs.length) return refs;
  const images = Array.isArray(msg?.images) ? msg.images : [];
  const names = namesInPrompt(msg?.content);
  return images.filter(Boolean).map((url, index) => ({
    url,
    name: labelForRef(url, names[index]),
    kind: 'image',
    tag: `@图${index + 1}`,
  }));
}

function parseRichSegments(content, msg) {
  if (!content) return [];
  const segments = [];
  const regex = /(@(?:图|图片|视频|音频)(\d+))\[([^\]]+)\]/g;
  const refs = messageAttachments(msg || {});
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', text: content.slice(lastIdx, match.index) });
    }
    const tag = match[1];
    const num = parseInt(match[2], 10);
    const name = match[3];
    const matchedAsset = refs[num - 1] || refs.find((item) => item.name === name) || null;
    const thumb = matchedAsset && matchedAsset.url && mediaKind(matchedAsset) === 'image' && matchedAsset.url !== '/favicon.ico'
      ? matchedAsset.url
      : '';

    segments.push({
      type: 'chip',
      tag,
      name,
      thumb,
      ref: matchedAsset,
    });
    lastIdx = regex.lastIndex;
  }

  if (lastIdx < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIdx) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', text: content }];
}

function formatTokenCount(value) {
  const count = Number(value) || 0;
  if (count >= 1000000) return `${Math.round(count / 1048576)}M token`;
  if (count >= 1000) return `${Math.round(count / 1024)}k token`;
  return `${count} token`;
}

const contextTrim = computed(() => {
  const model = (studioModels.value.chat || []).find((item) => item.id === chatModelKey.value);
  const budget = contextBudgetTokens(model?.contextTokens);
  const trimmed = trimChatMessages(messages.value, budget);
  return { budget, windowTokens: model?.contextTokens || null, ...trimmed };
});
const contextNote = computed(() => {
  const info = contextTrim.value;
  const dropped = info.dropped > 0 ? `，更早 ${info.dropped} 轮已让出` : '';
  return `上下文 ${info.kept} 轮 · 上限 ${formatTokenCount(info.budget)}${dropped}`;
});
const contextNoteTitle = computed(() => {
  const info = contextTrim.value;
  const windowText = info.windowTokens
    ? `这个模型窗口 ${formatTokenCount(info.windowTokens)}。`
    : '这个模型没有标明窗口。';
  return `${windowText}单次最多带上 ${formatTokenCount(info.budget)}，避免上下文过大导致这一轮失败。`;
});

function stripScaffold(text) {
  const withoutThought = String(text || '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<thought>[\s\S]*$/gi, '');
  return withoutThought
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\d+\.\s+\*\*/.test(trimmed)) return false;
      if (/^\*\s+\*\*/.test(trimmed)) return false;
      if (/^self-correction/i.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function analysisIsUsable(text) {
  const cjk = (String(text || '').match(/[\u3400-\u9fff]/g) || []).length;
  if (cjk >= 20) return true;
  if (/identify the user|overall impression|structure the response|light source & direction/i.test(text || '')) return false;
  return cjk >= 8 && String(text || '').length >= 80;
}

function latestChatAnalysis() {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const message = messages.value[i];
    if (message.role !== 'assistant' || message.isError) continue;
    if (message.modality && message.modality !== 'chat') continue;
    const cleaned = stripScaffold(message.content);
    if (cleaned) return cleaned.slice(0, 1800);
  }
  return '';
}

function priorMedia() {
  const found = [];
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const message = messages.value[i];
    if (message.role !== 'user') continue;
    for (const ref of messageAttachments(message)) {
      if (!ref.url || found.some((item) => item.url === ref.url)) continue;
      found.push(ref);
    }
  }
  return found;
}

function carryPriorRefs(currentTray) {
  if (currentTray.length) return currentTray;
  const cap = refCap();
  if (!(cap > 0)) return currentTray;
  const pool = priorMedia().filter((item) => mediaKind(item) === (audioOnlyModel() ? 'audio' : 'image'));
  const mode = activeGenMode.value;
  if (mode === 'first_last_frame') return pool.length >= 2 ? pool.slice(0, 2) : currentTray;
  if (mode === 'image_edit' || mode === 'expand_fill') return pool.length ? pool.slice(0, 1) : currentTray;
  return pool.slice(0, cap);
}

function promptWithPriorAnalysis(rawContent, carriedCount) {
  const analysis = latestChatAnalysis();
  if (analysisIsUsable(analysis)) {
    return `${rawContent}\n\n沿用同一会话里先前的画面分析，空间、材质和光影保持一致：\n${analysis}`;
  }
  if (carriedCount > 0) {
    return `${rawContent}\n\n参考已挂载的先前对话图片，沿用它的空间、材质和光影，不要换成另一种风格。`;
  }
  return rawContent;
}

async function portableImageUrl(ref) {
  const url = String(ref?.url || '');
  if (!url || url === '/favicon.ico') return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('data:image/')) return url;
  if (!url.startsWith('blob:')) return '';
  const file = localFileByUrl.get(url);
  // 上限放宽到 12MB：服务端会 sharp 压缩，压不到 1.5MB 再走 OSS 公网兜底。
  if (!file || file.size > 12 * 1024 * 1024) return '';
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

async function portableImageUrls(refs, limit) {
  const urls = [];
  for (const ref of refs) {
    if (urls.length >= limit) break;
    if (mediaKind(ref) !== 'image') continue;
    const url = await portableImageUrl(ref);
    if (url) urls.push(url);
  }
  return urls;
}

async function portableAudioUrl(ref) {
  const url = String(ref?.url || '');
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('data:audio/')) return url;
  if (!url.startsWith('blob:')) return '';
  const file = localFileByUrl.get(url);
  if (!file || file.size > 8 * 1024 * 1024) return '';
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

async function portableAudioUrls(refs, limit) {
  const urls = [];
  for (const ref of refs) {
    if (urls.length >= limit) break;
    if (mediaKind(ref) !== 'audio') continue;
    const url = await portableAudioUrl(ref);
    if (url) urls.push(url);
  }
  return urls;
}

async function loadTemplates() {
  try {
    const res = await authFetch('/api/creation-templates');
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      templates.value = json.data;
      sortTemplates();
    }
  } catch (e) {
    console.warn('加载创作库模板失败', e);
  }
}

async function loadSessions() {
  try {
    const list = await fetchChatSessions();
    if (Array.isArray(list) && list.length > 0) {
      sessions.value = list;
      await selectSession(list[0]);
    } else {
      const defaultId = `sess_${Date.now()}`;
      const defaultSess = { id: defaultId, title: '空间美学创作会话' };
      sessions.value = [defaultSess];
      currentSessionId.value = defaultId;
      try {
        await authFetch('/api/chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: defaultId, title: defaultSess.title })
        });
      } catch (e) {}
    }
  } catch (e) {
    console.warn('加载会话列表失败:', e);
    if (!sessions.value.length) {
      await createNewSession();
    }
  }
}

async function selectSession(s) {
  if (!s || !s.id) return;
  currentSessionId.value = s.id;
  messages.value = [];
  pinned.value = true;
  hasNewBelow.value = false;
  try {
    const rawMsgs = await fetchChatMessages(s.id);
    if (Array.isArray(rawMsgs)) {
      messages.value = rawMsgs.map(m => {
        let mod = 'chat';
        if (m.mode === 'text_to_image' || (m.result && m.result.imageUrl)) mod = 'image';
        else if (m.mode === 'text_to_video' || (m.result && m.result.videoUrl)) mod = 'video';
        else if (m.mode === 'music' || (m.result && m.result.audioUrl)) mod = 'music';

        return {
          id: m.id,
          role: m.role,
          content: mod === 'chat'
            ? splitClientThinking(m.prompt || (m.result ? m.result.content : ''), m.result?.thinking || '').content
            : (m.prompt || (m.result ? m.result.content : '')),
          thinking: mod === 'chat'
            ? splitClientThinking(m.prompt || (m.result ? m.result.content : ''), m.result?.thinking || '').thinking
            : '',
          modality: mod,
          imageUrl: m.result?.imageUrl,
          videoUrl: m.result?.videoUrl,
          audioUrl: m.result?.audioUrl,
          resolution: m.result?.resolution || m.params?.resolution,
          ratio: m.result?.ratio || m.params?.ratio,
          duration: m.result?.duration,
          model: m.result?.model || m.engine,
          modelKey: m.result?.modelKey || m.params?.model,
          userPrompt: m.result?.userPrompt || (m.role === 'user' ? (m.prompt || '') : ''),
          refs: m.result?.refs || m.params?.refs || [],
          images: Array.isArray(m.images) ? m.images : [],
          isError: Boolean(m.result?.isError) || String(m.prompt || m.result?.content || '').startsWith('生成遇到问题'),
          genMode: m.result?.genMode || m.mode,
          assetFid: m.result?.assetFid || '',
          camera: m.result?.camera
        };
      });

      // 从当前会话历史用户消息中自动充实 promptHistory
      const firstUser = rawMsgs.find((m) => m.role === 'user' && m.prompt);
      if (firstUser) rememberSessionTitle(firstUser.prompt);
      rawMsgs.forEach(m => {
        if (m.role === 'user' && m.prompt) {
          const imgs = Array.isArray(m.images) ? m.images : [];
          const promptNames = namesInPrompt(m.prompt);
          const trayItems = imgs.map((u, i) => ({
            name: labelForRef(u, promptNames[i]),
            url: u,
            tag: `@图${i + 1}`,
            weight: 85,
            origin: 'upload'
          }));
          pushPromptHistory(m.prompt, trayItems);
        }
        const refs = [].concat(m.result?.refs || []).concat(m.params?.refs || []);
        const urls = Array.isArray(m.images) ? m.images : [];
        rememberSessionRefs(refs, m.role === 'assistant' ? 'generated' : 'upload');
        rememberSessionRefs(urls.map((url, i) => ({ url, name: labelForRef(url, namesInPrompt(m.prompt)[i]), tag: `@图${i + 1}` })), 'upload');
        if (m.role === 'assistant' && m.result?.imageUrl) {
          rememberSessionRefs([{ url: m.result.imageUrl, name: labelForRef(m.result.imageUrl, ''), fid: m.result.assetFid || '' }], 'generated');
        }
      });
    }
  } catch (e) {
    console.warn('加载会话消息失败:', e);
  }
  scrollToBottom();
}

async function createNewSession() {
  const newId = `sess_${Date.now()}`;
  const newSess = { id: newId, title: '新创作会话' };
  sessions.value.unshift(newSess);
  currentSessionId.value = newId;
  messages.value = [];
  try {
    await authFetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: newId, title: '新创作会话' })
    });
  } catch (e) {}
}

async function deleteSession(id) {
  sessions.value = sessions.value.filter(s => s.id !== id);
  try {
    await deleteChatSession(id);
  } catch (e) {}
  if (currentSessionId.value === id) {
    if (sessions.value.length > 0) {
      await selectSession(sessions.value[0]);
    } else {
      await createNewSession();
    }
  }
}

function openAddTemplateModal() {
  const prompt = getRawEditorText();
  let defaultType = 'image';
  if (activeModality.value === 'video') defaultType = 'video';
  else if (activeModality.value === 'music') defaultType = 'audio';

  saveModal.value = {
    visible: true,
    title: '自定义空间美学配方',
    prompt,
    type: defaultType,
    space: detectSpaceFromText(prompt) || '客厅',
    style: detectStyleFromText(prompt) || '意式极简',
    is_pinned: false,
    msg: null
  };
}

function openTemplateDetail(tpl) {
  detailModal.value = { visible: true, tpl };
}

function applyTemplate(tpl) {
  if (!tpl) return;
  // 异步统计使用频次并浮动
  authFetch(`/api/creation-templates/${encodeURIComponent(tpl.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'use' })
  }).then(r => r.json()).then(j => {
    if (j.success) {
      tpl.use_count = (tpl.use_count || 0) + 1;
      tpl.updated_at = j.data?.updated_at || Date.now();
      sortTemplates();
    }
  }).catch(() => {});

  const params = tpl.params || {};
  const refs = Array.isArray(tpl.origin_images) ? tpl.origin_images : [];
  const prepared = refs.map((item, i) => ({
    name: labelForRef(item.url, item.name || item.file_name),
    url: item.url,
    fid: item.fid,
    kind: item.kind,
    weight: item.weight || 85,
    tag: item.tag || `@图${i + 1}`,
    origin: 'upload',
    resolved: !!item.url
  }));
  const mode = params.genMode || params.mode || (tpl.type === 'video' ? 'video' : (tpl.type === 'audio' ? 'music' : 'image'));
  const modelKey = params.modelKey || params.model;
  const modality = ['image', 'video', 'music', 'chat'].includes(mode) ? mode : '';
  suppressSchemaReset = true;
  if (recipeIsLegacy(tpl)) {
    activeModality.value = 'image';
    imageModelKey.value = 'agnes_image_2_5_flash';
    oldRecipeNote.value = true;
  } else {
    oldRecipeNote.value = false;
    if (modality) activeModality.value = modality;
    if (modelKey) {
      if (activeModality.value === 'image') imageModelKey.value = modelKey;
      else if (activeModality.value === 'video') videoModelKey.value = modelKey;
      else if (activeModality.value === 'music') musicType.value = modelKey;
      else chatModelKey.value = modelKey;
    }
  }
  suppressSchemaReset = false;
  resetSchemaForModel();
  if (params.schemaMode) setGenMode(params.schemaMode);
  if (params.schemaParams && typeof params.schemaParams === 'object') {
    const schema = currentSchema.value;
    const incoming = {};
    for (const [key, value] of Object.entries(params.schemaParams)) {
      if (fieldByKey(schema, key)) incoming[key] = value;
    }
    schemaParams.value = clampParamsToSchema(schema, { ...schemaParams.value, ...incoming });
    applyModeLocks();
  }
  if (params.ratio) selectedRatio.value = params.ratio;
  else if (tpl.aspect_ratio) selectedRatio.value = tpl.aspect_ratio;
  if (params.resolution) selectedResolution.value = params.resolution;
  restorePromptContent(tpl.prompt || '', prepared);
  syncTrayFromEditor();
  rememberSessionRefs(referenceTray.value, 'upload');
  detailModal.value.visible = false;
  showExpandedLibrary.value = false;
}

function applyTemplateFromDetail() {
  applyTemplate(detailModal.value.tpl);
}

function selectHashTemplate(tpl) {
  showHashMenu.value = false;
  // 记录复用次数并浮动
  authFetch(`/api/creation-templates/${encodeURIComponent(tpl.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'use' })
  }).then(r => r.json()).then(j => {
    if (j.success) {
      tpl.use_count = (tpl.use_count || 0) + 1;
      tpl.updated_at = j.data?.updated_at || Date.now();
      sortTemplates();
    }
  }).catch(() => {});

  if (!richEditorRef.value) return;
  const last = richEditorRef.value.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) last.nodeValue = String(last.nodeValue || '').replace(/#\s*$/, '');
  appendRichSegmentText(' ' + (tpl.prompt || ''));
  const origins = (Array.isArray(tpl.origin_images) ? tpl.origin_images : []).map((item, index) => ({
    name: item.name || item.file_name || '',
    url: item.url || '',
    fid: item.fid || '',
    kind: item.kind || 'image',
    tag: `@图${index + 1}`,
    origin: 'upload'
  })).filter((item) => item.url);
  reparseEditorChips(origins);
}

function openAssetSelectorModal() {
  showAssetSelector.value = true;
}

// 共享素材选择器确认：把选中的「原图 / 衍生图」版本挂载为 @引用
function onAssetPickerConfirm(versions) {
  for (const version of versions || []) {
    if (!version?.url) continue;
    const idx = referenceTray.value.length + 1;
    const asset = {
      name: version.derivativeKind ? `${version.name || '素材资产'}（${version.label || '衍生图'}）` : (version.name || '素材资产'),
      url: version.url,
      weight: 85,
      tag: `@图${idx}`,
      fid: version.fid,
      kind: version.kind || 'image',
      derivativeId: version.derivativeId || '',
      derivativeKind: version.derivativeKind || ''
    };
    referenceTray.value.push(asset);
    rememberSessionRefs([asset]);
    insertChipToEditor(asset);
  }
  showAssetSelector.value = false;
}

function onAssetPickerUpload(file) {
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, '');
  const url = URL.createObjectURL(file);
  localFileByUrl.set(url, file);
  const idx = referenceTray.value.length + 1;
  const asset = { name, url, weight: 85, tag: `@图${idx}`, kind: file.type.startsWith('video/') ? 'video' : (file.type.startsWith('audio/') ? 'audio' : 'image') };
  referenceTray.value.push(asset);
  insertChipToEditor(asset);
  showAssetSelector.value = false;
}

// 媒体大图与视频播放预览灯箱
function openMediaPreview(itemOrUrl, defaultType = 'image') {
  let url = '';
  let type = defaultType;
  let title = '媒体高清预览';
  if (typeof itemOrUrl === 'string') {
    url = itemOrUrl;
    if (/\.(mp4|mov|webm)$/i.test(url)) type = 'video';
    else if (/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(url)) type = 'audio';
  } else if (itemOrUrl && typeof itemOrUrl === 'object') {
    url = itemOrUrl.url || itemOrUrl.imageUrl || itemOrUrl.videoUrl || itemOrUrl.audioUrl || '';
    title = itemOrUrl.name || itemOrUrl.file_name || itemOrUrl.title || '素材预览';
    const kind = mediaKind(itemOrUrl);
    if (kind === 'video' || kind === 'audio') type = kind;
  }
  if (!url) return;
  previewModal.value = {
    visible: true,
    url,
    type,
    title,
    scale: 1.0
  };
}

function closeMediaPreview() {
  previewModal.value.visible = false;
}

function zoomPreview(delta) {
  previewModal.value.scale = Math.max(0.5, Math.min(4.0, previewModal.value.scale + delta));
}

function dropMentionNumber(removed) {
  if (!richEditorRef.value || !(removed > 0)) return;
  const mention = (n) => new RegExp(`@(图片|视频|音频|图)${n}(?!\\d)(?:\\[([^\\]]*)\\])?`, 'g');
  const picture = (n) => new RegExp(`<(Picture|Audio|Video)\\s+${n}\\s*>`, 'gi');
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      let out = String(node.nodeValue || '').replace(picture(removed), '').replace(mention(removed), '');
      for (let n = removed + 1; n <= 12; n += 1) {
        const next = n - 1;
        out = out.replace(picture(n), (_, kind) => `<${kind} ${next}>`);
        out = out.replace(mention(n), (_, kind, name) => `@${kind}${next}${name != null ? `[${name}]` : ''}`);
      }
      node.nodeValue = out;
    } else if (node.nodeType === Node.ELEMENT_NODE && !(node.classList && node.classList.contains('inline-asset-chip'))) {
      [...node.childNodes].forEach(walk);
    }
  };
  [...richEditorRef.value.childNodes].forEach(walk);
}

function removeRef(idx) {
  const item = referenceTray.value[idx];
  if (!item) return;
  const url = item.url || '';
  if (richEditorRef.value && url) {
    [...richEditorRef.value.querySelectorAll('.inline-asset-chip')].forEach((chip) => {
      if ((chip.getAttribute('data-url') || '') === url) chip.remove();
    });
  }
  dropMentionNumber(idx + 1);
  const chipsLeft = richEditorRef.value && richEditorRef.value.querySelector('.inline-asset-chip[data-resolved="1"]');
  if (chipsLeft) {
    syncTrayFromEditor();
    return;
  }
  const next = referenceTray.value.slice();
  next.splice(idx, 1);
  next.forEach((entry, i) => { entry.tag = `@图${i + 1}`; });
  referenceTray.value = next;
}

// 优化提示词
async function optimizePrompt() {
  syncTrayFromEditor();
  const rawText = getRawEditorText();
  if (!rawText || activeModality.value === 'chat') return;
  const traySnapshot = JSON.parse(JSON.stringify(referenceTray.value));
  optimizing.value = true;
  composerError.value = '';
  try {
    const tray = traySnapshot.length ? traySnapshot : carryPriorRefs([]);
    const imageUrls = await portableImageUrls(tray, refCap() || tray.length || 1);
    const res = await authFetch('/api/chat/optimize-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: rawText,
        modelId: activeModality.value === 'image' ? imageModelKey.value : (activeModality.value === 'video' ? videoModelKey.value : musicType.value),
        mode: activeGenMode.value || (activeModality.value === 'video' ? 'text_to_video' : 'text_to_image'),
        imageUrls
      })
    });
    const json = await res.json();
    const resultText = json.optimized || json.data?.optimized;
    if (!res.ok || json.error) throw new Error(json.error || '提示词优化失败');
    if (resultText && richEditorRef.value) {
      optimizeUndo.value = { text: rawText, tray: traySnapshot };
      restorePromptContent(withKeptRefMentions(resultText, tray), tray);
    }
  } catch (e) {
    composerError.value = e.message || '提示词优化失败';
  } finally {
    optimizing.value = false;
  }
}

function undoOptimize() {
  const saved = optimizeUndo.value;
  if (!saved || optimizing.value) return;
  optimizeUndo.value = null;
  restorePromptContent(saved.text, saved.tray);
}

function getModelDisplayName(key) {
  const map = {
    volc_doubao_seed_2_1_pro: 'Doubao-Seed-2.1-pro (火山方舟)',
    volc_doubao_seed_2_1_turbo: 'Doubao-Seed-2.1-turbo',
    volc_doubao_seed_2_1_lite: 'Doubao-Seed-2.1-lite',
    gemini_flash_latest: 'Gemini Flash',
    gemini_flash_lite_latest: 'Gemini Flash-Lite',
    agnes3_0flash: 'Agnes 3.0 Flash',
    litellm_doubao_seed_2_1_pro: 'Doubao-Seed-2.1-pro (LiteLLM)',
    seedream5flash: 'Seedream 5.0 Flash',
    seedream5pro: 'Seedream 5.0 Pro',
    seedream5lite: 'Seedream 5.0 Lite',
    agnes_image_2_5_flash: 'Agnes Image 2.5 Flash',
    qwenimage_local: 'Qwen-Image 2.1',
    acestep_local: 'ACE-Step 1.5',
    indextts_local: 'IndexTTS 2.5',
    modelscope_image: 'ModelScope 异步生图',
    gemini_image: 'Google Nano Banana',
    seedance2_5: 'Seedance 2.5',
    seedance2_0: 'Seedance 2.0',
    agnes_video_2_5_flash: 'Agnes Video 2.5 Flash',
    gemini_veo: 'Google Veo 3.1',
    modelscope_video: 'ModelScope 视频',
    doubao_bgm_v5: '豆包纯音乐 v5',
    doubao_song_v5: '豆包歌曲 v5',
    gemini_lyria: 'Google Lyria 3.5'
  };
  if (map[key]) return map[key];
  const all = [
    ...(studioModels.value.chat || []),
    ...(studioModels.value.image || []),
    ...(studioModels.value.video || []),
    ...(studioModels.value.music || [])
  ];
  const found = all.find(m => m.id === key || m.model_code === key);
  return found ? (found.name || key) : key;
}

// 发送消息
async function sendMessage() {
  syncTrayFromEditor();
  const rawContent = getRawEditorText();
  if (!rawContent || generating.value) return;

  const currentMod = activeModality.value;
  const typedTray = JSON.parse(JSON.stringify(referenceTray.value));
  let currentTray = typedTray;
  if (currentMod !== 'chat' && currentTray.length === 0) {
    currentTray = carryPriorRefs(currentTray);
  }
  const usedPriorMedia = typedTray.length === 0 && currentTray.length > 0;
  if (currentMod !== 'chat') {
    const refError = modeRefError(currentTray);
    if (refError) {
      composerError.value = refError;
      return;
    }
  }
  composerError.value = '';
  const retryModel = currentMod === 'chat' ? chatModelKey.value : (currentMod === 'image' ? imageModelKey.value : (currentMod === 'video' ? videoModelKey.value : musicType.value));
  const retryParams = declaredParams();
  const retryMode = activeGenMode.value;

  // 记录提示词与附带的参考图历史（支持键盘上下键自动召回）
  pushPromptHistory(rawContent, currentTray);

  if (!currentSessionId.value) {
    await createNewSession();
  }
  rememberSessionTitle(rawContent);

  messages.value.push({
    role: 'user',
    content: rawContent,
    modality: currentMod,
    refs: currentTray,
    images: currentTray.map((item) => item.url)
  });
  rememberSessionRefs(currentTray, 'upload');
  scrollToBottom();

  if (richEditorRef.value) {
    richEditorRef.value.innerHTML = '';
  }
  referenceTray.value = [];
  optimizeUndo.value = null;
  generating.value = true;

  // 保存用户消息至数据库
  try {
    await saveChatMessage({
      sessionId: currentSessionId.value,
      role: 'user',
      mode: currentMod === 'video' ? 'text_to_video' : (currentMod === 'image' ? 'text_to_image' : (currentMod === 'music' ? 'music' : 'chat')),
      prompt: rawContent,
      images: currentTray.map(r => r.url),
      params: {
        resolution: selectedResolution.value,
        ratio: selectedRatio.value,
        model: retryModel,
        refs: currentTray,
        genMode: currentMod,
        schemaMode: retryMode,
        schemaParams: retryParams
      }
    });
  } catch (e) {
    console.warn('保存用户消息失败:', e);
  }

  try {
    if (currentMod === 'chat') {
      const chatModel = (studioModels.value.chat || []).find((item) => item.id === chatModelKey.value);
      const historyContext = trimChatMessages(messages.value, contextBudgetTokens(chatModel?.contextTokens)).messages;
      const imageLimit = Math.max(0, Number(chatModel?.input?.images ?? 2));
      const visionRefs = [];
      const seenRefUrls = new Set();
      if (imageLimit > 0) {
        for (let i = messages.value.length - 1; i >= 0 && visionRefs.length < imageLimit; i--) {
          if (messages.value[i].role !== 'user') continue;
          for (const ref of messageAttachments(messages.value[i])) {
            if (visionRefs.length >= imageLimit) break;
            const url = String(ref?.url || '');
            if (!url || seenRefUrls.has(url)) continue;
            seenRefUrls.add(url);
            visionRefs.push(ref);
          }
        }
      }
      const images = await portableImageUrls(visionRefs, imageLimit);

      const reasoningCaps = chatReasoningCaps.value;
      const reasoningParam = reasoningCaps && reasoningCaps.supported && reasoningCaps.mode === 'levels'
        ? { reasoning_effort: thinkingStrength.value }
        : {};
      const res = await generateAiChat({
        model: chatModelKey.value,
        messages: historyContext,
        prompt: rawContent,
        images,
        ...reasoningParam
      });

      const warnings = [];
      if (res.substituted) {
        const served = res.served_model ? getModelDisplayName(res.served_model) : '其他模型';
        warnings.push(`请求的是 ${getModelDisplayName(chatModelKey.value)}，网关实际由 ${served} 回答。`);
      }
      const appliedLevel = res.applied_reasoning?.reasoning_effort || '';
      if (appliedLevel && reasoningCaps?.supported && appliedLevel !== thinkingStrength.value) {
        warnings.push(`思考档位「${thinkingLevelLabel(thinkingStrength.value)}」不受该模型支持，已按「${thinkingLevelLabel(appliedLevel)}」执行。`);
      }
      if (res.truncated || res.finish_reason === 'length') {
        warnings.push('回答达到长度上限被截断，请重试或让问题更聚焦。');
      }
      for (const note of (res.image_notes || [])) {
        if (note.delivery === 'dropped') warnings.push(`图片未送达模型：${note.reason || '未知原因'}`);
        else if (note.warning) warnings.push(note.warning);
      }

      const rawReply = res.choices?.[0]?.message?.content || res.reply || res.text || res.data?.reply || '已完成空间需求分析。';
      const split = splitClientThinking(rawReply, res.reasoning || res.choices?.[0]?.message?.reasoning_content || '');
      const replyText = split.content;
      const asstMsg = {
        role: 'assistant',
        modality: 'chat',
        content: replyText,
        thinking: split.thinking,
        model: getModelDisplayName(chatModelKey.value),
        servedModel: res.served_model || null,
        reasoningLevel: appliedLevel || null,
        warning: warnings.length ? warnings.join('；') : ''
      };
      messages.value.push(asstMsg);

      await saveChatMessage({
        sessionId: currentSessionId.value,
        role: 'assistant',
        mode: 'chat',
        prompt: replyText,
        engine: chatModelKey.value,
        result: asstMsg
      });
    } else if (currentMod === 'image') {
      const imageUrls = await portableImageUrls(currentTray, currentTray.length || 1);
      const promptForModel = promptWithPriorAnalysis(rawContent, usedPriorMedia ? currentTray.length : 0);
      // 尺寸/画幅以契约参数条为准（Qwen 本地默认 1K：2K 生成慢 2~3 倍，不再用写死的 2K 兜底）
      const submitImageSize = retryParams.size || retryParams.resolution || schemaParams.value.size || selectedResolution.value;
      const submitImageRatio = retryParams.ratio || schemaParams.value.ratio || selectedRatio.value;
      const res = await generateAiImage({
        prompt: promptForModel,
        model: imageModelKey.value,
        size: submitImageSize,
        ratio: submitImageRatio,
        imageUrls,
        genMode: retryMode,
        extras: retryParams,
        snippetIds: activeSnippetIds()
      });

      const genUrl = res.files?.[0]?.previewUrl || res.files?.[0]?.url || res.imageUrl || res.url || res.data?.imageUrl || (res.files?.[0]?.localPath ? `/api/cache/temp/${res.files[0].localPath.split('/').pop()}` : '');
      if (!genUrl) {
        throw new Error(res.error || '未获取到生成的图片地址');
      }

      const layerStack = normalizeClientLayerStack(res, retryParams);
      const imageElapsedSec = Math.round((res.elapsedMs || 0) / 1000);
      const asstMsg = {
        role: 'assistant',
        modality: 'image',
        content: layerStack && layerStack.layers.length > 1
          ? `已完成 Seedream 5.0 多图层拆分生成（共 ${layerStack.layers.length} 个独立图层），可直接在上方切换查看或单层二次引用。`
          : `已为您完成空间视效生成。家具材质光泽与参考项深度统一，光影自然，画质达到 ${submitImageSize}。`,
        userPrompt: rawContent,
        refs: currentTray,
        imageUrl: genUrl,
        layerStack,
        duration: imageElapsedSec > 0 ? `${imageElapsedSec}s` : (res.duration ? `${res.duration}s` : ''),
        resolution: submitImageSize,
        ratio: submitImageRatio,
        model: getModelDisplayName(imageModelKey.value),
        modelKey: imageModelKey.value,
        genMode: 'image'
      };
      try {
        const filed = await registerGeneratedAsset({
          previewUrl: genUrl,
          parentFid: currentTray.find((item) => item.fid)?.fid || '',
          refFids: currentTray.map((item) => item.fid).filter(Boolean).slice(1),
          prompt: rawContent,
          model: imageModelKey.value,
          mode: 'image',
          ratio: submitImageRatio,
          resolution: submitImageSize,
          sessionId: currentSessionId.value
        });
        asstMsg.assetFid = filed.fid;
      } catch (fileErr) {
        console.warn('写入精修素材失败', fileErr);
      }
      rememberSessionRefs([{ url: genUrl, name: labelForRef(genUrl, ''), fid: asstMsg.assetFid || '' }], 'generated');
      messages.value.push(asstMsg);

      await saveChatMessage({
        sessionId: currentSessionId.value,
        role: 'assistant',
        mode: 'text_to_image',
        prompt: asstMsg.content,
        engine: imageModelKey.value,
        result: asstMsg
      });
    } else if (currentMod === 'video') {
      const imageUrls = await portableImageUrls(currentTray, currentTray.length || 1);
      const promptForModel = promptWithPriorAnalysis(rawContent, usedPriorMedia ? currentTray.length : 0);
      // 时长/画幅一律以契约参数条为准（已经过夹取），杜绝旧 videoDuration=60 这类游离默认值
      const submitDuration = retryParams.duration != null && retryParams.duration !== ''
        ? retryParams.duration
        : schemaParams.value.duration != null ? schemaParams.value.duration : videoDuration.value;
      const submitRatio = retryParams.ratio || schemaParams.value.ratio || selectedRatio.value;
      const submitSize = retryParams.resolution || retryParams.size || schemaParams.value.size || videoResolution.value;
      const res = await generateAiVideo({
        prompt: promptForModel,
        model: videoModelKey.value,
        duration: submitDuration,
        resolution: submitSize,
        ratio: submitRatio,
        camera: videoCameraMove.value,
        imageUrls,
        genMode: retryMode,
        extras: retryParams,
        snippetIds: activeSnippetIds(),
        firstFrame: retryMode === 'first_last_frame' ? imageUrls[0] : undefined,
        lastFrame: retryMode === 'first_last_frame' ? imageUrls[1] : undefined
      });

      const genVideoUrl = res.files?.[0]?.previewUrl || res.files?.[0]?.url || res.videoUrl || res.url || res.data?.videoUrl || '';
      if (!genVideoUrl) throw new Error(res.error || '未获取到生成的视频地址');
      const asstMsg = {
        role: 'assistant',
        modality: 'video',
        content: `影视级空间动态渲染已就绪。运镜平滑连续，空间光影与环境音效自然契合。`,
        videoUrl: genVideoUrl,
        duration: `${submitDuration === '-1' ? '8' : submitDuration}s`,
        resolution: submitSize,
        ratio: submitRatio,
        model: getModelDisplayName(videoModelKey.value),
        camera: videoCameraMove.value
      };
      try {
        const filed = await registerGeneratedAsset({
          previewUrl: genVideoUrl,
          parentFid: currentTray.find((item) => item.fid)?.fid || '',
          refFids: currentTray.map((item) => item.fid).filter(Boolean).slice(1),
          prompt: rawContent,
          model: videoModelKey.value,
          mode: 'video',
          ratio: submitRatio,
          resolution: submitSize,
          sessionId: currentSessionId.value
        });
        asstMsg.assetFid = filed.fid;
      } catch (fileErr) {
        // 入库失败不阻断消息展示：视频仍可播放、可下载
        console.warn('写入精修素材失败', fileErr);
      }
      messages.value.push(asstMsg);

      await saveChatMessage({
        sessionId: currentSessionId.value,
        role: 'assistant',
        mode: 'text_to_video',
        prompt: asstMsg.content,
        engine: videoModelKey.value,
        result: asstMsg
      });
    } else {
      const audioUrls = await portableAudioUrls(currentTray, refCap() || currentTray.length || 1);
      const res = await generateAiAudio({
        prompt: rawContent,
        model: musicType.value,
        duration: retryParams.audio_duration || retryParams.duration || Number(musicDuration.value) || 30,
        genMode: retryMode,
        audioUrls,
        extras: retryParams,
        snippetIds: activeSnippetIds()
      });
      const genAudioUrl = res.files?.[0]?.previewUrl || res.files?.[0]?.url || res.audioUrl || '';
      if (!genAudioUrl) throw new Error(res.error || '未获取到生成的音频地址');
      const asstMsg = {
        role: 'assistant',
        modality: 'music',
        content: res.files?.length > 1
          ? `音频已生成，共 ${res.files.length} 条。下面先播放第一条。`
          : '音频已生成。',
        audioTitle: getModelDisplayName(musicType.value),
        duration: `${retryParams.audio_duration || retryParams.duration || musicDuration.value}s`,
        audioUrl: genAudioUrl,
        model: getModelDisplayName(musicType.value)
      };
      if (genAudioUrl.includes('/api/cache/temp/')) {
        try {
          const filed = await registerGeneratedAsset({
            previewUrl: genAudioUrl,
            parentFid: currentTray.find((item) => item.fid)?.fid || '',
            refFids: currentTray.map((item) => item.fid).filter(Boolean).slice(1),
            prompt: rawContent,
            model: musicType.value,
            mode: 'music',
            sessionId: currentSessionId.value
          });
          // 多产物时只登记第一条：当前播放器也只播第一条，其余暂不入库
          asstMsg.assetFid = filed.fid;
        } catch (fileErr) {
          console.warn('写入精修素材失败', fileErr);
        }
      } else {
        // 后端已持久化（如 doubao_bgm_v5）：直接复用已入库 fid，无需重复登记
        const firstFile = res.files?.[0] || {};
        const assetFid = firstFile.fid || genAudioUrl.match(/\/api\/assets\/([^/?#]+)\//)?.[1] || '';
        if (assetFid) {
          asstMsg.assetFid = assetFid;
          try {
            // 后端入库默认落在 original，这里移入精修货架
            await moveAssetShelf(assetFid, 'retouched');
          } catch (shelfErr) {
            console.warn('移入精修货架失败', shelfErr);
          }
        }
      }
      messages.value.push(asstMsg);

      await saveChatMessage({
        sessionId: currentSessionId.value,
        role: 'assistant',
        mode: 'music',
        prompt: asstMsg.content,
        engine: musicType.value,
        result: asstMsg
      });
    }
  } catch (err) {
    console.error('AI 生成调用失败:', err);
    const errMsg = {
      role: 'assistant',
      modality: currentMod,
      content: `生成遇到问题：${err.message || '请检查服务端模型配置或网络连接'}`,
      model: '系统提示',
      isError: true,
      retryPrompt: rawContent,
      retryRefs: currentTray,
      retryModel,
      retryModality: currentMod,
      retryMode,
      retryParams
    };
    messages.value.push(errMsg);
    // 失败后把提示词与参考图恢复到输入区，用户可直接改参数重发，也避免「图槽 0/N」与实际附件不一致
    try {
      restorePromptContent(rawContent, currentTray);
      syncTrayFromEditor();
    } catch (restoreErr) {
      console.warn('恢复失败输入失败:', restoreErr);
    }
    try {
      await saveChatMessage({
        sessionId: currentSessionId.value,
        role: 'assistant',
        mode: currentMod === 'image' ? 'text_to_image' : currentMod,
        prompt: errMsg.content,
        result: errMsg
      });
    } catch (saveErr) {
      console.warn('保存失败提示失败:', saveErr);
    }
  } finally {
    generating.value = false;
    scrollToBottom();
  }
}

const SESSION_TITLE_PLACEHOLDERS = ['新创作会话', '空间美学创作会话', 'AI 创作会话', ''];

function rememberSessionTitle(text) {
  const title = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!title || !currentSessionId.value) return;
  const hit = sessions.value.find((s) => s.id === currentSessionId.value);
  if (!hit) {
    sessions.value.unshift({ id: currentSessionId.value, title });
  } else if (SESSION_TITLE_PLACEHOLDERS.includes(hit.title || '')) {
    hit.title = title;
  } else {
    return;
  }
  authFetch('/api/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: currentSessionId.value, title })
  }).catch(() => {});
}

function fillComposerFromError(msg) {
  const prompt = msg.retryPrompt || sourcePromptFor(msg);
  const refs = Array.isArray(msg.retryRefs) ? msg.retryRefs : [];
  suppressSchemaReset = true;
  if (msg.retryModality) activeModality.value = msg.retryModality;
  if (msg.retryModel) {
    if (msg.retryModality === 'image') imageModelKey.value = msg.retryModel;
    else if (msg.retryModality === 'video') videoModelKey.value = msg.retryModel;
    else if (msg.retryModality === 'music') musicType.value = msg.retryModel;
  }
  suppressSchemaReset = false;
  resetSchemaForModel();
  if (msg.retryMode) setGenMode(msg.retryMode);
  if (msg.retryParams) schemaParams.value = clampParamsToSchema(currentSchema.value, { ...schemaParams.value, ...msg.retryParams });
  restorePromptContent(prompt, refs);
  syncTrayFromEditor();
}
// 把历史/重试/技能注入的参数夹取到当前契约：枚举非法回落默认、数值越界夹取到 [min,max]
function clampParamsToSchema(schema, params) {
  if (!schema) return params;
  const fields = [...(schema.common || []), ...(schema.advanced || [])];
  const out = { ...params };
  for (const field of fields) {
    if (!(field.key in out) || out[field.key] === '' || out[field.key] == null) continue;
    if (field.type === 'enum') {
      const opts = (field.options || []).map(String);
      if (!opts.includes(String(out[field.key]))) out[field.key] = field.default != null ? field.default : opts[0];
    } else if (['number', 'range', 'duration'].includes(field.type)) {
      const step = Number(field.step) > 0 ? Number(field.step) : 1;
      let n = Number(out[field.key]);
      if (!Number.isFinite(n)) { n = field.default != null ? Number(field.default) : Number(field.min ?? 0); }
      if (n === -1 && Array.isArray(field.extraStops) && field.extraStops.includes(-1)) continue;
      n = Math.min(Number(field.max), Math.max(Number(field.min), n));
      n = Math.round(n / step) * step;
      if (Number.isInteger(step)) n = Math.round(n);
      out[field.key] = n;
    }
  }
  return out;
}
// 把后端技术性错误信息转成用户可读的一句话 + 可操作建议
function friendlyErrorText(raw) {
  const text = String(raw || '').replace(/^生成遇到问题[:：]\s*/, '').trim();
  if (!text) return '请检查服务端模型配置或网络连接后重试。';
  // 去掉内部模型前缀 [Agnes Video ...] / [Agnes Video keyframe]
  return text.replace(/^\[[^\]]+\]\s*/, '');
}
function errorHint(raw) {
  const text = String(raw || '');
  if (/BFF_PUBLIC_BASE|公网/.test(text)) {
    return '需要在「设置 → 运行时配置」里把 BFF_PUBLIC_BASE 填成可公网 HTTPS 访问的地址；或先切换到文生视频。';
  }
  if (/首帧|尾帧|keyframe/.test(text)) {
    return '首尾帧模式至少上传 1 张图片：第 1 张为首帧，第 2 张为尾帧。也可以切换到「文生视频」。';
  }
  if (/时长/.test(text)) {
    return '在上方参数条把「时长」调整到模型允许的范围即可。';
  }
  if (/画幅|aspect|ratio/i.test(text)) {
    return '在上方参数条把「画幅」切换为下拉中支持的比例。';
  }
  if (/data URL|blob|无法读取/.test(text)) {
    return '图片在浏览器里已失效，请删除附件后重新选择或上传。';
  }
  return '';
}
function openRetry(msg) {
  retryDialog.value = { visible: true, msg };
}
function editFromError(msg) {
  fillComposerFromError(msg);
}
function editFromRetryDialog() {
  const msg = retryDialog.value.msg;
  retryDialog.value = { visible: false, msg: null };
  if (msg) fillComposerFromError(msg);
}
async function confirmDirectRetry() {
  const msg = retryDialog.value.msg;
  retryDialog.value = { visible: false, msg: null };
  if (!msg) return;
  fillComposerFromError(msg);
  retryNotice.value = true;
  await sendMessage();
}
function sourcePromptFor(msg) {
  if (msg?.userPrompt) return msg.userPrompt;
  const idx = messages.value.indexOf(msg);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const prev = messages.value[i];
    if (prev?.role === 'user' && prev.content) return prev.content;
  }
  return msg?.role === 'user' ? (msg.content || '') : '';
}

function openSaveToLibraryModal(msg) {
  const prompt = sourcePromptFor(msg);
  let detectedType = 'image';
  if (msg?.videoUrl || msg?.modality === 'video') detectedType = 'video';
  else if (msg?.audioUrl || msg?.modality === 'music') detectedType = 'audio';
  else if (activeModality.value === 'video') detectedType = 'video';
  else if (activeModality.value === 'music') detectedType = 'audio';

  saveModal.value = {
    visible: true,
    title: prompt.replace(/\s+/g, ' ').trim().slice(0, 24) || '未命名创作',
    prompt,
    type: detectedType,
    space: detectSpaceFromText(prompt),
    style: detectStyleFromText(prompt),
    is_pinned: false,
    msg
  };
}

async function submitSaveToLibrary() {
  if (!saveModal.value.title.trim()) return;
  savingTpl.value = true;
  try {
    const isAudio = saveModal.value.type === 'audio' || saveModal.value.msg?.audioUrl;
    const isVideo = saveModal.value.type === 'video' || saveModal.value.msg?.videoUrl;
    const res = await authFetch('/api/creation-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: saveModal.value.title,
        prompt: saveModal.value.prompt,
        type: saveModal.value.type || 'image',
        space: saveModal.value.space || '',
        style: saveModal.value.style || '',
        is_pinned: saveModal.value.is_pinned ? 1 : 0,
        aspect_ratio: saveModal.value.msg?.ratio || selectedRatio.value,
        origin_images: saveModal.value.msg?.refs || referenceTray.value,
        result_images: isAudio ? [{
          url: saveModal.value.msg?.audioUrl || '',
          resolution: saveModal.value.msg?.duration || '音频产物'
        }] : [{
          url: saveModal.value.msg?.imageUrl || saveModal.value.msg?.videoUrl || '',
          resolution: saveModal.value.msg?.resolution || selectedResolution.value
        }],
        params: {
          model: saveModal.value.msg?.model,
          modelKey: saveModal.value.msg?.modelKey,
          genMode: saveModal.value.type === 'audio' ? 'music' : (saveModal.value.type === 'video' ? 'video' : 'image'),
          mode: saveModal.value.type === 'audio' ? 'music' : (saveModal.value.type === 'video' ? 'video' : 'image'),
          ratio: saveModal.value.msg?.ratio || selectedRatio.value,
          resolution: saveModal.value.msg?.resolution || selectedResolution.value
        },
        tags: [saveModal.value.type, saveModal.value.space, saveModal.value.style, '收藏配方'].filter(Boolean)
      })
    });
    const json = await res.json();
    if (json.success) {
      saveModal.value.visible = false;
      await loadTemplates();
      alert('已成功存入我的创作库！您可以在左侧创作库中查看或在输入框输入 # 快速复用。');
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  } finally {
    savingTpl.value = false;
  }
}

async function deleteTemplate(id) {
  if (!confirm('确定删除此创作配方吗？')) return;
  try {
    const res = await authFetch(`/api/creation-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      detailModal.value.visible = false;
      templates.value = templates.value.filter(t => t.id !== id);
    }
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

function triggerPrecisionEdit(msg) {
  emit('sendToPrecisionEdit', msg.imageUrl);
}

function sendVideoToClip(msg) {
  // 剪辑桥接只认 {fid, file_name, mime, duration}；直接把消息对象丢过去会因缺 fid 被静默丢弃
  if (msg.assetFid) {
    emit('sendToClip', {
      fid: msg.assetFid,
      file_name: `AI视频_${Date.now()}.mp4`,
      mime: 'video/mp4',
      duration: parseFloat(String(msg.duration || '')) || 0,
      derivativeId: ''
    });
    return;
  }
  alert('该视频尚未完成入库，请稍后重试或先下载 MP4 手动导入');
}

function captureFrameFromVideo(msg) {
  const idx = messages.value.indexOf(msg);
  const videoEl = idx >= 0 ? videoPlayers[idx] : null;
  if (!videoEl || !videoEl.videoWidth) {
    alert('视频尚未加载完成，请先播放或等待加载后再截帧');
    return;
  }
  const cap = refCap();
  if (cap != null && referenceTray.value.length >= cap) {
    alert(`当前模式最多挂载 ${cap} 张参考图`);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const asset = {
    name: `截帧_${Date.now()}.jpg`,
    url: dataUrl,
    weight: 85,
    tag: `@图${referenceTray.value.length + 1}`,
    kind: 'image',
    origin: 'video_frame'
  };
  referenceTray.value.push(asset);
  insertChipToEditor(asset);
}

const videoPlayers = {};
function registerVideoEl(idx, el) {
  if (el) videoPlayers[idx] = el;
}
</script>

<style scoped>
.rich-prompt-editor:empty:before {
  content: attr(data-placeholder);
  color: var(--theme-text-muted);
  pointer-events: none;
}

:deep(.inline-asset-chip) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  background-color: var(--theme-chip-bg);
  border: 1px solid var(--theme-chip-border);
  color: var(--theme-chip-text);
  padding: 1px 7px;
  border-radius: 9999px;
  font-weight: 700;
  font-size: 11.5px;
  user-select: none;
  margin: 0 2px;
  vertical-align: middle;
}

:deep(.inline-asset-thumb) {
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.4);
}

:deep(.inline-asset-delete) {
  cursor: pointer;
  margin-left: 2px;
  font-weight: bold;
  opacity: 0.7;
}

:deep(.inline-asset-delete:hover) {
  opacity: 1;
  color: var(--theme-danger-text);
}

.tray-ref-delete {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  background: rgba(15, 23, 42, 0.82);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}

/* ===== 错误卡片（生成失败提示，token 驱动，适配暗黑/明朗/护眼） ===== */
.gen-error {
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--theme-danger-bg);
  border: 1px solid var(--theme-danger-border);
}
.gen-error-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 6px;
}
.gen-error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: rgb(var(--studio-rose-rgb) / 0.18);
  color: var(--theme-danger-text);
}
.gen-error-title {
  font-size: 12.5px;
  font-weight: 800;
  color: var(--theme-danger-text);
}
.gen-error-body {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.55;
  color: var(--theme-text-primary);
  white-space: pre-wrap;
}
.gen-error-hint {
  margin: 7px 0 0;
  display: flex;
  align-items: flex-start;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--theme-text-secondary);
}
.gen-error-hint svg {
  margin-top: 2px;
  flex-shrink: 0;
  color: var(--theme-warning-text);
}
.gen-error-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
}
.gen-error-retry,
.gen-error-edit {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 13px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: filter .15s, background-color .15s;
}
.gen-error-retry {
  background: var(--theme-accent-primary);
  color: var(--theme-accent-text);
  border: 1px solid transparent;
}
.gen-error-retry:hover { filter: brightness(1.08); }
.gen-error-edit {
  background: transparent;
  color: var(--theme-text-secondary);
  border: 1px solid var(--theme-border);
}
.gen-error-edit:hover {
  background: var(--theme-bg-hover);
  color: var(--theme-text-primary);
}

/* ---- 助手正文 Markdown 排版（v-html 注入：宿主 .chat-md 带 scoped 属性，
        其内部标签不带，故命中内部标签需 :deep；直接子元素用普通 scoped 选择器即可）
        颜色全部走 --md-* 变量：默认深色（聊天面板底色），浅色主题由
        html.light / html.eye-care 覆盖，跟随主题切换 ---- */
.chat-md {
  --md-heading: #f1f5f9;
  --md-strong: #f8fafc;
  --md-link: #22d3ee;
  --md-muted: #94a3b8;
  --md-quote-border: rgba(34, 211, 238, 0.5);
  --md-code-bg: rgba(148, 163, 184, 0.15);
  --md-code-border: rgba(148, 163, 184, 0.22);
  --md-pre-bg: #0b1220;
  --md-pre-fg: #e2e8f0;
  --md-table-border: rgba(148, 163, 184, 0.28);
  --md-table-head-bg: rgba(148, 163, 184, 0.12);
  --md-hr: rgba(148, 163, 184, 0.25);
  color: var(--md-strong);
  font-size: 12.5px;
  line-height: 1.7;
  word-break: break-word;
}
html.light .chat-md,
html.eye-care .chat-md {
  --md-heading: #1e293b;
  --md-strong: #0f172a;
  --md-link: #0891b2;
  --md-muted: #64748b;
  --md-quote-border: rgba(8, 145, 178, 0.45);
  --md-quote-fg: #475569;
  --md-code-bg: rgba(100, 116, 139, 0.12);
  --md-code-border: rgba(100, 116, 139, 0.25);
  --md-pre-bg: #f1f5f9;
  --md-pre-fg: #1e293b;
  --md-table-border: rgba(100, 116, 139, 0.3);
  --md-table-head-bg: rgba(100, 116, 139, 0.12);
  --md-hr: rgba(100, 116, 139, 0.3);
}
.chat-md > * + * { margin-top: 0.6em; }
.chat-md :deep(h1),
.chat-md :deep(h2),
.chat-md :deep(h3),
.chat-md :deep(h4) { font-weight: 700; color: var(--md-heading); line-height: 1.4; }
.chat-md :deep(h1) { font-size: 1.35em; }
.chat-md :deep(h2) { font-size: 1.22em; }
.chat-md :deep(h3) { font-size: 1.1em; }
.chat-md :deep(h4) { font-size: 1em; }
.chat-md :deep(ul),
.chat-md :deep(ol) { padding-left: 1.4em; }
.chat-md :deep(ul) { list-style: disc; }
.chat-md :deep(ol) { list-style: decimal; }
.chat-md :deep(li) { margin: 0.2em 0; }
.chat-md :deep(li > ul),
.chat-md :deep(li > ol) { margin-top: 0.2em; }
.chat-md :deep(strong) { color: var(--md-strong); font-weight: 700; }
.chat-md :deep(em) { font-style: italic; }
.chat-md :deep(a) { color: var(--md-link); text-decoration: underline; text-underline-offset: 2px; }
.chat-md :deep(blockquote) {
  border-left: 3px solid var(--md-quote-border);
  padding: 0.2em 0 0.2em 0.9em;
  color: var(--md-muted);
}
.chat-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: var(--md-code-bg);
  border: 1px solid var(--md-code-border);
  border-radius: 5px;
  padding: 0.1em 0.4em;
}
.chat-md :deep(pre) {
  background: var(--md-pre-bg);
  border: 1px solid var(--md-code-border);
  border-radius: 10px;
  padding: 0.8em 1em;
  overflow-x: auto;
}
.chat-md :deep(pre code) {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 0.85em;
  color: var(--md-pre-fg);
}
.chat-md :deep(hr) { border: none; border-top: 1px solid var(--md-hr); }
.chat-md :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92em;
  display: block;
  overflow-x: auto;
}
.chat-md :deep(th),
.chat-md :deep(td) {
  border: 1px solid var(--md-table-border);
  padding: 0.4em 0.7em;
  text-align: left;
}
.chat-md :deep(th) { background: var(--md-table-head-bg); font-weight: 700; }
.chat-md :deep(img) { max-width: 100%; border-radius: 8px; }

/* 可复制文本块：md-unit 由 renderMarkdown 注入（sec 按标题层级嵌套，code/quote/table 独立成块），
   按钮文字统一走容器委托事件；正文需显式覆盖 body 上的 select-none 才能选中 */
.chat-md {
  user-select: text;
  -webkit-user-select: text;
}
.chat-md :deep(.md-unit) { position: relative; }
.chat-md :deep(.md-unit-sec) {
  border: 1px solid var(--md-code-border);
  border-radius: 12px;
  padding: 0.5em 0.65em 0.6em;
  background: rgba(148, 163, 184, 0.06);
}
.chat-md :deep(.md-unit-sec + .md-unit-sec),
.chat-md :deep(.md-unit) + .md-unit { margin-top: 0.55em; }
.chat-md :deep(.md-unit-sec .md-unit-sec) { background: transparent; }
.chat-md :deep(.md-unit-sec) > :is(h1, h2, h3, h4) {
  margin-top: 0;
  padding-right: 3.8em;
}
.chat-md :deep(.md-unit-bar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 0.35em;
}
.chat-md :deep(.md-unit-label) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--md-muted);
}
.chat-md :deep(.md-copy-btn) {
  position: absolute;
  top: 0.4em;
  right: 0.4em;
  z-index: 2;
  padding: 0.15em 0.6em;
  font-size: 10px;
  font-weight: 700;
  border-radius: 6px;
  border: 1px solid var(--md-code-border);
  background: var(--md-code-bg);
  color: var(--md-pre-fg);
  opacity: 0.55;
  transition: opacity 0.12s ease, background-color 0.12s ease;
  cursor: pointer;
  user-select: none;
}
.chat-md :deep(.md-unit-bar .md-copy-btn) { position: static; opacity: 0.8; }
.chat-md :deep(.md-unit:hover) > .md-copy-btn,
.chat-md :deep(.md-unit-bar .md-copy-btn:hover),
.chat-md :deep(.md-copy-btn:focus-visible) { opacity: 1; }
.chat-md :deep(.md-unit-quote) { padding-right: 3.4em; }
.chat-md :deep(.md-unit-table) { padding-top: 1.1em; }

/* 气泡头部的「复制全文」：拿到的是这条回复的 Markdown 原文 */
.msg-copy-all {
  padding: 1px 8px;
  border-radius: 7px;
  border: 1px solid var(--md-code-border);
  background: var(--md-code-bg);
  color: var(--theme-text-secondary, #cbd5e1);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
}
html.light .msg-copy-all,
html.eye-care .msg-copy-all {
  color: #334155;
}
.msg-copy-all:hover { filter: brightness(1.12); }
</style>
