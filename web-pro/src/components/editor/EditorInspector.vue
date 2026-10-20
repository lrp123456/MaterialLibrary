<template>
  <aside class="w-[310px] bg-studio-900 border-l border-studio-750/80 shrink-0 overflow-y-auto custom-scroll text-slate-100" style="height: 100%">
    <template v-if="clip">
      <div class="px-3 py-2 flex items-center justify-between border-b border-studio-800 sticky top-0 bg-studio-900 z-10">
        <span class="text-xs font-bold text-white flex items-center gap-1.5"><StudioIcon name="sliders" :size="14" class="text-studio-accent" /> 片段属性</span>
        <button class="text-slate-400 hover:text-white cursor-pointer" @click="clearSelection">✕</button>
      </div>

      <div class="p-3 space-y-3 text-xs">
        <div class="flex items-center gap-2">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-mono" :class="typeBadge">{{ clip.type }}</span>
          <input v-model="clip.name" class="flex-1 min-w-0 bg-studio-950 border border-studio-750 rounded-lg px-2 py-1 text-slate-200 outline-none" />
        </div>
        <div class="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400">
          <span>入点 {{ clip.start.toFixed(2) }}s</span>
          <span>时长 {{ clip.duration.toFixed(2) }}s</span>
          <span>源入 {{ (clip.trimStart || 0).toFixed(2) }}s</span>
          <span>源出 {{ (clip.trimEnd || 0).toFixed(2) }}s</span>
        </div>
        <div v-if="!media && !['text','effect','sticker','graphic'].includes(clip.type)" class="text-[11px] px-2 py-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300">
          缺片源：该片段没有可读取的媒体文件，预览与导出中对应层为空。
        </div>

        <!-- 文本 -->
        <div v-if="clip.type === 'text'" class="space-y-2">
          <label class="block text-[11px] text-slate-400">文字内容
            <textarea v-model="clip.text" rows="3" class="mt-1 w-full bg-studio-950 border border-studio-750 rounded-lg p-2 text-white outline-none"></textarea>
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="text-[11px] text-slate-400">字号
              <input type="number" min="8" max="300" v-model.number="clip.fontSize" class="mt-1 w-full bg-studio-950 border border-studio-750 rounded-lg px-2 py-1 text-slate-200 outline-none" />
            </label>
            <label class="text-[11px] text-slate-400">颜色
              <input type="color" v-model="clip.color" class="mt-1 w-full h-8 bg-transparent border border-studio-750 rounded-lg cursor-pointer" />
            </label>
          </div>
        </div>

        <!-- 贴纸/图形 -->
        <div v-if="clip.type === 'sticker'" class="flex items-center gap-2">
          <label class="text-[11px] text-slate-400">贴纸</label>
          <input v-model="clip.sticker" class="flex-1 bg-studio-950 border border-studio-750 rounded-lg px-2 py-1 text-white outline-none" />
        </div>
        <div v-if="clip.type === 'graphic'" class="grid grid-cols-2 gap-2">
          <label class="text-[11px] text-slate-400">形状
            <select v-model="clip.graphic" class="mt-1 w-full bg-studio-950 border border-studio-750 rounded-lg px-2 py-1 text-slate-200 outline-none">
              <option value="ring">圆环</option><option value="circle">圆形</option><option value="triangle">三角</option><option value="bar">线条</option>
            </select>
          </label>
          <label class="text-[11px] text-slate-400">颜色
            <input type="color" v-model="clip.color" class="mt-1 w-full h-8 bg-transparent border border-studio-750 rounded-lg cursor-pointer" />
          </label>
        </div>

        <!-- 变换 + 关键帧 -->
        <div v-if="clip.type !== 'audio' && clip.type !== 'effect'" class="space-y-2 pt-1 border-t border-studio-800">
          <div class="text-[11px] font-bold text-slate-300">变换与不透明度</div>
          <div v-for="prop in ANIMATABLE" :key="prop.key" class="space-y-0.5">
            <div class="flex items-center justify-between text-[10px] text-slate-400">
              <span>{{ prop.label }} <span class="font-mono text-studio-cyan">{{ formatVal(prop.key, transform[prop.key]) }}{{ prop.unit }}</span></span>
              <button
                class="key-diamond"
                :class="hasKeyAt(prop.key) ? 'is-on' : ''"
                :title="`在播放头处${hasKeyAt(prop.key) ? '删除' : '添加'}关键帧`"
                @click="toggleKeyframe(prop.key)"
              >◆</button>
            </div>
            <input
              type="range"
              :min="prop.min" :max="prop.max" :step="prop.key === 'rotation' ? 1 : 0.5"
              :value="Number(transform[prop.key])"
              class="w-full accent-studio-accent cursor-pointer"
              @input="onTransformInput(prop.key, $event.target.value)"
            />
          </div>
        </div>

        <!-- 关键帧列表 -->
        <div v-if="clip.type !== 'audio' && clip.type !== 'effect'" class="space-y-1.5 pt-1 border-t border-studio-800">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold text-slate-300">关键帧</span>
            <div class="flex items-center gap-1">
              <button class="mini-btn" @click="copySelectedKeyframes" title="复制勾选的关键帧">复制</button>
              <button class="mini-btn" @click="pasteSelectedKeyframes" title="粘贴到当前片段">粘贴</button>
            </div>
          </div>
          <div v-if="!keyframeGroups.length" class="text-[10px] text-slate-500">还没有关键帧。点菱形按钮在播放头处添加。</div>
          <div v-for="group in keyframeGroups" :key="group.prop" class="rounded-lg border border-studio-800 bg-studio-950/60 p-1.5 space-y-1">
            <div class="flex items-center justify-between text-[10px] text-slate-300">
              <span class="font-bold">{{ labelOf(group.prop) }}</span>
              <button class="text-rose-400 cursor-pointer" @click="clearKeyframes(group.prop)" title="清空该属性关键帧">清空</button>
            </div>
            <div v-for="key in group.keys" :key="key.id" class="flex items-center gap-1">
              <input type="checkbox" class="accent-studio-accent" :checked="isKeySelected(group.prop, key.id)" @change="toggleKeyframeSelection(group.prop, key.id)" />
              <input
                type="number" step="0.01" :value="Number(key.time.toFixed(2))"
                class="w-12 bg-studio-950 border border-studio-800 rounded px-1 py-0.5 text-[10px] font-mono"
                @change="updateKeyframeTime(group.prop, key.id, $event.target.value)"
              />
              <span class="text-[9px] text-slate-500">s</span>
              <input
                type="number" step="0.5" :value="Number(key.value.toFixed(2))"
                class="w-14 bg-studio-950 border border-studio-800 rounded px-1 py-0.5 text-[10px] font-mono"
                @change="updateKeyframeValue(group.prop, key.id, $event.target.value)"
              />
              <select
                :value="key.interpolation || 'linear'"
                class="flex-1 min-w-0 bg-studio-950 border border-studio-800 rounded px-1 py-0.5 text-[10px]"
                @change="changeKeyframeInterpolation(group.prop, key.id, $event.target.value)"
              >
                <option value="linear">线性</option>
                <option value="bezier">缓入缓出</option>
                <option value="hold">保持</option>
              </select>
              <button class="text-rose-400 cursor-pointer" @click="deleteKeyframe(group.prop, key.id)">×</button>
            </div>
          </div>
        </div>

        <!-- 遮罩 -->
        <div v-if="['video','image','graphic','sticker'].includes(clip.type)" class="space-y-1.5 pt-1 border-t border-studio-800">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold text-slate-300">遮罩</span>
            <div class="flex gap-1">
              <button class="mini-btn" @click="addMask('rectangle')" title="矩形遮罩（支持圆角）">▭</button>
              <button class="mini-btn" @click="addMask('ellipse')" title="椭圆遮罩">◯</button>
              <button class="mini-btn" @click="addMask('path')" title="自由贝塞尔多边形">✎</button>
            </div>
          </div>
          <div v-if="!clip.masks?.length" class="text-[10px] text-slate-500">无遮罩</div>
          <div v-for="mask in clip.masks" :key="mask.id" class="rounded-lg border p-1.5 space-y-1.5 cursor-pointer"
            :class="state.activeMaskId === mask.id ? 'border-studio-accent bg-studio-accent/10' : 'border-studio-800 bg-studio-950/60'"
            @click="selectMask(mask.id)">
            <div class="flex items-center justify-between text-[10px]">
              <span class="font-bold">{{ maskLabel(mask.type) }}</span>
              <button class="text-rose-400 cursor-pointer" @click.stop="removeMask(mask.id)">删除</button>
            </div>
            <template v-if="state.activeMaskId === mask.id">
              <div class="grid grid-cols-2 gap-1">
                <label v-for="f in ['x','y','w','h']" :key="f" class="text-[9px] text-slate-400">{{ f.toUpperCase() }}
                  <input type="number" step="0.01" min="0" max="1" :value="mask[f]" class="w-full bg-studio-950 border border-studio-800 rounded px-1 py-0.5 text-[10px] font-mono" @change="updateMaskField(f, Number($event.target.value))" />
                </label>
              </div>
              <div class="flex items-center justify-between text-[10px] text-slate-400">
                <span>羽化 <span class="font-mono text-studio-cyan">{{ Math.round(mask.feather) }}px</span></span>
                <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" :checked="mask.inverted" class="accent-studio-accent" @change="updateMaskField('inverted', $event.target.checked)" /> 反向</label>
              </div>
              <input type="range" min="0" max="100" step="1" :value="mask.feather" class="w-full accent-studio-accent" @input="updateMaskField('feather', Number($event.target.value))" />
              <div v-if="mask.type === 'rectangle'" class="flex items-center gap-1 text-[10px] text-slate-400">
                <span>圆角</span>
                <input type="range" min="0" max="0.5" step="0.01" :value="mask.radius" class="flex-1 accent-studio-accent" @input="updateMaskField('radius', Number($event.target.value))" />
              </div>
              <div v-if="mask.type === 'path'" class="flex items-center justify-between text-[10px] text-slate-400">
                <span>{{ mask.points?.length || 0 }} 个贝塞尔点</span>
                <button class="mini-btn" :class="state.maskEditMode ? 'is-on' : ''" @click.stop="state.maskEditMode = !state.maskEditMode">在预览上编辑点</button>
              </div>
            </template>
          </div>
        </div>

        <!-- 音频 -->
        <div v-if="clip.type === 'audio' || clip.type === 'video'" class="space-y-2 pt-1 border-t border-studio-800">
          <div class="text-[11px] font-bold text-slate-300">音频</div>
          <div class="flex items-center justify-between text-[10px] text-slate-400">
            <span>音量 <span class="font-mono text-studio-cyan">{{ Math.round(clip.volume ?? 100) }}%</span></span>
          </div>
          <input type="range" min="0" max="200" step="1" v-model.number="clip.volume" class="w-full accent-emerald-500" />
          <div class="grid grid-cols-2 gap-2">
            <label class="text-[10px] text-slate-400">淡入
              <input type="number" min="0" max="10" step="0.1" v-model.number="clip.fadeIn" class="mt-0.5 w-full bg-studio-950 border border-studio-750 rounded px-2 py-1 text-[11px]" />
            </label>
            <label class="text-[10px] text-slate-400">淡出
              <input type="number" min="0" max="10" step="0.1" v-model.number="clip.fadeOut" class="mt-0.5 w-full bg-studio-950 border border-studio-750 rounded px-2 py-1 text-[11px]" />
            </label>
          </div>
          <button v-if="clip.type === 'video'" class="w-full py-1.5 rounded-lg border border-studio-750 text-[11px] text-slate-200 hover:bg-studio-800 cursor-pointer" @click="toggleSourceAudio">
            {{ clip.sourceAudioEnabled === false ? '恢复原声（并移除分离音频块）' : '分离音频为独立音频片段' }}
          </button>
        </div>

        <!-- 变速 -->
        <div v-if="clip.type === 'video' || clip.type === 'audio'" class="space-y-1.5 pt-1 border-t border-studio-800">
          <div class="text-[11px] font-bold text-slate-300">变速</div>
          <div class="grid grid-cols-3 gap-1">
            <button v-for="s in [0.5, 1, 1.5, 2, 4]" :key="s" class="py-1 rounded-md border text-[11px] cursor-pointer"
              :class="Number(clip.speed) === s ? 'bg-studio-accent border-studio-accent text-white font-bold' : 'border-studio-750 bg-studio-950 text-slate-400'"
              @click="setClipSpeed(s)">{{ s }}x</button>
          </div>
          <label class="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
            <input type="checkbox" v-model="clip.maintainPitch" class="accent-studio-accent" /> 保留音调
          </label>
        </div>

        <!-- 效果 -->
        <div v-if="clip.type !== 'effect'" class="space-y-1.5 pt-1 border-t border-studio-800">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold text-slate-300">片段效果</span>
            <button class="mini-btn" @click="addClipEffect">＋模糊</button>
          </div>
          <div v-for="fx in clip.effects || []" :key="fx.id" class="flex items-center gap-2">
            <span class="text-[10px] text-slate-400 w-8">模糊</span>
            <input type="range" min="0" max="40" step="0.5" :value="fx.amount" class="flex-1 accent-studio-accent" @input="setClipEffectAmount(fx.id, $event.target.value)" />
            <span class="text-[10px] font-mono w-8">{{ fx.amount }}px</span>
            <button class="text-rose-400 cursor-pointer" @click="removeClipEffect(fx.id)">×</button>
          </div>
        </div>
        <div v-if="clip.type === 'effect'" class="space-y-1.5 pt-1 border-t border-studio-800">
          <div class="flex items-center justify-between text-[11px] text-slate-300">
            <span class="font-bold">模糊效果（效果轨）</span>
            <span class="font-mono text-studio-cyan">{{ clip.blur || 0 }}px</span>
          </div>
          <input type="range" min="0" max="40" step="0.5" v-model.number="clip.blur" class="w-full accent-studio-accent" />
          <p class="text-[10px] text-slate-500">该效果片段覆盖的时段，整幅合成画面按此强度模糊。</p>
        </div>
      </div>
    </template>

    <!-- 未选中片段：工程/场景设置 -->
    <template v-else>
      <div class="px-3 py-2 border-b border-studio-800 sticky top-0 bg-studio-900 z-10">
        <span class="text-xs font-bold text-white">工程与场景</span>
      </div>
      <div class="p-3 space-y-3 text-xs">
        <div v-if="state.selectedGap" class="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 space-y-1">
          <div class="text-[11px] font-bold text-amber-300">已选中空白间隙</div>
          <div class="text-[10px] text-slate-300">轨道：{{ trackName(state.selectedGap.trackId) }}</div>
          <div class="text-[10px] font-mono text-slate-300">{{ state.selectedGap.start.toFixed(2) }}s → {{ state.selectedGap.end.toFixed(2) }}s（{{ state.selectedGap.length.toFixed(2) }}s）</div>
          <button class="w-full py-1.5 rounded-lg bg-amber-500/80 text-black text-[11px] font-bold cursor-pointer" @click="closeGap(state.selectedGap)">闭合间隙 (Delete)</button>
        </div>

        <label class="block text-[11px] text-slate-400">工程名
          <input v-model="project.name" class="mt-1 w-full bg-studio-950 border border-studio-750 rounded-lg px-2 py-1.5 text-slate-200 outline-none" />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="text-[11px] text-slate-400">画布宽
            <input type="number" min="64" max="4096" :value="project.canvas.width" class="mt-1 w-full bg-studio-950 border border-studio-750 rounded-lg px-2 py-1.5 text-slate-200 outline-none" @change="setCanvas({ width: Number($event.target.value) })" />
          </label>
          <label class="text-[11px] text-slate-400">画布高
            <input type="number" min="64" max="4096" :value="project.canvas.height" class="mt-1 w-full bg-studio-950 border border-studio-750 rounded-lg px-2 py-1.5 text-slate-200 outline-none" @change="setCanvas({ height: Number($event.target.value) })" />
          </label>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="text-[11px] text-slate-400">帧率
            <select :value="project.fps" class="mt-1 w-full bg-studio-950 border border-studio-750 rounded-lg px-2 py-1.5 text-slate-200 outline-none" @change="setFps(Number($event.target.value))">
              <option v-for="f in [24,25,30,60]" :key="f" :value="f">{{ f }} fps</option>
            </select>
          </label>
          <label class="text-[11px] text-slate-400">背景
            <input type="color" :value="project.canvas.background" class="mt-1 w-full h-8 bg-transparent border border-studio-750 rounded-lg cursor-pointer" @input="setCanvas({ background: $event.target.value })" />
          </label>
        </div>
        <div class="text-[10px] text-slate-400 font-mono space-y-0.5">
          <div>缩放：{{ Math.round(project.pixelsPerSecond) }} px/s</div>
          <div>播放头：{{ project.playhead.toFixed(3) }}s</div>
          <div>总时长：{{ duration.toFixed(2) }}s</div>
          <div>场景：{{ project.scenes.length }} · 当前：{{ scene?.name }}</div>
          <div>媒体：{{ project.media?.length || 0 }} 个 · 音量/屏蔽等均随工程保存</div>
        </div>
        <div class="text-[10px] text-slate-500 leading-relaxed border-t border-studio-800 pt-2">
          快捷键：Ctrl/Cmd+B 或 S 切分；N 磁吸；Shift+Delete 波纹删除；Del 删除/闭合间隙；Space 播放；←/→ 逐帧。
        </div>
      </div>
    </template>
  </aside>
</template>

<script setup>
import { computed } from 'vue';
import StudioIcon from '../StudioIcon.vue';
import {
  addClipEffect, addMask, addKeyframe, changeKeyframeInterpolation,
  clearKeyframes, clearSelection, closeGap, copySelectedKeyframes, deleteKeyframe,
  duration, mediaById, pasteSelectedKeyframes, removeClipEffect,
  removeMask, scene, selectMask, selectedClip, selectedClipTrack, selectedMask,
  separateAudio, recoverAudio, setCanvas, setClipEffectAmount, setClipSpeed, setFps, state,
  toggleKeyframe, toggleKeyframeSelection, updateKeyframeTime, updateKeyframeValue,
  updateMaskField, updateTransform,
} from '../../editor/store.js';
import { ANIMATABLE, resolveTransform } from '../../editor/keyframes.js';

const clip = selectedClip;
const media = computed(() => (clip.value?.mediaId ? mediaById(state.project, clip.value.mediaId) : null));
const project = computed(() => state.project);
const transform = computed(() => (clip.value ? resolveTransform(clip.value, Math.max(0, state.currentTime - clip.value.start)) : {}));
const keyframeGroups = computed(() => {
  if (!clip.value) return [];
  return Object.entries(clip.value.keyframes || {})
    .filter(([, keys]) => keys?.length)
    .map(([prop, keys]) => ({ prop, keys: [...keys].sort((a, b) => a.time - b.time) }));
});
const typeBadge = computed(() => {
  const map = { video: 'bg-blue-500/20 text-blue-300', image: 'bg-indigo-500/20 text-indigo-300', text: 'bg-amber-500/20 text-amber-300', audio: 'bg-emerald-500/20 text-emerald-300', sticker: 'bg-violet-500/20 text-violet-300', graphic: 'bg-violet-500/20 text-violet-300', effect: 'bg-cyan-500/20 text-cyan-300' };
  return map[clip.value?.type] || 'bg-studio-800 text-slate-300';
});

function formatVal(key, v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(key === 'rotation' ? 0 : 1);
}
function labelOf(prop) {
  return ANIMATABLE.find((p) => p.key === prop)?.label || prop;
}
function hasKeyAt(prop) {
  if (!clip.value) return false;
  const rel = Math.max(0, state.currentTime - clip.value.start);
  return (clip.value.keyframes?.[prop] || []).some((k) => Math.abs(k.time - rel) < 0.02);
}
function onTransformInput(prop, value) {
  updateTransform(prop, Number(value));
}
function isKeySelected(prop, id) {
  return state.selectedKeyframes.some((s) => s.prop === prop && s.keyId === id);
}
function maskLabel(type) {
  return { rectangle: '矩形遮罩', ellipse: '椭圆遮罩', path: '贝塞尔路径遮罩' }[type] || type;
}
function trackName(trackId) {
  return scene.value?.tracks.find((t) => t.id === trackId)?.name || trackId;
}
function toggleSourceAudio() {
  if (!clip.value) return;
  if (clip.value.sourceAudioEnabled === false) recoverAudio();
  else separateAudio();
}
</script>

<style scoped>
.custom-scroll::-webkit-scrollbar { width: 7px; }
.key-diamond {
  color: var(--theme-text-muted);
  font-size: 10px;
  cursor: pointer;
  line-height: 1;
}
.key-diamond.is-on { color: var(--theme-accent-secondary); }
.mini-btn {
  padding: 1px 7px;
  border-radius: 6px;
  border: 1px solid var(--theme-border);
  color: var(--theme-text-secondary);
  font-size: 10px;
  cursor: pointer;
}
.mini-btn:hover { background: var(--theme-bg-hover); }
.mini-btn.is-on { background: var(--theme-accent-primary); color: var(--theme-accent-text); }
</style>
