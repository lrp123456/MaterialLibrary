<template>
  <div class="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
    <!-- 顶部状态栏与控制中心 -->
    <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
      <div>
        <h1 class="text-sm font-bold text-white flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-base">tune</span>
          <span>AI 配置中心 (AI Configuration)</span>
        </h1>
        <p class="text-[11px] text-on-surface-variant mt-0.5">
          服务供应商与凭证槽治理 · 模型参数规范 · 精准编辑方案 (坐标/遮罩/文本) · 文档起草与 Skill 治理
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="showLiteLLM = !showLiteLLM"
          class="px-3 py-1.5 border rounded-xl text-xs font-medium transition flex items-center gap-1.5"
          :class="showLiteLLM ? 'bg-surface-high text-primary border-primary/50' : 'bg-surface border-outline-variant text-outline hover:text-white'"
          title="点击切换是否在界面中展示本地 LiteLLM 聚合网关"
        >
          <span class="material-symbols-outlined text-sm">settings_power</span>
          <span>{{ showLiteLLM ? '隐藏本地网关' : '显示本地网关 (LiteLLM)' }}</span>
        </button>

        <button
          v-if="showLiteLLM"
          @click="syncLiteLLM"
          :disabled="isSyncing"
          class="px-3 py-1.5 bg-surface border border-outline-variant hover:bg-surface-high text-white rounded-xl text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-50"
          title="从本地 LiteLLM 实例自动解析并同步所有模型与最新 Key"
        >
          <span class="material-symbols-outlined text-sm" :class="{ 'animate-spin': isSyncing }">sync</span>
          <span>{{ isSyncing ? '同步中...' : '从 LiteLLM 一键同步' }}</span>
        </button>

        <button
          v-if="activeTab === 'models'"
          @click="openCreateModelModal"
          class="px-3.5 py-1.5 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary/90 transition flex items-center gap-1.5 shadow-xs"
        >
          <span class="material-symbols-outlined text-sm">add</span>
          <span>添加新模型</span>
        </button>

        <button
          v-if="activeTab === 'providers'"
          @click="openCreateProviderModal"
          class="px-3.5 py-1.5 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary/90 transition flex items-center gap-1.5 shadow-xs"
        >
          <span class="material-symbols-outlined text-sm">add_business</span>
          <span>添加供应商</span>
        </button>

        <button
          v-if="activeTab === 'adapters'"
          @click="openCreateAdapterModal"
          class="px-3.5 py-1.5 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary/90 transition flex items-center gap-1.5 shadow-xs"
        >
          <span class="material-symbols-outlined text-sm">add_circle</span>
          <span>新增适配器</span>
        </button>
      </div>
    </div>

    <!-- LiteLLM 网关休眠/启用控制条 (显式入口) -->
    <div v-if="showLiteLLM" class="p-3 bg-surface-low border border-outline-variant/80 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-base">info</span>
        <div>
          <span class="font-bold text-white">LiteLLM 本地聚合网关状态: </span>
          <span :class="isLiteLLMEnabled ? 'text-primary font-semibold' : 'text-outline font-semibold'">
            {{ isLiteLLMEnabled ? '🟢 已启用 (就绪)' : '⏸️ 已暂停 (休眠中)' }}
          </span>
          <p class="text-[11px] text-on-surface-variant mt-0.5">
            当前无人值守工作流统一打标使用免费别名组 workflow_vision (17 Deployments 轮转)
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="!isLiteLLMEnabled"
          @click="toggleLiteLLM(true)"
          :disabled="isTogglingLiteLLM"
          class="px-3 py-1.5 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary/90 transition flex items-center gap-1 shadow-xs disabled:opacity-50"
        >
          <span class="material-symbols-outlined text-sm">play_circle</span>
          <span>一键恢复启用 LiteLLM</span>
        </button>
        <button
          v-else
          @click="toggleLiteLLM(false)"
          :disabled="isTogglingLiteLLM"
          class="px-3 py-1.5 bg-surface border border-outline-variant hover:bg-surface-high text-outline hover:text-white rounded-xl text-xs font-medium transition flex items-center gap-1 disabled:opacity-50"
        >
          <span class="material-symbols-outlined text-sm">pause_circle</span>
          <span>一键休眠暂停 LiteLLM</span>
        </button>
      </div>
    </div>

    <!-- Tab 导航切换 -->
    <div class="flex items-center justify-between border-b border-outline-variant pb-2">
      <div class="flex items-center gap-2 flex-wrap">
        <button
          @click="activeTab = 'models'"
          class="px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
          :class="activeTab === 'models' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">psychology</span>
          <span>模型管理与精准方案 ({{ filteredModels.length }})</span>
        </button>

        <button
          @click="activeTab = 'providers'"
          class="px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
          :class="activeTab === 'providers' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">hub</span>
          <span>供应商与凭证槽 ({{ filteredProviders.length }})</span>
        </button>

        <button
          @click="activeTab = 'skills'"
          class="px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
          :class="activeTab === 'skills' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">auto_stories</span>
          <span>文档起草与 Skill 治理 ({{ skillDraftsList.length }})</span>
        </button>

        <button
          @click="activeTab = 'adapters'"
          class="px-3.5 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
          :class="activeTab === 'adapters' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">tune</span>
          <span>生图/生视频引擎 ({{ filteredAdapters.length }})</span>
        </button>
      </div>

      <!-- 快速筛选 (仅在模型管理 Tab 显示) -->
      <div v-if="activeTab === 'models'" class="flex items-center gap-2">
        <select
          v-model="filterProvider"
          class="bg-surface border border-outline-variant rounded-xl px-2.5 py-1 text-xs text-white outline-none focus:border-primary"
        >
          <option value="">全部供应商</option>
          <option v-for="p in filteredProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
    </div>

    <!-- ================= TAB 1: 模型管理 (Models) ================= -->
    <div v-if="activeTab === 'models'" class="space-y-3">
      <!-- 能力胶囊筛选器 -->
      <div class="flex flex-wrap items-center gap-1.5 pb-1">
        <button
          v-for="cap in capabilityTabs"
          :key="cap.id"
          @click="filterCapability = cap.id"
          class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition"
          :class="filterCapability === cap.id ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-surface-low border border-outline-variant text-outline hover:text-white'"
        >
          {{ cap.label }}
        </button>
      </div>

      <!-- 模型网格 -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="m in filteredModels"
          :key="m.id"
          class="bg-surface-low border rounded-2xl p-4 space-y-3 transition relative group"
          :class="m.enabled ? 'border-outline-variant hover:border-primary/60' : 'border-outline-variant/40 opacity-60'"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-bold text-white text-xs truncate max-w-[170px]">{{ m.name }}</span>
                <span v-if="getModelRoleBadge(m)" class="px-1.5 py-0.2 rounded text-[9px]" :class="getModelRoleBadge(m).class">
                  {{ getModelRoleBadge(m).text }}
                </span>
                <span v-else-if="m.is_default" class="px-1.5 py-0.2 rounded bg-primary/20 text-primary text-[9px] font-medium">默认</span>
              </div>
              <p class="text-[10px] text-outline font-mono mt-0.5 truncate" :title="m.model_code">
                {{ m.model_code }}
              </p>
            </div>

            <label class="flex items-center gap-1 cursor-pointer text-xs flex-shrink-0">
              <input
                type="checkbox"
                :checked="m.enabled === 1"
                @change="toggleModel(m)"
                class="w-3.5 h-3.5 accent-primary cursor-pointer"
              />
            </label>
          </div>

          <div class="space-y-1.5 text-[11px] text-on-surface-variant">
            <p class="flex items-center gap-1 truncate">
              <span class="text-outline">所属供应商:</span>
              <span class="px-1.5 py-0.2 rounded bg-surface border border-outline-variant text-white text-[10px]">
                {{ m.provider_name || m.provider_id }}
              </span>
            </p>

            <!-- 精准编辑方案展示 -->
            <div v-if="m.caps?.includes('image')" class="flex items-center gap-1.5">
              <span class="text-outline">精准编辑:</span>
              <span class="px-1.5 py-0.5 rounded text-[10px] font-medium" :class="getRegionKindClass(m.region_kind || m.regionKind)">
                {{ formatRegionKind(m.region_kind || m.regionKind) }}
              </span>
            </div>

            <div class="flex items-center gap-1 flex-wrap">
              <span class="text-outline">能力:</span>
              <span
                v-for="c in m.caps"
                :key="c"
                class="px-1.5 py-0.2 rounded text-[9px]"
                :class="getCapBadgeClass(c)"
              >
                {{ formatCapLabel(c) }}
              </span>
            </div>
          </div>

          <!-- 操作行 -->
          <div class="pt-2 border-t border-outline-variant flex items-center justify-between text-xs">
            <button
              @click="openTestModal(m)"
              class="px-2.5 py-1 rounded-lg bg-surface border border-outline-variant hover:bg-surface-high text-[11px] text-white flex items-center gap-1 transition shadow-xs"
            >
              <span class="material-symbols-outlined text-xs text-primary">play_arrow</span>
              <span>即时测试</span>
            </button>

            <div class="flex items-center gap-2">
              <button
                @click="openEditModelModal(m)"
                class="text-outline hover:text-white text-[11px]"
              >
                编辑与参数
              </button>
              <button
                @click="deleteModel(m)"
                class="text-outline hover:text-error text-[11px]"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= TAB 2: 供应商与凭证槽 (Providers) ================= -->
    <div v-if="activeTab === 'providers'" class="space-y-3">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="p in filteredProviders"
          :key="p.id"
          class="bg-surface-low border rounded-2xl p-4 space-y-3 transition"
          :class="p.enabled ? 'border-outline-variant hover:border-primary/60' : 'border-outline-variant/40 opacity-60'"
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-bold text-white text-xs">{{ p.name }}</span>
                <span v-if="getProviderRoleBadge(p)" class="px-1.5 py-0.2 rounded text-[9px]" :class="getProviderRoleBadge(p).class">
                  {{ getProviderRoleBadge(p).text }}
                </span>
                <span v-else-if="['volcengine', 'agnes', 'modelscope'].includes(p.id)" class="px-1.5 py-0.2 rounded bg-secondary/20 text-secondary text-[9px] font-semibold">内置服务</span>
              </div>
              <p class="text-[10px] text-outline font-mono mt-0.5">{{ p.id }} · {{ p.protocol }}</p>
            </div>

            <label class="flex items-center gap-1 cursor-pointer text-xs">
              <input
                type="checkbox"
                :checked="p.enabled === 1"
                @change="toggleProvider(p)"
                class="w-3.5 h-3.5 accent-primary cursor-pointer"
              />
            </label>
          </div>

          <div class="space-y-2 text-[11px] text-on-surface-variant">
            <p class="truncate"><span class="text-outline">Base URL:</span> <span class="font-mono text-[10px]">{{ p.base_url || '(默认)' }}</span></p>

            <!-- 凭证槽展示 (Credential Slots) -->
            <div class="space-y-1 bg-surface p-2 rounded-xl border border-outline-variant">
              <div class="text-[10px] text-outline flex items-center justify-between font-medium">
                <span>凭证槽配置 (Credential Slots)</span>
                <span class="text-[9px] text-primary">{{ (p.slots || []).length }} 槽位</span>
              </div>
              <div v-for="slot in (p.slots || [])" :key="slot.id" class="flex items-center justify-between text-[10px] py-0.5">
                <span class="text-white flex items-center gap-1">
                  <span class="w-1.5 h-1.5 rounded-full" :class="slot.has_value ? 'bg-emerald-400' : 'bg-outline'"></span>
                  <span>{{ slot.name || slot.id }}</span>
                  <span class="text-outline text-[9px]">({{ slot.type }})</span>
                </span>
                <span class="font-mono text-outline truncate max-w-[120px]">{{ slot.value_masked || '未配置' }}</span>
              </div>
            </div>

            <p><span class="text-outline">可用模型:</span> <span class="text-white font-medium">{{ p.model_count }} 个模型</span></p>
          </div>

          <div class="pt-2 border-t border-outline-variant flex items-center justify-between text-xs">
            <button
              @click="filterByThisProvider(p.id)"
              class="text-primary hover:underline text-[11px] flex items-center gap-0.5"
            >
              <span>查看旗下模型</span>
              <span class="material-symbols-outlined text-xs">arrow_forward</span>
            </button>

            <div class="flex items-center gap-2">
              <button
                @click="openEditProviderModal(p)"
                class="text-outline hover:text-white text-[11px]"
              >
                配置凭据槽 →
              </button>
              <button
                v-if="!['litellm', 'volcengine', 'agnes', 'modelscope'].includes(p.id)"
                @click="deleteProvider(p)"
                class="text-outline hover:text-error text-[11px]"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= TAB 3: 文档起草与 Skill 治理 (Drafting & Skills) ================= -->
    <div v-if="activeTab === 'skills'" class="space-y-4">
      <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div>
          <h3 class="font-bold text-white flex items-center gap-1.5">
            <span class="material-symbols-outlined text-primary text-base">menu_book</span>
            <span>适配器草稿与 Skill 治理</span>
          </h3>
          <p class="text-[11px] text-on-surface-variant mt-0.5">
            适配器与数据由可选对话模型生成或手写起草，确认后写入当前进程加载；加载失败自动回滚
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            @click="openCreateAdapterModal('draft')"
            class="px-3.5 py-1.5 bg-primary text-white rounded-xl font-medium flex items-center gap-1 hover:bg-primary/90 transition shadow-xs"
          >
            <span class="material-symbols-outlined text-sm">terminal</span>
            <span>起草新适配器</span>
          </button>
          <button
            @click="showDraftModal = true"
            class="px-3.5 py-1.5 bg-surface border border-outline-variant text-white rounded-xl font-medium flex items-center gap-1 hover:bg-surface-high transition shadow-xs"
          >
            <span class="material-symbols-outlined text-sm">add_link</span>
            <span>输入文档起草 Skill</span>
          </button>
        </div>
      </div>

      <!-- 待审草稿列表 -->
      <div class="space-y-3">
        <h4 class="text-xs font-bold text-white flex items-center gap-1.5">
          <span>待审草稿箱 (Drafts)</span>
          <span class="text-[10px] text-outline font-normal">({{ skillDraftsList.length }} 份)</span>
        </h4>

        <div v-if="skillDraftsList.length === 0" class="text-center py-12 bg-surface-low rounded-2xl border border-outline-variant text-outline text-xs">
          暂无待审草稿。点击上方“起草新适配器”或“输入文档起草 Skill”，草稿确认前能看到方法、URL 与代码。
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            v-for="d in skillDraftsList"
            :key="d.id"
            class="bg-surface-low border border-outline-variant rounded-2xl p-4 space-y-3 text-xs flex flex-col justify-between"
          >
            <div class="space-y-2.5">
              <div class="flex items-start justify-between">
                <div>
                  <span class="font-bold text-white text-xs flex items-center gap-1.5 flex-wrap">
                    <span>{{ d.model_code }}</span>
                    <span v-if="d.schema_draft?.kind === 'adapter'" class="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[9px] font-bold">
                      适配器代码草稿
                    </span>
                    <span v-else-if="d.schema_draft?.kind === 'data'" class="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 text-[9px] font-bold">
                      数据配置草稿
                    </span>
                    <span v-else class="px-1.5 py-0.2 rounded bg-primary/20 text-primary text-[9px] font-bold">
                      Prompt Skill 草稿
                    </span>
                    <span class="px-1.5 py-0.2 rounded text-[9px]" :class="d.status === 'accepted' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'">
                      {{ d.status === 'accepted' ? '已采纳落地' : '待管理员确认' }}
                    </span>
                  </span>
                  <p class="text-[10px] text-outline mt-0.5">模态: {{ d.domain }} · 创建时间: {{ new Date(d.created_at).toLocaleString() }}</p>
                </div>
                <button
                  @click="deleteDraftItem(d.id)"
                  class="text-outline hover:text-red-400 text-xs transition"
                  title="删除草稿"
                >
                  <span class="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>

              <!-- 错误回滚提示 -->
              <div v-if="d.schema_draft?.error" class="p-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-[11px] space-y-0.5">
                <span class="font-bold flex items-center gap-1">
                  <span class="material-symbols-outlined text-sm">error</span>
                  <span>加载失败已安全回滚至上一版本，草稿保持待审：</span>
                </span>
                <p class="font-mono text-[10px] break-all">{{ d.schema_draft.error }}</p>
              </div>

              <!-- 适配器协议出口与参数位置信息 -->
              <div v-if="d.schema_draft?.kind === 'adapter'" class="p-2.5 rounded-xl bg-surface border border-outline-variant space-y-1">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] text-outline font-medium">适配器出口规格:</span>
                  <span class="font-mono text-primary text-[10px]">{{ d.schema_draft.protocol || d.model_code }}</span>
                </div>
                <p v-if="d.schema_draft.base_url" class="text-[10px] text-slate-300 font-mono truncate">
                  BaseUrl: {{ d.schema_draft.base_url }}
                </p>
                <div class="pt-1">
                  <div class="flex items-center justify-between text-[10px] text-outline mb-1">
                    <span>适配器 JavaScript 源码 (可手改):</span>
                    <button
                      v-if="d.status !== 'accepted'"
                      @click="saveDraftCode(d)"
                      class="text-primary hover:underline text-[10px]"
                    >
                      保存修改
                    </button>
                  </div>
                  <textarea
                    v-model="d.skill_content"
                    :disabled="d.status === 'accepted'"
                    rows="8"
                    class="w-full bg-studio-950 border border-outline-variant rounded-lg p-2 text-[10px] text-white font-mono outline-none focus:border-primary disabled:opacity-70 leading-relaxed"
                  ></textarea>
                </div>
              </div>

              <!-- 提示词草稿预览 (非适配器) -->
              <div v-else-if="d.polish_draft" class="p-2.5 rounded-xl bg-surface border border-outline-variant space-y-1">
                <span class="text-[10px] text-outline font-medium">起草优化指南 (Polish Draft):</span>
                <p class="text-[11px] text-white whitespace-pre-wrap max-h-24 overflow-y-auto leading-relaxed font-mono">
                  {{ d.polish_draft }}
                </p>
              </div>
            </div>

            <!-- 操作按钮与沙箱声明 -->
            <div class="pt-2 border-t border-outline-variant flex flex-col gap-2">
              <div v-if="d.schema_draft?.kind === 'adapter' && d.status !== 'accepted'" class="text-[11px] text-amber-400 flex items-center gap-1 font-medium bg-amber-400/10 px-2 py-1 rounded-lg border border-amber-400/20">
                <span class="material-symbols-outlined text-sm">warning</span>
                <span>加载成功的代码与当前服务权限相同，无沙箱</span>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-[10px] text-outline">草稿 ID: {{ d.id }}</span>
                <button
                  v-if="d.status !== 'accepted'"
                  @click="acceptDraft(d.id, d.schema_draft?.kind)"
                  class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition shadow-xs flex items-center gap-1"
                >
                  <span class="material-symbols-outlined text-xs">check_circle</span>
                  <span>{{ d.schema_draft?.kind === 'adapter' ? '确认并加载适配器' : '确认并生效' }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= TAB 4: 传统引擎兼容与协议出口 (Adapters) ================= -->
    <div v-if="activeTab === 'adapters'" class="space-y-3">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="adp in filteredAdapters"
          :key="adp.id"
          class="bg-surface-low border rounded-2xl p-4 space-y-3 transition flex flex-col justify-between"
          :class="adp.enabled ? 'border-outline-variant hover:border-primary/60' : 'border-outline-variant/40 opacity-60'"
        >
          <div class="space-y-2.5">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-bold text-white text-xs">{{ adp.label }}</span>
                  <span v-if="adp.builtin" class="px-1.5 py-0.2 rounded bg-surface-high text-outline text-[9px]">内置</span>
                  <span v-else class="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[9px]">自定义</span>
                </div>
                <p class="text-[10px] text-outline font-mono mt-0.5">{{ adp.id }}</p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  v-if="!adp.builtin"
                  @click="deleteAdapterItem(adp)"
                  class="text-outline hover:text-red-400 text-xs transition"
                  title="删除适配器"
                >
                  <span class="material-symbols-outlined text-sm">delete</span>
                </button>
                <label class="flex items-center gap-1 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    :checked="adp.enabled === 1"
                    @change="toggleAdapter(adp)"
                    class="w-3.5 h-3.5 accent-primary cursor-pointer"
                  />
                </label>
              </div>
            </div>

            <div class="space-y-1.5 text-[11px] text-on-surface-variant">
              <p><span class="text-outline">模态:</span> {{ adp.kind === 'video' ? '🎬 生视频' : adp.kind === 'music' ? '🎵 AI音乐' : (adp.kind === 'chat' ? '💬 对话' : '🎨 生图') }}</p>
              <p><span class="text-outline">协议:</span> <span class="font-mono text-primary font-bold">{{ adp.protocol }}</span></p>
              <p class="truncate"><span class="text-outline">BaseUrl:</span> <span class="font-mono text-slate-300">{{ adp.base_url || '(默认网关)' }}</span></p>
              <p v-if="adp.method || adp.urlTemplate" class="text-[10px] flex items-center gap-1 truncate">
                <span class="px-1.5 py-0.2 rounded bg-surface border border-outline-variant text-amber-300 font-mono font-bold">{{ adp.method || 'POST' }}</span>
                <span class="font-mono text-slate-400 truncate">{{ adp.urlTemplate }}</span>
              </p>
              <!-- 参数落点 -->
              <div v-if="adp.paramLocations && Object.keys(adp.paramLocations).length" class="p-2 rounded-xl bg-surface border border-outline-variant space-y-0.5 text-[10px]">
                <span class="text-outline font-medium block">参数落点 (只读清单):</span>
                <div v-for="(loc, key) in adp.paramLocations" :key="key" class="font-mono flex justify-between text-slate-300">
                  <span class="text-slate-400">{{ key }}:</span>
                  <span class="text-slate-200">{{ loc }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 密钥状态 -->
          <div class="pt-2 border-t border-outline-variant text-[10px] flex items-center justify-between">
            <span v-if="adp.hasKey" class="text-emerald-400 font-mono flex items-center gap-1">
              <span class="material-symbols-outlined text-xs">vpn_key</span>
              <span>独立密钥: {{ adp.maskedKey }} (优先生效)</span>
            </span>
            <span v-else class="text-outline flex items-center gap-1">
              <span class="material-symbols-outlined text-xs">key_off</span>
              <span>厂商默认密钥</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗: 文档起草新 Skill ================= -->
    <div v-if="showDraftModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="showDraftModal = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 text-xs">
        <div class="flex items-center justify-between pb-2 border-b border-outline-variant">
          <h3 class="text-sm font-bold text-white">从官方/第三方文档起草模型规范与 Skill</h3>
          <button @click="showDraftModal = false" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-outline mb-1">模型代码 (model_code) *</label>
            <input v-model="draftForm.modelCode" type="text" placeholder="例如: doubao-seedream-5-0-flash-260915" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-[11px] text-outline mb-1">模型展示名称</label>
            <input v-model="draftForm.modelName" type="text" placeholder="例如: Seedream 5.0 Flash 最新版" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-[11px] text-outline mb-1">所属模态域 *</label>
            <select v-model="draftForm.domain" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-2 text-xs text-white outline-none focus:border-primary">
              <option value="image">图像生成 (Image)</option>
              <option value="video">视频生成 (Video)</option>
              <option value="music">音乐生成 (Music)</option>
              <option value="chat">对话理解 (Chat)</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] text-outline mb-1">文档 URL (每行一个，或逗号分隔)</label>
            <textarea v-model="draftForm.docUrlsStr" rows="3" placeholder="https://www.volcengine.com/docs/..." class="w-full bg-surface border border-outline-variant rounded-xl p-2.5 text-xs text-white font-mono outline-none focus:border-primary"></textarea>
          </div>
          <div>
            <label class="block text-[11px] text-outline mb-1">附加业务要求/特有要求 (可选)</label>
            <input v-model="draftForm.promptNotes" type="text" placeholder="例如: 必须严格遵循室内空间透视，首尾帧保持色调一致" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary" />
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-outline-variant">
          <button @click="showDraftModal = false" class="px-4 py-2 rounded-xl bg-surface border border-outline-variant text-on-surface-variant hover:bg-surface-high">取消</button>
          <button @click="submitDraft" :disabled="isDrafting" class="px-5 py-2 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 flex items-center gap-1.5 disabled:opacity-50">
            <span v-if="isDrafting" class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
            <span>{{ isDrafting ? '大模型深度解析中...' : '发起文档起草' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗: 编辑模型弹窗 ================= -->
    <div v-if="modelModalOpen" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="modelModalOpen = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-2 border-b border-outline-variant">
          <h3 class="text-sm font-bold text-white">{{ modelForm.id ? '编辑模型' : '添加新模型' }}</h3>
          <button @click="modelModalOpen = false" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-outline mb-1">所属供应商 *</label>
            <select v-model="modelForm.provider_id" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-2 text-xs text-white outline-none focus:border-primary">
              <option v-for="p in providersList" :key="p.id" :value="p.id">{{ p.name }} ({{ p.id }})</option>
            </select>
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">模型展示名称 *</label>
            <input v-model="modelForm.name" type="text" placeholder="例如: 豆包 2.0 Pro 视觉版" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary" />
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">API 真实模型代码 (model_code) *</label>
            <input v-model="modelForm.model_code" type="text" placeholder="例如: doubao-seed-2-0-pro-260215" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary font-mono" />
          </div>

          <!-- 精准编辑方案单选 (三大类) -->
          <div class="bg-surface p-3 rounded-xl border border-outline-variant space-y-1.5">
            <label class="block text-[11px] text-white font-medium">精准编辑方案 (针对图像与精准修图)</label>
            <div class="grid grid-cols-3 gap-2">
              <label class="flex items-center gap-1.5 p-2 rounded-lg border text-xs cursor-pointer" :class="modelForm.region_kind === 'coords_bbox' ? 'border-primary bg-primary/10 text-white' : 'border-outline-variant text-outline'">
                <input type="radio" value="coords_bbox" v-model="modelForm.region_kind" class="accent-primary" />
                <span>坐标框/点 (bbox)</span>
              </label>
              <label class="flex items-center gap-1.5 p-2 rounded-lg border text-xs cursor-pointer" :class="modelForm.region_kind === 'mask' ? 'border-primary bg-primary/10 text-white' : 'border-outline-variant text-outline'">
                <input type="radio" value="mask" v-model="modelForm.region_kind" class="accent-primary" />
                <span>遮罩图 (mask)</span>
              </label>
              <label class="flex items-center gap-1.5 p-2 rounded-lg border text-xs cursor-pointer" :class="modelForm.region_kind === 'vlm_text' ? 'border-primary bg-primary/10 text-white' : 'border-outline-variant text-outline'">
                <input type="radio" value="vlm_text" v-model="modelForm.region_kind" class="accent-primary" />
                <span>纯文本描述 (text)</span>
              </label>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">模型能力 (可多选)</label>
            <div class="flex flex-wrap gap-2">
              <label v-for="cap in allCaps" :key="cap.val" class="flex items-center gap-1 text-xs cursor-pointer">
                <input type="checkbox" :value="cap.val" v-model="modelFormCaps" class="accent-primary" />
                <span>{{ cap.label }}</span>
              </label>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">默认参数配置 (JSON)</label>
            <textarea v-model="modelFormParamsStr" rows="3" class="w-full bg-surface border border-outline-variant rounded-xl p-2.5 text-xs text-white font-mono outline-none focus:border-primary"></textarea>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-outline-variant">
          <button @click="modelModalOpen = false" class="px-4 py-2 rounded-xl bg-surface border border-outline-variant text-on-surface-variant hover:bg-surface-high">取消</button>
          <button @click="saveModelForm" class="px-5 py-2 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90">保存模型</button>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗: 编辑供应商弹窗 ================= -->
    <div v-if="providerModalOpen" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="providerModalOpen = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-2 border-b border-outline-variant">
          <h3 class="text-sm font-bold text-white">{{ providerForm.isEdit ? '编辑供应商与凭证槽' : '添加新供应商' }}</h3>
          <button @click="providerModalOpen = false" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-outline mb-1">供应商标识 (ID) *</label>
            <input v-model="providerForm.id" :disabled="providerForm.isEdit" type="text" placeholder="例如: deepseek, siliconflow" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary font-mono disabled:opacity-60" />
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">供应商展示名称 *</label>
            <input v-model="providerForm.name" type="text" placeholder="例如: 火山引擎方舟" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary" />
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">服务 Base URL</label>
            <input v-model="providerForm.base_url" type="text" placeholder="例如: https://ark.cn-beijing.volces.com/api/v3" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary font-mono" />
          </div>

          <!-- 凭证槽配置列表 -->
          <div class="space-y-2 bg-surface p-3 rounded-xl border border-outline-variant">
            <div class="flex items-center justify-between">
              <label class="text-[11px] text-white font-medium">凭证槽位 (Credential Slots)</label>
              <button @click="addCredentialSlot" class="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                <span class="material-symbols-outlined text-xs">add</span>
                <span>添加槽位</span>
              </button>
            </div>

            <div v-for="(slot, idx) in providerSlots" :key="idx" class="p-2.5 rounded-lg bg-surface-low border border-outline-variant space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-outline font-mono">槽位 #{{ idx + 1 }}</span>
                <button @click="removeCredentialSlot(idx)" class="text-error text-xs hover:text-red-400">×</button>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="text-[10px] text-outline block">槽位类型</label>
                  <select v-model="slot.type" class="w-full bg-surface border border-outline-variant rounded px-2 py-1 text-white">
                    <option value="bearer">Bearer API Key</option>
                    <option value="aksk">成对 AK/SK</option>
                    <option value="env">环境变量引用</option>
                  </select>
                </div>
                <div>
                  <label class="text-[10px] text-outline block">槽位名称</label>
                  <input v-model="slot.name" class="w-full bg-surface border border-outline-variant rounded px-2 py-1 text-white" placeholder="如 方舟大模型Key" />
                </div>
              </div>
              <div v-if="slot.type === 'bearer'">
                <label class="text-[10px] text-outline block">API Key 字符串</label>
                <input v-model="slot.value" type="password" class="w-full bg-surface border border-outline-variant rounded px-2 py-1 text-white font-mono" placeholder="留空则保持现有" />
              </div>
              <div v-if="slot.type === 'aksk'" class="grid grid-cols-2 gap-2">
                <div>
                  <label class="text-[10px] text-outline block">AccessKey (AK)</label>
                  <input v-model="slot.ak" class="w-full bg-surface border border-outline-variant rounded px-2 py-1 text-white font-mono" />
                </div>
                <div>
                  <label class="text-[10px] text-outline block">SecretKey (SK)</label>
                  <input v-model="slot.sk" type="password" class="w-full bg-surface border border-outline-variant rounded px-2 py-1 text-white font-mono" />
                </div>
              </div>
              <div>
                <label class="text-[10px] text-outline block">关联环境变量名 (如 ARK_API_KEY)</label>
                <input v-model="slot.env_var" class="w-full bg-surface border border-outline-variant rounded px-2 py-1 text-white font-mono" placeholder="环境变量引用" />
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-outline-variant">
          <button @click="providerModalOpen = false" class="px-4 py-2 rounded-xl bg-surface border border-outline-variant text-on-surface-variant hover:bg-surface-high">取消</button>
          <button @click="saveProviderForm" class="px-5 py-2 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90">保存配置</button>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗: 新增适配器 (双通道: 已有协议 / 对话起草新协议) ================= -->
    <div v-if="adapterModalOpen" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="adapterModalOpen = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-xl w-full p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-2 border-b border-outline-variant">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-primary text-base">tune</span>
            <h3 class="text-sm font-bold text-white">新增生成适配器</h3>
          </div>
          <button @click="adapterModalOpen = false" class="text-outline hover:text-white">
            <span class="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        <!-- 两种通道切换 -->
        <div class="flex border-b border-outline-variant text-xs">
          <button
            @click="adapterModalTab = 'existing'"
            class="px-4 py-2 font-medium border-b-2 transition"
            :class="adapterModalTab === 'existing' ? 'border-primary text-primary font-bold' : 'border-transparent text-outline hover:text-white'"
          >
            通道一：已有协议登记 (表单填报)
          </button>
          <button
            @click="adapterModalTab = 'draft'"
            class="px-4 py-2 font-medium border-b-2 transition"
            :class="adapterModalTab === 'draft' ? 'border-primary text-primary font-bold' : 'border-transparent text-outline hover:text-white'"
          >
            通道二：对话/手写起草新协议文件
          </button>
        </div>

        <!-- 通道一: 已有协议登记 -->
        <div v-if="adapterModalTab === 'existing'" class="space-y-3">
          <div class="p-2.5 rounded-xl bg-surface border border-outline-variant text-[11px] text-slate-300">
            从已实现的内置与加载协议清单中选择，系统自动匹配请求方法、URL 模板与参数落点。
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">选择已实现协议 *</label>
            <select
              v-model="adapterForm.protocol"
              class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-2 text-xs text-white outline-none focus:border-primary font-mono"
            >
              <option v-for="m in manifestsList" :key="m.protocol" :value="m.protocol">
                {{ m.name || m.protocol }} ({{ m.protocol }})
              </option>
            </select>
          </div>

          <!-- 协议清单只读展示 (方法、URL 模板、参数落点) -->
          <div v-if="selectedManifest" class="p-3 rounded-xl bg-surface border border-outline-variant space-y-1.5 text-[11px]">
            <div class="flex items-center gap-2">
              <span class="text-outline">请求方法:</span>
              <span class="px-1.5 py-0.2 rounded bg-surface-high border border-outline-variant text-amber-300 font-mono font-bold">{{ selectedManifest.method || 'POST' }}</span>
            </div>
            <div>
              <span class="text-outline">URL 模板:</span>
              <span class="font-mono text-slate-300 ml-1.5">{{ selectedManifest.urlTemplate }}</span>
            </div>
            <div v-if="selectedManifest.paramLocations" class="pt-1">
              <span class="text-outline block mb-0.5">参数落点:</span>
              <div class="p-2 rounded bg-surface-low border border-outline-variant font-mono text-[10px] space-y-0.5">
                <div v-for="(loc, k) in selectedManifest.paramLocations" :key="k" class="flex justify-between">
                  <span class="text-slate-400">{{ k }}:</span>
                  <span class="text-slate-200">{{ loc }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[11px] text-outline mb-1">适配器标识 (ID) *</label>
              <input v-model="adapterForm.id" type="text" placeholder="例如: ark_seedream_v2" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-[11px] text-outline mb-1">目标模态 *</label>
              <select v-model="adapterForm.kind" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-2 text-xs text-white outline-none focus:border-primary">
                <option value="image">生图 (image)</option>
                <option value="video">生视频 (video)</option>
                <option value="music">AI音乐 (music)</option>
                <option value="chat">对话 (chat)</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">展示名称 (Label) *</label>
            <input v-model="adapterForm.label" type="text" placeholder="例如: 火山方舟 Seedream 自定义适配" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary" />
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">接口地址 (Base URL)</label>
            <input v-model="adapterForm.base_url" type="text" placeholder="例如: https://ark.cn-beijing.volces.com/api/v3" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary font-mono" />
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-[11px] text-outline">独立 API 密钥 (apiKey)</label>
              <span class="text-[10px] text-emerald-400 font-medium">密钥仅保存在适配器上，优先生效</span>
            </div>
            <input v-model="adapterForm.apiKey" type="password" placeholder="留空则读取供应商默认凭证槽" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary font-mono" />
          </div>

          <div class="flex justify-end gap-2 pt-2 border-t border-outline-variant">
            <button @click="adapterModalOpen = false" class="px-4 py-2 rounded-xl bg-surface border border-outline-variant text-on-surface-variant hover:bg-surface-high">取消</button>
            <button @click="saveAdapterForm" class="px-5 py-2 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90">保存适配器</button>
          </div>
        </div>

        <!-- 通道二: 对话/手写起草新协议文件 -->
        <div v-else class="space-y-3">
          <div class="p-2.5 rounded-xl bg-surface border border-outline-variant text-[11px] text-slate-300">
            对话只生成草稿；草稿仅保存在待审箱中。管理员确认后才写入 <span class="font-mono text-primary">src/gen/adapters/</span> 并即时安全加载。
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[11px] text-outline mb-1">新协议标识 (protocol) *</label>
              <input v-model="adapterDraftForm.protocol" type="text" placeholder="例如: comfyui_txt2img" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-[11px] text-outline mb-1">目标模态 *</label>
              <select v-model="adapterDraftForm.domain" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-2 text-xs text-white outline-none focus:border-primary">
                <option value="image">生图 (image)</option>
                <option value="video">生视频 (video)</option>
                <option value="music">AI音乐 (music)</option>
                <option value="chat">对话 (chat)</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">适配器名称 *</label>
            <input v-model="adapterDraftForm.label" type="text" placeholder="例如: ComfyUI 本地生图节点适配" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary" />
          </div>

          <div>
            <label class="block text-[11px] text-outline mb-1">对话起草模型 (可选)</label>
            <select v-model="adapterDraftForm.dialogueModel" class="w-full bg-surface border border-outline-variant rounded-xl px-2.5 py-2 text-xs text-white outline-none focus:border-primary">
              <option value="">不选对话模型 (直接生成固定出口模板手动编写)</option>
              <option v-for="m in chatModelsAvailable" :key="m.id" :value="m.model_code || m.id">
                {{ m.name }} ({{ m.model_code }})
              </option>
            </select>
          </div>

          <div v-if="adapterDraftForm.dialogueModel">
            <label class="block text-[11px] text-outline mb-1">接口说明或起草提示词 *</label>
            <textarea
              v-model="adapterDraftForm.prompt"
              rows="4"
              placeholder="例如: 请帮我编写一个调用本地 ComfyUI API 的适配器，POST http://127.0.0.1:8188/prompt，接收 prompt 字段，解析 prompt_id..."
              class="w-full bg-surface border border-outline-variant rounded-xl p-2.5 text-xs text-white outline-none focus:border-primary leading-relaxed"
            ></textarea>
          </div>

          <div class="flex justify-end gap-2 pt-2 border-t border-outline-variant">
            <button @click="adapterModalOpen = false" class="px-4 py-2 rounded-xl bg-surface border border-outline-variant text-on-surface-variant hover:bg-surface-high">取消</button>
            <button
              @click="submitAdapterDraft"
              :disabled="adapterDraftForm.isDrafting"
              class="px-5 py-2 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 flex items-center gap-1 disabled:opacity-50"
            >
              <span v-if="adapterDraftForm.isDrafting" class="material-symbols-outlined text-sm animate-spin">sync</span>
              <span>{{ adapterDraftForm.isDrafting ? '起草中...' : '生成适配器草稿' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api } from '../api'

const activeTab = ref('models')
const isSyncing = ref(false)

const modelsList = ref([])
const providersList = ref([])
const adaptersList = ref([])
const skillDraftsList = ref([])

const filterProvider = ref('')
const filterCapability = ref('all')

const showLiteLLM = ref(false)
const isTogglingLiteLLM = ref(false)

// 弹窗状态
const modelModalOpen = ref(false)
const providerModalOpen = ref(false)
const showDraftModal = ref(false)
const isDrafting = ref(false)

const manifestsList = ref([])
const adapterModalOpen = ref(false)
const adapterModalTab = ref('existing')
const adapterForm = reactive({
  id: '',
  label: '',
  kind: 'image',
  protocol: '',
  base_url: '',
  apiKey: ''
})
const adapterDraftForm = reactive({
  id: '',
  protocol: '',
  label: '',
  domain: 'image',
  dialogueModel: '',
  prompt: '',
  isDrafting: false
})
const selectedManifest = computed(() => {
  return manifestsList.value.find(m => m.protocol === adapterForm.protocol) || null
})
const chatModelsAvailable = computed(() => {
  return modelsList.value.filter(m => (m.capabilities?.includes('chat') || m.domain === 'chat') && m.enabled)
})

const modelForm = reactive({
  id: '',
  provider_id: '',
  name: '',
  model_code: '',
  region_kind: 'coords_bbox',
  is_default: false,
})
const modelFormCaps = ref([])
const modelFormParamsStr = ref('{}')

const providerForm = reactive({
  id: '',
  name: '',
  base_url: '',
  api_key: '',
  protocol: 'openai',
  isEdit: false
})
const providerSlots = ref([])

const draftForm = reactive({
  modelCode: '',
  modelName: '',
  domain: 'image',
  docUrlsStr: '',
  promptNotes: ''
})

const capabilityTabs = [
  { id: 'all', label: '全部能力' },
  { id: 'vision', label: '视觉理解 (Vision)' },
  { id: 'tag', label: '维度打标 (Tag)' },
  { id: 'chat', label: '文本对话 (Chat)' },
  { id: 'image', label: '图像生成 (Image)' },
  { id: 'video', label: '视频生成 (Video)' }
]

const allCaps = [
  { val: 'vision', label: '视觉理解 (Vision)' },
  { val: 'tag', label: '维度打标 (Tag)' },
  { val: 'chat', label: '文本分析 (Chat)' },
  { val: 'image', label: '图像生成 (Image)' },
  { val: 'video', label: '视频生成 (Video)' }
]

const isLiteLLMEnabled = computed(() => {
  const p = providersList.value.find(x => x.id === 'litellm')
  return p ? p.enabled === 1 : false
})

const filteredProviders = computed(() => {
  return providersList.value.filter(p => {
    if (!showLiteLLM.value && p.id === 'litellm') return false
    return true
  })
})

const filteredModels = computed(() => {
  return modelsList.value.filter(m => {
    if (!showLiteLLM.value && m.provider_id === 'litellm') return false
    if (filterProvider.value && m.provider_id !== filterProvider.value) return false
    if (filterCapability.value !== 'all') {
      if (!m.capabilities || !m.capabilities.includes(filterCapability.value)) return false
    }
    return true
  })
})

const filteredAdapters = computed(() => {
  return adaptersList.value.filter(a => {
    if (!showLiteLLM.value && (a.id === 'litellm_images' || a.id === 'openai_videos')) return false
    return true
  })
})

function formatRegionKind(kind) {
  if (kind === 'coords_bbox' || kind === 'coords_point') return '📐 坐标矩形/点'
  if (kind === 'mask') return '🎭 遮罩图 (Mask)'
  if (kind === 'vlm_text') return '📝 纯视觉描述'
  return '📐 坐标矩形/点'
}

function getRegionKindClass(kind) {
  if (kind === 'mask') return 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
  if (kind === 'vlm_text') return 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
  return 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
}

function getModelRoleBadge(m) {
  if (m.model_code === 'doubao-seedream-5-0-flash-260915') {
    return { text: '🎨 主力生图 (Flash)', class: 'bg-primary/20 text-primary border border-primary/40 font-bold' }
  }
  if (m.model_code === 'workflow_vision') {
    return { text: '🏆 免费视觉池 (17 Deploy)', class: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold' }
  }
  return null
}

function getProviderRoleBadge(p) {
  if (p.id === 'volcengine') return { text: '火山方舟主力', class: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-bold' }
  if (p.id === 'agnes') return { text: 'Agnes AI 创意', class: 'bg-primary/20 text-primary border border-primary/40 font-bold' }
  if (p.id === 'gemini') return { text: 'Gemini 对话主力', class: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold' }
  return null
}

function formatCapLabel(cap) {
  const map = { vision: '视觉理解', tag: '维度打标', chat: '文本分析', image: '室内生图', video: '视频漫游' }
  return map[cap] || cap
}

function getCapBadgeClass(cap) {
  switch (cap) {
    case 'vision':
    case 'tag':
      return 'bg-secondary/20 text-secondary border border-secondary/30'
    case 'image':
      return 'bg-primary/20 text-primary border border-primary/30 font-semibold'
    case 'video':
      return 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
    default:
      return 'bg-surface border border-outline-variant text-outline'
  }
}

async function loadAllData() {
  try {
    const [pRes, mRes, aRes, dRes] = await Promise.all([
      api.providers(),
      api.models(),
      api.adapters(),
      api.skillDrafts().catch(() => [])
    ])
    providersList.value = Array.isArray(pRes) ? pRes : (pRes?.data || [])
    modelsList.value = Array.isArray(mRes) ? mRes : (mRes?.data || [])
    adaptersList.value = Array.isArray(aRes) ? aRes : (aRes?.data || [])
    manifestsList.value = Array.isArray(aRes?.manifests) ? aRes.manifests : []
    skillDraftsList.value = Array.isArray(dRes) ? dRes : (dRes?.data || [])
  } catch (e) {
    console.error('加载数据失败:', e)
  }
}

function openCreateModelModal() {
  modelForm.id = ''
  modelForm.provider_id = providersList.value[0]?.id || 'volcengine'
  modelForm.name = ''
  modelForm.model_code = ''
  modelForm.region_kind = 'coords_bbox'
  modelForm.is_default = false
  modelFormCaps.value = ['image']
  modelFormParamsStr.value = '{"size": "1024x1024"}'
  modelModalOpen.value = true
}

function openEditModelModal(m) {
  modelForm.id = m.id
  modelForm.provider_id = m.provider_id
  modelForm.name = m.name
  modelForm.model_code = m.model_code
  modelForm.region_kind = m.region_kind || m.regionKind || 'coords_bbox'
  modelForm.is_default = Boolean(m.is_default)
  modelFormCaps.value = [...(m.caps || [])]
  modelFormParamsStr.value = JSON.stringify(m.params || {}, null, 2)
  modelModalOpen.value = true
}

async function saveModelForm() {
  try {
    let pObj = {}
    try { pObj = JSON.parse(modelFormParamsStr.value) } catch { pObj = {} }
    pObj.region_kind = modelForm.region_kind

    await api.saveModel({
      id: modelForm.id || undefined,
      provider_id: modelForm.provider_id,
      name: modelForm.name,
      model_code: modelForm.model_code,
      capabilities: modelFormCaps.value,
      region_kind: modelForm.region_kind,
      params_json: pObj,
      is_default: modelForm.is_default
    })
    modelModalOpen.value = false
    await loadAllData()
  } catch (err) {
    alert(`保存失败: ${err.message || err}`)
  }
}

async function toggleModel(m) {
  try {
    await api.toggleModel(m.id, m.enabled ? 0 : 1)
    await loadAllData()
  } catch (err) {
    alert(`更新状态失败: ${err.message || err}`)
  }
}

async function deleteModel(m) {
  if (!confirm(`确认删除模型 [${m.name}]？若存在关联 Skill 将被软删除归档`)) return
  try {
    await api.deleteModel(m.id)
    await loadAllData()
  } catch (err) {
    alert(`删除失败: ${err.message || err}`)
  }
}

function openCreateProviderModal() {
  providerForm.id = ''
  providerForm.name = ''
  providerForm.base_url = ''
  providerForm.protocol = 'openai'
  providerForm.isEdit = false
  providerSlots.value = [
    { type: 'bearer', name: '主 API Key', value: '', env_var: '' }
  ]
  providerModalOpen.value = true
}

function openEditProviderModal(p) {
  providerForm.id = p.id
  providerForm.name = p.name
  providerForm.base_url = p.base_url
  providerForm.protocol = p.protocol || 'openai'
  providerForm.isEdit = true
  providerSlots.value = (p.slots || []).map(s => ({ ...s }))
  providerModalOpen.value = true
}

function addCredentialSlot() {
  providerSlots.value.push({ type: 'bearer', name: '新凭证槽', value: '', env_var: '' })
}

function removeCredentialSlot(idx) {
  providerSlots.value.splice(idx, 1)
}

async function saveProviderForm() {
  try {
    await api.saveProvider({
      id: providerForm.id,
      name: providerForm.name,
      base_url: providerForm.base_url,
      protocol: providerForm.protocol,
      slots: providerSlots.value
    })
    providerModalOpen.value = false
    await loadAllData()
  } catch (err) {
    alert(`保存供应商失败: ${err.message || err}`)
  }
}

async function submitDraft() {
  if (!draftForm.modelCode) return alert('请输入真实模型代码')
  isDrafting.value = true
  try {
    const urls = draftForm.docUrlsStr.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    await api.draftSkillFromDocs({
      model_code: draftForm.modelCode,
      model_name: draftForm.modelName,
      domain: draftForm.domain,
      doc_urls: urls,
      prompt_notes: draftForm.promptNotes
    })
    showDraftModal.value = false
    alert('文档解析与起草完成！草稿已进入待审箱。')
    await loadAllData()
  } catch (err) {
    alert(`起草失败: ${err.message || err}`)
  } finally {
    isDrafting.value = false
  }
}

function openCreateAdapterModal(mode = 'existing') {
  adapterModalTab.value = mode
  adapterForm.id = ''
  adapterForm.label = ''
  adapterForm.kind = 'image'
  adapterForm.protocol = manifestsList.value[0]?.protocol || 'http_json'
  adapterForm.base_url = ''
  adapterForm.apiKey = ''
  adapterDraftForm.id = ''
  adapterDraftForm.protocol = ''
  adapterDraftForm.label = ''
  adapterDraftForm.domain = 'image'
  adapterDraftForm.dialogueModel = chatModelsAvailable.value[0]?.model_code || ''
  adapterDraftForm.prompt = ''
  adapterDraftForm.isDrafting = false
  adapterModalOpen.value = true
}

async function saveAdapterForm() {
  if (!adapterForm.label) return alert('请输入适配器名称')
  if (!adapterForm.protocol) return alert('请选择已实现的协议')
  const id = adapterForm.id || `adp_${Date.now()}`
  try {
    await api.saveAdapter({
      id,
      label: adapterForm.label,
      kind: adapterForm.kind,
      protocol: adapterForm.protocol,
      base_url: adapterForm.base_url,
      apiKey: adapterForm.apiKey || undefined
    })
    adapterModalOpen.value = false
    alert('适配器保存成功！')
    await loadAllData()
  } catch (err) {
    alert(`保存适配器失败: ${err.message || err}`)
  }
}

async function submitAdapterDraft() {
  if (!adapterDraftForm.protocol) return alert('请输入新协议标识')
  adapterDraftForm.isDrafting = true
  try {
    const modelId = (adapterDraftForm.id || adapterDraftForm.protocol).toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    await api.createSkillDraft({
      kind: 'adapter',
      model_id: modelId,
      model_code: adapterDraftForm.protocol,
      domain: adapterDraftForm.domain,
      dialogue_model: adapterDraftForm.dialogueModel || undefined,
      prompt: adapterDraftForm.prompt || undefined,
      schema_draft: {
        kind: 'adapter',
        protocol: adapterDraftForm.protocol,
        label: adapterDraftForm.label || modelId,
        base_url: ''
      }
    })
    adapterModalOpen.value = false
    activeTab.value = 'skills'
    alert('适配器草稿创建成功！已进入待审草稿箱，请核对代码后点击确认加载。')
    await loadAllData()
  } catch (err) {
    alert(`起草失败: ${err.message || err}`)
  } finally {
    adapterDraftForm.isDrafting = false
  }
}

async function deleteAdapterItem(adp) {
  if (!confirm(`确认删除适配器 [${adp.label}] 吗？`)) return
  try {
    await api.deleteAdapter(adp.id)
    await loadAllData()
  } catch (err) {
    alert(`删除适配器失败: ${err.message || err}`)
  }
}

async function deleteDraftItem(draftId) {
  if (!confirm('确认删除这份草稿吗？')) return
  try {
    await api.deleteSkillDraft(draftId)
    await loadAllData()
  } catch (err) {
    alert(`删除草稿失败: ${err.message || err}`)
  }
}

async function saveDraftCode(d) {
  try {
    await api.updateSkillDraft(d.id, {
      skill_content: d.skill_content,
      schema_draft: d.schema_draft
    })
    alert('草稿代码修改已保存！')
  } catch (err) {
    alert(`保存失败: ${err.message || err}`)
  }
}

async function acceptDraft(draftId, kind) {
  const tip = kind === 'adapter'
    ? '确认要在当前服务进程加载此适配器代码吗？加载成功后该代码与当前服务具备同等权限，无沙箱。'
    : '确认采纳该草稿吗？'
  if (!confirm(tip)) return
  try {
    await api.acceptSkillDraft(draftId)
    alert(kind === 'adapter' ? '适配器加载成功！已正式挂载生效。' : '草稿已采纳落地！')
    await loadAllData()
  } catch (err) {
    alert(`采纳/加载失败: ${err.message || err}`)
    await loadAllData()
  }
}

function filterByThisProvider(pId) {
  filterProvider.value = pId
  activeTab.value = 'models'
}

onMounted(() => {
  loadAllData()
})
</script>
