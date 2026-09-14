import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const baselinePath = resolve(root, 'coverage-baseline.json');
const summaryPath = resolve(root, 'coverage/coverage-summary.json');
const metrics = ['statements', 'branches', 'functions', 'lines'];

function readJson(path, description) {
  if (!existsSync(path)) {
    const hint = path === summaryPath ? '请先运行 pnpm test:cov 生成 coverage-summary.json。' : '';
    throw new Error(`${description} 不存在：${path}${hint ? `\n${hint}` : ''}`);
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${description} 不是合法 JSON：${path}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数字，实际值：${String(value)}`);
  }
  return value;
}

try {
  const baseline = readJson(baselinePath, '覆盖率基线文件 coverage-baseline.json');
  const summary = readJson(summaryPath, '覆盖率摘要文件 coverage/coverage-summary.json');
  const failures = [];

  for (const metric of metrics) {
    const actual = requireFiniteNumber(
      summary.total?.[metric]?.pct,
      `coverage-summary.json total.${metric}.pct`
    );
    const expected = requireFiniteNumber(baseline[metric], `coverage-baseline.json ${metric}`);
    if (actual < expected) {
      failures.push(`${metric}: ${actual}% < baseline ${expected}%`);
    }
  }

  const format = (metric) =>
    `${metric}=${summary.total[metric].pct}% (baseline ${baseline[metric]}%)`;
  console.log(`Backend coverage baseline: ${metrics.map(format).join(', ')}`);

  if (failures.length > 0) {
    console.error('Backend coverage baseline check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
} catch (error) {
  console.error('Backend coverage baseline check failed:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
