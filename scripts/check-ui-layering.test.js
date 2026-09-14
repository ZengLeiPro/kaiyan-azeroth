const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createDependencyGraph,
  findLowerLayerPageImports,
  findStronglyConnectedComponents,
} = require('./check-ui-layering');

function withFixture(files, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-layering-'));
  try {
    const sourceDir = path.join(root, 'src');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
          moduleResolution: 'Bundler',
        },
        include: ['src'],
      })
    );
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(sourceDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    return run({ root, sourceDir, tsconfigPath: path.join(root, 'tsconfig.json') });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('阻断 components/hooks 通过 TS alias 反向依赖 pages', () => {
  withFixture(
    {
      'components/pattern.ts':
        "import { pageValue } from '@/pages/crm/page'; export { pageValue };",
      'hooks/use-page.ts': "export { pageValue } from '../pages/crm/page';",
      'pages/crm/page.ts': 'export const pageValue = 1;',
    },
    ({ sourceDir, tsconfigPath }) => {
      const graph = createDependencyGraph(sourceDir, tsconfigPath);
      const violations = findLowerLayerPageImports(graph, {
        componentsDir: path.join(sourceDir, 'components'),
        hooksDir: path.join(sourceDir, 'hooks'),
        pagesDir: path.join(sourceDir, 'pages'),
      });
      assert.equal(violations.length, 2);
    }
  );
});

test('阻断新增 Web TypeScript SCC', () => {
  withFixture(
    {
      'components/a.ts': "export { b } from './b'; export const a = 1;",
      'components/b.ts': "export { a } from './a'; export const b = 1;",
    },
    ({ sourceDir, tsconfigPath }) => {
      const graph = createDependencyGraph(sourceDir, tsconfigPath);
      const cycles = findStronglyConnectedComponents(graph);
      assert.equal(cycles.length, 1);
      assert.equal(cycles[0].length, 2);
    }
  );
});

test('阻断新增 Server TypeScript SCC', () => {
  withFixture(
    {
      'modules/orders/orders.module.ts':
        "import { service } from './orders.service'; export { service };",
      'modules/orders/orders.service.ts':
        "import { moduleValue } from './orders.module'; export const service = moduleValue;",
    },
    ({ sourceDir, tsconfigPath }) => {
      const serverGraph = createDependencyGraph(sourceDir, tsconfigPath);
      const cycles = findStronglyConnectedComponents(serverGraph);
      assert.equal(cycles.length, 1);
      assert.deepEqual(
        cycles[0].map((file) => path.basename(file)),
        ['orders.module.ts', 'orders.service.ts']
      );
    }
  );
});

test('测试与生成文件不进入 Server 生产依赖图', () => {
  withFixture(
    {
      'modules/pattern.ts': 'export const pattern = 1;',
      'modules/pattern.test.ts': "export { generated } from './pattern.generated';",
      'modules/pattern.generated.ts':
        "export { generatedPeer } from './generated-peer'; export const generated = 1;",
      'modules/generated-peer.ts':
        "export { generated } from './pattern.generated'; export const generatedPeer = 1;",
      'generated/client.ts': "export { internal } from './internal';",
      'generated/internal.ts': "export { client } from './client';",
    },
    ({ sourceDir, tsconfigPath }) => {
      const graph = createDependencyGraph(sourceDir, tsconfigPath);
      assert.equal(graph.size, 2);
      assert.equal(findStronglyConnectedComponents(graph).length, 0);
    }
  );
});

test('合法的 Server 单向依赖是正例，不产生 SCC', () => {
  withFixture(
    {
      'modules/orders/orders.controller.ts':
        "import { service } from './orders.service'; export const controller = service;",
      'modules/orders/orders.service.ts':
        "import { repository } from './orders.repository'; export const service = repository;",
      'modules/orders/orders.repository.ts': 'export const repository = 1;',
    },
    ({ sourceDir, tsconfigPath }) => {
      const graph = createDependencyGraph(sourceDir, tsconfigPath);
      assert.equal(graph.size, 3);
      assert.deepEqual(findStronglyConnectedComponents(graph), []);
    }
  );
});
