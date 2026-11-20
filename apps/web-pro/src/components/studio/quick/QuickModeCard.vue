<template>
  <div
    class="quick-mode-card group p-4 rounded-2xl bg-studio-900 border border-studio-800 hover:border-studio-accent transition-all cursor-pointer flex flex-col justify-between"
    @click="$emit('select', mode)"
  >
    <div class="space-y-2">
      <div class="w-10 h-10 rounded-xl bg-studio-800 flex items-center justify-center text-studio-accent group-hover:scale-110 transition-transform">
        <StudioIcon :name="mode.icon" :size="20" />
      </div>
      <div>
        <h4 class="text-sm font-bold text-white font-mono">{{ mode.title }}</h4>
        <p class="text-xs text-slate-400 mt-1 leading-relaxed">{{ mode.description }}</p>
      </div>
    </div>

    <div class="mt-4 pt-3 border-t border-studio-800/80 flex items-center justify-between text-xs font-mono text-studio-cyan">
      <span>{{ mode.presetModel }}</span>
      <span class="group-hover:translate-x-1 transition-transform">&rarr;</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  mode: {
    type: Object,
    required: true,
  },
});

defineEmits(['select']);
</script>
