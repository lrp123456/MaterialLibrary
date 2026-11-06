<template>
  <div class="qs-root flex-1 min-h-0 flex flex-col bg-studio-950 overflow-hidden font-sans text-slate-100 select-none text-sm">
    <!-- 1. 顶部操作栏：模式切换 (精准编辑 vs 全局重绘) + 视口工具 -->
    <header class="h-12 bg-studio-900 border-b border-studio-750 px-5 flex items-center justify-between shrink-0">
      <div class="flex items-center space-x-2.5">
        <button
          @click="studioMode = 'precision'"
          :class="[
            'px-4 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-2 cursor-pointer',
            studioMode === 'precision'
              ? 'bg-studio-accent text-white shadow-md shadow-studio-accent/25'
              : 'text-slate-300 hover:text-white hover:bg-studio-800'
          ]"
        >
          <StudioIcon name="edit" :size="14" />
          <span>AI 快捷精准编辑 (makesense 标注 + 6大模式)</span>
        </button>

        <button
          @click="studioMode = 'global'"
          :class="[
            'px-4 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-2 cursor-pointer',
            studioMode === 'global'
              ? 'bg-studio-indigo text-white shadow-md shadow-studio-indigo/25'
              : 'text-slate-300 hover:text-white hover:bg-studio-800'
          ]"
        >
          <StudioIcon name="sparkles" :size="14" />
          <span>全局重绘增强 (真实打标系统风格 / 超分 / 扩图)</span>
        </button>
      </div>

      <!-- 中间：画布交互快捷控制 -->
      <div class="flex items-center space-x-3 text-xs text-slate-300">
        <button
          @click="openAssetSelector"
          class="px-2.5 py-1 rounded-lg bg-studio-850 hover:bg-studio-800 text-studio-cyan font-bold border border-studio-750 flex items-center space-x-1 cursor-pointer"
          title="从私有素材库选取新底图"
        >
          <StudioIcon name="image" :size="13" />
          <span>更换底图</span>
        </button>

        <div class="h-3.5 w-px bg-studio-750"></div>

        <div class="flex items-center space-x-1 font-mono text-xs">
          <span>缩放:</span>
          <button @click="zoomCanvas(-0.2)" class="px-2 py-0.5 rounded bg-studio-850 hover:bg-studio-800 text-slate-200 font-bold">-</button>
          <span class="w-12 text-center text-studio-cyan font-bold">{{ Math.round(canvasScale * 100) }}%</span>
          <button @click="zoomCanvas(0.2)" class="px-2 py-0.5 rounded bg-studio-850 hover:bg-studio-800 text-slate-200 font-bold">+</button>
          <button @click="fitCanvasToViewport" class="ml-1 px-2 py-0.5 rounded bg-studio-850 hover:bg-studio-800 text-studio-cyan text-[11px] font-bold" title="自适应充满视口">适应视口</button>
          <button @click="resetCanvas" class="px-2 py-0.5 rounded bg-studio-850 hover:bg-studio-800 text-slate-300 text-[11px] font-bold">1:1</button>
        </div>

        <div class="h-3.5 w-px bg-studio-750"></div>

        <label class="flex items-center space-x-1.5 cursor-pointer text-xs hover:text-white font-medium">
          <input type="checkbox" v-model="showCompare" class="rounded accent-studio-accent" />
          <span>前后对比 (Before/After)</span>
        </label>
      </div>

      <!-- 右侧：执行生成按钮 -->
      <div class="flex items-center space-x-2">
        <button
          @click="runExecute"
          :disabled="executing || !currentImage"
          class="px-5 py-2 rounded-xl bg-gradient-to-r from-studio-accent to-studio-cyan hover:brightness-110 text-white text-xs font-extrabold flex items-center space-x-2 shadow-lg shadow-studio-accent/25 transition-all disabled:opacity-50 cursor-pointer"
        >
          <StudioIcon name="wand" :size="14" :class="{ 'animate-spin': executing }" />
          <span>{{ executing ? '模型计算中...' : '开始执行处理' }}</span>
        </button>
      </div>
    </header>

    <!-- 2. 工作区主体：中央视口 + 右侧配置抽屉 -->
    <div class="qs-body flex-1 flex overflow-hidden">
      <!-- 2.1 中央画布视口 -->
      <main
        ref="viewportRef"
        class="qs-viewport flex-1 bg-studio-950 relative overflow-hidden flex items-center justify-center cursor-crosshair select-none"
        @wheel.prevent="onCanvasWheel"
        @mousedown="onViewportMouseDown"
        @mousemove="onViewportMouseMove"
        @mouseup="onViewportMouseUp"
        @contextmenu.prevent="onContextMenu"
      >
        <!-- 仅在精准编辑模式下显示标注工具栏 (扩图模式除外，扩图使用专属工作台控制) -->
        <div
          v-if="studioMode === 'precision' && selectedMode !== 'expand'"
          class="absolute top-4 left-4 z-20 bg-studio-900/95 backdrop-blur-md px-3.5 py-2 rounded-xl border border-studio-750 flex items-center space-x-2 text-xs shadow-2xl"
        >
          <span class="text-slate-400 font-extrabold text-[11px]">makesense 标注:</span>
          <!-- 矩形拉框 -->
          <button
            @click="annoTool = 'rect'"
            :class="['px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer', annoTool === 'rect' ? 'bg-studio-accent text-white shadow' : 'text-slate-300 hover:text-white hover:bg-studio-800']"
          >
            拉框标注 (BBox)
          </button>
          <!-- 多边形自由标注 -->
          <button
            @click="annoTool = 'polygon'"
            :class="['px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer', annoTool === 'polygon' ? 'bg-studio-accent text-white shadow' : 'text-slate-300 hover:text-white hover:bg-studio-800']"
          >
            自由多边形 (Polygon)
          </button>

          <!-- 增加模式下的避让区绘制开关 -->
          <template v-if="selectedMode === 'add'">
            <div class="h-4 w-px bg-studio-750"></div>
            <button
              @click="drawingAvoidMode = !drawingAvoidMode"
              :class="['px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1', drawingAvoidMode ? 'bg-amber-600 text-white shadow' : 'bg-studio-850 text-amber-300 hover:bg-studio-800']"
            >
              <span>🛡️</span>
              <span>{{ drawingAvoidMode ? '正在绘制避让区...' : '标记避让保护区' }}</span>
            </button>
          </template>

          <div class="h-4 w-px bg-studio-750"></div>

          <button
            @click="detectAutoSegment"
            :disabled="detecting"
            class="px-3 py-1.5 rounded-lg bg-studio-indigo/20 hover:bg-studio-indigo/30 text-studio-indigo text-xs font-extrabold border border-studio-indigo/40 flex items-center space-x-1 cursor-pointer transition-all"
            title="调用服务端 YOLO-seg 自动识别家具轮廓"
          >
            <span>🎯</span>
            <span>{{ detecting ? '检测中...' : '智能吸附家具' }}</span>
          </button>

          <button
            @click="clearAnnotation"
            class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-studio-800 cursor-pointer"
            title="清空当前标注"
          >
            <StudioIcon name="close" :size="14" />
          </button>
        </div>

        <!-- 悬浮操作提示 -->
        <div
          v-if="studioMode === 'precision' && selectedMode !== 'expand'"
          class="absolute bottom-4 left-4 z-20 bg-studio-900/85 backdrop-blur-xs px-3.5 py-1.5 rounded-lg border border-studio-800 text-[11px] text-slate-300 font-mono space-x-3 pointer-events-none"
        >
          <span>滚轮: 缩放</span>
          <span>右键拖动/中键: 平移</span>
          <span v-if="drawingAvoidMode" class="text-amber-300 font-bold">正在拉框标记【避让区】(禁止模型侵入)</span>
          <span v-else-if="annoTool === 'rect'">左键拖拽: 绘制目标选区矩形</span>
          <span v-else class="text-studio-cyan font-bold">左键: 落点 | 双击: 闭合 | 右键单击: 撤销上一点 (已闭合则先取消闭合)</span>
        </div>

        <!-- 对比视图 (支持同轴滑动卷帘 / 左右并排双图对比) -->
        <BeforeAfterSlider
          v-if="showCompare && resultImage"
          :beforeImage="currentImage"
          :afterImage="resultImage"
          @close="showCompare = false"
          @apply-as-base="applyResultAsBase"
          class="w-full h-full max-h-[720px] rounded-xl border border-studio-750"
        />

        <!-- 扩图专用可视化交互工作台 (展示扩充后目标画布、原图位置与原图占比) -->
        <div
          v-else-if="studioMode === 'precision' && selectedMode === 'expand'"
          class="relative flex flex-col items-center justify-center w-full h-full p-4 select-none"
        >
          <!-- 悬浮画幅与控制快捷条 -->
          <div class="absolute top-4 z-30 bg-studio-900/95 backdrop-blur-md px-4 py-2 rounded-xl border border-studio-750 flex flex-wrap items-center gap-3 text-xs shadow-2xl">
            <!-- 画幅比例快速切换 -->
            <div class="flex items-center space-x-1.5">
              <span class="text-slate-400 font-extrabold text-[11px]">目标画幅:</span>
              <button
                v-for="r in ['16:9', '9:16', '1:1', '4:3', '21:9', '3:2']"
                :key="r"
                @click="setExpandTargetRatio(r)"
                :class="[
                  'px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer',
                  targetExpandRatio === r
                    ? 'bg-studio-accent text-white shadow-md'
                    : 'bg-studio-850 text-slate-300 hover:text-white hover:bg-studio-800 border border-studio-750'
                ]"
              >
                {{ r }}
              </button>
            </div>

            <div class="h-4 w-px bg-studio-750"></div>

            <!-- 原图占比调节滑块 -->
            <div class="flex items-center space-x-2">
              <span class="text-slate-400 font-bold text-[11px]">原图占比:</span>
              <input
                type="range"
                min="35"
                max="95"
                step="5"
                v-model.number="expandImageScale"
                class="w-24 accent-studio-accent cursor-pointer"
              />
              <span class="text-studio-cyan font-mono font-bold w-10 text-right">{{ expandImageScale }}%</span>
            </div>

            <div class="h-4 w-px bg-studio-750"></div>

            <!-- 原图位置快捷对齐 -->
            <div class="flex items-center space-x-1">
              <span class="text-slate-400 font-bold text-[11px]">对齐:</span>
              <button @click="alignExpandImage('center')" class="px-2 py-0.5 rounded bg-studio-850 hover:bg-studio-800 text-slate-200 text-[11px] font-bold border border-studio-750 cursor-pointer">居中</button>
              <button @click="alignExpandImage('left')" class="px-2 py-0.5 rounded bg-studio-850 hover:bg-studio-800 text-slate-200 text-[11px] font-bold border border-studio-750 cursor-pointer">靠左</button>
              <button @click="alignExpandImage('right')" class="px-2 py-0.5 rounded bg-studio-850 hover:bg-studio-800 text-slate-200 text-[11px] font-bold border border-studio-750 cursor-pointer">靠右</button>
              <button @click="alignExpandImage('top')" class="px-2 py-0.5 rounded bg-studio-850 hover:bg-studio-800 text-slate-200 text-[11px] font-bold border border-studio-750 cursor-pointer">靠顶</button>
              <button @click="alignExpandImage('bottom')" class="px-2 py-0.5 rounded bg-studio-850 hover:bg-studio-800 text-slate-200 text-[11px] font-bold border border-studio-750 cursor-pointer">靠底</button>
            </div>
          </div>

          <!-- 扩图可视化目标画布容器 (按真实目标比例渲染外层容器) -->
          <div
            ref="expandCanvasContainerRef"
            class="relative rounded-2xl border-2 border-dashed border-studio-cyan/60 bg-studio-950/90 shadow-2xl overflow-hidden flex items-center justify-center transition-all cursor-move"
            :style="expandCanvasContainerStyle"
          >
            <!-- 背景网格与 AI 扩展区标识 -->
            <div class="absolute inset-0 bg-[radial-gradient(#334155_1.2px,transparent_1.2px)] [background-size:20px_20px] pointer-events-none opacity-40"></div>

            <!-- 四角标线与画幅水印 -->
            <div class="absolute top-3 left-3 text-[10px] font-mono font-bold text-studio-cyan/80 pointer-events-none flex items-center gap-1.5">
              <span>🎯 目标画幅: {{ targetExpandRatio }}</span>
              <span>({{ targetDimensions.w }} × {{ targetDimensions.h }} px)</span>
            </div>
            <div class="absolute bottom-3 right-3 text-[10px] font-mono text-slate-500 pointer-events-none">
              ✨ 虚线区域为 AI 智能填充生成区
            </div>

            <!-- 可拖动的原图卡片 -->
            <div
              class="absolute rounded-lg overflow-hidden border-2 border-white shadow-2xl select-none group/img cursor-grab active:cursor-grabbing"
              :style="expandImageStyle"
              @mousedown.stop="onExpandImageMouseDown"
            >
              <img :src="currentImage" class="w-full h-full object-cover pointer-events-none" />

              <!-- 原图居中指示与标签 -->
              <div class="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <span class="px-2 py-1 rounded bg-black/75 text-white text-[11px] font-bold">按住拖拽调整原图位置</span>
              </div>
              <div class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono font-bold text-white pointer-events-none">
                原图 ({{ expandImageScale }}%)
              </div>
            </div>

            <!-- 四边扩展尺寸指示徽标 -->
            <div class="absolute top-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-studio-900/90 border border-studio-700 text-[10px] font-mono text-studio-cyan pointer-events-none">
              上扩: {{ Math.round(expandMargins.top * 100) }}%
            </div>
            <div class="absolute bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-studio-900/90 border border-studio-700 text-[10px] font-mono text-studio-cyan pointer-events-none">
              下扩: {{ Math.round(expandMargins.bottom * 100) }}%
            </div>
            <div class="absolute left-1 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-studio-900/90 border border-studio-700 text-[10px] font-mono text-studio-cyan pointer-events-none">
              左扩: {{ Math.round(expandMargins.left * 100) }}%
            </div>
            <div class="absolute right-1 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-studio-900/90 border border-studio-700 text-[10px] font-mono text-studio-cyan pointer-events-none">
              右扩: {{ Math.round(expandMargins.right * 100) }}%
            </div>
          </div>

          <!-- 底部扩图状态提示栏 -->
          <div class="absolute bottom-4 z-30 bg-studio-900/90 backdrop-blur-md px-4 py-1.5 rounded-xl border border-studio-750 text-xs text-slate-300 flex items-center space-x-3 shadow-xl">
            <span class="font-bold text-white">💡 扩图提示:</span>
            <span>在画布中可自由拖拽原图调整构图重心；调整占比可控制延展范围；点击右上角【开始执行处理】调用即梦模型推理。</span>
          </div>
        </div>

        <!-- 空状态：底图上传/选择卡片 (杜绝强制默认选择，支持本地上传与素材库选择) -->
        <div
          v-else-if="!currentImage"
          class="flex flex-col items-center justify-center p-8 text-center max-w-xl mx-auto space-y-6 z-20 select-none animate-in fade-in"
          @dragover.prevent
          @drop.prevent="handleDropImage"
        >
          <div class="w-24 h-24 rounded-3xl bg-studio-900 border-2 border-dashed border-studio-accent/60 flex items-center justify-center text-studio-accent shadow-2xl">
            <StudioIcon name="image" :size="44" />
          </div>

          <div class="space-y-2">
            <h3 class="text-xl sm:text-2xl font-extrabold text-white">AI 快捷精准编辑工作台</h3>
            <p class="text-sm text-slate-300 leading-relaxed">
              请上传本地室内设计照片，或从私有 DAM 素材库中选取底图开始精准编辑。图片将自动铺满视口进行标注与重绘。
            </p>
          </div>

          <div class="flex flex-wrap items-center justify-center gap-4 pt-2">
            <button
              @click="triggerLocalUpload"
              class="px-6 py-3 rounded-xl bg-studio-accent hover:brightness-110 text-white font-extrabold text-sm flex items-center space-x-2 shadow-lg shadow-studio-accent/25 transition-all cursor-pointer"
            >
              <StudioIcon name="plus" :size="16" />
              <span>📁 本地上传照片</span>
            </button>

            <button
              @click="openAssetSelector"
              class="px-6 py-3 rounded-xl bg-studio-900 hover:bg-studio-850 text-studio-cyan font-extrabold text-sm border border-studio-700 flex items-center space-x-2 shadow-md transition-all cursor-pointer"
            >
              <StudioIcon name="grid" :size="16" />
              <span>🏛️ 从私有素材库选取</span>
            </button>
          </div>

          <input
            ref="localUploadInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="onLocalUploadChange"
          />

          <div class="text-xs text-slate-400 font-mono">
            支持 JPG、PNG、WEBP 格式 · 拖拽图片至此视口可直接载入
          </div>
        </div>

        <!-- 主缩放画布容器 (有底图时渲染，自适应铺满视口) -->
        <div
          v-else
          class="relative transition-transform duration-75 origin-center will-change-transform shadow-2xl rounded-lg overflow-hidden border border-studio-750"
          :style="{
            transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasScale})`
          }"
        >
          <!-- 底图 (支持自适应与高清充满) -->
          <img
            ref="imageRef"
            :src="currentImage"
            class="max-w-none object-contain block pointer-events-none select-none"
            :style="{
              width: imageNaturalSize.w ? `${imageNaturalSize.w}px` : 'auto',
              height: imageNaturalSize.h ? `${imageNaturalSize.h}px` : 'auto'
            }"
            @load="onImageLoaded"
          />

          <!-- 仅在精准编辑模式下渲染 SVG 标注层 -->
          <svg
            v-if="studioMode === 'precision' && selectedMode !== 'expand'"
            class="absolute inset-0 w-full h-full"
            @click="onSvgClick"
          >
            <!-- 1. 主目标选区：矩形拉框标注渲染 -->
            <g v-if="annoTool === 'rect' && rectBBox">
              <rect
                :x="Math.min(rectBBox.x1, rectBBox.x2)"
                :y="Math.min(rectBBox.y1, rectBBox.y2)"
                :width="Math.abs(rectBBox.x2 - rectBBox.x1)"
                :height="Math.abs(rectBBox.y2 - rectBBox.y1)"
                fill="rgba(56, 189, 248, 0.25)"
                stroke="#38bdf8"
                :stroke-width="uiPx(2.5)"
                class="cursor-move"
              />
              <circle
                v-for="h in rectHandles"
                :key="h.id"
                :cx="h.x"
                :cy="h.y"
                :r="uiPx(rectHandle === h.id ? 8 : 6)"
                fill="#38bdf8"
                stroke="#fff"
                :stroke-width="uiPx(1.5)"
                class="cursor-move"
                @mouseenter="rectHandle = h.id"
                @mouseleave="onRectHandleLeave"
                @mousedown.stop="onRectHandleDown(h.id)"
              />
            </g>

            <!-- 2. 主目标选区：多边形标注渲染 -->
            <g v-else-if="annoTool === 'polygon'">
              <polygon
                v-if="polygonPoints.length > 2"
                :points="polygonPointsStr"
                :fill="isPolyClosed ? 'rgba(59, 130, 246, 0.35)' : 'rgba(59, 130, 246, 0.15)'"
                stroke="#38bdf8"
                :stroke-width="uiPx(2)"
                :stroke-dasharray="isPolyClosed ? 'none' : uiPx(6)"
                class="cursor-move"
                @mousedown="onPolygonMouseDown"
              />

              <!-- 已闭合时：边线命中区，双击边线插入新顶点（绘制中不启用，双击留给「闭合」） -->
              <g v-if="isPolyClosed">
                <line
                  v-for="(seg, idx) in polygonSegments"
                  :key="'seg_' + idx"
                  :x1="seg.p1.x"
                  :y1="seg.p1.y"
                  :x2="seg.p2.x"
                  :y2="seg.p2.y"
                  stroke="#38bdf8"
                  :stroke-width="uiPx(16)"
                  stroke-opacity="0"
                  class="hover:stroke-opacity-25 cursor-copy"
                  @dblclick.stop="insertPointOnLine(idx, $event)"
                />
              </g>

              <!-- 顶点手柄锚点：透明大命中圈 + 小圆点，屏幕尺寸恒定，缩小画布也好点 -->
              <g v-for="(p, idx) in polygonPoints" :key="'pt_' + idx">
                <circle
                  :cx="p.x"
                  :cy="p.y"
                  :r="ptHitRadius"
                  fill="transparent"
                  pointer-events="all"
                  class="cursor-grab active:cursor-grabbing"
                  @mouseenter="hoverPointIdx = idx"
                  @mouseleave="hoverPointIdx = null"
                  @mousedown.stop.prevent="onPointMouseDown(idx, $event)"
                  @contextmenu.stop.prevent="deletePoint(idx)"
                  @click.stop="onPointClick(idx)"
                  @dblclick.stop.prevent
                />
                <circle
                  :cx="p.x"
                  :cy="p.y"
                  :r="ptRadius(idx)"
                  :fill="idx === 0 ? '#fbbf24' : '#06b6d4'"
                  stroke="#ffffff"
                  :stroke-width="uiPx(2)"
                  pointer-events="none"
                  class="transition-all"
                />
              </g>

              <!-- 绘制中鼠标跟随虚线 -->
              <line
                v-if="!isPolyClosed && polygonPoints.length > 0 && mouseCurrentPos"
                :x1="polygonPoints[polygonPoints.length - 1].x"
                :y1="polygonPoints[polygonPoints.length - 1].y"
                :x2="mouseCurrentPos.x"
                :y2="mouseCurrentPos.y"
                stroke="#fbbf24"
                :stroke-width="uiPx(1.5)"
                :stroke-dasharray="uiPx(4)"
                pointer-events="none"
              />
            </g>

            <!-- 3. 避让区约束 (第二个保护框，黄色醒目虚线) -->
            <g v-if="avoidBBox">
              <rect
                :x="Math.min(avoidBBox.x1, avoidBBox.x2)"
                :y="Math.min(avoidBBox.y1, avoidBBox.y2)"
                :width="Math.abs(avoidBBox.x2 - avoidBBox.x1)"
                :height="Math.abs(avoidBBox.y2 - avoidBBox.y1)"
                fill="rgba(245, 158, 11, 0.2)"
                stroke="#f59e0b"
                stroke-width="2"
                stroke-dasharray="5 3"
              />
              <text
                :x="Math.min(avoidBBox.x1, avoidBBox.x2) + 6"
                :y="Math.min(avoidBBox.y1, avoidBBox.y2) + 16"
                fill="#f59e0b"
                font-size="11"
                font-weight="bold"
              >
                🛡️ 避让保护区 (禁止侵入)
              </text>
            </g>
          </svg>
        </div>
      </main>

      <!-- 2.2 右侧参数抽屉：精准编辑 (6大专业模式) -->
      <aside v-if="studioMode === 'precision'" class="w-[430px] bg-studio-900 border-l border-studio-750 flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
        <div
          class="m-4 mb-0 rounded-xl border border-dashed border-studio-700 bg-studio-950 p-4 text-center cursor-pointer"
          @click="triggerLocalUpload"
          @dragover.prevent
          @drop.prevent="handleDropImage"
        >
          <p class="text-sm font-bold text-white">上传底图</p>
          <p class="mt-1 text-xs text-slate-300">拖到这里，或点击选择照片。已有底图时会换成新的一张。</p>
          <p v-if="baseFileName" class="mt-2 text-xs font-bold text-studio-cyan truncate">{{ baseFileName }}</p>
        </div>
        <!-- 顶部：模型选择 -->
        <div class="p-4 border-b border-studio-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-white">精准编辑模型：</span>
            <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-studio-emerald/15 text-emerald-400 border border-studio-emerald/30">
              原生交互编辑
            </span>
          </div>

          <select
            v-model="precisionModelKey"
            class="w-full bg-studio-950 text-white font-extrabold text-xs border border-studio-700 rounded-lg p-2 outline-none"
          >
            <option value="seedream5flash">Seedream 5.0 Flash (原生支持 BBox 框内精准替换)</option>
            <option value="seedream5pro">Seedream 5.0 Pro (顶级细节 · 原生交互编辑)</option>
            <option value="general_vlm">通用大模型 (自动调用 VLM 结合 3D 朝向截图优化提示词)</option>
          </select>
        </div>

        <!-- 出图参数 (清晰度 / 画幅)：与对话生成共用契约参数条 -->
        <div v-if="outSchema && selectedMode !== 'expand'" class="p-4 border-b border-studio-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-white">出图参数：</span>
            <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-studio-800 text-slate-300">模型契约</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <DynamicModelParamBar
              :schema="outSchema"
              v-model="outParams"
              v-model:showAdvanced="showOutAdvanced"
            />
          </div>
          <p v-if="outDiverging" class="text-[11px] leading-relaxed text-amber-300">
            画幅 {{ outParams.ratio }} 与底图 {{ imageNaturalSize.w }}×{{ imageNaturalSize.h }} 不符，将整幅重绘，框外像素不再逐像素保留。
            <template v-if="selectedMode === 'install'">安装模式必须贴回原图，画幅固定跟随底图，这一档不会生效。</template>
          </p>
          <p v-else class="text-[11px] leading-relaxed text-slate-400">
            画幅默认按底图 {{ imageNaturalSize.w }}×{{ imageNaturalSize.h }} 取最接近的一档，框外逐像素贴回；清晰度会把底图一并放大到该档。
          </p>
          <p v-if="outEcho" class="text-[11px] font-mono leading-relaxed text-studio-cyan">{{ outEcho }}</p>
          <p v-if="lastRegionNote" class="text-[11px] leading-relaxed text-amber-300">{{ lastRegionNote }}</p>
        </div>
        <p v-else-if="selectedMode !== 'expand'" class="px-4 pt-3 text-[11px] leading-relaxed text-slate-400 border-b border-studio-800">
          这个模型的出图参数表还没接入，本次不指定清晰度与画幅，由服务端按默认出图。
        </p>

        <!-- 模式选择 (6大专业模式) -->
        <div class="p-4 border-b border-studio-800 space-y-2.5">
          <span class="text-xs font-bold text-white block">选择专业模式：</span>
          <div class="grid grid-cols-3 gap-2 text-xs">
            <button
              v-for="m in editModes"
              :key="m.key"
              @click="selectedMode = m.key"
              :class="[
                'p-2.5 rounded-xl border text-center transition-all cursor-pointer',
                selectedMode === m.key
                  ? 'border-studio-accent bg-studio-accent/20 text-white font-extrabold shadow-sm'
                  : 'border-studio-800 bg-studio-950 text-slate-300 hover:text-white'
              ]"
            >
              <div class="text-base mb-0.5">{{ m.icon }}</div>
              <div class="text-xs">{{ m.label }}</div>
            </button>
          </div>
        </div>

        <!-- 基础属性四仓库控制面板 -->
        <div class="p-3 border-b border-studio-800 bg-studio-950/80 rounded-xl space-y-2 mb-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-white">基础属性（四仓库）</span>
            <span v-if="inferredSurface" class="text-[10px] text-studio-cyan bg-studio-cyan/15 px-1.5 py-0.5 rounded font-mono font-bold">
              AI识别: {{ inferredSurface }}
            </span>
          </div>
          <BaseAttrPicker
            :inferredSurface="inferredSurface"
            v-model="quickBaseAttr"
          />
        </div>

        <!-- 模式专属配置面板 -->
        <div class="flex-1 p-4 space-y-4 text-xs">
          <!-- ==================== 1. 替换模式 ==================== -->
          <div v-if="selectedMode === 'replace'" class="space-y-4">
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
              <span class="font-extrabold text-white block text-xs">替换模式：已有物体换新</span>
              <p class="text-[12px] text-slate-300 leading-relaxed">
                框选已有物体删除后，引入 3D 模型实体并实时旋转朝向对齐透视。
              </p>
            </div>

            <!-- 3D 资产选型 -->
            <div class="space-y-2">
              <label class="text-xs text-slate-200 font-extrabold block">1. 3D 模型资产 (SLB/GLB)：</label>
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="src in modelSources"
                  :key="src.key"
                  @click="activeModelSource = src.key"
                  :class="[
                    'py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer',
                    activeModelSource === src.key ? 'bg-studio-800 border-studio-cyan text-studio-cyan' : 'border-studio-800 text-slate-400 bg-studio-950'
                  ]"
                >
                  {{ src.label }}
                </button>
              </div>

              <!-- 内置模型选择 -->
              <div v-if="activeModelSource === 'builtin'" class="pt-1">
                <select v-model="selectedModelGlb" class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2 text-slate-200 outline-none text-xs font-medium">
                  <option value="/models/sofa_electric_single.glb">单人电动尾沙发 (sofa_electric_single.glb)</option>
                  <option value="/models/sofa_model.glb">意式极简三人真皮沙发 (sofa_model.glb)</option>
                  <option value="/models/sofa_default.glb">北欧布艺双人沙发 (sofa_default.glb)</option>
                  <option value="/models/user_model.glb">现代人体工学单人椅 (user_model.glb)</option>
                </select>
              </div>

              <!-- 本地上传 -->
              <div v-else-if="activeModelSource === 'upload'" class="pt-1">
                <div
                  @click="triggerModelUpload"
                  class="border-2 border-dashed border-studio-700 hover:border-studio-accent rounded-xl p-3 text-center cursor-pointer bg-studio-950 text-slate-300 text-xs font-bold"
                >
                  {{ uploadedModelName || '点击上传本地 .glb / .slb 3D模型' }}
                </div>
                <input ref="modelFileInput" type="file" accept=".glb,.gltf,.slb" class="hidden" @change="onModelUploaded" />
              </div>
            </div>

            <!-- 真正的 3D GLB 预览与朝向自转控制器 -->
            <div class="space-y-3 p-3.5 rounded-2xl bg-studio-950 border border-studio-800 shadow-md">
              <div class="flex items-center justify-between">
                <span class="text-xs font-extrabold text-white">2. 真实 3D GLB 模型视口：</span>
                <span class="text-xs font-mono font-bold text-studio-cyan">朝向: {{ modelRotation }}°</span>
              </div>

              <div class="h-44 rounded-xl overflow-hidden bg-gradient-to-b from-slate-900 to-black border border-studio-700 relative shadow-inner">
                <model-viewer
                  ref="modelViewerRef"
                  :src="selectedModelGlb"
                  alt="3D 家具模型"
                  shadow-intensity="1.2"
                  shadow-softness="0.8"
                  interaction-prompt="none"
                  :orientation="modelOrientation"
                  style="width: 100%; height: 100%; pointer-events: none;"
                ></model-viewer>
                <span class="on-media absolute bottom-1 right-2 text-[10px] font-mono bg-black/70 px-1.5 py-0.5 rounded">
                  用下方滑条转向
                </span>
              </div>

              <div class="space-y-2">
                <div class="flex justify-between text-xs text-slate-300 font-medium">
                  <span>左右</span>
                  <span class="font-mono text-studio-cyan font-bold">{{ modelRotation }}°</span>
                </div>
                <input type="range" min="0" max="360" v-model.number="modelRotation" class="w-full accent-studio-accent cursor-pointer" />
                <div class="flex justify-between text-xs text-slate-300 font-medium">
                  <span>上下</span>
                  <span class="font-mono text-studio-cyan font-bold">{{ modelPitch }}°</span>
                </div>
                <input type="range" min="-45" max="45" v-model.number="modelPitch" class="w-full accent-studio-accent cursor-pointer" />
              </div>
            </div>
          </div>

          <!-- ==================== 2. 安装模式 ==================== -->
          <div v-else-if="selectedMode === 'install'" class="space-y-4">
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
              <span class="font-extrabold text-white block text-xs">安装模式：贴合表面安装开关面板</span>
              <p class="text-[12px] text-slate-300 leading-relaxed">原处无物体，贴合表面安装，带有 3 档细节保真策略与 Reinhard 颜色迁移。</p>
            </div>

            <div class="space-y-2">
              <label class="text-xs text-slate-300 font-bold block">安装物（产品参考图）</label>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="py-2 rounded-lg border border-studio-700 text-xs font-bold cursor-pointer" @click="openInstallLibrary">从素材库选</button>
                <button type="button" class="py-2 rounded-lg border border-studio-700 text-xs font-bold cursor-pointer" @click="installFileInput?.click()">本地上传</button>
              </div>
              <input ref="installFileInput" type="file" accept="image/*" class="hidden" @change="onInstallFile" />
              <div v-if="installPreview" class="rounded-xl overflow-hidden border border-studio-700 bg-studio-950">
                <img :src="installPreview" alt="安装物预览" class="w-full h-36 object-contain" />
                <p class="px-2 py-1 text-xs text-slate-300 truncate">{{ installFileName || '已选择安装物' }}</p>
              </div>
              <p v-else class="text-xs text-slate-400">选一张产品照片。安装不用三维模型。</p>
            </div>

            <div>
              <label class="text-xs text-slate-300 font-bold block mb-1.5">细节保真策略：</label>
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="p in fidelityPolicies"
                  :key="p.key"
                  @click="activeFidelity = p.key"
                  :class="[
                    'p-2 rounded-lg border text-center transition-all cursor-pointer',
                    activeFidelity === p.key ? 'border-studio-accent bg-studio-accent/20 text-white font-bold' : 'border-studio-800 bg-studio-950 text-slate-400'
                  ]"
                >
                  <div class="font-bold text-xs">{{ p.label }}</div>
                  <div class="text-[10px] opacity-80">{{ p.desc }}</div>
                </button>
              </div>
            </div>
          </div>

          <!-- ==================== 3. 增加模式 (完整对齐要求！) ==================== -->
          <div v-else-if="selectedMode === 'add'" class="space-y-4">
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
              <span class="font-extrabold text-white block text-xs">增加模式：在指定区域增加新物品</span>
              <p class="text-[12px] text-slate-300 leading-relaxed">
                在原图指定区域放置新物件，支持 3D 模型朝向预览、留白间距控制与避让保护区约束。
              </p>
            </div>

            <!-- 新增物品描述 -->
            <div>
              <label class="text-xs text-slate-300 font-bold block mb-1.5">新增物品名称与描述：</label>
              <input v-model="addItemPrompt" placeholder="例如：现代北欧落地单人椅、龟背竹大盆栽" class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2 text-slate-200 outline-none text-xs font-medium" />
            </div>

            <!-- 留白间距控制滑块 (0% - 80%) -->
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1.5">
              <div class="flex justify-between text-xs font-medium">
                <span class="text-white font-bold">留白间距要求 (与周边物品距离):</span>
                <span class="text-studio-cyan font-mono font-bold">{{ addPaddingPercent }}%</span>
              </div>
              <input type="range" min="0" max="80" step="5" v-model.number="addPaddingPercent" class="w-full accent-studio-accent cursor-pointer" />
              <p class="text-[11px] text-slate-400">加大留白可防止新增物体过于拥挤或遮挡原有主通道。</p>
            </div>

            <!-- 避让区状态与控制 -->
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white">避让保护区约束 (第二个保护框):</span>
                <button
                  v-if="avoidBBox"
                  @click="avoidBBox = null"
                  class="text-[11px] text-rose-400 hover:underline cursor-pointer"
                >
                  清除避让区
                </button>
              </div>
              <p class="text-[11px] text-slate-400">
                {{ avoidBBox ? '已设置避让区：AI 生成时将严格避开此区域，逐像素保留原貌。' : '尚未设置避让区。可在画布顶部工具栏点击「标记避让保护区」在底图上拉框指定。' }}
              </p>
            </div>

            <!-- 3D 资产选型与自转 (涉及 SLB/GLB 模型朝向确认) -->
            <div class="space-y-3 p-3.5 rounded-2xl bg-studio-950 border border-studio-800 shadow-md">
              <div class="flex items-center justify-between">
                <span class="text-xs font-extrabold text-white">3D 模型朝向确认：</span>
                <span class="text-xs font-mono font-bold text-studio-cyan">{{ modelRotation }}°</span>
              </div>

              <div class="h-36 rounded-xl overflow-hidden bg-gradient-to-b from-slate-900 to-black border border-studio-700 relative shadow-inner">
                <model-viewer
                  ref="addModelViewerRef"
                  :src="selectedModelGlb"
                  alt="3D 新增物品"
                  shadow-intensity="1.0"
                  interaction-prompt="none"
                  :orientation="modelOrientation"
                  style="width: 100%; height: 100%; pointer-events: none;"
                ></model-viewer>
              </div>

              <div class="space-y-2">
                <div class="flex justify-between text-xs text-slate-300">
                  <span>左右</span>
                  <span class="font-mono text-studio-cyan font-bold">{{ modelRotation }}°</span>
                </div>
                <input type="range" min="0" max="360" v-model.number="modelRotation" class="w-full accent-studio-accent cursor-pointer" />
                <div class="flex justify-between text-xs text-slate-300">
                  <span>上下</span>
                  <span class="font-mono text-studio-cyan font-bold">{{ modelPitch }}°</span>
                </div>
                <input type="range" min="-45" max="45" v-model.number="modelPitch" class="w-full accent-studio-accent cursor-pointer" />
              </div>
            </div>
          </div>

          <!-- ==================== 4. 留白模式 ==================== -->
          <div v-else-if="selectedMode === 'gap'" class="space-y-3">
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
              <span class="font-extrabold text-white block text-xs">留白模式：拉开物品间隙</span>
              <p class="text-[12px] text-slate-300 leading-relaxed">框选两个物品中间的空隙，增大通透感与空间呼吸感。</p>
            </div>
            <div>
              <div class="flex justify-between text-xs mb-1">
                <span class="font-bold text-white">留白拉开像素宽度：</span>
                <span class="font-mono text-studio-cyan font-bold">{{ gapWidth }} px</span>
              </div>
              <input type="range" min="20" max="240" step="10" v-model.number="gapWidth" class="w-full accent-studio-accent cursor-pointer" />
            </div>
          </div>

          <!-- ==================== 5. 去除模式 ==================== -->
          <div v-else-if="selectedMode === 'remove'" class="space-y-3">
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
              <span class="font-extrabold text-white block text-xs">去除模式：杂物抹除与自然补齐</span>
              <p class="text-[12px] text-slate-300 leading-relaxed">框选需要删除的物体，AI 将抹除杂物并根据周边光影纹理自然补全背景。</p>
            </div>
            <label class="flex items-center space-x-2 text-slate-300 cursor-pointer pt-1">
              <input type="checkbox" v-model="removeEdgeFeather" class="rounded accent-studio-accent" />
              <span>开启边缘羽化自然过渡</span>
            </label>
          </div>

          <!-- ==================== 6. 扩图模式 (完全对齐 new-chat！) ==================== -->
          <div v-else-if="selectedMode === 'expand'" class="space-y-4">
            <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1">
              <span class="font-extrabold text-white block text-xs">即梦 AI 智能扩图 (拉远镜头)</span>
              <p class="text-[12px] text-slate-300 leading-relaxed">
                保持原图像素绝对不变，扩展视界与画幅。由火山即梦专用模型推理完成。
              </p>
            </div>

            <!-- 4 大方案选项卡 (等比 / 画幅 / 四边 / 画布) -->
            <div class="space-y-2">
              <label class="text-xs text-slate-300 font-bold block">扩图方案：</label>
              <div class="grid grid-cols-4 gap-1 p-1 bg-studio-950 rounded-xl border border-studio-800">
                <button
                  v-for="s in expandSchemes"
                  :key="s.key"
                  @click="activeExpandScheme = s.key"
                  :class="[
                    'py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer text-center',
                    activeExpandScheme === s.key ? 'bg-studio-accent text-white shadow-sm' : 'text-slate-400 hover:text-white'
                  ]"
                >
                  {{ s.label }}
                </button>
              </div>
            </div>

            <!-- 方案 1：等比扩展 -->
            <div v-if="activeExpandScheme === 'equal'" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2">
              <div class="flex justify-between text-xs font-medium">
                <span class="text-slate-300">四边等比外扩比例:</span>
                <span class="font-mono text-studio-cyan font-bold">{{ esEqualPct }}%</span>
              </div>
              <input type="range" min="5" max="100" step="5" v-model.number="esEqualPct" class="w-full accent-studio-accent cursor-pointer" />
              <p class="text-[11px] text-slate-400">原图居中，上下左右各延伸 {{ esEqualPct }}% 的像素。</p>
            </div>

            <!-- 方案 2：画幅扩展 -->
            <div v-else-if="activeExpandScheme === 'ratio'" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-3">
              <div>
                <label class="text-xs text-slate-300 font-bold block mb-1">目标画幅 (原图居中，缺哪边补哪边):</label>
                <select v-model="targetExpandRatio" class="w-full bg-studio-900 border border-studio-700 rounded-lg p-2 text-white font-mono font-bold text-xs outline-none">
                  <option value="16:9">16:9 宽幅全景 (推荐)</option>
                  <option value="21:9">21:9 电影超宽</option>
                  <option value="4:3">4:3 标准构图</option>
                  <option value="3:2">3:2 单反画幅</option>
                  <option value="1:1">1:1 正方形</option>
                  <option value="2:3">2:3 略长</option>
                  <option value="9:16">9:16 移动竖屏</option>
                </select>
              </div>

              <label class="flex items-center space-x-2 text-slate-300 cursor-pointer pt-1">
                <input type="checkbox" v-model="esChain2" class="rounded accent-studio-accent" />
                <span>分两步执行：先转画幅 → 再对结果等比外扩</span>
              </label>

              <div v-if="esChain2" class="space-y-1.5 pt-1 border-t border-studio-850">
                <div class="flex justify-between text-xs">
                  <span class="text-slate-400">第二步 · 等比外扩比例:</span>
                  <span class="font-mono text-studio-cyan font-bold">{{ esChainPct }}%</span>
                </div>
                <input type="range" min="5" max="80" step="5" v-model.number="esChainPct" class="w-full accent-studio-accent cursor-pointer" />
              </div>
            </div>

            <!-- 方案 3：四边扩展 -->
            <div v-else-if="activeExpandScheme === 'four'" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2.5">
              <span class="text-xs font-bold text-white block">四边独立扩展幅度：</span>
              <div class="space-y-1.5">
                <div class="flex justify-between text-xs text-slate-300"><span>向上:</span><span class="font-mono text-studio-cyan">{{ esTop }}%</span></div>
                <input type="range" min="0" max="100" step="5" v-model.number="esTop" class="w-full accent-studio-accent cursor-pointer" />
              </div>
              <div class="space-y-1.5">
                <div class="flex justify-between text-xs text-slate-300"><span>向下:</span><span class="font-mono text-studio-cyan">{{ esBottom }}%</span></div>
                <input type="range" min="0" max="100" step="5" v-model.number="esBottom" class="w-full accent-studio-accent cursor-pointer" />
              </div>
              <div class="space-y-1.5">
                <div class="flex justify-between text-xs text-slate-300"><span>向左:</span><span class="font-mono text-studio-cyan">{{ esLeft }}%</span></div>
                <input type="range" min="0" max="100" step="5" v-model.number="esLeft" class="w-full accent-studio-accent cursor-pointer" />
              </div>
              <div class="space-y-1.5">
                <div class="flex justify-between text-xs text-slate-300"><span>向右:</span><span class="font-mono text-studio-cyan">{{ esRight }}%</span></div>
                <input type="range" min="0" max="100" step="5" v-model.number="esRight" class="w-full accent-studio-accent cursor-pointer" />
              </div>
            </div>

            <!-- 方案 4：画布扩展 (自由拖动摆位) -->
            <div v-else-if="activeExpandScheme === 'canvas'" class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-3">
              <div class="flex items-center space-x-2">
                <div class="flex-1">
                  <label class="text-[11px] text-slate-400 block mb-0.5">宽 (px):</label>
                  <input type="number" v-model.number="esCw" class="w-full bg-studio-900 border border-studio-700 rounded-lg p-1.5 font-mono text-xs" />
                </div>
                <span class="text-slate-500 pt-4">×</span>
                <div class="flex-1">
                  <label class="text-[11px] text-slate-400 block mb-0.5">高 (px):</label>
                  <input type="number" v-model.number="esCh" class="w-full bg-studio-900 border border-studio-700 rounded-lg p-1.5 font-mono text-xs" />
                </div>
                <button @click="resetCanvasPos" class="px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 text-xs font-bold mt-4 cursor-pointer">
                  居中
                </button>
              </div>

              <!-- 快捷预设画幅比例 -->
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="p in ['16:9', '3:2', '4:3', '1:1', '2:3', '9:16']"
                  :key="p"
                  @click="applyCanvasPreset(p)"
                  class="py-1 rounded bg-studio-900 hover:bg-studio-800 border border-studio-750 text-xs font-mono font-bold text-slate-300 cursor-pointer"
                >
                  {{ p }}
                </button>
              </div>

              <!-- 交互式棋盘格小画布预览 (支持拖动摆位) -->
              <div class="space-y-1">
                <div class="flex justify-between text-[11px] text-slate-400">
                  <span>拖动调整原图在画布中位置:</span>
                  <span class="font-mono text-studio-cyan">X: {{ Math.round(canvasPos.x * 100) }}% | Y: {{ Math.round(canvasPos.y * 100) }}%</span>
                </div>
                <div
                  ref="expandMiniWrapRef"
                  class="relative w-full h-32 rounded-lg border-2 border-dashed border-studio-600 bg-studio-950 overflow-hidden cursor-move select-none"
                  @mousedown="onMiniCanvasMouseDown"
                >
                  <img
                    :src="currentImage"
                    class="absolute pointer-events-none rounded border border-white/80 shadow-md"
                    :style="{
                      width: '45%',
                      left: `${canvasPos.x * 100}%`,
                      top: `${canvasPos.y * 100}%`,
                      transform: 'translate(-50%, -50%)'
                    }"
                  />
                </div>
              </div>
            </div>

            <!-- 扩图提示词 -->
            <div>
              <label class="text-xs text-slate-300 font-bold block mb-1">扩图引导词 (选填，由即梦智能补全):</label>
              <textarea v-model="expandPrompt" rows="2" placeholder="例：延伸全景落地大窗、温润木地板与柔和自然采光..." class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2 text-slate-200 outline-none text-xs"></textarea>
            </div>
          </div>
        </div>
      </aside>

      <!-- 2.3 右侧配置抽屉：全局重绘增强 (彻底解耦二级单选模式) -->
      <aside v-else class="w-[430px] bg-studio-900 border-l border-studio-750 flex flex-col shrink-0 p-4 space-y-4 text-xs overflow-y-auto scrollbar-thin">
        <div
          class="rounded-xl border border-dashed border-studio-700 bg-studio-950 p-4 text-center cursor-pointer"
          @click="triggerLocalUpload"
          @dragover.prevent
          @drop.prevent="handleDropImage"
        >
          <p class="text-sm font-bold text-white">上传底图</p>
          <p class="mt-1 text-xs text-slate-300">拖到这里，或点击选择照片。已有底图时会换成新的一张。</p>
          <p v-if="baseFileName" class="mt-2 text-xs font-bold text-studio-cyan truncate">{{ baseFileName }}</p>
        </div>
        <div class="space-y-1 pb-3 border-b border-studio-800">
          <span class="font-extrabold text-white text-sm block">全局重绘增强模式选择</span>
          <p class="text-[12px] text-slate-400">选择您要执行的全局处理类型，界面将严格仅展示对应参数。</p>
        </div>

        <!-- 二级单选模式 -->
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="gm in globalModes"
            :key="gm.key"
            @click="activeGlobalMode = gm.key"
            :class="[
              'p-2.5 rounded-xl border text-center transition-all cursor-pointer',
              activeGlobalMode === gm.key ? 'border-studio-indigo bg-studio-indigo/25 text-white font-extrabold shadow-sm' : 'border-studio-800 bg-studio-950 text-slate-400 hover:text-white'
            ]"
          >
            <div class="text-base mb-0.5">{{ gm.icon }}</div>
            <div class="text-xs font-bold">{{ gm.label }}</div>
          </button>
        </div>

        <!-- 出图参数 (清晰度 / 画幅)：超分有自己的重建档位，不吃这一套 -->
        <div v-if="activeGlobalMode !== 'upscale' && outSchema" class="p-4 rounded-xl bg-studio-950 border border-studio-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-white">出图参数：</span>
            <span class="text-[10px] font-mono text-slate-400">{{ precisionModelKey }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <DynamicModelParamBar :schema="outSchema" v-model="outParams" v-model:showAdvanced="showOutAdvanced" />
          </div>
          <p v-if="outDiverging" class="text-[11px] leading-relaxed text-amber-300">
            画幅 {{ outParams.ratio }} 与底图 {{ imageNaturalSize.w }}×{{ imageNaturalSize.h }} 不符，将整幅重绘，框外像素不再逐像素保留。
          </p>
          <p v-else class="text-[11px] leading-relaxed text-slate-400">
            画幅默认取最接近底图 {{ imageNaturalSize.w }}×{{ imageNaturalSize.h }} 的一档，框外逐像素贴回。
          </p>
        </div>
        <p v-if="outEcho || lastRegionNote" class="space-y-1 px-1">
          <span v-if="outEcho" class="block text-[11px] font-mono leading-relaxed text-studio-cyan">{{ outEcho }}</span>
          <span v-if="lastRegionNote" class="block text-[11px] leading-relaxed text-amber-300">{{ lastRegionNote }}</span>
        </p>

        <!-- 整图光线控制 (风格/超分/去水印通用接续) -->
        <div class="p-4 rounded-xl bg-studio-950 border border-studio-800 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-bold text-white">整图光线控制：</span>
            <label class="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" v-model="globalLightKeep" class="rounded border-studio-700 bg-studio-900 text-studio-accent" />
              <span>保持原图光线</span>
            </label>
          </div>
          <div v-if="!globalLightKeep" class="space-y-3">
            <div>
              <span class="text-[11px] text-slate-400 block mb-1">主光来向（屏幕方向）：</span>
              <div class="grid grid-cols-5 gap-1 text-[10px]">
                <button
                  v-for="d in lightDirections"
                  :key="d.key"
                  type="button"
                  @click="globalLightDir = d.key"
                  :class="['py-1.5 rounded-lg border text-center transition cursor-pointer', globalLightDir === d.key ? 'bg-studio-accent border-studio-accent text-white font-bold' : 'border-studio-800 bg-studio-900 text-slate-400']"
                >
                  {{ d.label }}
                </button>
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                <span>色温微调：</span>
                <span class="font-mono text-studio-cyan font-bold">{{ globalKelvin }}K</span>
              </div>
              <input
                type="range"
                min="2700"
                max="6500"
                step="100"
                v-model.number="globalKelvin"
                class="w-full accent-studio-accent"
              />
              <div class="flex justify-between text-[9px] text-slate-500 font-mono mt-1">
                <span @click="globalKelvin = 2700" class="cursor-pointer hover:text-slate-300">2700K</span>
                <span @click="globalKelvin = 3000" class="cursor-pointer hover:text-slate-300">3000K</span>
                <span @click="globalKelvin = 4000" class="cursor-pointer hover:text-slate-300">4000K</span>
                <span @click="globalKelvin = 5000" class="cursor-pointer hover:text-slate-300">5000K</span>
                <span @click="globalKelvin = 6500" class="cursor-pointer hover:text-slate-300">6500K</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 模式 A：画质超分重建 -->
        <div v-if="activeGlobalMode === 'upscale'" class="p-4 rounded-xl bg-studio-950 border border-studio-800 space-y-3">
          <span class="font-bold text-white block">超分辨率重建档位：</span>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="u in ['2K', '4K', '8K']"
              :key="u"
              @click="upscaleTarget = u"
              :class="['py-2 rounded-lg border font-mono font-extrabold text-xs cursor-pointer', upscaleTarget === u ? 'bg-studio-accent border-studio-accent text-white' : 'border-studio-800 bg-studio-900 text-slate-400']"
            >
              {{ u }}
            </button>
          </div>
        </div>

        <!-- 模式 B：风格转换迁移 (严格使用打标系统 tags-seed.js 官方真实风格字典) -->
        <div v-else-if="activeGlobalMode === 'style'" class="p-4 rounded-xl bg-studio-950 border border-studio-800 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-bold text-white">风格库（官方 + 自定义）：</span>
            <span class="text-[11px] text-studio-indigo font-bold">16 种文化大类</span>
          </div>

          <div class="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto scrollbar-thin p-1">
            <button
              @click="pickNewCustomStyle"
              :class="[
                'p-2 rounded-lg border text-left text-xs transition-all cursor-pointer',
                isCustomStyleMode && !editingCustomStyleId ? 'border-studio-indigo bg-studio-indigo/20 text-white font-bold' : 'border-dashed border-studio-700 bg-studio-900 text-slate-300'
              ]"
            >
              <div class="font-bold">＋ 自定义风格</div>
              <div class="text-[10px] text-slate-400">AI 解析并沉淀为我的风格</div>
            </button>
            <button
              v-for="style in officialStyles"
              :key="style.key"
              @click="pickOfficialStyle(style)"
              :class="[
                'p-2 rounded-lg border text-left text-xs transition-all cursor-pointer',
                !isCustomStyleMode && selectedOfficialStyle === style.name ? 'border-studio-indigo bg-studio-indigo/20 text-white font-bold' : 'border-studio-800 bg-studio-900 text-slate-300'
              ]"
            >
              <div class="font-bold">{{ style.name }}</div>
              <div class="text-[10px] text-slate-400">{{ style.region }}</div>
            </button>
          </div>

          <!-- 自定义风格编辑器：AI 解析生图模型更吃透的风格锚定描述 -->
          <div v-if="isCustomStyleMode" class="p-3 rounded-xl bg-studio-900/70 border border-studio-indigo/40 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-white">自定义风格</span>
              <button v-if="editingCustomStyleId" @click="pickNewCustomStyle" class="text-[11px] text-slate-400 hover:text-white cursor-pointer">新建</button>
            </div>
            <input
              v-model="customStyleName"
              placeholder="风格名称，如：海边度假风"
              class="w-full px-2 py-1.5 rounded-lg bg-studio-950 border border-studio-800 text-xs text-white placeholder-slate-500 focus:border-studio-indigo outline-none"
            />
            <textarea
              v-model="customStyleDesc"
              rows="2"
              placeholder="可选：描述你想要的色彩、材质或氛围，AI 会补全成专业风格描述"
              class="w-full px-2 py-1.5 rounded-lg bg-studio-950 border border-studio-800 text-xs text-white placeholder-slate-500 focus:border-studio-indigo outline-none resize-none"
            ></textarea>
            <div class="flex gap-2">
              <button
                @click="analyzeCustomStyle"
                :disabled="customAnalyzing"
                class="flex-1 px-2 py-1.5 rounded-lg bg-studio-indigo text-white text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {{ customAnalyzing ? 'AI 解析中…' : 'AI 解析风格描述' }}
              </button>
              <button
                @click="saveCustomStyle"
                :disabled="customSaving"
                class="px-2 py-1.5 rounded-lg border border-studio-800 text-slate-200 text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {{ customSaving ? '保存中…' : (editingCustomStyleId ? '更新到我的风格' : '保存到我的风格') }}
              </button>
            </div>
            <div v-if="customAiPrompt" class="space-y-1">
              <div class="flex justify-between text-[11px]">
                <span class="text-slate-300">AI 风格锚定描述（可直接修改）</span>
                <span class="text-slate-500">{{ customAiPrompt.length }} 字</span>
              </div>
              <textarea
                v-model="customAiPrompt"
                rows="5"
                class="w-full px-2 py-1.5 rounded-lg bg-studio-950 border border-studio-800 text-xs text-white focus:border-studio-indigo outline-none resize-none"
              ></textarea>
            </div>
          </div>

          <!-- 我的风格：已保存的自定义风格 -->
          <div v-if="customStyles.length" class="space-y-1.5 pt-2 border-t border-studio-850">
            <span class="text-xs font-bold text-white">我的风格（{{ customStyles.length }}）</span>
            <div class="grid grid-cols-2 gap-2">
              <div v-for="cs in customStyles" :key="cs.id" class="relative">
                <button
                  @click="pickCustomStyle(cs)"
                  :class="[
                    'w-full p-2 pr-6 rounded-lg border text-left text-xs transition-all cursor-pointer',
                    isCustomStyleMode && editingCustomStyleId === cs.id ? 'border-studio-indigo bg-studio-indigo/20 text-white font-bold' : 'border-studio-800 bg-studio-900 text-slate-300'
                  ]"
                >
                  <div class="font-bold truncate">{{ cs.name }}</div>
                  <div class="text-[10px] text-slate-400 truncate">{{ cs.aiPrompt || cs.description || '未生成锚定描述' }}</div>
                </button>
                <button
                  @click.stop="removeCustomStyle(cs)"
                  class="absolute top-1 right-1 text-slate-500 hover:text-red-400 text-[11px] cursor-pointer"
                  title="删除"
                >✕</button>
              </div>
            </div>
          </div>

          <div class="space-y-1 pt-2 border-t border-studio-850">
            <div class="flex justify-between text-xs text-slate-300">
              <span>风格融合强度:</span>
              <span class="font-mono text-studio-indigo font-bold">{{ styleWeight }}%</span>
            </div>
            <input type="range" min="20" max="100" v-model.number="styleWeight" class="w-full accent-studio-indigo cursor-pointer" />
          </div>
        </div>

        <!-- 模式 C：智能去水印 -->
        <div v-else-if="activeGlobalMode === 'watermark'" class="p-4 rounded-xl bg-studio-950 border border-studio-800 space-y-3">
          <span class="font-bold text-white block">去水印参数配置：</span>
          <label class="flex items-center space-x-2 text-slate-300 cursor-pointer">
            <input type="checkbox" v-model="removeWatermark" class="rounded accent-studio-accent" />
            <span>自动定位边缘文字水印并消除</span>
          </label>
        </div>
      </aside>
    </div>

    <!-- 共享素材选择器（与 AI 对话同一组件） -->
    <AssetPickerModal
      :visible="showAssetModal"
      context="edit"
      :title="assetPickPurpose === 'install' ? '选择安装物' : '从素材库选取底图'"
      :max-select="1"
      :media-types="['image']"
      :recent="recentEditedAssets"
      @close="showAssetModal = false"
      @confirm="onPickerConfirm"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { bindOverlays } from '../../service/overlay-stack.js';
import StudioIcon from '../../components/StudioIcon.vue';
import BaseAttrPicker from '../../components/BaseAttrPicker.vue';
import BeforeAfterSlider from '../../components/BeforeAfterSlider.vue';
import AssetPickerModal from '../../components/AssetPickerModal.vue';
import DynamicModelParamBar from '../../components/DynamicModelParamBar.vue';
import {
  expandJimeng,
  runEditPipeline,
  registerGeneratedAsset,
  aiDetect,
  fetchStudioCatalog,
  fetchCustomStyles,
  createCustomStyle,
  updateCustomStyle,
  deleteCustomStyle,
  analyzeStyle
} from '../../api';
import { ensureModelViewer } from '../../utils/model-viewer.js';

// 冷导航修复：本组件模板含 <model-viewer>，挂载即确保自定义元素已注册，
// 不再依赖本会话先打开过 StudioEditLayer
onMounted(() => { ensureModelViewer(); });

const props = defineProps({
  initialImage: { type: String, default: '' },
  initialFid: { type: String, default: '' }
});

const studioMode = ref('precision'); // 'precision' | 'global'
const currentImage = ref(props.initialImage || '');
const currentAssetFid = ref(props.initialFid || '');
const resultImage = ref('');
const showCompare = ref(false);
const executing = ref(false);
const detecting = ref(false);
const showAssetModal = ref(false);
const assetPickPurpose = ref('base');
// 最近调整过的素材：置顶到共享选择器，方便快速回到上一张底图
const recentEditedAssets = ref([]);
const lastFiledResult = ref('');
const installPreview = ref('');
// installPreview 是字符串型 ref，关闭要回到空串而不是 null。
bindOverlays({
  assetPicker: showAssetModal,
  installPreview: { ref: installPreview, close: () => { installPreview.value = ''; } }
}, { prefix: 'quick-studio:' });
const installFileName = ref('');
const installFileInput = ref(null);
const imageNaturalSize = ref({ w: 0, h: 0 });

watch(() => props.initialImage, (newVal) => {
  if (newVal) {
    currentImage.value = newVal;
    resultImage.value = '';
    showCompare.value = false;
    rememberEditedAsset({ fid: props.initialFid || '', url: newVal, name: '当前底图', mark: '最近调整' });
  }
});

watch(() => props.initialFid, (newFid) => {
  if (newFid) currentAssetFid.value = newFid;
});

watch(resultImage, (url) => {
  if (!url || url === lastFiledResult.value || url === currentImage.value) return;
  lastFiledResult.value = url;
  const body = {
    parentFid: currentAssetFid.value || '',
    prompt: expandPrompt.value || '',
    model: 'quick',
    mode: studioMode.value === 'precision' ? selectedMode.value : activeGlobalMode.value,
    sessionId: ''
  };
  if (String(url).includes('/api/cache/temp/')) body.previewUrl = url;
  else if (String(url).startsWith('data:')) body.imageBase64 = url;
  else return;
  registerGeneratedAsset(body).catch((err) => console.warn('快捷成图写入精修失败', err));
});

function rememberEditedAsset(item) {
  if (!item || (!item.fid && !item.url)) return;
  const key = item.fid || item.url;
  const entry = {
    fid: item.fid || '',
    url: item.url,
    name: item.name || '素材底图',
    kind: 'image',
    mark: '最近调整',
  };
  recentEditedAssets.value = [entry, ...recentEditedAssets.value.filter((it) => (it.fid || it.url) !== key)].slice(0, 12);
}

// 共享素材选择器确认：支持原图与衍生图版本
function onPickerConfirm(versions) {
  const first = versions?.[0];
  if (!first) return;
  if (assetPickPurpose.value === 'install') {
    installPreview.value = first.url;
    installFileName.value = first.name;
    rememberEditedAsset({ ...first, mark: '最近安装' });
  } else {
    selectBaseImage(first);
    return;
  }
  showAssetModal.value = false;
}
function openInstallLibrary() {
  assetPickPurpose.value = 'install';
  showAssetModal.value = true;
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}
async function onInstallFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  // 后端 Node 进程无法读取浏览器 blob: 内存地址，必须转成 data URL
  try {
    installPreview.value = await fileToDataUrl(file);
  } catch (_) {
    installPreview.value = '';
  }
  installFileName.value = file.name;
}
function openAssetSelector() {
  assetPickPurpose.value = 'base';
  showAssetModal.value = true;
}

const localUploadInput = ref(null);
const baseFileName = ref('');

async function loadBaseFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  // 本地上传底图同样必须转 data URL，否则后端无法读取 blob:
  const url = await fileToDataUrl(file);
  currentImage.value = url;
  currentAssetFid.value = '';
  resultImage.value = '';
  showCompare.value = false;
  baseFileName.value = file.name;
  clearAnnotation();
}

function triggerLocalUpload() {
  localUploadInput.value?.click();
}

function onLocalUploadChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  loadBaseFile(file);
  e.target.value = '';
}

function handleDropImage(e) {
  const file = e.dataTransfer?.files?.[0];
  loadBaseFile(file);
}

function selectBaseImage(item) {
  currentImage.value = item.url;
  currentAssetFid.value = item.fid || '';
  resultImage.value = '';
  showCompare.value = false;
  // 底图名称带上所选版本，避免换了 3:4 衍生图后不知道形状为何变化
  baseFileName.value = item.derivativeKind && item.derivativeKind !== 'origin'
    ? `${item.name || '素材底图'}（${item.label || '衍生版本'}）`
    : (item.name || '');
  clearAnnotation();
  rememberEditedAsset({ ...item, mark: '最近调整' });
  showAssetModal.value = false;
}

// 画布缩放平移
const canvasScale = ref(1.0);
const canvasOffset = ref({ x: 0, y: 0 });
const viewportRef = ref(null);
const imageRef = ref(null);
let isPanning = false;
let panStart = { x: 0, y: 0 };

function onCanvasWheel(e) {
  const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
  canvasScale.value = Math.min(8.0, Math.max(0.5, canvasScale.value * zoomFactor));
}
function zoomCanvas(delta) {
  canvasScale.value = Math.min(8.0, Math.max(0.5, canvasScale.value + delta));
}
function resetCanvas() {
  canvasScale.value = 1.0;
  canvasOffset.value = { x: 0, y: 0 };
}

// 标注模式：拉框 (rect) vs 自由多边形 (polygon)
const annoTool = ref('rect');
const rectBBox = ref(null); // { x1, y1, x2, y2 }
const rectHandle = ref(null);
let draggingRectHandle = null;
const rectHandles = computed(() => {
  const b = rectBBox.value;
  if (!b) return [];
  return [
    { id: 'tl', x: b.x1, y: b.y1 },
    { id: 'tr', x: b.x2, y: b.y1 },
    { id: 'bl', x: b.x1, y: b.y2 },
    { id: 'br', x: b.x2, y: b.y2 }
  ];
});
function onRectHandleLeave() {
  if (!draggingRectHandle) rectHandle.value = null;
}
function endPointDrag() {
  draggingPointIdx = null;
  draggingRectHandle = null;
  window.removeEventListener('mouseup', endPointDrag);
}
function onRectHandleDown(id) {
  draggingRectHandle = id;
  rectHandle.value = id;
  window.addEventListener('mouseup', endPointDrag);
}
const avoidBBox = ref(null); // { x1, y1, x2, y2 } 避让区约束
const drawingAvoidMode = ref(false); // 是否当前正在绘制避让区

let isDrawingRect = false;

const polygonPoints = ref([]);
const isPolyClosed = ref(false);
const hoverPointIdx = ref(null);
const mouseCurrentPos = ref(null);
let draggingPointIdx = null;
let isDraggingPolygon = false;
let polyDragStart = { x: 0, y: 0 };
let pointDragMoved = false; // 顶点是否真的被拖动过（拖动后不再当作点击）
let pointDragStartClient = null;
let rightPressInfo = null; // 右键按下信息：抬起时几乎没位移 => 视为「撤销」

// 画布整体走 CSS transform 缩放，SVG 半径要按 1/scale 反算，屏幕上的大小才不会跟着缩成针尖
const uiScale = computed(() => 1 / Math.max(0.05, canvasScale.value || 1));
function uiPx(n) {
  return n * uiScale.value;
}
const ptHitRadius = computed(() => 16 * uiScale.value);
function ptRadius(idx) {
  return (hoverPointIdx.value === idx ? 9.5 : 7) * uiScale.value;
}

const polygonPointsStr = computed(() => polygonPoints.value.map(p => `${p.x},${p.y}`).join(' '));

const polygonSegments = computed(() => {
  const segs = [];
  const len = polygonPoints.value.length;
  for (let i = 0; i < len; i++) {
    const nextIdx = (i + 1) % len;
    if (isPolyClosed.value || i < len - 1) {
      segs.push({ p1: polygonPoints.value[i], p2: polygonPoints.value[nextIdx], idx1: i, idx2: nextIdx });
    }
  }
  return segs;
});

function onViewportMouseDown(e) {
  if (e.button === 2 || e.button === 1) {
    isPanning = true;
    panStart = { x: e.clientX - canvasOffset.value.x, y: e.clientY - canvasOffset.value.y };
    if (e.button === 2) {
      // 右键先按「平移」准备着：抬起时若几乎没动，就当成「撤销上一点」
      rightPressInfo = { x: e.clientX, y: e.clientY, moved: false };
      window.addEventListener('mouseup', finishPan);
    }
    return;
  }
  if (annoTool.value === 'rect') {
    const pt = getImageRelativePoint(e);
    if (!pt) return;
    isDrawingRect = true;
    if (drawingAvoidMode.value) {
      avoidBBox.value = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
    } else {
      rectBBox.value = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
    }
  }
}

function onViewportMouseMove(e) {
  if (draggingPointIdx !== null) {
    if (pointDragStartClient) {
      const d = Math.hypot(e.clientX - pointDragStartClient.x, e.clientY - pointDragStartClient.y);
      if (d > 3) pointDragMoved = true;
    }
    const pt = getImageRelativePoint(e);
    if (pt && polygonPoints.value[draggingPointIdx]) {
      polygonPoints.value[draggingPointIdx] = pt;
      if (!isPolyClosed.value) mouseCurrentPos.value = pt;
    }
    return;
  }
  if (draggingRectHandle && rectBBox.value) {
    const pt = getImageRelativePoint(e);
    if (!pt) return;
    const b = rectBBox.value;
    if (draggingRectHandle === 'tl' || draggingRectHandle === 'bl') b.x1 = pt.x;
    if (draggingRectHandle === 'tr' || draggingRectHandle === 'br') b.x2 = pt.x;
    if (draggingRectHandle === 'tl' || draggingRectHandle === 'tr') b.y1 = pt.y;
    if (draggingRectHandle === 'bl' || draggingRectHandle === 'br') b.y2 = pt.y;
    return;
  }
  if (isPanning) {
    canvasOffset.value = { x: e.clientX - panStart.x, y: e.clientY - panStart.y };
    if (rightPressInfo && !rightPressInfo.moved) {
      const d = Math.hypot(e.clientX - rightPressInfo.x, e.clientY - rightPressInfo.y);
      if (d > 4) rightPressInfo.moved = true;
    }
    return;
  }
  if (isDrawingRect) {
    const pt = getImageRelativePoint(e);
    if (!pt) return;
    if (drawingAvoidMode.value && avoidBBox.value) {
      avoidBBox.value.x2 = pt.x;
      avoidBBox.value.y2 = pt.y;
    } else if (rectBBox.value) {
      rectBBox.value.x2 = pt.x;
      rectBBox.value.y2 = pt.y;
    }
    return;
  }
  if (annoTool.value === 'polygon' && !isPolyClosed.value && polygonPoints.value.length > 0) {
    const pt = getImageRelativePoint(e);
    if (pt) mouseCurrentPos.value = pt;
  }
}

function onViewportMouseUp(e) {
  if (draggingPointIdx !== null || draggingRectHandle) {
    endPointDrag();
    return;
  }
  if (isPanning) {
    finishPan();
    return;
  }
  if (isDrawingRect) {
    isDrawingRect = false;
    if (drawingAvoidMode.value) {
      drawingAvoidMode.value = false;
    } else if (rectBBox.value) {
      const w = Math.abs(rectBBox.value.x2 - rectBBox.value.x1);
      const h = Math.abs(rectBBox.value.y2 - rectBBox.value.y1);
      if (w > 5 && h > 5 && imageNaturalSize.value.w > 0 && imageNaturalSize.value.h > 0) {
        const norm = {
          x: Math.min(rectBBox.value.x1, rectBBox.value.x2) / imageNaturalSize.value.w,
          y: Math.min(rectBBox.value.y1, rectBBox.value.y2) / imageNaturalSize.value.h,
          w: w / imageNaturalSize.value.w,
          h: h / imageNaturalSize.value.h
        };
        classifyQuickRegion({ type: 'rect', norm });
      }
    }
  }
}

// 结束平移；若这次是「右键单击」（位移没超过 4px），就执行一次撤销
function finishPan() {
  if (!isPanning) return;
  isPanning = false;
  window.removeEventListener('mouseup', finishPan);
  const info = rightPressInfo;
  rightPressInfo = null;
  if (info && !info.moved) undoPolygonStep();
}

function getImageRelativePoint(e) {
  if (!imageRef.value) return null;
  const rect = imageRef.value.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / canvasScale.value,
    y: (e.clientY - rect.top) / canvasScale.value
  };
}

function onSvgClick(e) {
  if (annoTool.value !== 'polygon' || isPolyClosed.value) return;
  // 双击的第二下（detail >= 2）不再落点，直接闭合，避免多出一个重复顶点
  if (e.detail >= 2) {
    closePolygon();
    return;
  }
  const pt = getImageRelativePoint(e);
  if (!pt) return;
  polygonPoints.value.push(pt);
  mouseCurrentPos.value = pt;
}

function closePolygon() {
  const pts = polygonPoints.value;
  if (pts.length < 3) return false;
  // 双击闭合时，双击的第一下会先落一个点；若它几乎压在上一个点上，就去掉这个重复顶点
  if (pts.length > 3) {
    const a = pts[pts.length - 1];
    const b = pts[pts.length - 2];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 4 * uiScale.value) pts.pop();
  }
  isPolyClosed.value = true;
  mouseCurrentPos.value = null;
  if (polygonPoints.value.length >= 3 && imageNaturalSize.value.w > 0) {
    const norm_points = polygonPoints.value.map(p => ({
      x: p.x / imageNaturalSize.value.w,
      y: p.y / imageNaturalSize.value.h
    }));
    classifyQuickRegion({ type: 'polygon', norm_points });
  }
  return true;
}

// 右键撤销：已闭合 -> 先取消闭合（保留全部顶点继续微调）；未闭合 -> 删掉最后一个落点
function undoPolygonStep() {
  if (annoTool.value !== 'polygon') return;
  if (isPolyClosed.value) {
    isPolyClosed.value = false;
    return;
  }
  if (!polygonPoints.value.length) return;
  polygonPoints.value.pop();
  mouseCurrentPos.value = null;
  if (polygonPoints.value.length < 3) isPolyClosed.value = false;
}

function onPointClick(idx) {
  if (pointDragMoved) return; // 刚拖过锚点，不当作点击闭合
  if (idx === 0 && polygonPoints.value.length > 2) closePolygon();
}

function onPointMouseDown(idx, e) {
  if (e && e.button !== 0) return; // 右键在锚点上是删除该点，不进入拖拽
  draggingPointIdx = idx;
  hoverPointIdx.value = idx;
  pointDragMoved = false;
  pointDragStartClient = { x: e.clientX, y: e.clientY };
  window.addEventListener('mouseup', endPointDrag);
}

function deletePoint(idx) {
  polygonPoints.value.splice(idx, 1);
  if (polygonPoints.value.length < 3) isPolyClosed.value = false;
  hoverPointIdx.value = null;
  draggingPointIdx = null;
}

function insertPointOnLine(idx, e) {
  const pt = getImageRelativePoint(e);
  if (pt) polygonPoints.value.splice(idx + 1, 0, pt);
}

function onPolygonMouseDown(e) {
  if (e && e.button !== 0) return; // 右键放行给视口：可能是平移，也可能是撤销
  e.stopPropagation();
  isDraggingPolygon = true;
  polyDragStart = getImageRelativePoint(e);
}

function clearAnnotation() {
  rectBBox.value = null;
  polygonPoints.value = [];
  isPolyClosed.value = false;
  mouseCurrentPos.value = null;
  avoidBBox.value = null;
}

async function detectAutoSegment() {
  if (!currentImage.value) {
    alert('请先选择底图');
    return;
  }
  detecting.value = true;
  try {
    const data = await aiDetect({ image: currentImage.value });
    const list = (Array.isArray(data?.detections) ? data.detections : [])
      .filter((d) => d && d.bbox)
      .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0));
    const best = list[0];
    if (!best) throw new Error('未检测到可编辑对象');
    rectBBox.value = {
      x1: Number(best.bbox.x1) || 0,
      y1: Number(best.bbox.y1) || 0,
      x2: Number(best.bbox.x2) || 0,
      y2: Number(best.bbox.y2) || 0
    };
  } catch (e) {
    alert('AI 自动识别失败: ' + e.message);
  } finally {
    detecting.value = false;
  }
}

function onImageLoaded(e) {
  if (e && e.target) {
    imageNaturalSize.value = {
      w: e.target.naturalWidth || 1200,
      h: e.target.naturalHeight || 800
    };
  }
  fitCanvasToViewport();
}

function fitCanvasToViewport() {
  if (!viewportRef.value || !imageNaturalSize.value.w) {
    canvasScale.value = 1.0;
    canvasOffset.value = { x: 0, y: 0 };
    return;
  }
  const vw = Math.max(300, viewportRef.value.clientWidth - 40);
  const vh = Math.max(300, viewportRef.value.clientHeight - 40);
  const nw = imageNaturalSize.value.w;
  const nh = imageNaturalSize.value.h;
  if (vw > 0 && vh > 0 && nw > 0 && nh > 0) {
    const scale = Math.min(vw / nw, vh / nh);
    canvasScale.value = Math.max(0.15, Math.min(4.0, Number(scale.toFixed(2))));
    canvasOffset.value = { x: 0, y: 0 };
  }
}

// 右键行为：单击 = 撤销上一步（见 finishPan -> undoPolygonStep），拖动 = 平移。
// 这里只负责把浏览器原生右键菜单挡掉，闭合改由「左键双击 / 点回首点」完成。
function onContextMenu() {
  /* 原生菜单已在模板上用 .prevent 屏蔽，保留空实现以免误触发闭合 */
}

// 6 大专业精准编辑模式
const editModes = [
  { key: 'replace', label: '替换模式', icon: '🛋️' },
  { key: 'install', label: '安装模式', icon: '🔌' },
  { key: 'add', label: '增加模式', icon: '➕' },
  { key: 'gap', label: '留白模式', icon: '↔️' },
  { key: 'remove', label: '去除模式', icon: '🧹' },
  { key: 'expand', label: '扩图模式', icon: '🖼️' }
];
const selectedMode = ref('replace');
const quickBaseAttr = ref({
  surface: 'wall',
  subclass: 'wall_paint',
  warehouse: 'paint',
  asset_id: null,
  use_shell: false
});
const inferredSurface = ref('');
const precisionModelKey = ref('seedream5flash');
const globalLightKeep = ref(true);
const globalLightDir = ref('top');
const globalKelvin = ref(4000);
const lightDirections = [
  { key: 'left', label: '画面左侧' },
  { key: 'upper_left', label: '左上' },
  { key: 'top', label: '正上' },
  { key: 'upper_right', label: '右上' },
  { key: 'right', label: '画面右侧' }
];

async function classifyQuickRegion(selection) {
  if (studioMode.value !== 'precision' || selectedMode.value === 'expand') return;
  if (!selection) return;
  const payload = {
    selection,
    asset_fid: currentAssetFid.value || null
  };
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
      inferredSurface.value = json.data.surface;
      if (!quickBaseAttr.value.subclass && !quickBaseAttr.value.asset_id) {
        quickBaseAttr.value.surface = json.data.surface;
      }
    }
  } catch (_) {}
}

// ==================== 出图参数（清晰度 / 画幅）====================
// 与对话生成同一套做法：档位、画幅、默认值全部来自 /studio/catalog 的模型契约，
// 页面不写死任何一档，选完直接把值发给 /edit/run，服务端再把真正生效的换算结果回显。
const studioSchemas = ref({});
const outParams = ref({});
const showOutAdvanced = ref(false);
const lastOutSize = ref(null);
const lastRegionNote = ref('');

// 编辑管线只吃这两项；组图、透明底这类契约参数在这里用不上，就不摆出来误导
const outSchema = computed(() => {
  const s = studioSchemas.value[precisionModelKey.value];
  if (!s) return null;
  const fields = (s.common || []).filter((f) => f.key === 'size' || f.key === 'ratio');
  if (!fields.length) return null;
  return { ...s, common: fields, advanced: [], modes: [], slots: null, free: null };
});
const ratioField = computed(() =>
  (outSchema.value?.common || []).find((f) => f.key === 'ratio') || null
);

/** 契约里最接近底图宽高比的一档；与服务端 handlers/edit-size 的判据一致 */
function nearestRatio(options, w, h) {
  const nums = (options || []).filter((o) => /^\d+:\d+$/.test(String(o)));
  if (!nums.length || !(w > 0 && h > 0)) return '';
  const target = w / h;
  let best = nums[0];
  let bestGap = Infinity;
  for (const r of nums) {
    const [a, b] = String(r).split(':').map(Number);
    const gap = Math.abs(Math.log(a / b / target));
    if (gap < bestGap) { bestGap = gap; best = r; }
  }
  return best;
}

function resetOutParams() {
  const s = outSchema.value;
  showOutAdvanced.value = false;
  if (!s) { outParams.value = {}; return; }
  const next = {};
  for (const f of s.common) next[f.key] = f.default;
  const near = nearestRatio(ratioField.value.options, imageNaturalSize.value.w, imageNaturalSize.value.h);
  if (next.ratio != null) next.ratio = near || next.ratio;
  outParams.value = next;
}

// 画幅一旦偏离底图，服务端只能整幅重绘，框外像素保不住 —— 出图前就讲明白
const outDiverging = computed(() => {
  const f = ratioField.value;
  const chosen = outParams.value.ratio;
  if (!f || !chosen || String(chosen) === 'auto') return false;
  const nearest = nearestRatio(f.options, imageNaturalSize.value.w, imageNaturalSize.value.h);
  return !!nearest && String(chosen) !== String(nearest);
});

const outEcho = computed(() => {
  const o = lastOutSize.value;
  if (!o) return '';
  const px = o.outW && o.outH ? `${o.outW}×${o.outH}` : '尺寸未知';
  return `实发 ${o.sizeField || '未传'} · 画幅 ${o.ratio || '未选'} · ${px} · ${o.pasteback ? '框外逐像素贴回' : '未贴回（整幅出图）'}`;
});

// 全局重绘共用同一条 /edit/run 管线。只有契约里确实有出图参数时才带上 model，
// 免得把「通用大模型」这类非生图 id 塞进图像管线改变原有行为。
const outParamFields = computed(() =>
  outSchema.value
    ? {
        model: precisionModelKey.value,
        size: outParams.value.size || undefined,
        ratio: outParams.value.ratio || undefined,
      }
    : {}
);

/** 服务端回传真正生效的出图参数与降级告知，页面只负责照实念出来 */
function readEditEcho(res) {
  const d = (res && (res.data || res)) || {};
  lastOutSize.value = d.outSize || null;
  lastRegionNote.value = d.regionNote || '';
}

watch(precisionModelKey, resetOutParams);
// 换底图就是换基准宽高比，画幅默认值必须跟着重挑，否则「跟随原图」成了一句空话
watch(() => `${imageNaturalSize.value.w}x${imageNaturalSize.value.h}`, () => {
  const f = ratioField.value;
  if (!f || !imageNaturalSize.value.w) return;
  const near = nearestRatio(f.options, imageNaturalSize.value.w, imageNaturalSize.value.h);
  if (near) outParams.value = { ...outParams.value, ratio: near };
});

onMounted(async () => {
  try {
    const catalog = await fetchStudioCatalog();
    studioSchemas.value = catalog.schemas || {};
  } catch (e) {
    console.warn('出图参数表读取失败:', e);
  }
  resetOutParams();
});

// 3D 资产与模型自转
const modelSources = [
  { key: 'builtin', label: '系统预置库' },
  { key: 'library', label: '素材库选取' },
  { key: 'upload', label: '本地GLB上传' }
];
const activeModelSource = ref('builtin');
const selectedModelGlb = ref('/models/sofa_electric_single.glb');
const uploadedModelName = ref('');
const modelRotation = ref(45);
const modelPitch = ref(0);
const modelOrientation = computed(() => `0deg ${modelPitch.value}deg ${modelRotation.value}deg`);
const modelFileInput = ref(null);

const modelViewerRef = ref(null);
const addModelViewerRef = ref(null);

function getModelNameCn(glbPath, uploadedName) {
  if (uploadedName) return uploadedName.replace(/\.[^.]+$/, '');
  const p = String(glbPath || '');
  if (p.includes('sofa_electric_single')) return '单人电动功能沙发';
  if (p.includes('sofa_model')) return '意式极简三人真皮沙发';
  if (p.includes('sofa_default')) return '北欧布艺双人沙发';
  if (p.includes('user_model')) return '现代人体工学单人椅';
  return '现代品质单品家具';
}

async function captureViewerSnapshot() {
  const viewer = (selectedMode.value === 'add' ? addModelViewerRef.value : modelViewerRef.value) || modelViewerRef.value || addModelViewerRef.value;
  if (!viewer || typeof viewer.toBlob !== 'function') return null;
  try {
    const blob = await viewer.toBlob({ mimeType: 'image/png', idealAspect: true });
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('[3D Snapshot] 捕获视角截图失败:', e);
    return null;
  }
}

function applyResultAsBase(newImg) {
  if (!newImg) return;
  currentImage.value = newImg;
  resultImage.value = '';
  showCompare.value = false;
  clearAnnotation();
}

function triggerModelUpload() {
  modelFileInput.value?.click();
}
function onModelUploaded(e) {
  const f = e.target.files?.[0];
  if (f) {
    uploadedModelName.value = f.name;
    selectedModelGlb.value = URL.createObjectURL(f);
  }
}

// 安装模式
const installItem = ref('switch_panel');
const fidelityPolicies = [
  { key: 'A', label: '策略 A', desc: '强贴合高保真' },
  { key: 'B', label: '策略 B', desc: '透视自适应' },
  { key: 'C', label: '策略 C', desc: '智能环境融合' }
];
const activeFidelity = ref('A');

// 增加模式专属参数
const addItemPrompt = ref('');
const addPaddingPercent = ref(30);

// 留白与去除
const gapWidth = ref(80);
const removeEdgeFeather = ref(true);

// 扩图模式 (4大方案完整对齐 new-chat！)
const expandSchemes = [
  { key: 'equal', label: '等比扩展' },
  { key: 'ratio', label: '画幅扩展' },
  { key: 'four', label: '四边扩展' },
  { key: 'canvas', label: '画布扩展' }
];
const activeExpandScheme = ref('ratio');

// 等比扩展
const esEqualPct = ref(25);

// 画幅扩展与可视化画布参数
const targetExpandRatio = ref('16:9');
const esChain2 = ref(false);
const esChainPct = ref(25);

// 扩图工作台交互参数 (原图占比与定位)
const expandCanvasContainerRef = ref(null);
const expandImageScale = ref(65); // 原图在目标画布中的占比 (35% ~ 95%)
const expandImagePos = ref({ x: 0.5, y: 0.5 }); // 原图中心在目标画布中的归一化位置 (0.0 ~ 1.0)
let isDraggingExpandImage = false;
let expandDragStart = { clientX: 0, clientY: 0, initialX: 0.5, initialY: 0.5 };

const targetRatioValues = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1.0,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '21:9': 21 / 9,
  '3:2': 3 / 2,
  '2:3': 2 / 3
};

const targetDimensions = computed(() => {
  const r = targetExpandRatio.value;
  if (r === '16:9') return { w: 1920, h: 1080 };
  if (r === '9:16') return { w: 1080, h: 1920 };
  if (r === '1:1') return { w: 1200, h: 1200 };
  if (r === '4:3') return { w: 1600, h: 1200 };
  if (r === '3:4') return { w: 1200, h: 1600 };
  if (r === '21:9') return { w: 2560, h: 1080 };
  if (r === '3:2') return { w: 1800, h: 1200 };
  if (r === '2:3') return { w: 1200, h: 1800 };
  return { w: 1920, h: 1080 };
});

const expandCanvasContainerStyle = computed(() => {
  const ratio = targetRatioValues[targetExpandRatio.value] || 16 / 9;
  let w = 780;
  let h = w / ratio;
  if (h > 520) {
    h = 520;
    w = h * ratio;
  }
  return {
    width: `${Math.round(w)}px`,
    height: `${Math.round(h)}px`
  };
});

const expandImageStyle = computed(() => {
  const scale = expandImageScale.value / 100;
  return {
    width: `${Math.round(scale * 100)}%`,
    height: `${Math.round(scale * 100)}%`,
    left: `${Math.round(expandImagePos.value.x * 100)}%`,
    top: `${Math.round(expandImagePos.value.y * 100)}%`,
    transform: 'translate(-50%, -50%)'
  };
});

const expandMargins = computed(() => {
  const scale = expandImageScale.value / 100;
  const cx = expandImagePos.value.x;
  const cy = expandImagePos.value.y;
  const leftMargin = Math.max(0, cx - scale / 2);
  const rightMargin = Math.max(0, 1 - (cx + scale / 2));
  const topMargin = Math.max(0, cy - scale / 2);
  const bottomMargin = Math.max(0, 1 - (cy + scale / 2));
  return {
    top: topMargin,
    bottom: bottomMargin,
    left: leftMargin,
    right: rightMargin
  };
});

function setExpandTargetRatio(r) {
  targetExpandRatio.value = r;
}

function alignExpandImage(align) {
  const scale = expandImageScale.value / 100;
  const half = scale / 2;
  if (align === 'center') {
    expandImagePos.value = { x: 0.5, y: 0.5 };
  } else if (align === 'left') {
    expandImagePos.value = { x: half + 0.02, y: 0.5 };
  } else if (align === 'right') {
    expandImagePos.value = { x: 1 - half - 0.02, y: 0.5 };
  } else if (align === 'top') {
    expandImagePos.value = { x: 0.5, y: half + 0.02 };
  } else if (align === 'bottom') {
    expandImagePos.value = { x: 0.5, y: 1 - half - 0.02 };
  }
}

function onExpandImageMouseDown(e) {
  isDraggingExpandImage = true;
  expandDragStart = {
    clientX: e.clientX,
    clientY: e.clientY,
    initialX: expandImagePos.value.x,
    initialY: expandImagePos.value.y
  };
  const onMouseMove = (ev) => {
    if (!isDraggingExpandImage || !expandCanvasContainerRef.value) return;
    const rect = expandCanvasContainerRef.value.getBoundingClientRect();
    const dx = (ev.clientX - expandDragStart.clientX) / rect.width;
    const dy = (ev.clientY - expandDragStart.clientY) / rect.height;
    const scale = expandImageScale.value / 100;
    const half = scale / 2;
    const newX = Math.max(half, Math.min(1 - half, expandDragStart.initialX + dx));
    const newY = Math.max(half, Math.min(1 - half, expandDragStart.initialY + dy));
    expandImagePos.value = { x: newX, y: newY };
  };
  const onMouseUp = () => {
    isDraggingExpandImage = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

// 四边扩展
const esTop = ref(0);
const esBottom = ref(0);
const esLeft = ref(20);
const esRight = ref(20);

// 画布扩展
const esCw = ref(1920);
const esCh = ref(1080);
const canvasPos = ref({ x: 0.5, y: 0.5 });
const expandMiniWrapRef = ref(null);
let isMiniDragging = false;

function resetCanvasPos() {
  canvasPos.value = { x: 0.5, y: 0.5 };
}

function applyCanvasPreset(ratioStr) {
  if (ratioStr === '16:9') { esCw.value = 1920; esCh.value = 1080; }
  else if (ratioStr === '3:2') { esCw.value = 1800; esCh.value = 1200; }
  else if (ratioStr === '4:3') { esCw.value = 1600; esCh.value = 1200; }
  else if (ratioStr === '1:1') { esCw.value = 1200; esCh.value = 1200; }
  else if (ratioStr === '2:3') { esCw.value = 1200; esCh.value = 1800; }
  else if (ratioStr === '9:16') { esCw.value = 1080; esCh.value = 1920; }
}

function onMiniCanvasMouseDown(e) {
  isMiniDragging = true;
  updateMiniPos(e);
  const onMove = (ev) => {
    if (isMiniDragging) updateMiniPos(ev);
  };
  const onUp = () => {
    isMiniDragging = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function updateMiniPos(e) {
  if (!expandMiniWrapRef.value) return;
  const rect = expandMiniWrapRef.value.getBoundingClientRect();
  const nx = Math.max(0.1, Math.min(0.9, (e.clientX - rect.left) / rect.width));
  const ny = Math.max(0.1, Math.min(0.9, (e.clientY - rect.top) / rect.height));
  canvasPos.value = { x: nx, y: ny };
}

const expandPrompt = ref('向外延伸室内全景落地窗与自然光影');

// 全局重绘二级单选模式
const globalModes = [
  { key: 'upscale', label: '超分重建', icon: '💎' },
  { key: 'style', label: '风格迁移', icon: '🎨' },
  { key: 'watermark', label: '智能去水印', icon: '✨' }
];
const activeGlobalMode = ref('style');
const upscaleTarget = ref('4K');
const styleWeight = ref(80);
const removeWatermark = ref(true);

const officialStyles = [
  { key: 'wabi_sabi', name: '侘寂风', region: '东亚美学' },
  { key: 'song_aesthetic', name: '宋式美学', region: '东亚美学' },
  { key: 'neo_chinese', name: '新中式', region: '东亚美学' },
  { key: 'classical_chinese', name: '古典中式', region: '东亚美学' },
  { key: 'french', name: '法式', region: '欧洲' },
  { key: 'italian', name: '意式极简', region: '欧洲' },
  { key: 'tuscan', name: '托斯卡纳', region: '欧洲' },
  { key: 'mediterranean', name: '地中海', region: '欧洲' },
  { key: 'modern_minimal', name: '现代极简', region: '现代流派' },
  { key: 'cream_style', name: '奶油风', region: '现代流派' },
  { key: 'industrial', name: '工业风', region: '现代流派' },
  { key: 'mid_century', name: '中古风 (MCM)', region: '现代流派' },
  { key: 'american_modern', name: '现代美式', region: '美洲' },
  { key: 'american_country', name: '美式乡村', region: '美洲' },
  { key: 'nanyang_resort', name: '南洋度假', region: '东南亚' },
  { key: 'natural_wood', name: '自然原木风', region: '木系风格' },
  { key: 'dark_wood', name: '深色原木风', region: '木系风格' },
  { key: 'natural_vintage_wood', name: '自然复古原木风', region: '木系风格' },
  { key: 'dark_vintage_wood', name: '深色复古原木风', region: '木系风格' }
];
const selectedOfficialStyle = ref('意式极简');

// ===== 自定义风格（风格迁移）：LLM 解析成生图模型更吃透的风格锚定描述 =====
const customStyles = ref([]);
const isCustomStyleMode = ref(false);
const editingCustomStyleId = ref('');
const customStyleName = ref('');
const customStyleDesc = ref('');
const customAiPrompt = ref('');
const customAnalyzing = ref(false);
const customSaving = ref(false);

function pickOfficialStyle(style) {
  isCustomStyleMode.value = false;
  editingCustomStyleId.value = '';
  selectedOfficialStyle.value = style.name;
}

function pickNewCustomStyle() {
  isCustomStyleMode.value = true;
  editingCustomStyleId.value = '';
  customStyleName.value = '';
  customStyleDesc.value = '';
  customAiPrompt.value = '';
}

function pickCustomStyle(style) {
  isCustomStyleMode.value = true;
  editingCustomStyleId.value = style.id;
  customStyleName.value = style.name || '';
  customStyleDesc.value = style.description || '';
  customAiPrompt.value = style.aiPrompt || '';
}

async function loadCustomStyles() {
  try {
    customStyles.value = await fetchCustomStyles();
  } catch (e) {
    console.warn('[QuickStudio] 自定义风格列表加载失败:', e.message);
  }
}

async function analyzeCustomStyle() {
  const name = customStyleName.value.trim();
  if (!name) { alert('请先填写风格名称'); return; }
  customAnalyzing.value = true;
  try {
    const data = await analyzeStyle({ name, description: customStyleDesc.value.trim() });
    customAiPrompt.value = data.aiPrompt || '';
    if (!customAiPrompt.value) alert('AI 未返回风格描述，可重试，或直接用自由描述执行');
  } catch (e) {
    alert('AI 风格解析失败: ' + e.message);
  } finally {
    customAnalyzing.value = false;
  }
}

async function saveCustomStyle() {
  const name = customStyleName.value.trim();
  if (!name) { alert('请先填写风格名称'); return; }
  customSaving.value = true;
  try {
    const payload = {
      name,
      description: customStyleDesc.value.trim(),
      aiPrompt: customAiPrompt.value.trim()
    };
    const saved = editingCustomStyleId.value
      ? await updateCustomStyle(editingCustomStyleId.value, payload)
      : await createCustomStyle(payload);
    await loadCustomStyles();
    if (saved) pickCustomStyle(saved);
  } catch (e) {
    alert('自定义风格保存失败: ' + e.message);
  } finally {
    customSaving.value = false;
  }
}

async function removeCustomStyle(style) {
  if (!window.confirm(`删除自定义风格「${style.name}」？`)) return;
  try {
    await deleteCustomStyle(style.id);
    if (editingCustomStyleId.value === style.id) pickNewCustomStyle();
    await loadCustomStyles();
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

onMounted(loadCustomStyles);

// 执行生图处理 (真实打通火山即梦扩图与服务端 /edit/run 管线)
async function runExecute() {
  if (!currentImage.value) return;
  executing.value = true;
  // 上一次运行的回显不能留下来冒充这次的，扩图走的是另一条通道尤其容易看串
  lastOutSize.value = null;
  lastRegionNote.value = '';
  try {
    if (studioMode.value === 'precision' && selectedMode.value === 'expand') {
      // 扩图模式：对接真实即梦扩图 API (传递精确外扩比例与引导词)
      const payload = {
        image_url: currentImage.value,
        assetFid: currentAssetFid.value || undefined,
        prompt: expandPrompt.value,
        ratio: targetExpandRatio.value,
        top: Number(expandMargins.value.top.toFixed(3)),
        bottom: Number(expandMargins.value.bottom.toFixed(3)),
        left: Number(expandMargins.value.left.toFixed(3)),
        right: Number(expandMargins.value.right.toFixed(3))
      };

      const res = await expandJimeng(payload);
      const outUrl = res.url || res.image_url || (res.b64 ? `data:image/png;base64,${res.b64}` : '') || res.b64_json;
      if (outUrl) {
        resultImage.value = outUrl;
      } else {
        resultImage.value = currentImage.value;
      }
    } else if (studioMode.value === 'global') {
      // 全局重绘增强模式：调用服务端真实 /edit/run 管线！
      if (activeGlobalMode.value === 'style') {
        const useCustom = isCustomStyleMode.value;
        const customName = customStyleName.value.trim();
        if (useCustom && !customName) throw new Error('请先填写自定义风格名称');
        const res = await runEditPipeline({
          image: currentImage.value,
          assetFid: currentAssetFid.value || undefined,
          op: 'style_transfer',
          targetStyle: useCustom ? customName : selectedOfficialStyle.value,
          // 优先用 LLM 解析后的风格锚定描述；未解析则退回用户的自由描述
          stylePrompt: useCustom ? (customAiPrompt.value.trim() || customStyleDesc.value.trim() || undefined) : undefined,
          strengthLevel: styleWeight.value > 70 ? 'strong' : (styleWeight.value > 40 ? 'standard' : 'subtle'),
          extraPrompt: expandPrompt.value || undefined,
          ...outParamFields.value
        });
        readEditEcho(res);
        if (res.data?.image?.b64) {
          resultImage.value = `data:image/jpeg;base64,${res.data.image.b64}`;
        } else if (res.image?.b64) {
          resultImage.value = `data:image/jpeg;base64,${res.image.b64}`;
        }
      } else if (activeGlobalMode.value === 'upscale') {
        const res = await runEditPipeline({
          image: currentImage.value,
          assetFid: currentAssetFid.value || undefined,
          op: 'clarity',
          targetClarity: upscaleTarget.value
        });
        readEditEcho(res);
        if (res.data?.image?.b64) {
          resultImage.value = `data:image/jpeg;base64,${res.data.image.b64}`;
        }
      } else if (activeGlobalMode.value === 'watermark') {
        const res = await runEditPipeline({
          image: currentImage.value,
          assetFid: currentAssetFid.value || undefined,
          op: 'remove',
          removeWatermark: true,
          ...outParamFields.value
        });
        readEditEcho(res);
        if (res.data?.image?.b64) {
          resultImage.value = `data:image/jpeg;base64,${res.data.image.b64}`;
        }
      }
    } else {
      // 精准局部编辑模式：调用服务端 /edit/run 真实管线 (6大专业模式完整对接)
      let regionPayload = null;
      if (annoTool.value === 'rect' && rectBBox.value) {
        regionPayload = {
          bbox: {
            x1: Math.min(rectBBox.value.x1, rectBBox.value.x2),
            y1: Math.min(rectBBox.value.y1, rectBBox.value.y2),
            x2: Math.max(rectBBox.value.x1, rectBBox.value.x2),
            y2: Math.max(rectBBox.value.y1, rectBBox.value.y2)
          }
        };
      } else if (annoTool.value === 'polygon' && polygonPoints.value.length >= 3) {
        regionPayload = {
          points: polygonPoints.value
        };
      }

      // 选区校验：除扩图外，其余精准模式必须提供选区
      if (!regionPayload) {
        throw new Error('请先在左侧底图上使用【拉框标注】或【自由多边形】标定目标区域');
      }

      // 捕获当前 3D 模型视角渲染截图（作为图2参考图）
      let refImage = null;
      if (['replace', 'add'].includes(selectedMode.value)) {
        refImage = await captureViewerSnapshot();
      }

      // 避让区约束 (如果用户绘制了避让保护区)
      let avoidPayload = null;
      if (avoidBBox.value) {
        avoidPayload = {
          x1: Math.min(avoidBBox.value.x1, avoidBBox.value.x2),
          y1: Math.min(avoidBBox.value.y1, avoidBBox.value.y2),
          x2: Math.max(avoidBBox.value.x1, avoidBBox.value.x2),
          y2: Math.max(avoidBBox.value.y1, avoidBBox.value.y2)
        };
      }

      // 模式名称与后端操作对齐 (install -> insert, gap -> space)
      const opMapping = {
        replace: 'replace',
        install: 'insert',
        add: 'add',
        gap: 'space',
        remove: 'remove',
      };
      let targetOp = opMapping[selectedMode.value] || selectedMode.value;
      let bindingsPayload = null;
      if (quickBaseAttr.value && (quickBaseAttr.value.asset_id || quickBaseAttr.value.assetId || quickBaseAttr.value.hex || quickBaseAttr.value.colorHex || quickBaseAttr.value.subclass === 'millwork_carcass')) {
        targetOp = 'base_attr';
        const p = quickBaseAttr.value.part || quickBaseAttr.value.surface || inferredSurface.value || 'wall';
        let bbox = null;
        if (regionPayload && [regionPayload.x1, regionPayload.y1, regionPayload.x2, regionPayload.y2].every(n => Number.isFinite(Number(n)))) {
          bbox = {
            x1: Math.round(Number(regionPayload.x1)),
            y1: Math.round(Number(regionPayload.y1)),
            x2: Math.round(Number(regionPayload.x2)),
            y2: Math.round(Number(regionPayload.y2))
          };
        }
        bindingsPayload = {
          regions: [{
            region_id: 'qs_reg_' + Date.now(),
            bbox,
            part: p,
            surface: p,
            mode: quickBaseAttr.value.mode || (quickBaseAttr.value.track === 'B' ? 'rematerial' : 'recolor'),
            track: quickBaseAttr.value.track || (quickBaseAttr.value.assetId || quickBaseAttr.value.asset_id ? 'B' : 'A'),
            subclass: quickBaseAttr.value.subclass || '',
            warehouse: quickBaseAttr.value.warehouse || (quickBaseAttr.value.track === 'B' ? 'material' : 'paint'),
            asset_id: quickBaseAttr.value.assetId || quickBaseAttr.value.asset_id || null,
            hex: quickBaseAttr.value.hex || quickBaseAttr.value.colorHex || null,
            color_name: quickBaseAttr.value.displayName || quickBaseAttr.value.colorName || null,
            process: quickBaseAttr.value.process || null,
            finish: quickBaseAttr.value.gloss || quickBaseAttr.value.finish || null,
            roughness: quickBaseAttr.value.roughness ?? null
          }],
          light_mode: null
        };
      }

      let resolvedProductName = '';
      if (selectedMode.value === 'add') {
        resolvedProductName = addItemPrompt.value?.trim() || getModelNameCn(selectedModelGlb.value, uploadedModelName.value);
      } else if (selectedMode.value === 'replace') {
        resolvedProductName = getModelNameCn(selectedModelGlb.value, uploadedModelName.value);
      } else if (selectedMode.value === 'install') {
        resolvedProductName = installFileName.value || '软装/开关面板单品';
      }

      const res = await runEditPipeline({
        image: currentImage.value,
        assetFid: currentAssetFid.value || undefined,
        op: targetOp,
        region: regionPayload,
        bindings: bindingsPayload,
        refImage: targetOp === 'base_attr' ? undefined : (refImage || undefined),
        productImage: selectedMode.value === 'install' ? installPreview.value : undefined,
        fidelity: selectedMode.value === 'install' ? activeFidelity.value : undefined,
        productName: resolvedProductName,
        modelYaw: modelRotation.value,
        modelPitch: modelPitch.value,
        model: precisionModelKey.value || undefined,
        size: outParams.value.size || undefined,
        ratio: outParams.value.ratio || undefined,
        prompt: selectedMode.value === 'add' ? (addItemPrompt.value || undefined) : undefined,
        avoidBBox: avoidPayload,
        gapPct: selectedMode.value === 'add' ? (addPaddingPercent.value || 30) : (gapWidth.value || 0),
      });
      readEditEcho(res);

      const b64 = res.data?.image?.b64 || res.image?.b64;
      const imgUrl = res.data?.image?.url || res.image?.url || res.url;
      if (b64) {
        resultImage.value = `data:image/jpeg;base64,${b64}`;
      } else if (imgUrl) {
        resultImage.value = imgUrl;
      } else {
        throw new Error('编辑服务未返回有效图片结果');
      }
    }
    showCompare.value = true;
  } catch (e) {
    alert('处理失败: ' + e.message);
  } finally {
    executing.value = false;
  }
}
</script>
