import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({
  plugins: [uni()],
  server: {
    // 30002 已被 web-pro 静态服务占用，App 的 H5 dev 固定走 30003
    port: Number(process.env.WEB_H5_PORT) || 30003,
    host: true,
    strictPort: true,
  },
})
