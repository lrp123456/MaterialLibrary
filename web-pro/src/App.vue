<template>
  <div class="app-shell h-screen w-screen flex flex-col bg-studio-950 text-slate-100 overflow-hidden font-sans">
    <!-- 顶置全局导航栏 (四大核心板块) -->
    <TopNav
      :activeTab="activeTab"
      @update:activeTab="onTabChange"
      @logout="handleLogout"
    />

    <!-- 核心四大板块工作区 (完全解耦独立的专业视口架构) -->
    <main class="flex-1 flex overflow-hidden">
      <!-- key 随会话/视图变化：登录成功后强制重建子视图，重跑首屏数据加载 -->
      <!-- 1. 素材库板块 (DAM) -->
      <LibraryView
        v-if="activeTab === 'library'"
        :key="'library-' + sessionTick"
        @sendToChat="handleSendToChat"
        @sendToEdit="handleSendToEdit"
        @sendToClip="handleSendToClip"
      />

      <!-- 2. AI 创作板块 (对话生成 + 6大精准模式编辑) -->
      <StudioView
        v-else-if="activeTab === 'studio'"
        :key="'studio-' + sessionTick"
        :initialPayload="studioPayload"
        @sendToClip="handleSendToClip"
      />

      <!-- 3. 媒体剪辑与工具板块 (多轨剪辑 + FFmpeg工具箱) -->
      <MediaHubView
        v-else-if="activeTab === 'media'"
        :key="'media-' + sessionTick"
        :initialSub="mediaSub"
        :clipPayload="clipPayload"
      />

      <!-- 4. 系统设置板块 (Settings) -->
      <SettingsView v-else-if="activeTab === 'settings'" :key="'settings-' + sessionTick" />
    </main>

    <!-- 全局登录弹窗（局域网/公网新设备必须先登录，不再静默空白） -->
    <LoginModal
      v-model:visible="loginVisible"
      :reason="loginReason"
      @login-success="handleLoginSuccess"
    />

    <!-- 全局语音输入：右侧悬浮麦克风，结果写回最后聚焦的输入框（登录后才挂载） -->
    <VoiceInputButton v-if="currentUser" />

    <!-- 旧页签跑的是上一版构建：不提示的话，每次改完都是「还是没变化」 -->
    <div v-if="updateAvailable" class="fixed bottom-5 left-5 z-[9999] flex items-center gap-2 rounded-xl border border-studio-cyan/40 bg-studio-900/95 px-4 py-3 text-xs shadow-2xl backdrop-blur">
      <span class="text-slate-200">工作台已发布新版本。</span>
      <button type="button" class="font-bold text-studio-cyan underline cursor-pointer" @click="reloadForUpdate">刷新加载</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import TopNav from './components/TopNav.vue';
import LoginModal from './components/LoginModal.vue';
import VoiceInputButton from './components/VoiceInputButton.vue';
import LibraryView from './views/LibraryView.vue';
import StudioView from './views/StudioView.vue';
import MediaHubView from './views/MediaHubView.vue';
import SettingsView from './views/SettingsView.vue';
import { getCurrentUser, verifySession } from './api.js';

const activeTab = ref('library'); // 默认展示素材库板块 (DAM)
const studioPayload = ref(null);
const clipPayload = ref(null);
const mediaSub = ref('opencut');

// 登录态
const loginVisible = ref(false);
const currentUser = ref(getCurrentUser());
const sessionTick = ref(0); // 登录/登出后自增，强制子视图重建并重新拉数据
const loginReason = ref('');

function openLogin(reason = '') {
  // 只补原因、不抹原因：先后的两次触发里，具体那条（登录已过期）才是用户要看到的
  if (reason) loginReason.value = reason;
  loginVisible.value = true;
}

function handleLoginSuccess(user) {
  currentUser.value = user;
  loginReason.value = '';
  sessionTick.value += 1;
}

function handleLogout() {
  currentUser.value = null;
  sessionTick.value += 1;
  activeTab.value = 'library';
  openLogin();
}

// 这个事件只在服务端判定「未授权」时发出，不能再拿 isLoggedIn() 挡：
// localStorage 里那份已被撤销的 token 字符串照样让它为真，于是死会话永远弹不出登录框，
// 用户看到的只是一屏破图（本次「看不到图片」的真正落点）。
function onAuthRequired(e) {
  currentUser.value = getCurrentUser();
  openLogin(e && e.detail === 'expired' ? '登录已过期，请重新登录' : '');
}

// 进页面 / 切回页签各验一次会话：破图之前先要登录，而不是让人猜为什么什么都加载不出来
async function guardSession() {
  const alive = await verifySession();
  currentUser.value = getCurrentUser();
  return alive;
}

// ===== 新版本探测 =====
// 30002 的 index.html 是 no-store，刷新即拿到新包；问题是没人知道自己该刷新——
// 于是每次改完都有人回报「还是没变化」。这里比对磁盘上 index.html 引用的入口指纹，变了就提示。
const updateAvailable = ref(false);
let loadedEntry = '';
let updateTimer = 0;

function entryHash(s) {
  return (/index-[A-Za-z0-9_-]+\.js/.exec(String(s || '')) || [''])[0];
}

async function checkForUpdate() {
  if (!loadedEntry) return;
  try {
    const res = await fetch('/index.html', { cache: 'no-store' });
    if (!res.ok) return;
    // 直接在整页 HTML 里找入口指纹：index.html 还引了 CDN 脚本，按 <script> 标签取会取错
    const live = entryHash(await res.text());
    if (live && live !== loadedEntry) updateAvailable.value = true;
  } catch {
    // 断线/网关抖动时不打扰
  }
}

function reloadForUpdate() {
  location.reload();
}

function onTabChange(tab) {
  activeTab.value = tab;
}

// 跨板块联动：素材库送入 AI 对话（支持多选批量：payload.items 为数组）
function handleSendToChat(payload) {
  const items = payload && Array.isArray(payload.items) ? payload.items : [payload];
  studioPayload.value = { target: 'chat', items };
  activeTab.value = 'studio';
}

// 跨板块联动：素材库一键送入精准编辑
function handleSendToEdit(item) {
  studioPayload.value = { target: 'quick', item };
  activeTab.value = 'studio';
}

// 跨板块联动：素材库送入多轨剪辑时间轴（支持多选批量）
function handleSendToClip(payload) {
  const items = payload && Array.isArray(payload.items) ? payload.items : [payload];
  clipPayload.value = { assets: items.filter(Boolean) };
  mediaSub.value = 'opencut';
  activeTab.value = 'media';
}

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  checkForUpdate();
  guardSession();
}

// 监听必须建在 setup 阶段：子视图挂载早于 App 的 onMounted，
// 它们首屏请求就会把死会话打成 401 —— 晚注册等于丢掉原因，只剩一个没有说明的登录框。
window.addEventListener('ml_auth_required', onAuthRequired);

onMounted(() => {
  loadedEntry = entryHash(Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')).join(' '));
  document.addEventListener('visibilitychange', onVisibilityChange);
  updateTimer = setInterval(checkForUpdate, 5 * 60 * 1000);
  // 本地有没有 token 字符串不作数：新设备没 token 要登录，有 token 也得让服务端认账。
  // 两条都走 guardSession，区别只在登录框上那行原因。
  guardSession();
});

onUnmounted(() => {
  window.removeEventListener('ml_auth_required', onAuthRequired);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (updateTimer) clearInterval(updateTimer);
});
</script>
