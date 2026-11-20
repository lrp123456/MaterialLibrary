<template>
  <div v-if="visible" class="outpaint-overlay fixed inset-0 z-50 bg-studio-950/80 backdrop-blur-md flex flex-col items-center justify-center p-6">
    <div class="max-w-4xl w-full bg-studio-900 border border-studio-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
      <div class="px-5 py-3 border-b border-studio-800 flex items-center justify-between">
        <h3 class="text-sm font-bold text-white font-mono flex items-center gap-2">
          <StudioIcon name="maximize" :size="16" class="text-studio-accent" />
          <span>智能空间几何扩图 (Outpaint)</span>
        </h3>
        <button type="button" class="text-slate-400 hover:text-white" @click="$emit('close')">&times;</button>
      </div>

      <div class="flex-1 flex items-center justify-center p-4 bg-studio-950 overflow-hidden relative">
        <div class="relative border border-dashed border-studio-cyan/50 p-2 rounded-lg">
          <img v-if="sourceImage" :src="sourceImage" class="max-h-96 object-contain" />
          <div class="absolute inset-0 border-2 border-studio-accent pointer-events-none"></div>
        </div>
      </div>

      <div class="p-4 border-t border-studio-800 bg-studio-900 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-xs text-slate-400 font-mono">画幅比例:</span>
          <div class="flex gap-1.5">
            <button
              v-for="r in ['16:9', '9:16', '1:1', '4:3']"
              :key="r"
              type="button"
              class="px-2.5 py-1 rounded text-xs font-mono border"
              :class="ratio === r ? 'bg-studio-accent text-white border-studio-accent' : 'bg-studio-800 text-slate-300 border-studio-700'"
              @click="ratio = r"
            >
              {{ r }}
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button type="button" class="px-4 py-2 rounded-xl bg-studio-800 text-slate-300 text-xs font-bold" @click="$emit('close')">
            取消
          </button>
          <button type="button" class="px-4 py-2 rounded-xl bg-studio-accent text-white text-xs font-bold" @click="$emit('apply', { ratio })">
            确认扩图
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  visible: { type: Boolean, default: false },
  sourceImage: { type: String, default: '' },
});

defineEmits(['close', 'apply']);

const ratio = ref('16:9');
</script>
