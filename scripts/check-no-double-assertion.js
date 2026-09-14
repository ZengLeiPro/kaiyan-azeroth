#!/usr/bin/env node
/**
 * 禁止生产 TypeScript 新增双重类型断言（例如 value as unknown as Target）。
 *
 * 扫描 pnpm workspace 中全部 src/，排除测试与声明文件。既有债务按“路径 + AST 节点”
 * 精确登记；不接受路径通配符或文件级豁免。默认门禁允许债务减少、拒绝任何新节点。
 * `--prune-baseline` 只能删除已消失节点，发现新增节点时拒绝写入。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const { productionSourceDirs } = require('./lib/workspaces');

const ROOT = process.env.NO_DOUBLE_ASSERTION_ROOT
  ? path.resolve(process.env.NO_DOUBLE_ASSERTION_ROOT)
  : path.resolve(__dirname, '..');
const BASELINE_PATH = process.env.NO_DOUBLE_ASSERTION_BASELINE
  ? path.resolve(process.env.NO_DOUBLE_ASSERTION_BASELINE)
  : path.join(ROOT, 'scripts/baselines/no-double-assertion.json');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

function posixRelative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function isProductionFile(filePath) {
  const relativePath = posixRelative(filePath);
  const segments = relativePath.split('/');
  const fileName = segments.at(-1) || '';
  if (fileName.endsWith('.d.ts')) return false;
  if (
    segments.some((segment) => ['__tests__', 'test', 'tests', '__fixtures__'].includes(segment))
  ) {
    return false;
  }
  return !/(?:\.(?:test|spec)|-spec)\.[cm]?[jt]sx?$/.test(fileName);
}

function findSourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findSourceFiles(fullPath));
    if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      isProductionFile(fullPath)
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function unwrapParentheses(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isAssertion(node) {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

function compact(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function collectDoubleAssertions() {
  const detections = [];
  const seenOccurrences = new Map();
  const sourceFiles = productionSourceDirs(ROOT).flatMap(findSourceFiles).sort();

  for (const filePath of sourceFiles) {
    const sourceText = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    function visit(node) {
      if (isAssertion(node) && isAssertion(unwrapParentheses(node.expression))) {
        const nodeText = node.getText(sourceFile);
        const nodeHash = crypto.createHash('sha256').update(nodeText).digest('hex');
        const syntaxKind = ts.SyntaxKind[node.kind];
        const relativePath = posixRelative(filePath);
        const occurrenceKey = `${relativePath}\0${syntaxKind}\0${nodeHash}`;
        const occurrence = (seenOccurrences.get(occurrenceKey) || 0) + 1;
        seenOccurrences.set(occurrenceKey, occurrence);
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        detections.push({
          path: relativePath,
          syntaxKind,
          nodeHash,
          occurrence,
          controller: /(?:^|\/)[^/]+\.controller\.[cm]?[jt]sx?$/.test(relativePath),
          line: start.line + 1,
          column: start.character + 1,
          preview: compact(nodeText).slice(0, 180),
        });
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }
  return detections;
}

function nodeKey(entry) {
  return `${entry.path}\0${entry.syntaxKind}\0${entry.nodeHash}\0${entry.occurrence}`;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.nodes)) {
    throw new Error(`双断言 baseline 格式非法: ${BASELINE_PATH}`);
  }

  const keys = new Set();
  for (const entry of parsed.nodes) {
    if (
      typeof entry.path !== 'string' ||
      /[*?]/.test(entry.path) ||
      typeof entry.syntaxKind !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.nodeHash || '') ||
      !Number.isInteger(entry.occurrence) ||
      entry.occurrence < 1
    ) {
      throw new Error(`baseline 只允许精确“路径 + AST 节点”条目: ${JSON.stringify(entry)}`);
    }
    const key = nodeKey(entry);
    if (keys.has(key)) throw new Error(`baseline 存在重复节点: ${entry.path} ${entry.nodeHash}`);
    keys.add(key);
  }
  return parsed;
}

function writeBaseline(nodes) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        version: 1,
        policy: 'exact-path-and-ast-node; additions forbidden; prune-only',
        nodes: nodes.map(
          ({ path: filePath, syntaxKind, nodeHash, occurrence, controller, preview }) => ({
            path: filePath,
            syntaxKind,
            nodeHash,
            occurrence,
            controller,
            preview,
          })
        ),
      },
      null,
      2
    )}\n`
  );
}

function printNode(prefix, node) {
  const scope = node.controller ? ' [controller 零容忍]' : '';
  console.log(`  ${prefix} ${node.path}:${node.line || '?'}:${node.column || '?'}${scope}`);
  console.log(`    ${node.preview || node.nodeHash}`);
}

function main() {
  const current = collectDoubleAssertions();
  const baseline = readBaseline();

  if (process.argv.includes('--init-baseline')) {
    if (baseline !== null) throw new Error('baseline 已存在；初始化只允许在文件不存在时执行');
    writeBaseline(current);
    console.log(`已初始化双断言 baseline：${current.length} 个精确 AST 节点`);
    return;
  }
  if (baseline === null) {
    throw new Error(
      `缺少双断言 baseline；首次建立请运行 node ${path.relative(ROOT, __filename)} --init-baseline`
    );
  }

  const baselineByKey = new Map(baseline.nodes.map((entry) => [nodeKey(entry), entry]));
  const currentByKey = new Map(current.map((entry) => [nodeKey(entry), entry]));
  const added = current.filter((entry) => !baselineByKey.has(nodeKey(entry)));
  const removed = baseline.nodes.filter((entry) => !currentByKey.has(nodeKey(entry)));

  if (added.length > 0) {
    console.log('错误（必须修复）：生产 workspace 出现 baseline 外双重类型断言');
    for (const node of added) printNode('+', node);
    console.log(`\n新增 ${added.length} 个；controller 新双断言一律零容忍，禁止扩大 baseline。`);
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--prune-baseline')) {
    writeBaseline(current);
    console.log(`双断言 baseline 已只降更新：${baseline.nodes.length} -> ${current.length}`);
    return;
  }

  if (removed.length > 0) {
    console.log('错误（必须维护）：双断言 baseline 含已消失节点');
    for (const node of removed) printNode('-', node);
    console.log(
      `\n已消失 ${removed.length} 个；请审查后执行 pnpm run check:no-double-assertion -- --prune-baseline，并提交 baseline 只降变更。`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `双断言检查通过：当前 ${current.length}，baseline ${baseline.nodes.length}，新增 0，消失 0。`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
