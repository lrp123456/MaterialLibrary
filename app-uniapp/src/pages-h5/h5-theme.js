/**
 * Web 桌面壳令牌（与 src/common/theme.js 同源）
 */
export const H5 = {
  primary: '#2563EB',
  primaryDeep: '#1D4ED8',
  primarySoft: '#EFF6FF',
  primaryBorder: '#BFDBFE',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  muted: '#F1F5F9',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  text: '#0F172A',
  text2: '#64748B',
  text3: '#94A3B8',
  ok: '#059669',
  err: '#DC2626',
  warn: '#D97706',
  sidebar: '240px',
  radiusCard: '12px',
  radiusField: '10px',
  radiusChip: '999px',
  font: "Inter, 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif",
}

export const H5_CSS = `
.h5-page{min-height:100vh;background:${H5.bg};color:${H5.text};font-family:${H5.font};}
.h5-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;border-radius:10px;border:1px solid transparent;font-size:14px;font-weight:500;cursor:pointer;transition:.15s;}
.h5-btn.primary{background:${H5.primary};color:#fff;}
.h5-btn.primary:hover{background:${H5.primaryDeep};}
.h5-btn.primary:disabled{opacity:.55;cursor:not-allowed;}
.h5-btn.ghost{background:${H5.surface};border-color:${H5.border};color:${H5.text};}
.h5-btn.ghost:hover{background:${H5.muted};border-color:${H5.borderStrong};}
.h5-input{height:40px;width:100%;padding:0 12px;border:1px solid ${H5.border};border-radius:10px;background:${H5.surface};color:${H5.text};font-size:14px;outline:none;}
.h5-input:focus{border-color:${H5.primary};box-shadow:0 0 0 3px rgba(37,99,235,.15);}
.h5-chip{display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:${H5.radiusChip};background:${H5.muted};color:${H5.text2};font-size:12px;cursor:pointer;border:1px solid transparent;}
.h5-chip.on{background:${H5.primarySoft};color:${H5.primary};border-color:${H5.primaryBorder};}
.h5-card{background:${H5.surface};border:1px solid ${H5.border};border-radius:${H5.radiusCard};}
.h5-muted{color:${H5.text2};}
.h5-label{font-size:12px;color:${H5.text2};margin-bottom:6px;display:block;}
`
