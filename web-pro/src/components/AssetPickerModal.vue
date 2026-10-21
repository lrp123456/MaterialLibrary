<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150"
    @click.self="close"
  >
    <div class="relative w-full max-w-[1280px] h-[90vh] rounded-2xl bg-studio-900 border border-studio-750 shadow-2xl flex flex-col overflow-hidden">
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
        <button type="button" @click="close" class="w-8 h-8 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer">
          ✕
        </button>
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
            <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
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
          <div class="lib-plates" style="padding: 0">
            <button
              v-for="plate in shelfPlates"
              :key="plate.key"
              type="button"
              class="lib-plate"
              :class="{ 'is-on': shelf === plate.key }"
              @click="shelf = plate.key; loadAssets(1)"
            >
              <span class="lib-mark"></span>{{ plate.label }}
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
          <button type="button" class="filter-switch" :class="{ 'is-on': onlyFav }" @click="onlyFav = !onlyFav; loadAssets(1)">
            <span>只看收藏</span>
            <span class="filter-switch-knob"></span>
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
            <!-- 最近素材置顶 -->
            <div v-if="recentList.length" class="mb-5">
              <div class="text-xs font-bold text-white mb-2 flex items-center gap-2">
                <span>🕘 {{ context === 'edit' ? '最近调整过的素材' : '最近对话使用 / 生成的素材' }}</span>
                <span class="text-[10px] font-normal text-slate-500">点击卡片展开版本选择</span>
              </div>
              <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                <button
                  v-for="item in recentList"
                  :key="'recent-' + (item.fid || item.url)"
                  type="button"
                  class="relative w-24 shrink-0 rounded-lg overflow-hidden border bg-studio-950 cursor-pointer text-left"
                  :class="isItemSelected(item) ? 'border-studio-cyan ring-2 ring-studio-cyan/30' : 'border-studio-750 hover:border-slate-500'"
                  @click="openVersions(item)"
                >
                  <img :src="item.url" class="w-full h-20 object-cover" :alt="item.name" />
                  <span v-if="item.mark" class="absolute top-1 left-1 px-1 py-0.5 rounded bg-black/70 text-[9px] font-bold text-sky-300">{{ item.mark }}</span>
                  <span class="block px-1.5 py-1 text-[10px] text-slate-300 truncate">{{ item.name || '素材' }}</span>
                </button>
              </div>
            </div>

            <div v-if="libraryItems.length === 0" class="h-64 flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs">
              <span class="text-3xl">🏜️</span>
              <span>该筛选条件下暂无素材资产，请尝试其他关键词或分类</span>
            </div>
            <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
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
                    <span class="font-mono text-studio-cyan">{{ item.kind === 'video' ? '🎬 视频' : (item.kind === 'audio' ? '🎵 音频' : '🖼️ 图片') }}</span>
                    <span v-if="selectedLabel(item)" class="text-studio-cyan font-bold font-mono truncate max-w-[60%]">{{ selectedLabel(item) }}</span>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 版本选择（小型血缘：原图 + 衍生图） -->
      <div v-if="versionPanelItem" class="absolute inset-0 z-40 flex items-end bg-black/55" @click.self="expandedFid = ''">
        <div class="w-full max-h-[62%] bg-studio-900 border-t border-studio-750 shadow-2xl flex flex-col">
          <div class="flex items-center justify-between px-5 py-3 border-b border-studio-800 shrink-0">
            <div class="min-w-0">
              <div class="text-xs font-bold text-white truncate">选择版本 · {{ versionPanelItem.name }}</div>
              <div class="text-[10px] text-slate-500">点击缩略图可看大图、左右切换与原图对比；标「画幅变更」的版本会改变宽高比</div>
            </div>
            <button type="button" class="w-7 h-7 rounded-lg bg-studio-850 hover:bg-studio-800 text-slate-400 hover:text-white cursor-pointer" @click="expandedFid = ''">✕</button>
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
            </div>
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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { fetchAssets, fetchAssetDetail, getAssetImageUrl, getAssetOriginalUrl, getDerivativeImageUrl } from '../api';
import {
  derivativeLabel,
  versionKey,
  versionsOf as buildVersions,
  stripVersionKey,
  toggleSelection,
  isSelected as isVersionSelected,
} from '../../../shared/ml-asset-core/index.ts';

const props = defineProps({
  visible: { type: Boolean, default: false },
  context: { type: String, default: 'chat' }, // 'chat' | 'edit'
  title: { type: String, default: '' },
  submitLabel: { type: String, default: '' },
  maxSelect: { type: Number, default: 1 },
  initialMain: { type: String, default: 'image' },
  mediaTypes: { type: Array, default: () => ['image', 'video', 'audio'] },
  recent: { type: Array, default: () => [] },
  uploadEnabled: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'confirm', 'upload']);

const tab = ref('library');
const loading = ref(false);
const shelf = ref('original');
const main = ref('image');
const sub = ref('all');
const onlyFav = ref(false);
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

const shelfPlates = [
  { key: 'original', label: '原素材' },
  { key: 'retouched', label: '精修素材' },
  { key: 'finished', label: '成品素材' },
];
const mainTabs = computed(() => [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
].filter((item) => props.mediaTypes.includes(item.key)));
const subMap = {
  image: [
    { key: 'all', label: '全部图片' },
    { key: 'interior_exterior', label: '室内外设计' },
    { key: 'portrait', label: '空间人像' },
    { key: 'clothing', label: '服装服饰' },
    { key: 'furniture', label: '单品家具' },
  ],
  video: [
    { key: 'all', label: '全部视频' },
    { key: 'walkthrough', label: '空间漫游' },
    { key: 'ad', label: '商业短片' },
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
const recentList = computed(() => (props.recent || []).filter((item) => item && (item.url || item.fid)).slice(0, 12));
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
onMounted(() => window.addEventListener('keydown', onPreviewKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onPreviewKey));

function resetPicker() {
  selected.value = [];
  expandedFid.value = '';
  closePreview();
  notice.value = '';
  tab.value = 'library';
  const nextMain = props.mediaTypes.includes(props.initialMain) ? props.initialMain : (props.mediaTypes[0] || 'image');
  main.value = nextMain;
  sub.value = nextMain === 'image' ? 'interior_exterior' : 'all';
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

async function loadAssets(targetPage = 1) {
  page.value = Math.max(1, targetPage);
  loading.value = true;
  notice.value = '';
  try {
    const params = { page: page.value, limit: pageSize, pageSize };
    if (main.value === 'video') {
      params.media_type = 'video';
      if (sub.value === 'walkthrough') params.category = 'video';
      if (sub.value === 'ad') params.category = 'finished';
    } else if (main.value === 'audio') {
      params.media_type = 'music';
      params.category = 'music';
    } else {
      params.media_type = 'image';
      if (sub.value !== 'all') params.category = sub.value;
    }
    if (shelf.value) params.shelf = shelf.value;
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
    libraryItems.value = items.map((it) => ({
      id: it.fid,
      fid: it.fid,
      mediaToken: it.mediaToken,
      name: it.file_name || it.fileName || it.name || '素材资产',
      url: getAssetImageUrl(it.fid, it.mediaToken),
      category: it.category,
      kind: it.kind || it.media_type || 'image',
    }));
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
  return buildVersions(item, derivativeCache.value[item.fid], {
    originUrl: (it) =>
      it.fid && !['video', 'audio'].includes(it.kind)
        ? getAssetOriginalUrl(it.fid, it.mediaToken)
        : (it.url || ''),
    derivativeUrl: (it, derivativeId) => getDerivativeImageUrl(it.fid, derivativeId, it.mediaToken),
  });
}

async function ensureDerivatives(item) {
  if (!item.fid || item.kind === 'video' || item.kind === 'audio') return;
  if (Object.prototype.hasOwnProperty.call(derivativeCache.value, item.fid)) return;
  derivativeLoading.value = { ...derivativeLoading.value, [item.fid]: true };
  try {
    const detail = await fetchAssetDetail(item.fid);
    derivativeCache.value = {
      ...derivativeCache.value,
      [item.fid]: Array.isArray(detail?.derivatives) ? detail.derivatives : [],
    };
  } catch (e) {
    derivativeCache.value = { ...derivativeCache.value, [item.fid]: [] };
  } finally {
    derivativeLoading.value = { ...derivativeLoading.value, [item.fid]: false };
  }
}

async function openVersions(item) {
  if (!item.fid || item.kind === 'video' || item.kind === 'audio') {
    pick(item, versionsOf(item)[0]);
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
  for (const item of libraryItems.value) {
    if (selected.value.length >= props.maxSelect) break;
    const key = versionKey(item.fid, '');
    if (isSelected(key)) continue;
    selected.value.push(stripVersionKey(versionsOf(item)[0]));
  }
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
