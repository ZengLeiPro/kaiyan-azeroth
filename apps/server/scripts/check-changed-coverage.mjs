import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { findCoverageEntry, formatMetric, metrics, readJson, root } from './coverage-utils.mjs';

const thresholds = {
  added: { lines: 80, branches: 60, functions: 80, statements: 80 },
  modified: { lines: 60, branches: 45, functions: 60, statements: 60 },
};

const includePattern = /^apps\/server\/src\/.+\.ts$/;
const excludedPatterns = [
  /\.spec\.ts$/,
  /\.e2e-spec\.ts$/,
  /\.dto\.ts$/,
  /\.module\.ts$/,
  /\.d\.ts$/,
  /(^|\/)main\.ts$/,
  /(^|\/)index\.ts$/,
  /^apps\/server\/src\/test\//,
  /^apps\/server\/src\/.+\/decorators\//,
  /^apps\/server\/src\/common\/interfaces\//,
  /(^|\/)constants\//,
];

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function pickBaseRef() {
  const candidates = [
    process.env.COVERAGE_BASE_REF,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined,
    'origin/main',
    'origin/develop',
    'HEAD~1',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      runGit(['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function changedFiles() {
  const baseRef = pickBaseRef();
  if (!baseRef && process.env.CI === 'true') {
    throw new Error(
      '无法解析覆盖率变更检查的 base ref。请确认 actions/checkout 使用 fetch-depth: 0，并设置 COVERAGE_BASE_REF。'
    );
  }

  const args = baseRef ? ['diff', '--name-status', `${baseRef}...HEAD`] : ['diff', '--name-status', 'HEAD'];
  const output = runGit(args);
  if (!output) return [];
  return output
    .split('\n')
    .map((line) => line.split('\t'))
    .map(([status, firstPath, secondPath]) => ({
      status,
      path: status.startsWith('R') ? secondPath : firstPath,
      kind: status === 'A' ? 'added' : 'modified',
    }))
    .filter(({ status, path }) => path && status !== 'D')
    .filter(({ path }) => includePattern.test(path))
    .filter(({ path }) => excludedPatterns.every((pattern) => !pattern.test(path)));
}

function changedLineNumbers(path) {
  const baseRef = pickBaseRef();
  if (!baseRef) return [];

  const output = runGit(['diff', '--unified=0', `${baseRef}...HEAD`, '--', `:(top)${path}`]);
  if (!output) return [];

  const lines = new Set();
  const hunkPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  for (const line of output.split('\n')) {
    const match = line.match(hunkPattern);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] ? Number(match[2]) : 1;
    for (let i = 0; i < count; i += 1) lines.add(start + i);
  }
  return [...lines].sort((a, b) => a - b);
}

function findDetailedCoverageEntry(report, repoRelativePath) {
  const summaryEntry = findCoverageEntry(report, repoRelativePath);
  if (summaryEntry) return summaryEntry;
  return undefined;
}

function statementCoversLine(statement, line) {
  return statement.start.line <= line && statement.end.line >= line;
}

function modifiedLineCoverage(finalReport, filePath) {
  const coverage = findDetailedCoverageEntry(finalReport, filePath);
  if (!coverage) {
    return { missing: true, changed: 0, executable: 0, covered: 0, pct: 100 };
  }

  const changed = changedLineNumbers(filePath);
  const executable = new Set();
  const covered = new Set();
  for (const [statementId, statement] of Object.entries(coverage.statementMap ?? {})) {
    for (const line of changed) {
      if (!statementCoversLine(statement, line)) continue;
      executable.add(line);
      if ((coverage.s?.[statementId] ?? 0) > 0) covered.add(line);
    }
  }

  const executableCount = executable.size;
  const coveredCount = covered.size;
  return {
    missing: false,
    changed: changed.length,
    executable: executableCount,
    covered: coveredCount,
    pct: executableCount === 0 ? 100 : Number(((coveredCount / executableCount) * 100).toFixed(2)),
  };
}

try {
  const summaryPath = resolve(root, 'coverage/coverage-summary.json');
  const finalPath = resolve(root, 'coverage/coverage-final.json');
  const summary = readJson(summaryPath, '覆盖率摘要文件 coverage/coverage-summary.json');
  const finalReport = readJson(finalPath, '覆盖率明细文件 coverage/coverage-final.json');
  const files = changedFiles();
  if (files.length === 0) {
    console.log('Changed coverage gate: 无需检查的后端生产 TS 变更。');
    process.exit(0);
  }

  const failures = [];
  const reports = [];
  for (const file of files) {
    const coverage = findCoverageEntry(summary, file.path);
    if (!coverage) {
      failures.push(`${file.path}: 覆盖率报告中不存在该文件，请确认测试是否加载或 coverage include/exclude 是否正确。`);
      reports.push(`${file.path} (missing coverage entry)`);
      continue;
    }

    if (file.kind === 'added') {
      const threshold = thresholds.added;
      for (const metric of metrics) {
        const actual = coverage[metric]?.pct;
        const expected = threshold[metric];
        if (typeof actual !== 'number' || actual < expected) {
          failures.push(`${file.path}: ${metric} ${actual ?? 'N/A'}% < added threshold ${expected}%`);
        }
      }
      reports.push(`${file.path} (${metrics.map((metric) => formatMetric(coverage, metric)).join(', ')})`);
      continue;
    }

    const lineCoverage = modifiedLineCoverage(finalReport, file.path);
    if (lineCoverage.missing) {
      failures.push(`${file.path}: 覆盖率明细中不存在该文件，请确认测试是否加载或 coverage reporter 是否包含 json。`);
      reports.push(`${file.path} (missing detailed coverage entry)`);
      continue;
    }
    if (lineCoverage.pct < thresholds.modified.lines) {
      failures.push(
        `${file.path}: changed lines ${lineCoverage.pct}% < modified threshold ${thresholds.modified.lines}% ` +
          `(${lineCoverage.covered}/${lineCoverage.executable} executable changed lines covered)`
      );
    }
    reports.push(
      `${file.path} (changed lines=${lineCoverage.pct}%, ` +
        `${lineCoverage.covered}/${lineCoverage.executable} executable, ${lineCoverage.changed} changed)`
    );
  }

  console.log(`Changed coverage gate: checked ${files.length} file(s): ${reports.join('; ')}`);

  if (failures.length > 0) {
    console.error('Changed coverage gate failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
} catch (error) {
  console.error('Changed coverage gate failed:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
