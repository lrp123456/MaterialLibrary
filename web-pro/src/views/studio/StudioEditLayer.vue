<template>
  <div
    v-if="visible"
    class="fixed inset-x-0 bottom-0 top-14 z-50 bg-studio-950 flex flex-col font-sans select-none animate-in fade-in duration-150"
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

        <div class="w-8 h-px bg-studio-800 my-1.5"></div>

        <!-- 分组 2：即时标绘工具 (所见即所得，即画即显) -->
        <div class="text-[10px] font-mono font-bold text-slate-500 uppercase mb-0.5">标绘</div>

        <button
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

        <div class="w-8 h-px bg-studio-800 my-1.5"></div>

        <!-- 分组 3：专有扩图 -->
        <button
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
              <div class="w-12 h-12 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
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

              <!-- 正在拉的矩形选区预览 -->
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
                <span class="opacity-75">({{ getOpDisplayName(reg.op) }}{{ reg.op === 'recolor' && (reg.params?.materialName || reg.params?.colorName) ? ': ' + (reg.params.materialName || reg.params.colorName) : '' }})</span>
              </div>

              <!-- 基础属性：如果在选区配置了材质贴图或色彩，在选区内渲染智能材质贴合图层 -->
              <div
                v-if="reg.op === 'recolor' && (reg.params?.materialTextureUrl || reg.params?.colorHex)"
                class="absolute z-10 overflow-hidden rounded transition-all pointer-events-none"
                :style="{
                  left: getRegionBox(reg).x + 'px',
                  top: getRegionBox(reg).y + 'px',
                  width: getRegionBox(reg).w + 'px',
                  height: getRegionBox(reg).h + 'px',
                  borderColor: reg.type === 'polygon' ? 'transparent' : (reg.color?.border || '#3B82F6'),
                  borderWidth: reg.type === 'polygon' ? '0px' : (reg.id === activeRegionId ? '2.5px' : '1.5px'),
                  backgroundColor: reg.params.colorHex ? hexToRgba(reg.params.colorHex, 0.35) : 'rgba(59, 130, 246, 0.15)',
                  ...getPolygonLocalClipStyle(reg),
                }"
              >
                <img
                  v-if="reg.params?.materialTextureUrl"
                  :src="reg.params.materialTextureUrl"
                  class="w-full h-full object-cover mix-blend-multiply opacity-80"
                  alt="材质贴图"
                />
                <div class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur text-[9px] text-white font-mono flex items-center gap-1 shadow">
                  <span class="w-2 h-2 rounded-full border border-white/30" :style="{ backgroundColor: reg.params.colorHex || '#CBD5E1' }"></span>
                  <span class="truncate max-w-[100px]">{{ reg.params.materialName || reg.params.colorName || '基础属性' }}</span>
                </div>
              </div>

              <!-- 3D 家具视口：每一个替换/增加区域均持续展示，采用纯色背景遮蔽原图杂乱陈设 -->
              <div
                v-if="['replace', 'add'].includes(reg.op)"
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
                  backgroundColor: '#F8FAFC',
                  borderColor: reg.type === 'polygon' ? 'transparent' : (reg.color?.border || '#3B82F6'),
                  borderWidth: reg.type === 'polygon' ? '0px' : (reg.id === activeRegionId ? '2.5px' : '1.5px'),
                  ...getPolygonLocalClipStyle(reg),
                }"
                @click.stop="activeRegionId = reg.id"
                @mousedown.stop="activeTool === 'select' && onRegionBodyDown(reg, $event)"
              >
                <model-viewer
                  :ref="el => registerModelViewer(reg.id, el)"
                  :src="reg.params.glbUrl || '/models/sofa_electric_single.glb'"
                  alt="3D 家具模型"
                  shadow-intensity="1.2"
                  shadow-softness="0.8"
                  environment-image="neutral"
                  interaction-prompt="none"
                  style="width: 100%; height: 100%; background-color: #F8FAFC; pointer-events: none;"
                  :orientation="`0deg 0deg ${reg.params.yaw || 0}deg`"
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

      <!-- 2.3 右侧配置面板 (宽 350px) -->
      <aside class="w-88 bg-studio-900 border-l border-studio-700 flex flex-col shrink-0 select-none">
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

          <!-- 操作方案选择 (Grid) -->
          <div class="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              @click="activeRegion.op = 'replace'"
              :class="[
                'px-2.5 py-2 rounded-lg border text-xs font-bold text-center cursor-pointer transition-all flex items-center justify-center gap-1.5',
                activeRegion.op === 'replace' ? 'bg-studio-accent/20 border-studio-accent text-studio-accent' : 'bg-studio-950 border-studio-800 text-slate-400 hover:text-white'
              ]"
            >
              <span>🛋️ 3D陈设替换</span>
            </button>
            <button
              type="button"
              @click="activeRegion.op = 'add'"
              :class="[
                'px-2.5 py-2 rounded-lg border text-xs font-bold text-center cursor-pointer transition-all flex items-center justify-center gap-1.5',
                activeRegion.op === 'add' ? 'bg-studio-accent/20 border-studio-accent text-studio-accent' : 'bg-studio-950 border-studio-800 text-slate-400 hover:text-white'
              ]"
            >
              <span>➕ 空间增加</span>
            </button>
            <button
              type="button"
              @click="activeRegion.op = 'erase'"
              :class="[
                'px-2.5 py-2 rounded-lg border text-xs font-bold text-center cursor-pointer transition-all flex items-center justify-center gap-1.5',
                activeRegion.op === 'erase' ? 'bg-studio-accent/20 border-studio-accent text-studio-accent' : 'bg-studio-950 border-studio-800 text-slate-400 hover:text-white'
              ]"
            >
              <span>🧹 杂物消除</span>
            </button>
            <button
              type="button"
              @click="activeRegion.op = 'recolor'"
              :class="[
                'px-2.5 py-2 rounded-lg border text-xs font-bold text-center cursor-pointer transition-all flex items-center justify-center gap-1.5',
                activeRegion.op === 'recolor' ? 'bg-studio-accent/20 border-studio-accent text-studio-accent' : 'bg-studio-950 border-studio-800 text-slate-400 hover:text-white'
              ]"
            >
              <span>🎨 基础属性</span>
            </button>
            <button
              type="button"
              @click="activeRegion.op = 'custom'"
              :class="[
                'px-2.5 py-2 rounded-lg border text-xs font-bold text-center cursor-pointer transition-all flex items-center justify-center gap-1.5',
                activeRegion.op === 'custom' ? 'bg-studio-cyan/20 border-studio-cyan text-studio-cyan' : 'bg-studio-950 border-studio-800 text-slate-400 hover:text-white'
              ]"
            >
              <span>✏️ 自定义描述</span>
            </button>
            <button
              type="button"
              @click="activeRegion.op = 'blank'"
              :class="[
                'px-2.5 py-2 rounded-lg border text-xs font-bold text-center cursor-pointer transition-all flex items-center justify-center gap-1.5',
                activeRegion.op === 'blank' ? 'bg-studio-accent/20 border-studio-accent text-studio-accent' : 'bg-studio-950 border-studio-800 text-slate-400 hover:text-white'
              ]"
            >
              <span>⬜ 选区留白</span>
            </button>
          </div>

          <!-- A. 自定义方案面板 -->
          <div v-if="activeRegion.op === 'custom'" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2.5 animate-in fade-in">
            <div class="text-[11px] font-bold text-slate-300">自定义空间提示词指令</div>
            <textarea
              v-model="activeRegion.params.customDesc"
              rows="3"
              placeholder="描述该区域如何修改，例如：区域1中的物品加大 20%，保持周围空间光影统一"
              class="w-full px-3 py-2 rounded-lg bg-studio-900 border border-studio-750 text-xs text-slate-100 outline-none focus:border-studio-cyan resize-none scrollbar-thin"
            ></textarea>
            <div class="text-[10px] font-mono text-slate-500">大面语义聚焦 (一键框选全图即可指定修改):</div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="chip in [
                  { label: '更换木地板', desc: '更换原木纹理木地板，保持原有陈设与动线完好' },
                  { label: '大理石地砖通铺', desc: '通铺现代大理石抛光地砖，保持家具陈设位置不变' },
                  { label: '现代平顶/无主灯', desc: '改造为现代极简平顶无主灯吊顶设计，预留磁吸轨道灯槽' },
                  { label: '墙面重刷质感漆', desc: '墙面重新粉刷雅致艺术质感微水泥涂料，保持软装完好' }
                ]"
                :key="chip.label"
                type="button"
                @click="activeRegion.params.customDesc = (activeRegion.params.customDesc ? activeRegion.params.customDesc + '；' : '') + chip.desc"
                class="px-2 py-0.5 rounded-full bg-studio-800 hover:bg-studio-750 text-studio-cyan text-[10px] border border-studio-700 hover:border-studio-cyan/40 cursor-pointer transition-colors"
              >
                + {{ chip.label }}
              </button>
            </div>

            <div class="text-[10px] font-mono text-slate-500 pt-1">高频意图快捷标签:</div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="chip in ['物品加大', '物品缩小', '沿箭头迁移至此处', '无中生有落地灯', '提升光泽质感', '消除杂物']"
                :key="chip"
                type="button"
                @click="activeRegion.params.customDesc = (activeRegion.params.customDesc ? activeRegion.params.customDesc + '，' : '') + chip"
                class="px-2 py-0.5 rounded-full bg-studio-800 hover:bg-studio-750 text-slate-300 text-[10px] border border-studio-700 cursor-pointer transition-colors"
              >
                + {{ chip }}
              </button>
            </div>
          </div>

          <!-- B. 3D 陈设替换 / 增加面板 -->
          <div v-else-if="['replace', 'add'].includes(activeRegion.op)" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-3 animate-in fade-in">
            <div class="text-[11px] font-bold text-slate-300">3D 模型陈设与朝向</div>
            <div class="space-y-1.5">
              <label class="block text-[11px] font-mono text-slate-400">选择家具模型</label>
              <select
                v-model="activeRegion.params.glbUrl"
                @change="onModelSelectChange"
                class="w-full px-3 py-1.5 rounded-lg bg-studio-900 border border-studio-750 text-xs font-bold text-white outline-none"
              >
                <option value="/models/sofa_electric_single.glb">单人电动科技沙发</option>
                <option value="/models/sofa_model.glb">意式极简双人沙发</option>
                <option value="/models/sofa_default.glb">北欧布艺现代沙发</option>
                <option value="/models/user_model.glb">空间落地收纳柜</option>
              </select>
            </div>

            <!-- 偏航角滑块 -->
            <div class="space-y-1.5">
              <div class="flex items-center justify-between text-xs font-mono">
                <span class="text-slate-400">偏航角 (Yaw):</span>
                <span class="text-studio-accent font-bold">{{ activeRegion.params.yaw || 0 }}°</span>
              </div>
              <input
                type="range"
                min="-180"
                max="180"
                step="5"
                v-model.number="activeRegion.params.yaw"
                class="w-full accent-studio-accent cursor-pointer"
              />
              <div class="flex justify-between text-[10px] font-mono text-slate-500">
                <span>-180°</span>
                <span>0° (正对)</span>
                <span>+180°</span>
              </div>
            </div>
            <div class="text-[11px] text-slate-500 leading-relaxed bg-studio-900/60 p-2 rounded-lg border border-studio-800">
              💡 纯色背景已遮盖原图旧陈设，手势动画已移除。切换其他选区时该 3D 模型依然保持可见。
            </div>
          </div>

          <!-- C. 杂物消除面板 -->
          <div v-else-if="activeRegion.op === 'erase'" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2.5 animate-in fade-in">
            <div class="text-[11px] font-bold text-slate-300">消除修复描述</div>
            <input
              v-model="activeRegion.params.eraseDesc"
              placeholder="例如：平整自然纹理、平整白墙、木地板"
              class="w-full px-3 py-1.5 rounded-lg bg-studio-900 border border-studio-750 text-xs text-white outline-none"
            />
          </div>

          <!-- D. 基础属性面板（垂直平铺流：材质种类 → 色彩调色 → 表面光泽与粗糙度 → 做旧年代感） -->
          <div v-else-if="activeRegion.op === 'recolor'" class="space-y-3 animate-in fade-in pb-4">
            <!-- 1. 基础材质类别 (Base Material) -->
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2.5">
              <div class="flex items-center justify-between">
                <div class="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                  <span>🧱 基础材质类别</span>
                  <span v-if="activeRegion.params.materialName" class="px-1.5 py-0.2 rounded bg-studio-cyan/20 text-studio-cyan text-[10px] font-mono">
                    {{ activeRegion.params.materialName }}
                  </span>
                </div>
                <span class="text-[10px] text-slate-500 font-mono">品类与纹理</span>
              </div>

              <!-- 品类标签切换 -->
              <div class="flex items-center gap-1 bg-studio-900 p-1 rounded-lg border border-studio-800">
                <button
                  v-for="cat in materialCategories"
                  :key="cat.id"
                  type="button"
                  @click="activeMaterialCategoryTab = cat.id"
                  :class="[
                    'flex-1 py-1 text-[10px] font-bold rounded cursor-pointer transition-colors text-center',
                    activeMaterialCategoryTab === cat.id ? 'bg-studio-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  ]"
                >
                  {{ cat.name }}
                </button>
              </div>

              <!-- PR7: 改读四仓库基础属性选择器 -->
              <div class="rounded-xl border border-studio-800 bg-studio-950 overflow-hidden">
                <BaseAttrPicker
                  v-model="activeRegion.params.baseAttr"
                  :inferredSurface="activeRegion.inferredSurface"
                  @change="onBaseAttrChange"
                />
              </div>

              <!-- 自定义材质名称输入框 -->
              <div class="space-y-1">
                <input
                  v-model="activeRegion.params.materialName"
                  placeholder="或自由输入材质名称，如：罗马洞石、极简微水泥、夯土墙"
                  class="w-full px-2.5 py-1.5 rounded-lg bg-studio-900 border border-studio-750 text-xs text-white placeholder-slate-500 outline-none focus:border-studio-cyan"
                />
              </div>

              <!-- 材质小样贴图工具栏（从素材库挑选 / 本地上传 / 预览） -->
              <div class="pt-1 border-t border-studio-850 space-y-2">
                <div class="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>材质实拍小样切片:</span>
                  <span class="text-slate-500">{{ activeRegion.params.materialTextureUrl ? '已挂载实拍贴图' : '未挂载 (走文字语义)' }}</span>
                </div>

                <!-- 已挂载贴图卡片 -->
                <div v-if="activeRegion.params.materialTextureUrl" class="p-2 rounded-lg bg-studio-900 border border-studio-750 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <img :src="activeRegion.params.materialTextureUrl" class="w-8 h-8 rounded object-cover border border-studio-700 shrink-0" alt="贴图" />
                    <div class="min-w-0">
                      <div class="text-xs font-bold text-white truncate max-w-[170px]">{{ activeRegion.params.materialTextureName || '材质贴图切片' }}</div>
                      <div class="text-[10px] text-studio-cyan font-mono">将写入参考指令</div>
                    </div>
                  </div>
                  <button type="button" @click="removeMaterialTexture" class="p-1 rounded text-slate-400 hover:text-rose-400 cursor-pointer" title="移除贴图">✕</button>
                </div>

                <!-- 挑选与上传按钮 -->
                <div class="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    @click="openMaterialLibraryPicker"
                    class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-200 text-xs font-bold border border-studio-700 cursor-pointer transition-colors"
                  >
                    <span>🏛️ 从素材库挑选</span>
                  </button>
                  <button
                    type="button"
                    @click="triggerLocalTextureUpload"
                    class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-200 text-xs font-bold border border-studio-700 cursor-pointer transition-colors"
                  >
                    <span>☁️ 本地上传贴图</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 2. 色彩系统与调色 (Color & Palette) -->
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2.5">
              <div class="flex items-center justify-between">
                <div class="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                  <span>🎨 色彩方案与微调</span>
                  <span v-if="activeRegion.params.colorName" class="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono">
                    {{ activeRegion.params.colorName }}
                  </span>
                </div>
                <span class="text-[10px] text-slate-500 font-mono">室内经典色卡</span>
              </div>

              <!-- 经典色卡预设 -->
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="c in interiorPalettes"
                  :key="c.id"
                  type="button"
                  @click="selectPresetColor(c)"
                  :class="[
                    'px-2 py-1.5 rounded-lg border text-left cursor-pointer transition-all flex items-center gap-1.5',
                    activeRegion.params.colorHex === c.hex
                      ? 'border-studio-accent bg-studio-accent/20 ring-1 ring-studio-accent'
                      : 'border-studio-800 bg-studio-900/80 hover:border-studio-700'
                  ]"
                  :title="c.desc"
                >
                  <span class="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" :style="{ backgroundColor: c.hex }"></span>
                  <span class="text-[10px] font-bold text-slate-300 truncate">{{ c.name }}</span>
                </button>
              </div>

              <!-- 自定义调色行 -->
              <div class="flex items-center gap-2 pt-1 border-t border-studio-850">
                <input
                  type="color"
                  v-model="activeRegion.params.colorHex"
                  class="w-8 h-8 rounded-lg bg-studio-900 border border-studio-700 cursor-pointer p-0.5 shrink-0"
                  title="自由拾色器"
                />
                <input
                  v-model="activeRegion.params.colorName"
                  placeholder="色彩名称，如：奶油米杏"
                  class="flex-1 px-2.5 py-1.5 rounded-lg bg-studio-900 border border-studio-750 text-xs text-white placeholder-slate-500 outline-none focus:border-studio-cyan"
                />
                <input
                  v-model="activeRegion.params.colorHex"
                  placeholder="#EAE3DC"
                  class="w-20 px-2 py-1.5 rounded-lg bg-studio-900 border border-studio-750 text-xs font-mono text-slate-300 outline-none text-center"
                />
              </div>

              <!-- 明度与饱和度双偏移滑块 -->
              <div class="space-y-2 pt-1">
                <!-- 明度 -->
                <div class="space-y-1">
                  <div class="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>明暗调性 (Brightness):</span>
                    <span :class="(activeRegion.params.brightnessOffset || 0) > 0 ? 'text-amber-300' : ((activeRegion.params.brightnessOffset || 0) < 0 ? 'text-slate-400' : 'text-slate-500')">
                      {{ (activeRegion.params.brightnessOffset || 0) > 0 ? '+' : '' }}{{ activeRegion.params.brightnessOffset || 0 }}%
                      ({{ (activeRegion.params.brightnessOffset || 0) > 15 ? '高调明亮' : ((activeRegion.params.brightnessOffset || 0) < -15 ? '暗调深邃' : '标准均衡') }})
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    step="5"
                    v-model.number="activeRegion.params.brightnessOffset"
                    class="w-full accent-amber-400 cursor-pointer"
                  />
                  <div class="flex justify-between text-[9px] font-mono text-slate-500">
                    <span>暗调深邃 (-50%)</span>
                    <span>均衡 (0)</span>
                    <span>高调透亮 (+50%)</span>
                  </div>
                </div>

                <!-- 饱和度 -->
                <div class="space-y-1">
                  <div class="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>色彩浓度 (Saturation):</span>
                    <span :class="(activeRegion.params.saturationOffset || 0) > 0 ? 'text-rose-400' : ((activeRegion.params.saturationOffset || 0) < 0 ? 'text-cyan-400' : 'text-slate-500')">
                      {{ (activeRegion.params.saturationOffset || 0) > 0 ? '+' : '' }}{{ activeRegion.params.saturationOffset || 0 }}%
                      ({{ (activeRegion.params.saturationOffset || 0) > 15 ? '浓郁醇厚' : ((activeRegion.params.saturationOffset || 0) < -15 ? '低饱灰调' : '自然适中') }})
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    step="5"
                    v-model.number="activeRegion.params.saturationOffset"
                    class="w-full accent-rose-400 cursor-pointer"
                  />
                  <div class="flex justify-between text-[9px] font-mono text-slate-500">
                    <span>素淡灰调 (-50%)</span>
                    <span>中性 (0)</span>
                    <span>浓郁醇厚 (+50%)</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. 表面物理属性与肌理粗糙度 (Finish & Roughness) -->
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2.5">
              <div class="flex items-center justify-between">
                <div class="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                  <span>✨ 表面物理属性 (PBR)</span>
                  <span class="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[10px] font-mono">
                    {{ getFinishName(activeRegion.params.finish) }}
                  </span>
                </div>
                <span class="text-[10px] text-slate-500 font-mono">光泽与反射</span>
              </div>

              <!-- 4 档表面光泽单选胶囊 -->
              <div class="grid grid-cols-2 gap-1.5">
                <button
                  v-for="f in finishOptions"
                  :key="f.id"
                  type="button"
                  @click="activeRegion.params.finish = f.id"
                  :class="[
                    'px-2 py-1.5 rounded-lg border text-left cursor-pointer transition-all',
                    activeRegion.params.finish === f.id
                      ? 'bg-purple-500/20 border-purple-500 text-white shadow-sm'
                      : 'bg-studio-900 border-studio-800 text-slate-300 hover:border-studio-700'
                  ]"
                  :title="f.desc"
                >
                  <div class="text-[11px] font-bold leading-tight">{{ f.name }}</div>
                  <div class="text-[9px] text-slate-400 font-mono">{{ f.en }}</div>
                </button>
              </div>

              <!-- 肌理粗糙度连续滑块 (0% ~ 100%) -->
              <div class="space-y-1.5 pt-1 border-t border-studio-850">
                <div class="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>表面肌理粗糙度:</span>
                  <span class="text-studio-cyan font-bold">
                    {{ activeRegion.params.roughness ?? 45 }}%
                    ({{ (activeRegion.params.roughness ?? 45) <= 20 ? '平滑丝光细腻' : ((activeRegion.params.roughness ?? 45) >= 65 ? '粗粝凹凸微孔' : '自然细腻肌理') }})
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  v-model.number="activeRegion.params.roughness"
                  class="w-full accent-studio-cyan cursor-pointer"
                />
                <div class="flex justify-between text-[9px] font-mono text-slate-500">
                  <span>0% (丝滑无纹)</span>
                  <span>50% (自然肌理)</span>
                  <span>100% (粗粝多孔)</span>
                </div>
              </div>
            </div>

            <!-- 4. 做旧与年代感 (Aging & Patina) -->
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2.5">
              <div class="flex items-center justify-between">
                <div class="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                  <span>⏳ 做旧与时间痕迹</span>
                  <span class="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                    {{ getAgingName(activeRegion.params.aging) }}
                  </span>
                </div>
                <span class="text-[10px] text-slate-500 font-mono">年代质感</span>
              </div>

              <div class="grid grid-cols-2 gap-1.5">
                <button
                  v-for="a in agingOptions"
                  :key="a.id"
                  type="button"
                  @click="activeRegion.params.aging = a.id"
                  :class="[
                    'px-2 py-1.5 rounded-lg border text-left cursor-pointer transition-all',
                    activeRegion.params.aging === a.id
                      ? 'bg-emerald-500/20 border-emerald-500 text-white shadow-sm'
                      : 'bg-studio-900 border-studio-800 text-slate-300 hover:border-studio-700'
                  ]"
                  :title="a.desc"
                >
                  <div class="text-[11px] font-bold leading-tight">{{ a.name }}</div>
                  <div class="text-[9px] text-slate-400 font-mono">{{ a.en }}</div>
                </button>
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
    <footer class="h-16 px-6 border-t border-studio-700/80 bg-studio-900/95 flex items-center justify-between shrink-0">
      <div class="flex-1 min-w-0 mr-6">
        <div class="text-[10px] font-mono text-slate-500 uppercase tracking-wider">配方句实时汇总预览</div>
        <div class="text-xs text-slate-200 truncate font-medium mt-0.5">
          {{ formattedRecipeSummary || '未配置空间操作，纯即时标绘将生成视觉参考图交付' }}
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
          class="px-6 py-2 rounded-xl bg-studio-accent hover:bg-studio-accent/90 text-white text-xs font-bold shadow-lg shadow-studio-accent/20 cursor-pointer transition-all flex items-center gap-2"
        >
          <StudioIcon name="check" :size="15" />
          <span>完成并应用</span>
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

    <!-- 5. DAM 素材库材质与色板挑选浮层 -->
    <AssetPickerModal
      :visible="showMaterialPickerModal"
      context="edit"
      initialSub="material"
      commitOnVersion
      title="从 DAM 素材库挑选材质切片与实拍贴图"
      submitLabel="应用为当前选区材质贴图"
      :maxSelect="1"
      :uploadEnabled="true"
      @confirm="onMaterialPickerConfirm"
      @close="showMaterialPickerModal = false"
    />

    <!-- 本地材质贴图隐藏上传输入 -->
    <input
      ref="textureFileInputRef"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onLocalTextureFileSelected"
    />
  </div>
</template>

<script setup>
import { ref, computed, reactive, watch, nextTick, onMounted, onUnmounted } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';
import AssetPickerModal from '../../components/AssetPickerModal.vue';
import BaseAttrPicker from '../../components/BaseAttrPicker.vue';
import { authFetch } from '../../api';
import { REGION_COLORS, calculateNormalizedBbox } from '../../utils/model-protocol';
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
// 'select' | 'rect' | 'polygon' | 'brush' | 'arrow' | 'text' | 'mosaic' | 'outpaint'
const activeTool = ref('select');

function setTool(tool) {
  activeTool.value = tool;
  if (tool === 'polygon') {
    polyDraftPoints.value = [];
  }
  if (tool !== 'select') {
    selectedAnnotationIndex.value = null;
  }
}

// 选区体系数据结构 (用于写回配方句，默认纯净起手无选区)
const regions = ref([]);
const activeRegionId = ref(null);

const activeRegion = computed(() => {
  return regions.value.find((r) => r.id === activeRegionId.value) || null;
});

// 基础属性状态与配置
const materialCategories = MATERIAL_CATEGORIES;
const interiorPalettes = INTERIOR_COLOR_PALETTES;
const finishOptions = FINISH_OPTIONS;
const agingOptions = AGING_OPTIONS;

const activeMaterialCategoryTab = ref('stone');
const showMaterialPickerModal = ref(false);
const textureFileInputRef = ref(null);

const currentCategoryMaterials = computed(() => {
  const cat = materialCategories.find((c) => c.id === activeMaterialCategoryTab.value);
  return cat ? cat.items : materialCategories[0].items;
});

function onBaseAttrChange(val) {
  if (!activeRegion.value) return;
  if (!activeRegion.value.params) activeRegion.value.params = {};
  activeRegion.value.params.surface = val.surface;
  activeRegion.value.params.subclass = val.subclass;
  activeRegion.value.params.warehouse = val.warehouse;
  activeRegion.value.params.asset_id = val.asset_id;
  activeRegion.value.params.use_shell = val.use_shell;
  if (val.hex) activeRegion.value.params.colorHex = val.hex;
  if (val.finish) activeRegion.value.params.finish = val.finish;
  if (val.roughness !== undefined) activeRegion.value.params.roughness = val.roughness;
  // 清空可能残留的旧 SVG 贴图
  if (activeRegion.value.params.materialTextureUrl && String(activeRegion.value.params.materialTextureUrl).endsWith('.svg')) {
    activeRegion.value.params.materialTextureUrl = null;
  }
}

function selectPresetMaterial(item) {
  if (!activeRegion.value) return;
  activeRegion.value.params.materialId = item.id;
  activeRegion.value.params.materialName = item.name;
  if (!activeRegion.value.params.colorHex || activeRegion.value.params.colorHex === '#FFFFFF') {
    activeRegion.value.params.colorHex = item.color;
  }
  const textureMap = {
    roman_travertine: { url: '/textures/travertine_stone.svg', name: '罗马洞石实拍切片' },
    black_walnut: { url: '/textures/black_walnut.svg', name: '北美黑胡桃实木切片' },
    micro_cement: { url: '/textures/micro_cement.svg', name: '极简微水泥批刮切片' },
    boucle: { url: '/textures/boucle_fabric.svg', name: '羊羔绒颗粒面料切片' },
    brushed_brass: { url: '/textures/brushed_brass.svg', name: '拉丝黄铜金属切片' },
    terrazzo: { url: '/textures/terrazzo.svg', name: '复古水磨石石料切片' },
  };
  if (textureMap[item.id]) {
    activeRegion.value.params.materialTextureUrl = textureMap[item.id].url;
    activeRegion.value.params.materialTextureName = textureMap[item.id].name;
  }
}

function selectPresetColor(c) {
  if (!activeRegion.value) return;
  activeRegion.value.params.colorName = c.name;
  activeRegion.value.params.colorHex = c.hex;
}

function getFinishName(id) {
  const f = finishOptions.find((it) => it.id === id);
  return f ? f.name : '温润柔抛';
}

function getAgingName(id) {
  const a = agingOptions.find((it) => it.id === id);
  return a ? a.name : '全新无瑕';
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

function openMaterialLibraryPicker() {
  showMaterialPickerModal.value = true;
}

function onMaterialPickerConfirm(selectedItems) {
  showMaterialPickerModal.value = false;
  if (Array.isArray(selectedItems) && selectedItems.length > 0 && activeRegion.value) {
    const item = selectedItems[0];
    activeRegion.value.params.materialTextureUrl = item.url || item.imgUrl || item.thumbUrl;
    activeRegion.value.params.materialTextureName = item.name || item.fileName || '素材库材质切片';
    if (item.material) {
      activeRegion.value.params.materialName = item.material;
    }
  }
}

function triggerLocalTextureUpload() {
  textureFileInputRef.value?.click();
}

function onLocalTextureFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file || !activeRegion.value) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    activeRegion.value.params.materialTextureUrl = event.target?.result;
    activeRegion.value.params.materialTextureName = file.name || '本地材质切片';
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function removeMaterialTexture() {
  if (!activeRegion.value) return;
  activeRegion.value.params.materialTextureUrl = null;
  activeRegion.value.params.materialTextureName = '';
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
    setTool('select');
  }
});

async function triggerRegionClassification(reg) {
  if (!reg) return;
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

  try {
    const token = localStorage.getItem('token') || '';
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
    if (json.success && json.data && !json.data.uncertain && json.data.surface && json.data.probability >= 0.75) {
      reg.inferredSurface = json.data.surface;
      reg.inferredProb = json.data.probability;
      if (!reg.params?.baseAttr?.subclass && !reg.params?.baseAttr?.asset_id) {
        if (reg.op === 'custom') {
          reg.op = 'recolor';
        }
        if (!reg.params) reg.params = {};
        if (!reg.params.baseAttr) reg.params.baseAttr = {};
        if (!reg.params.baseAttr.surface) {
          reg.params.baseAttr.surface = json.data.surface;
        }
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
    op: 'custom',
    params: {
      modelName: '单人电动科技沙发',
      glbUrl: '/models/sofa_electric_single.glb',
      yaw: 0,
      materialCategory: 'stone',
      materialId: 'roman_travertine',
      materialName: '罗马洞石',
      materialTextureUrl: '/textures/travertine_stone.svg',
      materialTextureName: '罗马洞石实拍切片',
      colorName: '奶油米杏',
      colorHex: '#EAE3DC',
      brightnessOffset: 0,
      saturationOffset: 0,
      finish: 'satin',
      roughness: 45,
      aging: 'brand_new',
      customDesc: '优化此区域空间结构与软装质感',
      eraseDesc: '修复为平整自然纹理',
      snapshotUrl: null
    }
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
    custom: '自定义',
    replace: '3D替换',
    add: '3D增加',
    erase: '消除',
    recolor: '基础属性',
    blank: '留白'
  };
  return map[op] || '操作';
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
      if (activeTool.value === 'mosaic') {
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
          op: 'custom',
          params: {
            customDesc: '优化此区域空间结构与软装质感',
            modelName: '单人电动科技沙发',
            glbUrl: '/models/sofa_electric_single.glb',
            yaw: 0,
            eraseDesc: '修复为平整纹理',
            colorName: '原木色',
            snapshotUrl: null
          }
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
      op: 'custom',
      params: {
        customDesc: `在涂抹选区中无中生有新增陈设`,
        modelName: '单人电动科技沙发',
        glbUrl: '/models/sofa_electric_single.glb',
        yaw: 0,
        eraseDesc: '消除该涂抹区域杂物',
        colorName: '原木色',
        snapshotUrl: null
      }
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
    op: 'custom',
    params: {
      customDesc: `针对区域${nextIdx}定制空间操作`,
      modelName: '单人电动科技沙发',
      glbUrl: '/models/sofa_electric_single.glb',
      yaw: 0,
      eraseDesc: '消除该多边形内杂物',
      colorName: '原木色',
      snapshotUrl: null
    }
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
const isOutpainting = ref(false);
const outpaintOffset = reactive({ x: 0, y: 0 });
const isDraggingOutpaintImg = ref(false);
const dragStartMouse = reactive({ x: 0, y: 0 });
const dragStartOffset = reactive({ x: 0, y: 0 });

// 计算目标比例数值
const targetRatioNumber = computed(() => {
  const [w, h] = targetExpandRatio.value.split(':').map(Number);
  return w / h;
});

// 计算原图自身原生比例 (例如 576 / 931 ≈ 0.6186)
const nativeRatioNumber = computed(() => {
  const w = imgNaturalSize.w || 800;
  const h = imgNaturalSize.h || 600;
  return w / h;
});

// 计算画布与内部原图几何尺寸（严格保持原生宽高比，绝不拉伸、绝不裁剪！）
const outpaintLayout = computed(() => {
  const maxCanvasW = typeof window !== 'undefined' ? Math.max(860, window.innerWidth - 440) : 1000;
  const maxCanvasH = typeof window !== 'undefined' ? Math.max(520, window.innerHeight - 240) : 600;
  const tRatio = targetRatioNumber.value;
  const nRatio = nativeRatioNumber.value;

  let innerW, innerH, canvasW, canvasH;

  if (tRatio >= nRatio) {
    // 目标画布相对更宽（如 9:16 扩到 16:9）
    innerH = Math.min(maxCanvasH * 0.85, maxCanvasH - 60);
    innerW = innerH * nRatio;
    canvasH = innerH / 0.82;
    canvasW = canvasH * tRatio;
    if (canvasW > maxCanvasW) {
      const scale = maxCanvasW / canvasW;
      canvasW = maxCanvasW;
      canvasH *= scale;
      innerH *= scale;
      innerW *= scale;
    }
  } else {
    // 目标画布相对更高（如 16:9 扩到 9:16）
    innerW = Math.min(maxCanvasW * 0.85, maxCanvasW - 60);
    innerH = innerW / nRatio;
    canvasW = innerW / 0.82;
    canvasH = canvasW / tRatio;
    if (canvasH > maxCanvasH) {
      const scale = maxCanvasH / canvasH;
      canvasH = maxCanvasH;
      canvasW *= scale;
      innerW *= scale;
      innerH *= scale;
    }
  }

  innerW = Math.round(innerW);
  innerH = Math.round(innerH);
  canvasW = Math.round(canvasW);
  canvasH = Math.round(canvasH);

  const initLeft = Math.round((canvasW - innerW) / 2);
  const initTop = Math.round((canvasH - innerH) / 2);

  return { innerW, innerH, canvasW, canvasH, initLeft, initTop };
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
  const { innerW, innerH, initLeft, initTop } = outpaintLayout.value;
  const left = initLeft + outpaintOffset.x;
  const top = initTop + outpaintOffset.y;
  return {
    width: `${innerW}px`,
    height: `${innerH}px`,
    left: `${left}px`,
    top: `${top}px`
  };
});

// 实时计算各方向扩展量数据与百分比
const outpaintMargins = computed(() => {
  const { innerW, innerH, canvasW, canvasH, initLeft, initTop } = outpaintLayout.value;
  const left = Math.max(0, initLeft + outpaintOffset.x);
  const top = Math.max(0, initTop + outpaintOffset.y);
  const right = Math.max(0, canvasW - (left + innerW));
  const bottom = Math.max(0, canvasH - (top + innerH));

  const leftPct = Math.round((left / innerW) * 100);
  const rightPct = Math.round((right / innerW) * 100);
  const topPct = Math.round((top / innerH) * 100);
  const bottomPct = Math.round((bottom / innerH) * 100);

  return { left, top, right, bottom, leftPct, rightPct, topPct, bottomPct };
});

// 预估输出分辨率
const outpaintEstimatedRes = computed(() => {
  const nw = imgNaturalSize.w || 800;
  const nh = imgNaturalSize.h || 600;
  const { leftPct, rightPct, topPct, bottomPct } = outpaintMargins.value;
  const estW = Math.round(nw * (1 + (leftPct + rightPct) / 100));
  const estH = Math.round(nh * (1 + (topPct + bottomPct) / 100));
  return `${estW} × ${estH} (${targetExpandRatio.value})`;
});

function resetOutpaintOffset() {
  outpaintOffset.x = 0;
  outpaintOffset.y = 0;
}

function alignOutpaint(mode) {
  const { innerW, innerH, canvasW, canvasH, initLeft, initTop } = outpaintLayout.value;
  if (mode === 'center') {
    outpaintOffset.x = 0;
    outpaintOffset.y = 0;
  } else if (mode === 'top') {
    outpaintOffset.y = -initTop;
  } else if (mode === 'bottom') {
    outpaintOffset.y = canvasH - innerH - initTop;
  } else if (mode === 'left') {
    outpaintOffset.x = -initLeft;
  } else if (mode === 'right') {
    outpaintOffset.x = canvasW - innerW - initLeft;
  }
}

function onOutpaintDragStart(e) {
  isDraggingOutpaintImg.value = true;
  dragStartMouse.x = e.clientX;
  dragStartMouse.y = e.clientY;
  dragStartOffset.x = outpaintOffset.x;
  dragStartOffset.y = outpaintOffset.y;
}

function onOutpaintDragMove(e) {
  if (!isDraggingOutpaintImg.value) return;
  const { innerW, innerH, canvasW, canvasH, initLeft, initTop } = outpaintLayout.value;
  const dx = e.clientX - dragStartMouse.x;
  const dy = e.clientY - dragStartMouse.y;

  // 限制原图不出画布边界
  const targetX = dragStartOffset.x + dx;
  const targetY = dragStartOffset.y + dy;
  const minX = -initLeft;
  const maxX = canvasW - innerW - initLeft;
  const minY = -initTop;
  const maxY = canvasH - innerH - initTop;

  outpaintOffset.x = Math.max(minX, Math.min(maxX, targetX));
  outpaintOffset.y = Math.max(minY, Math.min(maxY, targetY));
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

function buildAggregatedRecipeLines(regionsList = [], tag = '@图1') {
  if (!regionsList || regionsList.length === 0) return [];
  const groups = [];
  for (const reg of regionsList) {
    const colorName = reg.color?.name || '蓝色';
    const colorTag = `${colorName}线框`;
    const op = reg.op || 'custom';
    let paramSig = '';
    if (op === 'recolor') {
      paramSig = [
        reg.params?.materialName || '',
        reg.params?.colorName || '',
        reg.params?.colorHex || '',
        reg.params?.finish || '',
        reg.params?.roughness ?? '',
        reg.params?.aging || '',
        reg.params?.materialTextureUrl || '',
        reg.params?.materialTextureName || '',
      ].join('::');
    } else if (op === 'replace' || op === 'add') {
      paramSig = `${reg.params?.modelName || ''}::${reg.params?.yaw || 0}`;
    } else if (op === 'erase') {
      paramSig = reg.params?.eraseDesc || '';
    } else if (op === 'custom') {
      paramSig = (reg.params?.customDesc || '').trim();
    }
    const sig = `${colorName}##${op}##${paramSig}`;
    const found = groups.find((g) => g.sig === sig);
    if (found) {
      found.regions.push(reg);
    } else {
      groups.push({ sig, colorName, colorTag, op, params: reg.params || {}, regions: [reg] });
    }
  }

  return groups.map((g) => {
    const targetsStr = g.regions.map((r) => `${tag}[${r.name}]`).join('、');
    const colorDesc = `（${g.colorTag}）`;
    if (g.op === 'custom') {
      const customText = (g.params?.customDesc || '').trim();
      if (!customText) return `• ${targetsStr}${colorDesc}：局部空间优化微调`;
      return `• ${targetsStr}${colorDesc}：${customText}`;
    }
    if (g.op === 'replace') {
      return `• ${targetsStr}${colorDesc}：替换为${g.params?.modelName || '指定家具'}（朝向 ${g.params?.yaw || 0}°，参考3D模型透视）`;
    }
    if (g.op === 'add') {
      return `• ${targetsStr}${colorDesc}：增加${g.params?.modelName || '指定陈设'}（朝向 ${g.params?.yaw || 0}°，参考3D模型透视）`;
    }
    if (g.op === 'erase') {
      return `• ${targetsStr}${colorDesc}：消除杂物，${g.params?.eraseDesc || '修复为平整纹理'}`;
    }
    if (g.op === 'recolor') {
      const baseRec = buildBaseAttributesRecipe({
        tag: '',
        regName: targetsStr,
        colorTag: g.colorTag,
        materialName: g.params?.materialName,
        colorName: g.params?.colorName,
        colorHex: g.params?.colorHex,
        finish: g.params?.finish || 'satin',
        roughness: g.params?.roughness ?? 45,
        aging: g.params?.aging || 'brand_new',
        textureUrl: g.params?.materialTextureUrl,
        textureName: g.params?.materialTextureName,
        isCustomTargetStr: true,
      });
      return `• ${baseRec}`;
    }
    if (g.op === 'blank') {
      return `• ${targetsStr}${colorDesc}：移除并留白，保持背景纯净`;
    }
    return `• ${targetsStr}${colorDesc}：局部微调`;
  });
}

const formattedRecipeSummary = computed(() => {
  const tag = props.targetTag || '@图1';
  if (regions.value.length === 0) return '';
  const lines = buildAggregatedRecipeLines(regions.value, tag);
  return `【空间局部编辑方案】\n${lines.join('\n')}\n要求：保持空间整体结构、主要动线与光影一致。`;
});

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
async function openConfirmModal() {
  if (activeTool.value === 'outpaint') {
    await executeOutpainting();
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
        const nextRefIdx = (props.totalReferenceCount || 1) + 1 + silentRefs.length;
        silentRefs.push({
          name: `${reg.name}_3D朝向图`,
          url: snap,
          tag: `@图${nextRefIdx}`,
          origin: '3d_snapshot'
        });
      }
    }
  }

  // 材质贴图静默参考挂载
  for (const reg of regions.value) {
    if (reg.op === 'recolor' && reg.params?.materialTextureUrl) {
      const nextRefIdx = (props.totalReferenceCount || 1) + 1 + silentRefs.length;
      silentRefs.push({
        name: `${reg.name}_${reg.params.materialName || '材质'}贴图`,
        url: reg.params.materialTextureUrl,
        tag: `@图${nextRefIdx}`,
        origin: 'material_texture'
      });
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
  const baseAttrRegions = regions.value.filter(r => r.op === 'recolor' || r.params?.baseAttr);
  let baseAttrRefs = null;
  let compiledPrompt = null;
  if (baseAttrRegions.length > 0) {
    try {
      const token = localStorage.getItem('token') || '';
      const compileRes = await fetch('/api/base-library/compile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          regions: baseAttrRegions.map(r => ({
            region_id: r.id,
            surface: r.params?.baseAttr?.surface,
            subclass: r.params?.baseAttr?.subclass,
            warehouse: r.params?.baseAttr?.warehouse,
            asset_id: r.params?.baseAttr?.asset_id,
            use_shell: r.params?.baseAttr?.use_shell,
            finish: r.params?.baseAttr?.finish,
            roughness: r.params?.baseAttr?.roughness,
            tint: r.params?.baseAttr?.tint
          })),
          light_mode: null
        })
      });
      if (compileRes.ok) {
        const cJson = await compileRes.json();
        if (cJson.success && Array.isArray(cJson.references)) {
          baseAttrRefs = cJson.references;
          compiledPrompt = cJson.prompt;
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
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({
          regions: baseAttrRegions.map(r => ({
            region_id: r.id,
            surface: r.params?.baseAttr?.surface,
            subclass: r.params?.baseAttr?.subclass,
            warehouse: r.params?.baseAttr?.warehouse,
            asset_id: r.params?.baseAttr?.asset_id,
            use_shell: r.params?.baseAttr?.use_shell,
            finish: r.params?.baseAttr?.finish,
            roughness: r.params?.baseAttr?.roughness
          })),
          light_mode: null
        })
      });
    } catch (_) {}
  }

  const finalRecipe = compiledPrompt ? (`【空间局部编辑方案】\n${compiledPrompt}\n要求：保持空间整体结构、主要动线与光影一致。`) : formattedRecipeSummary.value;

  emit('apply-regions-to-image', {
    imageIndex: props.imageIndex,
    regions: JSON.parse(JSON.stringify(regions.value)),
    recipe: finalRecipe,
    silentRefs: baseAttrRefs ? [] : pendingNewRefs.value,
    baseAttrRefs: baseAttrRefs || null,
    annotations: JSON.parse(JSON.stringify(annotations.value)),
    wireframeDataUrl
  });

  emit('apply-recipe-with-refs', {
    recipe: formattedRecipeSummary.value,
    newRefs: []
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
  window.addEventListener('resize', () => {
    syncDisplaySize();
    const dw = canvasDisplaySize.w;
    const dh = canvasDisplaySize.h;
    if (dw > 0 && dh > 0) {
      projectNormalizedDataToScreen(dw, dh);
    }
    renderMosaicCanvas();
  });
  if (typeof window !== 'undefined' && window.customElements && !window.customElements.get('model-viewer')) {
    try {
      await import('@google/model-viewer');
    } catch (err) {
      if (!window.customElements.get('model-viewer')) {
        console.warn('Failed to load @google/model-viewer:', err);
      }
    }
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
