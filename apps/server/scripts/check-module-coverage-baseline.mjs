import { resolve } from 'node:path';
import { metrics, normalizeRepoPath, readJson, requireFiniteNumber, root } from './coverage-utils.mjs';

try {
  const baselinePath = resolve(root, 'coverage-module-baseline.json');
  const summaryPath = resolve(root, 'coverage/coverage-summary.json');
  const baseline = readJson(baselinePath, '模块覆盖率基线文件 coverage-module-baseline.json');
  const summary = readJson(summaryPath, '覆盖率摘要文件 coverage/coverage-summary.json');
  const modules = baseline.modules;

  if (!modules || typeof modules !== 'object') {
    throw new Error('coverage-module-baseline.json 必须包含 modules 对象。');
  }

  function emptyMetric() {
    return { total: 0, covered: 0 };
  }

  function collectModule(modulePath) {
    const prefix = `apps/server/src/${modulePath.replace(/^\/+|\/+$/g, '')}/`;
    const aggregate = Object.fromEntries(metrics.map((metric) => [metric, emptyMetric()]));
    let files = 0;

    for (const [entryPath, entry] of Object.entries(summary)) {
      if (entryPath === 'total') continue;
      const normalized = normalizeRepoPath(entryPath);
      if (!normalized.startsWith(prefix)) continue;
      files += 1;

      for (const metric of metrics) {
        aggregate[metric].total += requireFiniteNumber(entry[metric]?.total, `${normalized} ${metric}.total`);
        aggregate[metric].covered += requireFiniteNumber(entry[metric]?.covered, `${normalized} ${metric}.covered`);
      }
    }

    return { aggregate, files };
  }

  function pct(metric) {
    if (metric.total === 0) return 0;
    return Number(((metric.covered / metric.total) * 100).toFixed(2));
  }

  const failures = [];
  const reports = [];
  for (const [modulePath, expected] of Object.entries(modules)) {
    const { aggregate, files } = collectModule(modulePath);
    if (files === 0) {
      failures.push(`${modulePath}: 未匹配任何 coverage entry，请检查模块路径或 coverage include/exclude 配置。`);
      reports.push(`${modulePath}: files=0`);
      continue;
    }

    const line = metrics
      .map((metric) => {
        const actualPct = pct(aggregate[metric]);
        const expectedPct = requireFiniteNumber(expected[metric], `${modulePath} ${metric}`);
        if (actualPct < expectedPct) failures.push(`${modulePath}: ${metric} ${actualPct}% < baseline ${expectedPct}%`);
        return `${metric}=${actualPct}% (baseline ${expectedPct}%)`;
      })
      .join(', ');
    reports.push(`${modulePath}: files=${files}, ${line}`);
  }

  console.log(`Backend module coverage baseline:\n${reports.map((report) => `- ${report}`).join('\n')}`);

  if (failures.length > 0) {
    console.error('Backend module coverage baseline check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
} catch (error) {
  console.error('Backend module coverage baseline check failed:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
