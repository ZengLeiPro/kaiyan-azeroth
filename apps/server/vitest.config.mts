import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vitest/config';

interface CoverageBaseline {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

const coverageBaseline = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'coverage-baseline.json'), 'utf8')
) as CoverageBaseline;

export default defineConfig({
  resolve: {
    alias: {
      '@ky-azeroth/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    pool: 'threads',
    root: 'src',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'json'],
      reportsDirectory: '../coverage',
      include: ['**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.e2e-spec.ts',
        '**/*.dto.ts',
        '**/*.module.ts',
        'main.ts',
        '**/index.ts',
        '**/*.d.ts',
        // 测试辅助工厂/工具，不计入生产代码覆盖率
        'test/**',
        // 纯元数据装饰器（无业务逻辑）
        '**/decorators/**',
        // 纯类型/接口定义
        'common/interfaces/**',
        // 纯常量定义
        '**/constants/**',
      ],
      // 阈值：基于当前覆盖率设置下限，防止回退
      // 目标路线：2% → 15% → 20% → 30% → 50% → 80%
      thresholds: {
        statements: coverageBaseline.statements,
        branches: coverageBaseline.branches,
        functions: coverageBaseline.functions,
        lines: coverageBaseline.lines,
      },
    },
  },
});
