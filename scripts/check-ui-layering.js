#!/usr/bin/env node
// UI 四层架构与 TypeScript 依赖门禁
// 使用方式：node scripts/check-ui-layering.js

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const REPO_ROOT = path.resolve(__dirname, '..');
const WEB_SRC_DIR = path.join(REPO_ROOT, 'apps/web/src');
const WEB_TSCONFIG = path.join(REPO_ROOT, 'apps/web/tsconfig.json');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');
const SERVER_TSCONFIG = path.join(REPO_ROOT, 'apps/server/tsconfig.json');
const PAGES_DIR = path.join(WEB_SRC_DIR, 'pages');
const PATTERNS_DIR = path.join(WEB_SRC_DIR, 'components/patterns');
const COMPONENTS_DIR = path.join(WEB_SRC_DIR, 'components');
const HOOKS_DIR = path.join(WEB_SRC_DIR, 'hooks');

// components/ 下只允许这些顶层子目录：四层（ui/patterns/templates）+ 已登记的移动端复用层（mobile）
const ALLOWED_COMPONENT_DIRS = new Set(['ui', 'patterns', 'templates', 'mobile']);
const CROSS_PAGE_THRESHOLD = 1;

function isInside(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..');
}

const EXCLUDED_SOURCE_DIRS = new Set([
  '__tests__',
  'test',
  'tests',
  '__fixtures__',
  'fixtures',
  'generated',
  '__generated__',
  'codegen',
  '.prisma',
  'node_modules',
  'dist',
  'coverage',
]);

function isProductionTsFile(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  const segments = normalized.split('/');
  const fileName = segments.at(-1) ?? '';
  return (
    /\.[cm]?tsx?$/.test(fileName) &&
    !/\.d\.[cm]?ts$/.test(fileName) &&
    !segments.some((segment) => EXCLUDED_SOURCE_DIRS.has(segment)) &&
    !/(?:\.(?:test|spec)|-spec)\.[cm]?tsx?$/.test(fileName) &&
    !/\.(?:generated|gen)\.[cm]?tsx?$/.test(fileName)
  );
}

function walkTsFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !EXCLUDED_SOURCE_DIRS.has(entry.name)) {
      walkTsFiles(fullPath, files);
    } else if (entry.isFile() && isProductionTsFile(fullPath)) {
      files.push(path.resolve(fullPath));
    }
  }
  return files;
}

function readCompilerOptions(tsconfigPath) {
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  return ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(tsconfigPath)).options;
}

/** Build a production dependency graph with the same resolver as TypeScript. */
function createDependencyGraph(sourceDir = WEB_SRC_DIR, tsconfigPath = WEB_TSCONFIG) {
  const files = walkTsFiles(sourceDir);
  const fileSet = new Set(files);
  const compilerOptions = readCompilerOptions(tsconfigPath);
  const graph = new Map(files.map((file) => [file, new Set()]));

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const imports = ts.preProcessFile(source, true, true).importedFiles;
    for (const imported of imports) {
      const resolved = ts.resolveModuleName(imported.fileName, file, compilerOptions, ts.sys)
        .resolvedModule?.resolvedFileName;
      if (!resolved) continue;
      const dependency = path.resolve(resolved);
      if (fileSet.has(dependency)) graph.get(file).add(dependency);
    }
  }
  return graph;
}

function findStronglyConnectedComponents(graph) {
  let nextIndex = 0;
  const stack = [];
  const onStack = new Set();
  const indexes = new Map();
  const lowLinks = new Map();
  const cycles = [];

  function visit(file) {
    indexes.set(file, nextIndex);
    lowLinks.set(file, nextIndex);
    nextIndex += 1;
    stack.push(file);
    onStack.add(file);

    for (const dependency of graph.get(file) ?? []) {
      if (!indexes.has(dependency)) {
        visit(dependency);
        lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(dependency)));
      } else if (onStack.has(dependency)) {
        lowLinks.set(file, Math.min(lowLinks.get(file), indexes.get(dependency)));
      }
    }

    if (lowLinks.get(file) !== indexes.get(file)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== file);

    if (component.length > 1 || graph.get(file)?.has(file)) {
      cycles.push(component.sort());
    }
  }

  for (const file of graph.keys()) {
    if (!indexes.has(file)) visit(file);
  }
  return cycles.sort((left, right) => right.length - left.length);
}

function findLowerLayerPageImports(graph, options = {}) {
  const componentsDir = path.resolve(options.componentsDir ?? COMPONENTS_DIR);
  const hooksDir = path.resolve(options.hooksDir ?? HOOKS_DIR);
  const pagesDir = path.resolve(options.pagesDir ?? PAGES_DIR);
  const violations = [];

  for (const [source, dependencies] of graph) {
    if (!isInside(source, componentsDir) && !isInside(source, hooksDir)) continue;
    for (const dependency of dependencies) {
      if (isInside(dependency, pagesDir)) violations.push({ source, dependency });
    }
  }
  return violations;
}

function checkStrayComponentDirs() {
  if (!fs.existsSync(COMPONENTS_DIR)) return [];
  return fs
    .readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter(
      (item) =>
        item.isDirectory() && !item.name.startsWith('.') && !ALLOWED_COMPONENT_DIRS.has(item.name)
    )
    .map((item) => item.name);
}

function getPageModules() {
  if (!fs.existsSync(PAGES_DIR)) return new Set();
  return new Set(
    fs
      .readdirSync(PAGES_DIR, { withFileTypes: true })
      .filter(
        (item) => item.isDirectory() && !item.name.startsWith('.') && item.name !== 'components'
      )
      .map((item) => item.name)
  );
}

// 保留既有跨页面专属组件检查，只扫描页面模块的业务目录。
function scanPageFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (['components', 'common', 'utils', 'hooks', 'types', 'layouts'].includes(item.name)) {
        scanPageFiles(fullPath, files);
      }
    } else if (item.isFile() && /\.tsx?$/.test(item.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractImports(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return ts.preProcessFile(content, true, true).importedFiles.map((entry) => entry.fileName);
}

function analyzeComponentUsage() {
  const componentUsage = new Map();
  for (const moduleName of getPageModules()) {
    for (const filePath of scanPageFiles(path.join(PAGES_DIR, moduleName))) {
      for (const importPath of extractImports(filePath)) {
        if (!importPath.startsWith('@/pages/') || !importPath.includes('/components/')) continue;
        const resolvedPath = importPath.replace('@/', WEB_SRC_DIR + '/');
        if (!componentUsage.has(resolvedPath)) componentUsage.set(resolvedPath, new Set());
        componentUsage.get(resolvedPath).add(moduleName);
      }
    }
  }
  return componentUsage;
}

function relativeWebPath(filePath) {
  return `@/${path.relative(WEB_SRC_DIR, filePath).split(path.sep).join('/')}`;
}

function relativeRepoPath(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function main() {
  console.log('检查 UI 四层架构与 TypeScript 依赖...\n');
  if (!fs.existsSync(PATTERNS_DIR)) {
    console.log('提示: components/patterns 目录不存在，建议创建以放置可复用组件。\n');
  }

  const componentUsage = analyzeComponentUsage();
  const reusableComponents = [...componentUsage.entries()]
    .filter(([, pageModules]) => pageModules.size > CROSS_PAGE_THRESHOLD)
    .map(([componentPath, pageModules]) => ({
      path: componentPath,
      pages: [...pageModules],
      usageCount: pageModules.size,
    }))
    .sort((left, right) => right.usageCount - left.usageCount);
  const strayDirs = checkStrayComponentDirs();

  const webGraph = createDependencyGraph();
  const serverGraph = createDependencyGraph(SERVER_SRC_DIR, SERVER_TSCONFIG);
  const lowerLayerImports = findLowerLayerPageImports(webGraph);
  const webCycles = findStronglyConnectedComponents(webGraph);
  const serverCycles = findStronglyConnectedComponents(serverGraph);

  console.log(
    `已检查 Web ${webGraph.size} + Server ${serverGraph.size} 个生产 TS 模块、${componentUsage.size} 个跨页面组件引用`
  );
  console.log(
    `Web SCC ${webCycles.length} 个，Server SCC ${serverCycles.length} 个，components/hooks → pages 反向依赖 ${lowerLayerImports.length} 个\n`
  );

  const issueCount =
    reusableComponents.length +
    strayDirs.length +
    lowerLayerImports.length +
    webCycles.length +
    serverCycles.length;
  if (issueCount === 0) {
    console.log('UI 四层架构与依赖检查通过！');
    return;
  }

  console.log('错误（必须修复）:');
  console.log('='.repeat(50));
  for (const item of reusableComponents) {
    console.log(`  ${relativeWebPath(item.path)}`);
    console.log(
      `    被 ${item.pages.length} 个页面引用（${item.pages.join(', ')}），应上提到 components/patterns/`
    );
  }
  for (const dir of strayDirs) {
    console.log(`  components/${dir}/`);
    console.log('    顶层 components 仅允许 ui/patterns/templates/mobile');
  }
  for (const violation of lowerLayerImports) {
    console.log(
      `  ${relativeWebPath(violation.source)} -> ${relativeWebPath(violation.dependency)}`
    );
    console.log('    components/hooks 属通用层，禁止反向依赖 pages 业务层');
  }
  for (const cycle of webCycles) {
    console.log(`  Web TypeScript SCC (${cycle.length} files):`);
    for (const file of cycle) console.log(`    - ${relativeRepoPath(file)}`);
  }
  for (const cycle of serverCycles) {
    console.log(`  Server TypeScript SCC (${cycle.length} files):`);
    for (const file of cycle) console.log(`    - ${relativeRepoPath(file)}`);
  }
  console.log(`\n检查失败：发现 ${issueCount} 处问题。`);
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  createDependencyGraph,
  findLowerLayerPageImports,
  findStronglyConnectedComponents,
  isProductionTsFile,
};
