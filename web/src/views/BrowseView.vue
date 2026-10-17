<template>
  <div class="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
    <!-- 顶部检索与筛选胶囊条 -->
    <div class="bg-surface-low border border-outline-variant rounded-2xl p-3 sm:p-4 shadow-sm space-y-3">
      <!-- 素材大类切换 Tab 栏 -->
      <div class="flex items-center gap-1.5 pb-2 border-b border-outline-variant/60 overflow-x-auto">
        <button
          v-for="tab in categoryTabs"
          :key="tab.key"
          type="button"
          @click="setCategory(tab.key)"
          class="px-3 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          :class="filters.category === tab.key ? 'bg-primary text-white shadow-sm' : 'bg-surface text-on-surface-variant hover:text-white hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
          <span v-if="tab.count !== undefined && tab.count !== null" class="text-[10px] opacity-75">({{ tab.count }})</span>
        </button>
      </div>

      <!-- 搜索与主维胶囊 -->
      <div class="flex flex-wrap items-center gap-2">
        <!-- 搜索输入框 -->
        <div class="flex-1 min-w-[220px] relative">
          <span class="material-symbols-outlined absolute left-3 top-2.5 text-outline text-base">search</span>
          <input
            v-model="filters.keyword"
            @keyup.enter="loadAssets(1)"
            :placeholder="filters.category === 'furniture' ? '搜索家具品类、造型、材质、经典名款...' : '搜索空间、风格、材质、设计文件名...'"
            class="w-full bg-surface border border-outline-variant rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-outline outline-none focus:border-primary transition"
          />
          <button
            v-if="filters.keyword"
            @click="filters.keyword = ''; loadAssets(1)"
            class="absolute right-3 top-2.5 text-outline hover:text-white text-xs"
          >
            <span class="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        <!-- 独立单品模式专属主筛选 -->
        <div v-if="filters.category === 'furniture'" class="flex flex-wrap items-center gap-1.5">
          <select v-model="filters.furniture_category" @change="loadAssets(1)" class="filter-select">
            <option value="">家具大类: 全部</option>
            <option v-for="o in options.furniture_category || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>

          <select v-model="filters.furniture_item" @change="loadAssets(1)" class="filter-select">
            <option value="">单品品类: 全部</option>
            <option v-for="o in options.furniture_item || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>

          <select @change="onSelectMaterial($event)" class="filter-select">
            <option value="">+ 添加材质...</option>
            <optgroup label="硬装主材">
              <option v-for="o in hardMaterials" :key="o.dir" :value="o.dir" :disabled="selectedMaterials.includes(o.dir)">
                {{ o.label }} ({{ o.count }})
              </option>
            </optgroup>
            <optgroup label="软装点缀">
              <option v-for="o in softMaterials" :key="o.dir" :value="o.dir" :disabled="selectedMaterials.includes(o.dir)">
                {{ o.label }} ({{ o.count }})
              </option>
            </optgroup>
          </select>

          <select v-model="filters.style" @change="loadAssets(1)" class="filter-select">
            <option value="">流派风格: 全部</option>
            <option v-for="o in options.style_atom || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>

          <select v-model="filters.classic_design" @change="loadAssets(1)" class="filter-select">
            <option value="">经典名款: 全部</option>
            <option v-for="o in options.classic_design || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>

          <select v-model="filters.colors" @change="loadAssets(1)" class="filter-select">
            <option value="">主颜色: 全部</option>
            <option v-for="o in options.colors || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>

          <select v-model="filters.orientation" @change="loadAssets(1)" class="filter-select">
            <option value="">画幅: 全部</option>
            <option v-for="o in options.orientation || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>

        <!-- 空间/综合模式主筛选 -->
        <div v-else class="flex flex-wrap items-center gap-1.5">
          <select v-model="filters.space" @change="loadAssets(1)" class="filter-select">
            <option value="">空间: 全部</option>
            <option v-for="o in options.space || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>

          <select v-model="filters.style" @change="loadAssets(1)" class="filter-select">
            <option value="">风格: 全部</option>
            <option v-for="o in options.style_atom || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>

          <select @change="onSelectMaterial($event)" class="filter-select">
            <option value="">+ 添加材质...</option>
            <optgroup label="硬装主材">
              <option v-for="o in hardMaterials" :key="o.dir" :value="o.dir" :disabled="selectedMaterials.includes(o.dir)">
                {{ o.label }} ({{ o.count }})
              </option>
            </optgroup>
            <optgroup label="软装点缀">
              <option v-for="o in softMaterials" :key="o.dir" :value="o.dir" :disabled="selectedMaterials.includes(o.dir)">
                {{ o.label }} ({{ o.count }})
              </option>
            </optgroup>
          </select>

          <select v-model="filters.color_style" @change="loadAssets(1)" class="filter-select">
            <option value="">设计色系: 全部</option>
            <option v-for="o in options.color_style || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>

          <select v-model="filters.colors" @change="loadAssets(1)" class="filter-select">
            <option value="">主颜色: 全部</option>
            <option v-for="o in options.colors || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>

          <select v-model="filters.orientation" @change="loadAssets(1)" class="filter-select">
            <option value="">画幅: 全部</option>
            <option v-for="o in options.orientation || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>

        <!-- 高级筛选展开按钮 -->
        <button
          @click="showAdvanced = !showAdvanced"
          class="px-3 py-2 rounded-xl border text-xs flex items-center gap-1 transition cursor-pointer"
          :class="showAdvanced || hasActiveAdvanced ? 'bg-primary/10 border-primary text-primary' : 'bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">tune</span>
          <span>高级筛选</span>
          <span v-if="activeAdvancedCount > 0" class="px-1.5 py-0.2 rounded-full bg-primary text-white text-[10px]">{{ activeAdvancedCount }}</span>
        </button>

        <button
          v-if="hasAnyFilter"
          @click="resetFilters"
          class="px-2.5 py-2 text-xs text-outline hover:text-white transition flex items-center gap-0.5 cursor-pointer"
          title="重置所有筛选"
        >
          <span class="material-symbols-outlined text-sm">restart_alt</span>
          <span class="hidden sm:inline">重置</span>
        </button>
      </div>

      <!-- 材质多选已选胶囊栏 (AND 严格匹配) -->
      <div v-if="selectedMaterials.length" class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-outline-variant/40">
        <span class="text-[11px] text-outline flex items-center gap-1 font-medium">
          <span class="material-symbols-outlined text-xs text-primary">filter_alt</span>
          <span>已选材质 (需同时满足 AND):</span>
        </span>
        <span
          v-for="mat in selectedMaterials"
          :key="mat"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium border transition shadow-sm"
          :class="isHardMaterial(mat) ? 'bg-amber-950/40 border-amber-600/60 text-amber-200' : 'bg-sky-950/40 border-sky-600/60 text-sky-200'"
        >
          <span class="w-1.5 h-1.5 rounded-full" :class="isHardMaterial(mat) ? 'bg-amber-400' : 'bg-sky-400'"></span>
          <span>{{ isHardMaterial(mat) ? '硬装' : '软装' }} · {{ materialLabel(mat) }}</span>
          <button @click="removeMaterial(mat)" class="hover:text-white cursor-pointer ml-0.5" title="移除此材质">
            <span class="material-symbols-outlined text-xs">close</span>
          </button>
        </span>
        <button
          @click="clearMaterials"
          class="text-[11px] text-outline hover:text-white underline cursor-pointer ml-1"
          title="清空所有已选材质"
        >
          清空材质
        </button>
      </div>

      <!-- 高级筛选折叠区 (单品模式) -->
      <div v-if="showAdvanced && filters.category === 'furniture'" class="pt-3 border-t border-outline-variant grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <label class="block text-[11px] text-outline mb-1">表面工艺</label>
          <select v-model="filters.furniture_craft" @change="loadAssets(1)" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary">
            <option value="">全部</option>
            <option v-for="o in options.furniture_craft || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>

        <div>
          <label class="block text-[11px] text-outline mb-1">造型特征</label>
          <select v-model="filters.furniture_form" @change="loadAssets(1)" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary">
            <option value="">全部</option>
            <option v-for="o in options.furniture_form || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>

        <div>
          <label class="block text-[11px] text-outline mb-1">推荐空间</label>
          <select v-model="filters.space" @change="loadAssets(1)" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary">
            <option value="">全部</option>
            <option v-for="o in options.space || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>

        <div>
          <label class="block text-[11px] text-outline mb-1">标记属性</label>
          <select v-model="filters.flags" @change="loadAssets(1)" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary">
            <option value="">全部</option>
            <option v-for="o in options.flags || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>
      </div>

      <!-- 高级筛选折叠区 (空间/综合模式) -->
      <div v-else-if="showAdvanced" class="pt-3 border-t border-outline-variant grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
        <div>
          <label class="block text-[11px] text-outline mb-1">调性氛围</label>
          <select v-model="filters.tone" @change="loadAssets(1)" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary">
            <option value="">全部</option>
            <option v-for="o in options.tone || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>

        <div>
          <label class="block text-[11px] text-outline mb-1">文化地域</label>
          <select v-model="filters.region" @change="loadAssets(1)" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary">
            <option value="">全部</option>
            <option v-for="o in options.region || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>

        <div>
          <label class="block text-[11px] text-outline mb-1">构图景别</label>
          <select v-model="filters.view_composition" @change="loadAssets(1)" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary">
            <option value="">全部</option>
            <option v-for="o in options.view_composition || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>

        <div>
          <label class="block text-[11px] text-outline mb-1">机位视角</label>
          <select v-model="filters.view_angle" @change="loadAssets(1)" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary">
            <option value="">全部</option>
            <option v-for="o in options.view_angle || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>

        <div>
          <label class="block text-[11px] text-outline mb-1">光线环境</label>
          <select v-model="filters.lighting" @change="loadAssets(1)" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary">
            <option value="">全部</option>
            <option v-for="o in options.lighting || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>

        <div>
          <label class="block text-[11px] text-outline mb-1">标记属性</label>
          <select v-model="filters.flags" @change="loadAssets(1)" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary">
            <option value="">全部</option>
            <option v-for="o in options.flags || []" :key="o.dir" :value="o.dir">{{ o.label }} ({{ o.count }})</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 结果统计与状态提示 -->
    <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-on-surface-variant px-1">
      <div class="flex flex-wrap items-center gap-3">
        <p>共查找到 <span class="text-white font-medium">{{ total }}</span> 张可用设计素材</p>

        <!-- 排序模式切换 -->
        <div class="flex items-center bg-surface-low border border-outline-variant rounded-xl p-0.5 text-[11px]">
          <button
            type="button"
            @click="setSort('latest')"
            class="px-2.5 py-1 rounded-lg transition cursor-pointer"
            :class="filters.sort === 'latest' ? 'bg-primary text-white font-medium shadow-sm' : 'text-on-surface-variant hover:text-white'"
            title="最新拍摄或入库时间在前"
          >
            最新
          </button>
          <button
            type="button"
            @click="setSort('earliest')"
            class="px-2.5 py-1 rounded-lg transition cursor-pointer"
            :class="filters.sort === 'earliest' ? 'bg-primary text-white font-medium shadow-sm' : 'text-on-surface-variant hover:text-white'"
            title="最早时间在前"
          >
            最早
          </button>
          <button
            type="button"
            @click="setSort('recommend')"
            class="px-2.5 py-1 rounded-lg transition cursor-pointer"
            :class="filters.sort === 'recommend' ? 'bg-primary text-white font-medium shadow-sm' : 'text-on-surface-variant hover:text-white'"
            title="AI重构与画幅综合推荐"
          >
            推荐
          </button>
        </div>

        <!-- 视图切换：时间线分组 / 紧凑网格 -->
        <div class="flex items-center bg-surface-low border border-outline-variant rounded-xl p-0.5 text-[11px]">
          <button
            type="button"
            @click="viewMode = 'timeline'"
            class="px-2 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer"
            :class="viewMode === 'timeline' ? 'bg-primary/20 text-primary font-medium' : 'text-on-surface-variant hover:text-white'"
            title="按今天、昨天、日期时间线分组"
          >
            <span class="material-symbols-outlined text-xs">view_timeline</span>
            <span class="hidden sm:inline">时间分组</span>
          </button>
          <button
            type="button"
            @click="viewMode = 'grid'"
            class="px-2 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer"
            :class="viewMode === 'grid' ? 'bg-primary/20 text-primary font-medium' : 'text-on-surface-variant hover:text-white'"
            title="平铺网格"
          >
            <span class="material-symbols-outlined text-xs">grid_view</span>
            <span class="hidden sm:inline">平铺</span>
          </button>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <div v-if="loading" class="flex items-center gap-1.5 text-primary">
          <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
          <span>检索中...</span>
        </div>
        <template v-if="isAdmin">
          <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onUploadFiles" />
          <button
            type="button"
            :disabled="uploading"
            @click="$refs.fileInput?.click()"
            class="px-3 py-1.5 rounded-xl bg-primary text-white font-medium flex items-center gap-1 disabled:opacity-50 cursor-pointer"
            title="本地选图入库，成功后自动备份到夸克"
          >
            <span class="material-symbols-outlined text-sm" :class="{ 'animate-spin': uploading }">{{ uploading ? 'progress_activity' : 'upload' }}</span>
            <span>{{ uploading ? '上传中...' : '上传原图' }}</span>
          </button>
        </template>
      </div>
    </div>
    <p v-if="uploadHint" class="text-[11px] px-1" :class="uploadHint.startsWith('失败') ? 'text-error' : 'text-primary'">{{ uploadHint }}</p>

    <!-- 素材时间线分组视图 (按今天、昨天、日期等分组呈现) -->
    <div v-if="items.length && viewMode === 'timeline'" class="space-y-6">
      <div v-for="group in dateGroups" :key="group.key" class="space-y-2.5">
        <!-- 日期分组粘性标题条 -->
        <div class="flex items-center justify-between pb-2 border-b border-outline-variant/60 sticky top-14 bg-surface/95 backdrop-blur-md z-10 py-1.5 px-0.5">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-sm text-primary">calendar_today</span>
            <h3 class="text-sm font-bold text-white tracking-wide">{{ group.label }}</h3>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-surface-high border border-outline-variant text-on-surface-variant font-medium">
              {{ group.items.length }} 张
            </span>
          </div>
          <span v-if="group.sub" class="text-xs text-outline font-mono">{{ group.sub }}</span>
        </div>

        <!-- 素材瀑布网格 (移动端2列，PC端4-5列) -->
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          <div
            v-for="it in group.items"
            :key="it.fid"
            @click="openDetail(it.fid)"
            class="bg-surface-low border border-outline-variant rounded-2xl overflow-hidden cursor-pointer hover:border-primary hover:shadow-lg transition flex flex-col group"
          >
            <!-- 9:16 卡片视口容器 -->
            <div class="relative aspect-[9/16] bg-surface overflow-hidden flex items-center justify-center">
              <img
                :src="api.imageUrl(it.fid, it.main_derivative_id)"
                :alt="it.file_name"
                loading="lazy"
                class="w-full h-full transition duration-300 group-hover:scale-105"
                :class="it.mainDerivative?.kind === 'restage_9_16' || it.origin_orientation === '9:16' ? 'object-cover' : 'object-contain'"
              />

              <!-- 浮标提示组 -->
              <div class="absolute top-2 left-2 flex flex-col gap-1 items-start">
                <span v-if="it.category === 'furniture'" class="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-600/90 backdrop-blur-sm text-white font-semibold border border-white/15">
                  单品
                </span>
                <span v-if="it.dupCount > 1 && it.is_representative" class="text-[10px] px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-sm text-white font-semibold border border-white/15">
                  主图
                </span>
                <span v-if="it.dupCount > 1" class="text-[10px] px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-sm text-white font-medium border border-white/10 flex items-center gap-0.5">
                  <span class="material-symbols-outlined text-[11px]">collections</span>
                  <span>{{ it.dup_group_id && it.dup_group_id.startsWith('video_') ? `多视角 ×${it.dupCount}` : `相似 ×${it.dupCount}` }}</span>
                </span>
                <span v-if="it.mainDerivative?.kind === 'restage_9_16'" class="text-[9px] px-1.5 py-0.5 rounded-full bg-violet/90 backdrop-blur-sm text-white font-semibold">
                  9:16 生成
                </span>
                <span v-else-if="it.mainDerivative?.kind === 'restage_3_4'" class="text-[9px] px-1.5 py-0.5 rounded-full bg-violet/90 backdrop-blur-sm text-white font-semibold">
                  3:4 生成
                </span>
                <span v-else-if="String(it.mainDerivative?.kind || '').startsWith('restage_')" class="text-[9px] px-1.5 py-0.5 rounded-full bg-violet/90 backdrop-blur-sm text-white font-semibold">
                  AI 生成
                </span>
              </div>

              <div class="absolute top-2 right-2 flex flex-col gap-1 items-end">
                <span v-if="it.readyFlags?.length" class="text-[9px] px-1.5 py-0.5 rounded-md bg-tertiary-container/80 text-white font-medium" title="降级可用">
                  标记
                </span>
                <span v-if="it.origin_orientation" class="text-[9px] px-1 rounded bg-black/50 text-on-surface-variant">
                  {{ it.origin_orientation }}
                </span>
              </div>
            </div>

            <!-- 底部元数据卡片 -->
            <div class="p-2.5 flex-1 flex flex-col justify-between space-y-1.5">
              <p class="text-[11px] font-medium text-white truncate" :title="it.file_name">
                {{ it.file_name }}
              </p>

              <!-- 核心标签胶囊 -->
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="tag in it.tags.slice(0, 3)"
                  :key="tag.dir"
                  class="px-1.5 py-0.5 rounded bg-surface border border-outline-variant text-[10px] text-on-surface-variant"
                >
                  {{ tag.label }}
                </span>
              </div>

              <!-- 主色系圆点与时间 -->
              <div class="flex items-center justify-between pt-1 border-t border-outline-variant/30 text-[10px] text-outline">
                <div class="flex items-center gap-1.5">
                  <span v-if="it.dominant_color" class="px-1 py-0.2 rounded bg-surface border border-outline-variant/60 text-[9px] text-on-surface-variant font-medium">
                    {{ it.dominant_color }}
                  </span>
                  <div class="flex items-center gap-1">
                    <span
                      v-for="c in it.colors.slice(0, 3)"
                      :key="c.hex"
                      class="w-2 h-2 rounded-full border border-black/40 inline-block"
                      :style="{ backgroundColor: c.hex }"
                      :title="c.name"
                    ></span>
                  </div>
                  <span v-if="formatTime(it.created_at)" class="text-[10px] text-outline/80 font-mono">
                    {{ formatTime(it.created_at) }}
                  </span>
                </div>
                <span>{{ it.width && it.height ? `${it.width}×${it.height}` : it.orientation }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 紧凑平铺网格视图 -->
    <div v-else-if="items.length && viewMode === 'grid'" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      <div
        v-for="it in items"
        :key="it.fid"
        @click="openDetail(it.fid)"
        class="bg-surface-low border border-outline-variant rounded-2xl overflow-hidden cursor-pointer hover:border-primary hover:shadow-lg transition flex flex-col group"
      >
        <div class="relative aspect-[9/16] bg-surface overflow-hidden flex items-center justify-center">
          <img
            :src="api.imageUrl(it.fid, it.main_derivative_id)"
            :alt="it.file_name"
            loading="lazy"
            class="w-full h-full transition duration-300 group-hover:scale-105"
            :class="it.mainDerivative?.kind === 'restage_9_16' || it.origin_orientation === '9:16' ? 'object-cover' : 'object-contain'"
          />

          <div class="absolute top-2 left-2 flex flex-col gap-1 items-start">
            <span v-if="it.category === 'furniture'" class="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-600/90 backdrop-blur-sm text-white font-semibold border border-white/15">
              单品
            </span>
            <span v-if="it.dupCount > 1 && it.is_representative" class="text-[10px] px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-sm text-white font-semibold border border-white/15">
              主图
            </span>
            <span v-if="it.dupCount > 1" class="text-[10px] px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-sm text-white font-medium border border-white/10 flex items-center gap-0.5">
              <span class="material-symbols-outlined text-[11px]">collections</span>
              <span>{{ it.dup_group_id && it.dup_group_id.startsWith('video_') ? `多视角 ×${it.dupCount}` : `相似 ×${it.dupCount}` }}</span>
            </span>
            <span v-if="it.mainDerivative?.kind === 'restage_9_16'" class="text-[9px] px-1.5 py-0.5 rounded-full bg-violet/90 backdrop-blur-sm text-white font-semibold">
              9:16 生成
            </span>
            <span v-else-if="it.mainDerivative?.kind === 'restage_3_4'" class="text-[9px] px-1.5 py-0.5 rounded-full bg-violet/90 backdrop-blur-sm text-white font-semibold">
              3:4 生成
            </span>
            <span v-else-if="String(it.mainDerivative?.kind || '').startsWith('restage_')" class="text-[9px] px-1.5 py-0.5 rounded-full bg-violet/90 backdrop-blur-sm text-white font-semibold">
              AI 生成
            </span>
          </div>

          <div class="absolute top-2 right-2 flex flex-col gap-1 items-end">
            <span v-if="it.readyFlags?.length" class="text-[9px] px-1.5 py-0.5 rounded-md bg-tertiary-container/80 text-white font-medium" title="降级可用">
              标记
            </span>
            <span v-if="it.origin_orientation" class="text-[9px] px-1 rounded bg-black/50 text-on-surface-variant">
              {{ it.origin_orientation }}
            </span>
          </div>
        </div>

        <div class="p-2.5 flex-1 flex flex-col justify-between space-y-1.5">
          <p class="text-[11px] font-medium text-white truncate" :title="it.file_name">
            {{ it.file_name }}
          </p>

          <div class="flex flex-wrap gap-1">
            <span
              v-for="tag in it.tags.slice(0, 3)"
              :key="tag.dir"
              class="px-1.5 py-0.5 rounded bg-surface border border-outline-variant text-[10px] text-on-surface-variant"
            >
              {{ tag.label }}
            </span>
          </div>

          <div class="flex items-center justify-between pt-1 border-t border-outline-variant/30 text-[10px] text-outline">
            <div class="flex items-center gap-1.5">
              <span v-if="it.dominant_color" class="px-1 py-0.2 rounded bg-surface border border-outline-variant/60 text-[9px] text-on-surface-variant font-medium">
                {{ it.dominant_color }}
              </span>
              <div class="flex items-center gap-1">
                <span
                  v-for="c in it.colors.slice(0, 3)"
                  :key="c.hex"
                  class="w-2 h-2 rounded-full border border-black/40 inline-block"
                  :style="{ backgroundColor: c.hex }"
                  :title="c.name"
                ></span>
              </div>
              <span v-if="formatTime(it.created_at)" class="text-[10px] text-outline/80 font-mono">
                {{ formatTime(it.created_at) }}
              </span>
            </div>
            <span>{{ it.width && it.height ? `${it.width}×${it.height}` : it.orientation }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!loading && !items.length" class="text-center py-20 bg-surface-low border border-outline-variant rounded-2xl">
      <span class="material-symbols-outlined text-4xl text-outline mb-2">{{ loadError ? 'cloud_off' : 'image_not_supported' }}</span>
      <p class="text-xs text-on-surface-variant">{{ loadError || '没有匹配的设计素材，请尝试调整筛选条件' }}</p>
      <button
        v-if="loadError"
        @click="loadAssets(1)"
        class="mt-3 px-4 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold cursor-pointer"
      >
        重新加载
      </button>
    </div>

    <!-- 分页器 -->
    <div v-if="total > pageSize" class="flex items-center justify-between pt-4 border-t border-outline-variant text-xs text-on-surface-variant">
      <div>第 {{ page }} 页 / 共 {{ Math.ceil(total / pageSize) }} 页 ({{ total }} 条)</div>
      <div class="flex items-center gap-1">
        <button
          :disabled="page <= 1"
          @click="loadAssets(page - 1)"
          class="px-2.5 py-1 rounded-lg border border-outline-variant bg-surface hover:bg-surface-high disabled:opacity-40"
        >上一页</button>
        <button
          :disabled="page * pageSize >= total"
          @click="loadAssets(page + 1)"
          class="px-2.5 py-1 rounded-lg border border-outline-variant bg-surface hover:bg-surface-high disabled:opacity-40"
        >下一页</button>
      </div>
    </div>

    <!-- 资产详情弹窗 -->
    <DetailModal
      :visible="showDetailModal"
      :fid="selectedFid"
      @close="showDetailModal = false; selectedFid = ''"
      @select-asset="selectedFid = $event"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api, getCurrentUser } from '../api'
import DetailModal from '../components/DetailModal.vue'

const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(30)
const loading = ref(false)
const loadError = ref('')
const showAdvanced = ref(false)

const showDetailModal = ref(false)
const selectedFid = ref('')
const fileInput = ref(null)
const uploading = ref(false)
const uploadHint = ref('')
const isAdmin = computed(() => getCurrentUser()?.role === 'admin')

const options = ref({})
const viewMode = ref('timeline')

const selectedMaterials = ref([])

const HARD_MAT_SET = new Set([
  'oak', 'walnut', 'teak', 'light_wood', 'marble', 'travertine', 'terrazzo',
  'microcement', 'art_coating', 'lime_plaster', 'paint', 'sintered_stone',
  'tile', 'terracotta'
])

const hardMaterials = computed(() => (options.value?.material_kind || []).filter(m => m.group === 'hard'))
const softMaterials = computed(() => (options.value?.material_kind || []).filter(m => m.group === 'soft'))

function isHardMaterial(dir) {
  return HARD_MAT_SET.has(dir)
}

function materialLabel(dir) {
  const item = (options.value?.material_kind || []).find(m => m.dir === dir)
  return item?.label || dir
}

function onSelectMaterial(e) {
  const val = e.target.value
  if (val && !selectedMaterials.value.includes(val)) {
    selectedMaterials.value.push(val)
    loadAssets(1)
  }
  e.target.value = ''
}

function removeMaterial(mat) {
  selectedMaterials.value = selectedMaterials.value.filter(m => m !== mat)
  loadAssets(1)
}

function clearMaterials() {
  selectedMaterials.value = []
  loadAssets(1)
}

const filters = reactive({
  keyword: '',
  category: '',
  space: '',
  style: '',
  material: '',
  color_style: '',
  colors: '',
  orientation: '',
  flags: '',
  region: '',
  tone: '',
  view_composition: '',
  view_angle: '',
  lighting: '',
  // 单品专属
  furniture_category: '',
  furniture_item: '',
  furniture_craft: '',
  furniture_form: '',
  classic_design: '',
  sort: 'latest'
})

const categoryTabs = computed(() => {
  const cats = options.value?.categories || []
  const countOf = (key) => cats.find(c => c.dir === key)?.count
  return [
    { key: '', label: '全部素材', icon: 'apps' },
    { key: 'interior', label: '室内空间', icon: 'living', count: countOf('interior') },
    { key: 'furniture', label: '独立单品', icon: 'chair', count: countOf('furniture') },
    { key: 'material', label: '材质特写', icon: 'texture', count: countOf('material') }
  ]
})

function setCategory(catKey) {
  if (filters.category === catKey) return
  filters.category = catKey
  loadAssets(1)
}

const activeAdvancedCount = computed(() => {
  if (filters.category === 'furniture') {
    return [filters.furniture_craft, filters.furniture_form, filters.space, filters.flags].filter(Boolean).length
  }
  return [filters.tone, filters.region, filters.view_composition, filters.view_angle, filters.lighting, filters.flags].filter(Boolean).length
})

const hasActiveAdvanced = computed(() => activeAdvancedCount.value > 0)
const hasAnyFilter = computed(() => {
  return selectedMaterials.value.length > 0 || Object.entries(filters).some(([k, v]) => k !== 'sort' && !!v)
})

function formatGroupDate(ts) {
  if (!ts) return { key: 'unknown', label: '更早历史', sub: '' }
  const num = Number(ts) < 1e11 ? Number(ts) * 1000 : Number(ts)
  const d = new Date(num)
  if (isNaN(d.getTime())) return { key: 'unknown', label: '更早历史', sub: '' }

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const beforeYesterdayStart = todayStart - 86400000 * 2

  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const key = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const sub = `${y}年${m}月${day}日 · ${weekdays[d.getDay()]}`

  let label = ''
  if (num >= todayStart) {
    label = '今天'
  } else if (num >= yesterdayStart) {
    label = '昨天'
  } else if (num >= beforeYesterdayStart) {
    label = '前天'
  } else if (y === now.getFullYear()) {
    label = `${m}月${day}日`
  } else {
    label = `${y}年${m}月${day}日`
  }

  return { key, label, sub }
}

function formatTime(ts) {
  if (!ts) return ''
  const num = Number(ts) < 1e11 ? Number(ts) * 1000 : Number(ts)
  const d = new Date(num)
  if (isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

const dateGroups = computed(() => {
  if (!items.value.length) return []
  const groups = []
  const map = new Map()

  for (const it of items.value) {
    const info = formatGroupDate(it.created_at)
    if (!map.has(info.key)) {
      const grp = {
        key: info.key,
        label: info.label,
        sub: info.sub,
        items: []
      }
      map.set(info.key, grp)
      groups.push(grp)
    }
    map.get(info.key).items.push(it)
  }
  return groups
})

function setSort(s) {
  if (filters.sort === s) return
  filters.sort = s
  loadAssets(1)
}

async function loadAssets(p = 1) {
  loading.value = true
  page.value = p
  try {
    const queryPayload = {
      ...filters,
      page: p,
      pageSize: pageSize.value
    }
    if (selectedMaterials.value.length) {
      queryPayload.materials = selectedMaterials.value.join(',')
    }
    const res = await api.assets(queryPayload)
    items.value = res.items || []
    total.value = res.total || 0
    loadError.value = ''
    if (res.filterOptions) options.value = res.filterOptions
  } catch (e) {
    items.value = []
    total.value = 0
    loadError.value = '素材库服务连不上，库里素材还在。请确认本机 :30001 已启动后点重新加载。'
    console.error('获取素材列表失败:', e)
  } finally {
    loading.value = false
  }
}

function changePageSize(ps) {
  pageSize.value = ps
  page.value = 1
  loadAssets(1)
}

function resetFilters() {
  selectedMaterials.value = []
  Object.keys(filters).forEach(k => {
    if (k === 'sort') filters[k] = 'latest'
    else filters[k] = ''
  })
  loadAssets(1)
}

function openDetail(fid) {
  selectedFid.value = fid
  showDetailModal.value = true
}

async function onUploadFiles(ev) {
  const files = [...(ev.target.files || [])]
  if (!files.length) return
  uploading.value = true
  uploadHint.value = `正在上传 ${files.length} 张，完成后会备份到夸克…`
  let ok = 0
  let fail = 0
  let quarkOk = 0
  let quarkFail = 0
  for (const f of files) {
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('source', 'upload')
      const r = await api.ingest(fd)
      ok++
      if (r?.backup?.quark) quarkOk++
      else if (r?.backup?.quarkError) quarkFail++
    } catch (e) {
      fail++
      console.error(e)
    }
  }
  const bits = [`入库 ${ok} 张`]
  if (quarkOk) bits.push(`夸克已同步 ${quarkOk}`)
  if (quarkFail) bits.push(`夸克同步失败 ${quarkFail}`)
  if (fail) bits.push(`失败 ${fail}`)
  uploadHint.value = (fail && !ok ? '失败：' : '') + bits.join('，')
  uploading.value = false
  ev.target.value = ''
  if (ok) await loadAssets(1)
}

onMounted(() => {
  loadAssets(1)
})
</script>
