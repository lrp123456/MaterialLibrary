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

      <!-- 设置模块 0.5：HTTPS 局域网安全根证书与设备信任 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <span class="text-base">🔒</span>
            HTTPS 局域网安全证书与设备信任
          </h3>
          <span
            class="text-xs px-2.5 py-1 rounded-full font-mono flex items-center gap-1.5"
            :class="isHttps ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'"
          >
            <span>{{ isHttps ? '● HTTPS 安全上下文已就绪' : '⚠️ 当前处于 HTTP 协议' }}</span>
          </span>
        </div>

        <p class="text-xs text-slate-300 leading-relaxed">
          现代浏览器将<strong>麦克风语音输入</strong>（AudioWorklet）、<strong>硬件加速视音频编解码</strong>（WebCodecs）、<strong>多线程离线导出</strong>（SharedArrayBuffer）及安全大文件下载设为最高安全级别。
          在局域网其它电脑或手机上访问本工作台时，安装本服务端 CA 根证书即可消除『不安全』警示并杜绝下载失败问题。
        </p>

        <!-- 证书快速操作行 -->
        <div class="p-4 rounded-xl bg-studio-950 border border-studio-800 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-studio-accent/20 border border-studio-accent/40 flex items-center justify-center text-studio-cyan text-lg">
              📜
            </div>
            <div>
              <div class="text-xs font-bold text-white font-mono flex items-center gap-2">
                <span>mls-ca.crt</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-studio-800 text-slate-400">X.509 权威根证书</span>
              </div>
              <div class="text-[11px] text-slate-400 mt-0.5 font-mono">
                发布源: Material Library Server Local CA · 支持局域网跨设备信任
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <a
              href="/mls-ca.crt"
              download="mls-ca.crt"
              class="px-4 py-2.5 rounded-lg bg-studio-accent hover:bg-studio-accent/90 text-white font-bold text-xs cursor-pointer flex items-center gap-1.5 shadow-sm transition"
              title="下载根证书并导入操作系统受信任存储区"
            >
              <StudioIcon name="download" :size="14" />
              <span>下载根证书 (mls-ca.crt)</span>
            </a>
            <button
              @click="copyCaLink"
              type="button"
              class="px-3 py-2.5 rounded-lg bg-studio-800 hover:bg-studio-750 border border-studio-700 text-slate-200 text-xs font-bold cursor-pointer transition flex items-center gap-1"
              title="复制证书下载直链，以便在手机或其他设备打开下载"
            >
              <span>{{ copiedCaUrl ? '✓ 已复制' : '📋 复制直链' }}</span>
            </button>
            <a
              v-if="isHttps"
              :href="httpFallbackUrl"
              target="_blank"
              class="px-3 py-2.5 rounded-lg bg-studio-900 hover:bg-studio-800 border border-studio-750 text-slate-400 hover:text-slate-200 text-xs font-mono transition"
              title="紧急备用：直接在 HTTP 模式下打开工作台（免装证书，但部分硬件加速特权将降级）"
            >
              免证书 HTTP 临时通道 ↗
            </a>
          </div>
        </div>

        <!-- 各操作系统安装指南选项卡 -->
        <div class="space-y-3 pt-1">
          <div class="flex items-center justify-between border-b border-studio-800 pb-2">
            <span class="text-xs font-bold text-slate-300 flex items-center gap-1">
              <span>📖</span>
              <span>设备导入与受信任安装指引</span>
            </span>
            <div class="flex items-center gap-1">
              <button
                v-for="tab in [
                  { id: 'windows', label: 'Windows 系统' },
                  { id: 'macos', label: 'macOS 苹果' },
                  { id: 'ios', label: 'iOS / iPhone' },
                  { id: 'android', label: 'Android 安卓' }
                ]"
                :key="tab.id"
                @click="selectedOsGuide = tab.id"
                class="px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition"
                :class="selectedOsGuide === tab.id ? 'bg-studio-800 text-studio-cyan font-bold border border-studio-700' : 'text-slate-400 hover:text-white'"
              >
                {{ tab.label }}
              </button>
            </div>
          </div>

          <!-- Windows 指南 -->
          <div v-if="selectedOsGuide === 'windows'" class="p-3.5 rounded-xl bg-studio-950/70 border border-studio-800 text-xs text-slate-300 space-y-1.5 font-mono">
            <div class="font-bold text-white flex items-center gap-1">
              <span class="text-blue-400">Windows 安装步骤：</span>
            </div>
            <ol class="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed pl-1">
              <li>点击上方<strong>【下载根证书】</strong>保存 <code class="text-amber-300">mls-ca.crt</code> 并双击打开该文件；</li>
              <li>在弹出的证书窗口中点击<strong>【安装证书...】</strong>；</li>
              <li>存储位置选择<strong>【当前用户】</strong>或【本地计算机】（推荐本地计算机），点击【下一步】；</li>
              <li>勾选<strong>【将所有的证书都放入下列存储】</strong>，点击【浏览】并选中<strong>【受信任的根证书颁发机构】</strong>；</li>
              <li>点击【下一步】->【完成】，在弹出的安全警告中确认<strong>【是】</strong>；</li>
              <li>彻底关闭并重新打开浏览器访问，地址栏即可呈现受信任的安全小绿锁 🔒。</li>
            </ol>
          </div>

          <!-- macOS 指南 -->
          <div v-else-if="selectedOsGuide === 'macos'" class="p-3.5 rounded-xl bg-studio-950/70 border border-studio-800 text-xs text-slate-300 space-y-1.5 font-mono">
            <div class="font-bold text-white flex items-center gap-1">
              <span class="text-purple-400">macOS 安装步骤：</span>
            </div>
            <ol class="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed pl-1">
              <li>下载 <code class="text-amber-300">mls-ca.crt</code> 后双击，系统将自动唤起<strong>【钥匙串访问】</strong>应用；</li>
              <li>在左侧栏选择<strong>【系统】</strong>或【登录】钥匙串，找到并双击 <strong>Material Library Server Local CA</strong>；</li>
              <li>展开<strong>【信任】(Trust)</strong> 栏目，将【使用此证书时】下拉改为<strong>【始终信任】(Always Trust)</strong>；</li>
              <li>关闭窗口并输入 macOS 开机密码保存确认；重启 Safari / Chrome 即可生效。</li>
            </ol>
          </div>

          <!-- iOS 指南 -->
          <div v-else-if="selectedOsGuide === 'ios'" class="p-3.5 rounded-xl bg-studio-950/70 border border-studio-800 text-xs text-slate-300 space-y-1.5 font-mono">
            <div class="font-bold text-white flex items-center gap-1">
              <span class="text-sky-400">iPhone / iPadOS 安装步骤：</span>
            </div>
            <ol class="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed pl-1">
              <li>使用 Safari 浏览器打开下载链接，点击<strong>【允许】</strong>下载配置描述文件；</li>
              <li>进入 iPhone<strong>【设置】</strong>-> 顶部点击<strong>【已下载描述文件】</strong>-> 点击右上角<strong>【安装】</strong>；</li>
              <li>安装后，返回进入 iPhone<strong>【设置】->【通用】->【关于本机】-> 滑动到底部【证书信任设置】</strong>；</li>
              <li>在『针对根证书启用完全信任』列表中，将 <strong>Material Library Server Local CA</strong> 的开关<strong>【打开】</strong>并确认；</li>
              <li>返回 Safari 刷新页面即可畅快体验语音与流式功能。</li>
            </ol>
          </div>

          <!-- Android 指南 -->
          <div v-else class="p-3.5 rounded-xl bg-studio-950/70 border border-studio-800 text-xs text-slate-300 space-y-1.5 font-mono">
            <div class="font-bold text-white flex items-center gap-1">
              <span class="text-emerald-400">Android 安卓安装步骤：</span>
            </div>
            <ol class="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed pl-1">
              <li>点击上方按钮将 <code class="text-amber-300">mls-ca.crt</code> 下载保存至手机内部存储；</li>
              <li>进入手机系统<strong>【设置】->【安全】</strong>（或【密码与安全】/【更多安全设置】）；</li>
              <li>找到<strong>【安装证书】</strong>或【凭据存储】-> 选择<strong>【CA 证书】</strong>；</li>
              <li>在弹出的警告中点击【仍然安装】，浏览选中刚下载的 <code class="text-amber-300">mls-ca.crt</code> 即可完成导入。</li>
            </ol>
          </div>
        </div>
      </div>

      <!-- 设置模块 1：系统基础设施与算力治理中枢 (只读探针 + 引导至 30001 服务端控制台) -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
              <StudioIcon name="sparkles" :size="16" class="text-studio-accent" />
              AI 算力引擎与基础设施状态
            </h3>
            <p class="text-xs text-slate-400 mt-1">模型供应商密钥、网络代理、NAS 路径与任务治理已统一收敛至【服务端控制台 (30001)】</p>
          </div>
          <a
            :href="serverAdminUrl"
            target="_blank"
            class="px-4 py-2 rounded-xl bg-studio-accent hover:brightness-110 text-white font-bold text-xs flex items-center gap-1.5 shadow transition-all cursor-pointer"
          >
            <StudioIcon name="settings" :size="14" />
            <span>打开服务端控制台 (30001)</span>
            <span class="text-xs">↗</span>
          </a>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700">
            <div class="text-slate-400 mb-1">主推理模型</div>
            <div class="text-white font-semibold truncate">{{ runtimeForm.litellm_model || '默认' }}</div>
          </div>
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700">
            <div class="text-slate-400 mb-1">火山方舟 (Ark)</div>
            <div class="text-emerald-400 font-semibold">{{ arkKeyMasked && arkKeyMasked !== '未配置' ? '已接入' : '未就绪' }}</div>
          </div>
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700">
            <div class="text-slate-400 mb-1">New API 网关</div>
            <div class="text-emerald-400 font-semibold">{{ newapiCount ? `${newapiCount} 个模型可用` : (newapiKeyMasked && newapiKeyMasked !== '未配置' ? '已接入' : '未就绪') }}</div>
          </div>
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700">
            <div class="text-slate-400 mb-1">NAS 存储挂载</div>
            <div class="text-slate-200 font-semibold truncate" :title="runtimeForm.nas_dir">{{ runtimeForm.nas_dir || '本地' }}</div>
          </div>
        </div>

        <div class="p-3 rounded-xl bg-studio-950/60 border border-studio-800 flex items-center justify-between flex-wrap gap-2 text-xs text-slate-400">
          <span class="flex items-center gap-2">
            <StudioIcon name="info" :size="14" class="text-studio-accent shrink-0" />
            <span>需要更新 API Key、调整并发数或管理用户？请直接在服务端控制台进行安全维护。</span>
          </span>
          <span class="font-mono text-slate-500 text-[11px]">{{ serverLabelText || 'localhost:30001' }}</span>
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

      <!-- 设置模块 3.4：工作室全局默认参数 (双轨持久化) -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <StudioIcon name="sliders" :size="16" class="text-emerald-400" />
            工作室创作全局默认参数
          </h3>
          <div class="flex items-center gap-2">
            <span v-if="studioDefaultsSavedMsg" class="text-xs text-emerald-400 font-bold animate-pulse">{{ studioDefaultsSavedMsg }}</span>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors bg-emerald-600/30 border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/50"
              :disabled="studioDefaultsSaving"
              @click="saveStudioDefaultsForm"
            >
              {{ studioDefaultsSaving ? '保存中…' : '保存工作室默认参数' }}
            </button>
          </div>
        </div>

        <p class="text-xs text-slate-400 leading-relaxed">
          集中控制 Web 工作室新建会话或重置时的初始默认模型、画幅比例、视频/图片清晰度。配置将即时保存至服务端数据库，无需重启服务。
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">默认生图模型</label>
            <!-- 下拉改读 /api/studio/catalog：按用户可见模型过滤后，设置页不会出现不可见的模型 -->
            <select v-model="studioDefaultsForm.models.image" class="w-full bg-studio-950 text-white font-bold border border-studio-700 rounded-lg px-2.5 py-1.5 outline-none">
              <option v-for="o in imageModelOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>

          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">默认生图画幅</label>
            <select v-model="studioDefaultsForm.params.ratio" class="w-full bg-studio-950 text-white font-bold border border-studio-700 rounded-lg px-2.5 py-1.5 outline-none">
              <option value="9:16">9:16 (竖版短视频/手机 · 推荐)</option>
              <option value="16:9">16:9 (横版宽屏)</option>
              <option value="3:4">3:4 (竖版插画)</option>
              <option value="4:3">4:3 (经典横版)</option>
              <option value="1:1">1:1 (正方形)</option>
            </select>
          </div>

          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">默认生视频模型</label>
            <select v-model="studioDefaultsForm.models.video" class="w-full bg-studio-950 text-white font-bold border border-studio-700 rounded-lg px-2.5 py-1.5 outline-none">
              <option v-for="o in videoModelOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>

          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">默认视频清晰度</label>
            <select v-model="studioDefaultsForm.params.video_resolution" class="w-full bg-studio-950 text-white font-bold border border-studio-700 rounded-lg px-2.5 py-1.5 outline-none">
              <option value="480p">480p</option>
              <option value="480px2（超分）">480px2（超分）</option>
              <option value="720p">720p</option>
              <option value="720px2（超分）">720px2（超分）</option>
              <option value="1080p">1080p</option>
              <option value="1080px2（超分）">1080px2（超分）</option>
            </select>
          </div>
        </div>

        <!-- 按模型专属默认参数：三层优先级的第 2 层 -->
        <div class="mt-5 pt-4 border-t border-studio-700">
          <div class="flex items-start justify-between gap-3 mb-3">
            <div>
              <p class="text-xs font-bold text-slate-200">按模型单独配默认参数</p>
              <p class="text-[11px] text-slate-400 mt-1 leading-relaxed">
                优先级：会话上一轮快照 &gt; 这里配置的模型专属默认 &gt; 上方全局默认（9:16）。留空表示跟随全局；新会话严格按这个顺序取值，挂参考图不会自动改写画幅。
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors bg-studio-800 border-studio-700 text-slate-200 hover:bg-studio-750"
              @click="addPerModelRow"
            >
              + 添加模型
            </button>
          </div>

          <p v-if="perModelRows.length === 0" class="text-[11px] text-slate-500">尚未配置任何模型专属默认，所有模型跟随上方全局默认。</p>

          <div
            v-for="(row, i) in perModelRows"
            :key="i"
            class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-2 items-end p-2 rounded-lg bg-studio-950/60 border border-studio-800"
          >
            <div class="col-span-2">
              <label class="text-slate-400 block mb-1">模型</label>
              <select v-model="row.modelKey" class="w-full bg-studio-950 text-white border border-studio-700 rounded-lg px-2 py-1.5 outline-none">
                <option value="">选择模型</option>
                <option v-for="m in allVisibleModels" :key="m.id" :value="m.id">{{ m.name }}</option>
              </select>
            </div>
            <div>
              <label class="text-slate-400 block mb-1">画幅</label>
              <select v-model="row.ratio" class="w-full bg-studio-950 text-white border border-studio-700 rounded-lg px-2 py-1.5 outline-none">
                <option value="">跟随全局</option>
                <option v-for="r in RATIO_OPTIONS" :key="r" :value="r">{{ r }}</option>
              </select>
            </div>
            <div>
              <label class="text-slate-400 block mb-1">尺寸档位</label>
              <input v-model="row.size" placeholder="跟随全局" class="w-full bg-studio-950 text-white border border-studio-700 rounded-lg px-2 py-1.5 outline-none" />
            </div>
            <div>
              <label class="text-slate-400 block mb-1">时长/清晰度</label>
              <input v-model="row.duration" placeholder="跟随全局" class="w-full bg-studio-950 text-white border border-studio-700 rounded-lg px-2 py-1.5 outline-none" />
            </div>
            <button
              type="button"
              class="px-2 py-1.5 rounded-lg text-xs border cursor-pointer bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20"
              @click="removePerModelRow(i)"
            >
              删除
            </button>
          </div>
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
            <span class="text-slate-400 text-xs block mb-1">NAS 存储挂载点</span>
            <span class="text-white font-semibold break-all">{{ runtimeForm.nas_dir || '未配置' }}</span>
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
  fetchStudioCatalog,
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

// ===== HTTPS 局域网证书与设备安全信任状态 =====
const isHttps = ref(typeof window !== 'undefined' ? window.location.protocol === 'https:' : false);
const caDownloadUrl = ref(typeof window !== 'undefined' ? `${window.location.origin}/mls-ca.crt` : '/mls-ca.crt');
const httpFallbackUrl = computed(() => {
  if (typeof window === 'undefined') return '';
  return `http://${window.location.hostname}:30002/?keep-http=1`;
});
// 服务端控制台（旧管理台）由 30001 根路径托管，与工作台 30002 同机不同端口
const serverAdminUrl = computed(() => {
  if (typeof window === 'undefined') return 'http://localhost:30001/';
  return `http://${window.location.hostname}:30001/`;
});
const selectedOsGuide = ref('windows');
const copiedCaUrl = ref(false);

async function copyCaLink() {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(caDownloadUrl.value);
    } else {
      const input = document.createElement('input');
      input.value = caDownloadUrl.value;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    copiedCaUrl.value = true;
    setTimeout(() => { copiedCaUrl.value = false; }, 2500);
  } catch (e) {
    alert('复制失败，请手动复制: ' + caDownloadUrl.value);
  }
}

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
// ===== 工作室全局默认值状态 =====
const studioDefaultsForm = reactive({
  models: {
    image: 'gemini_3_1_flash_image',
    video: 'seedance2_0',
    chat: 'gemini_4_argon',
  },
  params: {
    ratio: '9:16',
    video_resolution: '720px2（超分）',
    image_size: '2K',
    video_duration: 5,
  },
  // 第 2 层：按模型单独配的默认参数（会话快照 > perModel > 全局默认）
  perModel: {}
});
const studioDefaultsSaving = ref(false);
const studioDefaultsSavedMsg = ref('');

const RATIO_OPTIONS = ['9:16', '16:9', '3:4', '4:3', '1:1', '3:2', '2:3', '21:9'];
const catalogModels = ref({ chat: [], image: [], video: [], music: [] });
const perModelRows = ref([]);

function modelOptionList(domain, fallback) {
  const list = catalogModels.value[domain] || [];
  if (!list.length) return fallback;
  return list
    .map((m) => ({ value: m.id || m.dbId || m.catalogId, label: m.name || m.label || m.id }))
    .filter((o) => o.value);
}
const imageModelOptions = computed(() => modelOptionList('image', [
  { value: 'gemini_3_1_flash_image', label: 'Gemini 3.1 Flash Image' },
  { value: 'seedream5flash', label: 'Seedream 5.0 Flash' },
  { value: 'seedream5pro', label: 'Seedream 5.0 Pro' },
  { value: 'gpt_image_2_5_sunburst_vip', label: 'GPT Image 2.5 Sunburst VIP' }
]));
const videoModelOptions = computed(() => modelOptionList('video', [
  { value: 'seedance2_0', label: 'Seedance 2.0' },
  { value: 'seedance2_5', label: 'Seedance 2.5' }
]));
const allVisibleModels = computed(() => {
  const seen = new Set();
  const out = [];
  for (const list of Object.values(catalogModels.value)) {
    for (const m of list || []) {
      const id = m.id || m.dbId || m.catalogId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: m.name || m.label || id });
    }
  }
  return out;
});

async function loadStudioCatalogForSettings() {
  try {
    const c = await fetchStudioCatalog();
    catalogModels.value = {
      chat: c?.studio?.chat?.models || [],
      image: c?.studio?.image?.models || [],
      video: c?.studio?.video?.models || [],
      music: c?.studio?.music?.models || []
    };
  } catch (_) {
    // 目录挂了时上方 computed 会回退到内置列表，不阻塞设置页
  }
}

function syncPerModelRows() {
  const pm = studioDefaultsForm.perModel || {};
  perModelRows.value = Object.entries(pm).map(([modelKey, v]) => ({
    modelKey,
    ratio: v?.ratio || '',
    size: v?.size || '',
    duration: v?.duration || '',
    quality: v?.quality || ''
  }));
}
function addPerModelRow() {
  perModelRows.value.push({ modelKey: '', ratio: '', size: '', duration: '', quality: '' });
}
function removePerModelRow(i) {
  perModelRows.value.splice(i, 1);
}
function collectPerModel() {
  const out = {};
  for (const row of perModelRows.value) {
    if (!row.modelKey) continue;
    const v = {};
    for (const k of ['ratio', 'size', 'duration', 'quality']) {
      if (row[k] !== '' && row[k] != null) v[k] = row[k];
    }
    out[row.modelKey] = v;
  }
  return out;
}

async function loadStudioDefaultsForm() {
  try {
    const res = await fetch('/api/studio/defaults');
    if (res.ok) {
      const data = await res.json();
      if (data?.data) {
        if (data.data.models) Object.assign(studioDefaultsForm.models, data.data.models);
        if (data.data.params) Object.assign(studioDefaultsForm.params, data.data.params);
        studioDefaultsForm.perModel = data.data.perModel || {};
        syncPerModelRows();
      }
    }
  } catch (_) {}
}

async function saveStudioDefaultsForm() {
  studioDefaultsSaving.value = true;
  studioDefaultsSavedMsg.value = '';
  try {
    const res = await fetch('/api/studio/defaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: studioDefaultsForm.models,
        params: studioDefaultsForm.params,
        perModel: collectPerModel()
      })
    });
    const json = await res.json();
    if (json.success) {
      studioDefaultsSavedMsg.value = '✓ 默认参数已成功保存并立即生效';
      try { window.dispatchEvent(new CustomEvent('studio_defaults_changed', { detail: json.data })); } catch (_) {}
      setTimeout(() => { studioDefaultsSavedMsg.value = ''; }, 3000);
    } else {
      alert(json.error || '保存失败');
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  } finally {
    studioDefaultsSaving.value = false;
  }
}

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
  loadStudioDefaultsForm();
  loadStudioCatalogForSettings();

  stopSlotPrefsWatch = onDerivativeSlotPrefsChange((next) => {
    slotPrefs.value = next;
  });
});

onUnmounted(() => {
  if (stopWatch) stopWatch();

  if (stopSlotPrefsWatch) stopSlotPrefsWatch();
});
</script>
