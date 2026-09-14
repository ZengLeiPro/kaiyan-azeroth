import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type UserConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(
  ({ mode }): UserConfig => ({
    plugins: [
      react(),
      VitePWA({
        // 'prompt' 模式：检测到新 SW 不会自动应用，需 React 代码主动调
        // updateServiceWorker(true)，由用户点击「立即刷新」决定何时切换。
        registerType: 'prompt',
        // 禁止插件向 index.html 注入 <script src="/registerSW.js">，
        // 改由 src/components/AppUpdatePrompt.tsx 通过
        // virtual:pwa-register/react 的 useRegisterSW 钩子注册。
        injectRegister: false,
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Azeroth',
          short_name: 'Azeroth',
          description: 'Azeroth',
          theme_color: '#2e56e1',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // 注：原本这里有 `mode: 'development'`，但它不是 vite-plugin-pwa 暴露的合法字段，
          // 实际被忽略；插件的开发/生产开关在顶层 devOptions。已删除以避免误导。
          disableDevLogs: true,
          // 安全迁移版必须立即接管已打开页面，否则旧 SW 仍可继续回放 api-cache。
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          importScripts: ['sw-migration.js'],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          runtimeCaching: [
            {
              // 所有业务 API（含 FC 路径前缀）必须直连网络，绝不回放旧鉴权响应。
              urlPattern: ({ url }) => url.pathname.includes('/api/v1/'),
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
      // Bundle 分析器 - 仅在 analyze 模式下启用
      mode === 'analyze' &&
        visualizer({
          filename: 'dist/stats.html',
          open: true,
          gzipSize: true,
          brotliSize: true,
          template: 'treemap',
        }),
    ].filter(Boolean) as UserConfig['plugins'],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@ky-azeroth/shared/constants': path.resolve(
          __dirname,
          '../../packages/shared/src/constants'
        ),
        '@ky-azeroth/shared/types': path.resolve(__dirname, '../../packages/shared/src/types'),
        '@ky-azeroth/shared/schemas': path.resolve(__dirname, '../../packages/shared/src/schemas'),
        '@ky-azeroth/shared/utils': path.resolve(__dirname, '../../packages/shared/src/utils'),
        '@ky-azeroth/shared': path.resolve(__dirname, '../../packages/shared/src'),
      },
    },

    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
    },

    build: {
      // 目标浏览器
      target: 'es2020',

      // 调整警告阈值
      chunkSizeWarningLimit: 500,

      // 启用 CSS 代码分割
      cssCodeSplit: true,

      // Rollup 配置
      rollupOptions: {
        output: {
          // 优化 chunk 文件名
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',

          // 按稳定依赖域拆分，避免应用入口随第三方库一起膨胀。
          manualChunks(id) {
            if (!id.includes('/node_modules/')) return undefined;

            if (id.includes('/xlsx/')) return 'vendor-xlsx';
            if (id.includes('/recharts/')) return 'vendor-charts';
            if (id.includes('/d3-')) return 'vendor-d3';

            if (
              ['/react/', '/react-dom/', '/react-router', '/scheduler/'].some((dependency) =>
                id.includes(dependency)
              )
            ) {
              return 'vendor-react';
            }

            if (
              [
                '/@radix-ui/',
                '/lucide-react/',
                '/cmdk/',
                '/sonner/',
                '/vaul/',
                '/class-variance-authority/',
              ].some((dependency) => id.includes(dependency))
            ) {
              return 'vendor-ui';
            }

            if (
              [
                '/@tanstack/',
                '/@hookform/',
                '/axios/',
                '/react-hook-form/',
                '/zod/',
                '/zustand/',
              ].some((dependency) => id.includes(dependency))
            ) {
              return 'vendor-data';
            }

            if (id.includes('/date-fns/')) return 'vendor-date';
            return undefined;
          },
        },
      },
    },
  })
);
