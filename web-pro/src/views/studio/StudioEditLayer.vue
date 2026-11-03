<template>
  <div
    v-if="visible"
    :class="cropOnly
      ? 'absolute inset-0 z-10 bg-studio-950 flex flex-col font-sans select-none'
      : 'fixed inset-x-0 bottom-0 top-14 z-50 bg-studio-950 flex flex-col font-sans select-none animate-in fade-in duration-150'"
    @keydown.esc="onEscPress"
    tabindex="0"
    ref="layerContainerRef"
  >
    <!-- 1. 顶栏 (高度 52px) -->
    <header class="h-13 px-5 border-b border-studio-700/80 bg-studio-900/95 flex items-center justify-between shrink-0">
      <div class="flex items-center gap-3">
        <span class="px-2.5 py-0.5 rounded-full bg-studio-cyan/15 text-studio-cyan font-mono text-xs font-bold">
          {{ targetTag || '@图1' }}
        </span>
        <span class="text-sm font-bold text-white truncate max-w-md">
          {{ image?.name || image?.filename || '空间参考原图' }}
        </span>
        <span v-if="imgNaturalSize.w" class="text-xs font-mono text-slate-400">
          {{ imgNaturalSize.w }} × {{ imgNaturalSize.h }}
        </span>
      </div>

      <!-- 顶栏状态与快捷操作 -->
      <div class="flex items-center gap-3">
        <!-- 多点绘制时的顶部提示与完成按钮 -->
        <template v-if="activeTool === 'polygon' && polyDraftPoints.length > 0">
          <div class="flex items-center gap-2 px-3 py-1 rounded-lg bg-studio-accent/20 border border-studio-accent/40 text-studio-accent text-xs font-bold animate-pulse">
            <span>多点选区绘制中 (已定 {{ polyDraftPoints.length }} 点)</span>
          </div>
          <button
            type="button"
            @click="finishPolygon"
            :disabled="polyDraftPoints.length < 3"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-studio-accent hover:bg-studio-accent/90 text-white text-xs font-bold cursor-pointer transition-colors shadow disabled:opacity-40"
          >
            <StudioIcon name="check" :size="13" />
            <span>完成闭合 (Enter)</span>
          </button>
          <button
            type="button"
            @click="cancelPolygon"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-300 text-xs font-bold border border-studio-700 cursor-pointer transition-colors"
          >
            <span>取消 (Esc)</span>
          </button>
          <div class="h-4 w-px bg-studio-750 mx-1"></div>
        </template>

        <!-- 撤销 / 重做 / 清空（针对即时标绘） -->
        <button
          type="button"
          @click="undoAnnotation"
          :disabled="annotations.length === 0"
          class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 text-xs font-bold border border-studio-700 disabled:opacity-30 cursor-pointer transition-colors"
          title="撤销上一步标绘"
        >
          <StudioIcon name="undo" :size="13" />
          <span>撤销</span>
        </button>

        <button
          type="button"
          @click="redoAnnotation"
          :disabled="redoStack.length === 0"
          class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 text-xs font-bold border border-studio-700 disabled:opacity-30 cursor-pointer transition-colors"
          title="重做"
        >
          <StudioIcon name="rotateRight" :size="13" />
          <span>重做</span>
        </button>

        <button
          type="button"
          @click="clearAllAnnotations"
          :disabled="annotations.length === 0 && regions.length === 0"
          class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 text-xs font-bold border border-studio-700 disabled:opacity-30 cursor-pointer transition-colors"
          title="清空标绘与选区"
        >
          <StudioIcon name="trash" :size="13" />
          <span>清空</span>
        </button>

        <div class="h-4 w-px bg-studio-750 mx-1"></div>

        <button
          v-if="!cropOnly"
          type="button"
          @click="handleCancel"
          class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-studio-800 cursor-pointer transition-colors"
          title="退出编辑层 (Esc)"
        >
          <StudioIcon name="close" :size="16" />
        </button>
      </div>
    </header>

    <!-- 2. 中间主体工作台：左侧工具栏 (64px) + 中间画布区 + 右侧方案面板 (340px) -->
    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- 2.1 左侧统一工具条 (64px) -->
      <aside class="w-16 bg-studio-900 border-r border-studio-700 flex flex-col items-center py-3 gap-1 shrink-0 select-none">
        <!-- 默认常规选择/移动工具 -->
        <button
          type="button"
          @click="setTool('select')"
          :class="[
            'w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer',
            activeTool === 'select' ? 'bg-studio-cyan text-slate-950 font-bold shadow-md' : 'text-slate-400 hover:bg-studio-800 hover:text-white'
          ]"
          title="选择 / 移动 / 缩放选区"
        >
          <StudioIcon name="pointer" :size="16" />
          <span class="text-[9px]">选择</span>
        </button>

        <div class="w-8 h-px bg-studio-800 my-1.5"></div>

        <!-- 分组 1：选区绘制工具 (用于写回配方) -->
        <div class="text-[10px] font-mono font-bold text-slate-500 uppercase mb-0.5">选区</div>

        <button
          type="button"
          @click="setTool('rect')"
          :class="[
            'w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer',
            activeTool === 'rect' ? 'bg-studio-accent text-white shadow-md' : 'text-slate-400 hover:bg-studio-800 hover:text-white'
          ]"
          title="新建矩形选框"
        >
          <StudioIcon name="square" :size="16" />
          <span class="text-[9px]">矩形</span>
        </button>

        <button
          type="button"
          @click="setTool('polygon')"
          :class="[
            'w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer',
            activeTool === 'polygon' ? 'bg-studio-accent text-white shadow-md' : 'text-slate-400 hover:bg-studio-800 hover:text-white'
          ]"
          title="新建多点选区 (多边形连线)"
        >
          <StudioIcon name="layers" :size="16" />
          <span class="text-[9px]">多点</span>
        </button>

        <button
          v-if="!cropOnly"
          type="button"
          @click="setTool('brush')"
          :class="[
            'w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer',
            activeTool === 'brush' ? 'bg-studio-accent text-white shadow-md' : 'text-slate-400 hover:bg-studio-800 hover:text-white'
          ]"
          title="画笔涂抹 (用于无中生有/不规则选区)"
        >
          <StudioIcon name="wand" :size="16" />
          <span class="text-[9px]">画笔</span>
        </button>

        <div v-if="!cropOnly" class="w-8 h-px bg-studio-800 my-1.5"></div>

        <!-- 分组 2：即时标绘工具 (所见即所得，即画即显) -->
        <div v-if="!cropOnly" class="text-[10px] font-mono font-bold text-slate-500 uppercase mb-0.5">标绘</div>

        <button
          v-if="!cropOnly"
          type="button"
          @click="setTool('arrow')"
          :class="[
            'w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer',
            activeTool === 'arrow' ? 'bg-rose-500 text-white shadow-md' : 'text-slate-400 hover:bg-studio-800 hover:text-white'
          ]"
          title="指向红箭头 (指示动向/位移)"
        >
          <StudioIcon name="arrowRight" :size="16" />
          <span class="text-[9px]">箭头</span>
        </button>

        <button
          v-if="!cropOnly"
          type="button"
          @click="setTool('text')"
          :class="[
            'w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer',
            activeTool === 'text' ? 'bg-rose-500 text-white shadow-md' : 'text-slate-400 hover:bg-studio-800 hover:text-white'
          ]"
          title="文字批注"
        >
          <StudioIcon name="type" :size="16" />
          <span class="text-[9px]">文字</span>
        </button>

        <button
          v-if="!cropOnly"
          type="button"
          @click="setTool('mosaic')"
          :class="[
            'w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer',
            activeTool === 'mosaic' ? 'bg-rose-500 text-white shadow-md' : 'text-slate-400 hover:bg-studio-800 hover:text-white'
          ]"
          title="局部马赛克 (真实像素马赛克遮蔽)"
        >
          <StudioIcon name="eraser" :size="16" />
          <span class="text-[9px]">马赛克</span>
        </button>

        <button
          v-if="!cropOnly"
          type="button"
          @click="setTool('crop')"
          :class="[
            'w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer',
            activeTool === 'crop' ? 'bg-amber-400 text-slate-950 font-bold shadow-md' : 'text-slate-400 hover:bg-studio-800 hover:text-white'
          ]"
          title="裁剪当前参考图，确认后才替换"
        >
          <StudioIcon name="crop" :size="16" />
          <span class="text-[9px]">裁剪</span>
        </button>

        <div v-if="!cropOnly" class="w-8 h-px bg-studio-800 my-1.5"></div>

        <!-- 分组 3：专有扩图 -->
        <button
          v-if="!cropOnly"
          type="button"
          @click="setTool('outpaint')"
          :class="[
            'w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer',
            activeTool === 'outpaint' ? 'bg-emerald-500 text-slate-950 font-bold shadow-md' : 'text-slate-400 hover:bg-studio-800 hover:text-white'
          ]"
          title="智能扩图 (独立画布扩展)"
        >
          <StudioIcon name="maximize" :size="16" />
          <span class="text-[9px]">扩图</span>
        </button>
      </aside>

      <!-- 2.2 中间画布交互区 -->
      <main
        class="flex-1 bg-studio-950 relative flex items-center justify-center overflow-hidden p-6 select-none"
        :class="isSpacePressed ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''"
        ref="canvasViewportRef"
        @wheel="onMainWheel"
        @mousedown="onMainMouseDown"
      >
        <!-- B. 全画幅裁剪专用顶部 HUD -->
        <div
          v-if="activeTool === 'crop'"
          class="absolute top-4 z-40 flex items-center gap-2.5 bg-studio-900/95 border border-studio-700 px-4 py-2 rounded-2xl backdrop-blur-md shadow-2xl"
        >
          <span class="text-xs font-bold text-amber-400 flex items-center gap-1">
            <StudioIcon name="crop" :size="14" />
            画幅比例:
          </span>
          <div class="flex items-center gap-1">
            <button
              v-for="r in [
                { key: 'free', label: '自由' },
                { key: 'original', label: '原比' },
                { key: '1:1', label: '1:1' },
                { key: '16:9', label: '16:9' },
                { key: '9:16', label: '9:16' },
                { key: '4:3', label: '4:3' },
                { key: '3:4', label: '3:4' }
              ]"
              :key="r.key"
              type="button"
              @click="setCropRatio(r.key)"
              :class="[
                'px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer',
                cropRatio === r.key ? 'bg-amber-400 text-slate-950 shadow-sm' : 'bg-studio-800 text-slate-300 hover:bg-studio-750'
              ]"
            >
              {{ r.label }}
            </button>
          </div>
          <div class="h-4 w-px bg-studio-750 mx-1"></div>
          <button
            type="button"
            @click="initCropBox"
            class="px-2 py-1 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-300 text-xs font-bold transition-colors cursor-pointer"
          >
            重置全图
          </button>
        </div>

        <!-- A. 智能扩图专用画布视图 (严格保持原图比例，无裁切，实时数据HUD) -->
        <template v-if="activeTool === 'outpaint'">
          <div class="relative w-full h-full flex flex-col items-center justify-center">
            <!-- 顶部参数与比例控制 HUD -->
            <div class="absolute top-3 z-30 flex items-center gap-3 bg-studio-900/95 border border-studio-700/90 px-4 py-2.5 rounded-2xl backdrop-blur-md shadow-2xl">
              <span class="text-xs font-bold text-slate-300">目标画幅:</span>
              <div class="flex items-center gap-1.5">
                <button
                  v-for="r in ['16:9', '4:3', '1:1', '9:16', '3:4']"
                  :key="r"
                  type="button"
                  @click="targetExpandRatio = r; resetOutpaintOffset()"
                  :class="[
                    'px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer',
                    targetExpandRatio === r ? 'bg-emerald-400 text-slate-950' : 'bg-studio-800 text-slate-300 hover:bg-studio-750'
                  ]"
                >
                  {{ r }}
                </button>
              </div>

              <div class="h-4 w-px bg-studio-750 mx-1"></div>

              <span class="text-xs font-bold text-slate-300">原图占比</span>
              <input
                type="range"
                min="40"
                max="90"
                step="5"
                v-model.number="outpaintOccupancy"
                class="w-24 accent-emerald-400 cursor-pointer"
                @input="resetOutpaintOffset()"
              />
              <span class="text-xs font-mono font-bold text-emerald-300 w-10">{{ outpaintOccupancy }}%</span>

              <div class="h-4 w-px bg-studio-750 mx-1"></div>

              <!-- 快捷居中/对齐 -->
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  @click="alignOutpaint('center')"
                  class="px-2 py-1 rounded bg-studio-800 hover:bg-studio-750 text-slate-300 text-[11px] cursor-pointer"
                >
                  居中
                </button>
                <button
                  type="button"
                  @click="alignOutpaint('top')"
                  class="px-2 py-1 rounded bg-studio-800 hover:bg-studio-750 text-slate-300 text-[11px] cursor-pointer"
                >
                  靠顶
                </button>
                <button
                  type="button"
                  @click="alignOutpaint('bottom')"
                  class="px-2 py-1 rounded bg-studio-800 hover:bg-studio-750 text-slate-300 text-[11px] cursor-pointer"
                >
                  靠底
                </button>
              </div>

              <div class="h-4 w-px bg-studio-750 mx-1"></div>

              <!-- 确认扩图主按钮 -->
              <button
                type="button"
                @click="executeOutpainting"
                :disabled="isOutpainting"
                class="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 cursor-pointer transition-all disabled:opacity-50"
              >
                <StudioIcon name="maximize" :size="13" />
                <span>确认扩图</span>
              </button>
            </div>

            <!-- 白色扩展底板画布 (真实画幅，带细密网格，清晰展示扩展留白) -->
            <div
              class="relative rounded-xl shadow-2xl border-2 border-dashed border-slate-300 overflow-hidden select-none"
              :style="outpaintCanvasComputedStyle"
              @mousemove="onOutpaintDragMove"
              @mouseup="onOutpaintDragEnd"
              @mouseleave="onOutpaintDragEnd"
            >
              <!-- 4 个方向的扩展量药丸徽章 -->
              <div
                v-if="outpaintMargins.top > 0"
                class="absolute top-2 inset-x-0 mx-auto w-fit z-20 px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-mono text-[11px] font-bold shadow pointer-events-none"
              >
                ↑ 向上延展 +{{ outpaintMargins.topPct }}% ({{ outpaintMargins.top }}px)
              </div>
              <div
                v-if="outpaintMargins.bottom > 0"
                class="absolute bottom-2 inset-x-0 mx-auto w-fit z-20 px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-mono text-[11px] font-bold shadow pointer-events-none"
              >
                ↓ 向下延展 +{{ outpaintMargins.bottomPct }}% ({{ outpaintMargins.bottom }}px)
              </div>
              <div
                v-if="outpaintMargins.left > 0"
                class="absolute left-2 inset-y-0 my-auto h-fit z-20 px-2 py-1 rounded-lg bg-emerald-600 text-white font-mono text-[11px] font-bold shadow pointer-events-none"
              >
                ← 左延展 +{{ outpaintMargins.leftPct }}%
              </div>
              <div
                v-if="outpaintMargins.right > 0"
                class="absolute right-2 inset-y-0 my-auto h-fit z-20 px-2 py-1 rounded-lg bg-emerald-600 text-white font-mono text-[11px] font-bold shadow pointer-events-none"
              >
                → 右延展 +{{ outpaintMargins.rightPct }}%
              </div>

              <!-- 内部可拖拽定位的原图 (严格保持原生宽高比，绝不裁切，完整无损展示) -->
              <div
                class="absolute cursor-move select-none shadow-2xl border-2 border-studio-accent rounded-lg overflow-hidden group"
                :style="outpaintInnerImageStyle"
                @mousedown.prevent="onOutpaintDragStart"
              >
                <img
                  :src="imageSrc"
                  class="w-full h-full object-contain pointer-events-none block"
                  alt="原图无损保持"
                />
                <div class="absolute inset-0 bg-studio-accent/15 group-hover:bg-studio-accent/25 transition-colors pointer-events-none flex flex-col items-center justify-center gap-1">
                  <span class="px-2.5 py-1 rounded-lg bg-studio-900/90 text-white text-xs font-bold shadow-md border border-studio-accent/40 flex items-center gap-1">
                    <StudioIcon name="move" :size="12" />
                    <span>按住鼠标拖拽原图位置</span>
                  </span>
                  <span class="text-[10px] font-mono text-white/90 bg-black/60 px-2 py-0.5 rounded">
                    原图: {{ imgNaturalSize.w }} × {{ imgNaturalSize.h }}
                  </span>
                </div>
              </div>
            </div>

            <!-- 底部实时数据 HUD 状态条 -->
            <div class="absolute bottom-3 z-30 flex items-center gap-4 bg-studio-900/90 border border-studio-800 px-5 py-2 rounded-xl text-xs font-mono text-slate-300 shadow-xl">
              <div>
                <span class="text-slate-500">原图尺寸:</span>
                <span class="text-white font-bold ml-1">{{ imgNaturalSize.w }} × {{ imgNaturalSize.h }}</span>
              </div>
              <div class="h-3 w-px bg-studio-750"></div>
              <div>
                <span class="text-slate-500">预估扩图分辨率:</span>
                <span class="text-emerald-400 font-bold ml-1">{{ outpaintEstimatedRes }}</span>
              </div>
              <div class="h-3 w-px bg-studio-750"></div>
              <div>
                <span class="text-slate-500">扩大量汇总:</span>
                <span class="text-slate-200 ml-1">
                  上 +{{ outpaintMargins.topPct }}% · 下 +{{ outpaintMargins.bottomPct }}% · 左 +{{ outpaintMargins.leftPct }}% · 右 +{{ outpaintMargins.rightPct }}%
                </span>
              </div>
            </div>

            <!-- 扩图进度条遮罩 -->
            <div
              v-if="isOutpainting"
              class="absolute inset-0 bg-black/80 z-50 flex flex-col items-center justify-center gap-4 backdrop-blur-md animate-in fade-in"
            >
              <div class="w-12 h-12 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
              <div class="text-sm font-bold text-white tracking-wide">
                正在调用专业扩图模型自然延伸空间纹理，请稍候...
              </div>
              <div class="w-80 h-2 rounded-full bg-studio-800 overflow-hidden border border-studio-700">
                <div class="h-full bg-gradient-to-r from-emerald-400 to-studio-cyan w-2/3 animate-pulse"></div>
              </div>
            </div>
          </div>
        </template>

        <!-- B. 统一综合编辑主画布 (选区 + 3D预览 + 即时标绘) -->
        <template v-else>
          <div
            class="relative inline-block shadow-2xl rounded-lg overflow-hidden border border-studio-800"
            ref="mainCanvasWrapperRef"
            :style="{
              transform: `translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.1s ease-out'
            }"
            @mousedown="onCanvasMouseDown"
            @mousemove="onCanvasMouseMove"
            @mouseup="onCanvasMouseUp"
            @dblclick="onCanvasDblClick"
          >
            <!-- 1. 底图原图 -->
            <img
              ref="baseImageRef"
              :src="imageSrc"
              crossorigin="anonymous"
              @load="onImageLoad"
              class="block max-h-[calc(100vh-210px)] max-w-[calc(100vw-450px)] object-contain pointer-events-none select-none"
              alt="编辑底图"
            />

            <!-- 2. 真实马赛克渲染 Canvas (真正像素化下方原图真实细节，非简单黑块) -->
            <canvas
              ref="mosaicCanvasRef"
              class="absolute inset-0 pointer-events-none"
              :width="canvasDisplaySize.w"
              :height="canvasDisplaySize.h"
            ></canvas>

            <!-- 3. SVG 矢量交互层（箭头、选区、画笔） -->
            <svg
              class="absolute inset-0 w-full h-full pointer-events-auto"
              :style="{ cursor: cursorStyle }"
            >
              <defs>
                <marker
                  id="arrow-head-red"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#EF4444" />
                </marker>
              </defs>

              <!-- 3.1 即时指向红箭头 -->
              <template v-for="ann in arrowAnnotations" :key="'arr_' + ann._origIdx">
                <!-- 宽隐形线便于点击激活 -->
                <line
                  :x1="ann.x1"
                  :y1="ann.y1"
                  :x2="ann.x2"
                  :y2="ann.y2"
                  stroke="transparent"
                  stroke-width="16"
                  :class="activeTool === 'select' ? 'cursor-move pointer-events-auto' : 'pointer-events-none'"
                  @mousedown.stop="activeTool === 'select' && onAnnotationMouseDown(ann._origIdx, 'arrow-body', $event)"
                  @click.stop="activeTool === 'select' && (selectedAnnotationIndex = ann._origIdx)"
                />
                <line
                  :x1="ann.x1"
                  :y1="ann.y1"
                  :x2="ann.x2"
                  :y2="ann.y2"
                  stroke="#EF4444"
                  :stroke-width="selectedAnnotationIndex === ann._origIdx ? 4.5 : 3.5"
                  marker-end="url(#arrow-head-red)"
                  :class="activeTool === 'select' ? 'cursor-move pointer-events-auto' : 'pointer-events-none'"
                  @mousedown.stop="activeTool === 'select' && onAnnotationMouseDown(ann._origIdx, 'arrow-body', $event)"
                  @click.stop="activeTool === 'select' && (selectedAnnotationIndex = ann._origIdx)"
                />
                <!-- 选中态控点：起点与终点 -->
                <template v-if="selectedAnnotationIndex === ann._origIdx && activeTool === 'select'">
                  <circle
                    :cx="ann.x1"
                    :cy="ann.y1"
                    r="6"
                    fill="#FFFFFF"
                    stroke="#EF4444"
                    stroke-width="2.5"
                    class="cursor-crosshair pointer-events-auto shadow"
                    @mousedown.stop="onAnnotationMouseDown(ann._origIdx, 'arrow-start', $event)"
                  />
                  <circle
                    :cx="ann.x2"
                    :cy="ann.y2"
                    r="6"
                    fill="#FFFFFF"
                    stroke="#EF4444"
                    stroke-width="2.5"
                    class="cursor-crosshair pointer-events-auto shadow"
                    @mousedown.stop="onAnnotationMouseDown(ann._origIdx, 'arrow-end', $event)"
                  />
                </template>
              </template>

              <!-- 正在拉的箭头预览 -->
              <line
                v-if="isDrawingArrow && currentDraftArrow"
                :x1="currentDraftArrow.x1"
                :y1="currentDraftArrow.y1"
                :x2="currentDraftArrow.x2"
                :y2="currentDraftArrow.y2"
                stroke="#EF4444"
                stroke-width="3.5"
                stroke-dasharray="4 2"
                marker-end="url(#arrow-head-red)"
              />

              <!-- 3.1.5 马赛克选中与边框控点 -->
              <template v-for="m in mosaicAnnotations" :key="'mos_' + m._origIdx">
                <rect
                  :x="m.x"
                  :y="m.y"
                  :width="m.w"
                  :height="m.h"
                  fill="transparent"
                  :stroke="selectedAnnotationIndex === m._origIdx ? '#EF4444' : 'transparent'"
                  :stroke-width="selectedAnnotationIndex === m._origIdx ? 2 : 1"
                  :stroke-dasharray="selectedAnnotationIndex === m._origIdx ? '4 2' : 'none'"
                  :class="activeTool === 'select' ? 'cursor-move pointer-events-auto' : 'pointer-events-none'"
                  @mousedown.stop="activeTool === 'select' && onAnnotationMouseDown(m._origIdx, 'mosaic-body', $event)"
                  @click.stop="activeTool === 'select' && (selectedAnnotationIndex = m._origIdx)"
                />
                <template v-if="selectedAnnotationIndex === m._origIdx && activeTool === 'select'">
                  <circle
                    :cx="m.x"
                    :cy="m.y"
                    r="5"
                    fill="#FFFFFF"
                    stroke="#EF4444"
                    stroke-width="2"
                    class="cursor-nwse-resize pointer-events-auto"
                    @mousedown.stop="onAnnotationMouseDown(m._origIdx, 'mosaic-handle-nw', $event)"
                  />
                  <circle
                    :cx="m.x + m.w"
                    :cy="m.y"
                    r="5"
                    fill="#FFFFFF"
                    stroke="#EF4444"
                    stroke-width="2"
                    class="cursor-nesw-resize pointer-events-auto"
                    @mousedown.stop="onAnnotationMouseDown(m._origIdx, 'mosaic-handle-ne', $event)"
                  />
                  <circle
                    :cx="m.x + m.w"
                    :cy="m.y + m.h"
                    r="5"
                    fill="#FFFFFF"
                    stroke="#EF4444"
                    stroke-width="2"
                    class="cursor-nwse-resize pointer-events-auto"
                    @mousedown.stop="onAnnotationMouseDown(m._origIdx, 'mosaic-handle-se', $event)"
                  />
                  <circle
                    :cx="m.x"
                    :cy="m.y + m.h"
                    r="5"
                    fill="#FFFFFF"
                    stroke="#EF4444"
                    stroke-width="2"
                    class="cursor-nesw-resize pointer-events-auto"
                    @mousedown.stop="onAnnotationMouseDown(m._origIdx, 'mosaic-handle-sw', $event)"
                  />
                </template>
              </template>

              <!-- 3.2 已完成的选区多边形/矩形渲染 (基于分配的专属颜色高亮渲染) -->
              <template v-for="reg in regions" :key="reg.id">
                <!-- 多边形选区 -->
                <polygon
                  v-if="reg.type === 'polygon' && reg.points.length >= 3"
                  :points="getPolygonPointsAttr(reg.points)"
                  :fill="reg.id === activeRegionId ? (reg.color?.lightBg || 'rgba(99, 102, 241, 0.28)') : (reg.color?.lightBg || 'rgba(99, 102, 241, 0.12)')"
                  :stroke="reg.color?.border || '#818CF8'"
                  :stroke-width="reg.id === activeRegionId ? 2.5 : 1.5"
                  class="cursor-pointer"
                  @mouseenter="hoveredRegionId = reg.id"
                  @mouseleave="hoveredRegionId === reg.id && (hoveredRegionId = null)"
                  @click.stop="activeRegionId = reg.id"
                />

                <!-- 矩形或画笔选区 (如果是非3D模式，渲染半透明框) -->
                <rect
                  v-else-if="!['replace', 'add'].includes(reg.op)"
                  :x="reg.x"
                  :y="reg.y"
                  :width="reg.w"
                  :height="reg.h"
                  :fill="reg.id === activeRegionId ? (reg.color?.lightBg || 'rgba(6, 182, 212, 0.22)') : (reg.color?.lightBg || 'rgba(6, 182, 212, 0.1)')"
                  :stroke="reg.color?.border || '#22D3EE'"
                  :stroke-width="reg.id === activeRegionId ? 2.5 : 1.5"
                  :stroke-dasharray="reg.type === 'brush' ? '4 2' : 'none'"
                  :class="activeTool === 'select' ? 'cursor-move' : 'cursor-pointer'"
                  @mouseenter="hoveredRegionId = reg.id"
                  @mouseleave="hoveredRegionId === reg.id && (hoveredRegionId = null)"
                  @mousedown.stop="onRegionBodyDown(reg, $event)"
                  @click.stop="activeRegionId = reg.id"
                />

                <!-- 选区控点：激活的矩形选区显示 4 个角手柄 -->
                <template v-if="reg.id === activeRegionId && reg.type === 'rect'">
                  <circle
                    v-for="(h, hIdx) in getRectHandles(reg)"
                    :key="hIdx"
                    :cx="h.x"
                    :cy="h.y"
                    r="6"
                    fill="#FFFFFF"
                    :stroke="reg.color?.border || '#0891B2'"
                    stroke-width="2.5"
                    class="cursor-nwse-resize"
                    @mousedown.stop="onRectHandleDown(reg, h.corner, $event)"
                  />
                </template>

                <!-- 选区控点：激活的多边形选区显示每个顶点 -->
                <template v-if="reg.id === activeRegionId && reg.type === 'polygon'">
                  <circle
                    v-for="(pt, pIdx) in reg.points"
                    :key="pIdx"
                    :cx="pt.x"
                    :cy="pt.y"
                    r="6"
                    fill="#FFFFFF"
                    :stroke="reg.color?.border || '#6366F1'"
                    stroke-width="2.5"
                    class="cursor-move"
                    @mousedown.stop="onPolyVertexDown(reg, pIdx, $event)"
                  />
                </template>
              </template>

              <!-- 正在绘制中的多边形半透明闭合预览与连线 -->
              <polygon
                v-if="activeTool === 'polygon' && polyDraftPoints.length >= 2 && polyMouseHoverPoint"
                :points="getDraftPolygonFillPoints(polyDraftPoints, polyMouseHoverPoint)"
                fill="rgba(99, 102, 241, 0.18)"
                stroke="none"
                class="pointer-events-none"
              />
              <polyline
                v-if="activeTool === 'polygon' && polyDraftPoints.length > 0"
                :points="getPolylinePointsAttr(polyDraftPoints, polyMouseHoverPoint)"
                fill="none"
                stroke="#818CF8"
                stroke-width="2"
                stroke-dasharray="3 3"
              />
              <!-- 起点闭合吸附指示圈 -->
              <circle
                v-if="activeTool === 'polygon' && polyDraftPoints.length >= 3"
                :cx="polyDraftPoints[0].x"
                :cy="polyDraftPoints[0].y"
                :r="isHoveringStartPoint ? 10 : 6"
                :fill="isHoveringStartPoint ? '#10B981' : '#FFFFFF'"
                :stroke="isHoveringStartPoint ? '#34D399' : '#818CF8'"
                :stroke-width="isHoveringStartPoint ? 3 : 2"
                class="cursor-pointer transition-all"
                @click.stop="finishPolygon"
              />

              <!-- 全画幅裁剪暗化遮罩与手柄 -->
              <template v-if="activeTool === 'crop' && cropBox">
                <!-- 4 个四周暗化遮罩 -->
                <rect :x="0" :y="0" :width="canvasDisplaySize.w" :height="Math.max(0, cropBox.y)" fill="rgba(0, 0, 0, 0.65)" />
                <rect :x="0" :y="cropBox.y + cropBox.h" :width="canvasDisplaySize.w" :height="Math.max(0, canvasDisplaySize.h - (cropBox.y + cropBox.h))" fill="rgba(0, 0, 0, 0.65)" />
                <rect :x="0" :y="cropBox.y" :width="Math.max(0, cropBox.x)" :height="cropBox.h" fill="rgba(0, 0, 0, 0.65)" />
                <rect :x="cropBox.x + cropBox.w" :y="cropBox.y" :width="Math.max(0, canvasDisplaySize.w - (cropBox.x + cropBox.w))" :height="cropBox.h" fill="rgba(0, 0, 0, 0.65)" />

                <!-- 裁剪框本体边框与移动触发区 -->
                <rect
                  :x="cropBox.x"
                  :y="cropBox.y"
                  :width="cropBox.w"
                  :height="cropBox.h"
                  fill="rgba(251, 191, 36, 0.05)"
                  stroke="#FBBF24"
                  stroke-width="2"
                  class="cursor-move"
                  @mousedown.stop="onCropMoveDown"
                />

                <!-- 九宫格辅助线 -->
                <line :x1="cropBox.x + cropBox.w / 3" :y1="cropBox.y" :x2="cropBox.x + cropBox.w / 3" :y2="cropBox.y + cropBox.h" stroke="rgba(255, 255, 255, 0.4)" stroke-width="1" stroke-dasharray="3 3" />
                <line :x1="cropBox.x + cropBox.w * 2 / 3" :y1="cropBox.y" :x2="cropBox.x + cropBox.w * 2 / 3" :y2="cropBox.y + cropBox.h" stroke="rgba(255, 255, 255, 0.4)" stroke-width="1" stroke-dasharray="3 3" />
                <line :x1="cropBox.x" :y1="cropBox.y + cropBox.h / 3" :x2="cropBox.x + cropBox.w" :y2="cropBox.y + cropBox.h / 3" stroke="rgba(255, 255, 255, 0.4)" stroke-width="1" stroke-dasharray="3 3" />
                <line :x1="cropBox.x" :y1="cropBox.y + cropBox.h * 2 / 3" :x2="cropBox.x + cropBox.w" :y2="cropBox.y + cropBox.h * 2 / 3" stroke="rgba(255, 255, 255, 0.4)" stroke-width="1" stroke-dasharray="3 3" />

                <!-- 8 个控制手柄 (4角 + 4边中点) -->
                <rect
                  v-for="h in getCropHandles()"
                  :key="h.key"
                  :x="h.x - 5"
                  :y="h.y - 5"
                  width="10"
                  height="10"
                  rx="2"
                  fill="#FFFFFF"
                  stroke="#FBBF24"
                  stroke-width="2"
                  :style="{ cursor: h.cursor }"
                  @mousedown.stop="onCropHandleDown(h.key, $event)"
                />
              </template>

              <rect
                v-if="isDraggingNewRect && currentDraftRect"
                :x="currentDraftRect.x"
                :y="currentDraftRect.y"
                :width="currentDraftRect.w"
                :height="currentDraftRect.h"
                fill="rgba(6, 182, 212, 0.2)"
                stroke="#22D3EE"
                stroke-width="2"
                stroke-dasharray="4 2"
              />

              <!-- 画笔笔触预览路径 -->
              <path
                v-if="activeTool === 'brush' && brushPoints.length > 1"
                :d="getBrushSvgPath(brushPoints)"
                fill="none"
                stroke="#06B6D4"
                stroke-width="24"
                stroke-linecap="round"
                stroke-linejoin="round"
                opacity="0.5"
              />
            </svg>

            <!-- 4. 文字标绘层（DOM 渲染，支持选中平移、调整字号、双击编辑与删除） -->
            <template v-for="ann in textAnnotations" :key="'txt_' + ann._origIdx">
              <div
                class="absolute px-2 py-1 rounded select-none cursor-move group/txt transition-all"
                :class="selectedAnnotationIndex === ann._origIdx && activeTool === 'select' ? 'bg-studio-900 border-2 border-rose-500 text-rose-200 shadow-xl ring-2 ring-rose-500/40 z-30' : 'bg-studio-900/90 border border-rose-500/70 text-rose-300 hover:border-rose-400 shadow-md z-20'"
                :style="{ left: ann.x + 'px', top: ann.y + 'px', fontSize: (ann.fontSize || 13) + 'px' }"
                @mousedown.stop="activeTool === 'select' && onAnnotationMouseDown(ann._origIdx, 'text', $event)"
                @click.stop="activeTool === 'select' && (selectedAnnotationIndex = ann._origIdx)"
                @dblclick.stop="startEditTextAnnotation(ann._origIdx)"
              >
                <span class="font-bold whitespace-nowrap">{{ ann.text }}</span>

                <!-- 文本选中浮动工具条：字号调节 A- / A+、双击修改、删除 -->
                <div
                  v-if="selectedAnnotationIndex === ann._origIdx && activeTool === 'select'"
                  class="absolute -top-8 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-studio-950 border border-rose-500 shadow-2xl text-[10px] font-mono whitespace-nowrap z-40"
                  @mousedown.stop
                  @click.stop
                >
                  <button
                    type="button"
                    @click.stop="changeTextFontSize(ann._origIdx, -2)"
                    class="px-1.5 py-0.5 rounded hover:bg-studio-800 text-slate-300 hover:text-white"
                    title="减小字号"
                  >A-</button>
                  <span class="text-rose-400 font-bold px-0.5">{{ ann.fontSize || 13 }}px</span>
                  <button
                    type="button"
                    @click.stop="changeTextFontSize(ann._origIdx, 2)"
                    class="px-1.5 py-0.5 rounded hover:bg-studio-800 text-slate-300 hover:text-white"
                    title="加大字号"
                  >A+</button>
                  <button
                    type="button"
                    @click.stop="startEditTextAnnotation(ann._origIdx)"
                    class="px-1.5 py-0.5 rounded hover:bg-studio-800 text-studio-cyan hover:text-white ml-0.5"
                    title="修改文本内容"
                  >编辑</button>
                  <button
                    type="button"
                    @click.stop="deleteAnnotation(ann._origIdx)"
                    class="px-1.5 py-0.5 rounded hover:bg-rose-900/80 text-rose-400 hover:text-white ml-0.5 font-bold"
                    title="删除批注"
                  >✕</button>
                </div>
              </div>
            </template>

            <!-- 微信截图风格文字输入临时浮层 -->
            <div
              v-if="isAddingText"
              class="absolute z-40 flex items-center gap-1.5 p-1 bg-studio-900/95 border-2 border-rose-500 rounded-lg shadow-2xl backdrop-blur"
              :style="{ left: textInputPos.x + 'px', top: textInputPos.y + 'px' }"
              @mousedown.stop
              @click.stop
            >
              <input
                ref="inlineTextInputRef"
                v-model="tempInputText"
                @keydown.enter.prevent="confirmAddText"
                @keydown.esc.prevent="cancelAddText"
                placeholder="输入批注文字..."
                class="px-2 py-0.5 bg-transparent text-rose-200 placeholder-slate-500 text-xs font-bold outline-none min-w-[150px]"
              />
              <button
                type="button"
                @click.stop="confirmAddText"
                class="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold transition-colors"
              >
                确定
              </button>
              <button
                type="button"
                @click.stop="cancelAddText"
                class="px-1.5 py-0.5 rounded bg-studio-800 hover:bg-studio-700 text-slate-400 hover:text-white text-[11px] transition-colors"
                title="取消 (Esc)"
              >
                ✕
              </button>
            </div>

            <!-- 5. 选区标签与所有 3D 陈设视图（纯色遮罩底，切到其他区域依然持续展示，禁用手势控制确保拖拽稳定性） -->
            <template v-for="reg in regions" :key="'obj_' + reg.id">
              <!-- 选区药丸标签 (绘制新区域时自动隐匿防遮挡，悬停或激活时清晰显现) -->
              <div
                v-if="shouldShowRegionLabel(reg)"
                class="absolute z-30 px-2.5 py-0.5 rounded-full font-mono font-bold text-[10px] shadow pointer-events-none flex items-center gap-1.5 transition-opacity duration-150"
                :class="reg.id === activeRegionId ? (reg.color?.badgeClass || 'bg-studio-accent text-white') : 'bg-studio-850/90 text-slate-200 border border-studio-700'"
                :style="getRegionLabelStyle(reg)"
              >
                <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: reg.color?.border || '#3B82F6' }"></span>
                <span>{{ reg.name }}</span>
                <span class="opacity-75">({{ getOpDisplayName(reg.op) }}{{ reg.guide?.materialName ? ': ' + reg.guide.materialName : '' }})</span>
              </div>

              <!-- 基础属性：如果在选区配置了材质贴图或色彩，在选区内渲染智能材质贴合图层 -->
              <div
                v-if="reg.guide?.type === 'resurface' && reg.guide?.colorHex"
                class="absolute z-10 overflow-hidden rounded transition-all pointer-events-none"
                :style="{
                  left: getRegionBox(reg).x + 'px',
                  top: getRegionBox(reg).y + 'px',
                  width: getRegionBox(reg).w + 'px',
                  height: getRegionBox(reg).h + 'px',
                  borderColor: reg.type === 'polygon' ? 'transparent' : (reg.color?.border || '#3B82F6'),
                  borderWidth: reg.type === 'polygon' ? '0px' : (reg.id === activeRegionId ? '2.5px' : '1.5px'),
                  backgroundColor: hexToRgba(reg.guide.colorHex, 0.35),
                  ...getPolygonLocalClipStyle(reg),
                }"
              >
                <div class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur text-[9px] text-white font-mono flex items-center gap-1 shadow">
                  <span class="w-2 h-2 rounded-full border border-white/30" :style="{ backgroundColor: reg.guide.colorHex }"></span>
                  <span class="truncate max-w-[100px]">{{ reg.guide.materialName || reg.guide.colorHex }}</span>
                </div>
              </div>

              <!-- 3D 家具视口：每一个替换/增加区域均持续展示，采用纯色背景遮蔽原图杂乱陈设 -->
              <div
                v-if="['replace', 'add'].includes(reg.op) && (reg.guide?.objectUrl || reg.params?.glbUrl)"
                class="absolute z-20 overflow-hidden rounded transition-all"
                :class="[
                  reg.id === activeRegionId
                    ? 'shadow-2xl pointer-events-auto'
                    : 'shadow-md opacity-95 pointer-events-auto cursor-pointer'
                ]"
                :style="{
                  left: getRegionBox(reg).x + 'px',
                  top: getRegionBox(reg).y + 'px',
                  width: getRegionBox(reg).w + 'px',
                  height: getRegionBox(reg).h + 'px',
                  backgroundColor: reg.params?.transparentBg !== false ? 'transparent' : '#F8FAFC',
                  borderColor: reg.type === 'polygon' ? 'transparent' : (reg.color?.border || '#3B82F6'),
                  borderWidth: reg.type === 'polygon' ? '0px' : (reg.id === activeRegionId ? '2.5px' : '1.5px'),
                  ...getPolygonLocalClipStyle(reg),
                }"
                @click.stop="activeRegionId = reg.id"
                @mousedown.stop="activeTool === 'select' && onRegionBodyDown(reg, $event)"
              >
                <model-viewer
                  :ref="el => registerModelViewer(reg.id, el)"
                  :src="reg.guide?.objectUrl || reg.params.glbUrl"
                  alt="3D 家具模型"
                  shadow-intensity="1.2"
                  shadow-softness="0.8"
                  environment-image="neutral"
                  interaction-prompt="none"
                  :style="{
                    width: '100%',
                    height: '100%',
                    backgroundColor: reg.params?.transparentBg !== false ? 'transparent' : '#F8FAFC',
                    pointerEvents: 'none'
                  }"
                  :orientation="`0deg 0deg ${reg.guide?.yaw || reg.params.yaw || 0}deg`"
                  disable-zoom
                  disable-pan
                  camera-controls="false"
                ></model-viewer>
              </div>
            </template>
          </div>
        </template>

        <!-- 画布缩放与平移 HUD 控制浮层 -->
        <div
          v-if="activeTool !== 'outpaint'"
          class="absolute bottom-5 right-5 z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-studio-900/90 border border-studio-700/80 shadow-2xl backdrop-blur text-slate-300"
        >
          <button
            type="button"
            @click="zoomOut"
            class="w-7 h-7 rounded hover:bg-studio-800 text-white font-bold flex items-center justify-center transition-colors cursor-pointer"
            title="缩小 (滚轮下滑)"
          >
            -
          </button>
          <button
            type="button"
            @click="resetZoom"
            class="px-2 py-0.5 rounded text-xs font-mono font-bold text-slate-200 hover:text-white hover:bg-studio-800 transition-colors cursor-pointer"
            title="点击重置 100%"
          >
            {{ Math.round(canvasZoom * 100) }}%
          </button>
          <button
            type="button"
            @click="zoomIn"
            class="w-7 h-7 rounded hover:bg-studio-800 text-white font-bold flex items-center justify-center transition-colors cursor-pointer"
            title="放大 (滚轮上滑)"
          >
            +
          </button>
          <div class="h-4 w-px bg-studio-750 mx-1"></div>
          <button
            type="button"
            @click="resetZoom"
            class="px-2.5 py-1 rounded bg-studio-800/80 hover:bg-studio-750 text-[11px] font-medium text-slate-200 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
          >
            <StudioIcon name="maximize-2" :size="11" />
            <span>适应画布</span>
          </button>
        </div>

        <!-- 多边形采集顶部操作指引胶囊 -->
        <div
          v-if="activeTool === 'polygon' && polyDraftPoints.length > 0"
          class="absolute top-4 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-studio-900/95 border border-indigo-500/60 shadow-2xl flex items-center gap-3 backdrop-blur"
        >
          <span class="text-xs font-medium text-slate-200 flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
            <span>已标记 <strong class="text-indigo-400 font-mono">{{ polyDraftPoints.length }}</strong> 个点 ·</span>
            <span v-if="polyDraftPoints.length < 3">至少采集 3 个点</span>
            <span v-else class="text-emerald-400">双击画布、点击起点或按 Enter 闭合</span>
          </span>
          <button
            v-if="polyDraftPoints.length >= 3"
            type="button"
            @click.stop="finishPolygon"
            class="px-2.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow cursor-pointer transition-colors"
          >
            完成闭合
          </button>
          <button
            type="button"
            @click.stop="cancelPolygon"
            class="px-2 py-0.5 rounded bg-studio-800 hover:bg-studio-700 text-slate-300 text-xs cursor-pointer transition-colors"
          >
            取消 (Esc)
          </button>
        </div>
      </main>

      <!-- 2.3 右侧配置面板 (物理绝对硬锁定 380px，彻底防撑爆) -->
      <aside
        v-if="!cropOnly"
        class="w-[380px] min-w-[380px] max-w-[380px] bg-studio-900 border-l border-studio-700 flex flex-col shrink-0 overflow-hidden select-none"
        style="width: 380px; min-width: 380px; max-width: 380px;"
      >
        <!-- 面板顶栏 -->
        <div class="p-3 border-b border-studio-800 flex items-center justify-between shrink-0">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-white">区域方案与空间操作</span>
            <span class="px-2 py-0.5 rounded-full bg-studio-800 text-slate-400 font-mono text-[11px]">
              {{ regions.length }} 个区域
            </span>
          </div>
          <button
            type="button"
            @click="addNewRegion"
            class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-studio-accent/20 hover:bg-studio-accent/30 text-studio-accent text-xs font-bold border border-studio-accent/40 cursor-pointer transition-colors"
          >
            <StudioIcon name="plus" :size="12" />
            <span>新建区域</span>
          </button>
        </div>

        <!-- 阶段一：选择与定位区域 (Selection & Region Switching) -->
        <div class="p-3 border-b border-studio-800 shrink-0 bg-studio-950/60 space-y-2.5">
          <div class="flex items-center justify-between">
            <div class="text-[11px] font-bold text-studio-cyan flex items-center gap-1.5 uppercase font-mono">
              <span class="w-4 h-4 rounded bg-studio-cyan/20 text-studio-cyan flex items-center justify-center text-[10px] font-bold">1</span>
              <span>第一阶段：选择或定位区域</span>
            </div>
            <span class="text-[10px] text-slate-500 font-mono">点击切换活动选区</span>
          </div>

          <!-- 选区清单水平滑动选择条 -->
          <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
            <div
              v-for="reg in regions"
              :key="reg.id"
              @click="activeRegionId = reg.id"
              :class="[
                'px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 transition-all',
                activeRegionId === reg.id
                  ? 'bg-studio-800 text-white shadow-md'
                  : 'bg-studio-900 text-slate-400 border-studio-750 hover:border-slate-500'
              ]"
              :style="{
                borderColor: reg.color?.border || '#3B82F6',
                boxShadow: activeRegionId === reg.id ? `0 0 10px ${reg.color?.border}40` : 'none'
              }"
            >
              <span
                class="w-2.5 h-2.5 rounded-full shrink-0"
                :style="{ backgroundColor: reg.color?.border || '#3B82F6' }"
              ></span>
              <span>{{ reg.name }}</span>
              <button
                type="button"
                @click.stop="removeRegion(reg.id)"
                class="hover:text-rose-400 p-0.5 cursor-pointer ml-1"
                title="删除此选区"
              >
                <StudioIcon name="close" :size="10" />
              </button>
            </div>
            <div v-if="regions.length === 0" class="text-xs text-slate-400 py-6 text-center space-y-1">
              <div class="text-xl">📐</div>
              <div class="font-bold text-slate-300">暂无任何选区</div>
              <div class="text-[11px] text-slate-500">请使用左侧【矩形选框】或【多点选区】工具在画面上框选</div>
            </div>
          </div>

          <!-- 激活区域基本属性：名称 + 颜色 + Seedream 5.0 归一化坐标实时 HUD -->
          <div v-if="activeRegion" class="pt-2 border-t border-studio-800/80 space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-mono text-slate-400 shrink-0">名称:</span>
              <input
                v-model="activeRegion.name"
                class="w-24 px-2.5 py-1 rounded bg-studio-900 border border-studio-750 text-xs font-bold text-white outline-none focus:border-studio-cyan"
                placeholder="例如：区域1"
              />
              <!-- 8色高对比度直接平铺调色盘 -->
              <div class="flex-1 flex items-center justify-end gap-1.5 overflow-x-auto py-0.5 scrollbar-none">
                <button
                  v-for="c in REGION_COLORS"
                  :key="c.name"
                  type="button"
                  @click="setRegionColor(activeRegion, c)"
                  class="w-5 h-5 rounded-md border transition-all cursor-pointer flex items-center justify-center shrink-0"
                  :style="{ backgroundColor: c.hex, borderColor: activeRegion.color?.name === c.name ? '#FFFFFF' : 'rgba(255,255,255,0.2)' }"
                  :class="activeRegion.color?.name === c.name ? 'ring-2 ring-white scale-110 shadow' : 'hover:scale-105 opacity-80 hover:opacity-100'"
                  :title="`设为${c.name}线框`"
                >
                  <span v-if="activeRegion.color?.name === c.name" class="text-[9px] font-bold" :class="['黄色', '白色', '青色'].includes(c.name) ? 'text-black' : 'text-white'">✓</span>
                </button>
              </div>
            </div>

            <!-- 归一化坐标展示 (符合火山规范 [0, 999]) -->
            <div class="bg-studio-900/80 px-2.5 py-1.5 rounded border border-studio-800 text-[10px] font-mono text-slate-400 flex items-center justify-between">
              <span class="text-slate-500">归一化坐标 (0~999):</span>
              <span class="text-studio-accent font-bold">
                &lt;bbox&gt;{{ getNormalizedBboxStr(activeRegion) }}&lt;/bbox&gt;
              </span>
            </div>

            <!-- 局部切片提取入口 (支持矩形、多边形不规则扣图、画笔) -->
            <div class="flex items-center justify-between pt-1">
              <span class="text-[10px] text-slate-400">局部切片提取:</span>
              <button
                type="button"
                @click="extractRegionSlice(activeRegion)"
                class="px-2.5 py-1 rounded-lg bg-studio-800 hover:bg-studio-750 text-studio-cyan font-bold text-xs flex items-center gap-1.5 transition border border-studio-700 cursor-pointer shadow-xs"
              >
                <StudioIcon name="crop" :size="12" />
                <span>✂️ 提取透明切片</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 阶段二：为选区配置操作方案 (Operation Configuration for Active Region) -->
        <div v-if="activeRegion" class="flex-1 overflow-y-auto p-3.5 space-y-3.5 scrollbar-thin">
          <div class="flex items-center justify-between">
            <div class="text-[11px] font-bold text-studio-accent flex items-center gap-1.5 uppercase font-mono">
              <span class="w-4 h-4 rounded bg-studio-accent/20 text-studio-accent flex items-center justify-center text-[10px] font-bold">2</span>
              <span>第二阶段：为该区域赋予操作方案</span>
            </div>
            <span class="text-[10px] text-slate-400 font-mono">当前配置: {{ activeRegion.name }}</span>
          </div>

          <div class="grid grid-cols-3 gap-1.5">
            <button v-for="item in guideTypes" :key="item.type" type="button" @click="setGuideType(activeRegion, item.type)" :class="guideButtonClass(activeRegion, item.type)">
              {{ item.label }}
            </button>
          </div>

          <div v-if="activeGuide.type === 'remove' || activeGuide.type === 'blank'" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2">
            <div class="text-[11px] font-bold text-slate-200">{{ activeGuide.type === 'remove' ? '删' : '留白' }}</div>
            <textarea :value="activeGuide.text || builtinGuideText(activeGuide.type)" rows="3" class="w-full px-3 py-2 rounded-lg bg-studio-900 border border-studio-750 text-xs text-slate-100 outline-none" @input="setGuideText(activeRegion, $event.target.value)"></textarea>
          </div>

          <div v-else-if="activeGuide.type === 'custom'" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2">
            <input :value="activeGuide.name" class="w-full px-3 py-1.5 rounded-lg bg-studio-900 border border-studio-750 text-xs text-white outline-none" placeholder="指南名称" @input="activeGuide.name = $event.target.value" />
            <textarea :value="activeGuide.text" rows="3" class="w-full px-3 py-2 rounded-lg bg-studio-900 border border-studio-750 text-xs text-slate-100 outline-none" placeholder="写下这一框要做的事" @input="setGuideText(activeRegion, $event.target.value)"></textarea>
          </div>

          <div v-else-if="activeGuide.type === 'add' || activeGuide.type === 'replace'" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-3">
            <div class="flex flex-wrap gap-1">
              <button v-for="cat in objectCatalog" :key="cat.key" type="button" class="px-2 py-1 rounded text-[10px] cursor-pointer" :class="activeGuide.objectCategory === cat.key ? 'bg-amber-500 text-black font-bold' : 'bg-studio-850 text-slate-300'" @click="setObjectCategory(activeRegion, cat.key)">{{ cat.label }}</button>
            </div>
            <div v-if="currentObjects.length === 0" class="text-[11px] text-slate-500">这一类还没有单品。</div>
            <div v-else class="space-y-1">
              <button v-for="item in currentObjects" :key="item.url" type="button" class="w-full text-left px-2 py-1.5 rounded-lg border text-[11px] cursor-pointer" :class="activeGuide.objectUrl === item.url ? 'border-amber-400 text-white' : 'border-studio-800 text-slate-300'" @click="setGuideObject(activeRegion, item)">{{ item.name }}</button>
            </div>
            <button v-if="activeGuide.suggestion && !suggestionAccepted(activeGuide)" type="button" class="w-full text-left px-2 py-1.5 rounded-lg bg-studio-cyan/10 border border-studio-cyan/40 text-[11px] text-studio-cyan cursor-pointer" @click="acceptSuggestion(activeRegion)">
              建议 {{ activeGuide.suggestion.label }}<span v-if="activeGuide.suggestion.hex"> {{ activeGuide.suggestion.hex }}</span>
            </button>
            <div class="flex flex-wrap gap-1">
              <button v-for="skin in skinChoices" :key="skin.key" type="button" class="px-2 py-1 rounded text-[10px] cursor-pointer" :class="activeGuide.subclass === skin.key ? 'bg-studio-accent text-white' : 'bg-studio-850 text-slate-300'" @click="setGuideSkin(activeRegion, skin)">{{ skin.label }}</button>
            </div>
            <!-- 材质专属常用色快捷胶囊 -->
            <div v-if="SKIN_COLOR_PRESETS[activeGuide.subclass]" class="flex flex-wrap gap-1.5 pt-0.5">
              <button
                v-for="sw in SKIN_COLOR_PRESETS[activeGuide.subclass]"
                :key="sw.hex"
                type="button"
                class="px-2 py-0.5 rounded text-[10px] flex items-center gap-1 border transition cursor-pointer"
                :class="activeGuide.colorHex === sw.hex ? 'border-amber-400 bg-studio-800 text-white font-bold' : 'border-studio-800 bg-studio-900 text-slate-300 hover:border-studio-700'"
                @click="setGuideColor(activeRegion, sw.hex, sw.label)"
              >
                <span class="w-2 h-2 rounded-full border border-black/40" :style="{ backgroundColor: sw.hex }"></span>
                <span>{{ sw.label }}</span>
              </button>
            </div>
            <label class="flex items-center justify-between text-[11px] text-slate-300">
              <span>自定义颜色</span>
              <input type="color" :value="activeGuide.colorHex || '#d8cbb7'" class="w-8 h-8 bg-transparent cursor-pointer" @input="setGuideColor(activeRegion, $event.target.value)" />
            </label>
            <label class="block text-[11px] text-slate-300">
              朝向 {{ activeGuide.yaw || 0 }}°
              <input type="range" min="-180" max="180" step="5" :value="activeGuide.yaw || 0" class="w-full" @change="setGuideYaw(activeRegion, $event.target.value)" />
            </label>
          </div>

          <div v-else-if="activeGuide.type === 'resurface'" class="p-3 rounded-xl bg-studio-950 border border-studio-800">
            <ResurfaceDrawer
              :guide="activeGuide"
              :surface="activeGuide.part || activeGuide.surface"
              :subclass="activeGuide.subclass"
              :inferred-prob="activeRegion.inferredProb || 0"
              :recommended-category-id="activeGuide.recommended_category_id || activeGuide.recommendedCategoryId || ''"
              :default-swatch="activeGuide.default_swatch || activeGuide.defaultSwatch || null"
              @update:guide="Object.assign(activeGuide, $event)"
              @change="Object.assign(activeGuide, $event)"
            />
          </div>

          <div v-else class="text-[11px] text-slate-500 px-1">先选一种操作指南。槽位是空的，选过的内容才会写进配方。</div>

          <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-slate-200">我的指南</span>
              <button type="button" class="text-[11px] text-studio-cyan cursor-pointer" @click="saveCurrentGuide">收成方案</button>
            </div>
            <div v-if="guideNotice" class="text-[11px] text-amber-200">{{ guideNotice }}</div>
            <div v-if="savedGuides.length === 0" class="text-[11px] text-slate-500">还没有保存的指南。填完就能生图，想下次再用再收成方案。</div>
            <div v-for="item in savedGuides" :key="item.id" class="flex items-center gap-2 text-[11px]">
              <button type="button" class="flex-1 text-left truncate text-slate-200 cursor-pointer" @click="requestApplyGuide(item)">{{ item.name }}</button>
              <span class="text-slate-500 shrink-0">{{ guideTypeLabel(item.type) }}</span>
              <button type="button" class="text-rose-300 cursor-pointer" @click="removeSavedGuide(item.id)">删除</button>
            </div>
            <div v-if="pendingGuideApply" class="rounded-lg border border-amber-500/40 p-2 space-y-2">
              <div class="text-[11px] text-amber-100">这条指南是{{ surfaceLabel(pendingGuideApply.slots.surface) }}，当前框是{{ surfaceLabel(activeGuide.surface) }}。确认后才换面。</div>
              <div class="flex gap-2">
                <button type="button" class="px-2 py-1 rounded bg-studio-accent text-white cursor-pointer" @click="confirmPendingGuide">确认换上</button>
                <button type="button" class="px-2 py-1 rounded bg-studio-800 text-slate-200 cursor-pointer" @click="pendingGuideApply = null">先不换</button>
              </div>
            </div>
          </div>

        </div>

        <!-- 标绘统计展示 -->
        <div class="p-3 border-t border-studio-800 shrink-0 bg-studio-950/60 text-xs text-slate-400 flex items-center justify-between">
          <span>当前画面即时标绘:</span>
          <span class="font-mono font-bold text-rose-400">
            {{ annotations.length }} 项 (箭头/文字/马赛克)
          </span>
        </div>
      </aside>
    </div>

    <!-- 3. 底栏 (高度 64px)：多行配方汇总只读预览 + 取消 + 完成并应用 -->
    <footer v-if="!cropOnly" class="h-16 px-6 border-t border-studio-700/80 bg-studio-900/95 flex items-center justify-between shrink-0">
      <div class="flex-1 min-w-0 mr-6">
        <div class="text-[10px] font-mono text-slate-500 uppercase tracking-wider">配方句实时汇总预览</div>
        <div class="text-xs text-slate-200 truncate font-medium mt-0.5">
          {{ activeTool === 'crop' ? '裁剪只替换当前参考图，不改配方句' : (formattedRecipeSummary || '未配置空间操作，纯即时标绘将生成视觉参考图交付') }}
        </div>
      </div>

      <div class="flex items-center gap-3 shrink-0">
        <button
          type="button"
          @click="handleCancel"
          class="px-4 py-2 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-300 text-xs font-bold border border-studio-700 cursor-pointer transition-colors"
        >
          取消退出
        </button>

        <button
          type="button"
          @click="openConfirmModal"
          :disabled="activeTool === 'crop' && !cropBox"
          class="px-6 py-2 rounded-xl bg-studio-accent hover:bg-studio-accent/90 text-white text-xs font-bold shadow-lg shadow-studio-accent/20 cursor-pointer transition-all flex items-center gap-2 disabled:opacity-40"
        >
          <StudioIcon name="check" :size="15" />
          <span>{{ activeTool === 'crop' ? '确认裁剪' : '完成并应用' }}</span>
        </button>
      </div>
    </footer>

    <!-- 4. 极简确认浮层 (Confirmation Modal) -->
    <div
      v-if="showConfirmModal"
      class="fixed inset-0 z-60 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div class="w-full max-w-lg bg-studio-900 border border-studio-700 rounded-2xl shadow-2xl p-6 space-y-4">
        <div class="flex items-center justify-between border-b border-studio-800 pb-3">
          <div class="flex items-center gap-2">
            <StudioIcon name="wand" :size="16" class="text-studio-accent" />
            <h3 class="text-sm font-bold text-white">确认应用本次空间编辑</h3>
          </div>
          <button
            type="button"
            @click="showConfirmModal = false"
            class="text-slate-400 hover:text-white p-1 cursor-pointer"
          >
            <StudioIcon name="close" :size="15" />
          </button>
        </div>

        <div class="space-y-3 max-h-96 overflow-y-auto scrollbar-thin">
          <!-- 1. 空间配方写回项 -->
          <div v-if="regions.length > 0" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1.5">
            <div class="text-[11px] font-bold text-studio-accent flex items-center gap-1.5">
              <StudioIcon name="layers" :size="12" />
              <span>即将写回顶栏【配方句】的内容:</span>
            </div>
            <div class="text-xs text-slate-200 leading-relaxed font-mono whitespace-pre-wrap bg-studio-900/60 p-2 rounded">
              {{ formattedRecipeSummary }}
            </div>
          </div>

          <!-- 2. 参考图追加项 -->
          <div v-if="pendingNewRefs.length > 0" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2">
            <div class="text-[11px] font-bold text-studio-cyan flex items-center gap-1.5">
              <StudioIcon name="image" :size="12" />
              <span>即将追加挂载到参考图托盘 ({{ pendingNewRefs.length }} 张):</span>
            </div>
            <div class="flex items-center gap-2 overflow-x-auto pb-1">
              <div
                v-for="(refItem, rIdx) in pendingNewRefs"
                :key="rIdx"
                class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-studio-900 border border-studio-750 text-xs font-mono shrink-0"
              >
                <img :src="refItem.url" class="w-8 h-8 rounded object-cover border border-studio-700" alt="" />
                <div class="text-[11px]">
                  <div class="font-bold text-white">{{ refItem.tag }}</div>
                  <div class="text-slate-400 text-[10px]">{{ refItem.name }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. 底图即时修改说明 -->
          <div v-if="regions.length === 0 && annotations.length > 0" class="p-3 rounded-xl bg-studio-950 border border-studio-800 text-xs text-slate-300 leading-relaxed space-y-1">
            <div class="font-bold text-rose-400 flex items-center gap-1">
              <StudioIcon name="edit" :size="12" />
              <span>即时视觉标绘修改</span>
            </div>
            <div>
              本次将直接把绘制的红框、马赛克与箭头标记替换到看图区画面中。看图区卡片底栏将提供「已标注(撤回)」药丸按钮，随时可一键撤回原图。
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 pt-2 border-t border-studio-800">
          <button
            type="button"
            @click="showConfirmModal = false"
            class="px-4 py-2 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-300 text-xs font-bold cursor-pointer"
          >
            返回微调
          </button>
          <button
            type="button"
            @click="executeUnifiedApply"
            class="px-5 py-2 rounded-xl bg-studio-accent hover:bg-studio-accent/90 text-white text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
          >
            <StudioIcon name="check" :size="14" />
            <span>确认生效</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 5. 局部切片预览与保存模态弹窗 -->
    <div
      v-if="showSliceModal"
      class="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <div class="w-full max-w-md bg-studio-900 border border-studio-700 rounded-2xl shadow-2xl p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-studio-800 pb-3">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-studio-cyan"></span>
            <h3 class="text-sm font-bold text-white">局部选区切片已提取 (带透明通道)</h3>
          </div>
          <button type="button" @click="showSliceModal = false" class="text-slate-400 hover:text-white cursor-pointer">
            <StudioIcon name="close" :size="15" />
          </button>
        </div>

        <!-- 棋盘格透明背景预览 -->
        <div class="w-full aspect-video rounded-xl border border-studio-750 bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)] bg-[length:16px_16px] flex items-center justify-center overflow-hidden p-3 shadow-inner">
          <img :src="slicePreviewDataUrl" class="max-w-full max-h-full object-contain drop-shadow-xl" />
        </div>

        <div class="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>分辨率: <strong class="text-white font-mono">{{ sliceMetadata.w }} × {{ sliceMetadata.h }}</strong></span>
          <span class="text-studio-cyan font-bold">{{ sliceMetadata.isTransparent ? '✨ 不规则边缘透明抠图' : '矩形切片' }}</span>
        </div>

        <!-- 操作按钮组 -->
        <div class="grid grid-cols-2 gap-2 pt-2 border-t border-studio-800">
          <button
            type="button"
            @click="downloadSlicePng"
            class="py-2 px-3 rounded-xl bg-studio-800 hover:bg-studio-750 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer border border-studio-700"
          >
            <StudioIcon name="download" :size="14" />
            <span>下载透明 PNG</span>
          </button>
          <button
            type="button"
            @click="addSliceToReference"
            class="py-2 px-3 rounded-xl bg-studio-accent hover:bg-studio-accent/90 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-md"
          >
            <StudioIcon name="plus" :size="14" />
            <span>设为生图参考图</span>
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, reactive, watch, nextTick, onMounted, onUnmounted } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';
import { computeOutpaintNorm } from '../../../../src/outpaint-layout.mjs';
import ResurfaceDrawer from '../../components/studio/ResurfaceDrawer.vue';
import BaseAttrPicker from '../../components/BaseAttrPicker.vue';
import { authFetch, getToken } from '../../api';
import { mapSchemeToRegions } from '../../../../src/base-library/scheme-apply.mjs';
import { REGION_COLORS, calculateNormalizedBbox, computeImageEntityBbox, getNearestCanonicalRatio, extractDominantScenePalette } from '../../utils/model-protocol';
import { buildStructuredPrompt } from '../../utils/prompt-engine';
import { ensureModelViewer } from '../../utils/model-viewer.js';
import {
  BUILTIN_GUIDE_TEXT,
  GUIDE_TYPE_TO_OP,
  emptyGuide,
  formatGuideRecipe,
  applyGuide,
  commitGuide,
  skinLabel
} from '../../utils/guide-sentence';
import {
  MATERIAL_CATEGORIES,
  INTERIOR_COLOR_PALETTES,
  FINISH_OPTIONS,
  AGING_OPTIONS,
  buildBaseAttributesRecipe
} from '../../utils/material-presets';

const props = defineProps({
  visible: { type: Boolean, default: false },
  image: { type: Object, default: null },
  imageIndex: { type: Number, default: 0 },
  targetTag: { type: String, default: '@图1' },
  totalReferenceCount: { type: Number, default: 1 },
  cropOnly: { type: Boolean, default: false },
  selectedRatio: { type: String, default: '' }
});

const emit = defineEmits([
  'close',
  'apply-recipe-with-refs',
  'apply-regions-to-image',
  'apply-outpainted-image',
  'apply-custom-image'
]);

// 元素引用
const layerContainerRef = ref(null);
const canvasViewportRef = ref(null);
const mainCanvasWrapperRef = ref(null);
const baseImageRef = ref(null);
const mosaicCanvasRef = ref(null);
const inlineTextInputRef = ref(null);
const modelViewerMap = reactive(new Map());

function registerModelViewer(id, el) {
  if (el) modelViewerMap.set(id, el);
  else modelViewerMap.delete(id);
}

// 原图与天然尺寸
const imageSrc = computed(() => props.image?.url || props.image?.src || '');
const imgNaturalSize = reactive({ w: 0, h: 0 });
const canvasDisplaySize = reactive({ w: 800, h: 600 });

// 当前激活工具
// 'select' | 'rect' | 'polygon' | 'brush' | 'arrow' | 'text' | 'mosaic' | 'crop' | 'outpaint'
const activeTool = ref('select');
const cropRect = ref(null);

// 全画幅标准裁剪系统状态
const cropBox = ref({ x: 0, y: 0, w: 800, h: 600 });
const cropRatio = ref('free'); // 'free' | 'original' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
const activeCropDrag = ref(null); // { mode: 'handle' | 'move', handleKey, startX, startY, startBox }

function initCropBox() {
  const dw = canvasDisplaySize.w || 800;
  const dh = canvasDisplaySize.h || 600;
  cropBox.value = { x: 0, y: 0, w: dw, h: dh };
}

function setCropRatio(ratio) {
  cropRatio.value = ratio;
  const dw = canvasDisplaySize.w || 800;
  const dh = canvasDisplaySize.h || 600;
  if (ratio === 'free') return;
  let targetAspect = 1;
  if (ratio === 'original') {
    targetAspect = dw / dh;
  } else {
    const [rw, rh] = ratio.split(':').map(Number);
    targetAspect = rw / rh;
  }
  let newW = cropBox.value.w;
  let newH = newW / targetAspect;
  if (newH > dh) {
    newH = dh;
    newW = newH * targetAspect;
  }
  if (newW > dw) {
    newW = dw;
    newH = newW / targetAspect;
  }
  const centerX = cropBox.value.x + cropBox.value.w / 2;
  const centerY = cropBox.value.y + cropBox.value.h / 2;
  const newX = Math.max(0, Math.min(dw - newW, centerX - newW / 2));
  const newY = Math.max(0, Math.min(dh - newH, centerY - newH / 2));
  cropBox.value = { x: Math.round(newX), y: Math.round(newY), w: Math.round(newW), h: Math.round(newH) };
}

function getCropHandles() {
  const b = cropBox.value || { x: 0, y: 0, w: 0, h: 0 };
  return [
    { key: 'nw', x: b.x, y: b.y, cursor: 'nwse-resize' },
    { key: 'n', x: b.x + b.w / 2, y: b.y, cursor: 'ns-resize' },
    { key: 'ne', x: b.x + b.w, y: b.y, cursor: 'nesw-resize' },
    { key: 'e', x: b.x + b.w, y: b.y + b.h / 2, cursor: 'ew-resize' },
    { key: 'se', x: b.x + b.w, y: b.y + b.h, cursor: 'nwse-resize' },
    { key: 's', x: b.x + b.w / 2, y: b.y + b.h, cursor: 'ns-resize' },
    { key: 'sw', x: b.x, y: b.y + b.h, cursor: 'nesw-resize' },
    { key: 'w', x: b.x, y: b.y + b.h / 2, cursor: 'ew-resize' }
  ];
}

function onCropHandleDown(key, e) {
  e.stopPropagation();
  activeCropDrag.value = {
    mode: 'handle',
    handleKey: key,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startBox: { ...cropBox.value }
  };
}

function onCropMoveDown(e) {
  e.stopPropagation();
  activeCropDrag.value = {
    mode: 'move',
    startClientX: e.clientX,
    startClientY: e.clientY,
    startBox: { ...cropBox.value }
  };
}

// 局部切片预览弹窗状态与提取逻辑
const showSliceModal = ref(false);
const slicePreviewDataUrl = ref('');
const sliceMetadata = ref({ w: 0, h: 0, name: '', isTransparent: false });

async function extractRegionSlice(reg) {
  if (!reg || !baseImageRef.value) return;
  const img = baseImageRef.value;
  const dw = canvasDisplaySize.w || img.clientWidth || img.naturalWidth;
  const dh = canvasDisplaySize.h || img.clientHeight || img.naturalHeight;
  const scaleX = img.naturalWidth / dw;
  const scaleY = img.naturalHeight / dh;

  let minX, minY, maxX, maxY;
  if (reg.type === 'rect') {
    minX = reg.x;
    minY = reg.y;
    maxX = reg.x + reg.w;
    maxY = reg.y + reg.h;
  } else if (reg.type === 'polygon' && reg.points?.length >= 3) {
    minX = Math.min(...reg.points.map(p => p.x));
    maxX = Math.max(...reg.points.map(p => p.x));
    minY = Math.min(...reg.points.map(p => p.y));
    maxY = Math.max(...reg.points.map(p => p.y));
  } else {
    minX = reg.x || 0;
    minY = reg.y || 0;
    maxX = (reg.x || 0) + (reg.w || 100);
    maxY = (reg.y || 0) + (reg.h || 100);
  }

  const cropW = Math.max(1, Math.round((maxX - minX) * scaleX));
  const cropH = Math.max(1, Math.round((maxY - minY) * scaleY));

  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d');

  ctx.save();
  ctx.scale(scaleX, scaleY);
  ctx.translate(-minX, -minY);

  if (reg.type === 'polygon' && reg.points?.length >= 3) {
    ctx.beginPath();
    reg.points.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.clip(); // 不规则扣图：选区外部为完全透明
  }

  ctx.drawImage(img, 0, 0, dw, dh);
  ctx.restore();

  const dataUrl = canvas.toDataURL('image/png');
  slicePreviewDataUrl.value = dataUrl;
  sliceMetadata.value = {
    w: cropW,
    h: cropH,
    name: reg.name || '选区切片',
    isTransparent: reg.type === 'polygon'
  };
  showSliceModal.value = true;
}

function downloadSlicePng() {
  if (!slicePreviewDataUrl.value) return;
  const a = document.createElement('a');
  a.href = slicePreviewDataUrl.value;
  a.download = `${sliceMetadata.value.name}_${Date.now()}.png`;
  a.click();
}

function addSliceToReference() {
  if (!slicePreviewDataUrl.value) return;
  emit('apply-custom-image', {
    imageIndex: props.totalReferenceCount,
    dataUrl: slicePreviewDataUrl.value,
    asNewReference: true
  });
  showSliceModal.value = false;
  alert('已将该切片加入参考图栏！');
}

function setTool(tool) {
  activeTool.value = tool;
  if (tool === 'polygon') {
    polyDraftPoints.value = [];
  }
  if (tool === 'crop') {
    initCropBox();
  } else {
    activeCropDrag.value = null;
  }
  if (tool !== 'select') {
    selectedAnnotationIndex.value = null;
  }
}

// 选区体系数据结构 (用于写回配方句，默认纯净起手无选区)
const regions = ref([]);
const activeRegionId = ref(null);
const schemeStyles = ref([]);
const schemeList = ref([]);
const schemeStyleId = ref('');
const schemeId = ref('');
const schemeSpace = ref('living');
const schemeApplyNote = ref('');

const activeRegion = computed(() => {
  return regions.value.find((r) => r.id === activeRegionId.value) || null;
});

const guideTypes = [
  { type: 'add', label: '增' },
  { type: 'remove', label: '删' },
  { type: 'replace', label: '改物件' },
  { type: 'resurface', label: '改表皮' },
  { type: 'blank', label: '留白' },
  { type: 'custom', label: '自定义文字' }
];
const skinChoices = [
  { key: 'soft_leather', label: '真皮' },
  { key: 'soft_fabric', label: '织物' },
  { key: 'soft_veneer', label: '木皮' },
  { key: 'soft_metal', label: '金属' }
];
const SKIN_COLOR_PRESETS = {
  soft_leather: [
    { label: '曜石黑', hex: '#232325' },
    { label: '马鞍棕', hex: '#8B4A2B' },
    { label: '焦糖棕', hex: '#A65E36' },
    { label: '大象灰', hex: '#8D847B' },
    { label: '象牙白', hex: '#EFEBE3' }
  ],
  soft_fabric: [
    { label: '云朵白', hex: '#F4EFE6' },
    { label: '燕麦麻', hex: '#DFD3C3' },
    { label: '暖杏色', hex: '#CFBFA8' },
    { label: '炭灰', hex: '#585654' },
    { label: '墨绿丝绒', hex: '#4A5D4E' }
  ],
  soft_veneer: [
    { label: '白橡木', hex: '#DFCBB2' },
    { label: '原木橡', hex: '#C8A97E' },
    { label: '樱桃木', hex: '#B37A4C' },
    { label: '黑胡桃', hex: '#5C4030' },
    { label: '炭化乌木', hex: '#362D28' }
  ],
  soft_metal: [
    { label: '拉丝黄铜', hex: '#C59B5F' },
    { label: '香槟暗金', hex: '#B8A282' },
    { label: '哑光黑钛', hex: '#28282A' },
    { label: '电镀银', hex: '#D8DCDF' }
  ]
};
const objectCatalog = ref([
  { key: 'sofa', label: '沙发', items: [
    { name: '单人电动科技沙发', url: '/models/sofa_electric_single.glb' },
    { name: '意式极简双人沙发', url: '/models/sofa_model.glb' },
    { name: '北欧布艺现代沙发', url: '/models/sofa_default.glb' }
  ] },
  { key: 'chair', label: '椅', items: [] },
  { key: 'table', label: '桌', items: [
    { name: '空间落地收纳柜', url: '/models/user_model.glb' }
  ] },
  { key: 'light', label: '灯', items: [] },
  { key: 'fixture', label: '洁具', items: [] }
]);
const savedGuides = ref([]);
const guideNotice = ref('');
const pendingGuideApply = ref(null);
const activeGuide = computed(() => activeRegion.value?.guide || emptyGuide());
const currentObjects = computed(() => objectCatalog.value.find((item) => item.key === activeGuide.value.objectCategory)?.items || []);

async function fetchProductPresets() {
  try {
    const token = getToken();
    const res = await fetch('/api/products/presets', {
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    });
    if (res.ok) {
      const json = await res.json();
      const presets = json.data || json;
      if (Array.isArray(presets) && presets.length > 0) {
        const catMap = {
          sofa: { key: 'sofa', label: '沙发', items: [] },
          chair: { key: 'chair', label: '椅', items: [] },
          table: { key: 'table', label: '桌', items: [] },
          light: { key: 'light', label: '灯', items: [] },
          fixture: { key: 'fixture', label: '洁具', items: [] }
        };
        for (const p of presets) {
          const item = {
            id: p.id,
            name: p.name,
            url: p.model_url || `/models/${p.model_file || p.id + '.glb'}`,
            preview_url: p.preview_url,
            facing: typeof p.facing === 'number' ? p.facing : 45
          };
          const rawCat = String(p.category || '').toLowerCase();
          const pName = String(p.name || '').toLowerCase();
          if (rawCat === 'chair' || pName.includes('椅')) {
            catMap.chair.items.push(item);
          } else if (rawCat === 'table' || pName.includes('桌') || pName.includes('柜')) {
            catMap.table.items.push(item);
          } else if (rawCat === 'light' || pName.includes('灯')) {
            catMap.light.items.push(item);
          } else if (rawCat === 'fixture' || pName.includes('洁具') || pName.includes('卫浴')) {
            catMap.fixture.items.push(item);
          } else {
            catMap.sofa.items.push(item);
          }
        }
        objectCatalog.value = Object.values(catMap);
      }
    }
  } catch (err) {
    console.warn('[StudioEditLayer] fetchProductPresets error:', err.message);
  }
}

function surfaceLabel(key) {
  const labels = { ceiling: '天花', wall: '墙面', floor: '地面', millwork: '全屋定制', furniture: '活动家具', soft: '软装', lighting: '灯具', fixture: '卫浴五金' };
  return labels[key] || '未识别';
}
function guideTypeLabel(type) {
  return guideTypes.find((item) => item.type === type)?.label || type;
}
function guideButtonClass(reg, type) {
  const on = reg?.guide?.type === type;
  return on
    ? 'px-2 py-2 rounded-lg border text-xs font-bold bg-studio-accent/20 border-studio-accent text-studio-accent cursor-pointer'
    : 'px-2 py-2 rounded-lg border text-xs font-bold bg-studio-950 border-studio-800 text-slate-300 cursor-pointer';
}
function builtinGuideText(type) {
  return BUILTIN_GUIDE_TEXT[type] || '';
}
function ensureGuide(reg) {
  if (!reg.guide) reg.guide = emptyGuide();
  if (!reg.params) reg.params = {};
  return reg.guide;
}
function sampleSceneHex(img) {
  if (!img || !img.naturalWidth) return '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 24, 24);
    const data = ctx.getImageData(0, 0, 24, 24).data;
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let i = 0; i < data.length; i += 16) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
    }
    const hex = (value) => Math.max(0, Math.min(255, Math.round(value / (n || 1)))).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch (_) {
    return '';
  }
}
function suggestionFor(category) {
  const key = category === 'table' ? 'soft_veneer' : ((category === 'light' || category === 'fixture') ? 'soft_metal' : 'soft_fabric');
  return { subclass: key, label: skinLabel(key), hex: sampleSceneHex(baseImageRef.value), accepted: false };
}
function setGuideType(reg, type) {
  const guide = ensureGuide(reg);
  guide.type = type;
  reg.op = GUIDE_TYPE_TO_OP[type] || '';
  if (type === 'resurface') {
    if (!guide.part && !guide.surface && !reg.inferredSurface) {
      triggerRegionClassification(reg);
    }
  }
  if (type === 'add' || type === 'replace') {
    fetchProductPresets();
    if (!guide.suggestion) {
      if (!guide.objectCategory) guide.objectCategory = 'sofa';
      guide.suggestion = suggestionFor(guide.objectCategory);
    }
  }
}
function setGuideText(reg, value) {
  ensureGuide(reg).text = value;
}
function setObjectCategory(reg, key) {
  const guide = ensureGuide(reg);
  guide.objectCategory = key;
  guide.suggestion = suggestionFor(key);
}
function setGuideObject(reg, item) {
  const guide = ensureGuide(reg);
  guide.objectName = item.name;
  guide.objectUrl = item.url;
  reg.params.glbUrl = item.url;
  reg.params.modelName = item.name;
}
function setGuideSkin(reg, skin) {
  const guide = ensureGuide(reg);
  guide.subclass = skin.key;
  guide.materialName = skin.label;
  if (SKIN_COLOR_PRESETS[skin.key] && SKIN_COLOR_PRESETS[skin.key].length > 0) {
    guide.colorHex = SKIN_COLOR_PRESETS[skin.key][0].hex;
    guide.colorName = SKIN_COLOR_PRESETS[skin.key][0].label;
  }
}
function setGuideColor(reg, hex, label = '') {
  const guide = ensureGuide(reg);
  guide.colorHex = hex;
  if (label) guide.colorName = label;
}
function setGuideYaw(reg, value) {
  const guide = ensureGuide(reg);
  guide.yaw = Number(value) || 0;
  guide.yawTouched = true;
  reg.params.yaw = guide.yaw;
}
function suggestionAccepted(guide) {
  return Boolean(guide?.suggestion?.accepted);
}
function acceptSuggestion(reg) {
  const guide = ensureGuide(reg);
  if (!guide.suggestion) return;
  guide.subclass = guide.suggestion.subclass;
  guide.materialName = guide.suggestion.label;
  if (guide.suggestion.hex) guide.colorHex = guide.suggestion.hex;
  guide.suggestion = { ...guide.suggestion, accepted: true };
}
function onGuideSurface(key) {
  if (!activeRegion.value) return;
  const guide = ensureGuide(activeRegion.value);
  guide.surface = key;
  guide.surfaceSource = 'manual';
  guide.subclass = '';
  guide.materialName = '';
  guide.assetId = '';
  guide.colorHex = '';
}
function shortMaterialLabel(label) {
  const text = String(label || '').trim();
  const idx = text.lastIndexOf('-');
  return idx >= 0 ? text.slice(idx + 1).trim() : text;
}
function onGuideSubclass(key, sub) {
  if (!activeRegion.value) return;
  const guide = ensureGuide(activeRegion.value);
  const warehouses = Array.isArray(sub?.warehouses) ? sub.warehouses : [];
  const paintOnly = warehouses.length > 0 && warehouses.every((item) => item === 'paint');
  guide.subclass = key;
  guide.assetId = '';
  guide.materialName = paintOnly ? '' : shortMaterialLabel(sub?.label);
  guide.colorHex = '';
  guide.finish = '';
  guide.roughness = null;
  guide.aging = '';
}
function onGuideMaterial(item) {
  if (!activeRegion.value) return;
  const guide = ensureGuide(activeRegion.value);
  guide.assetId = item.id;
  guide.materialName = item.name_cn;
}
function onGuideColor(hex) {
  if (!activeRegion.value) return;
  ensureGuide(activeRegion.value).colorHex = hex;
}
function onGuideFinish(id) {
  if (!activeRegion.value) return;
  ensureGuide(activeRegion.value).finish = id;
}
function onGuideRoughness(value) {
  if (!activeRegion.value) return;
  ensureGuide(activeRegion.value).roughness = Number(value);
}
function onGuideAging(id) {
  if (!activeRegion.value) return;
  ensureGuide(activeRegion.value).aging = id;
}
function guideSlots(reg) {
  const guide = ensureGuide(reg);
  return { ...guide, suggestion: guide.suggestion ? { ...guide.suggestion } : null };
}
async function loadSavedGuides() {
  try {
    const res = await authFetch('/api/base-library/guides');
    const json = await res.json();
    savedGuides.value = json?.data || [];
  } catch (_) {
    savedGuides.value = [];
  }
}
async function saveCurrentGuide() {
  const reg = activeRegion.value;
  if (!reg?.guide?.type) {
    guideNotice.value = '先选一种指南';
    return;
  }
  const name = (reg.guide.name || '').trim() || `${guideTypeLabel(reg.guide.type)} ${reg.name || ''}`.trim();
  try {
    const res = await authFetch('/api/base-library/guides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: reg.guide.type, slots: guideSlots(reg) })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      guideNotice.value = json.error || '没有保存';
      return;
    }
    guideNotice.value = `已收成「${name}」`;
    await loadSavedGuides();
  } catch (_) {
    guideNotice.value = '没有保存';
  }
}
function requestApplyGuide(item) {
  const reg = activeRegion.value;
  if (!reg) return;
  const saved = { ...(item.slots || {}), type: item.type, name: item.name };
  const result = applyGuide(reg.guide || emptyGuide(), saved);
  if (result.needsConfirm) {
    pendingGuideApply.value = item;
    return;
  }
  reg.guide = result.guide;
  reg.op = GUIDE_TYPE_TO_OP[result.guide.type] || '';
  if (result.guide.objectUrl) {
    reg.params = reg.params || {};
    reg.params.glbUrl = result.guide.objectUrl;
    reg.params.modelName = result.guide.objectName;
    reg.params.yaw = result.guide.yaw || 0;
  }
  pendingGuideApply.value = null;
}
function confirmPendingGuide() {
  const reg = activeRegion.value;
  const item = pendingGuideApply.value;
  if (!reg || !item) return;
  reg.guide = commitGuide({ ...(item.slots || {}), type: item.type, name: item.name });
  reg.op = GUIDE_TYPE_TO_OP[reg.guide.type] || '';
  pendingGuideApply.value = null;
}
async function removeSavedGuide(id) {
  await authFetch(`/api/base-library/guides/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await loadSavedGuides();
}

// 基础属性状态与配置
const finishOptions = FINISH_OPTIONS;
const agingOptions = AGING_OPTIONS;

async function loadSchemeStyles() {
  try {
    const res = await authFetch('/api/base-library/styles');
    const json = await res.json();
    if (!json.success) {
      schemeApplyNote.value = json.error || '风格列表加载失败';
      return;
    }
    schemeStyles.value = json.data || [];
    if (!schemeStyleId.value) {
      const ready = schemeStyles.value.find((style) => style.scheme_count > 0) || schemeStyles.value[0];
      if (ready) {
        schemeStyleId.value = ready.id;
        await loadSchemesForStyle();
      }
    }
  } catch (err) {
    schemeApplyNote.value = '风格列表加载失败';
  }
}

async function loadSchemesForStyle() {
  schemeList.value = [];
  schemeId.value = '';
  if (!schemeStyleId.value) return;
  try {
    const res = await authFetch(`/api/base-library/schemes?style_id=${encodeURIComponent(schemeStyleId.value)}`);
    const json = await res.json();
    if (!json.success) {
      schemeApplyNote.value = json.error || '方案列表加载失败';
      return;
    }
    schemeList.value = json.data || [];
    if (schemeList.value[0]) schemeId.value = schemeList.value[0].id;
    schemeApplyNote.value = schemeList.value.length ? '' : '这个风格还没有方案';
  } catch (err) {
    schemeApplyNote.value = '方案列表加载失败';
  }
}

function itemPreviewUrl(slot) {
  const token = getToken();
  const base = `/api/base-library/items/${encodeURIComponent(slot.item_id)}/preview`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function applySelectedScheme() {
  const scheme = schemeList.value.find((row) => row.id === schemeId.value);
  if (!scheme) {
    schemeApplyNote.value = '请先选择一套方案';
    return;
  }
  const result = mapSchemeToRegions(regions.value, scheme, {
    spaceKey: schemeSpace.value,
    previewUrl: itemPreviewUrl
  });
  regions.value = result.regions;
  if (result.applied[0]) activeRegionId.value = result.applied[0].id;
  const written = result.applied.map((row) => `${row.name || '选区'}→${row.materialName}`).join('、');
  const missed = result.skipped.map((row) => `${row.name || '选区'}（${row.reason}）`).join('、');
  const parts = [];
  if (written) parts.push(`已写入 ${result.applied.length} 个选区：${written}`);
  if (missed) parts.push(`未写入：${missed}`);
  schemeApplyNote.value = parts.join('。') || '没有可写入的选区';
}

function onBaseAttrChange(val) {
  if (!activeRegion.value || !val) return;
  if (!activeRegion.value.params) activeRegion.value.params = {};
  activeRegion.value.params.baseAttr = val;
  activeRegion.value.params.surface = val.surface;
  activeRegion.value.params.subclass = val.subclass;
  activeRegion.value.params.warehouse = val.warehouse || (val.mode === 'model' ? 'model' : 'material');
  activeRegion.value.params.asset_id = val.asset_id || null;
  activeRegion.value.params.item_id = val.item_id || null;
  activeRegion.value.params.model_id = val.model_id || null;

  if (val.material_name) {
    activeRegion.value.params.materialName = val.material_name;
  }
  if (val.hex) {
    activeRegion.value.params.colorHex = val.hex;
    activeRegion.value.params.colorName = val.hex;
  }
  if (val.craft) {
    activeRegion.value.params.craft = val.craft;
  }
  if (val.prompt_craft) {
    activeRegion.value.params.prompt_craft = val.prompt_craft;
  }
  if (val.finish) {
    activeRegion.value.params.finish = val.finish;
  }
  if (val.roughness !== undefined) {
    activeRegion.value.params.roughness = val.roughness;
  }
  if (val.aging) {
    activeRegion.value.params.aging = val.aging;
  }
  if (val.custom_texture_url) {
    activeRegion.value.params.materialTextureUrl = val.custom_texture_url;
  }
}

function hexToRgba(hex = '#3B82F6', alpha = 0.3) {
  if (!hex) return `rgba(59, 130, 246, ${alpha})`;
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c.split('').map((x) => x + x).join('');
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(59, 130, 246, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 计算归一化坐标字符串 (符合火山 Seedream 0~999 规范)
function getNormalizedBboxStr(reg) {
  if (!reg) return '0 0 0 0';
  return calculateNormalizedBbox(reg, canvasDisplaySize.w || 800, canvasDisplaySize.h || 600);
}

// 维护选区相对百分比与无损归一化（用于看图区任意缩放自适应覆盖渲染与模型坐标编译）
function syncRegionPercentages(reg) {
  if (!reg) return;
  const dw = Math.max(1, canvasDisplaySize.w || 800);
  const dh = Math.max(1, canvasDisplaySize.h || 600);
  reg.canvasWidth = dw;
  reg.canvasHeight = dh;
  if (reg.type === 'polygon' && Array.isArray(reg.points) && reg.points.length > 0) {
    const xs = reg.points.map((p) => p.x);
    const ys = reg.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const w = Math.max(2, maxX - minX);
    const h = Math.max(2, maxY - minY);
    reg.x = minX;
    reg.y = minY;
    reg.w = w;
    reg.h = h;
    reg.norm = {
      x: minX / dw,
      y: minY / dh,
      w: w / dw,
      h: h / dh,
    };
    reg.pct = {
      left: (minX / dw) * 100,
      top: (minY / dh) * 100,
      width: Math.max(2, (w / dw) * 100),
      height: Math.max(2, (h / dw) * 100),
    };
    reg.pctPoints = reg.points.map((p) => ({
      x: Number(((p.x / dw) * 100).toFixed(2)),
      y: Number(((p.y / dh) * 100).toFixed(2)),
    }));
    reg.normPoints = reg.points.map((p) => ({
      x: Number((p.x / dw).toFixed(4)),
      y: Number((p.y / dh).toFixed(4)),
    }));
  } else {
    const w = Math.max(2, reg.w || 20);
    const h = Math.max(2, reg.h || 20);
    const x = reg.x || 0;
    const y = reg.y || 0;
    reg.norm = {
      x: x / dw,
      y: y / dh,
      w: w / dw,
      h: h / dh,
    };
    reg.pct = {
      left: (x / dw) * 100,
      top: (y / dw) * 100,
      width: Math.max(2, (w / dw) * 100),
      height: Math.max(2, (h / dw) * 100),
    };
  }
}

// 归一化点集到视口像素投影 (保证任意尺寸/弹窗重开零形变、零坐标漂移)
function projectNormalizedDataToScreen(dw, dh) {
  if (!dw || !dh || dw <= 0 || dh <= 0) return;
  for (const r of regions.value) {
    if (r.type === 'polygon') {
      if (Array.isArray(r.normPoints) && r.normPoints.length >= 3) {
        r.points = r.normPoints.map((p) => ({ x: p.x * dw, y: p.y * dh }));
      } else if (Array.isArray(r.pctPoints) && r.pctPoints.length >= 3) {
        r.points = r.pctPoints.map((p) => ({ x: (p.x / 100) * dw, y: (p.y / 100) * dh }));
      }
      if (Array.isArray(r.points) && r.points.length > 0) {
        const xs = r.points.map((p) => p.x);
        const ys = r.points.map((p) => p.y);
        r.x = Math.min(...xs);
        r.y = Math.min(...ys);
        r.w = Math.max(2, Math.max(...xs) - r.x);
        r.h = Math.max(2, Math.max(...ys) - r.y);
      }
    } else {
      if (r.norm && typeof r.norm.x === 'number') {
        r.x = Math.round(r.norm.x * dw);
        r.y = Math.round(r.norm.y * dh);
        r.w = Math.max(10, Math.round(r.norm.w * dw));
        r.h = Math.max(10, Math.round(r.norm.h * dh));
      } else if (r.pct && typeof r.pct.left === 'number') {
        r.x = Math.round((r.pct.left / 100) * dw);
        r.y = Math.round((r.pct.top / 100) * dh);
        r.w = Math.max(10, Math.round((r.pct.width / 100) * dw));
        r.h = Math.max(10, Math.round((r.pct.height / 100) * dh));
      }
    }
  }

  // 标绘几何投影
  for (const a of annotations.value) {
    if (a.type === 'arrow') {
      if (typeof a.normX1 === 'number') a.x1 = a.normX1 * dw;
      if (typeof a.normY1 === 'number') a.y1 = a.normY1 * dh;
      if (typeof a.normX2 === 'number') a.x2 = a.normX2 * dw;
      if (typeof a.normY2 === 'number') a.y2 = a.normY2 * dh;
    } else if (a.type === 'text') {
      if (typeof a.normX === 'number') a.x = a.normX * dw;
      if (typeof a.normY === 'number') a.y = a.normY * dh;
    } else if (a.type === 'mosaic') {
      if (typeof a.normX === 'number') a.x = a.normX * dw;
      if (typeof a.normY === 'number') a.y = a.normY * dh;
      if (typeof a.normW === 'number') a.w = Math.max(10, a.normW * dw);
      if (typeof a.normH === 'number') a.h = Math.max(10, a.normH * dh);
    }
  }
}

// 监听弹层显示，还原底图已有选区与标绘
watch(() => props.visible, (val) => {
  if (val) {
    if (Array.isArray(props.image?.regions) && props.image.regions.length > 0) {
      regions.value = JSON.parse(JSON.stringify(props.image.regions));
      regions.value.forEach((r, idx) => {
        if (!r.color) r.color = REGION_COLORS[idx % REGION_COLORS.length];
      });
      activeRegionId.value = regions.value[0]?.id || null;
    } else {
      regions.value = [];
      activeRegionId.value = null;
    }
    if (Array.isArray(props.image?.annotations)) {
      annotations.value = JSON.parse(JSON.stringify(props.image.annotations));
    } else {
      annotations.value = [];
    }
    selectedAnnotationIndex.value = null;
    editingTextAnnotationIndex.value = null;
    activeDraggingAnnotation.value = null;

    nextTick(() => {
      syncDisplaySize();
      const dw = canvasDisplaySize.w;
      const dh = canvasDisplaySize.h;
      if (dw > 0 && dh > 0) {
        projectNormalizedDataToScreen(dw, dh);
      }
      nextTick(renderMosaicCanvas);
    });
    setTool(props.cropOnly ? 'rect' : 'select');
    schemeApplyNote.value = '';
    if (!props.cropOnly && !schemeStyles.value.length) loadSchemeStyles();
  }
});

function getCropNorm() {
  const list = regions.value || [];
  const reg = list.find((row) => row.id === activeRegionId.value) || list[list.length - 1];
  if (!reg) return null;
  if (reg.type === 'polygon' && Array.isArray(reg.normPoints) && reg.normPoints.length >= 3) {
    const xs = reg.normPoints.map((point) => point.x);
    const ys = reg.normPoints.map((point) => point.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return {
      x: x0,
      y: y0,
      w: Math.max(...xs) - x0,
      h: Math.max(...ys) - y0,
      poly: reg.normPoints.map((point) => ({ x: point.x, y: point.y }))
    };
  }
  const norm = reg.norm || (reg.normW ? { x: reg.normX, y: reg.normY, w: reg.normW, h: reg.normH } : null);
  if (!norm || !(norm.w > 0.02) || !(norm.h > 0.02)) return null;
  return { x: norm.x, y: norm.y, w: norm.w, h: norm.h, poly: null };
}

defineExpose({ getCropNorm });

async function triggerRegionClassification(reg) {
  if (props.cropOnly || !reg) return;
  let selection = null;
  if (reg.type === 'polygon' && reg.normPoints && reg.normPoints.length >= 3) {
    selection = {
      type: 'polygon',
      norm_points: reg.normPoints.map((p) => ({ x: p.x, y: p.y }))
    };
  } else if (reg.norm) {
    selection = {
      type: 'rect',
      norm: { x: reg.norm.x, y: reg.norm.y, w: reg.norm.w, h: reg.norm.h }
    };
  } else if (reg.normW && reg.normH) {
    selection = {
      type: 'rect',
      norm: { x: reg.normX, y: reg.normY, w: reg.normW, h: reg.normH }
    };
  }
  if (!selection) return;

  const payload = { selection };
  if (props.image && props.image.fid) {
    payload.asset_fid = props.image.fid;
  } else if (props.image && (props.image.url || props.image.src)) {
    const rawUrl = props.image.url || props.image.src;
    if (rawUrl.startsWith('data:')) {
      payload.image_base64 = rawUrl;
    } else {
      payload.asset_fid = props.image.fid || null;
    }
  }

  // 尝试前端提取切片纯净 JPEG Base64 (基于 reg.norm 原图直切，消除 Letterbox 屏幕视口漂移)
  try {
    const img = baseImageRef.value;
    const norm = reg.norm || (reg.normW && reg.normH ? { x: reg.normX, y: reg.normY, w: reg.normW, h: reg.normH } : null) || (
      reg.normPoints && reg.normPoints.length >= 3 ? {
        x: Math.min(...reg.normPoints.map((p) => p.x)),
        y: Math.min(...reg.normPoints.map((p) => p.y)),
        w: Math.max(...reg.normPoints.map((p) => p.x)) - Math.min(...reg.normPoints.map((p) => p.x)),
        h: Math.max(...reg.normPoints.map((p) => p.y)) - Math.min(...reg.normPoints.map((p) => p.y)),
      } : null
    );
    if (img && img.naturalWidth && norm) {
      const normX = Math.max(0, Math.min(1, Number(norm.x) || 0));
      const normY = Math.max(0, Math.min(1, Number(norm.y) || 0));
      const normW = Math.max(0.001, Math.min(1 - normX, Number(norm.w) || 0.1));
      const normH = Math.max(0.001, Math.min(1 - normY, Number(norm.h) || 0.1));

      let minX = Math.round(normX * img.naturalWidth);
      let minY = Math.round(normY * img.naturalHeight);
      let w = Math.round(normW * img.naturalWidth);
      let h = Math.round(normH * img.naturalHeight);

      minX = Math.max(0, Math.min(img.naturalWidth - 1, minX));
      minY = Math.max(0, Math.min(img.naturalHeight - 1, minY));
      w = Math.max(1, Math.min(img.naturalWidth - minX, w));
      h = Math.max(1, Math.min(img.naturalHeight - minY, h));

      let targetW = w;
      let targetH = h;
      if (Math.max(w, h) > 512) {
        const s = 512 / Math.max(w, h);
        targetW = Math.max(1, Math.round(w * s));
        targetH = Math.max(1, Math.round(h * s));
      } else if (Math.min(w, h) < 280) {
        const s = Math.min(280 / Math.max(1, Math.min(w, h)), 512 / Math.max(1, Math.max(w, h)));
        targetW = Math.max(1, Math.round(w * s));
        targetH = Math.max(1, Math.round(h * s));
      }

      const c = document.createElement('canvas');
      c.width = targetW;
      c.height = targetH;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, minX, minY, w, h, 0, 0, targetW, targetH);
      payload.crop_base64 = c.toDataURL('image/jpeg', 0.88);
      if (!reg.guide) reg.guide = emptyGuide();
      reg.guide.crop_base64 = payload.crop_base64;
      reg.guide.cropDataUrl = payload.crop_base64;
    }
  } catch (_) {}

  try {
    const token = getToken();
    const res = await fetch('/api/base-library/classify-region', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return;
    const json = await res.json();
    if (!json.success || !json.data) return;
    if (!reg.guide) reg.guide = emptyGuide();
    if (reg.guide.surfaceSource === 'manual') return;

    if (json.data.part || json.data.surface) {
      const part = json.data.part || json.data.surface;
      reg.inferredSurface = json.data.surface || part;
      reg.inferredProb = (json.data.probability != null ? json.data.probability : (json.data.confidence != null ? json.data.confidence : 0));
      reg.guide.part = part;
      reg.guide.surface = part;
      reg.guide.materialFamily = json.data.material_family || '';
      reg.guide.surfaceSource = 'auto';
      if (json.data.recommended_category_id) {
        reg.guide.recommended_category_id = json.data.recommended_category_id;
        reg.guide.recommendedCategoryId = json.data.recommended_category_id;
      }
      if (json.data.default_swatch) {
        reg.guide.default_swatch = json.data.default_swatch;
        reg.guide.defaultSwatch = json.data.default_swatch;
      }
      if (json.data.alternatives) reg.guide.alternatives = json.data.alternatives;
      if (json.data.dominant_hex) reg.guide.dominant_hex = json.data.dominant_hex;
      if (json.data.recommended_swatches) reg.guide.recommended_swatches = json.data.recommended_swatches;
      if (json.data.advice_zh) reg.guide.advice_zh = json.data.advice_zh;
    } else {
      reg.inferredSurface = '';
      reg.inferredProb = 0;
      if (reg.guide.surfaceSource !== 'manual') {
        reg.guide.part = '';
        reg.guide.surface = '';
        reg.guide.materialFamily = '';
      }
    }
  } catch (_) {}
}

// 即时标绘体系数据结构 (箭头、文字、马赛克)
const annotations = ref([]);
const redoStack = ref([]);

// 选中与交互式标绘体系状态
const selectedAnnotationIndex = ref(null);
const editingTextAnnotationIndex = ref(null);
const activeDraggingAnnotation = ref(null);

const arrowAnnotations = computed(() => annotations.value.map((a, idx) => ({ ...a, _origIdx: idx })).filter((a) => a.type === 'arrow'));
const textAnnotations = computed(() => annotations.value.map((a, idx) => ({ ...a, _origIdx: idx })).filter((a) => a.type === 'text'));
const mosaicAnnotations = computed(() => annotations.value.map((a, idx) => ({ ...a, _origIdx: idx })).filter((a) => a.type === 'mosaic'));

function onAnnotationMouseDown(idx, mode, e) {
  if (activeTool.value !== 'select') return;
  e.stopPropagation();
  selectedAnnotationIndex.value = idx;
  const ann = annotations.value[idx];
  if (!ann) return;

  activeDraggingAnnotation.value = {
    idx,
    mode,
    startClientX: e.clientX,
    startClientY: e.clientY,
    origAnn: JSON.parse(JSON.stringify(ann)),
  };
}

function startEditTextAnnotation(idx) {
  const ann = annotations.value[idx];
  if (!ann || ann.type !== 'text') return;
  selectedAnnotationIndex.value = idx;
  editingTextAnnotationIndex.value = idx;
  tempInputText.value = ann.text;
  textInputPos.x = ann.x;
  textInputPos.y = ann.y;
  isAddingText.value = true;
  nextTick(() => {
    inlineTextInputRef.value?.focus();
    inlineTextInputRef.value?.select();
  });
}

function changeTextFontSize(idx, delta) {
  const ann = annotations.value[idx];
  if (!ann || ann.type !== 'text') return;
  const current = ann.fontSize || 13;
  ann.fontSize = Math.max(10, Math.min(48, current + delta));
}

function deleteAnnotation(idx) {
  annotations.value.splice(idx, 1);
  if (selectedAnnotationIndex.value === idx) {
    selectedAnnotationIndex.value = null;
  }
  nextTick(renderMosaicCanvas);
}

watch(mosaicAnnotations, () => {
  nextTick(renderMosaicCanvas);
}, { deep: true });

function undoAnnotation() {
  if (annotations.value.length === 0) return;
  const popped = annotations.value.pop();
  redoStack.value.push(popped);
}

function redoAnnotation() {
  if (redoStack.value.length === 0) return;
  const item = redoStack.value.pop();
  annotations.value.push(item);
}

function clearAllAnnotations() {
  annotations.value = [];
  redoStack.value = [];
  regions.value = [];
  nextTick(renderMosaicCanvas);
}

// 莫兰迪调色板预设
const morandiColors = [
  { name: '冷杉灰绿', hex: '#6B8E8E' },
  { name: '燕麦奶咖', hex: '#C2B6A6' },
  { name: '深胡桃木', hex: '#5A3D28' },
  { name: '复古陶土', hex: '#A36855' },
  { name: '暗夜墨黑', hex: '#26292E' },
  { name: '极简米白', hex: '#ECE7DE' },
];

function setRegionColor(reg, c) {
  if (!reg || !c) return;
  reg.color = { ...c };
  syncRegionPercentages(reg);
}

function addNewRegion() {
  const nextIdx = regions.value.length + 1;
  const color = REGION_COLORS[(nextIdx - 1) % REGION_COLORS.length];
  const newReg = {
    id: 'reg_' + Date.now(),
    name: `区域${nextIdx}`,
    type: 'rect',
    x: 80 + (nextIdx % 5) * 20,
    y: 90 + (nextIdx % 5) * 20,
    w: 220,
    h: 160,
    points: [],
    color,
    op: '',
    guide: emptyGuide(),
    params: blankRegionParams()
  };
  syncRegionPercentages(newReg);
  regions.value.push(newReg);
  activeRegionId.value = newReg.id;
  setTool('select');
}

function removeRegion(id) {
  regions.value = regions.value.filter((r) => r.id !== id);
  if (activeRegionId.value === id) {
    activeRegionId.value = regions.value[0]?.id || null;
  }
}

function getOpDisplayName(op) {
  const map = {
    custom: '自定义文字',
    replace: '改物件',
    add: '增',
    erase: '删',
    recolor: '改表皮',
    blank: '留白'
  };
  return map[op] || '未选指南';
}

function blankRegionParams() {
  return {
    modelName: '',
    glbUrl: '',
    yaw: 0,
    customDesc: '',
    eraseDesc: '',
    snapshotUrl: null
  };
}

function onModelSelectChange() {
  if (!activeRegion.value) return;
  const map = {
    '/models/sofa_electric_single.glb': '单人电动科技沙发',
    '/models/sofa_model.glb': '意式极简双人沙发',
    '/models/sofa_default.glb': '北欧布艺现代沙发',
    '/models/user_model.glb': '空间落地收纳柜'
  };
  activeRegion.value.params.modelName = map[activeRegion.value.params.glbUrl] || '指定家具';
}

// -------------------------------------------------------------
// 选区交互体系：明确选择/拖动 vs 新建，修复缩放控点放大BUG
// -------------------------------------------------------------
const isDraggingNewRect = ref(false);
const currentDraftRect = ref(null);

const polyDraftPoints = ref([]);
const polyMouseHoverPoint = ref(null);

const brushPoints = ref([]);

const isDrawingArrow = ref(false);
const currentDraftArrow = ref(null);

const isAddingText = ref(false);
const textInputPos = reactive({ x: 0, y: 0 });
const tempInputText = ref('');

const activeDraggingHandle = ref(null);
const activeDraggingRegion = ref(null);
const activePolyVertexDrag = ref(null);

const cursorStyle = computed(() => {
  if (activeTool.value === 'arrow') return 'crosshair';
  if (activeTool.value === 'text') return 'text';
  if (activeTool.value === 'brush') return 'crosshair';
  if (activeTool.value === 'rect') return 'crosshair';
  if (activeTool.value === 'polygon') return 'crosshair';
  if (activeTool.value === 'mosaic') return 'crosshair';
  if (activeTool.value === 'crop') return 'crosshair';
  return 'default';
});

function getCanvasCoords(e) {
  const rect = baseImageRef.value?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  const scaleX = (canvasDisplaySize.w || rect.width) / rect.width;
  const scaleY = (canvasDisplaySize.h || rect.height) / rect.height;
  return {
    x: Math.round((e.clientX - rect.left) * scaleX),
    y: Math.round((e.clientY - rect.top) * scaleY)
  };
}

function onRegionBodyDown(reg, e) {
  if (activeTool.value !== 'select') return;
  e.stopPropagation();
  activeRegionId.value = reg.id;
  activeDraggingRegion.value = {
    reg,
    startClientX: e.clientX,
    startClientY: e.clientY,
    origX: reg.x,
    origY: reg.y
  };
}

function onRectHandleDown(reg, corner, e) {
  e.stopPropagation();
  e.preventDefault();
  activeRegionId.value = reg.id;
  activeDraggingHandle.value = {
    reg,
    corner,
    startClientX: e.clientX,
    startClientY: e.clientY,
    origX: reg.x,
    origY: reg.y,
    origW: reg.w,
    origH: reg.h
  };
}

function onPolyVertexDown(reg, pIdx, e) {
  e.stopPropagation();
  e.preventDefault();
  activeRegionId.value = reg.id;
  activePolyVertexDrag.value = {
    reg,
    pIdx,
    startClientX: e.clientX,
    startClientY: e.clientY,
    origPtX: reg.points[pIdx].x,
    origPtY: reg.points[pIdx].y
  };
}

function onCanvasMouseDown(e) {
  const { x, y } = getCanvasCoords(e);

  if (activeTool.value === 'select') {
    selectedAnnotationIndex.value = null;
    return;
  }

  if (activeTool.value === 'rect') {
    isDraggingNewRect.value = true;
    currentDraftRect.value = { startX: x, startY: y, x, y, w: 0, h: 0 };
  } else if (activeTool.value === 'polygon') {
    if (polyDraftPoints.value.length >= 3) {
      const p0 = polyDraftPoints.value[0];
      const dist = Math.hypot(p0.x - x, p0.y - y);
      if (dist < 15) {
        finishPolygon();
        return;
      }
    }
    polyDraftPoints.value.push({ x, y });
  } else if (activeTool.value === 'brush') {
    brushPoints.value = [{ x, y }];
  } else if (activeTool.value === 'arrow') {
    isDrawingArrow.value = true;
    currentDraftArrow.value = { x1: x, y1: y, x2: x, y2: y };
  } else if (activeTool.value === 'text') {
    isAddingText.value = true;
    textInputPos.x = x;
    textInputPos.y = y;
    tempInputText.value = '';
    nextTick(() => {
      inlineTextInputRef.value?.focus();
    });
  } else if (activeTool.value === 'mosaic') {
    isDraggingNewRect.value = true;
    currentDraftRect.value = { startX: x, startY: y, x, y, w: 0, h: 0 };
  }
}

function onCanvasMouseMove(e) {
  const { x, y } = getCanvasCoords(e);

  // -1. 全画幅裁剪框手柄拖拽缩放与框内平移
  if (activeCropDrag.value) {
    const { mode, handleKey, startClientX, startClientY, startBox } = activeCropDrag.value;
    const dx = (e.clientX - startClientX) / canvasZoom.value;
    const dy = (e.clientY - startClientY) / canvasZoom.value;
    const dw = canvasDisplaySize.w || 800;
    const dh = canvasDisplaySize.h || 600;

    if (mode === 'move') {
      const nx = Math.max(0, Math.min(dw - startBox.w, startBox.x + dx));
      const ny = Math.max(0, Math.min(dh - startBox.h, startBox.y + dy));
      cropBox.value.x = Math.round(nx);
      cropBox.value.y = Math.round(ny);
    } else if (mode === 'handle') {
      let x = startBox.x;
      let y = startBox.y;
      let w = startBox.w;
      let h = startBox.h;

      if (handleKey === 'se') {
        w = Math.max(40, Math.min(dw - x, startBox.w + dx));
        h = Math.max(40, Math.min(dh - y, startBox.h + dy));
      } else if (handleKey === 's') {
        h = Math.max(40, Math.min(dh - y, startBox.h + dy));
      } else if (handleKey === 'e') {
        w = Math.max(40, Math.min(dw - x, startBox.w + dx));
      } else if (handleKey === 'sw') {
        w = Math.max(40, Math.min(startBox.x + startBox.w, startBox.w - dx));
        x = startBox.x + (startBox.w - w);
        h = Math.max(40, Math.min(dh - y, startBox.h + dy));
      } else if (handleKey === 'w') {
        w = Math.max(40, Math.min(startBox.x + startBox.w, startBox.w - dx));
        x = startBox.x + (startBox.w - w);
      } else if (handleKey === 'ne') {
        w = Math.max(40, Math.min(dw - x, startBox.w + dx));
        h = Math.max(40, Math.min(startBox.y + startBox.h, startBox.h - dy));
        y = startBox.y + (startBox.h - h);
      } else if (handleKey === 'n') {
        h = Math.max(40, Math.min(startBox.y + startBox.h, startBox.h - dy));
        y = startBox.y + (startBox.h - h);
      } else if (handleKey === 'nw') {
        w = Math.max(40, Math.min(startBox.x + startBox.w, startBox.w - dx));
        x = startBox.x + (startBox.w - w);
        h = Math.max(40, Math.min(startBox.y + startBox.h, startBox.h - dy));
        y = startBox.y + (startBox.h - h);
      }

      // 画幅比例约束
      if (cropRatio.value !== 'free') {
        let ratio = 1;
        if (cropRatio.value === 'original') ratio = dw / dh;
        else {
          const [rw, rh] = cropRatio.value.split(':').map(Number);
          ratio = rw / rh;
        }
        if (['se', 'nw', 'ne', 'sw', 'e', 'w'].includes(handleKey)) {
          h = w / ratio;
          if (y + h > dh) {
            h = dh - y;
            w = h * ratio;
          }
        } else {
          w = h * ratio;
          if (x + w > dw) {
            w = dw - x;
            h = w / ratio;
          }
        }
      }

      cropBox.value = {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h)
      };
    }
    return;
  }

  // 0. 拖动标绘项（文字平移、箭头端点/箭身拖拽、马赛克平移/四角缩放）
  if (activeDraggingAnnotation.value) {
    const { idx, mode, startClientX, startClientY, origAnn } = activeDraggingAnnotation.value;
    const ann = annotations.value[idx];
    if (!ann) return;
    const dx = (e.clientX - startClientX) / canvasZoom.value;
    const dy = (e.clientY - startClientY) / canvasZoom.value;
    const dw = Math.max(1, canvasDisplaySize.w || 800);
    const dh = Math.max(1, canvasDisplaySize.h || 600);

    if (mode === 'text') {
      ann.x = Math.max(0, Math.min(dw - 30, origAnn.x + dx));
      ann.y = Math.max(0, Math.min(dh - 20, origAnn.y + dy));
      ann.normX = Number((ann.x / dw).toFixed(4));
      ann.normY = Number((ann.y / dh).toFixed(4));
    } else if (mode === 'arrow-start') {
      ann.x1 = Math.max(0, Math.min(dw, origAnn.x1 + dx));
      ann.y1 = Math.max(0, Math.min(dh, origAnn.y1 + dy));
      ann.normX1 = Number((ann.x1 / dw).toFixed(4));
      ann.normY1 = Number((ann.y1 / dh).toFixed(4));
    } else if (mode === 'arrow-end') {
      ann.x2 = Math.max(0, Math.min(dw, origAnn.x2 + dx));
      ann.y2 = Math.max(0, Math.min(dh, origAnn.y2 + dy));
      ann.normX2 = Number((ann.x2 / dw).toFixed(4));
      ann.normY2 = Number((ann.y2 / dh).toFixed(4));
    } else if (mode === 'arrow-body') {
      const w = origAnn.x2 - origAnn.x1;
      const h = origAnn.y2 - origAnn.y1;
      const nx1 = Math.max(0, Math.min(dw, origAnn.x1 + dx));
      const ny1 = Math.max(0, Math.min(dh, origAnn.y1 + dy));
      ann.x1 = nx1;
      ann.y1 = ny1;
      ann.x2 = nx1 + w;
      ann.y2 = ny1 + h;
      ann.normX1 = Number((ann.x1 / dw).toFixed(4));
      ann.normY1 = Number((ann.y1 / dh).toFixed(4));
      ann.normX2 = Number((ann.x2 / dw).toFixed(4));
      ann.normY2 = Number((ann.y2 / dh).toFixed(4));
    } else if (mode === 'mosaic-body') {
      ann.x = Math.max(0, Math.min(dw - origAnn.w, origAnn.x + dx));
      ann.y = Math.max(0, Math.min(dh - origAnn.h, origAnn.y + dy));
      ann.normX = Number((ann.x / dw).toFixed(4));
      ann.normY = Number((ann.y / dh).toFixed(4));
      renderMosaicCanvas();
    } else if (mode.startsWith('mosaic-handle-')) {
      const corner = mode.replace('mosaic-handle-', '');
      let { x, y, w, h } = origAnn;
      if (corner === 'se') {
        w = Math.max(15, origAnn.w + dx);
        h = Math.max(15, origAnn.h + dy);
      } else if (corner === 'sw') {
        w = Math.max(15, origAnn.w - dx);
        x = origAnn.x + (origAnn.w - w);
        h = Math.max(15, origAnn.h + dy);
      } else if (corner === 'ne') {
        w = Math.max(15, origAnn.w + dx);
        h = Math.max(15, origAnn.h - dy);
        y = origAnn.y + (origAnn.h - h);
      } else if (corner === 'nw') {
        w = Math.max(15, origAnn.w - dx);
        x = origAnn.x + (origAnn.w - w);
        h = Math.max(15, origAnn.h - dy);
        y = origAnn.y + (origAnn.h - h);
      }
      ann.x = x;
      ann.y = y;
      ann.w = w;
      ann.h = h;
      ann.normX = Number((x / dw).toFixed(4));
      ann.normY = Number((y / dh).toFixed(4));
      ann.normW = Number((w / dw).toFixed(4));
      ann.normH = Number((h / dh).toFixed(4));
      renderMosaicCanvas();
    }
    return;
  }

  // 1. 拖动选区 4 个角缩放（彻底修复坐标系混合导致长按暴涨的 Bug！）
  if (activeDraggingHandle.value) {
    const { reg, corner, startClientX, startClientY, origX, origY, origW, origH } = activeDraggingHandle.value;
    const dx = (e.clientX - startClientX) / canvasZoom.value;
    const dy = (e.clientY - startClientY) / canvasZoom.value;

    if (corner === 'se') {
      reg.w = Math.max(30, origW + dx);
      reg.h = Math.max(30, origH + dy);
    } else if (corner === 'sw') {
      const newW = Math.max(30, origW - dx);
      reg.x = origX + (origW - newW);
      reg.w = newW;
      reg.h = Math.max(30, origH + dy);
    } else if (corner === 'ne') {
      const newH = Math.max(30, origH - dy);
      reg.y = origY + (origH - newH);
      reg.w = Math.max(30, origW + dx);
      reg.h = newH;
    } else if (corner === 'nw') {
      const newW = Math.max(30, origW - dx);
      const newH = Math.max(30, origH - dy);
      reg.x = origX + (origW - newW);
      reg.y = origY + (origH - newH);
      reg.w = newW;
      reg.h = newH;
    }
    syncRegionPercentages(reg);
    return;
  }

  // 2. 拖动整个选区平移位置
  if (activeDraggingRegion.value) {
    const { reg, startClientX, startClientY, origX, origY } = activeDraggingRegion.value;
    const dx = (e.clientX - startClientX) / canvasZoom.value;
    const dy = (e.clientY - startClientY) / canvasZoom.value;
    reg.x = Math.max(0, origX + dx);
    reg.y = Math.max(0, origY + dy);
    syncRegionPercentages(reg);
    return;
  }

  // 3. 拖动多边形顶点
  if (activePolyVertexDrag.value) {
    const { reg, pIdx, startClientX, startClientY, origPtX, origPtY } = activePolyVertexDrag.value;
    const dx = (e.clientX - startClientX) / canvasZoom.value;
    const dy = (e.clientY - startClientY) / canvasZoom.value;
    reg.points[pIdx].x = origPtX + dx;
    reg.points[pIdx].y = origPtY + dy;
    syncRegionPercentages(reg);
    return;
  }

  // 4. 新建矩形拉伸中
  if (isDraggingNewRect.value && currentDraftRect.value) {
    const sx = currentDraftRect.value.startX;
    const sy = currentDraftRect.value.startY;
    currentDraftRect.value.x = Math.min(sx, x);
    currentDraftRect.value.y = Math.min(sy, y);
    currentDraftRect.value.w = Math.abs(x - sx);
    currentDraftRect.value.h = Math.abs(y - sy);
  }

  // 5. 画笔笔触中
  if (activeTool.value === 'brush' && brushPoints.value.length > 0) {
    brushPoints.value.push({ x, y });
  }

  // 6. 箭头绘制中
  if (isDrawingArrow.value && currentDraftArrow.value) {
    currentDraftArrow.value.x2 = x;
    currentDraftArrow.value.y2 = y;
  }

  // 7. 多边形悬停连线
  if (activeTool.value === 'polygon') {
    polyMouseHoverPoint.value = { x, y };
    if (polyDraftPoints.value.length >= 3) {
      const p0 = polyDraftPoints.value[0];
      isHoveringStartPoint.value = Math.hypot(p0.x - x, p0.y - y) < 18;
    } else {
      isHoveringStartPoint.value = false;
    }
  }
}

function onCanvasMouseUp() {
  if (activeCropDrag.value) {
    activeCropDrag.value = null;
    return;
  }

  if (activeDraggingAnnotation.value) {
    activeDraggingAnnotation.value = null;
    return;
  }

  if (activeDraggingHandle.value) {
    activeDraggingHandle.value = null;
    return;
  }

  if (activeDraggingRegion.value) {
    activeDraggingRegion.value = null;
    return;
  }

  if (activePolyVertexDrag.value) {
    activePolyVertexDrag.value = null;
    return;
  }

  // 矩形选区或马赛克完成
  if (isDraggingNewRect.value && currentDraftRect.value) {
    isDraggingNewRect.value = false;
    const { x, y, w, h } = currentDraftRect.value;
    if (w > 20 && h > 20) {
      const dw = Math.max(1, canvasDisplaySize.w || 800);
      const dh = Math.max(1, canvasDisplaySize.h || 600);
      if (activeTool.value === 'crop') {
        cropRect.value = { x, y, w, h };
      } else if (activeTool.value === 'mosaic') {
        annotations.value.push({
          type: 'mosaic',
          x, y, w, h,
          normX: Number((x / dw).toFixed(4)),
          normY: Number((y / dh).toFixed(4)),
          normW: Number((w / dw).toFixed(4)),
          normH: Number((h / dh).toFixed(4)),
        });
        redoStack.value = [];
        nextTick(renderMosaicCanvas);
        setTool('select');
      } else {
        // 创建新矩形选区并自动切换为通用选择/移动工具，避免误触再次新建
        const nextIdx = regions.value.length + 1;
        const color = REGION_COLORS[(nextIdx - 1) % REGION_COLORS.length];
        const newReg = {
          id: 'reg_' + Date.now(),
          name: `区域${nextIdx}`,
          type: 'rect',
          x,
          y,
          w,
          h,
          points: [],
          color,
          op: '',
          guide: emptyGuide(),
          params: blankRegionParams()
        };
        syncRegionPercentages(newReg);
        regions.value.push(newReg);
        activeRegionId.value = newReg.id;
        triggerRegionClassification(newReg);
        // 自动切回选择工具！明确操作！
        setTool('select');
      }
    }
    currentDraftRect.value = null;
  }

  // 画笔完成
  if (activeTool.value === 'brush' && brushPoints.value.length > 2) {
    const xs = brushPoints.value.map((p) => p.x);
    const ys = brushPoints.value.map((p) => p.y);
    const minX = Math.min(...xs) - 10;
    const minY = Math.min(...ys) - 10;
    const maxX = Math.max(...xs) + 10;
    const maxY = Math.max(...ys) + 10;
    const nextIdx = regions.value.length + 1;
    const color = REGION_COLORS[(nextIdx - 1) % REGION_COLORS.length];
    const newReg = {
      id: 'reg_' + Date.now(),
      name: `区域${nextIdx}: 画笔涂抹`,
      type: 'brush',
      x: Math.max(0, minX),
      y: Math.max(0, minY),
      w: Math.max(30, maxX - minX),
      h: Math.max(30, maxY - minY),
      points: [...brushPoints.value],
      color,
      op: '',
      guide: emptyGuide(),
      params: blankRegionParams()
    };
    syncRegionPercentages(newReg);
    regions.value.push(newReg);
    activeRegionId.value = newReg.id;
    triggerRegionClassification(newReg);
    brushPoints.value = [];
    setTool('select');
  }

  // 箭头完成
  if (isDrawingArrow.value && currentDraftArrow.value) {
    isDrawingArrow.value = false;
    const { x1, y1, x2, y2 } = currentDraftArrow.value;
    if (Math.hypot(x2 - x1, y2 - y1) > 15) {
      const dw = Math.max(1, canvasDisplaySize.w || 800);
      const dh = Math.max(1, canvasDisplaySize.h || 600);
      annotations.value.push({
        type: 'arrow',
        x1, y1, x2, y2,
        normX1: Number((x1 / dw).toFixed(4)),
        normY1: Number((y1 / dh).toFixed(4)),
        normX2: Number((x2 / dw).toFixed(4)),
        normY2: Number((y2 / dh).toFixed(4)),
      });
      redoStack.value = [];
      setTool('select');
    }
    currentDraftArrow.value = null;
  }
}


function onCanvasDblClick(e) {
  if (activeTool.value === 'polygon') {
    e.stopPropagation();
    // 双击闭合时，剔除因双击最后一下多打出的冗余近邻点
    if (polyDraftPoints.value.length >= 2) {
      const len = polyDraftPoints.value.length;
      const last = polyDraftPoints.value[len - 1];
      const prev = polyDraftPoints.value[len - 2];
      if (Math.hypot(last.x - prev.x, last.y - prev.y) < 18) {
        polyDraftPoints.value.pop();
      }
    }
    if (polyDraftPoints.value.length >= 3) {
      finishPolygon();
    }
  }
}

function finishPolygon() {
  if (polyDraftPoints.value.length < 3) return;
  const nextIdx = regions.value.length + 1;
  const color = REGION_COLORS[(nextIdx - 1) % REGION_COLORS.length];
  const newReg = {
    id: 'reg_' + Date.now(),
    name: `区域${nextIdx}: 多点选区`,
    type: 'polygon',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    points: [...polyDraftPoints.value],
    color,
    op: '',
    guide: emptyGuide(),
    params: blankRegionParams()
  };
  syncRegionPercentages(newReg);
  regions.value.push(newReg);
  activeRegionId.value = newReg.id;
  polyDraftPoints.value = [];
  triggerRegionClassification(newReg);
  polyMouseHoverPoint.value = null;
  setTool('select');
}

function cancelPolygon() {
  polyDraftPoints.value = [];
  polyMouseHoverPoint.value = null;
  setTool('select');
}

function confirmAddText() {
  const txt = tempInputText.value.trim();
  const dw = Math.max(1, canvasDisplaySize.w || 800);
  const dh = Math.max(1, canvasDisplaySize.h || 600);

  // 如果是在双击编辑已有文本，就地更新已有批注
  if (editingTextAnnotationIndex.value !== null) {
    const ann = annotations.value[editingTextAnnotationIndex.value];
    if (ann && ann.type === 'text') {
      if (txt) {
        ann.text = txt;
      } else {
        deleteAnnotation(editingTextAnnotationIndex.value);
      }
    }
    editingTextAnnotationIndex.value = null;
    isAddingText.value = false;
    tempInputText.value = '';
    setTool('select');
    return;
  }

  // 正常新建文本批注
  if (txt) {
    annotations.value.push({
      type: 'text',
      x: textInputPos.x,
      y: textInputPos.y,
      normX: Number((textInputPos.x / dw).toFixed(4)),
      normY: Number((textInputPos.y / dh).toFixed(4)),
      text: txt,
      fontSize: 13
    });
    redoStack.value = [];
  }
  isAddingText.value = false;
  tempInputText.value = '';
  setTool('select');
}

function cancelAddText() {
  editingTextAnnotationIndex.value = null;
  isAddingText.value = false;
  tempInputText.value = '';
  setTool('select');
}

function removeAnnotation(idx) {
  annotations.value.splice(idx, 1);
}


onMounted(() => {
  window.addEventListener('keydown', onGlobalKeyDown);
  window.addEventListener('keyup', onGlobalKeyUp);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeyDown);
  window.removeEventListener('keyup', onGlobalKeyUp);
});

function onGlobalKeyDown(e) {
  if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    isSpacePressed.value = true;
  }
  if (e.key === 'Escape') {
    onEscPress(e);
  }
  if (e.key === 'Enter') {
    if (activeTool.value === 'polygon' && polyDraftPoints.value.length >= 3) {
      e.preventDefault();
      finishPolygon();
    }
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    if (selectedAnnotationIndex.value !== null) {
      e.preventDefault();
      deleteAnnotation(selectedAnnotationIndex.value);
    }
  }
}

function onGlobalKeyUp(e) {
  if (e.code === 'Space') {
    isSpacePressed.value = false;
  }
}

// Esc 分级退出逻辑
function onEscPress(e) {
  e.stopPropagation();
  // 1. 如果在多点绘制中：取消多点，不退出页面
  if (activeTool.value === 'polygon' && polyDraftPoints.value.length > 0) {
    cancelPolygon();
    return;
  }
  // 2. 如果在输入文字中：取消文字输入，不退出页面
  if (isAddingText.value) {
    isAddingText.value = false;
    tempInputText.value = '';
    setTool('select');
    return;
  }
  // 3. 如果在其他绘图工具中：返回普通选择工具
  if (activeTool.value !== 'select') {
    setTool('select');
    return;
  }
  // 4. 普通状态下：正常退出
  handleCancel();
}

function getRectHandles(reg) {
  return [
    { corner: 'nw', x: reg.x, y: reg.y },
    { corner: 'ne', x: reg.x + reg.w, y: reg.y },
    { corner: 'se', x: reg.x + reg.w, y: reg.y + reg.h },
    { corner: 'sw', x: reg.x, y: reg.y + reg.h },
  ];
}


// 选区在非自定义模式（3D模型置入、改色等）下的局部多边形裁剪，杜绝退化为矩形白色卡片！
function getPolygonLocalClipStyle(reg) {
  if (reg.type !== 'polygon' || !Array.isArray(reg.points) || reg.points.length < 3) return {};
  const box = getRegionBox(reg);
  const w = Math.max(1, box.w);
  const h = Math.max(1, box.h);
  const pts = reg.points.map((p) => {
    const rx = Math.max(0, Math.min(100, ((p.x - box.x) / w) * 100));
    const ry = Math.max(0, Math.min(100, ((p.y - box.y) / h) * 100));
    return `${rx.toFixed(1)}% ${ry.toFixed(1)}%`;
  });
  return {
    clipPath: `polygon(${pts.join(', ')})`,
    WebkitClipPath: `polygon(${pts.join(', ')})`,
  };
}

// 多边形半透明闭合预览辅助
function getDraftPolygonFillPoints(pts, hoverPt) {
  if (!pts || pts.length < 2) return '';
  const allPts = hoverPt ? [...pts, hoverPt] : pts;
  return allPts.map((p) => `${p.x},${p.y}`).join(' ');
}

// 画布缩放与平移状态
const canvasZoom = ref(1.0);
const canvasPan = reactive({ x: 0, y: 0 });
const isSpacePressed = ref(false);
const isPanning = ref(false);
const isHoveringStartPoint = ref(false);

function zoomIn() {
  canvasZoom.value = Math.min(3.0, Number((canvasZoom.value + 0.1).toFixed(1)));
}

function zoomOut() {
  canvasZoom.value = Math.max(0.5, Number((canvasZoom.value - 0.1).toFixed(1)));
}

function resetZoom() {
  canvasZoom.value = 1.0;
  canvasPan.x = 0;
  canvasPan.y = 0;
}

function onMainWheel(e) {
  if (activeTool.value === 'outpaint') return;
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.1 : -0.1;
  canvasZoom.value = Math.max(0.5, Math.min(3.0, Number((canvasZoom.value + delta).toFixed(1))));
}

function onMainMouseDown(e) {
  if (e.button === 1 || isSpacePressed.value) {
    e.preventDefault();
    isPanning.value = true;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startPanX = canvasPan.x;
    const startPanY = canvasPan.y;
    const onPanMove = (me) => {
      canvasPan.x = startPanX + (me.clientX - startMouseX);
      canvasPan.y = startPanY + (me.clientY - startMouseY);
    };
    const onPanUp = () => {
      isPanning.value = false;
      window.removeEventListener('mousemove', onPanMove);
      window.removeEventListener('mouseup', onPanUp);
    };
    window.addEventListener('mousemove', onPanMove);
    window.addEventListener('mouseup', onPanUp);
  }
}

function getRegionBox(reg) {
  if (reg.type === 'polygon' && reg.points.length > 0) {
    const xs = reg.points.map((p) => p.x);
    const ys = reg.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: reg.x, y: reg.y, w: reg.w, h: reg.h };
}

function getRegionLabelStyle(reg) {
  const box = getRegionBox(reg);
  return {
    left: box.x + 'px',
    top: Math.max(0, box.y - 24) + 'px'
  };
}

const hoveredRegionId = ref(null);

// 判断当前区域药丸标签是否展示：
// 绘制/标绘/拖动状态下严格隐藏，避免遮挡用户视线与后续框选落点；
// 仅在 select 模式下，鼠标移入该区域或激活当前区域时优雅显现
function shouldShowRegionLabel(reg) {
  if (!reg) return false;
  if (activeTool.value !== 'select') return false;
  if (isDrawingArrow.value || isAddingText.value || isDraggingNewRect.value) return false;
  if ((polyDraftPoints.value && polyDraftPoints.value.length > 0) || (brushPoints.value && brushPoints.value.length > 0)) return false;
  return reg.id === activeRegionId.value || reg.id === hoveredRegionId.value;
}

function getPolygonPointsAttr(points) {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function getPolylinePointsAttr(points, hover) {
  const pts = [...points];
  if (hover) pts.push(hover);
  return pts.map((p) => `${p.x},${p.y}`).join(' ');
}

function getBrushSvgPath(pts) {
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

// -------------------------------------------------------------
// 真实马赛克渲染逻辑 (像素化原图细节)
// -------------------------------------------------------------
function renderMosaicCanvas() {
  const canvas = mosaicCanvasRef.value;
  const img = baseImageRef.value;
  if (!canvas || !img) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const list = mosaicAnnotations.value;
  if (list.length === 0) return;

  const scaleX = (img.naturalWidth || canvas.width) / canvas.width;
  const scaleY = (img.naturalHeight || canvas.height) / canvas.height;

  for (const m of list) {
    if (m.w <= 0 || m.h <= 0) continue;
    const sx = Math.max(0, m.x * scaleX);
    const sy = Math.max(0, m.y * scaleY);
    const sw = Math.min(img.naturalWidth - sx, m.w * scaleX);
    const sh = Math.min(img.naturalHeight - sy, m.h * scaleY);
    if (sw <= 0 || sh <= 0) continue;

    const blockSize = 10;
    const tinyW = Math.max(1, Math.round(m.w / blockSize));
    const tinyH = Math.max(1, Math.round(m.h / blockSize));

    const tinyCanvas = document.createElement('canvas');
    tinyCanvas.width = tinyW;
    tinyCanvas.height = tinyH;
    const tinyCtx = tinyCanvas.getContext('2d');
    tinyCtx.drawImage(img, sx, sy, sw, sh, 0, 0, tinyW, tinyH);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tinyCanvas, 0, 0, tinyW, tinyH, m.x, m.y, m.w, m.h);

    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(m.x, m.y, m.w, m.h);
    ctx.setLineDash([]);
  }
}

// -------------------------------------------------------------
// 智能扩图完全修正：保持原生宽高比绝不裁剪 + 扩大量数据HUD
// -------------------------------------------------------------
const targetExpandRatio = ref('16:9');
const outpaintOccupancy = ref(70);
const isOutpainting = ref(false);
const outpaintNormOffset = reactive({ x: 0, y: 0 });
const isDraggingOutpaintImg = ref(false);
const dragStartMouse = reactive({ x: 0, y: 0 });
const dragStartOffset = reactive({ x: 0, y: 0 });

const outpaintModel = computed(() => computeOutpaintNorm({
  nativeW: imgNaturalSize.w || 800,
  nativeH: imgNaturalSize.h || 600,
  targetRatio: targetExpandRatio.value,
  occupancy: outpaintOccupancy.value / 100,
  offsetX: outpaintNormOffset.x,
  offsetY: outpaintNormOffset.y
}));

// 预览只负责塞进窗口。提交用的百分比来自 outpaintModel，不看窗口像素。
const outpaintLayout = computed(() => {
  const norm = outpaintModel.value;
  const maxCanvasW = typeof window !== 'undefined' ? Math.max(860, window.innerWidth - 440) : 1000;
  const maxCanvasH = typeof window !== 'undefined' ? Math.max(520, window.innerHeight - 240) : 600;
  const aspect = norm.canvasW / norm.canvasH;
  let canvasW = maxCanvasW;
  let canvasH = canvasW / aspect;
  if (canvasH > maxCanvasH) {
    canvasH = maxCanvasH;
    canvasW = canvasH * aspect;
  }
  const sx = canvasW / norm.canvasW;
  const sy = canvasH / norm.canvasH;
  return {
    canvasW: Math.round(canvasW),
    canvasH: Math.round(canvasH),
    innerW: Math.max(1, Math.round(norm.innerW * sx)),
    innerH: Math.max(1, Math.round(norm.innerH * sy)),
    left: Math.round(norm.left * sx),
    top: Math.round(norm.top * sy)
  };
});

const outpaintCanvasComputedStyle = computed(() => {
  const { canvasW, canvasH } = outpaintLayout.value;
  return {
    width: `${canvasW}px`,
    height: `${canvasH}px`,
    backgroundColor: '#F8FAFC',
    backgroundImage: 'radial-gradient(#CBD5E1 1px, transparent 1px)',
    backgroundSize: '16px 16px'
  };
});

const outpaintInnerImageStyle = computed(() => {
  const { innerW, innerH, left, top } = outpaintLayout.value;
  return {
    width: `${innerW}px`,
    height: `${innerH}px`,
    left: `${left}px`,
    top: `${top}px`
  };
});

const outpaintMargins = computed(() => {
  const m = outpaintModel.value;
  const nw = imgNaturalSize.w || 800;
  const nh = imgNaturalSize.h || 600;
  return {
    left: Math.round(nw * m.leftPct / 100),
    right: Math.round(nw * m.rightPct / 100),
    top: Math.round(nh * m.topPct / 100),
    bottom: Math.round(nh * m.bottomPct / 100),
    leftPct: m.leftPct,
    rightPct: m.rightPct,
    topPct: m.topPct,
    bottomPct: m.bottomPct
  };
});

const outpaintEstimatedRes = computed(() => {
  const nw = imgNaturalSize.w || 800;
  const nh = imgNaturalSize.h || 600;
  const { leftPct, rightPct, topPct, bottomPct } = outpaintMargins.value;
  const estW = Math.round(nw * (1 + (leftPct + rightPct) / 100));
  const estH = Math.round(nh * (1 + (topPct + bottomPct) / 100));
  return `${estW} × ${estH} (${targetExpandRatio.value})`;
});

function resetOutpaintOffset() {
  outpaintNormOffset.x = 0;
  outpaintNormOffset.y = 0;
}

function alignOutpaint(mode) {
  const centered = computeOutpaintNorm({
    nativeW: imgNaturalSize.w || 800,
    nativeH: imgNaturalSize.h || 600,
    targetRatio: targetExpandRatio.value,
    occupancy: outpaintOccupancy.value / 100
  });
  const slackX = (centered.canvasW - centered.innerW) / 2;
  const slackY = (centered.canvasH - centered.innerH) / 2;
  if (mode === 'center') {
    outpaintNormOffset.x = 0;
    outpaintNormOffset.y = 0;
  } else if (mode === 'top') {
    outpaintNormOffset.y = -slackY;
  } else if (mode === 'bottom') {
    outpaintNormOffset.y = slackY;
  } else if (mode === 'left') {
    outpaintNormOffset.x = -slackX;
  } else if (mode === 'right') {
    outpaintNormOffset.x = slackX;
  }
}

function onOutpaintDragStart(e) {
  isDraggingOutpaintImg.value = true;
  dragStartMouse.x = e.clientX;
  dragStartMouse.y = e.clientY;
  dragStartOffset.x = outpaintNormOffset.x;
  dragStartOffset.y = outpaintNormOffset.y;
}

function onOutpaintDragMove(e) {
  if (!isDraggingOutpaintImg.value) return;
  const layout = outpaintLayout.value;
  const norm = outpaintModel.value;
  if (!layout.canvasW || !layout.canvasH) return;
  const dx = ((e.clientX - dragStartMouse.x) / layout.canvasW) * norm.canvasW;
  const dy = ((e.clientY - dragStartMouse.y) / layout.canvasH) * norm.canvasH;
  outpaintNormOffset.x = dragStartOffset.x + dx;
  outpaintNormOffset.y = dragStartOffset.y + dy;
}

function onOutpaintDragEnd() {
  isDraggingOutpaintImg.value = false;
}

async function executeOutpainting() {
  if (isOutpainting.value) return;
  isOutpainting.value = true;
  try {
    const res = await authFetch('/api/edit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'expand',
        imageUrl: imageSrc.value,
        expandRatio: targetExpandRatio.value,
        expandRatios: {
          top: outpaintMargins.value.topPct / 100,
          bottom: outpaintMargins.value.bottomPct / 100,
          left: outpaintMargins.value.leftPct / 100,
          right: outpaintMargins.value.rightPct / 100
        },
        prompt: '根据空间结构自然延伸四周光影与墙面地面纹理'
      })
    });
    if (!res.ok) throw new Error(`扩图服务响应失败: ${res.status}`);
    const data = await res.json();
    const newUrl = data.url || data.outputUrl || data.imageUrl;
    if (!newUrl) throw new Error('未获取到扩图结果图片');

    emit('apply-outpainted-image', {
      imageIndex: props.imageIndex,
      url: newUrl
    });
    emit('close');
  } catch (err) {
    alert(`扩图失败: ${err.message || '请检查网络与服务'}`);
  } finally {
    isOutpainting.value = false;
  }
}

// -------------------------------------------------------------
// 配方实时汇总、3D快照截取、极简确认浮层与交付
// -------------------------------------------------------------
const showConfirmModal = ref(false);
const pendingNewRefs = ref([]);

const formattedRecipeSummary = computed(() => formatGuideRecipe(regions.value));

const isFittingModel = ref(false);

// 一键根据 3D 模型的实际 2D 轮廓外接矩形，自动收紧选区边界，消除多余空白并对齐地面
async function autoFitRegionToModel(reg) {
  if (!reg || !['replace', 'add'].includes(reg.op) || isFittingModel.value) return;
  const el = modelViewerMap.get(reg.id);
  if (!el) return;

  isFittingModel.value = true;
  try {
    // 强制临时透明背景以抓取纯粹的物体实体 Alpha 通道
    const prevBg = el.style.backgroundColor;
    el.style.backgroundColor = 'transparent';
    let dataUrl = null;
    try {
      if (typeof el.toDataURL === 'function') {
        dataUrl = el.toDataURL('image/png');
      } else if (typeof el.toBlob === 'function') {
        const blob = await el.toBlob({ mimeType: 'image/png' });
        dataUrl = await new Promise((res) => {
          const reader = new FileReader();
          reader.onloadend = () => res(reader.result);
          reader.readAsDataURL(blob);
        });
      }
    } finally {
      el.style.backgroundColor = prevBg;
    }
    if (!dataUrl) return;

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });

    const offCanvas = document.createElement('canvas');
    offCanvas.width = img.naturalWidth || img.width;
    offCanvas.height = img.naturalHeight || img.height;
    const ctx = offCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, offCanvas.width, offCanvas.height);
    const data = imgData.data;
    let minX = offCanvas.width, minY = offCanvas.height, maxX = 0, maxY = 0;
    let found = false;

    // 扫描实体像素 (排除高透明度或浅灰色遮底卡片底色)
    for (let y = 0; y < offCanvas.height; y++) {
      for (let x = 0; x < offCanvas.width; x++) {
        const idx = (y * offCanvas.width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        const isWhiteOrSlateBg = r >= 244 && g >= 246 && b >= 249;
        if (a > 20 && !isWhiteOrSlateBg) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!found || maxX <= minX || maxY <= minY) return;

    const currentBox = getRegionBox(reg);
    const scaleX = currentBox.w / offCanvas.width;
    const scaleY = currentBox.h / offCanvas.height;

    // 留出 8px 安全缓冲边距，防止贴合太紧切掉沙发扶手边缘或地面轻微柔和阴影
    const pad = 8;
    const newLeft = Math.max(0, currentBox.x + minX * scaleX - pad);
    const newTop = Math.max(0, currentBox.y + minY * scaleY - pad);
    const newW = Math.max(60, (maxX - minX) * scaleX + pad * 2);
    const newH = Math.max(60, (maxY - minY) * scaleY + pad * 2);

    if (reg.type === 'polygon' && Array.isArray(reg.points) && reg.points.length > 0) {
      reg.points = [
        { x: Math.round(newLeft), y: Math.round(newTop) },
        { x: Math.round(newLeft + newW), y: Math.round(newTop) },
        { x: Math.round(newLeft + newW), y: Math.round(newTop + newH) },
        { x: Math.round(newLeft), y: Math.round(newTop + newH) }
      ];
    } else {
      reg.x = Math.round(newLeft);
      reg.y = Math.round(newTop);
      reg.w = Math.round(newW);
      reg.h = Math.round(newH);
    }

    // 贴合后稍微延时刷新抓取清晰的透视快照
    setTimeout(async () => {
      const newSnap = await captureViewerSnapshot(reg.id);
      if (newSnap) {
        reg.params.snapshotUrl = newSnap;
        try {
          const refBbox = await computeImageEntityBbox(newSnap);
          if (refBbox) reg.params.refBbox = refBbox;
        } catch (_) {}
      }
    }, 150);
  } catch (err) {
    console.warn('自动贴合 3D 模型轮廓失败:', err);
  } finally {
    isFittingModel.value = false;
  }
}

async function captureViewerSnapshot(regId) {
  const el = modelViewerMap.get(regId);
  if (!el) return null;
  try {
    if (typeof el.toDataURL === 'function') {
      return el.toDataURL('image/png');
    }
    if (typeof el.toBlob === 'function') {
      const blob = await el.toBlob({ mimeType: 'image/png' });
      return URL.createObjectURL(blob);
    }
  } catch (err) {
    console.warn('捕获 3D 快照失败:', err);
  }
  return null;
}

// 合成并截取纯线框画面快照 (0% 内部填充透明度！仅 stroke 3.5px 彩色线框，消除对原图色彩与光影的遮挡污染)
async function captureWireframeSnapshot() {
  const baseImg = baseImageRef.value;
  if (!baseImg) return null;
  const canvas = document.createElement('canvas');
  canvas.width = baseImg.naturalWidth || baseImg.width || 1200;
  canvas.height = baseImg.naturalHeight || baseImg.height || 800;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);

  const scaleX = canvas.width / (baseImg.clientWidth || 1);
  const scaleY = canvas.height / (baseImg.clientHeight || 1);

  // 1. 真实马赛克写入
  for (const m of mosaicAnnotations.value) {
    const sx = Math.max(0, m.x * scaleX);
    const sy = Math.max(0, m.y * scaleY);
    const sw = Math.min(canvas.width - sx, m.w * scaleX);
    const sh = Math.min(canvas.height - sy, m.h * scaleY);
    if (sw <= 0 || sh <= 0) continue;

    const blockSize = 12;
    const tinyW = Math.max(1, Math.round(sw / blockSize));
    const tinyH = Math.max(1, Math.round(sh / blockSize));
    const tc = document.createElement('canvas');
    tc.width = tinyW;
    tc.height = tinyH;
    const tctx = tc.getContext('2d');
    tctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, tinyW, tinyH);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tc, 0, 0, tinyW, tinyH, sx, sy, sw, sh);
  }

  // 1.5 绘制 3D 实体透视投影 (对 replace/add 选区，直接将已定位朝向的 3D 模型合成在底图选区中作为真实视觉引导，杜绝 AI 把空线框撑满放大)
  for (const reg of regions.value) {
    if (['replace', 'add'].includes(reg.op)) {
      let snapUrl = reg.params?.snapshotUrl;
      if (!snapUrl) {
        snapUrl = await captureViewerSnapshot(reg.id);
        if (snapUrl) reg.params.snapshotUrl = snapUrl;
      }
      if (snapUrl) {
        const box = getRegionBox(reg);
        const rx = box.x * scaleX;
        const ry = box.y * scaleY;
        const rw = box.w * scaleX;
        const rh = box.h * scaleY;

        try {
          const modelImg = new Image();
          modelImg.crossOrigin = 'anonymous';
          await new Promise((resolve) => {
            modelImg.onload = resolve;
            modelImg.onerror = resolve;
            modelImg.src = snapUrl;
          });
          if (modelImg.complete && modelImg.naturalWidth > 0) {
            ctx.save();
            if (reg.type === 'polygon' && Array.isArray(reg.points) && reg.points.length >= 3) {
              ctx.beginPath();
              ctx.moveTo(reg.points[0].x * scaleX, reg.points[0].y * scaleY);
              for (let i = 1; i < reg.points.length; i++) {
                ctx.lineTo(reg.points[i].x * scaleX, reg.points[i].y * scaleY);
              }
              ctx.closePath();
              ctx.clip();
            }
            // 纯色遮底模式先绘制遮挡底板
            if (reg.params?.transparentBg === false) {
              ctx.fillStyle = '#F8FAFC';
              ctx.fillRect(rx, ry, rw, rh);
            }
            ctx.drawImage(modelImg, rx, ry, rw, rh);
            ctx.restore();
          }
        } catch (e) {
          console.warn('合成 3D 模型至指示图失败:', e);
        }
      }
    }
  }

  // 2. 绘制纯彩色线框 (0% 内部底色填充，仅 stroke 3.5px 纯线框)
  for (const reg of regions.value) {
    const color = reg.color?.border || '#818CF8';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5 * scaleX;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (reg.type === 'polygon' && Array.isArray(reg.points) && reg.points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(reg.points[0].x * scaleX, reg.points[0].y * scaleY);
      for (let i = 1; i < reg.points.length; i++) {
        ctx.lineTo(reg.points[i].x * scaleX, reg.points[i].y * scaleY);
      }
      ctx.closePath();
      ctx.stroke();
    } else {
      const box = getRegionBox(reg);
      const rx = box.x * scaleX;
      const ry = box.y * scaleY;
      const rw = box.w * scaleX;
      const rh = box.h * scaleY;
      ctx.strokeRect(rx, ry, rw, rh);
    }
  }

  // 3. 绘制指向红箭头
  ctx.strokeStyle = '#EF4444';
  ctx.fillStyle = '#EF4444';
  ctx.lineWidth = 4 * scaleX;
  ctx.lineCap = 'round';

  for (const ann of arrowAnnotations.value) {
    const x1 = ann.x1 * scaleX;
    const y1 = ann.y1 * scaleY;
    const x2 = ann.x2 * scaleX;
    const y2 = ann.y2 * scaleY;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 16 * scaleX;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  // 4. 绘制文字批注
  ctx.font = `bold ${Math.round(16 * scaleX)}px sans-serif`;
  for (const ann of textAnnotations.value) {
    const tx = ann.x * scaleX;
    const ty = ann.y * scaleY;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(tx - 4, ty - 18 * scaleY, 160 * scaleX, 26 * scaleY);
    ctx.fillStyle = '#F87171';
    ctx.fillText(ann.text, tx, ty);
  }

  return canvas.toDataURL('image/png');
}

// 保持别名兼容
const captureAnnotatedCanvasSnapshot = captureWireframeSnapshot;

// 打开极简确认浮层
async function applyCrop() {
  const box = cropBox.value || cropRect.value;
  const img = baseImageRef.value;
  if (!box || !img || !img.naturalWidth) return;
  const dw = canvasDisplaySize.w || img.clientWidth || img.naturalWidth;
  const dh = canvasDisplaySize.h || img.clientHeight || img.naturalHeight;
  const sx = Math.max(0, Math.round(box.x / dw * img.naturalWidth));
  const sy = Math.max(0, Math.round(box.y / dh * img.naturalHeight));
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(box.w / dw * img.naturalWidth)));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(box.h / dh * img.naturalHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  try {
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    emit('apply-custom-image', {
      imageIndex: props.imageIndex,
      dataUrl: canvas.toDataURL('image/jpeg', 0.92)
    });
    setTool('select');
  } catch {
    alert('这张图不能在本地裁剪。请换一张已经保存在素材库里的图片。');
  }
}

async function openConfirmModal() {
  if (activeTool.value === 'outpaint') {
    await executeOutpainting();
    return;
  }
  if (activeTool.value === 'crop') {
    await applyCrop();
    return;
  }

  pendingNewRefs.value = [];
  const silentRefs = [];

  // 如果有 3D 选区，抓取透明朝向截图并写入当前选区参数 snapshotUrl
  for (const reg of regions.value) {
    if (['replace', 'add'].includes(reg.op)) {
      const snap = await captureViewerSnapshot(reg.id);
      if (snap) {
        reg.params.snapshotUrl = snap;
        try {
          const refBbox = await computeImageEntityBbox(snap);
          if (refBbox) reg.params.refBbox = refBbox;
        } catch (_) {}
        const nextRefIdx = (props.totalReferenceCount || 1) + 1 + silentRefs.length;
        const snapTag = `@图${nextRefIdx}`;
        reg.params.snapshotRefTag = snapTag;
        silentRefs.push({
          name: `${reg.name}_3D朝向图`,
          url: snap,
          tag: snapTag,
          origin: '3d_snapshot',
          isRefObject: true,
          targetRegionId: reg.id,
          sourceImageIndex: props.imageIndex
        });
      }
    }
  }

  // 如果同时存在箭头/文字/马赛克标绘，抓取一张指示图
  if (regions.value.length > 0 && annotations.value.length > 0) {
    const annotSnap = await captureWireframeSnapshot();
    if (annotSnap) {
      const nextRefIdx = (props.totalReferenceCount || 1) + 1 + silentRefs.length;
      silentRefs.push({
        name: '视觉标绘指示图',
        url: annotSnap,
        tag: `@图${nextRefIdx}`,
        origin: 'annotation_snapshot'
      });
    }
  }

  pendingNewRefs.value = silentRefs;
  showConfirmModal.value = true;
}

// 确认生效执行
async function executeUnifiedApply() {
  showConfirmModal.value = false;

  // 场景 1：如果仅有即时标绘（无写回选区），直接更新看图区原图（提供撤回）
  if (regions.value.length === 0 && annotations.value.length > 0) {
    const dataUrl = await captureWireframeSnapshot();
    emit('apply-custom-image', {
      imageIndex: props.imageIndex,
      dataUrl
    });
    emit('close');
    return;
  }

  // 检查是否有基础属性选区
  const baseAttrRegions = regions.value.filter(r => r.guide?.type === 'resurface' || r.op === 'recolor' || r.params?.baseAttr);
  let baseAttrRefs = null;
  let compiledPrompt = null;
  if (baseAttrRegions.length > 0) {
    try {
      const token = getToken();
      const compilePayload = {
        regions: baseAttrRegions.map(r => {
          let bbox = null;
          const bStr = calculateNormalizedBbox(r, canvasDisplaySize.w || 800, canvasDisplaySize.h || 600);
          if (bStr) {
            const nums = bStr.split(/\s+/).map(Number);
            if (nums.length === 4 && nums.every(n => Number.isFinite(n))) {
              bbox = { x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3] };
            }
          }
          const p = r.guide?.part || r.params?.baseAttr?.surface || r.inferredSurface || 'wall';
          const isRematerial = r.guide?.mode === 'rematerial' || r.guide?.track === 'B' || r.params?.baseAttr?.warehouse === 'material';
          return {
            region_id: r.id,
            bbox,
            part: p,
            surface: p,
            mode: isRematerial ? 'rematerial' : 'recolor',
            track: isRematerial ? 'B' : 'A',
            subclass: r.guide?.subclass || r.params?.baseAttr?.subclass || '',
            warehouse: isRematerial ? 'material' : 'paint',
            material_family: r.guide?.materialFamily || r.params?.baseAttr?.materialFamily || '',
            swatch_id: r.guide?.swatch_id || r.params?.baseAttr?.swatch_id || null,
            category_id: r.guide?.category_id || r.params?.baseAttr?.category_id || null,
            finish_id: r.guide?.finish_id || r.params?.baseAttr?.finish_id || null,
            finish_prompt: r.guide?.finish_prompt || r.params?.baseAttr?.finish_prompt || null,
            display_name: r.guide?.displayName || r.guide?.color_name || r.params?.baseAttr?.displayName || r.params?.baseAttr?.colorName || null,
            asset_id: r.guide?.swatch_id || r.guide?.assetId || r.params?.baseAttr?.asset_id || null,
            item_id: r.params?.baseAttr?.item_id || null,
            color_name: r.guide?.displayName || r.params?.baseAttr?.colorName || null,
            hex: r.guide?.hex || r.params?.baseAttr?.colorHex || r.params?.baseAttr?.hex || null,
            process: r.guide?.process || r.params?.baseAttr?.process || null,
            gloss: r.guide?.gloss || r.params?.baseAttr?.finish || null,
            finish: r.guide?.gloss || r.params?.baseAttr?.finish || null,
            roughness: r.params?.baseAttr?.roughness ?? null
          };
        }),
        baseImageTag: (props.targetTag || '@图1').replace('@', ''),
        firstRefIndex: (props.totalReferenceCount || 1) + 1,
        light_mode: null
      };

      const compileRes = await fetch('/api/base-library/compile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(compilePayload)
      });
      if (compileRes.ok) {
        const cJson = await compileRes.json();
        if (cJson.success) {
          if (Array.isArray(cJson.references)) baseAttrRefs = cJson.references;
          compiledPrompt = cJson.prompt;
          // 按 region_id 替换对应选区提示词（Patch 4，保留其他 op）
          if (Array.isArray(cJson.clauses)) {
            for (const clause of cJson.clauses) {
              const targetReg = regions.value.find(reg => reg.id === clause.region_id);
              if (targetReg) {
                if (!targetReg.params) targetReg.params = {};
                targetReg.params.compiledClause = clause.text;
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  // 场景 2：存在写回选区（基础属性操作不发送线框标注）
  let wireframeDataUrl = null;
  if (!baseAttrRefs && (regions.value.length > 0 || annotations.value.length > 0)) {
    wireframeDataUrl = await captureWireframeSnapshot();
  }

  // 持久化底图价签
  const imgKey = props.image?.fid ? `fid:${props.image.fid}` : (props.image?.binding_key ? `img:${props.image.binding_key}` : `img:${Date.now().toString(16)}`);
  if (props.image && !props.image.fid && !props.image.binding_key) {
    props.image.binding_key = imgKey.slice(4);
  }
  if (baseAttrRegions.length > 0) {
    try {
      fetch(`/api/base-library/bindings/${encodeURIComponent(imgKey)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          regions: baseAttrRegions.map(r => ({
            region_id: r.id,
            part: r.guide?.part || r.params?.baseAttr?.surface || 'wall',
            surface: r.guide?.part || r.params?.baseAttr?.surface || 'wall',
            mode: r.guide?.mode || (r.guide?.track === 'B' ? 'rematerial' : 'recolor'),
            track: r.guide?.track || (r.guide?.assetId ? 'B' : 'A'),
            subclass: r.guide?.subclass || r.params?.baseAttr?.subclass,
            warehouse: r.guide?.track === 'B' ? 'material' : (r.params?.baseAttr?.warehouse || 'paint'),
            asset_id: r.guide?.assetId || r.params?.baseAttr?.asset_id,
            item_id: r.params?.baseAttr?.item_id,
            hex: r.guide?.hex || r.params?.baseAttr?.colorHex || r.params?.baseAttr?.hex,
            finish: r.guide?.gloss || r.params?.baseAttr?.finish,
            roughness: r.params?.baseAttr?.roughness
          })),
          light_mode: null
        })
      });
    } catch (_) {}
  }

  const tag = props.targetTag || '@图1';
  const effectiveRatio = props.selectedRatio || (
    (imgNaturalSize.w && imgNaturalSize.h)
      ? getNearestCanonicalRatio(imgNaturalSize.w, imgNaturalSize.h)
      : null
  );
  const paletteHint = extractDominantScenePalette(baseImageRef.value);

  const structuredPrompt = buildStructuredPrompt({
    regions: regions.value,
    imageIndex: props.imageIndex,
    totalReferenceCount: props.totalReferenceCount || 1,
    imgW: imgNaturalSize.w || canvasDisplaySize.w || 800,
    imgH: imgNaturalSize.h || canvasDisplaySize.h || 600,
    targetTag: tag,
    aspectRatio: effectiveRatio,
    colorPaletteHint: paletteHint
  });
  // 优先使用完整包含 <bbox> 归一化坐标、线框标签与机位透视的结构化提示词
  let finalRecipe = structuredPrompt || formattedRecipeSummary.value;
  if (!finalRecipe && compiledPrompt) {
    finalRecipe = `【空间局部编辑方案】\n${compiledPrompt}\n要求：保持空间整体结构、主要动线与光影一致。`;
  }

  emit('apply-regions-to-image', {
    imageIndex: props.imageIndex,
    regions: JSON.parse(JSON.stringify(regions.value)),
    recipe: finalRecipe,
    silentRefs: baseAttrRefs ? [] : pendingNewRefs.value,
    newRefs: baseAttrRefs ? [] : pendingNewRefs.value.filter(r => r.origin === '3d_snapshot'),
    baseAttrRefs: baseAttrRefs || null,
    annotations: JSON.parse(JSON.stringify(annotations.value)),
    wireframeDataUrl,
    naturalWidth: imgNaturalSize.w || 0,
    naturalHeight: imgNaturalSize.h || 0,
    canonicalRatio: effectiveRatio,
    colorPaletteHint: paletteHint,
    is3DFurniture: regions.value.some(r => ['replace', 'add'].includes(r.op))
  });

  emit('close');
}

function handleCancel() {
  emit('close');
}

function onImageLoad(e) {
  imgNaturalSize.w = e.target.naturalWidth || 0;
  imgNaturalSize.h = e.target.naturalHeight || 0;
  syncDisplaySize();
  const dw = canvasDisplaySize.w;
  const dh = canvasDisplaySize.h;
  if (dw > 0 && dh > 0) {
    projectNormalizedDataToScreen(dw, dh);
  }
  nextTick(renderMosaicCanvas);
}

function syncDisplaySize() {
  if (baseImageRef.value) {
    canvasDisplaySize.w = baseImageRef.value.clientWidth || 800;
    canvasDisplaySize.h = baseImageRef.value.clientHeight || 600;
  }
}

onMounted(async () => {
  loadSavedGuides();
  fetchProductPresets();
  window.addEventListener('resize', () => {
    syncDisplaySize();
    const dw = canvasDisplaySize.w;
    const dh = canvasDisplaySize.h;
    if (dw > 0 && dh > 0) {
      projectNormalizedDataToScreen(dw, dh);
    }
    renderMosaicCanvas();
  });
  if (!props.cropOnly) {
    ensureModelViewer();
  }
});
</script>

<style scoped>
.scrollbar-thin::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 9999px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
</style>
