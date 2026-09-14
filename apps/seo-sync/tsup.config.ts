import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/handler.ts', 'src/server.ts'],
  format: 'cjs',
  clean: true,
  // 把 workspace 共享包 bundle 进 dist，避免 FC 运行时 require workspace 符号链接失效，
  // 同时绕开 shared 包 ESM 产物无法被 CJS require 的兼容问题。
  noExternal: [/^@ky-azeroth\//],
});
