<template>
  <div v-if="visible" class="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4">
    <div class="bg-surface-low border border-outline-variant rounded-2xl max-w-sm w-full p-6 shadow-card space-y-5">
      <div class="flex flex-col items-center text-center gap-3">
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2563EB] to-[#60A5FA] flex items-center justify-center text-white font-bold text-xl shadow-[0_12px_28px_rgba(37,99,235,.4)]">
          M
        </div>
        <div>
          <p class="text-[10px] tracking-[0.2em] text-on-surface-variant font-semibold uppercase">Material Library</p>
          <h2 class="text-base font-bold text-white mt-1">登录素材库工作台</h2>
          <p class="text-[11px] text-on-surface-variant mt-1">管理员可进入画布与治理，检索员仅浏览下载</p>
        </div>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-3">
        <div>
          <label class="block text-[11px] text-on-surface-variant mb-1.5 font-medium">用户名</label>
          <input
            v-model="username"
            type="text"
            required
            placeholder="请输入用户名"
            class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2.5 text-xs text-white placeholder:text-outline outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
          />
        </div>

        <div>
          <label class="block text-[11px] text-on-surface-variant mb-1.5 font-medium">密码</label>
          <input
            v-model="password"
            type="password"
            required
            placeholder="请输入登录密码"
            class="w-full bg-surface border border-outline-variant rounded-xl px-3 py-2.5 text-xs text-white placeholder:text-outline outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
          />
        </div>

        <p v-if="error" class="text-[11px] text-error bg-error/10 border border-error/20 rounded-lg px-2.5 py-2">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-3 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary/90 transition disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-[0_8px_20px_rgba(59,130,246,.3)]"
        >
          <span v-if="loading" class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
          <span>{{ loading ? '登录中…' : '立即登录' }}</span>
        </button>

        <div class="pt-3 border-t border-outline-variant text-[10px] text-outline text-center space-y-1">
          <p>使用管理员发放的账号登录</p>
          <p>仅上传元数据与衍生图，不外泄原始工程文件</p>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { api, setToken, setCurrentUser } from '../api'

const props = defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['login-success', 'update:visible'])

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    const res = await api.login(username.value.trim(), password.value)
    setToken(res.token)
    setCurrentUser(res.user)
    emit('login-success', res.user)
  } catch (e) {
    error.value = e.message || '登录失败，请检查账号密码'
  } finally {
    loading.value = false
  }
}
</script>
