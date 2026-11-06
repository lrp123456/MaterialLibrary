<template>
  <div class="contents">
    <!-- 1. 模式胶囊 + 参考槽位容量 -->
    <div v-if="schema && Array.isArray(schema.modes) && schema.modes.length" class="flex flex-wrap items-center gap-2">
      <div class="inline-flex items-center gap-0.5 rounded-xl border p-0.5 studio-surface studio-border-soft">
        <button
          v-for="mode in schema.modes"
          :key="mode.id"
          type="button"
          class="param-mode"
          :class="{
            'is-on': activeMode === mode.id,
            'opacity-40 cursor-not-allowed': isModeDisabled(mode.id)
          }"
          :disabled="isModeDisabled(mode.id)"
          :title="isModeDisabled(mode.id) ? '当前已挂载参考图，若要纯文生图请先清空看图区' : ''"
          @click="!isModeDisabled(mode.id) && $emit('select-mode', mode.id)"
        >
          <span class="param-mode-dot"></span>
          <span>{{ mode.label }}</span>
        </button>
      </div>

      <!-- 多模态参考槽位容量指示器 -->
      <div v-if="schema.slots" class="flex items-center gap-1.5">
        <span
          v-if="schema.slots.images > 0"
          class="param-slot"
          :class="slotFillClass(refCounts.images, effectiveImageSlotCap)"
          :title="`图片参考槽位 ${refCounts.images || 0}/${effectiveImageSlotCap}`"
        >
          <StudioIcon name="image" :size="12" />
          <span>{{ refCounts.images || 0 }}/{{ effectiveImageSlotCap }}</span>
        </span>
        <span
          v-if="schema.slots.videos > 0 && !schema.free?.noVideoRef"
          class="param-slot"
          :class="slotFillClass(refCounts.videos, schema.slots.videos)"
          :title="`视频参考槽位 ${refCounts.videos || 0}/${schema.slots.videos}`"
        >
          <StudioIcon name="video" :size="12" />
          <span>{{ refCounts.videos || 0 }}/{{ schema.slots.videos }}</span>
        </span>
        <span
          v-if="schema.slots.audios > 0"
          class="param-slot"
          :class="slotFillClass(refCounts.audios, schema.slots.audios)"
          :title="`音频参考槽位 ${refCounts.audios || 0}/${schema.slots.audios}`"
        >
          <StudioIcon name="music" :size="12" />
          <span>{{ refCounts.audios || 0 }}/{{ schema.slots.audios }}</span>
        </span>
      </div>
    </div>

    <!-- 2. 常用参数 + 高级参数开关 -->
    <div v-if="effectiveCommonFields.length || effectiveAdvancedFields.length" class="flex flex-wrap items-center gap-2">
      <label
        v-for="field in effectiveCommonFields"
        :key="'c-' + field.key"
        class="param-field"
        :class="{ 'is-locked': isLocked(field.key) }"
        :title="lockReasons[field.key] || fieldHint(field)"
      >
        <span class="param-label">
          {{ field.label }}
          <StudioIcon v-if="isLocked(field.key)" name="lock" :size="10" title="已联动锁定" />
        </span>

        <select
          v-if="field.type === 'enum'"
          class="param-input"
          :disabled="isLocked(field.key)"
          :value="modelValue[field.key]"
          @change="onParamChange(field.key, $event.target.value)"
        >
          <option v-for="opt in fieldOptions(field)" :key="String(opt)" :value="opt">
            {{ optionLabel(field, opt) }}
          </option>
        </select>

        <span
          v-else-if="field.type === 'bool'"
          class="param-switch"
          :class="{ 'is-on': !!modelValue[field.key], 'is-disabled': isLocked(field.key) }"
        >
          <!-- 外层 <label> 点击会原生激活该 checkbox，只监听 change，避免 label 合成点击 + span @click 双重触发导致开关打不开 -->
          <input
            type="checkbox"
            class="sr-only"
            :disabled="isLocked(field.key)"
            :checked="!!modelValue[field.key]"
            @change="toggleBool(field, $event.target.checked)"
          />
          <span class="param-switch-track"><span class="param-switch-thumb"></span></span>
          <span>{{ modelValue[field.key] ? '已开启' : '关闭' }}</span>
        </span>

        <!-- 连续范围参数（如时长）：滑轨 + 实时数值 -->
        <span v-else-if="field.type === 'range' || field.type === 'duration'" class="param-slider-wrap" :title="fieldHint(field)">
          <input
            type="range"
            class="param-slider"
            :min="field.min"
            :max="field.max"
            :step="numericStep(field)"
            :disabled="isLocked(field.key)"
            :value="sliderValue(field)"
            :style="sliderFillStyle(field)"
            @input="onSliderInput(field, $event.target.value)"
            @change="onSliderChange(field, $event.target.value)"
          />
          <span class="param-slider-val">
            {{ modelValue[field.key] }}<span v-if="rangeSuffix(field)" class="param-slider-suffix">{{ rangeSuffix(field) }}</span>
          </span>
        </span>

        <!-- 离散数值：步进按钮 + 输入框（失焦自动夹取到契约范围） -->
        <span v-else-if="isNumeric(field)" class="param-stepper">
          <button
            type="button"
            class="param-step-btn"
            :disabled="isLocked(field.key) || !canStep(field, -1)"
            tabindex="-1"
            @click="stepValue(field, -1)"
            aria-label="减少"
          >−</button>
          <input
            type="number"
            class="param-num-input"
            :min="field.min"
            :max="field.max"
            :step="numericStep(field)"
            :disabled="isLocked(field.key)"
            :value="modelValue[field.key]"
            @focus="$event.target.select()"
            @change="onNumericChange(field, $event.target.value)"
          />
          <button
            type="button"
            class="param-step-btn"
            :disabled="isLocked(field.key) || !canStep(field, 1)"
            tabindex="-1"
            @click="stepValue(field, 1)"
            aria-label="增加"
          >+</button>
          <span v-if="rangeSuffix(field)" class="param-num-suffix">{{ rangeSuffix(field) }}</span>
          <span v-if="outOfRange(field)" class="param-num-warn" :title="rangeError(field)">!</span>
        </span>

        <input
          v-else
          type="text"
          class="param-input"
          :disabled="isLocked(field.key)"
          :value="modelValue[field.key] || ''"
          @change="onParamChange(field.key, $event.target.value)"
        />
      </label>

      <!-- 范围能力提示（如：时长 4–12 秒） -->
      <span v-for="hint in visibleRangeHints" :key="'hint-' + hint.key" class="param-range-hint">{{ hint.text }}</span>

      <!-- 高级参数抽屉开关 -->
      <button
        v-if="effectiveAdvancedFields.length"
        type="button"
        class="param-advanced"
        :class="{ 'is-on': showAdvanced }"
        @click="$emit('update:showAdvanced', !showAdvanced)"
      >
        <StudioIcon name="settings" :size="13" />
        <span>高级配置</span>
        <span class="param-advanced-count">{{ effectiveAdvancedFields.length }}</span>
        <StudioIcon v-if="showAdvanced" name="chevronDown" :size="11" />
      </button>
    </div>

    <!-- 3. 高级参数展开抽屉 -->
    <div
      v-if="showAdvanced && effectiveAdvancedFields.length"
      class="basis-full flex flex-wrap items-center gap-2.5 px-3 py-2.5 rounded-xl studio-surface-strong studio-border-soft"
    >
      <label
        v-for="field in effectiveAdvancedFields"
        :key="'a-' + field.key"
        class="param-field"
        :class="{ 'is-locked': isLocked(field.key) }"
        :title="lockReasons[field.key] || fieldHint(field)"
      >
        <span class="param-label">
          {{ field.label }}
          <StudioIcon v-if="isLocked(field.key)" name="lock" :size="10" />
        </span>

        <select
          v-if="field.type === 'enum'"
          class="param-input"
          :disabled="isLocked(field.key)"
          :value="modelValue[field.key]"
          @change="onParamChange(field.key, $event.target.value)"
        >
          <option v-for="opt in fieldOptions(field)" :key="String(opt)" :value="opt">
            {{ optionLabel(field, opt) }}
          </option>
        </select>

        <span
          v-else-if="field.type === 'bool'"
          class="param-switch"
          :class="{ 'is-on': !!modelValue[field.key], 'is-disabled': isLocked(field.key) }"
        >
          <!-- 外层 <label> 点击会原生激活该 checkbox，只监听 change，避免 label 合成点击 + span @click 双重触发导致开关打不开 -->
          <input
            type="checkbox"
            class="sr-only"
            :disabled="isLocked(field.key)"
            :checked="!!modelValue[field.key]"
            @change="toggleBool(field, $event.target.checked)"
          />
          <span class="param-switch-track"><span class="param-switch-thumb"></span></span>
          <span>{{ modelValue[field.key] ? '已开启' : '关闭' }}</span>
        </span>

        <span v-else-if="field.type === 'range' || field.type === 'duration'" class="param-slider-wrap" :title="fieldHint(field)">
          <input
            type="range"
            class="param-slider"
            :min="field.min" :max="field.max" :step="numericStep(field)"
            :disabled="isLocked(field.key)"
            :value="sliderValue(field)"
            :style="sliderFillStyle(field)"
            @input="onSliderInput(field, $event.target.value)"
            @change="onNumericChange(field, $event.target.value)"
          />
          <span class="param-slider-val">
            {{ modelValue[field.key] }}<span v-if="rangeSuffix(field)" class="param-slider-suffix">{{ rangeSuffix(field) }}</span>
          </span>
        </span>

        <span v-else-if="isNumeric(field)" class="param-stepper">
          <button type="button" class="param-step-btn" :disabled="isLocked(field.key) || !canStep(field, -1)" tabindex="-1" @click="stepValue(field, -1)">−</button>
          <input
            type="number"
            class="param-num-input"
            :min="field.min" :max="field.max" :step="numericStep(field)"
            :disabled="isLocked(field.key)"
            :value="modelValue[field.key]"
            @focus="$event.target.select()"
            @change="onNumericChange(field, $event.target.value)"
          />
          <button type="button" class="param-step-btn" :disabled="isLocked(field.key) || !canStep(field, 1)" tabindex="-1" @click="stepValue(field, 1)">+</button>
          <span v-if="rangeSuffix(field)" class="param-num-suffix">{{ rangeSuffix(field) }}</span>
        </span>

        <input
          v-else
          type="text"
          class="param-input"
          :disabled="isLocked(field.key)"
          :value="modelValue[field.key] || ''"
          @change="onParamChange(field.key, $event.target.value)"
        />
      </label>
    </div>

    <!-- 4. 联动警告 -->
    <div v-if="ruleEval.warnings.length" class="basis-full flex flex-wrap items-center gap-1.5 text-[11px] studio-warning-text px-2.5 py-1.5 rounded-lg studio-warning-bg studio-border-warning">
      <StudioIcon name="warning" :size="12" />
      <span v-for="(w, i) in ruleEval.warnings" :key="i">{{ w }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue';
import StudioIcon from './StudioIcon.vue';
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

function isModeDisabled(modeId) {
  const imgCount = Number(props.refCounts?.images || 0);
  const vidCount = Number(props.refCounts?.videos || 0);
  if (modeId === 'text_to_image' || modeId === 'text_to_video') {
    return imgCount > 0 || vidCount > 0;
  }
  return false;
}

const effectiveImageSlotCap = computed(() => {
  const slots = Number(props.schema?.slots?.images ?? 10);
  const free = props.schema?.free?.maxRefs;
  let cap = free != null ? Math.min(slots, Number(free)) : slots;
  // 首尾帧模式最多两张（首帧+尾帧）；单图编辑模式只允许一张
  if (props.activeMode === 'first_last_frame') cap = Math.min(cap, 2);
  if (props.activeMode === 'expand_fill') cap = Math.min(cap, 1);
  return cap;
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
  if (value === 'auto') return '自动';
  return String(value);
}

// ---------- 数值/时长范围约束 ----------
function isNumeric(field) {
  return field.type === 'range' || field.type === 'number' || field.type === 'duration';
}
function numericStep(field) {
  const step = Number(field.step);
  return Number.isFinite(step) && step > 0 ? step : 1;
}
function hasSmartStop(field) {
  return Array.isArray(field.extraStops) && field.extraStops.includes(-1);
}
function numericValue(field) {
  const v = Number(props.modelValue?.[field.key]);
  return Number.isFinite(v) ? v : null;
}
function isSmart(field) {
  return numericValue(field) === -1 && hasSmartStop(field);
}
function canStep(field, dir) {
  const v = numericValue(field);
  if (v == null || isSmart(field)) return false;
  const next = v + dir * numericStep(field);
  return next >= Number(field.min) && next <= Number(field.max);
}
function outOfRange(field) {
  if (!isNumeric(field)) return false;
  const v = numericValue(field);
  if (v == null) return false;
  if (v === -1 && hasSmartStop(field)) return false;
  return v < Number(field.min) || v > Number(field.max);
}
function rangeError(field) {
  return `${field.label}需在 ${field.min}–${field.max} 之间${rangeSuffix(field) ? '（' + rangeSuffix(field) + '）' : ''}`;
}
function rangeSuffix(field) {
  if (field.key === 'duration') return '秒';
  return field.unit || '';
}
function fieldHint(field) {
  if (!isNumeric(field)) return '';
  const parts = [`范围 ${field.min}–${field.max}`];
  if (rangeSuffix(field)) parts.push(rangeSuffix(field));
  if (hasSmartStop(field)) parts.push('支持 -1 智能');
  return parts.join(' · ');
}
const visibleRangeHints = computed(() => {
  const out = [];
  for (const field of effectiveCommonFields.value) {
    if (!isNumeric(field)) continue;
    // 滑轨自身已表达范围，不再重复显示文字提示
    if (field.type === 'range' || field.type === 'duration') continue;
    if (field.min == null || field.max == null) continue;
    out.push({ key: field.key, text: `${field.label} ${field.min}–${field.max}${rangeSuffix(field) ? ' ' + rangeSuffix(field) : ''}` });
  }
  return out;
});

// ---------- 滑轨 ----------
const sliderDrag = reactive({});
function sliderValue(field) {
  // 拖动中用本地临时值（避免每次 input 都触发联动计算）；静止值夹取显示
  if (field.key in sliderDrag) return sliderDrag[field.key];
  const v = numericValue(field);
  if (v == null) return field.default ?? field.min ?? 0;
  if (hasSmartStop(field) && v === -1) return field.min;
  return Math.min(Number(field.max), Math.max(Number(field.min), v));
}
function sliderFillStyle(field) {
  const min = Number(field.min), max = Number(field.max);
  const pct = max > min ? ((sliderValue(field) - min) / (max - min)) * 100 : 0;
  return {
    background: `linear-gradient(to right, rgb(var(--studio-accent-rgb)) 0%, rgb(var(--studio-accent-rgb)) ${pct}%, rgb(var(--studio-700-rgb)) ${pct}%, rgb(var(--studio-700-rgb)) 100%)`,
  };
}
function onSliderInput(field, raw) {
  sliderDrag[field.key] = Number(raw);
  // 拖动时直接更新模型值（滑块取值恒在 [min,max] 内，无需夹取）
  onParamChange(field.key, Number(raw));
}
function commitNumeric(field, raw) {
  const parsed = parseFloat(raw);
  let value;
  if (!Number.isFinite(parsed)) {
    value = field.default != null ? Number(field.default) : Number(field.min ?? 0);
  } else if (hasSmartStop(field) && parsed === -1) {
    value = -1;
  } else {
    const min = Number(field.min);
    const max = Number(field.max);
    // 失焦即夹取到契约范围，杜绝 60s 这类越界值被提交
    let clamped = Math.min(max, Math.max(min, parsed));
    const step = numericStep(field);
    clamped = Math.round(clamped / step) * step;
    if (Number.isInteger(step)) clamped = Math.round(clamped);
    value = clamped;
  }
  onParamChange(field.key, value);
}
function onNumericChange(field, raw) {
  delete sliderDrag[field.key];
  commitNumeric(field, raw);
}
const onSliderChange = onNumericChange;
function stepValue(field, dir) {
  const v = numericValue(field);
  const base = v == null ? Number(field.default ?? field.min) : v;
  commitNumeric(field, String(base + dir * numericStep(field)));
}
function toggleBool(field, checked) {
  if (isLocked(field.key)) return;
  onParamChange(field.key, Boolean(checked));
}

function onParamChange(key, value) {
  if (isLocked(key)) return;
  const nextRaw = { ...(props.modelValue || {}), [key]: value };
  const evaluated = evaluateClientModelRules(props.schema, props.activeMode, nextRaw, props.refCounts);
  emit('update:modelValue', evaluated.params);
  emit('param-change', { key, value, params: evaluated.params });
}

function slotFillClass(count, cap) {
  const n = Number(count) || 0;
  const c = Number(cap) || 0;
  if (n <= 0) return 'is-empty';
  if (c && n >= c) return 'is-full';
  return 'is-active';
}
</script>

<style scoped>
/* 参数条统一走主题令牌，暗黑/明朗/护眼三套皮肤 + 长辈模式自动适配 */
.studio-surface {
  background-color: rgb(var(--studio-950-rgb) / 0.55);
}
.studio-surface-strong {
  background-color: rgb(var(--studio-950-rgb) / 0.8);
}
.studio-border-soft {
  border-color: rgb(var(--studio-750-rgb) / 0.9);
}

/* 模式胶囊组 */
.param-mode {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: rgb(var(--slate-400-rgb));
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color .15s, color .15s, box-shadow .15s;
}
.param-mode:hover {
  color: rgb(var(--slate-200-rgb));
  background-color: rgb(var(--studio-800-rgb) / 0.6);
}
.param-mode-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  opacity: .55;
}
.param-mode.is-on {
  color: rgb(var(--studio-accent-rgb));
  background: rgb(var(--studio-accent-rgb) / 0.14);
  box-shadow: inset 0 0 0 1px rgb(var(--studio-accent-rgb) / 0.45);
}
.param-mode.is-on .param-mode-dot {
  opacity: 1;
  box-shadow: 0 0 6px rgb(var(--studio-accent-rgb) / 0.8);
}

/* 槽位徽章 */
.param-slot {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  border: 1px solid rgb(var(--studio-750-rgb));
  background: rgb(var(--studio-950-rgb) / 0.55);
  color: rgb(var(--slate-500-rgb));
}
.param-slot.is-active {
  color: rgb(var(--studio-cyan-rgb));
  border-color: rgb(var(--studio-cyan-rgb) / 0.45);
  background: rgb(var(--studio-cyan-rgb) / 0.1);
}
.param-slot.is-full {
  color: var(--theme-warning-text);
  border-color: rgb(var(--studio-amber-rgb) / 0.5);
  background: rgb(var(--studio-amber-rgb) / 0.12);
}

/* 字段 */
.param-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  position: relative;
}
.param-field.is-locked {
  opacity: .8;
}
.param-label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-weight: 700;
  color: rgb(var(--slate-400-rgb));
  white-space: nowrap;
}
.param-input {
  background-color: rgb(var(--studio-950-rgb) / 0.9);
  color: rgb(var(--slate-100-rgb));
  border: 1px solid rgb(var(--studio-700-rgb));
  border-radius: 9px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  outline: none;
  min-height: 28px;
}
.param-input:focus {
  border-color: rgb(var(--studio-accent-rgb));
  box-shadow: 0 0 0 2px rgb(var(--studio-accent-rgb) / 0.25);
}
.param-input:disabled {
  opacity: .55;
}

/* 布尔开关 */
.param-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px 3px 4px;
  border-radius: 9px;
  border: 1px solid rgb(var(--studio-700-rgb));
  background: rgb(var(--studio-950-rgb) / 0.9);
  color: rgb(var(--slate-300-rgb));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}
.param-switch.is-disabled { opacity: .55; cursor: not-allowed; }
.param-switch-track {
  width: 26px; height: 15px; border-radius: 999px;
  background: rgb(var(--studio-700-rgb));
  position: relative;
  transition: background-color .15s;
}
.param-switch-thumb {
  position: absolute;
  top: 2px; left: 2px;
  width: 11px; height: 11px;
  border-radius: 999px;
  background: #fff;
  transition: transform .15s;
}
.param-switch.is-on .param-switch-track {
  background: rgb(var(--studio-accent-rgb));
}
.param-switch.is-on .param-switch-thumb {
  transform: translateX(11px);
}

/* 滑轨（时长等连续范围参数） */
.param-slider-wrap {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 2px 8px 2px 6px;
  border-radius: 10px;
  border: 1px solid rgb(var(--studio-700-rgb));
  background: rgb(var(--studio-950-rgb) / 0.9);
}
.param-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 92px;
  height: 4px;
  border-radius: 999px;
  outline: none;
  cursor: pointer;
  margin: 0;
}
.param-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #fff;
  border: 3px solid rgb(var(--studio-accent-rgb));
  box-shadow: 0 1px 4px rgba(0,0,0,.4);
  cursor: grab;
  transition: transform .1s;
}
.param-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.15); }
.param-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #fff;
  border: 3px solid rgb(var(--studio-accent-rgb));
  box-shadow: 0 1px 4px rgba(0,0,0,.4);
  cursor: grab;
}
.param-slider:disabled { opacity: .55; cursor: not-allowed; }
.param-slider-val {
  font-size: 12px;
  font-weight: 800;
  color: rgb(var(--studio-accent-rgb));
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 26px;
  text-align: right;
}
.param-slider-suffix {
  font-size: 10px;
  font-weight: 700;
  color: rgb(var(--slate-500-rgb));
  margin-left: 1px;
}
html.senior-mode .param-slider { width: 110px; }

/* 数字步进器 */
.param-stepper {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  border: 1px solid rgb(var(--studio-700-rgb));
  background: rgb(var(--studio-950-rgb) / 0.9);
}
.param-step-btn {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  color: rgb(var(--slate-300-rgb));
  cursor: pointer;
}
.param-step-btn:hover:not(:disabled) {
  background: rgb(var(--studio-800-rgb));
  color: rgb(var(--slate-100-rgb));
}
.param-step-btn:disabled { opacity: .35; cursor: not-allowed; }
.param-num-input {
  width: 40px;
  background: transparent;
  border: none;
  outline: none;
  color: rgb(var(--slate-100-rgb));
  font-size: 12px;
  font-weight: 800;
  text-align: center;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
  appearance: textfield;
  padding: 0;
  min-height: 22px;
}
.param-num-input::-webkit-outer-spin-button,
.param-num-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.param-num-suffix {
  font-size: 10px;
  font-weight: 700;
  color: rgb(var(--slate-500-rgb));
  padding-right: 4px;
}
.param-num-warn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px; height: 15px;
  margin-right: 3px;
  border-radius: 999px;
  background: rgb(var(--studio-rose-rgb) / 0.2);
  color: rgb(var(--studio-rose-rgb));
  font-size: 10px;
  font-weight: 900;
}
.param-range-hint {
  font-size: 10.5px;
  font-weight: 600;
  color: rgb(var(--slate-500-rgb));
  white-space: nowrap;
}

/* 高级配置按钮 */
.param-advanced {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 9px;
  border: 1px solid rgb(var(--studio-750-rgb));
  background: rgb(var(--studio-950-rgb) / 0.55);
  color: rgb(var(--slate-400-rgb));
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all .15s;
}
.param-advanced:hover {
  color: rgb(var(--slate-200-rgb));
  border-color: rgb(var(--studio-600-rgb));
}
.param-advanced.is-on {
  color: rgb(var(--studio-accent-rgb));
  border-color: rgb(var(--studio-accent-rgb) / 0.5);
  background: rgb(var(--studio-accent-rgb) / 0.1);
}
.param-advanced-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgb(var(--studio-accent-rgb) / 0.2);
  color: rgb(var(--studio-accent-rgb));
  font-size: 10px;
  font-weight: 800;
}

/* 警告条 */
.studio-warning-text { color: var(--theme-warning-text); }
.studio-warning-bg { background: var(--theme-warning-bg); }
.studio-border-warning { border: 1px solid rgb(var(--studio-amber-rgb) / 0.35); }

html.senior-mode .param-mode,
html.senior-mode .param-field,
html.senior-mode .param-advanced,
html.senior-mode .param-slot { font-size: 13.5px; }
html.senior-mode .param-input,
html.senior-mode .param-switch,
html.senior-mode .param-num-input { font-size: 13.5px; }
</style>
