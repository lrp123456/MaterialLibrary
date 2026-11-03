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
  },
  build: {
    rollupOptions: {
      output: {
        // 手动分包：vue 生态稳定代码独立长缓存；大件三方库（仅被动态 import 触达）
        // 各自成块，按需加载，不进首屏入口。未命中的 node_modules 交回 Rollup
        // 按引用图自动切块，避免把视图专用依赖强行并入首屏 vendor。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          const p = id.replace(/\\/g, '/');
          if (/\/node_modules\/(?:vue|@vue|vue-router)\//.test(p)) return 'vendor-vue';
          if (/\/node_modules\/morphicons\//.test(p)) return 'vendor-morphicons';
          if (/\/node_modules\/(?:marked|dompurify)\//.test(p)) return 'vendor-markdown';
          if (/\/node_modules\/mediabunny\//.test(p)) return 'vendor-mediabunny';
          if (/\/node_modules\/jszip\//.test(p)) return 'vendor-jszip';
          if (/\/node_modules\/@google\/model-viewer\//.test(p)) return 'vendor-model-viewer';
          return undefined;
        }
      }
    }
  }
});
