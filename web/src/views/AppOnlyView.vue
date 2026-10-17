<template>
  <div class="min-h-[80vh] flex items-center justify-center p-4">
    <div class="max-w-md w-full bg-surface-low border border-outline-variant rounded-3xl p-8 text-center space-y-6 shadow-2xl">
      <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#2563EB] to-[#60A5FA] flex items-center justify-center text-white text-2xl font-bold mx-auto shadow-[0_8px_24px_rgba(37,99,235,.35)]">
        M
      </div>

      <div class="space-y-2">
        <h1 class="text-xl font-bold text-white tracking-tight">室内设计素材库</h1>
        <p class="text-xs text-on-surface-variant leading-relaxed">
          控制台素材检索已收口至专用移动客户端
        </p>
      </div>

      <div class="bg-surface border border-outline-variant rounded-2xl p-5 space-y-3 text-left">
        <div class="flex items-center gap-2 text-primary text-xs font-semibold">
          <span class="material-symbols-outlined text-base">smartphone</span>
          <span>请使用 App</span>
        </div>
        <p class="text-[12px] text-on-surface leading-relaxed">
          素材检索、分类筛选、灵感发现与下载功能请通过移动端 App 进行访问。
        </p>
        <div class="pt-2 border-t border-outline-variant/60 flex items-center justify-between text-[11px] text-outline">
          <span>当前身份: {{ currentUser?.username || '检索员' }}</span>
          <span class="px-2 py-0.5 rounded bg-primary/10 text-primary-dim border border-primary/20">Viewer</span>
        </div>
      </div>

      <div class="pt-2 flex justify-center">
        <button
          type="button"
          @click="handleLogout"
          class="px-5 py-2 rounded-xl bg-surface border border-outline-variant hover:bg-surface-high text-xs text-on-surface hover:text-white transition flex items-center gap-1.5"
        >
          <span class="material-symbols-outlined text-sm">logout</span>
          <span>退出登录</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { api, getCurrentUser, setCurrentUser, setToken } from '../api'

const router = useRouter()
const currentUser = computed(() => getCurrentUser())

async function handleLogout() {
  try { await api.logout() } catch {}
  setToken(null)
  setCurrentUser(null)
  window.location.reload()
}
</script>
