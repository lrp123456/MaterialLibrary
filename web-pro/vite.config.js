import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import fs from 'node:fs';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

// B6：构建结束时把版本指纹写进 dist/build-info.json（提交号、构建时间、通道），
// 供 service-hub / mls-ctl 做产物新鲜度核对。字段与 scripts/branch-channel.js 落盘格式一致；
// lane 构建会在 vite build 之后用 lane 专属信息覆盖本文件。仅构建期运行，dev 不触发。
function writeBuildInfoPlugin() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let outDir = null;
  const git = (args) => {
    try {
      return cp.execFileSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch (_) {
      return '';
    }
  };
  return {
    name: 'ml-write-build-info',
    apply: 'build',
    configResolved(resolved) {
      outDir = path.isAbsolute(resolved.build.outDir)
        ? resolved.build.outDir
        : path.resolve(repoRoot, 'web-pro', resolved.build.outDir);
    },
    closeBundle() {
      try {
        const status = git(['status', '--porcelain']);
        const dirtyCount = status ? status.split(/\r?\n/).filter(Boolean).length : 0;
        const info = {
          channel: String(process.env.APP_CHANNEL || '').toLowerCase() === 'gray' ? 'gray' : 'prod',
          branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
          builtAt: Date.now(),
          commit: git(['rev-parse', 'HEAD']),
          dirty: dirtyCount > 0,
          dirtyCount,
          subject: git(['log', '-1', '--pretty=%s']),
          builder: `node ${process.version}`,
        };
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'build-info.json'), JSON.stringify(info, null, 2));
      } catch (e) {
        // 版本指纹缺失不应毁掉整个前端构建
        console.warn('[build-info] 写入失败:', e && e.message);
      }
    },
  };
}

export default defineConfig({
  plugins: [vue(), writeBuildInfoPlugin()],
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
