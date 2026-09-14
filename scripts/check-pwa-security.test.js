const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');

test('PWA 安全迁移强制新 SW 立即接管并引入旧缓存清理脚本', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'apps/web/vite.config.ts'), 'utf8');
  assert.match(source, /skipWaiting:\s*true/);
  assert.match(source, /clientsClaim:\s*true/);
  assert.match(source, /cleanupOutdatedCaches:\s*true/);
  assert.match(source, /importScripts:\s*\[\s*['"]sw-migration\.js['"]\s*\]/);
  assert.match(source, /handler:\s*['"]NetworkOnly['"]/);
  assert.doesNotMatch(source, /cacheName:\s*['"]api-cache['"]/);
});

test('SW activate 迁移会把 api-cache 删除加入激活生命周期', async () => {
  const source = fs.readFileSync(path.join(repoRoot, 'apps/web/public/sw-migration.js'), 'utf8');
  let activate;
  const deleted = [];
  vm.runInNewContext(source, {
    self: {
      addEventListener(type, listener) {
        if (type === 'activate') activate = listener;
      },
    },
    caches: {
      async delete(name) {
        deleted.push(name);
        return true;
      },
    },
  });

  assert.equal(typeof activate, 'function');
  let migration;
  activate({
    waitUntil(promise) {
      migration = promise;
    },
  });
  assert.ok(migration instanceof Promise);
  await migration;
  assert.deepEqual(deleted, ['api-cache']);
});
