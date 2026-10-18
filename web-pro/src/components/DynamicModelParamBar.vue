<template>
  <div class="flex w-full flex-col gap-2">
    <!-- 1. 模式胶囊切换栏 -->
    <div v-if="schema && Array.isArray(schema.modes) && schema.modes.length" class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="mode in schema.modes"
          :key="mode.id"
          type="button"
          class="choice"
          :class="{ 'is-on': activeMode === mode.id }"
          @click="$emit('select-mode', mode.id)"
        >
          <span class="choice-mark"></span>
          <span>{{ mode.label }}</span>
          <span v-if="activeMode === mode.id" class="choice-now">当前</span>
        </button>
      </div>

      <!-- 多模态参考槽位容量指示器 -->
      <div v-if="schema.slots" class="flex items-center gap-2 text-[11px] font-mono text-slate-400">
        <span v-if="schema.slots.images > 0" class="px-2 py-0.5 rounded bg-studio-950 border border-studio-800">
          🖼️ 图槽 {{ refCounts.images || 0 }}/{{ effectiveImageSlotCap }}
        </span>
        <span v-if="schema.slots.videos > 0 && !schema.free?.noVideoRef" class="px-2 py-0.5 rounded bg-studio-950 border border-studio-800 text-studio-indigo">
          🎬 视频槽 {{ refCounts.videos || 0 }}/{{ schema.slots.videos }}
        </span>
        <span v-if="schema.slots.audios > 0" class="px-2 py-0.5 rounded bg-studio-950 border border-studio-800 text-emerald-400">
          🎵 音频槽 {{ refCounts.audios || 0 }}/{{ schema.slots.audios }}
        </span>
      </div>
    </div>

    <!-- 2. 常用参数 (Common Tier) + 高级参数折叠开关 -->
    <div v-if="effectiveCommonFields.length || effectiveAdvancedFields.length" class="flex flex-wrap items-end gap-2.5">
      <label
        v-for="field in effectiveCommonFields"
        :key="'c-' + field.key"
        class="flex flex-col gap-1 text-xs relative"
        :title="lockReasons[field.key] || ''"
      >
        <span class="text-slate-400 font-bold flex items-center gap-1">
          <span>{{ field.label }}</span>
          <span
            v-if="isLocked(field.key)"
            class="text-[10px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-normal"
          >
            已联动锁定
          </span>
        </span>

        <select
          v-if="field.type === 'enum'"
          class="bg-studio-950 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none disabled:opacity-50"
          :disabled="isLocked(field.key)"
          :value="modelValue[field.key]"
          @change="onParamChange(field.key, $event.target.value)"
        >
          <option v-for="opt in fieldOptions(field)" :key="String(opt)" :value="opt">
            {{ optionLabel(field, opt) }}
          </option>
        </select>

        <label
          v-else-if="field.type === 'bool'"
          class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-studio-950 border border-studio-700 cursor-pointer select-none"
        >
          <input
            type="checkbox"
            class="rounded accent-studio-accent"
            :disabled="isLocked(field.key)"
            :checked="!!modelValue[field.key]"
            @change="onParamChange(field.key, $event.target.checked)"
          />
          <span class="text-slate-200">{{ modelValue[field.key] ? '已开启' : '关闭' }}</span>
        </label>

        <div v-else-if="field.type === 'range' || field.type === 'number'" class="flex items-center gap-1">
          <button
            v-if="Array.isArray(field.extraStops) && field.extraStops.includes(-1)"
            type="button"
            class="px-2 py-1 rounded-lg border text-xs font-bold cursor-pointer"
            :class="Number(modelValue[field.key]) === -1 ? 'bg-studio-accent text-white border-studio-accent' : 'bg-studio-950 text-slate-400 border-studio-700'"
            :disabled="isLocked(field.key)"
            @click="onParamChange(field.key, Number(modelValue[field.key]) === -1 ? (field.min || 5) : -1)"
          >
            智能(-1)
          </button>
          <input
            type="number"
            class="w-24 bg-studio-950 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none disabled:opacity-50"
            :min="field.min"
            :max="field.max"
            :step="field.step || 1"
            :disabled="isLocked(field.key)"
            :value="modelValue[field.key]"
            @change="onParamChange(field.key, Number($event.target.value))"
          />
        </div>

        <input
          v-else
          type="text"
          class="bg-studio-950 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none disabled:opacity-50"
          :disabled="isLocked(field.key)"
          :value="modelValue[field.key] || ''"
          @change="onParamChange(field.key, $event.target.value)"
        />
      </label>

      <!-- 高级参数抽屉开关 -->
      <button
        v-if="effectiveAdvancedFields.length"
        type="button"
        class="choice"
        :class="{ 'is-on': showAdvanced }"
        @click="$emit('update:showAdvanced', !showAdvanced)"
      >
        <span class="choice-mark"></span>
        <span>⚙️ 高级配置 ({{ effectiveAdvancedFields.length }})</span>
        <span v-if="showAdvanced" class="choice-now">展开</span>
      </button>
    </div>

    <!-- 3. 高级参数展开抽屉 (Advanced Tier) -->
    <div
      v-if="showAdvanced && effectiveAdvancedFields.length"
      class="flex flex-wrap items-end gap-2.5 p-2.5 rounded-xl bg-studio-950/70 border border-studio-800"
    >
      <label
        v-for="field in effectiveAdvancedFields"
        :key="'a-' + field.key"
        class="flex flex-col gap-1 text-xs"
        :title="lockReasons[field.key] || ''"
      >
        <span class="text-slate-400 font-bold flex items-center gap-1">
          <span>{{ field.label }}</span>
          <span
            v-if="isLocked(field.key)"
            class="text-[10px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-normal"
          >
            已联动锁定
          </span>
        </span>

        <select
          v-if="field.type === 'enum'"
          class="bg-studio-900 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none disabled:opacity-50"
          :disabled="isLocked(field.key)"
          :value="modelValue[field.key]"
          @change="onParamChange(field.key, $event.target.value)"
        >
          <option v-for="opt in fieldOptions(field)" :key="String(opt)" :value="opt">
            {{ optionLabel(field, opt) }}
          </option>
        </select>

        <label
          v-else-if="field.type === 'bool'"
          class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-studio-900 border border-studio-700 cursor-pointer select-none"
        >
          <input
            type="checkbox"
            class="rounded accent-studio-accent"
            :disabled="isLocked(field.key)"
            :checked="!!modelValue[field.key]"
            @change="onParamChange(field.key, $event.target.checked)"
          />
          <span class="text-slate-200">{{ modelValue[field.key] ? '已开启' : '关闭' }}</span>
        </label>

        <input
          v-else-if="field.type === 'range' || field.type === 'number'"
          type="number"
          class="w-28 bg-studio-900 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none disabled:opacity-50"
          :min="field.min"
          :max="field.max"
          :step="field.step || 1"
          :disabled="isLocked(field.key)"
          :value="modelValue[field.key]"
          @change="onParamChange(field.key, Number($event.target.value))"
        />

        <input
          v-else
          type="text"
          class="bg-studio-900 text-slate-100 border border-studio-700 rounded-lg px-2 py-1 outline-none disabled:opacity-50"
          :disabled="isLocked(field.key)"
          :value="modelValue[field.key] || ''"
          @change="onParamChange(field.key, $event.target.value)"
        />
      </label>
    </div>

    <!-- 4. 条件联动提示条 -->
    <div v-if="ruleEval.warnings.length" class="flex flex-wrap items-center gap-2 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-700/40 px-2.5 py-1 rounded-lg">
      <span>⚠️ 契约联动提示：</span>
      <span v-for="(w, i) in ruleEval.warnings" :key="i">{{ w }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { evaluateClientModelRules } from '../utils/model-protocol';

const props = defineProps({
  schema: { type: Object, default: null },
  activeMode: { type: String, default: '' },
  modelValue: { type: Object, default: () => ({}) },
  showAdvanced: { type: Boolean, default: false },
  refCounts: { type: Object, default: () => ({ images: 0, videos: 0, audios: 0 }) },
});

const emit = defineEmits(['update:modelValue', 'update:showAdvanced', 'select-mode', 'param-change']);

const ruleEval = computed(() =>
  evaluateClientModelRules(props.schema, props.activeMode, props.modelValue, props.refCounts)
);

const lockReasons = computed(() => ruleEval.value.lockReasons || {});

const effectiveImageSlotCap = computed(() => {
  const slots = Number(props.schema?.slots?.images ?? 10);
  const free = props.schema?.free?.maxRefs;
  return free != null ? Math.min(slots, Number(free)) : slots;
});

const effectiveCommonFields = computed(() => {
  if (!props.schema) return [];
  const suppressed = new Set(ruleEval.value.suppressedKeys || []);
  const fields = [...(props.schema.common || [])].filter(f => !suppressed.has(f.key));
  if (props.activeMode === 'image_edit') {
    for (const key of ['bbox', 'point']) {
      const field = (props.schema.advanced || []).find((item) => item.key === key);
      if (field && !fields.some((item) => item.key === key)) fields.push(field);
    }
  }
  return fields;
});

const effectiveAdvancedFields = computed(() => {
  if (!props.schema) return [];
  const suppressed = new Set(ruleEval.value.suppressedKeys || []);
  return (props.schema.advanced || []).filter(
    (field) =>
      !suppressed.has(field.key) &&
      !(props.activeMode === 'image_edit' && (field.key === 'bbox' || field.key === 'point'))
  );
});

function isLocked(key) {
  return (ruleEval.value.lockedKeys || []).includes(key);
}

function fieldOptions(field) {
  const ov = ruleEval.value.fieldOverrides?.[field.key];
  if (ov && Array.isArray(ov.options)) return ov.options;
  return field.options || [];
}

function optionLabel(field, value) {
  if (field.labels && field.labels[String(value)] != null) return field.labels[String(value)];
  if (value === -1 || value === '-1') return '智能';
  if (value === 'auto') return '自动 (auto)';
  return String(value);
}

function onParamChange(key, value) {
  if (isLocked(key)) return;
  const nextRaw = { ...(props.modelValue || {}), [key]: value };
  const evaluated = evaluateClientModelRules(props.schema, props.activeMode, nextRaw, props.refCounts);
  emit('update:modelValue', evaluated.params);
  emit('param-change', { key, value, params: evaluated.params });
}
</script>
