#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

const MIN_TOTAL = {
  statements: 9.5,
  branches: 7.5,
  functions: 6.5,
  lines: 9.8,
};

const FOCUS_RULES = [
  {
    name: '转换契约 types.ts',
    match: (file) => /\/pages\/.*\/types\.ts$/.test(file),
    minLines: 75,
  },
  {
    name: '通用 lib/utils',
    match: (file) => /\/(lib|utils)\//.test(file),
    minLines: 35,
  },
  {
    name: '核心 hooks/stores',
    match: (file) => /\/(hooks|stores)\//.test(file),
    minLines: 20,
  },
  {
    name: 'patterns 复用组件',
    match: (file) => /\/components\/patterns\//.test(file),
    minLines: 8,
  },
];

function pct(metric) {
  return typeof metric?.pct === 'number' ? metric.pct : 0;
}

function normalizeRepoPath(file) {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  const marker = 'apps/web/src/';
  const markerIndex = normalized.indexOf(marker);
  return markerIndex >= 0 ? normalized.slice(markerIndex) : normalized;
}

function isFrontendSource(file) {
  return /^apps\/web\/src\/.*\.(?:ts|tsx)$/.test(normalizeRepoPath(file));
}

// These paths are deliberately not instrumented by vitest.config.ts. Keep this
// list aligned with that config so the changed-line gate never pretends an
// uninstrumented file was checked.
function isInstrumentedFrontendSource(file) {
  const relative = normalizeRepoPath(file);
  if (!isFrontendSource(relative)) return false;
  const sourceRelative = relative.slice('apps/web/src/'.length);
  return !(
    /(?:^|\/)__tests__\//.test(sourceRelative) ||
    /\.(?:test|spec)\.(?:ts|tsx)$/.test(sourceRelative) ||
    /(?:^|\/)index\.ts$/.test(sourceRelative) ||
    sourceRelative === 'main.tsx' ||
    sourceRelative === 'App.tsx' ||
    sourceRelative === 'vite-env.d.ts' ||
    /\.d\.ts$/.test(sourceRelative) ||
    sourceRelative.startsWith('components/ui/') ||
    sourceRelative.startsWith('constants/') ||
    sourceRelative === 'components/patterns/app-update-prompt.tsx'
  );
}

function listInstrumentedFrontendSources(repoRoot) {
  const sourceRoot = path.join(repoRoot, 'apps/web/src');
  const sources = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        const relative = normalizeRepoPath(path.relative(repoRoot, absolute));
        if (isInstrumentedFrontendSource(relative)) sources.push(relative);
      }
    }
  }

  visit(sourceRoot);
  return sources.sort();
}

function parseUnifiedDiff(diff) {
  const changed = new Map();
  let currentFile = null;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const candidate = line.slice(4);
      currentFile =
        candidate === '/dev/null' ? null : normalizeRepoPath(candidate.replace(/^b\//, ''));
      if (currentFile && !isFrontendSource(currentFile)) currentFile = null;
      continue;
    }

    if (!currentFile || !line.startsWith('@@ ')) continue;
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) continue;

    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) continue;

    const lines = changed.get(currentFile) ?? new Set();
    for (let lineNumber = start; lineNumber < start + count; lineNumber += 1) {
      lines.add(lineNumber);
    }
    changed.set(currentFile, lines);
  }

  return changed;
}

function buildStatementLineIndex(coverage) {
  const byFile = new Map();

  for (const [coveragePath, fileCoverage] of Object.entries(coverage)) {
    const relative = normalizeRepoPath(coveragePath);
    if (!isFrontendSource(relative)) continue;

    const byLine = new Map();
    for (const [statementId, location] of Object.entries(fileCoverage.statementMap ?? {})) {
      const start = Number(location?.start?.line);
      const end = Number(location?.end?.line);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) continue;

      const hits = Number(fileCoverage.s?.[statementId] ?? 0);
      for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
        const statements = byLine.get(lineNumber) ?? [];
        statements.push(hits);
        byLine.set(lineNumber, statements);
      }
    }
    byFile.set(relative, byLine);
  }

  return byFile;
}

function evaluateChangedCoverage(changed, coverage, minimum) {
  const coverageByFile = buildStatementLineIndex(coverage);
  const missingCoverageFiles = [];
  const excludedFiles = [];
  const uncovered = [];
  let executable = 0;
  let covered = 0;

  for (const [file, changedLines] of changed) {
    // A deletion hunk has no post-change lines and therefore no executable line
    // to map or require coverage for.
    if (changedLines.size === 0) continue;

    if (!isInstrumentedFrontendSource(file)) {
      excludedFiles.push(file);
      continue;
    }

    const statementLines = coverageByFile.get(file);
    if (!statementLines) {
      missingCoverageFiles.push(file);
      continue;
    }

    for (const lineNumber of [...changedLines].sort((a, b) => a - b)) {
      const statementHits = statementLines.get(lineNumber);
      // No mapped statement means this is a comment, type-only declaration,
      // whitespace, import-only syntax, brace, or another non-executable line.
      if (!statementHits || statementHits.length === 0) continue;

      executable += 1;
      if (statementHits.some((hits) => hits > 0)) {
        covered += 1;
      } else {
        uncovered.push(`${file}:${lineNumber}`);
      }
    }
  }

  const percentage = executable === 0 ? 100 : (covered / executable) * 100;
  return {
    covered,
    executable,
    percentage,
    passed: missingCoverageFiles.length === 0 && percentage >= minimum,
    uncovered,
    missingCoverageFiles,
    excludedFiles,
  };
}

function git(repoRoot, args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
  );
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function resolveMergeBase(repoRoot, baseRef) {
  const candidates = [baseRef];
  if (!baseRef.startsWith('refs/')) {
    candidates.push(`refs/remotes/origin/${baseRef}`, `origin/${baseRef}`, `refs/heads/${baseRef}`);
  }

  let baseCommit = null;
  for (const candidate of [...new Set(candidates)]) {
    const resolved = git(repoRoot, ['rev-parse', '--verify', `${candidate}^{commit}`]);
    if (resolved.ok) {
      baseCommit = resolved.stdout;
      break;
    }
  }
  if (!baseCommit) return null;

  const mergeBase = git(repoRoot, ['merge-base', 'HEAD', baseCommit]);
  return mergeBase.ok && mergeBase.stdout ? mergeBase.stdout : null;
}

function readChangedFrontendLines(repoRoot, mergeBase) {
  const result = git(repoRoot, [
    '-c',
    'core.quotePath=false',
    'diff',
    '--unified=0',
    '--no-color',
    '--no-ext-diff',
    '--no-renames',
    '--diff-filter=AM',
    mergeBase,
    '--',
    ':(glob)apps/web/src/**/*.ts',
    ':(glob)apps/web/src/**/*.tsx',
  ]);
  if (!result.ok) {
    throw new Error(`git diff 执行失败：${result.stderr || 'unknown error'}`);
  }
  return parseUnifiedDiff(result.stdout);
}

function isTrue(value) {
  return /^(?:1|true|yes)$/i.test(value ?? '');
}

function checkChangedCoverage({ repoRoot, detailPath, env = process.env }) {
  const explicitBaseRef = env.FRONTEND_COVERAGE_BASE_REF?.trim();
  const githubBaseRef = env.GITHUB_BASE_REF?.trim();
  const baseRef = explicitBaseRef || githubBaseRef;
  const isPullRequest = env.GITHUB_EVENT_NAME === 'pull_request';
  const required = isTrue(env.FRONTEND_COVERAGE_REQUIRE_CHANGED) || isPullRequest;
  const minimum = Number(env.FRONTEND_COVERAGE_CHANGED_LINES_MIN ?? 80);

  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
    return {
      status: 'error',
      message: 'FRONTEND_COVERAGE_CHANGED_LINES_MIN 必须是 0 到 100 的数字',
    };
  }

  if (!baseRef) {
    if (required) {
      return {
        status: 'error',
        message: 'PR changed-line coverage 必须提供 GITHUB_BASE_REF 或 FRONTEND_COVERAGE_BASE_REF',
      };
    }
    return {
      status: 'skipped',
      message: '非 PR 且未提供 base ref，明确跳过 changed-line coverage（未声称已检查）',
    };
  }

  const mergeBase = resolveMergeBase(repoRoot, baseRef);
  if (!mergeBase) {
    return {
      status: 'error',
      message: `无法从 base ref “${baseRef}” 解析与 HEAD 的 merge-base；changed-line coverage fail-closed`,
    };
  }

  if (!fs.existsSync(detailPath)) {
    return {
      status: 'error',
      message: `找不到语句级覆盖率明细：${detailPath}。Vitest coverage reporter 必须包含 json`,
    };
  }

  let coverage;
  try {
    coverage = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
  } catch (error) {
    return { status: 'error', message: `无法读取语句级覆盖率明细：${error.message}` };
  }

  let changed;
  try {
    changed = readChangedFrontendLines(repoRoot, mergeBase);
  } catch (error) {
    return { status: 'error', message: error.message };
  }

  const evaluation = evaluateChangedCoverage(changed, coverage, minimum);
  return {
    status: evaluation.passed ? 'passed' : 'failed',
    baseRef,
    mergeBase,
    minimum,
    changedFiles: changed.size,
    ...evaluation,
  };
}

function relativeSummaryPath(absoluteFile) {
  return normalizeRepoPath(absoluteFile);
}

function runPolicy(env = process.env) {
  const repoRoot = path.resolve(env.FRONTEND_COVERAGE_REPO_ROOT ?? DEFAULT_REPO_ROOT);
  const summaryPath = path.resolve(
    repoRoot,
    env.FRONTEND_COVERAGE_SUMMARY ?? 'apps/web/coverage/coverage-summary.json'
  );
  const detailPath = path.resolve(
    repoRoot,
    env.FRONTEND_COVERAGE_DETAIL ?? 'apps/web/coverage/coverage-final.json'
  );
  const allowedFocusGaps = Number(env.FRONTEND_COVERAGE_ALLOWED_GAPS ?? 120);
  const maxDrop = Number(env.FRONTEND_COVERAGE_MAX_DROP ?? 0.2);
  const baselinePath = env.FRONTEND_COVERAGE_BASE_SUMMARY ?? 'apps/web/coverage-baseline.json';
  let failed = false;

  function fail(message) {
    console.error(`❌ ${message}`);
    failed = true;
  }

  if (!fs.existsSync(summaryPath)) {
    fail(`找不到前端覆盖率摘要：${summaryPath}。请先运行 pnpm --filter @ky-azeroth/web test:cov。`);
    return 1;
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const total = summary.total;

  console.log('### Frontend coverage policy');
  for (const [metric, min] of Object.entries(MIN_TOTAL)) {
    const actual = pct(total[metric]);
    console.log(`- ${metric}: ${actual}% / min ${min}%`);
    if (actual < min) fail(`前端总 ${metric} 覆盖率 ${actual}% 低于目标 ${min}%`);
  }

  let gaps = 0;
  const gapExamples = [];
  for (const [absoluteFile, metrics] of Object.entries(summary)) {
    if (absoluteFile === 'total') continue;
    const relative = relativeSummaryPath(absoluteFile);
    const lines = pct(metrics.lines);
    for (const rule of FOCUS_RULES) {
      if (rule.match(relative) && lines < rule.minLines) {
        gaps += 1;
        if (gapExamples.length < 20) {
          gapExamples.push(`${relative}: lines ${lines}% < ${rule.minLines}% (${rule.name})`);
        }
        break;
      }
    }
  }

  console.log(`- focus gaps: ${gaps} / allowed ${allowedFocusGaps}`);
  if (gapExamples.length > 0) {
    console.log('Focus gap examples:');
    for (const example of gapExamples) console.log(`  - ${example}`);
  }
  if (gaps > allowedFocusGaps) {
    fail(`高价值目录覆盖率缺口 ${gaps} 超过允许值 ${allowedFocusGaps}`);
  }

  const resolvedBase = path.resolve(repoRoot, baselinePath);
  if (!fs.existsSync(resolvedBase)) {
    fail(`找不到覆盖率基线 ${resolvedBase}；baseline 回退检查必须 fail-closed`);
  } else {
    let baseline;
    try {
      baseline = JSON.parse(fs.readFileSync(resolvedBase, 'utf8'));
    } catch (error) {
      fail(`无法读取覆盖率基线：${error.message}`);
    }

    const validBaselineObject =
      baseline && typeof baseline === 'object' && !Array.isArray(baseline);
    const baseTotal = validBaselineObject ? baseline.total : undefined;
    const baselineFiles = validBaselineObject ? baseline.files : undefined;
    const validTotal = baseTotal && typeof baseTotal === 'object' && !Array.isArray(baseTotal);
    const validFiles =
      baselineFiles && typeof baselineFiles === 'object' && !Array.isArray(baselineFiles);
    if (!validTotal || !validFiles) {
      fail('覆盖率基线必须包含对象形态的 total 与 files');
    } else {
      const baselineMetric = (value) =>
        typeof value === 'number'
          ? value
          : value && typeof value.pct === 'number'
            ? value.pct
            : NaN;
      const baseValues = {};
      for (const metric of Object.keys(MIN_TOTAL)) {
        const value = baselineMetric(baseTotal[metric]);
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          fail(`覆盖率基线 total.${metric} 必须是 0..100 的有限数值`);
        } else {
          baseValues[metric] = value;
        }
      }

      if (Object.keys(baseValues).length === Object.keys(MIN_TOTAL).length) {
        for (const metric of Object.keys(MIN_TOTAL)) {
          const drop = baseValues[metric] - pct(total[metric]);
          console.log(`- ${metric} baseline delta: ${(-drop).toFixed(2)}pp`);
          if (drop > maxDrop) {
            fail(`前端 ${metric} 覆盖率较基线下降 ${drop.toFixed(2)}pp，超过允许下降 ${maxDrop}pp`);
          }
        }
      }

      const summaryByRelative = new Map();
      for (const [absoluteFile, metrics] of Object.entries(summary)) {
        if (absoluteFile === 'total') continue;
        summaryByRelative.set(relativeSummaryPath(absoluteFile), metrics);
      }

      const currentSources = listInstrumentedFrontendSources(repoRoot);
      for (const relative of currentSources) {
        if (!Object.prototype.hasOwnProperty.call(baselineFiles, relative)) {
          fail(`新增源文件未纳入覆盖率基线：${relative}`);
        }
        if (!summaryByRelative.has(relative)) {
          fail(`当前源文件缺少 coverage summary：${relative}`);
        }
      }

      let regressedFocusFiles = 0;
      for (const [relative, baseMetrics] of Object.entries(baselineFiles)) {
        const baseLines = baselineMetric(baseMetrics?.lines);
        if (!Number.isFinite(baseLines) || baseLines < 0 || baseLines > 100) {
          fail(`覆盖率基线 ${relative}.lines 必须是 0..100 的有限数值`);
          continue;
        }
        const current = summaryByRelative.get(relative);
        if (!current) {
          if (fs.existsSync(path.resolve(repoRoot, relative))) {
            fail(`基线源文件仍存在但当前 coverage summary 缺失：${relative}`);
          }
          continue;
        }
        const currentLines = pct(current.lines);
        // 每个已进入基线的源文件都只许持平或提升。不能再通过让一个低覆盖文件
        // 继续下降、同时用另一个文件补总量来绕过 ratchet。
        if (baseLines - currentLines > maxDrop) {
          regressedFocusFiles += 1;
          if (regressedFocusFiles <= 20) {
            console.error(
              `❌ 重点文件覆盖率回退：${relative} lines ${currentLines}% < baseline ${baseLines}%`
            );
          }
        }
      }
      if (regressedFocusFiles > 0) fail(`发现 ${regressedFocusFiles} 个源文件覆盖率较基线明显回退`);
    }
  }

  const changedResult = checkChangedCoverage({ repoRoot, detailPath, env });
  if (changedResult.status === 'skipped') {
    console.warn(`⚠️ ${changedResult.message}`);
  } else if (changedResult.status === 'error') {
    fail(changedResult.message);
  } else {
    console.log(
      `- changed lines: ${changedResult.covered}/${changedResult.executable} executable ` +
        `(${changedResult.percentage.toFixed(2)}%) / min ${changedResult.minimum}%`
    );
    console.log(
      `- changed diff: ${changedResult.changedFiles} source file(s), merge-base ${changedResult.mergeBase.slice(0, 12)} (${changedResult.baseRef})`
    );
    if (changedResult.excludedFiles.length > 0) {
      console.log(
        `- changed instrumentation exclusions: ${changedResult.excludedFiles.length} file(s) (not claimed as checked)`
      );
    }
    if (changedResult.missingCoverageFiles.length > 0) {
      fail(
        `以下 changed source 文件缺少 coverage 明细：${changedResult.missingCoverageFiles.join(', ')}`
      );
    }
    if (changedResult.uncovered.length > 0) {
      console.log('Uncovered changed executable lines:');
      for (const location of changedResult.uncovered.slice(0, 30)) console.log(`  - ${location}`);
    }
    if (changedResult.status === 'failed' && changedResult.missingCoverageFiles.length === 0) {
      fail(
        `changed executable lines 覆盖率 ${changedResult.percentage.toFixed(2)}% 低于目标 ${changedResult.minimum}%`
      );
    }
  }

  if (failed) return 1;
  console.log('✅ Frontend coverage policy passed');
  return 0;
}

if (require.main === module) {
  process.exitCode = runPolicy();
}

module.exports = {
  buildStatementLineIndex,
  checkChangedCoverage,
  evaluateChangedCoverage,
  isInstrumentedFrontendSource,
  listInstrumentedFrontendSources,
  normalizeRepoPath,
  parseUnifiedDiff,
  readChangedFrontendLines,
  resolveMergeBase,
  runPolicy,
};
