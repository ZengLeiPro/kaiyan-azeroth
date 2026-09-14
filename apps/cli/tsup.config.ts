import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  shims: true,
  // Bundled CommonJS dependencies (Commander/Axios) still call Node built-ins through require().
  // Define an ESM-safe require before esbuild's interop helper so the copied standalone bin works.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  // src/index.ts 已自带 shebang；这里不再额外注入，避免打包后出现双 shebang。
  // Bundle every runtime dependency needed by the published bin. In particular shared/dist is
  // CommonJS and contains require('zod'); leaving zod external produces an unusable ESM bundle.
  noExternal: ['@ky-azeroth/shared', 'axios', 'commander', 'zod'],
});
