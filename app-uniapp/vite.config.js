import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({
  plugins: [uni()],
  server: {
    // 默认 30002（与 service-hub / launch-web 一致）；可用 WEB_H5_PORT 或 uni --port 覆盖
    port: Number(process.env.WEB_H5_PORT) || 30002,
    host: true,
    strictPort: true,
  },
})
