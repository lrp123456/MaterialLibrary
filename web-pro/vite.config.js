import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 30002,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:30001',
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
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
