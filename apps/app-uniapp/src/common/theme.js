/**
 * App 设计令牌（原型 app-final-prototype.html 冻结基线）。
 *
 * 浅色两种主题：warm（暖色/护眼，默认）与 cool（冷灰）。
 * 完整深色主题本轮延后（用户已确认），此处仅保留结构，不对外暴露 dark。
 *
 * 页面消费方式：根节点绑定 `:style="themeStyle"` 注入 CSS 变量，
 * 子样式用 var(--bg)/var(--surface)/var(--ink) 等取色；动效统一走 var(--ease-*)。
 * 逻辑 px 直接写（uni-app vue 页面为 webview，逻辑像素即 CSS px），不再写 rpx。
 */
import { reactive } from 'vue'

export const PALETTES = {
  warm: {
    bg: '#F2EEE6',
    surface: '#FFFFFF',
    surface2: '#FAF7F0',
    ink: '#1E1B16',
    ink2: '#7A7263',
    line: 'rgba(30,27,22,0.10)',
    accent: '#0A6CFF',
    accentSoft: '#E8F0FF',
    accentBorder: '#BFD6FF',
    danger: '#D24545',
    ok: '#2E9E6B',
    warn: '#C98A2B',
    overlay: 'rgba(18,14,9,0.44)',
    glassBg: 'rgba(250,247,240,0.94)',
  },
  cool: {
    bg: '#F1F4F8',
    surface: '#FFFFFF',
    surface2: '#F7F9FC',
    ink: '#191D26',
    ink2: '#68738A',
    line: 'rgba(25,29,38,0.10)',
    accent: '#0A6CFF',
    accentSoft: '#E8F0FF',
    accentBorder: '#BFD6FF',
    danger: '#D24545',
    ok: '#2E9E6B',
    warn: '#C98A2B',
    overlay: 'rgba(20,24,32,0.44)',
    glassBg: 'rgba(255,255,255,0.94)',
  },
}

export const THEME_KEYS = Object.keys(PALETTES)
export const DEFAULT_THEME = 'warm'

/** 动效 token：时长(ms) 与三条曲线，UI 统一引用，禁止各自写死 */
export const MOTION = {
  ms: 220,
  fast: 140,
  base: 220,
  slow: 320,
  easeOut: 'cubic-bezier(.23,1,.32,1)',
  easeInOut: 'cubic-bezier(.77,0,.175,1)',
  easeDrawer: 'cubic-bezier(.32,.72,0,1)',
}

export const RADIUS = {
  topbar: '30px',
  card: '12px',
  sheet: '24px',
  pill: '999px',
}

export const SPACE = {
  pageX: '16px',
  island: '16px',
  waterfall: '8px',
}

export const GLASS = { opacity: 40, blur: '0px' }

const STORAGE_KEY = 'app_theme'

function readStored() {
  try {
    if (typeof uni === 'undefined') return DEFAULT_THEME
    const v = uni.getStorageSync(STORAGE_KEY)
    return PALETTES[v] ? v : DEFAULT_THEME
  } catch (e) {
    return DEFAULT_THEME
  }
}

/** 全局响应式主题名；跨页面共享，切换即触发所有绑定 themeStyle 的页面重着色 */
export const themeState = reactive({ name: readStored() })

export function setTheme(name) {
  if (!PALETTES[name]) return
  themeState.name = name
  try {
    if (typeof uni !== 'undefined') uni.setStorageSync(STORAGE_KEY, name)
  } catch (e) {}
}

export function cycleTheme() {
  const i = THEME_KEYS.indexOf(themeState.name)
  setTheme(THEME_KEYS[(i + 1) % THEME_KEYS.length])
}

/** 生成一份可直接绑定到根节点 :style 的 CSS 变量对象 */
export function cssVars(name = themeState.name) {
  const p = PALETTES[name] || PALETTES[DEFAULT_THEME]
  return {
    '--bg': p.bg,
    '--surface': p.surface,
    '--surface2': p.surface2,
    '--ink': p.ink,
    '--ink2': p.ink2,
    '--line': p.line,
    '--accent': p.accent,
    '--accent-soft': p.accentSoft,
    '--accent-border': p.accentBorder,
    '--danger': p.danger,
    '--ok': p.ok,
    '--warn': p.warn,
    '--overlay': p.overlay,
    '--glass-bg': p.glassBg,
    '--cardr': RADIUS.card,
    '--topr': RADIUS.topbar,
    '--gap': SPACE.waterfall,
    '--glass': String(GLASS.opacity),
    '--blur': GLASS.blur,
    '--ms': `${MOTION.ms}ms`,
    '--ease-out': MOTION.easeOut,
    '--ease-io': MOTION.easeInOut,
    '--ease-drawer': MOTION.easeDrawer,
  }
}

/** 当前主题的 CSS 变量对象（读 themeState.name，供 :style 绑定） */
export function currentVars() {
  return cssVars(themeState.name)
}

// ── 兼容旧导出（历史遗留，无消费者；保留以免隐式引用报错）──
export const C = PALETTES.warm
export const R = RADIUS
export const S = SPACE
