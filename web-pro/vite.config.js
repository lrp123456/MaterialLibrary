import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    port: 30002,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:30001',
        changeOrigin: true,
        ws: true,
      },
      '/editor-api': {
        target: 'http://127.0.0.1:30001',
        changeOrigin: true,
        ws: true,
      },
      // 顺序敏感：必须排在 /editor-api 之后。Vite 按插入顺序匹配第一个前缀，
      // 若 /editor 在前，/editor-api 的请求会被错误地转发到 Next。
      '/editor': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
        ws: true,
      }
    }
  },
  preview: {
    port: 30002,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:30001',
        changeOrigin: true,
        ws: true,
      },
      '/editor-api': {
        target: 'http://127.0.0.1:30001',
        changeOrigin: true,
        ws: true,
      },
      // 顺序敏感：必须排在 /editor-api 之后。Vite 按插入顺序匹配第一个前缀，
      // 若 /editor 在前，/editor-api 的请求会被错误地转发到 Next。
      '/editor': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
        ws: true,
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
