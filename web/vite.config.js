import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'DSH 素材库', short_name: '素材库',
        display: 'standalone', theme_color: '#10141a', background_color: '#0d1117',
        icons: []
      }
    })
  ],
  server: { port: 5180, proxy: { '/api': 'http://127.0.0.1:8787' } }
})
