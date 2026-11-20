/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        studio: {
          950: 'rgb(var(--studio-950-rgb, 10 14 23) / <alpha-value>)', // 深邃午夜主底色 (Layer 0: Canvas)
          900: 'rgb(var(--studio-900-rgb, 19 26 41) / <alpha-value>)', // 主容器/顶栏/侧栏底色 (Layer 1: Containers)
          850: 'rgb(var(--studio-850-rgb, 24 34 54) / <alpha-value>)', // 卡片/输入槽底色 (Layer 2: Raised Surfaces)
          800: 'rgb(var(--studio-800-rgb, 33 46 71) / <alpha-value>)', // 悬浮卡片/交互按键高亮底 (Layer 3: Highlight Surface)
          750: 'rgb(var(--studio-750-rgb, 39 53 77) / <alpha-value>)', // 次级明显分割线 (Layer 4)
          700: 'rgb(var(--studio-700-rgb, 51 65 85) / <alpha-value>)', // 坚实清晰的 1px 实线边框 (Solid Borders)
          600: 'rgb(var(--studio-600-rgb, 71 85 105) / <alpha-value>)', // 高亮边框与次级图标
          500: 'rgb(var(--studio-500-rgb, 100 116 139) / <alpha-value>)', // 次要描述与辅助说明
          accent: 'rgb(var(--studio-accent-rgb, 99 102 241) / <alpha-value>)', // 核心主高亮色 (Primary Accent)
          cyan: 'rgb(var(--studio-cyan-rgb, 6 182 212) / <alpha-value>)',   // 电光青 (@ 引用胶囊与特效)
          indigo: 'rgb(var(--studio-indigo-rgb, 99 102 241) / <alpha-value>)', // 高级靛紫 (AI 辅助模式)
          emerald: 'rgb(var(--studio-emerald-rgb, 16 185 129) / <alpha-value>)',// 状态翡翠绿 (就绪与通过)
          rose: 'rgb(var(--studio-rose-rgb, 244 63 94) / <alpha-value>)',   // 警告珊瑚红
          amber: 'rgb(var(--studio-amber-rgb, 245 158 11) / <alpha-value>)',  // 警示金黄
        },
        slate: {
          50: 'rgb(var(--slate-50-rgb, 248 250 252) / <alpha-value>)',
          100: 'rgb(var(--slate-100-rgb, 241 245 249) / <alpha-value>)',
          200: 'rgb(var(--slate-200-rgb, 226 232 240) / <alpha-value>)',
          300: 'rgb(var(--slate-300-rgb, 203 213 225) / <alpha-value>)',
          400: 'rgb(var(--slate-400-rgb, 148 163 184) / <alpha-value>)',
          500: 'rgb(var(--slate-500-rgb, 100 116 139) / <alpha-value>)',
          600: 'rgb(var(--slate-600-rgb, 71 85 105) / <alpha-value>)',
          700: 'rgb(var(--slate-700-rgb, 51 65 85) / <alpha-value>)',
          800: 'rgb(var(--slate-800-rgb, 30 41 59) / <alpha-value>)',
          900: 'rgb(var(--slate-900-rgb, 15 23 42) / <alpha-value>)',
          950: 'rgb(var(--slate-950-rgb, 2 6 23) / <alpha-value>)',
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace']
      }
    },
  },
  plugins: [],
}
