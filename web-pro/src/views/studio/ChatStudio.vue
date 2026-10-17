<template>
  <div class="flex-1 flex h-[calc(100vh-56px)] overflow-hidden bg-studio-950 font-sans text-slate-100 text-sm">
    <!-- ========================================================================= -->
    <!-- 1. 左侧抽屉栏：豆包/千问双模式（会话历史 / 我的创作库） -->
    <!-- ========================================================================= -->
    <aside class="w-80 bg-studio-900 border-r border-studio-750 flex flex-col justify-between shrink-0 select-none">
      <div class="flex flex-col flex-1 overflow-hidden">
        <!-- 侧栏顶部 Tab：会话历史 vs 我的创作库 -->
        <div class="p-3 border-b border-studio-800 flex items-center justify-between bg-studio-950/60">
          <div class="flex items-center space-x-1 bg-studio-900 p-1 rounded-lg border border-studio-750">
            <button
              @click="sidebarTab = 'history'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer',
                sidebarTab === 'history'
                  ? 'bg-studio-accent text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              ]"
            >
              <StudioIcon name="history" :size="14" />
              <span>对话历史</span>
            </button>
            <button
              @click="sidebarTab = 'library'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer',
                sidebarTab === 'library'
                  ? 'bg-studio-indigo text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              ]"
            >
              <StudioIcon name="wand" :size="14" />
              <span>我的创作库</span>
            </button>
          </div>

          <button
            v-if="sidebarTab === 'history'"
            @click="createNewSession"
            class="p-2 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 text-xs border border-studio-700 transition-all cursor-pointer"
            title="新建对话"
          >
            <StudioIcon name="plus" :size="14" />
          </button>
          <button
            v-else
            @click="openAddTemplateModal"
            class="px-2.5 py-1.5 rounded-lg bg-studio-accent/20 hover:bg-studio-accent/30 text-studio-accent text-xs font-bold border border-studio-accent/30 transition-all flex items-center space-x-1 cursor-pointer"
          >
            <StudioIcon name="plus" :size="13" />
            <span>新建配方</span>
          </button>
        </div>

        <!-- 模式 A：对话历史列表 -->
        <div v-if="sidebarTab === 'history'" class="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin">
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

        <!-- 模式 B：我的创作库（收藏的配方卡片） -->
        <div v-else-if="sidebarTab === 'library'" class="flex-1 flex flex-col overflow-hidden">
          <div class="p-2.5 border-b border-studio-800">
            <div class="flex items-center bg-studio-950 px-3 py-1.5 rounded-lg border border-studio-750 text-xs text-slate-300">
              <StudioIcon name="search" :size="14" class="text-slate-400 mr-2" />
              <input
                v-model="tplSearch"
                type="text"
                placeholder="搜索配方标题或提示词..."
                class="bg-transparent outline-none text-xs w-full text-slate-100 placeholder-slate-500"
              />
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
            <div v-if="filteredTemplates.length === 0" class="text-center py-10 text-xs text-slate-500">
              暂无匹配的创作库模块
            </div>

            <div
              v-for="tpl in filteredTemplates"
              :key="tpl.id"
              @click="openTemplateDetail(tpl)"
              class="group rounded-xl bg-studio-850 border border-studio-750 hover:border-studio-accent p-3 transition-all cursor-pointer relative shadow-sm hover:shadow-lg"
            >
              <div class="flex items-start justify-between gap-2 mb-1.5">
                <span class="text-xs font-bold text-white group-hover:text-studio-accent transition-colors line-clamp-1">
                  {{ tpl.title }}
                </span>
                <span v-if="recipeIsLegacy(tpl)" class="text-[11px] text-slate-300">旧配方，模型未记录</span>
                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-studio-950 text-studio-cyan shrink-0 border border-studio-800 font-bold">
                  {{ tpl.aspect_ratio || '16:9' }}
                </span>
              </div>

              <p class="text-[12px] text-slate-300 line-clamp-2 leading-relaxed mb-2.5">
                {{ tpl.prompt }}
              </p>

              <div class="flex items-center space-x-2 pt-1.5 border-t border-studio-800">
                <div v-if="tpl.origin_images?.[0]" class="flex items-center space-x-1.5 text-[11px] text-slate-400">
                  <span class="text-slate-500 font-bold">原:</span>
                  <img :src="tpl.origin_images[0].url" class="w-7 h-7 rounded object-cover border border-white/10" />
                </div>
                <span class="text-slate-500 text-xs font-bold">➔</span>
                <div v-if="tpl.result_images?.[0]" class="flex items-center space-x-1.5 text-[11px] text-slate-400">
                  <span class="text-slate-500 font-bold">成:</span>
                  <img :src="tpl.result_images[0].url" class="w-7 h-7 rounded object-cover border border-studio-accent/40" />
                </div>
                <div class="flex-1"></div>
                <button
                  type="button"
                  class="text-xs font-bold text-rose-400 cursor-pointer"
                  @click.stop="deleteTemplate(tpl.id)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="p-3 bg-studio-950/80 border-t border-studio-800 text-xs text-slate-400 flex items-center justify-between">
        <span class="flex items-center gap-1.5">
          <StudioIcon name="wand" :size="14" class="text-studio-accent" />
          <span># 创作库 · @ 引用素材</span>
        </span>
        <span class="text-[11px] font-mono text-emerald-400 font-bold">DAM 数据库已连接</span>
      </div>
    </aside>

    <!-- ========================================================================= -->
    <!-- 2. 中央核心工作区：空状态【大号参考图主工作台】 VS 消息流 -->
    <!-- ========================================================================= -->
    <main class="flex-1 flex flex-col justify-between overflow-hidden bg-studio-950 relative p-4 space-y-3">
      <!-- 2.1 中间工作区：空状态居中灵感与参考看板 VS 真实消息流 -->
      <div ref="messageScroller" class="flex-1 overflow-y-auto px-2 space-y-4 scrollbar-thin">
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

            <!-- 大号参考生图槽位卡片 (0/10) -->
            <div class="w-full max-w-3xl p-4 rounded-2xl bg-studio-900 border border-studio-750 shadow-xl space-y-3 text-left">
              <div class="flex items-center justify-between">
                <span class="text-xs font-extrabold text-white flex items-center gap-2">
                  <span>🖼️ 参考生图 / 素材挂载 (可选)</span>
                  <span class="text-studio-cyan font-mono font-bold">{{ referenceTray.length }}/10</span>
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
                  v-if="referenceTray.length < 10"
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
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-600 flex items-center justify-center text-white shadow-xl">
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
            <div class="max-w-2xl rounded-2xl rounded-tr-xs bg-studio-accent px-4 py-3 text-white text-xs leading-relaxed shadow-lg">
              <div class="space-y-2">
                <div v-if="msg.referencedCard" class="px-2 py-1 rounded bg-black/25 text-studio-cyan text-[11px] border border-studio-cyan/40 flex items-center space-x-1.5">
                  <StudioIcon name="wand" :size="12" />
                  <span>已调用创作库模板: {{ msg.referencedCard }}</span>
                </div>

                <!-- 图文混排渲染区 -->
                <div class="font-sans leading-relaxed text-sm flex flex-wrap items-center gap-1">
                  <template v-for="(segment, sIdx) in parseRichSegments(msg.content)" :key="sIdx">
                    <span v-if="segment.type === 'text'" class="whitespace-pre-wrap">{{ segment.text }}</span>
                    <!-- 行内图文混排胶囊 -->
                    <span
                      v-else-if="segment.type === 'chip'"
                      class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/20 border border-white/40 text-white font-bold text-xs select-none shadow-sm align-middle"
                    >
                      <img v-if="segment.thumb" :src="segment.thumb" class="w-4 h-4 rounded-full object-cover border border-white/50" />
                      <span>{{ segment.tag }}: {{ segment.name }}</span>
                    </span>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- AI 生成产物消息 -->
          <div v-else class="flex justify-start">
            <div class="max-w-3xl w-full rounded-2xl rounded-tl-xs bg-studio-900 border border-studio-750 p-4 text-slate-200 text-xs shadow-md space-y-3">
              <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono pb-2 border-b border-studio-800">
                <span class="flex items-center gap-1.5 text-studio-accent font-medium">
                  <StudioIcon :name="msg.modality === 'video' ? 'video' : (msg.modality === 'music' ? 'music' : 'sparkles')" :size="14" />
                  {{ msg.model || 'Seedream 5.0 Flash' }}
                </span>
                <span v-if="!msg.isError">
                  {{ msg.modality === 'video' ? `时长: ${msg.duration || '5s'} · 分辨率: ${msg.resolution || '1080p'}` : (msg.modality === 'music' ? `时长: ${msg.duration || '30s'} · 320kbps` : `耗时: ${msg.duration || ''} · 分辨率: ${msg.resolution || ''}`) }}
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
                </div>
              </div>

              <!-- 纯文本与生成说明 -->
              <p
                :class="[
                  'leading-relaxed whitespace-pre-wrap',
                  msg.isError ? 'text-rose-400 font-bold bg-rose-950/30 p-2.5 rounded-lg border border-rose-900/50' : 'text-slate-200'
                ]"
              >{{ msg.content }}</p>
              <div v-if="msg.isError" class="flex items-center gap-2">
                <button type="button" class="px-3 py-1 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" @click="openRetry(msg)">重试</button>
                <button type="button" class="px-3 py-1 rounded-lg border border-studio-700 text-xs font-bold cursor-pointer" @click="editFromError(msg)">编辑</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="generating" class="flex justify-start">
          <div class="rounded-xl bg-studio-900 border border-studio-750 px-4 py-3 text-slate-300 text-xs flex items-center space-x-2.5">
            <StudioIcon name="refresh" :size="16" class="animate-spin text-studio-accent" />
            <span>视觉/多模态引擎正在推理计算中，预计 3 秒输出高保真产物...</span>
          </div>
        </div>
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
                <option v-for="m in studioModels.chat" :key="m.id" :value="m.id">
                  {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                </option>
              </select>
            </div>

            <div class="flex items-center space-x-3">
              <label class="flex items-center space-x-1.5 text-studio-cyan font-bold cursor-pointer">
                <input type="checkbox" v-model="deepThinkingEnabled" class="rounded accent-studio-cyan" />
                <span>🧠 深度思考模式 (R1)</span>
              </label>
              <span class="text-slate-500">|</span>
              <span class="text-slate-400">已就绪 · 支持多图图文混排</span>
            </div>
          </template>

          <!-- B. 生图 / 视频 / 音乐：模式和参数都跟当前模型的契约走 -->
          <template v-else>
            <div class="flex w-full flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-slate-400 font-bold">{{ activeModality === 'video' ? '视频模型' : (activeModality === 'music' ? '配乐' : '生图模型') }}:</span>
              <select v-if="activeModality === 'image'" v-model="imageModelKey" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <option v-for="m in studioModels.image" :key="m.id" :value="m.id">
                  {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                </option>
              </select>
              <select v-else-if="activeModality === 'video'" v-model="videoModelKey" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <option v-for="m in studioModels.video" :key="m.id" :value="m.id">
                  {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                </option>
              </select>
              <select v-else v-model="musicType" class="bg-studio-950 text-white font-bold text-xs border border-studio-700 rounded-lg px-2.5 py-1 outline-none">
                <option v-for="m in studioModels.music" :key="m.id" :value="m.id">
                  {{ m.name }}{{ m.badge ? ' · ' + m.badge : '' }}
                </option>
              </select>
            </div>
            <p v-if="activeModality === 'image' && imageModelKey === 'qwenimage_local'" class="text-xs text-slate-300 leading-relaxed max-w-xl">
              只有文生图已经实测：可以不传参考图。张数上限和框选编辑都还没实测。生图只走 8003。
            </p>
            <p v-else-if="!currentSchema" class="text-xs text-slate-300">这个模型的参数表还没接入，这次只提交提示词。</p>
            <div v-if="currentSchema && currentSchema.modes" class="flex flex-wrap gap-2">
              <button
                v-for="mode in currentSchema.modes"
                :key="mode.id"
                type="button"
                class="choice"
                :class="{ 'is-on': activeGenMode === mode.id }"
                @click="setGenMode(mode.id)"
              >
                <span class="choice-mark"></span>
                <span>{{ mode.label }}</span>
                <span v-if="activeGenMode === mode.id" class="choice-now">当前</span>
              </button>
            </div>
            <div v-if="commonFields.length" class="flex flex-wrap items-end gap-2">
              <label v-for="field in commonFields" :key="'c-' + field.key" class="flex flex-col gap-1 text-xs">
                <span class="text-slate-400 font-bold">{{ field.label }}</span>
                <select v-if="field.type === 'enum'" class="bg-studio-950 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none" :disabled="isFieldLocked(field.key)" :value="schemaParams[field.key]" @change="setSchemaParam(field.key, $event.target.value)">
                  <option v-for="opt in field.options" :key="String(opt)" :value="opt">{{ optionText(field, opt) }}</option>
                </select>
                <input v-else-if="field.type === 'bool'" type="checkbox" class="rounded accent-studio-accent" :disabled="isFieldLocked(field.key)" :checked="!!schemaParams[field.key]" @change="setSchemaParam(field.key, $event.target.checked)" />
                <input v-else-if="field.type === 'range' || field.type === 'number'" type="number" class="w-24 bg-studio-950 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none" :min="field.min" :max="field.max" :step="field.step || 1" :disabled="isFieldLocked(field.key)" :value="schemaParams[field.key]" @change="setSchemaParam(field.key, Number($event.target.value))" />
                <input v-else type="text" class="bg-studio-950 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none" :disabled="isFieldLocked(field.key)" :value="schemaParams[field.key] || ''" @change="setSchemaParam(field.key, $event.target.value)" />
              </label>
              <button v-if="advancedFields.length" type="button" class="choice" :class="{ 'is-on': showAdvanced }" @click="showAdvanced = !showAdvanced">
                <span class="choice-mark"></span>
                <span>高级配置</span>
                <span v-if="showAdvanced" class="choice-now">当前</span>
              </button>
            </div>
            <div v-if="showAdvanced && advancedFields.length" class="flex flex-wrap items-end gap-2">
              <label v-for="field in advancedFields" :key="'a-' + field.key" class="flex flex-col gap-1 text-xs">
                <span class="text-slate-400 font-bold">{{ field.label }}</span>
                <select v-if="field.type === 'enum'" class="bg-studio-950 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none" :disabled="isFieldLocked(field.key)" :value="schemaParams[field.key]" @change="setSchemaParam(field.key, $event.target.value)">
                  <option v-for="opt in field.options" :key="String(opt)" :value="opt">{{ optionText(field, opt) }}</option>
                </select>
                <input v-else-if="field.type === 'bool'" type="checkbox" class="rounded accent-studio-accent" :disabled="isFieldLocked(field.key)" :checked="!!schemaParams[field.key]" @change="setSchemaParam(field.key, $event.target.checked)" />
                <input v-else-if="field.type === 'range' || field.type === 'number'" type="number" class="w-28 bg-studio-950 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none" :min="field.min" :max="field.max" :step="field.step || 1" :disabled="isFieldLocked(field.key)" :value="schemaParams[field.key]" @change="setSchemaParam(field.key, Number($event.target.value))" />
                <input v-else type="text" class="bg-studio-950 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none" :disabled="isFieldLocked(field.key)" :value="schemaParams[field.key] || ''" @change="setSchemaParam(field.key, $event.target.value)" />
              </label>
            </div>
            <p v-if="oldRecipeNote" class="text-xs text-slate-300">这是旧配方，模型未记录，已改用 Agnes Image 2.5 Flash。</p>
            <p v-if="composerError" class="text-xs font-bold text-rose-500">{{ composerError }}</p>
            </div>
          </template>
        </div>

        <!-- 2.2.2 提示词富文本输入中枢 (图文混排) -->
        <div class="rounded-xl bg-studio-950 border border-studio-700/80 p-3 relative shadow-inner space-y-2">
          <div v-if="referenceTray.length" class="flex items-center gap-2 overflow-x-auto">
            <span class="shrink-0 text-xs font-bold text-slate-300">即将提交 {{ referenceTray.length }} 张</span>
            <button v-for="(item, idx) in referenceTray" :key="item.url + idx" type="button" class="shrink-0" @click="openMediaPreview(item)">
              <img :src="item.url" class="h-10 w-10 rounded-lg object-cover" :alt="item.name" />
              <span class="block max-w-16 truncate text-[10px] text-slate-300">{{ activeGenMode === 'first_last_frame' ? (idx === 0 ? '首帧' : '尾帧') : item.tag }}</span>
            </button>
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
              class="rich-prompt-editor text-slate-100 text-sm leading-relaxed pr-32 font-medium min-h-[44px] max-h-36 overflow-y-auto outline-none"
              :data-placeholder="getEditorPlaceholder()"
              @input="onEditorInput"
              @keydown="onEditorKeydown"
            ></div>

            <!-- ✨ 优化提示词按键 -->
            <button
              @click="optimizePrompt"
              :disabled="optimizing"
              class="absolute top-0 right-0 px-3 py-1.5 rounded-lg bg-studio-accent/20 hover:bg-studio-accent/30 text-studio-accent text-xs font-extrabold border border-studio-accent/40 flex items-center space-x-1.5 transition-all disabled:opacity-40 cursor-pointer shadow-sm"
              title="根据当前模型专属提示词规则进行智能优化"
            >
              <StudioIcon name="wand" :size="13" :class="{ 'animate-spin': optimizing }" />
              <span>{{ optimizing ? '优化中...' : '✨ 优化提示词' }}</span>
            </button>
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

    <!-- ========================================================================= -->
    <!-- 3. 模态弹窗：私有素材库 DAM 全量多选选择器 / 本地上传【宽屏沉浸式工作台】 -->
    <!-- ========================================================================= -->
    <div v-if="showAssetSelector" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div class="w-full max-w-[1280px] h-[90vh] rounded-2xl bg-studio-900 border border-studio-750 shadow-2xl flex flex-col overflow-hidden">
        <!-- 弹窗顶栏 -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-studio-750 shrink-0 bg-studio-950/40">
          <div class="flex items-center space-x-3">
            <span class="text-xl">🖼️</span>
            <div>
              <div class="text-sm font-bold text-white flex items-center gap-2">
                <span>私有素材库 DAM 资产选择器</span>
                <span class="text-xs font-mono font-bold text-studio-cyan bg-studio-850 px-2 py-0.5 rounded border border-studio-750">
                  {{ selectorTotal > 0 ? `共 ${selectorTotal} 件资产可用` : '连接私有素材库' }}
                </span>
              </div>
              <div class="text-[11px] text-slate-400">支持分类筛选、关键词搜索与多选批量挂载至 @图1 @图2 混排提示词</div>
            </div>
          </div>
          <button @click="showAssetSelector = false" class="w-8 h-8 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer">
            ✕
          </button>
        </div>

        <!-- 选项卡与控制栏 -->
        <div class="px-6 py-3 border-b border-studio-750 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-studio-950/20">
          <!-- 选项卡：素材库 vs 本地上传 -->
          <div class="flex items-center space-x-2">
            <button
              @click="selectorTab = 'library'"
              :class="['px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5', selectorTab === 'library' ? 'bg-studio-accent text-white shadow-md' : 'bg-studio-850 text-slate-400 hover:text-white hover:bg-studio-800 border border-studio-750']"
            >
              <span>🏛️ DAM 素材库</span>
              <span class="text-[10px] font-mono opacity-80">({{ selectorTotal }})</span>
            </button>
            <button
              @click="selectorTab = 'upload'"
              :class="['px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5', selectorTab === 'upload' ? 'bg-studio-accent text-white shadow-md' : 'bg-studio-850 text-slate-400 hover:text-white hover:bg-studio-800 border border-studio-750']"
            >
              <span>☁️ 本地高清上传</span>
            </button>
          </div>

          <!-- 搜索与多选工具 (仅在素材库选项卡展示) -->
          <div v-if="selectorTab === 'library'" class="flex items-center space-x-2.5">
            <div class="relative w-56">
              <input
                v-model="selectorKeyword"
                @keyup.enter="loadDamAssets(1)"
                type="text"
                placeholder="搜索名称 / 标签 / 空间..."
                class="w-full pl-8 pr-3 py-1.5 bg-studio-950 border border-studio-750 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-studio-accent"
              />
              <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
            </div>
            <button
              @click="loadDamAssets(1)"
              class="px-3 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-200 text-xs font-bold cursor-pointer"
            >
              检索
            </button>
            <div class="h-4 w-px bg-studio-750"></div>
            <button
              @click="selectAllCurrentPage"
              class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-300 text-xs cursor-pointer"
              title="选择当前页显示的资产 (最多10件)"
            >
              全选本页
            </button>
            <button
              @click="clearModalSelection"
              class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-400 hover:text-rose-400 text-xs cursor-pointer"
            >
              清空
            </button>
          </div>
        </div>

        <div v-if="selectorTab === 'library'" class="flex-1 flex min-h-0">
        <aside class="picker-pane w-72 shrink-0 overflow-y-auto border-r border-studio-800 p-3 space-y-2">
          <div class="lib-plates" style="padding:0">
            <button v-for="plate in sourcePlates" :key="plate.key" type="button" class="lib-plate" :class="{ 'is-on': selectorShelf === plate.key }" @click="selectorShelf = plate.key; loadDamAssets(1)">
              <span class="lib-mark"></span>{{ plate.label }}
            </button>
          </div>
          <button
            v-for="tab in selectorMains"
            :key="tab.key"
            type="button"
            class="sidebar-row"
            :class="{ 'is-on': selectorMain === tab.key }"
            @click="setSelectorMain(tab.key)"
          >
            {{ tab.label }}
          </button>
          <button
            v-for="sub in selectorSubs"
            :key="sub.key"
            type="button"
            class="sidebar-row is-sub"
            :class="{ 'is-on': selectorSub === sub.key }"
            @click="setSelectorSub(sub.key)"
          >
            {{ sub.label }}
          </button>
          <button type="button" class="filter-switch" :class="{ 'is-on': selectorOnlyFav }" @click="toggleSelectorFav">
            <span>只看收藏</span>
            <span class="filter-switch-knob"></span>
          </button>
          <div v-if="selectorMain === 'image'" class="space-y-1">
            <section class="lib-group">
              <button type="button" class="lib-group-head" @click="pickerOpen.ratio = !pickerOpen.ratio"><span>画幅</span><span class="lib-meta">{{ pickerOpen.ratio ? '收起' : '展开' }}</span></button>
              <div v-if="pickerOpen.ratio" class="lib-chips">
                <button v-for="item in selectorOrientations" :key="item.key" type="button" class="lib-chip" :class="{ 'is-on': selectorOrientation === item.key }" @click="toggleSelectorOrientation(item.key)">{{ item.label }}</button>
              </div>
            </section>
            <section v-if="selectorSub === 'interior_exterior'" class="lib-group">
              <button type="button" class="lib-group-head" @click="pickerOpen.space = !pickerOpen.space"><span>空间</span><span class="lib-meta">{{ pickerOpen.space ? '收起' : '展开' }}</span></button>
              <div v-if="pickerOpen.space" class="lib-chips">
                <button v-for="item in selectorSpaces" :key="item.dir" type="button" class="lib-chip" :class="{ 'is-on': selectorSpace === item.dir }" @click="toggleSelectorSpace(item.dir)">{{ item.label }}</button>
              </div>
            </section>
            <section v-if="selectorSub === 'interior_exterior'" class="lib-group">
              <button type="button" class="lib-group-head" @click="pickerOpen.style = !pickerOpen.style"><span>风格</span><span class="lib-meta">{{ pickerOpen.style ? '收起' : '展开' }}</span></button>
              <div v-if="pickerOpen.style" class="lib-chips">
                <button v-for="item in selectorStyles" :key="'st'+item.dir" type="button" class="lib-chip" :class="{ 'is-on': selectorStyle === item.dir }" @click="toggleSelectorStyle(item.dir)">{{ item.label }}</button>
              </div>
            </section>
            <section v-if="selectorSub === 'interior_exterior'" class="lib-group">
              <button type="button" class="lib-group-head" @click="pickerOpen.material = !pickerOpen.material"><span>材质</span><span class="lib-meta">{{ pickerOpen.material ? '收起' : '展开' }}</span></button>
              <div v-if="pickerOpen.material" class="lib-chips">
                <button v-for="item in selectorMaterials" :key="'mt'+item.dir" type="button" class="lib-chip" :class="{ 'is-on': selectorMaterial === item.dir }" @click="toggleSelectorMaterial(item.dir)">{{ item.label }}</button>
              </div>
            </section>
            <section class="lib-group">
              <button type="button" class="lib-group-head" @click="pickerOpen.color = !pickerOpen.color"><span>主色</span><span class="lib-meta">{{ pickerOpen.color ? '收起' : '展开' }}</span></button>
              <div v-if="pickerOpen.color" class="lib-chips">
                <button v-for="item in selectorColors" :key="item.dir || item.label" type="button" class="lib-chip" :class="{ 'is-on': selectorColor === (item.dir || item.label) }" @click="toggleSelectorColor(item.dir || item.label)">{{ item.label }}</button>
              </div>
            </section>
          </div>
        </aside>
        <div class="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <div v-if="libraryLoading" class="h-64 flex flex-col items-center justify-center space-y-3 text-slate-400 text-xs">
            <div class="w-8 h-8 rounded-full border-2 border-studio-accent border-t-transparent animate-spin"></div>
            <span>正在全量读取私有 DAM 素材库资产...</span>
          </div>
          <div v-else-if="libraryItems.length === 0 && sessionUploads.length === 0 && sessionGenerated.length === 0" class="h-64 flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs">
            <span class="text-3xl">🏜️</span>
            <span>该筛选条件下暂无素材资产，请尝试其他关键词或分类</span>
          </div>
          <div v-else>
          <div v-if="sessionUploads.length" class="mb-4">
            <div class="text-xs font-bold mb-2">上传素材</div>
            <div class="flex gap-2 overflow-x-auto">
              <div v-for="item in sessionUploads" :key="'up-' + (item.fid || item.url)" class="w-16 shrink-0">
                <button type="button" class="block" @click="toggleSelectAsset(item)">
                  <img :src="item.url" class="w-16 h-16 object-cover rounded-lg" :alt="item.name" />
                </button>
                <button type="button" class="mt-1 w-full text-[11px] font-bold" @click="openMediaPreview(item)">查看</button>
              </div>
            </div>
          </div>
          <div v-if="sessionGenerated.length" class="mb-4">
            <div class="text-xs font-bold mb-2">生成素材</div>
            <div class="flex gap-2 overflow-x-auto">
              <div v-for="item in sessionGenerated" :key="'gen-' + (item.fid || item.url)" class="w-16 shrink-0">
                <button type="button" class="block" @click="toggleSelectAsset(item)">
                  <img :src="item.url" class="w-16 h-16 object-cover rounded-lg" :alt="item.name" />
                </button>
                <button type="button" class="mt-1 w-full text-[11px] font-bold" @click="openMediaPreview(item)">查看</button>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
            <div
              v-for="item in libraryItems"
              :key="item.fid || item.id"
              @click="toggleSelectAsset(item)"
              :class="[
                'group relative rounded-xl overflow-hidden border bg-studio-950 aspect-square cursor-pointer transition-all shadow-sm select-none',
                selectedModalFids.includes(item.fid)
                  ? 'border-2 border-studio-cyan ring-2 ring-studio-cyan/30 shadow-lg shadow-studio-cyan/20 scale-[0.98]'
                  : 'border-studio-750 hover:border-slate-500 hover:shadow-md'
              ]"
            >
              <img :src="item.url" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />

              <!-- 多选勾选标记 (左上角) -->
              <div class="absolute top-2 left-2 z-10 pointer-events-none">
                <div
                  :class="[
                    'w-6 h-6 rounded-lg flex items-center justify-center transition-all shadow-md',
                    selectedModalFids.includes(item.fid)
                      ? 'bg-studio-cyan text-slate-950 font-black'
                      : 'bg-black/60 backdrop-blur border border-white/20 text-transparent opacity-70 group-hover:opacity-100'
                  ]"
                >
                  <span class="text-xs">✓</span>
                </div>
              </div>

              <!-- 右上角：大图预览放大镜按钮 -->
              <div class="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  @click.stop="openMediaPreview(item, item.kind === 'video' ? 'video' : 'image')"
                  class="w-6 h-6 rounded-lg bg-black/70 hover:bg-studio-accent text-white flex items-center justify-center transition-all shadow-md cursor-pointer"
                  title="查看高清大图/视频"
                >
                  <span class="text-[11px]">🔍</span>
                </button>
              </div>

              <!-- 底部标题与类型徽标 -->
              <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent flex flex-col justify-end p-2 pointer-events-none">
                <span class="text-[11px] font-bold text-white truncate w-full">{{ item.name }}</span>
                <div class="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                  <span class="font-mono text-studio-cyan">{{ item.kind === 'video' ? '🎬 视频' : '🖼️ 图片' }}</span>
                  <span v-if="selectedModalFids.includes(item.fid)" class="text-studio-cyan font-bold font-mono">已选中</span>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
        </div>

        <!-- 本地上传区域 -->
        <div v-else-if="selectorTab === 'upload'" class="flex-1 flex items-center justify-center p-8">
          <div
            @click="triggerLocalFileInput"
            class="w-full max-w-lg border-2 border-dashed border-studio-700 hover:border-studio-accent rounded-2xl p-12 text-center cursor-pointer transition-all bg-studio-950/60 hover:bg-studio-950 flex flex-col items-center justify-center space-y-3"
          >
            <div class="w-16 h-16 rounded-2xl bg-studio-850 flex items-center justify-center text-studio-accent">
              <StudioIcon name="image" :size="36" />
            </div>
            <span class="text-sm font-bold text-slate-200">点击选择本地高清图片或视频</span>
            <span class="text-xs text-slate-400">支持 PNG, JPG, WEBP, MP4 格式，上传后立即挂载为图文混排引用</span>
            <span class="px-4 py-1.5 rounded-lg bg-studio-accent text-white text-xs font-bold shadow-md hover:brightness-110">
              浏览本地文件
            </span>
          </div>
          <input ref="localFileInput" type="file" accept="image/*,video/*" class="hidden" @change="onLocalFileSelected" />
        </div>

        <!-- 弹窗底栏：分页与确认挂载操作 -->
        <div class="px-6 py-3.5 border-t border-studio-750 shrink-0 bg-studio-950/60 flex items-center justify-between">
          <!-- 左侧：分页控制 -->
          <div v-if="selectorTab === 'library'" class="flex items-center space-x-2 text-xs text-slate-400 font-mono">
            <span>第 {{ selectorPage }} / {{ Math.max(1, Math.ceil(selectorTotal / selectorPageSize)) }} 页</span>
            <button
              @click="loadDamAssets(selectorPage - 1)"
              :disabled="selectorPage <= 1"
              class="px-2.5 py-1 rounded bg-studio-850 hover:bg-studio-800 disabled:opacity-30 border border-studio-750 text-slate-200 cursor-pointer"
            >
              上一页
            </button>
            <button
              @click="loadDamAssets(selectorPage + 1)"
              :disabled="selectorPage * selectorPageSize >= selectorTotal"
              class="px-2.5 py-1 rounded bg-studio-850 hover:bg-studio-800 disabled:opacity-30 border border-studio-750 text-slate-200 cursor-pointer"
            >
              下一页
            </button>
          </div>
          <div v-else></div>

          <!-- 右侧：挂载与取消 -->
          <div class="flex items-center space-x-3">
            <span class="text-xs font-bold text-slate-300">
              已选 <span class="text-studio-cyan font-mono text-sm font-extrabold">{{ selectedModalFids.length }}</span> / 10 件
            </span>
            <button
              @click="showAssetSelector = false"
              class="px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-studio-850 text-xs font-bold cursor-pointer transition-all"
            >
              取消
            </button>
            <button
              @click="confirmMountSelected"
              :disabled="selectedModalFids.length === 0"
              class="px-5 py-2 rounded-xl bg-gradient-to-r from-studio-accent to-studio-cyan hover:brightness-110 text-white text-xs font-extrabold shadow-lg shadow-studio-accent/25 transition-all disabled:opacity-40 cursor-pointer flex items-center space-x-1.5"
            >
              <span>确认挂载 (@引用已选 {{ selectedModalFids.length }} 件)</span>
              <span>➔</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ========================================================================= -->
    <!-- 4. 高清媒体预览灯箱 (Media Lightbox Modal: 大图缩放与视频播放) -->
    <!-- ========================================================================= -->
    <div
      v-if="previewModal.visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
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
            <button @click="closeMediaPreview" class="w-7 h-7 rounded-lg bg-studio-800 hover:bg-rose-600 text-slate-200 hover:text-white flex items-center justify-center font-bold cursor-pointer transition-all ml-1">
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
        </div>
      </div>
    </div>

    <!-- 4. 模态弹窗：创作库详情与存入弹窗 -->
    <div v-if="saveModal.visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div class="w-full max-w-md rounded-2xl bg-studio-900 border border-studio-750 p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-studio-800">
          <span class="text-sm font-bold text-white flex items-center gap-2">
            <span>⭐</span>
            <span>存入创作库</span>
          </span>
          <button @click="saveModal.visible = false" class="text-slate-400 hover:text-white cursor-pointer">✕</button>
        </div>

        <p class="text-xs text-slate-400">对话历史会自动保留这一轮。创作库只保存你点名要留下的结果。</p>
        <div class="space-y-3 text-xs">
          <div>
            <label class="text-slate-300 font-bold block mb-1">标题：</label>
            <input v-model="saveModal.title" class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white outline-none font-bold" placeholder="例如：法式复古客厅重塑" />
          </div>

          <div>
            <label class="text-slate-300 font-bold block mb-1">提示词内容：</label>
            <textarea v-model="saveModal.prompt" rows="3" class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-slate-200 outline-none"></textarea>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-2 border-t border-studio-800">
          <button @click="saveModal.visible = false" class="px-4 py-1.5 rounded-lg text-slate-400 hover:text-white text-xs cursor-pointer">取消</button>
          <button @click="submitSaveToLibrary" :disabled="savingTpl" class="px-4 py-1.5 rounded-lg bg-studio-accent text-white font-bold text-xs shadow hover:brightness-110 cursor-pointer">
            {{ savingTpl ? '保存中...' : '确认存入' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 5. 模态弹窗：配方详情与复用 -->
    <div v-if="detailModal.visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div class="w-full max-w-2xl rounded-2xl bg-studio-900 border border-studio-750 p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-studio-800">
          <span class="text-sm font-bold text-white flex items-center gap-2">
            <span>📖</span>
            <span>创作配方详情 · {{ detailModal.tpl.title }}</span>
          </span>
          <button @click="detailModal.visible = false" class="text-slate-400 hover:text-white cursor-pointer">✕</button>
        </div>

        <div class="space-y-4 text-xs">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <span class="text-[10px] text-slate-400 font-mono font-bold">参考原图 (Origin):</span>
              <div class="aspect-[16/10] rounded-xl overflow-hidden bg-studio-950 border border-studio-800 flex items-center justify-center text-slate-500">
                <img v-if="detailModal.tpl.origin_images?.[0]?.url" :src="detailModal.tpl.origin_images[0].url" class="w-full h-full object-cover" />
                <span v-else>无参考图</span>
              </div>
            </div>
            <div class="space-y-1">
              <span class="text-[10px] text-studio-cyan font-mono font-bold">最终目标图 (Render Result):</span>
              <div class="aspect-[16/10] rounded-xl overflow-hidden bg-studio-950 border border-studio-accent/40 flex items-center justify-center text-slate-500">
                <img v-if="detailModal.tpl.result_images?.[0]?.url" :src="detailModal.tpl.result_images[0].url" class="w-full h-full object-cover" />
                <span v-else>无渲染图</span>
              </div>
            </div>
          </div>

          <div>
            <span class="text-[11px] text-slate-400 block mb-1 font-bold">使用的提示词：</span>
            <div class="p-3 rounded-lg bg-studio-950 border border-studio-800 text-slate-200 leading-relaxed font-medium">
              {{ detailModal.tpl.prompt }}
            </div>
            <p v-if="recipeIsLegacy(detailModal.tpl)" class="mt-2 text-xs text-slate-300">旧配方，模型未记录。复用时使用 Agnes Image 2.5 Flash。</p>
          </div>
        </div>

        <div class="flex items-center justify-between pt-3 border-t border-studio-800">
          <button @click="deleteTemplate(detailModal.tpl.id)" class="text-rose-400 hover:underline text-xs cursor-pointer">删除此配方</button>
          <div class="flex items-center space-x-2">
            <button @click="detailModal.visible = false" class="px-4 py-1.5 rounded-lg text-slate-400 hover:text-white text-xs cursor-pointer">关闭</button>
            <button @click="applyTemplateFromDetail" class="px-5 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold shadow hover:brightness-110 cursor-pointer">
              复用此配方开始创作
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="retryDialog.visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div class="w-full max-w-md rounded-2xl bg-studio-900 border border-studio-700 p-5 space-y-4">
        <p class="text-sm font-bold text-white">按刚才的提示词、参考图和模型再提交一次。</p>
        <div class="flex gap-2">
          <button type="button" class="flex-1 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" @click="confirmDirectRetry">直接重试</button>
          <button type="button" class="flex-1 py-2 rounded-lg border border-studio-700 text-xs font-bold cursor-pointer" @click="editFromRetryDialog">改为编辑</button>
        </div>
      </div>
    </div>
    <div v-if="retryNotice" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div class="w-full max-w-md rounded-2xl bg-studio-900 border border-studio-700 p-5 space-y-4">
        <p class="text-sm text-slate-100">已重新提交。视频队列满时可能还会失败，可以稍后再试。</p>
        <button type="button" class="w-full py-2 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer" @click="retryNotice = false">知道了</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';
import {
  getAssetImageUrl,
  fetchAssets,
  authFetch,
  generateAiImage,
  generateAiVideo,
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
const optimizing = ref(false);
const showHashMenu = ref(false);
const showAssetSelector = ref(false);
const selectorTab = ref('library');
const localFileInput = ref(null);
const richEditorRef = ref(null);
const messageScroller = ref(null);
const sessionRefPool = ref([]);
const selectedModalItems = ref({});
const selectorShelf = ref('original');
const selectorColor = ref('');
const selectorColors = ref([]);
const sourcePlates = [
  { key: 'original', label: '原素材' },
  { key: 'retouched', label: '精修素材' },
  { key: 'finished', label: '成品素材' }
];
const pickerOpen = ref({ ratio: true, space: true, style: false, material: false, color: false });
const libraryLoading = ref(false);

// 核心底栏 4 模态：'chat' (纯对话) | 'image' (图片生成) | 'video' (视频生成) | 'music' (音乐生成)
const activeModality = ref('chat'); // 默认纯对话！

// 纯对话专属状态
const chatModelKey = ref('volc_doubao_seed_2_1_pro');
const deepThinkingEnabled = ref(true);

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
const activeGenMode = ref('');
const schemaParams = ref({});
const showAdvanced = ref(false);
const oldRecipeNote = ref(false);
const composerError = ref('');
const retryDialog = ref({ visible: false, msg: null });
const retryNotice = ref(false);
const QWEN_SCHEMA = {
  modes: [{ id: 'text_to_image', label: '文生图' }],
  common: [],
  advanced: [],
  slots: { images: 10 },
  free: null
};
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
  if (key === 'qwenimage_local') return QWEN_SCHEMA;
  return null;
});
const sessionUploads = computed(() => sessionRefPool.value.filter((item) => item.origin !== 'generated'));
const sessionGenerated = computed(() => sessionRefPool.value.filter((item) => item.origin === 'generated'));
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
  return true;
}
function lockedKeySet() {
  const constraint = currentSchema.value?.modeConstraints?.[activeGenMode.value];
  return new Set(constraint?.lock || []);
}
function isFieldLocked(key) {
  return lockedKeySet().has(key);
}
function applyModeLocks() {
  const constraint = currentSchema.value?.modeConstraints?.[activeGenMode.value];
  if (constraint?.set) schemaParams.value = { ...schemaParams.value, ...constraint.set };
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
function refCap() {
  const schema = currentSchema.value;
  if (!schema) return 10;
  const slots = Number(schema.slots?.images ?? 10);
  const free = schema.free?.maxRefs;
  let cap = free != null ? Math.min(slots, Number(free)) : slots;
  if (activeGenMode.value === 'first_last_frame') cap = Math.min(cap, 2);
  if (activeGenMode.value === 'image_edit' || activeGenMode.value === 'expand_fill') cap = Math.min(cap, 1);
  return cap;
}
function modeRefError(count) {
  const cap = refCap();
  const mode = activeGenMode.value;
  if (count > cap) return `当前 ${count} 张，这个模型最多 ${cap} 张`;
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

// 模态弹窗状态
const saveModal = ref({ visible: false, title: '', prompt: '', msg: null });
const detailModal = ref({ visible: false, tpl: {} });
const savingTpl = ref(false);

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

// 真实私有素材库 DAM 资产池
const libraryItems = ref([]);

// 媒体大图/视频预览弹窗
const previewModal = ref({
  visible: false,
  url: '',
  type: 'image', // 'image' | 'video'
  title: '',
  scale: 1.0
});

// 私有素材库选择器状态 (多选、全量分页与多维筛选)
const selectorMain = ref('image');
const selectorSub = ref('interior_exterior');
const selectorOnlyFav = ref(false);
const selectorOrientation = ref('');
const selectorSpace = ref('');
const selectorStyle = ref('');
const selectorMaterial = ref('');
const selectorSpaces = ref([]);
const selectorStyles = ref([]);
const selectorMaterials = ref([]);
const selectorKeyword = ref('');
const selectorPage = ref(1);
const selectorPageSize = 60;
const selectorTotal = ref(0);
const selectedModalFids = ref([]);

const selectorMains = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' }
];
const selectorSubMap = {
  image: [
    { key: 'all', label: '全部图片' },
    { key: 'interior_exterior', label: '室内外设计' },
    { key: 'portrait', label: '空间人像' },
    { key: 'clothing', label: '服装服饰' },
    { key: 'furniture', label: '单品家具' }
  ],
  video: [
    { key: 'all', label: '全部视频' },
    { key: 'walkthrough', label: '空间漫游' },
    { key: 'ad', label: '商业短片' }
  ],
  audio: [
    { key: 'all', label: '全部音频' },
    { key: 'bgm', label: '氛围背景乐' },
    { key: 'sfx', label: '环境音效' }
  ]
};
const selectorSubs = computed(() => selectorSubMap[selectorMain.value] || []);
const selectorOrientations = [
  { key: 'portrait', label: '9:16 竖图' },
  { key: '3:4', label: '3:4 竖图' },
  { key: 'landscape', label: '16:9 横图' },
  { key: 'square', label: '1:1 方图' }
];

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
  if (!tplSearch.value.trim()) return templates.value;
  const q = tplSearch.value.toLowerCase();
  return templates.value.filter(t => t.title.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q));
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
  await loadTemplates();
  await loadDamAssets();
  await loadSessions();
});

// 加载真实素材库 DAM 资产 (支持全量检索、品类过滤与分页)
async function loadDamAssets(page = 1) {
  libraryLoading.value = true;
  selectorPage.value = page;
  try {
    const params = {
      page,
      limit: selectorPageSize,
      pageSize: selectorPageSize
    };
    if (selectorMain.value === 'video') {
      params.media_type = 'video';
      if (selectorSub.value === 'walkthrough') params.category = 'video';
      if (selectorSub.value === 'ad') params.category = 'finished';
    } else if (selectorMain.value === 'audio') {
      params.media_type = 'music';
      params.category = 'music';
    } else {
      params.media_type = 'image';
      if (selectorSub.value !== 'all') params.category = selectorSub.value;
    }
    if (selectorShelf.value) params.shelf = selectorShelf.value;
    if (selectorOnlyFav.value) params.only_favorite = 1;
    if (selectorOrientation.value) params.orientation = selectorOrientation.value;
    if (selectorColor.value) params.color = selectorColor.value;
    if (selectorSpace.value) params.space = selectorSpace.value;
    if (selectorStyle.value) params.style = selectorStyle.value;
    if (selectorMaterial.value) params.material = selectorMaterial.value;
    if (selectorKeyword.value.trim()) {
      params.keyword = selectorKeyword.value.trim();
    }
    const data = await fetchAssets(params);
    const items = data.items || [];
    selectorTotal.value = data.total || items.length;
    const opts = data.filterOptions || {};
    if (Array.isArray(opts.space)) selectorSpaces.value = opts.space;
    if (Array.isArray(opts.style_atom)) selectorStyles.value = opts.style_atom;
    if (Array.isArray(opts.material_kind)) selectorMaterials.value = opts.material_kind.slice(0, 8);
    if (Array.isArray(opts.colors)) selectorColors.value = opts.colors.slice(0, 12);
    libraryItems.value = items.map(it => {
      const imgUrl = getAssetImageUrl(it.fid, it.mediaToken);
      return {
        id: it.fid,
        fid: it.fid,
        mediaToken: it.mediaToken,
        name: it.file_name || it.fileName || it.name || '素材资产',
        url: imgUrl,
        category: it.category,
        kind: it.kind || it.media_type || 'image'
      };
    });
  } catch (e) {
    console.warn('加载素材库资产失败:', e);
  } finally {
    libraryLoading.value = false;
  }
}

function setSelectorMain(key) {
  selectorMain.value = key;
  selectorSub.value = key === 'image' ? 'interior_exterior' : 'all';
  selectorSpace.value = '';
  selectorStyle.value = '';
  selectorMaterial.value = '';
  loadDamAssets(1);
}
function setSelectorSub(key) {
  selectorSub.value = key;
  loadDamAssets(1);
}
function toggleSelectorFav() {
  selectorOnlyFav.value = !selectorOnlyFav.value;
  loadDamAssets(1);
}
function toggleSelectorOrientation(key) {
  selectorOrientation.value = selectorOrientation.value === key ? '' : key;
  loadDamAssets(1);
}
function toggleSelectorSpace(dir) {
  selectorSpace.value = selectorSpace.value === dir ? '' : dir;
  loadDamAssets(1);
}
function toggleSelectorStyle(dir) {
  selectorStyle.value = selectorStyle.value === dir ? '' : dir;
  loadDamAssets(1);
}
function toggleSelectorMaterial(dir) {
  selectorMaterial.value = selectorMaterial.value === dir ? '' : dir;
  loadDamAssets(1);
}
function toggleSelectorColor(dir) {
  selectorColor.value = selectorColor.value === dir ? '' : dir;
  loadDamAssets(1);
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
  const re = /@(?:图|图片)(\d+)\[([^\]]+)\]/g;
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
async function scrollMessagesToEnd() {
  await nextTick();
  const el = messageScroller.value;
  if (el) el.scrollTop = el.scrollHeight;
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
  } else {
    return '描述想要的音乐情绪、空间白噪音或影视级配乐风格...';
  }
}

function getSendButtonText() {
  if (activeModality.value === 'chat') return '发送提问';
  if (activeModality.value === 'image') return '立即生图';
  if (activeModality.value === 'video') return '立即生视频';
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
    if (next.some((item) => item.url === url)) return;
    next.push({
      name: chip.getAttribute('data-name') || labelForRef(url, ''),
      url,
      fid: chip.getAttribute('data-fid') || '',
      kind: chip.getAttribute('data-kind') || 'image',
      origin: chip.getAttribute('data-origin') || 'upload',
      weight: 85,
      tag: `@图${next.length + 1}`
    });
    chip.setAttribute('data-tag', `@图${next.length}`);
  });
  referenceTray.value = next;
}
function editorHasRawMention() {
  if (!richEditorRef.value) return false;
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return /@(?:图|图片)\d+\[[^\]]+\]/.test(node.nodeValue || '');
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
  if (!reparsingEditor && editorHasRawMention()) reparseEditorChips([]);
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

function restorePromptContent(text, tray) {
  referenceTray.value = Array.isArray(tray) ? JSON.parse(JSON.stringify(tray)) : [];
  if (!richEditorRef.value) return;
  richEditorRef.value.innerHTML = '';
  if (!text) return;

  const regex = /(@(?:图|图片)(\d+))\[([^\]]+)\]/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      appendRichSegmentText(text.slice(lastIdx, match.index));
    }
    const num = parseInt(match[2], 10);
    const matchedAsset = referenceTray.value[num - 1] || { name: match[3], url: '', tag: match[1], resolved: false };
    insertChipToEditor(matchedAsset);
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    appendRichSegmentText(text.slice(lastIdx));
  } else if (lastIdx === 0) {
    appendRichSegmentText(text);
  }
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

function parseRichSegments(content) {
  if (!content) return [];
  const segments = [];
  const regex = /(@(?:图|图片)(\d+))\[([^\]]+)\]/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', text: content.slice(lastIdx, match.index) });
    }
    const tag = match[1];
    const num = parseInt(match[2], 10);
    const name = match[3];
    const matchedAsset = referenceTray.value[num - 1] || referenceTray.value[0];
    const thumb = matchedAsset && matchedAsset.url && matchedAsset.url !== '/favicon.ico' ? matchedAsset.url : '';

    segments.push({
      type: 'chip',
      tag,
      name,
      thumb
    });
    lastIdx = regex.lastIndex;
  }

  if (lastIdx < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIdx) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', text: content }];
}

async function loadTemplates() {
  try {
    const res = await authFetch('/api/creation-templates');
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      templates.value = json.data;
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
          content: m.prompt || (m.result ? m.result.content : ''),
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
  scrollMessagesToEnd();
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
  saveModal.value = {
    visible: true,
    title: '自定义空间美学配方',
    prompt: getRawEditorText(),
    msg: null
  };
}

function openTemplateDetail(tpl) {
  detailModal.value = { visible: true, tpl };
}

function applyTemplateFromDetail() {
  const tpl = detailModal.value.tpl || {};
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
  const mode = params.genMode || params.mode;
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
    const next = { ...schemaParams.value };
    for (const [key, value] of Object.entries(params.schemaParams)) {
      if (valueStillFits(schema, key, value) || fieldByKey(schema, key)) next[key] = value;
    }
    schemaParams.value = next;
    applyModeLocks();
  }
  if (params.ratio) selectedRatio.value = params.ratio;
  else if (tpl.aspect_ratio) selectedRatio.value = tpl.aspect_ratio;
  if (params.resolution) selectedResolution.value = params.resolution;
  restorePromptContent(tpl.prompt || '', prepared);
  syncTrayFromEditor();
  rememberSessionRefs(referenceTray.value, 'upload');
  detailModal.value.visible = false;
}

function selectHashTemplate(tpl) {
  showHashMenu.value = false;
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
  selectedModalFids.value = [];
  loadDamAssets(1);
}

function selectFromLibrary(item) {
  const idx = referenceTray.value.length + 1;
  const asset = { name: item.name, url: item.url, weight: 85, tag: `@图${idx}`, fid: item.fid, kind: item.kind };
  referenceTray.value.push(asset);
  insertChipToEditor(asset);
  showAssetSelector.value = false;
}

// 模态选择器多选与勾选
function toggleSelectAsset(item) {
  const fid = item.fid || item.url;
  if (!fid) return;
  const idx = selectedModalFids.value.indexOf(fid);
  if (idx >= 0) {
    selectedModalFids.value.splice(idx, 1);
    delete selectedModalItems.value[fid];
  } else {
    if (selectedModalFids.value.length >= 10) {
      alert('最多同时选择 10 件参考素材');
      return;
    }
    selectedModalFids.value.push(fid);
    selectedModalItems.value[fid] = item;
  }
}

function selectAllCurrentPage() {
  const currentFids = libraryItems.value.map(it => it.fid);
  for (const fid of currentFids) {
    if (!selectedModalFids.value.includes(fid)) {
      if (selectedModalFids.value.length >= 10) break;
      selectedModalFids.value.push(fid);
    }
  }
}

function clearModalSelection() {
  selectedModalFids.value = [];
  selectedModalItems.value = {};
}

function confirmMountSelected() {
  if (selectedModalFids.value.length === 0) return;
  for (const fid of selectedModalFids.value) {
    const item = selectedModalItems.value[fid] || libraryItems.value.find(it => it.fid === fid);
    if (!item) continue;
    const idx = referenceTray.value.length + 1;
    const asset = {
      name: item.name,
      url: item.url,
      weight: 85,
      tag: `@图${idx}`,
      fid: item.fid,
      kind: item.kind
    };
    referenceTray.value.push(asset);
    rememberSessionRefs([asset]);
    insertChipToEditor(asset);
  }
  selectedModalFids.value = [];
  selectedModalItems.value = {};
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
  } else if (itemOrUrl && typeof itemOrUrl === 'object') {
    url = itemOrUrl.url || itemOrUrl.imageUrl || itemOrUrl.videoUrl || '';
    title = itemOrUrl.name || itemOrUrl.file_name || itemOrUrl.title || '素材预览';
    if (itemOrUrl.kind === 'video' || itemOrUrl.media_type === 'video' || itemOrUrl.videoUrl) {
      type = 'video';
    }
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

function triggerLocalFileInput() {
  localFileInput.value?.click();
}

function onLocalFileSelected(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const name = f.name.replace(/\.[^.]+$/, '');
  const url = URL.createObjectURL(f);
  const idx = referenceTray.value.length + 1;
  const asset = { name, url, weight: 85, tag: `@图${idx}` };
  referenceTray.value.push(asset);
  insertChipToEditor(asset);
  showAssetSelector.value = false;
}

function removeRef(idx) {
  referenceTray.value.splice(idx, 1);
  referenceTray.value.forEach((r, i) => {
    r.tag = `@图${i + 1}`;
  });
}

// 优化提示词
async function optimizePrompt() {
  const rawText = getRawEditorText();
  if (!rawText) return;
  optimizing.value = true;
  try {
    const res = await authFetch('/api/chat/optimize-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: rawText,
        modelId: activeModality.value === 'image' ? imageModelKey.value : (activeModality.value === 'video' ? videoModelKey.value : chatModelKey.value),
        mode: activeModality.value === 'video' ? 'text_to_video' : 'interior_design',
        imageUrls: referenceTray.value.map(r => r.url)
      })
    });
    const json = await res.json();
    const resultText = json.optimized || json.data?.optimized;
    if (resultText && richEditorRef.value) {
      richEditorRef.value.innerHTML = '';
      appendRichSegmentText(resultText);
    }
  } catch (e) {
    if (richEditorRef.value) {
      const extraHint = activeModality.value === 'video'
        ? '，慢动作推镜，柔和自然采光，影视级画面'
        : '，大师级室内摄影，高细节自然采光';
      appendRichSegmentText(extraHint);
    }
  } finally {
    optimizing.value = false;
  }
}

function getModelDisplayName(key) {
  const map = {
    volc_doubao_seed_2_1_pro: 'Doubao-Seed-2.1-pro (火山方舟)',
    volc_doubao_seed_2_1_turbo: 'Doubao-Seed-2.1-turbo',
    volc_doubao_seed_2_1_lite: 'Doubao-Seed-2.1-lite',
    gemini_flash_latest: 'Gemini 2.5 Flash',
    gemini_flash_lite_latest: 'Gemini Flash-Lite',
    agnes3_0flash: 'Agnes 3.0 Flash',
    litellm_doubao_seed_2_1_pro: 'Doubao-Seed-2.1-pro (LiteLLM)',
    seedream5flash: 'Seedream 5.0 Flash',
    seedream5pro: 'Seedream 5.0 Pro',
    seedream5lite: 'Seedream 5.0 Lite',
    agnes_image_2_5_flash: 'Agnes Image 2.5 Flash',
    qwenimage_local: 'Qwen2.1-Image (本地)',
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
  const currentTray = JSON.parse(JSON.stringify(referenceTray.value));
  if (currentMod !== 'chat') {
    const refError = modeRefError(currentTray.length);
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
    modality: currentMod
  });

  if (richEditorRef.value) {
    richEditorRef.value.innerHTML = '';
  }
  referenceTray.value = [];
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
      const historyContext = messages.value
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await generateAiChat({
        model: chatModelKey.value,
        messages: historyContext,
        prompt: rawContent
      });

      const replyText = res.choices?.[0]?.message?.content || res.reply || res.text || res.data?.reply || '已完成空间需求分析。';
      const asstMsg = {
        role: 'assistant',
        modality: 'chat',
        content: replyText,
        model: getModelDisplayName(chatModelKey.value)
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
      const imageUrls = currentTray.map(r => r.url);
      const res = await generateAiImage({
        prompt: rawContent,
        model: imageModelKey.value,
        size: retryParams.size || retryParams.resolution || selectedResolution.value,
        ratio: retryParams.ratio || selectedRatio.value,
        imageUrls,
        genMode: retryMode,
        extras: retryParams
      });

      const genUrl = res.files?.[0]?.previewUrl || res.files?.[0]?.url || res.imageUrl || res.url || res.data?.imageUrl || (res.files?.[0]?.localPath ? `/api/cache/temp/${res.files[0].localPath.split('/').pop()}` : '');
      if (!genUrl) {
        throw new Error(res.error || '未获取到生成的图片地址');
      }

      const asstMsg = {
        role: 'assistant',
        modality: 'image',
        content: `已为您完成空间视效生成。家具材质光泽与参考项深度统一，光影自然，画质达到 ${selectedResolution.value}。`,
        userPrompt: rawContent,
        refs: currentTray,
        imageUrl: genUrl,
        duration: res.duration ? `${res.duration}s` : '2.8s',
        resolution: selectedResolution.value,
        ratio: selectedRatio.value,
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
          ratio: selectedRatio.value,
          resolution: selectedResolution.value,
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
      const imageUrls = currentTray.map(r => r.url);
      const res = await generateAiVideo({
        prompt: rawContent,
        model: videoModelKey.value,
        duration: retryParams.duration != null ? retryParams.duration : videoDuration.value,
        resolution: retryParams.resolution || retryParams.size || videoResolution.value,
        ratio: retryParams.ratio,
        camera: videoCameraMove.value,
        imageUrls,
        genMode: retryMode,
        extras: retryParams,
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
        duration: `${videoDuration.value === '-1' ? '8' : videoDuration.value}s`,
        resolution: videoResolution.value,
        model: getModelDisplayName(videoModelKey.value),
        camera: videoCameraMove.value
      };
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
      const asstMsg = {
        role: 'assistant',
        modality: 'music',
        content: `空间配乐渲染完成。根据空间材质调性生成环境音效，已同步加载。`,
        audioTitle: 'Nordic Morning Ambient · 320kbps',
        duration: `${musicDuration.value}s`,
        audioUrl: '/sample-video.mp4',
        model: getModelDisplayName(musicType.value)
      };
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
    scrollMessagesToEnd();
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
  if (msg.retryParams) schemaParams.value = { ...schemaParams.value, ...msg.retryParams };
  restorePromptContent(prompt, refs);
  syncTrayFromEditor();
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
  saveModal.value = {
    visible: true,
    title: prompt.replace(/\s+/g, ' ').trim().slice(0, 24) || '未命名创作',
    prompt,
    msg
  };
}

async function submitSaveToLibrary() {
  if (!saveModal.value.title.trim()) return;
  savingTpl.value = true;
  try {
    const res = await authFetch('/api/creation-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: saveModal.value.title,
        prompt: saveModal.value.prompt,
        aspect_ratio: saveModal.value.msg?.ratio || selectedRatio.value,
        origin_images: saveModal.value.msg?.refs || referenceTray.value,
        result_images: [{
          url: saveModal.value.msg?.imageUrl || saveModal.value.msg?.videoUrl || '',
          resolution: saveModal.value.msg?.resolution || selectedResolution.value
        }],
        params: {
          model: saveModal.value.msg?.model,
          modelKey: saveModal.value.msg?.modelKey,
          genMode: saveModal.value.msg?.genMode || saveModal.value.msg?.modality,
          mode: saveModal.value.msg?.genMode || saveModal.value.msg?.modality,
          ratio: saveModal.value.msg?.ratio || selectedRatio.value,
          resolution: saveModal.value.msg?.resolution || selectedResolution.value
        },
        tags: [saveModal.value.msg?.genMode || activeModality.value, '收藏配方']
      })
    });
    const json = await res.json();
    if (json.success) {
      saveModal.value.visible = false;
      loadTemplates();
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
  await authFetch(`/api/creation-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
  detailModal.value.visible = false;
  loadTemplates();
}

function triggerPrecisionEdit(msg) {
  emit('sendToPrecisionEdit', msg.imageUrl);
}

function sendVideoToClip(msg) {
  emit('sendToClip', msg);
}

function captureFrameFromVideo(msg) {
  alert('已从当前视频时间点截取关键帧，已就绪可作为生图参考图使用！');
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
</style>
