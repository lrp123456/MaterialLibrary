<template>
  <div class="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
    <!-- 顶部三级架构概览与五大治理中心标签切换 -->
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-outline-variant pb-4">
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-bold text-white tracking-tight">AI 统一治理中心</h2>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary-dim border border-primary/30">
            三级解耦架构 · 单一事实源
          </span>
        </div>
        <p class="text-xs text-on-surface-variant mt-0.5">
          大框架（业务挂载点插座） → 中框架（可增删改工作流 + 工作流节点子单位） → 小框架（40种预置算子 + 提示词/公共积木/词典芯片 + 模型三开关/专属优化器 + 供应商密钥池）
        </p>
      </div>

      <div class="flex items-center gap-1.5 bg-surface-low p-1 rounded-xl border border-outline-variant self-start overflow-x-auto max-w-full">
        <button
          @click="switchTab('providers')"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          :class="activeTab === 'providers' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:text-white hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">dns</span>
          <span>1. 供应商池</span>
          <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-black/25">{{ providersList.length }}</span>
        </button>
        <button
          @click="switchTab('models')"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          :class="activeTab === 'models' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:text-white hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">neurology</span>
          <span>2. 模型契约与三开关</span>
          <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-black/25">{{ modelsList.length }}</span>
        </button>
        <button
          @click="switchTab('prompts')"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          :class="activeTab === 'prompts' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:text-white hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">description</span>
          <span>3. 提示词与公共积木</span>
          <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-black/25">{{ promptsList.length + snippetsList.length }}</span>
        </button>
        <button
          @click="switchTab('dictionary')"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          :class="activeTab === 'dictionary' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:text-white hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">sell</span>
          <span>4. 动态标签词典</span>
          <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-black/25">{{ dictTags.length }}</span>
        </button>
        <button
          @click="switchTab('workflows')"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          :class="activeTab === 'workflows' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant hover:text-white hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">account_tree</span>
          <span>5. 工作流与节点编排</span>
          <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-black/25">{{ mountPointsList.length }}</span>
        </button>
      </div>
    </div>

    <!-- 错误/提示横条 -->
    <div v-if="error" class="p-3 rounded-xl bg-err/15 border border-err/30 text-err text-xs flex items-center justify-between">
      <span>{{ error }}</span>
      <button @click="error = ''" class="text-xs underline ml-3 cursor-pointer">关闭</button>
    </div>
    <div v-if="successMsg" class="p-3 rounded-xl bg-ok/15 border border-ok/30 text-ok text-xs flex items-center justify-between">
      <span>{{ successMsg }}</span>
      <button @click="successMsg = ''" class="text-xs underline ml-3 cursor-pointer">关闭</button>
    </div>

    <!-- ================= TAB 1: 供应商管理页签 ================= -->
    <div v-if="activeTab === 'providers'" class="space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold text-white">接入点与供应商密钥轮换池</h3>
          <p class="text-[11px] text-on-surface-variant">配置 BaseURL、鉴权协议与多密钥轮换池（密钥严格执行 SHA-256 脱敏，不返明文）</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="openEnvSecretsDrawer"
            class="px-3 py-1.5 rounded-xl bg-cyan/15 hover:bg-cyan/25 text-cyan border border-cyan/30 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <span class="material-symbols-outlined text-sm">key</span>
            <span>.env 统一密钥中枢 ({{ envSecretsList.filter(i => i.has_value).length }}/{{ envSecretsList.length }})</span>
          </button>
          <button
            @click="openNewProvider"
            class="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <span class="material-symbols-outlined text-sm">add</span>
            <span>新建接入点</span>
          </button>
          <button
            @click="refreshCurrentTab"
            class="px-3 py-1.5 rounded-xl bg-surface-high hover:bg-outline-variant text-white text-xs flex items-center gap-1 transition cursor-pointer"
          >
            <span class="material-symbols-outlined text-sm">refresh</span>
            <span>刷新</span>
          </button>
        </div>
      </div>

      <!-- .env 统一密钥中枢折叠面板 (只读状态指纹 + 单向热写入 .env，绝不返明文) -->
      <div v-if="showEnvSecretsPanel" class="rounded-2xl bg-surface border border-cyan/40 p-4 space-y-3 shadow-lg">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant pb-2.5">
          <div>
            <h4 class="text-xs font-bold text-cyan flex items-center gap-1.5">
              <span class="material-symbols-outlined text-sm">vpn_key</span>
              <span>.env 统一密钥中枢 (Single Source of Truth · 零数据库明文残留)</span>
            </h4>
            <p class="text-[11px] text-on-surface-variant">
              所有供应商 API Key / AK / SK 统一收纳于根目录 .env 并注入 process.env；下方仅显示 SHA-256 指纹与打码状态，输入新值可单向热更新写入 .env
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="saveEnvSecretsUpdates"
              :disabled="savingEnvSecrets"
              class="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium cursor-pointer"
            >
              {{ savingEnvSecrets ? '写入中...' : '保存并热重载新密钥' }}
            </button>
            <button
              @click="showEnvSecretsPanel = false"
              class="px-2.5 py-1.5 rounded-xl bg-surface-low text-on-surface-variant hover:text-white text-xs cursor-pointer"
            >
              收起
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pr-1">
          <div
            v-for="item in envSecretsList"
            :key="item.env"
            class="p-2.5 rounded-xl bg-surface-low border border-outline-variant space-y-1.5 text-xs"
          >
            <div class="flex items-center justify-between font-mono">
              <span class="font-bold text-white text-[11px]">{{ item.env }}</span>
              <span
                class="px-1.5 py-0.5 rounded text-[10px]"
                :class="item.has_value ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'"
              >
                {{ item.has_value ? `已就绪 (${item.count || 1}把 · fp:${item.fingerprint})` : '未配置' }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <input
                v-model="envSecretsDraft[item.env]"
                type="password"
                :placeholder="item.has_value ? `${item.masked} (输入新值覆盖)` : '输入新密钥写入 .env...'"
                class="w-full px-2.5 py-1 rounded-lg bg-surface border border-outline-variant text-white font-mono text-[11px]"
              />
            </div>
          </div>
        </div>
      </div>

      <div v-if="loading" class="text-xs text-on-surface-variant py-8 text-center">加载中...</div>

      <div v-else class="grid grid-cols-1 gap-3">
        <div
          v-for="ep in providersList"
          :key="ep.id"
          class="rounded-2xl bg-surface border border-outline-variant p-4 space-y-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2.5">
              <span
                class="w-2.5 h-2.5 rounded-full"
                :class="ep.enabled ? 'bg-ok shadow-[0_0_6px_rgba(52,211,153,.5)]' : 'bg-outline'"
              ></span>
              <span class="text-sm font-bold text-white">{{ ep.name }}</span>
              <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-low text-on-surface-variant border border-outline-variant">
                {{ ep.id }}
              </span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary-dim border border-primary/25">
                {{ ep.auth_type === 'aksk' ? 'AK/SK 签名' : ep.auth_type === 'none' ? '无鉴权' : 'Bearer Token' }}
              </span>
            </div>

            <div class="flex items-center gap-2">
              <button
                @click="openEditProvider(ep)"
                class="px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-low text-on-surface-variant hover:text-white border border-outline-variant cursor-pointer"
              >
                编辑
              </button>
              <button
                @click="deleteProvider(ep)"
                class="px-2.5 py-1 rounded-lg text-xs font-medium bg-err/10 text-err hover:bg-err/20 border border-err/25 cursor-pointer"
              >
                删除
              </button>
              <button
                @click="toggleEndpoint(ep)"
                class="px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer"
                :class="ep.enabled ? 'bg-ok/15 text-ok border border-ok/30' : 'bg-surface-low text-on-surface-variant border border-outline-variant'"
              >
                {{ ep.enabled ? '已启用' : '已停用' }}
              </button>
              <button
                @click="toggleExpandEndpoint(ep.id)"
                class="px-2.5 py-1 rounded-lg bg-surface-low hover:bg-surface-high text-xs text-on-surface-variant hover:text-white border border-outline-variant cursor-pointer"
              >
                {{ expandedEndpoints[ep.id] ? '收起详情' : '能力与密钥' }}
              </button>
            </div>
          </div>

          <div class="text-xs font-mono text-on-surface-variant break-all">
            {{ ep.base_url || '(未配置 BaseURL)' }}
          </div>

          <div v-if="expandedEndpoints[ep.id]" class="pt-3 border-t border-outline-variant grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div class="space-y-1.5">
              <div class="font-semibold text-white">挂接能力 ({{ (ep.capabilities || []).length }})</div>
              <div v-if="!(ep.capabilities || []).length" class="text-on-surface-variant">暂无能力</div>
              <div
                v-for="cap in ep.capabilities"
                :key="cap.id"
                class="p-2 rounded-xl bg-surface-low border border-outline-variant flex items-center justify-between"
              >
                <div>
                  <span class="font-medium text-white">{{ cap.name }}</span>
                  <span class="ml-1.5 font-mono text-[10px] text-on-surface-variant">({{ cap.id }})</span>
                </div>
                <span class="font-mono text-[11px] text-primary-dim">{{ cap.path || cap.action || cap.type }}</span>
              </div>
            </div>

            <div class="space-y-1.5">
              <div class="font-semibold text-white">凭证轮换池 ({{ (ep.credentials || []).length }})</div>
              <div v-if="!(ep.credentials || []).length" class="text-on-surface-variant">無凭证或无需密钥</div>
              <div
                v-for="(cred, idx) in ep.credentials"
                :key="idx"
                class="p-2 rounded-xl bg-surface-low border border-outline-variant flex items-center justify-between font-mono text-[11px]"
              >
                <span class="text-on-surface-variant">
                  {{ cred.env || cred.ak_env || `Slot #${idx + 1}` }}
                </span>
                <div class="flex items-center gap-2">
                  <span v-if="cred.masked" class="text-white">{{ cred.masked }}</span>
                  <span v-if="cred.fingerprint" class="text-[10px] text-outline">fp:{{ cred.fingerprint }}</span>
                  <span
                    class="px-1.5 py-0.5 rounded text-[10px]"
                    :class="cred.has_value ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'"
                  >
                    {{ cred.has_value ? '就绪' : '未配置' }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= TAB 2: 模型契约与三开关治理页签 ================= -->
    <div v-if="activeTab === 'models'" class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold text-white">全模态模型契约、方言三开关与专属优化器（一事一办）</h3>
          <p class="text-[11px] text-on-surface-variant">
            每个模型配置「选区模式 / 参考图记号 / 负向词通道」三个自动转译开关，并独立维护按官方文档编写的专属提示词优化器
          </p>
        </div>
        <button
          @click="openNewModel"
          class="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
        >
          <span class="material-symbols-outlined text-sm">add</span>
          <span>新建模型契约</span>
        </button>
      </div>

      <div v-for="sec in modelSections" :key="sec.id" class="space-y-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-white">{{ sec.label }} 模型</span>
          <span class="text-[11px] text-on-surface-variant">({{ sec.items.length }})</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div
            v-for="m in sec.items"
            :key="m.id"
            class="rounded-2xl bg-surface border border-outline-variant p-4 flex flex-col justify-between gap-3 hover:border-primary/40 transition"
          >
            <div class="space-y-2">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h4 class="text-sm font-bold text-white">{{ m.name }}</h4>
                  <p class="text-[11px] font-mono text-on-surface-variant mt-0.5">{{ m.vendor_model_id }}</p>
                </div>
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                  :class="m.enabled ? 'bg-ok/15 text-ok border border-ok/30' : 'bg-surface-low text-outline border border-outline-variant'"
                >
                  {{ m.enabled ? '启用' : '停用' }}
                </span>
              </div>

              <div class="flex flex-wrap gap-1.5 text-[10px]">
                <span class="px-2 py-0.5 rounded bg-surface-low text-on-surface-variant border border-outline-variant">
                  能力: {{ m.capability_id }}
                </span>
                <span v-if="m.dialect?.region_mode" class="px-2 py-0.5 rounded bg-cyan/10 text-cyan border border-cyan/25">
                  选区: {{ formatRegionMode(m.dialect.region_mode) }}
                </span>
                <span v-if="m.dialect?.ref_syntax" class="px-2 py-0.5 rounded bg-primary/15 text-primary-dim border border-primary/25">
                  参考记号: {{ m.dialect.ref_syntax }}
                </span>
                <span v-if="m.converter" class="px-2 py-0.5 rounded bg-primary/15 text-primary-dim border border-primary/25 font-mono">
                  转换器: {{ m.converter }}
                </span>
                <span class="px-2 py-0.5 rounded bg-surface-low text-on-surface-variant border border-outline-variant">
                  参数: {{ (m.params || []).length }} 项
                </span>
                <span v-if="m.optimizer?.prompt" class="px-2 py-0.5 rounded bg-ok/10 text-ok border border-ok/25">
                  专属优化器已就绪
                </span>
              </div>
            </div>

            <div class="flex items-center justify-between pt-2 border-t border-outline-variant">
              <span class="text-[11px] font-mono text-outline">ID: {{ m.id }}</span>
              <div class="flex items-center gap-1.5">
                <button
                  @click="openEditModel(m)"
                  class="px-2.5 py-1 rounded-lg bg-surface-low hover:bg-surface-high text-xs text-white border border-outline-variant transition cursor-pointer"
                >
                  编辑契约与三开关
                </button>
                <button
                  @click="deleteModelContract(m)"
                  class="px-2 py-1 rounded-lg bg-err/10 hover:bg-err/20 text-xs text-err border border-err/25 transition cursor-pointer"
                  title="删除该模型契约"
                >
                  <span class="material-symbols-outlined text-xs">delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= TAB 3: 提示词与公共积木中心页签 ================= -->
    <div v-if="activeTab === 'prompts'" class="space-y-6">
      <!-- 第一区：🧱 公共提示词积木 (Prompt Snippets) -->
      <div class="rounded-2xl bg-surface border border-outline-variant p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-white">🧱 第一区：可勾选公共提示词积木 (Prompt Snippets)</span>
              <span class="px-2 py-0.5 rounded text-[10px] bg-ok/15 text-ok border border-ok/30">一处维护 · 按节点勾选叠加</span>
            </div>
            <p class="text-[11px] text-on-surface-variant mt-0.5">
              维护跨工作流节点复用的画面真实感与防伪影约束（如《室内实拍真实感与反塑料感》）。净画重构、室内生图、室内精修节点默认勾选；视频、音乐、服装、人像不勾选，彻底解决跨品类串味。
            </p>
          </div>
          <button
            @click="openNewSnippet"
            class="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <span class="material-symbols-outlined text-sm">add</span>
            <span>新建公共积木</span>
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div
            v-for="snip in snippetsList"
            :key="snip.id"
            class="rounded-xl bg-surface-low border border-outline-variant p-3.5 flex flex-col justify-between gap-2.5 hover:border-primary/40 transition"
          >
            <div class="space-y-1.5">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>🧱 {{ snip.name }}</span>
                  </div>
                  <div class="text-[10px] font-mono text-on-surface-variant">{{ snip.id }} · v{{ snip.version || 1 }}</div>
                </div>
                <span v-if="snip.is_builtin" class="px-1.5 py-0.5 rounded text-[10px] bg-primary/15 text-primary-dim border border-primary/25 shrink-0">
                  官方积木
                </span>
              </div>
              <p v-if="snip.description" class="text-[11px] text-on-surface-variant leading-relaxed">{{ snip.description }}</p>
              <div class="p-2 rounded-lg bg-canvas border border-outline-variant text-[11px] font-mono text-on-surface-variant space-y-1 max-h-28 overflow-y-auto">
                <div><span class="text-ok font-semibold">[正向追加]</span> {{ snip.positive_text }}</div>
                <div v-if="snip.negative_text"><span class="text-err font-semibold">[负向追加]</span> {{ snip.negative_text }}</div>
              </div>
            </div>

            <div class="flex items-center justify-between pt-2 border-t border-outline-variant text-[11px]">
              <button
                v-if="snip.has_official"
                @click="restoreSnippetDefault(snip)"
                class="text-primary-dim hover:underline cursor-pointer"
              >
                恢复默认
              </button>
              <span v-else class="text-outline">自定义积木</span>
              <div class="flex items-center gap-1.5">
                <button
                  @click="openEditSnippet(snip)"
                  class="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-high text-white border border-outline-variant cursor-pointer"
                >
                  编辑积木
                </button>
                <button
                  v-if="!snip.is_builtin"
                  @click="deleteSnippet(snip)"
                  class="px-2 py-1 rounded-lg bg-err/10 text-err border border-err/25 cursor-pointer"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 第二区：📝 业务任务提示词模板 (Prompt Templates) -->
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 class="text-sm font-bold text-white">📝 第二区：业务任务提示词模板 ({{ promptsList.length }})</h3>
            <p class="text-[11px] text-on-surface-variant">
              管理门禁、缺陷质检、四品类多维打标（内嵌 <code class="text-cyan">&#123;&#123;@dict.维度名&#125;&#125;</code> 动态词典芯片）、净画重构、8大精准修改算子与空间漫游模板
            </p>
          </div>
          <button
            @click="openNewPrompt"
            class="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <span class="material-symbols-outlined text-sm">add</span>
            <span>新建任务提示词</span>
          </button>
        </div>

        <!-- 分类过滤栏 -->
        <div class="flex items-center gap-1.5 flex-wrap">
          <button
            v-for="cat in promptCategories"
            :key="cat.id"
            @click="activePromptCategory = cat.id"
            class="px-3 py-1 rounded-xl text-xs font-medium transition cursor-pointer"
            :class="activePromptCategory === cat.id ? 'bg-primary text-white' : 'bg-surface border border-outline-variant text-on-surface-variant hover:text-white'"
          >
            {{ cat.label }} ({{ countPromptsByCategory(cat.id) }})
          </button>
        </div>

        <!-- 提示词卡片列表 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            v-for="p in filteredPrompts"
            :key="p.id"
            class="rounded-2xl bg-surface border border-outline-variant p-4 flex flex-col justify-between gap-3 hover:border-primary/40 transition"
          >
            <div class="space-y-2">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="flex items-center gap-2">
                    <h4 class="text-sm font-bold text-white">{{ p.name }}</h4>
                    <span class="text-[10px] px-2 py-0.5 rounded bg-surface-low text-primary-dim font-mono border border-outline-variant">
                      v{{ p.version || 1 }}
                    </span>
                  </div>
                  <p class="text-[11px] font-mono text-on-surface-variant mt-0.5">{{ p.id }} · 分类: {{ p.category }}</p>
                </div>
                <div class="flex items-center gap-1">
                  <span
                    v-if="p.template && p.template.includes('@dict.')"
                    class="px-2 py-0.5 rounded-full text-[10px] bg-cyan/15 text-cyan border border-cyan/30"
                  >
                    动态词典芯片
                  </span>
                  <span
                    v-if="p.is_builtin"
                    class="px-2 py-0.5 rounded-full text-[10px] bg-primary/15 text-primary-dim border border-primary/25"
                  >
                    官方基线
                  </span>
                </div>
              </div>

              <div class="p-2.5 rounded-xl bg-surface-low border border-outline-variant text-xs font-mono text-on-surface-variant line-clamp-4 whitespace-pre-wrap leading-relaxed">
                {{ p.template }}
              </div>
            </div>

            <div class="flex items-center justify-between pt-2 border-t border-outline-variant">
              <span class="text-[11px] text-outline">{{ (p.template || '').length }} 字符 (展开后 {{ (p.expanded_preview || p.template || '').length }} 字符)</span>
              <div class="flex items-center gap-2">
                <button
                  v-if="p.has_official"
                  @click="restorePromptDefault(p)"
                  class="px-2.5 py-1 rounded-lg bg-surface-low hover:bg-surface-high text-[11px] text-on-surface-variant hover:text-white border border-outline-variant transition cursor-pointer"
                >
                  恢复官方默认
                </button>
                <button
                  @click="openEditPrompt(p)"
                  class="px-3 py-1 rounded-lg bg-primary/20 hover:bg-primary/30 text-xs text-primary-dim font-medium border border-primary/30 transition cursor-pointer"
                >
                  编辑与预览编译
                </button>
                <button
                  v-if="!p.is_builtin"
                  @click="deletePrompt(p)"
                  class="px-2.5 py-1 rounded-lg bg-err/10 hover:bg-err/20 text-xs text-err border border-err/25 transition cursor-pointer"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= TAB 4: 动态标签词典页签 (与 {{@dict.xxx}} 实时联动) ================= -->
    <div v-if="activeTab === 'dictionary'" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-sm font-semibold text-white">动态标签词典与视觉判据管理 (Tag Dictionary)</h3>
          <p class="text-[11px] text-on-surface-variant">
            在此处修改任意标签的中文名、同义别名或视觉判定标准 (criteria)，所有内嵌 <code class="text-cyan">&#123;&#123;@dict.维度名&#125;&#125;</code> 芯片的打标提示词将即时自动同步，无需手改提示词长文！
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="openAddDictTag"
            class="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <span class="material-symbols-outlined text-sm">add</span>
            <span>新增当前维度标签</span>
          </button>
        </div>
      </div>

      <!-- 维度选择栏 -->
      <div class="flex items-center gap-1.5 flex-wrap">
        <button
          v-for="dim in dictDimensions"
          :key="dim.key"
          @click="selectedDictDim = dim.key"
          class="px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
          :class="selectedDictDim === dim.key ? 'bg-primary text-white' : 'bg-surface border border-outline-variant text-on-surface-variant hover:text-white'"
        >
          <span>{{ dim.label }}</span>
          <span class="font-mono text-[10px] opacity-80">&#123;&#123;@dict.{{ dim.key }}&#125;&#125;</span>
        </button>
      </div>

      <!-- 当前维度标签列表 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          v-for="tag in filteredDictTags"
          :key="tag.id || tag.dir"
          class="rounded-2xl bg-surface border border-outline-variant p-3.5 flex flex-col justify-between gap-2"
          :class="tag.deprecated ? 'opacity-50' : ''"
        >
          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold text-white">{{ tag.label }}</span>
                <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-low text-cyan border border-outline-variant">
                  {{ tag.dir }}
                </span>
              </div>
              <span
                class="text-[10px] px-2 py-0.5 rounded-full"
                :class="tag.deprecated ? 'bg-err/15 text-err' : 'bg-ok/15 text-ok'"
              >
                {{ tag.deprecated ? '已废弃' : '生效中' }}
              </span>
            </div>
            <div v-if="tag.aliases" class="text-[11px] text-on-surface-variant">
              别名: <span class="font-mono text-white">{{ formatAliases(tag.aliases) }}</span>
            </div>
            <div class="p-2 rounded-lg bg-surface-low border border-outline-variant text-xs text-on-surface-variant">
              <span class="text-primary-dim font-semibold">视觉判据: </span>
              <span>{{ tag.criteria || '(未设置特殊视觉判据，按标签字面义识别)' }}</span>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant text-xs">
            <button
              @click="openEditDictTag(tag)"
              class="px-2.5 py-1 rounded-lg bg-surface-low hover:bg-surface-high text-white border border-outline-variant cursor-pointer"
            >
              编辑判据与别名
            </button>
            <button
              v-if="!tag.deprecated"
              @click="toggleDeprecateTag(tag, true)"
              class="px-2.5 py-1 rounded-lg bg-err/10 text-err border border-err/25 cursor-pointer"
            >
              废弃
            </button>
            <button
              v-else
              @click="toggleDeprecateTag(tag, false)"
              class="px-2.5 py-1 rounded-lg bg-ok/15 text-ok border border-ok/30 cursor-pointer"
            >
              恢复启用
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= TAB 5: 模块化工作流与工作流节点编排 (形态 B 三级工作台) ================= -->
    <div v-if="activeTab === 'workflows'" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-sm font-semibold text-white">工作流与工作流节点编排 (形态 B：左侧工作流/挂载点 + 右侧工作流节点子单位)</h3>
          <p class="text-[11px] text-on-surface-variant">
            所有工作流（入库、精准修改、视频镜头切片与关键帧抽帧、空间漫游）及内部的每一个子单位「工作流节点」均支持自由增删改、排序、分支配置与单节点真机试跑
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="openNewMountPoint(null)"
            class="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <span class="material-symbols-outlined text-sm">add</span>
            <span>+ 新建工作流 / 挂载点</span>
          </button>
        </div>
      </div>

      <!-- IDE 风格左右分栏布局 -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <!-- 左侧：工作流与挂载点目录树 (4列) -->
        <div class="lg:col-span-4 space-y-2">
          <div
            v-for="mp in mountPointsList"
            :key="mp.id"
            @click="selectedMountPointId = mp.id"
            class="p-3.5 rounded-2xl border transition cursor-pointer space-y-1.5"
            :class="selectedMountPoint?.id === mp.id ? 'bg-primary/15 border-primary text-white shadow-sm' : 'bg-surface border-outline-variant text-on-surface-variant hover:border-outline'"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-2 h-2 rounded-full shrink-0" :class="mp.enabled ? 'bg-ok' : 'bg-outline'"></span>
                <span class="text-xs font-bold text-white truncate">{{ mp.name }}</span>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-low border border-outline-variant">
                  {{ mp.category }}
                </span>
                <button
                  @click.stop="openNewMountPoint(mp)"
                  class="px-1.5 py-0.5 rounded bg-surface-low hover:bg-surface-high text-[10px] text-cyan border border-outline-variant cursor-pointer"
                  title="克隆此工作流及其全部子节点"
                >
                  克隆
                </button>
                <button
                  v-if="!mp.is_builtin"
                  @click.stop="deleteMountPointItem(mp)"
                  class="px-1.5 py-0.5 rounded bg-err/10 hover:bg-err/20 text-[10px] text-err border border-err/25 cursor-pointer"
                  title="删除自定义工作流"
                >
                  删
                </button>
              </div>
            </div>
            <p class="text-[11px] text-on-surface-variant line-clamp-2">{{ mp.description }}</p>
            <div class="flex items-center justify-between text-[10px] font-mono text-outline pt-1">
              <span>ID: {{ mp.id }}</span>
              <span class="text-primary-dim font-semibold">{{ (mp.modules || []).length }} 个工作流节点</span>
            </div>
          </div>
        </div>

        <!-- 右侧：所选工作流的「工作流节点 (Workflow Nodes)」编排器 (8列) -->
        <div v-if="selectedMountPoint" class="lg:col-span-8 rounded-2xl bg-surface border border-outline-variant p-4 space-y-4">
          <!-- 工作流头部与全局操作 -->
          <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-outline-variant">
            <div>
              <div class="flex items-center gap-2">
                <h4 class="text-base font-bold text-white">{{ selectedMountPoint.name }}</h4>
                <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-low text-on-surface-variant border border-outline-variant">
                  {{ selectedMountPoint.id }}
                </span>
              </div>
              <p class="text-xs text-on-surface-variant mt-1">{{ selectedMountPoint.description }}</p>
            </div>
            <div class="flex items-center gap-2">
              <button
                @click="executeTestMountPoint"
                :disabled="executingMountPoint"
                class="px-3 py-1.5 rounded-xl bg-ok/15 hover:bg-ok/25 text-ok text-xs font-medium border border-ok/30 flex items-center gap-1 transition cursor-pointer"
              >
                <span class="material-symbols-outlined text-sm">play_arrow</span>
                <span>{{ executingMountPoint ? '编译校验中...' : '⚡ 全流编译校验' }}</span>
              </button>
              <button
                @click="openNewModule()"
                class="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium flex items-center gap-1 transition cursor-pointer"
              >
                <span class="material-symbols-outlined text-sm">add</span>
                <span>+ 添加工作流节点</span>
              </button>
            </div>
          </div>

          <!-- 全流编译校验报告折叠面板 -->
          <div v-if="workflowCompileReport && workflowCompileReport.mount_point_id === selectedMountPoint.id" class="p-3.5 rounded-xl bg-surface-low border border-ok/40 space-y-2 text-xs">
            <div class="flex items-center justify-between">
              <span class="font-bold text-ok flex items-center gap-1.5">
                <span class="material-symbols-outlined text-sm">verified</span>
                <span>{{ workflowCompileReport.message }}</span>
              </span>
              <button @click="workflowCompileReport = null" class="text-[11px] text-on-surface-variant underline cursor-pointer">收起报告</button>
            </div>
            <div class="space-y-1.5 max-h-60 overflow-y-auto pt-1">
              <div
                v-for="st in workflowCompileReport.steps"
                :key="st.id"
                class="p-2 rounded-lg bg-canvas border border-outline-variant space-y-1 font-mono text-[11px]"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-white font-bold">步骤 #{{ st.step }}: {{ st.name }} [{{ st.node_type }}]</span>
                  <span class="text-cyan">模型: {{ st.model_id }} | 提示词长度: {{ st.compiled_prompt_length }} 字符</span>
                </div>
                <div v-if="st.snippets_used && st.snippets_used.length" class="text-ok">
                  已叠加公共积木: {{ st.snippets_used.map(s => '🧱' + s.name).join('、') }}
                </div>
                <div class="text-on-surface-variant line-clamp-2">{{ st.compiled_prompt_preview }}</div>
              </div>
            </div>
          </div>

          <!-- 子单位：工作流节点列表 (按先后顺序与条件分支纵向展开) -->
          <div v-if="!(selectedMountPoint.modules || []).length" class="py-12 text-center text-xs text-on-surface-variant">
            当前工作流暂无工作流节点，点击右上角「+ 添加工作流节点」从 40 种预置算子库中选择添加
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="(mod, idx) in selectedMountPoint.modules"
              :key="mod.id"
              class="rounded-xl border p-3.5 space-y-2.5 transition"
              :class="mod.branch_group ? 'bg-surface-low/90 border-cyan/35 ml-3' : 'bg-surface-low border-outline-variant hover:border-primary/40'"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="w-6 h-6 rounded-lg bg-primary/20 text-primary-dim font-mono text-xs font-bold flex items-center justify-center">
                    {{ idx + 1 }}
                  </span>
                  <span class="text-sm font-bold text-white">{{ mod.name }}</span>
                  <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-surface border border-outline-variant text-primary-dim">
                    算子: {{ mod.node_type }}
                  </span>
                  <span
                    v-if="mod.condition_expr"
                    class="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan/15 text-cyan border border-cyan/30"
                  >
                    分支条件: {{ mod.condition_expr }}
                  </span>
                  <span
                    class="text-[10px] px-2 py-0.5 rounded-full"
                    :class="mod.enabled !== 0 ? 'bg-ok/15 text-ok' : 'bg-surface text-outline'"
                  >
                    {{ mod.enabled !== 0 ? '已启用' : '已停用' }}
                  </span>
                </div>

                <!-- 节点排序、单步真机试跑与管理按钮 -->
                <div class="flex items-center gap-1.5">
                  <button
                    @click="moveModuleUp(idx)"
                    :disabled="idx === 0"
                    class="p-1 rounded bg-surface hover:bg-surface-high text-on-surface-variant hover:text-white disabled:opacity-30 border border-outline-variant cursor-pointer"
                    title="节点上移"
                  >
                    <span class="material-symbols-outlined text-xs">arrow_upward</span>
                  </button>
                  <button
                    @click="moveModuleDown(idx)"
                    :disabled="idx === selectedMountPoint.modules.length - 1"
                    class="p-1 rounded bg-surface hover:bg-surface-high text-on-surface-variant hover:text-white disabled:opacity-30 border border-outline-variant cursor-pointer"
                    title="节点下移"
                  >
                    <span class="material-symbols-outlined text-xs">arrow_downward</span>
                  </button>
                  <button
                    @click="openSandboxModal(mod)"
                    class="px-2.5 py-1 rounded-lg bg-cyan/15 hover:bg-cyan/25 text-xs text-cyan border border-cyan/30 font-medium cursor-pointer flex items-center gap-1"
                    title="预览该节点编译后的完整提示词，或选一张真图单步试跑此节点"
                  >
                    <span>🧪 选图试跑 / 预览</span>
                  </button>
                  <button
                    @click="openEditModule(mod)"
                    class="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-high text-xs text-white border border-outline-variant cursor-pointer"
                  >
                    配置节点
                  </button>
                  <button
                    @click="deleteModule(mod)"
                    class="px-2 py-1 rounded-lg bg-err/10 hover:bg-err/20 text-xs text-err border border-err/25 cursor-pointer"
                  >
                    删除
                  </button>
                </div>
              </div>

              <!-- 节点内部装配的小框架零件详情展示 -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
                <div class="p-2 rounded-lg bg-surface border border-outline-variant">
                  <span class="text-on-surface-variant block text-[10px]">挂载模型 (Model)</span>
                  <span class="font-mono text-white font-medium">{{ mod.model_id || '(本地 CPU/FFmpeg 算法)' }}</span>
                </div>
                <div class="p-2 rounded-lg bg-surface border border-outline-variant">
                  <span class="text-on-surface-variant block text-[10px]">绑定任务提示词 (Prompt)</span>
                  <span class="font-mono text-primary-dim font-medium">{{ mod.prompt_id || (mod.prompt_override ? '行内自定义' : '(无需提示词)') }}</span>
                </div>
                <div class="p-2 rounded-lg bg-surface border border-outline-variant">
                  <span class="text-on-surface-variant block text-[10px]">已勾选公共积木 (Snippets)</span>
                  <span v-if="mod.snippet_ids && mod.snippet_ids.length" class="text-ok font-medium">
                    {{ mod.snippet_ids.map(id => snippetNameOf(id)).join('、') }}
                  </span>
                  <span v-else class="text-outline">未挂载公共积木</span>
                </div>
              </div>

              <!-- 节点超参数与输出变量摘要 -->
              <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div v-if="mod.params && Object.keys(mod.params).length" class="flex flex-wrap gap-1.5">
                  <span
                    v-for="(val, key) in mod.params"
                    :key="key"
                    class="px-2 py-0.5 rounded bg-surface text-[10px] font-mono text-on-surface-variant border border-outline-variant"
                  >
                    {{ key }}={{ typeof val === 'object' ? JSON.stringify(val) : val }}
                  </span>
                </div>
                <div v-if="mod.operator_spec?.outputs?.length" class="text-[10px] font-mono text-outline">
                  输出总线变量: {{ mod.operator_spec.outputs.map(o => `$node["${mod.node_type}"].${o}`).slice(0, 3).join(', ') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗 1：供应商编辑/新建弹窗 ================= -->
    <div v-if="editingProvider" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="w-full max-w-lg rounded-2xl bg-surface border border-outline-variant p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-outline-variant pb-3">
          <h3 class="text-sm font-bold text-white">{{ isNewProvider ? '新建供应商接入点' : `编辑接入点: ${editingProvider.name}` }}</h3>
          <button @click="editingProvider = null" class="text-on-surface-variant hover:text-white cursor-pointer">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">接入点 ID (英文唯一标识)</label>
              <input
                v-model="editingProvider.id"
                :disabled="!isNewProvider"
                placeholder="如: custom_openai"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono disabled:opacity-50"
              />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">显示名称</label>
              <input
                v-model="editingProvider.name"
                placeholder="如: 火山方舟大模型服务池"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              />
            </div>
          </div>

          <div>
            <label class="block text-on-surface-variant mb-1">BaseURL</label>
            <input
              v-model="editingProvider.base_url"
              placeholder="https://api.example.com/v1"
              class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">鉴权协议类型</label>
              <select
                v-model="editingProvider.auth_type"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              >
                <option value="bearer">Bearer Token</option>
                <option value="aksk">AK/SK 签名</option>
                <option value="none">无鉴权 (本地服务)</option>
              </select>
            </div>
            <div class="flex items-end pb-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" v-model="editingProvider.enabled" class="rounded" />
                <span class="text-white">启用该接入点</span>
              </label>
            </div>
          </div>

          <div>
            <label class="block text-on-surface-variant mb-1">凭证环境变量名 (多个用逗号分隔)</label>
            <input
              v-model="providerCredentialsInput"
              placeholder="如: ARK_API_KEY, AGNES_API_KEY"
              class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono"
            />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-outline-variant">
          <button
            @click="editingProvider = null"
            class="px-4 py-2 rounded-xl bg-surface-low text-on-surface-variant hover:text-white text-xs cursor-pointer"
          >
            取消
          </button>
          <button
            @click="saveProvider"
            :disabled="savingProvider"
            class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium cursor-pointer"
          >
            {{ savingProvider ? '保存中...' : '保存接入点' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗 2：公共提示词积木 (Prompt Snippet) 编辑/新建弹窗 ================= -->
    <div v-if="editingSnippet" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="w-full max-w-2xl rounded-2xl bg-surface border border-outline-variant p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-outline-variant pb-3">
          <div>
            <h3 class="text-sm font-bold text-white">{{ isNewSnippet ? '新建公共提示词积木' : `编辑公共积木: ${editingSnippet.name}` }}</h3>
            <p class="text-[11px] text-on-surface-variant">所有勾选了该积木的工作流节点或优化器请求都会自动叠加以下正向与负向约束</p>
          </div>
          <button @click="editingSnippet = null" class="text-on-surface-variant hover:text-white cursor-pointer">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">积木 ID</label>
              <input
                v-model="editingSnippet.id"
                :disabled="!isNewSnippet"
                placeholder="如: snippet_custom_light"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono disabled:opacity-50"
              />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">积木名称</label>
              <input
                v-model="editingSnippet.name"
                placeholder="如: 室内实拍真实感与反塑料感"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">适用说明</label>
              <input
                v-model="editingSnippet.description"
                placeholder="简述该积木用途"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              />
            </div>
          </div>

          <div>
            <label class="block text-ok font-semibold mb-1">正向质量与质感追加文本 (Positive Text)</label>
            <textarea
              v-model="editingSnippet.positive_text"
              rows="5"
              placeholder="例如：这是实拍照片，不是效果图；墙顶按真实刷漆，哑光吸光..."
              class="w-full p-3 rounded-xl bg-surface-low border border-outline-variant text-white font-mono text-xs leading-relaxed"
            ></textarea>
          </div>

          <div>
            <label class="block text-err font-semibold mb-1">负向排斥词条 (Negative Text · 按模型负向开关自动分流到字段或正文尾部)</label>
            <textarea
              v-model="editingSnippet.negative_text"
              rows="3"
              placeholder="例如：塑料感, CGI, 均匀白光, 悬浮家具, 墙线倾斜, 8K, 电影感"
              class="w-full p-3 rounded-xl bg-surface-low border border-outline-variant text-white font-mono text-xs leading-relaxed"
            ></textarea>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-outline-variant">
          <button
            @click="editingSnippet = null"
            class="px-4 py-2 rounded-xl bg-surface-low text-on-surface-variant hover:text-white text-xs cursor-pointer"
          >
            取消
          </button>
          <button
            @click="saveSnippet"
            :disabled="savingSnippet"
            class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium cursor-pointer"
          >
            {{ savingSnippet ? '保存中...' : '保存公共积木' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗 3：业务任务提示词编辑/新建弹窗 (含 {{@dict}} 词典芯片与编译预览) ================= -->
    <div v-if="editingPrompt" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="w-full max-w-4xl rounded-2xl bg-surface border border-outline-variant p-5 space-y-4 shadow-2xl max-h-[92vh] flex flex-col">
        <div class="flex items-center justify-between border-b border-outline-variant pb-3">
          <div>
            <h3 class="text-sm font-bold text-white">{{ isNewPrompt ? '新建业务任务提示词' : `编辑提示词: ${editingPrompt.name}` }}</h3>
            <p class="text-[11px] text-on-surface-variant">点击下方蓝色词典芯片或黄色上下文芯片可直接在光标位置插入动态变量，保存后实时同步至关联工作流</p>
          </div>
          <button @click="editingPrompt = null" class="text-on-surface-variant hover:text-white cursor-pointer">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div class="space-y-3 text-xs overflow-y-auto flex-1 pr-1">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">提示词 ID</label>
              <input
                v-model="editingPrompt.id"
                :disabled="!isNewPrompt"
                placeholder="如: custom_gate_v2"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono disabled:opacity-50"
              />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">显示名称</label>
              <input
                v-model="editingPrompt.name"
                placeholder="如: 室内空间多维打标"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">所属分类</label>
              <select
                v-model="editingPrompt.category"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              >
                <option value="gate">gate (门禁初筛)</option>
                <option value="qc">qc (缺陷质检)</option>
                <option value="tag">tag (四品类多维打标)</option>
                <option value="restage">restage (净画重构)</option>
                <option value="edit">edit (精准修改8算子)</option>
                <option value="vlm">vlm (选区识别/视觉推理)</option>
                <option value="walkthrough">walkthrough (空间漫游)</option>
                <option value="video">video (视频分镜)</option>
                <option value="custom">custom (自定义)</option>
              </select>
            </div>
          </div>

          <!-- 动态标签词典芯片 ({{@dict.xxx}}) -->
          <div class="p-3 rounded-xl bg-surface-low border border-outline-variant space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-semibold text-cyan">🏷️ 点击插入动态标签词典芯片 (运行时自动从「4. 动态标签词典」拉取最新枚举与判据):</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="dm in dictMacroChips"
                :key="dm.macro"
                type="button"
                @click="insertVariableChip(dm.macro)"
                class="px-2 py-1 rounded-lg bg-cyan/10 hover:bg-cyan/25 text-cyan border border-cyan/30 font-mono text-[11px] transition cursor-pointer"
                :title="dm.preview"
              >
                + {{ dm.macro }} <span class="text-on-surface-variant font-sans">({{ dm.label }})</span>
              </button>
            </div>

            <div class="pt-1 border-t border-outline-variant">
              <span class="text-[11px] font-semibold text-primary-dim block mb-1.5">🔗 点击插入节点上下文与模型方言插槽:</span>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="v in variableChips"
                  :key="v.expr"
                  type="button"
                  @click="insertVariableChip(v.expr)"
                  class="px-2 py-1 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary-dim border border-primary/30 font-mono text-[11px] transition cursor-pointer"
                >
                  + {{ v.expr }} <span class="text-on-surface-variant font-sans">({{ v.desc }})</span>
                </button>
              </div>
            </div>
          </div>

          <!-- 正文编辑 -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-on-surface-variant font-semibold">提示词模板正文</label>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  @click="runPreviewPromptCompile"
                  class="text-[11px] text-cyan hover:underline cursor-pointer font-semibold"
                >
                  👁️ 预览展开词典与方言后的完整 Prompt
                </button>
                <button
                  v-if="editingPrompt.has_official"
                  type="button"
                  @click="restorePromptDefault(editingPrompt)"
                  class="text-[11px] text-primary-dim hover:underline cursor-pointer"
                >
                  恢复官方默认基线
                </button>
              </div>
            </div>
            <textarea
              ref="promptTextareaRef"
              v-model="editingPrompt.template"
              rows="11"
              placeholder="在此输入提示词模板正文..."
              class="w-full p-3 rounded-xl bg-surface-low border border-outline-variant text-white font-mono text-xs leading-relaxed"
            ></textarea>
          </div>

          <!-- 编译展开结果实时预览框 -->
          <div v-if="promptCompilePreview" class="p-3 rounded-xl bg-canvas border border-cyan/40 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-cyan">编译展开后完整 Prompt 预览 ({{ (promptCompilePreview.prompt || '').length }} 字符)</span>
              <button @click="promptCompilePreview = null" class="text-[11px] text-on-surface-variant underline cursor-pointer">关闭预览</button>
            </div>
            <div class="p-2.5 rounded-lg bg-surface-low font-mono text-[11px] text-white whitespace-pre-wrap max-h-52 overflow-y-auto leading-relaxed">
              {{ promptCompilePreview.prompt }}
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-outline-variant">
          <button
            @click="editingPrompt = null"
            class="px-4 py-2 rounded-xl bg-surface-low text-on-surface-variant hover:text-white text-xs cursor-pointer"
          >
            取消
          </button>
          <button
            @click="savePrompt"
            :disabled="savingPrompt"
            class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium cursor-pointer"
          >
            {{ savingPrompt ? '保存中...' : '保存提示词并同步工作流' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗 4：动态标签词典新增/编辑弹窗 ================= -->
    <div v-if="editingDictTag" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="w-full max-w-lg rounded-2xl bg-surface border border-outline-variant p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-outline-variant pb-3">
          <h3 class="text-sm font-bold text-white">{{ editingDictTag.isNew ? `新增标签 (${selectedDictDim})` : `编辑标签: ${editingDictTag.label}` }}</h3>
          <button @click="editingDictTag = null" class="text-on-surface-variant hover:text-white cursor-pointer">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">英文枚举键 (dir)</label>
              <input
                v-model="editingDictTag.dir"
                :disabled="!editingDictTag.isNew"
                placeholder="如: cream_style"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono disabled:opacity-50"
              />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">中文展示名称 (label)</label>
              <input
                v-model="editingDictTag.label"
                placeholder="如: 奶油风"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              />
            </div>
          </div>

          <div>
            <label class="block text-on-surface-variant mb-1">同义词/别名 (多个用逗号分隔)</label>
            <input
              v-model="editingDictTag.aliasesInput"
              placeholder="如: 法式奶油, 温柔奶油风"
              class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
            />
          </div>

          <div>
            <label class="block text-primary-dim font-semibold mb-1">VLM 视觉判定标准 (criteria · 保存后直接拼入打标提示词)</label>
            <textarea
              v-model="editingDictTag.criteria"
              rows="4"
              placeholder="例如：无法式雕花线脚符号的浅暖米白软融质感，圆润弧形羊羔绒沙发与微水泥地面..."
              class="w-full p-3 rounded-xl bg-surface-low border border-outline-variant text-white text-xs leading-relaxed"
            ></textarea>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-outline-variant">
          <button
            @click="editingDictTag = null"
            class="px-4 py-2 rounded-xl bg-surface-low text-on-surface-variant hover:text-white text-xs cursor-pointer"
          >
            取消
          </button>
          <button
            @click="saveDictTag"
            class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium cursor-pointer"
          >
            保存标签词条
          </button>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗 5：工作流节点 (Workflow Node) 编辑/新建弹窗 (40种预置算子 + 公共积木勾选) ================= -->
    <div v-if="editingModule" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="w-full max-w-3xl rounded-2xl bg-surface border border-outline-variant p-5 space-y-4 shadow-2xl max-h-[92vh] flex flex-col">
        <div class="flex items-center justify-between border-b border-outline-variant pb-3">
          <div>
            <h3 class="text-sm font-bold text-white">{{ isNewModule ? '添加工作流节点 (Workflow Node)' : `配置工作流节点: ${editingModule.name}` }}</h3>
            <p class="text-[11px] text-on-surface-variant">
              组装公式：1 个工作流节点 = 选 1 个原子算子积木 + 绑 1 个模型 + 绑 1 个任务提示词 + 勾 N 个公共积木 + 节点专属超参数
            </p>
          </div>
          <button @click="editingModule = null" class="text-on-surface-variant hover:text-white cursor-pointer">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div class="space-y-3.5 text-xs overflow-y-auto flex-1 pr-1">
          <!-- 1. 选算子类型 (从 5 大类 40 种预置算子库中选择) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-primary-dim font-semibold mb-1">1. 选择节点算子积木 (Operator Type · 共 {{ operatorsCatalog.length }} 种)</label>
              <select
                v-model="editingModule.node_type"
                @change="onModuleOperatorChange"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono"
              >
                <optgroup
                  v-for="grp in groupedOperators"
                  :key="grp.category"
                  :label="grp.label"
                >
                  <option v-for="op in grp.items" :key="op.type" :value="op.type">
                    [{{ op.type }}] {{ op.name }}
                  </option>
                </optgroup>
              </select>
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">节点步骤显示名称</label>
              <input
                v-model="editingModule.name"
                placeholder="如: 室内空间多维打标 / 视频关键帧抽取"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              />
            </div>
          </div>

          <div v-if="currentOperatorSpec" class="p-2.5 rounded-xl bg-surface-low border border-outline-variant text-[11px] text-on-surface-variant flex items-center justify-between">
            <span>💡 算子说明：{{ currentOperatorSpec.description }}</span>
            <span v-if="currentOperatorSpec.outputs?.length" class="font-mono text-cyan shrink-0 ml-2">
              输出: {{ currentOperatorSpec.outputs.join(', ') }}
            </span>
          </div>

          <!-- 2. 分支执行条件 (Condition Expression) -->
          <div class="p-3 rounded-xl bg-surface-low border border-outline-variant space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label class="text-white font-semibold">2. 节点执行条件 / 品类路由分支 (Condition Expression，留空为默认无条件执行)</label>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="preset in conditionPresets"
                  :key="preset.label"
                  type="button"
                  @click="editingModule.condition_expr = preset.expr"
                  class="px-2 py-0.5 rounded bg-surface hover:bg-surface-high text-[10px] font-mono text-cyan border border-outline-variant cursor-pointer"
                >
                  {{ preset.label }}
                </button>
              </div>
            </div>
            <input
              v-model="editingModule.condition_expr"
              placeholder="例如: category == 'furniture' 或 mode == 'C'（留空代表默认串行执行）"
              class="w-full px-3 py-1.5 rounded-lg bg-canvas border border-outline-variant text-white font-mono text-xs"
            />
          </div>

          <!-- 3. 挂载模型与绑定任务提示词 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">3. 挂载执行模型 (Model Contract)</label>
              <select
                v-model="editingModule.model_id"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono"
              >
                <option :value="null">(纯本地 CPU / FFmpeg 算法算子，无需大模型)</option>
                <option value="workflow_vision">workflow_vision (工作流免费视觉池)</option>
                <option value="text-embedding-3-small">text-embedding-3-small (语义向量模型)</option>
                <option value="umbra.expand">umbra.expand (veImageX/即梦专用扩图通道)</option>
                <option value="local-4x">local-4x (端侧 4x 超分通道)</option>
                <option v-for="m in modelsList" :key="m.id" :value="m.id">
                  {{ m.name }} ({{ m.id }})
                </option>
              </select>
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">4. 绑定业务任务提示词 (Prompt Center)</label>
              <select
                v-model="editingModule.prompt_id"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono"
              >
                <option :value="null">-- 无需提示词 / 使用算子默认 --</option>
                <option v-for="p in promptsList" :key="p.id" :value="p.id">
                  {{ p.name }} ({{ p.id }})
                </option>
              </select>
            </div>
          </div>

          <!-- 5. 勾选挂载公共提示词积木 (Prompt Snippets) -->
          <div class="p-3 rounded-xl bg-surface-low border border-outline-variant space-y-2">
            <label class="block text-ok font-semibold">
              5. 勾选要叠加的公共提示词积木 (净画重构、室内生图、室内精修默认勾选《室内实拍真实感》；视频/音乐/服装/人像不勾)
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label
                v-for="snip in snippetsList"
                :key="snip.id"
                class="p-2 rounded-lg bg-canvas border border-outline-variant flex items-start gap-2 cursor-pointer hover:border-ok/40"
              >
                <input
                  type="checkbox"
                  :value="snip.id"
                  v-model="editingModule.snippet_ids"
                  class="mt-0.5 rounded"
                />
                <div>
                  <div class="font-semibold text-white text-[11px]">🧱 {{ snip.name }}</div>
                  <div class="text-[10px] text-on-surface-variant line-clamp-1">{{ snip.positive_text }}</div>
                </div>
              </label>
            </div>
          </div>

          <!-- 6. 节点精细控制超参数 (根据节点类型动态展示常用参数 + JSON 扩展) -->
          <div class="p-3 rounded-xl bg-surface-low border border-outline-variant space-y-3">
            <div class="font-semibold text-white">6. 节点专属控制超参数 (Fine-grained Node Parameters)</div>

            <!-- 视频抽帧与镜头切片专属参数 -->
            <div v-if="editingModule.node_type === 'video_slice' || editingModule.node_type === 'video_extract_frames'" class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div v-if="editingModule.node_type === 'video_slice'">
                <label class="block text-[10px] text-on-surface-variant mb-1">切片模式 (sliceMode)</label>
                <select v-model="moduleParamsForm.sliceMode" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white">
                  <option value="scene_detect">scene_detect (镜头转场检测)</option>
                  <option value="fixed_duration">fixed_duration (固定时长切片)</option>
                </select>
              </div>
              <div v-if="editingModule.node_type === 'video_slice'">
                <label class="block text-[10px] text-on-surface-variant mb-1">镜头切换阈值 (sceneThreshold)</label>
                <input type="number" step="0.05" v-model.number="moduleParamsForm.sceneThreshold" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white font-mono" />
              </div>
              <div v-if="editingModule.node_type === 'video_extract_frames'">
                <label class="block text-[10px] text-on-surface-variant mb-1">抽帧模式 (mode)</label>
                <select v-model="moduleParamsForm.mode" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white">
                  <option value="keyframe">keyframe (I-Frame 关键帧)</option>
                  <option value="interval">interval (固定秒数间隔)</option>
                </select>
              </div>
              <div v-if="editingModule.node_type === 'video_extract_frames'">
                <label class="block text-[10px] text-on-surface-variant mb-1">抽帧间隔秒数 (intervalSeconds)</label>
                <input type="number" step="0.5" v-model.number="moduleParamsForm.intervalSeconds" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white font-mono" />
              </div>
              <div>
                <label class="block text-[10px] text-on-surface-variant mb-1">最大抽帧/切片数</label>
                <input type="number" v-model.number="moduleParamsForm.maxFrames" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white font-mono" />
              </div>
            </div>

            <!-- 通用与图像质检/重绘超参 -->
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div>
                <label class="block text-[10px] text-on-surface-variant mb-1">采样温度 (temperature)</label>
                <input type="number" step="0.05" min="0" max="2" v-model.number="moduleParamsForm.temperature" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white font-mono" />
              </div>
              <div>
                <label class="block text-[10px] text-on-surface-variant mb-1">超时毫秒 (timeoutMs)</label>
                <input type="number" step="1000" v-model.number="moduleParamsForm.timeoutMs" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white font-mono" />
              </div>
              <div>
                <label class="block text-[10px] text-on-surface-variant mb-1">失败降级策略 (fallbackStrategy)</label>
                <select v-model="moduleParamsForm.fallbackStrategy" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white">
                  <option value="manual_review">转人工待审 (manual_review)</option>
                  <option value="warn_continue">告警并继续 (warn_continue)</option>
                  <option value="reject">直接拦截淘汰 (reject)</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] text-on-surface-variant mb-1">pHash 汉明阈值 / 抠底容差</label>
                <input type="number" step="1" v-model.number="moduleParamsForm.phashThreshold" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white font-mono" />
              </div>
              <div>
                <label class="block text-[10px] text-on-surface-variant mb-1">黑白边容差比 (barRatio)</label>
                <input type="number" step="0.01" v-model.number="moduleParamsForm.barRatio" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white font-mono" />
              </div>
              <div>
                <label class="block text-[10px] text-on-surface-variant mb-1">清晰度拉普拉斯方差 (minLaplacianVar)</label>
                <input type="number" step="1" v-model.number="moduleParamsForm.minLaplacianVar" class="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-white font-mono" />
              </div>
            </div>

            <div class="flex items-center gap-4 pt-1">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" v-model="editingModule.enabled" class="rounded" />
                <span class="text-white">启用此工作流节点</span>
              </label>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-outline-variant">
          <button
            @click="editingModule = null"
            class="px-4 py-2 rounded-xl bg-surface-low text-on-surface-variant hover:text-white text-xs cursor-pointer"
          >
            取消
          </button>
          <button
            @click="saveModule"
            :disabled="savingModule"
            class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium cursor-pointer"
          >
            {{ savingModule ? '保存中...' : '保存工作流节点' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗 6：新建/克隆自定义工作流弹窗 ================= -->
    <div v-if="editingMountPoint" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="w-full max-w-md rounded-2xl bg-surface border border-outline-variant p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-outline-variant pb-3">
          <h3 class="text-sm font-bold text-white">{{ editingMountPoint.clone_from_id ? `克隆工作流 (源自 ${editingMountPoint.clone_from_id})` : '新建自定义工作流 / 挂载点' }}</h3>
          <button @click="editingMountPoint = null" class="text-on-surface-variant hover:text-white cursor-pointer">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block text-on-surface-variant mb-1">工作流 ID (英文标识)</label>
            <input
              v-model="editingMountPoint.id"
              placeholder="如: wf_video_smart_slice"
              class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono"
            />
          </div>
          <div>
            <label class="block text-on-surface-variant mb-1">工作流名称</label>
            <input
              v-model="editingMountPoint.name"
              placeholder="如: 视频智能镜头切片与关键帧打标流"
              class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">所属业务域 (Domain)</label>
              <select
                v-model="editingMountPoint.category"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              >
                <option value="ingest">ingest (入库治理域)</option>
                <option value="edit">edit (图像精准修改域)</option>
                <option value="video">video (视频与媒体处理域)</option>
                <option value="studio">studio (多模态创作域)</option>
              </select>
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">触发类型</label>
              <select
                v-model="editingMountPoint.trigger_type"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              >
                <option value="api">API 接口调用 (api)</option>
                <option value="event">系统事件驱动 (event)</option>
                <option value="cron">定时调度 (cron)</option>
                <option value="manual">后台手动触发 (manual)</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-on-surface-variant mb-1">流程用途描述</label>
            <textarea
              v-model="editingMountPoint.description"
              rows="3"
              placeholder="简述该工作流的输入、处理节点与预期产物..."
              class="w-full p-2.5 rounded-xl bg-surface-low border border-outline-variant text-white"
            ></textarea>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-outline-variant">
          <button
            @click="editingMountPoint = null"
            class="px-4 py-2 rounded-xl bg-surface-low text-on-surface-variant hover:text-white text-xs cursor-pointer"
          >
            取消
          </button>
          <button
            @click="saveMountPoint"
            :disabled="savingMountPoint"
            class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium cursor-pointer"
          >
            {{ savingMountPoint ? '保存中...' : '创建工作流' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗 7：模型契约编辑/新建弹窗 (含模型方言三开关 + 专属优化器 + 叠加积木试跑) ================= -->
    <div v-if="editingModel" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="w-full max-w-3xl rounded-2xl bg-surface border border-outline-variant p-5 space-y-4 shadow-2xl max-h-[92vh] flex flex-col">
        <div class="flex items-center justify-between border-b border-outline-variant pb-3">
          <div>
            <h3 class="text-sm font-bold text-white">{{ isNewModel ? '新建模型契约' : `编辑模型契约: ${editingModel.name}` }}</h3>
            <p class="text-[11px] text-on-surface-variant">配置模型路由、方言三开关（自动转译选区/参考图/负向词）及专属提示词优化器（一事一办）</p>
          </div>
          <button @click="editingModel = null" class="text-on-surface-variant hover:text-white cursor-pointer">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div class="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
          <!-- 一、基础路由信息 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">模型 ID (系统内部代号)</label>
              <input
                v-model="editingModel.id"
                :disabled="!isNewModel"
                placeholder="如: seedream5pro"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono disabled:opacity-50"
              />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">显示名称</label>
              <input
                v-model="editingModel.name"
                placeholder="如: Seedream 5.0 Pro"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white"
              />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">厂商物理模型 ID (vendor_model_id)</label>
              <input
                v-model="editingModel.vendor_model_id"
                placeholder="如: doubao-seedream-5-0-260128"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono"
              />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">挂载供应商接入点能力</label>
              <select
                v-model="editingModel.capability_id"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono"
              >
                <option v-for="cap in availableCapabilities" :key="cap.id" :value="cap.id">
                  {{ cap.name }} ({{ cap.id }})
                </option>
              </select>
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">专用协议转换器 (Converter)</label>
              <select
                v-model="editingModel.converter"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono"
              >
                <option value="">自动推断 (按能力/厂商)</option>
                <option value="ark-seedream">ark-seedream (火山方舟 Seedream 5.0 协议)</option>
                <option value="agnes-image">agnes-image (Agnes Image extra_body 协议)</option>
                <option value="ark-seedance-video">ark-seedance-video (火山 Seedance content[] 协议)</option>
                <option value="agnes-video">agnes-video (Agnes Video first/last/refer 协议)</option>
                <option value="doubao-music">doubao-music (豆包音乐 AK/SK GenSong/GenBGM)</option>
                <option value="qwenimage-local">qwenimage-local (局域网 Qwen 32倍数对齐协议)</option>
              </select>
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">熔断故障转移备选模型 (Failover Model)</label>
              <select
                v-model="editingModel.failover_model_id"
                class="w-full px-3 py-2 rounded-xl bg-surface-low border border-outline-variant text-white font-mono"
              >
                <option value="">无自动降级 (直接报错)</option>
                <option v-for="cand in modelsList.filter(x => x.id !== editingModel.id)" :key="cand.id" :value="cand.id">
                  {{ cand.name }} ({{ cand.id }})
                </option>
              </select>
            </div>
          </div>

          <!-- 二、模型方言三开关 (Dialect Three Switches) -->
          <div v-if="editingModel.dialect" class="p-3.5 rounded-xl bg-surface-low border border-cyan/35 space-y-3">
            <div>
              <span class="text-xs font-bold text-cyan">⚙️ 模型方言三开关 (决定工作流任务提示词如何自动转译给该模型)</span>
              <p class="text-[11px] text-on-surface-variant mt-0.5">业务提示词只需写一次标准占位符，编译器会根据以下三个开关自动转换为该模型支持的格式</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-white font-semibold mb-1">开关 1：选区传递方式 (region_mode)</label>
                <select
                  v-model="editingModel.dialect.region_mode"
                  class="w-full px-2.5 py-2 rounded-lg bg-surface border border-outline-variant text-white text-xs"
                >
                  <option value="coords_bbox">坐标框写进正文 (&lt;bbox&gt;x1 y1 x2 y2&lt;/bbox&gt;)</option>
                  <option value="coords_point">坐标点写进正文 (&lt;point&gt;x y&lt;/point&gt;)</option>
                  <option value="mask">独立蒙版图通道 (黑白 PNG Mask)</option>
                  <option value="vlm_text">不支持选区，自动调 VLM 转九宫格文字描述</option>
                </select>
              </div>
              <div>
                <label class="block text-white font-semibold mb-1">开关 2：参考图称呼记号 (ref_syntax)</label>
                <select
                  v-model="editingModel.dialect.ref_syntax"
                  class="w-full px-2.5 py-2 rounded-lg bg-surface border border-outline-variant text-white text-xs"
                >
                  <option value="图N">图1 / 参考图2 (火山 Seedream 格式)</option>
                  <option value="<Picture N>">&lt;Picture 1&gt; (Agnes 官方格式)</option>
                  <option value="@图片N">@图片1 / @图片2 (通用占位符)</option>
                </select>
              </div>
              <div>
                <label class="block text-white font-semibold mb-1">开关 3：负向提示词通道 (negative_mode)</label>
                <select
                  v-model="editingModel.dialect.negative_mode"
                  class="w-full px-2.5 py-2 rounded-lg bg-surface border border-outline-variant text-white text-xs"
                >
                  <option value="append_prompt">无独立字段，自动转“严禁出现：...”拼入正文末尾</option>
                  <option value="field">走独立 negative_prompt 参数字段</option>
                </select>
              </div>
            </div>
          </div>

          <!-- 二点五、零黑盒全量参数契约矩阵与折叠高级配置抽屉 -->
          <div class="p-3.5 rounded-xl bg-surface-low border border-outline-variant space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span class="text-xs font-bold text-white">🎛️ 参数契约矩阵 (Params Matrix · 共 {{ (editingModel.params || []).length }} 项)</span>
                <p class="text-[10px] text-on-surface-variant">
                  统一管理客户端外露层级 (常用直出 vs 高级折叠)、提交位置 (请求体 / 换算表 / 提示词 / 仅前端控制) 与深层字段转译
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  @click="addModelParamRow"
                  class="px-2.5 py-1 rounded-lg bg-primary hover:bg-primary-dim text-white text-[11px] font-medium cursor-pointer"
                >
                  + 新增参数
                </button>
                <button
                  type="button"
                  @click="modelDrawerTab = modelDrawerTab === 'slots' ? '' : 'slots'"
                  class="px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer"
                  :class="modelDrawerTab === 'slots' ? 'bg-primary/20 border-primary text-white' : 'bg-surface border-outline-variant text-on-surface-variant hover:text-white'"
                >
                  🗂️ 模式与参考槽位
                </button>
                <button
                  type="button"
                  @click="modelDrawerTab = modelDrawerTab === 'table' ? '' : 'table'"
                  class="px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer"
                  :class="modelDrawerTab === 'table' ? 'bg-primary/20 border-primary text-white' : 'bg-surface border-outline-variant text-on-surface-variant hover:text-white'"
                >
                  📐 二维尺寸换算表 ({{ Object.keys(editingModel.table_mappings?.size_ratio || {}).length }})
                </button>
                <button
                  type="button"
                  @click="modelDrawerTab = modelDrawerTab === 'rules' ? '' : 'rules'"
                  class="px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer"
                  :class="modelDrawerTab === 'rules' ? 'bg-primary/20 border-primary text-white' : 'bg-surface border-outline-variant text-on-surface-variant hover:text-white'"
                >
                  🔗 条件联动规则 ({{ (editingModel.conditional_rules || []).length }})
                </button>
                <button
                  type="button"
                  @click="runModelConvertPreview"
                  class="px-2.5 py-1 rounded-lg bg-cyan/15 hover:bg-cyan/25 text-cyan border border-cyan/30 text-[11px] font-medium cursor-pointer"
                >
                  👁️ 载荷转译预览
                </button>
              </div>
            </div>

            <!-- 参数列表：主行简洁，右侧带 [⚙ 映射] 展开深层 body_field / cast / options -->
            <div v-if="!(editingModel.params || []).length" class="text-[11px] text-outline py-2 text-center">
              当前模型无附加参数（如纯文本对话模型），可点击右上角「+ 新增参数」添加
            </div>
            <div v-else class="space-y-2 max-h-64 overflow-y-auto pr-1">
              <div
                v-for="(p, pIdx) in editingModel.params"
                :key="pIdx"
                class="p-2.5 rounded-xl bg-surface border border-outline-variant space-y-2"
              >
                <div class="grid grid-cols-2 sm:grid-cols-6 gap-2 items-center">
                  <input
                    v-model="p.key"
                    placeholder="参数 key (如 size)"
                    class="px-2 py-1 rounded bg-surface-low border border-outline-variant text-white font-mono text-[11px]"
                  />
                  <input
                    v-model="p.label"
                    placeholder="中文名 (如 尺寸档)"
                    class="px-2 py-1 rounded bg-surface-low border border-outline-variant text-white text-[11px]"
                  />
                  <select
                    v-model="p.type"
                    class="px-2 py-1 rounded bg-surface-low border border-outline-variant text-white text-[11px]"
                  >
                    <option value="enum">enum (枚举)</option>
                    <option value="boolean">boolean (开关)</option>
                    <option value="number">number (数值)</option>
                    <option value="duration">duration (时长滑轨)</option>
                    <option value="string">string (字符串)</option>
                    <option value="text">text (文本框)</option>
                  </select>
                  <select
                    v-model="p.visibility"
                    class="px-2 py-1 rounded bg-surface-low border border-outline-variant text-white text-[11px]"
                  >
                    <option value="public">常用外露 (public)</option>
                    <option value="advanced">高级折叠 (advanced)</option>
                  </select>
                  <select
                    v-model="p.location"
                    class="px-2 py-1 rounded bg-surface-low border border-outline-variant text-white text-[11px]"
                  >
                    <option value="body">写请求体 (body)</option>
                    <option value="table">查换算表 (table)</option>
                    <option value="prompt">拼提示词 (prompt)</option>
                    <option value="none">仅前端控制 (none)</option>
                  </select>
                  <div class="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      @click="expandedParamRows[pIdx] = !expandedParamRows[pIdx]"
                      class="px-2 py-1 rounded bg-surface-low hover:bg-surface-high text-[10px] text-cyan border border-outline-variant cursor-pointer"
                    >
                      {{ expandedParamRows[pIdx] ? '收起映射' : '⚙ 映射/枚举' }}
                    </button>
                    <button
                      type="button"
                      @click="editingModel.params.splice(pIdx, 1)"
                      class="px-1.5 py-1 rounded bg-err/10 hover:bg-err/20 text-err text-[10px] cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <!-- 展开的单参数深层映射抽屉 -->
                <div v-if="expandedParamRows[pIdx]" class="pt-2 border-t border-outline-variant grid grid-cols-1 sm:grid-cols-4 gap-2 text-[11px]">
                  <div>
                    <label class="block text-on-surface-variant text-[10px] mb-0.5">请求体目标字段 (支持点号深层路径)</label>
                    <input
                      v-model="p.body_field"
                      placeholder="如 extra_body.response_format"
                      class="w-full px-2 py-1 rounded bg-surface-low border border-outline-variant text-white font-mono"
                    />
                  </div>
                  <div>
                    <label class="block text-on-surface-variant text-[10px] mb-0.5">默认值 (default)</label>
                    <input
                      v-model="p.default"
                      placeholder="默认值"
                      class="w-full px-2 py-1 rounded bg-surface-low border border-outline-variant text-white font-mono"
                    />
                  </div>
                  <div>
                    <label class="block text-on-surface-variant text-[10px] mb-0.5">类型强转 / 大小写 (cast / transform)</label>
                    <div class="flex gap-1">
                      <select v-model="p.cast" class="w-1/2 px-1.5 py-1 rounded bg-surface-low border border-outline-variant text-white">
                        <option value="">不强转</option>
                        <option value="string">转 String</option>
                        <option value="number">转 Number</option>
                        <option value="boolean">转 Boolean</option>
                      </select>
                      <select v-model="p.transform" class="w-1/2 px-1.5 py-1 rounded bg-surface-low border border-outline-variant text-white">
                        <option value="">原样</option>
                        <option value="uppercase">转大写</option>
                        <option value="lowercase">转小写</option>
                      </select>
                    </div>
                  </div>
                  <div v-if="p.type === 'enum'">
                    <label class="block text-on-surface-variant text-[10px] mb-0.5">枚举候选值 (逗号分隔)</label>
                    <input
                      :value="(p.options || []).join(', ')"
                      @change="p.options = $event.target.value.split(',').map(s => s.trim()).filter(Boolean)"
                      placeholder="1K, 1.5K, 2K"
                      class="w-full px-2 py-1 rounded bg-surface-low border border-outline-variant text-white font-mono"
                    />
                  </div>
                  <div v-else-if="p.type === 'number' || p.type === 'duration'" class="flex gap-1">
                    <div class="w-1/2">
                      <label class="block text-on-surface-variant text-[10px] mb-0.5">Min</label>
                      <input type="number" v-model.number="p.min" class="w-full px-2 py-1 rounded bg-surface-low border border-outline-variant text-white font-mono" />
                    </div>
                    <div class="w-1/2">
                      <label class="block text-on-surface-variant text-[10px] mb-0.5">Max</label>
                      <input type="number" v-model.number="p.max" class="w-full px-2 py-1 rounded bg-surface-low border border-outline-variant text-white font-mono" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 抽屉 A：模式与多模态参考槽位 (modes & slots) -->
            <div v-if="modelDrawerTab === 'slots'" class="p-3 rounded-xl bg-canvas border border-outline-variant space-y-2.5">
              <div class="text-xs font-bold text-cyan">🗂️ 多模态参考槽位上限 (Slots) 与可用创作模式 (Modes)</div>
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-[10px] text-on-surface-variant mb-1">最大参考图片数 (slots.images)</label>
                  <input type="number" v-model.number="editingModel.slots.images" class="w-full px-2.5 py-1.5 rounded bg-surface border border-outline-variant text-white font-mono" />
                </div>
                <div>
                  <label class="block text-[10px] text-on-surface-variant mb-1">最大参考视频数 (slots.videos)</label>
                  <input type="number" v-model.number="editingModel.slots.videos" class="w-full px-2.5 py-1.5 rounded bg-surface border border-outline-variant text-white font-mono" />
                </div>
                <div>
                  <label class="block text-[10px] text-on-surface-variant mb-1">最大参考音频数 (slots.audios)</label>
                  <input type="number" v-model.number="editingModel.slots.audios" class="w-full px-2.5 py-1.5 rounded bg-surface border border-outline-variant text-white font-mono" />
                </div>
              </div>
              <div>
                <label class="block text-[10px] text-on-surface-variant mb-1">提示词栏下方缩写提示 (polishHint)</label>
                <input v-model="editingModel.polishHint" class="w-full px-2.5 py-1.5 rounded bg-surface border border-outline-variant text-white" />
              </div>
            </div>

            <!-- 抽屉 B：二维尺寸换算表编辑器 (table_mappings.size_ratio) -->
            <div v-if="modelDrawerTab === 'table'" class="p-3 rounded-xl bg-canvas border border-outline-variant space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-cyan">📐 二维尺寸换算表 (size_ratio: 尺寸档_宽高比 -> 像素值)</span>
                <button
                  type="button"
                  @click="addSizeTableEntry"
                  class="px-2 py-0.5 rounded bg-primary/20 text-primary-dim text-[11px] cursor-pointer"
                >
                  + 新增换算项
                </button>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                <div
                  v-for="(val, key) in (editingModel.table_mappings?.size_ratio || {})"
                  :key="key"
                  class="flex items-center gap-1.5 p-1.5 rounded bg-surface border border-outline-variant font-mono text-[11px]"
                >
                  <span class="text-cyan shrink-0">{{ key }}=</span>
                  <input
                    :value="typeof val === 'object' ? `${val.width}x${val.height}` : val"
                    @change="updateSizeTableEntry(key, $event.target.value)"
                    class="w-full px-1.5 py-0.5 rounded bg-surface-low text-white border border-outline-variant"
                  />
                  <button type="button" @click="delete editingModel.table_mappings.size_ratio[key]" class="text-err cursor-pointer">✕</button>
                </div>
              </div>
            </div>

            <!-- 抽屉 C：条件联动规则编辑器 (conditional_rules JSON 可视化) -->
            <div v-if="modelDrawerTab === 'rules'" class="p-3 rounded-xl bg-canvas border border-outline-variant space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-cyan">🔗 条件联动与互斥规则 (conditional_rules · 支持 when -> set / lock / suppress / force)</span>
              </div>
              <textarea
                :value="JSON.stringify(editingModel.conditional_rules || [], null, 2)"
                @change="onConditionalRulesJsonChange($event.target.value)"
                rows="6"
                class="w-full p-2.5 rounded-lg bg-surface border border-outline-variant text-white font-mono text-[11px]"
              ></textarea>
            </div>

            <!-- 抽屉 D：统一转译器与协议载荷实时预览 -->
            <div v-if="modelConvertPreview" class="p-3 rounded-xl bg-canvas border border-ok/40 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-ok">🚀 统一转译器与专用协议转换器编译结果预览</span>
                <button type="button" @click="modelConvertPreview = null" class="text-[11px] text-on-surface-variant underline cursor-pointer">收起</button>
              </div>
              <pre class="p-2.5 rounded bg-surface-low font-mono text-[11px] text-ok overflow-x-auto max-h-56">{{ JSON.stringify(modelConvertPreview, null, 2) }}</pre>
            </div>
          </div>

          <!-- 三、模型专属提示词优化器 Skill (一事一办) 与试跑 -->
          <div v-if="editingModel.optimizer" class="p-3.5 rounded-xl bg-surface-low border border-outline-variant space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span class="font-bold text-white">✨ 模型专属提示词优化器 (Prompt Optimizer · 按官方文档一事一办)</span>
                <p class="text-[10px] text-on-surface-variant">已移除强制写死的“室内设计”紧箍咒，保持该模型官方重写指南的纯粹性；画室内时按需叠加《室内实拍真实感》积木</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-on-surface-variant">改写大模型:</span>
                <select
                  v-model="editingModel.optimizer.optimizer_model_id"
                  class="px-2.5 py-1 rounded-lg bg-surface border border-outline-variant text-white font-mono text-xs"
                >
                  <option v-for="tm in availableTextModels" :key="tm.id" :value="tm.id">
                    {{ tm.name }} ({{ tm.id }})
                  </option>
                </select>
                <button
                  v-if="editingModel.optimizer.has_official"
                  type="button"
                  @click="restoreOfficialSkill"
                  class="px-2 py-1 rounded-lg bg-primary/15 text-primary-dim hover:bg-primary/25 text-[11px] cursor-pointer"
                >
                  恢复官方默认
                </button>
              </div>
            </div>

            <textarea
              v-model="editingModel.optimizer.prompt"
              rows="8"
              placeholder="在此输入专为该生成模型定制的官方提示词优化系统指令 (System Prompt)..."
              class="w-full p-3 rounded-xl bg-surface border border-outline-variant text-white font-mono text-xs leading-relaxed"
            ></textarea>

            <!-- 快捷试跑模块 (支持勾选叠加公共积木) -->
            <div class="pt-2 border-t border-outline-variant space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="font-medium text-on-surface-variant">优化器即时试跑 Playground</div>
                <label class="flex items-center gap-1.5 cursor-pointer text-[11px] text-ok">
                  <input type="checkbox" v-model="testIncludeRealism" class="rounded" />
                  <span>☑ 试跑时叠加《🧱 室内实拍真实感与反塑料感》公共积木</span>
                </label>
              </div>
              <div class="flex gap-2">
                <input
                  v-model="testPromptInput"
                  placeholder="输入简短原提示词测试改写效果，例如：现代极简客厅，皮质沙发"
                  class="flex-1 px-3 py-1.5 rounded-xl bg-surface border border-outline-variant text-white"
                />
                <button
                  type="button"
                  @click="runTestRewrite"
                  :disabled="testingRewrite || !testPromptInput"
                  class="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-dim disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
                >
                  {{ testingRewrite ? '改写中...' : '测试改写' }}
                </button>
              </div>
              <div v-if="testRewriteResult" class="p-2.5 rounded-xl bg-canvas border border-ok/30 text-xs text-ok font-mono whitespace-pre-wrap">
                {{ testRewriteResult }}
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between pt-3 border-t border-outline-variant">
          <button
            v-if="!isNewModel"
            @click="deleteModelContract(editingModel)"
            class="px-3 py-2 rounded-xl bg-err/10 hover:bg-err/20 text-err text-xs cursor-pointer"
          >
            删除模型契约
          </button>
          <div class="flex items-center gap-2 ml-auto">
            <button
              @click="editingModel = null"
              class="px-4 py-2 rounded-xl bg-surface-low text-on-surface-variant hover:text-white text-xs cursor-pointer"
            >
              取消
            </button>
            <button
              @click="saveModelContract"
              :disabled="savingModel"
              class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium cursor-pointer"
            >
              {{ savingModel ? '保存中...' : '保存模型契约' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= 弹窗 8：单节点选图真机沙盒试跑与编译载荷预览弹窗 ================= -->
    <div v-if="sandboxModalNode" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="w-full max-w-4xl rounded-2xl bg-surface border border-outline-variant p-5 space-y-4 shadow-2xl max-h-[92vh] flex flex-col">
        <div class="flex items-center justify-between border-b border-outline-variant pb-3">
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-2">
              <span>🧪 工作流节点单步沙盒实测与编译预览：{{ sandboxModalNode.name }}</span>
              <span class="text-xs font-mono px-2 py-0.5 rounded bg-cyan/15 text-cyan">[{{ sandboxModalNode.node_type }}]</span>
            </h3>
            <p class="text-[11px] text-on-surface-variant">
              即时查看该节点拼入「动态词典芯片 + 公共提示词积木 + 模型三开关转译」后的完整载荷，并可挑选素材库资产发起单步真机试跑
            </p>
          </div>
          <button @click="sandboxModalNode = null" class="text-on-surface-variant hover:text-white cursor-pointer">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div class="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
          <!-- 选择 1~3 张已有素材图与触发按钮 (沙盒只读回滚，不写正式库) -->
          <div class="p-3 rounded-xl bg-surface-low border border-outline-variant space-y-2.5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span class="text-white font-semibold">选择 1~3 张已有素材图进行沙盒试跑</span>
                <span class="ml-2 text-[11px] text-cyan">(已选 {{ sandboxAssetFids.length }} / 3 张 · 试跑带当前未保存草稿，不修改正式库)</span>
              </div>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  @click="pickRandomSampleAssets(2)"
                  class="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-high text-on-surface-variant hover:text-white border border-outline-variant text-[11px] cursor-pointer"
                >
                  随机选 2 张
                </button>
                <button
                  type="button"
                  @click="pickRandomSampleAssets(3)"
                  class="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-high text-on-surface-variant hover:text-white border border-outline-variant text-[11px] cursor-pointer"
                >
                  随机选 3 张
                </button>
                <button
                  @click="runNodeSandboxTest(false)"
                  :disabled="sandboxRunning"
                  class="px-3 py-1.5 rounded-xl bg-surface hover:bg-surface-high text-cyan border border-cyan/30 font-medium cursor-pointer"
                >
                  👁️ 仅编译预览载荷
                </button>
                <button
                  @click="runNodeSandboxTest(true)"
                  :disabled="sandboxRunning"
                  class="px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white font-medium cursor-pointer flex items-center gap-1"
                >
                  <span>{{ sandboxRunning ? '正在调用真机算子...' : '🚀 真机试跑 (1~3张)' }}</span>
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-36 overflow-y-auto pt-1">
              <label
                v-for="a in sampleAssets"
                :key="a.fid"
                class="p-2 rounded-lg border flex items-center gap-2 cursor-pointer transition"
                :class="sandboxAssetFids.includes(a.fid) ? 'bg-primary/15 border-primary text-white' : 'bg-surface border-outline-variant text-on-surface-variant hover:border-outline'"
              >
                <input
                  type="checkbox"
                  :checked="sandboxAssetFids.includes(a.fid)"
                  @change="toggleSandboxAssetFid(a.fid)"
                  class="rounded accent-primary"
                />
                <span class="truncate font-mono text-[11px]">[{{ a.category || 'interior' }}] {{ a.file_name || a.fid }}</span>
              </label>
            </div>
          </div>

          <div v-if="sandboxResult" class="space-y-3">
            <!-- 编译后信息摘要 -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <div class="p-2.5 rounded-xl bg-surface-low border border-outline-variant">
                <span class="text-[10px] text-on-surface-variant block">目标执行模型 & 方言三开关</span>
                <span class="font-mono text-white font-bold">{{ sandboxResult.compiled?.modelId || '(本地算法节点)' }}</span>
                <div v-if="sandboxResult.compiled?.dialect" class="text-[10px] text-cyan mt-0.5 font-mono">
                  选区:{{ sandboxResult.compiled.dialect.region_mode }} | 参考:{{ sandboxResult.compiled.dialect.ref_syntax }} | 负向:{{ sandboxResult.compiled.dialect.negative_mode }}
                </div>
              </div>
              <div class="p-2.5 rounded-xl bg-surface-low border border-outline-variant">
                <span class="text-[10px] text-on-surface-variant block">已叠加的公共提示词积木</span>
                <span v-if="sandboxResult.compiled?.snippetsUsed?.length" class="text-ok font-bold">
                  {{ sandboxResult.compiled.snippetsUsed.map(s => '🧱' + s.name).join('、') }}
                </span>
                <span v-else class="text-outline">无公共积木叠加</span>
              </div>
              <div class="p-2.5 rounded-xl bg-surface-low border border-outline-variant">
                <span class="text-[10px] text-on-surface-variant block">测试素材快照</span>
                <span v-if="sandboxResult.asset" class="font-mono text-white">
                  {{ sandboxResult.asset.file_name }} ({{ sandboxResult.asset.category }}) · 耗时 {{ sandboxResult.duration_ms }}ms
                </span>
              </div>
            </div>

            <!-- 编译后的完整正向与负向 Prompt -->
            <div class="p-3 rounded-xl bg-canvas border border-outline-variant space-y-2">
              <div class="flex items-center justify-between">
                <span class="font-bold text-cyan">最终下发给模型的完整编译 Prompt ({{ (sandboxResult.compiled?.prompt || '').length }} 字符)</span>
              </div>
              <div class="p-2.5 rounded-lg bg-surface-low font-mono text-[11px] text-white whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
                {{ sandboxResult.compiled?.prompt || '(该节点无需 Prompt)' }}
              </div>
              <div v-if="sandboxResult.compiled?.negativePrompt" class="p-2 rounded-lg bg-err/10 border border-err/25 font-mono text-[11px] text-err">
                <strong>独立 Negative Prompt 字段:</strong> {{ sandboxResult.compiled.negativePrompt }}
              </div>
            </div>

            <!-- 1~3 张测试素材真机执行前后对比结果 -->
            <div v-if="sandboxResult.live_results && sandboxResult.live_results.length" class="space-y-3">
              <div
                v-for="(item, rIdx) in sandboxResult.live_results"
                :key="item.asset?.fid || rIdx"
                class="p-3 rounded-xl bg-surface-low border border-outline-variant space-y-2"
              >
                <div class="flex items-center justify-between text-xs font-mono">
                  <span class="font-bold text-white">样本 #{{ rIdx + 1 }}: {{ item.asset?.file_name || item.asset?.fid }} ({{ item.asset?.category }})</span>
                  <span class="text-cyan">耗时 {{ item.duration_ms }}ms · 正式库零改动</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div class="space-y-1">
                    <div class="font-bold text-on-surface-variant text-[11px]">📌 线上库内原标签/状态 (Before)</div>
                    <pre class="p-2 rounded bg-canvas font-mono text-[11px] text-on-surface-variant overflow-x-auto max-h-52">{{ JSON.stringify(item.before, null, 2) }}</pre>
                  </div>
                  <div class="space-y-1">
                    <div class="font-bold text-ok text-[11px]">✨ 本次节点沙盒试跑输出 (After)</div>
                    <pre class="p-2 rounded bg-canvas font-mono text-[11px] text-ok overflow-x-auto max-h-52">{{ JSON.stringify(item.live_result, null, 2) }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end pt-3 border-t border-outline-variant">
          <button
            @click="sandboxModalNode = null"
            class="px-4 py-2 rounded-xl bg-surface-low text-white text-xs cursor-pointer"
          >
            关闭沙盒窗口
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'

const activeTab = ref('workflows')
const loading = ref(false)
const error = ref('')
const successMsg = ref('')

function normalizeArray(res) {
  if (Array.isArray(res)) return res
  if (Array.isArray(res?.data)) return res.data
  return []
}

// 1. 供应商管理与 .env 统一密钥中枢状态
const providersList = ref([])
const expandedEndpoints = ref({})
const editingProvider = ref(null)
const isNewProvider = ref(false)
const savingProvider = ref(false)
const providerCredentialsInput = ref('')
const showEnvSecretsPanel = ref(false)
const envSecretsList = ref([])
const envSecretsDraft = ref({})
const savingEnvSecrets = ref(false)

// 模型契约零黑盒扩展状态
const expandedParamRows = ref({})
const modelDrawerTab = ref('')
const modelConvertPreview = ref(null)

// 2. 模型管理与三开关状态
const modelsList = ref([])
const availableCapabilities = ref([])
const editingModel = ref(null)
const isNewModel = ref(false)
const savingModel = ref(false)
const testIncludeRealism = ref(true)

const MODEL_SECTION_DEFS = [
  { id: 'image', label: '生图', match: (k) => k === 'image' },
  { id: 'video', label: '生视频', match: (k) => k === 'video' },
  { id: 'audio', label: '生音频', match: (k) => k === 'music' || k === 'audio' },
  { id: 'text', label: '文本与视觉理解 (VLM/LLM)', match: (k) => k === 'chat' || k === 'vision' },
]

function formatRegionMode(mode) {
  return {
    coords_bbox: 'bbox坐标框',
    coords_point: 'point坐标点',
    mask: 'Mask蒙版',
    vlm_text: 'VLM九宫格描述',
  }[mode] || mode
}

const modelSections = computed(() => {
  const used = new Set()
  const sections = MODEL_SECTION_DEFS.map((def) => {
    const items = modelsList.value.filter((m) => def.match(m.kind || 'image'))
    items.forEach((m) => used.add(m.id))
    return { id: def.id, label: def.label, items }
  })
  const rest = modelsList.value.filter((m) => !used.has(m.id))
  if (rest.length) sections.push({ id: 'other', label: '其他', items: rest })
  return sections.filter((s) => s.items.length)
})

const availableTextModels = computed(() => {
  const list = modelsList.value.filter(m => m.kind === 'chat' || m.kind === 'vision' || m.capability_id === 'litellm_chat')
  if (!list.some(m => m.id === 'agnes-3.0-flash')) {
    list.unshift({ id: 'agnes-3.0-flash', name: 'Agnes 3.0 Flash' })
  }
  return list
})

// 3. 提示词与公共积木中心状态
const snippetsList = ref([])
const editingSnippet = ref(null)
const isNewSnippet = ref(false)
const savingSnippet = ref(false)

const promptsList = ref([])
const dictMacroChips = ref([])
const activePromptCategory = ref('all')
const editingPrompt = ref(null)
const isNewPrompt = ref(false)
const savingPrompt = ref(false)
const promptTextareaRef = ref(null)
const promptCompilePreview = ref(null)

const promptCategories = [
  { id: 'all', label: '全部' },
  { id: 'gate', label: '门禁初筛' },
  { id: 'qc', label: '缺陷质检' },
  { id: 'tag', label: '四品类多维打标' },
  { id: 'restage', label: '双画幅净画重构' },
  { id: 'edit', label: '精准修改8算子' },
  { id: 'vlm', label: '选区VLM识别' },
  { id: 'walkthrough', label: '空间漫游' },
  { id: 'video', label: '视频分镜' },
]

const variableChips = [
  { expr: '{{@region}}', desc: '模型三开关选区占位符(自动转bbox或九宫格)' },
  { expr: '{{@ref_1}}', desc: '参考图1(自动转图1或<Picture 1>)' },
  { expr: '{{@ref_2}}', desc: '参考图2(自动转参考图2或<Picture 2>)' },
  { expr: '{{product_name}}', desc: '替换/安装单品名称' },
  { expr: '{{facing_desc}}', desc: '3D单品旋转朝向描述' },
  { expr: '{{target_style}}', desc: '目标重塑风格' },
  { expr: '{{$node["gate"].category}}', desc: '前序门禁判定分类' },
  { expr: '{{$node["tag"].space}}', desc: '前序打标空间类型' },
  { expr: '{{asset.file_name}}', desc: '素材文件名' },
]

const filteredPrompts = computed(() => {
  if (activePromptCategory.value === 'all') return promptsList.value
  return promptsList.value.filter(p => p.category === activePromptCategory.value)
})

function countPromptsByCategory(catId) {
  if (catId === 'all') return promptsList.value.length
  return promptsList.value.filter(p => p.category === catId).length
}

function snippetNameOf(id) {
  const hit = snippetsList.value.find(s => s.id === id)
  return hit ? hit.name : id
}

// 4. 动态标签词典状态
const dictTags = ref([])
const selectedDictDim = ref('style_atom')
const editingDictTag = ref(null)

const dictDimensions = [
  { key: 'space', label: '空间类型 (space)' },
  { key: 'style_atom', label: '流派风格 (style_atom)' },
  { key: 'wood_style', label: '木系质感 (wood_style)' },
  { key: 'material_kind', label: '硬装/软装主材 (material_kind)' },
  { key: 'furniture_category', label: '家具大类 (furniture_category)' },
  { key: 'furniture_item', label: '家具单品 (furniture_item)' },
  { key: 'furniture_craft', label: '表面工艺 (furniture_craft)' },
  { key: 'furniture_form', label: '造型结构 (furniture_form)' },
  { key: 'classic_design', label: '名品款名 (classic_design)' },
  { key: 'clothing_category', label: '服装品类 (clothing_category)' },
  { key: 'clothing_style', label: '穿搭风格 (clothing_style)' },
  { key: 'season', label: '适穿季节 (season)' },
  { key: 'gender', label: '人像性别 (gender)' },
  { key: 'person_style', label: '人像气质 (person_style)' },
  { key: 'shot_type', label: '人像景别 (shot_type)' },
  { key: 'dominant_color', label: '12主色 (dominant_color)' },
]

const filteredDictTags = computed(() => {
  return dictTags.value.filter(t => t.dimension === selectedDictDim.value)
})

function formatAliases(raw) {
  if (!raw) return ''
  if (Array.isArray(raw)) return raw.join(', ')
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.join(', ') : String(raw)
  } catch {
    return String(raw)
  }
}

// 5. 工作流与工作流节点编排状态
const operatorsCatalog = ref([])
const mountPointsList = ref([])
const selectedMountPointId = ref('ingest_post_process')
const editingMountPoint = ref(null)
const isNewMountPoint = ref(false)
const savingMountPoint = ref(false)
const editingModule = ref(null)
const isNewModule = ref(false)
const savingModule = ref(false)
const moduleParamsForm = ref({})
const executingMountPoint = ref(false)
const workflowCompileReport = ref(null)

// 单节点真机沙盒状态 (支持勾选 1~3 张已有素材图)
const sandboxModalNode = ref(null)
const sandboxAssetFids = ref([])
const sandboxRunning = ref(false)
const sandboxResult = ref(null)
const sampleAssets = ref([])

function toggleSandboxAssetFid(fid) {
  const idx = sandboxAssetFids.value.indexOf(fid)
  if (idx >= 0) {
    sandboxAssetFids.value.splice(idx, 1)
  } else {
    if (sandboxAssetFids.value.length >= 3) {
      sandboxAssetFids.value.shift()
    }
    sandboxAssetFids.value.push(fid)
  }
}

function pickRandomSampleAssets(count = 2) {
  const pool = [...sampleAssets.value]
  sandboxAssetFids.value = pool.slice(0, Math.min(3, Math.max(1, count))).map(a => a.fid)
}

const conditionPresets = [
  { label: '无条件(默认串行)', expr: '' },
  { label: '室内/建筑分支', expr: "category == 'interior' || category == 'exterior'" },
  { label: '家具单品分支', expr: "category == 'furniture'" },
  { label: '服装穿搭分支', expr: "category == 'clothing'" },
  { label: '人物肖像分支', expr: "category == 'portrait'" },
  { label: '局部安装模式C', expr: "mode == 'C'" },
  { label: '模型需VLM描述选区', expr: "dialect.region_mode == 'vlm_text'" },
]

const groupedOperators = computed(() => {
  const groups = new Map()
  for (const op of operatorsCatalog.value) {
    const cat = op.category || 'other'
    if (!groups.has(cat)) {
      groups.set(cat, { category: cat, label: op.categoryLabel || cat, items: [] })
    }
    groups.get(cat).items.push(op)
  }
  return Array.from(groups.values())
})

const currentOperatorSpec = computed(() => {
  if (!editingModule.value?.node_type) return null
  return operatorsCatalog.value.find(op => op.type === editingModule.value.node_type || op.code === editingModule.value.node_type) || null
})

const selectedMountPoint = computed(() => {
  return mountPointsList.value.find(mp => mp.id === selectedMountPointId.value) || mountPointsList.value[0] || null
})

// 优化器试跑状态
const testPromptInput = ref('')
const testingRewrite = ref(false)
const testRewriteResult = ref('')

function switchTab(tab) {
  activeTab.value = tab
  refreshCurrentTab()
}

async function loadAll() {
  error.value = ''
  loading.value = true
  try {
    const [provRes, modRes, snipRes, promptRes, macroRes, opRes, mountRes, dictRes] = await Promise.all([
      api.providers().catch(() => []),
      api.genModels().catch(() => ({})),
      api.promptSnippets().catch(() => []),
      api.promptTemplates().catch(() => []),
      api.dictMacros().catch(() => []),
      api.operatorsCatalog().catch(() => []),
      api.mountPoints().catch(() => []),
      api.dict(true).catch(() => []),
    ])

    providersList.value = normalizeArray(provRes)

    const modelData = modRes?.models ? modRes : (modRes?.data || {})
    modelsList.value = modelData.models || []
    availableCapabilities.value = modelData.capabilities || []

    snippetsList.value = normalizeArray(snipRes)
    promptsList.value = normalizeArray(promptRes)
    dictMacroChips.value = normalizeArray(macroRes)
    operatorsCatalog.value = normalizeArray(opRes)
    mountPointsList.value = normalizeArray(mountRes)
    dictTags.value = Array.isArray(dictRes?.tags) ? dictRes.tags : normalizeArray(dictRes)

    if (!selectedMountPointId.value && mountPointsList.value.length) {
      selectedMountPointId.value = mountPointsList.value[0].id
    }
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function refreshCurrentTab() {
  error.value = ''
  loading.value = true
  try {
    if (activeTab.value === 'providers') {
      providersList.value = normalizeArray(await api.providers())
    } else if (activeTab.value === 'models') {
      const res = await api.genModels()
      const modelData = res?.models ? res : (res?.data || {})
      modelsList.value = modelData.models || []
      availableCapabilities.value = modelData.capabilities || []
    } else if (activeTab.value === 'prompts') {
      const [sRes, pRes, mRes] = await Promise.all([
        api.promptSnippets().catch(() => []),
        api.promptTemplates().catch(() => []),
        api.dictMacros().catch(() => []),
      ])
      snippetsList.value = normalizeArray(sRes)
      promptsList.value = normalizeArray(pRes)
      dictMacroChips.value = normalizeArray(mRes)
    } else if (activeTab.value === 'dictionary') {
      const dRes = await api.dict(true)
      dictTags.value = Array.isArray(dRes?.tags) ? dRes.tags : normalizeArray(dRes)
    } else if (activeTab.value === 'workflows') {
      const [mRes, sRes, pRes, opRes, mpRes] = await Promise.all([
        api.genModels().catch(() => ({})),
        api.promptSnippets().catch(() => []),
        api.promptTemplates().catch(() => []),
        api.operatorsCatalog().catch(() => []),
        api.mountPoints().catch(() => []),
      ])
      const modelData = mRes?.models ? mRes : (mRes?.data || {})
      modelsList.value = modelData.models || []
      availableCapabilities.value = modelData.capabilities || []
      snippetsList.value = normalizeArray(sRes)
      promptsList.value = normalizeArray(pRes)
      operatorsCatalog.value = normalizeArray(opRes)
      mountPointsList.value = normalizeArray(mpRes)
    }
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

// ================= 1. 供应商操作 =================
function toggleExpandEndpoint(id) {
  expandedEndpoints.value[id] = !expandedEndpoints.value[id]
}

async function toggleEndpoint(ep) {
  try {
    const next = !ep.enabled
    await api.toggleEndpoint(ep.id, next)
    ep.enabled = next
  } catch (e) {
    error.value = e.message
  }
}

function openNewProvider() {
  isNewProvider.value = true
  editingProvider.value = {
    id: '',
    name: '',
    base_url: '',
    auth_type: 'bearer',
    enabled: 1,
    credentials: [],
  }
  providerCredentialsInput.value = ''
}

function openEditProvider(ep) {
  isNewProvider.value = false
  editingProvider.value = JSON.parse(JSON.stringify(ep))
  const creds = ep.credentials || []
  providerCredentialsInput.value = creds.map(c => c.env || c.ak_env || c.tail || '').filter(Boolean).join(', ')
}

async function saveProvider() {
  if (!editingProvider.value?.id) return
  savingProvider.value = true
  try {
    const creds = providerCredentialsInput.value.split(',').map(s => s.trim()).filter(Boolean)
    await api.saveProvider({ ...editingProvider.value, credentials: creds })
    editingProvider.value = null
    successMsg.value = '接入点已成功保存'
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  } finally {
    savingProvider.value = false
  }
}

async function deleteProvider(ep) {
  if (!confirm(`确定要删除接入点 ${ep.name} (${ep.id}) 吗？`)) return
  try {
    await api.deleteProvider(ep.id)
    successMsg.value = `接入点 ${ep.id} 已删除`
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

// ================= 2. 模型契约与三开关操作 =================
function openNewModel() {
  isNewModel.value = true
  editingModel.value = {
    id: '',
    name: '',
    vendor_model_id: '',
    capability_id: availableCapabilities.value[0]?.id || 'ark_image',
    enabled: 1,
    params: [],
    dialect: {
      region_mode: 'coords_bbox',
      ref_syntax: '图N',
      negative_mode: 'append_prompt',
    },
    optimizer: {
      optimizer_model_id: 'agnes-3.0-flash',
      prompt: '',
    }
  }
}

async function openEnvSecretsDrawer() {
  showEnvSecretsPanel.value = !showEnvSecretsPanel.value
  if (showEnvSecretsPanel.value) {
    try {
      const res = await api.envSecrets()
      const data = res?.items ? res : (res?.data || {})
      envSecretsList.value = data.items || []
      envSecretsDraft.value = {}
    } catch (e) {
      error.value = e.message
    }
  }
}

async function saveEnvSecretsUpdates() {
  const updates = {}
  for (const [k, v] of Object.entries(envSecretsDraft.value || {})) {
    if (v && String(v).trim()) updates[k] = String(v).trim()
  }
  if (!Object.keys(updates).length) {
    error.value = '请先输入至少一项要更新的密钥值'
    return
  }
  savingEnvSecrets.value = true
  try {
    await api.saveEnvSecrets(updates)
    envSecretsDraft.value = {}
    const res = await api.envSecrets()
    const data = res?.items ? res : (res?.data || {})
    envSecretsList.value = data.items || []
    providersList.value = normalizeArray(await api.providers())
    successMsg.value = `已安全写入 .env 并热更新 ${Object.keys(updates).length} 项密钥`
  } catch (e) {
    error.value = e.message
  } finally {
    savingEnvSecrets.value = false
  }
}

function addModelParamRow() {
  if (!editingModel.value) return
  if (!Array.isArray(editingModel.value.params)) editingModel.value.params = []
  editingModel.value.params.push({
    key: 'custom_param',
    label: '自定义参数',
    type: 'enum',
    default: '',
    options: ['default'],
    visibility: 'public',
    location: 'body',
    body_field: 'custom_param',
  })
}

function addSizeTableEntry() {
  if (!editingModel.value) return
  if (!editingModel.value.table_mappings) editingModel.value.table_mappings = {}
  if (!editingModel.value.table_mappings.size_ratio) editingModel.value.table_mappings.size_ratio = {}
  const k = prompt('请输入「尺寸档_宽高比」键名（例如 2K_16:9）：', '2K_16:9')
  if (!k) return
  editingModel.value.table_mappings.size_ratio[k.trim()] = '2816x1584'
}

function updateSizeTableEntry(key, rawVal) {
  if (!editingModel.value?.table_mappings?.size_ratio) return
  editingModel.value.table_mappings.size_ratio[key] = String(rawVal || '').trim()
}

function onConditionalRulesJsonChange(raw) {
  try {
    editingModel.value.conditional_rules = JSON.parse(raw)
  } catch (e) {
    error.value = '条件规则 JSON 格式有误: ' + e.message
  }
}

async function runModelConvertPreview() {
  if (!editingModel.value) return
  try {
    const res = await api.previewModelConvert({
      model_id: editingModel.value.id,
      contract: editingModel.value,
      prompt: testPromptInput.value || '现代极简客厅，落地窗自然采光，@图片1 沙发细节保留',
    })
    modelConvertPreview.value = res?.assembled ? res : (res?.data || res)
  } catch (e) {
    error.value = e.message
  }
}

function openEditModel(m) {
  isNewModel.value = false
  expandedParamRows.value = {}
  modelDrawerTab.value = ''
  modelConvertPreview.value = null
  editingModel.value = JSON.parse(JSON.stringify(m))
  if (!editingModel.value.optimizer) {
    editingModel.value.optimizer = { optimizer_model_id: 'agnes-3.0-flash', prompt: '' }
  }
  if (!editingModel.value.dialect) {
    editingModel.value.dialect = { region_mode: 'coords_bbox', ref_syntax: '图N', negative_mode: 'append_prompt' }
  }
  if (!editingModel.value.slots) {
    editingModel.value.slots = { images: 6, videos: 0, audios: 0 }
  }
  if (!editingModel.value.table_mappings) {
    editingModel.value.table_mappings = {}
  }
  if (!Array.isArray(editingModel.value.conditional_rules)) {
    editingModel.value.conditional_rules = []
  }
  testPromptInput.value = ''
  testRewriteResult.value = ''
}

function restoreOfficialSkill() {
  if (editingModel.value?.optimizer?.official_prompt) {
    editingModel.value.optimizer.prompt = editingModel.value.optimizer.official_prompt
  }
}

async function runTestRewrite() {
  if (!testPromptInput.value || !editingModel.value) return
  testingRewrite.value = true
  testRewriteResult.value = ''
  try {
    const res = await api.optimizePrompt({
      prompt: testPromptInput.value,
      modelId: editingModel.value.id,
      mode: 'text_to_image',
      customSkillPrompt: editingModel.value.optimizer?.prompt || '',
      optimizerModelId: editingModel.value.optimizer?.optimizer_model_id || 'agnes-3.0-flash',
      includeInteriorRealism: testIncludeRealism.value,
      snippetIds: testIncludeRealism.value ? ['snippet_interior_realism'] : [],
    })
    testRewriteResult.value = res.optimized || res.prompt || res.data?.optimized || res.data?.prompt || JSON.stringify(res)
  } catch (e) {
    testRewriteResult.value = '试跑优化失败: ' + e.message
  } finally {
    testingRewrite.value = false
  }
}

async function saveModelContract() {
  if (!editingModel.value?.id) return
  savingModel.value = true
  try {
    await api.createGenModel(editingModel.value)
    editingModel.value = null
    successMsg.value = '模型契约与方言三开关已保存'
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  } finally {
    savingModel.value = false
  }
}

async function deleteModelContract(m) {
  if (!confirm(`确定要彻底删除模型契约 ${m.name} (${m.id}) 吗？`)) return
  try {
    await api.deleteGenModel(m.id)
    editingModel.value = null
    successMsg.value = `模型契约 ${m.id} 已删除`
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

// ================= 3. 公共积木与提示词中心操作 =================
function openNewSnippet() {
  isNewSnippet.value = true
  editingSnippet.value = {
    id: '',
    name: '',
    category: 'realism',
    description: '',
    positive_text: '',
    negative_text: '',
    enabled: 1,
  }
}

function openEditSnippet(snip) {
  isNewSnippet.value = false
  editingSnippet.value = JSON.parse(JSON.stringify(snip))
}

async function saveSnippet() {
  if (!editingSnippet.value?.id) return
  savingSnippet.value = true
  try {
    await api.savePromptSnippet(editingSnippet.value)
    editingSnippet.value = null
    successMsg.value = '公共提示词积木已保存并同步至所有关联节点'
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  } finally {
    savingSnippet.value = false
  }
}

async function restoreSnippetDefault(snip) {
  if (!confirm(`确定要将公共积木「${snip.name}」恢复为官方默认吗？`)) return
  try {
    await api.restorePromptSnippet(snip.id)
    successMsg.value = `公共积木 ${snip.name} 已恢复为官方默认`
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

async function deleteSnippet(snip) {
  if (!confirm(`确定要删除公共积木 ${snip.name} 吗？`)) return
  try {
    await api.deletePromptSnippet(snip.id)
    successMsg.value = `公共积木 ${snip.id} 已删除`
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

function openNewPrompt() {
  isNewPrompt.value = true
  promptCompilePreview.value = null
  editingPrompt.value = {
    id: '',
    name: '',
    category: 'custom',
    template: '',
    is_builtin: 0,
  }
}

function openEditPrompt(p) {
  isNewPrompt.value = false
  promptCompilePreview.value = null
  editingPrompt.value = JSON.parse(JSON.stringify(p))
}

function insertVariableChip(expr) {
  if (!editingPrompt.value) return
  const ta = promptTextareaRef.value
  if (!ta) {
    editingPrompt.value.template = (editingPrompt.value.template || '') + expr
    return
  }
  const start = ta.selectionStart || 0
  const end = ta.selectionEnd || 0
  const prev = editingPrompt.value.template || ''
  editingPrompt.value.template = prev.slice(0, start) + expr + prev.slice(end)
}

async function runPreviewPromptCompile() {
  if (!editingPrompt.value) return
  try {
    const res = await api.previewCompilePrompt({
      promptId: editingPrompt.value.id,
      promptTemplate: editingPrompt.value.template,
      category: editingPrompt.value.category,
    })
    promptCompilePreview.value = res
  } catch (e) {
    error.value = e.message
  }
}

async function restorePromptDefault(p) {
  if (!confirm(`确定要将提示词 ${p.name} 恢复为官方默认基线吗？`)) return
  try {
    const res = await api.restorePromptTemplate(p.id)
    p.template = res.template || res.data?.template || p.template
    if (editingPrompt.value && editingPrompt.value.id === p.id) {
      editingPrompt.value.template = p.template
    }
    successMsg.value = `提示词 ${p.name} 已成功恢复为官方默认并同步至工作流`
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

async function savePrompt() {
  if (!editingPrompt.value?.id) return
  savingPrompt.value = true
  try {
    await api.savePromptTemplate(editingPrompt.value)
    editingPrompt.value = null
    successMsg.value = '提示词已保存并自动同步至关联工作流'
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  } finally {
    savingPrompt.value = false
  }
}

async function deletePrompt(p) {
  if (!confirm(`确定要删除提示词 ${p.name} (${p.id}) 吗？`)) return
  try {
    await api.deletePromptTemplate(p.id)
    successMsg.value = `提示词 ${p.id} 已删除`
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

// ================= 4. 动态标签词典操作 =================
function openAddDictTag() {
  editingDictTag.value = {
    isNew: true,
    dimension: selectedDictDim.value,
    dir: '',
    label: '',
    aliasesInput: '',
    criteria: '',
  }
}

function openEditDictTag(tag) {
  editingDictTag.value = {
    isNew: false,
    id: tag.id,
    dimension: tag.dimension,
    dir: tag.dir,
    label: tag.label,
    aliasesInput: formatAliases(tag.aliases),
    criteria: tag.criteria || '',
  }
}

async function saveDictTag() {
  if (!editingDictTag.value?.dir || !editingDictTag.value?.label) return
  try {
    const aliases = editingDictTag.value.aliasesInput
      ? editingDictTag.value.aliasesInput.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      : []
    await api.saveTag({
      dimension: editingDictTag.value.dimension || selectedDictDim.value,
      dir: editingDictTag.value.dir.trim(),
      label: editingDictTag.value.label.trim(),
      aliases,
      criteria: editingDictTag.value.criteria.trim(),
    })
    editingDictTag.value = null
    successMsg.value = '标签词典已更新，所有 {{@dict.xxx}} 打标提示词已实时同步'
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

async function toggleDeprecateTag(tag, dep) {
  try {
    if (dep) {
      await api.deprecateTag({ dimension: tag.dimension, dir: tag.dir })
    } else {
      await api.restoreTag({ dimension: tag.dimension, dir: tag.dir })
    }
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

// ================= 5. 模块化工作流与工作流节点操作 =================
function openNewMountPoint(cloneFrom = null) {
  isNewMountPoint.value = true
  if (cloneFrom) {
    editingMountPoint.value = {
      id: `${cloneFrom.id}_copy`,
      name: `${cloneFrom.name} (克隆副本)`,
      category: cloneFrom.category || 'custom',
      description: cloneFrom.description || '',
      trigger_type: cloneFrom.trigger_type || 'api',
      clone_from_id: cloneFrom.id,
      is_builtin: 0,
    }
  } else {
    editingMountPoint.value = {
      id: '',
      name: '',
      category: 'video',
      description: '',
      trigger_type: 'api',
      is_builtin: 0,
    }
  }
}

async function saveMountPoint() {
  if (!editingMountPoint.value?.id) return
  savingMountPoint.value = true
  try {
    const id = editingMountPoint.value.id
    await api.saveMountPoint(editingMountPoint.value)
    editingMountPoint.value = null
    successMsg.value = '工作流已创建'
    await refreshCurrentTab()
    selectedMountPointId.value = id
  } catch (e) {
    error.value = e.message
  } finally {
    savingMountPoint.value = false
  }
}

async function deleteMountPointItem(mp) {
  if (!confirm(`确定要删除工作流「${mp.name}」及其包含的所有工作流节点吗？`)) return
  try {
    await api.deleteMountPoint(mp.id)
    successMsg.value = `工作流 ${mp.name} 已删除`
    await refreshCurrentTab()
    if (selectedMountPointId.value === mp.id && mountPointsList.value.length) {
      selectedMountPointId.value = mountPointsList.value[0].id
    }
  } catch (e) {
    error.value = e.message
  }
}

function onModuleOperatorChange() {
  const spec = currentOperatorSpec.value
  if (!spec || !editingModule.value) return
  if (isNewModule.value || !editingModule.value.name) {
    editingModule.value.name = spec.name
  }
  editingModule.value.model_id = spec.defaultModelId || null
  editingModule.value.prompt_id = spec.defaultPromptId || null
  editingModule.value.snippet_ids = Array.isArray(spec.defaultSnippets) ? [...spec.defaultSnippets] : []
  moduleParamsForm.value = {
    temperature: 0.1,
    timeoutMs: 30000,
    fallbackStrategy: 'manual_review',
    ...(spec.defaultParams || {}),
  }
}

function openNewModule() {
  isNewModule.value = true
  const defaultOp = operatorsCatalog.value.find(o => o.type === 'video_extract_frames') || operatorsCatalog.value[0]
  editingModule.value = {
    id: '',
    mount_point_id: selectedMountPointId.value,
    name: defaultOp?.name || '新建工作流节点',
    node_type: defaultOp?.type || 'gate',
    model_id: defaultOp?.defaultModelId || null,
    prompt_id: defaultOp?.defaultPromptId || null,
    prompt_override: '',
    condition_expr: '',
    snippet_ids: defaultOp?.defaultSnippets ? [...defaultOp.defaultSnippets] : [],
    enabled: 1,
  }
  moduleParamsForm.value = {
    temperature: 0.1,
    timeoutMs: 30000,
    fallbackStrategy: 'manual_review',
    phashThreshold: 8,
    barRatio: 0.06,
    minLaplacianVar: 35,
    ...(defaultOp?.defaultParams || {}),
  }
}

function openEditModule(mod) {
  isNewModule.value = false
  editingModule.value = JSON.parse(JSON.stringify(mod))
  if (!Array.isArray(editingModule.value.snippet_ids)) {
    editingModule.value.snippet_ids = []
  }
  moduleParamsForm.value = {
    temperature: 0.1,
    timeoutMs: 30000,
    fallbackStrategy: 'manual_review',
    ...(mod.params || {}),
  }
}

async function saveModule() {
  if (!editingModule.value) return
  savingModule.value = true
  try {
    const payload = {
      ...editingModule.value,
      mount_point_id: selectedMountPointId.value,
      params: moduleParamsForm.value,
    }
    await api.saveMountModule(selectedMountPointId.value, payload)
    editingModule.value = null
    successMsg.value = '工作流节点已保存并实时同步生效'
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  } finally {
    savingModule.value = false
  }
}

async function deleteModule(mod) {
  if (!confirm(`确定要从当前工作流中移除节点「${mod.name}」吗？`)) return
  try {
    await api.deleteMountModule(selectedMountPointId.value, mod.id)
    successMsg.value = `工作流节点 ${mod.name} 已移除`
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

async function moveModuleUp(idx) {
  const mods = selectedMountPoint.value?.modules || []
  if (idx <= 0 || idx >= mods.length) return
  const ordered = [...mods]
  const tmp = ordered[idx]
  ordered[idx] = ordered[idx - 1]
  ordered[idx - 1] = tmp
  try {
    await api.reorderMountModules(selectedMountPointId.value, ordered.map(m => m.id))
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

async function moveModuleDown(idx) {
  const mods = selectedMountPoint.value?.modules || []
  if (idx < 0 || idx >= mods.length - 1) return
  const ordered = [...mods]
  const tmp = ordered[idx]
  ordered[idx] = ordered[idx + 1]
  ordered[idx + 1] = tmp
  try {
    await api.reorderMountModules(selectedMountPointId.value, ordered.map(m => m.id))
    await refreshCurrentTab()
  } catch (e) {
    error.value = e.message
  }
}

async function executeTestMountPoint() {
  if (!selectedMountPointId.value) return
  executingMountPoint.value = true
  try {
    const res = await api.executeMountPoint(selectedMountPointId.value, {})
    workflowCompileReport.value = res
    successMsg.value = res.message || '工作流全节点真实编译校验完成'
  } catch (e) {
    error.value = e.message
  } finally {
    executingMountPoint.value = false
  }
}

async function openSandboxModal(mod) {
  sandboxModalNode.value = mod
  sandboxResult.value = null
  if (!sampleAssets.value.length) {
    try {
      const aRes = await api.assets({ limit: 12, page: 1 })
      sampleAssets.value = Array.isArray(aRes?.items) ? aRes.items : normalizeArray(aRes)
    } catch (_) {}
  }
  if (!sandboxAssetFids.value.length && sampleAssets.value.length) {
    sandboxAssetFids.value = sampleAssets.value.slice(0, 2).map(a => a.fid)
  }
  await runNodeSandboxTest(false)
}

async function runNodeSandboxTest(executeLive = false) {
  if (!sandboxModalNode.value) return
  sandboxRunning.value = true
  try {
    const mod = sandboxModalNode.value
    const fids = sandboxAssetFids.value.slice(0, 3)
    const res = await api.runNodeSandbox({
      mountPointId: selectedMountPointId.value,
      nodeId: mod.id,
      nodeType: mod.node_type,
      modelId: mod.model_id,
      promptId: mod.prompt_id,
      promptTemplate: mod.prompt_override,
      snippetIds: mod.snippet_ids,
      params: mod.params,
      draft_node: mod,
      asset_fids: fids.length ? fids : undefined,
      assetFid: fids[0] || undefined,
      executeLive,
    })
    sandboxResult.value = res
  } catch (e) {
    error.value = e.message
  } finally {
    sandboxRunning.value = false
  }
}

onMounted(() => {
  loadAll()
})
</script>
