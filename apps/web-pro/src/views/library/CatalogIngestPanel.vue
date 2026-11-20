<template>
  <div v-if="visible" class="catalog-ingest-panel-root fixed inset-0 z-50 bg-studio-950/85 backdrop-blur-md flex items-center justify-center p-6 font-sans">
    <div class="max-w-2xl w-full bg-studio-900 border border-studio-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      <!-- 头部 -->
      <header class="h-14 px-6 border-b border-studio-800 flex items-center justify-between shrink-0">
        <h3 class="text-sm font-bold text-white font-mono flex items-center gap-2">
          <StudioIcon name="upload" :size="16" class="text-studio-accent" />
          <span>素材高速入库与智能吸收 (Fail-Open)</span>
        </h3>
        <button type="button" class="text-slate-400 hover:text-white" @click="$emit('close')">&times;</button>
      </header>

      <!-- 主上传区 -->
      <main class="p-6 space-y-5">
        <div class="border-2 border-dashed border-studio-700 hover:border-studio-accent rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-studio-950/60">
          <StudioIcon name="upload" :size="32" class="text-slate-500 mb-3" />
          <p class="text-sm font-bold text-slate-200">点击选择或拖拽素材文件至此</p>
          <p class="text-xs text-slate-400 mt-1 font-mono">支持 JPG、PNG、WebP、MP4、MOV、3D GLB/OBJ 单品</p>
          <input type="file" multiple class="hidden" ref="fileInputRef" @change="handleFileSelected" />
        </div>

        <div class="p-3.5 rounded-xl bg-studio-950 border border-studio-800 text-xs text-slate-400 space-y-1 font-mono">
          <div class="text-studio-cyan font-bold">● Fail-Open 极速入库原则：</div>
          <p class="leading-relaxed">
            Web 上传、工坊保存与手动入库素材瞬时置为可见 (visibility='visible')，异步后台执行 Grid WebP 生成与 VLM 智能打标，零门禁阻塞。
          </p>
        </div>

        <div v-if="uploading" class="space-y-1.5">
          <div class="flex justify-between text-xs font-mono text-slate-300">
            <span>正在吸收素材…</span>
            <span>{{ uploadProgress }}%</span>
          </div>
          <div class="w-full h-1.5 bg-studio-950 rounded-full overflow-hidden">
            <div class="h-full bg-studio-accent transition-all duration-200" :style="{ width: `${uploadProgress}%` }"></div>
          </div>
        </div>
      </main>

      <!-- 底部操作按钮 -->
      <footer class="h-14 px-6 border-t border-studio-800 bg-studio-950 flex items-center justify-end gap-3 shrink-0">
        <button type="button" class="px-4 py-2 rounded-xl bg-studio-800 text-slate-300 text-xs font-bold" @click="$emit('close')">
          取消
        </button>
        <button
          type="button"
          :disabled="uploading"
          class="px-5 py-2 rounded-xl bg-studio-accent text-white text-xs font-bold font-mono hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all shadow"
          @click="startUpload"
        >
          {{ uploading ? '上传中…' : '开始入库' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  visible: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'ingest-success']);

const uploading = ref(false);
const uploadProgress = ref(0);
const fileInputRef = ref(null);

function handleFileSelected(e) {
  const files = e.target.files;
  if (files && files.length) {
    startUpload();
  }
}

async function startUpload() {
  uploading.value = true;
  uploadProgress.value = 30;
  setTimeout(() => {
    uploadProgress.value = 80;
    setTimeout(() => {
      uploadProgress.value = 100;
      uploading.value = false;
      emit('ingest-success');
      emit('close');
    }, 300);
  }, 300);
}
</script>
