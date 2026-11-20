<template>
  <div class="media-tool-tab p-6 space-y-4 font-sans">
    <div class="flex items-center justify-between pb-3 border-b border-studio-800">
      <h4 class="text-sm font-bold text-white font-mono flex items-center gap-2">
        <StudioIcon name="video" :size="16" class="text-studio-accent" />
        <span>音视频格式快速转换与压缩</span>
      </h4>
    </div>

    <div class="space-y-4 max-w-xl">
      <div>
        <label class="text-xs text-slate-400 block mb-1 font-mono">选择转换目标格式</label>
        <select
          v-model="targetFormat"
          class="w-full bg-studio-950 border border-studio-700 rounded-xl p-2.5 text-xs text-white outline-none"
        >
          <option value="mp4">MP4 (H.264 / AAC 通用视频)</option>
          <option value="webm">WebM (VP9 网页轻量视频)</option>
          <option value="mp3">MP3 (标准音频)</option>
          <option value="wav">WAV (无损 PCM 音频)</option>
        </select>
      </div>

      <div class="flex justify-end">
        <button
          type="button"
          class="px-5 py-2 rounded-xl bg-studio-accent text-white text-xs font-bold hover:brightness-110 active:scale-95 transition-all shadow cursor-pointer"
          @click="$emit('start', { format: targetFormat })"
        >
          开始转换
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const targetFormat = ref('mp4');
defineEmits(['start']);
</script>
