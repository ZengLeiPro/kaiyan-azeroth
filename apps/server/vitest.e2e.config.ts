import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
  resolve: {
    alias: {
      '@ky-azeroth/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    root: 'src',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/e2e-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: '../coverage/e2e',
      include: ['**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.e2e-spec.ts',
        '**/*.dto.ts',
        '**/*.module.ts',
        'main.ts',
        '**/index.ts',
        '**/*.d.ts',
        'test/**',
        '**/decorators/**',
        'common/interfaces/**',
        '**/constants/**',
      ],
    },
  },
});
