<template>
  <div class="h-screen w-screen flex flex-col bg-studio-950 text-slate-100 overflow-hidden font-sans">
    <!-- 顶置全局导航栏 (四大核心板块) -->
    <TopNav :activeTab="activeTab" @update:activeTab="onTabChange" />

    <!-- 核心四大板块工作区 (完全解耦独立的专业视口架构) -->
    <main class="flex-1 flex overflow-hidden">
      <!-- 1. 素材库板块 (DAM) -->
      <LibraryView
        v-if="activeTab === 'library'"
        @sendToChat="handleSendToChat"
        @sendToEdit="handleSendToEdit"
        @sendToClip="handleSendToClip"
      />

      <!-- 2. AI 创作板块 (对话生成 + 6大精准模式编辑) -->
      <StudioView
        v-else-if="activeTab === 'studio'"
        :initialPayload="studioPayload"
        @sendToClip="handleSendToClip"
      />

      <!-- 3. 媒体剪辑与工具板块 (多轨剪辑 + FFmpeg工具箱) -->
      <MediaHubView
        v-else-if="activeTab === 'media'"
        :initialSub="mediaSub"
      />

      <!-- 4. 系统设置板块 (Settings) -->
      <SettingsView v-else-if="activeTab === 'settings'" />
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import TopNav from './components/TopNav.vue';
import LibraryView from './views/LibraryView.vue';
import StudioView from './views/StudioView.vue';
import MediaHubView from './views/MediaHubView.vue';
import SettingsView from './views/SettingsView.vue';

const activeTab = ref('library'); // 默认展示素材库板块 (DAM)
const studioPayload = ref(null);
const mediaSub = ref('clip');

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
  mediaSub.value = 'clip';
  activeTab.value = 'media';
}
</script>
