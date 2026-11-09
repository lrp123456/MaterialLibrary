<template>
  <div class="min-h-screen bg-canvas text-white flex flex-col md:flex-row font-sans select-none">
    <!-- 桌面侧栏 · Atelier Console (已移除旧版分散入口，批次与视频巡检合入 /runs，词典合入 /models) -->
    <aside class="hidden md:flex w-60 flex-none flex-col border-r border-outline-variant bg-surface sticky top-0 h-screen">
      <div class="flex items-center gap-2.5 px-4 py-4 border-b border-outline-variant cursor-pointer" @click="$router.push('/')">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2563EB] to-[#60A5FA] flex items-center justify-center text-white font-bold text-sm shadow-[0_8px_20px_rgba(37,99,235,.35)]">
          M
        </div>
        <div class="min-w-0">
          <h1 class="text-sm font-bold tracking-tight text-white truncate">室内设计素材库</h1>
          <p class="text-[10px] text-on-surface-variant truncate">Material Library Console</p>
        </div>
      </div>

      <nav class="flex-1 flex flex-col gap-1 p-3 text-xs overflow-y-auto">
        <template v-if="isAdmin">
          <router-link
            to="/models"
            class="px-3 py-2.5 rounded-xl flex items-center gap-2.5 transition font-medium"
            :class="navClass('/models')"
          >
            <span class="material-symbols-outlined text-lg">smart_toy</span>
            <span>AI 治理中心</span>
            <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary-dim font-semibold">核心</span>
          </router-link>

          <router-link
            to="/dictionary"
            class="px-3 py-2.5 rounded-xl flex items-center gap-2.5 transition font-medium"
            :class="navClass('/dictionary')"
          >
            <span class="material-symbols-outlined text-lg">label</span>
            <span>标签字典</span>
            <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-surface-high text-on-surface-variant font-mono">Dict</span>
          </router-link>

          <router-link
            to="/runs"
            class="px-3 py-2.5 rounded-xl flex items-center gap-2.5 transition font-medium"
            :class="navClass('/runs')"
          >
            <span class="material-symbols-outlined text-lg">timeline</span>
            <span>运行与巡检</span>
            <span class="ml-auto w-1.5 h-1.5 rounded-full bg-ok"></span>
          </router-link>

          <router-link
            to="/lab"
            class="px-3 py-2.5 rounded-xl flex items-center gap-2.5 transition font-medium"
            :class="navClass('/lab')"
          >
            <span class="material-symbols-outlined text-lg">science</span>
            <span>AI 试验场</span>
          </router-link>

          <router-link
            to="/portraits"
            class="px-3 py-2.5 rounded-xl flex items-center gap-2.5 transition font-medium"
            :class="navClass('/portraits')"
          >
            <span class="material-symbols-outlined text-lg">face</span>
            <span>人像库</span>
          </router-link>

          <router-link
            to="/settings"
            class="px-3 py-2.5 rounded-xl flex items-center gap-2.5 transition font-medium"
            :class="navClass('/settings')"
          >
            <span class="material-symbols-outlined text-lg">settings</span>
            <span>系统设置</span>
          </router-link>

          <router-link
            to="/service-hub"
            class="px-3 py-2.5 rounded-xl flex items-center gap-2.5 transition font-medium"
            :class="navClass('/service-hub')"
          >
            <span class="material-symbols-outlined text-lg">dns</span>
            <span>服务总控 (3790)</span>
            <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-surface-high text-on-surface-variant font-mono">Hub</span>
          </router-link>
        </template>
      </nav>

      <div class="m-3 p-3 rounded-xl bg-surface-low border border-outline-variant">
        <div class="flex items-center gap-2 text-xs font-semibold">
          <span class="w-2 h-2 rounded-full bg-ok shadow-[0_0_0_3px_rgba(52,211,153,.2)]"></span>
          <span>服务器在线</span>
        </div>
        <p class="mt-1.5 text-[11px] text-on-surface-variant leading-relaxed">
          索引与流水线就绪<br />
          <span class="font-mono text-outline">localhost:30001</span>
        </p>
      </div>
    </aside>

    <!-- 主栏 -->
    <div class="flex-1 min-w-0 flex flex-col">
      <!-- 顶栏 -->
      <header class="h-14 px-3 sm:px-5 border-b border-outline-variant bg-surface/90 backdrop-blur-md sticky top-0 z-40 flex items-center justify-between gap-2">
        <div class="flex md:hidden items-center gap-2.5 cursor-pointer min-w-0" @click="$router.push('/')">
          <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-[#2563EB] to-[#60A5FA] flex items-center justify-center text-white font-bold text-sm flex-none">
            M
          </div>
          <h1 class="text-xs font-bold tracking-tight text-white truncate">室内设计素材库</h1>
        </div>

        <div class="hidden md:flex items-center gap-2 min-w-0">
          <span class="text-sm font-bold text-white">{{ routeTitle }}</span>
          <span class="text-[11px] text-on-surface-variant truncate">{{ routeSubtitle }}</span>
        </div>

        <div class="flex items-center gap-2 text-xs ml-auto">
          <template v-if="currentUser">
            <div class="flex items-center gap-1.5 bg-surface-low px-2.5 py-1.5 rounded-xl border border-outline-variant">
              <span class="w-6 h-6 rounded-lg bg-gradient-to-br from-primary to-cyan flex items-center justify-center text-[10px] font-bold text-canvas">
                {{ (currentUser.username || 'U').slice(0, 1).toUpperCase() }}
              </span>
              <span class="hidden sm:inline text-[11px] text-white font-medium max-w-[100px] truncate">{{ currentUser.username }}</span>
              <span class="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary-dim border border-primary/20">
                {{ isAdmin ? '管理员' : '检索员' }}
              </span>
            </div>

            <button
              @click="handleLogout"
              class="p-2 rounded-xl hover:bg-surface-high text-on-surface-variant hover:text-white transition"
              title="退出登录"
            >
              <span class="material-symbols-outlined text-base">logout</span>
            </button>
          </template>

          <button
            v-else
            @click="showLoginModal = true"
            class="px-3.5 py-1.5 bg-primary text-white rounded-xl font-semibold hover:bg-primary/90 transition text-xs shadow-[0_6px_16px_rgba(59,130,246,.28)]"
          >
            登录
          </button>
        </div>
      </header>

      <main class="flex-1 pb-16 md:pb-0">
        <router-view />
      </main>
    </div>

    <!-- 移动端底栏 -->
    <nav v-if="isAdmin" class="md:hidden fixed bottom-0 inset-x-0 h-14 bg-surface/95 backdrop-blur-md border-t border-outline-variant flex items-center justify-around z-40 text-[10px]">
      <template v-if="isAdmin">
        <router-link
          to="/models"
          class="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg"
          :class="$route.path === '/models' ? 'text-primary' : 'text-on-surface-variant'"
        >
          <span class="material-symbols-outlined text-xl">smart_toy</span>
          <span>治理</span>
        </router-link>

        <router-link
          to="/runs"
          class="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg"
          :class="$route.path === '/runs' ? 'text-primary' : 'text-on-surface-variant'"
        >
          <span class="material-symbols-outlined text-xl">timeline</span>
          <span>运行巡检</span>
        </router-link>

        <router-link
          to="/lab"
          class="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg"
          :class="$route.path === '/lab' ? 'text-primary' : 'text-on-surface-variant'"
        >
          <span class="material-symbols-outlined text-xl">science</span>
          <span>试验</span>
        </router-link>

        <router-link
          to="/portraits"
          class="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg"
          :class="$route.path === '/portraits' ? 'text-primary' : 'text-on-surface-variant'"
        >
          <span class="material-symbols-outlined text-xl">face</span>
          <span>人像</span>
        </router-link>

        <router-link
          to="/settings"
          class="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg"
          :class="$route.path === '/settings' ? 'text-primary' : 'text-on-surface-variant'"
        >
          <span class="material-symbols-outlined text-xl">settings</span>
          <span>设置</span>
        </router-link>
      </template>
    </nav>

    <LoginModal
      :visible="showLoginModal"
      @login-success="onLoginSuccess"
      @update:visible="showLoginModal = $event"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { api, getCurrentUser, setCurrentUser, setToken } from './api'
import LoginModal from './components/LoginModal.vue'

const router = useRouter()
const route = useRoute()
const currentUser = ref(getCurrentUser())
const showLoginModal = ref(false)

const isAdmin = computed(() => currentUser.value?.role === 'admin')

const routeMeta = {
  '/app-only': { title: '控制台说明', sub: '客户端专属服务' },
  '/runs': { title: '运行、异常与视频巡检', sub: '任务队列 · 失败重试 · 批次画布与视频抽检' },
  '/models': { title: 'AI 统一治理中心', sub: '供应商池 · 模型三开关与优化器 · 提示词与公共积木 · 动态词典 · 工作流节点编排' },
  '/lab': { title: 'AI 试验场', sub: '能力目录 · 扩图增删改 · 生图生视频' },
  '/settings': { title: '系统设置', sub: '账号权限 · 运行参数 · 备份与快照同步' },
  '/portraits': { title: '人像库', sub: '本地与火山私域人像 · 角标标出素材在哪' },
}
const routeTitle = computed(() => routeMeta[route.path]?.title || '素材库')
const routeSubtitle = computed(() => routeMeta[route.path]?.sub || '')

function navClass(path) {
  return route.path === path
    ? 'bg-primary/15 text-white shadow-[inset_0_0_0_1px_rgba(59,130,246,.35)]'
    : 'text-on-surface-variant hover:bg-surface-high hover:text-white'
}

function onLoginSuccess(user) {
  currentUser.value = user
  showLoginModal.value = false
  window.location.reload()
}

async function handleLogout() {
  try { await api.logout() } catch {}
  setToken(null)
  setCurrentUser(null)
  currentUser.value = null
  showLoginModal.value = true
  router.push('/')
}

onMounted(async () => {
  window.addEventListener('ml_auth_required', () => {
    showLoginModal.value = true
  })

  try {
    const u = await api.me()
    if (u) {
      currentUser.value = u
      setCurrentUser(u)
    }
  } catch {
    if (!currentUser.value) {
      showLoginModal.value = true
    }
  }
})
</script>
