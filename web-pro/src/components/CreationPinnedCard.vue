<template>
  <div
    class="relative rounded-xl bg-studio-850 border p-2 transition-all shadow-md hover:shadow-xl cursor-pointer group flex flex-col justify-between"
    :class="tpl?.is_pinned ? 'border-amber-400/80 ring-1 ring-amber-400/30 shadow-[0_0_18px_-6px_rgba(251,191,36,0.55)]' : 'border-studio-750 hover:border-studio-accent/70'"
    draggable="true"
    @click="$emit('open', tpl)"
    @dragstart="$emit('dragstart', $event, tpl)"
    @dragend="$emit('dragend', $event)"
  >
    <div class="relative w-full rounded-lg overflow-hidden bg-black/40 mb-2 border border-studio-800" :style="{ aspectRatio: String(ratio || 1) }">
      <template v-if="!tpl.type || tpl.type === 'image'">
        <img v-if="imageUrl" :src="imageUrl" class="w-full h-full object-cover" />
        <div v-else class="w-full h-full flex items-center justify-center text-xs text-slate-600">无预览</div>
      </template>
      <template v-else-if="tpl.type === 'video'">
        <TemplateVideoCover
          class="w-full h-full"
          :poster-url="posterUrl"
          :video-url="videoUrl"
          :reference-url="refUrl"
        />
      </template>
      <div v-else class="w-full h-full flex flex-col items-center justify-center bg-emerald-950/30 text-emerald-300 gap-1">
        <StudioIcon name="music" :size="18" />
        <span class="text-[10px] font-mono">空间氛围原声</span>
      </div>

      <span class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold border bg-studio-950/90" :class="typeBadgeClass">
        {{ typeLabel }}
      </span>
      <button
        type="button"
        class="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center bg-amber-500 text-black transition-all cursor-pointer z-10"
        title="取消置顶收藏"
        @click.stop="$emit('pin', tpl)"
      >
        <StudioIcon name="star" :size="11" />
      </button>
      <span v-if="dragHint" class="absolute inset-x-1.5 bottom-1 px-1.5 py-0.5 rounded bg-amber-500/90 text-black text-[9px] font-bold pointer-events-none truncate">
        {{ dragHint }}
      </span>
    </div>

    <div class="space-y-0.5">
      <h4 class="text-[11px] font-bold text-slate-100 truncate group-hover:text-studio-accent" :title="tpl?.title">{{ tpl?.title }}</h4>
      <p class="text-[10px] text-slate-400 line-clamp-1 leading-relaxed">{{ tpl?.prompt }}</p>
    </div>

    <div class="pt-1.5 mt-1.5 border-t border-studio-800 flex items-center justify-between gap-1">
      <button
        type="button"
        class="px-1.5 py-0.5 rounded bg-studio-950 border border-studio-750 hover:border-studio-accent text-slate-300 hover:text-studio-cyan text-[10px] font-bold cursor-pointer shrink-0"
        title="把这张作品放到某个区"
        @click.stop="menuOpen = !menuOpen"
      >
        放到
      </button>
      <span class="text-[9px] text-slate-500 font-mono truncate">{{ placeLabel }}</span>
    </div>

    <div v-if="menuOpen" class="absolute right-1 bottom-8 z-20 w-32 rounded-lg bg-studio-900 border border-studio-700 shadow-2xl p-1 space-y-0.5" @click.stop>
      <button
        type="button"
        class="w-full text-left px-2 py-1 rounded text-[10px] text-slate-300 hover:bg-studio-800 hover:text-white cursor-pointer"
        @click.stop="choose(null)"
      >
        {{ tpl?.section_id ? '未分区' : '未分区（当前）' }}
      </button>
      <button
        v-for="sec in (sections || [])"
        :key="sec.id"
        type="button"
        class="w-full text-left px-2 py-1 rounded text-[10px] text-slate-300 hover:bg-studio-800 hover:text-white cursor-pointer"
        @click.stop="choose(sec.id)"
      >
        {{ sec.name }}{{ tpl?.section_id === sec.id ? '（当前）' : '' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import StudioIcon from './StudioIcon.vue';
import TemplateVideoCover from '../views/studio/TemplateVideoCover.vue';
import { getToken } from '../api';

const props = defineProps({
  tpl: { type: Object, default: () => ({}) },
  ratio: { type: Number, default: 1 },
  sections: { type: Array, default: () => [] },
  dragHint: { type: String, default: '' },
});
const emit = defineEmits(['open', 'pin', 'place', 'dragstart', 'dragend']);

const menuOpen = ref(false);

function authedMedia(raw) {
  const url = String(raw || '');
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const isApi = url.startsWith('/api/') || /^https?:\/\/[^/]+\/api\//i.test(url);
  if (!isApi || /[?&]token=/.test(url)) return url;
  const token = getToken();
  return token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url;
}

const imageUrl = computed(() => authedMedia(props.tpl?.result_images?.[0]?.url || ''));
const videoUrl = computed(() => authedMedia(props.tpl?.result_images?.[0]?.url || ''));
const posterUrl = computed(() => {
  const r0 = props.tpl?.result_images?.[0];
  return authedMedia(r0?.poster || r0?.poster_url || props.tpl?.poster_url || '');
});
const refUrl = computed(() => authedMedia(props.tpl?.origin_images?.[0]?.url || ''));

const typeLabel = computed(() => {
  const t = props.tpl?.type || 'image';
  if (t === 'video') return '🎬';
  if (t === 'audio') return '🎵';
  return '🖼️';
});
const typeBadgeClass = computed(() => {
  const t = props.tpl?.type || 'image';
  if (t === 'video') return 'text-purple-200 border-purple-700/60';
  if (t === 'audio') return 'text-emerald-200 border-emerald-700/60';
  return 'text-studio-cyan border-studio-800';
});
const placeLabel = computed(() => {
  const sid = props.tpl?.section_id;
  if (!sid) return '未分区';
  const sec = (props.sections || []).find((s) => s.id === sid);
  return sec ? sec.name : '未分区';
});

function choose(sectionId) {
  menuOpen.value = false;
  emit('place', props.tpl, sectionId);
}
</script>
