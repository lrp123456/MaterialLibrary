<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 font-sans"
    @click.self="$emit('update:visible', false)"
  >
    <div class="bg-studio-900 border border-studio-700 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-5">
      <div class="flex flex-col items-center text-center gap-3">
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center text-white font-bold text-xl shadow-lg">
          M
        </div>
        <div>
          <p class="text-[10px] tracking-[0.2em] text-slate-400 font-semibold uppercase">Material Studio Pro</p>
          <h2 class="text-base font-bold text-white mt-1">登录素材工作台</h2>
          <p class="text-[11px] text-slate-400 mt-1">管理员可进入全部板块，检索员仅浏览下载</p>
        </div>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-3">
        <div>
          <label class="block text-[11px] text-slate-400 mb-1.5 font-semibold">用户名</label>
          <input
            v-model="username"
            type="text"
            required
            autocomplete="username"
            placeholder="请输入用户名"
            class="w-full bg-studio-950 border border-studio-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder:text-slate-600 outline-none focus:border-studio-accent focus:ring-2 focus:ring-studio-accent/20 transition"
          />
        </div>

        <div>
          <label class="block text-[11px] text-slate-400 mb-1.5 font-semibold">密码</label>
          <input
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            placeholder="请输入登录密码"
            class="w-full bg-studio-950 border border-studio-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder:text-slate-600 outline-none focus:border-studio-accent focus:ring-2 focus:ring-studio-accent/20 transition"
          />
        </div>

        <p v-if="error" class="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-2">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-3 bg-studio-accent text-white rounded-xl text-xs font-bold hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg"
        >
          <span v-if="loading" class="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
          <span>{{ loading ? '登录中…' : '立即登录' }}</span>
        </button>

        <div class="pt-3 border-t border-studio-700 text-[10px] text-slate-500 text-center space-y-1">
          <p>局域网 / 公网访问需使用管理员发放的账号登录</p>
          <p>会话保存在本浏览器中，30 天有效</p>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { login } from '../api.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['login-success', 'update:visible']);

const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

watch(() => props.visible, (v) => {
  if (v) { error.value = ''; }
});

async function handleLogin() {
  error.value = '';
  loading.value = true;
  try {
    const { user } = await login(username.value.trim(), password.value);
    emit('login-success', user);
    emit('update:visible', false);
    password.value = '';
  } catch (e) {
    error.value = e?.message || '登录失败，请检查账号密码';
  } finally {
    loading.value = false;
  }
}
</script>
