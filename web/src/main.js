import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import './style.css'
import App from './App.vue'
import { getCurrentUser } from './api'

import RunsView from './views/RunsView.vue'
import ModelsView from './views/ModelsView.vue'
import LabView from './views/LabView.vue'
import SettingsView from './views/SettingsView.vue'
import AppOnlyView from './views/AppOnlyView.vue'
import PortraitLibraryView from './views/PortraitLibraryView.vue'

const routes = [
  {
    path: '/',
    redirect: () => {
      const user = getCurrentUser()
      if (user && user.role === 'admin') return '/models'
      return '/app-only'
    }
  },
  { path: '/app-only', component: AppOnlyView },
  { path: '/runs', component: RunsView, meta: { requiresAdmin: true } },
  { path: '/workflow', redirect: (to) => ({ path: '/runs', query: { ...to.query, tab: 'inspect' } }) },
  { path: '/models', component: ModelsView, meta: { requiresAdmin: true } },
  { path: '/ai-apps', redirect: '/models' },
  { path: '/adapters', redirect: '/models' },
  { path: '/lab', component: LabView, meta: { requiresAdmin: true } },
  { path: '/settings', component: SettingsView, meta: { requiresAdmin: true } },
  { path: '/portraits', component: PortraitLibraryView, meta: { requiresAdmin: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const user = getCurrentUser()
  const isAdmin = user && user.role === 'admin'

  // 管理员访问 app-only 时重定向回 AI 治理中心
  if (to.path === '/app-only' && isAdmin) {
    return next('/models')
  }

  // 非管理员（检索员/未登录）访问管理路由时重定向至 app-only
  if (to.meta?.requiresAdmin && !isAdmin) {
    return next('/app-only')
  }

  next()
})

createApp(App).use(router).mount('#app')
