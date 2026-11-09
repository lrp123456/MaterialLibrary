<template>
  <div class="app-shell h-screen w-screen flex flex-col bg-studio-950 text-slate-100 overflow-hidden font-sans">
    <!-- 顶置全局导航栏 (四大核心板块) -->
    <TopNav
      :activeTab="activeTab"
      :libraryLane="libraryLane"
      :username="currentUser?.username || ''"
      @update:activeTab="onTabChange"
      @update:libraryLane="libraryLane = $event"
      @logout="handleLogout"
      @back="handleGlobalBack"
    />

    <!-- 核心四大板块工作区 (完全解耦独立的专业视口架构) -->
    <main class="flex-1 flex overflow-hidden">
      <!-- key 随会话/视图变化：登录成功后强制重建子视图，重跑首屏数据加载 -->
      <!-- 1. 素材库板块 (DAM) -->
      <LibraryView
        v-if="activeTab === 'library'"
        :key="'library-' + sessionTick + '-' + libraryLane"
        :libraryLane="libraryLane"
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
        @payload-consumed="studioPayload = null"
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




    <!-- 旧页签跑的是上一版构建：不提示的话，每次改完都是「还是没变化」 -->
    <div v-if="updateAvailable" class="fixed bottom-6 left-6 z-[9999] flex items-center gap-3 rounded-2xl border border-studio-cyan/60 bg-studio-900/98 px-5 py-3.5 text-xs shadow-2xl backdrop-blur-lg animate-pulse">
      <div class="w-2 h-2 rounded-full bg-studio-cyan"></div>
      <span class="text-slate-100 font-medium">工作台已发布新版本。</span>
      <button type="button" class="px-3 py-1 rounded-lg bg-studio-cyan text-studio-950 font-bold hover:brightness-110 cursor-pointer shadow transition-all" @click="reloadForUpdate">立即刷新加载</button>
    </div>

    <div v-if="crashError" class="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-studio-950/90 backdrop-blur-md p-6 text-center">
      <div class="max-w-lg w-full p-6 rounded-2xl bg-studio-900 border border-red-500/30 shadow-2xl text-left">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 text-xl font-bold shrink-0">!</div>
          <div>
            <h3 class="text-base font-bold text-slate-100">
              {{ isChunkLoadError ? '视图加载遇到版本缓存冲突' : '工作台遇到运行时异常' }}
            </h3>
            <p class="text-xs text-slate-400">
              {{ isChunkLoadError ? '检测到静态资源版本更新，请刷新加载最新构建' : '组件渲染或数据处理时捕获到未处理异常' }}
            </p>
          </div>
        </div>

        <div class="p-3 mb-4 rounded-xl bg-studio-950 border border-studio-800 font-mono text-xs text-red-300 max-h-36 overflow-y-auto break-all select-all">
          {{ crashError }}
        </div>

        <p class="text-xs text-slate-300 mb-6">
          <template v-if="isChunkLoadError">
            服务后台已构建并发布最新修复版本，请点击下方按钮强制刷新以加载最新工作台。
          </template>
          <template v-else>
            您可以尝试重置工作台会话、复制错误详情排查，或先返回素材库继续工作，避免页面死锁。
          </template>
        </p>

        <!-- Chunk 加载异常：只提供刷新更新 -->
        <div v-if="isChunkLoadError" class="flex items-center justify-end gap-3">
          <button
            type="button"
            class="px-5 py-2.5 rounded-xl bg-studio-cyan text-studio-950 font-bold hover:brightness-110 active:scale-95 transition-all text-sm cursor-pointer shadow-lg shadow-studio-cyan/20"
            @click="reloadForUpdate"
          >
            立即刷新加载新版本
          </button>
        </div>

        <!-- 运行时异常：提供 重置会话、复制错误、返回素材库、重新加载 -->
        <div v-else class="flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            class="px-4 py-2 rounded-xl bg-studio-800 text-slate-300 border border-studio-700 hover:text-white hover:bg-studio-750 transition-all text-xs cursor-pointer"
            @click="copyCrashError"
          >
            {{ copySuccess ? '✓ 已复制到剪贴板' : '复制错误信息' }}
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-xl bg-studio-800 text-slate-300 border border-studio-700 hover:text-white hover:bg-studio-750 transition-all text-xs cursor-pointer"
            @click="backToLibrary"
          >
            返回素材库
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-xl bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 transition-all text-xs cursor-pointer font-medium"
            @click="resetStudioSession"
          >
            重置工作台会话
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-xl bg-studio-cyan text-studio-950 font-bold hover:brightness-110 active:scale-95 transition-all text-xs cursor-pointer shadow-lg shadow-studio-cyan/20"
            @click="reloadForUpdate"
          >
            刷新页面
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, h, onMounted, onUnmounted, onErrorCaptured, defineAsyncComponent, watch } from 'vue';
import TopNav from './components/TopNav.vue';
import LoginModal from './components/LoginModal.vue';
import { getCurrentUser, logout, verifySession } from './api.js';
import { closeTop, hasOverlays } from './service/overlay-stack.js';

// 路由级（板块级）懒加载：四大视图各自独立 chunk，首屏只载素材库所需代码。
// 异步块加载失败会被 onErrorCaptured / 全局 error 捕获并引导刷新，见下方崩溃屏障。
function viewLoading(level) {
  return {
    render() {
      return h('div', {
        class: 'flex-1 flex items-center justify-center text-xs text-slate-500 font-mono tracking-widest'
      }, level === 1 ? 'LOADING WORKSPACE…' : 'LOADING…');
    }
  };
}
const LibraryView = defineAsyncComponent({ loader: () => import('./views/LibraryView.vue'), loadingComponent: viewLoading(1), delay: 120 });
const StudioView = defineAsyncComponent({ loader: () => import('./views/StudioView.vue'), loadingComponent: viewLoading(1), delay: 120 });
const MediaHubView = defineAsyncComponent({ loader: () => import('./views/MediaHubView.vue'), loadingComponent: viewLoading(1), delay: 120 });
const SettingsView = defineAsyncComponent({ loader: () => import('./views/SettingsView.vue'), loadingComponent: viewLoading(1), delay: 120 });

const activeTab = ref('library'); // 默认展示素材库板块 (DAM)
const libraryLane = ref('image');
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
  // 先清本地草稿再 logout：logout 之后 getCurrentUser() 已经空了，带用户后缀的键就删不掉
  resetStudioSession();
  logout();
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
const crashError = ref(null);
const crashStack = ref('');
const copySuccess = ref(false);

const isChunkLoadError = computed(() => {
  const s = String(crashError.value || '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk/i.test(s);
});

async function copyCrashError() {
  const text = crashStack.value ? `${crashError.value}\n\nStack:\n${crashStack.value}` : String(crashError.value || '');
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    copySuccess.value = true;
    setTimeout(() => {
      copySuccess.value = false;
    }, 2000);
  } catch (e) {
    console.error('复制错误信息失败:', e);
  }
}

function resetStudioSession() {
  try {
    // 按前缀清：草稿/活动会话/参数快照现在都带用户后缀（旧代码只删了个不存在的键，等于没删）
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('ml_studio_')) localStorage.removeItem(key);
    }
    sessionStorage.clear();
  } catch {}
  studioPayload.value = null;
  crashError.value = null;
  crashStack.value = '';
  sessionTick.value += 1;
}

function backToLibrary() {
  crashError.value = null;
  crashStack.value = '';
  studioPayload.value = null;
  activeTab.value = 'library';
}

function handleGlobalChunkError(event) {
  const err = event?.error || event?.reason;
  const msg = err?.message || event?.message || String(err || '');
  if (/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk/i.test(msg)) {
    console.warn('[Global Chunk Error Captured]', msg);
    crashError.value = msg;
    crashStack.value = err?.stack ? String(err.stack) : '';
    checkForUpdate();
  }
}

onErrorCaptured((err, instance, info) => {
  console.error('[App Crash Captured]', err, info);
  crashError.value = err?.message || String(err);
  crashStack.value = (err?.stack ? String(err.stack) : '') + (info ? `\n\nComponent Hook / Info: ${info}` : '');
  checkForUpdate();
  return false;
});
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
  const u = new URL(window.location.href);
  u.searchParams.set('_v', Date.now());
  window.location.href = u.toString();
}

// ===== 统一返回入口 =====
// 这个 SPA 没有 router，板块切换只靠 activeTab。用一条轻量 tab 历史记录「上一页」，
// 浮层栈为空时才消费它；浮层非空一律先关最上层弹窗/抽屉。
const tabHistory = ref(['library']);
let suppressingHistory = false;
const MAX_TAB_HISTORY = 20;

watch(activeTab, (tab, prev) => {
  if (suppressingHistory || !tab || tab === prev) return;
  if (tabHistory.value[tabHistory.value.length - 1] === tab) return;
  tabHistory.value.push(tab);
  if (tabHistory.value.length > MAX_TAB_HISTORY) tabHistory.value.shift();
}, { flush: 'sync' });

function onTabChange(tab) {
  activeTab.value = tab;
}

function handleGlobalBack() {
  // 1. 只关最上层一个浮层；连续点击才逐层关闭。
  if (closeTop()) return;
  // 2. 栈空才回退板块，没有上一页则回素材库。
  if (tabHistory.value.length > 1) {
    tabHistory.value.pop();
    const target = tabHistory.value[tabHistory.value.length - 1] || 'library';
    suppressingHistory = true;
    activeTab.value = target;
    suppressingHistory = false;
  } else {
    activeTab.value = 'library';
  }
}

function onGlobalKeydown(e) {
  if (e.key !== 'Escape' || !hasOverlays()) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  closeTop();
}

// 浏览器返回键：SPA 自身不产生历史条目，压一条哨兵记录把后退拦在页面内。
function ensureBackSentinel() {
  try {
    if (!window.history.state || !window.history.state.mlsSentinel) {
      window.history.pushState({ mlsSentinel: true }, '');
    }
  } catch (_) {}
}

function onPopState() {
  handleGlobalBack();
  ensureBackSentinel();
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
  window.addEventListener('unhandledrejection', handleGlobalChunkError);
  window.addEventListener('error', handleGlobalChunkError);
  // 统一返回入口：ESC 走 capture，先于各组件自己的 keydown 监听执行。
  ensureBackSentinel();
  window.addEventListener('popstate', onPopState);
  window.addEventListener('keydown', onGlobalKeydown, true);
  updateTimer = setInterval(checkForUpdate, 5 * 60 * 1000);
  // 本地有没有 token 字符串不作数：新设备没 token 要登录，有 token 也得让服务端认账。
  // 两条都走 guardSession，区别只在登录框上那行原因。
  guardSession();
});

onUnmounted(() => {
  window.removeEventListener('ml_auth_required', onAuthRequired);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('unhandledrejection', handleGlobalChunkError);
  window.removeEventListener('error', handleGlobalChunkError);
  window.removeEventListener('popstate', onPopState);
  window.removeEventListener('keydown', onGlobalKeydown, true);
  if (updateTimer) clearInterval(updateTimer);
});
</script>
