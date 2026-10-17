<template>
  <div class="flex-1 flex flex-col h-[calc(100vh-56px)] bg-studio-950 overflow-hidden text-slate-100 select-none font-sans">
    <!-- 1. OpenCut 专业顶部工程栏 -->
    <header class="h-11 bg-studio-900 border-b border-studio-750/80 px-4 flex items-center justify-between shrink-0">
      <div class="flex items-center space-x-3">
        <div class="flex items-center space-x-1.5 text-xs font-bold text-white">
          <span class="w-2.5 h-2.5 rounded-full bg-studio-rose animate-pulse"></span>
          <span class="text-sm font-extrabold tracking-tight">OpenCut 多轨非编工作台</span>
          <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-studio-800 text-studio-cyan border border-studio-700">
            v2.6 引擎
          </span>
        </div>

        <div class="h-4 w-px bg-studio-750"></div>

        <!-- 当前工程名 -->
        <div class="flex items-center space-x-1 text-xs text-slate-300">
          <span class="text-slate-400">工程:</span>
          <input
            v-model="projectName"
            class="bg-transparent border-b border-dashed border-studio-700 hover:border-studio-accent px-1 text-xs text-white outline-none font-medium"
          />
        </div>
      </div>

      <!-- 中间播放时间码与画幅 -->
      <div class="flex items-center space-x-3">
        <div class="bg-studio-950 border border-studio-750 px-3 py-1 rounded-md font-mono text-xs text-studio-cyan font-bold tracking-wider">
          {{ formatTimecode(currentTime) }} / {{ formatTimecode(totalDuration) }}
        </div>

        <!-- 画幅比例快速切换 -->
        <div class="flex items-center bg-studio-950 rounded-lg border border-studio-750 p-0.5 text-[11px]">
          <button
            @click="aspectRatio = '16:9'"
            :class="['px-2 py-0.5 rounded transition-all cursor-pointer', aspectRatio === '16:9' ? 'bg-studio-accent text-white font-bold' : 'text-slate-400 hover:text-white']"
          >
            16:9 横屏
          </button>
          <button
            @click="aspectRatio = '9:16'"
            :class="['px-2 py-0.5 rounded transition-all cursor-pointer', aspectRatio === '9:16' ? 'bg-studio-accent text-white font-bold' : 'text-slate-400 hover:text-white']"
          >
            9:16 竖屏
          </button>
          <button
            @click="aspectRatio = '1:1'"
            :class="['px-2 py-0.5 rounded transition-all cursor-pointer', aspectRatio === '1:1' ? 'bg-studio-accent text-white font-bold' : 'text-slate-400 hover:text-white']"
          >
            1:1 方幅
          </button>
        </div>
      </div>

      <!-- 右侧动作与渲染导出 -->
      <div class="flex items-center space-x-2">
        <button
          @click="undo"
          class="px-2.5 py-1.5 rounded hover:bg-studio-800 text-slate-200 text-xs font-bold cursor-pointer"
          title="撤销上一次拖动或剪切"
        >
          撤销
        </button>

        <div class="h-4 w-px bg-studio-750"></div>

        <button
          @click="openExportModal"
          class="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-studio-accent to-studio-cyan hover:brightness-110 text-white text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-studio-accent/25 transition-all cursor-pointer"
        >
          <StudioIcon name="download" :size="13" />
          <span>导出视频</span>
        </button>
      </div>
    </header>

    <!-- 2. 工作区上半部：左侧OpenCut资源库 + 中央监视器 + 右侧检查器 -->
    <div class="flex-1 flex overflow-hidden border-b border-studio-750/80 min-h-[340px]">
      <!-- 2.1 左侧多源资产侧栏 (320px) -->
      <aside class="w-80 bg-studio-900 border-r border-studio-750/80 flex flex-col shrink-0">
        <!-- 侧栏模式选项卡 -->
        <div class="h-10 bg-studio-950 border-b border-studio-800 flex items-center px-2 gap-1 shrink-0 overflow-x-auto">
          <button
            v-for="tab in assetTabs"
            :key="tab.key"
            @click="activeAssetTab = tab.key"
            :class="[
              'px-2.5 py-1 rounded text-xs font-medium transition-all shrink-0 whitespace-nowrap cursor-pointer',
              activeAssetTab === tab.key
                ? 'bg-studio-accent text-white font-bold shadow'
                : 'text-slate-400 hover:text-slate-200'
            ]"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- 素材库面板 (工程池 + 本地导入) -->
        <div v-if="activeAssetTab === 'media'" class="flex-1 p-3 overflow-y-auto space-y-3 scrollbar-thin">
          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-300 font-bold">工程素材池 ({{ projectMedia.length }})</span>
            <button
              @click="triggerImport"
              class="px-2.5 py-1 rounded-lg bg-studio-accent text-white text-[11px] font-bold shadow hover:brightness-110 cursor-pointer"
            >
              + 导入本地
            </button>
            <input ref="fileInput" type="file" multiple accept="video/*,audio/*,image/*" class="hidden" @change="onFilesImported" />
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="item in projectMedia"
              :key="item.id"
              @click="addToTrack(item)"
              class="group relative rounded-xl overflow-hidden border border-studio-750 hover:border-studio-accent bg-studio-950 aspect-[16/10] cursor-pointer transition-all shadow"
            >
              <img :src="item.thumb" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-1.5">
                <span class="text-[11px] font-medium text-slate-100 truncate">{{ item.name }}</span>
                <span class="text-[9px] text-studio-cyan font-mono">{{ item.durationStr }}</span>
              </div>
              <div class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-studio-accent text-white px-1.5 py-0.5 rounded text-[10px] font-bold">
                点击上轨
              </div>
            </div>
          </div>
        </div>

        <!-- 转场特效面板 -->
        <div v-else-if="activeAssetTab === 'transitions'" class="flex-1 p-3 overflow-y-auto space-y-2 scrollbar-thin">
          <p class="text-sm text-slate-200 leading-relaxed">转场这一轮还不能用。</p>
        </div>

        <!-- 字幕花字面板 -->
        <div v-else-if="activeAssetTab === 'text'" class="flex-1 p-3 overflow-y-auto space-y-2 scrollbar-thin">
          <span class="text-xs text-slate-300 font-bold block mb-1">花字预设与自动字幕</span>
          <button
            @click="addSubtitleTrack"
            class="w-full py-2 rounded-xl bg-studio-accent hover:brightness-110 text-white text-xs font-bold flex items-center justify-center space-x-1 mb-2 shadow cursor-pointer"
          >
            <span>+ 新增独立字幕图层</span>
          </button>
          <div class="space-y-1.5">
            <div
              v-for="txt in textPresets"
              :key="txt.name"
              @click="insertTextPreset(txt)"
              class="p-2 rounded-xl bg-studio-950 border border-studio-750 hover:border-studio-accent cursor-pointer flex items-center justify-between text-xs"
            >
              <span class="font-bold" :style="{ color: txt.color }">{{ txt.name }}</span>
              <span class="text-[10px] text-slate-400">点击应用</span>
            </div>
          </div>
        </div>

        <!-- 配乐音效面板 -->
        <div v-else-if="activeAssetTab === 'audio'" class="flex-1 p-3 overflow-y-auto space-y-2 scrollbar-thin">
          <span class="text-xs text-slate-300 font-bold block mb-1">商业配乐与环境白噪音</span>
          <div class="space-y-2">
            <div
              v-for="bgm in bgmPresets"
              :key="bgm.name"
              @click="addAudioTrack(bgm)"
              class="p-2.5 rounded-xl bg-studio-950 border border-studio-750 hover:border-studio-emerald cursor-pointer flex items-center justify-between text-xs transition-all"
            >
              <div>
                <div class="font-bold text-slate-200">🎵 {{ bgm.name }}</div>
                <div class="text-[10px] text-slate-400 font-mono">{{ bgm.duration }} · {{ bgm.genre }}</div>
              </div>
              <span class="text-[10px] text-emerald-400 font-bold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30">+ 加入A1轨</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- 2.2 中央 OpenCut 播放器监视器 (真实视频与图层渲染) -->
      <main class="flex-1 flex flex-col bg-studio-950 p-4 relative justify-between overflow-hidden">
        <!-- 播放器视口画布容器 -->
        <div class="flex-1 flex items-center justify-center relative overflow-hidden">
          <div
            :class="[
              'relative rounded-xl overflow-hidden shadow-2xl border border-studio-750 bg-black flex items-center justify-center transition-all',
              aspectRatio === '16:9' ? 'w-[640px] h-[360px]' : (aspectRatio === '9:16' ? 'w-[220px] h-[390px]' : 'w-[360px] h-[360px]')
            ]"
          >
            <!-- 真实原生视频流 -->
            <video
              v-if="currentVideoSource"
              ref="monitorVideoRef"
              :src="currentVideoSource"
              class="w-full h-full object-contain"
              playsinline
              preload="auto"
              @loadedmetadata="onMonitorLoaded"
              @timeupdate="onMonitorTimeUpdate"
              @ended="onMonitorEnded"
            ></video>
            <p v-else class="px-6 text-center text-sm text-slate-300">选中一条带真实文件的片段后，在这里播放。</p>

            <!-- 画中画 / 顶层图层渲染 (若 V2 轨有片段) -->
            <div
              v-if="activeOverlayClip"
              class="absolute pointer-events-none transition-all"
              :style="{
                width: `${activeOverlayClip.scale || 50}%`,
                left: `${activeOverlayClip.x || 60}%`,
                top: `${activeOverlayClip.y || 20}%`,
                opacity: (activeOverlayClip.opacity ?? 100) / 100,
                transform: `rotate(${activeOverlayClip.rotation || 0}deg)`
              }"
            >
              <img :src="activeOverlayClip.thumb" class="rounded-lg shadow-2xl border border-white/40 object-cover w-full" />
            </div>

            <!-- 字幕浮层动态渲染 -->
            <div
              v-if="activeSubtitle"
              class="absolute bottom-6 left-0 right-0 text-center px-4 pointer-events-none"
            >
              <span
                class="inline-block px-3 py-1 rounded bg-black/80 backdrop-blur-xs font-bold text-sm tracking-wide shadow-lg border border-white/20"
                :style="{ color: activeSubtitleColor }"
              >
                {{ activeSubtitle }}
              </span>
            </div>
          </div>
        </div>

        <!-- 播放控制台工具条 -->
        <div class="h-11 bg-studio-900 rounded-xl border border-studio-750 px-4 flex items-center justify-between shrink-0 shadow-lg mt-3">
          <!-- 左侧逐帧跳转 -->
          <div class="flex items-center space-x-1 text-slate-400">
            <button @click="stepPlayhead(-1)" class="p-1.5 rounded hover:bg-studio-800 hover:text-white cursor-pointer" title="上一帧 (←)">
              ⏮
            </button>
            <button @click="jumpPlayhead(-2)" class="p-1.5 rounded hover:bg-studio-800 hover:text-white cursor-pointer" title="快退 2 秒">
              ⏪
            </button>
          </div>

          <!-- 中央核心播放/暂停按钮 -->
          <div class="flex items-center space-x-3">
            <button
              @click="togglePlay"
              class="w-8 h-8 rounded-full bg-studio-accent hover:brightness-110 text-white flex items-center justify-center shadow-md shadow-studio-accent/30 transition-transform active:scale-95 cursor-pointer"
            >
              <StudioIcon :name="isPlaying ? 'pause' : 'play'" :size="16" />
            </button>
          </div>

          <!-- 右侧快进与单帧前进 -->
          <div class="flex items-center space-x-2 text-slate-400">
            <button @click="jumpPlayhead(2)" class="p-1.5 rounded hover:bg-studio-800 hover:text-white cursor-pointer" title="快进 2 秒">
              ⏩
            </button>
            <button @click="stepPlayhead(1)" class="p-1.5 rounded hover:bg-studio-800 hover:text-white cursor-pointer" title="下一帧 (→)">
              ⏭
            </button>
          </div>
        </div>
      </main>

      <!-- 2.3 右侧 OpenCut 属性检查器 (选中片段时联动) -->
      <aside v-if="selectedClip" class="w-72 bg-studio-900 border-l border-studio-750/80 p-3.5 space-y-4 shrink-0 overflow-y-auto scrollbar-thin">
        <div class="flex items-center justify-between pb-2 border-b border-studio-800">
          <span class="text-xs font-bold text-white flex items-center gap-1.5">
            <StudioIcon name="sliders" :size="14" class="text-studio-accent" />
            OpenCut 片段属性
          </span>
          <button @click="selectedClip = null" class="text-slate-400 hover:text-white cursor-pointer">
            <StudioIcon name="close" :size="12" />
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <!-- 名字与类型 -->
          <div>
            <label class="text-[11px] text-slate-400 block mb-1">片段名称</label>
            <input v-model="selectedClip.name" class="w-full bg-studio-950 border border-studio-750 rounded-lg p-1.5 text-slate-200 outline-none font-medium" />
          </div>

          <!-- 字幕专属文本编辑 -->
          <div v-if="selectedClip.type === 'text'">
            <label class="text-[11px] text-slate-400 block mb-1">字幕文本内容</label>
            <textarea
              v-model="selectedClip.text"
              rows="2"
              class="w-full bg-studio-950 border border-studio-750 rounded-lg p-1.5 text-white outline-none font-bold"
            ></textarea>
          </div>

          <!-- 缩放比例 -->
          <div v-if="selectedClip.type !== 'audio'">
            <div class="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>画面缩放比例:</span>
              <span class="font-mono text-studio-cyan">{{ (selectedClip.scale || 100) }}%</span>
            </div>
            <input type="range" min="30" max="200" v-model.number="selectedClip.scale" class="w-full accent-studio-accent cursor-pointer" />
          </div>

          <!-- 不透明度 -->
          <div v-if="selectedClip.type !== 'audio'">
            <div class="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>画面不透明度:</span>
              <span class="font-mono text-studio-cyan">{{ selectedClip.opacity ?? 100 }}%</span>
            </div>
            <input type="range" min="0" max="100" v-model.number="selectedClip.opacity" class="w-full accent-studio-accent cursor-pointer" />
          </div>

          <!-- 音频音量 -->
          <div>
            <div class="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>音量增益:</span>
              <span class="font-mono text-emerald-400">{{ selectedClip.volume ?? 100 }}%</span>
            </div>
            <input type="range" min="0" max="200" v-model.number="selectedClip.volume" class="w-full accent-emerald-500 cursor-pointer" />
          </div>

          <!-- 播放倍速 -->
          <div>
            <div class="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>播放倍速:</span>
              <span class="font-mono text-studio-accent">{{ selectedClip.speed || 1.0 }}x</span>
            </div>
            <div class="grid grid-cols-4 gap-1 text-[11px]">
              <button
                v-for="s in [0.5, 1.0, 1.5, 2.0]"
                :key="s"
                @click="selectedClip.speed = s"
                :class="['py-1 rounded-md border cursor-pointer', selectedClip.speed === s ? 'bg-studio-accent border-studio-accent text-white font-bold' : 'border-studio-750 bg-studio-950 text-slate-400']"
              >
                {{ s }}x
              </button>
            </div>
          </div>

          <!-- 删除片段 -->
          <div class="pt-2">
            <button
              @click="deleteSelectedClip"
              class="w-full py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 text-xs font-bold border border-rose-500/30 transition-all flex items-center justify-center space-x-1 cursor-pointer"
            >
              <StudioIcon name="trash" :size="13" />
              <span>从时间轴删除此片段 (Del)</span>
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 3. 工作区下半部：OpenCut 专业多轨时间轴 (交互式修剪、刀片切割、自由拖动排布) -->
    <div class="h-64 bg-studio-900 flex flex-col shrink-0 overflow-hidden">
      <!-- 3.1 时间轴工具栏 -->
      <div class="h-9 bg-studio-950 border-b border-studio-800 px-4 flex items-center justify-between text-xs shrink-0">
        <div class="flex items-center space-x-2 text-slate-300">
          <button
            @click="timelineTool = 'select'"
            :class="['px-2 py-0.5 rounded-lg flex items-center space-x-1 transition-all cursor-pointer', timelineTool === 'select' ? 'bg-studio-accent text-white font-bold' : 'text-slate-400 hover:text-white']"
            title="选择工具 (V)"
          >
            <span>↖</span>
            <span>选择 (V)</span>
          </button>

          <button
            @click="splitClipAtPlayhead"
            class="px-2 py-0.5 rounded-lg flex items-center space-x-1 text-slate-300 hover:text-white hover:bg-studio-800 transition-all cursor-pointer"
            title="在播放头位置执行 OpenCut 刀片切割 (C)"
          >
            <span>✂️</span>
            <span>刀片切割 (C)</span>
          </button>

          <button
            @click="deleteSelectedClip"
            class="px-2 py-0.5 rounded-lg flex items-center space-x-1 text-slate-400 hover:text-rose-400 hover:bg-studio-800 transition-all cursor-pointer"
            title="删除选中片段 (Del)"
          >
            <span>🗑️</span>
            <span>删除</span>
          </button>

          <div class="h-3 w-px bg-studio-750"></div>

          <label class="flex items-center space-x-1 text-slate-400 cursor-pointer text-[11px]">
            <input type="checkbox" v-model="snapEnabled" class="rounded accent-studio-accent" />
            <span>自动吸附 (S)</span>
          </label>
        </div>

        <!-- 时间轴缩放控制滑块 -->
        <div class="flex items-center space-x-2 text-slate-400 text-[11px]">
          <span>轴缩放:</span>
          <button @click="timelineZoom = Math.max(0.5, timelineZoom - 0.2)" class="px-1 hover:text-white cursor-pointer">-</button>
          <input type="range" min="0.5" max="3" step="0.1" v-model.number="timelineZoom" class="w-20 accent-studio-accent cursor-pointer" />
          <button @click="timelineZoom = Math.min(3, timelineZoom + 0.2)" class="px-1 hover:text-white cursor-pointer">+</button>
        </div>
      </div>

      <!-- 3.2 标尺与多轨道视口 (横向与纵向平滑滚动) -->
      <div
        ref="timelineScrollRef"
        class="flex-1 flex flex-col overflow-x-auto overflow-y-auto scrollbar-thin relative bg-studio-950"
      >
        <!-- 时间标尺与刻度 (点击标尺立即跳转播放头) -->
        <div
          @mousedown="onRulerMouseDown"
          class="h-6 bg-studio-900 border-b border-studio-800 flex items-center sticky top-0 z-20 shrink-0 cursor-pointer"
        >
          <!-- 左侧轨道头宽度对齐占位 (112px) -->
          <div class="w-28 shrink-0 bg-studio-900 border-r border-studio-800 text-[10px] text-slate-400 font-mono px-2 flex items-center font-bold">
            轨道图层
          </div>
          <!-- 刻度线 -->
          <div class="flex-1 flex relative h-full">
            <div
              v-for="tick in rulerTicks"
              :key="tick"
              class="absolute h-full border-l border-studio-800 text-[9px] text-slate-400 font-mono pl-1 pt-0.5 select-none"
              :style="{ left: `${tick * 40 * timelineZoom}px` }"
            >
              {{ tick }}s
            </div>
          </div>
        </div>

        <!-- 播放指示头 (Playhead 红色标尺线) -->
        <div
          class="absolute top-0 bottom-0 z-30 pointer-events-none flex flex-col items-center"
          :style="{ left: `${112 + currentTime * 40 * timelineZoom}px` }"
        >
          <div class="w-3 h-3 bg-rose-500 transform rotate-45 -mt-1 shadow-md pointer-events-auto cursor-ew-resize"></div>
          <div class="w-0.5 flex-1 bg-rose-500 shadow"></div>
        </div>

        <!-- 各专业轨道列表 -->
        <div class="flex-1 space-y-1.5 py-1.5">
          <!-- 轨道 1：T1 字幕轨 -->
          <div class="flex items-center h-8 relative">
            <div class="w-28 shrink-0 px-2 flex items-center justify-between text-[11px] font-mono text-slate-400 bg-studio-900/90 border-r border-studio-800 h-full z-10">
              <span class="text-amber-400 font-bold">T1 字幕</span>
              <span class="text-[9px] text-slate-500">Sub</span>
            </div>
            <div class="flex-1 h-full bg-studio-900/40 relative">
              <div
                v-for="sub in subtitleClips"
                :key="sub.id"
                @click.stop="selectClip(sub)"
                @mousedown.stop="onClipMouseDown($event, sub)"
                :class="[
                  'absolute top-1 bottom-1 rounded-md px-2 text-[10px] flex items-center justify-between truncate cursor-move transition-colors border group',
                  selectedClip?.id === sub.id ? 'bg-amber-500 text-black font-bold border-white ring-1 ring-white' : 'bg-amber-600/30 text-amber-200 border-amber-500/50 hover:bg-amber-600/50'
                ]"
                :style="{
                  left: `${sub.start * 40 * timelineZoom}px`,
                  width: `${sub.duration * 40 * timelineZoom}px`
                }"
              >
                <!-- 左修剪手柄 -->
                <div @mousedown.stop="onTrimMouseDown($event, sub, 'left')" class="absolute left-0 top-0 bottom-0 w-1.5 bg-white/30 hover:bg-white cursor-ew-resize"></div>
                <span class="truncate px-1.5">💬 {{ sub.text }}</span>
                <!-- 右修剪手柄 -->
                <div @mousedown.stop="onTrimMouseDown($event, sub, 'right')" class="absolute right-0 top-0 bottom-0 w-1.5 bg-white/30 hover:bg-white cursor-ew-resize"></div>
              </div>
            </div>
          </div>

          <!-- 轨道 2：V2 画中画/覆叠轨 -->
          <div class="flex items-center h-11 relative">
            <div class="w-28 shrink-0 px-2 flex items-center justify-between text-[11px] font-mono text-slate-400 bg-studio-900/90 border-r border-studio-800 h-full z-10">
              <span class="text-indigo-400 font-bold">V2 覆叠</span>
              <span class="text-[9px] text-slate-500">PIP</span>
            </div>
            <div class="flex-1 h-full bg-studio-900/40 relative">
              <div
                v-for="clip in overlayClips"
                :key="clip.id"
                @click.stop="selectClip(clip)"
                @mousedown.stop="onClipMouseDown($event, clip)"
                :class="[
                  'absolute top-1 bottom-1 rounded-lg overflow-hidden flex items-center justify-between px-2 cursor-move transition-colors border group',
                  selectedClip?.id === clip.id ? 'border-studio-cyan ring-2 ring-studio-cyan/40 bg-indigo-700/50 text-white' : 'border-indigo-500/40 bg-indigo-900/30 hover:border-indigo-400 text-slate-200'
                ]"
                :style="{
                  left: `${clip.start * 40 * timelineZoom}px`,
                  width: `${clip.duration * 40 * timelineZoom}px`
                }"
              >
                <div @mousedown.stop="onTrimMouseDown($event, clip, 'left')" class="absolute left-0 top-0 bottom-0 w-1.5 bg-white/30 hover:bg-white cursor-ew-resize"></div>
                <img :src="clip.thumb" class="w-6 h-6 rounded object-cover mr-1 shrink-0" />
                <span class="text-[10px] font-bold truncate flex-1">{{ clip.name }}</span>
                <div @mousedown.stop="onTrimMouseDown($event, clip, 'right')" class="absolute right-0 top-0 bottom-0 w-1.5 bg-white/30 hover:bg-white cursor-ew-resize"></div>
              </div>
            </div>
          </div>

          <!-- 轨道 3：V1 主视频轨 (核心故事线) -->
          <div class="flex items-center h-14 relative">
            <div class="w-28 shrink-0 px-2 flex items-center justify-between text-[11px] font-mono text-slate-400 bg-studio-900/90 border-r border-studio-800 h-full z-10">
              <span class="text-blue-400 font-bold">V1 主视频</span>
              <span class="text-[9px] text-slate-500">4K HDR</span>
            </div>
            <div class="flex-1 h-full bg-studio-900/40 relative">
              <div
                v-for="clip in videoClips"
                :key="clip.id"
                @click.stop="selectClip(clip)"
                @mousedown.stop="onClipMouseDown($event, clip)"
                :class="[
                  'absolute top-1 bottom-1 rounded-lg overflow-hidden flex items-center justify-between px-2 cursor-move transition-colors border group',
                  selectedClip?.id === clip.id ? 'border-studio-cyan ring-2 ring-studio-cyan/40 bg-studio-accent/40 text-white font-bold' : 'border-blue-500/40 bg-blue-900/30 hover:border-blue-400 text-slate-200'
                ]"
                :style="{
                  left: `${clip.start * 40 * timelineZoom}px`,
                  width: `${clip.duration * 40 * timelineZoom}px`
                }"
              >
                <!-- 左端微调修剪柄 -->
                <div @mousedown.stop="onTrimMouseDown($event, clip, 'left')" class="absolute left-0 top-0 bottom-0 w-2 bg-white/20 hover:bg-studio-cyan cursor-ew-resize z-20"></div>

                <img :src="clip.thumb" class="w-8 h-8 rounded object-cover mr-1.5 shrink-0 opacity-80" />
                <div class="flex-1 min-w-0">
                  <div class="text-[11px] font-bold truncate">{{ clip.name }}</div>
                  <div class="text-[9px] text-slate-400 font-mono">{{ clip.duration.toFixed(1) }}s</div>
                </div>

                <!-- 右端微调修剪柄 -->
                <div @mousedown.stop="onTrimMouseDown($event, clip, 'right')" class="absolute right-0 top-0 bottom-0 w-2 bg-white/20 hover:bg-studio-cyan cursor-ew-resize z-20"></div>
              </div>
            </div>
          </div>

          <!-- 轨道 4：A1 背景音乐轨 -->
          <div class="flex items-center h-9 relative">
            <div class="w-28 shrink-0 px-2 flex items-center justify-between text-[11px] font-mono text-slate-400 bg-studio-900/90 border-r border-studio-800 h-full z-10">
              <span class="text-emerald-400 font-bold">A1 音乐</span>
              <span class="text-[9px] text-slate-500">Stereo</span>
            </div>
            <div class="flex-1 h-full bg-studio-900/40 relative">
              <div
                v-for="aud in audioClips"
                :key="aud.id"
                @click.stop="selectClip(aud)"
                @mousedown.stop="onClipMouseDown($event, aud)"
                :class="[
                  'absolute top-1 bottom-1 rounded px-2 text-[10px] flex items-center justify-between truncate cursor-move transition-colors border group',
                  selectedClip?.id === aud.id ? 'bg-emerald-500 text-black font-bold border-white ring-1 ring-white' : 'bg-emerald-800/30 text-emerald-300 border-emerald-500/40 hover:bg-emerald-800/50'
                ]"
                :style="{
                  left: `${aud.start * 40 * timelineZoom}px`,
                  width: `${aud.duration * 40 * timelineZoom}px`
                }"
              >
                <div @mousedown.stop="onTrimMouseDown($event, aud, 'left')" class="absolute left-0 top-0 bottom-0 w-1.5 bg-white/30 hover:bg-white cursor-ew-resize"></div>
                <span class="truncate px-1">🎵 {{ aud.name }}</span>
                <div class="flex items-center space-x-0.5 opacity-60">
                  <span class="w-0.5 h-3 bg-emerald-300"></span>
                  <span class="w-0.5 h-4 bg-emerald-300"></span>
                  <span class="w-0.5 h-2 bg-emerald-300"></span>
                  <span class="w-0.5 h-5 bg-emerald-300"></span>
                </div>
                <div @mousedown.stop="onTrimMouseDown($event, aud, 'right')" class="absolute right-0 top-0 bottom-0 w-1.5 bg-white/30 hover:bg-white cursor-ew-resize"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. OpenCut 视频渲染导出对话弹窗 -->
    <div
      v-if="showExportModal"
      class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div class="w-full max-w-lg bg-studio-900 border border-studio-700 rounded-2xl shadow-2xl p-6 space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-studio-800">
          <span class="text-sm font-extrabold text-white flex items-center gap-2">
            <span>🎬</span>
            <span>导出</span>
          </span>
          <button @click="showExportModal = false" class="text-slate-400 hover:text-white cursor-pointer">
            <StudioIcon name="close" :size="16" />
          </button>
        </div>

        <p class="text-sm text-slate-200 leading-relaxed">多轨混流还不能用，这次不会下载示例视频。</p>
        <div class="flex items-center pt-2">
          <button
            @click="showExportModal = false"
            class="flex-1 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold cursor-pointer"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';

const projectName = ref('室内空间漫游剪辑工程');
const aspectRatio = ref('16:9');
const currentTime = ref(0);
const totalDuration = ref(30);
const isPlaying = ref(false);
const timelineZoom = ref(1.0);
const snapEnabled = ref(true);
const timelineTool = ref('select');
const selectedClip = ref(null);
const fileInput = ref(null);
const monitorVideoRef = ref(null);
const timelineScrollRef = ref(null);

// 模态弹窗
const showExportModal = ref(false);
const exportFormat = ref('MP4');
const exportRes = ref('1080p');
const exportFps = ref(60);
const exporting = ref(false);
const exportProgress = ref(0);

const assetTabs = [
  { key: 'media', label: '素材池', icon: '📁' },
  { key: 'transitions', label: '转场过渡', icon: '⚡' },
  { key: 'text', label: '字幕花字', icon: '💬' },
  { key: 'audio', label: '音效配乐', icon: '🎵' }
];
const activeAssetTab = ref('media');

// 工程素材池 (真实素材拉取)
const projectMedia = ref([
  { id: 'm1', name: '全景客厅推拉镜头.mp4', durationStr: '15.0s', thumb: '/sample-video.mp4' },
  { id: 'm2', name: '现代皮质沙发特写.jpg', durationStr: '5.0s', thumb: '/sample-video.mp4' },
  { id: 'm3', name: '定制中岛台光影.jpg', durationStr: '4.0s', thumb: '/sample-video.mp4' }
]);

// 转场预设
const transitionPresets = [
  { id: 'fade', name: '交叉溶解 (Dissolve)', desc: '画面平滑渐变过渡，经典室内光影切换' },
  { id: 'zoom', name: '无缝缩放推拉 (Zoom In)', desc: '镜头平滑推入下一个细节特写' },
  { id: 'wipe', name: '水平划像 (Wipe)', desc: '墙面线条式快速切割转场' },
  { id: 'flash', name: '高光白闪 (Flash)', desc: '通透明亮的高级采光跳切' }
];

// 花字与字幕预设
const textPresets = [
  { name: '极简现代空间标题', color: '#38bdf8' },
  { name: '暖色温馨居室手写体', color: '#fbbf24' },
  { name: '高级黑白极简字幕', color: '#ffffff' }
];

// 配乐预设
const bgmPresets = [
  { name: 'Nordic Morning (北欧轻晨)', duration: '02:15', genre: 'Acoustic Folk' },
  { name: 'Deep Focus Ambient (空间白噪音)', duration: '03:40', genre: 'Minimal Ambient' }
];

// 多轨道数据 (OpenCut 标准时间轴数据结构)
const subtitleClips = ref([
  { id: 's1', type: 'text', text: '自然采光渗透，营造通透居室氛围', start: 1.0, duration: 6.0, color: '#38bdf8' },
  { id: 's2', type: 'text', text: '定制意式三人皮沙发，线条利落纯粹', start: 8.0, duration: 6.5, color: '#ffffff' }
]);

const overlayClips = ref([
  { id: 'pip1', type: 'pip', name: '家具局部微距.jpg', start: 3.5, duration: 4.5, scale: 40, x: 55, y: 15, opacity: 90, thumb: '/sample-video.mp4' }
]);

const videoClips = ref([
  { id: 'v1', type: 'video', name: '全景客厅推拉镜头.mp4', start: 0, duration: 8.5, scale: 100, opacity: 100, speed: 1.0, thumb: '/sample-video.mp4' },
  { id: 'v2', type: 'video', name: '沙发特写与光影过渡.mp4', start: 8.5, duration: 7.0, scale: 100, opacity: 100, speed: 1.0, thumb: '/sample-video.mp4' },
  { id: 'v3', type: 'video', name: '开关面板触控微距.mp4', start: 15.5, duration: 8.5, scale: 100, opacity: 100, speed: 1.0, thumb: '/sample-video.mp4' }
]);

const audioClips = ref([
  { id: 'a1', type: 'audio', name: 'Nordic Morning (北欧轻晨).mp3', start: 0, duration: 24, volume: 80 }
]);

// 刻度计算
const rulerTicks = computed(() => {
  const ticks = [];
  for (let i = 0; i <= totalDuration.value; i += 2) {
    ticks.push(i);
  }
  return ticks;
});

// 当前监视器视频源
function realClipSource(clip) {
  const src = clip && (clip.src || '');
  if (!src || src === '/sample-video.mp4') return '';
  return src;
}
const currentVideoSource = computed(() => {
  const selected = realClipSource(selectedClip.value);
  if (selected) return selected;
  const live = videoClips.value.find((clip) => currentTime.value >= clip.start && currentTime.value <= clip.start + clip.duration);
  return realClipSource(live);
});

// 计算当前时间点字幕
const activeSubtitle = computed(() => {
  const matched = subtitleClips.value.find(s => currentTime.value >= s.start && currentTime.value <= (s.start + s.duration));
  return matched ? matched.text : '';
});

const activeSubtitleColor = computed(() => {
  const matched = subtitleClips.value.find(s => currentTime.value >= s.start && currentTime.value <= (s.start + s.duration));
  return matched?.color || '#ffffff';
});

// 计算当前画中画
const activeOverlayClip = computed(() => {
  return overlayClips.value.find(c => currentTime.value >= c.start && currentTime.value <= (c.start + c.duration));
});

function formatTimecode(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 30);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

// 播放器事件
let playInterval = null;
function togglePlay() {
  isPlaying.value = !isPlaying.value;
  const v = monitorVideoRef.value;
  if (isPlaying.value) {
    if (v) v.play();
    playInterval = setInterval(() => {
      currentTime.value += 0.05;
      if (currentTime.value >= totalDuration.value) {
        currentTime.value = 0;
      }
    }, 50);
  } else {
    if (v) v.pause();
    clearInterval(playInterval);
  }
}

function onMonitorLoaded() {}
function onMonitorTimeUpdate() {}
function onMonitorEnded() {
  isPlaying.value = false;
  clearInterval(playInterval);
}

function jumpPlayhead(secDelta) {
  currentTime.value = Math.max(0, Math.min(totalDuration.value, currentTime.value + secDelta));
  syncVideoPlayhead();
}

function stepPlayhead(framesDelta) {
  currentTime.value = Math.max(0, Math.min(totalDuration.value, currentTime.value + framesDelta * (1 / 30)));
  syncVideoPlayhead();
}

function syncVideoPlayhead() {
  const v = monitorVideoRef.value;
  if (!v || !currentVideoSource.value) return;
  const clip = selectedClip.value;
  const offset = clip ? Math.max(0, currentTime.value - (clip.start || 0)) : currentTime.value;
  const duration = Number(v.duration);
  v.currentTime = Number.isFinite(duration) ? Math.min(offset, Math.max(0, duration - 0.05)) : offset;
}

let undoSnap = null;
function rememberClipState() {
  undoSnap = {
    video: JSON.parse(JSON.stringify(videoClips.value)),
    overlay: JSON.parse(JSON.stringify(overlayClips.value))
  };
}

// 点击标尺跳转播放头
function onRulerMouseDown(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const clickX = e.clientX - rect.left - 112;
  if (clickX >= 0) {
    const time = clickX / (40 * timelineZoom.value);
    currentTime.value = Math.max(0, Math.min(totalDuration.value, time));
    syncVideoPlayhead();
  }
}

// 选中片段
function selectClip(clip) {
  selectedClip.value = clip;
}

// 片段横向拖动逻辑 (OpenCut Clip Dragging)
function onClipMouseDown(e, clip) {
  selectClip(clip);
  const startX = e.clientX;
  const initialStart = clip.start;
  rememberClipState();

  function onMouseMove(moveEvent) {
    const deltaX = moveEvent.clientX - startX;
    const deltaTime = deltaX / (40 * timelineZoom.value);
    let newStart = Math.max(0, initialStart + deltaTime);

    // 吸附到播放头
    if (snapEnabled.value && Math.abs(newStart - currentTime.value) < 0.25) {
      newStart = currentTime.value;
    }
    clip.start = Number(newStart.toFixed(2));
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

// 片段端点修剪逻辑 (OpenCut Edge Trimming)
function onTrimMouseDown(e, clip, edge) {
  const startX = e.clientX;
  const initialStart = clip.start;
  const initialDuration = clip.duration;
  rememberClipState();

  function onMouseMove(moveEvent) {
    const deltaX = moveEvent.clientX - startX;
    const deltaTime = deltaX / (40 * timelineZoom.value);

    if (edge === 'left') {
      const newStart = Math.max(0, initialStart + deltaTime);
      const newDur = Math.max(0.5, initialDuration - deltaTime);
      clip.start = Number(newStart.toFixed(2));
      clip.duration = Number(newDur.toFixed(2));
    } else {
      const newDur = Math.max(0.5, initialDuration + deltaTime);
      clip.duration = Number(newDur.toFixed(2));
    }
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

// OpenCut 刀片切割工具 (Blade Split tool)
function splitClipAtPlayhead() {
  const cutTime = currentTime.value;
  rememberClipState();
  // 查找播放头下的主视频或图层片段
  const target = videoClips.value.find(c => cutTime > c.start && cutTime < (c.start + c.duration))
    || overlayClips.value.find(c => cutTime > c.start && cutTime < (c.start + c.duration));

  if (!target) {
    alert('请将播放头移动到某个片段正中间进行裁切分割！');
    return;
  }

  const firstPartDuration = Number((cutTime - target.start).toFixed(2));
  const secondPartDuration = Number((target.duration - firstPartDuration).toFixed(2));

  // 截断前半段
  target.duration = firstPartDuration;

  // 复制出后半段
  const secondClip = {
    ...target,
    id: `split_${Date.now()}`,
    name: `${target.name} (后段)`,
    start: Number(cutTime.toFixed(2)),
    duration: secondPartDuration
  };

  if (target.type === 'video') {
    videoClips.value.push(secondClip);
  } else {
    overlayClips.value.push(secondClip);
  }

  selectedClip.value = secondClip;
}

// 从时间轴删除片段
function deleteSelectedClip() {
  if (!selectedClip.value) return;
  const id = selectedClip.value.id;
  videoClips.value = videoClips.value.filter(c => c.id !== id);
  overlayClips.value = overlayClips.value.filter(c => c.id !== id);
  subtitleClips.value = subtitleClips.value.filter(c => c.id !== id);
  audioClips.value = audioClips.value.filter(c => c.id !== id);
  selectedClip.value = null;
}

// 点击上轨
function addToTrack(item) {
  const maxEnd = Math.max(
    ...videoClips.value.map(c => c.start + c.duration),
    0
  );
  videoClips.value.push({
    id: `v_${Date.now()}`,
    type: 'video',
    name: item.name,
    start: Number(maxEnd.toFixed(2)),
    duration: 6.0,
    scale: 100,
    opacity: 100,
    speed: 1.0,
    thumb: item.thumb,
    src: item.src || ''
  });
}

function addSubtitleTrack() {
  subtitleClips.value.push({
    id: `sub_${Date.now()}`,
    type: 'text',
    text: '新增空间设计美学字幕说明',
    start: Number(currentTime.value.toFixed(2)),
    duration: 4.0,
    color: '#ffffff'
  });
}

function insertTextPreset(txt) {
  subtitleClips.value.push({
    id: `sub_${Date.now()}`,
    type: 'text',
    text: txt.name,
    start: Number(currentTime.value.toFixed(2)),
    duration: 5.0,
    color: txt.color
  });
}

function addAudioTrack(bgm) {
  audioClips.value.push({
    id: `aud_${Date.now()}`,
    type: 'audio',
    name: bgm.name,
    start: Number(currentTime.value.toFixed(2)),
    duration: 18.0,
    volume: 100
  });
}

function triggerImport() {
  fileInput.value?.click();
}

function onFilesImported(e) {
  const files = Array.from(e.target.files || []);
  files.forEach(f => {
    const url = URL.createObjectURL(f);
    projectMedia.value.unshift({
      id: `media_${Date.now()}_${Math.random()}`,
      name: f.name,
      durationStr: '',
      thumb: url,
      src: url
    });
  });
}

function undo() {
  if (!undoSnap) return;
  videoClips.value = undoSnap.video;
  overlayClips.value = undoSnap.overlay;
  undoSnap = null;
  selectedClip.value = null;
}

function openExportModal() {
  showExportModal.value = true;
}

onMounted(() => {
  // 从 DAM 素材库拉取真实视频和图像，充实素材池
  fetch('/api/materials?limit=8')
    .then(r => r.json())
    .then(json => {
      const items = json.items || json.data?.items || [];
      items.forEach(it => {
        projectMedia.value.push({
          id: String(it.id || it.fid),
          name: it.filename || '空间素材',
          durationStr: it.duration ? `${it.duration}s` : '5.0s',
          thumb: it.thumb_path ? `/api/assets/${it.fid}/image` : '/sample-video.mp4'
        });
      });
    })
    .catch(() => {});
});

onUnmounted(() => {
  clearInterval(playInterval);
});
</script>
