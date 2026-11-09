<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-0 animate-in fade-in duration-150"
    @click.self="close"
  >
    <div class="relative w-screen h-screen max-w-none rounded-none bg-studio-900 border-0 shadow-2xl flex flex-col overflow-hidden">
      <!-- 顶栏 -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-studio-750 shrink-0 bg-studio-950/40">
        <div class="flex items-center space-x-3">
          <span class="text-xl">🖼️</span>
          <div>
            <div class="text-sm font-bold text-white flex items-center gap-2">
              <span>{{ modalTitle }}</span>
              <span class="text-xs font-mono font-bold text-studio-cyan bg-studio-850 px-2 py-0.5 rounded border border-studio-750">
                {{ libraryTotal > 0 ? `共 ${libraryTotal} 件资产可用` : '连接私有素材库' }}
              </span>
            </div>
            <div class="text-[11px] text-slate-400">点击素材卡片可展开「原图 / 衍生图」版本选择；支持分类筛选与多选</div>
          </div>
        </div>
        <button type="button" @click="close" class="w-8 h-8 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer" title="关闭"><StudioIcon name="close" :size="16" /></button>
      </div>

      <!-- 选项卡与控制栏 -->
      <div class="px-6 py-3 border-b border-studio-750 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-studio-950/20">
        <div class="flex items-center space-x-2">
          <button
            type="button"
            @click="tab = 'library'"
            :class="['px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5', tab === 'library' ? 'bg-studio-accent text-white shadow-md' : 'bg-studio-850 text-slate-400 hover:text-white hover:bg-studio-800 border border-studio-750']"
          >
            <span>🏛️ DAM 素材库</span>
            <span class="text-[10px] font-mono opacity-80">({{ libraryTotal }})</span>
          </button>
          <button
            v-if="uploadEnabled"
            type="button"
            @click="tab = 'upload'"
            :class="['px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5', tab === 'upload' ? 'bg-studio-accent text-white shadow-md' : 'bg-studio-850 text-slate-400 hover:text-white hover:bg-studio-800 border border-studio-750']"
          >
            <span>☁️ 本地高清上传</span>
          </button>
        </div>

        <div v-if="tab === 'library'" class="flex items-center space-x-2.5">
          <div class="relative w-56">
            <input
              v-model="keyword"
              @keyup.enter="loadAssets(1)"
              type="text"
              placeholder="搜索名称 / 标签 / 空间..."
              class="w-full pl-8 pr-3 py-1.5 bg-studio-950 border border-studio-750 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-studio-accent"
            />
            <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"><StudioIcon name="search" :size="13" /></span>
          </div>
          <button type="button" @click="loadAssets(1)" class="px-3 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-200 text-xs font-bold cursor-pointer">
            检索
          </button>
          <div class="h-4 w-px bg-studio-750"></div>
          <button type="button" @click="selectAllCurrentPage" class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-300 text-xs cursor-pointer" title="选择当前页显示的资产">
            全选本页
          </button>
          <button type="button" @click="selected = []" class="px-2.5 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-400 hover:text-rose-400 text-xs cursor-pointer">
            清空
          </button>
        </div>
      </div>

      <!-- 素材库 -->
      <div v-if="tab === 'library'" class="flex-1 flex min-h-0">
        <aside class="picker-pane w-72 shrink-0 overflow-y-auto border-r border-studio-800 p-3 space-y-2">
          <div class="space-y-1.5 pt-1">
            <button type="button" class="filter-switch w-full" :class="{ 'is-on': onlyFav }" @click="toggleFav">
              <span>只看收藏</span>
              <span class="filter-switch-knob"></span>
            </button>
            <button type="button" class="filter-switch w-full" :class="{ 'is-on': onlyRetouched }" @click="toggleRetouched">
              <span>只看精修</span>
              <span class="filter-switch-knob"></span>
            </button>
            <button type="button" class="filter-switch w-full" :class="{ 'is-on': onlyFinished }" @click="toggleFinished">
              <span>只看成品</span>
              <span class="filter-switch-knob"></span>
            </button>
          </div>
          <button
            v-for="tabItem in mainTabs"
            :key="tabItem.key"
            type="button"
            class="sidebar-row"
            :class="{ 'is-on': main === tabItem.key }"
            @click="setMain(tabItem.key)"
          >
            {{ tabItem.label }}
          </button>
          <button
            v-for="subItem in subs"
            :key="subItem.key"
            type="button"
            class="sidebar-row is-sub"
            :class="{ 'is-on': sub === subItem.key }"
            @click="sub = subItem.key; loadAssets(1)"
          >
            {{ subItem.label }}
          </button>
          <div v-if="main === 'image'" class="space-y-1">
            <section class="lib-group">
              <button type="button" class="lib-group-head" @click="openGroups.ratio = !openGroups.ratio"><span>画幅</span><span class="lib-meta">{{ openGroups.ratio ? '收起' : '展开' }}</span></button>
              <div v-if="openGroups.ratio" class="lib-chips">
                <button v-for="item in orientations" :key="item.key" type="button" class="lib-chip" :class="{ 'is-on': orientation === item.key }" @click="orientation = orientation === item.key ? '' : item.key; loadAssets(1)">{{ item.label }}</button>
              </div>
            </section>
            <section v-if="sub === 'interior_exterior'" class="lib-group">
              <button type="button" class="lib-group-head" @click="openGroups.space = !openGroups.space"><span>空间</span><span class="lib-meta">{{ openGroups.space ? '收起' : '展开' }}</span></button>
              <div v-if="openGroups.space" class="lib-chips">
                <button v-for="item in filterSpaces" :key="item.dir" type="button" class="lib-chip" :class="{ 'is-on': space === item.dir }" @click="space = space === item.dir ? '' : item.dir; loadAssets(1)">{{ item.label }}</button>
              </div>
            </section>
            <section v-if="sub === 'interior_exterior'" class="lib-group">
              <button type="button" class="lib-group-head" @click="openGroups.style = !openGroups.style"><span>风格</span><span class="lib-meta">{{ openGroups.style ? '收起' : '展开' }}</span></button>
              <div v-if="openGroups.style" class="lib-chips">
                <button v-for="item in filterStyles" :key="'st' + item.dir" type="button" class="lib-chip" :class="{ 'is-on': style === item.dir }" @click="style = style === item.dir ? '' : item.dir; loadAssets(1)">{{ item.label }}</button>
              </div>
            </section>
            <section v-if="sub === 'interior_exterior'" class="lib-group">
              <button type="button" class="lib-group-head" @click="openGroups.material = !openGroups.material"><span>材质</span><span class="lib-meta">{{ openGroups.material ? '收起' : '展开' }}</span></button>
              <div v-if="openGroups.material" class="lib-chips">
                <button v-for="item in filterMaterials" :key="'mt' + item.dir" type="button" class="lib-chip" :class="{ 'is-on': material === item.dir }" @click="material = material === item.dir ? '' : item.dir; loadAssets(1)">{{ item.label }}</button>
              </div>
            </section>
            <section class="lib-group">
              <button type="button" class="lib-group-head" @click="openGroups.color = !openGroups.color"><span>主色</span><span class="lib-meta">{{ openGroups.color ? '收起' : '展开' }}</span></button>
              <div v-if="openGroups.color" class="lib-chips">
                <button v-for="item in filterColors" :key="item.dir || item.label" type="button" class="lib-chip" :class="{ 'is-on': color === (item.dir || item.label) }" @click="color = color === (item.dir || item.label) ? '' : (item.dir || item.label); loadAssets(1)">{{ item.label }}</button>
              </div>
            </section>
          </div>
        </aside>

        <div class="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <div v-if="loading" class="h-64 flex flex-col items-center justify-center space-y-3 text-slate-400 text-xs">
            <div class="w-8 h-8 rounded-full border-2 border-studio-accent border-t-transparent animate-spin"></div>
            <span>正在全量读取私有 DAM 素材库资产...</span>
          </div>
          <div v-else>
            <!-- 最近使用（跨对话）：本对话 / 其他对话 两组，整行大卡，比下方素材格还大一档 -->
            <div v-if="recentGroups.length" class="mb-6">
              <div class="flex items-center gap-2 mb-3">
                <span class="text-sm font-bold text-white">🕘 {{ context === 'edit' ? '最近调整过的素材' : '最近使用的素材' }}</span>
                <span class="text-[11px] font-normal text-slate-500">跨对话共享 · 点卡片展开版本选择</span>
              </div>
              <div v-for="group in recentGroups" :key="group.key" class="mb-4 last:mb-0">
                <div class="flex items-center gap-2 mb-2">
                  <span
                    class="px-2 py-0.5 rounded-md text-[11px] font-bold border"
                    :class="group.key === 'current' ? 'text-studio-cyan border-studio-cyan/40 bg-studio-cyan/10' : 'text-slate-300 border-studio-750 bg-studio-850'"
                  >{{ group.label }}</span>
                  <span class="text-[11px] text-slate-500">{{ group.items.length }} 件 · {{ group.hint }}</span>
                </div>
                <div class="flex gap-3 overflow-x-auto pb-2">
                  <button
                    v-for="item in group.items"
                    :key="group.key + '-' + (item.fid || item.url)"
                    type="button"
                    class="relative w-60 shrink-0 rounded-xl overflow-hidden border bg-studio-950 cursor-pointer text-left group/recent"
                    :class="isItemSelected(item) ? 'border-studio-cyan ring-2 ring-studio-cyan/30' : 'border-studio-750 hover:border-slate-500'"
                    @click="openVersions(item)"
                  >
                    <img :src="item.url" class="w-full h-44 object-cover group-hover/recent:scale-105 transition-transform duration-200" :alt="item.name" loading="lazy" />
                    <span v-if="item.mark" class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold text-sky-300">{{ item.mark }}</span>
                    <div class="px-2.5 py-2">
                      <div class="text-xs text-slate-200 truncate">{{ item.name || '素材' }}</div>
                      <div class="text-[11px] text-slate-500 truncate">
                        {{ group.key === 'current' ? recentTimeText(item.usedAt) : (item.sessionTitle || '其他对话') }}
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <div v-if="libraryItems.length === 0" class="h-64 flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs">
              <span class="text-3xl">🏜️</span>
              <span>该筛选条件下暂无素材资产，请尝试其他关键词或分类</span>
            </div>
            <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
              <div
                v-for="item in libraryItems"
                :key="item.fid || item.id"
                @click="openVersions(item)"
                :class="[
                  'group relative rounded-xl overflow-hidden border bg-studio-950 aspect-square cursor-pointer transition-all shadow-sm select-none',
                  isItemSelected(item)
                    ? 'border-2 border-studio-cyan ring-2 ring-studio-cyan/30 shadow-lg shadow-studio-cyan/20'
                    : 'border-studio-750 hover:border-slate-500 hover:shadow-md'
                ]"
              >
                <img :src="item.url" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />

                <div class="absolute top-2 left-2 z-10 pointer-events-none">
                  <div
                    :class="[
                      'w-6 h-6 rounded-lg flex items-center justify-center transition-all shadow-md',
                      isItemSelected(item)
                        ? 'bg-studio-cyan text-slate-950 font-black'
                        : 'bg-black/60 backdrop-blur border border-white/20 text-transparent opacity-70 group-hover:opacity-100'
                    ]"
                  >
                    <span class="text-xs">✓</span>
                  </div>
                </div>

                <div class="absolute top-2 right-2 z-10">
                  <span class="on-media px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-bold text-white border border-white/20" title="点击卡片选择原图或衍生图">⇄ 版本</span>
                </div>

                <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent flex flex-col justify-end p-2 pointer-events-none">
                  <span class="text-[11px] font-bold text-white truncate w-full">{{ item.name }}</span>
                  <div class="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                    <span class="flex items-center gap-1 min-w-0">
                      <span class="font-mono text-studio-cyan shrink-0">{{ item.kind === 'video' ? '🎬 视频' : (item.kind === 'audio' ? '🎵 音频' : '🖼️ 图片') }}</span>
                      <span v-if="item.library_shelf === 'retouched'" class="px-1 py-px rounded bg-cyan-400 text-cyan-950 font-bold shrink-0">精修</span>
                      <span v-else-if="item.library_shelf === 'finished'" class="px-1 py-px rounded bg-amber-400 text-amber-950 font-bold shrink-0">成品</span>
                    </span>
                    <span v-if="selectedLabel(item)" class="text-studio-cyan font-bold font-mono truncate max-w-[60%]">{{ selectedLabel(item) }}</span>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 版本选择（小型血缘：原图 + 衍生图 + 缺失画幅插槽） -->
      <div v-if="versionPanelItem" class="absolute inset-0 z-40 flex items-end bg-black/55" @click.self="expandedFid = ''">
        <div class="w-full max-h-[62%] bg-studio-900 border-t border-studio-750 shadow-2xl flex flex-col">
          <div class="flex items-center justify-between px-5 py-3 border-b border-studio-800 shrink-0">
            <div class="min-w-0">
              <div class="text-xs font-bold text-white truncate">选择版本 · {{ versionPanelItem.name }}</div>
              <div class="text-[10px] text-slate-500">
                <span v-if="versionPanelSlots.length" class="text-sky-300 font-bold">虚线卡片是这类图片默认应有、但还没生成的画幅，点一下就地补；</span>
                点击缩略图可看大图、左右切换与原图对比
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                v-if="versionPanelSlots.length > 1"
                type="button"
                class="px-2.5 py-1 rounded-lg bg-sky-400/15 border border-sky-400/40 text-sky-300 text-[11px] font-bold cursor-pointer hover:bg-sky-400/25 disabled:opacity-40"
                :disabled="!!slotBusyFid"
                :title="`一次补齐 ${versionPanelSlots.map((s) => s.ratio).join(' / ')}`"
                @click="generateSlots(versionPanelSlots)"
              >补齐 {{ versionPanelSlots.length }} 档</button>
              <button type="button" class="w-7 h-7 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-400 hover:text-white cursor-pointer" @click="expandedFid = ''">✕</button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto scrollbar-thin p-4">
            <div v-if="derivativeLoading[versionPanelItem.fid]" class="h-32 flex items-center justify-center text-xs text-slate-400">读取衍生版本…</div>
            <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              <div
                v-for="version in versionsOf(versionPanelItem)"
                :key="version.key"
                class="rounded-xl overflow-hidden border bg-studio-950 text-left transition-all flex flex-col"
                :class="isSelected(version.key) ? 'border-studio-cyan ring-2 ring-studio-cyan/30' : 'border-studio-750 hover:border-slate-500'"
              >
                <button
                  type="button"
                  class="relative w-full h-28 bg-black/40 cursor-zoom-in group/ver"
                  :title="`查看大图 · ${version.label}`"
                  @click="openPreview(version)"
                >
                  <img :src="version.url" class="w-full h-full object-contain" :alt="version.label" />
                  <span v-if="version.derivativeId" class="absolute top-1 left-1 px-1 py-0.5 rounded bg-black/75 text-[9px] font-bold text-sky-300">衍生</span>
                  <span v-if="version.geometry" class="absolute top-1 right-1 px-1 py-0.5 rounded bg-amber-400/95 text-[9px] font-bold text-slate-950">画幅变更</span>
                  <span class="on-media absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] font-bold text-white opacity-0 group-hover/ver:opacity-100 transition-opacity">🔍 查看大图</span>
                </button>
                <div class="px-2 py-1.5 flex-1">
                  <div class="text-[11px] font-bold truncate" :class="isSelected(version.key) ? 'text-studio-cyan' : 'text-slate-200'">{{ version.label }}</div>
                  <div class="text-[9px] text-slate-500 font-mono truncate">{{ versionBadge(version) || '读取尺寸…' }}</div>
                </div>
                <button
                  type="button"
                  class="px-2 py-1.5 text-[10px] font-bold border-t border-studio-800 cursor-pointer transition-colors"
                  :class="isSelected(version.key) ? 'bg-studio-cyan/15 text-studio-cyan' : 'bg-studio-850/60 text-slate-300 hover:bg-studio-800 hover:text-white'"
                  @click="pick(versionPanelItem, version)"
                >
                  {{ isSelected(version.key) ? '✓ 已选中 · 取消' : '选择此版本' }}
                </button>
              </div>

              <!-- 缺失画幅插槽：这类图片默认就该有这一档，缺的就地补出来 -->
              <button
                v-for="slot in versionPanelSlots"
                :key="'slot-' + slot.kind"
                type="button"
                class="rounded-xl overflow-hidden border-2 border-dashed text-left transition-all flex flex-col cursor-pointer"
                :class="slotStatus(slot) === 'failed'
                  ? 'border-rose-400/70 bg-studio-950/70 hover:border-rose-300'
                  : 'border-sky-400/60 bg-studio-950/70 hover:border-sky-300'"
                :disabled="!!slotBusyFid || slotStatus(slot) === 'queued'"
                :title="`${slot.label} 是这张图的默认规格，点一下现场生成`"
                @click="generateSlots([slot])"
              >
                <div class="relative w-full h-28 flex flex-col items-center justify-center gap-1 bg-sky-400/5">
                  <span
                    v-if="slotStatus(slot) === 'running' || slotStatus(slot) === 'queued'"
                    class="w-6 h-6 rounded-full border-2 border-sky-300 border-t-transparent animate-spin"
                  ></span>
                  <span
                    v-else
                    class="text-[13px] font-black"
                    :class="slotStatus(slot) === 'failed' ? 'text-rose-300' : 'text-sky-200'"
                  >{{ slotHeadline(slot) }}</span>
                  <span class="px-1.5 py-0.5 rounded bg-black/40 border border-sky-400/40 text-[9px] font-bold text-sky-300 font-mono">{{ slot.ratio }}</span>
                </div>
                <div class="px-2 py-1.5 flex-1">
                  <div class="text-[11px] font-bold text-slate-200 truncate">{{ slot.label }}</div>
                  <div class="text-[9px] text-slate-500">默认挂载规格 · Seedream 5.0 Flash</div>
                </div>
                <div
                  class="px-2 py-1.5 text-[10px] font-bold border-t border-studio-800 text-center"
                  :class="slotStatus(slot) === 'failed' ? 'bg-rose-500/10 text-rose-300' : 'bg-sky-400/10 text-sky-300'"
                >{{ slotActionText(slot) }}</div>
              </button>
            </div>
            <div
              v-if="slotErrorText"
              class="mt-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] font-bold text-rose-300 break-all"
            >{{ slotErrorText }}</div>
            <div v-if="slotChannelText" class="mt-2 text-[11px] font-bold text-emerald-300">{{ slotChannelText }}</div>
          </div>
          <div class="px-5 py-3 border-t border-studio-800 shrink-0 flex items-center justify-between bg-studio-950/50">
            <span class="text-[11px] text-slate-400">已选 {{ selected.length }} / {{ maxSelect }} 件</span>
            <button type="button" class="px-4 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-750 text-slate-200 text-xs font-bold cursor-pointer" @click="expandedFid = ''">完成</button>
          </div>
        </div>
      </div>

      <!-- 大图预览灯箱：固定深色媒体查看器（on-media 豁免主题白字反色，不使用 studio-*/slate-* 类） -->
      <div v-if="previewVersion" class="on-media absolute inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col" @click.self="closePreview">
        <div class="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <div class="min-w-0 flex items-center gap-3">
            <span class="text-sm font-bold text-white truncate">{{ previewVersion.label }}</span>
            <span class="text-[11px] text-white opacity-60 font-mono">{{ versionBadge(previewVersion) || '读取尺寸…' }}</span>
            <span v-if="previewVersion.derivativeId" class="px-1.5 py-0.5 rounded bg-white/15 border border-white/20 text-[9px] font-bold text-sky-300">衍生</span>
            <span v-if="previewVersion.geometry" class="px-1.5 py-0.5 rounded bg-amber-400/95 text-[9px] font-bold text-slate-950">画幅变更</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="previewVersion.derivativeId"
              type="button"
              class="px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors"
              :class="previewCompare ? 'bg-sky-400/20 border-sky-300/60 text-sky-300' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'"
              @click="previewCompare = !previewCompare"
            >
              {{ previewCompare ? '退出对比' : '与原图对比' }}
            </button>
            <button type="button" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer" @click="closePreview">✕</button>
          </div>
        </div>

        <div class="flex-1 min-h-0 p-4 flex items-stretch justify-center gap-4">
          <div v-if="!previewCompare" class="relative w-full h-full flex items-center justify-center">
            <img :src="previewVersion.url" class="max-w-full max-h-full object-contain select-none" :alt="previewVersion.label" @load="probeSize(previewVersion.url)" />
            <button
              v-if="previewList.length > 1"
              type="button"
              class="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 border border-white/20 text-white text-xl font-black hover:bg-white/20 cursor-pointer"
              title="上一版本（←）"
              @click="stepPreview(-1)"
            >‹</button>
            <button
              v-if="previewList.length > 1"
              type="button"
              class="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 border border-white/20 text-white text-xl font-black hover:bg-white/20 cursor-pointer"
              title="下一版本（→）"
              @click="stepPreview(1)"
            >›</button>
          </div>

          <template v-else>
            <div class="flex-1 min-w-0 h-full flex flex-col bg-black/50 rounded-xl border border-white/10 overflow-hidden relative">
              <span class="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-black/80 border border-white/15 text-[11px] font-bold text-white font-mono">
                原图 · {{ versionBadge(previewOrigin) || '—' }}
              </span>
              <div class="w-full h-full flex items-center justify-center p-3">
                <img v-if="previewOrigin" :src="previewOrigin.url" class="max-w-full max-h-full object-contain select-none" alt="原图" />
              </div>
            </div>
            <div class="flex-1 min-w-0 h-full flex flex-col bg-black/50 rounded-xl border border-sky-300/40 overflow-hidden relative">
              <span class="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-white/15 border border-sky-300/40 text-[11px] font-bold text-sky-300 font-mono">
                {{ previewVersion.label }} · {{ versionBadge(previewVersion) || '—' }}
              </span>
              <div class="w-full h-full flex items-center justify-center p-3">
                <img :src="previewVersion.url" class="max-w-full max-h-full object-contain select-none" :alt="previewVersion.label" />
              </div>
            </div>
          </template>
        </div>

        <div class="px-5 py-3 border-t border-white/10 shrink-0 flex items-center justify-between bg-black/60">
          <span class="text-[11px] text-white opacity-60 font-mono">
            {{ previewIndex + 1 }} / {{ previewList.length }} · ←/→ 切换版本 · Esc 关闭
          </span>
          <div class="flex items-center gap-2">
            <button type="button" class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold cursor-pointer" @click="stepPreview(-1)">上一版本</button>
            <button type="button" class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold cursor-pointer" @click="stepPreview(1)">下一版本</button>
            <button
              type="button"
              class="px-4 py-1.5 rounded-lg text-xs font-extrabold text-white shadow-md border border-transparent cursor-pointer"
              :class="isSelected(previewVersion.key) ? 'bg-white/10 border-white/20' : 'bg-gradient-to-r from-studio-accent to-studio-cyan'"
              @click="pick(versionPanelItem, previewVersion); closePreview()"
            >
              {{ isSelected(previewVersion.key) ? '取消选择此版本' : '选择此版本' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 本地上传 -->
      <div v-if="tab === 'upload'" class="flex-1 flex items-center justify-center p-8">
        <div
          @click="fileInput?.click()"
          class="w-full max-w-lg border-2 border-dashed border-studio-700 hover:border-studio-accent rounded-2xl p-12 text-center cursor-pointer transition-all bg-studio-950/60 hover:bg-studio-950 flex flex-col items-center justify-center space-y-3"
        >
          <div class="w-16 h-16 rounded-2xl bg-studio-850 flex items-center justify-center text-3xl">🖼️</div>
          <span class="text-sm font-bold text-slate-200">点击选择本地高清图片或视频</span>
          <span class="text-xs text-slate-400">支持 PNG, JPG, WEBP, MP4 格式，上传后立即挂载为图文混排引用</span>
          <span class="px-4 py-1.5 rounded-lg bg-studio-accent text-white text-xs font-bold shadow-md hover:brightness-110">浏览本地文件</span>
        </div>
        <input ref="fileInput" type="file" class="hidden" @change="onFileSelected" />
      </div>

      <!-- 底栏 -->
      <div class="px-6 py-3.5 border-t border-studio-750 shrink-0 bg-studio-950/60 flex items-center justify-between">
        <div v-if="tab === 'library'" class="flex items-center space-x-2 text-xs text-slate-400 font-mono">
          <span>第 {{ page }} / {{ Math.max(1, Math.ceil(libraryTotal / pageSize)) }} 页</span>
          <button type="button" @click="loadAssets(page - 1)" :disabled="page <= 1" class="px-2.5 py-1 rounded bg-studio-850 hover:bg-studio-800 disabled:opacity-30 border border-studio-750 text-slate-200 cursor-pointer">上一页</button>
          <button type="button" @click="loadAssets(page + 1)" :disabled="page * pageSize >= libraryTotal" class="px-2.5 py-1 rounded bg-studio-850 hover:bg-studio-800 disabled:opacity-30 border border-studio-750 text-slate-200 cursor-pointer">下一页</button>
          <span v-if="notice" class="text-rose-400 font-sans font-bold ml-2">{{ notice }}</span>
        </div>
        <div v-else></div>

        <div class="flex items-center space-x-3">
          <span class="text-xs font-bold text-slate-300">
            已选 <span class="text-studio-cyan font-mono text-sm font-extrabold">{{ selected.length }}</span> / {{ maxSelect }} 件
          </span>
          <button type="button" @click="close" class="px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-studio-850 text-xs font-bold cursor-pointer transition-all">取消</button>
          <button
            type="button"
            @click="confirm"
            :disabled="selected.length === 0"
            class="px-5 py-2 rounded-xl bg-gradient-to-r from-studio-accent to-studio-cyan hover:brightness-110 text-white text-xs font-extrabold shadow-lg shadow-studio-accent/25 transition-all disabled:opacity-40 cursor-pointer"
          >
            {{ submitText }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import StudioIcon from './StudioIcon.vue';
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  fetchAssets,
  fetchAssetDetail,
  getAssetImageUrl,
  getAssetOriginalUrl,
  getDerivativeImageUrl,
  triggerRestageDerivatives,
} from '../api';
import {
  derivativeLabel,
  versionsOf as buildVersions,
  stripVersionKey,
  toggleSelection,
  isSelected as isVersionSelected,
  missingSlotPresets,
  readDerivativeSlotPrefs,
  onDerivativeSlotPrefsChange,
  slotStatusFromDetail,
} from '../../../shared/ml-asset-core/index.ts';

const props = defineProps({
  visible: { type: Boolean, default: false },
  context: { type: String, default: 'chat' }, // 'chat' | 'edit'
  title: { type: String, default: '' },
  submitLabel: { type: String, default: '' },
  maxSelect: { type: Number, default: 1 },
  initialMain: { type: String, default: 'image' },
  initialSub: { type: String, default: '' },
  mediaTypes: { type: Array, default: () => ['image', 'video', 'audio'] },
  recent: { type: Array, default: () => [] },
  // 跨对话的最近使用：本对话一栏、其他对话一栏（服务端 studio_recent_refs，保留最近 50 条）
  recentCurrent: { type: Array, default: () => [] },
  recentOthers: { type: Array, default: () => [] },
  uploadEnabled: { type: Boolean, default: false },
  commitOnVersion: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'confirm', 'upload']);

const tab = ref('library');
const loading = ref(false);
const main = ref('image');
const sub = ref('all');
const onlyFav = ref(false);
const onlyRetouched = ref(false);
const onlyFinished = ref(false);
const orientation = ref('');
const space = ref('');
const style = ref('');
const material = ref('');
const color = ref('');
const keyword = ref('');
const page = ref(1);
const pageSize = 60;
const libraryTotal = ref(0);
const libraryItems = ref([]);
const filterSpaces = ref([]);
const filterStyles = ref([]);
const filterMaterials = ref([]);
const filterColors = ref([]);
const openGroups = ref({ ratio: true, space: true, style: false, material: false, color: false });
const selected = ref([]);
const expandedFid = ref('');
const derivativeCache = ref({});
const derivativeLoading = ref({});
const notice = ref('');
const fileInput = ref(null);
// 大图预览（版本面板内灯箱）：原图与衍生图可放大、左右切换、与原图并排对比
const previewVersion = ref(null);
const previewCompare = ref(false);
const sizeCache = ref({});
// 默认衍生图插槽：缺哪档就补哪档。设置页可以整体关掉或按类目改规格。
const slotPrefs = ref(readDerivativeSlotPrefs());
const restageStatusByFid = ref({});
const slotBusyFid = ref('');
const slotErrorByFid = ref({});
// 生成成功后回显实际走的通道，被降级到本机模型时用户看得见
const slotChannelByFid = ref({});

const mainTabs = computed(() => [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
].filter((item) => props.mediaTypes.includes(item.key)));
const subMap = {
  image: [
    { key: 'all', label: '全部图片' },
    { key: 'interior_exterior', label: '室内外设计' },
    { key: 'figure', label: '人物穿搭' },
    { key: 'furniture', label: '单品家具' },
  ],
  video: [
    { key: 'all', label: '全部视频' },
    { key: 'walkthrough', label: '空间漫游' },
    { key: 'product', label: '单品展示' },
    { key: 'detail', label: '细节特写' },
    { key: 'ad', label: '商业短片' },
    { key: 'portrait', label: '人像动态' },
  ],
  audio: [
    { key: 'all', label: '全部音频' },
    { key: 'bgm', label: '氛围背景乐' },
    { key: 'sfx', label: '环境音效' },
  ],
};
const subs = computed(() => subMap[main.value] || []);
const orientations = [
  { key: 'portrait', label: '9:16 竖图' },
  { key: '3:4', label: '3:4 竖图' },
  { key: 'landscape', label: '16:9 横图' },
  { key: 'square', label: '1:1 方图' },
];
const modalTitle = computed(() => props.title || (props.context === 'edit' ? '从素材库选取底图' : '私有素材库 DAM 资产选择器'));
const submitText = computed(() => props.submitLabel || (props.context === 'edit' ? '使用该素材' : `确认挂载已选 ${selected.value.length} 件`));
const RECENT_LIMIT = 20;
const recentCurrentList = computed(() => {
  const src = (props.recentCurrent && props.recentCurrent.length) ? props.recentCurrent : (props.recent || []);
  return src.filter((item) => item && (item.url || item.fid)).slice(0, RECENT_LIMIT);
});
const recentOtherList = computed(() => {
  const seen = new Set(recentCurrentList.value.map((item) => item.fid || item.url));
  return (props.recentOthers || [])
    .filter((item) => item && (item.url || item.fid) && !seen.has(item.fid || item.url))
    .slice(0, RECENT_LIMIT);
});
const recentGroups = computed(() => [
  recentCurrentList.value.length
    ? {
        key: 'current',
        label: props.context === 'edit' ? '最近调整' : '本对话',
        hint: props.context === 'edit' ? '这次编辑里用过的底图' : '这个对话里用过的素材',
        items: recentCurrentList.value,
      }
    : null,
  recentOtherList.value.length
    ? { key: 'others', label: '其他对话', hint: '别的对话里用过 / 生成过的素材', items: recentOtherList.value }
    : null,
].filter(Boolean));
const recentList = computed(() => [...recentCurrentList.value, ...recentOtherList.value]);
const versionPanelItem = computed(() => {
  const fid = expandedFid.value;
  if (!fid) return null;
  return libraryItems.value.find((it) => String(it.fid) === String(fid))
    || recentList.value.find((it) => String(it.fid) === String(fid))
    || null;
});

function probeSize(url) {
  if (!url || sizeCache.value[url]) return;
  const img = new Image();
  img.onload = () => {
    sizeCache.value = { ...sizeCache.value, [url]: { w: img.naturalWidth || 0, h: img.naturalHeight || 0 } };
  };
  img.onerror = () => {
    sizeCache.value = { ...sizeCache.value, [url]: { w: 0, h: 0 } };
  };
  img.src = url;
}
function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}
function ratioLabel(size) {
  if (!size || !size.w || !size.h) return '';
  const d = gcd(size.w, size.h);
  const rw = Math.round(size.w / d);
  const rh = Math.round(size.h / d);
  if (rw <= 40 && rh <= 40) return `${rw}:${rh}`;
  return (size.w / size.h).toFixed(2);
}
function sizeText(version) {
  const s = sizeCache.value[version?.url];
  if (!s || !s.w || !s.h) return '';
  return `${s.w}×${s.h}`;
}
/** 最近使用卡片右下角的时间：昨天用过的照样算"最近"，只是排在今天后面 */
function recentTimeText(ts) {
  const t = Number(ts || 0);
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  const d = new Date(t);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff < 24 * 3600 * 1000) return `今天 ${hm}`;
  if (diff < 48 * 3600 * 1000) return `昨天 ${hm}`;
  if (diff < 7 * 24 * 3600 * 1000) return `${Math.floor(diff / (24 * 3600 * 1000))} 天前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
function ratioText(version) {
  return ratioLabel(sizeCache.value[version?.url]);
}
function versionBadge(version) {
  const parts = [];
  const r = ratioText(version);
  const s = sizeText(version);
  if (r) parts.push(r);
  if (s) parts.push(s);
  return parts.join(' · ');
}

const previewList = computed(() => (versionPanelItem.value ? versionsOf(versionPanelItem.value) : []));
const previewOrigin = computed(() => previewList.value.find((v) => !v.derivativeId) || null);
const previewIndex = computed(() => {
  if (!previewVersion.value) return -1;
  return previewList.value.findIndex((v) => v.key === previewVersion.value.key);
});
function openPreview(version) {
  previewVersion.value = version;
  previewCompare.value = false;
  probeSize(version.url);
  probeSize(previewOrigin.value?.url);
}
function closePreview() {
  previewVersion.value = null;
  previewCompare.value = false;
}
function stepPreview(delta) {
  if (previewList.value.length < 2) return;
  const next = (previewIndex.value + delta + previewList.value.length) % previewList.value.length;
  previewVersion.value = previewList.value[next];
  probeSize(previewVersion.value.url);
}
function onPreviewKey(e) {
  if (!previewVersion.value) return;
  if (e.key === 'Escape') closePreview();
  else if (e.key === 'ArrowLeft') stepPreview(-1);
  else if (e.key === 'ArrowRight') stepPreview(1);
}
let stopSlotPrefsWatch = null;
onMounted(() => {
  window.addEventListener('keydown', onPreviewKey);
  stopSlotPrefsWatch = onDerivativeSlotPrefsChange((next) => {
    slotPrefs.value = next;
  });
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPreviewKey);
  if (stopSlotPrefsWatch) stopSlotPrefsWatch();
});

function resetPicker() {
  selected.value = [];
  expandedFid.value = '';
  closePreview();
  notice.value = '';
  slotErrorByFid.value = {};
  slotChannelByFid.value = {};
  tab.value = 'library';
  onlyFav.value = false;
  onlyRetouched.value = false;
  onlyFinished.value = false;
  orientation.value = '';
  space.value = '';
  style.value = '';
  material.value = '';
  color.value = '';
  keyword.value = '';
  const nextMain = props.mediaTypes.includes(props.initialMain) ? props.initialMain : (props.mediaTypes[0] || 'image');
  main.value = nextMain;
  if (props.initialSub && (subMap[nextMain] || []).some((s) => s.key === props.initialSub)) {
    sub.value = props.initialSub;
  } else {
    sub.value = nextMain === 'image' ? 'interior_exterior' : 'all';
  }
}

watch(() => props.visible, (open) => {
  if (!open) return;
  resetPicker();
  loadAssets(1);
});
watch(expandedFid, (fid) => {
  if (!fid) closePreview();
});

function close() {
  emit('close');
}

function setMain(key) {
  main.value = key;
  sub.value = key === 'image' ? 'interior_exterior' : 'all';
  space.value = '';
  style.value = '';
  material.value = '';
  loadAssets(1);
}

function toggleFav() {
  onlyFav.value = !onlyFav.value;
  loadAssets(1);
}
function toggleRetouched() {
  onlyRetouched.value = !onlyRetouched.value;
  loadAssets(1);
}
function toggleFinished() {
  onlyFinished.value = !onlyFinished.value;
  loadAssets(1);
}

async function loadAssets(targetPage = 1) {
  page.value = Math.max(1, targetPage);
  loading.value = true;
  notice.value = '';
  try {
    const params = { page: page.value, limit: pageSize, pageSize };
    if (main.value === 'video') {
      params.media_type = 'video';
      if (sub.value && sub.value !== 'all') params.video_purpose = sub.value;
    } else if (main.value === 'audio') {
      params.media_type = 'music';
      params.category = 'music';
    } else {
      params.media_type = 'image';
      if (sub.value === 'figure') params.section = 'figure';
      else if (sub.value !== 'all') {
        params.section = sub.value;
        params.category = sub.value;
      }
      // 「全部图片」不能带 lane=image：后端在 lane=image 且无 section 时会默认收窄到室内外
    }
    const shelves = [];
    if (onlyRetouched.value) shelves.push('retouched');
    if (onlyFinished.value) shelves.push('finished');
    if (shelves.length) params.shelf = shelves.join(',');
    if (onlyFav.value) params.only_favorite = 1;
    if (orientation.value) params.orientation = orientation.value;
    if (color.value) params.color = color.value;
    if (space.value) params.space = space.value;
    if (style.value) params.style = style.value;
    if (material.value) params.material = material.value;
    if (keyword.value.trim()) params.keyword = keyword.value.trim();
    const data = await fetchAssets(params);
    const items = data.items || [];
    libraryTotal.value = data.total || items.length;
    const opts = data.filterOptions || {};
    if (Array.isArray(opts.space)) filterSpaces.value = opts.space;
    if (Array.isArray(opts.style_atom)) filterStyles.value = opts.style_atom;
    if (Array.isArray(opts.material_kind)) filterMaterials.value = opts.material_kind.slice(0, 8);
    if (Array.isArray(opts.colors)) filterColors.value = opts.colors.slice(0, 12);
    let mapped = items.map((it) => ({
      id: it.fid,
      fid: it.fid,
      mediaToken: it.mediaToken,
      name: it.file_name || it.fileName || it.name || '素材资产',
      // 选择器网格缩略图走 256px grid 档；确认选择时原图/衍生图由 versionsOf 另签 URL
      url: getAssetImageUrl(it.fid, it.mediaToken, (it.kind || it.media_type) === 'video' ? '' : 'grid'),
      category: it.category,
      kind: it.kind || it.media_type || 'image',
      library_shelf: it.library_shelf || 'original',
    }));
    libraryItems.value = mapped;
  } catch (e) {
    console.warn('加载素材库资产失败:', e);
    libraryItems.value = [];
    libraryTotal.value = 0;
    notice.value = '素材库读取失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

function isSelected(key) {
  return isVersionSelected(selected.value, key);
}
function isItemSelected(item) {
  return selected.value.some((s) => String(s.fid) === String(item.fid));
}
function selectedLabel(item) {
  const hit = selected.value.find((s) => String(s.fid) === String(item.fid));
  if (!hit) return '';
  return hit.derivativeId ? derivativeLabel(hit.derivativeKind) : '原图';
}

function versionsOf(item) {
  if (item?.url && (String(item.fid || '').startsWith('mat_') || String(item.url).startsWith('/textures/'))) {
    return [{
      key: 'origin:' + item.fid,
      fid: item.fid,
      derivativeId: null,
      derivativeKind: 'origin',
      label: '原图',
      name: item.name,
      material: item.material,
      url: item.url,
      previewUrl: item.url,
    }];
  }
  return buildVersions(item, derivativeCache.value[item.fid], {
    originUrl: (it) =>
      it.fid && !['video', 'audio'].includes(it.kind)
        ? getAssetOriginalUrl(it.fid, it.mediaToken)
        : (it.url || ''),
    derivativeUrl: (it, derivativeId) => getDerivativeImageUrl(it.fid, derivativeId, it.mediaToken),
  });
}

async function ensureDerivatives(item, options = {}) {
  if (!item.fid || item.kind === 'video' || item.kind === 'audio') return;
  if (!options.force && Object.prototype.hasOwnProperty.call(derivativeCache.value, item.fid)) return;
  derivativeLoading.value = { ...derivativeLoading.value, [item.fid]: true };
  try {
    const detail = await fetchAssetDetail(item.fid);
    derivativeCache.value = {
      ...derivativeCache.value,
      [item.fid]: Array.isArray(detail?.derivatives) ? detail.derivatives : [],
    };
    // 插槽要显示「排队中 / 生成中 / 失败」而不是一律「待生成」，状态就来自这里
    restageStatusByFid.value = {
      ...restageStatusByFid.value,
      [item.fid]: detail?.restageStatus || {},
    };
  } catch (e) {
    derivativeCache.value = { ...derivativeCache.value, [item.fid]: [] };
  } finally {
    derivativeLoading.value = { ...derivativeLoading.value, [item.fid]: false };
  }
}

/**
 * 版本面板里还缺的默认插槽。
 * 只有真正读到过详情才计算：详情还没回来时 cached 为空，此时报「待生成」会误伤。
 */
const versionPanelSlots = computed(() => {
  const item = versionPanelItem.value;
  if (!item) return [];
  if (item.kind === 'video' || item.kind === 'audio') return [];
  const cached = derivativeCache.value[item.fid];
  if (!cached) return [];
  return missingSlotPresets(item.category, cached, slotPrefs.value);
});

/** 本页正在跑的请求优先，其次才是后端队列状态。 */
function slotStatus(slot) {
  const item = versionPanelItem.value;
  if (!item) return 'missing';
  if (slotBusyFid.value === item.fid) return 'running';
  return slotStatusFromDetail(slot.kind, restageStatusByFid.value[item.fid]);
}

function slotActionText(slot) {
  const status = slotStatus(slot);
  if (status === 'running') return '生成中…';
  if (status === 'queued') return '排队中';
  if (status === 'failed') return '重试生成';
  return '点击生成';
}

/** 插槽正面的大字：一眼看出是「还没生成」还是「正在生成」。 */
function slotHeadline(slot) {
  const status = slotStatus(slot);
  if (status === 'running') return '生成中…';
  if (status === 'queued') return '排队中';
  if (status === 'failed') return `${slot.shortLabel} 待重试`;
  return `${slot.shortLabel} 待生成`;
}

const slotErrorText = computed(() => {
  const item = versionPanelItem.value;
  if (!item) return '';
  return slotErrorByFid.value[item.fid] || '';
});

/** 这一张图刚才是走哪条通道生成出来的。 */
const slotChannelText = computed(() => {
  const item = versionPanelItem.value;
  if (!item) return '';
  const channels = slotChannelByFid.value[item.fid];
  if (!channels || typeof channels !== 'object') return '';
  const models = Object.values(channels)
    .map((entry) => String(entry?.model || entry?.adapterId || ''))
    .filter(Boolean);
  if (!models.length) return '';
  return `已生成 · 走 ${[...new Set(models)].join(' / ')}`;
});

/**
 * 触发生成。后端 restage 是同步长请求，因此一张图同一次只允许跑一档，
 * 多档缺失时合并成一次调用（ratios 数组），避免同一素材被并发排队两次。
 */
async function generateSlots(slots) {
  const item = versionPanelItem.value;
  if (!item || !item.fid || !slots.length) return;
  if (slotBusyFid.value) return;
  const fid = item.fid;
  slotBusyFid.value = fid;
  slotErrorByFid.value = { ...slotErrorByFid.value, [fid]: '' };
  try {
    const res = await triggerRestageDerivatives(fid, slots.map((slot) => slot.ratio));
    slotChannelByFid.value = {
      ...slotChannelByFid.value,
      [fid]: res?.data?.channels || {},
    };
    // 缓存里那份是生成前的快照，必须强制重读，否则插槽会一直停在「待生成」
    await ensureDerivatives(item, { force: true });
    for (const version of versionsOf(item)) probeSize(version.url);
    if (props.commitOnVersion) {
      const versions = versionsOf(item);
      const generated = versions.find((v) => v.derivativeId && v.ratio === slots[0].ratio) || versions[versions.length - 1];
      if (generated) {
        emit('confirm', [stripVersionKey({ ...generated, name: generated.name || item.name })]);
        close();
        return;
      }
    }
  } catch (e) {
    slotErrorByFid.value = {
      ...slotErrorByFid.value,
      [fid]: String(e?.message || '生成失败，请稍后重试'),
    };
  } finally {
    slotBusyFid.value = '';
  }
}

async function openVersions(item) {
  // 无 fid 的条目无法下载/入库，直接忽略点击
  if (!item.fid) return;
  if (item.kind === 'video' || item.kind === 'audio' || String(item.fid).startsWith('mat_')) {
    const origin = versionsOf(item)[0];
    if (origin) pick(item, origin);
    return;
  }
  if (expandedFid.value === item.fid) {
    expandedFid.value = '';
    return;
  }
  expandedFid.value = item.fid;
  await ensureDerivatives(item);
  // 预读每个版本的真实像素尺寸，用于卡片上的比例徽标与「形状变化」提示
  for (const version of versionsOf(item)) probeSize(version.url);
}

function pick(item, version) {
  if (props.commitOnVersion) {
    emit('confirm', [stripVersionKey({ ...version, name: version.name || item.name })]);
    close();
    return;
  }
  const res = toggleSelection(
    selected.value,
    { ...version, name: version.name || item.name },
    props.maxSelect,
  );
  selected.value = res.selected;
  notice.value = res.notice;
  if (props.maxSelect <= 1 && res.selected.length) expandedFid.value = '';
}

function selectAllCurrentPage() {
  const next = selected.value.slice();
  for (const item of libraryItems.value) {
    if (next.length >= props.maxSelect) break;
    if (!item.fid) continue;
    // 该素材已有任一版本入选时跳过，避免原图与衍生版重复占位
    if (next.some((v) => v.fid === item.fid)) continue;
    const version = versionsOf(item)[0];
    if (!version) continue;
    next.push({ ...version, name: version.name || item.name });
  }
  selected.value = next;
}

function confirm() {
  if (!selected.value.length) return;
  emit('confirm', selected.value.map(stripVersionKey));
  close();
}

function onFileSelected(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  emit('upload', file);
  close();
}
</script>
