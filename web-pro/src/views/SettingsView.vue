<template>
  <div class="view-root settings-view flex-1 min-h-0 flex flex-col overflow-hidden bg-studio-950 p-7 overflow-y-auto scrollbar-thin">
    <div class="max-w-4xl mx-auto space-y-7">
      <!-- 页面标题 -->
      <div class="flex items-center justify-between pb-4 border-b border-studio-700">
        <div>
          <h2 class="text-lg font-bold text-white flex items-center gap-2.5">
            <StudioIcon name="settings" :size="20" class="text-studio-accent" />
            系统设置与中枢配置
          </h2>
          <p class="text-sm text-slate-300 mt-1 font-medium">管理 AI 模型引擎、灰度发布分发、网关分流策略与 NAS 存储连接</p>
        </div>
        <div class="flex items-center space-x-2 text-xs">
          <span
            class="w-2.5 h-2.5 rounded-full"
            :class="probing ? 'bg-amber-400 animate-pulse' : online ? 'bg-studio-emerald animate-pulse' : 'bg-red-500'"
          ></span>
          <span :class="online ? 'text-emerald-400' : 'text-red-400'" class="font-mono font-bold">
            {{ probing ? '正在探测服务器…' : online ? `后端服务连接正常 (${serverLabelText})` : '三级回退均不可达（断线）' }}
          </span>
        </div>
      </div>

      <!-- 设置模块 0：服务端连接与三级回退（本机 → 局域网 → 公网） -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <StudioIcon name="cloud" :size="16" class="text-studio-accent" />
            服务器连接与三级回退
          </h3>
          <span
            class="text-xs px-2.5 py-1 rounded-md border font-mono font-bold"
            :class="online
              ? 'text-emerald-300 bg-emerald-400/10 border-emerald-400/40'
              : 'text-red-300 bg-red-400/10 border-red-400/40'"
          >{{ online ? '已连接' : '断线' }}</span>
        </div>

        <div class="text-xs text-slate-300 space-y-2">
          <p class="leading-relaxed">
            局域网访问工作台时，浏览器按「同源网关 → 本机直连 → 局域网直连 → 公网」顺序自动探测，
            任一链路断开都会静默切到下一个可用服务器，而不是直接显示素材丢失。
          </p>
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700 space-y-1 font-mono">
            <div class="text-slate-400">回退链（按优先级）：</div>
            <div
              v-for="(c, i) in candidates"
              :key="i"
              class="flex items-center gap-2"
              :class="isActiveCandidate(c) ? 'text-emerald-300 font-bold' : 'text-slate-400'"
            >
              <span>{{ i + 1 }}.</span>
              <span class="truncate">{{ c }}</span>
              <span v-if="isActiveCandidate(c)" class="text-[10px] text-emerald-400">← 当前生效</span>
            </div>
          </div>
          <div class="flex items-end gap-2.5 pt-1">
            <div class="flex-1">
              <label class="text-slate-300 font-semibold block mb-1.5">公网 / 备用服务器地址（留空则仅使用自动候选）</label>
              <input
                v-model="manualInput"
                type="text"
                placeholder="https://material.example.com"
                class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono outline-none focus:border-studio-accent"
              />
            </div>
            <button
              @click="saveManual"
              class="px-4 py-2.5 rounded-lg bg-studio-accent text-white font-bold cursor-pointer whitespace-nowrap"
            >保存并重探</button>
            <button
              @click="reprobe"
              :disabled="probing"
              class="px-4 py-2.5 rounded-lg bg-studio-800 hover:bg-studio-750 border border-studio-700 text-white font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
            >{{ probing ? '探测中…' : '重新探测' }}</button>
          </div>
        </div>
      </div>

      <!-- 设置模块 1：AI 推理模型网关与火山方舟配置 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <StudioIcon name="sparkles" :size="16" class="text-studio-accent" />
            AI 模型引擎与火山方舟密钥
          </h3>
          <span class="text-xs font-mono" :class="runtimeError ? 'text-red-400' : 'text-slate-400'">
            {{ runtimeLoading ? '读取中…' : runtimeError ? runtimeError : '已加载生效配置' }}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-4 text-xs">
          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">主推理模型（LiteLLM 模型名）</label>
            <input
              v-model="runtimeForm.litellm_model"
              type="text"
              placeholder="doubao-seed-2-0-lite-260428"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs font-medium outline-none focus:border-studio-accent"
            />
          </div>
          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">LiteLLM 网关地址</label>
            <input
              v-model="runtimeForm.litellm_base_url"
              type="text"
              placeholder="http://127.0.0.1:4000"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs font-medium outline-none focus:border-studio-accent"
            />
          </div>
          <div class="col-span-2">
            <label class="text-slate-300 font-semibold block mb-1.5">火山方舟 API Key（服务端仅回显末 4 位）</label>
            <div class="flex space-x-2.5">
              <input
                :value="arkKeyMasked"
                disabled
                class="flex-1 bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs font-medium opacity-80"
              />
              <input
                v-model="arkKeyDraft"
                type="password"
                placeholder="输入新 ARK_API_KEY"
                class="flex-1 bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs font-medium outline-none focus:border-studio-accent"
              />
              <button
                @click="updateArkKey"
                :disabled="keySaving || !arkKeyDraft.trim()"
                class="px-4 py-2.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-white text-xs font-bold border border-studio-700 cursor-pointer disabled:opacity-50"
              >{{ keySaving ? '更新中…' : '更新密钥' }}</button>
            </div>
            <span class="text-xs text-slate-400 mt-1.5 block font-medium">
              密钥写入服务端 .env 并热更新内存，不落 SQLite、不在页面回显明文。
            </span>
          </div>
        </div>
        <div class="flex justify-end">
          <button
            @click="saveRuntime"
            :disabled="runtimeSaving || runtimeLoading"
            class="px-5 py-2.5 rounded-xl bg-studio-accent text-white font-bold text-xs shadow cursor-pointer disabled:opacity-50"
          >{{ runtimeSaving ? '保存中…' : '保存运行参数' }}</button>
        </div>
      </div>

      <!-- 设置模块 1.2：New API 聚合网关 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <StudioIcon name="sparkles" :size="16" class="text-studio-accent" />
            New API 聚合网关（Gemini 4 / Gemini 3.1 图像）
          </h3>
          <span class="text-xs font-mono" :class="newapiError ? 'text-red-400' : 'text-slate-400'">
            {{ newapiLoading ? '读取中…' : newapiError || (newapiCount ? `${newapiCount} 个模型` : '未检测') }}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-4 text-xs">
          <div class="col-span-2">
            <label class="text-slate-300 font-semibold block mb-1.5">NEWAPI_API_KEY（服务端保存，不回显明文）</label>
            <div class="flex space-x-2.5">
              <input
                :value="newapiKeyMasked"
                disabled
                class="flex-1 bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs font-medium opacity-80"
              />
              <input
                v-model="newapiKeyDraft"
                type="password"
                placeholder="输入新 New API Key"
                class="flex-1 bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs font-medium outline-none focus:border-studio-accent"
              />
              <button
                @click="updateNewapiKey"
                :disabled="newapiSaving || !newapiKeyDraft.trim()"
                class="px-4 py-2.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-white text-xs font-bold border border-studio-700 cursor-pointer disabled:opacity-50"
              >{{ newapiSaving ? '更新中…' : '更新密钥' }}</button>
              <button
                @click="loadNewapiModels"
                :disabled="newapiLoading"
                class="px-4 py-2.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-white text-xs font-bold border border-studio-700 cursor-pointer disabled:opacity-50"
              >测试/拉取模型</button>
            </div>
          </div>
          <div v-if="newapiGeminiModels.length" class="col-span-2">
            <label class="text-slate-300 font-semibold block mb-1.5">已接通的 Gemini 图像模型</label>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="m in newapiGeminiModels" :key="m" class="px-2 py-1 rounded-lg bg-studio-950 border border-studio-700 text-slate-200 font-mono text-[11px]">{{ m }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 设置模块 1.5：双通道灰度发布（灰测 30003/30000 → 正式 30002/30001） -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <StudioIcon name="cloud" :size="16" class="text-emerald-400" />
            双通道灰度发布（A/B）
          </h3>
          <span
            class="text-xs px-2.5 py-1 rounded-md border font-mono font-bold"
            :class="gray.channel === 'gray'
              ? 'text-amber-300 bg-amber-400/10 border-amber-400/40'
              : 'text-emerald-300 bg-emerald-400/10 border-emerald-400/40'"
          >{{ gray.channel === 'gray' ? '当前：灰测通道' : '当前：正式通道' }}</span>
        </div>

        <p class="text-xs text-slate-300 leading-relaxed">
          灰测通道（API 30000 / Web 30003）与正式通道（API 30001 / Web 30002）共用同一份源码，
          但端口、数据目录独立。所有改动先在 30003 验证，确认无误后在这里一键重建并发布到正式版：
          重建 <span class="font-mono">web-pro</span> 产物 → 正式网关加载新前端 → 正式后端自重启加载新代码。
        </p>

        <div class="grid grid-cols-2 gap-3.5 text-xs font-mono">
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700 space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-amber-300 font-bold">灰测通道</span>
              <span :class="chUp(gray.channels?.gray) ? 'text-emerald-400' : 'text-rose-400'">
                {{ chUp(gray.channels?.gray) ? '在线' : '未启动' }}
              </span>
            </div>
            <div class="text-slate-400">API 30000 · Web 30003</div>
            <div class="text-slate-400">产物：{{ fmtTime(gray.channels?.gray?.dist?.builtAt) }}</div>
            <div class="text-slate-400 truncate">版本：{{ gray.channels?.gray?.dist?.commit || '未构建' }}</div>
          </div>
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700 space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-emerald-300 font-bold">正式通道</span>
              <span :class="chUp(gray.channels?.prod) ? 'text-emerald-400' : 'text-rose-400'">
                {{ chUp(gray.channels?.prod) ? '在线' : '未启动' }}
              </span>
            </div>
            <div class="text-slate-400">API 30001 · Web 30002</div>
            <div class="text-slate-400">产物：{{ fmtTime(gray.channels?.prod?.dist?.builtAt) }}</div>
            <div class="text-slate-400 truncate">版本：{{ gray.channels?.prod?.dist?.commit || '未构建' }}</div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 flex-wrap">
          <label class="flex items-center gap-2 text-xs text-slate-300 font-semibold cursor-pointer">
            <input type="checkbox" v-model="publishBuild" class="accent-emerald-500 w-4 h-4" />
            发布前重新构建前端产物（改了前端代码必须勾选）
          </label>
          <div class="flex items-center gap-2">
            <button
              @click="loadGrayStatus"
              :disabled="grayLoading"
              class="px-4 py-2 rounded-lg bg-studio-800 hover:bg-studio-750 border border-studio-700 text-white font-bold text-xs disabled:opacity-50"
            >{{ grayLoading ? '刷新中…' : '刷新状态' }}</button>
            <button
              @click="publishProd"
              :disabled="grayPublishing || gray.channel !== 'gray'"
              class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >{{ grayPublishing ? '发布中…' : '发布到正式版' }}</button>
          </div>
        </div>

        <div v-if="gray.channel !== 'gray'" class="text-xs text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded-lg p-2.5">
          发布入口只在灰测页面提供（防止在正式页面误点导致重复重启）。请打开
          <span class="font-mono font-bold">http://127.0.0.1:30003</span> → 系统设置 → 发布到正式版。
        </div>

        <!-- 发布进度 -->
        <div v-if="grayJob && (grayPublishing || grayJob.status !== 'running')" class="p-3 rounded-xl bg-studio-950 border border-studio-700 space-y-1.5">
          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-300 font-bold">发布任务</span>
            <span class="font-mono" :class="grayJob.status === 'failed' ? 'text-rose-400' : grayJob.status === 'done' ? 'text-emerald-400' : 'text-amber-300'">
              {{ grayJob.status === 'running' ? '进行中' : grayJob.status === 'done' ? '成功' : '失败' }}
            </span>
          </div>
          <div v-for="s in grayJob.steps" :key="s.key" class="text-[11px] leading-relaxed">
            <span :class="stepIconClass(s.status)" class="font-mono mr-1">{{ stepIcon(s.status) }}</span>
            <span class="text-slate-200 font-semibold">{{ s.label }}</span>
            <span v-if="s.detail" class="text-slate-400"> — {{ s.detail }}</span>
          </div>
          <div v-if="grayJob.error" class="text-[11px] text-rose-300">失败原因：{{ grayJob.error }}</div>
        </div>
        <div v-else-if="gray.lastPublish" class="text-[11px] text-slate-400 font-mono">
          上次发布：{{ fmtTime(gray.lastPublish.finishedAt) }} ·
          {{ gray.lastPublish.status === 'done' ? '成功' : '失败' }}
          {{ gray.lastPublish.error ? '（' + gray.lastPublish.error + '）' : '' }}
        </div>
      </div>

      <!-- 设置模块 2：灰度发布与应用更新管理 (白名单控制) -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <StudioIcon name="cloud" :size="16" class="text-cyan-400" />
            App 灰度更新通道与设备白名单
          </h3>
          <span class="text-xs text-amber-300 bg-amber-400/15 px-2.5 py-1 rounded-md border border-amber-400/40 font-mono font-bold">
            {{ latestVersionText }}
          </span>
        </div>
        <div class="space-y-3.5 text-xs">
          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">灰度测试目标机器号 / 设备白名单（当前生效值）</label>
            <textarea
              rows="2"
              readonly
              :value="targetDevicesText"
              placeholder="尚未配置灰度白名单"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-3 text-white font-mono text-xs outline-none opacity-90"
            ></textarea>
            <span class="text-xs text-slate-400 mt-1.5 block font-medium">
              白名单随灰度发布（releaseMode=canary + targetDevices）写入清单，本页只读展示；未入白名单的设备即使触发更新检查也收不到灰度包。
            </span>
          </div>
          <div class="flex items-center justify-between font-mono">
            <span :class="grayscale.active ? 'text-emerald-400 font-bold' : 'text-slate-400'">
              灰度通道：{{ grayscale.active ? '进行中' : '未启用' }}
            </span>
            <span v-if="canaryVersionText" class="text-slate-300">灰度包：{{ canaryVersionText }}</span>
          </div>
        </div>
      </div>

      <!-- 设置模块 3：网关分流与人脸可见性审核策略 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-3.5 shadow-sm">
        <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
          <StudioIcon name="sliders" :size="16" class="text-studio-indigo" />
          网关分流与分类互斥审核规则
        </h3>
        <p class="text-xs text-slate-300 leading-relaxed font-normal">
          已生效规则：当图片中无法清晰完整识别出人体面部轮廓特征时，系统将坚决拒绝分流至【虚拟人像】库，自动修正归类为【服装服饰】或【空间素材】。
        </p>
        <div class="flex items-center space-x-2 text-xs text-emerald-400 font-semibold">
          <StudioIcon name="check" :size="15" />
          <span>VLM 人脸互斥阻断规则已全面生效并在图 4 资产验证通过</span>
        </div>
      </div>

      <!-- 设置模块 3.5：素材衍生图默认挂载（所有资产选择器共用） -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <StudioIcon name="image" :size="16" class="text-sky-400" />
            素材衍生图默认挂载
          </h3>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-studio-700 bg-studio-800 text-slate-300 hover:text-white cursor-pointer"
              @click="resetSlotPrefs"
            >恢复默认</button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors"
              :class="slotPrefs.enabled
                ? 'bg-emerald-400/15 border-emerald-400/40 text-emerald-300'
                : 'bg-studio-800 border-studio-700 text-slate-400'"
              @click="toggleSlotEnabled"
            >{{ slotPrefs.enabled ? '已启用' : '已关闭' }}</button>
          </div>
        </div>
        <p class="text-xs text-slate-300 leading-relaxed">
          每张图片在挂载时默认就该具备这些画幅。资产选择器会把缺失的那一档显示成「待生成」虚线插槽，
          点一下就地补出来；已经在库里的那一档不会重复生成。
        </p>
        <div class="space-y-2.5">
          <div
            v-for="categoryKey in slotCategoryOrder"
            :key="categoryKey"
            class="flex items-center justify-between gap-3 p-3 rounded-xl bg-studio-950 border border-studio-700"
          >
            <span class="text-xs font-bold text-slate-200 shrink-0">{{ slotCategoryLabel(categoryKey) }}</span>
            <div class="flex items-center gap-2">
              <button
                v-for="option in slotOptions"
                :key="option.kind"
                type="button"
                class="px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors cursor-pointer"
                :class="slotRatioSelected(categoryKey, option.ratio)
                  ? 'bg-sky-400/15 border-sky-400/50 text-sky-300'
                  : 'bg-studio-900 border-studio-700 text-slate-500 hover:text-slate-300'"
                :disabled="!slotPrefs.enabled"
                @click="toggleSlotRatio(categoryKey, option.ratio)"
              >{{ option.label }}</button>
            </div>
          </div>
        </div>
        <span class="text-xs text-slate-400 block font-medium">
          关闭后所有资产选择器都不再显示待生成插槽；改动即时生效，不需要点保存，也不需要刷新页面。
        </span>
      </div>

      <!-- 设置模块 4：存储路径与 NAS 挂载状态 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-3.5 shadow-sm">
        <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
          <StudioIcon name="building" :size="16" class="text-slate-300" />
          存储路径与 NAS 挂载状态
        </h3>
        <div class="grid grid-cols-2 gap-3.5 text-xs font-mono">
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700">
            <span class="text-slate-400 text-xs block mb-1">本地数据库 (SQLite)</span>
            <span class="text-white font-semibold break-all">{{ sqlitePathText }}</span>
          </div>
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700">
            <span class="text-slate-400 text-xs block mb-1.5">NAS 存储挂载点</span>
            <input
              v-model="runtimeForm.nas_dir"
              type="text"
              placeholder="/mnt/synology/material"
              class="w-full bg-studio-900 border border-studio-700 rounded-md p-2 text-white font-mono text-xs outline-none focus:border-studio-accent"
            />
          </div>
        </div>
        <span class="text-xs text-slate-400 block font-medium">
          数据目录为服务端只读项；NAS 挂载点修改后点击上方「保存运行参数」即时生效。
        </span>
      </div>

      <!-- 设置模块 4.5：空间创作换色预置 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
              <StudioIcon name="palette" :size="16" class="text-amber-400" />
              空间创作换色预置方案
            </h3>
            <p class="text-xs text-slate-400 mt-1">管理空间创作「换色」预定操作中可选择的整案配色与常用材质单色库</p>
          </div>
          <div class="flex items-center gap-3">
            <span v-if="colorSchemesMsg" class="text-xs font-mono" :class="colorSchemesMsg.includes('失败') ? 'text-rose-400' : 'text-emerald-400'">
              {{ colorSchemesMsg }}
            </span>
            <button
              @click="loadColorSchemes"
              :disabled="colorSchemesLoading"
              class="px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 border border-studio-700 text-slate-300 hover:text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >刷新</button>
            <button
              @click="handleSaveColorSchemes"
              :disabled="colorSchemesSaving || colorSchemesLoading"
              class="px-4 py-1.5 rounded-lg bg-studio-accent text-white font-bold text-xs shadow cursor-pointer disabled:opacity-50"
            >{{ colorSchemesSaving ? '保存中…' : '保存换色预置' }}</button>
          </div>
        </div>

        <div v-if="colorSchemesLoading && !colorSchemes.length" class="text-xs text-slate-400 py-4 text-center">
          正在读取换色配色表…
        </div>

        <div v-else class="space-y-4">
          <!-- 方案列表 (scheme) -->
          <div
            v-for="(scheme, sIdx) in colorSchemes.filter(s => s.kind === 'scheme')"
            :key="scheme.id"
            class="p-4 rounded-xl bg-studio-950 border border-studio-800 space-y-3"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-amber-300 font-mono">方案 {{ sIdx + 1 }}:</span>
                <input
                  v-model="scheme.name"
                  type="text"
                  class="bg-studio-900 border border-studio-700 rounded px-2 py-1 text-xs text-white font-medium focus:border-studio-accent outline-none"
                />
              </div>
              <button
                @click="addColorRole(scheme)"
                class="text-xs text-studio-accent hover:underline cursor-pointer"
              >+ 添加空间角色</button>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div
                v-for="(roleItem, rIdx) in (scheme.roles || [])"
                :key="rIdx"
                class="p-2.5 rounded-lg bg-studio-900 border border-studio-750 flex flex-col gap-1.5"
              >
                <div class="flex items-center justify-between">
                  <input
                    v-model="roleItem.role"
                    placeholder="角色(如墙面)"
                    class="bg-transparent border-b border-studio-700 text-[11px] text-slate-300 w-16 outline-none focus:border-amber-400 font-bold"
                  />
                  <button
                    @click="removeColorRole(scheme, rIdx)"
                    class="text-slate-500 hover:text-rose-400 text-xs cursor-pointer"
                  >×</button>
                </div>
                <input
                  v-model="roleItem.name"
                  placeholder="材质名称"
                  class="bg-transparent text-xs text-white outline-none font-medium"
                />
                <div class="flex items-center gap-2 pt-1 border-t border-studio-800/60">
                  <input
                    type="color"
                    v-model="roleItem.hex"
                    class="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                  />
                  <input
                    v-model="roleItem.hex"
                    class="bg-transparent text-[11px] font-mono text-slate-300 uppercase w-16 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- 常用单色库 (swatch) -->
          <div
            v-for="swatch in colorSchemes.filter(s => s.kind === 'swatch')"
            :key="swatch.id"
            class="p-4 rounded-xl bg-studio-950 border border-studio-800 space-y-3"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-sky-300 font-mono">常用单色库:</span>
                <input
                  v-model="swatch.name"
                  type="text"
                  class="bg-studio-900 border border-studio-700 rounded px-2 py-1 text-xs text-white font-medium focus:border-studio-accent outline-none"
                />
              </div>
              <button
                @click="addSwatchColor(swatch)"
                class="text-xs text-studio-accent hover:underline cursor-pointer"
              >+ 添加常用单色</button>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
              <div
                v-for="(col, cIdx) in (swatch.roles || [])"
                :key="cIdx"
                class="p-2 rounded-lg bg-studio-900 border border-studio-750 flex items-center justify-between gap-1.5"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <input
                    type="color"
                    v-model="col.hex"
                    class="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0 shrink-0"
                  />
                  <input
                    v-model="col.name"
                    class="bg-transparent text-xs text-white outline-none font-medium truncate w-14"
                  />
                </div>
                <button
                  @click="removeSwatchColor(swatch, cIdx)"
                  class="text-slate-500 hover:text-rose-400 text-xs cursor-pointer shrink-0"
                >×</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 设置模块 5：管理员账户密码 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <StudioIcon name="user" :size="16" class="text-rose-400" />
            管理员账户密码
          </h3>
          <span class="text-xs font-mono" :class="pwdMessage.startsWith('密码') ? 'text-emerald-400' : 'text-slate-400'">
            {{ pwdMessage }}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-4 text-xs">
          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">目标用户名</label>
            <input
              v-model="pwdForm.username"
              type="text"
              :placeholder="currentUsername || 'admin'"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs outline-none focus:border-studio-accent"
            />
          </div>
          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">新密码</label>
            <input
              v-model="pwdForm.password"
              type="password"
              placeholder="至少 6 位"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs outline-none focus:border-studio-accent"
            />
          </div>
        </div>
        <div class="flex justify-end">
          <button
            @click="submitPassword"
            :disabled="pwdSaving || !pwdForm.username.trim() || !pwdForm.password"
            class="px-5 py-2.5 rounded-xl bg-studio-accent text-white font-bold text-xs shadow cursor-pointer disabled:opacity-50"
          >{{ pwdSaving ? '提交中…' : '修改密码' }}</button>
        </div>
        <span class="text-xs text-slate-400 block font-medium">
          仅超级管理员 admin 可调用；密码经服务端加盐哈希后写入 users 表。
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import StudioIcon from '../components/StudioIcon.vue';
import {
  serverLabel,
  listCandidates,
  getManualServer,
  setManualServer,
  ensureServerBase,
  onServerStatusChange,
  getCurrentUser,
  getRuntimeConfig,
  saveRuntimeConfig,
  changeUserPassword,
  fetchAppUpdateState,
  fetchEnvSecrets,
  saveEnvSecrets,
  fetchColorSchemes,
  saveColorSchemes,
  authFetch,
} from '../api.js';
import {
  ALL_SLOT_PRESETS,
  DEFAULT_SLOT_RATIOS,
  SLOT_CATEGORY_LABELS,
  SLOT_CATEGORY_ORDER,
  onDerivativeSlotPrefsChange,
  readDerivativeSlotPrefs,
  writeDerivativeSlotPrefs,
} from '../../../shared/ml-asset-core/index.ts';

const online = ref(true);
const probing = ref(false);
const serverLabelText = ref(serverLabel());
const candidates = ref(listCandidates());
const manualInput = ref(getManualServer());
let stopWatch = null;

// ===== 真实系统设置状态 =====
const runtimeForm = reactive({
  litellm_model: '',
  litellm_base_url: '',
  nas_dir: '',
});
const runtimeData = ref({});
const runtimeLoading = ref(false);
const runtimeSaving = ref(false);
const runtimeError = ref('');

const secrets = ref([]);
const arkKeyDraft = ref('');
const keySaving = ref(false);

const newapiKeyDraft = ref('');
const newapiKeyMasked = computed(() => {
  const item = secrets.value.find((x) => (x.env || x.key) === 'NEWAPI_API_KEY');
  return item && item.has_value ? item.masked : '未配置';
});
const newapiSaving = ref(false);
const newapiLoading = ref(false);
const newapiError = ref('');
const newapiCount = ref(0);
const newapiGeminiModels = ref([]);

// ===== 换色预置状态 =====
const colorSchemes = ref([]);
const colorSchemesLoading = ref(false);
const colorSchemesSaving = ref(false);
const colorSchemesMsg = ref('');

async function loadColorSchemes() {
  colorSchemesLoading.value = true;
  colorSchemesMsg.value = '';
  try {
    const list = await fetchColorSchemes();
    colorSchemes.value = Array.isArray(list) ? list : [];
  } catch (err) {
    colorSchemesMsg.value = '读取换色预置失败: ' + (err.message || String(err));
    colorSchemes.value = [];
  } finally {
    colorSchemesLoading.value = false;
  }
}

async function handleSaveColorSchemes() {
  colorSchemesSaving.value = true;
  colorSchemesMsg.value = '';
  try {
    await saveColorSchemes(colorSchemes.value);
    colorSchemesMsg.value = '换色预置保存成功';
    setTimeout(() => { colorSchemesMsg.value = ''; }, 3000);
  } catch (err) {
    colorSchemesMsg.value = '保存失败: ' + (err.message || String(err));
  } finally {
    colorSchemesSaving.value = false;
  }
}

// ===== 素材衍生图默认挂载（所有资产选择器共用这份设置）=====
const slotPrefs = ref(readDerivativeSlotPrefs());
const slotOptions = ALL_SLOT_PRESETS;
const slotCategoryOrder = SLOT_CATEGORY_ORDER;
let stopSlotPrefsWatch = null;

function slotCategoryLabel(key) {
  return SLOT_CATEGORY_LABELS[key] || key;
}
function slotRatioSelected(categoryKey, ratio) {
  const list = slotPrefs.value.ratios[categoryKey];
  return Array.isArray(list) && list.includes(ratio);
}
/** 勾选/取消某一档：写完立刻广播，选择器无需刷新页面就能变。 */
function toggleSlotRatio(categoryKey, ratio) {
  const next = {
    enabled: slotPrefs.value.enabled,
    ratios: { ...slotPrefs.value.ratios },
  };
  const list = Array.isArray(next.ratios[categoryKey]) ? next.ratios[categoryKey].slice() : [];
  const idx = list.indexOf(ratio);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(ratio);
  next.ratios[categoryKey] = list;
  slotPrefs.value = next;
  writeDerivativeSlotPrefs(next);
}
function toggleSlotEnabled() {
  const next = { enabled: !slotPrefs.value.enabled, ratios: { ...slotPrefs.value.ratios } };
  slotPrefs.value = next;
  writeDerivativeSlotPrefs(next);
}
function resetSlotPrefs() {
  const next = { enabled: true, ratios: { ...DEFAULT_SLOT_RATIOS } };
  slotPrefs.value = next;
  writeDerivativeSlotPrefs(next);
}

const updateState = ref(null);
const grayscale = computed(() => updateState.value?.grayscale || { active: false, targetDevices: [] });

// ===== 双通道灰度发布（30003/30000 → 30002/30001）=====
const gray = ref({ channel: '', channels: { gray: {}, prod: {} }, git: {}, lastPublish: null });
const grayLoading = ref(false);
const grayPublishing = ref(false);
const grayJob = ref(null);
const publishBuild = ref(true);
let grayPoll = null;

function chUp(ch) {
  return !!(ch && ch.api && ch.api.up && ch.web && ch.web.up);
}
function fmtTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false });
  } catch (_) {
    return '—';
  }
}
function stepIcon(s) {
  return s === 'done' ? '✓' : s === 'failed' ? '✗' : s === 'skipped' ? '–' : '…';
}
function stepIconClass(s) {
  return s === 'done' ? 'text-emerald-400' : s === 'failed' ? 'text-rose-400' : s === 'skipped' ? 'text-slate-500' : 'text-amber-300';
}

async function loadGrayStatus() {
  if (grayLoading.value) return;
  grayLoading.value = true;
  try {
    const r = await authFetch('/api/gray/status');
    const j = await r.json();
    if (r.ok) gray.value = j;
  } catch (_) {
    // 灰测通道未启动时静默，页面其它模块照常可用
  } finally {
    grayLoading.value = false;
  }
}

function pollGrayJob(id) {
  clearInterval(grayPoll);
  grayPoll = setInterval(async () => {
    try {
      const r = await authFetch(`/api/gray/publish?jobId=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (j.job) grayJob.value = j.job;
      if (!j.job || j.job.status !== 'running') {
        clearInterval(grayPoll);
        grayPoll = null;
        grayPublishing.value = false;
        loadGrayStatus();
      }
    } catch (_) {}
  }, 1500);
}

async function publishProd() {
  if (grayPublishing.value) return;
  if (gray.channel !== 'gray') {
    alert('发布入口只在灰测通道（30003）提供');
    return;
  }
  const ok = confirm(
    '即将把当前工作区代码发布到正式版：\n' +
      '1) 重新构建 web-pro 产物（可选）\n' +
      '2) 正式网关 30002 加载新前端并重启\n' +
      '3) 正式后端 30001 自重启加载新代码\n\n' +
      '发布期间正式页面会短暂刷新，确定继续？'
  );
  if (!ok) return;
  grayPublishing.value = true;
  grayJob.value = null;
  try {
    const r = await authFetch('/api/gray/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildFrontend: publishBuild.value }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    grayJob.value = j.job;
    pollGrayJob(j.job.id);
  } catch (e) {
    grayPublishing.value = false;
    alert('发布失败: ' + e.message);
  }
}

const currentUser = computed(() => getCurrentUser() || null);
const currentUsername = computed(() => currentUser.value?.username || '');

const pwdForm = reactive({ username: '', password: '' });
const pwdSaving = ref(false);
const pwdMessage = ref('');

const arkKeyMasked = computed(() => {
  const item = secrets.value.find((x) => (x.env || x.key) === 'ARK_API_KEY');
  return item && item.has_value ? item.masked : '未配置';
});

const targetDevicesText = computed(() => {
  const list = grayscale.value?.targetDevices;
  if (Array.isArray(list)) return list.join(', ');
  return String(list || '');
});

const latestVersionText = computed(() => {
  const latest = updateState.value?.latest;
  if (!latest || !latest.versionName) return '当前正式版: 未发布';
  return `当前正式版: v${latest.versionName} (${latest.versionCode || 0})`;
});

const canaryVersionText = computed(() => {
  const canary = updateState.value?.canary;
  if (!canary || !canary.versionName) return '';
  return `v${canary.versionName} (${canary.versionCode || 0})`;
});

const dataDirText = computed(() => String(runtimeData.value?.data_dir || '').replace(/[\\/]+$/, ''));
const sqlitePathText = computed(() => (dataDirText.value ? `${dataDirText.value}/material.db` : '未知（需管理员权限读取）'));

async function loadAdminSettings() {
  runtimeLoading.value = true;
  runtimeError.value = '';
  try {
    const [cfg, state, sec] = await Promise.all([
      getRuntimeConfig().catch((e) => { runtimeError.value = e.message; return null; }),
      fetchAppUpdateState().catch(() => null),
      fetchEnvSecrets().catch(() => null),
    ]);
    if (cfg) {
      runtimeData.value = cfg;
      runtimeForm.litellm_model = cfg.litellm_model || '';
      runtimeForm.litellm_base_url = cfg.litellm_base_url || '';
      runtimeForm.nas_dir = cfg.nas_dir || '';
    }
    if (state) updateState.value = state;
    if (sec && Array.isArray(sec.items)) secrets.value = sec.items;
  } finally {
    runtimeLoading.value = false;
  }
}

async function saveRuntime() {
  if (runtimeSaving.value) return;
  runtimeSaving.value = true;
  runtimeError.value = '';
  try {
    const updated = await saveRuntimeConfig({
      litellm_model: runtimeForm.litellm_model,
      litellm_base_url: runtimeForm.litellm_base_url,
      nas_dir: runtimeForm.nas_dir,
    });
    runtimeData.value = updated;
    runtimeForm.litellm_model = updated.litellm_model || runtimeForm.litellm_model;
    runtimeForm.litellm_base_url = updated.litellm_base_url || runtimeForm.litellm_base_url;
    runtimeForm.nas_dir = updated.nas_dir || runtimeForm.nas_dir;
    alert('运行参数已保存并即时生效');
  } catch (e) {
    runtimeError.value = e.message;
    alert('保存失败: ' + e.message);
  } finally {
    runtimeSaving.value = false;
  }
}

async function updateArkKey() {
  const key = arkKeyDraft.value.trim();
  if (!key || keySaving.value) return;
  keySaving.value = true;
  try {
    await saveEnvSecrets({ ARK_API_KEY: key });
    arkKeyDraft.value = '';
    const sec = await fetchEnvSecrets().catch(() => null);
    if (sec && Array.isArray(sec.items)) secrets.value = sec.items;
    alert('火山方舟 API Key 已更新并热生效');
  } catch (e) {
    alert('更新密钥失败: ' + e.message);
  } finally {
    keySaving.value = false;
  }
}

async function updateNewapiKey() {
  const key = newapiKeyDraft.value.trim();
  if (!key || newapiSaving.value) return;
  newapiSaving.value = true;
  try {
    await saveEnvSecrets({ NEWAPI_API_KEY: key });
    newapiKeyDraft.value = '';
    const sec = await fetchEnvSecrets().catch(() => null);
    if (sec && Array.isArray(sec.items)) secrets.value = sec.items;
    await loadNewapiModels();
    alert('New API Key 已更新并热生效');
  } catch (e) {
    alert('更新密钥失败: ' + e.message);
  } finally {
    newapiSaving.value = false;
  }
}

async function loadNewapiModels() {
  if (newapiLoading.value) return;
  newapiLoading.value = true;
  newapiError.value = '';
  try {
    const json = await authFetch('/api/providers/newapi/models').then((r) => r.json());
    if (json.success === false) throw new Error(json.error || '读取失败');
    newapiCount.value = json.data?.count || 0;
    const models = Array.isArray(json.data?.models) ? json.data.models : [];
    newapiGeminiModels.value = models.filter((m) => /gemini.*image/i.test(m));
  } catch (e) {
    newapiCount.value = 0;
    newapiGeminiModels.value = [];
    newapiError.value = e.message;
  } finally {
    newapiLoading.value = false;
  }
}

async function submitPassword() {
  if (pwdSaving.value) return;
  pwdSaving.value = true;
  pwdMessage.value = '';
  try {
    await changeUserPassword(pwdForm.username.trim(), pwdForm.password);
    pwdForm.password = '';
    pwdMessage.value = '密码修改成功';
    alert('密码修改成功');
  } catch (e) {
    pwdMessage.value = e.message;
    alert('修改密码失败: ' + e.message);
  } finally {
    pwdSaving.value = false;
  }
}

async function reprobe() {
  if (probing.value) return;
  probing.value = true;
  try {
    const r = await ensureServerBase({ force: true });
    online.value = !r.allDown;
  } catch {
    online.value = false;
  } finally {
    probing.value = false;
    serverLabelText.value = serverLabel();
    candidates.value = listCandidates();
  }
}

async function saveManual() {
  await setManualServer((manualInput.value || '').trim());
  manualInput.value = getManualServer();
  await reprobe();
}

// 当前生效 base（去协议后）与候选行做包含匹配（同源行带“（同源网关）”后缀）
function isActiveCandidate(candidate) {
  const label = serverLabel();
  if (!label) return false;
  return candidate.includes(label);
}

onMounted(() => {
  pwdForm.username = currentUsername.value || 'admin';
  stopWatch = onServerStatusChange((detail) => {
    online.value = !detail.allDown;
    serverLabelText.value = detail.label || serverLabel();
    candidates.value = listCandidates();
  });
  loadColorSchemes();
  loadAdminSettings();
  loadNewapiModels();
  loadGrayStatus();
  stopSlotPrefsWatch = onDerivativeSlotPrefsChange((next) => {
    slotPrefs.value = next;
  });
});

onUnmounted(() => {
  if (stopWatch) stopWatch();
  if (grayPoll) clearInterval(grayPoll);
  if (stopSlotPrefsWatch) stopSlotPrefsWatch();
});
</script>
