import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@ky-azeroth/shared/constants': path.resolve(
        __dirname,
        '../../packages/shared/src/constants'
      ),
      '@ky-azeroth/shared/types': path.resolve(__dirname, '../../packages/shared/src/types'),
      '@ky-azeroth/shared/schemas': path.resolve(__dirname, '../../packages/shared/src/schemas'),
      '@ky-azeroth/shared/utils': path.resolve(__dirname, '../../packages/shared/src/utils'),
      '@ky-azeroth/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    pool: 'threads',
    root: 'src',
    coverage: {
      provider: 'v8',
      // json-summary 供总量/focus/baseline，json 提供 changed-line 语句与行级映射。
      reporter: ['text', 'text-summary', 'json-summary', 'json'],
      reportsDirectory: '../coverage',
      include: ['**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/index.ts',
        'main.tsx',
        'App.tsx',
        'vite-env.d.ts',
        '**/*.d.ts',
        // shadcn/ui 原子组件（第三方生成，由上游保证质量）
        'components/ui/**',
        // 纯数据配置（菜单、表格列定义、表单选项、导入模板）
        'constants/**',
        // PWA 虚拟模块在 V8 coverage remap 阶段无法稳定解析
        'components/patterns/app-update-prompt.tsx',
      ],
      // 阈值：基于当前覆盖率设置下限，防止回退
      // 提升覆盖率时同步抬升，禁止用降低门槛解决测试失败。
      thresholds: {
        statements: 9.5,
        branches: 7.5,
        functions: 6.5,
        lines: 9.8,
      },
    },
  },
});
