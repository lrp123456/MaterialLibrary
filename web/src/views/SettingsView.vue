<template>
  <div class="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
    <!-- 顶部标签切换 -->
    <div class="bg-surface-low border border-outline-variant rounded-2xl p-3 flex items-center justify-between overflow-x-auto">
      <div class="flex gap-1.5 text-xs min-w-max">
        <button
          @click="tab = 'dict'"
          class="px-3.5 py-2 rounded-full font-medium transition flex items-center gap-1.5"
          :class="tab === 'dict' ? 'bg-primary text-white shadow-[0_6px_16px_rgba(59,130,246,.25)]' : 'text-on-surface-variant hover:bg-surface-high hover:text-white border border-outline-variant'"
        >
          <span class="material-symbols-outlined text-sm">label</span>
          <span>标签字典治理</span>
        </button>


        <button
          v-if="isSuperAdmin"
          @click="tab = 'users'"
          class="px-4 py-2 rounded-xl font-medium transition flex items-center gap-1.5"
          :class="tab === 'users' ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">group</span>
          <span>账号安全管理</span>
        </button>

        <button
          @click="tab = 'runtime'"
          class="px-4 py-2 rounded-xl font-medium transition flex items-center gap-1.5"
          :class="tab === 'runtime' ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">tune</span>
          <span>运行参数</span>
        </button>
        <button
          @click="tab = 'ingest'"
          class="px-4 py-2 rounded-xl font-medium transition flex items-center gap-1.5"
          :class="tab === 'ingest' ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">upload</span>
          <span>直连入库</span>
        </button>
        <button
          @click="tab = 'vectors'"
          class="px-4 py-2 rounded-xl font-medium transition flex items-center gap-1.5"
          :class="tab === 'vectors' ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">hub</span>
          <span>向量检索</span>
        </button>
        <button
          v-if="isAdmin"
          @click="tab = 'snapshot'"
          class="px-4 py-2 rounded-xl font-medium transition flex items-center gap-1.5"
          :class="tab === 'snapshot' ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-surface-high'"
        >
          <span class="material-symbols-outlined text-sm">sync</span>
          <span>快照同步</span>
        </button>
      </div>
    </div>

    <!-- 1. 标签字典治理 -->
    <div v-if="tab === 'dict'" class="space-y-4">
      <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 space-y-3 text-xs">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-outline">分区:</span>
            <button
              v-for="g in dictGroups"
              :key="g.key"
              @click="activeGroup = g.key"
              class="px-3 py-1.5 rounded-xl font-medium transition"
              :class="activeGroup === g.key ? 'bg-primary text-white' : 'bg-surface text-on-surface-variant hover:bg-surface-high'"
            >{{ g.label }}</button>
            <label class="ml-2 flex items-center gap-1.5 text-on-surface-variant cursor-pointer">
              <input type="checkbox" v-model="showDeprecated" class="accent-primary" />
              <span>含已废弃</span>
            </label>
          </div>
          <div class="flex items-center gap-2">
            <button @click="tab === 'dict' && (dictSubTab = dictSubTab === 'audit' ? 'tags' : 'audit')" class="px-3 py-1.5 rounded-xl border border-outline-variant text-on-surface-variant hover:bg-surface-high">
              {{ dictSubTab === 'audit' ? '返回标签列表' : '变更历史' }}
            </button>
            <button
              :disabled="!activeDimMeta || activeDimMeta.readonly"
              @click="openAddTag"
              class="px-3 py-1.5 bg-primary text-white rounded-xl font-medium flex items-center gap-1 disabled:opacity-40"
            >
              <span class="material-symbols-outlined text-sm">add</span>
              <span>新增标签枚举</span>
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <span class="text-outline">维度:</span>
          <select v-model="activeDim" class="bg-surface border border-outline-variant rounded-xl px-3 py-1.5 text-white outline-none focus:border-primary min-w-48">
            <option v-for="d in visibleDims" :key="d.key" :value="d.key">
              {{ d.label }} ({{ d.key }}) · 可用 {{ d.count }}<template v-if="d.deprecatedCount"> / 废弃 {{ d.deprecatedCount }}</template>
            </option>
          </select>
          <span v-if="activeDimMeta?.readonly" class="text-[10px] px-2 py-0.5 rounded bg-surface text-outline border border-outline-variant">系统只读</span>
          <span v-if="activeDimMeta?.multi" class="text-[10px] px-2 py-0.5 rounded bg-primary/15 text-primary">多选</span>
          <span v-else class="text-[10px] px-2 py-0.5 rounded bg-surface text-on-surface-variant border border-outline-variant">单选</span>
        </div>
      </div>

      <!-- 标签列表 -->
      <div v-if="dictSubTab === 'tags'" class="space-y-2.5">
        <div class="flex items-center justify-between text-[11px] text-outline">
          <span>共 {{ currentDimTags.length }} 项</span>
          <button
            v-if="isAdmin && currentDimTags.length"
            @click="openRetagConfirm([activeDim])"
            class="px-2.5 py-1 rounded-lg border border-primary/40 text-primary hover:bg-primary/10"
          >按本维重打低置信/回退项</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
          <div
            v-for="t in currentDimTags"
            :key="t.id"
            class="bg-surface-low border rounded-xl p-3 space-y-1.5"
            :class="t.deprecated ? 'border-error/30 opacity-70' : 'border-outline-variant'"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-medium text-white truncate">{{ t.label }}</p>
                <p class="text-[10px] text-outline font-mono truncate">{{ t.dir }}</p>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface text-on-surface-variant">{{ t.usage_count }} 张</span>
                <span v-if="t.deprecated" class="text-[9px] px-1.5 py-0.5 rounded bg-error/20 text-error">已废弃</span>
              </div>
            </div>
            <p v-if="isAdmin && t.criteria" class="text-[10px] text-on-surface-variant line-clamp-2">{{ t.criteria }}</p>
            <p v-if="isAdmin && t.aliases?.length" class="text-[10px] text-outline">别名: {{ t.aliases.join(' / ') }}</p>
            <div v-if="isAdmin && !activeDimMeta?.readonly" class="flex flex-wrap gap-1.5 pt-1">
              <button @click="openEditTag(t)" class="px-2 py-0.5 rounded bg-surface text-on-surface-variant hover:bg-surface-high">编辑</button>
              <button v-if="!t.deprecated" @click="deprecateTag(t)" class="px-2 py-0.5 rounded bg-error/15 text-error hover:bg-error/25">废弃</button>
              <button v-else @click="restoreTag(t)" class="px-2 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25">恢复</button>
            </div>
          </div>
        </div>
        <div v-if="!currentDimTags.length" class="p-6 text-center text-on-surface-variant text-xs bg-surface-low border border-outline-variant rounded-2xl">
          当前维度暂无标签
        </div>
      </div>

      <!-- 字典变更历史 -->
      <div v-else class="bg-surface-low border border-outline-variant rounded-2xl overflow-hidden">
        <table class="w-full text-xs text-left">
          <thead class="bg-surface text-outline border-b border-outline-variant text-[11px]">
            <tr>
              <th class="p-3">时间</th>
              <th class="p-3">动作</th>
              <th class="p-3">维度</th>
              <th class="p-3">标签</th>
              <th class="p-3">操作者</th>
              <th class="p-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant">
            <tr v-for="a in auditList" :key="a.id" class="hover:bg-surface-high/30">
              <td class="p-3 text-outline whitespace-nowrap">{{ new Date(a.created_at).toLocaleString() }}</td>
              <td class="p-3">
                <span class="px-1.5 py-0.5 rounded text-[10px]"
                  :class="a.action==='create' ? 'bg-primary/15 text-primary' : a.action==='deprecate' ? 'bg-error/15 text-error' : a.action==='restore' ? 'bg-success/15 text-success' : 'bg-surface text-on-surface-variant'">
                  {{ auditActionLabel(a.action) }}
                </span>
              </td>
              <td class="p-3 font-mono text-[10px]">{{ a.dimension }}</td>
              <td class="p-3">{{ a.dir }}</td>
              <td class="p-3 text-outline">{{ a.actor || '—' }}</td>
              <td class="p-3">
                <button @click="loadAuditAssets(a)" class="text-primary hover:underline">受影响资产</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!auditList.length" class="p-6 text-center text-on-surface-variant text-xs">暂无字典变更记录</div>
      </div>
    </div>

    <!-- 2. 团队账号管理 -->
    <div v-if="tab === 'users'" class="space-y-4">
      <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 flex items-center justify-between text-xs">
        <div>
          <h3 class="font-bold text-white flex items-center gap-1.5">
            <span class="material-symbols-outlined text-primary text-base">security</span>
            <span>账号安全管理与权限控制</span>
          </h3>
          <p class="text-[11px] text-on-surface-variant mt-0.5">仅超级管理员 admin 可增删账号及重置密码；管理员 naite 为永久锁定保护账号，免受任何篡改</p>
        </div>
        <button @click="showAddUser = true" class="px-3.5 py-1.5 bg-primary text-white rounded-xl font-medium flex items-center gap-1 shadow-sm hover:bg-primary/90">
          <span class="material-symbols-outlined text-sm">person_add</span>
          <span>新建账号</span>
        </button>
      </div>

      <div class="bg-surface-low border border-outline-variant rounded-2xl overflow-hidden">
        <table class="w-full text-xs text-left">
          <thead class="bg-surface text-outline border-b border-outline-variant text-[11px]">
            <tr>
              <th class="p-3">用户名</th>
              <th class="p-3">角色权限</th>
              <th class="p-3">账号状态</th>
              <th class="p-3">创建时间</th>
              <th class="p-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant">
            <tr v-for="u in usersList" :key="u.id" class="hover:bg-surface-high/30">
              <td class="p-3 font-medium text-white flex items-center gap-1.5">
                <span class="material-symbols-outlined text-sm text-outline">account_circle</span>
                <span>{{ u.username }}</span>
                <span v-if="u.username === 'admin'" class="px-1.5 py-0.2 rounded text-[9px] bg-primary/20 text-primary border border-primary/30">SUPER ADMIN</span>
              </td>
              <td class="p-3">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-medium" :class="u.role==='admin' ? 'bg-primary/20 text-primary' : 'bg-surface border border-outline-variant text-on-surface-variant'">
                  {{ u.role === 'admin' ? '管理员 (Admin)' : '检索员 (Viewer)' }}
                </span>
              </td>
              <td class="p-3">
                <span v-if="u.is_locked || u.username === 'naite'" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  <span class="material-symbols-outlined text-[12px]">lock</span>
                  <span>永久锁定</span>
                </span>
                <span v-else class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  <span class="material-symbols-outlined text-[12px]">check_circle</span>
                  <span>正常</span>
                </span>
              </td>
              <td class="p-3 text-outline">{{ new Date(u.created_at).toLocaleString() }}</td>
              <td class="p-3 text-right">
                <span v-if="u.is_locked || u.username === 'naite'" class="text-outline text-[11px] italic">
                  不可修改 (永久锁定)
                </span>
                <div v-else-if="u.username === 'admin'" class="inline-flex items-center gap-1.5">
                  <button @click="openChangePassModal(u)" class="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-high text-white text-[11px] border border-outline-variant flex items-center gap-1">
                    <span class="material-symbols-outlined text-[13px]">key</span>
                    <span>修改密码</span>
                  </button>
                </div>
                <div v-else class="inline-flex items-center gap-1.5">
                  <button @click="openChangePassModal(u)" class="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-high text-white text-[11px] border border-outline-variant flex items-center gap-1">
                    <span class="material-symbols-outlined text-[13px]">key</span>
                    <span>修改密码</span>
                  </button>
                  <button @click="handleDeleteUser(u)" class="px-2.5 py-1 rounded-lg bg-error/10 hover:bg-error/20 text-error text-[11px] border border-error/20 flex items-center gap-1">
                    <span class="material-symbols-outlined text-[13px]">delete</span>
                    <span>删除</span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 3. 运行参数治理 -->
    <div v-if="tab === 'runtime'" class="space-y-4">
      <div class="bg-surface-low border border-outline-variant rounded-2xl p-5 space-y-5 max-w-4xl text-xs">
        <div class="flex items-center justify-between pb-3 border-b border-outline-variant">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <span class="material-symbols-outlined text-2xl">tune</span>
            </div>
            <div>
              <h3 class="text-sm font-bold text-white">运行参数配置 (Runtime Config)</h3>
              <p class="text-[11px] text-on-surface-variant">写入 SQLite kv 键值表，读取时覆盖同名环境变量；下次调用即生效，不改写 .env</p>
            </div>
          </div>
          <button
            @click="saveRuntime"
            :disabled="runtimeSaving"
            class="px-4 py-2 bg-primary text-white rounded-xl font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <span v-if="runtimeSaving" class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
            <span v-else class="material-symbols-outlined text-sm">save</span>
            <span>保存运行参数</span>
          </button>
        </div>

        <div v-if="runtimeMsg" class="p-3 rounded-xl bg-ok/10 border border-ok/30 text-ok text-xs">
          {{ runtimeMsg }}
        </div>

        <!-- 分组 1: 并发与调度时刻 -->
        <div class="space-y-3">
          <h4 class="text-xs font-bold text-white flex items-center gap-1.5">
            <span class="material-symbols-outlined text-base text-primary">speed</span>
            <span>并发控制与夜间调度</span>
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">快捷处理并发 (PROCESS)</label>
              <input v-model.number="runtimeForm.process_concurrency" type="number" min="1" max="16" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">打标并发 (TAG)</label>
              <input v-model.number="runtimeForm.tag_concurrency" type="number" min="1" max="32" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">画幅重构并发 (RESTAGE)</label>
              <input v-model.number="runtimeForm.restage_concurrency" type="number" min="1" max="16" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">夜间重打标时刻 (小时: 0-23)</label>
              <input v-model.number="runtimeForm.retag_night_hour" type="number" min="0" max="23" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">夜间重打标时刻 (分钟: 0-59)</label>
              <input v-model.number="runtimeForm.retag_night_minute" type="number" min="0" max="59" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
          </div>
        </div>

        <!-- 分组 2: 服务端点与存储目录 -->
        <div class="space-y-3 pt-3 border-t border-outline-variant">
          <h4 class="text-xs font-bold text-white flex items-center gap-1.5">
            <span class="material-symbols-outlined text-base text-primary">hub</span>
            <span>服务基址与存储目录</span>
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">NAS 目录 (ML_NAS_DIR)</label>
              <input v-model="runtimeForm.nas_dir" type="text" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">对外基址 (BFF_PUBLIC_BASE)</label>
              <input v-model="runtimeForm.bff_public_base" type="text" placeholder="http://192.168.1.x:30001" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">Umbra 地址 (UMBRA_BASE_URL)</label>
              <input v-model="runtimeForm.umbra_base_url" type="text" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">YOLO 地址 (YOLO_SEG_URL)</label>
              <input v-model="runtimeForm.yolo_seg_url" type="text" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">技能根目录 (SKILLS_ROOT)</label>
              <input v-model="runtimeForm.skills_root" type="text" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
          </div>
        </div>

        <!-- 分组 3: 网络代理与 Umbra 模板 -->
        <div class="space-y-3 pt-3 border-t border-outline-variant">
          <h4 class="text-xs font-bold text-white flex items-center gap-1.5">
            <span class="material-symbols-outlined text-base text-primary">router</span>
            <span>HTTP 代理与模板配置</span>
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">HTTP 代理 (HTTP_PROXY)</label>
              <input v-model="runtimeForm.http_proxy" type="text" placeholder="http://127.0.0.1:7890" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">HTTPS 代理 (HTTPS_PROXY)</label>
              <input v-model="runtimeForm.https_proxy" type="text" placeholder="http://127.0.0.1:7890" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">不代理列表 (NO_PROXY)</label>
              <input v-model="runtimeForm.no_proxy" type="text" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">漫游模板 ID (walkthrough)</label>
              <input v-model="runtimeForm.umbra_template_walkthrough" type="text" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">点选模板 ID (touch)</label>
              <input v-model="runtimeForm.umbra_template_touch" type="text" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
          </div>
        </div>

        <!-- 分组 4: 端口与数据目录 -->
        <div class="space-y-3 pt-3 border-t border-outline-variant">
          <h4 class="text-xs font-bold text-white flex items-center gap-1.5">
            <span class="material-symbols-outlined text-base text-primary">lan</span>
            <span>服务端口与数据目录</span>
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-on-surface-variant mb-1">
                监听端口 (ML_PORT)
                <span class="text-tertiary font-semibold ml-1">（重启服务后才监听新端口）</span>
              </label>
              <input v-model.number="runtimeForm.port" type="number" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-on-surface-variant mb-1">
                数据目录 (ML_DATA_DIR)
                <span class="text-outline ml-1">（只读展示）</span>
              </label>
              <input :value="runtimeForm.data_dir" disabled readonly type="text" class="w-full bg-surface/50 border border-outline-variant rounded-xl px-3 py-2 text-outline cursor-not-allowed font-mono select-all" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="tab === 'ingest'" class="space-y-4">
      <div class="bg-surface-low border border-outline-variant rounded-2xl p-5 space-y-4 max-w-xl text-xs">
        <h3 class="text-sm font-bold text-white">本地上传原图</h3>
        <p class="text-[11px] text-on-surface-variant">检索页也有「上传原图」。原文件落到本机后再走工作流；成功后自动备份到夸克（目录用下方 fid，空则用插件 systemFid）。</p>
        <input type="file" accept="image/*" multiple @change="onLocalFiles" class="block w-full text-[11px] text-on-surface-variant" />
        <p v-if="ingestHint" class="text-primary">{{ ingestHint }}</p>
      </div>
      <div class="bg-surface-low border border-outline-variant rounded-2xl p-5 space-y-4 max-w-xl text-xs">
        <h3 class="text-sm font-bold text-white">入库后备份槽</h3>
        <p class="text-[11px] text-on-surface-variant">失败不挡入库。NAS 必须是本机已挂载目录；鸿蒙手机不直连群晖。</p>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="backup.enabled" class="accent-primary" />
          <span>启用备份</span>
        </label>
        <div>
          <label class="block text-on-surface-variant mb-1">NAS 挂载目录</label>
          <input v-model="backup.nasDir" type="text" placeholder="/mnt/nas/material-backup" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none" />
        </div>
        <div>
          <label class="block text-on-surface-variant mb-1">夸克备份目录 fid（空则用 systemFid）</label>
          <input v-model="backup.quarkFid" type="text" :placeholder="backup.effectiveQuarkFid || '网盘文件夹 fid'" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none font-mono" />
          <p v-if="backup.effectiveQuarkFid && !backup.quarkFid" class="text-[10px] text-outline mt-1">当前实际目录：{{ backup.effectiveQuarkFid }}</p>
        </div>
        <button @click="saveBackup" class="px-4 py-2 bg-primary text-white rounded-xl font-medium">保存备份设置</button>
        <button @click="runRecluster" class="ml-2 px-4 py-2 bg-surface border border-outline-variant rounded-xl">全库按新规则重算查重</button>
      </div>
      <div class="bg-surface-low border border-outline-variant rounded-2xl p-5 space-y-4 max-w-xl text-xs">
        <h3 class="text-sm font-bold text-white">从 Ba 资源库拉取</h3>
        <p class="text-[11px] text-on-surface-variant">按关键词分页拉取图片和视频，入库后走现有闸门和标签。地址、账号、密码写在模型页密钥：BA_RESOURCE_BASE、BA_RESOURCE_USER、BA_RESOURCE_PASSWORD。接口必须带关键词。登录若要求验证码，这一轮会停下来。</p>
        <div>
          <label class="block text-on-surface-variant mb-1">关键词</label>
          <input v-model="baPull.keyword" type="text" placeholder="例如 客厅" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-on-surface-variant mb-1">类型</label>
            <select v-model="baPull.type" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none">
              <option value="all">全部</option>
              <option value="image">图片</option>
              <option value="video">视频</option>
            </select>
          </div>
          <div>
            <label class="block text-on-surface-variant mb-1">每页条数</label>
            <input v-model.number="baPull.size" type="number" min="1" max="50" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none" />
          </div>
        </div>
        <button @click="runBaPull" :disabled="baPull.busy" class="px-4 py-2 bg-primary text-white rounded-xl font-medium disabled:opacity-50">{{ baPull.busy ? '拉取中...' : '开始拉取' }}</button>
        <p v-if="baPull.hint" class="text-primary whitespace-pre-wrap">{{ baPull.hint }}</p>
      </div>
    </div>

    <div v-if="tab === 'vectors'" class="space-y-4">
      <div class="bg-surface-low border border-outline-variant rounded-2xl p-5 space-y-3 max-w-xl text-xs">
        <h3 class="text-sm font-bold text-white">相似检索实际在用什么</h3>
        <p class="text-[11px] text-on-surface-variant leading-relaxed">
          Index 把标签拼成 caption，再写入 <span class="font-mono">asset_vectors</span>。相似分：{{ vectorStatus?.formula || '0.70 × 余弦 + 标签加权' }}。
        </p>
        <div class="grid grid-cols-2 gap-2">
          <div class="bg-surface rounded-xl p-3 border border-outline-variant">
            <p class="text-[10px] text-on-surface-variant">配置模型</p>
            <p class="font-mono text-white mt-1">{{ vectorStatus?.configuredModel || '—' }}</p>
          </div>
          <div class="bg-surface rounded-xl p-3 border border-outline-variant">
            <p class="text-[10px] text-on-surface-variant">实际落库</p>
            <p class="font-mono text-white mt-1">{{ vectorStatus?.storedModel || '无' }} · {{ vectorStatus?.storedDimensions || '—' }} 维</p>
          </div>
          <div class="bg-surface rounded-xl p-3 border border-outline-variant">
            <p class="text-[10px] text-on-surface-variant">条数 / 覆盖</p>
            <p class="text-white mt-1">{{ vectorStatus?.rows || 0 }} 条 · {{ Math.round((vectorStatus?.coverage || 0) * 100) }}%</p>
          </div>
          <div class="bg-surface rounded-xl p-3 border border-outline-variant">
            <p class="text-[10px] text-on-surface-variant">LiteLLM</p>
            <p class="text-white mt-1">{{ vectorStatus?.litellmEnabled ? '已启用' : '未启用' }}</p>
          </div>
        </div>
        <p v-if="!vectorStatus" class="text-on-surface-variant text-[11px]">正在读取落库向量…</p>
        <p v-else-if="vectorStatus.warning" class="text-error text-[11px] font-medium">{{ vectorStatus.warning }}{{ vectorStatus.hint ? ' · ' + vectorStatus.hint : '' }}</p>
        <p v-else class="text-primary text-[11px]">当前按配置模型写入语义向量。</p>
        <button
          @click="recomputeVectors"
          :disabled="vectorBusy"
          class="px-4 py-2 bg-primary text-white rounded-xl font-medium disabled:opacity-50"
        >
          {{ vectorBusy ? '重算中…' : '按当前模型重算全部向量' }}
        </button>
        <p v-if="vectorHint" class="text-[11px] text-on-surface-variant">{{ vectorHint }}</p>
      </div>
    </div>

    <!-- 6. 快照同步（AlbumSync 接收器）：仅管理员可见 -->
    <div v-if="tab === 'snapshot'" class="space-y-4">
      <div class="bg-surface-low border border-outline-variant rounded-2xl p-5 space-y-4 max-w-xl text-xs">
        <h3 class="text-sm font-bold text-white">快照直收（App 内置同步）</h3>
        <p class="text-[11px] text-on-surface-variant leading-relaxed">
          素材库 App 的「同步」页直接把全量相册快照推送到本服务（POST /api/viewer/snapshot），无需部署独立接收器。
          夸克扫描前先取内置 live∪frozen 并集做幽灵过滤；扫描末尾对存量资产做 ghost 标记/恢复。
          窗口外老照片冻结归档（相册删除不传导），窗口内增删改实时同步。
        </p>
        <div class="flex items-center gap-2">
          <button @click="loadSnapshotStatus" :disabled="snapBusy" class="px-4 py-2 bg-surface border border-outline-variant rounded-xl disabled:opacity-50">
            {{ snapBusy ? '刷新中…' : '刷新设备状态' }}
          </button>
        </div>
      </div>

      <div class="bg-surface-low border border-outline-variant rounded-2xl overflow-hidden">
        <div class="px-4 py-3 border-b border-outline-variant flex items-center justify-between text-xs">
          <h3 class="font-bold text-white">设备快照状态</h3>
          <span class="text-[11px] text-on-surface-variant">本库 ghost 资产：<span class="text-error font-bold">{{ snapStatus.ghostCount ?? '—' }}</span></span>
        </div>
        <table class="w-full text-xs text-left" v-if="snapStatus.devices && snapStatus.devices.length">
          <thead class="bg-surface text-outline border-b border-outline-variant text-[11px]">
            <tr>
              <th class="p-3">设备</th>
              <th class="p-3">最后同步</th>
              <th class="p-3">48h 有效性</th>
              <th class="p-3">live / frozen</th>
              <th class="p-3">同步窗口</th>
              <th class="p-3">App 版本</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant">
            <tr v-for="d in snapStatus.devices" :key="d.device_id" class="hover:bg-surface-high/30">
              <td class="p-3 font-medium text-white font-mono">{{ d.device_id }}</td>
              <td class="p-3 text-outline">{{ d.last_seen }}</td>
              <td class="p-3">
                <span v-if="d.expired" class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-error/20 text-error">已过期</span>
                <span v-else class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/20 text-primary">有效</span>
              </td>
              <td class="p-3 text-white">{{ d.live_count ?? 0 }} / {{ d.frozen_count ?? 0 }}</td>
              <td class="p-3 text-on-surface-variant">{{ d.window_days ? d.window_days + ' 天' : '全量替换' }}</td>
              <td class="p-3 text-outline font-mono">{{ d.app_version || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="p-4 text-xs text-on-surface-variant">
          <p>暂无已同步设备（等待素材库 App「同步」页首次推送快照）。</p>
        </div>
      </div>
    </div>

    <!-- 新增/编辑标签弹窗 -->
    <div v-if="showAddTag" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="showAddTag = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 text-xs">
        <h3 class="text-sm font-bold text-white">{{ editingTagId ? '编辑' : '新增' }} {{ activeDimMeta?.label || activeDim }} 标签</h3>
        <div class="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div>
            <label class="block text-outline mb-1">显示名称 (label) *</label>
            <input v-model="tagForm.label" type="text" placeholder="如 换鞋区 / 胡桃木" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-outline mb-1">机器码 (dir) — 留空自动生成</label>
            <input v-model="tagForm.dir" type="text" placeholder="如 shoe_area / walnut" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
          </div>
          <div>
            <label class="block text-outline mb-1">识别标准 (criteria) — 注入打标 prompt</label>
            <textarea v-model="tagForm.criteria" rows="3" placeholder="例：画面中有鞋柜/换鞋凳，属于入户换鞋区" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary"></textarea>
            <button type="button" @click="fillDraftCriteria" class="mt-1 text-[11px] text-primary hover:underline">按名称生成草稿</button>
          </div>
          <div>
            <label class="block text-outline mb-1">别名 (aliases) — 逗号分隔，进识别</label>
            <input v-model="tagForm.aliasesText" type="text" placeholder="如 门厅, 落尘区" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary" />
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t border-outline-variant">
          <button @click="showAddTag = false" class="px-4 py-1.5 rounded-xl bg-surface text-on-surface-variant">取消</button>
          <button @click="submitAddTag" class="px-4 py-1.5 rounded-xl bg-primary text-white font-semibold">保存</button>
        </div>
      </div>
    </div>

    <!-- 重打确认弹窗 -->
    <div v-if="showRetagModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="showRetagModal = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 text-xs">
        <h3 class="text-sm font-bold text-white">词表变更后重新打标</h3>
        <p class="text-on-surface-variant">
          维度：<span class="text-white font-medium">{{ (retagPendingDims || []).join('、') }}</span><br />
          预计影响 <span class="text-primary font-bold text-sm">{{ retagEstimate }}</span> 张（低置信 + 回退/other + 缺有效标）
        </p>
        <p v-if="retagEstimate > 400" class="text-[11px] text-error">数量较大，建议走「今晚重打」。仍可强制立刻执行。</p>
        <div class="flex flex-col gap-2 pt-2 border-t border-outline-variant">
          <button @click="runRetag('night')" class="w-full px-4 py-2 rounded-xl bg-surface text-white font-medium hover:bg-surface-high">今晚重打（02:30）</button>
          <button @click="runRetag('now')" class="w-full px-4 py-2 rounded-xl bg-primary text-white font-semibold">立刻重打{{ retagEstimate > 400 ? '（强制）' : '' }}</button>
          <button @click="showRetagModal = false" class="w-full px-4 py-2 rounded-xl text-on-surface-variant">先不重打</button>
        </div>
      </div>
    </div>

    <!-- 受影响资产抽屉 -->
    <div v-if="affectedAssets.length" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="affectedAssets = []">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-3 text-xs">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white">受影响资产 ({{ affectedAssets.length }})</h3>
          <button @click="affectedAssets = []" class="text-outline hover:text-white">关闭</button>
        </div>
        <div class="max-h-80 overflow-y-auto space-y-1">
          <div v-for="a in affectedAssets" :key="a.fid" class="p-2 rounded bg-surface text-on-surface-variant truncate">{{ a.file_name || a.fid }}</div>
        </div>
      </div>
    </div>

    <!-- 新增用户弹窗 -->
    <div v-if="showAddUser" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="showAddUser = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 text-xs">
        <h3 class="text-sm font-bold text-white flex items-center gap-1.5">
          <span class="material-symbols-outlined text-primary text-base">person_add</span>
          <span>新建系统账号</span>
        </h3>
        <div class="space-y-3">
          <div>
            <label class="block text-outline mb-1">用户名 *</label>
            <input v-model="userForm.username" type="text" placeholder="如 designer_zhang" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-outline mb-1">初始密码 * (至少6位)</label>
            <input v-model="userForm.password" type="password" placeholder="设置初始登录密码" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-outline mb-1">角色权限</label>
            <select v-model="userForm.role" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary">
              <option value="viewer">检索员 (Viewer) - 仅浏览、检索与下载</option>
              <option value="admin">管理员 (Admin) - 画布创作与模型管理</option>
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t border-outline-variant">
          <button @click="showAddUser = false" class="px-4 py-1.5 rounded-xl bg-surface text-on-surface-variant hover:text-white">取消</button>
          <button @click="submitAddUser" class="px-4 py-1.5 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90">创建</button>
        </div>
      </div>
    </div>

    <!-- 修改用户密码弹窗 -->
    <div v-if="showChangePassModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="showChangePassModal = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 text-xs">
        <h3 class="text-sm font-bold text-white flex items-center gap-1.5">
          <span class="material-symbols-outlined text-primary text-base">key</span>
          <span>修改密码 - {{ changePassTargetUser?.username }}</span>
        </h3>
        <div class="space-y-3">
          <div>
            <label class="block text-outline mb-1">新密码 * (至少6位)</label>
            <input v-model="newPasswordInput" type="password" placeholder="请输入新密码" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary" />
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t border-outline-variant">
          <button @click="showChangePassModal = false" class="px-4 py-1.5 rounded-xl bg-surface text-on-surface-variant hover:text-white">取消</button>
          <button @click="submitChangePass" class="px-4 py-1.5 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90">确定修改</button>
        </div>
      </div>
    </div>

    <!-- 注册新模型弹窗 -->
    <div v-if="showNewModelModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="showNewModelModal = false">
      <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-xl w-full p-5 shadow-2xl space-y-4 text-xs max-h-[85vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-2 border-b border-outline-variant">
          <h3 class="text-sm font-bold text-white flex items-center gap-1.5">
            <span class="material-symbols-outlined text-primary text-base">add_circle</span>
            <span>注册新模型 / 提供商 (动态 Schema)</span>
          </h3>
          <button @click="showNewModelModal = false" class="text-outline hover:text-white">✕</button>
        </div>

        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-outline mb-1">模型标识 (ID) * (仅英数下划线)</label>
              <input v-model="newModelForm.id" type="text" placeholder="如 my_custom_flux" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-outline mb-1">显示名称 (Name) *</label>
              <input v-model="newModelForm.name" type="text" placeholder="如 Flux 1.1 Pro (自定义)" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary" />
            </div>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="block text-outline mb-1">业务领域</label>
              <select v-model="newModelForm.domain" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none">
                <option value="image">图片生成 (image)</option>
                <option value="video">视频生成 (video)</option>
                <option value="music">AI 音乐 (music)</option>
                <option value="chat">文本 / 对话 (chat)</option>
              </select>
            </div>
            <div>
              <label class="block text-outline mb-1">厂商 / 提供商</label>
              <select v-model="newModelForm.provider" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none">
                <option value="custom">自定义 (custom)</option>
                <option value="open_compatible">兼容 OpenAI</option>
                <option value="agnes">Agnes AI</option>
                <option value="volcengine">火山方舟</option>
                <option value="google">Google Gemini</option>
              </select>
            </div>
            <div>
              <label class="block text-outline mb-1">网关协议</label>
              <select v-model="newModelForm.protocol" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none">
                <option value="http_json">同步 JSON (http_json)</option>
                <option value="async_http_job">异步轮询 (async_http_job)</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-outline mb-1">厂商模型识别码 (model_code) *</label>
              <input v-model="newModelForm.model_code" type="text" placeholder="如 flux-pro-v1 / seedream-..." class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
            <div>
              <label class="block text-outline mb-1">自定义 Base URL (可选)</label>
              <input v-model="newModelForm.base_url" type="text" placeholder="留空使用提供商默认端点" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary font-mono" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-outline mb-1">参考图槽位数 (0-10)</label>
              <input v-model.number="newModelForm.slotsImages" type="number" min="0" max="10" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary" />
            </div>
            <div>
              <label class="block text-outline mb-1">参考视频槽位数 (0-5)</label>
              <input v-model.number="newModelForm.slotsVideos" type="number" min="0" max="5" class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2 text-white outline-none focus:border-primary" />
            </div>
          </div>

          <div>
            <label class="block text-outline mb-1">优化器系统提示词 (Skill，每模型专属严禁万能稿)</label>
            <textarea v-model="newModelForm.polishPrompt" rows="4" placeholder="在此输入该模型的专属提示词结构要求与润色准则。如无需优化可留空。" class="w-full bg-surface border border-outline-variant rounded-xl p-2.5 text-white font-mono text-[11px] leading-relaxed outline-none focus:border-primary" />
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-outline-variant">
          <button @click="showNewModelModal = false" class="px-4 py-1.5 rounded-xl bg-surface text-on-surface-variant hover:bg-surface-high">取消</button>
          <button @click="submitCreateCustomModel" class="px-5 py-1.5 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90">立即注册</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { api, getCurrentUser } from '../api'

const tab = ref('runtime')
const genSub = ref('models')
const genModels = ref({ image: [], video: [], music: [], chat: [] })
const genJobs = ref([])
const polishDraft = ref({})
const optDraft = ref({})
const previewMode = ref({})
const jobParamsText = ref({})
const genHint = ref('')

function modeLockHint(m) {
  const mode = previewMode.value[m.id] || m.schema?.modes?.[0]?.id
  const mc = m.schema?.modeConstraints?.[mode]
  if (!mc?.lock?.length) return ''
  return mc.lock.map(k => `${k}=${mc.set?.[k]}`).join('，')
}

async function loadGenGov() {
  try {
    const [models, jobs] = await Promise.all([api.genModels(), api.genJobs()])
    genModels.value = models || { image: [], video: [], music: [], chat: [] }
    const drafts = {}
    const opts = {}
    for (const d of ['image', 'video', 'music']) {
      for (const m of genModels.value[d] || []) {
        drafts[m.id] = m.polishPrompt || ''
        opts[m.id] = m.optimizer_model_id || ''
      }
    }
    polishDraft.value = drafts
    optDraft.value = opts
    genJobs.value = jobs || []
    const pt = {}
    for (const j of genJobs.value) pt[j.job_id] = JSON.stringify(j.params || {}, null, 2)
    jobParamsText.value = pt
  } catch (e) {
    genHint.value = e.message
  }
}

async function savePolish(m) {
  try {
    await api.saveGenPolish(m.id, { prompt: polishDraft.value[m.id], optimizer_model_id: optDraft.value[m.id] })
    await loadGenGov()
    alert('已保存系统提示词')
  } catch (e) { alert(e.message) }
}
async function resetPolish(m) {
  try {
    await api.resetGenPolish(m.id)
    await loadGenGov()
  } catch (e) { alert(e.message) }
}
async function saveJob(j) {
  let params = j.params
  try { params = JSON.parse(jobParamsText.value[j.job_id] || '{}') } catch { return alert('冻结参数不是合法 JSON') }
  try {
    await api.saveGenJob(j.job_id, { model_id: j.model_id, params, allow_models: j.allow_models, fields: j.fields })
    await loadGenGov()
    alert('作业绑定已保存')
  } catch (e) { alert(e.message) }
}
async function resetJob(j) {
  try {
    await api.resetGenJob(j.job_id)
    await loadGenGov()
  } catch (e) { alert(e.message) }
}

const showNewModelModal = ref(false)
const newModelForm = ref({
  id: '',
  name: '',
  domain: 'image',
  provider: 'custom',
  protocol: 'http_json',
  model_code: '',
  base_url: '',
  slotsImages: 1,
  slotsVideos: 0,
  polishPrompt: '',
  optimizer_model_id: ''
})

const activeAddFieldModelId = ref(null)
const newFieldForm = ref({
  key: '',
  label: '',
  type: 'text',
  defaultVal: '',
  optionsStr: ''
})

function openAddField(m) {
  activeAddFieldModelId.value = m.id
  newFieldForm.value = {
    key: '',
    label: '',
    type: 'text',
    defaultVal: '',
    optionsStr: ''
  }
}

async function submitAddField(m) {
  if (!newFieldForm.value.key?.trim() || !newFieldForm.value.label?.trim()) {
    return alert('请填写参数 key 与显示名称')
  }
  const key = newFieldForm.value.key.trim()
  const label = newFieldForm.value.label.trim()
  const type = newFieldForm.value.type || 'text'
  let parsedDefault = newFieldForm.value.defaultVal
  let options = undefined

  if (type === 'bool') {
    parsedDefault = parsedDefault === 'true' || parsedDefault === '1' || parsedDefault === true
  } else if (type === 'number') {
    parsedDefault = parsedDefault ? Number(parsedDefault) : 0
  } else if (type === 'enum') {
    options = (newFieldForm.value.optionsStr || '')
      .split(/[,，]/)
      .map(s => s.trim())
      .filter(Boolean)
    if (!options.length) {
      return alert('请至少填写一个选项')
    }
    if (!parsedDefault) parsedDefault = options[0]
  }

  const newField = {
    key,
    label,
    type,
    default: parsedDefault,
    ...(options ? { options } : {})
  }

  const existing = (m.custom_fields || []).filter(f => f.key !== key)
  existing.push(newField)

  try {
    await api.saveGenModelSchema(m.id, { custom_fields: existing })
    activeAddFieldModelId.value = null
    await loadGenGov()
    alert(`参数 [${label}] 已保存，App 获取能力时将自动渲染`)
  } catch (e) {
    alert('保存参数失败: ' + e.message)
  }
}

async function removeCustomField(m, fieldKey) {
  if (!confirm(`确定删除参数 [${fieldKey}] 吗？`)) return
  const updated = (m.custom_fields || []).filter(f => f.key !== fieldKey)
  try {
    await api.saveGenModelSchema(m.id, { custom_fields: updated })
    await loadGenGov()
  } catch (e) {
    alert('删除参数失败: ' + e.message)
  }
}

async function submitCreateCustomModel() {
  const f = newModelForm.value
  if (!f.id?.trim() || !f.name?.trim() || !f.model_code?.trim()) {
    return alert('请填写模型标识 (ID)、显示名称和厂商模型代码')
  }
  try {
    await api.createGenModel({
      id: f.id.trim(),
      name: f.name.trim(),
      domain: f.domain,
      provider: f.provider,
      providerName: f.provider === 'custom' ? '自定义' : f.provider,
      protocol: f.protocol,
      model_code: f.model_code.trim(),
      base_url: f.base_url?.trim() || '',
      slots: {
        images: Number(f.slotsImages) || 0,
        videos: Number(f.slotsVideos) || 0,
        audios: 0
      },
      polishPrompt: f.polishPrompt?.trim() || '',
      optimizer_model_id: f.optimizer_model_id || ''
    })
    showNewModelModal.value = false
    newModelForm.value = {
      id: '',
      name: '',
      domain: 'image',
      provider: 'custom',
      protocol: 'http_json',
      model_code: '',
      base_url: '',
      polishPrompt: '',
      optimizer_model_id: '',
      slotsImages: 1,
      slotsVideos: 0
    }
    await loadGenGov()
    alert('新模型注册成功！')
  } catch (e) {
    alert('注册模型失败: ' + e.message)
  }
}

async function removeCustomModel(m) {
  if (!confirm(`确定注销自定义模型 [${m.name}] (${m.id}) 吗？`)) return
  try {
    await api.deleteGenModel(m.id)
    await loadGenGov()
  } catch (e) {
    alert('删除模型失败: ' + e.message)
  }
}
const activeDim = ref('space')
const allTags = ref([])
const usersList = ref([])
const quarkInfo = ref(null)
const quarkCode = ref('')
const quarkZipUrl = ref('')
const quarkInstallCode = ref('')
const quarkInstalling = ref(false)
const quarkInstallMsg = ref('')
const quarkInstallOk = ref(false)
const ingestHint = ref('')
const backup = ref({ enabled: true, nasDir: '', quarkFid: '' })
const baPull = ref({ keyword: '', type: 'all', size: 20, busy: false, hint: '' })
const vectorStatus = ref(null)
const vectorBusy = ref(false)
const vectorHint = ref('')

// 快照同步页签（仅 admin 可见；沿用 getCurrentUser 角色判定惯例）
const isAdmin = computed(() => getCurrentUser()?.role === 'admin')
const isSuperAdmin = computed(() => getCurrentUser()?.username === 'admin')
const snapStatus = ref({ ok: null, devices: [], ghostCount: null, error: '' })
const snapBusy = ref(false)

const showAddTag = ref(false)
const editingTagId = ref(null)
const tagForm = ref({ dir: '', label: '', criteria: '', aliasesText: '' })
const dictGroups = ref([
  { key: 'space', label: '空间素材' },
  { key: 'furniture', label: '家具单品' },
  { key: 'aux', label: '辅助检索' },
  { key: 'legacy', label: '已废弃' }
])
const activeGroup = ref('space')
const showDeprecated = ref(false)
const dictSubTab = ref('tags')
const allDims = ref([])
const auditList = ref([])
const affectedAssets = ref([])
const showRetagModal = ref(false)
const retagPendingDims = ref([])
const retagEstimate = ref(0)

const showAddUser = ref(false)
const userForm = ref({ username: '', password: '', role: 'viewer' })
const showChangePassModal = ref(false)
const changePassTargetUser = ref(null)
const newPasswordInput = ref('')

const runtimeForm = ref({})
const runtimeSaving = ref(false)
const runtimeMsg = ref('')

const visibleDims = computed(() => {
  return allDims.value.filter(d => {
    if (activeGroup.value === 'legacy') return d.group === 'legacy' || d.deprecatedCount > 0
    if (showDeprecated.value) return d.group === activeGroup.value || (activeGroup.value === 'space' && d.group === 'space')
    return d.group === activeGroup.value && (d.count > 0 || !d.deprecatedGroup)
  })
})

const activeDimMeta = computed(() => allDims.value.find(d => d.key === activeDim.value) || null)

const currentDimTags = computed(() => {
  let list = allTags.value.filter(t => t.dimension === activeDim.value)
  if (!showDeprecated.value && activeGroup.value !== 'legacy') {
    list = list.filter(t => !t.deprecated)
  }
  return list
})

watch(activeGroup, () => {
  const first = visibleDims.value[0]
  if (first) activeDim.value = first.key
})
watch(showDeprecated, () => {
  if (!visibleDims.value.find(d => d.key === activeDim.value)) {
    const first = visibleDims.value[0]
    if (first) activeDim.value = first.key
  }
})
watch(dictSubTab, async (v) => {
  if (v === 'audit') await loadAudit()
})

function auditActionLabel(a) {
  return ({ create: '新增', update: '修改', deprecate: '废弃', restore: '恢复' })[a] || a
}

async function loadAudit() {
  try {
    auditList.value = (await api.dictAudit()) || []
  } catch (e) {
    console.error(e)
  }
}

async function loadAuditAssets(a) {
  try {
    affectedAssets.value = (await api.dictAuditAssets(a.id)) || []
  } catch (e) {
    alert('加载失败: ' + e.message)
  }
}

async function loadData() {
  try {
    const [dictRes, users, bk, vs, rt] = await Promise.all([
      api.dict(true).catch(() => ({ tags: [], dimensions: [] })),
      api.users().catch(() => []),
      api.backupSettings().catch(() => ({ enabled: true, nasDir: '', quarkFid: '' })),
      api.vectorStatus().catch(() => null),
      api.runtimeConfig().catch(() => ({}))
    ])
    // 兼容旧数组响应
    if (Array.isArray(dictRes)) {
      allTags.value = dictRes
      const dimMap = new Map()
      for (const t of dictRes) {
        if (!dimMap.has(t.dimension)) dimMap.set(t.dimension, { key: t.dimension, label: t.dimension, group: 'other', count: 0, deprecatedCount: 0 })
        const d = dimMap.get(t.dimension)
        if (t.deprecated) d.deprecatedCount++
        else d.count++
      }
      allDims.value = [...dimMap.values()]
    } else {
      allTags.value = dictRes.tags || []
      allDims.value = dictRes.dimensions || []
      if (dictRes.groups?.length) {
        dictGroups.value = dictRes.groups.filter(g => g.key !== 'other')
      }
    }
    usersList.value = users || []
    runtimeForm.value = rt || {}
    backup.value = { enabled: bk.enabled !== false, nasDir: bk.nasDir || '', quarkFid: bk.quarkFid || '' }
    if (vs) vectorStatus.value = vs
    if (!allDims.value.find(d => d.key === activeDim.value)) {
      const first = visibleDims.value[0]
      if (first) activeDim.value = first.key
    }
  } catch (e) {
    console.error('加载设置数据失败:', e)
  }
}

async function loadVectors() {
  try {
    vectorStatus.value = await api.vectorStatus()
  } catch (e) {
    console.error('读取向量状态失败:', e)
  }
}

function openAddTag() {
  editingTagId.value = null
  tagForm.value = { dir: '', label: '', criteria: '', aliasesText: '' }
  showAddTag.value = true
}

function openEditTag(t) {
  editingTagId.value = t.id
  tagForm.value = {
    dir: t.dir,
    label: t.label,
    criteria: t.criteria || '',
    aliasesText: (t.aliases || []).join(', ')
  }
  showAddTag.value = true
}

async function fillDraftCriteria() {
  if (!tagForm.value.label) return alert('请先填写名称')
  try {
    const r = await api.draftCriteria({ dimension: activeDim.value, label: tagForm.value.label })
    tagForm.value.criteria = r.criteria || ''
  } catch (e) {
    tagForm.value.criteria = `识别为「${tagForm.value.label}」时的可观察特征（请补充）。`
  }
}

async function submitAddTag() {
  if (!tagForm.value.label?.trim()) return alert('请填写显示名称')
  try {
    const aliases = tagForm.value.aliasesText
      .split(/[,，、]/)
      .map(s => s.trim())
      .filter(Boolean)
    await api.saveTag({
      dimension: activeDim.value,
      dir: tagForm.value.dir?.trim() || undefined,
      label: tagForm.value.label.trim(),
      criteria: tagForm.value.criteria || '',
      aliases
    })
    showAddTag.value = false
    tagForm.value = { dir: '', label: '', criteria: '', aliasesText: '' }
    editingTagId.value = null
    await loadData()
    await openRetagConfirm([activeDim.value])
  } catch (e) {
    alert('保存标签失败: ' + e.message)
  }
}

async function deprecateTag(t) {
  if (!confirm(`废弃「${t.label}」？历史资产标签保留，不再进入新打标。`)) return
  try {
    await api.deprecateTag({ id: t.id })
    await loadData()
  } catch (e) {
    alert('废弃失败: ' + e.message)
  }
}

async function restoreTag(t) {
  try {
    await api.restoreTag({ id: t.id })
    await loadData()
    await openRetagConfirm([t.dimension])
  } catch (e) {
    alert('恢复失败: ' + e.message)
  }
}

async function openRetagConfirm(dims) {
  retagPendingDims.value = dims
  retagEstimate.value = 0
  showRetagModal.value = true
  try {
    const r = await api.estimateRetag(dims)
    retagEstimate.value = r.total || 0
  } catch (e) {
    console.error(e)
  }
}

async function runRetag(schedule) {
  try {
    const r = await api.triggerRetag({
      dimensions: retagPendingDims.value,
      schedule,
      force: schedule === 'now'
    })
    if (r?.needsConfirm) {
      retagEstimate.value = r.estimated || retagEstimate.value
      alert(`预计 ${r.estimated} 张，建议今晚重打；可点「立刻重打」强制执行。`)
      return
    }
    showRetagModal.value = false
    alert(schedule === 'night'
      ? `已加入今晚重打队列（${r.queued} 张）`
      : `已开始立刻重打（${r.queued} 张 / 预估 ${r.estimated}）`)
  } catch (e) {
    alert('重打失败: ' + e.message)
  }
}

async function submitAddUser() {
  if (!userForm.value.username || userForm.value.password.length < 6) return alert('请正确填写用户名及6位以上密码')
  try {
    await api.createUser({
      username: userForm.value.username.trim(),
      password: userForm.value.password,
      role: userForm.value.role || 'viewer'
    })
    showAddUser.value = false
    userForm.value = { username: '', password: '', role: 'viewer' }
    await loadData()
    alert('账号创建成功！')
  } catch (e) {
    alert('创建失败: ' + e.message)
  }
}

function openChangePassModal(u) {
  if (u.is_locked || u.username === 'naite') {
    return alert('该账号已被永久锁定，禁止修改密码')
  }
  changePassTargetUser.value = u
  newPasswordInput.value = ''
  showChangePassModal.value = true
}

async function submitChangePass() {
  if (!newPasswordInput.value || newPasswordInput.value.length < 6) {
    return alert('密码长度至少 6 位')
  }
  try {
    await api.changeUserPassword(changePassTargetUser.value.id, newPasswordInput.value)
    showChangePassModal.value = false
    alert(`用户 ${changePassTargetUser.value.username} 密码修改成功！`)
    await loadData()
  } catch (e) {
    alert('修改密码失败: ' + e.message)
  }
}

async function handleDeleteUser(u) {
  if (u.is_locked || u.username === 'naite') {
    return alert('该账号已被永久锁定，禁止删除')
  }
  if (u.username === 'admin') {
    return alert('超级管理员 admin 禁止删除')
  }
  if (!confirm(`确定要删除用户 "${u.username}" 吗？此操作无法撤销。`)) return
  try {
    await api.deleteUser(u.id)
    alert('用户已删除！')
    await loadData()
  } catch (e) {
    alert('删除失败: ' + e.message)
  }
}

async function saveRuntime() {
  runtimeSaving.value = true
  runtimeMsg.value = ''
  try {
    const res = await api.saveRuntimeConfig(runtimeForm.value)
    runtimeForm.value = res || runtimeForm.value
    runtimeMsg.value = '运行参数保存成功！已写入 kv runtime_config，下次使用即生效。'
    setTimeout(() => { runtimeMsg.value = '' }, 4000)
  } catch (e) {
    alert('保存运行参数失败: ' + e.message)
  } finally {
    runtimeSaving.value = false
  }
}

async function onLocalFiles(ev) {
  const files = [...(ev.target.files || [])]
  if (!files.length) return
  ingestHint.value = `正在上传 ${files.length} 张...`
  let ok = 0
  let fail = 0
  for (const f of files) {
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('source', 'upload')
      await api.ingest(fd)
      ok++
    } catch (e) {
      fail++
      console.error(e)
    }
  }
  ingestHint.value = `完成：入库 ${ok} 张` + (fail ? `，失败 ${fail}` : '')
  ev.target.value = ''
}

async function runBaPull() {
  const keyword = String(baPull.value.keyword || '').trim()
  if (!keyword) {
    baPull.value.hint = '请先填写关键词'
    return
  }
  baPull.value.busy = true
  baPull.value.hint = '正在分页拉取...'
  try {
    const data = await api.pullBaResources({ keyword, type: baPull.value.type, size: baPull.value.size })
    const errors = (data.errors || []).map((item) => `${item.id}: ${item.error}`).join('\n')
    baPull.value.hint = `拉到 ${data.pulled || 0} 条，新入库 ${data.filed || 0}，已有 ${data.skipped || 0}，创作库 ${data.cards || 0}，失败 ${data.failed || 0}${data.truncated ? '。页数达到上限，后面的没拉' : ''}${errors ? '\n' + errors : ''}`
  } catch (e) {
    baPull.value.hint = e.message || '拉取失败'
  } finally {
    baPull.value.busy = false
  }
}

async function saveBackup() {
  try {
    await api.saveBackupSettings(backup.value)
    alert('备份设置已保存')
  } catch (e) {
    alert('保存失败: ' + e.message)
  }
}

async function runRecluster() {
  if (!confirm('按新规则清空自动组并重算？人工设过的主图会尽量保留。')) return
  try {
    const r = await api.recluster()
    alert(`重算完成：${r.totalGroups} 组`)
  } catch (e) {
    alert('重算失败: ' + e.message)
  }
}

async function recomputeVectors() {
  if (!confirm('按当前 Index 配置重写全部向量？未配置 embedding 时仍会写入本地哈希，不会冒充 OpenAI 模型名。')) return
  vectorBusy.value = true
  vectorHint.value = ''
  try {
    const r = await api.recomputeVectors()
    vectorStatus.value = r.status || r
    vectorHint.value = `已写入 ${r.updated || 0} 条` + (r.fallback ? `，其中 ${r.fallback} 条仍是本地哈希` : '')
  } catch (e) {
    vectorHint.value = '重算失败: ' + e.message
  } finally {
    vectorBusy.value = false
  }
}

// ===== 快照同步页签 =====
async function loadSnapshotStatus() {
  snapBusy.value = true
  try {
    const r = await api.snapshotStatus()
    snapStatus.value = { ok: r.ok, devices: r.devices || [], ghostCount: r.ghostCount, error: r.error || '' }
  } catch (e) {
    snapStatus.value = { ok: false, devices: [], ghostCount: null, error: e.message }
  } finally {
    snapBusy.value = false
  }
}

watch(tab, (t) => {
  if (t === 'vectors') loadVectors()
  if (t === 'snapshot') {
    loadSnapshotStatus()
  }
})

onMounted(() => {
  loadVectors()
  loadData()
  loadGenGov()
})
</script>
