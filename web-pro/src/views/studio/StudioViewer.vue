<template>
  <div
    class="studio-viewer relative flex-1 min-h-[380px] bg-studio-950 p-4 flex flex-col select-none overflow-hidden transition-colors"
    :class="{ 'ring-2 ring-studio-accent bg-studio-900/60': isDragging }"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDropFiles"
  >
    <!-- 拖拽高亮遮罩 -->
    <div
      v-if="isDragging"
      class="absolute inset-0 z-30 bg-studio-accent/20 backdrop-blur-xs border-2 border-dashed border-studio-accent rounded-2xl m-3 flex flex-col items-center justify-center pointer-events-none"
    >
      <StudioIcon name="wand" :size="32" class="text-white animate-bounce mb-2" />
      <span class="text-sm font-bold text-white">松开鼠标，直接挂载为新参考图</span>
    </div>

    <!-- 顶部辅助栏：画廊视图状态与收缩切换 -->
    <div class="h-8 flex items-center justify-between shrink-0 mb-3 text-xs text-slate-400">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[11px] font-bold text-slate-300">
          视图 {{ images.length ? `${selectedIndex + 1} / ${images.length}` : '0 / 0' }}
        </span>
        <span v-if="images.length > 0" class="text-slate-500">· 完整无裁切</span>
      </div>

      <div class="flex items-center gap-3">
        <!-- 按这些图给建议入口 -->
        <button
          v-if="images.length > 0"
          type="button"
          @click="$emit('suggest-prompts')"
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-studio-850 transition-all font-medium cursor-pointer"
        >
          <StudioIcon name="wand" :size="14" hoverMorph />
          <span>按这些图给建议</span>
        </button>

        <!-- 收缩按钮 -->
        <button
          type="button"
          @click="$emit('toggle-collapse')"
          class="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-studio-850 transition-all font-medium cursor-pointer"
          title="收缩看图区，展开更多对话记录"
        >
          <StudioIcon name="minimize" :size="14" />
          <span>收缩</span>
        </button>
      </div>
    </div>

    <!-- 空状态：仅有一句提示，支持点击唤起添加，也支持拖拽 -->
    <div
      v-if="images.length === 0"
      @click="$emit('open-picker')"
      class="flex-1 flex flex-col items-center justify-center rounded-2xl border border-dashed border-studio-700/80 hover:border-studio-accent bg-studio-900/40 hover:bg-studio-900/60 text-slate-400 hover:text-white transition-all cursor-pointer group"
    >
      <StudioIcon name="plus" :size="24" customClass="text-slate-500 group-hover:text-studio-accent transition-colors mb-2" />
      <span class="text-sm font-semibold tracking-wide">添加参考图</span>
      <span class="text-[11px] text-slate-500 mt-1">支持点击选择，或直接从桌面拖拽图片至此处</span>
    </div>

    <!-- 1 张图布局：居中尽量大，不裁切 -->
    <div
      v-else-if="images.length === 1"
      class="flex-1 min-h-0 flex items-center justify-center"
    >
      <div
        @click="$emit('select', 0)"
        :class="[
          'relative flex flex-col h-full max-w-full rounded-2xl border p-3 transition-all cursor-pointer bg-studio-850',
          selectedIndex === 0 ? 'border-studio-accent ring-1 ring-studio-accent' : 'border-studio-700 hover:border-studio-600'
        ]"
      >
        <div
          @click.stop="onImageClick(0)"
          class="group/img relative flex-1 min-h-0 flex items-center justify-center overflow-hidden rounded-xl bg-studio-950/60 cursor-pointer"
          title="点击大图直接进入图片编辑"
        >
          <div
            class="relative max-w-full max-h-full flex items-center justify-center select-none"
            :style="getImageContainerStyle(0)"
          >
            <img
              :src="images[0].url || images[0].imgUrl"
              class="w-full h-full object-contain block transition-transform duration-200 group-hover/img:scale-[1.01]"
              :alt="`图1`"
              @load="onImgLoad($event, 0)"
            />

            <!-- 多边形矢量图层 (SVG) -->
            <svg
              v-if="hasSvgAnnotations(images[0]) && isRegionsVisible(0)"
              class="absolute inset-0 w-full h-full pointer-events-none z-20"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <defs>
                <marker
                  id="viewer-arrow-head-0"
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
              <polygon
                v-for="reg in (images[0]?.regions || []).filter(r => r.type === 'polygon' && (r.pctPoints?.length >= 3 || r.normPoints?.length >= 3 || r.points?.length >= 3))"
                :key="'poly-' + reg.id"
                :points="getViewerPolygonPointsAttr(reg, images[0])"
                :fill="getViewerPolygonFill(reg)"
                :stroke="reg.color?.border || '#3B82F6'"
                :stroke-width="hoveredRegionKey === `0_${reg.id}` ? '3' : '2'"
                stroke-linejoin="round"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
                class="pointer-events-auto cursor-pointer transition-all"
                @click.stop="onRegionClick(0, reg)"
                @mouseenter="$emit('region-hover', `0_${reg.id}`)"
                @mouseleave="$emit('region-hover', null)"
              />
              <line
                v-for="(ann, aIdx) in getArrowAnnotations(images[0])"
                :key="'arr-' + aIdx"
                :x1="ann.normX1 * 100"
                :y1="ann.normY1 * 100"
                :x2="ann.normX2 * 100"
                :y2="ann.normY2 * 100"
                stroke="#EF4444"
                stroke-width="3"
                marker-end="url(#viewer-arrow-head-0)"
                vector-effect="non-scaling-stroke"
              />
            </svg>

            <!-- 选区视觉画框与 3D 置入层 -->
            <div
              v-if="((images[0]?.regions && images[0].regions.length > 0) || (images[0]?.annotations && images[0].annotations.length > 0)) && isRegionsVisible(0)"
              class="absolute inset-0 pointer-events-none overflow-hidden"
            >
              
              <!-- 文本与马赛克标绘 -->
              <template v-if="images[0]?.annotations">
                <div
                  v-for="(ann, aIdx) in getTextAnnotations(images[0])"
                  :key="'txt-' + aIdx"
                  class="absolute px-1.5 py-0.5 rounded bg-rose-600 border border-white/60 text-white font-bold text-[10px] shadow-lg pointer-events-none whitespace-nowrap z-30"
                  :style="{
                    left: `${ann.normX * 100}%`,
                    top: `${ann.normY * 100}%`,
                    transform: 'translate(-4px, -50%)',
                  }"
                >
                  {{ ann.text }}
                </div>
                <div
                  v-for="(ann, aIdx) in getMosaicAnnotations(images[0])"
                  :key="'mos-' + aIdx"
                  class="absolute pointer-events-none border border-dashed border-rose-500 rounded z-20 overflow-hidden"
                  :style="{
                    left: `${ann.normX * 100}%`,
                    top: `${ann.normY * 100}%`,
                    width: `${ann.normW * 100}%`,
                    height: `${ann.normH * 100}%`,
                    backdropFilter: 'blur(8px) contrast(1.2)',
                    backgroundColor: 'rgba(160, 160, 160, 0.25)',
                  }"
                ></div>
              </template>
              <div
                v-for="reg in (images[0].regions || [])"
                :key="reg.id"
                class="absolute pointer-events-auto cursor-pointer transition-all rounded select-none"
                :style="getRegionOverlayStyle(reg, 0)"
                @click.stop="onRegionClick(0, reg)"
                @mouseenter="$emit('region-hover', `0_${reg.id}`)"
                @mouseleave="$emit('region-hover', null)"
              >
                <!-- 选区标签 -->
                <div
                  class="absolute -top-5 left-0 px-2 py-0.5 rounded font-mono font-bold text-[9px] shadow flex items-center gap-1 whitespace-nowrap z-30 pointer-events-none"
                  :class="reg.color?.badgeClass || 'bg-blue-500 text-white'"
                >
                  <span>{{ reg.name }}</span>
                  <span class="opacity-80">({{ getOpName(reg.op) }}{{ reg.op === 'recolor' && (reg.params?.materialName || reg.params?.colorName) ? ': ' + (reg.params.materialName || reg.params.colorName) : '' }})</span>
                </div>

                <!-- 3D 替换/增加：支持透明背景或浅色遮底渲染 -->
                <div
                  v-if="['replace', 'add'].includes(reg.op) && reg.params?.snapshotUrl"
                  class="w-full h-full flex items-center justify-center overflow-hidden rounded p-0.5"
                  :class="reg.params?.transparentBg !== false ? 'bg-transparent' : 'bg-[#F8FAFC]'"
                  :style="getPolygonClipPathStyle(reg, images[0])"
                >
                  <img
                    :src="reg.params.snapshotUrl"
                    class="w-full h-full object-contain pointer-events-none drop-shadow"
                    alt="3D家具"
                  />
                </div>

                <!-- 基础属性：智能平铺材质贴图与色彩预览 -->
                <div
                  v-else-if="reg.op === 'recolor' && (reg.params?.materialTextureUrl || reg.params?.colorHex)"
                  class="w-full h-full rounded overflow-hidden relative flex items-center justify-center pointer-events-none"
                  :style="{ backgroundColor: reg.params.colorHex ? hexToRgba(reg.params.colorHex, 0.4) : 'rgba(59, 130, 246, 0.2)', ...getPolygonClipPathStyle(reg) }"
                >
                  <img
                    v-if="reg.params?.materialTextureUrl"
                    :src="reg.params.materialTextureUrl"
                    class="w-full h-full object-cover mix-blend-multiply opacity-80"
                    alt="材质贴图"
                  />
                  <div class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur text-[8px] text-white font-mono flex items-center gap-1 shadow">
                    <span class="w-1.5 h-1.5 rounded-full border border-white/30" :style="{ backgroundColor: reg.params.colorHex || '#CBD5E1' }"></span>
                    <span class="truncate max-w-[80px]">{{ reg.params.materialName || reg.params.colorName || '基础属性' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-all flex items-center justify-center pointer-events-none opacity-0 group-hover/img:opacity-100">
            <span class="px-2.5 py-1 rounded-lg bg-studio-950/85 border border-studio-700 text-white text-xs font-bold flex items-center gap-1.5 backdrop-blur shadow-xl">
              <StudioIcon name="edit" :size="13" />
              <span>点击编辑</span>
            </span>
          </div>
        </div>

        <!-- 底部信息行：图号 + 文件名 + 操作图标 -->
        <div class="mt-2.5 flex items-center justify-between shrink-0 px-1">
          <div class="flex items-center gap-2 min-w-0">
            <span class="px-2 py-0.5 rounded bg-studio-cyan/15 text-studio-cyan font-mono text-xs font-bold shrink-0">
              图1
            </span>
            <span class="text-xs font-mono text-slate-400 truncate max-w-[280px]">
              {{ images[0].name || images[0].filename || 'ARCH_REFERENCE_01' }}
            </span>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <!-- 选区遮罩显隐按钮 -->
            <button
              v-if="images[0]?.regions && images[0].regions.length > 0"
              type="button"
              @click.stop="toggleRegionsVisibility(0)"
              class="px-2 py-0.5 rounded border text-[10px] font-bold cursor-pointer flex items-center gap-1 shrink-0 transition-colors"
              :class="isRegionsVisible(0) ? 'bg-studio-accent/20 border-studio-accent/50 text-studio-cyan' : 'bg-studio-800 text-slate-400 border-studio-700'"
              :title="isRegionsVisible(0) ? '隐藏此图选区遮罩' : '显示此图选区遮罩'"
            >
              <StudioIcon name="layers" :size="11" />
              <span>{{ isRegionsVisible(0) ? `选区(${images[0].regions.length})` : '选区(隐)' }}</span>
            </button>

            <button
              v-if="images[0]?.annotated || images[0]?.outpainted"
              type="button"
              @click.stop="$emit('revert-annotation', 0)"
              class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold hover:bg-rose-500/30 cursor-pointer flex items-center gap-1 shrink-0"
              :title="images[0]?.outpainted ? '撤回扩图，恢复未扩图原图' : '撤回标注，恢复未标记原图'"
            >
              <StudioIcon name="undo" :size="11" />
              <span>{{ images[0]?.outpainted ? '已扩图(撤回)' : '已标注(撤回)' }}</span>
            </button>
            <button
              type="button"
              @click.stop="$emit('open-edit', 0)"
              class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-studio-800 transition-colors cursor-pointer"
              title="编辑/标注"
            >
              <StudioIcon name="edit" :size="15" hoverMorph />
            </button>
            <button
              type="button"
              @click.stop="$emit('remove', 0)"
              class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-studio-800 transition-colors cursor-pointer"
              title="删除"
            >
              <StudioIcon name="trash" :size="15" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 2 张图布局：判断一竖一横或同向 -->
    <div
      v-else-if="images.length === 2"
      class="flex-1 min-h-0 flex items-stretch gap-4"
    >
      <div
        v-for="(img, idx) in images"
        :key="img.url || idx"
        @click="$emit('select', idx)"
        :class="[
          'relative flex flex-col h-full rounded-2xl border p-3 transition-all cursor-pointer bg-studio-850',
          isSubRefImage(img, idx)
            ? 'w-[340px] max-w-[380px] shrink-0'
            : (images.length === 2 && isSubRefImage(images[1], 1) ? 'flex-1 min-w-[480px]' : (aspectDiff2.verticalIdx === idx ? 'w-[32%] min-w-[240px] max-w-[380px]' : 'flex-1 min-w-0')),
          getSubRefBorderClass(img, idx)
        ]"
      >
        <div
          @click.stop="onImageClick(idx)"
          class="group/img relative flex-1 min-h-0 flex items-center justify-center overflow-hidden rounded-xl bg-studio-950/60 cursor-pointer"
          title="点击大图直接进入图片编辑"
        >
          <div
            class="relative max-w-full max-h-full flex items-center justify-center select-none"
            :style="getImageContainerStyle(idx)"
          >
            <img
              :src="img.url || img.imgUrl"
              class="w-full h-full object-contain block transition-transform duration-200 group-hover/img:scale-[1.01]"
              :alt="`图${idx + 1}`"
              @load="onImgLoad($event, idx)"
            />

            <!-- 多边形矢量图层 (SVG) -->
            <svg
              v-if="hasSvgAnnotations(img) && isRegionsVisible(idx)"
              class="absolute inset-0 w-full h-full pointer-events-none z-20"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <defs>
                <marker
                  :id="'viewer-arrow-head-' + idx"
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
              <polygon
                v-for="reg in (img?.regions || []).filter(r => r.type === 'polygon' && (r.pctPoints?.length >= 3 || r.normPoints?.length >= 3 || r.points?.length >= 3))"
                :key="'poly-' + reg.id"
                :points="getViewerPolygonPointsAttr(reg, img)"
                :fill="getViewerPolygonFill(reg)"
                :stroke="reg.color?.border || '#3B82F6'"
                :stroke-width="hoveredRegionKey === `${idx}_${reg.id}` ? '3' : '2'"
                stroke-linejoin="round"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
                class="pointer-events-auto cursor-pointer transition-all"
                @click.stop="onRegionClick(idx, reg)"
                @mouseenter="$emit('region-hover', `${idx}_${reg.id}`)"
                @mouseleave="$emit('region-hover', null)"
              />
              <line
                v-for="(ann, aIdx) in getArrowAnnotations(img)"
                :key="'arr-' + aIdx"
                :x1="ann.normX1 * 100"
                :y1="ann.normY1 * 100"
                :x2="ann.normX2 * 100"
                :y2="ann.normY2 * 100"
                stroke="#EF4444"
                stroke-width="3"
                :marker-end="'url(#viewer-arrow-head-' + idx + ')'"
                vector-effect="non-scaling-stroke"
              />
            </svg>

            <!-- 选区视觉画框与 3D 置入层 -->
            <div
              v-if="((img?.regions && img.regions.length > 0) || (img?.annotations && img.annotations.length > 0)) && isRegionsVisible(idx)"
              class="absolute inset-0 pointer-events-none overflow-hidden"
            >
              
              <!-- 文本与马赛克标绘 -->
              <template v-if="img?.annotations">
                <div
                  v-for="(ann, aIdx) in getTextAnnotations(img)"
                  :key="'txt-' + aIdx"
                  class="absolute px-1.5 py-0.5 rounded bg-rose-600 border border-white/60 text-white font-bold text-[10px] shadow-lg pointer-events-none whitespace-nowrap z-30"
                  :style="{
                    left: `${ann.normX * 100}%`,
                    top: `${ann.normY * 100}%`,
                    transform: 'translate(-4px, -50%)',
                  }"
                >
                  {{ ann.text }}
                </div>
                <div
                  v-for="(ann, aIdx) in getMosaicAnnotations(img)"
                  :key="'mos-' + aIdx"
                  class="absolute pointer-events-none border border-dashed border-rose-500 rounded z-20 overflow-hidden"
                  :style="{
                    left: `${ann.normX * 100}%`,
                    top: `${ann.normY * 100}%`,
                    width: `${ann.normW * 100}%`,
                    height: `${ann.normH * 100}%`,
                    backdropFilter: 'blur(8px) contrast(1.2)',
                    backgroundColor: 'rgba(160, 160, 160, 0.25)',
                  }"
                ></div>
              </template>
              <div
                v-for="reg in (img.regions || [])"
                :key="reg.id"
                class="absolute pointer-events-auto cursor-pointer transition-all rounded select-none"
                :style="getRegionOverlayStyle(reg, idx)"
                @click.stop="onRegionClick(idx, reg)"
                @mouseenter="$emit('region-hover', `${idx}_${reg.id}`)"
                @mouseleave="$emit('region-hover', null)"
              >
                <div
                  class="absolute -top-5 left-0 px-2 py-0.5 rounded font-mono font-bold text-[9px] shadow flex items-center gap-1 whitespace-nowrap z-30 pointer-events-none"
                  :class="reg.color?.badgeClass || 'bg-blue-500 text-white'"
                >
                  <span>{{ reg.name }}</span>
                  <span class="opacity-80">({{ getOpName(reg.op) }}{{ reg.op === 'recolor' && (reg.params?.materialName || reg.params?.colorName) ? ': ' + (reg.params.materialName || reg.params.colorName) : '' }})</span>
                </div>

                <div
                  v-if="['replace', 'add'].includes(reg.op) && reg.params?.snapshotUrl"
                  class="w-full h-full flex items-center justify-center overflow-hidden rounded p-0.5"
                  :class="reg.params?.transparentBg !== false ? 'bg-transparent' : 'bg-[#F8FAFC]'"
                  :style="getPolygonClipPathStyle(reg, img)"
                >
                  <img :src="reg.params.snapshotUrl" class="w-full h-full object-contain pointer-events-none drop-shadow" alt="" />
                </div>

                <!-- 基础属性：智能平铺材质贴图与色彩预览 -->
                <div
                  v-else-if="reg.op === 'recolor' && (reg.params?.materialTextureUrl || reg.params?.colorHex)"
                  class="w-full h-full rounded overflow-hidden relative flex items-center justify-center pointer-events-none"
                  :style="{ backgroundColor: reg.params.colorHex ? hexToRgba(reg.params.colorHex, 0.4) : 'rgba(59, 130, 246, 0.2)', ...getPolygonClipPathStyle(reg) }"
                >
                  <img
                    v-if="reg.params?.materialTextureUrl"
                    :src="reg.params.materialTextureUrl"
                    class="w-full h-full object-cover mix-blend-multiply opacity-80"
                    alt="材质贴图"
                  />
                  <div class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur text-[8px] text-white font-mono flex items-center gap-1 shadow">
                    <span class="w-1.5 h-1.5 rounded-full border border-white/30" :style="{ backgroundColor: reg.params.colorHex || '#CBD5E1' }"></span>
                    <span class="truncate max-w-[80px]">{{ reg.params.materialName || reg.params.colorName || '基础属性' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-all flex items-center justify-center pointer-events-none opacity-0 group-hover/img:opacity-100">
            <span class="px-2.5 py-1 rounded-lg bg-studio-950/85 border border-studio-700 text-white text-xs font-bold flex items-center gap-1.5 backdrop-blur shadow-xl">
              <StudioIcon name="edit" :size="13" />
              <span>点击编辑</span>
            </span>
          </div>
        </div>

        <div class="mt-2.5 flex items-center justify-between shrink-0 px-1">
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="px-2 py-0.5 rounded font-mono text-xs font-bold transition-all"
              :class="isSubRefImage(img, idx) ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40' : 'bg-studio-cyan/15 text-studio-cyan'"
            >{{ getSubRefLabel(img, idx) }}</span>
            <span class="text-xs font-mono text-slate-400 truncate">{{ img.name || `ARCH_REF_0${idx+1}` }}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              v-if="img?.regions && img.regions.length > 0"
              type="button"
              @click.stop="toggleRegionsVisibility(idx)"
              class="px-2 py-0.5 rounded border text-[10px] font-bold cursor-pointer flex items-center gap-1 shrink-0 transition-colors"
              :class="isRegionsVisible(idx) ? 'bg-studio-accent/20 border-studio-accent/50 text-studio-cyan' : 'bg-studio-800 text-slate-400 border-studio-700'"
              :title="isRegionsVisible(idx) ? '隐藏此图选区遮罩' : '显示此图选区遮罩'"
            >
              <StudioIcon name="layers" :size="11" />
              <span>{{ isRegionsVisible(idx) ? `选区(${img.regions.length})` : '选区(隐)' }}</span>
            </button>
            <button
              v-if="img?.annotated || img?.outpainted"
              type="button"
              @click.stop="$emit('revert-annotation', idx)"
              class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold hover:bg-rose-500/30 cursor-pointer flex items-center gap-1 shrink-0"
              :title="img?.outpainted ? '撤回扩图' : '撤回标注'"
            >
              <StudioIcon name="undo" :size="11" />
              <span>{{ img?.outpainted ? '已扩图(撤回)' : '已标注(撤回)' }}</span>
            </button>
            <button v-if="!isSubRefImage(img, idx)" @click.stop="$emit('open-edit', idx)" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-studio-800 cursor-pointer" title="进入主图编辑"><StudioIcon name="edit" :size="15" hoverMorph /></button>
            <button v-else @click.stop="onImageClick(idx)" class="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold cursor-pointer flex items-center gap-1" title="调整或替换 3D 模型"><StudioIcon name="wand" :size="12" /><span>替换模型</span></button>
            <button @click.stop="$emit('remove', idx)" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-studio-800 cursor-pointer"><StudioIcon name="trash" :size="15" /></button>
          </div>
        </div>
      </div>
    </div>

    <!-- 3 张图布局：自适应纵横排 -->
    <div
      v-else-if="images.length === 3"
      class="flex-1 min-h-0 flex items-stretch gap-4"
    >
      <div
        v-for="(img, idx) in images"
        :key="img.url || idx"
        @click="$emit('select', idx)"
        :class="[
          'relative flex-1 min-w-0 flex flex-col h-full rounded-2xl border p-3 transition-all cursor-pointer bg-studio-850',
          selectedIndex === idx ? 'border-studio-accent ring-1 ring-studio-accent' : 'border-studio-700 hover:border-studio-600'
        ]"
      >
        <div
          @click.stop="onImageClick(idx)"
          class="group/img relative flex-1 min-h-0 flex items-center justify-center overflow-hidden rounded-xl bg-studio-950/60 cursor-pointer"
          title="点击大图直接进入图片编辑"
        >
          <div
            class="relative max-w-full max-h-full flex items-center justify-center select-none"
            :style="getImageContainerStyle(idx)"
          >
            <img
              :src="img.url || img.imgUrl"
              class="w-full h-full object-contain block transition-transform duration-200 group-hover/img:scale-[1.01]"
              :alt="`图${idx + 1}`"
              @load="onImgLoad($event, idx)"
            />
            <!-- 多边形矢量图层 (SVG) -->
            <svg
              v-if="hasSvgAnnotations(img) && isRegionsVisible(idx)"
              class="absolute inset-0 w-full h-full pointer-events-none z-20"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <defs>
                <marker
                  :id="'viewer-arrow-head-' + idx"
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
              <polygon
                v-for="reg in (img?.regions || []).filter(r => r.type === 'polygon' && (r.pctPoints?.length >= 3 || r.normPoints?.length >= 3 || r.points?.length >= 3))"
                :key="'poly-' + reg.id"
                :points="getViewerPolygonPointsAttr(reg, img)"
                :fill="getViewerPolygonFill(reg)"
                :stroke="reg.color?.border || '#3B82F6'"
                :stroke-width="hoveredRegionKey === `${idx}_${reg.id}` ? '3' : '2'"
                stroke-linejoin="round"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
                class="pointer-events-auto cursor-pointer transition-all"
                @click.stop="onRegionClick(idx, reg)"
                @mouseenter="$emit('region-hover', `${idx}_${reg.id}`)"
                @mouseleave="$emit('region-hover', null)"
              />
              <line
                v-for="(ann, aIdx) in getArrowAnnotations(img)"
                :key="'arr-' + aIdx"
                :x1="ann.normX1 * 100"
                :y1="ann.normY1 * 100"
                :x2="ann.normX2 * 100"
                :y2="ann.normY2 * 100"
                stroke="#EF4444"
                stroke-width="3"
                :marker-end="'url(#viewer-arrow-head-' + idx + ')'"
                vector-effect="non-scaling-stroke"
              />
            </svg>

            <!-- 选区视觉画框与 3D 置入层 -->
            <div
              v-if="((img?.regions && img.regions.length > 0) || (img?.annotations && img.annotations.length > 0)) && isRegionsVisible(idx)"
              class="absolute inset-0 pointer-events-none overflow-hidden"
            >
              
              <!-- 文本与马赛克标绘 -->
              <template v-if="img?.annotations">
                <div
                  v-for="(ann, aIdx) in getTextAnnotations(img)"
                  :key="'txt-' + aIdx"
                  class="absolute px-1.5 py-0.5 rounded bg-rose-600 border border-white/60 text-white font-bold text-[10px] shadow-lg pointer-events-none whitespace-nowrap z-30"
                  :style="{
                    left: `${ann.normX * 100}%`,
                    top: `${ann.normY * 100}%`,
                    transform: 'translate(-4px, -50%)',
                  }"
                >
                  {{ ann.text }}
                </div>
                <div
                  v-for="(ann, aIdx) in getMosaicAnnotations(img)"
                  :key="'mos-' + aIdx"
                  class="absolute pointer-events-none border border-dashed border-rose-500 rounded z-20 overflow-hidden"
                  :style="{
                    left: `${ann.normX * 100}%`,
                    top: `${ann.normY * 100}%`,
                    width: `${ann.normW * 100}%`,
                    height: `${ann.normH * 100}%`,
                    backdropFilter: 'blur(8px) contrast(1.2)',
                    backgroundColor: 'rgba(160, 160, 160, 0.25)',
                  }"
                ></div>
              </template>
              <div
                v-for="reg in (img.regions || [])"
                :key="reg.id"
                class="absolute pointer-events-auto cursor-pointer transition-all rounded select-none"
                :style="getRegionOverlayStyle(reg, idx)"
                @click.stop="onRegionClick(idx, reg)"
                @mouseenter="$emit('region-hover', `${idx}_${reg.id}`)"
                @mouseleave="$emit('region-hover', null)"
              >
                <div
                  class="absolute -top-5 left-0 px-2 py-0.5 rounded font-mono font-bold text-[9px] shadow flex items-center gap-1 whitespace-nowrap z-30 pointer-events-none"
                  :class="reg.color?.badgeClass || 'bg-blue-500 text-white'"
                >
                  <span>{{ reg.name }}</span>
                  <span class="opacity-80">({{ getOpName(reg.op) }}{{ reg.op === 'recolor' && (reg.params?.materialName || reg.params?.colorName) ? ': ' + (reg.params.materialName || reg.params.colorName) : '' }})</span>
                </div>
                <div
                  v-if="['replace', 'add'].includes(reg.op) && reg.params?.snapshotUrl"
                  class="w-full h-full flex items-center justify-center overflow-hidden rounded p-0.5"
                  :class="reg.params?.transparentBg !== false ? 'bg-transparent' : 'bg-[#F8FAFC]'"
                  :style="getPolygonClipPathStyle(reg, img)"
                >
                  <img :src="reg.params.snapshotUrl" class="w-full h-full object-contain pointer-events-none drop-shadow" alt="" />
                </div>
                <!-- 基础属性：智能平铺材质贴图与色彩预览 -->
                <div
                  v-else-if="reg.op === 'recolor' && (reg.params?.materialTextureUrl || reg.params?.colorHex)"
                  class="w-full h-full rounded overflow-hidden relative flex items-center justify-center pointer-events-none"
                  :style="{ backgroundColor: reg.params.colorHex ? hexToRgba(reg.params.colorHex, 0.4) : 'rgba(59, 130, 246, 0.2)', ...getPolygonClipPathStyle(reg) }"
                >
                  <img
                    v-if="reg.params?.materialTextureUrl"
                    :src="reg.params.materialTextureUrl"
                    class="w-full h-full object-cover mix-blend-multiply opacity-80"
                    alt="材质贴图"
                  />
                  <div class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur text-[8px] text-white font-mono flex items-center gap-1 shadow">
                    <span class="w-1.5 h-1.5 rounded-full border border-white/30" :style="{ backgroundColor: reg.params.colorHex || '#CBD5E1' }"></span>
                    <span class="truncate max-w-[80px]">{{ reg.params.materialName || reg.params.colorName || '基础属性' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-all flex items-center justify-center pointer-events-none opacity-0 group-hover/img:opacity-100">
            <span class="px-2.5 py-1 rounded-lg bg-studio-950/85 border border-studio-700 text-white text-xs font-bold flex items-center gap-1.5 backdrop-blur shadow-xl">
              <StudioIcon name="edit" :size="13" />
              <span>点击编辑</span>
            </span>
          </div>
        </div>

        <div class="mt-2.5 flex items-center justify-between shrink-0 px-1">
          <div class="flex items-center gap-2 min-w-0">
            <span class="px-2 py-0.5 rounded bg-studio-cyan/15 text-studio-cyan font-mono text-xs font-bold">图{{ idx + 1 }}</span>
            <span class="text-xs font-mono text-slate-400 truncate">{{ img.name || `ARCH_REF_0${idx+1}` }}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              v-if="img?.regions && img.regions.length > 0"
              type="button"
              @click.stop="toggleRegionsVisibility(idx)"
              class="px-2 py-0.5 rounded border text-[10px] font-bold cursor-pointer flex items-center gap-1 shrink-0 transition-colors"
              :class="isRegionsVisible(idx) ? 'bg-studio-accent/20 border-studio-accent/50 text-studio-cyan' : 'bg-studio-800 text-slate-400 border-studio-700'"
              :title="isRegionsVisible(idx) ? '隐藏此图选区遮罩' : '显示此图选区遮罩'"
            >
              <StudioIcon name="layers" :size="11" />
              <span>{{ isRegionsVisible(idx) ? `选区(${img.regions.length})` : '选区(隐)' }}</span>
            </button>
            <button @click.stop="$emit('open-edit', idx)" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-studio-800 cursor-pointer"><StudioIcon name="edit" :size="15" hoverMorph /></button>
            <button @click.stop="$emit('remove', idx)" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-studio-800 cursor-pointer"><StudioIcon name="trash" :size="15" /></button>
          </div>
        </div>
      </div>
    </div>

    <!-- 4 张及以上：横向自适应滚动 -->
    <div
      v-else
      class="flex-1 min-h-0 overflow-x-auto overflow-y-hidden scrollbar-thin flex items-stretch gap-4 pb-2"
    >
      <div
        v-for="(img, idx) in images"
        :key="img.url || idx"
        @click="$emit('select', idx)"
        :class="[
          'relative flex flex-col w-[300px] shrink-0 h-full rounded-2xl border p-3 transition-all cursor-pointer bg-studio-850',
          selectedIndex === idx ? 'border-studio-accent ring-1 ring-studio-accent' : 'border-studio-700 hover:border-studio-600'
        ]"
      >
        <div
          @click.stop="onImageClick(idx)"
          class="group/img relative flex-1 min-h-0 flex items-center justify-center overflow-hidden rounded-xl bg-studio-950/60 cursor-pointer"
          title="点击大图直接进入图片编辑"
        >
          <div
            class="relative max-w-full max-h-full flex items-center justify-center select-none"
            :style="getImageContainerStyle(idx)"
          >
            <img
              :src="img.url || img.imgUrl"
              class="w-full h-full object-contain block transition-transform duration-200 group-hover/img:scale-[1.01]"
              :alt="`图${idx + 1}`"
              @load="onImgLoad($event, idx)"
            />
            <!-- 多边形矢量图层 (SVG) -->
            <svg
              v-if="hasSvgAnnotations(img) && isRegionsVisible(idx)"
              class="absolute inset-0 w-full h-full pointer-events-none z-20"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <defs>
                <marker
                  :id="'viewer-arrow-head-' + idx"
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
              <polygon
                v-for="reg in (img?.regions || []).filter(r => r.type === 'polygon' && (r.pctPoints?.length >= 3 || r.normPoints?.length >= 3 || r.points?.length >= 3))"
                :key="'poly-' + reg.id"
                :points="getViewerPolygonPointsAttr(reg, img)"
                :fill="getViewerPolygonFill(reg)"
                :stroke="reg.color?.border || '#3B82F6'"
                :stroke-width="hoveredRegionKey === `${idx}_${reg.id}` ? '3' : '2'"
                stroke-linejoin="round"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
                class="pointer-events-auto cursor-pointer transition-all"
                @click.stop="onRegionClick(idx, reg)"
                @mouseenter="$emit('region-hover', `${idx}_${reg.id}`)"
                @mouseleave="$emit('region-hover', null)"
              />
              <line
                v-for="(ann, aIdx) in getArrowAnnotations(img)"
                :key="'arr-' + aIdx"
                :x1="ann.normX1 * 100"
                :y1="ann.normY1 * 100"
                :x2="ann.normX2 * 100"
                :y2="ann.normY2 * 100"
                stroke="#EF4444"
                stroke-width="3"
                :marker-end="'url(#viewer-arrow-head-' + idx + ')'"
                vector-effect="non-scaling-stroke"
              />
            </svg>

            <!-- 选区视觉画框与 3D 置入层 -->
            <div
              v-if="((img?.regions && img.regions.length > 0) || (img?.annotations && img.annotations.length > 0)) && isRegionsVisible(idx)"
              class="absolute inset-0 pointer-events-none overflow-hidden"
            >
              
              <!-- 文本与马赛克标绘 -->
              <template v-if="img?.annotations">
                <div
                  v-for="(ann, aIdx) in getTextAnnotations(img)"
                  :key="'txt-' + aIdx"
                  class="absolute px-1.5 py-0.5 rounded bg-rose-600 border border-white/60 text-white font-bold text-[10px] shadow-lg pointer-events-none whitespace-nowrap z-30"
                  :style="{
                    left: `${ann.normX * 100}%`,
                    top: `${ann.normY * 100}%`,
                    transform: 'translate(-4px, -50%)',
                  }"
                >
                  {{ ann.text }}
                </div>
                <div
                  v-for="(ann, aIdx) in getMosaicAnnotations(img)"
                  :key="'mos-' + aIdx"
                  class="absolute pointer-events-none border border-dashed border-rose-500 rounded z-20 overflow-hidden"
                  :style="{
                    left: `${ann.normX * 100}%`,
                    top: `${ann.normY * 100}%`,
                    width: `${ann.normW * 100}%`,
                    height: `${ann.normH * 100}%`,
                    backdropFilter: 'blur(8px) contrast(1.2)',
                    backgroundColor: 'rgba(160, 160, 160, 0.25)',
                  }"
                ></div>
              </template>
              <div
                v-for="reg in (img.regions || [])"
                :key="reg.id"
                class="absolute pointer-events-auto cursor-pointer transition-all rounded select-none"
                :style="getRegionOverlayStyle(reg, idx)"
                @click.stop="onRegionClick(idx, reg)"
                @mouseenter="$emit('region-hover', `${idx}_${reg.id}`)"
                @mouseleave="$emit('region-hover', null)"
              >
                <div
                  class="absolute -top-5 left-0 px-2 py-0.5 rounded font-mono font-bold text-[9px] shadow flex items-center gap-1 whitespace-nowrap z-30 pointer-events-none"
                  :class="reg.color?.badgeClass || 'bg-blue-500 text-white'"
                >
                  <span>{{ reg.name }}</span>
                  <span class="opacity-80">({{ getOpName(reg.op) }}{{ reg.op === 'recolor' && (reg.params?.materialName || reg.params?.colorName) ? ': ' + (reg.params.materialName || reg.params.colorName) : '' }})</span>
                </div>
                <div
                  v-if="['replace', 'add'].includes(reg.op) && reg.params?.snapshotUrl"
                  class="w-full h-full flex items-center justify-center overflow-hidden rounded p-0.5"
                  :class="reg.params?.transparentBg !== false ? 'bg-transparent' : 'bg-[#F8FAFC]'"
                  :style="getPolygonClipPathStyle(reg, img)"
                >
                  <img :src="reg.params.snapshotUrl" class="w-full h-full object-contain pointer-events-none drop-shadow" alt="" />
                </div>
                <!-- 基础属性：智能平铺材质贴图与色彩预览 -->
                <div
                  v-else-if="reg.op === 'recolor' && (reg.params?.materialTextureUrl || reg.params?.colorHex)"
                  class="w-full h-full rounded overflow-hidden relative flex items-center justify-center pointer-events-none"
                  :style="{ backgroundColor: reg.params.colorHex ? hexToRgba(reg.params.colorHex, 0.4) : 'rgba(59, 130, 246, 0.2)', ...getPolygonClipPathStyle(reg) }"
                >
                  <img
                    v-if="reg.params?.materialTextureUrl"
                    :src="reg.params.materialTextureUrl"
                    class="w-full h-full object-cover mix-blend-multiply opacity-80"
                    alt="材质贴图"
                  />
                  <div class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur text-[8px] text-white font-mono flex items-center gap-1 shadow">
                    <span class="w-1.5 h-1.5 rounded-full border border-white/30" :style="{ backgroundColor: reg.params.colorHex || '#CBD5E1' }"></span>
                    <span class="truncate max-w-[80px]">{{ reg.params.materialName || reg.params.colorName || '基础属性' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-all flex items-center justify-center pointer-events-none opacity-0 group-hover/img:opacity-100">
            <span class="px-2.5 py-1 rounded-lg bg-studio-950/85 border border-studio-700 text-white text-xs font-bold flex items-center gap-1.5 backdrop-blur shadow-xl">
              <StudioIcon name="edit" :size="13" />
              <span>点击编辑</span>
            </span>
          </div>
        </div>

        <div class="mt-2.5 flex items-center justify-between shrink-0 px-1">
          <div class="flex items-center gap-2 min-w-0">
            <span class="px-2 py-0.5 rounded bg-studio-cyan/15 text-studio-cyan font-mono text-xs font-bold">图{{ idx + 1 }}</span>
            <span class="text-xs font-mono text-slate-400 truncate">{{ img.name || `ARCH_REF_0${idx+1}` }}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              v-if="img?.regions && img.regions.length > 0"
              type="button"
              @click.stop="toggleRegionsVisibility(idx)"
              class="px-2 py-0.5 rounded border text-[10px] font-bold cursor-pointer flex items-center gap-1 shrink-0 transition-colors"
              :class="isRegionsVisible(idx) ? 'bg-studio-accent/20 border-studio-accent/50 text-studio-cyan' : 'bg-studio-800 text-slate-400 border-studio-700'"
              :title="isRegionsVisible(idx) ? '隐藏此图选区遮罩' : '显示此图选区遮罩'"
            >
              <StudioIcon name="layers" :size="11" />
              <span>{{ isRegionsVisible(idx) ? `选区(${img.regions.length})` : '选区(隐)' }}</span>
            </button>
            <button @click.stop="$emit('open-edit', idx)" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-studio-800 cursor-pointer"><StudioIcon name="edit" :size="15" hoverMorph /></button>
            <button @click.stop="$emit('remove', idx)" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-studio-800 cursor-pointer"><StudioIcon name="trash" :size="15" /></button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';

const props = defineProps({
  images: { type: Array, default: () => [] },
  selectedIndex: { type: Number, default: 0 },
  hoveredRegionKey: { type: String, default: null },
});

const emit = defineEmits([
  'select',
  'open-edit',
  'remove',
  'toggle-collapse',
  'suggest-prompts',
  'revert-annotation',
  'region-hover',
  'open-picker',
  'upload-files',
]);

const isDragging = ref(false);

function onDropFiles(e) {
  isDragging.value = false;
  const files = e.dataTransfer?.files;
  if (files && files.length) {
    emit('upload-files', Array.from(files));
  }
}

const hiddenRegionOverlayMap = reactive(new Set());

function isRegionsVisible(idx) {
  return !hiddenRegionOverlayMap.has(idx);
}

function toggleRegionsVisibility(idx) {
  if (hiddenRegionOverlayMap.has(idx)) {
    hiddenRegionOverlayMap.delete(idx);
  } else {
    hiddenRegionOverlayMap.add(idx);
  }
}

function getOpName(op) {
  const map = {
    replace: '3D替换',
    add: '增加',
    erase: '消除',
    recolor: '基础属性',
    custom: '自定义',
    blank: '留白'
  };
  return map[op] || '选区';
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

function hasPolygonRegions(img) {
  return Array.isArray(img?.regions) && img.regions.some((r) => r.type === 'polygon');
}

function getViewerPolygonPointsAttr(reg, img) {
  // 归一化点集 (0~1) 具有最高数学精度，直接映射到 viewBox="0 0 100 100" 的绝对坐标
  if (Array.isArray(reg.normPoints) && reg.normPoints.length >= 3) {
    return reg.normPoints.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
  }
  if (Array.isArray(reg.pctPoints) && reg.pctPoints.length >= 3) {
    const maxVal = Math.max(...reg.pctPoints.flatMap((p) => [p.x, p.y]));
    if (maxVal <= 100) {
      return reg.pctPoints.map((p) => `${Number(p.x).toFixed(2)},${Number(p.y).toFixed(2)}`).join(' ');
    }
    const baseW = reg.canvasWidth || img?.width || 800;
    const baseH = reg.canvasHeight || img?.height || 600;
    return reg.pctPoints.map((p) => `${((p.x / baseW) * 100).toFixed(2)},${((p.y / baseH) * 100).toFixed(2)}`).join(' ');
  }
  if (Array.isArray(reg.points) && reg.points.length >= 3) {
    const maxVal = Math.max(...reg.points.flatMap((p) => [p.x, p.y]));
    if (maxVal <= 1.0) {
      return reg.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
    } else if (maxVal <= 100.0) {
      return reg.points.map((p) => `${Number(p.x).toFixed(2)},${Number(p.y).toFixed(2)}`).join(' ');
    } else {
      const baseW = reg.canvasWidth || img?.width || 800;
      const baseH = reg.canvasHeight || img?.height || 600;
      return reg.points.map((p) => `${((p.x / baseW) * 100).toFixed(2)},${((p.y / baseH) * 100).toFixed(2)}`).join(' ');
    }
  }
  return '';
}

function getViewerPolygonFill(reg) {
  if (['replace', 'add'].includes(reg.op) && reg.params?.snapshotUrl) {
    return 'rgba(248, 250, 252, 0.2)';
  }
  if (reg.op === 'recolor' && reg.params?.colorHex) {
    return hexToRgba(reg.params.colorHex, 0.25);
  }
  return reg.color?.lightBg || 'rgba(59, 130, 246, 0.18)';
}

function getPolygonClipPathStyle(reg, img) {
  if (reg.type !== 'polygon') return {};
  let normPts = null;
  if (Array.isArray(reg.normPoints) && reg.normPoints.length >= 3) {
    normPts = reg.normPoints;
  } else if (Array.isArray(reg.pctPoints) && reg.pctPoints.length >= 3) {
    normPts = reg.pctPoints.map((p) => ({ x: p.x / 100, y: p.y / 100 }));
  } else if (Array.isArray(reg.points) && reg.points.length >= 3) {
    const maxVal = Math.max(...reg.points.flatMap((p) => [p.x, p.y]));
    if (maxVal <= 1.0) {
      normPts = reg.points;
    } else {
      const baseW = reg.canvasWidth || img?.width || 800;
      const baseH = reg.canvasHeight || img?.height || 600;
      normPts = reg.points.map((p) => ({ x: p.x / baseW, y: p.y / baseH }));
    }
  }

  if (!normPts || normPts.length < 3) return {};

  const normX = reg.norm?.x != null ? reg.norm.x : Math.min(...normPts.map((p) => p.x));
  const normY = reg.norm?.y != null ? reg.norm.y : Math.min(...normPts.map((p) => p.y));
  const normW = Math.max(0.001, reg.norm?.w != null ? reg.norm.w : (Math.max(...normPts.map((p) => p.x)) - normX));
  const normH = Math.max(0.001, reg.norm?.h != null ? reg.norm.h : (Math.max(...normPts.map((p) => p.y)) - normY));

  const pts = normPts.map((p) => {
    const rx = Math.max(0, Math.min(100, ((p.x - normX) / normW) * 100));
    const ry = Math.max(0, Math.min(100, ((p.y - normY) / normH) * 100));
    return `${rx.toFixed(1)}% ${ry.toFixed(1)}%`;
  });
  return {
    clipPath: `polygon(${pts.join(', ')})`,
    WebkitClipPath: `polygon(${pts.join(', ')})`,
  };
}

function hasSvgAnnotations(img) {
  return hasPolygonRegions(img) || (Array.isArray(img?.annotations) && img.annotations.some((a) => a.type === 'arrow'));
}

function getArrowAnnotations(img) {
  if (!Array.isArray(img?.annotations)) return [];
  const baseW = img.width || 800;
  const baseH = img.height || 600;
  return img.annotations.filter((a) => a.type === 'arrow').map((a) => {
    let x1 = a.normX1 != null ? a.normX1 : (a.x1 > 1 ? a.x1 / baseW : a.x1);
    let y1 = a.normY1 != null ? a.normY1 : (a.y1 > 1 ? a.y1 / baseH : a.y1);
    let x2 = a.normX2 != null ? a.normX2 : (a.x2 > 1 ? a.x2 / baseW : a.x2);
    let y2 = a.normY2 != null ? a.normY2 : (a.y2 > 1 ? a.y2 / baseH : a.y2);
    return {
      normX1: Math.max(0, Math.min(1, x1 || 0)),
      normY1: Math.max(0, Math.min(1, y1 || 0)),
      normX2: Math.max(0, Math.min(1, x2 || 0)),
      normY2: Math.max(0, Math.min(1, y2 || 0)),
    };
  });
}

function getTextAnnotations(img) {
  if (!Array.isArray(img?.annotations)) return [];
  const baseW = img.width || 800;
  const baseH = img.height || 600;
  return img.annotations.filter((a) => a.type === 'text').map((a) => {
    let x = a.normX != null ? a.normX : (a.x > 1 ? a.x / baseW : a.x);
    let y = a.normY != null ? a.normY : (a.y > 1 ? a.y / baseH : a.y);
    return {
      text: a.text || '',
      normX: Math.max(0, Math.min(1, x || 0)),
      normY: Math.max(0, Math.min(1, y || 0)),
    };
  });
}

function getMosaicAnnotations(img) {
  if (!Array.isArray(img?.annotations)) return [];
  const baseW = img.width || 800;
  const baseH = img.height || 600;
  return img.annotations.filter((a) => a.type === 'mosaic').map((a) => {
    let x = a.normX != null ? a.normX : (a.x > 1 ? a.x / baseW : a.x);
    let y = a.normY != null ? a.normY : (a.y > 1 ? a.y / baseH : a.y);
    let w = a.normW != null ? a.normW : (a.w > 1 ? a.w / baseW : a.w);
    let h = a.normH != null ? a.normH : (a.h > 1 ? a.h / baseH : a.h);
    return {
      normX: Math.max(0, Math.min(1, x || 0)),
      normY: Math.max(0, Math.min(1, y || 0)),
      normW: Math.max(0, Math.min(1, w || 0.1)),
      normH: Math.max(0, Math.min(1, h || 0.1)),
    };
  });
}

function getRegionOverlayStyle(reg, idx) {
  const isHovered = props.hoveredRegionKey === `${idx}_${reg.id}`;
  const leftPct = reg.norm?.x != null ? reg.norm.x * 100 : (reg.pct?.left ?? 10);
  const topPct = reg.norm?.y != null ? reg.norm.y * 100 : (reg.pct?.top ?? 10);
  const widthPct = reg.norm?.w != null ? reg.norm.w * 100 : (reg.pct?.width ?? 30);
  const heightPct = reg.norm?.h != null ? reg.norm.h * 100 : (reg.pct?.height ?? 30);

  const border = reg.color?.border || '#3B82F6';
  let lightBg = reg.color?.lightBg || 'rgba(59, 130, 246, 0.18)';
  if (reg.op === 'recolor' && reg.params?.colorHex) {
    lightBg = hexToRgba(reg.params.colorHex, 0.25);
  }

  const isPoly = reg.type === 'polygon';
  return {
    left: `${leftPct}%`,
    top: `${topPct}%`,
    width: `${widthPct}%`,
    height: `${heightPct}%`,
    border: isPoly ? 'none' : (isHovered ? `3px solid ${border}` : `2px solid ${border}`),
    backgroundColor: isPoly
      ? 'transparent'
      : (['replace', 'add'].includes(reg.op) && reg.params?.snapshotUrl
          ? (reg.params?.transparentBg !== false ? 'transparent' : '#F8FAFC')
          : lightBg),
    boxShadow: isPoly
      ? 'none'
      : (isHovered ? `0 0 0 4px ${border}50, 0 8px 24px rgba(0,0,0,0.6)` : '0 2px 8px rgba(0,0,0,0.3)'),
    zIndex: isHovered ? 25 : 10,
    transform: !isPoly && isHovered ? 'scale(1.02)' : 'none',
  };
}

function onRegionClick(imgIdx, reg) {
  emit('select', imgIdx);
  emit('open-edit', imgIdx);
}

function onImageClick(idx) {
  const img = props.images[idx];
  if (isSubRefImage(img, idx)) {
    const targetIdx = typeof img?.relatedImageIndex === 'number' ? img.relatedImageIndex : 0;
    emit('select', targetIdx);
    emit('open-edit', targetIdx);
    return;
  }
  emit('select', idx);
  emit('open-edit', idx);
}

// 缓存每张图计算得到的纵横比与 CSS aspect-ratio 字符串
const naturalAspects = reactive({});
const aspectRatios = reactive({});

function onImgLoad(event, index) {
  const el = event.target;
  if (el && el.naturalWidth && el.naturalHeight) {
    naturalAspects[index] = `${el.naturalWidth} / ${el.naturalHeight}`;
    aspectRatios[index] = el.naturalHeight / el.naturalWidth;
  }
}

function getImageContainerStyle(idx) {
  const aspect = naturalAspects[idx] || (props.images[idx]?.width && props.images[idx]?.height ? `${props.images[idx].width} / ${props.images[idx].height}` : null);
  if (aspect) {
    return {
      aspectRatio: aspect,
      maxWidth: '100%',
      maxHeight: '100%',
    };
  }
  return {
    maxWidth: '100%',
    maxHeight: '100%',
  };
}

// 2 张图时纵横比分析 (用于判断一竖一横)
const aspectDiff2 = computed(() => {
  if (props.images.length !== 2) return { verticalIdx: -1 };
  const a0 = aspectRatios[0] ?? 1;
  const a1 = aspectRatios[1] ?? 1;
  if (a0 > 1.3 * a1 && a0 > 1.1) return { verticalIdx: 0 };
  if (a1 > 1.3 * a0 && a1 > 1.1) return { verticalIdx: 1 };
  return { verticalIdx: -1 };
});

// 3D 朝向参考图 / 次级参考图专属判断与视觉辅助
function isSubRefImage(img, idx) {
  if (!img) return false;
  return Boolean(img.isRefObject || img.origin === '3d_snapshot' || img.isSubRef);
}

function getSubRefLabel(img, idx) {
  if (isSubRefImage(img, idx)) {
    return `3D参考 (图${idx + 1})`;
  }
  return `图${idx + 1}`;
}

function getSubRefBorderClass(img, idx) {
  const isSelected = props.selectedIndex === idx;
  if (isSubRefImage(img, idx)) {
    return isSelected
      ? 'border-amber-400 ring-2 ring-amber-400/50 shadow-md shadow-amber-400/10'
      : 'border-amber-500/40 hover:border-amber-400 bg-amber-500/5';
  }
  return isSelected
    ? 'border-studio-accent ring-1 ring-studio-accent'
    : 'border-studio-700 hover:border-studio-600';
}
</script>