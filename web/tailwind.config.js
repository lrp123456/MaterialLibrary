/** Atelier Curate 暗色 — 对齐 stitch-designs/DESIGN.md 与 pc-*.html */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // page / surfaces
        canvas: '#0B1220',
        surface: {
          DEFAULT: '#0F172A',
          low: '#111827',
          high: '#1E293B',
          bright: '#334155',
        },
        outline: {
          DEFAULT: '#475569',
          variant: '#1E293B',
        },
        primary: {
          DEFAULT: '#3B82F6',
          dim: '#93C5FD',
          container: '#1E3A8A',
        },
        cyan: { DEFAULT: '#22D3EE' },
        teal: { DEFAULT: '#2DD4BF' },
        violet: { DEFAULT: '#A78BFA', dim: '#C4B5FD' },
        tertiary: { DEFAULT: '#2DD4BF', container: '#134E4A' },
        error: { DEFAULT: '#F87171', container: '#7F1D1D' },
        warn: { DEFAULT: '#FBBF24' },
        ok: { DEFAULT: '#34D399' },
        'on-surface': {
          DEFAULT: '#E2E8F0',
          variant: '#94A3B8',
        },
      },
      borderRadius: {
        xl: '12px',
        '2xl': '14px',
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'Microsoft YaHei', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 0 0 1px #1E293B, 0 8px 24px rgba(0,0,0,.35)',
      },
    },
  },
}
