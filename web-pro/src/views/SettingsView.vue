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
} from '../api.js';

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
  loadAdminSettings();
});

onUnmounted(() => {
  if (stopWatch) stopWatch();
});
</script>
