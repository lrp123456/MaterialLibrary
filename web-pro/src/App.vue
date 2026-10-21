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
      @login-success="handleLoginSuccess"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import TopNav from './components/TopNav.vue';
import LoginModal from './components/LoginModal.vue';
import LibraryView from './views/LibraryView.vue';
import StudioView from './views/StudioView.vue';
import MediaHubView from './views/MediaHubView.vue';
import SettingsView from './views/SettingsView.vue';
import { getCurrentUser, isLoggedIn } from './api.js';

const activeTab = ref('library'); // 默认展示素材库板块 (DAM)
const studioPayload = ref(null);
const clipPayload = ref(null);
const mediaSub = ref('opencut');

// 登录态
const loginVisible = ref(false);
const currentUser = ref(getCurrentUser());
const sessionTick = ref(0); // 登录/登出后自增，强制子视图重建并重新拉数据

function openLogin() {
  loginVisible.value = true;
}

function handleLoginSuccess(user) {
  currentUser.value = user;
  sessionTick.value += 1;
}

function handleLogout() {
  currentUser.value = null;
  sessionTick.value += 1;
  activeTab.value = 'library';
  openLogin();
}

function onAuthRequired() {
  if (!isLoggedIn()) openLogin();
}

function onTabChange(tab) {
  activeTab.value = tab;
}

// 跨板块联动：素材库一键送入 AI 对话
function handleSendToChat(item) {
  studioPayload.value = { target: 'chat', item };
  activeTab.value = 'studio';
}

// 跨板块联动：素材库一键送入精准编辑
function handleSendToEdit(item) {
  studioPayload.value = { target: 'quick', item };
  activeTab.value = 'studio';
}

// 跨板块联动：素材库一键送入多轨剪辑时间轴
function handleSendToClip(item) {
  clipPayload.value = item;
  mediaSub.value = 'opencut';
  activeTab.value = 'media';
}

onMounted(() => {
  window.addEventListener('ml_auth_required', onAuthRequired);
  // 没有本地会话（典型：局域网/公网新电脑）直接弹登录，而不是等请求失败
  if (!isLoggedIn()) openLogin();
});

onUnmounted(() => {
  window.removeEventListener('ml_auth_required', onAuthRequired);
});
</script>
